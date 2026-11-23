import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const PASS_KEY_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('pongal-entry-pass:v1', 'utf8');

function parseKey(encodedKey) {
  if (typeof encodedKey !== 'string') throw new TypeError('QR pass encryption key must be a base64 string.');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey.trim()) {
    throw new TypeError('QR pass encryption key must be canonical base64 for exactly 32 bytes.');
  }
  return key;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createProtectedPass(encodedKey) {
  const key = parseKey(encodedKey);
  const token = randomBytes(32).toString('base64url');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);

  return {
    token,
    tokenHash: hashToken(token),
    encryptedToken: ciphertext.toString('base64url'),
    encryptionIv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    keyVersion: PASS_KEY_VERSION,
  };
}

export function revealProtectedPass(pass, encodedKey) {
  if (pass.keyVersion !== PASS_KEY_VERSION) throw new Error(`Unsupported QR pass key version '${pass.keyVersion}'.`);
  const decipher = createDecipheriv(ALGORITHM, parseKey(encodedKey), Buffer.from(pass.encryptionIv, 'base64url'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(pass.authTag, 'base64url'));
  const token = Buffer.concat([
    decipher.update(Buffer.from(pass.encryptedToken, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  if (hashToken(token) !== pass.tokenHash) throw new Error('QR pass integrity check failed.');
  return token;
}