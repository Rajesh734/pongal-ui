CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "change_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "change_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_history_action_check" CHECK ("change_history"."action" in ('create','update','delete','restore','anonymize'))
);
--> statement-breakpoint
CREATE TABLE "event_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"day_date" date NOT NULL,
	"label" text NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "event_days_event_id_day_date_unique" UNIQUE("event_id","day_date")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"survey_opens_at" timestamp with time zone NOT NULL,
	"survey_closes_at" timestamp with time zone NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_slug_check" CHECK ("events"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "events_survey_window_check" CHECK ("events"."survey_closes_at" > "events"."survey_opens_at")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"mobile_e164" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "households_email_unique" UNIQUE("email"),
	CONSTRAINT "households_mobile_e164_check" CHECK ("households"."mobile_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_history_entity_idx" ON "change_history" USING btree ("entity_type","entity_id","created_at");