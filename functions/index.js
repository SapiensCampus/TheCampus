const fs = require("fs");
const path = require("path");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const express = require("express");
const cors = require("cors");

setGlobalOptions({ region: "asia-south1" });

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const auth = getAuth();
const app = express();
const router = express.Router();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const QUESTIONS = db.collection("questions");
const QUIZ_META = db.collection("quizMeta").doc("config");
const WAITLIST = db.collection("waitlist");
const ADMINS = db.collection("admins");
const INVITE_CODES = db.collection("inviteCodes");
const COLLEGES = db.collection("colleges");
const DEPARTMENTS = db.collection("departments");
const USERS = db.collection("users");
/** Always-allowed admin Google accounts (in addition to Firestore `admins`). */
const BOOTSTRAP_ADMIN_EMAILS = new Set(["sapienscampus@gmail.com"]);

/** Short TTL cache for hot public reads (questions / colleges / college stats). */
const PUBLIC_READ_TTL_MS = 60_000;
const STATS_READ_TTL_MS = 30_000;
const publicReadCache = new Map();
let questionsSeeded = false;

function getPublicCache(key, ttlMs = PUBLIC_READ_TTL_MS) {
  const hit = publicReadCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return null;
}

function setPublicCache(key, value) {
  publicReadCache.set(key, { at: Date.now(), value });
  return value;
}

function bustPublicCache(...keys) {
  if (!keys.length) {
    publicReadCache.clear();
    return;
  }
  for (const key of keys) publicReadCache.delete(key);
}

function clampPageSize(raw, { fallback = 25, max = 50 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

const DEFAULT_ROLE_MAP = {
  R: {
    id: "builders",
    name: "Builders",
    color: "mint",
    icon: "hammer",
    blurb: "You like making things real — shipping, prototyping, solving with your hands and head.",
    careers: [
      { title: "Developer", tag: "pays" },
      { title: "Product manager", tag: "interesting" },
    ],
    skills: ["Coding", "Prototyping", "Product thinking", "Problem-solving"],
  },
  I: {
    id: "hackers",
    name: "Hackers",
    color: "sky",
    icon: "search",
    blurb: "You dig into puzzles — why things break, how systems work, what the data is saying.",
    careers: [
      { title: "Cybersecurity", tag: "pays" },
      { title: "Researcher", tag: "interesting" },
    ],
    skills: ["Security fundamentals", "Testing & debugging", "Research", "Analytical thinking"],
  },
  A: {
    id: "creators",
    name: "Creators",
    color: "lilac",
    icon: "brush",
    blurb: "You shape how things look and feel — stories, interfaces, and experiences people remember.",
    careers: [
      { title: "UI/UX designer", tag: "pays" },
      { title: "Social media content", tag: "interesting" },
    ],
    skills: ["User research", "Wireframing", "Design philosophies", "Prototyping"],
  },
  S: {
    id: "connectors",
    name: "Connectors",
    color: "yellove",
    icon: "people",
    blurb: "You bring people together — listening, storytelling, and making rooms feel alive.",
    careers: [
      { title: "Public speaker", tag: "interesting" },
      { title: "Community lead / Influencer", tag: "pays" },
    ],
    skills: ["Communication", "Storytelling", "Facilitation", "Community building"],
  },
  E: {
    id: "leaders",
    name: "Leaders",
    color: "peach",
    icon: "flag",
    blurb: "You spot openings and move people toward them — pitching, deciding, starting.",
    careers: [
      { title: "Business development", tag: "pays" },
      { title: "Founder", tag: "interesting" },
    ],
    skills: ["Opportunity spotting", "Pitching", "Decision-making", "Negotiation"],
  },
  C: {
    id: "planners",
    name: "Planners",
    color: "mint",
    icon: "checklist",
    blurb: "You turn chaos into clarity — plans, processes, budgets, and guardrails that let teams move.",
    careers: [
      { title: "Project manager", tag: "pays" },
      { title: "Risk & AI governance", tag: "interesting" },
    ],
    skills: ["Planning & organization", "Budgeting", "Process design", "Risk assessment", "AI guardrails"],
  },
};

const DEFAULT_BOOSTS = [
  {
    id: "welcome",
    title: "You’re in.",
    body: "Discovery here is inspired by Ikigai — the sweet spot where what you love, what you’re good at, what the world needs, and what can pay you start to overlap. Today we start with what pulls you.",
  },
  {
    id: "ikigai-intro",
    title: "How this works",
    body: "Ikigai trivia: the word means ‘reason for being.’ You don’t need a perfect answer yet — just honest gut reactions. We’ll turn those into roles you can grow into.",
  },
  {
    id: "mid-1",
    title: "Nice pace.",
    body: "Trivia: people who explore interests early often find ‘paid work they enjoy’ faster — not because they pick once, but because they sample more.",
  },
  {
    id: "mid-2",
    title: "Halfway energy",
    body: "You’re mapping curiosity, not talent. Ikigai grows when you try tiny experiments — the quiz is your first map.",
  },
  {
    id: "mid-3",
    title: "Keep going",
    body: "Trivia: ‘maybe’ is data. Soft yeses often point to skills you can grow into paid roles.",
  },
  {
    id: "mid-4",
    title: "Almost there",
    body: "Your mix will become Builders, Hackers, Creators, Connectors, Leaders, or Planners — campus roles, not alphabet soup.",
  },
  {
    id: "mid-5",
    title: "Last stretch",
    body: "One more round. Then roles, careers that pay, interesting paths, and a peer group waiting on WhatsApp.",
  },
];

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Normalize to 10-digit Indian mobile; returns null if invalid. */
function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D/g, "");
  let mobile = digits;
  if (mobile.length === 12 && mobile.startsWith("91")) {
    mobile = mobile.slice(2);
  } else if (mobile.length === 11 && mobile.startsWith("0")) {
    mobile = mobile.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(mobile)) return null;
  return mobile;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function normalizeInviteCode(input = {}, existingCode) {
  const code = String(input.code || existingCode || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!code || code.length < 3) {
    throw Object.assign(new Error("Invite code must be at least 3 characters"), { status: 400 });
  }
  const maxLimit = Number(input.maxLimit);
  if (!Number.isFinite(maxLimit) || maxLimit < 1) {
    throw Object.assign(new Error("maxLimit must be a positive number"), { status: 400 });
  }
  return {
    code,
    label: String(input.label || "").trim(),
    maxLimit: Math.floor(maxLimit),
    consumption: Number.isFinite(Number(input.consumption))
      ? Math.max(0, Math.floor(Number(input.consumption)))
      : 0,
    active: input.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function normalizeCollege(input = {}, existingId) {
  const name = String(input.name || "").trim();
  if (!name) throw Object.assign(new Error("College name is required"), { status: 400 });
  const id = String(input.id || existingId || slugify(name)).trim();
  if (!id) throw Object.assign(new Error("College id is required"), { status: 400 });
  return {
    id,
    name,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    active: input.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function normalizeDepartment(input = {}, existingId) {
  const name = String(input.name || "").trim();
  if (!name) throw Object.assign(new Error("Department name is required"), { status: 400 });
  const id = String(input.id || existingId || slugify(name)).trim();
  if (!id) throw Object.assign(new Error("Department id is required"), { status: 400 });
  return {
    id,
    name,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    active: input.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function requireStudent(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Missing bearer token" });
    }
    const decoded = await auth.verifyIdToken(match[1]);
    req.student = {
      uid: decoded.uid,
      email: (decoded.email || "").toLowerCase(),
      name: decoded.name || "",
    };
    return next();
  } catch (_err) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

async function ensureDiscoveryMeta(meta = {}) {
  const patch = {};
  if (!meta.roleMap || typeof meta.roleMap !== "object" || !Object.keys(meta.roleMap).length) {
    patch.roleMap = DEFAULT_ROLE_MAP;
  }
  if (!Array.isArray(meta.boosts) || !meta.boosts.length) {
    patch.boosts = DEFAULT_BOOSTS;
  }
  if (meta.whatsappUrl === undefined) {
    patch.whatsappUrl = meta.whatsappUrl || "";
  }
  if (Object.keys(patch).length) {
    await QUIZ_META.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...meta, ...patch };
  }
  return meta;
}

function normalizeQuestion(input = {}, existingId) {
  const id = String(input.id || existingId || "").trim();
  if (!id) throw Object.assign(new Error("Question id is required"), { status: 400 });
  if (!input.area || !/^[RIASEC]$/.test(input.area)) {
    throw Object.assign(new Error("area must be one of R,I,A,S,E,C"), { status: 400 });
  }
  if (!input.title || !String(input.title).trim()) {
    throw Object.assign(new Error("title is required"), { status: 400 });
  }
  return {
    id,
    area: input.area,
    title: String(input.title).trim(),
    cue: String(input.cue || "").trim(),
    icon: String(input.icon || "spark").trim(),
    scene: String(input.scene || "").trim(),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    active: input.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function packFromDocs(meta, questions) {
  return {
    version: meta?.version || "sc-discovery-1",
    areas: meta?.areas || {},
    pairs: meta?.pairs || {},
    anchors: meta?.anchors || [
      { value: 0, label: "Not for me", detail: "I would pass", face: "pass", color: "pink" },
      { value: 1, label: "Maybe", detail: "Open to trying", face: "maybe", color: "paper" },
      { value: 2, label: "I’d love it", detail: "Count me in", face: "love", color: "green" },
    ],
    roleMap: meta?.roleMap && Object.keys(meta.roleMap).length ? meta.roleMap : DEFAULT_ROLE_MAP,
    boosts: Array.isArray(meta?.boosts) && meta.boosts.length ? meta.boosts : DEFAULT_BOOSTS,
    whatsappUrl: String(meta?.whatsappUrl || ""),
    questions: questions
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
  };
}

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Missing bearer token" });
    }
    const decoded = await auth.verifyIdToken(match[1]);
    const email = (decoded.email || "").toLowerCase();
    if (!email) {
      return res.status(403).json({ ok: false, error: "Admin email required" });
    }
    const allowlisted =
      BOOTSTRAP_ADMIN_EMAILS.has(email) || (await ADMINS.doc(email).get()).exists;
    if (!allowlisted) {
      return res.status(403).json({ ok: false, error: "Not an admin" });
    }
    req.admin = { uid: decoded.uid, email };
    return next();
  } catch (_err) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

async function seedFromTemplateIfEmpty() {
  if (questionsSeeded) return false;
  const existing = await QUESTIONS.limit(1).get();
  if (!existing.empty) {
    questionsSeeded = true;
    return false;
  }

  const packPath = path.join(__dirname, "data", "questions.template.json");
  const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
  const batch = db.batch();

  batch.set(
    QUIZ_META,
    {
      version: pack.version,
      areas: pack.areas,
      pairs: pack.pairs,
      anchors: pack.anchors,
      roleMap: DEFAULT_ROLE_MAP,
      boosts: DEFAULT_BOOSTS,
      whatsappUrl: "",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  pack.questions.forEach((q, index) => {
    batch.set(QUESTIONS.doc(q.id), {
      ...q,
      sortOrder: q.sortOrder ?? index,
      active: q.active !== false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const adminEmail = "sapienscampus@gmail.com";
  batch.set(ADMINS.doc(adminEmail), {
    email: adminEmail,
    role: "admin",
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  questionsSeeded = true;
  bustPublicCache("questions");
  return true;
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sapienscampus-api" });
});

router.get("/questions", async (_req, res) => {
  try {
    const cached = getPublicCache("questions");
    if (cached) {
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(cached);
    }
    await seedFromTemplateIfEmpty();
    const [metaSnap, questionSnap] = await Promise.all([
      QUIZ_META.get(),
      QUESTIONS.where("active", "==", true).get(),
    ]);
    const meta = await ensureDiscoveryMeta(metaSnap.data() || {});
    const pack = packFromDocs(meta, questionSnap.docs);
    if (!pack.questions.length) {
      return res.status(503).json({ ok: false, error: "Questions are not seeded yet" });
    }
    const body = {
      ok: true,
      version: pack.version,
      areas: pack.areas,
      pairs: pack.pairs,
      anchors: pack.anchors,
      roleMap: pack.roleMap,
      boosts: pack.boosts,
      whatsappUrl: pack.whatsappUrl,
      questions: pack.questions.map(({ id, area, title, cue, icon, scene, sortOrder }) => ({
        id,
        area,
        title,
        cue,
        icon,
        scene,
        sortOrder,
      })),
    };
    setPublicCache("questions", body);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load questions" });
  }
});

router.post("/invites/check", async (req, res) => {
  try {
    const code = String(req.body?.code || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!code) {
      return res.status(400).json({ ok: false, error: "Invite code required" });
    }
    const snap = await INVITE_CODES.doc(code).get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "Invalid invite code" });
    }
    const data = snap.data();
    if (data.active === false) {
      return res.status(400).json({ ok: false, error: "This invite code is inactive" });
    }
    const consumption = Number(data.consumption) || 0;
    const maxLimit = Number(data.maxLimit) || 0;
    if (consumption >= maxLimit) {
      return res.status(400).json({ ok: false, error: "This invite code is fully used" });
    }
    res.json({
      ok: true,
      code,
      label: data.label || "",
      remaining: maxLimit - consumption,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to check invite" });
  }
});

router.get("/colleges", async (_req, res) => {
  try {
    const cached = getPublicCache("colleges");
    if (cached) {
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(cached);
    }
    const [collegeSnap, deptSnap, metaSnap] = await Promise.all([
      COLLEGES.get(),
      DEPARTMENTS.get(),
      QUIZ_META.get(),
    ]);
    const meta = await ensureDiscoveryMeta(metaSnap.data() || {});
    const departments = deptSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          sortOrder: data.sortOrder ?? 0,
          active: data.active !== false,
        };
      })
      .filter((d) => d.active)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    const colleges = collegeSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          sortOrder: data.sortOrder ?? 0,
          active: data.active !== false,
        };
      })
      .filter((c) => c.active)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));

    const body = {
      ok: true,
      colleges,
      departments,
      whatsappUrl: String(meta.whatsappUrl || ""),
    };
    setPublicCache("colleges", body);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to list colleges" });
  }
});

router.get("/colleges/:id/stats", async (req, res) => {
  try {
    const collegeId = String(req.params.id || "").trim();
    if (!collegeId) {
      return res.status(400).json({ ok: false, error: "College id required" });
    }
    const cacheKey = `college-stats:${collegeId}`;
    const cached = getPublicCache(cacheKey, STATS_READ_TTL_MS);
    if (cached) {
      res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      return res.json(cached);
    }
    const snap = await USERS.where("collegeId", "==", collegeId).count().get();
    const body = { ok: true, collegeId, signedUpCount: snap.data().count || 0 };
    setPublicCache(cacheKey, body);
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load college stats" });
  }
});

router.get("/me", requireStudent, async (req, res) => {
  try {
    const snap = await USERS.doc(req.student.uid).get();
    if (!snap.exists) {
      return res.json({ ok: true, user: null });
    }
    const data = snap.data();
    res.json({
      ok: true,
      user: {
        uid: snap.id,
        email: data.email || req.student.email,
        displayName: data.displayName || "",
        inviteCode: data.inviteCode || "",
        collegeId: data.collegeId || "",
        departmentId: data.departmentId || "",
        passoutYear: data.passoutYear || null,
        mobile: data.mobile || "",
        scores: data.scores || null,
        roles: data.roles || [],
        selectedRole: data.selectedRole || null,
        scores: data.scores || null,
        hasAnswers: Boolean(data.answers),
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load profile" });
  }
});

router.post("/me/profile", requireStudent, async (req, res) => {
  try {
    const inviteCode = String(req.body?.inviteCode || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const collegeId = String(req.body?.collegeId || "").trim();
    const departmentId = String(req.body?.departmentId || "").trim();
    const passoutYear = Number(req.body?.passoutYear);
    const displayName = String(req.body?.displayName || req.student.name || "").trim();
    const mobile = normalizeMobile(req.body?.mobile);

    if (!inviteCode) {
      return res.status(400).json({
        ok: false,
        error: "Invite code missing — enter the code you unlocked with",
        code: "invite_required",
      });
    }
    if (!collegeId) {
      return res.status(400).json({ ok: false, error: "College required", code: "college_required" });
    }
    if (!departmentId) {
      return res
        .status(400)
        .json({ ok: false, error: "Department required", code: "department_required" });
    }
    if (!Number.isFinite(passoutYear) || passoutYear < 2028 || passoutYear > 2040) {
      return res.status(400).json({
        ok: false,
        error: "Valid passout year required (2028+)",
        code: "passout_invalid",
      });
    }
    if (!mobile) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid 10-digit mobile number (same number used in campus WhatsApp)",
        code: "mobile_invalid",
      });
    }

    const [collegeSnap, deptSnap] = await Promise.all([
      COLLEGES.doc(collegeId).get(),
      DEPARTMENTS.doc(departmentId).get(),
    ]);
    if (!collegeSnap.exists || collegeSnap.data().active === false) {
      return res.status(400).json({ ok: false, error: "Unknown college", code: "college_unknown" });
    }
    if (!deptSnap.exists || deptSnap.data().active === false) {
      return res
        .status(400)
        .json({ ok: false, error: "Unknown department", code: "department_unknown" });
    }

    const userRef = USERS.doc(req.student.uid);
    const inviteRef = INVITE_CODES.doc(inviteCode);
    let prior = null;

    try {
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const inviteSnap = await tx.get(inviteRef);
        const existing = userSnap.exists ? userSnap.data() : null;
        prior = existing;
        const alreadyBound =
          existing?.inviteCode && String(existing.inviteCode).toUpperCase() === inviteCode;

        if (!alreadyBound) {
          if (!inviteSnap.exists) {
            const e = new Error("Invalid invite code — unlock again with a valid code");
            e.status = 404;
            e.code = "invite_invalid";
            throw e;
          }
          const invite = inviteSnap.data();
          if (invite.active === false) {
            const e = new Error("This invite code is inactive");
            e.status = 400;
            e.code = "invite_inactive";
            throw e;
          }
          const consumption = Number(invite.consumption) || 0;
          const maxLimit = Number(invite.maxLimit) || 0;
          if (consumption >= maxLimit) {
            const e = new Error("This invite code is fully used — ask for a new code");
            e.status = 400;
            e.code = "invite_exhausted";
            throw e;
          }
          tx.set(
            inviteRef,
            {
              consumption: consumption + 1,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        tx.set(
          userRef,
          {
            email: req.student.email || "",
            displayName,
            inviteCode,
            collegeId,
            departmentId,
            passoutYear: Math.floor(passoutYear),
            mobile,
            updatedAt: FieldValue.serverTimestamp(),
            ...(userSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true }
        );
      });
    } catch (txErr) {
      const status = txErr.status || 500;
      const message = txErr.message || "Failed to save profile";
      const code = txErr.code || "profile_save_failed";
      console.error("profile transaction failed", { status, code, message, inviteCode, collegeId });
      return res.status(status).json({ ok: false, error: message, code });
    }

    // Reuse transaction snapshot — no extra Firestore read.
    res.json({
      ok: true,
      user: {
        uid: req.student.uid,
        email: req.student.email || "",
        displayName,
        inviteCode,
        collegeId,
        departmentId,
        passoutYear: Math.floor(passoutYear),
        mobile,
        roles: prior?.roles || [],
        selectedRole: prior?.selectedRole || null,
        scores: prior?.scores || null,
        hasAnswers: Boolean(prior?.answers),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || "Failed to save profile",
      code: err.code || "profile_save_failed",
    });
  }
});

router.post("/me/discovery", requireStudent, async (req, res) => {
  try {
    const userRef = USERS.doc(req.student.uid);
    const existing = await userRef.get();
    if (!existing.exists || !existing.data().collegeId) {
      return res.status(400).json({
        ok: false,
        error: "Complete profile before saving discovery",
        code: "profile_incomplete",
      });
    }
    const existingData = existing.data() || {};

    const roles =
      Array.isArray(req.body?.roles) && req.body.roles.length
        ? req.body.roles
        : Array.isArray(existingData.roles)
          ? existingData.roles
          : [];
    const answers =
      req.body?.answers && typeof req.body.answers === "object"
        ? req.body.answers
        : existingData.answers || null;
    const scores =
      req.body?.scores && typeof req.body.scores === "object"
        ? req.body.scores
        : existingData.scores || null;
    const selectedRole = req.body?.selectedRole ?? null;

    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ ok: false, error: "answers required", code: "answers_required" });
    }
    if (!scores || typeof scores !== "object") {
      return res.status(400).json({ ok: false, error: "scores required", code: "scores_required" });
    }
    if (!roles.length) {
      return res.status(400).json({
        ok: false,
        error: "suggested roles required",
        code: "roles_required",
      });
    }

    let normalizedSelected = null;
    if (selectedRole && typeof selectedRole === "object") {
      const selectedId = String(selectedRole.id || "").trim();
      const match = roles.find((r) => r && String(r.id) === selectedId);
      if (!selectedId || !match) {
        return res.status(400).json({
          ok: false,
          error: "selectedRole must match one of the suggested roles",
          code: "selected_role_invalid",
        });
      }
      normalizedSelected = {
        id: match.id,
        name: match.name || selectedRole.name || "",
        key: match.key || selectedRole.key || "",
        score: Number(match.score) || Number(selectedRole.score) || 0,
        animal: String(selectedRole.animal || "").trim(),
      };
    }

    const payload = {
      answers,
      scores,
      roles,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (normalizedSelected) {
      payload.selectedRole = normalizedSelected;
    }

    await userRef.set(payload, { merge: true });
    res.json({ ok: true, selectedRole: normalizedSelected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to save discovery" });
  }
});

router.post("/waitlist", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const consent = Boolean(req.body?.consent);
    const company = String(req.body?.company || "").trim();
    const answers = req.body?.answers ?? null;
    const scores = req.body?.scores ?? null;

    if (company) {
      return res.status(200).json({ ok: true, status: "joined" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email" });
    }
    if (!consent) {
      return res.status(400).json({ ok: false, error: "Consent required" });
    }

    const existing = await WAITLIST.where("email", "==", email).limit(1).get();
    const normalizedAnswers = answers && typeof answers === "object" ? answers : null;
    const normalizedScores = scores && typeof scores === "object" ? scores : null;
    const payload = {
      email,
      consent: true,
      answers: normalizedAnswers,
      scores: normalizedScores,
      hasAnswers: Boolean(normalizedAnswers),
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (existing.empty) {
      await WAITLIST.add({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      await existing.docs[0].ref.set(payload, { merge: true });
    }

    res.json({ ok: true, status: "joined" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to join waitlist" });
  }
});

router.get("/admin/questions", requireAdmin, async (_req, res) => {
  try {
    const [metaSnap, questionSnap] = await Promise.all([
      QUIZ_META.get(),
      QUESTIONS.get(),
    ]);
    res.json({ ok: true, pack: packFromDocs(metaSnap.data(), questionSnap.docs) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to list questions" });
  }
});

router.post("/admin/questions", requireAdmin, async (req, res) => {
  try {
    const question = normalizeQuestion(req.body);
    const existing = await QUESTIONS.doc(question.id).get();
    if (!existing.exists) {
      const countSnap = await QUESTIONS.count().get();
      if (countSnap.data().count >= 90) {
        return res.status(400).json({
          ok: false,
          error: "Maximum limit of 90 questions reached. Delete questions before adding new ones.",
        });
      }
    }
    question.createdAt = FieldValue.serverTimestamp();
    await QUESTIONS.doc(question.id).set(question, { merge: true });
    bustPublicCache("questions");
    res.status(201).json({ ok: true, question });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Create failed" });
  }
});

router.put("/admin/questions/:id", requireAdmin, async (req, res) => {
  try {
    const question = normalizeQuestion({ ...req.body, id: req.params.id }, req.params.id);
    const ref = QUESTIONS.doc(question.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "Question not found" });
    }
    await ref.set(question, { merge: true });
    bustPublicCache("questions");
    res.json({ ok: true, question });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Update failed" });
  }
});

router.delete("/admin/questions/:id", requireAdmin, async (req, res) => {
  try {
    const ref = QUESTIONS.doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "Question not found" });
    }
    await ref.delete();
    bustPublicCache("questions");
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ ok: false, error: "Delete failed" });
  }
});

router.post("/admin/questions/batch-delete", requireAdmin, async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ ok: false, error: "ids array required" });
    }
    const chunks = [];
    for (let i = 0; i < ids.length; i += 400) {
      chunks.push(ids.slice(i, i + 400));
    }
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((id) => {
        batch.delete(QUESTIONS.doc(String(id)));
      });
      await batch.commit();
    }
    bustPublicCache("questions");
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Batch delete failed" });
  }
});

router.get("/admin/questions/export", requireAdmin, async (_req, res) => {
  try {
    const [metaSnap, questionSnap] = await Promise.all([
      QUIZ_META.get(),
      QUESTIONS.get(),
    ]);
    const pack = packFromDocs(metaSnap.data(), questionSnap.docs);
    res.json({
      ok: true,
      pack: {
        version: pack.version,
        areas: pack.areas,
        pairs: pack.pairs,
        anchors: pack.anchors,
        questions: pack.questions.map(
          ({ id, area, title, cue, icon, scene, sortOrder, active }) => ({
            id,
            area,
            title,
            cue,
            icon,
            scene,
            sortOrder,
            active: active !== false,
          })
        ),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Export failed" });
  }
});

router.post("/admin/questions/import", requireAdmin, async (req, res) => {
  try {
    const pack = req.body?.pack || req.body;
    const overwrite = req.body?.overwrite !== false;
    if (!pack || !Array.isArray(pack.questions)) {
      return res.status(400).json({ ok: false, error: "pack.questions array required" });
    }

    const existingSnap = await QUESTIONS.get();
    const existingDocs = new Map(existingSnap.docs.map((doc) => [doc.id, doc.data()]));

    // Start with existing questions in the database
    const resultMap = new Map();
    existingDocs.forEach((data, id) => {
      resultMap.set(id, { ...data, id });
    });

    // Merge/append imported questions
    for (let index = 0; index < pack.questions.length; index++) {
      const raw = pack.questions[index];
      const question = normalizeQuestion({
        ...raw,
        sortOrder: raw.sortOrder ?? index,
      });

      if (!resultMap.has(question.id) || overwrite) {
        resultMap.set(question.id, question);
      }
    }

    const resultingQuestions = Array.from(resultMap.values());

    // 1. Validate max 90 limit
    if (resultingQuestions.length > 90) {
      return res.status(400).json({
        ok: false,
        error: `Total questions cannot exceed 90 (currently at ${existingDocs.size}, resulting total would be ${resultingQuestions.length}). Please delete some questions first.`,
      });
    }

    // 2. Validate equal distribution across all 6 RIASEC types
    const counts = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    for (const q of resultingQuestions) {
      if (counts[q.area] === undefined) {
        return res.status(400).json({
          ok: false,
          error: `Invalid area "${q.area}" in question ${q.id}. Must be one of R, I, A, S, E, C.`,
        });
      }
      counts[q.area] += 1;
    }

    const countValues = Object.values(counts);
    const targetCount = countValues[0];
    const isBalanced = countValues.every((c) => c === targetCount);
    if (!isBalanced) {
      return res.status(400).json({
        ok: false,
        error: `All 6 RIASEC types must have an equal number of questions. Current resulting distribution: R: ${counts.R}, I: ${counts.I}, A: ${counts.A}, S: ${counts.S}, E: ${counts.E}, C: ${counts.C}. Every type must have the exact same count.`,
      });
    }

    const batch = db.batch();
    batch.set(
      QUIZ_META,
      {
        version: pack.version || "sc-discovery-1",
        areas: pack.areas || {},
        pairs: pack.pairs || {},
        anchors: pack.anchors || [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    resultingQuestions.forEach((q, index) => {
      q.sortOrder = q.sortOrder ?? index;
      q.updatedAt = FieldValue.serverTimestamp();
      if (!q.createdAt) {
        q.createdAt = FieldValue.serverTimestamp();
      }
      batch.set(QUESTIONS.doc(q.id), q);
    });

    await batch.commit();
    bustPublicCache("questions", "colleges");
    res.json({
      ok: true,
      imported: pack.questions.length,
      total: resultingQuestions.length,
      perType: targetCount,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ ok: false, error: err.message || "Import failed" });
  }
});

// --- Admin: invites ---
router.get("/admin/invites", requireAdmin, async (_req, res) => {
  try {
    const snap = await INVITE_CODES.get();
    const invites = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          code: doc.id,
          label: data.label || "",
          maxLimit: data.maxLimit || 0,
          consumption: data.consumption || 0,
          active: data.active !== false,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    res.json({ ok: true, invites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to list invites" });
  }
});

router.post("/admin/invites", requireAdmin, async (req, res) => {
  try {
    const invite = normalizeInviteCode(req.body);
    const ref = INVITE_CODES.doc(invite.code);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ ok: false, error: "Invite code already exists" });
    }
    await ref.set({
      ...invite,
      consumption: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ ok: true, invite: { ...invite, consumption: 0 } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Create failed" });
  }
});

router.put("/admin/invites/:code", requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || "")
      .trim()
      .toUpperCase();
    const ref = INVITE_CODES.doc(code);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    const current = existing.data();
    const invite = normalizeInviteCode(
      {
        ...req.body,
        code,
        consumption:
          req.body?.consumption !== undefined ? req.body.consumption : current.consumption,
      },
      code
    );
    await ref.set(invite, { merge: true });
    res.json({ ok: true, invite });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Update failed" });
  }
});

router.delete("/admin/invites/:code", requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || "")
      .trim()
      .toUpperCase();
    const ref = INVITE_CODES.doc(code);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "Invite not found" });
    }
    await ref.set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ ok: false, error: "Deactivate failed" });
  }
});

// --- Admin: colleges & departments ---
router.get("/admin/colleges", requireAdmin, async (_req, res) => {
  try {
    const [collegeSnap, deptSnap] = await Promise.all([COLLEGES.get(), DEPARTMENTS.get()]);
    const departments = deptSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          sortOrder: data.sortOrder ?? 0,
          active: data.active !== false,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      })
      .sort(
        (a, b) =>
          (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name).localeCompare(String(b.name))
      );
    const colleges = collegeSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          sortOrder: data.sortOrder ?? 0,
          active: data.active !== false,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      })
      .sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
      );
    res.json({ ok: true, colleges, departments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to list colleges" });
  }
});

router.post("/admin/colleges", requireAdmin, async (req, res) => {
  try {
    const college = normalizeCollege(req.body);
    const ref = COLLEGES.doc(college.id);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ ok: false, error: "College id already exists" });
    }
    await ref.set({ ...college, createdAt: FieldValue.serverTimestamp() });
    bustPublicCache("colleges");
    res.status(201).json({ ok: true, college });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Create failed" });
  }
});

router.put("/admin/colleges/:id", requireAdmin, async (req, res) => {
  try {
    const college = normalizeCollege({ ...req.body, id: req.params.id }, req.params.id);
    const ref = COLLEGES.doc(college.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "College not found" });
    }
    await ref.set(college, { merge: true });
    bustPublicCache("colleges");
    res.json({ ok: true, college });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Update failed" });
  }
});

router.post("/admin/departments", requireAdmin, async (req, res) => {
  try {
    const department = normalizeDepartment(req.body);
    const ref = DEPARTMENTS.doc(department.id);
    const existing = await ref.get();
    if (existing.exists) {
      return res.status(409).json({ ok: false, error: "Department id already exists" });
    }
    await ref.set({ ...department, createdAt: FieldValue.serverTimestamp() });
    bustPublicCache("colleges");
    res.status(201).json({ ok: true, department });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Create failed" });
  }
});

router.put("/admin/departments/:id", requireAdmin, async (req, res) => {
  try {
    const department = normalizeDepartment({ ...req.body, id: req.params.id }, req.params.id);
    const ref = DEPARTMENTS.doc(department.id);
    const existing = await ref.get();
    if (!existing.exists) {
      return res.status(404).json({ ok: false, error: "Department not found" });
    }
    await ref.set(department, { merge: true });
    bustPublicCache("colleges");
    res.json({ ok: true, department });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Update failed" });
  }
});

router.get("/admin/campus", requireAdmin, async (_req, res) => {
  try {
    const metaSnap = await QUIZ_META.get();
    const meta = await ensureDiscoveryMeta(metaSnap.data() || {});
    res.json({
      ok: true,
      campus: {
        whatsappUrl: String(meta.whatsappUrl || ""),
        boosts: meta.boosts || DEFAULT_BOOSTS,
        roleMap: meta.roleMap || DEFAULT_ROLE_MAP,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load campus config" });
  }
});

router.put("/admin/campus", requireAdmin, async (req, res) => {
  try {
    const whatsappUrl = String(req.body?.whatsappUrl || "").trim();
    const patch = {
      whatsappUrl,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (Array.isArray(req.body?.boosts)) {
      patch.boosts = req.body.boosts;
    }
    if (req.body?.roleMap && typeof req.body.roleMap === "object") {
      patch.roleMap = req.body.roleMap;
    }
    await QUIZ_META.set(patch, { merge: true });
    bustPublicCache("questions", "colleges");
    res.json({ ok: true, campus: { whatsappUrl, boosts: patch.boosts, roleMap: patch.roleMap } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to update campus config" });
  }
});

function serializeAdminUser(doc, names = {}) {
  const data = doc.data() || {};
  const collegeId = data.collegeId || "";
  const departmentId = data.departmentId || "";
  return {
    id: doc.id,
    email: data.email || "",
    displayName: data.displayName || "",
    collegeId,
    collegeName: names.colleges?.[collegeId] || "",
    departmentId,
    departmentName: names.departments?.[departmentId] || "",
    passoutYear: data.passoutYear || null,
    mobile: data.mobile || "",
    inviteCode: data.inviteCode || "",
    roles: Array.isArray(data.roles) ? data.roles : [],
    selectedRole: data.selectedRole || null,
    scores: data.scores && typeof data.scores === "object" ? data.scores : null,
    hasAnswers: Boolean(data.answers),
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
  };
}

async function resolveDirectoryNames(users) {
  const collegeIds = [...new Set(users.map((u) => u.collegeId).filter(Boolean))];
  const departmentIds = [...new Set(users.map((u) => u.departmentId).filter(Boolean))];
  const [collegeSnaps, deptSnaps] = await Promise.all([
    Promise.all(collegeIds.map((id) => COLLEGES.doc(id).get())),
    Promise.all(departmentIds.map((id) => DEPARTMENTS.doc(id).get())),
  ]);
  const colleges = {};
  collegeSnaps.forEach((snap, index) => {
    if (snap.exists) colleges[collegeIds[index]] = snap.data()?.name || collegeIds[index];
  });
  const departments = {};
  deptSnaps.forEach((snap, index) => {
    if (snap.exists) departments[departmentIds[index]] = snap.data()?.name || departmentIds[index];
  });
  return { colleges, departments };
}

router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const limit = clampPageSize(req.query.limit, { fallback: 25, max: 50 });
    const cursor = String(req.query.cursor || "").trim();
    let query = USERS.orderBy("createdAt", "desc").limit(limit);
    if (cursor) {
      const cursorSnap = await USERS.doc(cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    const [snap, totalSnap] = await Promise.all([query.get(), USERS.count().get()]);
    const bare = snap.docs.map((doc) => serializeAdminUser(doc));
    const names = await resolveDirectoryNames(bare);
    const users = snap.docs.map((doc) => serializeAdminUser(doc, names));
    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    res.json({
      ok: true,
      users,
      pageSize: limit,
      nextCursor,
      total: totalSnap.data().count || 0,
      withDiscoveryOnPage: users.filter((row) => row.hasAnswers).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to list users" });
  }
});

router.get("/admin/users/:uid", requireAdmin, async (req, res) => {
  try {
    const uid = String(req.params.uid || "").trim();
    if (!uid) {
      return res.status(400).json({ ok: false, error: "User id required" });
    }
    const snap = await USERS.doc(uid).get();
    if (!snap.exists) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    const bare = serializeAdminUser(snap);
    const names = await resolveDirectoryNames([bare]);
    const user = serializeAdminUser(snap, names);
    const answerKeys =
      snap.data()?.answers && typeof snap.data().answers === "object"
        ? Object.keys(snap.data().answers).length
        : 0;
    res.json({
      ok: true,
      user: {
        ...user,
        answerCount: answerKeys,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load user" });
  }
});

try {
  const { createProductionRouter } = require("./roadmap/routes");
  router.use(
    createProductionRouter({
      db,
      users: USERS,
      admins: ADMINS,
      bootstrapEmails: BOOTSTRAP_ADMIN_EMAILS,
      requireStudent,
      requireAdmin,
    })
  );
} catch (err) {
  console.error("roadmap routes unavailable", err && err.message ? err.message : "invalid seed");
}

app.use("/api", router);
app.use(router);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Server error" });
});

exports.api = onRequest(
  {
    region: "asia-south1",
    cors: true,
    invoker: "public",
  },
  app
);
