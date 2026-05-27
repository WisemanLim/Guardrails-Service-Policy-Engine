# src/whitelist/whitelist.controller.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ whitelist_Abstract.md](./whitelist_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `GET /whitelist?domain=&locale=` 단일 라우트.
- 진입점에서의 거리: 2 (AppModule → WhitelistModule → WhitelistController)
- 라인 수: 12
- 주요 export: `WhitelistController`
- 의존 모듈 (internal): `./whitelist.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: DB 조회 위임
- 동시성 모델: 요청 단위
- 테스트 커버리지 흔적: 없음

---

```ts path=src/whitelist/whitelist.controller.ts lines=1-12
import { Controller, Get, Query } from '@nestjs/common';
import { WhitelistService } from './whitelist.service';

@Controller('whitelist')
export class WhitelistController {
  constructor(private readonly svc: WhitelistService) {}

  @Get()
  async list(@Query('domain') domain = 'global', @Query('locale') locale = 'ko-KR') {
    return { items: await this.svc.list(domain, locale) };
  }
}
```

**분석 / Analysis (Level 2)**

- **L1 import**: `Controller`/`Get`/`Query` — 표준.
- **L4 prefix**: `/whitelist`.
- **L8-10 `GET /whitelist`**:
  - 파라미터 디폴트: `domain='global'`, `locale='ko-KR'`. `@Query` 디폴트는 NestJS 가 `undefined` 시 적용 — 안전한 fallback.
  - 응답 wrapper `{items: [...]}` — 메타데이터 확장에 유연.
  - `await` 가 응답 전 완료 보장.
  - 검증 부재: `domain` 이 `'../bad'` 등이어도 그대로 전달. `WhitelistService` → `DbService.listWhitelist` 가 parameterized query 라 SQL 인젝션 안전. 다만 임의 도메인 키도 통과 (빈 결과 반환).

**짚어볼 점 / Watch-outs**

1. **응답 형태 단순** — pagination 없음. 화이트리스트가 도메인×로케일당 수십 건 가정 — 무한 성장 시 페이징 필요.
2. **인증 부재** — 화이트리스트가 민감 정보 (실명, 식별자 패턴)일 가능성. 운영에서 가드 검토.
3. **`@Query` 디폴트** — `?domain=` (빈 문자열) 입력 시 `domain` 이 `''` 로 통과 — 디폴트가 적용되지 않음. `.trim()` + fallback 권장.

**파일 단위 판정**

- 강점:
  1. 12 줄, 의도 명확.
  2. 디폴트 파라미터로 호출자 부담 감소.
- 위험:
  1. pagination 부재.
  2. 빈 문자열 입력 처리 미명시.
  3. 인증 부재.
- 개선 권고:
  1. `domain = domain?.trim() || 'global'` 가드.
  2. limit/offset 옵션 추가.
- 재읽기 권고 레벨: 1.
