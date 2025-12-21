/**
 * 언어 독립적인 범용 재개 구독 UseCase
 * 텍스트 매칭 대신 DOM 구조와 스타일을 활용
 * 
 * @author SuperClaude
 * @date 2025-01-09
 */

const UniversalDOMService = require('../../services/UniversalDOMService');

class UniversalResumeSubscriptionUseCase {
  constructor({
    adsPowerAdapter,
    sheetsRepository,
    logger,
    dateParser,
    languageService,
    navigationService,
    buttonService,
    ipService,
    popupService,
    authService,
    config = {}
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.sheetsRepository = sheetsRepository;
    this.logger = logger;
    this.dateParser = dateParser;
    this.languageService = languageService;
    this.navigationService = navigationService;
    this.buttonService = buttonService;
    this.ipService = ipService;
    this.popupService = popupService;
    this.authService = authService;
    
    // UniversalDOMService 초기화
    this.domService = new UniversalDOMService({
      logger: this.logger,
      debugMode: config.debugMode || false
    });

    // 설정
    this.config = {
      waitTime: config.waitTime || 3000,
      maxRetries: config.maxRetries || 3,
      screenshotOnError: config.screenshotOnError !== false,
      updateSheets: config.updateSheets !== false,
      debugMode: config.debugMode || false,
      ...config
    };

    this.page = null;
    this.browser = null;
  }

  /**
   * 재개 워크플로우 실행 (언어 독립적)
   */
  async execute(profile) {
    const startTime = Date.now();
    let result = {
      success: false,
      profileId: profile.serial || profile.profileId,
      email: profile.email,
      timestamp: new Date().toISOString()
    };

    try {
      this.log(`🚀 재개 워크플로우 시작: ${profile.email}`, 'info');

      // 1. 브라우저 실행
      await this.launchBrowser(profile);

      // 2. YouTube Premium 페이지로 이동
      await this.navigateToYouTubePremium();

      // 3. 페이지 구조 분석 (언어 독립적)
      const pageStructure = await this.domService.analyzePageStructure(this.page);
      this.log(`페이지 구조: ${JSON.stringify(pageStructure)}`, 'debug');

      // 4. 재개 프로세스 실행
      const resumeResult = await this.performUniversalResume();
      
      if (resumeResult.success) {
        result.success = true;
        result.resumeDate = resumeResult.resumeDate;
        result.nextBillingDate = resumeResult.nextBillingDate;
        
        this.log('✅ 재개 성공!', 'success');
        
        // 5. Google Sheets 업데이트
        if (this.config.updateSheets) {
          await this.updateSheetsStatus(profile, 'active', result);
        }
      } else {
        throw new Error(resumeResult.error || '재개 실패');
      }

    } catch (error) {
      this.log(`❌ 오류: ${error.message}`, 'error');
      result.error = error.message;
      
      // 스크린샷 저장
      if (this.config.screenshotOnError && this.page) {
        await this.saveErrorScreenshot(error.message);
      }
      
      // Sheets 오류 상태 업데이트
      if (this.config.updateSheets) {
        await this.updateSheetsStatus(profile, 'error', result);
      }
    } finally {
      // 브라우저 정리
      await this.cleanup();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.log(`⏱️ 실행 시간: ${duration}초`, 'info');
    }

    return result;
  }

  /**
   * 언어 독립적인 재개 프로세스
   */
  async performUniversalResume() {
    try {
      // 1단계: 멤버십 관리 섹션 확장
      const sectionExpanded = await this.expandManagementSection();
      if (!sectionExpanded) {
        throw new Error('멤버십 관리 섹션을 확장할 수 없음');
      }

      // 2단계: 재개 버튼 클릭
      const resumeClicked = await this.clickResumeButton();
      if (!resumeClicked) {
        throw new Error('재개 버튼을 찾을 수 없음');
      }

      // 3단계: 팝업 확인
      const popupResult = await this.confirmResumePopup();
      if (!popupResult.success) {
        throw new Error('팝업 확인 실패');
      }

      return {
        success: true,
        resumeDate: popupResult.resumeDate,
        nextBillingDate: popupResult.nextBillingDate
      };

    } catch (error) {
      this.log(`재개 프로세스 오류: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 멤버십 관리 섹션 확장 (언어 독립적)
   */
  async expandManagementSection() {
    try {
      // 이미 확장되어 있는지 확인
      const isExpanded = await this.domService.isSectionExpanded(this.page);
      
      if (isExpanded) {
        this.log('멤버십 관리 섹션이 이미 확장되어 있음', 'info');
        return true;
      }

      // 멤버십 관리 버튼 찾기 (언어 독립적)
      this.log('멤버십 관리 버튼 찾는 중...', 'info');
      const managementButton = await this.domService.findManagementButton(this.page);
      
      if (!managementButton.found) {
        this.log('멤버십 관리 버튼을 찾을 수 없음', 'error');
        return false;
      }

      // 버튼 클릭
      const clicked = await this.page.evaluate((btn) => {
        if (!btn) return false;
        
        // 다양한 클릭 방법 시도
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        btn.dispatchEvent(clickEvent);
        
        // 대체 방법
        if (btn.click) btn.click();
        
        return true;
      }, managementButton.element);

      if (!clicked) {
        this.log('멤버십 관리 버튼 클릭 실패', 'error');
        return false;
      }

      this.log('멤버십 관리 버튼 클릭 성공', 'success');
      
      // 섹션 확장 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 확장 확인
      const expandedAfterClick = await this.domService.isSectionExpanded(this.page);
      return expandedAfterClick;

    } catch (error) {
      this.log(`섹션 확장 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 재개 버튼 클릭 (언어 독립적)
   */
  async clickResumeButton() {
    try {
      this.log('재개 버튼 찾는 중...', 'info');
      
      // 확장된 섹션에서 재개 버튼 찾기
      const resumeButton = await this.domService.findActionButtonInExpandedSection(this.page, 'resume');
      
      if (!resumeButton.found) {
        this.log('재개 버튼을 찾을 수 없음', 'error');
        return false;
      }

      // 버튼 클릭
      const clicked = await this.page.evaluate((btn) => {
        if (!btn) return false;
        
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // 클릭 이벤트 발송
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        btn.dispatchEvent(clickEvent);
        
        // 대체 클릭
        if (btn.click) btn.click();
        
        return true;
      }, resumeButton.element);

      if (clicked) {
        this.log('재개 버튼 클릭 성공', 'success');
        await new Promise(r => setTimeout(r, 2000)); // 팝업 대기
        return true;
      }

      return false;

    } catch (error) {
      this.log(`재개 버튼 클릭 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 재개 확인 팝업 처리 (언어 독립적)
   */
  async confirmResumePopup() {
    try {
      this.log('재개 확인 팝업 대기 중...', 'info');
      
      // 팝업 대기 (최대 5초)
      let popupFound = false;
      for (let i = 0; i < 5; i++) {
        const hasPopup = await this.page.evaluate(() => {
          const dialogs = document.querySelectorAll([
            'tp-yt-paper-dialog:not([aria-hidden="true"])',
            '[role="dialog"]:not([aria-hidden="true"])',
            '[aria-modal="true"]'
          ].join(','));
          
          return Array.from(dialogs).some(d => d.offsetHeight > 0);
        });
        
        if (hasPopup) {
          popupFound = true;
          break;
        }
        
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (!popupFound) {
        this.log('재개 확인 팝업이 나타나지 않음', 'warning');
        
        // 팝업 없이 성공한 경우도 있음
        const pageChanged = await this.checkIfResumeSuccessful();
        return { success: pageChanged };
      }
      
      this.log('재개 확인 팝업 발견!', 'success');
      
      // 팝업 내 확인 버튼 클릭 (언어 독립적)
      const popupResult = await this.domService.handlePopupDialog(this.page, true);
      
      if (popupResult.clicked) {
        this.log('재개 확인 버튼 클릭 성공', 'success');
        
        // 날짜 정보 추출 시도
        await new Promise(r => setTimeout(r, 3000));
        const dateInfo = await this.extractDateInfo();
        
        return {
          success: true,
          ...dateInfo
        };
      }
      
      return { success: false, error: '팝업 버튼 클릭 실패' };

    } catch (error) {
      this.log(`팝업 처리 오류: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 재개 성공 여부 확인
   */
  async checkIfResumeSuccessful() {
    return await this.page.evaluate(() => {
      const bodyText = document.body?.textContent || '';
      
      // 날짜 패턴이 있으면 활성 상태로 간주
      const hasDatePattern = /\d{1,2}[\/\-\.\s]\d{1,2}|\d{4}[\/\-\.]\d{1,2}/.test(bodyText);
      
      // Pause 버튼이 보이면 활성 상태
      const hasPauseButton = Array.from(document.querySelectorAll('button, tp-yt-paper-button'))
        .some(btn => {
          const style = window.getComputedStyle(btn);
          // Danger 색상 (빨간색 계열) 버튼이 있으면 Pause 버튼으로 간주
          return style.color.includes('rgb(234, 67, 53)') || 
                 style.backgroundColor.includes('rgb(234, 67, 53)');
        });
      
      return hasDatePattern || hasPauseButton;
    });
  }

  /**
   * 날짜 정보 추출 (언어 독립적)
   */
  async extractDateInfo() {
    try {
      const dateText = await this.page.evaluate(() => {
        const bodyText = document.body?.textContent || '';
        
        // 모든 날짜 패턴 찾기
        const datePatterns = [
          /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/g, // 2025-01-09
          /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/g, // 09/01/2025
          /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}/gi, // 9 January 2025
          /\w+\s+\d{1,2},?\s+\d{4}/g // January 9, 2025
        ];
        
        const dates = [];
        for (const pattern of datePatterns) {
          const matches = bodyText.match(pattern);
          if (matches) {
            dates.push(...matches);
          }
        }
        
        return dates;
      });
      
      if (dateText && dateText.length > 0) {
        this.log(`날짜 정보 발견: ${dateText.join(', ')}`, 'info');
        return {
          resumeDate: 'immediate',
          nextBillingDate: dateText[0]
        };
      }
      
      return {};
    } catch (error) {
      this.log(`날짜 추출 오류: ${error.message}`, 'debug');
      return {};
    }
  }

  /**
   * 브라우저 실행
   */
  async launchBrowser(profile) {
    this.log(`브라우저 실행: ${profile.serial || profile.profileId}`, 'info');
    
    const browserResult = await this.adsPowerAdapter.openBrowser(profile.serial || profile.profileId);
    
    if (!browserResult.success) {
      throw new Error(`브라우저 실행 실패: ${browserResult.error}`);
    }
    
    this.browser = browserResult.browser;
    this.page = browserResult.page;
    
    // 페이지 이벤트 설정
    this.page.on('console', msg => {
      if (this.config.debugMode) {
        console.log(`[Browser Console] ${msg.text()}`);
      }
    });
    
    this.log('브라우저 실행 성공', 'success');
  }

  /**
   * YouTube Premium 페이지로 이동
   */
  async navigateToYouTubePremium() {
    this.log('YouTube Premium 페이지로 이동 중...', 'info');
    
    await this.page.goto('https://www.youtube.com/paid_memberships', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 페이지 로드 대기
    await new Promise(r => setTimeout(r, 3000));
    
    // 로그인 필요 여부 확인
    const needsLogin = await this.page.evaluate(() => {
      return window.location.href.includes('accounts.google.com');
    });
    
    if (needsLogin) {
      this.log('로그인이 필요합니다', 'warning');
      // 로그인 처리 로직 (필요시)
    }
    
    this.log('YouTube Premium 페이지 로드 완료', 'success');
  }

  /**
   * Google Sheets 상태 업데이트
   */
  async updateSheetsStatus(profile, status, result) {
    try {
      await this.sheetsRepository.updateProfileStatus(profile.email, {
        status,
        lastAction: '재개',
        lastActionDate: new Date().toISOString(),
        result: result.success ? '성공' : '실패',
        error: result.error,
        nextBillingDate: result.nextBillingDate
      });
      
      this.log('Google Sheets 업데이트 완료', 'success');
    } catch (error) {
      this.log(`Sheets 업데이트 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 오류 스크린샷 저장
   */
  async saveErrorScreenshot(errorMessage) {
    try {
      const timestamp = Date.now();
      const filename = `error_resume_${timestamp}.png`;
      
      await this.page.screenshot({
        path: filename,
        fullPage: false
      });
      
      this.log(`오류 스크린샷 저장: ${filename}`, 'debug');
    } catch (error) {
      this.log(`스크린샷 저장 실패: ${error.message}`, 'debug');
    }
  }

  /**
   * 정리
   */
  async cleanup() {
    try {
      if (this.browser) {
        // 브라우저는 열어둠 (AdsPower 특성)
        this.log('브라우저 세션 유지', 'debug');
      }
    } catch (error) {
      this.log(`정리 중 오류: ${error.message}`, 'debug');
    }
  }

  /**
   * 로깅 헬퍼
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[UniversalResume] ${message}`;
    
    if (this.logger) {
      this.logger[level]?.(logMessage);
    } else {
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
    }
  }
}

module.exports = UniversalResumeSubscriptionUseCase;