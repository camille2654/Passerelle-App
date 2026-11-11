"""Private, read-only PRONOTE adapter. JSON in on stdin, NDJSON out on stdout.

Credentials are never passed in arguments, files, tracebacks or application logs.
The parent saves each rotated mobile token before subsequent network reads.
"""
import datetime as dt
import json
import logging
import os
import re
import sys
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

_session_spec=spec_from_file_location("passerelle_pronote_session",Path(__file__).with_name("pronote-session.py"))
_session=module_from_spec(_session_spec)
_session_spec.loader.exec_module(_session)

logging.disable(logging.CRITICAL)
phase='startup'


def emit(kind, **values):
    print(json.dumps({"kind": kind, **values}, ensure_ascii=False), flush=True)
    if kind == "credentials":
        acknowledgement = json.loads(sys.stdin.readline(256))
        if acknowledgement.get("ack") != "credentials":
            raise ValueError("CREDENTIAL_SAVE_FAILED")


def text(value, limit=4000):
    return str(value or "")[:limit]


def date(value):
    return value.isoformat() if value else None


def instant(value):
    if not value:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo("Europe/Paris"))
    return value.astimezone(dt.timezone.utc).isoformat()


def section(read):
    try:
        return {"state": "available", "data": read()}
    except Exception as error:
        return {"state": "unavailable" if type(error).__name__ == "UnsupportedOperation" else "error", "code": "UNSUPPORTED" if type(error).__name__ == "UnsupportedOperation" else "SOURCE_UNAVAILABLE"}


def main(payload):
    global phase
    phase='bootstrap'
    import requests
    import pronotepy

    raw_url = payload.get("ent", {}).get("url") or payload.get("credentials", {}).get("pronote_url")
    expected = urlsplit(raw_url)
    if expected.scheme != "https" or expected.username or expected.password or expected.port or not expected.hostname or not re.fullmatch(r"[a-z0-9-]+\.index-education\.net", expected.hostname) or not re.fullmatch(r"/pronote/(?:mobile\.)?eleve\.html", expected.path) or expected.fragment:
        raise ValueError("INVALID_URL")
    bootstrap = payload.get("ent") if payload.get("mode") == "ent" else None
    if bootstrap and (len(bootstrap.get("html", "").encode()) > 1024 * 1024 or len(bootstrap.get("cookies", [])) > 200):
        raise ValueError("INVALID_ENT")
    initial_html = bootstrap.get("html") if bootstrap else None
    initial_attributes=_session.bootstrap_attributes(bootstrap.get("attributes")) if bootstrap and bootstrap.get("attributes") is not None else None
    credentials=dict(payload.get("credentials") or {})
    if payload.get("mode")=="token":
        credentials["pronote_url"]=_session.mobile_url(expected)
    cookies=bootstrap.get("cookies",[]) if bootstrap else credentials.pop("pronote_cookies",[])
    jar=_session.load_cookies(requests,cookies,expected.hostname)
    def exported(client):
        saved=client.export_credentials()
        saved["pronote_cookies"]=_session.export_cookies(jar,expected.hostname)
        if bootstrap:
            saved["pronote_url"]=_session.mobile_url(expected)
        return saved
    original_request = requests.Session.request

    def guarded_request(session, method, url, **kwargs):
        nonlocal initial_html
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != expected.netloc or not parsed.path.startswith("/pronote/") or parsed.username or parsed.password:
            raise ValueError("INVALID_URL")
        if initial_html is not None and method.upper() == "GET" and parsed.path == expected.path:
            response = requests.Response()
            response.status_code = 200
            response.url = url
            response._content = initial_html.encode("utf-8")
            response.encoding = "utf-8"
            initial_html = None
            return response
        merged=jar.copy()
        requests.cookies.merge_cookies(merged,kwargs.get("cookies") or {})
        kwargs["cookies"]=merged
        kwargs["allow_redirects"] = False
        kwargs["timeout"] = (12, 20)
        # Preserve inherited proxies and trust the machine's CA bundle.
        if not os.environ.get("REQUESTS_CA_BUNDLE") and os.path.exists("/etc/ssl/certs/ca-certificates.crt"):
            kwargs["verify"] = "/etc/ssl/certs/ca-certificates.crt"
        kwargs["stream"] = True
        response = original_request(session, method, url, **kwargs)
        if response.is_redirect:
            response.close()
            raise ValueError("ENT_AUTH_REQUIRED")
        requests.cookies.merge_cookies(jar,response.cookies)
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 8 * 1024 * 1024:
                response.close()
                raise ValueError("RESPONSE_TOO_LARGE")
            chunks.append(chunk)
        response._content = b"".join(chunks)
        response._content_consumed = True
        return response

    requests.Session.request = guarded_request
    # Preserve the data literal already captured before the browser consumed it.
    # A parsed JSON bootstrap also handles current head-script PRONOTE pages.
    from pronotepy.pronoteAPI import _Communication
    original_parse=_Communication._parse_html
    def parse_html(communication,html):
        if initial_attributes is not None and bootstrap and html==bootstrap.get("html"):
            return dict(initial_attributes)
        match=re.search(r"\bStart\s*\(\s*(?=\{)",html)
        if match:
            try:
                values,_=json.JSONDecoder().raw_decode(html[match.end():])
                if isinstance(values,dict) and "h" in values and "a" in values:
                    return values
            except (ValueError,TypeError):
                pass
        return original_parse(communication,html)
    _Communication._parse_html=parse_html
    original_post = pronotepy.ClientBase.post

    def saving_post(client, name, *args, **kwargs):
        if bootstrap and name == "Identification" and client.ent:
            client.username = client.attributes.get("e", "")
        result = original_post(client, name, *args, **kwargs)
        if name == "Authentification":
            data = result.get("dataSec", {}).get("data", {})
            token = data.get("jetonConnexionAppliMobile")
            if token and data.get("cle"):
                client.password = token
                saved = exported(client)
                if bootstrap:
                    saved["pronote_url"] = _session.mobile_url(expected)
                emit("credentials", credentials=saved)
        return result

    pronotepy.ClientBase.post = saving_post
    options = {"device_name": "Passerelle", "account_pin": payload.get("accountPin") or None}
    if payload["mode"] == "ent":
        phase="ent-auth"
        client = pronotepy.Client(raw_url, "ENT", "ENT", ent=lambda *_args, **_kwargs: jar,
                                  mode="qr_code", uuid=payload["uuid"], **options)
    elif payload["mode"] == "token":
        phase="token-auth"
        client = pronotepy.Client.token_login(**credentials, **options)
    else:
        raise ValueError("INVALID_MODE")
    if not client.logged_in:
        emit("error", code="AUTH_EXPIRED",stage=phase)
        return
    saved = exported(client)
    if bootstrap:
        if saved["password"] == "ENT" or not saved["username"]:
            raise ValueError("MOBILE_TOKEN_UNAVAILABLE")
        saved["pronote_url"] = _session.mobile_url(expected)
    emit("credentials", credentials=saved)
    if bootstrap:
        # Verify that the exported mobile token can really reconnect before
        # reporting success. This also rotates and saves it through saving_post.
        phase="mobile-verify"
        client = pronotepy.Client.token_login(**{key:value for key,value in saved.items() if key!="pronote_cookies"}, **options)
        if not client.logged_in:
            emit("error", code="AUTH_EXPIRED",stage=phase)
            return
        emit("credentials", credentials=exported(client))
    phase="read-data"
    identity = {"id": text(client.info.id, 100), "name": text(client.info.name, 200), "className": text(client.info.class_name, 120), "school": text(client.info.establishment, 200)}
    periods = list(client.periods)[:12]
    calendar = [{"id": text(p.id, 100), "label": text(p.name, 150), "start": date(p.start), "end": date(p.end)} for p in periods]

    def grades():
        output = []
        for period in periods:
            averages = section(lambda: [{"subject": text(a.subject.name, 120), "mark": text(a.student, 30), "scale": text(a.out_of, 30), "classAverage": text(a.class_average, 30)} for a in period.averages])
            rows = [{"id": text(g.id, 100), "subject": text(g.subject.name, 120), "mark": text(g.grade, 30), "scale": text(g.out_of, 30), "date": date(g.date), "title": text(g.comment or "Évaluation", 500), "coefficient": text(g.coefficient, 30), "classAverage": text(g.average, 30)} for g in period.grades][:2000]
            output.append({"period": text(period.id, 100), "grades": rows, "averages": averages.get("data", [])})
        return output

    def reports():
        output = []
        for period in periods:
            report = period.report
            if report is not None:
                output.append({"period": text(period.id, 100), "label": text(period.name, 150), "comments": [text(c) for c in report.comments][:30], "subjects": [{"name": text(s.name, 120), "mark": text(s.student_average, 30), "classAverage": text(s.class_average, 30), "coefficient": text(s.coefficient, 30), "comments": [text(c) for c in s.comments][:20], "teachers": [text(t, 200) for t in s.teachers][:10]} for s in report.subjects][:100]})
        return output

    def attendance():
        output = {}
        for period in periods:
            for absence in period.absences:
                item = {"id": text(absence.id, 100), "start": instant(absence.from_date), "end": instant(absence.to_date), "justified": bool(absence.justified), "type": "ABSENCE", "reasons": [text(r, 500) for r in absence.reasons][:10]}
                output["absence:" + item["id"]] = item
            for delay in period.delays:
                item = {"id": text(delay.id, 100), "start": instant(delay.date), "end": instant(delay.date), "justified": bool(delay.justified), "type": "DELAY", "reasons": [text(r, 500) for r in delay.reasons][:10], "minutes": text(delay.minutes, 30)}
                output["delay:" + item["id"]] = item
        return list(output.values())[:2000]

    today = dt.date.fromisoformat(payload["today"])
    year = today.year if today.month >= 9 else today.year - 1
    academic = payload.get("window", {})
    start = dt.date.fromisoformat(academic.get("start", f"{year}-09-01"))
    end = dt.date.fromisoformat(academic.get("end", f"{year+1}-08-31"))

    def homework():
        rows = list(client.homework(start, end))
        if len(rows) > 4000:
            raise ValueError("INCOMPLETE_HOMEWORK")
        return [{"id": text(w.id, 100), "subject": text(w.subject.name, 120), "details": text(w.description, 8000), "date": date(w.date), "done": bool(w.done)} for w in rows]

    def lessons():
        rows = list(client.lessons(start, end + dt.timedelta(days=1)))
        if len(rows) > 8000:
            raise ValueError("INCOMPLETE_COURSES")
        selected = {}
        for lesson in rows:
            if not start <= lesson.start.date() <= end:
                continue
            key = (lesson.id, lesson.start)
            if key not in selected or lesson.num > selected[key].num:
                selected[key] = lesson
        return [{"id": text(l.id, 100), "subject": text(l.subject.name if l.subject else "Cours", 120), "start": instant(l.start), "end": instant(l.end), "location": text(l.classroom, 200), "cancelled": bool(l.canceled), "memo": text(l.memo), "teachers": [text(t, 200) for t in (l.teacher_names or [])][:10], "test": bool(l.test)} for l in selected.values()]

    snapshot = {"identity": identity, "periods": calendar, "window": {"start": start.isoformat(), "end": end.isoformat()}, "sections": {}}
    for key, read in [("grades", grades), ("reports", reports), ("attendance", attendance), ("homework", homework), ("courses", lessons)]:
        snapshot["sections"][key] = section(read)
    emit("credentials",credentials=exported(client))
    emit("snapshot", snapshot=snapshot)


if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.readline(2 * 1024 * 1024))
        main(payload)
    except Exception as error:
        name = type(error).__name__
        message=str(error)
        code = "ENT_AUTH_REQUIRED" if message=="ENT_AUTH_REQUIRED" else "MFA_REQUIRED" if name == "MFAError" else ("AUTH_EXPIRED" if "payload" in locals() and payload.get("mode") == "token" else "ENT_AUTH_REQUIRED") if name in ("QRCodeDecryptError", "CryptoError") else "UNSUPPORTED" if name == "UnsupportedOperation" else "SOURCE_UNAVAILABLE"
        emit("error", code=code,stage=phase)
