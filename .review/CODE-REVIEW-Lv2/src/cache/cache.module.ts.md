# src/cache/cache.module.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

**파일 요약 / File Summary**
- 역할 / Role: `@Global()` Cache 모듈. `RedisService` 만 노출.
- 진입점에서의 거리: 2 (main → AppModule → CacheModule)
- 라인 수: 9
- 주요 export: `CacheModule`
- 의존 모듈 (internal): `./redis.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 없음

---

```ts path=src/cache/cache.module.ts lines=1-9
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class CacheModule {}
```

**분석 / Analysis (Level 2)**

- **L1 `Global, Module`**: NestJS의 `@Global()` 데코레이터는 이 모듈을 모든 모듈에서 추가 import 없이 사용 가능하게 만든다.
- **L4 `@Global()`**: 글로벌 마킹의 트레이드오프: 편의성 ↑, 추적성 ↓. 본 레포에서 `RedisService` 사용처는 `PoliciesService` 1곳뿐이므로 글로벌이 꼭 필요하지는 않다 — 그냥 `imports: [CacheModule]` 만 추가하면 충분. 다만 향후 다른 도메인이 캐시를 쓸 수 있다는 전제로 미리 깔아둔 것으로 해석 가능.
- **L5-7 `providers`/`exports`**: `RedisService`를 모두 노출. NestJS 관용으로 둘 다 명시 필요(providers 만으로는 외부 모듈에서 주입 불가).
- 흔한 실수: `exports` 를 빠뜨려 `RedisService is not a known module dependency` 런타임 에러를 만나는 경우. 본 파일은 정확히 둘 다 선언.

**짚어볼 점 / Watch-outs**

- 모듈 자체엔 결함 없음. `@Global()` 의 광역성을 인지하면 충분.

---

**파일 단위 판정**

- 강점: 단일 책임. 표준 NestJS 모듈 형태.
- 위험: 글로벌 데코레이터가 추적성을 떨어뜨림(낮은 위험).
- 개선 권고: 단일 소비자만 있다면 `@Global()` 제거 검토.
- 재읽기 권고 레벨: 0 (보일러플레이트).
