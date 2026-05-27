# `src/policies/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `policies.module.ts` | NestJS 모듈 (controller + service) | 10 | [열기](./policies.module.ts.md) |
| `policies.controller.ts` | `/policies/*` 4 라우트 | 39 | [열기](./policies.controller.ts.md) |
| `policies.service.ts` | 룰 통합 서비스 — 부트 머지, 시드, 캐시 | 183 | [열기](./policies.service.ts.md) |
| `loader.ts` | 파일/번들 룰 로더 | 130 | [열기](./loader.ts.md) |
| `merger.ts` | 액션 엄격도 기반 머저 + 컴파일드 번들 빌더 | 82 | [열기](./merger.ts.md) |
| `domain-resolver.ts` | 도메인 → 부모 체인 + 멀티 leaf union | 40 | [열기](./domain-resolver.ts.md) |
| `policy.types.ts` | zod RuleSchema + CompiledBundle 타입 | 59 | [열기](./policy.types.ts.md) |
| `__tests__/` | 단위테스트 (domain-resolver / merger) | 83 | [Abstract](./__tests__/__tests___Abstract.md) |

## 디렉토리 구조 요약

서비스의 핵심 도메인. 부트 시 file (`POLICY_DIR`) + bundle (`SEEDS_DIR`) + DB 룰을 3-way 머지하여 `rulesByDomain` Map 으로 메모리에 적재. `getBundle()` 요청 시 chain 별로 `mergeRules` 를 적용해 컴파일드 번들을 만들고 Redis (TTL 300) 캐싱. `invalidate()` 가 캐시 flush + 메모리 reload.

## 주요 의존 관계

- `PoliciesService` 가 `RedisService` + `DbService` + 같은 디렉토리 4개 모듈 + `policy.types` 를 사용 (가장 의존 많음).
- 외부: `zod`, `path`, `fs/promises`, `@nestjs/common`.

## 위험 신호

- `SEEDS_DIR` 기본값이 모노레포 상대경로 — 컨테이너에서 silent 빈 결과. **최상위 위험**.
- `onModuleInit` 의 `refresh()` 2회 호출 — 부트 시간 2배.
- `merger.ts` 의 충돌 해소 분기 OR 조건이 경계 케이스 불명확.
- `merger.ACTION_STRICTNESS` ↔ `policy.types.Action` 이중 관리 (silent fallback 위험).
- `policies.controller.ts:count(:domain)` 의 파라미터 무시 버그.
- `loader.ts` 의 silent 실패 다수 + zod 에러 메시지 빈약.
- 단위테스트는 두 순수 함수만 — service / loader / DB 인터랙션 무커버.
