"""
Notification helper utilities for unified artist/client notifications.
"""

import time
import database as db

VALID_NOTIFICATION_TYPES = {
    "HIRED",
    "PAYMENT_RECEIVED",
    "PROJECT_COMPLETED",
    "APPLICATION_UPDATE",
    "ACTION_REQUIRED",
}


def normalize_recipient_role(role):
    """Normalize frontend/backend role variants to the canonical DB values."""
    role = (role or "").lower().strip()
    if role == "artist":
        role = "freelancer"
    elif role == "user":
        role = "client"

    if role not in ["client", "freelancer"]:
        return None

    return role


def _normalize_notification_type(notification_type=None, related_entity_type=None, title=None):
    raw_type = (notification_type or "").strip().upper()
    if raw_type in VALID_NOTIFICATION_TYPES:
        return raw_type

    related_type = (related_entity_type or "").strip().lower()
    title_text = (title or "").strip().lower()

    if "payment" in related_type or "payment" in title_text:
        return "PAYMENT_RECEIVED"
    if "project" in related_type and ("complete" in title_text or "verified" in title_text):
        return "PROJECT_COMPLETED"
    if "hire" in related_type or "hired" in title_text or "accepted" in title_text:
        return "HIRED"
    return "APPLICATION_UPDATE"


def notify_user(user_id, role, title, message, related_entity_type=None, related_entity_id=None, reference_id=None, sender_id=None):
    """
    Central notification function - SINGLE SOURCE OF TRUTH
    
    Args:
        user_id: ID of the user to notify
        role: EXACTLY "client" or "freelancer" 
        title: Notification title
        message: Notification message
        related_entity_type: Type of related entity (optional)
        related_entity_id: ID of related entity (optional)
        reference_id: Reference ID (optional)
        sender_id: ID of sender (optional)
    
    Returns:
        dict: Created notification data or None if failed
    """
    if not user_id or not role or not title or not message:
        print(f"[NOTIFICATION] Missing required fields: user_id={user_id}, role={role}, title={title}, message={message}")
        return None
    
    # Ensure role consistency (CRITICAL ROLE NORMALIZATION)
    role = normalize_recipient_role(role)

    if role is None:
        print(f"[NOTIFICATION] Invalid role: {role}. Must be 'client' or 'freelancer'")
        return None
    
    print(f"Creating notification: {user_id} {role} - {title}")
    
    # Use reference_id if provided, otherwise use related_entity_id
    final_reference_id = reference_id if reference_id is not None else related_entity_id
    
    # Determine notification type
    notification_type = _normalize_notification_type(
        notification_type=None,
        related_entity_type=related_entity_type,
        title=title
    )
    
    try:
        conn = db.freelancer_db()
        cur = db.get_dict_cursor(conn)
        
        cur.execute("""
            INSERT INTO notifications (user_id, recipient_role, sender_id, type, title, message, reference_id, is_read, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, NOW())
            RETURNING notification_id, user_id, recipient_role, sender_id, type, title, message, reference_id, is_read,
                      EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        """, (user_id, role, sender_id, notification_type, title, message, final_reference_id))
        
        row = cur.fetchone()
        conn.commit()
        conn.close()
        
        if not row:
            print(f"[NOTIFICATION] Failed to insert notification for user {user_id}")
            return None
        
        payload = {
            "notification_id": row["notification_id"],
            "user_id": row["user_id"],
            "recipient_role": row.get("recipient_role"),
            "sender_id": row.get("sender_id"),
            "type": row["type"],
            "title": row["title"],
            "message": row["message"],
            "reference_id": row.get("reference_id"),
            "is_read": bool(row.get("is_read", False)),
            "created_at": row.get("created_at"),
        }
        
        # Real-time support via Socket.IO (if available)
        try:
            from socket_service import socketio
            if socketio:
                socketio.emit("new_notification", payload, room=f"user_{user_id}")
                print(f"[NOTIFICATION] Real-time notification sent to user_{user_id}")
        except Exception as e:
            print(f"[NOTIFICATION] Socket.IO error: {e}")
        
        print(f"[NOTIFICATION] Created: {role} {user_id} - {title}")
        return payload
        
    except Exception as e:
        print(f"[NOTIFICATION] Error creating notification: {e}")
        return None


def create_notification(user_id, title, message, notification_type="APPLICATION_UPDATE", sender_id=None, reference_id=None, recipient_role="freelancer"):
    if not user_id or not title or not message:
        return None

    # Role normalization
    recipient_role = normalize_recipient_role(recipient_role)
    if recipient_role is None:
        return None

    normalized_type = _normalize_notification_type(notification_type=notification_type, title=title)

    conn = db.freelancer_db()
    try:
        cur = db.get_dict_cursor(conn)
        cur.execute("""
            INSERT INTO notifications (user_id, recipient_role, sender_id, type, title, message, reference_id, is_read, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, NOW())
            RETURNING notification_id, user_id, recipient_role, sender_id, type, title, message, reference_id, is_read,
                      EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        """, (user_id, recipient_role, sender_id, normalized_type, title, message, reference_id))
        row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    payload = {
        "notification_id": row["notification_id"],
        "user_id": row["user_id"],
        "recipient_role": row.get("recipient_role"),
        "sender_id": row.get("sender_id"),
        "type": row["type"],
        "title": row["title"],
        "message": row["message"],
        "reference_id": row.get("reference_id"),
        "is_read": bool(row.get("is_read", False)),
        "created_at": row.get("created_at"),
    }

    try:
        from socket_service import socketio
        if socketio:
            socketio.emit("new_notification", payload, room=f"user_{user_id}")
    except Exception:
        pass

    return payload


def notify_freelancer(
    freelancer_id,
    message,
    title,
    related_entity_type=None,
    related_entity_id=None,
    notification_type=None,
    sender_id=None,
    reference_id=None,
):
    """
    Wrapper function for freelancer notifications - uses central notify_user
    """
    return notify_user(
        user_id=freelancer_id,
        role="freelancer",
        title=title,
        message=message,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        reference_id=reference_id,
        sender_id=sender_id
    )


def notify_client(
    client_id,
    message,
    title,
    related_entity_type=None,
    related_entity_id=None,
    notification_type=None,
    sender_id=None,
    reference_id=None,
):
    """
    Wrapper function for client notifications - uses central notify_user
    """
    return notify_user(
        user_id=client_id,
        role="client",
        title=title,
        message=message,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        reference_id=reference_id,
        sender_id=sender_id
    )


def get_notifications(user_id, recipient_role="freelancer", limit=100):
    if not user_id:
        return []

    recipient_role = normalize_recipient_role(recipient_role)
    if recipient_role is None:
        return []

    print(f"Fetching notifications: {user_id} {recipient_role}")

    conn = db.freelancer_db()
    try:
        cur = db.get_dict_cursor(conn)
        cur.execute("""
            SELECT notification_id, user_id, sender_id, type, title, message, reference_id, is_read,
                   EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
            FROM notifications
            WHERE user_id = %s AND recipient_role = %s
            ORDER BY created_at DESC
            LIMIT %s
        """, (user_id, recipient_role, limit))
        rows = cur.fetchall()
        return [
            {
                "notification_id": row["notification_id"],
                "user_id": row["user_id"],
                "sender_id": row.get("sender_id"),
                "type": row["type"],
                "related_entity_type": row["type"],
                "title": row["title"],
                "message": row["message"],
                "reference_id": row.get("reference_id"),
                "related_entity_id": row.get("reference_id"),
                "is_read": bool(row.get("is_read", False)),
                "created_at": row.get("created_at"),
            }
            for row in rows
        ]
    finally:
        conn.close()


def get_unread_notification_count(user_id):
    conn = db.freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM notifications WHERE user_id = %s AND recipient_role = 'freelancer' AND is_read = FALSE", (user_id,))
        row = cur.fetchone()
        return int(row[0] or 0)
    finally:
        conn.close()


def get_unread_notification_count_for_role(user_id, recipient_role="freelancer"):
    if not user_id:
        return 0

    recipient_role = normalize_recipient_role(recipient_role)
    if recipient_role is None:
        return 0

    conn = db.freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM notifications WHERE user_id = %s AND recipient_role = %s AND is_read = FALSE", (user_id, recipient_role))
        row = cur.fetchone()
        return int(row[0] or 0)
    finally:
        conn.close()


def mark_notification_as_read(notification_id):
    conn = db.freelancer_db()
    try:
        cur = db.get_dict_cursor(conn)
        cur.execute("""
            UPDATE notifications
            SET is_read = TRUE
            WHERE notification_id = %s
            RETURNING notification_id, user_id, recipient_role
        """, (notification_id,))
        row = cur.fetchone()
        conn.commit()
        return row
    finally:
        conn.close()


def mark_all_notifications_as_read(user_id, recipient_role="freelancer"):
    if not user_id:
        return 0

    recipient_role = normalize_recipient_role(recipient_role)
    if recipient_role is None:
        return 0

    conn = db.freelancer_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = %s AND recipient_role = %s AND is_read = FALSE",
            (user_id, recipient_role),
        )
        affected = cur.rowcount
        conn.commit()
        return affected
    finally:
        conn.close()


def get_client_notifications(client_id, limit=50):
    return get_notifications(client_id, recipient_role="client", limit=limit)


def get_freelancer_notifications(freelancer_id, limit=50):
    return get_notifications(freelancer_id, recipient_role="freelancer", limit=limit)
