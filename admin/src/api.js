import { auth } from './firebase'

const API_BASE = import.meta.env.VITE_API_BASE || ''

async function authHeaders() {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const token = await user.getIdToken()
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function request(path, options = {}) {
  const headers = await authHeaders()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const listQuestions = () => request('/api/admin/questions')
export const createQuestion = (body) =>
  request('/api/admin/questions', { method: 'POST', body: JSON.stringify(body) })
export const updateQuestion = (id, body) =>
  request(`/api/admin/questions/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteQuestion = (id) =>
  request(`/api/admin/questions/${id}`, { method: 'DELETE' })
export const batchDeleteQuestions = async (ids) => {
  try {
    return await request('/api/admin/questions/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
  } catch (err) {
    // If batch-delete endpoint is not yet available on the deployed backend, fall back to individual deletes
    if (
      err.message &&
      (err.message.includes('404') ||
        err.message.includes('Cannot POST') ||
        err.message.includes('Not Found'))
    ) {
      await Promise.all(ids.map((id) => deleteQuestion(id)))
      return { ok: true, deleted: ids.length }
    }
    throw err
  }
}
export const exportQuestions = () => request('/api/admin/questions/export')
export const importQuestions = (pack, options = {}) =>
  request('/api/admin/questions/import', {
    method: 'POST',
    body: JSON.stringify({ pack, ...options }),
  })

export const listInvites = () => request('/api/admin/invites')
export const createInvite = (body) =>
  request('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) })
export const updateInvite = (code, body) =>
  request(`/api/admin/invites/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
export const deactivateInvite = (code) =>
  request(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })

export const listColleges = () => request('/api/admin/colleges')
export const createCollege = (body) =>
  request('/api/admin/colleges', { method: 'POST', body: JSON.stringify(body) })
export const updateCollege = (id, body) =>
  request(`/api/admin/colleges/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
export const createDepartment = (body) =>
  request('/api/admin/departments', { method: 'POST', body: JSON.stringify(body) })
export const updateDepartment = (id, body) =>
  request(`/api/admin/departments/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

export const getCampus = () => request('/api/admin/campus')
export const updateCampus = (body) =>
  request('/api/admin/campus', { method: 'PUT', body: JSON.stringify(body) })

export const listUsers = ({ limit = 25, cursor = '' } = {}) => {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  const query = params.toString()
  return request(`/api/admin/users${query ? `?${query}` : ''}`)
}
export const getUser = (uid) => request(`/api/admin/users/${encodeURIComponent(uid)}`)
export const getUserRoadmap = (uid) =>
  request(`/api/admin/users/${encodeURIComponent(uid)}/roadmap`)

export const getRoadmapCatalog = () => request('/api/admin/roadmaps')
export const getRoadmapEditor = (roleId) =>
  request(`/api/admin/roadmaps/editor/${encodeURIComponent(roleId)}`)
export const saveRoadmapDraft = (roleId, role) =>
  request(`/api/admin/roadmaps/editor/${encodeURIComponent(roleId)}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
export const publishRoadmap = (roleId, role, asNewVersion) =>
  request(`/api/admin/roadmaps/editor/${encodeURIComponent(roleId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ role, asNewVersion }),
  })
export const listRoadmapLearners = () => request('/api/admin/roadmaps/learners')
export const reconcileRoadmaps = () =>
  request('/api/admin/roadmaps/reconcile', { method: 'POST', body: JSON.stringify({}) })
