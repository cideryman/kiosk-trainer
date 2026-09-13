# 🚀 GAS(Google Apps Script) 변경 및 배포 가이드 (2026-09-13 실시간 정원 관리 개편)

본 문서는 **배달왔삼 실시간 정원 관리 및 배달 연락처 수집 기능**을 구글 스프레드시트(GAS)에 반영하기 위한 가이드입니다.

---

## 📌 변경된 GAS 파일 목록 (2개)

1. **[`gas/60_Settings.gs`](file:///c:/Users/user/Desktop/키오스크/gas/60_Settings.gs)**
2. **[`gas/40_Orders.gs`](file:///c:/Users/user/Desktop/키오스크/gas/40_Orders.gs)**

*(그 외 HTML/JS/CSS 등 프론트엔드 파일들은 이미 로컬 프로젝트 폴더에 모두 완벽히 반영되어 있습니다.)*

---

## 🛠️ GAS 적용 절차 (단계별)

### 1단계: Google Apps Script 편집기 접속
1. 키오스크/배달왔삼 구글 스프레드시트를 엽니다.
2. 상단 메뉴에서 **[확장 프로그램] > [Apps Script]**를 클릭합니다.

### 2단계: 코드 업데이트 (2개 파일)

#### ① `60_Settings.gs` 파일 업데이트
- Apps Script 좌측 파일 목록에서 `60_Settings.gs`를 클릭합니다.
- 로컬의 [`c:\Users\user\Desktop\키오스크\gas\60_Settings.gs`](file:///c:/Users/user/Desktop/키오스크/gas/60_Settings.gs) 전체 내용을 복사하여 웹 편집기에 붙여넣고 저장(Ctrl+S)합니다.
- **주요 변경점 요약**:
  - `getDefaultGuestSettings()`: `guestMaxOrderCount`(기본 5), `guestMaxDeliveryCount`(기본 2), `guestDeliveryArea` 추가
  - `buildGuestSettingsResponse()`: 당일 유효 주문을 집계하여 `remainingOrderCount`, `remainingDeliveryCount`, `isOrderCapped`, `isDeliveryCapped` 실시간 계산 반환
  - `updateGuestSettings()`: 주방 관리자 화면에서 위 3개 설정을 저장할 수 있도록 파라미터 처리 추가

#### ② `40_Orders.gs` 파일 업데이트
- Apps Script 좌측 파일 목록에서 `40_Orders.gs`를 클릭합니다.
- 로컬의 [`c:\Users\user\Desktop\키오스크\gas\40_Orders.gs`](file:///c:/Users/user/Desktop/키오스크/gas/40_Orders.gs) 전체 내용을 복사하여 웹 편집기에 붙여넣고 저장(Ctrl+S)합니다.
- **주요 변경점 요약**:
  - `placeOrder()`: 주문 접수 트랜잭션 내에서 당일 총 주문 수(`guestMaxOrderCount`) 초과 시 즉시 차단
  - 배달 주문 시 당일 배달 한도(`guestMaxDeliveryCount`) 초과 시 차단 및 안내
  - 배달 주문 시 연락처(`deliveryPhone`) 필수 검증
  - **DB 스키마(24열 A:X) 100% 호환 보존**: 수집된 연락처는 P열(16번째 열, `deliveryPlace`)에 `[상세주소] (연락처: 010-XXXX-XXXX)` 형식으로 결합되어 기록되므로 시트 열 구조 변경 없이 주방/영수증 출력과 완전 호환됩니다.

### 3단계: 웹 앱 새 버전 배포
1. Apps Script 우측 상단 파란색 **[배포] > [배포 관리]** 클릭
2. 활성 배포 옆의 **연필 아이콘(수정)** 클릭
3. **버전**: `[신규 버전]` 선택
4. **설명**: `실시간 정원 관리 및 배달 연락처 반영` 입력 후 **[배포]** 클릭!

---

## 📋 저장된 관련 문서 안내
컴퓨터를 켜신 후 아래 파일들을 열어보시면 자세한 기획 의도와 구현 내역을 확인하실 수 있습니다:
- **구현 계획서**: [`구현계획서_배달왔삼_정원관리.md`](file:///c:/Users/user/Desktop/키오스크/구현계획서_배달왔삼_정원관리.md) 또는 [`docs/구현계획서_2026-09-13.md`](file:///c:/Users/user/Desktop/키오스크/docs/구현계획서_2026-09-13.md)
- **완료 보고서(워크스루)**: [`워크스루_배달왔삼_정원관리.md`](file:///c:/Users/user/Desktop/키오스크/워크스루_배달왔삼_정원관리.md) 또는 [`docs/워크스루_2026-09-13.md`](file:///c:/Users/user/Desktop/키오스크/docs/워크스루_2026-09-13.md)
- **코드 리뷰 분석서**: [`docs/코드리뷰_2026-09-13.md`](file:///c:/Users/user/Desktop/키오스크/docs/코드리뷰_2026-09-13.md)
