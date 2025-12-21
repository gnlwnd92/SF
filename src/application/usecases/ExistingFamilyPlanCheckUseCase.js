/**
 * 기존 가족 요금제 검증 UseCase
 * 
 * 워크플로우:
 * 1. '가족요금제기존' 탭에서 계정 목록 로드
 * 2. '애즈파워현황' 탭에서 AdsPower ID 매핑
 * 3. 한국 IP로 브라우저 실행 및 로그인 상태 확인
 * 4. 필요시 로그인 수행
 * 5. 브라우저 종료 후 미국 IP로 재실행
 * 6. YouTube Premium 가족 요금제 상태 확인
 * 7. Google Sheets E열(상태)에 결과 업데이트
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class ExistingFamilyPlanCheckUseCase {
  constructor({
    adsPowerAdapter,
    youtubeAdapter,
    profileRepository,
    logger,
    ipService,
    authService,
    navigationService,
    buttonService,
    sheetsRepository,
    proxyRotationService
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubeAdapter = youtubeAdapter;
    this.profileRepository = profileRepository;
    this.logger = logger || console;
    this.ipService = ipService;
    this.authService = authService;
    this.navigationService = navigationService;
    this.buttonService = buttonService;
    this.sheetsRepository = sheetsRepository;
    this.proxyRotationService = proxyRotationService;
    
    // 워크플로우 상태
    this.currentStep = null;
    this.currentProfile = null;
    this.koreanIP = null;
    this.usIP = null;
  }

  /**
   * 가족요금제기존 탭에서 계정 목록 로드
   */
  async loadExistingFamilyPlanAccounts() {
    try {
      console.log('[ExistingFamilyPlan] 가족요금제기존 탭에서 계정 로드 중...');
      
      // getExistingFamilyPlanWithMapping 메서드 사용 (AdsPower ID 매핑 포함)
      if (this.sheetsRepository && this.sheetsRepository.getExistingFamilyPlanWithMapping) {
        const accounts = await this.sheetsRepository.getExistingFamilyPlanWithMapping();
        console.log(`[ExistingFamilyPlan] ${accounts.length}개 계정 로드 완료`);
        
        // AdsPower ID가 없는 계정 경고
        const noMapping = accounts.filter(acc => !acc.adsPowerId);
        if (noMapping.length > 0) {
          console.log(`[ExistingFamilyPlan] ⚠️ ${noMapping.length}개 계정이 AdsPower ID 매핑이 없습니다`);
          noMapping.forEach(acc => {
            console.log(`  - ${acc.email || acc.googleId}`);
          });
        }
        
        return accounts;
      } 
      
      // Fallback: 매핑 없이 계정만 로드
      if (this.sheetsRepository && this.sheetsRepository.getExistingFamilyPlanAccounts) {
        console.log('[ExistingFamilyPlan] Fallback: 매핑 없이 계정 로드');
        const accounts = await this.sheetsRepository.getExistingFamilyPlanAccounts();
        return accounts.map(acc => ({
          ...acc,
          email: acc.googleId, // googleId를 email로 사용
          adsPowerId: null,
          hasMapping: false
        }));
      }
      
      // 메서드가 없으면 빈 배열 반환
      console.log('[ExistingFamilyPlan] ⚠️ Google Sheets 메서드를 찾을 수 없습니다');
      return [];
      
    } catch (error) {
      console.error('[ExistingFamilyPlan] 계정 로드 실패:', error);
      // 오류 발생시 빈 배열 반환
      return [];
    }
  }

  /**
   * 상태 업데이트
   */
  async updateStatus(email, statusText, details = {}) {
    try {
      await this.sheetsRepository.updateExistingFamilyPlanStatus(email, statusText, details);
    } catch (error) {
      console.error('[ExistingFamilyPlan] 상태 업데이트 실패:', error);
    }
  }

  /**
   * 메인 실행 메서드
   * @param {string} profileId - AdsPower 프로필 ID
   * @param {object} options - 추가 옵션 (email, password 등)
   */
  async execute(profileId, options = {}) {
    // 백워드 호환성: 첫 번째 파라미터가 객체인 경우 처리
    if (typeof profileId === 'object' && !options.email) {
      options = profileId;
      profileId = options.profileId;
    }
    
    const startTime = Date.now();
    const result = {
      profileId,
      email: options.email || null,
      success: false,
      loginStatus: null,
      familyPlanStatus: null,
      koreanIP: null,
      usIP: null,
      error: null,
      details: {},
      duration: 0
    };

    try {
      this.log(`🚀 기존 가족 요금제 검증 시작: ${profileId}`, 'info');
      
      // 프로필 정보 저장
      this.currentProfile = {
        id: profileId,
        email: options.email,
        password: options.password,
        recoveryEmail: options.recoveryEmail,
        totpSecret: options.totpSecret
      };
      
      // result에 email 확실히 설정
      result.email = options.email;
      result.profileId = profileId;
      
      // 디버깅용 로그
      this.log(`📧 전달받은 이메일: ${options.email}`, 'debug');
      this.log(`🆔 프로필 ID: ${profileId}`, 'debug');

      // Step 1: 한국 IP로 로그인 상태 확인
      this.log('📍 Step 1: 한국 IP로 브라우저 실행 및 로그인 확인', 'info');
      const loginCheckResult = await this.checkLoginWithKoreanIP();
      
      result.loginStatus = loginCheckResult.status;
      result.koreanIP = loginCheckResult.ip;
      result.details.loginCheck = loginCheckResult;
      
      if (loginCheckResult.status === 'login_failed') {
        throw new Error('로그인 실패');
      }
      
      // Step 2: 브라우저 종료
      this.log('🔄 브라우저 종료 중...', 'info');
      await this.closeBrowser();
      
      // 잠시 대기 (브라우저 완전 종료)
      await this.delay(3000);
      
      // Step 3: 미국 IP로 가족 요금제 상태 확인
      this.log('📍 Step 2: 미국 IP로 브라우저 실행 및 가족 요금제 확인', 'info');
      const familyCheckResult = await this.checkFamilyPlanWithUSIP();
      
      result.familyPlanStatus = familyCheckResult.status;
      result.usIP = familyCheckResult.ip;
      result.details.familyCheck = familyCheckResult;
      
      // Step 4: 결과 저장
      await this.updateSheetsStatus(result);
      
      result.success = true;
      this.log('✅ 가족 요금제 검증 완료', 'success');
      
    } catch (error) {
      result.error = error.message;
      result.success = false;
      this.log(`❌ 검증 실패: ${error.message}`, 'error');
      
      // 에러 시에도 상태 업데이트
      await this.updateSheetsStatus(result);
      
    } finally {
      // 브라우저 정리
      await this.closeBrowser();
      
      result.duration = Math.round((Date.now() - startTime) / 1000);
      this.log(`⏱️ 소요 시간: ${result.duration}초`, 'info');
    }
    
    return result;
  }

  /**
   * 한국 IP로 로그인 상태 확인
   */
  async checkLoginWithKoreanIP() {
    const result = {
      status: 'unknown',
      ip: null,
      loggedIn: false,
      needsLogin: false,
      loginSuccess: false,
      error: null
    };
    
    try {
      // 한국 프록시로 전환 (프로필 업데이트)
      this.log('🇰🇷 한국 IP로 전환 중...', 'info');
      if (this.proxyRotationService) {
        try {
          const proxyResult = await this.proxyRotationService.switchToKoreanProxy(this.currentProfile.id);
          if (proxyResult) {
            this.log('✅ 한국 프록시 설정 완료', 'success');
          } else {
            this.log('⚠️ 프록시 설정 반환값 false', 'warning');
          }
        } catch (proxyError) {
          this.log(`⚠️ 프록시 전환 실패, 현재 설정 사용: ${proxyError.message}`, 'warning');
        }
      } else {
        this.log('⚠️ ProxyRotationService가 없습니다', 'warning');
      }
      
      // 브라우저 실행 (profileId 문자열만 전달)
      this.log(`브라우저 실행 중... (프로필: ${this.currentProfile.id})`, 'info');
      const browserSession = await this.adsPowerAdapter.launchBrowser(this.currentProfile.id);
      
      if (!browserSession) {
        throw new Error('브라우저 세션 생성 실패');
      }
      
      // 브라우저와 페이지 가져오기
      this.browser = browserSession.browser;
      
      // 활성 페이지 가져오기
      const pages = await this.browser.pages();
      this.page = pages[pages.length - 1] || pages[0];
      
      if (!this.page) {
        throw new Error('페이지 가져오기 실패');
      }
      
      // IP 확인
      if (this.ipService) {
        result.ip = await this.ipService.getCurrentIP(this.page);
        this.koreanIP = result.ip;
        this.log(`📍 현재 IP: ${result.ip}`, 'info');
      }
      
      // YouTube로 이동
      this.log('YouTube로 이동 중...', 'info');
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await this.delay(3000);
      
      // 로그인 상태 확인
      const isLoggedIn = await this.checkIfLoggedIn();
      result.loggedIn = isLoggedIn;
      
      if (!isLoggedIn) {
        this.log('❗ 로그인이 필요합니다', 'warning');
        result.needsLogin = true;
        
        // 로그인 시도
        if (this.currentProfile.email && this.currentProfile.password) {
          this.log('🔐 로그인 시도 중...', 'info');
          const loginResult = await this.performLogin();
          
          if (loginResult.success) {
            result.loginSuccess = true;
            result.status = 'logged_in';
            this.log('✅ 로그인 성공', 'success');
          } else {
            result.status = 'login_failed';
            result.error = loginResult.error;
            this.log(`❌ 로그인 실패: ${loginResult.error}`, 'error');
          }
        } else {
          result.status = 'no_credentials';
          result.error = '로그인 정보 없음';
        }
      } else {
        result.status = 'already_logged_in';
        this.log('✅ 이미 로그인된 상태', 'success');
      }
      
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      this.log(`❌ 한국 IP 확인 중 오류: ${error.message}`, 'error');
    }
    
    return result;
  }

  /**
   * 미국 IP로 가족 요금제 상태 확인
   */
  async checkFamilyPlanWithUSIP() {
    const result = {
      status: 'unknown',
      ip: null,
      hasFamilyPlan: false,
      isManager: false,
      memberCount: 0,
      availableSlots: 0,
      members: [],
      error: null,
      details: {}
    };
    
    try {
      // 미국 프록시로 전환 (프로필 업데이트)
      this.log('🇺🇸 미국 IP로 전환 중...', 'info');
      if (this.proxyRotationService) {
        try {
          const proxyResult = await this.proxyRotationService.switchToUSProxy(this.currentProfile.id);
          if (proxyResult) {
            this.log('✅ 미국 프록시 설정 완료', 'success');
          } else {
            this.log('⚠️ 프록시 설정 반환값 false', 'warning');
          }
        } catch (proxyError) {
          this.log(`⚠️ 프록시 전환 실패, 현재 설정 사용: ${proxyError.message}`, 'warning');
        }
      } else {
        this.log('⚠️ ProxyRotationService가 없습니다', 'warning');
      }
      
      // 브라우저 실행 (profileId 문자열만 전달)
      this.log(`브라우저 실행 중... (프로필: ${this.currentProfile.id})`, 'info');
      const browserSession = await this.adsPowerAdapter.launchBrowser(this.currentProfile.id);
      
      if (!browserSession) {
        throw new Error('브라우저 세션 생성 실패');
      }
      
      // 브라우저와 페이지 가져오기
      this.browser = browserSession.browser;
      
      // 활성 페이지 가져오기
      const pages = await this.browser.pages();
      this.page = pages[pages.length - 1] || pages[0];
      
      if (!this.page) {
        throw new Error('페이지 가져오기 실패');
      }
      
      // IP 확인
      if (this.ipService) {
        result.ip = await this.ipService.getCurrentIP(this.page);
        this.usIP = result.ip;
        this.log(`📍 현재 IP: ${result.ip}`, 'info');
      }
      
      // YouTube Music 가족 요금제 페이지로 직접 이동
      this.log('YouTube Music 가족 요금제 페이지로 이동 중...', 'info');
      await this.page.goto('https://music.youtube.com/youtube_premium/family', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await this.delay(3000);
      
      // 가족 요금제 상태 확인 (Sign in 버튼 유무로 판단)
      const familyLinkFound = await this.checkFamilyPlanAccess();
      
      if (familyLinkFound) {
        await this.delay(3000);
        
        // 가족 요금제 상태 분석
        const familyStatus = await this.analyzeFamilyPlanStatus();
        
        result.hasFamilyPlan = familyStatus.hasFamilyPlan;
        result.isManager = familyStatus.isManager;
        result.memberCount = familyStatus.memberCount;
        result.availableSlots = familyStatus.availableSlots;
        result.members = familyStatus.members;
        result.details = familyStatus;
        
        if (familyStatus.hasFamilyPlan) {
          if (familyStatus.isManager) {
            result.status = 'family_manager';
            this.log('👑 가족 그룹 관리자입니다', 'success');
          } else {
            result.status = 'family_member';
            this.log('👨‍👩‍👧‍👦 가족 그룹 멤버입니다', 'success');
          }
          
          this.log(`📊 멤버 수: ${result.memberCount}/6`, 'info');
          this.log(`📊 사용 가능한 슬롯: ${result.availableSlots}`, 'info');
        } else {
          result.status = 'no_family_plan';
          this.log('❌ 가족 요금제가 없습니다', 'warning');
        }
      } else {
        result.status = 'family_link_not_found';
        this.log('⚠️ 가족 관리 링크를 찾을 수 없습니다', 'warning');
      }
      
      // 스크린샷 저장
      const screenshotPath = `./screenshots/family-check-${this.currentProfile.id}-${Date.now()}.png`;
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      result.screenshotPath = screenshotPath;
      
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      this.log(`❌ 미국 IP 확인 중 오류: ${error.message}`, 'error');
    }
    
    return result;
  }

  /**
   * 로그인 여부 확인
   */
  async checkIfLoggedIn() {
    try {
      // 로그인 버튼이 없으면 로그인된 상태
      const loginButton = await this.page.$('a[href*="accounts.google.com/ServiceLogin"]');
      if (!loginButton) {
        // 프로필 아이콘 확인
        const profileIcon = await this.page.$('button[id="avatar-btn"], img[id="img"][alt*="Avatar"]');
        return !!profileIcon;
      }
      return false;
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * 로그인 수행
   */
  async performLogin() {
    try {
      if (!this.authService) {
        throw new Error('AuthService가 초기화되지 않았습니다');
      }
      
      // Google 로그인 페이지로 이동
      await this.page.goto('https://accounts.google.com/ServiceLogin?service=youtube', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // 로그인 처리
      const loginResult = await this.authService.performLogin(
        this.page,
        {
          email: this.currentProfile.email,
          password: this.currentProfile.password,
          recoveryEmail: this.currentProfile.recoveryEmail,
          totpSecret: this.currentProfile.totpSecret
        }
      );
      
      return loginResult;
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 가족 요금제 접근 확인 (Sign in 버튼 클릭 후 로그인)
   */
  async checkFamilyPlanAccess() {
    try {
      // Sign in 버튼 찾기 (YouTube Music 페이지 우측 상단)
      const signInSelectors = [
        // YouTube Music 특정 선택자
        'tp-yt-paper-button[aria-label*="Sign in"]',
        'tp-yt-paper-button:has-text("Sign in")',
        'ytmusic-button-renderer[aria-label*="Sign in"]',
        'ytmusic-button-renderer a[aria-label*="Sign in"]',
        
        // 일반적인 선택자
        'button[aria-label*="Sign in"]',
        'a[aria-label*="Sign in"]',
        'button:has-text("Sign in")',
        'a:has-text("Sign in")',
        '[role="button"]:has-text("Sign in")',
        'yt-button-renderer:has-text("Sign in")',
        'a.yt-simple-endpoint:has-text("Sign in")',
        
        // 우측 상단 버튼을 위한 위치 기반 선택자
        '#buttons a[aria-label*="Sign in"]',
        '#end a[aria-label*="Sign in"]',
        '.ytmusic-nav-bar a[aria-label*="Sign in"]'
      ];
      
      let signInButton = null;
      let signInButtonFound = false;
      
      for (const selector of signInSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              signInButton = element;
              signInButtonFound = true;
              this.log('🔍 Sign in 버튼 발견 - 클릭하여 로그인 진행', 'info');
              break;
            }
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      // evaluate로도 Sign in 버튼 찾기 시도
      if (!signInButtonFound) {
        const signInFound = await this.page.evaluate(() => {
          // 모든 버튼과 링크 검색
          const elements = document.querySelectorAll('button, a, tp-yt-paper-button, ytmusic-button-renderer');
          for (const el of elements) {
            const text = el.textContent || el.innerText || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            
            if (text.includes('Sign in') || ariaLabel.includes('Sign in')) {
              // 우측 상단 위치 확인
              const rect = el.getBoundingClientRect();
              if (rect.right > window.innerWidth * 0.7 && rect.top < 100) {
                el.click();
                return true;
              }
            }
          }
          return false;
        });
        
        if (signInFound) {
          signInButtonFound = true;
          this.log('🔍 Sign in 버튼 발견 (evaluate) - 클릭 완료', 'info');
          await this.delay(3000);
        }
      }
      
      // Sign in 버튼이 있고 클릭이 필요한 경우
      if (signInButtonFound) {
        // signInButton이 있으면 클릭
        if (signInButton) {
          this.log('🖱️ Sign in 버튼 클릭 중...', 'info');
          
          try {
            // 버튼 클릭
            await signInButton.click();
            await this.delay(3000);
          } catch (clickError) {
            this.log(`⚠️ Sign in 버튼 클릭 실패: ${clickError.message}`, 'warning');
          }
        }
        
        // 로그인 페이지로 이동했는지 확인
        const currentUrl = this.page.url();
        this.log(`📍 현재 URL: ${currentUrl}`, 'debug');
        
        // 로그인이 필요한 경우 로그인 수행
        if (currentUrl.includes('accounts.google.com')) {
          this.log('🔐 Google 로그인 페이지 감지 - 로그인 시도', 'info');
          
          if (this.currentProfile.email && this.currentProfile.password) {
            const loginResult = await this.performLogin();
            
            if (!loginResult.success) {
              this.log(`❌ 로그인 실패: ${loginResult.error}`, 'error');
              return false;
            }
            
            this.log('✅ 로그인 성공', 'success');
            
            // 로그인 후 가족 요금제 페이지로 다시 이동
            await this.page.goto('https://music.youtube.com/youtube_premium/family', {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            
            await this.delay(3000);
          } else {
            this.log('❌ 로그인 정보가 없습니다', 'error');
            return false;
          }
        }
      }
      
      // 스크린샷 저장 (디버깅용)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `./screenshots/family-check-${timestamp}.png`;
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      this.log(`📸 스크린샷 저장: ${screenshotPath}`, 'info');
      
      // 로그인 후 가족요금제 관련 요소 찾기
      if (true) {  // 항상 체크
        // 가족 요금제 관련 요소 확인
        const familyElements = await this.page.evaluate(() => {
          const texts = document.body.innerText;
          const textsLower = texts.toLowerCase();
          
          // 가족요금제가 없음을 나타내는 텍스트
          const noFamilyIndicators = {
            hasSubscribeButton: texts.includes('YouTube Premium 가입') ||
                               texts.includes('Get YouTube Premium') ||
                               texts.includes('Premium 체험하기'),
            hasTrialOffer: texts.includes('1억 2,500만 명') ||
                          texts.includes('무료 체험') ||
                          texts.includes('Free trial'),
            hasPricing: texts.includes('₩') && texts.includes('2,500') ||
                       texts.includes('US$') && texts.includes('22.99')
          };
          
          // 가족요금제가 있음을 나타내는 텍스트
          const hasFamilyIndicators = {
            hasFamily: textsLower.includes('family group') || 
                      textsLower.includes('family plan') ||
                      texts.includes('가족 그룹') ||
                      texts.includes('家族グループ'),
            hasManage: textsLower.includes('manage family') || 
                      texts.includes('가족 관리') ||
                      texts.includes('管理家族'),
            hasMembers: textsLower.includes('family members') || 
                       texts.includes('가족 구성원') ||
                       texts.includes('家族メンバー'),
            hasInvite: textsLower.includes('invite family') ||
                      texts.includes('가족 초대') ||
                      texts.includes('家族を招待')
          };
          
          return {
            noFamily: noFamilyIndicators,
            hasFamily: hasFamilyIndicators
          };
        });
        
        // 가족요금제가 없음을 나타내는 지표가 있는지 확인
        const noFamilyFound = Object.values(familyElements.noFamily).some(v => v === true);
        const hasFamilyFound = Object.values(familyElements.hasFamily).some(v => v === true);
        
        if (noFamilyFound && !hasFamilyFound) {
          this.log('❌ 가족요금제 없음 - Premium 가입 페이지', 'info');
          return false;
        } else if (hasFamilyFound) {
          this.log('✅ 가족요금제 페이지 접근 성공', 'success');
          return true;
        } else {
          // 가족요금제 요소가 없는 경우
          this.log('❌ 가족요금제 관련 요소를 찾을 수 없음', 'info');
          return false;
        }
      }
      
      // 기본적으로 false 반환
      this.log('⚠️ 페이지 상태를 확인할 수 없습니다', 'warning');
      return false;
      
    } catch (error) {
      this.log(`가족요금제 접근 확인 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * 가족 관리 링크 클릭 (레거시 - 백업용)
   */
  async clickFamilyManageLink() {
    try {
      // 여러 언어의 가족 관리 링크 선택자
      const selectors = [
        'a[href*="families.google.com"]',
        'a[href*="/family"]',
        'button:has-text("Manage family")',
        'button:has-text("가족 관리")',
        'button:has-text("家族を管理")',
        'a:has-text("Family sharing")',
        'a:has-text("가족 공유")'
      ];
      
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            await this.delay(2000);
            return true;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }
      
      // 텍스트로 찾기
      const found = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button'));
        for (const link of links) {
          const text = link.textContent.toLowerCase();
          if (text.includes('family') || text.includes('가족') || text.includes('famille')) {
            link.click();
            return true;
          }
        }
        return false;
      });
      
      return found;
      
    } catch (error) {
      this.log(`가족 관리 링크 클릭 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * 가족 요금제 상태 분석
   */
  async analyzeFamilyPlanStatus() {
    const status = {
      hasFamilyPlan: false,
      isManager: false,
      memberCount: 0,
      availableSlots: 0,
      members: [],
      planType: null,
      expirationDate: null
    };
    
    try {
      // 페이지 내용 분석
      const pageContent = await this.page.content();
      const pageText = await this.page.evaluate(() => document.body.innerText);
      
      // 가족 요금제 존재 여부 확인
      const familyIndicators = [
        'YouTube Premium Family',
        'YouTube Premium 가족',
        'Family group',
        '가족 그룹',
        'family members',
        '가족 구성원'
      ];
      
      for (const indicator of familyIndicators) {
        if (pageText.toLowerCase().includes(indicator.toLowerCase())) {
          status.hasFamilyPlan = true;
          break;
        }
      }
      
      if (!status.hasFamilyPlan) {
        return status;
      }
      
      // 관리자 여부 확인
      const managerIndicators = [
        'Family manager',
        '가족 관리자',
        'You\'re the family manager',
        '가족 그룹을 관리',
        'Invite family members',
        '가족 구성원 초대'
      ];
      
      for (const indicator of managerIndicators) {
        if (pageText.includes(indicator)) {
          status.isManager = true;
          break;
        }
      }
      
      // 멤버 수 파싱
      const memberCountMatch = pageText.match(/(\d+)\s*(?:of|\/)\s*6\s*(?:members|멤버|구성원)/i);
      if (memberCountMatch) {
        status.memberCount = parseInt(memberCountMatch[1]);
        status.availableSlots = 6 - status.memberCount;
      }
      
      // 멤버 목록 추출
      const memberElements = await this.page.$$('div[role="listitem"], div.member-item, div[class*="member"]');
      for (const element of memberElements) {
        const memberInfo = await element.evaluate(el => {
          const emailEl = el.querySelector('span[class*="email"], div[class*="email"]');
          const nameEl = el.querySelector('span[class*="name"], div[class*="name"]');
          return {
            email: emailEl ? emailEl.textContent.trim() : null,
            name: nameEl ? nameEl.textContent.trim() : null
          };
        });
        
        if (memberInfo.email || memberInfo.name) {
          status.members.push(memberInfo);
        }
      }
      
      // 만료일 확인
      const expirationMatch = pageText.match(/(?:expires?|만료|有効期限)\s*:?\s*([^\\n]+)/i);
      if (expirationMatch) {
        status.expirationDate = expirationMatch[1].trim();
      }
      
    } catch (error) {
      this.log(`가족 요금제 상태 분석 실패: ${error.message}`, 'warning');
    }
    
    return status;
  }

  /**
   * Google Sheets 상태 업데이트
   */
  async updateSheetsStatus(result) {
    try {
      if (!this.sheetsRepository) {
        this.log('Sheets 레포지토리가 초기화되지 않았습니다', 'warning');
        return;
      }
      
      // 상태 문자열 생성 (간단하고 명확하게)
      let statusText = '';
      
      // 가족 요금제 상태를 우선적으로 표시
      if (result.familyPlanStatus === 'family_manager') {
        statusText = '✅ 가족요금제 활성 (관리자)';
      } else if (result.familyPlanStatus === 'family_member') {
        statusText = '✅ 가족요금제 활성 (구성원)';
      } else if (result.familyPlanStatus === 'no_family_plan') {
        statusText = '❌ 가족요금제 없음';
      } else if (result.familyPlanStatus === 'family_link_not_found') {
        statusText = '❌ 가족요금제 없음';
      } else if (result.error) {
        // 에러 메시지 간단히 처리
        if (result.error.includes('Navigation timeout')) {
          statusText = '⚠️ 연결 시간 초과';
        } else if (result.error.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
          statusText = '⚠️ 프록시 연결 실패';
        } else {
          statusText = '⚠️ 확인 실패';
        }
      } else {
        statusText = '⚠️ 상태 확인 불가';
      }
      
      // 타임스탬프 추가
      const timestamp = new Date().toLocaleString('ko-KR');
      statusText += ` | ${timestamp}`;
      
      // 이메일 확인 (profileId는 절대 이메일로 사용하지 않음)
      const emailToUpdate = result.email || this.currentProfile?.email;
      
      if (!emailToUpdate) {
        this.log(`⚠️ 업데이트할 이메일을 찾을 수 없습니다 (profileId: ${this.currentProfile?.id})`, 'warning');
        this.log('이메일이 제대로 전달되지 않았습니다. options에서 email 파라미터를 확인하세요.', 'error');
        return;
      }
      
      // Google Sheets 업데이트
      await this.sheetsRepository.updateExistingFamilyPlanStatus(
        emailToUpdate,
        statusText,
        {
          loginStatus: result.loginStatus,
          familyPlanStatus: result.familyPlanStatus,
          memberCount: result.details?.familyCheck?.memberCount,
          availableSlots: result.details?.familyCheck?.availableSlots,
          koreanIP: result.koreanIP,
          usIP: result.usIP,
          lastChecked: timestamp
        }
      );
      
      this.log(`📝 Google Sheets 업데이트 완료 (${emailToUpdate}): ${statusText}`, 'success');
      
    } catch (error) {
      this.log(`❌ Sheets 업데이트 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser() {
    try {
      if (this.currentProfile && this.currentProfile.id) {
        await this.adsPowerAdapter.closeBrowser(this.currentProfile.id);
        this.log('브라우저 종료 완료', 'info');
      }
    } catch (error) {
      this.log(`브라우저 종료 실패: ${error.message}`, 'warning');
    }
    
    this.page = null;
    this.browser = null;
  }

  /**
   * 지연 함수
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[ExistingFamilyCheck]`;
    
    switch (level) {
      case 'success':
        console.log(chalk.green(`${prefix} ${message}`));
        break;
      case 'error':
        console.error(chalk.red(`${prefix} ${message}`));
        break;
      case 'warning':
        console.warn(chalk.yellow(`${prefix} ${message}`));
        break;
      case 'info':
      default:
        console.log(chalk.cyan(`${prefix} ${message}`));
        break;
    }
    
    if (this.logger && this.logger !== console) {
      // logger가 존재하고 log 메서드가 있는 경우에만 호출
      if (typeof this.logger.log === 'function') {
        this.logger.log(level, `${prefix} ${message}`, { timestamp });
      } else if (typeof this.logger.info === 'function') {
        // log 메서드가 없으면 level별 메서드 사용
        switch (level) {
          case 'error':
            this.logger.error && this.logger.error(`${prefix} ${message}`);
            break;
          case 'warning':
            this.logger.warn && this.logger.warn(`${prefix} ${message}`);
            break;
          default:
            this.logger.info && this.logger.info(`${prefix} ${message}`);
            break;
        }
      }
    }
  }
}

module.exports = ExistingFamilyPlanCheckUseCase;