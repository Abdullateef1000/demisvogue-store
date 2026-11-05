const crypto = require('node:crypto');

const sessionLifetimeMs = 8 * 60 * 60 * 1000;

function createAdminSession(secret, now = Date.now()) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const payload = {
    csrfToken,
    expiresAt: now + sessionLifetimeMs
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return { token: `${encodedPayload}.${signature}`, csrfToken };
}

function verifyAdminSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
  let provided;
  try {
    provided = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (
      typeof payload.csrfToken !== 'string'
      || payload.csrfToken.length < 32
      || !Number.isSafeInteger(payload.expiresAt)
      || payload.expiresAt <= now
      || payload.expiresAt > now + sessionLifetimeMs
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

module.exports = { createAdminSession, verifyAdminSession };
