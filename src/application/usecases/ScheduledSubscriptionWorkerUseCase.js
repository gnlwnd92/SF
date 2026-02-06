/**
 * ScheduledSubscriptionWorkerUseCase v2.33 - 통합워커 상태 기반 결제 주기 관리
 *
 * 워크플로우:
 * [일시중지 상태] → 결제 시간 임박(now + M분) → 결제재개 → [결제중 상태]
 * [결제중 상태] → 결제 완료 후(now - N분) → 일시중지 → [일시중지 상태]
 * [결제 미완료] → 30분 재시도 (최대 24시간) → 성공 시 일시중지 / 24시간 초과 시 수동체크
 *
 * 특징:
 * - '통합워커' 단일 탭 사용
 * - E열 상태 기반 작업 선택 (일시중지/결제중)
 * - L열 재시도 횟수 공유 (분산 워커 간)
 * - J열 잠금으로 충돌 방지
 * - N열/O열 결제 미완료 재시도 시간 관리 (v2.14)
 * - 지속 실행 모드 (Ctrl+C로 안전 종료)
 *
 * v2.33 변경사항:
 * - 매번 읽기 방식: 각 작업 처리 직전 refreshTaskByEmail()로 시트 재조회
 * - 이메일 재검증: processTask()에서 잠금 후 rowIndex의 이메일이 일치하는지 확인
 * - 행 삭제로 인한 rowIndex 불일치 시 다른 계정에 결과 기록하는 문제 방지
 *
 * v2.14 변경사항:
 * - 결제 미완료 감지 및 시간 기반 24시간 재시도 시스템
 * - N열(결제미완료_체크): 최초 감지 시각 (한국 시간)
 * - O열(결제미완료_재시작): 다음 재시도 시각 (한국 시간)
 * - payment_pending 상태 처리
 *
 * v2.12 변경사항:
 * - 터미널 로그 UX 개선 (비전문가 친화적)
 * - 시간 포맷 [HH:MM] 추가
 * - 작업 없으면 1줄 요약, 있으면 간결한 진행 로그
 * - 심각 오류 ⛔ 강조 표시 (logCritical)
 * - 디버그 모드에서만 상세 정보 출력
 */

const chalk = require('chalk');
const WORKER_DEFAULTS = require('../../config/workerDefaults');

class ScheduledSubscriptionWorkerUseCase {
  constructor({
    adsPowerAdapter,
    adsPowerIdMappingService,  // 이메일 → AdsPower ID 매핑
    pauseUseCase,              // enhancedPauseSubscriptionUseCase
    resumeUseCase,             // enhancedResumeSubscriptionUseCase
    sheetsRepository,          // pauseSheetRepository
    timeFilterService,
    workerLockService,
    sharedConfig,              // [v2.15] Google Sheets '설정' 탭 기반 설정
    telegramService,           // Telegram 알림 서비스
    logger
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.adsPowerIdMappingService = adsPowerIdMappingService;
    this.pauseUseCase = pauseUseCase;
    this.resumeUseCase = resumeUseCase;
    this.sheetsRepository = sheetsRepository;
    this.timeFilterService = timeFilterService;
    this.workerLockService = workerLockService;
    this.sharedConfig = sharedConfig;
    this.telegramService = telegramService;
    this.logger = logger || console;

    // 실행 상태
    this.isRunning = false;
    this.shouldStop = false;

    // [v2.11] 진행 중 작업 추적 (Ctrl+C 시 잠금 해제용)
    this.currentTaskRowIndex = null;

    // 누적 통계
    this.stats = {
      resume: { success: 0, failed: 0, skipped: 0 },
      pause: { success: 0, failed: 0, skipped: 0 },
      cycles: 0
    };
  }

  /**
   * 메인 실행 - 지속 실행 모드
   *
   * @param {Object} options
   * @param {number} options.resumeMinutesBefore - 결제재개: 결제 전 M분
   * @param {number} options.pauseMinutesAfter - 일시중지: 결제 후 N분
   * @param {number} options.maxRetryCount - 최대 재시도 횟수
   * @param {number} options.checkIntervalSeconds - 체크 간격 (초)
   * @param {boolean} options.debugMode - 디버그 모드
   * @param {boolean} options.continuous - 지속 실행 모드 (기본 true)
   * @returns {Promise<Object>} 실행 결과
   */
  async execute(options = {}) {
    // [v2.15] SharedConfig 초기화 (최초 1회)
    if (this.sharedConfig && !this.sharedConfig.isInitialized) {
      await this.sharedConfig.initialize();
    }

    // [v2.15] 설정값 우선순위: options > sharedConfig > WORKER_DEFAULTS
    // [v2.34] 인스턴스에 options 저장 → 매 사이클마다 최신값 조회 가능
    this._executeOptions = options;

    const debugMode = options.debugMode ?? WORKER_DEFAULTS.debugMode;
    const continuous = options.continuous ?? WORKER_DEFAULTS.continuous;

    // 시작 시 초기값 (헤더 출력용)
    const resumeMinutesBefore = this._getLiveConfig('RESUME_MINUTES_BEFORE', WORKER_DEFAULTS.resumeMinutesBefore);
    const pauseMinutesAfter = this._getLiveConfig('PAUSE_MINUTES_AFTER', WORKER_DEFAULTS.pauseMinutesAfter);
    const maxRetryCount = this._getLiveConfig('MAX_RETRY_COUNT', WORKER_DEFAULTS.maxRetryCount);
    const checkIntervalSeconds = this._getLiveConfig('CHECK_INTERVAL_SECONDS', WORKER_DEFAULTS.checkIntervalSeconds);

    // [v2.25] 윈도우 모드: 'focus' (포커싱) 또는 'background' (백그라운드)
    this.windowMode = options.windowMode || 'focus';

    const startTime = Date.now();
    const workerId = this.workerLockService.getWorkerId();

    this.isRunning = true;
    this.shouldStop = false;

    // 통계 초기화
    this.stats = {
      resume: { success: 0, failed: 0, skipped: 0 },
      pause: { success: 0, failed: 0, skipped: 0 },
      cycles: 0
    };

    // [v2.12] 시작 시점에 모니터링 계정 수 조회
    let totalAccounts = 0;
    try {
      const allTasks = await this.sheetsRepository.getIntegratedWorkerTasks();
      totalAccounts = allTasks.length;
    } catch (e) {
      // 무시 - 0으로 표시
    }

    this.printHeader(workerId, resumeMinutesBefore, pauseMinutesAfter, maxRetryCount, checkIntervalSeconds, totalAccounts);

    // [v2.12] Ctrl+C 핸들러 등록 - 간결한 종료 메시지
    const sigintHandler = async () => {
      const totalSuccess = this.stats.resume.success + this.stats.pause.success;
      const totalFailed = this.stats.resume.failed + this.stats.pause.failed;

      console.log(chalk.yellow(`\n⏹️ 종료 요청 (✅${totalSuccess} ❌${totalFailed} 💤${this.stats.cycles}사이클)`));
      this.shouldStop = true;

      // 진행 중인 작업이 있으면 잠금 해제 시도
      if (this.currentTaskRowIndex) {
        try {
          await this.workerLockService.releaseIntegratedWorkerLock(this.currentTaskRowIndex);
          console.log(chalk.gray(`   🔓 진행 중 작업 잠금 해제`));
        } catch (e) {
          console.log(chalk.gray(`   ⚠️ 잠금 5분 후 자동 만료`));
        }
      }
    };
    process.on('SIGINT', sigintHandler);

    try {
      if (continuous) {
        // 지속 실행 모드
        // [v2.34] 매 사이클마다 SharedConfig에서 최신값 조회 (시트 변경 5분 내 반영)
        while (!this.shouldStop) {
          await this.runCycle({ debugMode });

          this.stats.cycles++;

          if (!this.shouldStop) {
            // 다음 사이클까지 대기 (체크 간격도 최신값 사용)
            const liveInterval = this._getLiveConfig('CHECK_INTERVAL_SECONDS', WORKER_DEFAULTS.checkIntervalSeconds);
            await this.delay(liveInterval * 1000);
          }
        }
      } else {
        // 단일 실행 모드
        await this.runCycle({ debugMode });
        this.stats.cycles = 1;
      }

    } catch (error) {
      this.logger.error(`[IntegratedWorker] 실행 오류: ${error.message}`);
    } finally {
      // 핸들러 해제
      process.removeListener('SIGINT', sigintHandler);
      this.isRunning = false;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    this.printFinalSummary(duration, workerId);

    return {
      workerId,
      duration,
      stats: this.stats,
      success: true
    };
  }

  /**
   * 단일 사이클 실행 (결제재개 먼저 → 일시중지 나중)
   */
  async runCycle(options) {
    const { debugMode } = options;

    // [v2.34] 매 사이클마다 설정 동기화 (시트 변경 즉시 반영)
    if (this.sharedConfig) {
      await this.sharedConfig.sync();
    }

    // [v2.34] 동기화 직후 최신값 조회
    const resumeMinutesBefore = this._getLiveConfig('RESUME_MINUTES_BEFORE', WORKER_DEFAULTS.resumeMinutesBefore);
    const pauseMinutesAfter = this._getLiveConfig('PAUSE_MINUTES_AFTER', WORKER_DEFAULTS.pauseMinutesAfter);
    const maxRetryCount = this._getLiveConfig('MAX_RETRY_COUNT', WORKER_DEFAULTS.maxRetryCount);
    const now = new Date();

    const timeStr = this.timeFilterService.formatDateTime(now);

    try {
      // 1. 통합워커 탭에서 모든 작업 조회
      const allTasks = await this.sheetsRepository.getIntegratedWorkerTasks();

      if (allTasks.length === 0) {
        this.log(chalk.gray(`📋 ${timeStr} | 대기 중 (작업 없음)`));
        return;
      }

      // 2. 잠금되지 않은 작업만 필터
      const unlockedTasks = this.workerLockService.filterUnlockedTasks(allTasks);

      // 3. 결제재개 대상 필터링 (일시중지 상태 + 결제 임박)
      const resumeTargets = this.timeFilterService.filterResumeTargets(
        unlockedTasks,
        resumeMinutesBefore,
        maxRetryCount
      );

      // 4. 일시중지 대상 필터링 (결제중 상태 + 결제 완료)
      const pauseTargets = this.timeFilterService.filterPauseTargets(
        unlockedTasks,
        pauseMinutesAfter,
        maxRetryCount
      );

      // 5. [v2.14] 결제 미완료 재시도 대상 필터링
      // [v2.15] SharedConfig 우선
      const paymentPendingMaxHours = this.sharedConfig
        ? this.sharedConfig.getPaymentPendingMaxHours()
        : (WORKER_DEFAULTS.paymentPendingMaxHours || 24);
      const pendingRetryTargets = this.timeFilterService.filterPaymentPendingRetryTargets(
        unlockedTasks,
        paymentPendingMaxHours
      );

      // [v2.12+] 사이클 로그 간소화
      const hasWork = resumeTargets.length > 0 || pauseTargets.length > 0 || pendingRetryTargets.length > 0;
      if (!hasWork) {
        // 작업 없으면 1줄 요약
        this.log(chalk.gray(`💤 대기 중 (${allTasks.length}개 모니터링)`));
      } else {
        // 작업 있으면 구분선 + 요약
        this.log(`${'─'.repeat(40)}`);
        const pendingInfo = pendingRetryTargets.length > 0 ? `, 결제미완료재시도 ${pendingRetryTargets.length}건` : '';
        this.log(chalk.cyan(`📋 작업 발견: 재개 ${resumeTargets.length}건, 일시중지 ${pauseTargets.length}건${pendingInfo}`));
        this.log(`${'─'.repeat(40)}`);
      }

      // 5. 결제재개 먼저 처리 (결제 허용이 더 급함)
      for (const task of resumeTargets) {
        if (this.shouldStop) break;

        // [v2.33] 매번 시트 재조회 - 행 삭제로 인한 rowIndex 불일치 방지
        const freshTask = await this.refreshTaskByEmail(task.email);
        if (!freshTask) {
          this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (시트에서 삭제됨)`));
          this.stats.resume.skipped++;
          continue;
        }
        if (freshTask.status !== '일시중지') {
          if (debugMode) this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (상태 변경: ${task.status} → ${freshTask.status})`));
          this.stats.resume.skipped++;
          continue;
        }

        await this.processTask(freshTask, 'resume', maxRetryCount, debugMode);
      }

      // 6. 일시중지 처리
      for (const task of pauseTargets) {
        if (this.shouldStop) break;

        // [v2.33] 매번 시트 재조회 - 행 삭제로 인한 rowIndex 불일치 방지
        const freshTask = await this.refreshTaskByEmail(task.email);
        if (!freshTask) {
          this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (시트에서 삭제됨)`));
          this.stats.pause.skipped++;
          continue;
        }
        if (freshTask.status !== '결제중') {
          if (debugMode) this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (상태 변경: ${task.status} → ${freshTask.status})`));
          this.stats.pause.skipped++;
          continue;
        }

        await this.processTask(freshTask, 'pause', maxRetryCount, debugMode);
      }

      // 7. [v2.14] 결제 미완료 재시도 대상 처리 (일시중지 작업으로)
      for (const task of pendingRetryTargets) {
        if (this.shouldStop) break;

        // [v2.33] 매번 시트 재조회 - 행 삭제로 인한 rowIndex 불일치 방지
        const freshTask = await this.refreshTaskByEmail(task.email);
        if (!freshTask) {
          this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (시트에서 삭제됨)`));
          this.stats.pause.skipped++;
          continue;
        }
        if (!freshTask.pendingRetryAt) {
          if (debugMode) this.log(chalk.gray(`   ⏭️ ${task.email} 스킵 (결제미완료 재시도 조건 해제)`));
          this.stats.pause.skipped++;
          continue;
        }

        this.log(chalk.yellow(`🔄 ${freshTask.email || freshTask.googleId} 결제미완료 재시도 중...`));
        await this.processTask(freshTask, 'pause', maxRetryCount, debugMode);
      }

      // 8. 사이클 요약 (작업이 있었을 때만)
      if (hasWork) {
        this.printCycleSummary();
      }

    } catch (error) {
      this.logger.error(`[IntegratedWorker] 사이클 오류: ${error.message}`);
    }
  }

  /**
   * 단일 작업 처리 (잠금 → 실행 → 상태변경 → 해제)
   *
   * AdsPower ID 매핑 실패 시에도 UseCase를 호출하여
   * UseCase 내부의 대체 ID 검색 로직을 활용합니다.
   *
   * 특수 상태 처리:
   * - reCAPTCHA/만료/계정잠김: 재시도 없이 영구 상태로 변경
   * - IMAGE CAPTCHA: 1회 즉시 재시도
   */
  async processTask(task, type, maxRetryCount, debugMode) {
    const email = task.email || task.googleId || 'Unknown';
    const rowIndex = task.rowIndex;
    const actionName = type === 'resume' ? '결제재개' : '일시중지';
    const startTime = Date.now();

    // 작업 시작 로그
    this.log(`⏳ ${email} ${actionName} 중...`);

    // 디버그 모드: 상세 정보
    if (debugMode) {
      console.log(chalk.gray(`        ├─ 예정시각: ${task.scheduledTimeFormatted || 'N/A'}`));
      console.log(chalk.gray(`        └─ 현재상태: ${task.status}`));
    }

    // 1. 잠금 획득 시도
    const lockAcquired = await this.workerLockService.acquireIntegratedWorkerLock(rowIndex);

    if (!lockAcquired) {
      this.log(chalk.gray(`   ⏭️ ${email} 스킵 (다른 워커 처리 중)`));
      this.stats[type].skipped++;
      return;
    }

    // [v2.11] 진행 중 작업 추적 시작 (Ctrl+C 시 잠금 해제용)
    this.currentTaskRowIndex = rowIndex;

    // [v2.26] 상태 재검증 - Race Condition 방지
    // 잠금 획득 후, 실제 작업 전에 최신 상태를 다시 확인
    const freshTask = await this.sheetsRepository.getIntegratedWorkerTaskByRow(rowIndex);

    // [v2.33] 이메일 재검증 - 행 삭제로 인한 rowIndex 불일치 방지
    if (freshTask && freshTask.email !== task.email) {
      this.log(chalk.red(`   ⛔ ${email} 스킵 (행 불일치: row ${rowIndex}의 이메일이 ${freshTask.email}로 변경됨)`));
      await this.workerLockService.releaseIntegratedWorkerLock(rowIndex);
      this.currentTaskRowIndex = null;
      this.stats[type].skipped++;
      return;
    }

    if (freshTask && freshTask.status !== task.status) {
      this.log(chalk.yellow(`   ⏭️ ${email} 스킵 (상태 변경됨: ${task.status} → ${freshTask.status})`));
      await this.workerLockService.releaseIntegratedWorkerLock(rowIndex);
      this.currentTaskRowIndex = null;
      this.stats[type].skipped++;
      return;
    }

    let adsPowerId = null;
    let usedProfileId = null;  // 실제 사용된 프로필 ID (대체 ID 포함)

    try {
      // 2. AdsPower ID 매핑 (이메일 → AdsPower ID)
      adsPowerId = await this.getAdsPowerId(email);

      // 디버그 모드에서만 AdsPower ID 표시
      if (debugMode) {
        if (adsPowerId) {
          console.log(chalk.gray(`        └─ AdsPower ID: ${adsPowerId}`));
        } else {
          console.log(chalk.yellow(`        └─ 사전 매핑 실패, 대체 ID 검색 시도`));
        }
      }

      // 3. 작업 실행 (adsPowerId가 null이어도 UseCase 호출)
      // UseCase 내부의 connectBrowser에서 email 기반으로 대체 ID를 찾아 시도함
      const result = await this.executeTask(task, adsPowerId, type, debugMode);

      // 실제 사용된 프로필 ID 추적 (대체 ID일 수 있음)
      usedProfileId = result.actualProfileId || adsPowerId;

      if (result.success) {
        // 성공: 상태 변경 + 결과 기록 + 재시도 리셋 + 다음결제일 업데이트
        const resultText = this.formatResultText(type, true, result);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        // 무한루프 감지를 위해 기존 H열 내용 조회 (업데이트 전)
        const existingResult = await this.sheetsRepository.getIntegratedWorkerResultValue(rowIndex);
        const combinedResult = existingResult ? `${existingResult}\n${resultText}` : resultText;
        const isInfiniteLoop = this.checkInfiniteLoop(combinedResult, type);

        // 무한루프 감지 시 상태를 '수동체크-무한루프'로 변경 (API 중복 호출 방지)
        const newStatus = isInfiniteLoop
          ? '수동체크-무한루프'
          : (type === 'resume' ? '결제중' : '일시중지');

        await this.sheetsRepository.updateIntegratedWorkerOnSuccess(rowIndex, {
          newStatus,
          resultText,
          ip: result.browserIP || result.ip || null,
          proxyId: result.proxyId || null,
          nextBillingDate: result.nextBillingDate || null
        });

        // [v2.14] 결제 미완료 열 초기화 (성공 시)
        if (task.pendingCheckAt || task.pendingRetryAt) {
          await this.sheetsRepository.clearIntegratedWorkerPendingColumns(rowIndex);
        }

        this.stats[type].success++;

        // 이미 완료된 상태인지 확인
        const isAlreadyDone =
          result.status === 'already_paused' ||
          result.status === 'already_active' ||
          result.alreadyActive === true;

        // 간소화된 성공 로그
        if (isAlreadyDone) {
          this.log(chalk.green(`✅ ${email} 완료 (${elapsed}초) - 이미${actionName}`));
        } else {
          this.log(chalk.green(`✅ ${email} 완료 (${elapsed}초)`));
        }

        // 디버그 모드: 추가 정보
        if (debugMode) {
          if (result.nextBillingDate) {
            console.log(chalk.gray(`        └─ 다음결제일: ${result.nextBillingDate}`));
          }
          if (usedProfileId && usedProfileId !== adsPowerId) {
            console.log(chalk.cyan(`        └─ 대체 ID 사용: ${usedProfileId}`));
          }
        }

        // 무한루프 감지 로그 출력 (상태 변경은 이미 위에서 처리됨)
        if (isInfiniteLoop) {
          this.logCritical('무한루프 감지', email, 'E열 수동체크-무한루프로 변경됨');

          // Telegram 알림
          if (this.telegramService) {
            await this.telegramService.notifyError({
              email, action: type, error: '무한루프 감지 - 동일 작업 3회+ 반복',
              severity: 'critical', workerId: this.workerLockService?.getWorkerId?.(),
              notificationType: 'infiniteLoop'
            });
          }
        }

      } else {
        // 실패: 특수 상태 플래그 확인
        await this.handleFailedResult(task, type, result, rowIndex, maxRetryCount, adsPowerId);
      }

    } catch (error) {
      // 예외: 결과 기록 + 재시도 증가
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const resultText = this.formatResultText(type, false, { error: error.message });
      await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, {
        resultText,
        ip: null,
        proxyId: null
      });

      this.stats[type].failed++;
      this.log(chalk.red(`❌ ${email} 실패 (${elapsed}초): ${error.message.substring(0, 50)}`));

    } finally {
      // 브라우저 정리 (실제 사용된 ID로 정리)
      const profileIdToClose = usedProfileId || adsPowerId;
      if (profileIdToClose) {
        try {
          await this.adsPowerAdapter.closeBrowser(profileIdToClose);
        } catch (closeError) {
          // 무시
        }
      }

      // [v2.11] 진행 중 작업 추적 종료
      this.currentTaskRowIndex = null;

      // 잠금 해제는 updateIntegratedWorkerOnSuccess/OnFailure/PermanentFailure에서 이미 처리됨
    }
  }

  /**
   * 실패 결과 처리 - 특수 상태에 따른 분기 처리
   *
   * @param {Object} task - 작업 정보
   * @param {string} type - 'pause' 또는 'resume'
   * @param {Object} result - UseCase 실행 결과
   * @param {number} rowIndex - 행 번호
   * @param {number} maxRetryCount - 최대 재시도 횟수
   * @param {string} adsPowerId - AdsPower 프로필 ID
   */
  async handleFailedResult(task, type, result, rowIndex, maxRetryCount, adsPowerId) {
    const email = task.email || task.googleId || 'Unknown';
    const resultText = this.formatResultText(type, false, result);

    // 실패 시에도 사용한 IP/프록시 추출 (G열, M열 누적용)
    const usedIP = result.browserIP || result.ip || null;
    const usedProxyId = result.proxyId || null;

    // 0. [v2.14] 결제 미완료 상태 확인
    if (result.status === 'payment_pending') {
      await this.handlePaymentPending(task, rowIndex, result, usedIP, usedProxyId);
      return;
    }

    // 1. 영구 실패 상태 확인 (재시도 불가) - 심각 오류로 표시
    const permanentStatus = this.getPermanentFailureStatus(result);

    if (permanentStatus) {
      // 영구 실패: E열 상태 변경, 재시도 증가 없음
      await this.sheetsRepository.updateIntegratedWorkerPermanentFailure(rowIndex, {
        newStatus: permanentStatus,
        resultText,
        ip: usedIP,
        proxyId: usedProxyId
      });

      this.stats[type].failed++;

      // 심각 오류 강조 표시
      const actionMap = {
        '만료됨': '구독 갱신 필요',
        '계정잠김': '수동 로그인 필요',
        'reCAPTCHA차단': '수동 확인 필요',
        '결제수단문제': '결제 수단 업데이트 필요'
      };
      this.logCritical(permanentStatus, email, actionMap[permanentStatus] || '수동 확인 필요');

      // Telegram 알림 (결제수단문제는 별도 유형으로 분리)
      if (this.telegramService) {
        const notificationType = permanentStatus === '결제수단문제' ? 'paymentIssue' : 'critical';
        await this.telegramService.notifyError({
          email, action: type, error: permanentStatus,
          severity: 'critical', workerId: this.workerLockService?.getWorkerId?.(),
          notificationType
        });
      }
      return;
    }

    // 2. IMAGE CAPTCHA: 1회 즉시 재시도
    if (result.shouldRetry && !task.captchaRetryCount) {
      this.log(chalk.yellow(`   🖼️ ${email} CAPTCHA 재시도 중...`));
      task.captchaRetryCount = 1;

      // 브라우저 재시작 후 재시도 (stale connection 방지)
      if (adsPowerId) {
        try {
          await this.adsPowerAdapter.closeBrowser(adsPowerId);
        } catch (e) { /* 무시 */ }
      }

      await this.delay(3000);

      try {
        const retryResult = await this.executeTask(task, adsPowerId, type, false);

        if (retryResult.success) {
          const newStatus = type === 'resume' ? '결제중' : '일시중지';
          const retryResultText = this.formatResultText(type, true, retryResult) + ' (CAPTCHA 재시도)';

          await this.sheetsRepository.updateIntegratedWorkerOnSuccess(rowIndex, {
            newStatus,
            resultText: retryResultText,
            ip: retryResult.browserIP || retryResult.ip || null,
            proxyId: retryResult.proxyId || null,
            nextBillingDate: retryResult.nextBillingDate || null
          });

          this.stats[type].success++;
          this.log(chalk.green(`✅ ${email} CAPTCHA 재시도 성공`));
          return;
        } else {
          // CAPTCHA 재시도도 실패
          const retryIP = retryResult.browserIP || retryResult.ip || usedIP;
          const retryProxyId = retryResult.proxyId || usedProxyId;
          const retryResultText = this.formatResultText(type, false, retryResult) + ' (CAPTCHA 재시도)';

          await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, {
            resultText: retryResultText,
            ip: retryIP,
            proxyId: retryProxyId
          });

          this.stats[type].failed++;
          this.log(chalk.red(`❌ ${email} CAPTCHA 재시도 실패`));
          return;
        }
      } catch (retryError) {
        await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, {
          resultText: resultText + ` (CAPTCHA 재시도 예외: ${retryError.message})`,
          ip: usedIP,
          proxyId: usedProxyId
        });
        this.stats[type].failed++;
        this.log(chalk.red(`❌ ${email} CAPTCHA 재시도 예외: ${retryError.message.substring(0, 30)}`));
        return;
      }
    }

    // 3. 일반 실패: 재시도 증가
    const newRetryCount = await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, {
      resultText,
      ip: usedIP,
      proxyId: usedProxyId
    });

    this.stats[type].failed++;
    const errorMsg = (result.error || '알 수 없는 오류').substring(0, 40);
    this.log(chalk.red(`❌ ${email} 실패: ${errorMsg} (${newRetryCount}/${maxRetryCount})`));

    // 최대 재시도 초과 시 Telegram 알림
    if (newRetryCount >= maxRetryCount && this.telegramService) {
      await this.telegramService.notifyError({
        email, action: type, error: `최대 재시도 초과 (${maxRetryCount}회): ${errorMsg}`,
        severity: 'high', workerId: this.workerLockService?.getWorkerId?.(),
        notificationType: 'maxRetry'
      });
    }
  }

  /**
   * 영구 실패 상태 판정
   * 재시도해도 해결되지 않는 상태를 식별
   *
   * @param {Object} result - UseCase 실행 결과
   * @returns {string|null} 영구 상태명 또는 null
   */
  getPermanentFailureStatus(result) {
    // 구독 만료
    if (result.status === 'subscription_expired' ||
      result.error?.includes('만료') ||
      result.error?.includes('expired')) {
      return '만료됨';
    }

    // 계정 잠김
    if (result.accountLocked ||
      result.status === 'account_locked' ||
      result.error?.includes('계정잠김') ||
      result.error?.includes('locked')) {
      return '계정잠김';
    }

    // reCAPTCHA (재시도 불가)
    // [v2.15 버그 수정] skipRetry 조건 제거 - 타임아웃/정체가 reCAPTCHA로 잘못 판정되던 문제 수정
    if (result.recaptchaDetected ||
      result.status === 'recaptcha_detected' ||
      result.error?.includes('reCAPTCHA') ||
      result.error?.includes('recaptcha')) {
      return 'reCAPTCHA차단';
    }

    // 결제 수단 문제 (Action needed - 복구 시도 실패)
    if (result.error?.includes('PAYMENT_METHOD_ISSUE') ||
      result.error?.includes('Action needed') ||
      result.error?.includes('결제 수단 문제')) {
      return '결제수단문제';
    }

    // 스킵 플래그 (다음으로 넘어가야 함)
    if (result.skipToNext) {
      return null;  // 영구 상태는 아니지만 재시도 안함
    }

    return null;  // 일반 실패 (재시도 가능)
  }

  /**
   * [v2.14] 결제 미완료 상태 처리
   * - 최초 감지 시: N열에 현재 시각 기록
   * - 24시간 초과 시: 수동체크-결제지연 상태로 변경
   * - 그 외: O열에 다음 재시도 시각 기록
   *
   * @param {Object} task - 작업 정보
   * @param {number} rowIndex - 행 번호
   * @param {Object} result - UseCase 실행 결과
   * @param {string} usedIP - 사용한 IP
   * @param {string} usedProxyId - 사용한 프록시 ID
   */
  async handlePaymentPending(task, rowIndex, result, usedIP, usedProxyId) {
    const email = task.email || task.googleId || 'Unknown';
    const now = new Date();
    // [v2.15] SharedConfig 우선
    const retryMinutes = this.sharedConfig
      ? this.sharedConfig.getPaymentPendingRetryMinutes()
      : (WORKER_DEFAULTS.paymentPendingRetryMinutes || 30);
    const maxHours = this.sharedConfig
      ? this.sharedConfig.getPaymentPendingMaxHours()
      : (WORKER_DEFAULTS.paymentPendingMaxHours || 24);
    const reason = result.paymentPendingReason || '결제일이 오늘';

    // 최초 감지 시각 확인 (N열) - 한국 시간 문자열
    let firstDetectedAt = task.pendingCheckAt;
    const isFirstDetection = !firstDetectedAt;

    if (isFirstDetection) {
      // 최초 감지: N열에 현재 한국 시간 기록
      firstDetectedAt = this.timeFilterService.formatKoreanTime(now);
      await this.sheetsRepository.setIntegratedWorkerPendingCheckAt(rowIndex, firstDetectedAt);
      this.log(chalk.yellow(`   ⏳ ${email} 결제 미완료 감지: ${reason} (최초)`));
    }

    // 24시간 제한 체크 (한국 시간 파싱)
    let firstDetectedDate = this.timeFilterService.parseKoreanTime(firstDetectedAt);

    // [v2.14] N열 파싱 실패 시 현재 시각으로 재설정 (손상된 데이터 복구)
    if (!firstDetectedDate && firstDetectedAt) {
      this.log(chalk.red(`   ⚠️ ${email} N열 파싱 실패: "${firstDetectedAt}" - 현재 시각으로 재설정`));
      firstDetectedAt = this.timeFilterService.formatKoreanTime(now);
      await this.sheetsRepository.setIntegratedWorkerPendingCheckAt(rowIndex, firstDetectedAt);
      firstDetectedDate = now;  // 파싱된 Date 객체로 설정
    }

    const hoursElapsed = firstDetectedDate ? (now - firstDetectedDate) / (1000 * 60 * 60) : 0;

    if (hoursElapsed >= maxHours) {
      // 24시간 초과 → 수동체크 상태로
      const resultText = `⏰ 결제미완료 ${maxHours}시간 대기 초과 | ${reason} | ${this.timeFilterService.formatShortDateTime(now)}`;
      await this.sheetsRepository.updateIntegratedWorkerPermanentFailure(rowIndex, {
        newStatus: '수동체크-결제지연',
        resultText,
        ip: usedIP,
        proxyId: usedProxyId
      });
      await this.sheetsRepository.clearIntegratedWorkerPendingColumns(rowIndex);

      this.stats.pause.failed++;
      this.logCritical('결제 미완료 24시간 초과', email, '수동 확인 필요');

      // Telegram 알림
      if (this.telegramService) {
        await this.telegramService.notifyPaymentDelay({
          email, hoursElapsed: maxHours, workerId: this.workerLockService?.getWorkerId?.(),
          notificationType: 'paymentDelay'
        });
      }
      return;
    }

    // 다음 재시도 시각 계산 (O열) - 한국 시간
    const retryAt = new Date(now.getTime() + retryMinutes * 60 * 1000);
    const retryAtKorean = this.timeFilterService.formatKoreanTime(retryAt);
    const setRetryResult = await this.sheetsRepository.setIntegratedWorkerPendingRetryAt(rowIndex, retryAtKorean);

    // [v2.14] O열 설정 실패 시 경고 (다음 사이클에서 pauseTargets로 재처리됨)
    if (!setRetryResult) {
      this.log(chalk.red(`   ⚠️ ${email} O열 설정 실패 - 다음 사이클에서 재시도`));
    }

    // 결과 기록 (H열 누적)
    const retryInfo = `⏳ 결제미완료 | ${reason} | 재시도 ${retryAtKorean.split(' ')[1]} | 경과 ${hoursElapsed.toFixed(1)}h`;
    await this.sheetsRepository.appendIntegratedWorkerResult(rowIndex, retryInfo);

    // 잠금 해제 (다른 작업 가능하도록)
    await this.workerLockService.releaseIntegratedWorkerLock(rowIndex);

    this.stats.pause.skipped++;  // 재시도 대기 = skipped 카운트
    this.log(chalk.yellow(`   ⏳ ${email} 결제 미완료 - ${retryMinutes}분 후 재시도 (${hoursElapsed.toFixed(1)}h/${maxHours}h)`));
  }

  /**
   * 실제 작업 실행 (일시중지 또는 결제재개)
   *
   * [v2.20] retryCount를 UseCase에 전달하여 프록시 우회 지원
   * [v2.25] windowMode를 UseCase에 전달하여 포커싱/백그라운드 모드 지원
   */
  async executeTask(task, adsPowerId, type, debugMode) {
    // TOTP 코드 값 (D열)
    const totpValue = task.totpCode || task.code || '';

    // [v2.20] 재시도 횟수 추출 (L열)
    const retryCount = parseInt(task.retryCount) || parseInt(task['재시도횟수']) || 0;

    const options = {
      profileData: {
        email: task.email,
        googleId: task.googleId,
        password: task.password,
        recoveryEmail: task.recoveryEmail,
        // 단일 UseCase들이 code 또는 totpSecret 필드명을 사용하므로 둘 다 설정
        code: totpValue,
        totpSecret: totpValue,
        totpCode: totpValue  // 기존 호환성 유지
      },
      debugMode,
      retryCount,  // [v2.20] 프록시 우회용 재시도 횟수 전달
      windowMode: this.windowMode  // [v2.25] 포커싱/백그라운드 모드 전달
    };

    if (type === 'pause') {
      return await this.pauseUseCase.execute(adsPowerId, options);
    } else {
      return await this.resumeUseCase.execute(adsPowerId, options);
    }
  }

  /**
   * 이메일로 AdsPower ID 매핑
   *
   * AdsPowerIdMappingService의 findAdsPowerIds를 사용하여
   * '애즈파워현황' 시트에서 이메일 기반으로 AdsPower ID를 찾습니다.
   */
  async getAdsPowerId(email) {
    if (!email) return null;

    try {
      if (this.adsPowerIdMappingService) {
        // findAdsPowerIds: 비동기, 배열 반환 (캐시 미스 시 시트에서 직접 검색)
        const mappedIds = await this.adsPowerIdMappingService.findAdsPowerIds(email);

        if (mappedIds && mappedIds.length > 0) {
          // 첫 번째 유효한 ID 반환
          const validId = mappedIds.find(id =>
            this.adsPowerIdMappingService.isValidAdsPowerId(id)
          );

          if (validId) {
            return validId;
          }

          // 유효성 검사 통과한 ID가 없으면 첫 번째 ID 반환
          return mappedIds[0];
        }
      }

      // MappingService가 없거나 ID를 찾지 못한 경우 AdsPower API에서 직접 조회
      this.log(chalk.yellow(`     ⚠️ 매핑 서비스에서 ID 없음, AdsPower API 직접 조회`));

      const profiles = await this.adsPowerAdapter.getAllProfiles();
      const normalizedEmail = email.toLowerCase();

      const profile = profiles.profiles?.find(p =>
        p.name?.toLowerCase() === normalizedEmail ||
        p.remark?.toLowerCase()?.includes(normalizedEmail)
      );

      return profile?.user_id || null;
    } catch (error) {
      this.logger.error(`[IntegratedWorker] AdsPower ID 매핑 오류: ${error.message}`);
      return null;
    }
  }

  /**
   * 결과 텍스트 포맷팅
   * 형식: {이모지} {작업유형} ({언어팩}) {결과} | {시간} | {추가정보}
   *
   * 결과 구분:
   * - 신규성공: 실제로 상태가 변경된 경우
   * - 이미완료: 이미 해당 상태였던 경우 (already_paused, already_active)
   */
  formatResultText(type, success, result = {}) {
    const workerId = this.workerLockService.getWorkerId();
    const timestamp = this.timeFilterService.formatShortDateTime(new Date());
    const typeName = type === 'pause' ? '일시중지' : '재개';

    // 언어팩 정보 추출 (다양한 필드명 대응)
    const language = result.language || result.detectedLanguage || result.lang || 'Unknown';

    if (success) {
      // 이미 완료된 상태인지 확인
      const isAlreadyDone =
        result.status === 'already_paused' ||
        result.status === 'already_active' ||
        result.alreadyActive === true;

      const resultLabel = isAlreadyDone ? '이미완료' : '신규성공';
      const emoji = isAlreadyDone ? '✅' : '🆕';

      return `${emoji} ${typeName} (${language}) ${resultLabel} | ${timestamp} | ${workerId}`;
    } else {
      const errorMsg = (result.error || '').substring(0, 40);
      return `❌ ${typeName} (${language}) 실패 | ${timestamp} | ${workerId} | ${errorMsg}`;
    }
  }

  /**
   * 헤더 출력 - 워커 시작
   */
  printHeader(workerId, resumeMinutesBefore, pauseMinutesAfter, maxRetryCount, checkIntervalSeconds, totalAccounts = 0) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${this.getTimeStr()}:${String(now.getSeconds()).padStart(2, '0')}`;

    console.log(`${'═'.repeat(60)}`);
    console.log(chalk.cyan.bold(`🚀 통합워커 시작 | ${dateStr}`));
    console.log(`   모니터링: ${totalAccounts}개 | 재개: ${resumeMinutesBefore}분 전 | 일시중지: ${pauseMinutesAfter}분 후`);
    console.log(`${'═'.repeat(60)}`);
  }

  /**
   * 사이클 요약 출력
   */
  printCycleSummary() {
    const totalSuccess = this.stats.resume.success + this.stats.pause.success;
    const totalFailed = this.stats.resume.failed + this.stats.pause.failed;

    this.log(`${'─'.repeat(40)}`);
    this.log(chalk.cyan(`📊 사이클 완료: ✅${totalSuccess} ❌${totalFailed}`));
    this.log(`${'─'.repeat(40)}`);
  }

  /**
   * 최종 요약 출력 - 워커 종료
   */
  printFinalSummary(duration, workerId) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${this.getTimeStr()}:${String(now.getSeconds()).padStart(2, '0')}`;

    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const durationStr = hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분 ${duration % 60}초`;

    const totalSuccess = this.stats.resume.success + this.stats.pause.success;
    const totalFailed = this.stats.resume.failed + this.stats.pause.failed;

    console.log(`${'═'.repeat(60)}`);
    console.log(chalk.cyan.bold(`🏁 통합워커 종료 | ${dateStr}`));
    console.log(`   실행 시간: ${durationStr} | 처리: ✅${totalSuccess} ❌${totalFailed} 💤${this.stats.cycles}사이클`);
    console.log(`${'═'.repeat(60)}`);
  }

  /**
   * 시간 문자열 반환 (HH:MM 형식)
   */
  getTimeStr() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * 로그 출력 헬퍼 (시간 포맷 포함)
   */
  log(message) {
    console.log(`[${this.getTimeStr()}] ${message}`);
  }

  /**
   * 심각 오류 강조 출력
   */
  logCritical(title, account, action) {
    const line = '⛔'.repeat(20);
    console.log(`[${this.getTimeStr()}] ${line}`);
    console.log(`[${this.getTimeStr()}] ⛔ 심각: ${title}`);
    console.log(`[${this.getTimeStr()}] ⛔ 계정: ${account}`);
    console.log(`[${this.getTimeStr()}] ⛔ 조치: ${action}`);
    console.log(`[${this.getTimeStr()}] ${line}`);
  }

  /**
   * [v2.34] 설정값 실시간 조회 헬퍼
   * 우선순위: execute() options > SharedConfig 캐시 > WORKER_DEFAULTS
   *
   * SharedConfig는 5분마다 Google Sheets와 자동 동기화되므로,
   * 시트에서 값을 변경하면 워커 재시작 없이 반영됩니다.
   *
   * @param {string} key - CONFIG_KEYS 상수
   * @param {any} fallback - 기본값
   * @returns {any} 설정값
   */
  _getLiveConfig(key, fallback) {
    // 1. execute() 호출 시 명시적으로 전달된 옵션 (최우선)
    if (this._executeOptions && this._executeOptions[key] !== undefined) {
      return this._executeOptions[key];
    }
    // 2. SharedConfig 캐시 (5분마다 시트와 동기화)
    if (this.sharedConfig) {
      return this.sharedConfig.get(key) ?? fallback;
    }
    // 3. 하드코딩 기본값
    return fallback;
  }

  /**
   * 대기 유틸
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * [v2.33] 이메일로 시트에서 최신 행 정보를 재조회
   *
   * 사이클 시작 시 읽은 rowIndex가 행 삭제로 어긋날 수 있으므로,
   * 작업 처리 직전에 이메일 기준으로 최신 데이터를 다시 가져옵니다.
   *
   * @param {string} email - 조회할 이메일 주소
   * @returns {Promise<Object|null>} 최신 task 객체 또는 null
   */
  async refreshTaskByEmail(email) {
    try {
      const allTasks = await this.sheetsRepository.getIntegratedWorkerTasks();
      return allTasks.find(t => t.email === email) || null;
    } catch (error) {
      this.logger.error(`[IntegratedWorker] 시트 재조회 실패: ${error.message}`);
      return null;
    }
  }

  /**
   * 무한루프 감지 - H열 결과에서 동일 작업 성공이 3회 이상인지 확인
   *
   * 감지 기준:
   * - "일시중지" + ("신규성공" 또는 "이미완료")가 3회 이상 → 무한루프
   * - "재개" + ("신규성공" 또는 "이미완료")가 3회 이상 → 무한루프
   *
   * @param {string} existingResult - 기존 H열 내용
   * @param {string} type - 'pause' 또는 'resume'
   * @returns {boolean} 무한루프 감지 시 true
   */
  checkInfiniteLoop(existingResult, type) {
    if (!existingResult) return false;

    // 성공 패턴 (신규성공 또는 이미완료 모두 포함)
    const successPattern = type === 'pause'
      ? /일시중지[^|]*(?:신규성공|이미완료)/g
      : /재개[^|]*(?:신규성공|이미완료)/g;

    const matches = existingResult.match(successPattern);
    const count = matches ? matches.length : 0;

    if (count >= 3) {
      this.log(chalk.yellow(`     ⚠️ 동일 작업 성공 ${count}회 감지 (임계값: 3회)`));
      return true;
    }

    return false;
  }

  /**
   * 워커 중지 요청
   */
  stop() {
    this.shouldStop = true;
  }

  /**
   * 실행 상태 확인
   */
  isActive() {
    return this.isRunning;
  }
}

module.exports = ScheduledSubscriptionWorkerUseCase;
