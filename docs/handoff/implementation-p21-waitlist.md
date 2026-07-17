# P21 — 배달왔삼 이용 신청 대기자(WAITLIST) 기능

> 구현 계획서 · 2026-07-17 (v4 — 최종 확정 + 구현 최적화 지침)  
> [핸드오프로 돌아가기](../../handoff.md)

---

## 1. 개요

현재 이용 신청은 `PENDING + APPROVED`가 설정된 정원에 도달하면 (`APPLICATION_FULL`) 신청 자체를 거절합니다.  
이 기능은 **정원 초과 시에도 신청을 받아 대기자(WAITLIST)로 저장**하고, **매주 자동 순환**을 통해 관리자의 수동 조정과 함께 운영할 수 있도록 합니다.

### 선행 조건

- **P14 (배달왔삼 1차 시범 신청 정원 관리)가 배포·검증 완료되어야 합니다.**
  - `guestApplicationCapacity` 키가 `운영설정` 시트에 존재해야 함
  - `getGuestApplicationCapacity()`가 정상 동작해야 함
  - 관리자 화면에서 정원 증감이 가능해야 함
  - 사용자 확인 완료 (2026-07-17)

### 핵심 설계 결정

| 결정 | 내용 | 이유 |
|---|---|---|
| 순환 방식 | **자동 순환 + 수동 조정 혼합** | 관리 부담은 줄이고, 현장 변수에 유연하게 대응 |
| 서비스 주기 | **1주 단위**, 매주 월요일 자동 순환 | 발달장애인 사회참여 프로그램의 안정적 운영 |
| 서비스 완료자 | **WAITLIST 맨 뒤로 자동 복귀** | 재신청 부담 없이 지속적 참여 가능 |
| 이번 주 건너뛰기 | **WAITLIST 순번 유지 (skipUntil)** | 일시적 불참에도 순번 보존, 다음 주 자동 승격 대상 |
| 쿨다운 | **2주 cooldown** (APPROVED 후 WAITLIST 진입 시) | 특정인만 반복되지 않도록 공평한 기회 보장 |
| 대기자 제한 | **WAITLIST 100명 초과 시 신규 접수 중단** | 순환 주기가 너무 길어지는 것 방지 |
| 개인정보 파기 | **INACTIVE만 30일 후 익명화** (순환 중인 WAITLIST는 활성 상태로 유지) | 30일 규칙과 순환형이 충돌하지 않음 |

### 빈 정원 처리 규칙

> WAITLIST가 정원보다 적어 빈 정원이 발생하면, 해당 정원만큼 신규 접수를 PENDING으로 받을 수 있도록 `guestApplicationOpen`을 활성화합니다.

| 상황 | 처리 |
|---|---|
| WAITLIST 수 >= 정원 | 정상 자동 승격 |
| WAITLIST 수 < 정원, WAITLIST > 0 | WAITLIST 전원 승격 + 빈 정원은 PENDING 접수 대기 |
| WAITLIST = 0 | 승격 없음, 전체 정원 PENDING 접수 대기 |
| WAITLIST = 0, APPROVED = 0 (최초) | 관리자에게 "먼저 검토 중인 신청을 승인해 주세요" 안내 |

---

## 2. 상태 전이 다이어그램

```
                  ┌───────────┐
                  │ WAITLIST  │ ← 정원 초과 신규 접수
                  │  (대기)   │ ← 순환 복귀 (매주 월요일 자동)
                  └─────┬─────┘
                        │ (자동 승격, 정원 여유 시)
                        ▼
                 ┌─────────────┐
                 │  APPROVED   │ ← 서비스 중 (1주간)
                 │ (서비스 중) │
                 └──────┬──────┘
                        │ (매주 월요일 자동, 쿨다운 2주 설정)
                        ▼
                  ┌───────────┐
                  │ WAITLIST  │ ← 맨 뒤로 순환
                  │  (대기)   │
                  └───────────┘

     ── 신규 접수 (정원 미만) ──

        ┌─────────┐
        │ PENDING │  ← 정원 여유 시 신규 접수
        │(검토 중)│
        └────┬────┘
             │ (관리자 승인)
             ▼
        ┌─────────┐
        │APPROVED │
        │(서비스중)│
        └─────────┘

     ── 예외 처리 ──

     APPROVED ─→ WAITLIST (순환, 쿨다운 2주)
     APPROVED ─→ INACTIVE (영구 종료)
     WAITLIST ─→ INACTIVE (대기 포기, 영구 종료)
     WAITLIST ─→ PENDING (수동 승격, 정원 여유 시)
```

### 허용 전환

| 현재 상태 | → WAITLIST | → PENDING | → APPROVED | → REJECTED | → INACTIVE |
|---|---|---|---|---|---|
| WAITLIST | - | ✅ (정원 여유 필요) | ❌ (자동 승격 전용) | ✅ | ✅ |
| PENDING | ❌ | - | ✅ (정원 여유 필요) | ✅ | ✅ |
| APPROVED | ✅ (자동 순환, 쿨다운 설정) | ❌ | - | ✅ | ✅ |
| REJECTED | ❌ | ❌ | ❌ | - | ❌ |
| INACTIVE | ❌ | ❌ | ❌ | ❌ | - |

---

## 3. 자동 순환 로직 (매주 월요일 오전 6시)

### GAS 시간 기반 트리거: `rotateGuestApplicationWeekly()`

```
입력: 현재 정원 N, 설정된 쿨다운 주기 K (기본 2주)

1. APPROVED → WAITLIST 전환
   현재 APPROVED인 모든 행을 조회
   각 행에 대해:
     - status = WAITLIST
     - cooldownUntil = 오늘 + K주 후 (예: 2주 후 월요일)
     - waitlistPosition = 현재 WAITLIST 최대 순번 + 연속 증가값
     - contactedAt = '' (초기화)
     - updatedAt = now

2. WAITLIST → APPROVED 승격
   쿨다운과 skipUntil을 고려하여 승격 대상 선별:
     WAITLIST 중에서
       cooldownUntil이 비었거나 오늘보다 과거인 행
       AND skipUntil이 비었거나 오늘보다 과거인 행
     → waitlistPosition 오름차순으로 정렬
     → 상위 N명 (정원 수) 선택
     → status = APPROVED
     → waitlistPosition = '' (비움)
     → updatedAt = now

3. 빈 정원 처리
   승격 대상이 정원보다 적으면:
     - guestApplicationOpen = Y로 전환 (PENDING 접수 활성화)
     - 관리자 알림: "정원이 N명 비어 있습니다. 신규 신청을 받습니다"

4. 결과 기록
   - 승격된 인원 수
   - 순환 복귀된 인원 수
   - 현재 WAITLIST 잔여 인원
   - 빈 정원 수
```

### 자동 실행 후 관리자 알림

- 관리자 화면에 "🔄 이번 주 서비스 대상이 자동 갱신되었습니다" 메시지
- 변경 내역 표시: 순환 복귀자 목록, 신규 승격자 목록, 빈 정원 정보
- 관리자가 수동 조정 가능 (건너뛰기, 수동 승격, 수동 반려)

---

## 4. "이번 주 건너뛰기" (skipUntil)

### 동작 흐름

```
1. 관리자가 APPROVED인 E의 상세 모달에서 [이번 주 건너뛰기] 버튼 클릭
2. E의 상태 변경:
   - status = WAITLIST (APPROVED에서 WAITLIST로)
   - waitlistPosition = 현재 WAITLIST 최대 순번 + 1 (맨 뒤)
   - skipUntil = 다음 주 월요일
   - contactedAt = now (건너뛰기 기록)
3. 관리자가 WAITLIST 상위에 있는 G를 수동으로 APPROVED로 승격
4. 이번 주 서비스 대상: 기존 APPROVED 2명 + G
```

### 결정: **순번 유지 (waitlistPosition 변경 없음)**

- 건너뛴 사람의 순번을 유지하면, 다음 주에 자동으로 승격 대상이 됨
- 관리자가 별도로 승격시킬 필요 없음
- 단, "2주 연속 건너뛰기"는 skipUntil을 2주 후로 설정하여 처리

### 자동 순환 시 skipUntil 처리

```
자동 승격 로직:
  - skipUntil이 오늘보다 미래면 → 승격 제외 (순번 유지)
  - skipUntil이 오늘보다 과거거나 없으면 → 승격 대상

건너뛰기 한 사람은 다음 주 월요일 skipUntil이 과거가 되므로
별도 조작 없이 자동 승격 대상으로 복귀 ✅
```

---

## 5. 변경 범위

### 5.1 GAS — `gas/12_GuestApplications.gs`

| 항목 | 변경 내용 |
|---|---|
| `GUEST_APPLICATION_STATUS` | `WAITLIST` 값 추가 |
| `GUEST_APPLICATION_HEADERS` | `waitlistPosition`, `skipUntil`, `cooldownUntil` 열 추가 (기존 19열 → 22열) |
| `GUEST_APPLICATION_DATE_HEADERS` | `skipUntil`, `cooldownUntil` 추가 (날짜 포맷 자동 적용) |
| `isGuestApplicationCapacityStatus` | WAITLIST 제외 (정원 계산에 포함하지 않음) |
| `getGuestApplicationCapacityState` | 반환값에 `waitlistCount`, `waitlistLimit` 추가 |
| `submitGuestApplication` | 정원 미만 → PENDING, 정원 이상 → WAITLIST로 저장 |
| | WAITLIST 100명 초과 시 신규 접수 거절 |
| | WAITLIST 수 < 정원이면 PENDING으로 접수 |
| `getGuestApplicationsForAdmin` | WAITLIST 상태 필터 및 정렬 지원, waitlistCount 추가 |
| `updateGuestApplication` | WAITLIST → PENDING 승격 허용 (정원 여유 확인) |
| | WAITLIST 행 상태 변경 시 `reindexWaitlistPositions()` 호출 |
| `getGuestApplicationStatusCounts` | WAITLIST 집계 추가 |
| **`rotateGuestApplicationWeekly()`** | **신규**: 매주 월요일 자동 순환 로직 (아래 의사코드 참조) |
| | APPROVED → WAITLIST + 쿨다운 설정 |
| | WAITLIST → APPROVED (쿨다운/skipUntil 제외) |
| | **배치 시트 업데이트 (setValues 1회 호출)** |
| | **자정 기준 날짜 연산 (isDateBeforeOrEqual)** |
| | **빈 정원 발생 시 guestApplicationOpen = Y 설정** |
| | **try/finally + Lock + 실패 로그 기록** |
| `createWeeklyRotationTrigger()` | **신규**: 시간 기반 트리거 생성 함수 |
| `skipGuestApplicationWeek()` | **신규**: 특정 APPROVED/WAITLIST에 skipUntil 설정 |
| **`reindexWaitlistPositions(table)`** | **신규**: 대기 순번 재계산 공통 함수 |
| **`isDateBeforeOrEqual(dateStr, now)`** | **신규**: 자정 기준 날짜 비교 유틸리티 |

---

### 5.2 구현 최적화 지침

#### 1️⃣ GAS 배치(Batch) 시트 업데이트

`rotateGuestApplicationWeekly()` 실행 시 **행 단위 `setValues` 반복 호출을 금지**하고, 메모리에서 전체 변경 행을 수집한 뒤 `Range.setValues()` 1회 배치 호출로 처리합니다.

```javascript
// ❌ 비권장: 행 단위 반복 (GAS 실행 시간 / Lock 소요 시간 증가)
changedRows.forEach(row => {
  sheet.getRange(rowIndex + 2, 1, 1, headers.length).setValues([row]);
});

// ✅ 권장: setValues 1회 배치 호출
if (allRows.length > 0) {
  sheet.getRange(firstRow, 1, allRows.length, headers.length)
    .setValues(allRows);
}
```

**효과**: WAITLIST 100명 기준, `setValues` 100회 → 1회로 감소. Lock 유지 시간이 1/100로 단축됩니다.

#### 2️⃣ 자정(Midnight) 기준 날짜 연산

`cooldownUntil` 및 `skipUntil` 비교 시 **ISO 시/분/초 오차를 방지**하기 위해 `isDateBeforeOrEqual()` 유틸리티 함수를 사용합니다.

```javascript
function isDateBeforeOrEqual(dateStr, now) {
  if (!dateStr) return true; // 날짜 없으면 통과
  const d = new Date(dateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return target <= today; // 자정(00:00:00) 기준 비교
}
```

**배경**: `cooldownUntil = 8월 4주차 월요일 00:00:00`이고 자동 순환이 `8월 4주차 월요일 06:00:00`에 실행될 때, 시/분/초를 포함한 비교면 `06:00:00 > 00:00:00`으로 승격 제외되는 버그가 발생할 수 있습니다. 자정 기준 비교로 이 문제를 방지합니다.

#### 3️⃣ 대기 순번(waitlistPosition) 재계산 공통화

중도 포기(INACTIVE), 반려(REJECTED), 수동 승격(APPROVED) 발생 시 대기 순번 구멍을 메우는 **공통 함수**를 도입합니다.

```javascript
function reindexWaitlistPositions(table) {
  let position = 0;
  table.rows.forEach(row => {
    const status = String(row[table.map.status] || '').trim();
    if (status === 'WAITLIST') {
      position++;
      row[table.map.waitlistPosition] = position;
    }
  });
}
```

**호출 시점**: `updateGuestApplication()`에서 상태 변경 후, `rotateGuestApplicationWeekly()`에서 배치 업데이트 전.

#### 4️⃣ 시트 헤더 자동 확장 안전장치

`setupGuestApplicationSheet()` 실행 시 기존 19열 헤더 시트에 **missing column 헤더를 자동 추가**하여 22열(A:V)로 무중단 확장합니다.

```javascript
// GUEST_APPLICATION_HEADERS에 새 열 추가 (이미 코드에 반영 가정)
// ensureGuestApplicationSheet()의 기존 로직:
GUEST_APPLICATION_HEADERS.forEach(header => {
  if (headers.indexOf(header) === -1) {
    headers.push(header);
    modified = true;
  }
});
```

`GUEST_APPLICATION_HEADERS = ['createdAt', ..., 'waitlistPosition', 'skipUntil', 'cooldownUntil', 'updatedAt']`로 총 22열.

- 기존 `이용신청` 시트가 19열(A:S)이면, 누락된 3열을 자동 감지하여 추가
- 기존 행은 새 열에 빈 값 유지, 이후 순환/건너뛰기 시 값 채워짐
- **`GUEST_APPLICATION_DATE_HEADERS`에도 `skipUntil`, `cooldownUntil` 추가**하여 날짜 포맷 자동 적용

#### 5️⃣ `check-handoff.js` / `database-schema.md` 갱신 연계

P21 개발 완료 및 GAS 배포 직전에 다음 항목을 반드시 갱신합니다.

| 문서 | 갱신 내용 |
|---|---|
| `database-schema.md` | 이용신청 섹션: A:S 19열 → A:V 22열, 새 열 3개 설명 추가 |
| `check-handoff.js` | 이용신청 열 수 검사 기준 19 → 22로 상향 |
| `decisions.md` | WAITLIST 상태, 용어 변경(PENDING→검토 중) 반영 완료 확인 |

---

### 5.3 `rotateGuestApplicationWeekly()` 최종 의사코드 (최적화 포함)

```javascript
function rotateGuestApplicationWeekly() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  
  try {
    const sheet = ensureGuestApplicationSheet();
    const table = getGuestApplicationRows(sheet);
    const settings = readGuestApplicationSettings();
    const applications = getGuestApplicationObjects(table);
    const capacity = getGuestApplicationCapacity(settings.guestApplicationCapacity);
    const now = new Date();
    const cooldownWeeks = Number(settings.guestApplicationCooldownWeeks) || 2;
    const cooldownDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + cooldownWeeks * 7);

    // 1. APPROVED → WAITLIST (쿨다운 설정)
    let maxPosition = Math.max(0, ...applications
      .filter(a => a.status === 'WAITLIST')
      .map(a => Number(a.waitlistPosition) || 0));

    table.rows.forEach(row => {
      if (String(row[table.map.status] || '').trim() === 'APPROVED') {
        maxPosition++;
        row[table.map.status] = 'WAITLIST';
        row[table.map.waitlistPosition] = maxPosition;
        row[table.map.cooldownUntil] = cooldownDate;
        row[table.map.contactedAt] = '';
        row[table.map.updatedAt] = now;
      }
    });

    // 2. WAITLIST → APPROVED (쿨다운/skipUntil 제외, 자정 기준 날짜 비교)
    const waitlistRows = table.rows
      .map((row, index) => ({ row, index,
        position: Number(row[table.map.waitlistPosition]) || 9999
      }))
      .filter(item => {
        const status = String(item.row[table.map.status] || '').trim();
        if (status !== 'WAITLIST') return false;
        const cooldownOk = isDateBeforeOrEqual(item.row[table.map.cooldownUntil], now);
        const skipOk = isDateBeforeOrEqual(item.row[table.map.skipUntil], now);
        return cooldownOk && skipOk;
      })
      .sort((a, b) => a.position - b.position);

    const promoted = waitlistRows.slice(0, capacity);
    promoted.forEach(item => {
      item.row[table.map.status] = 'APPROVED';
      item.row[table.map.waitlistPosition] = '';
      item.row[table.map.contactedAt] = '';
      item.row[table.map.updatedAt] = now;
    });

    // 3. 빈 정원 처리
    const emptySlots = Math.max(0, capacity - promoted.length);
    if (emptySlots > 0 && settings.guestApplicationOpen !== 'Y') {
      setGuestApplicationSettingsValues({ guestApplicationOpen: 'Y' });
    }

    // 4. 시트 업데이트 (배치 — setValues 1회)
    const changedRows = table.rows.filter(row =>
      row[table.map.updatedAt] === now
    );
    if (changedRows.length > 0) {
      const firstIndex = table.rows.indexOf(changedRows[0]);
      const batchedValues = changedRows.map(row =>
        guestApplicationObjectToRow(
          guestApplicationRowToObject(row, table.map),
          table.headers
        )
      );
      sheet.getRange(firstIndex + 2, 1, batchedValues.length, table.headers.length)
        .setValues(batchedValues);
    }

    clearGuestApplicationSettingsCache();

    // 5. 관리자 로그
    safeAppendAdminLog(
      'rotateGuestApplicationWeekly', 'guestApplication', 'weekly',
      '주간 서비스 자동 순환', '',
      '순환 ' + maxPosition + '건 / 승격 ' + promoted.length + '건 / 빈정원 ' + emptySlots + '건', ''
    );

    return {
      success: true,
      rotated: maxPosition,
      promoted: promoted.length,
      emptySlots,
      remainingWaitlist: waitlistRows.length - promoted.length,
    };
  } catch (error) {
    safeAppendAdminLog(
      'rotateGuestApplicationWeekly', 'guestApplication', 'weekly',
      '주간 자동 순환 실패', '',
      '실패: ' + error.message, ''
    );
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}
```

### 5.4 프론트 — `guest-apply.html`

| 항목 | 변경 내용 |
|---|---|
| `renderSettings` | `waitlistActive` 상태 추가 (정원 초과 + WAITLIST 100명 미만) |
| | 정원 초과 시: "현재 정원이 가득 찼으나 대기자로 접수됩니다 (대기 번호 {N})" |
| | WAITLIST 100명 초과 시: "대기자가 많아 추가 접수를 받지 않습니다" |
| | 빈 정원 발생 시: "현재 정원이 비어 있습니다. 신청 후 바로 검토됩니다" |
| `submitGuestApplication` 응답 처리 | `APPLICATION_FULL` → WAITLIST 접수 성공 케이스로 처리 |
| | 성공 시 대기 번호 표시: "대기 접수되었습니다 (대기 번호 {N})" |
| | `WAITLIST_FULL` 코드 추가 처리 |
| 운영 안내 섹션 | 정원 표시: "1차 {N}명 · 접수 {M}명 · 대기 {W}명" |

### 5.5 프론트 — `admin.html`

| 항목 | 변경 내용 |
|---|---|
| `APPLICATION_STATUS_META`에 `WAITLIST` 추가 | 라벨: '대기', className: 'waitlist', 스타일: 보라 계열 |
| 필터 버튼 | 현행: 전체 · 대기(PENDING) · 승인 · 반려 · 중지 |
| | 변경: 전체 · **검토 중(PENDING)** · **대기(WAITLIST)** · 승인 · 반려 · 중지 |
| | 용어 변경: `PENDING` '대기' → '**검토 중**' |
| 정원 현황 요약 | "1차 {N}명 · 접수 {M}명 · 대기 {W}명 · 남음 {R}명" |
| | WAITLIST 100명 초과 시 경고 표시 |
| | 빈 정원 발생 시 "정원 {N}명 비어 있음" 표시 |
| 상세 모달 (WAITLIST) | [승인으로 올리기] 버튼 (정원 여유 시 활성) |
| | [이번 주 건너뛰기] 버튼 (skipUntil 설정) |
| | 쿨다운 남은 기간 표시 (cooldownUntil) |
| | 건너뛰기 남은 기간 표시 (skipUntil) |
| 상세 모달 (APPROVED) | [이번 주 건너뛰기] 버튼 (→ WAITLIST + skipUntil) |
| 카드 목록 | WAITLIST 카드에 대기 순번 표시 (`#1`, `#2`, ...) |
| | 쿨다운/건너뛰기 아이콘 표시 |
| 자동 순환 결과 알림 | 🔄 자동 순환 성공/실패/빈 정원 정보 표시 |
| | [수동 조정] 버튼으로 건너뛰기/승격 가능 |

### 5.6 문서

| 문서 | 변경 내용 |
|---|---|
| `decisions.md` 14행 | 대기열 도입 + 수동 승격 + 용어 변경 반영 (완료) |
| `database-schema.md` 이용신청 섹션 | A:S 19열 → A:V 22열, `waitlistPosition`(S), `skipUntil`(T), `cooldownUntil`(U) 추가 |
| `check-handoff.js` | 이용신청 열 수 검사 기준 19 → 22로 상향 |

---

## 6. DB 계약

### 이용신청 A:V (기존 19열 → 22열)

```
A  createdAt         (날짜)
B  applicationId     (APP-YYYYMMDD-NNN)
C  requestId         (UUID)
D  name
E  relationType
F  relationDetail
G  phone
H  deliveryPlace
I  deliveryDetail
J  preferredDays
K  message
L  consentAt         (날짜)
M  status            (PENDING / APPROVED / REJECTED / INACTIVE / WAITLIST)
N  contactedAt       (날짜)
O  reviewedAt        (날짜)
P  retentionUntil    (날짜)
Q  anonymizedAt      (날짜)
R  adminMemo
S  waitlistPosition  (숫자, WAITLIST 상태에서만 유효)
T  skipUntil         (날짜, 건너뛰기 만료일, 자정 기준 비교)
U  cooldownUntil     (날짜, 쿨다운 만료일, 자정 기준 비교)
V  updatedAt         (날짜)
```

- `waitlistPosition`: WAITLIST 상태의 행만 유효. 1부터 시작하며, `reindexWaitlistPositions()`로 재계산.
- `skipUntil`: "이번 주 건너뛰기" 시 설정. 자정 기준으로 오늘보다 미래면 승격 제외. 과거면 승격 대상.
- `cooldownUntil`: APPROVED → WAITLIST 복귀 시 설정 (현재 + 2주, 자정). 미래면 승격 제외. 과거면 승격 대상.
- `skipUntil`과 `cooldownUntil`은 독립적으로 동작. 둘 중 하나라도 미래면 승격 제외.

### 운영설정 추가 키

| 키 | 기본값 | 설명 |
|---|---|---|
| `guestApplicationCooldownWeeks` | `2` | APPROVED → WAITLIST 복귀 후 승격 제외 주기 |
| `guestApplicationWaitlistLimit` | `100` | WAITLIST 최대 인원 (초과 시 신규 접수 중단) |

---

## 7. UI 흐름

### 7.1 신청 페이지 (guest-apply.html)

```
[정원 미만]                    [정원 초과]                    [WAITLIST 100명 초과]
─────────────────              ─────────────────             ─────────────────────
신청 접수                      신청 접수                      신청 접수 불가
(정원 N명 · 접수 M명)          (정원 N명 · 접수 M명           (정원 N명 · 접수 M명
                                 · 대기 W명)                   · 대기 100명)

폼 작성 → 제출                  폼 작성 → 제출                 폼 숨김
   │                               │                          "대기자가 가득 차
   ▼                               ▼                           추가 접수를 받지
"신청 접수 완료 (검토 중)"    "대기 접수 완료                   않습니다"
                                (대기 번호 #K)"                → 기관 담당자 문의

상태 표시: open                  상태 표시: waitlist            상태 표시: closed
                                 + 대기 W명 표시
```

### 7.2 관리자 페이지 (admin.html)

```
필터 버튼:
  [전체] [검토 중] [대기] [승인] [반려] [중지]

               ┌──────────────────────────────┐
               │ 1차 5명 · 접수 3명           │
               │ 대기 2명 · 남음 2명          │
               │ 쿨다운: 2주                  │
               └──────────────────────────────┘

자동 순환 결과 알림 (월요일):
  ┌────────────────────────────────────────────┐
  │ 🔄 이번 주 서비스 대상이 자동 갱신됨      │
  │ 순환 복귀: A, B, C (3명)                  │
  │ 신규 승격: D, E, F (3명)                  │
  │ ⚠️ 빈 정원 1명 — 신규 접수 활성화        │
  │ [확인] [수동 조정]                        │
  └────────────────────────────────────────────┘

자동 순환 실패 알림:
  ┌────────────────────────────────────────────┐
  │ ❌ 주간 자동 순환에 실패했습니다           │
  │ 관리자가 수동으로 실행해 주세요            │
  │ [수동 실행] [닫기]                        │
  └────────────────────────────────────────────┘

WAITLIST 카드 (예: 대기 #2):
  ┌─── 김복순 ──── [대기] ──────────────┐
  │ APP-20260717-003                     │
  │ 봉사자 · 010-****-5678               │
  │ OO아파트                             │
  │ 희망: 수요일                         │
  │ 대기 순번: #2                        │
  │ ⏳ 쿨다운: 8월 1주까지               │
  │ (또는) ⏭ 건너뛰기: 7월 4주까지      │
  └──────────────────────────────────────┘
        [상세] → 모달

WAITLIST 상세 모달 액션:
  [승인으로 올리기]  ← 정원 여유 있을 때만 활성
  [이번 주 건너뛰기] ← skipUntil = 다음 주 월요일
  [반려]

APPROVED 상세 모달 액션:
  [이번 주 건너뛰기] ← WAITLIST + skipUntil
  [이용 중지]        ← INACTIVE
```

---

## 8. 전체 시나리오 검증 (정원 3명 기준)

### 8월 1주차 — 최초 운영

```
1주차 월요일 자동 순환 (최초)
  → WAITLIST에 아무도 없음 → 승격 없음
  → 빈 정원 3명 → guestApplicationOpen = Y
  → 관리자 알림: "먼저 검토 중인 신청을 승인해 주세요"

상태: (아직 APPROVED 없음)

관리자 수동 승인:
  A: PENDING → APPROVED
  B: PENDING → APPROVED
  C: PENDING → APPROVED
  D: WAITLIST #1 (신규 접수, 정원 초과)
  E: WAITLIST #2 (신규 접수, 정원 초과)
  F: WAITLIST #3 (신규 접수, 정원 초과)

서비스 대상: A, B, C ✅
```

### 8월 2주차

```
2주차 월요일 자동 순환
  1. A, B, C → WAITLIST 맨 뒤 (#4, #5, #6) + cooldownUntil = 8월 4주차 00:00
  2. D(#1), E(#2), F(#3) → APPROVED (쿨다운 없음)

서비스 대상: D, E, F ✅
```

### 8월 3주차 — 건너뛰기 발생

```
3주차 월요일 자동 순환
  1. D, E, F → WAITLIST 맨 뒤 (#7, #8, #9) + cooldownUntil
  2. 승격 대상 선별:
     - A(#4): 쿨다운 8월 4주차 → 아직 미래 → 제외 ❌
     - B(#5): 쿨다운 제외 ❌
     - C(#6): 쿨다운 제외 ❌
     - G(#7): 승격 ✅, H(#8): 승격 ✅, I(#9): 승격 ✅

서비스 대상: G, H, I ✅

→ E가 "이번 주 힘들다" → 관리자 [이번 주 건너뛰기]
  E: WAITLIST #10 + skipUntil = 8월 4주차 00:00
  J(#10) → 수동 승격 (reindexWaitlistPositions로 #10당겨짐)

실제 서비스: G, H, J ✅
```

### 8월 4주차 (쿨다운 해제 + 건너뛰기 해제)

```
4주차 월요일 06:00 자동 순환
  isDateBeforeOrEqual('8월 4주차 00:00', '8월 4주차 06:00') === true
  → A, B, C 쿨다운 해제 ✅
  → E 건너뛰기 해제 ✅

  1. G, H, J → WAITLIST 맨 뒤
  2. A(#4), B(#5), C(#6) → APPROVED
  3. E(#7)는 정원 초과로 대기 유지

서비스 대상: A, B, C ✅ (2주 후 재승격)
```

**→ 대기자 6명 기준, 약 2~3주마다 한 번씩 서비스 가능 ✅**

---

## 9. 검증 항목

1. **정원 이하 접수**: 기존 PENDING 접수 정상 동작 확인
2. **정원 초과 접수**: WAITLIST로 저장 + 대기 순번 부여 확인
3. **WAITLIST 100명 초과**: 신규 접수 거절 메시지 확인
4. **중복 연락처 차단**: WAITLIST도 활성 상태로 간주하여 차단 확인
5. **자동 순환 (정상)**: APPROVED → WAITLIST, WAITLIST → APPROVED 정상 전환 확인
6. **쿨다운 적용**: cooldownUntil이 미래면 승격 제외 확인
7. **쿨다운 해제**: cooldownUntil이 과거면 승격 대상 복귀 확인
8. **건너뛰기**: skipUntil 설정 시 승격 제외, 해제 후 복귀 확인
9. **건너뛰기 + 쿨다운 동시 적용**: 둘 중 하나라도 미래면 제외 확인
10. **WAITLIST 순번 재계산**: `reindexWaitlistPositions()` 중간 행 제거 시 정상 동작 확인
11. **용어 변경**: PENDING '검토 중', WAITLIST '대기' 표시 확인
12. **정원 통계**: 대기 인원이 정원 계산(`PENDING + APPROVED`)에 포함되지 않는지 확인
13. **빈 정원 처리**: WAITLIST 부족 시 guestApplicationOpen 활성화 확인
14. **자동 순환 실패 복구**: 실패 시 관리자 로그 기록 + 알림 확인
15. **배치 시트 업데이트**: setValues 1회 호출로 모든 변경 행 업데이트 확인
16. **자정 기준 날짜 비교**: 시/분/초 오차 없이 cooldownUntil / skipUntil 해제 확인
17. **시트 헤더 자동 확장**: 기존 19열 시트에서 `setupGuestApplicationSheet()` 실행 시 22열로 확장 확인
18. **check-handoff.js / database-schema.md**: 열 수 검사 기준 22열로 갱신 확인

---

## 10. 구현 우선순위

| 순서 | 작업 | 의존성 |
|---|---|---|
| 1 | **P14 배포·검증** (정원 설정 키 확인) | 없음 |
| 2 | **GAS 코드 구현** (`WAITLIST`, 새 열, `rotateGuestApplicationWeekly()`) | P14 완료 |
| 3 | **`reindexWaitlistPositions()`, `isDateBeforeOrEqual()` 유틸리티 구현** | 2와 동시 |
| 4 | **`GUEST_APPLICATION_HEADERS` + `GUEST_APPLICATION_DATE_HEADERS` 확장** (22열) | 2와 동시 |
| 5 | **GAS 배포** + `setupGuestApplicationSheet()` 실행 | 2, 3, 4 완료 |
| 6 | **관리자 UI 구현** (대기자 필터, 건너뛰기, 쿨다운 표시) | 2 완료 |
| 7 | **신청 페이지 UI 구현** (대기 접수, 대기 번호 표시) | 2 완료 |
| 8 | **자동 순환 트리거 설정** + 1주일 운영 테스트 | 5, 6, 7 완료 |
| 9 | **`database-schema.md` 갱신** (A:S → A:V 22열) | 5 완료 |
| 10 | **`check-handoff.js` 갱신** (열 수 검사 기준 19→22) | 9 완료 |

---

## 11. 작업 이력

| 날짜 | 항목 | 내용 |
|---|---|---|
| 2026-07-17 | 계획 수립 | P21 대기자 기능 초안 작성 |
| 2026-07-17 | 설계 확정 | 순환형(자동+수동) 결정, 쿨다운 2주, skipUntil, WAITLIST 100명 제한, 30일 규칙 유지 확정 |
| 2026-07-17 | 최종 보완 | 빈 정원 처리, 실패 복구, 최초 수동 운영, P14 선행 조건 |
| 2026-07-17 | 구현 최적화 지침 추가 | 배치 업데이트, 자정 기준 날짜 연산, `reindexWaitlistPositions()` 공통화, 시트 헤더 자동 확장, `check-handoff.js` 갱신 연계 |
| 2026-07-17 | 관리자 모달 UX 개선 | admin.html 신청 상세 모달: detail-grid 2열 유지(모바일 1fr 제거), 버튼 클릭 시 모달 자동 닫기, 모바일 버튼 높이 통일(min-height 48px + white-space nowrap), 상세정보 max-height 36vh + overflow-y auto, 로딩 영역 min-height 320px |
