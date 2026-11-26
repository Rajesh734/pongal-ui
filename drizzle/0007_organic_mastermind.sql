CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_household_id_household_auth_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_auth"("household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_household_idx" ON "password_reset_tokens" USING btree ("household_id");