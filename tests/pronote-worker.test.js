import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runPronoteWorker} from '../src/pronote.js';

const python = process.env.AGENDA_PRONOTE_PYTHON || '/home/ubuntu/apps/agenda-bridge-pronote-venv/bin/python';
const fakeSDK = String.raw`
from types import SimpleNamespace
class ClientBase:
    def post(self, name, *args, **kwargs):
        return {"dataSec":{"data":{"cle":"fixture-key","jetonConnexionAppliMobile":"rotated-fixture-token"}}}
    def export_credentials(self):
        return {"pronote_url":self.pronote_url,"username":"fixture-user","password":self.password,"uuid":self.uuid,"client_identifier":"fixture-device"}
class Client(ClientBase):
    def __init__(self, url, uuid):
        self.pronote_url=url
        self.uuid=uuid
        self.password="initial-fixture-token"
        if uuid=="attempt-cross-origin":
            import requests
            requests.Session().get("https://other.invalid/pronote/eleve.html")
        self.post("Authentification")
        self.logged_in=True
        self.info=SimpleNamespace(id="student",name="Fixture student",class_name="Classe fixture",establishment="School fixture")
        self.periods=[]
    @classmethod
    def qrcode_login(cls, qr, pin, uuid, **kwargs):
        return cls(qr["url"],uuid)
    @classmethod
    def token_login(cls, **kwargs):
        return cls(kwargs["pronote_url"],kwargs["uuid"])
    def homework(self,*args):
        return []
    def lessons(self,*args):
        return []
`;
async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-pronote-ipc-')), old = process.env.PYTHONPATH;
  fs.writeFileSync(path.join(dir, 'pronotepy.py'), fakeSDK); process.env.PYTHONPATH = dir;
  const payload = {mode: 'qr', qr: {url: 'https://demo.index-education.net/pronote/mobile.eleve.html', login: 'fixture', jeton: 'fixture'}, pin: '1234', uuid: 'fixture-app', today: '2026-11-02'};
  try {await run(payload);} finally {old === undefined ? delete process.env.PYTHONPATH : process.env.PYTHONPATH = old; fs.rmSync(dir, {recursive: true, force: true});}
}
test('worker waits for the parent to save each rotated token before continuing its read-only import', {skip: !fs.existsSync(python)}, async () => {
  await fixture(async payload => {
    const saved = [];
    const snapshot = await runPronoteWorker(payload, credentials => {saved.push(credentials.password);}, {python, timeout: 15000});
    assert.deepEqual(saved, ['rotated-fixture-token', 'rotated-fixture-token']);
    assert.equal(snapshot.identity.name, 'Fixture student'); assert.equal(snapshot.sections.grades.state, 'available');
    let attempts = 0;
    await assert.rejects(runPronoteWorker(payload, () => {attempts++; throw new Error('storage failed');}, {python, timeout: 15000}), /SOURCE_UNAVAILABLE/);
    assert.equal(attempts, 1);
  });
});
test('worker blocks a different host before the SDK can issue an outbound request', {skip: !fs.existsSync(python)}, async () => {
  await fixture(async payload => {let saved = 0; await assert.rejects(runPronoteWorker({...payload, uuid: 'attempt-cross-origin'}, () => {saved++;}, {python, timeout: 15000}), /SOURCE_UNAVAILABLE/); assert.equal(saved, 0);});
});
