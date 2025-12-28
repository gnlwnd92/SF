/**
 * Enhanced Resume Subscription Use Case
 * 다국어 지원 및 개선된 결제 재개 워크플로우
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const GoogleLoginHelper = require('../../infrastructure/adapters/GoogleLoginHelperUltimate');
const ImprovedAuthenticationService = require('../../services/ImprovedAuthenticationService');
const WorkingAuthenticationService = require('../../services/WorkingAuthenticationService');
const ImprovedAccountChooserHandler = require('../../services/ImprovedAccountChooserHandler');
const { languages, detectLanguage } = require('../../infrastructure/config/multilanguage');
const PageStateAnalyzer = require('../../services/PageStateAnalyzer');
const NavigationStrategy = require('../../services/NavigationStrategy');
const DateParsingService = require('../../services/DateParsingService');
const UniversalStatusDetector = require('../../services/UniversalStatusDetector');
// 프록시 풀 설정 추가 (폴백용)
const { getRandomProxy, getProxyPoolStatus } = require('../../infrastructure/config/proxy-pools');
// 해시 기반 프록시 매핑 서비스 (의존성 주입으로 전달됨)
// Google Sheets API
const { google } = require('googleapis');
const IPService = require('../../services/IPService');

class EnhancedResumeSubscriptionUseCase {
  constructor({
    adsPowerAdapter,
    youtubeAdapter,
    profileRepository,
    pauseSheetRepository,
    errorHandlingService,
    authService,  // DI로 주입받은 인증 서비스 추가
    logger,
    config = {},
    dateParser,  // 날짜 파싱 서비스 추가
    adsPowerIdMappingService,  // AdsPower ID 매핑 서비스 추가
    hashProxyMapper,  // 해시 기반 프록시 매핑 서비스 추가
    sessionLogService  // 세션 로그 서비스 추가 (스크린샷 + 로그 통합)
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubeAdapter = youtubeAdapter;
    this.profileRepository = profileRepository;
    this.pauseSheetRepository = pauseSheetRepository;
    this.errorHandler = errorHandlingService;
    this.logger = logger || console;
    this.dateParser = dateParser;  // 날짜 파싱 서비스 저장
    this.adsPowerIdMappingService = adsPowerIdMappingService;  // AdsPower ID 매핑 서비스 저장
    this.hashProxyMapper = hashProxyMapper;  // 해시 기반 프록시 매핑 서비스 저장
    this.sessionLogService = sessionLogService;  // 세션 로그 서비스 저장
    this.currentLanguage = 'en';
    this.resumeInfo = {};
    this.savedNextBillingDate = null; // 이전에 저장한 날짜 (일시중지와 동일하게)
    this.config = config; // 설정 저장
    this.currentPage = null; // 현재 페이지 추적
    this.consoleLogs = []; // 콘솔 로그 수집
    this.networkLogs = []; // 네트워크 로그 수집
    this.usedProxyId = null;  // 사용된 프록시 ID 추적 (통합워커 기록용)
    this.ipService = new IPService({ debugMode: false });  // IP 확인 서비스
    
    // DI 컨테이너에서 주입받은 인증 서비스 사용 (더 이상 직접 생성하지 않음)
    this.authService = authService || new ImprovedAuthenticationService({
      debugMode: true,
      maxRetries: 3,
      screenshotEnabled: true,
      humanLikeMotion: true  // 휴먼라이크 마우스 동작 활성화
    });
    
    // 페이지 상태 분석기 및 네비게이션 전략 초기화
    this.pageAnalyzer = new PageStateAnalyzer(logger);
    this.navigationStrategy = new NavigationStrategy(logger);

    // 범용 상태 감지기 초기화
    this.universalDetector = new UniversalStatusDetector(logger);

    // 날짜 파싱 서비스 - 이미 위에서 설정했으므로 백업 처리만
    if (!this.dateParser) {
      this.dateParser = new DateParsingService();
    }
  }

  /**
   * 결제 재개 워크플로우 실행
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 프로필 데이터 저장 (로그인용)
    this.profileData = options.profileData || {};
    this.debugMode = options.debugMode || false;
    
    // 워크플로우 타임아웃 설정 (5분)
    const WORKFLOW_TIMEOUT = options.workflowTimeout || 5 * 60 * 1000;
    const MAX_STUCK_TIME = 30 * 1000; // 30초 동안 진행 없으면 stuck
    const REFRESH_AFTER_STUCK = 60 * 1000; // 1분 정체 시 새로고침
    const SKIP_AFTER_STUCK = 2 * 60 * 1000; // 2분 정체 시 스킵
    let lastProgressTime = Date.now();
    let currentStep = '시작';
    let workflowTimeout = null;
    let stuckChecker = null;
    let stuckRefreshCount = 0; // 새로고침 시도 횟수 (무한 루프 방지)
    const MAX_REFRESH_ATTEMPTS = 2; // 최대 새로고침 시도 횟수
    let shouldSkipProfile = false; // 스킵 플래그

    // SessionLogService 세션 시작 (스크린샷 + 로그 통합 관리)
    const sessionEmail = this.profileData?.email || this.profileData?.googleId || 'unknown';
    if (this.sessionLogService) {
      this.sessionLogService.startSession(sessionEmail, 'resume', { profileId });
    }

    const result = {
      profileId,
      success: false,
      status: null,
      resumeDate: null,
      nextBillingDate: null,
      browserIP: null,   // 브라우저 IP (통합워커 기록용)
      proxyId: null,     // 사용된 프록시 ID (통합워커 기록용)
      language: null,    // 감지된 언어 (통합워커용)
      error: null,
      duration: 0,
      timedOut: false,
      skippedDueToStagnation: false // 정체로 인한 스킵 플래그
    };

    // 진행 상황 업데이트 함수
    const updateProgress = (step) => {
      currentStep = step;
      lastProgressTime = Date.now();
      // 새로고침 카운터 리셋 (진행이 있으면)
      if (step !== currentStep) {
        stuckRefreshCount = 0;
      }
      // 디버그 모드에서만 진행 상황 출력
      if (this.debugMode) {
        console.log(chalk.gray(`  ⏳ [진행] ${step}`));
      }
    };

    // 타임아웃 체커 설정
    workflowTimeout = setTimeout(() => {
      result.timedOut = true;
      result.error = `워크플로우 타임아웃 (${WORKFLOW_TIMEOUT/1000}초 초과)`;
      if (this.debugMode) console.log(chalk.red(`\n⏱️ 워크플로우 타임아웃 - ${currentStep} 단계에서 중단`));
    }, WORKFLOW_TIMEOUT);

    // 스마트 정체 복구 체커 (새로고침 → 스킵)
    stuckChecker = setInterval(async () => {
      const timeSinceProgress = Date.now() - lastProgressTime;

      if (timeSinceProgress > MAX_STUCK_TIME && !result.timedOut && !shouldSkipProfile) {
        if (this.debugMode) console.log(chalk.yellow(`\n⚠️ 정체 감지: ${Math.floor(timeSinceProgress/1000)}초 동안 ${currentStep} 단계에서 진행 없음`));

        // 2분 이상 정체 시 스킵
        if (timeSinceProgress >= SKIP_AFTER_STUCK) {
          if (this.debugMode) console.log(chalk.red(`\n🚫 [스마트 복구] ${Math.floor(timeSinceProgress/1000)}초 정체 - 이 프로필 스킵`));
          shouldSkipProfile = true;
          result.skippedDueToStagnation = true;
          result.error = `정체로 인한 스킵 (${currentStep} 단계에서 ${Math.floor(timeSinceProgress/1000)}초 정체)`;
          return;
        }

        // 1분 이상 정체 시 새로고침 시도 (최대 2회)
        if (timeSinceProgress >= REFRESH_AFTER_STUCK && stuckRefreshCount < MAX_REFRESH_ATTEMPTS) {
          stuckRefreshCount++;
          if (this.debugMode) console.log(chalk.cyan(`\n🔄 [스마트 복구] 정체 감지 - 새로고침 시도 ${stuckRefreshCount}/${MAX_REFRESH_ATTEMPTS}`));

          try {
            if (this.page && !this.page.isClosed()) {
              // 현재 URL 저장
              const currentUrl = this.page.url();
              if (this.debugMode) console.log(chalk.gray(`  현재 URL: ${currentUrl}`));

              // 페이지 새로고침
              await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
              if (this.debugMode) console.log(chalk.green(`  ✅ 새로고침 완료`));

              // 진행 시간 업데이트 (새로고침 후 1분 더 기다림)
              lastProgressTime = Date.now();
            }
          } catch (refreshError) {
            if (this.debugMode) console.log(chalk.yellow(`  ⚠️ 새로고침 실패: ${refreshError.message}`));
          }
        }
      }
    }, 10000); // 10초마다 체크

    try {
      // 디버그 모드에서만 상세 헤더 출력
      if (this.debugMode) {
        this.log(`프로필 ${profileId} 결제 재개 시작`, 'info');
        console.log(chalk.cyan.bold('\n═══════════════════════════════════════════'));
        console.log(chalk.cyan.bold(`🎯 Resume Workflow 시작 - 프로필: ${profileId}`));
        console.log(chalk.cyan.bold('═══════════════════════════════════════════\n'));
      }

      // 1. 브라우저 연결
      updateProgress('브라우저 연결');
      if (this.debugMode) console.log(chalk.blue('📌 [Step 1/6] 브라우저 연결'));
      
      // 타임아웃 및 스킵 체크
      if (result.timedOut) {
        throw new Error('WORKFLOW_TIMEOUT');
      }
      if (shouldSkipProfile) {
        throw new Error('STAGNATION_SKIP');
      }

      // 이메일 정보 추출 (options에서 또는 profileData에서)
      const email = options.email || this.profileData?.email || null;

      const browser = await this.connectBrowser(profileId, email);
      if (!browser) {
        throw new Error('브라우저 연결 실패');
      }

      // 사용된 프록시 ID 저장 (통합워커 기록용)
      result.proxyId = this.usedProxyId;

      // 실제 사용된 AdsPower ID 업데이트
      if (this.actualProfileId && this.actualProfileId !== profileId) {
        if (this.debugMode) console.log(chalk.cyan(`  🆔 실제 사용 ID: ${this.actualProfileId}`));
        result.profileId = this.actualProfileId;
      }

      if (this.debugMode) console.log(chalk.green('✅ 브라우저 연결 성공\n'));

      // 2. YouTube Premium 페이지 이동
      updateProgress('YouTube Premium 페이지 이동');
      if (this.debugMode) console.log(chalk.blue('📌 [Step 2/6] YouTube Premium 페이지 이동'));
      
      if (result.timedOut) {
        throw new Error('WORKFLOW_TIMEOUT');
      }
      if (shouldSkipProfile) {
        throw new Error('STAGNATION_SKIP');
      }

      // updateProgress 함수 전달 (shouldSkipProfile 체크 함수도 전달)
      const checkShouldSkip = () => shouldSkipProfile;
      await this.navigateToPremiumPage(browser, updateProgress, checkShouldSkip);

      // 브라우저 IP 확인 (통합워커 기록용)
      try {
        result.browserIP = await this.ipService.getCurrentIP(this.page);
        if (this.debugMode) console.log(chalk.cyan(`  🌐 브라우저 IP: ${result.browserIP}`));
      } catch (ipError) {
        if (this.debugMode) console.log(chalk.yellow(`  ⚠️ IP 확인 실패: ${ipError.message}`));
      }

      // 휴먼라이크 헬퍼 초기화 (베지어 곡선 + CDP 네이티브 입력)
      if (this.authService && this.authService.humanLikeMotion) {
        await this.authService.initializeHumanLikeHelpers(this.page);
        if (this.debugMode) this.log('✅ 휴먼라이크 헬퍼 초기화 완료', 'info');
      }

      // 페이지 이동 완료 후 진행 상황 업데이트
      updateProgress('Premium 페이지 이동 완료');
      if (this.debugMode) console.log(chalk.green('✅ Premium 페이지 이동 완료\n'));

      // v2.0: 결제 문제 감지 및 복구 시도
      if (this.debugMode) console.log(chalk.blue('📌 [Step 2.5/6] 결제 문제 체크'));
      const ButtonInteractionService = require('../../services/ButtonInteractionService');
      const paymentButtonService = new ButtonInteractionService({ debugMode: true });
      const paymentIssueCheck = await paymentButtonService.detectPaymentIssue(this.page);

      if (paymentIssueCheck.hasPaymentIssue) {
        if (this.debugMode) console.log(chalk.yellow('💳 결제 문제 감지됨 - 복구 시도 중...'));

        // 스크린샷 저장
        const screenshotPath = `screenshots/payment-issue-resume-${Date.now()}.png`;
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        if (this.debugMode) console.log(chalk.gray(`📸 결제 문제 스크린샷 저장: ${screenshotPath}`));

        // 결제 복구 시도
        const recoveryResult = await paymentButtonService.attemptPaymentRecovery(this.page);

        if (recoveryResult.success && recoveryResult.recovered) {
          if (this.debugMode) console.log(chalk.green('🎉 결제 복구 성공! 다시 확인이 필요합니다.'));
          throw new Error('PAYMENT_RECOVERED_NEED_RECHECK');
        } else {
          if (this.debugMode) console.log(chalk.red(`❌ 결제 복구 실패: ${recoveryResult.error}`));
          throw new Error('PAYMENT_METHOD_ISSUE');
        }
      }

      // 3. 언어 감지
      updateProgress('언어 감지');
      if (this.debugMode) console.log(chalk.blue('📌 [Step 3/6] 언어 감지'));

      if (result.timedOut) {
        throw new Error('WORKFLOW_TIMEOUT');
      }
      if (shouldSkipProfile) {
        throw new Error('STAGNATION_SKIP');
      }

      this.currentLanguage = await this.detectPageLanguage(browser);
      result.language = this.currentLanguage;  // 통합워커용 언어 정보 저장

      if (this.debugMode) {
        this.log(`감지된 언어: ${languages[this.currentLanguage].name}`, 'info');
        console.log(chalk.green(`✅ 언어 감지 완료: ${languages[this.currentLanguage].name}\n`));
      }

      // 브라우저에 다국어 데이터 주입 (러시아어 지원)
      await this.page.evaluate((langData) => {
        window._currentLanguageData = langData;
      }, languages[this.currentLanguage]);

      // 4. 현재 상태 확인
      updateProgress('구독 상태 확인');
      if (this.debugMode) console.log(chalk.blue('📌 [Step 4/6] 구독 상태 확인'));

      if (result.timedOut) {
        throw new Error('WORKFLOW_TIMEOUT');
      }
      if (shouldSkipProfile) {
        throw new Error('STAGNATION_SKIP');
      }

      const currentStatus = await this.checkCurrentStatus(browser);
      
      // 이미 활성 상태인 경우
      if (currentStatus.isActive && !currentStatus.isPausedScheduled) {
        this.log('이미 활성 상태입니다', 'warning');
        result.status = 'already_active';
        result.success = true;
        
        // 날짜 정보 추출
        if (currentStatus.nextBillingDate) {
          // 재개 컨텍스트로 날짜 파싱 (오늘 날짜도 올해로 처리)
          result.nextBillingDate = this.dateParser.parseDate(currentStatus.nextBillingDate, this.currentLanguage, '재개');
        }
      } else if (currentStatus.isPausedScheduled) {
        // 일시정지가 예약된 상태 - 예약 취소가 필요함
        this.log('⚠️ 일시정지가 예약된 상태입니다. 예약 취소 작업이 필요합니다.', 'warning');
        
        // 예약 취소 버튼 찾기 및 클릭 시도
        const cancelResult = await this.cancelPauseSchedule();
        if (cancelResult.success) {
          result.success = true;
          result.status = 'pause_schedule_cancelled';
          result.nextBillingDate = cancelResult.nextBillingDate;
          this.log('✅ 일시정지 예약이 취소되었습니다', 'success');
        } else {
          result.status = 'pause_scheduled';
          result.success = false;
          result.error = '일시정지 예약 상태를 변경할 수 없음';
          result.nextBillingDate = currentStatus.resumeScheduledDate;
        }
      } else if (currentStatus.isExpired) {
        // 구독이 만료된 경우 - 명확한 처리
        if (this.debugMode) {
          this.log(`❌ 구독이 만료됨: ${currentStatus.expiredIndicator}`, 'error');
          console.log(chalk.red('\n❌ 구독 만료 상태 감지'));
          console.log(chalk.yellow(`  만료 지표: "${currentStatus.expiredIndicator}"`));
        }

        result.status = '만료됨';  // 상태를 만료됨으로 설정
        result.success = false;
        result.error = '구독이 만료되어 재개할 수 없습니다. 새로 구독해야 합니다.';
        result.isExpired = true;
        result.expiredIndicator = currentStatus.expiredIndicator;
        result.needsRenewal = true;
        result.recommendedAction = '새로운 YouTube Premium 구독 필요';

        // 만료된 계정의 스크린샷 저장
        await this.captureDebugScreenshot('expired-account');
        if (this.debugMode) console.log(chalk.red('\n📝 이 계정은 만료 상태로 Google Sheets에 기록됩니다.'));
      } else {
        // checkCurrentStatus에서 얻은 날짜 저장 (재개 전)
        this.savedNextBillingDate = currentStatus.nextBillingDate;

        // 수동 체크가 필요한 케이스 처리
        if (currentStatus.requiresManualCheck) {
          this.log('⚠️ 페이지 로딩 중 또는 불완전한 상태 - 수동 체크 필요', 'warning');
          result.status = '일시중지';  // 상태를 일시중지로 설정
          result.success = false;
          result.error = '수동 체크 필요';
          result.needsManualCheck = true;
          result.manualCheckReason = '페이지 로딩 중 또는 불완전한 상태로 인해 자동 처리 불가';

          // 스크린샷 촬영 전 Manage 버튼 클릭하여 확장 영역 열기
          try {
            this.log('📸 스크린샷 촬영을 위해 확장 영역 열기...', 'info');
            await this.clickManageButton();
            await new Promise(r => setTimeout(r, 2000));
          } catch (e) {
            this.log(`확장 영역 열기 실패 (무시): ${e.message}`, 'warning');
          }

          // 수동 체크가 필요한 계정 스크린샷 캡처 (확장 영역 열린 상태)
          await this.captureScreenshot(profileId, result);
        } else if (!currentStatus.hasResumeButton) {
          // 재개 버튼이 없을 때 추가 상태 확인
          // checkCurrentStatus에서 이미 만료 여부를 확인했음
          if (currentStatus.isExpired) {
            this.log('🚫 만료된 계정 감지됨 - YouTube Premium 구독이 만료되어 재개가 불가능합니다', 'warning');
            result.status = 'expired';
            result.success = false;
            result.error = 'YouTube Premium 구독 만료됨';

            // 스크린샷 촬영 전 Manage 버튼 클릭하여 확장 영역 열기
            try {
              this.log('📸 스크린샷 촬영을 위해 확장 영역 열기...', 'info');
              await this.clickManageButton();
              await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
              this.log(`확장 영역 열기 실패 (무시): ${e.message}`, 'warning');
            }

            // 만료된 계정 스크린샷 캡처 (확장 영역 열린 상태)
            await this.captureExpiredAccountScreenshot();
          } else if (currentStatus.isActive) {
            this.log('계정이 이미 활성 상태입니다', 'info');

            // 가족 멤버십 여부 확인
            const pageText = await this.page.evaluate(() => document.body?.textContent || '');
            const isFamilyMembership = pageText.includes('Family membership') ||
                                       pageText.includes('가족 멤버십') ||
                                       pageText.includes('Family plan') ||
                                       pageText.includes('가족 요금제');

            if (isFamilyMembership) {
              if (this.debugMode) console.log(chalk.green('✅ [Family Membership] 이미 활성 상태'));
              result.membershipType = 'family';
            }

            result.status = 'already_active';
            result.success = true;  // 이미 활성인 경우 성공으로 처리
            result.error = null;  // 에러가 아님
            result.nextBillingDate = currentStatus.nextBillingDate || '날짜 확인 필요';
          } else {
            this.log('Resume 버튼을 찾을 수 없습니다', 'warning');
            result.status = 'no_resume_option';
            result.success = false;
            result.error = 'Resume 옵션이 없음';
          }
        } else if (currentStatus.isPaused && currentStatus.hasResumeButton) {
          // 5. 일시중지 상태이고 재개 버튼이 있는 경우 - 재개 프로세스 실행
          updateProgress('Resume 프로세스 실행');
          if (this.debugMode) {
            console.log(chalk.blue('📌 [Step 5/6] Resume 프로세스 실행'));
            console.log(chalk.green('✅ 일시중지 상태 확인 - 재개 가능'));
            console.log(chalk.cyan(`  일시중지 날짜: ${currentStatus.pauseScheduledDate || '확인 불가'}`));
            console.log(chalk.cyan(`  재개 예정 날짜: ${currentStatus.resumeScheduledDate || '확인 불가'}`));
          }

          if (result.timedOut) {
            throw new Error('WORKFLOW_TIMEOUT');
          }

          const resumeResult = await this.executeResumeWorkflow(browser);

          if (resumeResult.success) {
            result.success = true;
            result.status = 'resumed';
            result.resumeDate = resumeResult.resumeDate;
            result.nextBillingDate = resumeResult.nextBillingDate;

            // 팝업에서 날짜를 못 찾았지만 이전에 저장한 날짜가 있는 경우
            if (!result.nextBillingDate && this.savedNextBillingDate) {
              if (this.debugMode) {
                this.log('팝업에서 날짜를 찾지 못함, 이전에 저장한 날짜 사용', 'warning');
                console.log(chalk.yellow('⚠️ 팝업에서 날짜 미발견 - 저장된 날짜 사용'));
              }
              result.nextBillingDate = this.savedNextBillingDate;
              if (this.debugMode) this.log(`저장된 날짜 사용: ${result.nextBillingDate}`, 'info');
            }

            if (this.debugMode) {
              this.log('결제 재개 성공', 'success');
              console.log(chalk.green('✅ Resume 프로세스 성공\n'));
            }
          } else {
            if (this.debugMode) console.log(chalk.red('❌ Resume 프로세스 실패\n'));
            throw new Error(resumeResult.error || '결제 재개 실패');
          }
        } else {
          // 예상치 못한 상태
          if (this.debugMode) {
            console.log(chalk.yellow('\n⚠️ 예상치 못한 상태'));
            console.log(chalk.gray('  상태 정보:'));
            console.log(chalk.gray(`  - isPaused: ${currentStatus.isPaused}`));
            console.log(chalk.gray(`  - hasResumeButton: ${currentStatus.hasResumeButton}`));
            console.log(chalk.gray(`  - isActive: ${currentStatus.isActive}`));
            console.log(chalk.gray(`  - isExpired: ${currentStatus.isExpired}`));
          }

          result.status = '확인필요';
          result.success = false;
          result.error = '예상치 못한 상태 - 수동 확인 필요';
          result.needsManualCheck = true;

          // 스크린샷 저장
          await this.captureDebugScreenshot('unexpected-status');
        }
      }

      // 6. IP 확인 (신규 추가)
      updateProgress('최종 작업');
      if (this.debugMode) console.log(chalk.blue('📌 [Step 6/6] 최종 작업'));
      result.browserIP = await this.checkBrowserIP();
      if (this.debugMode) console.log(chalk.gray(`  - 브라우저 IP: ${result.browserIP || 'N/A'}`));

      // 7. Google Sheets 업데이트 (IP 정보 포함)
      if (this.pauseSheetRepository) {
        if (this.debugMode) console.log(chalk.gray('  - Google Sheets 업데이트 중...'));
        await this.updateGoogleSheets(profileId, result);
        if (this.debugMode) console.log(chalk.green('  ✅ Google Sheets 업데이트 완료'));
      }

      // 8. 스크린샷 캡처 (확장 영역 열린 상태에서)
      if (this.debugMode) console.log(chalk.gray('  - 최종 스크린샷 캡처 중...'));
      // verifyResumeSuccess()에서 이미 Manage 버튼 클릭했지만, 확실하게 다시 확인
      try {
        const isExpanded = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes('Resume') || bodyText.includes('재개') ||
                 bodyText.includes('Pause') || bodyText.includes('일시중지');
        });
        if (!isExpanded) {
          this.log('📸 스크린샷 촬영을 위해 확장 영역 다시 열기...', 'info');
          await this.clickManageButton();
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (e) {
        // 무시 - 이미 확장되어 있을 가능성 높음
      }
      await this.captureScreenshot(profileId, result);

      // 9. 브라우저 연결 해제
      if (this.debugMode) console.log(chalk.gray('  - 브라우저 연결 해제 중...'));
      await this.disconnectBrowser(this.actualProfileId || profileId);
      if (this.debugMode) console.log(chalk.green('✅ 최종 작업 완료\n'));
      
      // 타임아웃 및 체커 정리
      if (workflowTimeout) clearTimeout(workflowTimeout);
      if (stuckChecker) clearInterval(stuckChecker);

    } catch (error) {
      // 타임아웃 및 체커 정리
      if (workflowTimeout) clearTimeout(workflowTimeout);
      if (stuckChecker) clearInterval(stuckChecker);
      
      // 타임아웃 에러 처리
      if (error.message === 'WORKFLOW_TIMEOUT' || result.timedOut) {
        this.log('⏱️ 워크플로우 타임아웃', 'error');
        result.error = `타임아웃: ${currentStep} 단계에서 중단`;
        result.status = 'timeout';
        result.skipToNext = true;
        result.skipRetry = true;

        // 타임아웃 스크린샷 저장
        try {
          if (this.currentPage) {
            const screenshotPath = `screenshots/timeout_${profileId}_${Date.now()}.png`;
            await this.currentPage.screenshot({ path: screenshotPath, fullPage: true });
            console.log(chalk.gray(`  📸 타임아웃 스크린샷: ${screenshotPath}`));
          }
        } catch (e) {
          // 무시
        }

        // 브라우저 정리
        try {
          await this.disconnectBrowser(this.actualProfileId || profileId);
        } catch (e) {
          // 무시
        }
      }
      // ★★★ 정체로 인한 스킵 처리 (새로 추가) ★★★
      else if (error.message === 'STAGNATION_SKIP' || result.skippedDueToStagnation) {
        this.log('🚫 정체로 인해 이 프로필 스킵', 'warning');
        console.log(chalk.yellow(`\n🚫 [스마트 복구] 정체로 인해 프로필 ${profileId} 스킵`));
        console.log(chalk.gray(`   정체 단계: ${currentStep}`));
        result.error = result.error || `정체로 인한 스킵: ${currentStep} 단계에서 장시간 응답 없음`;
        result.status = 'stagnation_skipped';
        result.skipToNext = true;
        result.skipRetry = true;

        // 정체 스크린샷 저장
        try {
          if (this.page && !this.page.isClosed()) {
            const screenshotPath = `screenshots/stagnation_${profileId}_${Date.now()}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
            console.log(chalk.gray(`  📸 정체 스크린샷: ${screenshotPath}`));
          }
        } catch (e) {
          // 무시
        }

        // 브라우저 정리
        try {
          await this.disconnectBrowser(this.actualProfileId || profileId);
        } catch (e) {
          // 무시
        }
      }
      // 계정 잠김 에러인 경우 특별 처리
      else if (error.isAccountLocked || error.message === 'ACCOUNT_LOCKED') {
        this.log('🔒 계정 잠김으로 인해 건너뜁니다', 'error');
        result.error = '🔒 계정 잠김 - 수동 복구 필요 (Account disabled by Google)';
        result.status = '계정잠김';
        result.accountLocked = true;
        result.skipToNext = true;  // 다음 계정으로 진행 플래그
        result.skipRetry = true;    // 재시도 방지
        // 에러를 throw하지 않고 결과 반환하여 다음 계정 처리
      } else if (error.isRecaptcha || error.message === 'RECAPTCHA_DETECTED') {
        this.log('🛑 reCAPTCHA로 인해 건너뜁니다', 'warning');
        result.error = 'RECAPTCHA_DETECTED';
        result.status = 'recaptcha_detected';
        result.skipToNext = true;  // 다음 계정으로 진행 플래그
        // 에러를 throw하지 않고 결과 반환하여 다음 계정 처리
      } else if (error.isCaptcha || error.message === 'IMAGE_CAPTCHA_DETECTED') {
        // ★ 이미지 CAPTCHA 감지된 경우 - 재시도 허용
        this.log('🖼️ 이미지 CAPTCHA로 인해 재시도 필요', 'warning');
        result.status = 'captcha_detected';
        result.error = 'IMAGE_CAPTCHA_DETECTED';
        result.captchaDetected = true;
        result.success = false;
        result.skipToNext = false;  // 재시도 허용
        result.skipRetry = false;   // ★ 재시도 허용
        result.shouldRetry = true;  // ★ 재시도 플래그
        result.retryReason = 'image_captcha';
      } else {
        this.log(`오류 발생: ${error.message}`, 'error');
        result.error = error.message;
      }
      
      // 에러 핸들러가 있으면 자동 디버깅 (reCAPTCHA가 아닌 경우만)
      if (!error.isRecaptcha && this.errorHandler && this.currentPage) {
        const errorInfo = await this.errorHandler.handleError(error, {
          profile: profileId,
          workflow: 'resume_subscription',
          step: result.status || 'unknown',
          url: this.currentPage.url ? await this.currentPage.url() : 'unknown',
          page: this.currentPage,
          consoleLogs: this.consoleLogs,
          networkLogs: this.networkLogs,
          profileData: this.profileData
        });
        result.errorDetails = errorInfo;
      }
      
      // reCAPTCHA 감지된 경우 특별 처리
      if (error.message === 'RECAPTCHA_DETECTED') {
        result.status = 'recaptcha_detected';  // recaptcha_required 대신 recaptcha_detected 사용
        result.error = 'RECAPTCHA_DETECTED';
        result.recaptchaDetected = true;
        result.success = false;
      } else {
        result.status = 'error';
      }
      
      // IP 확인 시도 (오류 발생 시에도)
      try {
        result.browserIP = await this.checkBrowserIP();
      } catch (ipError) {
        this.log(`IP 확인 실패: ${ipError.message}`, 'warning');
      }
      
      // Google Sheets 업데이트 시도 (오류 발생 시에도)
      // 모든 오류 케이스에 대해 한 번만 업데이트
      if (this.pauseSheetRepository) {
        try {
          await this.updateGoogleSheets(profileId, result);
          this.log('오류 상태 Google Sheets 업데이트 완료', 'info');
        } catch (updateError) {
          this.log(`Google Sheets 업데이트 실패: ${updateError.message}`, 'error');
        }
      }
      
      // 스크린샷 시도 (오류 발생 시에도, 브라우저 연결 해제 전에)
      try {
        await this.captureScreenshot(profileId, result);
      } catch (e) {
        this.log(`스크린샷 캡처 실패: ${e.message}`, 'warning');
      }
      
      // 브라우저 연결 해제 시도
      try {
        await this.disconnectBrowser(this.actualProfileId || profileId);
      } catch (e) {
        // 무시
      }
    }

    result.duration = Math.round((Date.now() - startTime) / 1000);
    this.log(`처리 시간: ${result.duration}초`, 'info');

    // SessionLogService 세션 종료 (스크린샷 + 로그 통합 관리)
    if (this.sessionLogService?.hasActiveSession()) {
      const sessionResult = result.success ? 'success' : 'error';
      this.sessionLogService.endSession(sessionResult, {
        nextBillingDate: result.nextBillingDate,
        error: result.error,
        errorType: result.timedOut ? 'timeout' : (result.skippedDueToStagnation ? 'stagnation' : 'unknown'),
        errorStep: result.status,
        language: this.currentLanguage
      });
    }

    return result;
  }

  /**
   * 대체 AdsPower ID 찾기
   */
  async findAlternativeAdsPowerIds(email) {
    try {
      console.log(chalk.yellow(`\n🔍 대체 AdsPower ID 검색 중: ${email}`));

      // AdsPowerIdMappingService를 사용하여 ID 찾기
      if (this.adsPowerIdMappingService) {
        console.log(chalk.cyan('  📋 AdsPower ID 매핑 서비스 사용'));

        // 매핑 서비스에서 ID 찾기
        const mappedIds = await this.adsPowerIdMappingService.findAdsPowerIds(email);

        if (mappedIds.length > 0) {
          console.log(chalk.green(`  ✅ ${mappedIds.length}개의 매칭 ID 발견`));
          mappedIds.forEach((id, index) => {
            console.log(chalk.gray(`    ${index + 1}. ${id}`));
          });
          return mappedIds;
        } else {
          console.log(chalk.yellow('  ⚠️ 매핑 서비스에서 ID를 찾을 수 없습니다'));
        }
      }

      // 폴백: pauseSheetRepository 직접 사용
      if (!this.pauseSheetRepository) {
        console.log(chalk.gray('  Google Sheets 연결 없음'));
        return [];
      }

      console.log(chalk.gray('  폴백: pauseSheetRepository 직접 사용'));

      const sheets = google.sheets({ version: 'v4', auth: this.pauseSheetRepository.auth });

      // 애즈파워현황 시트에서 데이터 가져오기
      console.log(chalk.gray('  애즈파워현황 시트 조회 중...'));
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.pauseSheetRepository.spreadsheetId,
        range: '애즈파워현황!A2:E1000' // 애즈파워현황 시트 (A-E열만)
      });

      const rows = response.data.values || [];
      const alternativeIds = [];

      console.log(chalk.gray(`  전체 행 수: ${rows.length}`))

      // 이메일로 매칭되는 모든 AdsPower ID 찾기
      // 시트 구조:
      // A열(0): 애즈파워번호
      // B열(1): 애즈파워아이디
      // C열(2): group
      // D열(3): 아이디(이메일)

      let matchCount = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue; // D열까지 데이터가 있어야 함

        const rowEmail = row[3]?.toString().trim().toLowerCase(); // D열 - 이메일
        const adsPowerId = row[1]?.toString().trim(); // B열 - AdsPower ID

        // 디버깅을 위해 첫 10개 행 출력
        if (i < 10 && rowEmail) {
          console.log(chalk.gray(`    행 ${i+2}: 이메일="${rowEmail}", AdsPower="${adsPowerId || '(없음)'}"`));
        }

        // 이메일 매칭 확인
        if (rowEmail && rowEmail === email.toLowerCase()) {
          matchCount++;
          console.log(chalk.green(`  ✅ 매칭 발견! 행 ${i+2}: ${rowEmail} -> ${adsPowerId}`));

          if (adsPowerId && adsPowerId !== '') {
            // 중복 체크
            if (!alternativeIds.includes(adsPowerId)) {
              alternativeIds.push(adsPowerId);
              console.log(chalk.cyan(`    🔧 AdsPower ID 추가: ${adsPowerId}`));
            }
          } else {
            console.log(chalk.yellow(`    ⚠️ AdsPower ID가 비어있음`));
          }
        }
      }

      console.log(chalk.cyan(`\n  📊 검색 결과:`));
      console.log(chalk.gray(`    - 검색 이메일: ${email}`));
      console.log(chalk.gray(`    - 매칭된 행: ${matchCount}개`));
      console.log(chalk.cyan(`    - 발견된 AdsPower ID: ${alternativeIds.length}개`));

      if (alternativeIds.length > 0) {
        console.log(chalk.green('\n  대체 ID 목록:'));
        alternativeIds.forEach((id, idx) => {
          console.log(chalk.gray(`    ${idx + 1}. ${id}`));
        });
      } else {
        console.log(chalk.red('\n  ❌ 대체 ID를 찾을 수 없습니다'));
      }

      return alternativeIds;
    } catch (error) {
      console.log(chalk.red(`  ❌ 대체 ID 검색 오류: ${error.message}`));
      console.error(error);
      return [];
    }
  }

  /**
   * 브라우저 연결 (대체 ID 지원)
   */
  async connectBrowser(profileId, email = null) {
    let attemptedIds = [];
    let lastError = null;

    // profileId가 null이거나 비밀번호 형태인 경우 바로 대체 ID 검색
    const isInvalidId = !profileId || /[!@#$%^&*(),.?":{}|<>]/.test(profileId);

    if (isInvalidId) {
      console.log(chalk.yellow(`\n⚠️ 유효하지 않은 AdsPower ID: ${profileId ? profileId.substring(0, 10) + '...' : 'null'}`));
      console.log(chalk.yellow(`🔍 바로 대체 ID 검색 시작...`));
    } else {
      // 첫 번째 ID로 시도
      try {
        console.log(chalk.blue(`\n🔧 AdsPower ID 시도 1: ${profileId}`));
        attemptedIds.push(profileId);
        const result = await this._connectBrowserWithId(profileId, email);

        // 결과 확인
        if (!result) {
          throw new Error('브라우저 세션 획득 실패');
        }

        // 성공하면 바로 반환
        this.actualProfileId = profileId;
        return result;
      } catch (error) {
        console.log(chalk.red(`  ❌ 첫 번째 ID 실패: ${error.message}`));
        lastError = error;

        // 프로필이 존재하지 않는 경우 대체 ID 검색
        if (error.message.includes('Profile does not exist') ||
            error.message.includes('none exists') ||
            error.message.includes('profile_id is required') ||
            error.message.includes('브라우저 세션 획득 실패')) {
          console.log(chalk.yellow('\n🔍 프로필이 존재하지 않음 - 대체 ID 검색 시작...'));
        }
      }
    }

    // 대체 ID 검색 필요
    if (isInvalidId || lastError) {
      console.log(chalk.cyan('\n📋 애즈파워현황 시트에서 대체 ID 검색'));

      if (!email) {
        console.log(chalk.yellow('  ⚠️ 이메일 정보가 없어 대체 ID를 찾을 수 없습니다'));
        throw lastError || new Error('이메일 정보 없음');
      }

      // 대체 AdsPower ID 찾기
      const alternativeIds = await this.findAlternativeAdsPowerIds(email);

      if (alternativeIds.length === 0) {
        console.log(chalk.red('  ❌ 대체 AdsPower ID를 찾을 수 없습니다'));
        console.log(chalk.yellow('  💡 애즈파워현황 시트에 해당 이메일의 AdsPower ID를 추가해주세요'));
        throw new Error(`사용 가능한 AdsPower 프로필을 찾을 수 없습니다 (이메일: ${email})`);
      }

      // 대체 ID로 시도
      for (const altId of alternativeIds) {
        if (attemptedIds.includes(altId)) {
          console.log(chalk.gray(`  ⏩ 이미 시도한 ID 건너뛰기: ${altId}`));
          continue;
        }

        try {
          console.log(chalk.blue(`\n🔧 대체 AdsPower ID 시도: ${altId}`));
          attemptedIds.push(altId);

          // 대체 ID로 성공하면 해당 ID 반환
          const result = await this._connectBrowserWithId(altId, email);

          // 결과 확인
          if (!result) {
            throw new Error('브라우저 세션 획득 실패');
          }

          // 성공하면 사용한 ID 저장
          this.actualProfileId = altId;
          console.log(chalk.green(`  ✅ 대체 ID로 연결 성공: ${altId}`));

          return result;
        } catch (altError) {
          console.log(chalk.red(`  ❌ 대체 ID ${altId} 실패: ${altError.message}`));
          lastError = altError;
        }
      }
    }

    // 모든 시도 실패
    console.log(chalk.red('\n❌ 모든 AdsPower ID 시도 실패'));
    console.log(chalk.gray('  시도한 ID: ' + attemptedIds.join(', ')));
    throw lastError || new Error('브라우저 연결 실패');
  }

  /**
   * 특정 ID로 브라우저 연결 (내부 메서드)
   * @param {string} profileId - AdsPower 프로필 ID
   * @param {string} email - 계정 이메일 (해시 기반 프록시 매핑용)
   */
  async _connectBrowserWithId(profileId, email = null) {
    try {
      // [v2.10] 프록시 변경 전 기존 브라우저 종료 (필수!)
      // 프록시 설정(updateProfile)은 프로필 설정만 변경하고, 실행 중인 브라우저에는 적용되지 않음
      // 따라서 프록시 변경 시 기존 브라우저를 먼저 닫아야 새 프록시가 적용됨
      console.log(chalk.gray('  🔄 기존 브라우저 확인 및 정리 중...'));
      try {
        await this.adsPowerAdapter.closeBrowser(profileId);
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(chalk.gray('  ✅ 기존 브라우저 종료됨'));
      } catch (closeError) {
        // 브라우저가 없거나 이미 종료된 경우 무시
        console.log(chalk.gray('  ℹ️ 기존 브라우저 없음 또는 이미 종료됨'));
      }

      // 프록시 설정 (환경변수로 제어)
      const useProxy = process.env.USE_PROXY !== 'false';

      if (useProxy) {
        console.log(chalk.cyan('  🌐 한국 프록시 설정 중...'));

        let krProxy;

        // 해시 기반 프록시 매핑 시도 (hashProxyMapper가 있는 경우)
        if (this.hashProxyMapper) {
          try {
            if (email) {
              // 이메일이 있으면 해시 기반 매핑 (동일 이메일 → 동일 프록시)
              const mappingInfo = await this.hashProxyMapper.getMappingInfo(email, 'kr');
              krProxy = await this.hashProxyMapper.getProxyForAccount(email, 'kr');
              this.usedProxyId = mappingInfo.proxyId || null;
              console.log(chalk.cyan(`  🔐 해시 기반 프록시 매핑: ${krProxy.proxy_host}:${krProxy.proxy_port} (${this.usedProxyId})`));
            } else {
              // 이메일 없으면 시트에서 랜덤 선택 (Sticky 세션 프록시 사용)
              console.log(chalk.yellow('  ⚠️ 이메일 정보 없음 - 시트에서 랜덤 프록시 선택'));
              const randomResult = await this.hashProxyMapper.getRandomProxyFromSheet('kr');
              krProxy = randomResult.proxy;
              this.usedProxyId = randomResult.proxyId;
              console.log(chalk.cyan(`  🎲 시트 랜덤 프록시: ${krProxy.proxy_host}:${krProxy.proxy_port} (${this.usedProxyId})`));
            }
          } catch (hashError) {
            console.log(chalk.yellow(`  ⚠️ 해시 프록시 조회 실패: ${hashError.message}`));
            console.log(chalk.yellow('  ℹ️ 최종 폴백: 하드코딩 랜덤 프록시 사용'));
            krProxy = getRandomProxy('kr');
            this.usedProxyId = 'hardcoded_random';  // 하드코딩 프록시 사용 표시
          }
        } else {
          // hashProxyMapper 없음 - 하드코딩 랜덤 프록시 사용
          console.log(chalk.yellow('  ⚠️ hashProxyMapper 없음 - 하드코딩 랜덤 프록시 사용'));
          krProxy = getRandomProxy('kr');
          this.usedProxyId = 'hardcoded_random';
        }

        console.log(chalk.cyan(`  🇰🇷 한국 프록시 사용: ${krProxy.proxy_host}:${krProxy.proxy_port}`));

        // AdsPower API로 프록시 업데이트
        try {
          await this.adsPowerAdapter.updateProfile(profileId, {
            user_proxy_config: krProxy
          });
          console.log(chalk.green('  ✅ 한국 프록시 설정 완료'));
        } catch (proxyError) {
          console.log(chalk.yellow(`  ⚠️ 프록시 설정 실패: ${proxyError.message}`));
          console.log(chalk.yellow('  ℹ️ 프록시 없이 계속 진행합니다. USE_PROXY=false로 설정하면 이 메시지를 숨길 수 있습니다.'));
          // 프록시 설정 실패해도 계속 진행
        }

        // 프록시 설정 후 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(chalk.gray('  ℹ️ 프록시 설정을 건너뜁니다 (USE_PROXY=false)'));
      }

      // 새로운 openBrowser 메서드 사용 (단일 탭 보장)
      console.log(chalk.cyan('🔄 브라우저 실행 및 탭 정리 중...'));
      const browserResult = await this.adsPowerAdapter.openBrowser(profileId, {
        initialUrl: 'https://www.google.com' // 초기 URL을 Google로 설정
      });

      if (!browserResult.success) {
        throw new Error(`브라우저 실행 실패: ${browserResult.error}`);
      }

      const { browser, page, session } = browserResult;

      this.browser = browser;
      this.page = page;

      // 페이지가 제대로 로드되었는지 확인하고 초기화
      console.log(chalk.gray('📄 페이지 초기화 중...'));

      try {
        // 현재 URL 확인
        const currentUrl = await page.evaluate(() => window.location.href);
        console.log(chalk.gray(`  현재 URL: ${currentUrl}`));

        // IP 확인 API나 이상한 페이지에 있는 경우
        if (currentUrl.includes('api.ipify.org') ||
            currentUrl.includes('ipinfo.io') ||
            currentUrl.includes('whatismyipaddress') ||
            currentUrl.includes('start.adspower')) {
          console.log(chalk.yellow('  ⚠️ IP 확인 페이지 감지 - Google로 강제 이동'));

          // 프록시 연결 안정화 대기
          await new Promise(r => setTimeout(r, 2000));

          // 재시도 로직 (최대 3번)
          let navigationSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(chalk.gray(`  🔄 페이지 이동 시도 ${attempt}/3`));
              await page.goto('https://www.google.com', {
                waitUntil: 'networkidle2',
                timeout: 40000
              });
              navigationSuccess = true;
              break;
            } catch (navError) {
              console.log(chalk.yellow(`  ⚠️ 페이지 이동 실패 (${attempt}/3): ${navError.message}`));
              if (navError.message.includes('ERR_CONNECTION_CLOSED')) {
                await new Promise(r => setTimeout(r, 5000));  // 연결 끊김 시 5초 대기
              } else {
                await new Promise(r => setTimeout(r, 2000));
              }
            }
          }

          if (navigationSuccess) {
            await new Promise(r => setTimeout(r, 3000));
            // 다시 URL 확인
            const newUrl = await page.evaluate(() => window.location.href);
            console.log(chalk.green(`  ✅ 새 URL: ${newUrl}`));
          } else {
            console.log(chalk.yellow('  ⚠️ Google 이동 실패 - 현재 페이지로 계속 진행'));
          }
        }
        // 빈 페이지이거나 about:blank인 경우 Google로 이동
        else if (!currentUrl || currentUrl === 'about:blank' || currentUrl === ':' || currentUrl === '') {
          console.log(chalk.yellow('  ⚠️ 빈 페이지 감지 - Google로 초기 이동'));

          // 프록시 연결 안정화 대기
          await new Promise(r => setTimeout(r, 2000));

          // 재시도 로직 (최대 3번)
          let navigationSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(chalk.gray(`  🔄 페이지 이동 시도 ${attempt}/3`));
              await page.goto('https://www.google.com', {
                waitUntil: 'networkidle2',
                timeout: 40000
              });
              navigationSuccess = true;
              break;
            } catch (navError) {
              console.log(chalk.yellow(`  ⚠️ 페이지 이동 실패 (${attempt}/3): ${navError.message}`));
              if (navError.message.includes('ERR_CONNECTION_CLOSED')) {
                await new Promise(r => setTimeout(r, 5000));
              } else {
                await new Promise(r => setTimeout(r, 2000));
              }
            }
          }

          if (!navigationSuccess) {
            console.log(chalk.yellow('  ⚠️ Google 이동 실패 - 현재 페이지로 계속 진행'));
          }
          await new Promise(r => setTimeout(r, 3000));
        }

        // Frame이 제대로 연결되었는지 확인
        await page.evaluate(() => {
          return document.readyState;
        });

      } catch (initError) {
        console.log(chalk.yellow(`  ⚠️ 페이지 초기화 경고: ${initError.message}`));
        // 초기화 실패해도 계속 진행
      }
      this.currentPage = page; // 에러 핸들러용

      // 에러 핸들러가 있으면 로깅 설정
      if (this.errorHandler) {
        this.consoleLogs = this.errorHandler.setupConsoleLogging(page);
        this.networkLogs = this.errorHandler.setupNetworkLogging(page);
      }

      // BrowserController 인스턴스 생성 (로그인에 필요)
      const BrowserController = require('../../infrastructure/adapters/BrowserController');
      this.controller = new BrowserController(page, {
        debugMode: this.debugMode,
        humanMode: true
      });

      console.log(chalk.green('✅ 브라우저 준비 완료 (단일 탭)'));
      return { browser, page };
    } catch (error) {
      this.log(`브라우저 연결 실패: ${error.message}`, 'error');
      // null을 반환하는 대신 에러를 throw해야 상위에서 catch할 수 있음
      throw error;
    }
  }

  /**
   * YouTube Premium 페이지로 이동 (로그인 처리 포함)
   * Frame-safe 네비게이션 사용
   * v2.1 - beforeunload 다이얼로그 자동 처리 기능 추가
   * v2.2 - 정체 감지 스킵 콜백 추가
   * @param {Browser} browser - Puppeteer 브라우저 인스턴스
   * @param {Function} updateProgress - 진행 상황 업데이트 콜백
   * @param {Function} checkShouldSkip - 스킵 여부 체크 콜백 (정체 감지 시)
   */
  async navigateToPremiumPage(browser, updateProgress = null, checkShouldSkip = null) {
    // Enhanced Navigation Service 초기화 (타임아웃 설정 강화)
    const EnhancedNavigationService = require('../../services/EnhancedNavigationService');
    this.navigationService = new EnhancedNavigationService({
      debugMode: true,
      adsPowerMode: true,
      frameRecoveryEnabled: true,
      maxFrameRecoveryAttempts: 2,  // Frame Recovery 최대 2회로 제한
      totalTimeoutMs: 90000,         // 전체 네비게이션 90초 제한
      waitForNavigationTimeout: 20000 // 개별 네비게이션 20초 제한
    });

    // v2.1 - beforeunload 다이얼로그 자동 처리 설정
    // Gmail 등에서 "사이트에서 나가시겠습니까?" 다이얼로그로 인한 블로킹 방지
    try {
      console.log(chalk.cyan('🔧 [Dialog] beforeunload 다이얼로그 핸들러 설정 중...'));

      // 1. Puppeteer dialog 이벤트 핸들러 등록 (이미 등록되어 있지 않은 경우)
      if (!this._dialogHandlerRegistered) {
        this.page.on('dialog', async (dialog) => {
          const dialogType = dialog.type();
          const message = dialog.message();
          console.log(chalk.yellow(`\n📌 [Dialog] 다이얼로그 감지 [${dialogType}]: ${message.substring(0, 80)}...`));

          try {
            if (dialogType === 'beforeunload') {
              await dialog.accept();
              console.log(chalk.green(`   ✅ beforeunload 다이얼로그 자동 수락 (페이지 이동 허용)`));
            } else if (dialogType === 'confirm') {
              await dialog.accept();
              console.log(chalk.green(`   ✅ confirm 다이얼로그 자동 수락`));
            } else {
              await dialog.accept();
              console.log(chalk.green(`   ✅ 다이얼로그 자동 수락 [${dialogType}]`));
            }
          } catch (err) {
            console.log(chalk.red(`   ❌ 다이얼로그 처리 실패: ${err.message}`));
          }
        });
        this._dialogHandlerRegistered = true;
        console.log(chalk.green('   ✅ 다이얼로그 핸들러 등록 완료'));
      }

      // 2. beforeunload 이벤트 리스너 제거 (원천 차단)
      await this.page.evaluate(() => {
        window.onbeforeunload = null;

        // addEventListener로 등록된 beforeunload 차단
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = function(type, listener, options) {
          if (type === 'beforeunload') return;
          return originalAddEventListener.call(this, type, listener, options);
        };
      }).catch(() => {});

      console.log(chalk.green('   ✅ beforeunload 이벤트 리스너 제거 완료'));
    } catch (dialogSetupError) {
      console.log(chalk.yellow(`⚠️ [Dialog] 다이얼로그 핸들러 설정 실패 (계속 진행): ${dialogSetupError.message}`));
    }

    let retryCount = 0;
    const maxRetries = 3;
    let pageLoaded = false;
    const navigationStartTime = Date.now();
    
    // 디버깅을 위한 스크린샷 저장 함수
    const saveDebugScreenshot = async (step, suffix = '') => {
      try {
        // ✅ AdsPower 기본 설정 사용 (viewport 강제 설정 제거)

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `debug-resume-${step}${suffix ? '-' + suffix : ''}-${timestamp}.png`;
        const filepath = path.join('screenshots', 'debug', filename);
        await fs.mkdir(path.join('screenshots', 'debug'), { recursive: true });
        await this.page.screenshot({ path: filepath, fullPage: true });
        console.log(chalk.gray(`📸 [DEBUG] 스크린샷 저장: ${filename}`));
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 디버그 스크린샷 저장 실패: ${e.message}`));
      }
    };
    
    // 브라우저 오류 체크 및 복구 함수
    const checkAndRecoverFromError = async () => {
      try {
        const hasError = await this.page.evaluate(() => {
          const bodyText = document.body?.textContent || '';
          return bodyText.includes('STATUS_ACCESS_VIOLATION') ||
                 bodyText.includes('ERR_NETWORK_CHANGED') ||
                 bodyText.includes('ERR_INTERNET_DISCONNECTED') ||
                 bodyText.includes('앗, 이런!') ||
                 bodyText.includes('Aw, Snap!') ||
                 bodyText.includes('This page isn\'t working');
        });
        
        if (hasError) {
          console.log(chalk.yellow('⚠️ 브라우저 오류 감지 - 페이지 새로고침 시도'));
          await saveDebugScreenshot('browser-error-detected');
          
          // 페이지 새로고침
          await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise(r => setTimeout(r, 3000));
          
          console.log(chalk.green('✅ 페이지 새로고침 완료'));
          return true; // 복구 시도함
        }
        return false; // 오류 없음
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 오류 체크 실패: ${e.message}`));
        return false;
      }
    };
    
    // 먼저 현재 페이지가 이미 Premium 페이지인지 확인
    let currentInitialUrl = '';
    try {
      currentInitialUrl = this.page.url();
    } catch (e) {
      // URL 가져오기 실패 시 빈 문자열로 처리
      currentInitialUrl = '';
    }
    console.log(chalk.gray(`📍 현재 URL 확인: ${currentInitialUrl || '(빈 페이지)'}`));
    
    // 이미 올바른 페이지에 있는지 확인
    if (currentInitialUrl.includes('youtube.com/paid_memberships') || 
        currentInitialUrl.includes('youtube.com/premium')) {
      console.log(chalk.green('✅ 이미 YouTube Premium 페이지에 있음'));
      
      // Progress 업데이트
      if (updateProgress) {
        updateProgress('Premium 페이지 확인 완료');
      }
      
      // 페이지 내용 확인
      try {
        const hasManageButton = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes('Manage membership') ||
                 bodyText.includes('멤버십 관리') ||
                 bodyText.includes('Продлить или изменить') ||
                 bodyText.includes('Управление подпиской') ||
                 bodyText.includes('관리');
        });
        
        if (hasManageButton) {
          console.log(chalk.green('✅ Manage membership 버튼 확인됨'));
          pageLoaded = true;
          
          // 성공 시 바로 반환
          if (updateProgress) {
            updateProgress('Premium 페이지 로드 완료');
          }
          return { success: true };
        }
      } catch (e) {
        console.log(chalk.yellow('⚠️ 페이지 내용 확인 실패, 계속 진행'));
      }
    }
    
    while (retryCount < maxRetries) {
      try {
        // 전체 타임아웃 체크 (2분)
        const elapsedTime = Date.now() - navigationStartTime;
        if (elapsedTime > 120000) {
          console.log(chalk.red(`❌ 네비게이션 전체 타임아웃 (2분 초과)`));
          throw new Error('NAVIGATION_TOTAL_TIMEOUT');
        }

        console.log(chalk.cyan(`📄 [Navigation] YouTube Premium 페이지로 이동 (시도 ${retryCount + 1}/${maxRetries})`));
        
        // Progress 업데이트
        if (updateProgress) {
          updateProgress(`YouTube Premium 페이지로 이동 중 (시도 ${retryCount + 1}/${maxRetries})`);
        }
        
        // Step 1: 이동 전 스크린샷
        await saveDebugScreenshot('step1-before-navigation');
        
        // 브라우저 오류 체크 및 복구
        await checkAndRecoverFromError();
        
        // YouTube Premium 페이지로 Frame-safe 이동
        console.log(chalk.blue('🌐 이동 URL: https://www.youtube.com/paid_memberships'));

        try {
          // Enhanced Navigation Service 사용 (Frame Recovery 포함)
          const navResult = await this.navigationService.safeNavigate(
            this.page,
            'https://www.youtube.com/paid_memberships',
            {
              maxRetries: 3,
              extraRetryOnFrameError: true,
              timeout: 30000
            }
          );

          if (navResult.success) {
            console.log(chalk.green('✅ 페이지 정상 로드됨'));
            pageLoaded = true;
          }
        } catch (navError) {
          console.log(chalk.yellow(`⚠️ 페이지 이동 실패: ${navError.message}`));

          // 현재 URL 확인하여 실제로 이동되었는지 체크
          try {
            const url = await this.page.evaluate(() => window.location.href);
            if (url.includes('paid_memberships')) {
              console.log(chalk.green('✅ 에러에도 불구하고 페이지는 로드됨'));
              pageLoaded = true;
              break;
            }
          } catch (e) {
            // 페이지가 완전히 닫힌 경우
            throw navError;
          }
          throw navError;
        }
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Step 2: 페이지 로드 후 스크린샷
        await saveDebugScreenshot('step2-after-navigation');
        
        // Progress 업데이트 - 페이지 로드 직후
        if (updateProgress) {
          updateProgress('페이지 로딩 완료');
        }
        
        // 페이지 로드 후 다시 오류 체크 (Frame detached 에러 방지)
        try {
          const hadErrorAfterLoad = await checkAndRecoverFromError();
          if (hadErrorAfterLoad) {
            console.log(chalk.yellow('⚠️ 페이지 로드 후 오류 발생 - 재시도 필요'));
            retryCount++;
            continue;
          }
        } catch (checkError) {
          if (checkError.message.includes('detached Frame')) {
            console.log(chalk.yellow('⚠️ Frame 재연결 필요'));
            // 현재 페이지 상태만 확인
            try {
              const url = await this.page.evaluate(() => window.location.href);
              if (url.includes('paid_memberships')) {
                console.log(chalk.green('✅ 페이지는 정상적임'));
                pageLoaded = true;
                break;
              }
            } catch (e) {
              // 무시하고 계속
            }
          }
        }
        
        // 현재 URL로 로그인 상태 확인
        const currentUrl = this.page.url();
        const pageTitle = await this.page.title();
        console.log(chalk.gray(`📍 현재 URL: ${currentUrl}`));
        console.log(chalk.gray(`📝 페이지 제목: ${pageTitle}`));
        
        // 페이지 내용 디버깅
        const pageDebugInfo = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const hasSignInButton = bodyText.includes('Sign in') || bodyText.includes('로그인');
          const hasPremiumContent = bodyText.includes('Premium') || bodyText.includes('프리미엄');
          const hasResumeButton = bodyText.includes('Resume') || bodyText.includes('재개');
          const hasPauseButton = bodyText.includes('Pause') || bodyText.includes('일시중지');
          return {
            bodyLength: bodyText.length,
            hasSignInButton,
            hasPremiumContent,
            hasResumeButton,
            hasPauseButton,
            firstChars: bodyText.substring(0, 200)
          };
        });
        
        console.log(chalk.gray('📋 [DEBUG] 페이지 분석:'));
        console.log(chalk.gray(`  - 페이지 텍스트 길이: ${pageDebugInfo.bodyLength}문자`));
        console.log(chalk.gray(`  - Sign In 버튼: ${pageDebugInfo.hasSignInButton ? '있음' : '없음'}`));
        console.log(chalk.gray(`  - Premium 콘텐츠: ${pageDebugInfo.hasPremiumContent ? '있음' : '없음'}`));
        console.log(chalk.gray(`  - Resume 버튼: ${pageDebugInfo.hasResumeButton ? '있음' : '없음'}`));
        console.log(chalk.gray(`  - Pause 버튼: ${pageDebugInfo.hasPauseButton ? '있음' : '없음'}`));
        
        // YouTube Music으로 리다이렉트된 경우 처리
        if (currentUrl.includes('music.youtube.com') || 
            (pageTitle.toLowerCase().includes('music') && !pageTitle.toLowerCase().includes('premium'))) {
          console.log(chalk.yellow('⚠️ YouTube Music으로 리다이렉트됨. Premium으로 다시 이동...'));
          
          // YouTube Premium으로 명시적으로 Frame-safe 이동
          await this.navigationService.safeNavigate(
            this.page,
            'https://www.youtube.com/premium',
            {
              maxRetries: 2,
              timeout: 30000
            }
          );
          await new Promise(r => setTimeout(r, 3000));
        }
        
        // ★★★ 로그인 상태 판단 개선 - URL과 콘텐츠 기반 모두 확인 ★★★
        // URL 기반 체크
        const isLoginPageUrl = currentUrl.includes('accounts.google.com') || currentUrl.includes('signin');
        const isPremiumPageUrl = currentUrl.includes('youtube.com/paid_memberships') ||
                                  currentUrl.includes('youtube.com/premium');

        // 콘텐츠 기반 체크 (Premium 페이지 콘텐츠가 있으면 로그인됨)
        const hasPremiumContentSignal = pageDebugInfo.hasPremiumContent ||
                                        pageDebugInfo.hasResumeButton ||
                                        pageDebugInfo.hasPauseButton ||
                                        pageDebugInfo.bodyLength > 500;  // Premium 페이지는 콘텐츠가 많음

        // 로그인 판단: URL이 Premium 페이지이고 콘텐츠가 있거나, URL이 로그인 페이지가 아니면서 콘텐츠가 있으면 로그인됨
        const isLoggedIn = (isPremiumPageUrl && hasPremiumContentSignal) ||
                          (!isLoginPageUrl && hasPremiumContentSignal);

        console.log(chalk.gray(`📊 [DEBUG] 로그인 상태 판단:`));
        console.log(chalk.gray(`  - URL 기반: ${isLoginPageUrl ? '로그인 페이지' : (isPremiumPageUrl ? 'Premium 페이지' : '기타')}`));
        console.log(chalk.gray(`  - 콘텐츠 기반: ${hasPremiumContentSignal ? 'Premium 콘텐츠 있음' : 'Premium 콘텐츠 없음'}`));
        console.log(chalk.gray(`  - 최종 판단: ${isLoggedIn ? '✅ 로그인됨' : '❌ 로그인 필요'}`));

        if (isLoggedIn) {
          console.log(chalk.green(`✅ [Login] 이미 로그인되어 있음 - Premium 페이지 정상 로드`));
          pageLoaded = true;
          break;
        } else if (isLoginPageUrl) {
          // 로그인 페이지로 리디렉션된 경우에만 로그인 처리
          console.log(chalk.yellow(`🔐 [Login] 로그인 필요 (로그인 페이지로 리디렉션됨)`));
          
          // 로그인 처리 (result는 null로 전달 - navigateToPremiumPage에서는 result를 사용하지 않음)
          const loginResult = await this.handleLoginIfNeeded(null, null);
          
          // reCAPTCHA 감지된 경우 - 다음 계정으로 넘어가도록 특별한 에러 throw
          if (loginResult && (loginResult.error === 'RECAPTCHA_DETECTED' || loginResult.isRecaptcha)) {
            console.log(chalk.red('❌ reCAPTCHA 감지 - 재시도하지 않고 다음 계정으로 넘어갑니다'));
            const recaptchaError = new Error('RECAPTCHA_DETECTED');
            recaptchaError.isRecaptcha = true;  // 특별한 플래그 추가
            throw recaptchaError;  // while 루프를 빠져나가고 catch 블록으로 이동
          }

          // ★ 이미지 CAPTCHA 감지된 경우 - 재시도 가능하도록 처리
          if (loginResult && (loginResult.error === 'IMAGE_CAPTCHA_DETECTED' || loginResult.shouldRetry)) {
            console.log(chalk.yellow('🖼️ 이미지 CAPTCHA 감지 - 재시도 필요'));
            const captchaError = new Error('IMAGE_CAPTCHA_DETECTED');
            captchaError.isCaptcha = true;
            captchaError.shouldRetry = true;  // 재시도 플래그
            throw captchaError;
          }

          // 계정 사용 중지 처리
          if (loginResult && (loginResult.error === 'ACCOUNT_DISABLED' || loginResult.status === 'account_disabled')) {
            console.log(chalk.red('🚫 계정이 사용 중지되었습니다'));
            console.log(chalk.yellow(`  사유: ${loginResult.message || '계정 사용 중지'}`));

            // 결과 객체 생성 (오류를 throw하지 않고 결과 반환)
            const disabledResult = {
              profileName: this.profileName,
              success: false,
              error: '계정 사용 중지',
              status: '계정사용중지',
              email: this.email,
              message: loginResult.message || '계정이 사용 중지되었습니다',
              accountStatus: 'disabled',
              subscriptionStatus: '계정 사용 중지됨',
              nextBillingDate: 'N/A'
            };

            // 스크린샷 저장
            try {
              const timestamp = Date.now();
              const screenshotPath = path.join('screenshots', 'account-disabled',
                `${this.profileName}_disabled_${timestamp}.png`);
              await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
              await this.page.screenshot({ path: screenshotPath, fullPage: true });
              console.log(chalk.gray(`📸 계정 사용 중지 스크린샷: ${screenshotPath}`));
            } catch (e) {
              console.log(chalk.yellow(`⚠️ 스크린샷 저장 실패: ${e.message}`));
            }

            // 로그인 실패로 처리하고 다음 계정으로 넘어가도록
            return disabledResult;
          }

          // 일반 로그인 실패
          if (!loginResult || !loginResult.success) {
            console.log(chalk.red('❌ 로그인 실패'));
            throw new Error(loginResult?.error || '로그인 실패');
          }
          
          // 로그인 성공 후 세션 안정화
          console.log(chalk.yellow('\n  ⏳ 로그인 세션 안정화를 위해 대기 중...'));
          console.log(chalk.gray('    [세션 쿠키가 완전히 적용되도록 대기]'));
          
          // 1. 충분한 대기 시간
          console.log(chalk.gray('    [1/4] 세션 쿠키 설정 대기 (7초)...'));
          await new Promise(r => setTimeout(r, 7000));
          
          // 2. 현재 페이지 새로고침
          try {
            console.log(chalk.gray('    [2/4] 현재 페이지 새로고침...'));
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
            await new Promise(r => setTimeout(r, 3000));
          } catch (e) {
            console.log(chalk.gray('    ⚠️ 새로고침 실패, 계속 진행'));
          }
          
          // 3. YouTube 홈페이지로 이동
          try {
            console.log(chalk.gray('    [3/4] YouTube 홈페이지로 먼저 이동...'));
            await this.page.goto('https://www.youtube.com', {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            });
            await new Promise(r => setTimeout(r, 3000));
          } catch (e) {
            console.log(chalk.gray('    ⚠️ YouTube 홈 이동 실패, 계속 진행'));
          }
          
          // 4. YouTube Premium 페이지로 이동
          console.log(chalk.cyan('    [4/4] YouTube Premium 페이지로 이동...'));
          await this.page.goto('https://www.youtube.com/paid_memberships', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          
          await new Promise(r => setTimeout(r, 3000));
          
          console.log(chalk.green('  ✅ 로그인 세션 안정화 완료'));
          
          const finalUrl = this.page.url();
          const finalTitle = await this.page.title();
          
          // YouTube Music으로 리다이렉트된 경우 처리
          if (finalUrl.includes('music.youtube.com')) {
            console.log(chalk.yellow('⚠️ YouTube Music으로 리다이렉트됨. Premium으로 다시 이동...'));
            await this.page.goto('https://www.youtube.com/premium', {
              waitUntil: 'domcontentloaded',
              timeout: 30000
            });
            await new Promise(r => setTimeout(r, 3000));
          }
          
          if (finalUrl.includes('youtube.com/paid_memberships') || finalUrl.includes('youtube.com/premium') || 
              finalUrl.includes('youtube.com') && !finalUrl.includes('music')) {
            console.log(chalk.green('✅ YouTube Premium 페이지 로드 성공'));
            
            // 진행 상황 업데이트 - 중요!
            if (updateProgress) {
              updateProgress('Premium 페이지 로드 완료');
            }
            
            pageLoaded = true;
            break;
          } else if (finalUrl.includes('accounts.google.com')) {
            // 여전히 로그인 페이지에 있는 경우
            console.log(chalk.red('❌ 로그인 후에도 여전히 로그인 페이지에 있음'));
            throw new Error('로그인 실패 - 계정 문제 가능성');
          }
        } else {
          // ★★★ 로그인 페이지가 아니지만 Premium 콘텐츠도 없는 경우 ★★★
          // 페이지가 아직 로딩 중이거나 예상치 못한 상태일 수 있음
          console.log(chalk.yellow(`⚠️ [Login] 알 수 없는 상태 - 페이지 로딩 재시도`));
          console.log(chalk.gray(`  현재 URL: ${currentUrl}`));
          console.log(chalk.gray(`  페이지 로딩 완료 대기 후 재확인...`));

          // 추가 대기 후 재시도
          await new Promise(r => setTimeout(r, 3000));

          // 페이지 다시 확인
          const recheckUrl = this.page.url();
          const recheckContent = await this.page.evaluate(() => {
            const bodyText = document.body?.textContent || '';
            return {
              hasPremium: bodyText.includes('Premium') || bodyText.includes('프리미엄'),
              hasMemberships: bodyText.includes('Memberships') || bodyText.includes('멤버십'),
              hasResume: bodyText.includes('Resume') || bodyText.includes('재개'),
              hasPause: bodyText.includes('Pause') || bodyText.includes('일시중지')
            };
          });

          if (recheckUrl.includes('youtube.com') &&
              (recheckContent.hasPremium || recheckContent.hasMemberships ||
               recheckContent.hasResume || recheckContent.hasPause)) {
            console.log(chalk.green(`✅ [Login] 재확인 결과 - Premium 페이지 확인됨`));
            pageLoaded = true;
            break;
          }

          // 여전히 불명확한 경우 - 에러로 처리하지 않고 재시도 유도
          console.log(chalk.yellow(`⚠️ 페이지 상태 불명확 - 다음 시도에서 재확인`));
        }

      } catch (error) {
        // reCAPTCHA 에러는 재시도하지 않고 바로 전파
        if (error.isRecaptcha || error.message === 'RECAPTCHA_DETECTED') {
          this.log('🛑 reCAPTCHA 감지 - 재시도하지 않고 즉시 중단', 'warning');
          throw error;  // 에러를 상위로 전파하여 다음 계정 처리 (while 루프 즉시 종료)
        }

        // ★ 이미지 CAPTCHA 에러 - shouldRetry가 true면 재시도 허용
        if (error.isCaptcha || error.message === 'IMAGE_CAPTCHA_DETECTED') {
          this.log('🖼️ 이미지 CAPTCHA 감지로 인한 재시도 필요', 'warning');
          throw error;  // 상위로 전파하여 재시도 로직에서 처리
        }

        retryCount++;
        this.log(`페이지 이동 실패 (시도 ${retryCount}/${maxRetries}): ${error.message}`, 'warning');
        
        if (retryCount < maxRetries) {
          // 네트워크 오류인 경우 특별 처리
          if (error.message.includes('ERR_FAILED') || 
              error.message.includes('ERR_CONNECTION') ||
              error.message.includes('네트워크 오류')) {
            
            this.log('네트워크 오류 감지, 브라우저 캐시 정리 및 재시도', 'warning');
            
            // 브라우저 캐시 정리 시도
            try {
              await this.page.evaluate(() => {
                // 로컬 스토리지 정리
                localStorage.clear();
                sessionStorage.clear();
              });
            } catch (e) {
              // 무시
            }
            
            // 대기 시간을 점진적으로 증가
            const waitTime = 3000 * retryCount;
            this.log(`${waitTime/1000}초 대기 후 재시도`, 'info');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // 페이지 새로고침 시도
            try {
              await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (reloadError) {
              this.log('새로고침 실패, YouTube 홈페이지 경유 시도', 'warning');
              // YouTube 홈페이지를 거쳐서 이동
              try {
                await this.page.goto('https://www.youtube.com', {
                  waitUntil: 'domcontentloaded',
                  timeout: 20000
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
              } catch (homeError) {
                // 무시하고 직접 이동 시도
              }
            }
          }
        } else {
          this.log('최대 재시도 횟수 초과', 'warning');

          // Progress 업데이트
          if (updateProgress) {
            updateProgress('페이지 로드 재시도 초과 - 현재 상태 확인');
          }

          // 현재 페이지가 로그인 페이지인지 먼저 확인
          const currentUrl = this.page.url();

          // ⚠️ 중요: 로그인 페이지에 있으면 절대 성공으로 판단하지 않음!
          if (currentUrl.includes('accounts.google.com')) {
            this.log('로그인 페이지에서 벗어나지 못함 - 자동 로그인 실패', 'error');
            throw new Error('자동 로그인 실패 - 로그인 페이지에서 진행 불가');
          }

          if (currentUrl.includes('youtube.com')) {
            this.log('현재 페이지가 YouTube이므로 계속 진행', 'info');
          } else {
            this.log('YouTube가 아닌 페이지에서 진행 - 워크플로우 실패 가능', 'error');
            throw new Error('YouTube Premium 페이지 로드 실패');
          }
        }
      }
    }
  }
  
  /**
   * 로그인이 필요한 경우 처리 (Minimal 모드 통합)
   */
  async handleLoginIfNeeded(loginDetails = null, result = null) {
    console.log(chalk.cyan('\n🔐 [Login Process] 로그인 처리 시작'));
    
    // 디버깅을 위한 스크린샷 저장 함수
    const saveDebugScreenshot = async (step, suffix = '') => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `debug-login-${step}${suffix ? '-' + suffix : ''}-${timestamp}.png`;
        const filepath = path.join('screenshots', 'debug', filename);
        await fs.mkdir(path.join('screenshots', 'debug'), { recursive: true });
        await this.page.screenshot({ path: filepath, fullPage: true });
        console.log(chalk.gray(`📸 [DEBUG] 스크린샷 저장: ${filename}`));
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 디버그 스크린샷 저장 실패: ${e.message}`));
      }
    };
    
    try {
      this.log('🔍 로그인 상태 확인 중...', 'info');
      console.log(chalk.blue('  [Step 1/5] 로그인 상태 확인'));
      
      // 로그인 확인 전 스크린샷
      await saveDebugScreenshot('status-check-before');
      
      // 로그인 모드 확인 - improved 모드를 기본으로
      const loginMode = this.config?.loginMode || process.env.LOGIN_MODE || 'improved';
      const useImprovedMode = loginMode === 'improved' || this.config?.useImprovedAuth === true;
      const useMacroMode = loginMode === 'macro';
      const useMinimalMode = loginMode === 'minimal' && !useImprovedMode;
      
      console.log(chalk.gray(`  로그인 모드: ${loginMode}`));
      
      // 로그인 상태 확인
      let isLoggedIn = false;
      let needsLogin = false;
      
      if (useImprovedMode) {
        // Improved 모드에서는 authService 사용 (ImprovedAuthenticationService)
        try {
          this.log('🔍 개선된 로그인 서비스로 상태 확인 중...', 'debug');
          isLoggedIn = await this.authService.checkLoginStatus(this.page);
          this.log(`✅ 로그인 상태 체크 완료: ${isLoggedIn}`, 'debug');
        } catch (checkError) {
          this.log(`❌ checkLoginStatus 에러: ${checkError.message}`, 'error');
          throw checkError;
        }
        needsLogin = loginDetails ? !loginDetails.isLoggedIn : !isLoggedIn;
      } else if (useMacroMode) {
        // Macro 모드에서는 직접 체크
        const GoogleLoginHelperMacro = require('../../infrastructure/adapters/GoogleLoginHelperMacro');
        const macroHelper = new GoogleLoginHelperMacro(this.page, { debugMode: this.config?.debugMode });
        isLoggedIn = await macroHelper.checkLoginStatus();
        needsLogin = !isLoggedIn;
      } else if (useMinimalMode) {
        // Minimal 모드에서는 직접 체크
        const GoogleLoginHelperMinimal = require('../../infrastructure/adapters/GoogleLoginHelperMinimal');
        const minimalHelper = new GoogleLoginHelperMinimal(this.page, null, { debugMode: this.config?.debugMode });
        isLoggedIn = await minimalHelper.checkLoginStatus();
        needsLogin = !isLoggedIn;
      } else {
        // 기존 방식
        try {
          this.log('🔍 authService.checkLoginStatus 호출 중...', 'debug');
          isLoggedIn = await this.authService.checkLoginStatus(this.page);
          this.log(`✅ 로그인 상태 체크 완료: ${isLoggedIn}`, 'debug');
        } catch (checkError) {
          this.log(`❌ checkLoginStatus 에러: ${checkError.message}`, 'error');
          throw checkError;
        }
        needsLogin = loginDetails ? !loginDetails.isLoggedIn : !isLoggedIn;
      }
      
      if (needsLogin) {
        console.log(chalk.yellow('  ⚠️ 로그인 필요 감지'));
        
        const modeName = useImprovedMode ? 'Improved (계정 선택/reCAPTCHA 처리)' : 
                        (useMacroMode ? 'Macro' : (useMinimalMode ? 'Minimal' : '기존'));
        this.log(`🔐 로그인이 필요합니다. ${modeName} 모드로 로그인 시작...`, 'warning');
        console.log(chalk.blue(`  [Step 2/5] ${modeName} 모드로 로그인 시작`));
        
        // 로그인 필요 상태 스크린샷
        await saveDebugScreenshot('login-required');
        
        // loginDetails에서 로그인 단계 정보 활용
        if (loginDetails && loginDetails.needsAction) {
          this.log(`현재 로그인 단계: ${loginDetails.stage}, 필요한 작업: ${loginDetails.needsAction}`, 'info');
          console.log(chalk.gray(`  현재 단계: ${loginDetails.stage}, 필요 작업: ${loginDetails.needsAction}`));
        }
        
        // Google Sheets에서 계정 정보 가져오기 (올바른 컬럼 매핑)
        const accountInfo = {
          email: this.profileData?.email || this.profileData?.googleId,
          password: this.profileData?.password,       // B열
          recoveryEmail: this.profileData?.recoveryEmail, // C열  
          totpSecret: this.profileData?.code || this.profileData?.totpSecret // D열
        };
        
        this.log(`📧 로그인 계정: ${accountInfo.email}`, 'info');
        console.log(chalk.cyan(`  📧 계정: ${accountInfo.email}`));
        
        if (!accountInfo.email || !accountInfo.password) {
          this.log('❌ 로그인 정보가 없습니다. 수동 로그인이 필요합니다.', 'error');
          console.log(chalk.red('  ❌ 로그인 정보 없음'));
          await saveDebugScreenshot('login-info-missing');
          throw new Error('로그인 정보 없음');
        }
        
        // TOTP 시크릿 키 확인
        if (accountInfo.totpSecret) {
          this.log(`✅ TOTP 시크릿 키 존재`, 'success');
          console.log(chalk.green('  ✅ TOTP 키 존재'));
        } else {
          this.log(`⚠️ TOTP 시크릿 키 없음`, 'warning');
          console.log(chalk.yellow('  ⚠️ TOTP 키 없음'));
        }
        
        // 현재 페이지 상태 확인
        const currentUrl = this.page.url();
        this.log(`📍 로그인 시작 URL: ${currentUrl}`, 'info');
        console.log(chalk.gray(`  현재 URL: ${currentUrl}`));
        
        let loginResult;
        
        if (useImprovedMode) {
          // Improved 모드 로그인 (계정 선택 페이지, reCAPTCHA 처리 포함)
          this.log('✨ Improved 모드 로그인 시작 (계정 선택/reCAPTCHA 자동 처리)...', 'info');
          console.log(chalk.blue('  [Step 3/5] 이메일 입력'));
          
          // 로그인 시작 전 스크린샷
          await saveDebugScreenshot('login-start');
          
          try {
            loginResult = await this.authService.handleAuthentication(this.page, {
              email: accountInfo.email,
              password: accountInfo.password,
              totpSecret: accountInfo.totpSecret
            });
            
            // 로그인 완료 후 스크린샷
            await saveDebugScreenshot('login-after-auth');
            
            // 계정 잠김 감지된 경우 처리
            if (loginResult === 'ACCOUNT_LOCKED' || loginResult.error === 'ACCOUNT_LOCKED') {
              this.log('🔒 계정이 잠겨있습니다. 수동 복구가 필요합니다.', 'error');
              console.log(chalk.red('  🔒 계정 잠김 감지'));
              
              await saveDebugScreenshot('account-locked');
              
              // 계정 잠김 플래그 설정
              if (result) {
                result.accountLocked = true;
                result.lockedTime = new Date().toLocaleString('ko-KR');
                result.status = '계정잠김';
                result.error = '🔒 계정 잠김 - 수동 복구 필요 (Account disabled by Google)';
              }
              
              // 계정 잠김 에러 throw (재시도하지 않음)
              const lockError = new Error('ACCOUNT_LOCKED');
              lockError.isAccountLocked = true;
              lockError.skipRetry = true;  // 재시도 방지
              throw lockError;
            }
            
            // reCAPTCHA 감지된 경우 처리
            if (loginResult.error === 'RECAPTCHA_DETECTED') {
              this.log('⚠️ reCAPTCHA가 감지되었습니다.', 'warning');
              console.log(chalk.yellow('  🤖 reCAPTCHA 감지'));
              
              await saveDebugScreenshot('recaptcha-detected');
              
              // reCAPTCHA 플래그 설정 (나중에 한 번만 업데이트)
              if (result) {
                result.recaptchaDetected = true;
                result.recaptchaTime = new Date().toLocaleString('ko-KR');
              }
              
              // reCAPTCHA 결과 반환 (throw하지 않음)
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }
            
            console.log(chalk.green('  ✅ 인증 성공'));
            
          } catch (error) {
            await saveDebugScreenshot('login-error');
            
            // reCAPTCHA 에러인 경우 그대로 반환
            if (error.message === 'RECAPTCHA_DETECTED' || error.isRecaptcha) {
              this.log('🤖 reCAPTCHA 감지됨 - 로그인 중단', 'warning');
              console.log(chalk.yellow('  🤖 reCAPTCHA로 인한 로그인 중단'));
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }
            
            this.log(`❌ Improved 모드 로그인 실패: ${error.message}`, 'error');
            console.log(chalk.red(`  ❌ 로그인 실패: ${error.message}`));
            loginResult = { success: false, error: error.message };
          }
          
        } else if (useMacroMode) {
          // Macro 모드 로그인
          this.log('🖱️ Macro 모드 로그인 시작 (인간처럼 마우스 움직임)...', 'info');
          const GoogleLoginHelperMacro = require('../../infrastructure/adapters/GoogleLoginHelperMacro');
          const macroHelper = new GoogleLoginHelperMacro(this.page, { 
            debugMode: this.config?.debugMode,
            screenshotEnabled: true,
            mouseSpeed: 'normal',
            typingSpeed: 'normal'
          });
          
          loginResult = await macroHelper.login({
            email: accountInfo.email,
            password: accountInfo.password,
            totpSecret: accountInfo.totpSecret
          });
          
          // boolean을 객체로 변환
          loginResult = { success: loginResult === true };
          
        } else if (useMinimalMode) {
          // Minimal 모드 로그인
          this.log('🚀 Minimal 모드 로그인 시작 (브라우저 환경 무수정)...', 'info');
          const GoogleLoginHelperMinimal = require('../../infrastructure/adapters/GoogleLoginHelperMinimal');
          const minimalHelper = new GoogleLoginHelperMinimal(this.page, null, { 
            debugMode: this.config?.debugMode,
            screenshotEnabled: true 
          });
          
          loginResult = await minimalHelper.login({
            email: accountInfo.email,
            password: accountInfo.password,
            totpSecret: accountInfo.totpSecret
          });
          
          // boolean을 객체로 변환
          loginResult = { success: loginResult === true };
          
        } else {
          // 기존 인증 서비스로 로그인
          this.log('🚀 기존 인증 서비스로 로그인 시작...', 'info');

          // page 객체 확인
          if (!this.page) {
            this.log('❌ page 객체가 없습니다. 브라우저가 제대로 초기화되지 않았습니다.', 'error');
            throw new Error('page 객체가 초기화되지 않음');
          }

          try {
            // 로그인 전에 현재 페이지 확인 - 알 수 없는 페이지인 경우 Google로 이동
            const currentUrl = await this.page.evaluate(() => window.location.href);
            console.log(chalk.gray(`  🔍 로그인 전 URL 확인: ${currentUrl}`));

            // IP 확인 API나 알 수 없는 페이지에 있는 경우 Google 로그인으로 직접 이동
            if (currentUrl.includes('api.ipify.org') ||
                currentUrl.includes('ipinfo.io') ||
                currentUrl.includes('whatismyipaddress') ||
                currentUrl === 'about:blank' ||
                currentUrl === '') {
              console.log(chalk.yellow('  ⚠️ 알 수 없는 페이지 감지 - Google 로그인 페이지로 직접 이동'));
              await this.page.goto('https://accounts.google.com/signin', {
                waitUntil: 'networkidle2',
                timeout: 30000
              });
              await new Promise(r => setTimeout(r, 3000));
              console.log(chalk.green('  ✅ Google 로그인 페이지로 이동 완료'));
            }

            // ImprovedAuthenticationService의 handleAuthentication 메서드 사용
            loginResult = await this.authService.handleAuthentication(this.page, {
              email: accountInfo.email,
              password: accountInfo.password,
              totpSecret: accountInfo.totpSecret,
              profileId: accountInfo.profileId,
              maxRetries: loginAttempt === 1 ? 2 : 1  // 첫 시도시 2번, 이후 1번만 재시도
            });

            // reCAPTCHA 감지 체크
            if (loginResult.error === 'RECAPTCHA_DETECTED') {
              this.log('⚠️ reCAPTCHA가 감지되었습니다.', 'warning');

              // reCAPTCHA 플래그 설정 (나중에 한 번만 업데이트)
              if (result) {
                result.recaptchaDetected = true;
                result.recaptchaTime = new Date().toLocaleString('ko-KR');
              }

              // reCAPTCHA 에러를 throw하여 즉시 중단
              const recaptchaError = new Error('RECAPTCHA_DETECTED');
              recaptchaError.isRecaptcha = true;
              throw recaptchaError;
            } else {
              // 반환값이 이미 성공 여부를 포함하므로 그대로 사용
              this.log(`로그인 결과: ${loginResult.success ? '성공' : '실패'}`, loginResult.success ? 'success' : 'error');
              if (!loginResult.success) {
                this.log(`실패 이유: ${loginResult.error || '알 수 없음'}`, 'error');

                // 로그인 실패 시 한 번 더 페이지를 초기화하고 재시도
                if (loginAttempt === 1 && !loginResult.skipRetry) {
                  console.log(chalk.yellow('  🔄 로그인 실패 - Google 로그인 페이지로 다시 이동 후 재시도'));
                  await this.page.goto('https://accounts.google.com/signin', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                  });
                  await new Promise(r => setTimeout(r, 3000));

                  // 재시도
                  loginResult = await this.authService.handleAuthentication(this.page, {
                    email: accountInfo.email,
                    password: accountInfo.password,
                    totpSecret: accountInfo.totpSecret,
                    profileId: accountInfo.profileId,
                    maxRetries: 1  // 한 번만 시도
                  });

                  if (loginResult.success) {
                    console.log(chalk.green('  ✅ 재시도 성공!'));
                  }
                }
              }
            }
          } catch (loginError) {
            this.log(`💥 handleAuthentication 호출 중 오류: ${loginError.message}`, 'error');
            if (loginError.stack) {
              this.log(`스택 추적:\n${loginError.stack}`, 'debug');
            }

            // 로그인 오류시에도 한 번 재시도 (무한 루프 방지를 위해 첫 번째 시도에서만)
            if (loginAttempt === 1 && !loginError.skipRetry && !loginError.isAccountLocked) {
              console.log(chalk.yellow('  🔄 로그인 오류 - 페이지 재초기화 후 재시도'));

              try {
                await this.page.goto('https://accounts.google.com/signin', {
                  waitUntil: 'networkidle2',
                  timeout: 30000
                });
                await new Promise(r => setTimeout(r, 3000));

                loginResult = await this.authService.handleAuthentication(this.page, {
                  email: accountInfo.email,
                  password: accountInfo.password,
                  totpSecret: accountInfo.totpSecret,
                  profileId: accountInfo.profileId,
                  maxRetries: 1
                });

                if (loginResult.success) {
                  console.log(chalk.green('  ✅ 재시도로 로그인 성공!'));
                } else {
                  throw loginError;  // 재시도도 실패하면 원래 에러 throw
                }
              } catch (retryError) {
                throw loginError;  // 재시도 실패시 원래 에러 throw
              }
            } else {
              throw loginError;
            }
          }
        }
        
        if (loginResult.success) {
          const modeName = useImprovedMode ? 'Improved' : (useMacroMode ? 'Macro' : (useMinimalMode ? 'Minimal' : '기존'));
          this.log(`✅ 자동 로그인 성공 (${modeName} 모드)`, 'success');
          console.log(chalk.green(`  ✅ 로그인 성공 (${modeName} 모드)`));
          
          // 로그인 성공 스크린샷
          await saveDebugScreenshot('login-success');
          
          // 로그인 후 URL 확인
          const afterLoginUrl = this.page.url();
          this.log(`📍 로그인 후 URL: ${afterLoginUrl}`, 'info');
          console.log(chalk.gray(`  로그인 후 URL: ${afterLoginUrl}`));
          
          // 로그인 결과에서 리디렉션 정보 확인 (ImprovedAuthenticationService에서 반환)
          if (loginResult.redirected && loginResult.targetUrl) {
            if (loginResult.targetUrl.includes('youtube.com/paid_memberships') || 
                loginResult.targetUrl.includes('youtube.com/premium')) {
              this.log('✅ 로그인 후 YouTube Premium 페이지로 자동 리디렉션됨', 'success');
              console.log(chalk.green('  ✅ Premium 페이지로 자동 리디렉션'));
              await saveDebugScreenshot('login-auto-redirected');
              await new Promise(r => setTimeout(r, 3000));
              return true;
            }
          }
          
          // WorkingAuthenticationService가 이미 YouTube Premium 페이지로 이동했는지 확인
          if (loginResult.navigatedToPremium) {
            this.log('✅ YouTube Premium 페이지로 자동 이동 완료', 'success');
            console.log(chalk.green('  ✅ Premium 페이지 자동 이동 완료'));
            await saveDebugScreenshot('login-navigated-to-premium');
            await new Promise(r => setTimeout(r, 3000));
            return true;
          }
          
          // 현재 URL이 이미 YouTube Premium 페이지인지 확인
          if (afterLoginUrl.includes('youtube.com/paid_memberships') || 
              afterLoginUrl.includes('youtube.com/premium')) {
            this.log('✅ 이미 YouTube Premium 페이지에 있습니다', 'success');
            console.log(chalk.green('  ✅ 이미 Premium 페이지에 위치'));
            await saveDebugScreenshot('login-already-on-premium');
            await new Promise(r => setTimeout(r, 3000));
            return true;
          }
          
          // YouTube Premium 페이지로 다시 이동
          this.log('🎯 YouTube Premium 페이지로 이동 중...', 'info');
          console.log(chalk.blue('  [Step 5/5] Premium 페이지로 이동'));
          
          try {
            await this.page.goto('https://www.youtube.com/paid_memberships', {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            });
            await new Promise(r => setTimeout(r, 3000));
            
            // 페이지 로딩 완료 확인
            const finalUrl = this.page.url();
            this.log(`📍 최종 페이지 URL: ${finalUrl}`, 'info');
            console.log(chalk.gray(`  최종 URL: ${finalUrl}`));
            
            await saveDebugScreenshot('login-final-navigation');
            
          } catch (navError) {
            this.log(`⚠️ 네비게이션 오류: ${navError.message}`, 'warning');
            console.log(chalk.yellow(`  ⚠️ 네비게이션 오류: ${navError.message}`));
            await saveDebugScreenshot('login-navigation-error');
            // 네비게이션 오류가 발생해도 계속 진행
          }
          
          console.log(chalk.green('🔐 [Login Process] 로그인 완료\n'));
          
          // 로그인 성공 반환
          return { success: true };
          
        } else {
          this.log(`❌ 자동 로그인 실패: ${loginResult.reason}`, 'error');
          console.log(chalk.red(`  ❌ 로그인 실패: ${loginResult.reason || '알 수 없음'}`));
          
          // 로그인 실패 스크린샷
          await saveDebugScreenshot('login-failed');
          
          // 실패 이유별 처리
          if (loginResult.reason === 'RECAPTCHA_DETECTED') {
            this.log('🛡️ reCAPTCHA 감지 - 번호인증계정으로 표시', 'warning');
            console.log(chalk.yellow('  🛡️ reCAPTCHA 감지'));
            await saveDebugScreenshot('login-recaptcha');
            throw new Error('RECAPTCHA_DETECTED');
          } else if (loginResult.reason === 'TOTP secret missing') {
            this.log('⚠️ TOTP 시크릿 키가 없습니다. 2단계 인증 설정 확인 필요', 'warning');
            console.log(chalk.yellow('  ⚠️ TOTP 키 누락'));
            await saveDebugScreenshot('login-totp-missing');
          } else if (loginResult.reason === 'Wrong password') {
            this.log('❌ 비밀번호가 틀렸습니다. 구글 시트 데이터 확인 필요', 'error');
            console.log(chalk.red('  ❌ 잘못된 비밀번호'));
            await saveDebugScreenshot('login-wrong-password');
          }
          
          // 실패 시 추가 디버깅 정보
          const debugInfo = await this.page.evaluate(() => {
            return {
              url: window.location.href,
              title: document.title,
              hasPasswordField: document.querySelector('input[type="password"]') !== null,
              hasAccountChooser: document.querySelector('[data-identifier]') !== null,
              pageText: document.body.innerText.substring(0, 300)
            };
          });
          
          this.log(`🔍 로그인 실패 디버깅 정보:`, 'error');
          this.log(`   URL: ${debugInfo.url}`, 'error');
          this.log(`   제목: ${debugInfo.title}`, 'error');
          this.log(`   비밀번호 필드: ${debugInfo.hasPasswordField ? '있음' : '없음'}`, 'error');
          this.log(`   계정 선택 페이지: ${debugInfo.hasAccountChooser ? '있음' : '없음'}`, 'error');
          this.log(`   페이지 내용: ${debugInfo.pageText}...`, 'error');
          
          throw new Error('자동 로그인 실패');
        }
      } else {
        this.log('✅ 이미 로그인되어 있습니다.', 'info');
        console.log(chalk.green('  ✅ 이미 로그인되어 있음'));
        
        // 로그인된 상태 스크린샷
        await saveDebugScreenshot('already-logged-in');
        
        console.log(chalk.green('🔐 [Login Process] 로그인 확인 완료 (이미 로그인됨)\n'));
        
        return { success: true, alreadyLoggedIn: true };
      }
      
    } catch (error) {
      this.log(`💥 로그인 처리 중 오류: ${error.message}`, 'error');
      console.log(chalk.red(`  💥 로그인 오류: ${error.message}`));
      
      // 오류 발생 시 현재 페이지 스크린샷 저장
      try {
        await saveDebugScreenshot('login-error-critical');
        
        const timestamp = Date.now();
        const screenshotPath = `screenshots/login_error_${timestamp}.png`;
        await this.page.screenshot({ path: screenshotPath });
        this.log(`📸 오류 스크린샷 저장: ${screenshotPath}`, 'warning');
      } catch (e) {
        this.log('스크린샷 저장 실패', 'warning');
      }
      
      console.log(chalk.red('🔐 [Login Process] 로그인 처리 실패\n'));
      
      // 에러를 반환값으로 전달
      return { success: false, error: error.message };
    }
  }

  /**
   * 페이지 언어 감지
   */
  async detectPageLanguage(browser) {
    const pageText = await this.page.evaluate(() => document.body?.textContent || '');
    return detectLanguage(pageText);
  }

  /**
   * 현재 상태 확인 (개선된 버튼 확인 방식)
   */
  async checkCurrentStatus(browser) {
    const lang = languages[this.currentLanguage];

    this.log('📋 초기 상태 체크 시작', 'info');

    // [v2.6 개선] 먼저 Resume/Pause 버튼이 이미 보이는지 확인
    // 이미 보이면 Manage membership 클릭 시 패널이 닫히므로 클릭 스킵
    const buttonsAlreadyVisible = await this.page.evaluate((langData) => {
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        const hasPause = langData.buttons.pause?.some(p => text.includes(p));
        const hasResume = langData.buttons.resume?.some(r => text.includes(r));
        if (hasPause || hasResume) {
          console.log(`[checkCurrentStatus-Resume] 이미 버튼 보임: "${text}"`);
          return { visible: true, buttonText: text };
        }
      }
      return { visible: false };
    }, lang);

    if (buttonsAlreadyVisible.visible) {
      this.log(`Resume/Pause 버튼 이미 표시됨: "${buttonsAlreadyVisible.buttonText}" - Manage 클릭 스킵`, 'info');
    } else {
      // [v2.10] 멤버십 관리 버튼 클릭 시도 (최대 3회 재시도)
      // 페이지 전환 직후 DOM이 완전히 렌더링되기 전에 클릭하면 실패할 수 있음
      const maxRetries = 3;
      let clicked = false;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const clickTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Manage 버튼 클릭 타임아웃')), 15000)
          );

          clicked = await Promise.race([
            this.clickManageButton(),
            clickTimeout
          ]);

          if (clicked) {
            this.log(`✅ Manage 버튼 클릭 성공 (시도 ${attempt}/${maxRetries})`, 'success');
            break;
          }
        } catch (clickError) {
          lastError = clickError;
        }

        if (!clicked && attempt < maxRetries) {
          this.log(`⚠️ Manage 버튼 클릭 실패 (시도 ${attempt}/${maxRetries}) - ${3}초 후 재시도...`, 'warning');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      if (!clicked) {
        this.log('❌ Manage membership 버튼 클릭 실패 (모든 재시도 소진)', 'error');
        throw new Error('Manage membership 버튼 클릭 실패 - 상태 확인 불가능');
      }
    }

    // 페이지가 완전히 로드될 때까지 대기 (중요!)
    await new Promise(resolve => setTimeout(resolve, 4000));

    // DOM이 안정화될 때까지 대기 - Puppeteer 방식
    try {
      await this.page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: 10000 }
      );
    } catch (e) {
      // 타임아웃 무시
    }

    // 확장 영역 감지 (인라인 확장 지원)
    // YouTube는 팝업이 아닌 인라인 확장을 사용하므로, 버튼 존재 여부로 확장 성공 판단
    const expansionResult = await this.page.evaluate((langData) => {
      // 확장 후 나타나는 주요 버튼/텍스트 패턴
      const expansionIndicators = [
        // 버튼 패턴
        ...langData.buttons.pause,    // Pause, 일시중지 등
        ...langData.buttons.resume,   // Resume, 재개 등
        'Cancel', 'Cancelar', 'Annuler', 'キャンセル', '취소',
        'Edit', 'Editar', 'Modifier', '編集', '편집',
        // 텍스트 패턴
        'Family sharing settings', 'Backup payment method',
        'Billed with', 'Next billing date',
        '가족 공유 설정', '백업 결제 수단'
      ];

      // 페이지 전체 텍스트
      const pageText = document.body?.textContent || '';

      // 버튼 검색
      const allButtons = document.querySelectorAll('button, [role="button"], yt-button-renderer, tp-yt-paper-button');
      let visibleButtonCount = 0;
      let foundIndicators = [];

      for (const btn of allButtons) {
        const btnText = btn.textContent?.trim();
        const rect = btn.getBoundingClientRect();

        // 가시성 체크
        if (rect.height > 0 && rect.width > 0) {
          visibleButtonCount++;

          // 확장 지표 매칭
          for (const indicator of expansionIndicators) {
            if (btnText && btnText.includes(indicator)) {
              foundIndicators.push(btnText);
              break;
            }
          }
        }
      }

      // 텍스트 지표도 확인 (버튼이 아닌 경우)
      for (const indicator of ['Family sharing settings', 'Backup payment method', 'Next billing date']) {
        if (pageText.includes(indicator)) {
          foundIndicators.push(`텍스트: ${indicator}`);
        }
      }

      const found = foundIndicators.length > 0 || visibleButtonCount > 5;

      return {
        found: found,
        method: foundIndicators.length > 0 ? 'indicator' : 'buttonCount',
        visibleButtonCount: visibleButtonCount,
        foundIndicators: foundIndicators.slice(0, 5)  // 최대 5개만
      };
    }, lang);

    if (!expansionResult.found) {
      this.log('❌ Manage membership 확장 감지 실패', 'error');
      this.log(`  - 가시적 버튼: ${expansionResult.visibleButtonCount}개`, 'error');
      throw new Error('Manage membership 확장 감지 실패 - 확장 지표를 찾을 수 없음');
    }

    this.log('✅ Manage 확장 확인됨', 'success');
    this.log(`  - 감지 방법: ${expansionResult.method}`, 'info');
    this.log(`  - 가시적 버튼: ${expansionResult.visibleButtonCount}개`, 'info');
    if (expansionResult.foundIndicators.length > 0) {
      this.log(`  - 확장 지표: ${expansionResult.foundIndicators.join(', ')}`, 'info');
    }

    // 상태 확인 - 개선된 버튼 확인 로직
    const status = await this.page.evaluate((langData) => {
      const pageText = document.body?.textContent || '';
      const result = {
        isActive: false,
        isPaused: false,
        isPausedScheduled: false,  // 일시정지 예약 상태 추가
        hasResumeButton: false,
        hasPauseButton: false,
        nextBillingDate: null,
        pauseScheduledDate: null,  // 일시정지 예약 날짜
        resumeScheduledDate: null,  // 재개 예약 날짜
        isExpired: false,  // 만료 상태 추가
        expiredIndicator: null,  // 만료 감지 지표
        debugInfo: {}  // 디버깅 정보 추가
      };

      // 디버깅용 정보 수집
      result.debugInfo.pageTextLength = pageText.length;
      result.debugInfo.hasBodyContent = !!document.body;

      // 가족 멤버십 활성 상태 빠른 감지
      if ((pageText.includes('가족 멤버십') || pageText.includes('Family membership')) &&
          (pageText.includes('PKR 899.00/월') || pageText.includes('PKR 899.00/mo') ||
           pageText.includes('₩8,690/월') || pageText.includes('$14.99/mo'))) {
        // 멤버십 관리 버튼이 있는지 확인
        const hasManageButton = pageText.includes('멤버십 관리') || pageText.includes('Manage membership') ||
                                pageText.includes('Продлить или изменить') || pageText.includes('Управление подпиской');
        if (hasManageButton && !pageText.includes('재개') && !pageText.includes('Resume')) {
          result.isActive = true;
          result.membershipType = 'family';
          console.log('가족 멤버십 활성 상태 감지됨');
          return result;
        }
      }

      // =================== 상태 감지 핵심 로직 (Manage 확장 영역 내 버튼 검색) ===================

      // ✅ 버튼 가시성 엄격 체크 함수
      function isButtonReallyVisible(btn) {
        if (!btn) return false;

        const rect = btn.getBoundingClientRect();
        const style = window.getComputedStyle(btn);

        const checks = {
          hasSize: rect.height > 0 && rect.width > 0,
          notDisplayNone: style.display !== 'none',
          notVisibilityHidden: style.visibility !== 'hidden',
          notOpacityZero: parseFloat(style.opacity) > 0.1,
          inViewport: rect.top >= -rect.height && rect.left >= -rect.width
        };

        return Object.values(checks).every(check => check === true);
      }

      // ✅ 버튼 텍스트 매칭 함수 (단어 기반)
      function isButtonMatch(btnText, keywords) {
        if (!btnText) return false;

        const normalizedBtnText = btnText.toLowerCase().trim();

        return keywords.some(keyword => {
          const normalizedKeyword = keyword.toLowerCase().trim();

          // 정확히 일치
          if (normalizedBtnText === normalizedKeyword) {
            return true;
          }

          // 키워드로 시작하고, 그 다음이 공백이거나 끝
          // 예: "Pause" → "Pause", "Pause membership" 매칭
          // 예: "Pause" → "Membership pauses on" 매칭 안됨
          const afterKeyword = normalizedBtnText.substring(normalizedKeyword.length);
          if (normalizedBtnText.startsWith(normalizedKeyword) &&
              (afterKeyword === '' || afterKeyword.startsWith(' '))) {
            return true;
          }

          // 단어로 포함 (공백으로 시작하는 경우)
          // 예: "Cancel" → " Cancel" 매칭
          if (normalizedBtnText.includes(' ' + normalizedKeyword + ' ') ||
              normalizedBtnText.includes(' ' + normalizedKeyword)) {
            return true;
          }

          return false;
        });
      }

      // ✅ 전체 페이지에서 버튼 검색 (인라인 확장 지원)
      // YouTube는 인라인 확장을 사용하므로 별도 확장 영역이 없음
      const allButtons = document.querySelectorAll('button, [role="button"], yt-button-renderer, tp-yt-paper-button');
      console.log(`🔎 검색할 버튼 개수: ${allButtons.length}개`);

      // ✅ Resume/Pause 버튼 확인 (단어 기반 매칭)
      let hasResumeButton = false;
      let hasPauseButton = false;

      let checkedCount = 0;
      const matchLog = [];

      for (const btn of allButtons) {
        const btnText = btn.textContent?.trim();
        if (!btnText || btnText.length > 100) continue;

        checkedCount++;

        // Resume 버튼 체크
        const isResumeButton = isButtonMatch(btnText, langData.buttons.resume);
        const isResumeVisible = isResumeButton && isButtonReallyVisible(btn);

        if (isResumeButton) {
          matchLog.push(`Resume 후보: "${btnText}" (가시성: ${isResumeVisible})`);
        }

        if (isResumeVisible) {
          hasResumeButton = true;
          result.debugInfo.resumeButtonFound = btnText;
          console.log(`✅ Resume 버튼 감지: "${btnText}"`);
        }

        // Pause 버튼 체크
        const isPauseButton = isButtonMatch(btnText, langData.buttons.pause);
        const isPauseVisible = isPauseButton && isButtonReallyVisible(btn);

        if (isPauseButton) {
          matchLog.push(`Pause 후보: "${btnText}" (가시성: ${isPauseVisible})`);
        }

        if (isPauseVisible) {
          hasPauseButton = true;
          result.debugInfo.pauseButtonFound = btnText;
          console.log(`✅ Pause 버튼 감지: "${btnText}"`);
        }
      }

      console.log(`📋 검색 완료: ${checkedCount}개 버튼 확인`);
      if (matchLog.length > 0) {
        console.log(`📝 매칭 후보:\n  ${matchLog.join('\n  ')}`);
      }

      // Step 2: 만료 상태 텍스트 확인
      // 주의: "No purchases" / "구입한 항목이 없습니다"는 디지털 콘텐츠 구매 섹션의 메시지로
      // Premium 구독 상태와 무관하므로 만료 지표에서 제외
      const expiredTexts = [
        // 한국어 만료 지표
        '혜택을 계속 누리려면 멤버십을 갱신하세요',
        '혜택 종료:',
        '혜택 종료',
        '혜택이 종료됩니다',
        'YouTube Premium을 구독하세요',
        'Premium 멤버십 시작',
        '멤버십이 만료되었습니다',
        '만료됨',
        '만료된 멤버십',
        '비활성 멤버십',
        // 영어 만료 지표 - "Benefits end:" 패턴 추가 (스크린샷 기반)
        'Benefits end:',
        'Benefits end',
        'Benefits ended',
        'To avoid losing benefits',
        'To keep your benefits',
        'renew your membership',
        'Get YouTube Premium',
        'Subscribe to YouTube Premium',
        'Start your Premium membership',
        'Your membership has expired',
        'Expired',
        'Inactive Memberships',
        // 스페인어
        'Los beneficios finalizan',
        'Renueva tu suscripción',
        // 포르투갈어
        'Os benefícios terminam',
        'Renove sua assinatura',
        // 독일어
        'Vorteile enden',
        // 일본어
        '特典終了'
      ];

      let hasExpiredText = false;
      let detectedExpiredText = null;
      for (const expiredText of expiredTexts) {
        if (pageText.includes(expiredText)) {
          hasExpiredText = true;
          detectedExpiredText = expiredText;
          console.log(`⚠️ 만료 텍스트 감지: "${expiredText}"`);
          break;
        }
      }

      // Step 3: 일시중지 날짜 패턴 확인
      const pauseDatePatterns = [
        /멤버십\s*일시중지\s*[:：]\s*([\d\s년월일.\/-]+)/,
        /멤버십\s*재개\s*[:：]\s*([\d\s년월일.\/-]+)/,
        /Membership\s*paused\s*[:：]\s*([\w\s,]+)/,
        /Membership\s*resumes\s*[:：]\s*([\w\s,]+)/,
        /일시중지\s*[:：]\s*([\d\s년월일.\/-]+)/,
        /Paused until\s*[:：]\s*([\w\s,]+)/,
        /Will resume on\s*[:：]\s*([\w\s,]+)/
      ];

      let hasPauseDate = false;
      let pauseDateInfo = null;
      for (const pattern of pauseDatePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          hasPauseDate = true;
          pauseDateInfo = match[0];
          console.log(`📅 일시중지 날짜 패턴 감지: ${match[0]}`);
          break;
        }
      }

      // Step 4: 활성 구독 정보 확인
      const hasActiveSubscription =
        pageText.includes('PKR 899') ||
        pageText.includes('₩8,690') ||
        pageText.includes('$14.99') ||
        pageText.includes('€11.99') ||
        (pageText.includes('가족 멤버십') && !hasExpiredText) ||
        (pageText.includes('Family membership') && !hasExpiredText);

      // Step 5: 캔슬 버튼만 있는지 확인 (만료 상태의 추가 지표)
      const hasCancelOnly = pageText.includes('캔슬') && !hasResumeButton;

      // =================== 최종 상태 판정 ===================
      console.log('\n📊 상태 판정 데이터:');
      console.log(`  - 재개 버튼: ${hasResumeButton ? '있음' : '없음'}`);
      console.log(`  - 만료 텍스트: ${hasExpiredText ? '있음' : '없음'}`);
      console.log(`  - 일시중지 날짜: ${hasPauseDate ? '있음' : '없음'}`);
      console.log(`  - 활성 구독: ${hasActiveSubscription ? '있음' : '없음'}`);
      console.log(`  - 캔슬만 있음: ${hasCancelOnly ? '예' : '아니오'}`);
      console.log(`  - 디버그: 페이지 텍스트 길이 = ${pageText.length}`);

      // 페이지가 제대로 로드되지 않은 경우 처리
      if (pageText.length < 100) {
        console.log('⚠️ 페이지가 제대로 로드되지 않음');
        result.requiresManualCheck = true;
        result.debugInfo.reason = 'Page not loaded properly';
        return result;
      }

      // 케이스 1: 재개 버튼이 있으면 무조건 일시중지 상태
      if (hasResumeButton) {
        result.isPaused = true;
        result.hasResumeButton = true;
        result.status = '일시중지됨';
        result.isExpired = false;
        console.log('\n✅ 판정: 일시중지 상태 (재개 가능)');

        // 날짜 정보 추출
        const pauseMatch = pageText.match(/멤버십\s*일시중지\s*[:：]\s*([\d\s년월일.\/-]+)/);
        const resumeMatch = pageText.match(/멤버십\s*재개\s*[:：]\s*([\d\s년월일.\/-]+)/);

        if (pauseMatch) {
          result.pauseScheduledDate = pauseMatch[1].trim();
          console.log(`  일시중지 날짜: ${result.pauseScheduledDate}`);
        }
        if (resumeMatch) {
          result.resumeScheduledDate = resumeMatch[1].trim();
          console.log(`  재개 예정: ${result.resumeScheduledDate}`);
        }
      }
      // 케이스 2: 만료 텍스트가 있고 재개 버튼이 없으면 만료
      else if (hasExpiredText && !hasResumeButton) {
        result.isExpired = true;
        result.expiredIndicator = detectedExpiredText;
        result.status = '만료됨';
        result.isPaused = false;
        console.log('\n❌ 판정: 만료된 상태 (재구독 필요)');
        console.log(`  만료 지표: "${detectedExpiredText}"`);
      }
      // 케이스 3: 일시중지 날짜 패턴이 있으면 일시중지
      else if (hasPauseDate) {
        result.isPaused = true;
        result.status = '일시중지됨';
        result.isExpired = false;
        console.log('\n✅ 판정: 일시중지 상태 (날짜 패턴 기반)');
        console.log(`  감지된 패턴: ${pauseDateInfo}`);
      }
      // 케이스 4: Pause 버튼이 있고 Resume 버튼이 없으면 활성 상태
      else if (hasPauseButton && !hasResumeButton && hasActiveSubscription) {
        result.isActive = true;
        result.status = '활성';
        result.isExpired = false;
        result.isPaused = false;
        result.hasPauseButton = true;
        console.log('\n✅ 판정: 활성 구독 상태 (Pause 버튼 있음)');
      }
      // 케이스 4-2: 활성 구독 정보만 있는 경우 (버튼이 로드되지 않았을 가능성)
      else if (hasActiveSubscription && !hasResumeButton && !hasExpiredText) {
        // 버튼이 아직 로드되지 않았을 가능성이 있으므로 조심스럽게 판단
        result.isActive = true;
        result.status = '활성';
        result.isExpired = false;
        result.isPaused = false;
        console.log('\n⚠️ 판정: 활성 구독 상태로 추정 (버튼 확인 필요)');
        result.requiresManualCheck = true;
        result.debugInfo.reason = 'Buttons may not be loaded yet';
      }
      // 케이스 5: 캔슬만 있으면 만료로 처리
      else if (hasCancelOnly) {
        result.isExpired = true;
        result.expiredIndicator = '캔슬 버튼만 있음';
        result.status = '만료됨';
        result.isPaused = false;
        console.log('\n❌ 판정: 만료된 상태 (캔슬만 있음)');
      }
      // 케이스 6: 디지털 구매만 있는 경우
      else if ((pageText.includes('디지털 구매 및 대여') ||
                pageText.includes('Digital purchases and rentals')) &&
               !pageText.includes('멤버십') &&
               !pageText.includes('membership')) {
        result.isExpired = true;
        result.expiredIndicator = '구독 정보 없음';
        result.status = '만료됨';
        result.isPaused = false;
        console.log('\n❌ 판정: 만료된 상태 (구독 정보 없음)');
      }
      // 기본값: 상태 불명
      else {
        console.log('\n⚠️ 판정: 상태 불명확');
        result.status = '확인필요';
      }

      console.log('==========================================\n');

      // ✅ 버튼 검색은 위의 Manage 확장 영역 검색으로 완료
      // 추가적인 전체 페이지 검색은 제거 (정확도 저하 방지)

      // Resume 버튼이 있으면 날짜 텍스트 추출
      if (hasResumeButton) {
        result.hasResumeButton = true;
        result.isPaused = true;
        result.dateText = pageText; // 나중에 UniversalDateExtractor로 처리
      }

      // Pause 버튼이 있으면 활성 상태
      if (hasPauseButton) {
        result.hasPauseButton = true;
        result.isActive = true;
      }

      // 포르투갈어 일시정지 예약 상태 감지
      const pauseScheduledPatterns = [
        /A subscrição vai ser colocada em pausa a:\s*([0-9\/]+)/i,  // 포르투갈어
        /A subscrição vai ser retomada a:\s*([0-9\/]+)/i,           // 포르투갈어
        /Subscription will pause on:\s*([\w\s,]+)/i,                // 영어
        /Subscription will resume on:\s*([\w\s,]+)/i                // 영어
      ];
      
      for (const pattern of pauseScheduledPatterns) {
        const match = pageText.match(pattern);
        if (match) {
          result.isPausedScheduled = true;
          if (pattern.toString().includes('pausa') || pattern.toString().includes('pause')) {
            result.pauseScheduledDate = match[1];
          } else {
            result.resumeScheduledDate = match[1];
          }
        }
      }
      
      // 날짜 정보 추출 (전체 페이지에서) - 개선된 패턴
      if (!result.nextBillingDate) {
        // 영어 날짜 패턴
        const englishDatePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}/gi;
        // 숫자 날짜 패턴 (다양한 포맷 지원)
        const numericDatePattern = /\d{4}[\.\/-]\d{1,2}[\.\/-]\d{1,2}|\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{4}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/gi;
        // 한국어 날짜 패턴
        const koreanDatePattern = /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g;

        let dateMatches = pageText.match(englishDatePattern);
        if (!dateMatches || dateMatches.length === 0) {
          dateMatches = pageText.match(numericDatePattern);
        }
        if (!dateMatches || dateMatches.length === 0) {
          dateMatches = pageText.match(koreanDatePattern);
        }

        if (dateMatches && dateMatches.length > 0) {
          // 날짜가 여러 개인 경우 가장 미래의 날짜를 선택
          result.nextBillingDate = dateMatches[0];
          result.debugInfo.allDatesFound = dateMatches;
          console.log(`📅 발견된 날짜들: ${dateMatches.join(', ')}`);
        } else {
          console.log('⚠️ 날짜를 찾을 수 없음');
          result.nextBillingDate = null;
        }
      }

      return result;
    }, lang);

    // UniversalDateExtractor로 날짜 추출
    if (status.dateText) {
      try {
        this.log(`🔍 날짜 추출 시도 - 텍스트 길이: ${status.dateText.length}`, 'debug');

        // 텍스트 샘플 로깅 (날짜 관련 부분 우선)
        const dateKeywords = ['년', '월', '일', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'membership', 'billing', 'next', '다음', '결제'];
        const relevantLines = status.dateText.split('\n')
          .filter(line => dateKeywords.some(keyword => line.toLowerCase().includes(keyword.toLowerCase())))
          .slice(0, 20)
          .join('\n');

        if (relevantLines) {
          this.log(`📄 페이지 텍스트 샘플 (날짜 관련 라인):\n${relevantLines.substring(0, 1000)}`, 'debug');
        }
        
        if (this.dateParser && typeof this.dateParser.extractUniversalDates === 'function') {
          // Resume 컨텍스트로 날짜 추출 - 오늘 날짜는 올해로 처리
          const extractedDates = this.dateParser.extractUniversalDates(status.dateText, this.currentLanguage, 'resume');
          if (extractedDates && extractedDates.length > 0) {
            // ✅ Resume 워크플로우 핵심 로직:
            // "Membership pauses on" 날짜가 실제 다음 결제일 (일시정지가 예정된 날짜)
            // "Membership resumes on" 날짜는 자동 재개 예약일 (무시해야 함)

            let selectedDateObj = null;

            // 1. 먼저 'pause' 타입 날짜 찾기 (Membership pauses on)
            const pauseTypeDate = extractedDates.find(d => d.type === 'pause');
            if (pauseTypeDate) {
              selectedDateObj = pauseTypeDate;
              this.log(`✅ 'Membership pauses on' 날짜 우선 선택: ${pauseTypeDate.year}-${pauseTypeDate.month}-${pauseTypeDate.day}`, 'success');
            } else {
              // 2. 'pause' 타입이 없으면 첫 번째 날짜 사용 (기존 로직)
              selectedDateObj = extractedDates[0];
              this.log(`⚠️ 'Membership pauses on' 날짜 없음, 첫 번째 날짜 사용: ${selectedDateObj.year}-${selectedDateObj.month}-${selectedDateObj.day}`, 'warning');
            }

            // 날짜 객체를 YYYY-MM-DD 형식 문자열로 변환
            if (selectedDateObj && typeof selectedDateObj === 'object' && selectedDateObj.year && selectedDateObj.month && selectedDateObj.day) {
              const month = String(selectedDateObj.month).padStart(2, '0');
              const day = String(selectedDateObj.day).padStart(2, '0');
              status.nextBillingDate = `${selectedDateObj.year}-${month}-${day}`;
              this.log(`✅ UniversalDateExtractor로 날짜 추출 및 변환: ${status.nextBillingDate} (타입: ${selectedDateObj.type}, 원본: "${selectedDateObj.original}")`, 'info');
            } else if (selectedDateObj) {
              status.nextBillingDate = selectedDateObj; // 이미 문자열인 경우
              this.log(`✅ UniversalDateExtractor로 날짜 추출: ${selectedDateObj}`, 'info');
            }
          } else {
            this.log(`⚠️ 날짜를 추출할 수 없음`, 'warning');
          }
        } else {
          this.log(`❌ dateParser.extractUniversalDates 메서드를 찾을 수 없음`, 'error');
          this.log(`dateParser 타입: ${typeof this.dateParser}`, 'debug');
          if (this.dateParser) {
            this.log(`dateParser 메서드들: ${Object.keys(this.dateParser).join(', ')}`, 'debug');
          }
        }
      } catch (dateError) {
        this.log(`❌ 날짜 추출 중 오류: ${dateError.message}`, 'error');
        this.log(`오류 스택: ${dateError.stack}`, 'debug');
      }
    }
    
    // 잘못된 날짜 형식 필터링 (0829.01.00 같은 형식 제거)
    if (status.nextBillingDate) {
      const invalidPattern = /^\d{4}\.\d{2}\.\d{2}$/; // YYYY.MM.DD 형식
      if (invalidPattern.test(status.nextBillingDate)) {
        const year = parseInt(status.nextBillingDate.substring(0, 4));
        if (year > 2030 || year < 2020) {
          this.log(`⚠️ 잘못된 날짜 감지 및 제거: ${status.nextBillingDate}`, 'warning');
          status.nextBillingDate = null;
          // 잘못된 날짜가 나타나는 경우 만료 가능성 표시
          status.possiblyExpired = true;
        }
      }
    }
    
    // 로딩 상태 감지 - 스피너나 로딩 인디케이터 확인
    // Resume/Pause 버튼이 있으면 로딩 상태로 판단하지 않음
    if (!status.hasResumeButton && !status.hasPauseButton && !status.isActive && !status.isPaused) {
      const loadingState = await this.page.evaluate(() => {
        // 로딩 스피너 감지
        const spinners = document.querySelectorAll('.spinner, .loading, [aria-busy="true"], .yt-spinner, tp-yt-paper-spinner');
        const hasSpinner = spinners.length > 0 && Array.from(spinners).some(spinner => {
          const style = window.getComputedStyle(spinner);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        
        // 로딩 텍스트 감지
        const bodyText = document.body?.innerText || '';
        const hasLoadingText = /loading|로딩|carregando|cargando|загрузка/i.test(bodyText);
        
        // 멤버십 섹션이 비어있는지 확인
        const membershipSection = document.querySelector('[aria-label*="Membership"], [aria-label*="멤버십"], .ytmusic-settings-page');
        const isMembershipEmpty = membershipSection && (!membershipSection.textContent || membershipSection.textContent.trim().length < 50);
        
        return {
          hasSpinner,
          hasLoadingText,
          isMembershipEmpty,
          isLoading: hasSpinner || hasLoadingText || isMembershipEmpty
        };
      });
      
      // 로딩 상태인 경우 수동 체크 필요로 표시
      if (loadingState.isLoading) {
        status.requiresManualCheck = true;
        status.isLoading = true;
        this.log(`⏳ 페이지 로딩 중 또는 불완전한 상태 감지`, 'warning');
        this.log(`  - 스피너: ${loadingState.hasSpinner ? '있음' : '없음'}`, 'debug');
        this.log(`  - 로딩 텍스트: ${loadingState.hasLoadingText ? '있음' : '없음'}`, 'debug');
        this.log(`  - 멤버십 섹션 비어있음: ${loadingState.isMembershipEmpty ? '예' : '아니오'}`, 'debug');
        this.log(`  → 수동 체크 필요`, 'info');
      }
      // 만료된 계정 감지 로직 - 로딩 상태가 아닌 경우에만 적용
      else if (!status.isPausedScheduled) {
        // 페이지에 YouTube Premium 텍스트가 있는지 확인
        const hasPremiumPage = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const bodyTextLower = bodyText.toLowerCase();
          return bodyTextLower.includes('youtube premium') || bodyTextLower.includes('youtube 프리미엄');
        });
        
        if (hasPremiumPage || status.possiblyExpired) {
          status.isExpired = true;
          this.log(`🚫 만료된 계정 감지 - 구독 상태가 표시되지 않음, 잘못된 날짜 감지: ${status.possiblyExpired ? '예' : '아니오'}`, 'warning');
          this.log(`  - Resume 버튼: 없음`, 'debug');
          this.log(`  - Pause 버튼: 없음`, 'debug');
          this.log(`  - 활성/일시중지 상태: 없음`, 'debug');
          this.log(`  - YouTube Premium 페이지: ${hasPremiumPage ? '확인됨' : '미확인'}`, 'debug');
        }
      }
    } else if (status.hasResumeButton || status.hasPauseButton) {
      // Resume 또는 Pause 버튼이 있으면 정상 페이지로 간주 - 로딩 체크 건너뜀
      this.log(`✅ 정상 페이지 - Resume 버튼: ${status.hasResumeButton}, Pause 버튼: ${status.hasPauseButton}`, 'info');
    }
    
    this.log(`상태 확인 - 활성: ${status.isActive}, 일시중지: ${status.isPaused}, 일시정지 예약: ${status.isPausedScheduled}, Resume 버튼: ${status.hasResumeButton}`, 'info');
    
    // 일시정지 예약 상태인 경우 추가 로깅
    if (status.isPausedScheduled) {
      this.log(`📌 일시정지 예약 상태 감지`, 'warning');
      if (status.pauseScheduledDate) {
        this.log(`  - 일시정지 예정일: ${status.pauseScheduledDate}`, 'info');
      }
      if (status.resumeScheduledDate) {
        this.log(`  - 재개 예정일: ${status.resumeScheduledDate}`, 'info');
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Resume 성공 판정 로직 (verifyResumeSuccess와 동일)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Resume 재개 성공 = Pause 버튼 있고 Resume 버튼 없음 (활성 구독 상태)
    // Resume 재개 실패 = Resume 버튼 있음 (여전히 일시중지 상태)
    if (status.hasPauseButton && !status.hasResumeButton) {
      status.success = true;
      this.log('✅ 재개 성공 판정 - Pause 버튼 존재, Resume 버튼 없음 (활성 상태)', 'success');
    } else if (status.hasResumeButton) {
      status.success = false;
      this.log('❌ 재개 실패 판정 - Resume 버튼 존재 (일시중지 상태 유지)', 'error');
    } else {
      // 둘 다 없는 경우 - 페이지 로딩 중이거나 만료 상태
      status.success = false;
      this.log('❌ 재개 실패 판정 - 버튼 없음 (페이지 로딩 중 또는 만료 상태)', 'error');
    }

    return status;
  }

  /**
   * 멤버십 관리 섹션이 열려있는지 확인
   */
  async isManagementOpen() {
    return await this.page.evaluate(() => {
      // 재개 버튼이 보이면 멤버십 관리가 열려있음
      const resumeButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(btn => {
          const text = btn.textContent?.trim();
          return text && (
            text.includes('Resume') ||
            text.includes('재개') ||
            text.includes('Возобновить') ||
            text.includes('Reanudar') ||
            text.includes('Reprendre') ||
            text.includes('Retomar') ||
            text.includes('Fortsetzen') ||
            text.includes('Devam')
          );
        });
      
      // Resume 버튼이 보이고 활성화되어 있으면 true
      return resumeButtons.some(btn => 
        btn.offsetHeight > 0 && btn.offsetWidth > 0
      );
    });
  }

  /**
   * 멤버십 관리 버튼 클릭
   */
  async clickManageButton() {
    const lang = languages[this.currentLanguage];
    
    const clicked = await this.page.evaluate((manageTexts) => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], yt-button-renderer'));
      
      for (const text of manageTexts) {
        const button = buttons.find(btn => {
          const btnText = btn.textContent?.trim();
          return btnText && (btnText === text || btnText.includes(text));
        });
        
        if (button && button.offsetHeight > 0) {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          button.click();
          return true;
        }
      }
      return false;
    }, lang.buttons.manageMemership);
    
    if (clicked) {
      // 클릭 후 페이지 업데이트 대기 시간 증가 (일시중지와 동일하게 5초)
      await new Promise(resolve => setTimeout(resolve, 5000));
      return true;
    }
    
    return false;
  }

  /**
   * 일시정지 예약 취소
   */
  async cancelPauseSchedule() {
    const result = {
      success: false,
      nextBillingDate: null
    };
    
    try {
      this.log('일시정지 예약 취소 시도 중...', 'info');
      
      // 포르투갈어 페이지에서는 "Retomar" 버튼이 예약 취소 역할
      // "vai ser colocada em pausa"가 있는 경우 Retomar 클릭
      const cancelClicked = await this.page.evaluate(() => {
        const bodyText = document.body?.textContent || '';
        
        // 포르투갈어 일시정지 예약 상태인지 확인
        if (bodyText.includes('vai ser colocada em pausa') || 
            bodyText.includes('vai ser retomada')) {
          
          // 이 상태에서 "Retomar" 버튼 찾기 (팝업이 아닌 메인 페이지)
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          const retomarButton = buttons.find(btn => {
            const btnText = btn.textContent?.trim();
            // 팝업이 아닌 메인 페이지의 Retomar 버튼 찾기
            const isInDialog = btn.closest('[role="dialog"]') || btn.closest('.opened');
            return btnText === 'Retomar' && !isInDialog && btn.offsetHeight > 0;
          });
          
          if (retomarButton) {
            console.log('메인 페이지 Retomar 버튼 클릭 (예약 취소용)');
            retomarButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            retomarButton.click();
            return true;
          }
        }
        
        // 일반적인 Cancel 버튼 찾기 (다른 언어)
        const cancelTexts = ['Cancelar', 'Cancel', '취소', 'İptal'];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        
        for (const text of cancelTexts) {
          const button = buttons.find(btn => {
            const btnText = btn.textContent?.trim();
            return btnText && (btnText === text || btnText.includes(text));
          });
          
          if (button && button.offsetHeight > 0) {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            button.click();
            return true;
          }
        }
        return false;
      });
      
      if (cancelClicked) {
        this.log('첫 번째 Retomar/Cancel 버튼 클릭 성공', 'success');
        await new Promise(r => setTimeout(r, 3000));
        
        // 팝업 대기 및 처리
        this.log('팝업 대기 중...', 'info');
        const popupResult = await this.waitForAndHandlePopup();
        
        if (popupResult.success) {
          result.success = true;
          this.log('일시정지 예약이 성공적으로 취소됨', 'success');
        } else {
          // 팝업이 없으면 페이지 변화 확인
          const pageChanged = await this.page.evaluate(() => {
            const bodyText = document.body?.textContent || '';
            // 예약 취소 후 활성 상태 확인
            return !bodyText.includes('vai ser colocada em pausa') &&
                   !bodyText.includes('will pause on');
          });
          
          if (pageChanged) {
            result.success = true;
            this.log('팝업 없이 일시정지 예약이 취소됨', 'success');
          } else {
            this.log('일시정지 예약 취소 실패 - 상태 변경 없음', 'error');
          }
        }
      } else {
        // "Retomar" 버튼이 예약 취소 역할을 할 수도 있음
        this.log('취소 버튼을 찾지 못함, Retomar 버튼으로 시도', 'info');
        const resumeClicked = await this.clickResumeButton();
        if (resumeClicked) {
          await new Promise(r => setTimeout(r, 3000));
          
          // 팝업 처리
          const popupResult = await this.waitForAndHandlePopup();
          result.success = popupResult.success;
        }
      }
    } catch (error) {
      this.log(`예약 취소 실패: ${error.message}`, 'error');
    }
    
    return result;
  }

  /**
   * 팝업 대기 및 처리 (포르투갈어 특화)
   */
  async waitForAndHandlePopup() {
    const result = {
      success: false,
      popupFound: false
    };
    
    try {
      // 팝업 대기 (최대 5초)
      for (let i = 0; i < 5; i++) {
        const hasPopup = await this.page.evaluate(() => {
          // 팝업 선택자들
          const popupSelectors = [
            '[role="dialog"]:not([aria-hidden="true"])',
            '[aria-modal="true"]',
            'tp-yt-paper-dialog:not([aria-hidden="true"])',
            'ytd-popup-container',
            '.opened'
          ];
          
          for (const selector of popupSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
              if (element.offsetHeight > 0 && element.offsetWidth > 0) {
                const text = element.textContent || '';
                const textLower = text.toLowerCase();
                
                // 포르투갈어 재개 팝업 텍스트
                if (textLower.includes('quer retomar') || 
                    textLower.includes('será retomada imediatamente') ||
                    textLower.includes('youtube premium')) {
                  return true;
                }
              }
            }
          }
          return false;
        });
        
        if (hasPopup) {
          result.popupFound = true;
          this.log('✅ 재개 확인 팝업 발견', 'success');
          break;
        }
        
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (!result.popupFound) {
        this.log('⚠️ 팝업이 나타나지 않음', 'warning');
        return result;
      }
      
      // 팝업 내 Retomar 버튼 클릭
      const clicked = await this.page.evaluate(() => {
        // 팝업 찾기
        const popupSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog',
          'ytd-popup-container',
          '.opened'
        ];
        
        let dialog = null;
        for (const selector of popupSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.offsetHeight > 0 && element.offsetWidth > 0) {
              const text = element.textContent || '';
              if (text.includes('Quer retomar') || text.includes('será retomada')) {
                dialog = element;
                break;
              }
            }
          }
          if (dialog) break;
        }
        
        if (!dialog) return false;
        
        // 팝업 내 버튼 찾기
        const buttons = dialog.querySelectorAll('button, [role="button"]');
        
        // Retomar 버튼 찾기 (Cancelar가 아닌)
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          if (btnText === 'Retomar') {
            console.log('팝업 내 Retomar 버튼 클릭');
            button.click();
            return true;
          }
        }
        
        // Retomar를 못찾으면 Cancelar가 아닌 첫 번째 버튼
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          if (btnText && btnText !== 'Cancelar') {
            console.log(`팝업 버튼 클릭: ${btnText}`);
            button.click();
            return true;
          }
        }
        
        return false;
      });
      
      if (clicked) {
        this.log('✅ 팝업 확인 버튼 클릭 성공', 'success');
        await new Promise(r => setTimeout(r, 3000));
        result.success = true;
      } else {
        this.log('❌ 팝업 버튼 클릭 실패', 'error');
      }
      
    } catch (error) {
      this.log(`팝업 처리 오류: ${error.message}`, 'error');
    }
    
    return result;
  }

  /**
   * 멤버십 관리 버튼 클릭 후 상태 확인 (완전 개선)
   * 핵심: DOM 변화 안정성 확인 후 버튼 기반 상태 판별
   */
  async checkMembershipStatusAfterManage() {
    console.log(chalk.cyan('\n🔍 멤버십 상태 확인 시작 (범용 v4)'));

    // 새로운 범용 감지 로직 우선 시도
    try {
      const universalStatus = await this.universalDetector.detectMembershipStatus(this.page);

      // 범용 감지 결과를 기존 형식으로 변환
      return {
        isPaused: universalStatus.isPaused,
        isActive: universalStatus.isActive,
        hasResumeButton: universalStatus.hasResumeButton,
        hasPauseButton: universalStatus.hasPauseButton,
        statusText: universalStatus.isActive ? '활성 상태' : (universalStatus.isPaused ? '일시중지 상태' : '불명확'),
        nextBillingDate: universalStatus.nextBillingDate,
        pauseDate: universalStatus.pauseDate,
        resumeDate: universalStatus.resumeDate,
        detectedIndicators: universalStatus.detectedIndicators || [],
        language: universalStatus.language
      };
    } catch (universalError) {
      console.log(chalk.yellow('⚠️ 범용 감지 실패, 기존 로직으로 폴백'));
      console.error(universalError);
    }

    // 기존 로직 (폴백)
    try {
      // 1단계: Manage membership 버튼이 이미 클릭되었는지 확인 및 클릭
      console.log(chalk.gray('  1️⃣ 확장된 콘텐츠 확인...'));

      const initialCheck = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const hasManageButton = buttons.some(btn => {
          const text = btn.textContent?.trim() || '';
          return text.includes('Manage membership') ||
                 text.includes('멤버십 관리') ||
                 text.includes('Продлить или изменить') ||
                 text.includes('Управление подпиской') ||
                 text === '관리';
        });

        const hasResumeButton = buttons.some(btn => {
          const text = btn.textContent?.trim() || '';
          // 다국어 설정 사용 (러시아어 포함)
          const langData = window._currentLanguageData || { buttons: { resume: ['Resume', '재개'], resumeMembership: ['Resume membership', '멤버십 재개'] } };
          return langData.buttons.resume.some(resumeText => text === resumeText) ||
                 langData.buttons.resumeMembership?.some(resumeText => text.includes(resumeText));
        });

        const hasPauseButton = buttons.some(btn => {
          const text = btn.textContent?.trim() || '';
          // 다국어 설정 사용 (러시아어 포함)
          const langData = window._currentLanguageData || { buttons: { pause: ['Pause', '일시중지', '일시 중지'], pauseMembership: ['Pause membership', '멤버십 일시중지'] } };
          return langData.buttons.pause.some(pauseText => text === pauseText) ||
                 langData.buttons.pauseMembership?.some(pauseText => text.includes(pauseText));
        });

        return { hasManageButton, hasResumeButton, hasPauseButton };
      });

      // Manage 버튼이 있고, Resume/Pause 버튼이 없으면 클릭 필요
      if (initialCheck.hasManageButton && !initialCheck.hasResumeButton && !initialCheck.hasPauseButton) {
        console.log(chalk.yellow('  ⚠️ 멤버십 관리 버튼 클릭 필요'));

        // Manage membership 버튼 클릭
        const clicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          const manageBtn = buttons.find(btn => {
            const text = btn.textContent?.trim() || '';
            return text.includes('Manage membership') ||
                   text.includes('멤버십 관리') ||
                   text.includes('Продлить или изменить') ||
                   text.includes('Управление подпиской') ||
                   text === '관리';
          });

          if (manageBtn) {
            manageBtn.click();
            return true;
          }
          return false;
        });

        if (clicked) {
          console.log(chalk.green('  ✅ 멤버십 관리 버튼 클릭됨'));
          // 클릭 후 대기
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 2단계: DOM 안정화 대기 및 버튼 감지
      console.log(chalk.gray('  2️⃣ DOM 안정화 대기 중...'));

      const maxWaitTime = 10000; // 최대 10초
      const checkInterval = 500; // 0.5초마다 체크
      const startTime = Date.now();
      let stabilityCounter = 0;
      let lastButtonState = null;

      while ((Date.now() - startTime) < maxWaitTime) {
        const currentState = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]'));

          // Resume 버튼 찾기 (다국어 지원)
          const resumeButton = buttons.find(btn => {
            if (btn.offsetHeight === 0 || btn.offsetWidth === 0) return false;
            const text = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';

            // 다국어 설정 사용 (러시아어 포함)
            const langData = window._currentLanguageData || { buttons: { resume: ['Resume', '재개'], resumeMembership: ['Resume membership', '멤버십 재개'] } };
            return langData.buttons.resume.some(resumeText => text === resumeText || ariaLabel === resumeText) ||
                   langData.buttons.resumeMembership?.some(resumeText => text === resumeText || ariaLabel === resumeText);
          });

          // Pause 버튼 찾기 (다국어 지원)
          const pauseButton = buttons.find(btn => {
            if (btn.offsetHeight === 0 || btn.offsetWidth === 0) return false;
            const text = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';

            // 다국어 설정 사용 (러시아어 포함)
            const langData = window._currentLanguageData || { buttons: { pause: ['Pause', '일시중지', '일시 중지'], pauseMembership: ['Pause membership', '멤버십 일시중지'] } };
            return langData.buttons.pause.some(pauseText => text === pauseText || ariaLabel === pauseText || text.includes(pauseText)) ||
                   langData.buttons.pauseMembership?.some(pauseText => text === pauseText || ariaLabel === pauseText || text.includes(pauseText));
          });

          // Cancel 버튼 찾기
          const cancelButton = buttons.find(btn => {
            if (btn.offsetHeight === 0 || btn.offsetWidth === 0) return false;
            const text = btn.textContent?.trim() || '';
            return text === 'Cancel' || text === '취소' || text === '캔슬';
          });

          return {
            hasResume: !!resumeButton,
            hasPause: !!pauseButton,
            hasCancel: !!cancelButton,
            resumeText: resumeButton?.textContent?.trim(),
            pauseText: pauseButton?.textContent?.trim(),
            buttonCount: buttons.filter(b => b.offsetHeight > 0).length
          };
        });

        // 상태가 같으면 안정성 카운터 증가
        if (JSON.stringify(currentState) === JSON.stringify(lastButtonState)) {
          stabilityCounter++;
          if (stabilityCounter >= 3) {
            console.log(chalk.green('  ✅ DOM 안정화 확인 (3회 연속 동일)'));
            break;
          }
        } else {
          stabilityCounter = 0;
        }

        lastButtonState = currentState;

        // 주요 버튼이 발견되면 조기 종료 가능
        if ((currentState.hasResume || currentState.hasPause) && stabilityCounter >= 2) {
          console.log(chalk.green('  ✅ 주요 버튼 감지 및 안정화'));
          break;
        }

        await new Promise(r => setTimeout(r, checkInterval));
      }

      // 3단계: 최종 상태 판정
      console.log(chalk.gray('  3️⃣ 최종 상태 판정...'));

      const finalStatus = await this.page.evaluate(() => {
        const result = {
          isPaused: false,
          isActive: false,
          hasResumeButton: false,
          hasPauseButton: false,
          hasCancelButton: false,
          statusText: '',
          detectedIndicators: [],
          debugInfo: {
            visibleButtonCount: 0,
            buttonTexts: [],
            pageTextSnippet: ''
          }
        };

        // 모든 버튼 재검사 (최종)
        const allButtons = document.querySelectorAll('button, [role="button"], a[role="button"], tp-yt-paper-button');
        const visibleButtons = [];

        allButtons.forEach(btn => {
          // 버튼이 실제로 보이는지 확인
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          const isVisible = rect.height > 0 &&
                          rect.width > 0 &&
                          style.display !== 'none' &&
                          style.visibility !== 'hidden' &&
                          style.opacity !== '0';

          if (isVisible) {
            const text = btn.textContent?.trim() || '';
            if (text) {
              visibleButtons.push({ element: btn, text: text });
              result.debugInfo.buttonTexts.push(text.substring(0, 30));
            }
          }
        });

        result.debugInfo.visibleButtonCount = visibleButtons.length;

        // Resume 버튼 정밀 검사 (다국어 지원)
        const resumeButton = visibleButtons.find(btn => {
          const t = btn.text;
          // 다국어 설정 사용 (러시아어 포함)
          const langData = window._currentLanguageData || { buttons: { resume: ['Resume', '재개'], resumeMembership: ['Resume membership', '멤버십 재개'] } };
          return langData.buttons.resume.some(resumeText => t === resumeText || t.startsWith(resumeText)) ||
                 langData.buttons.resumeMembership?.some(resumeText => t === resumeText || t.includes(resumeText));
        });

        if (resumeButton) {
          result.hasResumeButton = true;
          result.isPaused = true;
          result.detectedIndicators.push(`Resume 버튼 발견: "${resumeButton.text}"`);
        }

        // Pause 버튼 정밀 검사
        const pauseButton = visibleButtons.find(btn => {
          const t = btn.text;
          // 다국어 설정 사용 (러시아어 포함)
          const langData = window._currentLanguageData || { buttons: { pause: ['Pause', '일시중지', '일시 중지'], pauseMembership: ['Pause membership', '멤버십 일시중지'] } };
          return langData.buttons.pause.some(pauseText => t === pauseText || t.startsWith(pauseText)) ||
                 langData.buttons.pauseMembership?.some(pauseText => t === pauseText || t.includes(pauseText));
        });

        if (pauseButton) {
          result.hasPauseButton = true;
          result.isActive = true;
          result.detectedIndicators.push(`Pause 버튼 발견: "${pauseButton.text}"`);
        }

        // Cancel 버튼 검사
        const cancelButton = visibleButtons.find(btn => {
          const t = btn.text;
          return t === 'Cancel' || t === '취소' || t === '캔슬';
        });

        if (cancelButton) {
          result.hasCancelButton = true;
        }

        // 페이지 텍스트에서 추가 정보 추출
        const bodyText = document.body?.innerText || '';
        result.debugInfo.pageTextSnippet = bodyText.substring(0, 500);

        // 포르투갈어 상태 판별 추가 (중요!)
        // "A subscrição vai ser colocada em pausa" = 일시중지 예정
        // "A subscrição vai ser retomada" = 재개 예정 (일시중지 상태)
        // "Próxima data de faturação" = 다음 결제일 (활성 상태)
        if (bodyText.includes('A subscrição vai ser colocada em pausa') ||
            bodyText.includes('A subscrição vai ser retomada')) {
          // 일시중지 상태
          result.isPaused = true;
          result.isActive = false;
          result.hasResumeButton = true;  // Retomar 버튼이 있어야 함
          result.statusText = '일시중지 예정/상태';
          result.detectedIndicators.push('포르투갈어: 일시중지 텍스트 감지');
        } else if (bodyText.includes('Próxima data de faturação') ||
                   bodyText.includes('Próxima data de faturamento')) {
          // 활성 상태
          result.isActive = true;
          result.isPaused = false;
          result.hasPauseButton = true;  // Pausar 버튼이 있어야 함
          result.statusText = '활성 상태';
          result.detectedIndicators.push('포르투갈어: 다음 결제일 텍스트 감지');
        }

        // 포르투갈어 버튼 재확인 (Retomar/Pausar)
        const retomarButton = visibleButtons.find(btn => btn.text === 'Retomar');
        const pausarButton = visibleButtons.find(btn => btn.text === 'Pausar' || btn.text === 'Pausar subscrição');

        if (retomarButton) {
          result.hasResumeButton = true;
          result.isPaused = true;
          result.isActive = false;
          result.detectedIndicators.push('Retomar 버튼 발견 (포르투갈어)');
        }

        if (pausarButton) {
          result.hasPauseButton = true;
          result.isActive = true;
          result.isPaused = false;
          result.detectedIndicators.push('Pausar 버튼 발견 (포르투갈어)');
        }

        // 다른 언어 상태 판별 추가
        // 영어
        if (bodyText.includes('will be paused on') ||
            bodyText.includes('will resume on')) {
          result.isPaused = true;
          result.isActive = false;
          result.detectedIndicators.push('영어: 일시중지 상태 감지');
        } else if (bodyText.includes('Next billing date')) {
          result.isActive = true;
          result.isPaused = false;
          result.detectedIndicators.push('영어: 활성 상태 감지');
        }

        // 스페인어
        if (bodyText.includes('se pausará') ||
            bodyText.includes('se reanudará')) {
          result.isPaused = true;
          result.isActive = false;
          result.detectedIndicators.push('스페인어: 일시중지 상태 감지');
        } else if (bodyText.includes('Próxima fecha de facturación')) {
          result.isActive = true;
          result.isPaused = false;
          result.detectedIndicators.push('스페인어: 활성 상태 감지');
        }

        // 날짜 정보 추출
        const datePatterns = [
          /Membership resumes on[: ]*([^\n]+)/i,
          /멤버십 재개[: ]*([^\n]+)/i,
          /Membership pauses on[: ]*([^\n]+)/i,
          /멤버십 일시중지[: ]*([^\n]+)/i,
          /Free trial ends[: ]*([^\n]+)/i,
          /무료 체험 종료[: ]*([^\n]+)/i
        ];

        datePatterns.forEach(pattern => {
          const match = bodyText.match(pattern);
          if (match) {
            result.detectedIndicators.push(`날짜 정보: ${match[0]}`);

            if (pattern.source.includes('resumes')) {
              result.resumeDate = match[1].trim();
            } else if (pattern.source.includes('pauses') || pattern.source.includes('ends')) {
              result.nextBillingDate = match[1].trim();
            }
          }
        });

        // 최종 상태 텍스트 설정
        if (result.hasResumeButton) {
          result.statusText = '✅ 일시중지 상태 (Resume 버튼 존재)';
          result.isPaused = true;
          result.isActive = false;
        } else if (result.hasPauseButton) {
          result.statusText = '✅ 활성 상태 (Pause 버튼 존재)';
          result.isActive = true;
          result.isPaused = false;
        } else if (result.hasCancelButton && !result.hasResumeButton && !result.hasPauseButton) {
          result.statusText = '⚠️ 만료 또는 취소된 상태';
        } else {
          result.statusText = '❌ 상태 확인 불가 (버튼 미감지)';
        }

        return result;
      });

      // 4단계: 결과 출력
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan('📊 멤버십 상태 확인 결과:'));
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.white(`  상태: ${finalStatus.statusText}`));
      console.log(chalk.gray(`  Resume 버튼: ${finalStatus.hasResumeButton ? '✅ 있음' : '❌ 없음'}`));
      console.log(chalk.gray(`  Pause 버튼: ${finalStatus.hasPauseButton ? '✅ 있음' : '❌ 없음'}`));
      console.log(chalk.gray(`  Cancel 버튼: ${finalStatus.hasCancelButton ? '✅ 있음' : '❌ 없음'}`));

      if (finalStatus.resumeDate) {
        console.log(chalk.gray(`  재개 예정일: ${finalStatus.resumeDate}`));
      }
      if (finalStatus.nextBillingDate) {
        console.log(chalk.gray(`  다음 결제일: ${finalStatus.nextBillingDate}`));
      }

      if (finalStatus.debugInfo.buttonTexts.length > 0) {
        console.log(chalk.gray(`  감지된 버튼들: ${finalStatus.debugInfo.buttonTexts.join(', ')}}`));
      }
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      return finalStatus;

    } catch (error) {
      console.log(chalk.red(`❌ 멤버십 상태 확인 실패: ${error.message}`));
      return {
        isPaused: false,
        isActive: false,
        statusText: '확인 실패',
        error: error.message
      };
    }
  }

  /**
   * 결제 재개 워크플로우 실행 (완전한 워크플로우 통합)
   */
  async executeResumeWorkflow(browser) {
    const result = {
      success: false,
      resumeDate: null,
      nextBillingDate: null,
      error: null
    };

    if (this.debugMode) console.log(chalk.cyan('\n🔄 [Resume Workflow] 실행 시작'));

    // 디버깅을 위한 스크린샷 저장 함수 (debugMode일 때만 실행)
    const saveDebugScreenshot = async (step, suffix = '') => {
      if (!this.debugMode) return;
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `debug-resume-workflow-${step}${suffix ? '-' + suffix : ''}-${timestamp}.png`;
        const filepath = path.join('screenshots', 'debug', filename);
        await fs.mkdir(path.join('screenshots', 'debug'), { recursive: true });
        await this.page.screenshot({ path: filepath, fullPage: true });
        console.log(chalk.gray(`📸 [DEBUG] 스크린샷 저장: ${filename}`));
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 디버그 스크린샷 저장 실패: ${e.message}`));
      }
    };

    try {
      // 1. 현재 페이지 상태 재확인
      this.log('현재 페이지 상태 재확인 중...', 'info');
      if (this.debugMode) console.log(chalk.blue('  [1/4] 페이지 상태 확인'));
      
      await saveDebugScreenshot('workflow-start');
      
      const currentUrl = this.page.url();
      console.log(chalk.gray(`    현재 URL: ${currentUrl}`));
      
      if (!currentUrl.includes('paid_memberships')) {
        console.log(chalk.yellow('    Premium 페이지로 재이동 필요'));
        await this.page.goto('https://www.youtube.com/paid_memberships', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await new Promise(r => setTimeout(r, 3000));
        await saveDebugScreenshot('workflow-after-navigation');
      }

      // 2. 멤버십 관리 버튼 상태 확인 및 클릭
      // 재개 버튼 탐색 시작
      this.log('재개 버튼 탐색 시작', 'info');
      console.log(chalk.blue('  [2/4] 멤버십 관리 버튼 처리'));
      
      // 멤버십 관리 페이지 열림 상태 확인
      let managementOpen = await this.page.evaluate(() => {
        // 확장된 멤버십 관리 영역이 있는지 확인
        const expandedSections = document.querySelectorAll('[expanded], [aria-expanded="true"]');
        return expandedSections.length > 0;
      });
      
      this.log(`멤버십 관리 페이지 열림 상태: ${managementOpen}`, 'info');
      
      // 멤버십 관리가 열려있지 않으면 멤버십 관리 버튼 클릭
      if (!managementOpen) {
        // 멤버십 관리 버튼 찾기
        const manageButtonText = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], yt-button-renderer'));
          const manageTexts = ['Manage membership', '멤버십 관리', 'Продлить или изменить', 'Управление подпиской'];
          
          for (const text of manageTexts) {
            const button = buttons.find(btn => {
              const btnText = btn.textContent?.trim();
              return btnText && (btnText === text || btnText.includes(text));
            });
            
            if (button && button.offsetHeight > 0) {
              return button.textContent?.trim();
            }
          }
          return null;
        });
        
        this.log(`멤버십 관리 버튼 발견: "${manageButtonText || '찾을 수 없음'}"`, 'info');
        
        if (manageButtonText) {
          const manageClicked = await this.clickManageButton();
          if (manageClicked) {
            this.log('✅ 멤버십 관리 버튼 클릭 성공', 'success');
            this.log('멤버십 관리 페이지 로딩 대기 (7초)...', 'info');
            await new Promise(r => setTimeout(r, 7000));
            
            // 페이지 업데이트 확인
            managementOpen = await this.page.evaluate(() => {
              return document.querySelector('[expanded]') !== null || 
                     document.querySelector('[aria-expanded="true"]') !== null;
            });
            
            if (!managementOpen) {
              this.log('⚠️ 페이지 업데이트 확인 실패, 계속 진행', 'warning');
            }
          } else {
            this.log('멤버십 관리 버튼 클릭 실패', 'warning');
            throw new Error('멤버십 관리 버튼을 클릭할 수 없음');
          }
        } else {
          throw new Error('멤버십 관리 버튼을 찾을 수 없음');
        }
      }

      // 3. 멤버십 상태 확인 (v3 - 개선된 로직)
      this.log('멤버십 상태 확인 (정확한 버전)', 'info');
      console.log(chalk.blue('  [3/4] 멤버십 상태 정확히 확인'));

      // checkMembershipStatusAfterManage()가 내부에서 Manage 버튼 클릭 처리
      const statusBeforeAction = await this.checkMembershipStatusAfterManage();

      // 상태 로그 출력 (개선된 버전)
      console.log(chalk.gray(`    📊 상태 분석 결과:`));
      console.log(chalk.gray(`       - 상태 텍스트: ${statusBeforeAction.statusText}`));
      console.log(chalk.gray(`       - 일시중지 여부: ${statusBeforeAction.isPaused ? '✅ 예' : '❌ 아니오'}`));
      console.log(chalk.gray(`       - 활성 여부: ${statusBeforeAction.isActive ? '✅ 예' : '❌ 아니오'}`));
      console.log(chalk.gray(`       - Resume 버튼: ${statusBeforeAction.hasResumeButton ? '✅ 있음' : '❌ 없음'}`));
      console.log(chalk.gray(`       - Pause 버튼: ${statusBeforeAction.hasPauseButton ? '✅ 있음' : '❌ 없음'}`));
      console.log(chalk.gray(`       - 감지 지표: ${statusBeforeAction.detectedIndicators?.join(', ') || '없음'}`));

      // Case 1: 이미 활성 상태인 경우 (Pause 버튼 존재) - 재확인 추가
      if (statusBeforeAction.isActive && statusBeforeAction.hasPauseButton) {
        console.log(chalk.yellow('    ⚠️ 이미 활성 상태로 감지됨 - 재확인 필요'));
        await saveDebugScreenshot('workflow-first-check-active');

        // False Positive 방지를 위한 재확인 로직
        console.log(chalk.cyan('    🔍 False Positive 방지 재확인 시작...'));

        // 페이지 새로고침하여 재확인
        console.log(chalk.gray('      1. 페이지 새로고침 중...'));
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000));

        // 재확인 수행
        console.log(chalk.gray('      2. 상태 재확인 중...'));
        const recheckStatus = await this.checkMembershipStatusAfterManage();

        // 여전히 활성 상태인지 확인
        if (recheckStatus.isActive && recheckStatus.hasPauseButton) {
          console.log(chalk.green('    ✅ 재확인 결과: 정말로 활성 상태입니다'));
          await saveDebugScreenshot('workflow-confirmed-active');

          // 결과 반환 (성공으로 처리)
          return {
            success: true,
            message: '이미 활성 상태 (재확인 완료)',
            alreadyActive: true,
            statusText: recheckStatus.statusText,
            nextBillingDate: recheckStatus.nextBillingDate
          };
        } else if (recheckStatus.isPaused && recheckStatus.hasResumeButton) {
          // False Positive 감지 - 실제로는 일시중지 상태
          console.log(chalk.yellow('    ⚠️ False Positive 감지! 실제로는 일시중지 상태'));
          console.log(chalk.yellow('    ⚠️ Resume 버튼 클릭을 진행합니다'));
          await saveDebugScreenshot('workflow-false-positive-detected');

          // Resume 버튼 클릭 진행
          const resumeClicked = await this.clickResumeButton();
          if (!resumeClicked) {
            console.log(chalk.red('    ❌ Resume 버튼을 클릭할 수 없음'));
            throw new Error('Resume 버튼 클릭 실패');
          }
          console.log(chalk.green('    ✅ Resume 버튼 클릭 성공 (False Positive 처리)'));
        } else {
          // 상태가 불명확한 경우 한 번 더 재확인
          console.log(chalk.yellow('    ⚠️ 상태가 불명확함 - 최종 재확인'));
          await new Promise(r => setTimeout(r, 2000));

          const finalCheck = await this.checkMembershipStatusAfterManage();
          if (finalCheck.isActive) {
            console.log(chalk.green('    ✅ 최종 확인: 활성 상태'));
            return {
              success: true,
              message: '이미 활성 상태 (최종 확인)',
              alreadyActive: true,
              statusText: finalCheck.statusText,
              nextBillingDate: finalCheck.nextBillingDate
            };
          } else if (finalCheck.isPaused && finalCheck.hasResumeButton) {
            console.log(chalk.yellow('    ⚠️ 최종 확인: 일시중지 상태 - Resume 클릭'));
            const resumeClicked = await this.clickResumeButton();
            if (!resumeClicked) {
              throw new Error('Resume 버튼 클릭 실패');
            }
          } else {
            throw new Error('멤버십 상태를 확인할 수 없음');
          }
        }
      }

      // Case 2: 일시중지 상태인 경우 (Resume 버튼 존재)
      if (statusBeforeAction.isPaused && statusBeforeAction.hasResumeButton) {
        console.log(chalk.yellow('    ⚠️ 일시중지 상태 확인됨 - Resume 버튼 클릭 필요'));
        await saveDebugScreenshot('workflow-before-resume-click');

        const resumeClicked = await this.clickResumeButton();
        if (!resumeClicked) {
          console.log(chalk.red('    ❌ Resume 버튼을 클릭할 수 없음'));
          await saveDebugScreenshot('workflow-resume-button-click-failed');
          throw new Error('Resume 버튼 클릭 실패');
        }
        console.log(chalk.green('    ✅ Resume 버튼 클릭 성공'));
      }
      // Case 3: 상태를 명확히 판별할 수 없는 경우
      else if (!statusBeforeAction.isPaused && !statusBeforeAction.isActive) {
        console.log(chalk.yellow('    ⚠️ 멤버십 상태를 명확히 판별할 수 없음'));
        console.log(chalk.yellow('    ⚠️ Resume 버튼 탐색 시도...'));
        await saveDebugScreenshot('workflow-status-unclear');

        // Resume 버튼을 다시 한 번 탐색 (다국어 지원)
        const resumeButton = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          return buttons.some(btn => {
            const text = btn.textContent?.trim() || '';
            // 다국어 설정 사용 (러시아어 포함)
            const langData = window._currentLanguageData || { buttons: { resume: ['Resume', '재개'], resumeMembership: ['Resume membership', '멤버십 재개'] } };
            return langData.buttons.resume.some(resumeText => text === resumeText) ||
                   langData.buttons.resumeMembership?.some(resumeText => text.includes(resumeText));
          });
        });

        if (resumeButton) {
          console.log(chalk.yellow('    ⚠️ Resume 버튼 발견 - 클릭 시도'));
          const resumeClicked = await this.clickResumeButton();
          if (!resumeClicked) {
            console.log(chalk.red('    ❌ Resume 버튼 클릭 실패'));
            throw new Error('Resume 버튼 클릭 실패');
          }
        } else {
          console.log(chalk.red('    ❌ Resume 버튼을 찾을 수 없음 - 수동 확인 필요'));
          throw new Error('멤버십 상태를 확인할 수 없음');
        }
      }
      // Case 4: 활성 상태이지만 Pause 버튼이 없는 경우 (드문 경우) - 재확인 추가
      else if (statusBeforeAction.isActive && !statusBeforeAction.hasPauseButton) {
        console.log(chalk.yellow('    ⚠️ 활성 상태로 보이지만 Pause 버튼이 없음 - 재확인 필요'));
        await saveDebugScreenshot('workflow-active-no-pause');

        // 페이지가 완전히 로드되지 않았을 가능성이 있으므로 재확인
        console.log(chalk.cyan('    🔍 페이지 재로드 후 재확인...'));
        await this.page.reload({ waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        const recheckStatus = await this.checkMembershipStatusAfterManage();

        if (recheckStatus.isActive && recheckStatus.hasPauseButton) {
          // 이제 Pause 버튼이 보임 - 정상 활성 상태
          console.log(chalk.green('    ✅ 재확인: 활성 상태 확인됨 (Pause 버튼 발견)'));
          return {
            success: true,
            message: '이미 활성 상태 (재확인 후 Pause 버튼 발견)',
            alreadyActive: true,
            statusText: recheckStatus.statusText,
            nextBillingDate: recheckStatus.nextBillingDate
          };
        } else if (recheckStatus.isPaused && recheckStatus.hasResumeButton) {
          // False Positive - 실제로는 일시중지 상태
          console.log(chalk.yellow('    ⚠️ False Positive! 실제로는 일시중지 상태'));
          const resumeClicked = await this.clickResumeButton();
          if (!resumeClicked) {
            throw new Error('Resume 버튼 클릭 실패');
          }
          console.log(chalk.green('    ✅ Resume 버튼 클릭 성공'));
        } else {
          // 여전히 Pause 버튼이 없다면 활성 상태로 처리
          console.log(chalk.green('    ✅ 활성 상태 확인 (Pause 버튼 미감지)'));
          return {
            success: true,
            message: '활성 상태 (Pause 버튼 없음)',
            alreadyActive: true,
            statusText: recheckStatus.statusText
          };
        }
      }
      
      await saveDebugScreenshot('workflow-after-resume-click');

      // 4. 팝업 확인 및 처리 (향상된 버전 + 타임아웃)
      this.log('팝업 확인 및 처리 중...', 'info');
      console.log(chalk.blue('  [4/4] 팝업 확인 및 처리'));

      // 타임아웃 래퍼 추가 (30초)
      const popupTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('팝업 처리 타임아웃 (30초)')), 30000);
      });

      try {
        const popupResult = await Promise.race([
          this.confirmResumeInPopup(),
          popupTimeoutPromise
        ]);

        if (!popupResult.confirmed) {
          // 팝업이 없는 경우 페이지 변화 확인
          this.log('팝업이 없음, 페이지 변화 확인 중...', 'warning');
          console.log(chalk.yellow('    ⚠️ 팝업 미감지 - 페이지 변화 확인'));

          await new Promise(r => setTimeout(r, 3000));
          await saveDebugScreenshot('workflow-no-popup-check');

          const pageChanged = await this.page.evaluate(() => {
            const bodyText = document.body?.textContent || '';
            return bodyText.includes('Pause') || bodyText.includes('일시중지') ||
                   bodyText.includes('Next billing') || bodyText.includes('다음 결제');
          });

          if (pageChanged) {
            this.log('페이지 변화 감지 - 팝업 없이 처리됨', 'success');
            console.log(chalk.green('    ✅ 페이지 변화 감지 - 팝업 없이 처리됨'));
            result.confirmed = true;
          } else {
            this.log('페이지 변화가 감지되지 않음', 'warning');
            console.log(chalk.yellow('    ⚠️ 페이지 변화 미감지'));
          }
        } else {
          console.log(chalk.green('    ✅ 팝업 확인 완료'));
          result.resumeDate = popupResult.resumeDate;
          result.nextBillingDate = popupResult.nextBillingDate;

          // 팝업 클릭 후 처리 완료 대기 (중요) - 타임아웃 추가
          this.log('팝업 처리 완료, 서버 응답 대기 중...', 'info');
          console.log(chalk.gray('    ⏳ 서버 응답 대기 (최대 10초)...'));

          // 타임아웃 있는 대기
          const waitPromise = new Promise(r => setTimeout(r, 10000));
          const pageLoadPromise = this.page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 10000
          }).catch(() => null); // 네비게이션이 없어도 계속 진행

          await Promise.race([waitPromise, pageLoadPromise]);

          await saveDebugScreenshot('workflow-after-popup-confirm');
        }
      } catch (timeoutError) {
        console.log(chalk.red(`    ❌ ${timeoutError.message}`));
        this.log(timeoutError.message, 'error');
        // 타임아웃이 발생해도 계속 진행
      }

      // 5. 최종 상태 확인 (페이지 새로고침 포함 + 타임아웃)
      this.log('최종 상태 검증 시작...', 'info');
      console.log(chalk.blue('\n  [검증] 최종 상태 확인'));

      // verifyResumeSuccess에도 타임아웃 추가 (25초로 증가)
      const verifyTimeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('검증 타임아웃 (25초)')), 25000);
      });

      let finalStatus;
      try {
        finalStatus = await Promise.race([
          this.verifyResumeSuccess(),
          verifyTimeoutPromise
        ]);
      } catch (verifyError) {
        console.log(chalk.yellow(`    ⚠️ ${verifyError.message} - 현재 상태로 계속 진행`));
        // 타임아웃 시 현재 상태를 확인
        finalStatus = await this.checkCurrentStatus();
      }
      
      await saveDebugScreenshot('workflow-final-verification');
      
      if (finalStatus.success) {
        result.success = true;
        this.log('구독 재개 성공 확인!', 'success');
        console.log(chalk.green.bold('  ✅ 구독 재개 성공 확인!'));
        
        // 날짜 정보 업데이트
        if (finalStatus.nextBillingDate && !result.nextBillingDate) {
          result.nextBillingDate = finalStatus.nextBillingDate;
          console.log(chalk.gray(`    다음 결제일: ${result.nextBillingDate}`));
        }
      } else {
        // 실패 시에도 상세 정보 로깅
        this.log(`재개 검증 실패 - Resume: ${finalStatus.hasResumeButton}, Pause: ${finalStatus.hasPauseButton}`, 'error');
        console.log(chalk.red(`  ❌ 재개 검증 실패`));
        console.log(chalk.gray(`    Resume 버튼: ${finalStatus.hasResumeButton ? '있음' : '없음'}`));
        console.log(chalk.gray(`    Pause 버튼: ${finalStatus.hasPauseButton ? '있음' : '없음'}`));
        throw new Error('재개 검증 실패');
      }

    } catch (error) {
      this.log(`재개 워크플로우 오류: ${error.message}`, 'error');
      console.log(chalk.red(`  ❌ 워크플로우 오류: ${error.message}`));
      result.error = error.message;
      
      // 오류 발생 시 스크린샷
      await saveDebugScreenshot('workflow-error');
    }

    if (this.debugMode) console.log(chalk.cyan('🔄 [Resume Workflow] 실행 완료\n'));
    return result;
  }

  /**
   * Resume 버튼 클릭 (일시중지 워크플로우 참조 개선)
   * 멤버십 관리 버튼 클릭 후 페이지 내용 변경을 처리
   */
  async clickResumeButton(maxRetries = 3, currentAttempt = 1) {
    const lang = languages[this.currentLanguage];
    
    // 최대 재시도 횟수 초과 체크
    if (currentAttempt > maxRetries) {
      this.log(`재개 버튼 클릭 최대 시도 횟수(${maxRetries}) 초과`, 'error');
      
      // 실패 스크린샷 캡처
      await this.captureDebugScreenshot('resume-max-retries-exceeded');
      
      throw new Error(`재개 버튼 클릭 실패: 최대 ${maxRetries}회 시도 후 실패`);
    }
    
    this.log(`재개 버튼 탐색 시작 (시도 ${currentAttempt}/${maxRetries})`, 'info');
    this.log(`멤버십 관리 페이지 열림 상태: ${this.managementPageOpened || false}`, 'debug');
    
    // 먼저 재개 버튼이 이미 보이는지 확인 (멤버십 관리가 열려있는 상태)
    const resumeButtonVisible = await this.page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      // Resume 버튼 또는 관련 텍스트가 이미 보이는지 확인
      return bodyText.includes('Resume') || bodyText.includes('재개') || 
             bodyText.includes('Devam') || // 터키어
             bodyText.includes('Tiếp tục') || bodyText.includes('Khôi phục') || // 베트남어
             bodyText.includes('membership will resume') || bodyText.includes('멤버십이 재개됩니다') ||
             bodyText.includes('gói thành viên sẽ được tiếp tục'); // 베트남어
    });
    
    let manageButtonClicked = false;
    
    // 재개 버튼이 이미 보이지 않는 경우에만 멤버십 관리 버튼 클릭
    if (!resumeButtonVisible && !this.managementPageOpened) {
      this.log('재개 버튼이 보이지 않음, 멤버십 관리 버튼 클릭 필요', 'info');
      
      // "멤버십 관리" 버튼 찾기 및 클릭 (다국어 지원)
      const manageButtonSelectors = [
        'button:has-text("멤버십 관리")',
        'button:has-text("Manage membership")',
        'button:has-text("Üyeliği yönet")', // 터키어
        'button:has-text("Quản lý gói thành viên")', // 베트남어
        'button:has-text("Quản lý")', // 베트남어 짧은 형식
        '[aria-label*="멤버십 관리"]',
        '[aria-label*="Manage membership"]',
        '[aria-label*="Üyeliği yönet"]', // 터키어
        '[aria-label*="Quản lý"]', // 베트남어
        'ytd-button-renderer button',
        'tp-yt-paper-button'
      ];
      
      for (const selector of manageButtonSelectors) {
        try {
          const manageButton = await this.page.$(selector);
          if (manageButton) {
            const buttonText = await manageButton.evaluate(el => el.textContent || el.innerText);
            if (buttonText && (
              buttonText.includes('멤버십 관리') ||
              buttonText.includes('Manage membership') ||
              buttonText.includes('Продлить или изменить') || // 러시아어
              buttonText.includes('Управление подпиской') || // 러시아어
              buttonText.includes('Üyeliği yönet') || // 터키어
              buttonText.includes('Yönet') || // 터키어 짧은 버전
              buttonText.includes('Quản lý gói thành viên') || // 베트남어
              buttonText.includes('Quản lý') // 베트남어 짧은 형식
            )) {
              this.log(`멤버십 관리 버튼 발견: "${buttonText}"`, 'info');
              await manageButton.click();
              manageButtonClicked = true;
              this.log('멤버십 관리 버튼 클릭 성공', 'success');
              break;
            }
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (!manageButtonClicked) {
        // CSS 선택자로 못 찾으면 evaluate로 직접 찾기
        const clicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, [role="button"]'));
          for (const btn of buttons) {
            const text = (btn.textContent || btn.innerText || '').trim();
            if (text && (
              text.includes('멤버십 관리') ||
              text.includes('Manage membership') ||
              text.includes('Продлить или изменить') || // 러시아어
              text.includes('Управление подпиской') || // 러시아어
              text.includes('Üyeliği yönet') || // 터키어
              text.includes('Yönet') || // 터키어 짧은 버전
              text === 'Yönet' || // 터키어 정확한 매칭
              text.includes('Quản lý gói thành viên') || // 베트남어
              text.includes('Quản lý') || // 베트남어 짧은 형식
              text === 'Quản lý' // 베트남어 정확한 매칭
            )) {
              console.log('멤버십 관리 버튼 클릭:', text);
              btn.click();
              return true;
            }
          }
          return false;
        });
        
        if (clicked) {
          manageButtonClicked = true;
          this.log('멤버십 관리 버튼 클릭 성공 (evaluate)', 'success');
        }
      }
    } else {
      this.log('재개 버튼이 이미 보이거나 멤버십 관리가 열려있음', 'info');
      // 멤버십 관리가 이미 열려있는 경우도 처리
      this.managementPageOpened = true;
    }
    
    if (manageButtonClicked) {
      // 멤버십 관리 버튼 클릭 후 페이지 업데이트 대기 (일시중지와 동일하게 7초)
      this.log('멤버십 관리 페이지 로딩 대기 (7초)...', 'info');
      await new Promise(resolve => setTimeout(resolve, 7000));
      
      // 페이지 업데이트 확인 (다국어 지원)
      const pageUpdated = await this.page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        return bodyText.includes('Resume') || bodyText.includes('재개') ||
               bodyText.includes('Pause') || bodyText.includes('일시중지') ||
               bodyText.includes('Devam') || bodyText.includes('Duraklat') || // 터키어
               bodyText.includes('duraklatılacağı') || bodyText.includes('devam ettirileceği') || // 터키어 상태
               bodyText.includes('Tiếp tục') || bodyText.includes('Tạm dừng') || // 베트남어
               bodyText.includes('gói thành viên') || bodyText.includes('Đã tạm dừng'); // 베트남어 상태
      });
      
      if (pageUpdated) {
        this.log('멤버십 관리 페이지 로드 완료', 'success');
        this.managementPageOpened = true;
      } else {
        this.log('페이지 업데이트 확인 실패, 계속 진행', 'warning');
      }
    } else {
      this.log('멤버십 관리 버튼을 찾을 수 없음, 재개 버튼 직접 탐색', 'warning');
    }
    
    // 재개 버튼 찾기 전 대기
    await new Promise(r => setTimeout(r, 2000));
    
    // 페이지 내에서 재개 관련 요소 찾기 (다국어 지원)
    this.log('페이지 내에서 재개 요소 탐색', 'info');
    
    // 재개 버튼 텍스트 목록 확장 (다국어 지원)
    const extendedResumeTexts = [
      '재개',           // 한국어 - 가장 먼저 확인
      '재개하기',     // 한국어 확장
      'Resume',        // 영어
      'Resume membership', // 영어 확장
      'Devam',         // 터키어
      'Devam et',      // 터키어 확장
      'Devam ettir',   // 터키어 확장
      'Tiếp tục',      // 베트남어
      'Khôi phục',     // 베트남어
      ...lang.buttons.resume // 기타 언어
    ];
    
    const resumeInfo = await this.page.evaluate((resumeTexts) => {
      const result = {
        found: false,
        element: null,
        text: null,
        type: null
      };

      console.log('🔍 재개 버튼 검색 시작. 찾는 텍스트:', resumeTexts);

      // YouTube에서 사용하는 모든 버튼 선택자 포함
      const buttonSelectors = [
        'button',
        'tp-yt-paper-button',  // YouTube 특수 버튼
        'yt-button-renderer',  // YouTube 버튼 렌더러
        '[role="button"]',
        'a[role="button"]',
        '.yt-spec-button-shape-next',  // 새로운 YouTube 버튼 클래스
        '.ytd-button-renderer'
      ];

      // 모든 버튼 선택자로 요소 찾기
      const allButtons = [];
      buttonSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!allButtons.includes(el)) {
            allButtons.push(el);
          }
        });
      });

      console.log(`찾은 버튼 수: ${allButtons.length}`);

      // 모든 버튼 검사
      for (const btn of allButtons) {
        const btnText = (btn.textContent || btn.innerText || '').trim();

        if (!btnText) continue;

        // 재개 버튼 확인 - 한국어 우선
        const isResumeButton = resumeTexts.some(resumeText => {
          // 정확히 일치하거나 포함하는 경우
          return btnText === resumeText ||
                 btnText.includes(resumeText) ||
                 resumeText.includes(btnText);  // 역방향 확인도 추가
        });

        if (isResumeButton) {
          console.log(`✅ 재개 버튼 발견: "${btnText}"`);

          // 버튼이 보이는지 확인
          const isVisible = btn.offsetHeight > 0 && btn.offsetWidth > 0;
          const style = window.getComputedStyle(btn);
          const isHidden = style.display === 'none' || style.visibility === 'hidden';

          if (isVisible && !isHidden) {
            // 클릭할 위치로 스크롤
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 클릭 시도
            try {
              btn.click();
              console.log(`✅ 재개 버튼 클릭 성공: "${btnText}"`);
              result.found = true;
              result.text = btnText;
              result.type = btn.tagName.toLowerCase();
              return result;
            } catch (e) {
              console.log(`⚠️ 클릭 실패: ${e.message}`);
            }
          } else {
            console.log(`⚠️ 버튼이 보이지 않음: visible=${isVisible}, hidden=${isHidden}`);
          }
        }
      }

      // 재개 버튼을 못 찾은 경우 페이지 텍스트 출력
      if (!result.found) {
        console.log('❌ 재개 버튼을 찾지 못함');
        console.log('현재 페이지의 모든 버튼 텍스트:');
        allButtons.slice(0, 20).forEach(btn => {
          const text = (btn.textContent || btn.innerText || '').trim();
          if (text) {
            console.log(`  - "${text.substring(0, 50)}"`);
          }
        });
      }

      return result;
    }, extendedResumeTexts);
    
    if (resumeInfo.found) {
      this.log(`재개 버튼 클릭 성공: "${resumeInfo.text}" (${resumeInfo.type})`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      return true;
    }
    
    // 재개 버튼을 찾지 못한 경우 스크롤 시도
    this.log('재개 버튼을 찾지 못함. 페이지 스크롤 시도', 'warning');
    
    await this.page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 스크롤 후 다시 시도
    const resumeInfoAfterScroll = await this.page.evaluate((resumeTexts) => {
      console.log('🔍 [스크롤 후] 재개 버튼 다시 검색');

      // YouTube에서 사용하는 모든 버튼 선택자 포함
      const buttonSelectors = [
        'button',
        'tp-yt-paper-button',
        'yt-button-renderer',
        '[role="button"]',
        'a[role="button"]',
        '.yt-spec-button-shape-next',
        '.ytd-button-renderer'
      ];

      // 모든 버튼 선택자로 요소 찾기
      const allButtons = [];
      buttonSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!allButtons.includes(el)) {
            allButtons.push(el);
          }
        });
      });

      for (const btn of allButtons) {
        const btnText = (btn.textContent || btn.innerText || '').trim();

        if (!btnText) continue;

        // 재개 버튼 확인
        const isResumeButton = resumeTexts.some(resumeText => {
          return btnText === resumeText ||
                 btnText.includes(resumeText) ||
                 resumeText.includes(btnText);
        });

        if (isResumeButton) {
          const isVisible = btn.offsetHeight > 0 && btn.offsetWidth > 0;
          const style = window.getComputedStyle(btn);
          const isHidden = style.display === 'none' || style.visibility === 'hidden';

          if (isVisible && !isHidden) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            try {
              btn.click();
              console.log(`✅ [스크롤 후] 재개 버튼 클릭 성공: "${btnText}"`);
              return {
                found: true,
                text: btnText
              };
            } catch (e) {
              console.log(`⚠️ [스크롤 후] 클릭 실패: ${e.message}`);
            }
          }
        }
      }

      console.log('❌ [스크롤 후] 재개 버튼을 찾지 못함');
      return { found: false };
    }, extendedResumeTexts);
    
    if (resumeInfoAfterScroll.found) {
      this.log(`스크롤 후 재개 버튼 클릭 성공: "${resumeInfoAfterScroll.text}"`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      return true;
    }
    
    // 재시도 로직 추가
    if (currentAttempt < maxRetries) {
      this.log(`재개 버튼을 찾지 못함. 재시도 중... (${currentAttempt + 1}/${maxRetries})`, 'warning');
      await new Promise(r => setTimeout(r, 2000));
      return this.clickResumeButton(maxRetries, currentAttempt + 1);
    }
    
    this.log('재개 버튼을 찾을 수 없습니다 (최대 재시도 횟수 초과)', 'error');
    return false;
  }

  /**
   * 팝업 확인 및 날짜 추출 - 향상된 다국어 지원 버전
   */
  async confirmResumeInPopup() {
    // 디버깅을 위한 스크린샷 저장 함수
    const saveDebugScreenshot = async (step, suffix = '') => {
      try {
        // ✅ AdsPower 기본 설정 사용 (viewport 강제 설정 제거)

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `debug-resume-${step}${suffix ? '-' + suffix : ''}-${timestamp}.png`;
        const filepath = path.join('screenshots', 'debug', filename);
        await fs.mkdir(path.join('screenshots', 'debug'), { recursive: true });
        await this.page.screenshot({ path: filepath, fullPage: true });
        console.log(chalk.gray(`📸 [DEBUG] 스크린샷 저장: ${filename}`));
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 디버그 스크린샷 저장 실패: ${e.message}`));
      }
    };
    
    // PopupService 초기화 (아직 생성되지 않았다면)
    if (!this.popupService) {
      const PopupService = require('../../services/PopupService');
      this.popupService = new PopupService({
        debugMode: true,
        waitForPopup: 3000,
        popupTimeout: 12000
      });
    }
    
    // 현재 언어 설정
    const currentLang = this.currentLanguage || 'en';
    this.log(`📋 팝업 처리 언어: ${currentLang}`, 'info');
    console.log(chalk.blue(`🌐 [Popup] 팝업 처리 언어: ${currentLang}`));
    
    // Step 1: 팝업 감지 시작 스크린샷
    await saveDebugScreenshot('popup-detection-start');
    
    // 팝업이 나타날 때까지 대기 (최대 8초)
    let popupFound = false;
    
    this.log('Resume 팝업 감지 중... (최대 8초 대기)', 'info');
    console.log(chalk.cyan('🔍 [Popup Detection] Resume 팝업 감지 시작 (최대 8초 대기)'));
    
    for (let i = 0; i < 8; i++) {
      console.log(chalk.gray(`⏳ [Popup Wait] ${i + 1}/8초 대기 중...`));
      
      const hasPopup = await this.page.evaluate(() => {
        // 다양한 팝업 선택자 확인 (확장된 목록)
        const popupSelectors = [
          '[role="dialog"]:not([aria-hidden="true"])',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog:not([aria-hidden="true"])',
          'ytd-popup-container',
          'tp-yt-iron-dropdown.opened',
          'yt-dialog',
          '.modal',
          '.popup',
          '.dialog',
          '[data-testid*="modal"]',
          '[data-testid*="dialog"]',
          '.opened'
        ];
        
        for (const selector of popupSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.offsetHeight > 0 && element.offsetWidth > 0) {
              const text = element.textContent || '';
              const textLower = text.toLowerCase();
              
              // Resume 관련 텍스트 확인 (확장된 키워드 - 포르투갈어, 러시아어 추가)
              // 대소문자 구분 없이 매칭
              const resumeKeywords = [
                'resume youtube premium',
                'resume', '재개',
                'restart', '다시 시작',
                'immediately', '즉시',
                'your membership will be resumed',
                '멤버십이 재개됩니다',
                // 포르투갈어 - 중요: 팝업 특정 텍스트
                'quer retomar o youtube premium',  // YouTube Premium을 재개하시겠습니까?
                'a sua subscrição será retomada imediatamente',  // 구독이 즉시 재개됩니다
                'retomada imediatamente',  // 즉시 재개
                'será retomada',  // 재개될 것입니다
                // 터키어
                'üyeliğiniz devam', // 터키어: 멤버십이 계속됩니다
                'devam et', // 터키어: 계속하기
                'youtube premium devam', // 터키어: YouTube Premium 계속
                'youtube premium üyeliği devam ettirilsin mi', // 터키어: YouTube Premium 멤버십을 계속하시겠습니까?
                'üyeliğiniz hemen devam edecek', // 터키어: 멤버십이 즉시 계속됩니다
                'hemen devam', // 터키어: 즉시 계속
                'devam edecek', // 터키어: 계속됩니다
                'devam ettirilsin', // 터키어: 계속하시겠습니까
                'yeniden başla', // 터키어: 다시 시작
                // 러시아어
                'возобновить подписку youtube premium', // YouTube Premium 구독 재개
                'подписка youtube premium', // YouTube Premium 구독
                'возобновить подписку', // 구독 재개
                'подписка будет возобновлена немедленно', // 구독이 즉시 재개됩니다
                'возобновлена немедленно', // 즉시 재개됩니다
                'будет возобновлена', // 재개될 것입니다
                // 베트남어
                'bạn có muốn tiếp tục làm thành viên youtube premium không', // YouTube Premium 멤버십을 계속하시겠습니까?
                'tiếp tục làm thành viên youtube premium', // YouTube Premium 멤버십 계속
                'gói thành viên của bạn sẽ được tiếp tục ngay lập tức', // 멤버십이 즉시 계속됩니다
                'tiếp tục ngay lập tức', // 즉시 계속
                'sẽ được tiếp tục', // 계속될 것입니다
                'tiếp tục gói thành viên', // 멤버십 계속
                'khôi phục gói thành viên' // 멤버십 복원
              ];
              
              const hasResumeKeyword = resumeKeywords.some(keyword => 
                textLower.includes(keyword.toLowerCase())
              );
              
              if (hasResumeKeyword) {
                console.log('팝업 텍스트 감지:', text.substring(0, 100));
                return true;
              }
            }
          }
        }
        
        // 오버레이 확인
        const hasOverlay = !!document.querySelector('iron-overlay-backdrop:not([hidden])');
        if (hasOverlay) {
          console.log('오버레이 감지됨');
        }
        
        return false;
      });
      
      if (hasPopup) {
        popupFound = true;
        this.log('Resume 팝업 발견!', 'success');
        console.log(chalk.green('✅ [Popup Found] Resume 팝업 감지됨!'));
        
        // Step 2: 팝업 감지 후 스크린샷
        await saveDebugScreenshot('popup-detected');
        break;
      }
      
      // 팝업이 아직 없으면 중간 스크린샷 (3초마다)
      if (i % 3 === 2) {
        await saveDebugScreenshot(`popup-waiting-${i + 1}sec`);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!popupFound) {
      this.log('⚠️ 재개 팝업이 나타나지 않음', 'warning');
      console.log(chalk.yellow('⚠️ [No Popup] 재개 팝업이 나타나지 않음'));
      
      // 팝업 미감지 스크린샷 캡처
      await this.captureDebugScreenshot('no-resume-popup-detected');
      
      // 팝업 없이 페이지가 바로 변경된 경우 확인
      const { languages } = require('../../infrastructure/config/multilanguage');
      const langData = languages[currentLang] || languages.en;
      
      const pageChanged = await this.page.evaluate((lang) => {
        const bodyText = document.body?.innerText || '';
        
        // 각 언어별 활성 상태 확인 텍스트
        const activeTexts = [
          ...lang.buttons.pause,
          ...(lang.status.active || []),
          'Pause membership', 'Your membership is active',
          'Next billing', 'Próxima cobrança'
        ];
        
        return activeTexts.some(text => bodyText.includes(text));
      }, langData);
      
      if (pageChanged) {
        this.log('팝업 없이 재개 성공', 'success');
        return { confirmed: true, resumeDate: null, nextBillingDate: null };
      }
      
      // 팝업이 없고 페이지 변경도 없는 경우, 멤버십 관리 버튼을 다시 클릭하여 토글
      this.log('팝업이 나타나지 않아 재개 버튼 다시 클릭 시도', 'info');
      
      // 재시도 제한 체크
      if (this.resumeClickAttempts >= 3) {
        this.log('재개 버튼 클릭 최대 시도 횟수 도달', 'error');
        await this.captureDebugScreenshot('resume-popup-max-retries');
        throw new Error('재개 팝업이 나타나지 않음: 최대 3회 시도 후 실패');
      }
      
      // 재개 버튼 탐색 시작
      this.log('재개 버튼 탐색 시작', 'info');
      
      // 멤버십 관리 페이지 열림 상태 확인
      const managementOpen = await this.page.evaluate(() => {
        // 확장된 멤버십 관리 영역이 있는지 확인
        const expandedSections = document.querySelectorAll('[expanded], [aria-expanded="true"]');
        return expandedSections.length > 0;
      });
      
      this.log(`멤버십 관리 페이지 열림 상태: ${managementOpen}`, 'info');
      
      // 멤버십 관리가 열려있지 않으면 다시 클릭
      if (!managementOpen) {
        // 멤버십 관리 버튼 찾기
        const manageButtonText = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], yt-button-renderer'));
          const manageTexts = ['Manage membership', '멤버십 관리', 'Продлить или изменить', 'Управление подпиской'];
          
          for (const text of manageTexts) {
            const button = buttons.find(btn => {
              const btnText = btn.textContent?.trim();
              return btnText && (btnText === text || btnText.includes(text));
            });
            
            if (button && button.offsetHeight > 0) {
              return button.textContent?.trim();
            }
          }
          return null;
        });
        
        this.log(`멤버십 관리 버튼 발견: "${manageButtonText || '찾을 수 없음'}"`, 'info');
        
        if (manageButtonText) {
          const manageClicked = await this.clickManageButton();
          if (manageClicked) {
            this.log('✅ 멤버십 관리 버튼 클릭 성공', 'success');
            this.log('멤버십 관리 페이지 로딩 대기 (7초)...', 'info');
            await new Promise(r => setTimeout(r, 7000));
          }
        }
      }
      
      // 페이지 내에서 재개 요소 탐색
      this.log('페이지 내에서 재개 요소 탐색', 'info');
      const retryClicked = await this.clickResumeButton();
      
      if (retryClicked) {
        this.log('✅ 재개 버튼 클릭 성공: "Resume" (button)', 'success');
        // 팝업 재확인
        return await this.confirmResumeInPopup();
      }
    }
    
    // 팝업이 발견되었으므로 직접 처리 (다국어 지원)
    if (popupFound) {
      this.log('📋 재개 팝업 감지됨, 버튼 클릭 시도', 'info');
      console.log(chalk.cyan('🖱️ [Popup Action] 재개 팝업 버튼 클릭 시도'));
      
      // Step 3: 팝업 버튼 클릭 전 스크린샷
      await saveDebugScreenshot('popup-before-click');
      
      // 현재 언어 전달하여 언어별 처리
      const clickResult = await this.page.evaluate((lang) => {
        // 팝업 찾기
        const popupSelectors = [
          '[role="dialog"]:not([aria-hidden="true"])',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog:not([aria-hidden="true"])',
          'ytd-popup-container',
          '.opened'
        ];
        
        let dialog = null;
        for (const selector of popupSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.offsetHeight > 0 && element.offsetWidth > 0) {
              const text = element.textContent || '';
              // 다국어 팝업 확인 텍스트
              if (text.includes('Возобновить подписку') || 
                  text.includes('YouTube Premium') ||
                  text.includes('Дата возобновления') ||
                  text.includes('Retomar') ||
                  text.includes('Resume') ||
                  text.includes('재개') ||
                  text.includes('Tiếp tục') ||
                  text.includes('tiếp tục làm thành viên')) {
                dialog = element;
                break;
              }
            }
          }
          if (dialog) break;
        }
        
        if (!dialog) {
          console.log('팝업을 찾을 수 없음');
          return { clicked: false, reason: 'no popup' };
        }
        
        // 팝업 내 버튼 찾기
        const buttons = dialog.querySelectorAll('button, tp-yt-paper-button, [role="button"]');
        console.log(`팝업 내 버튼 수: ${buttons.length}, 언어: ${lang}`);
        
        // 언어별 재개 버튼 텍스트 매핑
        const resumeButtonTexts = {
          'pt': ['Retomar', 'Retomar assinatura', 'Retomar YouTube Premium'],
          'ru': ['Возобновить', 'Возобновить подписку'],
          'en': ['Resume', 'Resume membership', 'Resume subscription'],
          'ko': ['재개', '멤버십 재개', '구독 재개'],
          'es': ['Reanudar', 'Reanudar suscripción'],
          'ja': ['再開', '再開する'],
          'fr': ['Reprendre', 'Reprendre l\'abonnement'],
          'de': ['Fortsetzen', 'Mitgliedschaft fortsetzen'],
          'it': ['Riprendi', 'Riprendi abbonamento'],
          'vi': ['Tiếp tục', 'Tiếp tục làm thành viên', 'Tiếp tục gói thành viên', 'Khôi phục']
        };
        
        // 언어별 취소 버튼 텍스트 매핑
        const cancelButtonTexts = {
          'pt': ['Cancelar', 'Fechar'],
          'ru': ['Отмена', 'Закрыть'],
          'en': ['Cancel', 'Close'],
          'ko': ['취소', '닫기'],
          'es': ['Cancelar', 'Cerrar'],
          'ja': ['キャンセル', '閉じる'],
          'fr': ['Annuler', 'Fermer'],
          'de': ['Abbrechen', 'Schließen'],
          'it': ['Annulla', 'Chiudi'],
          'vi': ['Hủy', 'Đóng']
        };
        
        // 현재 언어의 재개/취소 텍스트 가져오기
        const resumeTexts = resumeButtonTexts[lang] || resumeButtonTexts['en'];
        const cancelTexts = cancelButtonTexts[lang] || cancelButtonTexts['en'];
        
        // 포르투갈어는 버튼 순서가 반대일 수 있으므로 특별 처리
        if (lang === 'pt') {
          console.log('포르투갈어 특별 처리 모드');
          
          // 모든 버튼을 순회하며 "Retomar" 찾기
          for (const button of buttons) {
            const btnText = (button.textContent || '').trim();
            console.log(`포르투갈어 버튼 확인: "${btnText}"`);
            
            // Retomar 버튼인지 확인
            for (const resumeText of resumeTexts) {
              if (btnText === resumeText || btnText.includes(resumeText)) {
                console.log(`포르투갈어 재개 버튼 찾음: "${btnText}"`);
                button.click();
                return { clicked: true, buttonText: btnText, language: lang };
              }
            }
          }
        }
        
        // 다른 언어들 처리
        for (const button of buttons) {
          const btnText = (button.textContent || '').trim();
          console.log(`버튼 텍스트: "${btnText}"`);
          
          // 재개 버튼 찾기
          for (const resumeText of resumeTexts) {
            if (btnText === resumeText || btnText.includes(resumeText)) {
              console.log(`재개 버튼 클릭: "${btnText}"`);
              button.click();
              return { clicked: true, buttonText: btnText, language: lang };
            }
          }
        }
        
        // 텍스트로 못 찾으면 위치로 찾기 (포르투갈어 제외)
        if (lang !== 'pt' && buttons.length >= 2) {
          const confirmButton = buttons[buttons.length - 1]; // 마지막 버튼
          const btnText = (confirmButton.textContent || '').trim();
          
          // 취소 버튼이 아닌지 확인
          let isCancelButton = false;
          for (const cancelText of cancelTexts) {
            if (btnText === cancelText || btnText.includes(cancelText)) {
              isCancelButton = true;
              break;
            }
          }
          
          if (!isCancelButton) {
            console.log(`위치 기반 재개 버튼 클릭: "${btnText}"`);
            confirmButton.click();
            return { clicked: true, buttonText: btnText, method: 'position', language: lang };
          }
        }
        
        return { clicked: false, reason: 'button not found', language: lang };
      }, currentLang);
      
      if (clickResult.clicked) {
        const method = clickResult.method ? ` (${clickResult.method})` : '';
        this.log(`✅ 팝업 내 재개 버튼 클릭 성공: "${clickResult.buttonText}" | 언어: ${clickResult.language}${method}`, 'success');
        console.log(chalk.green(`✅ [Popup Click Success] 버튼: "${clickResult.buttonText}" | 언어: ${clickResult.language}${method}`));
        
        // Step 4: 팝업 버튼 클릭 후 스크린샷
        await saveDebugScreenshot('popup-after-click');
        
        // 처리 완료 대기
        console.log(chalk.gray('⏳ [Wait] 팝업 처리 완료 대기 (3초)...'));
        await new Promise(r => setTimeout(r, 3000));
        
        // Step 5: 최종 결과 스크린샷
        await saveDebugScreenshot('popup-final-result');
        
        return {
          confirmed: true,
          resumeDate: new Date().toISOString(),
          nextBillingDate: null
        };
      } else {
        this.log(`⚠️ 팝업 내 버튼 클릭 실패: ${clickResult.reason} | 언어: ${clickResult.language}`, 'warning');
        console.log(chalk.yellow(`⚠️ [Popup Click Failed] 이유: ${clickResult.reason} | 언어: ${clickResult.language}`));
        
        // 실패 시 스크린샷
        await saveDebugScreenshot('popup-click-failed');
        
        // PopupService 폴백 시도
        const popupResult = await this.popupService.handleResumePopup(this.page, currentLang);
        
        if (popupResult.handled) {
          return {
            confirmed: true,
            resumeDate: popupResult.resumeDate,
            nextBillingDate: popupResult.nextBillingDate
          };
        }
      }
    }
    
    // 폴백: 기존 방식으로 처리
    const { languages } = require('../../infrastructure/config/multilanguage');
    const lang = languages[this.currentLanguage];
    const result = {
      confirmed: false,
      resumeDate: null,
      nextBillingDate: null
    };
    
    // 팝업 내용 상세 로깅
    const popupContent = await this.page.evaluate(() => {
      const popupSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'ytd-popup-container',
        'tp-yt-iron-dropdown',
        'yt-dialog',
        '.ytd-popup-container',
        '.opened'
      ];
      
      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element.offsetHeight > 0 && element.offsetWidth > 0) {
            // 버튼 찾기
            const buttonSelectors = [
              'button',
              'tp-yt-paper-button',
              '[role="button"]',
              'yt-button-renderer',
              'ytd-button-renderer',
              'a[role="button"]',
              '.yt-spec-button-shape-next'
            ];
            
            const buttons = [];
            for (const btnSelector of buttonSelectors) {
              const btns = element.querySelectorAll(btnSelector);
              btns.forEach(btn => {
                const text = btn.textContent?.trim();
                if (text && !buttons.includes(text)) {
                  buttons.push(text);
                }
              });
            }
            
            return {
              selector: selector,
              text: element.textContent?.substring(0, 500) || '',
              buttons: buttons,
              className: element.className,
              id: element.id || 'no-id'
            };
          }
        }
      }
      return null;
    });
    
    if (popupContent) {
      this.log(`재개 팝업 선택자: ${popupContent.selector}`, 'debug');
      this.log(`재개 팝업 ID: ${popupContent.id}, 클래스: ${popupContent.className}`, 'debug');
      this.log(`재개 팝업 내용: ${popupContent.text.substring(0, 200)}...`, 'debug');
      this.log(`재개 팝업 버튼들: ${popupContent.buttons.join(', ')}`, 'debug');
    }
    
    // 팝업에서 날짜 추출 및 확인 버튼 클릭
    const popupResult = await this.page.evaluate((langData) => {
      console.log('재개 팝업 버튼 찾기 시작...');
      
      const popupSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'ytd-popup-container',
        'tp-yt-iron-dropdown',
        'yt-dialog',
        '.opened'
      ];
      
      let dialog = null;
      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element.offsetHeight > 0 && element.offsetWidth > 0) {
            const text = element.textContent || '';
            const textLower = text.toLowerCase();
            
            // Resume 관련 텍스트 확인 (포르투갈어, 터키어, 러시아어 포함)
            // 대소문자 구분 없이 매칭
            const popupKeywords = [
              'resume', '재개',
              'restart', '다시 시작',
              // 포르투갈어 팝업 특정 텍스트
              'quer retomar o youtube premium',  // YouTube Premium을 재개하시겠습니까?
              'será retomada imediatamente',  // 즉시 재개됩니다
              'retomada imediatamente',  // 즉시 재개
              // 터키어
              'youtube premium üyeliği devam ettirilsin mi', // 터키어: YouTube Premium 멤버십을 계속하시겠습니까?
              'üyeliğiniz hemen devam edecek', // 터키어: 멤버십이 즉시 계속됩니다
              'devam edecek', // 터키어: 계속됩니다
              'devam ettirilsin', // 터키어: 계속하시겠습니까
              'hemen devam', // 터키어: 즉시 계속
              // 러시아어
              'возобновить подписку youtube premium', // YouTube Premium 구독 재개
              'подписка youtube premium', // YouTube Premium 구독
              'возобновить подписку', // 구독 재개
              'возобновлена немедленно', // 즉시 재개됩니다
              'будет возобновлена' // 재개될 것입니다
            ];
            
            const hasPopupKeyword = popupKeywords.some(keyword => 
              textLower.includes(keyword.toLowerCase())
            );
            
            if (hasPopupKeyword) {
              dialog = element;
              console.log('활성 재개 팝업 찾음:', selector);
              console.log('팝업 텍스트:', text.substring(0, 200));
              break;
            }
          }
        }
        if (dialog) break;
      }
      
      if (dialog) {
        const popupText = dialog.textContent || '';
        const result = {
          hasPopup: true,
          clicked: false,
          dates: []
        };
        
        // 날짜 추출 - 다양한 패턴
        const datePatterns = [
          // 영어
          /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi,
          /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}/gi,
          // 베트남어
          /\d{1,2}\s+thg\s+\d{1,2}/g,
          /\d{1,2}\s+tháng\s+\d{1,2}/g,
          // 한국어
          /\d{1,2}월\s*\d{1,2}일/g,
          // 터키어
          /\d{1,2}\s+(Ocak|Mart|Şubat|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/gi,
          // 러시아어
          /\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/gi,
          // 숫자 형식
          /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
          /\b\d{4}-\d{2}-\d{2}\b/g
        ];
        
        for (const pattern of datePatterns) {
          const matches = popupText.match(pattern);
          if (matches && matches.length > 0) {
            result.dates = result.dates.concat(matches);
          }
        }
        
        // 버튼 찾기 - 다양한 선택자
        const buttonSelectors = [
          'button',
          'tp-yt-paper-button', 
          '[role="button"]',
          'yt-button-renderer button',
          'ytd-button-renderer button',
          '.yt-spec-button-shape-next',
          'a[role="button"]'
        ];
        
        const allButtons = [];
        for (const selector of buttonSelectors) {
          const buttons = dialog.querySelectorAll(selector);
          buttons.forEach(btn => {
            if (!allButtons.includes(btn)) {
              allButtons.push(btn);
            }
          });
        }
        
        console.log(`재개 팝업에서 ${allButtons.length}개 버튼 발견`);
        
        // 러시아어 팝업 특별 처리 (스크린샷에서 확인된 구조)
        if (popupText.includes('Возобновить подписку YouTube Premium') || 
            popupText.includes('возобновлена немедленно')) {
          console.log('러시아어 재개 팝업 감지 - 직접 처리');
          
          // tp-yt-paper-button 요소 직접 탐색
          const paperButtons = dialog.querySelectorAll('tp-yt-paper-button');
          console.log(`러시아어 팝업: Paper 버튼 ${paperButtons.length}개 발견`);
          
          for (const btn of paperButtons) {
            const btnText = btn.textContent?.trim();
            console.log(`Paper 버튼 텍스트: "${btnText}"`);
            
            // "Возобновить" 버튼만 클릭 (Отмена는 제외)
            if (btnText === 'Возобновить') {
              console.log('러시아어 재개 버튼 클릭!');
              btn.scrollIntoView({ behavior: 'instant', block: 'center' });
              // 클릭 이벤트 발송
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              btn.dispatchEvent(clickEvent);
              result.clicked = true;
              console.log('러시아어 재개 버튼 클릭 완료!');
              return result;
            }
          }
          
          // 대체 방법: 모든 버튼 요소 확인
          const allButtonElements = dialog.querySelectorAll('button, [role="button"], yt-button-renderer');
          for (const element of allButtonElements) {
            const text = element.textContent?.trim();
            if (text === 'Возобновить') {
              console.log('러시아어 재개 버튼 (대체 방법) 클릭!');
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
              element.click();
              result.clicked = true;
              return result;
            }
          }
        }
        
        // 버튼 텍스트 우선순위 목록 (확장됨)
        const buttonPriority = [
          // 영어 (정확한 매칭)
          'Resume',
          'Resume YouTube Premium',
          'Confirm',
          'Yes, resume',
          'OK',
          'Continue',
          'Yes',
          // 한국어  
          '재개',
          'YouTube Premium 재개',
          '확인',
          '예, 재개',
          '계속',
          '예',
          // 포르투갈어 - 팝업에서는 두 번째 Retomar가 확인 버튼
          'Retomar',  // 중요: 팝업 내에서는 확인 버튼 역할
          'Confirmar',
          'Sim',
          // 베트남어
          'Tiếp tục',
          'Khôi phục',
          // 터키어
          'Devam',
          'Sürdür',
          // 러시아어
          'Возобновить',
          'Продолжить',
          // 독일어
          'Fortsetzen',
          'Weiter',
          // 프랑스어
          'Reprendre',
          'Continuer',
          // 스페인어
          'Reanudar',
          'Continuar',
          // 일본어
          '再開',
          '続行',
          // 중국어
          '恢复',
          '继续'
        ];
        
        // 포르투갈어 특별 처리 - 팝업 내에서 Cancelar가 아닌 Retomar 찾기
        if (popupText.includes('Quer retomar') || popupText.includes('será retomada imediatamente')) {
          console.log('포르투갈어 팝업 감지 - Retomar 버튼 우선 찾기');
          
          // 팝업 내 버튼 중 Retomar 찾기 (Cancelar 제외)
          for (const button of allButtons) {
            const btnText = button.textContent?.trim();
            if (btnText === 'Retomar') {
              // 같은 팝업 내에 Cancelar도 있는지 확인 (팝업 확인용)
              const hasCancelar = allButtons.some(b => b.textContent?.trim() === 'Cancelar');
              if (hasCancelar) {
                console.log('포르투갈어 팝업 확인 버튼 Retomar 클릭');
                if (button.offsetHeight > 0 && button.offsetWidth > 0 && !button.disabled) {
                  button.scrollIntoView({ behavior: 'instant', block: 'center' });
                  button.click();
                  result.clicked = true;
                  return result;
                }
              }
            }
          }
        }
        
        // 우선순위에 따라 버튼 찾기 (대소문자 구분 없이)
        for (const targetText of buttonPriority) {
          for (const button of allButtons) {
            const btnText = button.textContent?.trim();
            
            if (btnText) {
              // 대소문자 구분 없이 비교
              const btnTextLower = btnText.toLowerCase();
              const targetTextLower = targetText.toLowerCase();
              
              if (btnTextLower === targetTextLower || btnTextLower.includes(targetTextLower)) {
                console.log(`재개 팝업 버튼 발견 및 클릭: "${btnText}"`);
                
                // 버튼이 보이고 클릭 가능한지 확인
                if (button.offsetHeight > 0 && button.offsetWidth > 0 && !button.disabled) {
                  button.scrollIntoView({ behavior: 'instant', block: 'center' });
                  button.click();
                  result.clicked = true;
                  console.log('재개 버튼 클릭 완료!');
                  return result;
                } else {
                  console.log('버튼이 보이지 않거나 비활성화됨:', btnText);
                }
              }
            }
          }
        }
        
        // 언어 데이터 기반 확인 (fallback)
        console.log('우선순위 매칭 실패, 언어 데이터 확인...');
        for (const button of allButtons) {
          const btnText = button.textContent?.trim();
          
          if (!btnText) continue;
          
          // 취소 버튼 제외 (포르투갈어 Cancelar 추가)
          if (btnText === '취소' || btnText.toLowerCase() === 'cancel' || 
              btnText === 'İptal' || btnText === 'Cancelar') {
            continue;
          }
          
          // Resume 관련 텍스트 확인
          for (const resumeText of langData.buttons.resume) {
            if (btnText === resumeText || btnText.includes(resumeText)) {
              console.log(`재개 팝업 버튼 클릭 (언어 데이터): "${btnText}"`);
              
              if (button.offsetHeight > 0 && button.offsetWidth > 0 && !button.disabled) {
                button.scrollIntoView({ behavior: 'instant', block: 'center' });
                button.click();
                result.clicked = true;
                return result;
              }
            }
          }
        }
        
        // 모든 버튼 정보 로깅 (디버깅)
        console.log('적합한 재개 버튼을 찾지 못함. 모든 버튼 텍스트:');
        allButtons.forEach((btn, index) => {
          const text = btn.textContent?.trim();
          if (text) {
            console.log(`  ${index + 1}. "${text}" (visible: ${btn.offsetHeight > 0}, disabled: ${btn.disabled})`);
          }
        });
      } else {
        console.log('활성 재개 팝업을 찾을 수 없음');
      }
      
      return { hasPopup: false, clicked: false };
    }, lang);
    
    if (popupResult.clicked) {
      this.log('재개 팝업 버튼 클릭 성공!', 'success');
      result.confirmed = true;
      
      if (popupResult.dates && popupResult.dates.length > 0) {
        this.log(`재개 팝업에서 추출된 날짜: ${popupResult.dates.join(', ')}`, 'info');
        // DateParsingService를 사용하여 날짜 파싱 (재개 컨텍스트)
        result.resumeDate = this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage, '재개');
        if (popupResult.dates.length > 1) {
          result.nextBillingDate = this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage, '재개');
        }
      } else {
        // 팝업 텍스트에서 UniversalDateExtractor로 날짜 추출 시도
        this.log('기존 방식으로 날짜를 찾지 못함, UniversalDateExtractor 사용', 'warning');
        
        // 팝업 전체 텍스트 가져오기
        const popupText = await this.page.evaluate(() => {
          const dialogs = document.querySelectorAll('tp-yt-paper-dialog:not([aria-hidden="true"]), [role="dialog"]:not([aria-hidden="true"])');
          for (const dialog of dialogs) {
            if (dialog.offsetHeight > 0) {
              return dialog.textContent || '';
            }
          }
          return '';
        });
        
        if (popupText) {
          this.log(`팝업 텍스트 일부: ${popupText.substring(0, 200)}`, 'debug');
          
          // UniversalDateExtractor로 날짜 추출 - Resume 컨텍스트 적용
          const extractedDates = this.dateParser.extractUniversalDates(popupText, this.currentLanguage, 'resume');
          
          if (extractedDates && extractedDates.length > 0) {
            this.log(`✅ UniversalDateExtractor로 날짜 추출 성공: ${extractedDates.length}개`, 'success');

            // 첫 번째 날짜를 다음 결제일로 변환
            const firstDate = extractedDates[0];
            if (firstDate && typeof firstDate === 'object' && firstDate.year && firstDate.month && firstDate.day) {
              const month = String(firstDate.month).padStart(2, '0');
              const day = String(firstDate.day).padStart(2, '0');
              result.nextBillingDate = `${firstDate.year}-${month}-${day}`;
              this.log(`다음 결제일: ${result.nextBillingDate}`, 'info');
            } else {
              result.nextBillingDate = firstDate; // 이미 문자열인 경우
            }

            if (extractedDates.length > 1) {
              const secondDate = extractedDates[1];
              if (secondDate && typeof secondDate === 'object' && secondDate.year && secondDate.month && secondDate.day) {
                const month = String(secondDate.month).padStart(2, '0');
                const day = String(secondDate.day).padStart(2, '0');
                result.resumeDate = `${secondDate.year}-${month}-${day}`;
              } else {
                result.resumeDate = secondDate;
              }
            }
          } else {
            this.log('UniversalDateExtractor로도 날짜를 찾을 수 없음', 'warning');
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 5000));
    } else {
      this.log('재개 팝업 버튼 클릭 실패', 'error');
      
      // 실패 시 스크린샷 저장
      try {
        const timestamp = Date.now();
        await this.page.screenshot({ 
          path: `resume_popup_error_${timestamp}.png`,
          fullPage: false
        });
        this.log(`재개 팝업 오류 스크린샷 저장: resume_popup_error_${timestamp}.png`, 'debug');
      } catch (e) {
        // 무시
      }
    }
    
    return result;
  }

  /**
   * 재개 성공 확인 (일시중지 워크플로우 참조 개선)
   */

  /**
   * 페이지에서 다음 결제일 찾기 (이미 활성 상태일 때 사용)
   */
  async findNextBillingDateFromPage() {
    try {
      const dateText = await this.page.evaluate(() => {
        // 더 정확한 날짜 찾기 - 특정 영역 우선 탐색
        const possibleSelectors = [
          'div[class*="billing"]',
          'div[class*="payment"]',
          'div[class*="subscription"]',
          'span[class*="date"]',
          'p:contains("Next")',
          'p:contains("다음")',
          'p:contains("結제")'
        ];
        
        for (const selector of possibleSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const elem of elements) {
              const text = elem.textContent || '';
              // 유효한 날짜 패턴만 매칭 (2020-2030년 범위)
              const validDatePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)s+d{1,2},?s*(20[2-3]d)|(20[2-3]d)[./-]s*(0?[1-9]|1[0-2])[./-]s*(0?[1-9]|[12][0-9]|3[01])/;
              const match = text.match(validDatePattern);
              if (match) {
                return match[0];
              }
            }
          } catch (e) {
            // 선택자 오류 무시
          }
        }
        
        // 전체 페이지에서 검색 (fallback)
        const pageText = document.body?.textContent || '';
        const matches = pageText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)s+d{1,2},?s*(20[2-3]d)/g);
        if (matches && matches.length > 0) {
          // YouTube Premium 관련 텍스트 근처의 날짜 우선
          for (const match of matches) {
            const index = pageText.indexOf(match);
            const context = pageText.substring(Math.max(0, index - 100), Math.min(pageText.length, index + 100));
            if (context.includes('Premium') || context.includes('billing') || context.includes('payment')) {
              return match;
            }
          }
          // 첫 번째 날짜 반환
          return matches[0];
        }
        
        return null;
      });
      
      if (dateText) {
        this.log(`페이지에서 날짜 발견: ${dateText}`, 'info');
        // 재개 컨텍스트로 날짜 파싱
        return this.dateParser.parseDate(dateText, this.currentLanguage, '재개');
      }
      
      return null;
    } catch (error) {
      this.log(`날짜 추출 실패: ${error.message}`, 'warning');
      return null;
    }
  }

  async verifyResumeSuccess() {
    this.log('🔍 재개 성공 검증 시작 (강화된 검증)', 'info');

    // 언어 데이터 준비 (확장 감지에 필요)
    const lang = this.languageService.getLanguageTexts(this.currentLanguage);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1단계: UI 업데이트 대기 (페이지 새로고침 제거)
    // Resume 버튼 클릭 후 자동으로 UI가 업데이트되므로 새로고침 불필요
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.log('⏳ UI 업데이트 대기 중 (새로고침 없이)...', 'info');

    // Resume 클릭 후 UI 업데이트 대기만 수행
    await new Promise(r => setTimeout(r, 3000));  // 3초 대기

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2단계: Manage 버튼 클릭 및 확장 영역 감지 (필수)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.log('🔘 Manage membership 버튼 클릭 시도 (필수)', 'info');

    let manageButtonExpanded = false;
    let expandedContainer = null;

    // Manage 버튼 클릭 시도 (타임아웃 15초로 증가)
    const clickTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Manage 버튼 클릭 타임아웃')), 15000)
    );

    const clicked = await Promise.race([
      this.clickManageButton(),
      clickTimeout
    ]);

    if (!clicked) {
      throw new Error('❌ Manage membership 버튼 클릭 실패 - 검증 불가능');
    }

    this.log('✅ Manage 버튼 클릭 성공', 'success');

    // 클릭 후 드롭다운 확장 충분히 대기
    await new Promise(r => setTimeout(r, 4000));

    // 확장 영역 감지 (인라인 확장 지원)
    const expansionResult = await this.page.evaluate((langData) => {
      // 확장 후 나타나는 주요 버튼/텍스트 패턴
      const expansionIndicators = [
        // 버튼 패턴
        ...langData.buttons.pause,    // Pause, 일시중지 등
        ...langData.buttons.resume,   // Resume, 재개 등
        'Cancel', 'Cancelar', 'Annuler', 'キャンセル', '취소',
        'Edit', 'Editar', 'Modifier', '編集', '편집',
        // 텍스트 패턴
        'Family sharing settings', 'Backup payment method',
        'Billed with', 'Next billing date',
        '가족 공유 설정', '백업 결제 수단'
      ];

      // 페이지 전체 텍스트
      const pageText = document.body?.textContent || '';

      // 버튼 검색
      const allButtons = document.querySelectorAll('button, [role="button"], yt-button-renderer, tp-yt-paper-button');
      let visibleButtonCount = 0;
      let foundIndicators = [];

      for (const btn of allButtons) {
        const btnText = btn.textContent?.trim();
        const rect = btn.getBoundingClientRect();

        // 가시성 체크
        if (rect.height > 0 && rect.width > 0) {
          visibleButtonCount++;

          // 확장 지표 매칭
          for (const indicator of expansionIndicators) {
            if (btnText && btnText.includes(indicator)) {
              foundIndicators.push(btnText);
              break;
            }
          }
        }
      }

      // 텍스트 지표도 확인 (버튼이 아닌 경우)
      for (const indicator of ['Family sharing settings', 'Backup payment method', 'Next billing date']) {
        if (pageText.includes(indicator)) {
          foundIndicators.push(`텍스트: ${indicator}`);
        }
      }

      const found = foundIndicators.length > 0 || visibleButtonCount > 5;

      return {
        found: found,
        method: foundIndicators.length > 0 ? 'indicator' : 'buttonCount',
        visibleButtonCount: visibleButtonCount,
        foundIndicators: foundIndicators.slice(0, 5)  // 최대 5개만
      };
    }, lang);

    if (!expansionResult.found) {
      this.log('❌ Manage membership 확장 감지 실패', 'error');
      this.log(`  - 가시적 버튼: ${expansionResult.visibleButtonCount}개`, 'error');
      throw new Error('Manage membership 확장 감지 실패 - 확장 지표를 찾을 수 없음');
    }

    manageButtonExpanded = true;
    this.log('✅ Manage 확장 확인됨', 'success');
    this.log(`  - 감지 방법: ${expansionResult.method}`, 'info');
    this.log(`  - 가시적 버튼: ${expansionResult.visibleButtonCount}개`, 'info');
    if (expansionResult.foundIndicators.length > 0) {
      this.log(`  - 확장 지표: ${expansionResult.foundIndicators.join(', ')}`, 'info');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3단계: Manage 확장 영역 내 버튼 검색 (엄격한 텍스트 매칭)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.log('🔍 Manage 확장 영역 내 버튼 검색 시작', 'info');

    const status = await this.page.evaluate((langData) => {
      const result = {
        success: false,
        nextBillingDate: null,
        hasResumeButton: false,
        hasPauseButton: false,
        pauseButtonDetails: null,
        resumeButtonDetails: null,
        pageText: document.body?.textContent || '',
        detectionLog: []
      };

      // ✅ 버튼 가시성 엄격 체크 함수
      function isButtonReallyVisible(btn) {
        if (!btn) return false;

        const rect = btn.getBoundingClientRect();
        const style = window.getComputedStyle(btn);

        const checks = {
          hasSize: rect.height > 0 && rect.width > 0,
          notDisplayNone: style.display !== 'none',
          notVisibilityHidden: style.visibility !== 'hidden',
          notOpacityZero: parseFloat(style.opacity) > 0.1,
          inViewport: rect.top >= -rect.height && rect.left >= -rect.width
        };

        return Object.values(checks).every(check => check === true);
      }

      // ✅ 버튼 텍스트 매칭 함수 (단어 기반)
      function isButtonMatch(btnText, keywords) {
        if (!btnText) return false;

        const normalizedBtnText = btnText.toLowerCase().trim();

        return keywords.some(keyword => {
          const normalizedKeyword = keyword.toLowerCase().trim();

          // 정확히 일치
          if (normalizedBtnText === normalizedKeyword) {
            return true;
          }

          // 키워드로 시작하고, 그 다음이 공백이거나 끝
          // 예: "Pause" → "Pause", "Pause membership" 매칭
          // 예: "Pause" → "Membership pauses on" 매칭 안됨
          const afterKeyword = normalizedBtnText.substring(normalizedKeyword.length);
          if (normalizedBtnText.startsWith(normalizedKeyword) &&
              (afterKeyword === '' || afterKeyword.startsWith(' '))) {
            return true;
          }

          // 단어로 포함 (공백으로 시작하는 경우)
          // 예: "Cancel" → " Cancel" 매칭
          if (normalizedBtnText.includes(' ' + normalizedKeyword + ' ') ||
              normalizedBtnText.includes(' ' + normalizedKeyword)) {
            return true;
          }

          return false;
        });
      }

      // ✅ 전체 페이지에서 버튼 검색 (인라인 확장 지원)
      const allButtons = document.querySelectorAll('button, [role="button"], yt-button-renderer, tp-yt-paper-button');
      result.detectionLog.push(`🔎 검색할 버튼 개수: ${allButtons.length}개`);

      // ✅ 버튼 확인 (단어 기반 매칭)
      for (const btn of allButtons) {
        const btnText = btn.textContent?.trim();
        if (!btnText || btnText.length > 100) continue;  // 길이 제한 완화

        // Resume 버튼 체크
        const isResumeButton = isButtonMatch(btnText, langData.buttons.resume);

        if (isResumeButton && isButtonReallyVisible(btn)) {
          result.hasResumeButton = true;
          result.resumeButtonDetails = {
            text: btnText,
            visible: true,
            matchedKeyword: langData.buttons.resume.find(k =>
              btnText.toLowerCase().includes(k.toLowerCase())
            )
          };
          result.detectionLog.push(`✅ Resume 버튼 감지: "${btnText}"`);
        }

        // Pause 버튼 체크 (단어 기반 매칭)
        const isPauseButton = isButtonMatch(btnText, langData.buttons.pause);

        if (isPauseButton && isButtonReallyVisible(btn)) {
          result.hasPauseButton = true;
          result.pauseButtonDetails = {
            text: btnText,
            visible: true,
            matchedKeyword: langData.buttons.pause.find(k =>
              btnText.toLowerCase().includes(k.toLowerCase())
            )
          };
          result.detectionLog.push(`✅ Pause 버튼 감지: "${btnText}"`);
        }
      }

      // ✅ 성공 판단: Resume 없고 Pause 있을 때 = 결제중(활성)
      if (!result.hasResumeButton && result.hasPauseButton) {
        result.success = true;
        result.detectionLog.push('✅ 판정: 결제중(활성) - Pause 버튼 존재, Resume 버튼 없음');
      } else if (result.hasResumeButton) {
        result.detectionLog.push('❌ 판정: 일시중지 - Resume 버튼 존재');
      } else if (!result.hasResumeButton && !result.hasPauseButton) {
        result.detectionLog.push('❌ 판정: 버튼 없음 - 상태 불명');
      }

      // 날짜 추출
      const datePatterns = [
        /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}/i,
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}/i,
        /\d{1,2}월\s*\d{1,2}일/,
        /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/,
        /\d{1,2}\s+thg\s+\d{1,2}/,
        /\d{1,2}\s+tháng\s+\d{1,2}/,
        /\d{1,2}\s+(Ocak|Mart|Şubat|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/i,
        /\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i,
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
        /\b\d{4}-\d{2}-\d{2}\b/
      ];

      for (const pattern of datePatterns) {
        const dateMatch = result.pageText.match(pattern);
        if (dateMatch) {
          result.nextBillingDate = dateMatch[0];
          break;
        }
      }

      return result;
    }, lang);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 검증 결과 로깅 (상세 감지 로그 포함)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    this.log('\n📊 버튼 감지 상세 로그:', 'info');
    if (status.detectionLog && status.detectionLog.length > 0) {
      status.detectionLog.forEach(log => {
        this.log(`  ${log}`, 'info');
      });
    }

    this.log('\n📊 최종 검증 결과:', 'info');
    this.log(`  - Resume 버튼: ${status.hasResumeButton ? '❌ 존재 (일시중지 상태)' : '✅ 없음'}`, 'info');
    this.log(`  - Pause 버튼: ${status.hasPauseButton ? '✅ 존재 (결제중 상태)' : '❌ 없음'}`, 'info');

    if (status.resumeButtonDetails) {
      this.log(`  - Resume 버튼 상세:`, 'info');
      this.log(`    • 텍스트: "${status.resumeButtonDetails.text}"`, 'info');
      this.log(`    • 매칭된 키워드: "${status.resumeButtonDetails.matchedKeyword}"`, 'info');
    }

    if (status.pauseButtonDetails) {
      this.log(`  - Pause 버튼 상세:`, 'info');
      this.log(`    • 텍스트: "${status.pauseButtonDetails.text}"`, 'info');
      this.log(`    • 매칭된 키워드: "${status.pauseButtonDetails.matchedKeyword}"`, 'info');
    }

    this.log(`\n  - 최종 판정: ${status.success ? '✅ 재개 성공 (Pause 버튼 존재)' : '❌ 재개 실패'}`, status.success ? 'success' : 'error');

    if (status.nextBillingDate) {
      status.nextBillingDate = this.dateParser.parseDate(status.nextBillingDate, this.currentLanguage, '재개');
    }

    return status;
  }

  /**
   * Google Sheets 업데이트 (결제재개 탭)
   */
  async updateGoogleSheets(profileId, result) {
    try {
      if (!this.pauseSheetRepository) {
        this.log('Google Sheets Repository가 설정되지 않음', 'warning');
        return;
      }

      await this.pauseSheetRepository.initialize();
      
      // 이메일로 검색하도록 변경 (일시중지 작업과 동일한 로직)
      const email = this.profileData?.email || this.profileData?.googleId;
      if (!email) {
        this.log('이메일 정보가 없어 프로필 ID로 시도', 'warning');
        // email이 없으면 프로필 ID로 fallback
      }
      
      const searchIdentifier = email || profileId;
      this.log(`Google Sheets 검색 식별자: ${searchIdentifier} (타입: ${email ? '이메일' : '프로필ID'})`, 'info');
      
      let updateData;
      
      // 계정 잠김 감지된 경우
      if (result.status === '계정잠김' || result.accountLocked) {
        // 시간 형식
        const now = new Date();
        const timeStr = now.toLocaleString('ko-KR');
        
        const lockDetails = '🔒 계정 잠김 - 수동 복구 필요';
        const lockNote = `⚠️ 계정이 Google에 의해 비활성화됨 | 수동 복구 필요 | ${timeStr}`;
        
        updateData = {
          status: '계정잠김',  // E열: 상태
          result: lockDetails,  // H열: 결과 
          note: lockNote,
          ipAddress: result.browserIP || 'N/A'
        };
        
        this.log('📝 계정 잠김 상태를 Google Sheets에 기록', 'info');
      }
      // reCAPTCHA 감지된 경우 또는 recaptchaDetected 플래그가 있는 경우
      else if (result.status === 'recaptcha_required' || result.status === 'recaptcha_detected' || result.recaptchaDetected) {
        // 시간 형식
        const now = new Date();
        const timeStr = now.toLocaleString('ko-KR');
        
        const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
        const recaptchaDetails = `🤖 reCAPTCHA 감지 (${langName})`;
        const recaptchaNote = `⚠️ reCAPTCHA 감지됨 | 언어: ${langName} | 상태: 다음 계정으로 진행 | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
        
        updateData = {
          status: '번호인증계정',  // 상태를 번호인증계정으로 설정
          result: recaptchaDetails,
          ipAddress: result.browserIP || 'N/A',
          note: recaptchaNote,
          language: languages[this.currentLanguage]?.name || this.currentLanguage
        };
      }
      // 만료 감지된 경우
      else if (result.status === '만료됨' || result.isExpired) {
        // 시간 형식
        const now = new Date();
        const timeStr = now.toLocaleString('ko-KR');

        const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
        const expiredDetails = `⏰ 구독 만료 (${langName})`;
        const expiredNote = `⚠️ 구독이 만료됨 | 언어: ${langName} | 감지 지표: ${result.expiredIndicator || '만료 페이지 감지'} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;

        updateData = {
          status: '만료됨',  // E열: 상태를 만료됨으로 설정
          result: expiredDetails,  // H열: 결과
          ipAddress: result.browserIP || 'N/A',
          note: expiredNote,
          language: languages[this.currentLanguage]?.name || this.currentLanguage
        };

        this.log('📝 만료된 구독 상태를 Google Sheets에 기록', 'info');
      } else if (result.success) {
        // 성공 케이스를 더 상세하게 구분
        let detailedResult = '';
        let detailedNote = '';
        
        if (result.status === 'already_active') {
          // 이미 활성 상태였던 경우
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          detailedResult = `✅ 이미 활성 (${langName})`;
          
          // 시간 형식
          const now = new Date();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();
          const period = hours < 12 ? '오전' : '오후';
          const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          
          const nextBilling = result.nextBillingDate || '날짜 없음';
          const reason = result.detectionReason || result.activeReason || 'Pause 버튼 존재';

          detailedNote = `✅ 이미 활성 상태 (${reason}) | 언어: ${langName} | 다음결제: ${nextBilling} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
        } else if (result.status === 'resumed') {
          // 새로 재개한 경우
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          detailedResult = `🆕 재개 성공 (${langName})`;
          
          // 시간 형식
          const now = new Date();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();
          const period = hours < 12 ? '오전' : '오후';
          const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          
          // 다음 결제일 포맷팅
          const nextBilling = result.nextBillingDate || result.resumeDate || '날짜 없음';
          
          detailedNote = `🆕 구독 재개 성공 | 언어: ${langName} | 다음결제: ${nextBilling} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
        } else if (result.status === 'pause_schedule_cancelled') {
          // 일시정지 예약 취소 성공
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          detailedResult = `🔄 일시정지 취소 (${langName})`;
          
          // 시간 형식
          const now = new Date();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();
          const period = hours < 12 ? '오전' : '오후';
          const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          
          const nextBilling = result.nextBillingDate || '날짜 없음';
          
          detailedNote = `🔄 일시정지 예약 취소 | 언어: ${langName} | 다음결제: ${nextBilling} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
        } else {
          // 기타 성공 케이스
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          detailedResult = `✅ 재개 성공 (${langName})`;
          
          // 시간 형식
          const now = new Date();
          const hours = now.getHours();
          const minutes = now.getMinutes();
          const seconds = now.getSeconds();
          const period = hours < 12 ? '오전' : '오후';
          const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
          const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          
          const nextBilling = result.nextBillingDate || result.resumeDate || '날짜 없음';
          
          detailedNote = `✅ 재개 성공 | 언어: ${langName} | 다음결제: ${nextBilling} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
        }
        
        updateData = {
          status: '결제중',  // 구독재개 성공 시 '결제중'으로 변경
          result: detailedResult,
          nextBillingDate: result.nextBillingDate,
          ipAddress: result.browserIP || 'N/A',
          note: detailedNote,
          language: languages[this.currentLanguage]?.name || this.currentLanguage,
          isResumed: true  // 재개 성공 플래그 추가
        };
      } else {
        // 실패 케이스도 상세한 로그 형식으로 통일
        // 시간 형식
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const period = hours < 12 ? '오전' : '오후';
        const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        // 수동 체크가 필요한 경우 특별 처리
        if (result.needsManualCheck) {
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          const manualCheckDetails = `⏳ 수동 체크 필요 (${langName})`;
          const manualCheckNote = `⚠️ 수동 체크 필요 | 언어: ${langName} | 사유: ${result.manualCheckReason || '페이지 로딩 중 또는 불완전한 상태'} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
          
          updateData = {
            status: '일시중지',  // 상태를 일시중지로 설정
            result: manualCheckDetails,
            ipAddress: result.browserIP || 'N/A',
            error: result.error || '수동 체크 필요',
            note: manualCheckNote,
            language: languages[this.currentLanguage]?.name || this.currentLanguage
          };
        } else if (result.status === 'expired') {
          // 만료된 계정인 경우 특별 처리
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          const expiredDetails = `🚫 구독 만료 (${langName})`;
          const expiredNote = `⚠️ 만료된 계정 감지 | 언어: ${langName} | 상태: YouTube Premium 구독 만료로 재개 불가 | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
          
          updateData = {
            status: '만료됨',  // '만료'가 아닌 '만료됨'으로 변경
            result: expiredDetails,
            ipAddress: result.browserIP || 'N/A',
            error: result.error,
            note: expiredNote,
            language: languages[this.currentLanguage]?.name || this.currentLanguage
          };
        } else if (result.status === 'no_resume_option') {
          // Resume 옵션이 없는 경우
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          const noResumeDetails = `⛔ Resume 옵션 없음 (${langName})`;
          const noResumeNote = `⛔ Resume 옵션 미발견 | 언어: ${langName} | 상태: 재개 버튼을 찾을 수 없음 | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
          
          updateData = {
            result: noResumeDetails,
            ipAddress: result.browserIP || 'N/A',
            error: result.error,
            note: noResumeNote,
            language: languages[this.currentLanguage]?.name || this.currentLanguage
          };
        } else if (result.status === 'recaptcha_required' || result.status === 'recaptcha_detected' || 
                   result.error === 'RECAPTCHA_DETECTED' || result.recaptchaDetected) {
          // reCAPTCHA 감지 케이스 특별 처리
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          const recaptchaDetails = `🤖 reCAPTCHA 감지 (${langName})`;
          const recaptchaNote = `🤖 reCAPTCHA 인증 필요 | 언어: ${langName} | 상태: 수동 로그인 필요 | IP: ${result.browserIP || 'N/A'} | ${result.recaptchaTime || timeStr}`;
          
          updateData = {
            status: '번호인증계정',  // 상태는 그대로 유지
            result: recaptchaDetails,
            ipAddress: result.browserIP || 'N/A',
            error: 'reCAPTCHA 인증 필요',
            note: recaptchaNote,
            language: languages[this.currentLanguage]?.name || this.currentLanguage
          };
        } else {
          // 기타 실패 케이스
          const langName = languages[this.currentLanguage]?.name || this.currentLanguage;
          let errorDetails = '';
          let errorCategory = '';
          
          // 오류 유형별 상세 분류
          if (result.error?.includes('로그인') || result.error?.includes('login')) {
            errorDetails = `🔐 로그인 실패 (${langName})`;
            errorCategory = '로그인 문제';
          } else if (result.error?.includes('타임아웃') || result.error?.includes('timeout')) {
            errorDetails = `⏱️ 타임아웃 (${langName})`;
            errorCategory = '시간 초과';
          } else if (result.error?.includes('팝업') || result.error?.includes('popup')) {
            errorDetails = `🚨 팝업 처리 실패 (${langName})`;
            errorCategory = '팝업 문제';
          } else if (result.error?.includes('버튼') || result.error?.includes('button')) {
            errorDetails = `🔘 버튼 클릭 실패 (${langName})`;
            errorCategory = 'UI 요소 문제';
          } else if (result.error?.includes('네트워크') || result.error?.includes('network')) {
            errorDetails = `🌐 네트워크 오류 (${langName})`;
            errorCategory = '네트워크 문제';
          } else if (result.error?.includes('2FA') || result.error?.includes('TOTP')) {
            errorDetails = `🔑 2FA 인증 실패 (${langName})`;
            errorCategory = '2단계 인증 문제';
          } else {
            errorDetails = `❌ 재개 실패 (${langName})`;
            errorCategory = result.error || '알 수 없는 오류';
          }
          
          // 상세 오류 정보 포함
          const detailedErrorNote = `❌ 재개 실패 | 언어: ${langName} | 오류: ${errorCategory} | 상세: ${result.error?.substring(0, 100)} | IP: ${result.browserIP || 'N/A'} | ${timeStr}`;
          
          updateData = {
            result: errorDetails,
            ipAddress: result.browserIP || 'N/A',
            error: result.error,
            note: detailedErrorNote,
            language: languages[this.currentLanguage]?.name || this.currentLanguage
          };
        }
      }
      
      // 결제재개 탭 업데이트 (이메일로 검색)
      const updated = await this.pauseSheetRepository.updateResumeStatus(searchIdentifier, updateData);
      
      if (updated) {
        this.log('결제재개 시트 업데이트 성공', 'success');
      } else {
        this.log('결제재개 시트 업데이트 실패', 'warning');
      }
    } catch (error) {
      this.log(`결제재개 시트 업데이트 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 스크린샷 캡처
   */
  /**
   * 구독 상태 확인 (만료 여부 체크)
   */
  async checkSubscriptionStatus() {
    const status = {
      isExpired: false,
      hasResumeButton: false,
      hasPauseButton: false,
      isActive: false,
      hasAnyStatus: false
    };
    
    try {
      const pageInfo = await this.page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const bodyTextLower = bodyText.toLowerCase();
        
        // 재개 버튼 확인
        const resumeTexts = ['resume', '재개', 'retomar', 'devam', 'возобновить'];
        const hasResume = resumeTexts.some(text => bodyTextLower.includes(text.toLowerCase()));
        
        // 일시정지 버튼 확인
        const pauseTexts = ['pause', '일시중지', 'pausar', 'duraklat', 'приостановить'];
        const hasPause = pauseTexts.some(text => bodyTextLower.includes(text.toLowerCase()));
        
        // 활성 상태 확인
        const activeTexts = ['active', '활성', 'ativa', 'aktif', 'активна', 'next billing', '다음 결제'];
        const isActive = activeTexts.some(text => bodyTextLower.includes(text.toLowerCase()));
        
        // 일시정지 상태 확인
        const pausedTexts = ['paused', '일시중지됨', 'pausada', 'duraklatıldı', 'приостановлена'];
        const isPaused = pausedTexts.some(text => bodyTextLower.includes(text.toLowerCase()));
        
        // YouTube Premium 텍스트 존재 여부
        const hasPremium = bodyTextLower.includes('youtube premium') || bodyTextLower.includes('youtube 프리미엄');
        
        return {
          hasResume,
          hasPause,
          isActive,
          isPaused,
          hasPremium,
          pageText: bodyText.substring(0, 500) // 디버깅용
        };
      });
      
      status.hasResumeButton = pageInfo.hasResume;
      status.hasPauseButton = pageInfo.hasPause;
      status.isActive = pageInfo.isActive || pageInfo.hasPause; // Pause 버튼이 있으면 활성 상태
      status.hasAnyStatus = pageInfo.hasResume || pageInfo.hasPause || pageInfo.isActive || pageInfo.isPaused;
      
      // 만료 판단 로직
      // 1. Resume 버튼도 없고
      // 2. Pause 버튼도 없고
      // 3. 활성 상태도 아니고
      // 4. 일시정지 상태도 아닌 경우
      // = 만료된 계정
      if (!status.hasAnyStatus && pageInfo.hasPremium) {
        status.isExpired = true;
        this.log('만료 계정 판단 근거:', 'info');
        this.log(`- Resume 버튼: ${status.hasResumeButton}`, 'debug');
        this.log(`- Pause 버튼: ${status.hasPauseButton}`, 'debug');
        this.log(`- 활성 상태: ${status.isActive}`, 'debug');
        this.log(`- 일시정지 상태: ${pageInfo.isPaused}`, 'debug');
        this.log(`- YouTube Premium 페이지: ${pageInfo.hasPremium}`, 'debug');
      }
      
    } catch (error) {
      this.log(`구독 상태 확인 오류: ${error.message}`, 'error');
    }
    
    return status;
  }
  
  /**
   * 만료된 계정 스크린샷 캡처
   */
  async captureExpiredAccountScreenshot() {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const screenshotDir = path.join(process.cwd(), 'screenshots', 'expired');
      await fs.mkdir(screenshotDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const email = this.profileData?.email || this.profileData?.googleId || 'unknown';
      const cleanEmail = email.replace(/[@.]/g, '_');
      const filename = `${timestamp}_${cleanEmail}_expired.png`;
      const filepath = path.join(screenshotDir, filename);
      
      await this.page.screenshot({ 
        path: filepath,
        fullPage: true 
      });
      
      this.log(`만료 계정 스크린샷 저장: ${filename}`, 'info');
    } catch (error) {
      this.log(`만료 계정 스크린샷 저장 실패: ${error.message}`, 'error');
    }
  }
  
  /**
   * 디버그용 스크린샷 캡처
   */
  async captureDebugScreenshot(context) {
    try {
      if (!this.page) {
        this.log('스크린샷 캡처 실패: 페이지 객체 없음', 'warning');
        return;
      }

      // ✅ AdsPower 기본 설정 사용 (viewport 강제 설정 제거)

      // ✅ 페이지가 로드 중이면 잠깐 대기 (너무 긴 대기는 하지 않음)
      try {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 2000 });
      } catch (loadError) {
        // 타임아웃되어도 계속 진행
        this.log('페이지 로드 대기 타임아웃 (계속 진행)', 'debug');
      }

      // 스크린샷 디렉토리 생성
      const screenshotDir = path.join(process.cwd(), 'screenshots', 'debug');
      await fs.mkdir(screenshotDir, { recursive: true });

      // 파일명 생성
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const email = this.profileData?.email || 'unknown';
      const cleanEmail = email.replace(/@.*/, '');
      const filename = `${timestamp}_${cleanEmail}_${context}.png`;
      const filepath = path.join(screenshotDir, filename);

      // 스크린샷 캡처
      await this.page.screenshot({
        path: filepath,
        fullPage: true
      });

      this.log(`📸 디버그 스크린샷 저장: ${filename}`, 'info');
      return filepath;

    } catch (error) {
      this.log(`스크린샷 캡처 실패: ${error.message}`, 'warning');
      return null;
    }
  }

  /**
   * 스크린샷 캡처
   * SessionLogService가 있으면 새 폴더 구조 사용, 없으면 기존 방식 폴백
   */
  async captureScreenshot(profileId, result, step = null) {
    try {
      if (!this.page) {
        this.log('스크린샷 캡처 실패: 페이지 객체 없음', 'warning');
        return;
      }

      const email = this.profileData?.email || this.profileData?.googleId || 'unknown';
      const status = result.success ? 'success' : 'error';

      // SessionLogService가 있고 세션이 활성화되어 있으면 새 방식 사용
      if (this.sessionLogService?.hasActiveSession()) {
        const stepName = step || (result.success ? '05_success' : `error_${result.errorType || 'unknown'}`);
        const description = result.success ? '작업 완료' : `오류: ${result.error || 'unknown'}`;
        await this.sessionLogService.capture(this.page, stepName, description);
        return;
      }

      // 폴백: 기존 방식 (SessionLogService 없는 경우)
      const screenshotDir = path.join(process.cwd(), 'logs', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
      const cleanEmail = email.replace(/@.*/, '');

      const filename = `${dateStr}_${timeStr}_${cleanEmail}_${status}.png`;
      const filepath = path.join(screenshotDir, filename);

      await this.page.screenshot({
        path: filepath,
        fullPage: false
      });

      this.log(`📷 스크린샷 저장: ${filename}`, 'success');

    } catch (error) {
      this.log(`스크린샷 캡처 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 결과 메시지 포맷팅 (일시중지 작업과 동일한 형식)
   */
  formatResultMessage(result) {
    const { languages } = require('../../infrastructure/config/multilanguage');
    
    // 현재 시간 (한국 시간)
    const now = new Date();
    const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const hours = kstTime.getHours();
    const minutes = kstTime.getMinutes();
    const seconds = kstTime.getSeconds();
    const period = hours < 12 ? '오전' : '오후';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // 언어 정보
    const lang = languages[this.currentLanguage]?.name || '알 수 없음';
    
    // 다음 결제일 포맷팅
    const nextBilling = result.nextBillingDate || result.resumeDate || 'N/A';
    
    if (result.status === 'already_active') {
      // 이미 활성 상태인 경우
      const reason = result.detectionReason || result.activeReason || 'Pause 버튼 존재';
      return `✅ 이미 활성 상태 (${reason}) ┃ 언어: ${lang} ┃ 다음결제: ${nextBilling} ┃ ${timeStr}`;
    } else if (result.status === 'resumed' || result.success) {
      // 신규 재개인지 확인
      const isNewResume = result.previousStatus === '일시중지' || result.isNewResume;
      if (isNewResume) {
        return `🆕 신규 재개 성공 ┃ 언어: ${lang} ┃ 다음결제: ${nextBilling} ┃ ${timeStr}`;
      }
      return `🔄 재개 성공 ┃ 언어: ${lang} ┃ 다음결제: ${nextBilling} ┃ ${timeStr}`;
    } else if (result.status === 'cannot_resume') {
      return `⚠️ 재개 불가 (일시중지 아님) ┃ 언어: ${lang} ┃ ${timeStr}`;
    } else if (result.error) {
      return `❌ 실패: ${result.error} ┃ 언어: ${lang} ┃ ${timeStr}`;
    } else {
      return `✅ 성공 ┃ 언어: ${lang} ┃ 다음결제: ${nextBilling} ┃ ${timeStr}`;
    }
  }

  /**
   * 브라우저 IP 확인 (신규 추가)
   */
  async checkBrowserIP() {
    try {
      this.log('브라우저 IP 확인 중...', 'info');
      
      // 여러 방법으로 IP 확인 시도
      const ipCheckMethods = [
        // 방법 1: 브라우저 내에서 fetch API 사용
        async () => {
          return await this.page.evaluate(async () => {
            try {
              const response = await fetch('https://api.ipify.org?format=json', {
                timeout: 8000
              });
              const data = await response.json();
              return data.ip;
            } catch (e) {
              return null;
            }
          });
        },
        
        // 방법 2: 브라우저에서 다른 API 시도
        async () => {
          return await this.page.evaluate(async () => {
            try {
              const response = await fetch('https://api.my-ip.io/ip');
              const ip = await response.text();
              return ip.trim();
            } catch (e) {
              return null;
            }
          });
        },
        
        // 방법 3: PauseSheetRepository의 getIPAddress 메서드 사용
        async () => {
          if (this.pauseSheetRepository) {
            return await this.pauseSheetRepository.getIPAddress();
          }
          return null;
        },
        
        // 방법 4: Node.js에서 직접 axios 사용
        async () => {
          try {
            const axios = require('axios');
            const response = await axios.get('https://api.ipify.org?format=json', {
              timeout: 8000
            });
            return response.data.ip;
          } catch (e) {
            return null;
          }
        }
      ];
      
      // 순차적으로 IP 확인 방법 시도
      for (let i = 0; i < ipCheckMethods.length; i++) {
        try {
          this.log(`IP 확인 방법 ${i + 1}/${ipCheckMethods.length} 시도 중...`, 'info');
          const ip = await ipCheckMethods[i]();
          
          if (ip && ip !== 'Unknown' && ip.length > 0 && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            this.log(`✅ 브라우저 IP 확인 성공: ${ip} (방법 ${i + 1})`, 'success');
            return ip;
          }
        } catch (error) {
          this.log(`IP 확인 방법 ${i + 1} 실패: ${error.message}`, 'warning');
        }
      }
      
      this.log('❌ 모든 IP 확인 방법 실패', 'warning');
      return 'N/A';
      
    } catch (error) {
      this.log(`IP 확인 치명적 오류: ${error.message}`, 'error');
      return 'N/A';
    }
  }
  
  /**
   * 브라우저 연결 해제
   */
  async disconnectBrowser(profileId) {
    try {
      if (profileId) {
        // 실제 사용된 ID와 전달된 ID 로그
        if (this.actualProfileId && this.actualProfileId !== profileId) {
          this.log(`브라우저 종료 - 대체 ID 사용: ${this.actualProfileId} (원래 ID: ${profileId})`, 'info');
        } else {
          this.log(`브라우저 종료: ${profileId}`, 'debug');
        }
        await this.adsPowerAdapter.closeBrowser(profileId);
      }
      this.browser = null;
      this.page = null;
      this.controller = null; // controller도 정리
      this.actualProfileId = null; // actualProfileId도 초기화
    } catch (error) {
      // 오류가 발생해도 로컬 참조는 정리
      this.browser = null;
      this.page = null;
      this.controller = null;
      this.actualProfileId = null;
      this.log(`브라우저 연결 해제 중 오류 (무시): ${error.message}`, 'debug');
    }
  }

  /**
   * 로그 출력
   */
  log(message, type = 'info') {
    const colors = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red
    };
    
    const color = colors[type] || chalk.white;
    const prefix = type === 'success' ? '✅' : 
                   type === 'error' ? '❌' : 
                   type === 'warning' ? '⚠️' : '📌';
    
    if (this.logger && this.logger.log) {
      this.logger.log(color(`${prefix} ${message}`));
    } else {
      console.log(color(`${prefix} ${message}`));
    }
  }
}

module.exports = EnhancedResumeSubscriptionUseCase;