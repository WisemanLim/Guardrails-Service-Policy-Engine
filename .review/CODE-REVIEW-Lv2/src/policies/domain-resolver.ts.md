# src/policies/domain-resolver.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: 도메인 키 (`manufacturing-food`) 로부터 부모 체인 (`global → manufacturing → manufacturing-food`) 을 계산하고, 다중 leaf 의 체인을 union.
- 진입점에서의 거리: 2 (PoliciesService.refresh → resolveMultiDomainChain)
- 라인 수: 40
- 주요 export: `resolveDomainChain`, `resolveMultiDomainChain`
- 의존 모듈 (internal): 없음
- 사용된 외부 패키지: 없음 (순수 함수)
- 부수효과: 없음
- 동시성 모델: 해당 없음 (stateless)
- 테스트 커버리지 흔적: `__tests__/domain-resolver.spec.ts` (3 케이스)

---

```ts path=src/policies/domain-resolver.ts lines=1-19
/**
 * Resolve domain-merge escalation order.
 *
 * Given a leaf domain (e.g. "manufacturing-food"), produce the chain
 *   ["global", "manufacturing", "manufacturing-food"]
 *
 * Convention: parents are inferred from the kebab-case prefix path.
 * The "global" baseline is always prepended.
 */
export function resolveDomainChain(leaf: string): string[] {
  if (leaf === 'global') return ['global'];
  const parts = leaf.split('-');
  const chain: string[] = ['global'];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(parts.slice(0, i).join('-'));
  }
  // Dedup while preserving order.
  return Array.from(new Set(chain));
}
```

```ts path=src/policies/domain-resolver.ts lines=21-40
/**
 * For a request with multiple leaf domains (e.g. ["manufacturing-food", "manufacturing-chemical"]),
 * union the chains preserving escalation order (less specific → more specific).
 */
export function resolveMultiDomainChain(leaves: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // First pass: ensure ancestors come before descendants.
  const chains = leaves.map(resolveDomainChain);
  // Sort domains by depth (shorter first), then by original order.
  const depthOf = (d: string) => (d === 'global' ? 0 : d.split('-').length);
  const all = chains.flat().sort((a, b) => depthOf(a) - depthOf(b));
  for (const d of all) {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}
```

**분석 / Analysis (Level 2)**

- **L10-19 `resolveDomainChain`**:
  - `leaf === 'global'` 단락 분기 — `'global'.split('-')` 가 `['global']` 라 일반 분기로도 동일 결과를 만들지만, 명시적 분기로 의도 명확.
  - `parts = leaf.split('-')` — kebab-case 파싱. 예: `'manufacturing-food'` → `['manufacturing','food']`.
  - 루프 `i=1..parts.length` — `parts.slice(0, i).join('-')` 로 누적 prefix 생성. 예: `'manufacturing'`, `'manufacturing-food'`.
  - 결과: `['global', 'manufacturing', 'manufacturing-food']`.
  - `Array.from(new Set(chain))` — 중복 제거. 일반 케이스에서는 불필요하지만 `leaf` 가 `'global'` 등의 prefix 와 중복될 가능성 방어. **순서 보존**: ES2015+ `Set` 은 insertion order 유지.
  - 흔한 실수: `for (let i=0; i<=parts.length; i++)` 로 i=0 부터 시작하면 `parts.slice(0,0).join('-')` = `''` 가 들어가 빈 문자열이 chain 에 추가될 수 있음. 본 코드는 `i=1` 로 안전.
  - 흔한 실수: 도메인 키에 하이픈이 의미적 단어 안에 있는 경우 (예: `'auto-mobile'` 이 의도상 단일 도메인) — 본 컨벤션상 모든 하이픈을 부모-자식 경계로 해석. 룰 메이커가 `auto_mobile` 같은 우회로 회피해야 함.
- **L25-39 `resolveMultiDomainChain`**:
  - 각 leaf 의 chain 을 `flat()` → depth 오름차순 정렬 → 중복 제거.
  - `depthOf('global') = 0`, 그 외 `split('-').length` — 깊이 = 부분 수.
  - **순서 보존 보장**: `Array.prototype.sort` 는 ECMAScript 2019 부터 stable. 따라서 동일 depth 의 도메인끼리는 입력 순서 유지. 노드 12+ V8 는 stable.
  - 흔한 실수: `depthOf` 가 `'global'` 을 0 으로 분리 — `'global'.split('-').length = 1` 이라 0 으로 강제하지 않으면 다른 depth-1 (`'manufacturing'`) 와 동일 위치 경쟁. 명시 분기 정확.
  - 흔한 실수: 두 leaf 의 chain 에 공통 조상이 있을 때 (`'manufacturing-food'`, `'manufacturing-chemical'` → 둘 다 `'manufacturing'` 포함) — 정렬 후 중복 제거가 처리. 정상.
  - **버그 가능성**: leaf 가 `'global'` 단일이면 `chains = [['global']]`, depth=0 정렬, 결과 `['global']`. 정상.

**짚어볼 점 / Watch-outs**

1. **하이픈 의존 규약** — `'auto-mobile'` 처럼 부모-자식이 아닌 단어 분리가 의도된 도메인 키는 표현 불가. 컨벤션을 README 에 명시 필요.
2. **빈 leaf 처리** — `resolveDomainChain('')` 호출 시 `''.split('-')` → `['']` → `parts.slice(0,1).join('-') = ''` → chain `['global', '']`. 빈 도메인이 포함된다. 입력 검증 부재. 호출자(`PoliciesService.refresh`) 가 `.filter(Boolean)` 적용 (`policies.service.ts:23`) — 안전망 존재.
3. **정렬의 stability 의존** — ECMAScript stable sort 가정 (Node 12+). 합리적.
4. **`Array.from(new Set(...))` overhead** — 매 호출 객체 생성. 호출 빈도 낮으면 무해.

**파일 단위 판정**

- 강점:
  1. 순수 함수, 사이드이펙트 0.
  2. 테스트 커버 (3 케이스).
  3. JSDoc 으로 컨벤션 명시.
- 위험:
  1. 빈 문자열 leaf 가드 부재.
  2. 하이픈 컨벤션이 단일 단어 하이픈을 허용 안 함.
- 개선 권고:
  1. `resolveDomainChain` 진입에서 `if (!leaf) throw new Error(...)` 또는 `return []` 가드.
  2. 테스트에 동일 leaf 중복 입력 케이스 추가 (`['manufacturing-food', 'manufacturing-food']`).
- 재읽기 권고 레벨: 1.
