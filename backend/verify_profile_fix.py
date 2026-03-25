import requests

BASE_URL = "http://localhost:5000"

def test_profile_endpoint():
    print("--- Testing Consolidated Profile Endpoint ---")
    
    # Using freelancer ID 1 (Assuming it exists from previous tests)
    freelancer_id = 1
    resp = requests.get(f"{BASE_URL}/freelancer/profile/{freelancer_id}")
    
    print(f"Status Code: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print(f"Success: {data.get('success')}")
        print(f"Name: {data.get('name')}")
        print(f"Phone: {data.get('phone')}")
        print(f"Location: {data.get('location')}")
        print(f"Category: {data.get('category')}")
        print(f"Pricing Type: {data.get('pricing_type')}")
        print(f"Hourly Rate: {data.get('hourly_rate')}")
        print(f"Per Person Rate: {data.get('per_person_rate')}")
        print(f"Fixed Price: {data.get('fixed_price')}")
        
        # Check if legacy fields are still present
        print(f"Min Budget: {data.get('min_budget')}")
    else:
        print(f"Error: {resp.text}")

if __name__ == "__main__":
    try:
        test_profile_endpoint()
    except Exception as e:
        print(f"Test failed: {e}")
