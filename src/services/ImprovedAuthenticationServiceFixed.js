/**
 * Improved Authentication Service - 개선된 버전
 *
 * 주요 개선사항:
 * 1. 페이지 로딩 60초 타임아웃 추가
 * 2. Stuck 페이지 감지 및 자동 복구
 * 3. 무한 루프 방지를 위한 재시도 제한
 * 4. 대체 비밀번호 입력 방법 추가
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

class ImprovedAuthenticationServiceFixed {
  constructor(config = {}) {
    this.config = {
      debugMode: false,
      maxLoginAttempts: 3,
      maxStuckRetries: 2,        // stuck 상태 최대 재시도 횟수
      pageLoadTimeout: 60000,     // 60초 페이지 로드 타임아웃
      stuckDetectionTime: 30000,  // 30초 후 stuck 감지
      waitTimes: {
        pageLoad: 3000,
        elementLoad: 2000,
        afterAction: 1500,
        betweenRetries: 3000,
        stuckRecovery: 5000      // stuck 복구 후 대기 시간
      },
      ...config
    };

    this.stuckPageCounter = 0;
    this.lastPageType = null;
    this.samePageTypeCount = 0;
  }

  /**
   * 개선된 로그인 수행 - stuck 감지 및 복구 포함
   */
  async performLogin(page, credentials, options = {}) {
    if (!credentials || !credentials.email) {
      throw new Error('자격 증명이 필요합니다');
    }

    console.log(chalk.blue(`\n🔐 [로그인 프로세스] ${credentials.email} 계정 로그인 시작`));

    let attempts = 0;
    const maxAttempts = options.maxAttempts || this.config.maxLoginAttempts;
    this.stuckPageCounter = 0; // 초기화

    while (attempts < maxAttempts) {
      attempts++;
      console.log(chalk.gray(`  로그인 시도 ${attempts}/${maxAttempts}`));

      try {
        // 개선된 로그인 시도
        const result = await this.attemptLoginWithTimeout(page, credentials, options);

        if (result.success) {
          console.log(chalk.green('✅ 로그인 성공!'));
          return {
            success: true,
            isLoggedIn: true,
            email: credentials.email
          };
        }

        // Stuck 타임아웃으로 실패한 경우
        if (result.error === 'STUCK_TIMEOUT') {
          console.log(chalk.yellow('\n⚠️ 페이지 로딩 타임아웃 - 처음부터 다시 시도'));

          this.stuckPageCounter++;
          if (this.stuckPageCounter >= this.config.maxStuckRetries) {
            console.log(chalk.red('❌ 최대 stuck 재시도 횟수 초과'));
            return {
              success: false,
              error: 'MAX_STUCK_RETRIES',
              message: '페이지 로딩이 반복적으로 실패함',
              skipRetry: true
            };
          }

          // 페이지 새로고침 또는 재시작
          await this.restartLoginFromBeginning(page);
          await new Promise(r => setTimeout(r, this.config.waitTimes.stuckRecovery));
          continue;
        }

        // reCAPTCHA나 기타 복구 불가능한 에러
        if (result.skipRetry) {
          return result;
        }

      } catch (error) {
        console.log(chalk.red(`❌ 로그인 시도 ${attempts} 실패: ${error.message}`));

        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, this.config.waitTimes.betweenRetries));
        }
      }
    }

    console.log(chalk.red('❌ 모든 로그인 시도 실패'));
    return { success: false, isLoggedIn: false };
  }

  /**
   * 타임아웃이 적용된 로그인 시도
   */
  async attemptLoginWithTimeout(page, credentials, options = {}) {
    const loginStartTime = Date.now();
    const maxLoginTime = this.config.pageLoadTimeout;
    const maxSteps = 10;
    let currentStep = 0;
    let lastProgressTime = Date.now();
    let currentPageType = null;

    // Progress 모니터링
    const progressMonitor = setInterval(() => {
      const elapsed = Date.now() - lastProgressTime;
      const totalElapsed = Date.now() - loginStartTime;

      // Stuck 감지
      if (elapsed > this.config.stuckDetectionTime) {
        console.log(chalk.yellow(`\n⚠️ 정체 감지: ${Math.floor(elapsed/1000)}초 동안 진행 없음`));
      }

      // 타임아웃 체크
      if (totalElapsed > maxLoginTime) {
        console.log(chalk.red(`\n⏱️ 로그인 타임아웃: 60초 초과`));
      }
    }, 5000);

    try {
      while (currentStep < maxSteps) {
        currentStep++;

        // 타임아웃 체크
        if (Date.now() - loginStartTime > maxLoginTime) {
          console.log(chalk.red('⏱️ 로그인 타임아웃 (60초 초과)'));
          clearInterval(progressMonitor);
          return {
            success: false,
            error: 'STUCK_TIMEOUT',
            message: '로그인 페이지 로딩 시간 초과',
            skipRetry: false
          };
        }

        // 현재 페이지 정보
        const currentUrl = page.url();
        console.log(chalk.cyan(`\n[단계 ${currentStep}] URL: ${currentUrl.substring(0, 80)}...`));

        // 페이지 타입 감지
        currentPageType = await this.detectPageTypeWithTimeout(page, 10000);
        console.log(chalk.gray(`  페이지 타입: ${currentPageType}`));

        // 같은 페이지 타입이 반복되는지 체크
        if (currentPageType === this.lastPageType) {
          this.samePageTypeCount++;

          if (this.samePageTypeCount >= 3) {
            console.log(chalk.yellow(`⚠️ 같은 페이지 타입이 3번 반복됨: ${currentPageType}`));

            // 비밀번호 페이지에서 stuck인 경우 특별 처리
            if (currentPageType === 'password_input') {
              console.log(chalk.yellow('비밀번호 입력 페이지 stuck - 대체 방법 시도'));
              const altResult = await this.handlePasswordLoginAlternative(page, credentials, options);
              if (altResult.success) {
                clearInterval(progressMonitor);
                return altResult;
              }
            }

            clearInterval(progressMonitor);
            return {
              success: false,
              error: 'STUCK_TIMEOUT',
              message: `페이지 "${currentPageType}"에서 진행 없음`,
              skipRetry: false
            };
          }
        } else {
          this.samePageTypeCount = 0;
        }
        this.lastPageType = currentPageType;
        lastProgressTime = Date.now(); // 진행 상황 업데이트

        // 페이지 타입별 처리
        switch (currentPageType) {
          case 'email_input':
            console.log('📧 이메일 입력 페이지');
            const emailResult = await this.handleEmailLogin(page, credentials, options);
            if (!emailResult.success) {
              clearInterval(progressMonitor);
              return emailResult;
            }
            break;

          case 'password_input':
            console.log('🔑 비밀번호 입력 페이지');
            const pwResult = await this.handlePasswordLoginWithTimeout(page, credentials, options);
            if (pwResult.success) {
              clearInterval(progressMonitor);
              return pwResult;
            }
            if (pwResult.error === 'TIMEOUT') {
              clearInterval(progressMonitor);
              return {
                success: false,
                error: 'STUCK_TIMEOUT',
                message: '비밀번호 입력 페이지 타임아웃',
                skipRetry: false
              };
            }
            break;

          case 'logged_in':
            console.log(chalk.green('✅ 로그인 완료'));
            clearInterval(progressMonitor);
            return { success: true };

          case 'recaptcha':
            console.log(chalk.red('⚠️ reCAPTCHA 감지'));
            clearInterval(progressMonitor);
            return {
              success: false,
              error: 'RECAPTCHA_DETECTED',
              message: 'reCAPTCHA가 감지되어 로그인을 건너뜁니다',
              skipRetry: true
            };

          case 'account_disabled':
            console.log(chalk.red('🚫 계정 사용 중지됨'));
            clearInterval(progressMonitor);
            return {
              success: false,
              error: 'ACCOUNT_DISABLED',
              message: '계정이 사용 중지되었습니다',
              skipRetry: true
            };

          default:
            console.log(chalk.yellow(`⚠️ 알 수 없는 페이지 타입: ${currentPageType}`));
            // 페이지 새로고침 시도
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 3000));
        }

        // 다음 단계로 진행 전 대기
        await new Promise(r => setTimeout(r, 1500));
      }

      clearInterval(progressMonitor);
      return { success: false, error: 'MAX_STEPS_REACHED' };

    } catch (error) {
      clearInterval(progressMonitor);
      console.log(chalk.red(`로그인 프로세스 에러: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 타임아웃이 적용된 페이지 타입 감지
   */
  async detectPageTypeWithTimeout(page, timeout = 10000) {
    try {
      return await Promise.race([
        this.detectPageType(page),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('페이지 타입 감지 타임아웃')), timeout)
        )
      ]);
    } catch (error) {
      console.log(chalk.yellow('⚠️ 페이지 타입 감지 실패'));
      return 'unknown';
    }
  }

  /**
   * 페이지 타입 감지
   */
  async detectPageType(page) {
    try {
      const url = page.url();
      const content = await page.content();

      // URL 기반 감지
      if (url.includes('youtube.com/premium') || url.includes('youtube.com/paid_memberships')) {
        return 'logged_in';
      }

      if (url.includes('accounts.google.com')) {
        // 페이지 내용 기반 감지
        const hasEmailField = content.includes('type="email"') || content.includes('identifier');
        const hasPasswordField = content.includes('type="password"') || content.includes('password');
        const hasRecaptcha = content.includes('recaptcha') || content.includes('g-recaptcha');

        if (hasRecaptcha) return 'recaptcha';
        if (hasPasswordField) return 'password_input';
        if (hasEmailField) return 'email_input';
      }

      if (content.includes('account has been disabled') || content.includes('계정이 사용 중지')) {
        return 'account_disabled';
      }

      return 'unknown';
    } catch (error) {
      return 'error';
    }
  }

  /**
   * 타임아웃이 적용된 비밀번호 입력 처리
   */
  async handlePasswordLoginWithTimeout(page, credentials, options) {
    const startTime = Date.now();
    const timeout = 30000; // 30초 타임아웃

    console.log('🔑 비밀번호 입력 시작...');

    try {
      // 비밀번호 필드 찾기 (타임아웃 적용)
      const passwordInput = await Promise.race([
        page.waitForSelector('input[type="password"]:not([aria-hidden="true"])', {
          visible: true,
          timeout: 15000
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('비밀번호 필드 타임아웃')), 15000)
        )
      ]);

      if (!passwordInput) {
        throw new Error('비밀번호 필드를 찾을 수 없음');
      }

      // 비밀번호 입력
      await passwordInput.click();
      await page.keyboard.type(credentials.password, { delay: 50 + Math.random() * 50 });
      await new Promise(r => setTimeout(r, 500));

      // Next 버튼 클릭
      await page.keyboard.press('Enter');

      // 페이지 로드 대기 (타임아웃 적용)
      console.log('⏳ 로그인 처리 대기 중...');

      // 페이지 변화 감지 (최대 20초)
      const waitTime = 20000;
      const checkInterval = 2000;
      let elapsed = 0;

      while (elapsed < waitTime) {
        await new Promise(r => setTimeout(r, checkInterval));
        elapsed += checkInterval;

        const currentUrl = page.url();

        // 성공적인 로그인 체크
        if (currentUrl.includes('youtube.com')) {
          console.log(chalk.green('✅ YouTube로 리다이렉트 - 로그인 성공'));
          return { success: true };
        }

        // 에러 체크
        const pageType = await this.detectPageType(page);
        if (pageType === 'recaptcha') {
          return { success: false, error: 'RECAPTCHA' };
        }
        if (pageType === 'logged_in') {
          return { success: true };
        }

        console.log(chalk.gray(`  대기 중... (${elapsed/1000}초)`));
      }

      // 타임아웃
      console.log(chalk.yellow('⚠️ 비밀번호 입력 후 페이지 로드 타임아웃'));
      return { success: false, error: 'TIMEOUT' };

    } catch (error) {
      console.log(chalk.red(`비밀번호 입력 실패: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * 대체 비밀번호 입력 방법
   */
  async handlePasswordLoginAlternative(page, credentials, options) {
    console.log(chalk.yellow('🔧 대체 비밀번호 입력 방법 시도'));

    try {
      // JavaScript를 통한 직접 입력
      await page.evaluate((password) => {
        const passwordField = document.querySelector('input[type="password"]');
        if (passwordField) {
          passwordField.value = password;
          passwordField.dispatchEvent(new Event('input', { bubbles: true }));
          passwordField.dispatchEvent(new Event('change', { bubbles: true }));

          // Next 버튼 찾기 및 클릭
          const nextButton = document.querySelector('[jsname="LgbsSe"]') ||
                           document.querySelector('button[type="submit"]');
          if (nextButton) {
            nextButton.click();
          }
        }
      }, credentials.password);

      await new Promise(r => setTimeout(r, 5000));

      // 결과 확인
      const currentUrl = page.url();
      if (currentUrl.includes('youtube.com')) {
        console.log(chalk.green('✅ 대체 방법으로 로그인 성공'));
        return { success: true };
      }

      return { success: false };

    } catch (error) {
      console.log(chalk.red(`대체 방법 실패: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * 로그인 처음부터 다시 시작
   */
  async restartLoginFromBeginning(page) {
    console.log(chalk.blue('🔄 로그인 페이지로 다시 이동...'));

    try {
      // Google 로그인 페이지로 직접 이동
      await page.goto('https://accounts.google.com/signin', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await new Promise(r => setTimeout(r, 3000));

      // 페이지 상태 초기화
      this.samePageTypeCount = 0;
      this.lastPageType = null;

      console.log(chalk.green('✅ 로그인 페이지 재시작 완료'));

    } catch (error) {
      console.log(chalk.red(`로그인 페이지 재시작 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * 이메일 입력 처리 (기본 구현)
   */
  async handleEmailLogin(page, credentials, options) {
    try {
      const emailInput = await page.waitForSelector('input[type="email"]', {
        visible: true,
        timeout: 10000
      });

      await emailInput.click();
      await page.keyboard.type(credentials.email, { delay: 50 });
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 2000));

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ImprovedAuthenticationServiceFixed;