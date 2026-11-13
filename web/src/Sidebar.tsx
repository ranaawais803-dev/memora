import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Settings as SettingsIcon, Sparkles, ChevronRight, Search, Plus, X, Mic, Image, FileText, Bookmark, CalendarHeart, Lightbulb, MessageSquare, Video, Cloud, CloudOff, AlertCircle, LogOut, Pencil } from 'lucide-react'
import { api, timeShort, type Chat, type SearchResult, type Status, type User } from './api'
import { Logo } from './App'
import PeoplePicker from './PeoplePicker'

interface Props {
  me: User
  chats: Chat[]
  activeId: string | null
  status: Status | null
  onOpen: (id: string, messageId?: string) => void
  everything: boolean
  onEverything: () => void
  onCreate: (name: string, emoji: string, userIds: string[]) => void
  onStatus: () => void
  onMe: (u: User) => void
  onLogout: () => void
  className?: string
}

const TINTS = ['bg-rose-100', 'bg-amber-100', 'bg-emerald-100', 'bg-sky-100', 'bg-violet-100', 'bg-pink-100', 'bg-lime-100', 'bg-orange-100']
export const tintOf = (id: string) => TINTS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length]

export default function Sidebar({ me, chats, activeId, everything, onEverything, status, onOpen, onCreate, onStatus, onMe, onLogout, className = '' }: Props) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!q.trim()) return setResults(null)
    const t = setTimeout(() => api.search(q).then(setResults), 200)
    return () => clearTimeout(t)
  }, [q])


  return (
    <aside className={`${className} w-full md:w-[290px] shrink-0 flex-col border-r border-slate-200/80 bg-white`}>
      <header className="px-4 pt-4 pb-3 flex items-center gap-2">
        <Logo className="size-8" />
        <span className="text-lg font-bold tracking-tight">Weave</span>
        <div className="ml-auto flex items-center gap-1">
          <DriveButton status={status} onChange={onStatus} />
          <button onClick={() => setCreating((c) => !c)} title="New chat" className="size-9 grid place-items-center rounded-xl bg-brand-500 hover:bg-brand-600 text-white shadow-sm shadow-brand-500/30"><Plus className="size-5" /></button>
        </div>
      </header>

      <div className="px-3 pb-2">
        <label className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100 border border-transparent focus-within:border-brand-500 transition">
          <Search className="size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find anything: photos, voice, plans…" className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-slate-400" />
          {q && <button onClick={() => setQ('')}><X className="size-4 text-slate-400" /></button>}
        </label>
      </div>

      {creating && <NewChat onCancel={() => setCreating(false)} onCreate={(n, e, u) => { setCreating(false); onCreate(n, e, u) }} />}

      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2">
        {results ? (
          <SearchResults results={results} q={q} onOpen={(id, mid) => { onOpen(id, mid); setQ('') }} />
        ) : !chats.length ? (
          <div className="text-center px-6 py-12">
            <p className="text-3xl">👋</p>
            <p className="font-medium text-slate-700 mt-2">No chats yet</p>
            <p className="text-sm text-slate-500 mt-1">Tap <b>+</b> to start one and add people by their phone number.</p>
          </div>
        ) : (
          <>
          <EverythingRow chats={chats} active={everything} onClick={onEverything} />
          {chats.map((c) => {
            const isActive = activeId === c.id
            const online = c.people.some((p) => p.id !== me.id && p.online)
            return (
              <button key={c.id} onClick={() => onOpen(c.id)} className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition ${isActive ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                <div className={`relative size-11 shrink-0 rounded-2xl ${tintOf(c.id)} grid place-items-center text-xl`}>
                  <ChatIconInner chat={c} />
                  {online && <span title="Someone is online" className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate ${c.unread && !isActive ? 'font-bold' : 'font-semibold'} text-[15px]`}>{c.name}</span>
                    {c.last && <span className={`ml-auto text-[11px] shrink-0 ${c.unread && !isActive ? 'text-brand-600 font-semibold' : 'text-slate-400'}`}>{timeShort(c.last.createdAt)}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
                    {c.urgent > 0 && <AlertCircle className="size-3.5 text-rose-500 shrink-0" />}
                    <span className={`truncate ${c.unread && !isActive ? 'text-slate-800' : ''}`}>{c.last ? preview(c.last, me) : 'Say hi 👋'}</span>
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      {c.unread > 0 && !isActive && <span className="min-w-5 h-5 px-1.5 rounded-full bg-brand-500 text-white text-[11px] font-semibold grid place-items-center">{c.unread > 99 ? '99+' : c.unread}</span>}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
          </>
        )}
      </div>

      <Profile me={me} status={status} onMe={onMe} onLogout={onLogout} />
    </aside>
  )
}

function Profile({ me, status, onMe, onLogout }: { me: User; status: Status | null; onMe: (u: User) => void; onLogout: () => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me.name)
  const [settings, setSettings] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim() && name !== me.name) onMe(await api.rename(name))
    setEditing(false)
  }
  return (
    <footer className="relative px-3 py-3 border-t border-slate-100 flex items-center gap-2.5">
      <div className="size-9 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-brand-500 to-violet-500 text-white grid place-items-center font-semibold">{me.avatar ? <img src={me.avatar} className="size-full object-cover" /> : me.name[0]?.toUpperCase()}</div>
      {editing ? (
        <form onSubmit={save} className="flex-1 min-w-0">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} className="w-full rounded-lg border border-brand-500 px-2 py-1 text-sm outline-none" />
        </form>
      ) : (
        <button onClick={() => setEditing(true)} className="group min-w-0 flex-1 text-left leading-tight">
          <p className="text-sm font-semibold text-slate-700 truncate flex items-center gap-1">{me.name} <Pencil className="size-3 text-slate-300 opacity-0 group-hover:opacity-100" /></p>
          <p className="text-xs text-slate-400 truncate">{me.phone}{status && !status.ai ? ' · Basic mode' : ''}</p>
        </button>
      )}
      <div>
        <button onClick={() => setSettings((v) => !v)} title="Settings" className="size-8 shrink-0 grid place-items-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><SettingsIcon className="size-4" /></button>
        {settings && <SettingsPanel me={me} onMe={onMe} onClose={() => setSettings(false)} />}
      </div>
      <button onClick={onLogout} title="Log out" className="size-8 shrink-0 grid place-items-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"><LogOut className="size-4" /></button>
    </footer>
  )
}

const preview = (m: NonNullable<Chat['last']>, me: User) => {
  if (m.event) return `${m.senderId === me.id ? 'You' : m.sender.split(' ')[0]} ${m.text}`
  const who = m.senderId === me.id ? 'You: ' : `${m.sender.split(' ')[0]}: `
  if (m.media?.kind === 'audio') return `${who}🎤 Voice note`
  if (m.media?.kind === 'image') return `${who}📷 Photo`
  if (m.media?.kind === 'video') return `${who}🎬 Video`
  if (m.media) return `${who}📄 ${m.media.name}`
  return who + m.text
}

const typeInfo: Record<string, { icon: typeof Mic; label: string; color: string }> = {
  message: { icon: MessageSquare, label: 'Message', color: 'text-slate-500 bg-slate-100' },
  voice: { icon: Mic, label: 'Voice note', color: 'text-violet-600 bg-violet-50' },
  audio: { icon: Mic, label: 'Voice note', color: 'text-violet-600 bg-violet-50' },
  image: { icon: Image, label: 'Photo', color: 'text-sky-600 bg-sky-50' },
  video: { icon: Video, label: 'Video', color: 'text-sky-600 bg-sky-50' },
  file: { icon: FileText, label: 'File', color: 'text-amber-600 bg-amber-50' },
  keep: { icon: Bookmark, label: 'Keep', color: 'text-emerald-600 bg-emerald-50' },
  plan: { icon: CalendarHeart, label: 'Plan', color: 'text-brand-600 bg-brand-50' },
  knowledge: { icon: Lightbulb, label: 'Good to know', color: 'text-amber-600 bg-amber-50' },
}

function SearchResults({ results, q, onOpen }: { results: SearchResult[]; q: string; onOpen: (id: string, mid?: string) => void }) {
  if (!results.length) return <p className="text-center text-sm text-slate-400 py-10">Nothing found for “{q}”</p>
  return (
    <div className="pb-4">
      <p className="px-2 py-1 text-xs font-medium text-slate-400 uppercase tracking-wide">{results.length} results</p>
      {results.map((r, i) => {
        const t = typeInfo[r.type] ?? typeInfo.message
        const Icon = t.icon
        return (
          <button key={i} onClick={() => onOpen(r.chatId, r.messageId)} className="w-full flex gap-3 px-2 py-2 rounded-xl text-left hover:bg-slate-50">
            {r.media?.kind === 'image' ? (
              <img src={r.media.url} className="size-10 rounded-lg object-cover shrink-0" />
            ) : (
              <div className={`size-10 rounded-lg grid place-items-center shrink-0 ${t.color}`}><Icon className="size-5" /></div>
            )}
            <div className="min-w-0">
              <p className="text-sm text-slate-700 line-clamp-2">{r.text}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{t.label} · {r.emoji} {r.chatName}{r.createdAt && ` · ${timeShort(r.createdAt)}`}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

const EMOJIS = ['💬', '🏡', '❤️', '⚽', '🎓', '✈️', '💼', '🚀']

function NewChat({ onCreate, onCancel }: { onCreate: (n: string, e: string, u: string[]) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [people, setPeople] = useState<User[]>([])
  const canCreate = !!name.trim() || people.length > 0
  const placeholder = people.length === 1 ? `Name (optional, shows "${people[0].name}")` : people.length > 1 ? 'Group name (optional)' : 'Name, e.g. Family or Weekend crew'
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canCreate) onCreate(name, emoji, people.map((p) => p.id)) }} className="pop-in mx-3 mb-2 p-3 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
      <p className="text-sm font-semibold">New chat</p>
      <div className="flex gap-0.5">
        {EMOJIS.map((e) => (
          <button type="button" key={e} onClick={() => setEmoji(e)} className={`size-8 rounded-lg text-lg ${emoji === e ? 'bg-white shadow ring-1 ring-brand-500' : 'hover:bg-white'}`}>{e}</button>
        ))}
      </div>
      <PeoplePicker selected={people} onChange={setPeople} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-500">Cancel</button>
        <button disabled={!canCreate} className="px-3 py-1.5 text-sm rounded-lg bg-brand-500 disabled:opacity-50 text-white font-medium">Create</button>
      </div>
    </form>
  )
}

function DriveButton({ status, onChange }: { status: Status | null; onChange: () => void }) {
  if (!status) return null
  const d = status.drive
  if (d.connected)
    return (
      <button title={`Google Drive connected${d.email ? ` (${d.email})` : ''}. Click to disconnect.`} onClick={async () => { if (confirm('Disconnect Google Drive?')) { await api.disconnectDrive(); onChange() } }} className="size-9 grid place-items-center rounded-xl bg-emerald-50 text-emerald-600">
        <Cloud className="size-4" />
      </button>
    )
  return (
    <button
      onClick={() => (d.configured ? (location.href = '/api/drive/connect') : alert('To back up to Google Drive, add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server/.env (see README).'))}
      title="Back up to Google Drive"
      className="size-9 grid place-items-center rounded-xl hover:bg-slate-100 text-slate-400"
    >
      <CloudOff className="size-4" />
    </button>
  )
}

/** Top row, like a status strip: all keeps and plans from every chat, without opening any chat. */
function EverythingRow({ chats, active, onClick }: { chats: Chat[]; active: boolean; onClick: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const plans = chats.reduce((n, c) => n + (c.insights?.plans ?? []).filter((x) => !x.done && !(x.due && x.due < today)).length, 0)
  const keeps = chats.reduce((n, c) => n + (c.insights?.keeps ?? []).filter((x) => !x.done).length, 0)
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-2.5 py-2.5 mb-1 rounded-xl text-left transition ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
      <span className="size-11 shrink-0 rounded-full p-[2.5px] bg-gradient-to-tr from-brand-500 to-violet-500">
        <span className="size-full rounded-full bg-white ring-2 ring-white grid place-items-center"><Sparkles className="size-5 text-brand-500" /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[15px]">Organized for you</span>
        <span className="block text-[13px] text-slate-500 truncate">{plans || keeps ? `${plans} plans · ${keeps} keeps across your chats` : 'Plans and keeps from all your chats'}</span>
      </span>
      <ChevronRight className="size-4 text-slate-300" />
    </button>
  )
}

const DONE_CHOICES = ['✅', '👍', '✔️', '👌', '💯', '']

/** Small settings card: which emoji reaction counts as "done". */
function SettingsPanel({ me, onMe, onClose }: { me: User; onMe: (u: User) => void; onClose: () => void }) {
  const current = me.settings?.doneEmoji ?? '✅'
  const pick = async (e: string) => onMe(await api.saveSettings({ doneEmoji: e }))
  const [name, setName] = useState(me.name)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const photo = async (f: File | null) => {
    setBusy(true)
    try { onMe(await api.setAvatar(f)) } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  const saveName = async () => { if (name.trim() && name.trim() !== me.name) onMe(await api.rename(name.trim())) }
  return (
    <div className="pop-in absolute bottom-full left-3 right-3 mb-2 z-40 rounded-2xl border border-slate-200 bg-white shadow-xl p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-800">Settings</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">Profile</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative shrink-0">
        <button onClick={() => file.current?.click()} title="Change photo" className="relative size-14 shrink-0 rounded-full overflow-hidden bg-gradient-to-br from-brand-500 to-violet-500 text-white grid place-items-center text-xl font-semibold group">
          {me.avatar ? <img src={me.avatar} className="size-full object-cover" /> : me.name[0]?.toUpperCase()}
          <span className="absolute inset-0 bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition">{busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}</span>
        </button>
        {me.avatar && <button type="button" onClick={() => { if (confirm('Remove your photo?')) photo(null) }} title="Remove photo" className="absolute -top-1 -right-1 size-6 rounded-full bg-white border border-slate-200 shadow text-slate-500 hover:text-rose-600 grid place-items-center"><X className="size-3.5" /></button>}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) photo(f); e.target.value = '' }} />
        <div className="min-w-0 flex-1 space-y-1">
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} maxLength={40} placeholder="Your name" className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500" />
          <div className="flex gap-3 text-xs">
            <button onClick={() => file.current?.click()} className="text-brand-600 hover:underline">{me.avatar ? 'Change photo' : 'Add photo'}</button>
            {me.avatar && <button onClick={() => photo(null)} className="text-slate-500 hover:text-rose-600">Remove</button>}
          </div>
        </div>
      </div>
      <div className="my-4 border-t border-slate-100" />
      <p className="text-sm font-medium text-slate-700">Emoji that means "done"</p>
      <p className="text-xs text-slate-500 mt-0.5">React with it on a message and the keeps and plans from that message get ticked off.</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {DONE_CHOICES.map((e) => (
          <button key={e || 'off'} onClick={() => pick(e)} className={`h-9 min-w-9 px-2 rounded-xl border text-lg grid place-items-center transition ${current === e ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:bg-slate-50'}`}>
            {e || <span className="text-xs font-medium text-slate-500">Off</span>}
          </button>
        ))}
      </div>

    </div>
  )
}

/**
 * What fills a chat's icon: a photo when there is one; for a 1-to-1 chat without a photo, the other
 * person's initial on a default person badge; otherwise the chat's emoji icon (always present).
 */
export function ChatIconInner({ chat }: { chat: Chat }) {
  // photo: your own > the creator's > (2 people) the other person's profile photo. No photo: the chat icon.
  // When a photo shows, the chat icon sits small in the top-left corner.
  const icon = chat.emoji || "💬"
  if (!chat.photo) return <>{icon}</>
  return (
    <span className="relative size-full rounded-[inherit]">
      <img src={chat.photo} className="size-full rounded-[inherit] object-cover" />
      <span className="absolute -top-1 -left-1 size-[45%] min-w-4 min-h-4 rounded-full bg-white shadow ring-1 ring-slate-200 grid place-items-center text-[0.55em] leading-none">{icon}</span>
    </span>
  )
}
