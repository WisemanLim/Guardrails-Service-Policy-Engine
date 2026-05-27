# src/policies/__tests__/domain-resolver.spec.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../../INDEX.md) · [↑ __tests___Abstract.md](./__tests___Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `domain-resolver.ts` 의 두 함수에 대한 Jest 단위테스트 (3 케이스).
- 진입점에서의 거리: 테스트
- 라인 수: 29
- 주요 export: 없음 (describe blocks)
- 의존 모듈 (internal): `../domain-resolver`
- 사용된 외부 패키지: Jest (`describe`/`it`/`expect`)
- 부수효과: 없음
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 본인이 테스트.

---

```ts path=src/policies/__tests__/domain-resolver.spec.ts lines=1-18
import { resolveDomainChain, resolveMultiDomainChain } from '../domain-resolver';

describe('resolveDomainChain', () => {
  it('produces ancestor chain for leaf', () => {
    expect(resolveDomainChain('manufacturing-food')).toEqual(['global', 'manufacturing', 'manufacturing-food']);
  });
  it('handles global', () => {
    expect(resolveDomainChain('global')).toEqual(['global']);
  });
  it('handles 3-level leaf', () => {
    expect(resolveDomainChain('manufacturing-automotive-battery')).toEqual([
      'global',
      'manufacturing',
      'manufacturing-automotive',
      'manufacturing-automotive-battery',
    ]);
  });
});
```

```ts path=src/policies/__tests__/domain-resolver.spec.ts lines=20-29
describe('resolveMultiDomainChain', () => {
  it('orders ancestors before descendants and dedupes', () => {
    const chain = resolveMultiDomainChain(['manufacturing-food', 'manufacturing-chemical']);
    expect(chain[0]).toBe('global');
    expect(chain.indexOf('manufacturing')).toBeGreaterThan(0);
    expect(chain).toContain('manufacturing-food');
    expect(chain).toContain('manufacturing-chemical');
    expect(new Set(chain).size).toBe(chain.length);
  });
});
```

**분석 / Analysis (Level 2)**

- **L1 import**: 같은 디렉토리에서 두 함수.
- **L3-18 `resolveDomainChain` 3 케이스**:
  - 2-level leaf: 표준 케이스.
  - `'global'` 단축 분기.
  - 3-level leaf: prefix 누적 검증.
  - `toEqual` 사용 — 깊은 비교. 정확.
- **L20-28 `resolveMultiDomainChain` 1 케이스**:
  - 두 형제 leaf 의 union 검증.
  - 4가지 invariant:
    1. 첫 항목 = `'global'`.
    2. `'manufacturing'` 이 chain 안에 존재 + idx > 0.
    3. 두 leaf 모두 포함.
    4. 중복 없음.
  - **검증 부족**: chain 의 정확한 순서 미검증. `expect(chain).toEqual([...])` 가 더 명확.
  - **누락 케이스**:
    - 동일 leaf 중복 입력 (`['x', 'x']`).
    - 빈 배열 입력 (`[]`).
    - depth 가 다른 leaf 의 mix (`['global', 'a-b-c']`).
- **테스트 인프라**: Jest, ts-jest. `package.json` 의 `jest.rootDir = src` 가정 — 본 spec 은 `src/policies/__tests__/` 라 자동 발견 (`testMatch: **/*.spec.ts`).

**짚어볼 점 / Watch-outs**

1. **`resolveMultiDomainChain` 테스트가 invariant 만 검증** — 정확한 순서 미검증.
2. **경계 케이스 누락**:
   - 빈 입력.
   - 동일 leaf 중복.
   - depth 가 큰 leaf.
3. **에러 경로 미테스트** — `resolveDomainChain('')` 가 어떻게 동작하는지 명세 없음.

**파일 단위 판정**

- 강점:
  1. happy path 3 + 1 케이스 명확.
  2. 짧고 가독성 높음.
- 위험:
  1. invariant 만으로는 정확한 순서 회귀 탐지 어려움.
  2. 경계 케이스 미커버.
- 개선 권고:
  1. `resolveMultiDomainChain` 의 `toEqual` 정확한 결과 검증.
  2. 빈 입력 / 중복 leaf / 4-level depth 케이스 추가.
- 재읽기 권고 레벨: 1.
