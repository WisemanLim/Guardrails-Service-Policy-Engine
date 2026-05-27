# src/policies/policies.module.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ policies_Abstract.md](./policies_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: NestJS 모듈. `PoliciesController` + `PoliciesService` 등록 + export.
- 진입점에서의 거리: 2 (AppModule → PoliciesModule)
- 라인 수: 10
- 주요 export: `PoliciesModule`
- 의존 모듈 (internal): `./policies.controller`, `./policies.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 없음

---

```ts path=src/policies/policies.module.ts lines=1-10
import { Module } from '@nestjs/common';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
```

**분석 / Analysis (Level 2)**

- **L1-3 imports**: 두 형제 모듈만.
- **L5-8 `@Module`**:
  - `providers: [PoliciesService]` — DI 컨테이너 등록 (싱글톤).
  - `exports: [PoliciesService]` — `HealthController` 가 다른 모듈에서 주입받기 위해 export 필수. 정확.
- **`@Global()` 미적용**: `PoliciesService` 를 사용하는 외부 컨슈머 (`HealthController` 만 in this repo) 는 `AppModule` 에서 `PoliciesModule` 을 import 했기 때문에 export 만으로 충분.

**짚어볼 점 / Watch-outs**

- `PoliciesService` 가 `RedisService`, `DbService` 를 주입받지만 두 글로벌 모듈이라 이 모듈에서 import 불필요. NestJS DI 가 자동 해결.

**파일 단위 판정**

- 강점:
  1. 명시적 controllers/providers/exports.
- 위험:
  1. 없음.
- 개선 권고:
  1. 없음.
- 재읽기 권고 레벨: 0.
