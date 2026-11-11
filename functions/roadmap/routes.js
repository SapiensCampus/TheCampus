"use strict";

const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { RoadmapService, RoadmapError } = require("./service");
const { FirestoreStore } = require("./store");
const { AVATARS, loadSeed, readSeed } = require("./validate");

function createRouter({
  service,
  requireStudent,
  requireAdmin,
  resolveLearner,
  touchUser,
  loadProfiles,
  countsTtlMs = 30000,
}) {
  const router = express.Router();
  const cache = new Map();

  function bust(keys) {
    if (!keys || !keys.length) {
      cache.clear();
      return;
    }
    for (const key of keys) cache.delete(key);
  }

  function handle(fn) {
    return async (req, res) => {
      try {
        if (typeof service.hydrate === "function") await service.hydrate();
        await fn(req, res);
      } catch (err) {
        if (err instanceof RoadmapError) {
          return res.status(err.status).json({
            ok: false,
            code: err.code,
            error: err.message,
            unavailable: err.code === "counts_unavailable",
            ...err.extra,
          });
        }
        console.error("roadmap request failed");
        return res.status(500).json({
          ok: false,
          code: "server_error",
          error: "Something went wrong. Nothing was saved.",
        });
      }
    };
  }

  async function readCounts(roleId, version) {
    const cacheKey = `${roleId}:v${version == null || version === "" ? "latest" : version}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < countsTtlMs) {
      return { ...hit.body, cached: true };
    }
    const body = await service.getCounts(roleId, version === "" ? null : version);
    const stored = { ...body, cached: false };
    const canonical = `${body.roleId}:v${body.version}`;
    const entry = { at: Date.now(), body: stored };
    cache.set(cacheKey, entry);
    cache.set(canonical, entry);
    return stored;
  }

  router.get("/roadmaps", handle(async (_req, res) => {
    res.json(service.publicCatalog());
  }));

  router.get("/roadmaps/:roleId/counts", handle(async (req, res) => {
    try {
      const version = req.query.version == null ? null : req.query.version;
      res.json(await readCounts(req.params.roleId, version));
    } catch (err) {
      if (err instanceof RoadmapError && err.status === 404) throw err;
      console.error("roadmap counts unavailable");
      res.status(503).json({
        ok: false,
        unavailable: true,
        code: "counts_unavailable",
        error: "Counts unavailable",
      });
    }
  }));

  router.get("/roadmaps/:roleId", handle(async (req, res) => {
    const version = req.query.version == null || req.query.version === "" ? null : req.query.version;
    res.json(service.publicRole(req.params.roleId, version));
  }));

  router.get("/me/roadmap", requireStudent, handle(async (req, res) => {
    res.json(await service.getOwnerState(req.student.uid));
  }));

  router.post("/me/roadmap/start", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    const roleId = String(req.body?.roleId || learner.selectedRole?.id || "").trim();
    if (!learner.selectedRole || learner.selectedRole.id !== roleId) {
      throw new RoadmapError(400, "role_not_selected", "Choose this role before starting its trail.");
    }
    const explicitVersion = req.body?.version != null && req.body.version !== "";
    const result = await service.activate({
      uid: learner.uid,
      roleId,
      version: explicitVersion ? req.body.version : null,
      explicitVersion,
      excluded: learner.excluded === true,
      opId: req.body?.opId,
    });
    bust(result.countKeys);
    res.json(result);
  }));

  router.post("/me/roadmap/switch", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    const roleId = String(req.body?.roleId || "").trim();
    const match = (learner.roles || []).find((role) => role && role.id === roleId);
    if (!match) {
      throw new RoadmapError(400, "role_not_suggested", "Choose one of the roles from your quiz result.");
    }
    const explicitVersion = req.body?.version != null && req.body.version !== "";
    const result = await service.activate({
      uid: learner.uid,
      roleId,
      version: explicitVersion ? req.body.version : null,
      explicitVersion,
      excluded: learner.excluded === true,
      opId: req.body?.opId,
    });
    const selectedRole = {
      id: match.id,
      name: match.name || match.id,
      key: match.key || "",
      score: Number(match.score) || 0,
      animal: AVATARS[match.id] || "",
    };
    await touchUser(learner.uid, { selectedRole });
    bust(result.countKeys);
    res.json({ ...result, selectedRole });
  }));

  router.post("/me/roadmap/checklist", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    res.json(
      await service.saveChecklist({
        uid: learner.uid,
        roleId: req.body?.roleId,
        version: req.body?.version,
        stepId: req.body?.stepId,
        checklist: req.body?.checklist,
        expectedRevision: req.body?.expectedRevision,
        opId: req.body?.opId,
      })
    );
  }));

  router.post("/me/roadmap/complete", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    const result = await service.complete({
      uid: learner.uid,
      roleId: req.body?.roleId,
      version: req.body?.version,
      stepId: req.body?.stepId,
      checklist: req.body?.checklist,
      expectedRevision: req.body?.expectedRevision,
      opId: req.body?.opId,
    });
    bust(result.countKeys);
    res.json(result);
  }));

  router.post("/me/roadmap/undo", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    const result = await service.undo({
      uid: learner.uid,
      roleId: req.body?.roleId,
      version: req.body?.version,
      stepId: req.body?.stepId,
      expectedRevision: req.body?.expectedRevision,
      opId: req.body?.opId,
    });
    bust(result.countKeys);
    res.json(result);
  }));

  router.post("/me/roadmap/notes", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    res.json(
      await service.saveNotes({
        uid: learner.uid,
        roleId: req.body?.roleId,
        version: req.body?.version,
        stepId: req.body?.stepId,
        text: req.body?.text,
        evidence: req.body?.evidence,
        expectedRevision: req.body?.expectedRevision,
        opId: req.body?.opId,
      })
    );
  }));

  router.post("/me/roadmap/restart", requireStudent, handle(async (req, res) => {
    const learner = await resolveLearner(req);
    const result = await service.restart({
      uid: learner.uid,
      roleId: req.body?.roleId,
      version: req.body?.version,
      expectedRevision: req.body?.expectedRevision,
      opId: req.body?.opId,
    });
    bust(result.countKeys);
    res.json(result);
  }));

  router.get("/admin/roadmaps", requireAdmin, handle(async (_req, res) => {
    const catalog = service.publicCatalog();
    res.json({
      ok: true,
      contentVersion: catalog.contentVersion,
      status: catalog.status,
      editorialStatus: service.catalog.editorialStatus,
      noteAccess: "Content admin cannot read student notes, evidence, or private progress.",
      roles: catalog.roles,
    });
  }));

  router.get("/admin/roadmaps/learners", requireAdmin, handle(async (_req, res) => {
    const board = await service.learnerBoard();
    if (typeof loadProfiles === "function") {
      const profiles = await loadProfiles(board.learners.map((row) => row.uid));
      for (const row of board.learners) {
        const profile = profiles?.[row.uid] || {};
        row.displayName = profile.displayName || "";
        row.email = profile.email || "";
        row.collegeId = profile.collegeId || "";
      }
    }
    res.json(board);
  }));

  router.get("/admin/users/:uid/roadmap", requireAdmin, handle(async (req, res) => {
    const uid = String(req.params.uid || "").trim();
    if (!uid) throw new RoadmapError(400, "uid_required", "User id required.");
    res.json(await service.learnerSummary(uid));
  }));

  router.get("/admin/roadmaps/editor/:roleId", requireAdmin, handle(async (req, res) => {
    res.json(service.editorFor(req.params.roleId));
  }));

  router.put("/admin/roadmaps/editor/:roleId", requireAdmin, handle(async (req, res) => {
    res.json(await service.saveDraft(req.params.roleId, req.body?.role));
  }));

  router.post("/admin/roadmaps/editor/:roleId/publish", requireAdmin, handle(async (req, res) => {
    const result = await service.publish(req.params.roleId, req.body?.role, req.body?.asNewVersion === true);
    bust();
    res.json(result);
  }));

  router.post("/admin/roadmaps/reconcile", requireAdmin, handle(async (_req, res) => {
    const result = await service.reconcile();
    bust();
    if (result.repaired.length) console.error("roadmap count drift repaired", result.repaired.join(","));
    res.json(result);
  }));

  router.put("/admin/users/:uid/roadmap-exclusion", requireAdmin, handle(async (req, res) => {
    if (req.body?.excluded !== true && req.body?.excluded !== false) {
      throw new RoadmapError(400, "exclusion_invalid", "excluded must be true or false.");
    }
    const excluded = req.body.excluded === true;
    await touchUser(req.params.uid, { roadmapCountExcluded: excluded });
    const result = await service.setExcluded(req.params.uid, excluded);
    bust(result.countKeys);
    res.json(result);
  }));

  router.delete("/admin/users/:uid/roadmap", requireAdmin, handle(async (req, res) => {
    const result = await service.eraseLearner(req.params.uid);
    bust(result.countKeys);
    res.json(result);
  }));

  return router;
}

function createProductionRouter({ db, users, admins, bootstrapEmails, requireStudent, requireAdmin }) {
  const raw = readSeed();
  const catalog = loadSeed();
  const service = new RoadmapService({ store: new FirestoreStore(db), catalog, raw });

  async function resolveLearner(req) {
    const snap = await users.doc(req.student.uid).get();
    const data = snap.exists ? snap.data() || {} : {};
    const email = (req.student.email || "").toLowerCase();
    let excluded = data.roadmapCountExcluded === true;
    if (!excluded && bootstrapEmails.has(email)) excluded = true;
    if (!excluded && email) {
      const adminSnap = await admins.doc(email).get();
      if (adminSnap.exists) excluded = true;
    }
    return {
      uid: req.student.uid,
      email,
      roles: Array.isArray(data.roles) ? data.roles : [],
      selectedRole: data.selectedRole || null,
      scores: data.scores || null,
      excluded,
    };
  }

  async function touchUser(uid, patch) {
    await users.doc(uid).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  async function loadProfiles(uids) {
    const unique = [...new Set(uids)].slice(0, 200);
    const snaps = await Promise.all(unique.map((uid) => users.doc(uid).get()));
    const profiles = {};
    snaps.forEach((snap, index) => {
      const data = snap.exists ? snap.data() || {} : {};
      profiles[unique[index]] = {
        email: data.email || "",
        displayName: data.displayName || "",
        collegeId: data.collegeId || "",
      };
    });
    return profiles;
  }

  return createRouter({
    service,
    requireStudent,
    requireAdmin,
    resolveLearner,
    touchUser,
    loadProfiles,
  });
}

module.exports = { createRouter, createProductionRouter };
