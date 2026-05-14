"""
Shared pytest fixtures for the Stock-breakout-scanner backend tests.

The system environment is missing several packages (cryptography/_cffi_backend,
postgrest, etc.) so we stub the entire problematic module tree before the app
is ever imported.  Tests that care about real behaviour mock the *service layer*
via patch(), not the OS-level imports.
"""
import os
import sys
import types
import pytest
from unittest.mock import AsyncMock, MagicMock

# ── 1. Ensure backend root is on sys.path ────────────────────────────────────
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# ── 2. Environment variables (must be set before config.py is imported) ───────
_ENV = {
    "POLYGON_API_KEY": "test_polygon_key",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "test_service_role_key",
    "SUPABASE_JWT_SECRET": "test_jwt_secret_32_chars_minimum!!",
    "STRIPE_SECRET_KEY": "sk_test_placeholder",
    "STRIPE_WEBHOOK_SECRET": "whsec_test",
    "SNAPTRADE_CLIENT_ID": "test_client_id",
    "SNAPTRADE_CONSUMER_KEY": "test_consumer_key",
    "CORS_ORIGINS": "http://localhost:5173",
    "FRONTEND_URL": "http://localhost:5173",
    "ANTHROPIC_API_KEY": "sk-ant-test",
}
for k, v in _ENV.items():
    os.environ.setdefault(k, v)


# ── 3. Stub helper ─────────────────────────────────────────────────────────────
def _mod(name: str, **attrs):
    """Create and register a stub module, returning it."""
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


# ── 4. Stub broken/missing packages ───────────────────────────────────────────

# jwt (system cryptography is broken)
if "jwt" not in sys.modules:
    _jwt = _mod("jwt")
    _jwt.decode = lambda *a, **kw: {
        "sub": "test-user-uuid-1234",
        "email": "test@example.com",
        "role": "authenticated",
    }
    _jwt.ExpiredSignatureError = Exception
    _jwt.InvalidTokenError = Exception
    _jwt.PyJWTError = Exception

# postgrest (supabase dependency)
if "postgrest" not in sys.modules:
    _pg = _mod("postgrest")
    _pg.AsyncPostgrestClient = MagicMock
    _mod("postgrest._async", AsyncClient=MagicMock)
    _mod("postgrest._async.client", AsyncPostgrestClient=MagicMock)

# supabase package (we use a custom client, just stop the import from failing)
if "supabase" not in sys.modules:
    _sb = _mod("supabase")
    _sb.create_client = MagicMock(return_value=MagicMock())
    _sb.Client = MagicMock
    _mod("supabase.client", create_client=_sb.create_client, Client=_sb.Client)

# gotrue, realtime, storage3 (supabase transitive deps)
for _name in ("gotrue", "gotrue.types", "realtime", "storage3",
              "supabase._async", "supabase._sync", "supabase.lib",
              "supabase.lib.client_options"):
    _mod(_name)

# slowapi
if "slowapi" not in sys.modules:
    class _FakeLimiter:
        def __init__(self, *a, **kw): pass
        def limit(self, *a, **kw):
            def _dec(fn): return fn
            return _dec

    _sl = _mod("slowapi",
               Limiter=_FakeLimiter,
               _rate_limit_exceeded_handler=MagicMock())
    _mod("slowapi.errors", RateLimitExceeded=Exception)
    _mod("slowapi.middleware", SlowAPIMiddleware=MagicMock)
    _mod("slowapi.util", get_remote_address=lambda r: "127.0.0.1")

# stripe
if "stripe" not in sys.modules:
    _stripe = _mod("stripe")
    _stripe.api_key = None
    _stripe.Webhook = MagicMock()
    _stripe.checkout = MagicMock()
    _stripe.billing_portal = MagicMock()
    _stripe.StripeError = Exception
    _stripe.SignatureVerificationError = Exception
    _stripe.PaymentIntent = MagicMock()
    _stripe.PaymentMethod = MagicMock()

# anthropic
if "anthropic" not in sys.modules:
    _ant = _mod("anthropic")
    _ant.Anthropic = MagicMock
    _ant.AsyncAnthropic = MagicMock

# snaptrade_client
if "snaptrade_client" not in sys.modules:
    _snaptrade = _mod("snaptrade_client")
    _snaptrade.SnapTrade = MagicMock

# redis
if "redis" not in sys.modules:
    _redis = _mod("redis")
    _redis.asyncio = _mod("redis.asyncio", Redis=MagicMock, from_url=MagicMock())
    _redis.Redis = MagicMock
    _redis.from_url = MagicMock()

# resend
if "resend" not in sys.modules:
    _resend = _mod("resend")
    _resend.Emails = MagicMock()
    _resend.api_key = None

# twilio
if "twilio" not in sys.modules:
    _twilio = _mod("twilio")
    _mod("twilio.rest", Client=MagicMock)
    _mod("twilio.base")
    _mod("twilio.base.exceptions", TwilioRestException=Exception)

# pywebpush
if "pywebpush" not in sys.modules:
    _mod("pywebpush", webpush=MagicMock(), WebPushException=Exception)

# youtube_transcript_api
if "youtube_transcript_api" not in sys.modules:
    _mod("youtube_transcript_api", YouTubeTranscriptApi=MagicMock)


# ── 5. Stub middleware.auth (depends on broken jwt) ───────────────────────────
FAKE_USER = {
    "user_id": "test-user-uuid-1234",
    "email": "test@example.com",
    "role": "authenticated",
}

_auth_mod = types.ModuleType("middleware.auth")
_auth_mod.get_current_user = lambda: FAKE_USER
_auth_mod.security = MagicMock()
sys.modules["middleware.auth"] = _auth_mod


# ── 6. Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture()
def fake_user():
    return FAKE_USER


@pytest.fixture()
def app():
    """FastAPI app with auth dependency overridden."""
    from middleware.auth import get_current_user
    from app import app as _app

    _app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    yield _app
    _app.dependency_overrides.clear()


@pytest.fixture()
async def client(app):
    """Async HTTPX test client."""
    from httpx import AsyncClient, ASGITransport
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


# ── 7. Shared test data ────────────────────────────────────────────────────────

FAKE_OPTIONS_RESPONSE = {
    "results": [
        {
            "details": {
                "ticker": "O:AAPL240119C00150000",
                "contract_type": "call",
                "strike_price": 150.0,
                "expiration_date": "2024-01-19",
                "shares_per_contract": 100,
            },
            "greeks": {"delta": 0.52, "gamma": 0.02, "theta": -0.05, "vega": 0.18},
            "implied_volatility": 0.35,
            "open_interest": 1234,
            "day": {"volume": 500, "close": 5.50},
            "last_quote": {"bid": 5.40, "ask": 5.60},
            "last_trade": {"price": 5.50},
        },
        {
            "details": {
                "ticker": "O:AAPL240119P00150000",
                "contract_type": "put",
                "strike_price": 150.0,
                "expiration_date": "2024-01-19",
                "shares_per_contract": 100,
            },
            "greeks": {"delta": -0.48, "gamma": 0.02, "theta": -0.04, "vega": 0.17},
            "implied_volatility": 0.37,
            "open_interest": 876,
            "day": {"volume": 300, "close": 4.80},
            "last_quote": {"bid": 4.70, "ask": 4.90},
            "last_trade": {"price": 4.80},
        },
    ]
}
