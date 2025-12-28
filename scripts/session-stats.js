#!/usr/bin/env node
/**
 * 세션 로그 통계 스크립트
 * 날짜별 세션 현황 및 성공률 표시
 */

const path = require('path');
const chalk = require('chalk');

// 환경 설정
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SessionLogService = require('../src/services/SessionLogService');

async function main() {
  console.log(chalk.cyan('\n📊 세션 로그 통계'));
  console.log(chalk.gray('═'.repeat(70)));

  const service = new SessionLogService({
    logger: console,
    debugMode: false
  });

  try {
    const stats = await service.getStats();

    if (stats.dates.length === 0) {
      console.log(chalk.yellow('\n💤 저장된 세션 로그가 없습니다.\n'));
      process.exit(0);
    }

    // 헤더
    console.log(chalk.white.bold(
      padRight('날짜', 14) +
      padRight('세션', 8) +
      padRight('성공', 8) +
      padRight('실패', 8) +
      padRight('스크린샷', 10) +
      padRight('로그', 8) +
      padRight('용량', 10)
    ));
    console.log(chalk.gray('─'.repeat(70)));

    // 데이터 행
    for (const date of stats.dates) {
      const successRate = date.sessions > 0
        ? Math.round((date.success / date.sessions) * 100)
        : 0;

      const successColor = successRate >= 80 ? chalk.green :
                          successRate >= 50 ? chalk.yellow : chalk.red;

      console.log(
        chalk.white(padRight(date.date, 14)) +
        chalk.white(padRight(date.sessions.toString(), 8)) +
        chalk.green(padRight(date.success.toString(), 8)) +
        chalk.red(padRight(date.error.toString(), 8)) +
        chalk.white(padRight(date.screenshots.toString(), 10)) +
        chalk.white(padRight(date.logs.toString(), 8)) +
        chalk.white(padRight(formatBytes(date.bytes), 10))
      );
    }

    // 합계
    console.log(chalk.gray('─'.repeat(70)));
    const totalSuccessRate = stats.totals.sessions > 0
      ? Math.round((stats.totals.success / stats.totals.sessions) * 100)
      : 0;

    console.log(chalk.white.bold(
      padRight('합계', 14) +
      padRight(stats.totals.sessions.toString(), 8) +
      padRight(stats.totals.success.toString(), 8) +
      padRight(stats.totals.error.toString(), 8) +
      padRight(stats.totals.screenshots.toString(), 10) +
      padRight(stats.totals.logs.toString(), 8) +
      padRight(formatBytes(stats.totals.bytes), 10)
    ));

    console.log(chalk.gray('═'.repeat(70)));

    // 성공률
    const successRateColor = totalSuccessRate >= 80 ? chalk.green :
                            totalSuccessRate >= 50 ? chalk.yellow : chalk.red;
    console.log(successRateColor(`성공률: ${totalSuccessRate}%`));
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

function padRight(str, length) {
  return str.toString().padEnd(length);
}

main();
