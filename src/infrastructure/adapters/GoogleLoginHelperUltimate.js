/**
 * Google Login Helper Ultimate
 * AdsPower 브라우저에서 클릭 문제를 해결한 최종 버전
 */

const chalk = require('chalk');
const CDPClickHelper = require('./CDPClickHelper');

class GoogleLoginHelperUltimate {
  constructor(page, browserController, config = {}) {
    this.page = page;
    this.controller = browserController;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    // CDP Click Helper 초기화 (Google 자동화 탐지 우회)
    this.cdpHelper = new CDPClickHelper(page, {
      verbose: this.config.debugMode,
      naturalDelay: true // 자연스러운 지연 추가
    });
    
    // 페이지 초기화 (봇 탐지 우회 설정)
    this.initializePage();
  }

  /**
   * 페이지 초기화 및 봇 탐지 우회 설정
   */
  async initializePage() {
    try {
      // 중요: AdsPower가 이미 설정한 User-Agent와 뷰포트를 변경하지 않음
      // AdsPower의 anti-fingerprinting 기능 유지
      
      // JavaScript를 통한 봇 탐지 우회
      await this.page.evaluateOnNewDocument(() => {
        // webdriver 속성 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // 플러그인 정보 설정
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        
        // Chrome runtime 제거
        if (window.chrome && window.chrome.runtime) {
          delete window.chrome.runtime;
        }
        
        // Permissions API 우회
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
        
        // DeviceMotionEvent 지원 추가
        window.DeviceMotionEvent = undefined;
        window.DeviceOrientationEvent = undefined;
      });
      
      // Extra headers 설정
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
      });
      
    } catch (error) {
      console.log(chalk.yellow('페이지 초기화 중 일부 오류 발생:', error.message));
    }
  }


  /**
   * 이메일 정규화 - 비교를 위한 표준화
   */
  normalizeEmail(email) {
    if (!email) return '';
    
    // 이메일을 소문자로 변환하고 트림
    let normalized = email.toLowerCase().trim();
    
    // @ 기호로 분리
    let parts = normalized.split('@');
    
    // @ 기호가 없으면 Gmail 도메인 추가
    if (parts.length === 1) {
      parts.push('gmail.com');
    }
    
    // 로컬 부분(@ 앞)만 정규화
    let localPart = parts[0]
      .replace(/\s+/g, '')     // 모든 공백 제거
      .replace(/[-._]/g, '');  // 구분자 제거 (Gmail은 . 과 - 를 무시)
    
    // Gmail의 + 기호 이후 제거 (alias)
    localPart = localPart.split('+')[0];
    
    // 도메인은 그대로 유지하면서 재조합
    return localPart + '@' + parts[1];
  }

  /**
   * 두 이메일이 같은지 비교
   */
  isSameEmail(email1, email2) {
    const norm1 = this.normalizeEmail(email1);
    const norm2 = this.normalizeEmail(email2);
    
    if (this.config.debugMode) {
      console.log(chalk.gray(`이메일 비교: "${email1}" -> "${norm1}" vs "${email2}" -> "${norm2}"`));
    }
    
    return norm1 === norm2;
  }
  /**
   * 프레임 준비 확인
   */
  async ensureFrameReady() {
    try {
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

      await new Promise(r => setTimeout(r, 500));
      
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
      throw error;
    }
  }

  /**
   * 안전한 evaluate 실행
   */
  async safeEvaluate(fn, ...args) {
    try {
      await this.ensureFrameReady();
      return await this.page.evaluate(fn, ...args);
    } catch (error) {
      if (error.message.includes('Requesting main frame too early')) {
        console.log(chalk.yellow('⚠️ 프레임 준비 대기 중...'));
        await new Promise(r => setTimeout(r, 2000));
        
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
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      await this.ensureFrameReady();
      const currentUrl = this.page.url();
      
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
      
      if (currentUrl.includes('youtube.com')) {
        const loginCheck = await this.safeEvaluate(() => {
          const result = {
            isLoggedIn: false,
            indicators: []
          };
          
          const avatarElements = document.querySelectorAll(
            '#avatar-btn, button#avatar-btn, img.yt-img-shadow, ' +
            'button[aria-label*="Account"], button[aria-label*="계정"]'
          );
          
          if (avatarElements.length > 0) {
            result.indicators.push('아바타 버튼 존재');
          }
          
          const signInLinks = document.querySelectorAll(
            'a[href*="accounts.google.com/ServiceLogin"], ' +
            'a[aria-label*="Sign in"], a[aria-label*="로그인"]'
          );
          
          if (signInLinks.length === 0) {
            result.indicators.push('로그인 링크 없음');
          }
          
          const pageText = document.body?.textContent || '';
          const hasMembershipContent = 
            pageText.includes('Manage membership') || 
            pageText.includes('구독 관리') ||
            pageText.includes('Premium');
            
          if (hasMembershipContent) {
            result.indicators.push('멤버십 콘텐츠 존재');
          }
          
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
      await this.ensureFrameReady();
      
      // 봇 탐지 우회 활동 (로그인 시작 전)
      console.log(chalk.cyan('🛡️ 봇 탐지 우회 활동 실행...'));
      await this.bypassBotDetection();
      
      const currentUrl = this.page.url();
      console.log(chalk.gray(`현재 URL: ${currentUrl}`));
      
      // 이메일 입력 단계 처리
      const emailStepCompleted = await this.handleEmailStep(credentials.email);
      if (emailStepCompleted) {
        console.log(chalk.green('✅ 이메일 단계 완료'));
        
        await new Promise(r => setTimeout(r, 3000));
        
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
        
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        
        const hasRecaptcha = await this.checkForRecaptcha();
        if (hasRecaptcha) {
          console.log(chalk.yellow('⚠️ reCAPTCHA 감지됨 - 수동 인증 필요'));
          return 'RECAPTCHA_DETECTED';
        }
      }
      
      await this.handle2FAIfNeeded(credentials);
      await this.waitForLoginComplete();
      
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
   * 이메일 입력 단계 처리 (Ultimate 버전)
   */
  async handleEmailStep(email) {
    try {
      await this.ensureFrameReady();
      await new Promise(r => setTimeout(r, 2000));
      
      const currentUrl = this.page.url();
      console.log(chalk.gray(`이메일 단계 URL: ${currentUrl}`));
      
      // 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        console.log(chalk.cyan('\n📋 계정 선택 페이지 처리'));
        
        // 1. 먼저 현재 계정이 목록에 있는지 확인
        const existingAccountClicked = await this.selectExistingAccount(email);
        
        if (existingAccountClicked) {
          console.log(chalk.green('✅ 기존 계정 선택 성공'));
          
          // 페이지 전환 대기 (좀 더 길게)
          console.log(chalk.cyan('🔄 계정 선택 후 페이지 전환 대기...'));
          await new Promise(r => setTimeout(r, 3000));
          
          // 페이지 상태 재확인
          const newUrl = this.page.url();
          console.log(chalk.gray(`페이지 전환 후 URL: ${newUrl}`));
          
          // 비밀번호 페이지로 이동했는지 확인
          const isPasswordPage = newUrl.includes('pwd') || 
                                newUrl.includes('challenge') || 
                                newUrl.includes('password');
          
          if (isPasswordPage) {
            console.log(chalk.green('✅ 비밀번호 페이지로 성공적으로 이동'));
            return true;
          }
          
          // 비밀번호 필드가 있는지 확인
          const hasPasswordField = await this.page.evaluate(() => {
            return document.querySelector('input[type="password"]') !== null;
          });
          
          if (hasPasswordField) {
            console.log(chalk.green('✅ 비밀번호 필드 감지됨'));
            return true;
          }
          
          console.log(chalk.yellow('⚠️ 계정 선택은 성공했지만 비밀번호 페이지로 전환되지 않음'));
          // 계정 선택이 성공했으므로 true 반환하고 다음 단계에서 처리
          return true;
        }
        
        // 2. 계정이 없으면 "다른 계정 사용" 클릭
        console.log(chalk.yellow('계정이 목록에 없음, "다른 계정 사용" 클릭 시도'));
        
        // 가능한 모든 선택자
        const addAccountSelectors = [
          'div[jsname="rwl3qc"]',
          'div[data-identifier=""]',
          'li[jsname="XraQ3b"]',
          'div[role="link"]:last-child',
          'li:last-child',
          'div:contains("Use another account")',
          'div:contains("다른 계정 사용")',
          'button:contains("Add account")',
          'button:contains("계정 추가")'
        ];
        
        let addAccountClicked = false;
        
        for (const selector of addAccountSelectors) {
          const clicked = await this.clickHelper.clickElement(selector);
          if (clicked) {
            addAccountClicked = true;
            console.log(chalk.green(`✅ "다른 계정 사용" 클릭 성공: ${selector}`));
            break;
          }
        }
        
        // 3. 선택자로 못 찾으면 텍스트 기반 검색
        if (!addAccountClicked) {
          console.log(chalk.yellow('선택자로 못 찾음, 텍스트 기반 검색'));
          
          const textClicked = await this.findAndClickByText(['Use another account', '다른 계정 사용', 'Add account', '계정 추가']);
          if (textClicked) {
            addAccountClicked = true;
            console.log(chalk.green('✅ 텍스트로 "다른 계정 사용" 클릭 성공'));
          }
        }
        
        if (!addAccountClicked) {
          console.log(chalk.red('❌ "다른 계정 사용" 버튼을 클릭할 수 없음'));
          
          // 디버그: 페이지의 모든 클릭 가능한 요소 출력
          if (this.config.debugMode) {
            await this.debugClickableElements();
          }
          
          return false;
        }
        
        // SPA 네비게이션 대기 (waitForNavigation 대신 DOM 변경 감지)
        await Promise.race([
          this.page.waitForSelector('input[type="email"]', { visible: true, timeout: 5000 }),
          this.page.waitForFunction(() => !document.querySelector('[data-identifier]'), { timeout: 5000 }),
          new Promise(r => setTimeout(r, 3000))
        ]).catch(() => {
          console.log(chalk.gray('페이지 전환 대기 완료'));
        });
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
        console.log(chalk.gray('Enter 키로 진행'));
        await this.page.keyboard.press('Enter');
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('이메일 입력 단계 실패:'), error.message);
      return false;
    }
  }

  /**
   * 기존 계정 선택 (강화된 클릭 및 페이지 전환 검증)
   */
  async selectExistingAccount(targetEmail) {
    try {
      console.log(chalk.cyan(`계정 선택 시도: ${targetEmail}`));
      
      // 먼저 페이지의 모든 계정 확인
      const pageAccounts = await this.page.evaluate(() => {
        const accounts = [];
        const elements = document.querySelectorAll('[data-identifier]');
        elements.forEach(el => {
          const id = el.getAttribute('data-identifier');
          if (id) {
            accounts.push(id);
          }
        });
        return accounts;
      });
      
      console.log(chalk.gray('페이지에 있는 계정들:'));
      pageAccounts.forEach(acc => {
        console.log(chalk.gray(`  - ${acc}`));
      });
      
      // 정규화된 이메일로 매칭 시도
      const normalizedTarget = this.normalizeEmail(targetEmail);
      console.log(chalk.gray(`정규화된 타겟: ${normalizedTarget}`));
      
      // 각 계정과 비교 - 더 유연한 매칭
      let matchedEmail = null;
      for (const accountEmail of pageAccounts) {
        const normalizedAccount = this.normalizeEmail(accountEmail);
        console.log(chalk.gray(`  비교: ${accountEmail} -> ${normalizedAccount}`));
        
        // 완전 일치 또는 로컬 부분만 비교
        if (normalizedAccount === normalizedTarget) {
          matchedEmail = accountEmail;
          console.log(chalk.green(`✅ 매칭된 계정 (정규화): ${accountEmail}`));
          break;
        }
        
        // 대소문자만 다른 경우도 처리
        if (accountEmail.toLowerCase() === targetEmail.toLowerCase()) {
          matchedEmail = accountEmail;
          console.log(chalk.green(`✅ 매칭된 계정 (대소문자): ${accountEmail}`));
          break;
        }
        
        // @ 앞부분만 비교 (도메인 제외)
        const targetLocalPart = targetEmail.split('@')[0].toLowerCase();
        const accountLocalPart = accountEmail.split('@')[0].toLowerCase();
        if (targetLocalPart === accountLocalPart) {
          matchedEmail = accountEmail;
          console.log(chalk.green(`✅ 매칭된 계정 (로컬 부분): ${accountEmail}`));
          break;
        }
      }
      
      if (!matchedEmail) {
        console.log(chalk.yellow('⚠️ 일치하는 계정을 찾을 수 없음'));
        // 직접 이메일 시도 (fallback)
        if (pageAccounts.includes(targetEmail)) {
          matchedEmail = targetEmail;
        }
      }
      
      if (matchedEmail) {
        const initialUrl = this.page.url();
        console.log(chalk.gray(`클릭 전 URL: ${initialUrl}`));
        
        // 강화된 클릭 로직 (여러 방법 시도)
        console.log(chalk.cyan('🔄 계정 요소 클릭 시도...'));
        
        let clicked = false;
        let attemptCount = 0;
        const maxAttempts = 3;
        
        while (!clicked && attemptCount < maxAttempts) {
          attemptCount++;
          console.log(chalk.cyan(`클릭 시도 ${attemptCount}/${maxAttempts}`));
          
          // 방법 1: 요소 존재 및 상태 확인 후 클릭
          try {
            const elementReady = await this.page.evaluate((email) => {
              const element = document.querySelector(`[data-identifier="${email}"]`);
              if (!element) return { ready: false, reason: '요소 없음' };
              
              const rect = element.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;
              const isInViewport = rect.top >= 0 && rect.left >= 0 &&
                                 rect.bottom <= window.innerHeight && 
                                 rect.right <= window.innerWidth;
              
              if (!isVisible) return { ready: false, reason: '요소 보이지 않음' };
              if (!isInViewport) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { ready: false, reason: '스크롤 필요' };
              }
              
              return { ready: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }, matchedEmail);
            
            console.log(chalk.gray(`요소 상태: ${JSON.stringify(elementReady)}`));
            
            if (elementReady.ready) {
              // 방법 1a: CDP 네이티브 클릭 (Google 탐지 우회)
              try {
                console.log(chalk.cyan('🎯 CDP 네이티브 클릭 시도...'));
                const cdpClicked = await this.cdpHelper.click(`[data-identifier="${matchedEmail}"]`);
                
                if (cdpClicked) {
                  console.log(chalk.green('✅ CDP 클릭 성공'));
                  await new Promise(r => setTimeout(r, 3000)); // 페이지 전환 대기
                  
                  // URL 변경 또는 페이지 상태 변화 확인
                  const newUrl = this.page.url();
                  const hasPasswordField = await this.page.$('input[type="password"]');
                  
                  if (newUrl !== initialUrl || hasPasswordField) {
                    console.log(chalk.green('✅ 페이지 전환 감지됨'));
                    clicked = true;
                    break;
                  }
                }
              } catch (e) {
                console.log(chalk.yellow(`CDP 클릭 실패: ${e.message}`));
              }
              
              // 방법 1b: 직접 클릭 (fallback)
              if (!clicked) {
                try {
                  const directClick = await this.page.evaluate((email) => {
                    const element = document.querySelector(`[data-identifier="${email}"]`);
                    if (element && element.offsetParent !== null) {
                      // 스크롤하여 중앙에 위치시킨 후 클릭
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setTimeout(() => {
                        element.focus();
                        element.click();
                      }, 500);
                      return true;
                    }
                    return false;
                  }, matchedEmail);
                  
                  if (directClick) {
                    console.log(chalk.green('방법 1b: 직접 클릭 성공'));
                    await new Promise(r => setTimeout(r, 2000));
                    
                    const newUrl = this.page.url();
                    if (newUrl !== initialUrl) {
                      console.log(chalk.green('✅ URL 변경 감지됨'));
                      clicked = true;
                      break;
                    }
                  }
                } catch (e) {
                  console.log(chalk.yellow(`방법 1b 실패: ${e.message}`));
                }
              }
            } else if (elementReady.reason === '스크롤 필요') {
              await new Promise(r => setTimeout(r, 500)); // 스크롤 완료 대기
              continue; // 다음 시도
            }
          } catch (error) {
            console.log(chalk.yellow(`방법 1 실패: ${error.message}`));
          }
          
          // 방법 2: CDP 대체 클릭 (아직 클릭되지 않은 경우)
          if (!clicked) {
            try {
              console.log(chalk.cyan('방법 2: CDP 호버 + 클릭'));
              // 먼저 호버하여 요소 활성화
              await this.cdpHelper.hover(`[data-identifier="${matchedEmail}"]`);
              await new Promise(r => setTimeout(r, 500));
              
              // 클릭
              const cdpClicked = await this.cdpHelper.click(`[data-identifier="${matchedEmail}"]`);
              
              if (cdpClicked) {
                console.log(chalk.green('방법 2: CDP 대체 클릭 성공'));
                await new Promise(r => setTimeout(r, 2000));
                
                const newUrl = this.page.url();
                if (newUrl !== initialUrl) {
                  console.log(chalk.green('✅ URL 변경 감지됨'));
                  clicked = true;
                  break;
                }
              }
            } catch (error) {
              console.log(chalk.yellow(`방법 2 실패: ${error.message}`));
            }
          }
          
          // 시도 간 대기
          if (!clicked && attemptCount < maxAttempts) {
            console.log(chalk.yellow(`시도 ${attemptCount} 실패, 2초 후 재시도...`));
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        
        if (clicked) {
          console.log(chalk.green('✅ 계정 클릭 및 페이지 전환 성공'));
          
          // 추가 페이지 전환 확인 (비밀번호 필드 등장 대기)
          console.log(chalk.cyan('🔄 비밀번호 페이지 전환 대기...'));
          const transitionSuccess = await this.waitForPageTransition(8000);
          
          if (transitionSuccess) {
            console.log(chalk.green('✅ 비밀번호 페이지 전환 완료'));
            return true;
          } else {
            console.log(chalk.yellow('⚠️ 비밀번호 페이지 전환이 감지되지 않았습니다'));
            
            // 현재 페이지 상태 디버깅
            const currentState = await this.page.evaluate(() => {
              return {
                url: window.location.href,
                hasPasswordField: document.querySelector('input[type="password"]') !== null,
                pageText: document.body.innerText.substring(0, 200)
              };
            });
            
            console.log(chalk.gray('현재 페이지 상태:'));
            console.log(chalk.gray(`  URL: ${currentState.url}`));
            console.log(chalk.gray(`  비밀번호 필드: ${currentState.hasPasswordField ? '있음' : '없음'}`));
            console.log(chalk.gray(`  페이지 텍스트: ${currentState.pageText}...`));
            
            // 비밀번호 필드가 있으면 성공으로 간주
            return currentState.hasPasswordField;
          }
        } else {
          console.log(chalk.red('❌ 모든 클릭 방법 실패'));
          
          // 디버그 정보 출력
          if (this.config.debugMode) {
            await this.debugClickableElements();
          }
        }
      }
      
      console.log(chalk.yellow('계정을 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('계정 선택 실패:'), error.message);
      return false;
    }
  }

  /**
   * 페이지 전환 대기 (URL 변경 또는 비밀번호 필드 등장 확인) - 강화 버전
   */
  async waitForPageTransition(timeout = 10000) {
    try {
      const startTime = Date.now();
      const initialUrl = this.page.url();
      let lastUrl = initialUrl;
      
      console.log(chalk.gray(`페이지 전환 대기 시작: ${initialUrl}`));
      
      while (Date.now() - startTime < timeout) {
        try {
          // URL 변경 확인 (더 세밀하게)
          const currentUrl = this.page.url();
          if (currentUrl !== lastUrl) {
            console.log(chalk.gray(`URL 변경 감지: ${lastUrl} → ${currentUrl}`));
            lastUrl = currentUrl;
            
            // 비밀번호 페이지나 로그인 완료 페이지인지 확인
            if (currentUrl.includes('pwd') || 
                currentUrl.includes('challenge') || 
                currentUrl.includes('password') ||
                currentUrl.includes('youtube.com') ||
                !currentUrl.includes('accountchooser')) {
              console.log(chalk.green('✅ 유효한 페이지 전환 감지됨'));
              return true;
            }
          }
          
          // 페이지 상태 변화 확인
          const pageState = await this.page.evaluate(() => {
            const state = {
              hasPasswordField: false,
              hasLoginForm: false,
              isAccountChooser: false,
              pageType: 'unknown'
            };
            
            // 비밀번호 필드 확인
            const passwordInputs = document.querySelectorAll('input[type="password"], input[name*="password"], input[name*="passwd"]');
            state.hasPasswordField = passwordInputs.length > 0;
            
            // 로그인 폼 확인
            const loginForms = document.querySelectorAll('form[action*="signin"], form[action*="login"], div[jsname], input[name="identifier"]');
            state.hasLoginForm = loginForms.length > 0;
            
            // 계정 선택 페이지인지 확인
            const accountElements = document.querySelectorAll('[data-identifier]');
            state.isAccountChooser = accountElements.length > 0;
            
            // 페이지 타입 결정
            if (state.hasPasswordField) {
              state.pageType = 'password';
            } else if (state.hasLoginForm && !state.isAccountChooser) {
              state.pageType = 'login';
            } else if (state.isAccountChooser) {
              state.pageType = 'accountchooser';
            } else if (window.location.href.includes('youtube.com')) {
              state.pageType = 'youtube';
            }
            
            return state;
          });
          
          console.log(chalk.gray(`페이지 상태: ${pageState.pageType}, 비밀번호필드: ${pageState.hasPasswordField}`));
          
          // 비밀번호 필드가 나타났거나 YouTube로 이동했으면 성공
          if (pageState.hasPasswordField) {
            console.log(chalk.green('✅ 비밀번호 필드 감지됨'));
            return true;
          }
          
          if (pageState.pageType === 'youtube') {
            console.log(chalk.green('✅ YouTube 페이지로 이동됨 (로그인 완료)'));
            return true;
          }
          
          // 계정 선택 페이지가 아닌 다른 로그인 단계로 이동했으면 성공
          if (pageState.pageType === 'login' && !pageState.isAccountChooser) {
            console.log(chalk.green('✅ 로그인 페이지로 전환됨'));
            return true;
          }
          
          // 아직 계정 선택 페이지에 머물러 있는 경우 계속 대기
          if (pageState.pageType === 'accountchooser') {
            console.log(chalk.yellow('⚠️ 아직 계정 선택 페이지에 있음'));
          }
          
          // 로딩 상태 확인
          const isLoading = await this.page.evaluate(() => {
            return document.readyState !== 'complete';
          });
          
          // 대기 시간 조정
          if (isLoading) {
            await new Promise(r => setTimeout(r, 300));
          } else {
            await new Promise(r => setTimeout(r, 500));
          }
          
        } catch (error) {
          // 페이지가 닫혔거나 다른 문제 발생
          console.log(chalk.yellow(`페이지 전환 확인 중 오류: ${error.message}`));
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      console.log(chalk.yellow('페이지 전환 타임아웃'));
      
      // 타임아웃되었지만 현재 상태 확인
      const finalState = await this.page.evaluate(() => {
        return {
          url: window.location.href,
          hasPasswordField: document.querySelector('input[type="password"]') !== null,
          pageTitle: document.title
        };
      });
      
      console.log(chalk.gray(`최종 상태: ${JSON.stringify(finalState)}`));
      
      // 비밀번호 필드가 있으면 성공으로 간주
      return finalState.hasPasswordField;
      
    } catch (error) {
      console.log(chalk.red(`페이지 전환 대기 오류: ${error.message}`));
      return false;
    }
  }

  /**
   * 텍스트 기반으로 요소 찾아서 클릭 (Google 로그인 페이지 최적화)
   */
  async findAndClickByText(textArray) {
    try {
      console.log(chalk.cyan('🔍 텍스트 기반 검색 시작...'));
      
      // page.evaluate를 사용하여 브라우저 내에서 검색
      const found = await this.page.evaluate((searchTexts) => {
        const allElements = document.querySelectorAll('div, li, button, a, span');
        
        for (const element of allElements) {
          const text = element.textContent?.trim();
          if (!text) continue;
          
          for (const searchText of searchTexts) {
            if (text.includes(searchText) || text === searchText) {
              // 요소가 클릭 가능한지 확인
              const rect = element.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0 && 
                               element.offsetParent !== null;
              
              if (isVisible) {
                console.log(`텍스트 발견: "${searchText}" in "${text}"`);
                
                // 스크롤하여 요소를 뷰포트에 표시
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // 다양한 클릭 방법 시도
                try {
                  // 방법 1: 직접 클릭
                  element.click();
                  return { success: true, method: 'direct-click', text: searchText };
                } catch (e1) {
                  try {
                    // 방법 2: 이벤트 디스패치
                    const clickEvent = new MouseEvent('click', {
                      view: window,
                      bubbles: true,
                      cancelable: true,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top + rect.height / 2
                    });
                    element.dispatchEvent(clickEvent);
                    return { success: true, method: 'event-dispatch', text: searchText };
                  } catch (e2) {
                    try {
                      // 방법 3: 부모 요소 클릭
                      const parent = element.closest('[role="link"]') || element.parentElement;
                      if (parent) {
                        parent.click();
                        return { success: true, method: 'parent-click', text: searchText };
                      }
                    } catch (e3) {
                      // 모든 방법 실패
                      console.log('클릭 실패:', e3.message);
                    }
                  }
                }
              }
            }
          }
        }
        
        return { success: false };
      }, textArray);
      
      if (found.success) {
        console.log(chalk.green(`✅ 텍스트 클릭 성공: "${found.text}" (${found.method})`));
        await new Promise(r => setTimeout(r, 2000)); // 클릭 후 대기
        return true;
      }
      
      console.log(chalk.yellow('⚠️ 텍스트를 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('텍스트 기반 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 기존 텍스트 클릭 메서드 (호환성 유지)
   */
  async clickByText(textArray) {
    return await this.findAndClickByText(textArray);
  }

  /**
   * Human-like 클릭 (Google 봇 탐지 우회)
   */
  async performHumanLikeClick(x, y, identifier = '') {
    try {
      console.log(chalk.cyan(`🤖 Human-like 클릭 시작: (${x}, ${y})`));
      
      // 1. 마우스를 천천히 이동 (인간처럼)
      const currentMouse = await this.page.evaluate(() => ({ x: 0, y: 0 }));
      
      // 여러 단계로 나누어 마우스 이동
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const stepX = currentMouse.x + (x - currentMouse.x) * (i / steps);
        const stepY = currentMouse.y + (y - currentMouse.y) * (i / steps);
        
        await this.page.mouse.move(stepX, stepY);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 50)); // 랜덤 지연
      }
      
      // 2. 요소에 마우스 호버 (인간적인 행동)
      await this.page.mouse.move(x, y);
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
      
      // 3. 클릭 전 마지막 확인 및 포커스
      const elementStillExists = await this.page.evaluate((id) => {
        if (id) {
          const element = document.querySelector(`[data-identifier="${id}"]`);
          if (element) {
            // 요소에 호버 이벤트 발생
            const hoverEvent = new MouseEvent('mouseover', {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
              clientY: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
            });
            element.dispatchEvent(hoverEvent);
            
            // 포커스 설정
            if (element.focus) {
              element.focus();
            }
            
            return true;
          }
        }
        return false;
      }, identifier);
      
      if (!elementStillExists && identifier) {
        console.log(chalk.yellow('⚠️ 클릭 대상 요소가 사라짐'));
        return false;
      }
      
      // 4. 실제 클릭 (마우스 다운 → 대기 → 마우스 업)
      await this.page.mouse.down();
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100)); // 클릭 유지 시간
      await this.page.mouse.up();
      
      // 5. 클릭 후 자연스러운 대기
      await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      
      // 6. 클릭 성공 여부 확인
      if (identifier) {
        const clickResult = await this.page.evaluate((id) => {
          const element = document.querySelector(`[data-identifier="${id}"]`);
          if (element) {
            // 추가적인 클릭 이벤트 발생 (확실하게)
            const clickEvent = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true,
              detail: 1
            });
            element.dispatchEvent(clickEvent);
            
            // 요소가 active 상태인지 확인
            return {
              clicked: true,
              hasActiveClass: element.classList.contains('active'),
              isSelected: element.getAttribute('aria-selected') === 'true'
            };
          }
          return { clicked: false };
        }, identifier);
        
        console.log(chalk.gray(`클릭 결과: ${JSON.stringify(clickResult)}`));
        return clickResult.clicked;
      }
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('Human-like 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 추가적인 봇 탐지 우회 메서드
   */
  async bypassBotDetection() {
    try {
      // 마우스 움직임으로 인간처럼 행동
      await this.page.mouse.move(100, 100);
      await new Promise(r => setTimeout(r, 100));
      await this.page.mouse.move(200, 150);
      await new Promise(r => setTimeout(r, 100));
      
      // 키보드 이벤트 발생 (Tab 키)
      await this.page.keyboard.press('Tab');
      await new Promise(r => setTimeout(r, 100));
      
      // 페이지에서 임의의 빈 공간 클릭
      await this.page.mouse.click(500, 300);
      await new Promise(r => setTimeout(r, 200));
      
    } catch (error) {
      console.log(chalk.yellow('봇 탐지 우회 실패:', error.message));
    }
  }

  /**
   * 디버그: 클릭 가능한 요소들 출력
   */
  async debugClickableElements() {
    try {
      const clickableElements = await this.safeEvaluate(() => {
        const elements = [];
        const all = document.querySelectorAll('div[role="link"], li[role="presentation"], button, a');
        
        for (const el of all) {
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim().substring(0, 50);
          
          if (rect.width > 0 && rect.height > 0 && text) {
            elements.push({
              tag: el.tagName,
              text: text,
              role: el.getAttribute('role'),
              jsname: el.getAttribute('jsname'),
              dataIdentifier: el.getAttribute('data-identifier'),
              visible: el.offsetParent !== null
            });
          }
        }
        
        return elements;
      });
      
      console.log(chalk.cyan('\n📋 클릭 가능한 요소들:'));
      clickableElements.forEach((el, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${el.tag} - "${el.text}"`));
        if (el.role) console.log(chalk.gray(`     role: ${el.role}`));
        if (el.jsname) console.log(chalk.gray(`     jsname: ${el.jsname}`));
        if (el.dataIdentifier) console.log(chalk.gray(`     data-identifier: ${el.dataIdentifier}`));
      });
      
    } catch (error) {
      console.error(chalk.red('디버그 실패:'), error.message);
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
            
            await element.click();
            await new Promise(r => setTimeout(r, 300));
            
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('a');
            await this.page.keyboard.up('Control');
            await new Promise(r => setTimeout(r, 100));
            
            await this.page.type(selector, email, { delay: 50 });
            
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
    const buttonSelectors = [
      'button#identifierNext',
      'div#identifierNext button',
      'div#identifierNext',
      'button[jsname="LgbsSe"]'
    ];
    
    for (const selector of buttonSelectors) {
      const clicked = await this.clickHelper.clickElement(selector);
      if (clicked) {
        console.log(chalk.green('✅ 다음 버튼 클릭 성공'));
        return true;
      }
    }
    
    return false;
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
      
      if (!currentUrl.includes('pwd') && !currentUrl.includes('challenge') && !currentUrl.includes('password')) {
        console.log(chalk.yellow('비밀번호 페이지 대기...'));
        
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
            
            await element.click();
            await new Promise(r => setTimeout(r, 300));
            
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
      
      const loginButtonSelectors = [
        'button#passwordNext',
        'div#passwordNext button',
        'div#passwordNext',
        'button[jsname="LgbsSe"]'
      ];
      
      let buttonClicked = false;
      
      for (const selector of loginButtonSelectors) {
        const clicked = await this.clickHelper.clickElement(selector);
        if (clicked) {
          buttonClicked = true;
          console.log(chalk.green('✅ 로그인 버튼 클릭 성공'));
          break;
        }
      }
      
      if (!buttonClicked) {
        await this.page.keyboard.press('Enter');
        console.log(chalk.gray('Enter 키로 진행'));
      }
      
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
      
      const tryAnotherWay = await this.clickByText(['Try another way', '다른 방법 시도']);
      
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
      await this.page.waitForFunction(
        () => {
          const url = window.location.href;
          return url.includes('youtube.com') && 
                 !url.includes('accounts.google.com');
        },
        { timeout: 30000 }
      );
      
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
      
      if (currentUrl.includes('challenge/recaptcha') || 
          currentUrl.includes('signin/v2/challenge') ||
          currentUrl.includes('challengeselection')) {
        return true;
      }
      
      const hasRecaptcha = await this.safeEvaluate(() => {
        const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
        if (recaptchaFrame) return true;
        
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

module.exports = GoogleLoginHelperUltimate;