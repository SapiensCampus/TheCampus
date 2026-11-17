// In-memory fake of the admin API, served as Vite middleware for local UI testing.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..', '..')
const template = JSON.parse(fs.readFileSync(path.join(root, 'shared/questions.template.json'), 'utf8'))

const db = {
  pack: template,
  invites: [
    { code: 'CAMPUS26', label: 'Launch batch', maxLimit: 100, consumption: 42, active: true },
    { code: 'FRIENDS', label: 'Friends', maxLimit: 20, consumption: 20, active: true },
    { code: 'OLD', label: 'Retired', maxLimit: 10, consumption: 3, active: false },
  ],
  colleges: [
    { id: 'iit-m', name: 'IIT Madras', active: true, signedUp: 12 },
    { id: 'nit-t', name: 'NIT Trichy', active: true, signedUp: 5 },
  ],
  departments: [
    { id: 'cse', name: 'Computer Science', active: true },
    { id: 'ece', name: 'Electronics', active: true },
  ],
  campus: { whatsappUrl: 'https://chat.whatsapp.com/example' },
  users: Array.from({ length: 8 }, (_, i) => ({
    id: `u${i + 1}`,
    uid: `u${i + 1}`,
    name: `Student ${i + 1}`,
    email: `student${i + 1}@example.com`,
    college: 'IIT Madras',
    scores: { R: 5 + i, I: 3, A: 2, S: 4, E: 1, C: 2 },
    createdAt: new Date(2026, 10, i + 1).toISOString(),
  })),
}

const unit = (id, kind, title) => ({ id, kind, title, ...(kind === 'skill' ? { skill: title } : {}) })
const step = (n, unitId) => ({
  id: `builders-${String(n).padStart(2, '0')}`,
  role: 'builders',
  version: 1,
  order: n,
  type: 'task',
  section: 'Start',
  unit: unitId,
  title: `Step ${n}`,
  goal: 'Make something small',
  estimateMinutes: 30,
  task: 'Do the thing.',
  requiredOutput: 'A photo of it.',
  doneChecklist: ['Finish part one', 'Finish part two'],
  primaryResource: { publisher: 'Example', title: 'Guide', url: 'https://example.com', slice: 'First half', accessNote: 'Public page.' },
  links: [],
  fallback: 'The task alone is enough.',
})
const roadmap = () => ({
  id: 'builders',
  title: 'Builders',
  version: 1,
  units: [unit('u1', 'try', 'Try it'), unit('u2', 'skill', 'Soldering'), unit('u3', 'careers', 'Careers')],
  steps: [step(1, 'u1'), step(2, 'u1'), step(3, 'u2')],
  careers: [{ id: 'career-1', title: 'Hardware engineer', tag: 'interesting', blurb: 'Builds devices', dayInLife: 'Bench and code', skills: [], profiles: [] }],
})

const routes = [
  ['GET', /^\/admin\/questions$/, () => ({ pack: db.pack })],
  ['GET', /^\/admin\/invites$/, () => ({ invites: db.invites })],
  ['GET', /^\/admin\/colleges$/, () => ({ colleges: db.colleges, departments: db.departments })],
  ['GET', /^\/admin\/campus$/, () => ({ campus: db.campus })],
  ['PUT', /^\/admin\/campus$/, (_m, body) => ((db.campus = { ...db.campus, ...body }), { campus: db.campus })],
  ['GET', /^\/admin\/users$/, () => ({ users: db.users, total: db.users.length, nextCursor: null })],
  ['GET', /^\/admin\/users\/([^/]+)$/, (m) => ({ user: db.users.find((u) => u.id === m[1]) || db.users[0] })],
  ['GET', /^\/admin\/users\/[^/]+\/roadmap$/, () => ({ enrolled: false })],
  ['GET', /^\/admin\/roadmaps$/, () => ({ roles: [{ id: 'builders', title: 'Builders', latest: true, version: 1 }] })],
  ['GET', /^\/admin\/roadmaps\/learners$/, () => ({ learners: [] })],
  ['GET', /^\/admin\/roadmaps\/editor\/([^/]+)$/, () => {
    const role = roadmap()
    return { role, baseStepIds: role.steps.map((s) => s.id), hasDraft: false }
  }],
  ['PUT', /^\/admin\/roadmaps\/editor\/[^/]+$/, () => ({ ok: true })],
  ['POST', /^\/admin\/roadmaps\/editor\/[^/]+\/publish$/, () => ({ ok: true, version: 1, newVersion: false })],
  ['POST', /^\/admin\/roadmaps\/reconcile$/, () => ({ repaired: [] })],
]

export function mockApi() {
  return {
    name: 'mock-admin-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        const url = (req.url || '/').split('?')[0]
        const route = routes.find(([method, re]) => method === req.method && re.test(url))
        if (!route) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          // Unmocked writes just succeed so forms can be exercised.
          return res.end(JSON.stringify({ ok: true }))
        }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          let body = {}
          try { body = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(route[2](url.match(route[1]), body)))
        })
      })
    },
  }
}
