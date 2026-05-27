# src/db/db.service.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ db_Abstract.md](./db_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: Postgres ↔ SQLite 듀얼 드라이버 파사드. 도메인 목록, 룰 카운트/벌크 insert, 룰 list, 화이트리스트 조회.
- 진입점에서의 거리: 2 (DbModule → DbService)
- 라인 수: 306 (≤600 임계 미만이므로 블록 모드 미적용)
- 주요 export: `DbService`, `DomainRow`, `WhitelistRow`
- 의존 모듈 (internal): `./schema.sqlite`
- 사용된 외부 패키지: `@nestjs/common`, `fs`, `path`, `pg`, `better-sqlite3` (동적 import)
- 부수효과: Postgres `Pool` 생성, SQLite 파일 열기 + DDL 실행, `SELECT 1` 헬스체크
- 동시성 모델: NestJS DI 의 단일 인스턴스. Postgres Pool 은 자체 동시성 관리. SQLite better-sqlite3 는 sync API — 동일 프로세스에서 직렬화.
- 테스트 커버리지 흔적: 없음 (집중 테스트 갭. [INDEX.md §4.5](../../INDEX.md))

---

```ts path=src/db/db.service.ts lines=1-22
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Pool } from 'pg';
import { POLICY_ENGINE_SQLITE_SCHEMA } from './schema.sqlite';

export interface DomainRow {
  domain_key: string;
  status: string;
  version: string;
}

export interface WhitelistRow {
  id: string;
  domain: string;
  locale: string;
  category: string;
  patterns: string[];
  score_adjustment: number;
}

type Driver = 'postgres' | 'sqlite';
```

```ts path=src/db/db.service.ts lines=24-52
/**
 * Backend-neutral DB facade for the Policy Engine.
 *  ...
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  readonly driver: Driver;
  private pg?: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sqlite?: any;
  private _available = false;
  private readonly sqlitePath: string;

  constructor() {
    this.driver = ((process.env.DB_DRIVER ?? 'postgres').toLowerCase() === 'sqlite' ? 'sqlite' : 'postgres');
    this.sqlitePath = process.env.SQLITE_PATH ?? './var/policy-engine.db';
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 'sqlite') await this.openSqlite();
    else await this.openPostgres();
  }

  isAvailable(): boolean {
    return this._available;
  }
```

```ts path=src/db/db.service.ts lines=58-89
  private async openSqlite(): Promise<void> {
    try {
      const Database = (await import('better-sqlite3')).default;
      mkdirSync(dirname(this.sqlitePath), { recursive: true });
      this.sqlite = new Database(this.sqlitePath);
      this.sqlite.pragma('journal_mode = WAL');
      this.sqlite.pragma('synchronous = NORMAL');
      this.sqlite.exec(POLICY_ENGINE_SQLITE_SCHEMA);
      this._available = true;
      this.log.log(`SQLite ready at ${this.sqlitePath}`);
    } catch (e) {
      this.log.warn(`SQLite open failed: ${(e as Error).message}`);
    }
  }

  private async openPostgres(): Promise<void> {
    this.pg = new Pool({
      host: process.env.POSTGRES_HOST ?? '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? 'guardrails',
      user: process.env.POSTGRES_USER ?? 'guardrails',
      password: process.env.POSTGRES_PASSWORD ?? 'guardrails',
      max: 10,
    });
    try {
      await this.pg.query('SELECT 1');
      this._available = true;
      this.log.log('Postgres connected');
    } catch (e) {
      this.log.warn(`Postgres unavailable: ${(e as Error).message} — running file-only mode.`);
    }
  }
```

```ts path=src/db/db.service.ts lines=93-123
  async listDomains(): Promise<DomainRow[]> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      return this.sqlite
        .prepare('SELECT domain_key, status, version FROM domains ORDER BY domain_key')
        .all() as DomainRow[];
    }
    const res = await this.pg!.query<DomainRow>(
      'SELECT domain_key, status, version FROM domains ORDER BY domain_key',
    );
    return res.rows;
  }

  async countRulesByDomain(domain: string): Promise<number> {
    if (!this._available) return 0;
    if (this.driver === 'sqlite') {
      const row = this.sqlite
        .prepare('SELECT COUNT(*) AS c FROM rules WHERE domain = ?')
        .get(domain) as { c: number };
      return row?.c ?? 0;
    }
    const res = await this.pg!.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM rules WHERE domain = $1',
      [domain],
    );
    return Number(res.rows[0]?.count ?? 0);
  }
```

```ts path=src/db/db.service.ts lines=130-201
  async bulkInsertRules(
    rules: Array<{ /* 16 fields */ }>,
    source: 'file' | 'admin' | 'csv' = 'file',
  ): Promise<number> {
    if (!this._available || rules.length === 0) return 0;
    let inserted = 0;
    if (this.driver === 'sqlite') {
      const stmt = this.sqlite.prepare(
        `INSERT OR IGNORE INTO rules (...) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const tx = this.sqlite.transaction((rows: typeof rules) => {
        for (const r of rows) {
          const info = stmt.run(
            r.rule_id, r.domain, r.locale, r.io_type, r.category, r.sub_category,
            r.severity, r.priority, r.action,
            JSON.stringify(r.pattern_bundle ?? {}),
            JSON.stringify(r.message_template ?? {}),
            JSON.stringify(r.regulation_tags ?? []),
            JSON.stringify(r.examples_positive ?? []),
            JSON.stringify(r.examples_negative ?? []),
            r.enabled ? 1 : 0, r.version, source,
          );
          if (info.changes > 0) inserted++;
        }
      });
      tx(rules);
      return inserted;
    }
    for (const r of rules) {
      const res = await this.pg!.query(
        `INSERT INTO rules (...) VALUES ($1,...,$17) ON CONFLICT (rule_id) DO NOTHING`,
        [...],
      );
      inserted += res.rowCount ?? 0;
    }
    return inserted;
  }
```

```ts path=src/db/db.service.ts lines=203-272
  async listAllRules(): Promise<Array<{ /* 15 fields */ }>> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      const rows = this.sqlite.prepare('SELECT * FROM rules WHERE enabled = 1').all() as Array<{...}>;
      return rows.map((r) => ({
        ...r,
        enabled: !!r.enabled,
        pattern_bundle: r.pattern_bundle ? JSON.parse(r.pattern_bundle) : {},
        message_template: r.message_template ? JSON.parse(r.message_template) : {},
        regulation_tags: r.regulation_tags ? JSON.parse(r.regulation_tags) : [],
        examples_positive: r.examples_positive ? JSON.parse(r.examples_positive) : [],
        examples_negative: r.examples_negative ? JSON.parse(r.examples_negative) : [],
      }));
    }
    const res = await this.pg!.query(
      'SELECT rule_id, domain, locale, io_type, category, sub_category, severity, priority, action, pattern_bundle, message_template, regulation_tags, examples_positive, examples_negative, enabled, version FROM rules WHERE enabled = TRUE',
    );
    return res.rows as unknown as Array<{...}>;
  }
```

```ts path=src/db/db.service.ts lines=274-306
  async listWhitelist(domain: string, locale: string): Promise<WhitelistRow[]> {
    if (!this._available) return [];
    if (this.driver === 'sqlite') {
      const rows = this.sqlite
        .prepare(
          'SELECT id, domain, locale, category, patterns, score_adjustment FROM whitelists WHERE domain = ? AND locale = ?',
        )
        .all(domain, locale) as Array<Omit<WhitelistRow, 'patterns'> & { patterns: string }>;
      return rows.map((r) => ({
        ...r,
        patterns: r.patterns ? (JSON.parse(r.patterns) as string[]) : [],
        score_adjustment: Number(r.score_adjustment),
      }));
    }
    const res = await this.pg!.query<{...}>(
      'SELECT id, domain, locale, category, patterns, score_adjustment FROM whitelists WHERE domain = $1 AND locale = $2',
      [domain, locale],
    );
    return res.rows.map((r) => ({ ...r, score_adjustment: Number(r.score_adjustment) }));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pg) await this.pg.end().catch(() => undefined);
    if (this.sqlite) this.sqlite.close();
  }
}
```

**분석 / Analysis (Level 2)**

- **L1-5 imports**: `Pool` 은 정적 import (Postgres 가 디폴트). `better-sqlite3` 는 옵셔널 의존성처럼 동적 `await import()` 사용 (L60) — Postgres 모드에서 sqlite 모듈이 없어도 부트 실패하지 않게 하는 의도. 단, `package.json` 에는 dependency 로 선언되어 있어 실제로 옵셔널은 아니다.
- **L7-20 인터페이스**: `DomainRow`, `WhitelistRow` 는 row-level DTO. Postgres `patterns` 는 `TEXT[]`, SQLite 는 JSON 문자열이지만 외부 시그니처는 `string[]` 으로 통일. 호출자(`WhitelistService`)가 driver 를 의식하지 않게 한다.
- **L22 `type Driver`**: 리터럴 유니온. 런타임 검증은 L45 의 삼항.
- **L36-37 `log`/`driver`**: `driver` 는 `readonly` 로 노출 — 컨트롤러가 `db.driver` 로 메타 정보를 응답에 포함 (`domains.controller.ts:12`, `health.controller.ts:15`).
- **L38-40 `pg?` / `sqlite?: any`**: 둘 다 옵셔널. `sqlite?: any` 는 better-sqlite3 의 default export 타입 추론을 포기. eslint 비활성 코멘트로 명시 — 보수적이고 합리적이다. 다만 `any` 라서 메서드 호출에서 타입 안전성 0.
- **L44-47 생성자**: `process.env.DB_DRIVER` 를 lowercase 후 `sqlite` 이면 sqlite, 아니면 무조건 postgres (defensive default). `SQLITE_PATH` 기본값 `./var/policy-engine.db` — 컨테이너 작업 디렉토리 기준.
  - 흔한 실수: `==='sqlite'` 비교 누락으로 `DB_DRIVER=sqlite3` 같은 오타가 silent postgres fallthrough 를 일으킨다. 본 코드는 정확히 `sqlite` 만 허용 → 안전한 선택.
- **L49-52 `onModuleInit`**: NestJS DI 가 모듈 트리 빌드 후 호출. await 가 `bootstrap()` 의 `app.listen()` 전에 완료된다.
- **L58-71 `openSqlite`**:
  - `await import('better-sqlite3')` — 동적 import. `.default` 로 클래스 추출.
  - `mkdirSync(dirname, recursive:true)` — 경로 디렉토리 보장. 동기 호출 — 부트에서 한 번이므로 무해.
  - `pragma('journal_mode=WAL')` — 동시 read+write 안전성. `synchronous=NORMAL` — write 후 fsync 빈도 감소 (속도 ↑, crash safety ↓ 가능). 운영 SQLite 에서는 일반적 조합.
  - `this.sqlite.exec(SCHEMA)` — DDL 한 번에 실행. `CREATE TABLE IF NOT EXISTS` 라 멱등.
  - 흔한 실수: try/catch 가 transparent 실패 — `_available = false` 로 남아 호출자가 빈 결과를 받는다. [INDEX.md §4.1 fail-open](../../INDEX.md) 패턴.
- **L73-89 `openPostgres`**:
  - `new Pool({...})` 는 즉시 생성 (커넥션 미수립). `pg.query('SELECT 1')` 가 실제 헬스체크.
  - `max:10` — Pool 사이즈. 트래픽이 높지 않다면 합리적. 변경하려면 env 추가 필요.
  - 실패 시 `pg` 변수는 유지 — 후속 호출에서 `this.pg!` non-null assertion 이 사용되지만 `_available=false` 가드로 진입 차단.
  - 흔한 실수: `Pool` 생성 자체는 비동기 IO 가 아님. 헬스체크 단계에서 DNS / TCP 실패가 잡힌다 — 부트 단계에서 명시적 검증을 한 점은 좋음.
- **L93-104 `listDomains`**:
  - `!this._available` 가드 → 빈 배열. SQLite `prepare().all()` 은 sync — Postgres async 와 다르나 메서드 시그니처는 `Promise<DomainRow[]>` 통일.
  - **흔한 실수**: SQLite 쪽은 `prepare` 결과를 캐싱하지 않음. better-sqlite3 의 `prepare` 는 statement cache 가 있어 재사용 시 빠르지만, 매 호출마다 새 `prepare` 호출 자체의 비용은 미미.
- **L110-123 `countRulesByDomain`**:
  - SQLite: `SELECT COUNT(*) AS c` — 즉시 평가.
  - Postgres: `COUNT(*)::text` 로 캐스팅. `pg` 라이브러리는 `bigint` 를 string 으로 반환하므로 `text` 캐스팅 + `Number()` 변환은 매우 큰 카운트(>2^53)에서 정밀도 손실 위험. 룰 개수 도메인당 수만 단위면 안전.
  - `row?.c ?? 0` — SQLite 결과 옵셔널 체이닝. `COUNT(*)` 는 항상 행을 반환하므로 가드는 과방어.
- **L130-201 `bulkInsertRules`** (핵심 위험):
  - SQLite: `INSERT OR IGNORE` + `this.sqlite.transaction(fn)` — 단일 트랜잭션 보장. `info.changes > 0` 으로 실제 삽입 수 카운트.
  - **Postgres 위험**: L180 `for (const r of rules) await pg.query(...)` — **트랜잭션 미적용**. 루프 중간 실패 시 부분 삽입 잔존. [INDEX.md §4.3 #2](../../INDEX.md) 핫스팟.
    - 흔한 실수: `INSERT ... ON CONFLICT DO NOTHING` 가 트랜잭션 처럼 보이지만 statement 단위 atomicity 만 보장. 룰 245건 시드 중 100번째에서 disconnect 가 나면 99건 commit 됨.
  - **잠재 SQL 인젝션 없음** — 두 드라이버 모두 parameterized query.
  - JSON 컬럼 처리: SQLite 는 직렬화 명시 (`JSON.stringify`), Postgres 는 객체 그대로 전달 (드라이버가 JSONB 자동 변환). Postgres `TEXT[]` 컬럼은 JS 배열을 직접 전달해도 `pg` 가 변환.
  - **흔한 실수**: SQLite 분기에서 `r.enabled ? 1 : 0` 명시 — boolean → int 변환을 잊으면 better-sqlite3 가 boolean bind 를 reject 한다.
- **L203-272 `listAllRules`**:
  - SQLite: `SELECT *` — 모든 컬럼 반환. row level 매핑에서 5개 JSON 컬럼 deserialize + `enabled` boolean 화. 한 행의 손상된 JSON 이 `JSON.parse` throw → 전체 호출이 throw. 가드 없음 (위험: 한 행이 전체 다운).
  - Postgres: 명시 컬럼 SELECT (sub_category 포함). row 그대로 반환 — 캐스트 `as unknown as ...` 로 타입 일치 가정. driver 가 JSONB/TEXT[] → 객체/배열 변환을 처리.
  - **흔한 실수**: `WHERE enabled = 1` (sqlite) vs `enabled = TRUE` (postgres) — 두 표현이 서로 호환되지 않음. SQLite 는 boolean 타입이 없고 INTEGER 0/1 — 코드는 정확.
- **L274-300 `listWhitelist`**:
  - SQLite: `patterns` 컬럼 JSON parse + `score_adjustment` 를 `Number()` 변환. SQLite REAL 은 이미 number 이므로 무해.
  - Postgres: `score_adjustment` 가 `numeric` 또는 `decimal` 일 가능성 → `pg` 가 string 으로 반환 → `Number()` 변환은 필수. 안전한 처리.
- **L302-305 `onModuleDestroy`**:
  - Postgres pool 종료 시 `.catch(()=>undefined)` 로 에러 swallow — 셧다운 경로에서는 합리적.
  - SQLite `close()` 는 sync.
  - 흔한 실수: `app.enableShutdownHooks()` (`main.ts:9`) 호출이 없으면 NestJS 가 `onModuleDestroy` 를 호출하지 않는다. 본 레포는 `main.ts:9` 에서 활성화 — 정상.

**짚어볼 점 / Watch-outs**

1. **Postgres `bulkInsertRules` 트랜잭션 부재** — 부분 시드 위험.
2. **SQLite 손상 JSON** — `JSON.parse` throw 시 전체 호출 실패. 컬럼별 try/catch + 기본값 권장.
3. **`_available` flag 가 healthcheck 후 다시 확인되지 않음** — Postgres 가 부트 후 잠시 다운되었다가 복구된 경우에도 `_available` 은 false 유지. Pool 은 reconnect 시도하지만 flag 는 갱신 안 됨.
4. **driver 결정이 부트 시 확정** — 동적 전환 불가. 의도된 설계.
5. **SQL 인젝션**: 모든 호출이 parameterized — 안전.
6. **시크릿 노출**: Postgres password 가 env 에서 읽힘. 기본값 `'guardrails'` 는 dev 전용 — 운영 배포에서 반드시 override 필요.
7. **`as any` (L40)** — sqlite 객체 전체 타입 안전성 포기. `Database.Database` 타입을 import 하면 안전성 개선 가능.
8. **Postgres `count::text → Number()`** — 안전 범위(<2^53) 가정.
9. **resource leak**: SQLite `Database` 인스턴스의 다중 open 가능성? `onModuleInit` 은 단일 호출 보장 (NestJS lifecycle). 안전.

---

**파일 단위 판정**

- 강점:
  1. driver 추상화 깨끗 — 호출자(`PoliciesService`, `WhitelistService`) 가 driver 의식 안 함.
  2. 두 드라이버 모두 `_available` flag 와 fail-open 동작 일관.
  3. SQLite 트랜잭션 적용 (벌크 insert) — 좋은 패턴.
- 위험:
  1. Postgres `bulkInsertRules` 트랜잭션 부재 (높음).
  2. SQLite JSON.parse 손상 시 전체 throw.
  3. `sqlite?: any` 로 인한 타입 안전성 결여.
- 개선 권고:
  1. Postgres 벌크 insert 를 `BEGIN; INSERT ...; COMMIT;` 또는 multi-VALUES INSERT 로 묶기.
  2. JSON 디시리얼라이즈 헬퍼 함수 추출 + try/catch + 기본값.
  3. `better-sqlite3` 타입 import (`type Database from 'better-sqlite3'`).
- 재읽기 권고 레벨: 3 (도메인 핵심 + 트랜잭션 위험 지점).
