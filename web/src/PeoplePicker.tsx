import { useEffect, useState } from 'react'
import { X, UserPlus } from 'lucide-react'
import { api, type User } from './api'

/** Find people by phone number (or by name, for people you already chat with). */
export default function PeoplePicker({ selected, onChange, exclude = [] }: { selected: User[]; onChange: (u: User[]) => void; exclude?: string[] }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<User[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) return setFound([])
    setLoading(true)
    const t = setTimeout(() => api.findUsers(q).then(setFound).catch(() => setFound([])).finally(() => setLoading(false)), 250)
    return () => clearTimeout(t)
  }, [q])

  const hide = new Set([...exclude, ...selected.map((s) => s.id)])
  const options = found.filter((u) => !hide.has(u.id))
  const digits = q.replace(/\D/g, '')

  return (
    <div className="relative">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((u) => (
            <span key={u.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium">
              {u.name}
              <button type="button" onClick={() => onChange(selected.filter((s) => s.id !== u.id))} className="hover:text-brand-900"><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 focus-within:border-brand-500">
        <UserPlus className="size-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by phone number" inputMode="tel" className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
      </label>
      {q.trim().length >= 2 && !loading && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          {options.length ? (
            options.map((u) => (
              <button type="button" key={u.id} onClick={() => { onChange([...selected, u]); setQ('') }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                <span className="size-7 rounded-full bg-slate-100 grid place-items-center text-xs font-semibold text-slate-600">{u.name[0]?.toUpperCase()}</span>
                <span className="text-sm min-w-0"><b className="font-medium text-slate-700">{u.name}</b> <span className="text-slate-400">{u.phone}</span></span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-slate-400">{digits.length < 6 ? 'Type at least 6 digits of their number.' : 'No one with that number yet. Ask them to sign up first.'}</p>
          )}
        </div>
      )}
    </div>
  )
}
