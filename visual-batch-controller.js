#!/usr/bin/env node
/**
 * 시각적 배치 컨트롤러
 * 배치 작업을 쉽게 이해하고 제어할 수 있는 인터페이스
 */

const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');
const ora = require('ora');
const fs = require('fs-extra');
const path = require('path');

class VisualBatchController {
  constructor() {
    this.currentBatch = null;
    this.stats = {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      currentBatchNum: 0,
      totalBatches: 0
    };
    this.startTime = null;
    this.isPaused = false;
    this.logs = [];
  }

  // 배치 설정 화면
  async showBatchConfigScreen() {
    console.clear();
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════╗
║           시각적 배치 작업 컨트롤러                  ║
║                                                      ║
║  배치 크기와 속도를 직관적으로 설정할 수 있습니다   ║
╚══════════════════════════════════════════════════════╝
    `));

    // 프리셋 테이블 표시
    const presetTable = new Table({
      head: [
        chalk.yellow('프리셋'),
        chalk.yellow('배치 크기'),
        chalk.yellow('동시 실행'),
        chalk.yellow('작업 간격'),
        chalk.yellow('배치 간격'),
        chalk.yellow('예상 속도')
      ],
      colWidths: [15, 12, 12, 12, 12, 20]
    });

    presetTable.push(
      ['🚀 빠름', '10개', '3개', '2초', '5초', '~180 작업/시간'],
      ['⚡ 보통', '5개', '2개', '5초', '10초', '~60 작업/시간'],
      ['🛡️ 안전', '3개', '1개', '10초', '20초', '~20 작업/시간'],
      ['🎯 사용자정의', '?', '?', '?', '?', '직접 설정']
    );

    console.log(presetTable.toString());

    // 프리셋 선택
    const { preset } = await inquirer.prompt([
      {
        type: 'list',
        name: 'preset',
        message: '배치 프리셋을 선택하세요:',
        choices: [
          { name: '🚀 빠름 - 최대 속도 (위험할 수 있음)', value: 'fast' },
          { name: '⚡ 보통 - 균형잡힌 설정', value: 'normal' },
          { name: '🛡️ 안전 - 느리지만 안정적', value: 'safe' },
          { name: '🎯 사용자정의 - 직접 설정', value: 'custom' }
        ]
      }
    ]);

    let config;
    if (preset === 'custom') {
      config = await this.customBatchConfig();
    } else {
      config = this.getPresetConfig(preset);
    }

    // 설정 확인 화면
    await this.showConfigConfirmation(config);

    return config;
  }

  // 사용자 정의 배치 설정
  async customBatchConfig() {
    console.log(chalk.cyan('\n📝 사용자 정의 배치 설정\n'));

    // 시각적 배치 크기 선택
    console.log(chalk.yellow('배치 크기 설명:'));
    console.log(chalk.gray('• 1-3개: 매우 안전, 각 작업을 신중하게 처리'));
    console.log(chalk.gray('• 5개: 권장 설정, 적당한 속도와 안정성'));
    console.log(chalk.gray('• 10개: 빠른 처리, AdsPower가 안정적일 때'));
    console.log(chalk.gray('• 20개: 최대 속도, 강력한 시스템 필요\n'));

    const answers = await inquirer.prompt([
      {
        type: 'number',
        name: 'batchSize',
        message: '한 배치에 몇 개씩 처리할까요?',
        default: 5,
        validate: input => {
          if (input < 1 || input > 20) {
            return '1-20 사이의 값을 입력하세요';
          }
          return true;
        }
      },
      {
        type: 'list',
        name: 'concurrency',
        message: '동시에 몇 개의 브라우저를 실행할까요?',
        choices: [
          { name: '1개 - 순차 처리 (안전)', value: 1 },
          { name: '2개 - 적당한 병렬 처리', value: 2 },
          { name: '3개 - 빠른 병렬 처리', value: 3 },
          { name: '5개 - 최대 병렬 (위험)', value: 5 }
        ]
      },
      {
        type: 'list',
        name: 'delayBetweenTasks',
        message: '작업 사이 대기 시간:',
        choices: [
          { name: '2초 - 빠름', value: 2000 },
          { name: '5초 - 보통', value: 5000 },
          { name: '10초 - 안전', value: 10000 },
          { name: '15초 - 매우 안전', value: 15000 }
        ]
      },
      {
        type: 'list',
        name: 'delayBetweenBatches',
        message: '배치 사이 대기 시간:',
        choices: [
          { name: '5초 - 빠름', value: 5000 },
          { name: '10초 - 보통', value: 10000 },
          { name: '20초 - 안전', value: 20000 },
          { name: '30초 - 매우 안전', value: 30000 }
        ]
      }
    ]);

    return answers;
  }

  // 프리셋 설정 가져오기
  getPresetConfig(preset) {
    const configs = {
      fast: {
        batchSize: 10,
        concurrency: 3,
        delayBetweenTasks: 2000,
        delayBetweenBatches: 5000
      },
      normal: {
        batchSize: 5,
        concurrency: 2,
        delayBetweenTasks: 5000,
        delayBetweenBatches: 10000
      },
      safe: {
        batchSize: 3,
        concurrency: 1,
        delayBetweenTasks: 10000,
        delayBetweenBatches: 20000
      }
    };

    return configs[preset];
  }

  // 설정 확인 화면
  async showConfigConfirmation(config) {
    console.clear();
    console.log(chalk.cyan.bold('\n📊 배치 설정 확인\n'));

    // 시각적 표현
    const configTable = new Table({
      colWidths: [25, 35]
    });

    configTable.push(
      [chalk.yellow('배치 크기'), `${config.batchSize}개씩 처리`],
      [chalk.yellow('동시 실행'), `${config.concurrency}개 브라우저`],
      [chalk.yellow('작업 간격'), `${config.delayBetweenTasks / 1000}초`],
      [chalk.yellow('배치 간격'), `${config.delayBetweenBatches / 1000}초`]
    );

    console.log(configTable.toString());

    // 예상 처리 속도 계산
    const tasksPerHour = Math.floor(3600000 / (config.delayBetweenTasks + 30000));
    const batchesPerHour = Math.floor(3600000 / (
      (config.batchSize * (config.delayBetweenTasks + 30000)) + config.delayBetweenBatches
    ));

    console.log(chalk.green(`\n예상 처리 속도:`));
    console.log(chalk.gray(`• 시간당 약 ${tasksPerHour}개 작업`));
    console.log(chalk.gray(`• 시간당 약 ${batchesPerHour}개 배치`));

    // 시각적 배치 예시
    console.log(chalk.cyan('\n배치 처리 예시:'));
    this.showBatchVisualization(config);

    await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: '이 설정으로 진행하시겠습니까?',
        default: true
      }
    ]);
  }

  // 배치 시각화
  showBatchVisualization(config) {
    console.log(chalk.gray('\n배치 #1:'));
    let visualization = '  ';
    for (let i = 0; i < Math.min(config.batchSize, 10); i++) {
      visualization += '📄 ';
    }
    if (config.batchSize > 10) {
      visualization += `... (${config.batchSize - 10}개 더)`;
    }
    console.log(visualization);

    if (config.concurrency > 1) {
      console.log(chalk.gray(`  ↓ 동시에 ${config.concurrency}개씩 처리`));
    } else {
      console.log(chalk.gray('  ↓ 순차적으로 처리'));
    }

    console.log(chalk.gray(`  ⏱️  ${config.delayBetweenBatches / 1000}초 대기`));
    console.log(chalk.gray('\n배치 #2:'));
    console.log(visualization);
  }

  // 실시간 진행 상황 표시
  showProgressDashboard() {
    console.clear();

    // 헤더
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════╗
║              배치 작업 진행 상황                     ║
╚══════════════════════════════════════════════════════╝
    `));

    // 진행률 바
    const percentage = Math.round((this.stats.processed / this.stats.total) * 100) || 0;
    const barLength = 40;
    const filledLength = Math.floor((percentage / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    console.log(chalk.yellow('\n전체 진행률:'));
    console.log(`[${bar}] ${percentage}%`);
    console.log(chalk.gray(`${this.stats.processed} / ${this.stats.total} 작업 완료\n`));

    // 현재 배치 상태
    if (this.currentBatch) {
      console.log(chalk.cyan('현재 배치:'));
      const batchTable = new Table({
        head: ['배치 번호', '크기', '진행 상황'],
        colWidths: [15, 10, 30]
      });

      const batchProgress = this.currentBatch.processed || 0;
      const batchBar = '▓'.repeat(Math.floor((batchProgress / this.currentBatch.size) * 10)) +
                      '░'.repeat(10 - Math.floor((batchProgress / this.currentBatch.size) * 10));

      batchTable.push([
        `#${this.stats.currentBatchNum} / ${this.stats.totalBatches}`,
        this.currentBatch.size,
        batchBar
      ]);

      console.log(batchTable.toString());
    }

    // 통계 테이블
    const statsTable = new Table({
      head: [
        chalk.green('✅ 성공'),
        chalk.red('❌ 실패'),
        chalk.yellow('⏭️  스킵'),
        chalk.blue('⏱️  경과 시간'),
        chalk.cyan('📊 속도')
      ],
      colWidths: [12, 12, 12, 15, 15]
    });

    const elapsedTime = this.startTime ?
      Math.floor((Date.now() - this.startTime) / 1000) : 0;
    const speed = elapsedTime > 0 ?
      (this.stats.processed / elapsedTime * 60).toFixed(1) : 0;

    statsTable.push([
      this.stats.success,
      this.stats.failed,
      this.stats.skipped,
      `${Math.floor(elapsedTime / 60)}분 ${elapsedTime % 60}초`,
      `${speed} /분`
    ]);

    console.log(statsTable.toString());

    // 최근 로그
    if (this.logs.length > 0) {
      console.log(chalk.cyan('\n최근 활동:'));
      this.logs.slice(-5).forEach(log => {
        console.log(chalk.gray(`  ${log}`));
      });
    }

    // 컨트롤 안내
    if (this.isPaused) {
      console.log(chalk.yellow.bold('\n⏸️  일시정지됨'));
      console.log(chalk.gray('R: 재개 | Q: 종료'));
    } else {
      console.log(chalk.gray('\n키보드 컨트롤: P: 일시정지 | C: 취소 | Q: 종료'));
    }
  }

  // 배치 시작
  startBatch(batchNum, size) {
    this.currentBatch = {
      number: batchNum,
      size: size,
      processed: 0,
      startTime: Date.now()
    };
    this.stats.currentBatchNum = batchNum;
  }

  // 작업 완료 업데이트
  updateTaskComplete(result) {
    this.stats.processed++;

    if (this.currentBatch) {
      this.currentBatch.processed++;
    }

    switch (result) {
      case 'success':
        this.stats.success++;
        this.addLog(`✅ 작업 ${this.stats.processed} 성공`);
        break;
      case 'failed':
        this.stats.failed++;
        this.addLog(`❌ 작업 ${this.stats.processed} 실패`);
        break;
      case 'skipped':
        this.stats.skipped++;
        this.addLog(`⏭️  작업 ${this.stats.processed} 스킵`);
        break;
    }

    this.showProgressDashboard();
  }

  // 로그 추가
  addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.push(`[${timestamp}] ${message}`);
    if (this.logs.length > 100) {
      this.logs.shift();
    }
  }

  // 일시정지
  pause() {
    this.isPaused = true;
    this.addLog('⏸️  작업 일시정지');
    this.showProgressDashboard();
  }

  // 재개
  resume() {
    this.isPaused = false;
    this.addLog('▶️  작업 재개');
    this.showProgressDashboard();
  }

  // 최종 결과 표시
  showFinalResults() {
    console.clear();
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════╗
║              배치 작업 완료 보고서                   ║
╚══════════════════════════════════════════════════════╝
    `));

    const totalTime = this.startTime ?
      Math.floor((Date.now() - this.startTime) / 1000) : 0;

    // 결과 테이블
    const resultsTable = new Table({
      colWidths: [25, 20]
    });

    resultsTable.push(
      ['전체 작업 수', this.stats.total],
      ['처리 완료', this.stats.processed],
      [chalk.green('성공'), this.stats.success],
      [chalk.red('실패'), this.stats.failed],
      [chalk.yellow('스킵'), this.stats.skipped],
      ['소요 시간', `${Math.floor(totalTime / 60)}분 ${totalTime % 60}초`],
      ['평균 속도', `${(this.stats.processed / totalTime * 60).toFixed(1)} 작업/분`]
    );

    console.log(resultsTable.toString());

    // 성공률 그래프
    const successRate = (this.stats.success / this.stats.processed * 100).toFixed(1);
    console.log(chalk.cyan('\n성공률:'));
    const successBar = '█'.repeat(Math.floor(successRate / 5)) +
                      '░'.repeat(20 - Math.floor(successRate / 5));
    console.log(`[${successBar}] ${successRate}%`);

    // 실패 분석
    if (this.stats.failed > 0) {
      console.log(chalk.red(`\n⚠️  ${this.stats.failed}개 작업이 실패했습니다.`));
      console.log(chalk.gray('실패 로그는 failed-batch-*.json 파일을 확인하세요.'));
    }
  }
}

// 메인 실행 함수
async function runVisualBatch() {
  const controller = new VisualBatchController();

  try {
    // 배치 설정
    const config = await controller.showBatchConfigScreen();

    // Mock 모드 선택
    const { useMock } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useMock',
        message: 'Mock 모드를 사용하시겠습니까? (테스트용)',
        default: false
      }
    ]);

    if (useMock) {
      process.env.USE_MOCK_REPOSITORY = 'true';
    }

    // 작업 모드 선택
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: '작업 모드 선택:',
        choices: [
          { name: '🔄 일시중지', value: 'pause' },
          { name: '▶️  재개', value: 'resume' }
        ]
      }
    ]);

    // DI 컨테이너 초기화
    require('dotenv').config();
    const { setupContainer } = require('./src/container');
    const container = setupContainer();

    // UseCase 선택
    const useCaseName = mode === 'pause'
      ? 'batchPauseOptimizedUseCase'
      : 'batchResumeOptimizedUseCase';

    const useCase = container.resolve(useCaseName);

    // 작업 목록 가져오기
    let tasks;
    if (useMock) {
      // Mock 데이터
      tasks = [];
      for (let i = 1; i <= 20; i++) {
        tasks.push({
          googleId: `test${i}@gmail.com`,
          adsPowerId: `test_profile_${i}`,
          hasMapping: true,
          rowIndex: i
        });
      }
    } else {
      const sheetsRepo = container.resolve('enhancedSheetsRepository');
      await sheetsRepo.initialize();

      if (mode === 'pause') {
        tasks = await sheetsRepo.getPauseTasksWithMapping();
      } else {
        tasks = await sheetsRepo.getResumeTasksWithMapping();
      }

      tasks = tasks.filter(t => t.hasMapping);
    }

    // 통계 초기화
    controller.stats.total = tasks.length;
    controller.stats.totalBatches = Math.ceil(tasks.length / config.batchSize);
    controller.startTime = Date.now();

    // 이벤트 리스너 설정
    useCase.on('batch:start', (data) => {
      controller.startBatch(data.batchNumber, data.batchSize);
      controller.showProgressDashboard();
    });

    useCase.on('task:complete', (data) => {
      controller.updateTaskComplete('success');
    });

    useCase.on('task:failed', (data) => {
      controller.updateTaskComplete('failed');
    });

    useCase.on('task:skipped', (data) => {
      controller.updateTaskComplete('skipped');
    });

    // 키보드 입력 처리
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      const keyStr = key.toString();

      if (keyStr === 'p' || keyStr === 'P') {
        controller.pause();
        useCase.pause();
      } else if (keyStr === 'r' || keyStr === 'R') {
        controller.resume();
        useCase.resume();
      } else if (keyStr === 'c' || keyStr === 'C') {
        console.log(chalk.yellow('\n\n취소 중...'));
        useCase.cancel();
      } else if (keyStr === 'q' || keyStr === 'Q' || keyStr === '\x03') {
        console.log(chalk.red('\n\n종료 중...'));
        process.exit(0);
      }
    });

    // 배치 실행
    controller.showProgressDashboard();
    const result = await useCase.execute(tasks, config);

    // 최종 결과 표시
    controller.showFinalResults();

    // 실패 목록 저장
    if (result.results && result.results.failed.length > 0) {
      const failedFile = `failed-batch-${Date.now()}.json`;
      await fs.writeJson(failedFile, result.results.failed, { spaces: 2 });
      console.log(chalk.yellow(`\n실패 목록 저장: ${failedFile}`));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ 오류: ${error.message}`));
    console.error(error.stack);
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

// 실행
if (require.main === module) {
  runVisualBatch().catch(console.error);
}

module.exports = VisualBatchController;