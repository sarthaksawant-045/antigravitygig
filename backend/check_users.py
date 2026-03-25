#!/usr/bin/env python3
"""
Check existing users in database
"""
import psycopg2
from postgres_config import get_postgres_connection

def check_users():
    try:
        conn = get_postgres_connection()
        cur = conn.cursor()
        
        print("🔍 CHECKING DATABASE USERS")
        print("=" * 40)
        
        # Check clients
        print("\n👥 CLIENTS:")
        cur.execute("SELECT id, name, email FROM client ORDER BY id LIMIT 5")
        clients = cur.fetchall()
        for client in clients:
            print(f"  ID: {client[0]}, Name: {client[1]}, Email: {client[2]}")
        
        # Check freelancers
        print("\n👨‍💼 FREELANCERS:")
        cur.execute("SELECT id, name, email FROM freelancer ORDER BY id LIMIT 5")
        freelancers = cur.fetchall()
        for freelancer in freelancers:
            print(f"  ID: {freelancer[0]}, Name: {freelancer[1]}, Email: {freelancer[2]}")
        
        # Check existing messages
        print("\n💬 EXISTING MESSAGES:")
        cur.execute("SELECT COUNT(*) FROM message")
        message_count = cur.fetchone()[0]
        print(f"  Total messages: {message_count}")
        
        if message_count > 0:
            cur.execute("""
                SELECT sender_role, sender_id, receiver_id, text, timestamp 
                FROM message 
                ORDER BY timestamp DESC 
                LIMIT 3
            """)
            recent_messages = cur.fetchall()
            for msg in recent_messages:
                print(f"  {msg[0]} {msg[1]} → {msg[2]}: {msg[3][:50]}")
        
        conn.close()
        print("\n✅ USER CHECK COMPLETE")
        
    except Exception as e:
        print(f"❌ ERROR: {e}")

if __name__ == "__main__":
    check_users()
