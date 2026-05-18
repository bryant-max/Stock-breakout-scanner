import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sidebar } from "@/components/dashboard/Sidebar"
import {
  getTradeOutcomes, logTradeOutcome, updateTradeOutcome, getAIQueryLog,
  type TradeOutcome, type AIQueryLog,
} from "@/lib/api"
import {
  BookOpen, TrendingUp, TrendingDown, Minus, Target,
  Plus, Check, Edit2, ChevronDown, ChevronUp,
  AlertCircle, BarChart3, Search, RefreshCw, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Outcome  = "win" | "loss" | "breakeven" | "open"
type SetupTag = "FLAT_TOP" | "FLAG" | "WEDGE" | "BASE" | "BREAKOUT" | "PULLBACK" | "OTHER"

interface JournalFormState {
  symbol: string
  setup_type: SetupTag
  entry_price: string
  exit_price: string
  outcome: Outcome
  notes: string
}

const BLANK: JournalFormState = {
  symbol: "", setup_type: "BREAKOUT",
  entry_price: "", exit_price: "", outcome: "open", notes: "",
}

const SETUP_LABELS: Record<SetupTag, string> = {
  FLAT_TOP: "📊 Flat Top", FLAG: "🚩 Bull Flag", WEDGE: "📐 Wedge",
  BASE: "🏗️ Base", BREAKOUT: "⚡ Breakout", PULLBACK: "↩️ Pullback", OTHER: "• Other",
}

const OUTCOME_CFG: Record<Outcome, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  win:       { label: "Win",  color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30", icon: <TrendingUp  className="h-3.5 w-3.5" /> },
  loss:      { label: "Loss", color: "text-red-400",     bg: "bg-red-500/15 border-red-500/30",         icon: <TrendingDown className="h-3.5 w-3.5" /> },
  breakeven: { label: "B/E",  color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/30",     icon: <Minus        className="h-3.5 w-3.5" /> },
  open:      { label: "Open", color: "text-sky-400",     bg: "bg-sky-500/15 border-sky-500/30",         icon: <Target       className="h-3.5 w-3.5" /> },
}

function gainPct(entry: number, exit: number) { return ((exit - entry) / entry) * 100 }
function fmt(n?: number | null, d = 2) { return n == null ? "—" : n.toFixed(d) }

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function JournalStats({ trades }: { trades: TradeOutcome[] }) {
  const closed   = trades.filter(t => t.outcome !== "open")
  const wins     = closed.filter(t => t.outcome === "win")
  const winRate  = closed.length ? (wins.length / closed.length) * 100 : 0
  const totalPnl = closed.reduce((s, t) => s + (t.gain_pct ?? 0), 0)
  const avgGain  = closed.length ? totalPnl / closed.length : 0
  const bestWin  = wins.length ? Math.max(...wins.map(t => t.gain_pct ?? 0)) : 0
  const stats = [
    { label: "Trades",    value: trades.length.toString(),                                                    color: "text-white" },
    { label: "Win Rate",  value: closed.length ? winRate.toFixed(0) + "%" : "—",                            color: winRate >= 50 ? "text-emerald-400" : "text-red-400" },
    { label: "Avg Gain",  value: closed.length ? (avgGain >= 0 ? "+" : "") + avgGain.toFixed(1) + "%" : "—", color: avgGain >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "Best Win",  value: bestWin ? "+" + bestWin.toFixed(1) + "%" : "—",                              color: "text-emerald-400" },
    { label: "Total P/L", value: closed.length ? (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(1) + "%" : "—", color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400" },
  ]
  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {stats.map(s => (
        <Card key={s.label} className="bg-white/2 border-white/10 p-4">
          <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold mb-1">{s.label}</p>
          <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
        </Card>
      ))}
    </div>
  )
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function TradeForm({ initial, onSave, onCancel, saving }: {
  initial?: JournalFormState; onSave: (f: JournalFormState) => void
  onCancel: () => void; saving: boolean
}) {
  const [form, setForm] = useState<JournalFormState>(initial ?? BLANK)
  const set = (k: keyof JournalFormState) => (v: string) => setForm(f => ({ ...f, [k]: v }))
  const entry = parseFloat(form.entry_price), exit = parseFloat(form.exit_price)
  const preview = !isNaN(entry) && !isNaN(exit) && entry > 0 ? gainPct(entry, exit) : null

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="bg-[#0d1520] border border-white/10 rounded-2xl p-6 mb-6">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-sky-400" />
        {initial ? "Edit Trade" : "Log a Trade"}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Ticker</label>
          <input value={form.symbol} onChange={e => set("symbol")(e.target.value.toUpperCase())} placeholder="AAPL"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20" />
        </div>
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Setup</label>
          <select value={form.setup_type} onChange={e => set("setup_type")(e.target.value)}
            className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none">
            {(Object.keys(SETUP_LABELS) as SetupTag[]).map(k => <option key={k} value={k}>{SETUP_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Entry Price</label>
          <input type="number" step="0.01" value={form.entry_price} onChange={e => set("entry_price")(e.target.value)} placeholder="0.00"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20" />
        </div>
        <div>
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
            Exit Price
            {preview !== null && <span className={`ml-2 font-mono ${preview >= 0 ? "text-emerald-400" : "text-red-400"}`}>{preview >= 0 ? "+" : ""}{preview.toFixed(2)}%</span>}
          </label>
          <input type="number" step="0.01" value={form.exit_price} onChange={e => set("exit_price")(e.target.value)} placeholder="leave blank if open"
            className="w-full bg-black/40 border border-white/10 text-white font-mono text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Outcome</label>
          <div className="flex gap-2">
            {(Object.keys(OUTCOME_CFG) as Outcome[]).map(o => {
              const cfg = OUTCOME_CFG[o], active = form.outcome === o
              return (
                <button key={o} onClick={() => set("outcome")(o)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${active ? cfg.bg + " " + cfg.color : "border-white/8 text-white/30 hover:border-white/20 hover:text-white/60"}`}>
                  {cfg.icon}{cfg.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">Notes / Lessons</label>
          <textarea value={form.notes} onChange={e => set("notes")(e.target.value)} rows={2}
            placeholder="What worked? What didn't? Emotions? Entry trigger? Mistakes?"
            className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:border-sky-500 focus:outline-none placeholder-white/20 resize-none" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={onCancel} className="border-white/10 text-white/50 hover:text-white text-xs">Cancel</Button>
        <Button size="sm" disabled={saving || !form.symbol} onClick={() => onSave(form)} className="bg-sky-600 hover:bg-sky-500 text-white text-xs">
          {saving ? "Saving…" : <><Check className="h-3.5 w-3.5 mr-1" />Save Trade</>}
        </Button>
      </div>
    </motion.div>
  )
}

// ─── Trade Row ────────────────────────────────────────────────────────────────

function TradeRow({ trade, onEdit }: { trade: TradeOutcome; onEdit: (t: TradeOutcome) => void }) {
  const [open, setOpen] = useState(false)
  const cfg   = OUTCOME_CFG[trade.outcome as Outcome] ?? OUTCOME_CFG.open
  const setup = SETUP_LABELS[trade.setup_type as SetupTag] ?? (trade.setup_type ?? "—")
  const date  = trade.traded_at ? new Date(trade.traded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"

  return (
    <div className="bg-white/2 border border-white/8 rounded-xl overflow-hidden hover:border-white/15 transition-colors">
      <div className="flex items-center gap-4 px-4 py-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <span className="font-bold text-white font-mono text-sm w-20 shrink-0">{trade.symbol}</span>
        <span className="text-xs text-white/50 font-mono w-32 shrink-0">{setup}</span>
        <div className="flex gap-3 flex-1 text-xs font-mono">
          <span className="text-white/60">In: <span className="text-white">${fmt(trade.entry_price)}</span></span>
          {trade.exit_price != null && <span className="text-white/60">Out: <span className="text-white">${fmt(trade.exit_price)}</span></span>}
        </div>
        {trade.gain_pct != null
          ? <span className={`text-sm font-bold font-mono w-16 text-right ${trade.gain_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{trade.gain_pct >= 0 ? "+" : ""}{fmt(trade.gain_pct, 1)}%</span>
          : <span className="text-sm text-white/20 w-16 text-right font-mono">—</span>}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${cfg.bg} ${cfg.color}`}>{cfg.icon}{cfg.label}</div>
        <span className="text-[10px] text-white/30 w-16 text-right shrink-0">{date}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-white/30 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-white/6 px-4 py-3 flex justify-between items-start gap-4">
              <p className="text-xs text-white/50 leading-relaxed flex-1">
                {trade.notes || <span className="italic text-white/20">No notes added.</span>}
              </p>
              <button onClick={() => onEdit(trade)} className="shrink-0 text-xs text-sky-400 border border-sky-500/30 px-2.5 py-1 rounded-lg hover:bg-sky-500/10 flex items-center gap-1">
                <Edit2 className="h-3 w-3" />Edit
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JournalAnalyticsPage() {
  const [trades,    setTrades]    = useState<TradeOutcome[]>([])
  const [queries,   setQueries]   = useState<AIQueryLog[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [showForm,  setShowForm]  = useState(false)
  const [editTarget,setEditTarget]= useState<TradeOutcome | null>(null)
  const [filter,    setFilter]    = useState<Outcome | "all">("all")
  const [error,     setError]     = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"journal" | "ai">("journal")

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [td, qd] = await Promise.all([getTradeOutcomes(100), getAIQueryLog(50)])
      setTrades(td.outcomes || [])
      setQueries(qd.queries || [])
    } catch (e) { setError(e instanceof Error ? e.message : "Load failed") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (form: JournalFormState) => {
    setSaving(true); setError(null)
    try {
      const entry = parseFloat(form.entry_price)
      const exit  = form.exit_price ? parseFloat(form.exit_price) : undefined
      const gain  = exit != null && entry > 0 ? gainPct(entry, exit) : undefined
      if (editTarget) {
        await updateTradeOutcome(editTarget.id, { exit_price: exit, gain_pct: gain, outcome: form.outcome, notes: form.notes })
      } else {
        await logTradeOutcome({ symbol: form.symbol, setup_type: form.setup_type, entry_price: entry, exit_price: exit, gain_pct: gain, outcome: form.outcome, notes: form.notes })
      }
      setShowForm(false); setEditTarget(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed") }
    finally { setSaving(false) }
  }

  const startEdit = (t: TradeOutcome) => { setEditTarget(t); setShowForm(true) }

  const FILTERS: Array<{ id: Outcome | "all"; label: string }> = [
    { id: "all", label: "All" }, { id: "open", label: "Open" },
    { id: "win", label: "Wins" }, { id: "loss", label: "Losses" }, { id: "breakeven", label: "B/E" },
  ]
  const filtered = filter === "all" ? trades : trades.filter(t => t.outcome === filter)

  const getCategoryColor = (cat: string) => {
    const map: Record<string, string> = {
      stock_analysis: "bg-blue-500/20 text-blue-400 border-blue-500/50",
      pattern: "bg-purple-500/20 text-purple-400 border-purple-500/50",
      comparison: "bg-cyan-500/20 text-cyan-400 border-cyan-500/50",
      risk_management: "bg-orange-500/20 text-orange-400 border-orange-500/50",
    }
    return map[cat] ?? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
  }

  return (
    <div className="min-h-screen bg-black">
      <Sidebar />
      <div className="min-h-screen ml-[var(--sidebar-w,60px)] transition-[margin-left] duration-300 ease-in-out">

        {/* Header */}
        <header className="fixed top-0 left-[var(--sidebar-w,60px)] transition-[left] duration-300 ease-in-out right-0 z-50 border-b border-white/5 bg-neutral-950/90 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between px-8">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/20 ring-1 ring-white/10">
                <BookOpen className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">Trade Journal</h1>
                <p className="text-xs text-neutral-400">Log every trade · Track your edge · Review AI usage</p>
              </div>
            </motion.div>
            <div className="flex items-center gap-3">
              <button onClick={load} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 border border-white/10 transition-colors">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />Refresh
              </button>
              <Button size="sm" onClick={() => { setEditTarget(null); setShowForm(s => !s) }} className="bg-sky-600 hover:bg-sky-500 text-white text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" />{showForm && !editTarget ? "Cancel" : "Log Trade"}
              </Button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex border-t border-white/5 px-8">
            {[{ id: "journal" as const, label: "📓 Journal", }, { id: "ai" as const, label: "🤖 AI Queries" }].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${activeTab === t.id ? "border-sky-500 text-sky-400" : "border-transparent text-white/40 hover:text-white/70"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </header>

        <main className="pt-28 p-8">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-4 py-3 mb-6">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24">
              <Loader2 className="h-8 w-8 text-sky-400 animate-spin mb-4" />
              <p className="text-white/50">Loading journal…</p>
            </div>
          ) : (
            <>
              {activeTab === "journal" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {/* Add/Edit form */}
                  <AnimatePresence>
                    {showForm && (
                      <TradeForm key={editTarget?.id ?? "new"}
                        initial={editTarget ? { symbol: editTarget.symbol, setup_type: (editTarget.setup_type as SetupTag) ?? "BREAKOUT", entry_price: String(editTarget.entry_price ?? ""), exit_price: String(editTarget.exit_price ?? ""), outcome: (editTarget.outcome as Outcome) ?? "open", notes: editTarget.notes ?? "" } : undefined}
                        onSave={handleSave} onCancel={() => { setShowForm(false); setEditTarget(null) }} saving={saving} />
                    )}
                  </AnimatePresence>

                  {/* Stats */}
                  {trades.length > 0 && <JournalStats trades={trades} />}

                  {/* Filters */}
                  {trades.length > 0 && (
                    <div className="flex gap-2 mb-4">
                      {FILTERS.map(f => (
                        <button key={f.id} onClick={() => setFilter(f.id)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${filter === f.id ? "bg-sky-500/15 border-sky-500/40 text-sky-400" : "border-white/8 text-white/30 hover:text-white/60 hover:border-white/20"}`}>
                          {f.label}
                          {f.id !== "all" && <span className="ml-1.5 text-[10px] opacity-60">{trades.filter(t => t.outcome === f.id).length}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Trade list */}
                  {filtered.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-white/8 rounded-2xl">
                      <BookOpen className="h-10 w-10 text-white/15 mx-auto mb-3" />
                      <p className="text-white/30 text-sm">
                        {filter === "all" ? "No trades logged yet. Start tracking your performance." : `No ${filter} trades logged.`}
                      </p>
                      {filter === "all" && (
                        <button onClick={() => setShowForm(true)} className="mt-4 text-xs text-sky-400 border border-sky-500/30 px-4 py-2 rounded-lg hover:bg-sky-500/10">
                          Log your first trade
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map(t => <TradeRow key={t.id} trade={t} onEdit={startEdit} />)}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === "ai" && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                  {/* AI summary stats */}
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { label: "Total Queries", value: queries.length.toString(), icon: <Search className="h-4 w-4 text-purple-400" />, color: "text-white" },
                      { label: "Stock Analysis", value: queries.filter(q => q.category === "stock_analysis").length.toString(), icon: <BarChart3 className="h-4 w-4 text-blue-400" />, color: "text-blue-400" },
                      { label: "Pattern", value: queries.filter(q => q.category === "pattern").length.toString(), icon: <TrendingUp className="h-4 w-4 text-purple-400" />, color: "text-purple-400" },
                      { label: "Risk Mgmt", value: queries.filter(q => q.category === "risk_management").length.toString(), icon: <AlertCircle className="h-4 w-4 text-orange-400" />, color: "text-orange-400" },
                    ].map(s => (
                      <Card key={s.label} className="bg-white/2 border-white/10 p-5">
                        <div className="flex justify-between mb-2">{s.icon}<span className="text-xs text-white/40">{s.label}</span></div>
                        <p className={`text-3xl font-bold font-mono ${s.color}`}>{s.value}</p>
                      </Card>
                    ))}
                  </div>

                  {/* Query list */}
                  {queries.length === 0 ? (
                    <Card className="bg-white/2 border-white/10 p-10 text-center">
                      <p className="text-white/40">No queries yet — ask Sean AI something first.</p>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {queries.map(q => (
                        <Card key={q.id} className="bg-white/2 border-white/10 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <Badge className={`${getCategoryColor(q.category)} mb-2 text-[10px]`}>
                                {q.category.replace("_", " ")}
                              </Badge>
                              <p className="text-sm text-white/80 line-clamp-2">{q.query_text}</p>
                            </div>
                            <p className="text-xs text-white/40 whitespace-nowrap shrink-0">
                              {new Date(q.queried_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
