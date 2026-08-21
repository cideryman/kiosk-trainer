const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Range {
  constructor(sheet, row, column, numRows = 1, numColumns = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numColumns = numColumns;
  }

  getValues() {
    return Array.from({ length: this.numRows }, (_, rowOffset) =>
      Array.from({ length: this.numColumns }, (_, columnOffset) =>
        this.sheet.values[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
      )
    );
  }

  setValues(values) {
    for (let rowOffset = 0; rowOffset < this.numRows; rowOffset++) {
      const targetRow = this.row - 1 + rowOffset;
      if (!this.sheet.values[targetRow]) this.sheet.values[targetRow] = [];
      for (let columnOffset = 0; columnOffset < this.numColumns; columnOffset++) {
        this.sheet.values[targetRow][this.column - 1 + columnOffset] = values[rowOffset][columnOffset];
      }
    }
    return this;
  }

  setValue(value) {
    return this.setValues([[value]]);
  }
}

class Sheet {
  constructor(values) {
    this.values = values.map(row => row.slice());
    this.maxColumns = Math.max(1, ...this.values.map(row => row.length));
  }

  getLastRow() { return this.values.length; }
  getLastColumn() { return Math.max(1, ...this.values.map(row => row.length)); }
  getMaxColumns() { return this.maxColumns; }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(row, column, numRows, numColumns) { return new Range(this, row, column, numRows, numColumns); }
  insertColumnsAfter(_after, count) { this.maxColumns += count; }
  appendRow(row) { this.values.push(row.slice()); }
}

const REVIEW_HEADERS = [
  'createdAt', 'orderId', 'guestName', 'stamp', 'tags', 'comment',
  'isPublic', 'imageUrl', 'replyText', 'replyCreatedAt', 'updatedAt', 'editCount'
];
const ORDER_HEADERS = ['주문번호', '이용자ID', 'orderToken'];
const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
const replyCreatedAt = new Date(Date.now() - 12 * 60 * 60 * 1000);
const sheets = {
  주문내역: new Sheet([
    ORDER_HEADERS,
    ['ORDER-1', 'guest', 'TOKEN-1'],
    ['ORDER-1', 'guest', 'TOKEN-1']
  ]),
  주문보관: new Sheet([ORDER_HEADERS]),
  후기내역: new Sheet([
    REVIEW_HEADERS.slice(0, 10),
    [createdAt, 'ORDER-1', '손님', 'dalgomi_thumb', '친절한 미소', '처음 후기', false,
      'https://drive.google.com/uc?export=view&id=old-image', '고마워요', replyCreatedAt]
  ])
};

const cleanedImages = [];
const context = {
  console,
  Date,
  JSON,
  Math,
  isFinite,
  SHEET: { ORDERS: '주문내역', ARCHIVE: '주문보관', REVIEWS: '후기내역' },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: name => sheets[name] || null,
      insertSheet: name => (sheets[name] = new Sheet([[]]))
    })
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ remove: () => {}, get: () => null, put: () => {} }) },
  Logger: { log: () => {} },
  clearOrderReadCache: () => {},
  trashReviewImageFile_: url => cleanedImages.push(url)
};

vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'gas', '70_Reviews.gs'), 'utf8');
vm.runInContext(`${source}\nthis.reviewApi = { getGuestReview, updateGuestReview };`, context);
const api = context.reviewApi;

assert.strictEqual(api.getGuestReview({ orderId: 'ORDER-1', orderToken: 'WRONG' }).success, false);

const privateReview = api.getGuestReview({ orderId: 'ORDER-1', orderToken: 'TOKEN-1' });
assert.strictEqual(privateReview.success, true);
assert.strictEqual(privateReview.review.isPublic, false);
assert.strictEqual(privateReview.review.editable, true);

const missingConsent = api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_heart', tags: '', comment: '수정 후기',
  isPublic: true, imageAction: 'keep'
});
assert.strictEqual(missingConsent.success, false);

const keptPhoto = api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_heart', tags: '정확한 배달',
  comment: '사진 유지', isPublic: false, imageAction: 'keep'
});
assert.strictEqual(keptPhoto.success, true);
assert.strictEqual(keptPhoto.review.imageUrl, 'https://drive.google.com/uc?export=view&id=old-image');
assert.strictEqual(cleanedImages.length, 0);

const removedPhoto = api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_heart', tags: '정확한 배달',
  comment: '수정 후기', isPublic: true, imageAction: 'remove', photoPublicConsent: false
});
assert.strictEqual(removedPhoto.success, true);
assert.strictEqual(removedPhoto.review.editCount, 2);
assert.deepStrictEqual(sheets.후기내역.values[0].slice(0, 12), REVIEW_HEADERS);
assert.strictEqual(removedPhoto.review.replyText, '고마워요');
assert.strictEqual(removedPhoto.review.createdAt.getTime(), createdAt.getTime());
assert.strictEqual(removedPhoto.review.imageUrl, '');
assert.deepStrictEqual(cleanedImages, ['https://drive.google.com/uc?export=view&id=old-image']);

const replacedPhoto = api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_delivery', tags: '',
  comment: '사진 교체', isPublic: false, imageAction: 'replace',
  imageUrl: 'https://drive.google.com/uc?export=view&id=new-image'
});
assert.strictEqual(replacedPhoto.review.editCount, 3);
assert.strictEqual(replacedPhoto.review.imageUrl, 'https://drive.google.com/uc?export=view&id=new-image');
assert.strictEqual(sheets.후기내역.values.length, 2);

sheets.후기내역.values[1][0] = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 1000);
assert.strictEqual(api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_thumb', tags: '',
  comment: '', isPublic: false, imageAction: 'keep'
}).success, true);

sheets.후기내역.values[1][0] = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000);
assert.strictEqual(api.updateGuestReview({
  orderId: 'ORDER-1', orderToken: 'TOKEN-1', stamp: 'dalgomi_thumb', tags: '',
  comment: '', isPublic: false, imageAction: 'keep'
}).success, false);

sheets.후기내역.values[1][0] = createdAt;
sheets.주문보관.values.push(['ORDER-2', 'guest', 'TOKEN-2']);
sheets.후기내역.values.push([createdAt, 'ORDER-2', '보관 손님', 'dalgomi_thumb', '', '', true, '', '', '', '', 0]);
assert.strictEqual(api.getGuestReview({ orderId: 'ORDER-2', orderToken: 'TOKEN-2' }).success, true);

sheets.후기내역.values.push([createdAt, 'ORDER-2', '중복', 'dalgomi_thumb', '', '', true, '', '', '', '', 0]);
assert.strictEqual(api.getGuestReview({ orderId: 'ORDER-2', orderToken: 'TOKEN-2' }).success, false);

console.log('Review edit tests passed: ownership, private review, consent, edit history, expiry, archive, duplicates');
