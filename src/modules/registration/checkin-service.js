import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { inTransaction, writeHistory } from '../../db/history.js';
import {
  checkInPermissions,
  households,
  registrationAttendees,
  registrationCheckIns,
  registrationPasses,
  registrations,
} from '../../db/schema/index.js';

export class CheckInAccessError extends Error {
  constructor(message = "You don't have permission to check in attendees.") {
    super(message);
    this.name = 'CheckInAccessError';
  }
}

function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

async function assertPermission(db, eventId, householdId) {
  const [permission] = await db.select().from(checkInPermissions).where(and(
    eq(checkInPermissions.eventId, eventId),
    eq(checkInPermissions.householdId, householdId),
    isNull(checkInPermissions.revokedAt),
  ));
  if (!permission) throw new CheckInAccessError();
}

export async function hasCheckInPermission(db, eventId, householdId) {
  const [permission] = await db.select({ id: checkInPermissions.id }).from(checkInPermissions).where(and(
    eq(checkInPermissions.eventId, eventId),
    eq(checkInPermissions.householdId, householdId),
    isNull(checkInPermissions.revokedAt),
  ));
  return Boolean(permission);
}

async function passState(db, eventId, token) {
  const hash = tokenHash(token);
  if (!hash) return { status: 'invalid' };
  const [pass] = await db.select().from(registrationPasses).where(and(
    eq(registrationPasses.tokenHash, hash),
    isNull(registrationPasses.revokedAt),
  ));
  if (!pass) return { status: 'invalid' };
  const [registration] = await db.select().from(registrations).where(and(
    eq(registrations.id, pass.registrationId),
    isNull(registrations.deletedAt),
  ));
  if (!registration) return { status: 'invalid' };
  if (registration.eventId !== eventId) return { status: 'wrong_event' };
  if (registration.status !== 'confirmed') return { status: 'payment_pending' };

  const [checkIn] = await db.select().from(registrationCheckIns).where(eq(registrationCheckIns.registrationId, registration.id));
  const [[household], attendees] = await Promise.all([
    db.select().from(households).where(eq(households.id, registration.householdId)),
    db.select().from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id)),
  ]);
  return { status: checkIn ? 'already_checked_in' : 'ready', registration, household, attendees, checkIn };
}

export async function previewCheckIn(db, { eventId, operatorHouseholdId, token }) {
  await assertPermission(db, eventId, operatorHouseholdId);
  return passState(db, eventId, token);
}

export function recordCheckIn(db, { eventId, operatorHouseholdId, token, adminActor, now = new Date() }) {
  const hash = tokenHash(token);
  if (!hash) return Promise.resolve({ status: 'invalid' });

  return inTransaction(db, async (tx) => {
    const [permission] = await tx.select().from(checkInPermissions).where(and(
      eq(checkInPermissions.eventId, eventId),
      eq(checkInPermissions.householdId, operatorHouseholdId),
      isNull(checkInPermissions.revokedAt),
    ));
    if (!permission) throw new CheckInAccessError('Your check-in access has been revoked.');

    const [pass] = await tx.select().from(registrationPasses).where(and(
      eq(registrationPasses.tokenHash, hash),
      isNull(registrationPasses.revokedAt),
    ));
    if (!pass) return { status: 'invalid' };
    const [registration] = await tx.select().from(registrations).where(and(
      eq(registrations.id, pass.registrationId),
      isNull(registrations.deletedAt),
    ));
    if (!registration) return { status: 'invalid' };
    if (registration.eventId !== eventId) return { status: 'wrong_event' };
    if (registration.status !== 'confirmed') return { status: 'payment_pending' };

    const [existing] = await tx.select().from(registrationCheckIns).where(eq(registrationCheckIns.registrationId, registration.id));
    if (existing) return { status: 'already_checked_in', registration, checkIn: existing };

    const [checkIn] = await tx
      .insert(registrationCheckIns)
      .values({ registrationId: registration.id, eventId, operatorHouseholdId, checkedInAt: now })
      .returning();
    const [household] = await tx.select().from(households).where(eq(households.id, registration.householdId));
    const attendees = await tx.select().from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id));
    await writeHistory(tx, 'registration_check_in', checkIn.id, 'create', {
      registrationId: registration.id,
      eventId,
      operatorHouseholdId,
      checkedInAt: now,
      attendeeIds: attendees.map((attendee) => attendee.id),
    }, adminActor ?? operatorHouseholdId);
    return { status: 'checked_in', registration, household, attendees, checkIn };
  });
}