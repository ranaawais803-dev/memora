import { useEffect, useState } from 'react'
import { RefreshCw, Mic, FileText, Video, ExternalLink, Loader2, Sun, Bookmark, CalendarHeart, Hash, Images, Lightbulb, CalendarDays, Info as InfoIcon, ArrowLeft, MessageSquare, Image as ImageIcon } from 'lucide-react'
import Info, { InfoStrip } from './Info'
import Tasks, { Avatar, dayLabel, isMissed, isPending } from './Tasks'
import { ModeSwitch } from './ChatView'
import { ChatIconInner, tintOf } from './Sidebar'
import type { ViewMode } from './App'
import { ChatStatuses, type StatusGroup } from './Status'
import { api, socket, timeShort, type Chat, type Insights, type Item, type Library, type List, type Period, type SearchResult } from './api'

/** The vision's own words: Keeps, Plans, Topics. Nothing that sounds like work software. */
const TABS = [
  { id: 'summary', label: 'Overview', icon: Sun },
  { id: 'keeps', label: 'Keeps', icon: Bookmark },
  { id: 'plans', label: 'Plans', icon: CalendarHeart },
  { id: 'topics', label: 'Topics', icon: Hash },
  { id: 'library', label: 'Library', icon: Images },
  { id: 'facts', label: 'Handy', icon: Lightbulb },
] as const
type Tab = (typeof TABS)[number]['id'] | 'info'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
]

export interface Focus { id: string; list: List; n: number }

interface Props {
  chat: Chat
  me: string
  ins: Insights | null
  setIns: React.Dispatch<React.SetStateAction<Insights | null>>
  focus: Focus | null
  wide?: boolean
  mode: ViewMode
  onMode: (m: ViewMode) => void
  onJump: (messageId: string) => void
  meId: string
  statusGroups: StatusGroup[]
  onViewStatus: (userId: string) => void
  className?: string
}

export default function Organized({ chat, me, ins, setIns, focus, mode, onMode, onJump, meId, statusGroups, onViewStatus, className = '' }: Props) {
  const [tab, setTab] = useState<Tab>('summary')
  const [topic, setTopic] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // tapping a keep/plan chip in the chat lands here on that item
  useEffect(() => {
    if (focus) setTab(focus.list)
  }, [focus])

  const refresh = async () => {
    setBusy(true)
    try { setIns(await api.refresh(chat.id)) } finally { setBusy(false) }
  }

  const setList = (list: List) => (items: Item[]) => setIns((i) => (i ? { ...i, [list]: items } : i))
  const counts: Partial<Record<Tab, number>> = { keeps: ins?.keeps.filter((k) => !k.done).length, plans: ins?.plans.filter((p) => isPending(p, 'plans')).length }
  const openTopic = (t: string) => { setTopic(t); setTab('topics') }

  return (
    <aside className={`${className} flex-col border-l border-slate-200/80 bg-canvas`}>
      <header className="h-16 shrink-0 flex items-center gap-3 px-4 md:px-5 bg-white border-b border-slate-200/80">
        <div className={`size-10 shrink-0 rounded-2xl ${tintOf(chat.id)} grid place-items-center text-xl lg:hidden`}><ChatIconInner chat={chat} /></div>
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight truncate">Organized for you</h3>
          <p className="text-xs text-slate-400 truncate">{ins?.updatedAt ? `Updated ${timeShort(ins.updatedAt)}` : 'Sorting things out…'}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setTab(tab === 'info' ? 'summary' : 'info')} title="Details & stats" className={`size-9 grid place-items-center rounded-xl ${tab === 'info' ? 'bg-brand-50 text-brand-600' : 'hover:bg-slate-100 text-slate-500'}`}>
            <InfoIcon className="size-4" />
          </button>
          <button onClick={refresh} title="Refresh" className="size-9 grid place-items-center rounded-xl hover:bg-slate-100 text-slate-500">
            <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <ModeSwitch mode={mode} onMode={onMode} />
        </div>
      </header>

      {tab !== 'info' && <InfoStrip chat={chat} onOpen={() => setTab('info')} />}

      <div className="flex-1 overflow-y-auto scroll-thin p-3 md:p-5">
        {!ins ? (
          <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Sorting things out…</p>
        ) : tab === 'summary' ? (
          <div className="space-y-4">
            {statusGroups.some((g) => chat.people.some((p) => p.id === g.userId)) && (
              <Card>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2.5">Status</p>
                <ChatStatuses memberIds={chat.people.map((p) => p.id)} groups={statusGroups} meId={meId} onView={onViewStatus} />
              </Card>
            )}
            <Summary ins={ins} onTopic={openTopic} onTab={setTab} />
          </div>
        ) : tab === 'keeps' || tab === 'plans' ? (
          <Card>
            <Tasks
              key={tab}
              chat={chat}
              me={me}
              list={tab}
              items={ins[tab]}
              empty={tab === 'keeps' ? 'Nothing to remember yet. Things like “buy milk tomorrow” or “renew passport” show up here by themselves.' : 'No plans yet. When everyone agrees on something, like “dinner Friday”, it lands here.'}
              onItems={setList(tab)}
              focusId={focus?.list === tab ? focus.id + ':' + focus.n : undefined}
              onJump={onJump}
            />
          </Card>
        ) : tab === 'topics' ? (
          <Topics chat={chat} topics={ins.topics} active={topic} onPick={setTopic} onJump={onJump} />
        ) : tab === 'info' ? (
          <Info chat={chat} />
        ) : tab === 'library' ? (
          <Card><MediaLibrary chatId={chat.id} onJump={onJump} /></Card>
        ) : (
          <Knowledge items={ins.knowledge} />
        )}
      </div>

      {/* bottom tab bar, like a phone app */}
      <nav className="shrink-0 bg-white border-t border-slate-200/80 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-1 overflow-x-auto scroll-thin">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); if (t.id !== 'topics') setTopic(null) }}
                className={`shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition ${on ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
              >
                <t.icon className="size-4 shrink-0" />
                <span>{t.label}</span>
                {!!counts[t.id] && <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold grid place-items-center ${on ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts[t.id]}</span>}
              </button>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl bg-white border border-slate-200/70 shadow-sm p-4 ${className}`}>{children}</div>
)

function Summary({ ins, onTopic, onTab }: { ins: Insights; onTopic: (t: string) => void; onTab: (t: Tab) => void }) {
  // What's coming up: anything with a date that isn't done yet, soonest first.
  const coming = [...ins.plans.map((i) => ({ ...i, kind: 'plans' as const })), ...ins.keeps.map((i) => ({ ...i, kind: 'keeps' as const }))]
    .filter((t) => t.due && isPending(t, t.kind))
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 6)
  const newKeeps = ins.keeps.filter((k) => !k.done).length
  const newPlans = ins.plans.filter((p) => !p.done).length

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onTab('keeps')} className="flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1.5 text-sm font-medium hover:bg-emerald-100"><Bookmark className="size-3.5" />{newKeeps} to remember</button>
          <button onClick={() => onTab('plans')} className="flex items-center gap-1.5 rounded-full bg-brand-50 text-brand-700 px-3 py-1.5 text-sm font-medium hover:bg-brand-100"><CalendarHeart className="size-3.5" />{newPlans} plans</button>
        </div>
        {ins.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {ins.topics.map((t) => <button key={t} onClick={() => onTopic(t)} className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">#{t}</button>)}
          </div>
        )}
      </Card>

      {coming.length > 0 && (
        <Card>
          <h4 className="font-semibold">Coming up</h4>
          <ul className="mt-2 divide-y divide-slate-100">
            {coming.map((t) => (
              <li key={t.id}>
                <button onClick={() => onTab(t.kind)} className="w-full flex items-center gap-3 py-2.5 text-left">
                  <span className={`size-8 shrink-0 rounded-xl grid place-items-center ${t.kind === 'plans' ? 'bg-brand-50 text-brand-500' : 'bg-emerald-50 text-emerald-600'}`}>
                    {t.kind === 'plans' ? <CalendarHeart className="size-4" /> : <Bookmark className="size-4" />}
                  </span>
                  <span className="flex-1 min-w-0 text-sm truncate">{t.text}</span>
                  <span className={`text-xs font-medium flex items-center gap-1 shrink-0 ${isMissed(t) ? 'text-rose-500' : 'text-slate-500'}`}><CalendarDays className="size-3" />{dayLabel(t.due!)}</span>
                  {t.assignee && <Avatar name={t.assignee} />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Recap ins={ins} />
    </div>
  )
}

/** Picks the window that fits how long the chat has been going: a 2-day chat gets "This week", a 3-month one "This year". */
function autoPeriod(ins: Insights): Period {
  const age = ins.firstAt ? (Date.now() - +new Date(ins.firstAt)) / 86400000 : 0
  const fits: Period = age < 1 ? 'today' : age < 7 ? 'week' : age < 30 ? 'month' : 'year'
  // fall back to the nearest window that actually has something to say
  const order: Period[] = ['today', 'week', 'month', 'year']
  const from = order.indexOf(fits)
  return [...order.slice(from), ...order.slice(0, from).reverse()].find((p) => ins.summaries[p]) ?? fits
}

/** One summary card, with a window filter on the right. */
function Recap({ ins }: { ins: Insights }) {
  const auto = autoPeriod(ins)
  const [picked, setPicked] = useState<Period | null>(null)
  const period = picked ?? auto
  // a longer window that adds nothing new just repeats the shorter one
  const text = ins.summaries[period] || PERIODS.slice(0, PERIODS.findIndex((p) => p.id === period)).reverse().map((p) => ins.summaries[p.id]).find(Boolean)

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h4 className="font-semibold flex-1">What's been happening</h4>
        <div className="flex p-0.5 rounded-lg bg-slate-100 text-xs font-medium">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPicked(p.id === auto ? null : p.id)}
              title={p.id === auto ? 'Picked automatically for this chat' : undefined}
              className={`px-2 py-1 rounded-md transition ${period === p.id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {p.label.replace('This ', '')}
            </button>
          ))}
        </div>
      </div>
      <p className={`text-sm mt-3 leading-relaxed ${text ? 'text-slate-700' : 'text-slate-400'}`}>{text || 'Quiet. Nothing new.'}</p>
      <p className="text-[11px] text-slate-400 mt-2">{picked ? <button onClick={() => setPicked(null)} className="hover:text-brand-600">Back to auto</button> : <>Auto · {PERIODS.find((p) => p.id === auto)!.label.toLowerCase()}</>}</p>
    </Card>
  )
}

/** Topics: conversations grouped by what they're about. Tapping one gathers everything on it. */
function Topics({ chat, topics, active, onPick, onJump }: { chat: Chat; topics: string[]; active: string | null; onPick: (t: string | null) => void; onJump: (id: string) => void }) {
  const [results, setResults] = useState<SearchResult[] | null>(null)

  useEffect(() => {
    if (!active) return setResults(null)
    setResults(null)
    api.search(active).then((r) => setResults(r.filter((x) => x.chatId === chat.id)))
  }, [active, chat.id])

  if (!topics.length) return <Card><Empty text="As you chat, conversations group themselves into topics like Vacation, School or Football." /></Card>

  if (!active)
    return (
      <div className="grid grid-cols-2 gap-3">
        {topics.map((t, i) => (
          <button key={t} onClick={() => onPick(t)} className="text-left rounded-2xl bg-white border border-slate-200/70 shadow-sm p-4 hover:shadow-md transition">
            <span className={`size-9 rounded-xl grid place-items-center text-lg ${['bg-rose-50', 'bg-amber-50', 'bg-emerald-50', 'bg-sky-50', 'bg-violet-50'][i % 5]}`}>#</span>
            <p className="font-semibold mt-2">{t}</p>
            <p className="text-xs text-slate-400">See everything about it</p>
          </button>
        ))}
      </div>
    )

  return (
    <Card>
      <button onClick={() => onPick(null)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="size-4" /> All topics</button>
      <h4 className="text-lg font-bold mt-2">#{active}</h4>
      {!results ? (
        <p className="text-sm text-slate-400 mt-3 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Gathering…</p>
      ) : !results.length ? (
        <p className="text-sm text-slate-400 mt-3">Nothing mentions “{active}” word for word yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {results.map((r, i) => {
            const Icon = r.type === 'keep' ? Bookmark : r.type === 'plan' ? CalendarHeart : r.type === 'knowledge' ? Lightbulb : r.type === 'image' ? ImageIcon : r.type === 'voice' || r.type === 'audio' ? Mic : r.type === 'file' ? FileText : MessageSquare
            return (
              <li key={i}>
                <button onClick={() => r.messageId && onJump(r.messageId)} className="w-full flex gap-3 py-2.5 text-left">
                  {r.media?.kind === 'image' ? <img src={r.media.url} className="size-9 rounded-lg object-cover shrink-0" /> : <span className="size-9 rounded-lg bg-slate-100 text-slate-500 grid place-items-center shrink-0"><Icon className="size-4" /></span>}
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-700 line-clamp-2">{r.text}</span>
                    <span className="block text-xs text-slate-400 mt-0.5">{r.sender ?? (r.type === 'keep' ? 'Keep' : r.type === 'plan' ? 'Plan' : 'Good to know')}{r.createdAt && ` · ${timeShort(r.createdAt)}`}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function Knowledge({ items }: { items: Item[] }) {
  if (!items.length) return <Card><Empty text="Addresses, booking numbers, recipes and other handy facts from this chat will collect here." /></Card>
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((it) => (
        <div key={it.id} className="rounded-2xl bg-white border border-amber-100 shadow-sm px-4 py-3 text-sm text-slate-700">
          <span className="text-lg">💡</span>
          <p className="mt-1">{it.text}</p>
          {it.when && <span className="block text-xs text-amber-700 mt-1">{it.when}</span>}
        </div>
      ))}
    </div>
  )
}

function MediaLibrary({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const [lib, setLib] = useState<Library | null>(null)
  useEffect(() => {
    const load = () => api.library(chatId).then(setLib)
    load()
    socket.on('message:update', load)
    return () => { socket.off('message:update', load) }
  }, [chatId])
  if (!lib) return null
  const years = Object.keys(lib).sort().reverse()
  if (!years.length) return <Empty text="Photos, videos, voice notes and files you share sort themselves into folders here, by year." />
  return (
    <div className="space-y-6">
      {years.map((y) => (
        <section key={y}>
          <h4 className="text-lg font-bold text-slate-800 mb-2">{y}</h4>
          <div className="space-y-4">
            {Object.entries(lib[y]).map(([cat, files]) => (
              <div key={cat}>
                <p className="text-sm font-semibold text-slate-600 mb-1.5">📁 {cat} <span className="text-slate-400 font-normal">· {files.length}</span></p>
                <div className="grid gap-1.5 grid-cols-3 md:grid-cols-4">
                  {files.map((f) => (
                    <button key={f.messageId} onClick={() => onJump(f.messageId)} title={f.caption || f.name} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 grid place-items-center group">
                      {f.kind === 'image' ? (
                        <img src={f.url} className="size-full object-cover group-hover:scale-105 transition" />
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-1 text-slate-500">
                          {f.kind === 'audio' ? <Mic className="size-6" /> : f.kind === 'video' ? <Video className="size-6" /> : <FileText className="size-6" />}
                          <span className="text-[10px] leading-tight line-clamp-2 text-center">{f.kind === 'audio' ? 'Voice note' : f.name}</span>
                        </div>
                      )}
                      {f.driveLink && (
                        <a href={f.driveLink} target="_blank" onClick={(e) => e.stopPropagation()} className="absolute top-1 right-1 size-6 rounded-full bg-white/90 grid place-items-center opacity-0 group-hover:opacity-100" title="Open in Drive">
                          <ExternalLink className="size-3 text-slate-600" />
                        </a>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const Empty = ({ text }: { text: string }) => <p className="text-sm text-slate-400 text-center px-4 py-10 leading-relaxed">{text}</p>
