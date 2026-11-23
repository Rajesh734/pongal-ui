import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { checkInPermissions, changeHistory, events, households, registrationCheckIns, registrationPasses, registrations } from '../src/db/schema/index.js';
import { createOrLinkGoogleHousehold } from '../src/modules/auth/service.js';
import { confirmRegistrationPayment, createRegistration } from '../src/modules/registration/service.js';
import { CheckInAccessError, previewCheckIn, recordCheckIn } from '../src/modules/registration/checkin-service.js';
import { buildRegistrationSchema, validateRegistration } from '../src/shared/registration-schema.js';
import { migratedMemoryDb } from './helpers.js';

const databases = [];
const QR_KEY = Buffer.alloc(32, 19).toString('base64');
const now = new Date('2026-11-23T12:00:00Z');

afterEach(async () => {
  while (databases.length) await databases.pop().close();
});

async function setup({ permission = true, confirmed = true } = {}) {
  const database = await migratedMemoryDb();
  databases.push(database);
  await seedEvents(database.db, loadEventConfigs('config/events'), { info() {} });
  const [event] = await database.db.select().from(events).where(eq(events.slug, 'pongal-2027'));
  const { household } = await createOrLinkGoogleHousehold(database.db, {
    email: 'scanner@example.com',
    name: 'Scanner volunteer',
    sub: 'google-sub-scanner',
    now,
  });
  if (permission) {
    await database.db.insert(checkInPermissions).values({
      eventId: event.id,
      householdId: household.id,
      grantedBy: 'organizer@example.com',
      grantedAt: now,
    });
  }

  const schema = buildRegistrationSchema(event.configSnapshot.registration);
  const { data } = validateRegistration(schema, {
    contactName: 'Priya',
    contactEmail: 'priya@example.com',
    mobileCountryCode: '+1',
    mobileNumber: '6039700000',
    attendees: [
      { name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] },
      { name: 'Arun', ageBand: '5_to_10', willingToVolunteer: false, volunteerRoles: [] },
    ],
    performances: [],
  });
  const created = await createRegistration(database.db, { event, data, now });
  const confirmation = confirmed
    ? await confirmRegistrationPayment(database.db, {
        eventId: event.id,
        registrationId: created.registration.id,
        adminEmail: 'organizer@example.com',
        qrEncryptionKey: QR_KEY,
        now,
      })
    : null;
  return { database, event, household, registration: created.registration, token: confirmation?.token ?? null };
}

describe('check-in service', () => {
  it('previews, records once, and rejects duplicate household check-ins', async () => {
    const { database, event, household, registration, token } = await setup();
    const preview = await previewCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token });
    expect(preview.status).toBe('ready');
    expect(preview.attendees.map((attendee) => attendee.name)).toEqual(['Priya', 'Arun']);

    const result = await recordCheckIn(database.db, {
      eventId: event.id,
      operatorHouseholdId: household.id,
      token,
      adminActor: 'organizer@example.com',
      now,
    });
    expect(result.status).toBe('checked_in');
    expect(result.registration.id).toBe(registration.id);
    expect(result.checkIn.operatorHouseholdId).toBe(household.id);
    expect(result.checkIn.checkedInAt).toEqual(now);
    const history = await database.db.select().from(changeHistory).where(eq(changeHistory.entityId, result.checkIn.id));
    expect(history[0]).toMatchObject({ entityType: 'registration_check_in', action: 'create', actor: 'organizer@example.com' });
    const repeated = await previewCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token });
    expect(repeated.status).toBe('already_checked_in');
    expect(await database.db.select().from(registrationCheckIns)).toHaveLength(1);
  });

  it('reports invalid tokens and passes for another event', async () => {
    const { database, event, household, token } = await setup();
    const [otherEvent] = await database.db.execute(sql`
      insert into events (slug, name, timezone, survey_opens_at, survey_closes_at, config_snapshot, config_hash)
      values ('other-event', 'Other event', 'America/New_York', now(), now() + interval '1 day', '{}', 'other')
      returning id
    `).then((result) => result.rows);
    await database.db.insert(checkInPermissions).values({ eventId: otherEvent.id, householdId: household.id, grantedBy: 'organizer@example.com' });
    await expect(previewCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token: 'bad' })).resolves.toMatchObject({ status: 'invalid' });
    await expect(previewCheckIn(database.db, {
      eventId: otherEvent.id,
      operatorHouseholdId: household.id,
      token,
    })).resolves.toMatchObject({ status: 'wrong_event' });
  });

  it('denies a payment-pending registration even if a stale pass row exists', async () => {
    const { database, event, household, registration } = await setup({ confirmed: false });
    const token = randomBytes(32).toString('base64url');
    await database.db.insert(registrationPasses).values({
      registrationId: registration.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      encryptedToken: 'stale-ciphertext',
      encryptionIv: 'stale-iv',
      authTag: 'stale-tag',
      keyVersion: 1,
    });
    await expect(previewCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token }))
      .resolves.toMatchObject({ status: 'payment_pending' });
  });

  it('denies a volunteer account without a check-in grant', async () => {
    const { database, event, household, token } = await setup({ permission: false });
    await expect(previewCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token }))
      .rejects.toBeInstanceOf(CheckInAccessError);
    await expect(recordCheckIn(database.db, { eventId: event.id, operatorHouseholdId: household.id, token }))
      .rejects.toBeInstanceOf(CheckInAccessError);
  });
});