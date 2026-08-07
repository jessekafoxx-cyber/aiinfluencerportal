-- Task #689: Admin Announcements composer.
--
-- Adds two tables that power the Room30 portal-wide announcements feature:
--
--   * `announcements` - admin-authored items (title + sanitized body HTML,
--     optional media stored under PRIVATE_OBJECT_DIR/uploads/..., optional
--     CTA button, audience all-users vs admins-only, draft/publish
--     lifecycle).
--   * `announcement_dismissals` - per-user dismiss records so the bell
--     badge clears after the user closes a banner.
--
-- Schema-only delta (no UPDATE). Safe to apply via the migration runner OR
-- via Publish (drizzle-kit push).

CREATE TABLE IF NOT EXISTS announcements (
  id           serial PRIMARY KEY,
  title        text NOT NULL,
  body_html    text NOT NULL DEFAULT '',
  media_path   text,
  media_kind   text,
  cta_label    text,
  cta_href     text,
  cta_new_tab  boolean NOT NULL DEFAULT true,
  audience     text NOT NULL DEFAULT 'all',
  status       text NOT NULL DEFAULT 'draft',
  published_at timestamp,
  created_by_id integer,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_status_idx ON announcements (status);
CREATE INDEX IF NOT EXISTS announcements_published_at_idx ON announcements (published_at);

-- Tolerant of an earlier 2-state version of the table that did not include
-- cta_new_tab. Safe no-op when re-applied.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_new_tab boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS announcement_dismissals (
  id              serial PRIMARY KEY,
  announcement_id integer NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  portal_user_id  integer NOT NULL,
  dismissed_at    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS announcement_dismissals_uq
  ON announcement_dismissals (announcement_id, portal_user_id);
CREATE INDEX IF NOT EXISTS announcement_dismissals_user_idx
  ON announcement_dismissals (portal_user_id);
