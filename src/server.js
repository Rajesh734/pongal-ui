import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify, { LogController } from 'fastify';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import view from '@fastify/view';
import { Eta } from 'eta';
import { formatConfig, loadConfig } from './config.js';
import { clientIp, turnstileEnabled } from './core/abuse.js';
import { scheduleBackups } from './core/backup.js';
import { loadEventConfigs } from './core/event-config.js';
import { healthRoutes } from './core/health.js';
import { genReqId, loggerOptions, registerRequestLogging } from './core/logger.js';
import { createDatabase } from './db/index.js';
import { seedEvents } from './db/seed-events.js';
import { createMailer } from './modules/survey/mailer.js';
import { IMPORT_MAP_CSP_HASH, surveyRoutes } from './modules/survey/routes.js';
import { messages } from './shared/survey-messages.js';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
const ERROR_VIEW = 'core/views/error.eta';
const NOT_FOUND_MESSAGE = "Sorry, we couldn't find that page.";
const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again in a few minutes.';
const CLIENT_ERROR_MESSAGE = "Sorry, we couldn't process that request.";

export async function buildApp(config, { database, logStream, logLevel, now, fetchImpl, mailer } = {}) {
  const app = Fastify({
    logger: loggerOptions({ level: logLevel ?? (config.NODE_ENV === 'test' ? 'silent' : 'info'), stream: logStream }),
    genReqId,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: true,
  });
  app.log.info(formatConfig(config));
  if (!turnstileEnabled(config)) app.log.warn(messages.turnstileNotConfigured);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com', IMPORT_MAP_CSP_HASH],
        frameSrc: ['https://challenges.cloudflare.com'],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
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
  await app.register(view, { engine: { eta: new Eta() }, root: SRC_DIR, production: config.NODE_ENV === 'production' });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
  });
  registerRequestLogging(app);

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).view(ERROR_VIEW, { title: 'Page not found', message: NOT_FOUND_MESSAGE, requestId: request.id }),
  );

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) request.log.error({ err }, 'Unhandled error');
    let message = CLIENT_ERROR_MESSAGE;
    if (status === 500) message = SERVER_ERROR_MESSAGE;
    else if (status === 413) message = messages.tooLarge;
    else if (status === 429) message = err.message; // set by our rate-limit errorResponseBuilder
    return reply.code(status).view(ERROR_VIEW, { title: 'Sorry', message, requestId: request.id });
  });

  await app.register(healthRoutes, { database });
  // Survey pages need a real database; tests that only exercise the platform pass a ping-only stub.
  if (database?.db) {
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
