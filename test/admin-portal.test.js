import { afterEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/server.js';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { events } from '../src/db/schema/index.js';
import { checkInPermissions, registrationPasses, registrationPayments, registrations } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { createRegistration, declarePaymentSent } from '../src/modules/registration/service.js';
import { revealProtectedPass } from '../src/modules/registration/pass-tokens.js';
import { createOrLinkGoogleHousehold } from '../src/modules/auth/service.js';
import { buildRegistrationSchema, validateRegistration } from '../src/shared/registration-schema.js';
import { migratedMemoryDb, testConfig } from './helpers.js';

const TEAM_DOMAIN = 'organizers.example.cloudflareaccess.com';
const AUDIENCE = 'pongal-admin-aud';
const APP_BASE_URL = 'https://portal.example.org';
const QR_KEY = Buffer.alloc(32, 23).toString('base64');

let app;
let database;
let adminToken;

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
  adminToken = undefined;
});

async function setup() {
  database = await migratedMemoryDb();
  await seedEvents(database.db, loadEventConfigs('config/events'), { info() {} });
  const [event] = await database.db.select().from(events).where(eq(events.slug, 'pongal-2027'));
  const schema = buildRegistrationSchema(event.configSnapshot.registration);
  const { data } = validateRegistration(schema, {
    contactName: '=Household',
    contactEmail: 'priya@example.com',
    mobileCountryCode: '+1',
    mobileNumber: '6031234567',
    attendees: [
      { name: '=2+2', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: ['registration_desk', 'photography'] },
      { name: 'Nila', ageBand: 'under_5', willingToVolunteer: false, volunteerRoles: [] },
    ],
    performances: [{ title: 'Family Dance', participantNames: 'Family group', participantCount: 2, durationMinutes: 5, compereIntroduction: 'A traditional dance.' }],
  });
  const created = await createRegistration(database.db, { event, data });
  await declarePaymentSent(database.db, {
    registrationId: created.registration.id,
    payerName: '=SUM(A1:A2)',
    zelleReference: 'ZELLE-12345',
  });

  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'admin-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const jwks = createLocalJWKSet({ keys: [jwk] });
  adminToken = await new SignJWT({ email: 'organizer@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'admin-key' })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  app = await buildApp(testConfig({
    APP_BASE_URL,
    QR_PASS_ENCRYPTION_KEY: QR_KEY,
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUDIENCE,
  }), { database, jwks });
  return { event, created };
}

const adminHeaders = () => ({ 'cf-access-jwt-assertion': adminToken });

function adminForm(page, payload = {}) {
  const csrfToken = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const setCookies = Array.isArray(page.headers['set-cookie']) ? page.headers['set-cookie'] : [page.headers['set-cookie']].filter(Boolean);
  const csrfCookie = setCookies.find((cookie) => cookie.startsWith('pongal_csrf='))?.split(';')[0];
  return {
    headers: { ...adminHeaders(), origin: APP_BASE_URL, cookie: csrfCookie },
    payload: { ...payload, _csrf: csrfToken },
  };
}

describe('organizer portal reports', () => {
  it('separates admin pages and filters registrations by payment status', async () => {
    await setup();
    const home = await app.inject({ url: '/admin', headers: adminHeaders() });
    expect(home.statusCode).toBe(200);
    for (const route of ['/admin/registrations', '/admin/payments', '/admin/volunteers', '/admin/check-in-access']) {
      expect(home.body).toContain(route);
    }
    expect(home.body).toContain('aria-label="Organizer navigation"');
    expect(home.body).toContain('aria-label="Organizer mobile navigation"');
    expect(home.body).not.toContain('class="admin-nav"');
    expect(home.body).toContain('<a href="/admin" aria-current="page">Dashboard</a>');
    expect(home.body).toContain('<a href="/check-in">Scan Passes</a>');

    const pending = await app.inject({ url: '/admin/registrations?event=pongal-2027&status=payment_pending', headers: adminHeaders() });
    expect(pending.statusCode).toBe(200);
    expect(pending.body).toContain('=Household');
    expect(pending.body).toContain('Family Dance (5 min)');
    expect(pending.body).toContain('Payment pending');
    expect(pending.body).toContain('<th>Household</th><th>Attendee</th><th>Age group</th>');
    expect(pending.body).toMatch(/<td rowspan="\d+" class="household-cell">\s*<strong>=Household/);
    expect(pending.body).not.toContain('<th>Email</th>');
    const confirmed = await app.inject({ url: '/admin/registrations?event=pongal-2027&status=confirmed', headers: adminHeaders() });
    expect(confirmed.body).toContain('No registrations match these filters.');
  });

  it('shows pending payment details and associates volunteer roles to the named attendee', async () => {
    await setup();
    const payments = await app.inject({ url: '/admin/payments?event=pongal-2027', headers: adminHeaders() });
    expect(payments.statusCode).toBe(200);
    expect(payments.body).toContain('ZELLE-12345');
    expect(payments.body).toContain('Payments awaiting organizer verification');

    const volunteers = await app.inject({ url: '/admin/volunteers?event=pongal-2027', headers: adminHeaders() });
    expect(volunteers.statusCode).toBe(200);
    expect(volunteers.body).toContain('=2+2');
    expect(volunteers.body).toContain('Registration desk, Photography');
    expect(volunteers.body).not.toContain('Nila');
    expect(volunteers.body).toContain('<th>Age group</th>');
    expect(volunteers.body).toContain('<td>11+</td>');
    expect(volunteers.body).toContain('class="household-cell"');
    expect(volunteers.body).toContain('<th>Household</th><th>Attendee</th><th>Age group</th><th>Roles</th>');
    expect(volunteers.body).toContain('class="table-scroll table-scroll--wide"');
    expect(volunteers.body).not.toContain('table-stack');
    expect(volunteers.body).not.toContain('Age band');

    const photography = await app.inject({ url: '/admin/volunteers?event=pongal-2027&role=photography', headers: adminHeaders() });
    expect(photography.body).toContain('=2+2');
    const noStageVolunteers = await app.inject({ url: '/admin/volunteers?event=pongal-2027&role=stage_setup', headers: adminHeaders() });
    expect(noStageVolunteers.body).toContain('No attendees have volunteered yet.');
  });

  it('exports one UTF-8 CSV row per attendee and neutralizes spreadsheet formulas', async () => {
    await setup();
    const response = await app.inject({
      url: '/admin/registrations.csv?event=pongal-2027&status=payment_pending',
      headers: adminHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv; charset=utf-8');
    expect(response.body.startsWith('\uFEFF')).toBe(true);
    expect(response.body).toContain("'=Household");
    expect(response.body).toContain("'=2+2");
    expect(response.body).toContain("'=SUM(A1:A2)");
    expect(response.body).toContain("'+16031234567");
    expect(response.body).toContain('"Age group"');
    expect(response.body).toContain('"11+"');
    expect(response.body).not.toContain('11_plus');
    expect(response.body.split('\r\n')).toHaveLength(3);
  });

  it('confirms Zelle payment and issues one encrypted, reusable QR pass', async () => {
    const { created } = await setup();
    const paymentPage = await app.inject({ url: '/admin/payments?event=pongal-2027', headers: adminHeaders() });
    const confirmation = await app.inject({
      method: 'POST',
      url: `/admin/payments/${created.registration.id}/confirm?event=pongal-2027`,
      ...adminForm(paymentPage),
    });
    expect(confirmation.statusCode).toBe(303);

    const [registration] = await database.db.select().from(registrations).where(eq(registrations.id, created.registration.id));
    const [payment] = await database.db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registration.id));
    const [pass] = await database.db.select().from(registrationPasses).where(eq(registrationPasses.registrationId, registration.id));
    expect(registration.status).toBe('confirmed');
    expect(payment.status).toBe('confirmed');
    expect(payment.confirmedBy).toBe('organizer@example.com');
    expect(pass.tokenHash).not.toContain(revealProtectedPass(pass, QR_KEY));
    expect(pass.encryptedToken).not.toContain(revealProtectedPass(pass, QR_KEY));

    const guestPage = await app.inject(`/register/access/${created.accessToken}`);
    expect(guestPage.body).toContain('Payment confirmed. Your Pongal entry pass is ready.');
    expect(guestPage.body).toContain('data:image/png;base64,');

    const repeated = await app.inject({
      method: 'POST',
      url: `/admin/payments/${created.registration.id}/confirm?event=pongal-2027`,
      ...adminForm(paymentPage),
    });
    expect(repeated.statusCode).toBe(303);
    expect(await database.db.select().from(registrationPasses)).toHaveLength(1);
  });

  it('denies organizer reports and CSV without Cloudflare Access', async () => {
    await setup();
    for (const route of ['/admin/registrations', '/admin/payments', '/admin/volunteers', '/admin/check-in-access']) {
      expect((await app.inject(route)).statusCode).toBe(403);
    }
    expect((await app.inject('/admin/registrations.csv?event=pongal-2027')).statusCode).toBe(403);
  });

  it('grants and revokes check-in access only for verified household accounts', async () => {
    await setup();
    const page = await app.inject({ url: '/admin/check-in-access?event=pongal-2027', headers: adminHeaders() });
    const unverified = await app.inject({
      method: 'POST',
      url: '/admin/check-in-access/grant?event=pongal-2027',
      ...adminForm(page, { email: 'not-registered@example.com' }),
    });
    expect(unverified.statusCode).toBe(400);
    expect(unverified.body).toContain('This person needs a verified household account before check-in access can be granted.');

    await createOrLinkGoogleHousehold(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      sub: 'google-sub-check-in',
    });
    const grantPage = await app.inject({ url: '/admin/check-in-access?event=pongal-2027', headers: adminHeaders() });
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/check-in-access/grant?event=pongal-2027',
      ...adminForm(grantPage, { email: 'Priya@Example.com' }),
    });
    expect(grant.statusCode).toBe(303);
    const [permission] = await database.db.select().from(checkInPermissions);
    expect(permission.grantedBy).toBe('organizer@example.com');

    const revokePage = await app.inject({ url: '/admin/check-in-access?event=pongal-2027', headers: adminHeaders() });
    const revoke = await app.inject({
      method: 'POST',
      url: `/admin/check-in-access/${permission.id}/revoke?event=pongal-2027`,
      ...adminForm(revokePage),
    });
    expect(revoke.statusCode).toBe(303);
    const [revoked] = await database.db.select().from(checkInPermissions);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });
});