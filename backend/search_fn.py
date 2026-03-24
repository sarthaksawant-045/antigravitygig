import re
with open('d:/gigbridge/backend/database.py', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if 'def get_freelancer_profile' in line:
            print(f"Found on line {i}: {line.strip()}")
