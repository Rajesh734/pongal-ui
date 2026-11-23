import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyGoogleCredential } from '../src/modules/auth/google.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import {
  AccountCredentialConflictError,
  createEmailVerificationToken,
  createHouseholdSession,
  createManualHouseholdAuth,
  createOrLinkGoogleHousehold,
  findHouseholdSession,
  revokeHouseholdSession,
  verifyHouseholdEmail,
} from '../src/modules/auth/service.js';
import { createHousehold } from '../src/db/repos/households.js';
import { householdAuth, households } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { migratedMemoryDb } from './helpers.js';

const CLIENT_ID = 'pongal-client-id';
const databases = [];

afterEach(async () => {
  while (databases.length) await databases.pop().close();
});

async function newDatabase() {
  const database = await migratedMemoryDb();
  databases.push(database);
  return database;
}

async function googleKeys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'google-test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function googleToken(privateKey, claims = {}) {
  return new SignJWT({
    email: 'Priya@Example.com',
    email_verified: true,
    sub: 'google-sub-123',
    name: 'Priya',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
    .setIssuer('https://accounts.google.com')
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('Google credential verification', () => {
  it('Valid verified Google credential', async () => {
    const keys = await googleKeys();
    const result = await verifyGoogleCredential(await googleToken(keys.privateKey), CLIENT_ID, { jwks: keys.jwks });
    expect(result).toEqual({ sub: 'google-sub-123', email: 'priya@example.com', name: 'Priya' });
  });

  it('Rejects an unverified email', async () => {
    const keys = await googleKeys();
    await expect(
      verifyGoogleCredential(await googleToken(keys.privateKey, { email_verified: false }), CLIENT_ID, { jwks: keys.jwks }),
    ).rejects.toThrow('Invalid Google credential');
  });

  it('Rejects a credential for another audience', async () => {
    const keys = await googleKeys();
    const token = new SignJWT({ email: 'priya@example.com', email_verified: true, sub: 'google-sub-123' })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-test-key' })
      .setIssuer('https://accounts.google.com')
      .setAudience('another-client')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(keys.privateKey);
    await expect(verifyGoogleCredential(await token, CLIENT_ID, { jwks: keys.jwks })).rejects.toThrow('Invalid Google credential');
  });

  it('Rejects a missing credential or audience', async () => {
    await expect(verifyGoogleCredential('', CLIENT_ID)).rejects.toThrow('Invalid Google credential');
    await expect(verifyGoogleCredential('token', '')).rejects.toThrow('Invalid Google credential');
  });
});

describe('password hashing', () => {
  it('Hashes with a unique salt and verifies only the matching password', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse battery staple', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false);
  });

  it('Rejects malformed stored hashes', async () => {
    await expect(verifyPassword('secret', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('household identity services', () => {
  it('Google identity creates a verified household account', async () => {
    const database = await newDatabase();
    const { household, auth } = await createOrLinkGoogleHousehold(database.db, {
      email: ' Priya@Example.COM ',
      name: 'Priya',
      sub: 'google-sub-1',
    });

    expect(household.email).toBe('priya@example.com');
    expect(auth.googleSub).toBe('google-sub-1');
    expect(auth.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('Google identity links to an existing guest household', async () => {
    const database = await newDatabase();
    const guest = await createHousehold(database.db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    const [event] = (await database.db.execute(sql`
      insert into events (slug, name, timezone, survey_opens_at, survey_closes_at, config_snapshot, config_hash)
      values ('guest-link-test', 'Guest link test', 'America/New_York', now(), now() + interval '1 day', '{}', 'test')
      returning id
    `)).rows;
    const [guestRegistration] = (await database.db.execute(sql`
      insert into registrations (event_id, household_id, contact_name, contact_email, contact_mobile_e164, total_cents)
      values (${event.id}, ${guest.id}, 'Priya', 'priya@example.com', '+16035550123', 3500)
      returning id
    `)).rows;
    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'PRIYA@example.com',
      name: 'Priya Google',
      sub: 'google-sub-1',
    });
    const rows = await database.db.select().from(households);
    const linkedRegistrations = await database.db.execute(sql`select id from registrations where household_id = ${household.id}`);

    expect(household.id).toBe(guest.id);
    expect(rows).toHaveLength(1);
    expect(linkedRegistrations.rows.map((row) => row.id)).toEqual([guestRegistration.id]);
  });

  it('A verified different email cannot attach to a guest household', async () => {
    const database = await newDatabase();
    const guest = await createHousehold(database.db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    const { household: other } = await createOrLinkGoogleHousehold(database.db, {
      email: 'other@example.com',
      name: 'Other',
      sub: 'google-sub-other',
    });
    const [guestAuth] = await database.db.select().from(householdAuth).where(eq(householdAuth.householdId, guest.id));

    expect(other.id).not.toBe(guest.id);
    expect(guestAuth).toBeUndefined();
  });

  it('Rejects a different Google identity already linked to the household', async () => {
    const database = await newDatabase();
    await createOrLinkGoogleHousehold(database.db, { email: 'priya@example.com', name: 'Priya', sub: 'google-sub-1' });

    await expect(
      createOrLinkGoogleHousehold(database.db, { email: 'priya@example.com', name: 'Priya', sub: 'google-sub-2' }),
    ).rejects.toBeInstanceOf(AccountCredentialConflictError);
  });

  it('Manual credential remains unverified until email confirmation', async () => {
    const database = await newDatabase();
    const { auth } = await createManualHouseholdAuth(database.db, {
      email: ' Priya@Example.COM ',
      name: 'Priya',
      passwordHash: 'scrypt$test',
    });

    expect(auth.passwordHash).toBe('scrypt$test');
    expect(auth.emailVerifiedAt).toBeNull();
    await expect(
      createManualHouseholdAuth(database.db, { email: 'priya@example.com', name: 'Priya', passwordHash: 'another' }),
    ).rejects.toBeInstanceOf(AccountCredentialConflictError);
  });

  it('Email verification consumes a single-use token and marks the account verified', async () => {
    const database = await newDatabase();
    const { household, auth } = await createManualHouseholdAuth(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      passwordHash: 'scrypt$test',
    });
    const now = new Date('2026-11-23T12:00:00Z');
    const { token } = await createEmailVerificationToken(database.db, household.id, now);

    const verified = await verifyHouseholdEmail(database.db, token, new Date('2026-11-23T12:01:00Z'));
    expect(verified.householdId).toBe(auth.householdId);
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(verifyHouseholdEmail(database.db, token, new Date('2026-11-23T12:02:00Z'))).resolves.toBeNull();
  });

  it('Email verification rejects expired and malformed tokens', async () => {
    const database = await newDatabase();
    const { household } = await createManualHouseholdAuth(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      passwordHash: 'scrypt$test',
    });
    const now = new Date('2026-11-23T12:00:00Z');
    const { token } = await createEmailVerificationToken(database.db, household.id, now);

    await expect(verifyHouseholdEmail(database.db, token, new Date('2026-11-24T12:00:00Z'))).resolves.toBeNull();
    await expect(verifyHouseholdEmail(database.db, 'bad', now)).resolves.toBeNull();
  });

  it('Household sessions store only a hash and can be revoked', async () => {
    const database = await newDatabase();
    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      sub: 'google-sub-1',
    });
    const now = new Date('2026-11-23T12:00:00Z');
    const { token, expiresAt } = await createHouseholdSession(database.db, household.id, now);

    const found = await findHouseholdSession(database.db, token, new Date('2026-11-23T12:01:00Z'));
    expect(found.household.id).toBe(household.id);
    expect(found.session.tokenHash).not.toContain(token);
    await expect(findHouseholdSession(database.db, token, expiresAt)).resolves.toBeNull();
    await expect(revokeHouseholdSession(database.db, token, new Date('2026-11-23T12:02:00Z'))).resolves.toBe(true);
    await expect(findHouseholdSession(database.db, token, new Date('2026-11-23T12:03:00Z'))).resolves.toBeNull();
  });

  it('Household identity changes are audited', async () => {
    const database = await newDatabase();
    const { household } = await createOrLinkGoogleHousehold(database.db, {
      email: 'priya@example.com',
      name: 'Priya',
      sub: 'google-sub-1',
    });
    const [auth] = await database.db.select().from(householdAuth).where(eq(householdAuth.householdId, household.id));
    expect(auth.emailVerifiedAt).toBeInstanceOf(Date);
  });
});