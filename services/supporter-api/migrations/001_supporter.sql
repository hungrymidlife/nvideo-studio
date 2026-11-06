-- Apply to the SAME Neon database as the NVideo Studio authentication issuer.
-- Does not modify auth tables, membership plans, local libraries, or downloads.
BEGIN;
CREATE SCHEMA IF NOT EXISTS nvideo_support;
CREATE TABLE IF NOT EXISTS nvideo_support.donations (
 transaction_id text PRIMARY KEY,
 message_id text NOT NULL UNIQUE,
 email text NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS donations_active_email_idx
 ON nvideo_support.donations(email) WHERE revoked_at IS NULL;
COMMIT;
