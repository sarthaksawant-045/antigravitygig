import requests
import json

url = "http://localhost:5000/admin/login"
payload = {"email": "admin@gigbridge.com", "password": "admin123"}
headers = {"Content-Type": "application/json"}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
