from database import freelancer_db
import time

try:
    conn = freelancer_db()
    cur = conn.cursor()
    cur.execute("SELECT token FROM admin_session ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    if row:
        print(f"TOKEN:{row[0]}")
    else:
        print("No token found")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
