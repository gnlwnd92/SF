/**
 * ParallelBatchProcessor - 병렬 배치 처리 시스템
 * 
 * Day 9: 여러 계정을 동시에 처리하는 고성능 배치 프로세서
 * - 동시 실행 수 제어
 * - 에러 격리 및 복구
 * - 실시간 진행률 추적
 */

const chalk = require('chalk');
const EventEmitter = require('events');
const pLimit = require('p-limit');

class ParallelBatchProcessor extends EventEmitter {
  constructor({
    maxConcurrency = 5,
    retryAttempts = 3,
    retryDelay = 5000,
    debugMode = false
  } = {}) {
    super();
    
    this.maxConcurrency = maxConcurrency;
    this.retryAttempts = retryAttempts;
    this.retryDelay = retryDelay;
    this.debugMode = debugMode;
    
    // 처리 상태 추적
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      startTime: null,
      endTime: null
    };
    
    // 실행 중인 작업 추적
    this.activeTasks = new Map();
    
    // 결과 저장
    this.results = [];
    
    // 동시 실행 제한
    this.limit = pLimit(maxConcurrency);
  }

  /**
   * 배치 작업 실행
   */
  async processBatch(items, processorFunction) {
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold('🚀 병렬 배치 처리 시작'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    
    // 통계 초기화
    this.stats = {
      total: items.length,
      completed: 0,
      failed: 0,
      inProgress: 0,
      startTime: Date.now(),
      endTime: null
    };
    
    console.log(chalk.gray(`📊 전체 작업: ${items.length}개`));
    console.log(chalk.gray(`⚡ 최대 동시 실행: ${this.maxConcurrency}개`));
    console.log(chalk.gray(`🔄 재시도 횟수: ${this.retryAttempts}회\n`));
    
    // 진행률 표시 시작
    this.startProgressMonitor();
    
    try {
      // 병렬 처리 실행
      const promises = items.map((item, index) => 
        this.limit(() => this.processWithRetry(item, index, processorFunction))
      );
      
      // 모든 작업 완료 대기
      this.results = await Promise.allSettled(promises);
      
      // 통계 업데이트
      this.stats.endTime = Date.now();
      
      // 결과 분석
      this.analyzeResults();
      
      // 최종 리포트
      this.generateReport();
      
      return {
        success: this.stats.failed === 0,
        results: this.results,
        stats: this.stats
      };
      
    } catch (error) {
      console.error(chalk.red('\n❌ 배치 처리 오류:'), error);
      throw error;
      
    } finally {
      this.stopProgressMonitor();
    }
  }

  /**
   * 재시도 로직이 포함된 단일 작업 처리
   */
  async processWithRetry(item, index, processorFunction) {
    const taskId = `task_${index}_${Date.now()}`;
    
    // 작업 시작 알림
    this.emit('taskStart', { taskId, item, index });
    this.activeTasks.set(taskId, { item, index, startTime: Date.now() });
    this.stats.inProgress++;
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        if (this.debugMode) {
          console.log(chalk.gray(`\n🔄 작업 ${index + 1} 시작 (시도 ${attempt}/${this.retryAttempts})...`));
        }
        
        // 실제 처리 실행
        const result = await processorFunction(item, index);
        
        // 성공
        this.stats.completed++;
        this.stats.inProgress--;
        this.activeTasks.delete(taskId);
        
        this.emit('taskComplete', { taskId, item, index, result });
        
        console.log(chalk.green(`✅ 작업 ${index + 1} 완료`));
        
        return { status: 'fulfilled', value: result, item, index };
        
      } catch (error) {
        lastError = error;
        
        console.error(chalk.yellow(`⚠️ 작업 ${index + 1} 실패 (시도 ${attempt}/${this.retryAttempts}): ${error.message}`));
        
        // 재시도 전 대기
        if (attempt < this.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }
    
    // 모든 시도 실패
    this.stats.failed++;
    this.stats.inProgress--;
    this.activeTasks.delete(taskId);
    
    this.emit('taskFailed', { taskId, item, index, error: lastError });
    
    console.error(chalk.red(`❌ 작업 ${index + 1} 최종 실패`));
    
    return { status: 'rejected', reason: lastError, item, index };
  }

  /**
   * 진행률 모니터 시작
   */
  startProgressMonitor() {
    this.progressInterval = setInterval(() => {
      this.displayProgress();
    }, 2000); // 2초마다 업데이트
  }

  /**
   * 진행률 모니터 중지
   */
  stopProgressMonitor() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * 진행률 표시
   */
  displayProgress() {
    const { total, completed, failed, inProgress } = this.stats;
    const progress = total > 0 ? ((completed + failed) / total * 100).toFixed(1) : 0;
    const elapsedTime = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
    
    // 진행률 바
    const barLength = 30;
    const filledLength = Math.floor(barLength * progress / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    
    // ANSI 이스케이프 코드로 같은 줄 업데이트
    process.stdout.write(`\r${chalk.cyan('진행률:')} ${bar} ${progress}% | `);
    process.stdout.write(chalk.green(`완료: ${completed} `));
    process.stdout.write(chalk.red(`실패: ${failed} `));
    process.stdout.write(chalk.yellow(`진행중: ${inProgress} `));
    process.stdout.write(chalk.gray(`(${elapsedTime}초)`));
  }

  /**
   * 결과 분석
   */
  analyzeResults() {
    this.results.forEach(result => {
      if (result.status === 'fulfilled') {
        this.emit('itemSuccess', result);
      } else {
        this.emit('itemFailure', result);
      }
    });
  }

  /**
   * 최종 리포트 생성
   */
  generateReport() {
    const { total, completed, failed, startTime, endTime } = this.stats;
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    const avgTimePerItem = total > 0 ? (duration / total).toFixed(2) : 0;
    
    console.log(chalk.cyan('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold('📊 배치 처리 최종 리포트'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    
    console.log(chalk.yellow('📈 처리 결과:'));
    console.log(chalk.green(`  ✅ 성공: ${completed}개 (${successRate}%)`));
    console.log(chalk.red(`  ❌ 실패: ${failed}개`));
    console.log(chalk.cyan(`  📊 전체: ${total}개\n`));
    
    console.log(chalk.yellow('⏱️ 성능 지표:'));
    console.log(chalk.gray(`  총 소요시간: ${duration}초`));
    console.log(chalk.gray(`  평균 처리시간: ${avgTimePerItem}초/개`));
    console.log(chalk.gray(`  처리 속도: ${(total / (duration || 1)).toFixed(1)}개/초\n`));
    
    // 평가
    let grade = '미흡';
    if (successRate >= 95) grade = '우수';
    else if (successRate >= 80) grade = '양호';
    else if (successRate >= 60) grade = '보통';
    
    console.log(chalk.yellow(`🏆 종합 평가: ${grade}`));
    
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  }

  /**
   * 실행 중인 작업 목록 반환
   */
  getActiveTasks() {
    return Array.from(this.activeTasks.values());
  }

  /**
   * 특정 작업 취소
   */
  cancelTask(taskId) {
    if (this.activeTasks.has(taskId)) {
      this.activeTasks.delete(taskId);
      this.emit('taskCancelled', { taskId });
      return true;
    }
    return false;
  }

  /**
   * 모든 작업 취소
   */
  cancelAll() {
    const cancelled = this.activeTasks.size;
    this.activeTasks.clear();
    this.emit('allTasksCancelled', { count: cancelled });
    return cancelled;
  }

  /**
   * 통계 리셋
   */
  resetStats() {
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      inProgress: 0,
      startTime: null,
      endTime: null
    };
    this.results = [];
    this.activeTasks.clear();
  }
}

module.exports = ParallelBatchProcessor;