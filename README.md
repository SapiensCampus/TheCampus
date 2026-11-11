# SapiensCampus

**Discover yourself. Find your people.**

Monorepo for the SapiensCampus interest-discovery experience:

| App | Stack | Role |
|---|---|---|
| `web/` | Vite + React | Student quiz + waitlist signup |
| `admin/` | Vite + React + Google Sign-In | Manage questions & view waitlist (`sapienscampus.in@gmail.com`) |
| `functions/` | Firebase Functions (Express) | `/api/questions`, `/api/waitlist`, admin APIs |
| `shared/questions.template.json` | JSON | Import/export template for quiz content |

Firebase project: `sapienscampus-97b6a`

- Web hosting: https://sapienscampus-97b6a.web.app  
- Admin hosting: https://sapienscampus-admin.web.app  

Student web includes **Firebase Analytics** + **Performance Monitoring**. Key funnel events: `get_started_click`, `invite_unlocked`, `sign_in_google_*`, `profile_completed`, `quiz_started`, `quiz_milestone`, `quiz_completed`, `results_view`, `whatsapp_join_click`, `retake_quiz_click`, plus `screen_view` per step.

---

## Firestore collections

| Collection | Purpose |
|---|---|
| `questions/{id}` | Quiz prompts (`area`, `title`, `cue`, `icon`, `scene`, `sortOrder`, `active`) |
| `quizMeta/config` | Shared `areas`, `pairs`, `anchors`, `roleMap`, `boosts`, `whatsappUrl`, `version` |
| `inviteCodes/{code}` | Invite codes (`maxLimit`, `consumption`, `active`, `label`) |
| `colleges/{id}` | Independent college names (`name`, `active`) |
| `departments/{id}` | Independent department names (`name`, `active`) |
| `users/{uid}` | Student profiles + discovery answers/scores/roles |
| `waitlist/{id}` | Legacy signup emails + optional answers/scores |
| `admins/{email}` | Allowlisted admin emails |
| `roadmapPrivate/{id}` | Owner enrolment, attempts, notes, and operation ids. Cloud Functions only. |
| `roadmapCounts/{id}` | Anonymous per-version step counts. Cloud Functions only. |

Roadmap counts use the existing Cloud Firestore Native `(default)` database in `asia-south1` through the Admin SDK. The web client cannot read or write these documents. Notes are not included in admin or public responses.

Client SDK access is denied by rules — all reads/writes go through Cloud Functions.

---

## Local development

```bash
# API (uses deployed project by default via Vite proxy)
cd functions && npm install

# Student app
cd web && npm install && npm run dev

# Admin app
cd admin && npm install && npm run dev
```

Seed questions + admin allowlist (requires Application Default Credentials / `firebase login`):

```bash
cd functions
ADMIN_EMAIL=sapienscampus.in@gmail.com npm run seed
```

Admin uses **Google Sign-In**. The allowlisted account is `sapienscampus.in@gmail.com` (also hardcoded in Cloud Functions). After enabling Google in Auth, make sure `sapienscampus-admin.web.app` and `localhost` are under Authentication → Settings → Authorized domains.

---

## Deploy

```bash
cd web && npm run build
cd ../admin && npm run build
firebase deploy --only firestore,functions,hosting
```

---

## Public API

- `GET /api/questions` — active questions + roleMap/boosts  
- `POST /api/invites/check` — validate invite without consuming  
- `GET /api/colleges` — active colleges + departments  
- `GET /api/colleges/:id/stats` — signed-up count  
- `GET /api/me`, `POST /api/me/profile`, `POST /api/me/discovery` — student Bearer token
- `GET /api/roadmaps` and `GET /api/roadmaps/:roleId` — published trail content
- `GET /api/roadmaps/:roleId/counts` — anonymous per-step counts for one version
- `GET /api/me/roadmap`, `POST /api/me/roadmap/start|switch|checklist|complete|undo|notes|restart` — owner progress and private notes
- `GET /api/admin/roadmaps`, `POST /api/admin/roadmaps/reconcile` — catalog check and count repair, never student notes  
- `POST /api/waitlist` — legacy `{ email, consent, company?, answers?, scores? }`  

## Admin API (Bearer Firebase ID token)

- `GET|POST /api/admin/questions`
- `PUT|DELETE /api/admin/questions/:id`
- `GET /api/admin/questions/export`
- `POST /api/admin/questions/import`
- `GET|POST /api/admin/invites`, `PUT|DELETE /api/admin/invites/:code`
- `GET|POST /api/admin/colleges`, `PUT /api/admin/colleges/:id`
- `POST /api/admin/departments`, `PUT /api/admin/departments/:id`
- `GET|PUT /api/admin/campus`
- `GET /api/admin/users` — paginated directory with scores and join dates
- `GET /api/admin/users/:uid` — full student profile
- `GET /api/admin/users/:uid/roadmap` — trail progress only (notes stay private)
