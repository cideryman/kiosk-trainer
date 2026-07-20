const ADMIN_TOKEN_STORAGE_KEY = AdminAuth.storageKey;

function esc(value) {
  return AppState.escapeHtml(value);
}

function attr(value) {
  return AppState.escapeAttr(value);
}

function stripEmojis(text) {
  if (!text) return '';
  // 이모티콘 및 확장 유니코드 기호 제거 정규식
  return text.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
}

const replyStampMapping = {
  '응원 고마워요': { img: 'assets/dalgomi_reply_heart.png', text: '감동이야!' },
  '맛있게 먹어줘서 기뻐요': { img: 'assets/dalgomi_reply_thumb.png', text: '최고예요!' },
  '안전하게 배달을 완료했어요': { img: 'assets/dalgomi_reply_delivery.png', text: '슝슝배달!' },
  '다음에 또 매점 이용해 주세요': { img: 'assets/dalgomi_reply_cheer.png', text: '힘내세요!' }
};

function getReplyStampInfo(replyText) {
  if (!replyText) return null;
  for (const key in replyStampMapping) {
    if (replyText.includes(key)) {
      return replyStampMapping[key];
    }
  }
  return null;
}

function speakReviewText(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const cleanedText = stripEmojis(text);
    if (!cleanedText) return;
    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn("TTS 재생 실패:", e);
  }
}

function speakReview(event, index) {
  if (event) {
    event.stopPropagation();
  }
  if (!cachedReviews || index < 0 || index >= cachedReviews.length) return;
  const review = cachedReviews[index];

  const stampMappingNames = {
    'dalgomi_thumb': '최고예요',
    'dalgomi_delivery': '슝슝배달',
    'dalgomi_heart': '감동이야',
    'dalgomi_cheer': '힘내세요',
    '👍 친절해요': '최고예요',
    '⚡ 빨라요': '슝슝배달',
    '🎁 감동이에요': '감동이야',
    '☕ 응원해요': '힘내세요'
  };

  const stampText = review.stamp ? (stampMappingNames[review.stamp] || review.stamp) : '';
  let speechText = `${review.guestName || '게스트'} 님이 남겨주신`;
  if (stampText) {
    speechText += ` ${stampText}`;
  }
  speechText += ` 후기입니다.`;

  if (review.comment) {
    speechText += ` 응원 메시지. ${review.comment}.`;
  } else {
    speechText += ` 등록된 응원 메시지가 없습니다.`;
  }

  if (review.replyText) {
    speechText += ` 직원의 감사 답글. ${review.replyText}.`;
  }

  speakReviewText(speechText);
}

function getAdminMemo() {
  const memoInput = document.getElementById('admin-change-memo');
  return memoInput ? memoInput.value.trim() : '';
}

function updateAdminTokenStatus() {
  AdminAuth.render();
}

function getAdminToken() {
  return AdminAuth.requireToken();
}

function withAdminToken(body) {
  return {
    ...body,
    adminToken: getAdminToken(),
    adminMemo: getAdminMemo()
  };
}

function clearAdminTokenIfDenied(res) {
  AdminAuth.handleDenied(res);
}

// 주문 데이터 및 집계 로드
async function loadAdminData() {
  try {
    const reviewsRes = await fetchAPI('getReviewsForAdmin', { method: 'POST', body: withAdminToken({}) });

    // 4. 후기 데이터 처리
    if (reviewsRes && reviewsRes.success && Array.isArray(reviewsRes.reviews)) {
      renderReviews(reviewsRes.reviews);
    } else {
      throw new Error('후기 API 응답 결과가 올바르지 않습니다.');
    }

  } catch (error) {
    if (error?.message === '관리자 잠금 해제가 필요합니다.') {
      return;
    }
    console.error('관리자 데이터 조회 실패:', error);
    const reviewContainer = document.getElementById('review-cards-container');
    if (reviewContainer) {
      reviewContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--danger-color); font-weight: 700; border: 2.5px dashed var(--border-color); border-radius: var(--radius-md); background-color: white;">
        데이터를 불러오지 못했습니다.<br><span style="font-size: 14px; font-weight: 600; color: var(--text-muted); display: block; margin-top: 8px;">(${error.message || '인터넷 연결 끊김'})</span>
      </div>`;
    }
  }
}

const REVIEWS_PAGE_SIZE = 20;
let visibleReviewCount = REVIEWS_PAGE_SIZE;

function updateReviewLoadMoreButton(totalVisibleReviews) {
  const button = document.getElementById('btn-load-more-reviews');
  if (!button) return;

  const remainingCount = Math.max(0, totalVisibleReviews - visibleReviewCount);
  button.hidden = remainingCount === 0;
  if (remainingCount > 0) {
    button.textContent = `후기 더 보기 (${Math.min(REVIEWS_PAGE_SIZE, remainingCount)}개)`;
  }
}

const stampMapping = {
  'dalgomi_thumb': { img: 'assets/dalgomi_thumb.png', text: '최고예요!' },
  'dalgomi_delivery': { img: 'assets/dalgomi_delivery.png', text: '슝슝배달!' },
  'dalgomi_heart': { img: 'assets/dalgomi_heart.png', text: '감동이야!' },
  'dalgomi_cheer': { img: 'assets/dalgomi_cheer.png', text: '힘내세요!' },
  '👍 친절해요': { img: 'assets/dalgomi_thumb.png', text: '최고예요!' },
  '⚡ 빨라요': { img: 'assets/dalgomi_delivery.png', text: '슝슝배달!' },
  '🎁 감동이에요': { img: 'assets/dalgomi_heart.png', text: '감동이야!' },
  '☕ 응원해요': { img: 'assets/dalgomi_cheer.png', text: '힘내세요!' }
};

function renderReviews(reviews) {
  const container = document.getElementById('review-cards-container');
  if (!container) return;

  cachedReviews = reviews;
  container.innerHTML = '';

  if (reviews.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1; width: 100%; padding: 40px 0;">등록된 후기가 없습니다.</div>';
    updateReviewLoadMoreButton(0);
    return;
  }

  const showPrivate = document.getElementById('toggle-private-reviews')?.checked;
  const filteredReviews = reviews
    .map((review, index) => ({ review, index }))
    .filter(({ review }) => {
      const isPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
      return isPub || showPrivate;
    });
  const visibleReviews = filteredReviews.slice(0, visibleReviewCount);

  visibleReviews.forEach(({ review, index }) => {
    const isPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
    
    const pubLabel = isPub ? '공개' : '비공개';
    const pubClass = isPub ? 'active' : 'inactive';
    
    const rawDate = review.createdAt ? new Date(review.createdAt) : null;
    let formattedDate = review.createdAt || '-';
    if (rawDate && !isNaN(rawDate.getTime())) {
      formattedDate = `${rawDate.toLocaleDateString()} ${String(rawDate.getHours()).padStart(2, '0')}:${String(rawDate.getMinutes()).padStart(2, '0')}`;
    }

    // 이미지 썸네일 HTML
    let imgHtml = '';
    if (review.imageUrl) {
      imgHtml = `
        <div class="review-card-thumbnail-wrapper">
          <img class="review-card-thumbnail" src="${AppState.escapeAttr(AppState.convertDriveImageUrl(review.imageUrl))}" alt="후기 사진" onerror="this.parentElement.style.display='none';">
        </div>
      `;
    }

    // 태그 칩스 HTML
    let tagsHtml = '';
    if (review.tags) {
      const tagList = review.tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        tagsHtml = `
          <div class="review-card-tags">
            ${tagList.map(tag => `<span class="review-tag-chip">#${esc(tag)}</span>`).join('')}
          </div>
        `;
      }
    }

    // 답글 박스 HTML
    let replyHtml = '';
    if (review.replyText) {
      const replyStamp = getReplyStampInfo(review.replyText);
      let replyStampHtml = '';
      if (replyStamp) {
        replyStampHtml = `<img src="${replyStamp.img}" style="width: 32px; height: 32px; object-fit: contain; vertical-align: middle; margin-right: 6px;" alt="${replyStamp.text}">`;
      }
      replyHtml = `
        <div class="review-card-reply-box" style="display: flex; align-items: center; gap: 4px;">
          <span style="color: var(--primary-color); flex-shrink: 0;">↳ 답글:</span>
          <div style="display: inline-flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${replyStampHtml}
            <span>${esc(review.replyText)}</span>
          </div>
        </div>
      `;
    }

    // 스탬프 배지 HTML
    const stampInfo = review.stamp ? (stampMapping[review.stamp] || { text: review.stamp }) : null;
    let dalgomiStickerHtml = '';
    if (stampInfo) {
      if (stampInfo.img) {
        dalgomiStickerHtml = `
          <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
            <img src="${stampInfo.img}" style="width: 85px; height: 85px; object-fit: contain;" alt="달곰이 이모티콘">
          </div>
        `;
      } else {
        tagsHtml += `<span class="review-tag-chip" style="background-color: #FFF9E6; border: 1.5px solid var(--primary-color); color: #E65100;">${esc(stampInfo.text)}</span>`;
      }
    }

    const card = document.createElement('div');
    card.className = `review-card`;
    card.setAttribute('data-review-index', index);
    card.setAttribute('title', `주문번호: ${review.orderId}`); // hover 툴팁으로만 주문번호 제공
    
    card.innerHTML = `
      <div class="review-card-header">
        <div class="review-card-meta">
          <span class="review-card-guest">${esc(review.guestName)} 님</span>
          <span class="review-card-date">${esc(formattedDate)}</span>
        </div>
        <div class="review-card-badges" style="display: flex; align-items: center; gap: 8px;">
          <span class="status-badge ${pubClass}" style="margin: 0; min-height: auto; padding: 2px 8px; font-size: 11px;">${pubLabel}</span>
          <button type="button" class="btn-speak-review" onclick="speakReview(event, ${index});" style="margin: 0;" title="후기 읽어주기" aria-label="후기 읽어주기">🔊</button>
        </div>
      </div>
      <div class="review-card-body" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; width: 100%;">
        <div class="review-card-content" style="flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left;">
          <div class="review-card-comment" style="word-break: break-all;">${esc(review.comment || '응원 메시지가 없습니다.')}</div>
          ${tagsHtml}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          ${dalgomiStickerHtml}
          ${imgHtml}
        </div>
      </div>
      ${replyHtml}
    `;

    card.onclick = () => openReviewDetail(index);
    container.appendChild(card);
  });

  updateReviewLoadMoreButton(filteredReviews.length);
  if (visibleReviews.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1; width: 100%; padding: 40px 0;">표시할 후기가 없습니다. (숨김 보기를 체크해보세요)</div>';
  }
}

// 초기 이벤트 설정
window.addEventListener('DOMContentLoaded', () => {
  AdminAuth.init({
    onUnlock: () => loadAdminData(),
    onLock: (options = {}) => {
      if (options.reload !== false) window.location.reload();
    }
  });
  updateAdminTokenStatus();

  const btnManualRefresh = document.getElementById('btn-manual-refresh');
  if (btnManualRefresh) {
    btnManualRefresh.addEventListener('click', () => {
      loadAdminData();
      AppState.vibrate(50);
    });
  }


  const togglePrivateReviews = document.getElementById('toggle-private-reviews');
  if (togglePrivateReviews) {
    togglePrivateReviews.addEventListener('change', () => {
      renderReviews(cachedReviews);
      AppState.vibrate(30);
    });
  }

  const btnLoadMoreReviews = document.getElementById('btn-load-more-reviews');
  if (btnLoadMoreReviews) {
    btnLoadMoreReviews.addEventListener('click', () => {
      visibleReviewCount += REVIEWS_PAGE_SIZE;
      renderReviews(cachedReviews);
      AppState.vibrate(30);
    });
  }
});

// --- 후기 상세 모달 로직 ---
let currentReviewIndex = -1;
let cachedReviews = [];

function openReviewDetail(index) {
  if (!cachedReviews || index < 0 || index >= cachedReviews.length) return;
  currentReviewIndex = index;
  const review = cachedReviews[index];

  const isPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
  const rawDate = review.createdAt ? new Date(review.createdAt) : null;
  let formattedDate = review.createdAt || '-';
  if (rawDate && !isNaN(rawDate.getTime())) {
    formattedDate = `${rawDate.toLocaleDateString()} ${String(rawDate.getHours()).padStart(2, '0')}:${String(rawDate.getMinutes()).padStart(2, '0')}`;
  }

  document.getElementById('rd-guest-name').textContent = review.guestName;
  document.getElementById('rd-created-at').textContent = formattedDate;
  const stickerContainer = document.getElementById('rd-stamp-sticker-container');
  if (review.stamp) {
    const stampInfo = stampMapping[review.stamp] || { text: review.stamp };
    if (stampInfo.img) {
      stickerContainer.innerHTML = `
        <img src="${stampInfo.img}" style="width: 140px; height: 140px; object-fit: contain;" alt="달곰이 이모티콘">
      `;
      stickerContainer.style.display = 'flex';
    } else {
      stickerContainer.style.display = 'none';
    }
  } else {
    stickerContainer.style.display = 'none';
  }
  document.getElementById('rd-tags').textContent = review.tags || '태그 없음';

  // 답글 데이터 로드 및 초기화
  const replyInput = document.getElementById('rd-reply-input');
  if (replyInput) {
    replyInput.value = review.replyText || '';
  }

  // 프리셋 버튼들 액티브 상태 초기화 및 설정
  const presets = document.querySelectorAll('.btn-reply-preset');
  presets.forEach(p => {
    p.classList.remove('active');
    const cleanPresetText = p.textContent.trim();
    if (review.replyText && review.replyText === cleanPresetText) {
      p.classList.add('active');
    }
  });

  const replyStatus = document.getElementById('rd-reply-status');
  if (replyStatus) {
    if (review.replyText) {
      const rDate = review.replyCreatedAt ? new Date(review.replyCreatedAt) : null;
      let formattedRDate = review.replyCreatedAt || '';
      if (rDate && !isNaN(rDate.getTime())) {
        formattedRDate = `${rDate.toLocaleDateString()} ${String(rDate.getHours()).padStart(2, '0')}:${String(rDate.getMinutes()).padStart(2, '0')}`;
      }
      const replyStamp = getReplyStampInfo(review.replyText);
      let replyStampImgHtml = '';
      if (replyStamp) {
        replyStampImgHtml = `<img src="${replyStamp.img}" style="width: 32px; height: 32px; object-fit: contain; vertical-align: middle; margin-left: 8px;" alt="${replyStamp.text}">`;
      }
      replyStatus.innerHTML = `<div style="display: inline-flex; align-items: center; gap: 4px;">🟢 답글 작성됨 ${replyStampImgHtml} <span style="font-size:12px; color:#A0AEC0; font-weight:500; margin-left: 6px;">(${formattedRDate})</span></div>`;
      replyStatus.style.color = '#38A169';
    } else {
      replyStatus.textContent = '작성된 답글이 없습니다.';
      replyStatus.style.color = '#A0AEC0';
    }
  }

  const commentEl = document.getElementById('rd-comment');
  if (review.comment) {
    commentEl.textContent = review.comment;
    commentEl.style.color = 'var(--text-dark)';
  } else {
    commentEl.textContent = '등록된 응원 메시지가 없습니다.';
    commentEl.style.color = '#A0AEC0';
  }

  const btnSpeakModal = document.getElementById('btn-speak-modal');
  if (btnSpeakModal) {
    btnSpeakModal.onclick = () => {
      speakReview(null, index);
    };
  }

  const photoContainer = document.getElementById('rd-photo-container');
  const photoEl = document.getElementById('rd-photo');
  if (review.imageUrl) {
    photoEl.src = AppState.convertDriveImageUrl(review.imageUrl);
    photoContainer.style.display = 'block';
  } else {
    photoContainer.style.display = 'none';
    photoEl.src = '';
  }

  // 이전/다음 버튼 활성/비활성 처리 (비공개 후기 필터 상태 반영)
  const showPrivate = document.getElementById('toggle-private-reviews')?.checked;
  
  let hasPrev = false;
  for (let i = index - 1; i >= 0; i--) {
    const r = cachedReviews[i];
    const isPub = r.isPublic === true || String(r.isPublic).toUpperCase() === 'TRUE' || r.isPublic === 'Y';
    if (isPub || showPrivate) {
      hasPrev = true;
      break;
    }
  }
  document.getElementById('btn-prev-review').disabled = !hasPrev;

  let hasNext = false;
  for (let i = index + 1; i < cachedReviews.length; i++) {
    const r = cachedReviews[i];
    const isPub = r.isPublic === true || String(r.isPublic).toUpperCase() === 'TRUE' || r.isPublic === 'Y';
    if (isPub || showPrivate) {
      hasNext = true;
      break;
    }
  }
  document.getElementById('btn-next-review').disabled = !hasNext;

  // 공개 상태에 따라 토글 버튼 텍스트 설정
  const toggleBtn = document.getElementById('btn-toggle-review-visibility');
  if (isPub) {
    toggleBtn.textContent = '현재: 공개 (비공개로 전환)';
    toggleBtn.style.color = '#C53030';
    toggleBtn.style.borderColor = '#FEB2B2';
  } else {
    toggleBtn.textContent = '현재: 비공개 (공개로 전환)';
    toggleBtn.style.color = '#2F855A';
    toggleBtn.style.borderColor = '#9AE6B4';
  }

  document.getElementById('review-detail-modal').style.display = 'flex';
}

async function toggleCurrentReviewVisibility() {
  if (currentReviewIndex < 0 || !cachedReviews[currentReviewIndex]) return;

  const review = cachedReviews[currentReviewIndex];
  const isCurrentlyPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
  const targetState = !isCurrentlyPub;

  const confirmMsg = targetState ? "이 후기를 '공개' 처리하시겠습니까?" : "이 후기를 '비공개' 처리하시겠습니까?";
  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-toggle-review-visibility');
  btn.textContent = '처리중...';
  btn.disabled = true;

  try {
    const res = await fetchAPI('toggleReviewVisibility', {
      method: 'POST',
      body: withAdminToken({
        createdAt: review.createdAt,
        orderId: review.orderId,
        isPublic: targetState
      })
    });

    if (res && res.success) {
      // 상태 업데이트
      review.isPublic = targetState ? 'Y' : 'N';
      openReviewDetail(currentReviewIndex);
      renderReviews(cachedReviews);
    } else {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '상태 변경에 실패했습니다.');
    }
  } catch (e) {
    alert('오류가 발생했습니다: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function closeReviewDetail() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  document.getElementById('review-detail-modal').style.display = 'none';
}

function navigateReview(offset) {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  const showPrivate = document.getElementById('toggle-private-reviews')?.checked;
  let nextIndex = currentReviewIndex + offset;
  
  while (nextIndex >= 0 && nextIndex < cachedReviews.length) {
    const review = cachedReviews[nextIndex];
    const isPub = review.isPublic === true || String(review.isPublic).toUpperCase() === 'TRUE' || review.isPublic === 'Y';
    if (isPub || showPrivate) {
      openReviewDetail(nextIndex);
      return;
    }
    nextIndex += offset;
  }
}

let isSubmittingAACReply = false;

window.selectAACReply = async function(buttonEl, replyText) {
  if (isSubmittingAACReply) return;

  // 1. 시각적 강조 피드백 (.active style) & 문구 스위칭
  const presets = document.querySelectorAll('.btn-reply-preset');
  presets.forEach(p => p.classList.remove('active'));
  buttonEl.classList.add('active');

  const input = document.getElementById('rd-reply-input');
  if (input) {
    input.value = replyText;
  }

  // 2. TTS 자동 음성 안내 (Speak text)
  speakReviewText(replyText);

  // 3. 원터치 즉시 등록 & 중복 제출 방지 (Locking)
  if (currentReviewIndex < 0 || !cachedReviews[currentReviewIndex]) return;
  const review = cachedReviews[currentReviewIndex];

  isSubmittingAACReply = true;
  presets.forEach(p => p.style.opacity = '0.5');

  try {
    const res = await fetchAPI('submitReviewReply', {
      method: 'POST',
      body: withAdminToken({
        orderId: review.orderId,
        replyText: replyText
      })
    });

    if (res && res.success) {
      AppState.vibrate(50);

      // 로컬 캐시 데이터 갱신
      review.replyText = replyText;
      review.replyCreatedAt = new Date().toISOString();

      // UI 리렌더링
      openReviewDetail(currentReviewIndex);
      renderReviews(cachedReviews);
    } else {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '답글 저장에 실패했습니다.');
    }
  } catch (e) {
    alert('오류가 발생했습니다: ' + e.message);
  } finally {
    isSubmittingAACReply = false;
    presets.forEach(p => p.style.opacity = '1');
  }
}

// 후기 답글 전송 API 호출 및 UI 갱신 함수
async function submitReviewReplyAction() {
  if (currentReviewIndex < 0 || !cachedReviews[currentReviewIndex]) return;
  const review = cachedReviews[currentReviewIndex];
  const replyInput = document.getElementById('rd-reply-input');
  const replyText = replyInput ? replyInput.value.trim() : '';

  if (!replyText) {
    alert('답글 내용을 입력하거나 단축 버튼을 선택하세요.');
    if (replyInput) replyInput.focus();
    return;
  }

  const btn = document.getElementById('btn-save-reply');
  const originalText = btn.textContent;
  btn.textContent = '저장중...';
  btn.disabled = true;

  try {
    const res = await fetchAPI('submitReviewReply', {
      method: 'POST',
      body: withAdminToken({
        orderId: review.orderId,
        replyText: replyText
      })
    });

    if (res && res.success) {
      AppState.vibrate(50);
      alert('답글이 성공적으로 등록되었습니다.');

      // 로컬 캐시 데이터 갱신
      review.replyText = replyText;
      review.replyCreatedAt = new Date().toISOString();

      // UI 리렌더링
      openReviewDetail(currentReviewIndex);
      renderReviews(cachedReviews);
    } else {
      clearAdminTokenIfDenied(res);
      alert(res?.message || '답글 저장에 실패했습니다.');
    }
  } catch (e) {
    alert('오류가 발생했습니다: ' + e.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // 모달 이벤트 리스너 추가
  const btnClose = document.getElementById('btn-close-review-modal');
  if (btnClose) btnClose.addEventListener('click', closeReviewDetail);

  const btnPrev = document.getElementById('btn-prev-review');
  if (btnPrev) btnPrev.addEventListener('click', () => navigateReview(-1));

  const btnNext = document.getElementById('btn-next-review');
  if (btnNext) btnNext.addEventListener('click', () => navigateReview(1));

  const btnToggle = document.getElementById('btn-toggle-review-visibility');
  if (btnToggle) btnToggle.addEventListener('click', toggleCurrentReviewVisibility);

  // 배경 클릭 시 모달 닫기
  const reviewModal = document.getElementById('review-detail-modal');
  if (reviewModal) {
    reviewModal.addEventListener('click', (e) => {
      if (e.target.id === 'review-detail-modal') {
        closeReviewDetail();
      }
    });
  }
});

// ESC 키로 닫기 및 화살표 키로 이동
window.addEventListener('keydown', (e) => {
  const modal = document.getElementById('review-detail-modal');
  if (modal && modal.style.display === 'flex') {
    if (e.key === 'Escape') closeReviewDetail();
    if (e.key === 'ArrowLeft') navigateReview(-1);
    if (e.key === 'ArrowRight') navigateReview(1);
  }
});
