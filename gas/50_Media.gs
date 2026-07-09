/**
 * 1. 이미지 주소 변환 및 가공 함수
 * 구글 드라이브 주소를 받아 썸네일/보기 주소 포맷으로 자동 정규화합니다.
 */
function makeImageUrl(value) {
  if (!value) return '';

  const text = String(value).trim();
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (match && match[1]) {
    return `https://drive.google.com/uc?export=view&id=${match[1]}`;
  }

  if (text.startsWith('https://drive.google.com/uc')) return text;
  if (text.startsWith('http')) return text;

  return `https://drive.google.com/uc?export=view&id=${text}`;
}

/**
 * 19. Google Drive 이미지 업로드 API
 */
function uploadImage(data) {
  try {
    const base64Data = data.base64Data; // 'data:image/jpeg;base64,...'
    const fileName = data.fileName;
    const type = data.type; // 'user' 또는 'snack' 또는 'review'

    if (!base64Data || !fileName || !type) {
      return {
        success: false,
        message: '필수 매개변수(base64Data, fileName, type)가 누락되었습니다.'
      };
    }

    // 1. 이미지 크기 제한 (Base64 문자열 길이 기준 약 3.5MB 이하)
    // 3.5MB * 1.33 = 약 4,650,000 characters
    if (base64Data.length > 4700000) {
      return {
        success: false,
        message: '이미지 파일 크기가 너무 큽니다. 3.5MB 이하의 파일만 업로드 가능합니다.'
      };
    }

    // 2. 이미지 MIME 형식 검증
    const mimeTypeMatch = base64Data.match(/^data:(image\/(jpeg|png|webp|gif|jpg));base64,/i);
    if (!mimeTypeMatch) {
      return {
        success: false,
        message: '허용되지 않는 파일 형식입니다. 이미지 파일(jpg, jpeg, png, webp, gif)만 업로드할 수 있습니다.'
      };
    }

    // 3. 보안 검증
    if (type === 'user' || type === 'snack') {
      const auth = verifyAdminToken(data);
      if (!auth.success) {
        return auth;
      }
    } else if (type === 'review') {
      // 게스트 후기 사진 업로드 시 orderToken 필수 검증
      const orderToken = String(data.orderToken || '').trim();
      if (!orderToken) {
        return {
          success: false,
          message: '주문 확인 정보(토큰)가 없어 이미지를 업로드할 수 없습니다.'
        };
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const orderSheet = ss.getSheetByName(SHEET.ORDERS);
      if (!orderSheet) {
        return { success: false, message: '주문내역 시트를 찾을 수 없습니다.' };
      }
      const values = orderSheet.getDataRange().getValues();
      const headers = values[0] || [];
      const orderTokenIdx = headers.indexOf('orderToken');
      const userIdIdx = headers.indexOf('이용자ID');
      const servedYnIdx = headers.indexOf('제공여부');
      const statusIdx = headers.indexOf('상태');
      const reviewedIdx = headers.indexOf('reviewed');
      const tIdx = orderTokenIdx !== -1 ? orderTokenIdx : 10;
      const uIdx = userIdIdx !== -1 ? userIdIdx : 2;
      const sIdx = servedYnIdx !== -1 ? servedYnIdx : 8;
      const rIdx = reviewedIdx !== -1 ? reviewedIdx : 14;

      const matchedRows = values.slice(1).filter(row =>
        String(row[tIdx]).trim() === orderToken && String(row[uIdx]).trim() === 'guest'
      );

      if (matchedRows.length === 0) {
        return {
          success: false,
          message: '유효하지 않은 주문 정보입니다.'
        };
      }

      const firstMatchedRow = matchedRows[0];
      const servedYnValue = firstMatchedRow[sIdx];
      const statusValue = statusIdx !== -1 ? firstMatchedRow[statusIdx] : '';
      if (servedYnValue !== 'Y' && servedYnValue !== '수령완료' && statusValue !== '수령완료') {
        return {
          success: false,
          message: '수령완료된 주문만 후기 사진을 업로드할 수 있습니다.'
        };
      }

      const isAlreadyReviewed = matchedRows.some(row => {
        const reviewedValue = row[rIdx];
        return reviewedValue === true || String(reviewedValue).toUpperCase() === 'TRUE' || String(reviewedValue).toUpperCase() === 'Y';
      });
      if (isAlreadyReviewed) {
        return {
          success: false,
          message: '이미 응원 메시지를 남긴 주문입니다.'
        };
      }
    } else {
      return { success: false, message: '올바르지 않은 이미지 타입입니다.' };
    }

    // base64 헤더 제거 및 바이너리 디코딩
    const base64Parts = base64Data.split(',');
    const rawBase64 = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
    const decodedBytes = Utilities.base64Decode(rawBase64);

    // 파일 생성용 blob 생성 (MimeType 파싱)
    const mimeMatch = base64Parts[0].match(/data:(.*?);/);
    const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const blob = Utilities.newBlob(decodedBytes, contentType, fileName);

    // 대상 폴더 지정
    let folderId = '';
    if (type === 'user') {
      folderId = USER_IMAGE_FOLDER_ID;
    } else if (type === 'snack') {
      folderId = SNACK_IMAGE_FOLDER_ID;
    } else if (type === 'review') {
      folderId = REVIEW_IMAGE_FOLDER_ID;
    } else {
      return { success: false, message: '올바르지 않은 이미지 타입입니다.' };
    }

    const folder = DriveApp.getFolderById(folderId);
    if (!folder) {
      return { success: false, message: '대상 구글 드라이브 폴더를 찾을 수 없습니다.' };
    }

    // 파일 업로드
    const file = folder.createFile(blob);

    // 링크가 있는 누구나 볼 수 있도록 공개 보기 권한 설정
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      Logger.log("Sharing permission set failed (Workspace policy): " + sharingError.toString());
      // 워크스페이스 정책상 setSharing이 제한되더라도, 상위 폴더 권한 상속을 통해 누구나 뷰어로 볼 수 있으므로 무시하고 진행합니다.
    }

    const fileId = file.getId();
    const imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    return {
      success: true,
      imageUrl: imageUrl
    };
  } catch (error) {
    return {
      success: false,
      message: '이미지 업로드 중 오류 발생: ' + error.toString()
    };
  }
}
