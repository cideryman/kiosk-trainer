# 실제 Google Sheets DB 구조

[핸드오프로 돌아가기](../../handoff.md)

## 검증 기준

- **검증일**: 2026-07-10
- **검증 파일**: `주간보호 매점DB (2).xlsx`
- **검증 방식**: 원본을 수정하지 않고 시트명, 실제 사용 범위, 1행 헤더를 읽어 코드와 대조
- **주의**: 아래 행 수는 검증 시점의 스냅샷이며 운영 중 계속 달라질 수 있습니다. 시트명과 열 순서를 구조 기준으로 사용합니다.
- **신규 코드 계약**: `이용신청` 시트는 2026-07-20 `setupGuestApplicationSheet()` 및 실 운영 구글 시트 대조를 통해 22열(A:V) 헤더 생성 및 운영 검증을 완료했습니다.
- 실제 이용자·주문·카카오 값은 이 문서에 복사하지 않습니다.

## 시트 목록

| 순서 | 시트 | 검증 시 사용 범위 | 열 수 | 역할 |
| ---: | --- | --- | ---: | --- |
| 1 | `간식목록` | A1:I48 | 9 | 일반·게스트 간식, 재고, 노출 대상 |
| 2 | `게스트크레딧` | A1:I33 | 9 | 일일 게스트 크레딧 지갑 |
| 3 | `게스트프로필` | A1:D5 | 4 | 저장 동의한 카카오 표시명·배송지 |
| 4 | `주문보관` | A1:R180 | 18 | 지난 주문 아카이브 |
| 5 | `후기내역` | A1:J48 | 10 | 후기, 사진, 공개 상태, 관리자 답글 |
| 6 | `운영설정` | A1:B15 | 2 | 배달왔삼 영업 상태와 운영 값 |
| 7 | `관리자로그` | A1:H1284 | 8 | 관리자 변경 이력 |
| 8 | `이용자목록` | A1:E10 | 5 | 일반 키오스크 이용자와 크레딧 |
| 9 | `주문내역` | A1:W307 | 23 | 현재 주문 원장 |
| 10 | `설정` | A1 | 1 | 현재 비어 있는 미사용 시트 |
| 11 | `이용신청` | A1:V | 22 | 배달왔삼 사전 이용 신청과 승인·보관·대기자 상태 |

## 실제 1행 헤더

### 이용자목록 A:E

`이용자ID`, `별명`, `크레딧`, `사용여부`, `사진url`

### 간식목록 A:I

`간식ID`, `이름`, `포인트`, `사진URL`, `판매여부`, `재고`, `표시순서`, `제공대상`, `범주`

`제공대상`의 운영 표준값은 소문자 `user` 또는 `guest`입니다. 데이터에 대소문자나 `Y/N` 표기가 섞일 수 있으므로 코드에서는 기존 정규화 동작을 유지합니다.

### 주문내역 A:W

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

### 주문보관 A:R

`주문시간`, `주문번호`, `이용자ID`, `별명`, `간식ID`, `간식명`, `수량`, `차감포인트`, `제공여부`, `cancelTimestamp`, `orderToken`, `deliveryType`, `deliveryFee`, `totalCredit`, `reviewed`, `deliveryPlace`, `cancelReason`, `cancelReasonDetail`

### 관리자로그 A:H

`timestamp`, `action`, `targetType`, `targetId`, `targetName`, `beforeValue`, `afterValue`, `memo`

### 운영설정 A:B

`key`, `value`

### 후기내역 A:J

`createdAt`, `orderId`, `guestName`, `stamp`, `tags`, `comment`, `isPublic`, `imageUrl`, `replyText`, `replyCreatedAt`

### 게스트프로필 A:D

`guestKey`, `displayName`, `deliveryPlace`, `updatedAt`

### 게스트크레딧 A:I

`periodKey`, `guestDeviceId`, `guestKey`, `baseCredit`, `bonusCredit`, `creditLimit`, `usedCredit`, `remainingCredit`, `updatedAt`

### 이용신청 A:V (신규 코드 계약, P21 이후 22열)

`createdAt`, `applicationId`, `requestId`, `name`, `relationType`, `relationDetail`, `phone`, `deliveryPlace`, `deliveryDetail`, `preferredDays`, `message`, `consentAt`, `status`, `contactedAt`, `reviewedAt`, `retentionUntil`, `anonymizedAt`, `adminMemo`, `waitlistPosition`, `skipUntil`, `cooldownUntil`, `updatedAt`

- 상태는 `PENDING`, `WAITLIST`, `APPROVED`, `REJECTED`, `INACTIVE`를 사용합니다. PENDING은 화면에서 '검토 중', WAITLIST는 '대기'로 표시합니다.
- `requestId`는 동일 신청 재전송 방지용이며 익명화할 때 삭제합니다.
- 반려·중지는 처리 후 30일의 `retentionUntil`을 기록하고 재승인 시 비웁니다.
- APPROVED는 매주 월요일 자동 순환 시 WAITLIST로 전환됩니다 (cooldownUntil 2주 설정).
- `waitlistPosition`은 WAITLIST 상태에서만 유효한 대기 순번입니다. 상태 변경 시 `reindexWaitlistPositions()`로 재계산합니다.
- `skipUntil`은 "이번 주 건너뛰기" 만료일입니다. 이 날짜가 오늘보다 미래면 자동 승격에서 제외됩니다.
- `cooldownUntil`은 APPROVED → WAITLIST 복귀 시 설정되는 쿨다운 만료일입니다. 미래면 승격 제외됩니다.
- `skipUntil`과 `cooldownUntil`은 둘 중 하나라도 미래면 승격에서 제외됩니다. 자정(00:00:00) 기준으로 비교합니다.
- 익명화 후에는 신청번호·상태·처리 시각만 남기고 이름·연락처·장소·관계·희망 요일·메시지·관리자 메모·대기순번·건너뛰기·쿨다운을 제거합니다.
- 이 시트의 개인정보를 주문내역·주방·전광판·빌지·후기·관리자로그로 복사하지 않습니다.

### 이용 신청용 운영설정 키

`guestApplicationOpen`, `guestApplicationTarget`, `guestApplicationOperatingDays`, `guestApplicationOrderTime`, `guestApplicationDeliveryTime`, `guestApplicationArea`, `guestApplicationUsage`, `guestApplicationDayOptions`, `guestApplicationCapacity`, `guestApplicationClosedMessage`, `guestApplicationCooldownWeeks`, `guestApplicationWaitlistLimit`

`guestApplicationCapacity`는 기본 5이며 관리자 화면에서 1~100명 사이 정수로 조절합니다. 현재 활성 신청 수보다 낮춰도 기존 신청 행은 유지하고 신규 접수만 마감합니다.

`운영설정`은 키가 추가되는 세로형 구조이므로 신규 키 반영 후 기존 A1:B15 사용 범위보다 행 수가 늘어납니다.

## 코드와 실제 헤더 차이

- 주문 API 응답과 현재 운영 DB는 배송지에 `deliveryPlace`를 사용합니다.
- `주문내역` V열의 `deliveryAddress`는 구버전 호환용으로 남아 있습니다. P열 `deliveryPlace`와 V열을 임의로 합치거나 이동하지 않습니다.
- `ensureOrderHeaders()`의 기본 헤더 배열과 새 `주문보관` 생성 코드는 16번째 열 이름을 `deliveryAddress`로 사용하지만, 실제 운영 `주문보관` P열은 `deliveryPlace`입니다.
- 현재 운영에서는 기존 `주문보관`에 위치 기준 A:R 18개 열을 추가하므로 데이터 열 정렬에는 문제가 없습니다. 다만 `주문보관` 시트가 없는 새 DB에서 코드가 시트를 자동 생성하면 P열 헤더명이 달라질 수 있습니다.
- 진단 코드는 `deliveryPlace`와 `deliveryAddress` alias를 허용합니다. 경고만 보고 물리 열을 재배열하지 않습니다.

## 주문 보관 정합성

- `주문내역` A:R과 `주문보관` A:R은 검증 파일에서 순서와 의미가 일치합니다.
- `archiveOldOrders()`는 주문 행을 18열로 맞춘 뒤 `slice(0, 18)`로 복사합니다.
- S:W의 `guestDeviceId`, `authProvider`, `guestKey`, `deliveryAddress`, `idempotencyKey`는 주문보관에서 의도적으로 제외됩니다.
