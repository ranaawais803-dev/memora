import { useEffect, useState } from 'react'
import { CalendarDays, Plus, X, Image as ImageIcon, Video, Mic, FileText, Bookmark, CalendarHeart, Link as LinkIcon } from 'lucide-react'
import { api, socket, type Chat, type ChatInfo, type ChatStats, type InfoField } from './api'

const card = 'rounded-2xl bg-white border border-slate-200/70 shadow-sm p-4'
const field = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500'
const label = 'text-[11px] font-semibold uppercase tracking-wide text-slate-400'
const SUGGESTED = ['Catalogue', 'Client', 'Budget', 'Website', 'Address', 'Phone']

/** Compact strip for the top of the panel: deadline + info cards, shown only when something is set. */
export function InfoStrip({ chat, onOpen }: { chat: Chat; onOpen: () => void }) {
  const i = chat.info
  const fields = (i?.fields ?? []).filter((f) => f.label && f.value)
  if (!i?.dueDate && !fields.length && !i?.about) return null
  return (
    <div className="px-3 md:px-5 pt-3">
      <button onClick={onOpen} className="w-full text-left rounded-2xl bg-white border border-slate-200/70 shadow-sm px-4 py-3 hover:shadow-md transition">
        {i?.about && <p className="text-sm text-slate-600 line-clamp-1 mb-2">{i.about}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {i?.dueDate && <Countdown due={i.dueDate} />}
          {fields.slice(0, 5).map((f) => {
            const link = /^https?:\/\//.test(f.value.trim())
            return (
              <span key={f.id} className="inline-flex items-center gap-1 max-w-[220px] rounded-full bg-slate-100 text-xs px-2.5 py-1">
                <span className="text-slate-400 shrink-0">{f.label}</span>
                {link ? (
                  <a href={f.value.trim()} target="_blank" onClick={(e) => e.stopPropagation()} className="font-medium text-brand-600 truncate flex items-center gap-0.5"><LinkIcon className="size-3 shrink-0" />Open</a>
                ) : (
                  <span className="font-medium text-slate-700 truncate">{f.value}</span>
                )}
              </span>
            )
          })}
        </div>
      </button>
    </div>
  )
}

export const daysLeft = (due: string) => Math.round((+new Date(due) - +new Date(new Date().toISOString().slice(0, 10))) / 86400000)

/** Rarely-used extras: project details, custom info cards, and a few small stats. */
export default function Info({ chat }: { chat: Chat }) {
  return (
    <div className="space-y-4">
      <Details chat={chat} />
      <Stats chatId={chat.id} />
    </div>
  )
}

function Details({ chat }: { chat: Chat }) {
  if (chat.isCreator === false) return <ReadOnlyDetails chat={chat} />
  const [info, setInfo] = useState<ChatInfo>(chat.info ?? {})
  const [about, setAbout] = useState(chat.info?.about ?? '')
  useEffect(() => { setInfo(chat.info ?? {}); setAbout(chat.info?.about ?? '') }, [chat.info])

  const save = (next: ChatInfo) => {
    setInfo(next)
    api.updateChat(chat.id, { info: next })
  }
  const fields = info.fields ?? []
  const setField = (id: string, p: Partial<InfoField>) => save({ ...info, fields: fields.map((f) => (f.id === id ? { ...f, ...p } : f)) })
  const addField = (labelText = '') => save({ ...info, fields: [...fields, { id: crypto.randomUUID(), label: labelText, value: '' }] })

  return (
    <div className={card}>
      <p className="font-semibold">Details</p>
      <p className="text-xs text-slate-400">Optional. Anything you add here shows at the top for everyone.</p>

      <div className="mt-4 space-y-3">
        <label className="block space-y-1">
          <span className={label}>About</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== (info.about ?? '') && save({ ...info, about })} rows={2} placeholder="What is this chat for?" className={`${field} resize-none`} />
        </label>

        <label className="block space-y-1">
          <span className={label}>Deadline</span>
          <div className="flex items-center gap-2">
            <input type="date" value={info.dueDate ?? ''} onChange={(e) => save({ ...info, dueDate: e.target.value })} className={field} />
            {info.dueDate && <Countdown due={info.dueDate} />}
            {info.dueDate && <button onClick={() => save({ ...info, dueDate: '' })} className="shrink-0 text-slate-400 hover:text-rose-500"><X className="size-4" /></button>}
          </div>
        </label>

        <div className="space-y-1.5">
          <span className={label}>Info</span>
          {fields.map((f) => <FieldRow key={f.id} f={f} onChange={(p) => setField(f.id, p)} onRemove={() => save({ ...info, fields: fields.filter((x) => x.id !== f.id) })} />)}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTED.filter((s) => !fields.some((f) => f.label.toLowerCase() === s.toLowerCase())).slice(0, 4).map((s) => (
              <button key={s} onClick={() => addField(s)} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600">+ {s}</button>
            ))}
            <button onClick={() => addField()} className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-brand-500 hover:text-brand-600 flex items-center gap-1"><Plus className="size-3" /> Custom</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldRow({ f, onChange, onRemove }: { f: InfoField; onChange: (p: Partial<InfoField>) => void; onRemove: () => void }) {
  const [l, setL] = useState(f.label)
  const [v, setV] = useState(f.value)
  const isLink = /^https?:\/\//.test(v.trim())
  return (
    <div className="group flex items-center gap-2">
      <input value={l} onChange={(e) => setL(e.target.value)} onBlur={() => l !== f.label && onChange({ label: l })} placeholder="Label" className={`${field.replace('w-full', 'w-28')} shrink-0 font-medium`} />
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== f.value && onChange({ value: v })} placeholder="Value or link" className={`${field.replace('w-full', 'min-w-0 flex-1')}`} />
      {isLink && <a href={v.trim()} target="_blank" className="shrink-0 text-brand-500" title="Open link"><LinkIcon className="size-4" /></a>}
      <button onClick={onRemove} className="shrink-0 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100"><X className="size-4" /></button>
    </div>
  )
}

export function Countdown({ due, compact = false }: { due: string; compact?: boolean }) {
  const d = daysLeft(due)
  const text = d > 1 ? `${d} days left` : d === 1 ? 'Due tomorrow' : d === 0 ? 'Due today' : `${-d} days past`
  const color = d < 0 ? 'bg-rose-50 text-rose-600' : d <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-600'
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full font-medium ${color} ${compact ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}>
      <CalendarDays className="size-3" />{text}
    </span>
  )
}

function Stats({ chatId }: { chatId: string }) {
  const [s, setS] = useState<ChatStats | null>(null)
  useEffect(() => {
    const load = () => api.stats(chatId).then(setS).catch(() => {})
    load()
    const on = (m: { chatId: string }) => m.chatId === chatId && load()
    socket.on('message', on)
    socket.on('insights', on)
    return () => { socket.off('message', on); socket.off('insights', on) }
  }, [chatId])
  if (!s) return null

  const week = s.perDay.slice(-7).reduce((a, d) => a + d.count, 0)
  const doneAll = s.keeps.done + s.plans.done
  const totalAll = doneAll + s.keeps.open + s.plans.open
  const pct = totalAll ? Math.round((doneAll / totalAll) * 100) : 0
  const sharedMedia = s.media.photos + s.media.videos + s.media.voice + s.media.files

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Tile value={s.total} label="messages" sub={`since ${new Date(s.since).toLocaleDateString([], { month: 'short', year: 'numeric' })}`} />
        <Tile value={week} label="this week" />
        <Tile value={sharedMedia} label="shared" sub="photos & files" />
      </div>

      <div className={card}>
        <p className="font-semibold">Activity</p>
        <p className="text-xs text-slate-400">Messages per day, last 2 weeks</p>
        <DayBars data={s.perDay} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={card}>
          <p className="font-semibold">Most active</p>
          <PeopleBars data={s.people} />
        </div>
        <div className={card}>
          <p className="font-semibold">Kept & planned</p>
          <div className="flex items-center gap-4 mt-3">
            <Ring pct={pct} />
            <div className="text-sm space-y-1.5">
              <p className="flex items-center gap-1.5 text-slate-600"><Bookmark className="size-3.5 text-slate-400" /><b className="text-slate-800">{s.keeps.done}</b>/{s.keeps.open + s.keeps.done} keeps done</p>
              <p className="flex items-center gap-1.5 text-slate-600"><CalendarHeart className="size-3.5 text-slate-400" /><b className="text-slate-800">{s.plans.done}</b>/{s.plans.open + s.plans.done} plans happened</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 mt-4 pt-3 border-t border-slate-100 text-center">
            {[[ImageIcon, s.media.photos, 'Photos'], [Video, s.media.videos, 'Videos'], [Mic, s.media.voice, 'Voice'], [FileText, s.media.files, 'Files']].map(([Icon, n, l]) => {
              const I = Icon as typeof Mic
              return (
                <div key={l as string}>
                  <I className="size-4 mx-auto text-slate-400" />
                  <p className="text-sm font-semibold mt-1">{n as number}</p>
                  <p className="text-[10px] text-slate-400">{l as string}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

const Tile = ({ value, label, sub }: { value: number; label: string; sub?: string }) => (
  <div className={card}>
    <p className="text-2xl font-bold tabular-nums">{value}</p>
    <p className="text-xs text-slate-500">{label}</p>
    {sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</p>}
  </div>
)

/** Single-series column chart with a hover tooltip per day. */
function DayBars({ data }: { data: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.count))
  const fmt = (d: string) => new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <div className="mt-4">
      <div className="relative h-28 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        <div className="absolute inset-x-0 bottom-0 border-b border-slate-200" />
        {data.map((d, i) => (
          <div key={d.date} onMouseEnter={() => setHover(i)} className="relative flex-1 h-full flex items-end cursor-default">
            <div
              className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-brand-600' : 'bg-brand-500/80'}`}
              style={{ height: d.count ? `${Math.max(4, (d.count / max) * 100)}%` : '2px', opacity: d.count ? 1 : 0.25 }}
            />
            {hover === i && (
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-lg bg-slate-800 text-white text-[11px] px-2 py-1 shadow">
                <b>{d.count}</b> message{d.count === 1 ? '' : 's'} · {fmt(d.date)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
        <span>{fmt(data[0].date)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/** Horizontal bars, one series, values labelled directly. */
function PeopleBars({ data }: { data: { name: string; count: number }[] }) {
  if (!data.length) return <p className="text-sm text-slate-400 mt-3">No messages yet.</p>
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <ul className="mt-3 space-y-2.5">
      {data.slice(0, 5).map((p) => (
        <li key={p.name} title={`${p.name}: ${p.count} messages`}>
          <div className="flex justify-between text-xs mb-1"><span className="text-slate-600 truncate">{p.name}</span><span className="text-slate-500 tabular-nums">{p.count}</span></div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-brand-500/80" style={{ width: `${(p.count / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

function Ring({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#eef1f6" strokeWidth="7" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#10b981" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold">{pct}%</span>
    </div>
  )
}

/** What members (not the creator) see: the same details, read-only. */
function ReadOnlyDetails({ chat }: { chat: Chat }) {
  const i = chat.info ?? {}
  const fields = (i.fields ?? []).filter((f) => f.label && f.value)
  const creator = chat.people.find((p) => p.id === chat.createdBy)?.name
  return (
    <div className={card}>
      <p className="font-semibold">Details</p>
      <p className="text-xs text-slate-400">{creator ? `Set by ${creator}. Only they can change these.` : 'Only the person who made this chat can change these.'}</p>
      {!i.about && !i.dueDate && !fields.length ? (
        <p className="mt-4 text-sm text-slate-400">Nothing added yet.</p>
      ) : (
        <dl className="mt-4 space-y-3 text-sm">
          {i.about && <div><dt className={label}>About</dt><dd className="mt-1 text-slate-700 whitespace-pre-wrap">{i.about}</dd></div>}
          {i.dueDate && <div><dt className={label}>Deadline</dt><dd className="mt-1 flex items-center gap-2 text-slate-700">{new Date(i.dueDate).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} <Countdown due={i.dueDate} /></dd></div>}
          {fields.length > 0 && (
            <div>
              <dt className={label}>Info</dt>
              <dd className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-100">
                {fields.map((f) => (
                  <div key={f.id} className="flex gap-3 px-3 py-2">
                    <span className="w-28 shrink-0 font-medium text-slate-500">{f.label}</span>
                    {/^https?:\/\//.test(f.value.trim()) ? <a href={f.value.trim()} target="_blank" className="min-w-0 truncate text-brand-600 hover:underline">{f.value}</a> : <span className="min-w-0 break-words text-slate-700">{f.value}</span>}
                  </div>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
