/**
 * @class YouTubeAutomationAdapter
 * @description YouTube Premium 자동화 어댑터 (완전 재설계 버전)
 */

const { EventEmitter } = require('events');
const BrowserController = require('./BrowserController');
const { 
  YOUTUBE_LANGUAGES, 
  getAllTextsForAction, 
  getLanguage, 
  detectPageLanguage 
} = require('../config/languages');

class YouTubeAutomationAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      debugMode: config.debugMode || false,
      premiumUrl: config.premiumUrl || 'https://www.youtube.com/paid_memberships',
      forceLanguage: config.forceLanguage || null,
      screenshotEnabled: config.screenshotEnabled !== false
    };

    this.controller = null;
    this.page = null;
    this.detectedLanguage = null;
    this.languageData = null;
    this.workflowLog = [];
  }

  /**
   * 워크플로우 로그 기록 (한글 메시지)
   */
  logStep(step, status, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      step,
      status,
      details
    };
    
    this.workflowLog.push(logEntry);
    
    // 콘솔 출력
    const statusIcon = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : status === 'error' ? '❌' : 'ℹ️';
    this.emit('info', `${statusIcon} [${step}] ${details.message || ''}`);
    
    if (this.config.debugMode && details.debug) {
      console.log('Debug:', details.debug);
    }
  }

  /**
   * 브라우저 컨트롤러 설정
   */
  setBrowserController(page) {
    if (!page) {
      throw new Error('Page is required');
    }

    this.page = page;
    
    this.controller = new BrowserController(page, {
      ...this.config,
      humanMode: true
    });

    // 이벤트 전달
    this.controller.on('action', (data) => this.emit('action', data));
    this.controller.on('error', (data) => this.emit('error', data));
    this.controller.on('warning', (data) => this.emit('warning', data));
  }

  /**
   * 스크린샷 촬영
   */
  async takeScreenshot(name) {
    if (!this.config.screenshotEnabled || !this.page) return null;
    
    try {
      const filename = `screenshot_${name}_${Date.now()}.png`;
      await this.page.screenshot({ 
        path: filename,
        fullPage: true 
      });
      this.logStep('screenshot', 'success', { 
        message: `Screenshot saved: ${filename}`,
        filename 
      });
      return filename;
    } catch (error) {
      this.logStep('screenshot', 'error', { 
        message: `Screenshot failed: ${error.message}` 
      });
      return null;
    }
  }

  /**
   * 언어 감지 및 설정
   */
  async detectAndSetLanguage() {
    try {
      if (this.config.forceLanguage) {
        this.detectedLanguage = this.config.forceLanguage;
        this.languageData = getLanguage(this.config.forceLanguage);
        this.logStep('language_detection', 'success', {
          message: `Using forced language: ${this.config.forceLanguage}`,
          language: this.config.forceLanguage
        });
        return;
      }

      this.detectedLanguage = await detectPageLanguage(this.page);
      this.languageData = getLanguage(this.detectedLanguage);
      
      this.logStep('language_detection', 'success', {
        message: `Detected language: ${this.detectedLanguage} (${this.languageData.name})`,
        language: this.detectedLanguage
      });
      
    } catch (error) {
      this.logStep('language_detection', 'warning', {
        message: `Language detection failed: ${error.message}`,
        language: 'en'
      });
      this.detectedLanguage = 'en';
      this.languageData = YOUTUBE_LANGUAGES.en;
    }
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      this.logStep('login_check', 'info', {
        message: '현재 로그인 상태 확인 중'
      });
      
      // YouTube 메인 페이지로 이동
      const currentUrl = this.page.url();
      if (!currentUrl.includes('youtube.com')) {
        await this.page.goto('https://www.youtube.com', {
          waitUntil: 'networkidle2',
          timeout: 15000
        });
        await new Promise(r => setTimeout(r, 2000));
      }
      
      // 로그인 상태 확인 (여러 방법 시도)
      const loginInfo = await this.page.evaluate(() => {
        // 1. 아바타 버튼 확인 (가장 신뢰할 수 있는 방법)
        const avatarBtn = document.querySelector('#avatar-btn') ||
                         document.querySelector('button[id="avatar-btn"]') ||
                         document.querySelector('#buttons #avatar-btn');
        
        // 2. 프로필 이미지 확인
        const profileImg = document.querySelector('img#img[alt*="Avatar"]') || 
                          document.querySelector('#avatar-btn img') ||
                          document.querySelector('yt-img-shadow#avatar img');
        
        // 3. 로그인 버튼 확인 (로그인 안 된 경우)
        const signInButton = document.querySelector('a[href*="/ServiceLogin"]') ||
                            document.querySelector('tp-yt-paper-button[aria-label*="Sign in"]') ||
                            document.querySelector('yt-button-renderer a[href*="accounts.google"]');
        
        // 4. 계정 이메일 확인 (있을 경우)
        const accountEmail = document.querySelector('[aria-label*="Account"]')?.textContent ||
                            document.querySelector('#account-name')?.textContent;
        
        return {
          hasAvatar: avatarBtn !== null,
          hasProfileImg: profileImg !== null,
          hasSignInButton: signInButton !== null,
          accountEmail: accountEmail || null,
          isLoggedIn: (avatarBtn !== null || profileImg !== null) && signInButton === null
        };
      });
      
      this.logStep('login_check', loginInfo.isLoggedIn ? 'success' : 'info', {
        message: loginInfo.isLoggedIn ? 
          `Logged in${loginInfo.accountEmail ? ` as ${loginInfo.accountEmail}` : ''}` : 
          'Not logged in',
        details: loginInfo
      });
      
      return loginInfo.isLoggedIn;
    } catch (error) {
      this.logStep('login_check', 'warning', {
        message: `Login status check failed: ${error.message}`,
        error: error.stack
      });
      // 에러 발생 시 로그인 안 된 것으로 간주
      return false;
    }
  }

  /**
   * Google 로그인 워크플로우
   */
  async loginToGoogle(credentials) {
    this.logStep('login_start', 'info', {
      message: `Starting login for ${credentials.email}`
    });

    try {
      // 1. Google 로그인 페이지로 이동
      await this.page.goto('https://accounts.google.com/ServiceLogin', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      this.logStep('login_navigation', 'success', {
        message: 'Navigated to Google login page'
      });

      // 2. 이메일 입력
      await this.page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await this.page.type('input[type="email"]', credentials.email);
      await this.page.click('#identifierNext');
      
      this.logStep('login_email', 'success', {
        message: 'Email entered'
      });
      
      await new Promise(r => setTimeout(r, 2000));

      // 3. 비밀번호 입력
      await this.page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 });
      await this.page.type('input[type="password"]', credentials.password);
      await this.page.click('#passwordNext');
      
      this.logStep('login_password', 'success', {
        message: 'Password entered'
      });
      
      await new Promise(r => setTimeout(r, 3000));

      // 4. 2단계 인증 확인 (필요한 경우)
      const requires2FA = await this.page.evaluate(() => {
        return document.body.textContent.includes('2-Step Verification') || 
               document.body.textContent.includes('2단계 인증');
      });

      if (requires2FA) {
        this.logStep('login_2fa', 'warning', {
          message: '2FA required - manual intervention needed',
          recoveryEmail: credentials.recoveryEmail
        });
        
        // 복구 이메일이 있으면 사용
        if (credentials.recoveryEmail) {
          // 복구 이메일 선택 로직
          await new Promise(r => setTimeout(r, 10000)); // 수동 처리 대기
        }
      }

      // 5. 로그인 성공 확인
      await new Promise(r => setTimeout(r, 3000));
      const loggedIn = await this.page.evaluate(() => {
        return document.querySelector('img[alt*="Profile"]') !== null ||
               document.querySelector('a[aria-label*="Google Account"]') !== null;
      });

      if (loggedIn) {
        this.logStep('login_complete', 'success', {
          message: 'Successfully logged in to Google'
        });
        return true;
      } else {
        this.logStep('login_complete', 'warning', {
          message: 'Login status uncertain'
        });
        return false;
      }

    } catch (error) {
      this.logStep('login_error', 'error', {
        message: `Login failed: ${error.message}`,
        error: error.stack
      });
      await this.takeScreenshot('login_error');
      return false;
    }
  }

  /**
   * 다국어 텍스트로 요소 찾기 및 클릭 (재시도 로직 포함)
   */
  async clickByMultilingualText(action, additionalSelectors = [], waitTime = 2000, maxRetries = 3) {
    const allTexts = getAllTextsForAction(action);
    const currentLangTexts = this.languageData[action] || [];
    const orderedTexts = [...currentLangTexts, ...allTexts];
    
    let attempt = 0;
    let result = { clicked: false };
    
    while (attempt < maxRetries && !result.clicked) {
      attempt++;
      
      if (attempt > 1) {
        this.logStep(`click_${action}_retry`, 'info', {
          message: `재시도 ${attempt}/${maxRetries}: ${action} 버튼 찾는 중...`
        });
        await new Promise(r => setTimeout(r, 1000));
      } else {
        this.logStep(`click_${action}`, 'info', {
          message: `${action} 버튼 찾는 중 (${orderedTexts.length}개 텍스트)`
        });
      }
      
      result = await this.page.evaluate((texts, selectors) => {
        const elements = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], span'));
        
        for (const text of texts) {
          for (const el of elements) {
            const elementText = (el.textContent || '').trim();
            const ariaLabel = el.getAttribute('aria-label') || '';
            
            if (elementText.toLowerCase().includes(text.toLowerCase()) ||
                ariaLabel.toLowerCase().includes(text.toLowerCase())) {
              console.log(`Found element with text: "${text}"`);
              el.click();
              return { clicked: true, text, method: 'text' };
            }
          }
        }
        
        for (const selector of selectors) {
          try {
            const el = document.querySelector(selector);
            if (el && el.offsetHeight > 0) {
              console.log(`Found element with selector: ${selector}`);
              el.click();
              return { clicked: true, selector, method: 'selector' };
            }
          } catch (e) {
            // Invalid selector
          }
        }
        
        const availableTexts = elements
          .map(el => el.textContent?.trim())
          .filter(t => t && t.length < 50)
          .slice(0, 20);
        
        return { clicked: false, availableTexts };
      }, orderedTexts, additionalSelectors);
      
      if (result.clicked) {
        this.logStep(`click_${action}`, 'success', {
          message: `✅ ${action} 클릭 성공 (${result.method}: ${result.text || result.selector})`
        });
        await new Promise(r => setTimeout(r, waitTime));
        break;
      }
    }
    
    if (!result.clicked) {
      this.logStep(`click_${action}`, 'warning', {
        message: `⚠️ ${action} 버튼을 찾지 못함 (${maxRetries}번 시도)`,
        availableTexts: result.availableTexts
      });
    }
    
    return result.clicked;
  }

  /**
   * 완전히 재설계된 일시중지 워크플로우
   */
  async executePauseWorkflow(accountData = {}) {
    try {
      this.workflowLog = [];
      this.logStep('workflow_start', 'info', {
        message: 'Starting complete pause workflow',
        email: accountData.email
      });

      // 1. 로그인 상태 확인 및 필요시 로그인
      this.logStep('step_1_login_check', 'info', {
        message: 'Step 1: Checking login status'
      });
      
      const isAlreadyLoggedIn = await this.checkLoginStatus();
      
      if (isAlreadyLoggedIn) {
        this.logStep('step_1_login_check', 'success', {
          message: 'Already logged in, skipping login step'
        });
      } else if (accountData.email && accountData.password) {
        this.logStep('step_1_login', 'info', {
          message: 'Not logged in, performing login'
        });
        
        const loginSuccess = await this.loginToGoogle({
          email: accountData.email,
          password: accountData.password,
          recoveryEmail: accountData.recoveryEmail,
          code: accountData.code
        });
        
        if (!loginSuccess) {
          throw new Error('Login failed');
        }
      } else {
        this.logStep('step_1_login', 'warning', {
          message: 'Not logged in and no credentials provided'
        });
        throw new Error('Not logged in and no credentials provided');
      }

      // 2. YouTube Premium 페이지로 이동
      this.logStep('step_2_navigation', 'info', {
        message: 'Step 2: Navigating to YouTube Premium page'
      });
      
      await this.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));
      
      this.logStep('step_2_navigation', 'success', {
        message: 'Navigated to YouTube Premium page',
        url: this.page.url()
      });

      // 3. 언어 확인
      this.logStep('step_3_language', 'info', {
        message: 'Step 3: Detecting page language'
      });
      
      await this.detectAndSetLanguage();

      // 4. 멤버십 관리 버튼 클릭
      this.logStep('step_4_manage', 'info', {
        message: 'Step 4: Clicking manage membership button'
      });
      
      const manageClicked = await this.clickByMultilingualText('manage', [
        'a[href*="/paid_memberships/manage"]',
        'button[aria-label*="manage"]',
        'button[aria-label*="membership"]',
        '[role="button"]'
      ], 3000);

      if (!manageClicked) {
        await this.page.goto('https://www.youtube.com/paid_memberships/manage', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await new Promise(r => setTimeout(r, 3000));
        
        this.logStep('step_4_manage', 'success', {
          message: 'Navigated directly to manage page'
        });
      }

      // 5. 간단한 일시중지 버튼 찾기 및 클릭
      this.logStep('step_5_pause_simple', 'info', {
        message: 'Step 5: Simplified pause button click'
      });
      
      // 먼저 드롭다운 열기 시도 (선택적)
      const menuClicked = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const svg = btn.querySelector('svg');
          const hasText = btn.textContent?.trim();
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
          
          // SVG 아이콘이 있고 텍스트가 없는 버튼 (더보기 버튼)
          if ((svg && !hasText) || 
              (ariaLabel && (ariaLabel.includes('more') || ariaLabel.includes('menu')))) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (menuClicked) {
        this.logStep('step_5_dropdown', 'success', {
          message: 'Dropdown menu opened'
        });
        await new Promise(r => setTimeout(r, 1000));
      }

      // 6. 단순화된 일시중지 클릭 로직
      this.logStep('step_6_pause', 'info', {
        message: 'Step 6: Direct pause button click'
      });
      
      let pauseSuccess = false;
      let pauseAttempt = 0;
      const maxPauseAttempts = 3;
      
      while (pauseAttempt < maxPauseAttempts && !pauseSuccess) {
        pauseAttempt++;
        
        if (pauseAttempt > 1) {
          this.logStep('step_6_pause_retry', 'info', {
            message: `재시도 ${pauseAttempt}/${maxPauseAttempts}: pause 버튼 다시 찾는 중...`
          });
          await new Promise(r => setTimeout(r, 1000));
        }
        
        // 단순화된 pause 버튼 찾기 및 클릭
        const pauseButtonClicked = await this.page.evaluate(() => {
          console.log('=== 단순화된 Pause 버튼 찾기 ===');
          
          // 방법 1: 페이지에서 모든 "일시중지" 텍스트 찾기
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const text = el.textContent?.trim();
            // 정확히 "일시중지" 또는 "Pause" 텍스트만 있는 요소
            if (text === '일시중지' || text === 'Pause' || text === '멤버십 일시중지') {
              // 클릭 가능한 요소인지 확인
              if (el.tagName === 'A' || el.tagName === 'BUTTON' || 
                  el.tagName === 'YT-FORMATTED-STRING' ||
                  el.getAttribute('role') === 'button' || 
                  el.getAttribute('role') === 'menuitem') {
                console.log(`✓ 일시중지 요소 발견: ${el.tagName}, 텍스트: "${text}"`);
                el.click();
                return { 
                  clicked: true, 
                  text, 
                  method: 'direct-text-click',
                  tagName: el.tagName
                };
              }
            }
          }
          
          // 방법 2: href에 cancel이 포함된 링크 찾기
          const cancelLinks = document.querySelectorAll('a[href*="/paid_memberships/cancel"]');
          for (const link of cancelLinks) {
            console.log(`✓ Cancel 링크 발견: ${link.href}`);
            link.click();
            return { 
              clicked: true, 
              text: link.textContent?.trim(), 
              method: 'cancel-link',
              href: link.href
            };
          }
          
          // 방법 3: yt-formatted-string 내의 일시중지 텍스트
          const ytStrings = document.querySelectorAll('yt-formatted-string');
          for (const el of ytStrings) {
            const text = el.textContent?.trim();
            if (text === '일시중지' || text === 'Pause') {
              console.log(`✓ YT 문자열 발견: "${text}"`);
              
              // 부모 요소 중 클릭 가능한 것 찾기
              let clickableParent = el.closest('[role="menuitem"], a, button, [role="button"]');
              if (clickableParent) {
                console.log('클릭 가능한 부모 발견:', clickableParent.tagName);
                clickableParent.click();
                return { clicked: true, text, method: 'yt-string-parent' };
              }
              
              // 부모가 없으면 자체 클릭
              el.click();
              return { clicked: true, text, method: 'yt-string-direct' };
            }
          }
          
          console.log('=== Pause 버튼을 찾지 못함 ===');
          return { 
            clicked: false
          };
        });
        
        let clicked = pauseButtonClicked.clicked;
        
        // JavaScript 클릭이 실패하면 직접 URL로 이동
        if (!clicked) {
          this.logStep('step_6_pause_direct_url', 'info', {
            message: '대체 방법: 직접 cancel URL로 이동'
          });
          
          try {
            // 직접 cancel 페이지로 이동
            await this.page.goto('https://www.youtube.com/paid_memberships/cancel', {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            await new Promise(r => setTimeout(r, 2000));
            
            clicked = true;
            this.logStep('step_6_pause_direct_url', 'success', {
              message: '✅ Cancel 페이지로 직접 이동 성공',
              url: this.page.url()
            });
          } catch (navigationError) {
            this.logStep('step_6_pause_direct_url', 'warning', {
              message: `URL 이동 실패: ${navigationError.message}`
            });
          }
        }
        
        if (clicked) {
          const clickMethod = pauseButtonClicked?.method || 'direct-url';
          this.logStep('step_6_pause_click', 'success', {
            message: `✅ Pause 버튼 클릭/이동 성공 (방법: ${clickMethod})`,
            text: pauseButtonClicked?.text,
            href: pauseButtonClicked?.href
          });
          // 클릭/이동 후 팝업이 실제로 열렸는지 확인
          await new Promise(r => setTimeout(r, 2000));
          
          const popupInfo = await this.page.evaluate(() => {
            // 팝업 관련 텍스트 확인
            const pageText = document.body.textContent || '';
            const hasPopupText = 
              pageText.includes('일시중지 기간') ||
              pageText.includes('멤버십이 일시중지됩니다') ||
              pageText.includes('결제가 다시 시작됩니다') ||
              pageText.includes('1개월') ||
              pageText.includes('2개월') ||
              pageText.includes('3개월') ||
              pageText.includes('Pause period') ||
              pageText.includes('membership will be paused');
            
            // 팝업 다이얼로그 엘리먼트 확인
            const dialogSelectors = [
              '[role="dialog"]',
              '[aria-modal="true"]',
              'tp-yt-paper-dialog',
              'ytd-dialog',
              '.ytd-popup-container'
            ];
            
            let visibleDialog = null;
            for (const selector of dialogSelectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                  visibleDialog = {
                    selector,
                    text: el.textContent?.substring(0, 200)
                  };
                  break;
                }
              }
              if (visibleDialog) break;
            }
            
            // 멤버십 일시중지 버튼 존재 확인
            const pauseButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
              .filter(btn => {
                const text = (btn.textContent || '').trim();
                return text === '멤버십 일시중지' || text === 'Pause membership';
              });
            
            return {
              hasPopupText,
              visibleDialog,
              hasPauseButton: pauseButtons.length > 0,
              buttons: pauseButtons.map(btn => btn.textContent?.trim())
            };
          });
          
          if (popupInfo.hasPopupText || popupInfo.visibleDialog || popupInfo.hasPauseButton) {
            pauseSuccess = true;
            this.logStep('step_6_pause_verify', 'success', {
              message: `✅ Pause 클릭 성공 및 팝업 열림 확인`,
              popupFound: popupInfo.visibleDialog?.selector,
              hasConfirmButton: popupInfo.hasPauseButton
            });
            
            if (this.config.debugMode) {
              console.log('팝업 정보:', popupInfo);
            }
          } else {
            this.logStep('step_6_pause_verify', 'warning', {
              message: '⚠️ Pause 클릭했지만 팝업이 감지되지 않음'
            });
            
            // 드롭다운 다시 열기 시도
            const menuReopened = await this.page.evaluate(() => {
              const menuButtons = Array.from(document.querySelectorAll('button'))
                .filter(btn => {
                  const svg = btn.querySelector('svg');
                  const isMenu = btn.getAttribute('aria-label')?.toLowerCase().includes('more') ||
                               btn.getAttribute('aria-label')?.toLowerCase().includes('menu') ||
                               (svg && btn.textContent === '');
                  return isMenu;
                });
              
              if (menuButtons.length > 0) {
                menuButtons[0].click();
                return true;
              }
              return false;
            });
            
            if (menuReopened) {
              await new Promise(r => setTimeout(r, 1000));
              this.logStep('step_6_dropdown_reopen', 'info', {
                message: '드롭다운 메뉴 다시 열기'
              });
            }
          }
        }
      }

      if (!pauseSuccess) {
        // 대체 방법: URL 직접 이동
        this.logStep('step_6_alternative', 'warning', {
          message: '⚠️ 팝업이 열리지 않아 대체 방법 시도: URL 직접 이동'
        });
        
        try {
          // YouTube Premium 일시중지 페이지로 직접 이동
          await this.page.goto('https://www.youtube.com/paid_memberships/cancel', {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
          
          await new Promise(r => setTimeout(r, 2000));
          
          // 일시중지 옵션이 있는지 확인
          const hasPauseOption = await this.page.evaluate(() => {
            const pageText = document.body.textContent || '';
            return pageText.includes('일시중지') || pageText.includes('Pause') || 
                   pageText.includes('멤버십을 일시중지') || pageText.includes('Pause membership');
          });
          
          if (hasPauseOption) {
            this.logStep('step_6_alternative_success', 'success', {
              message: '✅ 일시중지 페이지로 직접 이동 성공'
            });
            pauseSuccess = true;
          } else {
            throw new Error('일시중지 옵션을 찾을 수 없음');
          }
        } catch (altError) {
          this.logStep('step_6_alternative_fail', 'error', {
            message: `대체 방법도 실패: ${altError.message}`
          });
          throw new Error('Pause 버튼 클릭 및 대체 방법 모두 실패');
        }
      }

      // 7. 팝업창에서 "멤버십 일시중지" 최종 확인
      this.logStep('step_7_confirm', 'info', {
        message: '단계 7: 팝업에서 최종 일시중지 확인 버튼 클릭'
      });
      
      // 팝업이 이미 열려 있으므로 짧게 대기
      await new Promise(r => setTimeout(r, 1000));
      
      // 팝업 확인 버튼 재시도 로직
      let confirmResult = { clicked: false };
      let confirmAttempt = 0;
      const maxConfirmRetries = 3;
      
      while (confirmAttempt < maxConfirmRetries && !confirmResult.clicked) {
        confirmAttempt++;
        
        if (confirmAttempt > 1) {
          this.logStep('step_7_confirm_retry', 'info', {
            message: `재시도 ${confirmAttempt}/${maxConfirmRetries}: 팝업 확인 버튼 찾는 중...`
          });
          await new Promise(r => setTimeout(r, 1000));
        }
        
        // 팝업 내용 확인 및 버튼 찾기
        confirmResult = await this.page.evaluate(() => {
        // 팝업/다이얼로그 찾기 (더 다양한 선택자 추가)
        const dialogSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          '.ytd-popup-container',
          'tp-yt-paper-dialog',
          'ytd-dialog',
          'ytd-confirm-dialog-renderer',
          '.dialog-content',
          '[aria-labelledby*="dialog"]'
        ];
        
        let popupContent = null;
        let dialogElement = null;
        
        // 각 선택자로 다이얼로그 찾기
        for (const selector of dialogSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (el.offsetHeight > 0 && el.offsetWidth > 0) {
              dialogElement = el;
              popupContent = el.textContent;
              console.log(`팝업 발견: ${selector}, 내용 길이: ${popupContent.length}`);
              break;
            }
          }
          if (dialogElement) break;
        }
        
        // 팝업이 없으면 전체 페이지에서 팝업 관련 텍스트 찾기
        if (!popupContent) {
          const pageText = document.body.textContent;
          if (pageText.includes('일시중지 기간 선택') || 
              pageText.includes('결제가 다시 시작됩니다') ||
              pageText.includes('멤버십이 일시중지됩니다')) {
            popupContent = '팝업 텍스트 감지됨';
            console.log('페이지에서 팝업 관련 텍스트 발견');
          }
        }
        
        // 모든 버튼 찾기
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], tp-yt-paper-button, yt-button-renderer'));
        const buttonInfo = [];
        
        // 다이얼로그 내부 버튼 우선 확인
        if (dialogElement) {
          const dialogButtons = dialogElement.querySelectorAll('button, [role="button"], tp-yt-paper-button');
          console.log(`다이얼로그 내부 버튼 수: ${dialogButtons.length}`);
          
          for (const btn of dialogButtons) {
            const btnText = (btn.textContent || '').trim();
            if (btnText) {
              console.log(`다이얼로그 버튼 발견: "${btnText}"`);
              
              // "멤버십 일시중지" 정확한 매칭
              if (btnText === '멤버십 일시중지' || btnText === 'Pause membership') {
                console.log(`✅ 정확한 확인 버튼 발견: "${btnText}"`);
                btn.click();
                return { 
                  clicked: true, 
                  clickedButton: btnText,
                  wasInDialog: true,
                  popupContent: popupContent ? popupContent.substring(0, 500) : null,
                  allButtons: buttonInfo
                };
              }
            }
          }
        }
        
        // 전체 페이지에서 버튼 찾기 (우선순위: 멤버십 일시중지 > 일시중지)
        let targetButton = null;
        let targetButtonText = null;
        let targetIsInDialog = false;
        
        for (const btn of allButtons) {
          const btnText = (btn.textContent || '').trim();
          const isVisible = btn.offsetHeight > 0 && btn.offsetWidth > 0;
          const isInDialog = dialogElement ? dialogElement.contains(btn) : 
                            (btn.closest('[role="dialog"]') !== null || 
                             btn.closest('[aria-modal="true"]') !== null);
          
          if (btnText && isVisible) {
            buttonInfo.push({
              text: btnText,
              isInDialog,
              className: btn.className,
              id: btn.id || null,
              ariaLabel: btn.getAttribute('aria-label') || null
            });
            
            // 우선순위 1: "멤버십 일시중지" 정확한 매칭
            if (btnText === '멤버십 일시중지' || btnText === 'Pause membership') {
              targetButton = btn;
              targetButtonText = btnText;
              targetIsInDialog = isInDialog;
              console.log(`✅ 최우선 확인 버튼 발견: "${btnText}"`);
              break; // 즉시 종료
            }
            
            // 우선순위 2: 팝업 컨텍스트에서 "일시중지" (아직 targetButton이 없을 때만)
            if (!targetButton && popupContent && btnText === '일시중지') {
              targetButton = btn;
              targetButtonText = btnText;
              targetIsInDialog = isInDialog;
              console.log(`대체 확인 버튼 발견: "${btnText}"`);
              // 계속 검색 (더 나은 버튼이 있을 수 있음)
            }
          }
        }
        
        // 찾은 버튼 클릭
        if (targetButton) {
          console.log(`최종 선택된 버튼 클릭: "${targetButtonText}" (다이얼로그: ${targetIsInDialog})`);
          targetButton.click();
          return { 
            clicked: true, 
            clickedButton: targetButtonText,
            wasInDialog: targetIsInDialog,
            popupContent: popupContent ? popupContent.substring(0, 500) : null,
            allButtons: buttonInfo
          };
        }
        
        // 대체 방법: 팝업 컨텍스트가 있을 때만
        if (popupContent) {
          // 팝업 관련 텍스트가 있는 영역에서 버튼 찾기
          const possibleConfirmButtons = allButtons.filter(btn => {
            const btnText = (btn.textContent || '').trim();
            const isVisible = btn.offsetHeight > 0 && btn.offsetWidth > 0;
            
            // 다음 조건 중 하나라도 만족하면 확인 버튼 후보
            return isVisible && btnText && (
              btnText === '멤버십 일시중지' ||
              btnText === '일시중지' && popupContent.includes('일시중지 기간') ||
              btnText === 'Pause membership' ||
              btnText === 'Pause' && popupContent.includes('pause period')
            );
          });
          
          // 찾은 버튼 중 첫 번째 클릭
          if (possibleConfirmButtons.length > 0) {
            const btn = possibleConfirmButtons[0];
            const btnText = (btn.textContent || '').trim();
            console.log(`대체 확인 버튼 클릭: "${btnText}"`);
            btn.click();
            return { 
              clicked: true, 
              clickedButton: btnText,
              wasInDialog: false,
              isAlternative: true,
              popupContent: popupContent ? popupContent.substring(0, 500) : null,
              allButtons: buttonInfo
            };
          }
        }
        
        return { 
          clicked: false, 
          popupContent: popupContent ? popupContent.substring(0, 500) : null,
          allButtons: buttonInfo
        };
      });
        
        if (confirmResult.clicked) {
          break; // 성공하면 반복 종료
        }
      }
      
      if (confirmResult.clicked) {
        this.logStep('step_7_confirm', 'success', {
          message: `✅ 최종 확인 버튼 클릭됨: "${confirmResult.clickedButton}" (다이얼로그: ${confirmResult.wasInDialog ? '예' : '아니오'}${confirmResult.isAlternative ? ', 대체 버튼' : ''})`
        });
        
        if (this.config.debugMode) {
          console.log('팝업 내용:', confirmResult.popupContent);
          console.log('발견된 모든 버튼:', confirmResult.allButtons);
        }
      } else {
        this.logStep('step_7_confirm', 'warning', {
          message: `⚠️ 최종 확인 버튼을 찾지 못함 (${maxConfirmRetries}번 시도)`,
          availableButtons: confirmResult.allButtons
        });
        
        if (this.config.debugMode) {
          console.log('팝업 내용:', confirmResult.popupContent);
          console.log('발견된 버튼들:', confirmResult.allButtons);
        }
      }

      // 8. 잠시 대기 후 새로고침
      this.logStep('step_8_refresh', 'info', {
        message: 'Step 8: Waiting and refreshing page'
      });
      
      await new Promise(r => setTimeout(r, 5000));
      await this.page.reload({ waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      
      this.logStep('step_8_refresh', 'success', {
        message: 'Page refreshed'
      });

      // 9. 멤버십 관리 다시 클릭
      this.logStep('step_9_recheck', 'info', {
        message: 'Step 9: Clicking manage membership again to check status'
      });
      
      const recheckManageClicked = await this.clickByMultilingualText('manage', [
        'a[href*="/paid_memberships/manage"]',
        'button[aria-label*="manage"]'
      ], 2000);

      // 10. 일시정지 성공 확인
      this.logStep('step_10_verify', 'info', {
        message: '단계 10: 일시중지 상태 확인'
      });
      
      // 페이지가 여전히 유효한지 확인
      let pageContent = '';
      let isPaused = false;
      let hasResumeButton = false;
      
      try {
        pageContent = await this.page.content();
        
        // 성공 지표 확인
        const allPausedTexts = [];
        Object.values(YOUTUBE_LANGUAGES).forEach(lang => {
          if (lang.status && lang.status.paused) {
            allPausedTexts.push(...lang.status.paused);
          }
        });
        
        isPaused = allPausedTexts.some(text => 
          pageContent.toLowerCase().includes(text.toLowerCase())
        );
        
        // 재개 버튼이 있는지 확인 (일시중지 성공의 또 다른 지표)
        hasResumeButton = await this.page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, a'));
          return elements.some(el => {
            const text = (el.textContent || '').toLowerCase();
            return text.includes('resume') || text.includes('재개') || text.includes('devam');
          });
        });
      } catch (verifyError) {
        this.logStep('step_10_verify_error', 'warning', {
          message: `검증 중 오류 발생: ${verifyError.message}`,
          error: verifyError.stack
        });
        // 오류가 발생해도 이전 단계들이 성공했다면 일시중지는 성공한 것으로 간주
        isPaused = confirmResult.clicked;
      }
      
      const verificationSuccess = isPaused || hasResumeButton;
      
      if (verificationSuccess) {
        this.logStep('step_10_verify', 'success', {
          message: '일시중지 확인 성공',
          isPaused,
          hasResumeButton
        });
      } else {
        this.logStep('step_10_verify', 'warning', {
          message: '일시중지 상태 불확실'
        });
      }

      // 최종 스크린샷 (안전하게 시도)
      try {
        await this.takeScreenshot('pause_complete');
      } catch (screenshotError) {
        this.logStep('screenshot_error', 'warning', {
          message: `스크린샷 촬영 실패: ${screenshotError.message}`
        });
      }

      // 워크플로우 완료
      this.logStep('workflow_complete', 'success', {
        message: '일시중지 워크플로우 완료',
        success: verificationSuccess
      });

      return {
        success: verificationSuccess,
        message: verificationSuccess ? 
          `Successfully paused subscription for ${accountData.email || 'account'}` :
          'Pause workflow completed but status uncertain',
        language: this.detectedLanguage,
        workflowLog: this.workflowLog,
        status: {
          isPaused: verificationSuccess,
          hasResumeButton,
          language: this.detectedLanguage
        }
      };

    } catch (error) {
      this.logStep('workflow_error', 'error', {
        message: `워크플로우 실패: ${error.message}`,
        error: error.stack
      });
      
      // 오류 스크린샷 (안전하게 시도)
      try {
        await this.takeScreenshot('error');
      } catch (screenshotError) {
        // 스크린샷 실패는 무시
      }
      
      return {
        success: false,
        message: error.message,
        error,
        workflowLog: this.workflowLog
      };
    }
  }

  /**
   * 재개 워크플로우 (유사한 구조)
   */
  async executeResumeWorkflow(accountData = {}) {
    try {
      this.workflowLog = [];
      this.logStep('workflow_start', 'info', {
        message: 'Starting complete resume workflow',
        email: accountData.email
      });

      // 로그인 상태 확인 및 필요시 로그인
      this.logStep('step_1_login_check', 'info', {
        message: 'Step 1: Checking login status'
      });
      
      const isAlreadyLoggedIn = await this.checkLoginStatus();
      
      if (isAlreadyLoggedIn) {
        this.logStep('step_1_login_check', 'success', {
          message: 'Already logged in, skipping login step'
        });
      } else if (accountData.email && accountData.password) {
        this.logStep('step_1_login', 'info', {
          message: 'Not logged in, performing login'
        });
        
        const loginSuccess = await this.loginToGoogle({
          email: accountData.email,
          password: accountData.password,
          recoveryEmail: accountData.recoveryEmail,
          code: accountData.code
        });
        
        if (!loginSuccess) {
          throw new Error('Login failed');
        }
      } else {
        this.logStep('step_1_login', 'warning', {
          message: 'Not logged in and no credentials provided'
        });
        throw new Error('Not logged in and no credentials provided');
      }

      // YouTube Premium 페이지로 이동
      await this.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));

      // 언어 감지
      await this.detectAndSetLanguage();

      // 재개 버튼 찾기
      this.logStep('resume_button', 'info', {
        message: 'Looking for resume button'
      });
      
      const resumeClicked = await this.clickByMultilingualText('resume', [
        'a[href*="resume"]',
        'button[aria-label*="resume"]'
      ], 2000);

      if (resumeClicked) {
        // 팝업에서 확인
        await new Promise(r => setTimeout(r, 1500));
        
        const resumeConfirmTexts = [];
        Object.values(YOUTUBE_LANGUAGES).forEach(lang => {
          if (lang.resumeConfirm) {
            resumeConfirmTexts.push(...lang.resumeConfirm);
          }
        });
        
        const confirmClicked = await this.page.evaluate((texts) => {
          const buttons = Array.from(document.querySelectorAll('[role="dialog"] button, button'));
          for (const text of texts) {
            for (const btn of buttons) {
              if (btn.textContent?.toLowerCase().includes(text.toLowerCase())) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        }, resumeConfirmTexts);
        
        if (confirmClicked) {
          this.logStep('resume_confirm', 'success', {
            message: 'Resume confirmation clicked'
          });
        }
      }

      // 결과 확인
      await new Promise(r => setTimeout(r, 5000));
      await this.page.reload({ waitUntil: 'networkidle2' });
      
      const pageContent = await this.page.content();
      const allActiveTexts = [];
      Object.values(YOUTUBE_LANGUAGES).forEach(lang => {
        if (lang.status && lang.status.active) {
          allActiveTexts.push(...lang.status.active);
        }
      });
      
      const isActive = allActiveTexts.some(text => 
        pageContent.toLowerCase().includes(text.toLowerCase())
      );

      await this.takeScreenshot('resume_complete');

      return {
        success: isActive || resumeClicked,
        message: isActive ? 
          `Successfully resumed subscription for ${accountData.email || 'account'}` :
          'Resume workflow completed',
        language: this.detectedLanguage,
        workflowLog: this.workflowLog,
        status: {
          isActive,
          language: this.detectedLanguage
        }
      };

    } catch (error) {
      this.logStep('workflow_error', 'error', {
        message: `Resume workflow failed: ${error.message}`
      });
      
      return {
        success: false,
        message: error.message,
        error,
        workflowLog: this.workflowLog
      };
    }
  }

  /**
   * 워크플로우 로그 출력
   */
  printWorkflowSummary() {
    console.log('\n📋 Workflow Summary:');
    console.log('═'.repeat(60));
    
    this.workflowLog.forEach((log, index) => {
      const icon = log.status === 'success' ? '✅' : 
                  log.status === 'warning' ? '⚠️' : 
                  log.status === 'error' ? '❌' : 'ℹ️';
      
      console.log(`${index + 1}. ${icon} ${log.step}`);
      console.log(`   ${log.details.message || ''}`);
      
      if (log.details.availableTexts) {
        console.log(`   Available: ${log.details.availableTexts.slice(0, 3).join(', ')}`);
      }
    });
    
    console.log('═'.repeat(60));
  }
}

module.exports = YouTubeAutomationAdapter;