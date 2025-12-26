/**
 * Google Sheets 일시중지 탭 관리 Repository
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const ErrorClassifier = require('../../utils/ErrorClassifier');

class PauseSheetRepository {
  constructor() {
    this.auth = null;
    this.sheets = null;
    this.spreadsheetId = null;
    this.pauseSheetName = '일시중지'; // 일시중지 탭 이름
    this.resumeSheetName = '결제재개'; // 결제재개 탭 이름
    this.errorClassifier = new ErrorClassifier(); // 오류 분류기 추가
  }

  /**
   * IP 주소 가져오기 (페이지 객체가 있으면 AdsPower 페이지에서 추출)
   */
  async getIPAddress(page = null) {
    try {
      // 페이지 객체가 제공되면 IPService 사용
      if (page) {
        const IPService = require('../../services/IPService');
        const ipService = new IPService({ debugMode: false });
        const ip = await ipService.getCurrentIP(page);
        if (ip) {
          return ip;
        }
      }
      
      // 페이지 객체가 없거나 실패한 경우 기존 방식 사용
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000
      });
      return response.data.ip;
    } catch (error) {
      console.log('[PauseSheetRepository] IP 주소 확인 실패');
      return 'Unknown';
    }
  }

  /**
   * 날짜 파싱 (다양한 형식 지원)
   */
  parseDate(dateStr) {
    if (!dateStr) return '';
    
    // 이미 올바른 형식인 경우
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    
    const months = {
      'january': '01', 'jan': '01',
      'february': '02', 'feb': '02',
      'march': '03', 'mar': '03',
      'april': '04', 'apr': '04',
      'may': '05',
      'june': '06', 'jun': '06',
      'july': '07', 'jul': '07',
      'august': '08', 'aug': '08',
      'september': '09', 'sep': '09', 'sept': '09',
      'october': '10', 'oct': '10',
      'november': '11', 'nov': '11',
      'december': '12', 'dec': '12'
    };
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    // "Sep 11" 형식
    const match1 = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2})$/i);
    if (match1) {
      const monthName = match1[1].toLowerCase();
      const day = match1[2].padStart(2, '0');
      const month = months[monthName];
      
      if (month) {
        const monthNum = parseInt(month);
        let year = currentYear;
        if (monthNum < currentMonth) {
          year = currentYear + 1;
        }
        console.log(`[PauseSheetRepository] 날짜 파싱: ${dateStr} → ${year}-${month}-${day}`);
        return `${year}-${month}-${day}`;
      }
    }
    
    // 파싱 실패 시 원본 반환
    return dateStr;
  }

  /**
   * 결제재개용 날짜 파싱 (YYYY. M. D 형식으로 반환)
   * 주의: DateParsingService에서 이미 처리된 날짜는 그대로 반환
   */
  parseDateForResume(dateStr) {
    if (!dateStr) return '';

    // 이미 "YYYY. M. D" 형식인 경우 그대로 반환
    // DateParsingService에서 이미 올바른 년도로 파싱된 것임
    if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}$/.test(dateStr)) {
      console.log(`[PauseSheetRepository] 이미 파싱된 날짜 유지: ${dateStr}`);
      return dateStr;
    }

    // "YYYY-MM-DD" 형식을 "YYYY. M. D" 형식으로 변환만 수행
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-');
      const formatted = `${year}. ${parseInt(month)}. ${parseInt(day)}`;
      console.log(`[PauseSheetRepository] 날짜 형식 변환: ${dateStr} → ${formatted}`);
      return formatted;
    }

    // "YYYY/MM/DD" 형식을 "YYYY. M. D" 형식으로 변환
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('/');
      const formatted = `${year}. ${parseInt(month)}. ${parseInt(day)}`;
      console.log(`[PauseSheetRepository] 날짜 형식 변환: ${dateStr} → ${formatted}`);
      return formatted;
    }

    // 년도가 없는 날짜는 DateParsingService에서 처리되어야 함
    // 여기서는 형식 변환만 수행하고, 년도 추가는 하지 않음
    console.log(`[PauseSheetRepository] ⚠️ 예상치 못한 날짜 형식: ${dateStr}`);
    console.log(`[PauseSheetRepository] DateParsingService를 통해 먼저 처리되어야 합니다.`);

    // 파싱 실패 시 원본 반환
    return dateStr;
  }

  /**
   * 프로필의 현재 행 찾기 (이메일 또는 프로필 ID로 검색)
   */
  async findProfileRow(identifier) {
    try {
      // 일시중지 탭의 모든 데이터 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.pauseSheetName}!A:Z`
      });

      const rows = response.data.values || [];
      
      // 헤더 행 찾기 (첫 번째 행이 헤더)
      if (rows.length === 0) return null;
      
      const headers = rows[0];
      
      // 이메일 컬럼과 프로필 ID 컬럼 인덱스 찾기
      const emailColIndex = headers.findIndex(h => 
        h && (h.includes('이메일') || h.includes('Email') || h.includes('ID') || h === 'id')
      );
      const profileColIndex = headers.findIndex(h => 
        h && (h.includes('프로필') || h.includes('Profile') || h.includes('AdsPower'))
      );
      
      // identifier가 이메일인지 프로필 ID인지 판별
      const isEmail = identifier.includes('@');
      
      // 행 찾기
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (isEmail) {
          // 이메일로 검색
          if (emailColIndex !== -1 && row[emailColIndex] === identifier) {
            return {
              rowIndex: i + 1, // 1-based index for Sheets API
              rowData: row,
              headers: headers
            };
          }
        } else {
          // 프로필 ID로 검색
          if (profileColIndex !== -1 && row[profileColIndex] === identifier) {
            return {
              rowIndex: i + 1,
              rowData: row,
              headers: headers
            };
          }
        }
        
        // 모든 컬럼에서 검색 (fallback)
        for (let j = 0; j < row.length; j++) {
          if (row[j] === identifier) {
            return {
              rowIndex: i + 1,
              rowData: row,
              headers: headers
            };
          }
        }
      }
      
      console.log(`[PauseSheetRepository] ⚠️ ${identifier}를 시트에서 찾을 수 없습니다.`);
      console.log(`[PauseSheetRepository] 검색 시도: ${isEmail ? '이메일' : '프로필ID'} 컬럼`);
      console.log(`[PauseSheetRepository] 이메일 컬럼 인덱스: ${emailColIndex}, 프로필 컬럼 인덱스: ${profileColIndex}`);
      if (rows.length > 1) {
        console.log(`[PauseSheetRepository] 시트의 첫 5개 행 (디버깅용):`);
        for (let i = 1; i < Math.min(6, rows.length); i++) {
          console.log(`  행 ${i}: 이메일=${rows[i][emailColIndex] || 'N/A'}, 프로필=${rows[i][profileColIndex] || 'N/A'}`);
        }
      }
      return null;
    } catch (error) {
      console.error('프로필 행 검색 실패:', error.message);
      return null;
    }
  }

  /**
   * Google Sheets 인증 초기화
   */
  async initialize() {
    try {
      // 서비스 계정 키 파일 경로 - 여러 위치 시도 (__dirname 기반)
      const baseDir = path.resolve(__dirname, '..', '..', '..');
      const possiblePaths = [
        path.join(__dirname, '../../config/youtube-automation-439913-b1c8dfe38d92.json'),
        path.join(baseDir, 'credentials', 'service-account.json'),
        path.join(baseDir, 'service_account.json'),
        path.join(baseDir, '..', 'service_account.json'),
        path.join(baseDir, '..', '..', 'service_account.json')
      ];
      
      let keyFile = null;
      let keyPath = null;
      
      for (const testPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(testPath, 'utf8');
          keyPath = testPath;
          console.log(`✅ 서비스 계정 키 파일 로드: ${keyPath}`);
          break;
        } catch (e) {
          // 다음 경로 시도
        }
      }
      
      if (!keyFile) {
        throw new Error('서비스 계정 키 파일을 찾을 수 없습니다');
      }
      
      const key = JSON.parse(keyFile);

      // JWT 클라이언트 생성
      this.auth = new google.auth.JWT(
        key.client_email,
        null,
        key.private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
      );

      // 인증
      await this.auth.authorize();
      
      // Sheets API 클라이언트 생성
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });

      // 스프레드시트 ID 설정 (환경변수에서 읽기 - 필수)
      this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;

      if (!this.spreadsheetId) {
        throw new Error(
          '❌ Google Sheets ID가 설정되지 않았습니다!\n' +
          '.env 파일에 GOOGLE_SHEETS_ID를 설정해주세요.'
        );
      }

      console.log('✅ Google Sheets 연결 성공');
      return true;
    } catch (error) {
      console.error('❌ Google Sheets 연결 실패:', error.message);
      return false;
    }
  }


  /**
   * 일시중지 정보 업데이트 (이메일 또는 프로필 ID로)
   */
  async updatePauseStatus(identifier, pauseData, page = null) {
    try {
      // 이메일 또는 프로필 ID로 행 찾기
      const profileRow = await this.findProfileRow(identifier);
      
      if (!profileRow) {
        console.log(`[PauseSheetRepository] 프로필 ${identifier}를 시트에서 찾을 수 없습니다.`);
        console.log(`[PauseSheetRepository] 검색 타입: ${identifier.includes('@') ? '이메일' : '프로필ID'}`);
        return false;
      }

      const { rowIndex, headers } = profileRow;
      
      // 컬럼 인덱스 찾기
      const findColumnIndex = (columnNames) => {
        for (const name of columnNames) {
          const index = headers.findIndex(h => h && h.includes(name));
          if (index !== -1) return index;
        }
        return -1;
      };

      // 각 필드의 컬럼 인덱스 찾기
      const statusCol = findColumnIndex(['상태', 'Status', '상태(Status)']);
      const nextBillingCol = findColumnIndex(['다음 결제일', 'Next Billing', '다음결제일']);
      const resultCol = findColumnIndex(['결과', 'Result', '처리결과']);
      const lastUpdateCol = findColumnIndex(['최종 업데이트', 'Last Update', '업데이트일시']);
      const noteCol = findColumnIndex(['비고', 'Note', '메모']);
      const ipCol = findColumnIndex(['IP', 'IP주소', 'IP Address']);

      // IP 주소 자동 가져오기 (pauseData에 없으면)
      if (!pauseData.ipAddress && ipCol !== -1) {
        pauseData.ipAddress = await this.getIPAddress(page);
      }

      // 업데이트할 데이터 준비
      const updateData = [];
      
      if (statusCol !== -1) {
        updateData.push({
          range: `${this.pauseSheetName}!${this.columnToLetter(statusCol)}${rowIndex}`,
          values: [[pauseData.status || '일시중지']]
        });
      }

      if (nextBillingCol !== -1 && pauseData.nextBillingDate) {
        // 날짜 파싱
        const parsedDate = this.parseDate(pauseData.nextBillingDate);
        updateData.push({
          range: `${this.pauseSheetName}!${this.columnToLetter(nextBillingCol)}${rowIndex}`,
          values: [[parsedDate]]
        });
      }

      if (resultCol !== -1) {
        // 실패 시 상세 정보 기록
        let resultMessage = pauseData.result || '성공';
        
        if (pauseData.error) {
          // 오류 분류 및 상세 정보 생성
          const classifiedError = this.errorClassifier.classify(pauseData.error);
          resultMessage = this.errorClassifier.getSimpleMessage(classifiedError);
        }
        
        updateData.push({
          range: `${this.pauseSheetName}!${this.columnToLetter(resultCol)}${rowIndex}`,
          values: [[resultMessage]]
        });
      }

      if (lastUpdateCol !== -1) {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        updateData.push({
          range: `${this.pauseSheetName}!${this.columnToLetter(lastUpdateCol)}${rowIndex}`,
          values: [[timestamp]]
        });
      }

      if (noteCol !== -1) {
        let noteMessage = '';
        
        // 실패 시 상세 오류 정보를 비고란에 추가
        if (pauseData.error) {
          const classifiedError = this.errorClassifier.classify(pauseData.error);
          noteMessage = this.errorClassifier.formatForSheets(classifiedError);
        } else if (pauseData.note) {
          // 성공 케이스에서도 상세 정보 기록
          noteMessage = pauseData.note;
        } else {
          // note가 없으면 기본 메시지
          noteMessage = `작업 완료: ${new Date().toLocaleString('ko-KR')}`;
        }
        
        if (noteMessage) {
          updateData.push({
            range: `${this.pauseSheetName}!${this.columnToLetter(noteCol)}${rowIndex}`,
            values: [[noteMessage]]
          });
        }
      }
      
      if (ipCol !== -1 && pauseData.ipAddress) {
        updateData.push({
          range: `${this.pauseSheetName}!${this.columnToLetter(ipCol)}${rowIndex}`,
          values: [[pauseData.ipAddress]]
        });
      }

      // 배치 업데이트 실행
      if (updateData.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: updateData
          }
        });

        const parsedDate = pauseData.nextBillingDate ? this.parseDate(pauseData.nextBillingDate) : null;
        console.log(`[PauseSheetRepository] ✅ ${identifier.includes('@') ? '이메일' : '프로필'} ${identifier} 시트 업데이트 완료`);
        console.log(`[PauseSheetRepository] 업데이트 항목: 상태=${pauseData.status || '일시중지'}, 날짜=${parsedDate || '-'}, IP=${pauseData.ipAddress || '-'}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('시트 업데이트 실패:', error.message);
      return false;
    }
  }

  /**
   * 결제재개 상태 업데이트 (개선된 시트 선택 로직)
   * @param {string} identifier - 프로필 식별자 (이메일 또는 프로필 ID)
   * @param {object} resumeData - 업데이트할 재개 데이터
   * @returns {boolean} - 성공 여부
   */
  async updateResumeStatus(identifier, resumeData) {
    try {
      console.log(`\n[PauseSheetRepository] ====== 결제재개 시트 업데이트 시작 ======`);
      console.log(`[PauseSheetRepository] 검색 식별자: ${identifier}`);
      console.log(`[PauseSheetRepository] 검색 타입: ${identifier.includes('@') ? '이메일' : '프로필ID'}`);

      // ★★★ 결제재개 시트에서 먼저 검색 (우선순위 1) ★★★
      let profileRow = await this.findProfileRowInSheet(identifier, this.resumeSheetName);
      let useResumeSheet = true;

      if (!profileRow) {
        console.log(`[PauseSheetRepository] ⚠️ 결제재개(${this.resumeSheetName}) 시트에서 찾지 못함`);
        console.log(`[PauseSheetRepository] ⚠️ 일시중지(${this.pauseSheetName}) 시트에서 검색 시도 (fallback)...`);
        console.log(`[PauseSheetRepository] 💡 TIP: 결제재개 시트의 아이디/이메일 컬럼에 "${identifier}"가 있는지 확인하세요.`);

        // ★★★ 중요: 이 fallback은 데이터 일관성 문제를 일으킬 수 있음! ★★★
        // 결제재개 결과가 일시중지 탭에 기록되는 것을 방지하기 위해 경고 출력
        profileRow = await this.findProfileRowInSheet(identifier, this.pauseSheetName);
        useResumeSheet = false;

        if (!profileRow) {
          console.log(`[PauseSheetRepository] ❌ 프로필 "${identifier}"를 모든 시트에서 찾을 수 없습니다.`);
          console.log(`[PauseSheetRepository] 검색한 시트: ${this.resumeSheetName}, ${this.pauseSheetName}`);
          return false;
        } else {
          // ★★★ 경고: fallback 동작 발생! ★★★
          console.log(`\n[PauseSheetRepository] ⚠️⚠️⚠️ WARNING: FALLBACK 동작 발생! ⚠️⚠️⚠️`);
          console.log(`[PauseSheetRepository] ⚠️ 결제재개 결과가 "${this.pauseSheetName}" 탭에 기록됩니다!`);
          console.log(`[PauseSheetRepository] ⚠️ 원인: "${identifier}"가 결제재개 탭에 없음`);
          console.log(`[PauseSheetRepository] ⚠️ 해결: 결제재개 탭의 첫 번째 열(아이디)에 해당 이메일이 있는지 확인\n`);
        }
      } else {
        console.log(`[PauseSheetRepository] ✅ 결제재개(${this.resumeSheetName}) 시트 행 ${profileRow.rowIndex}에서 발견`);
      }

      const { rowIndex, headers } = profileRow;
      
      // 컬럼 인덱스 찾기
      const findColumnIndex = (columnNames) => {
        for (const name of columnNames) {
          const index = headers.findIndex(h => h && h.includes(name));
          if (index !== -1) return index;
        }
        return -1;
      };

      // 각 필드의 컬럼 인덱스 찾기 (결제재개 탭: 아이디, 비밀번호, 복구이메일, 코드, 상태, 다음결제일, IP, 결과)
      const statusCol = findColumnIndex(['상태', 'Status']);
      const nextBillingCol = findColumnIndex(['다음결제일', 'Next Billing', '다음 결제일']);
      const resultCol = findColumnIndex(['결과', 'Result']);
      const ipCol = findColumnIndex(['IP', 'IP주소', 'IP Address']);

      // IP 주소 자동 가져오기 (resumeData에 없으면)
      if (!resumeData.ipAddress && ipCol !== -1) {
        resumeData.ipAddress = await this.getIPAddress();
      }

      // 업데이트할 데이터 준비
      const updateData = [];
      const targetSheetName = useResumeSheet ? this.resumeSheetName : this.pauseSheetName;
      
      // 상태 업데이트 (resumeData.status가 명시적으로 제공된 경우에만)
      console.log(`[PauseSheetRepository] 상태 업데이트 확인: statusCol=${statusCol}, resumeData.status=${resumeData.status}, undefined 체크=${resumeData.status !== undefined}`);
      if (statusCol !== -1 && resumeData.status !== undefined) {
        console.log(`[PauseSheetRepository] ✅ 상태 업데이트 예정: "${resumeData.status}" → ${targetSheetName}!${this.columnToLetter(statusCol)}${rowIndex}`);
        updateData.push({
          range: `${targetSheetName}!${this.columnToLetter(statusCol)}${rowIndex}`,
          values: [[resumeData.status]]
        });
      } else {
        console.log(`[PauseSheetRepository] ⚠️ 상태 업데이트 건너뜀: statusCol=${statusCol}, status=${resumeData.status}`);
      }

      if (nextBillingCol !== -1 && resumeData.nextBillingDate) {
        // 결제재개용 날짜 파싱 (YYYY. M. D 형식)
        const parsedDate = this.parseDateForResume(resumeData.nextBillingDate);
        updateData.push({
          range: `${targetSheetName}!${this.columnToLetter(nextBillingCol)}${rowIndex}`,
          values: [[parsedDate]]
        });
      }

      if (resultCol !== -1) {
        let resultMessage = '';
        
        // note 필드에 이미 포맷된 상세 메시지가 있으면 그대로 사용
        if (resumeData.note && (resumeData.note.includes('┃') || resumeData.note.includes('|'))) {
          // 이미 포맷팅된 메시지 (언어, 날짜 정보 포함)
          resultMessage = resumeData.note;
        } else if (resumeData.result) {
          // result 필드가 명시적으로 제공된 경우
          const timestamp = new Date().toLocaleString('ko-KR');
          
          // result에 이미 언어 정보가 포함되어 있으면 그대로 사용
          if (resumeData.result.includes('(') && resumeData.result.includes(')')) {
            resultMessage = `${resumeData.result} (${timestamp})`;
          } else {
            // 언어 정보가 없으면 기본 포맷 사용
            const lang = resumeData.language || 'Unknown';
            const nextBilling = resumeData.nextBillingDate || 'N/A';
            
            // 성공 메시지 판별
            if (resumeData.result.includes('재개') || resumeData.result.includes('성공')) {
              resultMessage = `🆕 재개 성공 (${lang}) (${nextBilling}) (${timestamp})`;
            } else {
              resultMessage = `${resumeData.result} (${timestamp})`;
            }
          }
        } else if (resumeData.error) {
          // error가 있는 경우
          const timestamp = new Date().toLocaleString('ko-KR');
          const classifiedError = this.errorClassifier.classify(resumeData.error);
          const errorMessage = this.errorClassifier.getSimpleMessage(classifiedError);
          resultMessage = `❌ ${errorMessage} (${timestamp})`;
        } else {
          // 기본값 - 개선된 포맷 사용
          const timestamp = new Date().toLocaleString('ko-KR');
          const lang = resumeData.language || 'Unknown';
          const nextBilling = resumeData.nextBillingDate || 'N/A';
          resultMessage = `🆕 재개 성공 (${lang}) (${nextBilling}) (${timestamp})`;
        }
        
        updateData.push({
          range: `${targetSheetName}!${this.columnToLetter(resultCol)}${rowIndex}`,
          values: [[resultMessage]]
        });
      }
      
      // 비고란 추가 (오류 상세 정보)
      const noteCol = findColumnIndex(['비고', 'Note', '메모']);
      if (noteCol !== -1) {
        let noteMessage = '';
        
        // 실패 시 상세 오류 정보를 비고란에 추가
        if (resumeData.error) {
          const classifiedError = this.errorClassifier.classify(resumeData.error);
          noteMessage = this.errorClassifier.formatForSheets(classifiedError);
        } else if (resumeData.note) {
          // 성공 케이스에서도 상세 정보 기록
          noteMessage = resumeData.note;
        } else {
          // note가 없으면 기본 메시지
          noteMessage = `재개 작업 완료: ${new Date().toLocaleString('ko-KR')}`;
        }
        
        if (noteMessage) {
          updateData.push({
            range: `${targetSheetName}!${this.columnToLetter(noteCol)}${rowIndex}`,
            values: [[noteMessage]]
          });
        }
      }
      
      if (ipCol !== -1 && resumeData.ipAddress) {
        updateData.push({
          range: `${targetSheetName}!${this.columnToLetter(ipCol)}${rowIndex}`,
          values: [[resumeData.ipAddress]]
        });
      }

      // 배치 업데이트 실행
      if (updateData.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: updateData
          }
        });

        const parsedDate = resumeData.nextBillingDate ? this.parseDateForResume(resumeData.nextBillingDate) : null;
        console.log(`[PauseSheetRepository] ✅ ${identifier.includes('@') ? '이메일' : '프로필'} ${identifier} ${targetSheetName} 시트 업데이트 완료`);
        
        // 업데이트된 항목들 로그
        const updatedItems = [];
        if (resumeData.status !== undefined) updatedItems.push(`상태=${resumeData.status}`);
        if (parsedDate) updatedItems.push(`날짜=${parsedDate}`);
        if (resumeData.ipAddress) updatedItems.push(`IP=${resumeData.ipAddress}`);
        if (resumeData.result) updatedItems.push(`결과=${resumeData.result}`);
        
        console.log(`[PauseSheetRepository] 업데이트 항목: ${updatedItems.join(', ')}`);

        // ★★★ 시트 선택 결과 명확히 표시 ★★★
        if (useResumeSheet) {
          console.log(`[PauseSheetRepository] ✅ 정상: ${targetSheetName} 탭에 기록됨 (올바른 시트)`);
        } else {
          console.log(`\n[PauseSheetRepository] ⚠️⚠️⚠️ FALLBACK: ${targetSheetName} 탭에 기록됨! ⚠️⚠️⚠️`);
          console.log(`[PauseSheetRepository] ⚠️ 결제재개 결과가 일시중지 탭에 기록되었습니다.`);
          console.log(`[PauseSheetRepository] ⚠️ 이 문제를 해결하려면 결제재개 탭에 해당 계정 정보를 추가하세요.\n`);
        }

        console.log(`[PauseSheetRepository] ====== 결제재개 시트 업데이트 완료 ======\n`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('결제재개 시트 업데이트 실패:', error.message);
      return false;
    }
  }

  /**
   * 프로필의 결과 필드만 업데이트 (H열)
   * @param {string} identifier - 프로필 식별자 (이메일 또는 프로필 ID)
   * @param {string} result - 결과 텍스트 (예: 'reCAPTCHA 발생')
   * @param {object} metadata - 추가 메타데이터 (선택사항)
   * @returns {boolean} - 업데이트 성공 여부
   */
  async updateProfileResult(identifier, result, metadata = {}) {
    try {
      // 결제재개 시트에서 먼저 찾기
      let profileRow = await this.findProfileRowInSheet(identifier, this.resumeSheetName);
      let targetSheetName = this.resumeSheetName;
      
      if (!profileRow) {
        // 일시중지 시트에서 찾기
        profileRow = await this.findProfileRowInSheet(identifier, this.pauseSheetName);
        targetSheetName = this.pauseSheetName;
      }
      
      if (!profileRow) {
        console.log(`[PauseSheetRepository] 프로필 ${identifier}를 찾을 수 없습니다.`);
        return false;
      }

      const { rowIndex, headers } = profileRow;
      
      // 결과 필드 컬럼 찾기 (H열 또는 '결과' 헤더)
      const resultColIndex = headers.findIndex(h => 
        h && (h.includes('결과') || h.includes('Result'))
      );
      
      if (resultColIndex === -1) {
        // 헤더에 '결과'가 없으면 H열(7번 인덱스) 사용
        const defaultResultCol = 7; // H열 = 8번째 컬럼 (인덱스 7)
        
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${targetSheetName}!${this.columnToLetter(defaultResultCol)}${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[result]]
          }
        });
        
        console.log(`[PauseSheetRepository] ✅ ${identifier} 결과 업데이트 완료: "${result}" (H열)`);
      } else {
        // 헤더에서 찾은 컬럼 사용
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${targetSheetName}!${this.columnToLetter(resultColIndex)}${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: {
            values: [[result]]
          }
        });
        
        console.log(`[PauseSheetRepository] ✅ ${identifier} 결과 업데이트 완료: "${result}" (${this.columnToLetter(resultColIndex)}열)`);
      }
      
      // 메타데이터 로깅
      if (metadata && Object.keys(metadata).length > 0) {
        console.log(`[PauseSheetRepository] 메타데이터:`, metadata);
      }
      
      return true;
    } catch (error) {
      console.error('프로필 결과 업데이트 실패:', error.message);
      return false;
    }
  }

  /**
   * 특정 시트에서 프로필 행 찾기 (개선된 검색 로직)
   * @param {string} identifier - 프로필 식별자 (이메일 또는 프로필 ID)
   * @param {string} sheetName - 시트 이름
   * @returns {object|null} - 찾은 행 정보
   */
  async findProfileRowInSheet(identifier, sheetName) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      const rows = response.data.values;
      if (!rows || rows.length < 2) {
        console.log(`[PauseSheetRepository] ${sheetName} 시트가 비어있거나 헤더만 있음`);
        return null;
      }

      const headers = rows[0];
      const isEmailSearch = identifier.includes('@');

      // 검색할 컬럼 인덱스들을 찾기 (우선순위대로)
      const searchColumnIndices = [];

      // 1. 아이디/이메일 관련 컬럼 찾기
      headers.forEach((h, idx) => {
        if (h) {
          const headerLower = h.toLowerCase();
          if (headerLower.includes('아이디') ||
              headerLower.includes('이메일') ||
              headerLower.includes('email') ||
              headerLower.includes('id')) {
            searchColumnIndices.push(idx);
          }
        }
      });

      // 검색할 컬럼이 없으면 첫 번째 컬럼 추가
      if (searchColumnIndices.length === 0) {
        searchColumnIndices.push(0);
      }

      console.log(`[PauseSheetRepository] ${sheetName} 시트에서 "${identifier}" 검색 중... (검색 컬럼: ${searchColumnIndices.map(i => headers[i] || `컬럼${i}`).join(', ')})`);

      // 모든 데이터 행에서 검색
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        // 각 검색 컬럼에서 확인
        for (const colIdx of searchColumnIndices) {
          if (row[colIdx]) {
            const cellValue = row[colIdx].toString().trim();

            // ★★★ 정확한 일치 검색 (대소문자 무시) ★★★
            if (cellValue.toLowerCase() === identifier.toLowerCase()) {
              console.log(`[PauseSheetRepository] ✅ ${sheetName} 시트 행 ${i + 1}에서 "${identifier}" 발견 (컬럼: ${headers[colIdx] || colIdx})`);
              return {
                rowIndex: i + 1,  // 1-based index for Sheets API
                rowData: row,
                headers: headers
              };
            }
          }
        }

        // ★★★ 추가 검색: 모든 컬럼에서 정확히 일치하는 값 찾기 ★★★
        // (이메일이 예상치 못한 컬럼에 있을 수 있음)
        for (let j = 0; j < row.length; j++) {
          if (row[j] && !searchColumnIndices.includes(j)) {
            const cellValue = row[j].toString().trim();
            if (cellValue.toLowerCase() === identifier.toLowerCase()) {
              console.log(`[PauseSheetRepository] ✅ ${sheetName} 시트 행 ${i + 1}에서 "${identifier}" 발견 (예상외 컬럼: ${headers[j] || j})`);
              return {
                rowIndex: i + 1,
                rowData: row,
                headers: headers
              };
            }
          }
        }
      }

      console.log(`[PauseSheetRepository] ⚠️ ${sheetName} 시트에서 "${identifier}"를 찾을 수 없음`);
      return null;
    } catch (error) {
      console.error(`[PauseSheetRepository] ${sheetName} 시트에서 프로필 검색 실패:`, error.message);
      return null;
    }
  }

  /**
   * 숫자를 알파벳 컬럼으로 변환 (0 -> A, 1 -> B, ...)
   */
  columnToLetter(column) {
    let temp;
    let letter = '';
    while (column >= 0) {
      temp = column % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = Math.floor(column / 26) - 1;
    }
    return letter;
  }

  /**
   * 결제재개 대상 프로필 목록 가져오기
   */
  async getResumeTargets() {
    await this.initialize();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.resumeSheetName}!A:H`
      });
      
      const rows = response.data.values || [];
      if (rows.length < 2) return [];
      
      const headers = rows[0];
      const dataRows = rows.slice(1);
      
      return dataRows.map(row => ({
        email: row[0] || '',           // A열: 이메일
        googleId: row[0] || '',         // A열: 이메일 (같은 값)
        password: row[1] || '',         // B열: 비밀번호
        recoveryEmail: row[2] || '',    // C열: 복구 이메일
        totpSecret: row[3] || '',       // D열: TOTP Secret
        code: row[3] || '',             // D열: TOTP Secret (같은 값)
        pauseDate: row[4] || '',        // E열: 일시중지일
        nextBillingDate: row[5] || '',  // F열: 다음 결제일
        result: row[6] || '',           // G열: 결과
        profileId: ''                   // profileId는 나중에 매핑
      }));
    } catch (error) {
      console.error('[PauseSheetRepository] 결제재개 대상 가져오기 실패:', error.message);
      return [];
    }
  }
  
  /**
   * 일시중지 대상 프로필 목록 가져오기
   */
  async getPauseTargets() {
    await this.initialize();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.pauseSheetName}!A:F`
      });
      
      const rows = response.data.values || [];
      if (rows.length < 2) return [];
      
      const headers = rows[0];
      const dataRows = rows.slice(1);
      
      return dataRows.map(row => ({
        email: row[0] || '',           // A열: 이메일
        googleId: row[0] || '',         // A열: 이메일 (같은 값)
        password: row[1] || '',         // B열: 비밀번호
        recoveryEmail: row[2] || '',    // C열: 복구 이메일
        totpSecret: row[3] || '',       // D열: TOTP Secret
        code: row[3] || '',             // D열: TOTP Secret (같은 값)
        pauseDate: row[4] || '',        // E열: 일시중지일
        nextBillingDate: row[5] || '',  // F열: 다음 결제일
        profileId: ''                   // profileId는 나중에 매핑
      }));
    } catch (error) {
      console.error('[PauseSheetRepository] 일시중지 대상 가져오기 실패:', error.message);
      return [];
    }
  }

  /**
   * 프로필 정보 가져오기
   */
  async getProfileInfo(profileId) {
    try {
      const profileRow = await this.findProfileRow(profileId);
      
      if (!profileRow) {
        return null;
      }

      const { rowData, headers } = profileRow;
      
      // 헤더를 기반으로 객체 생성
      const profileInfo = {};
      headers.forEach((header, index) => {
        if (header && rowData[index]) {
          profileInfo[header] = rowData[index];
        }
      });

      return profileInfo;
    } catch (error) {
      console.error('프로필 정보 조회 실패:', error.message);
      return null;
    }
  }

  /**
   * 여러 프로필 일괄 업데이트
   */
  async batchUpdateProfiles(updates) {
    try {
      const updateData = [];

      for (const update of updates) {
        const profileRow = await this.findProfileRow(update.profileId);
        if (!profileRow) continue;

        const { rowIndex, headers } = profileRow;
        
        // 상태 컬럼 업데이트
        const statusCol = headers.findIndex(h => h && h.includes('상태'));
        if (statusCol !== -1) {
          updateData.push({
            range: `${this.pauseSheetName}!${this.columnToLetter(statusCol)}${rowIndex}`,
            values: [[update.status || '일시중지']]
          });
        }

        // 다음 결제일 업데이트
        if (update.nextBillingDate) {
          const billingCol = headers.findIndex(h => h && h.includes('다음 결제일'));
          if (billingCol !== -1) {
            updateData.push({
              range: `${this.pauseSheetName}!${this.columnToLetter(billingCol)}${rowIndex}`,
              values: [[update.nextBillingDate]]
            });
          }
        }
      }

      if (updateData.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: updateData
          }
        });

        console.log(`✅ ${updates.length}개 프로필 일괄 업데이트 완료`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('일괄 업데이트 실패:', error.message);
      return false;
    }
  }

  // ============================================================
  // 시간체크 통합 워커용 메서드들 (I열 시간, J열 잠금)
  // ============================================================

  /**
   * I열(시간), J열(잠금) 포함 작업 목록 가져오기
   * 범위: A:J
   *
   * @param {string} sheetName - "일시중지" 또는 "결제재개"
   * @returns {Promise<Array>} 작업 목록
   */
  async getTasksWithTimeAndLock(sheetName) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:J`
      });

      const rows = response.data.values || [];
      if (rows.length < 2) return [];

      const headers = rows[0];
      const dataRows = rows.slice(1);

      return dataRows.map((row, index) => ({
        rowIndex: index + 2,            // 1-based, 헤더 제외
        googleId: row[0] || '',          // A열: 아이디(이메일)
        email: row[0] || '',             // A열 동일
        password: row[1] || '',          // B열: 비밀번호
        recoveryEmail: row[2] || '',     // C열: 복구이메일
        code: row[3] || '',              // D열: 코드(TOTP)
        status: row[4] || '',            // E열: 상태
        nextPaymentDate: row[5] || '',   // F열: 다음결제일 (YYYY. M. D)
        ip: row[6] || '',                // G열: IP
        result: row[7] || '',            // H열: 결과
        scheduledTimeStr: row[8] || '',  // I열: 시간 (HH:mm)
        lockValue: row[9] || ''          // J열: 잠금
      }));
    } catch (error) {
      console.error(`[PauseSheetRepository] ${sheetName} 작업 목록 조회 실패:`, error.message);
      return [];
    }
  }

  /**
   * J열(잠금) 값만 읽기
   *
   * @param {string} sheetName - "일시중지" 또는 "결제재개"
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<string>}
   */
  async getLockValue(sheetName, rowIndex) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!J${rowIndex}`
      });

      const values = response.data.values;
      return values && values[0] && values[0][0] ? values[0][0] : '';
    } catch (error) {
      console.error(`[PauseSheetRepository] J열 조회 실패:`, error.message);
      return '';
    }
  }

  /**
   * J열(잠금) 값 업데이트
   *
   * @param {string} sheetName
   * @param {number} rowIndex
   * @param {string} value - 잠금 값 또는 빈 문자열
   * @returns {Promise<boolean>}
   */
  async setLockValue(sheetName, rowIndex, value) {
    await this.initialize();

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!J${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] J열 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * H열(결과) 값 읽기
   *
   * @param {string} sheetName
   * @param {number} rowIndex
   * @returns {Promise<string>}
   */
  async getResultValue(sheetName, rowIndex) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!H${rowIndex}`
      });

      const values = response.data.values;
      return values && values[0] && values[0][0] ? values[0][0] : '';
    } catch (error) {
      console.error(`[PauseSheetRepository] H열 조회 실패:`, error.message);
      return '';
    }
  }

  /**
   * H열(결과)에 결과 누적 기록
   * 기존 값이 있으면 줄바꿈으로 추가
   *
   * @param {string} sheetName
   * @param {number} rowIndex
   * @param {string} newResult - 새 결과 문자열
   * @returns {Promise<boolean>}
   */
  async appendResultToCell(sheetName, rowIndex, newResult) {
    await this.initialize();

    try {
      // 기존 H열 값 읽기
      const existingResult = await this.getResultValue(sheetName, rowIndex);

      // 누적 결과 생성
      let finalResult;
      if (existingResult && existingResult.trim()) {
        finalResult = `${existingResult}\n${newResult}`;
      } else {
        finalResult = newResult;
      }

      // H열 업데이트
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!H${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[finalResult]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] H열 누적 업데이트 실패:`, error.message);
      return false;
    }
  }

  // ============================================================
  // 통합워커 탭 전용 메서드들 (v2.0 - 상태 기반 결제 주기 관리)
  // ============================================================
  // 시트 구조:
  //   A: 아이디(이메일), B: 비밀번호, C: 복구이메일, D: 코드(TOTP)
  //   E: 상태, F: 다음결제일, G: IP, H: 결과
  //   I: 시간, J: 잠금, K: 결제카드, L: 재시도
  // ============================================================

  /**
   * 통합워커 탭 이름 (상수)
   */
  get integratedWorkerSheetName() {
    return '통합워커';
  }

  /**
   * 통합워커 탭에서 전체 작업 목록 가져오기 (A:L 범위)
   * 상태(E열), 시간(I열), 잠금(J열), 재시도(L열) 포함
   *
   * @returns {Promise<Array>} 작업 목록
   */
  async getIntegratedWorkerTasks() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!A:L`
      });

      const rows = response.data.values || [];
      if (rows.length < 2) return [];

      const headers = rows[0];
      const dataRows = rows.slice(1);

      return dataRows.map((row, index) => ({
        rowIndex: index + 2,            // 1-based, 헤더 제외
        googleId: row[0] || '',          // A열: 아이디(이메일)
        email: row[0] || '',             // A열 동일
        password: row[1] || '',          // B열: 비밀번호
        recoveryEmail: row[2] || '',     // C열: 복구이메일
        totpCode: row[3] || '',          // D열: 코드(TOTP)
        code: row[3] || '',              // D열 동일
        status: row[4] || '',            // E열: 상태 (일시중지/결제중/만료됨)
        nextPaymentDate: row[5] || '',   // F열: 다음결제일 (YYYY. M. D)
        ip: row[6] || '',                // G열: IP
        result: row[7] || '',            // H열: 결과
        scheduledTimeStr: row[8] || '',  // I열: 시간 (HH:mm)
        lockValue: row[9] || '',         // J열: 잠금
        paymentCard: row[10] || '',      // K열: 결제카드
        retryCount: row[11] || ''        // L열: 재시도 횟수
      }));
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 작업 목록 조회 실패:`, error.message);
      return [];
    }
  }

  /**
   * 통합워커 탭의 E열(상태) 업데이트
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {string} newStatus - 새 상태 ("일시중지" 또는 "결제중")
   * @returns {Promise<boolean>}
   */
  async updateIntegratedWorkerStatus(rowIndex, newStatus) {
    await this.initialize();

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!E${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[newStatus]]
        }
      });

      console.log(`[PauseSheetRepository] 통합워커 E열 상태 업데이트: 행${rowIndex} → "${newStatus}"`);
      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 E열 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭의 J열(잠금) 값 읽기
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<string>}
   */
  async getIntegratedWorkerLockValue(rowIndex) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!J${rowIndex}`
      });

      const values = response.data.values;
      return values && values[0] && values[0][0] ? values[0][0] : '';
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 J열 조회 실패:`, error.message);
      return '';
    }
  }

  /**
   * 통합워커 탭의 J열(잠금) 값 업데이트
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {string} value - 잠금 값 또는 빈 문자열
   * @returns {Promise<boolean>}
   */
  async setIntegratedWorkerLockValue(rowIndex, value) {
    await this.initialize();

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!J${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 J열 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭의 L열(재시도) 횟수 읽기
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<number>} 재시도 횟수 (기본값 0)
   */
  async getIntegratedWorkerRetryCount(rowIndex) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!L${rowIndex}`
      });

      const values = response.data.values;
      if (values && values[0] && values[0][0]) {
        const parsed = parseInt(values[0][0], 10);
        return isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 L열 조회 실패:`, error.message);
      return 0;
    }
  }

  /**
   * 통합워커 탭의 L열(재시도) 횟수 설정
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {number|string} value - 재시도 횟수 (빈 문자열로 리셋 가능)
   * @returns {Promise<boolean>}
   */
  async setIntegratedWorkerRetryCount(rowIndex, value) {
    await this.initialize();

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!L${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[value === '' ? '' : String(value)]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 L열 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭의 L열(재시도) 횟수 1 증가
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<number>} 증가 후 재시도 횟수
   */
  async incrementIntegratedWorkerRetryCount(rowIndex) {
    const currentCount = await this.getIntegratedWorkerRetryCount(rowIndex);
    const newCount = currentCount + 1;
    await this.setIntegratedWorkerRetryCount(rowIndex, newCount);
    return newCount;
  }

  /**
   * 통합워커 탭의 L열(재시도) 횟수 리셋 (성공 시 호출)
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<boolean>}
   */
  async resetIntegratedWorkerRetryCount(rowIndex) {
    return await this.setIntegratedWorkerRetryCount(rowIndex, '');
  }

  /**
   * 통합워커 탭의 H열(결과) 값 읽기
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<string>}
   */
  async getIntegratedWorkerResultValue(rowIndex) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!H${rowIndex}`
      });

      const values = response.data.values;
      return values && values[0] && values[0][0] ? values[0][0] : '';
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 H열 조회 실패:`, error.message);
      return '';
    }
  }

  /**
   * 통합워커 탭의 H열(결과)에 결과 누적 기록
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {string} newResult - 새 결과 문자열
   * @returns {Promise<boolean>}
   */
  async appendIntegratedWorkerResult(rowIndex, newResult) {
    await this.initialize();

    try {
      // 기존 H열 값 읽기
      const existingResult = await this.getIntegratedWorkerResultValue(rowIndex);

      // 누적 결과 생성
      let finalResult;
      if (existingResult && existingResult.trim()) {
        finalResult = `${existingResult}\n${newResult}`;
      } else {
        finalResult = newResult;
      }

      // H열 업데이트
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!H${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[finalResult]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 H열 누적 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭의 G열(IP) 업데이트
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {string} ip - IP 주소
   * @returns {Promise<boolean>}
   */
  async updateIntegratedWorkerIP(rowIndex, ip) {
    await this.initialize();

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.integratedWorkerSheetName}!G${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[ip]]
        }
      });

      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 G열 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭 - 작업 성공 시 일괄 업데이트
   * E열(상태), H열(결과), G열(IP), L열(재시도 리셋)
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {object} data - 업데이트 데이터
   * @param {string} data.newStatus - 새 상태
   * @param {string} data.resultText - 결과 텍스트
   * @param {string} [data.ip] - IP 주소 (선택)
   * @returns {Promise<boolean>}
   */
  async updateIntegratedWorkerOnSuccess(rowIndex, { newStatus, resultText, ip, nextBillingDate }) {
    await this.initialize();

    try {
      const updateData = [];

      // E열: 상태 업데이트
      updateData.push({
        range: `${this.integratedWorkerSheetName}!E${rowIndex}`,
        values: [[newStatus]]
      });

      // F열: 다음결제일 (있으면)
      if (nextBillingDate) {
        updateData.push({
          range: `${this.integratedWorkerSheetName}!F${rowIndex}`,
          values: [[nextBillingDate]]
        });
      }

      // H열: 결과 누적
      const existingResult = await this.getIntegratedWorkerResultValue(rowIndex);
      const finalResult = existingResult && existingResult.trim()
        ? `${existingResult}\n${resultText}`
        : resultText;
      updateData.push({
        range: `${this.integratedWorkerSheetName}!H${rowIndex}`,
        values: [[finalResult]]
      });

      // G열: IP (있으면)
      if (ip) {
        updateData.push({
          range: `${this.integratedWorkerSheetName}!G${rowIndex}`,
          values: [[ip]]
        });
      }

      // L열: 재시도 리셋
      updateData.push({
        range: `${this.integratedWorkerSheetName}!L${rowIndex}`,
        values: [['']]
      });

      // J열: 잠금 해제
      updateData.push({
        range: `${this.integratedWorkerSheetName}!J${rowIndex}`,
        values: [['']]
      });

      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',  // 날짜가 Google Sheets 날짜 형식으로 인식됨
          data: updateData
        }
      });

      const dateInfo = nextBillingDate ? `, 다음결제일→"${nextBillingDate}"` : '';
      console.log(`[PauseSheetRepository] 통합워커 행${rowIndex} 성공 업데이트 완료: 상태→"${newStatus}"${dateInfo}`);
      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 성공 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭 - 영구 실패 처리 (재시도 불가 상태)
   * reCAPTCHA, 만료, 계정잠김 등 재시도해도 해결되지 않는 상태
   * E열(상태 변경), H열(결과), J열(잠금 해제) - L열(재시도)는 증가 안함
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {object} data - 업데이트 데이터
   * @param {string} data.newStatus - 새 상태 (만료됨, 계정잠김, reCAPTCHA차단 등)
   * @param {string} data.resultText - 결과 텍스트
   * @returns {Promise<boolean>}
   */
  async updateIntegratedWorkerPermanentFailure(rowIndex, { newStatus, resultText }) {
    await this.initialize();

    try {
      const updateData = [];

      // E열: 영구 상태로 변경
      updateData.push({
        range: `${this.integratedWorkerSheetName}!E${rowIndex}`,
        values: [[newStatus]]
      });

      // H열: 결과 누적
      const existingResult = await this.getIntegratedWorkerResultValue(rowIndex);
      const finalResult = existingResult && existingResult.trim()
        ? `${existingResult}\n${resultText}`
        : resultText;
      updateData.push({
        range: `${this.integratedWorkerSheetName}!H${rowIndex}`,
        values: [[finalResult]]
      });

      // J열: 잠금 해제
      updateData.push({
        range: `${this.integratedWorkerSheetName}!J${rowIndex}`,
        values: [['']]
      });

      // L열: 재시도 횟수 증가 안함 (영구 실패이므로)

      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',  // 날짜가 Google Sheets 날짜 형식으로 인식됨
          data: updateData
        }
      });

      console.log(`[PauseSheetRepository] 통합워커 행${rowIndex} 영구실패 업데이트: 상태→"${newStatus}"`);
      return true;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 영구실패 업데이트 실패:`, error.message);
      return false;
    }
  }

  /**
   * 통합워커 탭 - 작업 실패 시 일괄 업데이트
   * H열(결과), L열(재시도 +1), J열(잠금 해제)
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @param {object} data - 업데이트 데이터
   * @param {string} data.resultText - 결과 텍스트 (에러 메시지)
   * @returns {Promise<number>} 새 재시도 횟수
   */
  async updateIntegratedWorkerOnFailure(rowIndex, { resultText }) {
    await this.initialize();

    try {
      // 현재 재시도 횟수
      const currentRetry = await this.getIntegratedWorkerRetryCount(rowIndex);
      const newRetry = currentRetry + 1;

      const updateData = [];

      // H열: 결과 누적
      const existingResult = await this.getIntegratedWorkerResultValue(rowIndex);
      const finalResult = existingResult && existingResult.trim()
        ? `${existingResult}\n${resultText}`
        : resultText;
      updateData.push({
        range: `${this.integratedWorkerSheetName}!H${rowIndex}`,
        values: [[finalResult]]
      });

      // L열: 재시도 +1
      updateData.push({
        range: `${this.integratedWorkerSheetName}!L${rowIndex}`,
        values: [[String(newRetry)]]
      });

      // J열: 잠금 해제
      updateData.push({
        range: `${this.integratedWorkerSheetName}!J${rowIndex}`,
        values: [['']]
      });

      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',  // 날짜가 Google Sheets 날짜 형식으로 인식됨
          data: updateData
        }
      });

      console.log(`[PauseSheetRepository] 통합워커 행${rowIndex} 실패 업데이트 완료: 재시도→${newRetry}`);
      return newRetry;
    } catch (error) {
      console.error(`[PauseSheetRepository] 통합워커 실패 업데이트 실패:`, error.message);
      return -1;
    }
  }
}

module.exports = PauseSheetRepository;