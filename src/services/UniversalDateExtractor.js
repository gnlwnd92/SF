/**
 * UniversalDateExtractor - 다국어 날짜 추출 범용 서비스
 * 
 * 모든 언어와 날짜 형식을 지원하며 새로운 패턴에도 자동 적응 가능
 * Context-aware 추출로 날짜 타입(재개/일시정지/결제) 자동 추론
 */

const chalk = require('chalk');

class UniversalDateExtractor {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    
    // 다국어 월 이름 매핑 (확장 가능)
    this.monthMappings = {
      // 영어
      'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
      'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6,
      'july': 7, 'jul': 7, 'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 'sept': 9,
      'october': 10, 'oct': 10, 'november': 11, 'nov': 11, 'december': 12, 'dec': 12,
      
      // 포르투갈어
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6,
      'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
      
      // 스페인어
      'enero': 1, 'febrero': 2, 'marzo': 3, 'mayo': 5, 'junio': 6,
      'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
      
      // 프랑스어
      'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4, 'mai': 5, 'juin': 6,
      'juillet': 7, 'août': 8, 'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12,
      
      // 독일어
      'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6,
      'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12,
      
      // 이탈리아어
      'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5, 'giugno': 6,
      'luglio': 7, 'agosto': 8, 'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12,
      
      // 러시아어 (전체 형태 + 소유격 + 축약형)
      'январь': 1, 'января': 1, 'янв': 1,
      'февраль': 2, 'февраля': 2, 'фев': 2, 'февр': 2,  // февр 추가 (YouTube UI에서 사용)
      'март': 3, 'марта': 3, 'мар': 3,
      'апрель': 4, 'апреля': 4, 'апр': 4,
      'май': 5, 'мая': 5,
      'июнь': 6, 'июня': 6, 'июн': 6,
      'июль': 7, 'июля': 7, 'июл': 7,
      'август': 8, 'августа': 8, 'авг': 8,
      'сентябрь': 9, 'сентября': 9, 'сен': 9, 'сент': 9,
      'октябрь': 10, 'октября': 10, 'окт': 10,
      'ноябрь': 11, 'ноября': 11, 'ноя': 11, 'нояб': 11,
      'декабрь': 12, 'декабря': 12, 'дек': 12,
      
      // 일본어 (숫자 + 月)
      '1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5, '6月': 6,
      '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11, '12月': 12
    };
    
    // 날짜 패턴 정의 (우선순위 순)
    this.patterns = [
      // ISO 형식: 2025-11-02
      {
        regex: /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/g,
        extract: (match) => ({
          year: parseInt(match[1]),
          month: parseInt(match[2]),
          day: parseInt(match[3]),
          original: match[0],
          confidence: 1.0
        })
      },
      
      // DD/MM/YYYY 또는 MM/DD/YYYY (컨텍스트 기반 판별)
      {
        regex: /(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/g,
        extract: function(match) {
          const first = parseInt(match[1]);
          const second = parseInt(match[2]);
          const year = parseInt(match[3]);
          
          // 월 범위로 판별 (13 이상은 일)
          if (first > 12) {
            // DD/MM/YYYY 형식
            return {
              day: first,
              month: second,
              year: year,
              original: match[0],
              confidence: 1.0
            };
          } else if (second > 12) {
            // MM/DD/YYYY 형식
            return {
              month: first,
              day: second,
              year: year,
              original: match[0],
              confidence: 1.0
            };
          } else {
            // 둘 다 12 이하인 경우 - 컨텍스트로 판단 (기본값: 유럽식)
            // 미국 영어 키워드가 있으면 미국식으로 처리
            const text = match.input || '';
            const isAmerican = /billing|subscription|membership/i.test(text) && 
                              !/faturação|subscrição|abonnement/i.test(text);
            
            if (isAmerican) {
              return {
                month: first,
                day: second,
                year: year,
                original: match[0],
                confidence: 0.8,
                isAmerican: true
              };
            } else {
              return {
                day: first,
                month: second,
                year: year,
                original: match[0],
                confidence: 0.9
              };
            }
          }
        }
      },
      
      // 월 이름 + 일 + 연도: "November 2, 2025" 또는 "Nov 2, 2025"
      {
        regex: /([A-Za-zА-Яа-я]+)\s+(\d{1,2}),?\s*(\d{4})?/gi,
        extract: (match) => {
          const monthStr = match[1].toLowerCase();
          const month = this.monthMappings[monthStr];
          if (!month) return null;
          
          return {
            month: month,
            day: parseInt(match[2]),
            year: match[3] ? parseInt(match[3]) : null,
            original: match[0],
            confidence: match[3] ? 0.95 : 0.7
          };
        }
      },
      
      // 일 + 월 이름 + 연도: "2 November 2025", "2 de noviembre de 2025", "2. November 2025", "2 Nov"
      {
        regex: /(\d{1,2})\.?\s+(?:de\s+)?([A-Za-zА-Яа-я]+)(?:\s+(?:de\s+)?(\d{4}))?/gi,
        extract: (match) => {
          const monthStr = match[2].toLowerCase();
          const month = this.monthMappings[monthStr];
          if (!month) return null;

          return {
            day: parseInt(match[1]),
            month: month,
            year: match[3] ? parseInt(match[3]) : null,
            original: match[0],
            confidence: match[3] ? 0.95 : 0.7
          };
        }
      },
      
      // 한국어: 2025년 11월 2일
      {
        regex: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g,
        extract: (match) => ({
          year: parseInt(match[1]),
          month: parseInt(match[2]),
          day: parseInt(match[3]),
          original: match[0],
          confidence: 1.0
        })
      },
      
      // 중국어/일본어: 2025年11月2日
      {
        regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
        extract: (match) => ({
          year: parseInt(match[1]),
          month: parseInt(match[2]),
          day: parseInt(match[3]),
          original: match[0],
          confidence: 1.0
        })
      },
      
      // 태국어 숫자: 2/11/2568 (불교력)
      {
        regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
        extract: (match) => {
          const year = parseInt(match[3]);
          // 불교력 체크 (2500년대)
          const adjustedYear = year > 2500 ? year - 543 : year;
          
          return {
            day: parseInt(match[1]),
            month: parseInt(match[2]),
            year: adjustedYear,
            original: match[0],
            confidence: 0.85
          };
        }
      },
      
      // 베트남어: "9 thg 10" 또는 "9 thg 10, 2025" 또는 "Ngày 9 tháng 10"
      {
        regex: /(?:ngày\s+)?(\d{1,2})\s+(?:thg|tháng)\s+(\d{1,2})(?:,?\s+(?:năm\s+)?(\d{4}))?/gi,
        extract: (match) => {
          return {
            day: parseInt(match[1]),
            month: parseInt(match[2]),
            year: match[3] ? parseInt(match[3]) : null,
            original: match[0],
            confidence: match[3] ? 0.95 : 0.8
          };
        }
      }
    ];
    
    // Context 키워드로 날짜 타입 추론
    this.contextKeywords = {
      // ✅ 중요: pause를 resume보다 먼저 체크 (순서 중요!)
      pause: [
        'pause', 'pauses', 'paused', 'pausing',  // 영어 동사 변형
        'pausar', 'pausada', 'pausa', 'приостановить',
        '일시중지', '일시정지', '暂停', '一時停止', 'หยุดชั่วคราว',
        'tạm dừng', 'tạm ngừng' // 베트남어
      ],
      resume: [
        'resume', 'resumes', 'resumed', 'resuming',  // 영어 동사 변형
        'retomada', 'retomar', 'reprendre', 'riprendi', 'возобновить',
        '재개', '恢复', '再開', 'ดำเนินการต่อ', 'melanjutkan',
        'tiếp tục', 'khôi phục' // 베트남어
      ],
      billing: [
        'billing', 'faturação', 'facturación', 'facturation', 'fatturazione',
        '결제', '청구', '付款', '支払い', 'การเรียกเก็บเงิน',
        'thanh toán', 'hóa đơn' // 베트남어
      ],
      next: [
        'next', 'próximo', 'próxima', 'prochain', 'prossimo', 'следующий',
        '다음', '下一个', '次の', 'ถัดไป',
        'tiếp theo', 'kế tiếp' // 베트남어
      ]
    };
  }
  
  /**
   * 텍스트에서 모든 가능한 날짜 추출
   */
  extractDates(text, options = {}) {
    if (!text) return [];

    const dates = [];
    const processedText = text.toLowerCase();
    const context = options.context || 'pause'; // 컨텍스트 추가

    console.log(`🔍 [UniversalDateExtractor] Context: ${context}, 텍스트 길이: ${text.length}`);

    // 모든 패턴 시도
    for (let patternIndex = 0; patternIndex < this.patterns.length; patternIndex++) {
      const pattern = this.patterns[patternIndex];
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      let matchCount = 0;

      while ((match = regex.exec(text)) !== null) {
        matchCount++;
        const extracted = pattern.extract.call(this, match);
        if (extracted) {
          console.log(`  ✓ [패턴 ${patternIndex}] 매칭: "${match[0]}" → Year: ${extracted.year}, Month: ${extracted.month}, Day: ${extracted.day}`);

          // 연도 추론 (없는 경우) - 컨텍스트 전달
          if (!extracted.year) {
            const inferredYear = this.inferYear(extracted.month, extracted.day, context);
            console.log(`    → 연도 추론: ${inferredYear} (Context: ${context})`);
            extracted.year = inferredYear;
          }

          // Context 기반 타입 추론
          extracted.type = this.inferDateType(text, match.index);

          // 유효성 검증
          if (this.isValidDate(extracted)) {
            console.log(`    → 유효한 날짜 추가: ${extracted.year}-${extracted.month}-${extracted.day}`);
            dates.push(extracted);
          } else {
            console.log(`    → 유효하지 않은 날짜, 무시함`);
          }
        }
      }

      if (matchCount > 0) {
        console.log(`  [패턴 ${patternIndex}] 총 ${matchCount}개 매칭`);
      }
    }
    
    // 중복 제거 및 신뢰도 순 정렬
    const uniqueDates = this.deduplicateDates(dates);
    uniqueDates.sort((a, b) => b.confidence - a.confidence);

    console.log(`📊 [UniversalDateExtractor] 중복 제거 후 ${uniqueDates.length}개 날짜`);
    if (uniqueDates.length > 0) {
      console.log(`   최종 선택 (신뢰도 순):`);
      uniqueDates.forEach((date, idx) => {
        const formatted = this.formatDate(date);
        console.log(`   [${idx}] ${formatted} (신뢰도: ${date.confidence}, 타입: ${date.type}, 원본: "${date.original}")`);
      });
    }

    if (this.debugMode) {
      console.log(chalk.cyan('📅 추출된 날짜들:'));
      uniqueDates.forEach(date => {
        console.log(chalk.gray(`  - ${this.formatDate(date)} (신뢰도: ${date.confidence}, 타입: ${date.type})`));
      });
    }

    return uniqueDates;
  }
  
  /**
   * 특정 타입의 날짜만 추출
   */
  extractDateByType(text, type) {
    const allDates = this.extractDates(text);
    
    // 타입별 필터링
    const typedDates = allDates.filter(date => date.type === type);
    
    // 타입 매칭 날짜가 없으면 가장 신뢰도 높은 날짜 반환
    if (typedDates.length === 0 && allDates.length > 0) {
      return allDates[0];
    }
    
    return typedDates[0] || null;
  }
  
  /**
   * 재개 날짜 추출 (특화)
   */
  extractResumeDate(text) {
    return this.extractDateByType(text, 'resume');
  }
  
  /**
   * 일시정지 날짜 추출 (특화)
   */
  extractPauseDate(text) {
    return this.extractDateByType(text, 'pause');
  }
  
  /**
   * 다음 결제일 추출 (특화)
   */
  extractBillingDate(text) {
    return this.extractDateByType(text, 'billing');
  }
  
  /**
   * Context 기반 날짜 타입 추론
   */
  inferDateType(text, position) {
    // ✅ 수정: 날짜 **이전** 텍스트에서 **현재 줄만** 추출
    // 이유: "Nov 28" 이전 50자에 이전 줄의 "pauses on"이 포함되면 잘못된 타입 감지됨
    const contextStart = Math.max(0, position - 100);  // 충분히 긴 범위 추출
    const contextEnd = position;
    let context = text.substring(contextStart, contextEnd).toLowerCase();

    // 줄바꿈(\n) 기준으로 마지막 줄만 추출 (현재 줄)
    const lastNewlineIndex = context.lastIndexOf('\n');
    if (lastNewlineIndex !== -1) {
      context = context.substring(lastNewlineIndex + 1);  // 마지막 줄바꿈 이후만
    }

    console.log(`🔍 [inferDateType] Position: ${position}, CurrentLine: "${context}"`);

    // 키워드 매칭으로 타입 결정
    for (const [type, keywords] of Object.entries(this.contextKeywords)) {
      const matchedKeyword = keywords.find(keyword => context.includes(keyword));
      if (matchedKeyword) {
        console.log(`  ✓ 타입 감지: ${type} (키워드: "${matchedKeyword}")`);
        return type;
      }
    }

    console.log(`  ? 타입 감지 실패 - unknown 반환`);
    return 'unknown';
  }
  
  /**
   * 연도 추론 (현재 날짜 기반 + 컨텍스트 고려)
   * @param {number} month - 월
   * @param {number} day - 일
   * @param {string} context - 'resume' 또는 'pause' 컨텍스트
   */
  inferYear(month, day, context = 'pause') {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    const inputDate = month * 100 + day;
    const todayDate = currentMonth * 100 + currentDay;

    // Resume 컨텍스트: 오늘 날짜는 올해로 처리
    if (context === 'resume' || context === 'nextBilling' || context === '재개') {
      // 오늘 날짜인 경우 = 올해
      if (inputDate === todayDate) {
        return currentYear;
      }
      // 과거 날짜 = 내년
      if (inputDate < todayDate) {
        return currentYear + 1;
      }
      // 미래 날짜 = 올해
      return currentYear;
    }

    // Pause 컨텍스트 (기존 로직 유지): 오늘 날짜는 내년으로 처리
    if (month < currentMonth || (month === currentMonth && day <= currentDay)) {
      return currentYear + 1;
    }

    return currentYear;
  }
  
  /**
   * 날짜 유효성 검증
   */
  isValidDate(dateObj) {
    if (!dateObj.year || !dateObj.month || !dateObj.day) {
      return false;
    }
    
    // 월 범위 체크
    if (dateObj.month < 1 || dateObj.month > 12) {
      return false;
    }
    
    // 일 범위 체크
    const daysInMonth = new Date(dateObj.year, dateObj.month, 0).getDate();
    if (dateObj.day < 1 || dateObj.day > daysInMonth) {
      return false;
    }
    
    // 연도 범위 체크 (현재 연도 -1 ~ +5)
    const currentYear = new Date().getFullYear();
    if (dateObj.year < currentYear - 1 || dateObj.year > currentYear + 5) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 중복 날짜 제거
   */
  deduplicateDates(dates) {
    const seen = new Set();
    return dates.filter(date => {
      const key = `${date.year}-${date.month}-${date.day}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  /**
   * 날짜 포맷팅
   */
  formatDate(dateObj, format = 'YYYY-MM-DD') {
    if (!dateObj) return null;
    
    const year = dateObj.year;
    const month = String(dateObj.month).padStart(2, '0');
    const day = String(dateObj.day).padStart(2, '0');
    
    switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`;
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      case 'ISO':
        return new Date(year, dateObj.month - 1, dateObj.day).toISOString();
      default:
        return `${year}-${month}-${day}`;
    }
  }
  
  /**
   * 날짜 객체를 JavaScript Date로 변환
   */
  toDate(dateObj) {
    if (!dateObj) return null;
    return new Date(dateObj.year, dateObj.month - 1, dateObj.day);
  }
  
  /**
   * 새로운 날짜 패턴 학습 (동적 확장)
   */
  learnPattern(text, expectedDate) {
    // 텍스트에서 날짜와 일치하는 패턴 찾기
    const { year, month, day } = expectedDate;
    
    // 패턴 후보 생성
    const candidates = [
      `${year}.*${month}.*${day}`,
      `${day}.*${month}.*${year}`,
      `${month}.*${day}.*${year}`
    ];
    
    for (const candidate of candidates) {
      const regex = new RegExp(candidate, 'gi');
      if (regex.test(text)) {
        console.log(chalk.green(`✅ 새로운 패턴 학습: ${candidate}`));
        // 향후 구현: 학습된 패턴을 저장하고 재사용
        return true;
      }
    }
    
    return false;
  }
}

module.exports = UniversalDateExtractor;