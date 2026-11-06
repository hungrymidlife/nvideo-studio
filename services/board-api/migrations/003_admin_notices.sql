-- Additive board V3 migration: administrator notices and stable pin ordering.
-- Apply to the existing Neon staging branch first, then production before API V3.
-- No existing posts are changed or deleted; all begin as ordinary posts.
BEGIN;
ALTER TABLE nvideo_board.posts
 ADD COLUMN IF NOT EXISTS is_notice boolean NOT NULL DEFAULT false;
ALTER TABLE nvideo_board.posts
 ADD COLUMN IF NOT EXISTS notice_at timestamptz;
CREATE INDEX IF NOT EXISTS nvideo_board_posts_notice_order_idx
 ON nvideo_board.posts(is_notice DESC,notice_at DESC NULLS LAST,id DESC)
 WHERE deleted_at IS NULL AND hidden_at IS NULL;
ALTER TABLE nvideo_board.posts
 ADD CONSTRAINT posts_public_notice_check
 CHECK (NOT is_notice OR NOT secret);
COMMIT;
