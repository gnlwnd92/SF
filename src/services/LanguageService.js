/**
 * LanguageService - 다국어 지원 서비스
 * 
 * YouTube Premium UI의 언어 감지, 텍스트 매핑, 언어 전환 관리
 * 한국어/영어 자동 감지 및 로케일 기반 포맷팅
 */

const chalk = require('chalk');

class LanguageService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      defaultLanguage: config.defaultLanguage || 'en',
      detectTimeout: config.detectTimeout || 5000,
      ...config
    };
    
    // 현재 감지된 언어
    this.currentLanguage = null;
    
    // 언어별 텍스트 매핑
    this.translations = {
      ko: {
        // 버튼 텍스트
        buttons: {
          manageMembership: ['멤버십 관리', '구독 관리', '관리'],
          pause: ['일시중지', '멤버십 일시중지', '일시 중지'],
          resume: ['재개', '멤버십 재개', '다시 시작'],
          cancel: ['취소', '멤버십 취소', '구독 취소'],
          confirm: ['확인', '예', '계속'],
          back: ['뒤로', '돌아가기']
        },
        // 상태 텍스트
        status: {
          active: '활성',
          paused: '일시중지됨',
          cancelled: '취소됨',
          expired: '만료됨',
          pending: '대기 중'
        },
        // 메시지
        messages: {
          loginRequired: '로그인이 필요합니다',
          membershipNotFound: '멤버십을 찾을 수 없습니다',
          pauseSuccess: '멤버십이 일시중지되었습니다',
          resumeSuccess: '멤버십이 재개되었습니다',
          error: '오류가 발생했습니다'
        },
        // 날짜 포맷
        dateFormats: {
          short: 'YYYY년 MM월 DD일',
          long: 'YYYY년 MM월 DD일 HH시 mm분',
          relative: '일 전'
        },
        // 페이지 제목
        pageTitles: {
          membership: 'YouTube Premium',
          settings: '설정',
          billing: '결제 및 구독'
        }
      },
      en: {
        // 버튼 텍스트
        buttons: {
          manageMembership: ['Manage membership', 'Manage Membership', 'Manage subscription', 'Manage'],
          pause: ['Pause', 'Pause membership', 'Pause subscription'],
          resume: ['Resume', 'Resume membership', 'Resume subscription', 'Restart'],
          cancel: ['Cancel', 'Cancel membership', 'Cancel subscription'],
          confirm: ['Confirm', 'OK', 'Yes', 'Continue'],
          back: ['Back', 'Go back']
        },
        // 상태 텍스트
        status: {
          active: 'Active',
          paused: 'Paused',
          cancelled: 'Cancelled',
          expired: 'Expired',
          pending: 'Pending'
        },
        // 메시지
        messages: {
          loginRequired: 'Sign in required',
          membershipNotFound: 'Membership not found',
          pauseSuccess: 'Membership has been paused',
          resumeSuccess: 'Membership has been resumed',
          error: 'An error occurred'
        },
        // 날짜 포맷
        dateFormats: {
          short: 'MMM DD, YYYY',
          long: 'MMM DD, YYYY at HH:mm',
          relative: 'days ago'
        },
        // 페이지 제목
        pageTitles: {
          membership: 'YouTube Premium',
          settings: 'Settings',
          billing: 'Purchases and memberships'
        }
      }
    };
    
    // 언어 감지 패턴
    this.languagePatterns = {
      ko: [
        /멤버십/,
        /구독/,
        /결제/,
        /설정/,
        /관리/,
        /일시중지/,
        /재개/,
        /취소/
      ],
      en: [
        /membership/i,
        /subscription/i,
        /billing/i,
        /settings/i,
        /manage/i,
        /pause/i,
        /resume/i,
        /cancel/i
      ]
    };
  }

  /**
   * 페이지 언어 자동 감지
   */
  async detectLanguage(page) {
    this.log('언어 감지 중...', 'info');
    
    try {
      // 여러 방법으로 언어 감지
      const detectionMethods = [
        this.detectByPageLang(page),
        this.detectByContent(page),
        this.detectByURL(page),
        this.detectByButtons(page)
      ];
      
      const results = await Promise.all(detectionMethods);
      
      // 가장 많이 감지된 언어 선택
      const languageCounts = {};
      results.forEach(lang => {
        if (lang) {
          languageCounts[lang] = (languageCounts[lang] || 0) + 1;
        }
      });
      
      // 우선순위: 감지 횟수 > 기본 언어
      const detectedLanguage = Object.keys(languageCounts).reduce((a, b) => 
        languageCounts[a] > languageCounts[b] ? a : b,
        this.config.defaultLanguage
      );
      
      this.currentLanguage = detectedLanguage;
      
      this.log(`언어 감지 완료: ${this.getLanguageName(detectedLanguage)}`, 'success');
      
      return {
        language: detectedLanguage,
        confidence: languageCounts[detectedLanguage] || 0,
        methods: results
      };
      
    } catch (error) {
      this.log(`언어 감지 실패: ${error.message}`, 'error');
      this.currentLanguage = this.config.defaultLanguage;
      return {
        language: this.config.defaultLanguage,
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * HTML lang 속성으로 감지
   */
  async detectByPageLang(page) {
    try {
      const lang = await page.evaluate(() => {
        return document.documentElement.lang || 
               document.querySelector('html')?.getAttribute('lang');
      });
      
      if (lang) {
        if (lang.startsWith('ko')) return 'ko';
        if (lang.startsWith('en')) return 'en';
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 페이지 컨텐츠로 감지
   */
  async detectByContent(page) {
    try {
      const text = await page.textContent('body');
      if (!text) return null;
      
      // 포르투갈어 변형 구분
      // 브라질: "assinatura", "Gerenciar", "Retomar", "faturamento"
      // 포르투갈: "subscrição", "Gerir", "Retomar", "faturação"
      const portugueseBrazilKeywords = ['assinatura', 'Gerenciar', 'faturamento', 'Pausar assinatura'];
      const portuguesePortugalKeywords = ['subscrição', 'Gerir', 'faturação', 'Pausar subscrição'];
      
      const brazilCount = portugueseBrazilKeywords.filter(word => text.includes(word)).length;
      const portugalCount = portuguesePortugalKeywords.filter(word => text.includes(word)).length;
      
      if (brazilCount > portugalCount && brazilCount > 0) {
        return 'pt-br';
      }
      if (portugalCount > brazilCount && portugalCount > 0) {
        return 'pt-pt';
      }
      if (brazilCount > 0 || portugalCount > 0) {
        return 'pt'; // 구분이 안 되면 일반 포르투갈어로
      }
      
      // 러시아어 감지
      const russianKeywords = ['Приостановить', 'Возобновить', 'подписка', 'членство'];
      const russianCount = russianKeywords.filter(word => text.includes(word)).length;
      if (russianCount > 0) return 'ru';
      
      // 한국어 패턴 매칭
      const koMatches = this.languagePatterns.ko?.filter(pattern => 
        pattern.test(text)
      ).length || 0;
      
      // 영어 패턴 매칭
      const enMatches = this.languagePatterns.en?.filter(pattern => 
        pattern.test(text)
      ).length || 0;
      
      if (koMatches > enMatches) return 'ko';
      if (enMatches > koMatches) return 'en';
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * URL 파라미터로 감지
   */
  async detectByURL(page) {
    try {
      const url = page.url();
      
      if (url.includes('hl=ko') || url.includes('lang=ko')) return 'ko';
      if (url.includes('hl=en') || url.includes('lang=en')) return 'en';
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 버튼 텍스트로 감지
   */
  async detectByButtons(page) {
    try {
      const buttonTexts = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        return Array.from(buttons).map(btn => btn.textContent?.trim()).filter(Boolean);
      });
      
      // 한국어 버튼 텍스트 확인
      const hasKoreanButtons = buttonTexts.some(text => 
        /[가-힣]/.test(text)
      );
      
      if (hasKoreanButtons) return 'ko';
      
      // 영어 버튼 텍스트 확인
      const hasEnglishButtons = buttonTexts.some(text => 
        /^[A-Za-z\s]+$/.test(text)
      );
      
      if (hasEnglishButtons) return 'en';
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 로케일 텍스트 가져오기
   */
  getLocalizedText(key, language = null) {
    const lang = language || this.currentLanguage || this.config.defaultLanguage;
    
    // 중첩된 키 지원 (예: 'buttons.pause')
    const keys = key.split('.');
    let value = this.translations[lang];
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        break;
      }
    }
    
    // 번역이 없으면 기본 언어로 폴백
    if (!value && lang !== this.config.defaultLanguage) {
      return this.getLocalizedText(key, this.config.defaultLanguage);
    }
    
    return value || key;
  }

  /**
   * 언어 전환
   */
  async switchLanguage(page, targetLang) {
    this.log(`언어 전환: ${this.getLanguageName(targetLang)}`, 'info');
    
    try {
      // YouTube 언어 설정 URL
      const currentUrl = page.url();
      const url = new URL(currentUrl);
      url.searchParams.set('hl', targetLang);
      
      // 페이지 리로드 with 언어 파라미터
      await page.goto(url.toString(), {
        waitUntil: 'domcontentloaded'
      });
      
      // 언어 변경 확인
      await new Promise(r => setTimeout(r, 2000));
      const detected = await this.detectLanguage(page);
      
      if (detected.language === targetLang) {
        this.currentLanguage = targetLang;
        this.log(`언어 전환 성공: ${this.getLanguageName(targetLang)}`, 'success');
        return {
          success: true,
          language: targetLang
        };
      } else {
        throw new Error(`언어 전환 실패: ${detected.language} !== ${targetLang}`);
      }
      
    } catch (error) {
      this.log(`언어 전환 실패: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 날짜 포맷팅
   */
  formatDate(date, language = null, format = 'short') {
    const lang = language || this.currentLanguage || this.config.defaultLanguage;
    
    if (!date) return '';
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // 언어별 로케일
    const locales = {
      ko: 'ko-KR',
      en: 'en-US'
    };
    
    const locale = locales[lang] || 'en-US';
    
    // 포맷별 옵션
    const formatOptions = {
      short: { year: 'numeric', month: 'short', day: 'numeric' },
      long: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
      relative: null // 상대 시간은 별도 처리
    };
    
    if (format === 'relative') {
      return this.getRelativeTime(dateObj, lang);
    }
    
    return dateObj.toLocaleString(locale, formatOptions[format] || formatOptions.short);
  }

  /**
   * 상대 시간 계산
   */
  getRelativeTime(date, language) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (language === 'ko') {
      if (days === 0) return '오늘';
      if (days === 1) return '어제';
      if (days < 7) return `${days}일 전`;
      if (days < 30) return `${Math.floor(days / 7)}주 전`;
      if (days < 365) return `${Math.floor(days / 30)}개월 전`;
      return `${Math.floor(days / 365)}년 전`;
    } else {
      if (days === 0) return 'Today';
      if (days === 1) return 'Yesterday';
      if (days < 7) return `${days} days ago`;
      if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
      if (days < 365) return `${Math.floor(days / 30)} months ago`;
      return `${Math.floor(days / 365)} years ago`;
    }
  }

  /**
   * 버튼 텍스트 매칭
   */
  matchButtonText(buttonText, buttonType, language = null) {
    const lang = language || this.currentLanguage || this.config.defaultLanguage;
    const buttonTexts = this.translations[lang]?.buttons?.[buttonType] || [];
    
    return buttonTexts.some(text => 
      buttonText.includes(text) || text.includes(buttonText)
    );
  }

  /**
   * 언어 이름 가져오기
   */
  getLanguageName(code) {
    const names = {
      ko: '한국어',
      en: 'English'
    };
    return names[code] || code;
  }

  /**
   * 현재 언어 가져오기
   */
  getCurrentLanguage() {
    return this.currentLanguage || this.config.defaultLanguage;
  }

  /**
   * 언어 설정
   */
  setCurrentLanguage(language) {
    if (this.translations[language]) {
      this.currentLanguage = language;
      return true;
    }
    return false;
  }

  /**
   * 지원 언어 목록
   */
  getSupportedLanguages() {
    return Object.keys(this.translations);
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') {
      return;
    }
    
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[LanguageService] ${message}`));
  }

  /**
   * 서비스 상태 확인
   */
  getStatus() {
    return {
      service: 'LanguageService',
      ready: true,
      currentLanguage: this.currentLanguage,
      supportedLanguages: this.getSupportedLanguages(),
      config: {
        debugMode: this.config.debugMode,
        defaultLanguage: this.config.defaultLanguage
      }
    };
  }
}

module.exports = LanguageService;