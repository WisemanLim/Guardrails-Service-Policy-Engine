# src/health/health.controller.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md) · [↑ health_Abstract.md](./health_Abstract.md)

**파일 요약 / File Summary**
- 역할 / Role: `GET /health` 단일 엔드포인트. 룰 카운트 + DB 가용성 + 활성 도메인 노출.
- 진입점에서의 거리: 1 (AppModule.controllers 에 직접 등록 — 모듈 없이 루트에 배치)
- 라인 수: 18
- 주요 export: `HealthController`
- 의존 모듈 (internal): `../db/db.service`, `../policies/policies.service`
- 사용된 외부 패키지: `@nestjs/common`
- 부수효과: 없음 (메모리 상태 조회)
- 동시성 모델: 요청 단위, 짧은 응답
- 테스트 커버리지 흔적: 없음

---

```ts path=src/health/health.controller.ts lines=1-18
import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { PoliciesService } from '../policies/policies.service';

@Controller('health')
export class HealthController {
  constructor(private readonly policies: PoliciesService, private readonly db: DbService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      enabledDomains: this.policies.enabledDomains(),
      rulesLoaded: this.policies.ruleCount(),
      db: { driver: this.db.driver, available: this.db.isAvailable() },
    };
  }
}
```

**분석 / Analysis (Level 2)**

- **L1-3 imports**: 두 글로벌 service. `PoliciesService` 가 `PoliciesModule` 의 export 라 직접 주입 가능, `DbService` 는 `@Global` 모듈이라 자동.
- **L5 prefix**: `/health`. 컨테이너 healthcheck (Docker compose) / k8s liveness probe 에 사용.
- **L9 `@Get()`** 인자 없음 → `GET /health`.
- **L10-17 응답 객체**:
  - **`status:'ok'` 하드코딩**. 실제 헬스가 나쁘더라도 (예: DB unavailable, rulesLoaded=0) `'ok'` 가 반환됨 — **fail-open 위험**. 로드밸런서/k8s 가 잘못된 트래픽 라우팅 결정을 내릴 수 있다.
  - `enabledDomains` — `PoliciesService.enabledDomains()` 가 `process.env.GUARDRAILS_ENABLED_DOMAINS` 파싱 결과 반환. 부트 시 1회 계산된 후 immutable.
  - `rulesLoaded` — 인메모리 `Map<domain, Rule[]>` 카운트. 정상.
  - `db.available` — `DbService._available` 플래그. 부트 후 자동 갱신 없음 ([db.service.ts 리뷰](../db/db.service.ts.md) 참조).
  - Redis 상태는 누락 — `RedisService.connected` 도 노출 가능했으나 안 함.
- **L18 close**: 모듈 wrapping 없음. `AppModule.controllers` 에 직접 등록.

**짚어볼 점 / Watch-outs**

1. **`status:'ok'` 하드코딩** — DB unavailable / rulesLoaded=0 일 때도 OK 반환. liveness 와 readiness 분리 필요. **상위 우선순위 개선 권고**.
2. **Redis 가용성 누락** — 캐시 다운이 헬스에 반영 안 됨.
3. **에러 처리 부재** — 메서드가 sync 라 throw 가능성 거의 없지만 명시적 try/catch 없음.
4. **timestamp 없음** — `now` 필드가 있으면 캐싱 디버깅에 유용.
5. **응답 인증 부재** — `/health` 가 공개. 보통 의도된 선택이지만 시크릿 노출 가능성 확인 필요 (현재는 driver 이름 정도라 무해).

---

**파일 단위 판정**

- 강점:
  1. 의도 명확, 18 줄.
  2. 인메모리 상태 조회만 — IO 없음 → 빠른 응답.
- 위험:
  1. `status:'ok'` 하드코딩 — 실질 헬스 반영 안 됨.
  2. Redis 상태 누락.
- 개선 권고:
  1. `status` 를 `db.available && rulesLoaded>0 ? 'ok' : 'degraded'` 로 변경.
  2. Redis 가용성 추가.
  3. `now` 필드 추가.
- 재읽기 권고 레벨: 1.
