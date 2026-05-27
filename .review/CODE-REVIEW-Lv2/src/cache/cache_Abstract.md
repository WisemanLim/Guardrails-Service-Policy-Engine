# `src/cache/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `cache.module.ts` | `@Global` Cache 모듈 | 9 | [열기](./cache.module.ts.md) |
| `redis.service.ts` | ioredis 래퍼 (fail-open get/set/del scan) | 55 | [열기](./redis.service.ts.md) |

## 디렉토리 구조 요약

캐시 계층은 단일 책임 — Redis 클라이언트를 fail-open 으로 감싸 `PoliciesService` 의 컴파일드 번들 캐시(TTL=300s)에 사용된다.

## 주요 의존 관계

- `RedisService` 는 `policies/policies.service.ts` 에서만 직접 사용.
- 외부 의존: `ioredis`.

## 위험 신호

- 생성자에서 `client.connect()` 를 fire-and-forget 호출 → 부팅 직후 첫 요청이 `connected=false` 로 fall-through 할 가능성.
- `del(prefix)` 의 `scanStream` 은 운영 키 수 증가 시 비용 증가 — 다만 본 서비스의 키 카디널리티는 도메인 체인 × 로케일 × ioType 로 한정.
- TTL 하드코딩 (300s) — env 노출 안 됨.
