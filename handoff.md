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
  - Bumped the service worker version in [service-worker.js](file:///c:/Users/user/Desktop/키오스크/service-worker.js) to `kiosk-cache-v46` to force-update client browsers and bypass stale local HTML caches.

### 7) Guest Double-Order Prevention & Cache Issue Resolution
* **Guest Double-Order Prevention**:
  - Implemented client-side detection in `guest.html`: Checks `localStorage` (`guestOrders`) for active orders matching today's date (formatted as `YYYY-M-D`). Shows a warning notice if an active order exists.
  - Implemented server-side check in `placeOrder` (GAS): Uses `guestDeviceId` to scan the active orders list and blocks new orders if there is an active order for the same day.
* **Cache/Past Orders Limit Fix**:
  - Solved issues where cached orders from previous days blocked today's orders.
  - Strictly limited the active order check to the current date (`isSameKoreaDate` on server, local date string comparison on client), ensuring yesterday's or past cached orders do not restrict new orders.

---

## 6. Implementation Notes & Cautions

* **API Calls & Mocks**: While developing locally, you can switch between mock database and live spreadsheet database in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) using the `USE_MOCK` boolean value.
* **Touch Jitter (Double-Click Prevention)**: Users with motor control challenges might trigger duplicate clicks. Use `AppState.bindCardTap(el, callback)` instead of standard click handlers for critical buttons in user-facing views to check coordinates delta and timing.
* **Haptic Feedbacks**: Sounds are created using the Web Audio API synthesizer dynamically. Do not rely on external MP3 files for general interaction sounds.
* **Google Apps Script Deployments**: If you modify the backend API routes or settings, copy code from [google-apps-script.md](file:///c:/Users/user/Desktop/키오스크/google-apps-script.md) into the Google Sheet Script Editor, save, and trigger **[New Deployment]** (Web App, executing as Me, accessible by Anyone). Update `API_URL` in [js/config.js](file:///c:/Users/user/Desktop/키오스크/js/config.js) to match the new address.
