import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { inTransaction, writeHistory } from '../../db/history.js';
import {
  emailVerificationTokens,
  events,
  households,
  registrationAccessTokens,
  registrationAttendees,
  registrationPayments,
  registrationPasses,
  registrationPerformances,
  registrationVolunteerRoles,
  registrations,
} from '../../db/schema/index.js';
import { normalizeEmail } from '../../db/repos/households.js';
import { createProtectedPass, revealProtectedPass } from './pass-tokens.js';

const ACCESS_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export class RegistrationConflictError extends Error {
  constructor(message = 'An active registration already exists for this household and event.') {
    super(message);
    this.name = 'RegistrationConflictError';
  }
}

export class RegistrationOwnershipError extends Error {
  constructor() {
    super('The signed-in household does not match the registration contact email.');
    this.name = 'RegistrationOwnershipError';
  }
}

export class PaymentDeclarationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentDeclarationError';
  }
}

export class RegistrationEditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistrationEditError';
  }
}

function makeAccessToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') };
}

async function findOrUpdateHousehold(tx, data, householdId, now) {
  const email = normalizeEmail(data.contactEmail);
  if (householdId) {
    const [household] = await tx.select().from(households).where(and(eq(households.id, householdId), isNull(households.deletedAt)));
    if (!household || normalizeEmail(household.email) !== email) throw new RegistrationOwnershipError();
    const [updated] = await tx
      .update(households)
      .set({
        name: data.contactName,
        mobileE164: data.mobileE164,
        whatsappE164: data.whatsappE164,
        whatsappConsentAt: data.whatsappE164 ? now : null,
        updatedAt: now,
      })
      .where(eq(households.id, household.id))
      .returning();
    await writeHistory(tx, 'household', updated.id, 'update', updated, 'public');
    return updated;
  }

  const [existing] = await tx.select().from(households).where(eq(households.email, email));
  if (existing?.deletedAt) throw new RegistrationConflictError('This household is unavailable for new registrations. Contact an organizer.');
  if (existing) {
    const [updated] = await tx
      .update(households)
      .set({
        name: data.contactName,
        mobileE164: data.mobileE164,
        whatsappE164: data.whatsappE164,
        whatsappConsentAt: data.whatsappE164 ? now : null,
        updatedAt: now,
      })
      .where(eq(households.id, existing.id))
      .returning();
    await writeHistory(tx, 'household', updated.id, 'update', updated, 'public');
    return updated;
  }

  const [created] = await tx
    .insert(households)
    .values({
      email,
      name: data.contactName,
      mobileE164: data.mobileE164,
      whatsappE164: data.whatsappE164,
      whatsappConsentAt: data.whatsappE164 ? now : null,
    })
    .returning();
  await writeHistory(tx, 'household', created.id, 'create', created, 'public');
  return created;
}

export async function createRegistration(db, { event, data, householdId = null, now = new Date() }) {
  if (!event?.configSnapshot?.registration) throw new Error('Registration is not configured for this event.');
  const access = makeAccessToken();
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);

  return inTransaction(db, async (tx) => {
    const household = await findOrUpdateHousehold(tx, data, householdId, now);
    const [existing] = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, event.id), eq(registrations.householdId, household.id), isNull(registrations.deletedAt)));
    if (existing) throw new RegistrationConflictError();

    const [registration] = await tx
      .insert(registrations)
      .values({
        eventId: event.id,
        householdId: household.id,
        contactName: data.contactName,
        contactEmail: normalizeEmail(data.contactEmail),
        contactMobileE164: data.mobileE164,
        contactWhatsappE164: data.whatsappE164,
        whatsappConsentAt: data.whatsappE164 ? now : null,
        status: 'payment_pending',
        totalCents: data.totalCents,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const attendees = await tx
      .insert(registrationAttendees)
      .values(data.attendees.map((attendee) => ({
        registrationId: registration.id,
        name: attendee.name,
        ageBand: attendee.ageBand,
        feeCents: attendee.feeCents,
        willingToVolunteer: attendee.willingToVolunteer,
        createdAt: now,
      })))
      .returning();

    const roleRows = data.attendees.flatMap((attendee, index) =>
      attendee.volunteerRoles.map((roleCode) => ({ attendeeId: attendees[index].id, roleCode })),
    );
    if (roleRows.length) await tx.insert(registrationVolunteerRoles).values(roleRows);

    const performances = data.performances.length
      ? await tx
          .insert(registrationPerformances)
          .values(data.performances.map((performance) => ({ registrationId: registration.id, ...performance, createdAt: now })))
          .returning()
      : [];

    const [payment] = await tx
      .insert(registrationPayments)
      .values({ registrationId: registration.id, amountCents: data.totalCents, status: 'pending', createdAt: now, updatedAt: now })
      .returning();
    const [accessToken] = await tx
      .insert(registrationAccessTokens)
      .values({ registrationId: registration.id, tokenHash: access.tokenHash, expiresAt, createdAt: now })
      .returning();

    const snapshot = {
      ...registration,
      attendees: attendees.map((attendee, index) => ({ ...attendee, volunteerRoles: data.attendees[index].volunteerRoles })),
      performances,
      payment,
    };
    await writeHistory(tx, 'registration', registration.id, 'create', snapshot, 'public');
    await writeHistory(tx, 'registration_payment', payment.id, 'create', payment, 'public');
    await writeHistory(tx, 'registration_access_token', accessToken.id, 'create', { registrationId: registration.id, expiresAt }, 'system');

    return { registration, household, attendees, performances, payment, accessToken: access.token, expiresAt };
  });
}

export async function findRegistrationByAccessToken(db, rawToken, now = new Date(), qrEncryptionKey) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const [accessToken] = await db
    .select()
    .from(registrationAccessTokens)
    .where(and(
      eq(registrationAccessTokens.tokenHash, tokenHash),
      isNull(registrationAccessTokens.revokedAt),
      gt(registrationAccessTokens.expiresAt, now),
    ));
  if (!accessToken) return null;

  const [registration] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.id, accessToken.registrationId), isNull(registrations.deletedAt)));
  if (!registration) return null;
  const [[household], attendees, performances, [payment], volunteerRoles, [pass]] = await Promise.all([
    db.select().from(households).where(eq(households.id, registration.householdId)),
    db.select().from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id)),
    db.select().from(registrationPerformances).where(eq(registrationPerformances.registrationId, registration.id)),
    db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registration.id)),
    db.select().from(registrationVolunteerRoles)
      .innerJoin(registrationAttendees, eq(registrationAttendees.id, registrationVolunteerRoles.attendeeId))
      .where(eq(registrationAttendees.registrationId, registration.id)),
    db.select().from(registrationPasses).where(eq(registrationPasses.registrationId, registration.id)),
  ]);
  const rolesByAttendee = new Map();
  for (const { registration_volunteer_roles: role } of volunteerRoles) {
    const roles = rolesByAttendee.get(role.attendeeId) ?? [];
    roles.push(role.roleCode);
    rolesByAttendee.set(role.attendeeId, roles);
  }
  return {
    registration,
    household,
    attendees: attendees.map((attendee) => ({ ...attendee, volunteerRoles: rolesByAttendee.get(attendee.id) ?? [] })),
    performances,
    payment,
    entryPass: payment?.status === 'confirmed' && pass ? revealProtectedPass(pass, qrEncryptionKey) : null,
  };
}

export async function listHouseholdRegistrations(db, householdId, qrEncryptionKey) {
  const rows = await db
    .select({ registration: registrations, event: events })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(and(eq(registrations.householdId, householdId), isNull(registrations.deletedAt)))
    .orderBy(desc(registrations.createdAt));

  return Promise.all(rows.map(async ({ registration, event }) => {
    const [[payment], attendees, performances, [pass]] = await Promise.all([
      db.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registration.id)),
      db.select().from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id)),
      db.select().from(registrationPerformances).where(eq(registrationPerformances.registrationId, registration.id)),
      db.select().from(registrationPasses).where(eq(registrationPasses.registrationId, registration.id)),
    ]);
    return {
      registration,
      event,
      payment,
      attendees,
      performances,
      entryPass: payment?.status === 'confirmed' && pass ? revealProtectedPass(pass, qrEncryptionKey) : null,
    };
  }));
}

export function updateRegistration(db, { event, registrationId, data, now = new Date() }) {
  return inTransaction(db, async (tx) => {
    const [existing] = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, event.id), isNull(registrations.deletedAt)));
    if (!existing) throw new RegistrationEditError('This registration link is no longer valid.');
    if (existing.status !== 'payment_pending') {
      throw new RegistrationEditError('A confirmed registration cannot be changed here. Contact the organizers for help.');
    }

    const household = await findOrUpdateHousehold(tx, data, existing.householdId, now);
    const [registration] = await tx
      .update(registrations)
      .set({
        contactName: data.contactName,
        contactEmail: normalizeEmail(data.contactEmail),
        contactMobileE164: data.mobileE164,
        contactWhatsappE164: data.whatsappE164,
        whatsappConsentAt: data.whatsappE164 ? now : null,
        totalCents: data.totalCents,
        updatedAt: now,
      })
      .where(eq(registrations.id, existing.id))
      .returning();

    const oldAttendees = await tx.select({ id: registrationAttendees.id }).from(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id));
    if (oldAttendees.length) {
      await tx.delete(registrationVolunteerRoles).where(inArray(registrationVolunteerRoles.attendeeId, oldAttendees.map((attendee) => attendee.id)));
    }
    await tx.delete(registrationAttendees).where(eq(registrationAttendees.registrationId, registration.id));
    await tx.delete(registrationPerformances).where(eq(registrationPerformances.registrationId, registration.id));

    const attendees = await tx
      .insert(registrationAttendees)
      .values(data.attendees.map((attendee) => ({
        registrationId: registration.id,
        name: attendee.name,
        ageBand: attendee.ageBand,
        feeCents: attendee.feeCents,
        willingToVolunteer: attendee.willingToVolunteer,
        createdAt: now,
      })))
      .returning();
    const roleRows = data.attendees.flatMap((attendee, index) =>
      attendee.volunteerRoles.map((roleCode) => ({ attendeeId: attendees[index].id, roleCode })),
    );
    if (roleRows.length) await tx.insert(registrationVolunteerRoles).values(roleRows);
    const performances = data.performances.length
      ? await tx
          .insert(registrationPerformances)
          .values(data.performances.map((performance) => ({ registrationId: registration.id, ...performance, createdAt: now })))
          .returning()
      : [];
    const [payment] = await tx
      .update(registrationPayments)
      .set({
        amountCents: data.totalCents,
        payerName: null,
        zelleReference: null,
        declaredAt: null,
        updatedAt: now,
      })
      .where(eq(registrationPayments.registrationId, registration.id))
      .returning();

    await writeHistory(tx, 'registration', registration.id, 'update', {
      ...registration,
      attendees: attendees.map((attendee, index) => ({ ...attendee, volunteerRoles: data.attendees[index].volunteerRoles })),
      performances,
    }, 'public');
    if (payment) await writeHistory(tx, 'registration_payment', payment.id, 'update', payment, 'public');
    return { registration, household, attendees, performances, payment };
  });
}

export function declarePaymentSent(db, { registrationId, payerName, zelleReference, now = new Date() }) {
  const cleanPayerName = typeof payerName === 'string' ? payerName.trim() : '';
  const cleanReference = typeof zelleReference === 'string' ? zelleReference.trim() : '';
  if (cleanPayerName.length < 2 || cleanPayerName.length > 150) {
    throw new PaymentDeclarationError('Enter the name shown on the Zelle payment.');
  }
  if (cleanReference.length < 1 || cleanReference.length > 100) {
    throw new PaymentDeclarationError('Enter the Zelle confirmation or payment reference.');
  }

  return inTransaction(db, async (tx) => {
    const [payment] = await tx.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registrationId));
    if (!payment || payment.status === 'confirmed') return payment ?? null;
    const [updated] = await tx
      .update(registrationPayments)
      .set({ payerName: cleanPayerName, zelleReference: cleanReference, declaredAt: now, updatedAt: now })
      .where(eq(registrationPayments.id, payment.id))
      .returning();
    await writeHistory(tx, 'registration_payment', updated.id, 'update', updated, 'public');
    return updated;
  });
}

export function confirmRegistrationPayment(db, { eventId, registrationId, adminEmail, qrEncryptionKey, now = new Date() }) {
  return inTransaction(db, async (tx) => {
    const [registration] = await tx.select().from(registrations).where(and(eq(registrations.id, registrationId), eq(registrations.eventId, eventId)));
    if (!registration || registration.deletedAt) throw new RegistrationEditError('This registration is no longer available.');
    const [payment] = await tx.select().from(registrationPayments).where(eq(registrationPayments.registrationId, registrationId));
    if (!payment) throw new RegistrationEditError('Payment record is missing for this registration.');

    if (payment.status === 'confirmed') {
      const [existingPass] = await tx.select().from(registrationPasses).where(eq(registrationPasses.registrationId, registrationId));
      if (!existingPass) throw new RegistrationEditError('Confirmed payment has no entry pass. Contact support.');
      return { registration, payment, pass: existingPass, token: revealProtectedPass(existingPass, qrEncryptionKey), alreadyConfirmed: true };
    }
    if (registration.status !== 'payment_pending') throw new RegistrationEditError('This registration is not awaiting payment.');
    if (payment.amountCents !== registration.totalCents) throw new RegistrationEditError('Payment amount no longer matches the registration total.');

    const [confirmedPayment] = await tx
      .update(registrationPayments)
      .set({ status: 'confirmed', confirmedBy: adminEmail, confirmedAt: now, updatedAt: now })
      .where(and(eq(registrationPayments.id, payment.id), eq(registrationPayments.status, 'pending')))
      .returning();
    if (!confirmedPayment) throw new RegistrationEditError('Payment status changed. Reload the payment queue.');
    const [confirmedRegistration] = await tx
      .update(registrations)
      .set({ status: 'confirmed', updatedAt: now })
      .where(and(eq(registrations.id, registration.id), eq(registrations.status, 'payment_pending')))
      .returning();
    if (!confirmedRegistration) throw new RegistrationEditError('Registration status changed. Reload the payment queue.');

    const protectedPass = createProtectedPass(qrEncryptionKey);
    const [pass] = await tx
      .insert(registrationPasses)
      .values({
        registrationId,
        tokenHash: protectedPass.tokenHash,
        encryptedToken: protectedPass.encryptedToken,
        encryptionIv: protectedPass.encryptionIv,
        authTag: protectedPass.authTag,
        keyVersion: protectedPass.keyVersion,
        issuedAt: now,
      })
      .returning();

    await writeHistory(tx, 'registration', registrationId, 'update', confirmedRegistration, adminEmail);
    await writeHistory(tx, 'registration_payment', confirmedPayment.id, 'update', confirmedPayment, adminEmail);
    await writeHistory(tx, 'registration_pass', pass.id, 'create', { registrationId, keyVersion: pass.keyVersion, issuedAt: pass.issuedAt }, adminEmail);
    return { registration: confirmedRegistration, payment: confirmedPayment, pass, token: protectedPass.token, alreadyConfirmed: false };
  });
}