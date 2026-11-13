import { io } from 'socket.io-client'

export type MediaKind = 'image' | 'video' | 'audio' | 'file'
export interface Media { url: string; name: string; mime: string; kind: MediaKind; size: number; category?: string; caption?: string; driveLink?: string }
export interface Reaction { emoji: string; userId: string; name: string }
export interface Message { id: string; chatId: string; replyToId?: string; reactions?: Reaction[]; event?: { itemId: string; list: List; kind: 'done' | 'undone' | 'skipped' | 'unskipped' | 'yes' | 'no' | 'maybe' }; senderId?: string; sender: string; clientId?: string; pending?: boolean; failed?: boolean; text: string; createdAt: string; media?: Media; transcript?: string; urgent?: { summary: string } | null }
export interface Subtask { id: string; text: string; done?: boolean }
export type Priority = 'low' | 'normal' | 'high'
export type List = 'keeps' | 'plans'
export interface Item {
  doneBy?: string[]
  skipped?: boolean
  votes?: Record<string, Vote>
  id: string; text: string; when?: string; done?: boolean
  notes?: string; assignee?: string; due?: string; priority?: Priority; subtasks?: Subtask[]
  source?: 'ai' | 'manual'; edited?: boolean; createdAt?: string; sourceIds?: string[]
}
export type Period = 'today' | 'week' | 'month' | 'year'
export interface Insights { keeps: Item[]; plans: Item[]; topics: string[]; topicNotes?: Record<string, string>; knowledge: Item[]; summaries: Partial<Record<Period, string>>; updatedAt?: string; firstAt?: string }
export interface Settings { doneEmoji: string; yesEmoji?: string; noEmoji?: string; maybeEmoji?: string }
export type Vote = 'yes' | 'no' | 'maybe'
export interface StatusPost { id: string; userId: string; name: string; text?: string; bg?: string; media?: { url: string; mime: string }; viewers: string[]; createdAt: string }
export interface User { id: string; phone: string; name: string; avatar?: string; settings?: Settings }
export interface Person extends User { online: boolean }
export interface InfoField { id: string; label: string; value: string }
export interface ChatInfo { project?: boolean; about?: string; dueDate?: string; fields?: InfoField[] }
export interface ChatStats {
  total: number; since: string
  perDay: { date: string; count: number }[]
  people: { name: string; count: number }[]
  media: { photos: number; videos: number; voice: number; files: number }
  keeps: { open: number; done: number }; plans: { open: number; done: number }
}
export interface Chat { id: string; name: string; createdBy?: string; photo?: string; hasOwnPhoto?: boolean; direct?: boolean; originalName?: string; nickname?: string; isCreator?: boolean; emoji: string; members: string[]; info?: ChatInfo; people: Person[]; insights: Insights; last: Message | null; urgent: number; unread: number }
export interface Status { ai: boolean; drive: { configured: boolean; connected: boolean; email?: string } }
export type Library = Record<string, Record<string, (Media & { messageId: string; sender: string; createdAt: string })[]>>
export interface SearchResult { type: string; text: string; chatId: string; chatName: string; emoji: string; messageId?: string; sender?: string; createdAt?: string; media?: Media }

const TOKEN_KEY = 'weave:token'
export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) },
  set(token: string | null) { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) },
}

/** Fired when the server says the session is gone, so the app can show the login screen. */
export const onLoggedOut = new EventTarget()

async function req<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  // never spin forever: uploads get longer, everything else gives up after 15s with a clear message
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.body instanceof FormData ? 120000 : 15000)
  let r: Response
  try {
    r = await fetch(url, { ...init, headers, signal: ctrl.signal })
  } catch {
    throw new Error("Can't reach Weave right now. Check your connection and try again.")
  } finally {
    clearTimeout(timer)
  }
  if (r.status >= 502 && r.status <= 530) throw new Error('Weave is starting up or offline. Try again in a moment.')
  if (r.status === 401 && !url.startsWith('/api/auth/')) {
    auth.set(null)
    onLoggedOut.dispatchEvent(new Event('logout'))
  }
  if (!r.ok) {
    const body = await r.text()
    let msg = body
    try { const j = JSON.parse(body); msg = Array.isArray(j.message) ? j.message.join(', ') : j.message ?? body } catch { /* plain text */ }
    throw new Error(msg || r.statusText)
  }
  return r.json()
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  requestCode: (phone: string) => req<{ sent: boolean; isNew: boolean; devCode?: string }>('/api/auth/code', json('POST', { phone })),
  verify: (phone: string, code: string, name?: string) => req<{ token: string; user: User }>('/api/auth/verify', json('POST', { phone, code, name })),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  me: () => req<User>('/api/auth/me'),
  rename: (name: string) => req<User>('/api/auth/me', json('PATCH', { name })),
  statuses: () => req<StatusPost[]>('/api/statuses'),
  postStatus: (data: { text?: string; bg?: string; file?: File }) => {
    const f = new FormData()
    if (data.text?.trim()) f.append('text', data.text.trim())
    if (data.bg) f.append('bg', data.bg)
    if (data.file) f.append('file', data.file, data.file.name)
    return req<StatusPost>('/api/statuses', { method: 'POST', body: f })
  },
  seenStatus: (sid: string) => req(`/api/statuses/${sid}/seen`, { method: 'POST' }),
  deleteStatus: (sid: string) => req(`/api/statuses/${sid}`, { method: 'DELETE' }),
  setAvatar: (file: File | null) => {
    const f = new FormData()
    if (file) f.append('file', file, file.name)
    return req<User>('/api/auth/me/avatar', { method: 'POST', body: f })
  },
  setChatPhoto: (id: string, file: File | null) => {
    const f = new FormData()
    if (file) f.append('file', file, file.name)
    return req<Chat>(`/api/chats/${id}/photo`, { method: 'POST', body: f })
  },
  saveSettings: (settings: Partial<Settings>) => req<User>('/api/auth/me', json('PATCH', { settings })),
  react: (id: string, mid: string, emoji: string) => req<Message>(`/api/chats/${id}/messages/${mid}/react`, json('POST', { emoji })),
  addTopic: (id: string, name: string, about?: string) => req<Insights>(`/api/chats/${id}/topics`, json('POST', { name, about })),
  removeTopic: (id: string, name: string) => req<Insights>(`/api/chats/${id}/topics/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  findUsers: (q: string) => req<User[]>(`/api/users?q=${encodeURIComponent(q)}`),
  addMember: (id: string, userId: string) => req<Chat>(`/api/chats/${id}/members`, json('POST', { userId })),
  updateChat: (id: string, patch: { name?: string; emoji?: string; info?: ChatInfo }) => req<Chat>(`/api/chats/${id}`, json('PATCH', patch)),
  stats: (id: string) => req<ChatStats>(`/api/chats/${id}/stats`),
  leave: (id: string) => req(`/api/chats/${id}/leave`, { method: 'POST' }),
  markRead: (id: string) => req(`/api/chats/${id}/read`, { method: 'POST' }),
  status: () => req<Status>('/api/status'),
  chats: () => req<Chat[]>('/api/chats'),
  createChat: (name: string, emoji: string, userIds: string[] = []) => req<Chat>('/api/chats', json('POST', { name, emoji, userIds })),
  messages: (id: string) => req<Message[]>(`/api/chats/${id}/messages`),
  send: (id: string, data: { clientId?: string; replyToId?: string; text?: string; file?: Blob; fileName?: string; transcript?: string }) => {
    const f = new FormData()
    if (data.clientId) f.append('clientId', data.clientId)
    if (data.text) f.append('text', data.text)
    if (data.replyToId) f.append('replyToId', data.replyToId)
    if (data.transcript) f.append('transcript', data.transcript)
    if (data.file) f.append('file', data.file, data.fileName)
    return req<Message>(`/api/chats/${id}/messages`, { method: 'POST', body: f })
  },
  insights: (id: string) => req<Insights>(`/api/chats/${id}/insights`),
  refresh: (id: string) => req<Insights>(`/api/chats/${id}/insights/refresh`, { method: 'POST' }),
  addItem: (id: string, list: List | 'knowledge', item: Partial<Item>) => req<Item>(`/api/chats/${id}/items`, json('POST', { ...item, list })),
  updateItem: (id: string, itemId: string, patch: Partial<Item> & { list?: List }) => req<Item>(`/api/chats/${id}/items/${itemId}`, json('PATCH', patch)),
  vote: (id: string, itemId: string, vote: Vote | null) => req<Item>(`/api/chats/${id}/items/${itemId}/vote`, json('POST', { vote })),
  deleteItem: (id: string, itemId: string) => req(`/api/chats/${id}/items/${itemId}`, { method: 'DELETE' }),
  recap: (id: string) => req<{ headline: string; points: string[] }>(`/api/chats/${id}/recap`),
  library: (id: string) => req<Library>(`/api/chats/${id}/library`),
  search: (q: string) => req<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  disconnectDrive: () => req('/api/drive/disconnect', { method: 'POST' }),
}

/** One authenticated socket; connect after login, disconnect on logout. */
// WebSocket only: long-polling holds HTTP connections open, and with a few tabs open the browser's
// 6-connections-per-host limit fills up and normal requests (like "Send code") wait forever.
export const socket = io({ path: '/socket.io', transports: ['websocket'], autoConnect: false, auth: (cb) => cb({ token: auth.token }) })
socket.on('unauthorized', () => { auth.set(null); onLoggedOut.dispatchEvent(new Event('logout')) })

export const timeShort = (iso: string) => {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1 && new Date().getDate() === d.getDate()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
