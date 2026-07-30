(function () {
  'use strict';

  const DIALOG_ID = 'public-brand-story-dialog';
  let lastTrigger = null;

  function createBrandStoryDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'brand-story-dialog';
    dialog.setAttribute('aria-labelledby', 'public-brand-story-title');
    dialog.innerHTML = `
      <div class="brand-story-dialog-inner">
        <button type="button" class="brand-story-dialog-close" data-brand-story-close aria-label="브랜드 이야기 닫기">&times;</button>
        <div class="brand-story-dialog-heading">
          <img src="icons/guest-192.png" alt="">
          <div>
            <span class="brand-story-dialog-eyebrow">배달왔삼 이야기</span>
            <h2 class="brand-story-dialog-title" id="public-brand-story-title">왜 배달왔<span class="brand-story-title-origin">삼</span>인가요?</h2>
          </div>
        </div>
        <div class="brand-story-dialog-copy">
          <p>‘배달왔삼’의 <strong class="brand-story-origin">‘삼’</strong>은 복지관이 자리한 지역, <strong class="brand-story-origin">‘삼각지’</strong>를 의미합니다.</p>
          <p>이름에 ‘장애인’이라는 표현을 넣지 않은 것은 장애 여부로 서비스를 구분하기보다, <strong>누구나 누리는 일상의 경험</strong>으로 바라봤기 때문입니다. 우리가 ‘배달의민족’을 ‘비장애인의 배달 서비스’라고 부르지 않듯, 배달 서비스의 본질은 익숙한 일상을 연결하는 데 있습니다.</p>
          <p>그래서 배달왔삼은 장애 여부보다 우리가 함께 살아가는 공간인 ‘삼각지’를 이름에 담았습니다. 지역 안에서 <strong>사람과 사람을 자연스럽게 <span class="brand-story-action">잇는</span> 일상의 서비스</strong>가 되기를 바라는 마음입니다.</p>
        </div>
        <button type="button" class="brand-story-dialog-confirm" data-brand-story-close>닫기</button>
      </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
  }

  function initBrandStory() {
    const triggers = Array.from(document.querySelectorAll('[data-public-brand-story]'));
    if (!triggers.length) return;

    const dialog = document.getElementById(DIALOG_ID) || createBrandStoryDialog();

    triggers.forEach((trigger) => {
      trigger.addEventListener('click', () => {
        lastTrigger = trigger;
        if (!dialog.open) dialog.showModal();
      });
    });

    dialog.querySelectorAll('[data-brand-story-close]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dialog.close();
    });

    dialog.addEventListener('close', () => {
      lastTrigger?.focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBrandStory, { once: true });
  } else {
    initBrandStory();
  }
})();
