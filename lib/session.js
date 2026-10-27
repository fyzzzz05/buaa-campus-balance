const crypto = require('node:crypto');

const COOKIE = 'campus_session';
const MAX_AGE = 12 * 60 * 60;
const AUTO_MAX_AGE = 30 * 24 * 60 * 60;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is not configured');
  return crypto.createHash('sha256').update(secret).digest();
}

function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const age=payload.autoLogin === true ? AUTO_MAX_AGE : MAX_AGE;
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + age * 1000 }));
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function unseal(token) {
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29 || raw.length > 9000) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const result = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]));
    return result.exp > Date.now() && typeof result.user === 'string' && /^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$/.test(result.user) && (!process.env.ALLOWED_USER_ID || result.user === process.env.ALLOWED_USER_ID) ? result : null;
  } catch { return null; }
}

function read(req) {
  const parts = Object.fromEntries((req.headers.cookie || '').split(';').map(item => {
    const at = item.indexOf('=');
    return at < 0 ? ['', ''] : [item.slice(0, at).trim(), item.slice(at + 1).trim()];
  }));
  const count = Number(parts[COOKIE + '_count']);
  if (!Number.isInteger(count) || count < 1 || count > 3) return null;
  let value = '';
  for (let i = 0; i < count; i++) {
    if (!parts[COOKIE + '_' + i]) return null;
    value += parts[COOKIE + '_' + i];
  }
  return unseal(value);
}

function write(res, payload) {
  const token = seal(payload), chunks = token.match(/.{1,3000}/g) || [];
  if (chunks.length > 3) throw new Error('Authenticated session exceeds cookie limit');
  const age=payload.autoLogin === true ? AUTO_MAX_AGE : MAX_AGE;
  const flags = 'Path=/; HttpOnly; SameSite=Lax' + (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '');
  res.setHeader('Set-Cookie', [
    `${COOKIE}_count=${chunks.length}; ${flags}; Max-Age=${age}`,
    ...Array.from({ length: 3 }, (_, i) => `${COOKIE}_${i}=${chunks[i] || ''}; ${flags}; Max-Age=${chunks[i] ? age : 0}`),
  ]);
}

function clear(res) {
  const flags = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '');
  res.setHeader('Set-Cookie', [`${COOKIE}_count=; ${flags}`, ...Array.from({length:3}, (_, i) => `${COOKIE}_${i}=; ${flags}`)]);
}

module.exports = { seal, unseal, read, write, clear };
