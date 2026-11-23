import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class GoogleCredentialError extends Error {
  constructor() {
    super('Invalid Google credential');
    this.name = 'GoogleCredentialError';
  }
}

export async function verifyGoogleCredential(credential, audience, { jwks } = {}) {
  if (typeof credential !== 'string' || !credential || !audience) throw new GoogleCredentialError();
  const keySet = jwks ?? createRemoteJWKSet(GOOGLE_JWKS_URL, { cooldownDuration: 60_000, timeoutDuration: 5_000 });

  try {
    const { payload } = await jwtVerify(credential, keySet, {
      algorithms: ['RS256'],
      audience,
      issuer: GOOGLE_ISSUERS,
    });
    if (payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string') {
      throw new GoogleCredentialError();
    }
    return {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: typeof payload.name === 'string' ? payload.name.trim() : '',
    };
  } catch {
    throw new GoogleCredentialError();
  }
}