# 간식 키오스크 프로젝트 핸드오프 (Handoff)

이 파일은 프로젝트 작업 진행 상황을 기록하고 추적하기 위한 핸드오프 문서입니다.

## 진행 현황 요약
- **현재 진행 단계**: 전체 개발 완료 및 검증 대기
- **다음 진행 단계**: 로컬 서버에서 브라우저 검증 및 실사용 테스트

---

## 작업 목록 및 진행 상황

### [x] 1. 공통 환경 설정 (설계)
- [x] `js/config.js` 생성 및 Google Apps Script API URL 환경설정 및 Mock API 폴백 구현
- [x] `js/app.js` 공통 유틸리티 및 `localStorage` 관리 기능 구현
- [x] `css/style.css` 공통 모바일 우선 가독성 디자인 테마 구현 (최소 버튼 높이 48px 이상, 대형 폰트)

### [x] 2. [4단계] 이용자 선택 화면 (`index.html`)
- [x] `getUsers` API 연동
- [x] 이용자 별명 카드형 UI 큰 버튼으로 표시
- [x] 클릭 시 `selectedUser` `localStorage` 저장 및 `menu.html` 이동
- [x] 로딩 상태 및 API 예외 처리 화면

### [x] 3. [5단계] 간식 선택 화면 (`menu.html`)
- [x] 현재 로그인 사용자 정보 및 잔여 크레딧 상단 표시
- [x] `getSnacks` API 연동 (이미지 없을 시 기본 일러스트 이모지 대체)
- [x] 간식별 큰 `+` / `-` 버튼 수량 조절 및 실시간 총 사용 포인트 계산
- [x] 크레딧 초과 방지 체크 (실수 방지 경고)
- [x] 하단 고정 주문 버튼 및 `confirm.html` 이동 (`cart` 임시 저장)

### [x] 4. [6단계] 주문 확인 화면 (`confirm.html`)
- [x] `selectedUser`와 `cart` 데이터 기반 최종 주문 리스트 확인
- [x] 예상 잔여 크레딧 계산 및 잔액 부족 시 경고 및 주문 불가 처리
- [x] `placeOrder` API 연동 (POST JSON)
- [x] 이전으로 / 주문하기 큰 버튼 배치
- [x] 로딩 모달 및 에러 처리 (성공 시 `complete.html` 이동)

### [x] 5. [7단계] 주문 완료 화면 (`complete.html`)
- [x] 주문 완료 메시지 & 잔여 크레딧 크게 표시
- [x] `cart` 클리어
- [x] 5초 후 메인으로 자동 이동 타이머 및 "처음으로" 큰 버튼 제공

### [x] 6. [8단계] 관리자 주문 조회 (`admin.html`)
- [x] `getOrdersToday` API 연동 및 오늘 주문 리스트 표시
- [x] 간식별 집계 UI 카드 제공
- [x] 이용자별 집계 UI 카드 제공
- [x] 30초 자동 새로고침 인디케이터 및 갱신 기능
- [x] 모바일/PC 반응형 대시보드 레이아웃

---

## 프로젝트 파일 구조

```
/ (c:\Users\sec\Desktop\키오스크)
├── index.html            (이용자 선택 화면)
├── menu.html             (간식 선택 화면)
├── confirm.html          (주문 확인 화면)
├── complete.html         (주문 완료 화면)
├── admin.html            (관리자 오늘 주문 조회 및 집계 화면)
├── handoff.md            (개발 이력 및 현황 관리 문서)
├── css/
│   └── style.css         (공통 가독성 향상 UI 스타일링)
└── js/
    ├── config.js         (Google Apps Script API 및 Fallback Mock 연동)
    └── app.js            (공통 상태 저장 및 모바일 햅틱 진동 피드백 제어)
```
