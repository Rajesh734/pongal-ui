import { afterEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/server.js';
import { householdAuth, householdSessions, households } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { createHousehold } from '../src/db/repos/households.js';
import { migratedMemoryDb, testConfig } from './helpers.js';

const CLIENT_ID = 'pongal-client-id';
const APP_BASE_URL = 'https://portal.example.org';
const now = () => new Date('2026-11-23T12:00:00Z');

function protectedForm(page, payload, extraCookie = '') {
  const csrfToken = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const setCookies = Array.isArray(page.headers['set-cookie']) ? page.headers['set-cookie'] : [page.headers['set-cookie']].filter(Boolean);
  const csrfSetCookie = setCookies.find((cookie) => cookie.startsWith('pongal_csrf='));
  const csrfCookie = csrfSetCookie?.split(';')[0] ?? extraCookie.match(/pongal_csrf=[^;]+/)?.[0];
  return {
    headers: { origin: APP_BASE_URL, cookie: [csrfCookie, extraCookie].filter(Boolean).join('; ') },
    payload: { ...payload, _csrf: csrfToken },
  };
}

let app;
let database;
let emailMessages;

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
  emailMessages = undefined;
});

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'google-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function googleCredential(privateKey, claims = {}) {
  return new SignJWT({ email: 'Priya@Example.com', email_verified: true, sub: 'google-sub-1', name: 'Priya', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

async function setup({ withMailer = true, googleKeys, configOverrides = {} } = {}) {
  database = await migratedMemoryDb();
  emailMessages = [];
  const mailer = withMailer
    ? { sendVerificationEmail: async (message) => { emailMessages.push(message); return true; } }
    : null;
  app = await buildApp(testConfig({ APP_BASE_URL, GOOGLE_CLIENT_ID: CLIENT_ID, ...configOverrides }), {
    database,
    mailer,
    jwks: googleKeys?.jwks,
    now,
  });
  return app;
}

describe('household auth routes', () => {
  it('Manual signup sends a verification link that is single-use', async () => {
    await setup();
    const page = await app.inject('/signup');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Sign up</title>');
    expect(page.body).toContain('name="firstName"');
    expect(page.body).toContain('name="lastName"');
    expect(page.body).toContain('data-text="signup_with"');
    expect(page.body).toContain('https://accounts.google.com/gsi/client');
    expect(page.headers['content-security-policy']).toContain('accounts.google.com/gsi/client');
    expect(page.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style");

    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(page, { firstName: 'Priya', lastName: 'Raman', email: ' Priya@Example.COM ', password: 'a-secure-password' }),
    });
    expect(signup.statusCode).toBe(303);
    expect(signup.headers.location).toBe('/signup?sent=1');
    expect(emailMessages).toHaveLength(1);
    expect(emailMessages[0].to).toBe('priya@example.com');
    const token = emailMessages[0].link.split('/').at(-1);
    const [household] = await database.db.select().from(households).where(eq(households.email, 'priya@example.com'));
    const [auth] = await database.db.select().from(householdAuth).where(eq(householdAuth.householdId, household.id));
    expect(auth.emailVerifiedAt).toBeNull();

    const verified = await app.inject(`/auth/verify/${token}`);
    expect(verified.statusCode).toBe(200);
    expect(verified.body).toContain('Your email is verified. You can now access your household account.');
    const replay = await app.inject(`/auth/verify/${token}`);
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain('This verification link is no longer valid. Request a new link.');
  });

  it('Rejects invalid manual signup data', async () => {
    await setup();
    const page = await app.inject('/signup');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(page, { email: 'bad', password: 'short' }),
    });
    expect(response.statusCode).toBe(400);
    expect(emailMessages).toHaveLength(0);
    expect((await database.db.select().from(households))).toHaveLength(0);
  });

  it('Explains when SMTP email delivery is not configured', async () => {
    await setup({ withMailer: false });
    const page = await app.inject('/signup');
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(page, { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' }),
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Email delivery is not configured. Contact the organizers to complete sign-up.');
  });

  it('Manual login rejects bad credentials and logout revokes the session', async () => {
    await setup();
    const signupPage = await app.inject('/signup');
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(signupPage, { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' }),
    });
    const token = emailMessages[0].link.split('/').at(-1);
    await app.inject(`/auth/verify/${token}`);

    const loginPage = await app.inject('/login');
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      ...protectedForm(loginPage, { email: 'priya@example.com', password: 'wrong-password' }),
    });
    expect(badLogin.statusCode).toBe(401);
    expect(badLogin.body).toContain('Invalid email or password.');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      ...protectedForm(loginPage, { email: ' Priya@Example.COM ', password: 'a-secure-password' }),
    });
    expect(login.statusCode).toBe(303);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    const sessionToken = `pongal_session=${login.headers['set-cookie'].match(/pongal_session=([^;]+)/)[1]}`;
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      ...protectedForm(loginPage, {}, sessionToken),
    });
    expect(logout.statusCode).toBe(303);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    expect((await database.db.select().from(householdSessions)).some((session) => session.revokedAt)).toBe(true);
  });

  it('Google sign-in requires GIS CSRF and a verified ID token', async () => {
    const google = await keys();
    await setup({ googleKeys: google });
    const csrf = 'csrf-value';
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { origin: APP_BASE_URL, cookie: `g_csrf_token=${csrf}` },
      payload: { g_csrf_token: csrf, credential: await googleCredential(google.privateKey) },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']).toContain('pongal_session=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    const [household] = await database.db.select().from(households).where(eq(households.email, 'priya@example.com'));
    const sessions = await database.db.select().from(householdSessions).where(eq(householdSessions.householdId, household.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toContain(response.headers['set-cookie'].match(/pongal_session=([^;]+)/)[1]);
  });

  it('Rejects a Google callback without matching CSRF values', async () => {
    const google = await keys();
    await setup({ googleKeys: google });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { origin: APP_BASE_URL, cookie: 'g_csrf_token=browser-token' },
      payload: { g_csrf_token: 'form-token', credential: await googleCredential(google.privateKey) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('We couldn&#39;t verify your Google sign-in.');
  });

  it('Rejects auth form submissions without a trusted origin and matching CSRF token', async () => {
    await setup();
    const page = await app.inject('/signup');
    const validForm = protectedForm(page, { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' });
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...validForm,
      headers: { ...validForm.headers, origin: 'https://attacker.example' },
    });
    expect(crossOrigin.statusCode).toBe(403);

    const csrfCookie = validForm.headers.cookie;
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { origin: APP_BASE_URL, cookie: csrfCookie },
      payload: { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(emailMessages).toHaveLength(0);
  });

  it('Rate limits repeated auth submissions', async () => {
    await setup();
    const page = await app.inject('/signup');
    const form = protectedForm(page, { firstName: '', lastName: '', email: 'bad', password: 'short' });
    let response;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await app.inject({ method: 'POST', url: '/api/auth/signup', ...form });
    }
    expect(response.statusCode).toBe(429);
    expect(response.body).toContain('Too many sign-in attempts. Try again later.');
  });

  it('Uses Secure cookies in production', async () => {
    const google = await keys();
    await setup({ googleKeys: google, configOverrides: { NODE_ENV: 'production' } });
    const page = await app.inject('/signup');
    expect(page.headers['set-cookie']).toContain('Secure');
    expect(page.body).not.toContain('localStorage');
    expect(page.body).not.toContain('sessionStorage');
    const csrf = 'csrf-value';
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { origin: APP_BASE_URL, cookie: `g_csrf_token=${csrf}` },
      payload: { g_csrf_token: csrf, credential: await googleCredential(google.privateKey) },
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
  });

  it('Manual login requires verified email and logout revokes the session', async () => {
    const google = await keys();
    await setup({ googleKeys: google });
    const csrf = 'csrf-value';
    await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { origin: APP_BASE_URL, cookie: `g_csrf_token=${csrf}` },
      payload: { g_csrf_token: csrf, credential: await googleCredential(google.privateKey) },
    });
    const [household] = await database.db.select().from(households).where(eq(households.email, 'priya@example.com'));
    const [auth] = await database.db.select().from(householdAuth).where(eq(householdAuth.householdId, household.id));
    expect(auth.emailVerifiedAt).toBeInstanceOf(Date);

    const loginPage = await app.inject('/login');
    const unverified = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      ...protectedForm(loginPage, { email: 'priya@example.com', password: 'anything' }),
    });
    expect(unverified.statusCode).toBe(401);
    expect(unverified.body).toContain('Invalid email or password.');

    const cookie = (await database.db.select().from(householdSessions))[0];
    const sessionToken = `pongal_session=${(await app.inject({
      method: 'POST',
      url: '/api/auth/google',
      headers: { origin: APP_BASE_URL, cookie: `g_csrf_token=${csrf}` },
      payload: { g_csrf_token: csrf, credential: await googleCredential(google.privateKey) },
    })).headers['set-cookie'].match(/pongal_session=([^;]+)/)[1]}`;
    expect(cookie.tokenHash).not.toBe(sessionToken);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      ...protectedForm(loginPage, {}, sessionToken),
    });
    expect(logout.statusCode).toBe(303);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    expect((await database.db.select().from(householdSessions)).some((session) => session.revokedAt)).toBe(true);
  });

  it('Profile is private and updates contact details with WhatsApp consent', async () => {
    await setup();
    await createHousehold(database.db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    const other = await createHousehold(database.db, { email: 'other@example.com', name: 'Other family' }, 'public');
    const signupPage = await app.inject('/signup');
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(signupPage, { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' }),
    });
    expect(signup.statusCode).toBe(303);
    const verification = emailMessages[0].link.split('/').at(-1);
    await app.inject(`/auth/verify/${verification}`);
    const loginPage = await app.inject('/login');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      ...protectedForm(loginPage, { email: 'priya@example.com', password: 'a-secure-password' }),
    });
    const cookie = `pongal_session=${login.headers['set-cookie'].match(/pongal_session=([^;]+)/)[1]}`;

    const profile = await app.inject({ url: '/account/profile', headers: { cookie } });
    expect(profile.statusCode).toBe(200);
    expect(profile.body).toContain('priya@example.com');
    expect(profile.body).toContain('Priya');
    expect(profile.body).toContain('<a href="/account/profile">Profile</a>');
    expect(profile.body).toContain('<a href="/account/registrations">My Registrations</a>');
    expect(profile.body).toContain('<button type="submit">Log out</button>');
    expect(profile.body).not.toContain('<a href="/login">Sign in</a>');
    expect(profile.body).toContain('name="_csrf"');
    expect(profile.body).not.toContain('other@example.com');
    expect(other.id).not.toBe((await database.db.select().from(households).where(eq(households.email, 'priya@example.com')))[0].id);

    const profilePage = await app.inject({ url: '/account/profile', headers: { cookie } });
    const update = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      ...protectedForm(profilePage, {
        name: 'Priya Raman',
        mobileE164: '+16035550123',
        whatsappE164: '+919876543210',
        whatsappConsent: 'yes',
      }, cookie),
    });
    expect(update.statusCode).toBe(303);
    const updatedPage = await app.inject({ url: update.headers.location, headers: { cookie } });
    expect(updatedPage.body).toContain('Profile updated.');
    const [stored] = await database.db.select().from(households).where(eq(households.email, 'priya@example.com'));
    expect(stored).toMatchObject({ name: 'Priya Raman', mobileE164: '+16035550123', whatsappE164: '+919876543210' });
    expect(stored.whatsappConsentAt).toBeInstanceOf(Date);
  });

  it('Profile requires a session and WhatsApp consent', async () => {
    await setup();
    const redirect = await app.inject('/account/profile');
    expect(redirect.statusCode).toBe(303);
    expect(redirect.headers.location).toContain('/login?message=');

    const signupPage = await app.inject('/signup');
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      ...protectedForm(signupPage, { firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', password: 'a-secure-password' }),
    });
    const token = emailMessages[0].link.split('/').at(-1);
    await app.inject(`/auth/verify/${token}`);
    const loginPage = await app.inject('/login');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      ...protectedForm(loginPage, { email: 'priya@example.com', password: 'a-secure-password' }),
    });
    const cookie = `pongal_session=${login.headers['set-cookie'].match(/pongal_session=([^;]+)/)[1]}`;
    const profilePage = await app.inject({ url: '/account/profile', headers: { cookie } });
    const invalidUpdate = await app.inject({
      method: 'POST',
      url: '/api/auth/profile',
      ...protectedForm(profilePage, { name: 'Priya', mobileE164: '+16035550123', whatsappE164: '+919876543210' }, cookie),
    });
    expect(invalidUpdate.statusCode).toBe(400);
    expect(invalidUpdate.body).toContain('Enter a country code and a 10-digit WhatsApp number, and agree to event-related WhatsApp contact.');
  });
});