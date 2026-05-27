# `src/policies/__tests__/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../../INDEX.md) · [↑ policies_Abstract.md](../policies_Abstract.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `domain-resolver.spec.ts` | `domain-resolver.ts` 의 두 함수 단위테스트 (3 케이스) | 29 | [열기](./domain-resolver.spec.ts.md) |
| `merger.spec.ts` | `merger.ts:mergeRules` 충돌 해소/필터 테스트 (3 케이스) | 54 | [열기](./merger.spec.ts.md) |

## 디렉토리 구조 요약

`policies/` 의 두 순수 함수(`domain-resolver`, `merger`) 만 단위테스트. Jest + ts-jest. 총 6 케이스, 84 LOC.

## 주요 의존 관계

- `../domain-resolver`, `../merger`, `../policy.types`.
- Jest 글로벌 (`describe`/`it`/`expect`).

## 위험 신호

- 커버리지 ≈ 두 함수의 happy path. `loader.ts`, `policies.service.ts`, `db.service.ts` 는 무커버.
- 머저의 priority tiebreaker, 와일드카드 (`*` locale, `'both'` ioType), disabled 룰 케이스 미커버.
- 도메인 리졸버의 빈 입력 / 중복 leaf 케이스 미커버.
- e2e (`jest-e2e.json`) 구현 부재 — script 만 존재.
