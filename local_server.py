import http.server
import socketserver
import json
import os
from urllib.parse import urlparse, parse_qs

PORT = 8000
DIRECTORY = "public"
DATA_DIR = "data"

# Dummy GAS State
OTPS = {}  # email -> code
VERIFIED_SESSIONS = set()  # emails that completed verification

class LocalRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query_params = parse_qs(parsed_url.query)
        
        # Helper to get single parameter
        def get_param(name):
            val = query_params.get(name)
            return val[0] if val else None

        if path == '/api/gas':
            action = get_param('action')
            name = get_param('name')
            if name:
                name = name.strip()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            if action == 'login':
                if not name:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Name parameter required'}).encode('utf-8'))
                    return
                
                users_db_path = 'users_db.json'
                user_record = None
                if os.path.exists(users_db_path):
                    try:
                        with open(users_db_path, 'r', encoding='utf-8') as f:
                            db = json.load(f)
                        if name in db:
                            user_record = db[name]
                    except Exception as e:
                        print(f"[Mock GAS] Error reading user DB: {e}")
                
                if user_record:
                    res = {
                        'status': 'success',
                        'name': user_record.get('name', name),
                        'high_score': user_record.get('high_score', 0),
                        'completed_cases': user_record.get('completed_cases', []),
                        'last_played': user_record.get('last_played', '')
                    }
                    self.wfile.write(json.dumps(res).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({'status': 'not_found', 'message': 'User not found'}).encode('utf-8'))
                    
            elif action == 'get_stats':
                stats_path = os.path.join(DATA_DIR, 'stats.json')
                stats = {}
                if os.path.exists(stats_path):
                    try:
                        with open(stats_path, 'r', encoding='utf-8') as f:
                            stats = json.load(f)
                    except Exception as e:
                        print(f"[Mock GAS] Error reading stats: {e}")
                self.wfile.write(json.dumps(stats).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({'status': 'error', 'message': 'Invalid action'}).encode('utf-8'))

        elif path == '/api/cases' or path == '/data/cases.json':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            cases_path = os.path.join(DATA_DIR, 'cases.json')
            if os.path.exists(cases_path):
                with open(cases_path, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(json.dumps([]).encode('utf-8'))
        elif path == '/api/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            stats_path = os.path.join(DATA_DIR, 'stats.json')
            if os.path.exists(stats_path):
                with open(stats_path, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(json.dumps({}).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        
        if path == '/api/gas':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                params = json.loads(post_data.decode('utf-8'))
                action = params.get('action')
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                if action == 'sync_cases':
                    cases = params.get('cases', [])
                    self.wfile.write(json.dumps({'status': 'success', 'count': len(cases)}).encode('utf-8'))
                    return
                
                if action == 'stats':
                    case_id = params.get('case_id')
                    tried = int(params.get('tried', 0))
                    correct = int(params.get('correct', 0))
                    
                    stats_path = os.path.join(DATA_DIR, 'stats.json')
                    current_stats = {}
                    if os.path.exists(stats_path):
                        with open(stats_path, 'r', encoding='utf-8') as f:
                            current_stats = json.load(f)
                    
                    if case_id:
                        if case_id not in current_stats:
                            current_stats[case_id] = {"tried": 0, "correct": 0}
                        current_stats[case_id]["tried"] += tried
                        current_stats[case_id]["correct"] += correct
                        
                        with open(stats_path, 'w', encoding='utf-8') as f:
                            json.dump(current_stats, f, indent=2, ensure_ascii=False)
                    
                    self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
                    return
                
                # Username based registration/save
                name = params.get('name')
                if not name:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Name parameter required'}).encode('utf-8'))
                    return
                
                high_score = int(params.get('high_score', 0))
                completed_cases = params.get('completed_cases', [])
                last_played = params.get('last_played', '')
                
                users_db_path = 'users_db.json'
                db = {}
                if os.path.exists(users_db_path):
                    try:
                        with open(users_db_path, 'r', encoding='utf-8') as f:
                            db = json.load(f)
                    except Exception as e:
                        print(f"[Mock GAS] Error reading user DB: {e}")
                
                final_name = name.strip()
                db[final_name] = {
                    'name': final_name,
                    'high_score': high_score,
                    'completed_cases': completed_cases,
                    'last_played': last_played
                }
                
                with open(users_db_path, 'w', encoding='utf-8') as f:
                    json.dump(db, f, indent=2, ensure_ascii=False)
                
                self.wfile.write(json.dumps({'status': 'success', 'name': final_name}).encode('utf-8'))
            except Exception as e:
                self.send_error_json(str(e))
                
        elif path == '/api/save_config':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                gas_url = data.get('gas_url', '')
                
                config_js_content = f'const CONFIG = {{\n  gasUrl: "{gas_url}"\n}};\n'
                os.makedirs(DIRECTORY, exist_ok=True)
                with open(os.path.join(DIRECTORY, 'config.js'), 'w', encoding='utf-8') as f:
                    f.write(config_js_content)
                
                with open('gas_config.json', 'w', encoding='utf-8') as f:
                    json.dump({'gas_url': gas_url}, f, indent=2, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {'status': 'success', 'message': 'Config saved and synced successfully'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
            except Exception as e:
                self.send_error_json(str(e))
        elif self.path == '/api/stats':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                os.makedirs(DATA_DIR, exist_ok=True)
                stats_path = os.path.join(DATA_DIR, 'stats.json')
                
                current_stats = {}
                if os.path.exists(stats_path):
                    with open(stats_path, 'r', encoding='utf-8') as f:
                        current_stats = json.load(f)
                
                case_id = data.get('case_id')
                if case_id:
                    if case_id not in current_stats:
                        current_stats[case_id] = {"tried": 0, "correct": 0}
                    current_stats[case_id]["tried"] += data.get("tried", 0)
                    current_stats[case_id]["correct"] += data.get("correct", 0)
                    
                    with open(stats_path, 'w', encoding='utf-8') as f:
                        json.dump(current_stats, f, indent=2, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
            except Exception as e:
                self.send_error_json(str(e))
        else:
            self.send_response(404)
            self.end_headers()

    def send_error_json(self, message):
        self.send_response(500)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'error', 'message': message}).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def main():
    print(f"Starting server on port {PORT} serving directory '{DIRECTORY}'...")
    handler = LocalRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"Local server running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")

if __name__ == "__main__":
    main()
