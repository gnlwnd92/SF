/**
 * 병렬 결제 재개 실행기
 * 여러 프로필을 동시에 처리하여 속도 향상
 */

const chalk = require('chalk');
const os = require('os');
const { Worker } = require('worker_threads');
const pLimit = require('p-limit');
const EventEmitter = require('events');

class ParallelResumeExecutor extends EventEmitter {
  constructor(options = {}) {
    super();

    // 기본 설정
    this.config = {
      maxConcurrency: options.maxConcurrency || this.calculateOptimalConcurrency(),
      batchSize: options.batchSize || 10,
      retryAttempts: options.retryAttempts || 3,
      timeout: options.timeout || 60000, // 60초
      useWorkers: options.useWorkers || false, // Worker Threads 사용 여부
      debug: options.debug || false
    };

    // 상태 추적
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      startTime: null,
      endTime: null
    };

    // 결과 저장
    this.results = {
      successful: [],
      failed: [],
      skipped: []
    };

    // 진행 중인 작업
    this.activeJobs = new Map();
  }

  /**
   * 최적 동시 실행 수 계산
   */
  calculateOptimalConcurrency() {
    const cpuCount = os.cpus().length;
    const totalMemoryGB = os.totalmem() / (1024 ** 3);

    // 각 브라우저가 약 500MB 사용한다고 가정
    const memoryBasedLimit = Math.floor(totalMemoryGB * 0.7 / 0.5);

    // CPU 코어당 1-2개 브라우저
    const cpuBasedLimit = cpuCount * 1.5;

    // AdsPower 제한 고려 (보통 10-20)
    const adsPowerLimit = 10;

    // 최소값 선택
    const optimal = Math.min(
      memoryBasedLimit,
      cpuBasedLimit,
      adsPowerLimit
    );

    this.log(`최적 동시 실행 수: ${optimal} (CPU: ${cpuCount}, Memory: ${totalMemoryGB.toFixed(1)}GB)`, 'info');
    return Math.max(optimal, 2); // 최소 2개
  }

  /**
   * Promise.all 기반 간단한 병렬 처리
   */
  async executeSimpleParallel(profiles, workflowExecutor) {
    this.stats.total = profiles.length;
    this.stats.startTime = Date.now();

    this.log(`🚀 병렬 처리 시작: ${profiles.length}개 프로필, 동시 실행: ${this.config.maxConcurrency}개`, 'info');

    // p-limit으로 동시 실행 제한
    const limit = pLimit(this.config.maxConcurrency);

    // 진행 상황 모니터링 시작
    const monitorInterval = this.startProgressMonitor();

    try {
      // 모든 프로필에 대해 제한된 병렬 처리
      const promises = profiles.map(profile =>
        limit(async () => {
          const jobId = `${profile.profileId}_${Date.now()}`;
          this.activeJobs.set(jobId, {
            profileId: profile.profileId,
            startTime: Date.now(),
            status: 'processing'
          });

          this.stats.inProgress++;

          try {
            const result = await this.processProfileWithRetry(
              profile,
              workflowExecutor
            );

            this.stats.completed++;
            this.results.successful.push(result);

            this.emit('profile:success', {
              profileId: profile.profileId,
              result
            });

            return result;

          } catch (error) {
            this.stats.failed++;
            this.results.failed.push({
              profileId: profile.profileId,
              error: error.message
            });

            this.emit('profile:error', {
              profileId: profile.profileId,
              error
            });

            // 에러를 던지지 않고 계속 진행
            return null;

          } finally {
            this.stats.inProgress--;
            this.activeJobs.delete(jobId);
          }
        })
      );

      // 모든 작업 완료 대기
      const results = await Promise.allSettled(promises);

      this.stats.endTime = Date.now();

      // 모니터링 중지
      clearInterval(monitorInterval);

      // 최종 결과 표시
      this.displayFinalReport();

      return this.results;

    } catch (error) {
      this.log(`❌ 병렬 처리 중 오류: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 재시도 로직이 포함된 프로필 처리
   */
  async processProfileWithRetry(profile, workflowExecutor, attempt = 1) {
    try {
      this.log(`처리 중: ${profile.profileId} (시도 ${attempt}/${this.config.retryAttempts})`, 'debug');

      // 타임아웃 설정
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), this.config.timeout)
      );

      // 실제 처리
      const processPromise = workflowExecutor(profile);

      // 타임아웃과 실제 처리 경쟁
      const result = await Promise.race([processPromise, timeoutPromise]);

      return result;

    } catch (error) {
      if (attempt < this.config.retryAttempts) {
        this.log(`⚠️ ${profile.profileId} 재시도 중... (${attempt}/${this.config.retryAttempts})`, 'warning');

        // 지수 백오프로 대기
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));

        return this.processProfileWithRetry(
          profile,
          workflowExecutor,
          attempt + 1
        );
      }

      throw error;
    }
  }

  /**
   * Worker Threads 기반 고급 병렬 처리
   */
  async executeWorkerParallel(profiles, workerPath) {
    this.stats.total = profiles.length;
    this.stats.startTime = Date.now();

    const workers = [];
    const workQueue = [...profiles];
    const workerPromises = [];

    // 워커 생성
    for (let i = 0; i < this.config.maxConcurrency; i++) {
      const worker = new Worker(workerPath, {
        workerData: {
          workerId: i,
          config: this.config
        }
      });

      workers.push(worker);

      // 워커 프로미스 생성
      const workerPromise = this.runWorker(worker, workQueue);
      workerPromises.push(workerPromise);
    }

    // 모든 워커 완료 대기
    await Promise.all(workerPromises);

    // 워커 종료
    workers.forEach(w => w.terminate());

    this.stats.endTime = Date.now();
    this.displayFinalReport();

    return this.results;
  }

  /**
   * 개별 워커 실행
   */
  async runWorker(worker, queue) {
    return new Promise((resolve) => {
      worker.on('message', (message) => {
        if (message.type === 'READY') {
          // 작업 할당
          if (queue.length > 0) {
            const profile = queue.shift();
            worker.postMessage({
              type: 'PROCESS_PROFILE',
              data: profile
            });
          } else {
            worker.postMessage({ type: 'SHUTDOWN' });
          }
        } else if (message.type === 'PROFILE_COMPLETE') {
          const { result } = message;

          if (result.success) {
            this.stats.completed++;
            this.results.successful.push(result);
          } else {
            this.stats.failed++;
            this.results.failed.push(result);
          }

          // 다음 작업 할당
          if (queue.length > 0) {
            const profile = queue.shift();
            worker.postMessage({
              type: 'PROCESS_PROFILE',
              data: profile
            });
          } else {
            worker.postMessage({ type: 'SHUTDOWN' });
          }
        }
      });

      worker.on('exit', () => resolve());
    });
  }

  /**
   * 진행 상황 모니터링
   */
  startProgressMonitor() {
    return setInterval(() => {
      this.displayProgress();
    }, 2000);
  }

  /**
   * 진행 상황 표시
   */
  displayProgress() {
    const elapsed = Date.now() - this.stats.startTime;
    const throughput = this.stats.completed / (elapsed / 1000);
    const progress = this.stats.completed / this.stats.total * 100;
    const eta = (this.stats.total - this.stats.completed) / throughput;

    console.clear();
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════'));
    console.log(chalk.cyan.bold('           병렬 처리 진행 상황'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════════════\n'));

    // 진행률 바
    const barLength = 40;
    const filled = Math.floor(barLength * progress / 100);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    console.log(`진행률: ${bar} ${progress.toFixed(1)}%`);
    console.log(`완료: ${this.stats.completed}/${this.stats.total} | 실패: ${this.stats.failed} | 처리 중: ${this.stats.inProgress}`);

    // 성능 지표
    console.log(`\n처리 속도: ${throughput.toFixed(2)} profiles/sec`);
    console.log(`예상 완료: ${this.formatTime(eta)}`);
    console.log(`경과 시간: ${this.formatTime(elapsed / 1000)}`);

    // 현재 처리 중인 작업
    if (this.activeJobs.size > 0) {
      console.log('\n처리 중인 프로필:');
      for (const [jobId, job] of this.activeJobs) {
        const duration = (Date.now() - job.startTime) / 1000;
        console.log(`  • ${job.profileId} (${duration.toFixed(1)}초)`);
      }
    }

    // 시스템 리소스
    const cpuUsage = os.loadavg()[0] * 100 / os.cpus().length;
    const memUsage = (1 - os.freemem() / os.totalmem()) * 100;

    console.log('\n시스템 리소스:');
    console.log(`  CPU: ${cpuUsage.toFixed(1)}% | MEM: ${memUsage.toFixed(1)}%`);
  }

  /**
   * 최종 보고서 표시
   */
  displayFinalReport() {
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    const throughput = this.stats.total / duration;

    console.log(chalk.green.bold('\n═══════════════════════════════════════════════'));
    console.log(chalk.green.bold('           병렬 처리 완료'));
    console.log(chalk.green.bold('═══════════════════════════════════════════════\n'));

    console.log(chalk.white('📊 최종 결과:'));
    console.log(chalk.green(`  ✅ 성공: ${this.stats.completed}`));
    console.log(chalk.red(`  ❌ 실패: ${this.stats.failed}`));
    console.log(chalk.gray(`  ⏭️  건너뜀: ${this.results.skipped.length}`));

    console.log(chalk.white('\n⚡ 성능:'));
    console.log(chalk.cyan(`  총 시간: ${this.formatTime(duration)}`));
    console.log(chalk.cyan(`  처리 속도: ${throughput.toFixed(2)} profiles/sec`));
    console.log(chalk.cyan(`  동시 실행: ${this.config.maxConcurrency}개`));

    // 순차 처리 대비 개선율
    const sequentialTime = this.stats.total * 10; // 프로필당 10초 가정
    const speedup = sequentialTime / duration;
    console.log(chalk.yellow(`  속도 향상: ${speedup.toFixed(1)}배`));

    // 실패한 프로필 목록
    if (this.results.failed.length > 0) {
      console.log(chalk.red('\n❌ 실패한 프로필:'));
      this.results.failed.slice(0, 5).forEach(f => {
        console.log(chalk.red(`  - ${f.profileId}: ${f.error}`));
      });

      if (this.results.failed.length > 5) {
        console.log(chalk.gray(`  ... 외 ${this.results.failed.length - 5}개`));
      }
    }
  }

  /**
   * 시간 포맷팅
   */
  formatTime(seconds) {
    if (seconds < 60) return `${seconds.toFixed(1)}초`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}분`;
    return `${(seconds / 3600).toFixed(1)}시간`;
  }

  /**
   * 로깅 헬퍼
   */
  log(message, level = 'info') {
    if (!this.config.debug && level === 'debug') return;

    const timestamp = new Date().toISOString();
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      debug: chalk.gray
    };

    const color = colors[level] || chalk.white;
    console.log(`${chalk.gray(timestamp)} ${color(message)}`);
  }
}

module.exports = ParallelResumeExecutor;