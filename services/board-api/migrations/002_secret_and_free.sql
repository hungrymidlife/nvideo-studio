-- Additive NVideo Board V2 migration. Apply to staging before production.
-- Existing posts remain public and plain-text, preserving all previous data.
BEGIN;
ALTER TABLE nvideo_board.posts ADD COLUMN IF NOT EXISTS secret boolean NOT NULL DEFAULT false;
ALTER TABLE nvideo_board.posts ADD COLUMN IF NOT EXISTS rich_content jsonb;
ALTER TABLE nvideo_board.posts DROP CONSTRAINT IF EXISTS posts_category_check;
ALTER TABLE nvideo_board.posts ADD CONSTRAINT posts_category_check
 CHECK (category IN ('feedback','question','suggestion','free'));
ALTER TABLE nvideo_board.posts ADD CONSTRAINT posts_secret_category_check
 CHECK (NOT secret OR category IN ('feedback','question','suggestion'));
ALTER TABLE nvideo_board.posts ADD CONSTRAINT posts_rich_content_check
 CHECK (rich_content IS NULL OR jsonb_typeof(rich_content)='object');
CREATE TABLE IF NOT EXISTS nvideo_board.admins (
 user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
 granted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE nvideo_board.admins IS 'Explicit NVideo Board admin allowlist. Grant by vetted UUID in Neon SQL console only. Never via public API.';
CREATE INDEX IF NOT EXISTS nvideo_board_posts_secret_idx
 ON nvideo_board.posts(secret,id DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;
COMMIT;
