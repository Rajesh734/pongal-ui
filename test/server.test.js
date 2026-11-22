import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { captureStream, testConfig } from './helpers.js';

const okDb = { ping: async () => {} };
let app;

async function makeApp(options = {}) {
  app = await buildApp(testConfig(), { database: okDb, ...options });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('security headers', () => {
  it('Headers present', async () => {
    await makeApp();
    for (const url of ['/healthz', '/weather']) {
      const res = await app.inject(url);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
  });

  it('Script source restricted', async () => {
    await makeApp();
    const res = await app.inject('/weather');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

describe('robots and health', () => {
  it('robots.txt', async () => {
    await makeApp();
    const res = await app.inject('/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('User-agent: *\nDisallow: /');
  });

  it('Healthy', async () => {
    await makeApp();
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('Database unavailable', async () => {
    await makeApp({ database: { ping: async () => Promise.reject(new Error('connection refused')) } });
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'unavailable' });
  });
});

describe('logging', () => {
  it('Form submission logged', async () => {
    const logs = captureStream();
    await makeApp({ logStream: logs.stream, logLevel: 'info' });
    app.post('/s/:event', async () => ({ ok: true }));
    await app.inject({
      method: 'POST',
      url: '/s/pongal-2027',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=priya%40example.com&name=Priya',
    });
    const line = logs.lines().find((l) => l.msg === 'request completed');
    expect(line).toMatchObject({ method: 'POST', route: '/s/:event', statusCode: 200 });
    expect(line.reqId).toBeTruthy();
    expect(typeof line.durationMs).toBe('number');
    expect(logs.text()).not.toContain('priya@example.com');
    expect(logs.text()).not.toContain('priya%40example.com');
  });

  it('Token in URL not logged', async () => {
    const logs = captureStream();
    await makeApp({ logStream: logs.stream, logLevel: 'info' });
    app.get('/s/:event/edit/:token', async () => 'ok');
    await app.inject('/s/pongal-2027/edit/AbC123token');
    const line = logs.lines().find((l) => l.msg === 'request completed');
    expect(line.route).toBe('/s/:event/edit/:token');
    expect(logs.text()).not.toContain('AbC123token');
  });
});

describe('error pages', () => {
  it('Unknown page', async () => {
    await makeApp();
    const res = await app.inject('/weather');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Sorry, we couldn&#39;t find that page.');
  });

  it('Unexpected error', async () => {
    const logs = captureStream();
    await makeApp({ logStream: logs.stream, logLevel: 'info' });
    app.get('/boom', async () => {
      throw new Error('internal detail xyz');
    });
    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Something went wrong on our side. Please try again in a few minutes.');
    expect(res.body).not.toContain('internal detail xyz');

    const errorLine = logs.lines().find((l) => l.level === 50);
    expect(errorLine.err.message).toBe('internal detail xyz');
    expect(res.body).toContain(errorLine.reqId);
  });
});
