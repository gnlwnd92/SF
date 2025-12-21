/**
 * 지능형 로그인 해결사 2025
 * - 화면 캡처 및 이미지 분석
 * - Google ID 정규화 및 기존 계정 감지
 * - 반복적 문제 해결 워크플로우
 */

const fs = require('fs').promises;
const path = require('path');

class IntelligentLoginResolver2025 {
  constructor(page, options = {}) {
    this.page = page;
    this.debugMode = options.debugMode || true;
    this.maxRetries = options.maxRetries || 5;
    this.screenshotDir = options.screenshotDir || './debug-screenshots';
    this.logger = options.logger || console;
    
    // 화면 캡처 카운터
    this.screenshotCounter = 0;
    
    // Google ID 정규화 패턴
    this.emailPatterns = {
      normalize: /^([^+]+)(\+[^@]*)?(@.+)$/,
      dots: /\./g
    };
  }

  /**
   * 지능형 로그인 실행 (메인 함수)
   */
  async performIntelligentLogin(targetEmail, password, options = {}) {
    this.log('🧠 지능형 로그인 해결사 시작', 'info');
    
    // 스크린샷 디렉토리 생성
    await this.ensureScreenshotDir();
    
    let currentAttempt = 0;
    let lastError = null;
    
    while (currentAttempt < this.maxRetries) {
      try {
        currentAttempt++;
        this.log(`🔄 시도 ${currentAttempt}/${this.maxRetries}`, 'info');
        
        // 1. 현재 상태 캡처 및 분석
        const currentState = await this.captureAndAnalyzeState(`attempt-${currentAttempt}-start`);
        this.log(`현재 상태: ${currentState.pageType}`, 'debug');
        
        // 2. 상태별 처리 로직
        const result = await this.handlePageState(currentState, targetEmail, password, options);
        
        if (result.success) {
          this.log('✅ 로그인 성공!', 'success');
          return result;
        } else if (result.needsRetry) {
          this.log(`⚠️ 재시도 필요: ${result.reason}`, 'warning');
          lastError = result.reason;
          
          // 실패 상태 캡처
          await this.captureAndAnalyzeState(`attempt-${currentAttempt}-failed`);
          
          // 잠시 대기 후 재시도
          await this.humanDelay(2000, 3000);
          continue;
        } else {
          throw new Error(result.reason || '처리 불가능한 상태');
        }
        
      } catch (error) {
        this.log(`❌ 시도 ${currentAttempt} 실패: ${error.message}`, 'error');
        lastError = error.message;
        
        // 에러 상태 캡처
        await this.captureAndAnalyzeState(`attempt-${currentAttempt}-error`);
        
        if (currentAttempt < this.maxRetries) {
          await this.humanDelay(3000, 5000);
        }
      }
    }
    
    // 모든 시도 실패
    this.log(`❌ ${this.maxRetries}번 시도 모두 실패`, 'error');
    return {
      success: false,
      error: lastError || '모든 시도 실패',
      attempts: currentAttempt
    };
  }

  /**
   * 화면 캡처 및 상태 분석
   */
  async captureAndAnalyzeState(prefix = 'state') {
    this.screenshotCounter++;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${prefix}-${timestamp}-${this.screenshotCounter}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    
    try {
      // 스크린샷 캡처
      await this.page.screenshot({
        path: filepath,
        fullPage: true
      });
      
      this.log(`📸 스크린샷 저장: ${filename}`, 'debug');
      
      // 페이지 상태 분석
      const pageState = await this.analyzePage();
      
      return {
        screenshot: filepath,
        timestamp: new Date(),
        pageState: pageState,
        pageType: pageState.type,
        url: await this.page.url(),
        title: await this.page.title()
      };
      
    } catch (error) {
      this.log(`스크린샷 캡처 실패: ${error.message}`, 'warning');
      return {
        screenshot: null,
        error: error.message,
        pageState: await this.analyzePage()
      };
    }
  }

  /**
   * 페이지 상태 상세 분석
   */
  async analyzePage() {
    return await this.page.evaluate(() => {
      const state = {
        type: 'unknown',
        hasEmailInput: false,
        hasPasswordInput: false,
        hasAccountChooser: false,
        existingAccounts: [],
        buttons: [],
        errors: [],
        url: window.location.href,
        title: document.title
      };
      
      // URL 기반 페이지 타입 감지
      const url = window.location.href;
      if (url.includes('accountchooser')) {
        state.type = 'account-chooser';
      } else if (url.includes('signin') && url.includes('identifier')) {
        state.type = 'email-input';
      } else if (url.includes('signin') && url.includes('password')) {
        state.type = 'password-input';
      } else if (url.includes('challenge')) {
        state.type = 'challenge';
      } else if (url.includes('myaccount') || (url.includes('accounts.google.com') && !url.includes('signin'))) {
        state.type = 'logged-in';
      }
      
      // 이메일 입력 필드 확인
      const emailInputs = document.querySelectorAll('input[type="email"], input[id="identifierId"], input[name="identifier"]');
      if (emailInputs.length > 0) {
        state.hasEmailInput = true;
        state.type = state.type === 'unknown' ? 'email-input' : state.type;
      }
      
      // 비밀번호 입력 필드 확인
      const passwordInputs = document.querySelectorAll('input[type="password"], input[name="password"]');
      if (passwordInputs.length > 0) {
        state.hasPasswordInput = true;
        state.type = state.type === 'unknown' ? 'password-input' : state.type;
      }
      
      // 계정 선택 화면 확인
      const accountItems = document.querySelectorAll('[data-identifier], [data-email], [role="button"][data-email]');
      if (accountItems.length > 0) {
        state.hasAccountChooser = true;
        state.type = 'account-chooser';
        
        // 기존 계정 목록 추출
        accountItems.forEach(item => {
          const email = item.getAttribute('data-identifier') || 
                       item.getAttribute('data-email') || 
                       item.textContent;
          
          if (email && email.includes('@')) {
            state.existingAccounts.push({
              email: email.trim(),
              element: item.tagName,
              clickable: true
            });
          }
        });
      }
      
      // 클릭 가능한 버튼들 확인
      const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
      buttons.forEach(btn => {
        const text = btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || '';
        if (text) {
          state.buttons.push({
            text: text,
            id: btn.id,
            className: btn.className,
            type: btn.type || 'button'
          });
        }
      });
      
      // 에러 메시지 확인
      const errorSelectors = [
        '[role="alert"]',
        '.error',
        '.warning',
        '[data-error]',
        '[aria-live="assertive"]'
      ];
      
      errorSelectors.forEach(selector => {
        const errorElements = document.querySelectorAll(selector);
        errorElements.forEach(el => {
          const errorText = el.textContent?.trim();
          if (errorText && errorText.length > 0) {
            state.errors.push(errorText);
          }
        });
      });
      
      return state;
    });
  }

  /**
   * 페이지 상태별 처리 로직
   */
  async handlePageState(currentState, targetEmail, password, options) {
    const { pageState } = currentState;
    
    switch (pageState.type) {
      case 'account-chooser':
        return await this.handleAccountChooser(pageState, targetEmail);
        
      case 'email-input':
        return await this.handleEmailInput(targetEmail);
        
      case 'password-input':
        return await this.handlePasswordInput(password);
        
      case 'challenge':
        return await this.handleChallenge(options);
        
      case 'logged-in':
        return { success: true, message: '이미 로그인됨' };
        
      default:
        return await this.handleUnknownState(pageState, targetEmail);
    }
  }

  /**
   * 계정 선택 화면 처리
   */
  async handleAccountChooser(pageState, targetEmail) {
    this.log('👥 계정 선택 화면 감지', 'info');
    
    if (pageState.existingAccounts.length === 0) {
      this.log('기존 계정이 없음 - 새 계정 추가 시도', 'debug');
      return await this.clickAddAnotherAccount();
    }
    
    // Google ID 정규화 및 비교
    const normalizedTarget = this.normalizeGoogleId(targetEmail);
    this.log(`정규화된 타겟 이메일: ${normalizedTarget}`, 'debug');
    
    // 기존 계정 중 일치하는 계정 찾기
    let matchingAccount = null;
    
    for (const account of pageState.existingAccounts) {
      const normalizedExisting = this.normalizeGoogleId(account.email);
      this.log(`비교: ${normalizedExisting} vs ${normalizedTarget}`, 'debug');
      
      if (normalizedExisting === normalizedTarget) {
        matchingAccount = account;
        this.log(`✅ 일치하는 계정 발견: ${account.email}`, 'success');
        break;
      }
    }
    
    if (matchingAccount) {
      // 기존 계정 클릭
      return await this.clickExistingAccount(matchingAccount);
    } else {
      // 새 계정 추가
      this.log('일치하는 계정 없음 - 새 계정 추가', 'info');
      return await this.clickAddAnotherAccount();
    }
  }

  /**
   * Google ID 정규화
   */
  normalizeGoogleId(email) {
    if (!email || typeof email !== 'string') {
      return '';
    }
    
    // 1. 트림 및 소문자 변환
    let normalized = email.trim().toLowerCase();
    
    // 2. Gmail의 경우 점(.) 제거 및 + 이후 부분 제거
    const match = normalized.match(this.emailPatterns.normalize);
    if (match && match[3] === '@gmail.com') {
      // Gmail인 경우 점 제거 및 + 이후 제거
      const localPart = match[1].replace(this.emailPatterns.dots, '');
      normalized = localPart + '@gmail.com';
    }
    
    return normalized;
  }

  /**
   * 기존 계정 클릭
   */
  async clickExistingAccount(account) {
    try {
      this.log(`🎯 기존 계정 클릭: ${account.email}`, 'info');
      
      // 계정 이메일로 요소 찾기
      const accountElement = await this.page.evaluateHandle((email) => {
        const selectors = [
          `[data-identifier="${email}"]`,
          `[data-email="${email}"]`,
          `[title="${email}"]`
        ];
        
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) return element;
        }
        
        // 텍스트 기반 검색
        const allElements = document.querySelectorAll('[data-identifier], [data-email], div, span');
        for (const el of allElements) {
          if (el.textContent?.trim() === email) {
            return el;
          }
        }
        
        return null;
      }, account.email);
      
      if (accountElement) {
        await accountElement.click();
        await this.humanDelay(2000, 3000);
        
        // 비밀번호 페이지로 이동했는지 확인
        const passwordInput = await this.page.$('input[type="password"]');
        if (passwordInput) {
          return { success: false, needsRetry: false, nextStep: 'password' };
        }
        
        return { success: false, needsRetry: true, reason: '계정 클릭 후 비밀번호 페이지로 이동 안됨' };
      } else {
        return { success: false, needsRetry: true, reason: '계정 요소를 찾을 수 없음' };
      }
      
    } catch (error) {
      return { success: false, needsRetry: true, reason: `계정 클릭 실패: ${error.message}` };
    }
  }

  /**
   * 다른 계정 추가 클릭
   */
  async clickAddAnotherAccount() {
    try {
      this.log('➕ 다른 계정 추가 버튼 클릭', 'info');
      
      const addAccountSelectors = [
        '[data-identifier=""]',
        '[jsname="bEZLVe"]',
        'div[role="button"]:has-text("Use another account")',
        'div[role="button"]:has-text("다른 계정 사용")',
        '[aria-label*="Use another account"]',
        '[aria-label*="다른 계정"]'
      ];
      
      for (const selector of addAccountSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            await this.humanDelay(2000, 3000);
            return { success: false, needsRetry: false, nextStep: 'email-input' };
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      // 텍스트 기반 검색
      const addButton = await this.page.evaluateHandle(() => {
        const buttons = document.querySelectorAll('div[role="button"], button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('Use another account') || 
              text.includes('다른 계정') ||
              text.includes('Add account') ||
              text.includes('계정 추가')) {
            return btn;
          }
        }
        return null;
      });
      
      if (addButton) {
        await addButton.click();
        await this.humanDelay(2000, 3000);
        return { success: false, needsRetry: false, nextStep: 'email-input' };
      }
      
      return { success: false, needsRetry: true, reason: '다른 계정 추가 버튼을 찾을 수 없음' };
      
    } catch (error) {
      return { success: false, needsRetry: true, reason: `다른 계정 추가 실패: ${error.message}` };
    }
  }

  /**
   * 이메일 입력 처리
   */
  async handleEmailInput(email) {
    try {
      this.log('📧 이메일 입력 처리', 'info');
      
      const emailInput = await this.page.$('input[type="email"], input[id="identifierId"], input[name="identifier"]');
      if (!emailInput) {
        return { success: false, needsRetry: true, reason: '이메일 입력 필드를 찾을 수 없음' };
      }
      
      // 기존 내용 클리어
      await emailInput.click({ clickCount: 3 });
      await this.humanDelay(200, 500);
      
      // 이메일 입력
      await this.humanType(emailInput, email);
      await this.humanDelay(1000, 1500);
      
      // Next 버튼 클릭
      const nextClicked = await this.clickNextButton();
      if (!nextClicked) {
        return { success: false, needsRetry: true, reason: 'Next 버튼 클릭 실패' };
      }
      
      await this.humanDelay(3000, 4000);
      return { success: false, needsRetry: false, nextStep: 'password' };
      
    } catch (error) {
      return { success: false, needsRetry: true, reason: `이메일 입력 실패: ${error.message}` };
    }
  }

  /**
   * 비밀번호 입력 처리
   */
  async handlePasswordInput(password) {
    try {
      this.log('🔒 비밀번호 입력 처리', 'info');
      
      const passwordInput = await this.page.$('input[type="password"], input[name="password"]');
      if (!passwordInput) {
        return { success: false, needsRetry: true, reason: '비밀번호 입력 필드를 찾을 수 없음' };
      }
      
      // 비밀번호 입력
      await passwordInput.click();
      await this.humanDelay(500, 800);
      await this.humanType(passwordInput, password);
      await this.humanDelay(1000, 1500);
      
      // Next 버튼 클릭
      const nextClicked = await this.clickNextButton();
      if (!nextClicked) {
        return { success: false, needsRetry: true, reason: 'Next 버튼 클릭 실패' };
      }
      
      await this.humanDelay(4000, 6000);
      
      // 로그인 성공 여부 확인
      const currentUrl = await this.page.url();
      if (!currentUrl.includes('signin') && !currentUrl.includes('challenge')) {
        return { success: true, message: '로그인 성공' };
      }
      
      return { success: false, needsRetry: false, nextStep: 'verify' };
      
    } catch (error) {
      return { success: false, needsRetry: true, reason: `비밀번호 입력 실패: ${error.message}` };
    }
  }

  /**
   * 챌린지/인증 처리
   */
  async handleChallenge(options) {
    this.log('🛡️ 추가 인증 감지', 'warning');
    // 수동 처리 필요
    return { success: false, needsRetry: false, reason: '추가 인증 필요 - 수동 처리 요구됨' };
  }

  /**
   * 알 수 없는 상태 처리
   */
  async handleUnknownState(pageState, targetEmail) {
    this.log('❓ 알 수 없는 페이지 상태', 'warning');
    
    // Google 로그인 페이지로 강제 이동
    try {
      await this.page.goto('https://accounts.google.com/signin/v2/identifier', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      
      await this.humanDelay(2000, 3000);
      return { success: false, needsRetry: true, reason: '로그인 페이지로 재이동' };
      
    } catch (error) {
      return { success: false, needsRetry: true, reason: `페이지 이동 실패: ${error.message}` };
    }
  }

  /**
   * Next 버튼 클릭
   */
  async clickNextButton() {
    const nextSelectors = [
      '#identifierNext',
      '#passwordNext',
      '[id="next"]',
      'button[type="submit"]',
      '[jsname="LgbsSe"]'
    ];
    
    for (const selector of nextSelectors) {
      try {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await button.isIntersectingViewport();
          if (isVisible) {
            await button.click();
            return true;
          }
        }
      } catch (e) {
        // 다음 선택자 시도
      }
    }
    
    return false;
  }

  /**
   * 인간적 타이핑
   */
  async humanType(element, text) {
    for (const char of text) {
      await element.type(char);
      await this.humanDelay(50, 150);
    }
  }

  /**
   * 인간적 딜레이
   */
  async humanDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 스크린샷 디렉토리 생성
   */
  async ensureScreenshotDir() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      // 이미 존재하거나 생성 실패
    }
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const levels = {
      debug: '🔍',
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };
    
    const icon = levels[level] || 'ℹ️';
    this.logger.log(`[${timestamp}] ${icon} ${message}`);
  }
}

module.exports = IntelligentLoginResolver2025;