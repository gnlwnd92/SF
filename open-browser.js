#!/usr/bin/env node

/**
 * AdsPower 브라우저 직접 실행 명령어
 * 특정 프로필 ID로 브라우저를 GUI와 동일하게 실행
 * 
 * 사용법:
 *   node open-browser.js k123wv1n
 *   npm run open k123wv1n
 */

const axios = require('axios');
const chalk = require('chalk');
const ora = require('ora');

const ADSPOWER_API_URL = 'http://local.adspower.net:50325';

async function openBrowser(profileId) {
  if (!profileId) {
    console.error(chalk.red('❌ 프로필 ID가 필요합니다!'));
    console.log(chalk.yellow('\n사용법:'));
    console.log(chalk.cyan('  node open-browser.js <profile_id>'));
    console.log(chalk.cyan('  예시: node open-browser.js k123wv1n'));
    process.exit(1);
  }

  console.log(chalk.cyan.bold('╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║           AdsPower 브라우저 직접 실행                  ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════╝'));
  console.log();
  
  console.log(chalk.yellow('설정:'));
  console.log(chalk.gray(`  프로필 ID: ${profileId}`));
  console.log(chalk.gray(`  실행 모드: GUI 동일 (최소 파라미터)`));
  console.log();

  const spinner = ora('브라우저 상태 확인 중...').start();

  try {
    // 1. 먼저 브라우저 상태 확인
    spinner.text = '기존 브라우저 상태 확인 중...';
    const statusResponse = await axios.get(`${ADSPOWER_API_URL}/api/v1/browser/active`, {
      params: { user_id: profileId }
    }).catch(() => null);

    if (statusResponse && statusResponse.data.code === 0 && statusResponse.data.data.status === 'Active') {
      spinner.succeed(chalk.green('브라우저가 이미 실행 중입니다'));
      console.log(chalk.gray(`  Debug Port: ${statusResponse.data.data.debug_port}`));
      console.log(chalk.gray(`  WebSocket: ${statusResponse.data.data.ws?.puppeteer}`));
      
      console.log(chalk.yellow('\n브라우저가 이미 열려있습니다.'));
      return statusResponse.data.data;
    }

    // 2. 브라우저 시작 (GUI와 동일하게 최소 파라미터)
    spinner.text = 'AdsPower 브라우저 시작 중...';
    
    const params = {
      user_id: profileId
      // GUI "Open" 버튼과 동일하게 다른 파라미터 생략
    };

    const response = await axios.get(`${ADSPOWER_API_URL}/api/v1/browser/start`, {
      params,
      timeout: 30000
    });

    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Failed to launch browser');
    }

    const data = response.data.data;
    spinner.succeed(chalk.green('브라우저 실행 성공!'));
    
    console.log(chalk.cyan('\n브라우저 정보:'));
    console.log(chalk.gray(`  Debug Port: ${data.debug_port}`));
    console.log(chalk.gray(`  WebSocket: ${data.ws.puppeteer}`));
    console.log(chalk.gray(`  Selenium: ${data.webdriver}`));
    
    console.log(chalk.green.bold('\n✅ 브라우저가 성공적으로 실행되었습니다!'));
    console.log(chalk.yellow('브라우저 창에서 직접 작업을 진행하세요.'));
    
    // Puppeteer 연결 정보 표시
    console.log(chalk.cyan('\nPuppeteer 연결 정보:'));
    console.log(chalk.gray('const browser = await puppeteer.connect({'));
    console.log(chalk.gray(`  browserWSEndpoint: '${data.ws.puppeteer}'`));
    console.log(chalk.gray('});'));
    
    return data;

  } catch (error) {
    spinner.fail(chalk.red('브라우저 실행 실패'));
    console.error(chalk.red('\n오류 내용:'), error.message);
    
    if (error.response) {
      console.error(chalk.red('API 응답:'), error.response.data);
    }
    
    process.exit(1);
  }
}

// 메인 실행
async function main() {
  const profileId = process.argv[2];
  await openBrowser(profileId);
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('치명적 오류:'), error);
    process.exit(1);
  });
}

module.exports = { openBrowser };