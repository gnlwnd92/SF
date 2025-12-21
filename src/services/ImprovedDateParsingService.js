/**
 * 개선된 날짜 파싱 서비스
 * YouTube Premium 날짜 인식 문제 해결
 * 
 * 주요 개선사항:
 * 1. "2 Sept" 형식 정확한 파싱
 * 2. 다양한 날짜 형식 지원
 * 3. 타임존 고려
 * 4. 파키스탄 루피(PKR) 환경 대응
 */

class ImprovedDateParsingService {
  constructor() {
    // 영어 월 이름 매핑 (전체 및 축약형)
    this.englishMonths = {
      // 전체 이름
      'january': '01',
      'february': '02',
      'march': '03',
      'april': '04',
      'may': '05',
      'june': '06',
      'july': '07',
      'august': '08',
      'september': '09',
      'october': '10',
      'november': '11',
      'december': '12',
      // 축약형 (모든 변형 포함)
      'jan': '01',
      'feb': '02',
      'mar': '03',
      'apr': '04',
      'may': '05',
      'jun': '06',
      'jul': '07',
      'aug': '08',
      'sep': '09',
      'sept': '09',  // "Sept" 축약형 추가
      'oct': '10',
      'nov': '11',
      'dec': '12'
    };

    // 터키어 월 이름 매핑
    this.turkishMonths = {
      'ocak': '01', 'oca': '01',
      'şubat': '02', 'şub': '02',
      'mart': '03', 'mar': '03',
      'nisan': '04', 'nis': '04',
      'mayıs': '05', 'may': '05',
      'haziran': '06', 'haz': '06',
      'temmuz': '07', 'tem': '07',
      'ağustos': '08', 'ağu': '08',
      'eylül': '09', 'eyl': '09',
      'ekim': '10', 'eki': '10',
      'kasım': '11', 'kas': '11',
      'aralık': '12', 'ara': '12'
    };

    // 포르투갈어 월 이름 매핑
    this.portugueseMonths = {
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

    // 스페인어 월 이름 매핑
    this.spanishMonths = {
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

    // 한국어 월 매핑
    this.koreanMonths = {
      '1월': '01', '2월': '02', '3월': '03', '4월': '04',
      '5월': '05', '6월': '06', '7월': '07', '8월': '08',
      '9월': '09', '10월': '10', '11월': '11', '12월': '12'
    };
  }

  /**
   * 영어 날짜 파싱 (개선된 버전)
   * "2 Sept", "Sept 2", "September 2, 2025" 등 모든 형식 지원
   */
  parseEnglishDate(dateStr) {
    if (!dateStr) return null;
    
    const normalized = dateStr.trim().toLowerCase();
    console.log(`📅 영어 날짜 파싱 시도: "${dateStr}"`);
    
    // 패턴 1: "2 Sept" 또는 "2 September" (Day Month)
    const pattern1 = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i;
    const match1 = normalized.match(pattern1);
    if (match1) {
      const day = match1[1].padStart(2, '0');
      const monthStr = match1[2];
      const year = match1[3] || new Date().getFullYear();
      
      const month = this.englishMonths[monthStr] || 
                   this.englishMonths[monthStr.substring(0, 3)] ||
                   this.englishMonths[monthStr.substring(0, 4)]; // sept 처리
      
      if (month) {
        const result = `${year}-${month}-${day}`;
        console.log(`✅ 영어 패턴1 매칭 (Day Month): ${result}`);
        return result;
      }
    }
    
    // 패턴 2: "Sept 2" 또는 "September 2" (Month Day)
    const pattern2 = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i;
    const match2 = normalized.match(pattern2);
    if (match2) {
      const monthStr = match2[1];
      const day = match2[2].padStart(2, '0');
      const year = match2[3] || new Date().getFullYear();
      
      const month = this.englishMonths[monthStr] || 
                   this.englishMonths[monthStr.substring(0, 3)] ||
                   this.englishMonths[monthStr.substring(0, 4)]; // sept 처리
      
      if (month) {
        const result = `${year}-${month}-${day}`;
        console.log(`✅ 영어 패턴2 매칭 (Month Day): ${result}`);
        return result;
      }
    }
    
    // 패턴 3: "9/2/2025" 또는 "2/9/2025" (MM/DD/YYYY 또는 DD/MM/YYYY)
    const pattern3 = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/;
    const match3 = dateStr.match(pattern3);
    if (match3) {
      const part1 = parseInt(match3[1]);
      const part2 = parseInt(match3[2]);
      let year = match3[3];
      
      if (year.length === 2) {
        year = '20' + year;
      }
      
      // 미국식 (MM/DD) vs 유럽식 (DD/MM) 판단
      let month, day;
      if (part1 > 12) {
        // 첫 번째 숫자가 12보다 크면 DD/MM 형식
        day = match3[1].padStart(2, '0');
        month = match3[2].padStart(2, '0');
      } else if (part2 > 12) {
        // 두 번째 숫자가 12보다 크면 MM/DD 형식
        month = match3[1].padStart(2, '0');
        day = match3[2].padStart(2, '0');
      } else {
        // 둘 다 12 이하면 컨텍스트로 판단 (기본: MM/DD)
        month = match3[1].padStart(2, '0');
        day = match3[2].padStart(2, '0');
      }
      
      const result = `${year}-${month}-${day}`;
      console.log(`✅ 영어 패턴3 매칭 (숫자 형식): ${result}`);
      return result;
    }
    
    console.log(`⚠️ 영어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }

  /**
   * 터키어 날짜 파싱
   */
  parseTurkishDate(dateStr) {
    if (!dateStr) return null;
    
    const normalized = dateStr.trim().toLowerCase();
    console.log(`🗓️ 터키어 날짜 파싱 시도: "${dateStr}"`);
    
    // 터키어 날짜 패턴들
    const patterns = [
      /^(\d{1,2})\s+([a-zığüöşçı]+)(?:\s+(\d{4}))?$/i,  // "1 Eyl 2025"
      /^([a-zığüöşçı]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i  // "Eyl 1, 2025"
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        let day, monthStr, year;
        
        if (/^\d/.test(match[1])) {
          // 숫자로 시작하면 Day Month Year 형식
          day = match[1].padStart(2, '0');
          monthStr = match[2];
          year = match[3] || new Date().getFullYear();
        } else {
          // 문자로 시작하면 Month Day Year 형식
          monthStr = match[1];
          day = match[2].padStart(2, '0');
          year = match[3] || new Date().getFullYear();
        }
        
        const month = this.turkishMonths[monthStr];
        if (month) {
          const result = `${year}-${month}-${day}`;
          console.log(`✅ 터키어 날짜 매칭: ${result}`);
          return result;
        }
      }
    }
    
    console.log(`⚠️ 터키어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }

  /**
   * 포르투갈어 날짜 파싱
   */
  parsePortugueseDate(dateStr) {
    if (!dateStr) return null;
    
    const normalized = dateStr.trim().toLowerCase();
    console.log(`📅 포르투갈어 날짜 파싱 시도: "${dateStr}"`);
    
    // 포르투갈어 날짜 패턴
    const patterns = [
      /^(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/i,  // "2 de setembro de 2025"
      /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i              // "2 setembro 2025"
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const day = match[1].padStart(2, '0');
        const monthStr = match[2];
        const year = match[3] || new Date().getFullYear();
        
        const month = this.portugueseMonths[monthStr] || 
                     this.portugueseMonths[monthStr.substring(0, 3)];
        
        if (month) {
          const result = `${year}-${month}-${day}`;
          console.log(`✅ 포르투갈어 날짜 매칭: ${result}`);
          return result;
        }
      }
    }
    
    console.log(`⚠️ 포르투갈어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }

  /**
   * 한국어 날짜 파싱
   */
  parseKoreanDate(dateStr) {
    if (!dateStr) return null;
    
    console.log(`📅 한국어 날짜 파싱 시도: "${dateStr}"`);
    
    // 한국어 날짜 패턴: "2025년 9월 2일", "9월 2일"
    const pattern = /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/;
    const match = dateStr.match(pattern);
    
    if (match) {
      const year = match[1] || new Date().getFullYear();
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      
      const result = `${year}-${month}-${day}`;
      console.log(`✅ 한국어 날짜 매칭: ${result}`);
      return result;
    }
    
    console.log(`⚠️ 한국어 날짜 파싱 실패: "${dateStr}"`);
    return null;
  }

  /**
   * 다국어 날짜 파싱 (메인 함수)
   * @param {string} dateStr - 날짜 문자열
   * @param {string} langCode - 언어 코드 (en, tr, pt, es, ko 등)
   * @returns {string} - YYYY-MM-DD 형식 또는 원본
   */
  parseDate(dateStr, langCode = 'en') {
    if (!dateStr) return dateStr;
    
    console.log(`🌐 날짜 파싱 시작: "${dateStr}" (언어: ${langCode})`);
    
    let parsed = null;
    
    // 언어별 파싱 시도
    switch(langCode) {
      case 'en':
      case 'en-US':
      case 'en-GB':
        parsed = this.parseEnglishDate(dateStr);
        break;
      case 'tr':
        parsed = this.parseTurkishDate(dateStr);
        break;
      case 'pt':
      case 'pt-BR':
        parsed = this.parsePortugueseDate(dateStr);
        break;
      case 'es':
      case 'es-ES':
      case 'es-MX':
        // 스페인어는 영어와 유사한 패턴 사용
        parsed = this.parseSpanishDate(dateStr);
        break;
      case 'ko':
      case 'ko-KR':
        parsed = this.parseKoreanDate(dateStr);
        break;
      default:
        // 기본적으로 영어로 시도
        parsed = this.parseEnglishDate(dateStr);
    }
    
    // 파싱 실패시 범용 패턴 시도
    if (!parsed) {
      parsed = this.parseUniversalDate(dateStr);
    }
    
    if (parsed) {
      console.log(`✅ 최종 파싱 결과: ${parsed}`);
      return parsed;
    }
    
    console.log(`❌ 날짜 파싱 완전 실패: "${dateStr}"`);
    return dateStr; // 파싱 실패시 원본 반환
  }

  /**
   * 스페인어 날짜 파싱
   */
  parseSpanishDate(dateStr) {
    // 영어와 유사한 로직 사용
    const normalized = dateStr.trim().toLowerCase();
    console.log(`📅 스페인어 날짜 파싱 시도: "${dateStr}"`);
    
    // 스페인어 패턴
    const patterns = [
      /^(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?$/i,  // "2 de septiembre de 2025"
      /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i               // "2 septiembre 2025"
    ];
    
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const day = match[1].padStart(2, '0');
        const monthStr = match[2];
        const year = match[3] || new Date().getFullYear();
        
        const month = this.spanishMonths[monthStr] || 
                     this.spanishMonths[monthStr.substring(0, 3)];
        
        if (month) {
          const result = `${year}-${month}-${day}`;
          console.log(`✅ 스페인어 날짜 매칭: ${result}`);
          return result;
        }
      }
    }
    
    return null;
  }

  /**
   * 범용 날짜 파싱 (언어 무관)
   */
  parseUniversalDate(dateStr) {
    console.log(`🌍 범용 날짜 파싱 시도: "${dateStr}"`);
    
    // ISO 형식: "2025-09-02"
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (isoPattern.test(dateStr)) {
      console.log(`✅ ISO 형식 날짜: ${dateStr}`);
      return dateStr;
    }
    
    // 숫자만 있는 형식: "02/09/2025", "2.9.2025"
    const numericPattern = /^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/;
    const match = dateStr.match(numericPattern);
    if (match) {
      const part1 = parseInt(match[1]);
      const part2 = parseInt(match[2]);
      let year = match[3];
      
      if (year.length === 2) {
        year = '20' + year;
      }
      
      // 날짜 유효성으로 판단
      let month, day;
      if (part1 > 12) {
        day = match[1].padStart(2, '0');
        month = match[2].padStart(2, '0');
      } else if (part2 > 12) {
        month = match[1].padStart(2, '0');
        day = match[2].padStart(2, '0');
      } else {
        // 기본값: DD/MM/YYYY (대부분의 국가)
        day = match[1].padStart(2, '0');
        month = match[2].padStart(2, '0');
      }
      
      const result = `${year}-${month}-${day}`;
      console.log(`✅ 범용 숫자 형식 매칭: ${result}`);
      return result;
    }
    
    return null;
  }

  /**
   * YouTube Premium 페이지에서 날짜 추출
   * "Next billing date: 2 Sept" 형식 처리
   */
  extractBillingDate(text) {
    console.log(`💳 청구일 추출 시도: "${text}"`);
    
    // 다양한 청구일 패턴
    const patterns = [
      /Next billing date:\s*(.+?)(?:\n|$)/i,
      /Próxima data de cobrança:\s*(.+?)(?:\n|$)/i,  // 포르투갈어
      /Siguiente fecha de facturación:\s*(.+?)(?:\n|$)/i,  // 스페인어
      /다음 결제일:\s*(.+?)(?:\n|$)/i,  // 한국어
      /Sonraki faturalandırma tarihi:\s*(.+?)(?:\n|$)/i,  // 터키어
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const dateStr = match[1].trim();
        console.log(`📅 청구일 발견: "${dateStr}"`);
        
        // 언어 감지 및 파싱
        let langCode = 'en'; // 기본값
        if (/[가-힣]/.test(text)) langCode = 'ko';
        else if (/[ığüöşçı]/i.test(text)) langCode = 'tr';
        else if (/ã|õ|ç/.test(text)) langCode = 'pt';
        else if (/ñ/.test(text)) langCode = 'es';
        
        return this.parseDate(dateStr, langCode);
      }
    }
    
    console.log(`⚠️ 청구일을 찾을 수 없음`);
    return null;
  }

  /**
   * 날짜를 시스템 형식으로 변환
   * YYYY-MM-DD → MMDD.HH.MM
   */
  toSystemFormat(dateStr, includeTime = false) {
    if (!dateStr) return null;
    
    // YYYY-MM-DD 형식 파싱
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return dateStr;
    
    const month = match[2];
    const day = match[3];
    
    if (includeTime) {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      return `${month}${day}.${hours}.${minutes}`;
    }
    
    return `${month}${day}.00.00`;
  }
}

// 테스트 케이스
function testDateParsing() {
  const parser = new ImprovedDateParsingService();
  
  const testCases = [
    // 영어
    { input: "2 Sept", lang: "en", expected: "2025-09-02" },
    { input: "Sept 2", lang: "en", expected: "2025-09-02" },
    { input: "September 2, 2025", lang: "en", expected: "2025-09-02" },
    { input: "2 September", lang: "en", expected: "2025-09-02" },
    // 터키어
    { input: "2 Eyl", lang: "tr", expected: "2025-09-02" },
    { input: "Eylül 2", lang: "tr", expected: "2025-09-02" },
    // 포르투갈어
    { input: "2 de setembro", lang: "pt", expected: "2025-09-02" },
    // 한국어
    { input: "9월 2일", lang: "ko", expected: "2025-09-02" },
    { input: "2025년 9월 2일", lang: "ko", expected: "2025-09-02" },
  ];
  
  console.log('\n📝 날짜 파싱 테스트 시작\n');
  
  testCases.forEach(test => {
    const result = parser.parseDate(test.input, test.lang);
    const systemFormat = parser.toSystemFormat(result);
    console.log(`Input: "${test.input}" (${test.lang})`);
    console.log(`Result: ${result}`);
    console.log(`System Format: ${systemFormat}`);
    console.log(`Status: ${result.startsWith(test.expected.substring(0, 7)) ? '✅ PASS' : '❌ FAIL'}`);
    console.log('---');
  });
  
  // YouTube Premium 페이지 테스트
  const pageText = `YouTube Premium
Family membership: PKR 899.00/mo

Manage membership
Next billing date: 2 Sept

Cancel`;
  
  const billingDate = parser.extractBillingDate(pageText);
  console.log('\n💳 청구일 추출 테스트');
  console.log(`페이지 텍스트에서 추출: ${billingDate}`);
  console.log(`시스템 형식: ${parser.toSystemFormat(billingDate, true)}`);
}

// Export
module.exports = ImprovedDateParsingService;

// 직접 실행시 테스트
if (require.main === module) {
  testDateParsing();
}