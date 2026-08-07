CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS support_knowledge_docs (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  lesson_slug TEXT NOT NULL,
  lesson_title TEXT NOT NULL,
  phase_title TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_knowledge_docs_source_lesson_uq
  ON support_knowledge_docs (source_type, lesson_slug);

CREATE TABLE IF NOT EXISTS support_knowledge_chunks (
  id SERIAL PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES support_knowledge_docs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_knowledge_chunks_doc_idx
  ON support_knowledge_chunks (doc_id);
