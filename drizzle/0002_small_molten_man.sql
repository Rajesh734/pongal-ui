CREATE TABLE "household_auth" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_auth_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "household_auth_method_check" CHECK ("household_auth"."password_hash" is not null or "household_auth"."google_sub" is not null)
);
--> statement-breakpoint
ALTER TABLE "households" DROP CONSTRAINT "households_mobile_e164_check";--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "whatsapp_e164" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "whatsapp_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "household_auth" ADD CONSTRAINT "household_auth_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_whatsapp_consent_check" CHECK (("households"."whatsapp_e164" is null and "households"."whatsapp_consent_at" is null) or ("households"."whatsapp_e164" ~ '^\+[1-9][0-9]{7,14}$' and "households"."whatsapp_consent_at" is not null));--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_mobile_e164_check" CHECK ("households"."mobile_e164" is null or "households"."mobile_e164" ~ '^\+[1-9][0-9]{7,14}$');