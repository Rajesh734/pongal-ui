ALTER TABLE "registration_passes" ADD COLUMN "encrypted_token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_passes" ADD COLUMN "encryption_iv" text NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_passes" ADD COLUMN "auth_tag" text NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_passes" ADD COLUMN "key_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_passes" ADD CONSTRAINT "registration_passes_key_version_check" CHECK ("registration_passes"."key_version" >= 1);