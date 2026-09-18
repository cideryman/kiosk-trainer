const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== 키오스크 신규 이용자 셀프 등록 기능 검증 시작 ===');

const rootDir = path.resolve(__dirname, '..');

// 1. index.html 정적 검증
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
assert(indexHtml.includes('kiosk-register-overlay'), 'index.html: kiosk-register-overlay 모달 컨테이너 존재');
assert(indexHtml.includes('kiosk-register-nickname'), 'index.html: 별명 입력 인풋 존재');
assert(indexHtml.includes('tab-avatar-emoji'), 'index.html: 이모지 선택 탭 존재');
assert(indexHtml.includes('tab-avatar-photo'), 'index.html: 앨범 사진 선택 탭 존재');
assert(indexHtml.includes('emoji-picker-grid'), 'index.html: 이모지 그리드 컨테이너 존재');
assert(indexHtml.includes('kiosk-photo-input'), 'index.html: 파일 업로드 인풋 존재');
assert(indexHtml.includes('appendAddUserCard'), 'index.html: appendAddUserCard 함수 정의 및 호출');
assert(indexHtml.includes('submitKioskRegister'), 'index.html: submitKioskRegister 함수 정의');
assert(indexHtml.includes("'🐻'"), 'index.html: 기본 이모지 곰돌이 포함');
assert(indexHtml.includes('closeKioskRegisterModal'), 'index.html: 모달 닫기 함수 존재');
assert(indexHtml.includes("registerKioskUser"), 'index.html: API 호출 registerKioskUser 존재');
assert(indexHtml.includes("uploadImage"), 'index.html: 이미지 업로드 API 호출 존재');
console.log('✓ index.html 신규 등록 UI 및 스크립트 마크업 검증 완료');

// 2. css/style.css 스타일 검증
const styleCss = fs.readFileSync(path.join(rootDir, 'css', 'style.css'), 'utf8');
assert(styleCss.includes('.user-card.user-card-add'), 'style.css: 신규 등록 카드 스타일 존재');
assert(styleCss.includes('.user-avatar-emoji-wrap'), 'style.css: 이모지 아바타 스타일 존재');
assert(styleCss.includes('.kiosk-register-modal'), 'style.css: 신규 등록 모달 스타일 존재');
assert(styleCss.includes('.emoji-picker-grid'), 'style.css: 이모지 선택 그리드 스타일 존재');
assert(styleCss.includes('.user-card-add-icon'), 'style.css: 신규 카드 아이콘 스타일 존재');
assert(styleCss.includes('.btn-register-submit'), 'style.css: 등록 제출 버튼 스타일 존재');
console.log('✓ css/style.css 신규 등록 및 아바타 스타일 검증 완료');

// 3. js/app.js 헬퍼 함수 정적 검증
const appJs = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf8');
assert(appJs.includes('isEmojiAvatar(imageUrl)'), 'js/app.js: isEmojiAvatar 함수 존재');
assert(appJs.includes('extractEmoji(imageUrl)'), 'js/app.js: extractEmoji 함수 존재');
assert(appJs.includes('renderUserAvatarHtml(user, fallbackBgColor)'), 'js/app.js: renderUserAvatarHtml 함수 존재');
assert(appJs.includes('prepareImageFileForUpload'), 'js/app.js: prepareImageFileForUpload 함수 존재');
assert(appJs.includes("text.startsWith('emoji:')"), 'js/app.js: emoji: 접두사 판정 로직 존재');
assert(appJs.includes('user-avatar-emoji-wrap'), 'js/app.js: 이모지 아바타 HTML 렌더링 존재');
console.log('✓ js/app.js 아바타 헬퍼 함수 정적 검증 완료');

// 4. GAS 파일 로직 및 라우팅 정합성 검증
const gasUsers = fs.readFileSync(path.join(rootDir, 'gas', '20_Users.gs'), 'utf8');
assert(gasUsers.includes('function registerKioskUser(data)'), 'gas/20_Users.gs: registerKioskUser 함수 존재');
assert(gasUsers.includes('DEFAULT_USER_ORDER_LIMIT'), 'gas/20_Users.gs: 기본 한도 고정 로직 존재');
assert(gasUsers.includes('중복 닉네임 검사'), 'gas/20_Users.gs: 닉네임 중복 검사 존재');
assert(gasUsers.includes("'키오스크 현장 등록'"), 'gas/20_Users.gs: 어드민 로그 출처 표시 존재');
assert(gasUsers.includes('selfRegister: true'), 'gas/20_Users.gs: 셀프 등록 플래그 존재');
console.log('✓ gas/20_Users.gs registerKioskUser 구현 검증 완료');

const gasRouter = fs.readFileSync(path.join(rootDir, 'gas', '01_Router.gs'), 'utf8');
assert(gasRouter.includes("action === 'registerKioskUser'"), 'gas/01_Router.gs: registerKioskUser 라우팅 존재');
console.log('✓ gas/01_Router.gs registerKioskUser 라우팅 검증 완료');

const gasMedia = fs.readFileSync(path.join(rootDir, 'gas', '50_Media.gs'), 'utf8');
assert(gasMedia.includes("type === 'kioskUser'"), 'gas/50_Media.gs: kioskUser 업로드 허용 분기 존재');
assert(gasMedia.includes("USER_IMAGE_FOLDER_ID"), 'gas/50_Media.gs: kioskUser -> USER 폴더 지정 확인');
console.log('✓ gas/50_Media.gs kioskUser 이미지 업로드 지원 검증 완료');

// 5. js/admin.js 호환성 검증
const adminJs = fs.readFileSync(path.join(rootDir, 'js', 'admin.js'), 'utf8');
assert(adminJs.includes('AppState.isEmojiAvatar(rawImgUrl)'), 'js/admin.js: 관리자 목록 이모지 아바타 렌더링 지원');
assert(adminJs.includes('AppState.extractEmoji(rawImgUrl)'), 'js/admin.js: 관리자 목록 이모지 추출 지원');
console.log('✓ js/admin.js 관리자 목록 이모지 아바타 호환성 검증 완료');

// 6. js/config.js Mock API 검증
const configJs = fs.readFileSync(path.join(rootDir, 'js', 'config.js'), 'utf8');
assert(configJs.includes("action === 'registerKioskUser'"), 'js/config.js: mock registerKioskUser 핸들러 존재');
assert(configJs.includes("action === 'uploadImage'"), 'js/config.js: mock uploadImage 핸들러 존재');
assert(configJs.includes('isDuplicate'), 'js/config.js: 중복 검사 로직 존재');
console.log('✓ js/config.js mock API 핸들러 검증 완료');

// 7. service-worker.js 캐시 버전 검증
const swJs = fs.readFileSync(path.join(rootDir, 'service-worker.js'), 'utf8');
assert(swJs.includes('kiosk-cache-v379'), 'service-worker.js: 최신 v379 캐시 적용');
console.log('✓ service-worker.js 최신 캐시 버전 v379 검증 완료');

console.log('');
console.log('=== 모든 자동 검증 테스트 통과! ✅ ===');
