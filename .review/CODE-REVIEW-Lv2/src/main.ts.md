# src/main.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../INDEX.md)

**파일 요약 / File Summary**
- 역할 / Role: NestJS 애플리케이션 부트스트랩. 8082 포트로 HTTP 서버 기동.
- 진입점에서의 거리: 0 (자체가 진입점)
- 라인 수: 12
- 주요 export: `bootstrap()` (호출 후 즉시 await 없이 종료, top-level 호출)
- 의존 모듈 (internal): `./app.module`
- 사용된 외부 패키지: `@nestjs/core`, `@nestjs/common`
- 부수효과: `app.listen()` (HTTP 바인딩), `enableShutdownHooks` 등록
- 동시성 모델: 단일 이벤트 루프. `bootstrap()` 자체가 비동기.
- 테스트 커버리지 흔적: 없음

---

```ts path=src/main.ts lines=1-12
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 8082);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Policy Engine listening on :${port}`);
}
bootstrap();
```

**분석 / Analysis (Level 2)**

- **L1-3 imports**: 의존성을 명시적 named import로만 가져옴. `Logger`를 `@nestjs/common`에서 가져온 점에 주목 — NestJS는 자체 Logger를 가지며, `console.log` 대신 컨텍스트 라벨이 붙는 출력을 권장한다.
- **L5 `async function bootstrap()`**: 부트스트랩 보일러플레이트의 관용. 모듈 톱레벨 await 대신 함수로 감싸는 이유는 ES2017 호환과 Nest CLI의 검출 규칙(`nest start`가 `bootstrap` 심볼을 인식) 때문.
- **L6 `NestFactory.create(AppModule, { bufferLogs: false })`**:
  - `bufferLogs: false` 의 의미: 부트 단계 로그가 즉시 출력 → 부트 실패 디버깅이 쉬워짐. 반대로 `true`면 logger 인스턴스 교체 전까지 메모리에 쌓아두고 일괄 flush. 운영 환경에서 시작 직후 컴포넌트가 실패하면 로그가 유실될 위험이 있으므로 본 코드의 선택이 안전.
  - 흔한 실수: NestJS 부트시 `process.exit(1)` 핸들러를 두지 않아, AppModule init 실패가 빈 스택만 남기고 컨테이너가 재시작 루프에 빠지는 경우가 있음. 본 파일은 그 핸들러를 두지 않았다.
- **L7 `app.enableShutdownHooks()`**: SIGTERM/SIGINT 시 `OnModuleDestroy`/`OnApplicationShutdown` 훅을 트리거하는 데 필요. 본 레포의 `RedisService.onModuleDestroy` ([cache/redis.service.ts:52](../src/cache/redis.service.ts.md))와 `DbService.onModuleDestroy` ([db/db.service.ts:302](../src/db/db.service.ts.md))가 이 훅에 의존하므로 반드시 필요한 한 줄. 이걸 빼면 K8s 롤링 업데이트 시 풀 연결이 정리되지 않아 좀비 커넥션이 남는다.
- **L8 `Number(process.env.PORT ?? 8082)`**: 환경변수가 비어 있으면 8082. `Number('')` 은 `0`을 반환하지만 `??` 이 빈 문자열도 통과시키므로(`??` 은 `null`/`undefined`만 fallback) 빈 문자열 `PORT=""` 가 들어오면 포트 0(임의 포트 바인딩)이 된다. 흔한 실수.
- **L9 `app.listen(port, '0.0.0.0')`**: 모든 인터페이스 바인딩. 컨테이너 환경에서는 필수(기본 `localhost`는 컨테이너 외부에서 접근 불가). `127.0.0.1`로 바인딩되면 헬스체크가 실패하는 클래식 함정.
- **L10 `new Logger('Bootstrap').log(...)`**: Nest Logger를 일회용으로 생성. 정상이지만 `private static logger` 패턴이 더 명시적.
- **L12 `bootstrap();`**: 톱레벨에서 promise를 await/catch 하지 않음. `bootstrap()` 내부에서 throw가 발생하면 unhandled rejection 으로 흘러 Node 의 기본 종료 핸들러에 의존. Node 15+에서는 비정상 종료가 기본이지만, 부트 실패의 원인이 stderr에만 남고 exit code가 명확하지 않은 경우가 있다.

**짚어볼 점 / Watch-outs**

- 빈 문자열 `PORT=""` 또는 `PORT="0"` 시 임의 포트 바인딩 → 외부 도커 매핑이 깨질 수 있음.
- 글로벌 `ValidationPipe` 미설치. 모든 컨트롤러가 raw query/body 를 신뢰 ([policies.controller.ts:9-22](./policies/policies.controller.ts.md)).
- CORS 미설정. MCP Server가 같은 인트라넷에 있으면 문제 없지만, Admin 웹과 직통이면 추가 필요.
- `bootstrap().catch((e) => { logger.error(e); process.exit(1); })` 패턴 권장.

---

**파일 단위 판정**

- 강점:
  1. 셧다운 훅 명시 호출 — 풀 정리 보장.
  2. 부트 로그 즉시 flush (`bufferLogs:false`) — 디버깅 친화.
  3. `'0.0.0.0'` 명시 바인딩 — 컨테이너 정상 동작 보장.
- 위험:
  1. unhandled rejection 처리 부재 — 부트 실패가 silent.
  2. `PORT=""` 같은 빈 문자열 경계.
  3. 글로벌 미들웨어/파이프 미설정 — 입력 검증을 컨트롤러가 알아서 해야 함.
- 개선 권고 (impact 순):
  1. `bootstrap().catch(...)` 추가 + 명시적 exit code.
  2. `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` 검토.
  3. `Number()` → `parseInt(.., 10) || 8082` 또는 zod 기반 env 검증.
- 재읽기 권고 레벨: 1. 짧고 표준적이며 코드 변경 빈도가 낮다.
