/**
 * 대량 재개 최적화 워크플로우
 * 병렬 처리를 통한 성능 최적화
 */

const chalk = require('chalk');
const ora = require('ora');
const pLimit = require('p-limit');
const EventEmitter = require('events');

class BatchResumeOptimizedUseCase extends EventEmitter {
  constructor({
    adsPowerAdapter,
    resumeUseCase,
    sheetsRepository,
    logger
  }) {
    super();
    this.adsPowerAdapter = adsPowerAdapter;
    this.resumeUseCase = resumeUseCase;
    this.sheetsRepository = sheetsRepository;
    this.logger = logger || console;
    
    // 처리 상태
    this.stats = {
      total: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      startTime: null,
      endTime: null
    };
    
    // 결과 저장
    this.results = {
      success: [],
      failed: [],
      skipped: [],
      alreadyActive: []  // 이미 활성 상태로 판단된 계정들
    };
  }

  /**
   * 배치 재개 실행
   */
  async execute(tasks, options = {}) {
    const {
      concurrency = 1,        // 동시 실행 수 (기본 1개 - 순차 처리)
      batchSize = 10,         // 배치 크기
      retryEnabled = true,    // 재시도 활성화
      retryLimit = 1,         // 재시도 횟수
      delayBetweenBatches = 5000, // 배치 간 대기 시간
      delayBetweenTasks = 3000,   // 각 작업 간 대기 시간 (밀리초)
      progressCallback = null, // 진행 상황 콜백
      autoSkipOnTimeout = true,  // 타임아웃 시 자동 건너뛰기
      taskTimeout = 5 * 60 * 1000 // 작업별 타임아웃 (5분)
    } = options;
    
    this.stats.total = tasks.length;
    this.stats.startTime = Date.now();
    
    console.log(chalk.cyan('\n🚀 대량 재개 최적화 워크플로우 시작'));
    console.log(chalk.yellow(`📊 설정:`));
    console.log(chalk.gray(`  • 총 계정 수: ${tasks.length}개`));
    console.log(chalk.gray(`  • 동시 실행: ${concurrency}개`));
    console.log(chalk.gray(`  • 배치 크기: ${batchSize}개`));
    console.log(chalk.gray(`  • 작업 간 대기: ${delayBetweenTasks/1000}초`));
    console.log(chalk.gray(`  • 배치 간 대기: ${delayBetweenBatches/1000}초`));
    console.log(chalk.gray(`  • 재시도: ${retryEnabled ? `활성화 (${retryLimit}회)` : '비활성화'}`));
    console.log();
    
    // 작업을 배치로 분할
    const batches = this.createBatches(tasks, batchSize);
    console.log(chalk.blue(`📦 ${batches.length}개 배치로 분할됨\n`));
    
    // 병렬 처리 제한 설정
    const limit = pLimit(concurrency);
    
    // 각 배치 처리
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const batchNum = batchIndex + 1;
      
      console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.cyan(`📦 배치 ${batchNum}/${batches.length} 처리 시작 (${batch.length}개 계정)`));
      console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
      
      // 배치 내 작업들을 처리 (시간 간격 포함)
      const batchPromises = batch.map((task, index) => 
        limit(async () => {
          // 첫 번째 작업이 아니면 대기
          if (index > 0 && concurrency === 1) {
            console.log(chalk.gray(`⏳ ${delayBetweenTasks/1000}초 대기 중...`));
            await new Promise(resolve => setTimeout(resolve, delayBetweenTasks));
          }
          
          return this.processTask(task, {
            retryLimit,
            batchNum,
            taskIndex: index + 1,
            batchSize: batch.length
          });
        })
      );
      
      // 배치 완료 대기
      await Promise.allSettled(batchPromises);
      
      // 진행 상황 업데이트
      this.updateProgress(progressCallback);
      
      // 다음 배치 전 대기 (마지막 배치 제외)
      if (batchIndex < batches.length - 1) {
        console.log(chalk.gray(`\n⏳ 다음 배치까지 ${delayBetweenBatches/1000}초 대기...\n`));
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
    
    // 재시도 처리
    if (retryEnabled && this.results.failed.length > 0) {
      await this.retryFailedTasks(concurrency, retryLimit, delayBetweenTasks);
    }

    // "이미 활성 상태" 계정들 재확인 (모든 작업 완료 후)
    if (this.results.alreadyActive.length > 0) {
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan('🔍 "이미 활성 상태" 계정 재확인'));
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

      await this.recheckAlreadyActiveTasks(concurrency, delayBetweenTasks);
    }

    // 최종 결과
    this.stats.endTime = Date.now();
    this.displayFinalResults();

    return {
      stats: this.stats,
      results: this.results,
      duration: (this.stats.endTime - this.stats.startTime) / 1000
    };
  }

  /**
   * 개별 작업 처리
   */
  async processTask(task, options = {}) {
    const { retryLimit, batchNum, taskIndex, batchSize } = options;
    const taskId = `${task.googleId} (${task.adsPowerId})`;
    
    // 작업별 타임아웃 설정 (5분)
    const TASK_TIMEOUT = 5 * 60 * 1000;
    
    try {
      this.stats.processing++;
      
      // 진행 상황 표시
      const progress = `[${taskIndex}/${batchSize}]`;
      console.log(chalk.blue(`${progress} 🔄 처리 중: ${taskId}`));
      
      // 이미 활성 상태인 계정 스킵
      if (task.status === '결제중' || task.status === '활성' || task.status === 'active') {
        console.log(chalk.gray(`${progress} ⏭️  스킵: ${taskId} (이미 활성 상태)`));
        this.stats.skipped++;
        this.results.skipped.push(task);
        return { status: 'skipped', task };
      }
      
      // 재개 실행 (타임아웃 적용)
      const startTime = Date.now();
      
      // 타임아웃 타이머 ID 저장
      let timeoutId = null;
      let isTimedOut = false;

      // 타임아웃 Promise 생성 (브라우저 강제 종료 포함)
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(async () => {
          isTimedOut = true;
          console.log(chalk.red(`⏱️ 워크플로우 타임아웃 - 브라우저 강제 종료 중...`));

          // 브라우저 강제 종료 시도
          try {
            await this.adsPowerAdapter.closeBrowser(task.adsPowerId);
            console.log(chalk.yellow(`    └─ 브라우저 강제 종료 완료`));
          } catch (closeErr) {
            console.log(chalk.gray(`    └─ 브라우저 종료 실패 (이미 종료됨): ${closeErr.message}`));
          }

          reject(new Error('WORKFLOW_TIMEOUT'));
        }, TASK_TIMEOUT);
      });

      // 재개 실행 Promise
      const resumePromise = this.resumeUseCase.execute(task.adsPowerId, {
        profileData: {
          email: task.googleId,
          password: task.password,
          recoveryEmail: task.recoveryEmail,
          code: task.code,
          googleId: task.googleId
        },
        debugMode: false,
        forceTimeout: TASK_TIMEOUT // 타임아웃 정보 전달
      });

      // 타임아웃과 실행 중 먼저 완료되는 것 처리
      let result;
      try {
        result = await Promise.race([resumePromise, timeoutPromise]);

        // 성공 시 타임아웃 타이머 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      } catch (raceError) {
        // 타임아웃 에러인 경우 타이머 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        throw raceError;
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      // 이미 활성 상태로 판단된 경우 별도 처리
      if (result.status === 'already_active' || result.alreadyActive) {
        console.log(chalk.yellow(`${progress} ⚠️ 이미 활성 상태: ${taskId} (${duration}초)`));
        console.log(chalk.gray(`    └─ 추후 재확인 필요`));

        this.stats.completed++;  // 일단 완료로 처리
        this.results.alreadyActive.push({
          ...task,
          result,
          duration,
          needsRecheck: true  // 재확인 필요 표시
        });

        // Google Sheets 업데이트
        this.updateSheets(task, result).catch(err =>
          console.log(chalk.yellow(`    └─ ⚠️  Sheets 업데이트 실패: ${err.message}`))
        );

        return { status: 'already_active', task, result };
      } else if (result.success) {
        console.log(chalk.green(`${progress} ✅ 성공: ${taskId} (${duration}초)`));
        if (result.nextBillingDate) {
          console.log(chalk.gray(`    └─ 다음 결제일: ${result.nextBillingDate}`));
        }

        this.stats.completed++;
        this.results.success.push({
          ...task,
          result,
          duration
        });

        // Google Sheets 업데이트 (비동기)
        this.updateSheets(task, result).catch(err =>
          console.log(chalk.yellow(`    └─ ⚠️  Sheets 업데이트 실패: ${err.message}`))
        );

        return { status: 'success', task, result };
      } else if (result.shouldRetry && (task.captchaRetryCount || 0) < 1) {
        // ★ 이미지 CAPTCHA로 인한 실패 - 1회 재시도
        console.log(chalk.yellow(`${progress} 🖼️ CAPTCHA 감지 - 재시도 중: ${taskId}`));
        task.captchaRetryCount = (task.captchaRetryCount || 0) + 1;

        // 타임아웃 타이머 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // 브라우저 세션 정리 대기
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 재시도 실행
        const retryResult = await this.resumeUseCase.execute(task.adsPowerId, {
          profileData: {
            email: task.googleId,
            password: task.password,
            recoveryEmail: task.recoveryEmail,
            code: task.code,
            googleId: task.googleId
          },
          debugMode: false
        });

        const retryDuration = ((Date.now() - startTime) / 1000).toFixed(1);

        if (retryResult.success) {
          console.log(chalk.green(`${progress} ✅ 재시도 성공: ${taskId} (${retryDuration}초)`));
          this.stats.completed++;
          this.results.success.push({
            ...task,
            result: retryResult,
            duration: retryDuration,
            retriedDueToCaptcha: true
          });
          return { status: 'success', task, result: retryResult };
        } else {
          // 재시도도 실패 - 다음 계정으로
          console.log(chalk.red(`${progress} ❌ 재시도도 실패: ${taskId}`));
          throw new Error(retryResult.error || 'CAPTCHA 재시도 후에도 실패');
        }
      } else if (result.shouldRetry) {
        // 이미 재시도 했으나 또 CAPTCHA - 다음 계정으로
        console.log(chalk.red(`${progress} ❌ CAPTCHA 재시도 후에도 실패 - 건너뜀: ${taskId}`));
        throw new Error('CAPTCHA 재시도 실패');
      } else {
        throw new Error(result.error || '재개 실패');
      }
      
    } catch (error) {
      const progress = `[${taskIndex}/${batchSize}]`;
      
      // 타임아웃 에러 확인
      const isTimeout = error.message === 'WORKFLOW_TIMEOUT';
      
      // 계정 잠김 에러 확인
      const isAccountLocked = error.isAccountLocked || 
                             error.message === 'ACCOUNT_LOCKED' ||
                             error.message?.includes('계정 잠김') ||
                             error.message?.includes('Account disabled');
      
      // reCAPTCHA 에러 확인
      const isRecaptcha = error.isRecaptcha || 
                         error.message === 'RECAPTCHA_DETECTED' ||
                         error.message?.includes('reCAPTCHA');
      
      if (isTimeout) {
        console.log(chalk.red(`${progress} ⏱️ 타임아웃: ${taskId}`));
        console.log(chalk.yellow(`    └─ 5분 초과로 자동 건너뜀, 다음 계정 진행`));
        
        this.stats.failed++;
        this.results.failed.push({
          ...task,
          error: '타임아웃 - 5분 초과',
          retryCount: 999,  // 재시도 방지
          skipRetry: true,
          timeout: true
        });
        
        // 타임아웃 시 브라우저 정리 시도
        try {
          if (task.adsPowerId) {
            await this.adsPowerAdapter.closeBrowser(task.adsPowerId);
          }
        } catch (e) {
          // 무시
        }
      } else if (isAccountLocked) {
        console.log(chalk.red(`${progress} 🔒 계정 잠김: ${taskId}`));
        console.log(chalk.red(`    └─ 수동 복구가 필요합니다`));
        
        // 계정 잠김은 재시도하지 않도록 표시
        this.stats.failed++;
        this.results.failed.push({
          ...task,
          error: '계정 잠김 - 수동 복구 필요',
          retryCount: 999,  // 재시도 제한 초과로 설정하여 재시도 방지
          skipRetry: true,   // 명시적으로 재시도 방지
          accountLocked: true
        });
      } else if (isRecaptcha) {
        console.log(chalk.yellow(`${progress} 🛑 reCAPTCHA: ${taskId}`));
        console.log(chalk.yellow(`    └─ 자동으로 다음 계정 진행`));
        
        this.stats.failed++;
        this.results.failed.push({
          ...task,
          error: 'reCAPTCHA 감지됨',
          retryCount: 999,
          skipRetry: true,
          recaptcha: true
        });
      } else {
        console.log(chalk.red(`${progress} ❌ 실패: ${taskId}`));
        console.log(chalk.red(`    └─ 오류: ${error.message}`));
        
        this.stats.failed++;
        this.results.failed.push({
          ...task,
          error: error.message,
          retryCount: task.retryCount || 0
        });
      }
      
      return { status: 'failed', task, error: error.message };
    } finally {
      this.stats.processing--;
    }
  }

  /**
   * 실패한 작업 재시도
   */
  async retryFailedTasks(concurrency, retryLimit, delayBetweenTasks = 3000) {
    const retryableTasks = this.results.failed.filter(
      task => (task.retryCount || 0) < retryLimit && 
              !task.skipRetry &&  // 재시도 방지 플래그 확인
              !task.accountLocked  // 계정 잠김 제외
    );
    
    if (retryableTasks.length === 0) return;
    
    console.log(chalk.yellow(`\n🔄 ${retryableTasks.length}개 실패 계정 재시도 중...\n`));
    
    const limit = pLimit(concurrency);
    const retryPromises = retryableTasks.map((task, index) => 
      limit(async () => {
        // 첫 번째 작업이 아니면 대기
        if (index > 0 && concurrency === 1) {
          console.log(chalk.gray(`⏳ ${delayBetweenTasks/1000}초 대기 중...`));
          await new Promise(resolve => setTimeout(resolve, delayBetweenTasks));
        }
        
        task.retryCount = (task.retryCount || 0) + 1;
        
        // 실패 목록에서 제거
        this.results.failed = this.results.failed.filter(
          f => f.googleId !== task.googleId
        );
        this.stats.failed--;
        
        // 재시도
        return this.processTask(task, {
          retryLimit: 0, // 추가 재시도 방지
          batchNum: 'Retry',
          taskIndex: retryableTasks.indexOf(task) + 1,
          batchSize: retryableTasks.length
        });
      })
    );
    
    await Promise.allSettled(retryPromises);
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
   * 진행 상황 업데이트
   */
  updateProgress(callback) {
    const progress = {
      total: this.stats.total,
      completed: this.stats.completed,
      failed: this.stats.failed,
      skipped: this.stats.skipped,
      processing: this.stats.processing,
      percentage: Math.round((this.stats.completed + this.stats.failed + this.stats.skipped) / this.stats.total * 100),
      elapsedTime: (Date.now() - this.stats.startTime) / 1000
    };
    
    // 진행률 표시
    const progressBar = this.createProgressBar(progress.percentage);
    console.log(chalk.cyan(`\n진행률: ${progressBar} ${progress.percentage}%`));
    console.log(chalk.gray(`완료: ${progress.completed} | 실패: ${progress.failed} | 스킵: ${progress.skipped} | 처리중: ${progress.processing}`));
    
    // 콜백 실행
    if (callback) {
      callback(progress);
    }
    
    // 이벤트 발생
    this.emit('progress', progress);
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
   * Google Sheets 업데이트
   */
  async updateSheets(task, result) {
    if (!this.sheetsRepository) return;
    
    try {
      // 날짜 형식 변환 (2025. 8. 19 형태)
      let formattedDate = null;
      if (result.nextBillingDate) {
        const date = new Date(result.nextBillingDate);
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const day = date.getDate();
          formattedDate = `${year}. ${month}. ${day}`;
        } else {
          // 이미 올바른 형식일 수 있음
          formattedDate = result.nextBillingDate;
        }
      }
      
      // 상태를 '결제중'으로 설정
      await this.sheetsRepository.updateResumeResult(
        task.rowIndex,
        `✅ 성공 (${new Date().toLocaleTimeString('ko-KR')})`,
        '결제중',
        formattedDate
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * "이미 활성 상태" 계정들 재확인 (1회만)
   */
  async recheckAlreadyActiveTasks(concurrency, delayBetweenTasks = 3000) {
    const tasksToRecheck = this.results.alreadyActive;

    if (tasksToRecheck.length === 0) return;

    console.log(chalk.yellow(`📋 ${tasksToRecheck.length}개 계정 재확인 시작 (1회만 재시도)\n`));

    const limit = pLimit(concurrency);
    const recheckPromises = tasksToRecheck.map((task, index) =>
      limit(async () => {
        // 첫 번째 작업이 아니면 대기
        if (index > 0 && concurrency === 1) {
          console.log(chalk.gray(`⏳ ${delayBetweenTasks/1000}초 대기 중...`));
          await new Promise(resolve => setTimeout(resolve, delayBetweenTasks));
        }

        const taskId = `${task.googleId} (${task.adsPowerId})`;
        console.log(chalk.blue(`[${index + 1}/${tasksToRecheck.length}] 🔍 재확인: ${taskId}`));

        try {
          // 재확인을 위한 flag 설정
          const recheckResult = await this.resumeUseCase.execute(task.adsPowerId, {
            profileData: {
              email: task.googleId,
              password: task.password,
              recoveryEmail: task.recoveryEmail,
              code: task.code,
              googleId: task.googleId
            },
            debugMode: false,
            isRecheck: true,  // 재확인임을 표시
            forceRecheck: true // 강제 재확인 모드
          });

          const duration = task.duration || 0;

          // 재확인 결과 처리
          if (recheckResult.status === 'already_active' || recheckResult.alreadyActive) {
            // 여전히 활성 상태
            console.log(chalk.green(`    ✅ 확인됨: 정말로 활성 상태`));
            // alreadyActive 목록에서 제거하고 success로 이동
            this.results.alreadyActive = this.results.alreadyActive.filter(
              t => t.googleId !== task.googleId
            );
            this.results.success.push({
              ...task,
              result: recheckResult,
              recheckConfirmed: true
            });
          } else if (recheckResult.success) {
            // False Positive였음 - 실제로 재개가 필요했고 성공함
            console.log(chalk.green(`    ✅ False Positive 수정: 재개 성공!`));
            if (recheckResult.nextBillingDate) {
              console.log(chalk.gray(`    └─ 다음 결제일: ${recheckResult.nextBillingDate}`));
            }

            // alreadyActive에서 제거하고 success로 이동
            this.results.alreadyActive = this.results.alreadyActive.filter(
              t => t.googleId !== task.googleId
            );
            this.results.success.push({
              ...task,
              result: recheckResult,
              wassFalsePositive: true
            });

            // Sheets 업데이트
            this.updateSheets(task, recheckResult).catch(err =>
              console.log(chalk.yellow(`    └─ ⚠️  Sheets 업데이트 실패: ${err.message}`))
            );
          } else {
            // 재확인 실패
            console.log(chalk.red(`    ❌ 재확인 실패: ${recheckResult.error}`));
            // alreadyActive에서 제거하고 failed로 이동
            this.results.alreadyActive = this.results.alreadyActive.filter(
              t => t.googleId !== task.googleId
            );
            this.results.failed.push({
              ...task,
              error: recheckResult.error || '재확인 실패',
              recheckFailed: true
            });
          }
        } catch (error) {
          console.log(chalk.red(`    ❌ 재확인 오류: ${error.message}`));
          // 오류 발생 시 failed로 이동
          this.results.alreadyActive = this.results.alreadyActive.filter(
            t => t.googleId !== task.googleId
          );
          this.results.failed.push({
            ...task,
            error: error.message,
            recheckError: true
          });
        }
      })
    );

    await Promise.allSettled(recheckPromises);

    console.log(chalk.green('\n✅ 재확인 완료\n'));
  }

  /**
   * 최종 결과 표시
   */
  displayFinalResults() {
    const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(1);
    const avgTime = (duration / this.stats.total).toFixed(1);
    
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('📊 최종 처리 결과'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    
    console.log(chalk.green(`✅ 성공: ${this.stats.completed}개`));
    console.log(chalk.red(`❌ 실패: ${this.stats.failed}개`));
    console.log(chalk.gray(`⏭️  스킵: ${this.stats.skipped}개`));

    // False Positive 수정된 계정 표시
    const falsePositives = this.results.success.filter(t => t.wasFalsePositive);
    if (falsePositives.length > 0) {
      console.log(chalk.yellow(`🔍 False Positive 수정: ${falsePositives.length}개`));
    }

    console.log(chalk.blue(`⏱️  총 소요 시간: ${duration}초`));
    console.log(chalk.blue(`⚡ 평균 처리 시간: ${avgTime}초/계정`));
    
    // 실패 목록 표시
    if (this.results.failed.length > 0) {
      // 계정 잠김과 일반 실패 구분
      const lockedAccounts = this.results.failed.filter(t => t.accountLocked);
      const normalFailures = this.results.failed.filter(t => !t.accountLocked);
      
      if (lockedAccounts.length > 0) {
        console.log(chalk.red('\n🔒 계정 잠김 (수동 복구 필요):'));
        lockedAccounts.forEach(task => {
          console.log(chalk.red(`  • ${task.googleId}: 계정이 Google에 의해 비활성화됨`));
        });
      }
      
      if (normalFailures.length > 0) {
        console.log(chalk.red('\n❌ 실패 계정:'));
        normalFailures.forEach(task => {
          console.log(chalk.red(`  • ${task.googleId}: ${task.error}`));
        });
      }
    }
  }
}

module.exports = BatchResumeOptimizedUseCase;