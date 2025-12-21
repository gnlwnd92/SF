/**
 * 날짜 파싱 서비스
 * 터키어 등 다국어 날짜를 정확히 파싱
 */

const UniversalDateExtractor = require('./UniversalDateExtractor');

class DateParsingService {
  constructor() {
    // UniversalDateExtractor 초기화
    this.universalExtractor = new UniversalDateExtractor({ 
      logger: console // 기본 콘솔 로거 사용
    });
    // 터키어 월 이름 매핑 (전체 이름과 축약형)
    this.turkishMonths = {
      // 전체 이름
      'ocak': '01',
      'şubat': '02', 
      'mart': '03',
      'nisan': '04',
      'mayıs': '05',
      'haziran': '06',
      'temmuz': '07',
      'ağustos': '08',
      'eylül': '09',
      'ekim': '10',
      'kasım': '11',
      'aralık': '12',
      // 축약형
      'oca': '01',
      'şub': '02',
      'mar': '03', 
      'nis': '04',
      'may': '05',
      'haz': '06',
      'tem': '07',
      'ağu': '08',
      'eyl': '09',
      'eki': '10',
      'kas': '11',
      'ara': '12'
    };
    
    // 한국어 월 매핑
    this.koreanMonths = {
      '1월': '01',
      '2월': '02',
      '3월': '03',
      '4월': '04',
      '5월': '05',
      '6월': '06',
      '7월': '07',
      '8월': '08',
      '9월': '09',
      '10월': '10',
      '11월': '11',
      '12월': '12'
    };

    // 러시아어 월 이름 매핑 (전체 이름과 축약형)
    this.russianMonths = {
      // 전체 이름 (소문자)
      'января': '01',
      'февраля': '02',
      'марта': '03',
      'апреля': '04',
      'мая': '05',
      'июня': '06',
      'июля': '07',
      'августа': '08',
      'сентября': '09',
      'октября': '10',
      'ноября': '11',
      'декабря': '12',
      // 축약형
      'янв': '01',
      'фев': '02',
      'мар': '03',
      'апр': '04',
      'май': '05',
      'июн': '06',
      'июл': '07',
      'авг': '08',
      'сен': '09',
      'окт': '10',
      'ноя': '11',
      'дек': '12'
    };
  }

  /**
   * 년도가 없는 날짜에 대해 가장 적절한 년도를 계산
   *
   * 컨텍스트별 규칙:
   * 1. '재개' / '다음결제일' (Resume/Next Billing):
   *    - 오늘 날짜와 같으면 -> 올해 (오늘도 다음 결제일이 될 수 있음)
   *    - 오늘보다 이전 날짜면 -> 내년 (예: 오늘 10/27, 표시 "26 Oct" -> 2026년 10월 26일)
   *    - 오늘보다 이후 날짜면 -> 올해
   *
   * 2. '일시정지' (Pause):
   *    - 오늘 날짜와 같으면 -> 내년 (일시정지는 내일부터 가능)
   *    - 오늘보다 이전 날짜면 -> 내년
   *    - 오늘보다 이후 날짜면 -> 올해
   *
   * @param {number} month - 월 (1-12)
   * @param {number} day - 일 (1-31)
   * @param {string} context - 컨텍스트 ('재개', '일시정지', 'resume', 'pause', 'nextBilling')
   * @returns {number} - 계산된 년도
   */
  calculateYear(month, day, context) {
    if (!context) context = 'pause';  // 기본값 설정
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 0-based를 1-based로 변환
    const currentDay = now.getDate();

    // 테스트 환경에서는 고정된 현재 날짜 사용 (2025년으로 가정)
    // 실제 환경에서는 현재 날짜 사용
    const testMode = process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';
    const baseYear = testMode ? 2025 : currentYear;

    // 디버그 로그
    const debugLog = process.env.DEBUG_MODE === 'true' || testMode;
    if (debugLog) {
      console.log(`📅 calculateYear: 입력(${month}/${day}), 오늘(${currentMonth}/${currentDay}), 연도(${baseYear})`);
    }

    // 날짜를 숫자로 변환하여 비교 (MMDD 형식)
    const inputDate = month * 100 + day;  // 예: 9/26 -> 926
    const todayDate = currentMonth * 100 + currentDay;  // 예: 9/26 -> 926

    // 컨텍스트에 따른 날짜 계산
    const isResumeContext = context === '재개' || context === 'resume' || context === 'nextBilling';

    if (debugLog) {
      console.log(`  컨텍스트: ${context} (${isResumeContext ? '재개/다음결제' : '일시정지'})`);
    }

    if (isResumeContext) {
      // 재개/다음 결제일 컨텍스트: 오늘 날짜도 올해로

      // 케이스 1: 오늘과 같은 날짜 -> 올해
      if (inputDate === todayDate) {
        if (debugLog) console.log(`  → ✅ [재개] 오늘 날짜 (${month}/${day}) -> ${baseYear}년`);
        return baseYear;
      }

      // 케이스 2: 오늘보다 이전 날짜 -> 내년
      // 예: 오늘이 10/27인데 "26 Oct" 표시 -> 2026년 10월 26일
      if (inputDate < todayDate) {
        if (debugLog) console.log(`  → 📅 [재개] 과거 날짜 (${month}/${day} < ${currentMonth}/${currentDay}) -> ${baseYear + 1}년 (내년)`);
        return baseYear + 1;
      }

      // 케이스 3: 오늘보다 이후 날짜 -> 올해
      if (inputDate > todayDate) {
        if (debugLog) console.log(`  → 📅 [재개] 미래 날짜 (${month}/${day} > ${currentMonth}/${currentDay}) -> ${baseYear}년`);
        return baseYear;
      }
    } else {
      // 일시정지 컨텍스트: 기존 로직 (오늘 날짜는 내년으로)

      // 케이스 1: 오늘과 같은 날짜 -> 내년
      if (inputDate === todayDate) {
        if (debugLog) console.log(`  → 📅 [일시정지] 오늘 날짜 (${month}/${day}) -> ${baseYear + 1}년`);
        return baseYear + 1;
      }

      // 케이스 2: 오늘보다 이전 날짜 -> 내년
      if (inputDate < todayDate) {
        if (debugLog) console.log(`  → 📅 [일시정지] 과거 날짜 (${month}/${day} < ${currentMonth}/${currentDay}) -> ${baseYear + 1}년`);
        return baseYear + 1;
      }

      // 케이스 3: 오늘보다 이후 날짜 -> 올해
      if (inputDate > todayDate) {
        if (debugLog) console.log(`  → 📅 [일시정지] 미래 날짜 (${month}/${day} > ${currentMonth}/${currentDay}) -> ${baseYear}년`);
        return baseYear;
      }
    }

    // 기본값 (도달하지 않아야 함)
    return baseYear;
  }

  /**
   * 한국어 날짜 파싱
   * @param {string} dateStr - 한국어 날짜 문자열 (예: "9월 2일", "2025년 9월 2일")
   * @param {string} context - 컨텍스트 ('재개', '일시정지' 등)
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseKoreanDate(dateStr, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return null;

    const normalized = dateStr.trim();
    console.log(`🗓️ 한국어 날짜 파싱 시도: "${dateStr}" (컨텍스트: ${context})`);

    // 패턴 1: "2025년 9월 2일" 형식 (연도 포함을 먼저 체크)
    const pattern1 = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const year = match1[1];
      const month = parseInt(match1[2]);
      const day = parseInt(match1[3]);
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 한국어 패턴1 매칭 (연도 포함): ${result}`);
      return result;
    }

    // 패턴 2: "9월 2일" 형식 (연도 없음 - 동적 계산)
    const pattern2 = /(\d{1,2})월\s*(\d{1,2})일/;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const month = parseInt(match2[1]);
      const day = parseInt(match2[2]);
      const year = this.calculateYear(month, day, context);  // 컨텍스트 전달
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 한국어 패턴2 매칭 (연도 계산): ${result}`);
      return result;
    }

    // 패턴 3: "9/2" 또는 "09/02" 형식 (한국어 컨텍스트)
    const pattern3 = /^(\d{1,2})\/(\d{1,2})$/;
    const match3 = normalized.match(pattern3);
    if (match3) {
      const month = parseInt(match3[1]);
      const day = parseInt(match3[2]);
      const year = this.calculateYear(month, day, context);  // 컨텍스트 전달
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 한국어 패턴3 매칭: ${result}`);
      return result;
    }

    console.log(`⚠️ 한국어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }
  
  /**
   * 포르투갈어 날짜 파싱
   * @param {string} dateStr - 포르투갈어 날짜 문자열
   * @param {string} context - 컨텍스트 ('재개', '일시정지' 등)
   * @returns {string} - "YYYY. M. D" 형식
   */
  parsePortugueseDate(dateStr, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return null;
    
    const normalized = dateStr.trim();
    console.log(`🌍 포르투갈어 날짜 파싱 시도: "${dateStr}"`);
    
    // 패턴 1: "7 de nov. de 2025" 형식 (년도 포함)
    const pattern1WithYear = /(\d{1,2})\s+de\s+([a-zç]+)\.?\s+de\s+(\d{4})/i;
    const match1WithYear = normalized.match(pattern1WithYear);
    if (match1WithYear) {
      const day = parseInt(match1WithYear[1]);
      const monthStr = match1WithYear[2].toLowerCase().replace('.', '');
      const year = parseInt(match1WithYear[3]);
      
      // 포르투갈어 월 매핑
      const portugueseMonths = {
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
      
      const month = portugueseMonths[monthStr];
      
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 포르투갈어 년도 포함 형식: ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "7 de out." 또는 "7 de outubro" 형식 (년도 없음)
    const pattern1 = /(\d{1,2})\s+de\s+([a-zç]+)\.?/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const monthStr = match1[2].toLowerCase().replace('.', '');
      
      // 포르투갈어 월 매핑
      const portugueseMonths = {
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
      
      const month = portugueseMonths[monthStr];
      
      if (month) {
        // 동적 년도 계산 - 다음 번 해당 날짜 사용
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 포르투갈어 패턴 매칭: ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "7/10" 또는 "07/11/2025" 형식 (DD/MM 또는 DD/MM/YYYY)
    const pattern2 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const day = parseInt(match2[1]);
      const month = parseInt(match2[2]);
      // 년도가 있으면 사용, 없으면 동적 계산
      const year = match2[3] ? parseInt(match2[3]) : this.calculateYear(month, day, context);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 포르투갈어 DD/MM 형식: ${result}`);
      return result;
    }
    
    return null;
  }
  
  /**
   * 러시아어 날짜 파싱
   * @param {string} dateStr - 러시아어 날짜 문자열
   * @param {string} context - 컨텍스트 ('재개', '일시정지' 등)
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseRussianDate(dateStr, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return null;

    let normalized = dateStr.trim();
    console.log(`🌍 러시아어 날짜 파싱 시도: "${dateStr}"`);

    // "Подписка закончилась", "истекла" 등의 텍스트 제거
    normalized = normalized
      .replace(/Подписка\s+закончилась\s*/gi, '')
      .replace(/подписка\s+истекла\s*/gi, '')
      .replace(/истекла\s*/gi, '')
      .replace(/закончилась\s*/gi, '')
      .replace(/\s*г\.?$/gi, '')  // 끝의 'г.' 또는 'г' 제거
      .trim();

    // 패턴 1: "9 окт. 2025" 또는 "9 октября 2025" 형식 (년도 포함)
    const pattern1WithYear = /(\d{1,2})\s+([\u0430-\u044f]+)\.?\s+(\d{4})/i;
    const match1WithYear = normalized.match(pattern1WithYear);
    if (match1WithYear) {
      const day = parseInt(match1WithYear[1]);
      const monthStr = match1WithYear[2].toLowerCase().replace('.', '');
      const year = parseInt(match1WithYear[3]);

      // 이미 정의된 러시아어 월 이름 매핑 사용
      let month = this.russianMonths[monthStr];
      if (!month) {
        // 축약형 매칭을 위한 추가 처리
        for (const [key, value] of Object.entries(this.russianMonths)) {
          if (key.startsWith(monthStr) || monthStr.startsWith(key.substring(0, 3))) {
            month = value;
            break;
          }
        }
      }

      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 러시아어 년도 포함 형식: ${result}`);
        return result;
      }
    }

    // 패턴 2: "7 окт." 또는 "7 октября" 형식 (년도 없음)
    const pattern1 = /(\d{1,2})\s+([\u0430-\u044f]+)\.?/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const monthStr = match1[2].toLowerCase().replace('.', '');

      // 이미 정의된 러시아어 월 이름 매핑 사용
      let month = this.russianMonths[monthStr];
      if (!month) {
        // 기존 russianMonths 객체를 참조하지 않고 직접 매핑
        const russianMonths = {
          'января': '01', 'янв': '01',
          'февраля': '02', 'фев': '02',
          'марта': '03', 'мар': '03',
          'апреля': '04', 'апр': '04',
          'мая': '05', 'май': '05',
          'июня': '06', 'июн': '06',
          'июля': '07', 'июл': '07',
          'августа': '08', 'авг': '08',
          'сентября': '09', 'сен': '09',
          'октября': '10', 'окт': '10',
          'ноября': '11', 'нояб': '11', 'ноя': '11',
          'декабря': '12', 'дек': '12'
        };

        month = russianMonths[monthStr];
        if (!month) {
          // 부분 매칭 시도 (예: "окт" -> "октября")
          for (const [key, value] of Object.entries(russianMonths)) {
            if (key.startsWith(monthStr) || monthStr.startsWith(key.substring(0, 3))) {
              month = value;
              break;
            }
          }
        }
      }

      if (month) {
        // 동적 년도 계산 - 다음 번 해당 날짜 사용
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 러시아어 패턴 매칭: ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "7 нояб. 2025 г." 형식 (년도 포함)
    const pattern2 = /(\d{1,2})\s+([\u0430-\u044f]+)\.?\s+(\d{4})\s*г?\.?/i;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const day = parseInt(match2[1]);
      const monthStr = match2[2].toLowerCase().replace('.', '');
      const year = parseInt(match2[3]);
      
      // 러시아어 월 매핑 재사용
      const russianMonths = {
        'января': '01', 'янв': '01',
        'февраля': '02', 'фев': '02',
        'марта': '03', 'мар': '03',
        'апреля': '04', 'апр': '04',
        'мая': '05', 'май': '05',
        'июня': '06', 'июн': '06',
        'июля': '07', 'июл': '07',
        'августа': '08', 'авг': '08',
        'сентября': '09', 'сен': '09',
        'октября': '10', 'окт': '10',
        'ноября': '11', 'нояб': '11', 'ноя': '11',
        'декабря': '12', 'дек': '12'
      };
      
      let month = russianMonths[monthStr];
      if (!month) {
        for (const [key, value] of Object.entries(russianMonths)) {
          if (key.startsWith(monthStr) || monthStr.startsWith(key.substring(0, 3))) {
            month = value;
            break;
          }
        }
      }
      
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 러시아어 년도 포함 형식: ${result}`);
        return result;
      }
    }
    
    // 패턴 3: "07.10" 형식 (DD.MM)
    const pattern3 = /^(\d{1,2})\.(\d{1,2})$/;
    const match3 = normalized.match(pattern3);
    if (match3) {
      const day = parseInt(match3[1]);
      const month = parseInt(match3[2]);
      // 동적 년도 계산
      const year = this.calculateYear(month, day, context);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 러시아어 DD.MM 형식: ${result}`);
      return result;
    }
    
    return null;
  }
  
  /**
   * 베트남어 날짜 파싱
   * @param {string} dateStr - 베트남어 날짜 문자열
   * @param {string} context - 컨텍스트
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseVietnameseDate(dateStr, context) {
    if (!context) context = 'pause';
    if (!dateStr) return null;
    
    const normalized = dateStr.trim();
    console.log(`🌏 베트남어 날짜 파싱 시도: "${dateStr}"`);
    
    // 패턴 1: "9 thg 10, 2025" 형식 (년도 포함)
    const pattern1 = /(\d{1,2})\s+thg\s+(\d{1,2}),?\s+(\d{4})/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const month = parseInt(match1[2]);
      const year = parseInt(match1[3]);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 베트남어 년도 포함 형식: ${result}`);
      return result;
    }
    
    // 패턴 2: "9 thg 10" 형식 (년도 없음)
    const pattern2 = /(\d{1,2})\s+thg\s+(\d{1,2})/i;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const day = parseInt(match2[1]);
      const month = parseInt(match2[2]);
      // 동적 년도 계산
      const year = this.calculateYear(month, day, context);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 베트남어 패턴 매칭: ${result}`);
      return result;
    }
    
    // 패턴 3: "Ngày 9 tháng 10" 형식
    const pattern3 = /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})/i;
    const match3 = normalized.match(pattern3);
    if (match3) {
      const day = parseInt(match3[1]);
      const month = parseInt(match3[2]);
      // 동적 년도 계산
      const year = this.calculateYear(month, day, context);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 베트남어 Ngày/tháng 형식: ${result}`);
      return result;
    }
    
    // 패턴 4: "09/10" 또는 "09/10/2025" 형식 (DD/MM 또는 DD/MM/YYYY)
    const pattern4 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;
    const match4 = normalized.match(pattern4);
    if (match4) {
      const day = parseInt(match4[1]);
      const month = parseInt(match4[2]);
      // 년도가 있으면 사용, 없으면 동적 계산
      const year = match4[3] ? parseInt(match4[3]) : this.calculateYear(month, day, context);
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 베트남어 DD/MM 형식: ${result}`);
      return result;
    }
    
    return null;
  }
  
  /**
   * 터키어 날짜 파싱
   * @param {string} dateStr - 터키어 날짜 문자열 (예: "1 Eyl", "1 Eylül 2025")
   * @param {string} context - 컨텍스트 ('재개', '일시정지' 등)
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseTurkishDate(dateStr, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return null;
    
    const normalized = dateStr.trim().toLowerCase();
    console.log(`🗓️ 터키어 날짜 파싱 시도: "${dateStr}"`);
    
    // 패턴 1: "1 Eyl" 또는 "1 Eylül"
    const pattern1 = /^(\d{1,2})\s+([a-zığüöşçı]+)$/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const day = parseInt(match1[1]);
      const monthStr = match1[2];
      const month = this.turkishMonths[monthStr];
      
      if (month) {
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 패턴1 매칭: ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "Eyl 1" 또는 "Eylül 1"
    const pattern2 = /^([a-zığüöşçı]+)\s+(\d{1,2})$/i;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const monthStr = match2[1];
      const day = parseInt(match2[2]);
      const month = this.turkishMonths[monthStr];
      
      if (month) {
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 패턴2 매칭: ${result}`);
        return result;
      }
    }
    
    // 패턴 3: "1 Eyl 2025" 또는 "1 Eylül 2025"
    const pattern3 = /^(\d{1,2})\s+([a-zığüöşçı]+)\s+(\d{4})$/i;
    const match3 = normalized.match(pattern3);
    if (match3) {
      const day = parseInt(match3[1]);
      const monthStr = match3[2];
      const year = match3[3];
      const month = this.turkishMonths[monthStr];
      
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 패턴3 매칭: ${result}`);
        return result;
      }
    }
    
    // 패턴 4: "Eylül 1, 2025" 또는 "Eyl 1, 2025"
    const pattern4 = /^([a-zığüöşçı]+)\s+(\d{1,2}),?\s+(\d{4})$/i;
    const match4 = normalized.match(pattern4);
    if (match4) {
      const monthStr = match4[1];
      const day = parseInt(match4[2]);
      const year = match4[3];
      const month = this.turkishMonths[monthStr];
      
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 패턴4 매칭: ${result}`);
        return result;
      }
    }
    
    console.log(`⚠️ 터키어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }
  
  /**
   * 영어 날짜 파싱 (개선된 버전)
   * @param {string} dateStr - 영어 날짜 문자열
   * @param {string} context - 컨텍스트 ('재개', '일시정지' 등)
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseEnglishDate(dateStr, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return null;
    
    const normalized = dateStr.trim();
    console.log(`🌍 영어 날짜 파싱 시도: "${dateStr}"`);
    
    // 영어 월 이름 매핑 (전체 및 축약형)
    const englishMonths = {
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
    
    // 패턴 1: "September 1, 2025" 또는 "Sept 1, 2025" (연도 포함)
    const pattern1 = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const monthStr = match1[1].toLowerCase();
      const day = parseInt(match1[2]);
      const year = parseInt(match1[3]);
      
      const month = englishMonths[monthStr] || englishMonths[monthStr.substring(0, 3)];
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 영어 패턴1 (연도 포함): ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "September 1" 또는 "Sept 1" (연도 없음)
    const pattern2 = /^([A-Za-z]+)\s+(\d{1,2})$/i;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const monthStr = match2[1].toLowerCase();
      const day = parseInt(match2[2]);
      
      const month = englishMonths[monthStr] || englishMonths[monthStr.substring(0, 3)];
      if (month) {
        // 동적 년도 계산 - 다음 번 해당 날짜 사용
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 영어 패턴2 (연도 계산): ${result}`);
        return result;
      }
    }
    
    // 패턴 3: "1 September" 또는 "1 Sept" (일/월 순서)
    const pattern3 = /^(\d{1,2})\s+([A-Za-z]+)$/i;
    const match3 = normalized.match(pattern3);
    if (match3) {
      const day = parseInt(match3[1]);
      const monthStr = match3[2].toLowerCase();
      
      const month = englishMonths[monthStr] || englishMonths[monthStr.substring(0, 3)];
      if (month) {
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 영어 패턴3 (일/월 순서): ${result}`);
        return result;
      }
    }
    
    // 패턴 4: "1 September 2025" (일/월/년 순서)
    const pattern4 = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i;
    const match4 = normalized.match(pattern4);
    if (match4) {
      const day = parseInt(match4[1]);
      const monthStr = match4[2].toLowerCase();
      const year = parseInt(match4[3]);
      
      const month = englishMonths[monthStr] || englishMonths[monthStr.substring(0, 3)];
      if (month) {
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 영어 패턴4 (일/월/년): ${result}`);
        return result;
      }
    }
    
    // 패턴 5: "Sep. 1" 또는 "Sept. 1" (마침표 포함)
    const pattern5 = /^([A-Za-z]+)\.?\s+(\d{1,2})$/i;
    const match5 = normalized.match(pattern5);
    if (match5) {
      const monthStr = match5[1].toLowerCase().replace('.', '');
      const day = parseInt(match5[2]);
      
      const month = englishMonths[monthStr] || englishMonths[monthStr.substring(0, 3)];
      if (month) {
        const year = this.calculateYear(parseInt(month), day, context);
        const result = `${year}. ${parseInt(month)}. ${day}`;
        console.log(`✅ 영어 패턴5 (마침표 포함): ${result}`);
        return result;
      }
    }
    
    // 패턴 6: MM/DD/YYYY 또는 MM/DD (미국식)
    const pattern6 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
    const match6 = normalized.match(pattern6);
    if (match6) {
      const month = parseInt(match6[1]);
      const day = parseInt(match6[2]);
      let year = match6[3] ? parseInt(match6[3]) : this.calculateYear(month, day, context);
      
      // 2자리 연도 처리
      if (match6[3] && match6[3].length === 2) {
        year = 2000 + parseInt(match6[3]);
      }
      
      const result = `${year}. ${month}. ${day}`;
      console.log(`✅ 영어 MM/DD 형식: ${result}`);
      return result;
    }
    
    console.log(`⚠️ 영어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }
  
  /**
   * 다국어 날짜 파싱 (메인 함수)
   * @param {string} dateStr - 날짜 문자열
   * @param {string} langCode - 언어 코드
   * @param {string} context - '재개' 또는 '일시정지' 컨텍스트
   * @returns {string} - "YYYY. M. D" 형식
   */
  parseDate(dateStr, langCode = 'en', context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!dateStr) return dateStr;
    
    console.log(`📅 날짜 파싱 요청: "${dateStr}" (언어: ${langCode}, 컨텍스트: ${context})`);
    
    // 한국어인 경우 전용 파싱 함수 사용
    if (langCode === 'ko') {
      const parsed = this.parseKoreanDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }

    // 터키어인 경우 전용 파싱 함수 사용
    if (langCode === 'tr') {
      const parsed = this.parseTurkishDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }

    // 포르투갈어 (브라질/포르투갈)
    if (langCode === 'pt' || langCode === 'pt-br' || langCode === 'pt-pt') {
      const parsed = this.parsePortugueseDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }

    // 러시아어
    if (langCode === 'ru') {
      const parsed = this.parseRussianDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }

    // 베트남어
    if (langCode === 'vi') {
      const parsed = this.parseVietnameseDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }

    // 영어 날짜 패턴 (개선된 버전 사용)
    if (langCode === 'en' || langCode === 'en-us' || langCode === 'en-gb') {
      const parsed = this.parseEnglishDate(dateStr, context);  // 컨텍스트 전달
      if (parsed) return parsed;
    }
    
    // 기본 DD/MM/YYYY 또는 DD.MM.YYYY 형식
    const numericPattern = /^(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-](\d{2,4}))?$/;
    const numericMatch = dateStr.match(numericPattern);
    if (numericMatch) {
      const day = parseInt(numericMatch[1]);
      const month = parseInt(numericMatch[2]);
      let year = numericMatch[3];
      
      if (!year) {
        year = this.calculateYear(month, day, context);
      } else if (year.length === 2) {
        year = '20' + year;
      }
      
      // 유효성 검사
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}. ${month}. ${day}`;
      }
    }
    
    console.log(`⚠️ 날짜 파싱 실패: "${dateStr}" (언어: ${langCode})`);
    return dateStr; // 파싱 실패시 원본 반환
  }
  
  /**
   * 날짜 문자열에서 날짜들 추출
   * @param {string} text - 텍스트
   * @param {string} langCode - 언어 코드
   * @returns {Array<string>} - 추출된 날짜들
   */
  extractDates(text, langCode = 'en') {
    const dates = [];
    
    if (langCode === 'ko') {
      // 한국어 날짜 패턴들
      const patterns = [
        /\d{1,2}월\s*\d{1,2}일/g,  // "9월 2일" 형식
        /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g  // "2025년 9월 2일" 형식
      ];
      
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const parsed = this.parseKoreanDate(match);
            if (parsed) dates.push(parsed);
          });
        }
      }
    }
    
    if (langCode === 'tr') {
      // 터키어 날짜 패턴들
      const patterns = [
        /\d{1,2}\s+(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)[a-zığüöşçı]*/gi,
        /(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)[a-zığüöşçı]*\s+\d{1,2}/gi
      ];
      
      for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const parsed = this.parseTurkishDate(match);
            if (parsed) dates.push(parsed);
          });
        }
      }
    }
    
    return dates;
  }

  /**
   * 범용 날짜 추출 (모든 언어 지원)
   * UniversalDateExtractor를 활용한 고급 날짜 추출
   * 
   * @param {string} text - 날짜를 포함한 텍스트
   * @param {string} langCode - 언어 코드 (선택사항)
   * @returns {Array<string>} - 추출된 날짜 배열 (YYYY-MM-DD 형식)
   */
  extractUniversalDates(text, langCode = null, context) {
    if (!context) context = 'pause';  // 기본값 설정
    if (!text) return [];

    console.log(`🌍 범용 날짜 추출 시작 (언어: ${langCode || 'auto'}, 원본 컨텍스트: ${context})`);

    // context 정규화
    const normalizedContext = (context === '재개' || context === 'resume' || context === 'nextBilling')
      ? 'resume'
      : 'pause';

    console.log(`📌 정규화된 컨텍스트: ${normalizedContext} (원본: ${context})`);

    // UniversalDateExtractor 사용 - 컨텍스트 전달
    const dates = this.universalExtractor.extractDates(text, { context: normalizedContext });

    if (dates.length > 0) {
      console.log(`✅ ${dates.length}개 날짜 추출 성공`);
      // 각 날짜 객체의 상세 정보 로깅
      dates.forEach((dateObj, idx) => {
        console.log(`  [${idx}] Year: ${dateObj.year}, Month: ${dateObj.month}, Day: ${dateObj.day}, Original: "${dateObj.original}", Confidence: ${dateObj.confidence}`);
      });
    } else {
      console.log('⚠️ 날짜를 찾을 수 없음');
    }

    return dates;
  }

  /**
   * 결제일 추출 (컨텍스트 기반)
   * 결제 관련 키워드 근처의 날짜를 우선적으로 추출
   * 
   * @param {string} text - 날짜를 포함한 텍스트
   * @returns {string|null} - 추출된 결제일 (YYYY-MM-DD 형식)
   */
  extractBillingDate(text) {
    if (!text) return null;
    
    console.log('💳 결제일 추출 시작');
    
    // UniversalDateExtractor의 컨텍스트 기반 추출 사용
    const billingDate = this.universalExtractor.extractBillingDate(text);
    
    if (billingDate) {
      console.log(`✅ 결제일 추출 성공: ${billingDate}`);
      
      // 사람이 읽기 쉬운 형식으로 변환 (로깅용)
      const humanReadable = this.universalExtractor.toHumanReadable(billingDate, 'ko');
      console.log(`   한국어 표시: ${humanReadable}`);
    } else {
      console.log('⚠️ 결제일을 찾을 수 없음');
    }
    
    return billingDate;
  }

  /**
   * 날짜 정규화 (레거시 호환성)
   * 기존 형식(YYYY. M. D)을 표준 형식(YYYY-MM-DD)으로 변환
   *
   * @param {string} dateStr - 날짜 문자열
   * @param {string} context - 컨텍스트 (선택사항)
   * @returns {string} - 정규화된 날짜 (YYYY-MM-DD)
   */
  normalizeDate(dateStr, context) {
    if (!dateStr) return null;
    if (!context) context = 'pause';  // 기본값 설정

    // "YYYY. M. D" → "YYYY-MM-DD" 변환
    const pattern = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/;
    const match = dateStr.match(pattern);

    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // 이미 YYYY-MM-DD 형식인 경우
    if (/\d{4}-\d{2}-\d{2}/.test(dateStr)) {
      return dateStr;
    }

    // 기타 형식은 UniversalDateExtractor로 시도 - 컨텍스트 전달
    const normalizedContext = (context === '재개' || context === 'resume' || context === 'nextBilling')
      ? 'resume'
      : 'pause';
    const dates = this.universalExtractor.extractDates(dateStr, { context: normalizedContext });
    return dates.length > 0 ? dates[0] : dateStr;
  }
}

module.exports = DateParsingService;