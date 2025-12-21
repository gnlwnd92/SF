/**
 * EnhancedResumeWorkflow - 서비스 기반 재개 워크플로우
 * 
 * 기존 UseCase를 새로운 서비스 아키텍처로 마이그레이션
 * 모든 공통 로직은 서비스로 위임하여 코드 중복 제거
 */

const BaseWorkflow = require('../core/BaseWorkflow');
const NavigationService = require('../services/NavigationService');
const AuthenticationService = require('../services/AuthenticationService');
const LanguageService = require('../services/LanguageService');
const BrowserManagementService = require('../services/BrowserManagementService');
const ButtonInteractionService = require('../services/ButtonInteractionService');
const PopupService = require('../services/PopupService');
const IPService = require('../services/IPService');

class EnhancedResumeWorkflow extends BaseWorkflow {
  constructor(dependencies) {
    super(dependencies);
    
    this.workflowType = 'resume';
    this.workflowVersion = '2.0';
    
    // 서비스 초기화
    this.initializeServices();
  }

  /**
   * 서비스 초기화
   */
  initializeServices() {
    // 네비게이션 서비스
    if (!this.services.navigation) {
      this.services.navigation = new NavigationService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 인증 서비스
    if (!this.services.auth) {
      this.services.auth = new AuthenticationService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 언어 서비스
    if (!this.services.language) {
      this.services.language = new LanguageService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 브라우저 관리 서비스
    if (!this.services.browser) {
      this.services.browser = new BrowserManagementService({
        debugMode: this.context?.debugMode,
        apiUrl: this.config?.adsPowerUrl
      });
    }
    
    // 버튼 상호작용 서비스
    if (!this.services.button) {
      this.services.button = new ButtonInteractionService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 팝업 서비스
    if (!this.services.popup) {
      this.services.popup = new PopupService({
        debugMode: this.context?.debugMode,
        buttonService: this.services.button
      });
    }
    
    // IP 서비스
    if (!this.services.ip) {
      this.services.ip = new IPService({
        debugMode: this.context?.debugMode
      });
    }
  }

  /**
   * 워크플로우 실행 - 메인 로직
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 컨텍스트 초기화
    this.context.setProfileId(profileId);
    this.context.setState({ 
      debugMode: options.debugMode || false,
      profileData: options.profileData || {}
    });
    
    // 결과 객체 초기화
    const result = this.createResult();
    
    try {
      this.log(`🚀 프로필 ${profileId} 재개 워크플로우 시작`, 'info');
      
      // 1. 브라우저 연결
      this.log('Step 1: 브라우저 연결', 'info');
      const browserConnection = await this.services.browser.connect(profileId);
      
      if (!browserConnection.success) {
        throw new Error('브라우저 연결 실패');
      }
      
      this.context.setBrowser(browserConnection.browser);
      this.context.setPage(browserConnection.page);
      
      // 2. 로그인 상태 확인
      this.log('Step 2: 로그인 상태 확인', 'info');
      const loginStatus = await this.services.auth.checkLoginStatus(
        this.context.page,
        { profileId }
      );
      
      if (!loginStatus.isLoggedIn) {
        this.log('로그인 필요 - 자동 로그인 시도', 'warning');
        
        // 자동 로그인 시도
        const profileData = this.context.getState().profileData;
        if (profileData?.email && profileData?.password) {
          await this.services.auth.performLogin(
            this.context.page,
            {
              email: profileData.email,
              password: profileData.password
            }
          );
        } else {
          throw new Error('로그인 정보가 없습니다');
        }
      }
      
      // 3. YouTube Premium 페이지로 이동
      this.log('Step 3: YouTube Premium 페이지 이동', 'info');
      await this.services.navigation.goToMembershipPage(this.context.page);
      
      // 4. 언어 감지
      this.log('Step 4: 언어 감지', 'info');
      const languageDetection = await this.services.language.detectLanguage(
        this.context.page
      );
      this.context.setLanguage(languageDetection.language);
      this.log(`감지된 언어: ${languageDetection.language}`, 'info');
      
      // 5. 현재 멤버십 상태 확인
      this.log('Step 5: 멤버십 상태 확인', 'info');
      const currentStatus = await this.checkMembershipStatus();

      if (currentStatus.isActive) {
        const reasons = currentStatus.detectionReasons || ['Pause 버튼 존재'];
        this.log(`⚠️ 활성 상태로 감지됨 (근거: ${reasons.join(', ')})`, 'warning');
        this.log('False Positive 가능성이 있어 최대 3번까지 재검증을 수행합니다.', 'info');

        /**
         * False Positive 방지를 위한 3회 재검증 로직
         * Race Condition이나 DOM 로딩 타이밍 문제로 잘못 감지되는 경우 방지
         * 3번 모두 활성 상태로 감지되어야 진짜 활성 상태로 판단
         */

        const MAX_RETRIES = 3;  // 총 3번 확인 (첫 번째 확인 + 2번 재시도)
        let activeCount = 1;    // 이미 첫 번째 확인에서 활성 상태로 감지됨
        let pausedCount = 0;
        let lastStatus = currentStatus;
        let resumeResult = null;

        this.log(`🔍 재검증 시작 (최대 ${MAX_RETRIES - 1}번 추가 확인)`, 'info');

        for (let retry = 1; retry < MAX_RETRIES; retry++) {
          this.log(`\n🔄 재검증 ${retry}/${MAX_RETRIES - 1}: 멤버십 상태 다시 확인`, 'info');

          // 디버깅용 스크린샷 저장
          if (this.context?.debugMode) {
            const timestamp = Date.now();
            await this.context.page.screenshot({
              path: `screenshots/double-check/retry-${retry}-${timestamp}.png`,
              fullPage: true
            });
          }

          // DOM 안정화 대기 (재시도마다 점진적으로 대기 시간 증가)
          const waitTime = 1500 + (retry * 500);  // 1.5초, 2초, 2.5초...
          this.log(`⏱️ ${waitTime}ms 대기 중...`, 'debug');
          await new Promise(r => setTimeout(r, waitTime));
          await this.waitForStability(this.context.page);

          // 재검증 수행
          const retryStatus = await this.checkMembershipStatus();
          lastStatus = retryStatus;

          if (retryStatus.isPaused) {
            pausedCount++;
            this.log(`✅ 재검증 ${retry}: 일시중지 상태 감지! (일시중지: ${pausedCount}회, 활성: ${activeCount}회)`, 'info');

            // 일시중지 상태가 감지되면 즉시 재개 시도
            this.log('일시중지 상태 확인됨. 재개 프로세스를 진행합니다...', 'info');

            // 에러 핸들러에 False Positive 기록
            if (this.errorHandler?.recordFalsePositive) {
              this.errorHandler.recordFalsePositive(profileId, {
                firstCheck: currentStatus,
                retryCheck: retryStatus,
                retryAttempt: retry,
                timestamp: new Date().toISOString()
              });
            }

            // 재개 실행
            this.log('Step 6: 재개 프로세스 실행 (False Positive 감지)', 'info');
            resumeResult = await this.executeResumeProcess();

            if (resumeResult.success) {
              result.setSuccess(true);
              result.setStatus('resumed');
              result.resumeDate = resumeResult.resumeDate;
              result.nextBillingDate = resumeResult.nextBillingDate;
              result.detectionReason = `False Positive 감지 후 재개 성공 (재시도 ${retry}회차)`;
              this.log(`✅ 재개 성공 (${retry}번째 재검증에서 일시중지 상태 확인)`, 'success');
              break;  // 성공적으로 재개했으므로 루프 종료
            } else {
              throw new Error(resumeResult.error || '재개 실패');
            }

          } else if (retryStatus.isActive) {
            activeCount++;
            this.log(`⚠️ 재검증 ${retry}: 여전히 활성 상태 (일시중지: ${pausedCount}회, 활성: ${activeCount}회)`, 'warning');
          } else {
            this.log(`⚠️ 재검증 ${retry}: 불명확한 상태`, 'warning');
          }
        }

        // 재개를 수행하지 않았고, 3번 모두 활성 상태로 감지된 경우
        if (!resumeResult && activeCount === MAX_RETRIES) {
          this.log(`\n✅ ${MAX_RETRIES}번 모두 활성 상태로 확인됨. 정말로 활성 상태입니다.`, 'info');
          result.setStatus('already_active');
          result.setSuccess(true);
          result.nextBillingDate = lastStatus.nextBillingDate || currentStatus.nextBillingDate;
          result.detectionReason = `${MAX_RETRIES}회 검증 완료 - ${(lastStatus.detectionReasons || reasons).join(', ')}`;
        } else if (!resumeResult) {
          // 재개도 하지 않았고, 상태가 불명확한 경우
          this.log(`⚠️ ${MAX_RETRIES}번 검증 후에도 상태가 불명확합니다.`, 'warning');
          this.log(`  - 활성 상태 감지: ${activeCount}회`, 'debug');
          this.log(`  - 일시중지 상태 감지: ${pausedCount}회`, 'debug');
          throw new Error(`멤버십 상태를 확인할 수 없습니다 (${MAX_RETRIES}회 재검증 실패)`);
        }
      } else if (!currentStatus.isPaused) {
        throw new Error('일시중지된 멤버십이 없습니다');
      } else {
        // 6. 재개 실행 (일반 케이스)
        this.log('Step 6: 재개 프로세스 실행', 'info');
        const resumeResult = await this.executeResumeProcess();
        
        if (resumeResult.success) {
          result.setSuccess(true);
          result.setStatus('resumed');
          result.resumeDate = resumeResult.resumeDate;
          result.nextBillingDate = resumeResult.nextBillingDate;
          
          this.log('✅ 재개 성공', 'success');
        } else {
          throw new Error(resumeResult.error || '재개 실패');
        }
      }
      
      // 7. Google Sheets 업데이트
      if (this.sheetRepository) {
        this.log('Step 7: Google Sheets 업데이트', 'info');
        await this.updateSheets(result);
      }
      
    } catch (error) {
      this.log(`❌ 워크플로우 실패: ${error.message}`, 'error');
      result.setError(error);
      result.setStatus('failed');
      
      // 에러 시 Sheets 업데이트
      if (this.sheetRepository) {
        await this.updateSheets(result);
      }
      
    } finally {
      // 브라우저 정리
      if (this.context.browser) {
        await this.services.browser.disconnect(profileId, {
          keepBrowserOpen: true
        });
      }
      
      // 실행 시간 기록
      result.setDuration(Date.now() - startTime);
      
      this.log(`워크플로우 완료 (${result.duration}ms)`, 'info');
    }
    
    return result;
  }

  /**
   * DOM 안정화 대기 헬퍼 메서드
   * Race Condition 방지를 위한 안정화 대기
   */
  async waitForStability(page) {
    this.log('⏱️ DOM 안정화 대기 중...', 'debug');

    // 1. 고정 대기 (최소 안전 시간)
    await new Promise(r => setTimeout(r, 1500));

    // 2. 네트워크 유휴 상태 대기 (Puppeteer 방식)
    try {
      await page.waitForNavigation({
        waitUntil: 'networkidle0',
        timeout: 2000
      });
      this.log('✅ 네트워크 유휴 상태 달성', 'debug');
    } catch (e) {
      this.log('⚠️ 네트워크 유휴 대기 타임아웃 (무시)', 'debug');
    }

    // 3. 주요 버튼 렌더링 대기
    try {
      await page.waitForSelector('button', {
        state: 'visible',
        timeout: 1000
      });
      this.log('✅ 버튼 요소 렌더링 완료', 'debug');
    } catch (e) {
      this.log('⚠️ 버튼 렌더링 대기 타임아웃 (계속 진행)', 'debug');
    }

    // 추가 안전 대기 (옵션)
    await new Promise(r => setTimeout(r, 500));
    this.log('✅ DOM 안정화 완료', 'debug');
  }

  /**
   * 멤버십 상태 확인
   * @param {boolean} skipStability - 안정화 대기 건너뛰기 (재검증시 사용)
   */
  async checkMembershipStatus(skipStability = false) {
    const page = this.context.page;
    const language = this.context.language;

    // 멤버십 관리 버튼 클릭 (재시도 로직 포함)
    const clickResult = await this.services.button.clickManageButtonWithRetry(page, language, {
      maxRetries: 3,
      verifyPageChange: true,
      debugMode: this.context?.debugMode
    });

    if (!clickResult.clicked) {
      throw new Error('멤버십 관리 버튼을 클릭할 수 없습니다');
    }

    // 🔥 DOM 안정화 대기 (Race Condition 방지)
    if (!skipStability) {
      this.log('🔄 페이지 로드 완료 대기...', 'info');
      await this.waitForStability(page);
    }

    // 페이지 내용 분석
    const pageText = await page.textContent('body');
    const buttons = await this.services.button.getAllButtonTexts(page);
    
    const status = {
      isActive: false,
      isPaused: false,
      nextBillingDate: null,
      detectionReasons: []  // 판단 근거 배열 추가
    };

    // 버튼으로 상태 판단
    const pauseButtonTexts = this.services.language.getLocalizedText('buttons.pause', language);
    const resumeButtonTexts = this.services.language.getLocalizedText('buttons.resume', language);

    // 🔥 우선순위 변경: Resume 버튼을 먼저 체크 (더 명확한 신호)
    if (buttons.some(btn => resumeButtonTexts.includes(btn.text))) {
      status.isPaused = true;
      status.detectionReasons.push('Resume 버튼 발견');
      this.log('🔍 Resume 버튼 감지 → 일시중지 상태', 'debug');
    }

    // Pause 버튼 체크 (Resume이 없을 때만 의미 있음)
    if (!status.isPaused && buttons.some(btn => pauseButtonTexts.includes(btn.text))) {
      status.isActive = true;
      status.detectionReasons.push('Pause 버튼 발견');
      this.log('🔍 Pause 버튼 감지 → 활성 상태', 'debug');

      // 다음 결제일 추출
      const dates = this.services.popup.extractDatesFromText(pageText);
      if (dates.length > 0) {
        status.nextBillingDate = dates[0];
        status.detectionReasons.push('Next Billing Date 확인');
      }
    }

    // 디버깅 정보 출력
    if (this.context?.debugMode) {
      this.log(`🔍 감지된 버튼들: ${buttons.map(b => b.text).join(', ')}`, 'debug');
      this.log(`📊 상태 판단 결과: isActive=${status.isActive}, isPaused=${status.isPaused}`, 'debug');
    }

    return status;
  }

  /**
   * 재개 프로세스 실행
   */
  async executeResumeProcess() {
    const page = this.context.page;
    const language = this.context.language;
    
    try {
      // 1. 재개 버튼 클릭
      this.log('재개 버튼 클릭', 'info');
      const resumeClicked = await this.services.button.clickResumeButton(page, language);
      
      if (!resumeClicked.clicked) {
        throw new Error('재개 버튼을 찾을 수 없습니다');
      }
      
      // 2. 확인 팝업 처리
      this.log('확인 팝업 처리', 'info');
      const popupResult = await this.services.popup.handleResumePopup(page, language);
      
      if (!popupResult.handled) {
        // 팝업이 없는 경우도 있음 (계정 타입에 따라)
        this.log('팝업이 감지되지 않음 (정상일 수 있음)', 'warning');
      }
      
      // 3. 결과 확인
      await new Promise(r => setTimeout(r, 3000));
      const finalStatus = await this.verifyResumeSuccess();
      
      if (finalStatus.success) {
        return {
          success: true,
          resumeDate: popupResult.resumeDate || new Date().toISOString(),
          nextBillingDate: popupResult.nextBillingDate || finalStatus.nextBillingDate
        };
      } else {
        throw new Error('재개 검증 실패');
      }
      
    } catch (error) {
      this.log(`재개 프로세스 오류: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 재개 성공 검증
   */
  async verifyResumeSuccess() {
    const page = this.context.page;
    const language = this.context.language;
    
    // 페이지 새로고침
    await this.services.navigation.refresh(page);
    await new Promise(r => setTimeout(r, 2000));
    
    // 멤버십 관리 다시 클릭 (재시도 로직 포함)
    const clickResult = await this.services.button.clickManageButtonWithRetry(page, language, {
      maxRetries: 3,
      verifyPageChange: true,
      debugMode: this.context?.debugMode
    });
    
    if (!clickResult.clicked) {
      return {
        success: false,
        error: '멤버십 관리 페이지에 접근할 수 없습니다'
      };
    }
    
    // Pause 버튼 확인 (활성 상태의 증거)
    const buttons = await this.services.button.getAllButtonTexts(page);
    const pauseButtonTexts = this.services.language.getLocalizedText('buttons.pause', language);
    
    const hasPauseButton = buttons.some(btn => 
      pauseButtonTexts.some(text => btn.text.includes(text))
    );
    
    if (hasPauseButton) {
      // 다음 결제일 추출
      const pageText = await page.textContent('body');
      const dates = this.services.popup.extractDatesFromText(pageText);
      
      return {
        success: true,
        nextBillingDate: dates[0] || null
      };
    }
    
    return {
      success: false
    };
  }

  /**
   * Google Sheets 업데이트
   */
  async updateSheets(result) {
    try {
      await this.sheetRepository.initialize();
      
      const updateData = {
        status: result.success ? '활성' : '오류',
        result: result.success ? '재개 성공' : (result.error || '실패'),
        resumeDate: result.resumeDate,
        nextBillingDate: result.nextBillingDate,
        note: `언어: ${this.context.language}, 자동 재개 v2.0`
      };
      
      // 이메일 또는 프로필 ID 사용 (이메일 우선)
      const identifier = this.context.getState().profileData?.email || this.context.profileId;
      
      // pauseSheetRepository를 사용하는 경우
      if (this.sheetRepository.updatePauseStatus) {
        await this.sheetRepository.updatePauseStatus(
          identifier,
          updateData
        );
      } else {
        // 다른 repository 메서드 사용
        await this.sheetRepository.updateStatus(
          identifier,
          updateData
        );
      }
      
      this.log('Google Sheets 업데이트 완료', 'success');
      
    } catch (error) {
      this.log(`Sheets 업데이트 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * 워크플로우 결과 객체 생성
   */
  createResult() {
    const WorkflowResult = require('../core/WorkflowResult');
    return new WorkflowResult({
      profileId: this.context.profileId,
      workflowType: this.workflowType
    });
  }
}

module.exports = EnhancedResumeWorkflow;