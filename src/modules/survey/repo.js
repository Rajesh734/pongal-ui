import { and, asc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { writeHistory } from '../../db/history.js';
import { normalizeEmail } from '../../db/repos/households.js';
import {
  eventDays,
  events,
  households,
  responseDays,
  responseHeadcounts,
  responseVolunteerRoles,
  surveyResponses,
} from '../../db/schema/index.js';

/** Event row plus its days ({ id, dayDate, label, sort }), or null. */
export async function findEventBySlug(db, slug) {
  const [event] = await db.select().from(events).where(eq(events.slug, slug));
  if (!event) return null;
  const days = await db.select().from(eventDays).where(eq(eventDays.eventId, event.id)).orderBy(asc(eventDays.sort));
  return { ...event, days };
}

export function listEvents(db) {
  return db.select().from(events);
}

/** Active response with the given token hash for the event, with its household, or null. */
export async function findActiveByTokenHash(db, eventId, tokenHash) {
  const [row] = await db
    .select({ response: surveyResponses, household: households })
    .from(surveyResponses)
    .innerJoin(households, eq(households.id, surveyResponses.householdId))
    .where(and(eq(surveyResponses.eventId, eventId), eq(surveyResponses.editTokenHash, tokenHash), isNull(surveyResponses.deletedAt)));
  return row ?? null;
}

/** Days ({ date, likelihood }), headcounts ({ code, count }) and role codes of a response. */
export async function loadAnswers(db, responseId) {
  const days = await db
    .select({ date: eventDays.dayDate, likelihood: responseDays.likelihood })
    .from(responseDays)
    .innerJoin(eventDays, eq(eventDays.id, responseDays.eventDayId))
    .where(eq(responseDays.responseId, responseId))
    .orderBy(asc(eventDays.sort));
  const headcounts = await db
    .select({ code: responseHeadcounts.bandCode, count: responseHeadcounts.count })
    .from(responseHeadcounts)
    .where(eq(responseHeadcounts.responseId, responseId));
  const roles = await db
    .select({ code: responseVolunteerRoles.roleCode })
    .from(responseVolunteerRoles)
    .where(eq(responseVolunteerRoles.responseId, responseId));
  return { days, headcounts, roles: roles.map((r) => r.code) };
}

/** Inserts or updates the household by email; the row stays locked until the transaction ends. */
export async function upsertHousehold(tx, { email, name, mobileE164 }, now) {
  const [row] = await tx
    .insert(households)
    .values({ email: normalizeEmail(email), name, mobileE164 })
    .onConflictDoUpdate({ target: households.email, set: { name, mobileE164, updatedAt: now } })
    .returning({ ...getTableColumns(households), inserted: sql`(xmax = 0)` });
  const { inserted, ...household } = row;
  return { household, created: inserted };
}

export async function updateHousehold(tx, id, { name, mobileE164 }, now) {
  const [row] = await tx.update(households).set({ name, mobileE164, updatedAt: now }).where(eq(households.id, id)).returning();
  return row;
}

export async function findActiveResponse(tx, eventId, householdId) {
  const [row] = await tx
    .select()
    .from(surveyResponses)
    .where(and(eq(surveyResponses.eventId, eventId), eq(surveyResponses.householdId, householdId), isNull(surveyResponses.deletedAt)));
  return row ?? null;
}

function responseFields(data, now) {
  return {
    foodCode: data.foodCode,
    culturalCode: data.culturalCode,
    contributionCode: data.contributionCode,
    comments: data.comments,
    consentAt: now,
  };
}

export async function insertResponse(tx, { eventId, householdId, data, tokenHash, now }) {
  const [row] = await tx
    .insert(surveyResponses)
    .values({ eventId, householdId, ...responseFields(data, now), editTokenHash: tokenHash, editTokenIssuedAt: now, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

/** Updates the answers; a new tokenHash (public form) replaces the edit link, undefined keeps it. */
export async function updateResponse(tx, id, { data, tokenHash, now }) {
  const token = tokenHash ? { editTokenHash: tokenHash, editTokenIssuedAt: now } : {};
  const [row] = await tx
    .update(surveyResponses)
    .set({ ...responseFields(data, now), ...token, updatedAt: now })
    .where(eq(surveyResponses.id, id))
    .returning();
  return row;
}

/** Replaces the response's day, headcount and role rows as a set (the parent response is kept). */
export async function replaceChildren(tx, responseId, event, data) {
  await tx.delete(responseDays).where(eq(responseDays.responseId, responseId));
  await tx.delete(responseHeadcounts).where(eq(responseHeadcounts.responseId, responseId));
  await tx.delete(responseVolunteerRoles).where(eq(responseVolunteerRoles.responseId, responseId));
  const dayIds = new Map(event.days.map((d) => [d.dayDate, d.id]));
  if (data.days.length) {
    await tx.insert(responseDays).values(data.days.map((d) => ({ responseId, eventDayId: dayIds.get(d.date), likelihood: d.likelihood })));
  }
  await tx.insert(responseHeadcounts).values(data.headcounts.map((h) => ({ responseId, bandCode: h.code, count: h.count })));
  if (data.volunteerRoles.length) {
    await tx.insert(responseVolunteerRoles).values(data.volunteerRoles.map((roleCode) => ({ responseId, roleCode })));
  }
}

export async function writeResponseHistory(tx, response, action, actor) {
  const answers = await loadAnswers(tx, response.id);
  await writeHistory(tx, 'survey_response', response.id, action, { ...response, ...answers }, actor);
}

/** Soft-deletes the active response of `email` for the event; returns the row or null. */
export async function softDeleteResponse(tx, eventId, email, actor, now = new Date()) {
  const [household] = await tx.select().from(households).where(eq(households.email, normalizeEmail(email)));
  if (!household) return null;
  const active = await findActiveResponse(tx, eventId, household.id);
  if (!active) return null;
  const [row] = await tx.update(surveyResponses).set({ deletedAt: now, updatedAt: now }).where(eq(surveyResponses.id, active.id)).returning();
  await writeResponseHistory(tx, row, 'delete', actor);
  return row;
}
