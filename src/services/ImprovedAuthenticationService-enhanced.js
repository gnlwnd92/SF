/**
 * 개선된 인증 서비스 - 복구 이메일 선택 문제 해결 버전
 * 
 * 주요 개선사항:
 * 1. 사람처럼 여러 번 클릭 시도 (최대 7회)
 * 2. 7가지 다른 클릭 방법 사용
 * 3. 페이지 변화 감지 (URL, 제목, DOM)
 * 4. 인덱스 기반 폴백 클릭
 */

const speakeasy = require('speakeasy');

// 기존 ImprovedAuthenticationService-final 확장
class ImprovedAuthenticationServiceEnhanced {
  constructor(config = {}) {
    // 기본 설정
    this.config = {
      debugMode: config.debugMode || false,
      maxRetries: config.maxRetries || 3,
      screenshotEnabled: config.screenshotEnabled || false,
      humanLikeMotion: config.humanLikeMotion || true,
      timeout: config.timeout || 30000,
      ...config
    };
    
    this.logger = config.logger || console;
    
    // 기존 ImprovedAuthenticationService 메서드들 가져오기
    const BaseService = require('./ImprovedAuthenticationService-final.js');
    const baseInstance = new BaseService(config);
    
    // 모든 메서드 복사
    Object.getOwnPropertyNames(Object.getPrototypeOf(baseInstance))
      .filter(name => name !== 'constructor')
      .forEach(name => {
        if (typeof baseInstance[name] === 'function') {
          this[name] = baseInstance[name].bind(baseInstance);
        }
      });
    
    // handleRecoverySelection 메서드 오버라이드
    this.handleRecoverySelectionOriginal = this.handleRecoverySelection;
    this.handleRecoverySelection = this.handleRecoverySelectionEnhanced.bind(this);
  }
  
  /**
   * 로그 출력 헬퍼
   */
  log(message, level = 'info') {
    if (this.config.debugMode || level === 'error' || level === 'success') {
      const timestamp = new Date().toISOString();
      const prefix = '[ImprovedAuth-Enhanced]';
      
      switch(level) {
        case 'error':
          this.logger.error(`${prefix} ❌ ${message}`);
          break;
        case 'warning':
          this.logger.warn(`${prefix} ⚠️ ${message}`);
          break;
        case 'success':
          this.logger.log(`${prefix} ✅ ${message}`);
          break;
        case 'debug':
          if (this.config.debugMode) {
            this.logger.log(`${prefix} 🔍 ${message}`);
          }
          break;
        default:
          this.logger.log(`${prefix} ${message}`);
      }
    }
  }
  
  /**
   * 개선된 복구 이메일 선택 처리
   * 사람처럼 여러 번 클릭 시도 + 페이지 변화 감지
   */
  async handleRecoverySelectionEnhanced(page, credentials) {
    this.log('🔐 복구 이메일 확인 페이지 처리 시작 (개선된 버전)', 'info');
    
    try {
      // 초기 상태 저장
      const initialUrl = page.url();
      const initialTitle = await page.title();
      this.log(`초기 URL: ${initialUrl}`, 'debug');
      this.log(`초기 제목: ${initialTitle}`, 'debug');
      
      // 스크린샷 저장
      if (this.config.screenshotEnabled && this.saveScreenshot) {
        await this.saveScreenshot(page, `screenshots/recovery_before_${Date.now()}.png`);
      }
      
      // 최대 시도 횟수
      const maxAttempts = 7;
      let pageChanged = false;
      
      for (let attempt = 1; attempt <= maxAttempts && !pageChanged; attempt++) {
        this.log(`\n========== 클릭 시도 ${attempt}/${maxAttempts} ==========`, 'info');
        
        // 복구 이메일 요소 찾기
        const targetElement = await this.findRecoveryEmailElement(page, credentials);
        
        if (!targetElement) {
          // 요소를 찾지 못한 경우 인덱스 기반 클릭
          const fallbackResult = await this.tryFallbackClick(page, attempt);
          if (fallbackResult.clicked) {
            // 페이지 변화 확인
            await new Promise(r => setTimeout(r, 2000));
            pageChanged = await this.checkPageChange(page, initialUrl, initialTitle);
            if (pageChanged) {
              this.log('✅ 폴백 클릭으로 페이지 전환 성공', 'success');
              break;
            }
          }
        } else {
          // 요소를 찾은 경우 여러 방법으로 클릭 시도
          const clickResult = await this.performMultipleClickAttempts(page, targetElement, attempt);
          
          if (clickResult.clicked) {
            // 클릭 후 페이지 변화 확인
            await new Promise(r => setTimeout(r, 2000));
            pageChanged = await this.checkPageChange(page, initialUrl, initialTitle);
            
            if (pageChanged) {
              this.log(`✅ ${clickResult.method}로 페이지 전환 성공!`, 'success');
              break;
            } else {
              this.log(`⚠️ ${clickResult.method} 후 페이지 변화 없음`, 'warning');
            }
          }
        }
        
        // 실패 시 대기
        if (!pageChanged && attempt < maxAttempts) {
          const waitTime = 3 - (attempt % 3);
          this.log(`${waitTime}초 대기 후 재시도...`, 'debug');
          await new Promise(r => setTimeout(r, waitTime * 1000));
        }
      }
      
      // 최종 결과 확인
      if (pageChanged) {
        const finalUrl = page.url();
        this.log(`✅ 복구 이메일 선택 완료`, 'success');
        this.log(`최종 URL: ${finalUrl}`, 'debug');
        
        // 성공 스크린샷
        if (this.config.screenshotEnabled && this.saveScreenshot) {
          await this.saveScreenshot(page, `screenshots/recovery_success_${Date.now()}.png`);
        }
        
        return { success: true };
      } else {
        this.log('❌ 복구 이메일 선택 실패 - 모든 시도 소진', 'error');
        
        // 실패 스크린샷
        if (this.config.screenshotEnabled && this.saveScreenshot) {
          await this.saveScreenshot(page, `screenshots/recovery_failed_${Date.now()}.png`);
        }
        
        return { success: false, error: 'Failed to select recovery email after all attempts' };
      }
      
    } catch (error) {
      this.log(`복구 이메일 선택 중 오류: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 복구 이메일 요소 찾기
   */
  async findRecoveryEmailElement(page, credentials) {
    // 복구 이메일 관련 텍스트 패턴
    const patterns = [
      '복구 이메일 확인',
      '이메일 확인',
      '복구 이메일',
      'recovery email',
      'Confirm your recovery email',
      'Confirm recovery email',
      credentials.recoveryEmail || credentials.email
    ].filter(Boolean);
    
    // CSS 선택자로 찾기
    const selectors = [
      'div[role="link"]',
      'div[role="button"]',
      'button',
      '[data-challengetype="12"]',
      '[jsaction*="click"]'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = await page.$$(selector);
        
        for (const element of elements) {
          const text = await element.evaluate(el => (el.textContent || '').toLowerCase());
          
          // 복구 이메일 관련 텍스트 확인
          const isRecovery = patterns.some(pattern => 
            text.includes(pattern.toLowerCase())
          );
          
          if (isRecovery) {
            const elementText = await element.evaluate(el => el.textContent);
            this.log(`복구 이메일 요소 발견: "${elementText?.substring(0, 50)}..."`, 'info');
            return element;
          }
        }
      } catch (e) {
        // 다음 선택자 시도
      }
    }
    
    return null;
  }
  
  /**
   * 여러 방법으로 클릭 시도
   */
  async performMultipleClickAttempts(page, element, attemptNumber) {
    const clickMethods = [
      {
        name: '일반 클릭',
        action: async () => {
          await element.click();
        }
      },
      {
        name: '지연 클릭',
        action: async () => {
          await element.click({ delay: 200 });
        }
      },
      {
        name: '더블 클릭',
        action: async () => {
          await element.click({ clickCount: 2, delay: 100 });
        }
      },
      {
        name: 'JavaScript 클릭',
        action: async () => {
          await element.evaluate(el => el.click());
        }
      },
      {
        name: '마우스 이벤트',
        action: async () => {
          const box = await element.boundingBox();
          if (box) {
            // 사람처럼 마우스 이동 후 클릭
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
            await new Promise(r => setTimeout(r, 100));
            await page.mouse.down();
            await new Promise(r => setTimeout(r, 50));
            await page.mouse.up();
          }
        }
      },
      {
        name: 'Enter 키',
        action: async () => {
          await element.focus();
          await new Promise(r => setTimeout(r, 100));
          await page.keyboard.press('Enter');
        }
      },
      {
        name: 'Space 키',
        action: async () => {
          await element.focus();
          await new Promise(r => setTimeout(r, 100));
          await page.keyboard.press('Space');
        }
      }
    ];
    
    // 시도 번호에 따라 다른 방법 사용
    const methodIndex = (attemptNumber - 1) % clickMethods.length;
    const method = clickMethods[methodIndex];
    
    try {
      // 요소로 스크롤 (보이는 경우에만)
      try {
        await element.scrollIntoViewIfNeeded();
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        // 스크롤 실패 무시
      }
      
      // 클릭 시도
      this.log(`${method.name} 시도 중...`, 'debug');
      await method.action();
      
      return { clicked: true, method: method.name };
    } catch (error) {
      this.log(`${method.name} 실패: ${error.message}`, 'debug');
      return { clicked: false, method: method.name };
    }
  }
  
  /**
   * 폴백 클릭 (인덱스 기반)
   */
  async tryFallbackClick(page, attemptNumber) {
    this.log('요소를 찾지 못함 - 인덱스 기반 클릭 시도', 'warning');
    
    const allClickables = await page.$$('div[role="link"], div[role="button"], button, [jsaction*="click"]');
    
    if (allClickables.length >= 2) {
      // 보통 두 번째 옵션이 복구 이메일
      const targetIndex = attemptNumber % 2 === 0 ? 0 : 1; // 번갈아가며 시도
      const element = allClickables[targetIndex];
      
      try {
        const text = await element.evaluate(el => el.textContent);
        this.log(`인덱스 ${targetIndex} 요소 클릭 시도: "${text?.substring(0, 30)}..."`, 'debug');
        
        await element.scrollIntoViewIfNeeded();
        await element.click({ delay: 100 });
        
        return { clicked: true };
      } catch (e) {
        return { clicked: false };
      }
    }
    
    return { clicked: false };
  }
  
  /**
   * 페이지 변화 확인
   */
  async checkPageChange(page, initialUrl, initialTitle) {
    // URL 변화 확인
    const currentUrl = page.url();
    if (currentUrl !== initialUrl) {
      this.log(`URL 변경 감지: ${initialUrl} → ${currentUrl}`, 'info');
      return true;
    }
    
    // 제목 변화 확인
    const currentTitle = await page.title();
    if (currentTitle !== initialTitle) {
      this.log(`제목 변경 감지: ${initialTitle} → ${currentTitle}`, 'info');
      return true;
    }
    
    // DOM 변화 확인 (새로운 입력 필드나 요소 출현)
    try {
      const domChanged = await page.evaluate(() => {
        // 복구 이메일 입력 필드가 나타났는지
        const hasEmailInput = document.querySelector('input[type="text"]:not([aria-hidden="true"])') !== null;
        const hasConfirmButton = document.querySelector('button#confirmButton, button[aria-label*="확인"], button[aria-label*="Confirm"]') !== null;
        
        // 선택 페이지가 사라졌는지
        const selectionPageGone = !document.querySelector('[data-challengetype]');
        
        // 비밀번호 입력 필드가 나타났는지 (복구 이메일 선택 후 비밀번호 페이지로 이동)
        const hasPasswordInput = document.querySelector('input[type="password"]') !== null;
        
        return hasEmailInput || hasConfirmButton || selectionPageGone || hasPasswordInput;
      });
      
      if (domChanged) {
        this.log('DOM 변화 감지 - 새로운 요소 출현', 'info');
        return true;
      }
    } catch (e) {
      // DOM 확인 실패 무시
    }
    
    return false;
  }
}

module.exports = ImprovedAuthenticationServiceEnhanced;