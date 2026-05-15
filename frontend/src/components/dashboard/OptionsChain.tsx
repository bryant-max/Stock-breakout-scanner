import { useState, useEffect, useCallback } from "react"
import { RefreshCw, TrendingUp, TrendingDown, ShoppingCart } from "lucide-react"
import { cn } from "@/lib/utils"

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OptionsContract {
  ticker: string
  contract_type: "call" | "put"
  strike: number
  expiration: string
  bid: number | null
  ask: number | null
  last: number | null
  volume: number
  open_interest: number
  iv: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
}

interface OptionsChainData {
  symbol: string
  calls: OptionsContract[]
  puts: OptionsContract[]
  expirations: string[]
  total: number
}

interface OptionsChainProps {
  symbol: string
  onSelectContract?: (contract: OptionsContract) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return "—"
  return n.toFixed(decimals)
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—"
  return `${(n * 100).toFixed(1)}%`
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import("@/lib/supabase")
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ContractRow({
  contract,
  isCall,
  onSelect,
}: {
  contract: OptionsContract
  isCall: boolean
  onSelect?: (c: OptionsContract) => void
}) {
  const midpoint =
    contract.bid !== null && contract.ask !== null
      ? ((contract.bid + contract.ask) / 2).toFixed(2)
      : fmt(contract.last)

  return (
    <tr
      className={cn(
        "border-b border-white/5 text-xs transition-colors",
        onSelect && "cursor-pointer hover:bg-white/5",
        isCall ? "hover:bg-green-500/5" : "hover:bg-red-500/5"
      )}
      onClick={() => onSelect?.(contract)}
    >
      <td className="px-3 py-2 font-semibold text-white">{fmt(contract.strike)}</td>
      <td className="px-3 py-2 text-white/70">{fmt(contract.bid)}</td>
      <td className="px-3 py-2 text-white/70">{fmt(contract.ask)}</td>
      <td className={cn(
        "px-3 py-2 font-mono font-semibold",
        isCall ? "text-green-400" : "text-red-400"
      )}>
        ${midpoint}
      </td>
      <td className="px-3 py-2 text-white/60">{(contract.volume || 0).toLocaleString()}</td>
      <td className="px-3 py-2 text-white/60">{(contract.open_interest || 0).toLocaleString()}</td>
      <td className="px-3 py-2 text-blue-300">{fmtPct(contract.iv)}</td>
      <td className={cn(
        "px-3 py-2",
        isCall ? "text-green-300" : "text-red-300"
      )}>
        {fmt(contract.delta, 3)}
      </td>
      {onSelect && (
        <td className="px-3 py-2">
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(contract) }}
            className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
            title="Select contract"
          >
            <ShoppingCart className="h-3 w-3" />
          </button>
        </td>
      )}
    </tr>
  )
}

function ContractTable({
  contracts,
  isCall,
  onSelect,
}: {
  contracts: OptionsContract[]
  isCall: boolean
  onSelect?: (c: OptionsContract) => void
}) {
  const cols = ["Strike", "Bid", "Ask", "Mid/Last", "Volume", "OI", "IV", "Delta"]
  if (onSelect) cols.push("Trade")

  if (contracts.length === 0) {
    return (
      <div className="py-10 text-center text-white/30 text-sm">
        No {isCall ? "calls" : "puts"} available for this expiration.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            {cols.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-[10px] font-mono uppercase text-white/40">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <ContractRow key={c.ticker} contract={c} isCall={isCall} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OptionsChain({ symbol, onSelectContract }: OptionsChainProps) {
  const [data, setData] = useState<OptionsChainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedExpiry, setSelectedExpiry] = useState<string>("")
  const [tab, setTab] = useState<"calls" | "puts">("calls")

  const fetchChain = useCallback(async (expiry?: string) => {
    setLoading(true)
    setError(null)
    const url = `${API_URL}/api/options/chain/${symbol}?${new URLSearchParams({ limit: "100", ...(expiry ? { expiration_date: expiry } : {}) })}`
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = body?.detail ?? `HTTP ${res.status}`
        throw new Error(`${detail} (${res.status}) — ${url}`)
      }
      const json: OptionsChainData = await res.json()
      setData(json)
      if (!expiry && json.expirations.length > 0) {
        setSelectedExpiry(json.expirations[0])
      }
    } catch (e: any) {
      const msg = e.message ?? "Failed to load options chain"
      console.error("[OptionsChain] fetch failed:", msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    fetchChain()
  }, [fetchChain])

  const handleExpiryChange = (expiry: string) => {
    setSelectedExpiry(expiry)
    fetchChain(expiry)
  }

  const activeContracts = data
    ? (tab === "calls" ? data.calls : data.puts).filter(
        (c) => !selectedExpiry || c.expiration === selectedExpiry
      )
    : []

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Options Chain</h3>
          <span className="text-xs text-white/40 font-mono">{symbol}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Expiry picker */}
          {data && data.expirations.length > 0 && (
            <select
              value={selectedExpiry}
              onChange={(e) => handleExpiryChange(e.target.value)}
              className="bg-white/5 border border-white/10 text-white text-xs font-mono px-2 py-1.5 rounded focus:outline-none focus:border-[#00ff88]/50"
            >
              <option value="">All expirations</option>
              {data.expirations.map((exp) => (
                <option key={exp} value={exp} className="bg-zinc-900">
                  {exp}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => fetchChain(selectedExpiry)}
            disabled={loading}
            className="p-1.5 text-white/40 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab("calls")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors",
            tab === "calls"
              ? "text-green-400 border-b-2 border-green-400 bg-green-400/5"
              : "text-white/40 hover:text-white"
          )}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          Calls {data && `(${data.calls.length})`}
        </button>
        <button
          onClick={() => setTab("puts")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors",
            tab === "puts"
              ? "text-red-400 border-b-2 border-red-400 bg-red-400/5"
              : "text-white/40 hover:text-white"
          )}
        >
          <TrendingDown className="h-3.5 w-3.5" />
          Puts {data && `(${data.puts.length})`}
        </button>
      </div>

      {/* Body */}
      {loading && (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-5 w-5 text-white/30 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="px-4 py-6 flex flex-col items-center gap-3">
          <p className="text-red-400 text-sm text-center max-w-sm break-all">{error}</p>
          <p className="text-xs text-white/30 text-center max-w-xs">
            {error.includes("localhost") || error.includes("Failed to fetch")
              ? "Cannot reach backend. Set VITE_API_URL in your Vercel env vars to your Railway backend URL."
              : error.includes("401") || error.includes("Authentication")
              ? "Not authenticated. Please log in and try again."
              : error.includes("unavailable from all sources") || error.includes("502")
              ? "Both Polygon and Yahoo Finance failed. Check Railway logs."
              : null}
          </p>
          <button
            onClick={() => fetchChain(selectedExpiry)}
            className="text-xs text-white/50 hover:text-white underline"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <ContractTable
          contracts={activeContracts}
          isCall={tab === "calls"}
          onSelect={onSelectContract}
        />
      )}
    </div>
  )
}
