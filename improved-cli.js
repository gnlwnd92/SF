#!/usr/bin/env node

/**
 * Improved CLI Entry Point
 * GOOGLE_LOGIN_SOLUTION_REPORT 기반 개선된 CLI 실행
 */

const chalk = require('chalk');
const ImprovedEnterpriseCLI = require('./src/presentation/cli/ImprovedEnterpriseCLI');

// 환경 변수 로드
require('dotenv').config();

// 프로세스 에러 핸들링
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n⚠️  처리되지 않은 오류:'));
  console.error(chalk.red(error.stack || error));
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Ctrl+C 감지 - 안전하게 종료합니다...'));
  process.exit(0);
});

// 메인 실행
async function main() {
  try {
    // CLI 인스턴스 생성 및 실행
    const cli = new ImprovedEnterpriseCLI();
    await cli.run();
  } catch (error) {
    console.error(chalk.red('치명적 오류:'), error.message);
    process.exit(1);
  }
}

// 실행
main().catch(console.error);