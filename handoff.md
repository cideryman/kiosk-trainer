# Kiosk Project Handoff Document (For AI Agents)

This document is compiled for AI agents (like Antigravity) to easily grasp the project context, technical architecture, recent updates, and continue working on this repository seamlessly across different environments.

---

## 1. Project Overview & Context
This is a **Progressive Web App (PWA) Kiosk System** designed for adults with developmental disabilities at a day care center.
* **Goal**: Allows users to select their nickname, view items, order snacks using virtual/allocated credits.
* **Aesthetics & Accessibility**: Focuses on large touch areas, speech guidance (TTS), coin/token visuals instead of dry numbers, and strong sensory feedback (haptic vibrations, audio synthesis).
* **Role Types**:
  1. **User (Kiosk)**: Regular users selecting snacks with their credits.
  2. **Admin**: Staff managing orders, updating credits/stocks, toggling sale status, and viewing logs.
  3. **Board (전광판)**: Large screen dashboard to display order preparation status ("Preparing" / "Ready") with sound alerts and TTS announcements.
  4. **Guest**: Visitors/trial users who get a base amount of virtual credits to test the kiosk flow.

---

## 2. Technical Stack
* **Frontend**: Pure HTML5, Vanilla CSS3 (curated custom properties system in `css/style.css`), Vanilla JavaScript. No TailwindCSS, React, or other thick frameworks.
* **Backend**: **Google Apps Script (GAS) Web App** serves as the API gateway and backend controller. 
  - Backend database: **Google Sheets** (contains sheets: `이용자목록`, `간식목록`, `주문내역`, `관리자로그`, `운영설정`, `후기내역`).
  - Access control: API requests containing state modifications (under `ADMIN_ACTIONS`) are protected by an `ADMIN_TOKEN` verification.
* **Offline & PWA Capabilities**: Service Worker (`service-worker.js`) intercepts requests and caches static resources. 4 distinct PWA manifests exist for each mode to support individual standalone installations.

---

## 3. Directory Map & File Structures

```
├── index.html            # User login/selection page
├── menu.html             # Snack selection & cart screen
├── confirm.html          # Order confirmation & receipt review
├── complete.html         # Order completion screen (shows order sequence number)
├── guest.html            # Guest mode login page (contains local review board)
├── guest-orders.html     # Guest active order lookup page
├── board.html            # Order status display board (audio announcements)
├── admin.html            # Administrative dashboard
├── google-apps-script.md # Backup source of Google Apps Script (Code.gs) & instructions
├── handoff.md            # THIS FILE (handoff memory and state status)
├── service-worker.js     # PWA Service worker (handles assets caching & updates)
├── manifest-kiosk.json   # Kiosk app configuration manifest
├── manifest-admin.json   # Admin app configuration manifest
├── manifest-board.json   # Display board app configuration manifest
├── manifest-guest.json   # Guest app configuration manifest
├── css/
│   └── style.css         # Central styling sheet (custom variables, responsive layout)
├── js/
│   ├── config.js         # API endpoint urls, mock mode config, mock database
│   └── app.js            # Common state management, touch jitter handling, audio feedback, TTS
└── icons/                # High-fidelity custom iconography generated for each app mode
```

---

## 4. Database Schema (Google Sheets)
* **`이용자목록` (Users)**: `userId` (ID), `nickname` (Name/Alias), `credit` (Balance), `useYn` (Active flag: Y/N), `imageUrl` (User Photo ID or URL).
* **`간식목록` (Snacks)**: `snackId` (ID), `name` (Name), `point` (Cost), `imageUrl` (Image), `saleYn` (Availability flag: Y/N), `stock` (Inventory, 0 = Sold Out), `displayOrder` (Order in list), `target` (user/guest/both).
* **`주문내역` (Orders)**: `timestamp`, `orderNo` (ID), `userId`, `nickname`, `snackId`, `snackName`, `quantity`, `point` (Cost), `servedYn` (Served status: N/P/R/Y), `cancelTimestamp`, `orderToken`, `deliveryType` (pickup/delivery), `deliveryFee`, `totalCredit`, `reviewed` (Boolean), `deliveryPlace` (Delivery location, Column P).
* **`관리자로그` (Admin Logs)**: Tracks modifications made by administrative accounts for audit.
* **`운영설정` (System Settings)**: System operational metadata.
  - Added `guestDefaultDeliveryPlace` key mapping (defaults to "사무실 원탁") for the guest delivery place defaults.
* **`후기내역` (Reviews)**: Customer reviews / compliments.

---

## 5. Recent Core Modifications & Fixes

### 1) Guest Reviews Inline Expansion (Fix)
* **Issue**: In `guest.html`, clicking the "Show More Reviews" (`#btn-more-reviews`) button caused a redirect to `board.html` (Display Board).
* **Resolution**:
  - Rewrote the review loading and display logic inside [guest.html](file:///c:/Users/user/Desktop/키오스크/guest.html).
  - Toggled reviews visibility inline via the state variables `allReviews`, `showingAllReviews` (initial load limit of `3` reviews).
  - Wired the click listener on `#btn-more-reviews` to block default actions (`e.preventDefault()`) and stop event propagation (`e.stopPropagation()`).
  - Since propagation is stopped (preventing the global `body` click listener from firing), we manually trigger click sound/vibrations via `AppState.playClickSound()` and `AppState.vibrate(40)`.
  - Button toggles between "❤️ 후기 더보기" and "❤️ 후기 접기" dynamically depending on state. It hides automatically if the total review count is 3 or less.

### 2) Multi-PWA Installations
* Unique application scope and ids are mapped via:
  - [manifest-kiosk.json](file:///c:/Users/user/Desktop/키오스크/manifest-kiosk.json)
  - [manifest-admin.json](file:///c:/Users/user/Desktop/키오스크/manifest-admin.json)
  - [manifest-board.json](file:///c:/Users/user/Desktop/키오스크/manifest-board.json)
  - [manifest-guest.json](file:///c:/Users/user/Desktop/키오스크/manifest-guest.json)

### 3) Guest Nickname & Delivery Place Enhancements
* **Random Nickname Generation**:
  - Automatically populates the guest nickname input (`guest.html`) using a random combination rule: `Adjective + 삼각지 + Noun` (e.g. "행복한 삼각지 토끼").
  - Includes an 8% chance to roll a special character nickname: `Adjective + Special Character` (Special characters: "해냄이", "쭉쭉이", "여비").
  - Preserves the nickname across browser reloads using `localStorage` ('guestNickname'), with automatic sync when customized.
  - Blocks ordering if nickname input is empty and displays "닉네임을 입력해 주세요.".
* **Delivery Place Inputs & UI Toggles**:
  - In `confirm.html`, toggles the delivery location input block based on pickup/delivery selection.
  - Pulls default delivery place configuration from Google Sheets settings database (`guestDefaultDeliveryPlace` key, defaulting to "사무실 원탁").
  - Disallows order submissions on blank delivery place inputs.
* **Delivery Location Tracking**:
  - Appends the delivery location into Column P (`deliveryPlace`) of the orders table.
  - Renders the delivery location across order completion tracking page (`complete.html`), guest order history lookup (`guest-orders.html`), and admin boards (`admin.html`).

### 4) Production Readiness & Deployment
* **API Configuration**:
  - Reverted `USE_MOCK = false` in `js/config.js` to ensure the project communicates with the live Google Sheets backend.
* **Google Apps Script Requirement**:
  - The `deliveryPlace` column (Column P) support has been added to the backend. The latest `Code.gs` from `google-apps-script.md` must be copied to the Google Apps Script editor and deployed as a **New Deployment** for the changes to take effect in production.

### 5) "Today's Delivery Team" & Rebranding
* **Guest UI Welcome Messaging & Brand Reorientation**:
  - Pivoted away from "vocational training / mock experience" terminology to a realistic "delivery service" model.
  - Welcome text, name prompts, and credit labels have been updated on `guest.html`:
    - "직업체험 배달 서비스" -> "삼각지 카페 배달 서비스"
    - "체험하실 이름을 적어주세요" -> "주문하실 이름을 적어주세요"
    - "가상 크레딧 10개 무료 지급" -> "신규 방문 크레딧 10개 지급"
* **Operational Control of Today's Delivery Team**:
  - Added a dashboard control panel under `admin.html` to configure:
    - Team visibility toggle, Title (e.g. "📦 오늘의 배달팀"), Members (e.g. "김○○|배달 담당, 박○○|상품 준비 담당"), and Team message.
  - Dynamically renders the delivery team info on the Guest home screen when enabled.
  - Data mapping is dynamically handled using the pre-existing sheet key-value structure under `운영설정` (Settings) tab.

### 6) Code Review Improvements (Latest)
* **GAS Archiving Performance Optimization**:
  - Heavily optimized `archiveOldOrders` in [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md). Replaced the sequential `deleteRow()` and `appendRow()` looping logic (which triggered network timeouts in Google Apps Script when processing multiple history items) with memory-side filtering and a single bulk-write (`setValues`) operation.
* **Admin Refresh Pause on Editing**:
  - Added a global `isModalOpen` state flag in `admin.html` to temporarily pause the 30-second auto-refresh timer when administrative modals are open. 
  - Prevents form data loss and modal closure while editing user credits or snack details. Re-initiates the countdown immediately once modals are dismissed.
* **PWA Service Worker Cache Busting**:
  - Bumped the service worker version in [service-worker.js](file:///c:/Users/user/Desktop/키오스크/service-worker.js) to `kiosk-cache-v63` to force-update client browsers and bypass stale local HTML caches.

### 7) Guest Double-Order Prevention & Cache Issue Resolution
* **Guest Double-Order Prevention**:
  - Implemented client-side detection in `guest.html`: Checks `localStorage` (`guestOrders`) for active orders matching today's date (formatted as `YYYY-M-D`). Shows a warning notice if an active order exists.
  - Implemented server-side check in `placeOrder` (GAS): Uses `guestDeviceId` to scan the active orders list and blocks new orders if there is an active order for the same day.
* **Cache/Past Orders Limit Fix**:
  - Solved issues where cached orders from previous days blocked today's orders.
  - Strictly limited the active order check to the current date (`isSameKoreaDate` on server, local date string comparison on client), ensuring yesterday's or past cached orders do not restrict new orders.

### 8) Guest Review Photo Upload & Admin Photo Moderation
* **GAS Permission Bug Fix**:
  - Removed `uploadImage` from the global `ADMIN_ACTIONS` block (which strictly required an admin token).
  - Moved token validation inside `uploadImage` to run only when `type` is `'user'` or `'snack'`, permitting guest review photo uploads (`type === 'review'`) without credentials.
* **Frontend Error Handlers**:
  - Added user-facing confirm dialog popups for image upload errors in `complete.html` and `guest-orders.html` to prevent silent upload failures.
* **Admin Layout & Moderation Panel**:
  - Redesigned image input layout in `admin.html` (for both add and edit modals) by stacking text URL fields and file selection buttons vertically, resolving the squished oval layout bug.
  - Added a "후기 사진" (Review Photo) column in the admin reviews management table in `admin.html`, letting administrators inspect thumbnails and click to open full-resolution images.
* **Guest Review Scroll Optimizations**:
  - Expanded `.review-list` scroll container max-height in `guest.html` from `320px` to `520px` to display photo cards comfortably.
  - Integrated momentum scrolling (`-webkit-overflow-scrolling: touch`) and custom styled scrollbars for a modern mobile feel.

### 9) Dashboard Separation & Admin Stability Improvements
* **Administrative Dashboard Full Separation**:
  - Extracted the live order board from `admin.html` into a dedicated `kitchen.html` (오늘 주문 운영).
  - Extracted the review moderation board into a dedicated `reviews.html` (후기 관리 화면).
  - `admin.html` (주간매점 관리자 설정) now only handles foundational data like users and snacks.
* **Performance & Stability Optimization**:
  - Fully isolated API calls for each specialized file to prevent freezing: `admin.html` no longer fetches orders or reviews, `kitchen.html` no longer fetches snacks or reviews, etc.
  - Hardened JavaScript execution by adding `null` existence checks (`if (document.getElementById(...))`) before binding `addEventListener` across all admin-facing files, preventing runtime crashes when specific UI panels are absent.
  - Added header navigation buttons across `admin.html`, `kitchen.html`, and `reviews.html` to allow seamless switching between administrative views.
* **Guest Review Viewer Modal**:
  - Added a mobile-optimized modal to `guest.html` that allows guests to click on recent reviews to see them in a larger view.
  - Displays full-resolution photos without cropping, along with messages, tags, and stamps.
  - Includes "Previous" and "Next" navigation buttons to seamlessly browse through all loaded reviews without closing the modal.
  - Stripped out admin-only features (e.g., visibility toggles) to serve as a pure viewer for guests.

### 10) Snack Order Split & "both" Target Removal (Latest)
* **Rationale**: Split user/guest display order configuration to support different marketing/price policies for members and guests, and simplified target management by removing the `both` option.
* **Resolution**:
  - **Tabs Restructuring**: Created a dedicated `tab-snack-order` tab inside [admin.html](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/admin.html) to separate "🛒 일반 키오스크 간식 순서" and "🛵 게스트/배달왔삼 간식 순서" views.
  - **Generalized Order Helpers**: Rewrote display order JS utility functions (`renderSnackOrderPanel`, `moveSnackOrder`, `saveSnackOrderToServer`, `resetSnackOrder`) to accept `target` parameters and route the state updates to the correct list container and database keys.
  - **Admin Table Sub-Grouping**: Grouped snacks in the administrative table into four categories: Active User, Active Guest, Hidden User, and Hidden Guest.
  - **Simplification of Targets**: Removed the `both` option from snack addition and modification modals, default-treating anything non-guest as `user` ("일반").
  - **GAS API Simplification**: Updated `getSnacks`, `canOrderSnack`, `addSnack`, and `updateSnack` inside [google-apps-script.md](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/google-apps-script.md) to restrict database target fields exclusively to either `user` or `guest`, avoiding logical overlap.

---

## 6. Implementation Notes & Cautions

* **API Calls & Mocks**: While developing locally, you can switch between mock database and live spreadsheet database in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) using the `USE_MOCK` boolean value.
* **Touch Jitter (Double-Click Prevention)**: Users with motor control challenges might trigger duplicate clicks. Use `AppState.bindCardTap(el, callback)` instead of standard click handlers for critical buttons in user-facing views to check coordinates delta and timing.
* **Debugging Frontend Errors**: In case of screen freezing, non-responsive buttons, or general UI errors, do not debug blindly. Ask the user to check the developer console (F12) and share the console error log/stack trace. This is the fastest way to identify the exact line of syntax or runtime errors.
* **Haptic Feedbacks**: Sounds are created using the Web Audio API synthesizer dynamically. Do not rely on external MP3 files for general interaction sounds.
* **Google Apps Script Deployments**: If you modify the backend API routes or settings, copy code from [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md) into the Google Sheet Script Editor, save, and trigger **[New Deployment]** (Web App, executing as Me, accessible by Anyone). Update `API_URL` in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) to match the new address.

---

## 6.1 Active Stability Follow-Up (2026-06-21)

These items are ordered by operational risk. Do not redo completed items unless a regression is observed.

* **[DONE / DEPLOYED 2026-06-21] P1 - Backend error handling and copy-safe GAS source**: `google-apps-script.md` is raw JavaScript and can be copied with Ctrl+A directly into Apps Script. The deployed backend wraps `doPost` in a top-level failure response and routes admin audit writes through `safeAppendAdminLog`, so a logging failure does not make an already-applied admin change appear failed. Verification completed with `getUsers&includeInactive=Y`, `getSnacks&includeHidden=Y`, and a malformed no-op POST returning a JSON failure response.
* **[DONE 2026-06-21] P2 - Admin/kitchen/reviews maintenance cleanup**: Removed stale user/snack management JavaScript from `kitchen.html` and stale order/user/snack/guest-ops JavaScript from `reviews.html`, leaving `admin.html` as the dedicated user/snack management surface. The current top-position "신규 이용자 등록" and "신규 간식 등록" buttons in `admin.html` are intentional and should remain. Verification completed with inline-script parse checks for `kitchen.html` and `reviews.html`, plus stale management-reference searches.
  - **Why this was done**: After the admin screens were split, old copied management code remained in secondary pages. It was not visible in the UI, but it made future maintenance risky because a later handoff worker could patch the wrong copy, revive removed modal/tab assumptions, or accidentally expand the admin action surface in a screen that should only handle its own job.
  - **Exact cleanup rule used**: `admin.html` owns user/snack/credit/sale-state management. `kitchen.html` owns order processing, today-summary, CSV download, old-order archive, refresh pause, and guest order settings. `reviews.html` owns review list/detail/visibility moderation only.
  - **What was intentionally kept**: `kitchen.html` still fetches users for order avatar/name mapping and reviews for the today summary. These are read/display dependencies, not user/review-management UI. Guest-order controls also remain in `kitchen.html` because they are operational controls for the kitchen/admin workflow.
  - **What was intentionally not changed**: Broad CSS cleanup was avoided because unused styles are lower risk than accidental visual regressions. If a future pass removes CSS, verify the three admin pages visually before deployment.
  - **How to verify again**: Run inline-script parse checks for `kitchen.html` and `reviews.html`, then search those files for stale management names such as `modal-add-user`, `renderUsersManagement`, `renderSnacksManagement`, `renderSnackOrderPanel`, `updateUserCredit`, `updateSnackStock`, `currentSnacks`, `showUserApiWarningIfNeeded`, and `switchTab`. Smoke-test kitchen order buttons/CSV/archive/refresh pause/guest settings and review list/detail/visibility toggle.
  - **Do not restore by copy-paste**: If a removed function is needed again, rebuild it in the proper owner screen or a small shared helper. Do not copy the old all-in-one admin blocks back into `kitchen.html` or `reviews.html`.
* **P3 - Touch tolerance and local syntax helper**: AppState.bindCardTap has been tuned for users with less precise touch control. Real-device testing should check that scrolling the snack grid does not accidentally add items. `check_syntax.js` is a local helper for extracting/checking the GAS backup and is not part of the deployed kiosk runtime.
* **[DONE 2026-06-21] P4 - Guest Closed Screen Layout Improvements**: Replaced the padlock emoji with a mascot character image (`assets/closed-character.png`), removed redundant welcome/closed messages (`#guide-text-main`) in non-operating state, and hid the "Today's Delivery Team" section (`#today-delivery-team-section`) when closed to prevent confusion and clean up the visual layout.

---

## 7. Future Roadmaps & Considerations (다음 작업 고려 목록)

* **[RESOLVED] Review Visibility Toggle Error**:
  - **Problem**: Clicking the public/private visibility toggle on the review moderation page (`reviews.html`) triggered a "구글시트 연결에 실패했습니다" (failed to connect to google sheet) popup error.
  - **Resolution**: Fixed in [google-apps-script.md](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/google-apps-script.md) by correcting the backend typo where it called `verifyAdmin` instead of `verifyAdminToken(data)`, and added `'toggleReviewVisibility'` to the `ADMIN_ACTIONS` routing whitelist array.

* **[RESOLVED & PENDING MANUAL VERIFICATION] 제안 2) 유휴 시간 감지 자동 로그아웃 (Idle Timeout)**:
  - **내용**: `menu.html`, `confirm.html` 등에서 70초간 터치 이벤트가 없을 시 자동으로 카트와 유저 세션을 리셋하고 처음 화면(`index.html`/`guest.html`)으로 복귀하도록 유휴 타이머 적용. 10초 전 화면이 어두워지며 TTS 음성 경고 송출 및 3초 전 매초 비프/진동 피드백.
  - **상태**: 구현 완료. 다음 주에 **수동 검증** 필요. 상세 가이드 및 검증용 체크리스트는 [walkthrough.md](file:///C:/Users/sec/.gemini/antigravity-ide/brain/1f8a4c8e-ae3e-4bea-abb0-7a270860dddb/walkthrough.md) 문서 참조.

* **[ROADMAP] 제안 3) 오프라인 상태 대응 전면 안내 팝업**:
  - **내용**: `window.addEventListener('offline')` 연동. 인터넷이 일시 단절될 경우 브라우저 에러창이나 정지 대신 친근한 안내 팝업과 캐릭터 일러스트, 안내 TTS를 제공하여 발달장애 이용자의 심리적 불안 최소화. 복구 시 자동 복귀.

* **[IDEA] 제안 4) 게스트 모드(봉사자/후원자용) 카카오톡/네이버 소셜 로그인 연동**:
  - **내용**: 외부 봉사자나 후원자가 `guest.html`을 통해 주문할 때, 무작게 닉네임으로 인해 음료 미수령 및 주문자 식별 곤란 문제가 발생하는 상황을 해결하기 위한 아이디어입니다.
  - **상세**: 개인 모바일 기기로 주문을 진행하는 게스트 모드에 한하여 카카오톡/네이버 로그인 API(OAuth 2.0)를 연동하고, 사용자 인증 완료 시 프로필 API로부터 실명(진짜 이름)을 강제 수집해 주문자명에 매핑합니다. 이를 통해 배달/수령 오배송 실수를 방지할 수 있습니다. (공용 키오스크 태블릿의 경우 자동 로그인 세션 유지 문제 및 패스워드 입력의 복잡성으로 인해 도입하지 않는 방향이 안전합니다.)
  - **도입 시 다방면의 코드 수정 필요 사항**:
    1. **로그인 플로우 개편 (`guest.html` & `js/app.js`)**:
       * 기존 무작위 닉네임 생성 및 로컬 저장소 캐싱 로직을 소셜 로그인 링크 버튼으로 대체합니다.
       * 리다이렉트 URI로부터 유입되는 `code` 파라미터를 읽어 GAS 백엔드로 전송하는 인증 확인 프로세스를 구성합니다.
       * 반환된 소셜 ID(`socialId`), 이름(`realName`), 접근 토큰을 `localStorage`에 세션 정보로 유지합니다.
    2. **주문 접수 로직 (`confirm.html` & `complete.html`)**:
       * 주문 생성 시 기존의 고정값 `'guest'` 대신 사용자의 고유 소셜 ID(예: `kakao_12345`)를 `userId` 필드에 바인딩하여 전송합니다.
       * 주문자 이름은 소셜 계정의 실명(`realName`)을 그대로 매핑하여 전달합니다.
    3. **내 주문 조회 (`guest-orders.html`)**:
       * 기존의 로컬스토리지 닉네임 매칭 방식 대신, 로그인 상태인 사용자의 고유 소셜 ID(`socialId`)를 기반으로 백엔드에서 주문 내역을 필터링하도록 쿼리를 수정합니다. 기기가 리셋되거나 다른 브라우저로 재접속하더라도 로그인 시 주문 내역이 즉각 보존되는 이점이 생깁니다.
    4. **후기 작성 및 조회 (`guest.html`)**:
       * 후기 제출 시 닉네임을 임의로 입력하는 절차를 삭제하고, 현재 로그인된 소셜 계정의 실명(`realName`) 및 소셜 ID를 자동으로 삽입하여 `후기내역` 시트에 등록하도록 개선합니다.
    5. **구글 앱스 스크립트 백엔드 API (`google-apps-script.md`)**:
       * `exchangeOAuthToken` 액션을 신설하여 카카오/네이버 토큰 교환 및 프로필 정보(식별ID, 실명) 획득용 외부 HTTP 호출(`UrlFetchApp.fetch()`) 로직을 추가합니다.
       * 기존 주문 내역 조회 함수(`getOrdersToday`) 혹은 별도 게스트 주문 전용 함수를 확장하여, 전달받은 `socialId`와 일치하는 주문 데이터만 선별 리턴하도록 보안 및 집계 코드를 수정합니다.
       * 외부 소셜 가입자 데이터를 관리자 대시보드와 유기적으로 매핑하여 인지할 수 있도록 `이용자목록` 시트에 소셜 회원 구분 플래그 컬럼 작성이 수반됩니다.

---

## 8. 금일 추가된 3대 기능 수동 검증 절차 (Manual Verification Checklist)

오늘 구현된 세 가지 기능(오늘의 운영 결과 모달, 배송지별 배달 체크리스트 인쇄, 3열 주문 목록 그룹화 및 컬럼별 일괄 처리)은 시스템 운영의 안정성과 직관성을 검증하기 위해 다음과 같이 수동 검증을 진행해 주세요.

### 1) 오늘의 운영 결과 모달 수동 검증
* **검증 대상**: `kitchen.html` (오늘 주문 운영 화면)
* **검증 순서**:
  1. `kitchen.html` 화면에 접속합니다.
  2. 우측 상단 헤더 영역에서 `📊 오늘의 운영 결과` 버튼을 클릭합니다.
  3. **로딩 화면 확인**: 모달이 열리면서 "오늘의 집계 데이터를 분석하고 있습니다..." 문구와 함께 회전하는 로딩 스피너가 표시되는지 확인합니다.
  4. **주문 데이터 정합성 확인**:
     * 총 주문 건수, 총 차감 크레딧이 오늘 기록된 주문 정보와 일치하는지 확인합니다.
     * `🥡 키오스크 주문`, `📱 배달왔삼 포장`, `🛵 배달왔삼 배달` 건수가 각각 올바르게 필터링되어 구분 집계되는지 확인합니다. (완료 건수와 취소 건수의 상태 분류도 맞는지 대조합니다.)
  5. **후기 및 태그 통계 확인**:
     * 오늘 작성된 후기 목록을 불러와 총 후기 건수와 사진이 포함된 후기 건수가 일치하는지 확인합니다.
     * 오늘 작성된 후기의 태그들(예: 맛있어요, 달콤해요 등)의 사용 빈도가 높은 순서대로 파스텔톤 태그 배지로 가시화되는지 확인합니다.
  6. **텍스트 클립보드 복사 검증**:
     * 모달 하단의 `📋 결과 요약 복사하기` 버튼을 클릭합니다.
     * 브라우저에서 복사 완료 알림(얼럿)이 뜨는지 확인합니다.
     * 메모장(notepad)이나 카카오톡 대화창에 `Ctrl+V`를 눌러 아래와 같은 요약 문구가 정상적으로 붙여넣기 되는지 확인합니다:
       ```
       📢 [오늘의 운영 결과 요약]
       - 날짜: YYYY년 MM월 DD일 요일
       - 총 주문: X건 (키오스크: A건 / 배달왔삼 포장: B건 / 배달왔삼 배달: C건)
       - 주문 상태: 완료 Y건 / 취소 Z건
       - 총 차감 크레딧: W 크레딧
       - 오늘 후기: H건 (사진 후기: P건)
       - 후기 태그: 맛있어요 X개 / 친절해요 Y개 ...
       ```

### 2) 배송지별 배달 체크리스트 인쇄 수동 검증
* **검증 대상**: `print-bills.html` (빌지 인쇄 화면)
* **검증 준비**: 테스트용으로 배달지(`deliveryPlace`)가 입력된 guest 배달 주문(`deliveryType === 'delivery'`)이 1건 이상 대기 중인 상태여야 합니다.
* **검증 순서**:
  1. `kitchen.html` 우측 상단 헤더에서 `🖨️ 빌지 인쇄` 버튼을 클릭하여 `print-bills.html` 창을 새 탭으로 엽니다.
  2. **체크리스트 표시 여부 확인**:
     * 배달 주문이 존재할 경우, 화면 하단에 `📦 배송지별 배달 체크리스트` 섹션이 표시되는지 확인합니다. (배달 주문이 전혀 없으면 이 섹션이 아예 렌더링되지 않고 숨겨집니다.)
  3. **그룹화 및 내용 확인**:
     * 배달 주문들이 배송지 이름(예: `사무실 원탁`, `주간보호실 A` 등)을 기준으로 헤더 아래에 묶여 그룹화되어 있는지 확인합니다. 배송지가 없을 경우 `배송지 미입력` 헤더로 묶여야 합니다.
     * 테이블에 체크용 체크박스, 짧은 주문번호(예: `[005]`), 주문자 닉네임, 주문 메뉴명, 수량이 누락 없이 정상 표시되는지 확인합니다.
  4. **인쇄 레이아웃 제어(페이지 분리) 검증**:
     * 브라우저에서 인쇄 단축키 `Ctrl+P`를 누릅니다.
     * **인쇄 미리보기 화면**을 확인합니다.
     * 개별 빌지 카드 인쇄 영역이 끝난 후, **체크리스트 섹션이 반드시 새로운 A4 페이지(페이지 경계선 다음 페이지)에서 단독으로 시작하는지** 확인합니다. (CSS `page-break-before: always` 속성이 인쇄물에서 정상 작동하는지 확인하는 핵심 단계입니다.)

### 3) 3열 주문 목록 그룹화 및 컬럼별 일괄 처리 수동 검증
* **검증 대상**: `kitchen.html` (오늘 주문 운영 화면)
* **검증 준비**:
  * 일반 회원 로그인 후 매점 메뉴에서 주문을 넣어 **일반 키오스크 주문**을 생성합니다.
  * 게스트 로그인 후 **배달왔삼 포장**("포장 수령" 체크)으로 주문을 생성합니다.
  * 게스트 로그인 후 **배달왔삼 배달**("배달 서비스 이용" 체크 및 배송지 입력)로 주문을 생성합니다.
* **검증 순서**:
  1. **3열 독립 배치 레이아웃 검증**:
     * 대기 중인 주문들이 다음의 세 가지 열로 깔끔하게 나뉘어 정렬되어 표시되는지 확인합니다:
       * `🥡 키오스크 주문` (일반 회원 주문)
       * `📱 배달왔삼 포장` (게스트 포장 주문)
       * `🛵 배달왔삼 배달` (게스트 배달 주문)
     * PC 해상도(가로 1024px 이상)에서는 3개 열이 좌우로 나란히(3컬럼 Grid) 배치되는지 확인합니다.
     * 모바일 기기나 좁은 브라우저(가로 768px 미만)에서는 3개 열이 세로로 차례대로 쌓여 1열로 표시되는지 확인합니다.
  2. **컬럼별 실시간 건수 배지 확인**:
     * 각 열의 제목 우측에 해당 열에 들어있는 대기 건수 배지(예: `2건`, `0건` 등)가 정상적으로 표시되며 실시간으로 변경되는지 확인합니다.
  3. **컬럼별 일괄 처리 기능 확인**:
     * 과거의 단일 글로벌 일괄 처리 바가 사라지고, **각 열 헤더 바로 아래에 독립적인 일괄 처리 컨트롤 바**가 존재하는지 확인합니다.
     * **선택 제공 검증**: `🥡 키오스크 주문` 열 내부의 특정 주문 카드들의 "이 주문 선택" 체크박스를 선택합니다. 이 과정에서 오직 키오스크 열 내부의 `[선택 제공]` 버튼만 활성화되고, 선택된 주문 개수가 표시되는지 확인합니다. 다른 두 열의 버튼은 비활성화 상태여야 합니다. `[선택 제공]` 버튼을 클릭해 정상 완료 처리되는지 봅니다.
     * **모두 제공 검증**: `🛵 배달왔삼 배달` 열 헤더의 `[모두 제공]` 버튼을 클릭합니다. 해당 열에 있는 대기 주문들 전체가 일괄 선택되어 제공 완료(Y) 상태로 바뀌는지 검증합니다. 이때 다른 두 열의 대기 주문들은 완료 처리되지 않고 대기 상태로 그대로 유지되어야 합니다.

