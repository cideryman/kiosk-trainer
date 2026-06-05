# 간식 키오스크 프로젝트 핸드오프 (Handoff)

이 파일은 프로젝트 작업 진행 상황을 기록하고 추적하기 위한 핸드오프 문서입니다.

## 진행 현황 요약
- **현재 진행 단계**: PWA(Progressive Web App) 연동 완료, 신규 DB 구조 연동 검증 완료, 구글 드라이브 이미지 연동 에러 및 서비스 워커 리다이렉션 버그 해결 완료
- **다음 진행 단계**: 실사용 배포 및 발달장애인 대상 센터 실사용 모니터링 (홈 화면에 바로가기 추가 안내 필요)

---

## PWA (Progressive Web App) 도입 상세

### 1. PWA 설정 파일 추가
- [manifest.json](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/manifest.json): 웹 앱의 이름, 독립 실행 모드(`standalone`), 세로 화면 고정, 테마 색상 및 PWA용 고해상도 앱 아이콘 2종 지정.
- [service-worker.js](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/service-worker.js): 
  - 정적 리소스(HTML, CSS, JS, manifest, 아이콘 등)를 최초 로드 시 기기에 로컬로 영구 캐싱하여 앱 실행 속도를 비약적으로 단축.
  - 구글 Apps Script 연동 API(`script.google.com` 및 action 파라미터 요청)는 서비스 워커가 개입하지 않고 브라우저 기본 엔진이 처리하도록 바이패스(Bypass)하여, 크로스 오리진 리다이렉트 시 서비스 워커 내부 fetch 제약으로 인한 CORS 에러(`TypeError: Failed to fetch`)를 완벽하게 예방.
  - 서비스 워커 설치(`install`) 단계에서 정적 리소스 다운로드 시 브라우저 HTTP 디스크 캐시를 우회하도록 타임스탬프 쿼리파라미터를 추가하여 다운로드하고 원본 URL 키로 저장하는 방식 도입(더블 캐싱 차단).

### 2. 모바일/태블릿 최적화 메타 태그
- 안드로이드/Windows: 크롬 및 엣지 브라우저에서 '앱 설치' 배너 활성화.
- iOS (Safari): 홈 화면에 추가 시 브라우저 프레임이 생략되고 독립 앱으로 구동되도록 애플 전용 메타 태그 완벽 대응.
  ```html
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="간식 키오스크">
  <link rel="apple-touch-icon" href="icons/icon-192.png">
  ```

### 3. PWA 전용 고품질 아이콘 제작
- AI 이미지 생성기(`generate_image`)를 활용하여 간식(쿠키, 주스)을 친근하게 형상화한 PWA 앱 아이콘 2종을 생성하여 `/icons` 디렉토리에 배치완료.
  - `icons/icon-192.png` (192x192)
  - `icons/icon-512.png` (512x512)

---

## 신규 반영된 DB 구조 및 API 명세

### 1. 이용자 목록
- `imageUrl` 속성을 추가하여 이용자 사진 연동.
- 구글 드라이브 주소가 데이터베이스에 저장되어 있을 경우, 웹브라우저에서 직접 표시 및 CORS 로드가 가능한 형태(`https://drive.google.com/thumbnail?id=파일ID&sz=w500`)로 클라이언트 및 API 통신 단에서 실시간 자동 파싱 및 변환 처리 적용.
- 사진이 없거나 로드 실패 시 파스텔톤 배경과 별명의 첫 글자를 딴 원형 아바타를 이니셜로 대체 표시.

### 2. 간식 목록
- `stock` 속성을 추가하여 실시간 남은 재고 수량 연동.
- 간식 사진 역시 구글 드라이브 주소가 지정되었을 경우 자동으로 썸네일 구조로 변환하여 엑세스 차단(403 Forbidden) 문제 해결.
- `stock === 0` 인 간식은 자동으로 **품절** 배지 처리 및 선택(+) 버튼 비활성화.
- 선택 수량이 재고를 초과할 수 없도록 제한하고, 초과 시 사용자에게 시각적/촉각적(진동) 경고 피드백 제공.

### 3. 주문 내역 및 예외 처리
- 주문하기(`placeOrder` API) 실패 시, 에러 응답 내용(재고 부족, 크레딧 부족)을 감지하여 직관적인 한국어 에러 메시지(`alert` 및 화면 대형 경고상자)를 화면에 큼직하게 노출.

### 4. 관리자 페이지
- `getOrdersToday` 호출과 함께 `getSnacks` API를 병렬로 추가 호출.
- 관리자 화면 우측 하단에 **현재 간식 재고 현황** 섹션을 추가하여 실시간 재고량을 리스팅하고, 재고 0개인 간식은 **`[품절]`**로 빨간색 강조 처리.

---

## 구글 드라이브 이미지 & 서비스 워커 에러 해결 내역 (2026-06-05)

### 1. 서비스 워커 리다이렉션 & CORS 에러 해결
- **문제**: HTTPS 환경(GitHub Pages 등)에 배포 시 구글 앱스 스크립트 API가 302 리다이렉트될 때 서비스 워커의 `fetch(event.request)`가 CORS 정책으로 차단되며 데이터 로드가 완전히 정지되는 현상 발생.
- **해결**: [service-worker.js](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/service-worker.js)에서 구글 API 주소 및 action 파라미터가 포함된 요청을 감지하면 `event.respondWith` 없이 즉시 `return` 하도록 변경. 브라우저가 직접 리다이렉트와 CORS를 처리하게 함으로써 안정적인 통신 보장.

### 2. 정적 리소스 강제 갱신(더블 캐싱) 해결
- **문제**: 서비스 워커의 `cache.addAll()` 실행 시 브라우저 HTTP 디스크 캐시의 구버전 파일이 재캐싱되어 코드가 변경되어도 사용자의 화면에 즉시 갱신되지 않는 현상.
- **해결**: [service-worker.js](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/service-worker.js)의 설치 단계에서 타임스탬프(`?_cb=Date.now()`)를 덧붙여 새로 다운로드한 후, 정적 리소스 URL 키값으로 캐시에 저장하는 로직으로 개편. 캐시 버전이 바뀔 때 완벽한 갱신 보장.

### 3. 구글 드라이브 이미지 403 Forbidden 오류 해결
- **문제**: 구글이 최근 외부 웹페이지에서 `uc?export=view` 형태의 이미지 직링크(Hotlinking) 호출을 전면 차단하여 구글 드라이브에 올린 간식 및 유저 사진이 모두 이모지나 아바타로만 출력되는 현상.
- **해결**: 공유 가능한 구글 드라이브 이미지 주소(공유용 뷰어 링크, 기존 uc 링크, 혹은 파일 ID 단독 기재)를 CORS가 허용되는 썸네일 주소(`https://drive.google.com/thumbnail?id=파일ID&sz=w500`)로 파싱해주는 `convertDriveImageUrl` 함수를 [js/app.js](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/js/app.js) 및 [js/config.js](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/js/config.js)에 적용. 모든 화면에서 실제 지정한 사진이 선명하게 로드되도록 조치.
---

## 신규 기능 추가 내역 (2026-06-05)

### 1. 간식 이미지 터치 선택 (+1 수량 조절)
- **개념**: 이용자가 간식 카드 하단의 작은 `+` 버튼을 직접 맞추어 누르기 힘든 발달장애인의 접근성을 보완하기 위해, 간식 카드 상단의 대형 이미지(또는 이모지 영역) 자체를 탭해도 자동으로 수량이 +1씩 늘어나도록 선택 영역을 크게 확장했습니다.
- **구현**: `menu.html` 내의 `.snack-img-container` 요소에 클릭 이벤트 핸들러를 추가 바인딩하고, 판매 중(재고가 남은 경우)일 때 `changeQuantity(snack, 1)`이 트리거되도록 수정했습니다. 기존의 플러스(`+`), 마이너스(`-`) 버튼 기능도 완전히 보존됩니다.

### 2. 주문 확인 화면 내 간식 이미지/이모지 연동
- **개념**: `confirm.html` 화면에서 주문 목록을 단순 텍스트로만 확인해야 하는 한계를 극복하고, 직관적으로 고른 상품이 맞는지 시각적으로 더 쉽게 판별할 수 있도록 간식 이미지 썸네일을 추가했습니다.
- **구현**: 장바구니(`cart`)의 아이템 구조에 `imageUrl` 속성을 함께 보관하도록 결합하고, `confirm.html` 주문서 렌더링 시 이미지 URL이 있는 경우엔 구글 드라이브 썸네일 변환 주소로 이미지(`<img>`)를 출력하며, 없는 경우 이모지 매핑 헬퍼를 사용해 Fallback 이모지를 썸네일 박스 내에 함께 배치했습니다.

### 3. 화면 클릭 시 귀여운 효과음(Audio Feedback) 합성 재생
- **개념**: 발달장애인의 터치 피드백 강화를 위해 진동(햅틱) 효과 외에 청각적으로도 직관적인 피드백을 전달하는 효과음을 추가했습니다.
- **구현**: 기기 내 별도 사운드 파일 다운로드 없이 100% 독립 실행되도록 브라우저 내장 **Web Audio API**를 사용해 맑고 경쾌한 팝음('뾱' 소리)을 JavaScript 코드로 즉석 주파수 합성하여 재생하는 `AppState.playClickSound()`를 추가했습니다.
- **적용**: `js/app.js`에서 body 클릭 이벤트를 일괄 감지하여 버튼, 카드, 카운터 버튼, 이미지 컨테이너 터치 시 자동으로 소리와 진동 피드백이 동시에 방출되도록 설계했습니다.

### 4. 음성 안내(TTS - Text-To-Speech) 토글 및 기능 탑재
- **개념**: 이용자가 자신이 누구를 선택했는지, 어떤 간식을 담았는지 음성으로 읽어주어 인지력을 극대화해 줍니다.
- **구현**:
  - 이름 선택 화면(`index.html`) 헤더 상단 우측 영역에 작고 부드러운 디자인의 **"음성 안내 온오프 토글 스위치"**를 배치했습니다.
  - 토글 설정 값은 `localStorage`에 `ttsEnabled` 키로 안전하게 자동 저장되어 페이지가 넘어가도(간식 선택 화면 등) 세션 내내 설정이 공유 유지됩니다.
  - 이용자 선택 시: `"[이름] 님을 선택했습니다."` 음성 안내.
  - 간식 추가/제거 시: `"[간식명] [수량]개 담았습니다."` 또는 `"[간식명]을 모두 뺐습니다."` 음성 안내.

---

## 작업 목록 및 진행 상황

### [x] 1. 공통 환경 설정 (설계)
- [x] `js/config.js` Google Apps Script API URL 환경설정 및 `USE_MOCK` 제어 플래그 구현
- [x] `js/app.js` 공통 유틸리티 및 `localStorage` 관리 기능 구현
- [x] `css/style.css` 공통 모바일 우선 가독성 디자인 테마 구현 (최소 버튼 높이 48px 이상, 대형 폰트)

### [x] 2. [4단계] 이용자 선택 화면 (`index.html`)
- [x] `getUsers` API 연동
- [x] `imageUrl` 기반 프로필 사진 및 이니셜 원형 아바타 UI 렌더링
- [x] 이용자 별명 카드형 UI 큰 버튼 표시 유지
- [x] 클릭 시 `selectedUser` `localStorage` 저장 및 `menu.html` 이동
- [x] 로딩 상태 및 API 예외 처리 화면

### [x] 3. [5단계] 간식 선택 화면 (`menu.html`)
- [x] 현재 로그인 사용자 정보 및 잔여 크레딧 상단 표시
- [x] `getSnacks` API 연동 및 잔여 재고("남은 수량 X개") 표시
- [x] 품절 간식 어둡게 필터링 및 플러스 버튼 비활성화 (`disabled`)
- [x] 간식별 큰 `+` / `-` 버튼 수량 조절 및 실시간 총 사용 포인트 계산
- [x] 크레딧 및 재고 한도 초과 방지 가드 (⚠️ 경고 메시지 & 햅틱 진동 피드백)
- [x] 하단 고정 주문 버튼 및 `confirm.html` 이동 (`cart` 임시 저장)

### [x] 4. [6단계] 주문 확인 화면 (`confirm.html`)
- [x] `selectedUser`와 `cart` 데이터 기반 최종 주문 리스트 확인
- [x] 예상 잔여 크레딧 계산 및 잔액 부족 시 경고 및 주문 불가 처리
- [x] `placeOrder` API 연동 (POST JSON)
- [x] 주문 실패(재고 부족, 크레딧 부족 등) 시 발달장애인이 읽기 쉽도록 가공된 대형 경고상자 메시지 및 알럿(`alert`) 알림 기능 보완
- [x] 이전으로 / 주문하기 큰 버튼 배치
- [x] 로딩 모달 및 에러 처리 (성공 시 `complete.html` 이동)

### [x] 5. [7단계] 주문 완료 화면 (`complete.html`)
- [x] 주문 완료 메시지 & 잔여 크레딧 크게 표시
- [x] `cart` 클리어
- [x] 5초 후 메인으로 자동 이동 타이머 및 "처음으로" 큰 버튼 제공

### [x] 6. [8단계] 관리자 주문 조회 및 재고 현황 (`admin.html`)
- [x] `getOrdersToday` API 연동 및 오늘 주문 리스트 표시
- [x] 간식별 집계 UI 카드 제공
- [x] 이용자별 집계 UI 카드 제공
- [x] `getSnacks` API를 연동하여 실시간 간식 재고 목록 표시 및 품절 간식 강조
- [x] 30초 자동 새로고침 인디케이터 및 갱신 기능
- [x] 모바일/PC 반응형 대시보드 레이아웃

### [x] 7. PWA 버전 구현 및 아이콘 생성
- [x] PWA용 앱 아이콘 생성 및 `icons/` 폴더에 배치
- [x] `manifest.json` 생성 및 배포
- [x] `service-worker.js` 생성 (오프라인 정적 리소스 캐싱 설계)
- [x] `js/app.js` 내에 서비스 워커 등록 구문 추가
- [x] 모든 HTML 파일의 `<head>` 영역에 manifest 링크 및 iOS 최적화 메타 태그 추가

---

## 프로젝트 파일 구조

```
/ (c:\Users\주간보호\OneDrive\Desktop\새 폴더\kiosk-trainer)
├── index.html            (이용자 선택 화면 - 프로필 이미지/아바타 탑재 및 PWA 메타태그 연동)
├── menu.html             (간식 선택 화면 - 남은 재고 및 품절 차단 로직 적용 및 PWA 메타태그 연동)
├── confirm.html          (주문 확인 화면 - 재고/크레딧 부족 한국어 에러 안내 및 PWA 메타태그 연동)
├── complete.html         (주문 완료 화면 - PWA 메타태그 연동)
├── admin.html            (관리자 오늘 주문 조회 및 간식 실시간 재고 현황 화면 및 PWA 메타태그 연동)
├── manifest.json         (PWA 웹앱 환경 구성 마니페스트 파일)
├── service-worker.js     (정적 자원 오프라인 캐싱 및 구글 API 우회용 서비스 워커)
├── handoff.md            (개발 이력 및 현황 관리 문서 - 최종 업데이트 완료)
├── css/
│   └── style.css         (공통 가독성 향상 UI 스타일링 - 아바타/품절 스타일 추가)
├── icons/
│   ├── icon-192.png      (PWA 192px 앱 아이콘)
│   └── icon-512.png      (PWA 512px 앱 아이콘)
└── js/
    ├── config.js         (Google Apps Script API 및 USE_MOCK 플래그)
    └── app.js            (공통 상태 저장, 진동 제어 및 PWA 서비스 워커 등록 처리)
```
