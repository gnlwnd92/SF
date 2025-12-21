/**
 * BaseWorkflow - 모든 YouTube Premium 워크플로우의 베이스 클래스
 * 
 * 공통 기능:
 * - 브라우저 연결/해제
 * - 페이지 이동
 * - 로그인 처리
 * - 언어 감지
 * - 로깅
 * - 에러 처리
 */

const chalk = require('chalk');
const WorkflowContext = require('./WorkflowContext');
const WorkflowResult = require('./WorkflowResult');

class BaseWorkflow {
  constructor({
    adsPowerAdapter,
    youtubeAdapter,
    profileRepository,
    sheetRepository,
    logger,
    services = {}
  }) {
    // 의존성 주입
    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubeAdapter = youtubeAdapter;
    this.profileRepository = profileRepository;
    this.sheetRepository = sheetRepository;
    this.logger = logger || console;
    
    // 서비스 레이어
    this.services = {
      browser: services.browserService,
      auth: services.authService,
      navigation: services.navigationService,
      language: services.languageService,
      button: services.buttonService,
      popup: services.popupService,
      state: services.stateService,
      sheets: services.sheetsService,
      ...services
    };
    
    // 워크플로우 컨텍스트
    this.context = new WorkflowContext();
    
    // 워크플로우 타입 (서브클래스에서 오버라이드)
    this.workflowType = 'base';
  }

  /**
   * 워크플로우 실행 - Template Method Pattern
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 컨텍스트 초기화
    this.context.initialize({
      profileId,
      profileData: options.profileData || {},
      debugMode: options.debugMode || false,
      workflowType: this.workflowType
    });
    
    // 결과 객체 초기화
    const result = new WorkflowResult({
      profileId,
      workflowType: this.workflowType
    });

    try {
      this.log(`워크플로우 시작: ${this.workflowType} - 프로필 ${profileId}`, 'info');

      // 1. 사전 검증
      await this.validatePreConditions();

      // 2. 브라우저 연결
      const browserConnected = await this.connectBrowser(profileId);
      if (!browserConnected) {
        throw new Error('브라우저 연결 실패');
      }

      // 3. 페이지 설정
      await this.setupPage();

      // 4. 로그인 처리
      await this.handleAuthentication();

      // 5. 언어 감지
      await this.detectLanguage();

      // 6. 현재 상태 확인
      const currentState = await this.checkCurrentState();
      this.context.setState(currentState);

      // 7. 워크플로우 실행 (서브클래스에서 구현)
      const workflowResult = await this.executeWorkflow();
      result.mergeWorkflowResult(workflowResult);

      // 8. 결과 검증
      await this.verifyResult();

      // 9. 데이터 저장
      await this.saveResults(result);

      result.setSuccess(true);
      this.log(`워크플로우 완료: ${this.workflowType}`, 'success');

    } catch (error) {
      this.log(`워크플로우 실패: ${error.message}`, 'error');
      result.setError(error);
      
      // 에러 처리 전략
      await this.handleError(error, result);
      
    } finally {
      // 10. 정리 작업
      await this.cleanup();
      
      result.setDuration(Date.now() - startTime);
      this.log(`처리 시간: ${result.duration}ms`, 'info');
    }

    return result;
  }

  /**
   * 사전 검증 - 오버라이드 가능
   */
  async validatePreConditions() {
    this.log('사전 조건 검증', 'debug');
    // 서브클래스에서 구현
    return true;
  }

  /**
   * 브라우저 연결
   */
  async connectBrowser(profileId) {
    try {
      this.log('브라우저 연결 시도', 'info');
      
      if (this.services.browser) {
        // BrowserService 사용
        const connection = await this.services.browser.connect(profileId);
        this.context.setBrowser(connection.browser);
        this.context.setPage(connection.page);
      } else {
        // 레거시 방식 (AdsPowerAdapter 직접 사용)
        const session = await this.adsPowerAdapter.launchBrowser(profileId);
        if (!session || !session.browser) {
          throw new Error('브라우저 세션 획득 실패');
        }
        
        const page = await this.adsPowerAdapter.getPage(profileId);
        if (!page) {
          throw new Error('브라우저 페이지 획득 실패');
        }
        
        this.context.setBrowser(session.browser);
        this.context.setPage(page);
      }
      
      this.log('브라우저 연결 성공', 'success');
      return true;
      
    } catch (error) {
      this.log(`브라우저 연결 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 페이지 설정
   */
  async setupPage() {
    try {
      this.log('YouTube Premium 페이지로 이동', 'info');
      
      if (this.services.navigation) {
        await this.services.navigation.navigateToPremium(this.context.page);
      } else {
        // 레거시 방식
        const page = this.context.page;
        await page.goto('https://www.youtube.com/paid_memberships', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await new Promise(r => setTimeout(r, 3000));
      }
      
      this.log('페이지 이동 완료', 'success');
      
    } catch (error) {
      this.log(`페이지 설정 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 인증 처리
   */
  async handleAuthentication() {
    try {
      this.log('로그인 상태 확인', 'info');
      
      if (this.services.auth) {
        const isLoggedIn = await this.services.auth.checkLoginStatus(this.context.page);
        
        if (!isLoggedIn) {
          this.log('로그인 필요', 'warning');
          const credentials = this.context.getCredentials();
          const loginResult = await this.services.auth.login(this.context.page, credentials);
          
          if (!loginResult.success) {
            throw new Error(loginResult.error || '로그인 실패');
          }
        }
      } else {
        // GoogleLoginHelper 직접 사용 (레거시)
        const GoogleLoginHelper = require('../infrastructure/adapters/GoogleLoginHelper');
        const BrowserController = require('../infrastructure/adapters/BrowserController');
        
        const controller = new BrowserController(this.context.page, {
          debugMode: this.context.debugMode,
          humanMode: true
        });
        
        const loginHelper = new GoogleLoginHelper(this.context.page, controller, {
          debugMode: this.context.debugMode,
          screenshotEnabled: true
        });
        
        const isLoggedIn = await loginHelper.checkLoginStatus();
        
        if (!isLoggedIn) {
          this.log('로그인 시도', 'warning');
          const credentials = this.context.getCredentials();
          const loginResult = await loginHelper.login(credentials);
          
          if (loginResult === 'RECAPTCHA_DETECTED') {
            throw new Error('RECAPTCHA_DETECTED');
          }
          
          if (loginResult !== true) {
            throw new Error('로그인 실패');
          }
          
          // 로그인 후 페이지 재이동
          await this.setupPage();
        }
      }
      
      this.log('인증 완료', 'success');
      
    } catch (error) {
      this.log(`인증 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 언어 감지
   */
  async detectLanguage() {
    try {
      this.log('언어 감지 시작', 'info');
      
      if (this.services.language) {
        const language = await this.services.language.detect(this.context.page);
        this.context.setLanguage(language);
      } else {
        // 레거시 방식
        const { detectLanguage } = require('../infrastructure/config/multilanguage');
        const pageText = await this.context.page.evaluate(() => document.body?.textContent || '');
        const language = detectLanguage(pageText);
        this.context.setLanguage(language);
      }
      
      this.log(`감지된 언어: ${this.context.language}`, 'info');
      
    } catch (error) {
      this.log(`언어 감지 실패: ${error.message}`, 'warning');
      this.context.setLanguage('en'); // 기본값
    }
  }

  /**
   * 현재 상태 확인 - 서브클래스에서 구현
   */
  async checkCurrentState() {
    this.log('현재 상태 확인', 'debug');
    // 서브클래스에서 구현
    return {};
  }

  /**
   * 워크플로우 실행 - 서브클래스에서 반드시 구현
   */
  async executeWorkflow() {
    throw new Error('executeWorkflow() must be implemented by subclass');
  }

  /**
   * 결과 검증 - 오버라이드 가능
   */
  async verifyResult() {
    this.log('결과 검증', 'debug');
    // 서브클래스에서 구현
    return true;
  }

  /**
   * 결과 저장
   */
  async saveResults(result) {
    try {
      if (this.sheetRepository) {
        this.log('Google Sheets 업데이트', 'info');
        
        if (this.services.sheets) {
          await this.services.sheets.updateStatus(
            this.context.profileId,
            result.toSheetData()
          );
        } else {
          // 레거시 방식
          await this.sheetRepository.initialize();
          await this.sheetRepository.updateStatus(
            this.context.profileId,
            result.toSheetData()
          );
        }
        
        this.log('데이터 저장 완료', 'success');
      }
    } catch (error) {
      this.log(`데이터 저장 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * 에러 처리
   */
  async handleError(error, result) {
    // reCAPTCHA 특별 처리
    if (error.message === 'RECAPTCHA_DETECTED') {
      result.status = 'recaptcha_required';
      result.error = '번호인증계정';
      this.log('reCAPTCHA 감지 - 번호인증 필요', 'warning');
    } else {
      result.status = 'error';
      result.error = error.message;
    }
    
    // 스크린샷 저장
    try {
      if (this.context.page) {
        const timestamp = Date.now();
        await this.context.page.screenshot({
          path: `screenshots/error_${this.workflowType}_${timestamp}.png`
        });
      }
    } catch (e) {
      // 무시
    }
  }

  /**
   * 정리 작업
   */
  async cleanup() {
    try {
      this.log('정리 작업 시작', 'debug');
      
      if (this.services.browser) {
        await this.services.browser.disconnect(this.context.profileId);
      } else if (this.context.browser) {
        // 레거시 방식
        await this.adsPowerAdapter.closeBrowser(this.context.profileId);
      }
      
      this.context.clear();
      this.log('정리 작업 완료', 'debug');
      
    } catch (error) {
      this.log(`정리 작업 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const colors = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      debug: chalk.gray
    };
    
    const color = colors[level] || chalk.white;
    const prefix = level === 'success' ? '✅' : 
                   level === 'error' ? '❌' : 
                   level === 'warning' ? '⚠️' : 
                   level === 'debug' ? '🔍' : '📌';
    
    const formattedMessage = `[${this.workflowType}] ${message}`;
    
    if (this.logger && this.logger.log) {
      this.logger.log(color(`${prefix} ${formattedMessage}`));
    } else {
      console.log(color(`${prefix} ${formattedMessage}`));
    }
  }
}

module.exports = BaseWorkflow;