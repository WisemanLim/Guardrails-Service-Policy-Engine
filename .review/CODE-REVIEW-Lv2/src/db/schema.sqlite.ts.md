# src/db/schema.sqlite.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ db_Abstract.md](./db_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: SQLite 스키마 DDL 문자열. `DbService.openSqlite()` 가 부트 시 `exec()` 로 실행.
- 진입점에서의 거리: 3 (DbService.openSqlite → schema)
- 라인 수: 81
- 주요 export: `POLICY_ENGINE_SQLITE_SCHEMA` (string)
- 의존 모듈 (internal): 없음
- 사용된 외부 패키지: 없음
- 부수효과: 없음 (단순 문자열 상수)
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 없음 (직접 테스트 어려움 — `DbService.listDomains` 등의 통합 테스트가 간접 검증)

---

```ts path=src/db/schema.sqlite.ts lines=1-12
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
```

```ts path=src/db/schema.sqlite.ts lines=13-25
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
```

```ts path=src/db/schema.sqlite.ts lines=27-34
INSERT OR IGNORE INTO domains
  (domain_key, display_name, description, regulation_tags, inherits_from)
VALUES
  ('global',
   '{"ko-KR":"공통(전역)","en":"Global"}',
   'Domain-agnostic privacy and safety baseline applied to every request.',
   '["KR_PIPA","EU_GDPR","US_CCPA","JP_APPI"]',
   '[]');
```

```ts path=src/db/schema.sqlite.ts lines=36-44
CREATE TABLE IF NOT EXISTS whitelists (
  id               TEXT PRIMARY KEY,
  domain           TEXT NOT NULL,
  locale           TEXT NOT NULL,
  category         TEXT NOT NULL,
  patterns         TEXT NOT NULL DEFAULT '[]',
  description      TEXT,
  score_adjustment REAL NOT NULL DEFAULT -0.1
);
```

```ts path=src/db/schema.sqlite.ts lines=46-68
CREATE TABLE IF NOT EXISTS rules (
  rule_id           TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  locale            TEXT NOT NULL,
  io_type           TEXT NOT NULL CHECK (io_type IN ('input','output','both')),
  category          TEXT NOT NULL,
  sub_category      TEXT,
  severity          TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  priority          INTEGER NOT NULL DEFAULT 100,
  action            TEXT NOT NULL,
  pattern_bundle    TEXT NOT NULL DEFAULT '{}',
  message_template  TEXT NOT NULL DEFAULT '{}',
  regulation_tags   TEXT NOT NULL DEFAULT '[]',
  examples_positive TEXT NOT NULL DEFAULT '[]',
  examples_negative TEXT NOT NULL DEFAULT '[]',
  enabled           INTEGER NOT NULL DEFAULT 1,
  version           TEXT NOT NULL DEFAULT '1.0.0',
  source            TEXT NOT NULL DEFAULT 'admin'
                     CHECK (source IN ('file','admin','csv')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_domain_locale_io ON rules(domain, locale, io_type) WHERE enabled = 1;
```

```ts path=src/db/schema.sqlite.ts lines=70-81
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
```

**분석 / Analysis (Level 2)**

- **L12 export const**: 백틱 문자열 상수. `DbService.openSqlite()` 가 `this.sqlite.exec(POLICY_ENGINE_SQLITE_SCHEMA)` 로 실행 → better-sqlite3 의 `exec` 는 다중 statement 를 한 번에 실행 가능.
- **L13-25 `domains` 테이블**:
  - `display_name`/`regulation_tags`/`inherits_from` 가 TEXT 컬럼이지만 JSON 문자열을 저장. SQLite 는 JSON 함수가 옵션이고 본 코드에는 사용처가 없음 — 단순 TEXT 저장 + Node 측에서 `JSON.parse`.
  - `CHECK (status IN ...)` — column-level enum 제약. Postgres `CHECK` 와 호환.
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))` — `datetime('now')` 는 UTC ISO 8601. Postgres `TIMESTAMPTZ` 와 의미상 호환 (timezone 정보 누락은 손실).
  - 흔한 실수: SQLite 의 default 표현식은 괄호 필수 — `DEFAULT (datetime('now'))` 로 정확.
- **L27-34 시드 INSERT**:
  - `global` 도메인을 부트 시 자동 시드. `INSERT OR IGNORE` 라 멱등.
  - JSON 문자열 리터럴이 SQL 문자열 내부에 있음 — 따옴표 escape 가 단순. (백틱 + 작은따옴표 + 큰따옴표 조합으로 충돌 없음.)
  - 흔한 실수: SQL 문자열 안의 JSON 키에 작은따옴표가 포함되면 깨질 수 있음 — 현재 시드값에는 없음. 미래 데이터 추가 시 주의.
- **L36-44 `whitelists`**:
  - `id` 가 TEXT PRIMARY KEY — UUID 가정. 자동 생성 안 함 — Node 측 또는 향후 admin write 시 채워야 함.
  - `score_adjustment REAL DEFAULT -0.1` — 화이트리스트 매치 시 점수 조정. 합리적 디폴트.
  - 흔한 실수: SQLite REAL 은 IEEE 754 double. 부동소수점 누적 정확도 이슈 가능성은 점수 결합 단계 (외부 서비스).
- **L46-67 `rules`**: 핵심 테이블.
  - 17 컬럼 (rule_id ~ updated_at).
  - 5개 JSON-encoded TEXT 컬럼 (`pattern_bundle`/`message_template`/`regulation_tags`/`examples_positive`/`examples_negative`).
  - `enabled INTEGER NOT NULL DEFAULT 1` — boolean 의 0/1 표현. `db.service.ts:172` 가 `r.enabled ? 1 : 0` 로 변환.
  - `source CHECK (source IN ('file','admin','csv'))` — 룰 출처 enum. `db.service.ts:149` 의 `source: 'file' | 'admin' | 'csv'` 와 일치.
  - **`updated_at` 자동 업데이트 트리거 부재** — 컬럼 default 가 `datetime('now')` 이지만 UPDATE 시 자동 갱신되지 않음. SQLite 에는 PostgreSQL 의 `ON UPDATE` 동등 기능이 없어 application 코드 또는 TRIGGER 가 필요. 현재 코드에는 UPDATE 경로가 없으므로 영향 없음 — admin write 추가 시 고려.
- **L68 인덱스**:
  - 부분 인덱스 `WHERE enabled = 1`. `listAllRules` 가 `WHERE enabled = 1` 만 조회하므로 정확히 일치. 좋은 선택.
  - 도메인 + locale + ioType 3-tuple — `mergeRules` 가 필요로 하는 모든 필터를 커버.
- **L70-80 `policy_versions`**:
  - 정책 버전 스냅샷 저장용. `bundle TEXT NOT NULL` — 컴파일된 번들의 JSON 직렬화 저장 의도.
  - `UNIQUE (domain, version)` — 동일 도메인 + 버전 중복 차단.
  - **현재 사용처 없음** — `DbService` 에 `policy_versions` 를 다루는 메서드가 없다. 미래 admin 기능 대비 스키마.

**짚어볼 점 / Watch-outs**

1. **Postgres DDL 과의 동기화 부재** — 본 레포에는 SQLite DDL 만 있음. Postgres DDL 은 다른 레포 (`init-db.sql`) 에 있음. 컬럼 추가/제약 변경 시 두 곳을 수동 동기화 필요. 표류 위험.
2. **`policy_versions` 데드 코드** — 현재 사용처 없음. 미래 의도라면 주석으로 명시 권장.
3. **타임존 손실** — `datetime('now')` 는 UTC 만. Postgres `TIMESTAMPTZ` 와 의미 차이.
4. **`source CHECK` 의 `'admin'` 디폴트** — `bulkInsertRules` 의 `source` 파라미터가 명시되지 않으면 `'admin'` 으로 저장. 호출자가 `'file'` 명시 — 현재 의도 일치하지만 새 호출자 추가 시 default 가 'file' 이 더 안전할 수 있음.
5. **`description` 컬럼 부재 in `rules`** — `policy.types.ts:27` 의 `description: z.string()` 와 불일치. application 측에서 빈 문자열로 채움 (`policies.service.ts:116`).
6. **`io_type CHECK` enum** — Postgres 의 ENUM 타입과 의미 일치. 추가 액션값(`route` 등)이 들어와도 `action` 컬럼은 무제약 — `policy.types.ts:5-18` 의 zod enum 에서만 검증.
7. **`rules.action` 에 CHECK 제약 없음** — DB 가 임의 action 문자열 수락. application 측 zod 가 마지막 방어선.

---

**파일 단위 판정**

- 강점:
  1. 명시적 디폴트값과 CHECK 제약으로 row-level invariant 유지.
  2. 부분 인덱스 `WHERE enabled=1` 가 실제 쿼리 패턴과 일치.
  3. JSDoc 으로 Postgres 와의 차이점 명시.
- 위험:
  1. Postgres DDL 과 표류 가능성.
  2. `policy_versions` 데드 코드.
  3. `rules.action` CHECK 부재.
- 개선 권고:
  1. Postgres DDL 을 본 레포로 통합하거나 generator 로 단일 소스 화.
  2. `policy_versions` 사용처 추가 또는 제거.
  3. `rules.action` 에 CHECK enum 추가 (zod Action 과 동기화).
- 재읽기 권고 레벨: 2 (스키마 변경 시 필수).
