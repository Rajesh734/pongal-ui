import { ADMIN_ACCESS_DENIED, ADMIN_ACCESS_UNAVAILABLE, ADMIN_DEV_WARNING, ADMIN_DISABLED_WARNING, AdminAccessError, createAdminVerifier } from './auth.js';
import { surveyState } from '../../core/survey-state.js';
import { countActiveResponses, listEvents } from '../survey/repo.js';
import { hasValidCsrfToken, isSameOrigin, issueCsrfToken } from '../../core/csrf.js';
import {
  CheckInPermissionError,
  grantCheckInPermission,
  listActiveCheckInPermissions,
  listPortalRegistrations,
  registrationCsv,
  revokeCheckInPermission,
  volunteerRows,
} from './portal-reports.js';
import { confirmRegistrationPayment, RegistrationEditError } from '../registration/service.js';

function registrationEvents(events) {
  return events.filter((event) => event.configSnapshot?.registration);
}

function selectEvent(events, slug) {
  return events.find((event) => event.slug === slug) ?? events[0] ?? null;
}

function selectStatus(value) {
  return ['payment_pending', 'confirmed', 'cancelled'].includes(value) ? value : 'all';
}

export async function adminRoutes(app, { config, db, jwks, now = () => new Date() } = {}) {
  const verifyAdmin = createAdminVerifier(config, { jwks });
  if (!verifyAdmin) app.log.warn(ADMIN_DISABLED_WARNING);
  else if (config.ADMIN_DEV_EMAIL && !(config.CF_ACCESS_TEAM_DOMAIN && config.CF_ACCESS_AUD)) app.log.warn(ADMIN_DEV_WARNING);

  app.addHook('onRequest', async (request, reply) => {
    try {
      if (!verifyAdmin) throw new AdminAccessError(403, ADMIN_ACCESS_DENIED);
      await verifyAdmin(request);
    } catch (error) {
      const status = error instanceof AdminAccessError ? error.statusCode : 403;
      request.log.warn({ reason: error?.reason ?? (verifyAdmin ? 'unexpected error' : 'admin disabled: CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD not set') }, 'Admin access denied');
      const message = status === 503 ? ADMIN_ACCESS_UNAVAILABLE : ADMIN_ACCESS_DENIED;
      return reply.code(status).type('text/plain; charset=utf-8').send(message);
    }
  });

  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST') return;
    if (!isSameOrigin(request, config)) return reply.code(403).type('text/plain; charset=utf-8').send('Request origin is not allowed.');
    if (!hasValidCsrfToken(request)) return reply.code(403).type('text/plain; charset=utf-8').send('Form security check failed.');
  });

  app.get('/', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = await listEvents(db);
    const rows = await Promise.all(events.map(async (event) => ({
      event,
      state: surveyState(event, now()),
      ...(await countActiveResponses(db, event.id)),
    })));
    return reply.view('modules/admin/views/home.eta', { title: 'Organizer dashboard', adminEmail: request.adminEmail, rows });
  });

  app.get('/registrations', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    const status = selectStatus(request.query.status);
    const rows = event ? await listPortalRegistrations(db, { eventId: event.id, status }) : [];
    return reply.view('modules/admin/views/registrations.eta', {
      title: 'Registrations', adminEmail: request.adminEmail, events, event, status, rows,
    });
  });

  app.get('/registrations.csv', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    if (!event) return reply.code(404).send('No registration event is available.');
    const status = selectStatus(request.query.status);
    const rows = await listPortalRegistrations(db, { eventId: event.id, status });
    const filename = `${event.slug}-registrations.csv`;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(registrationCsv(event, rows));
  });

  app.get('/payments', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    const rows = event ? await listPortalRegistrations(db, { eventId: event.id, status: 'payment_pending' }) : [];
    const message = request.query.confirmed === '1' ? 'Payment confirmed and entry pass issued.' : null;
    return reply.view('modules/admin/views/payments.eta', {
      title: 'Payments', adminEmail: request.adminEmail, events, event, rows, message,
      csrfToken: issueCsrfToken(request, reply, config),
    });
  });

  app.post('/payments/:registrationId/confirm', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    if (!event) return reply.code(404).send();
    try {
      await confirmRegistrationPayment(db, {
        eventId: event.id,
        registrationId: request.params.registrationId,
        adminEmail: request.adminEmail,
        qrEncryptionKey: config.QR_PASS_ENCRYPTION_KEY,
        now: now(),
      });
      return reply.redirect(`/admin/payments?event=${encodeURIComponent(event.slug)}&confirmed=1`, 303);
    } catch (error) {
      if (error instanceof RegistrationEditError) {
        const rows = await listPortalRegistrations(db, { eventId: event.id, status: 'payment_pending' });
        return reply.code(409).view('modules/admin/views/payments.eta', {
          title: 'Payments', adminEmail: request.adminEmail, events, event, rows,
          message: error.message, csrfToken: issueCsrfToken(request, reply, config),
        });
      }
      throw error;
    }
  });

  app.get('/volunteers', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    const roleOptions = event?.configSnapshot.registration.volunteer_roles ?? [];
    const roleFilter = roleOptions.some((role) => role.code === request.query.role) ? request.query.role : 'all';
    const registrations = event ? await listPortalRegistrations(db, { eventId: event.id, status: 'all' }) : [];
    const roleLabels = Object.fromEntries(roleOptions.map((role) => [role.code, role.label]));
    return reply.view('modules/admin/views/volunteers.eta', {
      title: 'Volunteers', adminEmail: request.adminEmail, events, event, roleOptions, roleFilter,
      rows: volunteerRows(registrations, roleLabels, roleFilter),
    });
  });

  async function checkInAccessPage(request, reply, eventSlug, message = null, statusCode = 200) {
    if (!db) return reply.code(404).send();
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, eventSlug);
    const rows = event ? await listActiveCheckInPermissions(db, event.id) : [];
    return reply.code(statusCode).view('modules/admin/views/check-in-access.eta', {
      title: 'Check-in Access', adminEmail: request.adminEmail, events, event, rows, message,
      csrfToken: issueCsrfToken(request, reply, config),
    });
  }

  app.get('/check-in-access', async (request, reply) => {
    const message = request.query.granted === '1'
      ? 'Check-in access granted.'
      : request.query.revoked === '1'
        ? 'Check-in access revoked.'
        : null;
    return checkInAccessPage(request, reply, request.query.event, message);
  });

  app.post('/check-in-access/grant', async (request, reply) => {
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    if (!event) return reply.code(404).send();
    try {
      await grantCheckInPermission(db, { eventId: event.id, email: request.body?.email, adminEmail: request.adminEmail, now: now() });
      return reply.redirect(`/admin/check-in-access?event=${encodeURIComponent(event.slug)}&granted=1`, 303);
    } catch (error) {
      if (error instanceof CheckInPermissionError) return checkInAccessPage(request, reply, event.slug, error.message, 400);
      throw error;
    }
  });

  app.post('/check-in-access/:permissionId/revoke', async (request, reply) => {
    const events = registrationEvents(await listEvents(db));
    const event = selectEvent(events, request.query.event);
    if (!event) return reply.code(404).send();
    await revokeCheckInPermission(db, {
      eventId: event.id,
      permissionId: request.params.permissionId,
      adminEmail: request.adminEmail,
      now: now(),
    });
    return reply.redirect(`/admin/check-in-access?event=${encodeURIComponent(event.slug)}&revoked=1`, 303);
  });

  app.all('/*', async (_request, reply) => reply.code(404).send());
}