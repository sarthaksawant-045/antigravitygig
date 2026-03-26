from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from admin_routes import require_admin
from database import freelancer_db, get_dict_cursor


ticket_bp = Blueprint("ticket", __name__)


def _utc_now():
    return datetime.now(timezone.utc)


@ticket_bp.route("/api/tickets/raise", methods=["POST"])
def raise_ticket():
    data = request.get_json(silent=True) or {}
    project_id = data.get("project_id")
    user_id = data.get("user_id")
    role = str(data.get("role") or "").strip().lower()
    reason = str(data.get("reason") or "").strip()

    if not project_id or not user_id or not reason:
        return jsonify({"success": False, "msg": "project_id, user_id and reason are required"}), 400

    try:
        project_id = int(project_id)
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid project_id or user_id"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                p.id,
                p.hire_id,
                p.title,
                p.client_id,
                p.freelancer_id,
                p.status,
                COALESCE(p.payment_status, hr.payment_status, 'pending') AS payment_status
            FROM projects p
            LEFT JOIN hire_request hr ON hr.id = p.hire_id
            WHERE p.id = %s
        """, (project_id,))
        project = cur.fetchone()
        if not project:
            return jsonify({"success": False, "msg": "Project not found"}), 404

        normalized_status = str(project.get("status") or "").upper()
        normalized_payment = str(project.get("payment_status") or "").upper()
        if normalized_status not in ("ACCEPTED", "IN_PROGRESS", "COMPLETED", "VERIFIED"):
            return jsonify({"success": False, "msg": "Disputes can only be raised for active or completed projects"}), 400
        if normalized_payment in ("PAID", "REFUNDED"):
            return jsonify({"success": False, "msg": "This project is already financially resolved"}), 400

        if user_id == int(project.get("client_id") or 0):
            complainer_role = "client"
        elif user_id == int(project.get("freelancer_id") or 0):
            complainer_role = "artist"
        else:
            return jsonify({"success": False, "msg": "Only the client or artist on this project can raise a dispute"}), 403

        if role and role not in ("client", "artist", "freelancer"):
            return jsonify({"success": False, "msg": "Invalid role"}), 400
        if role in ("artist", "freelancer") and complainer_role != "artist":
            return jsonify({"success": False, "msg": "User role does not match project access"}), 403
        if role == "client" and complainer_role != "client":
            return jsonify({"success": False, "msg": "User role does not match project access"}), 403

        cur.execute("""
            SELECT ticket_id
            FROM tickets
            WHERE project_id = %s AND status = 'OPEN'
            ORDER BY created_at DESC
            LIMIT 1
        """, (project_id,))
        existing_ticket = cur.fetchone()
        if existing_ticket:
            return jsonify({"success": False, "msg": "An open dispute already exists for this project"}), 409

        cur.execute("""
            INSERT INTO tickets (project_id, hire_id, complainer_id, complainer_role, reason, status, created_at)
            VALUES (%s, %s, %s, %s, %s, 'OPEN', %s)
            RETURNING ticket_id, created_at
        """, (
            project_id,
            project.get("hire_id"),
            user_id,
            complainer_role,
            reason,
            _utc_now(),
        ))
        inserted = cur.fetchone()

        cur.execute("""
            UPDATE projects
            SET payment_status = 'DISPUTED'
            WHERE id = %s
        """, (project_id,))
        conn.commit()

        return jsonify({
            "success": True,
            "msg": "Dispute raised successfully",
            "ticket": {
                "ticket_id": inserted.get("ticket_id"),
                "project_id": project_id,
                "project_title": project.get("title"),
                "complainer_id": user_id,
                "complainer_role": complainer_role,
                "reason": reason,
                "status": "OPEN",
                "created_at": (
                    inserted.get("created_at").isoformat()
                    if inserted.get("created_at") else None
                ),
            },
        })
    except Exception as exc:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(exc)}), 500
    finally:
        conn.close()


@ticket_bp.route("/api/admin/tickets", methods=["GET"])
@require_admin
def admin_tickets():
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                t.ticket_id,
                t.project_id,
                t.hire_id,
                t.complainer_id,
                t.complainer_role,
                t.reason,
                t.status,
                t.created_at,
                p.title AS project_title,
                p.payment_status,
                c.name AS client_name,
                f.name AS artist_name,
                COALESCE(cmpl_client.name, cmpl_artist.name) AS complainer_name
            FROM tickets t
            JOIN projects p ON p.id = t.project_id
            LEFT JOIN client c ON c.id = p.client_id
            LEFT JOIN freelancer f ON f.id = p.freelancer_id
            LEFT JOIN client cmpl_client
                ON t.complainer_role = 'client' AND cmpl_client.id = t.complainer_id
            LEFT JOIN freelancer cmpl_artist
                ON t.complainer_role = 'artist' AND cmpl_artist.id = t.complainer_id
            WHERE t.status = 'OPEN'
            ORDER BY t.created_at DESC, t.ticket_id DESC
        """)
        rows = cur.fetchall() or []
        tickets = []
        for row in rows:
            tickets.append({
                "ticket_id": row.get("ticket_id"),
                "project_id": row.get("project_id"),
                "hire_id": row.get("hire_id"),
                "complainer_id": row.get("complainer_id"),
                "complainer_role": row.get("complainer_role"),
                "reason": row.get("reason"),
                "status": row.get("status"),
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "project_title": row.get("project_title"),
                "payment_status": row.get("payment_status"),
                "client_name": row.get("client_name"),
                "artist_name": row.get("artist_name"),
                "complainer_name": row.get("complainer_name"),
            })
        return jsonify({"success": True, "tickets": tickets})
    finally:
        conn.close()


@ticket_bp.route("/api/admin/tickets/resolve", methods=["POST"])
@require_admin
def admin_resolve_ticket():
    data = request.get_json(silent=True) or {}
    ticket_id = data.get("ticket_id")
    verdict = str(data.get("verdict") or "").strip().upper()

    if not ticket_id or verdict not in ("REFUND", "PAY_ARTIST"):
        return jsonify({"success": False, "msg": "ticket_id and verdict (REFUND or PAY_ARTIST) are required"}), 400

    try:
        ticket_id = int(ticket_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid ticket_id"}), 400

    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                t.ticket_id,
                t.project_id,
                t.hire_id,
                t.status,
                p.client_id,
                p.freelancer_id
            FROM tickets t
            JOIN projects p ON p.id = t.project_id
            WHERE t.ticket_id = %s
        """, (ticket_id,))
        ticket = cur.fetchone()
        if not ticket:
            return jsonify({"success": False, "msg": "Ticket not found"}), 404
        if str(ticket.get("status") or "").upper() != "OPEN":
            return jsonify({"success": False, "msg": "Ticket is already resolved"}), 400

        resolved_at = _utc_now()
        if verdict == "REFUND":
            project_payment_status = "REFUNDED"
            project_payout_status = "REFUNDED"
            hire_payment_status = "refunded"
            hire_payout_status = "refunded"
        else:
            project_payment_status = "PAID"
            project_payout_status = "RELEASED"
            hire_payment_status = "paid"
            hire_payout_status = "released"

        cur.execute("""
            UPDATE projects
            SET payment_status = %s, payout_status = %s
            WHERE id = %s
        """, (project_payment_status, project_payout_status, ticket.get("project_id")))

        if ticket.get("hire_id"):
            cur.execute("""
                UPDATE hire_request
                SET payment_status = %s, payout_status = %s, event_status = 'closed'
                WHERE id = %s
            """, (hire_payment_status, hire_payout_status, ticket.get("hire_id")))

            if verdict == "REFUND":
                cur.execute("""
                    UPDATE payment_records
                    SET status = 'refunded'
                    WHERE hire_id = %s AND record_type = 'hire'
                """, (ticket.get("hire_id"),))
            else:
                cur.execute("""
                    UPDATE payment_records
                    SET status = 'paid'
                    WHERE hire_id = %s AND record_type = 'hire'
                """, (ticket.get("hire_id"),))

        cur.execute("""
            UPDATE tickets
            SET status = 'RESOLVED', verdict = %s, admin_id = %s, resolved_at = %s
            WHERE ticket_id = %s
        """, (verdict, getattr(request, "admin_id", None), resolved_at, ticket_id))
        conn.commit()

        return jsonify({
            "success": True,
            "msg": f"Ticket resolved with verdict: {verdict}",
            "ticket": {
                "ticket_id": ticket_id,
                "project_id": ticket.get("project_id"),
                "verdict": verdict,
                "status": "RESOLVED",
                "payment_status": project_payment_status,
                "resolved_at": resolved_at.isoformat(),
            },
        })
    except Exception as exc:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": str(exc)}), 500
    finally:
        conn.close()
