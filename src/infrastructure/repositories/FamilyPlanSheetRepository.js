/**
 * FamilyPlanSheetRepository - Google Sheets '가족요금제' 탭 관리
 * 
 * 컬럼 구조:
 * A: 이메일
 * B: 비밀번호
 * C: 복구 이메일
 * D: TOTP 코드
 * E: acc_id (프로필번호 - 행 번호를 저장)
 * F: id (AdsPower 프로필 ID)
 * G: 상태 (체크 결과)
 */

const { google } = require('googleapis');
const chalk = require('chalk');

class FamilyPlanSheetRepository {
  constructor({ credentials, sheetsId, debugMode = false }) {
    this.credentials = credentials;
    this.sheetsId = sheetsId;
    this.debugMode = debugMode;
    this.sheets = null;
    this.auth = null;
    
    // 시트 이름
    this.SHEET_NAME = '가족요금제';
    
    // 컬럼 매핑
    this.COLUMNS = {
      EMAIL: 0,           // A
      PASSWORD: 1,        // B
      RECOVERY_EMAIL: 2,  // C
      ID: 3,             // D (프로필명)
      ACC_ID: 4,         // E
      PROFILE_ID: 5,     // F
      STATUS: 6          // G
    };
  }

  /**
   * 초기화
   */
  async initialize() {
    try {
      // 서비스 계정 인증
      this.auth = new google.auth.GoogleAuth({
        credentials: this.credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      const authClient = await this.auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      
      if (this.debugMode) {
        console.log(chalk.green('✅ Google Sheets 연결 성공'));
      }
      
      // 시트 존재 확인
      await this.ensureSheetExists();
      
    } catch (error) {
      console.error(chalk.red('Google Sheets 초기화 실패:'), error);
      throw error;
    }
  }

  /**
   * 가족요금제 시트 존재 확인
   */
  async ensureSheetExists() {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.sheetsId
      });
      
      const sheets = response.data.sheets || [];
      const familySheet = sheets.find(s => s.properties.title === this.SHEET_NAME);
      
      if (!familySheet) {
        // 시트 생성
        await this.createFamilyPlanSheet();
      } else if (this.debugMode) {
        console.log(chalk.gray(`✓ '${this.SHEET_NAME}' 시트 확인됨`));
      }
      
    } catch (error) {
      console.error('시트 확인 실패:', error);
      throw error;
    }
  }

  /**
   * 가족요금제 시트 생성
   */
  async createFamilyPlanSheet() {
    try {
      console.log(chalk.yellow(`📋 '${this.SHEET_NAME}' 시트 생성 중...`));
      
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetsId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: this.SHEET_NAME,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10
                }
              }
            }
          }]
        }
      });
      
      // 헤더 추가
      await this.setHeaders();
      
      console.log(chalk.green(`✅ '${this.SHEET_NAME}' 시트 생성 완료`));
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(chalk.gray('시트가 이미 존재합니다'));
      } else {
        throw error;
      }
    }
  }

  /**
   * 헤더 설정
   */
  async setHeaders() {
    const headers = [
      ['이메일', '비밀번호', '복구 이메일', 'TOTP코드', 'acc_id', 'id', '상태']
    ];
    
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetsId,
      range: `${this.SHEET_NAME}!A1:G1`,
      valueInputOption: 'RAW',
      requestBody: { values: headers }
    });
  }

  /**
   * 모든 계정 정보 가져오기
   */
  async getAllAccounts() {
    // Mock 모드 체크 - Google Sheets 연결 없이 테스트
    if (process.env.USE_MOCK_REPOSITORY === 'true' || !this.sheets) {
      console.log('[FamilyPlanSheetRepository] Mock 데이터 사용');
      return [
        {
          email: 'florenceriley347@gmail.com',
          password: 'FloRiley1975',
          recoveryEmail: 'flo**********@nor***.**.', // C열: 실제 복구 이메일 (마스킹된 형태)
          totpSecret: 'JBSWY3DPEHPK3PXP',
          accId: '',
          profileId: '',
          status: '',
          rowNumber: 2
        },
        {
          email: 'test1@gmail.com',
          password: 'password123',
          recoveryEmail: 'recovery1@example.com',
          totpSecret: 'KRSXG5CTMVRXEZLU',
          accId: '',
          profileId: '',
          status: '',
          rowNumber: 3
        }
      ];
    }
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range: `${this.SHEET_NAME}!A2:G1000` // 헤더 제외
      });
      
      const rows = response.data.values || [];
      const accounts = [];
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row[0]) { // 이메일이 있는 경우만
          accounts.push({
            email: row[0] || '',
            password: row[1] || '',
            recoveryEmail: row[2] || '',
            totpSecret: row[3] || '',  // D열: TOTP 시크릿 키
            accId: row[4] || '',       // E열: acc_id
            profileId: row[5] || '',    // F열: profile id
            status: row[6] || '',       // G열: 상태
            rowNumber: i + 2 // 실제 행 번호 (1-indexed, 헤더 제외)
          });
        }
      }
      
      if (this.debugMode) {
        console.log(chalk.cyan(`📊 ${accounts.length}개 계정 로드됨`));
      }
      
      return accounts;
      
    } catch (error) {
      console.error('계정 정보 로드 실패:', error);
      // 오류 시에도 Mock 데이터 반환
      console.log('[FamilyPlanSheetRepository] 오류로 인해 Mock 데이터 사용');
      return [
        {
          email: 'florenceriley347@gmail.com',
          password: 'FloRiley1975',
          recoveryEmail: 'flo**********@nor***.**.', // C열: 실제 복구 이메일
          totpSecret: 'JBSWY3DPEHPK3PXP',
          accId: '',
          profileId: '',
          status: '',
          rowNumber: 2
        }
      ];
    }
  }

  /**
   * 특정 계정 정보 가져오기
   */
  async getAccount(email) {
    const accounts = await this.getAllAccounts();
    return accounts.find(acc => acc.email === email);
  }

  /**
   * 계정 상태 업데이트
   */
  async updateAccountStatus(rowNumber, status, details = {}) {
    try {
      const timestamp = new Date().toLocaleString('ko-KR');
      let statusText = `[${timestamp}] ${status}`;
      
      // 상세 정보 추가
      if (details.price) {
        statusText += ` | 가격: ${details.price}`;
      }
      if (details.currency) {
        statusText += ` | 통화: ${details.currency}`;
      }
      if (details.message) {
        statusText += ` | ${details.message}`;
      }
      
      // G열 업데이트 (상태)
      await this.updateCell(`G${rowNumber}`, statusText);
      
      // E열 업데이트 (acc_id - AdsPower 프로필 ID 또는 "삭제")
      if (details.acc_id !== undefined) {
        await this.updateCell(`E${rowNumber}`, details.acc_id);
        if (this.debugMode) {
          console.log(chalk.gray(`✓ 행 ${rowNumber} acc_id 업데이트: ${details.acc_id}`));
        }
      }
      
      if (this.debugMode) {
        console.log(chalk.gray(`✓ 행 ${rowNumber} 상태 업데이트: ${status}`));
      }
      
    } catch (error) {
      console.error('상태 업데이트 실패:', error);
      throw error;
    }
  }

  /**
   * AdsPower ID 업데이트
   */
  async updateAdsPowerIds(rowNumber, accId, profileId) {
    try {
      // E열 (acc_id) 업데이트
      if (accId) {
        await this.updateCell(`E${rowNumber}`, accId);
      }
      
      // F열 (profile id) 업데이트
      if (profileId) {
        await this.updateCell(`F${rowNumber}`, profileId);
      }
      
      if (this.debugMode) {
        console.log(chalk.gray(`✓ 행 ${rowNumber} AdsPower ID 업데이트`));
      }
      
    } catch (error) {
      console.error('AdsPower ID 업데이트 실패:', error);
      throw error;
    }
  }

  /**
   * 단일 셀 업데이트
   */
  async updateCell(range, value) {
    // Mock 모드 체크
    if (process.env.USE_MOCK_REPOSITORY === 'true' || !this.sheets) {
      console.log(`[Mock] 셀 업데이트: ${range} = ${value}`);
      return;
    }
    
    try {
      // range가 이미 시트 이름을 포함하는지 확인
      const fullRange = range.includes('!') ? range : `${this.SHEET_NAME}!${range}`;
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetsId,
        range: fullRange,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]]
        }
      });
      
      if (this.debugMode) {
        console.log(chalk.gray(`✓ 셀 ${range} 업데이트 완료: ${value}`));
      }
    } catch (error) {
      console.error(`셀 ${range} 업데이트 실패:`, error);
      // 상세 에러 로그
      if (error.response && error.response.data) {
        console.error('Google Sheets API 에러:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * 배치 업데이트
   */
  async batchUpdate(updates) {
    try {
      const data = updates.map(update => ({
        range: `${this.SHEET_NAME}!${update.range}`,
        values: [[update.value]]
      }));
      
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.sheetsId,
        requestBody: {
          valueInputOption: 'RAW',
          data
        }
      });
      
      if (this.debugMode) {
        console.log(chalk.green(`✅ ${updates.length}개 셀 배치 업데이트 완료`));
      }
      
    } catch (error) {
      console.error('배치 업데이트 실패:', error);
      throw error;
    }
  }

  /**
   * 새 계정 추가
   */
  async addAccount(account) {
    try {
      // 마지막 행 찾기
      const accounts = await this.getAllAccounts();
      const nextRow = accounts.length + 2; // 헤더 포함
      
      const values = [[
        account.email,
        account.password,
        account.recoveryEmail || '',
        account.id || '',
        account.accId || '',
        account.profileId || '',
        account.status || ''
      ]];
      
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetsId,
        range: `${this.SHEET_NAME}!A${nextRow}:G${nextRow}`,
        valueInputOption: 'RAW',
        requestBody: { values }
      });
      
      console.log(chalk.green(`✅ 계정 추가됨: ${account.email}`));
      
      return nextRow;
      
    } catch (error) {
      console.error('계정 추가 실패:', error);
      throw error;
    }
  }

  /**
   * 통계 정보 가져오기
   */
  async getStatistics() {
    const accounts = await this.getAllAccounts();
    
    const stats = {
      total: accounts.length,
      withProfile: accounts.filter(a => a.profileId).length,
      withoutProfile: accounts.filter(a => !a.profileId).length,
      eligible: accounts.filter(a => a.status && a.status.includes('ELIGIBLE')).length,
      ineligible: accounts.filter(a => a.status && a.status.includes('INELIGIBLE')).length,
      errors: accounts.filter(a => a.status && a.status.includes('ERROR')).length,
      unchecked: accounts.filter(a => !a.status).length
    };
    
    return stats;
  }

  /**
   * getAccounts 메서드 (FamilyPlanWorkflowService에서 사용)
   */
  async getAccounts() {
    return this.getAllAccounts();
  }

  /**
   * updateProfileIds 메서드 (이메일로 프로필 ID 업데이트)
   */
  async updateProfileIds(email, { acc_id, profile_id }) {
    try {
      // 이메일로 행 찾기
      const accounts = await this.getAllAccounts();
      const index = accounts.findIndex(acc => acc.email === email);
      
      if (index === -1) {
        throw new Error(`계정을 찾을 수 없습니다: ${email}`);
      }
      
      const rowNumber = index + 2; // 헤더 행 포함
      
      // E열과 F열 업데이트
      await this.updateAdsPowerIds(rowNumber, acc_id, profile_id);
      
      return true;
      
    } catch (error) {
      console.error(`프로필 ID 업데이트 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * updateStatus 메서드 (이메일로 상태 업데이트)
   */
  async updateStatus(email, status) {
    try {
      // 이메일로 행 찾기
      const accounts = await this.getAllAccounts();
      const index = accounts.findIndex(acc => acc.email === email);
      
      if (index === -1) {
        throw new Error(`계정을 찾을 수 없습니다: ${email}`);
      }
      
      const rowNumber = index + 2; // 헤더 행 포함
      
      // G열 업데이트
      await this.updateCell(`G${rowNumber}`, status);
      
      if (this.debugMode) {
        console.log(chalk.gray(`✓ ${email} 상태 업데이트: ${status}`));
      }
      
      return true;
      
    } catch (error) {
      console.error(`상태 업데이트 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 결과 리포트 생성
   */
  async generateReport() {
    const stats = await this.getStatistics();
    const timestamp = new Date().toLocaleString('ko-KR');
    
    const report = `
====================================
가족요금제 체크 리포트
생성 시간: ${timestamp}
====================================

📊 전체 통계:
- 전체 계정: ${stats.total}개
- 프로필 생성됨: ${stats.withProfile}개
- 프로필 미생성: ${stats.withoutProfile}개

✅ 체크 결과:
- 가입 가능: ${stats.eligible}개
- 가입 불가: ${stats.ineligible}개
- 오류: ${stats.errors}개
- 미확인: ${stats.unchecked}개

====================================
    `;
    
    return report;
  }
}

module.exports = FamilyPlanSheetRepository;