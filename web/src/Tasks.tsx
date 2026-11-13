import { useEffect, useState } from 'react'
import { Ban, Check, Plus, Sparkles, Trash2, CalendarDays, Star, List as ListIcon, X, AlignLeft, Search, MessageSquare } from 'lucide-react'
import { api, type Chat, type Item, type List, type Person, type Subtask, type Vote } from './api'

/** Friendly words only: Weave should feel like chat, not work software. */
const FILTERS = ['Pending', 'Mine', 'Missed', 'Past', 'Done', 'Not needed', 'All'] as const
type Filter = (typeof FILTERS)[number]

/** A plan whose date has gone by is "past", not pending. Keeps with a passed date are "missed" and still pending. */
export const isPast = (it: Item, list: List) => list === 'plans' && !it.done && !it.skipped && !!it.due && it.due < new Date().toISOString().slice(0, 10)
export const isPending = (it: Item, list: List) => !it.done && !it.skipped && !isPast(it, list)

const WHEN = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'month', label: 'Next 30 days' },
  { id: 'past', label: 'Past dates' },
  { id: 'none', label: 'No date' },
] as const
type When = (typeof WHEN)[number]['id']

const shift = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const matchWhen = (it: Item, w: When) => {
  if (w === 'any') return true
  if (w === 'none') return !it.due
  if (!it.due) return false
  if (w === 'past') return it.due < today()
  if (w === 'today') return it.due === today()
  return it.due >= today() && it.due <= shift(w === 'week' ? 7 : 30)
}

const today = () => new Date().toISOString().slice(0, 10)
export const isMissed = (it: Item) => !it.done && !it.skipped && !!it.due && it.due < today()
export const dayLabel = (due: string) => {
  const days = Math.round((+new Date(due) - +new Date(today())) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${-days} days ago`
  if (days < 7) return new Date(due).toLocaleDateString([], { weekday: 'long' })
  return new Date(due).toLocaleDateString([], { day: 'numeric', month: 'short' })
}
const uid = () => crypto.randomUUID()

const COLORS = ['bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-pink-100 text-pink-700']
const colorOf = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
/** Profile photos by person name, filled from the chat list (see App). Avatars fall back to the first letter. */
export const photoBook = new Map<string, string>()
export const Avatar = ({ name, size = 'size-6', src }: { name: string; size?: string; src?: string }) => {
  const photo = src ?? photoBook.get(name)
  return photo
    ? <img src={photo} title={name} alt={name} className={`${size} shrink-0 rounded-full object-cover`} />
    : <span title={name} className={`${size} shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${colorOf(name)}`}>{name[0]?.toUpperCase()}</span>
}

/** Keeps or Plans: found in the chat automatically, and easy to tweak or add to. */
interface TasksProps {
  chat: Chat
  me: string
  list: List
  items: Item[]
  empty: string
  onItems: (items: Item[]) => void
  focusId?: string // "<itemId>:<nonce>": open + scroll to this item
  onJump: (messageId: string) => void
}

export default function Tasks({ chat, me, list, items, empty, onItems, focusId, onJump }: TasksProps) {
  const [filter, setFilter] = useState<Filter>('Pending')
  const [when, setWhen] = useState<When>('any')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const isPlan = list === 'plans'
  const meId = chat.people.find((p) => p.name === me)?.id

  // arriving from a chip in the chat: show the item whatever the filters say, open it, scroll to it
  useEffect(() => {
    const id = focusId?.split(':')[0]
    const it = id && items.find((x) => x.id === id)
    if (!it) return
    setQ('')
    setWhen('any')
    setFilter(it.done ? 'Done' : isPast(it, list) ? 'Past' : 'Pending')
    setOpen(it.id)
    setTimeout(() => {
      const el = document.getElementById(`item-${it.id}`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('ring-2', 'ring-amber-300')
      setTimeout(() => el?.classList.remove('ring-2', 'ring-amber-300'), 1600)
    }, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const patch = (it: Item, p: Partial<Item>) => {
    onItems(items.map((x) => (x.id === it.id ? { ...x, ...p, edited: x.edited || Object.keys(p).some((k) => k !== 'done') } : x)))
    api.updateItem(chat.id, it.id, p)
  }
  /** Done is per person: tick or untick yourself; it shows as done while anyone has ticked it. */
  const toggleMine = (it: Item) => {
    const mine = !!meId && (it.doneBy ?? []).includes(meId)
    const by = mine ? (it.doneBy ?? []).filter((x) => x !== meId) : [...(it.doneBy ?? []), ...(meId ? [meId] : [])]
    onItems(items.map((x) => (x.id === it.id ? { ...x, doneBy: by, done: by.length > 0 } : x)))
    api.updateItem(chat.id, it.id, { done: !mine })
  }
  const remove = (it: Item) => {
    onItems(items.filter((x) => x.id !== it.id))
    setOpen(null)
    api.deleteItem(chat.id, it.id)
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    const item = await api.addItem(chat.id, list, { text: draft.trim() })
    setDraft('')
    onItems([item, ...items])
  }

  const match = (it: Item, f: Filter) =>
    f === 'Pending' ? isPending(it, list)
    : f === 'Done' ? !!it.done
    : f === 'Not needed' ? !!it.skipped
    : f === 'Mine' ? isPending(it, list) && it.assignee === me
    : f === 'Missed' ? !isPlan && isMissed(it)
    : f === 'Past' ? isPast(it, list)
    : true
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hit = (it: Item) => {
    if (!terms.length) return true
    const hay = [it.text, it.notes, it.assignee, it.when, ...(it.subtasks ?? []).map((s) => s.text)].join(' ').toLowerCase()
    return terms.every((t) => hay.includes(t))
  }
  // the date filter and search narrow every status filter (and its count)
  const base = items.filter((it) => matchWhen(it, when) && hit(it))
  const shown = base
    .filter((it) => match(it, filter))
    .sort((a, b) => Number(!!a.done) - Number(!!b.done) || Number(b.priority === 'high') - Number(a.priority === 'high') || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
  const count = (f: Filter) => base.filter((it) => match(it, f)).length
  const filters = FILTERS.filter((f) => f === 'Pending' || f === 'All' || f === filter || count(f) > 0)
  const narrowed = when !== 'any' || terms.length > 0

  return (
    <div>
      <form onSubmit={add} className="flex items-center gap-2 rounded-xl bg-slate-50 border border-transparent px-3 py-2 focus-within:bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100 mb-3 transition">
        <Plus className="size-4 text-slate-400" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={isPlan ? 'Add a plan, e.g. Dinner Friday' : 'Add something to remember'} className="flex-1 bg-transparent outline-none text-sm" />
      </form>

      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <label className="flex-1 min-w-0 flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 h-8 focus-within:border-brand-500">
            <Search className="size-3.5 text-slate-400 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${isPlan ? 'plans' : 'keeps'}`} className="flex-1 min-w-0 bg-transparent outline-none text-xs" />
            {q && <button onClick={() => setQ('')}><X className="size-3.5 text-slate-400" /></button>}
          </label>
          <label className={`shrink-0 flex items-center gap-1 rounded-lg border px-2 h-8 text-xs ${when !== 'any' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
            <CalendarDays className="size-3.5 shrink-0" />
            <select value={when} onChange={(e) => setWhen(e.target.value as When)} className="bg-transparent outline-none cursor-pointer">
              {WHEN.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {filters.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs font-medium ${filter === f ? 'bg-slate-800 text-white' : f === 'Missed' ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100'}`}>
              {f} {f !== 'All' && <span className="opacity-70">{count(f)}</span>}
            </button>
          ))}
        </div>
      )}

      {!items.length ? (
        <p className="text-sm text-slate-400 text-center px-4 py-10 leading-relaxed">{empty}</p>
      ) : !shown.length ? (
        <div className="text-sm text-slate-400 text-center py-8">
          {filter === 'Pending' && !narrowed ? 'All caught up 🎉' : 'Nothing matches.'}
          {narrowed && <button onClick={() => { setQ(''); setWhen('any') }} className="block mx-auto mt-2 text-xs text-brand-600 hover:underline">Clear search & dates</button>}
        </div>
      ) : (
        <ul className="space-y-1">
          {shown.map((it) => (
            <li key={it.id} id={`item-${it.id}`} className={`rounded-xl transition ${open === it.id ? 'bg-slate-50 ring-1 ring-slate-200' : 'hover:bg-slate-50'}`}>
              <Row it={it} isPlan={isPlan} past={isPast(it, list)} onToggle={() => toggleMine(it)} onSkip={() => patch(it, { skipped: !it.skipped })} onOpen={() => setOpen(open === it.id ? null : it.id)} onJump={onJump} />
              {isPlan && !it.done && <div className="pl-10 pr-2 pb-2.5 -mt-1"><VoteBar it={it} chatId={chat.id} people={chat.people} meId={chat.people.find((p) => p.name === me)?.id} onVoted={(v) => onItems(items.map((x) => (x.id === it.id ? v : x)))} /></div>}
              {open === it.id && <Editor it={it} chat={chat} list={list} onPatch={(p) => patch(it, p)} onMove={(l) => { onItems(items.filter((x) => x.id !== it.id)); api.updateItem(chat.id, it.id, { list: l }) }} onDelete={() => remove(it)} onJump={onJump} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ it, isPlan, past, onToggle, onSkip, onOpen, onJump }: { it: Item; isPlan: boolean; past: boolean; onToggle: () => void; onSkip: () => void; onOpen: () => void; onJump: (id: string) => void }) {
  const steps = it.subtasks ?? []
  const stepsDone = steps.filter((s) => s.done).length
  return (
    <div className="flex items-start gap-3 pl-3 pr-2 py-2.5">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={`block text-sm ${it.done || it.skipped ? 'line-through text-slate-400' : 'text-slate-700'}`}>
          {it.skipped && <span className="mr-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 no-underline inline-block">Not needed</span>}
          {it.priority === 'high' && !it.done && <Star className="inline size-3.5 mr-1 -mt-0.5 text-amber-400 fill-amber-400" />}
          {it.text}
        </span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs">
          {it.due ? (
            <span className={`flex items-center gap-1 font-medium ${past ? 'text-slate-400' : isMissed(it) ? 'text-rose-500' : 'text-brand-500'}`}><CalendarDays className="size-3" />{dayLabel(it.due)}</span>
          ) : it.when ? (
            <span className="text-brand-500 font-medium">{it.when}</span>
          ) : null}
          {steps.length > 0 && <span className={`flex items-center gap-1 ${stepsDone === steps.length ? 'text-emerald-600' : 'text-slate-400'}`}><ListIcon className="size-3" />{stepsDone}/{steps.length}</span>}
          {it.notes && <AlignLeft className="size-3 text-slate-400" />}
          {it.source === 'ai' && !it.edited && <span title="Picked up from the chat" className="text-violet-400"><Sparkles className="size-3" /></span>}
        </span>
      </button>
      {!!it.sourceIds?.length && (
        <button onClick={() => onJump(it.sourceIds![0])} title="Show in chat" className="size-6 shrink-0 grid place-items-center rounded-full text-slate-400 hover:bg-brand-50 hover:text-brand-600">
          <MessageSquare className="size-3.5" />
        </button>
      )}
      {it.assignee && <Avatar name={it.assignee} />}
      {!it.skipped && <DoneButton done={!!it.done} label={(isPlan ? 'Happened' : 'Done') + ((it.doneBy?.length ?? 0) > 1 ? ` · ${it.doneBy!.length}` : '')} onClick={onToggle} />}
      <button onClick={onSkip} title={it.skipped ? 'Bring it back' : isPlan ? 'Not happening / not relevant' : 'Skip, not needed'} className={`shrink-0 h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1 transition ${it.skipped ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 text-slate-500 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50'}`}><Ban className="size-3.5" />{it.skipped ? 'Bring back' : isPlan ? 'Not relevant' : 'Skip'}</button>
    </div>
  )
}

/** Right-hand done toggle: an outlined pill, solid green once done. */
export function DoneButton({ done, label = 'Done', onClick }: { done: boolean; label?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={done ? 'Not done yet' : `Mark as ${label.toLowerCase()}`}
      className={`shrink-0 h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1 transition ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'}`}>
      <Check className="size-3.5" strokeWidth={3} />{done ? label : label}
    </button>
  )
}

function Editor({ it, chat, list, onPatch, onMove, onDelete, onJump }: { it: Item; chat: Chat; list: List; onPatch: (p: Partial<Item>) => void; onMove: (l: List) => void; onDelete: () => void; onJump: (id: string) => void }) {
  const [text, setText] = useState(it.text)
  const [notes, setNotes] = useState(it.notes ?? '')
  const [step, setStep] = useState('')
  const isPlan = list === 'plans'
  const steps = it.subtasks ?? []
  const setSteps = (s: Subtask[]) => onPatch({ subtasks: s })
  const important = it.priority === 'high'
  const field = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500'
  const label = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'

  return (
    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-200/70">
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== it.text && onPatch({ text: text.trim() })} className={`${field} font-medium`} />
        <button onClick={() => onPatch({ priority: important ? 'normal' : 'high' })} title={important ? 'Important' : 'Mark as important'} className={`shrink-0 size-8 grid place-items-center rounded-lg border ${important ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
          <Star className={`size-4 ${important ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
        </button>
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (it.notes ?? '') && onPatch({ notes })} rows={2} placeholder="Add a note…" className={`${field} resize-none`} />

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={label}>{isPlan ? "Who's sorting it" : 'Who'}</span>
          <select value={it.assignee ?? ''} onChange={(e) => onPatch({ assignee: e.target.value })} className={field}>
            <option value="">Anyone</option>
            {chat.members.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>When</span>
          <div className="relative">
            <input type="date" value={it.due ?? ''} onChange={(e) => onPatch({ due: e.target.value })} className={field} />
            {it.due && <button onClick={() => onPatch({ due: '' })} className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="size-3.5" /></button>}
          </div>
        </label>
      </div>

      {(
        <div className="space-y-1">
          <span className={label}>List</span>
          {steps.map((s) => (
            <div key={s.id} className="group flex items-center gap-2 py-0.5">
              <button onClick={() => setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))} className={`size-4 shrink-0 rounded border-2 grid place-items-center ${s.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'}`}>
                {s.done && <Check className="size-2.5" strokeWidth={3} />}
              </button>
              <span className={`flex-1 text-sm ${s.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{s.text}</span>
              <button onClick={() => setSteps(steps.filter((x) => x.id !== s.id))} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500"><X className="size-3.5" /></button>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); if (step.trim()) { setSteps([...steps, { id: uid(), text: step.trim() }]); setStep('') } }} className="flex items-center gap-2">
            <Plus className="size-4 text-slate-400" />
            <input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add to the list, e.g. eggs" className="flex-1 bg-transparent outline-none text-sm py-1" />
          </form>
        </div>
      )}

      {!!it.sourceIds?.length && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={label}>From the chat</span>
          {it.sourceIds.map((id, i) => (
            <button key={id} onClick={() => onJump(id)} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-brand-500 hover:text-brand-600">
              <MessageSquare className="size-3" /> {it.sourceIds!.length > 1 ? `Message ${i + 1}` : 'Show in chat'}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="flex items-center gap-3">
          <button onClick={() => onPatch({ skipped: !it.skipped, done: it.skipped ? it.done : false })} className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600"><Ban className="size-3.5" />{it.skipped ? 'Bring back' : isPlan ? 'Call it off' : 'Skip, not needed'}</button>
          <button onClick={() => onMove(isPlan ? 'keeps' : 'plans')} className="text-xs text-slate-500 hover:text-brand-500">Move to {isPlan ? 'Keeps' : 'Plans'}</button>
        </span>
        <button onClick={onDelete} className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-500"><Trash2 className="size-3.5" />Remove</button>
      </div>
    </div>
  )
}

const VOTES: { v: Vote; label: string; on: string }[] = [
  { v: 'yes', label: 'Yes', on: 'bg-emerald-500 text-white border-emerald-500' },
  { v: 'maybe', label: 'Maybe', on: 'bg-amber-400 text-white border-amber-400' },
  { v: 'no', label: 'No', on: 'bg-rose-500 text-white border-rose-500' },
]

/** Yes / Maybe / No on a plan: your answer, plus who said what. Tapping your answer again takes it back. */
export function VoteBar({ it, chatId, people, meId, onVoted }: { it: Item; chatId: string; people: Person[]; meId?: string; onVoted: (it: Item) => void }) {
  const votes = it.votes ?? {}
  const mine = meId ? votes[meId] : undefined
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone'
  const cast = async (v: Vote) => {
    if (!meId) return
    const next = { ...votes }
    if (next[meId] === v) delete next[meId]
    else next[meId] = v
    onVoted({ ...it, votes: next }) // instant, then the server copy
    onVoted(await api.vote(chatId, it.id, v))
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {VOTES.map(({ v, label, on }) => {
        const who = Object.entries(votes).filter(([, x]) => x === v).map(([id]) => id)
        return (
          <button key={v} onClick={() => cast(v)} title={who.length ? who.map(nameOf).join(', ') : label}
            className={`h-7 px-2.5 rounded-full border text-xs font-medium flex items-center gap-1.5 transition ${mine === v ? on : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            {label}
            {who.length > 0 && (
              <span className="flex -space-x-1">
                {who.slice(0, 3).map((id) => <span key={id} className="ring-2 ring-white rounded-full"><Avatar name={nameOf(id)} size="size-4" /></span>)}
                {who.length > 3 && <span className="text-[10px] pl-1.5">+{who.length - 3}</span>}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
