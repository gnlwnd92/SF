/**
 * 배치 작업 관리자
 * 진행 중인 배치 작업을 추적하고 제어하는 중앙 관리 시스템
 */

const EventEmitter = require('events');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

class BatchJobManager extends EventEmitter {
  constructor() {
    super();
    this.activeJobs = new Map(); // 활성 작업 저장
    this.jobHistory = [];         // 작업 이력
    this.maxHistorySize = 100;    // 최대 이력 크기
    this.checkInterval = null;     // 상태 체크 인터벌
    this.stateFile = path.join(process.cwd(), 'batch-jobs-state.json');

    // 이전 상태 복원
    this.restoreState();

    // 프로세스 종료 시 상태 저장
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());
  }

  /**
   * 새 배치 작업 시작
   */
  startJob(jobId, jobType, totalTasks, options = {}) {
    if (this.activeJobs.has(jobId)) {
      throw new Error(`Job ${jobId} already exists`);
    }

    const job = {
      id: jobId,
      type: jobType,
      status: 'running',
      totalTasks,
      completedTasks: 0,
      failedTasks: 0,
      skippedTasks: 0,
      currentTask: null,
      startTime: Date.now(),
      endTime: null,
      options,
      cancelRequested: false,
      pauseRequested: false,
      errors: [],
      results: {
        success: [],
        failed: [],
        skipped: []
      },
      metrics: {
        avgProcessingTime: 0,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };

    this.activeJobs.set(jobId, job);
    this.emit('jobStarted', job);

    // 상태 모니터링 시작
    if (!this.checkInterval) {
      this.startMonitoring();
    }

    // 상태 저장
    this.saveState();

    console.log(chalk.cyan(`📋 배치 작업 시작: ${jobId}`));
    console.log(chalk.gray(`  • 타입: ${jobType}`));
    console.log(chalk.gray(`  • 총 작업: ${totalTasks}개`));

    return job;
  }

  /**
   * 작업 진행 상황 업데이트
   */
  updateJobProgress(jobId, update) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      console.warn(`Job ${jobId} not found`);
      return;
    }

    // 업데이트 적용
    Object.assign(job, update);

    // 메트릭 업데이트
    this.updateMetrics(job);

    // 진행률 계산
    const progress = this.calculateProgress(job);
    job.progress = progress;

    // 이벤트 발생
    this.emit('jobProgress', { jobId, job, progress });

    // 상태 저장 (5초마다)
    if (Date.now() - (job.lastSaved || 0) > 5000) {
      this.saveState();
      job.lastSaved = Date.now();
    }

    return job;
  }

  /**
   * 개별 작업 시작 알림
   */
  startTask(jobId, taskInfo) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    job.currentTask = {
      ...taskInfo,
      startTime: Date.now()
    };

    this.emit('taskStarted', { jobId, task: job.currentTask });
  }

  /**
   * 개별 작업 완료 알림
   */
  completeTask(jobId, taskResult) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    const duration = Date.now() - job.currentTask.startTime;

    // 결과에 따라 카운터 업데이트
    if (taskResult.status === 'success') {
      job.completedTasks++;
      job.results.success.push({
        ...job.currentTask,
        ...taskResult,
        duration
      });
    } else if (taskResult.status === 'failed') {
      job.failedTasks++;
      job.results.failed.push({
        ...job.currentTask,
        ...taskResult,
        duration
      });
      job.errors.push(taskResult.error);
    } else if (taskResult.status === 'skipped') {
      job.skippedTasks++;
      job.results.skipped.push({
        ...job.currentTask,
        ...taskResult,
        duration
      });
    }

    // 평균 처리 시간 업데이트
    const totalProcessed = job.completedTasks + job.failedTasks + job.skippedTasks;
    job.metrics.avgProcessingTime =
      (job.metrics.avgProcessingTime * (totalProcessed - 1) + duration) / totalProcessed;

    job.currentTask = null;

    this.emit('taskCompleted', { jobId, result: taskResult });

    // 메모리 관리: 결과가 너무 많으면 파일로 저장
    this.manageMemory(job);
  }

  /**
   * 작업 취소 요청
   */
  cancelJob(jobId, reason = 'User requested') {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running`);
    }

    console.log(chalk.yellow(`\n⚠️  배치 작업 취소 요청: ${jobId}`));
    console.log(chalk.yellow(`  • 이유: ${reason}`));

    job.cancelRequested = true;
    job.cancelReason = reason;
    job.status = 'cancelling';

    this.emit('jobCancelling', { jobId, reason });

    // 현재 작업 정리 대기 (최대 10초)
    const cancelTimeout = setTimeout(() => {
      this.forceCompleteJob(jobId, 'cancelled');
    }, 10000);

    job.cancelTimeout = cancelTimeout;

    return job;
  }

  /**
   * 작업 일시정지 요청
   */
  pauseJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'running') {
      throw new Error(`Job ${jobId} is not running`);
    }

    console.log(chalk.yellow(`\n⏸️  배치 작업 일시정지: ${jobId}`));

    job.pauseRequested = true;
    job.status = 'pausing';

    this.emit('jobPausing', { jobId });

    return job;
  }

  /**
   * 작업 재개
   */
  resumeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== 'paused') {
      throw new Error(`Job ${jobId} is not paused`);
    }

    console.log(chalk.green(`\n▶️  배치 작업 재개: ${jobId}`));

    job.pauseRequested = false;
    job.status = 'running';

    this.emit('jobResumed', { jobId });

    return job;
  }

  /**
   * 작업 완료 처리
   */
  completeJob(jobId, status = 'completed') {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    if (job.cancelTimeout) {
      clearTimeout(job.cancelTimeout);
    }

    job.status = status;
    job.endTime = Date.now();
    job.duration = job.endTime - job.startTime;

    // 최종 메트릭 수집
    job.metrics.finalMemory = process.memoryUsage();
    job.metrics.finalCpu = process.cpuUsage();

    // 작업 이력에 추가
    this.addToHistory(job);

    // 활성 작업에서 제거
    this.activeJobs.delete(jobId);

    // 이벤트 발생
    this.emit('jobCompleted', { jobId, job });

    // 최종 리포트 생성
    this.generateReport(job);

    // 상태 저장
    this.saveState();

    // 모니터링 중지 (활성 작업이 없으면)
    if (this.activeJobs.size === 0 && this.checkInterval) {
      this.stopMonitoring();
    }

    return job;
  }

  /**
   * 강제 작업 완료
   */
  forceCompleteJob(jobId, status = 'failed') {
    console.log(chalk.red(`\n❌ 배치 작업 강제 종료: ${jobId}`));
    return this.completeJob(jobId, status);
  }

  /**
   * 작업 상태 확인
   */
  getJob(jobId) {
    return this.activeJobs.get(jobId);
  }

  /**
   * 모든 활성 작업 조회
   */
  getActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  /**
   * 작업 취소 요청 확인
   */
  isCancelRequested(jobId) {
    const job = this.activeJobs.get(jobId);
    return job?.cancelRequested || false;
  }

  /**
   * 작업 일시정지 요청 확인
   */
  isPauseRequested(jobId) {
    const job = this.activeJobs.get(jobId);
    return job?.pauseRequested || false;
  }

  /**
   * 진행률 계산
   */
  calculateProgress(job) {
    const total = job.totalTasks;
    const processed = job.completedTasks + job.failedTasks + job.skippedTasks;

    return {
      percentage: Math.round((processed / total) * 100),
      processed,
      remaining: total - processed,
      estimatedTimeRemaining: this.estimateTimeRemaining(job)
    };
  }

  /**
   * 남은 시간 예측
   */
  estimateTimeRemaining(job) {
    const processed = job.completedTasks + job.failedTasks + job.skippedTasks;
    if (processed === 0) return null;

    const avgTime = job.metrics.avgProcessingTime;
    const remaining = job.totalTasks - processed;

    return Math.round(avgTime * remaining / 1000); // 초 단위
  }

  /**
   * 메트릭 업데이트
   */
  updateMetrics(job) {
    job.metrics.memoryUsage = process.memoryUsage();
    job.metrics.cpuUsage = process.cpuUsage();

    // 메모리 사용량 경고
    const heapUsed = job.metrics.memoryUsage.heapUsed;
    const heapTotal = job.metrics.memoryUsage.heapTotal;
    const usage = (heapUsed / heapTotal) * 100;

    if (usage > 80) {
      console.warn(chalk.yellow(`⚠️  메모리 사용량 높음: ${usage.toFixed(1)}%`));
      this.emit('memoryWarning', { jobId: job.id, usage });
    }
  }

  /**
   * 메모리 관리
   */
  async manageMemory(job) {
    const MAX_RESULTS_IN_MEMORY = 1000;
    const totalResults =
      job.results.success.length +
      job.results.failed.length +
      job.results.skipped.length;

    if (totalResults > MAX_RESULTS_IN_MEMORY) {
      // 결과를 파일로 저장
      const resultsFile = path.join(
        process.cwd(),
        `batch-results-${job.id}-${Date.now()}.json`
      );

      await fs.writeJson(resultsFile, {
        success: job.results.success.slice(0, -100),
        failed: job.results.failed.slice(0, -100),
        skipped: job.results.skipped.slice(0, -100)
      });

      // 메모리에서 제거 (최근 100개만 유지)
      job.results.success = job.results.success.slice(-100);
      job.results.failed = job.results.failed.slice(-100);
      job.results.skipped = job.results.skipped.slice(-100);

      job.resultsFile = resultsFile;

      console.log(chalk.gray(`💾 결과를 파일로 저장: ${resultsFile}`));
    }
  }

  /**
   * 작업 이력에 추가
   */
  addToHistory(job) {
    // 민감한 정보 제거
    const historicalJob = {
      id: job.id,
      type: job.type,
      status: job.status,
      totalTasks: job.totalTasks,
      completedTasks: job.completedTasks,
      failedTasks: job.failedTasks,
      skippedTasks: job.skippedTasks,
      startTime: job.startTime,
      endTime: job.endTime,
      duration: job.duration,
      cancelReason: job.cancelReason
    };

    this.jobHistory.unshift(historicalJob);

    // 최대 크기 유지
    if (this.jobHistory.length > this.maxHistorySize) {
      this.jobHistory = this.jobHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 리포트 생성
   */
  generateReport(job) {
    const duration = ((job.duration || 0) / 1000).toFixed(1);
    const avgTime = job.metrics.avgProcessingTime
      ? (job.metrics.avgProcessingTime / 1000).toFixed(1)
      : 'N/A';

    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan(`📊 배치 작업 완료: ${job.id}`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.white(`상태: ${job.status}`));
    console.log(chalk.green(`✅ 완료: ${job.completedTasks}개`));
    console.log(chalk.red(`❌ 실패: ${job.failedTasks}개`));
    console.log(chalk.gray(`⏭️  스킵: ${job.skippedTasks}개`));
    console.log(chalk.blue(`⏱️  총 시간: ${duration}초`));
    console.log(chalk.blue(`⚡ 평균 시간: ${avgTime}초/작업`));

    if (job.cancelReason) {
      console.log(chalk.yellow(`\n취소 이유: ${job.cancelReason}`));
    }

    if (job.resultsFile) {
      console.log(chalk.gray(`\n상세 결과: ${job.resultsFile}`));
    }
  }

  /**
   * 상태 모니터링 시작
   */
  startMonitoring() {
    this.checkInterval = setInterval(() => {
      this.activeJobs.forEach((job, jobId) => {
        // 진행 상황 체크
        const progress = this.calculateProgress(job);

        // 타임아웃 체크
        if (job.currentTask) {
          const taskDuration = Date.now() - job.currentTask.startTime;
          const timeout = job.options.taskTimeout || 300000; // 기본 5분

          if (taskDuration > timeout) {
            console.warn(chalk.yellow(`⚠️  작업 타임아웃: ${jobId} - ${job.currentTask.id}`));
            this.emit('taskTimeout', { jobId, task: job.currentTask });
          }
        }

        // 메트릭 업데이트
        this.updateMetrics(job);
      });
    }, 5000); // 5초마다 체크
  }

  /**
   * 상태 모니터링 중지
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 상태 저장
   */
  async saveState() {
    try {
      const state = {
        activeJobs: Array.from(this.activeJobs.entries()).map(([id, job]) => ({
          id,
          ...this.sanitizeJobForSave(job)
        })),
        jobHistory: this.jobHistory,
        savedAt: Date.now()
      };

      await fs.writeJson(this.stateFile, state, { spaces: 2 });
    } catch (error) {
      console.error(chalk.red(`상태 저장 실패: ${error.message}`));
    }
  }

  /**
   * 상태 복원
   */
  async restoreState() {
    try {
      if (await fs.pathExists(this.stateFile)) {
        const state = await fs.readJson(this.stateFile);

        // 이력 복원
        this.jobHistory = state.jobHistory || [];

        // 활성 작업은 실패로 처리 (비정상 종료)
        if (state.activeJobs && state.activeJobs.length > 0) {
          console.log(chalk.yellow('이전 세션의 미완료 작업 발견'));
          state.activeJobs.forEach(job => {
            this.jobHistory.unshift({
              ...job,
              status: 'failed',
              endTime: Date.now(),
              cancelReason: 'Abnormal termination'
            });
          });
        }

        console.log(chalk.gray(`✅ 상태 복원 완료 (이력: ${this.jobHistory.length}개)`));
      }
    } catch (error) {
      console.error(chalk.red(`상태 복원 실패: ${error.message}`));
    }
  }

  /**
   * 저장을 위한 작업 정리
   */
  sanitizeJobForSave(job) {
    const sanitized = { ...job };

    // 큰 데이터 제거
    if (sanitized.results) {
      sanitized.results = {
        successCount: sanitized.results.success?.length || 0,
        failedCount: sanitized.results.failed?.length || 0,
        skippedCount: sanitized.results.skipped?.length || 0
      };
    }

    // 함수 제거
    delete sanitized.cancelTimeout;

    return sanitized;
  }

  /**
   * 종료 처리
   */
  async handleShutdown() {
    console.log(chalk.yellow('\n🛑 배치 작업 관리자 종료 중...'));

    // 모든 활성 작업 취소
    for (const [jobId, job] of this.activeJobs) {
      console.log(chalk.yellow(`  • 작업 취소: ${jobId}`));
      job.status = 'cancelled';
      job.cancelReason = 'System shutdown';
      job.endTime = Date.now();
      this.addToHistory(job);
    }

    // 상태 저장
    await this.saveState();

    // 모니터링 중지
    this.stopMonitoring();

    console.log(chalk.gray('배치 작업 관리자 종료 완료'));
    process.exit(0);
  }

  /**
   * 싱글톤 인스턴스
   */
  static instance = null;

  static getInstance() {
    if (!BatchJobManager.instance) {
      BatchJobManager.instance = new BatchJobManager();
    }
    return BatchJobManager.instance;
  }
}

module.exports = BatchJobManager;