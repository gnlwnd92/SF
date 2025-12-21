/**
 * Google Login Helper with Macro-style Mouse Movement
 * 실제 마우스 움직임을 시뮬레이션하여 자동화 감지 회피
 */

const chalk = require('chalk');
const HumanLikeMouseHelper = require('./HumanLikeMouseHelper');

class GoogleLoginHelperMacro {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      mouseSpeed: config.mouseSpeed || 'normal', // slow, normal, fast
      typingSpeed: config.typingSpeed || 'normal',
      ...config
    };
    
    // 마우스 헬퍼 초기화
    this.mouse = new HumanLikeMouseHelper(page, {
      debugMode: this.config.debugMode,
      moveSpeed: this.config.mouseSpeed,
      jitterAmount: 3 // 약간의 손떨림 효과
    });
    
    this.logger = {
      info: (msg) => console.log(chalk.cyan(msg)),
      success: (msg) => console.log(chalk.green(msg)),
      warning: (msg) => console.log(chalk.yellow(msg)),
      error: (msg) => console.log(chalk.red(msg)),
      debug: (msg) => this.config.debugMode && console.log(chalk.gray(msg))
    };
  }

  /**
   * 랜덤 대기 시간
   */
  async randomWait(min = 500, max = 1500) {
    const waitTime = min + Math.random() * (max - min);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      const currentUrl = this.page.url();
      
      // URL 기반 체크
      if (currentUrl.includes('myaccount.google.com') || 
          currentUrl.includes('youtube.com')) {
        
        // 페이지 내용 기반 추가 확인
        const isLoggedIn = await this.page.evaluate(() => {
          // 로그인 버튼이 없고 프로필 아이콘이 있는지 확인
          const signInButton = document.querySelector('[aria-label*="Sign in"], [aria-label*="로그인"]');
          const profileIcon = document.querySelector('img[alt*="Avatar"], button[aria-label*="Google Account"]');
          
          return !signInButton && !!profileIcon;
        });
        
        return isLoggedIn;
      }
      
      return false;
    } catch (error) {
      this.logger.debug(`로그인 상태 확인 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * Google 계정으로 로그인 (매크로 스타일)
   */
  async login(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('로그인 자격 증명이 없습니다.');
    }
    
    this.logger.info(`\n🖱️ 매크로 스타일 Google 로그인 시작: ${credentials.email}`);
    
    try {
      // 마우스 위치 초기화
      await this.mouse.initializeMousePosition();
      this.logger.debug('마우스 위치 초기화 완료');
      
      // 현재 페이지 확인
      const currentUrl = this.page.url();
      this.logger.debug(`현재 URL: ${currentUrl}`);
      
      // Google 로그인 페이지가 아니면 이동
      if (!currentUrl.includes('accounts.google.com')) {
        await this.page.goto('https://accounts.google.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.randomWait(2000, 3000);
      }
      
      // 계정 선택 화면 처리
      const hasAccountChooser = await this.checkAccountChooser();
      if (hasAccountChooser) {
        await this.handleAccountChooserWithMouse();
      }
      
      // 이메일 입력
      const emailEntered = await this.enterEmailWithMouse(credentials.email);
      if (!emailEntered) {
        throw new Error('이메일 입력 실패');
      }
      
      // Next 버튼 클릭
      await this.clickNextButtonWithMouse();
      
      // 비밀번호 입력
      const passwordEntered = await this.enterPasswordWithMouse(credentials.password);
      if (!passwordEntered) {
        throw new Error('비밀번호 입력 실패');
      }
      
      // 로그인 버튼 클릭
      await this.clickLoginButtonWithMouse();
      
      // 로그인 완료 대기
      await this.waitForLoginComplete();
      
      this.logger.success('✅ 매크로 스타일 로그인 성공');
      return true;
      
    } catch (error) {
      this.logger.error(`로그인 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 계정 선택 화면 확인
   */
  async checkAccountChooser() {
    try {
      const hasAccounts = await this.page.evaluate(() => {
        return document.querySelectorAll('[data-identifier]').length > 0;
      });
      return hasAccounts;
    } catch (error) {
      return false;
    }
  }

  /**
   * 계정 선택 화면 처리 (마우스 이동)
   */
  async handleAccountChooserWithMouse() {
    this.logger.info('🖱️ 계정 선택 화면 처리 (마우스 이동)...');
    
    try {
      // 약간의 대기 (화면 살펴보는 것처럼)
      await this.randomWait(1000, 2000);
      
      // "다른 계정 사용" 텍스트 찾기
      const useAnotherTexts = [
        'Use another account',
        '다른 계정 사용',
        'Add account',
        '계정 추가'
      ];
      
      for (const text of useAnotherTexts) {
        const clicked = await this.mouse.clickByText(text);
        if (clicked) {
          this.logger.success(`✅ "${text}" 클릭 완료 (마우스 이동)`);
          
          // 클릭 후 페이지 전환 대기
          await this.randomWait(2000, 3000);
          
          // SPA 네비게이션 대기
          await Promise.race([
            this.page.waitForSelector('input[type="email"]', { visible: true, timeout: 5000 }),
            this.page.waitForFunction(() => !document.querySelector('[data-identifier]'), { timeout: 5000 }),
            new Promise(r => setTimeout(r, 3000)))
          ]).catch(() => {});
          
          return true;
        }
      }
      
      this.logger.warning('계정 선택 버튼을 찾을 수 없음');
      return false;
      
    } catch (error) {
      this.logger.error(`계정 선택 처리 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 이메일 입력 (마우스로 클릭 후 타이핑)
   */
  async enterEmailWithMouse(email) {
    this.logger.info('🖱️ 이메일 입력 필드로 마우스 이동...');
    
    try {
      // 이메일 입력 필드 대기
      await this.page.waitForSelector('input[type="email"]', {
        visible: true,
        timeout: 10000
      });
      
      // 입력 필드 주변을 먼저 훑어보기 (사람처럼)
      await this.randomWait(500, 1000);
      
      // 마우스로 클릭하고 타이핑
      const typed = await this.mouse.clickAndType('input[type="email"]', email);
      
      if (typed) {
        this.logger.success(`✅ 이메일 입력 완료: ${email}`);
        await this.randomWait(500, 1000);
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.error(`이메일 입력 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * Next 버튼 클릭 (마우스 이동)
   */
  async clickNextButtonWithMouse() {
    this.logger.info('🖱️ Next 버튼으로 마우스 이동...');
    
    try {
      await this.randomWait(500, 1000);
      
      // Next 버튼 찾기
      const nextButtonSelectors = [
        '#identifierNext',
        'button#identifierNext',
        'div#identifierNext'
      ];
      
      for (const selector of nextButtonSelectors) {
        const clicked = await this.mouse.clickElement(selector);
        if (clicked) {
          this.logger.success('✅ Next 버튼 클릭 (마우스)');
          
          // 페이지 전환 대기
          await this.randomWait(2000, 3000);
          
          // SPA 네비게이션 대기
          await Promise.race([
            this.page.waitForSelector('input[type="password"]', { timeout: 5000 }),
            this.page.waitForSelector('[aria-live="assertive"]', { timeout: 5000 }),
            new Promise(r => setTimeout(r, 3000)))
          ]).catch(() => {});
          
          return true;
        }
      }
      
      // 폴백: Enter 키 사용
      this.logger.warning('Next 버튼을 찾을 수 없어 Enter 키 사용');
      await this.page.keyboard.press('Enter');
      await this.randomWait(2000, 3000);
      
      return true;
      
    } catch (error) {
      this.logger.error(`Next 버튼 클릭 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 비밀번호 입력 (마우스로 클릭 후 타이핑)
   */
  async enterPasswordWithMouse(password) {
    this.logger.info('🖱️ 비밀번호 입력 필드로 마우스 이동...');
    
    try {
      // 비밀번호 입력 필드 대기
      await this.page.waitForSelector('input[type="password"]', {
        visible: true,
        timeout: 10000
      });
      
      // 잠시 망설이기 (사람처럼)
      await this.randomWait(800, 1500);
      
      // 마우스로 클릭하고 타이핑
      const typed = await this.mouse.clickAndType('input[type="password"]', password);
      
      if (typed) {
        this.logger.success('✅ 비밀번호 입력 완료');
        await this.randomWait(500, 1000);
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.error(`비밀번호 입력 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 로그인 버튼 클릭 (마우스 이동)
   */
  async clickLoginButtonWithMouse() {
    this.logger.info('🖱️ 로그인 버튼으로 마우스 이동...');
    
    try {
      await this.randomWait(500, 1000);
      
      // 로그인 버튼 찾기
      const loginButtonSelectors = [
        '#passwordNext',
        'button#passwordNext',
        'div#passwordNext',
        'button[jsname="LgbsSe"]',
        'div[role="button"][jsname="LgbsSe"]'
      ];
      
      for (const selector of loginButtonSelectors) {
        const element = await this.page.$(selector);
        if (element) {
          // 요소가 보이는지 확인
          const isVisible = await this.page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, element);
          
          if (isVisible) {
            const clicked = await this.mouse.clickElement(selector);
            if (clicked) {
              this.logger.success(`✅ 로그인 버튼 클릭 (${selector})`);
              
              // 로그인 처리 대기
              await this.randomWait(3000, 5000);
              return true;
            }
          }
        }
      }
      
      // 폴백: 텍스트로 버튼 찾기
      const textClicked = await this.mouse.clickByText('Next') || 
                          await this.mouse.clickByText('다음') ||
                          await this.mouse.clickByText('Sign in') ||
                          await this.mouse.clickByText('로그인');
      
      if (textClicked) {
        this.logger.success('✅ 로그인 버튼 클릭 (텍스트)');
        await this.randomWait(3000, 5000);
        return true;
      }
      
      // 최후의 수단: Enter 키
      this.logger.warning('로그인 버튼을 찾을 수 없어 Enter 키 사용');
      await this.page.keyboard.press('Enter');
      await this.randomWait(3000, 5000);
      
      return true;
      
    } catch (error) {
      this.logger.error(`로그인 버튼 클릭 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 로그인 완료 대기
   */
  async waitForLoginComplete() {
    try {
      this.logger.info('⏳ 로그인 완료 대기...');
      
      // URL 변경 또는 YouTube 페이지 이동 대기
      await this.page.waitForFunction(
        () => {
          const url = window.location.href;
          return !url.includes('accounts.google.com') || url.includes('youtube.com');
        },
        { timeout: 15000 }
      ).catch(() => {});
      
      await this.randomWait(2000, 3000);
      
      const finalUrl = this.page.url();
      this.logger.debug(`최종 URL: ${finalUrl}`);
      
      return !finalUrl.includes('accounts.google.com');
      
    } catch (error) {
      this.logger.warning('로그인 완료 대기 시간 초과');
      return false;
    }
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      const currentUrl = this.page.url();
      
      // 로그인 페이지인지 확인
      if (currentUrl.includes('accounts.google.com')) {
        return false;
      }
      
      // YouTube에서 로그인 상태 확인
      if (currentUrl.includes('youtube.com')) {
        const isLoggedIn = await this.page.evaluate(() => {
          const avatarBtn = document.querySelector('#avatar-btn, button#avatar-btn');
          const signInLink = document.querySelector('a[href*="accounts.google.com/ServiceLogin"]');
          
          return avatarBtn !== null && signInLink === null;
        });
        
        return isLoggedIn;
      }
      
      return true;
      
    } catch (error) {
      this.logger.error(`로그인 상태 확인 실패: ${error.message}`);
      return false;
    }
  }
}

module.exports = GoogleLoginHelperMacro;