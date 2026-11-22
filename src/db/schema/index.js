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
  timestamp,
  unique,
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
