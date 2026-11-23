CREATE TABLE "registration_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"name" text NOT NULL,
	"age_band" text NOT NULL,
	"fee_cents" integer NOT NULL,
	"willing_to_volunteer" text DEFAULT 'no' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_attendees_name_check" CHECK (char_length(trim("registration_attendees"."name")) between 1 and 150),
	CONSTRAINT "registration_attendees_age_band_check" CHECK ("registration_attendees"."age_band" in ('11_plus','5_to_10','under_5')),
	CONSTRAINT "registration_attendees_fee_cents_check" CHECK ("registration_attendees"."fee_cents" >= 0),
	CONSTRAINT "registration_attendees_volunteer_check" CHECK ("registration_attendees"."willing_to_volunteer" in ('yes','no'))
);
--> statement-breakpoint
CREATE TABLE "registration_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payer_name" text,
	"zelle_reference" text,
	"declared_at" timestamp with time zone,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_payments_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "registration_payments_amount_check" CHECK ("registration_payments"."amount_cents" >= 0),
	CONSTRAINT "registration_payments_status_check" CHECK ("registration_payments"."status" in ('pending','confirmed')),
	CONSTRAINT "registration_payments_confirmation_check" CHECK (("registration_payments"."status" = 'pending' and "registration_payments"."confirmed_by" is null and "registration_payments"."confirmed_at" is null) or ("registration_payments"."status" = 'confirmed' and "registration_payments"."confirmed_by" is not null and "registration_payments"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "registration_performances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"title" text NOT NULL,
	"participant_names" text NOT NULL,
	"participant_count" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"compere_introduction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_performances_title_check" CHECK (char_length(trim("registration_performances"."title")) between 1 and 150),
	CONSTRAINT "registration_performances_participants_check" CHECK ("registration_performances"."participant_count" >= 1),
	CONSTRAINT "registration_performances_duration_check" CHECK ("registration_performances"."duration_minutes" between 1 and 7),
	CONSTRAINT "registration_performances_intro_check" CHECK (char_length(trim("registration_performances"."compere_introduction")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "registration_volunteer_roles" (
	"attendee_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	CONSTRAINT "registration_volunteer_roles_attendee_id_role_code_pk" PRIMARY KEY("attendee_id","role_code"),
	CONSTRAINT "registration_volunteer_roles_code_check" CHECK ("registration_volunteer_roles"."role_code" in ('culturals','food_serving_setup','stage_setup','compere_hosting','decoration','registration_desk','photography','cleanup','music_dj'))
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" "citext" NOT NULL,
	"contact_mobile_e164" text NOT NULL,
	"contact_whatsapp_e164" text,
	"whatsapp_consent_at" timestamp with time zone,
	"status" text DEFAULT 'payment_pending' NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "registrations_status_check" CHECK ("registrations"."status" in ('payment_pending','confirmed','cancelled')),
	CONSTRAINT "registrations_total_cents_check" CHECK ("registrations"."total_cents" >= 0),
	CONSTRAINT "registrations_contact_mobile_e164_check" CHECK ("registrations"."contact_mobile_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "registrations_whatsapp_consent_check" CHECK (("registrations"."contact_whatsapp_e164" is null and "registrations"."whatsapp_consent_at" is null) or ("registrations"."contact_whatsapp_e164" ~ '^\+[1-9][0-9]{7,14}$' and "registrations"."whatsapp_consent_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "registration_attendees" ADD CONSTRAINT "registration_attendees_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_payments" ADD CONSTRAINT "registration_payments_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_performances" ADD CONSTRAINT "registration_performances_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_volunteer_roles" ADD CONSTRAINT "registration_volunteer_roles_attendee_id_registration_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."registration_attendees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_attendees_registration_idx" ON "registration_attendees" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "registration_performances_registration_idx" ON "registration_performances" USING btree ("registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_registrations_active" ON "registrations" USING btree ("event_id","household_id") WHERE "registrations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "registrations_event_status_idx" ON "registrations" USING btree ("event_id","status");