/**
 * 공개 후기 전용 스크립트 (js/reviews-public.js)
 */
(function () {
  'use strict';

  // API Endpoint 구하기 (js/config.js의 API_URL 활용)
  function getScriptUrl() {
    if (typeof API_URL !== 'undefined' && API_URL) return API_URL;
    if (window.API_URL) return window.API_URL;
    if (window.SCRIPT_URL) return window.SCRIPT_URL;
    if (window.CONFIG && window.CONFIG.SCRIPT_URL) return window.CONFIG.SCRIPT_URL;
    const urlFromStorage = localStorage.getItem('kiosk_script_url');
    if (urlFromStorage) return urlFromStorage;
    return 'https://script.google.com/macros/s/AKfycbz_Placeholder/exec';
  }

  // 달곰이 공식 에셋 이미지 매핑
  const DALGOM_STAGES = [
    { stage: 0, avatarImg: 'assets/dalgomi_thumb.png', speech: '"여러분의 따뜻한 후기로 달곰이와 배달왔삼 온기가 싹을 틔워요! 🌱"' },
    { stage: 1, avatarImg: 'assets/dalgomi_cheer.png', speech: '"마음이 따끈따끈해지고 있어요! 차 한 잔의 온기 달성 ☕"' },
    { stage: 2, avatarImg: 'assets/dalgomi_heart.png', speech: '"우리의 온기가 가득 채워지고 있어요! 사랑의 온기 달성 ❤️"' },
    { stage: 3, avatarImg: 'assets/dalgomi_delivery.png', speech: '"축하합니다! 온기가 만발하여 예쁜 온기 꽃이 피어났어요! 🌸🎉"' }
  ];

  // 달곰이 스탬프 에셋 매핑
  const STAMP_ASSETS = {
    'dalgomi_thumb': { img: 'assets/dalgomi_thumb.png', label: '최고예요' },
    'dalgomi_cheer': { img: 'assets/dalgomi_cheer.png', label: '응원해요' },
    'dalgomi_heart': { img: 'assets/dalgomi_heart.png', label: '사랑해요' },
    'dalgomi_delivery': { img: 'assets/dalgomi_delivery.png', label: '빠라요' }
  };

  // DOM 요소 참조
  const elemCycleBadge = document.getElementById('warmth-cycle-badge');
  const elemTempValue = document.getElementById('warmth-temp-value');
  const elemDalgomAvatar = document.getElementById('dalgom-avatar');
  const elemDalgomSpeech = document.getElementById('dalgom-speech');
  const elemGaugeFill = document.getElementById('warmth-gauge-fill');
  const elemTotalCount = document.getElementById('total-reviews-count');
  const elemRemainingCount = document.getElementById('remaining-count');
  
  const elemLoadingState = document.getElementById('reviews-loading-state');
  const elemEmptyState = document.getElementById('reviews-empty-state');
  const elemReviewsGrid = document.getElementById('public-reviews-grid');
  const btnRefresh = document.getElementById('btn-refresh-reviews');

  /**
   * 구글 드라이브 이미지 주소 변환 헬퍼
   */
  function convertDriveImageUrl(url) {
    if (!url) return '';
    const text = String(url).trim();
    const isDrive = text.includes("drive.google.com") || text.includes("docs.google.com");
    if (isDrive) {
      const dMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (dMatch && dMatch[1]) {
        return `https://drive.google.com/thumbnail?id=${dMatch[1]}&sz=w500`;
      }
      const idMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) {
        return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w500`;
      }
    }
    if (!text.startsWith("http") && /^[a-zA-Z0-9_-]{25,}$/.test(text)) {
      return `https://drive.google.com/thumbnail?id=${text}&sz=w500`;
    }
    return text;
  }

  /**
   * 닉네임 마스킹 익명화 헬퍼
   * 예: "따뜻한 삼각지 바람" -> "따뜻한 삼***"
   *     "김철수" -> "김*수"
   *     "이민" -> "이*"
   */
  function maskNickname(name) {
    if (!name || name === '익명의 온기') return '익명의 온기';
    const str = String(name).trim();
    if (str.length <= 1) return str;
    if (str.length === 2) return str[0] + '*';
    if (str.length <= 4) return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
    return str.slice(0, 3) + '***';
  }

  /**
   * 공개 후기 및 온기 마일스톤 데이터 로드
   */
  async function loadPublicReviews() {
    showLoading(true);
    const SCRIPT_URL = getScriptUrl();

    try {
      let data = null;
      if (SCRIPT_URL) {
        try {
          const response = await fetch(`${SCRIPT_URL}?action=getPublicReviews&_t=${Date.now()}`, {
            method: 'GET',
            redirect: 'follow'
          });
          if (response.ok) {
            data = await response.json();
          }
        } catch (err) {
          console.warn('GAS Fetch 실패:', err);
        }
      }

      if (!data || !data.success) {
        data = {
          success: true,
          reviews: [],
          totalCount: 0,
          cycle: 1,
          progress: 0,
          temperature: 36.5,
          stage: 0
        };
      }

      renderHeroWarmth(data);
      renderReviewsGrid(data.reviews || []);
    } catch (error) {
      console.error('공개 후기 로드 중 오류:', error);
      elemLoadingState.innerHTML = '<p class="error">후기를 불러오는 데 실패했습니다. 다시 시도해 주세요.</p>';
    } finally {
      showLoading(false);
    }
  }

  // 온도 구간별 클래스 반환
  function getTempColorClass(temp) {
    if (temp >= 100) return 'temp-level-3'; // 100℃ 개화: 핫핑크/체리
    if (temp >= 75) return 'temp-level-2';  // 75℃ 사랑: 코랄/레드
    if (temp >= 50) return 'temp-level-1';  // 50℃ 차한잔: 앰버/골드
    return 'temp-level-0';                  // 36.5℃ 싹트임: 민트/오렌지
  }

  /**
   * 히어로 온기 게이지 및 달곰이 성취도 렌더링
   */
  function renderHeroWarmth(data) {
    const cycle = data.cycle || 1;
    const temp = (data.temperature !== undefined) ? data.temperature : 36.5;
    const progress = (data.progress !== undefined) ? data.progress : 0;
    const stage = data.stage || 0;
    const totalCount = data.totalCount || 0;

    // 회차 뱃지 및 버튼 옆 소나무 이모티콘(🌲) 배치
    const elemCycleTrees = document.getElementById('warmth-cycle-trees');
    if (elemCycleBadge) {
      elemCycleBadge.textContent = `${cycle}회차 온기 숲`;
    }
    if (elemCycleTrees) {
      const trees = '🌲'.repeat(Math.min(Math.max(1, cycle), 5));
      elemCycleTrees.textContent = trees;
    }

    // 온도 표시 (온도 구간별 색상 클래스 연동)
    if (elemTempValue) {
      elemTempValue.textContent = `${temp.toFixed(1)}℃`;
      elemTempValue.className = `temp-value ${getTempColorClass(temp)}`;
    }

    const maxProgress = 50;
    const fillPercent = Math.min(100, Math.max(0, (progress / maxProgress) * 100));
    if (elemGaugeFill) {
      elemGaugeFill.style.width = `${fillPercent}%`;
    }

    const stageInfo = DALGOM_STAGES[stage] || DALGOM_STAGES[0];
    if (elemDalgomAvatar) {
      const avatarSrc = stageInfo.avatarImg || 'assets/dalgom_avatar_face.png';
      elemDalgomAvatar.innerHTML = `<img src="${avatarSrc}" alt="달곰이 캐릭터" class="dalgom-avatar-img">`;
    }
    if (elemDalgomSpeech) {
      elemDalgomSpeech.textContent = stageInfo.speech;
    }

    document.querySelectorAll('.milestone-step').forEach((stepEl) => {
      const stepTemp = parseFloat(stepEl.getAttribute('data-temp'));
      if (temp >= stepTemp) {
        stepEl.classList.add('is-reached');
      } else {
        stepEl.classList.remove('is-reached');
      }
    });

    if (elemTotalCount) elemTotalCount.textContent = totalCount;
    if (elemRemainingCount) elemRemainingCount.textContent = Math.max(0, maxProgress - progress);
  }

  /**
   * 후기 카드 리스트 렌더링 (바둑판식 레이아웃 대응)
   */
  function renderReviewsGrid(reviews) {
    if (!reviews || reviews.length === 0) {
      elemEmptyState.style.display = 'block';
      elemReviewsGrid.innerHTML = '';
      return;
    }

    elemEmptyState.style.display = 'none';

    const cardsHtml = reviews.map((item) => {
      // 닉네임 마스킹
      const maskedName = maskNickname(item.guestName);

      // 스탬프 처리 (달곰이 이미지 스탬프 또는 일반 텍스트)
      let stampTag = '';
      if (item.stamp) {
        const rawStamp = String(item.stamp).trim();
        const stampAsset = STAMP_ASSETS[rawStamp];
        if (stampAsset) {
          stampTag = `<div class="review-stamp-dalgom">
                        <img src="${stampAsset.img}" alt="${stampAsset.label}">
                        <span>${stampAsset.label}</span>
                      </div>`;
        } else {
          stampTag = `<span class="review-stamp-tag">${escapeHtml(rawStamp)}</span>`;
        }
      }

      // 태그 처리
      const tagsList = item.tags
        ? item.tags.split(',').map(t => `<span class="review-tag-badge">#${escapeHtml(t.trim())}</span>`).join('')
        : '';
      
      // 구글 드라이브 이미지 변환 & onerror 예외 처리
      const convertedImgUrl = convertDriveImageUrl(item.imageUrl);
      const imageBox = convertedImgUrl
        ? `<div class="review-image-box">
             <img src="${escapeHtml(convertedImgUrl)}" alt="후기 사진" loading="lazy" onerror="this.parentNode.style.display='none';">
           </div>`
        : '';

      const replyBox = item.replyText
        ? `<div class="review-reply-box">
             <div class="reply-header">💬 배달왔삼의 답글</div>
             <div class="reply-content">${escapeHtml(item.replyText)}</div>
           </div>`
        : '';

      return `
        <article class="public-review-card">
          <div class="review-card-top">
            <div class="review-user-info">
              <span class="review-user-name">${escapeHtml(maskedName)}</span>
            </div>
            <span class="review-date">${escapeHtml(item.createdAt || '')}</span>
          </div>

          ${stampTag}
          ${tagsList ? `<div class="review-tags-box">${tagsList}</div>` : ''}
          ${imageBox}

          <div class="review-content">${escapeHtml(item.comment || '')}</div>
          ${replyBox}
        </article>
      `;
    }).join('');

    elemReviewsGrid.innerHTML = cardsHtml;
  }

  function showLoading(isLoading) {
    if (elemLoadingState) {
      elemLoadingState.style.display = isLoading ? 'block' : 'none';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadPublicReviews();
    });
  }

  document.addEventListener('DOMContentLoaded', loadPublicReviews);
})();
