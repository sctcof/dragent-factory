-- Production metadata schema placeholder.
-- The local executable MVP uses local_data/metadata.json while preserving the
-- table names and contracts from docs/engineering-architecture.md.
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
