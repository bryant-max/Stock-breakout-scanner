import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Vercel automatically parses JSON bodies — we need the raw body for Stripe sig verification.
// So this function must be exported with config bodyParser: false.
export const config = { api: { bodyParser: false } };

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const PLAN_PRICE_IDS: Record<string, string | undefined> = {
  core: process.env.STRIPE_CORE_PRICE_ID,
  premium: process.env.STRIPE_PREMIUM_PRICE_ID,
};

function planFromPriceId(priceId: string): string {
  for (const [plan, pid] of Object.entries(PLAN_PRICE_IDS)) {
    if (pid === priceId) return plan;
  }
  return "core";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(501).json({ detail: "Stripe webhook not configured" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
  });

  const sig = req.headers["stripe-signature"] as string;
  if (!sig) return res.status(400).json({ detail: "Missing stripe-signature" });

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Webhook verification failed";
    console.error("[webhook] sig verify error:", msg);
    return res.status(400).json({ detail: msg });
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(stripe, supabase, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(supabase, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;
      default:
        console.log("[webhook] unhandled event:", event.type);
    }
  } catch (err) {
    console.error("[webhook] handler error:", err);
  }

  return res.status(200).json({ received: true });
}

async function handleCheckoutCompleted(
  stripe: Stripe,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.user_id;
  const plan = session.metadata?.plan ?? "core";
  if (!userId) return;

  const now = new Date().toISOString();
  const upsertData = {
    user_id: userId,
    plan,
    status: session.subscription ? "trialing" : "active",
    stripe_customer_id: session.customer as string,
    stripe_subscription_id: session.subscription as string,
    updated_at: now,
  };

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  if (data) {
    await supabase.from("subscriptions").update(upsertData).eq("user_id", userId);
  } else {
    await supabase.from("subscriptions").insert({ ...upsertData, created_at: now });
  }

  // $1 auth-hold + immediate void to verify card
  try {
    const customerId = session.customer as string;
    if (customerId) {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
      if (pms.data.length > 0) {
        const pm = pms.data[0];
        const pi = await stripe.paymentIntents.create({
          amount: 100,
          currency: "usd",
          customer: customerId,
          payment_method: pm.id,
          capture_method: "manual",
          confirm: true,
          description: "Card verification hold - voided immediately",
        });
        await stripe.paymentIntents.cancel(pi.id);
        console.log("[webhook] $1 auth/void completed for user", userId);
      }
    }
  } catch (e) {
    console.warn("[webhook] $1 auth/void failed (non-critical):", e);
  }
}

async function handleSubscriptionUpdated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  subscription: Stripe.Subscription
) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price?.id ?? "";
  const plan = planFromPriceId(priceId);

  const statusMap: Record<string, string> = {
    active: "active", trialing: "trialing", past_due: "past_due",
    canceled: "canceled", unpaid: "past_due", paused: "active",
  };
  const status = statusMap[subscription.status] ?? subscription.status;

  await supabase
    .from("subscriptions")
    .update({ plan, status, updated_at: new Date().toISOString() })
    .eq("stripe_customer_id", customerId);
}

async function handleSubscriptionDeleted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  subscription: Stripe.Subscription
) {
  const customerId = subscription.customer as string;
  await supabase
    .from("subscriptions")
    .update({
      plan: "free", status: "canceled",
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);
}
