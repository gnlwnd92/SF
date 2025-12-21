/**
 * Google Sheets 삭제 탭의 결과 열 직접 초기화 (사용자 확인 없이)
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
require('dotenv').config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'credentials', 'service-account.json');

async function clearResultsDirect() {
    console.log(chalk.blue('═'.repeat(60)));
    console.log(chalk.blue.bold('삭제 탭 결과 직접 초기화'));
    console.log(chalk.blue('═'.repeat(60)));
    
    try {
        // 서비스 계정 키 파일 읽기
        const keyFile = await fs.readJson(SERVICE_ACCOUNT_PATH);
        
        // JWT 클라이언트 생성
        const auth = new google.auth.JWT(
            keyFile.client_email,
            null,
            keyFile.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        
        // 인증
        await auth.authorize();
        
        // Sheets API 클라이언트 생성
        const sheets = google.sheets({ version: 'v4', auth });
        
        // E2:F100 범위를 빈 값으로 업데이트 (충분히 큰 범위)
        console.log(chalk.cyan('결과 열 초기화 중...'));
        
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: '삭제!E2:F100'
        });
        
        console.log(chalk.green('✅ E열과 F열 초기화 완료'));
        
        // 초기화 후 확인
        const checkResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: '삭제!A2:F10'
        });
        
        const rows = checkResponse.data.values || [];
        
        console.log(chalk.cyan('\n초기화 후 데이터 확인:'));
        rows.slice(0, 3).forEach((row, index) => {
            console.log(chalk.yellow(`행 ${index + 2}:`));
            console.log(`  - user_id: ${row[1] || '(비어있음)'}`);
            console.log(`  - 결과: ${row[4] || chalk.green('(비어있음 - 초기화됨)')}`);
        });
        
        console.log(chalk.blue('\n' + '═'.repeat(60)));
        console.log(chalk.green.bold('✅ 초기화 완료! 이제 삭제 작업을 다시 실행할 수 있습니다.'));
        console.log(chalk.blue('═'.repeat(60)));
        
    } catch (error) {
        console.error(chalk.red('오류 발생:'), error.message);
    }
}

// 실행
clearResultsDirect().catch(console.error);