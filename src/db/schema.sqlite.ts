/**
 * SQLite schema for the Policy Engine (local / lightweight ops).
 *
 * Differences from the Postgres schema:
 *   - JSONB / TEXT[] → TEXT (JSON-encoded)
 *   - gen_random_uuid() → UUID generated in Node
 *   - TIMESTAMPTZ → TEXT (ISO 8601 via datetime('now'))
 *   - BYTEA → BLOB
 *
 * Bootstrapped lazily by DbService on first boot when DB_DRIVER=sqlite.
 */
export const POLICY_ENGINE_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS domains (
  domain_key      TEXT PRIMARY KEY,
  parent_key      TEXT,
  display_name    TEXT NOT NULL DEFAULT '{}',
  description     TEXT,
  default_locales TEXT NOT NULL DEFAULT '["ko-KR","en"]',
  regulation_tags TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','beta','deprecated')),
  inherits_from   TEXT NOT NULL DEFAULT '[]',
  version         TEXT NOT NULL DEFAULT '0.0.1',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO domains
  (domain_key, display_name, description, regulation_tags, inherits_from)
VALUES
  ('global',
   '{"ko-KR":"공통(전역)","en":"Global"}',
   'Domain-agnostic privacy and safety baseline applied to every request.',
   '["KR_PIPA","EU_GDPR","US_CCPA","JP_APPI"]',
   '[]');

CREATE TABLE IF NOT EXISTS whitelists (
  id               TEXT PRIMARY KEY,
  domain           TEXT NOT NULL,
  locale           TEXT NOT NULL,
  category         TEXT NOT NULL,
  patterns         TEXT NOT NULL DEFAULT '[]',
  description      TEXT,
  score_adjustment REAL NOT NULL DEFAULT -0.1
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id         TEXT PRIMARY KEY,
  domain     TEXT NOT NULL,
  version    TEXT NOT NULL,
  bundle     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('draft','staged','active','archived')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (domain, version)
);
`;
