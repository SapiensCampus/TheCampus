"use strict";

/**
 * XP, streaks, daily quests, weekly league and follows.
 * Pure logic over a small repo so tests and the local fixture run without Firestore.
 * Public data is limited to students who opted in: name, college, role, XP and streak.
 */

const STEP_XP = 10;
const QUIZ_XP = 20;
const CHEST_XP = 10;
// Small honest actions keep the day alive; the lesson itself is a bonus (it can take an hour).
const QUESTS = [
  { id: "ticks", label: "Tick one checklist item", goal: 1, required: true },
  { id: "note", label: "Write one line in My notes", goal: 1, required: true },
  { id: "lesson", label: "Finish 1 lesson (bonus)", goal: 1, required: false },
];
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

class SocialError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Calendar day in India, as YYYY-MM-DD. */
function dayOf(ms) {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}

/** Monday of that IST week, as YYYY-MM-DD. */
function weekOf(ms) {
  const d = new Date(ms + IST_MS);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return dayOf(ms - sinceMonday * DAY_MS);
}

function blankProfile(uid, who = {}) {
  return {
    uid,
    displayName: who.displayName || "",
    collegeId: who.collegeId || "",
    roleId: who.roleId || "",
    visible: false,
    xpTotal: 0,
    weekId: "",
    xpWeek: 0,
    streak: 0,
    lastActiveDay: "",
    today: { day: "", steps: 0, xp: 0, ticks: {}, notes: {}, chestClaimed: false },
    quizAwarded: false,
  };
}

/** Roll the week and day counters forward. Mutates and returns doc. */
function roll(doc, now) {
  const day = dayOf(now);
  const week = weekOf(now);
  if (doc.weekId !== week) {
    doc.weekId = week;
    doc.xpWeek = 0;
  }
  if (!doc.today || doc.today.day !== day) {
    doc.today = { day, steps: 0, xp: 0, ticks: {}, notes: {}, chestClaimed: false };
  }
  return doc;
}

function tickTotal(today) {
  return Object.values(today.ticks || {}).reduce((sum, n) => sum + n, 0);
}

function questsOf(doc) {
  const progress = { lesson: doc.today.steps, note: Object.keys(doc.today.notes || {}).length, ticks: tickTotal(doc.today) };
  const list = QUESTS.map((q) => ({
    ...q,
    progress: Math.min(q.goal, Math.max(0, progress[q.id])),
    done: progress[q.id] >= q.goal,
  }));
  const allDone = list.filter((q) => q.required).every((q) => q.done);
  return {
    list,
    allDone,
    chestXp: CHEST_XP,
    chestClaimed: doc.today.chestClaimed === true,
    canClaim: allDone && doc.today.chestClaimed !== true,
  };
}

/** Streak is only alive if the last active day is today or yesterday. */
function liveStreak(doc, now) {
  if (doc.lastActiveDay === dayOf(now) || doc.lastActiveDay === dayOf(now - DAY_MS)) return doc.streak || 0;
  return 0;
}

function selfView(doc, now) {
  return {
    uid: doc.uid,
    displayName: doc.displayName,
    collegeId: doc.collegeId,
    roleId: doc.roleId,
    visible: doc.visible === true,
    xpTotal: doc.xpTotal,
    xpWeek: doc.xpWeek,
    streak: liveStreak(doc, now),
    doneToday: doc.lastActiveDay === dayOf(now),
    stepsToday: doc.today.steps,
    quests: questsOf(doc),
  };
}

function publicView(doc, now) {
  return {
    uid: doc.uid,
    displayName: doc.displayName || "Student",
    collegeId: doc.collegeId,
    roleId: doc.roleId,
    xpWeek: doc.xpWeek,
    xpTotal: doc.xpTotal,
    streak: liveStreak(doc, now),
  };
}

class MemoryRepo {
  constructor() {
    this.profiles = new Map();
    this.follows = new Set(); // "from>to"
    this.queue = Promise.resolve();
  }

  /** Serialized read-modify-write. fn gets a copy (or null) and returns the doc to save. */
  update(uid, fn) {
    const run = async () => {
      const current = this.profiles.get(uid);
      const next = fn(current ? structuredClone(current) : null);
      this.profiles.set(uid, structuredClone(next));
      return next;
    };
    const p = this.queue.then(run, run);
    this.queue = p.then(() => undefined, () => undefined);
    return p;
  }

  async get(uid) {
    const doc = this.profiles.get(uid);
    return doc ? structuredClone(doc) : null;
  }

  async visibleDocs({ weekId, collegeId, uids, limit }) {
    let rows = [...this.profiles.values()].filter((d) => d.visible && d.weekId === weekId);
    if (collegeId) rows = rows.filter((d) => d.collegeId === collegeId);
    if (uids) rows = rows.filter((d) => uids.includes(d.uid));
    rows.sort((a, b) => b.xpWeek - a.xpWeek || a.uid.localeCompare(b.uid));
    return rows.slice(0, limit).map((d) => structuredClone(d));
  }

  async visibleInCollege(collegeId, limit) {
    return [...this.profiles.values()]
      .filter((d) => d.visible && d.collegeId === collegeId)
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }

  async following(uid) {
    return [...this.follows].filter((k) => k.startsWith(`${uid}>`)).map((k) => k.split(">")[1]);
  }

  async followerCount(uid) {
    return [...this.follows].filter((k) => k.endsWith(`>${uid}`)).length;
  }

  async setFollow(from, to, on) {
    if (on) this.follows.add(`${from}>${to}`);
    else this.follows.delete(`${from}>${to}`);
  }
}

class FirestoreRepo {
  constructor(db) {
    this.db = db;
    this.profiles = db.collection("publicProfiles");
    this.follows = db.collection("follows");
  }

  async update(uid, fn) {
    const ref = this.profiles.doc(uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = fn(snap.exists ? snap.data() : null);
      tx.set(ref, next);
      return next;
    });
  }

  async get(uid) {
    const snap = await this.profiles.doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async visibleDocs({ weekId, collegeId, uids, limit }) {
    if (uids) {
      // Friends scope: at most a few dozen point reads.
      const docs = await Promise.all(uids.slice(0, 60).map((uid) => this.get(uid)));
      return docs
        .filter((d) => d && d.visible && d.weekId === weekId)
        .sort((a, b) => b.xpWeek - a.xpWeek)
        .slice(0, limit);
    }
    let query = this.profiles.where("visible", "==", true).where("weekId", "==", weekId);
    if (collegeId) query = query.where("collegeId", "==", collegeId);
    const snap = await query.orderBy("xpWeek", "desc").limit(limit).get();
    return snap.docs.map((d) => d.data());
  }

  async visibleInCollege(collegeId, limit) {
    const snap = await this.profiles
      .where("visible", "==", true)
      .where("collegeId", "==", collegeId)
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data());
  }

  async following(uid) {
    const snap = await this.follows.where("from", "==", uid).limit(200).get();
    return snap.docs.map((d) => d.data().to);
  }

  async followerCount(uid) {
    const snap = await this.follows.where("to", "==", uid).count().get();
    return snap.data().count || 0;
  }

  async setFollow(from, to, on) {
    const ref = this.follows.doc(`${from}_${to}`);
    if (on) await ref.set({ from, to });
    else await ref.delete();
  }
}

class SocialService {
  constructor({ repo, now = () => Date.now() }) {
    this.repo = repo;
    this.now = now;
  }

  /** Create-or-update helper that always keeps identity fields fresh. */
  _touch(uid, who, mutate) {
    const now = this.now();
    return this.repo.update(uid, (current) => {
      const doc = roll(current || blankProfile(uid, who), now);
      if (who.displayName) doc.displayName = who.displayName;
      if (who.collegeId) doc.collegeId = who.collegeId;
      if (who.roleId) doc.roleId = who.roleId;
      mutate(doc, now);
      return doc;
    });
  }

  /** Streak counts once per day, on the first positive activity. */
  _activity(doc, now) {
    const day = dayOf(now);
    if (doc.lastActiveDay === day) return;
    doc.streak = doc.lastActiveDay === dayOf(now - DAY_MS) ? (doc.streak || 0) + 1 : 1;
    doc.lastActiveDay = day;
  }

  /** A retried request replays the same opId; award once. Returns true if already seen. */
  _seen(doc, opId) {
    if (!opId) return false;
    const ops = doc.ops || [];
    if (ops.includes(opId)) return true;
    doc.ops = [...ops, opId].slice(-30);
    return false;
  }

  _addXp(doc, xp) {
    doc.xpTotal = Math.max(0, doc.xpTotal + xp);
    doc.xpWeek = Math.max(0, doc.xpWeek + xp);
    doc.today.xp = Math.max(0, doc.today.xp + xp);
  }

  /** A lesson was finished. Safe to retry only if the caller skips alreadyComplete. */
  async stepCompleted(who, opId = "") {
    const doc = await this._touch(who.uid, who, (d, now) => {
      if (this._seen(d, opId)) return;
      this._activity(d, now);
      this._addXp(d, STEP_XP);
      d.today.steps += 1;
    });
    return selfView(doc, this.now());
  }

  /** Undo takes the XP back, so complete/undo loops earn nothing. Streak is kept. */
  async stepUndone(who, count = 1, opId = "") {
    const doc = await this._touch(who.uid, who, (d) => {
      if (this._seen(d, opId)) return;
      this._addXp(d, -STEP_XP * count);
      d.today.steps = Math.max(0, d.today.steps - count);
    });
    return selfView(doc, this.now());
  }

  /** Remember the most ticks seen for a step today, so re-saving never double counts. */
  async checklistSaved(who, stepId, tickedCount) {
    const doc = await this._touch(who.uid, who, (d, now) => {
      const before = d.today.ticks[stepId] || 0;
      if (tickedCount > before) {
        d.today.ticks[stepId] = tickedCount;
        this._activity(d, now);
      }
    });
    return selfView(doc, this.now());
  }

  /** A non-empty note was saved for a step. Counts once per step per day. */
  async noteSaved(who, stepId) {
    const doc = await this._touch(who.uid, who, (d, now) => {
      d.today.notes = d.today.notes || {};
      if (d.today.notes[stepId]) return;
      d.today.notes[stepId] = true;
      this._activity(d, now);
    });
    return selfView(doc, this.now());
  }

  async quizDone(who) {
    const doc = await this._touch(who.uid, who, (d, now) => {
      if (d.quizAwarded) return;
      d.quizAwarded = true;
      this._activity(d, now);
      this._addXp(d, QUIZ_XP);
    });
    return selfView(doc, this.now());
  }

  async me(who) {
    const doc = await this._touch(who.uid, who, () => {});
    return selfView(doc, this.now());
  }

  async setVisible(who, visible) {
    if (visible !== true && visible !== false) {
      throw new SocialError(400, "visible_invalid", "visible must be true or false.");
    }
    if (visible && (!who.displayName || !who.collegeId)) {
      throw new SocialError(400, "profile_incomplete", "Finish your profile before joining the league.");
    }
    const doc = await this._touch(who.uid, who, (d) => {
      d.visible = visible;
    });
    return selfView(doc, this.now());
  }

  async claimChest(who) {
    let claimed = false;
    const doc = await this._touch(who.uid, who, (d, now) => {
      if (!questsOf(d).canClaim) return;
      claimed = true;
      d.today.chestClaimed = true;
      this._activity(d, now);
      this._addXp(d, CHEST_XP);
    });
    if (!claimed) throw new SocialError(400, "chest_unavailable", "Finish all three quests first.");
    return selfView(doc, this.now());
  }

  /** scope: college | campus | friends. Only opted-in students, plus you if you opted in. */
  async league(who, scope) {
    const now = this.now();
    const weekId = weekOf(now);
    const limit = 30;
    let rows;
    if (scope === "friends") {
      const following = await this.repo.following(who.uid);
      rows = await this.repo.visibleDocs({ weekId, uids: [who.uid, ...following], limit });
    } else if (scope === "campus") {
      rows = await this.repo.visibleDocs({ weekId, limit });
    } else {
      if (!who.collegeId) return { scope: "college", weekId, rows: [], you: null, joined: false };
      rows = await this.repo.visibleDocs({ weekId, collegeId: who.collegeId, limit });
    }
    const mine = await this.repo.get(who.uid);
    const joined = mine?.visible === true;
    const list = rows.map((d, i) => ({ rank: i + 1, ...publicView(d, now), you: d.uid === who.uid }));
    return { scope, weekId, joined, rows: list, you: list.find((r) => r.you) || null };
  }

  async classmates(who, q = "") {
    if (!who.collegeId) return [];
    const needle = String(q || "").trim().toLowerCase().slice(0, 40);
    const docs = await this.repo.visibleInCollege(who.collegeId, 100);
    const following = new Set(await this.repo.following(who.uid));
    const now = this.now();
    // ponytail: filtered in memory over the first 100 opted-in classmates; add prefix index if a college outgrows it
    return docs
      .filter((d) => d.uid !== who.uid && (!needle || (d.displayName || "").toLowerCase().includes(needle)))
      .slice(0, 20)
      .map((d) => ({ ...publicView(d, now), following: following.has(d.uid) }));
  }

  async follow(who, targetUid, on) {
    const target = String(targetUid || "").trim();
    if (!target || target === who.uid) {
      throw new SocialError(400, "follow_invalid", "Pick another student.");
    }
    if (on) {
      const doc = await this.repo.get(target);
      if (!doc || doc.visible !== true) {
        throw new SocialError(404, "student_unknown", "That student is not on the league.");
      }
    }
    await this.repo.setFollow(who.uid, target, on);
    return { ok: true, following: on };
  }

  async publicProfile(who, uid) {
    const doc = await this.repo.get(String(uid || ""));
    if (!doc || doc.visible !== true) {
      throw new SocialError(404, "student_unknown", "That student is not on the league.");
    }
    const following = await this.repo.following(who.uid);
    return {
      ...publicView(doc, this.now()),
      following: following.includes(doc.uid),
      followers: await this.repo.followerCount(doc.uid),
      followingCount: (await this.repo.following(doc.uid)).length,
    };
  }

  async followCounts(who) {
    return {
      following: (await this.repo.following(who.uid)).length,
      followers: await this.repo.followerCount(who.uid),
    };
  }
}

module.exports = {
  STEP_XP,
  QUIZ_XP,
  CHEST_XP,
  QUESTS,
  SocialError,
  SocialService,
  MemoryRepo,
  FirestoreRepo,
  dayOf,
  weekOf,
};
