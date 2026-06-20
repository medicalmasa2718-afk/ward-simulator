import re
import json
import os

with open('public/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'const CLINICAL_CASES = (\[[\s\S]*?\]);\n\nconst BASE_BEDS', content)
if match:
    cases_str = match.group(1)
    
    # Very basic regex to quote unquoted keys
    cases_str = re.sub(r'(\s)([a-zA-Z0-9_]+):', r'\1"\2":', cases_str)
    # Also replace single quotes with double quotes if any (though looking at app.js they might be double)
    cases_str = cases_str.replace("'", '"')
    
    # Remove comments
    cases_str = re.sub(r'//.*', '', cases_str)
    
    # Fix trailing commas if any
    cases_str = re.sub(r',\s*([\]}])', r'\1', cases_str)
    
    try:
        cases = json.loads(cases_str)
        os.makedirs('data', exist_ok=True)
        with open('data/cases.json', 'w', encoding='utf-8') as out:
            json.dump(cases, out, indent=2, ensure_ascii=False)
        print(f"Extracted {len(cases)} cases.")
        
        new_content = content.replace(match.group(0), 'let CLINICAL_CASES = [];\n\nconst BASE_BEDS')
        with open('public/app.js', 'w', encoding='utf-8') as f_out:
            f_out.write(new_content)
        print("Updated app.js")
    except Exception as e:
        print("JSON parse error:", e)
else:
    print("No match")
