/**
 * 수정된 Google Sheets Repository
 * 결제재개 탭과 애즈파워현황 탭의 올바른 매핑
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

class FixedSimpleGoogleSheetsRepository {
  constructor(config = {}) {
    this.spreadsheetId = config.spreadsheetId || process.env.GOOGLE_SHEETS_ID;
    this.sheets = null;
    this.auth = null;
  }

  /**
   * Google Sheets 인증 초기화
   */
  async initialize() {
    try {
      const possiblePaths = [
        path.join(__dirname, '..', '..', '..', 'credentials', 'service-account.json'),
        path.join(__dirname, '..', '..', '..', 'service_account.json'),
        './credentials/service-account.json',
        './service_account.json'
      ];

      let serviceAccountPath;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          serviceAccountPath = p;
          break;
        }
      }

      if (!serviceAccountPath) {
        console.log('[FixedGoogleSheets] Service Account 없음, Mock 데이터 사용');
        return false;
      }

      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      
      this.auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log('[FixedGoogleSheets] Google Sheets API 초기화 완료');
      return true;
    } catch (error) {
      console.warn('[FixedGoogleSheets] 초기화 실패:', error.message);
      return false;
    }
  }

  /**
   * 결제재개 탭 데이터 가져오기 (올바른 매핑)
   */
  async getResumeTasksWithMapping() {
    try {
      if (!this.sheets) {
        await this.initialize();
      }

      if (!this.sheets) {
        // Mock 데이터 반환
        return this.getMockResumeData();
      }

      console.log('[FixedGoogleSheets] Google Sheets에서 실시간 데이터 로드 시작');

      // 1. 애즈파워현황 탭에서 매핑 정보 가져오기
      console.log('[FixedGoogleSheets] 애즈파워현황 탭 로드 중...');
      const mappingResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: '애즈파워현황!A:F' // 전체 열 가져오기
      });
      
      const mappingRows = mappingResponse.data.values || [];
      const emailToAdsPowerMap = new Map();
      
      console.log(`[FixedGoogleSheets] 애즈파워현황: ${mappingRows.length}행 로드`);
      
      // 헤더 제외하고 매핑 생성
      for (let i = 1; i < mappingRows.length; i++) {
        const row = mappingRows[i];
        if (!row) continue;
        
        // D열: 이메일/프로필명, B열: AdsPower ID
        const email = row[3]?.trim();
        const adsPowerId = row[1]?.trim();
        
        if (email && adsPowerId) {
          // 소문자로 정규화하여 저장
          const normalizedEmail = email.toLowerCase();
          emailToAdsPowerMap.set(normalizedEmail, adsPowerId);
          
          // 원본 그대로도 저장 (대소문자 차이 대응)
          emailToAdsPowerMap.set(email, adsPowerId);
        }
      }
      
      console.log(`[FixedGoogleSheets] ${emailToAdsPowerMap.size}개 이메일-AdsPower 매핑 생성`);

      // 2. 결제재개 탭 데이터 가져오기
      console.log('[FixedGoogleSheets] 결제재개 탭 로드 중...');
      const resumeResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: '결제재개!A:H' // A열부터 H열까지
      });

      const resumeRows = resumeResponse.data.values || [];
      const tasks = [];
      let mappedCount = 0;
      let unmappedCount = 0;

      console.log(`[FixedGoogleSheets] 결제재개: ${resumeRows.length}행 로드`);

      // 헤더 제외하고 데이터 처리
      for (let i = 1; i < resumeRows.length; i++) {
        const row = resumeRows[i];
        if (!row || !row[0]) continue; // A열(이메일)이 없으면 스킵
        
        // 실제 열 구조
        const email = row[0]?.trim(); // A열: 이메일
        const existingAdsPowerId = row[1]?.trim(); // B열: AdsPower ID (이미 있을 수 있음)
        const password = row[2]?.trim(); // C열: 비밀번호
        const recoveryEmail = row[3]?.trim(); // D열: 복구 이메일
        const code = row[4]?.trim(); // E열: TOTP 코드
        const status = row[5]?.trim() || '미확인'; // F열: 상태
        const nextPaymentDate = row[6]?.trim(); // G열: 다음 결제일
        const result = row[7]?.trim(); // H열: 결과/메모
        
        // AdsPower ID 찾기
        let adsPowerId = existingAdsPowerId; // 이미 B열에 있으면 그것을 사용
        
        if (!adsPowerId) {
          // B열이 비어있으면 애즈파워현황에서 찾기
          const normalizedEmail = email.toLowerCase();
          adsPowerId = emailToAdsPowerMap.get(normalizedEmail) || 
                      emailToAdsPowerMap.get(email) || 
                      null;
        }
        
        if (adsPowerId) {
          mappedCount++;
          console.log(chalk.green(`  ✅ ${i}. ${email} → ${adsPowerId}`));
        } else {
          unmappedCount++;
          console.log(chalk.yellow(`  ⚠️ ${i}. ${email} → 매핑 없음`));
        }

        tasks.push({
          rowIndex: i + 1, // 실제 시트 행 번호
          email: email,
          googleId: email,
          adsPowerId: adsPowerId,
          password: password,
          recoveryEmail: recoveryEmail,
          totpSecret: code, // TOTP 시크릿
          status: status,
          resumeDate: nextPaymentDate,
          result: result,
          hasAdsPowerId: !!adsPowerId
        });
      }

      console.log('[FixedGoogleSheets] 결제재개 작업 로드 완료');
      console.log(`[FixedGoogleSheets] 매핑 성공: ${mappedCount}개, 매핑 실패: ${unmappedCount}개`);
      console.log(`[FixedGoogleSheets] 총 재개 작업: ${tasks.length}개`);

      return tasks;

    } catch (error) {
      console.error('[FixedGoogleSheets] 데이터 로드 실패:', error.message);
      return this.getMockResumeData();
    }
  }

  /**
   * Mock 데이터 반환 (테스트용)
   */
  getMockResumeData() {
    console.log('[FixedGoogleSheets] Mock 데이터 사용');
    return [
      {
        rowIndex: 2,
        email: 'DejesusLarry49789@gmail.com',
        googleId: 'DejesusLarry49789@gmail.com',
        adsPowerId: 'k12udf2j',
        password: 'password123',
        status: '일시중지',
        hasAdsPowerId: true
      },
      {
        rowIndex: 3,
        email: 'GarzaNova57400@gmail.com',
        googleId: 'GarzaNova57400@gmail.com',
        adsPowerId: 'k12ueg6y',
        password: 'password456',
        status: '일시중지',
        hasAdsPowerId: true
      }
    ];
  }

  /**
   * 결제재개 탭에 AdsPower ID 업데이트
   */
  async updateAdsPowerIds(updates) {
    if (!this.sheets) {
      await this.initialize();
    }

    if (!this.sheets) {
      console.log('[FixedGoogleSheets] Sheets API 사용 불가');
      return false;
    }

    try {
      const batchData = [];
      
      for (const update of updates) {
        const { rowIndex, adsPowerId } = update;
        
        // B열에 AdsPower ID 업데이트
        batchData.push({
          range: `결제재개!B${rowIndex}`,
          values: [[adsPowerId]]
        });
        
        // H열에 업데이트 시간 기록
        batchData.push({
          range: `결제재개!H${rowIndex}`,
          values: [[`✅ 매핑 완료 (${new Date().toLocaleString('ko-KR')})`]]
        });
      }

      if (batchData.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            data: batchData,
            valueInputOption: 'RAW'
          }
        });
        
        console.log(`[FixedGoogleSheets] ${updates.length}개 AdsPower ID 업데이트 완료`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[FixedGoogleSheets] 업데이트 실패:', error.message);
      return false;
    }
  }
}

module.exports = FixedSimpleGoogleSheetsRepository;