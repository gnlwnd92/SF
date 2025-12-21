/**
 * FamilyPlanDetectionService - YouTube Music Family Plan 상태 감지
 * 
 * 다양한 언어와 UI 변화에 대응할 수 있는 범용 감지 로직
 */

const chalk = require('chalk');

class FamilyPlanDetectionService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    
    // Family Plan 관련 키워드 (다국어)
    this.familyKeywords = {
      en: ['Family plan', 'Family membership', 'family', 'Share with family'],
      ko: ['가족 요금제', '가족 멤버십', '가족과 공유'],
      ur: ['خاندانی منصوبہ', 'فیملی پلان'], // 우르두어 (파키스탄)
      hi: ['परिवार योजना', 'फैमिली प्लान'] // 힌디어
    };
    
    // 가격 통화 감지
    this.currencyPatterns = {
      pkr: /PKR|Rs\.?|₨/i,
      krw: /KRW|₩|원/i,
      usd: /USD|\$/i
    };
    
    // 상태 메시지 패턴
    this.statusPatterns = {
      eligible: [
        /get family plan/i,
        /start family plan/i,
        /try family/i,
        /가족 요금제 시작/,
        /가족 요금제 가입/
      ],
      ineligible: [
        /not available/i,
        /cannot access/i,
        /region restricted/i,
        /이용할 수 없/,
        /지역 제한/
      ],
      alreadyMember: [
        /already a member/i,
        /current plan/i,
        /manage family/i,
        /이미 가입/,
        /현재 요금제/
      ]
    };
  }

  /**
   * Family Plan 상태 확인
   */
  async checkFamilyPlanStatus(page) {
    try {
      // 페이지 로드 대기 (Puppeteer 방식)
      await new Promise(r => setTimeout(r, 3000)); // 페이지 안정화 대기
      
      // 페이지 전체 텍스트 추출 (Puppeteer 방식)
      const pageText = await page.evaluate(() => document.body.textContent || '');
      const pageHTML = await page.content();
      
      if (this.debugMode) {
        console.log(chalk.gray('📄 페이지 텍스트 길이:', pageText.length));
      }
      
      // 1. Family Plan 키워드 확인
      const hasFamilyKeywords = this.checkFamilyKeywords(pageText);
      
      // 2. 통화 확인 (파키스탄 루피)
      const hasPKRCurrency = this.checkCurrency(pageText, 'pkr');
      
      // 3. 가격 정보 추출
      const priceInfo = await this.extractPriceInfo(page);
      
      // 4. 버튼/링크 확인
      const actionElements = await this.findActionElements(page);
      
      // 5. 상태 판단
      const status = this.determineStatus({
        hasFamilyKeywords,
        hasPKRCurrency,
        priceInfo,
        actionElements,
        pageText
      });
      
      // 6. 상세 정보 수집
      const details = {
        ...status,
        currency: hasPKRCurrency ? 'PKR' : 'Unknown',
        price: priceInfo.price,
        priceText: priceInfo.text,
        availableActions: actionElements.map(el => el.text),
        pageUrl: page.url(),
        timestamp: new Date().toISOString()
      };
      
      if (this.debugMode) {
        console.log(chalk.cyan('🔍 감지 결과:'));
        console.log(JSON.stringify(details, null, 2));
      }
      
      return details;
      
    } catch (error) {
      console.error(chalk.red('Family Plan 감지 오류:'), error);
      return {
        eligible: false,
        reason: 'DETECTION_ERROR',
        error: error.message
      };
    }
  }

  /**
   * Family 키워드 확인
   */
  checkFamilyKeywords(text) {
    for (const lang in this.familyKeywords) {
      for (const keyword of this.familyKeywords[lang]) {
        if (text.includes(keyword)) {
          if (this.debugMode) {
            console.log(chalk.green(`✓ Family 키워드 발견: ${keyword}`));
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 통화 확인
   */
  checkCurrency(text, currency) {
    const pattern = this.currencyPatterns[currency];
    if (pattern && pattern.test(text)) {
      if (this.debugMode) {
        console.log(chalk.green(`✓ ${currency.toUpperCase()} 통화 발견`));
      }
      return true;
    }
    return false;
  }

  /**
   * 가격 정보 추출
   */
  async extractPriceInfo(page) {
    try {
      // 가격 패턴들
      const pricePatterns = [
        /PKR\s*[\d,]+/gi,
        /Rs\.?\s*[\d,]+/gi,
        /₨\s*[\d,]+/gi,
        /[\d,]+\s*PKR/gi
      ];
      
      const pageText = await page.textContent('body');
      
      for (const pattern of pricePatterns) {
        const matches = pageText.match(pattern);
        if (matches && matches.length > 0) {
          const price = matches[0];
          const numericPrice = price.replace(/[^\d,]/g, '');
          
          if (this.debugMode) {
            console.log(chalk.green(`💰 가격 발견: ${price}`));
          }
          
          return {
            found: true,
            price: numericPrice,
            text: price
          };
        }
      }
      
      return { found: false, price: null, text: null };
      
    } catch (error) {
      console.error('가격 추출 오류:', error);
      return { found: false, price: null, text: null };
    }
  }

  /**
   * 액션 요소 찾기 (버튼, 링크)
   */
  async findActionElements(page) {
    const elements = [];
    
    try {
      // Family Plan 관련 버튼/링크 찾기
      const selectors = [
        'button',
        'a[href*="family"]',
        '[role="button"]',
        '[aria-label*="family"]',
        '[aria-label*="Family"]'
      ];
      
      for (const selector of selectors) {
        const els = await page.$$(selector);
        
        for (const el of els) {
          const text = await el.textContent().catch(() => '');
          const isVisible = await el.isVisible().catch(() => false);
          
          if (isVisible && text) {
            // Family 관련 텍스트 포함 여부 확인
            const lowerText = text.toLowerCase();
            if (lowerText.includes('family') || 
                lowerText.includes('가족') ||
                lowerText.includes('get') ||
                lowerText.includes('start') ||
                lowerText.includes('try')) {
              
              elements.push({
                type: selector.startsWith('button') ? 'button' : 'link',
                text: text.trim(),
                selector
              });
              
              if (this.debugMode) {
                console.log(chalk.blue(`🔘 액션 요소: ${text.trim()}`));
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('액션 요소 찾기 오류:', error);
    }
    
    return elements;
  }

  /**
   * 최종 상태 판단
   */
  determineStatus({ hasFamilyKeywords, hasPKRCurrency, priceInfo, actionElements, pageText }) {
    // 이미 가입된 경우
    for (const pattern of this.statusPatterns.alreadyMember) {
      if (pattern.test(pageText)) {
        return {
          eligible: false,
          reason: 'ALREADY_MEMBER',
          message: '이미 가족 요금제 가입됨'
        };
      }
    }
    
    // 지역 제한
    for (const pattern of this.statusPatterns.ineligible) {
      if (pattern.test(pageText)) {
        return {
          eligible: false,
          reason: 'REGION_BLOCKED',
          message: '지역 제한으로 이용 불가'
        };
      }
    }
    
    // 가입 가능한 경우
    if (hasFamilyKeywords && hasPKRCurrency && priceInfo.found) {
      // "Get" 또는 "Start" 버튼이 있는지 확인
      const hasGetButton = actionElements.some(el => 
        /get|start|try|가입|시작/i.test(el.text)
      );
      
      if (hasGetButton) {
        return {
          eligible: true,
          reason: 'ELIGIBLE',
          message: '가족 요금제 가입 가능'
        };
      }
    }
    
    // Family 키워드는 있지만 PKR 통화가 없는 경우
    if (hasFamilyKeywords && !hasPKRCurrency) {
      return {
        eligible: false,
        reason: 'WRONG_REGION',
        message: '잘못된 지역 (PKR 통화 없음)'
      };
    }
    
    // 페이지는 로드되었지만 Family Plan 정보가 없는 경우
    if (!hasFamilyKeywords) {
      return {
        eligible: false,
        reason: 'NO_FAMILY_PLAN',
        message: 'Family Plan 정보 없음'
      };
    }
    
    // 알 수 없는 상태
    return {
      eligible: false,
      reason: 'UNKNOWN',
      message: '상태를 판단할 수 없음'
    };
  }

  /**
   * 스크린샷과 함께 상태 기록
   */
  async captureStateWithScreenshot(page, profileName) {
    const timestamp = Date.now();
    const screenshotPath = `screenshots/family-check-${profileName}-${timestamp}.png`;
    
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      
      console.log(chalk.gray(`📸 스크린샷 저장: ${screenshotPath}`));
      return screenshotPath;
      
    } catch (error) {
      console.error('스크린샷 저장 실패:', error);
      return null;
    }
  }
}

module.exports = FamilyPlanDetectionService;