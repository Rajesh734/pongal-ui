import { afterEach, describe, expect, it } from 'vitest';
import { verifyTurnstile } from '../src/core/abuse.js';
import { captureStream, validForm } from './helpers.js';
import { surveyApp, TOKEN_PATH } from './survey-app.js';

const TURNSTILE = { TURNSTILE_SITE_KEY: 'site-key-123', TURNSTILE_SECRET: 'secret-xyz' };
const ROBOT = 'We couldn&#39;t confirm you&#39;re not a robot. Please try again.';

let ctx;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function cloudflare(success, { status = 200, codes = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(init.body), signal: init.signal });
    return { ok: status < 300, status, json: async () => ({ success, 'error-codes': codes }) };
  };
  return { calls, fetchImpl };
}

describe('Turnstile', () => {
  it('Verification passes', async () => {
    const cf = cloudflare(true);
    ctx = await surveyApp({ config: TURNSTILE, fetchImpl: cf.fetchImpl });
    const page = await ctx.app.inject('/s/pongal-2027');
    expect(page.body).toContain('<div class="cf-turnstile" data-sitekey="site-key-123">');
    expect(page.body).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');

    const res = await ctx.submit({ 'cf-turnstile-response': 'good-token' }, { 'cf-connecting-ip': '203.0.113.7' });
    expect(res.statusCode).toBe(303);
    expect(await ctx.count('survey_responses')).toBe(1);
    expect(cf.calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(cf.calls[0].body).toEqual({ secret: 'secret-xyz', response: 'good-token', remoteip: '203.0.113.7' });
    expect(cf.calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('Verification fails', async () => {
    const cf = cloudflare(false);
    ctx = await surveyApp({ config: TURNSTILE, fetchImpl: cf.fetchImpl });
    for (const overrides of [{}, { 'cf-turnstile-response': 'rejected-token' }]) {
      const res = await ctx.submit({ ...overrides, name: 'Kept Name' });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(ROBOT);
      expect(res.body).toContain('value="Kept Name"');
    }
    expect(cf.calls).toHaveLength(1); // a missing token is rejected without asking Cloudflare
    expect(await ctx.count('survey_responses')).toBe(0);
  });

  it('Cloudflare unreachable', async () => {
    const fetchImpl = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const logs = captureStream();
    ctx = await surveyApp({ config: TURNSTILE, fetchImpl, logStream: logs.stream, logLevel: 'info' });
    const res = await ctx.submit({ 'cf-turnstile-response': 'any' }, { 'cf-connecting-ip': '203.0.113.7' });
    expect(res.body).toContain('We couldn&#39;t reach our spam check. Please try again in a minute.');
    expect(await ctx.count('survey_responses')).toBe(0);
    expect(logs.lines().find((l) => l.msg === 'Turnstile verification unreachable')).toMatchObject({ level: 40, error: 'TimeoutError' });
  });

  it('Cloudflare unreachable (HTTP 5xx)', async () => {
    const logs = captureStream();
    ctx = await surveyApp({ config: TURNSTILE, fetchImpl: cloudflare(false, { status: 503 }).fetchImpl, logStream: logs.stream, logLevel: 'info' });
    const res = await ctx.submit({ 'cf-turnstile-response': 'any' });
    expect(res.body).toContain('We couldn&#39;t reach our spam check. Please try again in a minute.');
    expect(logs.lines().find((l) => l.msg === 'Turnstile verification unreachable')).toMatchObject({ status: 503 });
  });

  it('Rejected secret key', async () => {
    const logs = captureStream();
    const cf = cloudflare(false, { status: 400, codes: ['invalid-input-secret'] });
    ctx = await surveyApp({ config: TURNSTILE, fetchImpl: cf.fetchImpl, logStream: logs.stream, logLevel: 'info' });
    const res = await ctx.submit({ 'cf-turnstile-response': 'token-abc', name: 'Kept Name' }, { 'cf-connecting-ip': '203.0.113.7' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Our spam check isn&#39;t set up correctly. Please contact the organizers.');
    expect(res.body).toContain('value="Kept Name"');
    expect(await ctx.count('survey_responses')).toBe(0);
    const line = logs.lines().find((l) => l.level === 50);
    expect(line.msg).toBe('Turnstile rejected the secret key (invalid-input-secret) - check TURNSTILE_SECRET and TURNSTILE_SITE_KEY');
    for (const secret of ['secret-xyz', 'token-abc', '203.0.113.7']) expect(logs.text()).not.toContain(secret);
  });

  it('treats any 4xx without codes as misconfigured', async () => {
    const result = await verifyTurnstile({ secret: 's', token: 't', fetchImpl: cloudflare(false, { status: 401 }).fetchImpl });
    expect(result).toEqual({ outcome: 'misconfigured', status: 401, codes: [] });
  });

  it('times out a slow verification request', async () => {
    const hanging = (url, init) =>
      new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const result = await verifyTurnstile({ secret: 's', token: 't', ip: '1.2.3.4', fetchImpl: hanging, timeoutMs: 50 });
    expect(result).toEqual({ outcome: 'unreachable', error: 'TimeoutError' });
  });

  it('Test site key', async () => {
    const logs = captureStream();
    ctx = await surveyApp({ config: { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET: 'real-secret' }, logStream: logs.stream, logLevel: 'info' });
    expect(logs.lines().filter((l) => l.level === 40).map((l) => l.msg)).toContain(
      "Turnstile is using Cloudflare test keys - the widget shows 'For testing only' and does not protect the form.",
    );
  });

  it('does not warn about real-looking keys', async () => {
    const logs = captureStream();
    ctx = await surveyApp({ config: TURNSTILE, logStream: logs.stream, logLevel: 'info' });
    expect(logs.text()).not.toContain('test keys');
  });

  it('Not configured', async () => {
    const logs = captureStream();
    ctx = await surveyApp({ logStream: logs.stream, logLevel: 'info' });
    const warn = logs.lines().find((l) => l.level === 40);
    expect(warn.msg).toBe('Turnstile is not configured - public forms rely on the honeypot and rate limits only.');
    const page = await ctx.app.inject('/s/pongal-2027');
    expect(page.body).not.toContain('cf-turnstile');
    expect((await ctx.submit()).statusCode).toBe(303);
  });
});

describe('honeypot', () => {
  it('Bot fills hidden field', async () => {
    const logs = captureStream();
    ctx = await surveyApp({ logStream: logs.stream, logLevel: 'info' });
    const res = await ctx.submit({ website: 'http://spam.example' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Thank you! Your response has been received.');
    expect(res.body).not.toMatch(TOKEN_PATH);
    expect(await ctx.count('survey_responses')).toBe(0);
    expect(logs.lines().some((l) => l.msg === 'honeypot triggered')).toBe(true);
    expect(logs.text()).not.toContain('spam.example');
    expect(logs.text()).not.toContain('priya');
  });

  it('Real visitor', async () => {
    ctx = await surveyApp();
    const page = await ctx.app.inject('/s/pongal-2027');
    expect(page.body).toMatch(/<input id="website" name="website" type="text" tabindex="-1" autocomplete="off" value="">/);
    expect(page.body).toContain('<div class="hp" aria-hidden="true">');
    const res = await ctx.submit({ website: '' });
    expect(res.statusCode).toBe(303);
  });
});

describe('rate limits', () => {
  const ip = { 'cf-connecting-ip': '203.0.113.7' };

  async function tenSubmissions() {
    // Public form and edit link share the limit: 1 public, 4 edits, then 5 more public.
    const first = await ctx.submit({}, ip);
    const editUrl = first.headers.location.match(TOKEN_PATH)[0];
    const statuses = [first.statusCode];
    for (let i = 0; i < 4; i += 1) statuses.push((await ctx.post(editUrl, validForm(), ip)).statusCode);
    for (let i = 0; i < 5; i += 1) statuses.push((await ctx.submit({}, ip)).statusCode);
    expect(statuses).toEqual(Array(10).fill(303));
    return editUrl;
  }

  it('Eleventh submission', async () => {
    ctx = await surveyApp();
    await tenSubmissions();
    const before = await ctx.count('change_history');
    const res = await ctx.submit({}, ip);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('Too many submissions from your network. Please try again in an hour.');
    expect(await ctx.count('change_history')).toBe(before);
  });

  it('Eleventh submission through an edit link', async () => {
    ctx = await surveyApp();
    const editUrl = await tenSubmissions();
    const res = await ctx.post(editUrl, validForm(), ip);
    expect(res.statusCode).toBe(429);
  });

  it('Different IPs', async () => {
    ctx = await surveyApp();
    await tenSubmissions();
    const res = await ctx.submit({}, { 'cf-connecting-ip': '198.51.100.4' });
    expect(res.statusCode).toBe(303);
  });

  it('Burst of page loads', async () => {
    ctx = await surveyApp();
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 1; i <= 120; i += 1) {
      const res = await ctx.app.inject({ url: '/healthz', headers });
      expect(res.statusCode, `request ${i}`).toBe(200);
    }
    const res = await ctx.app.inject({ url: '/s/pongal-2027', headers });
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('You&#39;re going a bit fast. Please wait a minute and try again.');
    expect((await ctx.app.inject({ url: '/healthz', headers: { 'cf-connecting-ip': '198.51.100.4' } })).statusCode).toBe(200);
  });
});

describe('request size', () => {
  it('Oversized body', async () => {
    ctx = await surveyApp();
    const res = await ctx.submit({ comments: 'x'.repeat(20 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.body).toContain('That submission is too large. Please shorten your comments and try again.');
    expect(await ctx.count('survey_responses')).toBe(0);
  });
});
