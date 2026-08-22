# 실제 Google Sheets DB 구조

[핸드오프로 돌아가기](../../handoff.md)

## 검증 기준

- **검증일**: 2026-08-22
- **검증 파일**: `주간보호 매점DB26.8.22.xlsx`
- **검증 방식**: 원본을 수정하지 않고 시트명, 실제 사용 범위, 1행 헤더를 읽어 코드와 대조
- **주의**: 아래 행 수는 검증 시점의 스냅샷이며 운영 중 계속 달라질 수 있습니다. 시트명과 열 순서를 구조 기준으로 사용합니다. `주문보관_자동백업_*` 시트는 보관 실행 시 생성되는 백업 스냅샷입니다.
- **신규 코드 계약**: `이용신청` 시트는 2026-07-20 `setupGuestApplicationSheet()` 및 실 운영 구글 시트 대조를 통해 22열(A:V) 헤더 생성 및 운영 검증을 완료했습니다.
- 실제 이용자·주문·카카오 값은 이 문서에 복사하지 않습니다.

## 시트 목록

| 순서 | 시트 | 검증 시 사용 범위 | 열 수 | 역할 |
| ---: | --- | --- | ---: | --- |
| 1 | `간식목록` | A1:I56 | 9 | 일반·게스트 간식, 재고, 노출 대상 |
| 2 | `이메일알림큐` | 배포 전 스냅샷 A1:J7 / P93 배포 후 A:L | 10 → 12 | 주문·이용신청 이메일 비동기 발송·재시도 상태 |
| 3 | `배송지별칭` | A1:D2 | 4 | 관리자가 등록한 배송지 별칭과 대표 표시명 |
| 4 | `이용신청` | A1:V1000 | 22 | 배달왔삼 사전 이용 신청과 승인·보관·대기자 상태 |
| 5 | `이용운영기록` | A1:I | 9 | P93 주차별 운영 대상·서비스 완료 이력 |
| 6 | `게스트크레딧` | A1:I85 | 9 | 일일 게스트 크레딧 지갑 |
| 7 | `게스트프로필` | A1:D9 | 4 | 저장 동의한 카카오 표시명·배송지 |
| 8 | `후기내역` | A1:L69 | 12 | 후기, 사진, 공개 상태, 관리자 답글, 수정 이력 |
| 9 | `운영설정` | A1:B32 | 2 | 배달왔삼 영업 상태와 운영 값 |
| 10 | `관리자로그` | A1:H1971 | 8 | 관리자 변경 이력 |
| 11 | `이용자목록` | A1:E13 | 5 | 일반 키오스크 이용자와 크레딧 |
| 12 | `주문내역` | A1:X313 | 24 | 현재 주문 원장과 커밋 상태 |
| 13 | `주문보관` | A1:W531 | 23 | 지난 주문 아카이브. `commitStatus`는 아직 없음 |
| 14 | `설정` | A1 | 1 | 현재 비어 있는 미사용 시트 |
| 15 | `주문보관_자동백업_20260711_100325` | A1:W492 | 23 | 주문보관 실행 시 생성된 자동 백업 스냅샷 |
| 16 | `주문보관_자동백업_20260720_171326` | A1:W492 | 23 | 주문보관 실행 시 생성된 자동 백업 스냅샷 |

## 실제 1행 헤더

### 이용자목록 A:E

`이용자ID`, `별명`, `크레딧`, `사용여부`, `사진url`

### 간식목록 A:I

`간식ID`, `이름`, `포인트`, `사진URL`, `판매여부`, `재고`, `표시순서`, `제공대상`, `범주`

`제공대상`의 운영 표준값은 소문자 `user` 또는 `guest`입니다. 데이터에 대소문자나 `Y/N` 표기가 섞일 수 있으므로 코드에서는 기존 정규화 동작을 유지합니다.

### 주문내역 A:X

| 열 | 헤더 | 의미 |
| --- | --- | --- |
| A | `주문시간` | 주문 생성 시각 |
| B | `주문번호` | `orderNo` |
| C | `이용자ID` | 일반 이용자 ID 또는 `guest` |
| D | `별명` | 화면 표시명 |
| E | `간식ID` | 간식 식별자 |
| F | `간식명` | 주문 시점 간식명 |
| G | `수량` | 주문 수량 |
| H | `차감포인트` | 행 단위 차감 포인트 |
| I | `제공여부` | 주문 상태 |
| J | `cancelTimestamp` | 취소 시각 |
| K | `orderToken` | 게스트 조회·취소 토큰 |
| L | `deliveryType` | `pickup` 또는 `delivery` |
| M | `deliveryFee` | 배달 비용 |
| N | `totalCredit` | 주문 전체 차감 크레딧 |
| O | `reviewed` | 후기 작성 여부 |
| P | `deliveryPlace` | 현재 운영 배송지 열 |
| Q | `cancelReason` | 취소 사유 |
| R | `cancelReasonDetail` | 취소 상세 |
| S | `guestDeviceId` | 게스트 기기 식별값 |
| T | `authProvider` | 인증 제공자 |
| U | `guestKey` | 해시된 카카오 게스트 식별값 |
| V | `deliveryAddress` | legacy 호환 열 |
| W | `idempotencyKey` | 동일 주문 요청 재전송 방지 키 |
| X | `commitStatus` | `PENDING`, `COMMITTED`, `FAILED`; 기존 공백은 `COMMITTED`로 취급 |

### 주문보관 A:W

`주문시간`, `주문번호`, `이용자ID`, `별명`, `간식ID`, `간식명`, `수량`, `차감포인트`, `제공여부`, `cancelTimestamp`, `orderToken`, `deliveryType`, `deliveryFee`, `totalCredit`, `reviewed`, `deliveryPlace`, `cancelReason`, `cancelReasonDetail`, `guestDeviceId`, `authProvider`, `guestKey`, `deliveryAddress`, `idempotencyKey`

현재 최신 DB의 `주문보관`은 `주문내역` X열의 `commitStatus`만 제외한 23열 구조입니다. 자동 백업 시트 2개도 같은 23열 구조입니다.

### 관리자로그 A:H

`timestamp`, `action`, `targetType`, `targetId`, `targetName`, `beforeValue`, `afterValue`, `memo`

### 운영설정 A:B

`key`, `value`

### 이메일알림큐 A:L (P93 배포 후)

배포 전 최신 DB 스냅샷은 A:J 구조였지만, P93의 `ensureOrderEmailQueueSheet()` 실행 후 기존 A:J 뒤에 K:L을 추가하여 12열로 확장합니다. 기존 주문 큐 행은 K:L이 비어 있어도 각각 `ORDER`와 주문번호로 호환 처리합니다.

`createdAt`, `orderNo`, `recipient`, `subject`, `body`, `status`, `attemptCount`, `nextAttemptAt`, `sentAt`, `lastError`, `notificationType`, `referenceId`

- `notificationType`: `ORDER` 또는 `GUEST_APPLICATION`
- `referenceId`: 주문번호 또는 신청번호. 같은 유형·참조 ID는 한 번만 큐에 등록합니다.
- `status`는 `PENDING`, `PROCESSING`, `SENT`, `FAILED` 중 하나이며 1분 트리거가 발송과 재시도를 처리합니다.
- 신청 알림 본문에는 신청번호·신청 시각·관계 유형·희망 요일만 포함하고 연락처·상세 배송지는 포함하지 않습니다.

### 이용운영기록 A:I (P93 추가)

P93 배포 후 `setupGuestApplicationOperationsSheet()` 실행으로 생성된 별도 운영 이력 시트입니다. 이용신청 개인정보는 복사하지 않고 신청번호만 저장합니다. 운영 기록 중복 정리 실행 시 이 구조를 그대로 복사한 `이용운영기록_자동백업_YYYYMMDD_HHmmss` 시트가 추가될 수 있습니다.

`operationId`, `applicationId`, `serviceWeek`, `status`, `selectedAt`, `completedAt`, `adminMemo`, `createdAt`, `updatedAt`

### 배송지별칭 A:D

`alias`, `canonicalPlace`, `enabled`, `updatedAt`

- 초기 시트는 헤더만 만들고 실제 배송지 별칭은 자동으로 추가하지 않습니다.
- 앞뒤 공백과 연속 공백 정리는 코드에서 처리하지만, 의미가 다른 장소는 관리자가 명시적으로 별칭을 등록해야 합니다.

### 후기내역 A:L

`createdAt`, `orderId`, `guestName`, `stamp`, `tags`, `comment`, `isPublic`, `imageUrl`, `replyText`, `replyCreatedAt`, `updatedAt`, `editCount`

- 주문자는 주문 토큰이 일치하는 후기만 작성 후 7일 동안 수정할 수 있습니다.
- 수정 시 `createdAt`과 직원 답글은 유지하고 `updatedAt`, `editCount`만 갱신합니다.

### 게스트프로필 A:D

`guestKey`, `displayName`, `deliveryPlace`, `updatedAt`

### 게스트크레딧 A:I

`periodKey`, `guestDeviceId`, `guestKey`, `baseCredit`, `bonusCredit`, `creditLimit`, `usedCredit`, `remainingCredit`, `updatedAt`

### 이용신청 A:V (신규 코드 계약, P21 이후 22열)

`createdAt`, `applicationId`, `requestId`, `name`, `relationType`, `relationDetail`, `phone`, `deliveryPlace`, `deliveryDetail`, `preferredDays`, `message`, `consentAt`, `status`, `contactedAt`, `reviewedAt`, `retentionUntil`, `anonymizedAt`, `adminMemo`, `waitlistPosition`, `skipUntil`, `cooldownUntil`, `updatedAt`

- 상태는 `PENDING`, `WAITLIST`, `APPROVED`, `REJECTED`, `INACTIVE`를 사용합니다. PENDING은 화면에서 '검토 중', WAITLIST는 '대기'로 표시합니다. 신규 신청은 모집 안내 인원과 관계없이 PENDING으로 저장하며 WAITLIST는 관리자가 직접 보류할 때만 사용합니다.
- `requestId`는 동일 신청 재전송 방지용이며 익명화할 때 삭제합니다.
- 반려·중지는 처리 후 30일의 `retentionUntil`을 기록하고 재승인 시 비웁니다.
- APPROVED는 자동 순환으로 변경되지 않습니다. 기존 시간 트리거가 남아 있어도 안전 종료하며, 주간 운영 대상은 `이용운영기록`에서 관리자가 운영 주차별로 직접 선택합니다.
- `waitlistPosition`은 WAITLIST 상태에서만 유효한 대기 순번입니다. 상태 변경 시 `reindexWaitlistPositions()`로 재계산합니다.
- `skipUntil`과 `cooldownUntil`은 기존 데이터·상세 호환을 위해 보존하지만 P95 수동 운영의 자동 승격·순환에는 사용하지 않습니다.
- 익명화 후에는 신청번호·상태·처리 시각만 남기고 이름·연락처·장소·관계·희망 요일·메시지·관리자 메모·대기순번·건너뛰기·쿨다운을 제거합니다.
- 이 시트의 개인정보를 주문내역·주방·전광판·빌지·후기·관리자로그로 복사하지 않습니다.

### 이용 신청용 운영설정 키

`guestApplicationOpen`, `guestApplicationTarget`, `guestApplicationOperatingDays`, `guestApplicationOrderTime`, `guestApplicationDeliveryTime`, `guestApplicationArea`, `guestApplicationUsage`, `guestApplicationDayOptions`, `guestApplicationCapacity`(주당 운영 안내 인원), `guestApplicationClosedMessage`, `guestApplicationCooldownWeeks`(기존 호환), `guestApplicationWaitlistLimit`(기존 호환)

- `guestApplicationCapacity`와 `guestApplicationWaitlistLimit`은 P95에서 신청·승인·주간 배정 제한으로 사용하지 않습니다.

`guestApplicationCapacity`는 기본 5이며 관리자 화면에서 1~100명 사이 정수로 조절합니다. 현재 활성 신청 수보다 낮춰도 기존 신청 행은 유지하고 신규 접수만 마감합니다.

`guestAllowRandomDisplayName`은 `TRUE` 또는 `FALSE`로 저장하며, 기존 키가 없는 운영 시트에서는 `TRUE`로 자동 추가합니다. `TRUE`일 때만 게스트 주문 화면의 랜덤 주문표시명 버튼을 표시합니다.

`운영설정`은 키가 추가되는 세로형 구조이므로 신규 키 반영 후 기존 A1:B15 사용 범위보다 행 수가 늘어납니다.

## 코드와 실제 헤더 차이

- 주문 API 응답과 현재 운영 DB는 배송지에 `deliveryPlace`를 사용합니다.
- `주문내역` V열의 `deliveryAddress`는 구버전 호환용으로 남아 있습니다. P열 `deliveryPlace`와 V열을 임의로 합치거나 이동하지 않습니다.
- `ensureOrderHeaders()`의 기본 헤더 배열과 새 `주문보관` 생성 코드는 16번째 열 이름을 `deliveryAddress`로 사용하지만, 실제 운영 `주문보관` P열은 `deliveryPlace`입니다.
- 현재 운영에서는 기존 `주문보관`에 위치 기준 A:R 18개 열을 추가하므로 데이터 열 정렬에는 문제가 없습니다. 다만 `주문보관` 시트가 없는 새 DB에서 코드가 시트를 자동 생성하면 P열 헤더명이 달라질 수 있습니다.
- 진단 코드는 `deliveryPlace`와 `deliveryAddress` alias를 허용합니다. 경고만 보고 물리 열을 재배열하지 않습니다.

## 주문 보관 정합성

- 최신 DB에서 `주문내역`은 A:X 24열, `주문보관`은 A:W 23열입니다.
- 두 시트의 A:W 열 순서와 의미는 일치하고, `주문보관`에는 X열 `commitStatus`가 없습니다.
- 최신 실제 구조에서는 `guestDeviceId`, `authProvider`, `guestKey`, `deliveryAddress`, `idempotencyKey`가 주문보관에도 보존되어 있습니다.
- `commitStatus`는 주문 처리의 현재 상태 열이므로 `주문내역` X열에 유지합니다. 기존 `주문보관` A:W는 안전한 앞부분 구조로 취급하며, P92 수정 후 보관 시에는 기존 보관 시트의 열 수와 헤더를 보존하고 이름 기준으로 값을 매핑합니다.
