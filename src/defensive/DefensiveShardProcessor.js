/**
 * 방어적 샤드 처리기
 * 전체 프로필을 독립된 샤드로 분할하여 안정적으로 처리
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const { fork } = require('child_process');
const EventEmitter = require('events');

class DefensiveShardProcessor extends EventEmitter {
  constructor(options = {}) {
    super();

    // 기본 설정
    this.config = {
      shardSize: options.shardSize || 50,           // 샤드당 프로필 수
      maxConcurrent: options.maxConcurrent || 3,    // 동시 실행 샤드 수
      checkpointInterval: options.checkpointInterval || 10, // 체크포인트 간격
      maxRetries: options.maxRetries || 3,          // 샤드 재시도 횟수
      errorThreshold: options.errorThreshold || 0.2, // 오류 임계값 (20%)
      timeout: options.timeout || 300000,           // 샤드 타임아웃 (5분)
      isolationMode: options.isolationMode || 'thread', // thread | process
      checkpointDir: options.checkpointDir || './checkpoints',
      debug: options.debug || false
    };

    // 상태 관리
    this.shards = [];
    this.activeShards = new Map();
    this.completedShards = new Set();
    this.failedShards = new Map();

    // 통계
    this.stats = {
      total: 0,
      processed: 0,
      failed: 0,
      startTime: null,
      endTime: null
    };

    // Circuit Breaker
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      cooldownTime: 60000
    };
  }

  /**
   * 프로필을 샤드로 분할
   */
  createShards(profiles) {
    this.stats.total = profiles.length;
    this.shards = [];

    const totalShards = Math.ceil(profiles.length / this.config.shardSize);

    for (let i = 0; i < totalShards; i++) {
      const start = i * this.config.shardSize;
      const end = Math.min(start + this.config.shardSize, profiles.length);

      const shard = {
        id: `shard_${String(i + 1).padStart(3, '0')}`,
        index: i,
        profiles: profiles.slice(start, end),
        status: 'pending',
        progress: 0,
        processedCount: 0,
        errorCount: 0,
        errors: [],
        checkpointFile: path.join(this.config.checkpointDir, `checkpoint_${i + 1}.json`),
        retryCount: 0,
        startTime: null,
        endTime: null
      };

      this.shards.push(shard);
    }

    this.log(`📦 Created ${this.shards.length} shards (${this.config.shardSize} profiles each)`, 'info');
    return this.shards;
  }

  /**
   * 모든 샤드 처리 시작
   */
  async processAllShards(workflowExecutor) {
    this.stats.startTime = Date.now();

    // 체크포인트 디렉토리 생성
    await this.ensureCheckpointDirectory();

    // 모니터링 시작
    const monitorInterval = this.startMonitoring();

    try {
      // 격리 모드에 따른 처리
      if (this.config.isolationMode === 'process') {
        await this.processInIsolatedProcesses(workflowExecutor);
      } else {
        await this.processInThreads(workflowExecutor);
      }

      this.stats.endTime = Date.now();

      // 실패한 샤드 재처리
      if (this.failedShards.size > 0) {
        await this.handleFailedShards(workflowExecutor);
      }

    } finally {
      clearInterval(monitorInterval);
      await this.saveGlobalCheckpoint();
      this.displayFinalReport();
    }

    return this.generateReport();
  }

  /**
   * 스레드 모드로 처리 (기본)
   */
  async processInThreads(workflowExecutor) {
    // 동시 실행 제한을 위한 큐
    const queue = [...this.shards];
    const promises = [];

    // 동시에 maxConcurrent 개만큼 실행
    while (queue.length > 0 || this.activeShards.size > 0) {
      // 새 샤드 시작
      while (this.activeShards.size < this.config.maxConcurrent && queue.length > 0) {
        const shard = queue.shift();
        const promise = this.processShard(shard, workflowExecutor);
        this.activeShards.set(shard.id, shard);
        promises.push(promise);
      }

      // 잠시 대기
      await new Promise(r => setTimeout(r, 1000));

      // 완료된 샤드 확인
      for (const [shardId, shard] of this.activeShards) {
        if (shard.status === 'completed' || shard.status === 'failed') {
          this.activeShards.delete(shardId);
        }
      }
    }

    // 모든 작업 완료 대기
    await Promise.allSettled(promises);
  }

  /**
   * 프로세스 격리 모드로 처리
   */
  async processInIsolatedProcesses(workflowExecutor) {
    const queue = [...this.shards];
    const processes = new Map();

    while (queue.length > 0 || processes.size > 0) {
      // 새 프로세스 시작
      while (processes.size < this.config.maxConcurrent && queue.length > 0) {
        const shard = queue.shift();
        const child = fork(path.join(__dirname, 'ShardWorker.js'));

        processes.set(shard.id, { process: child, shard });
        this.activeShards.set(shard.id, shard);

        // 프로세스 메시지 핸들러
        child.on('message', (msg) => {
          this.handleWorkerMessage(shard, msg);
        });

        child.on('exit', (code) => {
          if (code !== 0) {
            shard.status = 'failed';
            this.failedShards.set(shard.id, shard);
          }
          processes.delete(shard.id);
          this.activeShards.delete(shard.id);
        });

        // 작업 시작
        child.send({
          type: 'START',
          shard: shard,
          config: this.config
        });
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * 개별 샤드 처리
   */
  async processShard(shard, workflowExecutor) {
    shard.status = 'running';
    shard.startTime = Date.now();

    try {
      // 체크포인트 로드
      const checkpoint = await this.loadCheckpoint(shard.checkpointFile);
      const startIndex = checkpoint?.lastProcessedIndex || 0;

      this.log(`🔄 [${shard.id}] Starting from index ${startIndex}/${shard.profiles.length}`, 'info');

      for (let i = startIndex; i < shard.profiles.length; i++) {
        const profile = shard.profiles[i];

        // Circuit Breaker 확인
        if (this.isCircuitBreakerOpen()) {
          this.log(`⚡ [${shard.id}] Circuit breaker is open. Pausing...`, 'warning');
          await new Promise(r => setTimeout(r, this.circuitBreaker.cooldownTime));
          this.circuitBreaker.state = 'HALF_OPEN';
        }

        try {
          // 타임아웃 적용
          const result = await this.executeWithTimeout(
            () => workflowExecutor(profile),
            this.config.timeout
          );

          shard.processedCount++;
          this.stats.processed++;
          this.recordSuccess();

          // 진행률 업데이트
          shard.progress = ((i + 1) / shard.profiles.length) * 100;

          // 체크포인트 저장
          if ((i + 1) % this.config.checkpointInterval === 0) {
            await this.saveCheckpoint(shard, i + 1);
          }

          this.emit('profile:success', { shard: shard.id, profile: profile.profileId });

        } catch (error) {
          shard.errorCount++;
          this.stats.failed++;
          this.recordFailure();

          shard.errors.push({
            profileId: profile.profileId,
            error: error.message,
            timestamp: new Date().toISOString()
          });

          this.emit('profile:error', { shard: shard.id, profile: profile.profileId, error });

          // 오류 임계값 확인
          if (shard.errorCount / shard.profiles.length > this.config.errorThreshold) {
            throw new Error(`Error threshold exceeded for ${shard.id}`);
          }
        }
      }

      // 샤드 완료
      shard.status = 'completed';
      shard.endTime = Date.now();
      this.completedShards.add(shard.id);

      this.log(`✅ [${shard.id}] Completed (${shard.processedCount}/${shard.profiles.length})`, 'success');

      return shard;

    } catch (error) {
      // 샤드 실패
      shard.status = 'failed';
      shard.endTime = Date.now();
      this.failedShards.set(shard.id, shard);

      this.log(`❌ [${shard.id}] Failed: ${error.message}`, 'error');

      // 체크포인트 저장
      await this.saveCheckpoint(shard, shard.processedCount);

      throw error;
    }
  }

  /**
   * 실패한 샤드 재처리
   */
  async handleFailedShards(workflowExecutor) {
    const failedShardsList = Array.from(this.failedShards.values());

    this.log(`🔁 Retrying ${failedShardsList.length} failed shards...`, 'warning');

    for (const shard of failedShardsList) {
      if (shard.retryCount >= this.config.maxRetries) {
        this.log(`⏭️ [${shard.id}] Max retries exceeded. Skipping.`, 'error');
        continue;
      }

      shard.retryCount++;
      shard.status = 'retrying';

      try {
        await this.processShard(shard, workflowExecutor);
        this.failedShards.delete(shard.id);
      } catch (error) {
        this.log(`❌ [${shard.id}] Retry ${shard.retryCount} failed`, 'error');
      }
    }
  }

  /**
   * 체크포인트 저장
   */
  async saveCheckpoint(shard, lastProcessedIndex) {
    const checkpoint = {
      shardId: shard.id,
      lastProcessedIndex,
      processedCount: shard.processedCount,
      errorCount: shard.errorCount,
      timestamp: new Date().toISOString(),
      progress: shard.progress
    };

    try {
      await fs.writeFile(
        shard.checkpointFile,
        JSON.stringify(checkpoint, null, 2)
      );
      this.log(`💾 [${shard.id}] Checkpoint saved at index ${lastProcessedIndex}`, 'debug');
    } catch (error) {
      this.log(`⚠️ [${shard.id}] Failed to save checkpoint: ${error.message}`, 'warning');
    }
  }

  /**
   * 체크포인트 로드
   */
  async loadCheckpoint(checkpointFile) {
    try {
      const data = await fs.readFile(checkpointFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null; // 체크포인트 없음
    }
  }

  /**
   * 전역 체크포인트 저장
   */
  async saveGlobalCheckpoint() {
    const globalCheckpoint = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      shards: this.shards.map(s => ({
        id: s.id,
        status: s.status,
        progress: s.progress,
        processedCount: s.processedCount,
        errorCount: s.errorCount
      }))
    };

    const file = path.join(this.config.checkpointDir, 'global_checkpoint.json');
    await fs.writeFile(file, JSON.stringify(globalCheckpoint, null, 2));
  }

  /**
   * Circuit Breaker 관리
   */
  isCircuitBreakerOpen() {
    return this.circuitBreaker.state === 'OPEN';
  }

  recordSuccess() {
    this.circuitBreaker.failures = 0;
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'CLOSED';
    }
  }

  recordFailure() {
    this.circuitBreaker.failures++;
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      this.log('⚡ Circuit breaker opened due to failures', 'warning');
    }
  }

  /**
   * 타임아웃 적용
   */
  async executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout)
      )
    ]);
  }

  /**
   * 모니터링 시작
   */
  startMonitoring() {
    return setInterval(() => {
      this.displayProgress();
    }, 5000);
  }

  /**
   * 진행 상황 표시
   */
  displayProgress() {
    console.clear();

    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const totalProgress = this.calculateOverallProgress();

    console.log(chalk.cyan.bold('╔═══════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║         방어적 샤드 처리 모니터링                      ║'));
    console.log(chalk.cyan.bold('╚═══════════════════════════════════════════════════════╝'));

    // 전체 진행률
    const progressBar = this.createProgressBar(totalProgress);
    console.log(`\n전체: ${progressBar} ${totalProgress.toFixed(1)}%`);
    console.log(`처리: ${this.stats.processed}/${this.stats.total} | 실패: ${this.stats.failed}`);

    // 샤드별 상태
    console.log('\n샤드 상태:');
    this.shards.forEach(shard => {
      const icon = this.getStatusIcon(shard.status);
      const progress = shard.progress.toFixed(0);
      const errorRate = shard.profiles.length > 0
        ? (shard.errorCount / shard.profiles.length * 100).toFixed(1)
        : 0;

      console.log(`  ${icon} ${shard.id}: ${progress}% | 오류: ${errorRate}%`);
    });

    // Circuit Breaker 상태
    console.log(`\n⚡ Circuit Breaker: ${this.circuitBreaker.state}`);
    console.log(`   Failures: ${this.circuitBreaker.failures}/${this.circuitBreaker.threshold}`);

    // 성능 지표
    if (elapsed > 0) {
      const throughput = this.stats.processed / elapsed;
      console.log(`\n⚙️ 처리 속도: ${throughput.toFixed(2)} profiles/sec`);
      console.log(`   경과 시간: ${this.formatTime(elapsed)}`);
    }
  }

  /**
   * 최종 보고서
   */
  displayFinalReport() {
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    const successRate = this.stats.total > 0
      ? ((this.stats.processed - this.stats.failed) / this.stats.total * 100).toFixed(1)
      : 0;

    console.log(chalk.green.bold('\n╔═══════════════════════════════════════════════════════╗'));
    console.log(chalk.green.bold('║                  처리 완료                             ║'));
    console.log(chalk.green.bold('╚═══════════════════════════════════════════════════════╝'));

    console.log('\n📊 결과:');
    console.log(chalk.green(`  ✅ 성공: ${this.stats.processed - this.stats.failed}`));
    console.log(chalk.red(`  ❌ 실패: ${this.stats.failed}`));
    console.log(chalk.blue(`  📈 성공률: ${successRate}%`));

    console.log('\n📦 샤드 통계:');
    console.log(chalk.green(`  ✅ 완료: ${this.completedShards.size}`));
    console.log(chalk.red(`  ❌ 실패: ${this.failedShards.size}`));
    console.log(chalk.gray(`  📋 전체: ${this.shards.length}`));

    console.log('\n⏱️ 성능:');
    console.log(`  총 시간: ${this.formatTime(duration)}`);
    console.log(`  처리 속도: ${(this.stats.processed / duration).toFixed(2)} profiles/sec`);
  }

  /**
   * 보고서 생성
   */
  generateReport() {
    return {
      summary: {
        total: this.stats.total,
        processed: this.stats.processed,
        failed: this.stats.failed,
        duration: this.stats.endTime - this.stats.startTime
      },
      shards: this.shards.map(s => ({
        id: s.id,
        status: s.status,
        progress: s.progress,
        processed: s.processedCount,
        errors: s.errorCount,
        duration: s.endTime - s.startTime
      })),
      failedProfiles: this.shards.flatMap(s => s.errors),
      checkpoints: this.config.checkpointDir
    };
  }

  /**
   * 유틸리티 함수들
   */
  async ensureCheckpointDirectory() {
    try {
      await fs.mkdir(this.config.checkpointDir, { recursive: true });
    } catch (error) {
      // 디렉토리가 이미 존재하면 무시
    }
  }

  calculateOverallProgress() {
    if (this.shards.length === 0) return 0;
    const totalProgress = this.shards.reduce((sum, s) => sum + s.progress, 0);
    return totalProgress / this.shards.length;
  }

  createProgressBar(percentage) {
    const length = 30;
    const filled = Math.floor(length * percentage / 100);
    return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(length - filled));
  }

  getStatusIcon(status) {
    const icons = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      failed: '❌',
      retrying: '🔁'
    };
    return icons[status] || '❓';
  }

  formatTime(seconds) {
    if (seconds < 60) return `${seconds.toFixed(1)}초`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}분`;
    return `${(seconds / 3600).toFixed(1)}시간`;
  }

  handleWorkerMessage(shard, message) {
    switch (message.type) {
      case 'PROGRESS':
        shard.progress = message.progress;
        shard.processedCount = message.processedCount;
        break;
      case 'ERROR':
        shard.errors.push(message.error);
        shard.errorCount++;
        break;
      case 'CHECKPOINT':
        this.log(`💾 [${shard.id}] Worker checkpoint saved`, 'debug');
        break;
      case 'COMPLETE':
        shard.status = 'completed';
        this.completedShards.add(shard.id);
        break;
    }
  }

  log(message, level = 'info') {
    if (!this.config.debug && level === 'debug') return;

    const colors = {
      info: chalk.blue,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      debug: chalk.gray
    };

    const color = colors[level] || chalk.white;
    console.log(color(message));
  }
}

module.exports = DefensiveShardProcessor;