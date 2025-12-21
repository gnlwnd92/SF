#!/usr/bin/env node

/**
 * 간단한 실행 파일 - inquirer 없이 직접 실행
 */

console.log('===== SIMPLE START =====');

const path = require('path');
const fs = require('fs');

// .env 파일 체크 및 생성
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('Creating .env file...');
  const defaultEnv = `ADSPOWER_API_URL=http://local.adspower.net:50325
GOOGLE_SHEETS_ID=test-sheet-id
DEBUG_MODE=true
`;
  fs.writeFileSync(envPath, defaultEnv);
}

require('dotenv').config({ path: envPath });

// 필수 디렉터리 생성
const dirs = ['credentials', 'logs', 'screenshots', 'backup', 'temp'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// 설정
const config = {
  adsPowerApiUrl: process.env.ADSPOWER_API_URL,
  googleSheetsId: process.env.GOOGLE_SHEETS_ID,
  debugMode: true
};

console.log('Config:', config);

// 간단한 메뉴 표시 (inquirer 없이)
console.log('\n========================================');
console.log('AdsPower YouTube Automation - Simple Mode');
console.log('========================================\n');
console.log('사용 가능한 명령:');
console.log('1. node index-simple.js test     - 연결 테스트');
console.log('2. node index-simple.js list     - 프로필 목록');
console.log('3. node index-simple.js pause    - 일시정지');
console.log('4. node index-simple.js resume   - 재개');
console.log('\n');

const command = process.argv[2];

async function testConnection() {
  console.log('Testing AdsPower connection...');
  try {
    const axios = require('axios');
    const response = await axios.get(`${config.adsPowerApiUrl}/api/v1/status`);
    console.log('✅ AdsPower 연결 성공:', response.data);
  } catch (error) {
    console.error('❌ AdsPower 연결 실패:', error.message);
    console.log('AdsPower 브라우저가 실행 중인지 확인하세요.');
  }
}

async function listProfiles() {
  console.log('Loading profiles...');
  try {
    const AdsPowerAdapter = require('./src/infrastructure/adapters/AdsPowerAdapter');
    const adapter = new AdsPowerAdapter(config);
    const result = await adapter.getProfiles({ pageSize: 10 });
    console.log('프로필 목록:');
    result.profiles.forEach((profile, index) => {
      console.log(`${index + 1}. ${profile.name} (${profile.id})`);
    });
    console.log(`\n총 ${result.total}개 프로필`);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function pauseWorkflow() {
  console.log('Pause workflow - 구현 예정');
  // 실제 워크플로우 구현
}

async function resumeWorkflow() {
  console.log('Resume workflow - 구현 예정');
  // 실제 워크플로우 구현
}

// 명령 실행
async function main() {
  switch(command) {
    case 'test':
      await testConnection();
      break;
    case 'list':
      await listProfiles();
      break;
    case 'pause':
      await pauseWorkflow();
      break;
    case 'resume':
      await resumeWorkflow();
      break;
    default:
      console.log('명령을 지정하세요. 예: node index-simple.js test');
  }
  
  console.log('\n완료.');
  process.exit(0);
}

// 실행
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});