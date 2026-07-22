# P44: 배달왔삼 특정 간식 1인당 수량 제한 기능 및 UI/UX 개선 워크스루

> **작업 일시:** 2026-07-22  
> **태스크 ID:** P44  
> **상태:** 구현 완료 및 배포 검증 완료  

---

## 1. 개요 (Overview)

배달왔삼 서비스에서 **특정 간식에 대해 1인당 하루 주문 수량을 제한(예: 1인 1개 한정)**할 수 있도록 **하이브리드 2중 방어 방식 (사전 동적 반영 + 백엔드 최종 검증)**을 구축했습니다.
이용자의 사용자 경험(UX)을 해치지 않고 발달장애인 눈높이에 맞춘 직관적 배지 및 긍정 안내문을 제공하며, 어드민 모달 창 PC 높이 잘림 수정 및 주문 취소 후 재주문 가능 조치까지 통합 완료했습니다.

---

## 2. 주요 변경 사항 (Key Changes)

### 1) 백엔드 (Google Apps Script & 시트 계약)
- **[01_Router.gs](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/gas/01_Router.gs):** `getSnacks` API 라우팅 시 접속자 식별값(`guestKey`, `guestDeviceId`, `userId`) 파라미터 수신 지원.
- **[31_OrderShared.gs](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/gas/31_OrderShared.gs):**
  - `getUserTodaySnackCountsMap()` 함수 구현.
  - 당일 주문 건 중 취소 상태 코드(`'C'`, `'CANCELLED'`, `'CANCELED'`, `'취소'`, `'주문취소'`)는 수량 집계에서 엄격히 제외하여 주문 취소 직후 재주문이 즉시 가능하도록 방어.
- **[21_Snacks.gs](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/gas/21_Snacks.gs):**
  - `SNACKS` 시트 `I`열(`maxPerPerson`) 데이터 조작 및 캐시 연동.
  - `getSnacks()` 호출 시 1인당 제한 수량과 해당 접속자의 당일 누적 주문 수량(`todayOrderedCount`) 반환.
  - `addSnack()`, `updateSnack()`에 `maxPerPerson` 저장 로직 추가.
- **[40_Orders.gs](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/gas/40_Orders.gs):**
  - `placeOrder()` 접수 시 1인 제한 수량 초과 주문 방어.
  - 상황별 안내문 분리:
    - 첫 주문 시 2개 이상 담으려고 할 때: `"🎁 '간식명' 은(는) 1인당 1개 한정 간식입니다. 1개만 선택해 주세요!"`
    - 오늘 이미 1개를 주문 완료한 후 다시 주문하려 할 때: `"🎁 '간식명' 은(는) 오늘 이미 주문하셨습니다. 다른 분을 위해 양보해 주세요 💖"`

### 2) 프론트엔드 어드민 화면
- **[admin.html](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/admin.html):**
  - 신규 간식 등록 모달 및 간식 수정 모달에 `[x] 🎁 1인당 1개 주문 제한 (배달왔삼)` 체크박스 추가.
- **[js/admin.js](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/js/admin.js):**
  - 체크박스 클릭 시 백엔드 API로 `maxPerPerson` 전달 및 간식 관리 테이블에 `(🎁1인1개)` 배지 노출.
- **[css/admin.css](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/css/admin.css):**
  - `.admin-modal-content`에 `max-height: 90vh` 설정.
  - `.admin-modal-body`에 `overflow-y: auto; flex: 1;` 적용 및 `flex-shrink: 0` 제거.
  - **결과:** PC/노트북 화면에서 모달 하단 버튼이 잘리지 않고 본문만 세로 스크롤되도록 고침.

### 3) 게스트/키오스크 주문 화면
- **[menu.html](file:///c:/Users/주간보호/OneDrive/Desktop/새%20폴더/kiosk-trainer/menu.html):**
  - `getSnacks` 호출 시 현재 사용자의 식별값을 전달하여 동적 잔여 수량 반환받음.
  - 카드 이미지 우측 상단에 `🎁 1인 1개 한정` 배지 또는 달성 시 `✅ 오늘 완료` 배지 표시.
  - 당일 이미 몫을 다 먹은 경우 `👏 오늘 몫 선물 완료!` 상태로 바꾸고 `+` 버튼 비활성화.
  - 2개 이상 클릭 시 상황별 알림 메시지 분리 출력.

---

## 3. 검증 결과 (Verification)

1. **자동화 구문 검증:** `node check_syntax.js` (15개 GAS 파일 정상 검증).
2. **어드민 체크박스 & 모달 UI:** PC 모달 세로 잘림 해제 및 스크롤 작동 확인.
3. **취소 주문 재주문:** 취소된 건(`'C'`)이 집계에서 차단되어 재주문 가능 확인.
4. **서비스 워커:** `service-worker.js` 캐시 버전을 `kiosk-cache-v232`로 상향 업데이트.
