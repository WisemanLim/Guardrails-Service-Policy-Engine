# `src/` 디렉토리 요약 / Abstract

> 리뷰 레벨: 2
> [← INDEX.md](./INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `main.ts` | NestJS 부트스트랩, 8082 listen | 12 | [열기](./src/main.ts.md) |
| `app.module.ts` | 루트 모듈 (Config/Cache/Db/Policies/Domains/Whitelist) | 21 | [열기](./src/app.module.ts.md) |

## 디렉토리 구조 요약

- `cache/` — Redis 파사드 (글로벌 모듈). [Abstract](./src/cache/cache_Abstract.md)
- `db/` — Postgres ↔ SQLite 듀얼 드라이버 + SQLite DDL. [Abstract](./src/db/db_Abstract.md)
- `domains/` — 도메인 조회 컨트롤러. [Abstract](./src/domains/domains_Abstract.md)
- `health/` — `/health` 엔드포인트. [Abstract](./src/health/health_Abstract.md)
- `policies/` — 룰 로더, 머저, 도메인 리졸버, 컴파일드 번들 API (서비스 핵심). [Abstract](./src/policies/policies_Abstract.md)
  - `policies/__tests__/` — 단위테스트 (domain-resolver, merger). [Abstract](./src/policies/__tests__/__tests___Abstract.md)
- `whitelist/` — 화이트리스트 조회 API. [Abstract](./src/whitelist/whitelist_Abstract.md)

## 주요 의존 관계

- `main.ts` → `AppModule`
- `AppModule` → 6개 도메인 모듈 + Config
- 모든 도메인 모듈 → `CacheModule` / `DbModule` (둘 다 `@Global`)

## 위험 신호

- 부트스트랩에 글로벌 핸들러(`uncaughtException`, `unhandledRejection`) 미설정.
- `app.module.ts` 가 `ConfigModule.forRoot`를 import 하지만 모든 서비스가 `process.env` 직접 참조 → 설정 단일 출처 부재.
- 컨트롤러에 글로벌 `ValidationPipe` 부재 (`class-validator` 미사용).
