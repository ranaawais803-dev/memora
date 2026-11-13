import { useCallback, useEffect, useRef, useState } from 'react'
import { api, auth, onLoggedOut, socket, type Chat, type Insights, type List, type Status, type StatusPost, type User } from './api'
import type { Focus } from './Organized'
import Sidebar from './Sidebar'
import ChatView from './ChatView'
import Organized from './Organized'
import { photoBook } from './Tasks'
import Everything from './Everything'
import { StatusColumn, StatusComposer, StatusViewer, groupStatuses } from './Status'
import { ArrowLeft, Loader2, MessageCircle, Phone, ShieldCheck, Sparkles } from 'lucide-react'

/** chat = pure messenger · split = chat + organized panel */
export type ViewMode = 'chat' | 'split'

export default function App() {
  const [me, setMe] = useState<User | null | undefined>(undefined) // undefined = checking session

  useEffect(() => {
    const out = () => { socket.disconnect(); setMe(null) }
    onLoggedOut.addEventListener('logout', out)
    if (!auth.token) setMe(null)
    else api.me().then(setMe).catch(() => setMe(null))
    return () => onLoggedOut.removeEventListener('logout', out)
  }, [])

  if (me === undefined) return <div className="h-full grid place-items-center"><Loader2 className="size-6 animate-spin text-slate-400" /></div>
  if (!me) return <AuthScreen onDone={(token, user) => { auth.set(token); setMe(user) }} />
  return (
    <Workspace
      key={me.id}
      me={me}
      onMe={setMe}
      onLogout={async () => {
        await api.logout().catch(() => {})
        auth.set(null)
        socket.disconnect()
        setMe(null)
      }}
    />
  )
}

function Workspace({ me, onMe, onLogout }: { me: User; onMe: (u: User) => void; onLogout: () => void }) {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [everything, setEverything] = useState(true)
  const [mode, setMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('weave:mode')
    return saved === 'chat' || saved === 'split' ? saved : innerWidth >= 1280 ? 'split' : 'chat'
  })
  const [status, setStatus] = useState<Status | null>(null)
  const [jumpTo, setJumpTo] = useState<{ id: string; n: number } | null>(null)
  const [connected, setConnected] = useState(true)
  const [statuses, setStatuses] = useState<StatusPost[]>([])
  const [viewing, setViewing] = useState<string | null>(null) // userId whose status is open
  const [composing, setComposing] = useState(false)
  const [scope, setScope] = useState<string | null>(null) // chat picked in Organized for you
  const loadStatuses = useCallback(() => api.statuses().then(setStatuses).catch(() => {}), [])
  useEffect(() => {
    loadStatuses()
    socket.on('statuses', loadStatuses)
    const t = setInterval(loadStatuses, 5 * 60000) // drop ones that turned 24h old
    return () => { socket.off('statuses', loadStatuses); clearInterval(t) }
  }, [loadStatuses])
  const groups = groupStatuses(statuses, me)
  const viewStatus = (userId: string) => { if (groups.some((g) => g.userId === userId)) setViewing(userId) }

  const changeMode = (m: ViewMode) => {
    setMode(m)
    try { localStorage.setItem('weave:mode', m) } catch { /* private mode */ }
  }

  const loadChats = useCallback(() => api.chats().then(setChats).catch(() => {}), [])
  // everyone's profile photo, so every avatar in the app can show it
  photoBook.clear()
  for (const p of chats.flatMap((c) => c.people)) if (p.avatar) photoBook.set(p.name, p.avatar)
  if (me.avatar) photoBook.set(me.name, me.avatar)
  useEffect(() => {
    socket.connect()
    loadChats()
    api.status().then(setStatus)
    if (location.search.includes('drive=connected')) history.replaceState(null, '', '/')
    const refresh = () => loadChats()
    const presence = ({ userId, online }: { userId: string; online: boolean }) =>
      setChats((cs) => cs.map((c) => ({ ...c, people: c.people.map((p) => (p.id === userId ? { ...p, online } : p)) })))
    const up = () => { setConnected(true); loadChats() } // re-sync anything missed while offline
    const down = () => setConnected(false)
    socket.on('message', refresh)
    socket.on('chats', refresh)
    socket.on('insights', refresh)
    socket.on('presence', presence)
    socket.on('connect', up)
    socket.on('disconnect', down)
    return () => {
      socket.off('message', refresh)
      socket.off('chats', refresh)
      socket.off('insights', refresh)
      socket.off('presence', presence)
      socket.off('connect', up)
      socket.off('disconnect', down)
    }
  }, [loadChats])

  // Organized data for the open chat, shared by the chat (chips on messages) and the panel.
  const [ins, setIns] = useState<Insights | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const pendingFocus = useRef<Focus | null>(null)
  useEffect(() => {
    setIns(null)
    setFocus(pendingFocus.current)
    pendingFocus.current = null
    if (!activeId) return
    api.insights(activeId).then(setIns).catch(() => {})
    const on = (e: { chatId: string; insights: Insights }) => e.chatId === activeId && setIns(e.insights)
    socket.on('insights', on)
    return () => { socket.off('insights', on) }
  }, [activeId])

  const active = chats.find((c) => c.id === activeId) ?? null
  const open = (id: string, messageId?: string) => {
    setEverything(false)
    setActiveId(id)
    setJumpTo(messageId ? { id: messageId, n: Date.now() } : null)
  }
  /** chat -> organized: open the panel on that keep/plan */
  const showItem = (id: string, list: List) => {
    if (mode === 'chat') changeMode('split')
    setFocus({ id, list, n: Date.now() })
  }
  /** everything -> that chat, panel open on the item */
  const openItem = (chatId: string, id: string, list: List) => {
    const f = { id, list, n: Date.now() }
    if (chatId === activeId) setFocus(f)
    else pendingFocus.current = f
    open(chatId)
    changeMode('split')
  }
  /** organized -> chat: scroll to and highlight the message */
  const showMessage = (messageId: string) => {
    if (!active) return
    open(active.id, messageId)
    if (innerWidth < 1024) changeMode('chat')
  }

  // Layout per mode. On small screens only one pane shows at a time.
  const chatCls = mode === 'chat' ? 'flex flex-1' : 'hidden lg:flex flex-1 min-w-[340px]'
  const panelCls = 'flex w-full lg:w-[min(48vw,720px)] shrink-0'

  return (
    <div className="h-full flex flex-col bg-white">
      {!connected && <div className="text-center text-xs bg-amber-100 text-amber-800 py-1">Reconnecting…</div>}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          me={me}
          chats={chats}
          activeId={activeId}
          status={status}
          onOpen={open}
          everything={everything}
          onEverything={() => { setEverything(true); setActiveId(null) }}
          onCreate={async (name, emoji, userIds) => { const c = await api.createChat(name, emoji, userIds); await loadChats(); open(c.id) }}
          onStatus={() => api.status().then(setStatus)}
          onMe={onMe}
          onLogout={onLogout}
          className={active || everything ? 'hidden md:flex' : 'flex'}
        />
        {everything ? (
          <div className="flex flex-1 min-w-0">
          <Everything me={me} chats={chats} onChats={setChats} onOpenItem={openItem} onOpenChat={(id, mid) => { open(id, mid); changeMode('split') }} onBack={() => setEverything(false)} onScope={setScope} className="flex" />
          <StatusColumn me={me} groups={groups} scope={(() => { const c = chats.find((x) => x.id === scope); return c ? { name: c.name, memberIds: c.people.map((p) => p.id) } : null })()} onView={viewStatus} onAdd={() => setComposing(true)} className="hidden lg:flex" />
          </div>
        ) : active ? (
          <div className="flex flex-1 min-w-0">
            <ChatView
              key={active.id}
              me={me}
              chat={active}
              jumpTo={jumpTo}
              ins={ins}
              onShowItem={showItem}
              statusGroups={groups}
              onViewStatus={viewStatus}
              mode={mode}
              onMode={changeMode}
              onBack={() => setActiveId(null)}
              onLeft={() => { setActiveId(null); loadChats() }}
              className={chatCls}
            />
            {mode !== 'chat' && (
              <Organized
                key={active.id + '-p'}
                chat={active}
                me={me.name}
                ins={ins}
                setIns={setIns}
                focus={focus}
                mode={mode}
                onMode={changeMode}
                onJump={showMessage}
                meId={me.id}
                statusGroups={groups}
                onViewStatus={viewStatus}
                className={panelCls}
              />
            )}
          </div>
        ) : (
          <Welcome me={me} />
        )}
      </div>
      {viewing && <StatusViewer key={viewing} groups={groups} startUserId={viewing} me={me} onClose={() => { setViewing(null); loadStatuses() }} />}
      {composing && <StatusComposer onClose={() => setComposing(false)} onPosted={loadStatuses} />}
    </div>
  )
}

function Welcome({ me }: { me: User }) {
  return (
    <div className="hidden md:flex flex-1 flex-col items-center justify-center text-center bg-canvas px-8">
      <div className="size-20 rounded-3xl bg-gradient-to-br from-brand-500 to-violet-500 text-white grid place-items-center mb-5 shadow-lg shadow-brand-500/25">
        <MessageCircle className="size-9" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800">Hi {me.name.split(' ')[0]} 👋</h2>
      <p className="text-slate-500 mt-2 max-w-md leading-relaxed">Pick a chat and talk like you always do. We'll keep track of plans, photos and the little things for you.</p>
      <div className="mt-6 grid grid-cols-3 gap-3 max-w-lg text-left">
        {[
          ['💬', 'Just chat', 'Nothing new to learn'],
          ['🧺', 'Kept for you', 'Plans and reminders, saved'],
          ['📸', 'Tidy photos', 'Sorted into folders'],
        ].map(([e, t, d]) => (
          <div key={t} className="rounded-2xl bg-white border border-slate-200/70 p-4 shadow-sm">
            <div className="text-xl">{e}</div>
            <p className="font-semibold text-sm mt-2">{t}</p>
            <p className="text-xs text-slate-500 mt-0.5">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-slate-400 text-sm mt-6">People can add you with your number <b className="text-slate-600">{me.phone}</b></p>
    </div>
  )
}

function AuthScreen({ onDone }: { onDone: (token: string, user: User) => void }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [isNew, setIsNew] = useState(true)
  const [devCode, setDevCode] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try { await fn() } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const sendCode = (e?: React.FormEvent) => {
    e?.preventDefault()
    run(async () => {
      const r = await api.requestCode(phone)
      setIsNew(r.isNew)
      setDevCode(r.devCode)
      setStep('code')
      setTimeout(() => codeRef.current?.focus(), 50)
    })
  }

  const verify = (e?: React.FormEvent) => {
    e?.preventDefault()
    run(async () => {
      const r = await api.verify(phone, code, isNew ? name : undefined)
      onDone(r.token, r.user)
    })
  }

  const input = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 transition'
  return (
    <div className="h-full grid lg:grid-cols-2 bg-white">
      <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-brand-600 via-brand-500 to-violet-500 text-white p-12">
        <div className="flex items-center gap-2.5"><Logo className="size-9" light /> <span className="text-xl font-bold">Weave</span></div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Just chat.<br />We'll remember the rest.</h1>
          <p className="mt-4 text-white/80 text-lg max-w-md">Talk like you always do, with family, friends or your team. Weave quietly keeps track of plans, files and the things you'd forget.</p>
          <div className="mt-8 space-y-3 max-w-md">
            {['“Buy milk tomorrow” and “Send the proposal by Friday” won’t get lost', 'Photos and documents find their own folders', 'Missed 100 messages? Get the gist in a second'].map((t) => (
              <p key={t} className="flex items-center gap-3 text-white/90"><Sparkles className="size-4 shrink-0" />{t}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            {['🏡 Family', '🎉 Friends', '⚽ Clubs', '💼 Work teams', '🚀 Small business'].map((t) => (
              <span key={t} className="px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium">{t}</span>
            ))}
          </div>
        </div>
        <p className="text-white/60 text-sm">From the family group to the project team, quietly organized.</p>
      </div>

      <div className="grid place-items-center p-6 bg-canvas lg:bg-white">
        <div className="w-full max-w-sm">
          <Logo className="size-14 lg:hidden mx-auto mb-6" />
          {step === 'phone' ? (
            <form onSubmit={sendCode}>
              <h2 className="text-2xl font-bold">Enter your phone number</h2>
              <p className="text-slate-500 mt-1">We'll send you a 6-digit code. No password needed.</p>
              <label className={`${input} mt-6 flex items-center gap-3 !py-0`}>
                <Phone className="size-5 text-slate-400" />
                <input autoFocus type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ''))} placeholder="+92 300 1234567" autoComplete="tel" className="flex-1 py-3.5 outline-none bg-transparent text-lg tracking-wide" />
              </label>
              <p className="text-xs text-slate-400 mt-2">Include your country code, e.g. +92 or +1.</p>
              {error && <p className="mt-3 text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
              <button disabled={busy || phone.replace(/\D/g, '').length < 7} className="mt-5 w-full rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold py-3.5 transition flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20">
                {busy && <Loader2 className="size-4 animate-spin" />} Send code
              </button>
            </form>
          ) : (
            <form onSubmit={verify}>
              <button type="button" onClick={() => { setStep('phone'); setCode(''); setError('') }} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft className="size-4" /> Change number</button>
              <h2 className="text-2xl font-bold">{isNew ? 'Create your account' : 'Welcome back'}</h2>
              <p className="text-slate-500 mt-1">Enter the code sent to <b className="text-slate-700">{phone}</b></p>
              {devCode && (
                <p className="mt-4 text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                  Test mode (no SMS set up): your code is <b className="font-mono tracking-widest">{devCode}</b>
                </p>
              )}
              <input
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                className={`${input} mt-4 text-center text-2xl font-mono tracking-[0.5em]`}
              />
              {isNew && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={`${input} mt-3`} />}
              {error && <p className="mt-3 text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">{error}</p>}
              <button disabled={busy || code.length !== 6 || (isNew && !name.trim())} className="mt-5 w-full rounded-2xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold py-3.5 transition flex items-center justify-center gap-2 shadow-lg shadow-brand-500/20">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {isNew ? 'Create account' : 'Log in'}
              </button>
              <button type="button" onClick={() => sendCode()} disabled={busy} className="mt-3 w-full text-sm text-slate-500 hover:text-brand-600">Didn't get it? Send again</button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export function Logo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className}>
      <rect width="32" height="32" rx="9" fill={light ? 'white' : '#2f5bf5'} />
      <path d="M8 11l4 11 4-8 4 8 4-11" stroke={light ? '#2f5bf5' : 'white'} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
