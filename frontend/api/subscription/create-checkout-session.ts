import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const TRIAL_PERIOD_DAYS = 7;

const PLAN_PRICE_IDS: Record<string, string | undefined> = {
    core: process.env.STRIPE_CORE_PRICE_ID,
    premium: process.env.STRIPE_PREMIUM_PRICE_ID,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

    // Validate Stripe is configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ detail: "Stripe not configured" });
  }

    // Auth: get Supabase user from Bearer token
    const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Missing authorization header" });
  }
  const token = authHeader.slice(7);

    const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.VITE_SUPABASE_ANON_KEY!
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }

    // Parse body
  const { plan } = req.body as { plan?: string };
  if (!plan || !PLAN_PRICE_IDS[plan]) {
    return res.status(400).json({ detail: `Unknown plan: ${plan}` });
  }

  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) {
    return res.status(501).json({ detail: `Price ID for plan '${plan}' not configured` });
    }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
            apiVersion: "2025-04-30.basil",
        });

      try {
      const frontendUrl = (process.env.FRONTEND_URL || "https://www.orbistrading.io").replace(/\/$/, "");

          const session = await stripe.checkout.sessions.create({
                customer_email: user.email,
          line_items: [{ price: priceId, quantity: 1 }],
                mode: "subscription",
                ui_mode: "embedded",
                payment_method_collection: "always",
                subscription_data: {
                    trial_period_days: TRIAL_PERIOD_DAYS,
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          },
          return_url: `${frontendUrl}/verify-email?checkout=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
          metadata: { user_id: user.id, plan },
          });

      return res.status(200).json({ client_secret: session.client_secret });
      } catch (err) {
          const message = err instanceof Error ? err.message : "Stripe error";
      console.error("[checkout] Stripe error:", message);
      return res.status(400).json({ detail: message });
    }
  }
