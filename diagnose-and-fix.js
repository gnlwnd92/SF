#!/usr/bin/env node
/**
 * 배치 시스템 문제 자동 진단 및 해결
 * AdsPower 연결 문제와 배치 실행 문제를 자동으로 해결
 */

const chalk = require('chalk');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');

class SystemDiagnostic {
  constructor() {
    this.issues = [];
    this.fixes = [];
  }

  // AdsPower 실행 상태 확인
  async checkAdsPower() {
    console.log(chalk.yellow('🔍 AdsPower 상태 확인 중...'));

    try {
      // 프로세스 확인
      const { stdout } = await execAsync('tasklist | findstr AdsPower', { shell: true });
      if (!stdout.includes('AdsPower')) {
        this.issues.push('AdsPower가 실행되지 않음');
        this.fixes.push('startAdsPower');
        return false;
      }

      // API 포트 확인
      const portCheck = await execAsync('netstat -an | findstr :50325', { shell: true });
      if (!portCheck.stdout.includes('LISTENING')) {
        this.issues.push('AdsPower API 포트(50325)가 열려있지 않음');
        this.fixes.push('restartAdsPower');
        return false;
      }

      // API 연결 테스트
      try {
        const response = await axios.get('http://127.0.0.1:50325/api/v1/status', {
          timeout: 3000
        });
        console.log(chalk.green('✅ AdsPower API 정상 작동'));
        return true;
      } catch (error) {
        this.issues.push('AdsPower API 응답 없음');
        this.fixes.push('restartAdsPower');
        return false;
      }
    } catch (error) {
      this.issues.push('AdsPower 프로세스를 찾을 수 없음');
      this.fixes.push('startAdsPower');
      return false;
    }
  }

  // Google Sheets 연결 확인
  async checkGoogleSheets() {
    console.log(chalk.yellow('🔍 Google Sheets 연결 확인 중...'));

    const serviceAccountPath = path.join(__dirname, 'service_account.json');
    if (!await fs.pathExists(serviceAccountPath)) {
      this.issues.push('service_account.json 파일이 없음');
      this.fixes.push('setupGoogleSheets');
      return false;
    }

    try {
      // 실제 연결 테스트
      require('dotenv').config();
      const { setupContainer } = require('./src/container');
      const container = setupContainer();
      const sheetsRepo = container.resolve('enhancedSheetsRepository');
      await sheetsRepo.initialize();
      console.log(chalk.green('✅ Google Sheets 연결 정상'));
      return true;
    } catch (error) {
      this.issues.push(`Google Sheets 연결 실패: ${error.message}`);
      this.fixes.push('checkSheetsPermissions');
      return false;
    }
  }

  // 환경 변수 확인
  async checkEnvironment() {
    console.log(chalk.yellow('🔍 환경 변수 확인 중...'));

    const envPath = path.join(__dirname, '.env');
    if (!await fs.pathExists(envPath)) {
      this.issues.push('.env 파일이 없음');
      this.fixes.push('createEnvFile');
      return false;
    }

    require('dotenv').config();
    const requiredVars = ['SPREADSHEET_ID', 'PAUSE_SHEET_NAME', 'RESUME_SHEET_NAME'];
    const missingVars = requiredVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
      this.issues.push(`환경 변수 누락: ${missingVars.join(', ')}`);
      this.fixes.push('setupEnvironment');
      return false;
    }

    console.log(chalk.green('✅ 환경 변수 정상'));
    return true;
  }

  // AdsPower 시작
  async startAdsPower() {
    console.log(chalk.cyan('🚀 AdsPower 시작 중...'));

    const adsPowerPath = 'C:\\Program Files\\AdsPower\\AdsPower.exe';
    if (!await fs.pathExists(adsPowerPath)) {
      console.log(chalk.red('❌ AdsPower가 설치되지 않았습니다.'));
      console.log(chalk.yellow('다운로드: https://www.adspower.com/'));
      return false;
    }

    try {
      exec(`start "" "${adsPowerPath}"`, { shell: true });
      console.log(chalk.yellow('⏳ AdsPower 시작 대기 중 (15초)...'));
      await new Promise(resolve => setTimeout(resolve, 15000));

      // 재확인
      return await this.checkAdsPower();
    } catch (error) {
      console.log(chalk.red(`❌ AdsPower 시작 실패: ${error.message}`));
      return false;
    }
  }

  // AdsPower 재시작
  async restartAdsPower() {
    console.log(chalk.cyan('🔄 AdsPower 재시작 중...'));

    try {
      // 종료
      await execAsync('taskkill /F /IM AdsPower.exe', { shell: true }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 시작
      return await this.startAdsPower();
    } catch (error) {
      console.log(chalk.red(`❌ AdsPower 재시작 실패: ${error.message}`));
      return false;
    }
  }

  // Google Sheets 권한 안내
  async checkSheetsPermissions() {
    console.log(chalk.yellow('\n📋 Google Sheets 권한 확인 사항:'));
    console.log(chalk.gray('1. service_account.json 파일이 있는지 확인'));
    console.log(chalk.gray('2. Service Account 이메일이 Google Sheets에 편집자로 추가되었는지 확인'));
    console.log(chalk.gray('3. Google Cloud Console에서 Sheets API가 활성화되었는지 확인'));
    console.log(chalk.gray('4. .env 파일의 SPREADSHEET_ID가 올바른지 확인'));

    const { confirmSheets } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmSheets',
        message: '위 사항을 모두 확인했습니까?',
        default: false
      }
    ]);

    return confirmSheets;
  }

  // 환경 변수 설정
  async setupEnvironment() {
    console.log(chalk.cyan('\n🔧 환경 변수 설정'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'spreadsheetId',
        message: 'Google Sheets ID를 입력하세요:',
        validate: input => input.length > 0
      },
      {
        type: 'input',
        name: 'pauseSheet',
        message: 'Pause Sheet 이름:',
        default: 'Pause'
      },
      {
        type: 'input',
        name: 'resumeSheet',
        message: 'Resume Sheet 이름:',
        default: 'Resume'
      }
    ]);

    const envContent = `
# Google Sheets 설정
SPREADSHEET_ID=${answers.spreadsheetId}
PAUSE_SHEET_NAME=${answers.pauseSheet}
RESUME_SHEET_NAME=${answers.resumeSheet}

# AdsPower 설정
ADSPOWER_API_URL=http://127.0.0.1:50325
NAVIGATION_TIMEOUT=30000
BATCH_SIZE=5
CONCURRENT_LIMIT=2
`;

    await fs.writeFile(path.join(__dirname, '.env'), envContent.trim());
    console.log(chalk.green('✅ 환경 변수 설정 완료'));
    return true;
  }

  // 진단 결과 표시
  showDiagnosticResults() {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('📊 진단 결과'));
    console.log(chalk.cyan('='.repeat(60)));

    if (this.issues.length === 0) {
      console.log(chalk.green.bold('\n✅ 모든 시스템 정상!'));
      console.log(chalk.gray('배치 작업을 실행할 준비가 되었습니다.'));
    } else {
      console.log(chalk.red.bold('\n❌ 발견된 문제:'));
      this.issues.forEach((issue, index) => {
        console.log(chalk.red(`  ${index + 1}. ${issue}`));
      });
    }
  }

  // 자동 수정 실행
  async autoFix() {
    if (this.fixes.length === 0) return true;

    console.log(chalk.yellow('\n🔧 문제 해결 시작...'));

    for (const fix of this.fixes) {
      if (typeof this[fix] === 'function') {
        const result = await this[fix]();
        if (!result) {
          console.log(chalk.red(`❌ ${fix} 수정 실패`));
          return false;
        }
      }
    }

    // 재진단
    console.log(chalk.cyan('\n🔄 시스템 재진단...'));
    this.issues = [];
    this.fixes = [];
    await this.runDiagnostics();

    return this.issues.length === 0;
  }

  // 전체 진단 실행
  async runDiagnostics() {
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════╗
║        배치 시스템 자동 진단 및 복구                 ║
╚══════════════════════════════════════════════════════╝
    `));

    await this.checkAdsPower();
    await this.checkEnvironment();

    // Mock 모드가 아닌 경우에만 Google Sheets 확인
    if (process.env.USE_MOCK_REPOSITORY !== 'true') {
      await this.checkGoogleSheets();
    }
  }

  // Mock 모드 제안
  async suggestMockMode() {
    console.log(chalk.yellow('\n💡 제안: Mock 모드로 테스트'));
    console.log(chalk.gray('Google Sheets 없이 테스트할 수 있습니다.'));

    const { useMock } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useMock',
        message: 'Mock 모드를 사용하시겠습니까?',
        default: true
      }
    ]);

    if (useMock) {
      process.env.USE_MOCK_REPOSITORY = 'true';
      console.log(chalk.green('✅ Mock 모드 활성화'));
      console.log(chalk.gray('이제 Google Sheets 없이 테스트 가능합니다.'));
      return true;
    }

    return false;
  }
}

// 배치 실행 옵션 선택
async function selectBatchOptions() {
  console.log(chalk.cyan('\n📋 배치 작업 설정'));

  const { mode, batchSize, concurrency, mockMode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: '작업 모드 선택:',
      choices: [
        { name: '🔄 일시중지 (Pause)', value: 'pause' },
        { name: '▶️  재개 (Resume)', value: 'resume' },
        { name: '🧪 테스트 (Mock 데이터)', value: 'test' }
      ]
    },
    {
      type: 'number',
      name: 'batchSize',
      message: '배치 크기 (한 번에 처리할 작업 수):',
      default: 5,
      validate: input => input > 0 && input <= 20
    },
    {
      type: 'number',
      name: 'concurrency',
      message: '동시 실행 수:',
      default: 1,
      validate: input => input > 0 && input <= 5
    },
    {
      type: 'confirm',
      name: 'mockMode',
      message: 'Mock 모드 사용 (Google Sheets 불필요):',
      default: false
    }
  ]);

  return { mode, batchSize, concurrency, mockMode };
}

// 배치 실행 (수정된 버전)
async function runBatch(options) {
  console.log(chalk.cyan('\n🚀 배치 작업 시작'));
  console.log(chalk.gray(`모드: ${options.mode}`));
  console.log(chalk.gray(`배치 크기: ${options.batchSize}`));
  console.log(chalk.gray(`동시 실행: ${options.concurrency}`));

  try {
    // Mock 모드 설정
    if (options.mockMode) {
      process.env.USE_MOCK_REPOSITORY = 'true';
    }

    require('dotenv').config();
    const { setupContainer } = require('./src/container');
    const container = setupContainer();

    // UseCase 선택
    const useCaseName = options.mode === 'pause'
      ? 'batchPauseOptimizedUseCase'
      : 'batchResumeOptimizedUseCase';

    const useCase = container.resolve(useCaseName);

    // 작업 목록 가져오기
    let tasks;
    if (options.mockMode || options.mode === 'test') {
      // Mock 데이터 생성
      tasks = [];
      for (let i = 1; i <= 10; i++) {
        tasks.push({
          googleId: `test${i}@gmail.com`,
          adsPowerId: `test_profile_${i}`,
          hasMapping: true,
          rowIndex: i
        });
      }
      console.log(chalk.yellow('📝 Mock 데이터 10개 생성'));
    } else {
      // 실제 Google Sheets 데이터
      const sheetsRepo = container.resolve('enhancedSheetsRepository');
      await sheetsRepo.initialize();

      if (options.mode === 'pause') {
        tasks = await sheetsRepo.getPauseTasksWithMapping();
      } else {
        tasks = await sheetsRepo.getResumeTasksWithMapping();
      }

      tasks = tasks.filter(t => t.hasMapping);
    }

    if (tasks.length === 0) {
      console.log(chalk.yellow('처리할 작업이 없습니다.'));
      return;
    }

    console.log(chalk.green(`\n✅ ${tasks.length}개 작업 발견`));

    // 진행 상황 표시
    let processedCount = 0;
    let successCount = 0;
    let failCount = 0;

    const showProgress = () => {
      const percentage = Math.round((processedCount / tasks.length) * 100);
      const bar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
      process.stdout.write(`\r진행: [${bar}] ${percentage}% | ✅ ${successCount} | ❌ ${failCount}`);
    };

    // 이벤트 리스너
    useCase.on('progress', (data) => {
      processedCount = data.completed + data.failed + data.skipped;
      successCount = data.completed;
      failCount = data.failed;
      showProgress();
    });

    useCase.on('task:complete', (task) => {
      console.log(chalk.green(`\n✅ 완료: ${task.googleId}`));
      showProgress();
    });

    useCase.on('task:failed', (error) => {
      console.log(chalk.red(`\n❌ 실패: ${error.task.googleId} - ${error.error}`));
      showProgress();
    });

    // Ctrl+C 핸들러
    let cancelled = false;
    process.on('SIGINT', () => {
      if (!cancelled) {
        cancelled = true;
        console.log(chalk.yellow('\n\n⚠️  취소 요청...'));
        useCase.cancel();
      }
    });

    // 실행
    const startTime = Date.now();
    const result = await useCase.execute(tasks, {
      concurrency: options.concurrency,
      batchSize: options.batchSize,
      retryEnabled: true,
      retryLimit: 2,
      delayBetweenTasks: 5000,
      delayBetweenBatches: 10000
    });

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // 결과 표시
    console.log(chalk.cyan('\n\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('📊 배치 작업 완료'));
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.green(`✅ 성공: ${result.stats.completed}개`));
    console.log(chalk.red(`❌ 실패: ${result.stats.failed}개`));
    console.log(chalk.gray(`⏭️  스킵: ${result.stats.skipped}개`));
    console.log(chalk.blue(`⏱️  소요 시간: ${duration}분`));

    // 실패 목록 저장
    if (result.results.failed.length > 0) {
      const failedFile = `failed-${options.mode}-${Date.now()}.json`;
      await fs.writeJson(failedFile, result.results.failed, { spaces: 2 });
      console.log(chalk.yellow(`\n실패 목록 저장: ${failedFile}`));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ 배치 실행 오류: ${error.message}`));
    console.error(error.stack);
  }
}

// 메인 함수
async function main() {
  try {
    const diagnostic = new SystemDiagnostic();

    // 진단 실행
    await diagnostic.runDiagnostics();
    diagnostic.showDiagnosticResults();

    // 문제가 있으면 수정
    if (diagnostic.issues.length > 0) {
      const { autoFix } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'autoFix',
          message: '자동으로 문제를 해결하시겠습니까?',
          default: true
        }
      ]);

      if (autoFix) {
        const fixed = await diagnostic.autoFix();
        if (!fixed) {
          // 여전히 문제가 있으면 Mock 모드 제안
          const mockAccepted = await diagnostic.suggestMockMode();
          if (!mockAccepted) {
            console.log(chalk.red('\n시스템 문제로 인해 종료합니다.'));
            process.exit(1);
          }
        }
      } else {
        // Mock 모드 제안
        const mockAccepted = await diagnostic.suggestMockMode();
        if (!mockAccepted) {
          console.log(chalk.yellow('\n수동으로 문제를 해결한 후 다시 실행하세요.'));
          process.exit(0);
        }
      }
    }

    // 배치 실행 옵션
    const { runNow } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'runNow',
        message: '배치 작업을 실행하시겠습니까?',
        default: true
      }
    ]);

    if (runNow) {
      const options = await selectBatchOptions();
      await runBatch(options);
    }

    console.log(chalk.green.bold('\n✨ 완료!'));

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

module.exports = { SystemDiagnostic };