import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { LogController } from 'fastify';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import { Eta } from 'eta';
import { and, eq, isNull } from 'drizzle-orm';
import { formatConfig, loadConfig } from './config.js';
import { clientIp, turnstileEnabled, usesTurnstileTestKeys } from './core/abuse.js';
import { scheduleBackups } from './core/backup.js';
import { loadEventConfigs } from './core/event-config.js';
import { healthRoutes } from './core/health.js';
import { CSRF_COOKIE, cookieValue, issueCsrfToken } from './core/csrf.js';
import { genReqId, loggerOptions, registerRequestLogging } from './core/logger.js';
import { findLogo, SITE_LOCATION, SITE_NAME } from './core/site.js';
import { createDatabase } from './db/index.js';
import { checkInPermissions } from './db/schema/index.js';
import { AGE_GROUP_LABELS } from './shared/registration-pricing.js';
import { seedEvents } from './db/seed-events.js';
import { createMailer } from './modules/survey/mailer.js';
import { IMPORT_MAP_CSP_HASH, surveyRoutes } from './modules/survey/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { findHouseholdSession } from './modules/auth/service.js';
import { registrationRoutes } from './modules/registration/routes.js';
import { messages } from './shared/survey-messages.js';
import { resolveLocale, LANGUAGE_UNAVAILABLE } from './core/locale.js';
import { LOCALES, translatorFor } from './shared/i18n/index.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
const ERROR_VIEW = 'core/views/error.eta';
const NOT_FOUND_MESSAGE = "Sorry, we couldn't find that page.";
const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';
const CLIENT_ERROR_MESSAGE = "Sorry, we couldn't process that request.";

export async function buildApp(config, { database, logStream, logLevel, now, fetchImpl, mailer, imgDir = `${SRC_DIR}public/img`, jwks } = {}) {
  const app = Fastify({
    logger: loggerOptions({ level: logLevel ?? (config.NODE_ENV === 'test' ? 'silent' : 'info'), stream: logStream }),
    genReqId,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
  });
  app.log.info(formatConfig(config));
  if (!turnstileEnabled(config)) app.log.warn(messages.turnstileNotConfigured);
  if (usesTurnstileTestKeys(config)) app.log.warn(messages.turnstileTestKeys);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com', 'https://accounts.google.com/gsi/client', IMPORT_MAP_CSP_HASH],
        frameSrc: ['https://challenges.cloudflare.com', 'https://accounts.google.com/gsi/'],
        connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // Google sign-in opens a popup that must post its result back to this page.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  });
  await app.register(formbody);
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: 60 * 1000,
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({ statusCode: 429, message: messages.tooFast }),
  });
  await app.register(fastifyStatic, { root: `${SRC_DIR}public`, prefix: '/public/' });
  // Browser copies of the shared validation code and its Zod build (see design D2).
  await app.register(fastifyStatic, { root: `${SRC_DIR}shared`, prefix: '/shared/', decorateReply: false });
  await app.register(fastifyStatic, { root: `${SRC_DIR}public/vendor`, prefix: '/vendor/', decorateReply: false });
  const site = { name: SITE_NAME, location: SITE_LOCATION, logo: findLogo(imgDir) };
  await app.register(view, {
    engine: { eta: new Eta() },
    root: SRC_DIR,
    production: config.NODE_ENV === 'production',
    defaultContext: { site },
  });

  app.decorateRequest('siteAccount', null);
  app.decorateRequest('locale', 'en');
  app.decorateRequest('t', function t(key, vars) {
    return translatorFor(this.locale)(key, vars);
  });
  app.decorateRequest('languageUnavailable', false);
  app.addHook('onRequest', async (request, reply) => {
    // Organizer pages stay in English.
    const resolved = request.url.startsWith('/admin') ? { locale: 'en', unavailable: false } : resolveLocale(request, reply, config);
    request.locale = resolved.locale;
    request.languageUnavailable = resolved.unavailable;
    reply.locals = {
      locale: request.locale,
      locales: LOCALES,
      t: (key, vars) => request.t(key, vars),
      esc: escapeHtml,
      languageNotice: request.languageUnavailable ? LANGUAGE_UNAVAILABLE : null,
    };
  });
  app.addHook('onRequest', async (request) => {
    const token = cookieValue(request.headers.cookie, 'pongal_session');
    request.siteAccount = token && database?.db
      ? await findHouseholdSession(database.db, token, now?.() ?? new Date())
      : null;
  });
  app.addHook('preHandler', async (request, reply) => {
    const navCsrfToken = request.method === 'GET'
      ? issueCsrfToken(request, reply, config)
      : cookieValue(request.headers.cookie, CSRF_COOKIE) ?? '';
    const householdId = request.siteAccount?.household?.id;
    const [permission] = householdId && database?.db
      ? await database.db.select({ id: checkInPermissions.id }).from(checkInPermissions)
        .where(and(eq(checkInPermissions.householdId, householdId), isNull(checkInPermissions.revokedAt))).limit(1)
      : [];
    reply.locals = {
      ...reply.locals,
      adminPath: request.url.startsWith('/admin') ? request.url.split('?')[0].replace(/\/$/, '') || '/admin' : null,
      canCheckIn: Boolean(permission),
      ageGroupLabels: AGE_GROUP_LABELS,
      siteAccount: request.siteAccount?.household ?? null,
      navCsrfToken,
    };
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  });
  registerRequestLogging(app);

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).view(ERROR_VIEW, { title: request.t('Page not found'), message: request.t(NOT_FOUND_MESSAGE), requestId: request.id }),
  );

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) request.log.error({ err }, 'Unhandled error');
    let message = request.t(CLIENT_ERROR_MESSAGE);
    if (status === 500) message = request.t(SERVER_ERROR_MESSAGE);
    else if (status === 413) message = messages.tooLarge;
    else if (status === 429) message = request.t(err.message); // set by our rate-limit errorResponseBuilder
    return reply.code(status).view(ERROR_VIEW, { title: request.t('Sorry'), message, requestId: request.id });
  });

  await app.register(healthRoutes, { database });
  await app.register(adminRoutes, { prefix: '/admin', config, jwks, db: database?.db, now });
  // Survey pages need a real database; tests that only exercise the platform pass a ping-only stub.
  if (database?.db) {
    await app.register(authRoutes, { db: database.db, config, jwks, mailer, now });
    await app.register(registrationRoutes, { db: database.db, config, mailer, now });
    await app.register(surveyRoutes, { db: database.db, config, now, fetchImpl, mailer });
  }
  return app;
}

export async function main(env = process.env) {
  const config = loadConfig(env);
  const bootLogger = Fastify({ logger: loggerOptions() }).log;
  const database = await createDatabase(config, bootLogger);
  await database.migrate();
  await seedEvents(database.db, loadEventConfigs(), bootLogger);

  const app = await buildApp(config, { database, mailer: createMailer(config, { logger: bootLogger }) });
  if (database.driver === 'pglite' && config.PGLITE_DATA_DIR && config.BACKUP_DIR) {
    const backups = scheduleBackups({ client: database.client, dir: config.BACKUP_DIR, logger: app.log });
    app.addHook('onClose', async () => backups.stop());
  }
  app.addHook('onClose', async () => database.close());

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => app.close().then(() => process.exit(0)));
  }
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.name === 'ConfigError' ? err.message : `Startup failed: ${err.message}`);
    process.exit(1);
  });
}
