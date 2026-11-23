import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ADMIN_ACCESS_DENIED = "You don't have access to this page.";
export const ADMIN_ACCESS_UNAVAILABLE = 'Admin sign-in check is temporarily unavailable. Please try again in a minute.';
export const ADMIN_DISABLED_WARNING = 'Admin pages are disabled: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set.';

export class AdminAccessError extends Error {
  constructor(statusCode, message, reason = null) {
    super(message);
    this.name = 'AdminAccessError';
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

function isJwksUnavailable(error) {
  return error instanceof TypeError || error?.code === 'ERR_JWKS_TIMEOUT';
}

export function createAdminVerifier(config, { jwks } = {}) {
  const teamDomain = config.CF_ACCESS_TEAM_DOMAIN?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const audience = config.CF_ACCESS_AUD;
  if (!teamDomain || !audience) return null;

  const issuer = `https://${teamDomain}`;
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
    cooldownDuration: 60_000,
    timeoutDuration: 5_000,
  });

  return async (request) => {
    const token = request.headers['cf-access-jwt-assertion'];
    if (!token) throw new AdminAccessError(403, ADMIN_ACCESS_DENIED, 'no Cf-Access-Jwt-Assertion header (Cloudflare Access is not protecting this hostname/path)');

    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer,
        audience,
        algorithms: ['RS256'],
      });
      if (typeof payload.email !== 'string' || payload.email.length === 0) {
        throw new AdminAccessError(403, ADMIN_ACCESS_DENIED, 'token has no email claim (service token or IdP without email)');
      }
      request.adminEmail = payload.email;
    } catch (error) {
      if (error instanceof AdminAccessError) throw error;
      if (isJwksUnavailable(error)) throw new AdminAccessError(503, ADMIN_ACCESS_UNAVAILABLE, 'could not fetch Cloudflare Access signing keys');
      const reason = error?.claim === 'aud'
        ? 'audience mismatch: CF_ACCESS_AUD is not the AUD tag of the Access application for this hostname/path'
        : error?.claim === 'iss'
          ? `issuer mismatch: token was not issued by ${issuer} (check CF_ACCESS_TEAM_DOMAIN)`
          : `token rejected (${error?.code ?? 'unknown'})`;
      throw new AdminAccessError(403, ADMIN_ACCESS_DENIED, reason);
    }
  };
}