/**
 * UnifiedSheetsUpdateService - 통합 Google Sheets 업데이트 서비스
 * 
 * 한 곳에서 모든 Google Sheets 업데이트를 처리
 * - 이메일로 검색
 * - 정확한 날짜 파싱
 * - IP 주소 기록
 * - 상태 '일시중지'로 통일
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const axios = require('axios');

class UnifiedSheetsUpdateService {
  constructor(config = {}) {
    // 올바른 스프레드시트 ID 사용 (EnterpriseCLI와 동일)
    this.spreadsheetId = config.spreadsheetId || process.env.GOOGLE_SHEETS_ID;
    this.sheetName = config.sheetName || '일시중지';
    this.auth = null;
    this.sheets = null;
    this.debugMode = config.debugMode || false;
  }

  /**
   * 로깅 헬퍼
   */
  log(message, type = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = `[${timestamp}] [SheetsUpdate]`;
    
    switch (type) {
      case 'success':
        console.log(chalk.green(`${prefix} ✅ ${message}`));
        break;
      case 'error':
        console.log(chalk.red(`${prefix} ❌ ${message}`));
        break;
      case 'warning':
        console.log(chalk.yellow(`${prefix} ⚠️ ${message}`));
        break;
      case 'debug':
        if (this.debugMode) {
          console.log(chalk.gray(`${prefix} 🔍 ${message}`));
        }
        break;
      default:
        console.log(chalk.cyan(`${prefix} ${message}`));
    }
  }

  /**
   * Google Sheets 초기화
   */
  async initialize() {
    if (this.sheets) {
      this.log('이미 초기화됨', 'debug');
      return true;
    }

    try {
      // 서비스 계정 키 파일 찾기
      const possiblePaths = [
        path.join(__dirname, '../../config/youtube-automation-439913-b1c8dfe38d92.json'),
        path.join(__dirname, '../../../service_account.json'),
        path.join(process.cwd(), 'service_account.json'),
        path.join(process.cwd(), '../service_account.json')
      ];
      
      let keyFile = null;
      let keyPath = null;
      
      for (const testPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(testPath, 'utf8');
          keyPath = testPath;
          this.log(`서비스 계정 키 파일 로드: ${keyPath}`, 'success');
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
      
      this.log('Google Sheets 연결 성공', 'success');
      return true;
    } catch (error) {
      this.log(`Google Sheets 연결 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * IP 주소 가져오기 (브라우저 페이지에서)
   */
  async getIPAddress(page = null) {
    try {
      // page 객체가 전달되면 브라우저의 IP 확인
      if (page) {
        try {
          // IPService 사용 시도
          const IPService = require('./IPService');
          const ipService = new IPService({ debugMode: this.debugMode });
          const browserIP = await ipService.getCurrentIP(page);

          if (browserIP && browserIP !== 'N/A') {
            this.log(`브라우저 IP 확인 (IPService): ${browserIP}`, 'debug');
            return browserIP;
          }

          // IPService 실패 시 fetch API 사용 (페이지 이동 없이)
          const ipFromFetch = await page.evaluate(async () => {
            try {
              const response = await fetch('https://api.ipify.org?format=json');
              const data = await response.json();
              return data.ip;
            } catch (e) {
              return null;
            }
          });

          if (ipFromFetch) {
            this.log(`브라우저 IP 확인 (fetch): ${ipFromFetch}`, 'debug');
            return ipFromFetch;
          }
        } catch (browserError) {
          this.log('브라우저 IP 확인 실패, 로컬 IP 사용', 'warning');
        }
      }

      // 로컬 IP 확인 (fallback)
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: 5000
      });
      return response.data.ip;
    } catch (error) {
      this.log('IP 주소 확인 실패', 'warning');
      return 'Unknown';
    }
  }

  /**
   * 날짜 파싱 (브라질/포르투갈어 지원 강화)
   */
  parseDate(dateStr) {
    if (!dateStr) return '';
    
    // "Next billing date:", "다음 결제일:" 등 제거
    dateStr = dateStr.replace(/Next billing date:\s*/i, '').trim();
    dateStr = dateStr.replace(/다음 결제일:\s*/i, '').trim();
    dateStr = dateStr.replace(/Ngày thanh toán tiếp theo:\s*/i, '').trim();
    dateStr = dateStr.replace(/Próxima data de cobrança:\s*/i, '').trim();
    dateStr = dateStr.replace(/A assinatura será retomada em\s*/i, '').trim();
    dateStr = dateStr.replace(/A assinatura será pausada em\s*/i, '').trim();
    
    // 이미 올바른 형식인 경우
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      this.log(`이미 파싱된 날짜: ${dateStr}`, 'debug');
      return dateStr;
    }
    
    // 잘못된 형식 필터링 (0807.07.00 같은)
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) {
      this.log(`잘못된 날짜 형식 감지: ${dateStr}`, 'warning');
      return ''; // 빈 문자열 반환
    }
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    // 한국어 YYYY. MM. DD. 형식 (예: 2025. 10. 29.)
    const koreanFullMatch = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
    if (koreanFullMatch) {
      const year = koreanFullMatch[1];
      const month = koreanFullMatch[2].padStart(2, '0');
      const day = koreanFullMatch[3].padStart(2, '0');
      const parsedDate = `${year}-${month}-${day}`;
      this.log(`한국어 날짜 파싱 (YYYY. MM. DD): ${dateStr} → ${parsedDate}`, 'debug');
      return parsedDate;
    }
    
    // 브라질 DD/MM/YYYY 형식 (매우 중요!)
    const brazilFullMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brazilFullMatch) {
      const day = brazilFullMatch[1].padStart(2, '0');
      const month = brazilFullMatch[2].padStart(2, '0');
      const year = brazilFullMatch[3];
      const parsedDate = `${year}-${month}-${day}`;
      this.log(`브라질 날짜 파싱 (DD/MM/YYYY): ${dateStr} → ${parsedDate}`, 'debug');
      return parsedDate;
    }
    
    // 브라질 DD/MM 형식 (년도 없음)
    const brazilShortMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (brazilShortMatch) {
      const day = brazilShortMatch[1].padStart(2, '0');
      const month = brazilShortMatch[2].padStart(2, '0');
      const monthNum = parseInt(month);
      let year = currentYear;
      
      // 현재 월보다 이전이면 다음 해로 설정
      if (monthNum < currentMonth) {
        year = currentYear + 1;
      }
      
      const parsedDate = `${year}-${month}-${day}`;
      this.log(`브라질 날짜 파싱 (DD/MM): ${dateStr} → ${parsedDate}`, 'debug');
      return parsedDate;
    }
    
    // 한국어 날짜 형식: "9월 11일"
    const koreanMatch = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (koreanMatch) {
      const month = koreanMatch[1].padStart(2, '0');
      const day = koreanMatch[2].padStart(2, '0');
      const monthNum = parseInt(month);
      let year = currentYear;
      
      // 현재 월보다 이전 월이면 다음 해로 설정
      if (monthNum < currentMonth) {
        year = currentYear + 1;
      }
      
      const parsedDate = `${year}-${month}-${day}`;
      this.log(`한국어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
      return parsedDate;
    }
    
    // 베트남어 날짜 형식: "11 thg 9" 또는 "11 tháng 9"
    const vietnameseMatch = dateStr.match(/(\d{1,2})\s+(?:thg|tháng)\s+(\d{1,2})/);
    if (vietnameseMatch) {
      const day = vietnameseMatch[1].padStart(2, '0');
      const month = vietnameseMatch[2].padStart(2, '0');
      const monthNum = parseInt(month);
      let year = currentYear;
      
      if (monthNum < currentMonth) {
        year = currentYear + 1;
      }
      
      const parsedDate = `${year}-${month}-${day}`;
      this.log(`베트남어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
      return parsedDate;
    }
    
    // 브라질 포르투갈어 날짜: "25 de ago." 또는 "25 de agosto"
    const brazilMonthMatch = dateStr.match(/(\d{1,2})\s+(?:de\s+)?([a-záêçõ]+\.?)(?:\s+de\s+(\d{4}))?/i);
    if (brazilMonthMatch) {
      const day = brazilMonthMatch[1].padStart(2, '0');
      const monthStr = brazilMonthMatch[2].toLowerCase().replace('.', '');
      const yearStr = brazilMonthMatch[3];
      
      // 브라질 포르투갈어 월 이름 매핑 (전체 및 축약형)
      const brazilMonths = {
        'janeiro': '01', 'jan': '01',
        'fevereiro': '02', 'fev': '02',
        'março': '03', 'mar': '03',
        'abril': '04', 'abr': '04',
        'maio': '05', 'mai': '05',
        'junho': '06', 'jun': '06',
        'julho': '07', 'jul': '07',
        'agosto': '08', 'ago': '08',
        'setembro': '09', 'set': '09',
        'outubro': '10', 'out': '10',
        'novembro': '11', 'nov': '11',
        'dezembro': '12', 'dez': '12'
      };
      
      const month = brazilMonths[monthStr];
      if (month) {
        let year = yearStr || currentYear.toString();
        
        // 년도가 없고 월이 현재보다 이전이면 다음 해로 설정
        if (!yearStr) {
          const monthNum = parseInt(month);
          if (monthNum < currentMonth) {
            year = (currentYear + 1).toString();
          }
        }
        
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`브라질 포르투갈어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 영어 월 이름 매핑
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
    
    // "Sep 11" 또는 "September 11" 형식
    const englishMatch = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2})$/i);
    if (englishMatch) {
      const monthName = englishMatch[1].toLowerCase();
      const day = englishMatch[2].padStart(2, '0');
      const month = months[monthName];
      
      if (month) {
        const monthNum = parseInt(month);
        let year = currentYear;
        if (monthNum < currentMonth) {
          year = currentYear + 1;
        }
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`영어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 터키어 날짜 형식: "11 Eylül"
    const turkishMonths = {
      'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04',
      'mayıs': '05', 'haziran': '06', 'temmuz': '07', 'ağustos': '08',
      'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12'
    };
    
    const turkishMatch = dateStr.match(/(\d{1,2})\s+([A-Za-zğıöşüçĞİÖŞÜÇ]+)/i);
    if (turkishMatch) {
      const day = turkishMatch[1].padStart(2, '0');
      const monthName = turkishMatch[2].toLowerCase();
      const month = turkishMonths[monthName];
      
      if (month) {
        const monthNum = parseInt(month);
        let year = currentYear;
        if (monthNum < currentMonth) {
          year = currentYear + 1;
        }
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`터키어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 러시아어 날짜 형식: "11 сентября"
    const russianMonths = {
      'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
      'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
      'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
    };
    
    const russianMatch = dateStr.match(/(\d{1,2})\s+([А-Яа-яЁё]+)/);
    if (russianMatch) {
      const day = russianMatch[1].padStart(2, '0');
      const monthName = russianMatch[2].toLowerCase();
      const month = russianMonths[monthName];
      
      if (month) {
        const monthNum = parseInt(month);
        let year = currentYear;
        if (monthNum < currentMonth) {
          year = currentYear + 1;
        }
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`러시아어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 스페인어 날짜 형식: "11 de septiembre"
    const spanishMonths = {
      'enero': '01', 'ene': '01',
      'febrero': '02', 'feb': '02',
      'marzo': '03', 'mar': '03',
      'abril': '04', 'abr': '04',
      'mayo': '05', 'may': '05',
      'junio': '06', 'jun': '06',
      'julio': '07', 'jul': '07',
      'agosto': '08', 'ago': '08',
      'septiembre': '09', 'sep': '09', 'sept': '09',
      'octubre': '10', 'oct': '10',
      'noviembre': '11', 'nov': '11',
      'diciembre': '12', 'dic': '12'
    };
    
    const spanishMatch = dateStr.match(/(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+de\s+(\d{4}))?/i);
    if (spanishMatch) {
      const day = spanishMatch[1].padStart(2, '0');
      const monthName = spanishMatch[2].toLowerCase();
      const yearStr = spanishMatch[3];
      const month = spanishMonths[monthName];
      
      if (month) {
        let year = yearStr || currentYear.toString();
        if (!yearStr) {
          const monthNum = parseInt(month);
          if (monthNum < currentMonth) {
            year = (currentYear + 1).toString();
          }
        }
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`스페인어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 프랑스어 날짜 형식: "11 septembre"
    const frenchMonths = {
      'janvier': '01', 'janv': '01',
      'février': '02', 'févr': '02', 'fevrier': '02',
      'mars': '03', 'mar': '03',
      'avril': '04', 'avr': '04',
      'mai': '05',
      'juin': '06',
      'juillet': '07', 'juil': '07',
      'août': '08', 'aout': '08',
      'septembre': '09', 'sept': '09',
      'octobre': '10', 'oct': '10',
      'novembre': '11', 'nov': '11',
      'décembre': '12', 'déc': '12', 'decembre': '12'
    };
    
    const frenchMatch = dateStr.match(/(\d{1,2})\s+([a-zàâçèéêëîïôùûü]+)(?:\s+(\d{4}))?/i);
    if (frenchMatch) {
      const day = frenchMatch[1].padStart(2, '0');
      const monthName = frenchMatch[2].toLowerCase();
      const yearStr = frenchMatch[3];
      const month = frenchMonths[monthName];
      
      if (month) {
        let year = yearStr || currentYear.toString();
        if (!yearStr) {
          const monthNum = parseInt(month);
          if (monthNum < currentMonth) {
            year = (currentYear + 1).toString();
          }
        }
        const parsedDate = `${year}-${month}-${day}`;
        this.log(`프랑스어 날짜 파싱: ${dateStr} → ${parsedDate}`, 'debug');
        return parsedDate;
      }
    }
    
    // 파싱 실패 시 빈 문자열 반환 (잘못된 날짜 저장 방지)
    this.log(`날짜 파싱 실패: ${dateStr}`, 'warning');
    return '';
  }

  /**
   * 통합 업데이트 메서드
   */
  async updatePauseStatus(email, data) {
    try {
      // 초기화 확인
      if (!this.sheets) {
        await this.initialize();
      }

      this.log(`${email} 업데이트 시작`, 'info');

      // 시트 데이터 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:Z`
      });

      const rows = response.data.values || [];
      if (rows.length === 0) {
        this.log('시트가 비어있음', 'error');
        return false;
      }

      const headers = rows[0];
      
      // 컬럼 인덱스 찾기
      const emailColIndex = headers.findIndex(h => 
        h && (h.includes('이메일') || h.includes('Email') || h.includes('ID') || h === 'id' || h === '아이디')
      );
      
      if (emailColIndex === -1) {
        this.log('이메일 컬럼을 찾을 수 없음', 'error');
        return false;
      }

      // 이메일로 행 찾기
      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][emailColIndex] === email) {
          rowIndex = i + 1; // 1-based index
          break;
        }
      }

      if (rowIndex === -1) {
        this.log(`${email}을 시트에서 찾을 수 없음`, 'error');
        
        // 디버깅: 처음 5개 이메일 표시
        if (this.debugMode) {
          const sampleEmails = rows.slice(1, 6).map(r => r[emailColIndex]).filter(Boolean);
          this.log(`시트의 이메일 샘플: ${sampleEmails.join(', ')}`, 'debug');
        }
        
        return false;
      }

      this.log(`행 ${rowIndex}에서 ${email} 발견`, 'success');

      // IP 주소 가져오기 (브라우저 page 객체가 있으면 브라우저 IP 사용)
      const ipAddress = await this.getIPAddress(data.page);

      // 각 컬럼 인덱스 찾기
      const findColumnIndex = (names) => {
        for (const name of names) {
          const index = headers.findIndex(h => h && h.includes(name));
          if (index !== -1) return index;
        }
        return -1;
      };

      const statusCol = findColumnIndex(['상태', 'Status']);
      const nextBillingCol = findColumnIndex(['다음 결제일', '다음결제일', 'Next Billing']);
      const ipCol = findColumnIndex(['IP', 'IP주소', 'IP Address']);
      const resultCol = findColumnIndex(['결과', 'Result']);
      const updateTimeCol = findColumnIndex(['최종 업데이트', 'Last Update', '업데이트 시간']);

      // 업데이트할 데이터 준비
      const updateData = [];
      
      // 상태 업데이트 - 만료됨, 번호인증필요 상태는 오류가 있어도 업데이트
      if (statusCol !== -1 && data.status) {
        // 만료됨, 번호인증필요 상태는 오류가 있어도 업데이트해야 함
        // reCAPTCHA 감지 시 "번호인증계정"으로 표시
        let statusToWrite = data.status;
        if (data.status === '번호인증필요') {
          statusToWrite = '번호인증계정';  // E열에 기록할 실제 값
        }
        
        if (data.status === '만료됨' || data.status === '번호인증필요' || !data.error) {
          updateData.push({
            range: `${this.sheetName}!${this.columnToLetter(statusCol)}${rowIndex}`,
            values: [[statusToWrite]]
          });
          this.log(`✅ 상태 필드(E${rowIndex}) 업데이트: ${statusToWrite}`, 'info');
          console.log(chalk.green(`✅ [SheetsUpdate] E${rowIndex}열 상태 업데이트: "${statusToWrite}"`));
        } else {
          // 일반 오류의 경우 상태를 변경하지 않음
          this.log(`⚠️ 오류 발생으로 상태 필드 유지: ${data.error}`, 'warning');
          console.log(chalk.yellow(`⚠️ [SheetsUpdate] E${rowIndex}열 상태 유지 (오류: ${data.error})`));
        }
      } else if (statusCol !== -1) {
        console.log(chalk.red(`❌ [SheetsUpdate] E${rowIndex}열 상태 업데이트 스킵 - data.status 없음`));
      }

      // 다음 결제일 업데이트 (성공한 경우에만)
      if (nextBillingCol !== -1 && data.nextBillingDate && !data.error) {
        const parsedDate = this.parseDate(data.nextBillingDate);
        // 날짜가 비어있지 않고 오류가 없는 경우만 업데이트
        if (parsedDate && parsedDate !== '') {
          updateData.push({
            range: `${this.sheetName}!${this.columnToLetter(nextBillingCol)}${rowIndex}`,
            values: [[parsedDate]]
          });
          this.log(`날짜 파싱 및 저장: ${data.nextBillingDate} → ${parsedDate}`, 'success');
        console.log(chalk.cyan(`📅 [SheetsUpdate] 날짜 저장할 위치: ${this.sheetName}!${this.columnToLetter(nextBillingCol)}${rowIndex}`));
        console.log(chalk.cyan(`📅 [SheetsUpdate] 저장할 값: ${parsedDate}`));
        } else if (!data.error) {
          this.log(`날짜 파싱 실패: ${data.nextBillingDate}`, 'warning');
        }
      }

      // IP 주소 업데이트
      if (ipCol !== -1) {
        updateData.push({
          range: `${this.sheetName}!${this.columnToLetter(ipCol)}${rowIndex}`,
          values: [[ipAddress]]
        });
      }

      // 결과 업데이트 - 상세 정보 포함
      if (resultCol !== -1) {
        const now = new Date();
        const timeStr = now.toLocaleString('ko-KR', { 
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        const dateStr = now.toLocaleDateString('ko-KR');
        
        // 상세 결과 메시지 생성 (가독성 개선)
        let detailedResult = '';
        if (data.detailedResult) {
          // 이미 상세 결과가 제공된 경우
          detailedResult = data.detailedResult;
        } else if (data.isAlreadyPaused) {
          // 이미 일시중지 상태인 경우
          detailedResult = `✅ 이미 일시중지됨 ┃ ${timeStr} ┃ ${dateStr}`;
        } else if (data.isNewlyPaused) {
          // 새로 일시중지한 경우
          const resumeDateInfo = data.nextBillingDate ? ` ┃ 재개예정: ${this.parseDate(data.nextBillingDate)}` : '';
          const langInfo = data.language ? ` ┃ 언어: ${data.language}` : '';
          detailedResult = `🆕 신규 일시중지 성공${langInfo}${resumeDateInfo} ┃ ${timeStr}`;
        } else if (data.isResumed) {
          // 재개 성공한 경우
          const nextBillingInfo = data.nextBillingDate ? ` ┃ 다음결제: ${this.parseDate(data.nextBillingDate)}` : '';
          const langInfo = data.language ? ` ┃ 언어: ${data.language}` : '';
          detailedResult = `🔄 재개 성공${langInfo}${nextBillingInfo} ┃ ${timeStr}`;
        } else if (data.error) {
          // 오류가 있는 경우 - reCAPTCHA 특별 처리
          if (data.error.includes('RECAPTCHA') || data.error.includes('번호인증')) {
            detailedResult = `🔐 번호인증계정 (reCAPTCHA) ┃ ${timeStr}`;
          } else {
            detailedResult = `❌ 실패: ${data.error} ┃ ${timeStr}`;
          }
        } else {
          // 기본 성공 메시지
          detailedResult = `✅ 성공 ┃ ${timeStr} ┃ ${dateStr}`;
        }
        
        updateData.push({
          range: `${this.sheetName}!${this.columnToLetter(resultCol)}${rowIndex}`,
          values: [[detailedResult]]
        });
      }

      // 업데이트 시간
      if (updateTimeCol !== -1) {
        const timestamp = new Date().toISOString();
        updateData.push({
          range: `${this.sheetName}!${this.columnToLetter(updateTimeCol)}${rowIndex}`,
          values: [[timestamp]]
        });
      }

      // 배치 업데이트 실행
      if (updateData.length > 0) {
        // 디버깅: 업데이트할 데이터 확인
        console.log(chalk.magenta(`📝 [BatchUpdate] 업데이트할 필드 수: ${updateData.length}`));
        updateData.forEach((item, index) => {
          console.log(chalk.magenta(`  ${index + 1}. ${item.range}: ${JSON.stringify(item.values)}`));
        });
        
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: updateData
          }
        });

        this.log(`Google Sheets 업데이트 완료 (${updateData.length}개 필드)`, 'success');
        
        // 실제 업데이트된 상태 표시
        const updatedStatus = data.status || '유지됨';
        const updatedDate = data.nextBillingDate ? this.parseDate(data.nextBillingDate) : '';
        this.log(`업데이트 내용: 상태=${updatedStatus}, 날짜=${updatedDate}, IP=${ipAddress}`, 'success');
        
        return true;
      }

      return false;
    } catch (error) {
      this.log(`업데이트 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 컬럼 인덱스를 알파벳으로 변환
   */
  columnToLetter(column) {
    let letter = '';
    while (column >= 0) {
      letter = String.fromCharCode((column % 26) + 65) + letter;
      column = Math.floor(column / 26) - 1;
    }
    return letter;
  }
}

module.exports = UnifiedSheetsUpdateService;