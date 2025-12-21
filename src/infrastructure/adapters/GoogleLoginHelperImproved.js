/**
 * Google 로그인 헬퍼 클래스 (개선된 버전)
 * YouTube Premium 워크플로우에서 Google 계정 로그인을 처리
 * 자동화 감지 우회 및 안정성 개선
 */

const chalk = require('chalk');

class GoogleLoginHelperImproved {
  constructor(page, browserController, config = {}) {
    this.page = page;
    this.controller = browserController;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      maxRetries: config.maxRetries || 3,
      humanizeDelay: config.humanizeDelay !== false,
      ...config
    };
  }

  /**
   * 프레임이 준비되었는지 확인
   */
  async ensureFrameReady() {
    try {
      // 페이지가 존재하는지 확인
      if (!this.page) {
        throw new Error('Page object not available');
      }

      // 페이지가 닫혔는지 확인
      const isClosed = await this.page.evaluate(() => false).catch(() => true);
      if (isClosed) {
        throw new Error('Page has been closed');
      }

      // 메인 프레임이 준비될 때까지 대기
      await new Promise(r => setTimeout(r, 500));
      
      // DOM이 로드되었는지 확인
      await this.page.waitForFunction(
        () => document.readyState === 'complete' || document.readyState === 'interactive',
        { timeout: 5000 }
      ).catch(() => {
        console.log(chalk.yellow('⚠️ DOM 로드 대기 시간 초과, 계속 진행'));
      });

      return true;
    } catch (error) {
      console.error(chalk.red('프레임 준비 확인 실패:'), error.message);
      return false;
    }
  }

  /**
   * 안전한 evaluate 실행
   */
  async safeEvaluate(fn, ...args) {
    await this.ensureFrameReady();
    try {
      return await this.page.evaluate(fn, ...args);
    } catch (error) {
      if (error.message.includes('Requesting main frame too early')) {
        console.log(chalk.yellow('⚠️ 프레임 준비 대기 중...'));
        await new Promise(r => setTimeout(r, 2000));
        await this.ensureFrameReady();
        return await this.page.evaluate(fn, ...args);
      }
      throw error;
    }
  }

  /**
   * 인간적인 타이핑 시뮬레이션
   */
  async humanType(selector, text) {
    if (!this.config.humanizeDelay) {
      await this.page.type(selector, text);
      return;
    }

    // 필드 클릭
    await this.page.click(selector);
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));

    // 기존 텍스트 선택 및 삭제
    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('a');
    await this.page.keyboard.up('Control');
    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));

    // 한 글자씩 타이핑 (가변 속도)
    for (const char of text) {
      await this.page.keyboard.type(char);
      const delay = 50 + Math.random() * 150; // 50-200ms 사이의 랜덤 딜레이
      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * 인간적인 클릭 시뮬레이션
   */
  async humanClick(selector) {
    const element = await this.page.$(selector);
    if (!element) return false;

    if (!this.config.humanizeDelay) {
      await element.click();
      return true;
    }

    // 요소의 위치 가져오기
    const box = await element.boundingBox();
    if (!box) {
      await element.click();
      return true;
    }

    // 요소 중앙 근처의 랜덤 위치 클릭
    const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
    const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;

    // 마우스 이동 후 클릭
    await this.page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 5) });
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    await this.page.mouse.click(x, y);
    
    return true;
  }

  /**
   * 로그인 상태 확인 (개선된 버전)
   */
  async checkLoginStatus() {
    try {
      await this.ensureFrameReady();
      const currentUrl = this.page.url();
      
      // 로그인 페이지 URL 패턴 확인
      const loginPagePatterns = [
        'accounts.google.com/signin',
        'accounts.google.com/v3/signin',
        'accounts.google.com/ServiceLogin',
        'accounts.google.com/identifier',
        'accounts.google.com/accountchooser'
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
      
      // YouTube Premium 페이지에서 로그인 확인
      if (currentUrl.includes('youtube.com')) {
        const loginCheck = await this.safeEvaluate(() => {
          const result = {
            isLoggedIn: false,
            indicators: []
          };
          
          // 아바타/계정 버튼 확인
          const avatarElements = document.querySelectorAll(
            '#avatar-btn, button#avatar-btn, img.yt-img-shadow, ' +
            'button[aria-label*="Account"], button[aria-label*="계정"], ' +
            'ytd-topbar-menu-button-renderer'
          );
          
          if (avatarElements.length > 0) {
            result.indicators.push('아바타 버튼 존재');
          }
          
          // 로그인 링크가 없는지 확인
          const signInLinks = document.querySelectorAll(
            'a[href*="accounts.google.com/ServiceLogin"], ' +
            'a[aria-label*="Sign in"], a[aria-label*="로그인"], ' +
            'tp-yt-paper-button[aria-label*="Sign in"], tp-yt-paper-button[aria-label*="로그인"]'
          );
          
          if (signInLinks.length === 0) {
            result.indicators.push('로그인 링크 없음');
          }
          
          // 페이지 텍스트 확인
          const pageText = document.body?.textContent || '';
          const hasMembershipContent = 
            pageText.includes('Manage membership') || 
            pageText.includes('Manage Membership') ||
            pageText.includes('구독 관리') ||
            pageText.includes('관리') || 
            pageText.includes('멤버십') ||
            pageText.includes('membership') ||
            pageText.includes('Membership') ||
            pageText.includes('Premium');
            
          if (hasMembershipContent) {
            result.indicators.push('멤버십 콘텐츠 존재');
          }
          
          // 2개 이상의 지표가 있으면 로그인된 것으로 판단
          result.isLoggedIn = result.indicators.length >= 2;
          
          return result;
        });
        
        if (this.config.debugMode) {
          if (loginCheck.isLoggedIn) {
            console.log(chalk.green('✅ 로그인 상태 확인됨'));
            if (loginCheck.indicators.length > 0) {
              console.log(chalk.gray('  근거: ' + loginCheck.indicators.join(', ')));
            }
          } else {
            console.log(chalk.yellow('⚠️ 로그인되지 않음'));
          }
        }
        
        return loginCheck.isLoggedIn;
      }
      
      return true; // 기본적으로 로그인된 것으로 간주
      
    } catch (error) {
      console.error(chalk.red('로그인 상태 확인 실패:'), error.message);
      return false;
    }
  }

  /**
   * 계정 잠김 상태 확인
   */
  async checkAccountLocked() {
    try {
      const url = this.page.url();
      const title = await this.page.title();
      const content = await this.page.textContent('body').catch(() => '');
      
      // URL 패턴 확인
      const lockedUrlPatterns = [
        '/signin/rejected',
        '/signin/disabled',
        '/AccountDisabled',
        '/signin/v3/challenge'
      ];
      
      const isLockedUrl = lockedUrlPatterns.some(pattern => url.includes(pattern));
      
      // 페이지 제목 확인
      const lockedTitles = [
        '계정 사용 중지됨',
        'Account disabled',
        'Account has been disabled',
        '계정이 잠겼습니다',
        'Your account has been locked'
      ];
      
      const hasLockedTitle = lockedTitles.some(lockedTitle => 
        title.toLowerCase().includes(lockedTitle.toLowerCase())
      );
      
      // 페이지 내용 확인
      const lockedKeywords = [
        '계정 사용 중지됨',
        'Account disabled',
        '평소와 다른 활동이 감지',
        'unusual activity',
        '정보 보호를 위해 계정이 잠겼습니다',
        'your account has been locked',
        '복구 시도',
        'Try to recover'
      ];
      
      const hasLockedContent = lockedKeywords.some(keyword => 
        content.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isLockedUrl || hasLockedTitle || hasLockedContent) {
        console.log(chalk.red('🔒 계정 잠김 상태 감지됨'));
        console.log(chalk.yellow(`  URL: ${url}`));
        console.log(chalk.yellow(`  제목: ${title}`));
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(chalk.red('계정 잠김 확인 실패:'), error.message);
      return false;
    }
  }

  /**
   * Google 계정으로 로그인 (개선된 버전)
   */
  async login(credentials) {
    if (!credentials || !credentials.email || !credentials.password) {
      throw new Error('로그인 자격 증명이 없습니다.');
    }
    
    console.log(chalk.blue(`\n🔐 Google 계정 로그인 시작: ${credentials.email}`));
    
    try {
      // 프레임 준비 확인
      await this.ensureFrameReady();
      
      // 현재 페이지 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`현재 URL: ${currentUrl}`));
      
      // 계정 잠김 상태 확인
      const isLocked = await this.checkAccountLocked();
      if (isLocked) {
        console.log(chalk.red('🔒 계정이 잠겨있습니다. 수동 복구가 필요합니다.'));
        return 'ACCOUNT_LOCKED';
      }
      
      // 이메일 입력 단계 처리
      const emailStepCompleted = await this.handleEmailStep(credentials.email);
      if (emailStepCompleted) {
        console.log(chalk.green('✅ 이메일 입력 완료'));
        
        // 인간적인 대기 시간
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        
        // 계정 잠김 상태 재확인
        const isLockedAfterEmail = await this.checkAccountLocked();
        if (isLockedAfterEmail) {
          console.log(chalk.red('🔒 이메일 입력 후 계정 잠김 감지'));
          return 'ACCOUNT_LOCKED';
        }
        
        // reCAPTCHA 체크
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 수동 인증 필요'));
          return 'RECAPTCHA_DETECTED';
        }
      }
      
      // 비밀번호 입력 단계 처리
      const passwordStepCompleted = await this.handlePasswordStep(credentials.password);
      if (passwordStepCompleted) {
        console.log(chalk.green('✅ 비밀번호 입력 완료'));
        
        // 인간적인 대기 시간
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        
        // 계정 잠김 상태 재확인
        const isLockedAfterPassword = await this.checkAccountLocked();
        if (isLockedAfterPassword) {
          console.log(chalk.red('🔒 비밀번호 입력 후 계정 잠김 감지'));
          return 'ACCOUNT_LOCKED';
        }
        
        // reCAPTCHA 체크
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 수동 인증 필요'));
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
        // 최종 계정 잠김 확인
        const isFinallyLocked = await this.checkAccountLocked();
        if (isFinallyLocked) {
          console.log(chalk.red('❌ 계정 잠김으로 인한 로그인 실패'));
          return 'ACCOUNT_LOCKED';
        }
        console.log(chalk.red('❌ Google 로그인 실패'));
        return false;
      }
      
    } catch (error) {
      console.error(chalk.red('로그인 중 오류 발생:'), error.message);
      
      // 스크린샷 저장
      if (this.config.screenshotEnabled) {
        try {
          await this.page.screenshot({
            path: `screenshots/login_error_${Date.now()}.png`
          });
        } catch (e) {
          console.log(chalk.yellow('스크린샷 저장 실패'));
        }
      }
      
      return false;
    }
  }

  /**
   * 이메일 입력 단계 처리 (개선된 버전)
   */
  async handleEmailStep(email) {
    try {
      // 프레임 준비 확인
      await this.ensureFrameReady();
      
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 현재 URL 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`이메일 단계 URL: ${currentUrl}`));
      
      // 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        console.log(chalk.gray('계정 선택 페이지 감지됨'));
        
        // 기존 계정 확인
        const existingAccount = await this.safeEvaluate((targetEmail) => {
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
        const addAccountClicked = await this.safeEvaluate(() => {
          const elements = Array.from(document.querySelectorAll('li, div, button'));
          for (const elem of elements) {
            const text = elem.textContent?.trim();
            if (text && (text.includes('Use another account') || 
                        text.includes('다른 계정 사용') ||
                        text.includes('Add account') ||
                        text.includes('계정 추가'))) {
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
      
      // 이메일 입력 필드 찾기 및 입력
      const emailSelectors = [
        'input[type="email"]',
        'input#identifierId',
        'input[name="identifier"]',
        'input[autocomplete="username"]'
      ];
      
      let emailInputFound = false;
      for (const selector of emailSelectors) {
        try {
          await this.page.waitForSelector(selector, { 
            visible: true, 
            timeout: 3000 
          });
          
          // 인간적인 타이핑
          await this.humanType(selector, email);
          emailInputFound = true;
          console.log(chalk.gray(`이메일 입력 완료: ${selector}`));
          break;
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      if (!emailInputFound) {
        console.log(chalk.yellow('이메일 입력 필드를 찾을 수 없습니다.'));
        return false;
      }
      
      // 잠시 대기 (인간적인 행동)
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      
      // 다음 버튼 클릭
      const nextButtonSelectors = [
        'button#identifierNext',
        'button[jsname="LgbsSe"]',
        'div#identifierNext button',
        'div#identifierNext',
        'button[type="button"]:has-text("Next")',
        'button[type="button"]:has-text("다음")'
      ];
      
      let nextButtonClicked = false;
      for (const selector of nextButtonSelectors) {
        try {
          const clicked = await this.humanClick(selector);
          if (clicked) {
            nextButtonClicked = true;
            console.log(chalk.gray('다음 버튼 클릭됨'));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      if (!nextButtonClicked) {
        // Enter 키로 시도
        await this.page.keyboard.press('Enter');
        console.log(chalk.gray('Enter 키로 진행'));
      }
      
      // 페이지 전환 대기
      await new Promise(r => setTimeout(r, 2000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 실패:'), error.message);
      return false;
    }
  }

  /**
   * 비밀번호 입력 단계 처리 (개선된 버전)
   */
  async handlePasswordStep(password) {
    try {
      // 프레임 준비 확인
      await this.ensureFrameReady();
      
      // 비밀번호 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 현재 URL 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`비밀번호 단계 URL: ${currentUrl}`));
      
      // 비밀번호 페이지 확인
      if (!currentUrl.includes('pwd') && !currentUrl.includes('challenge') && !currentUrl.includes('password')) {
        console.log(chalk.yellow('비밀번호 페이지 로드 대기...'));
        
        // 네비게이션 대기
        try {
          await this.page.waitForNavigation({ 
            waitUntil: 'domcontentloaded', 
            timeout: 5000 
          });
        } catch (e) {
          // 타임아웃 무시
        }
      }
      
      // 비밀번호 입력 필드 찾기
      const passwordSelectors = [
        'input[type="password"]:visible',
        'input[type="password"]',
        'input[name="password"]',
        'input[name="Passwd"]',
        'input[autocomplete="current-password"]',
        'input[jsname="YPqjbf"]'
      ];
      
      let passwordInputFound = false;
      
      // 먼저 visible 체크로 시도
      for (const selector of passwordSelectors) {
        try {
          const elements = await this.page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.evaluate(el => {
              return el.offsetParent !== null && 
                     el.offsetWidth > 0 && 
                     el.offsetHeight > 0 &&
                     window.getComputedStyle(el).visibility !== 'hidden';
            });
            
            if (isVisible) {
              // 인간적인 타이핑
              await element.click();
              await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
              await element.type(password, { delay: 50 + Math.random() * 100 });
              passwordInputFound = true;
              console.log(chalk.gray(`비밀번호 입력 완료: ${selector}`));
              break;
            }
          }
          if (passwordInputFound) break;
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      // visible 체크 실패시 일반 선택자로 재시도
      if (!passwordInputFound) {
        for (const selector of passwordSelectors) {
          try {
            await this.page.waitForSelector(selector, { 
              visible: true, 
              timeout: 2000 
            });
            
            await this.humanType(selector, password);
            passwordInputFound = true;
            console.log(chalk.gray(`비밀번호 입력 완료 (fallback): ${selector}`));
            break;
          } catch (e) {
            // 다음 선택자 시도
          }
        }
      }
      
      if (!passwordInputFound) {
        console.log(chalk.yellow('비밀번호 입력 필드를 찾을 수 없습니다.'));
        
        // 디버그 정보 출력
        const pageInfo = await this.safeEvaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
            type: i.type,
            name: i.name,
            id: i.id,
            visible: i.offsetParent !== null
          }));
          return {
            url: window.location.href,
            hasPasswordField: inputs.some(i => i.type === 'password'),
            inputs: inputs.slice(0, 5) // 처음 5개만
          };
        });
        console.log(chalk.gray('페이지 정보:'), JSON.stringify(pageInfo, null, 2));
        
        return false;
      }
      
      // 잠시 대기 (인간적인 행동)
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      
      // 다음/로그인 버튼 클릭
      const loginButtonSelectors = [
        'button#passwordNext',
        'button[jsname="LgbsSe"]',
        'div#passwordNext button',
        'div#passwordNext',
        'button[type="button"]:has-text("Next")',
        'button[type="button"]:has-text("다음")',
        'button[type="submit"]'
      ];
      
      let loginButtonClicked = false;
      for (const selector of loginButtonSelectors) {
        try {
          const clicked = await this.humanClick(selector);
          if (clicked) {
            loginButtonClicked = true;
            console.log(chalk.gray('로그인 버튼 클릭됨'));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      if (!loginButtonClicked) {
        // Enter 키로 시도
        await this.page.keyboard.press('Enter');
        console.log(chalk.gray('Enter 키로 진행'));
      }
      
      // 로그인 처리 대기
      await new Promise(r => setTimeout(r, 3000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('비밀번호 입력 실패:'), error.message);
      return false;
    }
  }

  /**
   * 2단계 인증 처리
   */
  async handle2FAIfNeeded(credentials) {
    try {
      await this.ensureFrameReady();
      await new Promise(r => setTimeout(r, 2000));
      
      // 2단계 인증 페이지 확인
      const is2FAPage = await this.safeEvaluate(() => {
        const pageText = document.body?.innerText?.toLowerCase() || '';
        return pageText.includes('2-step verification') || 
               pageText.includes('2단계 인증') ||
               pageText.includes('confirm your recovery email') ||
               pageText.includes('복구 이메일 확인') ||
               pageText.includes('verify it\'s you') ||
               pageText.includes('본인 확인');
      });
      
      if (!is2FAPage) {
        return true;
      }
      
      console.log(chalk.yellow('📱 2단계 인증이 필요합니다.'));
      
      // 복구 이메일 옵션이 있는 경우
      if (credentials.recoveryEmail) {
        const recoveryEmailUsed = await this.safeEvaluate((email) => {
          const elements = Array.from(document.querySelectorAll('div[role="link"], div[role="button"], div[data-challengetype]'));
          for (const elem of elements) {
            const text = elem.textContent?.toLowerCase() || '';
            if (text.includes(email.toLowerCase()) || 
                text.includes('recovery email') || 
                text.includes('복구 이메일')) {
              elem.click();
              return true;
            }
          }
          return false;
        }, credentials.recoveryEmail);
        
        if (recoveryEmailUsed) {
          console.log(chalk.gray('복구 이메일 옵션 선택됨'));
          await new Promise(r => setTimeout(r, 2000));
          
          // 복구 이메일 입력이 필요한 경우
          const recoveryInput = await this.page.$('input[type="email"], input[type="text"]');
          if (recoveryInput) {
            await this.humanType('input[type="email"], input[type="text"]', credentials.recoveryEmail);
            
            // 확인 버튼 클릭
            await this.page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
      
      // Try another way 옵션 찾기
      const tryAnotherWay = await this.safeEvaluate(() => {
        const elements = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const elem of elements) {
          const text = elem.textContent?.toLowerCase() || '';
          if (text.includes('try another way') || 
              text.includes('다른 방법 시도')) {
            elem.click();
            return true;
          }
        }
        return false;
      });
      
      if (tryAnotherWay) {
        console.log(chalk.gray('다른 인증 방법 선택 페이지로 이동'));
        await new Promise(r => setTimeout(r, 2000));
      }
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('2단계 인증 처리 실패:'), error.message);
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
      
      // 페이지 로드 완료 대기
      await this.page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 10000 }
      );
      
      await new Promise(r => setTimeout(r, 2000));
      
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
      await this.ensureFrameReady();
      const currentUrl = this.page.url();
      
      // URL에 recaptcha가 포함되어 있는지 확인
      if (currentUrl.includes('challenge/recaptcha') || 
          currentUrl.includes('signin/v2/challenge') ||
          currentUrl.includes('challengeselection')) {
        return true;
      }
      
      // 페이지 내용에서 reCAPTCHA 요소 확인
      const hasRecaptcha = await this.safeEvaluate(() => {
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
          '자동 프로그램이 아님을 확인',
          'unusual activity',
          '비정상적인 활동'
        ];
        
        return recaptchaIndicators.some(text => pageText.includes(text));
      });
      
      return hasRecaptcha;
      
    } catch (error) {
      console.error(chalk.red('reCAPTCHA 확인 중 오류:'), error.message);
      return false;
    }
  }
}

module.exports = GoogleLoginHelperImproved;