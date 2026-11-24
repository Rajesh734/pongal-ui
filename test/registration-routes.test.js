import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { checkInPermissions, events, households, registrationAccessTokens, registrationPayments, registrations } from '../src/db/schema/index.js';
import { buildApp } from '../src/server.js';
import { createHouseholdSession, createOrLinkGoogleHousehold } from '../src/modules/auth/service.js';
import { createHousehold } from '../src/db/repos/households.js';
import { confirmRegistrationPayment, createRegistration } from '../src/modules/registration/service.js';
import { buildRegistrationSchema, validateRegistration } from '../src/shared/registration-schema.js';
import { migratedMemoryDb, testConfig } from './helpers.js';

const APP_BASE_URL = 'https://portal.example.org';
const QR_KEY = Buffer.alloc(32, 29).toString('base64');

let app;
let database;
let emails;

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
  emails = undefined;
});

async function setup() {
  database = await migratedMemoryDb();
  await seedEvents(database.db, loadEventConfigs('config/events'), { info() {} });
  emails = [];
  app = await buildApp(testConfig({ APP_BASE_URL, QR_PASS_ENCRYPTION_KEY: QR_KEY }), {
    database,
    mailer: {
      sendRegistrationAccessEmail: async (message) => {
        emails.push(message);
        return true;
      },
    },
  });
  return app;
}

function registrationPayload(overrides = {}) {
  return {
    contactName: 'Priya',
    contactEmail: 'Priya@Example.com',
    mobileCountryCode: '+1',
    mobileNumber: '6031234567',
    whatsappCountryCode: '+91',
    whatsappNumber: '9876543210',
    whatsappConsent: true,
    attendees: [
      { name: 'Priya', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: ['registration_desk'] },
      { name: 'Arun', ageBand: '5_to_10', willingToVolunteer: false, volunteerRoles: [] },
      { name: 'Nila', ageBand: 'under_5', willingToVolunteer: false, volunteerRoles: [] },
    ],
    performances: [],
    ...overrides,
  };
}

function csrfForm(page, payload, extraCookie = '') {
  const csrfToken = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
  const setCookies = Array.isArray(page.headers['set-cookie']) ? page.headers['set-cookie'] : [page.headers['set-cookie']].filter(Boolean);
  const csrfCookie = setCookies.find((cookie) => cookie.startsWith('pongal_csrf='))?.split(';')[0];
  return {
    headers: { origin: APP_BASE_URL, cookie: [csrfCookie, extraCookie].filter(Boolean).join('; ') },
    payload: { ...payload, _csrf: csrfToken },
  };
}

describe('registration routes', () => {
  it('shows the registration page in the selected language without translating what the visitor typed', async () => {
    await setup();
    const form = await app.inject('/register');
    const created = await app.inject({
      method: 'POST',
      url: '/register',
      ...csrfForm(form, registrationPayload({
        performances: [{ title: 'Kolattam', participantNames: 'பிரியா and friends', participantCount: 2, durationMinutes: 5, compereIntroduction: 'ஒரு பாரம்பரிய நடனம் - a traditional dance.' }],
      })),
    });
    expect(created.statusCode).toBe(303);

    const ta = await app.inject({ url: created.headers.location, headers: { cookie: 'pongal_lang=ta' } });
    expect(ta.body).toContain('<html lang="ta">');
    expect(ta.body).toContain('உங்கள் பதிவு சேமிக்கப்பட்டது. பணம் நிலுவையில் உள்ளது.');
    expect(ta.body).toContain('2 கலைஞர்கள், 5 நிமிடங்கள்');
    expect(ta.body).toContain('Kolattam');
    expect(ta.body).toContain('ஒரு பாரம்பரிய நடனம் - a traditional dance.');
    expect(ta.body).toContain('+16039700000');

    const en = await app.inject(created.headers.location);
    expect(en.body).toContain('Your registration is saved. Payment is pending.');
    expect(en.body).toContain('ஒரு பாரம்பரிய நடனம் - a traditional dance.');
  });

  it('shows a duplicate registration in the selected language', async () => {
    await setup();
    const submit = async () => {
      const page = await app.inject({ url: '/register', headers: { cookie: 'pongal_lang=kn' } });
      return app.inject({ method: 'POST', url: '/register', ...csrfForm(page, registrationPayload(), 'pongal_lang=kn') });
    };
    expect((await submit()).statusCode).toBe(303);
    const duplicate = await submit();
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toMatch(/role="alert">ಈ ಕುಟುಂಬ ಮತ್ತು ಕಾರ್ಯಕ್ರಮಕ್ಕೆ ಈಗಾಗಲೇ ಸಕ್ರಿಯ ನೋಂದಣಿ ಇದೆ\./);
  });

  it('shows a duplicate registration as a highlighted alert', async () => {
    await setup();
    const submit = async () => {
      const form = await app.inject('/register');
      return app.inject({ method: 'POST', url: '/register', ...csrfForm(form, registrationPayload()) });
    };
    expect((await submit()).statusCode).toBe(303);
    const duplicate = await submit();
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toMatch(/class="notice" role="alert">An active registration already exists for this household and event\./);
  });

  it('Guest registration saves pending payment and sends a secure access link', async () => {
    await setup();
    const form = await app.inject('/register');
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('Register for Pongal 2027');
    expect(form.body).toContain('11+ (adult primary contact) - $35');
    expect(form.body).toContain('<input type="hidden" name="attendeeAgeBand" value="11_plus">');
    expect(form.body).toContain('5-10 - $25');
    expect(form.body).toContain('0-4 - Free');
    expect(form.body).toContain('name="whatsappSameAsMobile"');
    expect(form.body).not.toContain('id="performanceTitle0"');
    expect(form.body).toContain('United States (+1)');
    expect(form.body).toContain('India (+91)');
    expect(form.body).toContain('Other country code');
    expect(form.body).toContain('id="attendee-list"');
    expect(form.body).toContain('id="attendee-template"');
    expect(form.body).toContain('/public/js/registration.js');

    const response = await app.inject({
      method: 'POST',
      url: '/register',
      ...csrfForm(form, registrationPayload({
        performances: [{
          title: 'Family Dance',
          participantNames: 'Priya and Arun',
          participantCount: 2,
          durationMinutes: 5,
          compereIntroduction: 'A traditional Tamil folk dance.',
        }],
      })),
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toMatch(/^\/register\/access\/[A-Za-z0-9_-]{43}$/);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('priya@example.com');
    expect(emails[0].link).toContain(response.headers.location);

    const accessToken = response.headers.location.split('/').at(-1);
    const status = await app.inject(response.headers.location);
    expect(status.statusCode).toBe(200);
    expect(status.body).toContain('Your registration is saved. Payment is pending.');
    expect(status.body).not.toContain('data:image/png;base64,');
    expect(status.body).toContain('$60.00');
    expect(status.body).toContain('+16039700000');
    expect(status.body).toContain('Priya');
    expect(status.body).toContain('Family Dance');
    expect(status.body).toContain('A traditional Tamil folk dance.');
    expect(status.body).toContain('/register/access/');
    expect(status.body).toContain('I sent this payment');
    expect(status.body).toContain('Save registration and pay later');
    const laterPage = await app.inject(`/register/access/${accessToken}?later=1`);
    expect(laterPage.body).toContain('Your registration is saved and payment is still pending. Pay later using the Zelle instructions below; your QR code will be available after an organizer confirms payment.');
    expect(laterPage.body).not.toContain('data:image/png;base64,');
    const [storedRegistration] = await database.db.select().from(registrations);
    const [household] = await database.db.select().from(households).where(eq(households.id, storedRegistration.householdId));
    const [tokenRow] = await database.db.select().from(registrationAccessTokens).where(eq(registrationAccessTokens.registrationId, storedRegistration.id));
    expect(household.email).toBe('priya@example.com');
    expect(tokenRow.tokenHash).not.toContain(accessToken);

    const notConfirmed = await app.inject({
      method: 'POST',
      url: `/register/access/${accessToken}/payment`,
      ...csrfForm(status, { payerName: 'Priya Raman', zelleReference: 'ZELLE-12345' }),
    });
    expect(notConfirmed.statusCode).toBe(400);
    expect(notConfirmed.body).toContain('Please confirm you sent the payment before submitting.');

    const declaration = await app.inject({
      method: 'POST',
      url: `/register/access/${accessToken}/payment`,
      ...csrfForm(status, { payerName: 'Priya Raman', zelleReference: 'ZELLE-12345', paymentSent: 'yes' }),
    });
    expect(declaration.statusCode).toBe(303);
    expect(declaration.headers.location).toBe(`/register/access/${accessToken}?payment=sent`);
    const declaredPage = await app.inject(declaration.headers.location);
    expect(declaredPage.body).toContain('Payment marked as sent. Do not pay again. An organizer will confirm the payment, then your registration status and QR code will be completed.');
    expect(declaredPage.body).toContain('+16039700000');
    expect(declaredPage.body).toContain(storedRegistration.id.slice(0, 8).toUpperCase());
    expect(declaredPage.body).not.toContain('To pay now, send your Zelle payment');
    const [payment] = await database.db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, storedRegistration.id));
    expect(payment).toMatchObject({ status: 'pending', payerName: 'Priya Raman', zelleReference: 'ZELLE-12345' });
    expect(payment.declaredAt).toBeInstanceOf(Date);

    const editPage = await app.inject(`/register/edit/${accessToken}`);
    expect(editPage.statusCode).toBe(200);
    expect(editPage.body).toContain('Edit your Pongal registration');
    const update = await app.inject({
      method: 'POST',
      url: `/register/edit/${accessToken}`,
      ...csrfForm(editPage, registrationPayload({
        attendees: [{ name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] }],
        performances: [],
      })),
    });
    expect(update.statusCode).toBe(303);
    expect(update.headers.location).toBe(`/register/access/${accessToken}?updated=1`);
    const updatedStatus = await app.inject(update.headers.location);
    expect(updatedStatus.body).toContain('Registration updated. Submit payment details again for the new total.');
    expect(updatedStatus.body).toContain('$35.00');
    const [resetPayment] = await database.db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, storedRegistration.id));
    expect(resetPayment).toMatchObject({ status: 'pending', amountCents: 3500, payerName: null, zelleReference: null, declaredAt: null });

    const invalid = await app.inject('/register/access/not-a-valid-token');
    expect(invalid.statusCode).toBe(404);
    expect(invalid.body).toContain('This registration link is no longer valid.');
  });

  it('Signed-in registration uses the authenticated household', async () => {
    await setup();
    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      sub: 'google-sub-registration',
    });
    const { token } = await createHouseholdSession(database.db, household.id);
    const form = await app.inject({ url: '/register', headers: { cookie: `pongal_session=${token}` } });
    const response = await app.inject({
      method: 'POST',
      url: '/register',
      ...csrfForm(form, registrationPayload(), `pongal_session=${token}`),
    });
    expect(response.statusCode).toBe(303);
    expect(await database.db.select().from(households)).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('priya@example.com');
    expect(emails[0].link).toContain(response.headers.location);
  });

  it('My Registrations is private and shows a QR only for confirmed registrations', async () => {
    await setup();
    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      sub: 'google-sub-history',
    });
    const otherHousehold = await createHousehold(database.db, { email: 'other@example.com', name: 'Other family' }, 'public');
    const [event] = await database.db.select().from(events).where(eq(events.slug, 'pongal-2027'));
    const schema = buildRegistrationSchema(event.configSnapshot.registration);
    const firstData = validateRegistration(schema, registrationPayload()).data;
    const otherData = validateRegistration(schema, registrationPayload({
      contactName: 'Other family',
      contactEmail: 'other@example.com',
      attendees: [
        { name: 'Other family', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] },
        { name: 'Other attendee', ageBand: 'under_5', willingToVolunteer: false, volunteerRoles: [] },
      ],
    })).data;
    const firstRegistration = await createRegistration(database.db, { event, data: firstData, householdId: household.id });
    const otherRegistration = await createRegistration(database.db, { event, data: otherData, householdId: otherHousehold.id });
    await confirmRegistrationPayment(database.db, {
      eventId: event.id,
      registrationId: firstRegistration.registration.id,
      adminEmail: 'organizer@example.com',
      qrEncryptionKey: QR_KEY,
    });
    const { token } = await createHouseholdSession(database.db, household.id);

    const page = await app.inject({ url: '/account/registrations', headers: { cookie: `pongal_session=${token}` } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Pongal 2027');
    expect(page.body).toContain('Payment: Confirmed');
    expect(page.body).toContain('data:image/png;base64,');
    expect(page.body).not.toContain('Other attendee');
    expect(page.body).not.toContain(otherRegistration.registration.id);
  });

  it('My Registrations redirects a signed-out visitor', async () => {
    await setup();
    const response = await app.inject('/account/registrations');
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain('/login?message=');
  });

  it('check-in page requires an authorized account and offers manual fallback', async () => {
    await setup();
    const signedOut = await app.inject('/check-in');
    expect(signedOut.statusCode).toBe(303);
    expect(signedOut.headers.location).toBe('/login');

    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'scanner@example.com',
      name: 'Scanner',
      sub: 'google-sub-no-checkin',
    });
    const { token } = await createHouseholdSession(database.db, household.id);
    const noPermission = await app.inject({ url: '/check-in', headers: { cookie: `pongal_session=${token}` } });
    expect(noPermission.statusCode).toBe(403);
    expect(noPermission.body).toContain('You don&#39;t have permission to check in attendees.');
    expect(noPermission.body).toContain('Enter pass code manually');
    expect(noPermission.body).not.toContain('<a href="/check-in">Scan Passes</a>');
  });

  it('authorized scanner previews and records a confirmed family once', async () => {
    await setup();
    const [event] = await database.db.select().from(events).where(eq(events.slug, 'pongal-2027'));
    const { household: scanner } = await createOrLinkGoogleHousehold(database.db, {
      email: 'scanner@example.com',
      name: 'Scanner volunteer',
      sub: 'google-sub-scanner-authorized',
    });
    await database.db.insert(checkInPermissions).values({
      eventId: event.id,
      householdId: scanner.id,
      grantedBy: 'organizer@example.com',
      grantedAt: new Date(),
    });
    const { token: sessionToken } = await createHouseholdSession(database.db, scanner.id);
    const schema = buildRegistrationSchema(event.configSnapshot.registration);
    const { data } = validateRegistration(schema, registrationPayload());
    const registration = await createRegistration(database.db, { event, data });
    const confirmed = await confirmRegistrationPayment(database.db, {
      eventId: event.id,
      registrationId: registration.registration.id,
      adminEmail: 'organizer@example.com',
      qrEncryptionKey: QR_KEY,
    });

    const scannerPage = await app.inject({ url: '/check-in', headers: { cookie: `pongal_session=${sessionToken}` } });
    expect(scannerPage.statusCode).toBe(200);
    expect(scannerPage.body).toContain('Scan QR code with camera');
    expect(scannerPage.body).toContain('<a href="/check-in">Scan Passes</a>');
    expect(scannerPage.body).toContain('Enter pass code manually');
    const setCookies = Array.isArray(scannerPage.headers['set-cookie'])
      ? scannerPage.headers['set-cookie']
      : [scannerPage.headers['set-cookie']].filter(Boolean);
    const csrfCookie = setCookies.find((cookie) => cookie.startsWith('pongal_csrf='))?.split(';')[0];
    const preview = await app.inject({
      method: 'POST',
      url: '/check-in/preview',
      ...csrfForm(scannerPage, { token: confirmed.token }, `pongal_session=${sessionToken}`),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.body).toContain('Priya');
    expect(preview.body).toContain('check-in-result--ready');
    expect(preview.body).toContain('<li>Priya (11+)</li>');
    expect(preview.body).toContain('Check in household');

    const checkedIn = await app.inject({
      method: 'POST',
      url: '/check-in/confirm',
      ...csrfForm(preview, { token: confirmed.token }, `pongal_session=${sessionToken}; ${csrfCookie}`),
    });
    expect(checkedIn.statusCode).toBe(200);
    expect(checkedIn.body).toContain('Household checked in. Welcome!');
    expect(checkedIn.body).toContain('check-in-result--success');
    const repeated = await app.inject({
      method: 'POST',
      url: '/check-in/preview',
      ...csrfForm(scannerPage, { token: confirmed.token }, `pongal_session=${sessionToken}`),
    });

    expect(repeated.body).toContain('This household was already checked in.');
    expect(repeated.body).toContain('check-in-result--warning');

    const invalid = await app.inject({
      method: 'POST',
      url: '/check-in/preview',
      ...csrfForm(scannerPage, { token: 'not-a-pass' }, `pongal_session=${sessionToken}`),
    });
    expect(invalid.body).toContain('Pass not recognized.');
    expect(invalid.body).toContain('check-in-result--error');

    const [permission] = await database.db.select().from(checkInPermissions).where(eq(checkInPermissions.householdId, scanner.id));
    await database.db.update(checkInPermissions)
      .set({ revokedAt: new Date(), revokedBy: 'organizer@example.com' })
      .where(eq(checkInPermissions.id, permission.id));
    const revokedScan = await app.inject({
      method: 'POST',
      url: '/check-in/preview',
      ...csrfForm(scannerPage, { token: confirmed.token }, `pongal_session=${sessionToken}; ${csrfCookie}`),
    });
    expect(revokedScan.statusCode).toBe(403);
  });
});