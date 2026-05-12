import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { RefreshCw, TrendingUp, TrendingDown, Zap, ChevronDown, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const API_URL = import.meta.env.VITE_API_URL ?? ""

// ── Types ──────────────────────────────────────────────────────────────
interface Greeks { delta?: number; gamma?: number; theta?: number; vega?: number; implied_volatility?: number }
interface OptionContract {
  details: { contract_type: string; strike_price: number; expiration_date: string; ticker: string }
  day: { open?: number; high?: number; low?: number; close?: number; volume?: number }
  greeks?: Greeks
  implied_volatility?: number
  last_quote?: { ask?: number; bid?: number; midpoint?: number }
  open_interest?: number
  break_even_price?: number
}

interface OptionsChainProps {
  symbol: string
  spotPrice?: number
  accountId?: string
  isPaper?: boolean
  onOrderPlaced?: (msg: string) => void
}

// ── API helpers ─────────────────────────────────────────────────────────
async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

async function fetchChain(symbol: string, expiry: string) {
  const headers = await authHeaders()
  const res = await fetch(`${API_URL}/api/options/chain/${symbol}?expiration_date=${expiry}`, { headers })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchExpiries(symbol: string): Promise<string[]> {
  const headers = await authHeaders()
  const res = await fetch(`${API_URL}/api/options/expiries/${symbol}`, { headers })
  if (!res.ok) return []
  const data = await res.json()
  return data.expiration_dates ?? []
}

async function placeOrder(endpoint: string, payload: object) {
  const headers = await authHeaders()
  const res = await fetch(`${API_URL}/api/${endpoint}`, { method: "POST", headers, body: JSON.stringify(payload) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Formatters ───────────────────────────────────────────────────────────
const fmt = (v?: number, d = 2) => v == null ? "—" : v.toFixed(d)
const fmtPct = (v?: number) => v == null ? "—" : (v * 100).toFixed(1) + "%"
const fmtK = (v?: number) => v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(1) + "K" : v.toString()

// ── Order ticket ─────────────────────────────────────────────────────────
function OrderTicket({ contract, spotPrice, accountId, isPaper, onClose, onFilled }:
  { contract: OptionContract; spotPrice?: number; accountId?: string; isPaper?: boolean; onClose: () => void; onFilled: (msg: string) => void }) {

  const [action, setAction] = useState<"BUY" | "SELL">("BUY")
  const [qty, setQty] = useState(1)
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market")
  const [limitPrice, setLimitPrice] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mid = contract.last_quote?.midpoint ?? contract.last_quote?.ask
  const optionTicker = contract.details.ticker
  const baseSymbol = contract.details.ticker.split(/[0-9]/)[0]
  const contractValue = (mid ?? 0) * qty * 100

  const submit = async () => {
    setSubmitting(true); setError(null)
    try {
      if (isPaper) {
        await placeOrder("paper/order", {
          symbol: baseSymbol,
          asset_type: "option",
          option_symbol: optionTicker,
          action, order_type: orderType, quantity: qty,
          limit_price: orderType === "Limit" ? parseFloat(limitPrice) : undefined,
        })
        onFilled(`Paper ${action}: ${qty}x ${optionTicker} filled at ${fmt(orderType === "Limit" ? parseFloat(limitPrice) : mid)}`)
      } else {
        if (!accountId) throw new Error("No brokerage account selected")
        await placeOrder("options/order", {
          account_id: accountId,
          symbol: baseSymbol,
          option_symbol: optionTicker,
          action, order_type: orderType, quantity: qty,
          limit_price: orderType === "Limit" ? parseFloat(limitPrice) : undefined,
        })
        onFilled(`Live ${action}: ${qty}x ${optionTicker} submitted to broker`)
      }
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : "Order failed") }
    finally { setSubmitting(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white font-mono">{contract.details.contract_type.toUpperCase()} {contract.details.strike_price} — {contract.details.expiration_date}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="bg-zinc-800 p-2 rounded"><span className="text-zinc-400">Mid</span><br/><span className="text-white font-bold">${fmt(mid)}</span></div>
          <div className="bg-zinc-800 p-2 rounded"><span className="text-zinc-400">IV</span><br/><span className="text-white font-bold">{fmtPct(contract.greeks?.implied_volatility ?? contract.implied_volatility)}</span></div>
          <div className="bg-zinc-800 p-2 rounded"><span className="text-zinc-400">Delta</span><br/><span className="text-white font-bold">{fmt(contract.greeks?.delta)}</span></div>
          <div className="bg-zinc-800 p-2 rounded"><span className="text-zinc-400">OI</span><br/><span className="text-white font-bold">{fmtK(contract.open_interest)}</span></div>
        </div>
        <div className="flex gap-2">
          {(["BUY","SELL"] as const).map(a => (
            <button key={a} onClick={() => setAction(a)} className={cn("flex-1 py-2 text-sm font-bold rounded transition-colors", action===a ? a==="BUY" ? "bg-emerald-600 text-white" : "bg-red-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white")}>{a}</button>
          ))}
        </div>
        <div className="flex gap-2">
          {(["Market","Limit"] as const).map(t => (
            <button key={t} onClick={() => setOrderType(t)} className={cn("flex-1 py-1.5 text-xs font-mono rounded transition-colors border", orderType===t ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-zinc-700 text-zinc-400 hover:border-zinc-500")}>{t}</button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex-1"><label className="text-xs text-zinc-400 font-mono block mb-1">Contracts</label>
            <input type="number" min={1} value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))} className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm font-mono rounded px-3 py-2 focus:border-emerald-500 focus:outline-none"/></div>
          {orderType==="Limit" && <div className="flex-1"><label className="text-xs text-zinc-400 font-mono block mb-1">Limit $</label>
            <input type="number" step="0.01" value={limitPrice} onChange={e=>setLimitPrice(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm font-mono rounded px-3 py-2 focus:border-emerald-500 focus:outline-none" placeholder="0.00"/></div>}
        </div>
        <div className="bg-zinc-800 rounded p-3 font-mono text-xs flex justify-between">
          <span className="text-zinc-400">Est. Total</span>
          <span className="text-white font-bold">${contractValue.toFixed(2)} <span className="text-zinc-500">({qty} × 100)</span></span>
        </div>
        {isPaper && <div className="text-center text-xs text-amber-400 font-mono">📄 PAPER TRADE — virtual money only</div>}
        {error && <div className="text-red-400 text-xs font-mono">{error}</div>}
        <button onClick={submit} disabled={submitting} className={cn("w-full py-3 font-bold text-sm font-mono rounded transition-all", action==="BUY" ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-red-600 hover:bg-red-500 text-white", submitting && "opacity-50 cursor-not-allowed")}>
          {submitting ? "Submitting…" : `${action} ${qty} Contract${qty>1?"s":""}`}
        </button>
      </div>
    </motion.div>
  )
}

// ── Main OptionsChain component ───────────────────────────────────────────
export function OptionsChain({ symbol, spotPrice, accountId, isPaper = false, onOrderPlaced }: OptionsChainProps) {
  const [expiries, setExpiries] = useState<string[]>([])
  const [selectedExpiry, setSelectedExpiry] = useState<string>("")
  const [calls, setCalls] = useState<OptionContract[]>([])
  const [puts, setPuts] = useState<OptionContract[]>([])
  const [spot, setSpot] = useState<number | undefined>(spotPrice)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTicket, setActiveTicket] = useState<OptionContract | null>(null)
  const [view, setView] = useState<"calls" | "puts" | "both">("both")
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  useEffect(() => {
    fetchExpiries(symbol).then(dates => {
      setExpiries(dates)
      if (dates.length) setSelectedExpiry(dates[0])
    })
  }, [symbol])

  const loadChain = useCallback(async () => {
    if (!selectedExpiry) return
    setLoading(true); setError(null)
    try {
      const data = await fetchChain(symbol, selectedExpiry)
      setCalls(data.calls ?? [])
      setPuts(data.puts ?? [])
      if (data.spot_price) setSpot(data.spot_price)
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load options") }
    finally { setLoading(false) }
  }, [symbol, selectedExpiry])

  useEffect(() => { loadChain() }, [loadChain])

  const renderRow = (contract: OptionContract, type: "call" | "put") => {
    const { strike_price } = contract.details
    const isITM = type === "call" ? (spot ?? 0) > strike_price : (spot ?? 0) < strike_price
    const mid = contract.last_quote?.midpoint ?? contract.last_quote?.ask
    return (
      <tr key={contract.details.ticker} onClick={() => setActiveTicket(contract)}
        className={cn("cursor-pointer hover:bg-zinc-700/50 transition-colors border-b border-zinc-800/50", isITM && "bg-emerald-500/5")}>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(contract.last_quote?.bid)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-300">{fmt(mid)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(contract.last_quote?.ask)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmtPct(contract.greeks?.implied_volatility ?? contract.implied_volatility)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-300">{fmt(contract.greeks?.delta)}</td>
        <td className={cn("py-1.5 px-3 text-xs font-mono font-bold text-center", isITM ? "text-emerald-400" : "text-white")}>
          {strike_price.toFixed(0)}
        </td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-300">{fmt(contract.greeks?.delta)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmtPct(contract.greeks?.implied_volatility ?? contract.implied_volatility)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(contract.last_quote?.bid)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-300">{fmt(mid)}</td>
        <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(contract.last_quote?.ask)}</td>
      </tr>
    )
  }

  const renderSingleSide = (contracts: OptionContract[], type: "call" | "put") => (
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-zinc-700">
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Bid</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Mid</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Ask</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">IV</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Delta</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Strike</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">OI</th>
          <th className="py-2 px-3 text-xs font-mono text-zinc-500 font-normal">Vol</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map(c => {
          const { strike_price } = c.details
          const isITM = type === "call" ? (spot ?? 0) > strike_price : (spot ?? 0) < strike_price
          const mid = c.last_quote?.midpoint ?? c.last_quote?.ask
          return (
            <tr key={c.details.ticker} onClick={() => setActiveTicket(c)}
              className={cn("cursor-pointer hover:bg-zinc-700/50 transition-colors border-b border-zinc-800/50", isITM && "bg-emerald-500/5")}>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(c.last_quote?.bid)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-white">{fmt(mid)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmt(c.last_quote?.ask)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmtPct(c.greeks?.implied_volatility ?? c.implied_volatility)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-300">{fmt(c.greeks?.delta)}</td>
              <td className={cn("py-1.5 px-3 text-xs font-mono font-bold", isITM ? "text-emerald-400" : "text-white")}>{strike_price.toFixed(0)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmtK(c.open_interest)}</td>
              <td className="py-1.5 px-3 text-xs font-mono text-zinc-400">{fmtK(c.day?.volume)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-wrap gap-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-400" />
          <span className="font-mono text-sm font-bold text-white">OPTIONS CHAIN</span>
          <span className="font-mono text-xs text-zinc-500">{symbol}</span>
          {spot && <span className="font-mono text-xs text-emerald-400">@ ${spot.toFixed(2)}</span>}
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {isPaper && <span className="text-xs font-mono text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded">PAPER</span>}
          {/* Expiry selector */}
          <div className="relative">
            <select value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-white text-xs font-mono rounded px-3 py-1.5 pr-7 focus:border-emerald-500 focus:outline-none appearance-none cursor-pointer">
              {expiries.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500 pointer-events-none" />
          </div>
          {/* View toggle */}
          <div className="flex border border-zinc-700 rounded overflow-hidden">
            {(["calls","puts","both"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={cn("px-2 py-1 text-xs font-mono transition-colors", view===v ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800")}>{v}</button>
            ))}
          </div>
          <button onClick={loadChain} disabled={loading} className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-4 mt-3 px-4 py-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-xs font-mono rounded">{toast}</motion.div>}
      </AnimatePresence>

      {/* Error */}
      {error && <div className="mx-4 mt-3 px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono rounded">{error}</div>}

      {/* Chain table */}
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500 font-mono text-sm gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading chain…</div>
        ) : view === "both" ? (
          <div className="grid grid-cols-2 divide-x divide-zinc-800">
            <div>
              <div className="px-3 py-1.5 bg-emerald-500/10 border-b border-zinc-800 font-mono text-xs text-emerald-400 font-bold flex items-center gap-1"><TrendingUp className="h-3 w-3" /> CALLS</div>
              {renderSingleSide(calls, "call")}
            </div>
            <div>
              <div className="px-3 py-1.5 bg-red-500/10 border-b border-zinc-800 font-mono text-xs text-red-400 font-bold flex items-center gap-1"><TrendingDown className="h-3 w-3" /> PUTS</div>
              {renderSingleSide(puts, "put")}
            </div>
          </div>
        ) : view === "calls" ? renderSingleSide(calls, "call") : renderSingleSide(puts, "put")}
      </div>

      <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-emerald-500/40" />
        <span className="text-xs font-mono text-zinc-600">ITM highlighted · Click any row to trade</span>
        <span className="ml-auto text-xs font-mono text-zinc-600">{calls.length}C / {puts.length}P contracts</span>
      </div>

      {/* Order ticket modal */}
      <AnimatePresence>
        {activeTicket && (
          <OrderTicket
            contract={activeTicket}
            spotPrice={spot}
            accountId={accountId}
            isPaper={isPaper}
            onClose={() => setActiveTicket(null)}
            onFilled={(msg) => { setActiveTicket(null); showToast(msg); onOrderPlaced?.(msg) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
            }
