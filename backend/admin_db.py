import time
import os
from database import freelancer_db, client_db, _try_add_column, get_dict_cursor

def admin_db():
    """Alias for freelancer_db since admin tables are there."""
    return freelancer_db()

def ensure_admin_tables():
    conn = freelancer_db()
    cur = conn.cursor()
    
    # Admin System Tables
    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_user (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        is_enabled INTEGER DEFAULT 1,
        created_at INTEGER
    )
    """)
    # Default Admin User (admin123)
    cur.execute("SELECT id FROM admin_user WHERE email=%s", ("admin@gigbridge.com",))
    if not cur.fetchone():
        pwd_hash = "scrypt:32768:8:1$eSKlzODusyql3yfz$d374d6787eaf2f590dae6ee3fb3c3790f2bd893500ed19de51dd55b4472ab84b34b369a61408b2daaff9380592a300e77cbd53d07df10447a93596ea1d695517"
        cur.execute("""
            INSERT INTO admin_user (email, password_hash, role, is_enabled, created_at)
            VALUES (%s, %s, 'admin', 1, %s)
        """, ("admin@gigbridge.com", pwd_hash, int(time.time())))

    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_session (
        token TEXT PRIMARY KEY,
        admin_id INTEGER,
        expires_at INTEGER,
        created_at INTEGER
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER,
        action TEXT,
        payload_json TEXT,
        created_at INTEGER
    )
    """)
    
    # Financial Audit Logs (Transaction Tracking)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        freelancer_id INTEGER,
        client_id INTEGER,
        transaction_amount REAL,
        payment_status TEXT, -- 'Paid', 'Unpaid', 'Pending'
        transaction_date INTEGER,
        project_id INTEGER,
        created_at INTEGER
    )
    """)

    # Email Logs
    cur.execute("""
    CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        to_email TEXT,
        subject TEXT,
        body_text TEXT,
        status TEXT DEFAULT 'Sent', -- 'Sent', 'Failed'
        related_project_id INTEGER,
        error_message TEXT,
        created_at INTEGER
    )
    """)

    # KYC Documents (If not in database.py)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS kyc_document (
        id SERIAL PRIMARY KEY,
        freelancer_id INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        reject_reason TEXT,
        verified_by_admin_id INTEGER,
        verified_at INTEGER,
        uploaded_at INTEGER
    )
    """)

    # Payment Records (If not in database.py)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payment_records (
        payment_id SERIAL PRIMARY KEY,
        hire_id INTEGER,
        subscription_id INTEGER,
        record_type TEXT NOT NULL DEFAULT 'hire',
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER
    )
    """)

    # Payout Details
    cur.execute("""
    CREATE TABLE IF NOT EXISTS payout_details (
        id SERIAL PRIMARY KEY,
        freelancer_id INTEGER NOT NULL,
        payout_method TEXT NOT NULL,
        account_holder_name TEXT,
        account_number TEXT,
        ifsc_code TEXT,
        upi_id TEXT,
        razorpay_contact_id TEXT,
        razorpay_fund_account_id TEXT,
        created_at INTEGER
    )
    """)

    # Admin Alerts
    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_alerts (
        id SERIAL PRIMARY KEY,
        alert_type TEXT, -- 'PAYMENT_DELAY', 'DEADLINE_MISSED', 'EMAIL_FAILURE', 'HIGH_VALUE'
        message TEXT,
        related_id INTEGER,
        is_resolved INTEGER DEFAULT 0,
        created_at INTEGER
    )
    """)
    
    # Try adding missing columns to existing tables
    _try_add_column(cur, "freelancer_profile", "verification_status TEXT DEFAULT 'NOT_SUBMITTED'")
    _try_add_column(cur, "freelancer_profile", "is_verified INTEGER DEFAULT 0")
    _try_add_column(cur, "freelancer_profile", "verification_note TEXT DEFAULT ''")
    conn.commit()
    conn.close()
    
    c = client_db()
    ccur = c.cursor()
    _try_add_column(ccur, "client", "is_enabled INTEGER DEFAULT 1")
    _try_add_column(ccur, "client", "is_deleted INTEGER DEFAULT 0")
    _try_add_column(ccur, "client", "created_at INTEGER")
    c.commit()
    c.close()
    
    f = freelancer_db()
    fcur = f.cursor()
    _try_add_column(fcur, "freelancer", "is_enabled INTEGER DEFAULT 1")
    _try_add_column(fcur, "freelancer", "is_deleted INTEGER DEFAULT 0")
    _try_add_column(fcur, "freelancer", "created_at INTEGER")
    f.commit()
    f.close()

    # Backfill created_at if missing
    for db_func, table in [(client_db, "client"), (freelancer_db, "freelancer")]:
        conn = db_func()
        cur = conn.cursor()
        cur.execute(f"UPDATE {table} SET created_at = %s WHERE created_at IS NULL", (int(time.time()),))
        conn.commit()
        conn.close()

def log_transaction(freelancer_id, client_id, amount, status, project_id=None):
    """Logs a financial transaction for the admin audit log."""
    conn = admin_db()
    try:
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("""
            INSERT INTO audit_logs (freelancer_id, client_id, transaction_amount, payment_status, transaction_date, project_id, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (freelancer_id, client_id, amount, status, now, project_id, now))
        conn.commit()
        
        # High value alert (e.g. > 50,000)
        if amount and float(amount) >= 50000:
            log_admin_alert('HIGH_VALUE', f"High value transaction of ₹{amount} detected.", related_id=project_id)
            
    except Exception as e:
        print(f"[ADMIN_LOG] Error logging transaction: {e}")
        conn.rollback()
    finally:
        conn.close()

def log_email(to_email, subject, body_text, status='Sent', project_id=None, error_msg=None):
    """Logs an email communication."""
    conn = admin_db()
    try:
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("""
            INSERT INTO email_logs (to_email, subject, body_text, status, related_project_id, error_message, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (to_email, subject, body_text, status, project_id, error_msg, now))
        conn.commit()
    except Exception as e:
        print(f"[ADMIN_LOG] Error logging email: {e}")
        conn.rollback()
    finally:
        conn.close()

def log_admin_alert(alert_type, message, related_id=None):
    """Logs an alert for the admin dashboard."""
    conn = admin_db()
    try:
        cur = conn.cursor()
        now = int(time.time())
        cur.execute("""
            INSERT INTO admin_alerts (alert_type, message, related_id, created_at)
            VALUES (%s, %s, %s, %s)
        """, (alert_type, message, related_id, now))
        conn.commit()
        
        # Emit socket event for real-time admin notification
        try:
            from socket_service import socketio
            if socketio:
                socketio.emit("adminAlert", {
                    "type": alert_type,
                    "message": message,
                    "related_id": related_id
                }, room="admins")
        except Exception:
            pass
            
    except Exception as e:
        print(f"[ADMIN_LOG] Error logging admin alert: {e}")
        conn.rollback()
    finally:
        conn.close()
