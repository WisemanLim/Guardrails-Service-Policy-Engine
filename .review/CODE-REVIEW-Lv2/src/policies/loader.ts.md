# src/policies/loader.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: 디렉토리/번들 두 방식으로 룰 JSON 을 디스크에서 로드. zod 검증 후 도메인별로 묶어 Map 반환.
- 진입점에서의 거리: 2 (PoliciesService.refresh → loadPoliciesFromDir / loadBundlesFromDir)
- 라인 수: 130
- 주요 export: `loadPoliciesFromDir`, `loadBundlesFromDir`, `LoadedRules`
- 의존 모듈 (internal): `./policy.types` (`Rule`, `RuleSchema`)
- 사용된 외부 패키지: `@nestjs/common` (Logger), `fs` (promises), `path`
- 부수효과: 파일시스템 read (재귀 디렉토리 walk).
- 동시성 모델: `for...of await` 직렬 처리 — 병렬화 미적용 (룰 수가 적어 무해).
- 테스트 커버리지 흔적: 없음 (테스트 갭. [INDEX.md §4.5](../../INDEX.md))

---

```ts path=src/policies/loader.ts lines=1-11
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Rule, RuleSchema } from './policy.types';

const log = new Logger('PolicyLoader');

export interface LoadedRules {
  byDomain: Map<string, Rule[]>;
  total: number;
}
```

```ts path=src/policies/loader.ts lines=13-29
export async function loadPoliciesFromDir(rootDir: string, enabledDomains: string[]): Promise<LoadedRules> {
  const byDomain = new Map<string, Rule[]>();
  let total = 0;

  for (const domain of enabledDomains) {
    const dir = path.join(rootDir, domain);
    const rules = await walkAndLoad(dir, domain);
    if (rules.length) {
      byDomain.set(domain, rules);
      total += rules.length;
    } else {
      log.warn(`No rules found for domain "${domain}" under ${dir}`);
    }
  }

  return { byDomain, total };
}
```

```ts path=src/policies/loader.ts lines=31-94
export async function loadBundlesFromDir(rootDir: string, enabledDomains: string[]): Promise<LoadedRules> {
  const byDomain = new Map<string, Rule[]>();
  let total = 0;
  const enabled = new Set(enabledDomains);

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return { byDomain, total };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = path.join(rootDir, entry.name);
    let raw: any;
    try {
      raw = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch (e) {
      log.error(`Failed to read bundle ${full}: ${(e as Error).message}`);
      continue;
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rules)) continue;
    const bundleDomain = String(raw.domain ?? '');
    if (!bundleDomain || !enabled.has(bundleDomain)) {
      log.debug?.(`Skip bundle ${entry.name}: domain "${bundleDomain}" not in enabled set.`);
      continue;
    }
    const arr = byDomain.get(bundleDomain) ?? [];
    let added = 0;
    for (const item of raw.rules) {
      const parsed = RuleSchema.safeParse(item);
      if (!parsed.success) {
        log.warn(`Skipping invalid rule in ${full}: ${parsed.error.message}`);
        continue;
      }
      if (parsed.data.domain !== bundleDomain) {
        log.warn(
          `Rule ${parsed.data.ruleId} domain mismatch in ${entry.name} (bundle=${bundleDomain}, rule=${parsed.data.domain})`,
        );
        continue;
      }
      arr.push(parsed.data);
      added++;
    }
    if (added > 0) {
      byDomain.set(bundleDomain, arr);
      total += added;
      log.log(`Loaded bundle ${entry.name}: ${added} rules → ${bundleDomain}`);
    }
  }
  return { byDomain, total };
}
```

```ts path=src/policies/loader.ts lines=96-130
async function walkAndLoad(dir: string, expectedDomain: string): Promise<Rule[]> {
  const out: Rule[] = [];
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkAndLoad(full, expectedDomain)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const raw = JSON.parse(await fs.readFile(full, 'utf8'));
        const arr = Array.isArray(raw) ? raw : Array.isArray(raw.rules) ? raw.rules : [raw];
        for (const item of arr) {
          const parsed = RuleSchema.safeParse(item);
          if (!parsed.success) {
            log.warn(`Skipping invalid rule in ${full}: ${parsed.error.message}`);
            continue;
          }
          if (parsed.data.domain !== expectedDomain) {
            log.warn(`Rule ${parsed.data.ruleId} domain mismatch (expected ${expectedDomain}, got ${parsed.data.domain})`);
            continue;
          }
          out.push(parsed.data);
        }
      } catch (e) {
        log.error(`Failed to load ${full}: ${(e as Error).message}`);
      }
    }
  }
  return out;
}
```

**분석 / Analysis (Level 2)**

- **L1-4 imports**: `@nestjs/common` Logger (DI 없이 인스턴스 생성 가능 — sub-module logger 패턴).
- **L5 `log`**: 모듈 레벨 logger. NestJS 컨벤션상 service 의 `private readonly log` 가 일반적이지만 모듈 함수에서는 합리적 단축.
- **L8-11 `LoadedRules`**: `byDomain` Map + `total` 카운트.
- **L13-29 `loadPoliciesFromDir`** (디렉토리 워크):
  - `enabledDomains` 각각에 대해 `<rootDir>/<domain>` 하위를 재귀 walk.
  - 룰 0건이면 warn — 도메인이 디렉토리 자체로 없는 경우와 비어있는 경우를 구분하지 않음. (walkAndLoad 가 `try {} catch {}` 로 ENOENT 를 silent 처리 — 디렉토리 부재도 빈 결과)
  - 동시성: 도메인을 직렬 처리. 도메인 수가 작아 무해.
  - 흔한 실수: `enabledDomains` 가 부모 + 자식 둘 다 포함하면 (`'manufacturing'`, `'manufacturing-food'`) 두 디렉토리 모두 워크. 정상.
- **L31-83 `loadBundlesFromDir`** (flat 번들 파일):
  - `rootDir` (모노레포 `scripts/`) 가 없거나 read 실패면 빈 결과 (silent). [INDEX.md §4.3 #1](../../INDEX.md) 의 SEEDS_DIR 위험과 연결.
  - 파일 단위:
    - JSON parse 실패 → error 로깅 + continue.
    - `raw.rules` 배열 아니면 skip (조용히).
    - `bundle.domain` 이 enabled set 에 없으면 `log.debug?.()` — `debug` 가 optional chain — NestJS Logger 에는 `debug()` 가 존재하지만 보호적 호출. **흔한 실수**: 원래 NestJS Logger 의 debug 는 항상 존재 — `?.` 는 과방어.
    - 룰 단위 zod safeParse + domain 일치 검증.
  - `enabled.has(bundleDomain)` — 핵심 게이트. 부트 시 `ancestors` (chain 전체) 가 enabled set 으로 전달되므로 `'global'` bundle 이 통과.
  - 같은 도메인의 여러 bundle 이 있으면 누적 (배열 push). ruleId 중복 검사 부재 — `PoliciesService.refresh()` 단계에서 byId Map 으로 dedupe.
  - 흔한 실수: `String(raw.domain ?? '')` — `raw.domain` 이 number 면 string 으로 변환. 보수적.
- **L96-130 `walkAndLoad`** (재귀 helper):
  - `fs.readdir` 실패 시 (디렉토리 없음 등) 조용히 빈 배열. 부트 안정성을 위한 fail-open. [INDEX.md §4.1](../../INDEX.md).
  - 디렉토리면 재귀, 파일은 `.json` 확장자만.
  - JSON 형태가 array, `{rules:[...]}`, 단일 객체 모두 지원 — 유연. `[raw]` 폴백은 단일 룰 파일 케이스.
  - `parsed.data.domain !== expectedDomain` 룰 도메인 mismatch 시 warn + skip. 디렉토리 기반에서는 디렉토리 이름 == 도메인 가정.
  - 흔한 실수: 심볼릭 링크 처리. `fs.readdir({withFileTypes:true})` 의 `Dirent.isDirectory()` / `isFile()` 는 심링크를 따라가지 않음 → 심링크는 통과 못 함. 환경에 따라 운영 영향. 로컬 dev 에서 심링크 시드를 둘 일이 거의 없어 무해.
  - **무한 루프 방지**: 심링크 사이클이 없으면 정상 종료. 심링크 미지원이라 사이클 위험 없음.

**짚어볼 점 / Watch-outs**

1. **zod 에러 메시지 빈약** — `parsed.error.message` 는 zod 의 직렬화 형식. 어떤 필드가 잘못됐는지 추적은 `parsed.error.issues[].path` 가 더 유용. [INDEX.md §4.6 #6](../../INDEX.md).
2. **silent 실패 다수** — `fs.readdir` catch 빈 배열, JSON parse 실패는 error 로깅이지만 후속 처리 차단 없음. 부트 시 룰 0개여도 부트 성공.
3. **ruleId 중복 미검사** — 같은 도메인 안에서 동일 ruleId 가 여러 파일에 존재해도 모두 push. 다음 단계에서 dedupe 하지만 loader 레벨에서 경고가 있으면 운영 디버깅에 유리.
4. **`raw: any`** — 외부 입력. 타입 안전성을 zod 가 즉시 회수하므로 합리적.
5. **`log.debug?.()` 과방어** — 일관성 위해 `log.debug(...)` 로 단순화.
6. **상대 경로 노출** — `full = path.join(...)` 가 절대 경로일 수 있고 운영 로그에 그대로 노출. 환경에 따라 정보 누설 우려는 낮음.
7. **race condition 부재** — 부트 1회 호출 + invalidate 시 호출. 동시 호출이 일어나면 `byDomain.set` 이 마지막 writer wins — 본 코드는 invalidate 가 직렬화되어 무해.

**파일 단위 판정**

- 강점:
  1. 두 로드 방식 (디렉토리 / 플랫 번들) 명확 분리.
  2. zod safeParse 로 손상된 룰이 부트를 죽이지 않음.
  3. `walkAndLoad` 재귀가 단순.
- 위험:
  1. silent 실패 다수 — 운영 디버깅 어려움.
  2. zod 에러 디테일 부재.
  3. ruleId 중복 검사 부재 (loader 레벨).
- 개선 권고:
  1. zod 에러 logging 시 `parsed.error.issues.map(i => ${i.path.join('.')}: ${i.message})` 로 확장.
  2. ruleId 중복 시 warn.
  3. `loadBundlesFromDir` 에서 디렉토리 부재일 때 warn (지금은 silent).
  4. 통합 테스트 추가 — fixture 디렉토리로 happy/error path 커버.
- 재읽기 권고 레벨: 2.
