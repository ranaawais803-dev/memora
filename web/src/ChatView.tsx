import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Paperclip, Send, Mic, Square, Trash2, Sparkles, FolderOpen, FileText, AlertTriangle, X, Loader2, UserPlus, LogOut, Clock, RotateCw, MessageSquare, Columns2, MoreVertical, Check, Bookmark, CalendarHeart, CornerUpLeft, BookmarkPlus, BookmarkCheck, Hash, Lightbulb, SmilePlus , Pencil , Camera , ListChecks } from 'lucide-react'
import { api, socket, type Chat, type Insights, type Item, type List, type Message, type User , type Person, type Vote } from './api'
import { useVoice } from './useVoice'
import PeoplePicker from './PeoplePicker'
import { Avatar , VoteBar } from './Tasks'
import { tintOf } from './Sidebar'
import type { StatusGroup } from './Status'
import type { ViewMode } from './App'
import { Countdown } from './Info'

interface Props {
  me: User
  chat: Chat
  jumpTo: { id: string; n: number } | null
  ins: Insights | null
  onShowItem: (itemId: string, list: List) => void
  statusGroups?: StatusGroup[]
  onViewStatus?: (userId: string) => void
  mode: ViewMode
  onMode: (m: ViewMode) => void
  onBack: () => void
  onLeft: () => void
  className?: string
}

export default function ChatView({ me, chat, jumpTo, ins, onShowItem, mode, onMode, onBack, onLeft, className = '' }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [renaming, setRenaming] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const [recap, setRecap] = useState<{ headline: string; points: string[] } | 'loading' | null>(null)
  const [typing, setTyping] = useState<Record<string, string>>({}) // userId -> name
  const [adding, setAdding] = useState(false)
  const [menu, setMenu] = useState(false)
  const typingSent = useRef(0)
  const bottom = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const voice = useVoice()

  useEffect(() => {
    const load = () =>
      api.messages(chat.id).then((server) => {
        setMessages((list) => [...server, ...list.filter((m) => m.pending || m.failed)])
        setLoaded(true)
      })
    load()
    api.markRead(chat.id).catch(() => {})
    const add = (m: Message) => {
      if (m.chatId !== chat.id) return
      setMessages((list) => upsert(list, m))
      setTyping((t) => omit(t, m.senderId))
      if (m.senderId !== me.id && document.visibilityState === 'visible') api.markRead(chat.id).catch(() => {})
    }
    const update = (m: Message) => m.chatId === chat.id && setMessages((list) => list.map((x) => (x.id === m.id ? m : x)))
    const onTyping = (t: { chatId: string; userId: string; name: string; typing: boolean }) => {
      if (t.chatId !== chat.id) return
      setTyping((cur) => (t.typing ? { ...cur, [t.userId]: t.name } : omit(cur, t.userId)))
    }
    const visible = () => { if (document.visibilityState === 'visible') api.markRead(chat.id).catch(() => {}) }
    socket.on('message', add)
    socket.on('message:update', update)
    socket.on('typing', onTyping)
    socket.on('connect', load)
    document.addEventListener('visibilitychange', visible)
    return () => {
      socket.off('message', add)
      socket.off('message:update', update)
      socket.off('typing', onTyping)
      socket.off('connect', load)
      document.removeEventListener('visibilitychange', visible)
      socket.emit('typing', { chatId: chat.id, typing: false })
    }
  }, [chat.id, me.id])

  // don't let "typing…" stick if the stop event is lost
  useEffect(() => {
    if (!Object.keys(typing).length) return
    const t = setTimeout(() => setTyping({}), 6000)
    return () => clearTimeout(t)
  }, [typing])

  // messageId -> the keeps/plans that came from it
  const linked = useMemo(() => {
    const map = new Map<string, { item: Item; list: List | 'knowledge' }[]>()
    for (const list of ['keeps', 'plans', 'knowledge'] as const)
      for (const item of ins?.[list] ?? [])
        for (const id of item.sourceIds ?? []) map.set(id, [...(map.get(id) ?? []), { item, list }])
    return map
  }, [ins])

  useEffect(() => {
    if (jumpTo) {
      const el = document.getElementById(`m-${jumpTo.id}`)
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.classList.add('ring-4', 'ring-amber-200')
        setTimeout(() => el.classList.remove('ring-4', 'ring-amber-200'), 2000)
        return
      }
    }
    bottom.current?.scrollIntoView({ behavior: loaded ? 'smooth' : 'auto' })
  }, [messages.length, jumpTo, loaded, Object.keys(typing).length])

  const react = (m: Message, emoji: string) => {
    // optimistic toggle, then the server copy (also sent to everyone over the socket)
    setMessages((list) => list.map((x) => {
      if (x.id !== m.id) return x
      const rs = x.reactions ?? []
      const mineAt = rs.findIndex((r) => r.userId === me.id && r.emoji === emoji)
      return { ...x, reactions: mineAt >= 0 ? rs.filter((_, i) => i !== mineAt) : [...rs, { emoji, userId: me.id, name: me.name }] }
    }))
    api.react(chat.id, m.id, emoji).then((s) => setMessages((list) => upsert(list, s))).catch(() => {})
  }

  /** Shows the message instantly, then swaps in the server copy (or marks it failed). */
  const send = async (data: { text?: string; file?: Blob; fileName?: string; transcript?: string; replyToId?: string }) => {
    const clientId = crypto.randomUUID()
    // whatever goes out next answers the quoted message
    const replyToId = data.replyToId ?? replyTo?.id
    setReplyTo(null)
    if (!data.file) setMessages((list) => [...list, { id: clientId, clientId, chatId: chat.id, senderId: me.id, sender: me.name, text: data.text ?? '', replyToId, createdAt: new Date().toISOString(), pending: true }])
    try {
      const m = await api.send(chat.id, { ...data, replyToId, clientId })
      setMessages((list) => upsert(list, { ...m, clientId }))
    } catch {
      if (data.file) alert(`Couldn't send ${data.fileName ?? 'the file'}. Check your connection and try again.`)
      else setMessages((list) => list.map((x) => (x.id === clientId ? { ...x, pending: false, failed: true } : x)))
    }
  }

  const retry = (m: Message) => {
    setMessages((list) => list.filter((x) => x.id !== m.id))
    send({ text: m.text, replyToId: m.replyToId })
  }

  const onType = (v: string) => {
    setText(v)
    const now = Date.now()
    if (v && now - typingSent.current > 2500) {
      typingSent.current = now
      socket.emit('typing', { chatId: chat.id, typing: true })
    } else if (!v && typingSent.current) {
      typingSent.current = 0
      socket.emit('typing', { chatId: chat.id, typing: false })
    }
  }

  const sendText = () => {
    if (!text.trim()) return
    send({ text })
    setText('')
    typingSent.current = 0
    socket.emit('typing', { chatId: chat.id, typing: false })
  }

  const stopVoice = async () => {
    const r = await voice.stop()
    if (r && r.blob.size > 0) send({ file: r.blob, fileName: `Voice note ${new Date().toLocaleString()}.webm`, transcript: r.transcript })
  }

  const catchUp = async () => {
    setRecap('loading')
    setRecap(await api.recap(chat.id))
  }

  const leave = async () => {
    setMenu(false)
    if (!confirm(`Leave "${chat.name}"? You won't see new messages.`)) return
    await api.leave(chat.id)
    onLeft()
  }

  const others = chat.people.filter((p) => p.id !== me.id)
  const onlineNow = others.filter((p) => p.online)
  const typers = Object.values(typing)
  const subtitle = typers.length
    ? `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…`
    : onlineNow.length
      ? `${onlineNow.map((p) => p.name.split(' ')[0]).join(', ')} online`
      : others.length
        ? `${chat.people.length} members`
        : 'Just you. Add people to start chatting'

  return (
    <section className={`${className} min-w-0 flex-col`}>
      <header className="h-16 shrink-0 flex items-center gap-3 px-3 md:px-4 bg-white border-b border-slate-200/80">
        <button onClick={onBack} className="md:hidden size-9 grid place-items-center rounded-full hover:bg-slate-100"><ArrowLeft className="size-5" /></button>
        <div className={`size-10 shrink-0 rounded-2xl ${tintOf(chat.id)} grid place-items-center text-xl`}>{chat.photo ? <img src={chat.photo} className="size-full rounded-2xl object-cover" /> : chat.emoji}</div>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight truncate flex items-center gap-2"><button onClick={() => setRenaming(true)} title={chat.nickname ? `Your name for this chat · original: ${chat.originalName}` : 'Rename'} className="truncate hover:text-brand-600">{chat.name}</button>{chat.info?.dueDate && <Countdown due={chat.info.dueDate} compact />}</h2>
          <p className={`text-xs truncate ${typers.length ? 'text-brand-500' : onlineNow.length ? 'text-emerald-600' : 'text-slate-400'}`}>{subtitle}</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden sm:flex -space-x-1.5 mr-1">
            {others.slice(0, 4).map((p) => (
              <span key={p.id} className="relative ring-2 ring-white rounded-full" title={p.name}>
                <Avatar name={p.name} size="size-7" />
                {p.online && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
              </span>
            ))}
          </div>
          <button onClick={catchUp} title="Catch me up" className="h-9 px-3 rounded-xl bg-brand-50 text-brand-600 hover:bg-brand-100 text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="size-4" /> <span className="hidden xl:inline">Catch up</span>
          </button>
          <ModeSwitch mode={mode} onMode={onMode} />
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="size-9 grid place-items-center rounded-xl text-slate-500 hover:bg-slate-100"><MoreVertical className="size-4" /></button>
            {menu && (
              <div className="pop-in absolute right-0 top-11 z-30 w-48 rounded-xl border border-slate-200 bg-white shadow-xl py-1" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setAdding(true); setMenu(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><UserPlus className="size-4" /> Add people</button>
                <button onClick={() => { setRenaming(true); setMenu(false) }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><Pencil className="size-4" /> Name & photo</button>
                <button onClick={leave} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="size-4" /> Leave chat</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col chat-bg">
        {(adding || recap || renaming) && (
          <div className="absolute inset-x-0 top-0 z-20 px-3 md:px-6 pt-3 space-y-2">
            {adding && <AddPeople chat={chat} onDone={() => setAdding(false)} />}
            {renaming && <RenameChat chat={chat} onDone={() => setRenaming(false)} />}
            {recap && (
              <div className="pop-in rounded-2xl bg-white/95 backdrop-blur border border-brand-100 shadow-lg p-4 relative">
                <button onClick={() => setRecap(null)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
                <p className="text-xs font-semibold text-brand-500 uppercase tracking-wide flex items-center gap-1.5"><Sparkles className="size-3.5" /> Catch-up · last 30 messages</p>
                {recap === 'loading' ? (
                  <p className="text-sm text-slate-400 mt-2 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Reading…</p>
                ) : (
                  <>
                    <p className="font-semibold mt-1.5">{recap.headline}</p>
                    <ul className="mt-1.5 space-y-1 text-sm text-slate-600">{recap.points.map((p, i) => <li key={i}>• {p}</li>)}</ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto scroll-thin px-3 md:px-6 py-4">
          {!loaded ? (
            <p className="text-center text-sm text-slate-400 py-10"><Loader2 className="size-5 animate-spin inline" /></p>
          ) : !messages.length ? (
            <div className="text-center py-16">
              <p className="text-4xl">{chat.emoji}</p>
              <p className="font-medium text-slate-600 mt-3">This is the start of {chat.name}</p>
              <p className="text-sm text-slate-400 mt-1">Say hi! Plans and things to remember get kept for you automatically.</p>
            </div>
          ) : (
            messages.map((m, i) => {
              const mine = m.senderId ? m.senderId === me.id : m.sender === me.name
              const prev = messages[i - 1]
              const next = messages[i + 1]
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
              const sameAsPrev = !newDay && prev?.sender === m.sender
              const lastInGroup = !next || next.sender !== m.sender || new Date(next.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
              if (m.event) return null // older "marked as done" notes: the status now lives on the message itself
              return (
                <div key={m.id} className={`group/msg ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`}>
                  {newDay && <DayDivider iso={m.createdAt} />}
                  <div className={`group relative flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                    {!mine && <div className="w-7 shrink-0">{lastInGroup && <Avatar name={m.sender} size="size-7" />}</div>}
                    {mine && !m.pending && !m.failed && <MessageActions m={m} chatId={chat.id} doneEmoji={me.settings?.doneEmoji ?? '✅'} onReact={(e) => react(m, e)} onReply={() => { setReplyTo(m); input.current?.focus() }} saved={linked.get(m.id) ?? []} status={(linked.get(m.id) ?? []).some((l) => l.list !== 'knowledge') ? (linked.get(m.id) ?? []).filter((l) => l.list !== 'knowledge').map(({ item, list }) => <ItemStatus key={item.id} item={item} list={list as List} chatId={chat.id} people={chat.people} meId={me.id} onOpen={() => onShowItem(item.id, list as List)} />) : null} onRemove={(it) => api.deleteItem(chat.id, it.id)} onShow={onShowItem} side="left" />}
                    <div
                      id={`m-${m.id}`}
                      className={`${m.pending ? 'opacity-70' : ''} group-has-[.menu-open]:ring-1 group-has-[.menu-open]:ring-amber-300/70 max-w-[calc(100%-7rem)] px-3.5 py-2 shadow-sm transition ${
                        mine
                          ? `bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-2xl ${lastInGroup ? 'rounded-br-md' : ''}`
                          : `bg-white text-slate-800 rounded-2xl ${lastInGroup ? 'rounded-bl-md' : ''}`
                      }`}
                    >
                      {!mine && !sameAsPrev && <p className="text-xs font-semibold text-brand-600 mb-0.5">{m.sender}</p>}
                      {m.urgent && (
                        <div className="mb-1.5 rounded-lg bg-rose-50 text-rose-700 px-2.5 py-1.5 text-xs flex gap-1.5">
                          <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                          <span><b>Urgent:</b> {m.urgent.summary}</span>
                        </div>
                      )}
                      {m.replyToId && <Quote m={messages.find((x) => x.id === m.replyToId)} mine={mine} />}
                      {m.media && <MediaView m={m} mine={mine} />}
                      {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed text-[15px]">{m.text}</p>}
                      <p className={`text-[10.5px] mt-0.5 flex items-center justify-end gap-1 ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {mine && (m.pending ? <Clock className="size-3" /> : !m.failed && <Check className="size-3" />)}
                      </p>
                      {m.failed && (
                        <button onClick={() => retry(m)} className="mt-1 flex items-center gap-1 text-[11px] font-medium bg-white/20 rounded px-1.5 py-0.5">
                          <RotateCw className="size-3" /> Not sent · tap to retry
                        </button>
                      )}
                    </div>
                    {!mine && !m.pending && <MessageActions m={m} chatId={chat.id} doneEmoji={me.settings?.doneEmoji ?? '✅'} onReact={(e) => react(m, e)} onReply={() => { setReplyTo(m); input.current?.focus() }} saved={linked.get(m.id) ?? []} status={(linked.get(m.id) ?? []).some((l) => l.list !== 'knowledge') ? (linked.get(m.id) ?? []).filter((l) => l.list !== 'knowledge').map(({ item, list }) => <ItemStatus key={item.id} item={item} list={list as List} chatId={chat.id} people={chat.people} meId={me.id} onOpen={() => onShowItem(item.id, list as List)} />) : null} onRemove={(it) => api.deleteItem(chat.id, it.id)} onShow={onShowItem} side="right" />}
                  </div>
                  {!!m.reactions?.length && (
                    <div className={`flex flex-wrap gap-1 -mt-1 relative ${mine ? 'justify-end pr-2' : 'pl-11'}`}>
                      {[...new Set(m.reactions.map((r) => r.emoji))].map((e) => {
                        const who = m.reactions!.filter((r) => r.emoji === e)
                        const byMe = who.some((r) => r.userId === me.id)
                        return (
                          <button key={e} onClick={() => react(m, e)} title={who.map((r) => r.name).join(', ')} className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs shadow-sm ${byMe ? 'bg-brand-50 border-brand-200' : 'bg-white border-slate-200'}`}>
                            <span>{e}</span>{who.length > 1 && <span className="text-[10px] font-semibold text-slate-500">{who.length}</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
          {typers.length > 0 && (
            <div className="mt-3 flex items-end gap-2">
              <Avatar name={typers[0]} size="size-7" />
              <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm flex gap-1">
                <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
                <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
                <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <footer className="shrink-0 px-3 pb-3 md:px-6 md:pb-4">
          {voice.recording ? (
            <div className="flex items-center gap-3 rounded-2xl bg-white border border-slate-200 shadow-sm px-3 py-2">
              <button onClick={voice.cancel} title="Discard" className="size-10 grid place-items-center rounded-full text-slate-400 hover:bg-slate-100"><Trash2 className="size-5" /></button>
              <span className="size-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-mono text-sm text-slate-600">{Math.floor(voice.seconds / 60)}:{String(voice.seconds % 60).padStart(2, '0')}</span>
              <p className="flex-1 text-sm text-slate-400 italic truncate">{voice.live || 'Listening…'}</p>
              <button onClick={stopVoice} title="Send voice note" className="size-10 grid place-items-center rounded-full bg-brand-500 text-white"><Square className="size-4 fill-current" /></button>
            </div>
          ) : (
            <>
            {replyTo && (
              <div className="pop-in mb-2 flex items-center gap-2 rounded-xl bg-white border-l-4 border-brand-500 shadow-sm px-3 py-2">
                <CornerUpLeft className="size-4 text-brand-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-brand-600">Replying to {replyTo.senderId === me.id ? 'yourself' : replyTo.sender}</p>
                  <p className="text-sm text-slate-500 truncate">{snippet(replyTo)}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 flex items-end rounded-2xl bg-white border border-slate-200 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100 transition">
                <button onClick={() => fileInput.current?.click()} title="Attach photo or file" className="size-11 shrink-0 grid place-items-center text-slate-400 hover:text-slate-600"><Paperclip className="size-5" /></button>
                <input ref={fileInput} type="file" hidden multiple onChange={(e) => { [...(e.target.files ?? [])].forEach((f) => send({ file: f, fileName: f.name })); e.target.value = '' }} />
                <textarea
                  ref={input}
                  rows={1}
                  value={text}
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setReplyTo(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }}
                  placeholder={`Message ${chat.name}`}
                  className="flex-1 resize-none bg-transparent py-3 pr-3 outline-none max-h-32"
                />
              </div>
              {text.trim() ? (
                <button onClick={sendText} className="size-11 shrink-0 grid place-items-center rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30"><Send className="size-5" /></button>
              ) : (
                <button onClick={() => voice.start().catch(() => alert('Microphone access is needed for voice notes.'))} title="Record voice note" className="size-11 shrink-0 grid place-items-center rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/30"><Mic className="size-5" /></button>
              )}
            </div>
            </>
          )}
        </footer>
      </div>
    </section>
  )
}

export function ModeSwitch({ mode, onMode }: { mode: ViewMode; onMode: (m: ViewMode) => void }) {
  const opts: { id: ViewMode; icon: typeof MessageSquare; label: string }[] = [
    { id: 'chat', icon: MessageSquare, label: 'Chat only' },
    { id: 'split', icon: Columns2, label: 'Chat + organized' },
  ]
  return (
    <div className="flex p-0.5 rounded-xl bg-slate-100">
      {opts.map((o) => (
        <button key={o.id} onClick={() => onMode(o.id)} title={o.label} className={`size-8 grid place-items-center rounded-lg transition ${mode === o.id ? 'bg-white shadow-sm text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
          <o.icon className="size-4" />
        </button>
      ))}
    </div>
  )
}

const omit = (o: Record<string, string>, key?: string) => {
  if (!key || !(key in o)) return o
  const rest = { ...o }
  delete rest[key]
  return rest
}

/** Insert or replace a message, matching by id or by the temporary clientId. */
function upsert(list: Message[], m: Message): Message[] {
  const i = list.findIndex((x) => x.id === m.id || (!!m.clientId && x.clientId === m.clientId))
  const clean = { ...m, pending: false, failed: false }
  if (i < 0) return [...list, clean]
  const next = [...list]
  next[i] = clean
  return next
}

function AddPeople({ chat, onDone }: { chat: Chat; onDone: () => void }) {
  const [picked, setPicked] = useState<User[]>([])
  const [error, setError] = useState('')
  const add = async () => {
    try {
      for (const u of picked) await api.addMember(chat.id, u.id)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="pop-in rounded-2xl bg-white border border-slate-200 shadow-lg p-3 space-y-2">
      <p className="text-sm font-semibold">Add people to {chat.name}</p>
      <PeoplePicker selected={picked} onChange={setPicked} exclude={chat.people.map((p) => p.id)} />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 text-sm text-slate-500">Cancel</button>
        <button onClick={add} disabled={!picked.length} className="px-3 py-1.5 text-sm rounded-lg bg-brand-500 disabled:opacity-50 text-white font-medium">Add</button>
      </div>
    </div>
  )
}

function DayDivider({ iso }: { iso: string }) {
  const d = new Date(iso)
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const label = d.toDateString() === today ? 'Today' : d.toDateString() === yesterday ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
  return (
    <div className="flex justify-center py-3">
      <span className="text-[11px] font-medium text-slate-500 bg-white/90 rounded-full px-3 py-1 shadow-sm">{label}</span>
    </div>
  )
}

function MediaView({ m, mine }: { m: Message; mine: boolean }) {
  const media = m.media!
  const sub = mine ? 'text-white/80' : 'text-slate-500'
  return (
    <div className="mb-1">
      {media.kind === 'image' && <a href={media.url} target="_blank"><img src={media.url} alt={media.caption || media.name} className="rounded-xl max-h-72 w-full object-cover" /></a>}
      {media.kind === 'video' && <video src={media.url} controls className="rounded-xl max-h-72 w-full" />}
      {media.kind === 'audio' && <audio src={media.url} controls className="w-64 max-w-full h-10" />}
      {media.kind === 'file' && (
        <a href={media.url} target="_blank" className={`flex items-center gap-2.5 rounded-xl p-2.5 ${mine ? 'bg-white/15' : 'bg-slate-50'}`}>
          <FileText className="size-8 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{media.name}</p>
            <p className={`text-xs ${sub}`}>{(media.size / 1024).toFixed(0)} KB</p>
          </div>
        </a>
      )}
      {m.transcript && <p className={`text-sm italic mt-1 ${sub}`}>“{m.transcript}”</p>}
      <p className={`text-[11px] mt-1 flex items-center gap-1 ${sub}`}>
        <FolderOpen className="size-3" />
        {media.category ? <>Saved to <b className="font-semibold">{media.category}</b>{media.driveLink && <a href={media.driveLink} target="_blank" className="underline ml-1">Drive</a>}</> : 'Sorting…'}
      </p>
    </div>
  )
}

const QUICK = ['👍', '❤️', '😂', '😮', '🙏', '✅']

/** Hover actions on a message: react, reply, and save it as a Keep, Plan, Handy fact or Topic. */
function MessageActions({ m, chatId, doneEmoji, saved, status, onReact, onReply, onRemove, onShow, side }: { m: Message; chatId: string; doneEmoji: string; saved: { item: Item; list: List | 'knowledge' }[]; status?: React.ReactNode; onReact: (e: string) => void; onReply: () => void; onRemove: (it: Item) => void; onShow: (id: string, list: List) => void; side: 'left' | 'right' }) {
  const [menu, setMenu] = useState<'add' | 'emoji' | 'status' | null>(null)
  // menus open on hover and close a moment after the mouse leaves (so it can travel into the menu)
  const closeT = useRef<ReturnType<typeof setTimeout>>(undefined)
  // open upward unless the message is near the top of the chat window, then open downward
  const [below, setBelow] = useState(false)
  const place = () => {
    const r = box.current?.getBoundingClientRect()
    const area = box.current?.closest('.overflow-y-auto')?.getBoundingClientRect()
    if (r) setBelow(r.top - (area?.top ?? 0) < 300)
  }
  const openOn = (k: 'add' | 'emoji' | 'status') => ({ onMouseEnter: () => { clearTimeout(closeT.current); place(); setMenu(k) } })
  const leave = () => { clearTimeout(closeT.current); closeT.current = setTimeout(() => setMenu(null), 250) }
  const stay = () => clearTimeout(closeT.current)
  const box = useRef<HTMLDivElement>(null)
  // stay open while the mouse moves around; close on a click elsewhere or Esc
  useEffect(() => {
    if (!menu) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [menu])
  const [busy, setBusy] = useState(false)
  const text = m.text || m.transcript || ''
  const short = text.length > 120 ? text.slice(0, 117) + '…' : text
  const add = async (kind: 'keeps' | 'plans' | 'knowledge' | 'topic') => {
    setMenu(null)
    setBusy(true)
    try {
      if (kind === 'topic') {
        const name = prompt('Topic name', text.split(/\s+/).slice(0, 3).join(' '))
        if (name?.trim()) await api.addTopic(chatId, name.trim(), short)
      } else {
        const item = await api.addItem(chatId, kind, { text: short || m.media?.name || 'Saved message', sourceIds: [m.id] })
        if (kind !== 'knowledge') onShow(item.id, kind)
      }
    } finally {
      setBusy(false)
    }
  }
  const btn = 'size-7 grid place-items-center rounded-full bg-white/90 text-slate-400 shadow-sm hover:text-brand-600'
  // the menu sits in a wrapper that touches the buttons, so moving the mouse up into it never closes it
  const pop = `pop-in absolute z-30 ${below ? 'top-full pt-1.5' : 'bottom-full pb-1.5'} ${side === 'left' ? 'left-0' : 'right-0'}`
  const card = 'rounded-xl border border-slate-200 bg-white shadow-xl'
  return (
    <div className={`relative self-center flex items-center gap-1 transition ${menu ? 'opacity-100 menu-open' : 'opacity-0 group-hover:opacity-100'} ${side === 'left' ? 'flex-row-reverse' : ''}`} ref={box} onMouseLeave={leave} onMouseEnter={stay}>
      <button {...openOn('emoji')} onClick={() => { place(); setMenu('emoji') }} title="React" className={btn}><SmilePlus className="size-3.5" /></button>
      <button onMouseEnter={() => setMenu(null)} onClick={onReply} title="Reply" className={btn}><CornerUpLeft className="size-3.5" /></button>
      <button {...openOn('add')} onClick={() => { place(); setMenu('add') }} disabled={busy} title={saved.length ? 'Saved · tap to manage' : 'Save to Keeps, Plans…'} className={saved.length ? `${btn} !text-emerald-600` : btn}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : saved.length ? <BookmarkCheck className="size-3.5" /> : <BookmarkPlus className="size-3.5" />}</button>
      {status && <button {...openOn('status')} onClick={() => { place(); setMenu('status') }} title="Who's in · who's done" className={`${btn} !text-brand-600`}><ListChecks className="size-3.5" /></button>}
      {menu === 'emoji' && (
        <div className={pop}><div className={`${card} flex gap-0.5 p-1`}>
          {QUICK.map((e) => (
            <button key={e} onClick={() => { onReact(e); setMenu(null) }} title={e === doneEmoji ? 'Marks it done' : undefined} className="size-8 grid place-items-center rounded-lg text-lg hover:bg-slate-100 hover:scale-110 transition">{e}</button>
          ))}
        </div></div>
      )}
      {menu === 'status' && status && <div className={pop}><div className="flex flex-col gap-1">{status}</div></div>}
      {menu === 'add' && (
        <div className={pop}><div className={`${card} w-60 py-1`}>
          {saved.length > 0 && (
            <>
              <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Saved in</p>
              {saved.map(({ item, list }) => (
                <div key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  {list === 'keeps' ? <Bookmark className="size-4 shrink-0 text-emerald-600" /> : list === 'plans' ? <CalendarHeart className="size-4 shrink-0 text-brand-600" /> : <Lightbulb className="size-4 shrink-0 text-amber-600" />}
                  <button onClick={() => { if (list !== 'knowledge') onShow(item.id, list); setMenu(null) }} className="min-w-0 flex-1 text-left truncate hover:text-brand-600">{item.text}</button>
                  <button onClick={() => onRemove(item)} title="Remove" className="size-6 shrink-0 grid place-items-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50"><X className="size-3.5" /></button>
                </div>
              ))}
              <div className="my-1 border-t border-slate-100" />
            </>
          )}
          <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{saved.length ? 'Also save as' : 'Save as'}</p>
          {([['keeps', 'Keep', Bookmark, 'text-emerald-600'], ['plans', 'Plan', CalendarHeart, 'text-brand-600'], ['knowledge', 'Handy', Lightbulb, 'text-amber-600'], ['topic', 'Topic', Hash, 'text-violet-600']] as const).filter(([k]) => !saved.some((s) => s.list === k)).map(([k, label, Icon, color]) => (
            <button key={k} onClick={() => add(k)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"><Icon className={`size-4 ${color}`} /> {label}</button>
          ))}
        </div></div>
      )}
    </div>
  )
}

const snippet = (m: Message) => m.text || (m.transcript ? `🎤 ${m.transcript}` : m.media ? (m.media.kind === 'audio' ? '🎤 Voice note' : m.media.kind === 'image' ? '📷 Photo' : `📎 ${m.media.name}`) : '')


/** The message being answered, shown on top of the reply. Tap to jump to it. */
function Quote({ m, mine }: { m?: Message; mine: boolean }) {
  const go = () => {
    const el = m && document.getElementById(`m-${m.id}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.classList.add('ring-2', 'ring-amber-300')
    setTimeout(() => el?.classList.remove('ring-2', 'ring-amber-300'), 1400)
  }
  return (
    <button onClick={go} className={`mb-1.5 w-full text-left rounded-lg border-l-4 px-2.5 py-1.5 text-xs ${mine ? 'bg-white/15 border-white/60 text-white/90' : 'bg-slate-100 border-brand-400 text-slate-600'}`}>
      <span className={`block font-semibold ${mine ? 'text-white' : 'text-brand-600'}`}>{m?.sender ?? 'Message'}</span>
      <span className="block truncate">{m ? snippet(m) : 'Older message'}</span>
    </button>
  )
}

/** Creator: renames the chat for everyone (empty = show people's names). Anyone else: a private name only they see. */
function RenameChat({ chat, onDone }: { chat: Chat; onDone: () => void }) {
  const [name, setName] = useState(chat.isCreator ? (chat.nickname ? chat.originalName ?? '' : chat.name) : chat.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const pickPhoto = useRef<HTMLInputElement>(null)
  const save = async (value: string) => {
    setBusy(true)
    try { await api.updateChat(chat.id, { name: value }); onDone() } finally { setBusy(false) }
  }
  const photo = async (f: File | null) => {
    setBusy(true)
    try { await api.setChatPhoto(chat.id, f) } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  // what "remove" means: the creator clears the chat photo; others drop their private one
  const canRemove = chat.isCreator ? !!chat.photo && !(chat.direct && !chat.hasOwnPhoto) : !!chat.hasOwnPhoto
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(name) }} className="pop-in rounded-2xl bg-white/95 backdrop-blur border border-slate-200 shadow-lg p-4 relative">
      <button type="button" onClick={onDone} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
      <p className="font-semibold text-slate-800">{chat.isCreator ? 'Chat name & photo' : 'Your name & photo for this chat'}</p>
      <p className="text-xs text-slate-500 mt-0.5">
        {chat.isCreator
          ? 'Everyone will see this name. Leave it empty to show people\'s names.'
          : <>Only you will see it. Everyone else keeps <b>{chat.originalName}</b>.</>}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative shrink-0">
        <button type="button" onClick={() => pickPhoto.current?.click()} title="Change photo" className={`relative size-14 shrink-0 rounded-2xl overflow-hidden ${tintOf(chat.id)} grid place-items-center text-2xl group`}>
          {chat.photo ? <img src={chat.photo} className="size-full object-cover" /> : chat.emoji}
          <span className="absolute inset-0 bg-black/40 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition">{busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}</span>
        </button>
        {canRemove && <button type="button" onClick={() => { if (confirm('Remove this photo?')) photo(null) }} title="Remove photo" className="absolute -top-1 -right-1 size-6 rounded-full bg-white border border-slate-200 shadow text-slate-500 hover:text-rose-600 grid place-items-center"><X className="size-3.5" /></button>}
        </div>
        <input ref={pickPhoto} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) photo(f); e.target.value = '' }} />
        <div className="text-xs space-y-1">
          <button type="button" onClick={() => pickPhoto.current?.click()} className="block text-brand-600 hover:underline">{chat.photo ? 'Change photo' : 'Add photo'}</button>
          {canRemove && <button type="button" onClick={() => photo(null)} className="block text-slate-500 hover:text-rose-600">Remove photo</button>}
          <p className="text-slate-400">{chat.isCreator ? 'Everyone sees it' : 'Only you see it'}{chat.direct ? ' · default is their profile photo' : ''}</p>
        </div>
      </div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={chat.isCreator ? 'e.g. Family, Weekend crew' : chat.originalName} maxLength={60} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
      <div className="mt-3 flex items-center gap-2">
        {!chat.isCreator && chat.nickname && <button type="button" onClick={() => save('')} className="text-xs text-slate-500 hover:text-rose-600">Use original name</button>}
        <button type="button" onClick={onDone} className="ml-auto px-3 py-1.5 text-sm text-slate-500">Cancel</button>
        <button disabled={busy} className="px-4 py-1.5 text-sm rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium">Save</button>
      </div>
    </form>
  )
}


/** Live status under the message a Keep or Plan came from: who said yes / maybe / no, who has done it. */
function ItemStatus({ item, list, chatId, people, meId, onOpen }: { item: Item; list: List; chatId: string; people: Person[]; meId: string; onOpen: () => void }) {
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone'
  const doneBy = item.doneBy ?? []
  const iDid = doneBy.includes(meId)
  const votes = item.votes ?? {}
  const count = (v: Vote) => Object.values(votes).filter((x) => x === v).length
  const isPlan = list === 'plans'
  return (
    <div className="pop-in w-56 rounded-2xl border border-slate-200 bg-white shadow-sm px-3 py-2 text-xs">
      <button onClick={onOpen} className="flex items-center gap-1.5 font-medium text-slate-700 hover:text-brand-600 max-w-full">
        {isPlan ? <CalendarHeart className="size-3.5 shrink-0 text-brand-500" /> : <Bookmark className="size-3.5 shrink-0 text-emerald-600" />}
        <span className={`truncate ${item.skipped ? 'line-through text-slate-400' : ''}`}>{item.text}</span>
        {item.skipped && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">Skipped</span>}
      </button>
      {!item.skipped && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {isPlan && <VoteBar it={item} chatId={chatId} people={people} meId={meId} onVoted={() => {}} />}
          {isPlan && Object.keys(votes).length > 0 && <span className="text-slate-400">{count('yes')} yes · {count('maybe')} maybe · {count('no')} no</span>}
          {!isPlan && (
            <>
              <button onClick={() => api.updateItem(chatId, item.id, { done: !iDid })} className={`h-7 px-2.5 rounded-full border font-medium flex items-center gap-1 transition ${iDid ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-600'}`}>
                <Check className="size-3.5" strokeWidth={3} />{iDid ? 'You did it' : 'Mark done'}
              </button>
              {doneBy.length > 0 ? (
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="flex -space-x-1">{doneBy.slice(0, 4).map((id) => <span key={id} className="ring-2 ring-white rounded-full"><Avatar name={nameOf(id)} size="size-4" /></span>)}</span>
                  Done by {doneBy.map((id) => (id === meId ? 'you' : nameOf(id).split(' ')[0])).join(', ')}
                </span>
              ) : <span className="text-slate-400">Not done yet</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
