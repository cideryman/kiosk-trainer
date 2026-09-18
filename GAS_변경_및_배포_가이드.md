# 🚀 GAS(Google Apps Script) 변경 및 배포 가이드 (키오스크 신규 이용자 셀프 등록)

본 문서는 **키오스크 메인 화면 내 신규 이용자 셀프 등록(이모티콘 및 기기 앨범 사진 지원) 기능**을 구글 스프레드시트(GAS)에 반영하기 위한 가이드입니다.

---

## 📌 변경된 GAS 파일 목록 (3개)

1. **[`gas/20_Users.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/20_Users.gs)**
   - `registerKioskUser(data)` 함수 추가: 관리자 로그인 없이 키오스크 현장에서 직접 이용자를 등록하며, 1회 주문 한도는 10으로 고정되고 기존 이용자 별명(이름) 중복을 방지합니다.
2. **[`gas/01_Router.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/01_Router.gs)**
   - `doPost` 라우팅에 `registerKioskUser` 액션 추가 (공개 호출 가능).
3. **[`gas/50_Media.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/50_Media.gs)**
   - `uploadImage` API에서 `type === 'kioskUser'` 지원 추가 (키오스크 현장 이용자 등록 시 앨범 사진 업로드 허용).

*(그 외 HTML/JS/CSS 등 프론트엔드 파일들은 이미 로컬 프로젝트 폴더에 모두 완벽히 반영되어 있습니다.)*

---

## 🛠️ GAS 적용 절차 (단계별)

### 1단계: Google Apps Script 편집기 접속
1. 키오스크/배달왔삼 구글 스프레드시트를 엽니다.
2. 상단 메뉴에서 **[확장 프로그램] > [Apps Script]**를 클릭합니다.

### 2단계: 코드 업데이트 (3개 파일)

#### ① `20_Users.gs` 파일 업데이트
- Apps Script 좌측 파일 목록에서 `20_Users.gs`를 클릭합니다.
- 로컬의 [`gas/20_Users.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/20_Users.gs) 전체 내용을 복사하여 웹 편집기에 붙여넣고 저장(Ctrl+S)합니다.

#### ② `01_Router.gs` 파일 업데이트
- Apps Script 좌측 파일 목록에서 `01_Router.gs`를 클릭합니다.
- 로컬의 [`gas/01_Router.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/01_Router.gs) 전체 내용을 복사하여 웹 편집기에 붙여넣고 저장(Ctrl+S)합니다.

#### ③ `50_Media.gs` 파일 업데이트
- Apps Script 좌측 파일 목록에서 `50_Media.gs`를 클릭합니다.
- 로컬의 [`gas/50_Media.gs`](file:///c:/Users/sec/Desktop/키오스크/gas/50_Media.gs) 전체 내용을 복사하여 웹 편집기에 붙여넣고 저장(Ctrl+S)합니다.

### 3단계: 웹 앱 새 버전 배포
1. Apps Script 우측 상단 파란색 **[배포] > [배포 관리]** 클릭
2. 활성 배포 옆의 **연필 아이콘(수정)** 클릭
3. **버전**: `[신규 버전]` 선택
4. **설명**: `키오스크 신규 이용자 등록 및 이모지/앨범 사진 지원` 입력 후 **[배포]** 클릭!
