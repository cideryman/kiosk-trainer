# 시스템 안정성 점검 안내

이 문서는 배달왔삼 전체 화면의 API 보안, 데이터 무결성, GAS 응답속도,
동시 주문, PWA 캐시를 안전하게 점검하는 절차입니다. 운영 환경에서는 읽기
검사만 실행하고, 주문·취소·재고·후기·신청 쓰기 검사는 복제한 staging에서만
실행합니다.

## 1. staging 준비

1. 운영 스프레드시트를 복사합니다. 바운드 Apps Script도 함께 복사되지만
   Script Properties는 새 프로젝트에 다시 설정해야 합니다.
2. 아래 시트는 1행 헤더만 남기고 2행부터 삭제합니다.
   - `이용자목록`
   - `주문내역`
   - `주문보관`
   - `후기내역`
   - `게스트프로필`
   - `게스트크레딧`
   - `이용신청`
   - `관리자로그`
3. `간식목록`과 `운영설정`도 운영 개인정보나 실제 알림 설정이 남지 않았는지
   확인합니다.
4. staging의 Script Properties를 설정합니다.
   - `APP_ENV=staging`
   - 운영과 다른 `ADMIN_TOKEN`
   - staging 전용 Kakao 관련 속성 또는 로그인 미사용 설정
5. staging 웹 앱을 별도 `/exec` URL로 배포합니다.
6. 관리자 진단에서 환경 `staging`, API 계약 버전, 주간 트리거, 캐시 상태를
   확인합니다. 주간 트리거가 복제 과정에서 생기지 않았다면 staging에서만
   별도로 등록합니다.

`full` 검사는 `diagnoseSystem`이 `staging`을 반환하고 API 계약 버전이 일치할
때만 시작됩니다. 테스트 도구가 이용자 ID `STAB_USER_01`부터
`STAB_USER_10`, 간식 ID `9901`부터 `9903`을 고정 fixture로 만들거나
재사용합니다.

## 2. 배포 순서

API 경계를 바꾸는 배포는 다음 순서를 지킵니다.

1. 운영 Script Properties에 `APP_ENV=production`을 설정합니다.
2. Script Properties에 `ALLOW_LEGACY_ADMIN_GET=Y`를 임시로 설정하고 새 GAS
   버전을 배포합니다. 구버전 관리자 탭이 잠시 계속 동작하는 호환 단계입니다.
3. 새 프런트엔드를 게시하고 `service-worker.js` 캐시 버전이 갱신됐는지
   확인합니다. 열려 있던 관리자·주방·인쇄 탭은 새로고침합니다.
4. `ALLOW_LEGACY_ADMIN_GET` 속성을 삭제하거나 `N`으로 바꿉니다. 이 단계는
   코드 재배포가 필요하지 않습니다. 관리자 진단에서 `관리자 공개 조회: 차단됨`을
   확인합니다.

호환 스위치는 장기간 켜 두지 않습니다. 켜져 있으면 `diagnoseSystem`이 WARN을
반환하고 보안 검사는 실패합니다.

## 3. 실행 명령

PowerShell에서 현재 창에만 환경변수를 설정합니다. 토큰과 URL은 결과 파일에
저장되지 않습니다.

```powershell
$env:KIOSK_API_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
$env:KIOSK_ADMIN_TOKEN='별도 관리자 토큰'
```

운영 읽기 점검:

```powershell
$env:KIOSK_STABILITY_MODE='read'
node scripts/stability-check.js
```

운영 핵심 읽기 API 동시 10건 점검:

```powershell
$env:KIOSK_STABILITY_MODE='read'
$env:KIOSK_CONCURRENCY='10'
$env:KIOSK_BURST='1'
node scripts/stability-check.js
```

운영 24시간 관찰(4시간 간격 6회):

```powershell
$env:KIOSK_STABILITY_MODE='read'
$env:KIOSK_BURST='0'
$env:KIOSK_OBSERVE_HOURS='24'
$env:KIOSK_OBSERVE_INTERVAL_MINUTES='240'
node scripts/stability-check.js
```

staging 전체 쓰기·동시성 점검:

```powershell
$env:KIOSK_STABILITY_MODE='full'
$env:KIOSK_CONCURRENCY='10'
$env:KIOSK_BURST='0'
$env:KIOSK_OBSERVE_HOURS='0'
node scripts/stability-check.js
```

각 실행의 원본 JSON은 `tmp/stability-results/`에 저장되고 Git에서 제외됩니다.
확정 결과만 날짜를 붙인 Markdown 보고서로 요약해 `docs/reports/`에 남깁니다.

## 4. 자동 검사 범위

- 공개 API의 비활성 이용자·숨김 간식 미노출
- 공개 주문 피드의 필드 허용 목록과 개인정보 미포함
- 무토큰 관리자 GET·POST 거부
- 인증된 관리자·주방·인쇄 조회
- API 계약 버전 일치
- 동일 idempotency key 동시 10회 요청의 단일 주문 처리
- 일반 동시 주문 10건과 잠금 실패 시 단일 안전 재시도
- 재고 5개에 대한 동시 10건 주문과 음수 재고 방지
- 취소·중복 취소 시 재고와 온기 복원
- 게스트 주문 토큰 조회, 후기 중복 방지, 공개 후기·답글 캐시 반영
- 이용신청 requestId 중복 방지

테스트용 행은 staging에 남겨 후속 비교에 재사용할 수 있습니다. 새로 깨끗한
환경이 필요할 때만 staging 시트의 테스트 행을 삭제합니다.

## 5. 수동 검사

자동 검사 후 아래 항목은 사람이 확인합니다.

- 카카오 로그인 1회와 주문 조회
- staging에서 주간 순환 수동 실행: 승인 복귀, 대기 승격, 건너뛰기, 쿨다운
- 후기 사진 라벨 개인정보 안내 문구
- 키오스크, 관리자, 주방, 배달왔삼, 신청, 후기, 호출판, 인쇄 화면
- 데스크톱, 390px, 320px에서 레이아웃과 무한 로딩 여부
- 새 캐시 설치, 기존 열린 탭 갱신, 오프라인 정적 화면, API 실패 상태

정적 검사는 배포 전 실행합니다.

```powershell
node check_syntax.js
node scripts/check-handoff.js
git diff --check
```

## 6. 합격 기준과 복귀

- 재시도 후 최종 성공률 100%
- 최초 성공률 95% 이상, 재시도율 5% 이하
- 웜 p95 10초 이하, 콜드 응답 30초 이하
- 중복 주문, 음수 재고, 온기 불일치, 개인정보 노출, API 버전 불일치 0건

실패는 `즉시 수정`, `관찰 필요`, `구조 개선`으로 분류합니다. 즉시 수정 항목이
발생하면 이전 GAS 배포 버전과 이전 프런트 커밋으로 복귀하고 원인을 분리합니다.
보고서에는 p50, p95, 최대시간, 최초 성공률, 재시도율, 화면별 체감 로딩을
기록합니다.

## 7. 금지 사항

- 운영 URL에서 `KIOSK_STABILITY_MODE=full`을 실행하지 않습니다.
- 운영 URL에서 주문·취소·재고·후기·신청 부하 테스트를 실행하지 않습니다.
- `ADMIN_TOKEN`을 URL, 문서, Git, 스크린샷에 남기지 않습니다.
- staging 결과를 운영 안정성 합격 결과로 대신하지 않습니다.
