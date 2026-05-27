# src/policies/__tests__/merger.spec.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../../INDEX.md) · [↑ __tests___Abstract.md](./__tests___Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `merger.ts:mergeRules` 의 핵심 충돌 해소 + 필터 동작 검증 (3 케이스).
- 진입점에서의 거리: 테스트
- 라인 수: 54
- 주요 export: 없음
- 의존 모듈 (internal): `../merger`, `../policy.types`
- 사용된 외부 패키지: Jest
- 부수효과: 없음
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 본인이 테스트.

---

```ts path=src/policies/__tests__/merger.spec.ts lines=1-27
import { mergeRules } from '../merger';
import type { Rule } from '../policy.types';

const base: Omit<Rule, 'ruleId' | 'domain' | 'action' | 'priority'> = {
  locale: 'ko-KR',
  ioType: 'input',
  category: 'pii',
  subCategory: 'national_id_kr',
  description: '',
  patternType: 'regex',
  patterns: { regex: ['x'] },
  severity: 'high',
  messageTemplate: {},
  regulationTags: [],
  examplesPositive: [],
  examplesNegative: [],
  enabled: true,
  version: '1.0.0',
};

const mkRule = (id: string, domain: string, action: Rule['action'], priority: number): Rule => ({
  ...base,
  ruleId: id,
  domain,
  action,
  priority,
});
```

```ts path=src/policies/__tests__/merger.spec.ts lines=29-54
describe('mergeRules', () => {
  it('lets stricter (block) override warn from ancestor domain', () => {
    const map = new Map<string, Rule[]>();
    map.set('global', [mkRule('a', 'global', 'warn', 100)]);
    map.set('manufacturing-food', [mkRule('b', 'manufacturing-food', 'block', 100)]);
    const merged = mergeRules(map, ['global', 'manufacturing-food'], 'ko-KR', 'input');
    expect(merged).toHaveLength(1);
    expect(merged[0].ruleId).toBe('b');
    expect(merged[0].action).toBe('block');
  });

  it('keeps stricter ancestor rule when descendant tries to weaken', () => {
    const map = new Map<string, Rule[]>();
    map.set('global', [mkRule('a', 'global', 'block', 100)]);
    map.set('manufacturing-food', [mkRule('b', 'manufacturing-food', 'warn', 100)]);
    const merged = mergeRules(map, ['global', 'manufacturing-food'], 'ko-KR', 'input');
    expect(merged[0].action).toBe('block');
  });

  it('filters by locale and ioType', () => {
    const en: Rule = { ...mkRule('a', 'global', 'block', 100), locale: 'en' };
    const map = new Map<string, Rule[]>();
    map.set('global', [en]);
    expect(mergeRules(map, ['global'], 'ko-KR', 'input')).toHaveLength(0);
  });
});
```

**분석 / Analysis (Level 2)**

- **L4-19 `base`**: `Rule` 의 공통 필드를 한 객체로. `Omit` 으로 가변 필드 4개 제외 — 테스트 빌더 패턴.
- **L21-27 `mkRule`**: 빌더 함수. `...base` spread + 가변 필드 override.
- **L30-37 케이스 1**:
  - 시나리오: global=warn(100), manufacturing-food=block(100). 두 룰의 키가 같으면 (category=`pii`, sub=`national_id_kr`, locale=`ko-KR`, ioType=`input`).
  - 기대: `block` 이 이김. ruleId 도 `'b'` (specific 도메인).
  - 검증: 길이 1 + ruleId + action.
- **L39-45 케이스 2** (반대 방향):
  - 시나리오: global=block(100), descendant=warn(100). descendant 가 약함.
  - 기대: `block` 유지.
  - **약점**: ruleId 검증이 없음 — `merger.ts:46-50` 의 OR 조건이 orderIdx tiebreaker 를 트리거할 가능성 있음. `stricter(existing, r) === false` (newer = existing = block) → `newer === r` false → 두 번째 조건 `idx >= existing.orderIdx` (idx=1, existing.orderIdx=0) → 갱신. `rule=newer=existing.rule`, `orderIdx:1` 로 set. **rule 자체는 block 그대로**, 다만 orderIdx 가 1 로 업데이트. 동작에는 영향 없지만 코드의 OR 조건이 트리거되는 미묘한 케이스. 테스트로 노출되지 않음.
- **L47-52 케이스 3** (필터):
  - 시나리오: locale=en 룰을 ko-KR 요청에 적용.
  - 기대: 결과 0건.
  - 정확. 다만 `ioType` 필터 같이 검증하지 않고 locale 만 검증. 이름은 'filters by locale and ioType' 인데 ioType 시나리오는 없음.

**짚어볼 점 / Watch-outs**

1. **케이스 2 의 ruleId 미검증** — 어느 룰의 instance 가 채택되었는지 추적 못 함.
2. **테스트 이름과 내용 불일치** — 케이스 3 이 'locale and ioType' 이지만 ioType 시나리오 없음.
3. **누락 케이스**:
   - 동일 action + 다른 priority (priority tiebreaker).
   - `locale: '*'` 와일드카드.
   - `ioType: 'both'` 와일드카드.
   - 동일 도메인 안 키 충돌 (orderIdx 동일).
   - `enabled: false` 룰 무시.
   - 우선순위 정렬 (출력 순서).
   - 빈 chain / 빈 perDomain.
4. **`buildCompiledBundle` 검증 부재** — `generatedAt`/`evaluatedDomains` 필드 채워짐 확인.
5. **strictness 표 회귀 테스트 부재** — 12 액션 각각의 순위 변경 시 회귀 탐지 불가.

**파일 단위 판정**

- 강점:
  1. 빌더 패턴으로 noise 최소화.
  2. happy path 양방향 (strict 우선 / 유지) 커버.
- 위험:
  1. 경계 케이스 다수 미커버.
  2. 케이스 명명 부정확.
- 개선 권고:
  1. priority tiebreaker / 와일드카드 / disabled / orderIdx 동률 케이스 추가.
  2. 케이스 3 분리 (locale / ioType 별도).
  3. `buildCompiledBundle` 응답 객체 필드 검증.
- 재읽기 권고 레벨: 2.
