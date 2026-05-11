import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"

export default function VerifyEmailPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [resendError, setResendError] = useState<string | null>(null)

  const plan = searchParams.get("plan") || localStorage.getItem("pending_plan") || null

  // Auto-redirect once email is confirmed
  useEffect(() => {
    if (user?.email_confirmed_at) {
      navigate("/dashboard", { replace: true })
    }
  }, [user, navigate])

  // Poll every 5s for confirmation
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data } = await supabase.auth.getUser()
      if (data?.user?.email_confirmed_at) {
        navigate("/dashboard", { replace: true })
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [navigate])

  const handleResend = async () => {
    if (!user?.email) return
    setResendStatus("sending")
    setResendError(null)
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: user.email })
      if (error) throw error
      setResendStatus("sent")
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Failed to resend.")
      setResendStatus("error")
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate("/signup", { replace: true })
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(to right, #00ff88 1px, transparent 1px), linear-gradient(to bottom, #00ff88 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Corner accents */}
        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#00ff88]" />
        <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#00ff88]" />
        <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#00ff88]" />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#00ff88]" />

        <div className="bg-black/90 border border-[#222] p-8">
          {/* Terminal header */}
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-[#222]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27ca40]" />
            </div>
            <span className="ml-auto font-mono text-xs text-[#666]">verify_email.exe</span>
          </div>

          {/* Icon */}
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 border border-[#00ff88]/40 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#00ff88]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          </div>

          <h1 className="font-mono text-xl font-bold text-white text-center mb-2">
            <span className="text-[#00ff88]">{">>"}</span> CHECK YOUR EMAIL
          </h1>

          <p className="font-mono text-sm text-white/60 text-center mb-2">
            We sent a verification link to
          </p>
          {user?.email && (
            <p className="font-mono text-sm text-[#00ff88] text-center mb-6 break-all">{user.email}</p>
          )}

          {plan && (
            <div className="mb-6 flex items-center justify-center gap-2 border border-[#00ff88]/30 bg-[#00ff88]/10 px-4 py-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse" />
              <span className="font-mono text-xs text-[#00ff88] uppercase tracking-wider">
                {plan === "premium" ? "Premium — $79/mo" : "Core — $39/mo"} · 7-day trial pending
              </span>
            </div>
          )}

          <p className="font-mono text-xs text-white/40 text-center mb-8">
            Click the link in the email to verify your account. This page will automatically redirect once confirmed.
          </p>

          {/* Resend */}
          <div className="space-y-3">
            {resendStatus === "sent" ? (
              <div className="border border-[#00ff88]/30 bg-[#00ff88]/10 px-4 py-3 font-mono text-xs text-[#00ff88] text-center">
                Email resent — check your inbox (and spam folder).
              </div>
            ) : (
              <button
                onClick={handleResend}
                disabled={resendStatus === "sending"}
                className="w-full border border-[#00ff88] text-[#00ff88] py-3 font-mono text-sm font-bold uppercase tracking-wider hover:bg-[#00ff88]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resendStatus === "sending" ? "Sending…" : "Resend Verification Email"}
              </button>
            )}

            {resendError && (
              <p className="font-mono text-xs text-red-400 text-center">{resendError}</p>
            )}

            <button
              onClick={handleSignOut}
              className="w-full border border-white/10 text-white/40 py-3 font-mono text-xs uppercase tracking-wider hover:border-white/20 hover:text-white/60 transition-all"
            >
              Wrong email? Sign out
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-[#111] flex items-center justify-center gap-2">
            <div className="h-1.5 w-1.5 bg-[#00ff88] animate-pulse" />
            <span className="font-mono text-[10px] text-white/20 uppercase tracking-wider">Checking automatically every 5 seconds</span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
