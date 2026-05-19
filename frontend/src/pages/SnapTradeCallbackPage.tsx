/**
 * SnapTradeCallbackPage
 * Opened in a popup by TradeModal when the user clicks "Connect Brokerage".
 * SnapTrade redirects here after OAuth completes.
 * Sends postMessage to parent, then auto-closes.
 */
import { useEffect, useState } from "react"
import { CheckCircle, XCircle, RefreshCw } from "lucide-react"

export default function SnapTradeCallbackPage() {
  const [status, setStatus] = useState<"success" | "error" | "loading">("loading")
  const [message, setMessage] = useState("Processing brokerage connection...")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get("error") || params.get("errorMessage")

    if (errorParam) {
      setStatus("error")
      setMessage(`Connection failed: ${errorParam}`)
      if (window.opener) {
        try {
          window.opener.postMessage({ type: "SNAPTRADE_ERROR", error: errorParam }, window.location.origin)
        } catch {}
      }
      setTimeout(() => { try { window.close() } catch {} }, 3000)
      return
    }

    // Treat as success — SnapTrade redirects back here after OAuth
    setStatus("success")
    setMessage("Brokerage connected! This window will close automatically.")

    if (window.opener) {
      try {
        window.opener.postMessage({ type: "SNAPTRADE_CONNECTED" }, window.location.origin)
      } catch (e) {
        console.warn("postMessage failed:", e)
      }
    }

    setTimeout(() => { try { window.close() } catch {} }, 2000)
  }, [])

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-neutral-900 border border-white/10 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
        {status === "loading" && (
          <>
            <RefreshCw className="h-12 w-12 text-cyan-400 animate-spin mx-auto" />
            <p className="text-white font-semibold text-lg">Connecting...</p>
            <p className="text-white/50 text-sm">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto" />
            <p className="text-white font-semibold text-lg">Brokerage Connected!</p>
            <p className="text-white/50 text-sm">{message}</p>
            <p className="text-white/30 text-xs mt-1">This window will close automatically.</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 text-red-400 mx-auto" />
            <p className="text-white font-semibold text-lg">Connection Failed</p>
            <p className="text-red-400/80 text-sm">{message}</p>
            <button
              onClick={() => window.close()}
              className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm rounded-lg transition-colors"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  )
}
