/**
 * AuthenticationService - 인증 및 로그인 관리 서비스
 * 
 * Google/YouTube 로그인 상태 확인, reCAPTCHA 처리, 세션 관리
 * 5가지 검증 방법을 통한 강력한 로그인 상태 확인
 */

const chalk = require('chalk');
const crypto = require('crypto');
const speakeasy = require('speakeasy');

class AuthenticationService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      loginCheckTimeout: config.loginCheckTimeout || 30000, // 30초로 증가
      recaptchaTimeout: config.recaptchaTimeout || 60000, // 60초로 증가
      sessionTimeout: config.sessionTimeout || 3600000, // 1시간
      maxLoginAttempts: config.maxLoginAttempts || 3,
      evaluateTimeout: config.evaluateTimeout || 30000, // evaluate 타임아웃 추가
      ...config
    };
    
    // 세션 관리
    this.sessions = new Map();
    
    // 로그인 상태 캐시
    this.loginCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5분
  }

  /**
   * 이메일 정규화 (대소문자 통일)
   */
  normalizeEmail(email) {
    if (!email) return '';
    // Gmail은 대소문자를 구분하지 않으므로 소문자로 통일
    return email.toLowerCase().trim();
  }

  /**
   * Base32 디코드 (TOTP 시크릿 키용)
   */
  base32Decode(secret) {
    if (!secret) return null;
    
    try {
      // speakeasy가 자동으로 base32 디코딩을 처리하지만
      // 명시적으로 base32 포맷임을 확인
      const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
      
      // base32 유효성 검사
      if (!/^[A-Z2-7]+=*$/.test(cleanSecret)) {
        throw new Error('Invalid base32 format');
      }
      
      return cleanSecret;
    } catch (error) {
      this.log(`Base32 디코드 실패: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * TOTP 코드 생성
   */
  generateTOTP(secret) {
    if (!secret) {
      throw new Error('TOTP 시크릿이 필요합니다');
    }

    try {
      const decodedSecret = this.base32Decode(secret);
      if (!decodedSecret) {
        throw new Error('시크릿 디코드 실패');
      }

      const token = speakeasy.totp({
        secret: decodedSecret,
        encoding: 'base32',
        algorithm: 'sha1',
        digits: 6,
        step: 30 // 30초 간격
      });

      return token;
    } catch (error) {
      this.log(`TOTP 생성 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * TOTP 검증
   */
  verifyTOTP(secret, token) {
    if (!secret || !token) {
      return false;
    }

    try {
      const decodedSecret = this.base32Decode(secret);
      if (!decodedSecret) {
        return false;
      }

      const verified = speakeasy.totp.verify({
        secret: decodedSecret,
        encoding: 'base32',
        token: token,
        algorithm: 'sha1',
        digits: 6,
        step: 30,
        window: 2 // 전후 2개 윈도우 허용 (시간 동기화 문제 대응)
      });

      return verified;
    } catch (error) {
      this.log(`TOTP 검증 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 종합적인 로그인 상태 확인 (5가지 방법)
   */
  async checkLoginStatus(page, options = {}) {
    const startTime = Date.now();
    const profileId = options.profileId || 'default';
    
    // 캐시 확인
    const cached = this.getCachedLoginStatus(profileId);
    if (cached && !options.forceCheck) {
      this.log('캐시된 로그인 상태 사용', 'debug');
      return cached;
    }
    
    this.log('로그인 상태 확인 중...', 'info');
    
    try {
      // 병렬로 5가지 검증 수행
      const [
        avatarCheck,
        signInCheck,
        premiumCheck,
        cookieCheck,
        domCheck
      ] = await Promise.all([
        this.checkAvatarPresence(page),
        this.checkSignInLinks(page),
        this.checkPremiumContent(page),
        this.checkAuthCookies(page),
        this.checkDOMElements(page)
      ]);
      
      // 종합 점수 계산
      const score = this.calculateLoginScore({
        avatarCheck,
        signInCheck,
        premiumCheck,
        cookieCheck,
        domCheck
      });
      
      const isLoggedIn = score >= 3; // 5개 중 3개 이상 통과
      
      const result = {
        isLoggedIn,
        score,
        methods: {
          hasAvatar: avatarCheck.found,
          noSignInLink: !signInCheck.found,
          hasPremiumContent: premiumCheck.found,
          hasAuthCookies: cookieCheck.valid,
          hasUserElements: domCheck.found
        },
        confidence: this.getConfidenceLevel(score),
        checkTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      // 캐시 저장
      this.setCachedLoginStatus(profileId, result);
      
      // 로그 출력
      if (isLoggedIn) {
        this.log(`✅ 로그인 확인 (신뢰도: ${result.confidence})`, 'success');
      } else {
        this.log(`❌ 로그인 안됨 (점수: ${score}/5)`, 'warning');
      }
      
      return result;
      
    } catch (error) {
      this.log(`로그인 확인 실패: ${error.message}`, 'error');
      return {
        isLoggedIn: false,
        error: error.message,
        checkTime: Date.now() - startTime
      };
    }
  }

  /**
   * 방법 1: 아바타 이미지 확인
   */
  async checkAvatarPresence(page) {
    try {
      const avatarSelectors = [
        'img[alt*="Avatar"]',
        'img[alt*="avatar"]',
        'img#avatar',
        'button#avatar-btn img',
        'yt-img-shadow#avatar img',
        '[aria-label*="계정"] img',
        '[aria-label*="Account"] img'
      ];
      
      for (const selector of avatarSelectors) {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            return { found: true, selector };
          }
        }
      }
      
      return { found: false };
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /**
   * 방법 2: 로그인 링크 부재 확인
   */
  async checkSignInLinks(page) {
    try {
      const signInSelectors = [
        'a[aria-label*="Sign in"]',
        'a[aria-label*="로그인"]',
        'yt-formatted-string:has-text("Sign in")',
        'yt-formatted-string:has-text("로그인")',
        'paper-button[aria-label*="Sign in"]',
        'tp-yt-paper-button:has-text("SIGN IN")'
      ];
      
      for (const selector of signInSelectors) {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            return { found: true, selector };
          }
        }
      }
      
      return { found: false };
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /**
   * 방법 3: Premium 컨텐츠 확인
   */
  async checkPremiumContent(page) {
    try {
      const premiumSelectors = [
        '[aria-label*="Manage membership"]',
        '[aria-label*="멤버십 관리"]',
        'yt-formatted-string:has-text("YouTube Premium")',
        'yt-formatted-string:has-text("Manage membership")',
        'button:has-text("Pause")',
        'button:has-text("Resume")'
      ];
      
      for (const selector of premiumSelectors) {
        const element = await page.$(selector);
        if (element) {
          return { found: true, selector };
        }
      }
      
      // 페이지 텍스트 확인
      const pageText = await page.textContent('body').catch(() => '');
      const premiumKeywords = [
        'YouTube Premium',
        'Manage membership',
        '멤버십 관리',
        'Next billing date',
        '다음 결제일'
      ];
      
      for (const keyword of premiumKeywords) {
        if (pageText.includes(keyword)) {
          return { found: true, keyword };
        }
      }
      
      return { found: false };
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /**
   * 방법 4: 인증 쿠키 확인
   */
  async checkAuthCookies(page) {
    try {
      const cookies = await page.context().cookies();
      
      // 주요 Google 인증 쿠키
      const authCookies = [
        'SID',
        'HSID',
        'SSID',
        'APISID',
        'SAPISID',
        'LOGIN_INFO'
      ];
      
      const foundCookies = cookies.filter(cookie => 
        authCookies.some(authCookie => 
          cookie.name.includes(authCookie)
        )
      );
      
      return {
        valid: foundCookies.length >= 2, // 최소 2개 이상
        count: foundCookies.length,
        cookies: foundCookies.map(c => c.name)
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * 방법 5: DOM 요소 종합 확인
   */
  async checkDOMElements(page) {
    try {
      const result = await page.evaluate(() => {
        const checks = {
          hasAccountButton: false,
          hasChannelSelector: false,
          hasNotificationBell: false,
          hasCreateButton: false
        };
        
        // 계정 버튼
        const accountBtn = document.querySelector('button#avatar-btn, [aria-label*="Account"]');
        checks.hasAccountButton = !!accountBtn;
        
        // 채널 선택자
        const channelSelector = document.querySelector('yt-formatted-string#channel-title');
        checks.hasChannelSelector = !!channelSelector;
        
        // 알림 벨
        const notificationBell = document.querySelector('[aria-label*="Notifications"]');
        checks.hasNotificationBell = !!notificationBell;
        
        // 만들기 버튼
        const createButton = document.querySelector('[aria-label*="Create"], [aria-label*="업로드"]');
        checks.hasCreateButton = !!createButton;
        
        // 최소 2개 이상 있으면 로그인으로 판단
        const foundCount = Object.values(checks).filter(v => v).length;
        
        return {
          found: foundCount >= 2,
          foundCount,
          checks
        };
      });
      
      return result;
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /**
   * 계정 잠김 상태 확인
   */
  async checkAccountLocked(page) {
    try {
      const url = page.url();
      const title = await page.title();
      const content = await page.textContent('body').catch(() => '');
      
      // URL에서 계정 거부/잠김 확인
      const lockedUrls = [
        '/signin/rejected',
        '/signin/disabled',
        '/AccountDisabled',
        '/signin/v3/challenge/recaptcha'
      ];
      
      const isLockedUrl = lockedUrls.some(pattern => url.includes(pattern));
      
      // 페이지 제목에서 확인
      const lockedTitles = [
        '계정 사용 중지됨',
        'Account disabled',
        'Account has been disabled',
        '계정이 잠겼습니다',
        'Your account has been locked'
      ];
      
      const isLockedTitle = lockedTitles.some(title => 
        title.toLowerCase().includes(title.toLowerCase())
      );
      
      // 페이지 내용에서 확인
      const lockedKeywords = [
        '계정 사용 중지됨',
        'Account disabled',
        '평소와 다른 활동이 감지',
        'unusual activity',
        '정보 보호를 위해 계정이 잠겼습니다',
        'your account has been locked',
        '복구 시도',
        'Try to recover',
        'account recovery'
      ];
      
      const isLockedContent = lockedKeywords.some(keyword => 
        content.includes(keyword)
      );
      
      const isLocked = isLockedUrl || isLockedTitle || isLockedContent;
      
      if (isLocked) {
        this.log('🔒 계정 잠김 상태 감지됨', 'warning');
        return {
          isLocked: true,
          reason: isLockedUrl ? 'URL 패턴' : isLockedTitle ? '페이지 제목' : '페이지 내용',
          url,
          title
        };
      }
      
      return { isLocked: false };
    } catch (error) {
      this.log(`계정 잠김 확인 실패: ${error.message}`, 'error');
      return { isLocked: false, error: error.message };
    }
  }

  /**
   * 로그인 점수 계산
   */
  calculateLoginScore(checks) {
    let score = 0;
    
    if (checks.avatarCheck?.found) score++;
    if (!checks.signInCheck?.found) score++; // 로그인 링크가 없으면 점수
    if (checks.premiumCheck?.found) score++;
    if (checks.cookieCheck?.valid) score++;
    if (checks.domCheck?.found) score++;
    
    return score;
  }

  /**
   * 신뢰도 레벨 계산
   */
  getConfidenceLevel(score) {
    if (score === 5) return '매우 높음';
    if (score === 4) return '높음';
    if (score === 3) return '보통';
    if (score === 2) return '낮음';
    return '매우 낮음';
  }

  /**
   * reCAPTCHA 감지 및 처리
   */
  async handleReCaptcha(page, options = {}) {
    this.log('reCAPTCHA 확인 중...', 'info');
    
    try {
      // reCAPTCHA iframe 확인
      const recaptchaFrame = await page.$('iframe[src*="recaptcha"]');
      
      if (!recaptchaFrame) {
        return {
          detected: false,
          handled: false
        };
      }
      
      this.log('⚠️ reCAPTCHA 감지됨', 'warning');
      
      // 자동 해결 불가능 - 사용자 개입 필요
      if (options.waitForUser) {
        this.log('사용자의 reCAPTCHA 해결을 기다리는 중...', 'info');
        
        // reCAPTCHA가 사라질 때까지 대기
        await page.waitForSelector('iframe[src*="recaptcha"]', {
          state: 'hidden',
          timeout: this.config.recaptchaTimeout
        }).catch(() => null);
        
        const stillPresent = await page.$('iframe[src*="recaptcha"]');
        
        return {
          detected: true,
          handled: !stillPresent,
          method: 'user_intervention'
        };
      }
      
      return {
        detected: true,
        handled: false,
        requiresUserIntervention: true
      };
      
    } catch (error) {
      this.log(`reCAPTCHA 처리 오류: ${error.message}`, 'error');
      return {
        detected: false,
        handled: false,
        error: error.message
      };
    }
  }

  /**
   * 현재 페이지 타입 감지
   */
  async detectCurrentPageType(page) {
    try {
      const url = page.url();
      const content = await page.textContent('body').catch(() => '');
      const title = await page.title().catch(() => '');

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
      const hasEmailInput = await page.$('input[type="email"]').catch(() => null);
      if (hasEmailInput) {
        return { type: 'email_input', url, content };
      }

      // 3. 비밀번호 입력 페이지
      const hasPasswordInput = await page.$('input[type="password"]').catch(() => null);
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
      this.log(`페이지 타입 감지 오류: ${error.message}`, 'error');
      return { type: 'error', error: error.message };
    }
  }

  /**
   * 본인 인증 중간 페이지 감지 및 처리
   * "다음" 클릭 후 자동으로 다음 페이지 감지 및 처리
   */
  async handleIdentityConfirmation(page) {
    try {
      // 현재 페이지 타입 감지
      const pageType = await this.detectCurrentPageType(page);

      if (pageType.type !== 'identity_confirmation') {
        return { detected: false, pageType: pageType.type };
      }

      this.log('🔐 본인 인증 중간 페이지 감지 - "다음" 버튼 클릭 시도', 'info');

      // "다음" 버튼 찾기 및 클릭 (page.evaluate 사용으로 더 안정적)
      const clicked = await page.evaluate(() => {
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
        this.log('⚠️ 본인 인증 페이지의 "다음" 버튼을 찾을 수 없음', 'warning');
        return { detected: true, handled: false };
      }

      this.log(`✅ "다음" 버튼 클릭 성공: ${clicked.text}`, 'success');

      // 페이지 전환 대기
      await new Promise(r => setTimeout(r, 2000));

      // 다음 페이지 타입 감지
      const nextPageType = await this.detectCurrentPageType(page);
      this.log(`📄 다음 페이지 타입: ${nextPageType.type}`, 'info');

      return {
        detected: true,
        handled: true,
        nextPageType: nextPageType.type
      };

    } catch (error) {
      this.log(`본인 인증 처리 오류: ${error.message}`, 'error');
      return {
        detected: false,
        handled: false,
        error: error.message
      };
    }
  }

  /**
   * 로그인 수행 (개선된 버전 - 각 단계마다 본인 인증 체크)
   */
  async performLogin(page, credentials, options = {}) {
    if (!credentials || !credentials.email) {
      throw new Error('자격 증명이 필요합니다');
    }

    this.log('로그인 시도 중...', 'info');

    try {
      // Google 로그인 페이지로 이동
      await page.goto('https://accounts.google.com', {
        waitUntil: 'domcontentloaded'
      });

      await new Promise(r => setTimeout(r, 2000)); // 페이지 로딩 대기

      // ========== 단계 1: 시작 시점 본인 인증 체크 ==========
      let identityCheck = await this.handleIdentityConfirmation(page);
      if (identityCheck.detected && !identityCheck.handled) {
        throw new Error('본인 인증 페이지를 처리할 수 없습니다');
      }

      // 현재 페이지 타입 확인
      let currentPageType = await this.detectCurrentPageType(page);
      this.log(`📄 현재 페이지 타입: ${currentPageType.type}`, 'debug');

      // ========== 단계 2: 이메일 입력 ==========
      if (currentPageType.type === 'email_input' || currentPageType.type === 'unknown') {
        this.log('📧 이메일 입력 단계', 'info');

        // 이메일 입력 필드 대기
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 10000 });

        // 기존 내용 삭제 후 이메일 입력
        await page.click('input[type="email"]', { clickCount: 3 });
        await page.type('input[type="email"]', credentials.email);

        // "다음" 버튼 클릭
        await page.click('#identifierNext').catch(async () => {
          // 폴백: 버튼 텍스트로 찾기
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const nextBtn = buttons.find(btn => btn.textContent?.includes('Next') || btn.textContent?.includes('다음'));
            if (nextBtn) nextBtn.click();
          });
        });

        await new Promise(r => setTimeout(r, 2000));

        // 이메일 입력 후 본인 인증 페이지가 나올 수 있음
        identityCheck = await this.handleIdentityConfirmation(page);
        if (identityCheck.detected && !identityCheck.handled) {
          throw new Error('이메일 입력 후 본인 인증 페이지를 처리할 수 없습니다');
        }
      }

      // ========== 단계 3: 비밀번호 입력 ==========
      // 현재 페이지 재확인
      currentPageType = await this.detectCurrentPageType(page);
      this.log(`📄 현재 페이지 타입: ${currentPageType.type}`, 'debug');

      if (currentPageType.type === 'password_input' || currentPageType.type === 'unknown') {
        this.log('🔑 비밀번호 입력 단계', 'info');

        // 패스워드 입력 대기
        await page.waitForSelector('input[type="password"]', {
          timeout: 10000,
          visible: true
        });

        // 기존 내용 삭제 후 패스워드 입력
        await page.click('input[type="password"]', { clickCount: 3 });
        await page.type('input[type="password"]', credentials.password);

        // "다음" 버튼 클릭
        await page.click('#passwordNext').catch(async () => {
          // 폴백: 버튼 텍스트로 찾기
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const nextBtn = buttons.find(btn => btn.textContent?.includes('Next') || btn.textContent?.includes('다음'));
            if (nextBtn) nextBtn.click();
          });
        });

        await new Promise(r => setTimeout(r, 2000));

        // 비밀번호 입력 후에도 본인 인증 페이지가 나올 수 있음
        identityCheck = await this.handleIdentityConfirmation(page);
        if (identityCheck.detected && !identityCheck.handled) {
          throw new Error('비밀번호 입력 후 본인 인증 페이지를 처리할 수 없습니다');
        }
      }

      // ========== 단계 4: 로그인 완료 대기 ==========
      this.log('⏳ 로그인 완료 대기 중...', 'info');

      await Promise.race([
        page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 15000
        }).catch(() => {}),
        page.waitForSelector('[aria-label*="Google Account"]', {
          timeout: 15000
        }).catch(() => {}),
        page.waitForFunction(
          () => window.location.hostname !== 'accounts.google.com',
          { timeout: 15000 }
        ).catch(() => {})
      ]);

      await new Promise(r => setTimeout(r, 2000));

      // ========== 단계 5: 로그인 상태 확인 ==========
      const loginStatus = await this.checkLoginStatus(page, {
        forceCheck: true
      });

      if (loginStatus.isLoggedIn) {
        this.log('✅ 로그인 성공', 'success');

        // 세션 저장
        this.saveSession(credentials.email, {
          loginTime: new Date().toISOString(),
          profileId: options.profileId
        });
      } else {
        // 최종 페이지 타입 확인
        const finalPageType = await this.detectCurrentPageType(page);
        this.log(`⚠️ 로그인 미완료 - 현재 페이지: ${finalPageType.type}`, 'warning');

        if (finalPageType.type === '2fa') {
          throw new Error('2단계 인증이 필요합니다. 수동으로 완료해주세요.');
        }
      }

      return loginStatus;

    } catch (error) {
      this.log(`로그인 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 로그아웃 수행
   */
  async logout(page) {
    this.log('로그아웃 중...', 'info');
    
    try {
      // YouTube 로그아웃 URL
      await page.goto('https://www.youtube.com/logout', {
        waitUntil: 'domcontentloaded'
      });
      
      // 로그아웃 확인
      await new Promise(r => setTimeout(r, 2000));
      
      // 캐시 초기화
      this.loginCache.clear();
      this.sessions.clear();
      
      this.log('✅ 로그아웃 완료', 'success');
      
      return {
        success: true,
        loggedOut: true
      };
      
    } catch (error) {
      this.log(`로그아웃 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 세션 검증
   */
  async validateSession(page, sessionId) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        valid: false,
        reason: 'Session not found'
      };
    }
    
    // 세션 만료 확인
    const sessionAge = Date.now() - new Date(session.loginTime).getTime();
    if (sessionAge > this.config.sessionTimeout) {
      this.sessions.delete(sessionId);
      return {
        valid: false,
        reason: 'Session expired'
      };
    }
    
    // 실제 로그인 상태 확인
    const loginStatus = await this.checkLoginStatus(page);
    
    if (!loginStatus.isLoggedIn) {
      this.sessions.delete(sessionId);
      return {
        valid: false,
        reason: 'Not logged in'
      };
    }
    
    return {
      valid: true,
      session,
      remainingTime: this.config.sessionTimeout - sessionAge
    };
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
   * 캐시된 로그인 상태 가져오기
   */
  getCachedLoginStatus(profileId) {
    const cached = this.loginCache.get(profileId);
    
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTimeout) {
      this.loginCache.delete(profileId);
      return null;
    }
    
    return cached.data;
  }

  /**
   * 로그인 상태 캐시 저장
   */
  setCachedLoginStatus(profileId, status) {
    this.loginCache.set(profileId, {
      data: status,
      timestamp: Date.now()
    });
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.loginCache.clear();
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
    console.log(chalk[color](`[AuthService] ${message}`));
  }

  /**
   * 서비스 상태 확인
   */
  getStatus() {
    return {
      service: 'AuthenticationService',
      ready: true,
      sessionsActive: this.sessions.size,
      cacheSize: this.loginCache.size,
      config: {
        debugMode: this.config.debugMode,
        sessionTimeout: this.config.sessionTimeout,
        maxLoginAttempts: this.config.maxLoginAttempts
      }
    };
  }
}

module.exports = AuthenticationService;