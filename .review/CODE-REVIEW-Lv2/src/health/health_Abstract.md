# `src/health/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `health.controller.ts` | `GET /health` | 18 | [열기](./health.controller.ts.md) |

## 디렉토리 구조 요약

`/health` 단일 엔드포인트. 모듈 wrapper 없이 `AppModule.controllers` 에 직접 등록. 룰 카운트 + DB driver/availability + 활성 도메인을 반환.

## 주요 의존 관계

- `PoliciesService` (PoliciesModule export), `DbService` (DbModule 글로벌).

## 위험 신호

- `status:'ok'` 하드코딩 — 실제 헬스 (DB down, rulesLoaded=0) 와 무관하게 OK 반환.
- Redis 가용성 누락.
