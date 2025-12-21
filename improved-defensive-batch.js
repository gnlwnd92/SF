#!/usr/bin/env node
/**
 * 개선된 방어적 배치 처리 시스템
 * 배치 크기 선택, 진행 상황 표시, 실시간 컨트롤 기능 포함
 */

require('dotenv').config();
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const ora = require('ora');
const { EventEmitter } = require('events');

class ImprovedDefensiveBatch extends EventEmitter {
  constructor() {
    super();
    this.stats = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      currentBatch: 0,
      totalBatches: 0
    };
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = null;
    this.currentTasks = [];
    this.progressInterval = null;
  }

  /**
   * 배치 설정 대화형 선택
   */
  async configureBatch(mode) {
    console.clear();
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║        🛡️  개선된 방어적 배치 처리 시스템                ║
║                                                          ║
║    배치 크기, 속도, 안정성을 모두 제어할 수 있습니다     ║
╚══════════════════════════════════════════════════════════╝
    `));

    console.log(chalk.yellow(`\n작업 모드: ${mode === 'pause' ? '🔄 일시중지' : '▶️  재개'}\n`));

    // 프리셋 표시
    const presetTable = new Table({
      head: [
        chalk.yellow('프리셋'),
        chalk.yellow('배치'),
        chalk.yellow('동시실행'),
        chalk.yellow('재시도'),
        chalk.yellow('대기시간'),
        chalk.yellow('예상속도')
      ],
      colWidths: [18, 10, 12, 10, 12, 15]
    });

    presetTable.push(
      ['🛡️ 방어적 (안전)', '3개', '1개', '2회', '10초', '20/시간'],
      ['⚖️ 균형', '5개', '2개', '1회', '5초', '60/시간'],
      ['⚡ 공격적 (빠름)', '10개', '3개', '0회', '2초', '150/시간'],
      ['🎯 사용자정의', '?', '?', '?', '?', '직접설정']
    );

    console.log(presetTable.toString());

    // 프리셋 선택
    const { preset } = await inquirer.prompt([
      {
        type: 'list',
        name: 'preset',
        message: '배치 프리셋을 선택하세요:',
        choices: [
          { name: '🛡️ 방어적 - 가장 안전하지만 느림', value: 'defensive' },
          { name: '⚖️ 균형 - 적당한 속도와 안정성', value: 'balanced' },
          { name: '⚡ 공격적 - 빠르지만 위험할 수 있음', value: 'aggressive' },
          { name: '🎯 사용자정의 - 직접 설정', value: 'custom' }
        ]
      }
    ]);

    let config;
    if (preset === 'custom') {
      config = await this.customConfig();
    } else {
      config = this.getPresetConfig(preset);
    }

    // 설정 확인
    await this.showConfigSummary(config);

    return config;
  }

  /**
   * 사용자 정의 설정
   */
  async customConfig() {
    const answers = await inquirer.prompt([
      {
        type: 'number',
        name: 'batchSize',
        message: '배치 크기 (한 번에 처리할 작업 수):',
        default: 5,
        validate: (v) => v >= 1 && v <= 20
      },
      {
        type: 'number',
        name: 'concurrency',
        message: '동시 실행 브라우저 수:',
        default: 2,
        validate: (v) => v >= 1 && v <= 5
      },
      {
        type: 'number',
        name: 'retryLimit',
        message: '실패시 재시도 횟수:',
        default: 1,
        validate: (v) => v >= 0 && v <= 3
      },
      {
        type: 'number',
        name: 'delayBetweenTasks',
        message: '작업 간 대기시간 (초):',
        default: 5,
        validate: (v) => v >= 1 && v <= 30
      },
      {
        type: 'number',
        name: 'delayBetweenBatches',
        message: '배치 간 대기시간 (초):',
        default: 10,
        validate: (v) => v >= 5 && v <= 60
      }
    ]);

    // 초 단위를 밀리초로 변환
    answers.delayBetweenTasks *= 1000;
    answers.delayBetweenBatches *= 1000;
    answers.retryEnabled = answers.retryLimit > 0;

    return answers;
  }

  /**
   * 프리셋 설정 가져오기
   */
  getPresetConfig(preset) {
    const configs = {
      defensive: {
        batchSize: 3,
        concurrency: 1,
        retryEnabled: true,
        retryLimit: 2,
        delayBetweenTasks: 10000,
        delayBetweenBatches: 15000
      },
      balanced: {
        batchSize: 5,
        concurrency: 2,
        retryEnabled: true,
        retryLimit: 1,
        delayBetweenTasks: 5000,
        delayBetweenBatches: 10000
      },
      aggressive: {
        batchSize: 10,
        concurrency: 3,
        retryEnabled: false,
        retryLimit: 0,
        delayBetweenTasks: 2000,
        delayBetweenBatches: 5000
      }
    };

    return configs[preset];
  }

  /**
   * 설정 요약 표시
   */
  async showConfigSummary(config) {
    console.clear();
    console.log(chalk.cyan.bold('\n📊 배치 설정 확인\n'));

    const configTable = new Table({
      colWidths: [25, 35]
    });

    const tasksPerHour = Math.floor(3600000 / (config.delayBetweenTasks + 30000));
    const estimatedSpeed = tasksPerHour * (config.concurrency / 2); // 동시실행 고려

    configTable.push(
      [chalk.yellow('배치 크기'), `${config.batchSize}개씩 처리`],
      [chalk.yellow('동시 실행'), `${config.concurrency}개 브라우저`],
      [chalk.yellow('재시도'), config.retryEnabled ? `최대 ${config.retryLimit}회` : '없음'],
      [chalk.yellow('작업 간격'), `${config.delayBetweenTasks / 1000}초`],
      [chalk.yellow('배치 간격'), `${config.delayBetweenBatches / 1000}초`],
      [chalk.green('예상 속도'), `약 ${estimatedSpeed}개/시간`]
    );

    console.log(configTable.toString());

    // 시각적 표현
    console.log(chalk.cyan('\n처리 방식 예시:'));
    this.showBatchVisualization(config);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '이 설정으로 진행하시겠습니까?',
        default: true
      }
    ]);

    if (!confirm) {
      process.exit(0);
    }
  }

  /**
   * 배치 처리 시각화
   */
  showBatchVisualization(config) {
    const batchVis = '📄 '.repeat(Math.min(config.batchSize, 10));
    const extra = config.batchSize > 10 ? ` +${config.batchSize - 10}개` : '';

    console.log(chalk.gray(`\n배치 #1: ${batchVis}${extra}`));

    if (config.concurrency > 1) {
      console.log(chalk.gray(`         ↓ ${config.concurrency}개 동시 실행`));
    } else {
      console.log(chalk.gray(`         ↓ 순차 실행`));
    }

    console.log(chalk.gray(`         ⏱️  ${config.delayBetweenBatches / 1000}초 대기`));
    console.log(chalk.gray(`배치 #2: ${batchVis}${extra}`));
  }

  /**
   * 실시간 진행 상황 대시보드
   */
  showProgressDashboard() {
    // 화면 지우지 않고 업데이트
    console.log('\x1B[2J\x1B[0f'); // 화면 클리어 및 커서 홈

    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║              🛡️  방어적 배치 처리 진행 상황              ║
╚══════════════════════════════════════════════════════════╝
    `));

    // 전체 진행률
    const percentage = this.stats.total > 0 ?
      Math.round((this.stats.processed / this.stats.total) * 100) : 0;
    const barLength = 40;
    const filledLength = Math.floor((percentage / 100) * barLength);
    const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    console.log(chalk.yellow('전체 진행:'));
    console.log(`[${progressBar}] ${percentage}%`);
    console.log(chalk.gray(`${this.stats.processed} / ${this.stats.total} 완료\n`));

    // 배치 정보
    console.log(chalk.cyan(`현재 배치: #${this.stats.currentBatch} / ${this.stats.totalBatches}`));

    // 통계 테이블
    const statsTable = new Table({
      head: [
        chalk.green('✅ 성공'),
        chalk.red('❌ 실패'),
        chalk.yellow('⏭️ 스킵'),
        chalk.blue('⏱️ 경과'),
        chalk.cyan('📊 속도')
      ],
      colWidths: [12, 12, 12, 15, 15]
    });

    const elapsed = this.startTime ?
      Math.floor((Date.now() - this.startTime) / 1000) : 0;
    const speed = elapsed > 0 ?
      (this.stats.processed / elapsed * 60).toFixed(1) : 0;

    statsTable.push([
      this.stats.success,
      this.stats.failed,
      this.stats.skipped,
      `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`,
      `${speed}/분`
    ]);

    console.log(statsTable.toString());

    // 현재 처리 중인 작업
    if (this.currentTasks.length > 0) {
      console.log(chalk.cyan('\n처리 중:'));
      this.currentTasks.slice(0, 3).forEach(task => {
        console.log(chalk.gray(`  • ${task}`));
      });
      if (this.currentTasks.length > 3) {
        console.log(chalk.gray(`  ... 외 ${this.currentTasks.length - 3}개`));
      }
    }

    // 상태 표시
    if (this.isPaused) {
      console.log(chalk.yellow.bold('\n⏸️  일시정지됨'));
      console.log(chalk.gray('R 키를 눌러 재개'));
    } else if (this.isCancelled) {
      console.log(chalk.red.bold('\n🛑 취소됨'));
    } else {
      console.log(chalk.gray('\n키보드: [P]일시정지 [C]취소 [S]통계'));
    }
  }

  /**
   * 키보드 입력 처리
   */
  setupKeyboardControls() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (key) => {
        const keyStr = key.toString().toLowerCase();

        switch(keyStr) {
          case 'p': // 일시정지
            this.isPaused = !this.isPaused;
            console.log(this.isPaused ?
              chalk.yellow('\n⏸️  일시정지') :
              chalk.green('\n▶️  재개'));
            break;

          case 'c': // 취소
          case '\u0003': // Ctrl+C
            this.isCancelled = true;
            console.log(chalk.red('\n🛑 취소 요청'));
            this.emit('cancel');
            break;

          case 's': // 통계
            this.showDetailedStats();
            break;

          case 'q': // 종료
            process.exit(0);
            break;
        }
      });
    }
  }

  /**
   * 상세 통계 표시
   */
  showDetailedStats() {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('📊 상세 통계'));
    console.log(chalk.cyan('='.repeat(60)));

    const elapsed = this.startTime ?
      (Date.now() - this.startTime) / 1000 : 0;
    const successRate = this.stats.processed > 0 ?
      (this.stats.success / this.stats.processed * 100).toFixed(1) : 0;

    console.log(chalk.white(`처리 완료: ${this.stats.processed}개`));
    console.log(chalk.green(`성공: ${this.stats.success}개`));
    console.log(chalk.red(`실패: ${this.stats.failed}개`));
    console.log(chalk.yellow(`스킵: ${this.stats.skipped}개`));
    console.log(chalk.cyan(`성공률: ${successRate}%`));
    console.log(chalk.blue(`평균 속도: ${(this.stats.processed / elapsed * 60).toFixed(1)}개/분`));
    console.log(chalk.gray('아무 키나 눌러서 계속...'));
  }

  /**
   * 배치 실행
   */
  async executeBatch(mode, tasks, config) {
    this.startTime = Date.now();
    this.stats.total = tasks.length;
    this.stats.totalBatches = Math.ceil(tasks.length / config.batchSize);

    // 키보드 컨트롤 설정
    this.setupKeyboardControls();

    // 진행 상황 업데이트 타이머
    this.progressInterval = setInterval(() => {
      if (!this.isPaused && !this.isCancelled) {
        this.showProgressDashboard();
      }
    }, 1000);

    try {
      // DI 컨테이너 설정
      const { setupContainer } = require('./src/container');
      const container = setupContainer();

      // UseCase 선택
      const useCaseName = mode === 'pause' ?
        'batchPauseOptimizedUseCase' :
        'batchResumeOptimizedUseCase';

      const useCase = container.resolve(useCaseName);

      // 이벤트 리스너 설정
      useCase.on('batch:start', ({ batchNumber, tasks }) => {
        this.stats.currentBatch = batchNumber;
        this.currentTasks = tasks.map(t => t.googleId);
      });

      useCase.on('task:complete', ({ task }) => {
        this.stats.processed++;
        this.stats.success++;
        this.currentTasks = this.currentTasks.filter(t => t !== task.googleId);
        console.log(chalk.green(`✅ ${task.googleId}`));
      });

      useCase.on('task:failed', ({ task, error }) => {
        this.stats.processed++;
        this.stats.failed++;
        this.currentTasks = this.currentTasks.filter(t => t !== task.googleId);
        console.log(chalk.red(`❌ ${task.googleId}: ${error}`));
      });

      useCase.on('task:skipped', ({ task }) => {
        this.stats.processed++;
        this.stats.skipped++;
        this.currentTasks = this.currentTasks.filter(t => t !== task.googleId);
        console.log(chalk.yellow(`⏭️  ${task.googleId}`));
      });

      // 취소 리스너
      this.on('cancel', () => {
        useCase.cancel();
      });

      // 일시정지 처리
      const originalExecute = useCase.execute.bind(useCase);
      useCase.execute = async (tasks, options) => {
        // 일시정지 체크를 주입
        const checkPause = async () => {
          while (this.isPaused) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (this.isCancelled) {
            throw new Error('Cancelled by user');
          }
        };

        // 각 작업 전에 일시정지 체크
        options.beforeTask = checkPause;

        return originalExecute(tasks, options);
      };

      // 실행
      const result = await useCase.execute(tasks, config);

      // 최종 결과 표시
      clearInterval(this.progressInterval);
      this.showFinalResults(result);

    } catch (error) {
      clearInterval(this.progressInterval);
      console.error(chalk.red(`\n❌ 오류: ${error.message}`));
    } finally {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      }
    }
  }

  /**
   * 최종 결과 표시
   */
  showFinalResults(result) {
    console.clear();
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════╗
║              🛡️  방어적 배치 처리 완료                   ║
╚══════════════════════════════════════════════════════════╝
    `));

    const elapsed = (Date.now() - this.startTime) / 1000;
    const successRate = this.stats.processed > 0 ?
      (this.stats.success / this.stats.processed * 100).toFixed(1) : 0;

    const resultTable = new Table({
      colWidths: [25, 20]
    });

    resultTable.push(
      ['전체 작업', this.stats.total],
      ['처리 완료', this.stats.processed],
      [chalk.green('성공'), this.stats.success],
      [chalk.red('실패'), this.stats.failed],
      [chalk.yellow('스킵'), this.stats.skipped],
      ['성공률', `${successRate}%`],
      ['소요 시간', `${Math.floor(elapsed / 60)}분 ${Math.floor(elapsed % 60)}초`],
      ['평균 속도', `${(this.stats.processed / elapsed * 60).toFixed(1)}개/분`]
    );

    console.log(resultTable.toString());

    // 성공률 그래프
    const barLength = 30;
    const filledLength = Math.floor(parseFloat(successRate) / 100 * barLength);
    const successBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    console.log(chalk.cyan('\n성공률:'));
    console.log(`[${successBar}] ${successRate}%`);

    if (this.stats.failed > 0) {
      console.log(chalk.yellow(`\n⚠️  실패한 ${this.stats.failed}개 작업은 재시도가 필요합니다.`));
    }

    console.log(chalk.green('\n✨ 배치 처리가 완료되었습니다!'));
  }
}

/**
 * 메인 실행
 */
async function main() {
  try {
    const batch = new ImprovedDefensiveBatch();

    // 모드 선택 (커맨드라인 인자 또는 대화형)
    let mode = process.argv.find(arg => arg.startsWith('--mode='));
    mode = mode ? mode.split('=')[1] : null;

    if (!mode) {
      const { selectedMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedMode',
          message: '작업 모드를 선택하세요:',
          choices: [
            { name: '🔄 일시중지', value: 'pause' },
            { name: '▶️  재개', value: 'resume' }
          ]
        }
      ]);
      mode = selectedMode;
    }

    // 배치 설정
    const config = await batch.configureBatch(mode);

    // Google Sheets에서 작업 목록 가져오기
    console.log(chalk.gray('\n📊 작업 목록 조회 중...'));

    const { setupContainer } = require('./src/container');
    const container = setupContainer();
    const sheetsRepo = container.resolve('enhancedSheetsRepository');
    await sheetsRepo.initialize();

    let tasks;
    if (mode === 'pause') {
      tasks = await sheetsRepo.getPauseTasksWithMapping();
    } else {
      tasks = await sheetsRepo.getResumeTasksWithMapping();
    }

    tasks = tasks.filter(t => t.hasMapping);

    if (tasks.length === 0) {
      console.log(chalk.yellow('\n⚠️  처리할 작업이 없습니다.'));
      process.exit(0);
    }

    console.log(chalk.green(`\n✅ ${tasks.length}개 작업 발견`));

    // 작업 선택
    const { autoStart } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'autoStart',
        message: `모든 작업을 자동으로 처리하시겠습니까?`,
        default: true
      }
    ]);

    let selectedTasks = tasks;
    if (!autoStart) {
      // 수동 선택
      const choices = tasks.slice(0, 50).map(task => ({
        name: `${task.googleId} (${task.adsPowerId})`,
        value: task,
        checked: true
      }));

      const { selected } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selected',
          message: '처리할 작업 선택 (최대 50개 표시):',
          choices: choices,
          pageSize: 15
        }
      ]);

      selectedTasks = selected;
    }

    // 최종 확인
    const estimatedTime = (selectedTasks.length * 30 +
      Math.ceil(selectedTasks.length / config.batchSize) * config.delayBetweenBatches) / 1000 / 60;

    console.log(chalk.cyan(`\n📋 처리 요약:`));
    console.log(chalk.gray(`  • 작업 수: ${selectedTasks.length}개`));
    console.log(chalk.gray(`  • 예상 시간: 약 ${Math.ceil(estimatedTime)}분`));

    const { finalConfirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'finalConfirm',
        message: '시작하시겠습니까?',
        default: true
      }
    ]);

    if (!finalConfirm) {
      console.log(chalk.gray('취소되었습니다.'));
      process.exit(0);
    }

    // 배치 실행
    await batch.executeBatch(mode, selectedTasks, config);

  } catch (error) {
    console.error(chalk.red(`\n❌ 오류: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  }
}

// 실행
if (require.main === module) {
  main().catch(console.error);
}

module.exports = ImprovedDefensiveBatch;