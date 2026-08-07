-- Support knowledge: admin-added custom docs (manual text + YouTube).
-- Adds the original source URL for externally sourced docs.
ALTER TABLE support_knowledge_docs
  ADD COLUMN IF NOT EXISTS source_url text;
