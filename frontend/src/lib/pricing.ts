export const TRIAL_DAYS = 7

export type PlanId = "core" | "premium"

export interface PricingFeature {
  text: string
  included: boolean
}

export interface PricingPlan {
  id: PlanId
  name: string
  price: number
  period: string
  stripePriceId: string
  description: string
  buttonText: string
  isPopular?: boolean
  features: PricingFeature[]
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "core",
    name: "Core",
    price: 39,
    period: "month",
    stripePriceId: import.meta.env.VITE_STRIPE_CORE_PRICE_ID ?? "price_core_monthly",
    description: "Everything you need to find and track breakout setups.",
    buttonText: "Start Free Trial",
    features: [
      { text: "Breakout Scanner", included: true },
      { text: "Charting & Technicals", included: true },
      { text: "Up to 5 Saved Scans", included: true },
      { text: "Email Alerts", included: true },
      { text: "Paper Trading", included: true },
      { text: "Access to Explore", included: true },
      { text: "Full Alt Data", included: false },
      { text: "AI Insights (Sean)", included: false },
      { text: "Unlimited Saved Strategies", included: false },
      { text: "SMS Alerts", included: false },
      { text: "Broker Connections", included: false },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: 79,
    period: "month",
    stripePriceId: import.meta.env.VITE_STRIPE_PREMIUM_PRICE_ID ?? "price_premium_monthly",
    description: "Full-stack edge for serious traders who want every signal.",
    buttonText: "Start Free Trial",
    isPopular: true,
    features: [
      { text: "Breakout Scanner", included: true },
      { text: "Charting & Technicals", included: true },
      { text: "Unlimited Saved Scans", included: true },
      { text: "Email Alerts", included: true },
      { text: "Paper Trading", included: true },
      { text: "Access to Explore", included: true },
      { text: "Full Alt Data", included: true },
      { text: "AI Insights (Sean)", included: true },
      { text: "Unlimited Saved Strategies", included: true },
      { text: "SMS Alerts", included: true },
      { text: "Broker Connections", included: true },
    ],
  },
]
