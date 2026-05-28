CREATE TABLE IF NOT EXISTS "_schema_version" (
	"version" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
