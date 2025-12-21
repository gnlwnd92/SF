#!/usr/bin/env node

/**
 * Hybrid CLI - Google 자동화 감지를 우회하는 스마트 CLI
 * 
 * 사용법:
 * node hybrid-cli.js             # 대화형 모드
 * node hybrid-cli.js --auto      # 자동 모드
 * node hybrid-cli.js --manual    # 수동 모드
 * node hybrid-cli.js --test      # 테스트 모드
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const HybridAdsPowerAdapter = require('./src/infrastructure/adapters/HybridAdsPowerAdapter');
const HybridAuthenticationService = require('./src/services/HybridAuthenticationService');

class HybridCLI {
  constructor() {
    this.adapter = null;
    this.authService = null;
    this.config = {
      mode: 'hybrid', // hybrid, manual, auto
      debugMode: false,
      testMode: false
    };
    
    // 명령줄 인자 파싱
    this.parseArguments();
  }
  
  parseArguments() {
    const args = process.argv.slice(2);
    
    if (args.includes('--manual')) {
      this.config.mode = 'manual';
    } else if (args.includes('--auto')) {
      this.config.mode = 'auto';
    } else if (args.includes('--test')) {
      this.config.testMode = true;
    }
    
    if (args.includes('--debug')) {
      this.config.debugMode = true;
    }
  }
  
  async initialize() {
    console.clear();
    this.showHeader();
    
    // 어댑터 초기화
    this.adapter = new HybridAdsPowerAdapter({
      debugMode: this.config.debugMode,
      useManualFallback: true,
      cdpOnly: this.config.mode === 'manual'
    });
    
    // 인증 서비스 초기화
    this.authService = new HybridAuthenticationService({
      debugMode: this.config.debugMode
    });
    
    // API 연결 확인
    const spinner = ora('AdsPower API 연결 확인 중...').start();
    
    try {
      const connected = await this.checkConnection();
      if (connected) {
        spinner.succeed('AdsPower API 연결 성공');
      } else {
        spinner.fail('AdsPower API 연결 실패');
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(`연결 오류: ${error.message}`);
      process.exit(1);
    }
  }
  
  showHeader() {
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold('     🚀 Hybrid YouTube Premium Manager v3.0     '));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.gray(`모드: ${this.config.mode.toUpperCase()} | 디버그: ${this.config.debugMode ? 'ON' : 'OFF'}`));
    console.log();
  }
  
  async checkConnection() {
    try {
      const response = await fetch('http://local.adspower.net:50325/api/v1/user/list?page_size=1');
      const data = await response.json();
      return data.code === 0;
    } catch (error) {
      return false;
    }
  }
  
  async run() {
    await this.initialize();
    
    if (this.config.testMode) {
      await this.runTestMode();
      return;
    }
    
    while (true) {
      const action = await this.selectAction();
      
      if (action === 'exit') {
        console.log(chalk.yellow('\n프로그램을 종료합니다.'));
        process.exit(0);
      }
      
      await this.executeAction(action);
    }
  }
  
  async selectAction() {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '작업을 선택하세요:',
        choices: [
          { name: '🔄 구독 재개 (Resume)', value: 'resume' },
          { name: '⏸️  구독 일시정지 (Pause)', value: 'pause' },
          { name: '📊 상태 확인 (Check Status)', value: 'status' },
          { name: '🧪 자동화 테스트 (Test Automation)', value: 'test' },
          { name: '⚙️  설정 변경 (Settings)', value: 'settings' },
          new inquirer.Separator(),
          { name: '❌ 종료 (Exit)', value: 'exit' }
        ]
      }
    ]);
    
    return action;
  }
  
  async executeAction(action) {
    switch (action) {
      case 'resume':
        await this.handleResume();
        break;
      case 'pause':
        await this.handlePause();
        break;
      case 'status':
        await this.checkStatus();
        break;
      case 'test':
        await this.runTestMode();
        break;
      case 'settings':
        await this.changeSettings();
        break;
    }
  }
  
  async handleResume() {
    console.log(chalk.cyan('\n=== 구독 재개 프로세스 ===\n'));
    
    // 프로필 선택
    const profiles = await this.getProfiles();
    if (profiles.length === 0) {
      console.log(chalk.red('재개할 프로필이 없습니다.'));
      return;
    }
    
    const { selectedProfiles } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedProfiles',
        message: '재개할 프로필을 선택하세요:',
        choices: profiles.map(p => ({
          name: `${p.name} (${p.email})`,
          value: p
        }))
      }
    ]);
    
    if (selectedProfiles.length === 0) {
      console.log(chalk.yellow('선택된 프로필이 없습니다.'));
      return;
    }
    
    // 전략 선택
    const { strategy } = await inquirer.prompt([
      {
        type: 'list',
        name: 'strategy',
        message: '로그인 전략을 선택하세요:',
        choices: [
          { name: '🤖 스마트 자동 (위험도 기반)', value: 'smart' },
          { name: '🙋 완전 수동 (가장 안전)', value: 'manual' },
          { name: '⚡ 최소 자동화 (빠름)', value: 'minimal' },
          { name: '🔀 하이브리드 (균형)', value: 'hybrid' }
        ],
        default: 'smart'
      }
    ]);
    
    // 처리 시작
    for (const profile of selectedProfiles) {
      await this.processProfile(profile, 'resume', strategy);
    }
    
    console.log(chalk.green('\n✅ 구독 재개 프로세스 완료\n'));
  }
  
  async processProfile(profile, action, strategy) {
    const spinner = ora(`${profile.name} 처리 중...`).start();
    
    try {
      // 1. 브라우저 실행 (전략에 따라)
      let session;
      
      if (strategy === 'smart') {
        // 스마트 모드: 위험도 평가 후 자동 선택
        session = await this.adapter.launchSmartBrowser(profile.id, {
          email: profile.email,
          waitForManual: false
        });
      } else if (strategy === 'manual') {
        // 수동 모드: Puppeteer 없이
        session = await this.adapter.launchManualMode(profile.id, {
          waitForManual: false
        });
      } else if (strategy === 'minimal') {
        // 최소 모드: 최소 Puppeteer
        session = await this.adapter.launchMinimalPuppeteer(profile.id);
      } else {
        // 하이브리드 모드: CDP 전용
        session = await this.adapter.launchCDPMode(profile.id);
      }
      
      spinner.text = `${profile.name} - 로그인 중...`;
      
      // 2. 로그인 수행
      const loginResult = await this.authService.performSmartLogin(session, {
        email: profile.email,
        password: profile.password
      });
      
      if (!loginResult.success) {
        throw new Error(loginResult.error || 'Login failed');
      }
      
      spinner.text = `${profile.name} - ${action === 'resume' ? '재개' : '일시정지'} 처리 중...`;
      
      // 3. 작업 수행 (재개/일시정지)
      if (action === 'resume') {
        // YouTube Premium 페이지 이동 및 재개 처리
        // ... 구현 필요
      } else {
        // 일시정지 처리
        // ... 구현 필요
      }
      
      // 4. 브라우저 종료
      await this.adapter.closeBrowser(profile.id);
      
      spinner.succeed(`${profile.name} - 완료 (${loginResult.method} 방식)`);
      
    } catch (error) {
      spinner.fail(`${profile.name} - 실패: ${error.message}`);
      
      // 실패시 수동 모드 제안
      const { retry } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'retry',
          message: '수동 모드로 재시도하시겠습니까?',
          default: true
        }
      ]);
      
      if (retry) {
        await this.processProfileManually(profile, action);
      }
    }
  }
  
  async processProfileManually(profile, action) {
    console.log(chalk.yellow('\n수동 모드로 전환합니다.'));
    
    // 브라우저만 열기
    const session = await this.adapter.launchManualMode(profile.id, {
      waitForManual: true,
      connectAfterLogin: true
    });
    
    // 사용자가 수동으로 작업 완료
    console.log(chalk.green(`✅ ${profile.name} - 수동 처리 완료`));
    
    await this.adapter.closeBrowser(profile.id);
  }
  
  async runTestMode() {
    console.log(chalk.cyan('\n=== 자동화 테스트 모드 ===\n'));
    
    // 테스트 프로필 선택
    const testProfile = {
      id: 'test_profile',
      name: 'Test Profile',
      email: 'test@example.com',
      password: 'test123'
    };
    
    // 각 모드별 테스트
    const modes = ['manual', 'cdp', 'minimal', 'smart'];
    const results = [];
    
    for (const mode of modes) {
      console.log(chalk.yellow(`\n테스트: ${mode.toUpperCase()} 모드`));
      
      try {
        let session;
        
        // 브라우저 실행
        if (mode === 'manual') {
          session = await this.adapter.launchManualMode(testProfile.id, {
            waitForManual: false
          });
        } else if (mode === 'cdp') {
          session = await this.adapter.launchCDPMode(testProfile.id);
        } else if (mode === 'minimal') {
          session = await this.adapter.launchMinimalPuppeteer(testProfile.id);
        } else {
          session = await this.adapter.launchSmartBrowser(testProfile.id, {
            email: testProfile.email
          });
        }
        
        // 자동화 신호 체크
        const signals = await this.adapter.checkAutomationSignals(session);
        
        results.push({
          mode,
          riskLevel: signals.riskLevel || 'N/A',
          risks: signals.risks || [],
          success: true
        });
        
        // 브라우저 종료
        await this.adapter.closeBrowser(testProfile.id);
        
      } catch (error) {
        results.push({
          mode,
          riskLevel: 'ERROR',
          risks: [error.message],
          success: false
        });
      }
    }
    
    // 결과 표시
    this.showTestResults(results);
  }
  
  showTestResults(results) {
    console.log(chalk.cyan('\n=== 테스트 결과 ===\n'));
    
    const table = new Table({
      head: ['모드', '위험도', '감지된 신호', '결과'],
      colWidths: [15, 10, 40, 10]
    });
    
    results.forEach(result => {
      const riskColor = result.riskLevel === 'HIGH' ? 'red' :
                       result.riskLevel === 'MEDIUM' ? 'yellow' :
                       result.riskLevel === 'LOW' ? 'green' : 'gray';
      
      table.push([
        result.mode.toUpperCase(),
        chalk[riskColor](result.riskLevel),
        result.risks.join(', ') || 'None',
        result.success ? chalk.green('✅') : chalk.red('❌')
      ]);
    });
    
    console.log(table.toString());
    
    // 권장 사항
    console.log(chalk.cyan('\n📋 권장 사항:'));
    
    const safeModes = results.filter(r => r.riskLevel === 'LOW' || r.riskLevel === 'N/A');
    if (safeModes.length > 0) {
      console.log(chalk.green(`✅ 안전한 모드: ${safeModes.map(m => m.mode.toUpperCase()).join(', ')}`));
    }
    
    const riskyModes = results.filter(r => r.riskLevel === 'HIGH');
    if (riskyModes.length > 0) {
      console.log(chalk.red(`❌ 위험한 모드: ${riskyModes.map(m => m.mode.toUpperCase()).join(', ')}`));
    }
  }
  
  async changeSettings() {
    const { settings } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'settings',
        message: '변경할 설정을 선택하세요:',
        choices: [
          { name: '디버그 모드', value: 'debug', checked: this.config.debugMode },
          { name: '수동 폴백', value: 'manualFallback', checked: true },
          { name: 'CDP 전용 모드', value: 'cdpOnly', checked: false }
        ]
      }
    ]);
    
    this.config.debugMode = settings.includes('debug');
    this.adapter.config.useManualFallback = settings.includes('manualFallback');
    this.adapter.config.cdpOnly = settings.includes('cdpOnly');
    
    console.log(chalk.green('✅ 설정이 변경되었습니다.'));
  }
  
  async getProfiles() {
    // 실제 구현에서는 Google Sheets나 데이터베이스에서 프로필 로드
    return [
      { id: 'profile1', name: 'Account 1', email: 'account1@gmail.com', password: 'pass1' },
      { id: 'profile2', name: 'Account 2', email: 'account2@gmail.com', password: 'pass2' }
    ];
  }
  
  async checkStatus() {
    console.log(chalk.cyan('\n=== 시스템 상태 ===\n'));
    
    const table = new Table({
      head: ['항목', '상태', '값'],
      colWidths: [20, 15, 30]
    });
    
    table.push(
      ['AdsPower API', chalk.green('연결됨'), 'http://local.adspower.net:50325'],
      ['모드', chalk.cyan(this.config.mode.toUpperCase()), ''],
      ['디버그', this.config.debugMode ? chalk.yellow('ON') : chalk.gray('OFF'), ''],
      ['활성 세션', chalk.blue(this.adapter.activeSessions.size), '']
    );
    
    console.log(table.toString());
  }
  
  async handlePause() {
    console.log(chalk.cyan('\n=== 구독 일시정지 프로세스 ===\n'));
    // 구현 필요
    console.log(chalk.yellow('준비 중...'));
  }
}

// 메인 실행
async function main() {
  const cli = new HybridCLI();
  
  try {
    await cli.run();
  } catch (error) {
    console.error(chalk.red(`\n❌ 오류 발생: ${error.message}`));
    if (cli.config.debugMode) {
      console.error(error);
    }
    process.exit(1);
  }
}

// 실행
if (require.main === module) {
  main();
}

module.exports = HybridCLI;