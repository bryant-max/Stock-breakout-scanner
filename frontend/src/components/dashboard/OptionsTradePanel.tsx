import { useState, useEffect } from "react"
import { BarChart3, ShoppingCart, X, ArrowLeft, CheckCircle, AlertCircle, Loader2, ChevronDown } from "lucide-react"
import { OptionsChain, OptionsContract } from "./OptionsChain"
import { cn } from "@/lib/utils"

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "")

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import("@/lib/supabase")
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

interface SnapTradeAccount {
  id: string
  name: string
  institution_name?: string
}

export interface OptionsTradePanelProps {
  ticker: string
  isOpen: boolean
  onClose: () => void
  initialContract?: OptionsContract
}

type PanelTab = "chain" | "trade"
type Action = "BUY" | "SELL"
type OrderType = "Market" | "Limit"
type PlaceStatus = "idle" | "reviewing" | "loading" | "success" | "error"

// Display label for each order type (mirrors TradeModal)
const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  Market: "Market",
  Limit: "Buy Stop",
}

export function OptionsTradePanel({ ticker, isOpen, onClose, initialContract }: OptionsTradePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>(initialContract ? "trade" : "chain")
  const [selectedContract, setSelectedContract] = useState<OptionsContract | null>(initialContract ?? null)
  const [accounts, setAccounts] = useState<SnapTradeAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>("paper")
  const [action, setAction] = useState<Action>("BUY")
  const [orderType, setOrderType] = useState<OrderType>("Market")
  const [limitPrice, setLimitPrice] = useState<string>("")
  const [quantity, setQuantity] = useState<number>(1)
  const [placeStatus, setPlaceStatus] = useState<PlaceStatus>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fillPrice =
    selectedContract
      ? selectedContract.bid !== null && selectedContract.ask !== null
        ? parseFloat(((selectedContract.bid + selectedContract.ask) / 2).toFixed(2))
        : selectedContract.last ?? 0
      : 0

  const estimatedCost = parseFloat((fillPrice * quantity * 100).toFixed(2))

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
  const isRealAccount = selectedAccountId !== "paper"

  useEffect(() => {
    if (!isOpen) {
      setActiveTab("chain")
      setSelectedContract(null)
      setPlaceStatus("idle")
      setErrorMsg(null)
      setAction("BUY")
      setOrderType("Market")
      setLimitPrice("")
      setQuantity(1)
    }
  }, [isOpen])

  useEffect(() => {
    setActiveTab("chain")
    setSelectedContract(null)
    setPlaceStatus("idle")
    setErrorMsg(null)
  }, [ticker])

  useEffect(() => {
    if (initialContract) {
      setSelectedContract(initialContract)
      setActiveTab("trade")
    }
  }, [initialContract])

  useEffect(() => {
    if (!isOpen) return
    getAuthHeaders()
      .then((headers) =>
        fetch(`${API_URL}/api/snaptrade/accounts`, { headers }).then((r) => (r.ok ? r.json() : null))
      )
      .then((data) => {
        if (data?.accounts) setAccounts(data.accounts as SnapTradeAccount[])
      })
      .catch(() => {})
  }, [isOpen])

  const handleContractSelect = (contract: OptionsContract) => {
    setSelectedContract(contract)
    setPlaceStatus("idle")
    setErrorMsg(null)
    setActiveTab("trade")
  }

  const handleReview = () => {
    setPlaceStatus("reviewing")
    setErrorMsg(null)
  }

  const handleConfirm = async () => {
    if (!selectedContract) return
    setPlaceStatus("loading")
    setErrorMsg(null)
    try {
      const headers = await getAuthHeaders()
      if (!isRealAccount) {
        const res = await fetch(`${API_URL}/api/options/paper-trade`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            symbol: ticker,
            contract_ticker: selectedContract.ticker,
            contract_type: selectedContract.contract_type,
            strike_price: selectedContract.strike ?? 0,
            expiration_date: selectedContract.expiration,
            action: action.toLowerCase(),
            quantity,
            price_per_contract: fillPrice,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.detail ?? `HTTP ${res.status}`)
        }
      } else {
        const res = await fetch(`${API_URL}/api/options/order`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            account_id: selectedAccountId,
            symbol: ticker,
            option_symbol: selectedContract.ticker,
            action,
            order_type: orderType,
            quantity,
            limit_price: orderType === "Limit" ? parseFloat(limitPrice) || null : null,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.detail ?? `HTTP ${res.status}`)
        }
      }
      setPlaceStatus("success")
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to place order"
      setErrorMsg(msg)
      setPlaceStatus("error")
    }
  }

  const handlePlaceAnother = () => {
    setSelectedContract(null)
    setPlaceStatus("idle")
    setErrorMsg(null)
    setAction("BUY")
    setOrderType("Market")
    setLimitPrice("")
    setQuantity(1)
    setActiveTab("chain")
  }

  if (!isOpen) return null

  // Shared select class — solid dark bg so option text is always readable
  const selectCls = "w-full bg-neutral-900 border border-neutral-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 cursor-pointer"

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-700 sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white">Options Trading</h2>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">{ticker}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
          <button
            onClick={() => setActiveTab("chain")}
            className={cn(
              "flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium transition-colors",
              activeTab === "chain"
                ? "text-white border-b-2 border-cyan-400"
                : "text-zinc-500 hover:text-zinc-200"
            )}
          >
            <BarChart3 size={15} />
            Options Chain
          </button>
          <button
            onClick={() => setActiveTab("trade")}
            className={cn(
              "flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium transition-colors",
              activeTab === "trade"
                ? "text-white border-b-2 border-cyan-400"
                : "text-zinc-500 hover:text-zinc-200"
            )}
          >
            <ShoppingCart size={15} />
            Place Trade
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1">
          {activeTab === "chain" && (
            <div className="p-4">
              <OptionsChain symbol={ticker} onSelectContract={handleContractSelect} />
            </div>
          )}

          {activeTab === "trade" && (
            <div className="p-5">
              {placeStatus === "success" && selectedContract ? (
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <CheckCircle className="h-12 w-12 text-green-400" />
                  <p className="text-white font-semibold text-lg">Order Placed!</p>
                  <p className="text-zinc-400 text-sm max-w-sm">
                    {action} {quantity} × {selectedContract.contract_type.toUpperCase()} contract{quantity > 1 ? "s" : ""}{" "}
                    {selectedContract.strike ? `$${selectedContract.strike.toFixed(2)} strike` : ""} exp {selectedContract.expiration}
                    {!isRealAccount ? " (paper trade)" : ""}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={handlePlaceAnother}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg transition-colors"
                    >
                      Place Another
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : !selectedContract ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <ShoppingCart className="h-10 w-10 text-zinc-600" />
                  <p className="text-zinc-400 text-sm">No contract selected.</p>
                  <button
                    onClick={() => setActiveTab("chain")}
                    className="text-cyan-400 hover:text-cyan-300 text-sm underline transition-colors"
                  >
                    Pick one from the Options Chain
                  </button>
                </div>
              ) : (
                <div className="space-y-4 max-w-lg mx-auto">
                  {/* Contract info card */}
                  <div className="bg-zinc-800/60 rounded-lg p-4 text-xs font-mono space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Type</span>
                      <span className={cn("font-semibold", selectedContract.contract_type === "call" ? "text-green-400" : "text-red-400")}>
                        {selectedContract.contract_type.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Strike</span>
                      <span className="text-white">${selectedContract.strike?.toFixed(2) ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Expiry</span>
                      <span className="text-white">{selectedContract.expiration}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Bid / Ask</span>
                      <span className="text-white">
                        ${selectedContract.bid?.toFixed(2) ?? "—"} / ${selectedContract.ask?.toFixed(2) ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">IV</span>
                      <span className="text-blue-300">
                        {selectedContract.iv !== null ? `${(selectedContract.iv * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Delta</span>
                      <span className={cn(selectedContract.contract_type === "call" ? "text-green-300" : "text-red-300")}>
                        {selectedContract.delta?.toFixed(3) ?? "—"}
                      </span>
                    </div>
                    <div className="pt-1 flex justify-between border-t border-zinc-700">
                      <span className="text-zinc-400">Fill price (mid)</span>
                      <span className="text-cyan-400 font-bold">${fillPrice.toFixed(2)}</span>
                    </div>
                    <button
                      onClick={() => { setSelectedContract(null); setActiveTab("chain") }}
                      className="mt-1 flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px]"
                    >
                      <ArrowLeft size={11} />
                      Change contract
                    </button>
                  </div>

                  {/* Account selector */}
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">Account</label>
                    <div className="relative">
                      <select
                        value={selectedAccountId}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        className={selectCls}
                      >
                        <option value="paper" className="bg-neutral-900 text-white">Paper Trading (simulated)</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id} className="bg-neutral-900 text-white">
                            {acc.name}{acc.institution_name ? ` — ${acc.institution_name}` : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* BUY / SELL toggle */}
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">Action</label>
                    <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                      {(["BUY", "SELL"] as Action[]).map((a) => (
                        <button
                          key={a}
                          onClick={() => setAction(a)}
                          className={cn(
                            "flex-1 py-2 text-sm font-semibold transition-colors",
                            action === a
                              ? a === "BUY" ? "bg-green-600 text-white" : "bg-red-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:text-white"
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Order Type toggle — shows friendly labels */}
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">Order Type</label>
                    <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                      {(["Market", "Limit"] as OrderType[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => setOrderType(t)}
                          className={cn(
                            "flex-1 py-2 text-sm font-semibold transition-colors",
                            orderType === t
                              ? "bg-cyan-700 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:text-white"
                          )}
                        >
                          {ORDER_TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Buy Stop price input (shown when Buy Stop / Limit selected) */}
                  {orderType === "Limit" && (
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1.5">Buy Stop Price</label>
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        placeholder={fillPrice.toFixed(2)}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 placeholder-zinc-600"
                      />
                    </div>
                  )}

                  {/* Quantity */}
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1.5">
                      Contracts <span className="text-zinc-500">(1 contract = 100 shares)</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="w-full bg-zinc-800 border border-zinc-700 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* Estimated cost */}
                  <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg px-4 py-3 flex justify-between items-center">
                    <span className="text-sm text-zinc-400">Estimated cost</span>
                    <span className="text-lg font-bold text-white">${estimatedCost.toLocaleString()}</span>
                  </div>

                  {/* Error state */}
                  {placeStatus === "error" && errorMsg && (
                    <div className="flex items-start gap-2 text-red-400 text-sm border border-red-500/30 bg-red-500/10 rounded-lg px-3 py-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {/* Review section */}
                  {placeStatus === "reviewing" && (
                    <div className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-800/30">
                      <p className="text-xs font-semibold text-zinc-400 uppercase">Order Summary</p>
                      <div className="text-xs space-y-1.5 font-mono">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Action</span>
                          <span className={cn("font-semibold", action === "BUY" ? "text-green-400" : "text-red-400")}>{action}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Qty</span>
                          <span className="text-white">{quantity} contract{quantity > 1 ? "s" : ""}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Type</span>
                          <span className="text-white">{selectedContract.contract_type.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Strike</span>
                          <span className="text-white">${selectedContract.strike?.toFixed(2) ?? "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Expiry</span>
                          <span className="text-white">{selectedContract.expiration}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Order Type</span>
                          <span className="text-white font-semibold">{ORDER_TYPE_LABELS[orderType]}</span>
                        </div>
                        {orderType === "Limit" && limitPrice && (
                          <div className="flex justify-between">
                            <span className="text-zinc-400">Buy Stop Price</span>
                            <span className="text-white">${parseFloat(limitPrice).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Account</span>
                          <span className="text-white">{isRealAccount ? (selectedAccount?.name ?? selectedAccountId) : "Paper Trading"}</span>
                        </div>
                      </div>
                      {isRealAccount && (
                        <div className="flex items-center gap-2 text-amber-400 text-xs border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          This is a real money order.
                        </div>
                      )}
                      <div className="flex gap-3 pt-1">
                        <button
                          onClick={() => setPlaceStatus("idle")}
                          className="flex-1 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleConfirm}
                          className={cn(
                            "flex-1 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2",
                            action === "BUY"
                              ? "bg-green-600 hover:bg-green-500 text-white"
                              : "bg-red-600 hover:bg-red-500 text-white"
                          )}
                        >
                          Confirm & Place Order
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {placeStatus === "loading" && (
                    <div className="flex items-center justify-center gap-2 py-3 text-zinc-400 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Placing order…
                    </div>
                  )}

                  {/* Review Order button */}
                  {(placeStatus === "idle" || placeStatus === "error") && (
                    <button
                      onClick={handleReview}
                      disabled={fillPrice <= 0}
                      className={cn(
                        "w-full py-2.5 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2",
                        action === "BUY"
                          ? "bg-green-600 hover:bg-green-500 text-white disabled:opacity-50"
                          : "bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                      )}
                    >
                      Review Order
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
