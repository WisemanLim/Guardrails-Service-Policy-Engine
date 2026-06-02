# 비교분석 REPORT: Guardrails-Service-Policy-Engine

## 1. 개요 (기준 ref 모듈 → 적용대상, 2026-06-02)

- **기준(ref, 개선·신규):** `DocuGuard-AI-Policy` — Policy + Audit + Redact를 단일 NestJS 프로세스(3개 포트)로 통합한 신규 리포지토리.
  - 매핑 원본: `src/policy/**` (Policy Engine) + `policies/**` (정책 픽스처) + **신규 `src/redact/**`** (HTTP 레다크션 티어).
- **적용대상(current):** `Guardrails-Service-Policy-Engine` — Policy 단일 앱 프로젝트(`src/app.module.ts` + `src/main.ts`, 단일 `PORT`).
- **구조 차이의 핵심:**
  - ref는 멀티 앱모듈 패턴(`policy-app.module.ts` / `audit-app.module.ts` / `redact-app.module.ts`를 `main.ts` 한 곳에서 부팅).
  - current는 분리형(split) — Policy와 Audit를 별도 프로젝트로 나눔. Policy 쪽은 ref의 `src/policy/` 하위를 **`policy/` 접두 없이 평탄화(flatten)** 하여 `src/`에 그대로 둠.
- **네이밍 정체성:** current = `guardrails-*` / `Guardrails-Service-*`, ref = `docuguard-*` / `DocuGuard-AI-*`. 본 적용에서는 **current 네이밍을 보존**하고 이식한 코드의 식별자/문자열만 current 규칙으로 맞춤.
- **이번 비교의 결론:** Policy 본체 소스는 ref와 **사실상 동일**(아래 §2 참조). 유일한 실질 변경은 **신규 Redact 티어 이식**이며, 이를 current 분리 구조에 맞게 추가 모듈로 포팅함.

---

## 2. 구조 비교 (디렉토리/파일 차이)

ref `src/policy/<X>` ↔ current `src/<X>` 기준 내용 비교(diff) 결과:

| 파일 (current 기준) | 비교 결과 |
|---|---|
| `cache/cache.module.ts` | 동일 |
| `cache/redis.service.ts` | 동일 |
| `db/db.module.ts` | 동일 |
| `db/db.service.ts` | **네이밍만 상이** — postgres 기본값 `docuguard` → `guardrails` (DB/USER/PASSWORD). 의도된 정체성 보존 분기. |
| `db/schema.sqlite.ts` | 동일 |
| `domains/domains.controller.ts`, `domains/domains.module.ts` | 동일 |
| `health/health.controller.ts` | 동일 |
| `policies/domain-resolver.ts`, `loader.ts`, `merger.ts` | 동일 |
| `policies/policies.controller.ts`, `policies.module.ts`, `policies.service.ts`, `policy.types.ts` | 동일 |
| `whitelist/whitelist.controller.ts`, `whitelist.module.ts`, `whitelist.service.ts` | 동일 |
| `policies/__tests__/domain-resolver.spec.ts`, `merger.spec.ts` | 동일 (current에 **이미 존재**) |
| `policies/global/privacy/*.json` (4종) | current에 이미 존재 (input/output × en/ko-KR) |
| `app.module.ts` (current) ↔ `policy-app.module.ts` (ref) | 클래스명만 상이(`AppModule` ↔ `PolicyAppModule`), import/구성 동일 |
| `main.ts` | ref는 3개 리스너 부팅 / current는 단일 리스너 → **본 적용에서 Redact 리스너 추가** |

### 신규(ref에만 존재) → current로 이식 대상

```
src/redact/
├── redact-app.module.ts     # RedactController + HealthController + RedactService
├── redact.controller.ts     # POST /redact (zod 검증)
├── redact.service.ts        # placeholder 치환 레다크션 로직
├── redact.types.ts          # zod 스키마 + 타입
└── health/health.controller.ts  # GET /health
```

current는 분리 구조이고 ref의 별도 `*-app build` 구조가 아니므로, **동일 프로세스 내 2번째 HTTP 리스너**로 추가(아래 §4 Redact 서브섹션 참조).

---

## 3. 의존성 변경 (package.json diff)

ref(`docuguard-ai-policy`) vs current(`guardrails-policy-engine`):

- **dependencies:** 완전 동일 (`@nestjs/*`, `ajv`, `better-sqlite3`, `ioredis`, `pg`, `reflect-metadata`, `rxjs`, `zod`).
  - Redact 티어가 사용하는 `zod`, `@nestjs/*`는 current에 **이미 선언**되어 있어 **신규 의존성 추가 없음.**
- **devDependencies:** 동일 (단, 선언 순서만 미세 차이 — `@types/jest`/`@types/better-sqlite3` 순서. 기능 영향 없음).
- **scripts:** current가 ref보다 `test:e2e` 1개 더 보유(`jest --config jest-e2e.json`). ref엔 없음. current 고유 항목이므로 보존.
- **결론:** package.json 변경 **불필요**. Redact 이식으로 인한 의존성 추가 0건.

---

## 4. 개선/추가/수정 항목 (설명 / ref 위치 / 영향도 / QA 리스크)

### 4.1 Policy 본체

| 항목 | 설명 | ref 위치 | 영향도 | QA 리스크 |
|---|---|---|---|---|
| Policy 소스 동기화 상태 | Policy 본체 코드가 ref와 동일. 추가 동기화 불필요 | `src/policy/**` | 없음 | 없음 |
| DB 기본 자격증명 | `docuguard` ↔ `guardrails` 네이밍 분기(의도) | `src/policy/db/db.service.ts` | 낮음 | 환경변수 미설정 시 기본값 차이 — `.env`로 명시 권장 |

### 4.2 [신규] Redact 티어 (Redact tier)

| 항목 | 설명 | ref 위치 | 영향도 | QA 리스크 |
|---|---|---|---|---|
| **Redact HTTP 서비스 신규 추가** | MCP Server가 원격 호출하는 레다크션 엔드포인트. `POST /redact` 입력(text + matches)을 받아 sub_category별 placeholder로 치환 | `src/redact/**` (ref 8085 포트) | 중간 (신규 표면적, 기존 Policy와 격리됨) | 신규 포트 바인딩 충돌, body 스키마 검증 경계, 치환 오프셋 정확성 |
| 치환 로직 | `matches`를 start 내림차순 정렬 후 뒤에서부터 치환하여 오프셋 무효화 방지. 범위 밖/역전 구간은 skip | `redact.service.ts` | 중간 | 겹치는 match, 음수/초과 오프셋, 빈 matches 처리 |
| 입력 검증 | `zod` `safeParse` 실패 시 `400 invalid_redact_request` + flatten 상세 | `redact.controller.ts` / `redact.types.ts` | 낮음 | 잘못된 payload에 대한 일관된 400 응답 |
| 격리성 | Redact 앱모듈은 DB/Redis import 없음 → Policy 부팅 실패와 독립 | `redact-app.module.ts` | 낮음 | 두 앱이 같은 프로세스이므로 한쪽 unhandled throw 시 프로세스 영향 |
| health | `GET /health` → `{status:'ok', service:'...[redact]'}` | `redact/health/health.controller.ts` | 낮음 | 서비스 식별 문자열 |

> **Redact 배치 결정 (중요):** ref는 `redact-app.module.ts`를 단일 `main.ts`에서 `PORT_REDACT(8085)`로 부팅한다. current Policy-Engine은 **분리(split)** 프로젝트이며 별도 sub-app 빌드 구조가 아니다. 가장 근접한 방식으로, **Policy-Engine 프로세스 내부에 2번째 NestJS 앱(Redact)을 추가 리스너로 부팅**(기본 `PORT_REDACT=8085`)했다. Audit은 별도 프로젝트이므로 여기서 다루지 않는다. Redact는 DB/Redis 의존이 없어 Policy 부팅과 독립적으로 동작한다.

---

## 5. 적용 내역 (Applied) (파일별 변경 + 이유)

### 5.1 Policy 본체

- 변경 없음. (ref와 동일하며, `db.service.ts`의 `guardrails` 기본값은 의도된 정체성으로 보존.)

### 5.2 [신규] Redact 티어 적용

| 파일 (신규/수정) | 변경 | 이유 |
|---|---|---|
| `src/redact/redact.types.ts` | 신규 | ref와 동일 zod 스키마/타입 이식 |
| `src/redact/redact.service.ts` | 신규 | ref와 동일 치환 로직 이식 |
| `src/redact/redact.controller.ts` | 신규 | ref와 동일 `POST /redact` 컨트롤러 이식 |
| `src/redact/health/health.controller.ts` | 신규 | health 응답 service 문자열을 `guardrails-policy-engine[redact]`로 변경(네이밍 정체성 보존). 그 외 ref와 동일 |
| `src/redact/redact-app.module.ts` | 신규 | ref와 동일 모듈 구성 이식(`RedactController`+`HealthController`+`RedactService`) |
| `src/main.ts` | 수정 | 기존 Policy 단일 리스너 유지 + **Redact 앱을 `PORT_REDACT`(기본 8085)로 동일 프로세스 내 2번째 리스너로 부팅**. `Promise.all`로 동시 부팅, `enableShutdownHooks` 적용, bootstrap 실패 시 명시적 `process.exit(1)` 추가(ref 패턴 차용) |
| `.env.example` | 수정 | `PORT_REDACT=8085` 항목 추가(주석 포함) |
| `Dockerfile` | 수정 | `EXPOSE 8082` → `EXPOSE 8082 8085`로 Redact 포트 노출 |

---

## 6. 미적용/보류 (Deferred) (이유)

- **단일 프로세스 3-포트 통합(ref `main.ts` 원형) 미채용:** current는 Policy/Audit 분리 구조가 전제이므로 Audit 리스너는 이식하지 않음. Redact만 Policy-Engine에 추가.
- **`docuguard` → `guardrails` 네이밍 통일은 보류(=현행 유지):** `db.service.ts` 기본 자격증명, 패키지명, health service 문자열 등은 의도된 정체성 분기로 보존.
- **ref `.env.example`의 `DB_DRIVER`/`SQLITE_PATH`/`SEEDS_DIR`/`PORT_AUDIT` 등 미반영:** Policy-Engine 범위 밖(Audit 포트)이거나 current가 이미 자체 `.env.example` 스키마를 갖고 있어 표면적 확대를 피함. 필요 시 후속 별도 작업으로 분리 권장.
- **Redact 단위 테스트 미추가:** ref에도 redact spec은 없음(merger/domain-resolver spec만 존재). §8 회귀테스트 권고에 추가 테스트 항목으로 명시.

---

## 7. 검증 결과 (build/typecheck/test)

- **환경 주의(사전 이슈):** 작업 경로에 괄호(`Web(Node,Script)`)가 포함되어 `better-sqlite3` 네이티브 gyp 빌드의 셸 명령이 깨지고, 설치 호스트 Node가 v26으로 `better-sqlite3@11`과 비호환 → 일반 `npm install` 실패. 이는 **본 변경과 무관한 기존 환경 문제**다. 빌드 검증을 위해 `npm install --ignore-scripts`로 툴체인(nest CLI/ts/jest)만 설치하여 진행함. (런타임에서 sqlite를 쓰려면 호환 Node + 괄호 없는 경로 또는 Docker(node:20-alpine)에서 정상 설치됨.)
- **Build (Policy-Engine):** `nest build` → **성공(exit 0)**. `dist/redact/`에 `redact-app.module.js`, `redact.controller.js`, `redact.service.js`, `redact.types.js`, `health/health.controller.js` 생성 확인.
- **Typecheck:** strict 모드 tsconfig 하에서 빌드 통과 = 타입 에러 없음.
- **Test:** `jest` → **2 suites / 7 tests 모두 PASS** (`domain-resolver.spec.ts`, `merger.spec.ts`). 기존 Policy 로직 회귀 없음.
- **결론:** Redact 이식 후 빌드/테스트 그린. 빌드를 깨뜨리는 변경 없음(revert 불필요).

---

## 8. QA 체크리스트 & 회귀테스트 권고

**Redact 티어 (신규 — 우선)**
- [ ] `POST /redact` 정상 payload → `{redactedText, replacements}` 반환, 치환 수 정확.
- [ ] 빈 `matches` → 원문 그대로, `replacements=0`.
- [ ] 겹치는 match / start 내림차순 치환 시 오프셋 무효화 없는지(뒤→앞 치환) 검증.
- [ ] 음수 start, `end > length`, `end <= start` 경계 → skip 처리 확인.
- [ ] 알 수 없는 `sub_category` → `[REDACTED]` fallback.
- [ ] 잘못된 body(스키마 위반) → `400 invalid_redact_request` + flatten 상세.
- [ ] `GET /health`(redact) → `service: guardrails-policy-engine[redact]`.
- [ ] `PORT_REDACT` 미설정 시 8085 기본 바인딩, Policy 8082와 포트 충돌 없음.
- [ ] Redact 앱 부팅 실패가 Policy 부팅과 격리되는지(공유 DB/Redis 없음) 확인.

**Policy 본체 (회귀)**
- [ ] `merger.spec.ts`, `domain-resolver.spec.ts` 통과 유지.
- [ ] `/policies`, `/domains`, `/whitelist`, `/health`(8082) 동작 회귀 없음.
- [ ] `db.service.ts` 기본 자격증명(`guardrails`) 및 `.env` 오버라이드 정상.

**빌드/배포**
- [ ] Docker(node:20-alpine)에서 `better-sqlite3` 정상 빌드 및 8082/8085 EXPOSE 확인.
- [ ] 단일 프로세스 2-리스너 동시 부팅/그레이스풀 셧다운 동작 확인.
- [ ] 회귀테스트 추가 권고: `redact.service.spec.ts`(치환 로직), `redact.controller`(검증 400) e2e.
