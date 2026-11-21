import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType({ dataType: () => 'citext' });
const tstz = (name) => timestamp(name, { withTimezone: true });

export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull().unique(),
    name: text('name').notNull(),
    mobileE164: text('mobile_e164'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
    anonymizedAt: tstz('anonymized_at'),
  },
  (t) => [check('households_mobile_e164_check', sql`${t.mobileE164} ~ '^\\+[1-9][0-9]{7,14}$'`)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    surveyOpensAt: tstz('survey_opens_at').notNull(),
    surveyClosesAt: tstz('survey_closes_at').notNull(),
    configSnapshot: jsonb('config_snapshot').notNull(),
    configHash: text('config_hash').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('events_slug_check', sql`${t.slug} ~ '^[a-z0-9-]+$'`),
    check('events_survey_window_check', sql`${t.surveyClosesAt} > ${t.surveyOpensAt}`),
  ],
);

export const eventDays = pgTable(
  'event_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    dayDate: date('day_date').notNull(),
    label: text('label').notNull(),
    sort: integer('sort').notNull(),
  },
  (t) => [unique('event_days_event_id_day_date_unique').on(t.eventId, t.dayDate)],
);

export const changeHistory = pgTable(
  'change_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    actor: text('actor').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('change_history_action_check', sql`${t.action} in ('create','update','delete','restore','anonymize')`),
    index('change_history_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  ],
);

export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    foodCode: text('food_code').notNull(),
    culturalCode: text('cultural_code').notNull(),
    contributionCode: text('contribution_code').notNull(),
    comments: text('comments'),
    consentAt: tstz('consent_at').notNull(),
    editTokenHash: text('edit_token_hash').notNull().unique(),
    editTokenIssuedAt: tstz('edit_token_issued_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('survey_responses_comments_check', sql`char_length(${t.comments}) <= 2000`),
    uniqueIndex('ux_response_active').on(t.eventId, t.householdId).where(sql`${t.deletedAt} is null`),
  ],
);

export const responseDays = pgTable(
  'response_days',
  {
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponses.id),
    eventDayId: uuid('event_day_id')
      .notNull()
      .references(() => eventDays.id),
    likelihood: text('likelihood').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.responseId, t.eventDayId] }),
    check('response_days_likelihood_check', sql`${t.likelihood} in ('definitely','likely','maybe')`),
  ],
);

export const responseHeadcounts = pgTable(
  'response_headcounts',
  {
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponses.id),
    bandCode: text('band_code').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.responseId, t.bandCode] }),
    check('response_headcounts_count_check', sql`${t.count} between 0 and 100`),
  ],
);

export const responseVolunteerRoles = pgTable(
  'response_volunteer_roles',
  {
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponses.id),
    roleCode: text('role_code').notNull(),
  },
  (t) => [primaryKey({ columns: [t.responseId, t.roleCode] })],
);
