# src/policies/policy.types.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: zod 스키마 + TypeScript 타입. `Rule`, `CompiledBundle`, `Severity`/`IoType`/`Action` enum.
- 진입점에서의 거리: 3 (loader / merger / service 모두 직접 import)
- 라인 수: 59
- 주요 export: `RuleSchema`, `Rule`, `CompiledBundle`, `Severity`, `IoType`, `Action`
- 의존 모듈 (internal): 없음
- 사용된 외부 패키지: `zod`
- 부수효과: 없음
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 간접 (loader / merger spec 이 RuleSchema 통해 검증)

---

```ts path=src/policies/policy.types.ts lines=1-18
import { z } from 'zod';

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export const IoType = z.enum(['input', 'output', 'both']);
export const Action = z.enum([
  'allow',
  'warn',
  'redact',
  'sanitize',
  'block',
  'block_or_redact',
  'block_or_pseudonymize',
  'aggregate_only',
  'refuse',
  'escalate',
  'add_disclaimer',
  'route',
]);
```

```ts path=src/policies/policy.types.ts lines=20-49
export const RuleSchema = z.object({
  ruleId: z.string(),
  domain: z.string(),
  locale: z.string(),
  ioType: IoType,
  category: z.string(),
  subCategory: z.string().optional(),
  description: z.string(),
  patternType: z.string(),
  patterns: z
    .object({
      regex: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      entities: z.array(z.string()).optional(),
      luhnCheck: z.boolean().optional(),
      minContextWindow: z.number().optional(),
      requiresPersonLink: z.boolean().optional(),
    })
    .optional(),
  severity: Severity,
  priority: z.number().int().default(100),
  action: Action,
  messageTemplate: z.record(z.string(), z.string()).default({}),
  regulationTags: z.array(z.string()).default([]),
  examplesPositive: z.array(z.string()).default([]),
  examplesNegative: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  version: z.string().default('1.0.0'),
});
export type Rule = z.infer<typeof RuleSchema>;
```

```ts path=src/policies/policy.types.ts lines=51-59
export interface CompiledBundle {
  domain: string;
  locale: string;
  ioType: 'input' | 'output' | 'both';
  rules: Rule[];
  version: string;
  evaluatedDomains: string[];
  generatedAt: string;
}
```

**분석 / Analysis (Level 2)**

- **L1 import**: `zod` 단일 의존.
- **L3-5 enums**:
  - `Severity`/`IoType`/`Action` 모두 `z.enum` 으로 런타임+컴파일타임 양방향 안전.
  - `IoType` 에 `'both'` 포함 — 룰 자체는 input/output 양쪽에 적용 가능. `mergeRules` 는 요청의 ioType 과 비교 시 `'both'` 와일드카드 인정.
- **L5-18 `Action`**:
  - 12개 값. `merger.ts:3-16` 의 `ACTION_STRICTNESS` 와 동기화 필요. (검증: 두 곳 모두 동일 12개 — 일치)
- **L20-48 `RuleSchema`**:
  - 19개 필드. 옵셔널 vs 디폴트 구분:
    - `subCategory`/`patterns` — optional (스키마 통과 시 `undefined`).
    - `messageTemplate`/`regulationTags`/`examplesPositive`/`examplesNegative` — default `{}` 또는 `[]`.
    - `enabled` default `true`, `version` default `'1.0.0'`, `priority` default 100.
  - `patterns` 내부:
    - `regex: array<string>` — 정규식이 string 으로 저장 (`new RegExp` 호출은 외부 detection engine).
    - `keywords`, `entities` — 단순 배열.
    - `luhnCheck` — 신용카드 검증 플래그.
    - `minContextWindow`, `requiresPersonLink` — 추가 매칭 컨텍스트.
  - `messageTemplate: z.record(z.string(), z.string())` — locale → message 매핑.
  - 흔한 실수: `priority: z.number().int().default(100)` — `int()` 가드. 0 이하도 통과 (음수 priority 의도 불명확). 비즈니스 룰로 강제 시 `.min(0)` 추가 권장.
  - **`description`/`patternType` 이 required string** — 빈 문자열 통과. `policies.service.ts:116` 에서 DB → DTO 매핑 시 `description: ''` 하드코딩. 합리적이지만 의미상 빈 필드.
- **L49 `type Rule = z.infer<typeof RuleSchema>`**:
  - zod 의 type inference. `Rule.priority` 가 `number`, `Rule.enabled` 가 `boolean`. default 적용된 값이 추론.
- **L51-59 `CompiledBundle`**:
  - 인터페이스 (zod 스키마 없음). 런타임 검증 부재 — 빌더(`merger.buildCompiledBundle`) 가 invariant 보증.
  - `ioType: 'input' | 'output' | 'both'` 인데 `merger.ts:28` 시그니처는 `'input' | 'output'`. `'both'` 는 컴파일드 결과의 ioType 에 들어가지 않음. 런타임 불일치 가능성 zero 지만 타입 정의의 의도가 좁히는 게 정합적.

**짚어볼 점 / Watch-outs**

1. **`Action` ↔ `merger.ACTION_STRICTNESS` 동기화** — 새 액션 추가 시 양쪽 갱신 필요. 단일 출처 (`as const` 배열) 로 통합 권장.
2. **`priority` 음수 허용** — 비즈니스 의도 검토.
3. **`description` 의 required 빈 문자열 통과** — 의미상 optional 이 더 자연스러움.
4. **`patternType: z.string()` 임의 문자열** — 사실상 무검증. enum 으로 좁히면 잘못된 입력 조기 탐지.
5. **`CompiledBundle.ioType` 의 `'both'` 가능성** — `merger.buildCompiledBundle` 시그니처와 충돌. 타입 좁힘 권장.
6. **`regulationTags`/`examplesPositive` 등의 default `[]`** — `JSON.parse` 결과로 `null` 이 와도 zod 가 default 처리 안 함 (defaults only apply when key is missing). 데이터 검증 시 `null` 입력 별도 처리 필요.

**파일 단위 판정**

- 강점:
  1. 단일 zod 스키마로 런타임+컴파일타임 검증 통일.
  2. 명확한 enum 정의.
  3. default 적용으로 호출자 부담 감소.
- 위험:
  1. Action enum ↔ strictness 표 이중 관리.
  2. CompiledBundle 의 ioType 폭이 머저 시그니처와 불일치.
- 개선 권고:
  1. Action enum 을 `as const` 배열 + strictness 매핑 함수로 통합.
  2. `CompiledBundle.ioType` 을 `'input' | 'output'` 로 좁힘.
  3. `patternType` 도 enum 으로.
- 재읽기 권고 레벨: 2 (스키마 변경 시 필수).
