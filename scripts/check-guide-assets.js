#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const guidePages = ['order-guide.html', 'review-guide.html'];
const errors = [];

for (const page of guidePages) {
  const source = fs.readFileSync(path.join(root, page), 'utf8');
  const imagePattern = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(source))) {
    const tag = match[0];
    const imagePath = match[1].split(/[?#]/)[0];
    if (/^(?:https?:|data:)/i.test(imagePath)) continue;

    const absolutePath = path.resolve(root, imagePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`${page}: 이미지 파일이 없습니다: ${imagePath}`);
    }
    if (!/\balt=["'][^"']+["']/i.test(tag)) {
      errors.push(`${page}: 이미지 대체 텍스트가 비어 있습니다: ${imagePath}`);
    }
  }
}

if (errors.length) {
  console.error('Guide asset check failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Guide asset check passed: ${guidePages.length} pages`);
