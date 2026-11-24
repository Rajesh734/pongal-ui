import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
    whatsappE164: text('whatsapp_e164'),
    whatsappConsentAt: tstz('whatsapp_consent_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
    anonymizedAt: tstz('anonymized_at'),
  },
  (t) => [
    check('households_mobile_e164_check', sql`${t.mobileE164} is null or ${t.mobileE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'households_whatsapp_consent_check',
      sql`(${t.whatsappE164} is null and ${t.whatsappConsentAt} is null) or (${t.whatsappE164} ~ '^\\+[1-9][0-9]{7,14}$' and ${t.whatsappConsentAt} is not null)`,
    ),
  ],
);

export const householdAuth = pgTable(
  'household_auth',
  {
    householdId: uuid('household_id')
      .primaryKey()
      .references(() => households.id),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub').unique(),
    emailVerifiedAt: tstz('email_verified_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('household_auth_method_check', sql`${t.passwordHash} is not null or ${t.googleSub} is not null`),
  ],
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

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    contactName: text('contact_name').notNull(),
    contactEmail: citext('contact_email').notNull(),
    contactMobileE164: text('contact_mobile_e164').notNull(),
    contactWhatsappE164: text('contact_whatsapp_e164'),
    whatsappConsentAt: tstz('whatsapp_consent_at'),
    status: text('status').notNull().default('payment_pending'),
    totalCents: integer('total_cents').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    check('registrations_status_check', sql`${t.status} in ('payment_pending','confirmed','cancelled')`),
    check('registrations_total_cents_check', sql`${t.totalCents} >= 0`),
    check('registrations_contact_mobile_e164_check', sql`${t.contactMobileE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'registrations_whatsapp_consent_check',
      sql`(${t.contactWhatsappE164} is null and ${t.whatsappConsentAt} is null) or (${t.contactWhatsappE164} ~ '^\\+[1-9][0-9]{7,14}$' and ${t.whatsappConsentAt} is not null)`,
    ),
    uniqueIndex('ux_registrations_active').on(t.eventId, t.householdId).where(sql`${t.deletedAt} is null`),
    index('registrations_event_status_idx').on(t.eventId, t.status),
  ],
);

export const registrationAttendees = pgTable(
  'registration_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    name: text('name').notNull(),
    ageBand: text('age_band').notNull(),
    feeCents: integer('fee_cents').notNull(),
    willingToVolunteer: boolean('willing_to_volunteer').notNull().default(false),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('registration_attendees_name_check', sql`char_length(trim(${t.name})) between 1 and 150`),
    check('registration_attendees_age_band_check', sql`${t.ageBand} in ('11_plus','5_to_10','under_5')`),
    check('registration_attendees_fee_cents_check', sql`${t.feeCents} >= 0`),
    index('registration_attendees_registration_idx').on(t.registrationId),
  ],
);

export const registrationPerformances = pgTable(
  'registration_performances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    title: text('title').notNull(),
    participantNames: text('participant_names').notNull(),
    participantCount: integer('participant_count').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    compereIntroduction: text('compere_introduction').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('registration_performances_title_check', sql`char_length(trim(${t.title})) between 1 and 150`),
    check('registration_performances_participants_check', sql`${t.participantCount} >= 1`),
    check(
      'registration_performances_duration_check',
      sql`(${t.participantCount} = 1 and ${t.durationMinutes} between 1 and 4) or (${t.participantCount} between 2 and 4 and ${t.durationMinutes} between 1 and 5) or (${t.participantCount} >= 5 and ${t.durationMinutes} between 1 and 7)`,
    ),
    check('registration_performances_intro_check', sql`char_length(trim(${t.compereIntroduction})) between 1 and 500`),
    index('registration_performances_registration_idx').on(t.registrationId),
  ],
);

export const registrationVolunteerRoles = pgTable(
  'registration_volunteer_roles',
  {
    attendeeId: uuid('attendee_id')
      .notNull()
      .references(() => registrationAttendees.id),
    roleCode: text('role_code').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.attendeeId, t.roleCode] }),
    check(
      'registration_volunteer_roles_code_check',
      sql`${t.roleCode} in ('culturals','food_serving_setup','stage_setup','compere_hosting','decoration','registration_desk','photography','cleanup','music_dj')`,
    ),
  ],
);

export const registrationPayments = pgTable(
  'registration_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .unique()
      .references(() => registrations.id),
    amountCents: integer('amount_cents').notNull(),
    status: text('status').notNull().default('pending'),
    payerName: text('payer_name'),
    zelleReference: text('zelle_reference'),
    declaredAt: tstz('declared_at'),
    confirmedBy: text('confirmed_by'),
    confirmedAt: tstz('confirmed_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('registration_payments_amount_check', sql`${t.amountCents} >= 0`),
    check('registration_payments_status_check', sql`${t.status} in ('pending','confirmed')`),
    check(
      'registration_payments_confirmation_check',
      sql`(${t.status} = 'pending' and ${t.confirmedBy} is null and ${t.confirmedAt} is null) or (${t.status} = 'confirmed' and ${t.confirmedBy} is not null and ${t.confirmedAt} is not null)`,
    ),
  ],
);

export const householdSessions = pgTable(
  'household_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => householdAuth.householdId),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    check('household_sessions_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
    index('household_sessions_household_idx').on(t.householdId),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => householdAuth.householdId),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    consumedAt: tstz('consumed_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('email_verification_tokens_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
    index('email_verification_tokens_household_idx').on(t.householdId),
  ],
);

export const registrationAccessTokens = pgTable(
  'registration_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('registration_access_tokens_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
    index('registration_access_tokens_registration_idx').on(t.registrationId),
  ],
);

export const registrationPasses = pgTable(
  'registration_passes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .unique()
      .references(() => registrations.id),
    tokenHash: text('token_hash').notNull().unique(),
    encryptedToken: text('encrypted_token').notNull(),
    encryptionIv: text('encryption_iv').notNull(),
    authTag: text('auth_tag').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    issuedAt: tstz('issued_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [check('registration_passes_key_version_check', sql`${t.keyVersion} >= 1`)],
);

export const registrationCheckIns = pgTable(
  'registration_check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registrationId: uuid('registration_id')
      .notNull()
      .unique()
      .references(() => registrations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    operatorHouseholdId: uuid('operator_household_id')
      .notNull()
      .references(() => householdAuth.householdId),
    checkedInAt: tstz('checked_in_at').notNull().defaultNow(),
  },
  (t) => [index('registration_check_ins_event_idx').on(t.eventId, t.checkedInAt)],
);

export const checkInPermissions = pgTable(
  'check_in_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => householdAuth.householdId),
    grantedBy: text('granted_by').notNull(),
    grantedAt: tstz('granted_at').notNull().defaultNow(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [
    uniqueIndex('ux_check_in_permissions_active').on(t.eventId, t.householdId).where(sql`${t.revokedAt} is null`),
    index('check_in_permissions_household_idx').on(t.householdId),
  ],
);
