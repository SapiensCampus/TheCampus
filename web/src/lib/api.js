import { auth } from '../firebase'
import { cachedFetch, peekMemory, readLocal, writeLocal, invalidateCache } from './cache'

const API_BASE = import.meta.env.VITE_API_BASE || ''

const PUBLIC_TTL_MS = 10 * 60_000
const STATS_TTL_MS = 60_000
const ROADMAP_TTL_MS = 30 * 60_000
const ME_ROADMAP_TTL_MS = 15_000

let meInflight = null
let meUid = null
let meCache = null
let meCacheUid = null

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (err) {
    const error = new Error(err.message || 'Network error — check your connection and try again')
    error.code = 'network_error'
    throw error
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `Request failed (${res.status})`)
    error.code = data.code || `http_${res.status}`
    error.status = res.status
    error.details = data
    throw error
  }
  return data
}

async function authRequest(path, options = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const token = await user.getIdToken()
  return request(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
}

async function loadPublic(key, path, { force = false } = {}) {
  if (!force) {
    const warm = peekMemory(key, PUBLIC_TTL_MS) || readLocal(key, PUBLIC_TTL_MS)
    if (warm != null) {
      // Soft revalidate so the next visit is fresher without blocking UI.
      cachedFetch(
        `${key}:revalidate`,
        async () => {
          const data = await request(path)
          writeLocal(key, data)
          return data
        },
        { memoryTtlMs: 5_000 }
      ).catch(() => {})
      return warm
    }
  }
  return cachedFetch(
    key,
    async () => {
      const data = await request(path)
      writeLocal(key, data)
      return data
    },
    { memoryTtlMs: PUBLIC_TTL_MS }
  )
}

/** Instant hydrate for boot — memory, then localStorage, no network. */
export function peekQuestions() {
  return peekMemory('questions', PUBLIC_TTL_MS) || readLocal('questions', PUBLIC_TTL_MS)
}

export function peekColleges() {
  return peekMemory('colleges', PUBLIC_TTL_MS) || readLocal('colleges', PUBLIC_TTL_MS)
}

export function fetchQuestions(options) {
  return loadPublic('questions', '/api/questions', options)
}

export function fetchColleges(options) {
  return loadPublic('colleges', '/api/colleges', options)
}

export function checkInvite(code) {
  return request('/api/invites/check', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function fetchCollegeStats(collegeId) {
  const id = String(collegeId || '').trim()
  if (!id) return Promise.resolve({ ok: true, collegeId: '', signedUpCount: 0 })
  const key = `college-stats:${id}`
  return cachedFetch(key, () => request(`/api/colleges/${encodeURIComponent(id)}/stats`), {
    memoryTtlMs: STATS_TTL_MS,
  })
}

/** Dedupes concurrent /api/me calls for the same signed-in user. */
export function fetchMe() {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  if (meCache && meCacheUid === user.uid) return Promise.resolve(meCache)
  if (meInflight && meUid === user.uid) return meInflight
  meUid = user.uid
  meInflight = authRequest('/api/me')
    .then((data) => {
      meCache = data
      meCacheUid = user.uid
      return data
    })
    .finally(() => {
      meInflight = null
    })
  return meInflight
}

export function invalidateMeCache() {
  meInflight = null
  meUid = null
  meCache = null
  meCacheUid = null
}

export function saveProfile(payload) {
  invalidateMeCache()
  return authRequest('/api/me/profile', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function saveDiscovery(payload) {
  invalidateMeCache()
  invalidateCache(`my-roadmap`)
  return authRequest('/api/me/discovery', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function joinWaitlist(payload) {
  return request('/api/waitlist', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchRoadmapCatalog() {
  return cachedFetch('roadmap-catalog', () => request('/api/roadmaps'), {
    memoryTtlMs: ROADMAP_TTL_MS,
  })
}

export function fetchRoadmap(roleId, version) {
  const id = String(roleId || '').trim()
  const ver = version == null || version === '' ? 'latest' : String(version)
  const key = `roadmap:${id}:${ver}`
  const query = version == null || version === '' ? '' : `?version=${encodeURIComponent(version)}`
  const local = peekMemory(key, ROADMAP_TTL_MS) || readLocal(key, ROADMAP_TTL_MS)
  const pending = cachedFetch(
    key,
    async () => {
      const data = await request(`/api/roadmaps/${encodeURIComponent(id)}${query}`)
      writeLocal(key, data)
      return data
    },
    { memoryTtlMs: ROADMAP_TTL_MS }
  )
  if (local) {
    pending.catch(() => {})
    return Promise.resolve(local)
  }
  return pending
}

export function fetchRoadmapCounts(roleId, version) {
  const id = String(roleId || '').trim()
  const ver = version == null || version === '' ? 'latest' : String(version)
  const key = `roadmap-counts:${id}:${ver}`
  const query = version == null || version === '' ? '' : `?version=${encodeURIComponent(version)}`
  return cachedFetch(
    key,
    () => request(`/api/roadmaps/${encodeURIComponent(id)}/counts${query}`),
    { memoryTtlMs: STATS_TTL_MS }
  )
}

export function fetchMyRoadmap() {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const key = `my-roadmap:${user.uid}`
  return cachedFetch(key, () => authRequest('/api/me/roadmap'), {
    memoryTtlMs: ME_ROADMAP_TTL_MS,
  })
}

function postRoadmap(path, body) {
  const user = auth.currentUser
  if (user) invalidateCache(`my-roadmap:${user.uid}`)
  return authRequest(path, { method: 'POST', body: JSON.stringify(body) })
}

export function startRoadmap(body) {
  return postRoadmap('/api/me/roadmap/start', body)
}

export function switchRoadmap(body) {
  return postRoadmap('/api/me/roadmap/switch', body)
}

export function saveRoadmapChecklist(body) {
  return postRoadmap('/api/me/roadmap/checklist', body)
}

export function completeRoadmapStep(body) {
  return postRoadmap('/api/me/roadmap/complete', body)
}

export function undoRoadmapStep(body) {
  return postRoadmap('/api/me/roadmap/undo', body)
}

export function saveRoadmapNotes(body) {
  return postRoadmap('/api/me/roadmap/notes', body)
}

export function restartRoadmap(body) {
  return postRoadmap('/api/me/roadmap/restart', body)
}

// Social: XP, streak, quests, league, follows. Always fresh, never cached.
const post = (path, body = {}) => authRequest(path, { method: 'POST', body: JSON.stringify(body) })

export const fetchSocial = () => authRequest('/api/me/social')
export const setLeagueVisible = (visible) => post('/api/me/social/visibility', { visible })
export const claimChest = () => post('/api/me/social/chest')
export const fetchLeague = (scope) => authRequest(`/api/league?scope=${encodeURIComponent(scope)}`)
export const fetchClassmates = (q = '') => authRequest(`/api/classmates?q=${encodeURIComponent(q)}`)
export const followStudent = (uid) => post('/api/follow', { uid })
export const unfollowStudent = (uid) => post('/api/unfollow', { uid })
export const fetchStudent = (uid) => authRequest(`/api/users/${encodeURIComponent(uid)}/public`)
