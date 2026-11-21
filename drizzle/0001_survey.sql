CREATE TABLE "response_days" (
	"response_id" uuid NOT NULL,
	"event_day_id" uuid NOT NULL,
	"likelihood" text NOT NULL,
	CONSTRAINT "response_days_response_id_event_day_id_pk" PRIMARY KEY("response_id","event_day_id"),
	CONSTRAINT "response_days_likelihood_check" CHECK ("response_days"."likelihood" in ('definitely','likely','maybe'))
);
--> statement-breakpoint
CREATE TABLE "response_headcounts" (
	"response_id" uuid NOT NULL,
	"band_code" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "response_headcounts_response_id_band_code_pk" PRIMARY KEY("response_id","band_code"),
	CONSTRAINT "response_headcounts_count_check" CHECK ("response_headcounts"."count" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "response_volunteer_roles" (
	"response_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	CONSTRAINT "response_volunteer_roles_response_id_role_code_pk" PRIMARY KEY("response_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"food_code" text NOT NULL,
	"cultural_code" text NOT NULL,
	"contribution_code" text NOT NULL,
	"comments" text,
	"consent_at" timestamp with time zone NOT NULL,
	"edit_token_hash" text NOT NULL,
	"edit_token_issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "survey_responses_edit_token_hash_unique" UNIQUE("edit_token_hash"),
	CONSTRAINT "survey_responses_comments_check" CHECK (char_length("survey_responses"."comments") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "response_days" ADD CONSTRAINT "response_days_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_days" ADD CONSTRAINT "response_days_event_day_id_event_days_id_fk" FOREIGN KEY ("event_day_id") REFERENCES "public"."event_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_headcounts" ADD CONSTRAINT "response_headcounts_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_volunteer_roles" ADD CONSTRAINT "response_volunteer_roles_response_id_survey_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_response_active" ON "survey_responses" USING btree ("event_id","household_id") WHERE "survey_responses"."deleted_at" is null;