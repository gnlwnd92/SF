#!/usr/bin/env node

/**
 * AdsPower YouTube Automation System - 개선된 실행 파일
 * 지연 초기화 및 Mock 폴백 지원
 */

const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════════╗
║        AdsPower YouTube Premium Automation System v4.0        ║
║                     개선된 실행 모듈                           ║
╚════════════════════════════════════════════════════════════════╝
`));

console.log(chalk.gray(`시작 시간: ${new Date().toLocaleString('ko-KR')}\n`));

// Service Account 파일 체크
console.log(chalk.cyan('📌 환경 체크 중...'));
const serviceAccountPaths = [
  path.join(__dirname, 'credentials', 'service-account.json'),
  path.join(__dirname, 'service_account.json'),
  path.join(__dirname, '..', 'service_account.json')
];

let hasServiceAccount = false;
for (const p of serviceAccountPaths) {
  if (fs.existsSync(p)) {
    hasServiceAccount = true;
    console.log(chalk.green(`✅ Service Account 발견: ${path.basename(p)}`));
    break;
  }
}

if (!hasServiceAccount) {
  console.log(chalk.yellow('⚠️ Service Account 파일이 없습니다.'));
  console.log(chalk.yellow('   Google Sheets 기능이 제한될 수 있습니다.'));
  console.log(chalk.gray('   (Mock 레포지토리 모드로 실행)\n'));
  
  // Mock 모드 자동 활성화
  process.env.USE_MOCK_REPOSITORY = 'true';
}

// 의존성 로드
console.log(chalk.cyan('📌 시스템 초기화 중...'));

async function main() {
  try {
    const startTime = Date.now();
    
    // Container 설정
    console.log(chalk.gray('  - 의존성 컨테이너 로드...'));
    const { setupContainer } = require('./src/container');
    const container = setupContainer();
    
    // Logger 초기화
    console.log(chalk.gray('  - 로거 시스템 초기화...'));
    const logger = container.resolve('logger');
    
    // CLI 초기화
    console.log(chalk.gray('  - CLI 인터페이스 로드...'));
    const EnterpriseCLI = require('./src/presentation/cli/EnterpriseCLI');
    const cli = new EnterpriseCLI(container);
    
    const initTime = Date.now() - startTime;
    console.log(chalk.green(`✅ 시스템 초기화 완료 (${initTime}ms)\n`));
    
    // 빠른 시작 안내
    if (!hasServiceAccount) {
      console.log(chalk.yellow('━'.repeat(60)));
      console.log(chalk.yellow.bold('📋 Google Sheets 설정 안내:'));
      console.log(chalk.white('1. Google Cloud Console에서 Service Account 생성'));
      console.log(chalk.white('2. JSON 키 파일 다운로드'));
      console.log(chalk.white('3. credentials/service-account.json으로 저장'));
      console.log(chalk.white('4. Google Sheets에 Service Account 이메일 공유'));
      console.log(chalk.yellow('━'.repeat(60)));
      console.log();
    }
    
    // CLI 실행
    console.log(chalk.cyan.bold('🚀 대화형 CLI를 시작합니다...\n'));
    
    try {
      await cli.start();
    } catch (cliError) {
      if (cliError.message?.includes('prompt') || cliError.isTTYError) {
        // TTY 오류 처리
        console.log(chalk.yellow('\n⚠️ 대화형 모드를 사용할 수 없습니다.'));
        console.log(chalk.cyan('\n다음 방법 중 하나를 선택하세요:'));
        console.log(chalk.white('1. Windows Terminal 또는 Git Bash에서 실행'));
        console.log(chalk.white('2. npm run pause  - 일시정지 워크플로우 직접 실행'));
        console.log(chalk.white('3. npm run resume - 재개 워크플로우 직접 실행'));
        console.log(chalk.white('4. node index-simple.js - 간단한 텍스트 모드\n'));
      } else {
        throw cliError;
      }
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ 오류 발생:'), error.message);
    
    if (error.stack && process.env.DEBUG_MODE === 'true') {
      console.error(chalk.gray('\n스택 트레이스:'));
      console.error(chalk.gray(error.stack));
    }
    
    // 오류별 해결 방법 안내
    if (error.message.includes('ENOENT')) {
      console.log(chalk.yellow('\n💡 파일을 찾을 수 없습니다. npm install을 실행해보세요.'));
    } else if (error.message.includes('Cannot find module')) {
      console.log(chalk.yellow('\n💡 모듈을 찾을 수 없습니다. npm install을 실행해보세요.'));
    } else if (error.message.includes('AdsPower')) {
      console.log(chalk.yellow('\n💡 AdsPower가 실행 중인지 확인하세요.'));
    }
    
    process.exit(1);
  }
}

// 프로세스 종료 핸들러
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 프로그램을 종료합니다...'));
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n❌ 예상치 못한 오류:'), error.message);
  if (process.env.DEBUG_MODE === 'true') {
    console.error(chalk.gray(error.stack));
  }
  process.exit(1);
});

// 메인 함수 실행
main().catch(error => {
  console.error(chalk.red('치명적 오류:'), error);
  process.exit(1);
});