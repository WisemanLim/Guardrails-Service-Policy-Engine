# src/whitelist/whitelist.service.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ whitelist_Abstract.md](./whitelist_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `DbService.listWhitelist` 결과를 camelCase API DTO 로 변환.
- 진입점에서의 거리: 2 (WhitelistModule → WhitelistService)
- 라인 수: 28
- 주요 export: `WhitelistService`, `WhitelistEntry`
- 의존 모듈 (internal): `../db/db.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: DB 조회
- 동시성 모델: 요청 단위
- 테스트 커버리지 흔적: 없음

---

```ts path=src/whitelist/whitelist.service.ts lines=1-28
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface WhitelistEntry {
  id: string;
  domain: string;
  locale: string;
  category: string;
  patterns: string[];
  scoreAdjustment: number;
}

@Injectable()
export class WhitelistService {
  constructor(private readonly db: DbService) {}

  async list(domain: string, locale: string): Promise<WhitelistEntry[]> {
    const rows = await this.db.listWhitelist(domain, locale);
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      locale: r.locale,
      category: r.category,
      patterns: r.patterns,
      scoreAdjustment: r.score_adjustment,
    }));
  }
}
```

**분석 / Analysis (Level 2)**

- **L4-11 `WhitelistEntry`**: API DTO (camelCase). DB row 의 snake_case (`score_adjustment`) 를 `scoreAdjustment` 로 변환.
- **L15 생성자**: `DbService` 주입.
- **L17-26 `list`**:
  - DB row 그대로 map 으로 변환. `patterns` 는 이미 `DbService` 가 JSON.parse → `string[]` 변환 완료. 그대로 전달.
  - `scoreAdjustment: r.score_adjustment` — 명시 rename.
  - 흔한 실수: `r.patterns` 가 `null` 일 경우 — `DbService.listWhitelist` 는 SQLite 분기에서 `JSON.parse(r.patterns) as string[]`, 빈 패턴은 `'[]'` 디폴트라 안전. Postgres 도 `TEXT[]` 라 항상 배열. 안전.
  - 위임 패턴 — 비즈니스 로직 없음. 필터/페이징도 부재.

**짚어볼 점 / Watch-outs**

1. **변환 로직 단순 — 거의 패스스루**. service 계층 존재 의의는 약함. 미래 비즈니스 로직 (예: enabled 필터, 도메인 inheritance) 추가 시 의미 커짐.
2. **`r.patterns` 의 빈 배열 처리** — DbService 단계에서 처리되어 안전.
3. **pagination 부재** — 화이트리스트가 커지면 응답 부담.

**파일 단위 판정**

- 강점:
  1. 단순 변환.
  2. DTO 명시 export.
- 위험:
  1. 거의 패스스루.
- 개선 권고:
  1. 필요해지면 enabled 필터, pagination 추가.
- 재읽기 권고 레벨: 0.
