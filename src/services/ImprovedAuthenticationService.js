/**
 * 개선된 인증 서비스
 * - Google 계정 선택 페이지 처리
 * - 로그아웃된 계정 클릭 지원
 * - 휴먼라이크 마우스 동작
 * - 이미지 CAPTCHA 자동 해결 (Anti-Captcha API)
 */

const chalk = require('chalk');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const ImprovedAccountChooserHandler = require('./ImprovedAccountChooserHandler');
const AntiCaptchaService = require('./AntiCaptchaService');

class ImprovedAuthenticationService {
  constructor(config = {}) {
    this.config = {
      debugMode: false,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24시간
      maxLoginAttempts: 3,
      waitTimes: {
        pageLoad: 3000,
        elementLoad: 2000,
        afterAction: 1500,
        betweenRetries: 3000
      },
      ...config
    };

    this.sessions = new Map();
    this.loginCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5분

    // Anti-Captcha 서비스 초기화
    this.antiCaptchaService = new AntiCaptchaService({
      apiKey: config.antiCaptchaApiKey || process.env.ANTI_CAPTCHA_API_KEY,
      debugMode: this.config.debugMode
    });

    this.log('✅ ImprovedAuthenticationService 초기화 완료', 'success');
  }

  /**
   * 로그인 수행
   */
  async performLogin(page, credentials, options = {}) {
    if (!credentials || !credentials.email) {
      throw new Error('자격 증명이 필요합니다');
    }
    
    this.log(`🔐 로그인 시작: ${credentials.email}`, 'info');
    console.log(chalk.blue(`\n  [로그인 프로세스] ${credentials.email} 계정 로그인 시작`));
    
    let attempts = 0;
    const maxAttempts = options.maxAttempts || this.config.maxLoginAttempts;
    
    while (attempts < maxAttempts) {
      attempts++;
      this.log(`로그인 시도 ${attempts}/${maxAttempts}`, 'info');
      console.log(chalk.gray(`  로그인 시도 ${attempts}/${maxAttempts}`));
      
      // 로그인 시도 전 스크린샷
      const timestamp = Date.now();
      try {
        const screenshotPath = `screenshots/debug/login-attempt-${attempts}-${timestamp}.png`;
        await this.saveScreenshot(page, screenshotPath);
        console.log(chalk.gray(`  📸 로그인 시도 전 스크린샷: ${screenshotPath}`));
      } catch (e) {
        // 무시
      }
      
      try {
        // 로그인 시도
        const result = await this.attemptLogin(page, credentials, options);
        
        if (result.success) {
          this.log('✅ 로그인 성공!', 'success');
          
          // 세션 저장
          this.saveSession(credentials.email, {
            loginTime: new Date().toISOString(),
            profileId: options.profileId,
            success: true
          });
          
          // 캐시 업데이트
          this.setCachedLoginStatus(options.profileId || 'default', {
            isLoggedIn: true,
            email: credentials.email,
            timestamp: Date.now()
          });
          
          return { 
            success: true, 
            isLoggedIn: true,
            email: credentials.email 
          };
        }
        
        // reCAPTCHA나 skipRetry가 설정된 경우 재시도하지 않음
        if (result.skipRetry || result.error === 'RECAPTCHA_DETECTED') {
          this.log(`재시도 스킵: ${result.message}`, 'info');
          return result;
        }
        
      } catch (error) {
        this.log(`로그인 시도 ${attempts} 실패: ${error.message}`, 'warning');
        
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, this.config.waitTimes.betweenRetries));
        }
      }
    }
    
    this.log('❌ 모든 로그인 시도 실패', 'error');
    return { success: false, isLoggedIn: false };
  }

  /**
   * 타임아웃이 있는 page.evaluate 래퍼
   */
  async evaluateWithTimeout(page, func, timeout = 30000) {
    try {
      // 기존 타임아웃 저장
      const originalTimeout = page.getDefaultTimeout();

      // 새 타임아웃 설정
      page.setDefaultTimeout(timeout);

      try {
        const result = await page.evaluate(func);
        return result;
      } finally {
        // 원래 타임아웃 복원
        page.setDefaultTimeout(originalTimeout);
      }
    } catch (error) {
      if (error.message.includes('timed out')) {
        this.log(`⚠️ 페이지 평가 타임아웃 (${timeout}ms)`, 'warning');
        throw new Error(`Page evaluation timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * 실제 로그인 시도
   */
  async attemptLogin(page, credentials, options = {}) {
    // 페이지 기본 타임아웃 증가
    const originalTimeout = page.getDefaultTimeout();
    page.setDefaultTimeout(30000); // 30초로 증가

    // 로그인 시작 시간 기록 (타임아웃 체크용)
    const loginStartTime = Date.now();
    const maxLoginTime = 180000; // 3분으로 증가
    const maxSteps = 10; // 최대 단계 수 (무한 루프 방지)
    let currentStep = 0;

    try {
      while (currentStep < maxSteps) {
        currentStep++;

        // 타임아웃 체크
        if (Date.now() - loginStartTime > maxLoginTime) {
          this.log('⏱️ 로그인 타임아웃 (2분 초과)', 'error');
          console.log(chalk.red('    ⏱️ 로그인 프로세스 타임아웃'));
          return {
            success: false,
            error: 'LOGIN_TIMEOUT',
            message: '로그인 시간 초과',
            skipRetry: true
          };
        }

        // 현재 페이지 URL 확인
        let currentUrl = page.url();
        this.log(`[단계 ${currentStep}] 현재 URL: ${currentUrl}`, 'debug');
        console.log(chalk.cyan(`\n[ImprovedAuth] 단계 ${currentStep}: ${currentUrl.substring(0, 80)}...`));

        // 페이지 타입 확인
        const pageType = await this.detectPageType(page);
        this.log(`[단계 ${currentStep}] 페이지 타입: ${pageType}`, 'info');

        // 페이지 타입에 따른 처리
        let result;

        switch (pageType) {
          case 'adspower_start':
            this.log('🌐 AdsPower 시작 페이지 감지됨 - Google 로그인으로 이동', 'info');
            console.log(chalk.cyan('  🌐 AdsPower 시작 페이지에서 Google 로그인 페이지로 이동합니다...'));

            // Google 로그인 페이지로 이동
            await page.goto('https://accounts.google.com/signin', {
              waitUntil: 'networkidle2',
              timeout: 30000
            });

            // 페이지 로드 대기
            await new Promise(r => setTimeout(r, 2000));
            console.log(chalk.green('  ✅ Google 로그인 페이지로 이동 완료'));
            continue; // 다음 단계로 계속

          case 'browser_error':
            this.log('⚠️ 브라우저 오류 페이지 감지됨', 'warning');
            return await this.handleBrowserErrorPage(page, options);

          case 'error_page':
            this.log('⚠️ Google 로그인 오류 페이지 감지됨', 'warning');
            result = await this.handleErrorPage(page, options);
            if (result.success) {
              // 다시 시도 버튼 클릭 후 다음 단계 계속
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            return result;

          case 'account_disabled':
            this.log('🚫 계정 사용 중지됨', 'error');
            console.log(chalk.red('\n🚫 계정이 사용 중지되었습니다'));

            // 스크린샷 저장
            if (options.screenshotEnabled) {
              const timestamp = Date.now();
              await page.screenshot({
                path: `screenshots/account_disabled_${timestamp}.png`
              });
              console.log(chalk.gray(`📸 계정 사용 중지 스크린샷 저장: account_disabled_${timestamp}.png`));
            }

            // 페이지의 에러 메시지 추출
            const errorMessage = await page.evaluate(() => {
              const errorText = document.body?.textContent || '';
              if (errorText.includes('Google 계정에서 평소와 다른 활동이 감지되어')) {
                return 'Google 계정에서 평소와 다른 활동이 감지되어 계정이 사용 중지되었습니다';
              } else if (errorText.includes('계정 사용 중지됨')) {
                return '계정이 사용 중지되었습니다';
              } else if (errorText.includes('Your account has been disabled')) {
                return 'Account has been disabled';
              }
              return '계정 사용 중지';
            });

            return {
              success: false,
              error: 'ACCOUNT_DISABLED',
              message: errorMessage,
              status: 'account_disabled',
              skipRetry: true
            };

          case 'passkey_enrollment':
            this.log('🔑 패스키 등록 페이지 감지됨', 'info');
            result = await this.handlePasskeyEnrollmentPage(page, options);
            if (result.success) {
              // 패스키 건너뛴 후 다음 단계 계속
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            return result;

          case 'image_captcha':
            // ========== 이미지 CAPTCHA 감지 - 재시도 필요 ==========
            // Anti-Captcha API 대신 브라우저를 닫고 재시도하는 전략 사용
            // CAPTCHA는 IP/세션 기반이므로 새 세션에서는 안 나타날 수 있음
            this.log('🖼️ 이미지 CAPTCHA 감지됨 - 재시도 필요', 'warning');
            console.log(chalk.yellow('\n  🖼️ 이미지 CAPTCHA 감지됨!'));
            console.log(chalk.yellow('     → 브라우저를 닫고 재시도합니다...'));

            // 스크린샷 저장
            if (options.screenshotEnabled) {
              try {
                await page.screenshot({
                  path: `screenshots/image_captcha_${Date.now()}.png`
                });
              } catch (e) {
                // 스크린샷 실패 무시
              }
            }

            // skipRetry: false로 설정하여 워크플로우에서 재시도 가능하게 함
            return {
              success: false,
              error: 'IMAGE_CAPTCHA_DETECTED',
              message: 'CAPTCHA 감지됨 - 브라우저 재시작 후 재시도 필요',
              status: 'captcha_detected',
              skipRetry: false,  // ★ 재시도 허용
              shouldRetry: true,  // ★ 재시도 플래그
              retryReason: 'image_captcha'
            };

          case 'recaptcha':
            this.log('⚠️ reCAPTCHA 감지됨', 'warning');
            if (options.screenshotEnabled) {
              await page.screenshot({
                path: `screenshots/recaptcha_detected_${Date.now()}.png`
              });
            }
            return {
              success: false,
              error: 'RECAPTCHA_DETECTED',
              message: 'reCAPTCHA 인증 필요',
              status: 'recaptcha_detected',
              skipRetry: true
            };

          case 'phone_verification':
            this.log('📱 전화번호 인증 페이지 감지됨', 'warning');
            if (options.screenshotEnabled) {
              await page.screenshot({
                path: `screenshots/phone_verification_${Date.now()}.png`
              });
            }
            return {
              success: false,
              error: 'PHONE_VERIFICATION_REQUIRED',
              message: '번호인증 필요',
              status: 'phone_verification_required',
              skipRetry: true
            };

          case 'identity_confirmation':
            // ========== 본인 확인 페이지 처리 ==========
            // "본인 인증" 페이지: "다음" 버튼 클릭 → 비밀번호 입력 페이지로 이동
            // CAPTCHA나 전화번호 인증과 다르게 자동 처리 가능
            this.log('🔐 본인 확인 페이지 감지됨 - "다음" 버튼 클릭 시도', 'info');
            console.log(chalk.cyan('\n  🔐 본인 확인 페이지 감지됨 (Identity Confirmation)'));
            console.log(chalk.gray('     → "다음" 버튼 클릭 후 비밀번호 입력 페이지로 이동합니다'));

            // 스크린샷 저장
            if (options.screenshotEnabled) {
              await page.screenshot({
                path: `screenshots/identity_confirmation_${Date.now()}.png`
              });
            }

            try {
              // "다음" 버튼 클릭
              const nextButtonClicked = await this.clickNextButton(page);

              if (nextButtonClicked) {
                console.log(chalk.green('  ✅ "다음" 버튼 클릭 성공'));
                this.log('"다음" 버튼 클릭 성공 - 비밀번호 입력 대기', 'success');

                // 페이지 로드 대기
                await new Promise(r => setTimeout(r, 3000));
                continue;  // 다음 단계 (비밀번호 입력)로 계속
              } else {
                console.log(chalk.yellow('  ⚠️ "다음" 버튼을 찾을 수 없음 - 다음 단계 시도'));
                this.log('"다음" 버튼을 찾을 수 없음', 'warning');
                await new Promise(r => setTimeout(r, 2000));
                continue;  // 다음 단계로 시도
              }
            } catch (identityError) {
              this.log(`본인 확인 페이지 처리 오류: ${identityError.message}`, 'error');
              console.log(chalk.red(`  ❌ 본인 확인 처리 오류: ${identityError.message}`));
              await new Promise(r => setTimeout(r, 2000));
              continue;  // 에러가 발생해도 다음 단계 시도
            }

          case 'account_chooser':
            console.log(chalk.yellow(`[ImprovedAuth] 📋 계정 선택 페이지 처리 중...`));
            result = await this.handleAccountChooserLogin(page, credentials, options);
            if (result && result.success) {
              // 계정 선택 성공 후 다음 단계로 이동
              await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
              continue;
            }

            // 계정 선택 실패 시 - "다른 계정 사용" 클릭 후 이메일 입력으로 전환 시도
            console.log(chalk.yellow(`[ImprovedAuth] ⚠️ 계정 선택 실패 - 이메일 입력 모드로 전환 시도`));

            // "다른 계정 사용" 버튼 클릭 시도
            const useAnotherAccountResult = await this.clickUseAnotherAccount(page);
            if (useAnotherAccountResult.success) {
              console.log(chalk.green(`[ImprovedAuth] ✅ "다른 계정 사용" 버튼 클릭 성공 - 이메일 입력으로 이동`));
              await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
              continue; // 다음 루프에서 email_input으로 처리됨
            }

            // "다른 계정 사용" 버튼도 실패한 경우 직접 이메일 입력 시도
            console.log(chalk.yellow(`[ImprovedAuth] ⚠️ "다른 계정 사용" 버튼 없음 - 직접 이메일 입력 시도`));
            result = await this.handleEmailLogin(page, credentials, options);
            if (result && result.success) {
              await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
              continue;
            }

            // 모든 방법 실패 시
            return result || { success: false, error: '계정 선택 및 이메일 입력 실패' };

          case 'email_input':
            console.log(chalk.blue(`[ImprovedAuth] 📧 이메일 입력 페이지`));
            result = await this.handleEmailLogin(page, credentials, options);
            if (result && result.success) {
              await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
              continue;
            }
            return result || { success: false, error: '이메일 입력 실패' };

          case 'password_input':
            console.log(chalk.blue(`[ImprovedAuth] 🔒 비밀번호 입력 페이지`));
            result = await this.handlePasswordLogin(page, credentials, options);
            if (result && result.success) {
              await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
              continue;
            }
            return result || { success: false, error: '비밀번호 입력 실패' };

          // 중복 case 'account_chooser' 제거됨 (라인 284에서 이미 처리)

          case 'two_factor':
            console.log(chalk.blue(`[ImprovedAuth] 🔐 2단계 인증 페이지`));
            return await this.handle2FALogin(page, credentials, options);

          case 'logged_in':
            this.log('✅ 로그인 완료!', 'success');
            console.log(chalk.green(`[ImprovedAuth] ✅ 로그인 성공`));
            return { success: true };

          case 'logged_in_premium':
            this.log('✅ YouTube Premium 페이지에서 로그인 확인됨!', 'success');
            console.log(chalk.green(`[ImprovedAuth] ✅ YouTube Premium 멤버십 페이지 - 로그인 성공 (결제 재개 진행 가능)`));
            return {
              success: true,
              alreadyLoggedIn: true,
              pageType: 'premium_membership',
              message: 'YouTube Premium 멤버십 페이지에서 로그인 상태 확인됨'
            };

          default:
            this.log(`알 수 없는 페이지 타입: ${pageType}`, 'warning');
            console.log(chalk.red(`[ImprovedAuth] ⚠️ 처리되지 않은 페이지 타입: ${pageType}`));

            // 첫 번째 시도: 이메일 입력
            if (currentStep === 1) {
              console.log(chalk.yellow(`[ImprovedAuth] 이메일 입력으로 시작 시도`));
              result = await this.handleEmailLogin(page, credentials, options);
              if (result && result.success) {
                await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
                continue;
              }
            }

            // 알 수 없는 페이지에서 정체 - 종료
            return {
              success: false,
              error: 'UNKNOWN_PAGE_TYPE',
              message: `알 수 없는 페이지: ${pageType}`,
              skipRetry: true
            };
        }
      }

      // 최대 단계 수 초과
      this.log(`❌ 최대 로그인 단계 초과 (${maxSteps}단계)`, 'error');
      console.log(chalk.red(`[ImprovedAuth] ❌ 인증 단계 초과`));
      return {
        success: false,
        error: 'MAX_STEPS_EXCEEDED',
        message: '로그인 단계 수 초과',
        skipRetry: true
      };

    } catch (error) {
      this.log(`로그인 중 오류: ${error.message}`, 'error');

      // 스크린샷 저장
      if (options.screenshotEnabled) {
        try {
          await page.screenshot({
            path: `screenshots/login_error_${Date.now()}.png`
          });
        } catch (e) {
          // 스크린샷 실패 무시
        }
      }

      throw error;
    }
  }

  /**
   * 메인 인증 처리 메서드
   */
  async handleAuthentication(page, credentials) {
    this.log('🔐 인증 시작', 'info');
    console.log(chalk.cyan('\n📱 [ImprovedAuth] 인증 프로세스 시작'));
    console.log(chalk.gray(`  이메일: ${credentials.email}`));
    console.log(chalk.gray(`  TOTP 키: ${credentials.totpSecret ? '있음' : '없음'}`));
    
    // 인증 시작 전 스크린샷
    const timestamp = Date.now();
    const screenshotPath = `screenshots/debug/auth-start-${timestamp}.png`;
    try {
      await this.saveScreenshot(page, screenshotPath);
      console.log(chalk.gray(`📸 [DEBUG] 인증 시작 스크린샷: ${screenshotPath}`));
    } catch (e) {
      // 스크린샷 실패는 무시
    }
    
    // performLogin 메서드 호출 (login이 아님)
    const result = await this.performLogin(page, credentials);
    
    // 인증 완료 후 스크린샷
    const afterPath = `screenshots/debug/auth-complete-${timestamp}.png`;
    try {
      await this.saveScreenshot(page, afterPath);
      console.log(chalk.gray(`📸 [DEBUG] 인증 완료 스크린샷: ${afterPath}`));
    } catch (e) {
      // 스크린샷 실패는 무시
    }
    
    if (result.success) {
      this.log('✅ 인증 성공', 'success');
      console.log(chalk.green('✅ [ImprovedAuth] 인증 성공'));
    } else {
      this.log(`❌ 인증 실패: ${result.error}`, 'error');
      console.log(chalk.red(`❌ [ImprovedAuth] 인증 실패: ${result.error}`));
    }
    
    return result;
  }

  /**
   * 페이지 타입 식별 (외부 호출용)
   */
  async identifyPageType(page) {
    const pageType = await this.detectPageType(page);
    
    // 객체 형태로 변환
    if (pageType === 'recaptcha') {
      return {
        type: 'recaptcha',
        details: { url: page.url() }
      };
    }
    
    return {
      type: pageType,
      details: {}
    };
  }

  /**
   * 페이지 타입 감지
   */
  async detectPageType(page) {
    try {
      // 스크린샷 저장 (디버그용)
      const timestamp = Date.now();
      const screenshotPath = `page_detect_${timestamp}.png`;  // screenshots/ 경로 제거
      try {
        await this.saveScreenshot(page, screenshotPath);
        console.log(chalk.gray(`[ImprovedAuth] 📸 페이지 감지 스크린샷 저장: screenshots/${screenshotPath}`));
        this.log(`📸 페이지 감지 스크린샷 저장: screenshots/${screenshotPath}`, 'debug');
      } catch (e) {
        console.log(chalk.yellow(`[ImprovedAuth] 스크린샷 저장 실패: ${e.message}`));
        // 스크린샷 실패는 무시
      }

      const pageInfo = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.textContent || '';
        const title = document.title;

        // DOM 요소 확인
        const passwordField = document.querySelector('input[type="password"]:not([aria-hidden="true"])');
        const emailField = document.querySelector('input[type="email"]:not([aria-hidden="true"])');
        const identifierField = document.querySelector('#identifierId:not([aria-hidden="true"])');
        const totpInput = document.querySelector('input[type="tel"], input[name="totpPin"], #totpPin');

        // 디버그 정보 수집
        const debugInfo = {
          url,
          title,
          hasPasswordField: !!passwordField,
          hasEmailField: !!emailField,
          hasIdentifierField: !!identifierField,
          hasTotpField: !!totpInput,
          bodyTextSnippet: bodyText.substring(0, 200)
        };

        console.log('[Page Detection Debug]', debugInfo);

        // AdsPower 시작 페이지 감지 - 최우선 체크
        if (url.includes('start.adspower.net') ||
            url.includes('start.adspower.com') ||
            title.includes('AdsPower') ||
            bodyText.includes('AdsPower Browser')) {
          return { type: 'adspower_start', debug: debugInfo };
        }

        // ★★★ YouTube Premium 멤버십 페이지 감지 - 최우선 체크 (error_page보다 먼저) ★★★
        // 이미 로그인된 상태에서 Premium 페이지에 있는 경우를 먼저 확인
        if (url.includes('youtube.com/paid_memberships') ||
            url.includes('youtube.com/premium')) {
          // Premium 페이지 확인을 위한 키워드 체크
          const isPremiumPage =
            bodyText.includes('Memberships') ||
            bodyText.includes('멤버십') ||
            bodyText.includes('Manage membership') ||
            bodyText.includes('멤버십 관리') ||
            bodyText.includes('Premium') ||
            bodyText.includes('Family membership') ||
            bodyText.includes('가족 요금제') ||
            bodyText.includes('Next billing date') ||
            bodyText.includes('다음 결제일') ||
            bodyText.includes('Your membership') ||
            bodyText.includes('Resume') ||
            bodyText.includes('Pause') ||
            bodyText.includes('재개') ||
            bodyText.includes('일시중지') ||
            bodyText.includes('Paused until') ||
            bodyText.includes('일시중지됨');

          if (isPremiumPage) {
            return { type: 'logged_in_premium', debug: debugInfo };
          }
        }

        // ★★★ YouTube 로그인 완료 상태 감지 - error_page보다 먼저 체크 ★★★
        // Google 계정으로 YouTube에 로그인된 상태인지 확인
        if (url.includes('youtube.com') && !url.includes('accounts.google.com')) {
          // YouTube 로그인 상태 확인 요소
          const isLoggedInYoutube =
            document.querySelector('button#avatar-btn') ||
            document.querySelector('img#img[alt*="Avatar"]') ||
            document.querySelector('[aria-label*="계정"]') ||
            document.querySelector('[aria-label*="Account"]') ||
            document.querySelector('ytd-masthead #avatar-btn');

          if (isLoggedInYoutube || bodyText.includes('Memberships') || bodyText.includes('멤버십')) {
            return { type: 'logged_in', debug: debugInfo };
          }
        }

        // 브라우저 오류 페이지 감지 (네트워크/렌더링 오류)
        // ★ "Something went wrong" 제거 - YouTube Premium 페이지에서 오탐 방지 ★
        if (bodyText.includes('STATUS_ACCESS_VIOLATION') ||
            bodyText.includes('ERR_NETWORK_CHANGED') ||
            bodyText.includes('ERR_INTERNET_DISCONNECTED') ||
            bodyText.includes('ERR_CONNECTION_RESET') ||
            bodyText.includes('ERR_NAME_NOT_RESOLVED') ||
            bodyText.includes('ERR_CONNECTION_TIMED_OUT') ||
            bodyText.includes('앗, 이런!') ||
            bodyText.includes('Aw, Snap!') ||
            bodyText.includes('This page isn\'t working') ||
            bodyText.includes('이 페이지가 작동하지 않습니다')) {
          return { type: 'browser_error', debug: debugInfo };
        }

        // 계정 사용 중지/거부 페이지 감지
        if (url.includes('/signin/rejected') ||
            url.includes('/signin/disabled') ||
            bodyText.includes('계정 사용 중지됨') ||
            bodyText.includes('계정이 사용 중지되었습니다') ||
            bodyText.includes('Google 계정에서 평소와 다른 활동이 감지되어') ||
            bodyText.includes('Your account has been disabled') ||
            bodyText.includes('Account disabled') ||
            bodyText.includes('This account has been disabled') ||
            bodyText.includes('unusual activity on your Google Account')) {
          return { type: 'account_disabled', debug: debugInfo };
        }

        // 에러 페이지 감지 (unknownerror) - ★ URL 기반으로만 감지 (본문 텍스트 제거) ★
        // "문제가 발생했습니다", "Something went wrong" 등은 YouTube UI에서 일부 오류 메시지로 나타날 수 있어
        // 정상 페이지를 error_page로 오탐하는 문제가 있었음
        if (url.includes('/signin/unknownerror') ||
            url.includes('/v3/signin/unknownerror') ||
            url.includes('/signin/error') ||
            url.includes('/ServiceLogin/error')) {
          return { type: 'error_page', debug: debugInfo };
        }

        // Google 로그인 에러 페이지 (본문 텍스트 기반) - YouTube 페이지가 아닌 경우에만 적용
        if (url.includes('accounts.google.com') &&
            (bodyText.includes('문제가 발생했습니다') ||
             bodyText.includes('Something went wrong') ||
             bodyText.includes('오류가 발생했습니다') ||
             bodyText.includes('An error occurred'))) {
          return { type: 'error_page', debug: debugInfo };
        }

        // 패스키 등록 페이지 감지
        if (url.includes('/signin/speedbump/passkeyenrollment') ||
            url.includes('/v3/signin/speedbump/passkeyenrollment') ||
            bodyText.includes('패스키') ||
            bodyText.includes('Passkey') ||
            bodyText.includes('passkey') ||
            bodyText.includes('더욱 간편하게 로그인') ||
            bodyText.includes('Sign in faster')) {
          return { type: 'passkey_enrollment', debug: debugInfo };
        }

        // ========== ★★★ URL 기반 페이지 타입 감지 (최우선) ★★★ ==========
        // URL은 가장 신뢰할 수 있는 페이지 식별 수단입니다.
        // 본문 텍스트 기반 감지보다 먼저 수행해야 오탐을 방지할 수 있습니다.

        // ★★★ 계정 선택 페이지 - URL 기반 최우선 감지 (v2.1 추가) ★★★
        // accountchooser URL이면 무조건 계정 선택 페이지입니다.
        if (url.includes('accountchooser') ||
            url.includes('/v3/signin/accountchooser') ||
            url.includes('/signin/v2/accountchooser')) {
          return { type: 'account_chooser', debug: debugInfo };
        }

        // ★★★ 비밀번호 입력 페이지 - URL 기반 최우선 감지 ★★★
        // /challenge/pwd URL이면 무조건 비밀번호 페이지입니다.
        // 이 체크를 텍스트 기반 CAPTCHA 감지보다 먼저 수행해야 합니다!
        if (url.includes('/challenge/pwd') ||
            url.includes('/signin/v2/challenge/pwd') ||
            url.includes('/v3/signin/challenge/pwd')) {
          return { type: 'password_input', debug: debugInfo };
        }

        // ★★★ 2FA/TOTP 페이지 - URL 기반 감지 ★★★
        if (url.includes('/challenge/totp') ||
            url.includes('/signin/v2/challenge/totp') ||
            url.includes('/v3/signin/challenge/totp')) {
          return { type: 'two_factor', debug: debugInfo };
        }

        // ★★★ reCAPTCHA 페이지 - URL 기반 감지 ★★★
        if (url.includes('/challenge/recaptcha') ||
            url.includes('/signin/v2/challenge/recaptcha') ||
            url.includes('/v3/signin/challenge/recaptcha')) {
          return { type: 'recaptcha', debug: debugInfo };
        }

        // ★★★ 본인 확인(Identity Confirmation) 페이지 - URL 기반 감지 ★★★
        if (url.includes('/signin/confirmidentifier') ||
            url.includes('/v3/signin/confirmidentifier')) {
          // 전화번호 입력 필드가 없는 경우에만 identity_confirmation
          const hasPhoneInput = document.querySelector('input[type="tel"]') ||
                               document.querySelector('input[name="phoneNumber"]') ||
                               document.querySelector('input[autocomplete="tel"]');
          if (!hasPhoneInput) {
            return { type: 'identity_confirmation', debug: debugInfo };
          }
        }

        // ★★★ 전화번호 인증 페이지 - URL 기반 감지 ★★★
        if (url.includes('/challenge/selection') ||
            url.includes('/challenge/phone') ||
            url.includes('/signin/v2/challenge/ipp') ||
            url.includes('/signin/v2/challenge/iap') ||
            url.includes('/v3/signin/challenge/ipp') ||
            url.includes('/v3/signin/challenge/iap')) {
          return { type: 'phone_verification', debug: debugInfo };
        }

        // ========== 텍스트/DOM 기반 페이지 타입 감지 (보조) ==========
        // URL로 식별할 수 없는 경우에만 본문 텍스트와 DOM 요소를 검사합니다.

        // 이미지 CAPTCHA 감지 (텍스트 입력형)
        // ★ 중요: 비밀번호 필드가 있으면 CAPTCHA로 판단하지 않음 (오탐 방지)
        const imageCaptchaIndicators = [
          '들리거나 표시된 텍스트 입력',  // 한국어
          'Type the text you hear or see',  // 영어
          'Escribe el texto que ves o escuchas',  // 스페인어
          'Digite o texto que você vê ou ouve',  // 포르투갈어
          'Geben Sie den Text ein',  // 독일어
          '入力してください',  // 일본어 (단독으로는 모호할 수 있음)
          '请输入您看到或听到的文字',  // 중국어
          'Введите текст',  // 러시아어 (단독으로는 모호할 수 있음)
        ];
        const hasImageCaptcha = imageCaptchaIndicators.some(text => bodyText.includes(text));
        // ★ 비밀번호 필드가 있으면 CAPTCHA가 아니라 비밀번호 페이지임
        if (hasImageCaptcha && !passwordField) {
          return { type: 'image_captcha', debug: debugInfo };
        }

        // reCAPTCHA 감지 - DOM 기반 (URL로 감지 못한 경우)
        if (bodyText.includes('reCAPTCHA') ||
            document.querySelector('iframe[src*="recaptcha"]') ||
            document.querySelector('.g-recaptcha')) {
          return { type: 'recaptcha', debug: debugInfo };
        }

        // 텍스트 기반 본인 확인 페이지 감지 (URL이 다를 수 있음)
        const identityConfirmTexts = [
          '계정 보안을 유지하기 위해 Google에서 본인 인증을 해야 합니다',
          'Google needs to verify it\'s you',
          'Verify it\'s you',
          'Google debe verificar que eres tú',
          'Google muss bestätigen, dass Sie es sind',
          'Googleはあなたであることを確認する必要があります',
          'Google 需要验证您的身份'
        ];
        const hasIdentityConfirmText = identityConfirmTexts.some(text => bodyText.includes(text));
        if (hasIdentityConfirmText) {
          const hasPhoneInput = document.querySelector('input[type="tel"]') ||
                               document.querySelector('input[name="phoneNumber"]');
          if (!hasPhoneInput) {
            return { type: 'identity_confirmation', debug: debugInfo };
          }
        }

        // 전화번호 인증 페이지 감지 - 텍스트/DOM 기반
        if (bodyText.includes('전화번호 확인') ||
            bodyText.includes('휴대전화 번호') ||
            bodyText.includes('Verify your phone number') ||
            bodyText.includes('Phone verification') ||
            bodyText.includes('Enter your phone number') ||
            (bodyText.includes('전화') && bodyText.includes('인증')) ||
            document.querySelector('input[type="tel"][name="phoneNumber"]') ||
            document.querySelector('input[autocomplete="tel"]')) {
          return { type: 'phone_verification', debug: debugInfo };
        }

        // 2FA/TOTP 페이지 - 텍스트/DOM 기반 (URL로 감지 못한 경우)
        if (bodyText.includes('2단계 인증') ||
            bodyText.includes('2-Step Verification') ||
            bodyText.includes('Google OTP') ||
            bodyText.includes('Google Authenticator') ||
            bodyText.includes('인증 앱') ||
            bodyText.includes('Authenticator app') ||
            totpInput) {
          return { type: 'two_factor', debug: debugInfo };
        }

        // 비밀번호 입력 페이지 - DOM 기반 (URL로 감지 못한 경우)
        // ★ 비밀번호 필드가 있고 이메일 필드가 없으면 비밀번호 페이지
        if (passwordField && !emailField && !identifierField) {
          return { type: 'password_input', debug: debugInfo };
        }
        
        // 계정 선택 페이지
        if (url.includes('accountchooser') ||
            bodyText.includes('계정을 선택하세요') ||
            bodyText.includes('Choose an account') ||
            bodyText.includes('Use your Google Account') ||
            bodyText.includes('Sign in with Google') ||
            bodyText.includes('계정 선택')) {
          return { type: 'account_chooser', debug: debugInfo };
        }

        // 이메일 입력 페이지 - 비밀번호 필드가 없을 때만
        // 영어 페이지도 지원
        if ((emailField || identifierField) && !passwordField) {
          // 추가 검증: 영어 또는 한국어 로그인 텍스트 확인
          const hasLoginText = bodyText.includes('로그인') ||
                               bodyText.includes('Sign in') ||
                               bodyText.includes('Email or phone') ||
                               bodyText.includes('이메일 또는 휴대전화') ||
                               bodyText.includes('Google 계정으로 로그인') ||
                               bodyText.includes('Sign in to continue to') ||
                               bodyText.includes('Use your Google Account');

          if (hasLoginText || emailField || identifierField) {
            return { type: 'email_input', debug: debugInfo };
          }
        }
        
        // 로그인 완료
        if (url.includes('myaccount.google.com') ||
            url.includes('youtube.com') ||
            document.querySelector('img[aria-label*="Google Account"]')) {
          return { type: 'logged_in', debug: debugInfo };
        }
        
        return { type: 'unknown', debug: debugInfo };
      });
      
      // 디버그 정보 로깅
      if (pageInfo.debug) {
        this.log(`📋 페이지 감지 디버그:`, 'debug');
        this.log(`  URL: ${pageInfo.debug.url}`, 'debug');
        this.log(`  타입: ${pageInfo.type}`, 'debug');
        this.log(`  비밀번호 필드: ${pageInfo.debug.hasPasswordField}`, 'debug');
        this.log(`  이메일 필드: ${pageInfo.debug.hasEmailField}`, 'debug');
      }
      
      return pageInfo.type || pageInfo;
    } catch (error) {
      this.log(`페이지 타입 감지 실패: ${error.message}`, 'error');
      return 'unknown';
    }
  }

  /**
   * 계정 선택 페이지에서 로그인
   *
   * ⚠️ 중요: 기존 계정 클릭 시 IMAGE CAPTCHA가 발생할 수 있음
   * → "다른 계정 사용" 클릭으로 이메일 입력 페이지로 이동하여 우회
   */
  async handleAccountChooserLogin(page, credentials, options = {}) {
    this.log('📧 계정 선택 페이지 처리 (CAPTCHA 우회 모드)', 'info');
    console.log(chalk.blue(`\n[ImprovedAuth] 📋 계정 선택 페이지 - CAPTCHA 우회 전략 사용`));
    console.log(chalk.cyan(`  🎯 대상 계정: ${credentials.email}`));

    try {
      // 스크린샷 (처리 전)
      const timestamp = Date.now();
      try {
        await this.saveScreenshot(page, `account-chooser-before-${timestamp}.png`);
      } catch (e) {
        // 무시
      }

      // ============================================================
      // CAPTCHA 우회 전략: "다른 계정 사용" 버튼 먼저 클릭
      // 기존 계정을 클릭하면 IMAGE CAPTCHA가 발생할 수 있으므로
      // "다른 계정 사용"을 클릭하여 깨끗한 이메일 입력 페이지로 이동
      // ============================================================
      console.log(chalk.yellow(`  🔄 CAPTCHA 우회: "다른 계정 사용" 버튼 클릭 중...`));

      const useAnotherResult = await this.clickUseAnotherAccount(page);

      if (useAnotherResult.success) {
        console.log(chalk.green(`  ✅ "다른 계정 사용" 클릭 성공!`));
        console.log(chalk.green(`  ✅ 이메일 입력 페이지로 이동 → CAPTCHA 우회 완료`));

        // 스크린샷 (성공)
        try {
          await this.saveScreenshot(page, `account-chooser-use-another-success-${timestamp}.png`);
        } catch (e) {
          // 무시
        }

        // 이메일 입력 페이지로 전환되었으므로 email_input으로 처리하도록 반환
        return {
          success: true,
          redirectToEmailInput: true,
          message: 'CAPTCHA 우회를 위해 이메일 입력 페이지로 이동'
        };
      }

      // "다른 계정 사용" 버튼이 없는 경우 (단일 계정만 있는 페이지 등)
      console.log(chalk.yellow(`  ⚠️ "다른 계정 사용" 버튼 없음 - 기존 방식으로 시도`));
      this.log('"다른 계정 사용" 버튼을 찾을 수 없어 기존 방식으로 진행', 'warning');

      // 로거 래퍼 생성
      const loggerWrapper = {
        info: (message, data) => {
          this.log(message, 'info');
          console.log(chalk.gray(`  ${message}`));
        },
        warn: (message, data) => {
          this.log(message, 'warning');
          console.log(chalk.yellow(`  ⚠️ ${message}`));
        },
        error: (message, data) => {
          this.log(message, 'error');
          console.log(chalk.red(`  ❌ ${message}`));
        },
        debug: (message, data) => this.log(message, 'debug')
      };

      // ImprovedAccountChooserHandler 사용 (폴백)
      const accountHandler = new ImprovedAccountChooserHandler(page, {
        debugMode: this.config.debugMode,
        screenshotEnabled: options.screenshotEnabled !== false,
        mouseSpeed: options.mouseSpeed || 'normal',
        logger: loggerWrapper
      });

      // 로그아웃된 계정 클릭 시도 (폴백)
      console.log(chalk.cyan(`  🔍 계정 "${credentials.email}" 검색 중... (폴백 모드)`));
      const handled = await accountHandler.handleAccountChooser(credentials.email);

      if (!handled || !handled.success) {
        console.log(chalk.yellow(`  ⚠️ 계정 선택 실패 - 이메일 입력 모드로 전환`));
        this.log('계정 선택 실패, 이메일 입력으로 전환', 'warning');

        // 스크린샷 (실패)
        try {
          await this.saveScreenshot(page, `account-chooser-failed-${timestamp}.png`);
        } catch (e) {
          // 무시
        }

        // 실패를 반환하되, 상위에서 이메일 입력으로 재시도하도록
        return { success: false, error: 'ACCOUNT_NOT_FOUND' };
      }

      console.log(chalk.green(`  ✅ 계정 선택 성공 (폴백 모드)`));

      // 스크린샷 (성공 후)
      try {
        await this.saveScreenshot(page, `account-chooser-success-${timestamp}.png`);
      } catch (e) {
        // 무시
      }

      // 클릭 후 페이지 변화 대기
      console.log(chalk.gray(`  ⏳ 페이지 전환 대기 중...`));
      await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad || 3000));

      // 현재 페이지 타입 확인
      const currentUrl = page.url();
      const nextPageType = await this.detectPageType(page);

      console.log(chalk.gray(`  📍 현재 URL: ${currentUrl.substring(0, 80)}...`));
      console.log(chalk.gray(`  📍 감지된 페이지 타입: ${nextPageType}`));

      // 페이지 타입에 따른 처리
      if (nextPageType === 'password_input') {
        console.log(chalk.green(`  ✅ 비밀번호 입력 페이지로 직접 이동!`));
        // authenticate 메서드에서 비밀번호 처리 진행
      } else if (nextPageType === 'email_input') {
        console.log(chalk.yellow(`  ⚠️ 이메일 재확인 페이지로 이동`));
        // authenticate 메서드에서 이메일 처리 진행
      }

      // 다음 페이지 확인을 위해 성공 반환
      console.log(chalk.green(`  ✅ 계정 선택 단계 완료 - 다음 단계로 이동`));
      return { success: true };

    } catch (error) {
      this.log(`계정 선택 중 오류: ${error.message}`, 'error');
      console.log(chalk.red(`  ❌ 계정 선택 오류: ${error.message}`));

      // 오류 스크린샷
      try {
        await this.saveScreenshot(page, `account-chooser-error-${Date.now()}.png`);
      } catch (e) {
        // 무시
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * 이메일 입력 처리
   */
  async handleEmailLogin(page, credentials, options = {}) {
    this.log('📧 이메일 입력', 'info');

    try {
      // 이메일 입력 필드 찾기
      const emailSelectors = [
        'input[type="email"]',
        'input#identifierId',
        'input[name="identifier"]',
        'input[autocomplete="username"]'
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        try {
          emailInput = await page.waitForSelector(selector, {
            visible: true,
            timeout: 3000
          });
          if (emailInput) break;
        } catch (e) {
          // 계속 시도
        }
      }

      if (!emailInput) {
        throw new Error('이메일 입력 필드를 찾을 수 없습니다');
      }

      // 이메일이 이미 입력되어 있는지 확인
      const currentValue = await emailInput.evaluate(el => el.value);
      this.log(`현재 이메일 필드 값: "${currentValue}"`, 'debug');

      // 이메일이 이미 올바르게 입력되어 있는 경우
      if (currentValue && currentValue.toLowerCase() === credentials.email.toLowerCase()) {
        this.log('✅ 이메일이 이미 올바르게 입력되어 있음', 'info');

        // 바로 Next 버튼 클릭
        const nextButton = await this.findAndClickNextButton(page);
        if (!nextButton) {
          // Enter 키로 시도
          await page.keyboard.press('Enter');
        }
      }
      // 이메일이 비어있거나 다른 값인 경우
      else {
        this.log(`이메일 입력 필요 (현재: "${currentValue}", 입력할 값: "${credentials.email}")`, 'debug');

        // 이메일 입력
        await emailInput.click();
        await new Promise(r => setTimeout(r, 500));

        // 기존 텍스트 지우기
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // 이메일 입력 (휴먼라이크 타이핑)
        await this.humanLikeType(page, credentials.email);
        await new Promise(r => setTimeout(r, 500));

        // Next 버튼 클릭
        const nextButton = await this.findAndClickNextButton(page);
        if (!nextButton) {
          // Enter 키로 시도
          await page.keyboard.press('Enter');
        }
      }

      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));

      // 다음 페이지 확인
      const nextPageType = await this.detectPageType(page);
      this.log(`이메일 입력 후 페이지 타입: ${nextPageType}`, 'info');

      // 비밀번호 페이지로 이동한 경우
      if (nextPageType === 'password_input') {
        this.log('✅ 비밀번호 입력 페이지로 이동', 'success');
        // 비밀번호 처리는 authenticate 메서드에서 진행
        return { success: true, nextPage: 'password' };
      }

      // 이미 로그인된 경우
      if (nextPageType === 'logged_in') {
        this.log('✅ 이미 로그인됨', 'success');
        return { success: true };
      }

      // reCAPTCHA가 나타난 경우
      if (nextPageType === 'recaptcha') {
        this.log('⚠️ reCAPTCHA 감지', 'warning');
        return { success: false, error: 'RECAPTCHA_DETECTED' };
      }

      // 예상치 못한 페이지
      this.log(`⚠️ 예상치 못한 페이지 타입: ${nextPageType}`, 'warning');
      return { success: false, error: `예상치 못한 페이지: ${nextPageType}` };

    } catch (error) {
      this.log(`이메일 입력 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 비밀번호 입력 처리
   */
  async handlePasswordLogin(page, credentials, options = {}) {
    this.log('🔑 비밀번호 입력 페이지 처리', 'info');
    
    // 스크린샷 저장
    const screenshotPath = await this.saveScreenshot(page, `password_page_${Date.now()}.png`);
    if (screenshotPath) {
      this.log(`📸 비밀번호 페이지 스크린샷: ${screenshotPath}`, 'debug');
    }
    
    // 비밀번호 확인
    if (!credentials.password) {
      this.log('❌ 비밀번호가 없습니다. Google Sheets B열을 확인하세요.', 'error');
      throw new Error('비밀번호 누락');
    }
    
    this.log(`✅ 비밀번호 준비 완료 (길이: ${credentials.password.length})`, 'info');
    this.log(`📝 계정: ${credentials.email}`, 'debug');
    
    try {
      // 비밀번호 입력 필드 대기
      const passwordSelectors = [
        'input[type="password"]:not([aria-hidden="true"])',
        'input[name="password"]:not([aria-hidden="true"])',
        'input[name="Passwd"]:not([aria-hidden="true"])',
        '#password',
        'input[aria-label*="비밀번호"]',
        'input[aria-label*="password"]'
      ];
      
      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await page.waitForSelector(selector, {
            visible: true,
            timeout: 5000
          });
          if (passwordInput) {
            this.log(`비밀번호 필드 발견: ${selector}`, 'debug');
            break;
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (!passwordInput) {
        // 비밀번호 필드가 없는지 재확인
        const hasPasswordField = await page.evaluate(() => {
          const fields = document.querySelectorAll('input[type="password"]');
          return fields.length > 0;
        });
        
        if (hasPasswordField) {
          this.log('비밀번호 필드는 있지만 선택할 수 없음. 다시 시도...', 'warning');
          await new Promise(r => setTimeout(r, 2000));
          passwordInput = await page.$('input[type="password"]');
        }
        
        if (!passwordInput) {
          throw new Error('비밀번호 입력 필드를 찾을 수 없습니다');
        }
      }
      
      // 비밀번호 입력 필드 클릭 (포커스)
      await passwordInput.click();
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      
      // 기존 값 지우기
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 200));
      
      // 비밀번호 입력 (휴먼라이크 타이핑)
      this.log('비밀번호 입력 중...', 'debug');
      await this.humanLikeType(page, credentials.password);
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      
      // Next 버튼 클릭
      const nextButton = await this.findAndClickNextButton(page);
      if (!nextButton) {
        this.log('Next 버튼을 찾을 수 없어 Enter 키 사용', 'debug');
        // Enter 키로 시도
        await page.keyboard.press('Enter');
      }
      
      // 로그인 처리 대기 (충분한 시간 제공)
      this.log('로그인 처리 대기 중...', 'info');
      await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad || 3000));
      
      // 현재 URL 확인 - YouTube Premium 페이지로 리디렉션되었는지 체크
      const currentUrl = page.url();
      this.log(`현재 URL: ${currentUrl}`, 'debug');
      
      // YouTube Premium 페이지로 이동했다면 로그인 성공
      if (currentUrl.includes('youtube.com/paid_memberships') || 
          currentUrl.includes('youtube.com/premium')) {
        this.log('✅ YouTube Premium 페이지로 이동 - 로그인 성공!', 'success');
        return { 
          success: true, 
          redirected: true,
          targetUrl: currentUrl 
        };
      }
      
      // 2FA 또는 추가 인증 체크
      const nextPageType = await this.detectPageType(page);
      this.log(`비밀번호 입력 후 페이지 타입: ${nextPageType}`, 'debug');
      
      // 패스키 등록 페이지 처리
      if (nextPageType === 'passkey_enrollment') {
        this.log('🔑 로그인 후 패스키 등록 페이지 감지', 'info');
        const passkeyResult = await this.handlePasskeyEnrollmentPage(page, options);
        if (passkeyResult.success) {
          // 패스키 페이지 건너뜀 후 로그인 성공으로 처리
          return { success: true };
        }
        return passkeyResult;
      }
      
      if (nextPageType === 'recaptcha') {
        this.log('⚠️ 비밀번호 입력 후 reCAPTCHA 감지', 'warning');
        return { 
          success: false, 
          error: 'RECAPTCHA_DETECTED',
          message: 'reCAPTCHA가 감지되어 로그인을 건너뜁니다',
          status: 'recaptcha_detected',
          skipRetry: true  // 재시도 방지
        };
      }
      
      if (nextPageType === 'phone_verification') {
        this.log('📱 비밀번호 입력 후 전화번호 인증 요구됨', 'warning');
        // 스크린샷 저장
        if (options.screenshotEnabled) {
          await page.screenshot({
            path: `screenshots/phone_verification_after_password_${Date.now()}.png`
          });
        }
        return { 
          success: false, 
          error: 'PHONE_VERIFICATION_REQUIRED',
          message: '번호인증 필요',
          status: 'phone_verification_required',
          skipRetry: true  // 재시도 방지
        };
      }
      
      if (nextPageType === 'two_factor') {
        if (credentials.totpSecret) {
          this.log('2FA 인증이 필요합니다. TOTP 코드 입력 시작...', 'info');
          return await this.handle2FALogin(page, credentials, options);
        } else {
          this.log('2FA가 필요하지만 TOTP 시크릿이 없습니다', 'warning');
          return { success: false, error: '2FA 필요' };
        }
      }
      
      if (nextPageType === 'logged_in') {
        this.log('✅ 비밀번호 입력 후 로그인 성공', 'success');
        return { success: true };
      }
      
      // 로그인 상태 최종 확인
      const isLoggedIn = await this.checkLoginStatus(page);
      
      if (isLoggedIn) {
        this.log('✅ 로그인 상태 확인 - 성공', 'success');
        return { success: true };
      } else {
        this.log('⚠️ 로그인 상태 확인 - 실패', 'warning');
        return { success: false };
      }
      
    } catch (error) {
      this.log(`비밀번호 입력 실패: ${error.message}`, 'error');
      
      // 스크린샷 저장
      if (options.screenshotEnabled) {
        try {
          await page.screenshot({
            path: `screenshots/password_error_${Date.now()}.png`
          });
        } catch (e) {
          // 무시
        }
      }
      
      throw error;
    }
  }

  /**
   * 2FA 처리
   */
  async handle2FALogin(page, credentials, options = {}) {
    this.log('🔐 2FA 인증 페이지 감지', 'info');
    
    // 스크린샷 저장
    try {
      await page.screenshot({
        path: `screenshots/2fa_page_${Date.now()}.png`
      });
    } catch (e) {
      // 무시
    }
    
    // TOTP 시크릿이 없는 경우
    if (!credentials.totpSecret) {
      this.log('⚠️ TOTP 시크릿이 없습니다', 'warning');
      this.log('2FA가 필요하지만 TOTP 코드를 생성할 수 없습니다', 'error');
      
      // 2FA 필요 상태로 반환 (재시도하지 않도록)
      return { 
        success: false, 
        error: '2FA_REQUIRED',
        message: '2FA 인증이 필요하지만 TOTP 시크릿이 없습니다',
        skipRetry: true
      };
    }
    
    this.log('✨ TOTP 코드 생성 중...', 'info');
    
    try {
      // TOTP 시크릿 정리 (공백 제거, 대문자 변환)
      const cleanSecret = credentials.totpSecret
        .replace(/\s+/g, '')  // 모든 공백 제거
        .toUpperCase();       // 대문자 변환
      
      this.log(`📌 TOTP 시크릿 처리 중...`, 'info');
      this.log(`  원본: "${credentials.totpSecret}"`, 'debug');
      this.log(`  정리: "${cleanSecret}"`, 'debug');
      
      // Base32 유효성 검사
      const base32Regex = /^[A-Z2-7]+$/;
      if (!base32Regex.test(cleanSecret)) {
        throw new Error(`잘못된 Base32 형식: ${cleanSecret}`);
      }
      
      // TOTP 코드 생성
      const token = speakeasy.totp({
        secret: cleanSecret,
        encoding: 'base32',
        digits: 6,  // 6자리 코드
        step: 30    // 30초마다 갱신
      });
      
      if (!token || token.length !== 6) {
        throw new Error(`비정상적인 TOTP 코드: ${token}`);
      }
      
      this.log(`📱 TOTP 코드 생성 성공: ${token}`, 'success');
      
      // 코드 만료 시간 계산
      const timeRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
      this.log(`  ⏰ 코드 유효 시간: ${timeRemaining}초`, 'info');
      
      // 남은 시간이 5초 미만이면 새 코드 대기
      if (timeRemaining < 5) {
        this.log('⚠️ 코드 만료 임박, 새 코드 대기 중...', 'warning');
        await new Promise(r => setTimeout(r, (timeRemaining + 1) * 1000));
        
        // 새 코드 생성
        const newToken = speakeasy.totp({
          secret: cleanSecret,
          encoding: 'base32',
          digits: 6,
          step: 30
        });
        
        this.log(`🔄 새 TOTP 코드 생성: ${newToken}`, 'success');
        return await this.enterTOTPCode(page, newToken, credentials);
      }
      
      // 여러 선택자로 코드 입력 필드 찾기 (한국어 페이지 포함)
      const selectors = [
        'input[type="tel"]',
        'input[name="totpPin"]',
        '#totpPin',
        'input[type="text"][autocomplete="one-time-code"]',
        'input[aria-label*="코드"]',
        'input[aria-label*="code"]',
        'input[aria-label*="Code"]',
        'input[placeholder*="코드 입력"]',
        'input[placeholder*="Enter code"]',
        'input#idvPin',  // Google의 또 다른 ID
        'input[name="idvPin"]'
      ];
      
      let codeInput = null;
      for (const selector of selectors) {
        try {
          codeInput = await page.waitForSelector(selector, {
            visible: true,
            timeout: 2000
          });
          if (codeInput) {
            this.log(`✅ 코드 입력 필드 찾음: ${selector}`, 'success');
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!codeInput) {
        throw new Error('TOTP 코드 입력 필드를 찾을 수 없습니다');
      }
      
      // 코드 입력 필드 클릭
      await codeInput.click();
      await new Promise(r => setTimeout(r, 500));
      
      // 기존 내용 지우기
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      
      // TOTP 코드 입력 준비
      await this.enterTOTPCode(page, token, credentials);
      
      return { success: true };
      
    } catch (error) {
      this.log(`❌ TOTP 코드 처리 실패: ${error.message}`, 'error');
      
      // 상세 오류 정보 기록
      if (error.stack) {
        this.log(`  스택: ${error.stack}`, 'debug');
      }
      
      return {
        success: false,
        error: 'TOTP_GENERATION_FAILED',
        message: error.message
      };
    }
  }
  
  /**
   * TOTP 코드를 입력 필드에 입력하고 제출
   */
  async enterTOTPCode(page, token, credentials) {
    try {
      this.log(`📝 TOTP 코드 입력 시작: ${token}`, 'info');
      
      // 숫자를 하나씩 천천히 입력 (사람처럼)
      for (const digit of token) {
        await page.keyboard.type(digit);
        // 각 숫자 입력 사이에 랜덤 지연
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      }
      
      await new Promise(r => setTimeout(r, 1000));
      
      // 확인 버튼 찾기 및 클릭 (한국어 페이지 우선)
      const buttonSelectors = [
        'button:has-text("다음")',
        'button:has-text("확인")',
        'button:has-text("인증")',
        'button:has-text("Next")',
        'button:has-text("Verify")',
        'button:has-text("Submit")',
        'button[type="submit"]',
        '#totpNext',
        '#submit',
        'div[role="button"]:has-text("다음")',
        'div[role="button"]:has-text("확인")',
        'div[role="button"]:has-text("Next")',
        'input[type="submit"]',
        // Google 특화 선택자들
        '[data-primary-action-label]',
        '[jsname="LgbsSe"]',  // Google의 다음 버튼
        'div[data-mdc-dialog-action="ok"]'
      ];
      
      let clicked = false;
      
      // 먼저 페이지에서 모든 버튼 찾기
      const buttons = await page.evaluate(() => {
        const possibleButtons = [];
        const buttonElements = document.querySelectorAll('button, div[role="button"], input[type="submit"]');
        
        buttonElements.forEach(btn => {
          const text = btn.textContent?.trim().toLowerCase();
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
          
          if (text?.includes('다음') || text?.includes('next') || 
              text?.includes('확인') || text?.includes('verify') ||
              text?.includes('인증') || text?.includes('submit') ||
              ariaLabel?.includes('다음') || ariaLabel?.includes('next')) {
            
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              possibleButtons.push({
                text: btn.textContent?.trim(),
                selector: btn.id ? `#${btn.id}` : null,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2
              });
            }
          }
        });
        
        return possibleButtons;
      });
      
      if (buttons.length > 0) {
        const button = buttons[0];
        this.log(`🎯 버튼 발견: "${button.text}"`, 'info');

        // 버튼 클릭 (사람처럼 여러 번 시도)
        for (let attempt = 1; attempt <= 3; attempt++) {
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 🤖→👤 사람처럼 클릭하기 (봇 감지 방지)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          // 1️⃣ 클릭 전 랜덤 대기 (100-300ms)
          const preClickDelay = 100 + Math.random() * 200;
          await new Promise(r => setTimeout(r, preClickDelay));

          // 2️⃣ 좌표 랜덤화 (버튼 중심에서 ±4px)
          const randomOffsetX = (Math.random() - 0.5) * 8;
          const randomOffsetY = (Math.random() - 0.5) * 8;
          const finalX = button.x + randomOffsetX;
          const finalY = button.y + randomOffsetY;

          // 3️⃣ 마우스 점진적 이동 (3단계)
          const currentPosition = await page.evaluate(() => ({ x: 0, y: 0 }));
          const steps = 3;

          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const intermediateX = currentPosition.x + (finalX - currentPosition.x) * progress;
            const intermediateY = currentPosition.y + (finalY - currentPosition.y) * progress;

            await page.mouse.move(intermediateX, intermediateY);
            await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
          }

          // 4️⃣ 최종 클릭
          this.log(`🖱️ 사람처럼 클릭 중... 시도 ${attempt}/3 (x: ${Math.round(finalX)}, y: ${Math.round(finalY)})`, 'debug');
          await page.mouse.click(finalX, finalY);

          // 5️⃣ 클릭 후 자연스러운 일시정지
          const postClickDelay = 300 + Math.random() * 200;
          await new Promise(r => setTimeout(r, postClickDelay));

          // 페이지 변화 확인
          const newUrl = page.url();
          if (newUrl !== currentUrl) {
            clicked = true;
            this.log(`✅ 버튼 클릭 성공 (${attempt}번째 시도)`, 'success');
            break;
          }

          if (attempt < 3) {
            this.log(`⚠️ 버튼 클릭 후 변화 없음, 재시도... (${attempt}/3)`, 'warning');
            await new Promise(r => setTimeout(r, 500));
          }
        }
      }
      
      // 버튼을 못 찾은 경우 Enter 키 사용
      if (!clicked) {
        this.log('⚠️ 버튼을 찾을 수 없어 Enter 키를 누릅니다', 'warning');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 1000));
        
        // Enter 키도 안 먹히면 Tab + Enter 시도
        const urlAfterEnter = page.url();
        if (urlAfterEnter === currentUrl) {
          this.log('🔄 Tab + Enter 시도', 'info');
          await page.keyboard.press('Tab');
          await new Promise(r => setTimeout(r, 200));
          await page.keyboard.press('Enter');
        }
      }
      
      // 로그인 완료 대기 (페이지 변화 감지)
      this.log('⏳ 2FA 인증 처리 대기 중...', 'info');
      
      try {
        // 페이지 네비게이션 대기 (최대 10초)
        await page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 10000
        });
        this.log('✅ 페이지 전환 감지됨', 'success');
      } catch (navError) {
        // 네비게이션 타임아웃은 무시 (SPA일 수 있음)
        this.log('⚠️ 페이지 전환 대기 타임아웃 (정상일 수 있음)', 'info');
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      // 페이지 변화 확인
      const currentUrl = page.url();
      const pageType = await this.detectPageType(page);
      
      this.log(`📍 2FA 후 URL: ${currentUrl}`, 'info');
      this.log(`📄 2FA 후 페이지 타입: ${pageType}`, 'info');
      
      // 로그인 성공 여부 확인
      if (pageType === 'logged_in' || 
          currentUrl.includes('youtube.com') || 
          currentUrl.includes('myaccount.google.com')) {
        this.log('✅ 2FA 인증 성공!', 'success');
        return { success: true };
      }
      
      // 추가 인증이 필요한 경우
      if (pageType === 'two_factor') {
        this.log('⚠️ 추가 2FA 인증이 필요합니다', 'warning');
        return { success: false, error: '추가 인증 필요' };
      }
      
      // 로그인 상태 최종 확인
      const isLoggedIn = await this.checkLoginStatus(page);
      
      if (isLoggedIn) {
        this.log('✅ 2FA 인증 후 로그인 확인됨', 'success');
        return { success: true };
      }
      
      return { success: false, error: '2FA 인증 실패' };
      
    } catch (error) {
      this.log(`❌ 2FA 처리 실패: ${error.message}`, 'error');
      
      // 스크린샷 저장
      try {
        await page.screenshot({
          path: `screenshots/2fa_error_${Date.now()}.png`
        });
      } catch (e) {
        // 무시
      }
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Next 버튼 찾기 및 클릭 (한국어/영어 지원)
   */
  async findAndClickNextButton(page) {
    try {
      // ID 기반 셀렉터 우선
      const idSelectors = [
        '#identifierNext',
        '#passwordNext'
      ];

      for (const selector of idSelectors) {
        try {
          const button = await page.waitForSelector(selector, { timeout: 1000 });
          if (button) {
            await button.click();
            this.log(`✅ Next 버튼 클릭 (${selector})`, 'debug');
            return true;
          }
        } catch (e) {
          // 계속 시도
        }
      }

      // 텍스트 기반 셀렉터 (영어/한국어)
      const textSelectors = [
        'button[jsname="LgbsSe"]',
        'button:has-text("Next")',
        'button:has-text("next")',
        'button:has-text("Continue")',
        'button:has-text("Sign in")',
        'button:has-text("다음")',
        '[role="button"]:has-text("Next")',
        '[role="button"]:has-text("next")',
        '[role="button"]:has-text("Continue")',
        '[role="button"]:has-text("Sign in")',
        '[role="button"]:has-text("다음")',
        'div[role="button"]:has-text("Next")',
        'div[role="button"]:has-text("다음")'
      ];

      for (const selector of textSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            this.log(`✅ Next 버튼 클릭 (${selector})`, 'debug');
            return true;
          }
        } catch (e) {
          // 계속 시도
        }
      }

      // DOM 검색으로 버튼 찾기 (최후의 수단)
      const foundButton = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, div[role="button"], span[role="button"]');
        for (const button of buttons) {
          const text = button.textContent?.toLowerCase() || '';
          if (text.includes('next') || text.includes('continue') ||
              text.includes('sign in') || text.includes('다음')) {
            button.click();
            return true;
          }
        }
        return false;
      });

      if (foundButton) {
        this.log(`✅ Next 버튼 클릭 (DOM 검색)`, 'debug');
        return true;
      }

      return false;
    } catch (error) {
      this.log(`Next 버튼 클릭 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 휴먼라이크 타이핑
   */
  async humanLikeType(page, text) {
    // 타이핑 시작 전 짧은 대기
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // 타이핑 속도 변화 (실제 사람처럼)
      let delay;
      if (i === 0) {
        // 첫 문자는 조금 더 느리게
        delay = 150 + Math.random() * 100;
      } else if (i < 3) {
        // 처음 몇 글자는 천천히
        delay = 100 + Math.random() * 80;
      } else if (i > text.length - 3) {
        // 마지막 몇 글자도 천천히
        delay = 100 + Math.random() * 80;
      } else {
        // 중간은 빠르게 (하지만 변화있게)
        delay = 50 + Math.random() * 70;
      }
      
      // 특수문자나 대문자는 조금 더 느리게
      if (!/[a-z0-9]/.test(char)) {
        delay += 50 + Math.random() * 50;
      }
      
      // 가끔 더 긴 지연 추가 (실수 교정하는 것처럼)
      if (Math.random() < 0.05) {
        delay += 200 + Math.random() * 300;
      }
      
      await page.keyboard.type(char);
      await new Promise(r => setTimeout(r, delay));
    }
    
    // 타이핑 완료 후 짧은 대기
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
  }

  /**
   * 로그인 상태 확인 (개선됨 - YouTube Premium 페이지 인식 강화)
   */
  async checkLoginStatus(page) {
    try {
      // 현재 URL 가져오기
      const currentUrl = page.url();
      this.log(`로그인 상태 확인 - 현재 URL: ${currentUrl}`, 'debug');

      // ★★★ YouTube Premium 멤버십 페이지 우선 체크 ★★★
      // 이 페이지에 정상적으로 있다면 이미 로그인된 상태
      if (currentUrl.includes('youtube.com/paid_memberships') ||
          currentUrl.includes('youtube.com/premium')) {
        this.log('YouTube Premium 페이지 감지 - 로그인 상태 확인 중...', 'debug');

        const isPremiumPage = await page.evaluate(() => {
          const bodyText = document.body?.textContent || '';
          // Premium 멤버십 페이지의 핵심 키워드 확인
          return bodyText.includes('Memberships') ||
                 bodyText.includes('멤버십') ||
                 bodyText.includes('Manage membership') ||
                 bodyText.includes('Premium') ||
                 bodyText.includes('Family membership') ||
                 bodyText.includes('가족 요금제');
        });

        if (isPremiumPage) {
          this.log('✅ YouTube Premium 멤버십 페이지 - 로그인됨', 'success');
          return true;
        }
      }

      // 계정 선택 페이지나 로그인 페이지에 있으면 로그인 안됨
      if (currentUrl.includes('accounts.google.com/v3/signin') ||
          currentUrl.includes('accountchooser') ||
          currentUrl.includes('/ServiceLogin') ||
          currentUrl.includes('/challenge/pwd') ||
          currentUrl.includes('/signin/v2')) {
        this.log('로그인 페이지 감지 - 로그인 필요', 'debug');
        return false;
      }

      // YouTube나 Google 서비스 페이지에서 추가 체크
      const isLoggedIn = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.textContent || '';

        // 로그인 페이지 관련 URL은 명확하게 false
        if (url.includes('accounts.google.com') &&
            (url.includes('signin') || url.includes('accountchooser') || url.includes('ServiceLogin'))) {
          return false;
        }

        // YouTube 페이지에서 로그인 확인
        if (url.includes('youtube.com')) {
          // ★★★ Premium 멤버십 관련 콘텐츠가 있으면 로그인됨 (최우선) ★★★
          if (bodyText.includes('Memberships') ||
              bodyText.includes('멤버십') ||
              bodyText.includes('Manage membership') ||
              bodyText.includes('멤버십 관리') ||
              bodyText.includes('Family membership')) {
            return true;
          }

          // YouTube 로그인 버튼이 있으면 로그인 안됨
          const signInButton = document.querySelector('a[aria-label*="Sign in"]') ||
                              document.querySelector('a[href*="/signin"]') ||
                              document.querySelector('tp-yt-paper-button[aria-label*="Sign in"]');
          if (signInButton) return false;

          // 계정 아바타가 있으면 로그인됨
          const avatar = document.querySelector('#avatar-btn') ||
                        document.querySelector('button[id="avatar-btn"]') ||
                        document.querySelector('img.yt-img-shadow[alt*="Avatar"]');
          if (avatar) return true;
        }

        // Google 계정 페이지
        if (url.includes('myaccount.google.com')) {
          return true;
        }

        // 계정 아바타 체크 (Google 서비스 전반)
        const googleAvatar = document.querySelector('img[aria-label*="Google Account"]') ||
                            document.querySelector('a[aria-label*="Google Account"]') ||
                            document.querySelector('[data-ogsr-up]');

        return !!googleAvatar;
      });

      this.log(`로그인 상태 체크 결과: ${isLoggedIn}`, 'debug');
      return isLoggedIn;

    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 세션 저장
   */
  saveSession(identifier, data) {
    const sessionId = this.generateSessionId(identifier);
    
    this.sessions.set(sessionId, {
      ...data,
      sessionId,
      createdAt: new Date().toISOString()
    });
    
    return sessionId;
  }

  /**
   * 세션 ID 생성
   */
  generateSessionId(identifier) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const hash = crypto.createHash('sha256')
      .update(`${identifier}-${timestamp}-${random}`)
      .digest('hex')
      .substring(0, 16);
    
    return `session_${hash}`;
  }

  /**
   * 캐시된 로그인 상태 저장
   */
  setCachedLoginStatus(profileId, status) {
    this.loginCache.set(profileId, {
      data: status,
      timestamp: Date.now()
    });
  }

  /**
   * 스크린샷 저장 헬퍼
   */
  async saveScreenshot(page, filename) {
    try {
      const fs = require('fs');
      const path = require('path');

      // filename에서 'screenshots/' prefix 제거 (중복 방지)
      let cleanFilename = filename;
      if (cleanFilename.startsWith('screenshots/') || cleanFilename.startsWith('screenshots\\')) {
        cleanFilename = cleanFilename.substring('screenshots/'.length);
      }

      const dir = path.join(process.cwd(), 'screenshots');

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const filepath = path.join(dir, cleanFilename);

      // 디렉토리 생성 (debug, errors 등)
      const fileDir = path.dirname(filepath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      await page.screenshot({
        path: filepath,
        fullPage: false
      });

      return filepath;
    } catch (error) {
      this.log(`스크린샷 저장 실패: ${error.message}`, 'debug');
      return null;
    }
  }

  /**
   * 브라우저 오류 페이지 처리
   */
  async handleBrowserErrorPage(page, options = {}) {
    this.log('🛠️ 브라우저 오류 페이지 복구 시작', 'warning');
    console.log(chalk.yellow('\n  [오류 복구] 브라우저 오류 감지 - 페이지 새로고침 시도'));
    
    // 디버그 스크린샷
    const timestamp = Date.now();
    try {
      const screenshotPath = `screenshots/debug/browser-error-${timestamp}.png`;
      await this.saveScreenshot(page, screenshotPath);
      console.log(chalk.gray(`  📸 오류 페이지 스크린샷: ${screenshotPath}`));
    } catch (e) {
      // 무시
    }
    
    try {
      // 페이지 새로고침 시도
      this.log('🔄 페이지 새로고침 중...', 'info');
      console.log(chalk.blue('  🔄 페이지 새로고침 시도'));
      
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      
      // 새로고침 후 페이지 타입 확인
      const newPageType = await this.detectPageType(page);
      this.log(`새로고침 후 페이지 타입: ${newPageType}`, 'info');
      
      if (newPageType === 'browser_error') {
        // 여전히 오류인 경우 URL 재접속 시도 (3회, ERR_CONNECTION_CLOSED 대응)
        this.log('⚠️ 새로고침 후에도 오류 지속, URL 재접속 시도 (최대 3회)', 'warning');
        console.log(chalk.yellow('  ⚠️ URL 재접속 시도 (프록시 재연결 대기)'));

        const currentUrl = page.url();
        const targetUrl = currentUrl.includes('accounts.google.com')
          ? 'https://accounts.google.com'
          : currentUrl.includes('google.com')
          ? 'https://www.google.com'
          : currentUrl;

        let navigationSuccess = false;
        let finalPageType = 'browser_error';

        // 3회 재시도 (ERR_CONNECTION_CLOSED 대응)
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            this.log(`🔄 URL 재접속 시도 ${attempt}/3: ${targetUrl}`, 'info');
            console.log(chalk.gray(`  🔄 시도 ${attempt}/3: ${targetUrl.substring(0, 50)}...`));

            await page.goto(targetUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 40000
            });

            navigationSuccess = true;
            console.log(chalk.green(`  ✅ 페이지 이동 성공 (${attempt}번째 시도)`));

            await new Promise(r => setTimeout(r, 3000));

            // 재접속 후 페이지 타입 확인
            finalPageType = await this.detectPageType(page);
            this.log(`재접속 후 페이지 타입 (시도 ${attempt}): ${finalPageType}`, 'info');

            if (finalPageType !== 'browser_error') {
              // 복구 성공
              break;
            }

          } catch (navError) {
            this.log(`시도 ${attempt}/3 실패: ${navError.message}`, 'warning');
            console.log(chalk.yellow(`  ⚠️ 이동 실패 (${attempt}/3): ${navError.message.substring(0, 50)}`));

            if (navError.message.includes('ERR_CONNECTION_CLOSED') ||
                navError.message.includes('ERR_NETWORK_CHANGED')) {
              this.log('🔄 프록시 재연결 대기 중... (5초)', 'info');
              console.log(chalk.gray('  ⏳ 프록시 재연결 대기 (5초)'));
              await new Promise(r => setTimeout(r, 5000));
            } else {
              await new Promise(r => setTimeout(r, 2000));
            }

            if (attempt === 3) {
              this.log('❌ 모든 재접속 시도 실패', 'error');
              console.log(chalk.red('  ❌ URL 재접속 모두 실패'));
            }
          }
        }

        // 복구 성공 여부 확인
        if (finalPageType !== 'browser_error') {
          this.log('✅ 오류 복구 성공', 'success');
          console.log(chalk.green('  ✅ 브라우저 오류 복구 완료'));

          // 복구 후 스크린샷
          try {
            const recoveryPath = `screenshots/debug/browser-recovery-${timestamp}.png`;
            await this.saveScreenshot(page, recoveryPath);
            console.log(chalk.gray(`  📸 복구 후 스크린샷: ${recoveryPath}`));
          } catch (e) {
            // 무시
          }

          // 복구 성공, 다시 로그인 시도 필요
          return {
            success: false,
            error: 'BROWSER_ERROR_RECOVERED',
            message: '브라우저 오류 복구됨, 재시도 필요',
            skipRetry: false
          };
        }
      } else {
        // 새로고침으로 복구 성공
        this.log('✅ 새로고침으로 오류 복구 성공', 'success');
        console.log(chalk.green('  ✅ 페이지 새로고침으로 복구 완료'));
        
        return { 
          success: false, 
          error: 'BROWSER_ERROR_RECOVERED',
          message: '브라우저 오류 복구됨, 재시도 필요',
          skipRetry: false
        };
      }
      
      // 복구 실패
      this.log('❌ 브라우저 오류 복구 실패', 'error');
      return { 
        success: false, 
        error: 'BROWSER_ERROR_PERSISTENT',
        message: '브라우저 오류를 복구할 수 없습니다',
        skipRetry: true
      };
      
    } catch (error) {
      this.log(`❌ 브라우저 오류 처리 실패: ${error.message}`, 'error');
      console.log(chalk.red(`  ❌ 오류: ${error.message}`));
      
      return { 
        success: false, 
        error: 'BROWSER_ERROR_HANDLING_FAILED',
        message: error.message,
        skipRetry: true
      };
    }
  }

  /**
   * 에러 페이지 처리 (unknownerror)
   */
  async handleErrorPage(page, options = {}) {
    this.log('🚨 Google 로그인 에러 페이지 처리', 'warning');
    console.log(chalk.yellow('\n  [에러 페이지] "문제가 발생했습니다" 페이지 감지'));

    // 디버그 스크린샷
    const timestamp = Date.now();
    try {
      const screenshotPath = `screenshots/debug/error-page-${timestamp}.png`;
      await this.saveScreenshot(page, screenshotPath);
      console.log(chalk.gray(`  📸 에러 페이지 스크린샷: ${screenshotPath}`));
    } catch (e) {
      // 무시
    }

    try {
      // "다시 시도" 버튼 찾기
      const retryButtonSelectors = [
        // 한국어
        'button:has-text("다시 시도")',
        'button:has-text("재시도")',
        'button:has-text("다시")',
        'button[aria-label*="다시 시도"]',
        'button[aria-label*="재시도"]',
        'div[role="button"]:has-text("다시 시도")',
        'div[role="button"]:has-text("재시도")',
        'a:has-text("다시 시도")',
        // 영어
        'button:has-text("Try again")',
        'button:has-text("Retry")',
        'button[aria-label*="Try again"]',
        'button[aria-label*="Retry"]',
        'div[role="button"]:has-text("Try again")',
        'div[role="button"]:has-text("Retry")',
        'a:has-text("Try again")',
        // Google 특정 선택자
        '[jsname="LgbsSe"]:has-text("다시 시도")',
        '[jsname="LgbsSe"]:has-text("Try again")',
        'button[data-mdc-dialog-action="retry"]'
      ];

      let retryButton = null;
      let buttonText = '';

      // 페이지에서 버튼 찾기
      for (const selector of retryButtonSelectors) {
        try {
          const found = await page.evaluate((sel) => {
            // :has-text 처리
            if (sel.includes(':has-text')) {
              const [baseSelector, textPart] = sel.split(':has-text(');
              const searchText = textPart.replace('")', '').replace('"', '');
              const elements = document.querySelectorAll(baseSelector || '*');

              for (const el of elements) {
                if (el.textContent && el.textContent.includes(searchText)) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    el.setAttribute('data-error-retry-button', 'true');
                    return { found: true, text: el.textContent.trim() };
                  }
                }
              }
              return { found: false };
            } else {
              // 일반 선택자
              const el = document.querySelector(sel);
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  el.setAttribute('data-error-retry-button', 'true');
                  return { found: true, text: el.textContent?.trim() || '' };
                }
              }
              return { found: false };
            }
          }, selector);

          if (found.found) {
            retryButton = await page.$('[data-error-retry-button="true"]');
            buttonText = found.text;
            this.log(`✅ 다시 시도 버튼 찾음: "${buttonText}"`, 'success');
            console.log(chalk.green(`  ✅ 버튼 발견: "${buttonText}"`));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }

      // 버튼을 못 찾은 경우 페이지 내 모든 버튼 검사
      if (!retryButton) {
        this.log('일반 선택자로 버튼을 찾지 못함, 전체 버튼 검사 중...', 'debug');

        const allButtons = await page.evaluate(() => {
          const buttons = [];
          const elements = document.querySelectorAll('button, div[role="button"], a[role="button"]');

          elements.forEach(el => {
            const text = el.textContent?.trim().toLowerCase() || '';
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

            // 다시 시도 관련 텍스트 확인
            if (text.includes('다시') || text.includes('재시도') ||
                text.includes('try again') || text.includes('retry') ||
                ariaLabel.includes('다시') || ariaLabel.includes('try again')) {

              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                buttons.push({
                  text: el.textContent?.trim(),
                  index: Array.from(elements).indexOf(el),
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2
                });
              }
            }
          });

          return buttons;
        });

        if (allButtons.length > 0) {
          const targetButton = allButtons[0];
          this.log(`🎯 대체 버튼 발견: "${targetButton.text}"`, 'info');
          console.log(chalk.cyan(`  🎯 대체 버튼 클릭: "${targetButton.text}"`));

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 🤖→👤 사람처럼 클릭하기 (봇 감지 방지)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          // 1️⃣ 클릭 전 랜덤 대기 (100-300ms)
          const preClickDelay = 100 + Math.random() * 200;
          await new Promise(r => setTimeout(r, preClickDelay));

          // 2️⃣ 좌표 랜덤화 (버튼 중심에서 ±4px)
          const randomOffsetX = (Math.random() - 0.5) * 8;
          const randomOffsetY = (Math.random() - 0.5) * 8;
          const finalX = targetButton.x + randomOffsetX;
          const finalY = targetButton.y + randomOffsetY;

          // 3️⃣ 마우스 점진적 이동 (3단계)
          const currentPosition = await page.evaluate(() => ({ x: 0, y: 0 }));
          const steps = 3;

          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const intermediateX = currentPosition.x + (finalX - currentPosition.x) * progress;
            const intermediateY = currentPosition.y + (finalY - currentPosition.y) * progress;

            await page.mouse.move(intermediateX, intermediateY);
            await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
          }

          // 4️⃣ 최종 클릭
          this.log(`🖱️ 사람처럼 클릭 중... (x: ${Math.round(finalX)}, y: ${Math.round(finalY)})`, 'debug');
          await page.mouse.click(finalX, finalY);

          // 5️⃣ 클릭 후 자연스러운 일시정지
          const postClickDelay = 1000 + Math.random() * 1000;
          await new Promise(r => setTimeout(r, postClickDelay));

          // 페이지 변화 확인
          const afterUrl = page.url();
          if (!afterUrl.includes('unknownerror')) {
            this.log('✅ 에러 페이지에서 벗어났습니다', 'success');
            console.log(chalk.green('  ✅ 다시 시도 성공'));
            return { success: true };
          }
        }
      }

      // 찾은 버튼 클릭
      if (retryButton) {
        this.log(`🖱️ "${buttonText}" 버튼 클릭 중...`, 'info');

        // 여러 클릭 방법 시도
        let clicked = false;

        // 방법 1: 일반 click()
        try {
          await retryButton.click();
          await new Promise(r => setTimeout(r, 2000));

          const afterUrl1 = page.url();
          if (!afterUrl1.includes('unknownerror')) {
            clicked = true;
            this.log('✅ 일반 클릭으로 에러 페이지 벗어나기 성공', 'success');
          }
        } catch (e) {
          this.log('일반 클릭 실패, 다른 방법 시도', 'debug');
        }

        // 방법 2: evaluate로 직접 클릭
        if (!clicked) {
          try {
            await page.evaluate(() => {
              const button = document.querySelector('[data-error-retry-button="true"]');
              if (button) {
                button.click();
                // 추가로 이벤트 발생
                const clickEvent = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: true
                });
                button.dispatchEvent(clickEvent);
              }
            });
            await new Promise(r => setTimeout(r, 2000));

            const afterUrl2 = page.url();
            if (!afterUrl2.includes('unknownerror')) {
              clicked = true;
              this.log('✅ JavaScript 클릭으로 에러 페이지 벗어나기 성공', 'success');
            }
          } catch (e) {
            this.log('JavaScript 클릭 실패, 다른 방법 시도', 'debug');
          }
        }

        // 방법 3: 좌표 기반 클릭 (사람처럼)
        if (!clicked) {
          try {
            const box = await retryButton.boundingBox();
            if (box) {
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              // 🤖→👤 사람처럼 클릭하기 (봇 감지 방지)
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

              // 1️⃣ 클릭 전 랜덤 대기 (100-300ms)
              const preClickDelay = 100 + Math.random() * 200;
              await new Promise(r => setTimeout(r, preClickDelay));

              // 2️⃣ 좌표 랜덤화 (버튼 중심에서 ±4px)
              const centerX = box.x + box.width / 2;
              const centerY = box.y + box.height / 2;
              const randomOffsetX = (Math.random() - 0.5) * 8;
              const randomOffsetY = (Math.random() - 0.5) * 8;
              const finalX = centerX + randomOffsetX;
              const finalY = centerY + randomOffsetY;

              // 3️⃣ 마우스 점진적 이동 (3단계)
              const currentPosition = await page.evaluate(() => ({ x: 0, y: 0 }));
              const steps = 3;

              for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                const intermediateX = currentPosition.x + (finalX - currentPosition.x) * progress;
                const intermediateY = currentPosition.y + (finalY - currentPosition.y) * progress;

                await page.mouse.move(intermediateX, intermediateY);
                await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
              }

              // 4️⃣ 최종 클릭
              this.log(`🖱️ 사람처럼 클릭 중... (x: ${Math.round(finalX)}, y: ${Math.round(finalY)})`, 'debug');
              await page.mouse.click(finalX, finalY);

              // 5️⃣ 클릭 후 자연스러운 일시정지
              const postClickDelay = 1000 + Math.random() * 1000;
              await new Promise(r => setTimeout(r, postClickDelay));

              const afterUrl3 = page.url();
              if (!afterUrl3.includes('unknownerror')) {
                clicked = true;
                this.log('✅ 좌표 클릭으로 에러 페이지 벗어나기 성공', 'success');
              }
            }
          } catch (e) {
            this.log('좌표 클릭 실패', 'debug');
          }
        }

        // 클릭 성공 확인
        if (clicked) {
          console.log(chalk.green('  ✅ 다시 시도 버튼 클릭 성공'));

          // 클릭 후 페이지 전환 대기
          await new Promise(r => setTimeout(r, 3000));

          // 다시 시도 후 스크린샷
          try {
            const afterPath = `screenshots/debug/after-retry-${timestamp}.png`;
            await this.saveScreenshot(page, afterPath);
            console.log(chalk.gray(`  📸 다시 시도 후 스크린샷: ${afterPath}`));
          } catch (e) {
            // 무시
          }

          return { success: true };
        } else {
          this.log('⚠️ 버튼 클릭 후에도 에러 페이지에 남아있음', 'warning');
        }
      }

      // 버튼을 찾지 못한 경우 페이지 새로고침 시도
      this.log('⚠️ 다시 시도 버튼을 찾을 수 없어 페이지를 새로고침합니다', 'warning');
      console.log(chalk.yellow('  ⚠️ 페이지 새로고침 시도'));

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      // 새로고침 후 URL 확인
      const afterReloadUrl = page.url();
      if (!afterReloadUrl.includes('unknownerror')) {
        this.log('✅ 새로고침으로 에러 페이지를 벗어났습니다', 'success');
        return { success: true };
      }

      // Google 로그인 페이지로 직접 이동
      this.log('⚠️ Google 로그인 페이지로 직접 이동 시도', 'warning');
      console.log(chalk.yellow('  ⚠️ Google 로그인 페이지로 재접속'));

      await page.goto('https://accounts.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));

      const finalUrl = page.url();
      if (!finalUrl.includes('unknownerror')) {
        this.log('✅ 로그인 페이지로 이동 성공', 'success');
        return { success: true };
      }

      // 최종 실패
      this.log('❌ 에러 페이지를 벗어날 수 없습니다', 'error');
      return {
        success: false,
        error: 'ERROR_PAGE_PERSISTENT',
        message: '에러 페이지를 벗어날 수 없습니다',
        skipRetry: true
      };

    } catch (error) {
      this.log(`❌ 에러 페이지 처리 실패: ${error.message}`, 'error');
      console.log(chalk.red(`  ❌ 오류: ${error.message}`));

      // 오류 스크린샷
      try {
        await page.screenshot({
          path: `screenshots/error_page_handling_${Date.now()}.png`
        });
      } catch (e) {
        // 무시
      }

      return {
        success: false,
        error: 'ERROR_PAGE_HANDLING_FAILED',
        message: error.message,
        skipRetry: true
      };
    }
  }

  /**
   * 패스키 등록 페이지 처리
   */
  async handlePasskeyEnrollmentPage(page, options = {}) {
    this.log('🔑 패스키 등록 페이지 처리 시작', 'info');
    console.log(chalk.blue('\n  [패스키 페이지] 패스키 등록 건너뛰기'));

    // 디버그 스크린샷
    const timestamp = Date.now();
    const startTime = Date.now();
    const maxProcessTime = 30000; // 30초 타임아웃

    try {
      const screenshotPath = `screenshots/debug/passkey-page-${timestamp}.png`;
      await this.saveScreenshot(page, screenshotPath);
      console.log(chalk.gray(`  📸 패스키 페이지 스크린샷: ${screenshotPath}`));
    } catch (e) {
      // 무시
    }

    try {
      // ★★★ v2.3 - 검은 화면/SSL 에러 감지 및 복구 (새로 추가) ★★★
      const isBlackScreenOrError = await this.checkForBlackScreenOrSSLError(page);
      if (isBlackScreenOrError.hasError) {
        this.log(`⚠️ ${isBlackScreenOrError.errorType} 감지됨 - 복구 시도`, 'warning');
        console.log(chalk.yellow(`\n  ⚠️ [패스키] ${isBlackScreenOrError.errorType} 감지됨`));
        console.log(chalk.cyan(`  🔄 복구 시도 중... (최대 1회 새로고침)`));

        // 페이지 새로고침 시도
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          console.log(chalk.green(`  ✅ 새로고침 완료`));
          await new Promise(r => setTimeout(r, 3000));

          // 새로고침 후 다시 체크
          const stillError = await this.checkForBlackScreenOrSSLError(page);
          if (stillError.hasError) {
            this.log('❌ 새로고침 후에도 에러 지속 - 스킵 권장', 'error');
            console.log(chalk.red(`  ❌ 복구 실패 - 이 페이지는 스킵합니다`));
            return {
              success: false,
              error: 'PASSKEY_BLACK_SCREEN',
              message: '패스키 페이지 로딩 실패 (SSL 에러/검은 화면)',
              skipRetry: false,  // 재시도 허용 (다음 로그인 시도에서)
              shouldSkipProfile: true  // 이 프로필 스킵 권장
            };
          }
          console.log(chalk.green(`  ✅ 복구 성공 - 계속 진행`));
        } catch (reloadError) {
          this.log(`새로고침 실패: ${reloadError.message}`, 'error');
          return {
            success: false,
            error: 'PASSKEY_RELOAD_FAILED',
            message: '패스키 페이지 새로고침 실패',
            skipRetry: false,
            shouldSkipProfile: true
          };
        }
      }

      // 타임아웃 체크
      if (Date.now() - startTime > maxProcessTime) {
        this.log('⏱️ 패스키 페이지 처리 타임아웃', 'error');
        return {
          success: false,
          error: 'PASSKEY_TIMEOUT',
          message: '패스키 페이지 처리 시간 초과',
          skipRetry: true
        };
      }
      // "나중에" 또는 "Skip" 버튼 찾기
      const skipButtonSelectors = [
        // 한국어
        'button:has-text("나중에")',
        'button:has-text("건너뛰기")',
        'button:has-text("다음에")',
        'button[aria-label*="나중에"]',
        'button[aria-label*="건너뛰기"]',
        'div[role="button"]:has-text("나중에")',
        'div[role="button"]:has-text("건너뛰기")',
        'a:has-text("나중에")',
        'a:has-text("건너뛰기")',
        // 영어
        'button:has-text("Not now")',
        'button:has-text("Skip")',
        'button:has-text("Later")',
        'button:has-text("Remind me later")',
        'button[aria-label*="Not now"]',
        'button[aria-label*="Skip"]',
        'div[role="button"]:has-text("Not now")',
        'div[role="button"]:has-text("Skip")',
        'a:has-text("Not now")',
        'a:has-text("Skip")',
        // Google 특정 선택자
        '[jsname="LgbsSe"]:has-text("나중에")',
        '[jsname="LgbsSe"]:has-text("Not now")',
        'button[data-mdc-dialog-action="cancel"]',
        'button[data-mdc-dialog-action="skip"]'
      ];
      
      let skipButton = null;
      let buttonText = '';
      
      // 페이지에서 버튼 찾기
      for (const selector of skipButtonSelectors) {
        try {
          // Puppeteer의 :has-text 선택자는 지원되지 않을 수 있으므로 evaluate 사용
          const found = await page.evaluate((sel) => {
            // :has-text 처리
            if (sel.includes(':has-text')) {
              const [baseSelector, textPart] = sel.split(':has-text(');
              const searchText = textPart.replace('")', '').replace('"', '');
              const elements = document.querySelectorAll(baseSelector || '*');
              
              for (const el of elements) {
                if (el.textContent && el.textContent.includes(searchText)) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    el.setAttribute('data-passkey-skip-button', 'true');
                    return { found: true, text: el.textContent.trim() };
                  }
                }
              }
              return { found: false };
            } else {
              // 일반 선택자
              const el = document.querySelector(sel);
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  el.setAttribute('data-passkey-skip-button', 'true');
                  return { found: true, text: el.textContent?.trim() || '' };
                }
              }
              return { found: false };
            }
          }, selector);
          
          if (found.found) {
            skipButton = await page.$('[data-passkey-skip-button="true"]');
            buttonText = found.text;
            this.log(`✅ 건너뛰기 버튼 찾음: "${buttonText}"`, 'success');
            console.log(chalk.green(`  ✅ 버튼 발견: "${buttonText}"`));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      // 버튼을 못 찾은 경우 페이지 내 모든 버튼 검사
      if (!skipButton) {
        this.log('일반 선택자로 버튼을 찾지 못함, 전체 버튼 검사 중...', 'debug');

        const allButtons = await page.evaluate(() => {
          const buttons = [];
          const elements = document.querySelectorAll('button, div[role="button"], a[role="button"]');

          elements.forEach(el => {
            const text = el.textContent?.trim().toLowerCase() || '';
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

            // 건너뛰기 관련 텍스트 확인
            if (text.includes('나중에') || text.includes('건너뛰기') ||
                text.includes('다음에') || text.includes('not now') ||
                text.includes('skip') || text.includes('later') ||
                ariaLabel.includes('나중에') || ariaLabel.includes('skip') ||
                ariaLabel.includes('not now')) {

              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                buttons.push({
                  text: el.textContent?.trim(),
                  index: Array.from(elements).indexOf(el),
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2
                });
              }
            }
          });

          return buttons;
        });

        if (allButtons.length > 0) {
          const targetButton = allButtons[0];
          this.log(`🎯 대체 버튼 발견: "${targetButton.text}"`, 'info');
          console.log(chalk.cyan(`  🎯 대체 버튼 클릭: "${targetButton.text}"`));

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 🤖→👤 사람처럼 클릭하기 (봇 감지 방지)
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

          // 1️⃣ 클릭 전 랜덤 대기 (100-300ms)
          const preClickDelay = 100 + Math.random() * 200;
          await new Promise(r => setTimeout(r, preClickDelay));

          // 2️⃣ 좌표 랜덤화 (버튼 중심에서 ±4px)
          const randomOffsetX = (Math.random() - 0.5) * 8; // -4 ~ +4
          const randomOffsetY = (Math.random() - 0.5) * 8;
          const finalX = targetButton.x + randomOffsetX;
          const finalY = targetButton.y + randomOffsetY;

          // 3️⃣ 마우스 점진적 이동 (3단계)
          const currentPosition = await page.evaluate(() => ({ x: 0, y: 0 }));
          const steps = 3;

          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const intermediateX = currentPosition.x + (finalX - currentPosition.x) * progress;
            const intermediateY = currentPosition.y + (finalY - currentPosition.y) * progress;

            await page.mouse.move(intermediateX, intermediateY);
            await new Promise(r => setTimeout(r, 20 + Math.random() * 30)); // 20-50ms per step
          }

          // 4️⃣ 최종 클릭
          this.log(`🖱️ 사람처럼 클릭 중... (x: ${Math.round(finalX)}, y: ${Math.round(finalY)})`, 'debug');
          await page.mouse.click(finalX, finalY);

          // 5️⃣ 클릭 후 자연스러운 일시정지 (1-2초)
          const postClickDelay = 1000 + Math.random() * 1000;
          await new Promise(r => setTimeout(r, postClickDelay));

          // 페이지 변화 확인
          const afterUrl = page.url();
          if (!afterUrl.includes('passkeyenrollment')) {
            this.log('✅ 패스키 페이지를 성공적으로 건너뛰었습니다', 'success');
            console.log(chalk.green('  ✅ 패스키 등록을 건너뛰었습니다'));
            return { success: true };
          }
        }
      }
      
      // 찾은 버튼 클릭
      if (skipButton) {
        this.log(`🖱️ "${buttonText}" 버튼 클릭 중...`, 'info');
        
        // 여러 클릭 방법 시도
        let clicked = false;
        
        // 방법 1: 일반 click()
        try {
          await skipButton.click();
          await new Promise(r => setTimeout(r, 2000));
          
          const afterUrl1 = page.url();
          if (!afterUrl1.includes('passkeyenrollment')) {
            clicked = true;
            this.log('✅ 일반 클릭으로 패스키 페이지 건너뛰기 성공', 'success');
          }
        } catch (e) {
          this.log('일반 클릭 실패, 다른 방법 시도', 'debug');
        }
        
        // 방법 2: evaluate로 직접 클릭
        if (!clicked) {
          try {
            await page.evaluate(() => {
              const button = document.querySelector('[data-passkey-skip-button="true"]');
              if (button) {
                button.click();
                // 추가로 이벤트 발생
                const clickEvent = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: true
                });
                button.dispatchEvent(clickEvent);
              }
            });
            await new Promise(r => setTimeout(r, 2000));
            
            const afterUrl2 = page.url();
            if (!afterUrl2.includes('passkeyenrollment')) {
              clicked = true;
              this.log('✅ JavaScript 클릭으로 패스키 페이지 건너뛰기 성공', 'success');
            }
          } catch (e) {
            this.log('JavaScript 클릭 실패, 다른 방법 시도', 'debug');
          }
        }
        
        // 방법 3: 좌표 기반 클릭 (사람처럼)
        if (!clicked) {
          try {
            const box = await skipButton.boundingBox();
            if (box) {
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              // 🤖→👤 사람처럼 클릭하기 (봇 감지 방지)
              // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

              // 1️⃣ 클릭 전 랜덤 대기 (100-300ms)
              const preClickDelay = 100 + Math.random() * 200;
              await new Promise(r => setTimeout(r, preClickDelay));

              // 2️⃣ 좌표 랜덤화 (버튼 중심에서 ±4px)
              const centerX = box.x + box.width / 2;
              const centerY = box.y + box.height / 2;
              const randomOffsetX = (Math.random() - 0.5) * 8; // -4 ~ +4
              const randomOffsetY = (Math.random() - 0.5) * 8;
              const finalX = centerX + randomOffsetX;
              const finalY = centerY + randomOffsetY;

              // 3️⃣ 마우스 점진적 이동 (3단계)
              const currentPosition = await page.evaluate(() => ({ x: 0, y: 0 }));
              const steps = 3;

              for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                const intermediateX = currentPosition.x + (finalX - currentPosition.x) * progress;
                const intermediateY = currentPosition.y + (finalY - currentPosition.y) * progress;

                await page.mouse.move(intermediateX, intermediateY);
                await new Promise(r => setTimeout(r, 20 + Math.random() * 30)); // 20-50ms per step
              }

              // 4️⃣ 최종 클릭
              this.log(`🖱️ 사람처럼 클릭 중... (x: ${Math.round(finalX)}, y: ${Math.round(finalY)})`, 'debug');
              await page.mouse.click(finalX, finalY);

              // 5️⃣ 클릭 후 자연스러운 일시정지 (1-2초)
              const postClickDelay = 1000 + Math.random() * 1000;
              await new Promise(r => setTimeout(r, postClickDelay));

              const afterUrl3 = page.url();
              if (!afterUrl3.includes('passkeyenrollment')) {
                clicked = true;
                this.log('✅ 좌표 클릭으로 패스키 페이지 건너뛰기 성공', 'success');
              }
            }
          } catch (e) {
            this.log('좌표 클릭 실패', 'debug');
          }
        }
        
        // 클릭 성공 확인
        if (clicked) {
          console.log(chalk.green('  ✅ 패스키 등록을 건너뛰었습니다'));
          
          // 클릭 후 페이지 전환 대기
          await new Promise(r => setTimeout(r, 3000));
          
          // 건너뛰기 후 스크린샷
          try {
            const afterPath = `screenshots/debug/after-skip-passkey-${timestamp}.png`;
            await this.saveScreenshot(page, afterPath);
            console.log(chalk.gray(`  📸 건너뛰기 후 스크린샷: ${afterPath}`));
          } catch (e) {
            // 무시
          }
          
          // 현재 URL 확인하여 예상치 못한 페이지로 이동했는지 체크
          const currentUrl = page.url();
          this.log(`패스키 건너뛰기 후 URL: ${currentUrl}`, 'debug');
          
          // Google 계정 설정 페이지로 이동한 경우
          if (currentUrl.includes('myaccount.google.com') || 
              currentUrl.includes('people-and-sharing')) {
            this.log('⚠️ Google 계정 설정 페이지로 리다이렉션됨', 'warning');
            console.log(chalk.yellow('  ⚠️ 예상치 못한 페이지로 이동됨, YouTube로 다시 이동 필요'));
            
            // YouTube Premium 페이지로 직접 이동
            try {
              await page.goto('https://www.youtube.com/paid_memberships', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
              });
              await new Promise(r => setTimeout(r, 3000));
              
              const finalUrl = page.url();
              if (finalUrl.includes('youtube.com')) {
                this.log('✅ YouTube로 리다이렉션 성공', 'success');
                return { success: true, redirected: true };
              }
            } catch (e) {
              this.log(`리다이렉션 실패: ${e.message}`, 'error');
            }
          }
          
          return { success: true };
        } else {
          this.log('⚠️ 버튼 클릭 후에도 패스키 페이지에 남아있음', 'warning');
        }
      }
      
      // 버튼을 찾지 못한 경우 ESC 키 시도
      this.log('⚠️ 건너뛰기 버튼을 찾을 수 없어 ESC 키를 시도합니다', 'warning');
      console.log(chalk.yellow('  ⚠️ ESC 키로 패스키 페이지 닫기 시도'));
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 1500));
      
      // ESC 후 URL 확인
      const afterEscUrl = page.url();
      if (!afterEscUrl.includes('passkeyenrollment')) {
        this.log('✅ ESC 키로 패스키 페이지를 닫았습니다', 'success');
        return { success: true };
      }
      
      // 최종 실패
      this.log('❌ 패스키 페이지를 건너뛸 수 없습니다', 'error');
      return { 
        success: false, 
        error: 'PASSKEY_SKIP_FAILED',
        message: '패스키 페이지 건너뛰기 실패'
      };
      
    } catch (error) {
      this.log(`❌ 패스키 페이지 처리 실패: ${error.message}`, 'error');
      console.log(chalk.red(`  ❌ 오류: ${error.message}`));
      
      // 오류 스크린샷
      try {
        await page.screenshot({
          path: `screenshots/passkey_error_${Date.now()}.png`
        });
      } catch (e) {
        // 무시
      }
      
      return { 
        success: false, 
        error: 'PASSKEY_HANDLING_ERROR',
        message: error.message 
      };
    }
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
    console.log(chalk[color](`[ImprovedAuth] ${message}`));
  }

  /**
   * "다른 계정 사용" 버튼 클릭
   * 계정 선택 페이지에서 원하는 계정이 없거나 클릭이 실패했을 때 사용
   */
  async clickUseAnotherAccount(page) {
    this.log('🔄 "다른 계정 사용" 버튼 클릭 시도', 'info');

    try {
      // "다른 계정 사용" 버튼 찾기 (다국어 지원)
      const buttonInfo = await page.evaluate(() => {
        // 다양한 언어로 "다른 계정 사용" 버튼 텍스트
        const buttonTexts = [
          // 한국어
          '다른 계정 사용',
          '계정 추가',
          // 영어
          'Use another account',
          'Add another account',
          'Sign in with a different account',
          // 러시아어
          'Использовать другой аккаунт',
          'Добавить аккаунт',
          'Войти в другой аккаунт',
          'Другой аккаунт',
          // 일본어
          '別のアカウントを使用',
          '別のアカウントを追加',
          // 중국어 (번체/간체)
          '使用其他帳戶',
          '使用其他账户',
          '添加帐户',
          // 스페인어
          'Usar otra cuenta',
          'Añadir otra cuenta',
          // 프랑스어
          'Utiliser un autre compte',
          'Ajouter un compte',
          // 이탈리아어
          'Usa un altro account',
          // 독일어
          'Verwende ein anderes Konto',
          'Anderes Konto verwenden',
          // 포르투갈어
          'Use outra conta',
          'Usar outra conta',
          // 태국어
          'ใช้บัญชีอื่น',
          // 베트남어
          'Sử dụng tài khoản khác',
          // 인도네시아어
          'Gunakan akun lain',
          // 말레이시아어
          'Gunakan akaun lain',
          // 아랍어
          'استخدام حساب آخر',
          // 힌디어
          'दूसरे खाते का उपयोग करें'
        ];

        // 방법 1: 텍스트로 찾기
        for (const text of buttonTexts) {
          // 모든 요소 검색
          const elements = Array.from(document.querySelectorAll('*')).filter(el => {
            const elText = el.textContent?.trim();
            return elText && (elText === text || elText.includes(text)) &&
                   el.offsetHeight > 0 && el.offsetWidth > 0;
          });

          for (const element of elements) {
            // 클릭 가능한 요소 찾기
            const clickable = element.closest('li') ||
                            element.closest('[role="button"]') ||
                            element.closest('[role="link"]') ||
                            element.closest('button') ||
                            element.closest('a') ||
                            element;

            if (clickable) {
              const rect = clickable.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                // 선택자 생성
                let selector = null;
                if (clickable.id) {
                  selector = `#${clickable.id}`;
                } else if (clickable.getAttribute('data-identifier')) {
                  selector = `[data-identifier="${clickable.getAttribute('data-identifier')}"]`;
                }

                console.log(`✅ "다른 계정 사용" 버튼 발견: ${text}`);
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  selector: selector,
                  text: text
                };
              }
            }
          }
        }

        // 방법 2: SVG 아이콘 + 텍스트로 찾기 (Google의 계정 추가 버튼 구조)
        const addAccountIcon = document.querySelector('[data-identifier]');
        if (addAccountIcon) {
          // 계정 추가 버튼은 보통 목록 마지막에 있음
          const listItems = document.querySelectorAll('li, [role="link"], [role="button"]');
          for (const item of listItems) {
            const text = item.textContent || '';
            if (buttonTexts.some(btn => text.includes(btn))) {
              const rect = item.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  selector: null,
                  text: '다른 계정 사용'
                };
              }
            }
          }
        }

        console.log('❌ "다른 계정 사용" 버튼을 찾을 수 없음');
        return { found: false };
      });

      if (!buttonInfo.found) {
        this.log('"다른 계정 사용" 버튼을 찾을 수 없음', 'warning');
        return { success: false, error: 'BUTTON_NOT_FOUND' };
      }

      // 버튼 클릭
      this.log(`"${buttonInfo.text}" 버튼 클릭 - 위치: (${Math.round(buttonInfo.x)}, ${Math.round(buttonInfo.y)})`, 'info');

      // 선택자가 있으면 선택자로, 없으면 좌표로 클릭
      if (buttonInfo.selector) {
        try {
          await page.click(buttonInfo.selector);
        } catch (e) {
          // 선택자 실패 시 좌표 클릭
          await page.mouse.click(buttonInfo.x, buttonInfo.y);
        }
      } else {
        await page.mouse.click(buttonInfo.x, buttonInfo.y);
      }

      // 페이지 전환 대기
      await new Promise(r => setTimeout(r, 2000));

      // 페이지 전환 확인
      const currentUrl = page.url();
      const pageType = await this.detectPageType(page);

      this.log(`클릭 후 페이지 타입: ${pageType}`, 'debug');

      // email_input 또는 identifier 페이지로 전환되었는지 확인
      if (pageType === 'email_input' ||
          currentUrl.includes('identifier') ||
          pageType !== 'account_chooser') {
        this.log('✅ "다른 계정 사용" 클릭 성공 - 이메일 입력 페이지로 전환됨', 'success');
        return { success: true, pageType };
      }

      this.log('⚠️ 클릭했지만 페이지 전환 없음', 'warning');
      return { success: false, error: 'NO_PAGE_CHANGE' };

    } catch (error) {
      this.log(`"다른 계정 사용" 버튼 클릭 오류: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * "다음" 버튼 클릭 (본인 확인 페이지, 이메일 입력 후 등에서 사용)
   * @param {Page} page - Puppeteer 페이지 객체
   * @returns {boolean} - 클릭 성공 여부
   */
  async clickNextButton(page) {
    this.log('🔘 "다음" 버튼 클릭 시도', 'debug');

    try {
      // "다음" 버튼 선택자 - 다국어 지원
      const nextButtonSelectors = [
        // CSS 선택자
        'button[type="submit"]',
        'button[jsname="LgbsSe"]',
        'div[role="button"][jsname="LgbsSe"]',
        'button[data-idom-class*="submit"]',
        'input[type="submit"]',
      ];

      // XPath 선택자 (다국어 텍스트)
      const nextButtonXPaths = [
        '//button[contains(text(), "다음")]',
        '//button[contains(text(), "Next")]',
        '//span[contains(text(), "다음")]/ancestor::button',
        '//span[contains(text(), "Next")]/ancestor::button',
        '//div[contains(text(), "다음") and @role="button"]',
        '//div[contains(text(), "Next") and @role="button"]',
        '//button[.//span[contains(text(), "다음")]]',
        '//button[.//span[contains(text(), "Next")]]',
        // 스페인어, 포르투갈어, 독일어
        '//button[contains(text(), "Siguiente")]',
        '//button[contains(text(), "Próximo")]',
        '//button[contains(text(), "Weiter")]',
      ];

      // 1. CSS 선택자로 시도
      for (const selector of nextButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            // 버튼이 보이는지 확인
            const isVisible = await button.isIntersectingViewport();
            if (isVisible) {
              await button.click();
              this.log(`✅ "다음" 버튼 클릭 성공 (CSS: ${selector})`, 'success');
              return true;
            }
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }

      // 2. XPath로 시도
      for (const xpath of nextButtonXPaths) {
        try {
          const [button] = await page.$x(xpath);
          if (button) {
            await button.click();
            this.log(`✅ "다음" 버튼 클릭 성공 (XPath)`, 'success');
            return true;
          }
        } catch (e) {
          // 다음 XPath 시도
        }
      }

      // 3. page.evaluate로 직접 찾기
      const clicked = await page.evaluate(() => {
        // 버튼 텍스트로 찾기
        const buttons = document.querySelectorAll('button, div[role="button"], input[type="submit"]');
        const nextTexts = ['다음', 'Next', 'Siguiente', 'Próximo', 'Weiter', '次へ', '下一步'];

        for (const button of buttons) {
          const buttonText = button.textContent?.trim() || button.value || '';
          for (const nextText of nextTexts) {
            if (buttonText.includes(nextText)) {
              button.click();
              return true;
            }
          }
        }

        // jsname="LgbsSe"로 찾기 (Google 공통 버튼)
        const googleButton = document.querySelector('[jsname="LgbsSe"]');
        if (googleButton) {
          googleButton.click();
          return true;
        }

        return false;
      });

      if (clicked) {
        this.log('✅ "다음" 버튼 클릭 성공 (evaluate)', 'success');
        return true;
      }

      this.log('⚠️ "다음" 버튼을 찾을 수 없음', 'warning');
      return false;

    } catch (error) {
      this.log(`"다음" 버튼 클릭 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * ★★★ v2.3 - 검은 화면 또는 SSL 에러 감지 ★★★
   * 패스키 페이지나 로그인 페이지에서 발생할 수 있는 검은 화면/SSL 에러 감지
   * @param {Page} page - Puppeteer 페이지 인스턴스
   * @returns {Object} { hasError: boolean, errorType: string }
   */
  async checkForBlackScreenOrSSLError(page) {
    try {
      const pageState = await page.evaluate(() => {
        const bodyText = document.body?.textContent?.trim() || '';
        const bodyHTML = document.body?.innerHTML || '';
        const bgColor = window.getComputedStyle(document.body).backgroundColor;

        // 검은 화면 감지 조건
        const isBlackBackground = bgColor === 'rgb(0, 0, 0)' || bgColor === '#000000' || bgColor === 'black';
        const isEmptyPage = bodyText.length < 50 && !bodyHTML.includes('<img') && !bodyHTML.includes('<button');
        const hasSSLError = bodyText.includes('ERR_SSL_PROTOCOL_ERROR') ||
                          bodyText.includes('ERR_CONNECTION_RESET') ||
                          bodyText.includes('ERR_CONNECTION_REFUSED') ||
                          bodyText.includes('ERR_CERT') ||
                          bodyText.includes('NET::ERR');
        const hasNetworkError = bodyText.includes('ERR_NETWORK_CHANGED') ||
                               bodyText.includes('ERR_INTERNET_DISCONNECTED') ||
                               bodyText.includes('ERR_NAME_NOT_RESOLVED');

        return {
          bodyTextLength: bodyText.length,
          isBlackBackground,
          isEmptyPage,
          hasSSLError,
          hasNetworkError,
          bgColor
        };
      });

      // 에러 판단
      if (pageState.hasSSLError) {
        return { hasError: true, errorType: 'SSL 프로토콜 에러' };
      }
      if (pageState.hasNetworkError) {
        return { hasError: true, errorType: '네트워크 에러' };
      }
      if (pageState.isBlackBackground && pageState.isEmptyPage) {
        return { hasError: true, errorType: '검은 화면 (빈 페이지)' };
      }

      return { hasError: false, errorType: null };

    } catch (error) {
      this.log(`페이지 상태 체크 실패: ${error.message}`, 'warning');
      // 페이지 상태 체크 자체가 실패하면 에러로 간주
      return { hasError: true, errorType: '페이지 접근 불가' };
    }
  }
}

module.exports = ImprovedAuthenticationService;