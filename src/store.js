import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';

export const random = () => randomBytes(32).toString('base64url');
export const digest = text => createHash('sha256').update(text).digest('hex');
export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const keyPath = path.join(dir, 'master.key');
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('Invalid encryption key');
    this.file = path.join(dir, 'state.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { users: [], sessions: [], invites: [], settings: {} };
    this.save();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  seal(data) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  open(data) {
    const b = Buffer.from(data, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    cipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString('utf8'));
  }
  user(id) { return this.state.users.find(u => u.id === id); }
  update(id, values) { const u = this.user(id); if (!u) throw new Error('Unknown user'); Object.assign(u, values); this.save(); return u; }
  prune() {
    const now = Date.now();
    for (const key of ['sessions', 'invites']) this.state[key] = this.state[key].filter(s => s.expires > now);
    if (this.state.friendInvites) this.state.friendInvites = this.state.friendInvites.filter(s => s.expires > now);
    this.save();
  }
}
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password, saved) {
  const [salt, hex] = saved.split(':');
  const hash = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return expected.length === hash.length && timingSafeEqual(hash, expected);
}
