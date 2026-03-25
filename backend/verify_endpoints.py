import requests
import time

BASE_URL = "http://localhost:5000"

def test_messaging_flow():
    print("--- Testing Messaging Flow ---")
    
    # 1. Create a conversation (Client 1 <-> Freelancer 1)
    # Assuming IDs 1 and 1 exist (or any valid IDs)
    conv_data = {
        "sender_id": 1,
        "receiver_id": 1,
        "sender_role": "client"
    }
    resp = requests.post(f"{BASE_URL}/conversations", json=conv_data)
    print(f"Create Conversation: {resp.status_code} - {resp.json()}")
    if resp.status_code != 200: return
    
    conv_id = resp.json().get("conversation_id")
    
    # 2. Send a message
    msg_data = {
        "conversation_id": conv_id,
        "sender_id": 1,
        "sender_role": "client",
        "message": "Hello from the verification script!"
    }
    resp = requests.post(f"{BASE_URL}/messages", json=msg_data)
    print(f"Send Message: {resp.status_code} - {resp.json()}")
    
    # 3. Get conversations for Client 1
    resp = requests.get(f"{BASE_URL}/conversations/1?role=client")
    print(f"Get Conversations (Client): {resp.status_code} - {len(resp.json())} threads found")
    
    # 4. Get conversations for Freelancer 1
    resp = requests.get(f"{BASE_URL}/conversations/1?role=freelancer")
    print(f"Get Conversations (Freelancer): {resp.status_code} - {len(resp.json())} threads found")
    
    # 5. Check message history (using existing endpoint if still valid, or check DB)
    resp = requests.get(f"{BASE_URL}/message/history?client_id=1&freelancer_id=1")
    print(f"Get Message History: {resp.status_code} - {len(resp.json().get('messages', []))} messages")

if __name__ == "__main__":
    try:
        test_messaging_flow()
    except Exception as e:
        print(f"Test failed: {e}")
