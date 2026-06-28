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
  - Backend database: **Google Sheets** (contains sheets: `이용자목록`, `간식목록`, `주문내역`, `관리자로그`, `운영설정`, `후기내역`, `게스트프로필`, `게스트크레딧`, `주문보관`).
  - Access control: API requests containing state modifications (under `ADMIN_ACTIONS`) are protected by an `ADMIN_TOKEN` verification.
* **Offline & PWA Capabilities**: Service Worker (`service-worker.js`) intercepts requests and caches static resources. 6 distinct PWA manifests exist for each mode to support individual standalone installations.

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
├── admin.html            # Foundational admin dashboard for users/snacks/order display settings
├── kitchen.html          # Live order operations, guest operations, CSV/archive, print links
├── reviews.html          # Review moderation and visibility management
├── print-bills.html      # Printable order bills and delivery-place checklist
├── google-apps-script.md # Backup source of Google Apps Script (Code.gs) & instructions
├── handoff.md            # THIS FILE (handoff memory and state status)
├── service-worker.js     # PWA Service worker (handles assets caching & updates)
├── manifest-kiosk.json   # Kiosk app configuration manifest
├── manifest-admin.json   # Admin app configuration manifest
├── manifest-kitchen.json # Kitchen/operations app configuration manifest
├── manifest-reviews.json # Review moderation app configuration manifest
├── manifest-board.json   # Display board app configuration manifest
├── manifest-guest.json   # Guest app configuration manifest
├── sounds/
│   └── new-order.mp3     # Custom new-order voice/audio cue for operations screens
├── assets/               # Banners, closed/offline illustrations, logos
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
* **`간식목록` (Snacks)**: `snackId` (ID), `name` (Name), `point` (Cost), `imageUrl` (Image), `saleYn` (Availability flag: Y/N), `stock` (Inventory, 0 = Sold Out), `displayOrder` (Order in list), `target` (user/guest only; `both` has been removed).
* **`주문내역` (Orders)**: `timestamp`, `orderNo` (ID), `userId`, `nickname`, `snackId`, `snackName`, `quantity`, `point` (Cost), `servedYn` (N/P/R/Y/C), `cancelTimestamp`, `orderToken`, `deliveryType` (pickup/delivery), `deliveryFee`, `totalCredit`, `reviewed` (Boolean), `deliveryPlace` (Column P), `guestDeviceId`, `authProvider`, `guestKey`, plus cancellation reason/detail fields used by current backend archival/export flows.
* **`관리자로그` (Admin Logs)**: Tracks modifications made by administrative accounts for audit.
* **`운영설정` (System Settings)**: System operational metadata.
  - Added `guestDefaultDeliveryPlace` key mapping (defaults to "사무실 원탁") for the guest delivery place defaults.
* **`후기내역` (Reviews)**: Customer reviews / compliments, including optional `imageUrl` and `useYn` visibility state.
* **`게스트프로필` (Guest Profiles)**: Optional remembered display name and delivery place for Kakao-connected guests who explicitly check the remember option.
* **`게스트크레딧` (Guest Credits)**: Daily guest credit wallet keyed by `periodKey`, `guestDeviceId`, and optional Kakao `guestKey`.

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

### 3) Guest Display Name & Delivery Place Enhancements
* **Order Display Name Input**:
  - The guest display-name input (`guest.html`) now starts empty and asks the user to enter an easy-to-call display name.
  - The random nickname generator remains available only through the `랜덤 이름 쓰기` button, using the existing `Adjective + 삼각지 + Noun` rule and the 8% special-name roll.
  - `guestNickname` localStorage auto-fill/sync is intentionally no longer used, so returning visitors are not forced into an old random nickname.
  - Blocks ordering if the display-name input is empty and displays "주문표시명을 입력해 주세요.".
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

### 10) Snack Order Split & "both" Target Removal
* **Rationale**: Split user/guest display order configuration to support different marketing/price policies for members and guests, and simplified target management by removing the `both` option.
* **Resolution**:
  - **Tabs Restructuring**: Created a dedicated `tab-snack-order` tab inside [admin.html](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/admin.html) to separate "🛒 일반 키오스크 간식 순서" and "🛵 게스트/배달왔삼 간식 순서" views.
  - **Generalized Order Helpers**: Rewrote display order JS utility functions (`renderSnackOrderPanel`, `moveSnackOrder`, `saveSnackOrderToServer`, `resetSnackOrder`) to accept `target` parameters and route the state updates to the correct list container and database keys.
  - **Admin Table Sub-Grouping**: Grouped snacks in the administrative table into four categories: Active User, Active Guest, Hidden User, and Hidden Guest.
  - **Simplification of Targets**: Removed the `both` option from snack addition and modification modals, default-treating anything non-guest as `user` ("일반").
  - **GAS API Simplification**: Updated `getSnacks`, `canOrderSnack`, `addSnack`, and `updateSnack` inside [google-apps-script.md](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/google-apps-script.md) to restrict database target fields exclusively to either `user` or `guest`, avoiding logical overlap.

### 11) Kitchen UI Layout & Clipping Fix (Latest)
* **Issue**: On screen widths >= 768px and >= 1024px, the main kitchen management area (`kitchen.html`) layout became extremely squished and clipped on the right. This was because the `.kiosk-container` had a strict `max-width: 960px` constraint, the sidebar grid split the width `2fr 1fr`, and the three order columns inside `.admin-main` tried to fit horizontally. Each card's header (`.user-profile-header`) had elements in a single line with large text and badges, causing the minimum width to exceed the allocated space and get cut off due to `overflow: hidden`.
* **Resolution**:
  - Expanded `.kiosk-container`'s widescreen maximum width inside `kitchen.html` to `1400px` (or `95%` width), utilizing desktop/tablet widescreen monitors.
  - Reduced layout gap of `.orders-split-layout` from `24px` to `16px`.
  - Compacted `.user-order-card` layout by reducing padding to `16px` and gap to `10px`.
  - Added `flex-wrap: wrap` and reduced gap (`8px`) in `.user-profile-header` to stack elements gracefully when narrow.
  - Reduced font sizes: `.user-name` (from `22px` to `18px`), `.order-time-badge` (from `14px` to `13px`), and card action buttons (from `18px` to `16px`).
  - Removed fixed `margin-left` offsets from status and delivery badges to guarantee clean flex-wrap alignments.

### 12) Optimistic UI Updates with Defensive Revert (Latest)
* **Issue**: Transitioning orders to the next state (e.g. Preparing ➔ Complete) required sequential network API calls, blocking the UI and forcing a full refresh (`loadAdminData`) which took ~1s per click. This made processing multiple orders very slow and annoying.
* **Resolution**:
  - Implemented client-side **Optimistic Updates** in `updateStatusAction` and `undoCompleteOrder` in `kitchen.html`.
  - Clicked cards transition instantly on the client UI in `0.01s` (updating status and buttons), playing audio/vibration feedback immediately.
  - Added `pendingUpdates` (a global JS `Map`) to track in-flight order updates by `orderNo`.
  - Overrode server-returned order states inside `renderData` if they are present in `pendingUpdates` to prevent race conditions during auto-refresh intervals.
  - Integrated robust `rollbackLocalOrders` error handlers to revert cards back to their original states if the server request fails.

### 13) GAS Sequence Generation Bug Fix (Latest)
* **Issue**: All test orders placed by the user got stuck with the sequence number `007` (e.g. `ORD-260622-007`), causing them to merge under a single card on the kitchen screen. This was because order sequence numbers were calculated using the number of unique order IDs today (`uniqueOrderNos.length + 1`). If a middle sequence number (like `005`) was deleted from the sheet, the count remained at `6` instead of matching the highest ID `7`. This created a constant sequence number conflict of `7`.
* **Resolution**:
  - Modified sequence generation in `google-apps-script.md` (`placeOrder`) and `js/config.js` (mock implementation) to scan today's orders, parse the sequence part, find the **maximum** number (`maxSeq`), and increment it by 1 (`maxSeq + 1`).
  - This guarantees unique, monotonically increasing order numbers even when rows are deleted or missing.

### 14) Guest Order Display Name & Optional Kakao Link (Latest)
* **Decision**: Do not collect real name, email, phone number, Kakao shipping address, or delivery presets. Kakao is optional, improves "find my order" across devices, and can remember the last display name/delivery place only after an explicit optional checkbox.
* **Resolution**:
  - `guest.html` now starts the order display-name field empty and asks for an easy-to-call display name. The old random nickname generator remains only as the `랜덤 이름 쓰기` button.
  - `AppState` stores optional `guestAuth = { provider: 'kakao', guestKey, authenticatedAt }`. `resetAll()` intentionally does not clear this link.
  - `confirm.html` keeps `userId: 'guest'` and sends `authProvider/guestKey` only when Kakao is connected, preserving guest pricing, delivery fee, kitchen grouping, and duplicate-order behavior.
  - `guest-orders.html` keeps token-based lookup and additionally calls `getGuestOrdersByGuestKey` for connected Kakao users, limited to today's guest orders.
  - `google-apps-script.md` adds `getKakaoLoginConfig`, `exchangeKakaoAuthCode`, and `getGuestOrdersByGuestKey`. Kakao raw IDs and tokens are not stored; raw Kakao ID is converted to `guestKey` with `KAKAO_GUEST_KEY_SALT`.
  - `주문내역` keeps A~R fixed and appends `guestDeviceId`, `authProvider`, `guestKey` after the existing order columns. `후기내역` is unchanged.
  - `게스트프로필` stores `guestKey`, `displayName`, `deliveryPlace`, `updatedAt` only when the user checks the optional remember box on `confirm.html`. It is not auto-saved by Kakao login alone. `guest.html` can load this profile for auto-fill and provides a `저장 정보 삭제` button.
  - `게스트크레딧` stores a daily wallet for guest orders. The current policy is daily reset by `periodKey` (`yyyy-MM-dd`), base guest credit plus Kakao login bonus 2 credits. Matching is by same `guestDeviceId` or same Kakao `guestKey`; when a Kakao account is used on multiple devices, the wallet keeps the linked device IDs so logging out on a linked device does not create a fresh daily allowance.
  - `guest.html` shows the `카카오톡 로그인` button with a small `로그인 시 +2 크레딧` badge and loads `getGuestCreditStatus` before starting an order. `confirm.html` refreshes server-side remaining credit and uses `placeOrder.afterCredit` after submission.
  - Guest credit refunds are tied into admin/user cancellation paths. For guest orders, cancellation restores the daily wallet usage as well as snack stock.
  - The old "block new orders while an active guest order exists" policy is no longer exposed in `kitchen.html` and the guest home no longer performs local active-order blocking. The backend guard remains available only as a hidden sheet-level safety switch. `getGuestSettings()` migrates legacy `guestAllowMultipleOrders=FALSE` to `TRUE` once by adding `guestOrderLimitPolicyVersion=creditWalletV1`, so current operations default to the daily-credit-wallet policy.
* **Kakao Guest Profile Bypass & Edit (Latest)**:
  - **Rationale**: Regular Kakao guest users were forced to go through the name-entry screen (`view-input`) and click "시작하기" every time they ordered, even if they had a saved profile. This created unnecessary friction.
  - **Resolution**:
    - **Name-Entry Bypass**: If a guest has a saved profile (nickname and optional delivery address), clicking **"새 주문하기"** will automatically bypass the name-entry view and transition directly to the menu page (`menu.html`).
    - **Homepage Profile Card**: Created a new `#kakao-profile-card` block inside `#kakao-auth-panel` on the guest home screen. It displays the saved user's name and default delivery address, along with an **"프로필 수정" (Edit Profile)** button.
    - **Profile Editing Modal**: Appended `#guest-profile-edit-modal` (styled using the central `.guest-modal` CSS layout). Users can edit their nickname and default delivery location directly from the home screen, updating the profile instantly.
    - **Backend API & Local Mock**: Implemented `updateGuestProfileByGuestKey` in the Google Apps Script backend ([google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md)) and its mock equivalent in `js/config.js` to save edits immediately.
    - **Layout Improvements**: Organized the "카카오 로그아웃" and "저장 정보 삭제" buttons side-by-side inside `#kakao-auth-panel` when logged in to save vertical space.
  - **Encountered Issue & Resolution**:
    - During code injection in `guest.html`, a typo introduced a duplicate `});` closing block at the end of the `btnGpeSave` event handler. The syntax check command `node --check` flag caught it immediately, and it was quickly resolved.
  - **Follow-up Review 2026-06-25**:
    - A later review found that `guest.html` still had a malformed inline script in the same profile-edit area: the `if (btnGpeSave) { ... }` block was missing its final closing brace, causing `Unexpected token ')'` and preventing the guest page script from loading. Fixed by adding the missing brace and bumping `service-worker.js` to `kiosk-cache-v84`.
    - GAS profile editing was also aligned with the local mock. In `updateGuestProfileByGuestKey`, an intentionally blank delivery-place field now clears the saved default delivery place. Ordinary order-time profile saving still preserves the previous delivery place when a pickup order has no delivery address.
* **Code Verification**:
  - Passed `node --check js/config.js`, `node --check js/app.js`, `node --check service-worker.js`, `git diff --check`, HTML inline script parsing for `guest.html`/`guest-orders.html`/`confirm.html`/`admin.html`/`reviews.html`, and JavaScript parsing of `google-apps-script.md` (via `check_syntax.js`).
  - Follow-up verification 2026-06-25 additionally passed inline script parsing for `guest.html`/`guest-orders.html`/`confirm.html`/`admin.html`/`reviews.html`/`kitchen.html`/`board.html`, `node --check js/config.js`, `node --check js/app.js`, `node --check service-worker.js`, and direct JavaScript parsing of `google-apps-script.md` without writing to `temp.js`.
  - Runtime verification still requires Kakao Redirect URI setup, Apps Script Properties, copying `google-apps-script.md` into GAS, and a new GAS deployment.

### 15) 게스트 화면 카카오톡 로그인 UI/UX 개선 및 영업 상태 자동 동기화
* **카카오 로그인 정보 상단 이전**:
  * 로그인 성공 시 기존 화면 중앙의 크고 넓은 노란색 카드 패널(`#kakao-auth-panel`)을 숨기고, 배달왔삼 로고 바로 아래 가로형 미니 프로필 바(`#kakao-logged-in-header`)를 노출시켜 하단의 새 주문하기 등의 중요 버튼이 스크롤 아래로 밀리는 모바일 화면 가독성 문제를 대폭 개선함.
  * 프로필 바 좌측에는 사용자 닉네임과 남은 크레딧 정보를, 우측에는 ⚙️(정보 수정) 및 🚪(로그아웃) 아이콘 버튼을 배치하여 화면 공간을 절약하고 일반 모바일 앱 수준의 고품질 UX를 제공함.
* **정보 수정 모달 내 기능 통합**:
  * 정보 수정 모달(`#guest-profile-edit-modal`) 내에 보유 중인 남은 크레딧 정보와 기존 메인 화면에 크게 노출되었던 **"브라우저에 저장된 정보 삭제하기(개인정보 파기)"** 링크 버튼을 모달 하단으로 옮겨 통합함.
  * 정보 삭제 및 수정 완료 시 모달 창이 자동으로 닫히도록 개선하여 메인화면 UI의 완성도를 크게 향상시킴.
* **Page Visibility API 기반 자동 동기화 및 수동 새로고침 추가**:
  * PWA 환경에서 앱을 켜두었다가 다시 활성화(화면 보기)할 때 `visibilitychange` 이벤트를 감지하여 최신 영업 상태(`loadSettings`), 남은 크레딧, 프로필 정보를 자동으로 서버와 동기화시킴.
  * 비운영 마감 카드(`#guest-closed-notice`) 내에 `🔄 상태 새로고침` 수동 버튼을 추가하여 필요 시 수동으로 동기화 조회가 가능하도록 함.

### 16) 관리자 간식 순서 변경(드래그 앤 드롭) 다회 작동 문제 해결
* **이슈**: `admin.html`에서 간식 순서 변경(드래그 앤 드롭 또는 ▲▼ 버튼 클릭) 시, 동적으로 생성되는 새로운 간식 아이템 요소(`snack-order-item`)에 드래그 관련 이벤트 리스너가 다시 등록되지 않아 드래그 앤 드롭이 한 번만 동작하고 이후 멈추는 현상이 존재했습니다.
* **해결**:
  - `saveSnackOrderToServer` 함수에서 서버 전송 및 메모리 업데이트가 성공적으로 끝난 뒤, 이벤트 리스너가 온전히 구현되어 있는 `renderSnackOrderPanel` 함수를 재호출하도록 수정하였습니다.
  - 이를 통해 새로 바인딩된 DOM 요소에서도 드래그 앤 드롭이 영구적으로 연속 동작하도록 보장하였습니다.
  - 정적 파일 캐시 갱신을 위해 `service-worker.js` 버전을 `kiosk-cache-v85`로 업데이트하였습니다.

### 17) 메뉴 이름 짤림 문제 해결 및 게스트 단가 표시 개선 (최근)
* **메뉴명 텍스트 잘림 해결**:
  - `css/style.css` 내 `.snack-name`에서 `word-break: keep-all;` 설정을 `break-all`로 수정하고 글자 크기(`font-size`)를 `22px`에서 `20px`로 소폭 축소했습니다.
  - 이를 통해 '아이스말차바닐라라떼'처럼 공백이 없는 긴 메뉴명이 카드 레이아웃 바깥으로 삐져나가거나 잘리지 않고 글자 단위로 알맞게 두 줄 이내 줄바꿈이 이루어지도록 조치했습니다.
* **게스트 단가 표시 이모지 정리**:
  - `menu.html` 및 `confirm.html`에서 게스트 모드로 상품 단가를 렌더링할 때 돈주머니(`💰`) 기호를 제거하여 화폐 단위 기호인 `🪙`와 통일감이 들도록 `단가 4🪙` 형태로 간결화했습니다.
  - 변경된 정적 리소스를 강제 캐시 갱신시키기 위해 `service-worker.js` 버전을 `kiosk-cache-v86`으로 업데이트하였습니다.

### 18) Codex code review and handoff sync (2026-06-26)
* **Verification performed**:
  - `node --check js/app.js`, `node --check js/config.js`, and `node --check service-worker.js` passed.
  - Inline script parsing passed for `index.html`, `menu.html`, `confirm.html`, `complete.html`, `guest.html`, `guest-orders.html`, `board.html`, `admin.html`, `kitchen.html`, `reviews.html`, and `print-bills.html`.
  - `google-apps-script.md` JavaScript parsing passed without writing to `temp.js`.
  - HTML static reference scan passed for local `src`/`href` references.
  - `git diff --check` passed.
* **Small code corrections made**:
  - `js/config.js` mock snack data and mock `getSnacks(mode)` filtering now follow the production `target` policy (`user` or `guest` only). Legacy mock-only `both` support was removed so local mock tests do not hide production target split bugs.
  - `service-worker.js` cache version was bumped to `kiosk-cache-v87`.
  - `print-bills.html`, `assets/closed-character.png`, and `sounds/new-order.mp3` were added to the service worker pre-cache list so bill printing, closed-state illustration, and operations audio are less likely to be stale or unavailable in installed PWA sessions.
* **Potential issue followed up**:
  - The initial review found guarded legacy order-rendering/helper functions in `admin.html` from the pre-split dashboard era. Section 19 documents the later cleanup decision and verification. Future fixes for order processing should still be made in `kitchen.html`, not by restoring old `admin.html` copies.

### 19) Admin legacy order-function cleanup (2026-06-26)
* **Why this cleanup is safe**:
  - The active `admin.html` UI contains only user management, snack management, and snack display-order tabs.
  - Live order processing, cancellation, CSV export, old-order archive, today summary, and print/board operations are owned by `kitchen.html`.
  - The removed `admin.html` code was a dormant pre-split copy guarded by missing DOM checks such as `order-table-body`, so it was not participating in the visible admin workflow.
* **Cleanup scope**:
  - Removed legacy order-processing variables and functions from `admin.html`: pending/completed order rendering, bulk order completion, single order status transitions, cancellation modal handlers, dormant CSV download, and stale archive button binding.
  - Kept shared/admin-critical helpers such as `esc`, `attr`, `callAttr`, `jsString`, `getAdminToken`, `withAdminToken`, `clearAdminTokenIfDenied`, user/snack management, snack ordering, image upload, and guest operations settings.
  - Left CSS-only legacy selectors in place when they had no active DOM/JS references. Broad CSS cleanup was intentionally avoided to prevent unrelated visual regressions.
* **Verification after cleanup**:
  - `admin.html` no longer contains references to removed order functions/variables such as `currentOrders`, `renderData`, `completeOrder`, `updateStatusAction`, `cancelOrderAction`, `downloadTodayOrdersCsv`, or `archiveOldOrders`.
  - The same order-processing functions still exist in `kitchen.html`, which remains the active owner for live order operations.
  - `node --check js/app.js`, `node --check js/config.js`, `node --check service-worker.js`, all HTML inline-script parsing, `google-apps-script.md` parsing, service-worker cache-entry existence checks, and `git diff --check` passed.
* **If an error appears after this cleanup**:
  - If order processing, cancellation, CSV export, archive, today summary, or print flow breaks, inspect `kitchen.html` first. Do not re-add the old `admin.html` copy unless the active UI was deliberately moved back.
  - If `admin.html` fails to load or buttons stop responding, check the browser console first, then run the inline-script parse check for `admin.html`.
  - If a missing-function error names one of the removed order functions (`renderData`, `completeOrder`, `updateStatusAction`, `cancelOrderAction`, `downloadTodayOrdersCsv`, etc.), confirm whether an old DOM button or copied HTML block was accidentally restored to `admin.html`. The correct fix is usually to remove that stale DOM reference or route the workflow to `kitchen.html`.
  - After any static-file cleanup or restore, bump `CACHE_NAME` in `service-worker.js` so installed PWA clients receive the corrected file.

### 20) Admin snack-order grid preview (2026-06-27)
* **Decision**: Keep the top-level admin tabs as `이용자 관리 / 간식 관리 / 간식 순서`. Do not split the admin screen into separate "general snack", "guest snack", "general order", and "guest order" tabs unless operational pain becomes much higher.
* **Change**:
  - Converted the `간식 순서` editing lists in `admin.html` from a vertical list to a grid-style preview.
  - The order still means left-to-right, top-to-bottom display order. This is a preview-like editing surface, not an exact per-device reproduction of every kiosk viewport.
  - Existing drag-and-drop saving and immediate `updateSnacksOrder` persistence are preserved.
  - The movement buttons were changed from `▲/▼` to `◀/▶` to better match the grid mental model.
  - `service-worker.js` cache version was bumped to `kiosk-cache-v90`.
* **Why this is safe**:
  - No GAS, sheet schema, API route, or display-order data model changed.
  - Only `admin.html` rendering/CSS and static cache version changed.
* **Verification to repeat if touched again**:
  - Parse `admin.html` inline script.
  - Confirm both `user-snack-order-list` and `guest-snack-order-list` still render active snacks only.
  - Move one item with `◀/▶`, drag one item, and verify the changed order persists after refresh.

### 21) Guest menu preview without opening operations (2026-06-27)
* **Decision**: Add a lightweight `guest.html?preview=1` flow before building a larger operations diagnostics screen. This directly solves the daily pain point of checking the Baedalwasam guest menu after snack/order changes without temporarily opening guest ordering from `kitchen.html`.
* **Change**:
  - Added `🛵 배달왔삼 미리보기` buttons to the top headers of `admin.html` and `kitchen.html`.
  - `guest.html?preview=1` shows a preview notice, hides Kakao/order lookup/review panels, bypasses the closed-order block, and starts with a temporary `userId: 'guest'` preview user.
  - `menu.html` and `confirm.html` preserve the preview flag with `sessionStorage.guestPreviewMode` and show preview notices.
  - `confirm.html` blocks submission before `placeOrder` and returns to `guest.html?preview=1`, so no order row, credit row, stock change, or admin log is created from preview.
  - Preview mode skips guest credit/profile sync calls to avoid creating or touching guest credit/profile records while checking the menu.
  - `service-worker.js` cache version was bumped to `kiosk-cache-v91`.
* **What this does not replace**:
  - This is not the full P2 operations diagnostics screen. GAS/sheet/header/Kakao settings checks are still listed in the roadmap below.
* **Verification to repeat if touched again**:
  - Open `guest.html?preview=1`, press `메뉴 미리보기`, add a snack, proceed to confirm, and press `미리보기 종료`. Confirm no real order appears in `kitchen.html`.
  - Confirm normal `guest.html` still respects guest open/closed state and normal guest orders can still submit.

---

## 6. Implementation Notes & Cautions

* **API Calls & Mocks**: While developing locally, you can switch between mock database and live spreadsheet database in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) using the `USE_MOCK` boolean value.
* **Touch Jitter (Double-Click Prevention)**: Users with motor control challenges might trigger duplicate clicks. Use `AppState.bindCardTap(el, callback)` instead of standard click handlers for critical buttons in user-facing views to check coordinates delta and timing.
* **Debugging Frontend Errors**: In case of screen freezing, non-responsive buttons, or general UI errors, do not debug blindly. Ask the user to check the developer console (F12) and share the console error log/stack trace. This is the fastest way to identify the exact line of syntax or runtime errors.
* **Haptic Feedbacks**: Sounds are created using the Web Audio API synthesizer dynamically. Do not rely on external MP3 files for general interaction sounds.
* **Google Apps Script Deployments**: If you modify the backend API routes or settings, copy code from [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md) into the Google Sheet Script Editor, save, and trigger **[New Deployment]** (Web App, executing as Me, accessible by Anyone). Update `API_URL` in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) to match the new address.
* **Apps Script Properties**: Store `ADMIN_TOKEN` for protected admin actions. For Kakao optional login, also store `KAKAO_REST_API_KEY` and `KAKAO_GUEST_KEY_SALT`. Add `KAKAO_CLIENT_SECRET` only if the Kakao console has Client Secret enabled. Register the static `guest.html` URL, not the GAS URL, as the Kakao Redirect URI.
* **Service Worker Cache Discipline**: Any deployed static-file behavior change should bump `CACHE_NAME` in `service-worker.js`. The current reviewed version is `kiosk-cache-v91`.
* **Syntax Check Caution**: `check_syntax.js` writes extracted GAS code into tracked `temp.js`. Prefer a direct parse command when you only need verification and want to avoid dirtying the working tree.

---

## 6.1 Active Stability Follow-Up (2026-06-21)

These items are ordered by operational risk. Do not redo completed items unless a regression is observed.

* **[DONE / CODE VERIFIED 2026-06-23] P1 - Board.html one-screen display layout and caching issue**:
  - **시도한 내용**: `board.html` 전광판에 주문이 여러 개 들어왔을 때 화면에 다 담기지 않고 스크롤도 불가한 문제를 해결하기 위해, 주문 개수(`list.length`)에 맞춰 카드를 컴팩트하게 축소하고 8개 초과 시 2열 그리드(Grid) 배치로 전환하는 동적 레이아웃(방안 A)을 추가했습니다. 또한, 긴 임시 주문번호(예: `ORD-1111111111111`)가 동그란 번호 영역을 깨트리지 않도록 뒷자리 4자리만 줄여 표시하는 (`...1111`) 안전 장치를 구성했습니다.
  - **실패/취소 원인**: 로컬 파일 변경사항을 브라우저가 읽지 못하는 현상이 발생했습니다. 원인은 PWA 서비스 워커(`service-worker.js`)가 `kiosk-cache-v71`에 기존 `board.html`과 `js/config.js`를 캐싱하고 있어 강제 새로고침(Ctrl+Shift+R)을 해도 네트워크 업데이트가 무시되었기 때문입니다. 캐시 갱신을 위해 `CACHE_NAME`을 `kiosk-cache-v72`로 올렸으나, 브라우저 서브에이전트가 CDP 페이지 ID 불일치 오류 및 캐시 삭제 프로세스 중 정지 현상을 겪으며 최종 취소되었습니다.
  - **Codex review 2026-06-23**: 문법 검증(`node --check service-worker.js`, `node --check js/config.js`, `node --check js/app.js`, `board.html` 인라인 스크립트 파싱)은 통과했지만, 로컬 Chrome 렌더링 검증에서 이전 2열 `super-compact` 방식은 세로 잘림을 해결하지 못했습니다. 1024x768에서 대기 12건 + 완료 12건 주입 시 `.board-list` 높이가 약 1307px까지 커지고, 부모 `.board-container`의 `overflow:hidden` 때문에 하단 주문 카드가 화면 밖에서 잘리는 것이 확인되었습니다.
  - **최종 결정 이유**: 사용자가 조작하는 화면이 아니라 멀리서 보기만 하는 전광판이므로, 내부 스크롤보다는 "한 화면에 최대한 다 보이게"가 운영 목적에 더 맞습니다. 따라서 상세 정보보다 주문번호/이름의 가시성을 우선했습니다.
  - **페이지 전환/순환 표시 판단**: 병원 대기번호 전광판처럼 주문이 극단적으로 많아지는 환경이라면 1페이지/2페이지를 자동 순환 표시하는 방식이 더 적합할 수 있습니다. 다만 현재 배달왔삼 운영 규모에서는 그런 극한 상황이 드물 것으로 판단해, 페이지 전환 기능은 넣지 않고 한 화면 압축 표시를 유지합니다. 추후 한 열에 30건 이상이 자주 쌓이거나 글자 가독성이 운영상 문제가 될 때만 재검토하세요.
  - **최종 수정 2026-06-23**: `board.html`에 `fit-grid` 기반 동적 레이아웃을 적용했습니다. 5~8건은 2열 compact, 9~18건은 3열 dense, 19건 이상은 4열 ultra로 바뀝니다. dense/ultra 단계에서는 상태 배지와 일부 상세 텍스트를 숨기거나 1~2줄로 줄여 번호와 이름이 우선 보이게 했습니다. `.board-layout`/`.board-column`/`.board-list`에는 높이 제약을 추가해 리스트가 화면 밖으로 밀려나지 않도록 했고, 배달지 인라인 스타일은 `.board-delivery-place` 클래스로 정리했습니다. 미사용 변수 `newArrival`도 제거했습니다.
  - **캐시 처리**: `service-worker.js`의 `CACHE_NAME`을 `kiosk-cache-v73`으로 올렸습니다. 실제 배포 URL에서는 새 정적 파일 게시 후 서비스워커 업데이트/활성화가 되었는지 한 번 확인하세요.
  - **검증 결과 2026-06-23**: `node --check service-worker.js`, `node --check js/config.js`, `node --check js/app.js`, `board.html` 인라인 스크립트 파싱을 통과했습니다. 로컬 Chrome에서 1024x768 기준 대기/완료 각각 12건, 18건, 24건, 30건 목데이터를 주입했고 body/list/card overflow가 0으로 확인되었습니다. 1200x800 및 768x1024의 18건+18건 케이스도 잘림 없이 통과했습니다.

* **[DONE / CODE VERIFIED 2026-06-23] P1.1 - Kitchen extreme order layout and grouping check**:
  - **검토 기준**: 주방화면은 전광판과 달리 운영자가 직접 조작하는 화면이므로, 극단상황에서 한 화면에 모두 보이는 것보다 가로 잘림 없이 스크롤/선택/일괄처리가 유지되는 것이 우선입니다.
  - **발견한 문제**: 일반 키오스크 주문도 `deliveryType: pickup`으로 저장될 수 있는데, 기존 `isGuestOrder`가 `deliveryType === pickup/delivery`만으로 게스트 주문 여부를 판정했습니다. 이 때문에 카드 자체는 키오스크 열에 들어가도 상단 배지는 `키오스크 0건 / 포장 N건`처럼 틀리고, 키오스크 열에 "대기 중인 키오스크 주문이 없습니다" 안내문이 같이 남을 수 있었습니다.
  - **수정 내용**: `kitchen.html`의 게스트 주문 판정을 `userId === 'guest'` 기준으로 바꿨습니다. 또한 1024px 전후 화면에서 3열이 너무 좁아지는 문제를 줄이기 위해 주문 열 레이아웃을 `<768px: 1열`, `768~1279px: 2열`, `>=1280px: 3열`로 조정하고 `.orders-column { min-width: 0; }`을 추가했습니다.
  - **캐시 처리**: `service-worker.js`의 `CACHE_NAME`을 `kiosk-cache-v74`로 올렸습니다.
  - **검증 결과**: `kitchen.html` 인라인 스크립트 파싱과 `node --check service-worker.js`를 통과했습니다. 로컬 Chrome에서 목데이터 `키오스크 5 / 포장 4 / 배달 3`을 주입해 배지와 카드 수가 일치하고 빈 안내문이 사라지는 것을 확인했습니다. 긴 이름/긴 간식명/긴 배달지와 주문 18건씩 총 54건을 1024x768 및 1400x900에서 렌더링했고, 문서/카드/버튼/헤더의 가로 overflow가 0으로 확인되었습니다. 열별 체크박스 선택 시 해당 열의 `선택 제공`만 활성화되는 것도 확인했습니다.
  - **남은 선택 개선**: 한 열에 20~30건 이상이 자주 쌓이면 페이지 스크롤은 길어집니다. 운영자가 하단까지 스크롤한 뒤 일괄처리 버튼으로 돌아가는 일이 잦아지면, 각 열 제목/일괄처리 바를 sticky로 만드는 개선을 검토하세요.

* **[DONE / CODE VERIFIED 2026-06-23] P1.2 - Refresh policy split by screen role**:
  - **결정 기준**: 실시간 주문 대응 화면인 `kitchen.html`은 30초 자동 새로고침을 유지합니다. 반면 `admin.html`과 `reviews.html`은 이용자/간식/크레딧/후기 공개 여부를 판단하고 수정하는 화면이므로, 자동 갱신보다 안정적인 작업 맥락이 중요합니다.
  - **수정 내용**: `admin.html`과 `reviews.html`에서 자동 새로고침 진행바와 30초 타이머 로직을 제거했습니다. 두 화면 모두 PWA `standalone`으로 실행될 수 있으므로 브라우저 자체 새로고침만 믿지 않고 화면 안의 `지금 새로고침` 버튼은 유지했습니다.
  - **유지한 예외**: `admin.html`의 `guestOpsCountdown`은 게스트 주문 마감까지 남은 시간을 표시하는 카운트다운이며, 목록 자동 갱신이 아니므로 유지했습니다.
  - **캐시 처리**: `service-worker.js`의 `CACHE_NAME`을 `kiosk-cache-v75`로 올렸습니다.
  - **검증 결과**: `admin.html`, `reviews.html`, `kitchen.html`, `board.html` 인라인 스크립트 파싱과 `node --check service-worker.js`, `node --check js/app.js`, `node --check js/config.js`를 통과했습니다. `admin.html`/`reviews.html`에는 자동 새로고침 타이머/진행바 참조가 남아 있지 않습니다.

* **[DONE / DEPLOYED 2026-06-21] P1.5 - Backend error handling and copy-safe GAS source**: `google-apps-script.md` is raw JavaScript and can be copied with Ctrl+A directly into Apps Script. The deployed backend wraps `doPost` in a top-level failure response and routes admin audit writes through `safeAppendAdminLog`, so a logging failure does not make an already-applied admin change appear failed. Verification completed with `getUsers&includeInactive=Y`, `getSnacks&includeHidden=Y`, and a malformed no-op POST returning a JSON failure response.
* **[DONE 2026-06-21] P2 - Admin/kitchen/reviews maintenance cleanup**: Removed stale user/snack management JavaScript from `kitchen.html` and stale order/user/snack/guest-ops JavaScript from `reviews.html`, leaving `admin.html` as the dedicated user/snack management surface. The current top-position "신규 이용자 등록" and "신규 간식 등록" buttons in `admin.html` are intentional and should remain. Verification completed with inline-script parse checks for `kitchen.html` and `reviews.html`, plus stale management-reference searches.
  - **Why this was done**: After the admin screens were split, old copied management code remained in secondary pages. It was not visible in the UI, but it made future maintenance risky because a later handoff worker could patch the wrong copy, revive removed modal/tab assumptions, or accidentally expand the admin action surface in a screen that should only handle its own job.
  - **Exact cleanup rule used**: `admin.html` owns user/snack/credit/sale-state management. `kitchen.html` owns order processing, today-summary, CSV download, old-order archive, refresh pause, and guest order settings. `reviews.html` owns review list/detail/visibility moderation only.
  - **What was intentionally kept**: `kitchen.html` still fetches users for order avatar/name mapping and reviews for the today summary. These are read/display dependencies, not user/review-management UI. Guest-order controls also remain in `kitchen.html` because they are operational controls for the kitchen/admin workflow.
  - **What was intentionally not changed**: Broad CSS cleanup was avoided because unused styles are lower risk than accidental visual regressions. If a future pass removes CSS, verify the three admin pages visually before deployment.
  - **How to verify again**: Run inline-script parse checks for `kitchen.html` and `reviews.html`, then search those files for stale management names such as `modal-add-user`, `renderUsersManagement`, `renderSnacksManagement`, `renderSnackOrderPanel`, `updateUserCredit`, `updateSnackStock`, `currentSnacks`, `showUserApiWarningIfNeeded`, and `switchTab`. Smoke-test kitchen order buttons/CSV/archive/refresh pause/guest settings and review list/detail/visibility toggle.
  - **Do not restore by copy-paste**: If a removed function is needed again, rebuild it in the proper owner screen or a small shared helper. Do not copy the old all-in-one admin blocks back into `kitchen.html` or `reviews.html`.
* **[DONE 2026-06-21] P4 - Guest Closed Screen Layout Improvements**: Replaced the padlock emoji with a mascot character image (`assets/closed-character.png`), removed redundant welcome/closed messages (`#guide-text-main`) in non-operating state, and hid the "Today's Delivery Team" section (`#today-delivery-team-section`) when closed to prevent confusion and clean up the visual layout.

---

## 7. Future Roadmaps & Considerations (다음 작업 고려 목록)

다음 후보들은 기능 확장보다 운영 안정성과 개인정보 노출 감소를 우선한 목록입니다. 새 화면/새 기능을 크게 늘리기보다, 한 항목씩 적용하고 실제 운영에서 체감되는지 확인하세요.

**Current open priority order (2026-06-28)**:
1. **P3 관리자 페이지 상단 메뉴 UI/UX 개선**: admin/kitchen/reviews 화면 우측 상단에 혼재된 외부 링크 및 액션 버튼(5~7개)의 복잡성을 GNB 탭 분리나 드롭다운 메뉴로 간소화하는 개선.
2. **P3 주방 배달팀 멤버 역할 표시 개선**: 현재 한 줄 텍스트(`멤버: 이인, 안태근|배달 담당, 박상민, 김동환|상품 준비 담당`)를 기존 저장 형식은 유지하되, 주방 화면 표시에서는 `멤버 / 배달 담당 / 상품 준비 담당`처럼 같은 행의 별도 열로 분리해 가독성을 높이는 개선.
3. **P3 터치 보조 모드 추가**: 터치가 어려운 이용자를 위한 입력 안정성 개선.
4. **P4 후기 상세 모달 참여 정보 추가 검토**: 후기 참여를 늘리기 위한 관찰 기능. 새 탭/사용자 목록은 만들지 않고, 후기 상세 모달에 해당 작성자의 후기 횟수부터 작게 표시하는 방향을 우선 검토.

* **[DONE / P1 2026-06-27] 기본 루트(/) 접속 시 게스트 화면(guest.html) 노출 및 일반 키오스크 보안 대책**:
  - **배경**: 현재 `https://cideryman.github.io/kiosk-trainer/` 접속 시 일반 이용자 목록(이름/사진)이 바로 노출되는 `index.html`이 열리므로 개인정보 노출 우려가 있음. 외부인은 게스트 화면(`guest.html`)을 기본으로 보게 할 필요가 있음.
  - **구현 내용**: `index.html` 상단의 조기 스크립트가 `?type=kiosk` 쿼리 파라미터를 확인하고, 없으면 `guest.html`로 `location.replace()` 처리합니다. 일반 키오스크 기기는 `https://cideryman.github.io/kiosk-trainer/index.html?type=kiosk` 주소를 사용합니다.
  - **일반 키오스크 PWA 처리**: `manifest-kiosk.json`의 `start_url`을 `./index.html?type=kiosk`로 변경했습니다. 서비스워커도 `index.html?type=kiosk`를 프리캐시하고, 쿼리 주소 캐시버스터가 깨지지 않도록 `?`/`&` 구분 로직을 추가했습니다. 캐시 버전은 `kiosk-cache-v88`입니다.
  - **운영 편의 후속 2026-06-27**: 일반 키오스크 주소가 길어졌기 때문에 `admin.html`과 `kitchen.html` 상단에 `🛒 일반 키오스크` 버튼을 추가해 `index.html?type=kiosk`를 새 탭으로 열도록 했습니다. 두 화면 하단의 기존 `키오스크 화면으로 가기` 버튼도 같은 안전 주소로 수정했습니다. 정적 파일 캐시 버전은 `kiosk-cache-v89`입니다.
  - **카카오 설정 영향**: 루트(`/`)만 `guest.html`로 보내고 실제 카카오 로그인은 계속 `guest.html`에서 시작한다면, 현재 코드의 `getKakaoRedirectUri()`가 `window.location.origin + window.location.pathname`을 쓰므로 리다이렉트 URI는 기존 `https://cideryman.github.io/kiosk-trainer/guest.html` 그대로입니다. 이 경우 카카오 API 키나 Redirect URI를 바꿀 필요가 없습니다.
  - **설정 변경이 필요한 경우**: `guest.html` 파일명을 `baedal.html`로 바꾸거나, `/guest` 같은 확장자 없는 새 주소를 실제 로그인 시작 주소로 쓰거나, 대표 도메인을 커스텀 도메인으로 변경하면 카카오 개발자 콘솔 Redirect URI에 새 정적 앱 주소를 추가해야 합니다. GAS 웹앱 주소는 Redirect URI로 쓰지 않습니다.
  - **보안 보강 방안**: 단순 파라미터 분기 외에도 최초 1회 관리자 비밀번호를 확인하여 로컬 스토리지에 암호화 키를 저장한 기기만 일반 키오스크 로그인 화면을 볼 수 있게 하거나, 비밀 토큰 기반의 쿼리 스트링(예: `?auth=secret-key`)을 가진 경우에만 일반 이용자 목록 데이터를 불러오도록 API 레벨에서 보강하는 방안 검토 가능.
  - **수동 확인**: 루트 주소 접속 시 게스트 화면으로 이동하는지, `index.html?type=kiosk`에서는 기존 일반 이용자 선택 화면이 유지되는지, 설치된 게스트 PWA의 `start_url`이 계속 `guest.html`로 열리는지, 일반 키오스크 PWA가 `index.html?type=kiosk`로 열리는지, 카카오 로그인 후 돌아오는 주소가 기존 Redirect URI와 일치하는지 확인.

* **[DONE / P2 2026-06-28] 운영 점검 버튼 및 진단 도구 구현 완료**:
  - **구현 내용**: `kitchen.html`과 `admin.html` 상단에 `🛠️ 운영 점검` 버튼을 배치하고 진단용 모달창 구조와 스크립트를 구현했습니다. 백엔드 `diagnoseSystem` API와 Mock 연동을 통해, 토큰 인증 여부에 맞게 시트 탭의 정합성, 스크립트 Properties 환경 설정 유무를 실시간 진단하도록 구현했습니다.
  - **구문 및 동작 검증**: HTML 인라인 스크립트 문법 검증 도구와 브라우저 서브에이전트 UI 테스트 시나리오를 통해, ReferenceError 버그(타이머 일시정지 버튼 갱신 함수 오참조)까지 완벽히 해결 및 작동 검증 완료했습니다.
  - **캐시 갱신**: 캐시 갱신을 위해 캐시 네임을 `kiosk-cache-v92`로 갱신했습니다.
  - **코드 리뷰 후속 2026-06-28**: 실제 시트 헤더와 진단 기준이 어긋나 정상 시트를 경고로 표시할 수 있던 문제, 잘못된 관리자 비밀번호 입력 후 재입력이 막힐 수 있던 문제, 주방 화면 운영 점검 모달이 기존 자동 새로고침 일시정지 상태를 잃어버리던 문제를 수정했습니다. 이 후속 수정의 정적 파일 캐시 버전은 `kiosk-cache-v93`입니다.

* **[TODO / P3] 관리자 페이지 상단 메뉴 UI/UX 개선**:
  - **목적**: 3대 관리자 페이지(`admin.html`, `kitchen.html`, `reviews.html`) 상단 우측에 화면 이동(링크), 외부 창 열기(키오스크/미리보기/전광판), 현재 페이지 액션(운영점검/인쇄) 버튼 5~7개가 혼재되어 발생하는 시각적 산만함과 태블릿/모바일 가로폭 좁아짐에 따른 레이아웃 깨짐을 방지하기 위함.
  - **현재 판단**: 기능이 늘어난 만큼 버튼을 제거하기보다 역할별로 묶는 것이 좋습니다. 상단에는 `관리자 / 주방 / 후기` 같은 핵심 화면 이동과 각 화면에서 가장 자주 쓰는 액션만 남기고, `일반 키오스크`, `배달왔삼 미리보기`, `전광판`, `운영 점검`처럼 외부 화면 또는 점검성 기능은 `더보기`/`외부 화면` 메뉴로 묶는 방향을 우선 검토합니다.
  - **개선 방안 후보**:
    1. **드롭다운 메뉴화**: 우측 상단에는 상시 필요한 `운영 점검` 등 액션 버튼 2~3개만 두고, `키오스크 열기`, `배달왔삼 미리보기`, `전광판 보기` 등 외부 새 창 링크들은 `🔌 외부 연결 (또는 ︙ 더보기)` 드롭다운 메뉴 내 가로/세로 목록으로 단순화.
    2. **GNB(글로벌 상단 네비게이션) 탭 적용**: GNB 상단 좌측 영역에 3대 관리자 화면 링크를 깔끔한 텍스트 탭 메뉴 형태로 정리하고, 우측에는 순수 액션 버튼만 잔존시킴.
    3. **슬림 사이드바(Left Sidebar) 구조 채택**: 화면 좌측에 3대 전환 아이콘 사이드바를 배치해 대화면 운영 시 즉시 이동을 가능케 하고, 헤더 영역의 밀집도를 획기적으로 완화함.
  - **주의**: 모바일/태블릿 등 다양한 해상도(특히 가로 768px 미만)에서 줄바꿈이 일어나지 않도록 미디어 쿼리 및 패딩 보정을 보수적으로 처리하세요.

* **[TODO / P3] 주방 배달팀 멤버 역할 표시 개선**:
  - **목적**: 주방 화면에서 당일 배달팀 정보를 빠르게 읽을 수 있도록, 현재 한 줄 텍스트 안에 `|`로 섞여 있는 역할 정보를 화면 표시 단계에서 분리합니다.
  - **권장 방식**: DB/설정 저장 형식은 당장 바꾸지 말고, 기존 문자열을 파싱해 화면에서만 `멤버`, `배달 담당`, `상품 준비 담당` 열로 보여줍니다. 같은 행 안에서 역할별 칸을 나누면 주방 담당자가 “누가 배달이고 누가 상품 준비인지”를 다시 해석하지 않아도 됩니다.
  - **결정 이유**: 설정 데이터 구조를 바꾸면 기존 입력값과 저장 로직 영향이 커질 수 있습니다. 표시만 분리하면 운영 가독성은 개선하면서 기존 설정값, GAS, 구글시트 구조는 그대로 유지할 수 있습니다.
  - **주의**: `|배달 담당`, `|상품 준비 담당` 같은 구분자가 없거나 오타가 있는 경우에도 화면이 깨지지 않도록 원문을 `멤버` 칸에 안전하게 표시하는 fallback을 둡니다. 모바일/태블릿에서는 3열이 너무 좁으면 세로 스택으로 바뀌도록 처리하세요.
  - **수동 확인**: `멤버: 이인, 안태근|배달 담당, 박상민, 김동환|상품 준비 담당` 형식, 역할 일부가 빠진 형식, 일반 자유문 형식을 각각 넣고 주방 화면이 깨지지 않는지 확인합니다.

* **[TODO / P3] 터치 보조 모드 추가**:
  - **목적**: 터치가 어렵거나 손 떨림이 있는 이용자의 오터치를 줄이고, 주요 버튼 반응을 더 안정적으로 만들기 위함.
  - **권장 방식**: 전역 설정 또는 로컬 설정으로 `터치 보조 강화`를 켜면 `AppState.bindCardTap`의 허용 이동 거리(`tapMoveTolerancePx`)와 최대 탭 시간(`tapMaxDurationMs`)을 약간 넓히고, 주요 버튼의 최소 높이/여백을 소폭 키우는 방식부터 시작.
  - **주의**: 너무 민감하게 만들면 스크롤하려는 동작이 탭으로 오인될 수 있습니다. 메뉴 카드, 주문 확정, 취소 같은 핵심 버튼 위주로 적용하고, 긴 목록 스크롤 영역은 보수적으로 유지하세요.
  - **수동 확인**: 일반 이용자 키오스크, 게스트 주문, 장바구니 수량 조절, 주문 확정/취소 버튼에서 오작동 없이 체감이 좋아지는지 실제 터치 기기에서 확인.

* **[HOLD / P4] 후기 참여 증대: 후기 상세 모달 참여 정보 및 스탬프 보상 검토 (2026-06-28)**:
  - **작업명**: 후기 참여를 늘리기 위한 스탬프/무료배송 보상은 보류하고, 후기 상세 모달에서 해당 작성자의 후기 작성 여부/횟수 표시를 우선 검토합니다.
  - **세부안**:
    * 후기 상세 모달의 참여 정보가 실제로 유용하면, `reviews.html` 상단에 `오늘 후기`, `카카오 연결 후기`, `비로그인 후기`, `반복 참여자` 요약 카드를 추가하는 2단계를 검토합니다.
    * 스탬프를 도입한다면 최대 1개 보유, 다음 배달 주문 성공 시 자동 사용, 주문 실패/취소 시 미사용 유지 원칙을 우선 검토합니다.
    * 후기 작성 횟수는 관리자 내부 통계로만 두고, 이용자 화면에는 과한 경쟁/비교 요소를 만들지 않는 방향을 우선합니다.
  - **Summary (요약)**:
    * **무엇이 바뀌었는가?** 현재는 코드 변경 없이 아이디어를 보류 기록했습니다.
    * **왜 바뀌었는가?** 후기 참여는 늘리고 싶지만, 카카오 로그인 `+2 크레딧`과 스탬프 `+2 크레딧`은 보상 의미가 겹치기 때문입니다.
    * **운영자가 확인할 것**: 실제로 후기 참여율이 낮은지, 후기 상세 모달에서 작성 횟수를 보는 것이 운영 판단에 도움이 되는지 먼저 확인합니다.

* **[RESOLVED] Review Visibility Toggle Error**:
  - **Problem**: Clicking the public/private visibility toggle on the review moderation page (`reviews.html`) triggered a "구글시트 연결에 실패했습니다" (failed to connect to google sheet) popup error.
  - **Resolution**: Fixed in [google-apps-script.md](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/google-apps-script.md) by correcting the backend typo where it called `verifyAdmin` instead of `verifyAdminToken(data)`, and added `'toggleReviewVisibility'` to the `ADMIN_ACTIONS` routing whitelist array.

* **[RESOLVED] 제안 2) 유휴 시간 감지 자동 로그아웃 (Idle Timeout)**:
  - **내용**: `menu.html`, `confirm.html` 등에서 70초간 터치 이벤트가 없을 시 자동으로 카트와 유저 세션을 리셋하고 처음 화면(`index.html`/`guest.html`)으로 복귀하도록 유휴 타이머 적용. 10초 전 화면이 어두워지며 TTS 음성 경고 송출 및 3초 전 매초 비프/진동 피드백.
  - **상태**: 구현 및 검증 완료.

* **[RESOLVED] 제안 3) 오프라인 상태 대응 전면 안내 팝업**:
  - **내용**: `window.addEventListener('offline')` 연동. 인터넷이 일시 단절될 경우 브라우저 에러창이나 정지 대신 친근한 안내 팝업과 캐릭터 일러스트, 안내 TTS를 제공하여 발달장애 이용자의 심리적 불안 최소화. 복구 시 자동 복귀.
  - **상태**: 구현 및 검증 완료.

* **[RESOLVED 2026-06-25] 제안 4) 게스트 모드 카카오 선택 로그인 연동**:
  - **최종 결정**: 실명 확인 기능이 아니라 개인정보 최소화 기반의 주문 조회 보강 기능으로 구현했습니다. 네이버는 도입하지 않고 카카오만 선택형으로 둡니다.
  - **구현 방식**: `userId`는 계속 `'guest'`로 저장하고, 원본 카카오 ID는 저장하지 않습니다. GAS가 카카오 사용자 ID를 확인한 뒤 `KAKAO_GUEST_KEY_SALT`로 내부 `guestKey`를 만들어 `주문내역.authProvider/guestKey`에만 저장합니다.
  - **주문표시명/배송지 기억**: 카카오 연결 사용자가 주문 확인 화면에서 선택 체크한 경우에만 `게스트프로필`에 마지막 주문표시명과 배송지를 저장합니다. 체크하지 않아도 주문은 가능하며, 게스트 화면에서 저장 정보 삭제가 가능합니다.
  - **제외 범위**: 실명, 이메일, 전화번호, 프로필 사진, 카카오 배송지 API, 배송지 프리셋, `후기내역` 소셜 컬럼 추가는 하지 않았습니다.
  - **운영 주의**: 카카오 Redirect URI는 GAS 웹앱 주소가 아니라 실제 정적 사이트의 `guest.html` 주소여야 합니다.

---

## 8. Recent Manual Verification Checklist

최근 추가/수정된 운영 기능은 시스템 안정성과 직관성을 검증하기 위해 다음 절차로 수동 확인해 주세요.

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

### 4) 게스트 화면 카카오 UI 개선 및 자동 동기화 수동 검증
* **검증 대상**: `guest.html` (게스트 주문 홈 화면)
* **검증 순서**:
  1. **로그인 유도 패널 노출**: 게스트 홈 진입 시 상단 미니 바가 나타나지 않고, 화면 중간에 노란색 카카오톡 로그인 유도 박스가 올바르게 노출되는지 확인합니다.
  2. **상단 프로필 바 전환**: 카카오톡 로그인을 완료하면 중간의 노란색 로그인 박스가 사라지고 배달왔삼 로고 아래 가로바 형태로 `닉네임` 및 `오늘 남은 크레딧` 정보와 `⚙️`(수정), `🚪`(로그아웃) 아이콘이 노출되는지 확인합니다.
  3. **정보 수정 모달 및 개인정보 파기**:
     * `⚙️` 아이콘 클릭 시 수정 모달창이 열리고 모달 본문 안에 `보유 크레딧` 및 최하단에 **"브라우저에 저장된 정보 삭제하기"** 링크 버튼이 잘 배치되어 있는지 확인합니다.
     * 닉네임과 배송지 수정 저장 시 상단 바에 즉각 반영되는지 확인합니다.
     * "저장 정보 삭제" 클릭 시 컨펌 창을 통해 정상 삭제 처리되며 자동 로그아웃 및 모달 닫기가 이뤄지는지 확인합니다.
  4. **PWA 화면 백그라운드 자동 동기화**: 관리자 모드에서 게스트 영업 상태를 변경한 뒤 게스트 앱 브라우저/PWA 화면으로 복귀 시 화면의 영업/마감 여부가 즉각 자동 갱신되는지 확인합니다.
  5. **마감 시 수동 새로고침**: 마감 상태의 화면에서 `🔄 상태 새로고침` 버튼을 클릭했을 때 영업 상태를 새로 조회하여 적용하는지 확인합니다.
  6. **비운영→운영 버튼 활성화**: 비운영 상태에서 운영으로 복귀 시 "새 주문하기" 버튼이 비활성 회색에서 선명한 주황색 활성 상태로 클릭 가능하게 전환되는지 확인합니다.
  7. **타이머 상태 유지**: 모바일에서 화면을 껐다 켰을 때(또는 다른 탭에 갔다 왔을 때) 타이머 감소 주기가 중복 생성되어 2초씩 비정상 차감되지 않고 1초씩 정상 차감되는지 확인합니다.
  8. **저장된 정보가 없는 신규 로그인 ⚙️ 팝업 검증**: 카카오 로그인 직후 첫 주문 전에 ⚙️ 아이콘을 누르면, 정보가 없는 상태(`rememberedGuestProfile`이 `null`인 상태)임에도 팝업 모달이 정상적으로 열리며, 하단의 "저장 정보 삭제" 버튼은 노출되지 않는지 확인합니다.
  9. **크레딧 실시간 동기화**: 카카오 로그인 후 크레딧이 갱신되었을 때(또는 페이지 재진입 시) 상단 프로필 바의 크레딧 숫자와 하단 이름 입력 필드 위의 크레딧 뱃지 숫자가 정확히 실시간으로 일치하는지 확인합니다.


---

### 작업 기록 (Development Log) - 22) 시스템 운영 점검 (진단) 도구 구현

#### 작업명
> 구글 앱스 스크립트(GAS) 서버와 스프레드시트 데이터베이스 상태를 원클릭으로 정밀 점검하는 시스템 운영 점검(진단) 도구 구현

#### 1. Issue (문제)
* **증상**: 구글 스프레드시트 탭 명칭이 바뀌거나, 컬럼(P열 등)의 위치가 어긋나거나, GAS 프로젝트 설정(Script Properties)에 필수 API 키가 누락되었을 때 관리자가 이를 시각적으로 즉시 확인하고 대처할 방법이 없어 시스템 연결 불통이나 데이터 정합성 에러가 발생한 이후에야 사후적으로 오류를 디버깅해야 했습니다.
* **영향**: 주문 수락 실패, 게스트 크레딧 처리 불가, 카카오 로그인 연동 실패 등의 중대한 비즈니스 로직 오류가 사전에 방지되지 않고 백엔드 장애로 이어집니다.

#### 2. Cause (원인 분석)
* **원인**: 프론트엔드와 백엔드가 연동된 PWA 구조에서 스프레드시트 스키마 및 환경설정 상태를 모니터링해주는 헬스체크(Health-check) API 및 이를 시각화해주는 대시보드 진단 패널이 부재했습니다.

#### 3. Decision (결정)
* **해결 방법**:
  1. 백엔드([google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md))에 `diagnoseSystem` API를 구현하여, 각 데이터베이스 테이블(탭)의 존재성, 필수 헤더 컬럼 목록의 일치성, 그리고 프로젝트 설정값(`ADMIN_TOKEN`, `KAKAO_REST_API_KEY` 등)의 설정 여부를 한 번에 스캔하고 진단 보고서를 리턴하게 했습니다.
  2. 보안 강화를 위해, 비밀번호가 올바르게 검증된 경우에만 상세 정보를 노출하는 Basic / Detailed 진단 모드를 구성했습니다.
  3. 프론트엔드 관리자 설정 화면([admin.html](file:///c:/Users/user/Desktop/키오스크/admin.html))과 주방 운영 대시보드([kitchen.html](file:///c:/Users/user/Desktop/키오스크/kitchen.html))의 우측 상단 헤더에 `🛠️ 운영 점검` 버튼을 통일하여 추가하고, 점검 상태를 즉각 스캔해 결과(시트 정상 유무, 필수 키 등록 상태 등)를 이쁘게 뿌려주는 모달창을 구현했습니다.
* **결정 이유**: 장애가 생겼을 때 스프레드시트나 구글 콘솔로 들어갈 필요 없이, 운영 현장 화면에서 즉시 헬스체크 결과를 시각적으로 점검하여 현장 관리자(교사/운영진)가 스스로 자가 해결(예: 누락된 컬럼 추가)할 수 있게 돕기 위함입니다.
* **변경 파일**: 
  * [admin.html](file:///c:/Users/user/Desktop/키오스크/admin.html)
  * [kitchen.html](file:///c:/Users/user/Desktop/키오스크/kitchen.html)
  * [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js)
  * [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md)
  * [service-worker.js](file:///c:/Users/user/Desktop/키오스크/service-worker.js)
  * [handoff.md](file:///c:/Users/user/Desktop/키오스크/handoff.md)

#### 4. Verification (검증)
* **코드 검증**: Node.js 구문 체크 (`node --check js/config.js`, `node --check service-worker.js`), GAS 코드 파싱 검사 (`node check_syntax.js`), HTML 인라인 스크립트 파싱 검사 (`check_html_syntax.js`)를 모두 통과했습니다.
* **기능 검증**: 목업 API(`js/config.js` 내 `diagnoseSystem`)를 구성하여 모달창 제어 및 상태 바인딩, 비밀번호 입력 유도 및 토큰 확인 후 상세 진단 성공(detailed) 렌더링을 완전히 시뮬레이션 검증 완료하였습니다.

#### 5. Manual Test (수동 테스트)
* **테스트 순서**:
  1. `kitchen.html` 이나 `admin.html` 화면에 접속합니다.
  2. 우측 상단 헤더에서 `🛠️ 운영 점검` 버튼을 클릭합니다.
  3. 관리자 비밀번호를 입력하라는 창이 팝업되면, 비밀번호(어드민 토큰)를 입력 후 확인을 누릅니다.
  4. 진단이 즉시 수행되며, "시스템 상태 양호" 배지와 함께 하단에 6가지 주요 시트 탭(이용자목록, 간식목록, 주문내역 등)의 정상 상태 유무와 구글 앱스 스크립트 속성 키(ADMIN_TOKEN 등)의 등록 상태가 `🟢 정상` / `🟢 설정됨`으로 표시되는지 확인합니다.
  5. 창을 닫으면 타이머가 다시 정상 작동하는지(또는 편집 중단이 풀리는지) 확인합니다.

#### 6. Caution (주의사항)
* 신규 백엔드 API인 `diagnoseSystem`이 추가되었으므로, 실제 운영 환경 적용을 위해서는 [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md)의 최신 코드를 구글 앱스 스크립트 에디터에 덮어씌운 뒤 **[새 배포(New Deployment)]**를 갱신해야 합니다.
* 프론트엔드 파일(HTML, JS)이 변경되었으므로 클라이언트 브라우저 캐시 강제 갱신을 위해 `service-worker.js` 버전을 `kiosk-cache-v92`로 올렸습니다.

#### 7. Do Not (절대 하지 말 것)
* 운영 점검 모달은 관리자 전용 기능이므로 일반 게스트나 키오스크 화면(`guest.html`, `index.html`)에 노출하지 않아야 하며, 어드민 토큰 검증 로직을 거치지 않은 상세 정보 노출은 보안상 절대 금지합니다.

#### 8. Future Improvements (향후 개선)
* 현재 진단 결과는 텍스트와 아이콘 위주로 표시됩니다. 이후 운영자가 에러 항목을 클릭 시, 스프레드시트의 가이드 문서나 컬럼 추가 도움말 팝업으로 직접 연결해 주는 편의 기능을 고려할 수 있습니다.
* 구글 앱스 스크립트 연결 주소(`API_URL`)의 변경 여부도 진단 검사에 자동으로 연동되도록 보완하면 더욱 완성도가 올라갈 것입니다.

#### 9. Summary (요약)
* **무엇이 바뀌었는가?**: 원클릭으로 구글 시트와 앱스 스크립트 설정 상태를 진단해 주는 '시스템 운영 점검' 모달 및 백엔드 API가 추가되었습니다.
* **왜 바뀌었는가?**: 현장 관리자가 구글 콘솔이나 스프레드시트를 직접 열어보지 않고도 장애 원인(컬럼 순서 어긋남, 스크립트 필수 키 누락 등)을 직관적으로 확인하고 스스로 자가 진단 및 대처를 할 수 있도록 지원하기 위함입니다.
* **운영자가 확인할 것**: [kitchen.html](file:///c:/Users/user/Desktop/키오스크/kitchen.html) 이나 [admin.html](file:///c:/Users/user/Desktop/키오스크/admin.html) 우측 상단의 `🛠️ 운영 점검` 버튼을 눌러 모달창이 정상 작동하고 진단 결과가 잘 표시되는지 점검하십시오.

---

### 작업 기록 (Development Log) - 23) 운영 점검 코드 리뷰 후속 안정화

#### 작업명
> 운영 점검 도구가 실제 시트 구조와 화면 상태를 정확히 반영하도록 코드 리뷰 지적사항을 수정

#### 1. Issue (문제)

##### 증상
* 정상 운영 중인 스프레드시트도 운영 점검에서 헤더 오류로 표시될 수 있었습니다.
* 운영 점검 비밀번호를 잘못 입력하면 잘못된 값이 세션에 남아 비밀번호 입력창이 다시 나오지 않을 수 있었습니다.
* 주방 화면에서 자동 새로고침을 사용자가 직접 일시정지한 뒤 운영 점검창을 열고 닫으면, 기존 일시정지 상태가 풀릴 수 있었습니다.

##### 영향
* 관리자/주방 화면의 운영 점검 신뢰도에 영향을 줍니다.
* 실제 주문 생성/처리 로직 자체를 바꾸는 문제는 아니지만, 운영자가 정상 상태를 장애로 오판하거나 주방 화면 새로고침 정책이 의도와 다르게 바뀔 수 있습니다.

#### 2. Cause (원인 분석)

##### 원인
* `diagnoseSystem`의 기대 헤더가 예전 영문 컬럼명 기준으로 작성되어 있었고, 현재 `ensureOrderHeaders`, 후기 생성, 게스트 크레딧/프로필 생성 로직의 실제 헤더와 다르게 남아 있었습니다.
* 프론트엔드 진단 모달이 `basic` 응답을 받았을 때 기존 세션 토큰을 무효 처리하지 않았습니다.
* `kitchen.html`의 진단 모달 닫기 로직이 이전 자동 새로고침 상태를 기억하지 않고 항상 `refreshPaused = false`로 되돌렸습니다.

##### 조사 과정
* `google-apps-script.md`의 `ensureOrderHeaders`, `submitReview`, `ensureGuestProfileSheet`, `ensureGuestCreditSheet`, `archiveOldOrders`, `appendAdminLog`, `diagnoseSystem`을 대조했습니다.
* `admin.html`과 `kitchen.html`의 `runSystemDiagnosis`, `submitDiagnosePassword`, `openDiagnoseModal`, `closeDiagnoseModal` 흐름을 비교했습니다.
* 운영 점검이 `ADMIN_ACTIONS`에 포함되지 않고 함수 내부에서 상세 진단 토큰을 확인하는 구조는 유지해도 된다고 판단했습니다.

#### 3. Decision (결정)

##### 해결 방법
* `diagnoseSystem`의 기대 헤더를 현재 실제 시트 구조에 맞게 정정했습니다.
* `주문내역`은 A~U 현재 구조(`주문시간`부터 `guestKey`까지)를 기준으로 점검합니다.
* `운영설정`은 실제 생성 구조대로 `key`, `value`만 필수로 봅니다.
* `후기내역`, `관리자로그`, `게스트프로필`, `게스트크레딧`, `주문보관`의 기대 헤더도 실제 생성 로직에 맞췄습니다.
* 관리자 비밀번호가 틀려 `basic` 응답이 오면 저장된 세션 토큰을 지우고 비밀번호 입력창을 다시 보여주도록 했습니다.
* 주방 화면은 점검창을 열기 전의 `refreshPaused` 값을 저장하고, 닫을 때 그 값으로 복원하도록 했습니다.

##### 결정 이유
* 운영 점검 도구는 실제 장애와 정상 상태를 구분하는 목적이므로, 진단 기준은 “문서상 희망 구조”가 아니라 “현재 코드가 만들고 읽는 구조”와 일치해야 합니다.
* 비밀번호 검증 방식은 백엔드의 기존 `verifyAdminToken`을 그대로 사용하고, 프론트는 잘못된 토큰을 남기지 않는 선에서만 수정하는 것이 가장 작습니다.
* 주방 자동 새로고침 정책은 현장 운영 흐름에 직접 영향을 주므로, 진단 모달이 사용자의 기존 선택을 덮어쓰지 않도록 상태 복원만 추가했습니다.

##### 변경 파일
* `google-apps-script.md`
* `admin.html`
* `kitchen.html`
* `service-worker.js`
* `handoff.md`

#### 4. Verification (검증)

##### 코드 검증
* [x] 문법 검사: `node --check js/config.js`, `node --check js/app.js`, `node --check service-worker.js`
* [x] 정적 분석: 운영 점검 헤더/비밀번호/새로고침 복원 정적 회귀 체크
* [x] 빌드 성공: 정적 HTML 앱이라 별도 빌드 없음
* [ ] 콘솔 오류 없음: 실제 브라우저/GAS 배포 환경에서 수동 확인 필요

##### 기능 검증
* [x] 기존 기능 영향 없음: 주문 생성/제공/게스트 크레딧 계산 로직은 수정하지 않음
* [x] 신규 기능 정상 동작: 로컬 문법 및 정적 회귀 검사 통과
* [ ] 예외 상황 확인: 실제 GAS 재배포 후 잘못된 비밀번호, 정상 비밀번호, 일부 시트 누락 상태는 수동 확인 필요

#### 5. Manual Test (수동 테스트)

##### 테스트 순서

1. 최신 `google-apps-script.md`를 Apps Script에 복사하고 새 배포합니다.
2. `admin.html`에서 `운영 점검`을 열고 일부러 틀린 비밀번호를 입력합니다.
3. 비밀번호 입력창이 다시 표시되는지 확인합니다.
4. 올바른 관리자 비밀번호를 입력하고 시트/속성 점검 결과가 정상 표시되는지 확인합니다.
5. `kitchen.html`에서 자동 새로고침을 `일시정지`한 뒤 운영 점검창을 열고 닫습니다.
6. 닫은 뒤에도 자동 새로고침 버튼이 `자동 재개` 상태로 남아 있는지 확인합니다.
7. 반대로 자동 새로고침이 켜진 상태에서 운영 점검창을 열고 닫으면 타이머가 다시 정상 진행되는지 확인합니다.

##### 기대 결과
* 정상 시트가 `timestamp`, `orderNo` 같은 예전 영문 헤더 누락으로 경고 처리되지 않습니다.
* 잘못된 비밀번호 입력 후에도 재입력이 가능합니다.
* 주방 화면 자동 새로고침 일시정지 상태가 운영 점검 모달 때문에 임의로 바뀌지 않습니다.

#### 6. Caution (주의사항)

* GAS 추가 배포 필요 여부: **필요**. `diagnoseSystem`의 기준 헤더가 바뀌었으므로 Apps Script 새 배포가 필요합니다.
* Service Worker Cache 업데이트 필요 여부: **필요**. `kiosk-cache-v93`으로 올렸습니다.
* DB 컬럼 추가 여부: **없음**. 현재 시트 구조를 새로 바꾸지 않고 진단 기준만 실제 구조에 맞췄습니다.
* 환경설정 변경 여부: **없음**. `ADMIN_TOKEN`, `KAKAO_REST_API_KEY`, `KAKAO_GUEST_KEY_SALT` 등 기존 속성 정책은 그대로입니다.

#### 7. Do Not (절대 하지 말 것)

* `주문내역` A~U 컬럼 순서를 운영 점검 경고를 없애기 위해 임의로 이동하지 마세요.
* `userId === 'guest'` 판정이나 주문 생성 로직을 운영 점검 수정과 함께 건드리지 마세요.
* `diagnoseSystem`을 관리자 토큰 없이 상세 정보를 반환하도록 바꾸지 마세요.

#### 8. Future Improvements (향후 개선)

* 운영 점검 결과에서 누락 컬럼을 클릭하면 “어느 시트 몇 열에 무엇을 넣어야 하는지”를 더 쉽게 보여주는 도움말을 추가할 수 있습니다.
* 실제 GAS 배포 버전과 GitHub Pages 정적 파일 버전을 화면에서 함께 보여주는 배포 버전 점검을 검토할 수 있습니다.

#### 9. Summary (요약)

##### 무엇이 바뀌었는가?

* 운영 점검의 시트 헤더 기준을 실제 코드와 맞췄고, 비밀번호 재입력 및 주방 자동 새로고침 상태 보존 문제를 수정했습니다.

##### 왜 바뀌었는가?

* 정상 운영 상태를 오류로 오판하지 않고, 운영 점검 모달이 관리자/주방 화면의 기존 상태를 해치지 않게 하기 위해서입니다.

##### 운영자가 확인할 것

* GAS 새 배포 후 `admin.html`과 `kitchen.html`의 `운영 점검`에서 정상 비밀번호/틀린 비밀번호/주방 자동 새로고침 일시정지 상태를 한 번씩 확인하세요.

---

### 작업 기록 (Development Log) - 24) 운영 점검 DB 헤더 오탐 수정

#### 작업명
> 실제 운영 스프레드시트의 한글 헤더와 과거 배송지 컬럼 구조를 운영 점검이 정상으로 인식하도록 수정

#### 1. Issue (문제)

##### 증상
* 운영 점검에서 `간식목록`, `이용자목록`, `주문내역`, `주문보관`이 구조 불일치로 표시되었습니다.
* 첨부된 `주간보호 매점DB.xlsx` 기준으로 확인하면, `간식목록`과 `이용자목록`은 실제 운영 시트가 한글 헤더를 사용하고 있었으나 진단 기준은 `snackId`, `userId` 같은 내부 영문 필드명을 기대하고 있었습니다.
* `주문내역`은 현재 운영 DB에 과거 호환 컬럼인 `deliveryAddress`가 P열에 남아 있고, `deliveryPlace`가 별도로 존재해 진단이 열 순서 불일치로 표시했습니다.
* `주문보관`은 실제로는 A~O 기본 보관 헤더만 있어도 현재 보관 기능이 동작하지만, 진단은 P~R 확장 컬럼까지 필수로 요구했습니다.

##### 영향
* 실제 운영 오류가 아닌 상태도 `주의 및 확인 필요`로 표시되어 운영자가 불필요하게 시트 구조를 손댈 위험이 있었습니다.
* 특히 주문내역 컬럼을 운영 중 수동 이동하면 배송지, 취소 사유, 카카오 식별 컬럼 데이터가 더 크게 꼬일 수 있으므로 오탐 제거가 필요했습니다.

#### 2. Cause (원인 분석)

##### 원인
* 운영 점검의 `expectedHeaders`가 코드 내부 객체 필드명 기준으로 작성되어 실제 구글시트 1행 헤더와 맞지 않았습니다.
* 과거 `deliveryAddress`와 현재 코드 변수명 `deliveryPlace`가 혼재된 상태를 진단 로직이 호환 구조로 인정하지 않았습니다.
* 보관 시트는 운영상 기본 A~O 헤더만으로도 조회/보관 흐름이 유지되는데, 진단 기준이 더 엄격했습니다.

##### 조사 과정
* 첨부 엑셀의 시트별 1행 헤더를 확인했습니다.
* `google-apps-script.md`의 `getUsers`, `getSnacks`, `placeOrder`, `ensureOrderHeaders`, `archiveOldOrders`, `diagnoseSystem`을 대조했습니다.
* 주문 생성/조회 로직은 여전히 A~O 및 P열 이후 고정 위치/일부 헤더 인덱스를 섞어 쓰므로, 운영 중인 시트 컬럼을 자동 재배열하는 방식은 위험하다고 판단했습니다.

#### 3. Decision (결정)

##### 해결 방법
* `이용자목록` 기대 헤더를 `이용자ID`, `별명`, `크레딧`, `사용여부`, `사진url` 기준으로 수정했습니다.
* `간식목록` 기대 헤더를 `간식ID`, `이름`, `포인트`, `사진URL`, `판매여부`, `재고`, `표시순서`, `제공대상` 기준으로 수정했습니다.
* 영문 필드명으로 된 예전/테스트 시트도 진단할 수 있도록 헤더 alias를 추가했습니다.
* `주문내역`은 다음 세 가지 P열 이후 구조를 호환 정상 구조로 인정합니다.
  * P=`deliveryPlace`, Q=`cancelReason`, R=`cancelReasonDetail`, S=`guestDeviceId`, T=`authProvider`, U=`guestKey`
  * P=`deliveryAddress`, Q=`cancelReason`, R=`cancelReasonDetail`, S=`guestDeviceId`, T=`authProvider`, U=`guestKey`
  * P=`deliveryAddress`, Q=`cancelReason`, R=`deliveryPlace`, S=`cancelReasonDetail`, T=`guestDeviceId`, U=`authProvider`, V=`guestKey`
* `ensureOrderHeaders()`는 새 중복 컬럼 생성을 막기 위해 주문 확장 컬럼의 기본 이름을 `deliveryAddress`로 유지하도록 수정했습니다.
* `주문보관` 진단은 A~O 기본 보관 헤더만 필수로 보도록 완화했습니다.

##### 결정 이유
* 지금 필요한 것은 DB 컬럼 이동이 아니라 운영점검의 오탐 제거입니다.
* 실제 운영 데이터가 들어 있는 시트의 열을 코드가 자동으로 재배열하면 기존 주문/배송지/카카오 식별 데이터 위치가 틀어질 수 있습니다.
* 진단은 현재 운영 DB와 새로 생성될 DB 양쪽을 모두 안전하게 인정해야 합니다.

##### 변경 파일
* `google-apps-script.md`
* `handoff.md`

#### 4. Verification (검증)

##### 코드 검증
* [x] 문법 검사: `node check_syntax.js`
* [x] 정적 분석: 첨부 엑셀 헤더와 운영점검 기준 대조 검사
* [x] 빌드 성공: 정적 HTML/GAS 소스라 별도 빌드 없음
* [ ] 콘솔 오류 없음: 실제 GAS 배포 후 브라우저에서 수동 확인 필요

##### 기능 검증
* [x] 기존 기능 영향 없음: 주문 생성/조회 데이터 이동 로직은 수정하지 않음
* [x] 신규 기능 정상 동작: 첨부 엑셀의 실제 헤더 구조를 기준으로 진단 기준을 재정렬
* [ ] 예외 상황 확인: 실제 GAS 새 배포 후 운영점검 화면에서 재확인 필요

#### 5. Manual Test (수동 테스트)

##### 테스트 순서

1. 최신 `google-apps-script.md`를 Apps Script에 복사하고 새 배포합니다.
2. `admin.html` 또는 `kitchen.html`에서 `운영 점검`을 엽니다.
3. 관리자 비밀번호를 입력해 상세 진단을 실행합니다.
4. `간식목록`, `이용자목록`, `주문내역`, `주문보관` 경고가 사라졌는지 확인합니다.
5. 이후 게스트 포장/배달 주문 1건씩 넣고 주방 화면과 주문조회 화면에서 배송지/주문표시명이 정상 표시되는지 확인합니다.

##### 기대 결과
* 한글 헤더를 쓰는 정상 운영 시트가 더 이상 영문 필드명 누락으로 경고 처리되지 않습니다.
* 현재 운영 DB의 `deliveryAddress` 호환 구조가 운영점검에서 정상으로 인식됩니다.
* 시트 컬럼을 수동 이동하지 않아도 됩니다.

#### 6. Caution (주의사항)

* GAS 추가 배포 필요 여부: **필요**. `diagnoseSystem`과 `ensureOrderHeaders`가 변경되었습니다.
* Service Worker Cache 업데이트 필요 여부: **없음**. 정적 화면 파일은 변경하지 않았습니다.
* DB 컬럼 추가 여부: **없음**. 기존 컬럼을 이동하거나 추가하지 않습니다.
* 환경설정 변경 여부: **없음**.

#### 7. Do Not (절대 하지 말 것)

* 운영점검 경고를 없애기 위해 `주문내역`의 P~V 컬럼을 수동으로 이동하지 마세요.
* `deliveryAddress`와 `deliveryPlace`를 즉시 병합/삭제하지 마세요. 배송지 관련 기존 주문 데이터 위치를 먼저 별도 백업 후 검토해야 합니다.
* 간식/이용자 시트 헤더를 영문 필드명으로 바꾸지 마세요. 현재 운영 시트의 한글 헤더가 정상 기준입니다.

#### 8. Future Improvements (향후 개선)

* 장기적으로는 주문내역 P열 이후 구조를 하나의 표준으로 정리하는 마이그레이션 도구를 별도 작업으로 만들 수 있습니다.
* 다만 운영 중 자동 마이그레이션은 위험하므로, 백업 파일 확보 후 테스트 시트에서 먼저 검증해야 합니다.

#### 9. Summary (요약)

##### 무엇이 바뀌었는가?

* 운영점검이 실제 운영 DB의 한글 헤더와 과거 배송지 호환 컬럼 구조를 정상으로 인식하도록 변경했습니다.

##### 왜 바뀌었는가?

* 실제 오류가 아닌 헤더명 차이 때문에 운영자가 정상 시트를 장애로 오해하지 않도록 하기 위해서입니다.

##### 운영자가 확인할 것

* GAS 새 배포 후 운영점검을 다시 눌러, 이번에 표시된 `간식목록`, `이용자목록`, `주문내역`, `주문보관` 경고가 사라지는지 확인하세요.
