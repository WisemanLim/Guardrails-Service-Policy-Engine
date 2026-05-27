# src/policies/policies.controller.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `/policies/bundle`, `/policies/invalidate`, `/policies/domains`, `/policies/:domain/count` 4개 라우트.
- 진입점에서의 거리: 2 (AppModule → PoliciesModule → PoliciesController)
- 라인 수: 39
- 주요 export: `PoliciesController`
- 의존 모듈 (internal): `./policies.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음 (서비스 위임)
- 동시성 모델: 요청 단위
- 테스트 커버리지 흔적: 없음

---

```ts path=src/policies/policies.controller.ts lines=1-22
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { PoliciesService } from './policies.service';

@Controller('policies')
export class PoliciesController {
  constructor(private readonly svc: PoliciesService) {}

  // GET /policies/bundle?domains=global&domains=manufacturing-food&locale=ko-KR&ioType=input
  @Get('bundle')
  async getBundle(
    @Query('domains') domainsRaw: string | string[],
    @Query('locale') locale: string,
    @Query('ioType') ioType: 'input' | 'output',
  ) {
    if (!locale || !ioType) {
      throw new HttpException('locale and ioType are required', HttpStatus.BAD_REQUEST);
    }
    const domains = Array.isArray(domainsRaw)
      ? domainsRaw
      : (domainsRaw ?? 'global').split(',').map((s) => s.trim()).filter(Boolean);
    return this.svc.getBundle(domains, locale, ioType);
  }
```

```ts path=src/policies/policies.controller.ts lines=24-39
  @Post('invalidate')
  async invalidate() {
    await this.svc.invalidate();
    return { ok: true };
  }

  @Get('domains')
  list() {
    return { domains: this.svc.enabledDomains(), rules: this.svc.ruleCount() };
  }

  @Get(':domain/count')
  count(@Param('domain') _d: string) {
    return { domain: _d, ruleCount: this.svc.ruleCount() };
  }
}
```

**분석 / Analysis (Level 2)**

- **L1 imports**: `Body` 가 사용되지 않음 — 데드 import.
- **L9-22 `GET /bundle`**:
  - `@Query('domains')` 는 Express 가 multi-value 일 때 배열, single 일 때 문자열 반환. 두 경우 모두 처리.
  - **검증**: `locale`/`ioType` 만 필수. `ioType` 의 값이 `'input'|'output'` 인지 확인 부재 — 임의 문자열 (`'banana'`) 도 통과 → 서비스의 `mergeRules` 가 `r.ioType !== ioType && r.ioType !== 'both'` 비교에서 0 매치 → 빈 룰 번들 반환. 사용자 디버깅 어려움. 명시 검증 필요.
  - 흔한 실수: `'input' | 'output'` 타입을 신뢰하지만 런타임 검증 없이 그대로 서비스로 전달. TypeScript 컴파일러는 안심하지만 런타임은 무방어.
  - `domainsRaw ?? 'global'` — 비어있을 때 `'global'` fallback. 단일 문자열 분기에서만 적용 — 배열 분기에서는 빈 배열 그대로 통과. 일관성 부족.
  - 흔한 실수: `'global,'` 같은 입력 → `split(',').filter(Boolean)` → `['global']`. 안전.
- **L24-28 `POST /invalidate`**:
  - 인증 없음. 누구나 캐시 invalidate + DB refresh 트리거 가능. Admin 서비스만 호출한다는 가정.
  - 성공 시 `{ok:true}` 하드코딩 — 실패는 NestJS 가 500 으로 변환.
  - **부수효과**: `svc.invalidate()` 가 Redis del + DB refresh — 비싼 호출. rate limit 부재.
- **L30-33 `GET /domains`**:
  - `enabledDomains` 와 `ruleCount` 만. 가벼운 진단 엔드포인트.
- **L35-38 `GET /:domain/count`**:
  - 파라미터 `_d` 를 받지만 `ruleCount()` 는 인자 무시 — 전체 카운트 반환. **버그성 의도 불일치**. [INDEX.md §4.4](../../INDEX.md).
  - 의도가 "특정 도메인의 룰 카운트" 라면 `policies.service` 의 `ruleCount(domain)` 오버로드가 필요.

**짚어볼 점 / Watch-outs**

1. **`count(:domain)` 의 파라미터 무시 버그** — 응답에 `domain` 은 echo 하지만 ruleCount 는 도메인 무관. 사용자가 잘못된 값을 신뢰할 위험.
2. **`ioType` 런타임 검증 부재** — 임의 문자열이 빈 룰을 반환. 명시 throw 권장.
3. **`Body` import 미사용** — 데드 코드.
4. **`POST /invalidate` 무인증** — admin 서비스 내부 호출 가정. 외부 노출 시 DoS / 정책 reload 어뷰즈 가능. 인증 헤더 또는 IP allow list 권장.
5. **DTO 미정의** — `class-validator` 적용 시 깔끔한 검증 가능.

**파일 단위 판정**

- 강점:
  1. 단순 위임 컨트롤러 — 39 줄.
  2. 쿼리 파라미터 multi-value 처리.
- 위험:
  1. `count` 의 파라미터 무시.
  2. `ioType` 런타임 검증 부재.
  3. `invalidate` 인증 부재.
- 개선 권고:
  1. `ioType` 을 zod 또는 NestJS Pipe 로 검증.
  2. `count` 를 `ruleCount(_d)` 로 수정 + 서비스에 도메인 인자 지원 추가.
  3. `Body` import 제거.
  4. `invalidate` 에 가드 (Bearer / API key).
- 재읽기 권고 레벨: 2.
