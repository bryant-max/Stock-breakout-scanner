import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const TRIAL_PERIOD_DAYS = 7;

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

  const { customer_id, price_id, payment_method_id, plan } = req.body as {
    customer_id?: string; price_id?: string; payment_method_id?: string; plan?: string
  };

  if (!customer_id || !price_id || !payment_method_id || !plan)
    return res.status(400).json({ detail: "Missing required fields" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" });

  try {
    // Set as default payment method
    await stripe.customers.update(customer_id, {
      invoice_settings: { default_payment_method: payment_method_id },
    });

    // Create subscription with trial
    const subscription = await stripe.subscriptions.create({
      customer: customer_id,
      items: [{ price: price_id }],
      trial_period_days: TRIAL_PERIOD_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      default_payment_method: payment_method_id,
      metadata: { user_id: user.id, plan },
    });

    // Upsert subscription in Supabase
    const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const now = new Date().toISOString();
    const upsertData = {
      user_id: user.id, plan,
      status: subscription.status === "trialing" ? "trialing" : "active",
      stripe_customer_id: customer_id,
      stripe_subscription_id: subscription.id,
      updated_at: now,
    };
    const { data: existing } = await supabaseAdmin.from("subscriptions").select("user_id").eq("user_id", user.id).single();
    if (existing) {
      await supabaseAdmin.from("subscriptions").update(upsertData).eq("user_id", user.id);
    } else {
      await supabaseAdmin.from("subscriptions").insert({ ...upsertData, created_at: now });
    }

    // $1 auth-hold + immediate void to verify card
    try {
      const pi = await stripe.paymentIntents.create({
        amount: 100, currency: "usd", customer: customer_id,
        payment_method: payment_method_id, capture_method: "manual", confirm: true,
        description: "Card verification hold - voided immediately",
      });
      await stripe.paymentIntents.cancel(pi.id);
    } catch (e) { console.warn("[confirm-sub] auth/void non-critical:", e); }

    return res.status(200).json({ subscription_id: subscription.id, status: subscription.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    console.error("[confirm-sub] error:", message);
    return res.status(400).json({ detail: message });
  }
}
