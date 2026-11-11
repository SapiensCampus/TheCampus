"use strict";

const fs = require("fs");
const path = require("path");

/** Fixed discovery mascots. Avatar files are the supplied originals. */
const AVATARS = {
  builders: "Beaver",
  hackers: "Fox",
  creators: "Peacock",
  connectors: "Dolphin",
  leaders: "Wolf",
  planners: "Spider",
};

const AVATAR_FILES = {
  builders: "builders-beaver.svg",
  hackers: "hackers-fox.svg",
  creators: "creators-peacock.svg",
  connectors: "connectors-dolphin.svg",
  leaders: "leaders-wolf.svg",
  planners: "planners-spider.svg",
};

const MAX_STEPS = 40;
const MIN_ESTIMATE = 5;
const UNIT_KINDS = ["try", "careers", "skill"];
const MAX_ESTIMATE = 75;

function push(errors, message) {
  errors.push(message);
}

function isHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch (_err) {
    return false;
  }
}

/**
 * Validate authored roadmap JSON and return a public catalog.
 * Shipping this file in source control publishes versioned trails.
 * The seed's editorial status is preserved separately from `status`.
 */
function validateContent(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.roles)) {
    return { ok: false, errors: ["Roadmap content must include a roles array."], catalog: null };
  }

  const seenIds = new Set();
  const byRole = {};

  raw.roles.forEach((role, roleIndex) => {
    const where = `roles[${roleIndex}]`;
    const id = role && role.id;
    if (!AVATARS[id]) {
      push(errors, `${where} has unknown role id "${id}"`);
      return;
    }
    if (role.avatar !== AVATARS[id]) {
      push(errors, `${where} avatar must be ${AVATARS[id]}`);
    }
    const version = Number(role.version);
    if (!Number.isInteger(version) || version < 1) {
      push(errors, `${where} version must be a positive integer`);
    }
    if (!role.title || !role.description) {
      push(errors, `${where} needs a title and description`);
    }
    if (!Array.isArray(role.steps) || role.steps.length < 1 || role.steps.length > MAX_STEPS) {
      push(errors, `${where} must have 1–${MAX_STEPS} steps`);
      return;
    }

    // Schema v2 (optional): units group steps into a path; careers feed the careers screen.
    const rawUnits = Array.isArray(role.units) ? role.units : [];
    const unitIds = new Set();
    const units = rawUnits.map((unit, unitIndex) => {
      const ua = `${where}.units[${unitIndex}]`;
      if (!unit || !/^[a-z0-9-]{2,40}$/.test(unit.id || "") || unitIds.has(unit.id)) {
        push(errors, `${ua} needs a unique id`);
        return null;
      }
      unitIds.add(unit.id);
      if (!UNIT_KINDS.includes(unit.kind)) push(errors, `${ua} kind must be one of ${UNIT_KINDS.join(", ")}`);
      if (!unit.title || !String(unit.title).trim()) push(errors, `${ua} needs a title`);
      return {
        id: unit.id,
        kind: unit.kind,
        title: String(unit.title || "").trim(),
        skill: String(unit.skill || "").trim(),
      };
    });
    if (units.length && units.filter((u) => u && u.kind === "try").length !== 1) {
      push(errors, `${where} needs exactly one "try" unit`);
    }
    const careers = (Array.isArray(role.careers) ? role.careers : []).map((career, careerIndex) => {
      const ca = `${where}.careers[${careerIndex}]`;
      if (!career || !/^[a-z0-9-]{2,60}$/.test(career.id || "") || !career.title || !career.blurb) {
        push(errors, `${ca} needs an id, title and blurb`);
        return null;
      }
      return {
        id: career.id,
        title: String(career.title).trim(),
        tag: career.tag === "pays" ? "pays" : "interesting",
        blurb: String(career.blurb).trim(),
        dayInLife: String(career.dayInLife || "").trim(),
        skills: (Array.isArray(career.skills) ? career.skills : []).map((s) => String(s).trim()).filter(Boolean),
        profiles: Array.isArray(career.profiles) ? career.profiles : [],
      };
    });

    const orders = new Set();
    const steps = role.steps.map((step, stepIndex) => {
      const at = `${where}.steps[${stepIndex}]`;
      if (!step || typeof step !== "object") {
        push(errors, `${at} is missing`);
        return null;
      }
      if (!step.id || typeof step.id !== "string" || !/^[a-z0-9-]{4,80}$/.test(step.id)) {
        push(errors, `${at} has an invalid id`);
      } else if (seenIds.has(step.id)) {
        push(errors, `${at} duplicates step id ${step.id}`);
      } else {
        seenIds.add(step.id);
      }
      if (step.role !== id) push(errors, `${at} role does not match ${id}`);
      if (units.length) {
        const unit = units.find((u) => u && u.id === step.unit);
        if (!unit || unit.kind === "careers") push(errors, `${at} needs a "try" or "skill" unit`);
      }
      if (Number(step.version) !== version) push(errors, `${at} version does not match the trail`);
      const order = Number(step.order);
      if (!Number.isInteger(order) || order < 1 || order > role.steps.length) {
        push(errors, `${at} order is out of range`);
      } else if (orders.has(order)) {
        push(errors, `${at} duplicates order ${order}`);
      } else {
        orders.add(order);
      }
      const estimate = Number(step.estimateMinutes);
      if (!Number.isInteger(estimate) || estimate < MIN_ESTIMATE || estimate > MAX_ESTIMATE) {
        push(errors, `${at} estimate must be an integer from ${MIN_ESTIMATE} to ${MAX_ESTIMATE} minutes`);
      }
      for (const field of ["type", "title", "goal", "task", "requiredOutput", "fallback"]) {
        if (!step[field] || !String(step[field]).trim()) push(errors, `${at} is missing ${field}`);
      }
      if (!Array.isArray(step.doneChecklist) || step.doneChecklist.length < 2) {
        push(errors, `${at} needs at least two checklist items`);
      } else if (step.doneChecklist.some((item) => !item || !String(item).trim())) {
        push(errors, `${at} has an empty checklist item`);
      }
      const resource = step.primaryResource || {};
      if (!resource.title || !resource.publisher || !resource.slice || !resource.accessNote) {
        push(errors, `${at} resource is missing title, publisher, slice, or access note`);
      }
      if (!isHttps(resource.url)) {
        push(errors, `${at} resource URL must be https with no credentials`);
      }
      const links = Array.isArray(step.links) ? step.links : [];
      if (links.length > 2) push(errors, `${at} can have at most two extra links`);
      const normalizedLinks = links.map((link, linkIndex) => {
        const linkAt = `${at}.links[${linkIndex}]`;
        if (!link || typeof link !== "object") {
          push(errors, `${linkAt} is missing`);
          return null;
        }
        if (link.kind !== "article" && link.kind !== "video") {
          push(errors, `${linkAt} kind must be article or video`);
        }
        if (!link.title || !link.publisher) {
          push(errors, `${linkAt} needs a title and publisher`);
        }
        if (!isHttps(link.url)) {
          push(errors, `${linkAt} URL must be https with no credentials`);
        }
        return {
          kind: link.kind === "video" ? "video" : "article",
          publisher: String(link.publisher || "").trim(),
          title: String(link.title || "").trim(),
          url: String(link.url || "").trim(),
          slice: String(link.slice || "").trim(),
        };
      });
      const section = String(step.section || "").trim();
      if (section.length > 24) push(errors, `${at} section name is too long`);
      if (!step) return null;
      return {
        id: step.id,
        order,
        unit: String(step.unit || ""),
        section: section || "Trail",
        type: String(step.type || "").trim(),
        title: String(step.title || "").trim(),
        goal: String(step.goal || "").trim(),
        estimateMinutes: estimate,
        estimateLabel:
          step.estimateLabel ||
          "Estimated active time including the selected resource slice; flexible, not a deadline",
        task: String(step.task || "").trim(),
        requiredOutput: String(step.requiredOutput || "").trim(),
        checklist: Array.isArray(step.doneChecklist)
          ? step.doneChecklist.map((item) => String(item).trim())
          : [],
        resource: {
          publisher: String(resource.publisher || "").trim(),
          title: String(resource.title || "").trim(),
          url: String(resource.url || "").trim(),
          slice: String(resource.slice || "").trim(),
          accessNote: String(resource.accessNote || "").trim(),
        },
        links: normalizedLinks.filter(Boolean),
        fallback: String(step.fallback || "").trim(),
        completionNote:
          step.completion || "Self-attested checklist. This is your own record, not a graded pass.",
      };
    });

    for (let n = 1; n <= role.steps.length; n += 1) {
      if (!orders.has(n)) push(errors, `${where} is missing step order ${n}`);
    }

    const normalized = {
      id,
      title: String(role.title || id).trim(),
      avatar: AVATARS[id],
      avatarFile: AVATAR_FILES[id],
      version,
      description: String(role.description || "").trim(),
      units: units.filter(Boolean),
      careers: careers.filter(Boolean),
      steps: steps.filter(Boolean).sort((a, b) => a.order - b.order),
    };
    byRole[id] = byRole[id] || {};
    if (byRole[id][version]) push(errors, `${id} version ${version} is duplicated`);
    byRole[id][version] = normalized;
  });

  for (const id of Object.keys(AVATARS)) {
    if (!byRole[id] || !Object.keys(byRole[id]).length) {
      push(errors, `missing trail for ${id}`);
    }
  }

  if (errors.length) return { ok: false, errors, catalog: null };

  const roles = [];
  for (const id of Object.keys(AVATARS)) {
    for (const version of Object.keys(byRole[id])
      .map(Number)
      .sort((a, b) => a - b)) {
      roles.push(byRole[id][version]);
    }
  }

  return {
    ok: true,
    errors: [],
    catalog: {
      contentVersion: String(raw.contentVersion || "unpublished"),
      checkedDate: raw.checkedDate || null,
      editorialStatus: raw.status || null,
      status: "published",
      audience: raw.audience || "",
      unlockPolicy: raw.unlockPolicy || "Prior steps complete; the next step unlocks immediately.",
      resourceNote:
        "Links were checked before publish. Videos were not watched; only the named section is assigned. If a link will not load, the task in this step is enough.",
      countDisclosure:
        "Anonymous totals for learners enrolled on this version of the trail. A step is self-marked, not a verified skill or a sign someone is online. Totals can fall after an undo, restart, or role change, and may lag briefly. Small groups can sometimes be guessed; this is not a promise of anonymity.",
      roles,
    },
  };
}

function readSeed(file = path.join(__dirname, "..", "data", "roadmap-content.json")) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadSeed(file = path.join(__dirname, "..", "data", "roadmap-content.json")) {
  const raw = readSeed(file);
  const result = validateContent(raw);
  if (!result.ok) {
    const error = new Error(`Roadmap seed is invalid:\n${result.errors.join("\n")}`);
    error.errors = result.errors;
    throw error;
  }
  return result.catalog;
}

function indexCatalog(catalog) {
  const byRole = new Map();
  for (const role of catalog.roles) {
    if (!byRole.has(role.id)) byRole.set(role.id, new Map());
    byRole.get(role.id).set(role.version, role);
  }
  return byRole;
}

module.exports = {
  AVATARS,
  AVATAR_FILES,
  MAX_STEPS,
  MIN_ESTIMATE,
  MAX_ESTIMATE,
  validateContent,
  readSeed,
  loadSeed,
  indexCatalog,
};
