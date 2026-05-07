import { useNavigate } from "react-router-dom"
import { PRICING_PLANS, TRIAL_DAYS } from "@/lib/pricing"

const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel any time from your account settings — no questions asked.",
  },
  {
    q: "What happens after the free trial?",
    a: `After your ${TRIAL_DAYS}-day free trial, you'll be charged the monthly rate for your chosen plan. We'll remind you before billing starts.`,
  },
  {
    q: "Do I need a credit card to start?",
    a: "No credit card is required to start your free trial.",
  },
  {
    q: "Can I switch plans?",
    a: "You can upgrade or downgrade at any time. Changes take effect at the start of your next billing cycle.",
  },
]

export default function PricingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background grid */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `
              linear-gradient(to right, #00ff88 1px, transparent 1px),
              linear-gradient(to bottom, #00ff88 1px, transparent 1px)
            `,
            backgroundSize: "80px 80px",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-24">
        {/* Back link */}
        <button
          onClick={() => navigate("/")}
          className="mb-12 font-mono text-xs uppercase tracking-wider text-white/40 hover:text-[#00ff88] transition-colors"
        >
          ← Back to Home
        </button>

        {/* Header */}
        <div className="text-center mb-20">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="h-px w-8 bg-[#00ff88]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#00ff88]">Pricing</span>
            <div className="h-px w-8 bg-[#00ff88]" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold mb-6 leading-tight">
            Simple, transparent pricing.
          </h1>
          <p className="mx-auto max-w-xl font-mono text-sm text-white/60">
            Two plans. No hidden fees. Both include a {TRIAL_DAYS}-day free trial.
          </p>

          <div className="mt-8 inline-flex items-center gap-2 border border-[#00ff88]/30 bg-[#00ff88]/10 px-5 py-2.5">
            <div className="h-2 w-2 bg-[#00ff88] animate-pulse" />
            <span className="font-mono text-xs text-[#00ff88]">
              {TRIAL_DAYS}-day free trial on all plans — no credit card required
            </span>
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid gap-8 md:grid-cols-2 max-w-5xl mx-auto mb-24">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative border ${
                plan.isPopular
                  ? "border-[#00ff88] bg-[#00ff88]/5"
                  : "border-[#222] bg-[#0a0a0a]"
              }`}
            >
              {plan.isPopular && (
                <>
                  <div className="absolute -top-px left-0 right-0 h-px bg-[#00ff88]" />
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-black bg-[#00ff88] px-3 py-1">
                      Most Popular
                    </span>
                  </div>
                </>
              )}

              <div className="p-8 sm:p-10">
                {/* Plan name & desc */}
                <div className="mb-8">
                  <h2 className="font-mono text-2xl font-bold text-white mb-2">{plan.name}</h2>
                  <p className="font-mono text-sm text-white/60">{plan.description}</p>
                </div>

                {/* Price */}
                <div className="mb-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold text-white">${plan.price}</span>
                    <span className="font-mono text-sm text-white/40">/ {plan.period}</span>
                  </div>
                  <p className="font-mono text-xs text-[#00ff88] mt-2">
                    First {TRIAL_DAYS} days free
                  </p>
                </div>

                {/* Stripe price ID placeholder — used when wiring up Stripe */}
                {/* stripePriceId: {plan.stripePriceId} */}

                <button
                  onClick={() => navigate("/signup")}
                  className={`mt-8 w-full py-4 font-mono text-sm font-bold uppercase tracking-wider transition-all ${
                    plan.isPopular
                      ? "border border-[#00ff88] bg-[#00ff88] text-black hover:bg-transparent hover:text-[#00ff88]"
                      : "border border-white/20 text-white hover:border-[#00ff88] hover:text-[#00ff88]"
                  }`}
                >
                  {plan.buttonText}
                </button>

                <p className="font-mono text-[10px] text-white/30 text-center mt-3">
                  No credit card required
                </p>

                {/* Divider */}
                <div className="my-8 border-t border-white/10" />

                {/* Features */}
                <ul className="space-y-4">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3">
                      {feature.included ? (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center border border-[#00ff88] bg-[#00ff88]">
                          <svg className="h-2.5 w-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center border border-white/20">
                          <svg className="h-2.5 w-2.5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                      <span className={`font-mono text-sm ${feature.included ? "text-white" : "text-white/30 line-through"}`}>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="max-w-5xl mx-auto mb-24">
          <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 text-center mb-8">
            Full Comparison
          </h2>
          <div className="border border-[#222] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-3 bg-[#0a0a0a] border-b border-[#222]">
              <div className="p-4 font-mono text-xs uppercase tracking-wider text-white/40">Feature</div>
              {PRICING_PLANS.map((plan) => (
                <div key={plan.id} className="p-4 text-center">
                  <span className={`font-mono text-sm font-bold ${plan.isPopular ? "text-[#00ff88]" : "text-white"}`}>
                    {plan.name}
                  </span>
                  <div className="font-mono text-xs text-white/40">${plan.price}/mo</div>
                </div>
              ))}
            </div>
            {/* Rows */}
            {PRICING_PLANS[0].features.map((feature, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 border-b border-[#111] ${i % 2 === 0 ? "bg-black" : "bg-[#050505]"}`}
              >
                <div className="p-4 font-mono text-sm text-white/70">{feature.text}</div>
                {PRICING_PLANS.map((plan) => {
                  const f = plan.features[i]
                  return (
                    <div key={plan.id} className="p-4 flex items-center justify-center">
                      {f.included ? (
                        <div className="flex h-5 w-5 items-center justify-center border border-[#00ff88] bg-[#00ff88]">
                          <svg className="h-2.5 w-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="h-px w-4 bg-white/20" />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto mb-24">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-px w-8 bg-[#00ff88]" />
              <span className="font-mono text-xs uppercase tracking-wider text-[#00ff88]">FAQ</span>
              <div className="h-px w-8 bg-[#00ff88]" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">Common questions.</h2>
          </div>
          <div className="space-y-0">
            {FAQ.map((item, i) => (
              <div key={i} className="border-b border-[#222] py-6">
                <h3 className="font-mono text-sm font-bold text-white mb-2">{item.q}</h3>
                <p className="font-mono text-sm text-white/60">{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center border border-[#00ff88]/20 bg-[#00ff88]/5 p-12 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to find the next breakout?</h2>
          <p className="font-mono text-sm text-white/60 mb-8">
            Start your {TRIAL_DAYS}-day free trial today. No credit card required.
          </p>
          <button
            onClick={() => navigate("/signup")}
            className="border border-[#00ff88] bg-[#00ff88] px-10 py-4 font-mono text-sm font-bold uppercase tracking-wider text-black transition-all hover:bg-transparent hover:text-[#00ff88]"
          >
            Start Free Trial
          </button>
        </div>
      </div>
    </div>
  )
}
