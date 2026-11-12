"use strict";

/**
 * Local TEST fixture only. Serves the roadmap API from memory.
 * It does not use production Firestore and must not be pointed at live data.
 *
 *   node scripts/dev-roadmap-api.js
 */

const express = require("express");
const cors = require("cors");
const { createRouter } = require("../roadmap/routes");
const { RoadmapService } = require("../roadmap/service");
const { MemoryStore } = require("../roadmap/store");
const { loadSeed } = require("../roadmap/validate");
const { SocialService, MemoryRepo } = require("../social/service");
const { createSocialRouter } = require("../social/routes");

const catalog = loadSeed();
const social = new SocialService({ repo: new MemoryRepo() });

const users = new Map();
const service = new RoadmapService({ store: new MemoryStore(), catalog });
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// QUESTIONS_FILE: a saved copy of the public GET /api/questions, so the quiz can run locally.
app.get("/api/questions", (_req, res) => {
  if (process.env.QUESTIONS_FILE) return res.json(JSON.parse(require("fs").readFileSync(process.env.QUESTIONS_FILE, "utf8")));
  res.json({ version: "dev-fixture", questions: [], anchors: [], roleMap: {}, boosts: [], whatsappUrl: "" });
});
app.post("/api/invites/check", (req, res) => res.json({ ok: true, code: String(req.body?.code || "DEV").toUpperCase(), label: "Dev" }));
app.get("/api/colleges", (_req, res) => {
  res.json({ colleges: [{ id: "c1", name: "Test College" }], departments: [{ id: "d1", name: "CSE" }], whatsappUrl: "" });
});
app.get("/api/colleges/:id/stats", (req, res) => {
  res.json({ ok: true, collegeId: req.params.id, signedUpCount: 0 });
});

const requireStudent = (req, res, next) => {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ ok: false, error: "Missing bearer token" });
  req.student = { uid: match[1], email: `${match[1]}@example.com` };
  return next();
};
const SELECTED = { id: "builders", name: "Builders", key: "R", score: 8, animal: "Beaver" };
const learnerOf = (uid) => {
  if (!users.has(uid) && uid.startsWith("dev-new")) {
    users.set(uid, { displayName: "New", roles: [], inviteCode: "" }); // fresh student: onboarding + quiz
  }
  if (!users.has(uid)) {
    users.set(uid, {
      roles: [SELECTED, { id: "hackers", name: "Hackers", key: "I", score: 7 }],
      selectedRole: SELECTED,
      scores: { R: 8, I: 7 },
      displayName: uid.replace(/^dev-/, "").replace(/^./, (c) => c.toUpperCase()),
      collegeId: "c1",
      departmentId: "d1",
      passoutYear: 2028,
      mobile: "9876543210",
      inviteCode: "DEV",
    });
  }
  return users.get(uid);
};
app.get("/api/me", requireStudent, (req, res) => {
  const u = learnerOf(req.student.uid);
  res.json({ ok: true, user: { ...u, uid: req.student.uid, hasAnswers: Boolean(u.scores) } });
});
app.post("/api/me/profile", requireStudent, (req, res) => {
  const u = learnerOf(req.student.uid);
  Object.assign(u, req.body);
  res.json({ ok: true, user: { ...u, uid: req.student.uid, hasAnswers: Boolean(u.scores) } });
});
app.post("/api/me/discovery", requireStudent, async (req, res) => {
  const u = learnerOf(req.student.uid);
  Object.assign(u, { roles: req.body.roles, scores: req.body.scores, selectedRole: req.body.selectedRole });
  await social.quizDone({ uid: req.student.uid, displayName: u.displayName, collegeId: u.collegeId, roleId: u.selectedRole?.id || "" });
  res.json({ ok: true, selectedRole: u.selectedRole });
});

const resolveLearner = async (req) => {
  const data = learnerOf(req.student.uid);
  return {
    uid: req.student.uid,
    roles: data.roles,
    selectedRole: data.selectedRole,
    scores: data.scores,
    displayName: data.displayName,
    collegeId: data.collegeId,
    excluded: data.roadmapCountExcluded === true,
  };
};
const roadmapRouter = createRouter({
    service,
    countsTtlMs: 0,
    social,
    requireStudent,
    requireAdmin(req, res, next) {
      const match = String(req.headers.authorization || "").match(/^Bearer\s+dev-admin$/i);
      if (!match) return res.status(403).json({ ok: false, error: "Not an admin" });
      req.admin = { email: "dev-admin@example.com" };
      return next();
    },
    resolveLearner,
    async touchUser(uid, patch) {
      users.set(uid, { ...(users.get(uid) || {}), ...patch });
    },
  });
app.use("/api", roadmapRouter);
app.use("/api", createSocialRouter({ social, requireStudent, resolveLearner }));

const port = Number(process.env.PORT || 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`TEST roadmap fixture listening on http://127.0.0.1:${port}`);
});
