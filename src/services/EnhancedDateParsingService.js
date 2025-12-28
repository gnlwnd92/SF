/**
 * EnhancedDateParsingService - 날짜 파싱 서비스 (디버깅 강화)
 * 
 * 다국어 날짜 형식을 파싱하고 표준 형식으로 변환
 * 상세한 디버깅 정보를 포함하여 파싱 실패 원인 추적
 */

const chalk = require('chalk');
const UniversalDateExtractor = require('./UniversalDateExtractor');

class EnhancedDateParsingService {
  constructor(logger = console) {
    this.logger = logger;

    // [v2.12] 디버그 모드 플래그 - 환경변수로 제어
    // DEBUG_DATE_PARSING=true 로 설정하면 상세 로그 출력
    this.debugEnabled = process.env.DEBUG_DATE_PARSING === 'true';

    // UniversalDateExtractor 초기화
    this.universalExtractor = new UniversalDateExtractor({ logger });
    
    // 월 이름 매핑 (각 언어별)
    this.monthMappings = {
      // 한국어
      ko: {
        '1월': 1, '2월': 2, '3월': 3, '4월': 4, '5월': 5, '6월': 6,
        '7월': 7, '8월': 8, '9월': 9, '10월': 10, '11월': 11, '12월': 12
      },
      // 영어
      en: {
        'January': 1, 'Jan': 1, 'February': 2, 'Feb': 2, 'March': 3, 'Mar': 3,
        'April': 4, 'Apr': 4, 'May': 5, 'June': 6, 'Jun': 6,
        'July': 7, 'Jul': 7, 'August': 8, 'Aug': 8, 'September': 9, 'Sep': 9, 'Sept': 9,
        'October': 10, 'Oct': 10, 'November': 11, 'Nov': 11, 'December': 12, 'Dec': 12
      },
      // 터키어
      tr: {
        'Ocak': 1, 'Oca': 1, 'Şubat': 2, 'Şub': 2, 'Mart': 3, 'Mar': 3,
        'Nisan': 4, 'Nis': 4, 'Mayıs': 5, 'May': 5, 'Haziran': 6, 'Haz': 6,
        'Temmuz': 7, 'Tem': 7, 'Ağustos': 8, 'Ağu': 8, 'Eylül': 9, 'Eyl': 9,
        'Ekim': 10, 'Eki': 10, 'Kasım': 11, 'Kas': 11, 'Aralık': 12, 'Ara': 12
      },
      // 스페인어
      es: {
        'enero': 1, 'ene': 1, 'febrero': 2, 'feb': 2, 'marzo': 3, 'mar': 3,
        'abril': 4, 'abr': 4, 'mayo': 5, 'may': 5, 'junio': 6, 'jun': 6,
        'julio': 7, 'jul': 7, 'agosto': 8, 'ago': 8, 'septiembre': 9, 'sep': 9,
        'octubre': 10, 'oct': 10, 'noviembre': 11, 'nov': 11, 'diciembre': 12, 'dic': 12
      },
      // 포르투갈어
      pt: {
        'janeiro': 1, 'jan': 1, 'fevereiro': 2, 'fev': 2, 'março': 3, 'mar': 3,
        'abril': 4, 'abr': 4, 'maio': 5, 'mai': 5, 'junho': 6, 'jun': 6,
        'julho': 7, 'jul': 7, 'agosto': 8, 'ago': 8, 'setembro': 9, 'set': 9,
        'outubro': 10, 'out': 10, 'novembro': 11, 'nov': 11, 'dezembro': 12, 'dez': 12
      },
      // 독일어
      de: {
        'Januar': 1, 'Jan': 1, 'Februar': 2, 'Feb': 2, 'März': 3, 'Mär': 3,
        'April': 4, 'Apr': 4, 'Mai': 5, 'Juni': 6, 'Jun': 6,
        'Juli': 7, 'Jul': 7, 'August': 8, 'Aug': 8, 'September': 9, 'Sep': 9,
        'Oktober': 10, 'Okt': 10, 'November': 11, 'Nov': 11, 'Dezember': 12, 'Dez': 12
      },
      // 프랑스어
      fr: {
        'janvier': 1, 'jan': 1, 'février': 2, 'fév': 2, 'mars': 3, 'mar': 3,
        'avril': 4, 'avr': 4, 'mai': 5, 'juin': 6, 'jun': 6,
        'juillet': 7, 'juil': 7, 'août': 8, 'aoû': 8, 'septembre': 9, 'sep': 9,
        'octobre': 10, 'oct': 10, 'novembre': 11, 'nov': 11, 'décembre': 12, 'déc': 12
      },
      // 러시아어 (축약형 전체 포함: янв, февр, мар 등)
      ru: {
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
        'декабрь': 12, 'декабря': 12, 'дек': 12
      },
      // 이탈리아어
      it: {
        'gennaio': 1, 'gen': 1, 'febbraio': 2, 'feb': 2, 'marzo': 3, 'mar': 3,
        'aprile': 4, 'apr': 4, 'maggio': 5, 'mag': 5, 'giugno': 6, 'giu': 6,
        'luglio': 7, 'lug': 7, 'agosto': 8, 'ago': 8, 'settembre': 9, 'set': 9,
        'ottobre': 10, 'ott': 10, 'novembre': 11, 'nov': 11, 'dicembre': 12, 'dic': 12
      },
      // 일본어 - 숫자 기반
      ja: {
        '1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5, '6月': 6,
        '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11, '12月': 12
      },
      // 중국어 - 숫자 기반
      zh: {
        '1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5, '6月': 6,
        '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11, '12月': 12
      },
      // 베트남어 
      vi: {
        'tháng 1': 1, 'tháng 2': 2, 'tháng 3': 3, 'tháng 4': 4, 'tháng 5': 5, 'tháng 6': 6,
        'tháng 7': 7, 'tháng 8': 8, 'tháng 9': 9, 'tháng 10': 10, 'tháng 11': 11, 'tháng 12': 12
      },
      // 인도네시아어
      id: {
        'Januari': 1, 'Jan': 1, 'Februari': 2, 'Feb': 2, 'Maret': 3, 'Mar': 3,
        'April': 4, 'Apr': 4, 'Mei': 5, 'Juni': 6, 'Jun': 6,
        'Juli': 7, 'Jul': 7, 'Agustus': 8, 'Agu': 8, 'Agt': 8, 'September': 9, 'Sep': 9,
        'Oktober': 10, 'Okt': 10, 'November': 11, 'Nov': 11, 'Desember': 12, 'Des': 12
      },
      // 아랍어 - 숫자와 함께
      ar: {
        'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'مايو': 5, 'يونيو': 6,
        'يوليو': 7, 'أغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12
      },
      // 힌디어
      hi: {
        'जनवरी': 1, 'फरवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6,
        'जुलाई': 7, 'अगस्त': 8, 'सितंबर': 9, 'अक्टूबर': 10, 'नवंबर': 11, 'दिसंबर': 12
      }
    };
    
    // 날짜 형식 패턴 (우선순위 순)
    this.datePatterns = [
      // ISO 형식: 2025-11-03
      { regex: /(\d{4})-(\d{1,2})-(\d{1,2})/, type: 'ISO' },
      // 한국식 점: 2025. 11. 03.
      { regex: /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/, type: 'KoreanDot' },
      // 한국식: 2025년 11월 3일
      { regex: /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/, type: 'Korean' },
      // 한국식 짧은 형식: 10월 3일
      { regex: /(\d{1,2})월\s*(\d{1,2})일/, type: 'KoreanShort' },
      // 연도-슬래시: 2025/11/03
      { regex: /(\d{4})\/(\d{1,2})\/(\d{1,2})/, type: 'YearSlash' },
      // 스페인어: 16 de enero de 2025
      { regex: /(\d{1,2})\s+de\s+([A-Za-z]+)\s+de\s+(\d{4})/, type: 'Spanish' },
      // 러시아어 전체: 3 нояб. 2025 г.
      { regex: /(\d{1,2})\s+([а-яА-ЯёЁ]+)\.?\s+(\d{4})\s*г?\.?/, type: 'RussianFull' },
      // 러시아어 짧은 형식: 3 окт.
      { regex: /(\d{1,2})\s+([а-яА-ЯёЁ]+)\.?(?:\s|$)/, type: 'RussianShort' },
      // 러시아어: 16 января 2025
      { regex: /(\d{1,2})\s+([а-яА-ЯёЁ]+)\s+(\d{4})/, type: 'Russian' },
      // 미국식: Nov 3, 2025
      { regex: /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/, type: 'US' },
      // 미국식 짧은 형식: Oct 3
      { regex: /([A-Za-z]+)\s+(\d{1,2})$/, type: 'USShort' },
      // 유럽식: 3 Nov 2025
      { regex: /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/, type: 'EU' },
      // 터키어: 3 Kasım 2025
      { regex: /(\d{1,2})\s+([A-Za-zğıİşŞöÖçÇüÜ]+)\s+(\d{4})/, type: 'Turkish' },
      // 터키어 짧은 형식: 3 Eki (연도 없이) - 앞뒤 시작/끝 제약 제거
      { regex: /(\d{1,2})\s+([A-Za-zğıİşŞöÖçÇüÜ]+)(?:\s|$)/, type: 'TurkishShort' },
      // 프랑스어 짧은 형식: 3 oct.
      { regex: /(\d{1,2})\s+([a-zàâäéèêëïîôùûüÿœæç]+)\.?(?:\s|$)/i, type: 'FrenchShort' },
      // 프랑스어: 3 octobre 2025
      { regex: /(\d{1,2})\s+([a-zàâäéèêëïîôùûüÿœæç]+)\s+(\d{4})/i, type: 'French' },
      // 독일어 짧은 형식: 3. Okt.
      { regex: /(\d{1,2})\.\s*([A-Za-zäöüÄÖÜß]+)\.?(?:\s|$)/, type: 'GermanShort' },
      // 독일어: 3. Oktober 2025
      { regex: /(\d{1,2})\.\s*([A-Za-zäöüÄÖÜß]+)\s+(\d{4})/, type: 'German' },
      // 이탈리아어 짧은 형식: 3 ott
      { regex: /(\d{1,2})\s+([a-zàèéìòù]+)(?:\s|$)/i, type: 'ItalianShort' },
      // 이탈리아어: 3 ottobre 2025
      { regex: /(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})/i, type: 'Italian' },
      // 일본어 짧은 형식: 10月3日
      { regex: /(\d{1,2})月(\d{1,2})日/, type: 'JapaneseShort' },
      // 일본어: 2025年11月3日
      { regex: /(\d{4})年(\d{1,2})月(\d{1,2})日/, type: 'Japanese' },
      // 베트남어: Ngày 3 tháng 10
      { regex: /Ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/i, type: 'Vietnamese' },
      // 아랍어: 3 أكتوبر
      { regex: /(\d{1,2})\s+([\u0600-\u06FF]+)/, type: 'Arabic' },
      // 힌디어: 3 अक्टूबर
      { regex: /(\d{1,2})\s+([\u0900-\u097F]+)/, type: 'Hindi' },
      // 슬래시 전체 날짜: DD/MM/YYYY 또는 MM/DD/YYYY - 언어별로 처리
      { regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, type: 'Slash' },
      // 포르투갈어 짧은 형식: DD/MM (일/월) - Slash 패턴 후에 위치
      { regex: /(\d{1,2})\/(\d{1,2})(?!\/)/, type: 'PortugueseShort' },
      // 점: 3.11.2025
      { regex: /(\d{1,2})\.(\d{1,2})\.(\d{4})/, type: 'Dot' },
      // 하이픈: 03-11-2025
      { regex: /(\d{1,2})-(\d{1,2})-(\d{4})/, type: 'Hyphen' }
    ];
  }

  /**
   * 날짜 파싱 (상세 디버깅 포함)
   * @param {string} rawText - 날짜 텍스트
   * @param {string} language - 언어 코드
   * @param {string} context - 컨텍스트 ('재개', '일시정지', 'resume', 'pause', 'nextBilling')
   */
  parseDate(rawText, language = 'en', context = 'pause') {
    // [v2.12] 상세 디버그 로그는 환경변수로 제어
    if (this.debugEnabled) {
      console.log(chalk.cyan('\n📅 ==================== 날짜 파싱 시작 ===================='));
      console.log(chalk.yellow('🔍 원본 텍스트:'), rawText);
      console.log(chalk.yellow('🌐 언어:'), language);
      console.log(chalk.yellow('📌 컨텍스트:'), context);
    }

    if (!rawText) {
      if (this.debugEnabled) {
        console.log(chalk.red('❌ 입력 텍스트가 없음'));
        console.log(chalk.cyan('📅 ==================== 날짜 파싱 종료 ====================\n'));
      }
      return null;
    }

    // 텍스트 정리
    const cleanText = rawText.toString().trim();
    if (this.debugEnabled) {
      console.log(chalk.gray('🧹 정리된 텍스트:'), cleanText);
    }

    // 날짜가 아닌 텍스트 필터링
    if (this.isNotDateText(cleanText, language)) {
      if (this.debugEnabled) {
        console.log(chalk.yellow('⚠️ 날짜가 아닌 텍스트로 판단:'), cleanText);
        console.log(chalk.cyan('📅 ==================== 날짜 파싱 종료 ====================\n'));
      }
      return null;
    }

    // 각 패턴 시도
    for (const pattern of this.datePatterns) {
      if (this.debugEnabled) {
        console.log(chalk.blue(`\n🔄 패턴 시도: ${pattern.type}`));
        console.log(chalk.gray('   정규식:'), pattern.regex.toString());
      }

      const match = cleanText.match(pattern.regex);
      if (match) {
        if (this.debugEnabled) {
          console.log(chalk.green('✅ 패턴 매칭 성공!'));
          console.log(chalk.gray('   매칭된 부분:'), match[0]);
          console.log(chalk.gray('   매칭 그룹:'), match.slice(1));
        }

        const parsed = this.extractDateFromMatch(match, pattern.type, language, context);
        if (parsed) {
          // 성공 결과는 항상 출력 (간결하게)
          if (this.debugEnabled) {
            console.log(chalk.green('✅ 날짜 파싱 성공:'), parsed);
            console.log(chalk.cyan('📅 ==================== 날짜 파싱 종료 ====================\n'));
          }
          return parsed;
        } else {
          if (this.debugEnabled) {
            console.log(chalk.red('❌ 날짜 추출 실패'));
          }
        }
      } else {
        if (this.debugEnabled) {
          console.log(chalk.gray('   매칭 실패'));
        }
      }
    }

    // 모든 패턴 실패 - 경고는 항상 출력
    console.log(chalk.yellow(`⚠️ 날짜 파싱 실패: "${cleanText.substring(0, 30)}..."`));
    if (this.debugEnabled) {
      console.log(chalk.yellow('💡 디버깅 힌트:'));
      console.log('   1. 원본 텍스트에 날짜가 포함되어 있는지 확인');
      console.log('   2. 언어 설정이 올바른지 확인');
      console.log('   3. 새로운 날짜 형식이면 패턴 추가 필요');
      console.log(chalk.cyan('📅 ==================== 날짜 파싱 종료 ====================\n'));
    }

    return null;
  }

  /**
   * 매칭된 결과에서 날짜 추출
   */
  extractDateFromMatch(match, patternType, language, context = 'pause') {
    if (this.debugEnabled) {
      console.log(chalk.blue('📍 날짜 추출 시작'));
      console.log(chalk.gray('   패턴 타입:'), patternType);
      console.log(chalk.gray('   언어:'), language);
      console.log(chalk.gray('   컨텍스트:'), context);
    }
    
    let year, month, day;
    
    try {
      switch (patternType) {
        case 'ISO':
          // YYYY-MM-DD
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   ISO 형식: 년=${year}, 월=${month}, 일=${day}`));
          break;
          
        case 'KoreanDot':
          // YYYY. MM. DD.
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   한국 점 형식: 년=${year}, 월=${month}, 일=${day}`));
          break;
          
        case 'Korean':
          // YYYY년 MM월 DD일
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   한국 형식: 년=${year}, 월=${month}, 일=${day}`));
          break;
          
        case 'YearSlash':
          // YYYY/MM/DD
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   연도 슬래시 형식: 년=${year}, 월=${month}, 일=${day}`));
          break;
          
        case 'US':
          // Month DD, YYYY
          month = this.parseMonth(match[1], language);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   미국 형식: 월명="${match[1]}"→${month}, 일=${day}, 년=${year}`));
          break;
          
        case 'Spanish':
          // DD de Month de YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], language === 'es' ? language : 'es');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   스페인어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'PortugueseShort':
          // DD/MM (포르투갈어는 일/월 순서)
          // 포르투갈어와 브라질 포르투갈어 모두 DD/MM 형식 사용
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   포르투갈어 짧은 형식: 일=${day}, 월=${month}, 년=${year} (자동 추론)`));
          break;
          
        case 'RussianFull':
          // DD Month YYYY г.
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'ru');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   러시아어 전체 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'RussianShort':
          // DD Month. (연도 없음)
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'ru');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   러시아어 짧은 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;
          
        case 'Russian':
          // DD Month YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], language === 'ru' ? language : 'ru');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   러시아어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'EU':
        case 'Turkish':
          // DD Month YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], language);
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   유럽/터키 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'TurkishShort':
          // DD Month (연도 없음 - 현재 연도 사용)
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], language);
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   터키 짧은 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;
          
        case 'FrenchShort':
          // DD Month. (연도 없음)
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'fr');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   프랑스어 짧은 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;
          
        case 'French':
          // DD Month YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'fr');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   프랑스어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'GermanShort':
          // DD. Month.
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'de');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   독일어 짧은 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;

        case 'German':
          // DD. Month YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'de');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   독일어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'ItalianShort':
          // DD Month
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'it');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   이탈리아어 짧은 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;

        case 'Italian':
          // DD Month YYYY
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'it');
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   이탈리아어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year}`));
          break;
          
        case 'JapaneseShort':
          // MM月DD日
          month = parseInt(match[1]);
          day = parseInt(match[2]);
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   일본어 짧은 형식: 월=${month}, 일=${day}, 년=${year} (자동 추론)`));
          break;

        case 'Japanese':
          // YYYY年MM월DD일
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   일본어 형식: 년=${year}, 월=${month}, 일=${day}`));
          break;
          
        case 'Vietnamese':
          // Ngày DD tháng MM [năm YYYY]
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = match[3] ? parseInt(match[3]) : this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   베트남어 형식: 일=${day}, 월=${month}, 년=${year}${!match[3] ? ' (자동 추론)' : ''}`));
          break;

        case 'Arabic':
          // DD Month
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'ar');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   아랍어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;

        case 'Hindi':
          // DD Month
          day = parseInt(match[1]);
          month = this.parseMonth(match[2], 'hi');
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   힌디어 형식: 일=${day}, 월명="${match[2]}"→${month}, 년=${year} (자동 추론)`));
          break;
          
        case 'USShort':
          // Month DD (연도 없음)
          month = this.parseMonth(match[1], language);
          day = parseInt(match[2]);
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   미국 짧은 형식: 월명="${match[1]}"→${month}, 일=${day}, 년=${year} (자동 추론)`));
          break;

        case 'KoreanShort':
          // MM월 DD일 (연도 없음)
          month = parseInt(match[1]);
          day = parseInt(match[2]);
          year = this.calculateYearWithContext(month, day, context);
          if (this.debugEnabled) console.log(chalk.gray(`   한국 짧은 형식: 월=${month}, 일=${day}, 년=${year} (자동 추론)`));
          break;
          
        case 'Slash':
          // MM/DD/YYYY 또는 DD/MM/YYYY (언어에 따라 다름)
          // 포르투갈어, 스페인어, 유럽 언어들은 DD/MM/YYYY 사용
          if (language === 'en' || language === 'en-US') {
            // 미국식: MM/DD/YYYY
            month = parseInt(match[1]);
            day = parseInt(match[2]);
            if (this.debugEnabled) console.log(chalk.gray(`   미국식 슬래시 형식 (MM/DD/YYYY)`));
          } else {
            // 유럽/남미식: DD/MM/YYYY (포르투갈어, 스페인어 등)
            day = parseInt(match[1]);
            month = parseInt(match[2]);
            if (this.debugEnabled) console.log(chalk.gray(`   유럽/남미식 슬래시 형식 (DD/MM/YYYY)`));
          }
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   슬래시 형식: 일=${day}, 월=${month}, 년=${year}`));
          break;

        case 'Dot':
        case 'Hyphen':
          // DD.MM.YYYY 또는 DD-MM-YYYY
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = parseInt(match[3]);
          if (this.debugEnabled) console.log(chalk.gray(`   점/하이픈 형식: 일=${day}, 월=${month}, 년=${year}`));
          break;

        default:
          if (this.debugEnabled) console.log(chalk.red('   알 수 없는 패턴 타입:', patternType));
          return null;
      }

      // 유효성 검증
      if (!this.isValidDate(year, month, day)) {
        if (this.debugEnabled) console.log(chalk.red(`   ❌ 유효하지 않은 날짜: ${year}-${month}-${day}`));
        return null;
      }

      // 표준 형식으로 변환
      const formatted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (this.debugEnabled) console.log(chalk.green(`   ✅ 포맷팅 완료: ${formatted}`));

      return formatted;

    } catch (error) {
      if (this.debugEnabled) console.log(chalk.red('   ❌ 날짜 추출 오류:'), error.message);
      return null;
    }
  }

  /**
   * 월 이름을 숫자로 변환
   */
  parseMonth(monthText, language = 'en') {
    if (this.debugEnabled) console.log(chalk.blue('   📅 월 파싱:'), monthText, `(언어: ${language})`);

    if (!monthText) {
      if (this.debugEnabled) console.log(chalk.red('      ❌ 월 텍스트가 없음'));
      return null;
    }

    // 숫자인 경우
    if (/^\d+$/.test(monthText)) {
      const month = parseInt(monthText);
      if (this.debugEnabled) console.log(chalk.gray(`      숫자 월: ${month}`));
      return month;
    }

    // 언어별 매핑 시도
    const langMap = this.monthMappings[language] || this.monthMappings.en;

    // 대소문자 무시하고 찾기
    for (const [name, value] of Object.entries(langMap)) {
      if (monthText.toLowerCase() === name.toLowerCase()) {
        if (this.debugEnabled) console.log(chalk.green(`      ✅ 월 이름 매칭: "${monthText}" → ${value}`));
        return value;
      }
    }

    // 모든 언어에서 찾기
    if (this.debugEnabled) console.log(chalk.yellow('      ⚠️ 현재 언어에서 못 찾음, 모든 언어 검색'));
    for (const [lang, mapping] of Object.entries(this.monthMappings)) {
      for (const [name, value] of Object.entries(mapping)) {
        if (monthText.toLowerCase() === name.toLowerCase()) {
          if (this.debugEnabled) console.log(chalk.green(`      ✅ ${lang} 언어에서 발견: "${monthText}" → ${value}`));
          return value;
        }
      }
    }

    if (this.debugEnabled) console.log(chalk.red(`      ❌ 월 이름을 찾을 수 없음: "${monthText}"`));
    return null;
  }

  /**
   * 날짜가 아닌 텍스트 필터링
   */
  isNotDateText(text, language) {
    const nonDatePatterns = {
      en: ['unlimited', 'never', 'cancelled', 'n/a', 'none', 'expired'],
      ko: ['무제한', '없음', '취소됨', '만료됨', '해당없음'],
      tr: ['sınırsız', 'yok', 'iptal', 'sona erdi', 'geçersiz'],
      es: ['ilimitado', 'nunca', 'cancelado', 'expirado'],
      pt: ['ilimitado', 'nunca', 'cancelado', 'expirado'],
      de: ['unbegrenzt', 'nie', 'gekündigt', 'abgelaufen'],
      fr: ['illimité', 'jamais', 'annulé', 'expiré'],
      ru: ['неограничено', 'никогда', 'отменено', 'истекло']
    };
    
    const patterns = nonDatePatterns[language] || nonDatePatterns.en;
    const lowerText = text.toLowerCase();
    
    for (const pattern of patterns) {
      if (lowerText.includes(pattern)) {
        if (this.debugEnabled) console.log(chalk.yellow(`   날짜 아님 패턴 감지: "${pattern}"`));
        return true;
      }
    }
    
    return false;
  }

  /**
   * 날짜 유효성 검증
   */
  isValidDate(year, month, day) {
    if (this.debugEnabled) console.log(chalk.blue(`   📊 날짜 유효성 검증: ${year}-${month}-${day}`));

    // 기본 범위 체크
    if (!year || year < 2020 || year > 2100) {
      if (this.debugEnabled) console.log(chalk.red(`      ❌ 연도 범위 오류: ${year}`));
      return false;
    }

    if (!month || month < 1 || month > 12) {
      if (this.debugEnabled) console.log(chalk.red(`      ❌ 월 범위 오류: ${month}`));
      return false;
    }

    if (!day || day < 1 || day > 31) {
      if (this.debugEnabled) console.log(chalk.red(`      ❌ 일 범위 오류: ${day}`));
      return false;
    }

    // 월별 일수 체크
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    // 윤년 체크
    if (month === 2 && this.isLeapYear(year)) {
      daysInMonth[1] = 29;
    }

    if (day > daysInMonth[month - 1]) {
      if (this.debugEnabled) console.log(chalk.red(`      ❌ ${month}월은 ${daysInMonth[month - 1]}일까지만 있음`));
      return false;
    }

    if (this.debugEnabled) console.log(chalk.green('      ✅ 유효한 날짜'));
    return true;
  }

  /**
   * 윤년 체크
   */
  isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  /**
   * 년도가 없는 날짜에 대해 가장 적절한 년도를 계산
   * 재개 컨텍스트: 오늘 날짜는 올해로, 과거 날짜는 내년으로
   * 일시정지 컨텍스트: 오늘 날짜도 내년으로 처리
   *
   * @param {number} month - 월 (1-12)
   * @param {number} day - 일 (1-31)
   * @param {string} context - 컨텍스트 ('재개', '일시정지', 'resume', 'pause', 'nextBilling')
   * @returns {number} - 계산된 년도
   */
  calculateYearWithContext(month, day, context = 'pause') {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 0-based를 1-based로 변환
    const currentDay = now.getDate();

    // 날짜를 숫자로 변환하여 비교 (MMDD 형식)
    const inputDate = month * 100 + day;
    const todayDate = currentMonth * 100 + currentDay;

    // 컨텍스트에 따른 날짜 계산
    const isResumeContext = context === '재개' || context === 'resume' || context === 'nextBilling';

    if (isResumeContext) {
      // 재개/다음 결제일 컨텍스트: 오늘 날짜도 올해로

      // 케이스 1: 오늘과 같은 날짜 -> 올해
      if (inputDate === todayDate) {
        if (this.debugEnabled) console.log(chalk.gray(`      → ✅ [재개] 오늘 날짜 (${month}/${day}) -> ${currentYear}년`));
        return currentYear;
      }

      // 케이스 2: 오늘보다 이전 날짜 -> 내년
      if (inputDate < todayDate) {
        if (this.debugEnabled) console.log(chalk.gray(`      → 📅 [재개] 과거 날짜 (${month}/${day} < ${currentMonth}/${currentDay}) -> ${currentYear + 1}년`));
        return currentYear + 1;
      }

      // 케이스 3: 오늘보다 이후 날짜 -> 올해
      if (this.debugEnabled) console.log(chalk.gray(`      → 📅 [재개] 미래 날짜 (${month}/${day} > ${currentMonth}/${currentDay}) -> ${currentYear}년`));
      return currentYear;
    } else {
      // 일시정지 컨텍스트: 기존 로직 (오늘 날짜는 내년으로)

      // 과거 또는 오늘 날짜 -> 내년
      if (inputDate <= todayDate) {
        if (this.debugEnabled) console.log(chalk.gray(`      → 📅 [일시정지] 과거/오늘 날짜 (${month}/${day}) -> ${currentYear + 1}년`));
        return currentYear + 1;
      }

      // 미래 날짜 -> 올해
      if (this.debugEnabled) console.log(chalk.gray(`      → 📅 [일시정지] 미래 날짜 (${month}/${day}) -> ${currentYear}년`));
      return currentYear;
    }
  }

  /**
   * 범용 날짜 추출 메서드
   * UniversalDateExtractor를 사용하여 텍스트에서 날짜 추출
   * @param {string} text - 날짜를 포함한 텍스트
   * @param {string} langCode - 언어 코드 (선택적)
   * @param {string} context - 컨텍스트 ('resume' 또는 'pause', 선택적)
   * @returns {Array} 추출된 날짜 배열
   */
  extractUniversalDates(text, langCode = null, context = null) {
    if (!text) return [];

    // context 기본값 설정
    if (!context) context = 'pause';

    if (this.debugEnabled) console.log(chalk.blue(`🌍 범용 날짜 추출 시작 (언어: ${langCode || 'auto'}, 원본 컨텍스트: ${context})`));

    try {
      // UniversalDateExtractor가 없는 경우 fallback
      if (!this.universalExtractor) {
        if (this.debugEnabled) console.log(chalk.yellow('⚠️ UniversalDateExtractor 사용 불가 - 대체 파싱 시도'));

        // 간단한 날짜 패턴 매칭으로 fallback
        const datePatterns = [
          /(\d{4})[년\.\-\/]\s*(\d{1,2})[월\.\-\/]\s*(\d{1,2})/g,  // YYYY-MM-DD 형식
          /(\d{1,2})[월\.\-\/]\s*(\d{1,2})[일]?\s*,?\s*(\d{4})/g,   // MM-DD-YYYY 형식
          /(\d{1,2})[월\.\-\/]\s*(\d{1,2})/g                         // MM-DD 형식
        ];

        const dates = [];
        for (const pattern of datePatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            dates.push(match[0]);
          }
        }

        if (dates.length > 0) {
          if (this.debugEnabled) console.log(chalk.green(`✅ Fallback 파싱으로 ${dates.length}개 날짜 발견: ${dates.join(', ')}`));
        }
        return dates;
      }

      // context 정규화
      const normalizedContext = (context === '재개' || context === 'resume' || context === 'nextBilling')
        ? 'resume'
        : 'pause';

      if (this.debugEnabled) console.log(chalk.cyan(`📌 정규화된 컨텍스트: ${normalizedContext} (원본: ${context})`));

      // UniversalDateExtractor 사용 - ✅ context 전달!
      const dates = this.universalExtractor.extractDates(text, { context: normalizedContext });

      if (dates.length > 0) {
        if (this.debugEnabled) {
          console.log(chalk.green(`✅ ${dates.length}개 날짜 추출 성공`));
          // 각 날짜 객체의 상세 정보 로깅
          dates.forEach((dateObj, idx) => {
            console.log(chalk.gray(`  [${idx}] Year: ${dateObj.year}, Month: ${dateObj.month}, Day: ${dateObj.day}, Type: ${dateObj.type}, Original: "${dateObj.original}", Confidence: ${dateObj.confidence}`));
          });
        }
      } else {
        if (this.debugEnabled) console.log(chalk.yellow('⚠️ 추출된 날짜 없음'));
      }

      return dates;
    } catch (error) {
      if (this.debugEnabled) console.log(chalk.red(`❌ 날짜 추출 오류: ${error.message}`));
      return [];
    }
  }
}

module.exports = EnhancedDateParsingService;