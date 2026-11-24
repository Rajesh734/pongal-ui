import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { inTransaction, writeHistory } from '../../db/history.js';
import { normalizeEmail } from '../../db/repos/households.js';
import {
  checkInPermissions,
  householdAuth,
  households,
  registrationAttendees,
  registrationPayments,
  registrationPerformances,
  registrationVolunteerRoles,
  registrations,
} from '../../db/schema/index.js';
import { ageGroupLabel } from '../../shared/registration-pricing.js';
import { formatPhone, toCsv } from '../../core/csv.js';

export class CheckInPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckInPermissionError';
  }
}

export async function listPortalRegistrations(db, { eventId, status = 'all' }) {
  const filters = [eq(registrations.eventId, eventId), isNull(registrations.deletedAt)];
  if (status !== 'all') filters.push(eq(registrations.status, status));
  const rows = await db.select().from(registrations).where(and(...filters)).orderBy(desc(registrations.createdAt));

  return Promise.all(rows.map(async (registration) => {
    const [[household], [payment], attendees, performances] = await Promise.all([
      db.select().from(households).where(eq(households.id, registration.householdId)),
      db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registration.id)),
      db.select().from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id)).orderBy(asc(registrationAttendees.createdAt)),
      db.select().from(registrationPerformances).where(eq(registrationPerformances.registrationId, registration.id)),
    ]);
    const roles = attendees.length
      ? await db.select().from(registrationVolunteerRoles).where(inArray(registrationVolunteerRoles.attendeeId, attendees.map((attendee) => attendee.id)))
      : [];
    const rolesByAttendee = new Map();
    for (const role of roles) {
      const current = rolesByAttendee.get(role.attendeeId) ?? [];
      current.push(role.roleCode);
      rolesByAttendee.set(role.attendeeId, current);
    }
    return {
      registration,
      household,
      payment,
      performances,
      attendees: attendees.map((attendee) => ({ ...attendee, volunteerRoles: rolesByAttendee.get(attendee.id) ?? [] })),
    };
  }));
}

export function volunteerRows(registrationRows, roleLabels, roleFilter = 'all') {
  return registrationRows.flatMap((row) => row.attendees
    .filter((attendee) => attendee.willingToVolunteer)
    .filter((attendee) => roleFilter === 'all' || attendee.volunteerRoles.includes(roleFilter))
    .map((attendee) => ({
      registrationId: row.registration.id,
      householdName: row.household.name,
      householdEmail: row.household.email,
      attendeeName: attendee.name,
      ageGroup: ageGroupLabel(attendee.ageBand),
      roles: attendee.volunteerRoles.map((code) => roleLabels[code] ?? code),
    })));
}

export function registrationCsv(event, rows) {
  const header = [
    'Event', 'Registration ID', 'Household contact', 'Email', 'Mobile', 'WhatsApp',
    'Attendee', 'Age group', 'Volunteer roles', 'Registration status', 'Payment status',
    'Amount due (USD)', 'Payer name', 'Zelle reference', 'Performance', 'Participants', 'Duration minutes', 'Compere introduction',
  ];
  // Like the UI, registration-level cells appear on the first attendee row only; later rows leave them blank.
  const records = rows.flatMap((row) => (row.attendees.length ? row.attendees : [null]).map((attendee, index) => {
    const first = (value) => (index === 0 ? value : '');
    return [
      event.slug,
      row.registration.id,
      first(row.registration.contactName),
      first(row.registration.contactEmail),
      first(formatPhone(row.registration.contactMobileE164)),
      first(formatPhone(row.registration.contactWhatsappE164)),
      attendee?.name ?? '',
      attendee ? ageGroupLabel(attendee.ageBand) : '',
      attendee?.volunteerRoles.join('; ') ?? '',
      first(row.registration.status),
      first(row.payment?.status),
      first((row.registration.totalCents / 100).toFixed(2)),
      first(row.payment?.payerName),
      first(row.payment?.zelleReference),
      first(row.performances.map((performance) => performance.title).join('; ')),
      first(row.performances.map((performance) => performance.participantNames).join('; ')),
      first(row.performances.map((performance) => performance.durationMinutes).join('; ')),
      first(row.performances.map((performance) => performance.compereIntroduction).join('; ')),
    ];
  }));
  return toCsv([header, ...records]);
}

export async function listActiveCheckInPermissions(db, eventId) {
  return db.select({ permission: checkInPermissions, household: households })
    .from(checkInPermissions)
    .innerJoin(households, eq(households.id, checkInPermissions.householdId))
    .where(and(eq(checkInPermissions.eventId, eventId), isNull(checkInPermissions.revokedAt)))
    .orderBy(asc(checkInPermissions.grantedAt));
}

export function grantCheckInPermission(db, { eventId, email: rawEmail, adminEmail, now = new Date() }) {
  const email = normalizeEmail(rawEmail);
  return inTransaction(db, async (tx) => {
    const [household] = await tx.select().from(households).where(and(eq(households.email, email), isNull(households.deletedAt)));
    const [auth] = household ? await tx.select().from(householdAuth).where(eq(householdAuth.householdId, household.id)) : [];
    if (!household || !auth?.emailVerifiedAt) {
      throw new CheckInPermissionError('This person needs a verified household account before check-in access can be granted.');
    }
    const [active] = await tx.select().from(checkInPermissions).where(and(
      eq(checkInPermissions.eventId, eventId),
      eq(checkInPermissions.householdId, household.id),
      isNull(checkInPermissions.revokedAt),
    ));
    if (active) return active;

    const [permission] = await tx
      .insert(checkInPermissions)
      .values({ eventId, householdId: household.id, grantedBy: adminEmail, grantedAt: now })
      .returning();
    await writeHistory(tx, 'check_in_permission', permission.id, 'create', permission, adminEmail);
    return permission;
  });
}

export function revokeCheckInPermission(db, { eventId, permissionId, adminEmail, now = new Date() }) {
  return inTransaction(db, async (tx) => {
    const [permission] = await tx
      .update(checkInPermissions)
      .set({ revokedAt: now })
      .where(and(
        eq(checkInPermissions.id, permissionId),
        eq(checkInPermissions.eventId, eventId),
        isNull(checkInPermissions.revokedAt),
      ))
      .returning();
    if (!permission) return null;
    await writeHistory(tx, 'check_in_permission', permission.id, 'update', permission, adminEmail);
    return permission;
  });
}