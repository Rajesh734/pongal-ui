import { randomUUID } from 'node:crypto';

/** Fastify logger options: request lines carry only reqId, method, route pattern, status and duration. */
export function loggerOptions({ level = 'info', stream } = {}) {
  return {
    level,
    ...(stream ? { stream } : {}),
    serializers: {
      req: (req) => ({ method: req.method, route: req.routeOptions?.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  };
}

export const genReqId = () => randomUUID();

export function registerRequestLogging(app) {
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? '(not found)',
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });
}
