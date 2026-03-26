"""
Payment and cancellation configuration for GigBridge.
Configurable constants - do not hardcode in business logic.
"""
import os
from pathlib import Path


def _load_local_env():
    """Load simple KEY=VALUE pairs from backend/.env for local development."""
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


_load_local_env()

# Legacy local-development fallback values already used elsewhere in the app.
# This keeps the modular payment routes aligned with the existing working setup.
DEFAULT_RAZORPAY_KEY_ID = "rzp_test_SUJ9gz60CfdMWX"
DEFAULT_RAZORPAY_KEY_SECRET = "KiHXGap8Xly3BH7YRTi6Da0D"

# Razorpay (set via env in production)
RAZORPAY_KEY_ID = (
    os.getenv("RAZORPAY_KEY_ID")
    or os.getenv("RAZORPAY_TEST_KEY_ID")
    or DEFAULT_RAZORPAY_KEY_ID
)
RAZORPAY_KEY_SECRET = (
    os.getenv("RAZORPAY_KEY_SECRET")
    or os.getenv("RAZORPAY_TEST_KEY_SECRET")
    or DEFAULT_RAZORPAY_KEY_SECRET
)

# Cancellation refund rules (days/hours before event)
CANCELLATION_FULL_REFUND_DAYS = 7
CANCELLATION_PARTIAL_REFUND_HOURS = 48
CANCELLATION_SAME_DAY_HOURS = 0

# Refund types
REFUND_FULL = "full"
REFUND_PARTIAL = "partial"
REFUND_NONE = "none"

# Payment statuses
PAYMENT_PENDING = "pending"
PAYMENT_CREATED = "created"
PAYMENT_PAID = "paid"
PAYMENT_FAILED = "failed"
PAYMENT_REFUNDED = "refunded"

# Payout statuses
PAYOUT_ON_HOLD = "on_hold"
PAYOUT_REQUESTED = "requested"
PAYOUT_APPROVED = "approved"
PAYOUT_RELEASED = "released"
PAYOUT_FROZEN = "frozen"
PAYOUT_REFUNDED = "refunded"
PAYOUT_PARTIAL_SETTLEMENT = "partial_settlement"

# Event/job statuses
EVENT_SCHEDULED = "scheduled"
EVENT_CHECKED_IN = "checked_in"
EVENT_COMPLETED = "completed"
EVENT_DISPUTED = "disputed"
EVENT_CLOSED = "closed"
EVENT_CANCELLED = "cancelled"
