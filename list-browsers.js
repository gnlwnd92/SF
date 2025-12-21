#!/usr/bin/env node

/**
 * AdsPower 브라우저 목록 확인
 * 활성/전체 브라우저 목록 표시
 * 
 * 사용법:
 *   node list-browsers.js          # 활성 브라우저만
 *   node list-browsers.js --all    # 모든 프로필
 *   npm run list
 */

const axios = require('axios');
const chalk = require('chalk');
const Table = require('cli-table3');

const ADSPOWER_API_URL = 'http://local.adspower.net:50325';

async function listBrowsers(showAll = false) {
  console.log(chalk.cyan.bold('╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║           AdsPower 브라우저 목록                       ║'));
  console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════╝'));
  console.log();

  try {
    // 모든 프로필 가져오기 (페이징 처리)
    const allProfiles = [];
    let page = 1;
    let hasMore = true;
    
    console.log(chalk.gray('프로필 목록 로딩 중...'));
    
    while (hasMore && page <= 10) { // 최대 10페이지
      await new Promise(resolve => setTimeout(resolve, 200)); // API 제한 방지
      
      const params = { 
        page, 
        page_size: 100
      };
      
      const response = await axios.get(`${ADSPOWER_API_URL}/api/v1/user/list`, { params });
      
      if (response.data.code !== 0) {
        throw new Error(response.data.msg || 'Failed to get browser list');
      }
      
      const profiles = response.data.data.list || [];
      allProfiles.push(...profiles);
      
      if (profiles.length < 100) {
        hasMore = false;
      }
      page++;
    }
    
    const profiles = allProfiles;
    
    if (profiles.length === 0) {
      console.log(chalk.gray(showAll ? '프로필이 없습니다.' : '활성 브라우저가 없습니다.'));
      return;
    }

    // 활성 브라우저 확인
    const activeProfiles = [];
    for (const profile of profiles) {
      try {
        const statusResponse = await axios.get(`${ADSPOWER_API_URL}/api/v1/browser/active`, {
          params: { user_id: profile.user_id }
        });
        
        if (statusResponse.data.code === 0 && statusResponse.data.data.status === 'Active') {
          activeProfiles.push({
            ...profile,
            browserStatus: 'Active',
            debugPort: statusResponse.data.data.debug_port
          });
        } else {
          activeProfiles.push({
            ...profile,
            browserStatus: 'Stopped',
            debugPort: '-'
          });
        }
      } catch {
        activeProfiles.push({
          ...profile,
          browserStatus: 'Unknown',
          debugPort: '-'
        });
      }
    }

    // 테이블 생성
    const table = new Table({
      head: [
        chalk.cyan('프로필 ID'),
        chalk.cyan('이름/이메일'),
        chalk.cyan('상태'),
        chalk.cyan('Debug Port'),
        chalk.cyan('그룹')
      ],
      style: {
        head: [],
        border: []
      }
    });

    // 활성 브라우저 먼저, 그 다음 비활성
    const sortedProfiles = activeProfiles.sort((a, b) => {
      if (a.browserStatus === 'Active' && b.browserStatus !== 'Active') return -1;
      if (a.browserStatus !== 'Active' && b.browserStatus === 'Active') return 1;
      return 0;
    });

    let activeCount = 0;
    sortedProfiles.forEach(profile => {
      const status = profile.browserStatus === 'Active' 
        ? chalk.green('● 실행중') 
        : chalk.gray('○ 중지됨');
      
      if (profile.browserStatus === 'Active') activeCount++;
      
      table.push([
        profile.user_id,
        profile.name || profile.username || '-',
        status,
        profile.debugPort,
        profile.group_name || '-'
      ]);
    });

    console.log(table.toString());
    
    console.log(chalk.cyan(`\n총 ${profiles.length}개 프로필`));
    console.log(chalk.green(`활성: ${activeCount}개`));
    console.log(chalk.gray(`비활성: ${profiles.length - activeCount}개`));
    
    if (!showAll) {
      console.log(chalk.yellow('\n모든 프로필을 보려면: node list-browsers.js --all'));
    }

  } catch (error) {
    console.error(chalk.red('오류:'), error.message);
    if (error.response) {
      console.error(chalk.red('API 응답:'), error.response.data);
    }
  }
}

async function main() {
  const showAll = process.argv.includes('--all') || process.argv.includes('-a');
  await listBrowsers(showAll);
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('치명적 오류:'), error);
    process.exit(1);
  });
}

module.exports = { listBrowsers };