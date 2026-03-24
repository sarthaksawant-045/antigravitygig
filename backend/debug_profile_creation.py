#!/usr/bin/env python3
"""
Debug profile creation to see what's missing
"""
import requests
import json

BASE_URL = "http://127.0.0.1:5000"

def test_profile_creation():
    print("🧪 Testing Profile Creation with Exact Payload...")
    
    # Simulate what the frontend should be sending for a Dancer
    payload = {
        "freelancer_id": 1,
        "title": "Professional Dancer",
        "skills": "Hip Hop, Contemporary, Ballet",
        "experience_years": 5,
        "bio": "Professional dancer with 5 years of experience",
        "category": "Dancer",
        "location": "Mumbai",
        "dob": "2000-02-02",
        "pincode": "400001",
        "pricing_type": "HOURLY",
        "hourly_rate": 200,
        "overtime_rate_per_hour": 300
    }
    
    print("Payload being sent:")
    print(json.dumps(payload, indent=2))
    
    try:
        res = requests.post(f"{BASE_URL}/freelancer/profile", json=payload)
        result = res.json()
        print(f"\nStatus: {res.status_code}")
        print(f"Response: {json.dumps(result, indent=2)}")
        
        if result.get("success"):
            print("✅ Profile creation successful")
        else:
            print(f"❌ Failed: {result.get('msg')}")
            print("\n🔍 Checking required fields...")
            
            # Check what fields might be missing
            required_fields = [
                "freelancer_id", "title", "skills", "experience_years", 
                "bio", "category", "location", "dob"
            ]
            
            missing_fields = []
            for field in required_fields:
                if field not in payload or payload[field] == "" or payload[field] is None:
                    missing_fields.append(field)
            
            if missing_fields:
                print(f"Missing from payload: {missing_fields}")
            
            # Check pricing requirements
            if payload.get("category") == "Dancer":
                if not payload.get("hourly_rate") or payload.get("hourly_rate") <= 0:
                    print("❌ Dancer category requires hourly_rate > 0")
                    
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_profile_creation()
