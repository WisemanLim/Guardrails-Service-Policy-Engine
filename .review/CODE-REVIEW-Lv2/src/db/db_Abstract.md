# `src/db/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `db.module.ts` | `@Global` Db 모듈 | 9 | [열기](./db.module.ts.md) |
| `db.service.ts` | Postgres ↔ SQLite 듀얼 드라이버 파사드 | 306 | [열기](./db.service.ts.md) |
| `schema.sqlite.ts` | SQLite DDL 문자열 (`domains`/`rules`/`whitelists`/`policy_versions`) | 81 | [열기](./schema.sqlite.ts.md) |

## 디렉토리 구조 요약

DB 계층은 두 backend (Postgres / better-sqlite3) 를 단일 인터페이스 뒤에 숨기는 파사드 패턴이다. `DB_DRIVER` env 로 선택, 부트 시 헬스체크 후 `_available` 플래그 세팅. 호출자(`PoliciesService` / `DomainsController` / `WhitelistService` / `HealthController`) 는 driver 를 의식하지 않는다. SQLite DDL 은 코드 인라인 문자열로 — Postgres DDL 은 본 레포 외부.

## 주요 의존 관계

- `DbService` 는 4개 모듈에서 의존 (in-degree 최대).
- 외부 의존: `pg`, `better-sqlite3` (동적 import).
- `schema.sqlite.ts` 는 application 다른 곳에서 import 안 됨.

## 위험 신호

- **Postgres `bulkInsertRules` 트랜잭션 부재** — 부분 시드 위험. [INDEX.md §4.3 #2](../../INDEX.md).
- SQLite `listAllRules` 의 `JSON.parse` 가 한 행의 손상으로 전체 호출 실패할 수 있음.
- `sqlite?: any` 로 인한 타입 안전성 결여.
- Postgres `_available` flag 가 부팅 후 갱신 안 됨 — 재연결 후에도 false 유지 가능.
- Postgres DDL 이 본 레포 밖에 — 스키마 표류 위험.
- `policy_versions` 테이블 미사용 (데드 스키마).
