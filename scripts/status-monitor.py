#!/usr/bin/env python3
"""Public, independent minute-by-minute observations of the local status API."""
import argparse
import json
import math
import os
from pathlib import Path
import signal
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

INTERVAL = 60
RETENTION_MS = 24 * 60 * 60 * 1000
MAX_SAMPLES = 2880
MAX_BYTES = 2 * 1024 * 1024
COMPONENTS = ('portal', 'ent', 'calendars', 'mail', 'push', 'managed')
STATES = {'operational', 'degraded', 'paused', 'disabled', 'unknown', 'unavailable'}
OVERALL = {'operational', 'degraded', 'unknown', 'maintenance', 'unavailable'}


def number(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def sanitize_sample(row):
    if not isinstance(row, dict) or not number(row.get('at')) or row['at'] <= 0 or row.get('state') not in OVERALL:
        return None
    latency = row.get('responseMs')
    if latency is not None and (not number(latency) or latency < 0 or latency > 10000):
        return None
    components = row.get('components')
    if not isinstance(components, dict) or any(components.get(key) not in STATES for key in COMPONENTS):
        return None
    return {'at': int(row['at']), 'responseMs': round(latency, 2) if latency is not None else None,
            'state': row['state'], 'components': {key: components[key] for key in COMPONENTS}}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(url, clock=lambda: int(time.time() * 1000)):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', '::1'} or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.endswith('/api/system-status'):
        raise ValueError('The status monitor only probes the local anonymous status API.')
    started = time.perf_counter()
    # The probe is loopback-only and carries no environment proxy, cookie or API key.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers={'Accept': 'application/json'}), timeout=5) as response:
            raw = response.read(65537)
            if response.status != 200 or len(raw) > 65536:
                raise ValueError('Invalid status response')
        latency = (time.perf_counter() - started) * 1000
        data = json.loads(raw)
        now = clock()
        valid = isinstance(data, dict) and data.get('schemaVersion') == 1 and data.get('state') in OVERALL and number(data.get('checkedAt')) and abs(now-data['checkedAt']) <= 120000
        rows = data.get('components') if isinstance(data, dict) else None
        if not valid or not isinstance(rows, list) or len(rows) != len(COMPONENTS):
            raise ValueError('Invalid status snapshot')
        components = {}
        for row in rows:
            if not isinstance(row, dict) or row.get('id') not in COMPONENTS or row['id'] in components or row.get('state') not in STATES:
                raise ValueError('Invalid component')
            components[row['id']] = row['state']
        return sanitize_sample({'at': now, 'responseMs': min(latency, 10000), 'state': data['state'], 'components': components})
    except (urllib.error.URLError, OSError, TimeoutError):
        return {'at': clock(), 'responseMs': None, 'state': 'unavailable',
                'components': {key: 'unavailable' if key == 'portal' else 'unknown' for key in COMPONENTS}}
    except (ValueError, TypeError, KeyError):
        return {'at': clock(), 'responseMs': None, 'state': 'unknown', 'components': {key: 'unknown' for key in COMPONENTS}}


class History:
    def __init__(self, path, now):
        self.path = Path(path)
        self.started_at = now
        self.samples = []
        try:
            if self.path.stat().st_size > MAX_BYTES:
                return
            data = json.loads(self.path.read_text())
            if not isinstance(data, dict) or data.get('schemaVersion') != 1 or not isinstance(data.get('samples'), list):
                return
            if number(data.get('startedAt')) and 0 < data['startedAt'] <= now:
                self.started_at = int(data['startedAt'])
            rows = [sanitize_sample(row) for row in data['samples'][-MAX_SAMPLES:]]
            self.samples = sorted({row['at']: row for row in rows if row and now-RETENTION_MS <= row['at'] <= now}.values(), key=lambda row: row['at'])
        except (OSError, ValueError, TypeError):
            pass

    def append(self, sample):
        row = sanitize_sample(sample)
        if row is None:
            raise ValueError('Invalid public measurement')
        now = row['at']
        self.started_at = min(self.started_at, now)
        rows = {item['at']: item for item in self.samples if now-RETENTION_MS <= item['at'] <= now}
        rows[now] = row
        self.samples = sorted(rows.values(), key=lambda item: item['at'])[-MAX_SAMPLES:]
        payload = {'schemaVersion': 1, 'intervalSeconds': INTERVAL, 'retentionHours': 24,
                   'startedAt': self.started_at, 'generatedAt': now, 'samples': self.samples}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        name = None
        try:
            with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=self.path.parent, prefix='.status-history-', delete=False) as file:
                name = file.name
                json.dump(payload, file, ensure_ascii=False, separators=(',', ':'))
                file.flush()
                os.fsync(file.fileno())
                os.fchmod(file.fileno(), 0o644)
            os.replace(name, self.path)
        finally:
            if name and os.path.exists(name):
                os.unlink(name)
        return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8020/agenda/api/system-status')
    parser.add_argument('--history', required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    stopped = threading.Event()
    for event in (signal.SIGTERM, signal.SIGINT):
        signal.signal(event, lambda *_: stopped.set())
    history = History(args.history, int(time.time()*1000))
    while not stopped.is_set():
        started = time.monotonic()
        history.append(probe(args.url))
        if args.once:
            break
        stopped.wait(max(1, INTERVAL-(time.monotonic()-started)))


if __name__ == '__main__':
    main()
