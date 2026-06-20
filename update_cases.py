import os
import json
import random
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import sys

DATA_DIR = "data"
CASES_FILE = os.path.join(DATA_DIR, "cases.json")
STATS_FILE = os.path.join(DATA_DIR, "stats.json")

def get_gas_url():
    key = os.environ.get("GAS_URL")
    if key:
        return key
    key_file = os.path.join(DATA_DIR, "gas_url.txt")
    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            return f.read().strip()
    return None

def get_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    key_file = os.path.join(DATA_DIR, "gemini_key.txt")
    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            return f.read().strip()
    return None

def fetch_jstage_abstracts(count=5):
    url = f"https://api.jstage.jst.go.jp/searchapi/do?service=3&pubyearfrom=2021&pubyearto=2026&keyword=%E7%97%87%E4%BE%8B&text=%E5%86%85%E7%A7%91&count=20"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)
            ns = {'atom': 'http://www.w3.org/2005/Atom'}
            entries = root.findall('atom:entry', ns)
            abstracts = []
            for entry in entries:
                title_node = entry.find('atom:article_title/atom:ja', ns)
                if title_node is None:
                    title_node = entry.find('atom:article_title/atom:en', ns)
                
                if title_node is not None and title_node.text:
                    abstracts.append(title_node.text)
            
            if len(abstracts) > count:
                return random.sample(abstracts, count)
            return abstracts
    except Exception as e:
        print("Error fetching J-STAGE:", e)
        return []

def call_gemini(prompt, api_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json"
        }
    }
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as response:
            res_json = json.loads(response.read().decode('utf-8'))
            text = res_json['candidates'][0]['content']['parts'][0]['text']
            return json.loads(text)
    except Exception as e:
        print("Gemini API Error:", e)
        return []

def main():
    api_key = get_api_key()
    if not api_key:
        print("Error: GEMINI_API_KEY is not set.")
        print("Please set the GEMINI_API_KEY environment variable or save it to data/gemini_key.txt")
        sys.exit(1)
        
    gas_url = get_gas_url()
    
    cases = []
    if os.path.exists(CASES_FILE):
        with open(CASES_FILE, 'r', encoding='utf-8') as f:
            cases = json.load(f)
            
    stats = {}
    if gas_url:
        try:
            req = urllib.request.Request(f"{gas_url}?action=get_stats")
            with urllib.request.urlopen(req) as response:
                stats = json.loads(response.read().decode('utf-8'))
        except Exception as e:
            print("Error fetching stats from GAS:", e)
    elif os.path.exists(STATS_FILE):
        with open(STATS_FILE, 'r', encoding='utf-8') as f:
            stats = json.load(f)

    print(f"Current cases: {len(cases)}")
    
    if len(cases) >= 250:
        case_rates = []
        for c in cases:
            cid = c.get('id')
            st = stats.get(cid, {'tried': 0, 'correct': 0})
            rate = st['correct'] / st['tried'] if st['tried'] > 0 else 0.5
            case_rates.append((rate, st['tried'], c))
        
        # Delete top 5 (highest correct rate)
        case_rates.sort(key=lambda x: (x[0], x[1]), reverse=True)
        top_5_ids = [x[2]['id'] for x in case_rates[:5]]
        cases = [c for c in cases if c['id'] not in top_5_ids]
        print(f"Deleted top 5 cases (high correct rate): {top_5_ids}")
        
        # Brush up bottom 5
        case_rates.sort(key=lambda x: (x[0], x[1]))
        bottom_5 = [x[2] for x in case_rates[:5]]
        
        brush_up_prompt = "あなたは医学教育の専門家です。以下の5つの症例はプレイヤーの正答率が低かったものです。問題の難易度を適切に調整（初期臨床研修医レベルへ）し、より教育的で分かりやすいフィードバックを追加した形で、同じJSONフォーマットのまま出力してください。\n" + json.dumps(bottom_5, ensure_ascii=False)
        print("Brushing up bottom 5 cases...")
        brushed_cases = call_gemini(brush_up_prompt, api_key)
        if brushed_cases:
            bottom_5_ids = [c['id'] for c in bottom_5]
            cases = [c for c in cases if c['id'] not in bottom_5_ids]
            cases.extend(brushed_cases)
            print("Brushed up 5 cases.")
            
    abstracts = fetch_jstage_abstracts(5)
    if abstracts:
        print(f"Generating 5 new cases based on {len(abstracts)} J-STAGE abstracts...")
        prompt = """あなたはベテラン指導医です。以下のJ-STAGEの症例報告タイトルをヒントに、初期臨床研修医〜医師国家試験レベルの内科・小児科の当直シミュレーションゲーム用の症例JSONを5つ作成してください。産婦人科は除外してください。
        
【ルール】
1. 配列形式で5つのJSONオブジェクトを出力してください。
2. JSONキー: id (ユニークな英数字), title (疾患名), complaint (主訴), patient (患者情報), diagnosis (確定診断名), status (warning/danger), vitals (hr, bp_sys, bp_dia, spo2), description (状況説明), steps (配列。q, optsの配列を含む。optsはid, text, ok(真偽値), critical(真偽値), fb(フィードバック)を含む)。
3. タイトルや主訴から疾患名が最初からバレないようにしてください。
4. 解答(steps)は通常2〜3ステップ程度で構成してください。

【J-STAGE情報】
""" + "\n".join(abstracts)
        
        new_cases = call_gemini(prompt, api_key)
        if new_cases:
            cases.extend(new_cases)
            print(f"Generated and added {len(new_cases)} new cases.")
    
    with open(CASES_FILE, 'w', encoding='utf-8') as f:
        json.dump(cases, f, indent=2, ensure_ascii=False)
    print(f"Update complete. Total cases now: {len(cases)}")

if __name__ == "__main__":
    main()
