import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '../src/core/csrf.js';

const config = { APP_BASE_URL: 'http://localhost:3134', NODE_ENV: 'development', PORT: 3134 };

describe('same-origin request checks', () => {
  it('accepts a sandboxed same-origin form post with a null Origin and matching host', () => {
    expect(isSameOrigin({
      protocol: 'http',
      headers: { origin: 'null', 'sec-fetch-site': 'same-origin', host: 'localhost:3134' },
    }, config)).toBe(true);
  });

  it('rejects null-Origin requests from a foreign host or cross-site context', () => {
    expect(isSameOrigin({
      protocol: 'http',
      headers: { origin: 'null', 'sec-fetch-site': 'same-origin', host: 'attacker.example' },
    }, config)).toBe(false);
    expect(isSameOrigin({
      protocol: 'http',
      headers: { origin: 'null', 'sec-fetch-site': 'cross-site', host: 'localhost:3134' },
    }, config)).toBe(false);
  });

  it('continues to require an allowed origin when the browser supplies one', () => {
    expect(isSameOrigin({ headers: { origin: 'http://localhost:3134' } }, config)).toBe(true);
    expect(isSameOrigin({ headers: { origin: 'https://attacker.example' } }, config)).toBe(false);
  });
});