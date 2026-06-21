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
            email = get_param('email')
            if email:
                email = email.lower().strip()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            if action == 'send_otp':
                if not email:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Email parameter required'}).encode('utf-8'))
                    return
                # Generate mock code
                code = "123456"
                OTPS[email] = code
                print(f"[Mock GAS] Generated OTP for {email}: {code}")
                
                # Mimic behavior of Code.gs
                res = {'status': 'success'}
                # Always send test_code in mock for ease of testing
                res['test_code'] = code
                self.wfile.write(json.dumps(res).encode('utf-8'))
                
            elif action == 'verify_otp':
                code = get_param('code')
                if not email or not code:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Email and Code parameters required'}).encode('utf-8'))
                    return
                
                saved_code = OTPS.get(email)
                if saved_code == code:
                    VERIFIED_SESSIONS.add(email)
                    
                    # Read from users_db.json
                    user_record = {'email': email, 'name': '匿名医師', 'high_score': 0, 'completed_cases': [], 'last_played': '', 'status': 'not_registered'}
                    users_db_path = 'users_db.json'
                    if os.path.exists(users_db_path):
                        try:
                            with open(users_db_path, 'r', encoding='utf-8') as f:
                                db = json.load(f)
                            if email in db:
                                user_record = db[email]
                                user_record['status'] = 'success'
                                # If name is anonymous or empty, mark as not_registered
                                if not user_record.get('name') or user_record.get('name') == '匿名医師':
                                    user_record['status'] = 'not_registered'
                        except Exception as e:
                            print(f"[Mock GAS] Error reading user DB: {e}")
                    
                    self.wfile.write(json.dumps(user_record).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({'status': 'error', 'message': '認証コードが正しくないか、有効期限が切れています。'}).encode('utf-8'))
                    
            elif action == 'silent_check':
                if not email:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Email parameter required'}).encode('utf-8'))
                    return
                
                # In mock server, let's treat it as authenticated if email is in VERIFIED_SESSIONS
                if email in VERIFIED_SESSIONS:
                    user_record = {'email': email, 'name': '匿名医師', 'high_score': 0, 'completed_cases': [], 'last_played': '', 'status': 'success'}
                    users_db_path = 'users_db.json'
                    if os.path.exists(users_db_path):
                        try:
                            with open(users_db_path, 'r', encoding='utf-8') as f:
                                db = json.load(f)
                            if email in db:
                                user_record = db[email]
                                user_record['status'] = 'success'
                                if not user_record.get('name') or user_record.get('name') == '匿名医師':
                                    user_record['status'] = 'not_registered'
                        except Exception as e:
                            print(f"[Mock GAS] Error reading user DB: {e}")
                    self.wfile.write(json.dumps(user_record).encode('utf-8'))
                else:
                    self.wfile.write(json.dumps({'status': 'unauthenticated'}).encode('utf-8'))
                    
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
                email = params.get('email')
                if email:
                    email = email.lower().strip()
                
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
                
                # Check verification state in mock
                if email not in VERIFIED_SESSIONS:
                    self.wfile.write(json.dumps({'status': 'error', 'message': 'Authentication required.'}).encode('utf-8'))
                    return
                
                # Score saving / registration logic
                name = params.get('name')
                high_score = int(params.get('high_score', 0))
                completed_cases = params.get('completed_cases', [])
                last_played = params.get('last_played', '')
                
                users_db_path = 'users_db.json'
                db = {}
                if os.path.exists(users_db_path):
                    with open(users_db_path, 'r', encoding='utf-8') as f:
                        db = json.load(f)
                
                final_name = name.strip() if name else "匿名医師"
                if email in db:
                    existing_name = db[email].get('name', '').strip()
                    if existing_name and existing_name not in ["匿名医師", "テスト専攻医"] and final_name:
                        final_name = existing_name
                
                db[email] = {
                    'email': email,
                    'name': final_name,
                    'high_score': high_score,
                    'completed_cases': completed_cases,
                    'last_played': last_played
                }
                
                with open(users_db_path, 'w', encoding='utf-8') as f:
                    json.dump(db, f, indent=2, ensure_ascii=False)
                
                self.wfile.write(json.dumps({'status': 'success', 'email': email, 'name': final_name}).encode('utf-8'))
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
