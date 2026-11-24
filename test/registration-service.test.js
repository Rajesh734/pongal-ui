import { afterEach, describe, expect, it } from 'vitest';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { changeHistory, households, registrationAccessTokens, registrationPayments, registrations } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';
import { buildRegistrationSchema, validateRegistration } from '../src/shared/registration-schema.js';
import { createRegistration, findRegistrationByAccessToken, RegistrationConflictError, RegistrationOwnershipError, updateRegistration } from '../src/modules/registration/service.js';
import {
  confirmRegistrationPayment,
  createRegistration,
  findRegistrationByAccessToken,
  RegistrationConflictError,
  RegistrationOwnershipError,
  updateRegistration,
} from '../src/modules/registration/service.js';
import { revealProtectedPass } from '../src/modules/registration/pass-tokens.js';
import { migratedMemoryDb } from './helpers.js';

const databases = [];
const now = new Date('2026-11-23T12:00:00Z');

afterEach(async () => {
  while (databases.length) await databases.pop().close();
});

async function setup() {
  const database = await migratedMemoryDb();
  databases.push(database);
  const eventConfig = loadEventConfigs('config/events')[0];
  await seedEvents(database.db, [eventConfig], { info() {} });
  const [event] = await database.db.select().from((await import('../src/db/schema/index.js')).events).where(eq((await import('../src/db/schema/index.js')).events.slug, 'pongal-2027'));
  return { database, event, schema: buildRegistrationSchema(event.configSnapshot.registration) };
}

function validForm(overrides = {}) {
  return {
    contactName: 'Priya',
    contactEmail: 'Priya@Example.com',
    mobileCountryCode: '+1',
    mobileNumber: '6031234567',
    attendees: [
      { name: 'Priya', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: ['registration_desk'] },
      { name: 'Arun', ageBand: '5_to_10', willingToVolunteer: false, volunteerRoles: [] },
      { name: 'Nila', ageBand: 'under_5', willingToVolunteer: false, volunteerRoles: [] },
    ],
    performances: [],
    ...overrides,
  };
}

describe('registration service', () => {
  it('creates a guest registration with pending payment and secure access', async () => {
    const { database, event, schema } = await setup();
    const validation = validateRegistration(schema, validForm());
    expect(validation.ok).toBe(true);
    const created = await createRegistration(database.db, { event, data: validation.data, now });

    expect(created.registration.status).toBe('payment_pending');
    expect(created.registration.totalCents).toBe(6000);
    expect(created.payment.status).toBe('pending');
    expect(created.payment.amountCents).toBe(6000);
    expect(created.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [storedToken] = await database.db.select().from(registrationAccessTokens).where(eq(registrationAccessTokens.registrationId, created.registration.id));
    expect(storedToken.tokenHash).not.toContain(created.accessToken);

    const retrieved = await findRegistrationByAccessToken(database.db, created.accessToken, new Date(now.getTime() + 1000));
    expect(retrieved.registration.id).toBe(created.registration.id);
    expect(retrieved.attendees.map((attendee) => attendee.name)).toEqual(['Priya', 'Arun', 'Nila']);
    const registrationHistory = await database.db.select().from(changeHistory).where(eq(changeHistory.entityId, created.registration.id));
    expect(registrationHistory).toHaveLength(1);
    expect(registrationHistory[0].snapshot.attendees).toHaveLength(3);
    expect(registrationHistory[0].snapshot.payment.status).toBe('pending');
  });

  it('normalizes and links a signed-in registration to its household', async () => {
    const { database, event, schema } = await setup();
    const form = validateRegistration(schema, validForm());
    const [household] = await database.db.insert(households).values({ email: 'priya@example.com', name: 'Priya' }).returning();
    const created = await createRegistration(database.db, { event, data: form.data, householdId: household.id, now });
    expect(created.household.id).toBe(household.id);
    expect(created.registration.householdId).toBe(household.id);
  });

  it('rejects a signed-in household with a different contact email', async () => {
    const { database, event, schema } = await setup();
    const form = validateRegistration(schema, validForm());
    const [household] = await database.db.insert(households).values({ email: 'other@example.com', name: 'Other' }).returning();
    await expect(createRegistration(database.db, { event, data: form.data, householdId: household.id, now })).rejects.toBeInstanceOf(RegistrationOwnershipError);
  });

  it('rejects duplicate active registrations for one household and event', async () => {
    const { database, event, schema } = await setup();
    const form = validateRegistration(schema, validForm());
    await createRegistration(database.db, { event, data: form.data, now });
    await expect(createRegistration(database.db, { event, data: form.data, now })).rejects.toBeInstanceOf(RegistrationConflictError);
    expect(await database.db.select().from(registrations)).toHaveLength(1);
    expect(await database.db.select().from(registrationPayments)).toHaveLength(1);
  });

  it('audits registration edits and resets previous payment declarations', async () => {
    const { database, event, schema } = await setup();
    const original = validateRegistration(schema, validForm());
    const created = await createRegistration(database.db, { event, data: original.data, now });
    const updated = validateRegistration(schema, validForm({
      attendees: [{ name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] }],
    }));
    await database.db.update(registrationPayments).set({ payerName: 'Priya', zelleReference: 'ref', declaredAt: now }).where(eq(registrationPayments.registrationId, created.registration.id));

    const result = await updateRegistration(database.db, { event, registrationId: created.registration.id, data: updated.data, now: new Date(now.getTime() + 1000) });
    expect(result.registration.totalCents).toBe(3500);
    expect(result.payment).toMatchObject({ status: 'pending', amountCents: 3500, payerName: null, zelleReference: null, declaredAt: null });

    const history = await database.db.select().from(changeHistory).where(eq(changeHistory.entityId, created.registration.id));
    expect(history.map((entry) => entry.action)).toEqual(['create', 'update']);
    expect(history[1].snapshot.attendees).toHaveLength(1);
  });
  it('confirms payment once and issues a recoverable encrypted pass', async () => {
    const { database, event, schema } = await setup();
    const { data } = validateRegistration(schema, validForm());
    const created = await createRegistration(database.db, { event, data, now });
    const qrEncryptionKey = Buffer.alloc(32, 17).toString('base64');

    const confirmed = await confirmRegistrationPayment(database.db, {
      eventId: event.id,
      registrationId: created.registration.id,
      adminEmail: 'organizer@example.com',
      qrEncryptionKey,
      now,
    });
    expect(confirmed.registration.status).toBe('confirmed');
    expect(confirmed.payment.status).toBe('confirmed');
    expect(confirmed.pass.tokenHash).not.toContain(confirmed.token);
    expect(confirmed.pass.encryptedToken).not.toContain(confirmed.token);
    expect(revealProtectedPass(confirmed.pass, qrEncryptionKey)).toBe(confirmed.token);

    const repeated = await confirmRegistrationPayment(database.db, {
      eventId: event.id,
      registrationId: created.registration.id,
      adminEmail: 'organizer@example.com',
      qrEncryptionKey,
      now: new Date(now.getTime() + 1000),
    });
    expect(repeated.alreadyConfirmed).toBe(true);
    expect(repeated.token).toBe(confirmed.token);
  });
});