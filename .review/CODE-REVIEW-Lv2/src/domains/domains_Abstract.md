# `src/domains/` — 디렉토리 요약

> 리뷰 레벨: 2
> [← INDEX.md](../../INDEX.md)

## 파일 목록

| 파일 | 역할 | LOC | 리뷰 |
|---|---|---:|---|
| `domains.controller.ts` | `/domains` 3개 엔드포인트 (list / chain / chain-multi) | 27 | [열기](./domains.controller.ts.md) |
| `domains.module.ts` | 모듈 등록 | 5 | [열기](./domains.module.ts.md) |

## 디렉토리 구조 요약

도메인 메타정보 조회 전용 모듈. `DbService` 의 `listDomains()` 결과를 그대로 노출하고, `policies/domain-resolver` 의 stateless 함수를 그대로 wrap 한다. 자체 서비스 계층 없음 — 컨트롤러가 직접 의존성을 호출.

## 주요 의존 관계

- `DbService` (글로벌, 주입).
- `policies/domain-resolver` (다른 모듈 함수 직접 import — 계층 위반).

## 위험 신호

- 응답 스키마 불일치: fallback 의 `domainKey` (camel) vs DB row 의 `domain_key` (snake).
- `@Param` 입력 검증 부재 — 정규식 패턴 미정의.
- 컨트롤러가 `policies/` 의 내부 함수를 직접 import → 모듈 경계 흐림.
