/**
 * Google 로그인 헬퍼 클래스
 * YouTube Premium 워크플로우에서 Google 계정 로그인을 처리
 */

const chalk = require('chalk');

class GoogleLoginHelper {
  constructor(page, browserController, config = {}) {
    this.page = page;
    this.controller = browserController;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      maxRetries: config.maxRetries || 3,
      ...config
    };
  }

  /**
   * 로그인 상태 확인 (개선된 버전)
   */
  async checkLoginStatus() {
    try {
      const currentUrl = this.page.url();
      
      // 로그인 페이지 URL 패턴 확인
      const loginPagePatterns = [
        'accounts.google.com/signin',
        'accounts.google.com/v3/signin',
        'accounts.google.com/ServiceLogin',
        'accounts.google.com/identifier'
      ];
      
      const isLoginPage = loginPagePatterns.some(pattern => 
        currentUrl.includes(pattern)
      );
      
      if (isLoginPage) {
        if (this.config.debugMode) {
          console.log(chalk.yellow('🔐 로그인이 필요한 상태입니다.'));
        }
        return false;
      }
      
      // YouTube Premium 페이지에서 로그인 확인 (개선된 로직)
      if (currentUrl.includes('youtube.com')) {
        const loginCheck = await this.page.evaluate(() => {
          const result = {
            isLoggedIn: false,
            methods: {
              hasAvatar: false,
              noSignInLink: false,
              hasAccountMenu: false,
              hasMembershipContent: false,
              noSignInText: false
            },
            reasons: []
          };
          
          // 방법 1: 아바타/계정 버튼 확인
          const avatarElements = document.querySelectorAll(
            '#avatar-btn, button#avatar-btn, img.yt-img-shadow, ' +
            'button[aria-label*="Account"], button[aria-label*="계정"], ' +
            'ytd-topbar-menu-button-renderer'
          );
          result.methods.hasAvatar = avatarElements.length > 0;
          if (result.methods.hasAvatar) result.reasons.push('아바타/계정 버튼 존재');
          
          // 방법 2: Sign in 링크가 없음
          const signInLinks = document.querySelectorAll(
            'a[href*="accounts.google.com/ServiceLogin"], ' +
            'a[aria-label*="Sign in"], a[aria-label*="로그인"]'
          );
          result.methods.noSignInLink = signInLinks.length === 0;
          if (result.methods.noSignInLink) result.reasons.push('로그인 링크 없음');
          
          // 방법 3: 계정 메뉴 존재
          const accountMenu = document.querySelector(
            '#contentContainer ytd-account-box, ' +
            'tp-yt-iron-dropdown ytd-multi-page-menu-renderer'
          );
          result.methods.hasAccountMenu = accountMenu !== null;
          if (result.methods.hasAccountMenu) result.reasons.push('계정 메뉴 존재');
          
          // 방법 4: 멤버십 관련 콘텐츠
          const pageText = document.body?.textContent || '';
          const hasMembershipContent = 
            pageText.includes('Manage membership') || 
            pageText.includes('Manage Membership') ||
            pageText.includes('관리') || 
            pageText.includes('멤버십') ||
            pageText.includes('membership') ||
            pageText.includes('Membership');
          result.methods.hasMembershipContent = hasMembershipContent;
          if (hasMembershipContent) result.reasons.push('멤버십 콘텐츠 존재');
          
          // 방법 5: Sign in 텍스트가 없음
          const hasSignInText = pageText.includes('Sign in') || pageText.includes('로그인');
          result.methods.noSignInText = !hasSignInText;
          if (result.methods.noSignInText) result.reasons.push('Sign in 텍스트 없음');
          
          // 최종 판단: 3개 이상의 조건이 충족되면 로그인된 것으로 판단
          const trueCount = Object.values(result.methods).filter(Boolean).length;
          result.isLoggedIn = trueCount >= 3;
          
          return result;
        });
        
        if (this.config.debugMode) {
          if (loginCheck.isLoggedIn) {
            console.log(chalk.green('✅ 로그인 상태 확인됨'));
            if (loginCheck.reasons.length > 0) {
              console.log(chalk.gray('  근거:'));
              loginCheck.reasons.forEach(reason => {
                console.log(chalk.gray(`    • ${reason}`));
              });
            }
          } else {
            console.log(chalk.yellow('⚠️ 로그인되지 않음'));
            console.log(chalk.gray('  체크 결과:'));
            Object.entries(loginCheck.methods).forEach(([method, value]) => {
              console.log(chalk.gray(`    • ${method}: ${value ? '✓' : '✗'}`));
            });
          }
        }
        
        return loginCheck.isLoggedIn;
      }
      
      return true; // 기본적으로 로그인된 것으로 간주
      
    } catch (error) {
      console.error(chalk.red('로그인 상태 확인 실패:'), error);
      return false;
    }
  }

  /**
   * Google 계정으로 로그인
   */
  async login(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('로그인 자격 증명이 없습니다.');
    }
    
    console.log(chalk.blue(`\n🔐 Google 계정 로그인 시작: ${credentials.email}`));
    
    try {
      // 현재 페이지 확인
      const currentUrl = this.page.url();
      
      // 이메일 입력 단계 처리
      const emailStepCompleted = await this.handleEmailStep(credentials.email);
      if (emailStepCompleted) {
        console.log(chalk.green('✅ 이메일 입력 완료'));
        
        // 계정 선택 후 비밀번호 페이지로 이동 대기
        await new Promise(r => setTimeout(r, 3000));
        
        // reCAPTCHA 체크
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 번호인증계정'));
          return 'RECAPTCHA_DETECTED';
        }
      }
      
      // 비밀번호 입력 단계 처리
      const passwordStepCompleted = await this.handlePasswordStep(credentials.password);
      if (passwordStepCompleted) {
        console.log(chalk.green('✅ 비밀번호 입력 완료'));
        
        // 비밀번호 입력 후에도 reCAPTCHA 체크
        await new Promise(r => setTimeout(r, 2000));
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 번호인증계정'));
          return 'RECAPTCHA_DETECTED';
        }
      }
      
      // 2단계 인증 확인 (필요한 경우)
      await this.handle2FAIfNeeded(credentials);
      
      // 로그인 완료 대기
      await this.waitForLoginComplete();
      
      // 최종 로그인 상태 확인
      const loginSuccess = await this.checkLoginStatus();
      
      if (loginSuccess) {
        console.log(chalk.green('✅ Google 로그인 성공'));
        return true;
      } else {
        console.log(chalk.red('❌ Google 로그인 실패'));
        return false;
      }
      
    } catch (error) {
      console.error(chalk.red('로그인 중 오류 발생:'), error);
      
      // 스크린샷 저장
      if (this.config.screenshotEnabled) {
        await this.page.screenshot({
          path: `screenshots/login_error_${Date.now()}.png`
        });
      }
      
      return false;
    }
  }

  /**
   * 현재 페이지 타입 감지
   */
  async detectCurrentPageType() {
    try {
      const url = this.page.url();
      const content = await this.page.textContent('body').catch(() => '');
      const title = await this.page.title().catch(() => '');

      // 1. 본인 인증 페이지
      if (
        url.includes('confirmidentifier') ||
        content.includes('본인 인증') ||
        content.includes('verify your identity') ||
        content.includes('Identity confirmation') ||
        content.includes('계정 보안을 유지하기 위해') ||
        content.includes('보안을 유지하기')
      ) {
        return { type: 'identity_confirmation', url, content };
      }

      // 2. 이메일 입력 페이지
      const hasEmailInput = await this.page.$('input[type="email"]').catch(() => null);
      if (hasEmailInput) {
        return { type: 'email_input', url, content };
      }

      // 3. 비밀번호 입력 페이지
      const hasPasswordInput = await this.page.$('input[type="password"]').catch(() => null);
      if (hasPasswordInput) {
        return { type: 'password_input', url, content };
      }

      // 4. 2단계 인증 페이지
      if (
        content.includes('2-Step Verification') ||
        content.includes('2단계 인증') ||
        content.includes('Enter the code')
      ) {
        return { type: '2fa', url, content };
      }

      // 5. YouTube 또는 Google 메인 페이지 (로그인 완료)
      if (
        url.includes('youtube.com') ||
        url.includes('myaccount.google.com') ||
        content.includes('YouTube') ||
        content.includes('Google Account')
      ) {
        return { type: 'logged_in', url, content };
      }

      // 6. 알 수 없는 페이지
      return { type: 'unknown', url, content, title };

    } catch (error) {
      console.log(chalk.red(`페이지 타입 감지 오류: ${error.message}`));
      return { type: 'error', error: error.message };
    }
  }

  /**
   * 본인 인증 중간 페이지 감지 및 처리
   * "다음" 클릭 후 자동으로 다음 페이지 감지 및 처리
   */
  async handleIdentityConfirmation() {
    try {
      // 현재 페이지 타입 감지
      const pageType = await this.detectCurrentPageType();

      if (pageType.type !== 'identity_confirmation') {
        return { detected: false, pageType: pageType.type };
      }

      console.log(chalk.cyan('🔐 본인 인증 중간 페이지 감지 - "다음" 버튼 클릭 시도'));

      // "다음" 버튼 찾기 및 클릭 (page.evaluate 사용으로 더 안정적)
      const clicked = await this.page.evaluate(() => {
        // 다국어 "다음" 버튼 텍스트
        const nextTexts = [
          '다음',
          'Next',
          'Siguiente',
          'Weiter',
          'Suivant',
          'Avanti',
          'Próximo',
          'Далее',
          '次へ',
          '下一步'
        ];

        // 모든 버튼 검색
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"]'));

        for (const btn of buttons) {
          const btnText = btn.textContent?.trim();

          // "다음" 텍스트 매칭
          if (btnText && nextTexts.some(text => btnText.includes(text))) {
            // 버튼 표시 여부 확인
            if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
              btn.click();
              return { success: true, text: btnText };
            }
          }
        }

        // ID 기반 검색 (폴백)
        const identifierNext = document.getElementById('identifierNext');
        if (identifierNext && identifierNext.offsetHeight > 0) {
          identifierNext.click();
          return { success: true, text: 'identifierNext' };
        }

        return { success: false };
      });

      if (!clicked.success) {
        console.log(chalk.yellow('⚠️ 본인 인증 페이지의 "다음" 버튼을 찾을 수 없음'));
        return { detected: true, handled: false };
      }

      console.log(chalk.green(`✅ "다음" 버튼 클릭 성공: ${clicked.text}`));

      // 페이지 전환 대기
      await new Promise(r => setTimeout(r, 2000));

      // 다음 페이지 타입 감지
      const nextPageType = await this.detectCurrentPageType();
      console.log(chalk.cyan(`📄 다음 페이지 타입: ${nextPageType.type}`));

      return {
        detected: true,
        handled: true,
        nextPageType: nextPageType.type
      };

    } catch (error) {
      console.log(chalk.red(`본인 인증 처리 오류: ${error.message}`));
      return {
        detected: false,
        handled: false,
        error: error.message
      };
    }
  }

  /**
   * 이메일 입력 단계 처리
   */
  async handleEmailStep(email) {
    try {
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));

      // 현재 URL 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`현재 URL: ${currentUrl}`));

      // 본인 인증 중간 페이지 확인 및 처리
      const identityCheck = await this.handleIdentityConfirmation();
      if (identityCheck.detected && !identityCheck.handled) {
        throw new Error('본인 인증 페이지를 처리할 수 없습니다');
      }

      // 본인 인증 통과 후 URL 재확인
      if (identityCheck.detected && identityCheck.handled) {
        await new Promise(r => setTimeout(r, 1500)); // 페이지 안정화 대기
      }

      // 계정 선택 페이지인 경우 처리
      if (currentUrl.includes('accountchooser')) {
        console.log(chalk.gray('계정 선택 페이지 감지됨'));
        
        // "다른 계정 사용" 버튼 클릭
        const useAnotherAccountSelectors = [
          'div[data-identifier]',
          'li[role="link"]',
          'div[jsname="rwl3qc"]',
          'div:has-text("Use another account")',
          'div:has-text("다른 계정 사용")'
        ];
        
        // 먼저 기존 계정 확인
        const existingAccount = await this.page.evaluate((targetEmail) => {
          const accounts = document.querySelectorAll('div[data-identifier]');
          for (const account of accounts) {
            if (account.getAttribute('data-identifier') === targetEmail) {
              account.click();
              return true;
            }
          }
          return false;
        }, email);
        
        if (existingAccount) {
          console.log(chalk.green('기존 계정 선택됨'));
          await new Promise(r => setTimeout(r, 2000));
          return true;
        }
        
        // "다른 계정 사용" 클릭
        const addAccountClicked = await this.page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('li, div, button'));
          for (const elem of elements) {
            const text = elem.textContent?.trim();
            if (text && (text.includes('Use another account') || text.includes('다른 계정 사용'))) {
              elem.click();
              return true;
            }
          }
          return false;
        });
        
        if (addAccountClicked) {
          console.log(chalk.gray('다른 계정 사용 클릭됨'));
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      // 이메일 입력 필드 대기
      const emailSelectors = [
        'input[type="email"]',
        'input#identifierId',
        'input[name="identifier"]',
        'input[autocomplete="username"]'
      ];
      
      let emailInput = null;
      for (const selector of emailSelectors) {
        try {
          const element = await this.page.waitForSelector(selector, { 
            visible: true, 
            timeout: 3000 
          });
          if (element) {
            emailInput = selector;
            break;
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (!emailInput) {
        console.log(chalk.yellow('이메일 입력 필드를 찾을 수 없습니다.'));
        // 페이지 내용 디버깅
        const pageContent = await this.page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            inputs: Array.from(document.querySelectorAll('input')).map(i => ({
              type: i.type,
              name: i.name,
              id: i.id,
              placeholder: i.placeholder,
              visible: i.offsetParent !== null
            }))
          };
        });
        console.log(chalk.gray('페이지 정보:'), JSON.stringify(pageContent, null, 2));
        return false;
      }
      
      // 이메일 입력
      console.log(chalk.gray(`이메일 입력 필드 찾음: ${emailInput}`));
      await this.page.click(emailInput);
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.page.type(emailInput, email, { delay: 100 });
      
      // 다음 버튼 클릭
      const nextButtonSelectors = [
        'button#identifierNext',
        'button[jsname="LgbsSe"]',
        'div#identifierNext',
        'button:has-text("다음")',
        'button:has-text("Next")'
      ];
      
      for (const selector of nextButtonSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            await button.click();
            await new Promise(r => setTimeout(r, 2000));
            return true;
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      // Enter 키로 시도
      await this.page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 2000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 실패:'), error);
      return false;
    }
  }

  /**
   * 비밀번호 입력 단계 처리 (개선된 버전 - 본인 인증 체크 포함)
   */
  async handlePasswordStep(password) {
    try {
      // 비밀번호 입력 필드 대기
      await new Promise(r => setTimeout(r, 2000));

      // ========== 단계 1: 본인 인증 중간 페이지 확인 및 처리 ==========
      const identityCheck = await this.handleIdentityConfirmation();
      if (identityCheck.detected && !identityCheck.handled) {
        throw new Error('비밀번호 단계 진입 전 본인 인증 페이지를 처리할 수 없습니다');
      }

      // 본인 인증 통과 후 URL 재확인
      if (identityCheck.detected && identityCheck.handled) {
        console.log(chalk.green('✅ 비밀번호 단계 진입 전 본인 인증 통과'));
        await new Promise(r => setTimeout(r, 1500)); // 페이지 안정화 대기
      }

      // 현재 페이지 타입 확인
      const currentPageType = await this.detectCurrentPageType();
      console.log(chalk.cyan(`📄 비밀번호 단계 - 현재 페이지 타입: ${currentPageType.type}`));

      // 현재 URL 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`비밀번호 단계 URL: ${currentUrl}`));

      // 비밀번호 페이지로 이동했는지 확인
      if (!currentUrl.includes('pwd') && !currentUrl.includes('challenge') && currentPageType.type !== 'password_input') {
        console.log(chalk.yellow('비밀번호 페이지가 아닙니다. 페이지 로드 대기...'));

        // 네비게이션 대기
        try {
          await this.page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 5000
          });
        } catch (e) {
          // 타임아웃 무시
        }
      }
      
      const passwordSelectors = [
        'input[type="password"]:visible',
        'input[type="password"]',
        'input#password input[type="password"]',
        'input[name="password"]',
        'input[name="Passwd"]',
        'input[autocomplete="current-password"]',
        'input[jsname="YPqjbf"]'
      ];
      
      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.evaluate(el => {
              return el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0;
            });
            if (isVisible) {
              passwordInput = element;
              console.log(chalk.gray(`비밀번호 필드 찾음: ${selector}`));
              break;
            }
          }
          if (passwordInput) break;
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (!passwordInput) {
        console.log(chalk.yellow('비밀번호 입력 필드를 찾을 수 없습니다.'));
        
        // 페이지 내용 디버깅
        const pageInfo = await this.page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
            type: i.type,
            name: i.name,
            id: i.id,
            placeholder: i.placeholder,
            autocomplete: i.autocomplete,
            visible: i.offsetParent !== null
          }));
          return {
            url: window.location.href,
            title: document.title,
            inputs: inputs,
            hasPasswordField: inputs.some(i => i.type === 'password')
          };
        });
        console.log(chalk.gray('페이지 정보:'), JSON.stringify(pageInfo, null, 2));
        return false;
      }
      
      // 비밀번호 입력
      if (passwordInput.click) {
        // Element handle인 경우
        await passwordInput.click();
        await passwordInput.type(password, { delay: 100 });
      } else {
        // Selector string인 경우
        await this.page.click(passwordInput);
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('a');
        await this.page.keyboard.up('Control');
        await this.page.type(passwordInput, password, { delay: 100 });
      }
      
      // 다음/로그인 버튼 클릭
      const loginButtonSelectors = [
        'button#passwordNext',
        'button[jsname="LgbsSe"]',
        'div#passwordNext',
        'button:has-text("다음")',
        'button:has-text("Next")',
        'button:has-text("로그인")',
        'button:has-text("Sign in")'
      ];
      
      for (const selector of loginButtonSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            await button.click();
            await new Promise(r => setTimeout(r, 3000));
            return true;
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      // Enter 키로 시도
      await this.page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 3000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('비밀번호 입력 실패:'), error);
      return false;
    }
  }

  /**
   * 2단계 인증 처리 (필요한 경우)
   */
  async handle2FAIfNeeded(credentials) {
    try {
      await new Promise(r => setTimeout(r, 2000));
      
      // 2단계 인증 페이지 확인
      const is2FAPage = await this.page.evaluate(() => {
        const pageText = document.body.innerText.toLowerCase();
        return pageText.includes('2-step verification') || 
               pageText.includes('2단계 인증') ||
               pageText.includes('confirm your recovery email') ||
               pageText.includes('복구 이메일 확인');
      });
      
      if (!is2FAPage) {
        return true;
      }
      
      console.log(chalk.yellow('📱 2단계 인증이 필요합니다.'));
      
      // 복구 이메일 옵션 선택
      if (credentials.recoveryEmail) {
        const recoveryOptions = await this.page.$$('div[role="link"], div[role="button"]');
        
        for (const option of recoveryOptions) {
          const text = await option.evaluate(el => el.innerText);
          if (text.includes(credentials.recoveryEmail) || 
              text.includes('recovery email') || 
              text.includes('복구 이메일')) {
            await option.click();
            await new Promise(r => setTimeout(r, 2000));
            
            // 복구 이메일 입력
            const recoveryInput = await this.page.$('input[type="email"], input[type="text"]');
            if (recoveryInput) {
              await recoveryInput.type(credentials.recoveryEmail, { delay: 100 });
              
              // 확인 버튼 클릭
              const confirmButton = await this.page.$('button:has-text("다음"), button:has-text("Next"), button:has-text("확인"), button:has-text("Confirm")');
              if (confirmButton) {
                await confirmButton.click();
                await new Promise(r => setTimeout(r, 3000));
              }
            }
            break;
          }
        }
      }
      
      // 백업 코드가 있는 경우
      if (credentials.backupCode) {
        console.log(chalk.gray('백업 코드 사용 시도...'));
        // 백업 코드 입력 로직 (필요시 구현)
      }
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('2단계 인증 처리 실패:'), error);
      return false;
    }
  }

  /**
   * 로그인 완료 대기
   */
  async waitForLoginComplete() {
    try {
      // YouTube 페이지로 리다이렉트 대기
      await this.page.waitForFunction(
        () => {
          const url = window.location.href;
          return url.includes('youtube.com') && 
                 !url.includes('accounts.google.com');
        },
        { timeout: 30000 }
      );
      
      // 페이지 로드 완료 대기 (Puppeteer 방식)
      await Promise.race([
        this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {}),
        new Promise(r => setTimeout(r, 2000))
      ]);
      
      return true;
      
    } catch (error) {
      console.log(chalk.yellow('로그인 완료 대기 시간 초과'));
      return false;
    }
  }
  
  /**
   * reCAPTCHA 존재 확인
   */
  async checkForRecaptcha() {
    try {
      const currentUrl = this.page.url();
      
      // URL에 recaptcha가 포함되어 있는지 확인
      if (currentUrl.includes('challenge/recaptcha') || 
          currentUrl.includes('signin/v2/challenge')) {
        return true;
      }
      
      // 페이지 내용에서 reCAPTCHA 요소 확인
      const hasRecaptcha = await this.page.evaluate(() => {
        // reCAPTCHA iframe 확인
        const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
        if (recaptchaFrame) return true;
        
        // reCAPTCHA 관련 텍스트 확인
        const pageText = document.body?.innerText?.toLowerCase() || '';
        const recaptchaIndicators = [
          'recaptcha',
          'i\'m not a robot',
          '로봇이 아닙니다',
          '본인 인증',
          'verify you\'re not a robot',
          '자동 프로그램이 아님을 확인'
        ];
        
        return recaptchaIndicators.some(text => pageText.includes(text));
      });
      
      return hasRecaptcha;
      
    } catch (error) {
      console.error(chalk.red('reCAPTCHA 확인 중 오류:'), error);
      return false;
    }
  }
}

module.exports = GoogleLoginHelper;