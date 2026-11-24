import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction, writeHistory } from '../src/db/history.js';
import { createHousehold, findActiveByEmail, listActive, softDeleteHousehold } from '../src/db/repos/households.js';
import { changeHistory, households } from '../src/db/schema/index.js';
import { migratedMemoryDb } from './helpers.js';

let database;
let db;
beforeAll(async () => {
  database = await migratedMemoryDb();
  db = database.db;
});
afterAll(() => database.close());

const historyFor = (id) => db.select().from(changeHistory).where(eq(changeHistory.entityId, id));

describe('change history', () => {
  it('Household created', async () => {
    const row = await createHousehold(db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    const [entry] = await historyFor(row.id);
    expect(entry).toMatchObject({ entityType: 'household', action: 'create', actor: 'public' });
    expect(entry.snapshot.email).toBe('priya@example.com');
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('Change fails', async () => {
    const row = await createHousehold(db, { email: 'ravi@example.com', name: 'Ravi' }, 'public');
    await expect(
      inTransaction(db, async (tx) => {
        await tx.update(households).set({ name: 'Changed' }).where(eq(households.id, row.id));
        throw new Error('failure before history was written');
      }),
    ).rejects.toThrow('failure before history was written');
    const [current] = await db.select().from(households).where(eq(households.id, row.id));
    expect(current.name).toBe('Ravi');
    expect(await historyFor(row.id)).toHaveLength(1);
  });

  it('Portal registration, payment, permission, and check-in changes roll back with history', async () => {
    const household = await createHousehold(db, { email: 'portal@example.com', name: 'Portal family' }, 'public');
    const ids = {};

    await expect(
      inTransaction(db, async (tx) => {
        const [event] = await tx.execute(sql`
          insert into events (slug, name, timezone, survey_opens_at, survey_closes_at, config_snapshot, config_hash)
          values ('history-test', 'History test', 'America/New_York', now(), now() + interval '1 day', '{}', 'test')
          returning id
        `).then((result) => result.rows);
        await tx.execute(sql`
          insert into household_auth (household_id, google_sub, email_verified_at)
          values (${household.id}, 'google-history-test', now())
        `);
        const [registration] = await tx.execute(sql`
          insert into registrations (event_id, household_id, contact_name, contact_email, contact_mobile_e164, total_cents, status)
          values (${event.id}, ${household.id}, 'Portal family', 'portal@example.com', '+16035550123', 3500, 'confirmed')
          returning id
        `).then((result) => result.rows);
        const [payment] = await tx.execute(sql`
          insert into registration_payments (registration_id, amount_cents, status, confirmed_by, confirmed_at)
          values (${registration.id}, 3500, 'confirmed', 'organizer@example.com', now())
          returning id
        `).then((result) => result.rows);
        const [permission] = await tx.execute(sql`
          insert into check_in_permissions (event_id, household_id, granted_by)
          values (${event.id}, ${household.id}, 'organizer@example.com')
          returning id
        `).then((result) => result.rows);
        const [checkIn] = await tx.execute(sql`
          insert into registration_check_ins (registration_id, event_id, operator_household_id)
          values (${registration.id}, ${event.id}, ${household.id})
          returning id
        `).then((result) => result.rows);

        Object.assign(ids, { eventId: event.id, registrationId: registration.id, paymentId: payment.id, permissionId: permission.id, checkInId: checkIn.id });
        await writeHistory(tx, 'registration', registration.id, 'create', { status: 'confirmed' }, 'public');
        await writeHistory(tx, 'registration_payment', payment.id, 'update', { status: 'confirmed' }, 'organizer@example.com');
        await writeHistory(tx, 'check_in_permission', permission.id, 'create', { householdId: household.id }, 'organizer@example.com');
        await writeHistory(tx, 'registration_check_in', checkIn.id, 'create', { registrationId: registration.id }, 'organizer@example.com');
        throw new Error('forced portal transaction failure');
      }),
    ).rejects.toThrow('forced portal transaction failure');

    const rows = await db.execute(sql`
      select
        (select count(*)::int from events where id = ${ids.eventId}) as events,
        (select count(*)::int from registrations where id = ${ids.registrationId}) as registrations,
        (select count(*)::int from registration_payments where id = ${ids.paymentId}) as payments,
        (select count(*)::int from check_in_permissions where id = ${ids.permissionId}) as permissions,
        (select count(*)::int from registration_check_ins where id = ${ids.checkInId}) as check_ins,
        (select count(*)::int from change_history where entity_id in (${ids.registrationId}, ${ids.paymentId}, ${ids.permissionId}, ${ids.checkInId})) as history
    `);
    expect(rows.rows[0]).toEqual({ events: 0, registrations: 0, payments: 0, permissions: 0, check_ins: 0, history: 0 });
  });

  it('rolls back the row when writing history fails', async () => {
    const row = await createHousehold(db, { email: 'meena@example.com', name: 'Meena' }, 'public');
    await expect(
      inTransaction(db, async (tx) => {
        await tx.update(households).set({ name: 'Changed' }).where(eq(households.id, row.id));
        await writeHistory(tx, 'household', row.id, 'not-an-action', {}, 'public');
      }),
    ).rejects.toThrow();
    const [current] = await db.select().from(households).where(eq(households.id, row.id));
    expect(current.name).toBe('Meena');
  });
});

describe('households repo', () => {
  it('Mixed-case email', async () => {
    const existing = await createHousehold(db, { email: 'kavya@example.com', name: 'Kavya' }, 'public');
    const found = await findActiveByEmail(db, '  Kavya@Example.COM ');
    expect(found.id).toBe(existing.id);
    await expect(createHousehold(db, { email: 'KAVYA@example.com', name: 'Dup' }, 'public')).rejects.toThrow();
    const stored = await createHousehold(db, { email: '  Arun@Example.com ', name: 'Arun' }, 'public');
    expect(stored.email).toBe('arun@example.com');
  });

  it('Soft delete', async () => {
    const row = await createHousehold(db, { email: 'gone@example.com', name: 'Gone' }, 'public');
    const before = Date.now();
    await softDeleteHousehold(db, row.id, 'admin@example.com');

    const [stored] = await db.select().from(households).where(eq(households.id, row.id));
    expect(stored.deletedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await findActiveByEmail(db, 'gone@example.com')).toBeNull();
    expect((await listActive(db)).map((h) => h.id)).not.toContain(row.id);
    const actions = (await historyFor(row.id)).map((h) => h.action);
    expect(actions).toEqual(['create', 'delete']);
  });
});
