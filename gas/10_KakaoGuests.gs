function getKakaoLoginConfig(redirectUri) {
  const clientId = PropertiesService
    .getScriptProperties()
    .getProperty('KAKAO_REST_API_KEY');

  if (!clientId) {
    return {
      success: false,
      message: 'KAKAO_REST_API_KEY 스크립트 속성이 설정되지 않았습니다.',
    };
  }

  return {
    success: true,
    clientId,
    redirectUri: redirectUri || '',
  };
}

function buildKakaoGuestKey(kakaoId) {
  const salt = PropertiesService
    .getScriptProperties()
    .getProperty('KAKAO_GUEST_KEY_SALT');

  if (!salt) {
    throw new Error('KAKAO_GUEST_KEY_SALT 스크립트 속성이 설정되지 않았습니다.');
  }

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'kakao:' + String(kakaoId) + ':' + salt,
    Utilities.Charset.UTF_8
  );
  return 'kakao_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').slice(0, 32);
}

function exchangeKakaoAuthCode(data) {
  const code = String(data.code || '').trim();
  const redirectUri = String(data.redirectUri || '').trim();
  if (!code || !redirectUri) {
    return {
      success: false,
      message: '카카오 인증 코드 또는 redirectUri가 누락되었습니다.',
    };
  }

  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('KAKAO_REST_API_KEY');
  const clientSecret = props.getProperty('KAKAO_CLIENT_SECRET');
  if (!clientId) {
    return {
      success: false,
      message: 'KAKAO_REST_API_KEY 스크립트 속성이 설정되지 않았습니다.',
    };
  }

  try {
    const tokenPayload = {
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
    };
    if (clientSecret) {
      tokenPayload.client_secret = clientSecret;
    }

    const tokenResponse = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded;charset=utf-8',
      payload: encodeFormPayload(tokenPayload),
      muteHttpExceptions: true,
    });
    const tokenCode = tokenResponse.getResponseCode();
    const tokenBody = JSON.parse(tokenResponse.getContentText() || '{}');
    if (tokenCode < 200 || tokenCode >= 300 || !tokenBody.access_token) {
      Logger.log('Kakao token exchange failed: ' + tokenResponse.getContentText());
      return {
        success: false,
        message: '카카오 인증을 확인하지 못했습니다. 다시 시도해 주세요.',
      };
    }

    const profileResponse = UrlFetchApp.fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + tokenBody.access_token,
      },
      muteHttpExceptions: true,
    });
    const profileCode = profileResponse.getResponseCode();
    const profileBody = JSON.parse(profileResponse.getContentText() || '{}');
    if (profileCode < 200 || profileCode >= 300 || !profileBody.id) {
      Logger.log('Kakao profile fetch failed: ' + profileResponse.getContentText());
      return {
        success: false,
        message: '카카오 사용자 확인에 실패했습니다.',
      };
    }

    return {
      success: true,
      provider: 'kakao',
      guestKey: buildKakaoGuestKey(profileBody.id),
    };
  } catch (error) {
    Logger.log('exchangeKakaoAuthCode Error: ' + (error && error.stack ? error.stack : error));
    return {
      success: false,
      message: error && error.message ? error.message : '카카오 연결 처리 중 오류가 발생했습니다.',
    };
  }
}

function ensureGuestProfileSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.GUEST_PROFILES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.GUEST_PROFILES);
  }

  const values = sheet.getDataRange().getValues();
  const currentHeaders = values[0] || [];
  const requiredHeaders = ['guestKey', 'displayName', 'deliveryPlace', 'updatedAt'];
  const headers = currentHeaders.filter(h => h !== '');
  let modified = headers.length === 0;

  requiredHeaders.forEach(header => {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      modified = true;
    }
  });

  if (modified) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function getGuestProfileByGuestKey(data) {
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = String(data.guestKey || '').trim();
  if (authProvider !== 'kakao' || !guestKey) {
    return {
      success: false,
      message: '카카오 연결 정보가 누락되었습니다.',
    };
  }

  const sheet = ensureGuestProfileSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const guestKeyIdx = headers.indexOf('guestKey');
  const displayNameIdx = headers.indexOf('displayName');
  const deliveryPlaceIdx = headers.indexOf('deliveryPlace');
  const updatedAtIdx = headers.indexOf('updatedAt');

  const row = values.slice(1).find(item => String(item[guestKeyIdx] || '').trim() === guestKey);
  if (!row) {
    return {
      success: true,
      profile: null,
    };
  }

  return {
    success: true,
    profile: {
      displayName: displayNameIdx !== -1 ? row[displayNameIdx] || '' : '',
      deliveryPlace: deliveryPlaceIdx !== -1 ? row[deliveryPlaceIdx] || '' : '',
      updatedAt: updatedAtIdx !== -1 ? row[updatedAtIdx] || '' : '',
    },
  };
}

function deleteGuestProfileByGuestKey(data) {
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = String(data.guestKey || '').trim();
  if (authProvider !== 'kakao' || !guestKey) {
    return {
      success: false,
      message: '카카오 연결 정보가 누락되었습니다.',
    };
  }

  const sheet = ensureGuestProfileSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const guestKeyIdx = headers.indexOf('guestKey');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][guestKeyIdx] || '').trim() === guestKey) {
      sheet.deleteRow(i + 1);
      return {
        success: true,
        message: '저장된 게스트 정보가 삭제되었습니다.',
      };
    }
  }

  return {
    success: true,
    message: '삭제할 저장 정보가 없습니다.',
  };
}

function updateGuestProfileByGuestKey(data) {
  const authProvider = String(data.authProvider || '').trim().toLowerCase();
  const guestKey = String(data.guestKey || '').trim();
  const displayName = String(data.displayName || '').trim();
  const deliveryPlace = String(data.deliveryPlace || '').trim();
  if (authProvider !== 'kakao' || !guestKey) {
    return {
      success: false,
      message: '카카오 연결 정보가 누락되었습니다.',
    };
  }
  if (!displayName) {
    return {
      success: false,
      message: '주문표시명을 입력해 주세요.',
    };
  }

  upsertGuestProfile(guestKey, displayName, deliveryPlace, {
    preserveBlankDeliveryPlace: false,
  });
  return {
    success: true,
    message: '프로필 정보가 수정되었습니다.',
    profile: {
      displayName: displayName,
      deliveryPlace: deliveryPlace
    }
  };
}

function upsertGuestProfile(guestKey, displayName, deliveryPlace, options) {
  if (!guestKey) return;
  const opts = options || {};

  const sheet = ensureGuestProfileSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const guestKeyIdx = headers.indexOf('guestKey');
  const displayNameIdx = headers.indexOf('displayName');
  const deliveryPlaceIdx = headers.indexOf('deliveryPlace');
  const updatedAtIdx = headers.indexOf('updatedAt');

  const safeDisplayName = String(displayName || '').replace(/ \((체험|비회원)\)/g, '').trim();
  const safeDeliveryPlace = String(deliveryPlace || '').trim();
  let targetRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][guestKeyIdx] || '').trim() === guestKey) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    sheet.appendRow([
      guestKey,
      safeDisplayName,
      safeDeliveryPlace,
      new Date(),
    ]);
    return;
  }

  const currentRow = values[targetRow - 1];
  const nextDisplayName = safeDisplayName || currentRow[displayNameIdx] || '';
  const nextDeliveryPlace = safeDeliveryPlace || (opts.preserveBlankDeliveryPlace === false ? '' : currentRow[deliveryPlaceIdx] || '');
  sheet.getRange(targetRow, displayNameIdx + 1).setValue(nextDisplayName);
  sheet.getRange(targetRow, deliveryPlaceIdx + 1).setValue(nextDeliveryPlace);
  sheet.getRange(targetRow, updatedAtIdx + 1).setValue(new Date());
}
