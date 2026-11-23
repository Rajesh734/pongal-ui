import { eq } from 'drizzle-orm';
import { clientIp } from '../../core/abuse.js';
import { CSRF_COOKIE, cookieValue, hasValidCsrfToken, isSameOrigin, issueCsrfToken } from '../../core/csrf.js';
import { findActiveByEmail, normalizeEmail } from '../../db/repos/households.js';
import { householdAuth } from '../../db/schema/index.js';
import { hashPassword, verifyPassword } from './password.js';
import { GoogleCredentialError, verifyGoogleCredential } from './google.js';
import {
  AccountCredentialConflictError,
  createEmailVerificationToken,
  createHouseholdSession,
  createManualHouseholdAuth,
  createOrLinkGoogleHousehold,
  findHouseholdSession,
  revokeHouseholdSession,
  HouseholdProfileValidationError,
  updateHouseholdProfile,
  verifyHouseholdEmail,
} from './service.js';

const VIEWS = 'modules/auth/views';
const SESSION_COOKIE = 'pongal_session';
const SESSION_MAX_AGE = 14 * 24 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sessionCookie(token, config) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${config.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function clearSessionCookie(config) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function verificationUrl(config, token) {
  return new URL(`/auth/verify/${token}`, config.APP_BASE_URL).toString();
}

export async function authRoutes(app, { db, config, jwks, mailer = null, now = () => new Date() } = {}) {
  const authLimit = app.rateLimit({
    max: 10,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({ statusCode: 429, message: 'Too many sign-in attempts. Try again later.' }),
  });
  const googleLoginUri = config.APP_BASE_URL ? new URL('/api/auth/google', config.APP_BASE_URL).toString() : null;

  app.decorateRequest('householdAccount', null);
  app.addHook('onRequest', async (request) => {
    const sessionToken = cookieValue(request.headers.cookie, SESSION_COOKIE);
    request.householdAccount = request.siteAccount ?? (sessionToken ? await findHouseholdSession(db, sessionToken, now()) : null);
  });

  const renderMessage = (reply, title, message, status = 200) =>
    reply.code(status).view(`${VIEWS}/message.eta`, { title, message });

  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST') return;
    if (!isSameOrigin(request, config)) {
      return renderMessage(reply, 'Request blocked', 'We could not verify where this request came from. Please reload the page and try again.', 403);
    }

    if (request.url.split('?')[0] === '/api/auth/google') return;
    if (!hasValidCsrfToken(request)) {
      return renderMessage(reply, 'Request blocked', 'Your form security check expired. Reload the page and try again.', 403);
    }
  });

  app.get('/signup', async (request, reply) => {
    const message = request.query.sent === '1' ? 'Check your email to verify your account.' : request.query.error ?? null;
    return reply.view(`${VIEWS}/signup.eta`, {
      title: 'Sign up',
      message,
      csrfToken: issueCsrfToken(request, reply, config),
      googleClientId: config.GOOGLE_CLIENT_ID ?? null,
      googleLoginUri,
    });
  });

  app.get('/login', async (request, reply) =>
    reply.view(`${VIEWS}/login.eta`, {
      title: 'Sign in',
      message: request.query.message ?? null,
      csrfToken: issueCsrfToken(request, reply, config),
      googleClientId: config.GOOGLE_CLIENT_ID ?? null,
      googleLoginUri,
    }),
  );

  app.post('/api/auth/signup', { onRequest: authLimit }, async (request, reply) => {
    const firstName = typeof request.body?.firstName === 'string' ? request.body.firstName.trim() : '';
    const lastName = typeof request.body?.lastName === 'string' ? request.body.lastName.trim() : '';
    const name = `${firstName} ${lastName}`.trim();
    const email = typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (firstName.length < 1 || firstName.length > 75 || lastName.length < 1 || lastName.length > 75
      || /[\u0000-\u001f\u007f]/.test(name) || email.length > 254 || !EMAIL_PATTERN.test(email)
      || password.length < 8 || password.length > 256) {
      return renderMessage(reply, 'Sign-up details need attention', 'Enter your first and last name, a valid email address, and a password of at least 8 characters.', 400);
    }
    if (!config.APP_BASE_URL) {
      return renderMessage(reply, 'Email verification unavailable', 'The app URL is not configured, so a verification link cannot be created. Contact the organizers.', 503);
    }
    if (!mailer?.sendVerificationEmail) {
      return renderMessage(reply, 'Email verification unavailable', 'Email delivery is not configured. Contact the organizers to complete sign-up.', 503);
    }

    try {
      const { household } = await createManualHouseholdAuth(db, { email, name, passwordHash: await hashPassword(password) });
      const { token } = await createEmailVerificationToken(db, household.id, now());
      const sent = await mailer.sendVerificationEmail({ to: email, link: verificationUrl(config, token) });
      if (!sent) return renderMessage(reply, 'Email verification unavailable', 'We could not send the verification email. Please try again later or contact the organizers.', 503);
      return reply.redirect('/signup?sent=1', 303);
    } catch (error) {
      if (error instanceof AccountCredentialConflictError) {
        return renderMessage(reply, 'Account may already exist', 'An account for this email may already exist. Try signing in.', 409);
      }
      throw error;
    }
  });

  app.get('/auth/verify/:token', async (request, reply) => {
    const verified = await verifyHouseholdEmail(db, request.params.token, now());
    return verified
      ? renderMessage(reply, 'Email verified', 'Your email is verified. You can now access your household account.')
      : renderMessage(reply, 'Verification link expired', 'This verification link is no longer valid. Request a new link.', 400);
  });

  app.post('/api/auth/google', { onRequest: authLimit }, async (request, reply) => {
    const csrfCookie = cookieValue(request.headers.cookie, 'g_csrf_token');
    if (!csrfCookie || csrfCookie !== request.body?.g_csrf_token) {
      return renderMessage(reply, 'Google sign-in failed', "We couldn't verify your Google sign-in. Please try again.", 400);
    }
    if (!config.GOOGLE_CLIENT_ID) {
      return renderMessage(reply, 'Google sign-in unavailable', 'Google sign-in is temporarily unavailable.', 503);
    }

    try {
      const profile = await verifyGoogleCredential(request.body?.credential, config.GOOGLE_CLIENT_ID, { jwks });
      const { household } = await createOrLinkGoogleHousehold(db, profile, now());
      const { token } = await createHouseholdSession(db, household.id, now());
      reply.header('set-cookie', sessionCookie(token, config));
      return reply.redirect('/', 303);
    } catch (error) {
      if (error instanceof GoogleCredentialError) {
        return renderMessage(reply, 'Google sign-in failed', "We couldn't verify your Google account. Try another sign-in method.", 401);
      }
      if (error instanceof AccountCredentialConflictError) {
        return renderMessage(reply, 'Google sign-in failed', 'This Google account cannot be linked to the household.', 409);
      }
      throw error;
    }
  });

  app.post('/api/auth/login', { onRequest: authLimit }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const household = email ? await findActiveByEmail(db, email) : null;
    const [auth] = household ? await db.select().from(householdAuth).where(eq(householdAuth.householdId, household.id)) : [];
    const valid = Boolean(auth?.emailVerifiedAt && auth.passwordHash && password && await verifyPassword(password, auth.passwordHash));
    if (!valid) return renderMessage(reply, 'Sign-in failed', 'Invalid email or password.', 401);

    const { token } = await createHouseholdSession(db, household.id, now());
    reply.header('set-cookie', sessionCookie(token, config));
    return reply.redirect('/', 303);
  });

  app.post('/api/auth/logout', { onRequest: authLimit }, async (request, reply) => {
    await revokeHouseholdSession(db, cookieValue(request.headers.cookie, SESSION_COOKIE), now());
    reply.header('set-cookie', clearSessionCookie(config));
    return reply.redirect('/', 303);
  });

  app.get('/account/profile', async (request, reply) => {
    if (!request.householdAccount) {
      return reply.redirect(`/login?message=${encodeURIComponent('Sign in to view your household profile.')}`, 303);
    }
    return reply.view(`${VIEWS}/profile.eta`, {
      title: 'Household profile',
      household: request.householdAccount.household,
      message: request.query.saved === '1' ? 'Profile updated.' : null,
      csrfToken: issueCsrfToken(request, reply, config),
    });
  });

  app.post('/api/auth/profile', { onRequest: authLimit }, async (request, reply) => {
    if (!request.householdAccount) return reply.redirect('/login', 303);
    const body = request.body ?? {};
    const consent = body.whatsappConsent === 'yes' || body.whatsappConsent === true;
    try {
      await updateHouseholdProfile(db, request.householdAccount.household.id, {
        name: body.name,
        mobileE164: body.mobileE164,
        whatsappE164: body.whatsappE164,
        whatsappConsent: consent,
      }, now());
      return reply.redirect('/account/profile?saved=1', 303);
    } catch (error) {
      if (error instanceof HouseholdProfileValidationError) {
        return reply.code(400).view(`${VIEWS}/profile.eta`, {
          title: 'Household profile',
          household: { ...request.householdAccount.household, ...body },
          message: error.message,
          csrfToken: body._csrf,
        });
      }
      throw error;
    }
  });
}