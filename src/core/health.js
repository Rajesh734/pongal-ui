export async function healthRoutes(app, { database }) {
  app.get('/healthz', async (request, reply) => {
    try {
      await database.ping();
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      request.log.error(`Health check database query failed: ${err.message}`);
      return reply.code(503).send({ status: 'error', db: 'unavailable' });
    }
  });

  app.get('/robots.txt', async (request, reply) => reply.type('text/plain; charset=utf-8').send('User-agent: *\nDisallow: /'));
}
