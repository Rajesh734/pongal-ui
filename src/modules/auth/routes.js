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
  createPasswordResetToken,
  createHouseholdSession,
  createManualHouseholdAuth,
  createOrLinkGoogleHousehold,
  findHouseholdSession,
  findPasswordResetToken,
  resetHouseholdPassword,
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

function passwordResetUrl(config, token) {
  return new URL(`/auth/reset-password/${token}`, config.APP_BASE_URL).toString();
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
    reply.code(status).view(`${VIEWS}/message.eta`, { title: reply.request.t(title), message: reply.request.t(message) });

  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST') return;
    // Google's redirect mode posts from accounts.google.com; the route verifies g_csrf_token and the ID token instead.
    if (request.url.split('?')[0] === '/api/auth/google') return;
    if (!isSameOrigin(request, config)) {
      request.log.warn({ origin: request.headers.origin ?? null, expected: config.APP_BASE_URL ?? null }, 'Blocked form post: origin does not match APP_BASE_URL');
      return renderMessage(reply, 'Request blocked', 'We could not verify where this request came from. Please reload the page and try again.', 403);
    }

    if (!hasValidCsrfToken(request)) {
      return renderMessage(reply, 'Request blocked', 'Your form security check expired. Reload the page and try again.', 403);
    }
  });

  app.get('/signup', async (request, reply) => {
    const message = request.query.sent === '1' ? request.t('Check your email to verify your account.') : request.query.error ?? null;
    return reply.view(`${VIEWS}/signup.eta`, {
      title: request.t('Sign up'),
      message,
      csrfToken: issueCsrfToken(request, reply, config),
      googleClientId: config.GOOGLE_CLIENT_ID ?? null,
      googleLoginUri,
    });
  });

  app.get('/login', async (request, reply) =>
    reply.view(`${VIEWS}/login.eta`, {
      title: request.t('Sign in'),
      message: request.query.message ? request.t(request.query.message) : null,
      csrfToken: issueCsrfToken(request, reply, config),
      googleClientId: config.GOOGLE_CLIENT_ID ?? null,
      googleLoginUri,
    }),
  );

  app.get('/forgot-password', async (request, reply) =>
    reply.view(`${VIEWS}/forgot-password.eta`, {
      title: request.t('Forgot password'),
      message: request.query.sent === '1' ? request.t('Check your email for a password reset link.') : null,
      csrfToken: issueCsrfToken(request, reply, config),
    }),
  );

  app.post('/api/auth/forgot-password', { onRequest: authLimit }, async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : '';
    const household = email ? await findActiveByEmail(db, email) : null;
    const [auth] = household ? await db.select().from(householdAuth).where(eq(householdAuth.householdId, household.id)) : [];
    if (auth?.googleSub && !auth.passwordHash) {
      return renderMessage(reply, 'Use Google to sign in', 'This household account was created with Google. Please use Google to sign in instead of resetting a password.');
    }
    if (!household || !auth?.passwordHash || !config.APP_BASE_URL || !mailer?.sendPasswordResetEmail) {
      return reply.redirect('/forgot-password?sent=1', 303);
    }
    const { token } = await createPasswordResetToken(db, household.id, now());
    const sent = await mailer.sendPasswordResetEmail({ to: household.email, link: passwordResetUrl(config, token), t: (key, vars) => request.t(key, vars) });
    return sent ? reply.redirect('/forgot-password?sent=1', 303) : renderMessage(reply, 'Password reset unavailable', 'We could not send the password reset email. Please try again later or contact the organizers.', 503);
  });

  app.get('/auth/reset-password/:token', async (request, reply) => {
    const reset = await findPasswordResetToken(db, request.params.token, now());
    if (!reset) return renderMessage(reply, 'Password reset link expired', 'This password reset link is no longer valid. Request a new link.', 400);
    if (reset.auth.googleSub && !reset.auth.passwordHash) return renderMessage(reply, 'Use Google to sign in', 'This household account was created with Google. Please use Google to sign in instead of resetting a password.');
    return reply.view(`${VIEWS}/reset-password.eta`, {
      title: request.t('Reset password'),
      token: request.params.token,
      csrfToken: issueCsrfToken(request, reply, config),
      message: null,
    });
  });

  app.post('/api/auth/reset-password', { onRequest: authLimit }, async (request, reply) => {
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (password.length < 8 || password.length > 256) return renderMessage(reply, 'Password reset needs attention', 'Your password must be between 8 and 256 characters.', 400);
    const reset = await findPasswordResetToken(db, request.body?.token, now());
    if (!reset) return renderMessage(reply, 'Password reset link expired', 'This password reset link is no longer valid. Request a new link.', 400);
    if (reset.auth.googleSub && !reset.auth.passwordHash) return renderMessage(reply, 'Use Google to sign in', 'This household account was created with Google. Please use Google to sign in instead of resetting a password.');
    await resetHouseholdPassword(db, request.body?.token, await hashPassword(password), now());
    return renderMessage(reply, 'Password updated', 'Your password has been updated. You can now sign in.');
  });

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
      const sent = await mailer.sendVerificationEmail({ to: email, link: verificationUrl(config, token), t: (key, vars) => request.t(key, vars) });
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
      title: request.t('Household profile'),
      household: request.householdAccount.household,
      message: request.query.saved === '1' ? request.t('Profile updated.') : null,
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
          title: request.t('Household profile'),
          household: { ...request.householdAccount.household, ...body },
          message: request.t(error.message),
          csrfToken: body._csrf,
        });
      }
      throw error;
    }
  });
}