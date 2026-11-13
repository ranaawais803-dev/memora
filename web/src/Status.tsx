import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Eye, ImagePlus, Loader2, Plus, Trash2, Type, X } from 'lucide-react'
import { api, timeShort, type StatusPost, type User } from './api'
import { photoBook } from './Tasks'

/** WhatsApp-style statuses: a photo or a line of text on a colour, gone after 24 hours. */

export const BGS = ['#2f5bf5', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0f172a']

export interface StatusGroup { userId: string; name: string; posts: StatusPost[]; unseen: boolean }

/** Group posts by person: me first, then people with something new, then the rest. */
export function groupStatuses(list: StatusPost[], me: User): StatusGroup[] {
  const by = new Map<string, StatusGroup>()
  for (const s of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const g = by.get(s.userId) ?? { userId: s.userId, name: s.name, posts: [], unseen: false }
    g.posts.push(s)
    if (s.userId !== me.id && !s.viewers.includes(me.id)) g.unseen = true
    by.set(s.userId, g)
  }
  const latest = (g: StatusGroup) => g.posts[g.posts.length - 1].createdAt
  return [...by.values()].sort((a, b) => (a.userId === me.id ? -1 : b.userId === me.id ? 1 : Number(b.unseen) - Number(a.unseen) || latest(b).localeCompare(latest(a))))
}

/** Round avatar with the green "new status" ring (grey once seen). */
export function StatusAvatar({ name, group, size = 'size-12', onClick }: { name: string; group?: StatusGroup; size?: string; onClick?: () => void }) {
  const ring = !group ? 'bg-transparent' : group.unseen ? 'bg-gradient-to-tr from-emerald-400 to-teal-500' : 'bg-slate-300'
  const last = group?.posts[group.posts.length - 1]
  return (
    <button onClick={onClick} disabled={!onClick} className={`${size} shrink-0 rounded-full p-[2.5px] ${ring}`}>
      <span className="relative size-full rounded-full ring-2 ring-white overflow-hidden grid place-items-center bg-gradient-to-br from-brand-500 to-violet-500 text-white font-semibold">
        {last?.media?.mime.startsWith('image') ? <img src={last.media.url} className="size-full object-cover" /> : last?.text ? <span className="size-full grid place-items-center text-[9px] leading-tight px-1 text-center line-clamp-3" style={{ background: last.bg }}>{last.text}</span> : photoBook.get(name) ? <img src={photoBook.get(name)} className="size-full object-cover" /> : name[0]?.toUpperCase()}
      </span>
    </button>
  )
}

/** Right-hand column in "Organized for you": my status + everyone else's. */
export function StatusColumn({ me, groups, scope, onView, onAdd, className = '' }: { me: User; groups: StatusGroup[]; scope?: { name: string; memberIds: string[] } | null; onView: (userId: string) => void; onAdd: () => void; className?: string }) {
  const mine = groups.find((g) => g.userId === me.id)
  const everyone = groups.filter((g) => g.userId !== me.id)
  // a chat is picked: its members on top, everyone else below
  const inChat = scope ? everyone.filter((g) => scope.memberIds.includes(g.userId)) : []
  const others = scope ? everyone.filter((g) => !scope.memberIds.includes(g.userId)) : everyone
  const fresh = others.filter((g) => g.unseen)
  const seen = others.filter((g) => !g.unseen)
  const head = (t: string) => <p className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 truncate">{t}</p>
  const row = (g: StatusGroup) => (
    <li key={g.userId}>
      <button onClick={() => onView(g.userId)} className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 text-left">
        <StatusAvatar name={g.name} group={g} />
        <span className="min-w-0">
          <span className="block font-medium text-sm text-slate-800 truncate">{g.name}</span>
          <span className="block text-xs text-slate-400">{timeShort(g.posts[g.posts.length - 1].createdAt)}{g.posts.length > 1 ? ` · ${g.posts.length} updates` : ''}</span>
        </span>
      </button>
    </li>
  )
  return (
    <aside className={`${className} w-80 shrink-0 flex-col border-l border-slate-200/80 bg-white`}>
      <div className="px-4 pt-5 pb-2">
        <h3 className="text-lg font-bold">Status</h3>
        <p className="text-xs text-slate-400">Photos and updates, gone after 24 hours</p>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-4">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
          <div className="relative">
            <StatusAvatar name={me.name} group={mine} onClick={mine ? () => onView(me.id) : onAdd} />
            <button onClick={onAdd} title="Add status" className="absolute -bottom-0.5 -right-0.5 size-5 rounded-full bg-brand-500 text-white grid place-items-center ring-2 ring-white"><Plus className="size-3" strokeWidth={3} /></button>
          </div>
          <button onClick={mine ? () => onView(me.id) : onAdd} className="min-w-0 text-left">
            <span className="block font-medium text-sm text-slate-800">My status</span>
            <span className="block text-xs text-slate-400">{mine ? `${mine.posts.length} update${mine.posts.length > 1 ? 's' : ''} · ${timeShort(mine.posts[mine.posts.length - 1].createdAt)}` : 'Tap to add a photo or text'}</span>
          </button>
        </div>
        {scope && (
          <>
            {head(`In ${scope.name}`)}
            {inChat.length
              ? <ul>{[...inChat.filter((g) => g.unseen), ...inChat.filter((g) => !g.unseen)].map(row)}</ul>
              : <p className="px-2 py-2 text-xs text-slate-400">No updates from this chat yet.</p>}
          </>
        )}
        {fresh.length > 0 && head(scope ? 'Others · recent' : 'Recent')}
        <ul>{fresh.map(row)}</ul>
        {seen.length > 0 && head(scope ? 'Others · seen' : 'Seen')}
        <ul>{seen.map(row)}</ul>
        {!scope && !others.length && <p className="text-center text-sm text-slate-400 px-4 py-10">No updates from your people yet.</p>}
      </div>
    </aside>
  )
}

/** Full-screen viewer: taps or arrows move through posts, then on to the next person. */
export function StatusViewer({ groups, startUserId, me, onClose }: { groups: StatusGroup[]; startUserId: string; me: User; onClose: () => void }) {
  const [gi, setGi] = useState(() => Math.max(0, groups.findIndex((g) => g.userId === startUserId)))
  const [pi, setPi] = useState(() => {
    const g = groups.find((x) => x.userId === startUserId)
    const first = g?.posts.findIndex((p) => g.userId !== me.id && !p.viewers.includes(me.id)) ?? -1
    return first >= 0 ? first : 0
  })
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const g = groups[gi]
  const post = g?.posts[pi]

  const next = () => {
    if (!g) return onClose()
    if (pi < g.posts.length - 1) setPi(pi + 1)
    else if (gi < groups.length - 1) { setGi(gi + 1); setPi(0) }
    else onClose()
  }
  const prev = () => {
    if (pi > 0) setPi(pi - 1)
    else if (gi > 0) { setGi(gi - 1); setPi(groups[gi - 1].posts.length - 1) }
  }

  // mark seen + 5s timer per post
  useEffect(() => {
    if (!post) return
    setProgress(0)
    if (post.userId !== me.id && !post.viewers.includes(me.id)) api.seenStatus(post.id).catch(() => {})
  }, [post?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (paused || !post) return
    const t = setInterval(() => setProgress((p) => p + 2), 100)
    return () => clearInterval(t)
  }, [paused, post])
  useEffect(() => { if (progress >= 100) next() }, [progress]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev() }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  if (!g || !post) return null
  const mine = post.userId === me.id
  const remove = async () => {
    if (!confirm('Delete this status?')) return
    await api.deleteStatus(post.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 grid place-items-center" onClick={onClose}>
      <div className="relative w-full max-w-md h-full sm:h-[88vh] sm:rounded-3xl overflow-hidden bg-slate-900" onClick={(e) => e.stopPropagation()} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
        {/* progress bars */}
        <div className="absolute inset-x-0 top-0 z-10 p-3 space-y-3 bg-gradient-to-b from-black/60 to-transparent">
          <div className="flex gap-1">
            {g.posts.map((p, i) => (
              <span key={p.id} className="h-0.5 flex-1 rounded-full bg-white/30 overflow-hidden">
                <span className="block h-full bg-white" style={{ width: `${i < pi ? 100 : i === pi ? Math.min(progress, 100) : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2.5 text-white">
            <span className="size-9 rounded-full overflow-hidden bg-gradient-to-br from-brand-500 to-violet-500 grid place-items-center font-semibold">{photoBook.get(g.name) ? <img src={photoBook.get(g.name)} className="size-full object-cover" /> : g.name[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="font-semibold text-sm truncate">{mine ? 'My status' : g.name}</p>
              <p className="text-xs text-white/70">{timeShort(post.createdAt)}</p>
            </div>
            {mine && <button onClick={remove} title="Delete" className="size-9 grid place-items-center rounded-full hover:bg-white/10"><Trash2 className="size-4" /></button>}
            <button onClick={onClose} className="size-9 grid place-items-center rounded-full hover:bg-white/10"><X className="size-5" /></button>
          </div>
        </div>

        {/* content */}
        {post.media ? (
          <div className="size-full grid place-items-center bg-black">
            {post.media.mime.startsWith('video')
              ? <video src={post.media.url} autoPlay playsInline className="max-h-full max-w-full" onPlay={() => setPaused(true)} onEnded={next} />
              : <img src={post.media.url} className="max-h-full max-w-full object-contain" />}
          </div>
        ) : (
          <div className="size-full grid place-items-center p-10 text-center" style={{ background: post.bg }}>
            <p className="text-white text-2xl font-semibold leading-snug whitespace-pre-wrap break-words">{post.text}</p>
          </div>
        )}
        {post.media && post.text && <p className="absolute inset-x-0 bottom-14 px-6 py-3 text-center text-white bg-black/50 whitespace-pre-wrap">{post.text}</p>}

        {/* tap zones */}
        <button onClick={prev} className="absolute left-0 top-20 bottom-16 w-1/3 group" aria-label="Previous"><ChevronLeft className="size-8 text-white/0 group-hover:text-white/70 ml-2" /></button>
        <button onClick={next} className="absolute right-0 top-20 bottom-16 w-1/3 group flex justify-end items-center" aria-label="Next"><ChevronRight className="size-8 text-white/0 group-hover:text-white/70 mr-2" /></button>

        {mine && (
          <p className="absolute inset-x-0 bottom-0 py-4 text-center text-sm text-white/80 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent">
            <Eye className="size-4" /> {post.viewers.length ? `Seen by ${post.viewers.length}` : 'No views yet'}
          </p>
        )}
      </div>
    </div>
  )
}

/** Post a status: a line of text on a colour, or a photo/video with a caption. */
export function StatusComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [text, setText] = useState('')
  const [bg, setBg] = useState(BGS[0])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pick = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const choose = (f?: File) => {
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  const post = async () => {
    setBusy(true)
    try {
      await api.postStatus({ text, bg, file: file ?? undefined })
      onPosted()
      onClose()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div className="pop-in w-full max-w-sm rounded-3xl overflow-hidden bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[3/4] grid place-items-center" style={{ background: file ? '#000' : bg }}>
          {preview ? (
            file?.type.startsWith('video') ? <video src={preview} className="max-h-full max-w-full" controls /> : <img src={preview} className="max-h-full max-w-full object-contain" />
          ) : (
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a status" maxLength={700} className="w-full h-2/3 bg-transparent text-white text-2xl font-semibold text-center placeholder:text-white/60 outline-none resize-none px-8 pt-16" />
          )}
          <button onClick={onClose} className="absolute top-3 right-3 size-9 grid place-items-center rounded-full bg-black/30 text-white"><X className="size-5" /></button>
          {file && <button onClick={() => { setFile(null); setPreview(null) }} className="absolute top-3 left-3 h-9 px-3 rounded-full bg-black/40 text-white text-sm flex items-center gap-1.5"><Type className="size-4" /> Text instead</button>}
        </div>
        <div className="p-4 space-y-3">
          {file && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a caption…" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500" />}
          <div className="flex items-center gap-2">
            {!file && BGS.map((c) => <button key={c} onClick={() => setBg(c)} style={{ background: c }} className={`size-7 rounded-full ${bg === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`} />)}
            <input ref={pick} type="file" accept="image/*,video/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
            <button onClick={() => pick.current?.click()} title="Photo or video" className="ml-auto size-9 grid place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"><ImagePlus className="size-4" /></button>
            <button onClick={post} disabled={busy || (!file && !text.trim())} className="h-9 px-4 rounded-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5">
              {busy && <Loader2 className="size-4 animate-spin" />} Share
            </button>
          </div>
          <p className="text-xs text-slate-400">Everyone you chat with can see it for 24 hours.</p>
        </div>
      </div>
    </div>
  )
}

/** Overview tab: the latest status of each person in this chat. */
export function ChatStatuses({ memberIds, groups, meId, onView }: { memberIds: string[]; groups: StatusGroup[]; meId: string; onView: (userId: string) => void }) {
  const here = groups.filter((g) => memberIds.includes(g.userId))
  if (!here.length) return null
  return (
    <div className="flex gap-3 overflow-x-auto scroll-thin pb-1">
      {here.map((g) => (
        <div key={g.userId} className="flex flex-col items-center gap-1 w-16 shrink-0">
          <StatusAvatar name={g.name} group={g} size="size-14" onClick={() => onView(g.userId)} />
          <span className="text-[11px] text-slate-600 truncate w-full text-center">{g.userId === meId ? 'You' : g.name.split(' ')[0]}</span>
        </div>
      ))}
    </div>
  )
}
