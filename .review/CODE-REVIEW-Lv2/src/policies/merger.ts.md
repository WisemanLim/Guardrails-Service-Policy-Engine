# src/policies/merger.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: 도메인 체인 순서대로 룰을 머지. 충돌 키 (`category:subCategory:locale:ioType`) 발생 시 stricter action 우선 + priority + 도메인 specificity tiebreaker. 컴파일드 번들 빌드.
- 진입점에서의 거리: 2 (PoliciesService.getBundle → buildCompiledBundle → mergeRules)
- 라인 수: 82
- 주요 export: `mergeRules`, `buildCompiledBundle`
- 의존 모듈 (internal): `./policy.types`
- 사용된 외부 패키지: 없음
- 부수효과: `new Date().toISOString()` (`generatedAt`)
- 동시성 모델: stateless 함수, 호출자가 동시 호출 가능
- 테스트 커버리지 흔적: `__tests__/merger.spec.ts` (3 케이스)

---

```ts path=src/policies/merger.ts lines=1-16
import { CompiledBundle, Rule } from './policy.types';

const ACTION_STRICTNESS: Record<string, number> = {
  allow: 0,
  warn: 1,
  add_disclaimer: 2,
  sanitize: 3,
  redact: 4,
  block_or_redact: 5,
  block_or_pseudonymize: 5,
  aggregate_only: 5,
  refuse: 6,
  escalate: 6,
  block: 7,
  route: 4,
};
```

```ts path=src/policies/merger.ts lines=18-57
/**
 * Merge order: caller passes domain list in escalation order
 *   ["global","manufacturing","manufacturing-food", ...tenantOverrides]
 * Conflict resolution: stricter action wins; on tie, higher priority wins;
 * on further tie, later (more-specific) domain wins.
 */
export function mergeRules(
  perDomain: Map<string, Rule[]>,
  domainOrder: string[],
  locale: string,
  ioType: 'input' | 'output',
): Rule[] {
  const byKey = new Map<string, { rule: Rule; orderIdx: number }>();

  for (let idx = 0; idx < domainOrder.length; idx++) {
    const d = domainOrder[idx];
    const list = perDomain.get(d) ?? [];
    for (const r of list) {
      if (!r.enabled) continue;
      if (r.locale !== locale && r.locale !== '*') continue;
      if (r.ioType !== ioType && r.ioType !== 'both') continue;

      const key = `${r.category}:${r.subCategory ?? ''}:${r.locale}:${r.ioType}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { rule: r, orderIdx: idx });
        continue;
      }
      const newer = stricter(existing.rule, r) ? r : existing.rule;
      // If new rule comes from a more specific domain and is at least equal strictness, prefer it.
      if (newer === r || idx >= existing.orderIdx) {
        byKey.set(key, { rule: newer, orderIdx: idx });
      }
    }
  }

  return Array.from(byKey.values())
    .map((v) => v.rule)
    .sort((a, b) => b.priority - a.priority);
}
```

```ts path=src/policies/merger.ts lines=59-82
function stricter(a: Rule, b: Rule): boolean {
  const sa = ACTION_STRICTNESS[a.action] ?? 0;
  const sb = ACTION_STRICTNESS[b.action] ?? 0;
  if (sb !== sa) return sb > sa;
  return b.priority > a.priority;
}

export function buildCompiledBundle(
  perDomain: Map<string, Rule[]>,
  domainOrder: string[],
  locale: string,
  ioType: 'input' | 'output',
  version: string,
): CompiledBundle {
  return {
    domain: domainOrder[domainOrder.length - 1],
    locale,
    ioType,
    rules: mergeRules(perDomain, domainOrder, locale, ioType),
    version,
    evaluatedDomains: domainOrder,
    generatedAt: new Date().toISOString(),
  };
}
```

**분석 / Analysis (Level 2)**

- **L3-16 `ACTION_STRICTNESS`**:
  - 액션의 순위. 0(allow) → 7(block).
  - 동점 그룹: 5점 (`block_or_redact`, `block_or_pseudonymize`, `aggregate_only`), 6점 (`refuse`, `escalate`).
  - `route` 가 4 — `redact` 와 동일. 의미상 routing 이 가장 엄격한 액션은 아님이라는 모델링.
  - **`policy.types.ts:5-18` 의 zod `Action` enum 과 동기화 필요** — 새 액션 추가 시 두 곳 모두 갱신. `?? 0` fallback 이 누락 액션을 silent 하게 `allow` 로 강등하므로 위험.
  - **흔한 실수**: `?? 0` 는 0(`allow`) 와 동일 — 누락 action 이 입력으로 들어오면 `allow` 처럼 동작. 운영에서 새 액션 추가 후 strictness 등록 누락 시 **보안 약화**. warn 권장.
- **L24-29 `mergeRules` 시그니처**:
  - `perDomain: Map` — 부트 시 만들어진 도메인별 룰.
  - `domainOrder` — `resolveMultiDomainChain` 결과. less → more specific.
  - locale / ioType — 요청 단위.
- **L30 `byKey` Map**:
  - 키 = `${category}:${subCategory??}:${locale}:${ioType}`.
  - 값 = `{rule, orderIdx}` — 어느 도메인에서 왔는지 추적.
- **L32-51 메인 루프**:
  - 도메인 순서대로 iterate.
  - 필터: `enabled`, locale match (`*` 와일드카드 허용), ioType match (`both` 허용).
  - 키 없으면 즉시 추가.
  - **충돌 해소 로직 (L46-50)**:
    - `newer = stricter(existing, r) ? r : existing` — strictness 비교.
    - 그 후 `if (newer === r || idx >= existing.orderIdx)` 로 갱신 여부 결정.
    - **버그성 의심**: `newer === existing.rule && idx > existing.orderIdx` 인 경우 (즉, 새 룰이 덜 엄격하지만 더 specific 한 도메인에서 옴), 조건이 `idx >= existing.orderIdx` 인데 `newer === existing.rule` 이므로 `byKey.set(key, {rule: newer, orderIdx: idx})` — `rule` 은 기존 룰이 유지되지만 `orderIdx` 만 idx 로 갱신. 의도: orderIdx 추적 보존이지만 실제로는 rule 도 그대로라 동작 자체는 OK. 다만 코드 의도가 명확하지 않다.
    - **잠재 위험**: `idx >= existing.orderIdx` 가 `newer === existing.rule` 일 때도 entry update 를 트리거 — 이는 의도일 수 있지만 `rule` 이 동일이라 무영향. 다음 케이스 검토:
      - 동일 도메인 (`idx === existing.orderIdx`) 내 두 번째 룰: `newer === existing.rule` 면 갱신 안 일어남 (오직 `idx > existing.orderIdx` 시). 같은 도메인 안 충돌이면 처음 등록된 룰이 유지. 의도 불명확.
    - 주석 의도: "new rule comes from a more specific domain and is at least equal strictness, prefer it". 즉 `idx > existing.orderIdx` AND `!stricter(r, existing.rule)` 이지만 동일 strict. 그러나 `stricter` 가 priority tiebreaker 까지 포함하므로 두 룰이 완전히 동일하지 않은 한 `newer` 가 결정됨. 결국 idx tiebreaker 가 트리거 되는 케이스는 `stricter(existing, r) === false` 인 경우 — newer 가 r 이거나 (즉 r 이 더 strict) 아무튼 r 우선.
    - **요약**: 로직이 stricter-then-specificity 우선이지만 코드는 OR 조합 (`newer===r || idx>=existing.orderIdx`). orderIdx tiebreaker 가 stricter 와 별개로 트리거됨. [INDEX.md §4.3 #5](../../INDEX.md) 핫스팟.
- **L53-56 정렬**: `priority desc`. 운영에서 가장 높은 priority 룰부터 평가하는 패턴.
- **L59-63 `stricter`**:
  - action strictness 동점이면 priority tiebreaker (`b.priority > a.priority`).
  - 동점이 모두 같으면 false → `existing` 유지 (안정).
  - `?? 0` fallback 위험성 위에서 다룸.
- **L66-82 `buildCompiledBundle`**:
  - `domain` 필드 = chain 의 마지막 — most specific. 호출자가 출력 식별에 사용.
  - `evaluatedDomains` — chain 전체 echo.
  - `generatedAt` ISO string — cache 도구가 신선도 판단 가능.
  - **race**: `new Date().toISOString()` 매 호출 변경 — Redis cache 키는 동일하므로 cache hit 시 `generatedAt` 은 첫 빌드 시점. 캐시 미스 시 새 빌드 + 새 timestamp.

**짚어볼 점 / Watch-outs**

1. **`?? 0` fallback** — 누락 action 이 silent 하게 `allow` 처럼 동작. 새 action 추가 시 strictness 등록 잊으면 보안 약화. warn 또는 throw 권장.
2. **`policy.types.Action` enum 동기화 필요** — 양쪽 변경 누락 시 일관성 깨짐.
3. **머지 분기 로직 (L46-50) 의 OR 조건** — 의도와 실제 동작 일치 여부 테스트 미커버. 경계 케이스 (동일 strict + 다른 idx, 동일 idx + 다른 strict) 테스트 필요.
4. **`r.locale !== '*'` 와일드카드** — `policy.types.ts` 의 `locale: z.string()` 은 임의 문자열 허용. `*` 도 통과. 의도된 매직값.
5. **`subCategory` 결합 키** — `null`/`undefined` 모두 `''` 로 변환되어 키 통일.
6. **`evaluatedDomains` 의 mutation 위험** — `domainOrder` 를 그대로 참조. 호출자가 반환 후 배열 mutate 하면 번들이 바뀌어 보임. 호출자 = `PoliciesService.getBundle` 인데 chain 을 즉시 생성 + 즉시 캐싱 → mutate 안 함. 안전.
7. **`Array.from(byKey.values()).map().sort()`** — sort 가 in-place. `.map()` 이 새 배열을 만들어 무해.

**파일 단위 판정**

- 강점:
  1. 명확한 strictness 표.
  2. 키 기반 dedup + tiebreaker 명시.
  3. 테스트 3 케이스로 기본 동작 검증.
- 위험:
  1. `?? 0` 누락 action 의 silent allow 강등.
  2. 머지 분기 OR 조건의 경계 동작 불명확.
  3. `ACTION_STRICTNESS` 와 `Action` enum 의 동기화 부담.
- 개선 권고:
  1. action strictness lookup 누락 시 throw 또는 warn.
  2. action enum 을 `as const` array → strictness 가 enum 으로 type-safe 인덱싱.
  3. 경계 케이스 테스트 추가 (동일 strict 다른 priority, 동일 priority 다른 idx).
- 재읽기 권고 레벨: 3 (핵심 + 경계 로직).
