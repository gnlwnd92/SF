/**
 * 강화된 배치 처리 UseCase
 * 취소, 일시정지, 상태 추적이 가능한 고급 배치 처리 시스템
 */

const chalk = require('chalk');
const pLimit = require('p-limit');
const BatchJobManager = require('../../services/BatchJobManager');
const EventEmitter = require('events');

class EnhancedBatchProcessingUseCase extends EventEmitter {
  constructor({
    adsPowerAdapter,
    pauseUseCase,
    resumeUseCase,
    sheetsRepository,
    logger
  }) {
    super();
    this.adsPowerAdapter = adsPowerAdapter;
    this.pauseUseCase = pauseUseCase;
    this.resumeUseCase = resumeUseCase;
    this.sheetsRepository = sheetsRepository;
    this.logger = logger || console;

    // 배치 작업 관리자
    this.jobManager = BatchJobManager.getInstance();

    // 에러 재시도 전략
    this.retryStrategies = {
      'NETWORK_ERROR': { maxRetries: 3, delay: 5000, backoff: true },
      'TIMEOUT': { maxRetries: 2, delay: 10000, backoff: false },
      'RATE_LIMIT': { maxRetries: 5, delay: 30000, backoff: true },
      'RECAPTCHA': { maxRetries: 0, delay: 0, backoff: false },
      'ACCOUNT_LOCKED': { maxRetries: 0, delay: 0, backoff: false },
      'DEFAULT': { maxRetries: 1, delay: 3000, backoff: false }
    };

    // 리소스 모니터링
    this.resourceMonitor = {
      maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
      maxConcurrency: 5,
      adaptiveConcurrency: true,
      currentConcurrency: 1
    };
  }

  /**
   * 배치 처리 실행 (일시중지/재개 모두 지원)
   */
  async execute(tasks, options = {}) {
    const {
      mode = 'pause', // 'pause' or 'resume'
      concurrency = 1,
      batchSize = 10,
      retryEnabled = true,
      delayBetweenBatches = 5000,
      delayBetweenTasks = 3000,
      progressCallback = null,
      autoRecovery = true,
      saveProgress = true,
      jobId = `batch-${mode}-${Date.now()}`,
      priority = 'normal' // 'low', 'normal', 'high'
    } = options;

    try {
      // 작업 시작
      const job = this.jobManager.startJob(jobId, mode, tasks.length, options);

      console.log(chalk.cyan(`\n🚀 강화된 ${mode === 'pause' ? '일시중지' : '재개'} 배치 처리 시작`));
      console.log(chalk.yellow(`📋 작업 ID: ${jobId}`));
      console.log(chalk.gray(`  • 총 작업: ${tasks.length}개`));
      console.log(chalk.gray(`  • 동시 실행: ${concurrency}개`));
      console.log(chalk.gray(`  • 우선순위: ${priority}`));
      console.log(chalk.gray(`  • 자동 복구: ${autoRecovery ? '활성' : '비활성'}`));
      console.log(chalk.gray(`  • 진행 상황 저장: ${saveProgress ? '활성' : '비활성'}\n`));

      // 작업 정렬 (우선순위에 따라)
      const sortedTasks = this.sortTasksByPriority(tasks, priority);

      // 배치 생성
      const batches = this.createBatches(sortedTasks, batchSize);
      console.log(chalk.blue(`📦 ${batches.length}개 배치로 분할됨\n`));

      // 병렬 처리 제한 설정
      const limit = pLimit(this.getAdaptiveConcurrency(concurrency));

      // 각 배치 처리
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        // 취소 요청 확인
        if (this.jobManager.isCancelRequested(jobId)) {
          console.log(chalk.yellow('\n⚠️  작업 취소 요청 감지'));
          break;
        }

        // 일시정지 요청 확인
        while (this.jobManager.isPauseRequested(jobId)) {
          console.log(chalk.yellow('\n⏸️  작업 일시정지 중...'));
          await this.pauseJobAndWait(jobId);
        }

        const batch = batches[batchIndex];
        const batchNum = batchIndex + 1;

        console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
        console.log(chalk.cyan(`📦 배치 ${batchNum}/${batches.length} 처리 시작 (${batch.length}개 계정)`));
        console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));

        // 배치 처리 전 리소스 체크
        await this.checkResources();

        // 배치 내 작업 처리
        const batchPromises = batch.map((task, index) =>
          limit(async () => {
            // 취소 요청 재확인
            if (this.jobManager.isCancelRequested(jobId)) {
              return { status: 'cancelled', task };
            }

            // 작업 간 지연
            if (index > 0 && concurrency === 1) {
              console.log(chalk.gray(`⏳ ${delayBetweenTasks / 1000}초 대기 중...`));
              await new Promise(resolve => setTimeout(resolve, delayBetweenTasks));
            }

            return this.processTaskWithRetry(jobId, task, mode, {
              batchNum,
              taskIndex: index + 1,
              batchSize: batch.length,
              retryEnabled
            });
          })
        );

        // 배치 완료 대기
        const results = await Promise.allSettled(batchPromises);

        // 결과 처리
        this.processBatchResults(jobId, results);

        // 진행 상황 업데이트
        this.updateProgress(jobId, progressCallback);

        // 진행 상황 저장
        if (saveProgress) {
          await this.saveProgressToFile(jobId);
        }

        // 다음 배치 전 대기
        if (batchIndex < batches.length - 1) {
          console.log(chalk.gray(`\n⏳ 다음 배치까지 ${delayBetweenBatches / 1000}초 대기...\n`));
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
      }

      // 실패 작업 자동 복구
      if (autoRecovery) {
        await this.performAutoRecovery(jobId);
      }

      // 작업 완료
      const finalJob = this.jobManager.completeJob(
        jobId,
        this.jobManager.isCancelRequested(jobId) ? 'cancelled' : 'completed'
      );

      // 최종 리포트
      this.generateFinalReport(finalJob);

      return finalJob;

    } catch (error) {
      console.error(chalk.red(`\n❌ 배치 처리 실패: ${error.message}`));
      this.jobManager.forceCompleteJob(jobId, 'failed');
      throw error;
    }
  }

  /**
   * 재시도 로직이 포함된 작업 처리
   */
  async processTaskWithRetry(jobId, task, mode, options) {
    const { retryEnabled, batchNum, taskIndex, batchSize } = options;
    let lastError = null;
    let retryCount = 0;

    // 작업 시작 알림
    this.jobManager.startTask(jobId, {
      id: task.googleId,
      profile: task.adsPowerId,
      mode
    });

    // 재시도 전략 결정
    const getRetryStrategy = (error) => {
      if (error.message?.includes('NETWORK')) return this.retryStrategies.NETWORK_ERROR;
      if (error.message?.includes('TIMEOUT')) return this.retryStrategies.TIMEOUT;
      if (error.message?.includes('RATE_LIMIT')) return this.retryStrategies.RATE_LIMIT;
      if (error.message?.includes('RECAPTCHA')) return this.retryStrategies.RECAPTCHA;
      if (error.message?.includes('ACCOUNT_LOCKED')) return this.retryStrategies.ACCOUNT_LOCKED;
      return this.retryStrategies.DEFAULT;
    };

    while (true) {
      try {
        // 진행 상황 표시
        const progress = `[${taskIndex}/${batchSize}]`;
        const retryInfo = retryCount > 0 ? ` (재시도 ${retryCount})` : '';
        console.log(chalk.blue(`${progress} 🔄 처리 중: ${task.googleId}${retryInfo}`));

        // 작업 실행
        const result = await this.executeTask(task, mode);

        // 성공 처리
        console.log(chalk.green(`${progress} ✅ 성공: ${task.googleId}`));

        this.jobManager.completeTask(jobId, {
          status: 'success',
          result,
          retryCount
        });

        // Sheets 업데이트
        await this.updateSheets(task, result, mode);

        return { status: 'success', task, result };

      } catch (error) {
        lastError = error;

        const strategy = getRetryStrategy(error);

        // 재시도 불가능한 에러
        if (!retryEnabled || retryCount >= strategy.maxRetries) {
          console.log(chalk.red(`[${taskIndex}/${batchSize}] ❌ 실패: ${task.googleId}`));
          console.log(chalk.red(`    └─ ${error.message}`));

          this.jobManager.completeTask(jobId, {
            status: 'failed',
            error: error.message,
            retryCount
          });

          return { status: 'failed', task, error: error.message };
        }

        // 재시도 대기
        retryCount++;
        const delay = strategy.backoff
          ? strategy.delay * Math.pow(2, retryCount - 1)
          : strategy.delay;

        console.log(chalk.yellow(`    └─ ${delay / 1000}초 후 재시도 (${retryCount}/${strategy.maxRetries})`));
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 개별 작업 실행
   */
  async executeTask(task, mode) {
    // 이미 처리된 상태 확인
    if (mode === 'pause' && (task.status === '일시중지' || task.status === 'paused')) {
      console.log(chalk.gray(`    └─ 스킵: 이미 일시중지됨`));
      return { status: 'skipped', reason: 'Already paused' };
    }

    if (mode === 'resume' && (task.status === '결제중' || task.status === 'active')) {
      console.log(chalk.gray(`    └─ 스킵: 이미 활성 상태`));
      return { status: 'skipped', reason: 'Already active' };
    }

    // UseCase 실행
    const useCase = mode === 'pause' ? this.pauseUseCase : this.resumeUseCase;

    // 타임아웃 설정
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), 5 * 60 * 1000); // 5분
    });

    const execution = useCase.execute(task.adsPowerId, {
      profileData: {
        email: task.googleId,
        password: task.password,
        recoveryEmail: task.recoveryEmail,
        code: task.code,
        googleId: task.googleId
      },
      debugMode: false
    });

    // 타임아웃과 실행 중 먼저 완료되는 것 처리
    const result = await Promise.race([execution, timeout]);

    if (!result.success) {
      throw new Error(result.error || `${mode} 실패`);
    }

    return result;
  }

  /**
   * 적응형 동시 실행 수 계산
   */
  getAdaptiveConcurrency(baseConcurrency) {
    if (!this.resourceMonitor.adaptiveConcurrency) {
      return baseConcurrency;
    }

    const memUsage = process.memoryUsage();
    const memoryUsageRatio = memUsage.heapUsed / this.resourceMonitor.maxMemoryUsage;

    // 메모리 사용량에 따라 동시 실행 수 조정
    if (memoryUsageRatio > 0.8) {
      this.resourceMonitor.currentConcurrency = 1;
    } else if (memoryUsageRatio > 0.6) {
      this.resourceMonitor.currentConcurrency = Math.min(2, baseConcurrency);
    } else if (memoryUsageRatio > 0.4) {
      this.resourceMonitor.currentConcurrency = Math.min(3, baseConcurrency);
    } else {
      this.resourceMonitor.currentConcurrency = baseConcurrency;
    }

    if (this.resourceMonitor.currentConcurrency !== baseConcurrency) {
      console.log(chalk.gray(`⚙️  동시 실행 수 조정: ${this.resourceMonitor.currentConcurrency}`));
    }

    return this.resourceMonitor.currentConcurrency;
  }

  /**
   * 리소스 체크
   */
  async checkResources() {
    const memUsage = process.memoryUsage();
    const memoryUsageRatio = memUsage.heapUsed / memUsage.heapTotal;

    if (memoryUsageRatio > 0.9) {
      console.log(chalk.yellow('⚠️  메모리 부족 - 가비지 컬렉션 실행'));
      if (global.gc) {
        global.gc();
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // AdsPower 프로세스 수 체크
    try {
      const profiles = await this.adsPowerAdapter.getActiveBrowsers();
      if (profiles && profiles.length > 10) {
        console.log(chalk.yellow(`⚠️  활성 브라우저 많음: ${profiles.length}개`));
        // 일부 브라우저 정리
        for (let i = 0; i < Math.min(5, profiles.length - 5); i++) {
          try {
            await this.adsPowerAdapter.closeBrowser(profiles[i].id);
          } catch (e) {
            // 무시
          }
        }
      }
    } catch (error) {
      // 무시
    }
  }

  /**
   * 작업 일시정지 및 대기
   */
  async pauseJobAndWait(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job) return;

    job.status = 'paused';

    // 일시정지 상태 유지
    while (job.pauseRequested && !job.cancelRequested) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!job.cancelRequested) {
      job.status = 'running';
      console.log(chalk.green('\n▶️  작업 재개'));
    }
  }

  /**
   * 배치 결과 처리
   */
  processBatchResults(jobId, results) {
    results.forEach(result => {
      if (result.status === 'rejected') {
        console.error(chalk.red(`예기치 않은 오류: ${result.reason}`));
        this.jobManager.completeTask(jobId, {
          status: 'failed',
          error: result.reason?.message || 'Unknown error'
        });
      }
    });
  }

  /**
   * 진행 상황 업데이트
   */
  updateProgress(jobId, callback) {
    const job = this.jobManager.getJob(jobId);
    if (!job) return;

    const progress = this.jobManager.calculateProgress(job);

    // 진행률 바
    const progressBar = this.createProgressBar(progress.percentage);
    console.log(chalk.cyan(`\n진행률: ${progressBar} ${progress.percentage}%`));
    console.log(chalk.gray(`처리: ${progress.processed}/${job.totalTasks} | 남은 시간: ${progress.estimatedTimeRemaining || 'N/A'}초`));

    if (callback) {
      callback(progress);
    }
  }

  /**
   * 진행률 바 생성
   */
  createProgressBar(percentage) {
    const width = 30;
    const filled = Math.round(width * percentage / 100);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * 자동 복구
   */
  async performAutoRecovery(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job || !job.results.failed.length) return;

    // 복구 가능한 실패 작업 필터링
    const recoverableTasks = job.results.failed.filter(task => {
      return !task.skipRetry && !task.accountLocked && task.retryCount < 3;
    });

    if (recoverableTasks.length === 0) return;

    console.log(chalk.yellow(`\n🔧 ${recoverableTasks.length}개 실패 작업 자동 복구 시도...\n`));

    for (const task of recoverableTasks) {
      if (this.jobManager.isCancelRequested(jobId)) break;

      console.log(chalk.blue(`🔄 복구 시도: ${task.googleId}`));

      try {
        const result = await this.executeTask(task, job.type);

        console.log(chalk.green(`✅ 복구 성공: ${task.googleId}`));

        // 실패에서 성공으로 이동
        job.results.failed = job.results.failed.filter(f => f.googleId !== task.googleId);
        job.results.success.push({ ...task, result, recovered: true });
        job.failedTasks--;
        job.completedTasks++;

      } catch (error) {
        console.log(chalk.red(`❌ 복구 실패: ${task.googleId} - ${error.message}`));
      }

      // 복구 작업 간 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  /**
   * 진행 상황 파일 저장
   */
  async saveProgressToFile(jobId) {
    const job = this.jobManager.getJob(jobId);
    if (!job) return;

    const fs = require('fs-extra');
    const path = require('path');

    const progressFile = path.join(
      process.cwd(),
      'batch-progress',
      `${jobId}.json`
    );

    await fs.ensureDir(path.dirname(progressFile));
    await fs.writeJson(progressFile, {
      jobId,
      status: job.status,
      progress: this.jobManager.calculateProgress(job),
      stats: {
        completed: job.completedTasks,
        failed: job.failedTasks,
        skipped: job.skippedTasks,
        total: job.totalTasks
      },
      updatedAt: Date.now()
    }, { spaces: 2 });
  }

  /**
   * 작업 우선순위 정렬
   */
  sortTasksByPriority(tasks, priority) {
    if (priority === 'normal') return tasks;

    // 우선순위에 따른 정렬 로직
    return [...tasks].sort((a, b) => {
      if (priority === 'high') {
        // 실패 이력이 있는 계정 우선
        const aFailed = a.lastFailure || 0;
        const bFailed = b.lastFailure || 0;
        return bFailed - aFailed;
      } else if (priority === 'low') {
        // 최근 성공한 계정은 나중에
        const aSuccess = a.lastSuccess || 0;
        const bSuccess = b.lastSuccess || 0;
        return aSuccess - bSuccess;
      }
      return 0;
    });
  }

  /**
   * 배치 생성
   */
  createBatches(tasks, batchSize) {
    const batches = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      batches.push(tasks.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Sheets 업데이트
   */
  async updateSheets(task, result, mode) {
    if (!this.sheetsRepository) return;

    try {
      const status = mode === 'pause' ? '일시중지' : '결제중';
      const timestamp = new Date().toLocaleTimeString('ko-KR');

      if (mode === 'pause') {
        await this.sheetsRepository.updatePauseResult(
          task.rowIndex,
          `✅ 성공 (${timestamp})`,
          status,
          result.nextBillingDate
        );
      } else {
        await this.sheetsRepository.updateResumeResult(
          task.rowIndex,
          `✅ 성공 (${timestamp})`,
          status,
          result.nextBillingDate
        );
      }
    } catch (error) {
      console.log(chalk.yellow(`    └─ ⚠️  Sheets 업데이트 실패: ${error.message}`));
    }
  }

  /**
   * 최종 리포트 생성
   */
  generateFinalReport(job) {
    const duration = ((job.duration || 0) / 1000).toFixed(1);

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('📊 강화된 배치 처리 최종 리포트'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.white(`작업 ID: ${job.id}`));
    console.log(chalk.white(`상태: ${job.status}`));
    console.log(chalk.green(`✅ 완료: ${job.completedTasks}개`));
    console.log(chalk.red(`❌ 실패: ${job.failedTasks}개`));
    console.log(chalk.gray(`⏭️  스킵: ${job.skippedTasks}개`));
    console.log(chalk.blue(`⏱️  총 시간: ${duration}초`));

    const avgTime = job.metrics?.avgProcessingTime
      ? (job.metrics.avgProcessingTime / 1000).toFixed(1)
      : 'N/A';
    console.log(chalk.blue(`⚡ 평균 시간: ${avgTime}초/작업`));

    // 메모리 사용량
    if (job.metrics?.finalMemory) {
      const memUsed = (job.metrics.finalMemory.heapUsed / 1024 / 1024).toFixed(1);
      console.log(chalk.gray(`💾 메모리 사용: ${memUsed} MB`));
    }

    // 실패 상세
    if (job.failedTasks > 0 && job.errors?.length > 0) {
      console.log(chalk.red('\n실패 원인 분석:'));
      const errorCounts = {};
      job.errors.forEach(error => {
        const key = error.split(':')[0] || 'Unknown';
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      });

      Object.entries(errorCounts).forEach(([error, count]) => {
        console.log(chalk.red(`  • ${error}: ${count}건`));
      });
    }

    if (job.cancelReason) {
      console.log(chalk.yellow(`\n취소 이유: ${job.cancelReason}`));
    }

    if (job.resultsFile) {
      console.log(chalk.gray(`\n상세 결과: ${job.resultsFile}`));
    }

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  }
}

module.exports = EnhancedBatchProcessingUseCase;