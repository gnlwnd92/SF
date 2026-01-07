/**
 * Google Sheets '설정' 탭 초기화 스크립트
 *
 * 18개 설정 항목을 '설정' 시트에 직접 입력합니다.
 *
 * 실행: node scripts/setup-config-sheet.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// 설정 데이터 (카테고리 헤더 포함)
const CONFIG_DATA = [
  // 헤더 행
  ['설정키', '설정값', '설명', '수정시간'],

  // ▶ 시간 설정
  ['▶ 시간 설정', '', '', ''],
  ['RESUME_MINUTES_BEFORE', '30', '결제 전 M분에 "일시중지" → "결제중" 전환', ''],
  ['PAUSE_MINUTES_AFTER', '10', '결제 후 N분에 "결제중" → "일시중지" 전환', ''],
  ['CHECK_INTERVAL_SECONDS', '60', '통합워커 체크 간격 (초)', ''],

  // ▶ 재시도 설정
  ['▶ 재시도 설정', '', '', ''],
  ['MAX_RETRY_COUNT', '10', '최대 재시도 횟수', ''],
  ['RETRY_DELAY_MS', '2000', '재시도 간 대기 시간 (ms)', ''],
  ['RETRY_ATTEMPTS', '3', 'AdsPower API 재시도 횟수', ''],

  // ▶ 결제 미완료
  ['▶ 결제 미완료', '', '', ''],
  ['PAYMENT_PENDING_MAX_HOURS', '24', '결제 미완료 최대 대기 (시간)', ''],
  ['PAYMENT_PENDING_RETRY_MINUTES', '30', '결제 미완료 재시도 간격 (분)', ''],

  // ▶ 대기 시간
  ['▶ 대기 시간', '', '', ''],
  ['CLICK_WAIT_MIN_MS', '500', '클릭 전 최소 대기 (ms)', ''],
  ['CLICK_WAIT_MAX_MS', '1500', '클릭 전 최대 대기 (ms)', ''],
  ['PAGE_LOAD_WAIT_MS', '3000', '페이지 로드 대기 (ms)', ''],
  ['POPUP_WAIT_MS', '2000', '팝업 표시 대기 (ms)', ''],

  // ▶ 타임아웃
  ['▶ 타임아웃', '', '', ''],
  ['NAVIGATION_TIMEOUT_MS', '30000', '페이지 네비게이션 타임아웃 (ms)', ''],
  ['LOGIN_CHECK_TIMEOUT_MS', '10000', '로그인 체크 타임아웃 (ms)', ''],
  ['LANGUAGE_DETECT_TIMEOUT_MS', '5000', '언어 감지 타임아웃 (ms)', ''],

  // ▶ 브라우저
  ['▶ 브라우저', '', '', ''],
  ['BROWSER_CLOSE_DELAY_MS', '2000', '브라우저 종료 후 대기 (ms)', ''],
  ['BROWSER_REOPEN_DELAY_MS', '5000', '브라우저 재시작 전 대기 (ms)', ''],

  // ▶ 잠금
  ['▶ 잠금', '', '', ''],
  ['LOCK_EXPIRY_MINUTES', '15', '좀비 잠금 만료 시간 (분)', ''],
];

async function main() {
  console.log('🔧 Google Sheets "설정" 탭 초기화 시작...\n');

  // 1. 서비스 계정 키 파일 찾기
  const baseDir = path.resolve(__dirname, '..');
  const possiblePaths = [
    path.join(baseDir, 'src/config/youtube-automation-439913-b1c8dfe38d92.json'),
    path.join(baseDir, 'credentials', 'service-account.json'),
    path.join(baseDir, 'service_account.json'),
  ];

  let keyFile = null;
  let keyPath = null;

  for (const testPath of possiblePaths) {
    try {
      keyFile = await fs.readFile(testPath, 'utf8');
      keyPath = testPath;
      console.log(`✅ 서비스 계정 키 파일 발견: ${testPath}`);
      break;
    } catch (e) {
      // 다음 경로 시도
    }
  }

  if (!keyFile) {
    console.error('❌ 서비스 계정 키 파일을 찾을 수 없습니다.');
    console.error('   확인할 경로:', possiblePaths.join('\n   '));
    process.exit(1);
  }

  // 2. Google Sheets ID 확인
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) {
    console.error('❌ GOOGLE_SHEETS_ID 환경변수가 설정되지 않았습니다.');
    console.error('   .env 파일에 GOOGLE_SHEETS_ID를 설정해주세요.');
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

  // 4. '설정' 시트 존재 여부 확인
  const sheetName = '설정';
  let sheetExists = false;

  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const existingSheets = response.data.sheets || [];
    sheetExists = existingSheets.some(
      sheet => sheet.properties && sheet.properties.title === sheetName
    );

    if (sheetExists) {
      console.log(`✅ "${sheetName}" 시트가 이미 존재합니다.`);
    } else {
      console.log(`⚠️ "${sheetName}" 시트가 없습니다. 새로 생성합니다...`);

      // 시트 생성
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });
      console.log(`✅ "${sheetName}" 시트 생성 완료`);
    }
  } catch (error) {
    console.error('❌ 시트 확인/생성 실패:', error.message);
    process.exit(1);
  }

  // 5. 기존 데이터 삭제 (있는 경우)
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:D`
    });
    console.log(`✅ 기존 데이터 삭제 완료`);
  } catch (error) {
    // 데이터가 없어도 계속 진행
    console.log(`⚠️ 기존 데이터 없음 (또는 삭제 불필요)`);
  }

  // 6. 새 데이터 입력
  try {
    const now = new Date();
    const timestamp = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // 수정시간 열에 현재 시간 추가 (카테고리 헤더 제외)
    const dataWithTimestamp = CONFIG_DATA.map((row, index) => {
      if (index === 0) return row; // 헤더
      if (row[0].startsWith('▶')) return row; // 카테고리 헤더
      return [row[0], row[1], row[2], timestamp]; // 설정 값
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: dataWithTimestamp
      }
    });

    console.log(`\n✅ 데이터 입력 완료!`);
    console.log(`   - 총 ${CONFIG_DATA.length}개 행 (헤더 1 + 카테고리 6 + 설정 18 = 25행)`);
    console.log(`   - 설정 항목: 18개`);
  } catch (error) {
    console.error('❌ 데이터 입력 실패:', error.message);
    process.exit(1);
  }

  // 7. 열 너비 조정 (선택적)
  try {
    // 시트 ID 가져오기
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    const sheetId = sheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [
          // A열: 설정키 (250px)
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 250 },
              fields: 'pixelSize'
            }
          },
          // B열: 설정값 (100px)
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
              properties: { pixelSize: 100 },
              fields: 'pixelSize'
            }
          },
          // C열: 설명 (300px)
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
              properties: { pixelSize: 300 },
              fields: 'pixelSize'
            }
          },
          // D열: 수정시간 (180px)
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
              properties: { pixelSize: 180 },
              fields: 'pixelSize'
            }
          }
        ]
      }
    });
    console.log('✅ 열 너비 조정 완료');
  } catch (error) {
    console.log('⚠️ 열 너비 조정 실패 (무시):', error.message);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('🎉 Google Sheets "설정" 탭 초기화 완료!');
  console.log('═'.repeat(50));
  console.log('\n입력된 설정 목록:');

  let settingCount = 0;
  for (const row of CONFIG_DATA) {
    if (row[0] === '설정키') continue; // 헤더 스킵
    if (row[0].startsWith('▶')) {
      console.log(`\n${row[0]}`);
    } else {
      settingCount++;
      console.log(`  ${settingCount.toString().padStart(2)}. ${row[0]} = ${row[1]}`);
    }
  }

  console.log(`\n총 ${settingCount}개 설정 입력 완료`);
}

main().catch(error => {
  console.error('❌ 스크립트 실행 실패:', error);
  process.exit(1);
});
