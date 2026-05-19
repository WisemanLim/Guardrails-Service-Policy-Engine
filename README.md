# Guardrails-Service-Policy-Engine

LLM/RAG 가드레일의 **정책 저장·조회·합성** 계층. JSON 정책 번들을 파일·DB에서 로드하고, 도메인 상속 + 충돌 해소 규칙으로 compiled bundle을 생성해 MCP Server에 제공한다.

## 컴포넌트 책임

PRD §3.2 ②. 핵심 5가지:

1. **JSON 정책 번들 CRUD** — Domain × Locale × IO_type별 룰 로드
2. **Bundle hot reload** — 디스크 → 메모리 → Redis 캐시
3. **Whitelist/예외 관리** — 오탐 감소용 score 보정
4. **도메인 키 매핑** — `manufacturing-food` → `[global, manufacturing, manufacturing-food]` 상속 체인 해석
5. **정책 머지** — 다중 도메인 충돌 시 더 엄격한 action 우선

## 스택

- Node 20 + TypeScript 5.4
- NestJS 10
- ioredis (캐시)
- pg (PostgreSQL 클라이언트)
- zod (rule schema 검증)

## 디렉토리 구조

```
policies/                                # JSON 정책 번들 (이미지에 포함)
└── global/
    └── privacy/
        ├── input.ko-KR.json             # 7 rules
        ├── input.en.json                # 6 rules
        ├── output.ko-KR.json            # 4 rules
        └── output.en.json               # 4 rules
                                          # 합계 21 rules (Phase 1)
src/
├── main.ts
├── app.module.ts
├── config/
├── cache/
│   ├── cache.module.ts
│   └── redis.service.ts                 # 연결 실패 시 cache-less fallback
├── db/
│   ├── db.module.ts
│   └── pg.service.ts                    # 연결 실패 시 file-only mode
├── policies/
│   ├── policy.types.ts                  # Rule / CompiledBundle (zod)
│   ├── loader.ts                        # 디렉토리 워킹 + 스키마 검증
│   ├── merger.ts                        # 충돌 해소 + 우선순위
│   ├── domain-resolver.ts               # 상속 체인 산출
│   ├── policies.service.ts              # 캐시/머지 오케스트레이션
│   ├── policies.controller.ts           # GET /policies/bundle
│   └── __tests__/
│       ├── domain-resolver.spec.ts
│       └── merger.spec.ts
├── domains/
│   ├── domains.module.ts
│   └── domains.controller.ts            # GET /domains, /domains/:k/chain
├── whitelist/
│   ├── whitelist.module.ts
│   ├── whitelist.service.ts
│   └── whitelist.controller.ts
└── health/health.controller.ts
```

## REST API

| 메서드 | 경로 | 설명 |
| :-- | :-- | :-- |
| GET | `/health` | 헬스 + 활성 도메인/룰 카운트 |
| GET | `/policies/bundle?domains=&locale=&ioType=` | compiled bundle (캐시 우선) |
| POST | `/policies/invalidate` | bundle:* 캐시 무효화 |
| GET | `/policies/domains` | 활성 도메인 + 총 룰 수 |
| GET | `/domains` | DB 도메인 레지스트리 |
| GET | `/domains/:key/chain` | 단일 leaf의 상속 체인 |
| GET | `/domains/:keys/chain-multi` | CSV leaves의 합쳐진 체인 |
| GET | `/whitelist?domain=&locale=` | whitelist 엔트리 |

`domains` 파라미터는 CSV 또는 반복 쿼리 둘 다 허용.

## Rule 스키마

`src/policies/policy.types.ts` zod 정의. JSON 파일 예시:

```json
{
  "rules": [
    {
      "ruleId": "PRIV_ID_KR_IN_001",
      "domain": "global",
      "locale": "ko-KR",
      "ioType": "input",
      "category": "pii",
      "subCategory": "national_id_kr",
      "patternType": "regex",
      "patterns": { "regex": ["\\b\\d{6}[- ]?\\d{7}\\b"] },
      "severity": "critical",
      "priority": 950,
      "action": "block",
      "messageTemplate": { "ko-KR": "주민등록번호는 입력할 수 없습니다." },
      "regulationTags": ["KR_PIPA"],
      "examplesPositive": ["..."],
      "examplesNegative": ["..."]
    }
  ]
}
```

지원 `action`: `allow`, `warn`, `redact`, `sanitize`, `block`, `block_or_redact`, `block_or_pseudonymize`, `aggregate_only`, `refuse`, `escalate`, `add_disclaimer`, `route`.

## 도메인 머지 알고리즘 (PRD §4.1.4)

요청: `domains=[manufacturing-food, manufacturing-chemical], locale=ko-KR, ioType=input`

1. `resolveMultiDomainChain` → `[global, manufacturing, manufacturing-food, manufacturing-chemical]` (depth 오름차순)
2. 각 도메인의 rule을 chain 순서대로 평가, `(category, subCategory, locale, ioType)` 키별로 유지
3. 동일 키에서 충돌 시 **엄격도 비교**:
   - `block(7) > refuse/escalate(6) > block_or_redact(5) > redact(4) > sanitize(3) > add_disclaimer(2) > warn(1) > allow(0)`
4. 동률 시 `priority` 큰 쪽 + 더 specific 도메인 우선
5. 최종 결과를 `priority` 내림차순 정렬

테스트: `src/policies/__tests__/merger.spec.ts`

## 캐시 전략

키 패턴: `bundle:<global+manufacturing+manufacturing-food>:<locale>:<ioType>`

- TTL 300초
- POST `/policies/invalidate` → `bundle:*` 전체 삭제
- Redis 미가용 시 cache-less 직통 (성능만 저하, 동작 영향 없음)

## 환경 변수

| 변수 | 기본 | 설명 |
| :-- | :-- | :-- |
| `PORT` | `8082` | |
| `POLICY_DIR` | `./policies` | 정책 JSON 루트 |
| `GUARDRAILS_ENABLED_DOMAINS` | `global` | CSV — 부팅 시 로드 대상 |
| `POSTGRES_*` | (compose 기본) | 도메인 레지스트리/whitelist 조회 |
| `REDIS_*` | (compose 기본) | 캐시 |
| `LOG_LEVEL` | `info` | |

## 로컬 개발

```bash
npm install
cp .env.example .env

# Redis/PG 없이도 부팅 (loader는 file-only 동작)
npm run start:dev

# bundle 조회
curl 'http://localhost:8082/policies/bundle?domains=global&locale=ko-KR&ioType=input' | jq .
```

## 테스트

```bash
npm test
```

- `domain-resolver.spec.ts` — 상속 체인, 다중 leaf 합치기
- `merger.spec.ts` — strict 우선, locale/ioType 필터

## 도메인 확장 (Phase 2 → P2 manufacturing-food)

신규 도메인 추가 절차:

1. `policies/manufacturing-food/<category>/<io>.<locale>.json` 디렉토리 생성
   - 카테고리 디렉토리는 단순 분류용 — loader는 재귀적으로 *.json 전체 로드
2. 각 rule의 `domain` 필드를 `manufacturing-food`로 설정 (loader가 검증)
3. `GUARDRAILS_ENABLED_DOMAINS=global,manufacturing-food` 로 재시작
4. 로드 시점에 `resolveMultiDomainChain`이 `manufacturing`(부모) 자동 포함 → 부모 도메인 룰 디렉토리도 함께 두면 상속

신규 도메인이 추가되어도 P1(`global` 단독) 배포는 영향 없음 — overlay만 빠지면 기존 룰만 로드.

## Database

`init-db.sql`이 생성하는 테이블:
- `domains` — 도메인 레지스트리 (parent_key 자기참조)
- `rules` — DB 기반 룰 (현재는 파일 우선, M2부터 DB 동기화)
- `policy_versions` — 버전 관리
- `whitelists` — 예외 표현

DB 미사용 시 file-only 모드로 동작 (개발 편의).

## Docker

```bash
docker build -t guardrails-policy-engine .
docker run --rm -p 8082:8082 \
  -e GUARDRAILS_ENABLED_DOMAINS=global \
  guardrails-policy-engine
```

`policies/` 디렉토리는 이미지에 포함. 외부 mount로 hot-override 가능:

```bash
docker run -v ./overrides:/app/policies/overrides:ro ...
```

## 향후 작업 (M2+)

- DB ↔ 파일 양방향 동기화 (Admin Console에서 편집한 rule을 파일에 export)
- Rule signature 검증 (sigstore/GPG)
- Bundle diff 시각화
- Policy version 승격 워크플로우 (draft → staged → active)
- Whitelist matcher (현재는 schema/조회만; matcher는 M2)
