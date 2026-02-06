/**
 * Google Sheets '설정' 탭에 Telegram 알림 설정 추가 (마이그레이션)
 *
 * 기존 데이터를 유지하면서 Telegram 카테고리 + 5개 설정만 안전하게 추가합니다.
 * 이미 존재하는 키는 건너뜁니다.
 *
 * 실행: node scripts/add-telegram-config.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// 추가할 Telegram 설정 데이터
const TELEGRAM_ROWS = [
  ['▶ Telegram 알림', '', '', ''],
  ['TELEGRAM_NOTIFY_CRITICAL', 'true', '영구실패 알림 (만료/계정잠김/reCAPTCHA)', ''],
  ['TELEGRAM_NOTIFY_PAYMENT_DELAY', 'true', '결제 미완료 24시간 초과 알림', ''],
  ['TELEGRAM_NOTIFY_INFINITE_LOOP', 'true', '무한루프 감지 알림', ''],
  ['TELEGRAM_NOTIFY_MAX_RETRY', 'true', '최대 재시도 초과 알림', ''],
  ['TELEGRAM_NOTIFY_PAYMENT_ISSUE', 'true', '결제수단 문제 알림 (Action needed)', ''],
];

async function main() {
  console.log('📨 Telegram 알림 설정 추가 시작...\n');

  // 1. 서비스 계정 키 파일 찾기
  const baseDir = path.resolve(__dirname, '..');
  const possiblePaths = [
    path.join(baseDir, 'src/config/youtube-automation-439913-b1c8dfe38d92.json'),
    path.join(baseDir, 'credentials', 'service-account.json'),
    path.join(baseDir, 'service_account.json'),
  ];

  let keyFile = null;

  for (const testPath of possiblePaths) {
    try {
      keyFile = await fs.readFile(testPath, 'utf8');
      console.log(`✅ 서비스 계정 키 파일 발견: ${testPath}`);
      break;
    } catch (e) {
      // 다음 경로 시도
    }
  }

  if (!keyFile) {
    console.error('❌ 서비스 계정 키 파일을 찾을 수 없습니다.');
    process.exit(1);
  }

  // 2. Google Sheets ID 확인
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) {
    console.error('❌ GOOGLE_SHEETS_ID 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }
  console.log(`✅ Google Sheets ID: ${spreadsheetId.substring(0, 10)}...`);

  // 3. Google Sheets API 인증
  const key = JSON.parse(keyFile);
  const auth = new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  await auth.authorize();
  console.log('✅ Google API 인증 성공');

  const sheets = google.sheets({ version: 'v4', auth });
  const sheetName = '설정';

  // 4. 기존 데이터 조회 (중복 체크용)
  let existingKeys = new Set();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`
    });

    const rows = response.data.values || [];
    for (const row of rows) {
      if (row && row[0]) {
        existingKeys.add(String(row[0]).trim());
      }
    }
    console.log(`✅ 기존 설정 ${existingKeys.size}개 행 확인\n`);
  } catch (error) {
    console.error('❌ 기존 데이터 조회 실패:', error.message);
    process.exit(1);
  }

  // 5. 이미 존재하는 키 필터링
  const telegramKeys = TELEGRAM_ROWS
    .filter(r => !r[0].startsWith('▶'))
    .map(r => r[0]);

  const alreadyExists = telegramKeys.filter(k => existingKeys.has(k));

  if (alreadyExists.length === telegramKeys.length) {
    console.log('⚠️ 모든 Telegram 설정이 이미 존재합니다. 추가할 항목이 없습니다.');
    console.log('   기존 키:', alreadyExists.join(', '));
    return;
  }

  if (alreadyExists.length > 0) {
    console.log(`⚠️ 일부 키가 이미 존재합니다: ${alreadyExists.join(', ')}`);
  }

  // 6. 추가할 행 결정 (중복 제외)
  const now = new Date();
  const timestamp = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  // 카테고리 헤더가 이미 있는지 확인
  const hasCategoryHeader = existingKeys.has('▶ Telegram 알림');

  const rowsToAppend = [];

  // 카테고리 헤더 추가 (없으면)
  if (!hasCategoryHeader) {
    rowsToAppend.push(['▶ Telegram 알림', '', '', '']);
  }

  // 설정 행 추가 (중복 제외)
  for (const row of TELEGRAM_ROWS) {
    if (row[0].startsWith('▶')) continue; // 카테고리 헤더는 위에서 처리
    if (existingKeys.has(row[0])) {
      console.log(`   ⏭️ ${row[0]} - 이미 존재 (스킵)`);
      continue;
    }
    rowsToAppend.push([row[0], row[1], row[2], timestamp]);
  }

  if (rowsToAppend.length === 0) {
    console.log('\n⚠️ 추가할 행이 없습니다.');
    return;
  }

  // 7. 시트에 추가 (append)
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: rowsToAppend
      }
    });

    console.log(`\n✅ ${rowsToAppend.length}개 행 추가 완료!`);
    console.log('\n추가된 항목:');
    for (const row of rowsToAppend) {
      if (row[0].startsWith('▶')) {
        console.log(`\n  ${row[0]}`);
      } else {
        console.log(`    ${row[0]} = ${row[1]}  (${row[2]})`);
      }
    }
  } catch (error) {
    console.error('❌ 데이터 추가 실패:', error.message);
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('🎉 Telegram 알림 설정 추가 완료!');
  console.log('═'.repeat(50));
  console.log('\n💡 시트에서 값을 false로 변경하면 해당 유형 알림이 비활성화됩니다.');
  console.log('   (5분 캐시 주기로 자동 반영)');
}

main().catch(error => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});
