import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Plus, X, TrendingUp, TrendingDown, Minus, Target, DollarSign, BarChart2, ChevronDown, ChevronUp, Edit2, Check, AlertCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logTradeOutcome, updateTradeOutcome, getTradeOutcomes, type TradeOutcome } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Outcome = 'win' | 'loss' | 'breakeven' | 'open'
type SetupTag = 'FLAT_TOP' | 'FLAG' | 'WEDGE' | 'BASE' | 'BREAKOUT' | 'PULLBACK' | 'OTHER'

interface JournalFormState {
  symbol: string
  setup_type: SetupTag
  entry_price: string
  exit_price: string
  outcome: Outcome
  notes: string
}

const BLANK_FORM: JournalFormState = {
  symbol: '',
  setup_type: 'BREAKOUT',
  entry_price: '',
  exit_price: '',
  outcome: 'open',
  notes: '',
}

const SETUP_LABELS: Record<SetupTag, string> = {
  FLAT_TOP: '📊 Flat Top',
  FLAG: '🚩 Bull Flag',
  WEDGE: '📐 Wedge',
  BASE: '🏗️ Base',
  BREAKOUT: '⚡ Breakout',
  PULLBACK: '↩️ Pullback',
  OTHER: '• Other',
}

const OUTCOME_CFG: Record<Outcome, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  win:       { label: 'Win',       color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: <TrendingUp  className="h-3.5 w-3.5" /> },
  loss:      { label: 'Loss',      color: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/30',         icon: <TrendingDown className="h-3.5 w-3.5" /> },
  breakeven: { label: 'B/E',       color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/30',     icon: <Minus        className="h-3.5 w-3.5" /> },
  open:      { label: 'Open',      color: 'text-sky-400',     bg: 'bg-sky-500/15 border-sky-500/30',         icon: <Target       className="h-3.5 w-3.5" /> },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gainPct(entry: number, exit: number): number {
  return ((exit - entry) / entry) * 100
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—'
  return n.toFixed(digits)
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function JournalStats({ trades }: { trades: TradeOutcome[] }) {
  const closed = trades.filter(t => t.outcome !== 'open')
  const wins   = closed.filter(t => t.outcome === 'win')
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
  const totalGain = trades.reduce((s, t) => s + (t.gain_pct ?? 0), 0)
  const avgGain = closed.length ? totalGain / closed.length : 0
  const bestWin = wins.length ? Math.max(...wins.map(t => t.gain_pct ?? 0)) : 0

  const stats = [
    { label: 'Trades Logged', value: trades.length.toString(), color: 'text-white' },
    { label: 'Win Rate',      value: closed.length ? winRate.toFixed(0) + '%' : '—', color: winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Avg Gain',      value: closed.length ? (avgGain >= 0 ? '+' : '') + avgGain.toFixed(1) + '%' : '—', color: avgGain >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Best Win',      value: bestWin ? '+' + bestWin.toFixed(1) + '%' : '—', color: 'text-emerald-400' },
  ]

  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      {stats.map(s => (
        <div key={s.label} className="bg-white/3 border border-white/8 rounded-xl p-4">
          <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold mb-1">{s.label}</p>
          <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────

function TradeForm({
  initial,
  onSave,
  onCancel,
  loading,
}: {
  initial?: JournalFormState
  onSave: (data: JournalFormState) => Promise<void>
  onCancel: () => void
  loading: boolean
}) {
  const [form, setForm] = useState<JournalFormState>(initial ?? BLANK_FORM)
  const set = (k: keyof JournalFormState) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const entry = parseFloat(form.entry_price)
  const exit  = parseFloat(form.exit_price)
  const previewGain = !isNaN(entry) && !isNaN(exit) && entry > 0 ? gainPct(entry, exit) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-[#0d1520] border border-white/10 rounded-2xl p-6 mb-6"
    >
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-sky-400" />
        {initial ? 'Edit Trade' : 'Log a Trade'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Symbol */}
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Ticker</label>
          <input
            value={form.symbol}
            onChange={e => set('symbol')(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20"
          />
        </div>

        {/* Setup */}
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Setup</label>
          <select
            value={form.setup_type}
            onChange={e => set('setup_type')(e.target.value)}
            className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none"
          >
            {(Object.keys(SETUP_LABELS) as SetupTag[]).map(k => (
              <option key={k} value={k}>{SETUP_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {/* Entry */}
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Entry Price</label>
          <input
            type="number"
            step="0.01"
            value={form.entry_price}
            onChange={e => set('entry_price')(e.target.value)}
            placeholder="0.00"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20"
          />
        </div>

        {/* Exit */}
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
            Exit Price
            {previewGain !== null && (
              <span className={`ml-2 font-mono ${previewGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {previewGain >= 0 ? '+' : ''}{previewGain.toFixed(2)}%
              </span>
            )}
          </label>
          <input
            type="number"
            step="0.01"
            value={form.exit_price}
            onChange={e => set('exit_price')(e.target.value)}
            placeholder="leave blank if open"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20"
          />
        </div>

        {/* Outcome */}
        <div className="col-span-2">
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Outcome</label>
          <div className="flex gap-2">
            {(Object.keys(OUTCOME_CFG) as Outcome[]).map(o => {
              const cfg = OUTCOME_CFG[o]
              const active = form.outcome === o
              return (
                <button
                  key={o}
                  onClick={() => set('outcome')(o)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${active ? cfg.bg + ' ' + cfg.color : 'border-white/8 text-white/30 hover:border-white/20 hover:text-white/60'}`}
                >
                  {cfg.icon}{cfg.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="col-span-2">
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes')(e.target.value)}
            rows={2}
            placeholder="What worked? What didn't? Emotions? Mistakes?"
            className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20 resize-none"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={onCancel}
          className="border-white/10 text-white/50 hover:text-white text-xs">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={loading || !form.symbol}
          onClick={() => onSave(form)}
          className="bg-sky-600 hover:bg-sky-500 text-white text-xs"
        >
          {loading ? 'Saving…' : <><Check className="h-3.5 w-3.5 mr-1" />Save Trade</>}
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Single trade row ─────────────────────────────────────────────────────────

function TradeRow({
  trade,
  onEdit,
}: {
  trade: TradeOutcome
  onEdit: (t: TradeOutcome) => void
}) {
  const [open, setOpen] = useState(false)
  const cfg = OUTCOME_CFG[trade.outcome as Outcome] ?? OUTCOME_CFG.open
  const setupLabel = SETUP_LABELS[trade.setup_type as SetupTag] ?? trade.setup_type ?? '—'
  const date = trade.traded_at ? new Date(trade.traded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

  return (
    <div className="bg-white/2 border border-white/8 rounded-xl overflow-hidden hover:border-white/15 transition-colors">
      {/* Summary row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer"
        onClick={() => setOpen(o => !o)}
      >
        {/* Symbol */}
        <div className="w-20 shrink-0">
          <span className="font-bold text-white font-mono text-sm">{trade.symbol}</span>
        </div>

        {/* Setup tag */}
        <div className="w-32 shrink-0">
          <span className="text-xs text-white/50 font-mono">{setupLabel}</span>
        </div>

        {/* Entry / Exit */}
        <div className="flex gap-3 flex-1 text-xs font-mono">
          <span className="text-white/60">In: <span className="text-white">${fmt(trade.entry_price)}</span></span>
          {trade.exit_price != null && (
            <span className="text-white/60">Out: <span className="text-white">${fmt(trade.exit_price)}</span></span>
          )}
        </div>

        {/* Gain */}
        {trade.gain_pct != null ? (
          <span className={`text-sm font-bold font-mono w-16 text-right ${trade.gain_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trade.gain_pct >= 0 ? '+' : ''}{fmt(trade.gain_pct, 1)}%
          </span>
        ) : (
          <span className="text-sm text-white/20 w-16 text-right font-mono">—</span>
        )}

        {/* Outcome badge */}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
          {cfg.icon}{cfg.label}
        </div>

        {/* Date */}
        <span className="text-[10px] text-white/30 w-16 text-right shrink-0">{date}</span>

        {/* Chevron */}
        {open ? <ChevronUp className="h-3.5 w-3.5 text-white/30 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />}
      </div>

      {/* Expanded notes */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/6 px-4 py-3 flex justify-between items-start gap-4">
              <p className="text-xs text-white/50 leading-relaxed flex-1">
                {trade.notes || <span className="italic text-white/20">No notes added.</span>}
              </p>
              <button
                onClick={() => onEdit(trade)}
                className="shrink-0 text-xs text-sky-400 border border-sky-500/30 px-2.5 py-1 rounded-lg hover:bg-sky-500/10 flex items-center gap-1"
              >
                <Edit2 className="h-3 w-3" />Edit
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TradeJournal() {
  const [trades, setTrades] = useState<TradeOutcome[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<TradeOutcome | null>(null)
  const [filter, setFilter] = useState<Outcome | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { outcomes } = await getTradeOutcomes(100)
      setTrades(outcomes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load journal')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (form: JournalFormState) => {
    setSaving(true)
    setError(null)
    try {
      const entry = parseFloat(form.entry_price)
      const exit  = form.exit_price ? parseFloat(form.exit_price) : undefined
      const gain  = exit != null && entry > 0 ? gainPct(entry, exit) : undefined

      if (editTarget) {
        await updateTradeOutcome(editTarget.id, {
          exit_price: exit,
          gain_pct: gain,
          outcome: form.outcome,
          notes: form.notes,
        })
      } else {
        await logTradeOutcome({
          symbol: form.symbol,
          setup_type: form.setup_type,
          entry_price: entry,
          exit_price: exit,
          gain_pct: gain,
          outcome: form.outcome,
          notes: form.notes,
        })
      }
      setShowForm(false)
      setEditTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (t: TradeOutcome) => {
    setEditTarget(t)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const filtered = filter === 'all' ? trades : trades.filter(t => t.outcome === filter)

  const FILTERS: Array<{ id: Outcome | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'win', label: 'Wins' },
    { id: 'loss', label: 'Losses' },
    { id: 'breakeven', label: 'B/E' },
  ]

  return (
    <section className="mt-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/20 ring-1 ring-white/10">
            <BookOpen className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Trade Journal</h2>
            <p className="text-xs text-white/40">Log every trade. Build your edge.</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => { setEditTarget(null); setShowForm(s => !s) }}
          className="bg-sky-600 hover:bg-sky-500 text-white text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />{showForm && !editTarget ? 'Cancel' : 'Log Trade'}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-4 py-3 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {/* Add/Edit form */}
      <AnimatePresence>
        {showForm && (
          <TradeForm
            key={editTarget?.id ?? 'new'}
            initial={editTarget ? {
              symbol: editTarget.symbol,
              setup_type: (editTarget.setup_type as SetupTag) ?? 'BREAKOUT',
              entry_price: String(editTarget.entry_price ?? ''),
              exit_price: String(editTarget.exit_price ?? ''),
              outcome: (editTarget.outcome as Outcome) ?? 'open',
              notes: editTarget.notes ?? '',
            } : undefined}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditTarget(null) }}
            loading={saving}
          />
        )}
      </AnimatePresence>

      {/* Stats */}
      {trades.length > 0 && <JournalStats trades={trades} />}

      {/* Filter tabs */}
      {trades.length > 0 && (
        <div className="flex gap-2 mb-4">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                filter === f.id
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                  : 'border-white/8 text-white/30 hover:text-white/60 hover:border-white/20'
              }`}
            >
              {f.label}
              {f.id !== 'all' && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {trades.filter(t => t.outcome === f.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Trade list */}
      {loading ? (
        <div className="text-center text-white/30 text-sm py-16">Loading journal…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/8 rounded-2xl">
          <BookOpen className="h-10 w-10 text-white/15 mx-auto mb-3" />
          <p className="text-white/30 text-sm">
            {filter === 'all' ? 'No trades logged yet. Start tracking your performance.' : `No ${filter} trades logged.`}
          </p>
          {filter === 'all' && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 text-xs text-sky-400 border border-sky-500/30 px-4 py-2 rounded-lg hover:bg-sky-500/10"
            >
              Log your first trade
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <TradeRow key={t.id} trade={t} onEdit={startEdit} />
          ))}
        </div>
      )}
    </section>
  )
}
