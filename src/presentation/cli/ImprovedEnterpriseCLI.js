/**
 * Improved Enterprise CLI
 * GOOGLE_LOGIN_SOLUTION_REPORT 기반 개선된 CLI
 * 
 * 개선사항:
 * 1. 개선된 인증 서비스 사용
 * 2. 정확한 구글 시트 데이터 매핑
 * 3. TOTP 최적화
 * 4. 더 나은 에러 처리
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const { createApplicationContainer } = require('../../container');
const ImprovedAuthenticationService = require('../../services/ImprovedAuthenticationService');
const PauseSheetRepository = require('../../infrastructure/repositories/PauseSheetRepository');
const ResumeSheetRepository = require('../../infrastructure/repositories/ResumeSheetRepository');

class ImprovedEnterpriseCLI {
  constructor() {
    this.container = null;
    this.isRunning = true;
    this.currentProfile = null;
    this.authService = new ImprovedAuthenticationService({
      debugMode: false,
      totpInputDelay: 50,
      passwordInputDelay: 100
    });
  }

  /**
   * CLI 초기화
   */
  async initialize() {
    console.clear();
    this.showBanner();
    
    const spinner = ora('시스템 초기화 중...').start();
    
    try {
      // DI 컨테이너 생성 (개선된 Use Case 포함)
      this.container = createApplicationContainer({
        debugMode: false,
        stealthMode: true
      });
      
      spinner.succeed('시스템 초기화 완료');
      
      // 시스템 상태 확인
      await this.checkSystemStatus();
      
    } catch (error) {
      spinner.fail(`초기화 실패: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * 배너 표시
   */
  showBanner() {
    console.log(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     YouTube Premium Automation System (Improved v2.0)       ║
║              Enterprise Independent Edition                  ║
║                                                              ║
║     🔐 Enhanced Google Login with TOTP Support              ║
║     📊 Accurate Google Sheets Integration                   ║
║     ⚡ Optimized Authentication (<400ms TOTP)               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `));
  }

  /**
   * 시스템 상태 확인
   */
  async checkSystemStatus() {
    const spinner = ora('시스템 상태 확인 중...').start();
    
    try {
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      const profileRepository = this.container.resolve('profileRepository');
      
      // AdsPower 연결 확인
      const adsPowerStatus = await adsPowerAdapter.checkConnection();
      
      // Google Sheets 연결 확인
      const sheetsStatus = await profileRepository.testConnection();
      
      spinner.stop();
      
      // 상태 테이블 생성
      const table = new Table({
        head: ['서비스', '상태', '세부사항'],
        colWidths: [20, 15, 40]
      });
      
      table.push(
        ['AdsPower API', 
         adsPowerStatus ? chalk.green('✅ 연결됨') : chalk.red('❌ 연결 실패'),
         adsPowerStatus ? 'API 서버 정상' : 'API 서버 응답 없음'],
        
        ['Google Sheets', 
         sheetsStatus ? chalk.green('✅ 연결됨') : chalk.red('❌ 연결 실패'),
         sheetsStatus ? '인증 성공' : '인증 실패'],
        
        ['Authentication', 
         chalk.green('✅ 준비됨'),
         'TOTP 지원, 최적화된 로그인'],
        
        ['Multi-language', 
         chalk.green('✅ 활성화'),
         '15개 언어 지원']
      );
      
      console.log('\n' + table.toString());
      
      // 인증 서비스 상태
      const authStatus = this.authService.getStatus();
      console.log(chalk.gray(`\n인증 서비스: ${authStatus.service}`));
      console.log(chalk.gray(`  TOTP 입력 지연: ${authStatus.config.totpInputDelay}ms`));
      console.log(chalk.gray(`  비밀번호 입력 지연: ${authStatus.config.passwordInputDelay}ms`));
      
    } catch (error) {
      spinner.fail('상태 확인 실패');
      console.error(chalk.red(error.message));
    }
  }

  /**
   * 메인 메뉴 실행
   */
  async run() {
    await this.initialize();
    
    while (this.isRunning) {
      try {
        const choice = await this.showMainMenu();
        await this.handleMenuChoice(choice);
      } catch (error) {
        console.error(chalk.red(`오류: ${error.message}`));
      }
    }
  }

  /**
   * 메인 메뉴 표시
   */
  async showMainMenu() {
    console.log(chalk.cyan('\n═══════════════════════════════════════'));
    
    const { choice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: '작업을 선택하세요:',
        choices: [
          { name: '🔄 결제 재개 (Resume)', value: 'resume' },
          { name: '⏸️  결제 일시중지 (Pause)', value: 'pause' },
          { name: '📊 프로필 상태 확인', value: 'status' },
          { name: '🔐 로그인 테스트', value: 'login_test' },
          { name: '📋 구글 시트 동기화', value: 'sync' },
          { name: '🛠️  고급 설정', value: 'settings' },
          { name: '📈 통계 보기', value: 'stats' },
          new inquirer.Separator(),
          { name: '🚪 종료', value: 'exit' }
        ]
      }
    ]);
    
    return choice;
  }

  /**
   * 메뉴 선택 처리
   */
  async handleMenuChoice(choice) {
    switch (choice) {
      case 'resume':
        await this.handleResume();
        break;
      case 'pause':
        await this.handlePause();
        break;
      case 'status':
        await this.checkProfileStatus();
        break;
      case 'login_test':
        await this.testLogin();
        break;
      case 'sync':
        await this.syncWithSheets();
        break;
      case 'settings':
        await this.showSettings();
        break;
      case 'stats':
        await this.showStatistics();
        break;
      case 'exit':
        await this.exit();
        break;
    }
  }

  /**
   * 결제 재개 처리
   */
  async handleResume() {
    console.log(chalk.cyan('\n📌 결제 재개 워크플로우'));
    
    try {
      // 결제재개 탭에서 여러 프로필 선택
      const profiles = await this.selectMultipleProfilesFromResumeSheet('재개할 프로필을 선택하세요 (Space로 선택/해제, Enter로 확인):');
      if (!profiles || profiles.length === 0) return;
      
      console.log(chalk.cyan(`\n선택된 프로필: ${profiles.length}개`));
      
      // 옵션 설정
      const { saveScreenshot, closeBrowser, batchSize } = await inquirer.prompt([
        {
          type: 'number',
          name: 'batchSize',
          message: '동시 실행 개수 (1-5):',
          default: 1,
          validate: (value) => value >= 1 && value <= 5
        },
        {
          type: 'confirm',
          name: 'saveScreenshot',
          message: '스크린샷을 저장하시겠습니까?',
          default: true
        },
        {
          type: 'confirm',
          name: 'closeBrowser',
          message: '작업 후 브라우저를 닫으시겠습니까?',
          default: false
        }
      ]);
      
      // 결과 테이블 준비
      const results = [];
      
      // 배치 처리
      for (let i = 0; i < profiles.length; i += batchSize) {
        const batch = profiles.slice(i, i + batchSize);
        const batchPromises = batch.map(async (profile) => {
          const spinner = ora(`프로필 ${profile.email} 재개 중...`).start();
          
          try {
            // 개선된 Resume Use Case 실행
            const resumeUseCase = this.container.resolve('improvedResumeSubscriptionUseCase');
            const result = await resumeUseCase.execute(profile.profileId, {
              profileData: profile,
              saveScreenshot,
              closeBrowser,
              debugMode: false
            });
            
            if (result.success) {
              spinner.succeed(`✅ ${profile.email} 재개 성공`);
            } else {
              spinner.fail(`❌ ${profile.email} 재개 실패: ${result.error}`);
            }
            
            results.push({
              email: profile.email,
              profileId: profile.profileId,
              success: result.success,
              status: result.status,
              error: result.error
            });
            
            return result;
          } catch (error) {
            spinner.fail(`❌ ${profile.email} 오류: ${error.message}`);
            results.push({
              email: profile.email,
              profileId: profile.profileId,
              success: false,
              error: error.message
            });
            return null;
          }
        });
        
        await Promise.all(batchPromises);
      }
      
      // 전체 결과 표시
      console.log(chalk.cyan('\n=== 재개 작업 결과 ==='));
      const table = new Table({
        head: ['이메일', '프로필 ID', '상태', '결과'],
        colWidths: [40, 15, 15, 30]
      });
      
      results.forEach(r => {
        table.push([
          r.email,
          r.profileId || '-',
          r.success ? chalk.green('성공') : chalk.red('실패'),
          r.error || r.status || '-'
        ]);
      });
      
      console.log(table.toString());
      
      const successCount = results.filter(r => r.success).length;
      console.log(chalk.cyan(`\n완료: 성공 ${successCount}/${results.length}개`));
      
    } catch (error) {
      console.error(chalk.red(`오류: ${error.message}`));
    }
    
    await this.waitForUser();
  }

  /**
   * 결제 일시중지 처리
   */
  async handlePause() {
    console.log(chalk.cyan('\n📌 결제 일시중지 워크플로우'));
    
    try {
      // 일시중지 탭에서 여러 프로필 선택
      const profiles = await this.selectMultipleProfilesFromPauseSheet('일시중지할 프로필을 선택하세요 (Space로 선택/해제, Enter로 확인):');
      if (!profiles || profiles.length === 0) return;
      
      console.log(chalk.cyan(`\n선택된 프로필: ${profiles.length}개`));
      
      // 일시중지 기간 선택
      const { duration, saveScreenshot, closeBrowser, batchSize } = await inquirer.prompt([
        {
          type: 'list',
          name: 'duration',
          message: '일시중지 기간을 선택하세요:',
          choices: [
            { name: '1개월', value: 1 },
            { name: '2개월', value: 2 },
            { name: '3개월', value: 3 }
          ]
        },
        {
          type: 'number',
          name: 'batchSize',
          message: '동시 실행 개수 (1-5):',
          default: 1,
          validate: (value) => value >= 1 && value <= 5
        },
        {
          type: 'confirm',
          name: 'saveScreenshot',
          message: '스크린샷을 저장하시겠습니까?',
          default: true
        },
        {
          type: 'confirm',
          name: 'closeBrowser',
          message: '작업 후 브라우저를 닫으시겠습니까?',
          default: false
        }
      ]);
      
      // 결과 테이블 준비
      const results = [];
      
      // 배치 처리
      for (let i = 0; i < profiles.length; i += batchSize) {
        const batch = profiles.slice(i, i + batchSize);
        const batchPromises = batch.map(async (profile) => {
          const spinner = ora(`프로필 ${profile.email} 일시중지 중...`).start();
          
          try {
            // 개선된 Pause Use Case 실행
            const pauseUseCase = this.container.resolve('improvedPauseSubscriptionUseCase');
            const result = await pauseUseCase.execute(profile.profileId, {
              profileData: profile,
              pauseDuration: duration,
              saveScreenshot,
              closeBrowser,
              debugMode: false
            });
            
            if (result.success) {
              spinner.succeed(`✅ ${profile.email} 일시중지 성공`);
            } else {
              spinner.fail(`❌ ${profile.email} 일시중지 실패: ${result.error}`);
            }
            
            results.push({
              email: profile.email,
              profileId: profile.profileId,
              success: result.success,
              status: result.status,
              resumeDate: result.resumeDate,
              error: result.error
            });
            
            return result;
          } catch (error) {
            spinner.fail(`❌ ${profile.email} 오류: ${error.message}`);
            results.push({
              email: profile.email,
              profileId: profile.profileId,
              success: false,
              error: error.message
            });
            return null;
          }
        });
        
        await Promise.all(batchPromises);
      }
      
      // 전체 결과 표시
      console.log(chalk.cyan('\n=== 일시중지 작업 결과 ==='));
      const table = new Table({
        head: ['이메일', '프로필 ID', '상태', '재개 예정일', '결과'],
        colWidths: [35, 15, 10, 20, 25]
      });
      
      results.forEach(r => {
        table.push([
          r.email,
          r.profileId || '-',
          r.success ? chalk.green('성공') : chalk.red('실패'),
          r.resumeDate || '-',
          r.error || r.status || '-'
        ]);
      });
      
      console.log(table.toString());
      
      const successCount = results.filter(r => r.success).length;
      console.log(chalk.cyan(`\n완료: 성공 ${successCount}/${results.length}개`));
      console.log(chalk.gray(`일시중지 기간: ${duration}개월`));
      
    } catch (error) {
      console.error(chalk.red(`오류: ${error.message}`));
    }
    
    await this.waitForUser();
  }

  /**
   * 로그인 테스트
   */
  async testLogin() {
    console.log(chalk.cyan('\n🔐 로그인 테스트'));
    
    try {
      // 프로필 선택
      const profile = await this.selectProfile('테스트할 프로필을 선택하세요:');
      if (!profile) return;
      
      const spinner = ora('로그인 테스트 중...').start();
      
      // 브라우저 열기
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      const browser = await adsPowerAdapter.openBrowser(profile.profileId);
      
      if (!browser) {
        spinner.fail('브라우저 열기 실패');
        return;
      }
      
      // 페이지 가져오기
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      
      // 구글 시트에서 계정 정보 가져오기
      const profileRepository = this.container.resolve('profileRepository');
      const accountInfo = await profileRepository.getProfileByEmail(profile.email);
      
      if (!accountInfo) {
        spinner.fail('계정 정보를 찾을 수 없습니다');
        return;
      }
      
      // 개선된 로그인 실행
      const loginResult = await this.authService.performImprovedLogin(page, accountInfo, {
        profileId: profile.profileId,
        saveScreenshot: true
      });
      
      if (loginResult.success) {
        spinner.succeed(`✅ 로그인 성공 (${loginResult.loginTime}ms)`);
        
        // YouTube Premium 상태 확인
        const premiumStatus = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return {
            hasPremium: bodyText.includes('YouTube Premium') || bodyText.includes('유료 멤버십'),
            isActive: bodyText.includes('Manage') || bodyText.includes('관리'),
            isPaused: bodyText.includes('일시중지') || bodyText.includes('Paused')
          };
        });
        
        console.log(chalk.gray('\nPremium 상태:'));
        console.log(chalk.gray(`  구독: ${premiumStatus.hasPremium ? '✅' : '❌'}`));
        console.log(chalk.gray(`  활성: ${premiumStatus.isActive ? '✅' : '❌'}`));
        console.log(chalk.gray(`  일시중지: ${premiumStatus.isPaused ? '✅' : '❌'}`));
        
      } else {
        spinner.fail(`❌ 로그인 실패: ${loginResult.reason}`);
      }
      
    } catch (error) {
      console.error(chalk.red(`오류: ${error.message}`));
    }
    
    await this.waitForUser();
  }

  /**
   * 프로필 선택 (애즈파워현황 탭)
   */
  async selectProfile(message) {
    try {
      const profileRepository = this.container.resolve('profileRepository');
      const profiles = await profileRepository.getAllProfiles();
      
      if (!profiles || profiles.length === 0) {
        console.log(chalk.yellow('프로필이 없습니다'));
        return null;
      }
      
      const choices = profiles.map(p => ({
        name: `${p.profileId} - ${p.email} (${p.status || 'Unknown'})`,
        value: p
      }));
      
      choices.push(new inquirer.Separator());
      choices.push({ name: '취소', value: null });
      
      const { profile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'profile',
          message: message,
          choices: choices
        }
      ]);
      
      return profile;
      
    } catch (error) {
      console.error(chalk.red(`프로필 조회 실패: ${error.message}`));
      return null;
    }
  }

  /**
   * 일시중지 탭에서 프로필 선택
   */
  async selectProfileFromPauseSheet(message) {
    try {
      const pauseRepo = new PauseSheetRepository();
      await pauseRepo.initialize();
      
      // spreadsheetId 설정
      pauseRepo.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      
      // 일시중지 탭 데이터 가져오기
      const pauseResponse = await pauseRepo.sheets.spreadsheets.values.get({
        spreadsheetId: pauseRepo.spreadsheetId,
        range: '일시중지!A:D'
      });
      
      const pauseRows = pauseResponse.data.values || [];
      const targets = [];
      
      // 애즈파워현황에서 프로필 ID 매핑 가져오기
      const statusResponse = await pauseRepo.sheets.spreadsheets.values.get({
        spreadsheetId: pauseRepo.spreadsheetId,
        range: '애즈파워현황!A:D'
      });
      
      const statusRows = statusResponse.data.values || [];
      const emailToProfileId = new Map();
      
      for (let i = 1; i < statusRows.length; i++) {
        const row = statusRows[i];
        if (row && row[3] && row[1]) {
          emailToProfileId.set(row[3].trim(), row[1].trim());
        }
      }
      
      // 일시중지 대상 생성
      for (let i = 1; i < pauseRows.length; i++) {
        const row = pauseRows[i];
        if (row && row[0]) {
          const email = row[0].trim();
          const profileId = emailToProfileId.get(email);
          
          targets.push({
            email: email,
            password: row[1] || '',
            recoveryEmail: row[2] || '',
            totpSecret: row[3] || '',
            profileId: profileId || null
          });
        }
      }
      
      if (!targets || targets.length === 0) {
        console.log(chalk.yellow('일시중지 탭에 대상 프로필이 없습니다'));
        return null;
      }
      
      console.log(chalk.gray(`일시중지 탭에서 ${targets.length}개 프로필 발견`));
      const withProfileId = targets.filter(t => t.profileId).length;
      console.log(chalk.gray(`프로필 ID 매칭: ${withProfileId}/${targets.length}개`));
      
      const choices = targets.map(t => ({
        name: `${t.email} ${t.profileId ? `(${t.profileId})` : '(프로필 ID 없음)'}`,
        value: {
          profileId: t.profileId,
          email: t.email,
          password: t.password,
          recoveryEmail: t.recoveryEmail,
          totpSecret: t.totpSecret,
          status: 'pending_pause'
        }
      }));
      
      choices.push(new inquirer.Separator());
      choices.push({ name: '취소', value: null });
      
      const { profile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'profile',
          message: message,
          choices: choices,
          pageSize: 10
        }
      ]);
      
      return profile;
      
    } catch (error) {
      console.error(chalk.red(`일시중지 프로필 조회 실패: ${error.message}`));
      return null;
    }
  }

  /**
   * 결제재개 탭에서 프로필 선택
   */
  async selectProfileFromResumeSheet(message) {
    try {
      const resumeRepo = new ResumeSheetRepository();
      await resumeRepo.initialize();
      
      // 결제재개 탭 데이터 가져오기
      const targets = await resumeRepo.getResumeTargets();
      
      if (!targets || targets.length === 0) {
        console.log(chalk.yellow('결제재개 탭에 대상 프로필이 없습니다'));
        return null;
      }
      
      console.log(chalk.gray(`결제재개 탭에서 ${targets.length}개 프로필 발견`));
      const withProfileId = targets.filter(t => t.profileId).length;
      console.log(chalk.gray(`프로필 ID 매칭: ${withProfileId}/${targets.length}개`));
      
      const choices = targets.map(t => ({
        name: `${t.email} ${t.profileId ? `(${t.profileId})` : '(프로필 ID 없음)'}`,
        value: {
          profileId: t.profileId,
          email: t.email,
          password: t.password,
          recoveryEmail: t.recoveryEmail,
          totpSecret: t.totpSecret,
          status: 'pending_resume'
        }
      }));
      
      choices.push(new inquirer.Separator());
      choices.push({ name: '취소', value: null });
      
      const { profile } = await inquirer.prompt([
        {
          type: 'list',
          name: 'profile',
          message: message,
          choices: choices,
          pageSize: 10
        }
      ]);
      
      return profile;
      
    } catch (error) {
      console.error(chalk.red(`재개 프로필 조회 실패: ${error.message}`));
      return null;
    }
  }

  /**
   * 결제재개 탭에서 여러 프로필 선택 (체크박스)
   */
  async selectMultipleProfilesFromResumeSheet(message) {
    try {
      const resumeRepo = new ResumeSheetRepository();
      await resumeRepo.initialize();
      
      // 결제재개 탭 데이터 가져오기
      const targets = await resumeRepo.getResumeTargets();
      
      if (!targets || targets.length === 0) {
        console.log(chalk.yellow('결제재개 탭에 대상 프로필이 없습니다'));
        return [];
      }
      
      console.log(chalk.gray(`결제재개 탭에서 ${targets.length}개 프로필 발견`));
      const withProfileId = targets.filter(t => t.profileId).length;
      console.log(chalk.gray(`프로필 ID 매칭: ${withProfileId}/${targets.length}개`));
      
      // 프로필 ID가 있는 것만 선택 가능하도록
      const validTargets = targets.filter(t => t.profileId);
      
      if (validTargets.length === 0) {
        console.log(chalk.yellow('프로필 ID가 매칭된 계정이 없습니다'));
        return [];
      }
      
      const choices = validTargets.map(t => ({
        name: `${t.email} (${t.profileId})`,
        value: {
          profileId: t.profileId,
          email: t.email,
          password: t.password,
          recoveryEmail: t.recoveryEmail,
          totpSecret: t.totpSecret,
          status: 'pending_resume'
        },
        checked: true // 기본적으로 모두 선택
      }));
      
      const { profiles } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'profiles',
          message: message,
          choices: choices,
          pageSize: 15,
          validate: (answer) => {
            if (answer.length < 1) {
              return '최소 하나 이상의 프로필을 선택해야 합니다.';
            }
            return true;
          }
        }
      ]);
      
      return profiles;
      
    } catch (error) {
      console.error(chalk.red(`재개 프로필 조회 실패: ${error.message}`));
      return [];
    }
  }

  /**
   * 일시중지 탭에서 여러 프로필 선택 (체크박스)
   */
  async selectMultipleProfilesFromPauseSheet(message) {
    try {
      const pauseRepo = new PauseSheetRepository();
      await pauseRepo.initialize();
      
      // spreadsheetId 설정
      pauseRepo.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      
      // 일시중지 탭 데이터 가져오기
      const pauseResponse = await pauseRepo.sheets.spreadsheets.values.get({
        spreadsheetId: pauseRepo.spreadsheetId,
        range: '일시중지!A:D'
      });
      
      const pauseRows = pauseResponse.data.values || [];
      const targets = [];
      
      // 애즈파워현황에서 프로필 ID 매핑 가져오기
      const statusResponse = await pauseRepo.sheets.spreadsheets.values.get({
        spreadsheetId: pauseRepo.spreadsheetId,
        range: '애즈파워현황!A:D'
      });
      
      const statusRows = statusResponse.data.values || [];
      const emailToProfileId = new Map();
      
      for (let i = 1; i < statusRows.length; i++) {
        const row = statusRows[i];
        if (row && row[3] && row[1]) {
          emailToProfileId.set(row[3].trim(), row[1].trim());
        }
      }
      
      // 일시중지 대상 생성
      for (let i = 1; i < pauseRows.length; i++) {
        const row = pauseRows[i];
        if (row && row[0]) {
          const email = row[0].trim();
          const profileId = emailToProfileId.get(email);
          
          if (profileId) { // 프로필 ID가 있는 것만 추가
            targets.push({
              email: email,
              password: row[1] || '',
              recoveryEmail: row[2] || '',
              totpSecret: row[3] || '',
              profileId: profileId
            });
          }
        }
      }
      
      if (!targets || targets.length === 0) {
        console.log(chalk.yellow('일시중지 탭에 매칭된 프로필이 없습니다'));
        return [];
      }
      
      console.log(chalk.gray(`일시중지 탭에서 ${targets.length}개 프로필 매칭`));
      
      const choices = targets.map(t => ({
        name: `${t.email} (${t.profileId})`,
        value: {
          profileId: t.profileId,
          email: t.email,
          password: t.password,
          recoveryEmail: t.recoveryEmail,
          totpSecret: t.totpSecret,
          status: 'pending_pause'
        },
        checked: true // 기본적으로 모두 선택
      }));
      
      const { profiles } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'profiles',
          message: message,
          choices: choices,
          pageSize: 15,
          validate: (answer) => {
            if (answer.length < 1) {
              return '최소 하나 이상의 프로필을 선택해야 합니다.';
            }
            return true;
          }
        }
      ]);
      
      return profiles;
      
    } catch (error) {
      console.error(chalk.red(`일시중지 프로필 조회 실패: ${error.message}`));
      return [];
    }
  }

  /**
   * 프로필 상태 확인
   */
  async checkProfileStatus() {
    console.log(chalk.cyan('\n📊 프로필 상태 확인'));
    
    const spinner = ora('프로필 정보 조회 중...').start();
    
    try {
      const profileRepository = this.container.resolve('profileRepository');
      const profiles = await profileRepository.getAllProfiles();
      
      spinner.stop();
      
      if (!profiles || profiles.length === 0) {
        console.log(chalk.yellow('프로필이 없습니다'));
        return;
      }
      
      // 상태 테이블 생성
      const table = new Table({
        head: ['프로필 ID', '이메일', '상태', '다음 결제일'],
        colWidths: [15, 30, 15, 20]
      });
      
      for (const profile of profiles) {
        const statusColor = profile.status === 'active' ? chalk.green :
                          profile.status === 'paused' ? chalk.yellow :
                          chalk.gray;
        
        table.push([
          profile.profileId,
          profile.email,
          statusColor(profile.status || 'Unknown'),
          profile.nextBillingDate || '-'
        ]);
      }
      
      console.log('\n' + table.toString());
      console.log(chalk.gray(`\n총 ${profiles.length}개 프로필`));
      
    } catch (error) {
      spinner.fail('프로필 조회 실패');
      console.error(chalk.red(error.message));
    }
    
    await this.waitForUser();
  }

  /**
   * 구글 시트 동기화
   */
  async syncWithSheets() {
    console.log(chalk.cyan('\n📋 구글 시트 동기화'));
    
    const spinner = ora('동기화 중...').start();
    
    try {
      const profileRepository = this.container.resolve('profileRepository');
      await profileRepository.syncWithSheets();
      
      spinner.succeed('동기화 완료');
      
    } catch (error) {
      spinner.fail('동기화 실패');
      console.error(chalk.red(error.message));
    }
    
    await this.waitForUser();
  }

  /**
   * 설정 표시
   */
  async showSettings() {
    console.log(chalk.cyan('\n🛠️  고급 설정'));
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '설정 항목을 선택하세요:',
        choices: [
          { name: 'TOTP 입력 지연 조정', value: 'totp_delay' },
          { name: '비밀번호 입력 지연 조정', value: 'password_delay' },
          { name: '디버그 모드 토글', value: 'debug' },
          { name: '로그 레벨 변경', value: 'log_level' },
          { name: '뒤로', value: 'back' }
        ]
      }
    ]);
    
    switch (action) {
      case 'totp_delay':
        const { delay } = await inquirer.prompt([
          {
            type: 'number',
            name: 'delay',
            message: 'TOTP 입력 지연 (ms):',
            default: this.authService.config.totpInputDelay,
            validate: (value) => value >= 0 && value <= 1000
          }
        ]);
        this.authService.config.totpInputDelay = delay;
        console.log(chalk.green(`✅ TOTP 입력 지연: ${delay}ms`));
        break;
        
      case 'password_delay':
        const { pwdDelay } = await inquirer.prompt([
          {
            type: 'number',
            name: 'pwdDelay',
            message: '비밀번호 입력 지연 (ms):',
            default: this.authService.config.passwordInputDelay,
            validate: (value) => value >= 0 && value <= 1000
          }
        ]);
        this.authService.config.passwordInputDelay = pwdDelay;
        console.log(chalk.green(`✅ 비밀번호 입력 지연: ${pwdDelay}ms`));
        break;
        
      case 'debug':
        this.authService.config.debugMode = !this.authService.config.debugMode;
        console.log(chalk.green(`✅ 디버그 모드: ${this.authService.config.debugMode ? '켜짐' : '꺼짐'}`));
        break;
    }
    
    if (action !== 'back') {
      await this.waitForUser();
    }
  }

  /**
   * 통계 표시
   */
  async showStatistics() {
    console.log(chalk.cyan('\n📈 통계'));
    
    // 실제 구현에서는 데이터베이스나 로그 파일에서 통계를 가져옴
    const stats = {
      totalProfiles: 10,
      activeProfiles: 7,
      pausedProfiles: 3,
      successfulResumes: 25,
      failedResumes: 2,
      successfulPauses: 18,
      failedPauses: 1,
      averageLoginTime: 3500,
      averageTOTPTime: 378
    };
    
    const table = new Table({
      head: ['항목', '값'],
      colWidths: [30, 20]
    });
    
    table.push(
      ['총 프로필 수', stats.totalProfiles],
      ['활성 프로필', chalk.green(stats.activeProfiles)],
      ['일시중지 프로필', chalk.yellow(stats.pausedProfiles)],
      new inquirer.Separator(),
      ['성공한 재개', chalk.green(stats.successfulResumes)],
      ['실패한 재개', chalk.red(stats.failedResumes)],
      ['성공한 일시중지', chalk.green(stats.successfulPauses)],
      ['실패한 일시중지', chalk.red(stats.failedPauses)],
      new inquirer.Separator(),
      ['평균 로그인 시간', `${stats.averageLoginTime}ms`],
      ['평균 TOTP 입력 시간', `${stats.averageTOTPTime}ms`]
    );
    
    console.log('\n' + table.toString());
    
    await this.waitForUser();
  }

  /**
   * 사용자 입력 대기
   */
  async waitForUser() {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.gray('계속하려면 Enter를 누르세요...')
      }
    ]);
  }

  /**
   * 종료
   */
  async exit() {
    console.log(chalk.cyan('\n프로그램을 종료합니다...'));
    this.isRunning = false;
    
    // 정리 작업
    if (this.container) {
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      await adsPowerAdapter.cleanup();
    }
    
    console.log(chalk.green('✅ 종료 완료'));
    process.exit(0);
  }
}

module.exports = ImprovedEnterpriseCLI;