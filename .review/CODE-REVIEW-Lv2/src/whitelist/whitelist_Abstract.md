# `src/whitelist/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `whitelist.controller.ts` | `GET /whitelist` | 12 | [열기](./whitelist.controller.ts.md) |
| `whitelist.module.ts` | 모듈 등록 | 6 | [열기](./whitelist.module.ts.md) |
| `whitelist.service.ts` | DB row → API DTO 변환 | 28 | [열기](./whitelist.service.ts.md) |

## 디렉토리 구조 요약

화이트리스트 조회 전용. 컨트롤러 1개 + 단일 라우트. 서비스는 DB row 의 snake_case 를 camelCase 로 변환하는 패스스루. `DbService.listWhitelist` 가 driver-specific 직렬화 (JSON.parse, Number 캐스트) 를 모두 처리.

## 주요 의존 관계

- `DbService` (글로벌 주입).

## 위험 신호

- 인증 없음. 화이트리스트 패턴은 민감 데이터 가능성 — 운영에서 가드 검토.
- pagination 부재.
- 단위테스트 없음 (변환 로직이 단순해 위험은 낮음).
