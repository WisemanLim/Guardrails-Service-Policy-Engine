# src/policies/policies.service.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: 룰 통합 서비스. 부트 시 file/bundle/DB 3-way 머지, seed-on-first-boot, 캐싱된 컴파일드 번들 응답, invalidate.
- 진입점에서의 거리: 1 (PoliciesModule → PoliciesService)
- 라인 수: 183
- 주요 export: `PoliciesService`
- 의존 모듈 (internal): `../cache/redis.service`, `../db/db.service`, `./domain-resolver`, `./loader`, `./merger`, `./policy.types`
- 사용된 외부 패키지: `@nestjs/common`, `path`
- 부수효과: `onModuleInit` 시 파일 IO + DB 쓰기 + Redis IO. `invalidate()` 시 Redis SCAN + DEL + DB read. `getBundle()` 시 Redis IO.
- 동시성 모델: NestJS 싱글톤. `rulesByDomain` 은 단일 writer (refresh 만) + 다수 reader (getBundle, ruleCount). 동시 invalidate 호출 시 race 가능.
- 테스트 커버리지 흔적: 없음 (핵심 갭. [INDEX.md §4.5](../../INDEX.md))

---

```ts path=src/policies/policies.service.ts lines=1-17
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { RedisService } from '../cache/redis.service';
import { DbService } from '../db/db.service';
import { resolveMultiDomainChain } from './domain-resolver';
import { loadBundlesFromDir, loadPoliciesFromDir } from './loader';
import { buildCompiledBundle } from './merger';
import { CompiledBundle, Rule, RuleSchema } from './policy.types';

@Injectable()
export class PoliciesService implements OnModuleInit {
  private readonly log = new Logger(PoliciesService.name);
  private rulesByDomain = new Map<string, Rule[]>();
  private domains: string[] = [];
  private bundleVersion = '0.1.0';

  constructor(private readonly redis: RedisService, private readonly db: DbService) {}
```

```ts path=src/policies/policies.service.ts lines=19-29
  async onModuleInit() {
    this.domains = (process.env.GUARDRAILS_ENABLED_DOMAINS ?? 'global')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await this.refresh();
    await this.seedIfNeeded();
    // Refresh once more so the freshly-seeded DB rows are visible to
    // subsequent bundle queries (refresh merges file + DB).
    await this.refresh();
  }
```

```ts path=src/policies/policies.service.ts lines=31-71
  async seedIfNeeded(): Promise<void> {
    if (!this.db.isAvailable()) {
      this.log.warn('DB unavailable, skipping rule seed.');
      return;
    }
    for (const [domain, rules] of this.rulesByDomain.entries()) {
      const existing = await this.db.countRulesByDomain(domain);
      if (existing > 0) {
        this.log.log(`Skip seed for "${domain}": ${existing} rule(s) already in DB.`);
        continue;
      }
      if (rules.length === 0) continue;
      const rows = rules.map((r) => ({
        rule_id: r.ruleId,
        domain: r.domain,
        locale: r.locale,
        io_type: r.ioType,
        category: r.category,
        sub_category: r.subCategory ?? null,
        severity: r.severity,
        priority: r.priority,
        action: r.action,
        pattern_bundle: r.patterns ?? {},
        message_template: r.messageTemplate ?? {},
        regulation_tags: r.regulationTags ?? [],
        examples_positive: r.examplesPositive ?? [],
        examples_negative: r.examplesNegative ?? [],
        enabled: r.enabled,
        version: r.version,
      }));
      const inserted = await this.db.bulkInsertRules(rows, 'file');
      this.log.log(`Seeded ${inserted}/${rules.length} rules into "${domain}" (source=file).`);
    }
  }
```

```ts path=src/policies/policies.service.ts lines=73-153
  async refresh(): Promise<void> {
    const ancestors = resolveMultiDomainChain(this.domains);
    const dir = process.env.POLICY_DIR ?? path.resolve(__dirname, '../../policies');
    const seedsDir = process.env.SEEDS_DIR ?? path.resolve(__dirname, '../../../../MCP-type-Guardrails-Service/scripts');
    const merged = new Map<string, Rule[]>();

    // 1a) directory-style file rules (legacy: policies/<domain>/<category>/...)
    const fileLoaded = await loadPoliciesFromDir(dir, ancestors);
    for (const [d, rules] of fileLoaded.byDomain.entries()) {
      merged.set(d, [...rules]);
    }
    // 1b) flat bundle files (preferred: scripts/<phase>.<locale>.json — gen-rules.py output)
    const bundleLoaded = await loadBundlesFromDir(seedsDir, ancestors);
    for (const [d, rules] of bundleLoaded.byDomain.entries()) {
      const existing = merged.get(d) ?? [];
      const byId = new Map(existing.map((r) => [r.ruleId, r] as const));
      for (const r of rules) byId.set(r.ruleId, r);  // bundle wins on ruleId conflict
      merged.set(d, [...byId.values()]);
    }

    // 2) db rules (admin overrides / additions)
    let dbCount = 0;
    if (this.db.isAvailable()) {
      const dbRows = await this.db.listAllRules();
      const byId = new Map<string, { domain: string; idx: number }>();
      for (const [d, rules] of merged.entries()) {
        rules.forEach((r, i) => byId.set(r.ruleId, { domain: d, idx: i }));
      }
      for (const row of dbRows) {
        const dto = {
          ruleId: row.rule_id,
          domain: row.domain,
          locale: row.locale,
          ioType: row.io_type,
          category: row.category,
          subCategory: row.sub_category ?? undefined,
          description: '',
          patternType: 'classifier',
          patterns: (row.pattern_bundle ?? {}) as Rule['patterns'],
          severity: row.severity,
          priority: row.priority,
          action: row.action,
          messageTemplate: (row.message_template ?? {}) as Record<string, string>,
          regulationTags: row.regulation_tags ?? [],
          examplesPositive: row.examples_positive ?? [],
          examplesNegative: row.examples_negative ?? [],
          enabled: row.enabled,
          version: row.version,
        };
        const parsed = RuleSchema.safeParse(dto);
        if (!parsed.success) {
          this.log.warn(`DB rule ${row.rule_id} invalid: ${parsed.error.message}`);
          continue;
        }
        const existing = byId.get(row.rule_id);
        if (existing) {
          merged.get(existing.domain)![existing.idx] = parsed.data;
        } else {
          const arr = merged.get(row.domain) ?? [];
          arr.push(parsed.data);
          merged.set(row.domain, arr);
        }
        dbCount++;
      }
    }

    this.rulesByDomain = merged;
    let total = 0;
    for (const arr of merged.values()) total += arr.length;
    this.log.log(
      `Loaded ${total} rules across ${merged.size} domains ` +
      `(file=${fileLoaded.total}, bundle=${bundleLoaded.total}, db=${dbCount}).`,
    );
  }
```

```ts path=src/policies/policies.service.ts lines=155-183
  enabledDomains(): string[] {
    return [...this.domains];
  }

  ruleCount(): number {
    let n = 0;
    for (const arr of this.rulesByDomain.values()) n += arr.length;
    return n;
  }

  async getBundle(domains: string[], locale: string, ioType: 'input' | 'output'): Promise<CompiledBundle> {
    const chain = resolveMultiDomainChain(domains);
    const cacheKey = `bundle:${chain.join('+')}:${locale}:${ioType}`;
    const cached = await this.redis.get<CompiledBundle>(cacheKey);
    if (cached) return cached;
    const compiled = buildCompiledBundle(this.rulesByDomain, chain, locale, ioType, this.bundleVersion);
    await this.redis.set(cacheKey, compiled, 300);
    return compiled;
  }

  async invalidate(): Promise<void> {
    await this.redis.del('bundle:');
    await this.refresh();
  }
}
```

**분석 / Analysis (Level 2)**

- **L1-8 imports**: Nest 데코레이터 + `path` + 두 글로벌 service + 같은 모듈 내 함수 + zod schema.
- **L11-15 클래스 필드**:
  - `rulesByDomain` — 인메모리 캐시 (도메인 → 룰 배열).
  - `domains` — 활성 도메인 (env 파싱 결과).
  - `bundleVersion = '0.1.0'` — 하드코딩 버전 문자열. 외부 변경 불가. 운영 시 빌드 메타 (`process.env.npm_package_version`) 를 사용하는 게 더 자연스러움.
- **L17 생성자**: 두 글로벌 service 주입.
- **L19-29 `onModuleInit`**:
  - env 파싱: `'global'` 디폴트. `.filter(Boolean)` 으로 빈 토큰 제거.
  - `refresh()` → `seedIfNeeded()` → `refresh()` 의 **2회 호출**. 의미:
    1. 1차 refresh: file/bundle 로드 + DB read (비어있음).
    2. seedIfNeeded: 1차 결과를 DB 에 시드.
    3. 2차 refresh: file/bundle 다시 로드 + DB read (시드 결과 포함).
  - **위험**: 1차 refresh 가 file/bundle 모두를 메모리에 올림. 2차 refresh 가 다시 동일 파일을 읽음 → 부트 시간 2배, 파일 IO 2배. [INDEX.md §4.3 #4](../../INDEX.md).
  - 또 `seedIfNeeded` 가 룰 0건이면 2차 refresh 가 결과적으로 1차와 동일 → 무의미한 추가 호출.
  - **개선**: `seedIfNeeded` 가 실제 insert 한 경우만 2차 refresh.
  - 흔한 실수: lifecycle 메서드에서 throw 시 NestJS 가 부트를 fail. 내부 메서드 (`refresh`, `seedIfNeeded`) 가 catch 다 흡수하므로 부트 안정. fail-open 패턴 유지.
- **L31-71 `seedIfNeeded`**:
  - `db.countRulesByDomain` 가드: 이미 룰이 있으면 skip → 멱등성 보장. Admin 수정값 보호.
  - 행 매핑: snake_case 변환. `r.patterns ?? {}` 등 옵셔널 → 빈 객체/배열 fallback.
  - `bulkInsertRules(rows, 'file')` 호출 — `source` 필드를 `'file'` 로 명시 (DB CHECK 제약 만족).
  - 흔한 실수: `r.enabled` (boolean) 을 그대로 전달 — `bulkInsertRules` SQLite 분기가 `? 1 : 0` 변환 (`db.service.ts:172`). 위임 OK.
  - **잠재 이슈**: file 측 룰이 X개여도 DB 에 1개라도 있으면 skip — 도메인별로 partial seed 가 불가능. 의도된 멱등성 트레이드오프.
- **L73-153 `refresh`** (핵심):
  - `ancestors = resolveMultiDomainChain(this.domains)` — 활성 도메인의 모든 부모까지 확장. 부트 시 한 번 계산되지만 매 refresh 마다 재계산 (cheap).
  - **`SEEDS_DIR` 기본값** (`'../../../../MCP-type-Guardrails-Service/scripts'`) — `dist` 빌드 후 컨테이너에서 존재하지 않는 경로. 환경변수 미설정 시 silent 빈 결과. [INDEX.md §4.3 #1](../../INDEX.md) 최상위 위험.
  - **1a/1b 머지**:
    - 1a: `loadPoliciesFromDir` 결과를 `merged` 에 복사.
    - 1b: `loadBundlesFromDir` 결과를 기존 entries 와 ruleId 기준으로 머지 — bundle wins on conflict.
    - byId Map 이 깔끔하지만 같은 도메인의 같은 ruleId 가 file 과 bundle 양쪽에 있을 때 bundle 이 이긴다 — 정책.
  - **2) DB 머지**:
    - 모든 룰을 `byId: Map<ruleId, {domain, idx}>` 로 인덱싱.
    - DB row 마다 DTO 변환 + zod safeParse.
    - 기존 ruleId 면 in-place 갱신 (`merged.get(domain)![idx] = parsed.data`).
    - 새 ruleId 면 `row.domain` 에 push. **새 도메인이 `merged` 에 없으면 빈 배열로 시작**. `GUARDRAILS_ENABLED_DOMAINS` 에 없는 도메인의 admin 룰도 메모리에 올라옴. 의도된 동작 (admin override 보존) 이지만 enabled set 와 메모리 set 가 불일치 가능.
  - **DTO 변환의 `description: ''` 와 `patternType: 'classifier'` 하드코딩** — DB row 에 description/patternType 컬럼이 없기 때문. 의미상 손실 — admin 도구에서 description 을 받을 수 있게 스키마 확장 필요.
  - **`row.action` 이 임의 string** — `DbService.listAllRules` 의 타입이 `action: string` 이라 좁히지 않음. zod `Action` enum 이 catch (parse 실패 시 warn). 새 액션 추가 시 zod 도 갱신해야 한다.
  - **mutation 위험**: `merged.get(existing.domain)![existing.idx] = parsed.data` — non-null assertion 사용. `existing` 이 정의되어 있으면 domain 도 존재 — 안전하지만 readability 약함.
  - **위험: refresh 동안의 read** — `getBundle()` 이 동시 호출되면 `rulesByDomain` 의 일관성? `this.rulesByDomain = merged` 가 마지막에 한 번에 일어나 atomic swap — `merged` 완성될 때까지 기존 Map 그대로 사용. 정상.
- **L155-157 `enabledDomains`**: 방어 복사 `[...]` — caller 가 mutate 해도 내부 영향 없음.
- **L159-163 `ruleCount`**: O(domains). 전체 카운트. Health/Domains controller 가 호출. cheap.
- **L165-173 `getBundle`**:
  - `cacheKey = bundle:<chain>:<locale>:<ioType>`. Redis `get` → hit 면 즉시 반환.
  - miss 시 `buildCompiledBundle` 빌드 + Redis `set` (TTL 300).
  - **단일 비행 (single-flight) 부재**: 동일 키 동시 miss 시 빌드 중복. 룰 카운트가 작으면 무해.
  - 정합성: `this.rulesByDomain` 참조 — refresh 와 race 없음 (atomic swap).
  - 흔한 실수: cache hit 후 `cached` 가 `CompiledBundle` 형태인지 zod 검증 안 함. Redis 가 손상된 JSON 또는 schema drift 발생 시 클라이언트가 손상 데이터 수신. 단, `invalidate()` 에서 `bundle:` prefix 전체 삭제하므로 schema drift 는 `version` 으로 detection 필요.
- **L179-182 `invalidate`**:
  - Redis `del('bundle:')` — SCAN + DEL prefix. `RedisService.del` 구현.
  - `refresh()` — 메모리 + DB 재로드.
  - 흔한 실수: `await` 가 redis del 과 refresh 를 직렬화. 동시 invalidate 호출 시 두 번째 호출이 첫 번째 완료를 기다리지 않음 — NestJS 인스턴스가 싱글톤이지만 메서드 자체는 reentrant. 동시 호출이 부분적으로 겹치면 두 refresh 가 동시 진행 → 마지막 swap wins. 의미상 무해.

**짚어볼 점 / Watch-outs**

1. **`SEEDS_DIR` 기본값의 모노레포 상대경로 의존** — 컨테이너에서 항상 silent 빈 결과. **최상위 위험**.
2. **`onModuleInit` 의 2회 refresh** — 부트 시간 2배.
3. **`bundleVersion` 하드코딩 `'0.1.0'`** — 빌드 / 운영 버전과 무관.
4. **DTO 매핑의 `description: ''` / `patternType: 'classifier'` 하드코딩** — DB schema 가 description/patternType 컬럼을 갖지 않기 때문. 정보 손실.
5. **cache hit 시 zod 재검증 부재** — Redis 손상 또는 schema drift 대비 약함.
6. **단일 비행 부재** — 동일 키 동시 miss 시 빌드 중복.
7. **`merged.get(existing.domain)!` non-null assertion** — readability.
8. **새 도메인 push 시 `GUARDRAILS_ENABLED_DOMAINS` 무시** — admin 룰이 enabled set 밖 도메인에도 누적. 의도된 동작이나 명시 주석 필요.
9. **`row.action` 이 zod 검증 외 무가드** — DB CHECK 제약도 없음 ([schema.sqlite.ts 리뷰](../db/schema.sqlite.ts.md)).
10. **로그 메시지의 통계만 노출** — 어떤 룰이 머지에서 졌는지 추적 어려움 (디버그 로그 옵션화 권장).

**파일 단위 판정**

- 강점:
  1. 명확한 3-way 머지 (file → bundle → DB).
  2. atomic swap 으로 read consistency 보장.
  3. seed 멱등성.
  4. invalidate 의 Redis + 메모리 일관 갱신.
- 위험:
  1. `SEEDS_DIR` 기본값 의존성 (최상위).
  2. 2회 refresh.
  3. cache schema drift 대비 부재.
  4. `bundleVersion` 하드코딩.
- 개선 권고:
  1. `SEEDS_DIR` env 미설정 시 warn + 빈 결과 (명시).
  2. `seedIfNeeded` 가 실제 insert 한 경우만 2차 refresh.
  3. cache hit 시 `CompiledBundle.version` 검사 또는 zod-lite 가드.
  4. `bundleVersion = process.env.npm_package_version ?? '0.1.0'`.
  5. 핵심 메서드에 통합 테스트 추가 (file/bundle/DB 3 way 우선순위).
- 재읽기 권고 레벨: 3 (핵심 + 변경 영향 큼).
