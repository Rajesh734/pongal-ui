import { randomBytes } from 'node:crypto';

export const CSRF_COOKIE = 'pongal_csrf';

export function cookieValue(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export function issueCsrfToken(request, reply, config) {
  if (request.csrfToken) return request.csrfToken;
  const existing = cookieValue(request.headers.cookie, CSRF_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) {
    request.csrfToken = existing;
    return existing;
  }
  const token = randomBytes(32).toString('base64url');
  request.csrfToken = token;
  reply.header(
    'set-cookie',
    `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${config.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return token;
}

export function isSameOrigin(request, config) {
  const origin = request.headers.origin;
  const source = origin && origin !== 'null' ? origin : request.headers.referer;
  let sourceOrigin;
  try {
    sourceOrigin = source ? new URL(source).origin : null;
  } catch {
    sourceOrigin = null;
  }
  const allowedOrigins = new Set(config.APP_BASE_URL ? [new URL(config.APP_BASE_URL).origin] : []);
  if (config.NODE_ENV !== 'production') {
    allowedOrigins.add(`http://localhost:${config.PORT}`);
    allowedOrigins.add(`http://127.0.0.1:${config.PORT}`);
  }
  if (sourceOrigin) return allowedOrigins.has(sourceOrigin);
  if (origin !== 'null' || request.headers['sec-fetch-site'] !== 'same-origin') return false;
  return allowedOrigins.has(`${request.protocol}://${request.headers.host}`);
}

export function hasValidCsrfToken(request) {
  const cookieToken = cookieValue(request.headers.cookie, CSRF_COOKIE);
  return Boolean(cookieToken && cookieToken === request.body?._csrf);
}