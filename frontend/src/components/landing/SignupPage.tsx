import React, { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js"
import { CanvasRevealEffect } from "@/components/landing/canvas-reveal-effect"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { PRICING_PLANS, type PlanId } from "@/lib/pricing"

const API_URL = import.meta.env.VITE_API_URL ?? ""
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "")

type Step = "pick-plan" | "account" | "loading" | "checkout"

// ── Mini navbar ───────────────────────────────────────────────────────────────
function MiniNavbar() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-6 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-3 pl-4 pr-4 py-2 border border-[#00ff88]/30 bg-black/80 backdrop-blur-sm"
    >
      <div className="w-6 h-6 border border-[#00ff88] flex items-center justify-center">
        <span className="text-[#00ff88] font-mono text-xs font-bold">SB</span>
      </div>
      <span className="text-white font-mono text-sm tracking-wider">ORBIS</span>
    </motion.header>
  )
}

// ── Plan badge ────────────────────────────────────────────────────────────────
function PlanBadge({ planId }: { planId: PlanId }) {
  const plan = PRICING_PLANS.find((p) => p.id === planId)
  if (!plan) return null
  return (
    <div className="inline-flex items-center gap-2 border border-[#00ff88]/40 bg-[#00ff88]/10 px-3 py-1.5">
      <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse" />
      <span className="font-mono text-xs text-[#00ff88] uppercase tracking-wider">
        {plan.name} — ${plan.price}/mo · 7-day free trial
      </span>
    </div>
  )
}

// ── Eye icon ──────────────────────────────────────────────────────────────────
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

// ── Plan picker (Scenario C: /signup with no ?plan= param) ───────────────────
function PlanPicker({ onSelect }: { onSelect: (plan: PlanId) => void }) {
  return (
    <motion.div
      key="pick-plan"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-2xl"
    >
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-white font-mono mb-2">
          <span className="text-[#00ff88]">{">>"}</span> CHOOSE YOUR PLAN
        </h1>
        <p className="text-[#666] font-mono text-sm">7-day free trial on all plans. Card required.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {PRICING_PLANS.map((plan) => (
          <button
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            className={`relative text-left border p-6 transition-all group ${
              plan.isPopular
                ? "border-[#00ff88] bg-[#00ff88]/5 hover:bg-[#00ff88]/10"
                : "border-[#222] bg-[#0a0a0a] hover:border-[#00ff88]/50"
            }`}
          >
            {plan.isPopular && (
              <span className="absolute top-3 right-3 font-mono text-[10px] uppercase tracking-wider text-black bg-[#00ff88] px-2 py-0.5">
                Popular
              </span>
            )}
            <h2 className="font-mono text-lg font-bold text-white mb-1">{plan.name}</h2>
            <p className="font-mono text-xs text-white/50 mb-4">{plan.description}</p>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold text-white">${plan.price}</span>
              <span className="font-mono text-xs text-white/40">/ month</span>
            </div>
            <ul className="space-y-2">
              {plan.features.filter((f) => f.included).slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-center gap-2 font-mono text-xs text-white/60">
                  <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-[#00ff88]">
                    <svg className="h-2 w-2 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  {f.text}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center gap-2 font-mono text-xs text-[#00ff88] group-hover:gap-3 transition-all">
              <span>Select {plan.name}</span>
              <span>→</span>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

// ── Account form ──────────────────────────────────────────────────────────────
interface AccountFormProps {
  plan: PlanId
  canGoBack: boolean
  isSubmitting: boolean
  submitError: string | null
  onBack: () => void
  onSubmit: (email: string, password: string, fullName: string, phone: string) => Promise<void>
}

function AccountForm({ plan, canGoBack, isSubmitting, submitError, onBack, onSubmit }: AccountFormProps) {
  const [formData, setFormData] = useState({ fullName: "", email: "", phone: "", password: "", confirmPassword: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }))
  }

  // Read from the DOM directly so the form works with both React synthetic events
  // (normal typing) and native DOM value setters (password managers, test utils,
  // extensions like 1Password that bypass React's onChange).
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isSubmitting) return

    const els = e.currentTarget.elements
    const str = (name: string) => ((els.namedItem(name) as HTMLInputElement)?.value ?? "")

    const fullName = str("fullName").trim()
    const email    = str("email").trim()
    const phone    = str("phone").trim()
    const password = str("password")           // don't trim passwords
    const confirmPassword = str("confirmPassword")

    // Sync DOM values into React state so error messages display correctly
    setFormData({ fullName, email, phone, password, confirmPassword })

    const errs: Record<string, string> = {}
    if (!fullName) errs.fullName = "Name is required"
    if (!email) errs.email = "Email is required"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email format"
    if (phone && !/^\+?[\d\s\-().]{7,15}$/.test(phone)) errs.phone = "Invalid phone number"
    if (!password) errs.password = "Password is required"
    else if (password.length < 8) errs.password = "Password must be at least 8 characters"
    if (password !== confirmPassword) errs.confirmPassword = "Passwords do not match"

    if (Object.keys(errs).length) { setErrors(errs); return }

    await onSubmit(email, password, fullName, phone)
  }

  const inputClass = (field: string) =>
    `w-full bg-[#0a0a0a] text-white border ${
      errors[field] ? "border-[#ff4444]" : "border-[#222]"
    } py-3 px-4 focus:outline-none focus:border-[#00ff88] transition-colors font-mono text-sm placeholder:text-[#444]`

  return (
    <motion.div
      key="account"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-md"
    >
      <div className="relative">
        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#00ff88]" />
        <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#00ff88]" />
        <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#00ff88]" />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#00ff88]" />

        <div className="bg-black/90 backdrop-blur-sm border border-[#222] p-8">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-[#222]">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27ca40]" />
            </div>
            <span className="ml-auto font-mono text-xs text-[#666]">create_account.exe</span>
          </div>

          <div className="mb-6">
            {canGoBack && (
              <button onClick={onBack} className="mb-4 font-mono text-xs text-white/30 hover:text-[#00ff88] transition-colors flex items-center gap-1">
                ← Change plan
              </button>
            )}
            <h1 className="text-2xl font-bold text-white font-mono mb-2">
              <span className="text-[#00ff88]">{">>"}</span> ACCOUNT DETAILS
            </h1>
            <p className="text-[#666] font-mono text-sm mb-4">Step 1 of 2 — Your information</p>
            <PlanBadge planId={plan} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {submitError && (
              <p className="text-[#ff4444] text-xs font-mono border border-[#ff4444]/20 bg-[#ff4444]/5 px-3 py-2">{submitError}</p>
            )}

            <div>
              <label className="block text-xs text-[#00ff88] mb-2 font-mono uppercase tracking-wider">Full Name</label>
              <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} className={inputClass("fullName")} placeholder="Enter your name..." />
              {errors.fullName && <p className="text-[#ff4444] text-xs mt-1 font-mono">{errors.fullName}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#00ff88] mb-2 font-mono uppercase tracking-wider">Email</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} className={inputClass("email")} placeholder="your@email.com" />
              {errors.email && <p className="text-[#ff4444] text-xs mt-1 font-mono">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#00ff88] mb-2 font-mono uppercase tracking-wider">
                Phone <span className="text-white/20 normal-case tracking-normal">(optional)</span>
              </label>
              <input type="tel" name="phone" value={formData.phone} onChange={handleChange} className={inputClass("phone")} placeholder="+1 (555) 000-0000" />
              {errors.phone && <p className="text-[#ff4444] text-xs mt-1 font-mono">{errors.phone}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#00ff88] mb-2 font-mono uppercase tracking-wider">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange} className={`${inputClass("password")} pr-12`} placeholder="Min. 8 characters" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#00ff88] transition-colors">
                  <EyeIcon open={showPassword} />
                </button>
              </div>
              {errors.password && <p className="text-[#ff4444] text-xs mt-1 font-mono">{errors.password}</p>}
            </div>

            <div>
              <label className="block text-xs text-[#00ff88] mb-2 font-mono uppercase tracking-wider">Confirm Password</label>
              <div className="relative">
                <input type={showConfirm ? "text" : "password"} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className={`${inputClass("confirmPassword")} pr-12`} placeholder="Re-enter password" />
                <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#00ff88] transition-colors">
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
              {errors.confirmPassword && <p className="text-[#ff4444] text-xs mt-1 font-mono">{errors.confirmPassword}</p>}
            </div>

            <motion.button
              type="submit"
              disabled={isSubmitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full bg-[#00ff88] hover:bg-[#00cc6a] text-black font-bold py-3 px-4 transition-all font-mono text-sm uppercase tracking-wider mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  CREATING ACCOUNT…
                </>
              ) : (
                "CONTINUE TO PAYMENT →"
              )}
            </motion.button>
          </form>

          <p className="text-center mt-6 text-[#666] font-mono text-sm">
            Already have an account?{" "}
            <Link to="/login" className="text-[#00ff88] hover:underline">SIGN_IN</Link>
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ── Checkout loading ──────────────────────────────────────────────────────────
function CheckoutLoading({ plan, error, onRetry }: { plan: PlanId; error: string | null; onRetry?: () => void }) {
  const planInfo = PRICING_PLANS.find((p) => p.id === plan)
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-md text-center"
    >
      <div className="border border-[#222] bg-[#0a0a0a] p-10">
        {error ? (
          <>
            <div className="w-12 h-12 border border-[#ff4444]/40 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#ff4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="font-mono text-sm text-[#ff4444] mb-4">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="font-mono text-xs text-[#00ff88] border border-[#00ff88]/40 px-4 py-2 hover:bg-[#00ff88]/10 transition-all">
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <div className="w-12 h-12 border border-[#00ff88]/40 flex items-center justify-center mx-auto mb-4">
              <svg className="animate-spin w-6 h-6 text-[#00ff88]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <p className="font-mono text-sm text-white mb-1">Setting up payment…</p>
            <p className="font-mono text-xs text-white/40">
              {planInfo?.name} — ${planInfo?.price}/mo · 7-day trial
            </p>
          </>
        )}
      </div>
    </motion.div>
  )
}

// ── Embedded checkout step ────────────────────────────────────────────────────
function CheckoutStep({ plan, clientSecret }: { plan: PlanId; clientSecret: string }) {
  const planInfo = PRICING_PLANS.find((p) => p.id === plan)
  const fetchClientSecret = useCallback(() => Promise.resolve(clientSecret), [clientSecret])

  return (
    <motion.div
      key="checkout"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-xl"
    >
      <div className="border border-[#222] bg-[#0a0a0a] p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-white/40 uppercase tracking-wider">Step 2 of 2 — Payment</p>
          <p className="font-mono text-sm font-bold text-white mt-0.5">
            {planInfo?.name} — ${planInfo?.price}/mo
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <div className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse" />
            <span className="font-mono text-xs text-[#00ff88]">7-day free trial</span>
          </div>
          <p className="font-mono text-[10px] text-white/30 mt-0.5">Card required — charged on day 8</p>
        </div>
      </div>
      <div className="border border-[#222] bg-[#0a0a0a] overflow-hidden">
        <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SignUpPage() {
  const { user, loading: authLoading, signUp } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const urlPlan = searchParams.get("plan") as PlanId | null
  const validUrlPlan = (urlPlan === "core" || urlPlan === "premium") ? urlPlan : null

  const [step, setStep] = useState<Step>(validUrlPlan ? "account" : "pick-plan")
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(validUrlPlan)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [fromPicker, setFromPicker] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  // Blocks the redirect effect from firing during async signup + checkout fetch
  const suppressRedirect = useRef(false)

  // Persist plan from URL
  useEffect(() => {
    if (validUrlPlan) localStorage.setItem("pending_plan", validUrlPlan)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetches the embedded checkout client_secret and transitions to the checkout step.
  // Called both for already-logged-in users (from the effect) and new users (after signup).
  const doFetchCheckout = useCallback(async (planId: PlanId) => {
    console.log("[SignUp] doFetchCheckout →", planId)
    setStep("loading")
    setCheckoutError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      console.log("[SignUp] session token present:", !!token)
      if (!token) throw new Error("Session not ready — please try again.")

      const res = await fetch(`${API_URL}/api/subscription/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: planId }),
      })
      console.log("[SignUp] checkout-session response status:", res.status)
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.detail ?? "Failed to start checkout.")
      }
      const { client_secret } = await res.json()
      console.log("[SignUp] client_secret obtained → transitioning to checkout step")
      localStorage.removeItem("pending_plan")
      setClientSecret(client_secret)
      setStep("checkout")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong."
      console.log("[SignUp] doFetchCheckout error:", msg)
      setCheckoutError(msg)
      // Stay on "loading" step to show the error — do NOT navigate away
    } finally {
      suppressRedirect.current = false
      setIsSubmitting(false)
    }
  }, [])

  // Auth state effect: handles already-logged-in users.
  // Rule: if selectedPlan is set, NEVER navigate away — always load checkout.
  //       Only redirect to dashboard/verify-email when there is no plan.
  // suppressRedirect blocks the doFetchCheckout call (not the return) so a
  // form submission in progress doesn't trigger a second concurrent fetch.
  useEffect(() => {
    console.log("[SignUp] auth effect →", { user: !!user, authLoading, step, selectedPlan, suppress: suppressRedirect.current })
    if (authLoading || !user) return
    if (step === "checkout" || step === "loading") return

    if (selectedPlan) {
      // Has a plan: never navigate away. Only start a fetch if one isn't running.
      if (!suppressRedirect.current) {
        console.log("[SignUp] logged-in + plan → starting checkout fetch")
        suppressRedirect.current = true
        doFetchCheckout(selectedPlan)
      }
      return // ← always return; never fall through to navigate
    }

    // No plan selected: redirect away
    const dest = user.email_confirmed_at ? "/dashboard" : "/verify-email"
    console.log("[SignUp] no plan → redirecting to", dest)
    navigate(dest, { replace: true })
  }, [user, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Called by AccountForm on submit — creates Supabase account then loads checkout.
  // suppressRedirect must be set BEFORE signUp() so the auth state change
  // doesn't trigger the redirect effect before we transition to "checkout".
  const handleAccountSubmit = useCallback(async (email: string, password: string, fullName: string, phone: string) => {
    if (!selectedPlan) return
    console.log("[SignUp] handleAccountSubmit →", { email, plan: selectedPlan, hasPhone: !!phone })
    setIsSubmitting(true)
    setSubmitError(null)
    // Set BEFORE signUp() so the auth-state-change effect can't redirect while
    // we're in the middle of the async sequence.
    suppressRedirect.current = true

    const { error: signUpError } = await signUp(email, password, fullName, phone || undefined)
    if (signUpError) {
      console.log("[SignUp] signUp error:", signUpError.message)
      suppressRedirect.current = false
      setIsSubmitting(false)
      setSubmitError(signUpError.message)
      return
    }

    console.log("[SignUp] signUp success → fetching checkout")
    await doFetchCheckout(selectedPlan)
  }, [selectedPlan, signUp, doFetchCheckout])

  const handlePlanSelect = (plan: PlanId) => {
    setSelectedPlan(plan)
    localStorage.setItem("pending_plan", plan)
    setFromPicker(true)
    setStep("account")
  }

  const handleRetryCheckout = () => {
    if (!selectedPlan) return
    suppressRedirect.current = true
    doFetchCheckout(selectedPlan)
  }

  return (
    <div className="flex w-full flex-col min-h-screen bg-black relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <CanvasRevealEffect animationSpeed={2} containerClassName="bg-black" colors={[[0, 255, 136]]} dotSize={2} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_70%,rgba(0,0,0,1)_100%)]" />
      </div>
      <div
        className="absolute inset-0 z-1 opacity-20"
        style={{
          backgroundImage: "linear-gradient(to right, #00ff88 1px, transparent 1px), linear-gradient(to bottom, #00ff88 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 flex flex-col flex-1">
        <MiniNavbar />

        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
          <Link
            to="/"
            className="fixed top-6 left-6 z-30 group flex items-center gap-2 px-4 py-2 bg-black border border-[#222] hover:border-[#00ff88]/50 text-[#888] hover:text-[#00ff88] transition-all font-mono text-sm"
          >
            <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>HOME</span>
          </Link>
        </motion.div>

        <div className="flex flex-1 items-center justify-center px-6 py-24">
          <AnimatePresence mode="wait">
            {step === "pick-plan" && (
              <PlanPicker key="pick-plan" onSelect={handlePlanSelect} />
            )}
            {step === "account" && selectedPlan && (
              <AccountForm
                key="account"
                plan={selectedPlan}
                canGoBack={fromPicker}
                isSubmitting={isSubmitting}
                submitError={submitError}
                onBack={() => setStep("pick-plan")}
                onSubmit={handleAccountSubmit}
              />
            )}
            {step === "loading" && selectedPlan && (
              <CheckoutLoading
                key="loading"
                plan={selectedPlan}
                error={checkoutError}
                onRetry={checkoutError ? handleRetryCheckout : undefined}
              />
            )}
            {step === "checkout" && selectedPlan && clientSecret && (
              <CheckoutStep key="checkout" plan={selectedPlan} clientSecret={clientSecret} />
            )}
          </AnimatePresence>
        </div>

        <div className="relative z-10 py-6 text-center">
          <p className="text-[#444] font-mono text-xs">
            By creating an account, you agree to our{" "}
            <Link to="/terms" className="text-[#666] hover:text-[#00ff88] transition-colors">Terms</Link>
            {" "}and{" "}
            <Link to="/privacy" className="text-[#666] hover:text-[#00ff88] transition-colors">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
