import time
from postgres_config import get_postgres_connection, get_dict_cursor

def _parse_bool(value):
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")

def fetch_filtered_freelancers(top_rated=None, category=None, subscribed=None, verified_only=None):
    conn = get_postgres_connection()
    cur = get_dict_cursor(conn)
    sql = """
        SELECT
            f.id,
            f.name,
            COALESCE(fp.title, '') AS title,
            COALESCE(fp.skills, '') AS skills,
            COALESCE(fp.experience, 0) AS experience,
            COALESCE(fp.min_budget, 0) AS min_budget,
            COALESCE(fp.max_budget, 0) AS max_budget,
            COALESCE(fp.rating, 0) AS rating,
            COALESCE(fp.category, '') AS category,
            COALESCE(fp.bio, '') AS bio,
            COALESCE(fp.is_verified, 0) AS is_verified,
            COALESCE(fs.plan_name, 'BASIC') AS plan_name,
            COALESCE(fs.status, 'ACTIVE') AS sub_status,
            COALESCE(fs.end_date, NULL) AS sub_end
        FROM freelancer f
        LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
        LEFT JOIN freelancer_subscription fs ON fs.freelancer_id = fp.freelancer_id
        WHERE 1=1
    """
    params = []
    if category:
        sql += " AND LOWER(fp.category) = LOWER(%s)"
        params.append(str(category).strip())
    if _parse_bool(verified_only):
        sql += " AND COALESCE(fp.is_verified,0) = 1"
    if _parse_bool(subscribed):
        now = int(time.time())
        sql += " AND COALESCE(fs.plan_name,'BASIC') IN ('PREMIUM','PRO') AND COALESCE(fs.status,'ACTIVE')='ACTIVE' AND (fs.end_date IS NULL OR fs.end_date > %s)"
        params.append(now)
    if _parse_bool(top_rated):
        sql += " ORDER BY rating DESC, f.id DESC"
    else:
        sql += " ORDER BY f.id DESC"
    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()
    out = []
    for r in rows:
        out.append({
            "freelancer_id": r.get("id"),
            "name": r["name"],
            "title": r["title"],
            "skills": r["skills"],
            "experience": r["experience"],
            "budget_range": f"{r['min_budget']} - {r['max_budget']}",
            "rating": r["rating"],
            "category": r["category"],
            "bio": r["bio"],
            "is_verified": r["is_verified"] == 1,
            "subscription_plan": "PREMIUM" if (r["plan_name"] in ("PREMIUM","PRO")) else "BASIC"
        })
    return out


def _fetch_valid_premium_freelancers(limit):
    """Premium fetch used by recommendation logic."""
    conn = get_postgres_connection()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                f.id AS freelancer_id,
                f.name,
                COALESCE(fp.title, '') AS title,
                COALESCE(fp.skills, '') AS skills,
                COALESCE(fp.rating, 0) AS rating,
                COALESCE(fp.category, '') AS category,
                COALESCE(fp.bio, '') AS bio,
                TRUE AS is_premium
            FROM freelancer f
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE f.is_premium IS TRUE
              AND f.premium_valid_until > CURRENT_TIMESTAMP
            ORDER BY COALESCE(fp.rating, 0) DESC, f.id DESC
            LIMIT %s
        """, (int(limit),))
        return cur.fetchall() or []
    finally:
        conn.close()


def _fetch_standard_freelancers(limit):
    """Standard user fetch used by recommendation logic."""
    conn = get_postgres_connection()
    try:
        cur = get_dict_cursor(conn)
        cur.execute("""
            SELECT
                f.id AS freelancer_id,
                f.name,
                COALESCE(fp.title, '') AS title,
                COALESCE(fp.skills, '') AS skills,
                COALESCE(fp.rating, 0) AS rating,
                COALESCE(fp.category, '') AS category,
                COALESCE(fp.bio, '') AS bio,
                FALSE AS is_premium
            FROM freelancer f
            LEFT JOIN freelancer_profile fp ON fp.freelancer_id = f.id
            WHERE COALESCE(f.is_premium, FALSE) IS FALSE
               OR f.premium_valid_until IS NULL
               OR f.premium_valid_until <= CURRENT_TIMESTAMP
            ORDER BY COALESCE(fp.rating, 0) DESC, f.id DESC
            LIMIT %s
        """, (int(limit),))
        return cur.fetchall() or []
    finally:
        conn.close()


def get_recommended_freelancers(limit=10):
    """
    Return freelancers with premium users spaced at positions 3, 6, and 9
    whenever enough valid premium users exist.
    """
    try:
        limit = max(1, int(limit))
    except Exception:
        limit = 10

    premium_positions = [idx for idx in (2, 5, 8) if idx < limit]
    premium_needed = len(premium_positions)
    premium_users = list(_fetch_valid_premium_freelancers(max(premium_needed, 3)))
    standard_users = list(_fetch_standard_freelancers(limit))

    recommended = []
    premium_index = 0
    standard_index = 0

    for position in range(limit):
        use_premium = position in premium_positions and premium_index < len(premium_users)

        if use_premium:
            recommended.append(premium_users[premium_index])
            premium_index += 1
            continue

        if standard_index < len(standard_users):
            recommended.append(standard_users[standard_index])
            standard_index += 1
            continue

        if premium_index < len(premium_users):
            recommended.append(premium_users[premium_index])
            premium_index += 1
            continue

        break

    return recommended
