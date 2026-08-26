function speakGuestOrderReply(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn("TTS 재생 실패:", e);
  }
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

window.addEventListener('DOMContentLoaded', () => {
  const localSection = document.getElementById('local-orders-section');
  const localList = document.getElementById('local-orders-list');
  
  const btnBack = document.getElementById('btn-back');
  const loadingOverlay = document.getElementById('loading-overlay');

  // 1. 주문 로드 및 서버 갱신
  async function loadOrders(includeArchived = false) {
    const localOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
    const guestAuth = AppState.getGuestAuth ? AppState.getGuestAuth() : null;
    if (localOrders.length === 0 && !guestAuth) {
      localList.innerHTML = `<div class="empty-state">최근 주문한 기록이 없습니다. 😢</div>`;
      return;
    }

    const tokens = localOrders.map(o => o.orderToken).filter(t => t);
    if (tokens.length === 0 && !guestAuth) {
      localList.innerHTML = `<div class="empty-state">토큰 정보가 없는 과거 주문입니다. 관리자에게 문의해주세요.</div>`;
      return;
    }

    loadingOverlay.style.display = 'flex';

    try {
      const serverRows = [];
      const seenRows = new Set();
      const appendRows = (rows) => {
        if (!Array.isArray(rows)) return;
        rows.forEach(row => {
          const key = [
            row.orderNo || '',
            row.orderToken || '',
            row.snackId || '',
            row.snackName || ''
          ].join('|');
          if (seenRows.has(key)) return;
          seenRows.add(key);
          serverRows.push(row);
        });
      };

      if (tokens.length > 0) {
        const tokenRes = await fetchAPIReadWithRetry('getGuestOrderByToken', {
          method: 'POST',
          body: { tokens: tokens, includeArchived: includeArchived },
          timeoutMs: 30000
        });
        if (tokenRes && tokenRes.success) {
          appendRows(tokenRes.orders);
        } else {
          console.warn('토큰 주문 조회 실패:', tokenRes);
        }
      }

      if (guestAuth) {
        const authRes = await fetchAPIReadWithRetry('getGuestOrdersByGuestKey', {
          method: 'POST',
          body: {
            authProvider: guestAuth.provider,
            guestKey: guestAuth.guestKey,
            includeArchived: includeArchived
          },
          timeoutMs: 30000
        });
        if (authRes && authRes.success) {
          appendRows(authRes.orders);
        } else {
          console.warn('카카오 주문 조회 실패:', authRes);
        }
      }

      // 후기 및 장애인 직원 AAC 답글 실시간 동기화 (Join)
      let reviewMapByOrderNo = {};
      try {
        const reviewsRes = await fetchAPIReadWithRetry('getRecentReviews', { timeoutMs: 30000 });
        if (reviewsRes && reviewsRes.success && Array.isArray(reviewsRes.reviews)) {
          reviewsRes.reviews.forEach(rev => {
            if (rev.orderId) {
              reviewMapByOrderNo[String(rev.orderId).trim()] = rev;
            }
          });
        }
      } catch(e) {
        console.warn('최근 후기 조회 중 오류 (무시):', e);
      }

      loadingOverlay.style.display = 'none';

      if (serverRows.length > 0) {
        // 로컬 스토리지 동기화용 사전
        const localByKey = {};
        localOrders.forEach(lo => {
          const key = lo.orderToken || lo.orderNo;
          if (key) localByKey[key] = lo;
        });

        const orderGroups = {};
        serverRows.forEach(o => {
          const key = o.orderToken || o.orderNo;
          const prevLocal = localByKey[key] || {};
          if (!orderGroups[o.orderNo]) {
            orderGroups[o.orderNo] = {
              orderNo: o.orderNo,
              orderToken: o.orderToken,
              nickname: o.nickname,
              timestamp: o.timestamp,
              status: o.servedYn,
              deliveryType: o.deliveryType || 'pickup',
              deliveryPlace: o.deliveryPlace || '',
              reviewed: o.reviewed || prevLocal.reviewed || false,
              stamp: o.stamp || prevLocal.stamp || '',
              tags: o.tags || prevLocal.tags || '',
              replyText: o.replyText || prevLocal.replyText || '',
              reviewComment: o.reviewComment || o.comment || prevLocal.reviewComment || prevLocal.comment || '',
              reviewUpdatedAt: o.reviewUpdatedAt || prevLocal.reviewUpdatedAt || '',
              reviewEditCount: Number(o.reviewEditCount || prevLocal.reviewEditCount || 0),
              cancelReason: o.cancelReason || '',
              authProvider: o.authProvider || '',
              guestKey: o.guestKey || '',
              items: []
            };
          }
          orderGroups[o.orderNo].items.push({
            name: o.snackName,
            quantity: o.quantity,
            point: o.point / (o.quantity || 1)
          });
        });

        const mergedOrders = Object.values(orderGroups);
        
        mergedOrders.forEach(serverData => {
          const key = serverData.orderToken || serverData.orderNo;
          if (!key) return;

          // 후기 및 장애인 직원 답글 실시간 동기화 (유연한 키 매칭)
          const matchedReview = Object.values(reviewMapByOrderNo).find(rev => {
            if (!rev || !rev.orderId) return false;
            const rId = String(rev.orderId).trim();
            const oNo = String(serverData.orderNo || '').trim();
            const oTok = String(serverData.orderToken || '').trim();
            return (rId && (rId === oNo || rId === oTok || (oNo && rId.includes(oNo)) || (oTok && rId.includes(oTok))));
          });

          if (matchedReview) {
            if (matchedReview.replyText) serverData.replyText = matchedReview.replyText;
            if (matchedReview.comment) serverData.reviewComment = matchedReview.comment;
            if (matchedReview.stamp) serverData.stamp = matchedReview.stamp;
            if (matchedReview.tags) serverData.tags = matchedReview.tags;
            serverData.reviewUpdatedAt = matchedReview.updatedAt || '';
            serverData.reviewEditCount = Number(matchedReview.editCount || 0);
            serverData.reviewed = true;
          }

          const isKakao = serverData.authProvider === 'kakao' || (localByKey[key] && localByKey[key].authProvider === 'kakao');
          let guestName = serverData.guestName || (serverData.nickname ? String(serverData.nickname).replace(/ \((체험|비회원)\)/g, '') : '게스트');
          if (isKakao) {
            guestName = '💬 ' + guestName.replace(/ \((체험|비회원)\)/g, '').trim();
          }
          const prevLocal = localByKey[key] || {};
          localByKey[key] = {
            ...prevLocal,
            ...serverData,
            reviewed: serverData.reviewed || prevLocal.reviewed || false,
            reviewComment: serverData.reviewComment || prevLocal.reviewComment || prevLocal.comment || '',
            comment: serverData.reviewComment || prevLocal.comment || prevLocal.reviewComment || '',
            stamp: serverData.stamp || prevLocal.stamp || '',
            tags: serverData.tags || prevLocal.tags || '',
            reviewUpdatedAt: serverData.reviewUpdatedAt || prevLocal.reviewUpdatedAt || '',
            reviewEditCount: Number(serverData.reviewEditCount || prevLocal.reviewEditCount || 0),
            guestName,
            createdAt: serverData.timestamp || prevLocal.createdAt || new Date().toISOString(),
            status: serverData.status,
            authProvider: serverData.authProvider || prevLocal.authProvider || '',
            guestKey: serverData.guestKey || prevLocal.guestKey || ''
          };
        });
        localStorage.setItem('guestOrders', JSON.stringify(Object.values(localByKey)));

        // 정렬 (최신순)
        mergedOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        localList.innerHTML = '';
        mergedOrders.forEach(order => {
          localList.appendChild(createOrderCard(order, false));
        });
        AppState.vibrate(60);
      } else {
        if (localOrders.length > 0) {
          localList.innerHTML = '';
          [...localOrders].reverse().forEach(order => {
            const card = createOrderCard(order, true);
            if (card) localList.appendChild(card);
          });
        } else {
          localList.innerHTML = `<div class="empty-state">오늘 연결된 주문을 찾을 수 없습니다.</div>`;
        }
      }
    } catch (error) {
      console.error('주문 조회 실패:', error);
      if (loadingOverlay) loadingOverlay.style.display = 'none';
      
      // 오프라인/에러 시 로컬 데이터라도 표시
      if (localList) {
        localList.innerHTML = '';
        try {
          const sorted = [...localOrders].reverse();
          sorted.forEach(order => {
            if (!order) return;
            try {
              const card = createOrderCard(order, true);
              if (card) localList.appendChild(card);
            } catch(err) {
              console.error('개별 카드 생성 실패:', err);
            }
          });
          
          if (localList.innerHTML === '') {
            localList.innerHTML = `<div class="empty-state">서버 연결에 실패하였고, 표시할 로컬 주문도 없습니다.</div>`;
          }
        } catch(e) {
          localList.innerHTML = `<div class="empty-state">로컬 주문 내역을 불러오는 중 오류가 발생했습니다.</div>`;
        }
      }
    }
  }

  // 2. 상태 텍스트 포맷터
  function getStatusLabel(status, method) {
    const isDelivery = method === 'delivery';
    switch (status) {
      case 'P': return '준비중 ☕';
      case 'R': return isDelivery ? '배달중 🛵' : '준비완료 🔔';
      case 'Y': return isDelivery ? '배달완료 📦' : '수령완료 📦';
      case 'C': 
      case '취소':
      case '관리자취소':
        return '주문취소 ❌';
      default: return '접수중 📝';
    }
  }

  // 3. 시간 및 날짜 포맷터
  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const isToday = date.getFullYear() === now.getFullYear() &&
                      date.getMonth() === now.getMonth() &&
                      date.getDate() === now.getDate();
      
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const timeText = `${hours}:${minutes}`;

      if (isToday) {
        return timeText;
      } else {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}. ${day}. ${timeText}`;
      }
    } catch (e) {
      return '';
    }
  }

  // 4. 주문번호 뒷자리 세자리
  function getShortNo(orderNo) {
    if (!orderNo) return '-';
    const parts = String(orderNo).split('-');
    if (parts.length >= 3) {
      return parts[2] + '번';
    }
    return orderNo;
  }

  // 5. 카드 돔 생성
  function createOrderCard(order, isLocal) {
    if (!order) return null;
    const card = document.createElement('div');
    card.className = 'order-card';
    
    const currentStatus = String(order.status || order.servedYn || 'N');
    const statusClass = `status-${currentStatus.toLowerCase()}`;
    const timeStr = formatTime(order.createdAt || order.timestamp);
    const shortNoStr = getShortNo(order.orderNo);
    const isKakao = order.authProvider === 'kakao';
    let guestName = order.guestName || (order.nickname ? String(order.nickname).replace(/ \((체험|비회원)\)/g, '') : '게스트');
    if (isKakao) {
      guestName = '💬 ' + guestName.replace(/ \((체험|비회원)\)/g, '').trim();
    }
    
    let itemsText = '-';
    if (order.items && Array.isArray(order.items)) {
      itemsText = order.items.map(item => `${item.name || item.snackName} ${item.quantity}개`).join(', ');
    } else if (order.snackName) {
      itemsText = `${order.snackName} ${order.quantity}개`;
    }

    const isServed = (order.status === 'Y' || order.servedYn === 'Y');
    const isReviewed = (order.reviewed === true || order.reviewed === 'true' || order.reviewed === 'Y' || String(order.reviewed).toUpperCase() === 'TRUE');

    let reviewBtnHtml = '';
    if (isServed && !isReviewed) {
      reviewBtnHtml = `
        <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
          <button class="btn btn-secondary btn-write-review-card" 
            data-order-no="${AppState.escapeAttr(order.orderNo)}"
            data-guest-name="${AppState.escapeAttr(guestName)}"
            style="min-height: 44px; font-size: 16px; font-weight: 850; padding: 0 18px; background-color: var(--secondary-color); box-shadow: var(--shadow-btn-sec); margin: 0; width: auto; z-index: 10;">
            후기 작성하기 💌
          </button>
        </div>
      `;
    } else if (isServed && isReviewed && order.orderToken) {
      reviewBtnHtml = `
        <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
          <button class="btn btn-gray btn-edit-review-card"
            data-order-no="${AppState.escapeAttr(order.orderNo)}"
            data-guest-name="${AppState.escapeAttr(guestName)}"
            style="min-height: 42px; font-size: 15px; font-weight: 850; padding: 0 16px; border: 2px solid var(--secondary-color); color: #00796B; background-color: #F0FDFA; box-shadow: none; margin: 0; width: auto; z-index: 10;">
            후기 수정
          </button>
        </div>
      `;
    }

    const isDelivery = (order.deliveryType === 'delivery' || order.method === 'delivery');
    const deliveryPlaceHtml = (isDelivery && order.deliveryPlace) 
      ? `<div style="font-size: 16px; font-weight: 800; color: #00796B; margin-top: 4px;">📍 배달지: ${AppState.escapeHtml(order.deliveryPlace)}</div>`
      : '';

    const isCanceled = (order.status === 'C' || order.servedYn === 'C' || order.status === '취소' || order.servedYn === '취소' || order.status === '관리자취소' || order.servedYn === '관리자취소');
    let cancelHtml = '';
    if (isCanceled) {
      const reasonText = order.cancelReason || '사유 없음';
      cancelHtml = `<div style="font-size: 15px; font-weight: 800; color: var(--danger-color); margin-top: 8px; background-color: #fdf2f2; padding: 10px; border-radius: 8px; border: 1px solid #fecaca;">🚫 취소 사유: ${AppState.escapeHtml(reasonText)}</div>`;
    }

    const isPending = (order.status === 'N' || order.servedYn === 'N');
    let cancelBtnHtml = '';
    if (isPending && order.orderToken) {
      cancelBtnHtml = `
        <div style="margin-top: 10px;">
          <button class="btn btn-gray btn-guest-cancel-card" 
            data-order-token="${AppState.escapeAttr(order.orderToken)}"
            style="min-height: 44px; font-size: 16px; width: 100%; border-color: #ffcccc; color: var(--danger-color); background-color: #fff5f5; z-index: 10;">
            주문 취소하기 (접수 단계만 가능)
          </button>
        </div>
      `;
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

    const stampInfo = order.stamp ? (stampMapping[order.stamp] || { text: order.stamp }) : null;
    let tagsHtml = '';
    if (order.tags) {
      tagsHtml = order.tags.split(',').map(tag => `
        <span class="status-badge" style="font-size: 13px; font-weight: 800; padding: 4px 8px; border-color: var(--secondary-color); color: #00796B; background-color: #E0F2F1; margin: 0;">${AppState.escapeHtml(tag.trim())}</span>
      `).join(' ');
    }

    const commentText = (order.reviewComment || order.comment || '').trim();
    const userCmt = (order.stamp || '') + ' ' + (order.tags || '') + ' ' + commentText;

    let commentBox = '';
    if (stampInfo || order.tags || commentText) {
      let dalgomiStickerHtml = '';
      if (stampInfo) {
        if (stampInfo.img) {
          dalgomiStickerHtml = `
            <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-left: 8px;">
              <img src="${stampInfo.img}" style="width: 85px; height: 85px; object-fit: contain;" alt="달곰이 이모티콘">
            </div>
          `;
        } else {
          tagsHtml += `<span style="background-color: #FFF9E6; border: 1.5px solid var(--primary-color); padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #E65100; margin-left: 4px;">${stampInfo.text}</span>`;
        }
      }

      commentBox = `
        <div class="order-comment-box" style="margin-top: 12px; background-color: #FFFDF5; border: 1.5px solid #FCD34D; border-radius: var(--radius-sm); padding: 12px; font-size: 14px; font-weight: 700; color: #92400E; transition: all 0.2s ease; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; text-align: left;">
            <div style="font-size: 13px; font-weight: 850; color: #B45309; display: flex; align-items: center; gap: 4px;">
              💌 내가 남긴 응원 후기
              ${order.reviewUpdatedAt || Number(order.reviewEditCount || 0) > 0 ? '<span style="font-size: 11px; color: #B45309; background: #FEF3C7; border-radius: 999px; padding: 2px 7px;">수정됨</span>' : ''}
            </div>
            ${commentText ? `<div style="font-size: 15px; color: #78350F; background-color: white; border: 1px solid #FFE0B2; padding: 8px 10px; border-radius: 6px; font-weight: 700; word-break: break-all;">"${AppState.escapeHtml(commentText)}"</div>` : ''}
            ${tagsHtml ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 2px;">${tagsHtml}</div>` : ''}
          </div>
          ${dalgomiStickerHtml}
        </div>
      `;
    } else if (isReviewed) {
      commentBox = `
        <div class="order-comment-box" style="margin-top: 12px; background-color: #FFFDF5; border: 1.5px solid #FCD34D; border-radius: var(--radius-sm); padding: 12px; font-size: 14px; font-weight: 700; color: #92400E; transition: all 0.2s ease;">
          💌 소중한 응원 후기가 등록되었습니다.
        </div>
      `;
    }

    let replyBox = '';
    if (order.replyText) {
      const replyStamp = getReplyStampInfo(order.replyText);
      let replyStampHtml = '';
      if (replyStamp) {
        replyStampHtml = `
          <div style="flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 75px; height: 75px;">
            <img src="${replyStamp.img}" style="width: 75px; height: 75px; object-fit: contain;" alt="${replyStamp.text}">
          </div>
        `;
      }
      replyBox = `
        <div class="order-reply-box" style="margin-top: 8px; background-color: #E6FFFA; border: 2px solid #38A169; border-radius: var(--radius-sm); padding: 12px 14px; font-size: 15px; font-weight: 700; color: #234E52; transition: all 0.2s ease; display: flex; align-items: center; gap: 14px;">
          ${replyStampHtml}
          <div style="flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; gap: 4px;">
            <div style="font-size: 13px; font-weight: 850; color: #2F855A; display: flex; align-items: center; gap: 4px; border-bottom: 1.5px solid #A3E4D7; padding-bottom: 4px; margin-bottom: 2px;">
              🐣 배달왔삼 직원의 감사 답글
            </div>
            <div style="font-size: 15px; color: #115E59; word-break: break-all; font-weight: 700;">"${AppState.escapeHtml(order.replyText)}"</div>
          </div>
        </div>
      `;
    }

    replyHtml = commentBox + replyBox;

    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-time">⏰ ${timeStr}</span>
        <span class="order-card-status ${statusClass}">${getStatusLabel(order.status || order.servedYn, order.deliveryType || order.method || 'pickup')}</span>
      </div>
      <div class="order-card-body">
        <div class="order-card-no">🎫 주문번호: ${shortNoStr} (${order.orderNo})</div>
        <div class="order-card-items">${AppState.escapeHtml(itemsText)}</div>
        <div class="order-card-name">👤 주문자: ${AppState.escapeHtml(guestName)} 님</div>
        ${deliveryPlaceHtml}
        ${cancelHtml}
        ${replyHtml}
        ${cancelBtnHtml}
        ${reviewBtnHtml}
      </div>
    `;

    // 카드 클릭 시 complete.html 연동 또는 P25 소통 인터랙션
    AppState.bindCardTap(card, (e) => {
      // 후기 작성 버튼이나 취소 버튼 클릭 시 카드 클릭 이벤트 무시
      if (e && e.target && (e.target.closest('.btn-write-review-card') || e.target.closest('.btn-edit-review-card') || e.target.closest('.btn-guest-cancel-card'))) {
        return;
      }

      // P25: 후기 작성이 완료된 수령 완료 주문인 경우 complete.html 이동 차단 및 소통 인터랙션
      if (isServed && isReviewed) {
        AppState.vibrate(50);
        AppState.playClickSound();

        const replyBoxEl = card.querySelector('.order-reply-box');
        const commentBoxEl = card.querySelector('.order-comment-box');

        if (order.replyText) {
          if (replyBoxEl) {
            replyBoxEl.classList.remove('reply-box-active');
            void replyBoxEl.offsetWidth; // trigger reflow
            replyBoxEl.classList.add('reply-box-active');
          }
          speakGuestOrderReply(`배달왔삼 직원의 감사 답글입니다. ${order.replyText}`);
        } else if (userCmt) {
          if (commentBoxEl) {
            commentBoxEl.classList.remove('reply-box-active');
            void commentBoxEl.offsetWidth;
            commentBoxEl.classList.add('reply-box-active');
          }
          speakGuestOrderReply(`소중한 응원 후기를 남겨주셔서 감사합니다.`);
        } else {
          speakGuestOrderReply(`소중한 응원 후기가 등록되었습니다.`);
        }
        return;
      }

      // selectedUser 복원
      const storedRemainingCredit = Number(sessionStorage.getItem('guestRemainingCredit'));
      const creditAmount = !Number.isNaN(storedRemainingCredit)
        ? storedRemainingCredit
        : (typeof GUEST_DEFAULT_CREDIT !== 'undefined' ? GUEST_DEFAULT_CREDIT : 10);
      AppState.setSelectedUser({
        userId: 'guest',
        nickname: guestName,
        credit: creditAmount,
        authProvider: order.authProvider || '',
        guestKey: order.guestKey || ''
      });

      // lastOrderSummary 세션 바인딩
      const usedPoints = order.items 
        ? order.items.reduce((sum, item) => sum + (item.point || 0) * (item.quantity || 1), 0)
        : (order.point || 0);

      localStorage.setItem('lastOrderSummary', JSON.stringify({
        userId: 'guest',
        nickname: guestName,
        usedPoints: usedPoints,
        remainPoints: creditAmount - usedPoints,
        orderNo: order.orderNo,
        orderToken: order.orderToken,
        deliveryType: order.deliveryType || order.method || 'pickup',
        deliveryPlace: order.deliveryPlace || '',
        authProvider: order.authProvider || '',
        guestKey: order.guestKey || '',
        items: order.items || [{ name: order.snackName, quantity: order.quantity }]
      }));

      AppState.vibrate(60);
      AppState.playClickSound();
      window.location.href = 'complete.html';
    });

    // 후기 작성 버튼 클릭 이벤트 바인딩
    const reviewBtn = card.querySelector('.btn-write-review-card');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReviewModalFor(order.orderNo, guestName, order.orderToken);
      });
      reviewBtn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      reviewBtn.addEventListener('pointerup', (e) => {
        e.stopPropagation();
      });
    }

    const editReviewBtn = card.querySelector('.btn-edit-review-card');
    if (editReviewBtn) {
      editReviewBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        editReviewBtn.disabled = true;
        const originalText = editReviewBtn.textContent;
        editReviewBtn.textContent = '불러오는 중...';
        try {
          await window.openReviewEditModalFor(order.orderNo, guestName, order.orderToken);
        } finally {
          editReviewBtn.disabled = false;
          editReviewBtn.textContent = originalText;
        }
      });
      editReviewBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      editReviewBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    }

    // 취소 버튼 이벤트 바인딩
    const cancelBtn = card.querySelector('.btn-guest-cancel-card');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('정말로 주문을 취소하시겠습니까?\n주문을 취소하면 사용한 온기는 돌려드리고, 간식 재고는 복구됩니다.')) return;
        
        cancelBtn.disabled = true;
        cancelBtn.textContent = '취소 중...';
        
        try {
          const res = await fetchAPI('userCancelOrder', {
            method: 'POST',
            body: { orderId: order.orderNo || order.orderToken, orderToken: order.orderToken }
          });
          if (res && res.success) {
            AppState.vibrate([100, 50, 100]);
            alert(res.message || '주문이 정상적으로 취소되었습니다.');
            loadOrders(); // 목록 새로고침
          } else {
            alert('취소 실패: ' + (res?.message || '알 수 없는 오류'));
            cancelBtn.disabled = false;
            cancelBtn.textContent = '주문 취소하기 (접수 단계만 가능)';
          }
        } catch (error) {
          console.error('취소 오류:', error);
          alert('통신 오류가 발생했습니다.');
          cancelBtn.disabled = false;
          cancelBtn.textContent = '주문 취소하기 (접수 단계만 가능)';
        }
      });
      cancelBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      cancelBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    }

    return card;
  }

  AppState.bindCardTap(btnBack, () => {
    window.location.href = 'guest.html';
  });

  // 후기 작성 변수 및 모달 바인딩
  let currentReviewOrderId = '';
  let currentReviewGuestName = '';
  let currentReviewOrderToken = '';

  const reviewModal = document.getElementById('modal-write-review');
  const btnCloseReviewModal = document.getElementById('btn-close-review-modal');
  const btnCancelReview = document.getElementById('btn-cancel-review');
  const btnSubmitReview = document.getElementById('btn-submit-review');
  const reviewModalTitle = document.getElementById('review-modal-title');
  const reviewEditDeadline = document.getElementById('review-edit-deadline');
  const reviewPublicCheckbox = document.getElementById('review-is-public');
  const reviewPhotoPublicConfirm = document.getElementById('review-photo-public-confirm');
  const reviewPhotoPublicConsent = document.getElementById('review-photo-public-consent');
  const reviewPhotoConsentError = document.getElementById('review-photo-consent-error');
  const stampButtons = document.querySelectorAll('#stamp-select-group .stamp-btn');
  const tagCapsules = document.querySelectorAll('#tags-select-group .tag-capsule');
  let selectedReviewPhotoFile = null;
  let currentReviewMode = 'create';
  let currentReviewImageUrl = '';
  let currentReviewImageAction = 'keep';
  let currentReviewWasPublic = false;

  function showReviewModal() {
    if (reviewModal) reviewModal.style.display = 'flex';
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    AppState.vibrate(50);
    AppState.playClickSound();
  }

  function renderReviewPhotoState() {
    const input = document.getElementById('review-photo-input');
    const preview = document.getElementById('review-photo-preview');
    const previewWrap = document.getElementById('review-photo-preview-wrap');
    const status = document.getElementById('review-photo-status');
    const removeBtn = document.getElementById('btn-remove-review-photo');
    if (input && !selectedReviewPhotoFile) input.value = '';

    if (selectedReviewPhotoFile) return;
    const shouldShowExisting = currentReviewMode === 'edit' && currentReviewImageUrl && currentReviewImageAction !== 'remove';
    if (preview) {
      preview.src = shouldShowExisting ? AppState.convertDriveImageUrl(currentReviewImageUrl) : '';
      preview.style.display = shouldShowExisting ? 'block' : 'none';
    }
    if (previewWrap) previewWrap.style.display = shouldShowExisting ? 'inline-block' : 'none';
    if (removeBtn) removeBtn.style.display = shouldShowExisting ? 'flex' : 'none';
    if (status) status.textContent = shouldShowExisting ? '현재 등록된 사진' : '선택된 사진 없음';
  }

  function resetReviewModalState() {
    selectedReviewPhotoFile = null;
    currentReviewImageUrl = '';
    currentReviewImageAction = 'keep';
    currentReviewWasPublic = false;
    const input = document.getElementById('review-photo-input');
    if (input) input.value = '';
    if (reviewPhotoPublicConsent) reviewPhotoPublicConsent.checked = false;
    renderReviewPhotoState();
  }

  window.openReviewModalFor = function(orderNo, guestName, orderToken) {
    currentReviewOrderId = orderNo;
    currentReviewGuestName = guestName;
    currentReviewOrderToken = orderToken;
    currentReviewMode = 'create';
    resetReviewModalState();
    
    // 입력 필드 초기화
    stampButtons.forEach((b, idx) => {
      if (idx === 0) b.classList.add('active');
      else b.classList.remove('active');
    });
    tagCapsules.forEach(c => c.classList.remove('active'));
    document.getElementById('review-comment').value = '';
    reviewPublicCheckbox.checked = true;
    if (reviewModalTitle) reviewModalTitle.textContent = '💌 칭찬과 응원 보내기';
    if (reviewEditDeadline) reviewEditDeadline.hidden = true;
    updateReviewPhotoPublicConfirmation(true);
    
    if (btnSubmitReview) {
      btnSubmitReview.disabled = false;
      btnSubmitReview.textContent = '보내기';
    }

    showReviewModal();
  };

  window.openReviewEditModalFor = async function(orderNo, guestName, orderToken) {
    const res = await fetchAPIReadWithRetry('getGuestReview', {
      method: 'POST',
      body: { orderId: orderNo, orderToken },
      timeoutMs: 30000
    });
    if (!res || !res.success || !res.review) {
      alert('후기를 불러오지 못했습니다: ' + (res?.message || '데이터 연결에 실패했습니다.'));
      return;
    }
    if (!res.review.editable) {
      alert('후기 작성 후 7일이 지나 수정할 수 없습니다.');
      return;
    }

    const review = res.review;
    currentReviewOrderId = orderNo;
    currentReviewGuestName = guestName;
    currentReviewOrderToken = orderToken;
    currentReviewMode = 'edit';
    resetReviewModalState();
    currentReviewImageUrl = String(review.imageUrl || '');
    currentReviewWasPublic = review.isPublic === true;
    currentReviewImageAction = 'keep';

    stampButtons.forEach(button => {
      button.classList.toggle('active', button.getAttribute('data-stamp') === String(review.stamp || ''));
    });
    tagCapsules.forEach(capsule => {
      const selectedTags = String(review.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
      capsule.classList.toggle('active', selectedTags.includes(capsule.getAttribute('data-tag')));
    });
    document.getElementById('review-comment').value = String(review.comment || '');
    reviewPublicCheckbox.checked = review.isPublic === true;
    if (reviewModalTitle) reviewModalTitle.textContent = '후기 수정';
    if (reviewEditDeadline) {
      const expiresAt = review.editExpiresAt ? new Date(review.editExpiresAt) : null;
      reviewEditDeadline.textContent = expiresAt && !isNaN(expiresAt.getTime())
        ? `${expiresAt.toLocaleDateString()}까지 수정할 수 있습니다.`
        : '후기는 작성 후 7일 동안 수정할 수 있습니다.';
      reviewEditDeadline.hidden = false;
    }
    if (btnSubmitReview) {
      btnSubmitReview.disabled = false;
      btnSubmitReview.textContent = '수정 저장';
    }
    renderReviewPhotoState();
    updateReviewPhotoPublicConfirmation(true);
    showReviewModal();
  };

  function updateReviewPhotoPublicConfirmation(resetConsent = false) {
    const hasEffectivePhoto = Boolean(
      selectedReviewPhotoFile ||
      (currentReviewMode === 'edit' && currentReviewImageUrl && currentReviewImageAction !== 'remove')
    );
    const needsFreshConsent = Boolean(selectedReviewPhotoFile || (currentReviewMode === 'edit' && !currentReviewWasPublic));
    const shouldConfirm = Boolean(hasEffectivePhoto && reviewPublicCheckbox?.checked && needsFreshConsent);
    if (reviewPhotoPublicConfirm) {
      reviewPhotoPublicConfirm.hidden = !shouldConfirm;
      reviewPhotoPublicConfirm.classList.remove('has-error');
    }

    if (reviewPhotoPublicConsent && (resetConsent || !shouldConfirm)) {
      reviewPhotoPublicConsent.checked = false;
    }
    if (reviewPhotoConsentError) reviewPhotoConsentError.hidden = true;
  }

  function showReviewPhotoConsentError() {
    if (reviewPhotoPublicConfirm) reviewPhotoPublicConfirm.classList.add('has-error');
    if (reviewPhotoConsentError) reviewPhotoConsentError.hidden = false;
    if (reviewPhotoPublicConsent) reviewPhotoPublicConsent.focus();
  }

  window.handleReviewPhotoSelected = function(fileInput) {
    const file = fileInput.files[0];
    if (!file) return;

    selectedReviewPhotoFile = file;
    currentReviewImageAction = currentReviewMode === 'edit' ? 'replace' : 'keep';

    const preview = document.getElementById('review-photo-preview');
    const previewWrap = document.getElementById('review-photo-preview-wrap');
    const status = document.getElementById('review-photo-status');
    const removeBtn = document.getElementById('btn-remove-review-photo');

    if (status) status.textContent = file.name;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      if (preview) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      }
      if (previewWrap) previewWrap.style.display = 'inline-block';
      if (removeBtn) {
        removeBtn.style.display = 'flex';
      }
    };
    reader.readAsDataURL(file);
    updateReviewPhotoPublicConfirmation(true);
    AppState.vibrate(30);
  };

  window.removeReviewPhoto = function() {
    const input = document.getElementById('review-photo-input');
    const preview = document.getElementById('review-photo-preview');
    const previewWrap = document.getElementById('review-photo-preview-wrap');
    const status = document.getElementById('review-photo-status');
    const removeBtn = document.getElementById('btn-remove-review-photo');

    if (currentReviewMode === 'edit' && selectedReviewPhotoFile && currentReviewImageUrl) {
      selectedReviewPhotoFile = null;
      currentReviewImageAction = 'keep';
      if (input) input.value = '';
      renderReviewPhotoState();
      updateReviewPhotoPublicConfirmation(true);
      AppState.vibrate(20);
      return;
    }

    selectedReviewPhotoFile = null;
    currentReviewImageAction = currentReviewMode === 'edit' && currentReviewImageUrl ? 'remove' : 'keep';
    if (input) input.value = '';
    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
    }
    if (previewWrap) previewWrap.style.display = 'none';
    if (status) status.textContent = '선택된 사진 없음';
    if (removeBtn) removeBtn.style.display = 'none';
    updateReviewPhotoPublicConfirmation(true);
    AppState.vibrate(20);
  };

  if (reviewPublicCheckbox) {
    reviewPublicCheckbox.addEventListener('change', () => {
      updateReviewPhotoPublicConfirmation(true);
    });
  }

  if (reviewPhotoPublicConsent) {
    reviewPhotoPublicConsent.addEventListener('change', () => {
      if (reviewPhotoPublicConfirm) reviewPhotoPublicConfirm.classList.remove('has-error');
      if (reviewPhotoConsentError) reviewPhotoConsentError.hidden = true;
    });
  }

  function compressImage(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  }

  function closeReviewModal() {
    if (reviewModal) reviewModal.style.display = 'none';
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    currentReviewMode = 'create';
    resetReviewModalState();
    AppState.vibrate(30);
  }

  if (btnCloseReviewModal) {
    btnCloseReviewModal.addEventListener('click', closeReviewModal);
  }
  if (btnCancelReview) {
    btnCancelReview.addEventListener('click', closeReviewModal);
  }

  stampButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      stampButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.vibrate(30);
      AppState.playClickSound();
    });
  });

  tagCapsules.forEach(cap => {
    cap.addEventListener('click', () => {
      cap.classList.toggle('active');
      AppState.vibrate(30);
      AppState.playClickSound();
    });
  });

  if (btnSubmitReview) {
    btnSubmitReview.addEventListener('click', async () => {
      if (!currentReviewOrderId || !currentReviewGuestName) return;

      const activeStamp = document.querySelector('#stamp-select-group .stamp-btn.active');
      const stamp = activeStamp ? activeStamp.getAttribute('data-stamp') : '';
      
      const activeCapsules = document.querySelectorAll('#tags-select-group .tag-capsule.active');
      const tags = Array.from(activeCapsules).map(c => c.getAttribute('data-tag')).join(', ');
      
      const comment = document.getElementById('review-comment').value.trim();
      const isPublic = reviewPublicCheckbox.checked;

      if (reviewPhotoPublicConfirm && !reviewPhotoPublicConfirm.hidden && !reviewPhotoPublicConsent?.checked) {
        showReviewPhotoConsentError();
        AppState.vibrate([60, 40, 60]);
        return;
      }

      btnSubmitReview.disabled = true;
      btnSubmitReview.textContent = currentReviewMode === 'edit' ? '수정 중...' : '제출 중...';

      try {
        let imageUrl = '';
        if (selectedReviewPhotoFile) {
          btnSubmitReview.textContent = '사진 업로드 중...';
          
          // 1. 이미지 압축 (최대 600px, 0.7 퀄리티)
          const base64Data = await compressImage(selectedReviewPhotoFile, 600, 600, 0.7);
          
          const timestamp = Math.floor(Date.now() / 1000);
          const extension = selectedReviewPhotoFile.name.split('.').pop() || 'jpg';
          const fileName = `review_${currentReviewOrderId}_${timestamp}.${extension}`;
          
          // 2. 이미지 업로드 API 호출
          const uploadRes = await fetchAPI('uploadImage', {
            method: 'POST',
            body: {
              base64Data: base64Data,
              fileName: fileName,
              orderId: currentReviewOrderId,
              orderToken: currentReviewOrderToken,
              reviewEdit: currentReviewMode === 'edit',
              type: 'review'
            }
          });
          
          if (uploadRes && uploadRes.success && uploadRes.imageUrl) {
            imageUrl = uploadRes.imageUrl;
          } else {
            const errMsg = (uploadRes && uploadRes.message) ? uploadRes.message : '네트워크 오류 또는 서버 응답 실패';
            if (currentReviewMode === 'edit') {
              alert(`후기 사진 업로드에 실패했습니다.\n\n${errMsg}`);
              btnSubmitReview.disabled = false;
              btnSubmitReview.textContent = '수정 저장';
              return;
            }
            if (!confirm(`⚠️ 후기 사진 업로드에 실패했습니다.\n\n[오류 내용]\n${errMsg}\n\n사진 없이 후기 텍스트만 등록하시겠습니까?`)) {
              btnSubmitReview.disabled = false;
              btnSubmitReview.textContent = '보내기';
              return;
            }
          }
        }

        btnSubmitReview.textContent = currentReviewMode === 'edit' ? '후기 수정 중...' : '후기 제출 중...';
        const action = currentReviewMode === 'edit' ? 'updateGuestReview' : 'submitReview';
        const imageAction = currentReviewMode === 'edit'
          ? (selectedReviewPhotoFile ? 'replace' : currentReviewImageAction)
          : 'keep';
        const res = await fetchAPI(action, {
          method: 'POST',
          body: {
            orderId: currentReviewOrderId,
            orderToken: currentReviewOrderToken,
            guestName: currentReviewGuestName,
            stamp: stamp,
            tags: tags,
            comment: comment,
            isPublic: isPublic,
            imageUrl: imageUrl,
            imageAction: imageAction,
            photoPublicConsent: reviewPhotoPublicConsent?.checked === true
          }
        });

        if (res && res.success) {
          AppState.vibrate(80);
          const wasEdit = currentReviewMode === 'edit';
          const nextImageUrl = wasEdit
            ? (imageAction === 'remove' ? '' : (imageAction === 'replace' ? imageUrl : currentReviewImageUrl))
            : imageUrl;
          alert(wasEdit ? '후기를 수정했습니다.' : '소중한 응원을 남겨주셔서 감사합니다! ❤️');
          closeReviewModal();
          
          // 로컬스토리지 guestOrders 상태 업데이트
          try {
            const updated = guestOrders.map(o => {
              if (o.orderNo === currentReviewOrderId || o.orderToken === currentReviewOrderId || (o.orderNo && currentReviewOrderId && currentReviewOrderId.includes(o.orderNo))) {
                return { 
                  ...o, 
                  reviewed: true, 
                  reviewComment: comment, 
                  comment: comment,
                  stamp: stamp,
                  tags: tags,
                  imageUrl: nextImageUrl,
                  reviewUpdatedAt: wasEdit ? (res.review?.updatedAt || new Date().toISOString()) : '',
                  reviewEditCount: wasEdit ? Number(res.review?.editCount || Number(o.reviewEditCount || 0) + 1) : 0
                };
              }
              return o;
            });
            localStorage.setItem('guestOrders', JSON.stringify(updated));
          } catch(e) {}

          // 화면 갱신
          loadOrders();
        } else {
          alert((currentReviewMode === 'edit' ? '후기 수정' : '후기 제출') + '에 실패했습니다: ' + (res.message || '오류'));
          btnSubmitReview.disabled = false;
          btnSubmitReview.textContent = currentReviewMode === 'edit' ? '수정 저장' : '보내기';
        }
      } catch (e) {
        console.error('후기 제출 오류:', e);
        alert('통신 오류가 발생했습니다.');
        btnSubmitReview.disabled = false;
        btnSubmitReview.textContent = currentReviewMode === 'edit' ? '수정 저장' : '보내기';
      }
    });
  }

  // 초기 실행
  loadOrders();

  // 지난 보관 주문 불러오기 버튼 바인딩
  const btnLoadArchived = document.getElementById('btn-load-archived-orders');
  if (btnLoadArchived) {
    btnLoadArchived.addEventListener('click', async () => {
      btnLoadArchived.disabled = true;
      const origText = btnLoadArchived.innerHTML;
      btnLoadArchived.innerHTML = '📁 보관 주문 불러오는 중... ⏳';
      try {
        await loadOrders(true);
        btnLoadArchived.innerHTML = '✅ 지난 보관 주문 불러오기 완료';
        btnLoadArchived.style.backgroundColor = '#EDF2F7';
        btnLoadArchived.style.color = '#718096';
        btnLoadArchived.style.borderColor = '#E2E8F0';
      } catch(e) {
        console.error('보관 주문 불러오기 오류:', e);
        btnLoadArchived.disabled = false;
        btnLoadArchived.innerHTML = origText;
        alert('지난 보관 주문을 불러오는 중 오류가 발생했습니다.');
      }
    });
  }

  // 외부에서 후기 작성 요청(openReview=true)으로 들어왔을 때 가장 최근 미작성 주문에 대해 모달 자동 띄우기
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('openReview') === 'true') {
    try {
      const guestOrders = JSON.parse(localStorage.getItem('guestOrders') || '[]');
      const unreviewedOrders = guestOrders.filter(o => 
        (o.status === 'Y' || o.servedYn === 'Y') && 
        (o.reviewed !== true && o.reviewed !== 'true')
      );
      
      if (unreviewedOrders.length > 0) {
        // 로컬 스토리지는 시간순으로 추가되므로 배열의 마지막 요소가 가장 최신
        const targetOrder = unreviewedOrders[unreviewedOrders.length - 1];
        const guestName = targetOrder.guestName || (targetOrder.nickname ? targetOrder.nickname.replace(/ \((체험|비회원)\)/g, '') : '게스트');
        
        // 화면 렌더링 후 모달 팝업
        setTimeout(() => {
          openReviewModalFor(targetOrder.orderNo, guestName, targetOrder.orderToken);
        }, 300);
      }
    } catch (e) {}
  }
});
