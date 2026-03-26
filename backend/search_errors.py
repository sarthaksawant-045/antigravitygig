import re
import os

target_file = 'app.py'
pattern = r'Server error occurred|500'

if os.path.exists(target_file):
    with open(target_file, 'r', encoding='utf-8', errors='ignore') as f:
        for i, line in enumerate(f):
            if re.search(pattern, line):
                print(f"{i+1}: {line.strip()}")
else:
    print(f"File {target_file} not found")
