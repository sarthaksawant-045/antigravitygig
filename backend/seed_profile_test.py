import psycopg2
from postgres_config import get_postgres_connection

def seed_test_data():
    print("--- Seeding Test Data for Freelancer ID 1 ---")
    conn = get_postgres_connection()
    cur = conn.cursor()
    
    # Update freelancer_profile for ID 1
    cur.execute("""
        UPDATE freelancer_profile 
        SET phone = '9876543210',
            location = 'Mumbai, Maharashtra',
            category = 'Photographer',
            min_budget = 5000,
            fixed_price = 7500,
            per_person_rate = 500,
            hourly_rate = 1200,
            pricing_type = 'fixed'
        WHERE freelancer_id = 1
    """)
    
    conn.commit()
    conn.close()
    print("Done seeding test data.")

if __name__ == "__main__":
    try:
        seed_test_data()
    except Exception as e:
        print(f"Seeding failed: {e}")
