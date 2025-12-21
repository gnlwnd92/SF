/**
 * GoogleAuthService - 향상된 Google 로그인 서비스
 * 
 * 기능:
 * - 기본 이메일/비밀번호 로그인
 * - 복구 이메일 처리
 * - TOTP 2FA 처리
 * - 다양한 보안 챌린지 대응
 * - 인간형 입력 패턴
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

class GoogleAuthService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.maxRetries = options.maxRetries || 3;
    this.humanTypingDelay = options.humanTypingDelay || { min: 50, max: 150 };
    
    // 로그인 URL
    this.LOGIN_URL = 'https://accounts.google.com';
    
    // 셀렉터 정의
    this.selectors = {
      // 이메일 단계
      emailInput: 'input[type="email"]',
      emailNext: '#identifierNext',
      
      // 비밀번호 단계
      passwordInput: 'input[type="password"]',
      passwordNext: '#passwordNext',
      
      // 복구 이메일
      tryAnotherWay: '[data-is-secondary-action-disabled="false"]',
      recoveryEmailOption: '[data-challengetype="12"]',
      recoveryEmailInput: '#knowledge-preregistered-email-response',
      
      // TOTP 2FA
      totpInput: '#totpPin',
      totpNext: '#totpNext',
      
      // 대체 2FA 방법
      phoneOption: '[data-challengetype="13"]',
      smsOption: '[data-challengetype="9"]',
      
      // 확인 버튼들
      confirmButton: 'button[jsname="LgbsSe"]',
      yesButton: 'span:contains("예")',
      continueButton: 'span:contains("계속")',
      
      // 에러 메시지
      errorMessage: '[jsname="B34EJ"] span',
      captchaFrame: 'iframe[title*="recaptcha"]'
    };
    
    // 에러 메시지 패턴
    this.errorPatterns = {
      wrongPassword: /wrong password|비밀번호가 잘못/i,
      accountNotFound: /couldn't find|계정을 찾을 수 없/i,
      tooManyAttempts: /too many failed attempts|너무 많은 시도/i,
      suspiciousActivity: /suspicious activity|의심스러운 활동/i,
      captchaRequired: /captcha|로봇이 아님을 증명/i
    };
  }

  /**
   * 메인 로그인 메서드
   */
  async login(page, account) {
    const startTime = Date.now();
    console.log(chalk.cyan(`🔐 Google 로그인 시작: ${account.email}`));
    
    try {
      // 1. 로그인 페이지로 이동
      await this.navigateToLogin(page);
      
      // 2. 이메일 입력
      await this.enterEmail(page, account.email);
      
      // 3. 비밀번호 또는 챌린지 처리
      const needsPassword = await this.waitForPasswordOrChallenge(page);
      
      if (needsPassword) {
        await this.enterPassword(page, account.password);
      }
      
      // 4. 추가 인증 처리
      await this.handleAuthChallenges(page, account);
      
      // 5. 로그인 성공 확인
      const success = await this.verifyLoginSuccess(page);
      
      if (success) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(chalk.green(`✅ 로그인 성공 (${duration}초)`));
        return { success: true, duration };
      } else {
        throw new Error('로그인 확인 실패');
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ 로그인 실패: ${error.message}`));
      
      // 스크린샷 저장
      await this.captureError(page, account.email, error.message);
      
      return {
        success: false,
        error: error.message,
        duration: ((Date.now() - startTime) / 1000).toFixed(2)
      };
    }
  }

  /**
   * 로그인 페이지로 이동
   */
  async navigateToLogin(page) {
    console.log(chalk.gray('로그인 페이지로 이동...'));
    
    await page.goto(this.LOGIN_URL, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 언어 설정 확인 (한국어 우선)
    const url = page.url();
    if (!url.includes('hl=ko')) {
      await page.goto(`${this.LOGIN_URL}?hl=ko`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
    }
    
    await this.delay(2000);
  }

  /**
   * 이메일 입력
   */
  async enterEmail(page, email) {
    console.log(chalk.gray('이메일 입력...'));
    
    // 이메일 입력 필드 대기
    await page.waitForSelector(this.selectors.emailInput, {
      visible: true,
      timeout: 10000
    });
    
    // 기존 텍스트 클리어
    const emailInput = await page.$(this.selectors.emailInput);
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    
    // 인간형 타이핑
    await this.humanType(page, this.selectors.emailInput, email);
    
    await this.delay(1000);
    
    // 다음 버튼 클릭
    await page.click(this.selectors.emailNext);
    
    await this.delay(3000);
  }

  /**
   * 비밀번호 또는 챌린지 대기
   */
  async waitForPasswordOrChallenge(page) {
    try {
      // 비밀번호 필드 또는 챌린지 대기
      await page.waitForSelector(this.selectors.passwordInput, {
        visible: true,
        timeout: 5000
      });
      return true; // 비밀번호 필요
      
    } catch (error) {
      // 비밀번호 필드가 없으면 다른 챌린지 확인
      console.log(chalk.yellow('비밀번호 필드 없음, 챌린지 확인...'));
      return false;
    }
  }

  /**
   * 비밀번호 입력
   */
  async enterPassword(page, password) {
    console.log(chalk.gray('비밀번호 입력...'));
    
    // 비밀번호 필드 확인
    await page.waitForSelector(this.selectors.passwordInput, {
      visible: true,
      timeout: 10000
    });
    
    // 인간형 타이핑
    await this.humanType(page, this.selectors.passwordInput, password);
    
    await this.delay(1000);
    
    // 다음 버튼 클릭
    await page.click(this.selectors.passwordNext);
    
    await this.delay(3000);
  }

  /**
   * 인증 챌린지 처리
   */
  async handleAuthChallenges(page, account) {
    let retries = 0;
    const maxChallenges = 5;
    
    while (retries < maxChallenges) {
      const challenge = await this.detectChallenge(page);
      
      if (!challenge) {
        // 챌린지 없음 - 로그인 완료 또는 성공
        break;
      }
      
      console.log(chalk.yellow(`🔒 인증 챌린지 감지: ${challenge}`));
      
      switch (challenge) {
        case 'RECOVERY_EMAIL':
          await this.handleRecoveryEmail(page, account.recoveryEmail);
          break;
          
        case 'TOTP':
          await this.handleTOTP(page, account.totpSecret);
          break;
          
        case 'SMS':
          console.log(chalk.yellow('SMS 인증 필요 - 수동 처리 필요'));
          throw new Error('SMS 인증은 수동 처리가 필요합니다');
          
        case 'CAPTCHA':
          console.log(chalk.red('CAPTCHA 감지 - 수동 처리 필요'));
          throw new Error('CAPTCHA 감지됨');
          
        case 'SUSPICIOUS_ACTIVITY':
          await this.handleSuspiciousActivity(page);
          break;
          
        case 'CONFIRM_RECOVERY':
          await this.confirmRecoveryInfo(page, account);
          break;
          
        default:
          console.log(chalk.yellow(`알 수 없는 챌린지: ${challenge}`));
          await this.delay(3000);
      }
      
      retries++;
      await this.delay(3000);
    }
  }

  /**
   * 챌린지 유형 감지
   */
  async detectChallenge(page) {
    // 복구 이메일 옵션
    const recoveryOption = await page.$(this.selectors.recoveryEmailOption);
    if (recoveryOption) {
      return 'RECOVERY_EMAIL';
    }
    
    // TOTP 입력 필드
    const totpInput = await page.$(this.selectors.totpInput);
    if (totpInput) {
      return 'TOTP';
    }
    
    // CAPTCHA
    const captcha = await page.$(this.selectors.captchaFrame);
    if (captcha) {
      return 'CAPTCHA';
    }
    
    // 의심스러운 활동
    const pageText = await page.content();
    if (pageText.includes('unusual activity') || pageText.includes('의심스러운 활동')) {
      return 'SUSPICIOUS_ACTIVITY';
    }
    
    // 복구 정보 확인
    if (pageText.includes('Confirm your recovery') || pageText.includes('복구 정보 확인')) {
      return 'CONFIRM_RECOVERY';
    }
    
    // "다른 방법 시도" 버튼
    const tryAnother = await page.$(this.selectors.tryAnotherWay);
    if (tryAnother) {
      // 다른 방법 시도 클릭
      await tryAnother.click();
      await this.delay(2000);
      return await this.detectChallenge(page); // 재귀적으로 다시 확인
    }
    
    return null;
  }

  /**
   * 복구 이메일 처리
   */
  async handleRecoveryEmail(page, recoveryEmail) {
    if (!recoveryEmail) {
      throw new Error('복구 이메일이 제공되지 않았습니다');
    }
    
    console.log(chalk.cyan('📧 복구 이메일 처리...'));
    
    // 복구 이메일 옵션 클릭
    const recoveryOption = await page.$(this.selectors.recoveryEmailOption);
    if (recoveryOption) {
      await recoveryOption.click();
      await this.delay(2000);
    }
    
    // 복구 이메일 입력
    await page.waitForSelector(this.selectors.recoveryEmailInput, {
      visible: true,
      timeout: 10000
    });
    
    await this.humanType(page, this.selectors.recoveryEmailInput, recoveryEmail);
    
    await this.delay(1000);
    
    // Enter 키 또는 다음 버튼
    await page.keyboard.press('Enter');
    
    await this.delay(3000);
  }

  /**
   * TOTP 2FA 처리
   */
  async handleTOTP(page, totpSecret) {
    if (!totpSecret) {
      throw new Error('TOTP 시크릿 키가 제공되지 않았습니다');
    }
    
    console.log(chalk.cyan('🔑 TOTP 2FA 코드 생성...'));
    
    // TOTP 코드 생성
    const token = speakeasy.totp({
      secret: totpSecret,
      encoding: 'base32',
      window: 1 // 30초 윈도우
    });
    
    console.log(chalk.gray(`생성된 코드: ${token}`));
    
    // TOTP 입력
    await page.waitForSelector(this.selectors.totpInput, {
      visible: true,
      timeout: 10000
    });
    
    // 빠른 입력 (시간 제한 있음)
    await page.type(this.selectors.totpInput, token, { delay: 50 });
    
    await this.delay(500);
    
    // 확인 버튼 클릭 또는 Enter
    const totpNext = await page.$(this.selectors.totpNext);
    if (totpNext) {
      await totpNext.click();
    } else {
      await page.keyboard.press('Enter');
    }
    
    await this.delay(3000);
  }

  /**
   * 의심스러운 활동 처리
   */
  async handleSuspiciousActivity(page) {
    console.log(chalk.yellow('⚠️ 의심스러운 활동 확인 처리...'));
    
    // "예, 저입니다" 버튼 찾기
    const yesButton = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => 
        b.textContent.includes('예') || 
        b.textContent.includes('Yes') ||
        b.textContent.includes('저입니다')
      );
    });
    
    if (yesButton) {
      await yesButton.click();
      await this.delay(3000);
    }
  }

  /**
   * 복구 정보 확인
   */
  async confirmRecoveryInfo(page, account) {
    console.log(chalk.yellow('📝 복구 정보 확인...'));
    
    // 페이지에 복구 이메일이 부분적으로 표시되는지 확인
    const pageContent = await page.content();
    
    if (account.recoveryEmail && pageContent.includes(account.recoveryEmail.substring(0, 3))) {
      // 확인 버튼 클릭
      const confirmButton = await page.$(this.selectors.confirmButton);
      if (confirmButton) {
        await confirmButton.click();
        await this.delay(3000);
      }
    }
  }

  /**
   * 로그인 성공 확인
   */
  async verifyLoginSuccess(page) {
    try {
      // 여러 방법으로 로그인 확인
      
      // 1. URL 확인
      const url = page.url();
      if (url.includes('myaccount.google.com') || 
          url.includes('mail.google.com') || 
          url.includes('youtube.com')) {
        return true;
      }
      
      // 2. 쿠키 확인
      const cookies = await page.cookies();
      const authCookies = cookies.filter(c => 
        c.name === 'SID' || 
        c.name === 'HSID' || 
        c.name === 'SSID' ||
        c.name === 'SAPISID'
      );
      
      if (authCookies.length > 0) {
        return true;
      }
      
      // 3. 프로필 이미지 확인
      try {
        await page.waitForSelector('img[aria-label*="Google"]', {
          timeout: 5000
        });
        return true;
      } catch (e) {
        // 프로필 이미지 없음
      }
      
      // 4. 에러 메시지 확인
      const errorElement = await page.$(this.selectors.errorMessage);
      if (errorElement) {
        const errorText = await errorElement.textContent();
        console.log(chalk.red(`로그인 에러: ${errorText}`));
        return false;
      }
      
      return false;
      
    } catch (error) {
      console.error('로그인 확인 중 오류:', error);
      return false;
    }
  }

  /**
   * 인간형 타이핑
   */
  async humanType(page, selector, text) {
    const element = await page.$(selector);
    await element.click();
    
    for (const char of text) {
      const delay = this.randomDelay(
        this.humanTypingDelay.min, 
        this.humanTypingDelay.max
      );
      await page.keyboard.type(char, { delay });
    }
  }

  /**
   * 에러 캡처
   */
  async captureError(page, email, errorMessage) {
    try {
      const timestamp = Date.now();
      const emailPrefix = email.split('@')[0];
      const screenshotPath = `screenshots/login-error-${emailPrefix}-${timestamp}.png`;
      
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      
      console.log(chalk.gray(`📸 에러 스크린샷: ${screenshotPath}`));
      
    } catch (e) {
      console.error('스크린샷 저장 실패:', e);
    }
  }

  /**
   * 랜덤 지연
   */
  randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GoogleAuthService;