import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { inTransaction, writeHistory } from '../../db/history.js';
import { emailVerificationTokens, householdAuth, householdSessions, households, passwordResetTokens } from '../../db/schema/index.js';
import { normalizeEmail } from '../../db/repos/households.js';

export class AccountCredentialConflictError extends Error {
  constructor() {
    super('Account credentials conflict');
    this.name = 'AccountCredentialConflictError';
  }
}

export class HouseholdProfileValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HouseholdProfileValidationError';
  }
}

async function findOrCreateHousehold(tx, { email, name }, actor) {
  let [household] = await tx
    .select()
    .from(households)
    .where(and(eq(households.email, email), isNull(households.deletedAt)));

  if (!household) {
    [household] = await tx.insert(households).values({ email, name: name || email }).returning();
    await writeHistory(tx, 'household', household.id, 'create', household, actor);
  }
  return household;
}

export function createOrLinkGoogleHousehold(db, profile, now = new Date()) {
  const email = normalizeEmail(profile.email);
  return inTransaction(db, async (tx) => {
    const household = await findOrCreateHousehold(tx, { email, name: profile.name }, 'google');
    const [existingAuth] = await tx.select().from(householdAuth).where(eq(householdAuth.householdId, household.id));

    if (existingAuth?.googleSub && existingAuth.googleSub !== profile.sub) throw new AccountCredentialConflictError();

    let auth;
    if (existingAuth) {
      [auth] = await tx
        .update(householdAuth)
        .set({ googleSub: profile.sub, emailVerifiedAt: existingAuth.emailVerifiedAt ?? now, updatedAt: now })
        .where(eq(householdAuth.householdId, household.id))
        .returning();
      await writeHistory(tx, 'household_auth', household.id, 'update', auth, 'google');
    } else {
      [auth] = await tx
        .insert(householdAuth)
        .values({ householdId: household.id, googleSub: profile.sub, emailVerifiedAt: now })
        .returning();
      await writeHistory(tx, 'household_auth', household.id, 'create', auth, 'google');
    }

    return { household, auth };
  });
}

export function createManualHouseholdAuth(db, { email: rawEmail, name, passwordHash }) {
  const email = normalizeEmail(rawEmail);
  return inTransaction(db, async (tx) => {
    const household = await findOrCreateHousehold(tx, { email, name }, 'signup');
    const [existingAuth] = await tx.select().from(householdAuth).where(eq(householdAuth.householdId, household.id));
    if (existingAuth) throw new AccountCredentialConflictError();

    const [auth] = await tx.insert(householdAuth).values({ householdId: household.id, passwordHash }).returning();
    await writeHistory(tx, 'household_auth', household.id, 'create', auth, 'signup');
    return { household, auth };
  });
}

export function createEmailVerificationToken(db, householdId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return inTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(emailVerificationTokens)
      .values({ householdId, tokenHash, expiresAt, createdAt: now })
      .returning();
    await writeHistory(tx, 'email_verification_token', row.id, 'create', { householdId, expiresAt }, 'system');
    return { token, expiresAt };
  });
}

export function verifyHouseholdEmail(db, rawToken, now = new Date()) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return Promise.resolve(null);
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return inTransaction(db, async (tx) => {
    const [token] = await tx
      .select()
      .from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.tokenHash, tokenHash), isNull(emailVerificationTokens.consumedAt), gt(emailVerificationTokens.expiresAt, now)));
    if (!token) return null;

    const [auth] = await tx.select().from(householdAuth).where(eq(householdAuth.householdId, token.householdId));
    if (!auth) return null;

    const [consumedToken] = await tx
      .update(emailVerificationTokens)
      .set({ consumedAt: now })
      .where(eq(emailVerificationTokens.id, token.id))
      .returning();
    const [verifiedAuth] = await tx
      .update(householdAuth)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(householdAuth.householdId, token.householdId))
      .returning();
    await writeHistory(tx, 'email_verification_token', consumedToken.id, 'update', { consumedAt: now }, 'email_verification');
    await writeHistory(tx, 'household_auth', verifiedAuth.householdId, 'update', verifiedAuth, 'email_verification');
    return verifiedAuth;
  });
}

export function createPasswordResetToken(db, householdId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  return inTransaction(db, async (tx) => {
    const [row] = await tx.insert(passwordResetTokens).values({ householdId, tokenHash, expiresAt, createdAt: now }).returning();
    await writeHistory(tx, 'password_reset_token', row.id, 'create', { householdId, expiresAt }, 'system');
    return { token, expiresAt };
  });
}

function passwordResetTokenHash(rawToken) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  return createHash('sha256').update(rawToken).digest('hex');
}

export async function findPasswordResetToken(db, rawToken, now = new Date()) {
  const tokenHash = passwordResetTokenHash(rawToken);
  if (!tokenHash) return null;
  const [token] = await db.select().from(passwordResetTokens).where(and(
    eq(passwordResetTokens.tokenHash, tokenHash),
    isNull(passwordResetTokens.consumedAt),
    gt(passwordResetTokens.expiresAt, now),
  ));
  if (!token) return null;
  const [[household], [auth]] = await Promise.all([
    db.select().from(households).where(and(eq(households.id, token.householdId), isNull(households.deletedAt))),
    db.select().from(householdAuth).where(eq(householdAuth.householdId, token.householdId)),
  ]);
  return household && auth ? { token, household, auth } : null;
}

export function resetHouseholdPassword(db, rawToken, passwordHash, now = new Date()) {
  const tokenHash = passwordResetTokenHash(rawToken);
  if (!tokenHash) return Promise.resolve(null);
  return inTransaction(db, async (tx) => {
    const [token] = await tx.select().from(passwordResetTokens).where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      isNull(passwordResetTokens.consumedAt),
      gt(passwordResetTokens.expiresAt, now),
    ));
    if (!token) return null;
    const [auth] = await tx.select().from(householdAuth).where(eq(householdAuth.householdId, token.householdId));
    if (!auth?.passwordHash) return { googleOnly: Boolean(auth?.googleSub) };
    const [updatedAuth] = await tx.update(householdAuth)
      .set({ passwordHash, updatedAt: now })
      .where(eq(householdAuth.householdId, token.householdId))
      .returning();
    const [consumedToken] = await tx.update(passwordResetTokens)
      .set({ consumedAt: now })
      .where(eq(passwordResetTokens.id, token.id))
      .returning();
    await writeHistory(tx, 'password_reset_token', consumedToken.id, 'update', { consumedAt: now }, 'password_reset');
    await writeHistory(tx, 'household_auth', updatedAuth.householdId, 'update', updatedAuth, 'password_reset');
    return updatedAuth;
  });
}

export function createHouseholdSession(db, householdId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  return inTransaction(db, async (tx) => {
    const [session] = await tx
      .insert(householdSessions)
      .values({ householdId, tokenHash, expiresAt, createdAt: now })
      .returning();
    await writeHistory(tx, 'household_session', session.id, 'create', { householdId, expiresAt }, 'system');
    return { token, expiresAt };
  });
}

export async function findHouseholdSession(db, rawToken, now = new Date()) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const [session] = await db
    .select()
    .from(householdSessions)
    .where(and(eq(householdSessions.tokenHash, tokenHash), isNull(householdSessions.revokedAt), gt(householdSessions.expiresAt, now)));
  if (!session) return null;

  const [[household], [auth]] = await Promise.all([
    db.select().from(households).where(and(eq(households.id, session.householdId), isNull(households.deletedAt))),
    db.select().from(householdAuth).where(eq(householdAuth.householdId, session.householdId)),
  ]);
  if (!household || !auth?.emailVerifiedAt) return null;
  return { household, auth, session };
}

export function revokeHouseholdSession(db, rawToken, now = new Date()) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return Promise.resolve(false);
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return inTransaction(db, async (tx) => {
    const [session] = await tx
      .update(householdSessions)
      .set({ revokedAt: now })
      .where(and(eq(householdSessions.tokenHash, tokenHash), isNull(householdSessions.revokedAt)))
      .returning();
    if (!session) return false;
    await writeHistory(tx, 'household_session', session.id, 'update', { householdId: session.householdId, revokedAt: now }, 'logout');
    return true;
  });
}

export function updateHouseholdProfile(db, householdId, { name, mobileE164, whatsappE164, whatsappConsent }, now = new Date()) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (cleanName.length < 2 || cleanName.length > 150) throw new HouseholdProfileValidationError('Enter a name between 2 and 150 characters.');
  if (typeof mobileE164 !== 'string' || !/^\+[1-9][0-9]{10,12}$/.test(mobileE164)) {
    throw new HouseholdProfileValidationError('Enter a country code and a 10-digit mobile number.');
  }
  const cleanWhatsapp = typeof whatsappE164 === 'string' ? whatsappE164.trim() : '';
  if (cleanWhatsapp && (!/^\+[1-9][0-9]{10,12}$/.test(cleanWhatsapp) || whatsappConsent !== true)) {
    throw new HouseholdProfileValidationError('Enter a country code and a 10-digit WhatsApp number, and agree to event-related WhatsApp contact.');
  }

  return inTransaction(db, async (tx) => {
    const [household] = await tx
      .update(households)
      .set({
        name: cleanName,
        mobileE164,
        whatsappE164: cleanWhatsapp || null,
        whatsappConsentAt: cleanWhatsapp ? now : null,
        updatedAt: now,
      })
      .where(and(eq(households.id, householdId), isNull(households.deletedAt)))
      .returning();
    if (!household) return null;
    await writeHistory(tx, 'household', household.id, 'update', household, 'household');
    return household;
  });
}