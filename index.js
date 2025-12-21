#!/usr/bin/env node

/**
 * AdsPower YouTube Automation - Standalone Version
 * 독립 실행 가능한 통합 CLI
 */

// 즉시 실행 확인
console.log('[START] Script execution started at', new Date().toISOString());

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora').default || require('ora');

// 터미널 로거 초기화 (가장 먼저 실행)
const TerminalLogger = require('./src/infrastructure/logging/TerminalLogger');
const terminalLogger = new TerminalLogger({
  enabled: process.env.ENABLE_TERMINAL_LOGGING !== 'false', // 기본값 true
  logDir: path.join(__dirname, 'logs', 'terminal'),
  maxAge: 48 * 60 * 60 * 1000, // 48시간
  checkInterval: 60 * 60 * 1000 // 1시간마다 체크
});

// 비동기 초기화는 즉시 실행
terminalLogger.initialize().catch(err => {
  console.error('터미널 로거 초기화 실패:', err.message);
});

console.log('[INIT] Basic modules loaded');

// 환경 변수 로드
console.log('[ENV] Checking .env file...');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error(chalk.red('❌ .env 파일이 없습니다!'));
  console.log(chalk.yellow('먼저 설정을 실행하세요:'));
  console.log(chalk.cyan('  npm run setup'));
  process.exit(1);
}

console.log('[ENV] Loading .env file...');
require('dotenv').config({ path: envPath });
console.log('[ENV] .env loaded successfully');

// 필수 디렉터리 생성
const requiredDirs = ['credentials', 'logs', 'logs/daily', 'logs/errors', 'logs/sessions', 'logs/workflows', 'screenshots', 'backup', 'temp'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});


// 필수 환경 변수 검증
const requiredEnvVars = ['ADSPOWER_API_URL', 'GOOGLE_SHEETS_ID'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(chalk.red('❌ 필수 환경 변수가 설정되지 않았습니다:'));
  missingVars.forEach(varName => {
    console.log(chalk.yellow(`  • ${varName}`));
  });
  console.log(chalk.cyan('\nnpm run setup 명령으로 설정을 완료하세요.'));
  process.exit(1);
}

// CLI 로드
console.log('[CLI] Loading CLI module...');
const useImprovedCLI = process.env.USE_IMPROVED_CLI === 'true' || process.argv.includes('--improved');
console.log('[CLI] Using', useImprovedCLI ? 'ImprovedEnterpriseCLI' : 'EnterpriseCLI');

let EnterpriseCLI;
try {
  EnterpriseCLI = useImprovedCLI 
    ? require('./src/presentation/cli/ImprovedEnterpriseCLI')
    : require('./src/presentation/cli/EnterpriseCLI');
  console.log('[CLI] CLI module loaded successfully');
} catch (error) {
  console.error('[CLI] Failed to load CLI module:', error.message);
  console.error('[CLI] Stack:', error.stack);
  process.exit(1);
}

// 설정 객체 생성
const config = {
  adsPowerApiUrl: process.env.ADSPOWER_API_URL,
  googleSheetsId: process.env.GOOGLE_SHEETS_ID,
  googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'credentials', 'service-account.json'),
  debugMode: process.env.DEBUG_MODE === 'true',
  stealthMode: process.env.STEALTH_MODE !== 'false',
  batchSize: parseInt(process.env.BATCH_SIZE) || 5,
  defaultWaitTime: parseInt(process.env.DEFAULT_WAIT_TIME) || 3000,
  navigationTimeout: parseInt(process.env.NAVIGATION_TIMEOUT) || 30000,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 3,
  logLevel: process.env.LOG_LEVEL || 'info',
  logFilePath: process.env.LOG_FILE_PATH || './logs',
  saveScreenshots: process.env.SAVE_SCREENSHOTS !== 'false',
  screenshotPath: process.env.SCREENSHOT_PATH || './screenshots',
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ko',
  keepSessionAlive: process.env.KEEP_SESSION_ALIVE !== 'false',
  // 개선된 Google 로그인 프로세스 활성화
  useImprovedAuth: true,
  loginMode: process.env.LOGIN_MODE || 'improved',  // improved 모드를 기본값으로
  humanLikeMotion: true,
  screenshotEnabled: true,
  headlessMode: process.env.HEADLESS_MODE === 'true'
};

// 명령행 인자 파싱
const args = process.argv.slice(2);
let mode = null;

args.forEach((arg, index) => {
  if (arg === '--mode' && args[index + 1]) {
    mode = args[index + 1];
  }
});

// CLI 인스턴스 생성
console.log('[CLI] Creating CLI instance...');
const cli = new EnterpriseCLI(config);
console.log('[CLI] CLI instance created');

// 시작 배너
function showBanner() {
  console.clear();
  console.log(chalk.cyan.bold('╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║     AdsPower YouTube Premium Automation System        ║'));
  console.log(chalk.cyan.bold('║                 Standalone Version 2.0                ║'));
  if (useImprovedCLI) {
    console.log(chalk.green.bold('║              🚀 IMPROVED CLI MODE ACTIVE 🚀           ║'));
  }
  if (config.loginMode === 'macro') {
    console.log(chalk.cyan.bold('║            🖱️  MACRO LOGIN MODE ACTIVE 🖱️              ║'));
  }
  console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════╝'));
  console.log();
  console.log(chalk.gray('설정 파일: .env'));
  console.log(chalk.gray(`Google Sheets ID: ${config.googleSheetsId}`));
  console.log(chalk.gray(`AdsPower API: ${config.adsPowerApiUrl}`));
  console.log(chalk.gray(`언어: ${config.defaultLanguage}`));
  console.log(chalk.yellow(`로그인 모드: ${config.loginMode}`));
  console.log(chalk.yellow(`브라우저 실행: GUI 동일 (최소 파라미터)`));
  if (useImprovedCLI) {
    console.log(chalk.green('개선된 CLI 모드: TOTP 최적화, 향상된 로그인'));
  }
  if (process.env.ENABLE_TERMINAL_LOGGING !== 'false') {
    console.log(chalk.green(`📝 터미널 로깅: 활성화 (logs/terminal/)`));
  }
  console.log();
}

// 시그널 핸들러
let isExiting = false;

async function gracefulShutdown(signal) {
  if (isExiting) {
    console.log(chalk.red('\n⚠️ 강제 종료...'));
    // 터미널 로거 강제 저장
    if (terminalLogger && terminalLogger.forceShutdown) {
      terminalLogger.forceShutdown();
    }
    process.exit(1);
  }
  
  isExiting = true;
  console.log(chalk.yellow(`\n\n🔄 ${signal} 시그널 받음. 안전하게 종료 중...`));
  
  // 즉시 프로세스 종료를 위해 타임아웃 설정
  const forceExitTimeout = setTimeout(() => {
    console.log(chalk.red('\n⚠️ 강제 종료 (타임아웃)...'));
    // 터미널 로거 강제 저장
    if (terminalLogger && terminalLogger.forceShutdown) {
      terminalLogger.forceShutdown();
    }
    process.exit(1);
  }, 3000); // 3초 후 강제 종료
  
  // 터미널 로거 먼저 종료 (우선순위)
  if (terminalLogger) {
    try {
      // Ctrl+C의 경우 동기 처리로 빠르게 저장
      if (signal === 'SIGINT' && terminalLogger.forceShutdown) {
        terminalLogger.forceShutdown();
      } else {
        await terminalLogger.shutdown();
      }
    } catch (error) {
      console.error(chalk.red('터미널 로거 종료 중 오류:'), error.message);
    }
  }
  
  // CLI cleanup
  if (cli && typeof cli.cleanup === 'function') {
    try {
      await cli.cleanup();
    } catch (error) {
      console.error(chalk.red('정리 중 오류:'), error.message);
    }
  }
  
  clearTimeout(forceExitTimeout);
  console.log(chalk.green('\n✓ 안전하게 종료되었습니다.'));
  
  // 약간의 지연 후 종료 (파일 쓰기 완료 보장)
  setTimeout(() => {
    process.exit(0);
  }, 100);
}

// 시그널 등록
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n❌ 예기치 않은 오류:'), error);
  
  // 오류 로그 저장
  const errorLogPath = path.join(__dirname, 'logs', 'errors', `error_${Date.now()}.log`);
  fs.mkdirSync(path.dirname(errorLogPath), { recursive: true });
  fs.writeFileSync(errorLogPath, `${new Date().toISOString()}\n${error.stack}`);
  console.log(chalk.gray(`오류 로그 저장: ${errorLogPath}`));
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n⚠️ Unhandled Promise Rejection:'), reason);
  // 계속 실행
});

// 메인 실행
async function main() {
  console.log('[MAIN] Starting main function...');
  
  // 터미널 로거 통계 표시 (선택사항)
  if (terminalLogger && process.env.SHOW_LOG_STATS === 'true') {
    const stats = await terminalLogger.getStatistics();
    if (stats) {
      console.log(chalk.gray('📊 로그 통계:'));
      console.log(chalk.gray(`  • 총 로그 파일: ${stats.totalFiles}개`));
      console.log(chalk.gray(`  • 총 크기: ${stats.totalSize}`));
    }
  }
  
  showBanner();
  
  console.log('[MAIN] Checking mode:', mode || 'interactive');
  
  try {
    // 모드가 지정된 경우 직접 실행
    if (mode) {
      const spinner = ora(`${mode} 모드 실행 중...`).start();
      
      switch (mode.toLowerCase()) {
        case 'pause':
          spinner.text = '일시정지 워크플로우 실행 중...';
          // 일시정지 로직 실행
          await cli.run(['pause']);
          break;

        case 'renewal-check-pause':
          spinner.text = '갱신확인 일시정지 워크플로우 실행 중...';
          spinner.color = 'cyan';
          // 갱신확인 일시정지 로직 실행
          if (typeof cli.renewalCheckPause === 'function') {
            await cli.renewalCheckPause();
          } else {
            spinner.fail('갱신확인 일시정지 기능을 찾을 수 없습니다.');
            console.log(chalk.yellow('EnterpriseCLI에 renewalCheckPause 메서드가 필요합니다.'));
            process.exit(1);
          }
          break;

        case 'resume':
          spinner.text = '재개 워크플로우 실행 중...';
          // 재개 로직 실행
          await cli.run(['resume']);
          break;

        case 'check':
          spinner.text = '상태 확인 중...';
          // 상태 확인 로직
          await cli.run(['status']);
          break;

        default:
          spinner.fail(`알 수 없는 모드: ${mode}`);
          console.log(chalk.yellow('사용 가능한 모드: pause, renewal-check-pause, resume, check'));
          process.exit(1);
      }
      
      spinner.succeed('완료!');
    } else {
      // 대화형 모드로 CLI 실행
      console.log('[MAIN] Starting interactive mode...');
      console.log('[MAIN] Calling cli.run()...');
      await cli.run();
      // run()이 자체적으로 무한 루프를 돌므로 여기에 도달하지 않음
      // 하지만 혹시나 도달하면 정상 종료
      process.exit(0);
    }
  } catch (error) {
    console.error(chalk.red('\n❌ 실행 오류:'), error.message);
    
    if (config.debugMode) {
      console.error(chalk.gray('\n스택 트레이스:'));
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// 프로그램 시작
if (require.main === module) {
  console.log('[LAUNCH] Starting program...');
  main().catch(error => {
    console.error(chalk.red('치명적 오류:'), error);
    console.error('Stack:', error.stack);
    process.exit(1);
  });
}

module.exports = { config, cli };