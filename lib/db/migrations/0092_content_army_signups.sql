-- Content Army Masterclass coming-soon waitlist signups.
-- Collected via the public landing-page /contentarmy page (first name, email, phone).

CREATE TABLE IF NOT EXISTS "content_army_signups" (
  "id" serial PRIMARY KEY NOT NULL,
  "first_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "source" text,
  "client_ip_address" text,
  "client_user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "content_army_signups_email_unique" UNIQUE("email")
);
