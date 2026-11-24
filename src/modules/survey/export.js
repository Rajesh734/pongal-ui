import { asc, eq, and, isNull } from 'drizzle-orm';
import { formatPhone, toCsv } from '../../core/csv.js';
import { timestampInZone } from '../../core/time.js';
import {
  households,
  responseDays,
  responseHeadcounts,
  responseVolunteerRoles,
  surveyResponses,
} from '../../db/schema/index.js';

/** Active responses of an event, oldest first, with household, days, headcounts and role codes. */
export async function listSurveyExportRows(db, eventId) {
  const base = await db
    .select({ response: surveyResponses, household: households })
    .from(surveyResponses)
    .innerJoin(households, eq(households.id, surveyResponses.householdId))
    .where(and(eq(surveyResponses.eventId, eventId), isNull(surveyResponses.deletedAt)))
    .orderBy(asc(surveyResponses.createdAt));

  const [days, headcounts, roles] = await Promise.all([
    db.select({ responseId: responseDays.responseId, eventDayId: responseDays.eventDayId, likelihood: responseDays.likelihood })
      .from(responseDays).innerJoin(surveyResponses, eq(surveyResponses.id, responseDays.responseId))
      .where(and(eq(surveyResponses.eventId, eventId), isNull(surveyResponses.deletedAt))),
    db.select({ responseId: responseHeadcounts.responseId, code: responseHeadcounts.bandCode, count: responseHeadcounts.count })
      .from(responseHeadcounts).innerJoin(surveyResponses, eq(surveyResponses.id, responseHeadcounts.responseId))
      .where(and(eq(surveyResponses.eventId, eventId), isNull(surveyResponses.deletedAt))),
    db.select({ responseId: responseVolunteerRoles.responseId, code: responseVolunteerRoles.roleCode })
      .from(responseVolunteerRoles).innerJoin(surveyResponses, eq(surveyResponses.id, responseVolunteerRoles.responseId))
      .where(and(eq(surveyResponses.eventId, eventId), isNull(surveyResponses.deletedAt))),
  ]);

  const group = (rows) => {
    const map = new Map();
    for (const row of rows) map.set(row.responseId, [...(map.get(row.responseId) ?? []), row]);
    return map;
  };
  const daysBy = group(days);
  const headcountsBy = group(headcounts);
  const rolesBy = group(roles);
  return base.map(({ response, household }) => ({
    response,
    household,
    days: daysBy.get(response.id) ?? [],
    headcounts: headcountsBy.get(response.id) ?? [],
    roleCodes: (rolesBy.get(response.id) ?? []).map((r) => r.code),
  }));
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Spreadsheet-safe CSV of the survey responses; labels come from the event's config snapshot. */
export function surveyCsv(event, eventDayRows, rows) {
  const survey = event.configSnapshot.survey;
  const label = (options, code) => options.find((o) => o.code === code)?.label ?? code;
  const weights = survey.likelihood_weights;
  const zone = event.timezone;

  const header = [
    'Submitted (ET)', 'Last updated (ET)', 'Name', 'Email', 'Mobile',
    ...eventDayRows.map((d) => d.label),
    ...survey.headcount_bands.map((b) => b.label),
    'Total people',
    ...eventDayRows.map((d) => `Weighted ${d.label}`),
    'Food', 'Volunteer roles', 'Cultural performance', 'Contribution per adult', 'Comments',
  ];

  const records = rows.map(({ response, household, days, headcounts, roleCodes }) => {
    const total = headcounts.reduce((sum, h) => sum + h.count, 0);
    const likelihoodByDay = new Map(days.map((d) => [d.eventDayId, d.likelihood]));
    return [
      timestampInZone(response.createdAt, zone),
      timestampInZone(response.updatedAt, zone),
      household.name,
      household.email,
      formatPhone(household.mobileE164),
      ...eventDayRows.map((d) => (likelihoodByDay.has(d.id) ? capitalize(likelihoodByDay.get(d.id)) : '')),
      ...survey.headcount_bands.map((b) => headcounts.find((h) => h.code === b.code)?.count ?? 0),
      total,
      ...eventDayRows.map((d) => (likelihoodByDay.has(d.id) ? total * weights[likelihoodByDay.get(d.id)] : 0).toFixed(2)),
      label(survey.food_options, response.foodCode),
      roleCodes.map((code) => label(survey.volunteer_roles, code)).join('; '),
      label(survey.cultural_options, response.culturalCode),
      label(survey.contribution_options, response.contributionCode),
      response.comments ?? '',
    ];
  });
  return toCsv([header, ...records]);
}
