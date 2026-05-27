# src/cache/redis.service.ts — 코드 리뷰

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

**파일 요약 / File Summary**
- 역할 / Role: ioredis 래퍼. lazyConnect + fail-open으로 Redis 부재 시 캐시-less 모드 동작.
- 진입점에서의 거리: 2
- 라인 수: 55
- 주요 export: `RedisService` (NestJS Injectable)
- 의존 모듈 (internal): 없음
- 사용된 외부 패키지: `ioredis`, `@nestjs/common`
- 부수효과: TCP 연결, 외부 호출 (`get/set/del`)
- 동시성 모델: ioredis 단일 클라이언트, 큐 비활성 (`enableOfflineQueue:false`).
- 테스트 커버리지 흔적: 없음

---

## Chunk A — 생성자 / lifecycle

```ts path=src/cache/redis.service.ts lines=1-27
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private readonly client: Redis;
  private connected = false;

  constructor() {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    this.client.connect().then(
      () => {
        this.connected = true;
        this.log.log(`Redis connected ${host}:${port}`);
      },
      (err) => this.log.warn(`Redis not connected: ${err.message} — running cache-less.`),
    );
  }
```

**분석 / Analysis (Level 2)**

- **L5 `implements OnModuleDestroy`**: 셧다운 훅에 등록될 수 있는 인터페이스. `main.ts:7 enableShutdownHooks()` 와 연결된다.
- **L6 `new Logger(RedisService.name)`**: `RedisService.name`은 minify 후에도 클래스명 토큰을 보존하기 위해 일반적인 NestJS 관용 (TypeScript는 클래스명을 그대로 두므로 안전).
- **L8 `private connected = false`**: **동기 가시성 플래그**. 모든 IO 메서드의 게이트. `private readonly` 가 아닌 일반 `private` 인 이유는 생성자 콜백 안에서 mutate 되기 때문.
- **L10 `constructor()`**:
  - L11-12 `process.env` 직접 읽기 — INDEX.md §4.1 패턴 B. `ConfigService` 가 있음에도 사용 안 함.
  - `Number('')` 은 `0` 이지만 `??` 가 빈 문자열을 통과시키므로 `REDIS_PORT=""` 시 포트가 0이 된다 (같은 함정이 `main.ts:8` 과 `db.service.ts:46`, `db.service.ts:76` 에서도 반복).
- **L13-19 `new Redis({...})`**:
  - `lazyConnect: true`: `connect()`를 명시 호출하기 전까지 TCP 연결 시도 안 함.
  - `maxRetriesPerRequest: 2`: 명령 1건당 최대 2회 재시도. 기본 20이므로 보수적 설정.
  - `enableOfflineQueue: false`: 연결이 끊긴 동안 명령을 큐잉하지 않고 즉시 실패. 본 서비스의 fail-open 의도와 정합.
- **L20-26 `client.connect().then(...)`**: 핵심. **fire-and-forget**.
  - 성공 시 `connected=true` 설정.
  - 실패 시 `warn` 로깅 후 무시 — 서비스는 캐시-less로 계속 동작.
  - **흔한 실수 / 위험**: NestJS DI는 생성자가 동기 완료되면 모듈을 준비됐다고 본다. 따라서 부팅 직후 들어온 첫 요청은 `connected=false` 상태에서 `get/set`이 no-op이 되어 캐시 미스 (정확히는 캐시 미스조차 아닌 "캐시-less"). 부하 직후 0~100ms 의 윈도우에서 비효율. 운영에서 큰 문제는 아니지만, `OnModuleInit` 에서 `await connect()` 로 옮기는 편이 결정적이다.

---

## Chunk B — 공개 API

```ts path=src/cache/redis.service.ts lines=29-51
  isConnected(): boolean {
    return this.connected;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) return null;
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSec = 300): Promise<void> {
    if (!this.connected) return;
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }

  async del(prefix: string): Promise<void> {
    if (!this.connected) return;
    const stream = this.client.scanStream({ match: `${prefix}*`, count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.client.del(...(keys as string[]));
    }
  }
```

**분석 / Analysis (Level 2)**

- **L33 `get<T>(...)`**: 제네릭 캐스팅 패턴. zod/타입가드 없이 `as T` 캐스팅 — 캐시에서 읽은 데이터가 손상되어도 컴파일러는 안다고 가정. `policies.service.ts:168` 의 `get<CompiledBundle>` 호출에서 캐시에 다른 모양의 데이터가 들어 있다면 런타임에 silently 잘못된 응답이 나간다.
- **L34 `if (!this.connected) return null;`**: 캐시 미스와 동일하게 처리 — fail-open. 호출자(`PoliciesService.getBundle`)는 자연스럽게 fresh 계산으로 폴백.
- **L35 `JSON.parse(raw)`**: 손상된 JSON에서 throw 발생 가능 — try/catch 없음. 호출자에 전파됨. 한 키가 손상되면 해당 요청이 500을 내며, 같은 키가 캐시되어 있는 한 영구 실패. 흔한 실수.
- **L39 `set(..., ttlSec = 300)`**: 5분 TTL 기본값. 호출처(`policies.service.ts:171`)에서 300을 명시적으로 다시 전달하므로 인자 기본값은 사실상 데드코드. 단, API 일관성 면에서 보존 정당화 가능.
- **L40 `if (!this.connected) return;`**: 무음 폐기 — fail-open의 합리적 표현.
- **L41 `this.client.set(key, JSON.stringify(value), 'EX', ttlSec)`**: ioredis의 가변 인자 시그니처. `'EX'` (초 단위 TTL) 대신 `'PX'` (밀리초)도 가능. 본 코드는 초 단위로 일관성 있음.
- **L44 `del(prefix: string)`**: **이름이 오해 소지**. 실제로는 prefix-match scan + 다건 삭제. `del('bundle:')` 호출이 `bundle:*` 키 전체를 지운다. 함수명이 `delByPrefix` 였으면 더 명료.
- **L46 `scanStream({ match: `${prefix}*`, count: 100 })`**: 운영 시 권장되는 패턴 (KEYS 명령은 차단성). `count: 100` 은 힌트일 뿐 — 실제 키 개수는 다를 수 있다 (ioredis docs). 본 서비스의 카디널리티가 작아 큰 문제 아님.
- **L47-49 `for await ... await del(...)`**: 직렬 처리. 백프레셔 OK. 단, 한 청크에 키가 0개면 `del()` 가변 인자 호출이 에러나므로 `if ((keys as string[]).length)` 가드는 필수.
  - **보안 관점**: prefix 가 사용자 입력이면 wildcard injection 가능 (`prefix = "*"` → 전체 삭제). 본 코드는 내부 호출(`policies.service.ts:180 redis.del('bundle:')`)뿐이라 안전.

---

## Chunk C — 셧다운

```ts path=src/cache/redis.service.ts lines=52-55
  async onModuleDestroy() {
    if (this.connected) await this.client.quit();
  }
}
```

**분석 / Analysis (Level 2)**

- **L52 `onModuleDestroy()`**: `enableShutdownHooks()` 와 짝.
- **L53 `quit()`**: graceful 종료 (`QUIT` 명령 후 소켓 닫음). `disconnect()` 는 즉시 끊지만 보류 명령을 잃을 수 있다 — `quit()` 선택이 안전.
- 흔한 실수: connected=false 상태에서 `quit()` 호출 시 `Error: Connection is closed` 가 던져진다. 본 코드는 가드로 회피.

**짚어볼 점 / Watch-outs**

- `JSON.parse` try/catch 없음 → 손상 페이로드 발생 시 호출 체인이 500.
- 생성자의 fire-and-forget connect → 부팅 직후 첫 요청 캐시 미사용.
- `del(prefix)` 이름 오해 — 시그니처가 prefix match.
- 빈 문자열 env (`REDIS_PORT=""`) 시 포트 0.

---

**파일 단위 판정**

- 강점:
  1. fail-open 설계 — Redis 부재 시 서비스가 계속 동작.
  2. `lazyConnect`+`enableOfflineQueue:false` — 의도와 정합한 동작.
  3. 셧다운 훅 구현.
- 위험:
  1. `JSON.parse` 미보호 (손상 데이터 → 500).
  2. 생성자 fire-and-forget — 부팅 직후 캐시-less 윈도우.
  3. `connected` 플래그가 disconnect 이벤트를 반영 안 함 (이후 연결 끊기면 여전히 `true`).
- 개선 권고:
  1. `client.on('error')`, `client.on('end')` 핸들러 추가하여 `connected` 동기화.
  2. `get()` 내 `JSON.parse` try/catch + `del(key)` 후 폴백.
  3. `connect()` 를 `onModuleInit()` 으로 이동하고 `await` (실패 시 warn 후 계속).
- 재읽기 권고 레벨: 2. 동시성/에러 경로가 미묘하므로 변경 시 주의.
