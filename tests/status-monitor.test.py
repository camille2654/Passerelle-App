import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location('status_monitor', Path(__file__).resolve().parents[1]/'scripts/status-monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
NOW = 1793966400000


def sample(at=NOW, state='operational'):
    return {'at': at, 'responseMs': 2.5 if state != 'unavailable' else None, 'state': state,
            'components': {key: 'operational' if state == 'operational' else 'unknown' for key in monitor.COMPONENTS}}


class StatusMonitorTests(unittest.TestCase):
    def test_private_fields_are_removed_and_file_is_atomic_public_data(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'history.json'
            history = monitor.History(target, NOW)
            row = sample()
            row.update({'email': 'private@example.invalid', 'token': 'secret-token'})
            row['components']['other-private-key'] = 'secret'
            payload = history.append(row)
            self.assertEqual(payload['samples'], [sample()])
            self.assertNotIn('private', target.read_text())
            self.assertNotIn('secret', target.read_text())
            self.assertEqual(os.stat(target).st_mode & 0o777, 0o644)
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_history_survives_restart_without_filling_missing_minutes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'history.json'
            monitor.History(target, NOW).append(sample())
            history = monitor.History(target, NOW+600000)
            payload = history.append(sample(NOW+600000, 'unavailable'))
            self.assertEqual(len(payload['samples']), 2)
            self.assertEqual(payload['startedAt'], NOW)
            self.assertIsNone(payload['samples'][-1]['responseMs'])
            self.assertEqual(payload['samples'][-1]['at']-payload['samples'][0]['at'], 600000)

    def test_retention_future_points_invalid_rows_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'history.json'
            rows = [sample(NOW-monitor.RETENTION_MS-1), sample(NOW+1), sample(NOW-1000), sample(NOW-1000), {'email': 'private@example.invalid'}]
            target.write_text(json.dumps({'schemaVersion': 1, 'startedAt': NOW-2000, 'samples': rows}))
            history = monitor.History(target, NOW)
            self.assertEqual(len(history.samples), 1)
            result = history.append(sample())
            self.assertEqual([row['at'] for row in result['samples']], [NOW-1000, NOW])

    def test_invalid_or_oversized_history_does_not_become_measurements(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'history.json'
            for value in ['broken', json.dumps({'users': [{'token': 'private'}]}), 'x'*(monitor.MAX_BYTES+1)]:
                target.write_text(value)
                history = monitor.History(target, NOW)
                self.assertEqual(history.samples, [])
                self.assertEqual(len(history.append(sample())['samples']), 1)

    def test_http_probe_is_cookie_free_and_sanitizes_api_response(self):
        seen = []
        parent = self
        class Handler(BaseHTTPRequestHandler):
            mode = 'healthy'
            def do_GET(self):
                seen.append(dict(self.headers))
                data = {'schemaVersion': 1, 'state': 'operational', 'checkedAt': NOW,
                        'components': [{'id': key, 'state': 'operational', 'email': 'private@example.invalid'} for key in monitor.COMPONENTS],
                        'token': 'never-publish-me'}
                if self.mode == 'stale':
                    data['checkedAt'] = NOW-120001
                body = b'not json' if self.mode == 'invalid' else json.dumps(data).encode()
                self.send_response(503 if self.mode == 'offline' else 200)
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = 'http://127.0.0.1:'+str(server.server_port)+'/agenda/api/system-status'
        try:
            healthy = monitor.probe(url, clock=lambda: NOW)
            self.assertEqual(healthy['state'], 'operational')
            self.assertGreaterEqual(healthy['responseMs'], 0)
            self.assertNotIn('private', json.dumps(healthy))
            self.assertNotIn('never-publish-me', json.dumps(healthy))
            for mode, expected in [('offline', 'unavailable'), ('invalid', 'unknown'), ('stale', 'unknown')]:
                Handler.mode = mode
                row = monitor.probe(url, clock=lambda: NOW)
                self.assertEqual(row['state'], expected)
                self.assertIsNone(row['responseMs'])
            self.assertTrue(all('Cookie' not in headers and 'Authorization' not in headers for headers in seen))
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
        self.assertEqual(monitor.probe(url, clock=lambda: NOW)['state'], 'unavailable')

    def test_probe_rejects_remote_urls(self):
        for url in ['https://example.invalid/api/system-status', 'http://127.0.0.1:8020/agenda/api/system-status?token=secret', 'http://user:secret@127.0.0.1/api/system-status']:
            with self.assertRaises(ValueError):
                monitor.probe(url)


if __name__ == '__main__':
    unittest.main()
