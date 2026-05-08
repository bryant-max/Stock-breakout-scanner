import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { PRICING_PLANS, TRIAL_DAYS, type PlanId } from "@/lib/pricing"
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"

export default function PricingSection() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null)

  const handleSubscribe = async (planId: PlanId) => {
    if (!user) {
      navigate(`/signup?plan=${planId}`)
      return
    }
    setLoadingPlan(planId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/subscription/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ plan: planId }),
      })
      if (!res.ok) throw new Error("Checkout failed")
      const { checkout_url } = await res.json()
      window.location.href = checkout_url
    } catch (err) {
      console.error("Stripe checkout error:", err)
    } finally {
      setLoadingPlan(null)
    }
  }

  return (
    <section id="pricing" className="relative bg-black py-20 sm:py-32">
      {/* Background grid */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(to right, #00ff88 1px, transparent 1px),
              linear-gradient(to bottom, #00ff88 1px, transparent 1px)
            `,
            backgroundSize: "120px 120px",
            maskImage: "radial-gradient(ellipse at center, black 20%, transparent 60%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        {/* Header */}
        <div className="mb-16 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="h-px w-8 bg-[#00ff88]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#00ff88]">Plans & Pricing</span>
            <div className="h-px w-8 bg-[#00ff88]" />
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight mb-6">
            Built for every trader.
          </h2>
          <p className="mx-auto max-w-xl font-mono text-sm text-white/60">
            Start free and scale when you&apos;re ready.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 border border-[#00ff88]/30 bg-[#00ff88]/10 px-4 py-2">
            <div className="h-2 w-2 bg-[#00ff88] animate-pulse" />
            <span className="font-mono text-xs text-[#00ff88]">
              {TRIAL_DAYS}-day free trial — no credit card required
            </span>
          </div>
        </div>

        {/* Cards */}
        <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative border ${
                plan.isPopular ? "border-[#00ff88] bg-[#00ff88]/5" : "border-[#222] bg-[#0a0a0a]"
              }`}
            >
              {plan.isPopular && <div className="absolute -top-px left-0 right-0 h-px bg-[#00ff88]" />}

              <div className="p-6 sm:p-8">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-mono text-lg font-bold text-white">{plan.name}</h3>
                    {plan.isPopular && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[#00ff88] border border-[#00ff88] px-2 py-1">
                        Popular
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-white/60">{plan.description}</p>
                </div>

                <div className="mb-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">${plan.price}</span>
                    <span className="font-mono text-sm text-white/40">/ {plan.period}</span>
                  </div>
                  <p className="font-mono text-xs text-[#00ff88] mt-1">{TRIAL_DAYS}-day free trial</p>
                </div>

                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loadingPlan === plan.id}
                  className={`mt-6 w-full py-4 font-mono text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    plan.isPopular
                      ? "border border-[#00ff88] bg-[#00ff88] text-black hover:bg-transparent hover:text-[#00ff88]"
                      : "border border-white/20 text-white hover:border-[#00ff88] hover:text-[#00ff88]"
                  }`}
                >
                  {loadingPlan === plan.id ? "Redirecting…" : plan.buttonText}
                </button>

                <div className="mt-8 space-y-3">
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-3">
                      {feature.included ? (
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center border border-[#00ff88] bg-[#00ff88]">
                          <svg className="h-2 w-2 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center border border-white/20">
                          <svg className="h-2 w-2 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                      <span className={`font-mono text-xs ${feature.included ? "text-white" : "text-white/40"}`}>
                        {feature.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <button
            onClick={() => navigate("/pricing")}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-[#00ff88] transition-colors underline underline-offset-4"
          >
            View full pricing details →
          </button>
        </div>

        {/* Brokerages */}
        <div className="mt-20">
          <div className="text-center mb-8">
            <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 mb-2">Brokerage Connection</h3>
            <p className="text-xl font-bold text-white">Trade with your preferred brokerage.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            {["Alpaca", "Coinbase", "Webull", "Public", "Tastytrade", "Tradier", "E*TRADE", "Charles Schwab"].map((broker) => (
              <div
                key={broker}
                className="border border-[#222] bg-[#0a0a0a] px-6 py-3 font-mono text-sm text-white/60 transition-all hover:border-[#00ff88]/30 hover:text-white"
              >
                {broker}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
