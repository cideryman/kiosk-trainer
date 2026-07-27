# 🎨 관리자 UI 디자인 요소 추출 가이드 (Vanilla CSS)

새로운 디자인(Stitch Smart Admin Hub Pro)에서 핵심적인 시각 요소들만 분리하여, 기존 Vanilla JS + GAS 환경에 즉시 적용할 수 있도록 정리했습니다.

---

## 1. 색상 시스템 (Color System)
Tailwind 설정에 정의된 모던 색상 팔레트입니다. `:root`에 CSS 변수로 선언하여 사용합니다.

```css
:root {
  /* 배경 및 표면 (Background & Surface) */
  --bg-main: #f7fafc;             /* 전체 배경 */
  --surface-default: #ebeef0;     /* 기본 패널 표면 */
  --surface-low: #f1f4f6;         /* 밝은 표면 */
  --surface-lowest: #ffffff;      /* 가장 밝은 표면 (카드 등) */
  
  /* 프라이머리 (Primary - 남색 계열) */
  --primary-main: #002045;        /* 메인 텍스트, 헤더 */
  --primary-container: #1a365d;   /* 진한 컨테이너 배경 */
  --primary-light: #d6e3ff;       /* 밝은 하이라이트 배경 */
  
  /* 세컨더리 (Secondary - 오렌지/브라운 계열) */
  --secondary-main: #9d4400;      /* 강조 버튼, 액션 */
  --secondary-container: #fe8439; /* 포인트 배경 */
  --on-secondary-container: #662900; /* 포인트 배경 위 텍스트 */
  
  /* 상태 및 경계선 */
  --error-main: #ba1a1a;          /* 에러, 부족, 삭제 */
  --border-variant: #c4c6cf;      /* 연한 테두리 */
  --text-main: #181c1e;           /* 기본 텍스트 */
  --text-muted: #43474e;          /* 보조 텍스트 */
}
```

---

## 2. 버튼 스타일 (Button Styles)
새 디자인의 버튼은 적절한 여백과 부드러운 전환 효과(Transition)가 특징입니다.

```css
/* 기본 버튼 공통 스타일 */
.btn-modern {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  border: none;
}
.btn-modern:active {
  transform: scale(0.95);
}

/* 주요 액션 버튼 (Primary) */
.btn-modern-primary {
  background-color: var(--primary-main);
  color: #ffffff;
}
.btn-modern-primary:hover {
  background-color: var(--primary-container);
}

/* 강조 버튼 (Secondary) */
.btn-modern-secondary {
  background-color: var(--secondary-main);
  color: #ffffff;
}
.btn-modern-secondary:hover {
  background-color: #7a3500;
}

/* 아웃라인 버튼 (Outline) */
.btn-modern-outline {
  background-color: transparent;
  color: var(--primary-main);
  border: 1px solid var(--border-variant);
}
.btn-modern-outline:hover {
  background-color: var(--surface-low);
  border-color: var(--primary-main);
}
```

---

## 3. 카드 UI 구조 (Card UI)
기존의 답답한 느낌을 줄이고, 그림자와 둥근 모서리를 강조한 모던한 카드 뷰(주로 후기 관리나 대시보드 요약에 적합)입니다.

```html
<!-- HTML 구조 -->
<div class="modern-card">
  <div class="modern-card-header">
    <div class="card-title-group">
      <span class="material-symbols-outlined icon-primary">group</span>
      <h3 class="card-title">❤️ 이용자 온기 관리</h3>
    </div>
    <span class="card-badge">3 신규</span>
  </div>
  <div class="modern-card-body">
    <!-- 콘텐츠 배치 -->
  </div>
</div>
```

```css
/* CSS 스타일 */
.modern-card {
  background-color: var(--surface-lowest);
  border-radius: 12px;
  border: 1px solid var(--border-variant);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow 0.3s ease;
}
.modern-card:hover {
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}

.modern-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-variant);
}

.card-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title {
  color: var(--primary-main);
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.card-badge {
  background-color: var(--error-main);
  color: #ffffff;
  padding: 4px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
}

.modern-card-body {
  padding: 16px;
}
```

---

## 4. 모달 디자인 (Modal Design)
모달 배경에 살짝 블러(Blur) 처리를 주고, 모달 창 자체가 둥글고 부드럽게 나타나도록 구성한 모던 스타일입니다.

```html
<!-- HTML 구조 -->
<div class="modern-modal-overlay" id="exampleModal">
  <div class="modern-modal-content">
    <button class="modern-modal-close" onclick="closeModal()">
      <span class="material-symbols-outlined">close</span>
    </button>
    <div class="modern-modal-header">
      <h2>상세 정보</h2>
    </div>
    <div class="modern-modal-body">
      <p>모달 내용입니다.</p>
    </div>
  </div>
</div>
```

```css
/* CSS 스타일 */
.modern-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background-color: rgba(24, 28, 30, 0.4); /* on-surface 색상 투명도 */
  backdrop-filter: blur(4px); /* 모던한 배경 블러 효과 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  
  /* 표시/숨김 트랜지션 (JS 클래스 토글 활용) */
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}
.modern-modal-overlay.is-open {
  opacity: 1;
  visibility: visible;
}

.modern-modal-content {
  background-color: var(--surface-lowest);
  width: 100%;
  max-width: 600px; /* 상황에 따라 조절 */
  border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
  position: relative;
  
  transform: scale(0.95);
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); /* 바운스 효과 */
}
.modern-modal-overlay.is-open .modern-modal-content {
  transform: scale(1);
}

.modern-modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--surface-low);
  border: none;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-main);
  transition: background 0.2s;
}
.modern-modal-close:hover {
  background: var(--surface-default);
}

.modern-modal-header {
  padding: 24px 24px 16px;
  border-bottom: 1px solid var(--border-variant);
}
.modern-modal-header h2 {
  margin: 0;
  color: var(--primary-main);
}

.modern-modal-body {
  padding: 24px;
  max-height: 70vh;
  overflow-y: auto;
}
```

---

## 5. 가져오면 안 되는 요소 (Do NOT Implement)

현재 키오스크/관리자 환경의 특성상 다음 요소들은 차용하지 않아야 합니다.

1. **지나치게 복잡한 Grid/Bento 레이아웃 (특히 테이블 대체 시):**
   - 사용자 목록이나 간식 목록을 작은 Grid Card(예: 4열 배치)로 변경하면 스크롤이 심해지고 데이터를 한눈에 파악하기 어렵습니다. 목록 데이터는 기존처럼 가독성 높은 표(`<table>`) 형태를 유지하는 것이 낫습니다.
2. **작은 폰트 크기 (`10px`, `12px`):**
   - 발달장애인 지원 환경 및 범용 접근성을 해칩니다. 최소 `14px`, 가급적 `16px` 이상의 기본 글꼴 크기를 유지해야 합니다.
3. **호버시 나타나는 아이콘 조작부 (`opacity-0 group-hover:opacity-100`):**
   - 드래그 앤 드롭 아이콘 등이 마우스를 올릴 때만 나타나는 방식(새 디자인의 순서 편집 기능)은 터치 기반 기기(키오스크, 태블릿)에서는 작동하지 않습니다. 무조건 항상 보이게(Visible) 유지해야 합니다.
4. **다중 HTML 페이지 분할:**
   - 탭이 아닌 별도 파일 로딩은 GAS 환경에서 지연 속도를 크게 만듭니다. 기존 SPA(Single Page Application) 탭 구조를 반드시 고수해야 합니다.
