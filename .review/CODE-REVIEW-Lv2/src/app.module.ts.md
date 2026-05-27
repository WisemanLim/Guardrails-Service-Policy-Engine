# src/app.module.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../INDEX.md)

**파일 요약 / File Summary**
- 역할 / Role: 루트 NestJS 모듈. 6개의 도메인 모듈 + HealthController 묶음.
- 진입점에서의 거리: 1 (main.ts → AppModule)
- 라인 수: 21
- 주요 export: `AppModule` (클래스)
- 의존 모듈 (internal): `./health/health.controller`, `./policies/policies.module`, `./domains/domains.module`, `./whitelist/whitelist.module`, `./cache/cache.module`, `./db/db.module`
- 사용된 외부 패키지: `@nestjs/common`, `@nestjs/config`
- 부수효과: 없음 (선언적)
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 없음

---

```ts path=src/app.module.ts lines=1-21
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PoliciesModule } from './policies/policies.module';
import { DomainsModule } from './domains/domains.module';
import { WhitelistModule } from './whitelist/whitelist.module';
import { CacheModule } from './cache/cache.module';
import { DbModule } from './db/db.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CacheModule,
    DbModule,
    PoliciesModule,
    DomainsModule,
    WhitelistModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

**분석 / Analysis (Level 2)**

- **L2 `ConfigModule`**: NestJS의 `.env` 파싱을 책임. `isGlobal: true` 는 모든 모듈에서 `ConfigService` 를 별도 import 없이 주입받게 한다. **그러나** 본 레포에서 `ConfigService` 를 주입받는 곳은 **0건** (검토: `db.service.ts`, `redis.service.ts`, `policies.service.ts`, `main.ts` 모두 `process.env` 직접 참조). 즉 ConfigModule이 사실상 데드 코드에 가깝다 — 적어도 의도된 단일 출처가 작동하지 않음.
  - 흔한 실수: NestJS 가이드를 보고 `ConfigModule.forRoot()`만 추가한 뒤 실제 사용을 잊는 경우.
- **L3-8 imports**: 명시적 경로(`./xxx/xxx.module`). barrel(`index.ts`)을 쓰지 않은 점은 빌드/lint 성능 면에서 합리적. 변경 위험이 작다.
- **L10-19 `@Module`**:
  - `imports: [...]` 순서: `ConfigModule` → `CacheModule` → `DbModule` → 도메인 모듈. NestJS는 모듈 초기화 순서를 의존 그래프로 해소하므로 배열 순서가 의미 있는 경우는 드물지만, `CacheModule`/`DbModule` 이 `@Global()` 이므로 다른 도메인 모듈에서 import 없이 주입 가능. (실제로 `policies.service.ts` 가 `RedisService` 와 `DbService` 를 그냥 생성자에서 주입받음.) 이 패턴은 명시성을 희생하고 편의를 얻는다 — 의존 관계가 IDE에서 추적되기 어려워진다.
  - `controllers: [HealthController]` 만 루트에 둠 — 모듈을 새로 만들지 않은 합리적 단축. `HealthController`는 [policies.service.ts:159](./policies/policies.service.ts.md) 의 `ruleCount()` 와 `db.service.ts` 의 `isAvailable()` 에 의존하므로, 두 글로벌 모듈이 먼저 import 되어 있는 한 작동.
- **L21 `export class AppModule {}`**: 보일러플레이트.

**짚어볼 점 / Watch-outs**

- `ConfigModule` 사용 여부 결정 필요: 사용한다면 `ConfigService` 전환, 아니면 제거.
- `@Global()` 남용 주의 — `CacheModule`, `DbModule` 둘 다 글로벌. 본 레포 규모(≈1k LOC)에서는 합리적이지만 컴포넌트가 늘어나면 explicit dependency 가 더 안전.
- 글로벌 `Logger` 설정, `useGlobalPipes`/`useGlobalInterceptors` 같은 횡단 관심사가 main.ts에 없고 AppModule에도 없음 — 의도적이라면 명시 주석 필요.

---

**파일 단위 판정**

- 강점:
  1. 모듈 경계 명확, 6개 도메인 분리.
  2. 글로벌 모듈(Cache/Db)로 보일러플레이트 최소화.
  3. 21줄로 의도가 한눈에 보임.
- 위험:
  1. `ConfigModule` 임포트와 실제 미사용 사이의 불일치.
  2. `@Global()` 의 광역 노출이 추적성을 떨어뜨림.
  3. 횡단 관심사 (validation, exception filter, logger interceptor) 부재.
- 개선 권고:
  1. `ConfigModule` 사용으로 전환하거나 import 제거.
  2. `useGlobalPipes(new ValidationPipe(...))` 도입 검토.
  3. 글로벌 모듈을 명시 export 로 줄이는 리팩터.
- 재읽기 권고 레벨: 1.
