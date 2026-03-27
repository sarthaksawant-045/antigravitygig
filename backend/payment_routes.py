"""
Payment, event lifecycle, dispute and payout routes for GigBridge.
Modular extension - does not change existing hire/signup/login flows.
"""
import time
import hmac
import hashlib
import os
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from html import escape
from database import freelancer_db, client_db, get_dict_cursor, mark_job_completed, activate_freelancer_premium_subscription
from admin_db import log_transaction
import payment_config
from payment_config import (
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET,
    CANCELLATION_FULL_REFUND_DAYS,
    CANCELLATION_PARTIAL_REFUND_HOURS,
    PAYMENT_PENDING,
    PAYMENT_CREATED,
    PAYMENT_PAID,
    PAYOUT_ON_HOLD,
    PAYOUT_RELEASED,
    PAYOUT_REFUNDED,
    PAYOUT_PARTIAL_SETTLEMENT,
    EVENT_SCHEDULED,
    EVENT_CHECKED_IN,
    EVENT_COMPLETED,
    EVENT_DISPUTED,
    EVENT_CLOSED,
    EVENT_CANCELLED,
)

payment_bp = Blueprint("payment", __name__)
PREMIUM_SUBSCRIPTION_AMOUNT_RUPEES = 499
PREMIUM_SUBSCRIPTION_AMOUNT_PAISE = 499 * 100


def _now():
    return int(time.time())


def _get_razorpay_credentials():
    key_id = (
        os.getenv("RAZORPAY_KEY_ID")
        or os.getenv("RAZORPAY_TEST_KEY_ID")
        or getattr(payment_config, "RAZORPAY_KEY_ID", "")
    )
    key_secret = (
        os.getenv("RAZORPAY_KEY_SECRET")
        or os.getenv("RAZORPAY_TEST_KEY_SECRET")
        or getattr(payment_config, "RAZORPAY_KEY_SECRET", "")
    )
    return key_id, key_secret


def _get_razorpay_client():
    key_id, key_secret = _get_razorpay_credentials()
    if not key_id or not key_secret:
        return None
    try:
        import razorpay
        return razorpay.Client(auth=(key_id, key_secret))
    except Exception:
        return None


def _verify_razorpay_signature(order_id, payment_id, signature):
    _, key_secret = _get_razorpay_credentials()
    if not key_secret:
        return False
    body = f"{order_id}|{payment_id}"
    expected = hmac.new(
        key_secret.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _format_subscription_validity(premium_valid_until):
    if not premium_valid_until:
        return "90 days"
    try:
        return premium_valid_until.strftime("%d %b %Y")
    except Exception:
        return str(premium_valid_until)


def _build_subscription_email_html(freelancer_name, plan_name, amount, validity, activated_date):
    return f"""
    <html>
    <body style="font-family: Arial, Helvetica, sans-serif; background:#f5f7fb; padding:20px;">
      <div style="max-width:600px; margin:auto; background:#ffffff; border-radius:10px; padding:20px; border:1px solid #e5e7eb;">
        <h2 style="color:#2563eb; margin-top:0;">🎉 Subscription Activated!</h2>

        <p>Hi <b>{escape(freelancer_name)}</b>,</p>

        <p>Your subscription has been successfully activated.</p>

        <div style="margin:20px 0; padding:15px; background:#f1f5f9; border-radius:8px;">
          <p><b>Plan:</b> {escape(plan_name)}</p>
          <p><b>Amount Paid:</b> ₹{escape(str(amount))}</p>
          <p><b>Validity:</b> {escape(validity)}</p>
          <p><b>Date:</b> {escape(activated_date)}</p>
        </div>

        <p style="color:#16a34a;"><b>You're now ready to explore more opportunities and grow your profile 🚀</b></p>

        <hr style="margin:20px 0; border:none; border-top:1px solid #e5e7eb;" />

        <p style="font-size:12px; color:#6b7280;">
          Thank you for choosing GigBridge 💙
        </p>
      </div>
    </body>
    </html>
    """


def _send_subscription_activation_email(updated_user, plan_name, amount, validity):
    email = (updated_user or {}).get("email")
    if not email:
        return False

    from app import send_email

    freelancer_name = (updated_user or {}).get("name") or "Freelancer"
    activated_date = datetime.now(timezone.utc).strftime("%d %b %Y")
    subject = "🎉 Subscription Activated Successfully – GigBridge"
    body = (
        f"Hi {freelancer_name},\n\n"
        "Your subscription has been successfully activated.\n\n"
        f"Plan: {plan_name}\n"
        f"Amount Paid: ₹{amount}\n"
        f"Validity: {validity}\n"
        f"Date: {activated_date}\n\n"
        "You're now ready to explore more opportunities and grow your profile.\n\n"
        "Thank you for choosing GigBridge."
    )
    html_body = _build_subscription_email_html(
        freelancer_name=freelancer_name,
        plan_name=plan_name,
        amount=amount,
        validity=validity,
        activated_date=activated_date,
    )
    return send_email(email, subject, body, html_body=html_body)


# ============================================================
# HIRE PAYMENT FLOW
# ============================================================

@payment_bp.route("/payment/success", methods=["POST"])
def payment_success():
    """Handle successful payment and mark job as completed"""
    data = request.get_json()

    job_id = data.get("job_id")
    amount = data.get("amount")

    # Validate input
    if not job_id:
        return jsonify({"success": False, "msg": "job_id required"}), 400

    try:
        job_id = int(job_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid job_id"}), 400

    # TODO: Add real payment verification here (Razorpay/Stripe)
    # For now assume payment is successful
    
    success, msg = mark_job_completed(job_id)

    if not success:
        return jsonify({"success": False, "msg": msg}), 400

    return jsonify({
        "success": True,
        "msg": "Payment successful and job completed"
    })

@payment_bp.route("/payment/hire/create-order", methods=["POST"])
def payment_hire_create_order():
    """Create Razorpay order for a hire. Client calls after confirming hire."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    client_id = data.get("client_id")
    if not hire_id or not client_id:
        return jsonify({"success": False, "msg": "hire_id and client_id required"}), 400
    try:
        hire_id = int(hire_id)
        client_id = int(client_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid ids"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, client_id, freelancer_id, proposed_budget, status, payment_status
            FROM hire_request WHERE id=%s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if int(row["client_id"]) != client_id:
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        if str(row["status"] or "").upper() != "ACCEPTED":
            return jsonify({"success": False, "msg": "Hire must be ACCEPTED to pay"}), 400
        if str(row.get("payment_status") or "pending") == "paid":
            return jsonify({"success": False, "msg": "Already paid"}), 400

        amount_paise = int(float(row["proposed_budget"] or 0) * 100)
        if amount_paise < 100:
            return jsonify({"success": False, "msg": "Invalid amount"}), 400

        client = _get_razorpay_client()
        if not client:
            return jsonify({"success": False, "msg": "Razorpay not configured"}), 503

        order = client.order.create(data={"amount": amount_paise, "currency": "INR"})
        order_id = order.get("id")
        if not order_id:
            return jsonify({"success": False, "msg": "Failed to create order"}), 500

        cur.execute("""
            INSERT INTO payment_records (hire_id, record_type, razorpay_order_id, amount, status, created_at)
            VALUES (%s, 'hire', %s, %s, 'created', %s)
        """, (hire_id, order_id, float(row["proposed_budget"]), _now()))
        conn.commit()

        cur.execute("""
            UPDATE hire_request SET payment_status='created' WHERE id=%s
        """, (hire_id,))
        conn.commit()

        log_transaction(row["freelancer_id"], row["client_id"], float(row["proposed_budget"]), "Pending", row.get("project_id"))

        return jsonify({
            "success": True,
            "razorpay_order_id": order_id,
            "amount": amount_paise,
            "currency": "INR",
            "key_id": RAZORPAY_KEY_ID
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(e)}), 500
    finally:
        conn.close()


@payment_bp.route("/payment/hire/verify", methods=["POST"])
def payment_hire_verify():
    """Verify Razorpay payment and mark hire as funded."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    razorpay_payment_id = data.get("razorpay_payment_id")
    razorpay_order_id = data.get("razorpay_order_id")
    razorpay_signature = data.get("razorpay_signature")
    if not all([hire_id, razorpay_payment_id, razorpay_order_id, razorpay_signature]):
        return jsonify({"success": False, "msg": "Missing payment verification fields"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT payment_id, hire_id, status FROM payment_records
            WHERE hire_id=%s AND razorpay_order_id=%s AND record_type='hire'
        """, (int(hire_id), razorpay_order_id))
        rec = cur.fetchone()
        if not rec:
            return jsonify({"success": False, "msg": "Order not found"}), 404
        if str(rec.get("status") or "") == "paid":
            return jsonify({"success": True, "msg": "Already verified"})

        if not _verify_razorpay_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
            return jsonify({"success": False, "msg": "Invalid signature"}), 400

        cur.execute("""
            UPDATE payment_records SET razorpay_payment_id=%s, razorpay_signature=%s, status='paid', created_at=created_at
            WHERE payment_id=%s
        """, (razorpay_payment_id, razorpay_signature, rec["payment_id"]))
        cur.execute("""
            UPDATE hire_request SET payment_status='paid', payout_status='on_hold', event_status=%s WHERE id=%s
        """, (EVENT_SCHEDULED, int(hire_id)))
        # Log the successful payment
        cur.execute("SELECT client_id, freelancer_id, proposed_budget FROM hire_request WHERE id=%s", (int(hire_id),))
        h = cur.fetchone()
        if h:
            from admin_db import log_transaction
            log_transaction(h["freelancer_id"], h["client_id"], float(h["proposed_budget"]), "Paid", int(hire_id))

        conn.commit()
        try:
            from app import send_payment_receipt_emails
            send_payment_receipt_emails(
                hire_id=int(hire_id),
                order_id=razorpay_order_id,
                payment_id=razorpay_payment_id,
                amount=float(h["proposed_budget"] or 0) if h else 0,
                currency="INR",
                status="Paid"
            )
        except Exception:
            pass
        try:
            from notification_helper import notify_freelancer
            if h:
                notify_freelancer(
                    freelancer_id=h["freelancer_id"],
                    sender_id=h["client_id"],
                    notification_type="PAYMENT_RECEIVED",
                    title="Payment Received",
                    message=f"Payment of INR {float(h['proposed_budget'] or 0):,.2f} was completed for your gig.",
                    related_entity_type="payment",
                    related_entity_id=int(hire_id),
                    reference_id=int(hire_id),
                )
        except Exception:
            pass
        return jsonify({"success": True, "msg": "Payment verified"})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(e)}), 500
    finally:
        conn.close()


# ============================================================
# EVENT CHECK-IN
# ============================================================

@payment_bp.route("/freelancer/event/checkin", methods=["POST"])
def freelancer_event_checkin():
    """Freelancer check-in at venue."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    latitude = data.get("latitude")
    longitude = data.get("longitude")
    timestamp = data.get("timestamp", _now())
    if hire_id is None:
        return jsonify({"success": False, "msg": "hire_id required"}), 400
    try:
        hire_id = int(hire_id)
        lat = float(latitude) if latitude is not None else None
        lon = float(longitude) if longitude is not None else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid hire_id or coordinates"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, freelancer_id, event_status, payment_status
            FROM hire_request WHERE id=%s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if data.get("freelancer_id") and int(row["freelancer_id"]) != int(data["freelancer_id"]):
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        if str(row.get("payment_status") or "") != "paid":
            return jsonify({"success": False, "msg": "Hire must be paid before check-in"}), 400

        cur.execute("""
            UPDATE hire_request SET
                checkin_time=%s, checkin_latitude=%s, checkin_longitude=%s, checkin_verified=1, event_status=%s
            WHERE id=%s
        """, (int(timestamp), lat, lon, EVENT_CHECKED_IN, hire_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Check-in recorded"})
    finally:
        conn.close()


# ============================================================
# EVENT COMPLETION
# ============================================================

@payment_bp.route("/freelancer/event/complete", methods=["POST"])
def freelancer_event_complete():
    """Freelancer marks event completed."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    completion_note = data.get("completion_note", "").strip()
    proof = data.get("proof") or data.get("completion_proof") or ""
    if not hire_id:
        return jsonify({"success": False, "msg": "hire_id required"}), 400
    hire_id = int(hire_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, freelancer_id, event_status
            FROM hire_request WHERE id=%s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if str(row.get("event_status") or "") not in (EVENT_SCHEDULED, EVENT_CHECKED_IN):
            return jsonify({"success": False, "msg": "Invalid state for completion"}), 400

        cur.execute("""
            UPDATE hire_request SET completion_note=%s, completion_proof=%s, completed_at=%s, event_status=%s
            WHERE id=%s
        """, (completion_note, proof, _now(), EVENT_COMPLETED, hire_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Completion recorded"})
    finally:
        conn.close()


@payment_bp.route("/client/event/approve", methods=["POST"])
def client_event_approve():
    """Client approves completion -> payout becomes eligible."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    client_id = data.get("client_id")
    if not hire_id or not client_id:
        return jsonify({"success": False, "msg": "hire_id and client_id required"}), 400
    hire_id, client_id = int(hire_id), int(client_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, client_id, event_status
            FROM hire_request WHERE id=%s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if int(row["client_id"]) != client_id:
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        if str(row.get("event_status") or "") != EVENT_COMPLETED:
            return jsonify({"success": False, "msg": "Event must be completed by freelancer first"}), 400

        cur.execute("""
            UPDATE hire_request SET payout_status=%s WHERE id=%s
        """, ("requested", hire_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Completion approved; payout eligible"})
    finally:
        conn.close()


# ============================================================
# DISPUTE
# ============================================================

@payment_bp.route("/client/event/dispute", methods=["POST"])
def client_event_dispute():
    """Client raises dispute."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    client_id = data.get("client_id")
    reason = data.get("dispute_reason", "").strip()
    proof = data.get("proof", "").strip()
    if not hire_id or not client_id:
        return jsonify({"success": False, "msg": "hire_id and client_id required"}), 400
    hire_id, client_id = int(hire_id), int(client_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id, client_id, event_status FROM hire_request WHERE id=%s", (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if int(row["client_id"]) != client_id:
            return jsonify({"success": False, "msg": "Not authorized"}), 403

        cur.execute("""
            INSERT INTO disputes (hire_id, raised_by, dispute_reason, proof, status, resolved_at)
            VALUES (%s, 'client', %s, %s, 'OPEN', NULL)
        """, (hire_id, reason, proof))
        cur.execute("UPDATE hire_request SET event_status=%s WHERE id=%s", (EVENT_DISPUTED, hire_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Dispute raised"})
    finally:
        conn.close()


@payment_bp.route("/admin/disputes/list", methods=["GET"])
def admin_disputes_list():
    """List open disputes (admin)."""
    token = request.headers.get("X-ADMIN-TOKEN", "").strip()
    if not token:
        return jsonify({"success": False, "msg": "Unauthorized"}), 401
    conn = freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT admin_id, expires_at FROM admin_session WHERE token=%s
        """, (token,))
        r = cur.fetchone()
        if not r or (r[1] or 0) < _now():
            return jsonify({"success": False, "msg": "Unauthorized"}), 401
    finally:
        conn.close()

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT d.dispute_id, d.hire_id, d.raised_by, d.dispute_reason, d.proof, d.status, d.admin_decision, d.resolved_at
            FROM disputes d ORDER BY d.dispute_id DESC
        """)
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "dispute_id": r.get("dispute_id"),
                "hire_id": r.get("hire_id"),
                "raised_by": r.get("raised_by"),
                "dispute_reason": r.get("dispute_reason"),
                "proof": r.get("proof"),
                "status": r.get("status"),
                "admin_decision": r.get("admin_decision"),
                "resolved_at": r.get("resolved_at"),
            })
        return jsonify({"success": True, "disputes": out})
    finally:
        conn.close()


@payment_bp.route("/admin/disputes/resolve", methods=["POST"])
def admin_disputes_resolve():
    """Admin: release payout / refund client / partial settlement."""
    data = request.get_json(silent=True) or {}
    token = request.headers.get("X-ADMIN-TOKEN", "").strip()
    if not token:
        return jsonify({"success": False, "msg": "Unauthorized"}), 401
    conn = freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT admin_id, expires_at FROM admin_session WHERE token=%s", (token,))
        r = cur.fetchone()
        if not r or (r[1] or 0) < _now():
            return jsonify({"success": False, "msg": "Unauthorized"}), 401
    finally:
        conn.close()

    dispute_id = data.get("dispute_id")
    resolution_type = (data.get("resolution_type") or "").strip().lower()
    admin_note = (data.get("admin_note") or "").strip()
    if not dispute_id or resolution_type not in ("release_payout", "refund_client", "partial_settlement"):
        return jsonify({"success": False, "msg": "dispute_id and resolution_type (release_payout|refund_client|partial_settlement) required"}), 400
    dispute_id = int(dispute_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT dispute_id, hire_id FROM disputes WHERE dispute_id=%s AND status='OPEN'", (dispute_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Dispute not found or already resolved"}), 404
        hire_id = row["hire_id"]

        if resolution_type == "release_payout":
            cur.execute("UPDATE hire_request SET payout_status=%s, event_status=%s WHERE id=%s",
                        (PAYOUT_RELEASED, EVENT_CLOSED, hire_id))
        elif resolution_type == "refund_client":
            cur.execute("UPDATE hire_request SET payout_status=%s, payment_status='refunded', event_status=%s WHERE id=%s",
                        (PAYOUT_REFUNDED, EVENT_CLOSED, hire_id))
        else:
            cur.execute("UPDATE hire_request SET payout_status=%s, event_status=%s WHERE id=%s",
                        (PAYOUT_PARTIAL_SETTLEMENT, EVENT_CLOSED, hire_id))

        cur.execute("""
            UPDATE disputes SET status='CLOSED', admin_decision=%s, admin_note=%s, resolution_type=%s, resolved_at=%s
            WHERE dispute_id=%s
        """, (resolution_type, admin_note, resolution_type, _now(), dispute_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Dispute resolved"})
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(e)}), 500
    finally:
        conn.close()


# ============================================================
# CANCELLATION (configurable rules)
# ============================================================

@payment_bp.route("/admin/payout/release", methods=["POST"])
def admin_payout_release():
    """Admin: release payout for a hire (no dispute)."""
    data = request.get_json(silent=True) or {}
    token = request.headers.get("X-ADMIN-TOKEN", "").strip()
    if not token:
        return jsonify({"success": False, "msg": "Unauthorized"}), 401
    conn = freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT admin_id, expires_at FROM admin_session WHERE token=%s", (token,))
        r = cur.fetchone()
        if not r or (r[1] or 0) < _now():
            return jsonify({"success": False, "msg": "Unauthorized"}), 401
    finally:
        conn.close()

    hire_id = data.get("hire_id")
    if not hire_id:
        return jsonify({"success": False, "msg": "hire_id required"}), 400
    hire_id = int(hire_id)
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id, payout_status, event_status FROM hire_request WHERE id=%s", (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if str(row.get("event_status") or "") == EVENT_DISPUTED:
            return jsonify({"success": False, "msg": "Use dispute resolve for disputed hires"}), 400
        cur.execute("UPDATE hire_request SET payout_status=%s, event_status=%s WHERE id=%s",
                    (PAYOUT_RELEASED, EVENT_CLOSED, hire_id))
        conn.commit()
        return jsonify({"success": True, "msg": "Payout released"})
    finally:
        conn.close()


@payment_bp.route("/hire/cancel", methods=["POST"])
def hire_cancel():
    """Cancel hire. Refund per config: 7+ days full, 48h partial, same day none."""
    data = request.get_json(silent=True) or {}
    hire_id = data.get("hire_id")
    client_id = data.get("client_id")
    if not hire_id or not client_id:
        return jsonify({"success": False, "msg": "hire_id and client_id required"}), 400
    hire_id, client_id = int(hire_id), int(client_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, client_id, event_date, start_time, payment_status, event_status
            FROM hire_request WHERE id=%s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire not found"}), 404
        if int(row["client_id"]) != client_id:
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        if str(row.get("event_status") or "") == EVENT_CANCELLED:
            return jsonify({"success": False, "msg": "Already cancelled"}), 400

        event_date_str = (row.get("event_date") or "").strip()
        if not event_date_str:
            refund_type = "full"
        else:
            try:
                from datetime import datetime, timedelta
                event_dt = datetime.strptime(event_date_str, "%Y-%m-%d")
                now = datetime.now()
                delta = (event_dt - now).total_seconds() / 3600
                if delta >= CANCELLATION_FULL_REFUND_DAYS * 24:
                    refund_type = "full"
                elif delta >= CANCELLATION_PARTIAL_REFUND_HOURS:
                    refund_type = "partial"
                else:
                    refund_type = "none"
            except Exception:
                refund_type = "partial"

        cur.execute("""
            UPDATE hire_request SET event_status=%s WHERE id=%s
        """, (EVENT_CANCELLED, hire_id))
        if str(row.get("payment_status") or "") == "paid":
            cur.execute("""
                UPDATE payment_records SET status='refunded' WHERE hire_id=%s AND record_type='hire'
            """, (hire_id,))
        conn.commit()
        return jsonify({"success": True, "refund_type": refund_type, "msg": "Cancelled"})
    finally:
        conn.close()


# ============================================================
# SUBSCRIPTION PAYMENT (Razorpay)
# ============================================================

@payment_bp.route("/payment/subscription/create-order", methods=["POST"])
@payment_bp.route("/api/payments/create-order", methods=["POST"])
def payment_subscription_create_order():
    """Create Razorpay order for freelancer subscription upgrade."""
    data = request.get_json(silent=True) or {}
    freelancer_id = data.get("freelancer_id")
    plan_name = (data.get("plan_name") or "PREMIUM").strip().upper()
    if not freelancer_id or plan_name != "PREMIUM":
        return jsonify({"success": False, "msg": "freelancer_id and plan_name PREMIUM required"}), 400
    freelancer_id = int(freelancer_id)
    amount_paise = 499 * 100

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, is_premium, premium_valid_until
            FROM freelancer
            WHERE id=%s
        """, (freelancer_id,))
        freelancer_row = cur.fetchone()
        if not freelancer_row:
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404
        premium_valid_until = freelancer_row.get("premium_valid_until")
        if premium_valid_until and premium_valid_until.tzinfo is None:
            premium_valid_until = premium_valid_until.replace(tzinfo=timezone.utc)
        if freelancer_row.get("is_premium") and premium_valid_until and premium_valid_until > datetime.now(timezone.utc):
            return jsonify({
                "success": False,
                "msg": "Premium subscription is already active.",
                "user": {
                    "id": freelancer_row.get("id"),
                    "is_premium": True,
                    "premium_valid_until": premium_valid_until.isoformat(),
                },
            }), 409
    finally:
        conn.close()

    client = _get_razorpay_client()
    if not client:
        return jsonify({"success": False, "msg": "Razorpay not configured"}), 503

    try:
        order = client.order.create(data={"amount": amount_paise, "currency": "INR"})
        order_id = order.get("id")
        if not order_id:
            return jsonify({"success": False, "msg": "Failed to create order"}), 500
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            INSERT INTO payment_records (subscription_id, record_type, razorpay_order_id, amount, status, created_at)
            VALUES (%s, 'subscription', %s, %s, 'created', %s)
        """, (freelancer_id, order_id, PREMIUM_SUBSCRIPTION_AMOUNT_RUPEES, _now()))
        conn.commit()
        return jsonify({
            "success": True,
            "plan_name": "PREMIUM",
            "razorpay_order_id": order_id,
            "amount": amount_paise,
            "currency": "INR",
            "key_id": _get_razorpay_credentials()[0]
        })
    finally:
        conn.close()


@payment_bp.route("/payment/subscription/verify", methods=["POST"])
@payment_bp.route("/api/payments/verify", methods=["POST"])
def payment_subscription_verify():
    """Verify subscription payment and activate plan."""
    data = request.get_json(silent=True) or {}
    freelancer_id = data.get("freelancer_id")
    razorpay_payment_id = data.get("razorpay_payment_id")
    razorpay_order_id = data.get("razorpay_order_id")
    razorpay_signature = data.get("razorpay_signature")
    if not all([freelancer_id, razorpay_payment_id, razorpay_order_id, razorpay_signature]):
        return jsonify({"success": False, "msg": "Missing verification fields"}), 400
    freelancer_id = int(freelancer_id)

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT payment_id, subscription_id, status FROM payment_records
            WHERE subscription_id=%s AND razorpay_order_id=%s AND record_type='subscription'
        """, (freelancer_id, razorpay_order_id))
        rec = cur.fetchone()
        if not rec:
            return jsonify({"success": False, "msg": "Order not found"}), 404
        if str(rec.get("status") or "") == "paid":
            return jsonify({"success": True, "msg": "Already activated"})

        if not _verify_razorpay_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
            return jsonify({"success": False, "msg": "Invalid signature"}), 400

        cur.execute("""
            UPDATE payment_records SET razorpay_payment_id=%s, razorpay_signature=%s, status='paid'
            WHERE payment_id=%s
        """, (razorpay_payment_id, razorpay_signature, rec["payment_id"]))
        conn.commit()

        updated_user = activate_freelancer_premium_subscription(freelancer_id, days=90)
        if not updated_user:
            return jsonify({"success": False, "msg": "Payment verified but subscription activation failed"}), 500

        try:
            _send_subscription_activation_email(
                updated_user=updated_user,
                plan_name="PREMIUM",
                amount=PREMIUM_SUBSCRIPTION_AMOUNT_RUPEES,
                validity=_format_subscription_validity(updated_user.get("premium_valid_until")),
            )
        except Exception:
            # Email failures should never block a confirmed subscription activation.
            pass

        return jsonify({
            "success": True,
            "msg": "Subscription activated",
            "data": {
                "freelancer_id": freelancer_id,
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
            },
            "user": {
                "id": updated_user.get("id"),
                "name": updated_user.get("name"),
                "email": updated_user.get("email"),
                "role": "freelancer",
                "is_premium": bool(updated_user.get("is_premium")),
                "premium_valid_until": (
                    updated_user.get("premium_valid_until").isoformat()
                    if updated_user.get("premium_valid_until") else None
                ),
            },
        })
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(e)}), 500
    finally:
        conn.close()


# ============================================================
# PAYOUT DETAILS (separate from profile)
# ============================================================

@payment_bp.route("/freelancer/payout/details", methods=["GET"])
def freelancer_payout_details():
    """GET freelancer payout details (bank or UPI)."""
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400
    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT id, payout_method, account_holder_name, account_number, ifsc_code, upi_id, created_at
            FROM payout_details WHERE freelancer_id=%s ORDER BY id DESC
        """, (freelancer_id,))
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r.get("id"),
                "payout_method": r.get("payout_method"),
                "account_holder_name": r.get("account_holder_name"),
                "account_number": r.get("account_number") and "****" + str(r.get("account_number"))[-4:] or None,
                "ifsc_code": r.get("ifsc_code"),
                "upi_id": r.get("upi_id"),
                "created_at": r.get("created_at"),
            })
        return jsonify({"success": True, "details": out})
    finally:
        conn.close()


@payment_bp.route("/freelancer/payout/add", methods=["POST"])
def freelancer_payout_add():
    """POST add payout details - bank or UPI. No card/UPI PIN."""
    data = request.get_json(silent=True) or {}
    freelancer_id = data.get("freelancer_id")
    payout_method = (data.get("payout_method") or "").strip().upper()
    account_holder_name = (data.get("account_holder_name") or "").strip()
    if not freelancer_id or not payout_method or not account_holder_name:
        return jsonify({"success": False, "msg": "freelancer_id, payout_method (BANK|UPI), account_holder_name required"}), 400
    freelancer_id = int(freelancer_id)

    if payout_method == "BANK":
        account_number = (data.get("account_number") or "").strip()
        ifsc_code = (data.get("ifsc_code") or "").strip()
        if not account_number or not ifsc_code:
            return jsonify({"success": False, "msg": "account_number and ifsc_code required for BANK"}), 400
        upi_id = None
    elif payout_method == "UPI":
        upi_id = (data.get("upi_id") or "").strip()
        if not upi_id:
            return jsonify({"success": False, "msg": "upi_id required for UPI"}), 400
        account_number = None
        ifsc_code = None
    else:
        return jsonify({"success": False, "msg": "payout_method must be BANK or UPI"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id FROM freelancer WHERE id=%s", (freelancer_id,))
        if not cur.fetchone():
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404

        cur.execute("""
            INSERT INTO payout_details (freelancer_id, payout_method, account_holder_name, account_number, ifsc_code, upi_id, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (freelancer_id, payout_method, account_holder_name, account_number, ifsc_code, upi_id, _now()))
        conn.commit()
        return jsonify({"success": True, "msg": "Payout details added"})
    finally:
        conn.close()
