/**
 * Google Login Helper Minimal
 * 최소한의 개입으로 Google 자동화 감지를 우회하는 버전
 * 
 * 핵심 원칙:
 * 1. evaluateOnNewDocument 사용 금지
 * 2. 브라우저 환경 수정 최소화
 * 3. CDP 네이티브 이벤트 활용
 * 4. AdsPower 기본 설정 유지
 */

const chalk = require('chalk');
const CDPClickHelper = require('./CDPClickHelper');

class GoogleLoginHelperMinimal {
  constructor(page, browserController, config = {}) {
    this.page = page;
    this.controller = browserController;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      maxRetries: config.maxRetries || 3,
      minimalMode: true, // 핵심: Minimal 모드 활성화
      ...config
    };
    
    // CDP Click Helper 초기화 (Google 자동화 탐지 우회)
    this.cdpHelper = new CDPClickHelper(page, {
      verbose: this.config.debugMode,
      naturalDelay: true
    });
    
    // Minimal 초기화 - evaluateOnNewDocument 사용 안 함
    this.initializeMinimal();
  }

  /**
   * Minimal 페이지 초기화 - 최소한의 설정만
   */
  async initializeMinimal() {
    try {
      console.log(chalk.cyan('🔧 Minimal 모드 초기화...'));
      
      // 1. HTTP 헤더만 설정 (비침투적)
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      // 2. 타임아웃 설정 (자연스러운 범위)
      const timeout = 30000 + Math.floor(Math.random() * 10000);
      this.page.setDefaultTimeout(timeout);
      this.page.setDefaultNavigationTimeout(timeout);
      
      // 3. evaluateOnNewDocument 사용 안 함!
      // 브라우저 환경을 수정하지 않음
      
      console.log(chalk.green('✅ Minimal 초기화 완료 (브라우저 환경 무수정)'));
      
    } catch (error) {
      console.log(chalk.yellow('Minimal 초기화 경고:', error.message));
    }
  }

  /**
   * 로그인 상태 확인 (순수 DOM 체크)
   */
  async checkLoginStatus() {
    try {
      const currentUrl = this.page.url();
      
      // URL 기반 체크
      if (currentUrl.includes('accounts.google.com/signin') ||
          currentUrl.includes('accounts.google.com/v3/signin') ||
          currentUrl.includes('accounts.google.com/ServiceLogin')) {
        return false;
      }
      
      if (currentUrl.includes('youtube.com')) {
        // 페이지 로드 대기 (Puppeteer 방식)
        await Promise.race([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);
        
        // 간단한 로그인 상태 확인
        const isLoggedIn = await this.page.evaluate(() => {
          // 아바타 버튼 확인
          const avatarBtn = document.querySelector('#avatar-btn, button#avatar-btn');
          // 로그인 링크 확인
          const signInLink = document.querySelector('a[href*="accounts.google.com/ServiceLogin"]');
          
          return !!avatarBtn && !signInLink;
        }).catch(() => false);
        
        return isLoggedIn;
      }
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('로그인 상태 확인 실패:'), error.message);
      return false;
    }
  }

  /**
   * Minimal 로그인 프로세스
   */
  async login(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('로그인 자격 증명이 없습니다.');
    }
    
    console.log(chalk.blue(`\n🔐 Minimal 모드 로그인 시작: ${credentials.email}`));
    
    try {
      const currentUrl = this.page.url();
      console.log(chalk.gray(`현재 URL: ${currentUrl}`));
      
      // 1. 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        const accountSelected = await this.selectAccountMinimal(credentials.email);
        
        if (accountSelected) {
          console.log(chalk.green('✅ 계정 선택 완료'));
          await new Promise(r => setTimeout(r, 3000));
        } else {
          // "다른 계정 사용" 클릭
          await this.clickAddAccountMinimal();
        }
      }
      
      // 2. 이메일 입력
      const emailEntered = await this.enterEmailMinimal(credentials.email);
      if (emailEntered) {
        console.log(chalk.green('✅ 이메일 입력 완료'));
        await this.clickNextButtonMinimal();
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // 3. 비밀번호 입력
      const passwordEntered = await this.enterPasswordMinimal(credentials.password);
      if (passwordEntered) {
        console.log(chalk.green('✅ 비밀번호 입력 완료'));
        await this.clickPasswordNextMinimal();
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // 4. 로그인 성공 확인
      const loginSuccess = await this.checkLoginStatus();
      
      if (loginSuccess) {
        console.log(chalk.green('✅ Minimal 로그인 성공'));
        return true;
      } else {
        console.log(chalk.red('❌ Minimal 로그인 실패'));
        return false;
      }
      
    } catch (error) {
      console.error(chalk.red('Minimal 로그인 오류:'), error.message);
      
      if (this.config.screenshotEnabled) {
        await this.page.screenshot({
          path: `screenshots/minimal_login_error_${Date.now()}.png`
        }).catch(() => {});
      }
      
      return false;
    }
  }

  /**
   * Minimal 계정 선택 (CDP 네이티브 클릭)
   */
  async selectAccountMinimal(targetEmail) {
    try {
      console.log(chalk.cyan('🎯 CDP 네이티브 계정 선택...'));
      
      // 이메일 정규화
      const normalizedTarget = this.normalizeEmail(targetEmail);
      
      // 페이지의 모든 계정 확인
      const accounts = await this.page.$$eval('[data-identifier]', elements => 
        elements.map(el => el.getAttribute('data-identifier'))
      ).catch(() => []);
      
      // 매칭되는 계정 찾기
      let matchedEmail = null;
      for (const account of accounts) {
        if (this.normalizeEmail(account) === normalizedTarget) {
          matchedEmail = account;
          break;
        }
      }
      
      if (matchedEmail) {
        // CDP 네이티브 클릭 사용
        const clicked = await this.cdpHelper.click(`[data-identifier="${matchedEmail}"]`);
        
        if (clicked) {
          console.log(chalk.green('✅ CDP 계정 클릭 성공'));
          return true;
        }
        
        // Fallback: 부모 요소 클릭
        const parentClicked = await this.cdpHelper.click(
          `[data-identifier="${matchedEmail}"]`,
          { clickParent: true }
        );
        
        if (parentClicked) {
          console.log(chalk.green('✅ 부모 요소 클릭 성공'));
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('계정 선택 실패:'), error.message);
      return false;
    }
  }

  /**
   * "다른 계정 사용" 클릭 (Minimal)
   */
  async clickAddAccountMinimal() {
    try {
      console.log(chalk.cyan('🔄 "다른 계정 사용" 클릭...'));
      
      // CDP 네이티브 클릭으로 시도
      const selectors = [
        'div[jsname="rwl3qc"]',
        'div[data-identifier=""]',
        'li:last-child',
        'div[role="link"]:last-child'
      ];
      
      for (const selector of selectors) {
        const clicked = await this.cdpHelper.click(selector);
        if (clicked) {
          console.log(chalk.green('✅ "다른 계정 사용" 클릭 성공'));
          await new Promise(r => setTimeout(r, 2000));
          return true;
        }
      }
      
      // 텍스트 기반 클릭 (CDP)
      const textClicked = await this.cdpHelper.clickByText(['Use another account', '다른 계정 사용']);
      if (textClicked) {
        console.log(chalk.green('✅ 텍스트로 클릭 성공'));
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('"다른 계정 사용" 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 이메일 입력 (Minimal)
   */
  async enterEmailMinimal(email) {
    try {
      const emailInput = await this.page.waitForSelector(
        'input[type="email"], input#identifierId, input[name="identifier"]',
        { visible: true, timeout: 5000 }
      ).catch(() => null);
      
      if (emailInput) {
        // CDP 네이티브 타이핑
        await this.cdpHelper.type('input[type="email"], input#identifierId', email);
        console.log(chalk.green('✅ 이메일 입력 완료'));
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 실패:'), error.message);
      return false;
    }
  }

  /**
   * 다음 버튼 클릭 (Minimal)
   */
  async clickNextButtonMinimal() {
    try {
      // CDP 네이티브 클릭
      const clicked = await this.cdpHelper.click('#identifierNext, button#identifierNext');
      
      if (clicked) {
        console.log(chalk.green('✅ 다음 버튼 클릭 성공'));
        return true;
      }
      
      // Fallback: Enter 키
      await this.page.keyboard.press('Enter');
      console.log(chalk.gray('Enter 키로 진행'));
      return true;
      
    } catch (error) {
      console.error(chalk.red('다음 버튼 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 비밀번호 입력 (Minimal)
   */
  async enterPasswordMinimal(password) {
    try {
      // 비밀번호 필드 대기
      const passwordInput = await this.page.waitForSelector(
        'input[type="password"], input[name="password"], input[name="Passwd"]',
        { visible: true, timeout: 10000 }
      ).catch(() => null);
      
      if (passwordInput) {
        // CDP 네이티브 타이핑
        await this.cdpHelper.type('input[type="password"]', password);
        console.log(chalk.green('✅ 비밀번호 입력 완료'));
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('비밀번호 입력 실패:'), error.message);
      return false;
    }
  }

  /**
   * 로그인 버튼 클릭 (Minimal)
   */
  async clickPasswordNextMinimal() {
    try {
      // CDP 네이티브 클릭
      const clicked = await this.cdpHelper.click('#passwordNext, button#passwordNext');
      
      if (clicked) {
        console.log(chalk.green('✅ 로그인 버튼 클릭 성공'));
        return true;
      }
      
      // Fallback: Enter 키
      await this.page.keyboard.press('Enter');
      console.log(chalk.gray('Enter 키로 진행'));
      return true;
      
    } catch (error) {
      console.error(chalk.red('로그인 버튼 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 이메일 정규화 (호환성 유지)
   */
  normalizeEmail(email) {
    if (!email) return '';
    
    let normalized = email.toLowerCase().trim();
    let parts = normalized.split('@');
    
    if (parts.length === 1) {
      parts.push('gmail.com');
    }
    
    let localPart = parts[0]
      .replace(/\s+/g, '')
      .replace(/[-._]/g, '');
    
    localPart = localPart.split('+')[0];
    
    return localPart + '@' + parts[1];
  }

  /**
   * 자동화 감지 수준 체크 (디버깅용)
   */
  async checkDetectionLevel() {
    try {
      const signals = await this.page.evaluate(() => {
        return {
          webdriver: navigator.webdriver,
          chrome: !!window.chrome,
          chromeRuntime: !!window.chrome?.runtime,
          plugins: navigator.plugins.length,
          languages: navigator.languages,
          userAgent: navigator.userAgent,
          cdpDetection: !!window.__puppeteer_evaluation_script__
        };
      });
      
      const risks = [];
      if (signals.webdriver === true) risks.push('webdriver=true');
      if (!signals.chrome) risks.push('no-chrome');
      if (!signals.chromeRuntime) risks.push('no-runtime');
      if (signals.plugins === 0) risks.push('no-plugins');
      if (signals.cdpDetection) risks.push('cdp-detected');
      
      const riskLevel = risks.length === 0 ? 'LOW' : 
                       risks.length <= 2 ? 'MEDIUM' : 'HIGH';
      
      console.log(chalk.cyan('\n🔍 자동화 감지 수준:'));
      console.log(chalk.gray(`  위험 신호: ${risks.join(', ') || '없음'}`));
      console.log(chalk[riskLevel === 'LOW' ? 'green' : riskLevel === 'MEDIUM' ? 'yellow' : 'red']
                 (`  위험 수준: ${riskLevel}`));
      
      return { signals, risks, riskLevel };
      
    } catch (error) {
      console.error(chalk.red('감지 수준 체크 실패:'), error.message);
      return null;
    }
  }
}

module.exports = GoogleLoginHelperMinimal;