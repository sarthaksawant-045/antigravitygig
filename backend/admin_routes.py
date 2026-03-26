from flask import Blueprint, request, jsonify, send_file
import sqlite3
import time
import secrets
import json
import os
from werkzeug.security import check_password_hash
from database import client_db, freelancer_db, get_pending_client_kyc, update_client_kyc_review
from settings import FEATURE_ADMIN_LOGOUT, FEATURE_KYC_RETENTION_CLEANUP

admin_bp = Blueprint("admin", __name__)

def _now():
    return int(time.time())

def require_admin(fn):
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-ADMIN-TOKEN", "").strip()
        if not token:
            return jsonify({"success": False, "msg": "Unauthorized"}), 401
        conn = freelancer_db()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT s.admin_id, s.expires_at, u.is_enabled, u.role
                FROM admin_session s
                JOIN admin_user u ON u.id = s.admin_id
                WHERE s.token=%s
            """, (token,))
            r = cur.fetchone()
            if not r:
                return jsonify({"success": False, "msg": "Unauthorized"}), 401
            if int(r[1] or 0) < _now():
                return jsonify({"success": False, "msg": "Unauthorized"}), 401
            if int(r[2] or 0) != 1:
                return jsonify({"success": False, "msg": "Unauthorized"}), 401
            request.admin_id = r[0]
            request.admin_role = r[3]
        finally:
            conn.close()
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__
    return wrapper

@admin_bp.route("/admin/login", methods=["POST"])
def admin_login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip()
    password = str(d.get("password", "")).strip()
    if not email or not password:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    conn = freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, password_hash, role, is_enabled FROM admin_user WHERE email=%s", (email,))
        r = cur.fetchone()
        if not r or int(r[3] or 0) != 1 or not check_password_hash(r[1], password):
            return jsonify({"success": False, "msg": "Unauthorized"}), 401
        admin_id = r[0]
        role = r[2]
        token = secrets.token_urlsafe(32)
        expires = _now() + 86400
        cur.execute("INSERT INTO admin_session (token, admin_id, expires_at, created_at) VALUES (%s,%s,%s,%s)",
                    (token, admin_id, expires, _now()))
        cur.execute("INSERT INTO admin_audit_log (admin_id, action, payload_json, created_at) VALUES (%s,%s,%s,%s)",
                    (admin_id, "login", json.dumps({"email": email}), _now()))
        conn.commit()
        return jsonify({"success": True, "token": token, "admin_id": admin_id, "role": role})
    finally:
        conn.close()

@admin_bp.route("/admin/stats", methods=["GET"])
@require_admin
def admin_stats():
    totals = {}
    c = client_db()
    try:
        cur = c.cursor()
        cur.execute("SELECT COUNT(*) FROM client WHERE is_deleted=0")
        r = cur.fetchone()
        totals["total_clients"] = r[0] if r else 0
    finally:
        c.close()
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("SELECT COUNT(*) FROM freelancer WHERE is_deleted=0")
        r = cur.fetchone()
        totals["total_freelancers"] = r[0] if r else 0
        
        cur.execute("SELECT COUNT(*) FROM hire_request")
        r = cur.fetchone()
        totals["total_hire_requests"] = r[0] if r else 0
        
        cur.execute("SELECT COUNT(*) FROM message")
        r = cur.fetchone()
        totals["total_messages"] = r[0] if r else 0
        
        # New Stats
        cur.execute("SELECT COUNT(*) FROM audit_logs")
        r = cur.fetchone()
        totals["total_transactions"] = r[0] if r else 0
        
        cur.execute("SELECT SUM(transaction_amount) FROM audit_logs WHERE payment_status = 'Paid'")
        r = cur.fetchone()
        totals["total_revenue"] = float(r[0] or 0) if r else 0.0

        # Project Stats
        cur.execute("SELECT COUNT(*) FROM projects")
        totals["total_projects"] = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM projects WHERE status = 'IN_PROGRESS'")
        totals["active_projects"] = cur.fetchone()[0]
        
        cur.execute("SELECT COUNT(*) FROM projects WHERE status = 'COMPLETED'")
        totals["completed_projects"] = cur.fetchone()[0]

        # Email Stats
        cur.execute("SELECT COUNT(*) FROM email_logs WHERE status = 'Failed'")
        totals["failed_emails"] = cur.fetchone()[0]

        try:
            cur.execute("SELECT COUNT(*) FROM kyc_document WHERE status='PENDING'")
            r = cur.fetchone()
            totals["pending_kyc_documents"] = r[0] if r else 0
        except Exception:
            totals["pending_kyc_documents"] = 0
            
        try:
            cur.execute("SELECT COUNT(*) FROM freelancer_profile WHERE is_verified=1")
            r = cur.fetchone()
            totals["verified_freelancers"] = r[0] if r else 0
        except Exception:
            totals["verified_freelancers"] = 0
    finally:
        f.close()
    return jsonify({"success": True, "data": totals})

@admin_bp.route("/admin/clients", methods=["GET"])
@require_admin
def admin_clients():
    c = client_db()
    try:
        cur = c.cursor()
        # Join with project_post and payment_records to get stats
        cur.execute("""
            SELECT 
                c.id, c.name, c.email, COALESCE(c.auth_provider,'local'), 
                c.is_enabled, c.created_at,
                (SELECT COUNT(*) FROM project_post WHERE client_id = c.id) as total_projects,
                (SELECT SUM(amount) FROM payment_records WHERE hire_id IN (SELECT id FROM hire_request WHERE client_id = c.id) AND status = 'paid') as total_spent,
                cp.phone
            FROM client c
            LEFT JOIN client_profile cp ON cp.client_id = c.id
            WHERE c.is_deleted = 0
            ORDER BY c.id DESC
        """)
        rows = cur.fetchall()
        res = []
        for r in rows:
            res.append({
                "id": r[0], 
                "name": r[1], 
                "email": r[2], 
                "auth_provider": r[3],
                "status": "enabled" if r[4] == 1 else "disabled",
                "created_at": r[5],
                "total_projects": r[6] or 0,
                "total_spent": float(r[7] or 0),
                "phone": r[8] or "N/A",
                "role": "client"
            })
        return jsonify({"success": True, "results": res})
    finally:
        c.close()

@admin_bp.route("/admin/freelancers", methods=["GET"])
@require_admin
def admin_freelancers():
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("""
            SELECT 
                f.id, f.name, f.email, f.is_enabled, f.created_at,
                fp.category, fp.rating, fp.verification_status, fp.is_verified,
                fp.phone, fp.skills, fp.pricing_type, fp.hourly_rate, 
                fp.fixed_price, fp.starting_price, fp.per_person_rate
            FROM freelancer f
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE f.is_deleted = 0
            ORDER BY f.id DESC
        """)
        rows = cur.fetchall()
        res = []
        for r in rows:
            # Pricing display logic
            pricing = "N/A"
            ptype = r[11]
            if ptype == 'hourly': pricing = f"₹{r[12]}/hr"
            elif ptype == 'fixed': pricing = f"₹{r[13]}"
            elif ptype == 'package': pricing = f"₹{r[14]}"
            elif ptype == 'per_person': pricing = f"₹{r[15]}/person"

            res.append({
                "id": r[0], "name": r[1], "email": r[2],
                "status": "enabled" if r[3] == 1 else "disabled",
                "created_at": r[4],
                "category": r[5] or "N/A", 
                "rating": float(r[6] or 0),
                "verification_status": (r[7] or "NOT_SUBMITTED").lower(), 
                "is_verified": bool(r[8]),
                "phone": r[9] or "N/A",
                "skills": r[10] or "",
                "pricing": pricing,
                "role": "freelancer"
            })
        return jsonify({"success": True, "results": res})
    finally:
        f.close()

@admin_bp.route("/admin/audit-logs", methods=["GET"])
@require_admin
def admin_audit_logs():
    status_filter = request.args.get("status")
    search = request.args.get("search", "").strip().lower()
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        query = """
            SELECT 
                a.id, a.freelancer_id, a.client_id, a.transaction_amount, 
                a.payment_status, a.transaction_date, a.project_id, a.created_at,
                frel.name as freelancer_name, clnt.name as client_name
            FROM audit_logs a
            LEFT JOIN freelancer frel ON frel.id = a.freelancer_id
            LEFT JOIN client clnt ON clnt.id = a.client_id
            WHERE 1=1
        """
        params = []
        if status_filter:
            query += " AND a.payment_status = %s"
            params.append(status_filter)
        
        if search:
            query += " AND (LOWER(frel.name) LIKE %s OR LOWER(clnt.name) LIKE %s)"
            params.append(f"%{search}%")
            params.append(f"%{search}%")
            
        query += " ORDER BY a.created_at DESC"
        
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r[0],
                "freelancer_id": r[1],
                "client_id": r[2],
                "amount": float(r[3] or 0),
                "status": r[4],
                "date": r[5],
                "project_id": r[6],
                "created_at": r[7],
                "freelancer_name": r[8] or "Unknown",
                "client_name": r[9] or "Unknown"
            })
        return jsonify({"success": True, "results": out})
    finally:
        f.close()

def _audit(admin_id, action, payload):
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("INSERT INTO admin_audit_log (admin_id, action, payload_json, created_at) VALUES (%s,%s,%s,%s)",
                    (admin_id, action, json.dumps(payload), _now()))
        f.commit()
    finally:
        f.close()

@admin_bp.route("/admin/user/delete", methods=["POST"])
@require_admin
def admin_user_delete():
    d = request.get_json(silent=True) or {}
    role = str(d.get("role","")).strip().lower()
    uid = int(d.get("id", 0))
    if role not in ("client","freelancer") or uid <= 0:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    
    if role == "client":
        db = client_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE client SET is_deleted=1, is_enabled=0 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    else:
        db = freelancer_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE freelancer SET is_deleted=1, is_enabled=0 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    _audit(getattr(request, "admin_id", None), "user_delete", {"role": role, "id": uid})
    return jsonify({"success": True})

@admin_bp.route("/admin/user/edit", methods=["POST"])
@require_admin
def admin_user_edit():
    d = request.get_json(silent=True) or {}
    role = str(d.get("role","")).strip().lower()
    uid = int(d.get("id", 0))
    name = d.get("name")
    email = d.get("email")
    phone = d.get("phone")

    if role not in ("client","freelancer") or uid <= 0:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    
    if role == "client":
        db = client_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE client SET name=%s, email=%s WHERE id=%s", (name, email, uid))
            cur.execute("UPDATE client_profile SET phone=%s WHERE client_id=%s", (phone, uid))
            db.commit()
        finally:
            db.close()
    else:
        db = freelancer_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE freelancer SET name=%s, email=%s WHERE id=%s", (name, email, uid))
            cur.execute("UPDATE freelancer_profile SET phone=%s WHERE freelancer_id=%s", (phone, uid))
            db.commit()
        finally:
            db.close()
    _audit(getattr(request, "admin_id", None), "user_edit", {"role": role, "id": uid})
    return jsonify({"success": True})

@admin_bp.route("/admin/user/disable", methods=["POST"])
@require_admin
def admin_user_disable():
    d = request.get_json(silent=True) or {}
    role = str(d.get("role","")).strip().lower()
    uid = int(d.get("id", 0))
    if role not in ("client","freelancer") or uid <= 0:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    if role == "client":
        db = client_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE client SET is_enabled=0 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    else:
        db = freelancer_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE freelancer SET is_enabled=0 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    _audit(getattr(request, "admin_id", None), "user_disable", {"role": role, "id": uid})
    return jsonify({"success": True})

@admin_bp.route("/admin/user/enable", methods=["POST"])
@require_admin
def admin_user_enable():
    d = request.get_json(silent=True) or {}
    role = str(d.get("role","")).strip().lower()
    uid = int(d.get("id", 0))
    if role not in ("client","freelancer") or uid <= 0:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    if role == "client":
        db = client_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE client SET is_enabled=1 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    else:
        db = freelancer_db()
        try:
            cur = db.cursor()
            cur.execute("UPDATE freelancer SET is_enabled=1 WHERE id=%s", (uid,))
            db.commit()
        finally:
            db.close()
    _audit(getattr(request, "admin_id", None), "user_enable", {"role": role, "id": uid})
    return jsonify({"success": True})

@admin_bp.route("/admin/kyc/pending", methods=["GET"])
@require_admin
def admin_kyc_pending():
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("""
            SELECT k.id, k.freelancer_id, k.doc_type, k.uploaded_at,
                   frel.name, frel.email
            FROM kyc_document k
            JOIN freelancer frel ON frel.id = k.freelancer_id
            WHERE k.status='PENDING'
            ORDER BY k.uploaded_at DESC
        """)
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "doc_id": r[0],
                "freelancer_id": r[1],
                "doc_type": r[2],
                "uploaded_at": r[3],
                "freelancer_name": r[4],
                "freelancer_email": r[5],
            })
        return jsonify({"success": True, "results": out})
    finally:
        f.close()

@admin_bp.route("/admin/kyc/document/<int:doc_id>", methods=["GET"])
@require_admin
def admin_kyc_document(doc_id: int):
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("SELECT file_path FROM kyc_document WHERE id=%s", (doc_id,))
        r = cur.fetchone()
        if not r:
            return jsonify({"success": False, "msg": "Not found"}), 404
        path = r[0]
        if not os.path.isfile(path):
            return jsonify({"success": False, "msg": "Not found"}), 404
        return send_file(path, as_attachment=True)
    finally:
        f.close()

@admin_bp.route("/admin/kyc/verify", methods=["POST"])
@require_admin
def admin_kyc_verify():
    d = request.get_json(silent=True) or {}
    doc_id = int(d.get("doc_id", 0))
    action = str(d.get("action","")).strip().lower()
    reason = str(d.get("reason","")).strip()
    if doc_id <= 0 or action not in ("approve","reject"):
        return jsonify({"success": False, "msg": "Invalid"}), 400
    admin_id = getattr(request, "admin_id", None)
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("SELECT freelancer_id, doc_type FROM kyc_document WHERE id=%s", (doc_id,))
        r = cur.fetchone()
        if not r:
            return jsonify({"success": False, "msg": "Not found"}), 404
        fid, doc_type = r[0], r[1]
        if action == "approve":
            cur.execute("""
                UPDATE kyc_document
                SET status='APPROVED', verified_by_admin_id=%s, verified_at=%s
                WHERE id=%s
            """, (admin_id, _now(), doc_id))
            # Latest-approval check per type
            latest_ok = True
            for t in ("AADHAAR", "PAN"):
                cur.execute("""
                    SELECT status FROM kyc_document
                    WHERE freelancer_id=%s AND doc_type=%s
                    ORDER BY uploaded_at DESC, id DESC
                    LIMIT 1
                """, (fid, t))
                rr = cur.fetchone()
                if not rr or rr[0] != "APPROVED":
                    latest_ok = False
                    break
            if latest_ok:
                cur.execute("""
                    UPDATE freelancer_profile
                    SET verification_status='VERIFIED', is_verified=1, verification_note=''
                    WHERE freelancer_id=%s
                """, (fid,))
            else:
                cur.execute("""
                    UPDATE freelancer_profile
                    SET verification_status='PENDING', is_verified=0
                    WHERE freelancer_id=%s
                """, (fid,))
        else:
            cur.execute("""
                UPDATE kyc_document
                SET status='REJECTED', reject_reason=%s, verified_by_admin_id=%s, verified_at=%s
                WHERE id=%s
            """, (reason, admin_id, _now(), doc_id))
            cur.execute("""
                UPDATE freelancer_profile
                SET verification_status='REJECTED', is_verified=0, verification_note=%s
                WHERE freelancer_id=%s
            """, (reason, fid))
        f.commit()
        _audit(admin_id, "kyc_verify", {"doc_id": doc_id, "action": action, "reason": reason})
        return jsonify({"success": True})
    finally:
        f.close()

@admin_bp.route("/admin/logout", methods=["POST"])
@require_admin
def admin_logout():
    if not FEATURE_ADMIN_LOGOUT:
        return jsonify({"success": False, "msg": "disabled"}), 404
    token = request.headers.get("X-ADMIN-TOKEN", "").strip()
    admin_id = getattr(request, "admin_id", None)
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("DELETE FROM admin_session WHERE token=%s", (token,))
        f.commit()
        _audit(admin_id, "logout", {"token": "self"})
        return jsonify({"success": True})
    finally:
        f.close()

@admin_bp.route("/admin/logout_all", methods=["POST"])
@require_admin
def admin_logout_all():
    if not FEATURE_ADMIN_LOGOUT:
        return jsonify({"success": False, "msg": "disabled"}), 404
    admin_id = getattr(request, "admin_id", None)
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("DELETE FROM admin_session WHERE admin_id=%s", (admin_id,))
        f.commit()
        _audit(admin_id, "logout_all", {"admin_id": admin_id})
        return jsonify({"success": True})
    finally:
        f.close()

@admin_bp.route("/admin/kyc/cleanup", methods=["POST"])
@require_admin
def admin_kyc_cleanup():
    if not FEATURE_KYC_RETENTION_CLEANUP:
        return jsonify({"success": False, "msg": "disabled"}), 404
    cutoff = _now() - 30 * 24 * 3600
    f = freelancer_db()
    removed_files = 0
    removed_rows = 0
    try:
        cur = f.cursor()
        cur.execute("""
            SELECT id, file_path FROM kyc_document
            WHERE uploaded_at < %s AND status IN ('PENDING','REJECTED')
        """, (cutoff,))
        rows = cur.fetchall()
        for r in rows:
            path = r[1]
            try:
                if path and os.path.isfile(path):
                    os.remove(path)
                    removed_files += 1
            except Exception:
                pass
            cur.execute("DELETE FROM kyc_document WHERE id=%s", (r[0],))
            removed_rows += 1
        f.commit()
        _audit(getattr(request, "admin_id", None), "kyc_cleanup", {"removed_rows": removed_rows, "removed_files": removed_files})
        return jsonify({"success": True, "removed_rows": removed_rows, "removed_files": removed_files})
    finally:
        f.close()

@admin_bp.route("/admin/client-kyc/pending", methods=["GET"])
@require_admin
def admin_client_kyc_pending():
    """Get all pending client KYC submissions"""
    pending_kyc = get_pending_client_kyc()
    return jsonify({"success": True, "data": pending_kyc})

@admin_bp.route("/admin/client-kyc/review", methods=["POST"])
@require_admin
def admin_client_kyc_review():
    """Review client KYC submission (approve/reject)"""
    d = request.get_json(silent=True) or {}
    client_id = d.get("client_id")
    status = d.get("status")  # APPROVED or REJECTED
    
    if not client_id or status not in ("APPROVED", "REJECTED"):
        return jsonify({"success": False, "msg": "Invalid request"}), 400
    
    admin_id = getattr(request, "admin_id", None)
    if update_client_kyc_review(client_id, status, admin_id):
        _audit(admin_id, "client_kyc_review", {
            "client_id": client_id, 
            "status": status
        })
        return jsonify({"success": True, "msg": f"Client KYC {status.lower()}"})
    else:
        return jsonify({"success": False, "msg": "Failed to update status"}), 500

# ============================================================
# PROJECT MANAGEMENT
# ============================================================

@admin_bp.route("/admin/projects", methods=["GET"])
@require_admin
def admin_projects():
    status = request.args.get("status")
    search = request.args.get("search", "").strip().lower()
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        query = """
            SELECT p.id, p.title, p.status, p.agreed_price, p.start_date, p.end_date,
                   c.name as client_name, frel.name as freelancer_name,
                   p.hire_id
            FROM projects p
            LEFT JOIN client c ON c.id = p.client_id
            LEFT JOIN freelancer frel ON frel.id = p.freelancer_id
            WHERE 1=1
        """
        params = []
        if status:
            query += " AND p.status = %s"
            params.append(status)
        if search:
            query += " AND (LOWER(p.title) LIKE %s OR LOWER(c.name) LIKE %s OR LOWER(frel.name) LIKE %s)"
            s = f"%{search}%"
            params.extend([s, s, s])
            
        query += " ORDER BY p.id DESC"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        
        res = []
        for r in rows:
            res.append({
                "id": r[0], "title": r[1], "status": r[2],
                "agreed_price": r[3], "start_date": r[4], "end_date": r[5],
                "client_name": r[6], "freelancer_name": r[7], "hire_id": r[8]
            })
        return jsonify({"success": True, "results": res})
    finally:
        f.close()

@admin_bp.route("/admin/project/update", methods=["POST"])
@require_admin
def admin_project_update():
    d = request.get_json(silent=True) or {}
    pid = d.get("id")
    status = d.get("status")
    if not pid or not status:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("UPDATE projects SET status=%s WHERE id=%s", (status, pid))
        f.commit()
        _audit(getattr(request, "admin_id", None), "project_update", {"id": pid, "status": status})
        return jsonify({"success": True})
    finally:
        f.close()

# ============================================================
# PAYMENT MONITORING
# ============================================================

@admin_bp.route("/admin/payments", methods=["GET"])
@require_admin
def admin_payments():
    status_filter = request.args.get("status", "").strip().lower()
    search = request.args.get("search", "").strip().lower()

    f = freelancer_db()
    try:
        cur = f.cursor()
        query = """
            SELECT
                pr.payment_id,
                pr.hire_id,
                pr.razorpay_order_id,
                pr.razorpay_payment_id,
                pr.amount,
                pr.currency,
                pr.status,
                pr.created_at,
                hr.job_title,
                hr.client_id,
                hr.freelancer_id,
                hr.payment_status,
                c.name AS client_name,
                frel.name AS freelancer_name
            FROM payment_records pr
            LEFT JOIN hire_request hr ON hr.id = pr.hire_id
            LEFT JOIN client c ON c.id = hr.client_id
            LEFT JOIN freelancer frel ON frel.id = hr.freelancer_id
            WHERE pr.record_type = 'hire'
        """
        params = []

        if status_filter:
            query += " AND LOWER(COALESCE(hr.payment_status, pr.status, '')) = %s"
            params.append(status_filter)

        if search:
            query += """
                AND (
                    LOWER(COALESCE(c.name, '')) LIKE %s
                    OR LOWER(COALESCE(frel.name, '')) LIKE %s
                    OR LOWER(COALESCE(hr.job_title, '')) LIKE %s
                    OR CAST(pr.payment_id AS TEXT) LIKE %s
                    OR LOWER(COALESCE(pr.razorpay_payment_id, '')) LIKE %s
                    OR LOWER(COALESCE(pr.razorpay_order_id, '')) LIKE %s
                )
            """
            like_value = f"%{search}%"
            params.extend([like_value, like_value, like_value, like_value, like_value, like_value])

        query += " ORDER BY pr.created_at DESC, pr.payment_id DESC"

        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        out = []
        for r in rows:
            raw_status = r[11] or r[6] or "pending"
            normalized_status = str(raw_status).strip().lower()
            if normalized_status == "success":
                normalized_status = "paid"
            elif normalized_status == "created":
                normalized_status = "pending"

            out.append({
                "id": r[0],
                "hire_id": r[1],
                "razorpay_order_id": r[2],
                "razorpay_payment_id": r[3],
                "amount": float(r[4] or 0),
                "currency": r[5] or "INR",
                "status": normalized_status.title(),
                "date": r[7],
                "created_at": r[7],
                "project_id": r[1],
                "project_title": r[8] or "Gig Payment",
                "client_id": r[9],
                "freelancer_id": r[10],
                "client_name": r[12] or "Unknown",
                "freelancer_name": r[13] or "Unknown",
            })

        return jsonify({"success": True, "results": out})
    finally:
        f.close()

@admin_bp.route("/admin/payment/override", methods=["POST"])
@require_admin
def admin_payment_override():
    d = request.get_json(silent=True) or {}
    aid = d.get("id") # audit_log id
    status = d.get("status")
    if not aid or not status:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("UPDATE audit_logs SET payment_status=%s WHERE id=%s", (status, aid))
        f.commit()
        _audit(getattr(request, "admin_id", None), "payment_override", {"id": aid, "status": status})
        return jsonify({"success": True})
    finally:
        f.close()

# ============================================================
# EMAIL LOGS
# ============================================================

@admin_bp.route("/admin/email-logs", methods=["GET"])
@require_admin
def admin_email_logs():
    status = request.args.get("status")
    search = request.args.get("search", "").strip().lower()
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        query = "SELECT id, to_email, subject, status, related_project_id, created_at, error_message, body_text FROM email_logs WHERE 1=1"
        params = []
        if status:
            query += " AND status = %s"
            params.append(status)
        if search:
            query += " AND (LOWER(to_email) LIKE %s OR LOWER(subject) LIKE %s)"
            s = f"%{search}%"
            params.extend([s, s])
            
        query += " ORDER BY created_at DESC LIMIT 100"
        cur.execute(query, tuple(params))
        rows = cur.fetchall()
        
        res = []
        for r in rows:
            res.append({
                "id": r[0], "to_email": r[1], "subject": r[2], "status": r[3],
                "project_id": r[4], "created_at": r[5], "error_message": r[6],
                "body": r[7]
            })
        return jsonify({"success": True, "results": res})
    finally:
        f.close()

@admin_bp.route("/admin/email/retry", methods=["POST"])
@require_admin
def admin_email_retry():
    from app import send_email # Circular import risk, but let's see
    d = request.get_json(silent=True) or {}
    eid = d.get("id")
    if not eid:
        return jsonify({"success": False, "msg": "Invalid"}), 400
    
    f = freelancer_db()
    try:
        cur = f.cursor()
        cur.execute("SELECT to_email, subject, body_text, related_project_id FROM email_logs WHERE id=%s", (eid,))
        r = cur.fetchone()
        if not r:
            return jsonify({"success": False, "msg": "Log not found"}), 404
        
        # Try re-sending
        from app import send_email
        success = send_email(r[0], r[1], r[2], related_project_id=r[3])
        if success:
            cur.execute("UPDATE email_logs SET status='Sent', error_message=NULL WHERE id=%s", (eid,))
            f.commit()
            return jsonify({"success": True})
        else:
            return jsonify({"success": False, "msg": "Retry failed again"})
    finally:
        f.close()
