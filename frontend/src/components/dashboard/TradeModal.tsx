import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X, RefreshCw, TrendingUp, AlertTriangle, Link2, Wallet, ChevronDown, ExternalLink,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  snaptradeGetStatus,
  snaptradeRegister,
  snaptradeGetConnectUrl,
  snaptradePlaceOrder,
  snaptradePreviewOrder,
  snaptradeSearchSymbols,
  logTradeOutcome,
  type SnapTradeAccount,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type OrderType = "Market" | "Limit" | "StopLimit" | "StopLoss"
type OrderAction = "BUY" | "SELL"
type TradeStep = "form" | "preview" | "done"

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  Market: "Market",
  Limit: "Buy Stop",
  StopLimit: "Stop Limit",
  StopLoss: "Stop Loss",
}

export interface TradeModalProps {
  open: boolean
  onClose: () => void
  symbol?: string
  action?: OrderAction
  price?: number
}

export function TradeModal({ open, onClose, symbol = "", action = "BUY", price }: TradeModalProps) {
  const [connectionState, setConnectionState] = useState<"loading" | "unregistered" | "no_accounts" | "connected">("loading")
  const [accounts, setAccounts] = useState<SnapTradeAccount[]>([])
  const [step, setStep] = useState<TradeStep>("form")
  const [form, setForm] = useState({
    symbol,
    accountId: "",
    action: action,
    orderType: (price ? "Limit" : "Market") as OrderType,
    quantity: "",
    price: price ? price.toFixed(2) : "",
  })
  const [resolvedSymbolId, setResolvedSymbolId] = useState<string | null>(null)
  const [symbolSearching, setSymbolSearching] = useState(false)
  const [previewData, setPreviewData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectPending, setConnectPending] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Status check ──────────────────────────────────────────────────────
  const checkStatus = useCallback(async () => {
    try {
      const status = await snaptradeGetStatus()
      if (!status.registered) {
        setConnectionState("unregistered")
      } else if (status.accounts_linked === 0) {
        setConnectionState("no_accounts")
      } else {
        setConnectionState("connected")
        setAccounts(status.accounts)
      }
    } catch {
      setConnectionState("unregistered")
    }
  }, [])

  // ── Open / reset ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      checkStatus()
      setStep("form")
      setError(null)
      setPreviewData(null)
      setResolvedSymbolId(null)
      setConnectPending(false)
      setForm({
        symbol: symbol.toUpperCase(),
        accountId: "",
        action,
        orderType: price ? "Limit" : "Market",
        quantity: "",
        price: price ? price.toFixed(2) : "",
      })
    } else {
      // Clean up any polling when modal closes
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, symbol, action, price, checkStatus])

  useEffect(() => {
    if (accounts.length > 0 && !form.accountId) {
      setForm((f) => ({ ...f, accountId: accounts[0].id }))
    }
  }, [accounts, form.accountId])

  // ── Symbol resolution: ticker → SnapTrade universal_symbol_id ────────
  // Called before preview/place so the backend gets the correct ID.
  const resolveSymbol = useCallback(async (ticker: string): Promise<string | null> => {
    if (resolvedSymbolId) return resolvedSymbolId
    setSymbolSearching(true)
    try {
      const result = await snaptradeSearchSymbols(ticker.toUpperCase())
      const syms = (result.symbols as any[]) || []
      // Find exact match on ticker
      const match = syms.find((s: any) =>
        (s.symbol || s.ticker || "").toUpperCase() === ticker.toUpperCase()
      ) || syms[0]
      if (!match) {
        setError(`Symbol "${ticker}" not found in SnapTrade. Make sure it is listed on a supported exchange.`)
        return null
      }
      const id: string = match.id || match.universalSymbolId || match.symbol_id || ticker
      setResolvedSymbolId(id)
      return id
    } catch (e) {
      // If symbol search fails, fall back to raw ticker (some brokers accept it)
      console.warn("SnapTrade symbol search failed, using raw ticker:", e)
      return ticker.toUpperCase()
    } finally {
      setSymbolSearching(false)
    }
  }, [resolvedSymbolId])

  // ── Register ──────────────────────────────────────────────────────────
  const handleRegister = async () => {
    setLoading(true)
    setError(null)
    try {
      await snaptradeRegister()
      setConnectionState("no_accounts")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed")
    } finally {
      setLoading(false)
    }
  }

  // ── Connect brokerage (popup + postMessage listener) ──────────────────
  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    setConnectPending(false)
    try {
      // Use the current page as redirect so the popup can postMessage back
      const redirectUri = `${window.location.origin}/snaptrade-callback`
      const { redirect_url } = await snaptradeGetConnectUrl(redirectUri)

      const popup = window.open(redirect_url, "snaptrade_connect", "width=900,height=700,left=200,top=100")
      popupRef.current = popup

      // Listen for postMessage from the callback page
      const onMessage = (evt: MessageEvent) => {
        if (evt.origin !== window.location.origin) return
        if (evt.data?.type === "SNAPTRADE_CONNECTED" || evt.data?.snaptrade === "connected") {
          window.removeEventListener("message", onMessage)
          if (pollRef.current) clearInterval(pollRef.current)
          setConnectPending(false)
          checkStatus()
        }
      }
      window.addEventListener("message", onMessage)

      // Also poll every 3 s in case the user closed the popup manually
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        // Check if popup is closed
        if (popup?.closed) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          window.removeEventListener("message", onMessage)
          setConnectPending(false)
          // Re-check status in case they linked successfully
          await checkStatus()
          return
        }
      }, 2000)

      setConnectPending(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get connect URL")
    } finally {
      setLoading(false)
    }
  }

  // ── Preview ───────────────────────────────────────────────────────────
  const handlePreview = async () => {
    const sym = form.symbol.trim().toUpperCase()
    if (!sym || !form.accountId || !form.quantity) {
      setError("Symbol, account, and quantity are required")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const symbolId = await resolveSymbol(sym)
      if (!symbolId) { setLoading(false); return }

      const result = await snaptradePreviewOrder({
        account_id: form.accountId,
        symbol: symbolId,
        action: form.action,
        order_type: form.orderType,
        quantity: parseFloat(form.quantity),
        ...(form.orderType !== "Market" && form.price ? { price: parseFloat(form.price) } : {}),
      })
      setPreviewData(result.impact)
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed — check your symbol and account")
    } finally {
      setLoading(false)
    }
  }

  // ── Confirm & Place ───────────────────────────────────────────────────
  const handleConfirm = async () => {
    const sym = form.symbol.trim().toUpperCase()
    setLoading(true)
    setError(null)
    try {
      // Re-use cached symbol ID or resolve again
      const symbolId = resolvedSymbolId || await resolveSymbol(sym)
      if (!symbolId) { setLoading(false); return }

      await snaptradePlaceOrder({
        account_id: form.accountId,
        symbol: symbolId,
        action: form.action,
        order_type: form.orderType,
        quantity: parseFloat(form.quantity),
        ...(form.orderType !== "Market" && form.price ? { price: parseFloat(form.price) } : {}),
      })

      // Log to trade journal (non-blocking)
      logTradeOutcome({
        symbol: sym,
        entry_price: form.price ? parseFloat(form.price) : 0,
        outcome: "open",
        notes: `${form.action} ${form.quantity} shares via ${ORDER_TYPE_LABELS[form.orderType]} order`,
      }).catch(() => {})

      setStep("done")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed — please try again")
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  const selectCls = "w-full px-3 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm focus:outline-none focus:border-emerald-500/60 cursor-pointer"

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md bg-neutral-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">
              {connectionState !== "connected"
                ? "Connect Brokerage"
                : step === "form" ? "Place Order" : step === "preview" ? "Review Order" : "Order Submitted"}
            </h2>
            <button onClick={onClose} className="text-white/40 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {connectionState === "loading" && (
              <div className="flex flex-col items-center gap-4 py-8">
                <RefreshCw className="h-8 w-8 text-white/40 animate-spin" />
                <p className="text-white/60 text-sm">Checking brokerage connection...</p>
              </div>
            )}

            {connectionState === "unregistered" && (
              <div className="flex flex-col items-center gap-5 py-6 text-center">
                <div className="p-3 rounded-2xl bg-linear-to-br from-emerald-500/20 to-teal-500/20 ring-1 ring-white/10">
                  <Wallet className="h-8 w-8 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Connect Your Brokerage</h3>
                  <p className="text-white/50 text-sm">Link your broker to trade directly from scan results.</p>
                </div>
                <Button onClick={handleRegister} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8">
                  {loading ? <><RefreshCw className="h-4 w-4 animate-spin mr-2" />Setting up...</> : "Get Started"}
                </Button>
              </div>
            )}

            {connectionState === "no_accounts" && (
              <div className="flex flex-col items-center gap-5 py-6 text-center">
                <div className="p-3 rounded-2xl bg-linear-to-br from-blue-500/20 to-cyan-500/20 ring-1 ring-white/10">
                  <Link2 className="h-8 w-8 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-semibold mb-1">Link a Brokerage Account</h3>
                  <p className="text-white/50 text-sm">Connect Robinhood, TD Ameritrade, Interactive Brokers, and 15+ more.</p>
                </div>
                {connectPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-cyan-400 text-sm">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Waiting for brokerage connection...
                    </div>
                    <button onClick={checkStatus} className="text-xs text-white/40 hover:text-white underline">
                      I've connected — refresh status
                    </button>
                  </div>
                ) : (
                  <Button onClick={handleConnect} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-8 flex items-center gap-2">
                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                    {loading ? "Opening..." : "Connect Brokerage"}
                  </Button>
                )}
                <button
                  onClick={checkStatus}
                  className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh connection status
                </button>
              </div>
            )}

            {connectionState === "connected" && step === "done" && (
              <div className="text-center py-6 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                  <TrendingUp className="h-6 w-6 text-emerald-400" />
                </div>
                <p className="text-white font-semibold">Order Submitted!</p>
                <p className="text-white/50 text-sm">
                  Your {form.action} order for {form.symbol} has been sent to your broker.
                </p>
                <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700 text-white w-full mt-4">
                  Done
                </Button>
              </div>
            )}

            {connectionState === "connected" && step === "preview" && (
              <>
                <div className="rounded-xl bg-white/3 border border-white/10 p-4 space-y-3">
                  <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Order Summary</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Symbol</span>
                    <span className="text-white font-medium">{form.symbol.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Action</span>
                    <Badge className={form.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}>
                      {form.action}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Order Type</span>
                    <span className="text-white font-medium">{ORDER_TYPE_LABELS[form.orderType]}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/50">Quantity</span>
                    <span className="text-white">{form.quantity} shares</span>
                  </div>
                  {form.orderType !== "Market" && form.price && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Stop Price</span>
                      <span className="text-white">${form.price}</span>
                    </div>
                  )}
                  {previewData != null && (
                    <div className="pt-2 border-t border-white/10">
                      <p className="text-xs text-white/40 mb-2">Estimated Impact</p>
                      <pre className="text-xs text-white/60 whitespace-pre-wrap break-all">
                        {JSON.stringify(previewData as object, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep("form")} className="flex-1 border-white/10 text-white/70 hover:text-white">
                    Edit
                  </Button>
                  <Button onClick={handleConfirm} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                    {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Confirm & Place Order"}
                  </Button>
                </div>
              </>
            )}

            {connectionState === "connected" && step === "form" && (
              <>
                {/* Symbol */}
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Symbol</label>
                  <input
                    type="text"
                    value={form.symbol}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))
                      setResolvedSymbolId(null) // clear cached ID on symbol change
                    }}
                    placeholder="AAPL"
                    maxLength={10}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                {/* Account */}
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Account</label>
                  <div className="relative">
                    <select
                      value={form.accountId}
                      onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                      className={selectCls}
                    >
                      {accounts.length === 0 && (
                        <option value="" className="bg-neutral-900 text-white/40">No accounts linked</option>
                      )}
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id} className="bg-neutral-900 text-white">
                          {a.name || a.institution_name || a.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50 pointer-events-none" />
                  </div>
                </div>

                {/* Action + Order Type */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/50 mb-1.5 block">Action</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                      {(["BUY", "SELL"] as OrderAction[]).map((a) => (
                        <button
                          key={a}
                          onClick={() => setForm((f) => ({ ...f, action: a }))}
                          className={cn(
                            "flex-1 py-2 text-sm font-medium transition-colors",
                            form.action === a
                              ? a === "BUY" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                              : "bg-white/5 text-white/50 hover:text-white"
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1.5 block">Order Type</label>
                    <div className="relative">
                      <select
                        value={form.orderType}
                        onChange={(e) => setForm((f) => ({ ...f, orderType: e.target.value as OrderType }))}
                        className={cn(selectCls, "font-medium")}
                      >
                        {(["Market", "Limit", "StopLimit", "StopLoss"] as OrderType[]).map((t) => (
                          <option key={t} value={t} className="bg-neutral-900 text-white font-medium">
                            {ORDER_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Quantity + Price */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/50 mb-1.5 block">Quantity (shares)</label>
                    <input
                      type="number"
                      min="0"
                      value={form.quantity}
                      onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                      placeholder="10"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  {form.orderType !== "Market" && (
                    <div>
                      <label className="text-xs text-white/50 mb-1.5 block">
                        {form.orderType === "Limit" ? "Buy Stop Price ($)" : "Stop Price ($)"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.price}
                        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                        placeholder="150.00"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                  )}
                </div>

                <Button
                  onClick={handlePreview}
                  disabled={loading || symbolSearching || !form.symbol || !form.quantity || !form.accountId}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white mt-2 disabled:opacity-50"
                >
                  {loading || symbolSearching
                    ? <><RefreshCw className="h-4 w-4 animate-spin mr-2" />{symbolSearching ? "Resolving symbol..." : "Loading..."}</>
                    : "Preview Order"}
                </Button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
