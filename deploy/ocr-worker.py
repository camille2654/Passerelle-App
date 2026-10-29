#!/usr/bin/python3
"""Private OCR socket worker. No access to Passerelle accounts or its storage."""
import http.server
import json
import os
import resource
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS = 16000000

MAX_IMAGE = 8 * 1024 * 1024

class Server(http.server.HTTPServer):
    address_family = socket.AF_UNIX

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'Passerelle-OCR'
    def log_message(self, *args):
        pass
    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, {'ready': self.path == '/health'})
    def do_POST(self):
        if self.path != '/recognize':
            self.reply(404, {'error': 'NOT_FOUND'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > MAX_IMAGE:
                self.reply(413, {'error': 'IMAGE_TOO_LARGE'})
                return
            self.connection.settimeout(15)
            image = self.rfile.read(size)
            if len(image) != size:
                self.reply(400, {'error': 'IMAGE_INCOMPLETE'})
                return
            with tempfile.TemporaryDirectory(prefix='passerelle-photo-') as directory:
                path = Path(directory) / 'input.img'
                path.write_bytes(image)
                path.chmod(0o600)
                with Image.open(path) as image:
                    if image.width * image.height > 16000000:
                        self.reply(413, {'error': 'IMAGE_TOO_LARGE'})
                        return
                    normalized = ImageOps.exif_transpose(image).convert('RGB')
                    normalized.thumbnail((2400, 2400))
                    normalized.save(path, format='PNG')
                    normalized.close()
                def limits():
                    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024,) * 2)
                    resource.setrlimit(resource.RLIMIT_CPU, (18, 20))
                    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024,) * 2)
                result = subprocess.run(['/usr/bin/tesseract', str(path), 'stdout', '-l', 'fra+eng', '--psm', '3'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=22, check=True, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'OMP_THREAD_LIMIT': '1'}, preexec_fn=limits)
                text = result.stdout.decode('utf-8', errors='replace').strip()
            self.reply(200, {'text': text[:8000], 'truncated': len(text) > 8000})
        except subprocess.TimeoutExpired:
            self.reply(504, {'error': 'OCR_TIMEOUT'})
        except (subprocess.SubprocessError, ValueError, OSError, Image.DecompressionBombError):
            self.reply(422, {'error': 'OCR_FAILED'})

if __name__ == '__main__':
    os.umask(0o077)
    if os.environ.get('LISTEN_FDS') == '1' and int(os.environ.get('LISTEN_PID', '0')) == os.getpid():
        server = Server('/run/passerelle-ocr.sock', Handler, bind_and_activate=False)
        server.socket.close()
        server.socket = socket.socket(fileno=3)
        server.server_name, server.server_port = 'local', 0
    elif len(sys.argv) == 3 and sys.argv[1] == '--socket':
        server = Server(sys.argv[2], Handler)
        os.chmod(sys.argv[2], 0o600)
    else:
        raise SystemExit('Start with systemd socket activation.')
    server.serve_forever(poll_interval=0.5)
