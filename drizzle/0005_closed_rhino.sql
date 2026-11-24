CREATE TABLE "check_in_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_verification_tokens_expiry_check" CHECK ("email_verification_tokens"."expires_at" > "email_verification_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "household_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "household_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "household_sessions_expiry_check" CHECK ("household_sessions"."expires_at" > "household_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "registration_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_access_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "registration_access_tokens_expiry_check" CHECK ("registration_access_tokens"."expires_at" > "registration_access_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "registration_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"operator_household_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_check_ins_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "registration_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "registration_passes_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "registration_passes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "check_in_permissions" ADD CONSTRAINT "check_in_permissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_permissions" ADD CONSTRAINT "check_in_permissions_household_id_household_auth_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_auth"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_household_id_household_auth_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_auth"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_sessions" ADD CONSTRAINT "household_sessions_household_id_household_auth_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_auth"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_access_tokens" ADD CONSTRAINT "registration_access_tokens_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_check_ins" ADD CONSTRAINT "registration_check_ins_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_check_ins" ADD CONSTRAINT "registration_check_ins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_check_ins" ADD CONSTRAINT "registration_check_ins_operator_household_id_household_auth_household_id_fk" FOREIGN KEY ("operator_household_id") REFERENCES "public"."household_auth"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_passes" ADD CONSTRAINT "registration_passes_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_check_in_permissions_active" ON "check_in_permissions" USING btree ("event_id","household_id") WHERE "check_in_permissions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "check_in_permissions_household_idx" ON "check_in_permissions" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_household_idx" ON "email_verification_tokens" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "household_sessions_household_idx" ON "household_sessions" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "registration_access_tokens_registration_idx" ON "registration_access_tokens" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "registration_check_ins_event_idx" ON "registration_check_ins" USING btree ("event_id","checked_in_at");