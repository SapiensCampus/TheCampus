"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SocialService, MemoryRepo, dayOf, weekOf } = require("../social/service");

// 2026-11-11 is a Wednesday (IST noon so UTC and IST dates agree).
const NOON = Date.UTC(2026, 10, 11, 6, 30);
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const clock = { t: NOON };
  const social = new SocialService({ repo: new MemoryRepo(), now: () => clock.t });
  const ann = { uid: "ann", displayName: "Ann", collegeId: "c1", roleId: "builders" };
  const bo = { uid: "bo", displayName: "Bo", collegeId: "c1", roleId: "hackers" };
  const cy = { uid: "cy", displayName: "Cy", collegeId: "c2", roleId: "leaders" };
  return { clock, social, ann, bo, cy };
}

test("IST day and Monday-based week", () => {
  // 20:00 UTC on the 10th is already the 11th in India.
  assert.equal(dayOf(Date.UTC(2026, 10, 10, 20, 0)), "2026-11-11");
  assert.equal(weekOf(NOON), "2026-11-09");
  assert.equal(weekOf(NOON + 5 * DAY), "2026-11-16"); // Monday rolls the week
});

test("complete gives 10 XP, undo takes it back, retries and loops earn nothing", async () => {
  const { social, ann } = setup();
  let me = await social.stepCompleted(ann, "op-1");
  assert.equal(me.xpTotal, 10);
  me = await social.stepCompleted(ann, "op-1"); // same opId replayed
  assert.equal(me.xpTotal, 10);
  me = await social.stepUndone(ann, 1, "op-2");
  assert.equal(me.xpTotal, 0);
  me = await social.stepUndone(ann, 1, "op-2");
  assert.equal(me.xpTotal, 0);
  assert.equal(me.streak, 1, "streak survives an undo");
  await social.stepCompleted(ann, "op-3");
  me = await social.stepUndone(ann, 5, "op-4"); // never below zero
  assert.equal(me.xpTotal, 0);
});

test("streak grows on consecutive days, resets after a gap, and counts once a day", async () => {
  const { social, ann, clock } = setup();
  await social.stepCompleted(ann, "a");
  let me = await social.stepCompleted(ann, "b");
  assert.equal(me.streak, 1);
  clock.t += DAY;
  me = await social.stepCompleted(ann, "c");
  assert.equal(me.streak, 2);
  clock.t += 3 * DAY;
  assert.equal((await social.me(ann)).streak, 0, "shown as lost before any new activity");
  me = await social.stepCompleted(ann, "d");
  assert.equal(me.streak, 1);
});

test("small actions keep the streak; chest needs a tick and a note, lesson is a bonus", async () => {
  const { social, ann, clock } = setup();
  await assert.rejects(social.claimChest(ann), (e) => e.code === "chest_unavailable");
  let me = await social.checklistSaved(ann, "s1", 1);
  await social.checklistSaved(ann, "s1", 1); // re-save does not double count
  assert.equal(me.streak, 1, "one tick is honest activity");
  assert.equal(me.xpTotal, 0, "ticking earns no XP");
  assert.equal(me.quests.allDone, false);
  await social.noteSaved(ann, "s1");
  me = await social.noteSaved(ann, "s1"); // same step again counts once
  assert.equal(me.quests.list.find((q) => q.id === "note").progress, 1);
  assert.equal(me.quests.allDone, true);
  me = await social.claimChest(ann);
  assert.equal(me.xpTotal, 10);
  await assert.rejects(social.claimChest(ann), (e) => e.code === "chest_unavailable");
  clock.t += DAY;
  me = await social.me(ann);
  assert.equal(me.quests.list.every((q) => q.progress === 0), true, "quests reset daily");
  assert.equal(me.streak, 1);
});

test("quiz XP is awarded once", async () => {
  const { social, ann } = setup();
  await social.quizDone(ann);
  const me = await social.quizDone(ann);
  assert.equal(me.xpTotal, 20);
});

test("league shows only opted-in students, scoped by college and friends", async () => {
  const { social, ann, bo, cy } = setup();
  for (const who of [ann, bo, cy]) await social.stepCompleted(who, `op-${who.uid}`);
  await social.stepCompleted(ann, "op-ann-2");
  await social.setVisible(ann, true);
  await social.setVisible(cy, true);
  // bo stays hidden

  let board = await social.league(ann, "college");
  assert.deepEqual(board.rows.map((r) => r.uid), ["ann"], "same college, opted in only");
  assert.equal(board.rows[0].rank, 1);

  board = await social.league(ann, "campus");
  assert.deepEqual(board.rows.map((r) => r.uid), ["ann", "cy"]);
  assert.ok(!("email" in board.rows[0]) && !("today" in board.rows[0]), "no private fields");

  await assert.rejects(social.follow(ann, "bo", true), (e) => e.code === "student_unknown");
  await assert.rejects(social.follow(ann, "ann", true), (e) => e.code === "follow_invalid");
  await social.follow(ann, "cy", true);
  board = await social.league(ann, "friends");
  assert.deepEqual(board.rows.map((r) => r.uid), ["ann", "cy"]);
  board = await social.league(cy, "friends");
  assert.deepEqual(board.rows.map((r) => r.uid), ["cy"], "follows are one-way");

  const profile = await social.publicProfile(ann, "cy");
  assert.equal(profile.following, true);
  assert.equal(profile.followers, 1);
  await social.follow(ann, "cy", false);
  assert.equal((await social.followCounts(ann)).following, 0);
});

test("joining the league needs a finished profile; classmates exclude hidden students", async () => {
  const { social, ann, bo } = setup();
  await assert.rejects(
    social.setVisible({ uid: "new", displayName: "", collegeId: "" }, true),
    (e) => e.code === "profile_incomplete"
  );
  await social.me(bo);
  assert.deepEqual(await social.classmates(ann, ""), []);
  await social.setVisible(bo, true);
  const found = await social.classmates(ann, "b");
  assert.equal(found.length, 1);
  assert.equal(found[0].uid, "bo");
  assert.equal(found[0].following, false);
  await social.setVisible(bo, false);
  assert.deepEqual(await social.classmates(ann, ""), []);
});
