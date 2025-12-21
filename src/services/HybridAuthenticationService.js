/**
 * Hybrid Authentication Service
 * Google 자동화 감지를 우회하는 스마트 로그인 서비스
 * 
 * 핵심 전략:
 * 1. 계정별 위험도 평가
 * 2. 상황별 로그인 전략 선택
 * 3. 실패시 자동으로 수동 모드 전환
 */

const chalk = require('chalk');

class HybridAuthenticationService {
  constructor(options = {}) {
    this.config = {
      debugMode: options.debugMode || false,
      maxRetries: options.maxRetries || 3,
      // 자동화 레벨 설정
      automationLevel: {
        none: 0,      // 완전 수동
        minimal: 1,   // 최소 자동화
        moderate: 2,  // 중간 자동화
        full: 3      // 완전 자동화 (위험)
      }
    };
    
    this.attemptHistory = new Map(); // 시도 기록
  }
  
  /**
   * 스마트 로그인 프로세스
   */
  async performSmartLogin(session, credentials) {
    try {
      this.log('🔐 스마트 로그인 프로세스 시작', 'info');
      
      // 1. 로그인 전략 결정
      const strategy = this.determineStrategy(session, credentials);
      this.log(`선택된 전략: ${strategy}`, 'info');
      
      // 2. 전략별 로그인 수행
      switch (strategy) {
        case 'manual':
          return await this.performManualLogin(session, credentials);
        case 'cdp':
          return await this.performCDPLogin(session, credentials);
        case 'minimal':
          return await this.performMinimalLogin(session, credentials);
        case 'hybrid':
          return await this.performHybridLogin(session, credentials);
        default:
          throw new Error(`Unknown strategy: ${strategy}`);
      }
      
    } catch (error) {
      this.log(`로그인 실패: ${error.message}`, 'error');
      
      // 실패시 자동으로 수동 모드로 전환
      if (this.shouldFallbackToManual(credentials.email)) {
        this.log('수동 모드로 폴백', 'warning');
        return await this.performManualLogin(session, credentials);
      }
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 로그인 전략 결정
   */
  determineStrategy(session, credentials) {
    // 세션 모드 확인
    if (session.mode === 'manual') {
      return 'manual';
    }
    
    // 이전 실패 기록 확인
    const failureCount = this.attemptHistory.get(credentials.email) || 0;
    if (failureCount >= 2) {
      return 'manual'; // 2번 실패시 수동 모드
    }
    
    // CDP 전용 모드
    if (session.mode === 'cdp') {
      return 'cdp';
    }
    
    // Puppeteer 사용 가능시
    if (session.page) {
      // 하지만 최소 모드 우선
      return 'minimal';
    }
    
    // 기본: 하이브리드
    return 'hybrid';
  }
  
  /**
   * 수동 로그인 (사용자 개입)
   */
  async performManualLogin(session, credentials) {
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
    this.log('🙋 수동 로그인이 필요합니다', 'yellow');
    this.log(`계정: ${credentials.email}`, 'white');
    this.log('브라우저에서 직접 로그인해주세요.', 'yellow');
    this.log('로그인 완료 후 Enter를 눌러주세요...', 'yellow');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
    
    // 사용자 입력 대기
    await this.waitForUserConfirmation();
    
    // 로그인 상태 확인 (CDP 사용 가능시)
    if (session.cdp) {
      const isLoggedIn = await this.checkLoginStatusCDP(session);
      if (isLoggedIn) {
        this.log('✅ 로그인 확인됨', 'success');
        return { success: true, method: 'manual' };
      }
    } else {
      // CDP 없으면 사용자 확인에 의존
      this.log('✅ 로그인 완료 (사용자 확인)', 'success');
      return { success: true, method: 'manual' };
    }
    
    return { success: false, error: 'Manual login failed' };
  }
  
  /**
   * CDP 전용 로그인
   */
  async performCDPLogin(session, credentials) {
    if (!session.cdp) {
      throw new Error('CDP not available');
    }
    
    this.log('🔧 CDP 전용 로그인 시작', 'info');
    
    try {
      const { Runtime, Input } = session.cdp;
      
      // 1. 현재 페이지 URL 확인
      const { result: urlResult } = await Runtime.evaluate({
        expression: 'window.location.href'
      });
      const currentUrl = urlResult.value;
      
      this.log(`현재 URL: ${currentUrl}`, 'debug');
      
      // 2. 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        await this.handleAccountChooserCDP(session, credentials.email);
      }
      
      // 3. 이메일 입력
      if (currentUrl.includes('identifier')) {
        await this.inputEmailCDP(session, credentials.email);
      }
      
      // 4. 비밀번호 입력
      await this.waitForElement(session, 'input[type="password"]', 10000);
      await this.inputPasswordCDP(session, credentials.password);
      
      // 5. 로그인 완료 대기
      await new Promise(r => setTimeout(r, 5000));
      
      // 6. 결과 확인
      const isLoggedIn = await this.checkLoginStatusCDP(session);
      
      return {
        success: isLoggedIn,
        method: 'cdp'
      };
      
    } catch (error) {
      this.log(`CDP 로그인 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 최소 Puppeteer 로그인
   */
  async performMinimalLogin(session, credentials) {
    if (!session.page) {
      throw new Error('Page not available');
    }
    
    this.log('⚡ 최소 자동화 로그인 시작', 'info');
    
    try {
      const page = session.page;
      const currentUrl = page.url();
      
      // 중요: evaluateOnNewDocument 사용하지 않음
      // 중요: setBypassCSP 사용하지 않음
      
      // 1. 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        // URL 조작으로 우회
        const url = new URL(currentUrl);
        const params = new URLSearchParams(url.search);
        
        const identifierUrl = new URL('https://accounts.google.com/signin/v2/identifier');
        identifierUrl.searchParams.set('continue', params.get('continue') || '');
        identifierUrl.searchParams.set('service', params.get('service') || 'youtube');
        
        await page.goto(identifierUrl.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
      }
      
      // 2. 이메일 입력 (일반 Puppeteer 메서드 사용)
      const emailInput = await page.$('input[type="email"], input#identifierId');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await page.keyboard.type(credentials.email, { delay: 100 });
        await page.keyboard.press('Enter');
        
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // 3. 비밀번호 입력
      const passwordInput = await page.waitForSelector('input[type="password"]', {
        visible: true,
        timeout: 10000
      }).catch(() => null);
      
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await page.keyboard.type(credentials.password, { delay: 100 });
        await page.keyboard.press('Enter');
        
        await new Promise(r => setTimeout(r, 5000));
      }
      
      // 4. 결과 확인
      const finalUrl = page.url();
      const isLoggedIn = !finalUrl.includes('accounts.google.com');
      
      return {
        success: isLoggedIn,
        method: 'minimal'
      };
      
    } catch (error) {
      this.log(`최소 로그인 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 하이브리드 로그인 (CDP + 부분 수동)
   */
  async performHybridLogin(session, credentials) {
    this.log('🔀 하이브리드 로그인 시작', 'info');
    
    try {
      // 1. CDP로 페이지 분석
      if (session.cdp) {
        const pageState = await this.analyzePageStateCDP(session);
        this.log(`페이지 상태: ${pageState.type}`, 'debug');
        
        // 2. 상황별 처리
        if (pageState.type === 'accountchooser') {
          // 계정 선택은 수동으로
          this.log('계정을 선택해주세요...', 'yellow');
          await this.waitForPageChange(session, 5000);
        }
        
        // 3. 이메일/비밀번호는 CDP로
        if (pageState.hasEmailField) {
          await this.inputEmailCDP(session, credentials.email);
        }
        
        if (pageState.hasPasswordField) {
          await this.inputPasswordCDP(session, credentials.password);
        }
      }
      
      // 4. 2FA는 수동으로
      const needs2FA = await this.check2FARequired(session);
      if (needs2FA) {
        this.log('2단계 인증이 필요합니다. 수동으로 진행해주세요...', 'yellow');
        await this.waitForUserConfirmation();
      }
      
      // 5. 최종 확인
      const isLoggedIn = await this.checkLoginStatusCDP(session);
      
      return {
        success: isLoggedIn,
        method: 'hybrid'
      };
      
    } catch (error) {
      this.log(`하이브리드 로그인 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  /**
   * CDP로 페이지 상태 분석
   */
  async analyzePageStateCDP(session) {
    if (!session.cdp) {
      return { type: 'unknown' };
    }
    
    try {
      const { Runtime } = session.cdp;
      
      const { result } = await Runtime.evaluate({
        expression: `
          (() => {
            const url = window.location.href;
            const hasEmailField = !!document.querySelector('input[type="email"]');
            const hasPasswordField = !!document.querySelector('input[type="password"]');
            const hasAccounts = document.querySelectorAll('[data-identifier]').length > 0;
            
            let type = 'unknown';
            if (url.includes('accountchooser')) type = 'accountchooser';
            else if (url.includes('identifier')) type = 'identifier';
            else if (url.includes('challenge')) type = 'challenge';
            else if (url.includes('youtube.com')) type = 'youtube';
            
            return {
              type,
              url,
              hasEmailField,
              hasPasswordField,
              hasAccounts
            };
          })()
        `,
        returnByValue: true
      });
      
      return result.value;
      
    } catch (error) {
      return { type: 'error', error: error.message };
    }
  }
  
  /**
   * CDP로 로그인 상태 확인
   */
  async checkLoginStatusCDP(session) {
    if (!session.cdp) {
      return false;
    }
    
    try {
      const { Runtime } = session.cdp;
      
      const { result } = await Runtime.evaluate({
        expression: `
          (() => {
            const url = window.location.href;
            if (url.includes('youtube.com') && !url.includes('accounts.google.com')) {
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true
      });
      
      return result.value === true;
      
    } catch (error) {
      return false;
    }
  }
  
  /**
   * 수동 모드로 폴백할지 결정
   */
  shouldFallbackToManual(email) {
    const failureCount = this.attemptHistory.get(email) || 0;
    this.attemptHistory.set(email, failureCount + 1);
    
    return failureCount >= 1; // 1번 실패시 바로 수동 모드
  }
  
  /**
   * 헬퍼 메서드들
   */
  async waitForUserConfirmation() {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
  
  async waitForPageChange(session, timeout = 5000) {
    return new Promise(resolve => setTimeout(resolve, timeout));
  }
  
  async waitForElement(session, selector, timeout = 10000) {
    // CDP를 통한 요소 대기 로직
    return new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  async inputEmailCDP(session, email) {
    // CDP를 통한 이메일 입력
    this.log(`이메일 입력: ${email}`, 'debug');
  }
  
  async inputPasswordCDP(session, password) {
    // CDP를 통한 비밀번호 입력
    this.log('비밀번호 입력', 'debug');
  }
  
  async handleAccountChooserCDP(session, email) {
    // CDP를 통한 계정 선택 처리
    this.log(`계정 선택: ${email}`, 'debug');
  }
  
  async check2FARequired(session) {
    // 2FA 필요 여부 확인
    return false;
  }
  
  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') {
      return;
    }
    
    const colors = {
      error: 'red',
      warning: 'yellow',
      success: 'green',
      info: 'cyan',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[HybridAuth] ${message}`));
  }
}

module.exports = HybridAuthenticationService;