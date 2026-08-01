-- Target metadata schema for dragent-factory (PostgreSQL + pgvector).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  collection text NOT NULL,
  item_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, item_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents (deleted_at);

CREATE TABLE IF NOT EXISTS model_config (
  id text PRIMARY KEY DEFAULT 'default',
  payload jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  kind text NOT NULL,
  ragflow_kb_id text,
  name text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  asset_id text,
  kb_id text,
  project_id text NOT NULL,
  object_key text,
  position_ref text,
  text text NOT NULL DEFAULT '',
  embedding_version text,
  embedding vector(1536),
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_chunks_asset_id ON chunks (asset_id);
CREATE INDEX IF NOT EXISTS idx_chunks_kb_id ON chunks (kb_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project_id ON chunks (project_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  actor_id text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO projects (id, name)
VALUES ('p_local', 'Local Project')
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_config (id, payload)
VALUES ('default', '{}')
ON CONFLICT (id) DO NOTHING;
