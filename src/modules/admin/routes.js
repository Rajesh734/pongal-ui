import { ADMIN_ACCESS_DENIED, ADMIN_ACCESS_UNAVAILABLE, ADMIN_DISABLED_WARNING, AdminAccessError, createAdminVerifier } from './auth.js';
import { surveyState } from '../../core/survey-state.js';
import { countActiveResponses, listEvents } from '../survey/repo.js';

export async function adminRoutes(app, { config, db, jwks, now = () => new Date() } = {}) {
  const verifyAdmin = createAdminVerifier(config, { jwks });
  if (!verifyAdmin) app.log.warn(ADMIN_DISABLED_WARNING);

  app.addHook('onRequest', async (request, reply) => {
    try {
      if (!verifyAdmin) throw new AdminAccessError(403, ADMIN_ACCESS_DENIED);
      await verifyAdmin(request);
    } catch (error) {
      const status = error instanceof AdminAccessError ? error.statusCode : 403;
      const message = status === 503 ? ADMIN_ACCESS_UNAVAILABLE : ADMIN_ACCESS_DENIED;
      return reply.code(status).type('text/plain; charset=utf-8').send(message);
    }
  });

  app.get('/', async (request, reply) => {
    if (!db) return reply.code(404).send();
    const events = await listEvents(db);
    const rows = await Promise.all(events.map(async (event) => ({
      event,
      state: surveyState(event, now()),
      ...(await countActiveResponses(db, event.id)),
    })));
    return reply.view('modules/admin/views/home.eta', { title: 'Survey admin', adminEmail: request.adminEmail, rows });
  });
  app.all('/*', async (_request, reply) => reply.code(404).send());
}