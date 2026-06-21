import os
import json
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

DATA_DIR = "data"
CASES_FILE = os.path.join(DATA_DIR, "cases.json")

def get_gas_url():
    key = os.environ.get("GAS_URL")
    if key:
        return key
    key_file = os.path.join(DATA_DIR, "gas_url.txt")
    if os.path.exists(key_file):
        with open(key_file, "r") as f:
            return f.read().strip()
    return None

def fetch_jstage_article(keyword):
    # Encode keyword
    encoded_keyword = urllib.parse.quote(keyword)
    url = f"https://api.jstage.jst.go.jp/searchapi/do?service=3&pubyearfrom=2015&keyword={encoded_keyword}&count=3"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as response:
            xml_data = response.read()
            root = ET.fromstring(xml_data)
            ns = {'atom': 'http://www.w3.org/2005/Atom'}
            entries = root.findall('atom:entry', ns)
            
            for entry in entries:
                title_node = entry.find('atom:article_title/atom:ja', ns)
                if title_node is None:
                    title_node = entry.find('atom:article_title/atom:en', ns)
                
                link_node = entry.find('atom:link[@rel="alternate"]', ns)
                link_url = link_node.attrib.get('href') if link_node is not None else None
                
                if not link_url:
                    id_node = entry.find('atom:id', ns)
                    if id_node is not None and id_node.text and id_node.text.startswith("http"):
                        link_url = id_node.text
                
                if title_node is not None and title_node.text and link_url:
                    return {
                        "title": title_node.text.strip(),
                        "url": link_url
                    }
        return None
    except Exception as e:
        print(f"Error searching J-STAGE for '{keyword}':", e)
        return None

def main():
    if not os.path.exists(CASES_FILE):
        print(f"Error: {CASES_FILE} not found.")
        return
        
    with open(CASES_FILE, 'r', encoding='utf-8') as f:
        cases = json.load(f)
        
    print(f"Loaded {len(cases)} cases.")
    
    updated_count = 0
    for i, c in enumerate(cases):
        # sourceが未登録、またはタイトル/URLが空の場合のみ取得する
        if not c.get("source") or not c["source"].get("title") or not c["source"].get("url"):
            # 確定診断名 (title) または 疾患名 (diagnosis) で検索を試みる
            search_query = c.get("title") or c.get("diagnosis")
            # 括弧書きを削除してシンプルな検索ワードにする (例: "糖尿病性ケトアシドーシス (DKA)" -> "糖尿病性ケトアシドーシス")
            if " (" in search_query:
                search_query = search_query.split(" (")[0]
            elif "(" in search_query:
                search_query = search_query.split("(")[0]
                
            print(f"[{i+1}/{len(cases)}] Searching J-STAGE for '{search_query}'...")
            
            # APIを叩く
            source = fetch_jstage_article(search_query)
            
            # 見つからなかった場合のフォールバック (一般的な疾患名で再検索)
            if not source and c.get("diagnosis"):
                diag_query = c["diagnosis"]
                if "疑い" in diag_query:
                    diag_query = diag_query.replace("疑い", "")
                print(f"  Fallback search for '{diag_query}'...")
                source = fetch_jstage_article(diag_query)
                
            if source:
                c["source"] = source
                print(f"  -> Found: {source['title']} ({source['url']})")
                updated_count += 1
            else:
                # どうしても見つからない場合の超安全フォールバック (J-STAGEの総合検索URL)
                c["source"] = {
                    "title": f"{search_query}に関するJ-STAGE学術論文検索",
                    "url": f"https://www.jstage.jst.go.jp/result/-char/ja?globalSearchKey={urllib.parse.quote(search_query)}"
                }
                print(f"  -> No exact match. Fallback to J-STAGE Search URL.")
                updated_count += 1
                
            # J-STAGE APIへの優しさのためのスリープ
            time.sleep(0.5)
            
    # 更新されたファイルを保存
    with open(CASES_FILE, 'w', encoding='utf-8') as f:
        json.dump(cases, f, indent=2, ensure_ascii=False)
        
    print(f"Update complete! {updated_count} cases updated with sources.")
    
    # GASへ同期
    gas_url = get_gas_url()
    if gas_url:
        print("Syncing updated cases to Google Sheet...")
        try:
            sync_data = {
                "action": "sync_cases",
                "cases": cases
            }
            req = urllib.request.Request(
                gas_url,
                data=json.dumps(sync_data).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req) as response:
                res = json.loads(response.read().decode('utf-8'))
                if res.get('status') == 'success':
                    print(f"Successfully synced {res.get('count')} cases to Google Sheet.")
                else:
                    print("GAS Sync Error:", res.get('message'))
        except Exception as e:
            print("Failed to sync cases to GAS:", e)

if __name__ == "__main__":
    main()
