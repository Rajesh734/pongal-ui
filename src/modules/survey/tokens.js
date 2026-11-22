import { createHmac, randomBytes } from 'node:crypto';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url-encoded (43 characters). */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/** Hex HMAC-SHA256 of the token keyed by EDIT_TOKEN_KEY; only this is stored. */
export function hashToken(key, token) {
  return createHmac('sha256', key).update(token).digest('hex');
}

export function isWellFormedToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}
