/**
 * Google 로그인 헬퍼 - 2025년 최신 우회 기법 적용
 * AdsPower + Puppeteer 통합 고급 로그인 시스템
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs').promises;
const path = require('path');

class GoogleLoginHelperAdvanced2025 {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.humanMode = options.humanMode || true;
    this.maxRetries = options.maxRetries || 3;
    this.logger = options.logger || console;
    
    // 2025년 우회 기법 설정
    this.stealthConfig = {
      enableEvasions: true,
      userAgent: null, // AdsPower에서 자동 설정
      viewport: null,  // AdsPower에서 자동 설정
      timezone: null,  // AdsPower에서 자동 설정
      locale: 'ko-KR'
    };
  }

  /**
   * 고급 로그인 상태 감지 (2025년 기준)
   */
  async detectLoginStatus(page) {
    this.log('🔍 고급 로그인 상태 감지 시작', 'info');
    
    try {
      // 1단계: URL 기반 1차 판단
      const currentUrl = await page.url();
      this.log(`현재 URL: ${currentUrl}`, 'debug');
      
      // 2단계: 다중 검증 로직
      const loginStatus = await page.evaluate(() => {
        const result = {
          isLoggedIn: false,
          confidence: 0,
          evidence: [],
          userEmail: null,
          needsLogin: true,
          pageType: 'unknown',
          detectionMethods: []
        };
        
        // Method 1: URL 패턴 분석
        const url = window.location.href;
        if (url.includes('myaccount.google.com')) {
          result.evidence.push('myaccount-url');
          result.isLoggedIn = true;
          result.confidence += 30;
          result.pageType = 'account-dashboard';
        } else if (url.includes('accounts.google.com') && !url.includes('signin') && !url.includes('accountchooser')) {
          result.evidence.push('accounts-main-url');
          result.isLoggedIn = true;
          result.confidence += 25;
          result.pageType = 'accounts-main';
        } else if (url.includes('signin') || url.includes('accountchooser')) {
          result.evidence.push('signin-url');
          result.needsLogin = true;
          result.pageType = 'signin-page';
        }
        
        // Method 2: DOM 요소 기반 감지 (더 정확한 선택자)
        const loginIndicators = [
          // 로그인된 상태 표시자
          { selector: '[data-ogsr-up]', type: 'profile', weight: 25 },
          { selector: '[aria-label*="Google Account"]', type: 'account-menu', weight: 20 },
          { selector: '[data-email]', type: 'email-data', weight: 30 },
          { selector: 'img[alt*="profile"], img[alt*="account"]', type: 'profile-image', weight: 15 },
          { selector: '[href*="myaccount.google.com"]', type: 'account-link', weight: 25 },
          { selector: '[data-ved][href*="logout"]', type: 'logout-link', weight: 20 }
        ];
        
        loginIndicators.forEach(indicator => {
          const elements = document.querySelectorAll(indicator.selector);
          if (elements.length > 0) {
            result.evidence.push(indicator.type);
            result.confidence += indicator.weight;
            result.isLoggedIn = true;
            result.detectionMethods.push(`DOM:${indicator.type}`);
            
            // 이메일 추출 시도
            elements.forEach(el => {
              const email = el.getAttribute('data-email') || el.textContent || el.title || el.alt;
              if (email && email.includes('@') && !result.userEmail) {
                result.userEmail = email.trim();
              }
            });
          }
        });
        
        // Method 3: 로그인 필요 표시자 확인
        const loginRequiredIndicators = [
          { selector: 'input[type="email"], input[id="identifierId"]', type: 'email-input', weight: 30 },
          { selector: 'input[type="password"], input[name="password"]', type: 'password-input', weight: 25 },
          { selector: '[jsname="Cuz2Ue"], [id="next"]', type: 'next-button', weight: 20 },
          { selector: '[data-l="sign in"]', type: 'signin-button', weight: 25 }
        ];
        
        loginRequiredIndicators.forEach(indicator => {
          const elements = document.querySelectorAll(indicator.selector);
          if (elements.length > 0) {
            result.evidence.push(`need-${indicator.type}`);
            result.needsLogin = true;
            result.detectionMethods.push(`LOGIN-REQ:${indicator.type}`);
          }
        });
        
        // Method 4: JavaScript 전역 객체 확인
        try {
          if (typeof window.gapi !== 'undefined' && window.gapi.auth2) {
            const authInstance = window.gapi.auth2.getAuthInstance();
            if (authInstance && authInstance.isSignedIn && authInstance.isSignedIn.get()) {
              result.evidence.push('gapi-auth');
              result.confidence += 40;
              result.isLoggedIn = true;
              result.detectionMethods.push('JS:gapi-auth');
              
              const user = authInstance.currentUser.get();
              const profile = user.getBasicProfile();
              if (profile) {
                result.userEmail = profile.getEmail();
              }
            }
          }
        } catch (e) {
          // GAPI 없거나 에러 - 무시
        }
        
        // Method 5: 쿠키 기반 판단 (보조적)
        try {
          const cookies = document.cookie;
          if (cookies.includes('SAPISID') && cookies.includes('HSID')) {
            result.evidence.push('auth-cookies');
            result.confidence += 15;
            result.detectionMethods.push('COOKIE:auth');
          }
        } catch (e) {
          // 쿠키 접근 제한 - 무시
        }
        
        // Method 6: 페이지 제목 기반 판단
        const title = document.title;
        if (title.includes('Google Account') && !title.includes('Sign in')) {
          result.evidence.push('account-title');
          result.confidence += 10;
          result.detectionMethods.push('TITLE:account');
        } else if (title.includes('Sign in') || title.includes('로그인')) {
          result.evidence.push('signin-title');
          result.needsLogin = true;
          result.detectionMethods.push('TITLE:signin');
        }
        
        // 최종 판단 로직
        if (result.confidence >= 50) {
          result.isLoggedIn = true;
          result.needsLogin = false;
        } else if (result.confidence < 20 && result.needsLogin) {
          result.isLoggedIn = false;
          result.needsLogin = true;
        }
        
        return result;
      });
      
      // 3단계: YouTube 교차 검증
      this.log('🎬 YouTube 교차 검증 실행', 'debug');
      await page.goto('https://www.youtube.com', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      
      await this.humanDelay(2000, 3000);
      
      const youtubeStatus = await page.evaluate(() => {
        const result = {
          isLoggedIn: false,
          hasAvatar: false,
          hasChannelInfo: false,
          confidence: 0
        };
        
        // YouTube 로그인 확인
        const avatar = document.querySelector('#avatar-btn img, [id*="avatar"] img');
        if (avatar && avatar.src && !avatar.src.includes('default_user')) {
          result.hasAvatar = true;
          result.confidence += 40;
          result.isLoggedIn = true;
        }
        
        // 채널 정보 확인
        const channelInfo = document.querySelector('[id*="channel-name"], [class*="channel-name"]');
        if (channelInfo && channelInfo.textContent) {
          result.hasChannelInfo = true;
          result.confidence += 30;
          result.isLoggedIn = true;
        }
        
        // 로그인 버튼 부재 확인
        const signInButton = document.querySelector('[aria-label*="Sign in"], [href*="accounts.google.com"]');
        if (!signInButton) {
          result.confidence += 20;
        }
        
        if (result.confidence >= 50) {
          result.isLoggedIn = true;
        }
        
        return result;
      });
      
      // 최종 통합 판단
      const finalStatus = {
        isLoggedIn: loginStatus.isLoggedIn && youtubeStatus.isLoggedIn,
        needsLogin: loginStatus.needsLogin || !youtubeStatus.isLoggedIn,
        confidence: Math.min(loginStatus.confidence + youtubeStatus.confidence, 100),
        userEmail: loginStatus.userEmail,
        evidence: loginStatus.evidence,
        detectionMethods: loginStatus.detectionMethods,
        pageType: loginStatus.pageType,
        youtubeConfirmed: youtubeStatus.isLoggedIn
      };
      
      this.log(`로그인 상태 감지 결과:`, 'info');
      this.log(`  - 로그인 상태: ${finalStatus.isLoggedIn ? '✅ 로그인됨' : '❌ 로그인 안됨'}`, 'info');
      this.log(`  - 신뢰도: ${finalStatus.confidence}%`, 'info');
      this.log(`  - 감지 방법: ${finalStatus.detectionMethods.join(', ')}`, 'debug');
      this.log(`  - 증거: ${finalStatus.evidence.join(', ')}`, 'debug');
      
      return finalStatus;
      
    } catch (error) {
      this.log(`로그인 상태 감지 오류: ${error.message}`, 'error');
      return {
        isLoggedIn: false,
        needsLogin: true,
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * 2025년 우회 기법이 적용된 자동 로그인
   */
  async performLogin(page, credentials) {
    this.log('🔐 고급 자동 로그인 시작', 'info');
    
    try {
      const { email, password, recoveryEmail, code } = credentials;
      
      // 1단계: Stealth 설정 강화
      await this.applyAdvancedStealth(page);
      
      // 2단계: Google 로그인 페이지로 이동 (우회 경로 사용)
      this.log('🌐 Google 로그인 페이지 접근', 'info');
      await page.goto('https://accounts.google.com/signin/v2/identifier', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      await this.humanDelay(2000, 4000);
      
      // 3단계: 이메일 입력 (인간적 행동 패턴)
      this.log('📧 이메일 입력 중', 'info');
      await this.humanTypeEmail(page, email);
      
      // 4단계: Next 버튼 클릭
      await this.humanClickNext(page);
      
      // 5단계: 비밀번호 페이지 대기 및 입력
      this.log('🔒 비밀번호 입력 중', 'info');
      await this.humanTypePassword(page, password);
      
      // 6단계: 로그인 완료
      await this.humanClickNext(page);
      
      // 7단계: 추가 보안 검증 처리
      await this.handleSecurityChecks(page, { recoveryEmail, code });
      
      // 8단계: 로그인 성공 확인
      await this.humanDelay(3000, 5000);
      const loginResult = await this.detectLoginStatus(page);
      
      if (loginResult.isLoggedIn) {
        this.log('✅ 로그인 성공!', 'success');
        return { success: true, userEmail: loginResult.userEmail };
      } else {
        throw new Error('로그인 완료 후에도 로그인 상태가 확인되지 않음');
      }
      
    } catch (error) {
      this.log(`❌ 로그인 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 2025년 기준 고급 Stealth 적용
   */
  async applyAdvancedStealth(page) {
    this.log('🥷 고급 Stealth 모드 적용', 'debug');
    
    try {
      // User-Agent 및 기본 속성 설정은 AdsPower에서 처리
      
      // JavaScript 기반 감지 우회
      await page.evaluateOnNewDocument(() => {
        // Navigator.webdriver 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Chrome runtime 객체 추가
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
        
        // Permissions API 우회
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
        
        // Plugin 배열 확장
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            {
              0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin },
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              length: 1,
              name: "Chrome PDF Plugin"
            },
            {
              0: { type: "application/pdf", suffixes: "pdf", description: "", enabledPlugin: Plugin },
              description: "",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              length: 1,
              name: "Chrome PDF Viewer"
            }
          ]
        });
        
        // Languages 설정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });
      });
      
      // Request interception으로 헤더 수정
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const headers = Object.assign({}, request.headers(), {
          'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1'
        });
        
        request.continue({ headers });
      });
      
    } catch (error) {
      this.log(`Stealth 적용 오류: ${error.message}`, 'warning');
    }
  }

  /**
   * 인간적 이메일 입력
   */
  async humanTypeEmail(page, email) {
    try {
      // 이메일 입력 필드 대기
      await page.waitForSelector('input[type="email"], input[id="identifierId"]', {
        visible: true,
        timeout: 15000
      });
      
      const emailInput = await page.$('input[type="email"], input[id="identifierId"]');
      
      if (!emailInput) {
        throw new Error('이메일 입력 필드를 찾을 수 없음');
      }
      
      // 입력 필드 클릭
      await emailInput.click();
      await this.humanDelay(500, 1000);
      
      // 기존 내용 클리어
      await emailInput.click({ clickCount: 3 });
      await this.humanDelay(200, 500);
      
      // 인간적 타이핑
      await this.humanType(emailInput, email);
      
      await this.humanDelay(1000, 2000);
      
    } catch (error) {
      throw new Error(`이메일 입력 실패: ${error.message}`);
    }
  }

  /**
   * 인간적 비밀번호 입력
   */
  async humanTypePassword(page, password) {
    try {
      // 비밀번호 페이지 로딩 대기
      await page.waitForSelector('input[type="password"], input[name="password"]', {
        visible: true,
        timeout: 15000
      });
      
      await this.humanDelay(1000, 2000);
      
      const passwordInput = await page.$('input[type="password"], input[name="password"]');
      
      if (!passwordInput) {
        throw new Error('비밀번호 입력 필드를 찾을 수 없음');
      }
      
      // 입력 필드 클릭
      await passwordInput.click();
      await this.humanDelay(500, 1000);
      
      // 인간적 타이핑
      await this.humanType(passwordInput, password);
      
      await this.humanDelay(1000, 2000);
      
    } catch (error) {
      throw new Error(`비밀번호 입력 실패: ${error.message}`);
    }
  }

  /**
   * Next 버튼 인간적 클릭
   */
  async humanClickNext(page) {
    try {
      await this.humanDelay(1000, 2000);
      
      const nextSelectors = [
        '#identifierNext',
        '#passwordNext', 
        '[id="next"]',
        'button[type="submit"]',
        '[jsname="LgbsSe"]'
      ];
      
      let nextButton = null;
      for (const selector of nextSelectors) {
        nextButton = await page.$(selector);
        if (nextButton) {
          const isVisible = await nextButton.isIntersectingViewport();
          if (isVisible) break;
        }
      }
      
      if (!nextButton) {
        throw new Error('Next 버튼을 찾을 수 없음');
      }
      
      // 인간적 클릭
      await this.humanClick(nextButton);
      await this.humanDelay(2000, 4000);
      
    } catch (error) {
      throw new Error(`Next 버튼 클릭 실패: ${error.message}`);
    }
  }

  /**
   * 추가 보안 검증 처리
   */
  async handleSecurityChecks(page, options = {}) {
    this.log('🛡️ 보안 검증 확인 중', 'info');
    
    try {
      await this.humanDelay(3000, 5000);
      
      // 2단계 인증 확인
      const has2FA = await page.$('input[type="tel"], input[id="totpPin"]');
      if (has2FA && options.code) {
        this.log('📱 2단계 인증 코드 입력', 'info');
        await this.humanType(has2FA, options.code);
        await this.humanClickNext(page);
        return;
      }
      
      // 복구 이메일 확인
      const hasRecovery = await page.$('input[type="email"][placeholder*="recovery"]');
      if (hasRecovery && options.recoveryEmail) {
        this.log('📧 복구 이메일 입력', 'info');
        await this.humanType(hasRecovery, options.recoveryEmail);
        await this.humanClickNext(page);
        return;
      }
      
      // 전화번호 인증
      const hasPhone = await page.$('input[type="tel"]');
      if (hasPhone) {
        this.log('📞 전화번호 인증 필요 - 수동 처리 필요', 'warning');
        throw new Error('전화번호 인증이 필요합니다. 수동으로 처리해주세요.');
      }
      
      // CAPTCHA 확인
      const hasCaptcha = await page.$('.g-recaptcha, [data-sitekey]');
      if (hasCaptcha) {
        this.log('🤖 CAPTCHA 감지 - 수동 처리 필요', 'warning');
        throw new Error('CAPTCHA 인증이 필요합니다. 수동으로 처리해주세요.');
      }
      
    } catch (error) {
      if (error.message.includes('수동')) {
        throw error;
      }
      this.log(`보안 검증 처리 중 오류 (무시): ${error.message}`, 'debug');
    }
  }

  /**
   * 인간적 타이핑
   */
  async humanType(element, text) {
    for (const char of text) {
      await element.type(char);
      await this.humanDelay(50, 150);
    }
  }

  /**
   * 인간적 클릭
   */
  async humanClick(element) {
    await this.humanDelay(100, 300);
    await element.click();
  }

  /**
   * 인간적 딜레이
   */
  async humanDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const levels = {
      debug: '🔍',
      info: 'ℹ️',
      success: '✅', 
      warning: '⚠️',
      error: '❌'
    };
    
    const icon = levels[level] || 'ℹ️';
    this.logger.log(`[${timestamp}] ${icon} ${message}`);
  }
}

module.exports = GoogleLoginHelperAdvanced2025;