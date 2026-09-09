CREATE TABLE "auth_rate_limit_buckets" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"resetAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limit_buckets_reset_idx" ON "auth_rate_limit_buckets" USING btree ("resetAt");
