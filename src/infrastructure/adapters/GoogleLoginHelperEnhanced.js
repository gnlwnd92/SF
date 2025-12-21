/**
 * Google 로그인 헬퍼 클래스 (향상된 버전)
 * 계정 선택 페이지 처리 개선 및 안정성 강화
 */

const chalk = require('chalk');

class GoogleLoginHelperEnhanced {
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
   * 프레임이 준비되었는지 확인 (강화된 버전)
   */
  async ensureFrameReady() {
    try {
      // 페이지가 존재하는지 확인
      if (!this.page) {
        throw new Error('Page object not available');
      }

      // 페이지가 닫혔는지 확인
      try {
        await this.page.evaluate(() => true);
      } catch (error) {
        if (error.message.includes('Session closed') || 
            error.message.includes('Page has been closed')) {
          throw new Error('Page has been closed');
        }
      }

      // 메인 프레임이 준비될 때까지 대기
      await new Promise(r => setTimeout(r, 500));
      
      // DOM이 로드되었는지 확인
      try {
        await this.page.waitForFunction(
          () => document.readyState === 'complete' || document.readyState === 'interactive',
          { timeout: 5000 }
        );
      } catch (e) {
        console.log(chalk.yellow('⚠️ DOM 로드 대기 시간 초과, 계속 진행'));
      }

      return true;
    } catch (error) {
      console.error(chalk.red('프레임 준비 확인 실패:'), error.message);
      throw error; // 에러를 상위로 전파
    }
  }

  /**
   * 안전한 evaluate 실행 (개선된 버전)
   */
  async safeEvaluate(fn, ...args) {
    try {
      await this.ensureFrameReady();
      return await this.page.evaluate(fn, ...args);
    } catch (error) {
      if (error.message.includes('Requesting main frame too early')) {
        console.log(chalk.yellow('⚠️ 프레임 준비 대기 중...'));
        await new Promise(r => setTimeout(r, 2000));
        
        // 재시도
        try {
          await this.ensureFrameReady();
          return await this.page.evaluate(fn, ...args);
        } catch (retryError) {
          console.error(chalk.red('재시도 실패:'), retryError.message);
          throw retryError;
        }
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
      const delay = 50 + Math.random() * 150;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * 요소 클릭 (개선된 버전)
   */
  async clickElement(selector, options = {}) {
    try {
      const element = await this.page.$(selector);
      if (!element) {
        console.log(chalk.yellow(`요소를 찾을 수 없음: ${selector}`));
        return false;
      }

      // 요소가 보이고 클릭 가능한지 확인
      const isClickable = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && 
               rect.height > 0 && 
               el.offsetParent !== null &&
               window.getComputedStyle(el).visibility !== 'hidden';
      });

      if (!isClickable) {
        console.log(chalk.yellow(`요소가 클릭 불가능: ${selector}`));
        return false;
      }

      // 스크롤하여 요소를 뷰포트에 표시
      await element.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await new Promise(r => setTimeout(r, 500));

      // 클릭
      if (this.config.humanizeDelay) {
        // 요소의 중앙 클릭
        const box = await element.boundingBox();
        if (box) {
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          await this.page.mouse.move(x, y, { steps: 5 });
          await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
          await this.page.mouse.click(x, y);
        } else {
          await element.click();
        }
      } else {
        await element.click();
      }

      return true;
    } catch (error) {
      console.error(chalk.red(`클릭 실패 (${selector}):`), error.message);
      return false;
    }
  }

  /**
   * 로그인 상태 확인
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
            pageText.includes('구독 관리') ||
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
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('로그인 상태 확인 실패:'), error.message);
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
      // 프레임 준비 확인
      await this.ensureFrameReady();
      
      // 현재 페이지 확인
      const currentUrl = this.page.url();
      console.log(chalk.gray(`현재 URL: ${currentUrl}`));
      
      // 이메일 입력 단계 처리
      const emailStepCompleted = await this.handleEmailStep(credentials.email);
      if (emailStepCompleted) {
        console.log(chalk.green('✅ 이메일 단계 완료'));
        
        // 페이지 전환 대기
        await new Promise(r => setTimeout(r, 3000));
        
        // reCAPTCHA 체크
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 수동 인증 필요'));
          return 'RECAPTCHA_DETECTED';
        }
      } else {
        console.log(chalk.red('❌ 이메일 단계 실패'));
        return false;
      }
      
      // 비밀번호 입력 단계 처리
      const passwordStepCompleted = await this.handlePasswordStep(credentials.password);
      if (passwordStepCompleted) {
        console.log(chalk.green('✅ 비밀번호 입력 완료'));
        
        // 인간적인 대기 시간
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        
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
   * 이메일 입력 단계 처리 (향상된 버전)
   */
  async handleEmailStep(email) {
    try {
      await this.ensureFrameReady();
      await new Promise(r => setTimeout(r, 2000));
      
      const currentUrl = this.page.url();
      console.log(chalk.gray(`이메일 단계 URL: ${currentUrl}`));
      
      // 계정 선택 페이지 처리 (개선됨)
      if (currentUrl.includes('accountchooser')) {
        console.log(chalk.gray('계정 선택 페이지 감지됨'));
        
        // 먼저 현재 로그인하려는 계정이 목록에 있는지 확인
        const accountSelected = await this.selectExistingAccount(email);
        
        if (accountSelected) {
          console.log(chalk.green('✅ 기존 계정 선택됨'));
          
          // 페이지 전환 대기
          try {
            await this.page.waitForNavigation({ 
              waitUntil: 'domcontentloaded', 
              timeout: 5000 
            });
          } catch (e) {
            // 네비게이션 타임아웃 무시
            await new Promise(r => setTimeout(r, 3000));
          }
          
          return true;
        }
        
        // 계정이 목록에 없으면 "다른 계정 사용" 클릭
        console.log(chalk.gray('계정이 목록에 없음, 다른 계정 사용 시도'));
        const addAccountClicked = await this.clickAddAccount();
        
        if (addAccountClicked) {
          console.log(chalk.green('✅ 다른 계정 사용 클릭됨'));
          
          // 페이지 전환 대기
          await new Promise(r => setTimeout(r, 3000));
          
          // 이메일 입력 필드가 나타날 때까지 대기
          try {
            await this.page.waitForSelector('input[type="email"]', { 
              visible: true, 
              timeout: 5000 
            });
          } catch (e) {
            console.log(chalk.yellow('이메일 입력 필드 대기 시간 초과'));
          }
        } else {
          console.log(chalk.yellow('⚠️ 다른 계정 사용 버튼을 찾을 수 없음'));
        }
      }
      
      // 이메일 입력 필드 찾기 및 입력
      const emailInputSuccess = await this.enterEmail(email);
      
      if (!emailInputSuccess) {
        console.log(chalk.red('❌ 이메일 입력 실패'));
        return false;
      }
      
      // 다음 버튼 클릭
      const nextButtonClicked = await this.clickNextButton();
      
      if (!nextButtonClicked) {
        // Enter 키로 시도
        console.log(chalk.gray('Enter 키로 진행 시도'));
        await this.page.keyboard.press('Enter');
      }
      
      // 페이지 전환 대기
      await new Promise(r => setTimeout(r, 3000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 단계 실패:'), error.message);
      return false;
    }
  }

  /**
   * 기존 계정 선택 (향상된 버전)
   */
  async selectExistingAccount(targetEmail) {
    try {
      // 계정 목록에서 타겟 이메일 찾기
      const accountElements = await this.page.$$('div[data-identifier]');
      
      for (const element of accountElements) {
        const email = await element.evaluate(el => el.getAttribute('data-identifier'));
        
        if (email === targetEmail) {
          console.log(chalk.gray(`계정 발견: ${email}`));
          
          // 요소가 클릭 가능한지 확인
          const isClickable = await element.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
          });
          
          if (!isClickable) {
            console.log(chalk.yellow('계정 요소가 클릭 불가능'));
            continue;
          }
          
          // 스크롤하여 뷰포트에 표시
          await element.evaluate(el => el.scrollIntoView({ block: 'center' }));
          await new Promise(r => setTimeout(r, 500));
          
          // 클릭 (여러 방법 시도)
          try {
            // 방법 1: 직접 클릭
            await element.click({ delay: 100 });
            console.log(chalk.gray('직접 클릭 성공'));
            return true;
          } catch (e1) {
            console.log(chalk.yellow('직접 클릭 실패, JavaScript 클릭 시도'));
            
            // 방법 2: JavaScript 클릭
            const jsClicked = await element.evaluate(el => {
              el.click();
              return true;
            });
            
            if (jsClicked) {
              console.log(chalk.gray('JavaScript 클릭 성공'));
              return true;
            }
          }
        }
      }
      
      // data-identifier가 없는 계정 요소도 확인
      const alternativeSelectors = [
        'div[role="link"]',
        'li[role="presentation"]',
        'div[jsname="paFcre"]'
      ];
      
      for (const selector of alternativeSelectors) {
        const elements = await this.page.$$(selector);
        
        for (const element of elements) {
          const text = await element.evaluate(el => el.textContent);
          
          if (text && text.includes(targetEmail)) {
            console.log(chalk.gray(`대체 선택자로 계정 발견: ${selector}`));
            
            try {
              await element.click({ delay: 100 });
              return true;
            } catch (e) {
              // JavaScript 클릭 시도
              await element.evaluate(el => el.click());
              return true;
            }
          }
        }
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('계정 선택 실패:'), error.message);
      return false;
    }
  }

  /**
   * "다른 계정 사용" 클릭 (향상된 버전)
   */
  async clickAddAccount() {
    try {
      // 여러 선택자 시도
      const selectors = [
        'div[data-identifier=""]', // 빈 identifier
        'li[jsname="XraQ3b"]',
        'div[jsname="rwl3qc"]',
        'div[role="link"]:last-child',
        'li:last-child'
      ];
      
      for (const selector of selectors) {
        const elements = await this.page.$$(selector);
        
        for (const element of elements) {
          const text = await element.evaluate(el => el.textContent?.toLowerCase() || '');
          
          if (text.includes('another account') || 
              text.includes('다른 계정') ||
              text.includes('add account') ||
              text.includes('계정 추가') ||
              text.includes('use another')) {
            
            console.log(chalk.gray(`"다른 계정 사용" 버튼 발견: ${selector}`));
            
            // 클릭 가능 확인
            const isClickable = await element.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            
            if (!isClickable) continue;
            
            // 스크롤
            await element.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await new Promise(r => setTimeout(r, 500));
            
            // 클릭 시도
            try {
              await element.click({ delay: 100 });
              console.log(chalk.gray('클릭 성공'));
              
              // 클릭 후 페이지 변화 확인
              await new Promise(r => setTimeout(r, 1000));
              const newUrl = this.page.url();
              
              if (!newUrl.includes('accountchooser')) {
                console.log(chalk.green('페이지 전환 확인'));
                return true;
              }
            } catch (clickError) {
              console.log(chalk.yellow('클릭 실패, JavaScript 시도'));
              
              // JavaScript 클릭
              const jsClicked = await element.evaluate(el => {
                el.click();
                return true;
              }).catch(() => false);
              
              if (jsClicked) {
                await new Promise(r => setTimeout(r, 1000));
                const newUrl = this.page.url();
                
                if (!newUrl.includes('accountchooser')) {
                  return true;
                }
              }
            }
          }
        }
      }
      
      // 대체 방법: 모든 클릭 가능한 요소 확인
      const clickableElements = await this.page.$$('div[role="link"], li[role="presentation"], button');
      const lastElement = clickableElements[clickableElements.length - 1];
      
      if (lastElement) {
        console.log(chalk.gray('마지막 요소 클릭 시도'));
        try {
          await lastElement.click({ delay: 100 });
          await new Promise(r => setTimeout(r, 1000));
          return true;
        } catch (e) {
          // 무시
        }
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('"다른 계정 사용" 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 이메일 입력
   */
  async enterEmail(email) {
    try {
      const emailSelectors = [
        'input[type="email"]',
        'input#identifierId',
        'input[name="identifier"]',
        'input[autocomplete="username"]'
      ];
      
      for (const selector of emailSelectors) {
        try {
          const element = await this.page.waitForSelector(selector, { 
            visible: true, 
            timeout: 3000 
          });
          
          if (element) {
            console.log(chalk.gray(`이메일 필드 발견: ${selector}`));
            
            // 클릭하여 포커스
            await element.click();
            await new Promise(r => setTimeout(r, 300));
            
            // 기존 텍스트 삭제
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('a');
            await this.page.keyboard.up('Control');
            await new Promise(r => setTimeout(r, 100));
            
            // 이메일 입력
            if (this.config.humanizeDelay) {
              await this.humanType(selector, email);
            } else {
              await this.page.type(selector, email, { delay: 50 });
            }
            
            console.log(chalk.green('✅ 이메일 입력 완료'));
            return true;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      console.log(chalk.yellow('이메일 입력 필드를 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 실패:'), error.message);
      return false;
    }
  }

  /**
   * 다음 버튼 클릭
   */
  async clickNextButton() {
    try {
      const buttonSelectors = [
        'button#identifierNext',
        'div#identifierNext button',
        'div#identifierNext',
        'button[jsname="LgbsSe"]',
        'button[type="button"]'
      ];
      
      for (const selector of buttonSelectors) {
        const elements = await this.page.$$(selector);
        
        for (const element of elements) {
          const text = await element.evaluate(el => el.textContent?.toLowerCase() || '');
          
          if (text.includes('next') || text.includes('다음')) {
            console.log(chalk.gray(`다음 버튼 발견: ${selector}`));
            
            try {
              await element.click({ delay: 100 });
              console.log(chalk.green('✅ 다음 버튼 클릭됨'));
              return true;
            } catch (e) {
              // JavaScript 클릭
              await element.evaluate(el => el.click());
              return true;
            }
          }
        }
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('다음 버튼 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 비밀번호 입력 단계 처리
   */
  async handlePasswordStep(password) {
    try {
      await this.ensureFrameReady();
      await new Promise(r => setTimeout(r, 2000));
      
      const currentUrl = this.page.url();
      console.log(chalk.gray(`비밀번호 단계 URL: ${currentUrl}`));
      
      // 비밀번호 페이지 확인
      if (!currentUrl.includes('pwd') && !currentUrl.includes('challenge') && !currentUrl.includes('password')) {
        console.log(chalk.yellow('비밀번호 페이지 대기...'));
        
        // 페이지 전환 대기
        try {
          await this.page.waitForFunction(
            () => window.location.href.includes('pwd') || 
                  window.location.href.includes('challenge') ||
                  window.location.href.includes('password'),
            { timeout: 5000 }
          );
        } catch (e) {
          console.log(chalk.yellow('비밀번호 페이지 전환 타임아웃'));
        }
      }
      
      // 비밀번호 입력
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="Passwd"]',
        'input[autocomplete="current-password"]'
      ];
      
      let passwordEntered = false;
      
      for (const selector of passwordSelectors) {
        try {
          const element = await this.page.waitForSelector(selector, { 
            visible: true, 
            timeout: 2000 
          });
          
          if (element) {
            console.log(chalk.gray(`비밀번호 필드 발견: ${selector}`));
            
            // 클릭하여 포커스
            await element.click();
            await new Promise(r => setTimeout(r, 300));
            
            // 비밀번호 입력
            await this.page.type(selector, password, { delay: 50 });
            
            passwordEntered = true;
            console.log(chalk.green('✅ 비밀번호 입력 완료'));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      if (!passwordEntered) {
        console.log(chalk.red('❌ 비밀번호 입력 필드를 찾을 수 없음'));
        return false;
      }
      
      // 로그인 버튼 클릭
      const loginButtonSelectors = [
        'button#passwordNext',
        'div#passwordNext button',
        'div#passwordNext',
        'button[jsname="LgbsSe"]'
      ];
      
      let buttonClicked = false;
      
      for (const selector of loginButtonSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click({ delay: 100 });
            buttonClicked = true;
            console.log(chalk.green('✅ 로그인 버튼 클릭됨'));
            break;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      if (!buttonClicked) {
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
               pageText.includes('verify it\'s you') ||
               pageText.includes('본인 확인');
      });
      
      if (!is2FAPage) {
        return true;
      }
      
      console.log(chalk.yellow('📱 2단계 인증이 필요합니다.'));
      
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

module.exports = GoogleLoginHelperEnhanced;