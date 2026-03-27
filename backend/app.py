import psycopg2
import psycopg2.errors
from datetime import datetime
from html import escape
from flask import Flask, request, jsonify, send_from_directory, redirect
from database import client_db, freelancer_db, mark_job_completed
from psycopg2.extras import RealDictCursor
from postgres_config import get_postgres_connection, get_dict_cursor
from booking_service import validate_hire_request_slot, format_time_slot_display
import random
import time
import smtplib
import os
import requests
import secrets
from rapidfuzz import fuzz
import urllib.parse
import shutil
from email.message import EmailMessage
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from admin_db import ensure_admin_tables, log_email, log_admin_alert, admin_db, log_transaction
from admin_routes import admin_bp
from kyc_routes import kyc_bp
from client_kyc_routes import client_kyc_bp
from payment_routes import payment_bp
from ticket_routes import ticket_bp
import logging
from flask_cors import CORS
app = Flask(_name_)

CORS(app, origins=[
    "https://antigravitygig.netlify.app/"
])

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
file_handler = logging.FileHandler('persistent_error_log.txt', mode='w', encoding='utf-8')
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logger.addHandler(file_handler)

# Also add to werkzeug logger
logging.getLogger('werkzeug').addHandler(file_handler)

# Initialize Socket.IO
try:
    from socket_service import socketio
    SOCKET_IO_ENABLED = True
    print('[SOCKET] Socket.IO initialized successfully')
except ImportError as e:
    print(f'[SOCKET] Socket.IO import failed: {e}')
    socketio = None
    SOCKET_IO_ENABLED = False
except Exception as e:
    print(f'[SOCKET] Socket.IO initialization failed: {e}')
    socketio = None
    SOCKET_IO_ENABLED = False

SOCKET_IO_REALLY_WORKING = False

try:
    # AI chat routes are optional; failure must not block server startup.
    from ai_chat_routes import register_ai_chat_routes
except Exception as _e:
    register_ai_chat_routes = None
    logger.warning(f"AI chat disabled: {type(_e).__name__}: {_e}")
    import logging
    logging.getLogger(__name__).warning(f"AI chat disabled: {type(_e).__name__}: {_e}")

from database import create_tables, rebuild_freelancer_search_index
from venue_helper import prepare_venue_data, validate_venue_data, check_venue_freelancer_compatibility
from settings import (
    FEATURE_HIDE_UNVERIFIED_FROM_SEARCH,
    FEATURE_BLOCK_DISABLED_USERS,
    FEATURE_ENFORCE_VERIFIED_FOR_HIRE_MESSAGE,
)
from categories import (
    is_valid_category,
    get_pricing_type_for_category,
    PRICING_TYPE_HOURLY,
    PRICING_TYPE_PER_PERSON,
    PRICING_TYPE_PACKAGE,
    PRICING_TYPE_PROJECT,
)
from call_service import start_call, update_call_status, get_incoming_calls
from notification_utils import enhance_notification_message, get_notification_icon
from notification_helper import notify_freelancer


# ============================================================
# PRICING DISPLAY HELPER FUNCTIONS
# ============================================================

def get_price_display(freelancer):
    """Get formatted price display based on pricing type"""
    pricing_type = (freelancer.get("pricing_type") or "").lower()
    
    if pricing_type == "hourly":
        return f"₹{freelancer.get('hourly_rate', 0)} / hour"
    
    elif pricing_type == "per_person":
        return f"₹{freelancer.get('per_person_rate', 0)} per person"
    
    elif pricing_type == "package":
        return f"₹{freelancer.get('starting_price', 0)}"
    
    elif pricing_type == "project":
        return f"₹{freelancer.get('fixed_price', 0)} (project)"
    
    return "Not specified"

def enhance_freelancer_with_pricing(freelancer):
    """Enhance freelancer data with pricing display fields"""
    pricing_type = freelancer.get("pricing_type")
    
    # Map raw fields to generic 'price' field
    type_val = (pricing_type or "").lower()
    if type_val == "hourly":
        freelancer["price"] = freelancer.get("hourly_rate", 0)
    elif type_val == "per_person":
        freelancer["price"] = freelancer.get("per_person_rate", 0)
    elif type_val == "package":
        freelancer["price"] = freelancer.get("starting_price", 0)
    elif type_val in ["fixed", "project"]:
        freelancer["price"] = freelancer.get("fixed_price", 0)
    else:
        # Fallback to any filled column
        freelancer["price"] = (
            freelancer.get("hourly_rate") or 
            freelancer.get("per_person_rate") or 
            freelancer.get("fixed_price") or 
            freelancer.get("starting_price") or 0
        )
        
    category = freelancer.get("category")
    
    if not pricing_type:
        try:
            pricing_type = get_pricing_type_for_category(category)
        except:
            pricing_type = "unknown"
    
    # Ensure pricing_type is set
    freelancer["pricing_type"] = pricing_type
    
    # Add price display fields
    freelancer["price_display"] = get_price_display(freelancer)
    freelancer["price_label"] = {
        "hourly": "Hourly Rate",
        "per_person": "Per Person Rate", 
        "package": "Starting Price",
        "project": "Project Price",
        "fixed": "Fixed Price"
    }.get(pricing_type, "Price")
    
    return freelancer


def _get_public_platform_stats():
    """Reuse existing aggregate-style admin metrics for public landing stats."""
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute("SELECT COUNT(*) AS total_freelancers FROM freelancer")
        artists_row = cur.fetchone() or {}

        cur.execute("SELECT COUNT(*) AS total_completed_projects FROM projects WHERE status='COMPLETED'")
        projects_row = cur.fetchone() or {}

        cur.execute("""
            SELECT AVG(rating) AS average_rating
            FROM freelancer_profile
            WHERE rating IS NOT NULL AND rating > 0
        """)
        rating_row = cur.fetchone() or {}

        return {
            "total_artists": int(artists_row.get("total_freelancers") or 0),
            "total_projects_completed": int(projects_row.get("total_completed_projects") or 0),
            "average_rating": round(float(rating_row.get("average_rating") or 0), 1),
        }
    finally:
        conn.close()


# ============================================================
# AGE VALIDATION UTILITIES
# ============================================================

def calculate_age(dob_str):
    """Calculate age from DOB string in YYYY-MM-DD format"""
    from datetime import datetime
    try:
        dob_date = datetime.strptime(dob_str, "%Y-%m-%d").date()
        today = datetime.now().date()
        age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day))
        return age
    except ValueError:
        return None


def validate_age(age):
    """Validate age is between 18 and 60 years inclusive"""
    if age < 18:
        return False, "User must be at least 18 years old."
    if age > 60:
        return False, "Maximum allowed age is 60 years."
    return True, None


# ============================================================
# Semantic (RAG-style) search helpers
from semantic_search import load_or_build, semantic_search, upsert_freelancer
from filters_service import fetch_filtered_freelancers
from database import create_tables, rebuild_freelancer_search_index, get_freelancer_verification, update_freelancer_verification, get_freelancer_subscription, update_freelancer_subscription, get_freelancer_job_applies, increment_job_applies, check_subscription_expiry, get_freelancer_plan
from categories import get_pricing_type_for_category, is_valid_category


# ============================================================
# APP INIT
# ============================================================

from flask_cors import CORS
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
app.config["JSONIFY_MIMETYPE"] = "application/json"
if hasattr(app, "json") and hasattr(app.json, "ensure_ascii"):
    app.json.ensure_ascii = False
# Configure CORS - support local dev and optional production frontend URL
allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    allowed_origins.append(frontend_url)

CORS(
    app,
    resources={r"/*": {"origins": allowed_origins}},
    supports_credentials=True,
)

@app.route("/api/public/platform-stats", methods=["GET"])
def public_platform_stats():
    try:
        data = _get_public_platform_stats()
        return jsonify({"success": True, "data": data})
    except Exception as e:
        logger.error(f"Error fetching public platform stats: {e}")
        return jsonify({
            "success": False,
            "data": {
                "total_artists": 0,
                "total_projects_completed": 0,
                "average_rating": 0.0,
            }
        }), 500


@app.route("/stats", methods=["GET"])
def landing_stats():
    """
    Backward-compatible stats endpoint used by older frontend calls.
    """
    try:
        data = _get_public_platform_stats()
        return jsonify({
            "total_artists": data["total_artists"],
            "completed_projects": data["total_projects_completed"],
            "avg_rating": data["average_rating"],
        })
    except Exception as e:
        logger.error(f"Error fetching landing stats: {e}")
        return jsonify({
            "total_artists": 0,
            "completed_projects": 0,
            "avg_rating": 0,
        }), 500

@app.errorhandler(Exception)
def handle_exception(e):
    # Log the traceback
    logger.exception(f"Unhandled Exception: {e}")
    return jsonify({"success": False, "msg": "Server error occurred"}), 500

# Initialize Socket.IO with the Flask app
if SOCKET_IO_ENABLED and socketio is not None:
    socketio.init_app(app, cors_allowed_origins="*")
    logger.info('[SOCKET] Socket.IO initialized with Flask app')

# ============================================================
# VERBOSE LOGGING FOR DEBUGGING
# ============================================================
@app.before_request
def log_request_info():
    if request.path.startswith('/static') or request.path == '/favicon.ico':
        return
    logger.info(f"\n{'='*20} INCOMING REQUEST {'='*20}")
    logger.info(f"{request.method} {request.path}")
    if request.is_json:
        try:
            logger.info(f"Payload: {request.get_json(silent=True)}")
        except Exception:
            pass
    elif request.form:
        logger.info(f"Form Data: {dict(request.form)}")
    logger.info(f"{'='*58}")

@app.after_request
def log_response_info(response):
    if response.mimetype == "application/json":
        response.headers["Content-Type"] = "application/json; charset=utf-8"
    if request.path.startswith('/static') or request.path == '/favicon.ico':
        return response
    logger.info(f"\n{'='*20} OUTGOING RESPONSE {'='*19}")
    logger.info(f"Status: {response.status}")
    if response.is_json:
        try:
            resp_str = str(response.get_json())
            if len(resp_str) > 1000:
                resp_str = resp_str[:1000] + " ... [TRUNCATED]"
            logger.info(f"Response: {resp_str}")
        except Exception:
            pass
    logger.info(f"{'='*58}\n")
    return response

# ============================================================
# GLOBAL ERROR HANDLERS - ENSURE JSON RESPONSES
# ============================================================

@app.errorhandler(400)
def bad_request(error):
    return jsonify({"success": False, "msg": "Bad request"}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({"success": False, "msg": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"success": False, "msg": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(error):
    import traceback
    err_tb = traceback.format_exc()
    logger.error(f"500 Internal Error: {err_tb}")
    return jsonify({
        "success": False, 
        "msg": "Internal server error", 
        "error": str(error),
        "traceback": err_tb
    }), 500

@app.errorhandler(Exception)
def handle_exception(error):
    import traceback
    err_tb = traceback.format_exc()
    logger.error(f"Unhandled exception: {err_tb}")
    
    # Return user-friendly error with traceback (STRICTLY FOR DEBUGGING)
    return jsonify({
        "success": False, 
        "msg": "Server error occurred"
    }), 500

# Table creation moved to main block to prevent startup hangs
# create_tables()
# ensure_admin_tables()

# ============================================================
# STARTUP VALIDATION
# ============================================================

def validate_startup():
    """Validate database connectivity and required tables"""
    try:
        # Test client database
        client_conn = client_db()
        client_cur = get_dict_cursor(client_conn)
        client_cur.execute("SELECT 1")
        client_conn.close()
        
        # Test freelancer database
        freelancer_conn = freelancer_db()
        freelancer_cur = get_dict_cursor(freelancer_conn)
        freelancer_cur.execute("SELECT 1")
        freelancer_conn.close()
        
        # Check required tables exist
        conn = client_db()
        cur = get_dict_cursor(conn)
        
        tables_to_check = ['client', 'client_otp', 'freelancer', 'freelancer_otp']
        for table in tables_to_check:
            try:
                cur.execute(f"SELECT 1 FROM {table} LIMIT 1")
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"Table '{table}' validation failed: {str(e)}")
        
        conn.close()
        
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Startup validation failed: {str(e)}", exc_info=True)

# Startup validation moved to main block
# validate_startup()

from security import security_middleware, security_request_logging
from admin_routes import admin_bp # Assuming admin_routes is imported here or earlier

app.config['SECRET_KEY'] = 'dev-secret-key'

# Apply security middleware (CORS, JWT, Rate Limiting, etc.)
jwt = security_middleware(app)

# Register request logging
security_request_logging(app)

# Register blueprints
app.register_blueprint(admin_bp)
app.register_blueprint(kyc_bp)
app.register_blueprint(client_kyc_bp)
app.register_blueprint(payment_bp)
app.register_blueprint(ticket_bp)

# Register database chat routes


# Try to load semantic index (optional; app still works without it)
def init_semantic_search():
    try:
        load_or_build()
    except Exception as _e:
        import logging
        logging.getLogger(__name__).warning(f"Semantic index not loaded: {_e}")

# init_semantic_search() # Called later in main thread or main block

# ============================================================
# AGENT: PENDING ACTION MEMORY
# ============================================================

# ============================================================
# EMAIL CONFIG
# ============================================================

SENDER_EMAIL = os.getenv("GIGBRIDGE_SENDER_EMAIL", "gigbridgee@gmail.com")
APP_PASSWORD = os.getenv("GIGBRIDGE_APP_PASSWORD", "tvtplklbvcnrwmzt")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
EMAIL_LOGO_URL = os.getenv("EMAIL_LOGO_URL", f"{FRONTEND_BASE_URL}/assets/gigbridgelogo.png")

# ============================================================
# OTP CONFIG
# ============================================================

OTP_TTL_SECONDS = 5 * 60  # 5 minutes

# ============================================================
# GOOGLE OAUTH CONFIG (ADDED - DOES NOT CHANGE EXISTING LOGIC)
# ============================================================

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Google Redirect URI: prioritize explicit env var, then derive from BACKEND_URL, else fallback to localhost
backend_url = os.getenv("BACKEND_URL", "http://127.0.0.1:5000").rstrip("/")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", f"{backend_url}/auth/google/callback")

# state -> { role, created_at, done, result }
GOOGLE_OAUTH_STATES = {}

def _google_state_cleanup():
    now = now_ts()
    expired = []
    for k, v in GOOGLE_OAUTH_STATES.items():
        if now - int(v.get("created_at", now)) > 10 * 60:  # 10 minutes
            expired.append(k)
    for k in expired:
        GOOGLE_OAUTH_STATES.pop(k, None)


def _google_frontend_callback_url(params):
    base = (FRONTEND_BASE_URL or "http://localhost:5173").rstrip("/")
    query = urllib.parse.urlencode(params)
    return f"{base}/auth/callback?{query}"


def _get_google_profile_completed(role, user_id):
    conn = None
    try:
        conn = client_db() if role == "client" else freelancer_db()
        cur = get_dict_cursor(conn)
        if role == "client":
            cur.execute("SELECT 1 FROM client_profile WHERE client_id=%s", (user_id,))
        else:
            cur.execute("SELECT 1 FROM freelancer_profile WHERE freelancer_id=%s", (user_id,))
        return cur.fetchone() is not None
    except Exception as e:
        logger.warning(f"Failed to check Google profile completion for {role} {user_id}: {e}")
        return False
    finally:
        if conn:
            conn.close()

def fuzzy_score(query: str, text: str) -> int:
    # token_set_ratio is very good for search-like matching
    return fuzz.token_set_ratio(query or "", text or "")        


# ============================================================
# HELPERS
# ============================================================

def now_ts():
    return int(time.time())

def get_json():
    return request.get_json(silent=True) or {}

def require_fields(data, fields):
    return [f for f in fields if f not in data or str(data[f]).strip() == ""]

def create_project(hire_id):
    """
    Creates a new project record from an accepted hire request.
    This is called when either a freelancer or client accepts the final offer.
    """
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # Pull the hire request details
        cur.execute("""
            SELECT id, client_id, freelancer_id, job_title, final_agreed_amount, proposed_budget,
                   pricing_type, event_date, start_time, end_time
            FROM hire_request WHERE id = %s
        """, (hire_id,))
        hire = cur.fetchone()
        
        if not hire:
            conn.close()
            return False, "Hire request not found"
            
        # Determine the price (final_agreed_amount if negotiated, else proposed_budget)
        agreed_price = hire.get("final_agreed_amount") or hire.get("proposed_budget") or 0
        
        # Check if project already exists for this hire_id
        cur.execute("SELECT id FROM projects WHERE hire_id = %s", (hire_id,))
        if cur.fetchone():
            conn.close()
            return True, "Project already exists"
            
        # Insert the project
        cur.execute("""
            INSERT INTO projects (
                hire_id, client_id, freelancer_id, title, agreed_price,
                pricing_type, start_date, start_time, end_date, end_time, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ACCEPTED')
            RETURNING id
        """, (
            hire["id"], hire["client_id"], hire["freelancer_id"], hire["job_title"],
            agreed_price, hire["pricing_type"], hire["event_date"], hire["start_time"],
            hire["event_date"], hire["end_time"], 
        ))
        
        project_id = cur.fetchone()["id"]
        
        conn.commit()
        conn.close()
        
        # Emit real-time event
        try:
            from notification_helper import notify_client, notify_freelancer
            
            # Notify client
            notify_client(
                client_id=hire["client_id"],
                message=f"Project '{hire['job_title']}' has been created and is now tracking progress.",
                title="Project Created",
                related_entity_type="project",
                related_entity_id=project_id
            )
            
            # Notify freelancer
            notify_freelancer(
                freelancer_id=hire["freelancer_id"],
                message=f"A new project record for '{hire['job_title']}' has been created.",
                title="Project Created",
                related_entity_type="project",
                related_entity_id=project_id
            )

            from socket_service import socketio
            if socketio:
                socketio.emit("projectCreated", {
                    "project_id": project_id,
                    "hire_id": hire["id"],
                    "client_id": hire["client_id"],
                    "freelancer_id": hire["freelancer_id"],
                    "title": hire["job_title"]
                }, room=f"user_{hire['client_id']}")
                socketio.emit("projectCreated", {
                    "project_id": project_id,
                    "hire_id": hire["id"],
                    "client_id": hire["client_id"],
                    "freelancer_id": hire["freelancer_id"],
                    "title": hire["job_title"]
                }, room=f"user_{hire['freelancer_id']}")
        except Exception as se:
            print(f"Socket emit failed: {se}")
            
        return True, "Project created successfully"
    except Exception as e:
        print(f"Error creating project: {e}")
        return False, str(e)

def valid_email(email):
    email = (email or "").strip()
    return ("@" in email) and ("." in email)

def validate_input(value, max_length, field_name):
    """Validate input length and content"""
    if value is None:
        return None, f"{field_name} is required"
    
    value_str = str(value).strip()
    if not value_str:
        return None, f"{field_name} cannot be empty"
    
    if len(value_str) > max_length:
        return None, f"{field_name} cannot exceed {max_length} characters"
    
    # Basic sanitization - remove potential script tags
    value_str = value_str.replace('<script>', '').replace('</script>', '')
    value_str = value_str.replace('<', '&lt;').replace('>', '&gt;')
    
    return value_str, None

def check_project_status_transitions():
    """
    Checks projects in 'ACCEPTED' state and moves them to 'IN_PROGRESS'
    if the start_date has been reached.
    """
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # Get all ACCEPTED projects that should be IN_PROGRESS
        cur.execute("""
            SELECT id, hire_id, client_id, freelancer_id, title, start_date
            FROM projects 
            WHERE status = 'ACCEPTED' AND start_date <= %s
        """, (today,))
        
        to_move = cur.fetchall()
        
        for p in to_move:
            cur.execute("UPDATE projects SET status = 'IN_PROGRESS' WHERE id = %s", (p["id"],))
            
            # Emit socket events
            try:
                if socketio:
                    socketio.emit("projectStatusChanged", {
                        "project_id": p["id"],
                        "status": "IN_PROGRESS"
                    }, room=f"user_{p['client_id']}")
                    socketio.emit("projectStatusChanged", {
                        "project_id": p["id"],
                        "status": "IN_PROGRESS"
                    }, room=f"user_{p['freelancer_id']}")
            except Exception as se:
                print(f"Socket emit failed in transitions: {se}")
        
        conn.commit()
        conn.close()
        return len(to_move)
    except Exception as e:
        print(f"Error checking status transitions: {e}")
        return 0

def check_unverified_completions():
    """
    Checks projects in 'COMPLETED' state for more than 3 days 
    and flags them for admin review if not 'VERIFIED'.
    """
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # 3 days ago timestamp
        three_days_ago = int(time.time()) - (3 * 24 * 3600)
        
        # Get hire_ids from projects to check against hire_request completed_at
        cur.execute("""
            SELECT p.id, p.hire_id, p.client_id, h.completed_at
            FROM projects p
            JOIN hire_request h ON h.id = p.hire_id
            WHERE p.status = 'COMPLETED' AND h.completed_at < %s
        """, (three_days_ago,))
        
        stale = cur.fetchall()
        for s in stale:
            print(f"⚠️ Project {s['id']} (Hire {s['hire_id']}) is STALE COMPLETED.")
            log_admin_alert('DEADLINE_MISSED', f"Project {s['id']} unverified for > 3 days.", related_id=s['id'])
            # Notify client again
            send_email(
                "client@example.com", # Should fetch actual client email
                "⚠️ Action Required: Verify Project Completion",
                f"Project {s['id']} has been marked as completed for 3 days. Please verify it.",
                related_project_id=s['id']
            )

        conn.close()
    except Exception as e:
        print(f"Error checking stale completions: {e}")

def check_pending_payments():
    """Checks for pending payments in audit_logs older than 24h."""
    try:
        conn = admin_db()
        cur = conn.cursor()
        one_day_ago = int(time.time()) - (24 * 3600)
        cur.execute("SELECT id, project_id, transaction_amount FROM audit_logs WHERE payment_status = 'Pending' AND created_at < %s", (one_day_ago,))
        pending = cur.fetchall()
        for p in pending:
            log_admin_alert('PAYMENT_DELAY', f"Payment of ₹{p[2]} for project {p[1]} pending > 24h.", related_id=p[1])
        conn.close()
    except Exception as e:
        print(f"Error checking pending payments: {e}")


def generate_action_required_notifications(user_id=None):
    """Create one-time notifications for overdue in-progress gigs."""
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        conn = freelancer_db()
        cur = get_dict_cursor(conn)

        query = """
            SELECT p.id, p.freelancer_id, p.client_id, p.title, p.start_date, c.name AS client_name
            FROM projects p
            LEFT JOIN client c ON c.id = p.client_id
            WHERE p.status IN ('ACCEPTED', 'IN_PROGRESS')
              AND p.start_date < %s
        """
        params = [today]
        if user_id is not None:
            query += " AND p.freelancer_id = %s"
            params.append(int(user_id))

        cur.execute(query, tuple(params))
        projects = cur.fetchall()
        conn.close()

        from notification_helper import get_notifications, notify_freelancer

        for project in projects:
            existing = [
                note for note in get_notifications(project["freelancer_id"], limit=200)
                if note["type"] == "ACTION_REQUIRED" and int(note.get("reference_id") or 0) == int(project["id"])
            ]
            if existing:
                continue

            notify_freelancer(
                freelancer_id=project["freelancer_id"],
                sender_id=project.get("client_id"),
                notification_type="ACTION_REQUIRED",
                title="Action Required",
                message=f"Please mark '{project.get('title') or f'Project #{project['id']}'}' as completed.",
                related_entity_type="project",
                related_entity_id=project["id"],
                reference_id=project["id"],
            )
    except Exception as e:
        print(f"Error generating action-required notifications: {e}")

def run_scheduler():
    """Simple background scheduler loop."""
    print("[SCHEDULER] Background scheduler started.")
    while True:
        try:
            check_project_status_transitions()
            check_unverified_completions()
            check_pending_payments()
            generate_action_required_notifications()
        except Exception as e:
            print(f"[SCHEDULER] Error in loop: {e}")
        time.sleep(3600) # Run every hour

@app.route("/projects/list", methods=["GET"])
def projects_list():
    """
    List projects for a user.
    Query params: user_id, role (client|freelancer)
    """
    user_id = request.args.get("user_id")
    role = request.args.get("role")
    
    if not user_id or not role:
        return jsonify({"success": False, "msg": "user_id and role required"}), 400
        
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Invalid user_id"}), 400
        
    # Trigger status transitions before listing
    check_project_status_transitions()
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    if role == "client":
        cur.execute("""
            SELECT
                p.id,
                p.hire_id,
                p.client_id,
                p.freelancer_id,
                p.title,
                p.agreed_price,
                p.pricing_type,
                p.start_date,
                p.start_time,
                p.end_date,
                p.end_time,
                p.status,
                p.created_at,
                COALESCE(p.payment_status, hr.payment_status, 'pending') AS payment_status,
                COALESCE(p.payout_status, hr.payout_status, 'pending') AS payout_status,
                COALESCE(hr.event_status, LOWER(p.status)) AS event_status,
                f.name as freelancer_name,
                f.email as freelancer_email
            FROM projects p
            LEFT JOIN hire_request hr ON hr.id = p.hire_id
            JOIN freelancer f ON f.id = p.freelancer_id
            WHERE p.client_id = %s
            ORDER BY p.created_at DESC
        """, (user_id,))
    else:
        cur.execute("""
            SELECT
                p.id,
                p.hire_id,
                p.client_id,
                p.freelancer_id,
                p.title,
                p.agreed_price,
                p.pricing_type,
                p.start_date,
                p.start_time,
                p.end_date,
                p.end_time,
                p.status,
                p.created_at,
                COALESCE(p.payment_status, hr.payment_status, 'pending') AS payment_status,
                COALESCE(p.payout_status, hr.payout_status, 'pending') AS payout_status,
                COALESCE(hr.event_status, LOWER(p.status)) AS event_status,
                c.name as client_name,
                c.email as client_email
            FROM projects p
            LEFT JOIN hire_request hr ON hr.id = p.hire_id
            JOIN client c ON c.id = p.client_id
            WHERE p.freelancer_id = %s
            ORDER BY p.created_at DESC
        """, (user_id,))
        
    projects = cur.fetchall()
    conn.close()
    
    return jsonify({"success": True, "projects": projects})

@app.route("/project/complete", methods=["POST"])
def project_complete():
    """
    Freelancer marks project as completed.
    Body: { project_id, freelancer_id, completion_note, proof }
    """
    d = get_json()
    missing = require_fields(d, ["project_id", "freelancer_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
        
    pid = int(d["project_id"])
    fid = int(d["freelancer_id"])
    note = d.get("completion_note", "")
    proof = d.get("proof", "")
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Verify project exists and belongs to freelancer
    cur.execute("SELECT id, hire_id, client_id, status FROM projects WHERE id = %s AND freelancer_id = %s", (pid, fid))
    proj = cur.fetchone()
    
    if not proj:
        conn.close()
        return jsonify({"success": False, "msg": "Project not found or access denied"}), 404
        
    if proj["status"] not in ("IN_PROGRESS", "ACCEPTED"):
        conn.close()
        return jsonify({"success": False, "msg": f"Project cannot be completed from state: {proj['status']}"}), 400
        
    # Update project status
    cur.execute("UPDATE projects SET status = 'COMPLETED' WHERE id = %s", (pid,))
    
    # Also update the linked hire_request event_status
    if proj["hire_id"]:
        cur.execute("""
            UPDATE hire_request 
            SET event_status = 'completed', completion_note = %s, completion_proof = %s, completed_at = %s
            WHERE id = %s
        """, (note, proof, int(time.time()), proj["hire_id"]))
        
    conn.commit()
    conn.close()
    
    # Emit socket and notification events
    try:
        from notification_helper import notify_client
        notify_client(
            client_id=proj["client_id"],
            message=f"Freelancer has marked Project #{pid} as COMPLETED. Please verify the work.",
            title="Work Completed",
            related_entity_type="project",
            related_entity_id=pid
        )
        
        from socket_service import socketio
        if socketio:
            socketio.emit("projectStatusChanged", {"project_id": pid, "status": "COMPLETED"}, room=f"user_{proj['client_id']}")
            socketio.emit("projectStatusChanged", {"project_id": pid, "status": "COMPLETED"}, room=f"user_{fid}")
    except Exception: pass
    
    return jsonify({"success": True, "msg": "Project marked as COMPLETED"})

@app.route("/project/verify", methods=["POST"])
def project_verify():
    """
    Client verifies/approves the completed project.
    Body: { project_id, client_id }
    """
    d = get_json()
    missing = require_fields(d, ["project_id", "client_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
        
    pid = int(d["project_id"])
    cid = int(d["client_id"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Verify project exists and belongs to client
    cur.execute("SELECT id, hire_id, freelancer_id, status, agreed_price FROM projects WHERE id = %s AND client_id = %s", (pid, cid))
    proj = cur.fetchone()
    
    if not proj:
        conn.close()
        return jsonify({"success": False, "msg": "Project not found or access denied"}), 404
        
    if proj["status"] != "COMPLETED":
        conn.close()
        return jsonify({"success": False, "msg": "Project must be COMPLETED before verification"}), 400
        
    # Update project status
    cur.execute("UPDATE projects SET status = 'VERIFIED' WHERE id = %s", (pid,))
    
    # Update hire_request payout_status
    if proj["hire_id"]:
        cur.execute("UPDATE hire_request SET payout_status = 'requested' WHERE id = %s", (proj["hire_id"],))
        
    # Log transaction for admin
    from admin_db import log_transaction
    log_transaction(
        freelancer_id=proj["freelancer_id"],
        client_id=cid,
        amount=proj["agreed_price"],
        status='Paid', # Assuming verification triggers payment
        project_id=pid
    )
    
    conn.commit()
    conn.close()
    
    # Emit socket and notification events
    try:
        from notification_helper import notify_freelancer
        notify_freelancer(
            freelancer_id=proj["freelancer_id"],
            message=f"Client has verified your work for Project #{pid}. Payout has been requested.",
            title="Work Verified",
            related_entity_type="project",
            related_entity_id=pid
        )
        
        from socket_service import socketio
        if socketio:
            socketio.emit("projectStatusChanged", {"project_id": pid, "status": "VERIFIED"}, room=f"user_{cid}")
            socketio.emit("projectStatusChanged", {"project_id": pid, "status": "VERIFIED"}, room=f"user_{proj['freelancer_id']}")
    except Exception: pass
    
    return jsonify({"success": True, "msg": "Project VERIFIED. Payout requested."})

def validate_email_input(email):
    """Validate and sanitize email input"""
    if not email:
        return None, "Email is required"
    
    email = str(email).strip().lower()
    if len(email) > 255:
        return None, "Email cannot exceed 255 characters"
    
    if not valid_email(email):
        return None, "Invalid email format"
    
    return email, None

def validate_payload_size(max_size_mb=1):
    """Validate request payload size to prevent DoS attacks"""
    content_length = request.content_length
    if content_length and content_length > max_size_mb * 1024 * 1024:
        return False, f"Request too large. Maximum size is {max_size_mb}MB"
    return True, None

# ============================================================
# GEO HELPERS
# ============================================================

def geocode_address(address: str):
    address = (address or "").strip()
    if not address:
        return None, None
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 1},
            headers={"User-Agent": "GigBridge/1.0 (contact: support@gigbridge.local)"},
            timeout=8,
        )
        if resp.status_code != 200:
            return None, None
        data = resp.json()
        if not data:
            return None, None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        return lat, lon
    except Exception:
        return None, None

def geocode_pincode(pincode, hint=None):
    """Geocode Indian pincode using Nominatim with optional hint for disambiguation"""
    try:
        query = f"{pincode}, India"
        if hint:
            query = f"{hint}, {pincode}, India"
        
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "addressdetails": 1,
                "limit": 1,
            },
            headers={
                "User-Agent": "GigBridge/1.0 (geocoding service)"
            },
            timeout=8,
        )
        if resp.status_code != 200:
            return None, None
        data = resp.json()
        if not data:
            return None, None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        return lat, lon
    except Exception as e:
        return None, None

def calculate_distance(lat1, lon1, lat2, lon2):
    try:
        import math
        R = 6371.0
        phi1 = math.radians(float(lat1))
        phi2 = math.radians(float(lat2))
        d_phi = math.radians(float(lat2) - float(lat1))
        d_lambda = math.radians(float(lon2) - float(lon1))
        a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c
    except Exception:
        return 999999.0

# ============================================================
# EMAIL HELPERS
# ============================================================

def build_branded_email_html(subject, body):
    escaped_subject = escape(subject or "GigBridge Update")
    escaped_body = escape(body or "").replace("\n", "<br />")
    return f"""
    <html>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
                <tr>
                  <td align="center" style="padding:32px 24px 18px;background:linear-gradient(135deg,#eff6ff,#ffffff);">
                    <a href="{FRONTEND_BASE_URL}" style="display:inline-block;text-decoration:none;">
                      <img src="{EMAIL_LOGO_URL}" alt="GigBridge logo" style="height:72px;width:auto;display:block;margin:0 auto 16px;" />
                    </a>
                    <div style="font-size:28px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">GigBridge</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 32px;">
                    <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#0f172a;">{escaped_subject}</h1>
                    <div style="font-size:15px;line-height:1.7;color:#475569;">{escaped_body}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """

def send_email(to_email, subject, body, related_project_id=None, html_body=None):
    if not SENDER_EMAIL or not APP_PASSWORD:
        print("❌ Email credentials missing. Logging to DB as Failed.")
        log_email(to_email, subject, body, status='Failed', project_id=related_project_id, error_msg="Credentials missing")
        return False

    msg = EmailMessage()
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    msg.add_alternative(html_body or build_branded_email_html(subject, body), subtype="html")

    server = None
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
        server.starttls()
        server.login(SENDER_EMAIL, APP_PASSWORD)
        server.send_message(msg)
        log_email(to_email, subject, body, status='Sent', project_id=related_project_id)
        return True
    except Exception as e:
        print(f"❌ Email failed: {e}")
        log_email(to_email, subject, body, status='Failed', project_id=related_project_id, error_msg=str(e))
        return False
    finally:
        if server:
            try:
                server.quit()
            except:
                pass

def send_login_email(to_email, name, role, action):
    send_email(
        to_email,
        "🎉 GigBridge Login Successful",
        f"""
Hi {name},

Your {action} as a {role} on GigBridge was successful ✅

Welcome to GigBridge 🚀
"""
    )

def send_otp_email(to_email, otp):
    send_email(
        to_email,
        "🔐 GigBridge OTP Verification",
        f"""
Your OTP for GigBridge signup is:

🔢 OTP: {otp}

⏱ Valid for 5 minutes.
❌ Do NOT share this OTP with anyone.
"""
    )

# ============================================================
# OTP TABLES
# ============================================================

def create_otp_tables():
    conn = client_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS client_otp (
            email TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS freelancer_otp (
            email TEXT PRIMARY KEY,
            otp TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

create_otp_tables()

# ============================================================
# OTP – CLIENT
# ============================================================

@app.route("/client/send-otp", methods=["POST"])
def client_send_otp():
    try:
        # Validate payload size
        valid_size, size_error = validate_payload_size(0.1)  # 100KB limit for OTP
        if not valid_size:
            return jsonify({"success": False, "msg": size_error}), 413

        d = get_json()
        missing = require_fields(d, ["email"])
        if missing:
            return jsonify({"success": False, "msg": "Email required"}), 400

        # Validate and sanitize email input
        email, error = validate_email_input(d["email"])
        if error:
            return jsonify({"success": False, "msg": error}), 400

        otp = str(random.randint(100000, 999999))
        expires_at = now_ts() + OTP_TTL_SECONDS

        # Ensure DB insert always succeeds
        conn = None
        try:
            conn = client_db()
            cur = get_dict_cursor(conn)
            cur.execute(
                "INSERT INTO client_otp (email, otp, expires_at) VALUES (%s, %s, %s) ON CONFLICT (email) DO UPDATE SET otp=EXCLUDED.otp, expires_at=EXCLUDED.expires_at",
                (email, otp, expires_at)
            )
            conn.commit()
        except Exception as db_error:
            if conn:
                conn.rollback()
            return jsonify({"success": False, "msg": "Database operation failed"}), 500
        finally:
            if conn:
                conn.close()

        # Try to send email, but don't fail if email service is down
        try:
            send_otp_email(email, otp)
        except Exception as email_error:
            # Log email error but don't expose to user
            import logging
            logging.getLogger(__name__).warning(f"Email sending failed for {email}: {type(email_error).__name__}")

        return jsonify({"success": True, "msg": "OTP sent"})
        
    except Exception as e:
        return jsonify({"success": False, "msg": "Server error occurred"}), 500

@app.route("/client/verify-otp", methods=["POST"])
def client_verify_otp():
    d = get_json()
    missing = require_fields(d, ["name", "email", "password", "otp"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    # Validate and sanitize inputs
    name, error = validate_input(d["name"], 100, "Name")
    if error:
        return jsonify({"success": False, "msg": error}), 400
    
    email, error = validate_email_input(d["email"])
    if error:
        return jsonify({"success": False, "msg": error}), 400
    
    password = str(d["password"]).strip()
    if not password or len(password) < 6:
        return jsonify({"success": False, "msg": "Password must be at least 6 characters"}), 400
    
    otp_in, error = validate_input(d["otp"], 10, "OTP")
    if error:
        return jsonify({"success": False, "msg": error}), 400

    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        
        # Verify OTP
        cur.execute("SELECT otp, expires_at FROM client_otp WHERE email=%s", (email,))    
        row = cur.fetchone()

        if not row:
            return jsonify({"success": False, "msg": "OTP not found"}), 400

        db_otp = row["otp"]
        expires_at = int(row["expires_at"])
        if now_ts() > expires_at:
            cur.execute("DELETE FROM client_otp WHERE email=%s", (email,))
            conn.commit()
            return jsonify({"success": False, "msg": "OTP expired"}), 400

        if str(db_otp) != otp_in:
            return jsonify({"success": False, "msg": "Invalid OTP"}), 400

        # Insert client with RETURNING id
        cur.execute(
            "INSERT INTO client (name, email, password) VALUES (%s, %s, %s) RETURNING id",
            (name, email, generate_password_hash(password))
        )
        row = cur.fetchone()
        client_id = row["id"] if isinstance(row, dict) else row[0]

        # Clean up OTP
        cur.execute("DELETE FROM client_otp WHERE email=%s", (email,))
        conn.commit()

        try:
            send_login_email(email, name, "Client", "signup")
        except Exception as e:
            pass  # Email failure shouldn't break signup

        return jsonify({
            "success": True,
            "id": client_id,
            "client_id": client_id,
            "name": name,
            "email": email,
            "role": "client",
            "profile_completed": False,
        })

    except psycopg2.IntegrityError as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Client already exists"}), 409
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

# ============================================================
# OTP – FREELANCER
# ============================================================

@app.route("/freelancer/send-otp", methods=["POST"])
def freelancer_send_otp():
    d = get_json()
    missing = require_fields(d, ["email"])
    if missing:
        return jsonify({"success": False, "msg": "Email required"}), 400

    email = str(d["email"]).strip().lower()
    if not valid_email(email):
        return jsonify({"success": False, "msg": "Invalid email"}), 400

    otp = str(random.randint(100000, 999999))
    expires_at = now_ts() + OTP_TTL_SECONDS

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # PostgreSQL UPSERT syntax
        cur.execute(
            "INSERT INTO freelancer_otp (email, otp, expires_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (email) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at",
            (email, otp, expires_at)
        )
        conn.commit()

    except psycopg2.errors.UniqueViolation as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Email already has OTP pending"}), 409
    except psycopg2.IntegrityError as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database integrity error"}), 409
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

    try:
        send_otp_email(email, otp)
    except Exception as e:
        # Continue even if email fails
        pass

    return jsonify({"success": True, "msg": "OTP sent"})

@app.route("/freelancer/verify-otp", methods=["POST"])
def freelancer_verify_otp():
    d = get_json()
    missing = require_fields(d, ["name", "email", "password", "otp"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    name = str(d["name"]).strip()
    email = str(d["email"]).strip().lower()
    password = str(d["password"])
    otp_in = str(d["otp"]).strip()

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # Verify OTP
        cur.execute("SELECT otp, expires_at FROM freelancer_otp WHERE email=%s", (email,))    
        row = cur.fetchone()

        if not row:
            return jsonify({"success": False, "msg": "OTP not found"}), 400

        db_otp = row["otp"]
        expires_at = int(row["expires_at"])
        if now_ts() > expires_at:
            cur.execute("DELETE FROM freelancer_otp WHERE email=%s", (email,))
            conn.commit()
            return jsonify({"success": False, "msg": "OTP expired"}), 400

        if str(db_otp) != otp_in:
            return jsonify({"success": False, "msg": "Invalid OTP"}), 400

        # Insert freelancer with RETURNING id
        cur.execute(
            "INSERT INTO freelancer (name, email, password) VALUES (%s, %s, %s) RETURNING id",
            (name, email, generate_password_hash(password))
        )
        row = cur.fetchone()
        freelancer_id = row["id"] if isinstance(row, dict) else row[0]

        # Clean up OTP
        cur.execute("DELETE FROM freelancer_otp WHERE email=%s", (email,))
        conn.commit()

        try:
            send_login_email(email, name, "Freelancer", "signup")
        except Exception as e:
            pass  # Email failure shouldn't break signup

        return jsonify({
            "success": True,
            "id": freelancer_id,
            "freelancer_id": freelancer_id,
            "name": name,
            "email": email,
            "role": "freelancer",
            "profile_completed": False,
        })

    except psycopg2.errors.UniqueViolation as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Freelancer already exists"}), 409
    except psycopg2.IntegrityError as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database integrity error"}), 409
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

# ============================================================
# PASSWORD RESET – CLIENT
# ============================================================

@app.route("/client/verify-otp-for-reset", methods=["POST"])
def client_verify_otp_for_reset():
    """Verify OTP for password reset"""
    d = get_json()
    missing = require_fields(d, ["email", "otp"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    otp_in = str(d["otp"]).strip()

    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        
        # PostgreSQL placeholder syntax
        cur.execute("SELECT otp, expires_at FROM client_otp WHERE email=%s", (email,))
        row = cur.fetchone()
        
        if not row:
            return jsonify({"success": False, "msg": "OTP not found"}), 400
        
        stored_otp = row["otp"]
        expires_at = int(row["expires_at"])
        
        if now_ts() > expires_at:
            # Clean up expired OTP
            cur.execute("DELETE FROM client_otp WHERE email=%s", (email,))
            conn.commit()
            return jsonify({"success": False, "msg": "OTP expired"}), 400
        
        if str(stored_otp) != otp_in:
            return jsonify({"success": False, "msg": "Invalid OTP or OTP expired"}), 400
        
        # OTP verified, allow password reset
        return jsonify({"success": True, "msg": "OTP verified"})
        
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route("/client/reset-password", methods=["POST"])
def client_reset_password():
    """Reset client password"""
    d = get_json()
    missing = require_fields(d, ["email", "new_password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    new_password = str(d["new_password"])
    
    if len(new_password) < 6:
        return jsonify({"success": False, "msg": "Password must be at least 6 characters"}), 400

    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        
        # PostgreSQL placeholder syntax
        cur.execute("UPDATE client SET password=%s WHERE email=%s", 
                    (generate_password_hash(new_password), email))
        
        if cur.rowcount == 0:
            return jsonify({"success": False, "msg": "Email not found"}), 404
        
        # Clean up OTP after successful password reset
        cur.execute("DELETE FROM client_otp WHERE email=%s", (email,))
        conn.commit()
        
        return jsonify({"success": True, "msg": "Password reset successful"})
        
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

# ============================================================
# PASSWORD RESET – FREELANCER
# ============================================================

@app.route("/freelancer/verify-otp-for-reset", methods=["POST"])
def freelancer_verify_otp_for_reset():
    """Verify OTP for password reset"""
    d = get_json()
    missing = require_fields(d, ["email", "otp"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    otp_in = str(d["otp"]).strip()

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # PostgreSQL placeholder syntax
        cur.execute("SELECT otp, expires_at FROM freelancer_otp WHERE email=%s", (email,))
        row = cur.fetchone()
        
        if not row:
            return jsonify({"success": False, "msg": "OTP not found"}), 400
        
        stored_otp = row["otp"]
        expires_at = int(row["expires_at"])
        
        if now_ts() > expires_at:
            # Clean up expired OTP
            cur.execute("DELETE FROM freelancer_otp WHERE email=%s", (email,))
            conn.commit()
            return jsonify({"success": False, "msg": "OTP expired"}), 400
        
        if str(stored_otp) != otp_in:
            return jsonify({"success": False, "msg": "Invalid OTP or OTP expired"}), 400
        
        # OTP verified, allow password reset
        return jsonify({"success": True, "msg": "OTP verified"})
        
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route("/freelancer/reset-password", methods=["POST"])
def freelancer_reset_password():
    """Reset freelancer password"""
    d = get_json()
    missing = require_fields(d, ["email", "new_password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    new_password = str(d["new_password"])
    
    if len(new_password) < 6:
        return jsonify({"success": False, "msg": "Password must be at least 6 characters"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # PostgreSQL placeholder syntax
        cur.execute("UPDATE freelancer SET password=%s WHERE email=%s", 
                    (generate_password_hash(new_password), email))
        
        if cur.rowcount == 0:
            return jsonify({"success": False, "msg": "Email not found"}), 404
        
        # Clean up OTP after successful password reset
        cur.execute("DELETE FROM freelancer_otp WHERE email=%s", (email,))
        conn.commit()
        
        return jsonify({"success": True, "msg": "Password reset successful"})
        
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Database error occurred"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()

@app.route("/client/signup", methods=["POST"])
def client_signup():
    """Direct signup endpoint for clients"""
    d = get_json()
    missing = require_fields(d, ["name", "email", "password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    name = str(d["name"]).strip()
    email = str(d["email"]).strip().lower()
    password = str(d["password"])
    
    if not valid_email(email):
        return jsonify({"success": False, "msg": "Invalid email format"}), 400
    
    conn = client_db()
    cur = get_dict_cursor(conn)
    
    # Check if email already exists
    cur.execute("SELECT id FROM client WHERE email=%s", (email,))
    if cur.fetchone():
        conn.close()
        return jsonify({"success": False, "msg": "Email already exists"}), 400
    
    # Insert new client
    cur.execute("INSERT INTO client (name, email, password) VALUES (%s, %s, %s) RETURNING id", 
                (name, email, generate_password_hash(password)))
    result = cur.fetchone()
    client_id = result["id"] if result else 0
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "client_id": client_id})

@app.route("/freelancer/signup", methods=["POST"])
def freelancer_signup():
    """Direct signup endpoint for freelancers"""
    d = get_json()
    missing = require_fields(d, ["name", "email", "password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    name = str(d["name"]).strip()
    email = str(d["email"]).strip().lower()
    password = str(d["password"])
    
    if not valid_email(email):
        return jsonify({"success": False, "msg": "Invalid email format"}), 400
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Check if email already exists
    cur.execute("SELECT id FROM freelancer WHERE email=%s", (email,))
    if cur.fetchone():
        conn.close()
        return jsonify({"success": False, "msg": "Email already exists"}), 400
    
    # Insert new freelancer
    cur.execute("INSERT INTO freelancer (name, email, password) VALUES (%s, %s, %s) RETURNING id", 
                (name, email, generate_password_hash(password)))
    result = cur.fetchone()
    freelancer_id = result["id"] if result else 0
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "freelancer_id": freelancer_id})

# ============================================================
# PROFILE APIs – CLIENT
# ============================================================

@app.route("/client/profile", methods=["POST"])
def create_client_profile():
    """Create or update client profile"""
    d = get_request_data()
    missing = require_fields(d, ["client_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields: client_id required"}), 400

    try:
        client_id = int(d["client_id"])
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    phone    = str(d.get("phone", "")).strip()
    location = str(d.get("location", "")).strip()
    bio      = str(d.get("bio", "")).strip()
    dob      = str(d.get("dob", "")).strip()
    pincode  = str(d.get("pincode", "")).strip()
    name     = str(d.get("name", "")).strip()
    profile_image_file = request.files.get("profile_image")

    # Age validation if dob provided
    if dob:
        age = calculate_age(dob)
        if age is not None:
            valid, err = validate_age(age)
            if not valid:
                return jsonify({"success": False, "msg": err}), 400

    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)

        # Verify client exists
        cur.execute("SELECT id, profile_image FROM client WHERE id=%s", (client_id,))
        client_row = cur.fetchone()
        if not client_row:
            return jsonify({"success": False, "msg": "Client not found"}), 404

        profile_image_path = client_row.get("profile_image") if isinstance(client_row, dict) else None
        if profile_image_file:
          try:
              profile_image_path = save_profile_image_upload(profile_image_file, "client", client_id)
          except ValueError as err:
              return jsonify({"success": False, "msg": str(err)}), 400

        # UPSERT profile
        cur.execute("""
            INSERT INTO client_profile (client_id, phone, location, bio, dob, pincode, name)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (client_id) DO UPDATE SET
                phone    = EXCLUDED.phone,
                location = EXCLUDED.location,
                bio      = EXCLUDED.bio,
                dob      = EXCLUDED.dob,
                pincode  = EXCLUDED.pincode,
                name     = EXCLUDED.name
        """, (client_id, phone, location, bio, dob, pincode, name))

        # Optionally update name in main client table if provided
        if name:
            cur.execute("UPDATE client SET name=%s WHERE id=%s", (name, client_id))
        if profile_image_path:
            cur.execute("UPDATE client SET profile_image=%s WHERE id=%s", (profile_image_path, client_id))

        conn.commit()
        return jsonify({"success": True, "msg": "Profile saved successfully", "profile_image": profile_image_path})

    except Exception as e:
        if conn:
            conn.rollback()
        import logging
        logging.getLogger(__name__).error(f"client profile save error: {e}", exc_info=True)
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()


@app.route("/client/profile/<int:client_id>", methods=["GET"])
def get_client_profile(client_id):
    """Fetch client profile"""
    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT c.id, c.name, c.email, c.profile_image,
                   cp.phone, cp.location, cp.bio, cp.dob, cp.pincode
            FROM client c
            LEFT JOIN client_profile cp ON cp.client_id = c.id
            WHERE c.id = %s
        """, (client_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Client not found"}), 404
        return jsonify({"success": True, **dict(row)})
    except Exception as e:
        return jsonify({"success": False, "msg": "Server error occurred"}), 500
    finally:
        if conn:
            conn.close()


# ============================================================
# PROFILE APIs – FREELANCER
# ============================================================




# Legacy freelancer profile endpoint removed - replaced by consolidated system below

# LOGIN APIs (CORE LOGIC SAME)
# ============================================================

@app.route("/client/login", methods=["POST"])
def client_login():
    """Enhanced client login with proper database error handling"""
    d = get_json()
    missing = require_fields(d, ["email", "password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    password = str(d["password"])

    # Database connection with proper error handling
    conn = None
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id,password,name FROM client WHERE email=%s", (email,))
        row = cur.fetchone()
        
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error during client login: {e}")
        return jsonify({
            "success": False, 
            "msg": "Database connection failed. Please try again later.",
            "error_type": "database_error"
        }), 503
    except Exception as e:
        logger.error(f"Unexpected database error during client login: {e}")
        return jsonify({
            "success": False, 
            "msg": "An error occurred. Please try again later.",
            "error_type": "server_error"
        }), 500
    finally:
        if conn:
            conn.close()

    # Authentication logic
    if row and check_password_hash(row["password"], password):
        # Check if user is disabled
        if FEATURE_BLOCK_DISABLED_USERS:
            try:
                c2 = client_db()
                cur2 = get_dict_cursor(c2)
                cur2.execute("SELECT COALESCE(is_enabled,1) as is_enabled FROM client WHERE id=%s", (row["id"],))
                en = cur2.fetchone()
                c2.close()
                if en and int(en.get("is_enabled", 1)) != 1:
                    return jsonify({"success": False, "msg": "Account disabled"}), 403
            except Exception as e:
                logger.warning(f"Failed to check disabled status for client {row['id']}: {e}")
                
        # Send login email (non-blocking)
        try:
            send_login_email(email, row["name"], "Client", "login")
        except Exception as e:
            logger.warning(f"Failed to send login email: {e}")
            
        # Check if profile is completed
        profile_done = False
        try:
            pc = client_db()
            pcc = get_dict_cursor(pc)
            pcc.execute("SELECT 1 FROM client_profile WHERE client_id=%s", (row["id"],))
            profile_done = pcc.fetchone() is not None
            pc.close()
        except Exception as e:
            logger.warning(f"Failed to check profile completion for client {row['id']}: {e}")
            profile_done = False
            
        logger.info(f"Client login successful: {email} (ID: {row['id']})")
        return jsonify({
            "success": True,
            "id": row["id"],
            "client_id": row["id"],
            "name": row["name"],
            "email": email,
            "role": "client",
            "profile_completed": profile_done,
        })

    logger.warning(f"Failed login attempt for client: {email}")
    return jsonify({"success": False, "msg": "Invalid credentials"})

@app.route("/freelancer/login", methods=["POST"])
def freelancer_login():
    """Enhanced freelancer login with proper database error handling"""
    d = get_json()
    missing = require_fields(d, ["email", "password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    email = str(d["email"]).strip().lower()
    password = str(d["password"])

    # Database connection with proper error handling
    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id,password,name FROM freelancer WHERE email=%s", (email,))
        row = cur.fetchone()
        
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error during freelancer login: {e}")
        return jsonify({
            "success": False, 
            "msg": "Database connection failed. Please try again later.",
            "error_type": "database_error"
        }), 503
    except Exception as e:
        logger.error(f"Unexpected database error during freelancer login: {e}")
        return jsonify({
            "success": False, 
            "msg": "An error occurred. Please try again later.",
            "error_type": "server_error"
        }), 500
    finally:
        if conn:
            conn.close()

    # Authentication logic
    if row and check_password_hash(row["password"], password):
        # Check if user is disabled
        if FEATURE_BLOCK_DISABLED_USERS:
            try:
                f2 = freelancer_db()
                cur2 = get_dict_cursor(f2)
                cur2.execute("SELECT COALESCE(is_enabled,1) as is_enabled FROM freelancer WHERE id=%s", (row["id"],))
                en = cur2.fetchone()
                f2.close()
                if en and int(en.get("is_enabled", 1)) != 1:
                    return jsonify({"success": False, "msg": "Account disabled"}), 403
            except Exception as e:
                logger.warning(f"Failed to check disabled status for freelancer {row['id']}: {e}")
                
        # Send login email (non-blocking)
        try:
            send_login_email(email, row["name"], "Freelancer", "login")
        except Exception as e:
            logger.warning(f"Failed to send login email: {e}")
            
        # Check if profile is completed
        profile_done = False
        try:
            fp2 = freelancer_db()
            fpc = get_dict_cursor(fp2)
            fpc.execute("SELECT 1 FROM freelancer_profile WHERE freelancer_id=%s", (row["id"],))
            profile_done = fpc.fetchone() is not None
            fp2.close()
        except Exception as e:
            logger.warning(f"Failed to check profile completion for freelancer {row['id']}: {e}")
            profile_done = False
            
        logger.info(f"Freelancer login successful: {email} (ID: {row['id']})")
        return jsonify({
            "success": True,
            "id": row["id"],
            "freelancer_id": row["id"],
            "name": row["name"],
            "email": email,
            "role": "freelancer",
            "profile_completed": profile_done,
        })

    logger.warning(f"Failed login attempt for freelancer: {email}")
    return jsonify({"success": False, "msg": "Invalid credentials"})

# ============================================================
# PROFILES
# ============================================================

@app.route("/client/profile", methods=["POST"])
def client_profile():
    d = get_json()
    missing = require_fields(d, ["client_id", "name", "phone", "location", "bio", "dob"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    # Validate DOB format and calculate age
    age = calculate_age(d["dob"])
    if age is None:
        return jsonify({"success": False, "msg": "Invalid DOB format. Use YYYY-MM-DD"}), 400
    
    # Apply age restriction (18-60 years)
    is_valid_age, age_error_msg = validate_age(age)
    if not is_valid_age:
        return jsonify({"success": False, "msg": age_error_msg}), 400
    pincode = str(d.get("pincode", "") or "").strip()
    lat = lon = None
    if pincode:
        if (len(pincode) != 6) or (not pincode.isdigit()):
            return jsonify({"success": False, "msg": "Invalid pincode"}), 400
        lat, lon = geocode_pincode(pincode, d.get("location"))

        if lat is None or lon is None:
            return jsonify({"success": False, "msg": "Enter valid pincode"}), 400

    if (lat is None or lon is None) and d.get("location"):
        lat, lon = geocode_address(d["location"])
        
    conn = client_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        INSERT INTO client_profile (client_id, name, phone, location, bio, pincode, latitude, longitude, dob)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(client_id) DO UPDATE SET
        phone=excluded.phone,
        location=excluded.location,
        bio=excluded.bio,
        pincode=excluded.pincode,
        latitude=excluded.latitude,
        longitude=excluded.longitude,
        dob=excluded.dob,
        name=excluded.name
    """, (d["client_id"], d["name"], d["phone"], d["location"], d["bio"], pincode, lat, lon, d["dob"]))
    conn.commit()
    conn.close()

    # Add notification (store in PostgreSQL)
    c2 = client_db()
    cur2 = get_dict_cursor(c2)
    
    # Enhanced message generation
    from notification_utils import enhance_notification_message, get_notification_icon
    
    enhanced_message = enhance_notification_message(
        message="Profile updated successfully",
        title="Profile Update",
        related_entity_type="SYSTEM",
        context_data={"action": "profile_update"}
    )
    
    # Add notification using unified system
    from notification_helper import notify_user
    notify_user(
        user_id=d["client_id"],
        role="client",
        title="Profile Update",
        message=enhanced_message,
        related_entity_type="SYSTEM"
    )

@app.route("/freelancer/profile", methods=["POST"])
def freelancer_profile():
    d = get_request_data()
    print(f"DEBUG: Received payload: {d}")  # Debug line
    missing = require_fields(
        d,
        [
            "freelancer_id",
            "title",
            "skills",
            "experience_years",
            "bio",
            "category",
            "location",
            "dob",
        ],
    )
    print(f"DEBUG: Missing fields: {missing}")  # Debug line
    if missing:
        return jsonify({"success": False, "msg": f"Missing fields: {', '.join(missing)}"}), 400
    
    if not is_valid_category(d["category"]):
        return jsonify({"success": False, "msg": "Invalid category"}), 400

    # Derive pricing_type from category (central mapping)
    try:
        pricing_type = get_pricing_type_for_category(d["category"])
    except ValueError as e:
        return jsonify({"success": False, "msg": str(e)}), 400

    # Initialize pricing fields
    fixed_price = d.get("fixed_price")
    hourly_rate = d.get("hourly_rate")
    overtime_rate_per_hour = d.get("overtime_rate_per_hour")
    per_person_rate = d.get("per_person_rate")
    starting_price = d.get("starting_price")
    work_description = d.get("work_description")
    services_included = d.get("services_included")

    # Normalize numeric fields
    if fixed_price is not None:
        fixed_price = float(fixed_price)
        if fixed_price <= 0:
            return jsonify({"success": False, "msg": "Fixed price must be greater than 0"}), 400
    if hourly_rate is not None:
        hourly_rate = float(hourly_rate)
        if hourly_rate <= 0:
            return jsonify({"success": False, "msg": "Hourly rate must be greater than 0"}), 400
    if overtime_rate_per_hour is not None:
        overtime_rate_per_hour = float(overtime_rate_per_hour)
        if overtime_rate_per_hour < 0:
            return jsonify({"success": False, "msg": "Overtime rate cannot be negative"}), 400
    if per_person_rate is not None:
        per_person_rate = float(per_person_rate)
    if starting_price is not None:
        starting_price = float(starting_price)

    # Validate pricing depending on pricing_type
    searchable_price = None
    if pricing_type == PRICING_TYPE_HOURLY:
        if hourly_rate is None or hourly_rate <= 0:
            return jsonify({"success": False, "msg": "Hourly categories require a positive hourly_rate"}), 400
        searchable_price = hourly_rate
        # For hourly pricing, ignore min/max budget values
        min_budget = 0
        max_budget = 0

    elif pricing_type == PRICING_TYPE_PER_PERSON:
        if per_person_rate is None or per_person_rate <= 0:
            return jsonify({"success": False, "msg": "Per-person categories require a positive per_person_rate"}), 400
        searchable_price = per_person_rate
        # For per-person pricing, ignore min/max budget values
        min_budget = 0
        max_budget = 0

    elif pricing_type == PRICING_TYPE_PACKAGE:
        # For package categories, pricing is managed via separate packages
        # No starting_price or other base pricing fields should be required
        searchable_price = 0
        # For package pricing, ignore all base pricing fields
        min_budget = 0
        max_budget = 0

    elif pricing_type == PRICING_TYPE_PROJECT:
        if starting_price is None or starting_price <= 0:
            return jsonify({"success": False, "msg": "Project categories require a positive starting_price"}), 400
        if not work_description:
            return jsonify({"success": False, "msg": "Project categories require work_description"}), 400
        searchable_price = starting_price
        # For project pricing, ignore min/max budget values
        min_budget = 0
        max_budget = 0

    # Validate experience_years
    try:
        experience_years = float(d["experience_years"])
        if not experience_years.is_integer():
            return jsonify({"success": False, "msg": "Experience must be a valid whole number of years."}), 400
        experience_years = int(experience_years)
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Experience must be a valid whole number of years."}), 400
    
    if experience_years < 0:
        return jsonify({"success": False, "msg": "Experience cannot be negative."}), 400

    # Validate DOB format and calculate age
    age = calculate_age(d["dob"])
    if age is None:
        return jsonify({"success": False, "msg": "Invalid DOB format. Use YYYY-MM-DD"}), 400
    
    # Apply age restriction (18-60 years)
    is_valid_age, age_error_msg = validate_age(age)
    if not is_valid_age:
        return jsonify({"success": False, "msg": age_error_msg}), 400
    
    # Validate experience against age (minimum working age is 16, so max experience = age - 16)
    max_experience = age - 16
    if experience_years > max_experience:
        return jsonify({"success": False, "msg": "Experience cannot be greater than logically possible for the entered age."}), 400

    # Validate availability_status if provided
    availability_status = d.get("availability_status", "AVAILABLE")
    allowed_statuses = ["AVAILABLE", "BUSY", "ON_LEAVE"]
    if availability_status not in allowed_statuses:
        return jsonify({"success": False, "msg": "Invalid availability status"}), 400

    # Optional location support for geocoding
    lat, lon = (None, None)
    pincode = str(d.get("pincode", "") or "").strip()
    if pincode:
        if (len(pincode) != 6) or (not pincode.isdigit()):
            return jsonify({"success": False, "msg": "Invalid pincode"}), 400
        lat, lon = geocode_pincode(pincode, d.get("location"))

        if lat is None or lon is None:
            return jsonify({"success": False, "msg": "Enter valid pincode"}), 400

    loc_str = d.get("location")
    if loc_str and (lat is None or lon is None):
        lat, lon = geocode_address(str(loc_str))

    freelancer_id = int(d["freelancer_id"])
    profile_image_file = request.files.get("profile_image")

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("SELECT id, profile_image FROM freelancer WHERE id=%s", (freelancer_id,))
    freelancer_row = cur.fetchone()
    if not freelancer_row:
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404

    profile_image_path = freelancer_row.get("profile_image") if isinstance(freelancer_row, dict) else None
    if profile_image_file:
        try:
            profile_image_path = save_profile_image_upload(profile_image_file, "freelancer", freelancer_id)
        except ValueError as err:
            conn.close()
            return jsonify({"success": False, "msg": str(err)}), 400

    cur.execute(
        """
        INSERT INTO freelancer_profile
        (freelancer_id, title, skills, experience, min_budget, max_budget, bio, category, location, pincode, latitude, longitude, dob, availability_status, supports_fixed, supports_hourly, fixed_price, hourly_rate, overtime_rate_per_hour, pricing_type, per_person_rate, starting_price, searchable_price, work_description, services_included, phone)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT(freelancer_id) DO UPDATE SET
            title=excluded.title,
            skills=excluded.skills,
            experience=excluded.experience,
            min_budget=excluded.min_budget,
            max_budget=excluded.max_budget,
            bio=excluded.bio,
            category=excluded.category,
            location=excluded.location,
            pincode=excluded.pincode,
            latitude=excluded.latitude,
            longitude=excluded.longitude,
            dob=excluded.dob,
            availability_status=excluded.availability_status,
            supports_fixed=excluded.supports_fixed,
            supports_hourly=excluded.supports_hourly,
            fixed_price=excluded.fixed_price,
            hourly_rate=excluded.hourly_rate,
            overtime_rate_per_hour=excluded.overtime_rate_per_hour,
            pricing_type=excluded.pricing_type,
            per_person_rate=excluded.per_person_rate,
            starting_price=excluded.starting_price,
            searchable_price=excluded.searchable_price,
            work_description=excluded.work_description,
            services_included=excluded.services_included,
            phone=excluded.phone
        """,
        (
            freelancer_id,
            d["title"],
            d["skills"],
            experience_years,
            min_budget,
            max_budget,
            d["bio"],
            d["category"],
            d["location"],
            pincode,
            lat,
            lon,
            d["dob"],
            availability_status,
            # Legacy flags remain for compatibility with existing flows;
            # we infer reasonable defaults from pricing_type.
            True if pricing_type in (PRICING_TYPE_PACKAGE, PRICING_TYPE_PROJECT, PRICING_TYPE_PER_PERSON) else d.get("supports_fixed", True),
            True if pricing_type == PRICING_TYPE_HOURLY else d.get("supports_hourly", True),
            fixed_price,
            hourly_rate,
            overtime_rate_per_hour,
            pricing_type,
            per_person_rate,
            starting_price,
            searchable_price,
            work_description,
            services_included,
            d.get("phone"),
        ),
    )
    if profile_image_path:
        cur.execute("UPDATE freelancer SET profile_image=%s WHERE id=%s", (profile_image_path, freelancer_id))
    conn.commit()
    conn.close()

    # Add notification for freelancer profile update
    from notification_utils import enhance_notification_message, get_notification_icon
    
    enhanced_message = enhance_notification_message(
        message="Profile updated successfully",
        title="Profile Update",
        related_entity_type="SYSTEM",
        context_data={"action": "profile_update"}
    )
    
    notify_freelancer(
        freelancer_id=freelancer_id,
        message=enhanced_message,
        title="Profile Update",
        related_entity_type="SYSTEM")

    # Rebuild FTS index for better keyword search
    rebuild_freelancer_search_index(freelancer_id)

    # Update semantic index (optional)
    try:
        upsert_freelancer(freelancer_id)
    except Exception:
        pass

    return jsonify({"success": True, "profile_image": profile_image_path})

@app.route("/freelancer/update-availability", methods=["POST"])
def update_freelancer_availability():
    """Update freelancer availability status"""
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "availability_status"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    # Validate availability status
    allowed_statuses = ["AVAILABLE", "BUSY", "ON_LEAVE"]
    if d["availability_status"] not in allowed_statuses:
        return jsonify({"success": False, "msg": "Invalid availability status"}), 400
    
    freelancer_id = int(d["freelancer_id"])
    availability_status = d["availability_status"]
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE freelancer_profile 
            SET availability_status = %s
            WHERE freelancer_id = %s
        """, (availability_status, freelancer_id))
        conn.commit()
        
        if cur.rowcount == 0:
            return jsonify({"success": False, "msg": "Freelancer profile not found"}), 404
            
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "msg": "Database error"}), 500
    finally:
        conn.close()

# ============================================================
# SEARCH (Category + Budget) + includes freelancer NAME
# ============================================================


# ============================================================
# SEARCH (Category + Budget) + specialization via FTS5 (q)
# ============================================================

@app.route("/freelancers/search", methods=["GET"])
def freelancers_search():
    category = (request.args.get("category", "") or "").strip().lower()
    q = (request.args.get("q", "") or "").strip().lower()
    pricing_type = (request.args.get("pricing_type", "") or "").strip().upper()
    try:
        budget = float(request.args.get("budget", 0))
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Invalid budget"}), 400

    if category and not pricing_type:
        try:
            pricing_type = get_pricing_type_for_category(category).upper()
        except ValueError:
            return jsonify({"success": False, "msg": f"Invalid category: {category}"}), 400

    # Feature flag for hiding unverified freelancers
    client_id = request.args.get("client_id")
    client_lat = client_lon = None

    if client_id:
        try:
            cid = int(client_id)
            cconn = client_db()
            ccur = get_dict_cursor(cconn)
            ccur.execute(
                "SELECT latitude, longitude FROM client_profile WHERE client_id=%s",
                (cid,),
            )
            row = ccur.fetchone()
            cconn.close()

            if row:
                client_lat, client_lon = row.get("latitude"), row.get("longitude")
        except Exception:
            client_lat = client_lon = None

    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)

        rows = []

        # ============================================
        # IF SPECIALIZATION QUERY EXISTS → USE PostgreSQL full-text search
        # ============================================
        if q:
            cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
            tsvec = "to_tsvector('english', COALESCE(fs2.title,'') || ' ' || COALESCE(fs2.skills,'') || ' ' || COALESCE(fs2.bio,'') || ' ' || COALESCE(fs2.tags,'') || ' ' || COALESCE(fs2.portfolio_text,''))"
            tsq = "plainto_tsquery('english', %s)"

            # Build pricing-aware WHERE conditions based on new pricing types
            pricing_where = ""
            if pricing_type == "HOURLY":
                pricing_where = " AND fp.pricing_type = 'hourly' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
            elif pricing_type == "PER_PERSON":
                pricing_where = " AND fp.pricing_type = 'per_person' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
            elif pricing_type == "PACKAGE":
                pricing_where = " AND fp.pricing_type = 'package' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
            elif pricing_type == "PROJECT":
                pricing_where = " AND fp.pricing_type = 'project' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
            else:
                # Backward compatibility: handle PACKAGE pricing (searchable_price = 0) and other pricing types
                pricing_where = " AND (CASE WHEN fp.pricing_type = 'package' THEN 1 = 1 WHEN fp.searchable_price > 0 THEN fp.searchable_price <= %s ELSE (fp.min_budget <= %s AND fp.max_budget >= %s) END)"
            
            try:
                sql = f"""
                    SELECT
                        fp.freelancer_id,
                        f.name,
                        fp.title,
                        fp.skills,
                        fp.experience,
                        fp.min_budget,
                        fp.max_budget,
                        fp.rating,
                        fp.category,
                        fp.latitude,
                        fp.longitude,
                        fp.availability_status,
                        fp.supports_fixed,
                        fp.supports_hourly,
                        fp.fixed_price,
                        fp.hourly_rate,
                        fp.overtime_rate_per_hour,
                        fp.pricing_type,
                        fp.per_person_rate,
                        fp.starting_price,
                        fp.bio,
                        fp.tags,
                        COALESCE(fs.plan_name, 'BASIC') as subscription_plan,
                        ts_rank({tsvec}, {tsq}) as rank
                    FROM freelancer_search fs2
                    JOIN freelancer_profile fp ON fp.freelancer_id = fs2.freelancer_id
                    JOIN freelancer f ON f.id = fp.freelancer_id
                    LEFT JOIN freelancer_subscription fs ON fs.freelancer_id = fp.freelancer_id
                    WHERE {tsvec} @@ {tsq}
                        {cond_verified}
                        {pricing_where}
                """
                
                # Build parameters based on pricing type
                if pricing_type in ["HOURLY", "PER_PERSON", "PACKAGE", "PROJECT"]:
                    cur.execute(sql, (q, q, budget))
                else:
                    cur.execute(sql, (q, q, budget, budget, budget))
                rows = cur.fetchall()

            except Exception:
                rows = []

            # ============================================
            # FUZZY FALLBACK IF FTS RETURNS NOTHING
            # ============================================
            if not rows:
                cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
                
                # Build pricing-aware WHERE conditions for fuzzy fallback
                pricing_where = ""
                if pricing_type == "HOURLY":
                    pricing_where = " AND fp.pricing_type = 'hourly' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                elif pricing_type == "PER_PERSON":
                    pricing_where = " AND fp.pricing_type = 'per_person' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                elif pricing_type == "PACKAGE":
                    pricing_where = " AND fp.pricing_type = 'package' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                elif pricing_type == "PROJECT":
                    pricing_where = " AND fp.pricing_type = 'project' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                else:
                    # Backward compatibility: use generic budget filtering if no pricing_type
                    pricing_where = " AND fp.min_budget <= %s AND fp.max_budget >= %s"
                
                cur.execute(
                    f"""
                    SELECT
                        fp.freelancer_id,
                        f.name,
                        fp.title,
                        fp.skills,
                        fp.experience,
                        fp.min_budget,
                        fp.max_budget,
                        fp.rating,
                        fp.category,
                        fp.latitude,
                        fp.longitude,
                        fp.availability_status,
                        fp.supports_fixed,
                        fp.supports_hourly,
                        fp.fixed_price,
                        fp.hourly_rate,
                        fp.overtime_rate_per_hour,
                        fp.pricing_type,
                        fp.per_person_rate,
                        fp.starting_price,
                        fp.bio,
                        fp.tags,
                        COALESCE(fs.plan_name, 'BASIC') as subscription_plan
                    FROM freelancer_profile fp
                    JOIN freelancer f
                        ON f.id = fp.freelancer_id
                    LEFT JOIN freelancer_subscription fs
                        ON fs.freelancer_id = fp.freelancer_id
                    WHERE fp.category ILIKE %s
                      {cond_verified}
                      {pricing_where}
                    """,
                    (f"%{category}%", budget) if pricing_type in ["HOURLY", "PER_PERSON", "PACKAGE", "PROJECT"] else (f"%{category}%", budget, budget),
                )

                candidates = cur.fetchall()
                scored = []

                for r in candidates:
                    # Calculate specialization relevance across multiple fields (same logic as main post-filtering)
                    title_score = fuzzy_score(q, (r.get('title') or "").lower())
                    skills_score = fuzzy_score(q, (r.get('skills') or "").lower())
                    bio_score = fuzzy_score(q, (r.get('bio') or "").lower())
                    tags_score = fuzzy_score(q, (r.get('tags') or "").lower())
                    
                    # Calculate weighted specialization score (0-100)
                    spec_relevance_score = (title_score * 0.4 + skills_score * 0.4 + bio_score * 0.1 + tags_score * 0.1)
                    
                    scored.append((spec_relevance_score, r))

                scored.sort(key=lambda x: x[0], reverse=True)
                # Remove hard threshold - keep all candidates, let specialization relevance affect ranking
                # scored = [x for x in scored if x[0] >= 60]  # REMOVED: Hard threshold eliminated

                # Add a fake 'rank' column - use dict with rank key for consistent formatting
                rows = []
                for _, r in scored[:20]:
                    rd = dict(r) if isinstance(r, dict) else {}
                    rd["rank"] = 999999.0
                    rows.append(rd)

            # ============================================
            # SEMANTIC FALLBACK (RAG-style retrieval)
            # ============================================
            if not rows:
                try:
                    sem_ids = semantic_search(q, top_k=30)
                except Exception:
                    sem_ids = []

                if sem_ids:
                    placeholders = ",".join(["%s"] * len(sem_ids))
                    cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
                    
                    # Build pricing-aware WHERE conditions for semantic search
                    pricing_where = ""
                    if pricing_type == "HOURLY":
                        pricing_where = " AND fp.pricing_type = 'hourly' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                    elif pricing_type == "PER_PERSON":
                        pricing_where = " AND fp.pricing_type = 'per_person' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                    elif pricing_type == "PACKAGE":
                        pricing_where = " AND fp.pricing_type = 'package' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                    elif pricing_type == "PROJECT":
                        pricing_where = " AND fp.pricing_type = 'project' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                    else:
                        # Backward compatibility: use generic budget filtering if no pricing_type
                        pricing_where = " AND fp.min_budget <= %s AND fp.max_budget >= %s"
                    
                    cur.execute(
                        f"""
                        SELECT
                            fp.freelancer_id,
                            f.name,
                            fp.title,
                            fp.skills,
                            fp.experience,
                            fp.min_budget,
                            fp.max_budget,
                            fp.rating,
                            fp.category,
                            fp.latitude,
                            fp.longitude,
                            fp.availability_status,
                            fp.supports_fixed,
                            fp.supports_hourly,
                            fp.fixed_price,
                            fp.hourly_rate,
                            fp.overtime_rate_per_hour,
                            fp.pricing_type,
                            fp.per_person_rate,
                            fp.starting_price,
                            fp.bio,
                            fp.tags,
                            COALESCE(fs.plan_name, 'BASIC') as subscription_plan,
                            999999.0 as rank
                        FROM freelancer_profile fp
                        JOIN freelancer f ON f.id = fp.freelancer_id
                        LEFT JOIN freelancer_subscription fs
                            ON fs.freelancer_id = fp.freelancer_id
                        WHERE fp.freelancer_id IN ({placeholders})
                          {cond_verified}
                          {pricing_where}
                        """,
                        (*sem_ids, budget) if pricing_type in ["HOURLY", "PER_PERSON", "PACKAGE", "PROJECT"] else (*sem_ids, budget, budget),
                    )
                    rows = cur.fetchall()

        # ============================================
        # NO SPECIALIZATION → BUDGET ONLY SEARCH (with ILIKE for partial matches)
        # ============================================
        else:
            cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
            
            # Build pricing-aware WHERE conditions for no specialization search
            pricing_where = ""
            if pricing_type == "HOURLY":
                pricing_where = " AND fp.pricing_type = 'hourly' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                params = [budget]
            elif pricing_type == "PER_PERSON":
                pricing_where = " AND fp.pricing_type = 'per_person' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                params = [budget]
            elif pricing_type == "PACKAGE":
                pricing_where = " AND fp.pricing_type = 'package' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                params = [budget]
            elif pricing_type == "PROJECT":
                pricing_where = " AND fp.pricing_type = 'project' AND fp.searchable_price IS NOT NULL AND fp.searchable_price <= %s"
                params = [budget]
            else:
                # Backward compatibility: use generic budget filtering if no pricing_type
                pricing_where = " AND fp.min_budget <= %s AND fp.max_budget >= %s"
                params = [budget, budget]
            
            extra_where = ""
            if category:
                extra_where += " AND fp.category ILIKE %s"
                params.append(f"%{category}%")
            
            cur.execute(
                f"""
                SELECT
                    fp.freelancer_id,
                    f.name,
                    fp.title,
                    fp.skills,
                    fp.experience,
                    fp.min_budget,
                    fp.max_budget,
                    fp.rating,
                    fp.category,
                    fp.latitude,
                    fp.longitude,
                    fp.availability_status,
                    fp.supports_fixed,
                    fp.supports_hourly,
                    fp.fixed_price,
                    fp.hourly_rate,
                    fp.overtime_rate_per_hour,
                    fp.pricing_type,
                    fp.per_person_rate,
                    fp.starting_price,
                    fp.bio,
                    fp.tags,
                    COALESCE(fs.plan_name, 'BASIC') as subscription_plan,
                    999999.0 as rank
                FROM freelancer_profile fp
                JOIN freelancer f
                    ON f.id = fp.freelancer_id
                LEFT JOIN freelancer_subscription fs
                    ON fs.freelancer_id = fp.freelancer_id
                WHERE 1=1{cond_verified}{pricing_where}{extra_where}
                """,
                tuple(params),
            )
            rows = cur.fetchall()

        conn.close()

    except Exception as e:
        return jsonify(
            {
                "success": False,
                "msg": "DB error in /freelancers/search",
                "error": str(e),
            }
        ), 500

    # ============================================
    # FORMAT RESULTS
    # ============================================

    enriched = []

    for r in rows:
        # Support both dict (RealDictCursor) and tuple access
        def _v(r, key_or_idx, default=None):
            if isinstance(r, dict):
                return r.get(key_or_idx, default)
            try:
                return r[key_or_idx] if key_or_idx < len(r) else default
            except (TypeError, KeyError):
                return default
        _get = lambda k, d=None: _v(r, k, d)

        if category:
            cat_db = (str(_get("category", _get(8, ""))) or "").lower()
            if fuzzy_score(category, cat_db) < 70:
                continue

        # Calculate specialization relevance score instead of hard filtering
        spec_relevance_score = 0.0
        spec = (q or "").strip().lower()
        if spec:
            # Check specialization relevance across multiple fields
            title_score = fuzzy_score(spec, (str(_get("title", _get(2, ""))) or "").lower())
            skills_score = fuzzy_score(spec, (str(_get("skills", _get(3, ""))) or "").lower())
            bio_score = fuzzy_score(spec, (str(_get("bio", "")) or "").lower())
            tags_score = fuzzy_score(spec, (str(_get("tags", "")) or "").lower())
            
            # Calculate weighted specialization score (0-100)
            # Title and skills get higher weight
            spec_relevance_score = (title_score * 0.4 + skills_score * 0.4 + bio_score * 0.1 + tags_score * 0.1)
            
            # Debug: Log specialization scores for analysis
            print(f"DEBUG: Freelancer {_get('freelancer_id', _get(0))} spec scores - Title:{title_score:.1f} Skills:{skills_score:.1f} Bio:{bio_score:.1f} Tags:{tags_score:.1f} Combined:{spec_relevance_score:.1f}")

        f_lat = _get("latitude", _get(9))
        f_lon = _get("longitude", _get(10))

        if client_lat and client_lon and f_lat and f_lon:
            dist = calculate_distance(
                client_lat, client_lon, f_lat, f_lon
            )
        else:
            dist = 999999.0

        # Apply rank boost based on subscription
        rank_boost = 0
        subscription_plan = _get("subscription_plan", _get(12))
        
        # Migrate old plans
        if subscription_plan == "FREE":
            subscription_plan = "BASIC"
        elif subscription_plan == "PRO":
            subscription_plan = "PREMIUM"
        
        if subscription_plan == "PREMIUM":
            rank_boost = 1
        
        # Adjust rank with boost, specialization relevance, and location proximity
        base_rank = _get("rank", _get(13, 999999))
        
        # Convert specialization relevance to rank boost (higher relevance = lower rank number)
        # Scale: 100 relevance = 200 rank boost, 0 relevance = 0 boost
        spec_rank_boost = spec_relevance_score * 2.0
        
        # Add location-based boost (closer = lower rank number)
        # Scale: 0-10km = 50 boost, 10-50km = 30 boost, 50-100km = 15 boost, 100km+ = 0 boost
        location_rank_boost = 0
        if dist < 999999:  # Only apply if valid distance calculated
            if dist <= 10:
                location_rank_boost = 50
            elif dist <= 50:
                location_rank_boost = 30
            elif dist <= 100:
                location_rank_boost = 15
        
        adjusted_rank = (float(base_rank) if base_rank is not None else 999999) - (rank_boost * 100) - spec_rank_boost - location_rank_boost
        
        # Add badge
        badge = None
        if subscription_plan == "PREMIUM":
            badge = "🟣 PREMIUM"
        
        # Add pricing-type-specific information
        pricing_info = {}
        pricing_type = _get("pricing_type")
        
        if pricing_type == "hourly":
            hourly_rate = _get("hourly_rate", _get(15))
            if hourly_rate and hourly_rate > 0:
                pricing_info = {
                    "type": "hourly",
                    "hourly_rate": hourly_rate,
                    "display": f"₹{hourly_rate}/hour"
                }
        elif pricing_type == "per_person":
            per_person_rate = _get("per_person_rate")
            if per_person_rate and per_person_rate > 0:
                pricing_info = {
                    "type": "per_person", 
                    "per_person_rate": per_person_rate,
                    "display": f"₹{per_person_rate}/person"
                }
        elif pricing_type == "package":
            freelancer_id = _get("freelancer_id", _get(0))
            
            # Fetch packages for this freelancer
            packages = []
            try:
                pkg_conn = freelancer_db()
                pkg_cur = pkg_conn.cursor(cursor_factory=RealDictCursor)
                pkg_cur.execute("""
                    SELECT id, package_name, price, description
                    FROM freelancer_package
                    WHERE freelancer_id = %s
                    ORDER BY price ASC
                """, (freelancer_id,))
                pkg_results = pkg_cur.fetchall()
                pkg_conn.close()
                
                for pkg in pkg_results:
                    packages.append({
                        "package_id": pkg["id"],
                        "package_name": pkg["package_name"],
                        "services_included": pkg["description"] or "",
                        "package_price": pkg["price"]
                    })
            except Exception:
                pass  # Ignore package fetch errors
            
            if packages:
                pricing_info = {
                    "type": "package",
                    "packages": packages,
                    "display": f"{len(packages)} packages starting at ₹{packages[0]['package_price']}"
                }
            else:
                pricing_info = {
                    "type": "package",
                    "packages": [],
                    "display": "No packages configured"
                }
        elif pricing_type == "project":
            starting_price = _get("starting_price", _get(17))
            if starting_price and starting_price > 0:
                pricing_info = {
                    "type": "project",
                    "starting_price": starting_price,
                    "display": f"Project from ₹{starting_price}"
                }
        else:
            # Legacy fallback - show min/max budget for old records
            min_budget = _get("min_budget", _get(5))
            max_budget = _get("max_budget", _get(6))
            if min_budget or max_budget:
                pricing_info = {
                    "type": "range",
                    "min_budget": min_budget,
                    "max_budget": max_budget,
                    "display": f"₹{min_budget} - ₹{max_budget}"
                }
        
        enriched.append({
            "freelancer_id": _get("freelancer_id", _get(0)),
            "name": _get("name", _get(1)),
            "title": _get("title", _get(2)),
            "skills": _get("skills", _get(3)),
            "experience": _get("experience", _get(4)),
            "pricing": pricing_info,
            "rating": _get("rating", _get(7)),
            "category": _get("category", _get(8)),
            "distance": round(dist, 2),
            "rank": adjusted_rank,
            "badge": badge,
            "subscription_plan": subscription_plan,
            "availability_status": _get("availability_status", _get(11)),
            # Add pricing information for legacy compatibility
            "supports_fixed": _get("supports_fixed", _get(12)),
            "supports_hourly": _get("supports_hourly", _get(13)),
            "fixed_price": _get("fixed_price", _get(14)),
            "hourly_rate": _get("hourly_rate", _get(15)),
            "overtime_rate_per_hour": _get("overtime_rate_per_hour", _get(16)),
            # Add new pricing display fields
            "pricing_type": _get("pricing_type"),
            "per_person_rate": _get("per_person_rate"),
            "starting_price": _get("starting_price")
        })
    
    # Enhance all freelancers with pricing display fields
    for freelancer in enriched:
        enhance_freelancer_with_pricing(freelancer)
    
    # ============================================
    # GRID PRIORITY SYSTEM
    # ============================================
    
    # Split into premium and basic lists
    premium_list = []
    basic_list = []
    
    for item in enriched:
        if item["subscription_plan"] == "PREMIUM":
            premium_list.append(item)
        else:
            basic_list.append(item)
    
    # Sort both lists by rating DESC, then rank ASC, then distance ASC
    premium_list.sort(key=lambda x: (-x["rating"], x["rank"], x["distance"]))
    basic_list.sort(key=lambda x: (-x["rating"], x["rank"], x["distance"]))
    
    # Build final result list with grid priority
    final_list = []
    premium_idx = 0
    basic_idx = 0
    
    position = 1
    total_count = len(premium_list) + len(basic_list)
    
    while position <= total_count:
        if position % 3 == 0:  # Every 3rd position
            if premium_idx < len(premium_list):
                # Take highest rated premium
                final_list.append(premium_list[premium_idx])
                premium_idx += 1
            else:
                # No premium left, take from basic
                if basic_idx < len(basic_list):
                    final_list.append(basic_list[basic_idx])
                    basic_idx += 1
        else:
            # Take from basic if available, otherwise from premium
            if basic_idx < len(basic_list):
                final_list.append(basic_list[basic_idx])
                basic_idx += 1
            elif premium_idx < len(premium_list):
                final_list.append(premium_list[premium_idx])
                premium_idx += 1
        
        position += 1

    enriched = final_list

    for e in enriched:
        e.pop("rank", None)

    return jsonify({
        "success": True,
        "results": enriched
    })

# NEW: VIEW ALL FREELANCERS (even if client didn’t search)
# ============================================================

@app.route("/freelancers/all", methods=["GET"])
def freelancers_all():
    # NEW CODE: Add Row factory for safe column access
    conn = freelancer_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT
            f.id,
            f.name,
            COALESCE(fp.title, '') as title,
            COALESCE(fp.skills, '') as skills,
            COALESCE(fp.experience, 0) as experience,
            COALESCE(fp.min_budget, 0) as min_budget,
            COALESCE(fp.max_budget, 0) as max_budget,
            COALESCE(fp.rating, 0) as rating,
            COALESCE(fp.category, '') as category,
            COALESCE(fp.bio, '') as bio,
            COALESCE(fp.availability_status, 'AVAILABLE') as availability_status,
            COALESCE(fp.pricing_type, '') as pricing_type,
            COALESCE(fp.hourly_rate, 0) as hourly_rate,
            COALESCE(fp.per_person_rate, 0) as per_person_rate,
            COALESCE(fp.starting_price, 0) as starting_price,
            COALESCE(fp.fixed_price, 0) as fixed_price
        FROM freelancer f
        LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
        ORDER BY f.id DESC
    """)
    rows = cur.fetchall()
    conn.close()

    out = []
    for r in rows:
        freelancer_data = {
            "freelancer_id": r["id"],
            "name": r["name"],
            "title": r["title"],
            "skills": r["skills"],
            "experience": r["experience"],
            "budget_range": f"{r['min_budget']} - {r['max_budget']}",
            "rating": r["rating"],
            "category": r["category"],
            "bio": r["bio"],
            "availability_status": r["availability_status"],
            # Add pricing fields
            "pricing_type": r["pricing_type"],
            "hourly_rate": r["hourly_rate"],
            "per_person_rate": r["per_person_rate"],
            "starting_price": r["starting_price"],
            "fixed_price": r["fixed_price"]
        }
        # Enhance with pricing display fields
        enhance_freelancer_with_pricing(freelancer_data)
        out.append(freelancer_data)
    return jsonify({"success": True, "results": out})

@app.route("/freelancers/<int:freelancer_id>", methods=["GET"])
def freelancer_details(freelancer_id: int):
    # Use the enhanced get_freelancer_profile function that includes all new fields
    from database import get_freelancer_profile
    
    profile_data = get_freelancer_profile(freelancer_id)
    if not profile_data:
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404

    # Create response data with all existing fields
    response_data = {
        "success": True,
        "freelancer_id": profile_data["id"],
        "name": profile_data["name"],
        "email": profile_data["email"],
        "title": profile_data["title"],
        "skills": profile_data["skills"],
        "experience": profile_data["experience"],
        "experience_formatted": profile_data.get("experience_formatted"),
        "min_budget": profile_data["min_budget"],
        "max_budget": profile_data["max_budget"],
        "rating": profile_data["rating"],
        "category": profile_data["category"],
        "bio": profile_data["bio"],
        "projects_completed": profile_data.get("projects_completed"),
        "availability_status": profile_data.get("availability_status"),
        "profile_image": profile_data.get("profile_image"),
        "location": profile_data.get("location"),
        "pincode": profile_data.get("pincode"),
        "latitude": profile_data.get("latitude"),
        "longitude": profile_data.get("longitude"),
        "tags": profile_data.get("tags"),
        "supports_fixed": profile_data.get("supports_fixed", True),
        "supports_hourly": profile_data.get("supports_hourly", True),
        "fixed_price": profile_data.get("fixed_price"),
        "hourly_rate": profile_data.get("hourly_rate"),
        "overtime_rate_per_hour": profile_data.get("overtime_rate_per_hour"),
        "pricing_type": profile_data.get("pricing_type"),
        # Add additional pricing fields
        "per_person_rate": profile_data.get("per_person_rate"),
        "starting_price": profile_data.get("starting_price"),
        "portfolio_images": profile_data.get("portfolio_images", [])
    }
    
    # Enhance with pricing display fields
    enhance_freelancer_with_pricing(response_data)
    response_data['phone'] = profile_data.get('phone') or "Not Available"
    
    return jsonify(response_data)

@app.route("/freelancers/filter", methods=["GET"])
def freelancers_filter():
    try:
        top_rated = request.args.get("top_rated")
        category = request.args.get("category")
        subscribed = request.args.get("subscribed")
        verified_only = request.args.get("verified_only")
        results = fetch_filtered_freelancers(top_rated, category, subscribed, verified_only)
        return jsonify({"success": True, "results": results})
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

# Legacy conversation endpoint removed - replaced by consolidated system below
        conn.close()
        print(f"Error in create_or_get_conversation: {e}")
        return jsonify({"success": False, "msg": "Failed to create/get conversation"}), 500

# ============================================================
# NEW: CHAT (Client <-> Freelancer)
# ============================================================

@app.route("/client/message/send", methods=["POST"])
def client_send_message():
    d = get_json()
    missing = require_fields(d, ["client_id", "freelancer_id", "text"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    try:
        client_id = int(d["client_id"])
        freelancer_id = int(d["freelancer_id"])
        text = str(d["text"])
        timestamp = now_ts()
        
        # Step 1: Ensure conversation exists or create it
        cur.execute("""
            SELECT id FROM conversation 
            WHERE client_id=%s AND freelancer_id=%s
        """, (client_id, freelancer_id))
        conv_row = cur.fetchone()
        
        if conv_row:
            conv_id = conv_row["id"]
        else:
            # Create new conversation
            cur.execute("""
                INSERT INTO conversation (client_id, freelancer_id, last_message_text, last_message_timestamp)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (client_id, freelancer_id, None, None))
            conv_id = cur.fetchone()["id"]
        
        # Step 2: Insert message with conversation_id
        cur.execute("""
            INSERT INTO message (conversation_id, sender_role, sender_id, receiver_id, text, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (conv_id, "client", client_id, freelancer_id, text, timestamp))
        msg_id = cur.fetchone()["id"]
        
        # Step 3: Update conversation's last message
        cur.execute("""
            UPDATE conversation 
            SET last_message_text=%s, last_message_timestamp=%s
            WHERE id=%s
        """, (text, timestamp, conv_id))

        # Step 4: Emit real-time message via WebSocket if available
        if SOCKET_IO_ENABLED and socketio is not None:
            message_data = {
                'id': msg_id,
                'conversation_id': conv_id,
                'sender_id': str(client_id),
                'receiver_id': str(freelancer_id),
                'sender_role': 'client',
                'text': text,
                'timestamp': timestamp
            }
            socketio.emit('new_message', message_data, room=f"user_{freelancer_id}")
            socketio.emit('new_message', message_data, room=f"conv_{conv_id}")
            logger.info(f'[SOCKET] Real-time message sent from client {client_id} to freelancer {freelancer_id}')

        # Step 5: Get names for notifications
        cur.execute("SELECT name FROM freelancer WHERE id=%s", (freelancer_id,))
        freelancer_row = cur.fetchone()
        freelancer_name = (freelancer_row.get("name") if isinstance(freelancer_row, dict) else (freelancer_row[0] if freelancer_row else None)) or "Freelancer"
        
        cur.execute("SELECT name FROM client WHERE id=%s", (client_id,))
        client_row = cur.fetchone()
        client_name = (client_row.get("name") if isinstance(client_row, dict) else (client_row[0] if client_row else None)) or "Client"

        # Step 6: Add notifications
        try:
            from notification_helper import notify_client
            notify_client(
                client_id=client_id,
                message=f'You sent a message to {freelancer_name}',
                title="Message Sent",
                related_entity_type="message",
                related_entity_id=msg_id
            )
            notify_freelancer(
                freelancer_id=freelancer_id,
                message=f'New message from {client_name}',
                title="New Message",
                related_entity_type="message",
                related_entity_id=msg_id
            )
        except Exception as e:
            logger.warning(f"Error creating message notifications: {e}")

        conn.commit()
        conn.close()

        return jsonify({"success": True, "message_id": msg_id, "conversation_id": conv_id})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        logger.error(f"Error in client_send_message: {e}", exc_info=True)
        return jsonify({"success": False, "msg": "Failed to send message"}), 500

@app.route("/freelancer/message/send", methods=["POST"])
def freelancer_send_message():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "client_id", "text"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    try:
        freelancer_id = int(d["freelancer_id"])
        client_id = int(d["client_id"])
        text = str(d["text"])
        timestamp = now_ts()
        
        # Step 1: Ensure conversation exists or create it
        cur.execute("""
            SELECT id FROM conversation 
            WHERE client_id=%s AND freelancer_id=%s
        """, (client_id, freelancer_id))
        conv_row = cur.fetchone()
        
        if conv_row:
            conv_id = conv_row["id"]
        else:
            # Create new conversation
            cur.execute("""
                INSERT INTO conversation (client_id, freelancer_id, last_message_text, last_message_timestamp)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (client_id, freelancer_id, None, None))
            conv_id = cur.fetchone()["id"]
        
        # Step 2: Insert message with conversation_id
        cur.execute("""
            INSERT INTO message (conversation_id, sender_role, sender_id, receiver_id, text, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (conv_id, "freelancer", freelancer_id, client_id, text, timestamp))
        msg_id = cur.fetchone()["id"]
        
        # Step 3: Update conversation's last message
        cur.execute("""
            UPDATE conversation 
            SET last_message_text=%s, last_message_timestamp=%s
            WHERE id=%s
        """, (text, timestamp, conv_id))

        # Step 4: Emit real-time message via WebSocket if available
        if SOCKET_IO_ENABLED and socketio is not None:
            message_data = {
                'id': msg_id,
                'conversation_id': conv_id,
                'sender_id': str(freelancer_id),
                'receiver_id': str(client_id),
                'sender_role': 'freelancer',
                'text': text,
                'timestamp': timestamp
            }
            socketio.emit('new_message', message_data, room=f"user_{client_id}")
            socketio.emit('new_message', message_data, room=f"conv_{conv_id}")
            logger.info(f'[SOCKET] Real-time message sent from freelancer {freelancer_id} to client {client_id}')

        # Step 5: Get names for notifications
        cur.execute("SELECT name FROM freelancer WHERE id=%s", (freelancer_id,))
        freelancer_row = cur.fetchone()
        freelancer_name = (freelancer_row.get("name") if isinstance(freelancer_row, dict) else (freelancer_row[0] if freelancer_row else None)) or "Freelancer"
        
        cur.execute("SELECT name FROM client WHERE id=%s", (client_id,))
        client_row = cur.fetchone()
        client_name = (client_row.get("name") if isinstance(client_row, dict) else (client_row[0] if client_row else None)) or "Client"

        # Step 6: Add notifications
        try:
            from notification_helper import notify_client
            notify_client(
                client_id=client_id,
                message=f'New message from {freelancer_name}',
                title="New Message",
                related_entity_type="message",
                related_entity_id=msg_id
            )
            notify_freelancer(
                freelancer_id=freelancer_id,
                message=f'You sent a message to {client_name}',
                title="Message Sent",
                related_entity_type="message",
                related_entity_id=msg_id
            )
        except Exception as e:
            logger.warning(f"Error creating message notifications: {e}")
        
        conn.commit()
        conn.close()

        return jsonify({"success": True, "message_id": msg_id, "conversation_id": conv_id})
        
    except Exception as e:
        conn.rollback()
        conn.close()
        logger.error(f"Error in freelancer_send_message: {e}", exc_info=True)
        return jsonify({"success": False, "msg": "Failed to send message"}), 500

@app.route("/message/<int:conversation_id>", methods=["GET"])
def get_messages_by_conversation(conversation_id):
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        SELECT id, sender_role, sender_id, receiver_id, text, timestamp as "createdAt"
        FROM message
        WHERE conversation_id=%s
        ORDER BY timestamp ASC
    """, (conversation_id,))
    rows = cur.fetchall()
    conn.close()

    chat = []
    for r in rows:
        chat.append({
            "id": r.get("id"),
            "sender_role": r.get("sender_role"),
            "sender_id": r.get("sender_id"),
            "receiver_id": r.get("receiver_id"),
            "text": r.get("text"),
            "timestamp": r.get("createdAt")
        })
    return jsonify({"success": True, "messages": chat})

# ============================================================
# NEW: HIRE (Client -> Freelancer)
# ============================================================

@app.route("/client/hire", methods=["POST"])
def client_hire():
    d = get_json()
    missing = require_fields(d, ["client_id", "freelancer_id", "contract_type"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    client_id = int(d["client_id"])
    freelancer_id = int(d["freelancer_id"])
    proposed_budget = float(d.get("proposed_budget", 0) or 0)
    contract_type = str(d["contract_type"]).upper()
    note = str(d.get("note", "")).strip()
    
    # Extract and validate date/time slots
    event_date = str(d.get("event_date") or "").strip()
    start_time = str(d.get("start_time") or "").strip()
    end_time = str(d.get("end_time") or "").strip()
    
    # Process venue data
    venue_choice = d.get("venue_source", "custom")  # Default to custom for backward compatibility
    custom_venue_data = {
        "event_address": str(d.get("event_address") or "").strip(),
        "event_city": str(d.get("event_city") or "").strip(),
        "event_pincode": str(d.get("event_pincode") or "").strip(),
        "event_landmark": str(d.get("event_landmark") or "").strip()
    } if venue_choice == "custom" else None
    
    # Prepare venue data
    venue_data, venue_error = prepare_venue_data(venue_choice, client_id, custom_venue_data)
    if venue_error:
        return jsonify({"success": False, "msg": venue_error}), 400
    
    # Validate venue data for all contract types
    is_valid, validation_error = validate_venue_data(venue_data)
    validation_warnings = []
    if not is_valid:
        return jsonify({"success": False, "msg": validation_error}), 400
    
    # Check location compatibility
    location_ok, location_note = check_venue_freelancer_compatibility(
        freelancer_id, 
        venue_data.get("event_pincode"), 
        venue_data.get("event_city")
    )
    
    # Validate contract type against freelancer pricing preferences and derive pricing_type
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        SELECT category, pricing_type, supports_fixed, supports_hourly, fixed_price, hourly_rate, per_person_rate, starting_price
        FROM freelancer_profile 
        WHERE freelancer_id = %s
    """, (freelancer_id,))
    freelancer_pricing = cur.fetchone()
    if not freelancer_pricing:
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer pricing preferences not found"}), 400

    if isinstance(freelancer_pricing, dict):
        category = freelancer_pricing.get("category")
        profile_pricing_type = freelancer_pricing.get("pricing_type")
        supports_fixed = freelancer_pricing.get("supports_fixed", True)
        supports_hourly = freelancer_pricing.get("supports_hourly", True)
        fp_fixed_price = freelancer_pricing.get("fixed_price")
        fp_hourly_rate = freelancer_pricing.get("hourly_rate")
        fp_per_person_rate = freelancer_pricing.get("per_person_rate")
        fp_starting_price = freelancer_pricing.get("starting_price")
    else:
        # Positional fallback (kept only for safety)
        category = None
        profile_pricing_type = None
        supports_fixed = freelancer_pricing[2] if len(freelancer_pricing) > 2 else True
        supports_hourly = freelancer_pricing[3] if len(freelancer_pricing) > 3 else True
        fp_fixed_price = freelancer_pricing[4] if len(freelancer_pricing) > 4 else None
        fp_hourly_rate = freelancer_pricing[5] if len(freelancer_pricing) > 5 else None
        fp_per_person_rate = freelancer_pricing[6] if len(freelancer_pricing) > 6 else None
        fp_starting_price = freelancer_pricing[7] if len(freelancer_pricing) > 7 else None

    # Derive pricing_type from category as the primary source of truth
    try:
        pricing_type = get_pricing_type_for_category(category)
    except Exception:
        pricing_type = profile_pricing_type or None

    # Validate legacy contract_type against basic preferences
    if contract_type == "FIXED" and not supports_fixed:
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer does not support FIXED pricing"}), 400
    if contract_type == "HOURLY" and not supports_hourly:
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer does not support HOURLY pricing"}), 400
    if contract_type == "EVENT":
        conn.close()
        return jsonify({"success": False, "msg": "EVENT contract type is no longer supported. Use FIXED or HOURLY."}), 400
    
    # Validate date/time slot based on contract type
    if contract_type == "HOURLY":
        # HOURLY contracts require all date/time fields
        if not all([event_date, start_time, end_time]):
            return jsonify({"success": False, "msg": "HOURLY contracts require event_date, start_time, and end_time"}), 400
        
        # Validate the time slot
        is_valid, error_msg = validate_hire_request_slot(
            freelancer_id, event_date, start_time, end_time
        )
        if not is_valid:
            return jsonify({"success": False, "msg": error_msg}), 400
    else:
        # For non-HOURLY contracts, only require event_date
        if not event_date:
            return jsonify({"success": False, "msg": "event_date is required"}), 400
        
    
    
    # Pricing-type aware validation of client inputs
    client_budget = None
    number_of_persons = None
    selected_package_id = None
    guest_count = None
    additional_requirements = d.get("additional_requirements")

    if pricing_type == PRICING_TYPE_HOURLY:
        # Client must provide date + start/end; rate comes from profile
        if not all([event_date, start_time, end_time]):
            conn.close()
            return jsonify({"success": False, "msg": "Hourly hires require event_date, start_time, end_time"}), 400
        if not fp_hourly_rate:
            conn.close()
            return jsonify({"success": False, "msg": "Freelancer hourly_rate not configured"}), 400
        contract_type = "HOURLY"
        
        # Calculate total cost from hours × hourly rate
        try:
            from datetime import datetime as dt
            # Parse times - support both HH:MM and HH:MM AM/PM formats
            for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p"):
                try:
                    st = dt.strptime(start_time, fmt)
                    break
                except ValueError:
                    st = None
            for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p"):
                try:
                    et = dt.strptime(end_time, fmt)
                    break
                except ValueError:
                    et = None
            if st and et:
                diff_seconds = (et - st).total_seconds()
                if diff_seconds <= 0:
                    diff_seconds += 24 * 3600  # handle overnight
                total_hours = diff_seconds / 3600.0
                if total_hours <= 0:
                    conn.close()
                    return jsonify({"success": False, "msg": "Invalid hours duration (0 or negative)"}), 400
                proposed_budget = round(total_hours * float(fp_hourly_rate), 2)
                client_budget = proposed_budget
            else:
                conn.close()
                return jsonify({"success": False, "msg": "Could not parse start/end time format. Expected HH:MM"}), 400
        except Exception as e:
            conn.close()
            return jsonify({"success": False, "msg": f"Error calculating hourly budget: {str(e)}"}), 400

    elif pricing_type == PRICING_TYPE_PER_PERSON:
        # Only require event_date for PER_PERSON
        if not event_date:
            conn.close()
            return jsonify({"success": False, "msg": "event_date is required"}), 400
        number_of_persons = d.get("number_of_persons")
        if not number_of_persons:
            conn.close()
            return jsonify({"success": False, "msg": "Per-person hires require number_of_persons"}), 400
        try:
            number_of_persons = int(number_of_persons)
        except Exception:
            conn.close()
            return jsonify({"success": False, "msg": "number_of_persons must be integer"}), 400
        if number_of_persons <= 0:
            conn.close()
            return jsonify({"success": False, "msg": "number_of_persons must be > 0"}), 400
        if not fp_per_person_rate:
            conn.close()
            return jsonify({"success": False, "msg": "Freelancer per_person_rate not configured"}), 400
        client_budget = number_of_persons * float(fp_per_person_rate or 0)
        proposed_budget = client_budget
        contract_type = "FIXED"

    elif pricing_type == PRICING_TYPE_PACKAGE:
        # Only require event_date for PACKAGE
        if not event_date:
            conn.close()
            return jsonify({"success": False, "msg": "event_date is required"}), 400
        selected_package_id = d.get("selected_package_id")
        if not selected_package_id:
            conn.close()
            return jsonify({"success": False, "msg": "Package hires require selected_package_id"}), 400
        try:
            selected_package_id = int(selected_package_id)
        except Exception:
            conn.close()
            return jsonify({"success": False, "msg": "selected_package_id must be integer"}), 400
        # Validate package belongs to freelancer and get package details for snapshot
        cur.execute(
            "SELECT id, package_name, price, description FROM freelancer_package WHERE id=%s AND freelancer_id=%s",
            (selected_package_id, freelancer_id),
        )
        prow = cur.fetchone()
        if not prow:
            conn.close()
            return jsonify({"success": False, "msg": "Invalid package for this freelancer"}), 400
        
        # Extract package details for snapshot
        if isinstance(prow, dict):
            selected_package_name = prow.get("package_name")
            pkg_price = prow.get("price")
            selected_package_services = prow.get("description")
        else:
            selected_package_name = prow[1] if len(prow) > 1 else None
            pkg_price = prow[2] if len(prow) > 2 else 0
            selected_package_services = prow[3] if len(prow) > 3 else None
        
        proposed_budget = float(pkg_price or 0)
        client_budget = proposed_budget
        contract_type = "FIXED"

    elif pricing_type == PRICING_TYPE_PROJECT:
        # Only require event_date for PROJECT
        if not event_date:
            conn.close()
            return jsonify({"success": False, "msg": "event_date is required"}), 400
        if proposed_budget <= 0:
            conn.close()
            return jsonify({"success": False, "msg": "Project hires require a positive budget"}), 400
        client_budget = proposed_budget
        guest_count = d.get("guest_count")
        if guest_count is not None:
            try:
                guest_count = int(guest_count)
            except Exception:
                conn.close()
                return jsonify({"success": False, "msg": "guest_count must be integer"}), 400
        contract_type = "FIXED"

    # Validate contract type
    if contract_type not in ["FIXED", "HOURLY"]:
        conn.close()
        return jsonify({"success": False, "msg": "Invalid contract type. Use FIXED or HOURLY"}), 400

    # Validate budget generically only when we really need it
    if pricing_type not in (PRICING_TYPE_HOURLY,) and proposed_budget <= 0:
        conn.close()
        return jsonify({"success": False, "msg": "proposed_budget must be > 0"}), 400

    # simple existence check (reuse same connection)
    cur.execute("SELECT id FROM freelancer WHERE id=%s", (freelancer_id,))
    if not cur.fetchone():
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    # Check freelancer availability status
    cur.execute("SELECT availability_status FROM freelancer_profile WHERE freelancer_id=%s", (freelancer_id,))
    availability_result = cur.fetchone()
    if not availability_result:
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer availability not found"}), 400
    
    if isinstance(availability_result, dict):
        av = availability_result.get("availability_status")
    else:
        av = availability_result[0] if len(availability_result) > 0 else None
    if av == "ON_LEAVE":
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer is currently not accepting new projects"}), 403
    if FEATURE_ENFORCE_VERIFIED_FOR_HIRE_MESSAGE:
        try:
            cur.execute("SELECT COALESCE(is_verified,0) as is_verified FROM freelancer_profile WHERE freelancer_id=%s", (freelancer_id,))
            vr = cur.fetchone()
            if not vr:
                conn.close()
                return jsonify({"success": False, "msg": "Freelancer verification status not found"}), 400
            
            if isinstance(vr, dict):
                vr_val = vr.get("is_verified", 0)
            else:
                vr_val = vr[0] if len(vr) > 0 else 0
            if not vr or int(vr_val) != 1:
                conn.close()
                return jsonify({"success": False, "msg": "Freelancer not verified"}), 403
        except Exception:
            pass

    job_title = str(d.get("job_title", "")).strip()
    
    pricing_type_snapshot = pricing_type

    # Handle different contract types with pricing-type snapshot
    if contract_type == "FIXED":
        # Keep existing budget logic but attach pricing context
        # Include package snapshot if this is a package hire
        if pricing_type == PRICING_TYPE_PACKAGE:
            cur.execute("""
                INSERT INTO hire_request (client_id, freelancer_id, job_title, proposed_budget, note, status, contract_type, created_at, event_date, start_time, end_time, event_address, event_city, event_pincode, event_landmark, venue_source, pricing_type, client_budget, selected_package_id, selected_package_name, selected_package_price, selected_package_services, number_of_persons, guest_count, additional_requirements)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (client_id, freelancer_id, job_title, proposed_budget, note, 'PENDING', contract_type, now_ts(), event_date, start_time, end_time, 
                   venue_data.get("event_address"), venue_data.get("event_city"), venue_data.get("event_pincode"), 
                   venue_data.get("event_landmark"), venue_data.get("venue_source"), pricing_type_snapshot, client_budget, selected_package_id, 
                   selected_package_name, pkg_price, selected_package_services, number_of_persons, guest_count, additional_requirements))
        else:
            cur.execute("""
                INSERT INTO hire_request (client_id, freelancer_id, job_title, proposed_budget, note, status, contract_type, created_at, event_date, start_time, end_time, event_address, event_city, event_pincode, event_landmark, venue_source, pricing_type, client_budget, selected_package_id, number_of_persons, guest_count, additional_requirements)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (client_id, freelancer_id, job_title, proposed_budget, note, 'PENDING', contract_type, now_ts(), event_date, start_time, end_time, 
                   venue_data.get("event_address"), venue_data.get("event_city"), venue_data.get("event_pincode"), 
                   venue_data.get("event_landmark"), venue_data.get("venue_source"), pricing_type_snapshot, client_budget, selected_package_id, number_of_persons, guest_count, additional_requirements))
    elif contract_type == "HOURLY":
        # For hourly pricing-type categories, use freelancer snapshot rate
        hourly_rate = float(fp_hourly_rate or 0)
        if hourly_rate <= 0:
            conn.close()
            return jsonify({"success": False, "msg": "Freelancer hourly_rate not configured for HOURLY contract"}), 400
        
        cur.execute("""
            INSERT INTO hire_request (client_id, freelancer_id, job_title, proposed_budget, note, status, contract_type, contract_hourly_rate, contract_overtime_rate, created_at, event_date, start_time, end_time, event_address, event_city, event_pincode, event_landmark, venue_source, pricing_type, client_budget, selected_package_id, number_of_persons, guest_count, additional_requirements)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (client_id, freelancer_id, job_title, proposed_budget, note, 'PENDING', contract_type, hourly_rate, hourly_rate * 1.5, now_ts(), event_date, start_time, end_time,
               venue_data.get("event_address"), venue_data.get("event_city"), venue_data.get("event_pincode"), 
               venue_data.get("event_landmark"), venue_data.get("venue_source"), pricing_type_snapshot, client_budget, selected_package_id, number_of_persons, guest_count, additional_requirements))
    else:
        conn.close()
        return jsonify({"success": False, "msg": "Invalid contract type"}), 400
    req_row = cur.fetchone()
    req_id = req_row["id"] if isinstance(req_row, dict) else req_row[0]

    # Add notifications for both client and freelancer
    from notification_helper import notify_client, notify_freelancer
    
    # Notification for client (job posted)
    job_title_display = job_title if job_title else "Untitled"
    notify_client(
        client_id=client_id,
        message=f'Job "{job_title_display}" posted successfully',
        title="Job Posted",
        related_entity_type="hire_request",
        related_entity_id=req_id
    )
    
    # Get client name for freelancer notification
    cur.execute("SELECT name FROM client WHERE id=%s", (client_id,))
    client_row = cur.fetchone()
    client_name = (client_row.get("name") if isinstance(client_row, dict) else (client_row[0] if client_row else None)) or "Client"
    
    # Notification for freelancer (hire request received)
    notify_freelancer(
        freelancer_id=freelancer_id,
        message=f'New job request from {client_name}: "{job_title_display}"',
        title="New Job Request",
        related_entity_type="hire_request",
        related_entity_id=req_id
    )

    conn.commit()
    conn.close()

    # Prepare response with venue and location info
    response_data = {
        "success": True, 
        "request_id": req_id,
        "venue": {
            "event_address": venue_data.get("event_address"),
            "event_city": venue_data.get("event_city"),
            "event_pincode": venue_data.get("event_pincode"),
            "event_landmark": venue_data.get("event_landmark"),
            "venue_source": venue_data.get("venue_source")
        },
        "location_check": {
            "location_ok": location_ok,
            "location_note": location_note
        }
    }

    return jsonify(response_data)

@app.route("/freelancer/hire/inbox", methods=["GET"])
def freelancer_hire_inbox():
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "Missing freelancer_id"}), 400
    freelancer_id = int(freelancer_id)

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        SELECT id, client_id, proposed_budget, note, status, created_at, 
               contract_type, contract_hourly_rate, contract_overtime_rate, 
               weekly_limit, max_daily_hours, event_base_fee, event_included_hours, 
               event_overtime_rate, advance_paid,
               final_agreed_amount, counter_note, negotiation_status,
               job_title, payment_status, event_status, payout_status
        FROM hire_request
        WHERE freelancer_id=%s
        ORDER BY created_at DESC
    """, (freelancer_id,))
    rows = cur.fetchall()
    conn.close()

    # fetch client names from client.db (separate db => done per client_id)
    client_conn = client_db()
    client_cur = get_dict_cursor(client_conn)

    out = []
    for r in rows:
        if isinstance(r, dict):
            cid_val = r.get("client_id")
            cid = int(cid_val) if cid_val is not None else 0
            rid = r.get("id")
            budget = r.get("proposed_budget")
            note = r.get("note")
            status = r.get("status")
            created_at = r.get("created_at")
            contract_type = r.get("contract_type")
            hourly = r.get("contract_hourly_rate")
            overtime = r.get("contract_overtime_rate")
            limit = r.get("weekly_limit")
            daily = r.get("max_daily_hours")
            base = r.get("event_base_fee")
            inc_hours = r.get("event_included_hours")
            e_overtime = r.get("event_overtime_rate")
            advance = r.get("advance_paid")
            final_amount = r.get("final_agreed_amount")
            counter_note = r.get("counter_note")
            negotiation_status = r.get("negotiation_status")
            job_title_val = r.get("job_title")
            payment_status = r.get("payment_status")
            event_status = r.get("event_status")
            payout_status = r.get("payout_status")
        else:
            cid = int(r[1])
            rid = r[0]
            budget = r[2]
            note = r[3]
            status = r[4]
            created_at = r[5]
            contract_type = r[6]
            hourly = r[7]
            overtime = r[8]
            limit = r[9]
            daily = r[10]
            base = r[11]
            inc_hours = r[12]
            e_overtime = r[13]
            advance = r[14]
            final_amount = r[15] if len(r) > 15 else None
            counter_note = r[16] if len(r) > 16 else None
            negotiation_status = r[17] if len(r) > 17 else None
            job_title_val = r[18] if len(r) > 18 else None
            payment_status = r[19] if len(r) > 19 else None
            event_status = r[20] if len(r) > 20 else None
            payout_status = r[21] if len(r) > 21 else None

        client_cur.execute("SELECT name, email FROM client WHERE id=%s", (cid,))
        c = client_cur.fetchone()
        if c:
            if isinstance(c, dict):
                cname = c.get("name")
                cemail = c.get("email")
            else:
                cname = c[0] if len(c) > 0 else None
                cemail = c[1] if len(c) > 1 else None
        else:
            cname = "Unknown"
            cemail = ""

        out.append({
            "request_id": rid,
            "client_id": cid,
            "client_name": cname,
            "client_email": cemail,
            "job_title": job_title_val,
            "proposed_budget": budget,
            "note": note,
            "status": status,
            "created_at": created_at,
            "contract_type": contract_type,
            "contract_hourly_rate": hourly,
            "contract_overtime_rate": overtime,
            "weekly_limit": limit,
            "max_daily_hours": daily,
            "event_base_fee": base,
            "event_included_hours": inc_hours,
            "event_overtime_rate": e_overtime,
            "advance_paid": advance,
            "final_agreed_amount": final_amount,
            "counter_note": counter_note,
            "negotiation_status": negotiation_status,
            "payment_status": payment_status,
            "event_status": event_status,
            "payout_status": payout_status,
        })

    client_conn.close()
    return jsonify({"success": True, "requests": out})


@app.route("/freelancer/hire/respond", methods=["POST"])
def freelancer_hire_respond():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "request_id", "action"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    freelancer_id = int(d["freelancer_id"])
    request_id = int(d["request_id"])
    action = str(d["action"]).strip().upper()

    if action not in ("ACCEPT", "REJECT", "COUNTER"):
        return jsonify({"success": False, "msg": "action must be ACCEPT, REJECT, or COUNTER"}), 400

    # Handle counteroffer
    if action == "COUNTER":
        counter_offer_amount = d.get("counter_offer_amount")
        counter_offer_note = d.get("counter_offer_note", "")
        
        if not counter_offer_amount:
            return jsonify({"success": False, "msg": "counter_offer_amount is required for COUNTER action"}), 400
        
        try:
            counter_offer_amount = float(counter_offer_amount)
            if counter_offer_amount <= 0:
                return jsonify({"success": False, "msg": "counter_offer_amount must be greater than 0"}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "msg": "counter_offer_amount must be a valid number"}), 400
        
        new_status = "COUNTERED"
        update_fields = [
            new_status,
            counter_offer_amount,
            counter_offer_note,
            "FREELANCER",
            request_id, freelancer_id
        ]
        update_sql = """
            UPDATE hire_request
            SET status=%s, final_agreed_amount=%s, counter_note=%s, negotiation_status=%s
            WHERE id=%s AND freelancer_id=%s
        """
    else:
        new_status = "ACCEPTED" if action == "ACCEPT" else "REJECTED"
        update_fields = [new_status, request_id, freelancer_id]
        update_sql = """
            UPDATE hire_request
            SET status=%s
            WHERE id=%s AND freelancer_id=%s
        """

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute(update_sql, update_fields)

    if cur.rowcount == 0:
        conn.commit()
        conn.close()
        return jsonify({"success": False, "msg": "Request not found"}), 404

    conn.commit()
    conn.close()
    
    # Auto-create conversation and project when hire is accepted
    if action == "ACCEPT":
        create_project(request_id)
        try:
            # Get client and freelancer IDs from the hire request
            conn = freelancer_db()
            cur = get_dict_cursor(conn)
            cur.execute("SELECT client_id, freelancer_id FROM hire_request WHERE id=%s", (request_id,))
            hire_data = cur.fetchone()
            
            if hire_data:
                client_id = hire_data["client_id"]
                freelancer_id = hire_data["freelancer_id"]
                
                # Check if conversation already exists
                cur.execute("""
                    SELECT id FROM conversation 
                    WHERE client_id=%s AND freelancer_id=%s
                """, (client_id, freelancer_id))
                conv_row = cur.fetchone()
                
                welcome_message = f"Hi! I've accepted your hire request. Let's discuss the project details and get started!"
                
                if not conv_row:
                    # Create new conversation
                    cur.execute("""
                        INSERT INTO conversation (client_id, freelancer_id, last_message_text, last_message_timestamp)
                        VALUES (%s, %s, %s, %s)
                        RETURNING id
                    """, (client_id, freelancer_id, welcome_message, now_ts()))
                    conv_id = cur.fetchone()["id"]
                else:
                    conv_id = conv_row["id"]
                    # Update existing conversation
                    cur.execute("""
                        UPDATE conversation 
                        SET last_message_text=%s, last_message_timestamp=%s
                        WHERE id=%s
                    """, (welcome_message, now_ts(), conv_id))
                
                # Create the welcome message entry
                cur.execute("""
                    INSERT INTO message (conversation_id, sender_role, sender_id, receiver_id, text, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (conv_id, "freelancer", freelancer_id, client_id, welcome_message, now_ts()))
                
                conn.commit()
                print(f'[CONVERSATION] Created/Updated conversation {conv_id} for accepted hire: client {client_id} <-> freelancer {freelancer_id}')
                
                # Emit real-time notification if WebSocket is available
                if SOCKET_IO_ENABLED and socketio is not None:
                    message_data = {
                        'id': f"{int(time.time() * 1000)}_welcome",
                        'conversation_id': conv_id,
                        'sender_id': str(freelancer_id),
                        'receiver_id': str(client_id),
                        'sender_role': 'freelancer',
                        'text': welcome_message,
                        'timestamp': time.time()
                    }
                    socketio.emit('new_message', message_data, room=f"user_{client_id}")
                    print(f'[SOCKET] Sent welcome message to client {client_id}')
                    
            conn.close()
        except Exception as e:
            print(f"Error auto-creating conversation: {e}")
    
    # Send notification to freelancer for counteroffer
    if action == "COUNTER":
        try:
            # Get client_id from the hire request
            client_conn = client_db()
            client_cur = get_dict_cursor(client_conn)
            client_cur.execute("SELECT name, email FROM client WHERE id=%s", (request_id,))
            client_cur.execute("SELECT client_id FROM hire_request WHERE id=%s", (request_id,))
            client_result = client_cur.fetchone()
            client_conn.close()
            
            if client_result:
                client_id = client_result["client_id"]
                # Create notification for client
                freelancer_conn = freelancer_db()
                freelancer_cur = get_dict_cursor(freelancer_conn)
                
                # Use enhanced notification message for counteroffer
                context_data = {
                    "client_name": client_name,
                    "amount": counter_offer_amount
                }
                enhanced_message = enhance_notification_message(
                    f"Client sent counteroffer of ₹{counter_offer_amount}",
                    title="Counteroffer Received",
                    related_entity_type="payment",
                    context_data=context_data
                )
                
                # Add notification using unified system
                from notification_helper import notify_user
                notify_user(
                    user_id=client_id,
                    role="client",
                    title="Counteroffer Received",
                    message=enhanced_message,
                    related_entity_type="payment"
                )
                freelancer_conn.commit()
                freelancer_conn.close()
        except Exception as e:
            print(f"Error creating notification: {e}")
    
    # Send notification to client for counteroffer
    elif action == "COUNTER":
        try:
            # Get freelancer_id from the hire request
            conn = freelancer_db()
            cur = get_dict_cursor(conn)
            cur.execute("SELECT freelancer_id FROM hire_request WHERE id=%s", (request_id,))
            request_data = cur.fetchone()
            conn.close()
            
            if request_data:
                freelancer_id = request_data["freelancer_id"]
                # Create notification for freelancer
                client_conn = client_db()
                client_cur = get_dict_cursor(client_conn)
                
                # Use enhanced notification message for counteroffer
                context_data = {
                    "amount": counter_offer_amount
                }
                enhanced_message = enhance_notification_message(
                    f"Client sent counteroffer of ₹{counter_offer_amount}",
                    title="Counteroffer Received",
                    related_entity_type="payment",
                    context_data=context_data
                )
                
                # Add notification using unified system
                from notification_helper import notify_user
                notify_user(
                    user_id=freelancer_id,
                    role="freelancer",
                    title="Counteroffer Received",
                    message=enhanced_message,
                    related_entity_type="payment"
                )
                client_conn.commit()
                client_conn.close()
        except Exception as e:
            print(f"Error creating notification: {e}")
    
    return jsonify({"success": True, "status": new_status})

# ============================================================
# NEW CONVERSATION & MESSAGE SYSTEM
# ============================================================

@app.route("/conversations", methods=["POST"])
def create_conversation():
    d = get_json()
    missing = require_fields(d, ["sender_id", "receiver_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    # In our system, conversation is always between a client and a freelancer
    # We need to determine who is who, or just treat them as user_ids 
    # and use the hire_request logic context.
    # For now, let's assume we know who is the client and who is the freelancer 
    # based on the role passed or by checking the DB.
    
    sender_id = int(d["sender_id"])
    receiver_id = int(d["receiver_id"])
    sender_role = d.get("sender_role") # 'client' or 'freelancer'
    
    if sender_role == 'client':
        client_id, freelancer_id = sender_id, receiver_id
    elif sender_role == 'freelancer':
        client_id, freelancer_id = receiver_id, sender_id
    else:
        # Fallback: check which one is a client and which is a freelancer
        # But for simplicity, let's require sender_role or assume!
        return jsonify({"success": False, "msg": "sender_role ('client' or 'freelancer') is required"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Check if exists
    cur.execute("""
        SELECT id FROM conversation 
        WHERE client_id=%s AND freelancer_id=%s
    """, (client_id, freelancer_id))
    row = cur.fetchone()
    
    if row:
        conv_id = row["id"]
        conn.close()
        return jsonify({"success": True, "conversation_id": conv_id})
    
    # Create new
    cur.execute("""
        INSERT INTO conversation (client_id, freelancer_id, last_message_text, last_message_timestamp)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (client_id, freelancer_id, None, None))
    new_id = cur.fetchone()["id"]
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "conversation_id": new_id})

@app.route("/conversation/<int:user_id>", methods=["GET"])
def get_conversations_for_user(user_id):
    role = request.args.get("role") # 'client' or 'freelancer'
    if not role:
        return jsonify({"success": False, "msg": "role query param ('client' or 'freelancer') is required"}), 400
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    if role == 'client':
        cur.execute("""
            SELECT c.id as conversation_id, c.client_id, c.freelancer_id as other_user_id, 
                   f.name as other_user_name, f.profile_image as other_user_pic,
                   c.last_message_text, c.last_message_timestamp as timestamp
            FROM conversation c
            JOIN freelancer f ON c.freelancer_id = f.id
            WHERE c.client_id = %s
            ORDER BY c.last_message_timestamp DESC NULLS LAST
        """, (user_id,))
    else:
        cur.execute("""
            SELECT c.id as conversation_id, c.client_id as other_user_id, c.freelancer_id,
                   cl.name as other_user_name, cl.profile_image as other_user_pic,
                   c.last_message_text, c.last_message_timestamp as timestamp
            FROM conversation c
            JOIN client cl ON c.client_id = cl.id
            WHERE c.freelancer_id = %s
            ORDER BY c.last_message_timestamp DESC NULLS LAST
        """, (user_id,))
    
    rows = cur.fetchall()
    conn.close()
    
    out = []
    for r in rows:
        participants = [
            r["client_id"] if role == 'client' else r["other_user_id"],
            r["other_user_id"] if role == 'client' else r["freelancer_id"]
        ]
        out.append({
            "conversation_id": r["conversation_id"],
            "participants": participants,
            "other_user": {
                "id": r["other_user_id"],
                "name": r["other_user_name"] or "User",
                "profile_pic": r["other_user_pic"]
            },
            "last_message": r.get("last_message_text", ""),
            "updatedAt": r.get("timestamp", None)
        })
    
    return jsonify(out)

@app.route("/message/send", methods=["POST"])
def send_message_unified():
    d = get_json()
    missing = require_fields(d, ["conversation_id", "sender_id", "sender_role", "message"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    conv_id = int(d["conversation_id"])
    sender_id = int(d["sender_id"])
    sender_role = d["sender_role"]
    text = d["message"]
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Get conversation details to find receiver
    cur.execute("SELECT client_id, freelancer_id FROM conversation WHERE id=%s", (conv_id,))
    conv = cur.fetchone()
    if not conv:
        conn.close()
        return jsonify({"success": False, "msg": "Conversation not found"}), 404
    
    if sender_role == 'client':
        receiver_id = conv["freelancer_id"]
    else:
        receiver_id = conv["client_id"]
    
    timestamp = now_ts()
    
    # Save message
    cur.execute("""
        INSERT INTO message (conversation_id, sender_role, sender_id, receiver_id, text, timestamp)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (conv_id, sender_role, sender_id, receiver_id, text, timestamp))
    msg_id = cur.fetchone()["id"]
    
    # Update conversation
    cur.execute("""
        UPDATE conversation 
        SET last_message_text=%s, last_message_timestamp=%s
        WHERE id=%s
    """, (text, timestamp, conv_id))
    
    conn.commit()
    conn.close()
    
    # Real-time delivery
    if SOCKET_IO_ENABLED and socketio is not None:
        try:
            message_data = {
                'id': msg_id,
                'conversation_id': conv_id,
                'sender_id': str(sender_id),
                'receiver_id': str(receiver_id),
                'sender_role': sender_role,
                'text': text,
                'timestamp': timestamp,
                'type': 'message'
            }
            # Emit to receiver
            socketio.emit('receiveMessage', message_data, room=f"user_{receiver_id}")
            # Emit to sender confirmation
            socketio.emit('message_sent', message_data, room=f"user_{sender_id}")
            # Emit to conversation room
            socketio.emit('receiveMessage', message_data, room=f"conv_{conv_id}")
        except Exception as e:
            print(f'[SOCKET] Real-time delivery failed: {e}')
    
    return jsonify({"success": True, "message_id": msg_id, "timestamp": timestamp})

# ============================================================
# CLIENT – MESSAGE THREADS (list freelancers you chatted with)
# ============================================================

@app.route("/client/messages/threads", methods=["GET"])
def client_message_threads():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400

    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT
                CASE
                    WHEN sender_role='client' THEN receiver_id
                    ELSE sender_id
                END AS freelancer_id
            FROM message
            WHERE (sender_role='client' AND sender_id=%s)
               OR (sender_role='freelancer' AND receiver_id=%s)
            ORDER BY freelancer_id DESC
        """, (client_id, client_id))
        all_rows = cur.fetchall()
        ids = []
        for r in all_rows:
            val = r.get("freelancer_id", r[0] if not isinstance(r, dict) else None) if r else None
            if val is not None:
                ids.append(int(val))

        if not ids:
            conn.close()
            return jsonify([])

        out = []
        for fid in ids:
            cur.execute("SELECT name, email FROM freelancer WHERE id=%s", (fid,))
            fr = cur.fetchone()
            if isinstance(fr, dict):
                out.append({"freelancer_id": fid, "name": fr.get("name") or "Freelancer", "email": fr.get("email") or ""})
            else:
                out.append({"freelancer_id": fid, "name": (fr[0] if fr else "Freelancer"), "email": (fr[1] if fr else "")})

        conn.close()
        return jsonify(out)
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# FREELANCER – MESSAGE THREADS (list clients you chatted with)
# ============================================================

@app.route("/freelancer/messages/threads", methods=["GET"])
def freelancer_message_threads():
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400

    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT
                CASE
                    WHEN sender_role='freelancer' THEN receiver_id
                    ELSE sender_id
                END AS client_id
            FROM message
            WHERE (sender_role='freelancer' AND sender_id=%s)
               OR (sender_role='client' AND receiver_id=%s)
            ORDER BY client_id DESC
        """, (freelancer_id, freelancer_id))
        all_rows = cur.fetchall()
        ids = []
        for r in all_rows:
            val = r.get("client_id", r[0] if not isinstance(r, dict) else None) if r else None
            if val is not None:
                ids.append(int(val))

        if not ids:
            conn.close()
            return jsonify([])

        out = []
        for cid in ids:
            cur.execute("SELECT name, email FROM client WHERE id=%s", (cid,))
            cr = cur.fetchone()
            if isinstance(cr, dict):
                out.append({"client_id": cid, "name": cr.get("name") or "Client", "email": cr.get("email") or ""})
            else:
                out.append({"client_id": cid, "name": (cr[0] if cr else "Client"), "email": (cr[1] if cr else "")})

        conn.close()
        return jsonify(out)

    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# CLIENT – JOB REQUEST STATUS (detailed)
# ============================================================

@app.route("/client/job-requests", methods=["GET"])
def client_job_requests():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400

    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                hr.id,
                hr.freelancer_id,
                f.name,
                f.email,
                hr.job_title,
                hr.proposed_budget,
                hr.note,
                hr.status,
                hr.created_at,
                hr.final_agreed_amount,
                hr.counter_note,
                hr.negotiation_status
            FROM hire_request hr
            JOIN freelancer f ON f.id = hr.freelancer_id
            WHERE hr.client_id=%s
            ORDER BY hr.created_at DESC
        """, (client_id,))
        rows = cur.fetchall()
        conn.close()

        out = []
        for r in rows:
            if isinstance(r, dict):
                out.append({
                    "request_id": r.get("id"),
                    "freelancer_id": r.get("freelancer_id"),
                    "freelancer_name": r.get("name"),
                    "freelancer_email": r.get("email"),
                    "job_title": r.get("job_title") or "",
                    "proposed_budget": r.get("proposed_budget"),
                    "note": r.get("note") or "",
                    "status": r.get("status"),
                    "created_at": r.get("created_at"),
                    "final_agreed_amount": r.get("final_agreed_amount"),
                    "counter_note": r.get("counter_note"),
                    "negotiation_status": r.get("negotiation_status")
                })
            else:
                out.append({
                    "request_id": r[0], "freelancer_id": r[1], "freelancer_name": r[2], "freelancer_email": r[3],
                    "job_title": r[4] or "", "proposed_budget": r[5], "note": r[6] or "", "status": r[7], "created_at": r[8],
                    "final_agreed_amount": r[9] if len(r) > 9 else None,
                    "counter_note": r[10] if len(r) > 10 else None,
                    "negotiation_status": r[11] if len(r) > 11 else None
                })

        return jsonify({"success": True, "requests": out})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# CLIENT – VIEW MY JOBS
# ============================================================

@app.route("/client/jobs", methods=["GET"])
def client_jobs():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400

    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT pp.id, pp.title, pp.description, pp.category, 
                   pp.budget_min, pp.budget_max, pp.status as project_status,
                   latest_hr.status as hire_status
            FROM project_post pp
            LEFT JOIN (
                SELECT DISTINCT ON (job_title) job_title, status
                FROM hire_request 
                WHERE client_id = %s
                ORDER BY job_title, created_at DESC
            ) latest_hr ON pp.title = latest_hr.job_title
            WHERE pp.client_id = %s
            ORDER BY pp.created_at DESC
        """, (client_id, client_id))
        rows = cur.fetchall()
        conn.close()

        result = []
        for r in rows:
            if isinstance(r, dict):
                # Use hire_status as primary, fallback to project_status
                status = r.get("hire_status") or r.get("project_status", "unknown")
                # Format budget: show range if both min and max exist, otherwise single value
                budget_min = r.get("budget_min")
                budget_max = r.get("budget_max")
                if budget_min and budget_max and budget_min != budget_max:
                    budget = f"₹{budget_min}-{budget_max}"
                elif budget_max:
                    budget = f"₹{budget_max}"
                elif budget_min:
                    budget = f"₹{budget_min}"
                else:
                    budget = "N/A"
                
                result.append({
                    "id": r.get("id"),
                    "title": r.get("title") or "Untitled",
                    "description": r.get("description") or "N/A",
                    "category": r.get("category") or "N/A",
                    "budget": budget,
                    "status": str(status).lower()
                })
            else:
                # Handle tuple format (fallback)
                project_id, title, description, category = r[0], r[1], r[2], r[3]
                budget_min, budget_max, project_status, hire_status = r[4], r[5], r[6], r[7] if len(r) > 7 else None
                
                if budget_min and budget_max and budget_min != budget_max:
                    budget = f"₹{budget_min}-{budget_max}"
                elif budget_max:
                    budget = f"₹{budget_max}"
                elif budget_min:
                    budget = f"₹{budget_min}"
                else:
                    budget = "N/A"
                
                # Use hire_status as primary, fallback to project_status
                status = hire_status or project_status or "unknown"
                
                result.append({
                    "id": project_id,
                    "title": title or "Untitled",
                    "description": description or "N/A",
                    "category": category or "N/A",
                    "budget": budget,
                    "status": str(status).lower()
                })
        return jsonify(result)
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# CLIENT – SAVE FREELANCER
# ============================================================

@app.route("/client/save-freelancer", methods=["POST"])
def save_freelancer():
    d = request.get_json()
    missing = require_fields(d, ["client_id", "freelancer_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            INSERT INTO saved_freelancer (client_id, freelancer_id)
            VALUES (%s,%s)
            ON CONFLICT (client_id, freelancer_id) DO NOTHING
        """, (int(d["client_id"]), int(d["freelancer_id"])))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500


@app.route("/client/unsave-freelancer", methods=["DELETE", "POST"])
def unsave_freelancer():
    """Remove a freelancer from client's saved list"""
    d = request.get_json() or {}
    missing = require_fields(d, ["client_id", "freelancer_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute(
            "DELETE FROM saved_freelancer WHERE client_id=%s AND freelancer_id=%s",
            (int(d["client_id"]), int(d["freelancer_id"]))
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/client/hire/counter", methods=["POST"])
def client_hire_counter():
    """Client responds to a freelancer counteroffer"""
    d = get_json()
    missing = require_fields(d, ["client_id", "request_id", "action"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    client_id = int(d["client_id"])
    request_id = int(d["request_id"])
    action = str(d["action"]).strip().upper()

    if action not in ("ACCEPT", "REJECT", "COUNTER"):
        return jsonify({"success": False, "msg": "action must be ACCEPT, REJECT, or COUNTER"}), 400

    # Verify the request belongs to this client
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("SELECT id, client_id, status FROM hire_request WHERE id=%s", (request_id,))
    request = cur.fetchone()
    conn.close()

    if not request or request["client_id"] != client_id:
        return jsonify({"success": False, "msg": "Request not found or access denied"}), 404

    if request["status"] not in ["COUNTERED", "PENDING"]:
        return jsonify({"success": False, "msg": "Request cannot be countered in current status"}), 400

    # Handle counteroffer
    if action == "COUNTER":
        counter_offer_amount = d.get("counter_offer_amount")
        counter_offer_note = d.get("counter_offer_note", "")
        
        if not counter_offer_amount:
            return jsonify({"success": False, "msg": "counter_offer_amount is required for COUNTER action"}), 400
        
        try:
            counter_offer_amount = float(counter_offer_amount)
            if counter_offer_amount <= 0:
                return jsonify({"success": False, "msg": "counter_offer_amount must be greater than 0"}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "msg": "counter_offer_amount must be a valid number"}), 400
        
        new_status = "COUNTERED"
        update_fields = [
            new_status,
            counter_offer_amount,
            counter_offer_note,
            "CLIENT",
            request_id
        ]
        update_sql = """
            UPDATE hire_request
            SET status=%s, final_agreed_amount=%s, counter_note=%s, negotiation_status=%s
            WHERE id=%s
        """
        message = f"Client sent a counteroffer of ₹{counter_offer_amount} for your hire request."
    else:
        new_status = "ACCEPTED" if action == "ACCEPT" else "REJECTED"
        update_fields = [new_status, request_id]
        update_sql = """
            UPDATE hire_request
            SET status=%s
            WHERE id=%s
        """
        message = f"Your counteroffer was {new_status.lower()}." if new_status in ["ACCEPTED", "REJECTED"] else None

    # Update the request
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute(update_sql, update_fields)

    if cur.rowcount == 0:
        conn.commit()
        conn.close()
        return jsonify({"success": False, "msg": "Request not found"}), 404

    conn.commit()
    conn.close()

    if action == "ACCEPT":
        create_project(request_id)

    # Send notifications for counteroffer actions
    try:
        from notification_helper import notify_client, notify_freelancer
        
        # Get request details
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT freelancer_id, client_id, job_title FROM hire_request WHERE id=%s", (request_id,))
        req_data = cur.fetchone()
        conn.close()
        
        if req_data:
            freelancer_id, client_id, job_title = req_data
            job_title = job_title or "Untitled"
            
            if action == "COUNTER":
                # Notify freelancer about client's counteroffer
                notify_freelancer(
                    freelancer_id=freelancer_id,
                    message=f'Client sent a counteroffer of ₹{counter_offer_amount} for "{job_title}"',
                    title="New Counteroffer",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
                
                # Notify client about their own counteroffer (confirmation)
                notify_client(
                    client_id=client_id,
                    message=f'You sent a counteroffer of ₹{counter_offer_amount} for "{job_title}"',
                    title="Counteroffer Sent",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
                
            elif action == "ACCEPT":
                # Log transaction for agreement
                try:
                    from admin_db import log_transaction
                    cur.execute("SELECT proposed_budget, final_agreed_amount FROM hire_request WHERE id=%s", (request_id,))
                    h_res = cur.fetchone()
                    if h_res:
                        amt = h_res[1] or h_res[0] or 0
                        log_transaction(freelancer_id, client_id, float(amt), "Accepted", request_id)
                except Exception as e:
                    print(f"Error logging accepted hire: {e}")

                # Notify freelancer that client accepted their counteroffer
                notify_freelancer(
                    freelancer_id=freelancer_id,
                    message=f'Client accepted your counteroffer for "{job_title}"',
                    title="Counteroffer Accepted",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
                
                # Notify client about acceptance confirmation
                notify_client(
                    client_id=client_id,
                    message=f'You accepted the counteroffer for "{job_title}"',
                    title="Counteroffer Accepted",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
                
            elif action == "REJECT":
                # Notify freelancer that client rejected their counteroffer
                notify_freelancer(
                    freelancer_id=freelancer_id,
                    message=f'Client rejected your counteroffer for "{job_title}"',
                    title="Counteroffer Rejected",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
                
                # Notify client about rejection confirmation
                notify_client(
                    client_id=client_id,
                    message=f'You rejected the counteroffer for "{job_title}"',
                    title="Counteroffer Rejected",
                    related_entity_type="hire_request",
                    related_entity_id=request_id
                )
    except Exception as e:
        print(f"Error creating counteroffer notifications: {e}")

    return jsonify({"success": True, "status": new_status})

# ============================================================
# CLIENT – VIEW SAVED FREELANCERS
# ============================================================

@app.route("/client/saved-freelancers", methods=["GET"])
def saved_freelancers():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400

    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT 
                f.id, f.name, f.profile_image,
                COALESCE(fp.title, '') as title,
                COALESCE(fp.skills, '') as skills,
                COALESCE(fp.experience, 0) as experience,
                COALESCE(fp.min_budget, 0) as min_budget,
                COALESCE(fp.max_budget, 0) as max_budget,
                COALESCE(fp.rating, 0) as rating,
                COALESCE(fp.category, '') as category,
                COALESCE(fp.bio, '') as bio,
                COALESCE(fp.availability_status, 'AVAILABLE') as availability_status,
                COALESCE(fp.pricing_type, '') as pricing_type,
                COALESCE(fp.hourly_rate, 0) as hourly_rate,
                COALESCE(fp.per_person_rate, 0) as per_person_rate,
                COALESCE(fp.starting_price, 0) as starting_price,
                COALESCE(fp.fixed_price, 0) as fixed_price
            FROM saved_freelancer s
            JOIN freelancer f ON f.id = s.freelancer_id
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE s.client_id=%s
        """, (client_id,))
        rows = cur.fetchall()
        conn.close()

        result = []
        for r in rows:
            if isinstance(r, dict):
                freelancer_data = {
                    "freelancer_id": r["id"],
                    "name": r["name"],
                    "profile_image": r.get("profile_image"),
                    "title": r["title"],
                    "skills": r["skills"],
                    "experience": r["experience"],
                    "budget_range": f"{r['min_budget']} - {r['max_budget']}",
                    "rating": r["rating"],
                    "category": r["category"],
                    "bio": r["bio"],
                    "availability_status": r["availability_status"],
                    "pricing_type": r["pricing_type"],
                    "hourly_rate": r["hourly_rate"],
                    "per_person_rate": r["per_person_rate"],
                    "starting_price": r["starting_price"],
                    "fixed_price": r["fixed_price"]
                }
                enhance_freelancer_with_pricing(freelancer_data)
                result.append(freelancer_data)
        return jsonify(result)
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# CLIENT – SEND NOTIFICATION (for verification/test)
# ============================================================

@app.route("/client/send-notification", methods=["POST"])
def client_send_notification():
    """Create a notification for a client (used by CLI/verification)"""
    d = request.get_json() or {}
    client_id = d.get("client_id")
    message = d.get("message", "Notification")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400
    try:
        client_id = int(client_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400
    try:
        conn = client_db()
        cur = get_dict_cursor(conn)
        
        # Use enhanced notification message
        enhanced_message = enhance_notification_message(
            str(message),
            title="Notification",
            related_entity_type="SYSTEM"
        )
        
        # Add notification using unified system
        from notification_helper import notify_user
        notify_user(
            user_id=client_id,
            role="client",
            title="Notification",
            message=enhanced_message,
            related_entity_type="SYSTEM"
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# CLIENT – NOTIFICATIONS
# ============================================================

@app.route("/client/notifications", methods=["GET"])
def client_notifications():
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400

    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    try:
        from notification_helper import get_client_notifications
        
        notifications = get_client_notifications(client_id, limit=50)

        return jsonify({"success": True, "notifications": notifications})
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# FREELANCER – STATS / EARNINGS & PERFORMANCE
# ============================================================

@app.route("/freelancer/stats", methods=["GET"])
def freelancer_stats():
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400

    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)

        # Total earnings and completed jobs (ACCEPTED)
        cur.execute("""
            SELECT COUNT(*) as cnt, COALESCE(SUM(proposed_budget), 0) as total
            FROM hire_request
            WHERE freelancer_id=%s AND status='ACCEPTED'
        """, (freelancer_id,))
        row = cur.fetchone()
        if isinstance(row, dict):
            completed_jobs = int(row.get("cnt", 0) or 0)
            total_earnings = float(row.get("total", 0) or 0.0)
        else:
            completed_jobs = int(row[0] if row and len(row) > 0 else 0)
            total_earnings = float(row[1] if row and len(row) > 1 else 0.0)

        # Total jobs for job success %
        cur.execute("""
            SELECT COUNT(*) as cnt
            FROM hire_request
            WHERE freelancer_id=%s
        """, (freelancer_id,))
        total_jobs_row = cur.fetchone()
        if isinstance(total_jobs_row, dict):
            total_jobs = int(total_jobs_row.get("cnt", 0) or 0)
        else:
            total_jobs = int(total_jobs_row[0] if total_jobs_row and len(total_jobs_row) > 0 else 0)

        # Rating from profile
        cur.execute("""
            SELECT COALESCE(rating, 0) as rating
            FROM freelancer_profile
            WHERE freelancer_id=%s
        """, (freelancer_id,))
        rating_row = cur.fetchone()
        if isinstance(rating_row, dict):
            rating = float(rating_row.get("rating", 0) or 0.0)
        else:
            rating = float(rating_row[0] if rating_row and len(rating_row) > 0 else 0.0)

        job_success = 0.0
        if total_jobs > 0:
            job_success = round((completed_jobs / total_jobs) * 100.0, 2)

        conn.close()
        return jsonify({
            "success": True,
            "total_earnings": total_earnings,
            "completed_jobs": completed_jobs,
            "rating": rating,
            "job_success_percent": job_success
        })
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# FREELANCER – SAVED CLIENTS
# ============================================================

@app.route("/freelancer/save-client", methods=["POST"])
def freelancer_save_client():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "client_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            INSERT INTO saved_client (freelancer_id, client_id)
            VALUES (%s, %s)
            ON CONFLICT (freelancer_id, client_id) DO NOTHING
        """, (int(d["freelancer_id"]), int(d["client_id"])))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500


@app.route("/freelancer/unsave-client", methods=["POST"])
def freelancer_unsave_client():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "client_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            DELETE FROM saved_client
            WHERE freelancer_id=%s AND client_id=%s
        """, (int(d["freelancer_id"]), int(d["client_id"])))
        conn.commit()
        conn.close()
        
        if cur.rowcount > 0:
            return jsonify({"success": True, "msg": "Client removed successfully"})
        else:
            return jsonify({"success": True, "msg": "Client was not in saved list"})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500


@app.route("/freelancer/saved-clients", methods=["GET"])
def freelancer_saved_clients():
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400

    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    conn = None
    client_conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT sc.client_id, sc.name, sc.email, sc.created_at
            FROM saved_client sc
            JOIN client c ON sc.client_id = c.id
            WHERE sc.freelancer_id=%s
            ORDER BY sc.created_at DESC
        """, (freelancer_id,))
        rows = cur.fetchall()
        conn.close()
        
        # Build response with client information
        clients_list = []
        for r in rows:
            if isinstance(r, dict):
                clients_list.append({
                    "client_id": r.get("client_id"),
                    "name": r.get("name", "Unknown"),
                    "email": r.get("email", "Unknown"),
                    "created_at": r.get("created_at")
                })
            else:
                # Handle legacy format
                clients_list.append({
                    "client_id": r[0] if len(r) > 0 else None,
                    "name": r[1] if len(r) > 1 else None,
                    "email": r[2] if len(r) > 2 else None,
                    "created_at": r[3] if len(r) > 3 else None
                })
        
        return jsonify({"success": True, "clients": clients_list})
        client_conn = client_db()
        client_cur = get_dict_cursor(client_conn)

        out = []
        for cid in client_ids:
            # Join client and client_profile tables to get complete information
            client_cur.execute("""
                SELECT c.id, c.name, c.email, c.profile_image,
                       cp.location, cp.bio, cp.phone
                FROM client c
                LEFT JOIN client_profile cp ON c.id = cp.client_id
                WHERE c.id=%s
            """, (cid,))
            c = client_cur.fetchone()
            if c:
                if isinstance(c, dict):
                    client_info = {
                        "client_id": cid,
                        "name": c.get("name"),
                        "email": c.get("email"),
                        "profile_image": c.get("profile_image"),
                        "location": c.get("location"),
                        "bio": c.get("bio"),
                        "phone": c.get("phone"),
                        "saved_at": saved_at_map.get(cid)
                    }
                else:
                    client_info = {
                        "client_id": cid,
                        "name": c[1],
                        "email": c[2],
                        "profile_image": c[3],
                        "location": c[4],
                        "bio": c[5],
                        "phone": c[6],
                        "saved_at": saved_at_map.get(cid)
                    }
                out.append(client_info)

        client_conn.close()
        return jsonify({"success": True, "clients": out})
    except Exception as e:
        if client_conn:
            client_conn.close()
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# FREELANCER – ACCOUNT SETTINGS (EMAIL / PASSWORD)
# ============================================================

@app.route("/freelancer/change-password", methods=["POST"])
def freelancer_change_password():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "old_password", "new_password"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    freelancer_id = int(d["freelancer_id"])
    old_password = str(d["old_password"])
    new_password = str(d["new_password"])

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT password FROM freelancer WHERE id=%s", (freelancer_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404

        if not check_password_hash(row.get("password", row[0] if not isinstance(row, dict) else ""), old_password):
            conn.close()
            return jsonify({"success": False, "msg": "Old password incorrect"}), 400

        cur.execute(
            "UPDATE freelancer SET password=%s WHERE id=%s",
            (generate_password_hash(new_password), freelancer_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500


@app.route("/freelancer/update-email", methods=["POST"])
def freelancer_update_email():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "new_email"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    freelancer_id = int(d["freelancer_id"])
    new_email = str(d["new_email"]).strip().lower()

    if not valid_email(new_email):
        return jsonify({"success": False, "msg": "Invalid email"}), 400

    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute(
            "UPDATE freelancer SET email=%s WHERE id=%s",
            (new_email, freelancer_id)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except psycopg2.errors.UniqueViolation:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": "Email already in use"}), 409
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# FREELANCER – NOTIFICATIONS / ACTIVITY (derived)
# ============================================================

@app.route("/freelancer/notifications", methods=["GET"])
def freelancer_notifications():
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400

    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    try:
        from notification_helper import get_freelancer_notifications
        
        notifications = get_freelancer_notifications(freelancer_id, limit=50)

        return jsonify({"success": True, "notifications": notifications})
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

# ============================================================
# GOOGLE OAUTH ROUTES (ADDED)
# - DOES NOT TOUCH EXISTING LOGIN/SIGNUP/OTP
# ============================================================

@app.route("/auth/google", methods=["GET"])
@app.route("/auth/google/start", methods=["GET"])
def google_oauth_start():
    _google_state_cleanup()

    role = (request.args.get("role", "") or "").strip().lower()
    if role not in ("client", "freelancer"):
        return jsonify({"success": False, "msg": "role must be client or freelancer"}), 400

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return jsonify({
            "success": False,
            "msg": "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        }), 500

    state = secrets.token_urlsafe(24)

    GOOGLE_OAUTH_STATES[state] = {
        "role": role,
        "created_at": now_ts(),
        "done": False,
        "result": None
    }

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account"
    }

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return jsonify({"success": True, "auth_url": auth_url, "state": state})


@app.route("/auth/google/callback", methods=["GET"])
def google_oauth_callback():
    _google_state_cleanup()

    code = request.args.get("code")
    state = request.args.get("state")

    if not code or not state:
        return redirect(_google_frontend_callback_url({
            "error": "Missing code or state from Google."
        }))

    st = GOOGLE_OAUTH_STATES.get(state)
    if not st:
        return redirect(_google_frontend_callback_url({
            "error": "Google login session expired. Please try again."
        }))

    role = st["role"]

    # 1) Exchange code -> tokens
    token_res = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code"
        },
        timeout=15
    )

    if token_res.status_code != 200:
        st["done"] = True
        st["result"] = {"success": False, "msg": "Token exchange failed"}
        return redirect(_google_frontend_callback_url({
            "error": "Google token exchange failed. Please try again."
        }))

    token_data = token_res.json()
    id_token = token_data.get("id_token")
    if not id_token:
        st["done"] = True
        st["result"] = {"success": False, "msg": "No id_token returned"}
        return redirect(_google_frontend_callback_url({
            "error": "Google did not return an ID token."
        }))

    # 2) Verify ID token using Google's tokeninfo endpoint (no extra libs needed)
    info_res = requests.get(
        "https://oauth2.googleapis.com/tokeninfo",
        params={"id_token": id_token},
        timeout=15
    )

    if info_res.status_code != 200:
        st["done"] = True
        st["result"] = {"success": False, "msg": "Token verification failed"}
        return redirect(_google_frontend_callback_url({
            "error": "Google token verification failed."
        }))

    info = info_res.json()

    # Basic checks
    aud = info.get("aud")
    email = (info.get("email") or "").strip().lower()
    name = (info.get("name") or "").strip()
    sub = (info.get("sub") or "").strip()
    email_verified = str(info.get("email_verified", "")).lower()

    if aud != GOOGLE_CLIENT_ID:
        st["done"] = True
        st["result"] = {"success": False, "msg": "Invalid token audience"}
        return redirect(_google_frontend_callback_url({
            "error": "Invalid Google token audience."
        }))

    if not email or not sub:
        st["done"] = True
        st["result"] = {"success": False, "msg": "Email not available"}
        return redirect(_google_frontend_callback_url({
            "error": "Google account email is not available."
        }))

    # optional strict check
    if email_verified and email_verified not in ("true", "1", "yes"):
        st["done"] = True
        st["result"] = {"success": False, "msg": "Email not verified"}
        return redirect(_google_frontend_callback_url({
            "error": "Google email is not verified."
        }))

    # 3) Upsert user into correct DB based on role
    if role == "client":
        conn = client_db()
        cur = get_dict_cursor(conn)

        cur.execute("SELECT id, password, auth_provider, google_sub FROM client WHERE email=%s", (email,))
        row = cur.fetchone()

        if row:
            client_id = row.get("id")
            gsub = row.get("google_sub")
            if not gsub:
                cur.execute("UPDATE client SET google_sub=%s WHERE id=%s", (sub, client_id))
            conn.commit()
            conn.close()

            profile_done = _get_google_profile_completed("client", client_id)
            st["done"] = True
            st["result"] = {
                "success": True,
                "role": "client",
                "client_id": client_id,
                "email": email,
                "name": name,
                "picture": info.get("picture", ""),
                "profile_completed": profile_done,
            }

            return redirect(_google_frontend_callback_url({
                "success": "1",
                "role": "client",
                "id": client_id,
                "email": email,
                "name": name,
                "picture": info.get("picture", ""),
                "profile_completed": "1" if profile_done else "0",
            }))

        if not name:
            name = email.split("@")[0]

        # ✅ IMPORTANT FIX: store a random hashed password so existing login logic never crashes
        random_pwd_hash = generate_password_hash(secrets.token_urlsafe(32))

        cur.execute("""
            INSERT INTO client (name, email, password, auth_provider, google_sub)
            VALUES (%s,%s,%s,%s,%s)
            RETURNING id
        """, (name, email, random_pwd_hash, "google", sub))
        row = cur.fetchone()
        client_id = row["id"] if isinstance(row, dict) else row[0]
        conn.commit()
        conn.close()

        profile_done = _get_google_profile_completed("client", client_id)
        st["done"] = True
        st["result"] = {
            "success": True,
            "role": "client",
            "client_id": client_id,
            "email": email,
            "name": name,
            "picture": info.get("picture", ""),
            "profile_completed": profile_done,
        }

        return redirect(_google_frontend_callback_url({
            "success": "1",
            "role": "client",
            "id": client_id,
            "email": email,
            "name": name,
            "picture": info.get("picture", ""),
            "profile_completed": "1" if profile_done else "0",
        }))

    else:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)

        cur.execute("SELECT id, password, auth_provider, google_sub FROM freelancer WHERE email=%s", (email,))
        row = cur.fetchone()

        if row:
            freelancer_id = row.get("id")
            gsub = row.get("google_sub")
            if not gsub:
                cur.execute("UPDATE freelancer SET google_sub=%s WHERE id=%s", (sub, freelancer_id))
            conn.commit()
            conn.close()

            profile_done = _get_google_profile_completed("freelancer", freelancer_id)
            st["done"] = True
            st["result"] = {
                "success": True,
                "role": "freelancer",
                "freelancer_id": freelancer_id,
                "email": email,
                "name": name,
                "picture": info.get("picture", ""),
                "profile_completed": profile_done,
            }

            return redirect(_google_frontend_callback_url({
                "success": "1",
                "role": "freelancer",
                "id": freelancer_id,
                "email": email,
                "name": name,
                "picture": info.get("picture", ""),
                "profile_completed": "1" if profile_done else "0",
            }))

        if not name:
            name = email.split("@")[0]

        # ✅ IMPORTANT FIX: store a random hashed password so existing login logic never crashes
        random_pwd_hash = generate_password_hash(secrets.token_urlsafe(32))

        cur.execute("""
            INSERT INTO freelancer (name, email, password, auth_provider, google_sub)
            VALUES (%s,%s,%s,%s,%s)
            RETURNING id
        """, (name, email, random_pwd_hash, "google", sub))
        row = cur.fetchone()
        freelancer_id = row["id"] if isinstance(row, dict) else row[0]
        conn.commit()
        conn.close()

        profile_done = _get_google_profile_completed("freelancer", freelancer_id)
        st["done"] = True
        st["result"] = {
            "success": True,
            "role": "freelancer",
            "freelancer_id": freelancer_id,
            "email": email,
            "name": name,
            "picture": info.get("picture", ""),
            "profile_completed": profile_done,
        }

        return redirect(_google_frontend_callback_url({
            "success": "1",
            "role": "freelancer",
            "id": freelancer_id,
            "email": email,
            "name": name,
            "picture": info.get("picture", ""),
            "profile_completed": "1" if profile_done else "0",
        }))


@app.route("/auth/google/status", methods=["GET"])
def google_oauth_status():
    _google_state_cleanup()

    state = request.args.get("state")
    if not state:
        return jsonify({"success": False, "msg": "state required"}), 400

    st = GOOGLE_OAUTH_STATES.get(state)
    if not st:
        return jsonify({"success": False, "msg": "invalid/expired state"}), 404

    if not st.get("done"):
        return jsonify({"success": True, "done": False})

    return jsonify({"success": True, "done": True, "result": st.get("result")})

# ============================================================
# NEW CODE: PROFILE PHOTO SUPPORT
# ============================================================

# Create uploads folder if it doesn't exist
UPLOADS_FOLDER = "uploads"
if not os.path.exists(UPLOADS_FOLDER):
    os.makedirs(UPLOADS_FOLDER)
PROFILE_IMAGES_FOLDER = os.path.join(UPLOADS_FOLDER, "profile_images")
os.makedirs(PROFILE_IMAGES_FOLDER, exist_ok=True)

ALLOWED_PROFILE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def get_request_data():
    if request.content_type and "multipart/form-data" in request.content_type:
        return request.form.to_dict()
    return get_json()


def save_profile_image_upload(file_storage, user_type, user_id):
    if not file_storage or not getattr(file_storage, "filename", ""):
        return None

    original_name = secure_filename(file_storage.filename)
    _, ext = os.path.splitext(original_name)
    ext = ext.lower()
    if ext not in ALLOWED_PROFILE_IMAGE_EXTENSIONS:
        raise ValueError("Invalid profile image format")

    filename = secure_filename(f"{user_type}_{user_id}_{int(time.time())}{ext}")
    absolute_path = os.path.join(PROFILE_IMAGES_FOLDER, filename)
    file_storage.save(absolute_path)
    relative_path = f"/uploads/profile_images/{filename}"
    return urllib.parse.urljoin(request.host_url, relative_path.lstrip("/"))


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename):
    return send_from_directory(UPLOADS_FOLDER, filename)

def copy_image_to_uploads(image_path):
    """Copy image to uploads folder and return relative path"""
    # Strip quotes and whitespace from path
    image_path = str(image_path).strip().strip('"').strip("'")
    
    if not os.path.exists(image_path):
        print(f"DEBUG: File not found at path: {image_path}")
        return None
    
    filename = os.path.basename(image_path)
    # Generate unique filename to avoid conflicts
    name, ext = os.path.splitext(filename)
    unique_filename = f"{name}_{int(time.time())}{ext}"
    dest_path = os.path.join(UPLOADS_FOLDER, unique_filename)
    
    try:
        shutil.copy2(image_path, dest_path)
        print(f"DEBUG: Successfully copied file to: {dest_path}")
        return dest_path
    except Exception as e:
        print(f"DEBUG: Error copying file: {e}")
        return None

@app.route("/client/upload-photo", methods=["POST"])
def client_upload_photo():
    """NEW CODE: Upload profile photo for client"""
    d = get_json()
    missing = require_fields(d, ["client_id", "image_path"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    client_id = int(d["client_id"])
    image_path = str(d["image_path"]).strip()
    
    # Validate client exists
    conn = client_db()
    cur = get_dict_cursor(conn)
    cur.execute("SELECT id FROM client WHERE id=%s", (client_id,))
    if not cur.fetchone():
        conn.close()
        return jsonify({"success": False, "msg": "Client not found"}), 404
    
    # Copy image to uploads
    uploaded_path = copy_image_to_uploads(image_path)
    if not uploaded_path:
        conn.close()
        return jsonify({"success": False, "msg": "Failed to upload image"}), 400
    
    # Update database
    cur.execute("UPDATE client SET profile_image=%s WHERE id=%s", (uploaded_path, client_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "image_path": uploaded_path})

@app.route("/freelancer/upload-photo", methods=["POST"])
def freelancer_upload_photo():
    """NEW CODE: Upload profile photo for freelancer"""
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "image_path"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    freelancer_id = int(d["freelancer_id"])
    image_path = str(d["image_path"]).strip()
    
    # Validate freelancer exists
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    cur.execute("SELECT id FROM freelancer WHERE id=%s", (freelancer_id,))
    if not cur.fetchone():
        conn.close()
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    # Copy image to uploads
    uploaded_path = copy_image_to_uploads(image_path)
    if not uploaded_path:
        conn.close()
        return jsonify({"success": False, "msg": "Failed to upload image"}), 400
    
    # Update database
    cur.execute("UPDATE freelancer SET profile_image=%s WHERE id=%s", (uploaded_path, freelancer_id))
    conn.commit()
    conn.close()
    
    return jsonify({"success": True, "image_path": uploaded_path})

@app.route("/freelancer/profile/<int:freelancer_id>", methods=["GET"])
def get_freelancer_profile(freelancer_id):
    """NEW CODE: Get freelancer profile with photo"""
    conn = freelancer_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    cur.execute("""
        SELECT f.id, f.name, f.email, f.profile_image, f.is_premium, f.premium_valid_until,
               fp.title, fp.skills, fp.experience, fp.min_budget, fp.max_budget,
               fp.rating, fp.category, fp.bio, fp.availability_status,
               fp.pricing_type, fp.hourly_rate, fp.per_person_rate, fp.starting_price,
               fp.fixed_price, fp.phone, fp.location, fp.pincode, fp.dob,
               fp.work_description, fp.services_included
        FROM freelancer f
        LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
        WHERE f.id = %s
    """, (freelancer_id,))
    
    row = cur.fetchone()
    conn.close()
    
    if not row:
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    # Build pricing-type-specific response
    pricing_info = {}
    pricing_type = row.get("pricing_type")
    
    if pricing_type == "hourly":
        if row.get("hourly_rate"):
            pricing_info = {
                "type": "hourly",
                "hourly_rate": row["hourly_rate"],
                "display": f"₹{row['hourly_rate']}/hour"
            }
    elif pricing_type == "per_person":
        if row.get("per_person_rate"):
            pricing_info = {
                "type": "per_person",
                "per_person_rate": row["per_person_rate"],
                "display": f"₹{row['per_person_rate']}/person"
            }
    elif pricing_type == "package":
        # Fetch actual packages for this freelancer
        packages = []
        try:
            pkg_conn = freelancer_db()
            pkg_cur = pkg_conn.cursor(cursor_factory=RealDictCursor)
            pkg_cur.execute("""
                SELECT id, package_name, price, description
                FROM freelancer_package
                WHERE freelancer_id = %s
                ORDER BY price ASC
            """, (freelancer_id,))
            pkg_results = pkg_cur.fetchall()
            pkg_conn.close()
            
            for pkg in pkg_results:
                packages.append({
                    "package_id": pkg["id"],
                    "package_name": pkg["package_name"],
                    "services_included": pkg["description"] or "",
                    "package_price": pkg["price"]
                })
        except Exception:
            pass  # Ignore package fetch errors
        
        if packages:
            pricing_info = {
                "type": "package",
                "packages": packages,
                "display": f"{len(packages)} packages available"
            }
        else:
            pricing_info = {
                "type": "package",
                "packages": [],
                "display": "No packages configured"
            }
    elif pricing_type == "project":
        if row.get("starting_price"):
            pricing_info = {
                "type": "project",
                "starting_price": row["starting_price"],
                "display": f"Project from ₹{row['starting_price']}"
            }
    
    response_data = {
        "success": True,
        **dict(row),
        "pricing": pricing_info
    }
    
    # Add dynamic price display fields for UI
    enhance_freelancer_with_pricing(response_data)
    
    # Add fallback for phone
    if not response_data.get("phone"):
        response_data["phone"] = "Not Available"
    
    return jsonify(response_data)

# ============================================================
# PACKAGE MANAGEMENT ENDPOINTS
# ============================================================

@app.route("/freelancer/packages", methods=["POST"])
def add_freelancer_package():
    """Add a package for a freelancer (for package pricing)"""
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "package_name", "price"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing fields: {', '.join(missing)}"}), 400
    
    try:
        freelancer_id = int(d["freelancer_id"])
        package_name = str(d["package_name"]).strip()
        price = float(d["price"])
        services_included = str(d.get("services_included", "")).strip()
        
        if price <= 0:
            return jsonify({"success": False, "msg": "Price must be greater than 0"}), 400
        
        if not package_name:
            return jsonify({"success": False, "msg": "Package name cannot be empty"}), 400
        
        # Verify freelancer exists
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT id FROM freelancer WHERE id=%s", (freelancer_id,))
        freelancer_exists = cur.fetchone()
        
        if not freelancer_exists:
            conn.close()
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404
        
        # Add package
        cur.execute("""
            INSERT INTO freelancer_package (freelancer_id, package_name, price, description, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (freelancer_id, package_name, price, services_included, now_ts()))
        
        result = cur.fetchone()
        
        if result:
            package_id = result[0] if isinstance(result, (list, tuple)) else result.get('id')
        else:
            package_id = None
            
        conn.commit()
        conn.close()
        
        if package_id:
            return jsonify({"success": True, "package_id": package_id})
        else:
            return jsonify({"success": False, "msg": "Failed to insert package"})
            
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/freelancer/<int:freelancer_id>/packages", methods=["GET"])
def get_freelancer_packages(freelancer_id):
    """Get all packages for a freelancer"""
    conn = freelancer_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    cur.execute("""
        SELECT id, package_name, price, description, created_at
        FROM freelancer_package
        WHERE freelancer_id = %s
        ORDER BY price ASC
    """, (freelancer_id,))
    
    packages = cur.fetchall()
    conn.close()
    
    # Format packages for display
    formatted_packages = []
    for pkg in packages:
        formatted_packages.append({
            "package_id": pkg["id"],
            "package_name": pkg["package_name"],
            "services_included": pkg["description"] or "",
            "starting_price": pkg["price"],
            "created_at": pkg["created_at"]
        })
    
    return jsonify({
        "success": True,
        "packages": formatted_packages
    })

@app.route("/freelancer/packages/<int:package_id>", methods=["PUT"])
def update_freelancer_package(package_id):
    """Update a package"""
    d = get_json()
    
    package_name = d.get("package_name")
    price = d.get("price")
    services_included = d.get("services_included")
    
    if not any([package_name, price, services_included]):
        return jsonify({"success": False, "msg": "At least one field must be provided"}), 400
    
    # Build update query dynamically
    updates = []
    params = []
    
    if package_name is not None:
        updates.append("package_name = %s")
        params.append(str(package_name).strip())
    
    if price is not None:
        try:
            price = float(price)
            if price <= 0:
                return jsonify({"success": False, "msg": "Price must be greater than 0"}), 400
            updates.append("price = %s")
            params.append(price)
        except (ValueError, TypeError):
            return jsonify({"success": False, "msg": "Invalid price format"}), 400
    
    if services_included is not None:
        updates.append("description = %s")
        params.append(str(services_included).strip())
    
    params.append(package_id)
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    cur.execute(f"""
        UPDATE freelancer_package
        SET {', '.join(updates)}
        WHERE id = %s
    """, params)
    
    if cur.rowcount == 0:
        conn.close()
        return jsonify({"success": False, "msg": "Package not found"}), 404
    
    conn.commit()
    conn.close()
    
    return jsonify({"success": True})

@app.route("/freelancer/packages/<int:package_id>", methods=["DELETE"])
def delete_freelancer_package(package_id):
    """Delete a package"""
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    cur.execute("DELETE FROM freelancer_package WHERE id = %s", (package_id,))
    
    if cur.rowcount == 0:
        conn.close()
        return jsonify({"success": False, "msg": "Package not found"}), 404
    
    conn.commit()
    conn.close()
    
    return jsonify({"success": True})

# ============================================================
# NEW CODE: PORTFOLIO SYSTEM
# ============================================================

def _serialize_portfolio_item(row):
    image_url = row.get("image_url") if isinstance(row, dict) else None
    if not image_url:
        image_url = row.get("media_url") if isinstance(row, dict) else None
    if not image_url:
        image_url = row.get("image_path") if isinstance(row, dict) else None
    if not image_url and isinstance(row, dict) and row.get("image_data") is not None:
        import base64
        image_url = f"data:image/*;base64,{base64.b64encode(row['image_data']).decode('utf-8')}"

    return {
        "id": row["id"],
        "portfolio_id": row["id"],
        "freelancer_id": row["freelancer_id"],
        "title": row["title"],
        "description": row["description"],
        "image_url": image_url,
        "image_path": row.get("image_path"),
        "created_at": row.get("created_at"),
    }


@app.route("/portfolio/add", methods=["POST"])
@app.route("/freelancer/portfolio/add", methods=["POST"])
def add_portfolio_item():
    """Add portfolio item for freelancer"""
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "title", "description"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400

    try:
        freelancer_id = int(d["freelancer_id"])
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    title = str(d["title"]).strip()
    description = str(d["description"]).strip()
    image_url = str(d.get("image_url") or d.get("media_url") or "").strip()
    image_path = str(d.get("image_path") or "").strip()

    if not image_url and not image_path:
        return jsonify({"success": False, "msg": "image_url required"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute("SELECT id FROM freelancer WHERE id=%s", (freelancer_id,))
        if not cur.fetchone():
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404

        cur.execute("""
            INSERT INTO portfolio (freelancer_id, title, description, image_path, image_url, media_url, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (freelancer_id, title, description, image_path or None, image_url, image_url, now_ts()))

        row = cur.fetchone()
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error adding portfolio item: {e}")
        return jsonify({"success": False, "msg": "Database error"}), 500
    finally:
        conn.close()

    rebuild_freelancer_search_index(freelancer_id)
    return jsonify({"success": True, "portfolio_id": row["id"]})


@app.route("/portfolio/<int:freelancer_id>", methods=["GET"])
@app.route("/freelancer/portfolio/<int:freelancer_id>", methods=["GET"])
def get_freelancer_portfolio(freelancer_id):
    """Get all portfolio items for a freelancer"""
    conn = freelancer_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        cur.execute("""
            SELECT id, freelancer_id, title, description, image_path, image_url, image_data, created_at, media_type, media_url
            FROM portfolio
            WHERE freelancer_id = %s
            ORDER BY created_at DESC
        """, (freelancer_id,))
        rows = cur.fetchall()
    except Exception as e:
        logger.error(f"Error fetching portfolio: {e}")
        return jsonify({"success": True, "portfolio": [], "portfolio_items": []})
    finally:
        conn.close()

    portfolio_items = [_serialize_portfolio_item(row) for row in rows]
    return jsonify({"success": True, "portfolio": portfolio_items, "portfolio_items": portfolio_items})

# ============================================================
# ===== NEW: AI Recommendation Engine =====
# ============================================================

def calculate_recommendation_score(freelancer_data, target_category, target_budget):
    """
    Calculate recommendation score for a freelancer based on:
    - Category match (+20 points)
    - Budget match (+20 points)  
    - Rating weight (rating * 10)
    - Experience weight (experience * 2)
    - Job success percentage (success_percentage * 0.3)
    """
    score = 0
    
    # Category match (+20 points)
    if freelancer_data.get("category") and freelancer_data["category"].lower() == target_category.lower():
        score += 20
    
    # Budget match (+20 points if client budget within freelancer range)
    min_budget = freelancer_data.get("min_budget", 0)
    max_budget = freelancer_data.get("max_budget", float('inf'))
    
    # SAFE COMPARISON: Handle None values
    if min_budget is not None and max_budget is not None and target_budget is not None:
        if min_budget <= target_budget <= max_budget:
            score += 20
    elif min_budget is not None and target_budget is not None:
        if min_budget <= target_budget:
            score += 20
    
    # Rating weight (rating * 10)
    rating = freelancer_data.get("rating", 0)
    score += rating * 10
    
    # Experience weight (experience * 2)
    experience = freelancer_data.get("experience", 0)
    score += experience * 2
    
    # Job success percentage (success_percentage * 0.3)
    total_projects = freelancer_data.get("total_projects", 0)
    completed_jobs = freelancer_data.get("completed_jobs", 0)
    
    if total_projects > 0:
        success_percentage = (completed_jobs / total_projects) * 100
        score += success_percentage * 0.3
    
    return round(score, 2)

@app.route("/freelancers/recommend", methods=["POST"])
def recommend_freelancers():
    """NEW CODE: AI-powered freelancer recommendation engine"""
    try:
        d = get_json()
        missing = require_fields(d, ["category", "budget"])
        if missing:
            return jsonify({"success": False, "msg": "Missing fields"}), 400
        
        target_category = str(d["category"]).strip()
        target_budget = float(d["budget"])
        
        # Fetch all freelancers with profile data
        conn = freelancer_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("""
            SELECT
                f.id,
                f.name,
                fp.title,
                fp.skills,
                fp.experience,
                fp.min_budget,
                fp.max_budget,
                fp.rating,
                fp.total_projects,
                fp.category,
                fp.bio
            FROM freelancer f
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE fp.freelancer_id IS NOT NULL
            ORDER BY f.id DESC
        """)
        
        rows = cur.fetchall()
        conn.close()
        
        if not rows:
            return jsonify([])
        
        # Calculate scores for all freelancers
        scored_freelancers = []
        for row in rows:
            freelancer_data = dict(row)
            
            # Get completed jobs from stats (simulate calculation)
            # For now, we'll estimate completed jobs as 80% of total projects
            total_projects = freelancer_data.get("total_projects", 0)
            completed_jobs = int(total_projects * 0.8) if total_projects > 0 else 0
            freelancer_data["completed_jobs"] = completed_jobs
            
            # PREVENT CRASH: Safe scoring calculation
            try:
                # Calculate recommendation score
                score = calculate_recommendation_score(freelancer_data, target_category, target_budget)
                
                scored_freelancers.append({
                    "freelancer_id": freelancer_data["id"],
                    "name": freelancer_data["name"],
                    "category": freelancer_data["category"] or "",
                    "rating": freelancer_data["rating"] or 0,
                    "experience": freelancer_data["experience"] or 0,
                    "budget_range": f"{freelancer_data.get('min_budget') or 0} - {freelancer_data.get('max_budget') or 0}",
                    "match_score": score
                })
            except Exception as e:
                # Skip problematic freelancer but continue processing others
                print(f"Warning: Skipping freelancer {freelancer_data.get('id', 'unknown')} due to error: {e}")
                continue
        
        # Sort by score descending and return top 5
        scored_freelancers.sort(key=lambda x: x["match_score"], reverse=True)
        top_recommendations = scored_freelancers[:5]
        
        # BACKEND FIX: Ensure structured data with all required fields
        for rec in top_recommendations:
            rec["freelancer_id"] = rec.get("freelancer_id", 0)
            rec["name"] = str(rec.get("name", "Unknown"))
            rec["category"] = str(rec.get("category", "Not specified"))
            rec["rating"] = float(rec.get("rating", 0))
            rec["experience"] = int(rec.get("experience", 0))
            rec["budget_range"] = str(rec.get("budget_range", "Not specified"))
            rec["match_score"] = float(rec.get("match_score", 0))
        
        return jsonify(top_recommendations)
    
    except Exception as e:
        # FIX RESPONSE: Return safe response on error
        print(f"Error in recommendation engine: {e}")
        return jsonify({"success": True, "freelancers": []})

# ============================================================
# ============================================================
# CALL ROUTES (Voice/Video Calls) - UPDATED VERSION
# ============================================================

# ============================================================
# RUN
# ============================================================

@app.route("/ai/health", methods=["GET"])
def ai_health():
    try:
        res = generate_ai_response(0, "__health__", "__ping__")
        health = res.get("health") or {}
        status_code = 200 if health.get("ollama") == "ok" else 503
        return jsonify(health), status_code
    except Exception:
        return jsonify({"ollama": "down", "model": ""}), 503

@app.route("/ai/chat", methods=["POST"])
def ai_chat():
    d = request.get_json() or {}
    if not all(k in d for k in ("user_id", "role", "message")):
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    try:
        user_id = int(d["user_id"])
    except Exception:
        return jsonify({"success": False, "msg": "user_id must be int"}), 400
    role = str(d["role"]).strip().lower()
    if role not in ("client", "freelancer"):
        return jsonify({"success": False, "msg": "role must be client or freelancer"}), 400
    message = str(d["message"]).strip()
    if not message:
        return jsonify({"success": False, "msg": "message required"}), 400
    if role == "client":
        from database import get_client_profile
        if not get_client_profile(user_id):
            return jsonify({"success": False, "msg": "Client not found"}), 404
    else:
        from database import get_freelancer_profile
        if not get_freelancer_profile(user_id):
            return jsonify({"success": False, "msg": "Freelancer not found"}), 404

    # Check pending action confirmation
    if user_id in PENDING_ACTIONS:
        user_reply = message.strip().lower()
        if user_reply in ["yes", "confirm"]:
            action_data = PENDING_ACTIONS.pop(user_id)
            exec_res = execute_agent_action(user_id, role, action_data.get("action", ""), action_data.get("parameters") or {})
            return jsonify({
                "success": True,
                "mode": "action",
                "result": exec_res
            })
        elif user_reply in ["no", "cancel"]:
            PENDING_ACTIONS.pop(user_id, None)
            return jsonify({
                "success": True,
                "mode": "answer",
                "answer": "Action cancelled."
            })

    # NEW: Try natural language query parsing first
    from query_parser import parse_query
    parsed_filters = parse_query(message)
    
    if parsed_filters:
        # Use existing freelancer search logic with parsed filters
        try:
            # Build search parameters from parsed filters
            search_params = {}
            
            if 'category' in parsed_filters:
                search_params['category'] = parsed_filters['category']
            
            # Use max_budget for the budget parameter
            if 'max_budget' in parsed_filters:
                search_params['budget'] = parsed_filters['max_budget']
            elif 'min_budget' in parsed_filters:
                search_params['budget'] = parsed_filters['min_budget']
            else:
                search_params['budget'] = 0  # Default budget
            
            # Use location as specialization query for better matching
            if 'location' in parsed_filters:
                search_params['q'] = parsed_filters['location']
            
            # Add tags to query if present
            if 'tags' in parsed_filters and parsed_filters['tags']:
                tag_query = ' '.join(parsed_filters['tags'])
                if 'q' in search_params:
                    search_params['q'] += ' ' + tag_query
                else:
                    search_params['q'] = tag_query
            
            # Call existing search logic
            conn = freelancer_db()
            from psycopg2.extras import RealDictCursor
            cur = get_dict_cursor(conn)
            
            rows = []
            q = search_params.get('q', '')
            budget = search_params.get('budget', 0)
            category = search_params.get('category', '')
            
            # Use similar logic as /freelancers/search endpoint
            if q:
                # PostgreSQL full-text search
                tokens = [t.strip() for t in q.split() if t.strip()]
                fts_query = " ".join([t + "*" for t in tokens]) if tokens else ""
                
                if fts_query:
                    cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
                    sql = f"""
                        SELECT
                            fp.freelancer_id,
                            f.name,
                            fp.title,
                            fp.skills,
                            fp.experience,
                            fp.min_budget,
                            fp.max_budget,
                            fp.rating,
                            fp.category,
                            fp.latitude,
                            fp.longitude,
                            COALESCE(fs.plan_name, 'BASIC') as subscription_plan,
                            ts_rank(to_tsvector('english', freelancer_search.title || ' ' || freelancer_search.skills || ' ' || freelancer_search.bio || ' ' || freelancer_search.tags || ' ' || freelancer_search.portfolio_text), plainto_tsquery('english', ?)) as rank
                        FROM freelancer_search
                        JOIN freelancer_profile fp
                            ON fp.freelancer_id = freelancer_search.freelancer_id
                        JOIN freelancer f
                            ON f.id = fp.freelancer_id
                        LEFT JOIN freelancer_subscription fs
                            ON fs.freelancer_id = fp.freelancer_id
                        WHERE to_tsvector('english', freelancer_search.title || ' ' || freelancer_search.skills || ' ' || freelancer_search.bio || ' ' || freelancer_search.tags || ' ' || freelancer_search.portfolio_text) @@ plainto_tsquery('english', %s)
                          AND fp.min_budget <= %s
                          AND fp.max_budget >= %s{cond_verified}
                    """
                    if category:
                        sql += " AND LOWER(fp.category) = LOWER(%s)"
                        cur.execute(sql, (fts_query, fts_query, budget, budget, category))
                    else:
                        cur.execute(sql, (fts_query, fts_query, budget, budget))
                    rows = cur.fetchall()
            
            # Fallback to category/budget search if no results
            if not rows:
                cond_verified = " AND COALESCE(fp.is_verified,0)=1" if FEATURE_HIDE_UNVERIFIED_FROM_SEARCH else ""
                sql = f"""
                    SELECT
                        fp.freelancer_id,
                        f.name,
                        fp.title,
                        fp.skills,
                        fp.experience,
                        fp.min_budget,
                        fp.max_budget,
                        fp.rating,
                        fp.category,
                        fp.latitude,
                        fp.longitude,
                        COALESCE(fs.plan_name, 'BASIC') as subscription_plan,
                        999999.0 as rank
                    FROM freelancer_profile fp
                    JOIN freelancer f
                        ON f.id = fp.freelancer_id
                    LEFT JOIN freelancer_subscription fs
                        ON fs.freelancer_id = fp.freelancer_id
                    WHERE fp.min_budget <= %s
                      AND fp.max_budget >= %s{cond_verified}
                """
                params = [budget, budget]
                if category:
                    sql += " AND LOWER(fp.category) = LOWER(%s)"
                    params.append(category)
                
                cur.execute(sql, params)
                rows = cur.fetchall()
            
            conn.close()
            
            # Format results for chatbot response
            if rows:
                # Calculate distances if location was specified
                location_specified = 'location' in parsed_filters
                formatted_results = []
                
                for i, row in enumerate(rows[:5], 1):  # Limit to top 5 results
                    freelancer_data = dict(row)
                    
                    # Calculate distance if location specified and we have coordinates
                    distance_text = ""
                    if location_specified and freelancer_data.get('latitude') and freelancer_data.get('longitude'):
                        # For now, just show location info
                        distance_text = f"Location: {freelancer_data.get('category', 'Unknown')}\n"
                    
                    result_text = f"{i}. {freelancer_data['name']}"
                    if freelancer_data.get('title'):
                        result_text += f" — {freelancer_data['title']}"
                    result_text += f"\nRating: {freelancer_data.get('rating', 0)}"
                    
                    if freelancer_data.get('min_budget') or freelancer_data.get('max_budget'):
                        result_text += f"\nBudget: ₹{freelancer_data.get('min_budget', 0)}-₹{freelancer_data.get('max_budget', 0)}"
                    
                    if freelancer_data.get('category'):
                        result_text += f"\nCategory: {freelancer_data['category']}"
                    
                    if distance_text:
                        result_text += f"\n{distance_text}"
                    
                    formatted_results.append(result_text)
                
                # Create response header based on filters
                header = "Top matching freelancers"
                if 'category' in parsed_filters:
                    header += f" in {parsed_filters['category']}"
                if 'location' in parsed_filters:
                    header += f" near {parsed_filters['location'].title()}"
                header += ":\n\n"
                
                response_text = header + "\n\n".join(formatted_results)
                
                return jsonify({
                    "success": True,
                    "mode": "answer",
                    "answer": response_text,
                    "sources": ["query_parser", "database"]
                })
            else:
                return jsonify({
                    "success": True,
                    "mode": "answer", 
                    "answer": "No freelancers found matching your query.",
                    "sources": ["query_parser", "database"]
                })
                
        except Exception as e:
            print(f"Error in query parsing search: {e}")
            # Fall through to existing chatbot logic on error
    
    result = generate_ai_response(user_id, role, message)
    
    # If the AI system already executed an action, return the result
    if isinstance(result, dict) and result.get("type") == "action":
        # This means the AI system returned an action that needs to be executed
        action = str(result.get("action") or "").strip()
        params = result.get("parameters") or {}
        requires_confirmation = action in {"hire_freelancer", "accept_request", "reject_request", "send_message"}
        if requires_confirmation:
            PENDING_ACTIONS[user_id] = {
                "action": action,
                "parameters": params
            }
            confirm_msg = "You are about to perform an action. Confirm? (yes/no)"
            if action == "hire_freelancer":
                fname = params.get("name", "Unknown")
                confirm_msg = f"You are about to hire {fname}. Confirm? (yes/no)"
            elif action == "accept_request":
                rid = params.get("request_id")
                confirm_msg = f"You are about to accept Request ID {rid}. Confirm? (yes/no)"
            elif action == "reject_request":
                rid = params.get("request_id")
                confirm_msg = f"You are about to reject Request ID {rid}. Confirm? (yes/no)"
            elif action == "send_message":
                if role == "client":
                    fid = params.get("freelancer_id")
                    confirm_msg = f"You are about to send a message to Freelancer ID {fid}. Confirm? (yes/no)"
                else:
                    cid = params.get("client_id")
                    confirm_msg = f"You are about to send a message to Client ID {cid}. Confirm? (yes/no)"
            return jsonify({
                "success": True,
                "mode": "answer",
                "answer": confirm_msg
            })
        else:
            # Execute action immediately without confirmation
            exec_res = execute_agent_action(user_id, role, action, params)
            return jsonify({
                "success": True,
                "mode": "action",
                "result": exec_res,
                "answer": ""
            })
    else:
        # This is already an answer response (either from AI system or from executed action)
        text = str(result.get("text", ""))
        return jsonify({
            "success": True,
            "mode": "answer",
            "answer": text,
            "sources": result.get("sources", ["kb"])
        })


# ============================================================
# FREELANCER VERIFICATION
# ============================================================

@app.route("/freelancer/verification/upload", methods=["POST"])
def freelancer_verification_upload():
    """Upload verification documents for freelancer"""
    import os
    import shutil
    
    # Handle both JSON paths and actual file uploads
    if request.is_json:
        # JSON payload with file paths (CLI-style)
        data = request.get_json() or {}
        freelancer_id = data.get("freelancer_id")
        government_id_path = data.get("government_id_path")
        pan_card_path = data.get("pan_card_path")
        artist_proof_path = data.get("artist_proof_path")  # Optional
        
        if not all([freelancer_id, government_id_path, pan_card_path]):
            return jsonify({"success": False, "msg": "Missing required fields: freelancer_id, government_id_path, pan_card_path"}), 400
        
        # Validate and sanitize file paths
        def sanitize_path(path):
            if not path:
                return None
            return path.strip().strip('"').strip("'")
        
        government_id_path = sanitize_path(government_id_path)
        pan_card_path = sanitize_path(pan_card_path)
        artist_proof_path = sanitize_path(artist_proof_path) if artist_proof_path else None
        
        # Validate file exists on server
        def validate_file_exists(file_path):
            if not file_path:
                return True  # Optional file
            return os.path.isfile(file_path)
        
        if not validate_file_exists(government_id_path):
            return jsonify({"success": False, "msg": f"Government ID file not found: {government_id_path}"}), 400
        
        if not validate_file_exists(pan_card_path):
            return jsonify({"success": False, "msg": f"PAN card file not found: {pan_card_path}"}), 400
        
        if artist_proof_path and not validate_file_exists(artist_proof_path):
            return jsonify({"success": False, "msg": f"Artist proof file not found: {artist_proof_path}"}), 400
        
        # Validate file extensions
        allowed_extensions = {'.pdf', '.jpg', '.jpeg', '.png'}
        
        def validate_file_extension(file_path):
            if not file_path:
                return True  # Optional file
            ext = os.path.splitext(file_path)[1].lower()
            return ext in allowed_extensions
        
        if not validate_file_extension(government_id_path):
            return jsonify({"success": False, "msg": "Invalid government ID file type. Allowed: PDF, JPG, PNG"}), 400
        
        if not validate_file_extension(pan_card_path):
            return jsonify({"success": False, "msg": "Invalid PAN card file type. Allowed: PDF, JPG, PNG"}), 400
        
        if artist_proof_path and not validate_file_extension(artist_proof_path):
            return jsonify({"success": False, "msg": "Invalid artist proof file type. Allowed: PDF, JPG, PNG"}), 400
    
    else:
        # Multipart form data upload (web-style)
        freelancer_id = request.form.get("freelancer_id")
        government_id_file = request.files.get("government_id_file")
        pan_card_file = request.files.get("pan_card_file")
        artist_proof_file = request.files.get("artist_proof_file")  # Optional
        
        if not all([freelancer_id, government_id_file, pan_card_file]):
            return jsonify({"success": False, "msg": "Missing required fields: freelancer_id, government_id_file, pan_card_file"}), 400
        
        # Validate file extensions
        allowed_extensions = {'.pdf', '.jpg', '.jpeg', '.png'}
        
        def validate_file_extension(file):
            if not file:
                return True  # Optional file
            ext = os.path.splitext(file.filename)[1].lower()
            return ext in allowed_extensions
        
        if not validate_file_extension(government_id_file):
            return jsonify({"success": False, "msg": "Invalid government ID file type. Allowed: PDF, JPG, PNG"}), 400
        
        if not validate_file_extension(pan_card_file):
            return jsonify({"success": False, "msg": "Invalid PAN card file type. Allowed: PDF, JPG, PNG"}), 400
        
        if artist_proof_file and not validate_file_extension(artist_proof_file):
            return jsonify({"success": False, "msg": "Invalid artist proof file type. Allowed: PDF, JPG, PNG"}), 400
    
    # Validate freelancer exists
    from database import get_freelancer_profile
    if not get_freelancer_profile(freelancer_id):
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    # Create upload directory if not exists
    upload_dir = f"uploads/verification/{freelancer_id}"
    os.makedirs(upload_dir, exist_ok=True)
    
    if request.is_json:
        # Save files from paths - FIXED VERSION
        import shutil
        from werkzeug.utils import secure_filename
        
        # Clean and validate source paths
        original_gov_path = government_id_path.strip().strip('"').strip("'")
        original_pan_path = pan_card_path.strip().strip('"').strip("'")
        original_artist_path = artist_proof_path.strip().strip('"').strip("'") if artist_proof_path else None
        
        # Validate files exist
        if not os.path.exists(original_gov_path):
            return jsonify({"success": False, "msg": f"Government ID file not found: {original_gov_path}"}), 400
        if not os.path.exists(original_pan_path):
            return jsonify({"success": False, "msg": f"PAN card file not found: {original_pan_path}"}), 400
        if original_artist_path and not os.path.exists(original_artist_path):
            return jsonify({"success": False, "msg": f"Artist proof file not found: {original_artist_path}"}), 400
        
        # Extract and secure filenames
        gov_filename = secure_filename(os.path.basename(original_gov_path))
        pan_filename = secure_filename(os.path.basename(original_pan_path))
        artist_filename = secure_filename(os.path.basename(original_artist_path)) if original_artist_path else None
        
        # Create full destination paths (CRITICAL FIX)
        government_id_path = os.path.join(upload_dir, gov_filename)
        pan_card_path = os.path.join(upload_dir, pan_filename)
        artist_proof_path = os.path.join(upload_dir, artist_filename) if artist_filename else None
        
        # Debug logs
        print(f"DEBUG GOV SOURCE: {original_gov_path}")
        print(f"DEBUG GOV DEST: {government_id_path}")
        print(f"DEBUG PAN SOURCE: {original_pan_path}")
        print(f"DEBUG PAN DEST: {pan_card_path}")
        if original_artist_path:
            print(f"DEBUG ARTIST SOURCE: {original_artist_path}")
            print(f"DEBUG ARTIST DEST: {artist_proof_path}")
        
        # Copy files correctly (FIXED - using full destination paths)
        shutil.copy(original_gov_path, government_id_path)
        shutil.copy(original_pan_path, pan_card_path)
        if original_artist_path and artist_proof_path:
            shutil.copy(original_artist_path, artist_proof_path)
    else:
        # Save files from multipart form data
        government_id_file.save(os.path.join(upload_dir, government_id_file.filename))
        pan_card_file.save(os.path.join(upload_dir, pan_card_file.filename))
        if artist_proof_file:
            artist_proof_file.save(os.path.join(upload_dir, artist_proof_file.filename))
    
    # Update verification record
    success = update_freelancer_verification(
        freelancer_id, 
        government_id_path if request.is_json else government_id_file.filename, 
        pan_card_path if request.is_json else pan_card_file.filename, 
        artist_proof_path if request.is_json else artist_proof_file.filename if artist_proof_file else None
    )
    
    if success:
        return jsonify({
            "success": True, 
            "msg": "Verification documents uploaded successfully"
        })
    else:
        return jsonify({
            "success": False, 
            "msg": "Failed to save verification data"
        }), 500


@app.route("/freelancer/verification/status", methods=["GET"])
def freelancer_verification_status():
    """Get verification status for freelancer"""
    freelancer_id = request.args.get("freelancer_id")
    
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400
    
    # Validate freelancer exists
    from database import get_freelancer_profile
    if not get_freelancer_profile(freelancer_id):
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    verification = get_freelancer_verification(freelancer_id)
    
    if not verification:
        return jsonify({
            "success": True,
            "status": None,
            "submitted_at": None,
            "rejection_reason": None,
            "msg": "Verification not submitted yet"
        })
    
    return jsonify({
        "success": True,
        "status": verification["status"],
        "submitted_at": verification["submitted_at"],
        "rejection_reason": verification["rejection_reason"]
    })


# ============================================================
# FREELANCER SUBSCRIPTION
# ============================================================

@app.route("/freelancer/subscription/plans", methods=["GET"])
def freelancer_subscription_plans():
    """Get available subscription plans"""
    return jsonify({
        "success": True,
        "plans": {
            "BASIC": {
                "name": "BASIC",
                "price": 0,
                "portfolio_limit": 5,
                "job_applies_limit": 10,
                "rank_boost": 0,
                "badge": None,
                "features": [
                    "5 Portfolio Projects",
                    "10 Job Applies per Month",
                    "Standard Search Visibility",
                    "Full Messaging Access"
                ]
            },
            "PREMIUM": {
                "name": "PREMIUM",
                "price": 699,
                "portfolio_limit": float('inf'),
                "job_applies_limit": float('inf'),
                "rank_boost": 1,
                "badge": "🔵 PREMIUM",
                "features": [
                    "Unlimited Portfolio",
                    "Unlimited Job Applies",
                    "Moderate Rank Boost",
                    "PREMIUM Badge",
                    "Highlight 3 Projects",
                    "Featured Grid Priority Placement",
                    "Basic Analytics",
                    "Early Job Alerts"
                ]
            }
        }
    })


@app.route("/freelancer/subscription/upgrade", methods=["POST"])
def freelancer_subscription_upgrade():
    """Upgrade freelancer subscription"""
    data = request.get_json() or {}
    freelancer_id = data.get("freelancer_id")
    plan_name = data.get("plan_name")
    
    if not all([freelancer_id, plan_name]):
        return jsonify({"success": False, "msg": "Missing fields: freelancer_id, plan_name"}), 400
    
    if plan_name != "PREMIUM":
        return jsonify({"success": False, "msg": "Only PREMIUM plan is available for upgrade"}), 400
    
    # Validate freelancer exists
    from database import get_freelancer_profile
    if not get_freelancer_profile(freelancer_id):
        return jsonify({"success": False, "msg": "Freelancer not found"}), 404
    
    # Simulate payment (always succeed for now)
    success = update_freelancer_subscription(freelancer_id, plan_name, 30)
    
    if success:
        import time
        end_date = int(time.time()) + (30 * 24 * 60 * 60)
        from datetime import datetime
        expiry_date = datetime.fromtimestamp(end_date)
        
        # Add notification for subscription upgrade
        try:
            conn = freelancer_db()
            cur = get_dict_cursor(conn)
            
            # Use enhanced notification message for subscription upgrade
            context_data = {
                "plan_name": plan_name
            }
            enhanced_message = enhance_notification_message(
                f"Successfully upgraded to {plan_name}!",
                title="Subscription Upgraded",
                related_entity_type="subscription",
                context_data=context_data
            )
            
            # Add notification using unified system
            from notification_helper import notify_user
            notify_user(
                user_id=freelancer_id,
                role="freelancer",
                title="Subscription Upgraded",
                message=enhanced_message,
                related_entity_type="subscription"
            )
            conn.commit()
            conn.close()
        except:
            pass  # Don't fail the upgrade if notification fails
        
        return jsonify({
            "success": True,
            "msg": f"Successfully upgraded to {plan_name}!",
            "plan_name": plan_name,
            "active_until": expiry_date.strftime("%Y-%m-%d")
        })
    else:
        return jsonify({
            "success": False,
            "msg": "Failed to upgrade subscription"
        }), 500


@app.route("/freelancer/subscription/status", methods=["GET"])
def freelancer_subscription_status():
    """Get freelancer subscription status"""
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "Missing freelancer_id"}), 400
    
    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400
    
    # Get subscription info
    from database import freelancer_db, client_db, get_dict_cursor, get_freelancer_job_applies, get_freelancer_plan
    
    subscription = get_freelancer_subscription(freelancer_id)
    job_applies = get_freelancer_job_applies(freelancer_id)
    
    # Get current plan (fallback to profile if subscription table is empty)
    current_plan = "BASIC"
    if subscription:
        current_plan = subscription.get("plan_name", "BASIC")
    else:
        # Fallback to profile table
        profile_plan = get_freelancer_plan(freelancer_id)
        if profile_plan:
            current_plan = profile_plan
    
    return jsonify({
        "success": True,
        "subscription": subscription or {"plan_name": "BASIC"},
        "job_applies": job_applies or {"applies_used": 0, "limit": 10, "current_plan": current_plan}
    })


# ============================================================
# PROJECT POSTING (Optional Hiring Flow)
# ============================================================
# NOTE: /client/project POST, /client/projects GET, and /projects/all GET
# are defined later in the file (around line 6685+). Do NOT duplicate here.


@app.route("/client/projects/applicants", methods=["GET"])
def client_projects_applicants():
    client_id = request.args.get("client_id", "")
    project_id = request.args.get("project_id", "")
    try:
        cid = int(client_id)
        pid = int(project_id)
    except Exception:
        return jsonify({"success": False, "msg": "client_id and project_id required"}), 400
    try:
        payload = get_project_applications_payload(pid, cid)
        return jsonify({"success": True, **payload})
    except PermissionError:
        return jsonify({"success": False, "msg": "Not authorized"}), 403
    except LookupError:
        return jsonify({"success": False, "msg": "Project not found"}), 404


def get_project_applications_payload(project_id, client_id=None):
    """Return project details and all applicants for a project."""
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT p.id, p.client_id, p.title, p.category, p.location, p.pricing_type, p.description, p.status, p.created_at,
                   c.name AS client_name, c.email AS client_email
            FROM project_post p
            LEFT JOIN client c ON c.id = p.client_id
            WHERE p.id=%s
        """, (project_id,))
        project = cur.fetchone()
        if not project:
            raise LookupError("Project not found")
        if client_id is not None and int(project["client_id"]) != int(client_id):
            raise PermissionError("Not authorized")

        cur.execute("""
            SELECT pa.id, pa.project_id, pa.freelancer_id, pa.proposal, pa.bid_amount, pa.status, pa.created_at,
                   f.name AS freelancer_name, f.email AS freelancer_email,
                   fp.title AS freelancer_title, fp.skills AS freelancer_skills, fp.experience AS freelancer_experience
            FROM project_application pa
            LEFT JOIN freelancer f ON f.id = pa.freelancer_id
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = pa.freelancer_id
            WHERE pa.project_id=%s
            ORDER BY pa.created_at DESC
        """, (project_id,))
        rows = cur.fetchall()

        applicants = []
        for row in rows:
            applicants.append({
                "application_id": row["id"],
                "project_id": row["project_id"],
                "freelancer_id": row["freelancer_id"],
                "freelancer_name": row.get("freelancer_name") or "Unknown",
                "freelancer_title": row.get("freelancer_title") or "",
                "freelancer_skills": row.get("freelancer_skills") or "",
                "freelancer_experience": row.get("freelancer_experience") or 0,
                "freelancer_email": row.get("freelancer_email") or "",
                "proposal": row.get("proposal") or "",
                "bid_amount": row.get("bid_amount") or 0,
                "status": row.get("status") or "PENDING",
                "created_at": row.get("created_at"),
            })

        return {
            "project": {
                "id": project["id"],
                "client_id": project["client_id"],
                "client_name": project.get("client_name") or "",
                "client_email": project.get("client_email") or "",
                "title": project.get("title") or "",
                "category": project.get("category") or "",
                "location": project.get("location") or "",
                "pricing_type": project.get("pricing_type") or "",
                "description": project.get("description") or "",
                "status": project.get("status") or "active",
                "created_at": project.get("created_at"),
            },
            "applicants": applicants,
        }
    finally:
        conn.close()


@app.route("/applications/project/<int:project_id>", methods=["GET"])
def applications_by_project(project_id):
    client_id = request.args.get("client_id")
    try:
        cid = int(client_id) if client_id not in (None, "") else None
    except Exception:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    try:
        payload = get_project_applications_payload(project_id, cid)
        return jsonify({"success": True, **payload})
    except PermissionError:
        return jsonify({"success": False, "msg": "Not authorized"}), 403
    except LookupError:
        return jsonify({"success": False, "msg": "Project not found"}), 404


@app.route("/client/projects/close", methods=["POST"])
def client_projects_close():
    d = get_json()
    missing = require_fields(d, ["client_id", "project_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    try:
        cid = int(d["client_id"])
        pid = int(d["project_id"])
    except Exception:
        return jsonify({"success": False, "msg": "Invalid payload"}), 400
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT client_id FROM project_post WHERE id=%s", (pid,))
        r = cur.fetchone()
        if not r or int(r.get("client_id", r[0] if not isinstance(r, dict) else 0)) != cid:
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        cur.execute("UPDATE project_post SET status='CLOSED' WHERE id=%s", (pid,))
        conn.commit()
        return jsonify({"success": True})
    finally:
        conn.close()


@app.route("/client/projects/accept_application", methods=["POST"])
def client_projects_accept_application():
    d = get_json()
    missing = require_fields(d, ["client_id", "project_id", "application_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    try:
        cid = int(d["client_id"])
        pid = int(d["project_id"])
        aid = int(d["application_id"])
    except Exception:
        return jsonify({"success": False, "msg": "Invalid payload"}), 400
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("SELECT client_id, category, description FROM project_post WHERE id=%s", (pid,))
        pr = cur.fetchone()
        if not pr or int(pr["client_id"]) != cid:
            return jsonify({"success": False, "msg": "Not authorized"}), 403
        project_category = pr["category"]
        project_description = pr["description"]
        
        cur.execute("""
            SELECT freelancer_id, proposal, bid_amount, status
            FROM project_application
            WHERE id=%s AND project_id=%s
        """, (aid, pid))
        ar = cur.fetchone()
        if not ar:
            return jsonify({"success": False, "msg": "Application not found"}), 404
        ar_status = ar["status"]
        if ar_status != "PENDING":
            return jsonify({"success": False, "msg": "Application not in PENDING state"}), 400
        freelancer_id = int(ar["freelancer_id"])
        bid_amount = ar["bid_amount"] or 0
        
        # Accept the application and update project status
        cur.execute("UPDATE project_application SET status='ACCEPTED' WHERE id=%s", (aid,))
        cur.execute("UPDATE project_post SET status='ASSIGNED' WHERE id=%s", (pid,))
        
        # Reject other pending applications
        cur.execute("UPDATE project_application SET status='REJECTED' WHERE project_id=%s AND status='PENDING' AND id!=%s", (pid, aid))
        
        # Get details for notifications
        cur.execute("""
            SELECT f.name as freelancer_name, p.title as project_title
            FROM freelancer f 
            JOIN project_post p ON p.id = %s
            WHERE f.id = %s
        """, (pid, freelancer_id))
        details = cur.fetchone()
        
        # Create hire request
        cur.execute("""
            INSERT INTO hire_request (client_id, freelancer_id, job_title, proposed_budget, note, status, created_at, contract_type)
            VALUES (%s, %s, %s, %s, %s, 'PENDING', %s, %s)
        """, (cid, freelancer_id, f"Project: {project_category}", bid_amount, f"Created from project application #{aid}", now_ts(), "PROJECT"))
        
        conn.commit()
        
        # Send notifications
        try:
            from notification_helper import notify_client, notify_freelancer
            
            if details:
                freelancer_name = details.get("freelancer_name", "Freelancer")
                project_title = details.get("project_title", "Untitled")
                
                # Notify accepted freelancer
                notify_freelancer(
                    freelancer_id=freelancer_id,
                    message=f'Your application for "{project_title}" was accepted!',
                    title="Application Accepted",
                    related_entity_type="project_application",
                    related_entity_id=aid,
                    notification_type="HIRED",
                    sender_id=cid,
                    reference_id=pid,
                )
                
                # Notify client about acceptance
                notify_client(
                    client_id=cid,
                    message=f'You accepted {freelancer_name}\'s application for "{project_title}"',
                    title="Application Accepted",
                    related_entity_type="project_application",
                    related_entity_id=aid
                )
                
                # Notify rejected freelancers
                cur.execute("""
                    SELECT pa.freelancer_id, f.name 
                    FROM project_application pa
                    JOIN freelancer f ON f.id = pa.freelancer_id
                    WHERE pa.project_id=%s AND pa.status='REJECTED'
                """, (pid,))
                rejected = cur.fetchall()
                
                for rej_freelancer_id, rej_freelancer_name in rejected:
                    notify_freelancer(
                        freelancer_id=rej_freelancer_id,
                        message=f'Your application for "{project_title}" was not selected',
                        title="Application Not Selected",
                        related_entity_type="project_application",
                        related_entity_id=aid,
                        notification_type="APPLICATION_UPDATE",
                        sender_id=cid,
                        reference_id=pid,
                    )
        except Exception as e:
            print(f"Error creating application notifications: {e}")
        
        return jsonify({"success": True})
    finally:
        conn.close()


@app.route("/freelancer/projects/feed", methods=["GET"])
def freelancer_projects_feed():
    freelancer_id = request.args.get("freelancer_id", "")
    try:
        fid = int(freelancer_id)
    except Exception:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400
    
    conn = freelancer_db()
    from psycopg2.extras import RealDictCursor
    try:
        cur = get_dict_cursor(conn)
        
        # Get freelancer profile for filtering
        cur.execute("""
            SELECT category, location, pincode 
            FROM freelancer_profile 
            WHERE freelancer_id=%s
        """, (fid,))
        freelancer_profile = cur.fetchone()
        
        if not freelancer_profile:
            return jsonify({"success": True, "projects": []})
        
        freelancer_category = (freelancer_profile.get("category") or "").lower().strip()
        freelancer_location = (freelancer_profile.get("location") or "").lower().strip()
        freelancer_pincode = (freelancer_profile.get("pincode") or "").strip()
        
        # Filter projects based on freelancer category and location/pincode
        cur.execute("""
            SELECT id, client_id, category, description, location, pincode, created_at
            FROM project_post
            WHERE status='OPEN'
            ORDER BY created_at DESC
        """)
        rows = cur.fetchall()
        
        feed = []
        for r in rows:
            project_category = (r.get("category") or "").lower().strip()
            project_location = (r.get("location") or "").lower().strip()
            project_pincode = (r.get("pincode") or "").strip()
            
            # Filter by category (must match)
            if freelancer_category and project_category and freelancer_category != project_category:
                continue
                
            # Filter by location/pincode (if available)
            if freelancer_pincode and project_pincode and freelancer_pincode != project_pincode:
                continue
            if freelancer_location and project_location and freelancer_location not in project_location and project_location not in freelancer_location:
                continue
                
            feed.append({
                "project_id": r["id"],
                "client_id": r["client_id"],
                "category": r["category"],
                "description": r["description"],
                "location": r["location"],
                "pincode": r["pincode"],
                "created_at": r["created_at"],
            })
        return jsonify({"success": True, "projects": feed})
    finally:
        conn.close()


def get_freelancer_applications_payload(freelancer_id):
    """Return all applications submitted by a freelancer with project and client details."""
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT pa.id, pa.project_id, pa.freelancer_id, pa.proposal, pa.bid_amount, pa.status, pa.created_at,
                   p.title, p.category, p.location, p.pricing_type, p.description, p.client_id, p.status AS project_status,
                   c.name AS client_name, c.email AS client_email
            FROM project_application pa
            JOIN project_post p ON p.id = pa.project_id
            LEFT JOIN client c ON c.id = p.client_id
            WHERE pa.freelancer_id=%s
            ORDER BY pa.created_at DESC
        """, (freelancer_id,))
        rows = cur.fetchall()
        applications = []
        for row in rows:
            applications.append({
                "application_id": row["id"],
                "project_id": row["project_id"],
                "freelancer_id": row["freelancer_id"],
                "proposal": row.get("proposal") or "",
                "bid_amount": row.get("bid_amount") or 0,
                "status": row.get("status") or "PENDING",
                "created_at": row.get("created_at"),
                "project": {
                    "id": row["project_id"],
                    "title": row.get("title") or "",
                    "category": row.get("category") or "",
                    "location": row.get("location") or "",
                    "pricing_type": row.get("pricing_type") or "",
                    "description": row.get("description") or "",
                    "status": row.get("project_status") or "active",
                    "client_id": row.get("client_id"),
                    "client_name": row.get("client_name") or "",
                    "client_email": row.get("client_email") or "",
                },
            })
        return applications
    finally:
        conn.close()


@app.route("/applications/freelancer", methods=["GET"])
def applications_by_freelancer():
    freelancer_id = request.args.get("freelancer_id", "")
    try:
        fid = int(freelancer_id)
    except Exception:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400

    applications = get_freelancer_applications_payload(fid)
    return jsonify({"success": True, "applications": applications})


@app.route("/project/apply", methods=["POST"])
@app.route("/freelancer/projects/apply", methods=["POST"])
def freelancer_projects_apply():
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "project_id", "proposal", "bid_amount"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    try:
        fid = int(d["freelancer_id"])
        pid = int(d["project_id"])
        proposal = str(d["proposal"]).strip()
        bid_amount = float(d["bid_amount"])
    except Exception:
        return jsonify({"success": False, "msg": "Invalid payload"}), 400
    
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT p.id, p.client_id, p.title, p.category, p.location, p.pricing_type, p.description, p.status,
                   c.name AS client_name, c.email AS client_email,
                   f.name AS freelancer_name, f.email AS freelancer_email
            FROM project_post p
            LEFT JOIN client c ON c.id = p.client_id
            LEFT JOIN freelancer f ON f.id = %s
            WHERE p.id = %s
        """, (fid, pid))
        project_row = cur.fetchone()
        if not project_row:
            return jsonify({"success": False, "msg": "Project not found"}), 404
        if str(project_row.get("status") or "").upper() not in {"ACTIVE", "OPEN"}:
            return jsonify({"success": False, "msg": "Project is no longer open for applications"}), 400

        # Check if already applied
        cur.execute("""
            SELECT id, project_id, freelancer_id, proposal, bid_amount, status, created_at
            FROM project_application
            WHERE project_id=%s AND freelancer_id=%s
        """, (pid, fid))
        existing_application = cur.fetchone()
        if existing_application:
            application_data = {
                "application_id": existing_application["id"],
                "project_id": existing_application["project_id"],
                "freelancer_id": existing_application["freelancer_id"],
                "proposal": existing_application.get("proposal") or "",
                "bid_amount": existing_application.get("bid_amount") or 0,
                "status": existing_application.get("status") or "PENDING",
                "created_at": existing_application.get("created_at"),
                "project": {
                    "id": project_row["id"],
                    "client_id": project_row["client_id"],
                    "client_name": project_row.get("client_name") or "",
                    "client_email": project_row.get("client_email") or "",
                    "title": project_row.get("title") or "",
                    "category": project_row.get("category") or "",
                    "location": project_row.get("location") or "",
                    "pricing_type": project_row.get("pricing_type") or "",
                    "description": project_row.get("description") or "",
                    "status": project_row.get("status") or "active",
                },
            }
            return jsonify({"success": False, "msg": "Already applied", "application": application_data}), 400
        
        # Insert application
        cur.execute("""
            INSERT INTO project_application (project_id, freelancer_id, proposal, bid_amount, status, created_at)
            VALUES (%s, %s, %s, %s, 'PENDING', %s)
            RETURNING id, project_id, freelancer_id, proposal, bid_amount, status, created_at
        """, (pid, fid, proposal, bid_amount, now_ts()))
        app_row = cur.fetchone()
        application_id = app_row["id"] if isinstance(app_row, dict) else app_row[0]

        application_data = {
            "application_id": app_row["id"],
            "project_id": app_row["project_id"],
            "freelancer_id": app_row["freelancer_id"],
            "proposal": app_row.get("proposal") or "",
            "bid_amount": app_row.get("bid_amount") or 0,
            "status": app_row.get("status") or "PENDING",
            "created_at": app_row.get("created_at"),
            "project": {
                "id": project_row["id"],
                "client_id": project_row["client_id"],
                "client_name": project_row.get("client_name") or "",
                "client_email": project_row.get("client_email") or "",
                "title": project_row.get("title") or "",
                "category": project_row.get("category") or "",
                "location": project_row.get("location") or "",
                "pricing_type": project_row.get("pricing_type") or "",
                "description": project_row.get("description") or "",
                "status": project_row.get("status") or "active",
            },
        }
        
        conn.commit()

        try:
            increment_job_applies(fid)
        except Exception:
            pass
        
        # Notify client about new application
        try:
            from notification_helper import notify_client
            
            # Get project and client details
            if project_row:
                project_title = project_row.get("title") or "Untitled"
                client_id = project_row.get("client_id")
                freelancer_name = project_row.get("freelancer_name") or "Freelancer"
                
                notify_client(
                    client_id=client_id,
                    message=f'{freelancer_name} applied to your project: "{project_title}"',
                    title="New Application",
                    related_entity_type="project_application",
                    related_entity_id=application_id
                )
        except Exception as e:
            print(f"Error creating application notification: {e}")

        if SOCKET_IO_ENABLED and socketio is not None:
            socket_payload = {
                "application": application_data,
                "project_id": application_data["project_id"],
                "freelancer_id": application_data["freelancer_id"],
                "client_id": project_row.get("client_id"),
            }
            socketio.emit("applicationSent", socket_payload, room=f"user_{fid}")
            if project_row.get("client_id"):
                socketio.emit("applicationSent", socket_payload, room=f"user_{project_row['client_id']}")
        
        return jsonify({
            "success": True,
            "msg": "Application submitted successfully",
            "application_id": application_id,
            "application": application_data,
        })
        
    except psycopg2.Error as e:
        print(f"Database error in project application: {type(e).__name__}: {str(e)}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": f"Database error: {str(e)}"}), 500
    except Exception as e:
        print(f"Unexpected error in project application: {type(e).__name__}: {str(e)}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "msg": f"Server error: {str(e)}"}), 500
    finally:
        conn.close()

@app.route("/client/rate", methods=["POST"])
def client_rate():
    d = get_json()
    missing = require_fields(d, ["client_id", "freelancer_id", "rating", "review"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    try:
        rating = float(d["rating"])
    except (ValueError, TypeError):
        return jsonify({"success": False, "msg": "Invalid rating format"}), 400
    
    if rating < 1 or rating > 5:
        return jsonify({"success": False, "msg": "Rating must be between 1 and 5"}), 400
    
    client_id = int(d["client_id"])
    freelancer_id = int(d["freelancer_id"])
    review_text = str(d.get("review", "")).strip()
    hire_request_id = d.get("hire_request_id")
    
    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # VALIDATION 1: Check job ownership and completion status
        if hire_request_id:
            cur.execute("""
                SELECT client_id, freelancer_id, status 
                FROM hire_request 
                WHERE id = %s
            """, (hire_request_id,))
            
            job = cur.fetchone()
            if not job:
                return jsonify({"success": False, "msg": "Job not found"}), 400
            
            # Verify job ownership
            if job.get("client_id") != client_id:
                return jsonify({"success": False, "msg": "You can only rate your own jobs"}), 403
            
            # Ensure job is completed (PAID status)
            if job.get("status") != 'PAID':
                return jsonify({"success": False, "msg": "You can only rate after job completion"}), 400
        
        # VALIDATION 2: Prevent duplicate rating
        cur.execute("""
            SELECT id FROM review 
            WHERE hire_request_id = %s AND client_id = %s AND freelancer_id = %s
        """, (hire_request_id, client_id, freelancer_id))
        
        existing_review = cur.fetchone()
        if existing_review:
            return jsonify({"success": False, "msg": "You have already rated this freelancer"}), 400
        
        # Get current freelancer stats
        cur.execute("""
            SELECT rating, total_projects, total_rating_sum 
            FROM freelancer_profile 
            WHERE freelancer_id = %s
        """, (freelancer_id,))
        
        stats = cur.fetchone()
        if not stats:
            # Create profile if it doesn't exist
            cur.execute("""
                INSERT INTO freelancer_profile (freelancer_id, rating, total_projects, total_rating_sum)
                VALUES (%s, %s, 1, %s)
            """, (freelancer_id, rating, rating))
            new_average = rating
            new_total_projects = 1
        else:
            # Handle both dict and tuple responses
            if isinstance(stats, dict):
                current_rating = stats.get("rating")
                total_projects = stats.get("total_projects")
                total_rating_sum = stats.get("total_rating_sum")
            else:
                current_rating = stats[0] if len(stats) > 0 else 0
                total_projects = stats[1] if len(stats) > 1 else 0
                total_rating_sum = stats[2] if len(stats) > 2 else 0
            
            total_projects = int(total_projects or 0)
            total_rating_sum = float(total_rating_sum or 0)
            
            # Calculate new rating
            new_total_projects = total_projects + 1
            new_total_rating_sum = total_rating_sum + rating
            new_average = new_total_rating_sum / new_total_projects
            
            # Update freelancer profile
            cur.execute("""
                UPDATE freelancer_profile 
                SET rating = %s, total_projects = %s, total_rating_sum = %s
                WHERE freelancer_id = %s
            """, (new_average, new_total_projects, new_total_rating_sum, freelancer_id))
        
        # Insert review with proper hire_request_id
        cur.execute("""
            INSERT INTO review (hire_request_id, client_id, freelancer_id, rating, review_text, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (hire_request_id, client_id, freelancer_id, rating, review_text, now_ts()))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "new_rating": new_average,
            "total_reviews": new_total_projects
        })
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500
@app.route("/client/kyc/upload", methods=["POST"])
def client_kyc_upload():
    """Client KYC document upload"""
    client_id = request.form.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400
    
    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400
    
    # Check if files were uploaded
    if 'government_id' not in request.files or 'pan_card' not in request.files:
        return jsonify({"success": False, "msg": "Both government_id and pan_card files required"}), 400
    
    gov_file = request.files['government_id']
    pan_file = request.files['pan_card']
    
    if gov_file.filename == '' or pan_file.filename == '':
        return jsonify({"success": False, "msg": "No selected file"}), 400
    
    conn = None
    try:
        # Create uploads directory if it doesn't exist
        if not os.path.exists(UPLOADS_FOLDER):
            os.makedirs(UPLOADS_FOLDER)
        
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        # Save files to uploads folder
        gov_filename = secure_filename(gov_file.filename)
        pan_filename = secure_filename(pan_file.filename)
        
        gov_path = os.path.join(UPLOADS_FOLDER, f"client_{client_id}_gov_{gov_filename}")
        pan_path = os.path.join(UPLOADS_FOLDER, f"client_{client_id}_pan_{pan_filename}")
        
        gov_file.save(gov_path)
        pan_file.save(pan_path)
        
        # Create client verification record (simplified)
        cur.execute("""
            INSERT INTO client_verification (client_id, government_id_path, pan_card_path, status, submitted_at)
            VALUES (%s, %s, %s, 'PENDING', %s)
        """, (client_id, gov_path, pan_path, now_ts()))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "msg": "KYC documents uploaded successfully"
        })
    except Exception as e:
        print(f"KYC Upload Error: {str(e)}")
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": f"Failed to save verification data: {str(e)}"}), 500

@app.route("/client/verification/status", methods=["GET"])
def client_verification_status():
    """Get client verification status"""
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400
    
    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400
    
    conn = None
    try:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        
        cur.execute("""
            SELECT status, submitted_at, reviewed_at, rejection_reason
            FROM client_verification
            WHERE client_id = %s
        """, (client_id,))
        
        result = cur.fetchone()
        conn.close()
        
        if not result:
            return jsonify({
                "success": True,
                "status": "NOT_SUBMITTED",
                "msg": "No verification submitted yet."
            })
        
        return jsonify({
            "success": True,
            "status": result["status"],
            "submitted_at": result["submitted_at"],
            "reviewed_at": result.get("reviewed_at"),
            "rejection_reason": result.get("rejection_reason")
        })
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"success": False, "msg": str(e)}), 500
    d = get_json()
    missing = require_fields(d, ["hire_request_id", "freelancer_id", "hours"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    hire_request_id = int(d["hire_request_id"])
    freelancer_id = int(d["freelancer_id"])
    hours = float(d["hours"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Fetch contract snapshot
    cur.execute("""
        SELECT contract_type, contract_hourly_rate, contract_overtime_rate, max_daily_hours
        FROM hire_request 
        WHERE id = %s AND freelancer_id = %s
    """, (hire_request_id, freelancer_id))
    
    contract = cur.fetchone()
    if not contract:
        conn.close()
        return jsonify({"success": False, "msg": "Hire request not found"}), 404
    
    contract_type, hourly_rate, overtime_rate, max_daily_hours = contract
    
    # Ensure contract type is HOURLY
    if contract_type != "HOURLY":
        conn.close()
        return jsonify({"success": False, "msg": "Work logging only available for HOURLY contracts"}), 400
    
    hourly_rate = hourly_rate or 0
    overtime_rate = overtime_rate or 0
    max_daily_hours = max_daily_hours or 8
    
    # Calculate regular and overtime
    if hours > max_daily_hours:
        overtime = hours - max_daily_hours
        regular = max_daily_hours
    else:
        overtime = 0
        regular = hours
    
    # Calculate amount
    amount = (regular * hourly_rate) + (overtime * overtime_rate)
    
    # Insert work log
    cur.execute("""
        INSERT INTO work_log (hire_request_id, freelancer_id, work_date, hours, calculated_regular, calculated_overtime, calculated_amount, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (hire_request_id, freelancer_id, now_ts().split()[0], hours, regular, overtime, amount, now_ts()))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "regular_hours": regular,
        "overtime_hours": overtime,
        "calculated_amount": amount
    })



@app.route("/hourly/log", methods=["POST"])
def hourly_log():
    d = get_json()
    missing = require_fields(d, ["hire_request_id", "freelancer_id", "hours"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    hire_request_id = int(d["hire_request_id"])
    freelancer_id = int(d["freelancer_id"])
    hours = float(d["hours"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Fetch contract snapshot
    cur.execute("""
        SELECT contract_type, contract_hourly_rate, contract_overtime_rate, max_daily_hours
        FROM hire_request 
        WHERE id = %s AND freelancer_id = %s
    """, (hire_request_id, freelancer_id))
    
    contract = cur.fetchone()
    if not contract:
        conn.close()
        return jsonify({"success": False, "msg": "Hire request not found"}), 404
    
    contract_type, hourly_rate, overtime_rate, max_daily_hours = contract
    
    # Ensure contract type is HOURLY
    if contract_type != "HOURLY":
        conn.close()
        return jsonify({"success": False, "msg": "Work logging only available for HOURLY contracts"}), 400
    
    hourly_rate = hourly_rate or 0
    overtime_rate = overtime_rate or 0
    max_daily_hours = max_daily_hours or 8
    
    # Calculate regular and overtime
    if hours > max_daily_hours:
        overtime = hours - max_daily_hours
        regular = max_daily_hours
    else:
        overtime = 0
        regular = hours
    
    # Calculate amount
    amount = (regular * hourly_rate) + (overtime * overtime_rate)
    
    # Insert work log
    cur.execute("""
        INSERT INTO work_log (hire_request_id, freelancer_id, work_date, hours, calculated_regular, calculated_overtime, calculated_amount, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (hire_request_id, freelancer_id, now_ts().split()[0], hours, regular, overtime, amount, now_ts()))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "regular_hours": regular,
        "overtime_hours": overtime,
        "calculated_amount": amount
    })


@app.route("/hourly/generate_invoice", methods=["POST"])
def hourly_generate_invoice():
    d = get_json()
    missing = require_fields(d, ["hire_request_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing hire_request_id"}), 400
    
    hire_request_id = int(d["hire_request_id"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Verify contract is HOURLY
    cur.execute("""
        SELECT contract_type
        FROM hire_request 
        WHERE id = %s
    """, (hire_request_id,))
    
    contract = cur.fetchone()
    if not contract:
        conn.close()
        return jsonify({"success": False, "msg": "Hire request not found"}), 404
    
    contract_type = contract[0]
    if contract_type != "HOURLY":
        conn.close()
        return jsonify({"success": False, "msg": "Invoice generation only available for HOURLY contracts"}), 400
    
    # Sum approved logs
    cur.execute("""
        SELECT SUM(calculated_amount)
        FROM work_log 
        WHERE hire_request_id = %s AND approved = 1
    """, (hire_request_id,))
    
    result = cur.fetchone()
    total_amount = result[0] if result and result[0] else 0
    
    # Create invoice entry
    from datetime import datetime, timedelta
    week_start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    week_end = datetime.now().strftime("%Y-%m-%d")
    
    cur.execute("""
        INSERT INTO invoice (hire_request_id, total_amount, week_start, week_end, created_at)
        VALUES (%s, %s, %s, %s, %s)
    """, (hire_request_id, total_amount, week_start, week_end, now_ts()))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "total_amount": total_amount,
        "week_start": week_start,
        "week_end": week_end
    })


@app.route("/event/complete", methods=["POST"])
def event_complete():
    d = get_json()
    missing = require_fields(d, ["hire_request_id", "actual_hours"])
    if missing:
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    hire_request_id = int(d["hire_request_id"])
    actual_hours = float(d["actual_hours"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    
    # Verify contract is EVENT
    cur.execute("""
        SELECT contract_type, event_base_fee, event_included_hours, event_overtime_rate, advance_paid
        FROM hire_request 
        WHERE id = %s
    """, (hire_request_id,))
    
    contract = cur.fetchone()
    if not contract:
        conn.close()
        return jsonify({"success": False, "msg": "Hire request not found"}), 404
    
    contract_type, event_base_fee, event_included_hours, event_overtime_rate, advance_paid = contract
    
    # Ensure contract type is EVENT
    if contract_type != "EVENT":
        conn.close()
        return jsonify({"success": False, "msg": "Event completion only available for EVENT contracts"}), 400
    
    event_base_fee = event_base_fee or 0
    event_included_hours = event_included_hours or 0
    event_overtime_rate = event_overtime_rate or 0
    advance_paid = advance_paid or 0
    
    # Calculate overtime and amounts
    if actual_hours > event_included_hours:
        overtime_hours = actual_hours - event_included_hours
        extra = overtime_hours * event_overtime_rate
    else:
        overtime_hours = 0
        extra = 0
    
    total_due = event_base_fee + extra
    remaining_due = total_due - advance_paid
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "actual_hours": actual_hours,
        "overtime_hours": overtime_hours,
        "extra_amount": extra,
        "total_due": total_due,
        "remaining_due": remaining_due
    })


# ============================================================
# PLATFORM STATISTICS
# ============================================================

@app.route("/platform/stats", methods=["GET"])
def platform_stats():
    """Get platform-wide statistics"""
    try:
        # Get total freelancers
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT COUNT(*) as cnt FROM freelancer")
        total_freelancers = (cur.fetchone() or {}).get("cnt", 0) or 0
        conn.close()
        
        # Get total clients
        conn = client_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT COUNT(*) as cnt FROM client")
        total_clients = (cur.fetchone() or {}).get("cnt", 0) or 0
        conn.close()
        
        # Get gigs completed
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT COUNT(*) as cnt FROM hire_request WHERE status='COMPLETED'")
        gigs_completed = (cur.fetchone() or {}).get("cnt", 0) or 0
        conn.close()
        
        return jsonify({
            "success": True,
            "total_freelancers": total_freelancers,
            "total_clients": total_clients,
            "gigs_completed": gigs_completed
        })
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500


@app.route("/freelancer/<int:freelancer_id>/stats", methods=["GET"])
def freelancer_profile_stats(freelancer_id):
    """Get freelancer-specific statistics"""
    try:
        # Get rating
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT rating FROM freelancer_profile WHERE freelancer_id=%s", (freelancer_id,))
        rating_row = cur.fetchone()
        rating = (rating_row.get("rating", rating_row[0] if rating_row and not isinstance(rating_row, dict) else 0) or 0.0) if rating_row else 0.0
        conn.close()
        
        # Get gigs completed
        conn = client_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT COUNT(*) as cnt FROM hire_request WHERE freelancer_id=%s AND status='COMPLETED'", (freelancer_id,))
        gigs_completed = (cur.fetchone() or {}).get("cnt", 0) or 0
        
        # Get earnings
        cur.execute("SELECT SUM(proposed_budget) as total FROM hire_request WHERE freelancer_id=%s AND status='COMPLETED'", (freelancer_id,))
        earnings_row = cur.fetchone()
        earnings = (earnings_row.get("total") if isinstance(earnings_row, dict) else (earnings_row[0] if earnings_row else None)) or 0
        conn.close()
        
        return jsonify({
            "success": True,
            "rating": float(rating),
            "gigs_completed": gigs_completed,
            "earnings": earnings
        })
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500


# ============================================================
# CALL ROUTES (Voice/Video Calls)
# ============================================================

@app.route("/call/start", methods=["POST"])
def call_start():
    """Start a voice or video call"""
    d = get_json()
    print(f"Received data: {d}")
    missing = require_fields(d, ["caller_id", "receiver_id", "call_type"])
    if missing:
        print(f"Missing fields: {missing}")
        return jsonify({"success": False, "msg": "Missing fields"}), 400
    
    try:
        caller_id = int(d["caller_id"])
        receiver_id = int(d["receiver_id"])
        call_type = str(d["call_type"]).lower()
        
        if call_type not in ["voice", "video"]:
            return jsonify({"success": False, "msg": "Invalid call type"}), 400
        
        result, error = start_call(caller_id, receiver_id, call_type)
        if error:
            return jsonify({"success": False, "msg": error}), 400
        
        return jsonify({
            "success": True,
            "call_id": result["call_id"],
            "meeting_url": result["meeting_url"]
        })
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/call/accept", methods=["POST"])
def call_accept():
    """Accept an incoming call"""
    d = get_json()
    missing = require_fields(d, ["call_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing call_id"}), 400
    
    try:
        call_id = int(d["call_id"])
        success, error = update_call_status(call_id, "accepted")
        if error:
            return jsonify({"success": False, "msg": error}), 400
        
        # Get call details to return meeting URL
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        cur.execute("SELECT room_name FROM calls WHERE call_id = %s", (call_id,))
        result = cur.fetchone()
        conn.close()
        
        meeting_url = None
        if result and result.get('room_name'):
            meeting_url = f"https://meet.jit.si/{result['room_name']}"
        
        return jsonify({
            "success": True, 
            "msg": "Call accepted",
            "meeting_url": meeting_url
        })
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/call/reject", methods=["POST"])
def call_reject():
    """Reject an incoming call"""
    d = get_json()
    missing = require_fields(d, ["call_id"])
    if missing:
        return jsonify({"success": False, "msg": "Missing call_id"}), 400
    
    try:
        call_id = int(d["call_id"])
        success, error = update_call_status(call_id, "rejected")
        if error:
            return jsonify({"success": False, "msg": error}), 400
        
        return jsonify({"success": True, "msg": "Call rejected"})
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500

@app.route("/call/incoming", methods=["GET"])
def call_incoming():
    """Get incoming calls for a user"""
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"success": False, "msg": "Missing user_id"}), 400
    
    try:
        user_id = int(user_id)
        calls = get_incoming_calls(user_id)
        
        return jsonify({
            "success": True,
            "calls": calls
        })
        
    except Exception as e:
        return jsonify({"success": False, "msg": str(e)}), 500


# ============================================================
# CLIENT HIRE STATUS VIEW
# ============================================================

@app.route("/client/hire/requests", methods=["GET"])
def client_hire_requests():
    """Get all hire requests sent by a client with freelancer details."""
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400
    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, freelancer_id, job_title, proposed_budget, note, status,
                   created_at, contract_type, final_agreed_amount, negotiation_status,
                   payment_status, event_status, payout_status
            FROM hire_request
            WHERE client_id=%s
            ORDER BY created_at DESC
        """, (client_id,))
        rows = cur.fetchall()
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "msg": f"Database error: {str(e)}"}), 500
    conn.close()

    # Enrich with freelancer name/category
    f_conn = freelancer_db()
    f_cur = get_dict_cursor(f_conn)
    out = []
    for r in rows:
        if isinstance(r, dict):
            fid = r.get("freelancer_id")
            rid = r.get("id")
            job_title = r.get("job_title")
            budget = r.get("proposed_budget")
            note = r.get("note")
            status = r.get("status")
            created_at = r.get("created_at")
            contract_type = r.get("contract_type")
            final_amount = r.get("final_agreed_amount")
            neg_status = r.get("negotiation_status")
            payment_status = r.get("payment_status")
            event_status = r.get("event_status")
            payout_status = r.get("payout_status")
        else:
            fid = r[1]
            rid = r[0]
            job_title = r[2]
            budget = r[3]
            note = r[4]
            status = r[5]
            created_at = r[6]
            contract_type = r[7]
            final_amount = r[8] if len(r) > 8 else None
            neg_status = r[9] if len(r) > 9 else None
            payment_status = r[10] if len(r) > 10 else None
            event_status = r[11] if len(r) > 11 else None
            payout_status = r[12] if len(r) > 12 else None

        # Get freelancer name and category
        fname = "Unknown"
        fcategory = ""
        try:
            f_cur.execute("""
                SELECT f.name, fp.category
                FROM freelancer f
                LEFT JOIN freelancer_profile fp ON f.id = fp.freelancer_id
                WHERE f.id=%s
            """, (int(fid) if fid is not None else 0,))
            fdata = f_cur.fetchone()
            if fdata:
                if isinstance(fdata, dict):
                    fname = fdata.get("name", "Unknown")
                    fcategory = fdata.get("category", "")
                else:
                    fname = fdata[0] or "Unknown"
                    fcategory = fdata[1] or ""
        except Exception:
            pass

        out.append({
            "request_id": rid,
            "freelancer_id": fid,
            "freelancer_name": fname,
            "freelancer_category": fcategory,
            "job_title": job_title,
            "proposed_budget": budget,
            "note": note,
            "status": status,
            "created_at": created_at,
            "contract_type": contract_type,
            "final_agreed_amount": final_amount,
            "negotiation_status": neg_status,
            "payment_status": payment_status,
            "event_status": event_status,
            "payout_status": payout_status,
        })
    f_conn.close()
    return jsonify({"success": True, "requests": out})


# ============================================================
# PROJECT SEARCH
# ============================================================

@app.route("/projects/search", methods=["GET"])
def projects_search():
    """Search active projects by keyword across title, category, description."""
    q = request.args.get("q", "").strip()
    freelancer_id = request.args.get("freelancer_id")
    if not q:
        return jsonify({"success": True, "projects": []})

    conn = client_db()
    cur = get_dict_cursor(conn)
    try:
        freelancer_category = None
        if freelancer_id:
            try:
                freelancer_category = _get_freelancer_category(cur, int(freelancer_id))
            except (TypeError, ValueError):
                freelancer_category = None

            if freelancer_category is None:
                return jsonify({"success": True, "projects": []})

        search_pattern = f"%{q}%"
        if freelancer_category:
            cur.execute("""
                SELECT id, client_id, title, category, location, pricing_type, description, status, created_at FROM project_post
                WHERE status='active'
                  AND LOWER(category) = LOWER(%s)
                  AND (title ILIKE %s OR category ILIKE %s OR description ILIKE %s)
                ORDER BY created_at DESC
            """, (freelancer_category, search_pattern, search_pattern, search_pattern))
        else:
            cur.execute("""
                SELECT id, client_id, title, category, location, pricing_type, description, status, created_at FROM project_post
                WHERE status='active'
                  AND (title ILIKE %s OR category ILIKE %s OR description ILIKE %s)
                ORDER BY created_at DESC
            """, (search_pattern, search_pattern, search_pattern))
        rows = cur.fetchall()
        
        # If freelancer_id provided, get their applications to mark has_applied
        applied_project_ids = set()
        if freelancer_id:
            try:
                fid = int(freelancer_id)
                cur.execute("SELECT project_id FROM project_application WHERE freelancer_id=%s", (fid,))
                apps = cur.fetchall()
                for a in apps:
                    val = a.get("project_id") if isinstance(a, dict) else a[0]
                    if val: applied_project_ids.add(val)
            except: pass

        out = []
        for r in rows:
            pid = r.get("id") if isinstance(r, dict) else r[0]
            out.append({
                "id": pid,
                "client_id": r.get("client_id") if isinstance(r, dict) else r[1],
                "title": r.get("title") if isinstance(r, dict) else r[2],
                "category": r.get("category") if isinstance(r, dict) else r[3],
                "location": r.get("location") if isinstance(r, dict) else r[4],
                "pricing_type": r.get("pricing_type") if isinstance(r, dict) else r[5],
                "description": r.get("description") if isinstance(r, dict) else r[6],
                "status": r.get("status") if isinstance(r, dict) else r[7],
                "created_at": r.get("created_at") if isinstance(r, dict) else r[8],
                "has_applied": pid in applied_project_ids
            })
        return jsonify({"success": True, "projects": out})
    except Exception as e:
        return jsonify({"success": False, "msg": f"Database error: {str(e)}"}), 500
    finally:
        conn.close()


# ============================================================
# PROJECT POSTING – CLIENT
# ============================================================

def _get_freelancer_category(cur, freelancer_id):
    """Return freelancer category for project filtering."""
    if not freelancer_id:
        return None

    def _normalize_category_key(value):
        text = " ".join(str(value or "").strip().lower().split())
        aliases = {
            "mehndi": "mehendi artist",
            "mehndi artist": "mehendi artist",
            "mehendi": "mehendi artist",
        }
        return aliases.get(text, text)

    # Freelancer identity/category lives in the freelancer database, not the client database.
    # Some callers pass a client_db cursor for project queries, so do this lookup separately.
    lookup_conn = freelancer_db()
    lookup_cur = get_dict_cursor(lookup_conn)
    try:
        lookup_cur.execute("""
            SELECT fp.category AS profile_category
            FROM freelancer f
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE f.id = %s
        """, (freelancer_id,))
        row = lookup_cur.fetchone()
    finally:
        lookup_conn.close()

    if not row:
        return None

    profile_category = row.get("profile_category") if isinstance(row, dict) else row[0]
    category = (profile_category or "").strip()
    normalized_category = _normalize_category_key(category)
    return normalized_category or None


def _ensure_project_post_table():
    """Create project_post table if it doesn't exist."""
    conn = client_db()
    cur = get_dict_cursor(conn)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS project_post (
            id SERIAL PRIMARY KEY,
            client_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            location TEXT,
            budget_type TEXT,
            pricing_type TEXT,
            description TEXT,
            status TEXT DEFAULT 'active',
            created_at INTEGER NOT NULL
        )
    """)
    
    # Add pricing_type column if it doesn't exist (for backward compatibility)
    try:
        cur.execute("""
            ALTER TABLE project_post 
            ADD COLUMN IF NOT EXISTS pricing_type TEXT
        """)
    except Exception as e:
        print(f"Error adding pricing_type column: {e}")
    
    conn.commit()
    conn.close()

try:
    _ensure_project_post_table()
except Exception as _e:
    import logging
    logging.getLogger(__name__).warning(f"project_post table init failed: {_e}")


@app.route("/client/project", methods=["POST"])
def client_post_project():
    """Client posts a new project."""
    d = get_json()
    missing = require_fields(d, ["client_id", "title", "category", "description"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing fields: {missing}"}), 400

    client_id = int(d["client_id"])
    title = str(d["title"]).strip()[:200]
    category = str(d["category"]).strip()[:100]
    location = str(d.get("location", "") or "").strip()[:200]
    description = str(d["description"]).strip()[:2000]

    # Derive pricing_type from category
    try:
        pricing_type = get_pricing_type_for_category(category)
    except Exception:
        return jsonify({"success": False, "msg": "Invalid category"}), 400

    conn = client_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute(
            """INSERT INTO project_post (client_id, title, category, location, pricing_type, description, status, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (client_id, title, category, location, pricing_type, description, "active", now_ts())
        )
        row = cur.fetchone()
        project_id = row["id"] if isinstance(row, dict) else row[0]
        conn.commit()
    except Exception as e:
        print(f"Error in client_post_project: {str(e)}")
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "msg": f"Database error: {str(e)}"}), 500
    conn.close()
    return jsonify({"success": True, "project_id": project_id})


@app.route("/client/projects", methods=["GET"])
def client_get_projects():
    """Get all projects posted by a client (or all active projects when no client_id given)."""
    client_id = request.args.get("client_id")
    conn = client_db()
    cur = get_dict_cursor(conn)
    try:
        if client_id:
            cur.execute(
                "SELECT id, client_id, title, category, location, pricing_type, description, status, created_at FROM project_post WHERE client_id=%s ORDER BY created_at DESC",
                (int(client_id),)
            )
        else:
            cur.execute("SELECT id, client_id, title, category, location, pricing_type, description, status, created_at FROM project_post WHERE status='active' ORDER BY created_at DESC")
        rows = cur.fetchall()
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "msg": "Database error"}), 500
    conn.close()
    out = []
    for r in rows:
        out.append({
            "id": r.get("id") if isinstance(r, dict) else r[0],
            "client_id": r.get("client_id") if isinstance(r, dict) else r[1],
            "title": r.get("title") if isinstance(r, dict) else r[2],
            "category": r.get("category") if isinstance(r, dict) else r[3],
            "location": r.get("location") if isinstance(r, dict) else r[4],
            "pricing_type": r.get("pricing_type") if isinstance(r, dict) else r[5],
            "description": r.get("description") if isinstance(r, dict) else r[6],
            "status": r.get("status") if isinstance(r, dict) else r[7],
            "created_at": r.get("created_at") if isinstance(r, dict) else r[8],
        })
    return jsonify({"success": True, "projects": out})


@app.route("/projects/all", methods=["GET"])
def projects_all():
    """All active projects – visible to freelancers browsing opportunities."""
    freelancer_id = request.args.get("freelancer_id")
    conn = client_db()
    cur = get_dict_cursor(conn)
    try:
        freelancer_category = None
        if freelancer_id:
            try:
                freelancer_category = _get_freelancer_category(cur, int(freelancer_id))
            except (TypeError, ValueError):
                freelancer_category = None

            if freelancer_category is None:
                return jsonify({"success": True, "projects": []})

        if freelancer_category:
            cur.execute("""
                SELECT id, client_id, title, category, location, pricing_type, description, status, created_at
                FROM project_post
                WHERE status='active' AND LOWER(category) = LOWER(%s)
                ORDER BY created_at DESC
            """, (freelancer_category,))
        else:
            cur.execute("SELECT id, client_id, title, category, location, pricing_type, description, status, created_at FROM project_post WHERE status='active' ORDER BY created_at DESC")
        rows = cur.fetchall()
        
        # If freelancer_id provided, get their applications to mark has_applied
        applied_project_ids = set()
        if freelancer_id:
            try:
                fid = int(freelancer_id)
                cur.execute("SELECT project_id FROM project_application WHERE freelancer_id=%s", (fid,))
                apps = cur.fetchall()
                for a in apps:
                    val = a.get("project_id") if isinstance(a, dict) else a[0]
                    if val: applied_project_ids.add(val)
            except: pass

        out = []
        for r in rows:
            pid = r.get("id") if isinstance(r, dict) else r[0]
            out.append({
                "id": pid,
                "client_id": r.get("client_id") if isinstance(r, dict) else r[1],
                "title": r.get("title") if isinstance(r, dict) else r[2],
                "category": r.get("category") if isinstance(r, dict) else r[3],
                "location": r.get("location") if isinstance(r, dict) else r[4],
                "pricing_type": r.get("pricing_type") if isinstance(r, dict) else r[5],
                "description": r.get("description") if isinstance(r, dict) else r[6],
                "status": r.get("status") if isinstance(r, dict) else r[7],
                "created_at": r.get("created_at") if isinstance(r, dict) else r[8],
                "has_applied": pid in applied_project_ids
            })
        return jsonify({"success": True, "projects": out})
    except Exception as e:
        return jsonify({"success": False, "msg": f"Database error: {str(e)}"}), 500
    finally:
        conn.close()


# ============================================================
# NOTIFICATIONS – CLIENT AND FREELANCER
# ============================================================

@app.route("/client/notifications", methods=["GET"])
def client_notifications_by_id():
    """Fetch notifications for a client by client_id."""
    client_id = request.args.get("client_id")
    if not client_id:
        return jsonify({"success": False, "msg": "client_id required"}), 400
    try:
        client_id = int(client_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid client_id"}), 400

    try:
        from notification_helper import get_client_notifications
        notifications = get_client_notifications(client_id, limit=50)
        return jsonify({"success": True, "notifications": notifications})
    except Exception:
        return jsonify({"success": False, "msg": "Database error"}), 500


@app.route("/freelancer/notifications", methods=["GET"])
def freelancer_notifications_by_id():
    """Fetch notifications for a freelancer by freelancer_id."""
    freelancer_id = request.args.get("freelancer_id")
    if not freelancer_id:
        return jsonify({"success": False, "msg": "freelancer_id required"}), 400
    try:
        freelancer_id = int(freelancer_id)
    except ValueError:
        return jsonify({"success": False, "msg": "Invalid freelancer_id"}), 400

    try:
        from notification_helper import get_freelancer_notifications
        notifications = get_freelancer_notifications(freelancer_id, limit=50)
        return jsonify({"success": True, "notifications": notifications})
    except Exception:
        return jsonify({"success": False, "msg": "Database error"}), 500


@app.route("/api/notifications/read-all/<int:user_id>", methods=["PUT"])
def api_notifications_mark_all_read(user_id):
    from notification_helper import mark_all_notifications_as_read, get_unread_notification_count_for_role

    recipient_role = request.headers.get("X-USER-ROLE", "freelancer").strip().lower() or "freelancer"
    updated = mark_all_notifications_as_read(user_id, recipient_role=recipient_role)
    unread_count = get_unread_notification_count_for_role(user_id, recipient_role=recipient_role)
    return jsonify({"success": True, "updated": updated, "unread_count": unread_count})


@app.route("/api/notifications/<int:notification_id>/read", methods=["PUT"])
def api_notifications_mark_read(notification_id):
    from notification_helper import mark_notification_as_read, get_unread_notification_count_for_role

    row = mark_notification_as_read(notification_id)
    if not row:
        return jsonify({"success": False, "msg": "Notification not found"}), 404

    unread_count = get_unread_notification_count_for_role(row["user_id"], recipient_role=row.get("recipient_role") or "freelancer")
    return jsonify({"success": True, "notification_id": row["notification_id"], "unread_count": unread_count})


@app.route("/api/notifications/<int:user_id>", methods=["GET"])
def api_notifications(user_id):
    from notification_helper import get_notifications, get_unread_notification_count_for_role

    recipient_role = request.headers.get("X-USER-ROLE", "freelancer").strip().lower() or "freelancer"
    generate_action_required_notifications(user_id)
    notifications = get_notifications(user_id, recipient_role=recipient_role, limit=100)
    unread_count = get_unread_notification_count_for_role(user_id, recipient_role=recipient_role)

    return jsonify({
        "success": True,
        "unread_count": unread_count,
        "notifications": notifications,
    })


# ============================================================
# PHASE 4: PAYMENTS, EXECUTION AND REVIEWS
# ============================================================

import razorpay
import hmac
import hashlib

RAZORPAY_KEY_ID = 'rzp_test_SUJ9gz60CfdMWX'
RAZORPAY_KEY_SECRET = 'KiHXGap8Xly3BH7YRTi6Da0D'

try:
    razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
except Exception as e:
    logger.warning("Could not initialize Razorpay client.")

@app.route("/payment/create-order", methods=["POST"])
def payment_create_order():
    """Create a Razorpay order before payment."""
    d = get_json()
    missing = require_fields(d, ["hire_request_id"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing fields: {missing}"}), 400

    hire_request_id = int(d["hire_request_id"])
    
    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute("SELECT proposed_budget, final_agreed_amount FROM hire_request WHERE id=%s", (hire_request_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire request not found"}), 404
        
        # Use final agreed amount if it exists, else use proposed budget
        amount = row.get("final_agreed_amount") if isinstance(row, dict) else row[1]
        if not amount:
            amount = row.get("proposed_budget") if isinstance(row, dict) else row[0]
            
        amount_paise = int(float(amount) * 100)
        
        # Create Razorpay Order
        options = {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"receipt_hire_{hire_request_id}"
        }
        order = razorpay_client.order.create(data=options)
        
        # Save to DB
        cur.execute(
            """INSERT INTO payment_records (hire_id, razorpay_order_id, amount, status, created_at)
               VALUES (%s, %s, %s, %s, %s)""",
            (hire_request_id, order['id'], amount, 'PENDING', now_ts())
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "msg": f"Payment error: {str(e)}"}), 500
    
    conn.close()
    return jsonify({
        "success": True, 
        "order_id": order['id'],
        "amount": order['amount'],
        "currency": order['currency'],
        "key_id": RAZORPAY_KEY_ID
    })


def send_payment_received_email(freelancer_email, freelancer_name, amount, project_title, client_name):
    """Send professional payment confirmation email to freelancer."""
    from datetime import datetime
    current_date = datetime.now().strftime("%d %B %Y")
    
    subject = f"💰 Payment Received – ₹{amount} Credited"
    
    body = f"""Hi {freelancer_name},

🎉 Payment Successful!

You have received a payment for your work on GigBridge.

━━━━━━━━━━━━━━━━━━━━━━━
💰 Amount Received: ₹{amount}
📌 Project: {project_title}
👤 Client: {client_name}
📅 Date: {current_date}
━━━━━━━━━━━━━━━━━━━━━━━

The amount has been successfully credited to your account.

You can view your earnings and transaction details in your dashboard.

Thank you for using GigBridge 🚀

Best regards,
Team GigBridge"""
    
    return send_email(freelancer_email, subject, body.strip())

def send_payment_receipt_emails(hire_id, order_id, payment_id, amount, currency="INR", status="Paid"):
    """Send payment receipt emails to both client and freelancer."""
    conn = freelancer_db()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT hr.id, hr.job_title, hr.client_id, hr.freelancer_id,
                   c.name AS client_name, c.email AS client_email,
                   f.name AS freelancer_name, f.email AS freelancer_email
            FROM hire_request hr
            LEFT JOIN client c ON c.id = hr.client_id
            LEFT JOIN freelancer f ON f.id = hr.freelancer_id
            WHERE hr.id = %s
        """, (hire_id,))
        row = cur.fetchone()
        if not row:
            return

        amount_value = float(amount or 0)
        currency = currency or "INR"
        paid_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        job_title = row.get("job_title") or f"Hire Request #{hire_id}"
        client_name = row.get("client_name") or "Client"
        freelancer_name = row.get("freelancer_name") or "Freelancer"

        client_body = f"""
Hi {client_name},

Your payment was received successfully on GigBridge.

Transaction details:
- Transaction ID: {payment_id}
- Order ID: {order_id}
- Hire Request ID: {hire_id}
- Project / Job: {job_title}
- Amount Debited: {currency} {amount_value:,.2f}
- Status: {status}
- Paid At: {paid_at}
- Freelancer: {freelancer_name}

Please keep this email for your records.
"""

        freelancer_body = f"""
Hi {freelancer_name},

You have received a funded booking on GigBridge.

Transaction details:
- Transaction ID: {payment_id}
- Order ID: {order_id}
- Hire Request ID: {hire_id}
- Project / Job: {job_title}
- Amount Received: {currency} {amount_value:,.2f}
- Status: {status}
- Paid At: {paid_at}
- Client: {client_name}

Please keep this email for your records.
"""

        if row.get("client_email"):
            send_email(
                row["client_email"],
                f"GigBridge Payment Receipt - TXN {payment_id}",
                client_body.strip(),
                related_project_id=hire_id
            )
        if row.get("freelancer_email"):
            send_email(
                row["freelancer_email"],
                f"GigBridge Payment Confirmation - TXN {payment_id}",
                freelancer_body.strip(),
                related_project_id=hire_id
            )
    finally:
        conn.close()


@app.route("/payment/verify", methods=["POST"])
def payment_verify():
    """Verify Razorpay payment signature after successful client transaction."""
    d = get_json()
    missing = require_fields(d, ["hire_request_id", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing fields: {missing}"}), 400

    order_id = str(d["razorpay_order_id"])
    payment_id = str(d["razorpay_payment_id"])
    signature = str(d["razorpay_signature"])
    hire_id = int(d["hire_request_id"])

    # Verify Signature
    body = order_id + "|" + payment_id
    expected_signature = hmac.new(
        bytes(RAZORPAY_KEY_SECRET, 'utf-8'),
        bytes(body, 'utf-8'),
        hashlib.sha256
    ).hexdigest()

    if expected_signature == signature:
        conn = freelancer_db()
        cur = get_dict_cursor(conn)
        try:
            cur.execute("""
                SELECT hr.client_id, hr.freelancer_id,
                       COALESCE(hr.final_agreed_amount, hr.proposed_budget, pr.amount) AS amount
                FROM hire_request hr
                LEFT JOIN payment_records pr ON pr.hire_id = hr.id AND pr.razorpay_order_id = %s
                WHERE hr.id = %s
            """, (order_id, hire_id))
            hire_row = cur.fetchone()

            # Update payment record
            cur.execute(
                """UPDATE payment_records 
                   SET status = 'SUCCESS', razorpay_payment_id = %s, razorpay_signature = %s 
                   WHERE razorpay_order_id = %s""",
                (payment_id, signature, order_id)
            )
            # Update hire request
            cur.execute("UPDATE hire_request SET payment_status = 'paid' WHERE id = %s", (hire_id,))
            if hire_row:
                log_transaction(
                    hire_row.get("freelancer_id"),
                    hire_row.get("client_id"),
                    float(hire_row.get("amount") or 0),
                    "Paid",
                    hire_id
                )
            conn.commit()
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({"success": False, "msg": "Database error"}), 500
        conn.close()
        try:
            # Send professional payment confirmation email to freelancer
            if hire_row and hire_row.get("freelancer_id"):
                conn = freelancer_db()
                try:
                    cur = get_dict_cursor(conn)
                    cur.execute("""
                        SELECT f.email, f.name, hr.job_title, c.name AS client_name
                        FROM freelancer f
                        JOIN hire_request hr ON hr.id = %s
                        LEFT JOIN client c ON c.id = hr.client_id
                        WHERE f.id = %s
                    """, (hire_id, hire_row.get("freelancer_id")))
                    freelancer_info = cur.fetchone()
                    
                    if freelancer_info and freelancer_info.get("email"):
                        send_payment_received_email(
                            freelancer_email=freelancer_info["email"],
                            freelancer_name=freelancer_info.get("name", "Freelancer"),
                            amount=int(hire_row.get("amount") or 0),
                            project_title=freelancer_info.get("job_title", f"Project #{hire_id}"),
                            client_name=freelancer_info.get("client_name", "Client")
                        )
                except Exception as e:
                    logger.warning(f"Professional payment email failed: {e}")
                finally:
                    conn.close()
        except Exception as e:
            logger.warning(f"Payment email integration failed: {e}")
        try:
            from notification_helper import notify_freelancer
            if hire_row:
                notify_freelancer(
                    freelancer_id=hire_row.get("freelancer_id"),
                    sender_id=hire_row.get("client_id"),
                    notification_type="PAYMENT_RECEIVED",
                    title="Payment Received",
                    message=f"Payment of INR {float(hire_row.get('amount') or 0):,.2f} was completed for your gig.",
                    related_entity_type="payment",
                    related_entity_id=hire_id,
                    reference_id=hire_id,
                )
        except Exception as e:
            logger.warning(f"Payment notification failed: {e}")
        return jsonify({"success": True, "msg": "Payment verified successfully"})
    else:
        return jsonify({"success": False, "msg": "Invalid signature"}), 400


@app.route("/freelancer/hire/complete", methods=["POST"])
def freelancer_hire_complete():
    """Freelancer explicitly marks an active job as complete and submits proof."""
    d = get_json()
    missing = require_fields(d, ["freelancer_id", "hire_request_id"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing: {missing}"}), 400

    fid = int(d["freelancer_id"])
    hid = int(d["hire_request_id"])
    note = str(d.get("note", ""))

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute(
            """UPDATE hire_request 
               SET event_status = 'completed', completion_note = %s, completed_at = %s 
               WHERE id = %s AND freelancer_id = %s AND status = 'ACCEPTED'""",
            (note, now_ts(), hid, fid)
        )
        if cur.rowcount == 0:
            return jsonify({"success": False, "msg": "Cannot complete this project. Ensure you are hired for it."}), 400
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "msg": "Database error"}), 500
    conn.close()
    return jsonify({"success": True, "msg": "Work marked as completed successfully."})


@app.route("/client/hire/approve", methods=["POST"])
def client_hire_approve():
    """Client approves the completed work, staging it for payout."""
    d = get_json()
    missing = require_fields(d, ["client_id", "hire_request_id"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing: {missing}"}), 400

    cid = int(d["client_id"])
    hid = int(d["hire_request_id"])

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute(
            """UPDATE hire_request 
               SET payout_status = 'processing' 
               WHERE id = %s AND client_id = %s AND event_status = 'completed'""",
            (hid, cid)
        )
        if cur.rowcount == 0:
            return jsonify({"success": False, "msg": "Cannot approve. Ensure work was marked completed."}), 400
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "msg": "Database error"}), 500
    conn.close()
    return jsonify({"success": True, "msg": "Work approved."})


@app.route("/client/hire/review", methods=["POST"])
def client_hire_review():
    """Client leaves a review containing a 1-5 rating, concluding the contract entirely."""
    d = get_json()
    missing = require_fields(d, ["client_id", "hire_request_id", "rating"])
    if missing:
        return jsonify({"success": False, "msg": f"Missing: {missing}"}), 400

    cid = int(d["client_id"])
    hid = int(d["hire_request_id"])
    rating = float(d["rating"])
    review_text = str(d.get("review_text", ""))

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        # Get freelancer id for this hire
        cur.execute("SELECT freelancer_id FROM hire_request WHERE id = %s AND client_id = %s", (hid, cid))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "msg": "Hire request not found"}), 404
            
        fid = row.get("freelancer_id") if isinstance(row, dict) else row[0]

        # Insert Review (Ignore if duplicate rating for same hire)
        cur.execute(
            """INSERT INTO review (hire_request_id, client_id, freelancer_id, rating, review_text, created_at)
               VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (hire_request_id) DO NOTHING""",
            (hid, cid, fid, rating, review_text, now_ts())
        )
        
        # Finalize project status
        cur.execute("UPDATE hire_request SET status = 'COMPLETED' WHERE id = %s", (hid,))

        # Update absolute averages on freelancer_profile (simple rolling average simulation)
        cur.execute(
            """UPDATE freelancer_profile 
               SET total_projects = COALESCE(total_projects, 0) + 1,
                   total_rating_sum = COALESCE(total_rating_sum, 0) + %s
               WHERE freelancer_id = %s""",
            (rating, fid)
        )
        cur.execute(
            """UPDATE freelancer_profile 
               SET rating = ROUND((total_rating_sum::numeric / total_projects::numeric), 1)
               WHERE freelancer_id = %s AND total_projects > 0""",
            (fid,)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "msg": "Database error"}), 500
    conn.close()
    return jsonify({"success": True, "msg": "Review submitted successfully!"})


@app.route("/freelancer/reviews", methods=["GET"])
def freelancer_reviews():
    """Fetch all reviews for a freelancer."""
    fid = request.args.get("freelancer_id")
    if not fid:
        return jsonify({"success": False, "msg": "missing freelancer_id"}), 400

    conn = freelancer_db()
    cur = get_dict_cursor(conn)
    try:
        cur.execute(
            """SELECT r.rating, r.review_text, r.created_at, c.name as client_name 
               FROM review r 
               LEFT JOIN client c ON r.client_id = c.id 
               WHERE r.freelancer_id = %s ORDER BY r.created_at DESC""",
            (int(fid),)
        )
        rows = cur.fetchall()
        
        out = []
        for r in rows:
            out.append({
                "rating": r.get("rating") if isinstance(r, dict) else r[0],
                "review_text": r.get("review_text") if isinstance(r, dict) else r[1],
                "created_at": r.get("created_at") if isinstance(r, dict) else r[2],
                "client_name": r.get("client_name") if isinstance(r, dict) else r[3],
            })
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "msg": "Database errors"}), 500
    conn.close()
    return jsonify({"success": True, "reviews": out})


# ============================================================
# NOTIFICATION APIS
# ============================================================

@app.route("/notifications", methods=["GET"])
def notifications_list_api():
    """Get notifications for a user"""
    user_id = request.args.get("user_id")
    role = request.args.get("role", "freelancer")
    limit = int(request.args.get("limit", 50))
    
    if not user_id:
        return jsonify({"success": False, "msg": "user_id required"}), 400
    
    # STEP 1: ROLE NORMALIZATION (CRITICAL FIX)
    # Handle frontend role mapping: "artist" -> "freelancer"
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid user_id"}), 400

    role = (role or "").lower().strip()
    if role == "artist":
        role = "freelancer"
    
    if role not in ["client", "freelancer"]:
        print(f"[DEBUG] Invalid role provided for notifications: {role}")
        return jsonify({"success": True, "notifications": []})
    
    print(f"Fetching notifications: {user_id} {role}")
    
    try:
        from notification_helper import get_notifications as fetch_notifications
        notifications = fetch_notifications(user_id, role, limit)
        return jsonify({"success": True, "notifications": notifications})
    except Exception as e:
        logger.error(f"Error getting notifications: {e}")
        return jsonify({"success": False, "msg": "Database error"}), 500


@app.route("/notifications/unread-count", methods=["GET"])
def get_unread_count():
    """Get unread notification count for a user"""
    user_id = request.args.get("user_id")
    role = request.args.get("role", "freelancer")
    
    if not user_id:
        return jsonify({"success": False, "msg": "user_id required"}), 400
    
    # STEP 1: ROLE NORMALIZATION (CRITICAL FIX)
    # Handle frontend role mapping: "artist" -> "freelancer"
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid user_id"}), 400

    role = (role or "").lower().strip()
    if role == "artist":
        role = "freelancer"
    
    if role not in ["client", "freelancer"]:
        print(f"[DEBUG] Invalid role provided for unread-count: {role}")
        return jsonify({"success": True, "unread_count": 0})
    
    print(f"Fetching unread count: {user_id} {role}")
    
    try:
        from notification_helper import get_unread_notification_count_for_role
        count = get_unread_notification_count_for_role(user_id, role)
        return jsonify({"success": True, "unread_count": count})
    except Exception as e:
        logger.error(f"Error getting unread count: {e}")
        return jsonify({"success": False, "msg": "Database error"}), 500


@app.route("/notifications/mark-read", methods=["POST"])
def mark_notification_read():
    """Mark a notification as read"""
    d = get_json()
    if not d or "notification_id" not in d:
        return jsonify({"success": False, "msg": "Missing notification_id"}), 400
    
    try:
        notification_id = int(d["notification_id"])
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid notification_id"}), 400
    
    try:
        from notification_helper import mark_notification_as_read, get_unread_notification_count_for_role
        result = mark_notification_as_read(notification_id)
        if result:
            unread_count = get_unread_notification_count_for_role(
                result["user_id"],
                result.get("recipient_role") or "freelancer"
            )
            return jsonify({"success": True, "unread_count": unread_count})
        else:
            return jsonify({"success": False, "msg": "Notification not found"}), 404
    except Exception as e:
        logger.error(f"Error marking notification as read: {e}")
        return jsonify({"success": False, "msg": "Database error"}), 500


@app.route("/notifications/mark-all-read", methods=["POST"])
def mark_all_notifications_read():
    """Mark all notifications as read for a user"""
    d = get_json()
    if not d or "user_id" not in d or "role" not in d:
        return jsonify({"success": False, "msg": "Missing user_id or role"}), 400
    
    user_id = d["user_id"]
    role = d["role"]
    
    # STEP 1: ROLE NORMALIZATION (CRITICAL FIX)
    # Handle frontend role mapping: "artist" -> "freelancer"
    role = (role or "").lower().strip()
    if role == "artist":
        role = "freelancer"

    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "msg": "Invalid user_id"}), 400
    
    if role not in ["client", "freelancer"]:
        print(f"[DEBUG] Invalid role provided for mark-all-read: {role}")
        return jsonify({"success": True, "marked_count": 0})
    
    print(f"Marking all read for: {user_id} {role}")
    
    try:
        from notification_helper import mark_all_notifications_as_read
        affected = mark_all_notifications_as_read(user_id, role)
        return jsonify({"success": True, "marked_count": affected})
    except Exception as e:
        logger.error(f"Error marking all notifications as read: {e}")
        return jsonify({"success": False, "msg": "Database error"}), 500


# ============================================================
# SERVER STARTUP
# ============================================================

if __name__ == "__main__":
    # Test database connection before starting server
    logger.info("Starting GigBridge backend server...")
    logger.info("Testing database connection...")
    
    try:
        from postgres_config import test_database_connection, ensure_database_exists
        
        # 1. Ensure database exists
        if ensure_database_exists():
            logger.info("Database validation passed")
            # 2. Create core tables
            try:
                create_tables()
                logger.info("Core database tables initialized")
            except Exception as e:
                logger.error(f"Core table creation failed: {e}")

            # 3. Create admin tables
            try:
                ensure_admin_tables()
                logger.info("Admin database tables initialized")
            except Exception as e:
                logger.error(f"Admin table creation failed: {e}")
            
            # 4. Run detailed validation
            validate_startup()
            
            # 5. Load semantic index (can be slow, but better here than at module level)
            init_semantic_search()
        else:
            logger.error("Failed to ensure database exists")
            
        # Test connection
        if test_database_connection():
            logger.info("Database connection test passed")
        else:
            logger.error("Database connection test failed")
            
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        logger.error("Please ensure PostgreSQL is running and configured correctly")
    
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("ENV") != "production"
    logger.info(f"Starting Flask server on http://0.0.0.0:{port}")
    
    # Start background scheduler
    import threading
    threading.Thread(target=run_scheduler, daemon=True).start()

    # Start with Socket.IO if available
    if SOCKET_IO_ENABLED and socketio is not None:
        logger.info("Starting server with Socket.IO support")
        try:
            SOCKET_IO_REALLY_WORKING = True
            socketio.run(app, host='0.0.0.0', port=port, debug=debug_mode, allow_unsafe_werkzeug=True)
        except Exception as e:
            SOCKET_IO_REALLY_WORKING = False
            logger.error(f"Socket.IO server failed: {e}")
            logger.info("Falling back to regular Flask server")
            app.run(host='0.0.0.0', port=port, debug=debug_mode)
    else:
        logger.info("Starting server without Socket.IO support")
        app.run(host='0.0.0.0', port=port, debug=debug_mode)
