import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/server.js';
import { testConfig } from './helpers.js';
import { surveyApp } from './survey-app.js';

const TEAM_DOMAIN = 'organizers.example.cloudflareaccess.com';
const AUDIENCE = 'pongal-admin-aud';

let app;
let survey;
let jwksServer;

async function accessKeys(kid = 'organizer-key') {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.key_ops = ['verify'];
  return { privateKey, publicJwk: jwk, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function localJwksServer(keys) {
  let currentKeys = keys;
  let requestCount = 0;
  jwksServer = createServer((_request, response) => {
    requestCount += 1;
    response.setHeader('content-type', 'application/json');
    response.setHeader('connection', 'close');
    response.end(JSON.stringify({ keys: currentKeys }));
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${jwksServer.address().port}/certs`,
    setKeys: (nextKeys) => { currentKeys = nextKeys; },
    requestCount: () => requestCount,
  };
}

async function token(privateKey, { audience = AUDIENCE, expiresIn = '1h', kid = 'organizer-key' } = {}) {
  return new SignJWT({ email: 'organizer@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

async function makeApp(keys) {
  app = await buildApp(testConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUDIENCE }), {
    database: { ping: async () => {} },
    jwks: keys.jwks ?? keys,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  await survey?.app.close();
  if (jwksServer) {
    await new Promise((resolve) => jwksServer.close(resolve));
  }
  app = undefined;
  survey = undefined;
  jwksServer = undefined;
});

describe('local development admin login', () => {
  const devConfig = (overrides = {}) => testConfig({ NODE_ENV: 'development', ADMIN_DEV_EMAIL: 'dev-admin@example.com', ...overrides });

  it('admits direct localhost requests in development', async () => {
    app = await buildApp(devConfig(), { database: { ping: async () => {} } });
    const res = await app.inject({ url: '/admin' });
    expect(res.statusCode).not.toBe(403);
  });

  it('denies requests that arrived through a proxy or tunnel', async () => {
    app = await buildApp(devConfig(), { database: { ping: async () => {} } });
    for (const header of ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip']) {
      const res = await app.inject({ url: '/admin', headers: { [header]: '203.0.113.9' } });
      expect(res.statusCode).toBe(403);
    }
  });

  it('is ignored outside development', async () => {
    app = await buildApp(devConfig({ NODE_ENV: 'production' }), { database: { ping: async () => {} } });
    expect((await app.inject({ url: '/admin' })).statusCode).toBe(403);
  });

  it('is ignored when Cloudflare Access is configured', async () => {
    const keys = await accessKeys();
    app = await buildApp(devConfig({ CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUDIENCE }), {
      database: { ping: async () => {} },
      jwks: keys.jwks,
    });
    expect((await app.inject({ url: '/admin' })).statusCode).toBe(403);
  });
});

describe('admin Access verification', () => {
  it('Valid token', async () => {
    const keys = await accessKeys();
    await makeApp(keys);
    const res = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('During the survey', async () => {
    const keys = await accessKeys();
    survey = await surveyApp({ config: { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUDIENCE }, jwks: keys.jwks });
    await survey.submit({ email: 'first@example.com', headcount_adult_11_plus: '2', headcount_kids_5_10: '1' });
    await survey.submit({ email: 'second@example.com', headcount_adult_11_plus: '3', headcount_kids_5_10: '1' });

    const res = await survey.app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Open');
    expect(res.body).toContain('2 families');
    expect(res.body).toContain('7 people');
    expect(res.body).toContain('/admin/events/pongal-2027/responses.csv');
  });

  it('Signed-in banner', async () => {
    const keys = await accessKeys();
    survey = await surveyApp({ config: { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUDIENCE }, jwks: keys.jwks });
    const res = await survey.app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey) },
    });
    expect(res.body).toContain('Signed in as <strong>organizer@example.com</strong>');
  });

  it('No token', async () => {
    const keys = await accessKeys();
    await makeApp(keys);
    const res = await app.inject('/admin');
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("You don't have access to this page.");
  });

  it('Token for another application', async () => {
    const keys = await accessKeys();
    await makeApp(keys);
    const res = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey, { audience: 'another-app-aud' }) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Expired token', async () => {
    const keys = await accessKeys();
    await makeApp(keys);
    const res = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey, { expiresIn: '0s' }) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Forged token', async () => {
    const trusted = await accessKeys();
    const forged = await accessKeys('forged-key');
    await makeApp(trusted);
    const res = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(forged.privateKey, { kid: 'forged-key' }) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Look-alike path', async () => {
    const keys = await accessKeys();
    await makeApp(keys);
    for (const url of ['/ADMIN', '/admin%2F']) {
      const res = await app.inject(url);
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain('Signed in as');
    }
  });

  it('Survey without token', async () => {
    survey = await surveyApp();
    const res = await survey.app.inject('/s/pongal-2027');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pongal 2027 interest survey');
  });

  it('Not configured', async () => {
    app = await buildApp(testConfig(), { database: { ping: async () => {} } });
    const res = await app.inject('/admin');
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("You don't have access to this page.");
  });

  it('Cloudflare rotates keys', async () => {
    const first = await accessKeys('key-1');
    const second = await accessKeys('key-2');
    const server = await localJwksServer([first.publicJwk]);
    await makeApp({ jwks: createRemoteJWKSet(new URL(server.url), { cooldownDuration: 0 }) });

    const firstResponse = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(first.privateKey, { kid: 'key-1' }) },
    });
    expect(firstResponse.statusCode).toBe(404);
    expect(server.requestCount()).toBe(1);

    server.setKeys([second.publicJwk]);
    const secondResponse = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(second.privateKey, { kid: 'key-2' }) },
    });
    expect(secondResponse.statusCode).toBe(404);
    expect(server.requestCount()).toBe(2);
  });

  it('Key endpoint unreachable', async () => {
    const keys = await accessKeys('unreachable-key');
    const server = await localJwksServer([]);
    const remoteJwks = createRemoteJWKSet(new URL(server.url), { cooldownDuration: 60_000 });
    await new Promise((resolve) => jwksServer.close(resolve));
    jwksServer = undefined;
    await makeApp({ jwks: remoteJwks });

    const res = await app.inject({
      url: '/admin',
      headers: { 'cf-access-jwt-assertion': await token(keys.privateKey, { kid: 'unreachable-key' }) },
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('Admin sign-in check is temporarily unavailable');
  });
});
