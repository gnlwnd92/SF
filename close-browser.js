#!/usr/bin/env node

/**
 * AdsPower 브라우저 종료 명령어
 * 특정 프로필 또는 모든 브라우저 종료
 * 
 * 사용법:
 *   node close-browser.js k123wv1n  # 특정 프로필 종료
 *   node close-browser.js --all     # 모든 브라우저 종료
 *   npm run close k123wv1n
 */

const axios = require('axios');
const chalk = require('chalk');
const ora = require('ora');

const ADSPOWER_API_URL = 'http://local.adspower.net:50325';

async function closeBrowser(profileId) {
  const spinner = ora(`브라우저 종료 중: ${profileId}`).start();
  
  try {
    const response = await axios.get(`${ADSPOWER_API_URL}/api/v1/browser/stop`, {
      params: { user_id: profileId }
    });

    if (response.data.code === 0) {
      spinner.succeed(chalk.green(`✅ ${profileId} 브라우저 종료 완료`));
      return true;
    } else {
      spinner.fail(chalk.yellow(`⚠️  ${profileId}: ${response.data.msg}`));
      return false;
    }
  } catch (error) {
    spinner.fail(chalk.red(`❌ ${profileId} 종료 실패: ${error.message}`));
    return false;
  }
}

async function closeAllBrowsers() {
  console.log(chalk.yellow('모든 활성 브라우저를 종료합니다...'));
  
  try {
    // 활성 브라우저 목록 가져오기
    const response = await axios.get(`${ADSPOWER_API_URL}/api/v1/browser/list`, {
      params: { status: 'Active' }
    });

    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Failed to get browser list');
    }

    const activeBrowsers = response.data.data.list || [];
    
    if (activeBrowsers.length === 0) {
      console.log(chalk.gray('활성 브라우저가 없습니다.'));
      return;
    }

    console.log(chalk.cyan(`${activeBrowsers.length}개의 활성 브라우저 발견`));
    
    for (const browser of activeBrowsers) {
      await closeBrowser(browser.user_id);
    }
    
    console.log(chalk.green.bold('\n✅ 모든 브라우저 종료 완료'));
    
  } catch (error) {
    console.error(chalk.red('오류:'), error.message);
  }
}

async function main() {
  console.log(chalk.cyan.bold('╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║           AdsPower 브라우저 종료                       ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════╝'));
  console.log();

  const arg = process.argv[2];
  
  if (!arg) {
    console.error(chalk.red('❌ 프로필 ID 또는 --all 옵션이 필요합니다!'));
    console.log(chalk.yellow('\n사용법:'));
    console.log(chalk.cyan('  node close-browser.js <profile_id>  # 특정 프로필 종료'));
    console.log(chalk.cyan('  node close-browser.js --all         # 모든 브라우저 종료'));
    console.log(chalk.cyan('\n예시:'));
    console.log(chalk.gray('  node close-browser.js k123wv1n'));
    console.log(chalk.gray('  node close-browser.js --all'));
    process.exit(1);
  }

  if (arg === '--all' || arg === '-a') {
    await closeAllBrowsers();
  } else {
    await closeBrowser(arg);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('치명적 오류:'), error);
    process.exit(1);
  });
}

module.exports = { closeBrowser, closeAllBrowsers };