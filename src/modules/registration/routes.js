import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { clientIp } from '../../core/abuse.js';
import { hasValidCsrfToken, isSameOrigin, issueCsrfToken } from '../../core/csrf.js';
import { events } from '../../db/schema/index.js';
import { findHouseholdSession } from '../auth/service.js';
import { PHONE_COUNTRIES, splitPhoneE164 } from '../../shared/phone-countries.js';
import { calculateFamilyTotal, summarizeAgeBands } from '../../shared/registration-pricing.js';
import { buildRegistrationSchema, normalizeRegistrationInput, validateRegistration } from '../../shared/registration-schema.js';
import { CheckInAccessError, hasCheckInPermission, previewCheckIn, recordCheckIn } from './checkin-service.js';
import {
  createRegistration,
  declarePaymentSent,
  confirmRegistrationPayment,
  findRegistrationByAccessToken,
  listHouseholdRegistrations,
  PaymentDeclarationError,
  RegistrationEditError,
  RegistrationConflictError,
  RegistrationOwnershipError,
  updateRegistration,
} from './service.js';

const VIEWS = 'modules/registration/views';
const SESSION_COOKIE = 'pongal_session';

function cookieValue(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function formatAmount(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export async function registrationRoutes(app, { db, config, mailer = null, now = () => new Date() } = {}) {
  const submissionLimit = app.rateLimit({
    max: 10,
    timeWindow: 60 * 60 * 1000,
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({ statusCode: 429, message: 'Too many registration attempts. Try again later.' }),
  });

  app.decorateRequest('registrationAccount', null);
  app.addHook('onRequest', async (request) => {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    request.registrationAccount = request.siteAccount ?? (token ? await findHouseholdSession(db, token, now()) : null);
  });
  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST') return;
    if (!isSameOrigin(request, config)) return reply.code(403).send('Request origin is not allowed.');
    if (!hasValidCsrfToken(request)) return reply.code(403).send('Form security check failed. Reload the page and try again.');
  });

  async function currentEvent() {
    const [event] = await db.select().from(events).where(eq(events.slug, 'pongal-2027'));
    return event?.configSnapshot?.registration ? event : null;
  }

  app.get('/register', async (request, reply) => {
    const event = await currentEvent();
    if (!event) return reply.callNotFound();
    const household = request.registrationAccount?.household;
    const mobile = splitPhoneE164(household?.mobileE164);
    const whatsapp = splitPhoneE164(household?.whatsappE164);
    return reply.view(`${VIEWS}/form.eta`, {
      title: 'Register for Pongal 2027',
      event,
      values: {
        contactName: household?.name ?? '',
        contactEmail: household?.email ?? '',
        mobileCountryCode: mobile.countryCode,
        mobileNumber: mobile.number,
        mobileOtherCountryCode: mobile.otherCountryCode,
        whatsappCountryCode: whatsapp.countryCode,
        whatsappNumber: whatsapp.number,
        whatsappOtherCountryCode: whatsapp.otherCountryCode,
        whatsappConsent: Boolean(household?.whatsappConsentAt),
        attendees: [{ name: household?.name ?? '', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] }],
        performances: [],
      },
      prices: event.configSnapshot.registration.prices_cents,
      initialTotalCents: event.configSnapshot.registration.prices_cents.age_11_plus,
      ageBandSummary: summarizeAgeBands([{ ageBand: '11_plus' }], event.configSnapshot.registration.prices_cents),
      errors: {},
      csrfToken: issueCsrfToken(request, reply, config),
      message: null,
      roles: event.configSnapshot.registration.volunteer_roles,
      phoneCountries: PHONE_COUNTRIES,
      formAction: '/register',
    });
  });

  app.post('/register', { onRequest: submissionLimit, bodyLimit: 16 * 1024 }, async (request, reply) => {
    const event = await currentEvent();
    if (!event) return reply.callNotFound();
    const schema = buildRegistrationSchema(event.configSnapshot.registration);
    const values = normalizeRegistrationInput(request.body);
    const prices = event.configSnapshot.registration.prices_cents;
    const result = validateRegistration(schema, request.body);
    if (!result.ok) {
      return reply.code(400).view(`${VIEWS}/form.eta`, {
        title: 'Register for Pongal 2027',
        event,
        values,
        prices,
        initialTotalCents: calculateFamilyTotal(values.attendees, prices),
        ageBandSummary: summarizeAgeBands(values.attendees, prices),
        errors: result.errors,
        csrfToken: request.body?._csrf,
        message: 'Please fix the highlighted details below.',
        roles: event.configSnapshot.registration.volunteer_roles,
        phoneCountries: PHONE_COUNTRIES,
        formAction: '/register',
      });
    }

    try {
      const created = await createRegistration(db, {
        event,
        data: result.data,
        householdId: request.registrationAccount?.household.id ?? null,
        now: now(),
      });
      if (!request.registrationAccount && mailer?.sendRegistrationAccessEmail && config.APP_BASE_URL) {
        const link = new URL(`/register/access/${created.accessToken}`, config.APP_BASE_URL).toString();
        await mailer.sendRegistrationAccessEmail({ to: created.household.email, eventName: event.name, link });
      }
      return reply.redirect(`/register/access/${created.accessToken}`, 303);
    } catch (error) {
      if (error instanceof RegistrationConflictError || error instanceof RegistrationOwnershipError) {
        return reply.code(409).view(`${VIEWS}/form.eta`, {
          title: 'Registration needs attention',
          event,
          values,
          prices,
          initialTotalCents: calculateFamilyTotal(values.attendees, prices),
          ageBandSummary: summarizeAgeBands(values.attendees, prices),
          errors: {},
          csrfToken: request.body?._csrf,
          message: error instanceof RegistrationOwnershipError
            ? 'Use the email address linked to your household account.'
            : error.message,
          roles: event.configSnapshot.registration.volunteer_roles,
          phoneCountries: PHONE_COUNTRIES,
          formAction: '/register',
        });
      }
      throw error;
    }
  });

  app.get('/account/registrations', async (request, reply) => {
    if (!request.registrationAccount) {
      return reply.redirect(`/login?message=${encodeURIComponent('Sign in to view your registrations.')}`, 303);
    }
    const registrations = await listHouseholdRegistrations(
      db,
      request.registrationAccount.household.id,
      config.QR_PASS_ENCRYPTION_KEY,
    );
    const rows = await Promise.all(registrations.map(async (row) => ({
      ...row,
      qrCodeDataUrl: row.entryPass ? await QRCode.toDataURL(row.entryPass, { errorCorrectionLevel: 'M', margin: 2, scale: 6 }) : null,
    })));
    return reply.view(`${VIEWS}/account-registrations.eta`, { title: 'My Registrations', rows });
  });

  async function renderAccessStatus(request, reply, token, result, message = null, status = 200) {
    const [event] = await db.select().from(events).where(eq(events.id, result.registration.eventId));
    const qrCodeDataUrl = result.entryPass
      ? await QRCode.toDataURL(result.entryPass, { errorCorrectionLevel: 'M', margin: 2, scale: 6 })
      : null;
    return reply.code(status).view(`${VIEWS}/status.eta`, {
      title: `${event.name} registration`,
      requestToken: token,
      event,
      registration: result.registration,
      household: result.household,
      attendees: result.attendees,
      performances: result.performances,
      payment: result.payment,
      qrCodeDataUrl,
      amount: formatAmount(result.registration.totalCents),
      reference: result.registration.id.slice(0, 8).toUpperCase(),
      zellePhone: event.configSnapshot.registration.zelle_phone,
      csrfToken: issueCsrfToken(request, reply, config),
      message,
    });
  }

  app.get('/register/access/:token', async (request, reply) => {
    const result = await findRegistrationByAccessToken(db, request.params.token, now(), config.QR_PASS_ENCRYPTION_KEY);
    if (!result) return reply.code(404).view('core/views/error.eta', { title: 'Registration not found', message: 'This registration link is no longer valid.', requestId: request.id });
    const message = request.query.payment === 'sent'
      ? 'Payment marked as sent. Do not pay again. An organizer will confirm the payment, then your registration status and QR code will be completed.'
      : request.query.later === '1'
        ? 'Your registration is saved and payment is still pending. Pay later using the Zelle instructions below; your QR code will be available after an organizer confirms payment.'
      : request.query.updated === '1'
        ? 'Registration updated. Submit payment details again for the new total.'
        : null;
    return renderAccessStatus(request, reply, request.params.token, result, message);
  });

  app.get('/register/edit/:token', async (request, reply) => {
    const result = await findRegistrationByAccessToken(db, request.params.token, now(), config.QR_PASS_ENCRYPTION_KEY);
    if (!result) return reply.code(404).view('core/views/error.eta', { title: 'Registration not found', message: 'This registration link is no longer valid.', requestId: request.id });
    const [event] = await db.select().from(events).where(eq(events.id, result.registration.eventId));
    if (result.payment.status !== 'pending') {
      return renderAccessStatus(request, reply, request.params.token, result, 'A confirmed registration cannot be changed here. Contact the organizers for help.', 409);
    }
    const mobile = splitPhoneE164(result.registration.contactMobileE164);
    const whatsapp = splitPhoneE164(result.registration.contactWhatsappE164);
    return reply.view(`${VIEWS}/form.eta`, {
      title: 'Edit your Pongal registration',
      event,
      values: {
        contactName: result.registration.contactName,
        contactEmail: result.registration.contactEmail,
        mobileCountryCode: mobile.countryCode,
        mobileNumber: mobile.number,
        mobileOtherCountryCode: mobile.otherCountryCode,
        whatsappCountryCode: whatsapp.countryCode,
        whatsappNumber: whatsapp.number,
        whatsappOtherCountryCode: whatsapp.otherCountryCode,
        whatsappConsent: Boolean(result.registration.whatsappConsentAt),
        attendees: result.attendees.map(({ name, ageBand, willingToVolunteer, volunteerRoles }) => ({ name, ageBand, willingToVolunteer, volunteerRoles })),
        performances: result.performances,
      },
      prices: event.configSnapshot.registration.prices_cents,
      initialTotalCents: result.registration.totalCents,
      ageBandSummary: summarizeAgeBands(result.attendees, event.configSnapshot.registration.prices_cents),
      errors: {},
      csrfToken: issueCsrfToken(request, reply, config),
      message: null,
      roles: event.configSnapshot.registration.volunteer_roles,
      phoneCountries: PHONE_COUNTRIES,
      formAction: `/register/edit/${request.params.token}`,
    });
  });

  app.post('/register/edit/:token', { onRequest: submissionLimit, bodyLimit: 16 * 1024 }, async (request, reply) => {
    const result = await findRegistrationByAccessToken(db, request.params.token, now(), config.QR_PASS_ENCRYPTION_KEY);
    if (!result) return reply.code(404).view('core/views/error.eta', { title: 'Registration not found', message: 'This registration link is no longer valid.', requestId: request.id });
    const [event] = await db.select().from(events).where(eq(events.id, result.registration.eventId));
    if (result.payment.status !== 'pending') {
      return renderAccessStatus(request, reply, request.params.token, result, 'A confirmed registration cannot be changed here. Contact the organizers for help.', 409);
    }
    const schema = buildRegistrationSchema(event.configSnapshot.registration);
    const values = normalizeRegistrationInput(request.body);
    const resultData = validateRegistration(schema, request.body);
    if (!resultData.ok) {
      return reply.code(400).view(`${VIEWS}/form.eta`, {
        title: 'Edit your Pongal registration',
        event,
        values,
        prices: event.configSnapshot.registration.prices_cents,
        initialTotalCents: calculateFamilyTotal(values.attendees, event.configSnapshot.registration.prices_cents),
        ageBandSummary: summarizeAgeBands(values.attendees, event.configSnapshot.registration.prices_cents),
        errors: resultData.errors,
        csrfToken: request.body?._csrf,
        message: 'Please fix the highlighted details below.',
        roles: event.configSnapshot.registration.volunteer_roles,
        phoneCountries: PHONE_COUNTRIES,
        formAction: `/register/edit/${request.params.token}`,
      });
    }

    try {
      await updateRegistration(db, { event, registrationId: result.registration.id, data: resultData.data, now: now() });
      return reply.redirect(`/register/access/${request.params.token}?updated=1`, 303);
    } catch (error) {
      if (error instanceof RegistrationEditError || error instanceof RegistrationOwnershipError) {
        const updated = await findRegistrationByAccessToken(db, request.params.token, now(), config.QR_PASS_ENCRYPTION_KEY);
        return renderAccessStatus(request, reply, request.params.token, updated, error.message, 409);
      }
      throw error;
    }
  });

  app.post('/register/access/:token/payment', { onRequest: submissionLimit, bodyLimit: 16 * 1024 }, async (request, reply) => {
    const result = await findRegistrationByAccessToken(db, request.params.token, now(), config.QR_PASS_ENCRYPTION_KEY);
    if (!result) return reply.code(404).view('core/views/error.eta', { title: 'Registration not found', message: 'This registration link is no longer valid.', requestId: request.id });
    if (result.payment.status === 'confirmed') return reply.redirect(`/register/access/${request.params.token}`, 303);
    if (request.body?.paymentSent !== 'yes') {
      return renderAccessStatus(request, reply, request.params.token, result, 'Please confirm you sent the payment before submitting.', 400);
    }
    try {
      await declarePaymentSent(db, {
        registrationId: result.registration.id,
        payerName: request.body?.payerName,
        zelleReference: request.body?.zelleReference,
        now: now(),
      });
      return reply.redirect(`/register/access/${request.params.token}?payment=sent`, 303);
    } catch (error) {
      if (error instanceof PaymentDeclarationError) {
        return renderAccessStatus(request, reply, request.params.token, result, error.message, 400);
      }
      throw error;
    }
  });

  async function renderCheckIn(request, reply, event, result = null, message = null, statusCode = 200) {
    return reply.code(statusCode).view(`${VIEWS}/check-in.eta`, {
      title: 'Pongal check-in',
      event,
      result,
      message,
      csrfToken: issueCsrfToken(request, reply, config),
      errorMessages: {
        invalid: 'Pass not recognized. Check the QR code or ask an organizer for help.',
        payment_pending: 'Payment is not confirmed. Ask an organizer for help.',
        wrong_event: 'This pass is for a different event.',
        already_checked_in: 'This household was already checked in.',
        checked_in: 'Household checked in. Welcome!',
      },
    });
  }

  app.get('/check-in', async (request, reply) => {
    if (!request.registrationAccount) return reply.redirect('/login', 303);
    const event = await currentEvent();
    if (!event) return reply.callNotFound();
    const allowed = await hasCheckInPermission(db, event.id, request.registrationAccount.household.id);
    if (!allowed) return renderCheckIn(request, reply, event, null, "You don't have permission to check in attendees.", 403);
    return renderCheckIn(request, reply, event);
  });

  app.post('/check-in/preview', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!request.registrationAccount) return reply.redirect('/login', 303);
    const event = await currentEvent();
    if (!event) return reply.callNotFound();
    try {
      const result = await previewCheckIn(db, {
        eventId: event.id,
        operatorHouseholdId: request.registrationAccount.household.id,
        token: request.body?.token,
      });
      return renderCheckIn(request, reply, event, { ...result, token: request.body?.token });
    } catch (error) {
      if (error instanceof CheckInAccessError) return renderCheckIn(request, reply, event, null, error.message, 403);
      throw error;
    }
  });

  app.post('/check-in/confirm', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!request.registrationAccount) return reply.redirect('/login', 303);
    const event = await currentEvent();
    if (!event) return reply.callNotFound();
    try {
      const result = await recordCheckIn(db, {
        eventId: event.id,
        operatorHouseholdId: request.registrationAccount.household.id,
        token: request.body?.token,
        now: now(),
      });
      return renderCheckIn(request, reply, event, result);
    } catch (error) {
      if (error instanceof CheckInAccessError) return renderCheckIn(request, reply, event, null, error.message, 403);
      throw error;
    }
  });
}