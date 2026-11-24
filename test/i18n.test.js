import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { buildApp } from '../src/server.js';
import { buildRegistrationSchema, validateRegistration } from '../src/shared/registration-schema.js';
import { CATALOGS, LOCALES } from '../src/shared/i18n/index.js';
import { migratedMemoryDb, testConfig } from './helpers.js';

const APP_BASE_URL = 'https://portal.example.org';
const QR_KEY = Buffer.alloc(32, 31).toString('base64');
const TRANSLATED = ['ta', 'te', 'kn', 'ml'];

// Messages produced by services and routes that reach portal visitors without a literal t() call.
const DYNAMIC_KEYS = [
  'An active registration already exists for this household and event.',
  'This household is unavailable for new registrations. Contact an organizer.',
  'A confirmed registration cannot be changed here. Contact the organizers for help.',
  'Enter the name shown on the Zelle payment.',
  'Enter the Zelle confirmation or payment reference.',
  'Enter a name between 2 and 150 characters.',
  'Enter a country code and a 10-digit mobile number.',
  'Enter a country code and a 10-digit WhatsApp number, and agree to event-related WhatsApp contact.',
  'Too many registration attempts. Try again later.',
  'Too many sign-in attempts. Try again later.',
  'Registration not found',
  'This registration link is no longer valid.',
];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (name === 'vendor' || name === 'catalogs') return [];
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.(eta|js)$/.test(name) ? [file] : [];
  });
}

function literalKeys() {
  const pattern = /(?:\bit\.t|\brequest\.t|(?<![\w$.]))t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  const keys = new Set();
  for (const file of sourceFiles('src')) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) keys.add((match[1] ?? match[2]).replaceAll("\\'", "'"));
  }
  return keys;
}

function schemaMessages() {
  const text = readFileSync('src/shared/registration-schema.js', 'utf8');
  return [...text.matchAll(/'((?:[^'\\]|\\.)*[.])'/g)].map((match) => match[1]).filter((message) => /^[A-Z]/.test(message) && !message.includes('${'));
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

describe('message catalogs', () => {
  it('offer the five languages with English first', () => {
    expect(LOCALES.map((locale) => locale.code)).toEqual(['en', 'ta', 'te', 'kn', 'ml']);
  });

  it('contain the same keys, with the same placeholders and no empty text, in every language', () => {
    const keys = Object.keys(CATALOGS.ta).sort();
    for (const code of TRANSLATED) {
      expect(Object.keys(CATALOGS[code]).sort(), code).toEqual(keys);
      for (const key of keys) {
        expect(CATALOGS[code][key].trim(), `${code}: ${key}`).not.toBe('');
        expect(placeholders(CATALOGS[code][key]), `${code}: ${key}`).toBe(placeholders(key));
      }
    }
  });

  it('cover every label, message and validation error the portal shows', () => {
    const required = [...literalKeys(), ...schemaMessages(), ...DYNAMIC_KEYS];
    expect(required.length).toBeGreaterThan(100);
    for (const code of TRANSLATED) {
      const missing = required.filter((key) => !(key in CATALOGS[code]));
      expect(missing, `${code} is missing translations`).toEqual([]);
    }
  });

  it('translate every volunteer role label from the event configuration', () => {
    const [event] = loadEventConfigs('config/events');
    for (const role of event.config.registration.volunteer_roles) {
      for (const code of TRANSLATED) expect(CATALOGS[code][role.label], `${code}: ${role.label}`).toBeTruthy();
    }
  });
});

let app;
let database;
afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
});

async function setup() {
  database = await migratedMemoryDb();
  await seedEvents(database.db, loadEventConfigs('config/events'), { info() {} });
  app = await buildApp(testConfig({ APP_BASE_URL, QR_PASS_ENCRYPTION_KEY: QR_KEY }), { database });
}

const lang = (code) => ({ cookie: `pongal_lang=${code}` });

describe('language selection', () => {
  it('uses English with the selector on a first visit', async () => {
    await setup();
    const response = await app.inject('/about');
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain('About Eastcoast Tamil Community');
    expect(response.body).toContain('hreflang="en" aria-current="true">English</a>');
    expect(String(response.headers['set-cookie'] ?? '')).not.toContain('pongal_lang');
  });

  it('switches language, saves it, and keeps it across pages', async () => {
    await setup();
    const selected = await app.inject('/about?lang=ml');
    expect(selected.body).toContain('<html lang="ml">');
    expect(selected.body).toContain('ഈസ്റ്റ്‌കോസ്റ്റ് തമിഴ് കമ്മ്യൂണിറ്റിയെക്കുറിച്ച്');
    expect(selected.body).toContain('hreflang="ml" aria-current="true">മലയാളം</a>');
    const cookie = [].concat(selected.headers['set-cookie']).find((value) => value.startsWith('pongal_lang='));
    expect(cookie).toMatch(/^pongal_lang=ml; Path=\/; Max-Age=31536000/);

    for (const url of ['/register', '/about', '/']) {
      const page = await app.inject({ url, headers: lang('ml') });
      expect(page.body, url).toContain('<html lang="ml">');
    }
    const register = await app.inject({ url: '/register', headers: lang('ml') });
    expect(register.body).toContain('പ്രധാന ബന്ധപ്പെടൽ വ്യക്തിയും പങ്കെടുക്കുന്നയാൾ 1 ഉം');
    expect(register.body).toContain('രജിസ്റ്റർ ചെയ്യുക</title>');
  });

  it('lets the visitor change the saved language back to English', async () => {
    await setup();
    const back = await app.inject({ url: '/about?lang=en', headers: lang('ta') });
    expect(back.body).toContain('<html lang="en">');
    expect([].concat(back.headers['set-cookie']).join(';')).toContain('pongal_lang=en');
  });

  it.each(['xx', 'EN', '../etc'])('falls back to English with a notice for the unsupported code "%s"', async (code) => {
    await setup();
    const response = await app.inject({ url: `/about?lang=${encodeURIComponent(code)}` });
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain('English is selected because that language is unavailable.');
  });

  it('falls back to English for a saved unsupported language', async () => {
    await setup();
    const response = await app.inject({ url: '/about', headers: lang('zz') });
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain('English is selected because that language is unavailable.');
  });

  it('keeps organizer pages in English', async () => {
    await setup();
    const response = await app.inject({ url: '/admin', headers: lang('ta') });
    expect(response.body).not.toContain('தமிழ்');
  });

  it('serves the selected language catalog to the browser from the site itself', async () => {
    await setup();
    const catalog = await app.inject('/shared/i18n/catalogs/te.js');
    expect(catalog.statusCode).toBe(200);
    expect(catalog.body).toContain('నమోదు చేయండి');
    expect((await app.inject('/shared/i18n/browser.js')).statusCode).toBe(200);
  });
});

describe('localized validation', () => {
  const event = () => loadEventConfigs('config/events')[0].config.registration;

  it('translates server validation messages and leaves English as the default', () => {
    const schema = buildRegistrationSchema(event());
    const raw = { contactEmail: 'priya@example.com', mobileNumber: '6031234567', attendees: [{ name: '', ageBand: '11_plus' }] };
    const english = validateRegistration(schema, raw);
    expect(english.errors.attendees).toBe('Enter a name for each attendee.');

    const telugu = validateRegistration(schema, raw, (key, vars) => (CATALOGS.te[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => vars?.[name] ?? m));
    expect(telugu.errors.attendees).toBe(CATALOGS.te['Enter a name for each attendee.']);
  });

  it('translates the performance time limit message with its numbers', () => {
    const schema = buildRegistrationSchema(event());
    const raw = {
      contactName: 'Priya', contactEmail: 'priya@example.com', mobileNumber: '6031234567',
      attendees: [{ name: 'Priya', ageBand: '11_plus' }],
      performances: [{ title: 'Dance', participantNames: 'Priya', participantCount: 1, durationMinutes: 6, compereIntroduction: 'Hi' }],
    };
    const translate = (key, vars) => (CATALOGS.ta[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => vars?.[name] ?? m);
    const { errors } = validateRegistration(schema, raw, translate);
    expect(errors.performances).toContain('4');
    expect(errors.performances).toContain('தனி நிகழ்ச்சிக்கு');
  });

  it('shows the form error in the selected language and keeps what the visitor typed', async () => {
    await setup();
    const form = await app.inject({ url: '/register', headers: lang('te') });
    const token = form.body.match(/name="_csrf" value="([^"]+)"/)[1];
    const response = await app.inject({
      method: 'POST',
      url: '/register',
      headers: { origin: APP_BASE_URL, cookie: `pongal_csrf=${token}; pongal_lang=te`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        _csrf: token, contactEmail: 'priya@example.com', mobileCountryCode: '+1', mobileNumber: '6031234567',
        attendeeName: '', attendeeAgeBand: '11_plus',
      }).toString(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain(CATALOGS.te['Add at least one attendee to continue.']);
    expect(response.body).toContain(CATALOGS.te['Please fix the highlighted details below.']);
    expect(response.body).toContain('value="priya@example.com"');
  });
});
