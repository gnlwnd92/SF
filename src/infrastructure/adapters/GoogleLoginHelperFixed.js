/**
 * Google Login Helper Fixed
 * evaluateOnNewDocument 제거하여 자동화 감지 문제 해결
 */

const chalk = require('chalk');

class GoogleLoginHelperFixed {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    this.logger = {
      info: (msg) => console.log(chalk.cyan(msg)),
      success: (msg) => console.log(chalk.green(msg)),
      warning: (msg) => console.log(chalk.yellow(msg)),
      error: (msg) => console.log(chalk.red(msg)),
      debug: (msg) => this.config.debugMode && console.log(chalk.gray(msg))
    };
  }

  /**
   * Google 계정으로 로그인 (단순화된 버전)
   */
  async login(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('로그인 자격 증명이 없습니다.');
    }
    
    this.logger.info(`\n🔐 Google 계정 로그인 시작: ${credentials.email}`);
    
    try {
      // 현재 페이지 확인
      const currentUrl = this.page.url();
      this.logger.debug(`현재 URL: ${currentUrl}`);
      
      // Google 로그인 페이지가 아니면 이동
      if (!currentUrl.includes('accounts.google.com')) {
        await this.page.goto('https://accounts.google.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(r => setTimeout(r, 2000));
      }
      
      // 계정 선택 화면 처리
      const hasAccountChooser = await this.page.evaluate(() => {
        return document.querySelectorAll('[data-identifier]').length > 0;
      });
      
      if (hasAccountChooser) {
        await this.handleAccountChooser();
      }
      
      // 이메일 입력
      const emailEntered = await this.enterEmail(credentials.email);
      if (!emailEntered) {
        throw new Error('이메일 입력 실패');
      }
      
      // 비밀번호 입력
      const passwordEntered = await this.enterPassword(credentials.password);
      if (!passwordEntered) {
        throw new Error('비밀번호 입력 실패');
      }
      
      // 로그인 완료 대기
      await this.waitForLoginComplete();
      
      this.logger.success('✅ Google 로그인 성공');
      return true;
      
    } catch (error) {
      this.logger.error(`로그인 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 계정 선택 화면 처리
   */
  async handleAccountChooser() {
    this.logger.info('계정 선택 화면 처리 중...');
    
    try {
      // "다른 계정 사용" 찾기
      const useAnotherTexts = [
        'Use another account',
        '다른 계정 사용',
        'Add account',
        '계정 추가'
      ];
      
      for (const text of useAnotherTexts) {
        const [element] = await this.page.$x(`//*[contains(text(), "${text}")]`);
        if (element) {
          this.logger.debug(`"${text}" 버튼 발견`);
          
          // Native click 사용
          await element.click();
          this.logger.success('"다른 계정 사용" 클릭 완료');
          
          // SPA 네비게이션 대기
          await Promise.race([
            this.page.waitForSelector('input[type="email"]', { visible: true, timeout: 5000 }),
            this.page.waitForFunction(() => !document.querySelector('[data-identifier]'), { timeout: 5000 }),
            new Promise(r => setTimeout(r, 3000)))
          ]).catch(() => {});
          
          return true;
        }
      }
      
      this.logger.warning('"다른 계정 사용" 버튼을 찾을 수 없음');
      return false;
      
    } catch (error) {
      this.logger.error(`계정 선택 처리 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 이메일 입력
   */
  async enterEmail(email) {
    this.logger.info('이메일 입력 중...');
    
    try {
      // 이메일 입력 필드 대기
      const emailInput = await this.page.waitForSelector('input[type="email"]', {
        visible: true,
        timeout: 10000
      });
      
      if (!emailInput) {
        throw new Error('이메일 입력 필드를 찾을 수 없습니다');
      }
      
      // 기존 내용 삭제
      await emailInput.click({ clickCount: 3 });
      await this.page.keyboard.press('Backspace');
      
      // 이메일 입력
      await emailInput.type(email, { delay: 100 });
      this.logger.success(`이메일 입력 완료: ${email}`);
      
      // Next 버튼 클릭
      const nextButton = await this.page.$('#identifierNext');
      if (nextButton) {
        await nextButton.click();
        this.logger.success('Next 버튼 클릭');
        
        // SPA 네비게이션 대기
        await Promise.race([
          this.page.waitForSelector('input[type="password"]', { timeout: 5000 }),
          this.page.waitForSelector('[aria-live="assertive"]', { timeout: 5000 }),
          new Promise(r => setTimeout(r, 3000)))
        ]).catch(() => {});
      }
      
      return true;
      
    } catch (error) {
      this.logger.error(`이메일 입력 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 비밀번호 입력
   */
  async enterPassword(password) {
    this.logger.info('비밀번호 입력 중...');
    
    try {
      // 비밀번호 입력 필드 대기
      const passwordInput = await this.page.waitForSelector('input[type="password"]', {
        visible: true,
        timeout: 10000
      });
      
      if (!passwordInput) {
        throw new Error('비밀번호 입력 필드를 찾을 수 없습니다');
      }
      
      // 비밀번호 입력
      await passwordInput.type(password, { delay: 100 });
      this.logger.success('비밀번호 입력 완료');
      
      // Next 버튼 클릭 - 여러 선택자 시도
      const nextButtonSelectors = [
        '#passwordNext',
        'button[jsname="LgbsSe"]',
        'div[role="button"][jsname="LgbsSe"]'
      ];
      
      let clicked = false;
      for (const selector of nextButtonSelectors) {
        const button = await this.page.$(selector);
        if (button) {
          const isVisible = await this.page.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }, button);
          
          if (isVisible) {
            await button.click();
            this.logger.success(`로그인 버튼 클릭 (${selector})`);
            clicked = true;
            break;
          }
        }
      }
      
      if (!clicked) {
        // 폴백: 텍스트로 버튼 찾기
        const [nextButton] = await this.page.$x('//button[contains(., "Next") or contains(., "다음")]');
        if (nextButton) {
          await nextButton.click();
          this.logger.success('로그인 버튼 클릭 (텍스트 검색)');
        }
      }
      
      // 로그인 완료 대기
      await new Promise(r => setTimeout(r, 3000));
      
      return true;
      
    } catch (error) {
      this.logger.error(`비밀번호 입력 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 로그인 완료 대기
   */
  async waitForLoginComplete() {
    try {
      // URL 변경 또는 YouTube 페이지 이동 대기
      await this.page.waitForFunction(
        () => {
          const url = window.location.href;
          return !url.includes('accounts.google.com') || url.includes('youtube.com');
        },
        { timeout: 10000 }
      ).catch(() => {});
      
      await new Promise(r => setTimeout(r, 2000));
      
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
          // 아바타 버튼이나 계정 메뉴 확인
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

module.exports = GoogleLoginHelperFixed;