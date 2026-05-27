# src/domains/domains.controller.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ domains_Abstract.md](./domains_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `/domains` HTTP 라우트 3개 (list / chain / chain-multi).
- 진입점에서의 거리: 2 (AppModule → DomainsModule → DomainsController)
- 라인 수: 27
- 주요 export: `DomainsController`
- 의존 모듈 (internal): `../db/db.service`, `../policies/domain-resolver`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: HTTP 요청에 따라 DB 조회 (`listDomains`)
- 동시성 모델: 요청 단위 (Nest Express 기본)
- 테스트 커버리지 흔적: 없음

---

```ts path=src/domains/domains.controller.ts lines=1-27
import { Controller, Get, Param } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { resolveDomainChain, resolveMultiDomainChain } from '../policies/domain-resolver';

@Controller('domains')
export class DomainsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list() {
    if (!this.db.isAvailable()) {
      return { source: 'fallback', driver: this.db.driver, items: [{ domainKey: 'global', status: 'active' }] };
    }
    const items = await this.db.listDomains();
    return { source: 'db', driver: this.db.driver, items };
  }

  @Get(':key/chain')
  chain(@Param('key') key: string) {
    return { domain: key, chain: resolveDomainChain(key) };
  }

  @Get(':keys/chain-multi')
  chainMulti(@Param('keys') keys: string) {
    return { domains: keys.split(','), chain: resolveMultiDomainChain(keys.split(',')) };
  }
}
```

**분석 / Analysis (Level 2)**

- **L1-3 imports**:
  - `DbService` (글로벌 모듈에서 주입), `domain-resolver` (계층 위반의 경계 — 컨트롤러가 다른 도메인 모듈의 함수 직접 import). [INDEX.md §4.2 #1](../../INDEX.md).
- **L5 `@Controller('domains')`**: 라우트 prefix `/domains`.
- **L7 생성자 주입**: `DbService` 만. `domain-resolver` 는 stateless 함수라 DI 불필요.
- **L9-15 `GET /domains`**:
  - `isAvailable()` 가드 — DB 다운 시 `'global'` 단일 항목의 fallback 응답. `source:'fallback'` 으로 클라이언트가 상태 식별 가능.
  - DB ON 시 `listDomains()` (Postgres or SQLite). 반환 row 의 컬럼 이름은 `domain_key` (snake) 인데 fallback 에서는 `domainKey` (camel) — **불일치**. 클라이언트 입장에서 응답 키가 들쭉날쭉.
  - 흔한 실수: `await` 누락 — 본 코드는 `async` + `await` 정확.
  - DTO 변환 부재 — row 객체 그대로 응답. snake_case 노출.
- **L17-20 `GET /:key/chain`**:
  - `:key` 파라미터를 그대로 `resolveDomainChain(key)` 호출.
  - 검증 없음: `key` 가 `"../../etc/passwd"` 같은 경로 토큰이어도 그냥 split('-') 되어 chain 으로 반환. 보안 영향 미미 — 단순 문자열 가공 함수라 IO 없음. 다만 입력 검증 부재는 패턴.
- **L22-26 `GET /:keys/chain-multi`**:
  - `keys` 가 콤마 구분 문자열. `keys.split(',')` 을 **두 번** 호출 — 사소한 중복.
  - URL path 에 콤마: `/domains/foo,bar/chain-multi`. URL 인코딩 시 `%2C` — 클라이언트가 디코딩 필요. 합리적이나 query parameter (`?domains=foo&domains=bar`) 가 더 표준적.

**짚어볼 점 / Watch-outs**

1. **응답 스키마 불일치**: fallback `{domainKey, status}` vs DB `{domain_key, status, version}`. 클라이언트 코드 보호 부족.
2. **입력 검증 부재**: `@Param` 으로 받은 문자열을 그대로 신뢰. 도메인 키는 영문/하이픈 제한이 자연스러움 — 정규식 검증 부재.
3. **컨트롤러가 두 모듈에 결합** — `db/` + `policies/` 양쪽. 작은 함수라 큰 문제는 아니지만 모듈 경계 흐림.
4. **`keys.split(',')` 중복 호출** — 한 줄에서 두 번 호출. 변수로 추출하면 가독성 ↑.
5. **에러 경로 미정의** — `listDomains()` 가 throw 하면 Nest 기본 500 응답. 명시 catch 부재.

---

**파일 단위 판정**

- 강점:
  1. fallback 분기로 DB 다운 시에도 200 응답 (`global` 보장).
  2. 27 줄, 의도 한눈에.
- 위험:
  1. 응답 키 표기 불일치.
  2. 입력 검증 부재 (정규식 / class-validator).
  3. 모듈 경계 위반.
- 개선 권고:
  1. 응답 DTO 통일 (`domainKey` 로 정규화).
  2. `@Param` 에 정규식 (`'@Get(":key([a-z0-9-]+)/chain")'`) 추가.
  3. `keys.split(',')` 변수 추출.
- 재읽기 권고 레벨: 1.
