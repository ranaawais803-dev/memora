import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Ban, Bookmark, CalendarDays, CalendarHeart, Search, X, ChevronRight, Hash, Lightbulb, Images, Mic, Video, FileText } from 'lucide-react'
import { api, socket, type Chat, type Item, type Library, type List, type User } from './api'
import { Avatar, DoneButton, VoteBar, dayLabel, isMissed, isPast, isPending } from './Tasks'
import { tintOf } from './Sidebar'

/** Every keep and plan from every chat in one place, like a status feed you can glance at without opening a chat. */
/** "Added today", "Added yesterday", "Added this week", "Added earlier" for items without a date. */
const addedLabel = (iso?: string) => {
  if (!iso) return 'No date'
  const days = Math.floor((Date.now() - +new Date(iso)) / 86400000)
  return days < 1 ? 'Added today' : days < 2 ? 'Added yesterday' : days < 7 ? 'Added this week' : 'Added earlier'
}

/** Date filter: by due date, or by when it was added for items without one. */
const WHEN = [
  { id: 'any', label: 'Any date' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'month', label: 'Next 30 days' },
  { id: 'past', label: 'Past dates' },
  { id: 'none', label: 'No date' },
  { id: 'added7', label: 'Added this week' },
] as const
type When = (typeof WHEN)[number]['id']
const dayStr = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const matchWhen = (r: Item, w: When) =>
  w === 'any' ? true
  : w === 'none' ? !r.due
  : w === 'added7' ? Date.now() - +new Date(r.createdAt ?? 0) < 7 * 86400000
  : !r.due ? false
  : w === 'past' ? r.due < dayStr()
  : w === 'today' ? r.due === dayStr()
  : r.due >= dayStr() && r.due <= dayStr(w === 'week' ? 7 : 30)

const FILTERS = ['Pending', 'Mine', 'Missed', 'Done', 'Not needed', 'All'] as const
type Filter = (typeof FILTERS)[number]
type Row = Item & { list: List; chat: Chat }
type Tab = 'both' | 'topics' | 'handy' | 'library'
const TABS: { id: Tab; label: string; icon: typeof Hash }[] = [
  { id: 'both', label: 'Plans & Keeps', icon: CalendarHeart },
  { id: 'topics', label: 'Topics', icon: Hash },
  { id: 'handy', label: 'Handy', icon: Lightbulb },
  { id: 'library', label: 'Library', icon: Images },
]

interface Props {
  me: User
  chats: Chat[]
  onChats: (fn: (cs: Chat[]) => Chat[]) => void
  onOpenItem: (chatId: string, itemId: string, list: List) => void
  onOpenChat: (chatId: string, messageId?: string) => void
  onBack: () => void
  onScope?: (chatId: string | null) => void
  className?: string
}

export default function Everything({ me, chats, onChats, onOpenItem, onOpenChat, onBack, onScope, className = '' }: Props) {
  const [tab, setTab] = useState<Tab>('both')
  const isList = tab === 'both'
  const [filter, setFilter] = useState<Filter>('Pending')
  const [chatId, setChatId] = useState<string | null>(null)
  useEffect(() => { onScope?.(chatId) }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [when, setWhen] = useState<When>('any')
  const [openRow, setOpenRow] = useState<string | null>(null)

  const all = useMemo<Row[]>(
    () => chats.flatMap((chat) => (['keeps', 'plans'] as const).flatMap((l) => (chat.insights?.[l] ?? []).map((it) => ({ ...it, list: l, chat })))),
    [chats],
  )
  const pendingIn = (c: Chat) => all.filter((r) => r.chat.id === c.id && isPending(r, r.list)).length
  const people = chats.filter((c) => pendingIn(c) > 0 || c.insights?.topics?.length || c.insights?.knowledge?.length)

  const mine = (r: Row) => !!r.assignee && (r.assignee === me.name || r.assignee.toLowerCase() === me.name.split(' ')[0].toLowerCase() || r.assignee === 'You')
  const rowsOf = (list: List) => all
    .filter((r) => r.list === list && (!chatId || r.chat.id === chatId))
    .filter((r) => (filter === 'Pending' ? isPending(r, r.list) : filter === 'Mine' ? isPending(r, r.list) && mine(r) : filter === 'Missed' ? (r.list === 'plans' ? isPast(r, 'plans') : isMissed(r)) : filter === 'Done' ? r.done : filter === 'Not needed' ? r.skipped : true))
    .filter((r) => matchWhen(r, when))
    .filter((r) => !q.trim() || [r.text, r.notes, r.assignee, r.chat.name].some((s) => s?.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))

  // plans read best by day, keeps by chat
  const groupsOf = (list: List) => {
    const groups = new Map<string, Row[]>()
    for (const r of rowsOf(list)) {
      // both lists go by date: the due date when there is one, otherwise when it was added
      const key = r.due
        ? (list === 'plans' ? (isPast(r, 'plans') ? 'Gone by' : dayLabel(r.due)) : isMissed(r) ? 'Missed' : dayLabel(r.due))
        : addedLabel(r.createdAt)
      groups.set(key, [...(groups.get(key) ?? []), r])
    }
    return groups
  }

  const toggle = (r: Row) => {
    // done is per person: tick or untick yourself
    const mine = (r.doneBy ?? []).includes(me.id)
    const by = mine ? (r.doneBy ?? []).filter((x) => x !== me.id) : [...(r.doneBy ?? []), me.id]
    onChats((cs) => cs.map((c) => (c.id !== r.chat.id ? c : { ...c, insights: { ...c.insights, [r.list]: c.insights[r.list].map((x) => (x.id === r.id ? { ...x, doneBy: by, done: by.length > 0 } : x)) } })))
    api.updateItem(r.chat.id, r.id, { done: !mine }).catch(() => {})
  }


  /** Skip a keep / mark a plan as not relevant (or bring it back). */
  const skip = (r: Row) => {
    const next = !r.skipped
    onChats((cs) => cs.map((c) => (c.id !== r.chat.id ? c : { ...c, insights: { ...c.insights, [r.list]: c.insights[r.list].map((x) => (x.id === r.id ? { ...x, skipped: next } : x)) } })))
    api.updateItem(r.chat.id, r.id, { skipped: next }).catch(() => {})
  }

  const scoped = chats.filter((c) => !chatId || c.id === chatId)
  const count = (l: List) => all.filter((r) => r.list === l && (!chatId || r.chat.id === chatId) && isPending(r, l)).length

  return (
    <section className={`${className} flex-1 min-w-0 flex-col bg-canvas`}>
      <header className="px-6 lg:px-10 pt-5 pb-3 bg-white border-b border-slate-200/80">
        <h2 className="text-xl font-bold flex items-center gap-2"><button onClick={onBack} className="md:hidden -ml-1 p-1 rounded-lg hover:bg-slate-100"><ArrowLeft className="size-5" /></button>Organized for you</h2>
        <p className="text-sm text-slate-500">Everything from all your chats, without opening them</p>

        {/* status-style row: one circle per chat that has something pending */}
        {people.length > 0 && (
          <div className="mt-4 flex gap-3 overflow-x-auto scroll-thin pb-1">
            <Bubble label="All" active={!chatId} onClick={() => setChatId(null)}>✨</Bubble>
            {people.map((c) => (
              <Bubble key={c.id} label={c.name} badge={pendingIn(c)} active={chatId === c.id} tint={tintOf(c.id)} onClick={() => setChatId(chatId === c.id ? null : c.id)}>{c.emoji}</Bubble>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isList && FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${filter === f ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{f}</button>
          ))}
          {isList && (
            <label className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm">
              <CalendarDays className="size-3.5 text-slate-400" />
              <select value={when} onChange={(e) => setWhen(e.target.value as When)} className="bg-transparent outline-none text-sm text-slate-700 cursor-pointer">
                {WHEN.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </label>
          )}
          <label className={`${isList ? '' : 'ml-auto '}flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 w-full sm:w-52`}>
            <Search className="size-3.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}…`} className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
            {q && <button onClick={() => setQ('')}><X className="size-3.5 text-slate-400" /></button>}
          </label>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin px-6 lg:px-10 py-5">
        {tab === 'topics' ? <TopicsAll chats={scoped} q={q} onOpen={onOpenChat} />
        : tab === 'handy' ? <HandyAll chats={scoped} q={q} onOpen={onOpenChat} />
        : tab === 'library' ? <LibraryAll chats={scoped} q={q} onOpen={onOpenChat} />
        : (
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            {(['keeps', 'plans'] as const).map((list) => {
              const groups = groupsOf(list)
              const Icon = list === 'plans' ? CalendarHeart : Bookmark
              return (
                <section key={list} className="min-w-0">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Icon className={`size-4 ${list === 'plans' ? 'text-brand-500' : 'text-emerald-600'}`} />
                    {list === 'plans' ? 'Plans' : 'Keeps'}
                    <span className="rounded-full bg-slate-100 px-2 text-xs font-medium text-slate-500">{rowsOf(list).length}</span>
                  </h3>
                  {!groups.size ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 py-10 text-center text-sm text-slate-500">
                      <p className="text-2xl">{filter === 'Pending' ? '🌤️' : '🔍'}</p>
                      <p className="mt-1">{filter === 'Pending' ? (list === 'plans' ? 'No plans waiting' : 'Nothing to remember') : 'Nothing here'}</p>
                    </div>
                  ) : (
                  <div className="space-y-5">
                    {[...groups].map(([g, items]) => (
                      <div key={g}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{g}</p>
                        <ul className="rounded-2xl bg-white border border-slate-200/70 divide-y divide-slate-100 overflow-hidden">
                          {items.map((r) => (
                            <li key={r.chat.id + r.id} className="px-3.5 py-3 hover:bg-slate-50">
                             <div className="flex items-center gap-3">
                              <button onClick={() => setOpenRow(openRow === r.chat.id + r.id ? null : r.chat.id + r.id)} className="min-w-0 flex-1 text-left">
                                <p className={`text-[15px] ${r.done || r.skipped ? 'line-through text-slate-400' : 'text-slate-800'}`}>{r.text}</p>
                                {r.notes && openRow !== r.chat.id + r.id && <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{r.notes}</p>}
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                  <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 font-medium text-slate-700 ${tintOf(r.chat.id)}`}><span className="shrink-0">{r.chat.emoji}</span><span className="break-words">{r.chat.name}</span></span>
                                  {r.due && list === 'keeps' && <span className={isMissed(r) ? 'text-rose-600 font-medium' : ''}>{dayLabel(r.due)}</span>}
                                  {r.when && !r.due && <span>{r.when}</span>}
                                </div>
                              </button>
                              {r.assignee && <Avatar name={r.assignee} />}
                              {!r.skipped && <DoneButton done={!!r.done} label={r.list === 'plans' ? 'Happened' : 'Done'} onClick={() => toggle(r)} />}
                      <button onClick={() => skip(r)} title={r.skipped ? 'Bring it back' : r.list === 'plans' ? 'Not happening / not relevant' : 'Skip, not needed'} className={`shrink-0 h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1 transition ${r.skipped ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50'}`}><Ban className="size-3.5" />{r.skipped ? 'Bring back' : r.list === 'plans' ? 'Not relevant' : 'Skip'}</button>
                              <GoChat onClick={() => onOpenItem(r.chat.id, r.id, r.list)} />
                             </div>
                             {r.list === 'plans' && !r.done && (
                               <div className="ml-8 mt-2">
                                 <VoteBar it={r} chatId={r.chat.id} people={r.chat.people} meId={me.id} onVoted={(v) => onChats((cs) => cs.map((c) => (c.id !== r.chat.id ? c : { ...c, insights: { ...c.insights, plans: c.insights.plans.map((x) => (x.id === v.id ? v : x)) } })))} />
                               </div>
                             )}
                             {openRow === r.chat.id + r.id && (
                               <div className="ml-8 mt-2 space-y-1.5 text-sm text-slate-600">
                                 {r.notes && <p className="whitespace-pre-wrap">{r.notes}</p>}
                                 {r.when && <p className="text-xs text-slate-500">🕒 {r.when}</p>}
                                 {r.assignee && <p className="text-xs text-slate-500">👤 {r.assignee}</p>}
                                 {!!r.subtasks?.length && (
                                   <ul className="space-y-0.5">{r.subtasks.map((st) => <li key={st.id} className={`flex items-center gap-1.5 ${st.done ? 'line-through text-slate-400' : ''}`}><span className="text-slate-400">•</span>{st.text}</li>)}</ul>
                                 )}
                                 {!r.notes && !r.when && !r.assignee && !r.subtasks?.length && <p className="text-xs text-slate-400">No more details. Tap the arrow to see it in the chat.</p>}
                               </div>
                             )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <nav className="shrink-0 bg-white border-t border-slate-200/80 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1 overflow-x-auto scroll-thin">
          {TABS.map(({ id, label, icon: Icon }) => {
            const on = tab === id
            const n = id === 'both' ? count('plans') + count('keeps') : 0
            return (
              <button key={id} onClick={() => setTab(id)} className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition ${on ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                <Icon className="size-4" /> {label}
                {!!n && <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center ${on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{n}</span>}
              </button>
            )
          })}
        </div>
      </nav>
    </section>
  )
}

function Bubble({ label, active, tint = 'bg-brand-50', badge, onClick, children }: { label: string; active: boolean; tint?: string; badge?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 w-16 shrink-0">
      <span className={`relative size-14 rounded-full p-[3px] ${active ? 'bg-gradient-to-tr from-brand-500 to-violet-500' : badge ? 'bg-gradient-to-tr from-emerald-400 to-sky-400' : 'bg-slate-200'}`}>
        <span className={`size-full rounded-full ${tint} ring-2 ring-white grid place-items-center text-2xl`}>{children}</span>
        {!!badge && <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-brand-500 text-white text-[10px] font-bold grid place-items-center ring-2 ring-white">{badge}</span>}
      </span>
      <span className={`text-[11px] truncate w-full text-center ${active ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>{label}</span>
    </button>
  )
}

const ChatTag = ({ chat }: { chat: Chat }) => <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-slate-600 ${tintOf(chat.id)}`}>{chat.emoji} {chat.name}</span>
const None = ({ text }: { text: string }) => <p className="text-sm text-slate-400 text-center px-4 py-16">{text}</p>
const has = (q: string, ...xs: (string | undefined)[]) => !q.trim() || xs.some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()))

function TopicsAll({ chats, q, onOpen }: { chats: Chat[]; q: string; onOpen: (id: string) => void }) {
  // the same topic in several chats becomes one card
  const byName = new Map<string, { name: string; refs: { c: Chat; about?: string }[] }>()
  for (const c of chats)
    for (const t of c.insights?.topics ?? []) {
      const key = t.trim().toLowerCase()
      const g = byName.get(key) ?? { name: t, refs: [] }
      g.refs.push({ c, about: c.insights.topicNotes?.[t] })
      byName.set(key, g)
    }
  const rows = [...byName.values()].filter((g) => has(q, g.name, ...g.refs.flatMap((r) => [r.c.name, r.about])))
  if (!rows.length) return <None text="Topics show up when a chat talks about something at length." />
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((g) => (
        <div key={g.name} className="rounded-2xl bg-white border border-slate-200/70 px-4 py-3">
          <p className="font-semibold text-slate-800 flex items-center gap-1.5"><Hash className="size-4 text-brand-500" />{g.name}
            {g.refs.length > 1 && <span className="ml-auto text-[11px] font-medium text-brand-600 bg-brand-50 rounded-full px-2 py-0.5">In {g.refs.length} chats</span>}
          </p>
          <div className="mt-2 space-y-2.5">
            {g.refs.map(({ c, about }) => (
              <div key={c.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <ChatTag chat={c} />
                  <p className="mt-1 text-sm text-slate-600 leading-relaxed">{about || 'Talked about at length in this chat.'}</p>
                </div>
                <GoChat onClick={() => onOpen(c.id)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function HandyAll({ chats, q, onOpen }: { chats: Chat[]; q: string; onOpen: (id: string, mid?: string) => void }) {
  const rows = chats.flatMap((c) => (c.insights?.knowledge ?? []).filter((it) => has(q, it.text, it.notes, c.name)).map((it) => ({ it, c })))
  if (!rows.length) return <None text="Addresses, booking numbers and other handy facts collect here." />
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map(({ it, c }) => (
        <div key={c.id + it.id} className="rounded-2xl bg-white border border-amber-100 shadow-sm px-4 py-3 text-sm text-slate-700">
          <span className="text-lg">💡</span> {it.text}
          {it.notes && <p className="mt-1 text-slate-500">{it.notes}</p>}
          <div className="mt-2 flex items-center"><ChatTag chat={c} /><span className="ml-auto"><GoChat onClick={() => onOpen(c.id, it.sourceIds?.[0])} /></span></div>
        </div>
      ))}
    </div>
  )
}

function LibraryAll({ chats, q, onOpen }: { chats: Chat[]; q: string; onOpen: (id: string, mid?: string) => void }) {
  const [libs, setLibs] = useState<Record<string, Library>>({})
  const ids = chats.map((c) => c.id).join(',')
  useEffect(() => {
    const load = () => Promise.all(chats.map((c) => api.library(c.id).then((l) => [c.id, l] as const).catch(() => [c.id, {}] as const))).then((r) => setLibs(Object.fromEntries(r)))
    load()
    socket.on('message:update', load)
    return () => { socket.off('message:update', load) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  const files = chats.flatMap((c) => Object.values(libs[c.id] ?? {}).flatMap((cats) => Object.values(cats).flat().filter((f) => has(q, f.name, f.caption, f.category, c.name)).map((f) => ({ f, c }))))
    .sort((a, b) => +new Date(b.f.createdAt) - +new Date(a.f.createdAt))
  if (!files.length) return <None text="Photos, videos, voice notes and files from all your chats land here." />
  return (
    <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
      {files.map(({ f, c }) => (
        <a key={c.id + f.messageId + f.url} href={f.url} target="_blank" rel="noreferrer" title={`${c.name}: ${f.caption || f.name}`} className="relative aspect-square rounded-xl overflow-hidden bg-white border border-slate-200/70 grid place-items-center group">
          {f.kind === 'image' ? <img src={f.url} className="size-full object-cover group-hover:scale-105 transition" /> : (
            <div className="flex flex-col items-center gap-1 p-1 text-slate-500">
              {f.kind === 'audio' ? <Mic className="size-6" /> : f.kind === 'video' ? <Video className="size-6" /> : <FileText className="size-6" />}
              <span className="text-[10px] leading-tight line-clamp-2 text-center">{f.kind === 'audio' ? 'Voice note' : f.name}</span>
            </div>
          )}
          <span className="absolute bottom-1 left-1 text-sm drop-shadow">{c.emoji}</span>
          <button onClick={(e) => { e.preventDefault(); onOpen(c.id, f.messageId) }} title={`Open in ${c.name}`} className="absolute top-1 right-1 size-7 rounded-full bg-white/90 shadow grid place-items-center text-slate-600 hover:text-brand-600"><ChevronRight className="size-4" /></button>
        </a>
      ))}
    </div>
  )
}

/** The only way from here into a chat: an explicit arrow, so tapping a card never jumps away. */
function GoChat({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Open in chat" className="shrink-0 size-8 rounded-full grid place-items-center text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition">
      <ChevronRight className="size-5" />
    </button>
  )
}
