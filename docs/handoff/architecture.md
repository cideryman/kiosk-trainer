# 프로젝트 구조와 운영 방식

[핸드오프로 돌아가기](../../handoff.md)

## 프로젝트 목적

발달장애인 주간보호센터 이용자가 별명과 크레딧으로 간식을 주문하고, 주문·준비·배달·수령 과정을 훈련할 수 있도록 만든 PWA 키오스크 및 배달왔삼 시스템입니다. 큰 터치 영역, TTS, 효과음, 진동, 직관적인 크레딧 표시를 핵심 UX로 유지합니다.

## 기술 구성

- **프론트엔드**: HTML5, Vanilla CSS, Vanilla JavaScript
- **백엔드/서버 실행 환경**: Google Apps Script 웹앱
- **DB**: Google Sheets
- **인증 연동**: 선택형 카카오 로그인, GAS Script Properties에 비밀값 저장
- **PWA**: 화면별 Manifest와 `service-worker.js` 정적 캐시
- **로컬 테스트**: `js/config.js`의 `USE_MOCK = true`로 로컬 스토리지 기반 Mock 사용

## 화면별 책임

- `index.html`, `menu.html`, `confirm.html`, `complete.html`: 일반 키오스크와 공통 주문 흐름
- `guest.html`, `guest-orders.html`: 배달왔삼 진입, 카카오 선택 로그인, 게스트 주문 조회
- `menu.html?browse=guest`: 영업 종료 중 게스트 간식 읽기 전용 보기
- `kitchen.html`: 실시간 주문 처리, 운영 결과, 인쇄, 주문 보관, 게스트 영업 제어
- `board.html`: 대기·준비완료 전광판과 TTS 호출
- `admin.html`: 이용자·간식·크레딧·표시 순서 관리
- `reviews.html`: 후기 확인, 공개 상태, 관리자 대리 답글
- `print-bills.html`: 일반 빌지와 애니라벨 V3050 라벨지, 배달 체크리스트 인쇄

## API 흐름

- 조회는 `GET` 요청의 `action` 파라미터를 사용합니다.
- 변경은 `POST` 요청을 사용하며 GAS/CORS 호환성을 위해 `text/plain` JSON 바디에 `action`을 포함합니다.
- 주문·취소·상태 변경 같은 쓰기 경로는 필요한 범위에서 `LockService`를 사용합니다.
- 클라이언트 변경 요청이 성공하면 관련 로컬 API 캐시를 무효화합니다.

## 캐시와 폴링

- `getUsers`: 클라이언트 2분 캐시
- `getSnacks`: GAS Script Cache 15초, 주문·취소·관리자 간식 변경 시 무효화
- `getGuestSettings`: GAS Script Cache 30초, 설정 변경 시 무효화
- 주문 읽기: GAS Script Cache 2초, 주문 변경 시 무효화
- 전광판: 이전 요청 완료 후 10초 뒤 다음 요청
- 주문 상태 추적: 이전 요청 완료 후 5초 뒤 다음 요청, 완료·취소 시 종료
- 주방: 이전 요청 완료 후 30초 뒤 다음 요청, 편집·모달 중 일시정지
- 공통 API 타임아웃: 20초

표시용 간식 캐시는 일시적으로 오래된 재고를 보여줄 수 있지만, 최종 `placeOrder()`는 원본 시트를 다시 읽어 재고·판매상태·크레딧을 검증합니다.

## GAS 파일 구조

| 파일 | 책임 |
| --- | --- |
| `00_Config.gs` | 시트명, 공통 상수, 관리자 인증 |
| `00_Setup.gs` | GAS 편집기에서만 사용하는 일회성 설정 안내 |
| `01_Router.gs` | `doGet`, `doPost`, JSON 응답 |
| `10_KakaoGuests.gs` | 카카오 인증과 게스트 프로필 |
| `11_AdminLog.gs` | 관리자 변경 로그 |
| `20_Users.gs` | 이용자 조회·등록·수정·크레딧 |
| `21_Snacks.gs` | 간식 조회·등록·재고·판매상태·캐시 |
| `30_GuestCredits.gs` | 게스트 크레딧 지갑 |
| `31_OrderShared.gs` | 주문 공통 처리와 멱등성 |
| `40_Orders.gs` | 주문 생성·조회·취소·제공·보관 |
| `50_Media.gs` | 이미지 URL 변환과 업로드 |
| `60_Settings.gs` | 게스트 운영 설정과 설정 캐시 |
| `70_Reviews.gs` | 후기 등록·조회·답글·공개 상태 |
| `90_Diagnostics.gs` | 시스템 운영 진단 |

앞의 숫자는 GAS 실행 순서를 강제하지 않습니다. 편집기와 저장소에서 역할별로 정렬하기 위한 분류 번호입니다. `00~01`은 전역 설정과 라우터, `10~11`은 인증·운영 기반, `20~21`은 기본 데이터, `30~31`은 주문 기반, `40`은 주문 핵심, `50~70`은 부가 기능, `90`은 진단입니다. 번호 간격은 `32_Cache.gs`, `41_OrderStats.gs`처럼 관련 영역에 파일을 추가할 여지를 둡니다.

## 배포와 비밀값

- 모든 `.gs` 파일은 하나의 Apps Script 프로젝트에 복사합니다.
- `node check_syntax.js`로 결합 구문을 검사한 뒤 GAS 새 버전을 배포합니다.
- 기존 GAS 프로젝트에서 파일만 나눈 경우 Script Properties와 카카오 설정은 유지됩니다.
- 새 GAS 프로젝트에서만 `setKakaoPropertiesOnce()`를 GAS 편집기의 `00_Setup.gs`에 임시로 넣어 실행합니다.
- `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_GUEST_KEY_SALT`, `ADMIN_TOKEN`은 로컬 파일이나 GitHub에 저장하지 않습니다.
- 정적 파일 변경 시 `service-worker.js` 캐시 버전 상향 여부를 반드시 확인합니다.
