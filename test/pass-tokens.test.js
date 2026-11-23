import { describe, expect, it } from 'vitest';
import { createProtectedPass, PASS_KEY_VERSION, revealProtectedPass } from '../src/modules/registration/pass-tokens.js';

const key = Buffer.from('a distinct QR encryption key for Pongal').subarray(0, 32).toString('base64');

describe('protected QR pass tokens', () => {
  it('encrypts tokens at rest and decrypts only with the configured key', () => {
    const pass = createProtectedPass(key);
    expect(pass.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pass.tokenHash).not.toContain(pass.token);
    expect(pass.encryptedToken).not.toContain(pass.token);
    expect(pass.keyVersion).toBe(PASS_KEY_VERSION);
    expect(revealProtectedPass(pass, key)).toBe(pass.token);
  });

  it('uses a fresh nonce and ciphertext for each pass', () => {
    const first = createProtectedPass(key);
    const second = createProtectedPass(key);
    expect(first.encryptionIv).not.toBe(second.encryptionIv);
    expect(first.encryptedToken).not.toBe(second.encryptedToken);
  });

  it('rejects altered ciphertext and an incorrect key', () => {
    const pass = createProtectedPass(key);
    expect(() => revealProtectedPass({ ...pass, encryptedToken: 'altered' }, key)).toThrow();
    expect(() => revealProtectedPass(pass, Buffer.alloc(32, 4).toString('base64'))).toThrow();
  });

  it('rejects non-32-byte keys', () => {
    expect(() => createProtectedPass(Buffer.alloc(16, 1).toString('base64'))).toThrow('exactly 32 bytes');
  });
});