"use strict";

const { AVATARS, indexCatalog, validateContent } = require("./validate");

class RoadmapError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function assertOpId(opId) {
  if (typeof opId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(opId)) {
    throw new RoadmapError(400, "op_invalid", "A valid operation id is required.");
  }
}

function sanitizeText(value, max) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new RoadmapError(400, "note_invalid", "Notes must be plain text.");
  }
  const stripped = value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (stripped.length > max) {
    throw new RoadmapError(400, "note_too_long", "That note is too long to save.");
  }
  return stripped;
}

function sanitizeEvidence(value) {
  if (value == null || String(value).trim() === "") return "";
  const raw = String(value).trim();
  if (raw.length > 500) {
    throw new RoadmapError(400, "evidence_invalid", "That evidence link is too long.");
  }
  let url;
  try {
    url = new URL(raw);
  } catch (_err) {
    throw new RoadmapError(400, "evidence_invalid", "Evidence must be an http or https link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RoadmapError(400, "evidence_blocked", "Only http and https evidence links are allowed.");
  }
  if (url.username || url.password) {
    throw new RoadmapError(400, "evidence_blocked", "Evidence links cannot include a username or password.");
  }
  return url.toString();
}

function keyEnrol(uid) {
  return `p:${uid}:enrolment`;
}
function keyIndex(uid, roleId, version) {
  return `p:${uid}:index:${roleId}:v${version}`;
}
function keyAttempt(uid, roleId, version, attemptNo) {
  return `p:${uid}:attempt:${roleId}:v${version}:a${attemptNo}`;
}
function keyNote(uid, roleId, version, attemptNo, stepId) {
  return `p:${uid}:note:${roleId}:v${version}:a${attemptNo}:${stepId}`;
}
function keyOp(uid, opId) {
  return `p:${uid}:op:${opId}`;
}
function keyCounts(roleId, version) {
  return `c:${roleId}:v${version}`;
}
function trailKey(roleId, version) {
  return `${roleId}:v${version}`;
}

function cleanRole(input, roleId) {
  if (!input || typeof input !== "object") {
    throw new RoadmapError(400, "content_invalid", "This trail is missing.");
  }
  if (input.id !== roleId || !AVATARS[roleId]) {
    throw new RoadmapError(400, "role_unknown", "That trail does not exist.");
  }
  const stepsIn = Array.isArray(input.steps) ? input.steps : [];
  if (stepsIn.length < 1 || stepsIn.length > 15) {
    throw new RoadmapError(400, "content_invalid", "A trail needs 1 to 15 steps.");
  }
  const steps = stepsIn.map((step, index) => {
    const resource = step?.primaryResource || {};
    const links = (Array.isArray(step?.links) ? step.links : []).slice(0, 2);
    return {
      id: String(step?.id || `${roleId}-step-${index + 1}`).trim(),
      role: roleId,
      version: Number(input.version) || 1,
      order: index + 1,
      type: String(step?.type || "task").trim() || "task",
      section: String(step?.section || "Trail").trim().slice(0, 24) || "Trail",
      title: String(step?.title || "").trim(),
      goal: String(step?.goal || "").trim(),
      estimateMinutes: Number(step?.estimateMinutes),
      task: String(step?.task || "").trim(),
      requiredOutput: String(step?.requiredOutput || "").trim(),
      doneChecklist: (Array.isArray(step?.doneChecklist) ? step.doneChecklist : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 6),
      primaryResource: {
        id: String(resource.id || `${roleId}-resource-${index + 1}`).trim(),
        publisher: String(resource.publisher || "").trim(),
        title: String(resource.title || "").trim(),
        url: String(resource.url || "").trim(),
        slice: String(resource.slice || "").trim(),
        accessNote:
          String(resource.accessNote || "").trim() ||
          "Public page. No sign-in. If it asks you to pay or create an account, use the task instead.",
        checkedDate: "2026-11-09",
        checkMethod: "Admin publish",
      },
      links: links
        .map((link) => ({
          kind: link?.kind === "video" ? "video" : "article",
          publisher: String(link?.publisher || "").trim(),
          title: String(link?.title || "").trim(),
          url: String(link?.url || "").trim(),
          slice: String(link?.slice || "").trim(),
        }))
        .filter((link) => link.url || link.title),
      completion: "Self-attested checklist. This is your own record, not a graded pass.",
      fallback:
        String(step?.fallback || "").trim() || "If the link does not open, the task in this step is enough.",
    };
  });
  return {
    id: roleId,
    title: String(input.title || "").trim(),
    avatar: AVATARS[roleId],
    version: Number(input.version) || 1,
    description: String(input.description || "").trim(),
    steps,
  };
}

function blankCounts(role, now) {
  const current = {};
  const completed = {};
  for (const step of role.steps) {
    current[step.id] = 0;
    completed[step.id] = 0;
  }
  return {
    roleId: role.id,
    version: role.version,
    cohort: 0,
    finished: 0,
    current,
    completed,
    lastUpdated: now || null,
  };
}

function zeroVector(steps) {
  const current = {};
  const completed = {};
  for (const step of steps) {
    current[step.id] = 0;
    completed[step.id] = 0;
  }
  return { current, completed, finished: 0, cohort: 0 };
}

function vectorFor(steps, completedMap) {
  const vec = zeroVector(steps);
  vec.cohort = 1;
  let open = false;
  let allDone = true;
  for (const step of steps) {
    if (completedMap && completedMap[step.id]) {
      vec.completed[step.id] = 1;
    } else {
      allDone = false;
      if (!open) {
        vec.current[step.id] = 1;
        open = true;
      }
    }
  }
  if (allDone) vec.finished = 1;
  return vec;
}

function applyDelta(agg, steps, before, after, now) {
  const next = {
    roleId: agg.roleId,
    version: agg.version,
    cohort: (agg.cohort || 0) + after.cohort - before.cohort,
    finished: (agg.finished || 0) + after.finished - before.finished,
    current: { ...(agg.current || {}) },
    completed: { ...(agg.completed || {}) },
    lastUpdated: now,
  };
  for (const step of steps) {
    next.current[step.id] =
      (next.current[step.id] || 0) + (after.current[step.id] || 0) - (before.current[step.id] || 0);
    next.completed[step.id] =
      (next.completed[step.id] || 0) + (after.completed[step.id] || 0) - (before.completed[step.id] || 0);
  }
  return next;
}

function assertCounts(agg, steps) {
  let sum = 0;
  let prev = Infinity;
  if ((agg.cohort || 0) < 0 || (agg.finished || 0) < 0) {
    throw new RoadmapError(500, "count_invariant", "Count update was rejected.");
  }
  for (const step of steps) {
    const here = agg.current[step.id] || 0;
    const done = agg.completed[step.id] || 0;
    if (here < 0 || done < 0) {
      throw new RoadmapError(500, "count_invariant", "Count update was rejected.");
    }
    sum += here;
    if (done > prev) throw new RoadmapError(500, "count_invariant", "Count update was rejected.");
    prev = done;
  }
  if (sum + (agg.finished || 0) !== (agg.cohort || 0)) {
    throw new RoadmapError(500, "count_invariant", "Count update was rejected.");
  }
}

function progressOf(steps, completed) {
  const done = steps.filter((step) => completed && completed[step.id]).length;
  const next = steps.find((step) => !completed || !completed[step.id]) || null;
  return {
    done,
    total: steps.length,
    finished: done === steps.length,
    currentStepId: next ? next.id : null,
    nextTitle: next ? next.title : null,
  };
}

function decorateSteps(steps, attempt) {
  const completed = attempt?.completed || {};
  const saved = attempt?.checklist || {};
  let opened = false;
  return steps.map((step) => {
    let state = "locked";
    if (completed[step.id]) state = "completed";
    else if (!opened) {
      state = "available";
      opened = true;
    }
    const checklist = {};
    step.checklist.forEach((_, index) => {
      const key = String(index);
      checklist[key] = state === "completed" ? true : Boolean(saved[step.id] && saved[step.id][key]);
    });
    return {
      id: step.id,
      order: step.order,
      state,
      completedAt: completed[step.id] || null,
      checklist,
    };
  });
}

function normalizeChecklist(step, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RoadmapError(400, "checklist_invalid", "Checklist is missing.");
  }
  const out = {};
  const allowed = new Set(step.checklist.map((_, index) => String(index)));
  for (const key of Object.keys(input)) {
    if (!allowed.has(String(key))) {
      throw new RoadmapError(400, "checklist_invalid", "Unknown checklist item.");
    }
    out[String(key)] = input[key] === true;
  }
  for (const key of allowed) if (out[key] !== true) out[key] = false;
  return out;
}

function allChecked(checks) {
  return Object.values(checks).every((value) => value === true);
}

class RoadmapService {
  constructor({ store, catalog, raw = null, now = () => new Date().toISOString() }) {
    if (!store) throw new Error("store required");
    if (!catalog) throw new Error("catalog required");
    this.store = store;
    this.catalog = catalog;
    this.raw = raw;
    this.published = {};
    this.drafts = {};
    this._hydratedAt = 0;
    this.byRole = indexCatalog(catalog);
    this.now = now;
  }

  role(roleId, version) {
    const versions = this.byRole.get(roleId);
    if (!versions) throw new RoadmapError(404, "role_unknown", "That trail does not exist.");
    const resolved = version == null ? Math.max(...versions.keys()) : Number(version);
    const role = versions.get(resolved);
    if (!role) throw new RoadmapError(404, "version_unknown", "That trail version does not exist.");
    return role;
  }

  latestVersion(roleId) {
    return this.role(roleId).version;
  }

  publicCatalog() {
    return {
      ok: true,
      contentVersion: this.catalog.contentVersion,
      checkedDate: this.catalog.checkedDate,
      status: this.catalog.status,
      audience: this.catalog.audience,
      unlockPolicy: this.catalog.unlockPolicy,
      resourceNote: this.catalog.resourceNote,
      countDisclosure: this.catalog.countDisclosure,
      roles: this.catalog.roles.map((role) => ({
        id: role.id,
        title: role.title,
        avatar: role.avatar,
        avatarFile: role.avatarFile,
        version: role.version,
        description: role.description,
        steps: role.steps.length,
        latest: role.version === this.latestVersion(role.id),
      })),
    };
  }

  publicRole(roleId, version) {
    const role = this.role(roleId, version);
    return {
      ok: true,
      contentVersion: this.catalog.contentVersion,
      status: this.catalog.status,
      resourceNote: this.catalog.resourceNote,
      countDisclosure: this.catalog.countDisclosure,
      latestVersion: this.latestVersion(roleId),
      role,
    };
  }

  async getCounts(roleId, version) {
    const role = this.role(roleId, version);
    const doc = await this.store.transaction((tx) => tx.get(keyCounts(role.id, role.version)));
    const agg = doc || blankCounts(role, null);
    const normalized = {
      ...blankCounts(role, null),
      ...agg,
      current: { ...blankCounts(role, null).current, ...(agg.current || {}) },
      completed: { ...blankCounts(role, null).completed, ...(agg.completed || {}) },
    };
    try {
      assertCounts(normalized, role.steps);
    } catch (_err) {
      throw new RoadmapError(503, "counts_unavailable", "Counts unavailable");
    }
    return {
      ok: true,
      unavailable: false,
      roleId: role.id,
      version: role.version,
      cohort: normalized.cohort || 0,
      finished: normalized.finished || 0,
      lastUpdated: normalized.lastUpdated || null,
      disclosure: this.catalog.countDisclosure,
      steps: role.steps.map((step) => ({
        id: step.id,
        order: step.order,
        current: normalized.current[step.id] || 0,
        completed: normalized.completed[step.id] || 0,
      })),
    };
  }

  async getOwnerState(uid) {
    return this.store.transaction(async (tx) => this._readState(tx, uid));
  }

  async _readState(tx, uid) {
    const enrolment = await tx.get(keyEnrol(uid));
    if (!enrolment) {
      return { ok: true, active: null, trails: [] };
    }
    const trails = [];
    const entries = Object.values(enrolment.trails || {});
    for (const entry of entries) {
      const role = this.byRole.get(entry.roleId)?.get(entry.version);
      if (!role) {
        trails.push({
          roleId: entry.roleId,
          version: entry.version,
          missingContent: true,
          active: false,
        });
        continue;
      }
      const index = (await tx.get(keyIndex(uid, role.id, role.version))) || null;
      if (!index?.currentAttemptNo) continue;
      const attempt = await tx.get(keyAttempt(uid, role.id, role.version, index.currentAttemptNo));
      const notes = await this._notesFor(tx, uid, role, index.currentAttemptNo);
      const archives = [];
      for (const archived of index.archived || []) {
        const old = await tx.get(keyAttempt(uid, role.id, role.version, archived.attemptNo));
        const oldNotes = await this._notesFor(tx, uid, role, archived.attemptNo);
        archives.push({
          attemptNo: archived.attemptNo,
          archivedAt: archived.at,
          reason: archived.reason,
          completedCount: old ? Object.keys(old.completed || {}).length : 0,
          notes: oldNotes,
        });
      }
      const active =
        enrolment.activeRoleId === role.id &&
        enrolment.activeVersion === role.version &&
        enrolment.activeAttemptNo === index.currentAttemptNo;
      trails.push({
        roleId: role.id,
        version: role.version,
        title: role.title,
        avatar: role.avatar,
        attemptNo: index.currentAttemptNo,
        revision: attempt?.revision || 0,
        status: attempt?.status || "current",
        active,
        missingContent: false,
        progress: progressOf(role.steps, attempt?.completed),
        steps: decorateSteps(role.steps, attempt),
        notes,
        archives,
        history: attempt?.history || [],
      });
    }
    const active = trails.find((trail) => trail.active) || null;
    return {
      ok: true,
      excluded: Boolean(enrolment.excluded),
      active,
      trails,
    };
  }

  async _notesFor(tx, uid, role, attemptNo) {
    const notes = {};
    for (const step of role.steps) {
      const note = await tx.get(keyNote(uid, role.id, role.version, attemptNo, step.id));
      if (!note) continue;
      if (!note.text && !note.evidence && !note.revision) continue;
      notes[step.id] = {
        text: note.text || "",
        evidence: note.evidence || "",
        revision: note.revision || 0,
      };
    }
    return notes;
  }

  async activate({ uid, roleId, version = null, explicitVersion = false, excluded = false, opId }) {
    assertOpId(opId);
    const fp = JSON.stringify({ type: "activate", roleId, version: explicitVersion ? Number(version) : null });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      const pinned = enrolment.pins?.[roleId];
      const target = this.role(roleId, explicitVersion ? version : pinned || null);
      const loaded = await this._loadAttempt(tx, uid, target, true);
      const nextEnrol = {
        ...enrolment,
        excluded: Boolean(excluded),
        activeRoleId: target.id,
        activeVersion: target.version,
        activeAttemptNo: loaded.attempt.attemptNo,
        pins: { ...(enrolment.pins || {}), [target.id]: target.version },
        trails: {
          ...(enrolment.trails || {}),
          [trailKey(target.id, target.version)]: { roleId: target.id, version: target.version },
        },
        updatedAt: this.now(),
      };
      const countWrites = await this._retargetCounts(tx, enrolment, nextEnrol, {
        [trailKey(target.id, target.version)]: loaded.attempt,
      });
      tx.set(keyEnrol(uid), nextEnrol);
      tx.set(keyIndex(uid, target.id, target.version), loaded.index);
      tx.set(keyAttempt(uid, target.id, target.version, loaded.attempt.attemptNo), loaded.attempt);
      const progress = progressOf(target.steps, loaded.attempt.completed);
      return {
        ok: true,
        roleId: target.id,
        version: target.version,
        attemptNo: loaded.attempt.attemptNo,
        revision: loaded.attempt.revision,
        progress,
        createdAttempt: loaded.created,
        countKeys: countWrites,
      };
    });
  }

  async saveChecklist({ uid, roleId, version, stepId, checklist, expectedRevision, opId }) {
    assertOpId(opId);
    const role = this.role(roleId, version);
    const step = this._step(role, stepId);
    const checks = normalizeChecklist(step, checklist);
    const fp = JSON.stringify({ type: "checklist", roleId, version: role.version, stepId, checks, expectedRevision });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      const { attempt } = await this._requireCurrent(tx, uid, role);
      this._assertRevision(attempt, expectedRevision);
      if (attempt.completed?.[step.id]) {
        throw new RoadmapError(400, "step_completed", "Undo this step before changing its checklist.");
      }
      attempt.checklist = { ...(attempt.checklist || {}), [step.id]: checks };
      attempt.revision += 1;
      attempt.updatedAt = this.now();
      tx.set(keyAttempt(uid, role.id, role.version, attempt.attemptNo), attempt);
      tx.set(keyEnrol(uid), { ...enrolment, updatedAt: this.now() });
      return {
        ok: true,
        roleId: role.id,
        version: role.version,
        stepId: step.id,
        revision: attempt.revision,
        checklist: checks,
        countKeys: [],
      };
    });
  }

  async complete({ uid, roleId, version, stepId, checklist, expectedRevision, opId }) {
    assertOpId(opId);
    const role = this.role(roleId, version);
    const step = this._step(role, stepId);
    const checks = normalizeChecklist(step, checklist);
    const fp = JSON.stringify({
      type: "complete",
      roleId,
      version: role.version,
      stepId,
      expectedRevision,
    });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      this._assertActive(enrolment, role);
      const { attempt } = await this._requireCurrent(tx, uid, role);
      if (attempt.completed?.[step.id]) {
        const progress = progressOf(role.steps, attempt.completed);
        return {
          ok: true,
          alreadyComplete: true,
          roleId: role.id,
          version: role.version,
          stepId: step.id,
          revision: attempt.revision,
          progress,
          next: progress.finished ? null : { id: progress.currentStepId, title: progress.nextTitle },
          countKeys: [],
        };
      }
      this._assertRevision(attempt, expectedRevision);
      if (!allChecked(checks)) {
        throw new RoadmapError(400, "checklist_incomplete", "Tick every item after you try the task.");
      }
      const open = role.steps.find((item) => !attempt.completed?.[item.id]);
      if (!open || open.id !== step.id) {
        throw new RoadmapError(400, "step_locked", "Finish the earlier steps before marking this one done.");
      }
      const before = this._eligibleVector(enrolment, role, attempt);
      attempt.completed = { ...(attempt.completed || {}), [step.id]: this.now() };
      attempt.checklist = { ...(attempt.checklist || {}), [step.id]: checks };
      attempt.revision += 1;
      attempt.updatedAt = this.now();
      const after = this._eligibleVector(enrolment, role, attempt);
      const countKeys = await this._writeCounts(tx, role, before, after);
      tx.set(keyAttempt(uid, role.id, role.version, attempt.attemptNo), attempt);
      tx.set(keyEnrol(uid), { ...enrolment, updatedAt: this.now() });
      const progress = progressOf(role.steps, attempt.completed);
      return {
        ok: true,
        saved: true,
        roleId: role.id,
        version: role.version,
        stepId: step.id,
        revision: attempt.revision,
        progress,
        finishedTrail: progress.finished,
        next: progress.finished ? null : { id: progress.currentStepId, title: progress.nextTitle },
        countKeys,
      };
    });
  }

  async undo({ uid, roleId, version, stepId, expectedRevision, opId }) {
    assertOpId(opId);
    const role = this.role(roleId, version);
    const step = this._step(role, stepId);
    const fp = JSON.stringify({ type: "undo", roleId, version: role.version, stepId, expectedRevision });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      this._assertActive(enrolment, role);
      const { attempt } = await this._requireCurrent(tx, uid, role);
      this._assertRevision(attempt, expectedRevision);
      if (!attempt.completed?.[step.id]) {
        throw new RoadmapError(400, "nothing_to_undo", "That step is not marked done.");
      }
      const suffix = role.steps.filter((item) => item.order >= step.order);
      const cleared = suffix
        .filter((item) => attempt.completed?.[item.id] || attempt.checklist?.[item.id])
        .map((item) => ({
          stepId: item.id,
          completedAt: attempt.completed?.[item.id] || null,
          checklist: attempt.checklist?.[item.id] || null,
        }));
      const before = this._eligibleVector(enrolment, role, attempt);
      const completed = { ...(attempt.completed || {}) };
      const checklist = { ...(attempt.checklist || {}) };
      for (const item of suffix) {
        delete completed[item.id];
        delete checklist[item.id];
      }
      attempt.completed = completed;
      attempt.checklist = checklist;
      attempt.revision += 1;
      attempt.updatedAt = this.now();
      attempt.history = [
        ...(attempt.history || []),
        { type: "undo", at: this.now(), stepId: step.id, cleared },
      ].slice(-40);
      const after = this._eligibleVector(enrolment, role, attempt);
      const countKeys = await this._writeCounts(tx, role, before, after);
      tx.set(keyAttempt(uid, role.id, role.version, attempt.attemptNo), attempt);
      tx.set(keyEnrol(uid), { ...enrolment, updatedAt: this.now() });
      return {
        ok: true,
        roleId: role.id,
        version: role.version,
        stepId: step.id,
        revision: attempt.revision,
        cleared: cleared.map((item) => item.stepId),
        progress: progressOf(role.steps, attempt.completed),
        countKeys,
      };
    });
  }

  async saveNotes({ uid, roleId, version, stepId, text, evidence, expectedRevision, opId }) {
    assertOpId(opId);
    const role = this.role(roleId, version);
    const step = this._step(role, stepId);
    const cleanText = sanitizeText(text, 4000);
    const cleanEvidence = sanitizeEvidence(evidence);
    const fp = JSON.stringify({
      type: "notes",
      roleId,
      version: role.version,
      stepId,
      expectedRevision,
      text: cleanText,
      evidence: cleanEvidence,
    });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      const { attempt } = await this._requireCurrent(tx, uid, role);
      const noteKey = keyNote(uid, role.id, role.version, attempt.attemptNo, step.id);
      const existing = await tx.get(noteKey);
      const revision = existing?.revision || 0;
      if (Number(expectedRevision) !== revision) {
        throw new RoadmapError(409, "note_conflict", "Notes were saved in another session.", {
          server: {
            text: existing?.text || "",
            evidence: existing?.evidence || "",
            revision,
          },
        });
      }
      if ((existing?.text || "") === cleanText && (existing?.evidence || "") === cleanEvidence) {
        return {
          ok: true,
          unchanged: true,
          roleId: role.id,
          version: role.version,
          stepId: step.id,
          revision,
          countKeys: [],
        };
      }
      const saved = {
        kind: "note",
        uid,
        roleId: role.id,
        version: role.version,
        attemptNo: attempt.attemptNo,
        stepId: step.id,
        text: cleanText,
        evidence: cleanEvidence,
        revision: revision + 1,
        updatedAt: this.now(),
      };
      tx.set(noteKey, saved);
      tx.set(keyEnrol(uid), { ...enrolment, updatedAt: this.now() });
      return {
        ok: true,
        saved: true,
        roleId: role.id,
        version: role.version,
        stepId: step.id,
        revision: saved.revision,
        countKeys: [],
      };
    });
  }

  async restart({ uid, roleId, version, expectedRevision, opId }) {
    assertOpId(opId);
    const role = this.role(roleId, version);
    const fp = JSON.stringify({ type: "restart", roleId, version: role.version, expectedRevision });
    return this._mutate(uid, opId, fp, async (tx, enrolment) => {
      this._assertActive(enrolment, role);
      const loaded = await this._requireCurrent(tx, uid, role);
      this._assertRevision(loaded.attempt, expectedRevision);
      const before = this._eligibleVector(enrolment, role, loaded.attempt);
      loaded.attempt.status = "archived";
      loaded.attempt.archivedAt = this.now();
      loaded.attempt.archiveReason = "restart";
      loaded.attempt.updatedAt = this.now();
      const attemptNo = loaded.index.nextNo;
      const fresh = this._newAttempt(uid, role, attemptNo);
      loaded.index.archived = [
        ...(loaded.index.archived || []),
        { attemptNo: loaded.attempt.attemptNo, at: this.now(), reason: "restart" },
      ];
      loaded.index.currentAttemptNo = attemptNo;
      loaded.index.nextNo = attemptNo + 1;
      const nextEnrol = {
        ...enrolment,
        activeAttemptNo: attemptNo,
        updatedAt: this.now(),
      };
      const after = this._eligibleVector(nextEnrol, role, fresh);
      const countKeys = await this._writeCounts(tx, role, before, after);
      tx.set(keyAttempt(uid, role.id, role.version, loaded.attempt.attemptNo), loaded.attempt);
      tx.set(keyAttempt(uid, role.id, role.version, fresh.attemptNo), fresh);
      tx.set(keyIndex(uid, role.id, role.version), loaded.index);
      tx.set(keyEnrol(uid), nextEnrol);
      return {
        ok: true,
        roleId: role.id,
        version: role.version,
        archivedAttemptNo: loaded.attempt.attemptNo,
        attemptNo: fresh.attemptNo,
        revision: 0,
        progress: progressOf(role.steps, {}),
        countKeys,
      };
    });
  }

  async setExcluded(uid, excluded) {
    const flag = Boolean(excluded);
    return this.store.transaction(async (tx) => {
      const enrolment = await tx.get(keyEnrol(uid));
      if (!enrolment) return { ok: true, unchanged: true, countKeys: [] };
      if (Boolean(enrolment.excluded) === flag) return { ok: true, unchanged: true, countKeys: [] };
      const next = { ...enrolment, excluded: flag, updatedAt: this.now() };
      const countKeys = await this._retargetCounts(tx, enrolment, next, {});
      tx.set(keyEnrol(uid), next);
      return { ok: true, excluded: flag, countKeys };
    });
  }

  async eraseLearner(uid) {
    return this.store.transaction(async (tx) => {
      const docs = await tx.list(`p:${uid}:`);
      const enrolment = docs.find((doc) => doc.kind === "enrolment") || null;
      const countKeys = [];
      if (enrolment?.activeRoleId && !enrolment.excluded) {
        const role = this.byRole.get(enrolment.activeRoleId)?.get(enrolment.activeVersion);
        const attempt = docs.find(
          (doc) =>
            doc.kind === "attempt" &&
            doc.roleId === enrolment.activeRoleId &&
            doc.version === enrolment.activeVersion &&
            doc.attemptNo === enrolment.activeAttemptNo &&
            doc.status === "current"
        );
        if (role && attempt) {
          const before = vectorFor(role.steps, attempt.completed);
          const keys = await this._writeCounts(tx, role, before, zeroVector(role.steps));
          countKeys.push(...keys);
        }
      }
      for (const doc of docs) {
        if (doc._key) tx.del(doc._key);
        else tx.del(this._keyForDoc(uid, doc));
      }
      return { ok: true, deleted: docs.length, countKeys };
    });
  }

  async reconcile() {
    const desired = new Map();
    for (const role of this.catalog.roles) {
      desired.set(trailKey(role.id, role.version), blankCounts(role, this.now()));
    }
    const enrolments = await this.store.listEnrolments();
    for (const enrolment of enrolments) {
      if (enrolment.excluded || !enrolment.activeRoleId) continue;
      const role = this.byRole.get(enrolment.activeRoleId)?.get(enrolment.activeVersion);
      if (!role) continue;
      const attempt = await this.store.transaction((tx) =>
        tx.get(keyAttempt(enrolment.uid, role.id, role.version, enrolment.activeAttemptNo))
      );
      if (!attempt || attempt.status !== "current") continue;
      const agg = desired.get(trailKey(role.id, role.version));
      const vec = vectorFor(role.steps, attempt.completed);
      desired.set(trailKey(role.id, role.version), applyDelta(agg, role.steps, zeroVector(role.steps), vec, this.now()));
    }
    const repaired = [];
    for (const role of this.catalog.roles) {
      const key = trailKey(role.id, role.version);
      const want = desired.get(key);
      assertCounts(want, role.steps);
      const have = await this.store.transaction((tx) => tx.get(keyCounts(role.id, role.version)));
      if (!this._sameCounts(have, want)) {
        await this.store.transaction((tx) => tx.set(keyCounts(role.id, role.version), want));
        repaired.push(key);
      }
    }
    return { ok: true, repaired, enrolmentCount: enrolments.length };
  }

  _sameCounts(have, want) {
    if (!have) {
      return want.cohort === 0 && want.finished === 0;
    }
    if ((have.cohort || 0) !== want.cohort || (have.finished || 0) !== want.finished) return false;
    for (const id of Object.keys(want.current)) {
      if ((have.current?.[id] || 0) !== want.current[id]) return false;
      if ((have.completed?.[id] || 0) !== want.completed[id]) return false;
    }
    return true;
  }

  _keyForDoc(uid, doc) {
    if (doc.kind === "enrolment") return keyEnrol(uid);
    if (doc.kind === "index") return keyIndex(uid, doc.roleId, doc.version);
    if (doc.kind === "attempt") return keyAttempt(uid, doc.roleId, doc.version, doc.attemptNo);
    if (doc.kind === "note") return keyNote(uid, doc.roleId, doc.version, doc.attemptNo, doc.stepId);
    if (doc.kind === "op") return keyOp(uid, doc.opId);
    throw new RoadmapError(500, "erase_failed", "Could not remove roadmap data.");
  }

  async _mutate(uid, opId, fingerprint, fn) {
    return this.store.transaction(async (tx) => {
      const opKey = keyOp(uid, opId);
      const existing = await tx.get(opKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new RoadmapError(409, "op_mismatch", "That operation id was already used for a different save.");
        }
        return existing.result;
      }
      const enrolment = (await tx.get(keyEnrol(uid))) || {
        kind: "enrolment",
        uid,
        activeRoleId: null,
        activeVersion: null,
        activeAttemptNo: null,
        excluded: false,
        pins: {},
        trails: {},
        createdAt: this.now(),
      };
      const result = await fn(tx, enrolment);
      tx.set(opKey, {
        kind: "op",
        uid,
        opId,
        fingerprint,
        result,
        createdAt: this.now(),
      });
      return result;
    });
  }

  async _loadAttempt(tx, uid, role, create) {
    const index =
      (await tx.get(keyIndex(uid, role.id, role.version))) || {
        kind: "index",
        uid,
        roleId: role.id,
        version: role.version,
        nextNo: 1,
        currentAttemptNo: null,
        archived: [],
      };
    let attempt = index.currentAttemptNo
      ? await tx.get(keyAttempt(uid, role.id, role.version, index.currentAttemptNo))
      : null;
    let created = false;
    if ((!attempt || attempt.status !== "current") && create) {
      const attemptNo = index.nextNo;
      attempt = this._newAttempt(uid, role, attemptNo);
      index.currentAttemptNo = attemptNo;
      index.nextNo = attemptNo + 1;
      created = true;
    }
    return { index, attempt, created };
  }

  async _requireCurrent(tx, uid, role) {
    const loaded = await this._loadAttempt(tx, uid, role, false);
    if (!loaded.attempt || loaded.attempt.status !== "current") {
      throw new RoadmapError(400, "not_started", "Start this trail before saving.");
    }
    return loaded;
  }

  _newAttempt(uid, role, attemptNo) {
    return {
      kind: "attempt",
      uid,
      roleId: role.id,
      version: role.version,
      attemptNo,
      status: "current",
      revision: 0,
      completed: {},
      checklist: {},
      history: [],
      createdAt: this.now(),
      updatedAt: this.now(),
      archivedAt: null,
      archiveReason: null,
    };
  }

  _step(role, stepId) {
    const step = role.steps.find((item) => item.id === stepId);
    if (!step) throw new RoadmapError(404, "step_unknown", "That step is not on this trail.");
    return step;
  }

  _assertRevision(attempt, expectedRevision) {
    if (Number(expectedRevision) !== attempt.revision) {
      throw new RoadmapError(409, "revision_conflict", "This trail changed in another session. Reload it and try again.", {
        revision: attempt.revision,
      });
    }
  }

  _assertActive(enrolment, role) {
    if (enrolment.activeRoleId !== role.id || enrolment.activeVersion !== role.version) {
      throw new RoadmapError(409, "trail_inactive", "Switch to this trail before saving completion.");
    }
  }

  _eligibleVector(enrolment, role, attempt) {
    const active =
      enrolment &&
      !enrolment.excluded &&
      enrolment.activeRoleId === role.id &&
      enrolment.activeVersion === role.version &&
      enrolment.activeAttemptNo === attempt.attemptNo &&
      attempt.status === "current";
    return active ? vectorFor(role.steps, attempt.completed) : zeroVector(role.steps);
  }

  async _writeCounts(tx, role, before, after) {
    const existing = (await tx.get(keyCounts(role.id, role.version))) || blankCounts(role, null);
    const next = applyDelta(existing, role.steps, before, after, this.now());
    assertCounts(next, role.steps);
    tx.set(keyCounts(role.id, role.version), next);
    return [trailKey(role.id, role.version)];
  }

  async _retargetCounts(tx, beforeEnrol, afterEnrol, preloadedAttempts) {
    const roles = [];
    const seen = new Set();
    for (const enrolment of [beforeEnrol, afterEnrol]) {
      if (!enrolment?.activeRoleId) continue;
      const key = trailKey(enrolment.activeRoleId, enrolment.activeVersion);
      if (seen.has(key)) continue;
      seen.add(key);
      roles.push(this.role(enrolment.activeRoleId, enrolment.activeVersion));
    }
    const rows = [];
    for (const role of roles) {
      const beforeAttempt = await this._attemptFor(tx, beforeEnrol, role, preloadedAttempts);
      const afterAttempt = await this._attemptFor(tx, afterEnrol, role, preloadedAttempts);
      rows.push({
        role,
        before: beforeAttempt ? this._eligibleVector(beforeEnrol, role, beforeAttempt) : zeroVector(role.steps),
        after: afterAttempt ? this._eligibleVector(afterEnrol, role, afterAttempt) : zeroVector(role.steps),
        agg: (await tx.get(keyCounts(role.id, role.version))) || blankCounts(role, null),
      });
    }
    const written = [];
    for (const row of rows) {
      const next = applyDelta(row.agg, row.role.steps, row.before, row.after, this.now());
      assertCounts(next, row.role.steps);
      tx.set(keyCounts(row.role.id, row.role.version), next);
      written.push(trailKey(row.role.id, row.role.version));
    }
    return written;
  }

  async hydrate() {
    if (!this.raw) return;
    if (this._hydratedAt && Date.now() - this._hydratedAt < 15000) return;
    const published = await this.store.transaction((tx) => tx.get("a:published"));
    const drafts = await this.store.transaction((tx) => tx.get("a:drafts"));
    this.published = published?.roles && typeof published.roles === "object" ? published.roles : {};
    this.drafts = drafts?.roles && typeof drafts.roles === "object" ? drafts.roles : {};
    if (Object.keys(this.published).length) {
      try {
        this._reindex();
      } catch (err) {
        console.error("published roadmap overlay rejected");
        this.published = {};
      }
    }
    this._hydratedAt = Date.now();
  }

  _composeRaw(extraRole) {
    const raw = structuredClone(this.raw);
    for (const role of Object.values(this.published || {})) this._upsertRaw(raw, role);
    if (extraRole) this._upsertRaw(raw, extraRole);
    return raw;
  }

  _upsertRaw(raw, role) {
    const index = raw.roles.findIndex(
      (item) => item && item.id === role.id && Number(item.version) === Number(role.version)
    );
    if (index >= 0) raw.roles[index] = role;
    else raw.roles.push(role);
  }

  _reindex() {
    const result = validateContent(this._composeRaw());
    if (!result.ok) {
      const error = new Error(result.errors[0] || "Published trail is invalid");
      error.errors = result.errors;
      throw error;
    }
    this.catalog = result.catalog;
    this.byRole = indexCatalog(result.catalog);
  }

  _validateRole(role) {
    if (!this.raw) {
      throw new RoadmapError(400, "authoring_unavailable", "Editing is not available on this server.");
    }
    const result = validateContent(this._composeRaw(role));
    if (!result.ok) {
      throw new RoadmapError(400, "content_invalid", result.errors[0] || "This trail needs a fix before it can be saved.", {
        errors: result.errors.slice(0, 8),
      });
    }
  }

  editorFor(roleId) {
    if (!this.raw) {
      throw new RoadmapError(400, "authoring_unavailable", "Editing is not available on this server.");
    }
    if (!AVATARS[roleId]) throw new RoadmapError(404, "role_unknown", "That trail does not exist.");
    const raw = this._composeRaw();
    const versions = raw.roles.filter((item) => item.id === roleId);
    const latest = versions.slice().sort((a, b) => Number(b.version) - Number(a.version))[0];
    if (!latest) throw new RoadmapError(404, "role_unknown", "That trail does not exist.");
    const draft = this.drafts?.[roleId] || null;
    return {
      ok: true,
      role: draft || latest,
      baseStepIds: latest.steps.map((step) => step.id),
      hasDraft: Boolean(draft),
      version: Number(latest.version),
      noteAccess: "Content admin cannot read student notes, evidence, or private progress.",
    };
  }

  async saveDraft(roleId, input) {
    await this.hydrate();
    const role = cleanRole(input, roleId);
    this._validateRole(role);
    this.drafts = { ...(this.drafts || {}), [roleId]: role };
    await this._saveAuthoring();
    return { ok: true, saved: "draft", role };
  }

  async publish(roleId, input, asNewVersion) {
    await this.hydrate();
    const role = cleanRole(input, roleId);
    const latest = this.role(roleId);
    const ids = role.steps.map((step) => step.id);
    const same =
      ids.length === latest.steps.length && ids.every((id, index) => id === latest.steps[index].id);
    let next = role;
    if (!same) {
      if (!asNewVersion) {
        throw new RoadmapError(
          400,
          "version_required",
          "Step order changed. Publish it as a new version so current students keep their trail."
        );
      }
      const version = latest.version + 1;
      next = {
        ...role,
        version,
        steps: role.steps.map((step, index) => ({
          ...step,
          id: `${roleId}-v${version}-${String(index + 1).padStart(2, "0")}`,
          role: roleId,
          version,
          order: index + 1,
        })),
      };
    } else {
      next = {
        ...role,
        version: latest.version,
        steps: role.steps.map((step, index) => ({
          ...step,
          id: latest.steps[index].id,
          role: roleId,
          version: latest.version,
          order: index + 1,
        })),
      };
    }
    this._validateRole(next);
    this.published = { ...(this.published || {}), [`${next.id}:v${next.version}`]: next };
    delete this.drafts[roleId];
    this._reindex();
    await this._saveAuthoring();
    this._hydratedAt = Date.now();
    return {
      ok: true,
      saved: "published",
      roleId: next.id,
      version: next.version,
      steps: next.steps.length,
      newVersion: !same,
    };
  }

  async _saveAuthoring() {
    await this.store.transaction(async (tx) => {
      tx.set("a:published", { kind: "authoring", roles: this.published || {} });
      tx.set("a:drafts", { kind: "authoring", roles: this.drafts || {} });
    });
  }

  async learnerBoard() {
    const enrolments = await this.store.listEnrolments();
    const learners = [];
    for (const enrolment of enrolments.slice(0, 200)) {
      const row = {
        uid: enrolment.uid,
        excluded: Boolean(enrolment.excluded),
        updatedAt: enrolment.updatedAt || null,
        state: enrolment.activeRoleId ? "not-started" : "not-started",
        roleId: enrolment.activeRoleId || null,
        roleTitle: "",
        version: enrolment.activeVersion || null,
        done: 0,
        total: 0,
        currentStep: null,
      };
      if (!enrolment.activeRoleId || !enrolment.activeAttemptNo) {
        learners.push(row);
        continue;
      }
      try {
        const role = this.role(enrolment.activeRoleId, enrolment.activeVersion);
        const attempt = await this.store.transaction((tx) =>
          tx.get(keyAttempt(enrolment.uid, role.id, role.version, enrolment.activeAttemptNo))
        );
        const progress = progressOf(role.steps, attempt?.completed);
        row.roleTitle = role.title;
        row.total = progress.total;
        row.done = progress.done;
        row.state = progress.finished ? "finished" : "on-step";
        row.currentStep = progress.finished ? null : progress.nextTitle;
      } catch (_err) {
        row.state = "unknown-trail";
      }
      learners.push(row);
    }
    return {
      ok: true,
      learners,
      noteAccess: "Progress only. Notes and evidence stay private.",
    };
  }

  /** Progress-only view for one student. Notes and evidence stay private. */
  async learnerSummary(uid) {
    return this.store.transaction(async (tx) => {
      const enrolment = await tx.get(keyEnrol(uid));
      if (!enrolment) {
        return {
          ok: true,
          excluded: false,
          active: null,
          trails: [],
          noteAccess: "Progress only. Notes and evidence stay private.",
        };
      }
      const trails = [];
      for (const entry of Object.values(enrolment.trails || {})) {
        const role = this.byRole.get(entry.roleId)?.get(entry.version);
        if (!role) {
          trails.push({
            roleId: entry.roleId,
            version: entry.version,
            title: "",
            missingContent: true,
            active: false,
            state: "unknown-trail",
            done: 0,
            total: 0,
            currentStep: null,
            attemptNo: null,
            archivedAttempts: 0,
          });
          continue;
        }
        const index = (await tx.get(keyIndex(uid, role.id, role.version))) || null;
        if (!index?.currentAttemptNo) continue;
        const attempt = await tx.get(keyAttempt(uid, role.id, role.version, index.currentAttemptNo));
        const progress = progressOf(role.steps, attempt?.completed);
        const active =
          enrolment.activeRoleId === role.id &&
          enrolment.activeVersion === role.version &&
          enrolment.activeAttemptNo === index.currentAttemptNo;
        trails.push({
          roleId: role.id,
          version: role.version,
          title: role.title,
          avatar: role.avatar || null,
          missingContent: false,
          active,
          state: progress.finished ? "finished" : "on-step",
          done: progress.done,
          total: progress.total,
          currentStep: progress.finished ? null : progress.nextTitle,
          currentStepId: progress.currentStepId,
          attemptNo: index.currentAttemptNo,
          archivedAttempts: Array.isArray(index.archived) ? index.archived.length : 0,
          steps: (role.steps || []).map((step) => ({
            id: step.id,
            order: step.order,
            title: step.title,
            completed: Boolean(attempt?.completed?.[step.id]),
          })),
        });
      }
      const active = trails.find((trail) => trail.active) || null;
      return {
        ok: true,
        excluded: Boolean(enrolment.excluded),
        updatedAt: enrolment.updatedAt || null,
        active,
        trails,
        noteAccess: "Progress only. Notes and evidence stay private.",
      };
    });
  }

  async _attemptFor(tx, enrolment, role, preloaded) {
    if (!enrolment?.activeRoleId) return null;
    if (enrolment.activeRoleId !== role.id || enrolment.activeVersion !== role.version) return null;
    const cached = preloaded[trailKey(role.id, role.version)];
    if (cached && cached.attemptNo === enrolment.activeAttemptNo) return cached;
    if (!enrolment.activeAttemptNo) return null;
    return tx.get(keyAttempt(enrolment.uid, role.id, role.version, enrolment.activeAttemptNo));
  }
}

module.exports = {
  RoadmapService,
  RoadmapError,
  sanitizeEvidence,
  sanitizeText,
  keyCounts,
  trailKey,
  assertCounts,
};
