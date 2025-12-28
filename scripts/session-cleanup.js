#!/usr/bin/env node
/**
 * 세션 로그 정리 스크립트
 * 3일 이전의 스크린샷 및 로그 자동 삭제
 */

const path = require('path');
const chalk = require('chalk');

// 환경 설정
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SessionLogService = require('../src/services/SessionLogService');

async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args[0]) || 3;

  console.log(chalk.cyan('\n📸 세션 로그 정리 시작'));
  console.log(chalk.gray(`   보관 기간: ${days}일 이전 삭제\n`));
  console.log(chalk.gray('─'.repeat(50)));

  const service = new SessionLogService({
    logger: console,
    debugMode: false
  });

  try {
    const stats = await service.cleanup(days);

    if (stats.sessions === 0) {
      console.log(chalk.yellow('\n💤 삭제할 세션이 없습니다.'));
    } else {
      console.log(chalk.green('\n🗑️ 삭제 완료'));
      console.log(chalk.white(`   세션: ${stats.sessions}개`));
      console.log(chalk.white(`   스크린샷: ${stats.screenshots}개`));
      console.log(chalk.white(`   로그: ${stats.logs}개 (log.txt + meta.json)`));
      console.log(chalk.white(`   용량: ${formatBytes(stats.bytes)}`));

      if (stats.deletedDates.length > 0) {
        console.log(chalk.gray(`\n   삭제된 날짜: ${stats.deletedDates.join(', ')}`));
      }
    }

    console.log(chalk.gray('\n─'.repeat(50)));
    console.log(chalk.cyan('✅ 정리 완료\n'));

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

main();
