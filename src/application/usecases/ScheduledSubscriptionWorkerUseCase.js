/**
 * ScheduledSubscriptionWorkerUseCase v2.0 - 통합워커 상태 기반 결제 주기 관리
 *
 * 워크플로우:
 * [일시중지 상태] → 결제 시간 임박(now + M분) → 결제재개 → [결제중 상태]
 * [결제중 상태] → 결제 완료 후(now - N분) → 일시중지 → [일시중지 상태]
 *
 * 특징:
 * - '통합워커' 단일 탭 사용
 * - E열 상태 기반 작업 선택 (일시중지/결제중)
 * - L열 재시도 횟수 공유 (분산 워커 간)
 * - J열 잠금으로 충돌 방지
 * - 지속 실행 모드 (Ctrl+C로 안전 종료)
 */

const chalk = require('chalk');

class ScheduledSubscriptionWorkerUseCase {
  constructor({
    adsPowerAdapter,
    adsPowerIdMappingService,  // 이메일 → AdsPower ID 매핑
    pauseUseCase,              // enhancedPauseSubscriptionUseCase
    resumeUseCase,             // enhancedResumeSubscriptionUseCase
    sheetsRepository,          // pauseSheetRepository
    timeFilterService,
    workerLockService,
    logger
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.adsPowerIdMappingService = adsPowerIdMappingService;
    this.pauseUseCase = pauseUseCase;
    this.resumeUseCase = resumeUseCase;
    this.sheetsRepository = sheetsRepository;
    this.timeFilterService = timeFilterService;
    this.workerLockService = workerLockService;
    this.logger = logger || console;

    // 실행 상태
    this.isRunning = false;
    this.shouldStop = false;

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
    const {
      resumeMinutesBefore = 10,
      pauseMinutesAfter = 30,
      maxRetryCount = 3,
      checkIntervalSeconds = 60,
      debugMode = false,
      continuous = true
    } = options;

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

    this.printHeader(workerId, resumeMinutesBefore, pauseMinutesAfter, maxRetryCount, checkIntervalSeconds);

    // Ctrl+C 핸들러 등록
    const sigintHandler = () => {
      this.log(chalk.yellow('\n\n⚠️ 종료 요청 감지... 현재 작업 완료 후 안전 종료합니다.'));
      this.shouldStop = true;
    };
    process.on('SIGINT', sigintHandler);

    try {
      if (continuous) {
        // 지속 실행 모드
        while (!this.shouldStop) {
          await this.runCycle({
            resumeMinutesBefore,
            pauseMinutesAfter,
            maxRetryCount,
            debugMode
          });

          this.stats.cycles++;

          if (!this.shouldStop) {
            this.log(chalk.gray(`\n⏳ 다음 체크까지 ${checkIntervalSeconds}초 대기...`));
            await this.delay(checkIntervalSeconds * 1000);
          }
        }
      } else {
        // 단일 실행 모드
        await this.runCycle({
          resumeMinutesBefore,
          pauseMinutesAfter,
          maxRetryCount,
          debugMode
        });
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
    const { resumeMinutesBefore, pauseMinutesAfter, maxRetryCount, debugMode } = options;
    const now = new Date();

    this.log(chalk.cyan(`\n${'─'.repeat(50)}`));
    this.log(chalk.cyan(`📋 사이클 시작: ${this.timeFilterService.formatDateTime(now)}`));
    this.log(chalk.cyan(`${'─'.repeat(50)}`));

    try {
      // 1. 통합워커 탭에서 모든 작업 조회
      const allTasks = await this.sheetsRepository.getIntegratedWorkerTasks();
      this.log(`   전체 작업: ${allTasks.length}개`);

      if (allTasks.length === 0) {
        this.log(chalk.yellow(`   ⚠️ 통합워커 탭에 작업 없음`));
        return;
      }

      // 2. 잠금되지 않은 작업만 필터
      const unlockedTasks = this.workerLockService.filterUnlockedTasks(allTasks);
      this.log(`   잠금 안된 작업: ${unlockedTasks.length}개`);

      // 3. 결제재개 대상 필터링 (일시중지 상태 + 결제 임박)
      const resumeTargets = this.timeFilterService.filterResumeTargets(
        unlockedTasks,
        resumeMinutesBefore,
        maxRetryCount
      );
      this.log(`   결제재개 대상: ${resumeTargets.length}개 (상태=일시중지, 시간≤현재+${resumeMinutesBefore}분)`);

      // 4. 일시중지 대상 필터링 (결제중 상태 + 결제 완료)
      const pauseTargets = this.timeFilterService.filterPauseTargets(
        unlockedTasks,
        pauseMinutesAfter,
        maxRetryCount
      );
      this.log(`   일시중지 대상: ${pauseTargets.length}개 (상태=결제중, 시간≤현재-${pauseMinutesAfter}분)`);

      // 5. 결제재개 먼저 처리 (결제 허용이 더 급함)
      if (resumeTargets.length > 0) {
        this.log(chalk.green(`\n🔓 [결제재개 처리 시작] - ${resumeTargets.length}개`));
        for (const task of resumeTargets) {
          if (this.shouldStop) break;
          await this.processTask(task, 'resume', maxRetryCount, debugMode);
        }
      }

      // 6. 일시중지 처리
      if (pauseTargets.length > 0 && !this.shouldStop) {
        this.log(chalk.yellow(`\n🔒 [일시중지 처리 시작] - ${pauseTargets.length}개`));
        for (const task of pauseTargets) {
          if (this.shouldStop) break;
          await this.processTask(task, 'pause', maxRetryCount, debugMode);
        }
      }

      // 7. 사이클 요약
      this.printCycleSummary();

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

    this.log(`\n   ▶ ${email}`);
    this.log(`     예정시각: ${task.scheduledTimeFormatted || 'N/A'}`);
    this.log(`     현재상태: ${task.status}`);

    // 1. 잠금 획득 시도
    const lockAcquired = await this.workerLockService.acquireIntegratedWorkerLock(rowIndex);

    if (!lockAcquired) {
      this.log(chalk.gray(`     ⏭️ 다른 워커가 처리 중 - 스킵`));
      this.stats[type].skipped++;
      return;
    }

    let adsPowerId = null;
    let usedProfileId = null;  // 실제 사용된 프로필 ID (대체 ID 포함)

    try {
      // 2. AdsPower ID 매핑 (이메일 → AdsPower ID)
      adsPowerId = await this.getAdsPowerId(email);

      if (adsPowerId) {
        this.log(`     AdsPower ID: ${adsPowerId}`);
      } else {
        // ID를 찾지 못해도 UseCase 내부의 대체 ID 검색 로직 활용
        this.log(chalk.yellow(`     ⚠️ 사전 매핑 실패 - UseCase 내부 대체 ID 검색 시도`));
      }

      // 3. 작업 실행 (adsPowerId가 null이어도 UseCase 호출)
      // UseCase 내부의 connectBrowser에서 email 기반으로 대체 ID를 찾아 시도함
      const result = await this.executeTask(task, adsPowerId, type, debugMode);

      // 실제 사용된 프로필 ID 추적 (대체 ID일 수 있음)
      usedProfileId = result.actualProfileId || adsPowerId;

      if (result.success) {
        // 성공: 상태 변경 + 결과 기록 + 재시도 리셋 + 다음결제일 업데이트
        const newStatus = type === 'resume' ? '결제중' : '일시중지';
        const resultText = this.formatResultText(type, true, result);

        await this.sheetsRepository.updateIntegratedWorkerOnSuccess(rowIndex, {
          newStatus,
          resultText,
          ip: result.browserIP || result.ip || null,  // UseCase별 필드명 대응
          nextBillingDate: result.nextBillingDate || null  // F열 업데이트
        });

        this.stats[type].success++;

        // 이미 완료된 상태인지 확인
        const isAlreadyDone =
          result.status === 'already_paused' ||
          result.status === 'already_active' ||
          result.alreadyActive === true;

        const actionName = type === 'resume' ? '결제재개' : '일시중지';
        if (isAlreadyDone) {
          this.log(chalk.yellow(`     ✅ ${actionName} 이미완료 → 상태: ${newStatus}`));
        } else {
          this.log(chalk.green(`     🆕 ${actionName} 신규성공 → 상태: ${newStatus}`));
        }

        // 다음결제일 정보 출력
        if (result.nextBillingDate) {
          this.log(chalk.gray(`     📅 다음결제일: ${result.nextBillingDate}`));
        }

        // 대체 ID로 성공한 경우 알림
        if (usedProfileId && usedProfileId !== adsPowerId) {
          this.log(chalk.cyan(`     ℹ️ 대체 ID 사용: ${usedProfileId}`));
        }

      } else {
        // 실패: 특수 상태 플래그 확인
        await this.handleFailedResult(task, type, result, rowIndex, maxRetryCount, adsPowerId);
      }

    } catch (error) {
      // 예외: 결과 기록 + 재시도 증가
      const resultText = this.formatResultText(type, false, { error: error.message });
      await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, { resultText });

      this.stats[type].failed++;
      this.log(chalk.red(`     ❌ 오류: ${error.message}`));

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
    const resultText = this.formatResultText(type, false, result);

    // 1. 영구 실패 상태 확인 (재시도 불가)
    const permanentStatus = this.getPermanentFailureStatus(result);

    if (permanentStatus) {
      // 영구 실패: E열 상태 변경, 재시도 증가 없음
      await this.sheetsRepository.updateIntegratedWorkerPermanentFailure(rowIndex, {
        newStatus: permanentStatus,
        resultText
      });

      this.stats[type].failed++;
      this.log(chalk.red(`     🚫 영구 실패: ${permanentStatus}`));
      this.log(chalk.gray(`     ℹ️ 재시도 대상에서 제외됨`));
      return;
    }

    // 2. IMAGE CAPTCHA: 1회 즉시 재시도
    if (result.shouldRetry && !task.captchaRetryCount) {
      this.log(chalk.yellow(`     🖼️ IMAGE CAPTCHA 감지 - 즉시 재시도 중...`));
      task.captchaRetryCount = 1;

      // 브라우저 재시작 후 재시도 (stale connection 방지)
      if (adsPowerId) {
        try {
          await this.adsPowerAdapter.closeBrowser(adsPowerId);
        } catch (e) { /* 무시 */ }
      }

      await this.delay(3000);  // 3초 대기

      try {
        const retryResult = await this.executeTask(task, adsPowerId, type, false);

        if (retryResult.success) {
          const newStatus = type === 'resume' ? '결제중' : '일시중지';
          const retryResultText = this.formatResultText(type, true, retryResult) + ' (CAPTCHA 재시도)';

          await this.sheetsRepository.updateIntegratedWorkerOnSuccess(rowIndex, {
            newStatus,
            resultText: retryResultText,
            ip: retryResult.browserIP || retryResult.ip || null,  // UseCase별 필드명 대응
            nextBillingDate: retryResult.nextBillingDate || null
          });

          this.stats[type].success++;
          this.log(chalk.green(`     ✅ CAPTCHA 재시도 성공!`));
          return;
        }
      } catch (retryError) {
        this.log(chalk.red(`     ❌ CAPTCHA 재시도 실패: ${retryError.message}`));
      }
    }

    // 3. 일반 실패: 재시도 증가
    const newRetryCount = await this.sheetsRepository.updateIntegratedWorkerOnFailure(rowIndex, { resultText });

    this.stats[type].failed++;
    this.log(chalk.red(`     ❌ 실패: ${result.error || '알 수 없는 오류'} (재시도: ${newRetryCount}/${maxRetryCount})`));
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
    if (result.recaptchaDetected ||
        result.skipRetry ||
        result.status === 'recaptcha_detected' ||
        result.error?.includes('reCAPTCHA') ||
        result.error?.includes('recaptcha')) {
      return 'reCAPTCHA차단';
    }

    // 스킵 플래그 (다음으로 넘어가야 함)
    if (result.skipToNext) {
      return null;  // 영구 상태는 아니지만 재시도 안함
    }

    return null;  // 일반 실패 (재시도 가능)
  }

  /**
   * 실제 작업 실행 (일시중지 또는 결제재개)
   */
  async executeTask(task, adsPowerId, type, debugMode) {
    const options = {
      profileData: {
        email: task.email,
        googleId: task.googleId,
        password: task.password,
        recoveryEmail: task.recoveryEmail,
        totpCode: task.totpCode || task.code
      },
      debugMode
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
      return `❌ ${typeName} (${language}) 실패 | ${timestamp} | ${errorMsg}`;
    }
  }

  /**
   * 헤더 출력
   */
  printHeader(workerId, resumeMinutesBefore, pauseMinutesAfter, maxRetryCount, checkIntervalSeconds) {
    this.log(`\n${'═'.repeat(60)}`);
    this.log(chalk.cyan.bold(`📅 시간체크 통합 구독관리 워커 v2.0`));
    this.log(`${'═'.repeat(60)}`);
    this.log(`   워커 ID: ${workerId}`);
    this.log(`   결제재개: 결제 전 ${resumeMinutesBefore}분에 "일시중지" → "결제중"`);
    this.log(`   일시중지: 결제 후 ${pauseMinutesAfter}분에 "결제중" → "일시중지"`);
    this.log(`   최대 재시도: ${maxRetryCount}회`);
    this.log(`   체크 간격: ${checkIntervalSeconds}초`);
    this.log(`   참조 탭: 통합워커`);
    this.log(`${'═'.repeat(60)}`);
    this.log(chalk.gray(`   [Ctrl+C로 안전 종료]`));
  }

  /**
   * 사이클 요약 출력
   */
  printCycleSummary() {
    const total = this.stats.resume.success + this.stats.resume.failed +
                  this.stats.pause.success + this.stats.pause.failed;

    if (total > 0) {
      this.log(chalk.cyan(`\n   📊 이번 사이클:`));
      this.log(`      결제재개: ✅${this.stats.resume.success} ❌${this.stats.resume.failed} ⏭️${this.stats.resume.skipped}`);
      this.log(`      일시중지: ✅${this.stats.pause.success} ❌${this.stats.pause.failed} ⏭️${this.stats.pause.skipped}`);
    }
  }

  /**
   * 최종 요약 출력
   */
  printFinalSummary(duration, workerId) {
    this.log(`\n${'═'.repeat(60)}`);
    this.log(chalk.cyan.bold(`📊 통합 워커 실행 완료`));
    this.log(`${'═'.repeat(60)}`);
    this.log(`   워커 ID: ${workerId}`);
    this.log(`   총 소요 시간: ${Math.floor(duration / 60)}분 ${duration % 60}초`);
    this.log(`   실행 사이클: ${this.stats.cycles}회`);
    this.log(`\n   📋 결제재개 결과:`);
    this.log(`      ✅ 성공: ${this.stats.resume.success}개`);
    this.log(`      ❌ 실패: ${this.stats.resume.failed}개`);
    this.log(`      ⏭️ 스킵: ${this.stats.resume.skipped}개`);
    this.log(`\n   📋 일시중지 결과:`);
    this.log(`      ✅ 성공: ${this.stats.pause.success}개`);
    this.log(`      ❌ 실패: ${this.stats.pause.failed}개`);
    this.log(`      ⏭️ 스킵: ${this.stats.pause.skipped}개`);
    this.log(`${'═'.repeat(60)}\n`);
  }

  /**
   * 로그 출력 헬퍼
   */
  log(message) {
    console.log(`[IntegratedWorker] ${message}`);
  }

  /**
   * 대기 유틸
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
