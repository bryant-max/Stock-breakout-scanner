import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const TRIAL_PERIOD_DAYS = 7;

const PLAN_PRICE_IDS: Record<string, string | undefined> = {
  core: process.env.STRIPE_CORE_PRICE_ID,
  premium: process.env.STRIPE_PREMIUM_PRICE_ID,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ detail: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ detail: "Stripe not configured" });
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ detail: "Missing authorization header" });
  const token = authHeader.slice(7);
  const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ detail: "Invalid or expired token" });
  const { plan } = req.body as { plan?: string };
  if (!plan || !PLAN_PRICE_IDS[plan]) return res.status(400).json({ detail: "Unknown plan: " + plan });
  const priceId = PLAN_PRICE_IDS[plan]!;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  try {
    const existing = await stripe.customers.list({ email: user.email!, limit: 1 });
    const customer = existing.data.length > 0
      ? existing.data[0]
      : await stripe.customers.create({ email: user.email!, metadata: { user_id: user.id } });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { user_id: user.id, plan, price_id: priceId },
    });
    return res.status(200).json({
      client_secret: setupIntent.client_secret,
      customer_id: customer.id,
      plan,
      price_id: priceId,
      trial_days: TRIAL_PERIOD_DAYS,
      type: "setup_intent",
    });
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : "Stripe error" });
  }
}
