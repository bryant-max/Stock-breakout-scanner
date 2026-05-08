"""
Subscription and payment API endpoints.
Handles Stripe integration for Core and Premium plans with 7-day free trial.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
import stripe
import logging
from datetime import datetime, timezone

from models.user import Subscription
from services.supabase_client import supabase
from middleware.auth import get_current_user
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

stripe.api_key = settings.STRIPE_SECRET_KEY

PLAN_PRICE_IDS: dict[str, str | None] = {
    "core": settings.STRIPE_CORE_PRICE_ID,
    "premium": settings.STRIPE_PREMIUM_PRICE_ID,
}

TRIAL_PERIOD_DAYS = 7


@router.get("/", response_model=Subscription)
async def get_subscription(user: dict = Depends(get_current_user)):
    """Get user's current subscription, defaulting to free if none exists."""
    try:
        results = await supabase.table("subscriptions").select().eq("user_id", user["user_id"]).execute()
        if results:
            return results[0]
        return Subscription(
            user_id=user["user_id"],
            plan="free",
            status="active",
            created_at=datetime.now(timezone.utc),
        )
    except Exception as e:
        logger.error(f"Fetch subscription failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch subscription")


@router.post("/checkout")
async def create_checkout_session(request: Request, user: dict = Depends(get_current_user)):
    """
    Create a Stripe Checkout session for Core or Premium plan.
    Accepts JSON body: { "plan": "core" | "premium" }
    Returns { "checkout_url": "..." } for frontend redirect.
    """
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Stripe not configured.")

    body = await request.json()
    plan = body.get("plan", "core")

    if plan not in PLAN_PRICE_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown plan: {plan}")

    price_id = PLAN_PRICE_IDS[plan]
    if not price_id:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=f"Price ID for plan '{plan}' not configured.")

    try:
        frontend_url = settings.FRONTEND_URL.rstrip("/")
        session = stripe.checkout.Session.create(
            customer_email=user["email"],
            line_items=[{"price": price_id, "quantity": 1}],
            mode="subscription",
            subscription_data={"trial_period_days": TRIAL_PERIOD_DAYS},
            success_url=f"{frontend_url}/dashboard?checkout=success&plan={plan}",
            cancel_url=f"{frontend_url}/pricing?checkout=cancelled",
            metadata={"user_id": user["user_id"], "plan": plan},
        )
        return {"checkout_url": session.url, "session_id": session.id}

    except stripe.StripeError as e:
        logger.error(f"Stripe checkout error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment provider error")
    except Exception as e:
        logger.error(f"Create checkout session failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create checkout session")


@router.post("/portal")
async def create_portal_session(user: dict = Depends(get_current_user)):
    """Create Stripe customer portal session for subscription management."""
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Stripe not configured.")

    try:
        results = await supabase.table("subscriptions").select().eq("user_id", user["user_id"]).execute()
        if not results or not results[0].get("stripe_customer_id"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active subscription found")

        portal = stripe.billing_portal.Session.create(
            customer=results[0]["stripe_customer_id"],
            return_url=f"{settings.FRONTEND_URL.rstrip('/')}/settings",
        )
        return {"portal_url": portal.url}

    except stripe.StripeError as e:
        logger.error(f"Stripe portal error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment provider error")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create portal session failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create portal session")


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events.
    Listens for: checkout.session.completed, customer.subscription.updated,
    customer.subscription.deleted
    Configure this URL in Stripe Dashboard: <your-api-url>/api/subscription/webhook
    """
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Stripe webhook secret not configured")

    signature = request.headers.get("stripe-signature")
    if not signature:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing stripe-signature header")

    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    event_type = event["type"]
    logger.info(f"Stripe webhook received: {event_type}")

    try:
        if event_type == "checkout.session.completed":
            await _handle_checkout_completed(event["data"]["object"])
        elif event_type == "customer.subscription.updated":
            await _handle_subscription_updated(event["data"]["object"])
        elif event_type == "customer.subscription.deleted":
            await _handle_subscription_deleted(event["data"]["object"])
    except Exception as e:
        logger.error(f"Webhook handler error for {event_type}: {e}", exc_info=True)
        # Return 200 to acknowledge receipt — Stripe will not retry on 2xx
        return {"status": "error_logged", "event": event_type}

    return {"status": "success"}


# ── Private webhook handlers ────────────────────────────────────────────────

def _stripe_plan_from_subscription(subscription: dict) -> str:
    """Derive plan name from Stripe subscription price ID."""
    try:
        price_id = subscription["items"]["data"][0]["price"]["id"]
        if price_id == settings.STRIPE_PREMIUM_PRICE_ID:
            return "premium"
        if price_id == settings.STRIPE_CORE_PRICE_ID:
            return "core"
    except (KeyError, IndexError):
        pass
    return "core"


async def _handle_checkout_completed(session: dict):
    """Activate subscription after successful Stripe Checkout."""
    user_id = session.get("metadata", {}).get("user_id")
    plan = session.get("metadata", {}).get("plan", "core")
    if not user_id:
        logger.warning("checkout.session.completed missing user_id in metadata")
        return

    subscription_data = {
        "user_id": user_id,
        "plan": plan,
        "status": "trialing" if session.get("subscription") else "active",
        "stripe_customer_id": session.get("customer"),
        "stripe_subscription_id": session.get("subscription"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Upsert: try update first, insert if not exists
    existing = await supabase.table("subscriptions").select("user_id").eq("user_id", user_id).execute()
    if existing:
        await supabase.table("subscriptions").update(subscription_data).eq("user_id", user_id).execute()
    else:
        subscription_data["created_at"] = datetime.now(timezone.utc).isoformat()
        await supabase.table("subscriptions").insert([subscription_data]).execute()

    logger.info(f"Subscription activated: user={user_id} plan={plan}")


async def _handle_subscription_updated(subscription: dict):
    """Sync plan and status when Stripe subscription changes."""
    customer_id = subscription.get("customer")
    if not customer_id:
        return

    plan = _stripe_plan_from_subscription(subscription)
    stripe_status = subscription.get("status", "active")
    # Map Stripe statuses to our internal ones
    status_map = {
        "active": "active",
        "trialing": "trialing",
        "past_due": "past_due",
        "canceled": "canceled",
        "unpaid": "past_due",
        "paused": "active",
    }
    internal_status = status_map.get(stripe_status, stripe_status)

    await supabase.table("subscriptions").update({
        "plan": plan,
        "status": internal_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("stripe_customer_id", customer_id).execute()

    logger.info(f"Subscription updated: customer={customer_id} plan={plan} status={internal_status}")


async def _handle_subscription_deleted(subscription: dict):
    """Downgrade user to free when subscription is cancelled."""
    customer_id = subscription.get("customer")
    if not customer_id:
        return

    await supabase.table("subscriptions").update({
        "plan": "free",
        "status": "canceled",
        "stripe_subscription_id": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("stripe_customer_id", customer_id).execute()

    logger.info(f"Subscription cancelled: customer={customer_id}")
