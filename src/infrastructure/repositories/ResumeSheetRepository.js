/**
 * ResumeSheetRepository
 * '결제재개' 탭에서 작업 대상 프로필을 가져오는 레포지토리
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;

class ResumeSheetRepository {
  constructor(config = {}) {
    const baseDir = path.resolve(__dirname, '..', '..', '..');
    
    this.config = {
      spreadsheetId: config.spreadsheetId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath || path.join(baseDir, 'credentials', 'service-account.json'),
      sheetName: '결제재개' // 결제재개 탭 사용
    };
    
    this.sheets = null;
    this.initialized = false;
  }

  /**
   * Google Sheets API 초기화
   */
  async initialize() {
    if (this.initialized) return;

    try {
      const keyFile = await fs.readFile(this.config.serviceAccountPath, 'utf8');
      const key = JSON.parse(keyFile);

      const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Google Sheets: ${error.message}`);
    }
  }

  /**
   * 재개할 프로필 목록 가져오기
   * 결제재개 탭 구조: A열(이메일), B열(비밀번호), C열(복구이메일), D열(TOTP시크릿)
   */
  async getResumeTargets() {
    try {
      await this.initialize();
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:D`
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return []; // 헤더만 있거나 비어있는 경우

      const targets = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 1) continue;
        
        // 이메일이 있는 경우만 추가
        if (row[0]) {
          // 애즈파워현황에서 profileId 찾기
          const profileId = await this.findProfileIdByEmail(row[0]);
          
          targets.push({
            email: row[0],           // A열: 이메일
            password: row[1] || '',   // B열: 비밀번호
            recoveryEmail: row[2] || '', // C열: 복구이메일
            totpSecret: row[3] || '', // D열: TOTP 시크릿
            profileId: profileId,
            status: 'pending_resume'
          });
        }
      }
      
      return targets;
    } catch (error) {
      console.error(`Error getting resume targets: ${error.message}`);
      return [];
    }
  }

  /**
   * 이메일로 프로필 ID 찾기 (애즈파워현황 탭에서)
   */
  async findProfileIdByEmail(email) {
    try {
      // sheets가 초기화되지 않았으면 초기화
      if (!this.sheets) {
        await this.initialize();
      }
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '애즈파워현황!A:D'
      });

      const rows = response.data.values || [];
      
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[3] === email) { // D열이 이메일
          return row[1]; // B열이 profileId
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error finding profile ID for ${email}: ${error.message}`);
      return null;
    }
  }

  /**
   * 재개 상태 업데이트
   */
  async updateResumeStatus(email, status, details = {}) {
    try {
      await this.initialize();
      
      // 현재 데이터 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:E`
      });

      const rows = response.data.values || [];
      
      // 이메일 찾기
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] && rows[i][0] === email) {
          rowIndex = i;
          break;
        }
      }
      
      if (rowIndex === -1) {
        console.error(`Email ${email} not found in resume sheet`);
        return false;
      }
      
      // E열에 상태 업데이트
      const updateRange = `${this.config.sheetName}!E${rowIndex + 1}`;
      const statusText = status === 'resumed' ? 
        `재개 완료 - ${new Date().toLocaleString('ko-KR')}` : 
        `상태: ${status}`;
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: updateRange,
        valueInputOption: 'RAW',
        resource: {
          values: [[statusText]]
        }
      });
      
      return true;
    } catch (error) {
      console.error(`Error updating resume status: ${error.message}`);
      return false;
    }
  }

  /**
   * 재개 결과 업데이트 (EnterpriseCLI에서 사용)
   * @param {number} rowIndex - 업데이트할 행 인덱스 (0부터 시작)
   * @param {string} result - 결과 메시지 (D열)
   * @param {string} status - 상태 (E열) - '결제중', '활성', '일시중지' 등
   * @param {string} nextBillingDate - 다음 결제일 (F열)
   */
  async updateResumeResult(rowIndex, result, status, nextBillingDate = null) {
    try {
      await this.initialize();
      
      // 행 번호는 1부터 시작 (헤더 포함)
      const actualRow = rowIndex + 1;
      
      // 날짜 형식 변환 (ISO -> 한국식)
      let formattedDate = '';
      if (nextBillingDate) {
        try {
          // ISO 형식 날짜를 한국식으로 변환
          // 예: '2025-08-27' -> '2025. 8. 27'
          if (nextBillingDate.includes('-')) {
            const [year, month, day] = nextBillingDate.split('-');
            formattedDate = `${year}. ${parseInt(month)}. ${parseInt(day)}`;
          } else if (nextBillingDate.includes('/')) {
            // 다른 형식 처리 (예: '08/27/2025')
            const parts = nextBillingDate.split('/');
            if (parts.length === 3) {
              const [month, day, year] = parts;
              formattedDate = `${year}. ${parseInt(month)}. ${parseInt(day)}`;
            }
          } else {
            // 이미 한국식 형식인 경우 그대로 사용
            formattedDate = nextBillingDate;
          }
        } catch (err) {
          console.error('날짜 형식 변환 오류:', err);
          formattedDate = nextBillingDate; // 변환 실패시 원본 사용
        }
      }
      
      // 상태 값 보정 (성공시 '결제중'으로 설정)
      let finalStatus = status;
      if (result.includes('✅ 성공') || result.includes('재시도 성공')) {
        finalStatus = '결제중';
      } else if (status === '활성' || status === 'active') {
        finalStatus = '결제중'; // '활성' 대신 '결제중' 사용
      }
      
      // 업데이트할 값 준비
      const updates = [];
      
      // D열: 결과
      updates.push({
        range: `${this.config.sheetName}!D${actualRow}`,
        values: [[result]]
      });
      
      // E열: 상태
      updates.push({
        range: `${this.config.sheetName}!E${actualRow}`,
        values: [[finalStatus]]
      });
      
      // F열: 다음 결제일 (있는 경우에만)
      if (formattedDate) {
        updates.push({
          range: `${this.config.sheetName}!F${actualRow}`,
          values: [[formattedDate]]
        });
      }
      
      // 배치 업데이트 실행
      const batchUpdateRequest = {
        spreadsheetId: this.config.spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      };
      
      await this.sheets.spreadsheets.values.batchUpdate(batchUpdateRequest);
      
      console.log(`✅ 결제재개 시트 업데이트 완료: 행 ${actualRow}, 상태: ${finalStatus}, 날짜: ${formattedDate || '없음'}`);
      return true;
      
    } catch (error) {
      console.error(`❌ 재개 결과 업데이트 실패: ${error.message}`);
      console.error('상세 오류:', error);
      return false;
    }
  }
}

module.exports = ResumeSheetRepository;