#!/usr/bin/env node

/**
 * Mock Repository를 사용하는 실행 파일
 * Google Sheets 연결 없이 테스트 가능
 */

// Mock 모드 활성화
process.env.USE_MOCK_REPOSITORY = 'true';
console.log('[MOCK MODE] Using Mock Google Sheets Repository');

// 기본 index.js 실행
require('./index.js');