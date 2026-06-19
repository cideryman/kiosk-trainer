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

## 7. Future Roadmaps & Considerations (다음 작업 고려 목록)

* **[RESOLVED] Review Visibility Toggle Error**:
  - **Problem**: Clicking the public/private visibility toggle on the review moderation page (`reviews.html`) triggered a "구글시트 연결에 실패했습니다" (failed to connect to google sheet) popup error.
  - **Resolution**: Fixed in [google-apps-script.md](file:///c:/Users/주간보호/OneDrive/Desktop/새 폴더/kiosk-trainer/google-apps-script.md) by correcting the backend typo where it called `verifyAdmin` instead of `verifyAdminToken(data)`, and added `'toggleReviewVisibility'` to the `ADMIN_ACTIONS` routing whitelist array.

* **[ROADMAP] 키오스크 안정성 및 접근성 개선 제안 사항**:
  - **제안 2) 유휴 시간 감지 자동 로그아웃 (Idle Timeout)**:
    - **내용**: `menu.html`, `confirm.html` 등에서 60~90초간 터치 이벤트가 없을 시 자동으로 카트와 유저 세션을 리셋하고 처음 화면(`index.html`)으로 복귀하도록 유휴 타이머 적용. 10초 전 화면이 어두워지며 TTS 음성 경고 송출.
  - **제안 3) 오프라인 상태 대응 전면 안내 팝업**:
    - **내용**: `window.addEventListener('offline')` 연동. 인터넷이 일시 단절될 경우 브라우저 에러창이나 정지 대신 친근한 안내 팝업과 캐릭터 일러스트, 안내 TTS를 제공하여 발달장애 이용자의 심리적 불안 최소화. 복구 시 자동 복귀.


