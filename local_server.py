import http.server
import socketserver
import json
import os

PORT = 8000
DIRECTORY = "public"
DATA_DIR = "data"

class LocalRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == '/api/cases' or self.path == '/data/cases.json':
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
        elif self.path == '/api/stats':
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
        if self.path == '/api/save_config':
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
