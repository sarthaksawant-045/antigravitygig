#!/usr/bin/env python3
"""
Test script for real-time messaging system
"""
import requests
import json
import time

BASE_URL = "http://localhost:5000"

def test_api_endpoint(endpoint, method="GET", data=None):
    """Test an API endpoint"""
    url = f"{BASE_URL}{endpoint}"
    
    try:
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, json=data)
        else:
            print(f"Unsupported method: {method}")
            return None
            
        print(f"\n=== {method} {endpoint} ===")
        print(f"Status Code: {response.status_code}")
        
        try:
            result = response.json()
            print(f"Response: {json.dumps(result, indent=2)}")
            return result
        except:
            print(f"Response: {response.text}")
            return response.text
            
    except Exception as e:
        print(f"Error testing {endpoint}: {e}")
        return None

def main():
    print("🚀 Testing GigBridge Real-time Messaging System")
    print("=" * 50)
    
    # Test 1: Client message threads
    print("\n📱 Testing Client Message Threads...")
    client_threads = test_api_endpoint("/client/messages/threads?client_id=1")
    
    # Test 2: Freelancer message threads  
    print("\n👨‍💼 Testing Freelancer Message Threads...")
    freelancer_threads = test_api_endpoint("/freelancer/messages/threads?freelancer_id=1")
    
    # Test 3: Message history
    print("\n💬 Testing Message History...")
    message_history = test_api_endpoint("/message/history?client_id=1&freelancer_id=1")
    
    # Test 4: Send message from client to freelancer
    print("\n📤 Testing Client Message Send...")
    send_result = test_api_endpoint("/client/message/send", "POST", {
        "client_id": 1,
        "freelancer_id": 1, 
        "text": "Hello from client! This is a test message."
    })
    
    # Test 5: Send message from freelancer to client
    print("\n📤 Testing Freelancer Message Send...")
    send_result2 = test_api_endpoint("/freelancer/message/send", "POST", {
        "freelancer_id": 1,
        "client_id": 1,
        "text": "Hello from freelancer! This is a test reply."
    })
    
    # Test 6: Check message history again
    print("\n💬 Testing Message History After Sending...")
    message_history2 = test_api_endpoint("/message/history?client_id=1&freelancer_id=1")
    
    print("\n✅ Testing Complete!")
    print("=" * 50)
    
    # Summary
    print("\n📊 SUMMARY:")
    print(f"• Client threads: {'✅ Working' if client_threads else '❌ Failed'}")
    print(f"• Freelancer threads: {'✅ Working' if freelancer_threads else '❌ Failed'}")
    print(f"• Message history: {'✅ Working' if message_history else '❌ Failed'}")
    print(f"• Client send: {'✅ Working' if send_result else '❌ Failed'}")
    print(f"• Freelancer send: {'✅ Working' if send_result2 else '❌ Failed'}")
    print(f"• Updated history: {'✅ Working' if message_history2 else '❌ Failed'}")

if __name__ == "__main__":
    main()
