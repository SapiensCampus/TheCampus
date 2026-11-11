"use strict";

const express = require("express");
const { SocialError } = require("./service");

/** Student-only endpoints. `resolveLearner(req)` must give uid, displayName, collegeId, roleId. */
function createSocialRouter({ social, requireStudent, resolveLearner }) {
  const router = express.Router();

  function handle(fn) {
    return async (req, res) => {
      try {
        const who = await resolveLearner(req);
        await fn(req, res, who);
      } catch (err) {
        if (err instanceof SocialError) {
          return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
        }
        console.error("social request failed");
        return res.status(500).json({ ok: false, code: "server_error", error: "Something went wrong." });
      }
    };
  }

  router.get("/me/social", requireStudent, handle(async (_req, res, who) => {
    res.json({ ok: true, me: await social.me(who), counts: await social.followCounts(who) });
  }));

  router.post("/me/social/visibility", requireStudent, handle(async (req, res, who) => {
    res.json({ ok: true, me: await social.setVisible(who, req.body?.visible) });
  }));

  router.post("/me/social/chest", requireStudent, handle(async (_req, res, who) => {
    res.json({ ok: true, me: await social.claimChest(who) });
  }));

  router.get("/league", requireStudent, handle(async (req, res, who) => {
    const scope = ["college", "campus", "friends"].includes(req.query.scope) ? req.query.scope : "college";
    res.json({ ok: true, ...(await social.league(who, scope)) });
  }));

  router.get("/classmates", requireStudent, handle(async (req, res, who) => {
    res.json({ ok: true, students: await social.classmates(who, req.query.q) });
  }));

  router.post("/follow", requireStudent, handle(async (req, res, who) => {
    res.json(await social.follow(who, req.body?.uid, true));
  }));

  router.post("/unfollow", requireStudent, handle(async (req, res, who) => {
    res.json(await social.follow(who, req.body?.uid, false));
  }));

  router.get("/users/:uid/public", requireStudent, handle(async (req, res, who) => {
    res.json({ ok: true, student: await social.publicProfile(who, req.params.uid) });
  }));

  return router;
}

module.exports = { createSocialRouter };
