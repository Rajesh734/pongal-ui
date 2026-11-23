import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildApp } from '../src/server.js';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { checkInPermissions, events, householdSessions } from '../src/db/schema/index.js';
import { createOrLinkGoogleHousehold } from '../src/modules/auth/service.js';
import { migratedMemoryDb, testConfig } from '../test/helpers.js';

let app;
let database;
let proxy;
let certificateDirectory;
let baseUrl;
let sessionToken;
let appConfig;

test.beforeAll(async () => {
  database = await migratedMemoryDb();
  await seedEvents(database.db, loadEventConfigs('config/events'), { info() {} });
  const [event] = await database.db.select().from(events);
  const now = new Date();
  const { household } = await createOrLinkGoogleHousehold(database.db, {
    email: 'scanner-browser-test@example.com',
    name: 'Scanner browser test',
    sub: 'scanner-browser-test',
  }, now);

  sessionToken = randomBytes(32).toString('base64url');
  await database.db.insert(householdSessions).values({
    householdId: household.id,
    tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
  });
  await database.db.insert(checkInPermissions).values({
    eventId: event.id,
    householdId: household.id,
    grantedBy: 'browser-test-organizer',
    grantedAt: now,
  });

  const portProbe = createHttpServer();
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
  const proxyPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  baseUrl = `https://localhost:${proxyPort}`;

  appConfig = testConfig({ APP_BASE_URL: baseUrl, GOOGLE_CLIENT_ID: 'browser-test-google-client-id' });
  app = await buildApp(appConfig, { database, logLevel: 'silent' });
  await app.listen({ port: 0, host: '127.0.0.1' });

  certificateDirectory = mkdtempSync(path.join(tmpdir(), 'pongal-browser-https-'));
  const keyPath = path.join(certificateDirectory, 'key.pem');
  const certificatePath = path.join(certificateDirectory, 'certificate.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', keyPath, '-out', certificatePath,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
  ], { stdio: 'ignore' });

  proxy = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, (request, response) => {
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: app.server.address().port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, 'x-forwarded-proto': 'https' },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (app) await app.close();
  if (database) await database.close();
  if (certificateDirectory) rmSync(certificateDirectory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{
    name: 'pongal_session',
    value: sessionToken,
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }]);
});

test('camera permission denial preserves manual pass entry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } },
    });
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class {} });
  });

  await page.goto(`${baseUrl}/check-in`);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.getByRole('button', { name: 'Start camera scanner' }).click();

  await expect(page.locator('#camera-status')).toContainText('Camera access is unavailable.');
  await expect(page.getByLabel('Enter pass code manually')).toBeVisible();
});

test('camera API unavailable preserves manual pass entry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined });
  });

  await page.goto(`${baseUrl}/check-in`);
  await page.getByRole('button', { name: 'Start camera scanner' }).click();

  await expect(page.locator('#camera-status')).toContainText('Camera access is unavailable.');
  await expect(page.getByLabel('Enter pass code manually')).toBeVisible();
});

test('successful mobile scan fills and submits the pass code', async ({ page }) => {
  const passCode = 'B'.repeat(43);
  await page.addInitScript((scannedCode) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    });
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: class { async detect() { return [{ rawValue: scannedCode }]; } },
    });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLFormElement.prototype.requestSubmit = function () { this.dataset.testSubmitted = 'true'; };
  }, passCode);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/check-in`);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);
  await page.getByRole('button', { name: 'Start camera scanner' }).click();

  const form = page.locator('form[action="/check-in/preview"]');
  await expect(form).toHaveAttribute('data-test-submitted', 'true');
  await expect(form.locator('input[name="token"]')).toHaveValue(passCode);
});

test('mobile navigation, account menu, and Google signup are available', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(baseUrl);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('.mobile-menu summary').click();
  await expect(page.locator('.mobile-menu__panel')).toBeVisible();
  await expect(page.locator('.mobile-menu__panel a[href="/register"]')).toBeVisible();
  await page.mouse.click(350, 760);
  await expect(page.locator('.mobile-menu__panel')).toBeHidden();
  await page.locator('.account-menu summary').click();
  await expect(page.locator('.account-menu__panel a[href="/login"]')).toHaveText('Sign in');
  await expect(page.locator('.account-menu__panel a[href="/signup"]')).toHaveText('Sign up');
  await page.mouse.click(10, 760);
  await expect(page.locator('.account-menu__panel')).toBeHidden();
  await page.locator('.account-menu summary').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-menu__panel')).toBeHidden();
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(360);

  await page.goto(`${baseUrl}/signup`);
  await expect(page.locator('#g_id_onload')).toHaveAttribute('data-client_id', 'browser-test-google-client-id');
  await expect(page.getByLabel('First name')).toBeVisible();
  await expect(page.getByLabel('Last name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toBeVisible();
  expect(await page.locator('.g_id_signin').evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
});

test('signed-in account dropdown exposes profile and logout', async ({ page }) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.mobile-menu summary').click();
  await expect(page.locator('.mobile-menu__panel a[href="/register"]')).toBeVisible();
  await page.locator('.account-menu summary').click();
  await expect(page.locator('.account-menu__panel a[href="/account/profile"]')).toBeVisible();
  await expect(page.locator('.account-menu__panel a[href="/account/registrations"]')).toBeVisible();
  await expect(page.locator('.account-menu__panel a[href="/login"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Log out' }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(`${baseUrl}/`);
});

test('registration validates on blur, hides volunteering for minors, and continues to payment', async ({ page }) => {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${baseUrl}/register`);
  expect(await page.evaluate(() => isSecureContext)).toBe(true);

  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Mobile number').focus();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#contactEmail-validation-error')).toContainText('Enter a valid email address');

  await page.getByLabel('Mobile number').fill('letters');
  await page.getByLabel('Full name').focus();
  await expect(page.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#mobileNumber-validation-error')).toContainText('Enter exactly 10 digits');

  const whatsapp = page.getByLabel('WhatsApp number, if different (optional)');
  await whatsapp.fill('9876543210');
  await expect(page.locator('[data-validation-error-for="whatsappConsent"]')).toContainText('Agree before organizers contact you on WhatsApp.');
  await whatsapp.fill('9876543211');
  await expect(page.locator('[data-validation-error-for="whatsappConsent"]')).toHaveCount(1);
  await whatsapp.fill('');
  await expect(page.locator('[data-validation-error-for="whatsappConsent"]')).toHaveCount(1);
  await expect(page.locator('[data-validation-error-for="whatsappConsent"]')).toBeHidden();

  await expect(page.locator('[name="attendeeAgeBand"]').first()).toHaveValue('11_plus');
  await expect(page.locator('[name="attendeeAgeBand"]').first()).toBeHidden();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack));
  const addAttendeeButton = page.getByRole('button', { name: 'Add attendee' });
  expect(await addAttendeeButton.isEnabled()).toBe(true);
  await addAttendeeButton.click();
  expect(browserErrors).toEqual([]);
  await expect(page.locator('.attendee-row')).toHaveCount(2);
  const childRow = page.locator('.attendee-row').nth(1);
  const ageOptions = await childRow.locator('[name="attendeeAgeBand"] option').evaluateAll(options => options.map(option => option.value));
  expect(ageOptions).toEqual(['11_plus', '5_to_10', 'under_5']);
  await expect(childRow.locator('[name="attendeeAgeBand"]')).toHaveValue('11_plus');
  await childRow.locator('[name="attendeeAgeBand"]').selectOption('11_plus');
  await expect(childRow.locator('.attendee-volunteer')).toBeVisible();
  await childRow.locator('[name="attendeeAgeBand"]').selectOption('5_to_10');
  await childRow.locator('[name="attendeeAgeBand"]').selectOption('5_to_10');
  await childRow.getByLabel('Name').fill('Child Test');
  await expect(childRow.locator('.attendee-volunteer')).toBeHidden();
  await expect(childRow.locator('.attendee-volunteer input').first()).toBeDisabled();
  await expect(page.locator('[name="contactName"]')).toHaveCount(0);
  await expect(page.locator('[name="attendeeName"]')).toHaveCount(2);

  const email = page.getByLabel('Email');
  await email.fill('family@example.com');
  await page.getByLabel('Mobile number').fill('6039700000');
  await page.getByLabel('Full name').fill('Arun Test');
  const emailWidth = await email.evaluate((input) => input.getBoundingClientRect().width);
  const nameWidth = await page.getByLabel('Full name').evaluate((input) => input.getBoundingClientRect().width);
  expect(nameWidth).toBe(emailWidth);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBe(360);

  await page.getByRole('button', { name: 'Continue to payment instructions' }).click();
  await expect(page).toHaveURL(/\/register\/access\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText('Payment is pending.')).toBeVisible();
  const accessUrl = page.url();
  await page.getByRole('link', { name: 'Save registration and pay later' }).click();
  await expect(page).toHaveURL(/\?later=1$/);
  await expect(page.getByRole('status')).toContainText('Your registration is saved and payment is still pending.');

  await page.goto(accessUrl);
  await page.getByLabel('Name shown on the Zelle payment').fill('Arun Test');
  await page.getByLabel('Zelle confirmation or payment reference').fill('TEST-PAYMENT-1');
  await page.getByLabel('I sent this payment').check();
  await page.getByRole('button', { name: 'Submit payment details' }).click();
  await expect(page).toHaveURL(/\?payment=sent$/);
  await expect(page.getByRole('status')).toContainText('Do not pay again.');
  await expect(page.locator('body')).not.toContainText('To pay now, send your Zelle payment');
  await expect(page.locator('body')).toContainText('Your registration status and QR code will be completed after an organizer confirms the payment.');
});

test('desktop auth and registration forms stay within readable widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/signup`);
  const authCardWidth = await page.locator('.auth-card').evaluate(element => element.getBoundingClientRect().width);
  const authInputWidth = await page.locator('.auth-card input[type="email"]').evaluate(element => element.getBoundingClientRect().width);
  expect(authCardWidth).toBeLessThanOrEqual(512);
  expect(authInputWidth).toBeLessThanOrEqual(416);

  await page.goto(`${baseUrl}/register`);
  const registrationCardWidth = await page.locator('.registration-card').evaluate(element => element.getBoundingClientRect().width);
  const formWidths = await page.locator('.registration-card form input:not([type="hidden"]):not([type="checkbox"]):not([hidden])')
    .evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().width));
  expect(registrationCardWidth).toBeLessThanOrEqual(800);
  expect(new Set(formWidths).size).toBe(1);
  expect(formWidths[0]).toBeLessThanOrEqual(704);
});