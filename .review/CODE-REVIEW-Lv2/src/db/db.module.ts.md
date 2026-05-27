# src/db/db.module.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ db_Abstract.md](./db_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: NestJS `@Global` 모듈. `DbService` provider 를 전역으로 노출.
- 진입점에서의 거리: 2 (main.ts → AppModule → DbModule)
- 라인 수: 9
- 주요 export: `DbModule`
- 의존 모듈 (internal): `./db.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음 (선언적)
- 동시성 모델: 해당 없음
- 테스트 커버리지 흔적: 없음

---

```ts path=src/db/db.module.ts lines=1-9
import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
```

**분석 / Analysis (Level 2)**

- **L1 import**: `Global` 데코레이터를 함께 가져온다. NestJS 의 글로벌 모듈은 한 번 import 된 모듈에서 export 한 provider 를 다른 모듈에서 import 없이 주입 가능하게 한다. 본 레포에서는 `policies.service.ts`, `domains.controller.ts`, `whitelist.service.ts`, `health.controller.ts` 4곳이 `DbService` 를 import 없이 주입.
- **L4 `@Global()`**: 글로벌 노출. 장점은 보일러플레이트 감소. 단점은 IDE 의 "Find Usages" 가 import 경로를 통한 추적을 더 어렵게 만들고, 테스트에서 mock 주입 시 `Test.createTestingModule` 의 providers 배열 명시가 필요.
- **L5-8 `@Module`**:
  - `providers: [DbService]` — DI 컨테이너가 싱글톤으로 생성.
  - `exports: [DbService]` — 글로벌 모듈이지만 explicit export 를 명시. NestJS 는 `@Global()` 이어도 `exports` 가 없으면 외부에서 주입 불가하므로 필수 보일러.
- **L9 `export class DbModule {}`**: 비어 있는 클래스 본체 — NestJS 의 데코레이터 메타데이터만 사용.

**짚어볼 점 / Watch-outs**

- `DbModule` 과 `CacheModule` 둘 다 글로벌. 본 레포 규모(≈1k LOC)에서는 합리적이나, 모듈 수가 늘어나면 explicit import 가 안전.
- `DbService` 의 lifecycle (`OnModuleInit`/`OnModuleDestroy`) 는 글로벌 모듈에서도 정상 동작 — DI 컨테이너가 모듈 트리 구축 후 초기화 페이즈에서 호출.

---

**파일 단위 판정**

- 강점:
  1. 9줄로 의도 명확.
  2. provider 와 export 분리 명시 — 글로벌이어도 export 누락 안 함.
- 위험:
  1. 글로벌 모듈 — `DbService` 주입 위치 추적이 import 경로로는 불가능.
  2. 모듈 단위 인터페이스(추상) 부재 — 직접 클래스 주입이라 mocking 시 `useValue` 필요.
- 개선 권고:
  1. 컴포넌트 확장 시 `IDatabase` 인터페이스 추상화 검토.
  2. 글로벌 해제 가능성 검토 (현재는 4개 사용처 모두 다른 모듈 — explicit import 4번이 더 명료).
- 재읽기 권고 레벨: 1.
