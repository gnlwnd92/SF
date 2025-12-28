#!/usr/bin/env node
/**
 * 전체 세션 로그 비우기 스크립트
 * 모든 스크린샷 및 로그 삭제
 */

const path = require('path');
const chalk = require('chalk');
const readline = require('readline');

// 환경 설정
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SessionLogService = require('../src/services/SessionLogService');

async function main() {
  const args = process.argv.slice(2);
  const forceMode = args.includes('--force') || args.includes('-f');

  console.log(chalk.red('\n⚠️  전체 세션 로그를 삭제합니다!'));
  console.log(chalk.gray('─'.repeat(50)));

  const service = new SessionLogService({
    logger: console,
    debugMode: false
  });

  try {
    // 현재 통계 조회
    const stats = await service.getStats();

    if (stats.totals.sessions === 0) {
      console.log(chalk.yellow('\n💤 삭제할 세션이 없습니다.\n'));
      process.exit(0);
    }

    console.log(chalk.white('\n현재 보관 중:'));
    console.log(chalk.white(`   세션: ${stats.totals.sessions}개`));
    console.log(chalk.white(`   스크린샷: ${stats.totals.screenshots}개`));
    console.log(chalk.white(`   로그: ${stats.totals.logs}개`));
    console.log(chalk.white(`   용량: ${formatBytes(stats.totals.bytes)}`));
    console.log(chalk.gray('─'.repeat(50)));

    // 강제 모드가 아니면 확인
    if (!forceMode) {
      const confirmed = await askConfirmation('\n정말 삭제하시겠습니까? (y/N): ');
      if (!confirmed) {
        console.log(chalk.yellow('\n취소되었습니다.\n'));
        process.exit(0);
      }
    }

    // 삭제 실행
    const deleteStats = await service.clearAll();

    console.log(chalk.green('\n🗑️ 전체 삭제 완료'));
    console.log(chalk.white(`   삭제된 세션: ${deleteStats.sessions}개`));
    console.log(chalk.white(`   삭제된 파일: ${deleteStats.screenshots + deleteStats.logs}개`));
    console.log(chalk.white(`   해제된 용량: ${formatBytes(deleteStats.bytes)}`));
    console.log('');

  } catch (error) {
    console.error(chalk.red(`\n❌ 오류 발생: ${error.message}\n`));
    process.exit(1);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

main();
