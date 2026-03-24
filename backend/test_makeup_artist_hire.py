#!/usr/bin/env python3
"""
Test category-specific hiring with correct fields
"""
import requests
import json

BASE_URL = "http://127.0.0.1:5000"

def test_category_specific_hiring():
    print("🧪 Testing Category-Specific Hiring...")
    
    # Test 1: Singer (HOURLY pricing) - requires start_time and end_time
    print("\n--- Test 1: Singer Hire (HOURLY pricing) ---")
    singer_data = {
        "client_id": 1,
        "freelancer_id": 1,  # Singer
        "job_title": "Birthday Party Performance",
        "note": "Need singer for 2-hour birthday party",
        "contract_type": "HOURLY",
        "event_date": "2024-06-15",
        "start_time": "18:00",
        "end_time": "20:00",
        "venue_source": "custom",
        "event_address": "123 Party Hall, Mumbai",
        "event_city": "Mumbai",
        "event_pincode": "400001",
        "proposed_budget": 0  # Backend will calculate from hourly rate
    }
    
    try:
        res = requests.post(f"{BASE_URL}/client/hire", json=singer_data)
        result = res.json()
        print(f"Status: {res.status_code}")
        print(f"Response: {json.dumps(result, indent=2)}")
        
        if result.get("success"):
            print("✅ Singer hire with time slots successful")
        else:
            print(f"❌ Failed: {result.get('msg')}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # Test 2: Singer without time slots (should fail)
    print("\n--- Test 2: Singer WITHOUT time slots (should fail) ---")
    invalid_singer_data = {
        "client_id": 1,
        "freelancer_id": 1,
        "job_title": "Birthday Party Performance",
        "note": "Need singer for birthday party",
        "contract_type": "HOURLY",
        "event_date": "2024-06-15",
        "venue_source": "custom",
        "event_address": "123 Party Hall, Mumbai",
        "event_city": "Mumbai",
        "event_pincode": "400001",
        # Missing start_time and end_time
        "proposed_budget": 5000
    }
    
    try:
        res = requests.post(f"{BASE_URL}/client/hire", json=invalid_singer_data)
        result = res.json()
        print(f"Status: {res.status_code}")
        print(f"Response: {json.dumps(result, indent=2)}")
        
        if not result.get("success") and ("start_time" in result.get("msg", "") or "HOURLY contracts require" in result.get("msg", "")):
            print("✅ Correctly rejected missing time slots for hourly")
        else:
            print(f"❌ Should have failed with time slot error")
    except Exception as e:
        print(f"❌ Error: {e}")

def test_frontend_payload_simulation():
    print("\n🧪 Testing Frontend Payload Simulation...")
    
    # Simulate what our fixed frontend would send for a singer
    frontend_payload = {
        "client_id": 1,
        "freelancer_id": 1,
        "contract_type": "HOURLY",
        "event_date": "2024-06-15",
        "start_time": "18:00",
        "end_time": "20:00",
        "event_address": "123 Party Hall, Mumbai",
        "event_city": "Mumbai",
        "event_pincode": "400001",
        "venue_source": "custom",
        "note": "Birthday party performance",
    }
    
    try:
        res = requests.post(f"{BASE_URL}/client/hire", json=frontend_payload)
        result = res.json()
        print(f"Status: {res.status_code}")
        print(f"Response: {json.dumps(result, indent=2)}")
        
        if result.get("success"):
            print("✅ Frontend payload simulation successful")
        else:
            print(f"❌ Failed: {result.get('msg')}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_category_specific_hiring()
    test_frontend_payload_simulation()
