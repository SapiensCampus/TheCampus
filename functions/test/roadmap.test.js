"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createRouter } = require("../roadmap/routes");
const { RoadmapService, RoadmapError, keyCounts } = require("../roadmap/service");
const { MemoryStore } = require("../roadmap/store");
const { AVATAR_FILES, AVATARS, loadSeed, validateContent } = require("../roadmap/validate");

const root = path.join(__dirname, "..", "..");
const seedPath = path.join(__dirname, "..", "data", "roadmap-content.json");
const checksPath = path.join(__dirname, "..", "data", "roadmap-source-checks.json");

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 9, 0, 0, tick++)).toISOString();
}

function fresh(catalog = loadSeed()) {
  const store = new MemoryStore();
  const service = new RoadmapService({ store, catalog, now: clock() });
  let n = 0;
  const op = () => `op-${String(++n).padStart(8, "0")}`;
  return { store, service, op };
}

function checked(step) {
  const checklist = {};
  step.checklist.forEach((_, index) => {
    checklist[String(index)] = true;
  });
  return checklist;
}

function partial(step) {
  const checklist = checked(step);
  checklist["0"] = false;
  return checklist;
}

async function enrol(service, op, uid, roleId, extra = {}) {
  return service.activate({ uid, roleId, excluded: false, opId: op(), ...extra });
}

async function expectInvariants(service, roleId = "builders", version = 1) {
  const counts = await service.getCounts(roleId, version);
  const sum = counts.steps.reduce((total, step) => total + step.current, 0);
  assert.equal(sum + counts.finished, counts.cohort);
  for (let i = 1; i < counts.steps.length; i += 1) {
    assert.ok(counts.steps[i].completed <= counts.steps[i - 1].completed);
  }
  return counts;
}

test("seed has six avatars, ten steps, and checked https resources", () => {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const result = validateContent(raw);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.catalog.status, "published");
  assert.equal(result.catalog.editorialStatus, "draft-for-review");
  assert.equal(result.catalog.roles.length, 6);
  const seen = new Set();
  for (const role of result.catalog.roles) {
    assert.equal(role.avatar, AVATARS[role.id]);
    assert.equal(role.steps.length, 10);
    assert.ok(role.steps.length <= 15);
    for (const step of role.steps) {
      assert.ok(!seen.has(step.id));
      seen.add(step.id);
      assert.ok(step.estimateMinutes >= 20 && step.estimateMinutes <= 75);
      assert.ok(step.task && step.requiredOutput && step.checklist.length >= 2);
      assert.ok(step.resource.url.startsWith("https://"));
    }
  }
  assert.equal(seen.size, 60);

  const checks = JSON.parse(fs.readFileSync(checksPath, "utf8"));
  const byUrl = new Map(checks.map((item) => [item.url, item]));
  const rejected = new Set(checks.filter((item) => item.httpStatus === 404).map((item) => item.url));
  for (const role of raw.roles) {
    for (const step of role.steps) {
      const url = step.primaryResource.url;
      assert.ok(byUrl.has(url), `missing source check for ${url}`);
      assert.equal(rejected.has(url), false, url);
      for (const link of step.links || []) {
        assert.ok(byUrl.has(link.url), `missing source check for ${link.url}`);
        assert.equal(rejected.has(link.url), false, link.url);
        assert.ok(link.kind === "article" || link.kind === "video");
      }
      assert.ok(step.section && step.section.length <= 24);
    }
  }
});

test("validator rejects unsafe or oversized trails", () => {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const tooMany = structuredClone(raw);
  const template = tooMany.roles[0].steps[0];
  tooMany.roles[0].steps = Array.from({ length: 16 }, (_, index) => ({
    ...template,
    id: `builders-extra-${index + 1}`,
    order: index + 1,
  }));
  assert.equal(validateContent(tooMany).ok, false);

  const duplicate = structuredClone(raw);
  duplicate.roles[0].steps[1].id = duplicate.roles[0].steps[0].id;
  assert.equal(validateContent(duplicate).ok, false);

  const scriptUrl = structuredClone(raw);
  scriptUrl.roles[0].steps[0].primaryResource.url = "javascript:alert(1)";
  assert.equal(validateContent(scriptUrl).ok, false);

  const longStep = structuredClone(raw);
  longStep.roles[0].steps[4].estimateMinutes = 90;
  assert.equal(validateContent(longStep).ok, false);

  const missing = structuredClone(raw);
  delete missing.roles[2].steps[0].task;
  missing.roles[2].steps[0].doneChecklist = ["only one"];
  assert.equal(validateContent(missing).ok, false);

  const wrongAnimal = structuredClone(raw);
  wrongAnimal.roles[0].avatar = "Fox";
  assert.equal(validateContent(wrongAnimal).ok, false);
});

test("original avatar files are the supplied SVGs", () => {
  for (const [roleId, file] of Object.entries(AVATAR_FILES)) {
    const live = fs.readFileSync(path.join(root, "web", "public", "avatars", file));
    const handed = fs.readFileSync(path.join(root, "quiz-avatar-handoff", file));
    assert.deepEqual(live, handed, file);
    assert.match(live.toString("utf8"), /<svg/i);
    assert.equal(AVATARS[roleId] != null, true);
  }
});

test("empty counts are a real zero", async () => {
  const { service } = fresh();
  const counts = await expectInvariants(service);
  assert.equal(counts.cohort, 0);
  assert.equal(counts.finished, 0);
  assert.equal(counts.steps[0].current, 0);
  assert.equal(counts.unavailable, false);
  assert.equal(counts.lastUpdated, null);
});

test("enrol, complete, retry, and out-of-order rules", async () => {
  const { service, op } = fresh();
  const role = service.role("builders", 1);
  await enrol(service, op, "ada", "builders");
  await enrol(service, op, "ada", "builders");
  let counts = await expectInvariants(service);
  assert.equal(counts.cohort, 1);
  assert.equal(counts.steps[0].current, 1);
  assert.equal(counts.finished, 0);

  await assert.rejects(
    service.complete({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[1].id,
      checklist: checked(role.steps[1]),
      expectedRevision: 0,
      opId: op(),
    }),
    (err) => err instanceof RoadmapError && err.code === "step_locked"
  );
  counts = await expectInvariants(service);
  assert.equal(counts.steps[0].current, 1);

  await assert.rejects(
    service.complete({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[0].id,
      checklist: partial(role.steps[0]),
      expectedRevision: 0,
      opId: op(),
    }),
    (err) => err.code === "checklist_incomplete"
  );

  const firstOp = op();
  const saved = await service.complete({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    checklist: checked(role.steps[0]),
    expectedRevision: 0,
    opId: firstOp,
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.next.id, role.steps[1].id);
  const replay = await service.complete({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    checklist: checked(role.steps[0]),
    expectedRevision: 0,
    opId: firstOp,
  });
  assert.deepEqual(replay, saved);
  const again = await service.complete({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    checklist: checked(role.steps[0]),
    expectedRevision: 1,
    opId: op(),
  });
  assert.equal(again.alreadyComplete, true);
  counts = await expectInvariants(service);
  assert.equal(counts.steps[0].current, 0);
  assert.equal(counts.steps[0].completed, 1);
  assert.equal(counts.steps[1].current, 1);
  assert.equal(counts.cohort, 1);
});

test("concurrent completes and stale revisions do not double-count", async () => {
  const { service, op } = fresh();
  const role = service.role("builders", 1);
  await enrol(service, op, "ada", "builders");
  const body = {
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    checklist: checked(role.steps[0]),
    expectedRevision: 0,
  };
  const settled = await Promise.allSettled([
    service.complete({ ...body, opId: op() }),
    service.complete({ ...body, opId: op() }),
  ]);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 0);
  const counts = await expectInvariants(service);
  assert.equal(counts.steps[0].completed, 1);
  assert.equal(counts.cohort, 1);

  const left = partial(role.steps[1]);
  const right = checked(role.steps[1]);
  right["0"] = false;
  const raced = await Promise.allSettled([
    service.saveChecklist({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[1].id,
      checklist: left,
      expectedRevision: 1,
      opId: op(),
    }),
    service.saveChecklist({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[1].id,
      checklist: right,
      expectedRevision: 1,
      opId: op(),
    }),
  ]);
  assert.equal(raced.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(raced.find((item) => item.status === "rejected").reason.code, "revision_conflict");
  const state = await service.getOwnerState("ada");
  const saved = state.active.steps.find((step) => step.id === role.steps[1].id).checklist;
  const winner = raced.find((item) => item.status === "fulfilled").value.checklist;
  assert.deepEqual(saved, winner);
  assert.equal((await expectInvariants(service)).steps[1].completed, 0);
});

test("suffix undo keeps notes and restart archives an attempt", async () => {
  const { service, op } = fresh();
  const role = service.role("builders", 1);
  await enrol(service, op, "ada", "builders");
  let revision = 0;
  for (let index = 0; index < 3; index += 1) {
    const saved = await service.complete({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[index].id,
      checklist: checked(role.steps[index]),
      expectedRevision: revision,
      opId: op(),
    });
    revision = saved.revision;
  }
  const noted = await service.saveNotes({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[1].id,
    text: "<script>secret-note-zebra</script> keep me",
    evidence: "https://example.com/sketch",
    expectedRevision: 0,
    opId: op(),
  });
  assert.equal(noted.revision, 1);
  const undone = await service.undo({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[1].id,
    expectedRevision: revision,
    opId: op(),
  });
  assert.deepEqual(undone.cleared, [role.steps[1].id, role.steps[2].id]);
  let state = await service.getOwnerState("ada");
  assert.equal(state.active.progress.done, 1);
  assert.equal(state.active.notes[role.steps[1].id].text, "secret-note-zebra keep me");
  assert.equal(state.active.notes[role.steps[1].id].evidence, "https://example.com/sketch");
  let counts = await expectInvariants(service);
  assert.equal(counts.steps[0].completed, 1);
  assert.equal(counts.steps[1].completed, 0);
  assert.equal(counts.steps[1].current, 1);

  const restarted = await service.restart({
    uid: "ada",
    roleId: "builders",
    version: 1,
    expectedRevision: undone.revision,
    opId: op(),
  });
  assert.equal(restarted.progress.done, 0);
  assert.equal(restarted.archivedAttemptNo, 1);
  state = await service.getOwnerState("ada");
  assert.equal(state.active.attemptNo, 2);
  assert.equal(state.active.notes[role.steps[1].id], undefined);
  assert.equal(state.active.archives[0].notes[role.steps[1].id].text, "secret-note-zebra keep me");
  counts = await expectInvariants(service);
  assert.equal(counts.cohort, 1);
  assert.equal(counts.steps[0].current, 1);
  assert.equal(counts.steps[0].completed, 0);
});

test("notes conflict, and completion does not overwrite notes", async () => {
  const { service, op } = fresh();
  const role = service.role("builders", 1);
  await enrol(service, op, "ada", "builders");
  await service.saveNotes({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    text: "first draft",
    evidence: "",
    expectedRevision: 0,
    opId: op(),
  });
  await assert.rejects(
    service.saveNotes({
      uid: "ada",
      roleId: "builders",
      version: 1,
      stepId: role.steps[0].id,
      text: "second tab",
      evidence: "",
      expectedRevision: 0,
      opId: op(),
    }),
    (err) => err.code === "note_conflict" && err.extra.server.text === "first draft"
  );
  const calls = [];
  const original = global.fetch;
  global.fetch = (...args) => {
    calls.push(args[0]);
    return Promise.reject(new Error("evidence must not be fetched"));
  };
  try {
    await assert.rejects(
      service.saveNotes({
        uid: "ada",
        roleId: "builders",
        version: 1,
        stepId: role.steps[0].id,
        text: "nope",
        evidence: "javascript:alert(1)",
        expectedRevision: 1,
        opId: op(),
      }),
      (err) => err.code === "evidence_blocked"
    );
    assert.equal(calls.length, 0);
  } finally {
    global.fetch = original;
  }
  const saved = await service.complete({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: role.steps[0].id,
    checklist: checked(role.steps[0]),
    expectedRevision: 0,
    opId: op(),
  });
  assert.equal(saved.saved, true);
  const state = await service.getOwnerState("ada");
  assert.equal(state.active.notes[role.steps[0].id].text, "first draft");
});

test("role switch, version opt-in, exclusion, finish, and erasure", async () => {
  const base = loadSeed();
  const catalog = structuredClone(base);
  const builders = catalog.roles.find((role) => role.id === "builders");
  const next = structuredClone(builders);
  next.version = 2;
  next.steps = next.steps.map((step, index) => ({
    ...step,
    version: 2,
    id: `builders-v2-${String(index + 1).padStart(2, "0")}`,
    title: `Version two ${step.title}`,
  }));
  catalog.roles.push(next);
  const { service, op, store } = fresh(catalog);
  const v1 = service.role("builders", 1);
  await enrol(service, op, "ada", "builders", { explicitVersion: true, version: 1 });
  await service.complete({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: v1.steps[0].id,
    checklist: checked(v1.steps[0]),
    expectedRevision: 0,
    opId: op(),
  });
  await service.saveNotes({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: v1.steps[0].id,
    text: "builders note",
    evidence: "",
    expectedRevision: 0,
    opId: op(),
  });
  await enrol(service, op, "ada", "hackers");
  let buildersCounts = await expectInvariants(service, "builders", 1);
  let hackerCounts = await expectInvariants(service, "hackers", 1);
  assert.equal(buildersCounts.cohort, 0);
  assert.equal(hackerCounts.cohort, 1);
  assert.equal(hackerCounts.steps[0].current, 1);
  await enrol(service, op, "ada", "builders", { explicitVersion: true, version: 1 });
  buildersCounts = await expectInvariants(service, "builders", 1);
  hackerCounts = await expectInvariants(service, "hackers", 1);
  assert.equal(buildersCounts.steps[0].completed, 1);
  assert.equal(buildersCounts.steps[1].current, 1);
  assert.equal(hackerCounts.cohort, 0);
  const returned = await service.getOwnerState("ada");
  const buildersTrail = returned.trails.find((trail) => trail.roleId === "builders" && trail.version === 1);
  assert.equal(buildersTrail.notes[v1.steps[0].id].text, "builders note");

  await enrol(service, op, "ada", "builders", { explicitVersion: true, version: 2 });
  const afterVersion = await service.getOwnerState("ada");
  const oldTrail = afterVersion.trails.find((trail) => trail.version === 1 && trail.roleId === "builders");
  const newTrail = afterVersion.trails.find((trail) => trail.version === 2 && trail.roleId === "builders");
  assert.equal(oldTrail.progress.done, 1);
  assert.equal(newTrail.progress.done, 0);
  assert.equal(newTrail.active, true);
  assert.equal((await expectInvariants(service, "builders", 1)).cohort, 0);
  assert.equal((await expectInvariants(service, "builders", 2)).steps[0].current, 1);

  await service.setExcluded("ada", true);
  assert.equal((await expectInvariants(service, "builders", 2)).cohort, 0);
  const stillThere = await service.getOwnerState("ada");
  assert.equal(stillThere.active.progress.done, 0);
  assert.equal(stillThere.excluded, true);
  await service.setExcluded("ada", false);
  assert.equal((await expectInvariants(service, "builders", 2)).cohort, 1);

  const bee = fresh(catalog);
  await enrol(bee.service, bee.op, "bee", "builders", { explicitVersion: true, version: 1 });
  let revision = 0;
  for (const step of bee.service.role("builders", 1).steps) {
    const saved = await bee.service.complete({
      uid: "bee",
      roleId: "builders",
      version: 1,
      stepId: step.id,
      checklist: checked(step),
      expectedRevision: revision,
      opId: bee.op(),
    });
    revision = saved.revision;
  }
  const finished = await expectInvariants(bee.service, "builders", 1);
  assert.equal(finished.finished, 1);
  assert.equal(finished.cohort, 1);
  assert.ok(finished.steps.every((step) => step.current === 0));
  assert.ok(finished.steps.every((step) => step.completed === 1));

  await store.putRaw(keyCounts("builders", 2), {
    roleId: "builders",
    version: 2,
    cohort: 9,
    finished: 4,
    current: {},
    completed: {},
    lastUpdated: "drift",
  });
  await assert.rejects(() => service.getCounts("builders", 2), (err) => err.code === "counts_unavailable");
  const repaired = await service.reconcile();
  assert.ok(repaired.repaired.includes("builders:v2"));
  const fixed = await expectInvariants(service, "builders", 2);
  assert.equal(fixed.cohort, 1);

  await service.eraseLearner("ada");
  assert.equal((await service.getOwnerState("ada")).active, null);
  assert.equal((await expectInvariants(service, "builders", 2)).cohort, 0);
  const leftover = [...store.docs.keys()].filter((key) => key.startsWith("p:ada:"));
  assert.deepEqual(leftover, []);
});

test("yellove text colors meet WCAG AA contrast", () => {
  function channel(hex, index) {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  function luminance(hex) {
    const raw = hex.replace("#", "");
    return 0.2126 * channel(raw, 0) + 0.7152 * channel(raw, 2) + 0.0722 * channel(raw, 4);
  }
  function contrast(a, b) {
    const left = luminance(a);
    const right = luminance(b);
    const [hi, lo] = left > right ? [left, right] : [right, left];
    return (hi + 0.05) / (lo + 0.05);
  }
  for (const pair of [
    ["#0a0a0a", "#feeec3"],
    ["#0a0a0a", "#ffd966"],
    ["#0a0a0a", "#fefcf5"],
    ["#0a0a0a", "#d2ffb6"],
    ["#0a0a0a", "#b6eaff"],
    ["#0a0a0a", "#e3b6ff"],
    ["#0a0a0a", "#ffc0b6"],
    ["#464239", "#feeec3"],
    ["#464239", "#fefcf5"],
  ]) {
    assert.ok(contrast(pair[0], pair[1]) >= 4.5, pair.join(" on "));
  }
});

test("http routes isolate students and ignore client count flags", async () => {
  const { service } = fresh();
  const users = new Map();
  users.set("ada", {
    roles: [
      { id: "builders", name: "Builders", key: "R", score: 8 },
      { id: "hackers", name: "Hackers", key: "I", score: 6 },
    ],
    selectedRole: { id: "builders", name: "Builders", key: "R", score: 8, animal: "Beaver" },
    scores: { R: 8, I: 6, A: 0, S: 0, E: 0, C: 0 },
    answers: { q1: 2 },
  });
  users.set("bee", {
    roles: [{ id: "creators", name: "Creators", key: "A", score: 9 }],
    selectedRole: { id: "creators", name: "Creators", key: "A", score: 9, animal: "Peacock" },
    scores: { A: 9 },
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createRouter({
      service,
      countsTtlMs: 0,
      requireStudent(req, res, next) {
        const match = String(req.headers.authorization || "").match(/^Bearer test:(.+)$/);
        if (!match) return res.status(401).json({ ok: false, error: "Missing bearer token" });
        req.student = { uid: match[1], email: `${match[1]}@students.example` };
        return next();
      },
      requireAdmin(req, res, next) {
        const match = String(req.headers.authorization || "").match(/^Bearer admin:(.+)$/);
        if (!match) return res.status(401).json({ ok: false, error: "Missing bearer token" });
        if (match[1] !== "owner@example.com") {
          return res.status(403).json({ ok: false, error: "Not an admin" });
        }
        req.admin = { email: match[1] };
        return next();
      },
      async resolveLearner(req) {
        const data = users.get(req.student.uid) || {};
        return {
          uid: req.student.uid,
          roles: data.roles || [],
          selectedRole: data.selectedRole || null,
          scores: data.scores || null,
          excluded: data.roadmapCountExcluded === true,
        };
      },
      async touchUser(uid, patch) {
        users.set(uid, { ...(users.get(uid) || {}), ...patch });
      },
    })
  );
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(urlPath, options = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }
  try {
    const preview = await call("/api/roadmaps/builders");
    assert.equal(preview.status, 200);
    assert.equal(preview.body.role.steps.length, 10);
    assert.equal(JSON.stringify(preview.body).includes("secret-note-zebra"), false);
    const zero = await call("/api/roadmaps/builders/counts");
    assert.equal(zero.body.cohort, 0);
    assert.equal(zero.body.steps[0].current, 0);
    assert.equal(zero.body.unavailable, false);
    const started = await call("/api/me/roadmap/start", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({ opId: "start-ada-01", roleId: "builders", excluded: true }),
    });
    assert.equal(started.status, 200);
    const counted = await call("/api/roadmaps/builders/counts");
    assert.equal(counted.body.cohort, 1);
    const step = preview.body.role.steps[0];
    const checklist = {};
    step.checklist.forEach((_, index) => {
      checklist[String(index)] = true;
    });
    const blocked = await call("/api/me/roadmap/notes", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({
        opId: "note-ada-block",
        roleId: "builders",
        version: 1,
        stepId: step.id,
        expectedRevision: 0,
        text: "secret-note-zebra",
        evidence: "data:text/html,hi",
      }),
    });
    assert.equal(blocked.status, 400);
    const savedNote = await call("/api/me/roadmap/notes", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({
        opId: "note-ada-0001",
        roleId: "builders",
        version: 1,
        stepId: step.id,
        expectedRevision: 0,
        text: "secret-note-zebra",
        evidence: "",
      }),
    });
    assert.equal(savedNote.status, 200);
    const kept = await call("/api/me/roadmap", { headers: { authorization: "Bearer test:ada" } });
    assert.equal(kept.body.active.notes[step.id].text, "secret-note-zebra");
    const other = await call("/api/me/roadmap", { headers: { authorization: "Bearer test:bee" } });
    assert.equal(JSON.stringify(other.body).includes("secret-note-zebra"), false);
    assert.equal(other.body.active, null);
    const anonymous = await call("/api/me/roadmap");
    assert.equal(anonymous.status, 401);
    const adminDenied = await call("/api/admin/roadmaps", {
      headers: { authorization: "Bearer test:ada" },
    });
    assert.equal(adminDenied.status, 401);
    const admin = await call("/api/admin/roadmaps", {
      headers: { authorization: "Bearer admin:owner@example.com" },
    });
    assert.equal(admin.status, 200);
    assert.equal(JSON.stringify(admin.body).includes("secret-note-zebra"), false);
    assert.match(admin.body.noteAccess, /cannot read student notes/i);
    const switched = await call("/api/me/roadmap/switch", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({ opId: "switch-ada-1", roleId: "hackers" }),
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.selectedRole.id, "hackers");
    assert.equal(switched.body.selectedRole.animal, "Fox");
    assert.deepEqual(users.get("ada").scores, { R: 8, I: 6, A: 0, S: 0, E: 0, C: 0 });
    assert.equal(users.get("ada").roles.length, 2);
    const back = await call("/api/me/roadmap/switch", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({ opId: "switch-ada-2", roleId: "builders" }),
    });
    assert.equal(back.status, 200);
    const done = await call("/api/me/roadmap/complete", {
      method: "POST",
      headers: { authorization: "Bearer test:ada" },
      body: JSON.stringify({
        opId: "done-ada-0001",
        roleId: "builders",
        version: 1,
        stepId: step.id,
        expectedRevision: 0,
        checklist,
      }),
    });
    assert.equal(done.status, 200);
    const excluded = await call("/api/admin/users/ada/roadmap-exclusion", {
      method: "PUT",
      headers: { authorization: "Bearer admin:owner@example.com" },
      body: JSON.stringify({ excluded: true }),
    });
    assert.equal(excluded.status, 200);
    const hidden = await call("/api/roadmaps/builders/counts");
    assert.equal(hidden.body.cohort, 0);
    const removed = await call("/api/admin/users/ada/roadmap", {
      method: "DELETE",
      headers: { authorization: "Bearer admin:owner@example.com" },
    });
    assert.equal(removed.status, 200);
    const after = await call("/api/me/roadmap", { headers: { authorization: "Bearer test:ada" } });
    assert.equal(after.body.active, null);
    assert.equal(JSON.stringify(after.body).includes("secret-note-zebra"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("publishing a trail keeps the old version and hides private notes", async () => {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const store = new MemoryStore();
  let tick = 0;
  const service = new RoadmapService({
    store,
    catalog: loadSeed(),
    raw,
    now: () => new Date(Date.UTC(2026, 10, 9, 1, 0, tick++)).toISOString(),
  });
  const op = () => `publish-${String(tick).padStart(8, "0")}`;
  const editor = service.editorFor("builders");
  const role = structuredClone(editor.role);
  role.steps[0].title = "Notice one campus friction";
  const published = await service.publish("builders", role, false);
  assert.equal(published.version, 1);
  assert.equal(published.newVersion, false);
  const live = service.publicRole("builders", 1);
  assert.equal(live.role.steps[0].title, "Notice one campus friction");
  assert.equal(live.role.steps[0].section, "Find");

  await service.activate({ uid: "ada", roleId: "builders", excluded: false, opId: op() });
  const step = live.role.steps[0];
  await service.saveNotes({
    uid: "ada",
    roleId: "builders",
    version: 1,
    stepId: step.id,
    text: "private-bus-note",
    evidence: "",
    expectedRevision: 0,
    opId: op(),
  });
  const board = await service.learnerBoard();
  assert.equal(board.learners.length, 1);
  assert.equal(board.learners[0].state, "on-step");
  assert.equal(board.learners[0].done, 0);
  assert.equal(board.learners[0].currentStep, "Notice one campus friction");
  assert.equal(JSON.stringify(board).includes("private-bus-note"), false);
  const summary = await service.learnerSummary("ada");
  assert.equal(summary.active?.roleId, "builders");
  assert.equal(summary.active?.currentStep, "Notice one campus friction");
  assert.equal(summary.active?.steps?.[0]?.title, "Notice one campus friction");
  assert.equal(JSON.stringify(summary).includes("private-bus-note"), false);

  const extra = structuredClone(role);
  extra.steps.push({
    ...extra.steps[9],
    id: "builders-extra-step",
    order: 11,
    title: "Show one screen to a classmate",
  });
  const next = await service.publish("builders", extra, true);
  assert.equal(next.version, 2);
  assert.equal(next.steps, 11);
  assert.equal(service.publicRole("builders", 1).role.steps.length, 10);
  assert.equal(service.publicRole("builders").role.version, 2);
  assert.equal(service.role("builders", 1).steps[0].title, "Notice one campus friction");
});
