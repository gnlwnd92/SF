/**
 * Enhanced Resume Subscription UseCase - 개선된 버전
 *
 * 주요 개선사항:
 * 1. Stuck 상태 감지 시 실제 재시작 처리
 * 2. 1분(60초) 타임아웃 후 자동 재시작
 * 3. 무한 루프 방지를 위한 최대 재시도 횟수 제한
 * 4. 페이지 로딩 상태 모니터링 강화
 */

const chalk = require('chalk');
const path = require('path');
const fs = require('fs').promises;
const { languages } = require('../../infrastructure/config/languages');
const DateParsingService = require('../../services/DateParsingService');
const UniversalDateExtractor = require('../../services/UniversalDateExtractor');

class EnhancedResumeSubscriptionUseCaseFixed {
  constructor(dependencies) {
    // 기존 의존성 주입
    this.adsPowerAdapter = dependencies.adsPowerAdapter;
    this.profileRepository = dependencies.profileRepository;
    this.sheetsRepository = dependencies.sheetsRepository;
    this.logger = dependencies.logger;
    this.config = dependencies.config || {};

    // 서비스 초기화
    this.authService = dependencies.authService;
    this.navigationService = dependencies.navigationService;
    this.buttonService = dependencies.buttonService;
    this.languageService = dependencies.languageService;
    this.googleLoginHelper = dependencies.googleLoginHelper;
    this.dateParser = new DateParsingService();
    this.universalExtractor = new UniversalDateExtractor({ debugMode: false });

    // 상태 변수
    this.page = null;
    this.browser = null;
    this.currentLanguage = 'en';
    this.actualProfileId = null;

    // 개선된 타임아웃 설정
    this.STUCK_TIMEOUT = 60 * 1000;        // 60초 - stuck 타임아웃
    this.MAX_STUCK_RETRIES = 2;            // 최대 2번 재시작 시도
    this.WORKFLOW_TIMEOUT = 5 * 60 * 1000; // 5분 - 전체 워크플로우 타임아웃
    this.PROGRESS_CHECK_INTERVAL = 5000;   // 5초마다 진행 상황 체크
  }

  /**
   * 개선된 execute 메서드 - stuck 감지 및 자동 재시작 기능 포함
   */
  async execute(profileId, options = {}) {
    let stuckRetryCount = 0;
    let lastResult = null;

    // 재시작 루프 - 최대 재시도 횟수만큼 반복
    while (stuckRetryCount <= this.MAX_STUCK_RETRIES) {
      try {
        console.log(chalk.cyan(`\\n🔄 워크플로우 시작 (시도 ${stuckRetryCount + 1}/${this.MAX_STUCK_RETRIES + 1})`));

        // 실제 워크플로우 실행
        lastResult = await this.executeWorkflow(profileId, options, stuckRetryCount);

        // 성공 또는 복구 불가능한 에러인 경우 루프 종료
        if (lastResult.success ||
            lastResult.error === 'RECAPTCHA_DETECTED' ||
            lastResult.error === 'ACCOUNT_DISABLED' ||
            lastResult.skipRetry) {
          break;
        }

        // Stuck 또는 타임아웃으로 실패한 경우
        if (lastResult.error === 'STUCK_TIMEOUT' || lastResult.timedOut) {
          stuckRetryCount++;

          if (stuckRetryCount <= this.MAX_STUCK_RETRIES) {
            console.log(chalk.yellow(`\\n⚠️ Stuck 감지 - ${stuckRetryCount}번째 재시작을 시도합니다...`));
            console.log(chalk.gray('  브라우저를 닫고 처음부터 다시 시작합니다.'));

            // 브라우저 정리
            await this.cleanupBrowser(profileId);

            // 재시작 전 대기
            await new Promise(r => setTimeout(r, 5000));
          } else {
            console.log(chalk.red(`\\n❌ 최대 재시도 횟수 초과 - 작업을 포기합니다.`));
            lastResult.error = 'MAX_RETRIES_EXCEEDED';
            break;
          }
        } else {
          // 기타 에러
          break;
        }

      } catch (error) {
        this.log(`워크플로우 실행 중 예외 발생: ${error.message}`, 'error');
        lastResult = {
          profileId,
          success: false,
          error: error.message,
          status: 'error'
        };
        break;
      }
    }

    // 최종 정리
    await this.cleanupBrowser(profileId);

    return lastResult || {
      profileId,
      success: false,
      error: 'UNKNOWN_ERROR',
      status: 'failed'
    };
  }

  /**
   * 실제 워크플로우 실행 - stuck 감지 로직 포함
   */
  async executeWorkflow(profileId, options = {}, retryCount = 0) {
    this.profileId = profileId;
    this.profileName = options.profileName || profileId;
    this.email = options.email || null;
    this.profileData = options.profileData || {};
    this.debugMode = options.debugMode || false;

    // 타임아웃 및 진행 상황 추적 변수
    let lastProgressTime = Date.now();
    let currentStep = '시작';
    let workflowTimeout = null;
    let stuckChecker = null;
    let isStuck = false;

    const result = {
      profileId,
      success: false,
      status: null,
      resumeDate: null,
      nextBillingDate: null,
      browserIP: null,
      error: null,
      duration: 0,
      timedOut: false
    };

    // 진행 상황 업데이트 함수
    const updateProgress = (step) => {
      currentStep = step;
      lastProgressTime = Date.now();
      isStuck = false; // 진행이 있으면 stuck 상태 해제
      console.log(chalk.gray(`  ⏳ [진행] ${step}`));
    };

    // 개선된 Stuck 감지 체커
    stuckChecker = setInterval(() => {
      const timeSinceProgress = Date.now() - lastProgressTime;

      // 30초 경고
      if (timeSinceProgress > 30000 && timeSinceProgress < this.STUCK_TIMEOUT) {
        if (!isStuck) {
          console.log(chalk.yellow(`\\n⚠️ 정체 감지: ${Math.floor(timeSinceProgress/1000)}초 동안 "${currentStep}" 단계에서 진행 없음`));
          isStuck = true;
        }
      }

      // 60초 타임아웃 - 자동 종료
      if (timeSinceProgress > this.STUCK_TIMEOUT && !result.timedOut) {
        console.log(chalk.red(`\\n⏱️ STUCK 타임아웃: 60초 동안 진행 없음 - 재시작 필요`));
        result.timedOut = true;
        result.error = 'STUCK_TIMEOUT';
        result.stuckStep = currentStep;

        // Stuck 체커 정리
        clearInterval(stuckChecker);
        clearTimeout(workflowTimeout);
      }
    }, this.PROGRESS_CHECK_INTERVAL);

    // 전체 워크플로우 타임아웃 (5분)
    workflowTimeout = setTimeout(() => {
      if (!result.timedOut) {
        result.timedOut = true;
        result.error = 'WORKFLOW_TIMEOUT';
        console.log(chalk.red(`\\n⏱️ 전체 워크플로우 타임아웃 (5분 초과)`));
      }
    }, this.WORKFLOW_TIMEOUT);

    try {
      console.log(chalk.cyan.bold('\\n═══════════════════════════════════════════'));
      console.log(chalk.cyan.bold(`🎯 Resume Workflow 시작 - 프로필: ${profileId}`));
      console.log(chalk.cyan.bold(`📌 재시도 횟수: ${retryCount}/${this.MAX_STUCK_RETRIES}`));
      console.log(chalk.cyan.bold('═══════════════════════════════════════════\\n'));

      // Step 1: 브라우저 연결
      updateProgress('브라우저 연결');
      console.log(chalk.blue('📌 [Step 1/6] 브라우저 연결'));

      // 타임아웃 체크
      if (result.timedOut) {
        throw new Error('STUCK_TIMEOUT');
      }

      const browser = await this.connectBrowserWithTimeout(profileId, this.email, updateProgress);
      if (!browser) {
        throw new Error('브라우저 연결 실패');
      }

      console.log(chalk.green('✅ 브라우저 연결 성공\\n'));

      // Step 2: YouTube Premium 페이지 이동
      updateProgress('YouTube Premium 페이지 이동');
      console.log(chalk.blue('📌 [Step 2/6] YouTube Premium 페이지 이동'));

      if (result.timedOut) {
        throw new Error('STUCK_TIMEOUT');
      }

      // 개선된 navigateToPremiumPage - updateProgress 콜백과 타임아웃 체크 포함
      const navResult = await this.navigateToPremiumPageWithTimeout(browser, updateProgress, result);

      if (!navResult.success) {
        throw new Error(navResult.error || 'Premium 페이지 이동 실패');
      }

      updateProgress('Premium 페이지 로드 완료');
      console.log(chalk.green('✅ Premium 페이지 이동 완료\\n'));

      // Step 3: 언어 감지
      updateProgress('언어 감지');
      console.log(chalk.blue('📌 [Step 3/6] 언어 감지'));

      if (result.timedOut) {
        throw new Error('STUCK_TIMEOUT');
      }

      this.currentLanguage = await this.detectPageLanguage(browser);
      console.log(chalk.green(`✅ 언어 감지 완료: ${languages[this.currentLanguage]?.name || this.currentLanguage}\\n`));

      // Step 4: 현재 상태 확인
      updateProgress('구독 상태 확인');
      console.log(chalk.blue('📌 [Step 4/6] 구독 상태 확인'));

      if (result.timedOut) {
        throw new Error('STUCK_TIMEOUT');
      }

      const currentStatus = await this.checkCurrentStatus(browser);

      // 상태에 따른 처리...
      if (currentStatus.isActive && !currentStatus.isPausedScheduled) {
        result.status = 'already_active';
        result.success = true;

        if (currentStatus.nextBillingDate) {
          result.nextBillingDate = this.dateParser.parseDate(currentStatus.nextBillingDate, this.currentLanguage, '재개');
        }
      }

      // TODO: 나머지 로직 구현...

    } catch (error) {
      this.log(`워크플로우 실행 실패: ${error.message}`, 'error');

      if (!result.error) {
        result.error = error.message;
      }

      if (error.message === 'STUCK_TIMEOUT') {
        result.timedOut = true;
        result.error = 'STUCK_TIMEOUT';
      }

    } finally {
      // 타이머 정리
      if (stuckChecker) clearInterval(stuckChecker);
      if (workflowTimeout) clearTimeout(workflowTimeout);

      // 실행 시간 기록
      result.duration = Date.now() - (Date.now() - lastProgressTime);
    }

    return result;
  }

  /**
   * 타임아웃 처리가 포함된 브라우저 연결
   */
  async connectBrowserWithTimeout(profileId, email, updateProgress) {
    const timeout = 30000; // 30초 타임아웃
    const startTime = Date.now();

    try {
      // 주기적으로 진행 상황 업데이트
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        updateProgress(`브라우저 연결 중... (${Math.floor(elapsed/1000)}초)`);
      }, 5000);

      const browser = await Promise.race([
        this.connectBrowser(profileId, email),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('브라우저 연결 타임아웃')), timeout)
        )
      ]);

      clearInterval(progressInterval);
      return browser;

    } catch (error) {
      this.log(`브라우저 연결 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 타임아웃 처리가 포함된 Premium 페이지 이동
   */
  async navigateToPremiumPageWithTimeout(browser, updateProgress, result) {
    const timeout = 60000; // 60초 타임아웃
    const startTime = Date.now();

    try {
      // 로그인 상태 체크 간격
      let checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        // 타임아웃 체크
        if (elapsed > timeout) {
          clearInterval(checkInterval);
          result.timedOut = true;
          result.error = 'STUCK_TIMEOUT';
          return { success: false, error: 'STUCK_TIMEOUT' };
        }

        // 진행 상황 업데이트
        updateProgress(`페이지 로딩 중... (${Math.floor(elapsed/1000)}초)`);

        // 페이지 상태 체크
        try {
          const currentUrl = this.page?.url() || '';

          // 로그인 페이지에서 stuck 상태 감지
          if (currentUrl.includes('accounts.google.com') && elapsed > 30000) {
            console.log(chalk.yellow('⚠️ 로그인 페이지에서 30초 이상 머무름 - stuck 가능성'));

            // 페이지 로딩 상태 체크
            const isLoading = await this.page.evaluate(() => {
              return document.readyState !== 'complete';
            });

            if (isLoading && elapsed > 45000) {
              console.log(chalk.red('❌ 로그인 페이지 로딩이 45초 이상 지속 - stuck 확정'));
              clearInterval(checkInterval);
              result.timedOut = true;
              result.error = 'STUCK_TIMEOUT';
              return { success: false, error: 'STUCK_TIMEOUT' };
            }
          }
        } catch (e) {
          // 페이지 체크 실패는 무시
        }
      }, 5000);

      // 실제 네비게이션 수행
      const navResult = await this.navigateToPremiumPage(browser, updateProgress);

      clearInterval(checkInterval);
      return navResult;

    } catch (error) {
      this.log(`Premium 페이지 이동 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 브라우저 정리
   */
  async cleanupBrowser(profileId) {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }

      if (this.adsPowerAdapter) {
        await this.adsPowerAdapter.closeBrowser(profileId);
      }

      console.log(chalk.gray('🧹 브라우저 정리 완료'));
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 브라우저 정리 중 오류: ${error.message}`));
    }
  }

  /**
   * 로깅 헬퍼
   */
  log(message, level = 'info') {
    if (this.logger) {
      this.logger[level](message);
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }

  // 기존 메서드들은 동일하게 유지 (connectBrowser, navigateToPremiumPage, detectPageLanguage 등)
  // 이 부분은 기존 파일에서 복사해서 사용

  async connectBrowser(profileId, email) {
    // 기존 구현 사용
    throw new Error('구현 필요 - 기존 코드에서 복사');
  }

  async navigateToPremiumPage(browser, updateProgress) {
    // 기존 구현 사용
    throw new Error('구현 필요 - 기존 코드에서 복사');
  }

  async detectPageLanguage(browser) {
    // 기존 구현 사용
    return 'en';
  }

  async checkCurrentStatus(browser) {
    // 기존 구현 사용
    return { isActive: false, isPausedScheduled: false };
  }
}

module.exports = EnhancedResumeSubscriptionUseCaseFixed;