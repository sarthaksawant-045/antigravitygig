import psycopg2
import os
import sys

# Add backend to path
sys.path.append(r"d:\gigbridge\antigravitygig\backend")

try:
    from postgres_config import freelancer_db
    conn = freelancer_db()
    cur = conn.cursor()
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'hire_request'")
    rows = cur.fetchall()
    print("COLUMNS IN hire_request:")
    for r in rows:
        print(f"- {r[0]}")
    conn.close()
except Exception as e:
    print(f"Error checking schema: {e}")
