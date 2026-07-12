# Google Apps Script Backend

GAS 백엔드 소스는 유지보수성을 위해 [`gas/`](./gas) 아래의 기능별 `.gs` 파일로 분리되어 있습니다.

## GAS 편집기에 반영하는 방법

1. Apps Script 프로젝트 안에 `gas/`의 파일명과 같은 스크립트 파일을 만듭니다.
2. 각 `.gs` 파일의 내용을 해당 파일에 복사합니다.
3. 모든 파일이 같은 Apps Script 프로젝트에 들어 있는지 확인합니다.
4. `node check_syntax.js`를 실행해 결합 구문 검사를 통과시킵니다.
5. 새 버전을 배포하고 운영 기능을 수동 검증합니다.

배달왔삼 이용 신청 기능을 처음 반영할 때는 운영 DB 백업 후 GAS 편집기에서 `setupGuestApplicationSheet()`를 한 번 실행합니다. 생성된 `이용신청` 시트의 A:S 19열 헤더를 확인한 뒤 신청 설정을 기본 `마감` 상태로 두고 새 버전을 배포합니다.

## 카카오 설정

- 기존 Apps Script 프로젝트에서 파일만 나눈 경우 Script Properties는 그대로 유지됩니다.
- 새 Apps Script 프로젝트를 만든 경우 GAS 편집기의 `00_Setup.gs`에 `setKakaoPropertiesOnce()`를 임시로 추가하고 한 번 실행합니다.
- `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_GUEST_KEY_SALT`, `ADMIN_TOKEN` 같은 비밀값은 로컬 파일이나 GitHub에 저장하지 않습니다.
- 설정이 끝난 뒤 일회성 함수의 비밀값을 지우거나 함수 자체를 삭제해도 저장된 Script Properties는 유지됩니다.

## 파일 책임

| 파일 | 책임 |
| --- | --- |
| `00_Config.gs` | 시트명, 폴더 ID, 공통 상수, 관리자 인증 |
| `00_Setup.gs` | GAS 편집기에서만 사용하는 일회성 설정 안내 |
| `01_Router.gs` | `doGet`, `doPost`, JSON 응답 |
| `10_KakaoGuests.gs` | 카카오 인증과 게스트 프로필 |
| `11_AdminLog.gs` | 관리자 변경 로그 |
| `12_GuestApplications.gs` | 배달왔삼 이용 신청, 관리자 처리, 신청 설정, 개인정보 익명화 |
| `20_Users.gs` | 이용자 조회·등록·수정·크레딧 |
| `21_Snacks.gs` | 간식 조회·등록·재고·판매상태·캐시 |
| `30_GuestCredits.gs` | 게스트 크레딧 지갑 |
| `31_OrderShared.gs` | 주문 헤더와 멱등성 공통 처리 |
| `40_Orders.gs` | 주문 생성·조회·취소·제공·보관 |
| `50_Media.gs` | 이미지 URL 변환과 업로드 |
| `60_Settings.gs` | 게스트 운영 설정과 설정 캐시 |
| `70_Reviews.gs` | 후기 등록·조회·답글·공개 상태 |
| `90_Diagnostics.gs` | 시스템 운영 진단 |

파일을 나누어도 같은 Apps Script 프로젝트 안에서는 함수들이 함께 동작합니다. 이번 분리는 로직이나 성능을 변경하지 않고 코드 탐색과 변경 범위를 명확하게 하기 위한 작업입니다.
