// [v2.8] 조건부 로깅 헬퍼
const DEBUG_STARTUP = process.env.DEBUG_STARTUP === 'true';
const debugLog = (msg) => { if (DEBUG_STARTUP) console.log(msg); };

debugLog('[EnterpriseCLI] Loading dependencies...');

const inquirer = require('inquirer').default || require('inquirer');
debugLog('[EnterpriseCLI] inquirer loaded');

const chalk = require('chalk');
debugLog('[EnterpriseCLI] chalk loaded');

const ora = require('ora').default || require('ora');
debugLog('[EnterpriseCLI] ora loaded');

const Table = require('cli-table3');
debugLog('[EnterpriseCLI] cli-table3 loaded');

debugLog('[EnterpriseCLI] Loading container...');
// 전체 컨테이너 사용 (enhancedResumeSubscriptionUseCase 포함)
const { setupContainer } = require('../../container');
debugLog('[EnterpriseCLI] container loaded');

// 통합워커 기본값 (단일 소스)
const WORKER_DEFAULTS = require('../../config/workerDefaults');

// WorkingAuthenticationService와 GoogleLoginHelperMinimal은 로드 문제가 있을 수 있으므로 나중에 로드
let WorkingAuthenticationService = null;
let GoogleLoginHelperMinimal = null;

try {
  debugLog('[EnterpriseCLI] Loading WorkingAuthenticationService...');
  WorkingAuthenticationService = require('../../services/WorkingAuthenticationService');
  debugLog('[EnterpriseCLI] WorkingAuthenticationService loaded');
} catch (e) {
  debugLog('[EnterpriseCLI] WorkingAuthenticationService 로드 실패, Mock 사용');
}

try {
  debugLog('[EnterpriseCLI] Loading GoogleLoginHelperMinimal...');
  GoogleLoginHelperMinimal = require('../../infrastructure/adapters/GoogleLoginHelperMinimal');
  debugLog('[EnterpriseCLI] GoogleLoginHelperMinimal loaded');
} catch (e) {
  debugLog('[EnterpriseCLI] GoogleLoginHelperMinimal 로드 실패, Mock 사용');
}

/**
 * @class EnterpriseCLI
 * @description Enterprise 아키텍처 CLI (Minimal 모드 통합)
 */
class EnterpriseCLI {
  constructor(config = {}) {
    // ImprovedAuthenticationService를 기본으로 사용하도록 설정
    this.config = {
      ...config,
      useImprovedAuth: true,  // 개선된 Google 로그인 프로세스 활성화
      screenshotEnabled: true, // 스크린샷 저장 활성화
      humanLikeMotion: true,  // 휴먼라이크 마우스 움직임 활성화
      debugMode: config.debugMode || false
    };
    this.container = null;
    this.spinner = null;
    this.profileMapping = null; // 프로필 매핑 캐시
    this.lastMappingUpdate = null; // 마지막 매핑 업데이트 시간
    this.isWorkflowCancelled = false; // 워크플로우 취소 플래그
    this.currentWorkflow = null; // 현재 실행 중인 워크플로우
    
    // 로그인 모드 선택 (기본값: improved)
    this.loginMode = config.loginMode || process.env.LOGIN_MODE || 'improved';
    
    // 로그인 서비스 선택
    if (this.loginMode === 'improved') {
      console.log(chalk.green('✨ Improved 로그인 모드 활성화 (계정 선택 페이지 자동 처리, reCAPTCHA 감지)'));
      // ImprovedAuthenticationService는 컨테이너에서 자동으로 주입됨
      this.authService = null; 
    } else if (this.loginMode === 'macro') {
      console.log(chalk.cyan('🖱️ Macro 로그인 모드 활성화'));
      this.authService = null; // Macro 모드에서는 Helper 직접 사용
    } else if (this.loginMode === 'minimal') {
      console.log(chalk.cyan('🔧 Minimal 로그인 모드 활성화'));
      this.authService = null; // Minimal 모드에서는 Helper 직접 사용
    } else if (WorkingAuthenticationService) {
      this.authService = new WorkingAuthenticationService({
        debugMode: config.debugMode || false
      });
    } else {
      console.log(chalk.yellow('⚠️ WorkingAuthenticationService 없음, Mock 모드'));
      this.authService = null;
    }
  }

  /**
   * CLI 초기화
   */
  async initialize() {
    try {
      console.log(chalk.cyan('🚀 Enterprise CLI 초기화 시작...'));
      this.spinner = ora('AdsPower 연결 중...').start();
      
      // DI 컨테이너 생성 (전체 컨테이너 사용)
      this.container = setupContainer(this.config);
      
      // Logger 초기화
      this.logger = this.container.resolve('logger');
      await this.logger.logWorkflowStart('CLI_Initialize', { config: this.config });
      
      // 세션 로거 초기화
      this.sessionLogger = this.container.resolve('sessionLogger');
      await this.sessionLogger.initialize();
      
      // 안전 종료 핸들러 초기화
      this.gracefulShutdown = this.container.resolve('gracefulShutdown');
      this.gracefulShutdown.startListening();
      
      // 종료 시 콜백 등록
      this.gracefulShutdown.onShutdown(async (reason) => {
        console.log(chalk.yellow('\n현재 작업을 마무리하는 중...'));
        // 추가 정리 작업이 필요한 경우 여기에
      });
      
      // [v2.8] 네트워크 초기화 병렬화 (AdsPower + Google Sheets 동시 연결)
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      this.spinner.text = '연결 확인 중 (AdsPower + Google Sheets)...';

      const [adsPowerResult, sheetsResult] = await Promise.allSettled([
        adsPowerAdapter.checkConnection(),
        this.loadProfileMapping()
      ]);

      // AdsPower 연결 결과 확인
      const connected = adsPowerResult.status === 'fulfilled' && adsPowerResult.value;
      if (!connected) {
        this.spinner.fail('AdsPower API 연결 실패');
        console.log(chalk.yellow('\nAdsPower 브라우저가 실행 중인지 확인하세요.'));
        process.exit(1);
      }

      // Google Sheets 연결 결과 확인 (실패해도 계속 진행)
      if (sheetsResult.status === 'rejected') {
        console.log(chalk.yellow(`\n⚠️ Google Sheets 연결 실패: ${sheetsResult.reason?.message || '알 수 없는 오류'}`));
        console.log(chalk.gray('프로필 매핑 없이 계속 진행합니다.\n'));
        this.profileMapping = new Map();
      }

      this.spinner.succeed('Enterprise CLI 초기화 완료');
      
      // 초기화 상태 표시
      this.displayInitStatus();
      
      await this.logger.logWorkflowEnd('CLI_Initialize', { success: true });
      
    } catch (error) {
      this.spinner.fail(`초기화 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 프로필 매핑 로드
   */
  async loadProfileMapping() {
    try {
      // Google Sheets ID 확인
      const sheetsId = this.config.googleSheetsId || process.env.GOOGLE_SHEETS_ID;
      
      if (!sheetsId) {
        console.log(chalk.yellow('\n⚠️ Google Sheets ID가 설정되지 않았습니다.'));
        console.log(chalk.gray('프로필 매핑 없이 계속 진행합니다.\n'));
        this.profileMapping = new Map();
        return;
      }
      
      // 타임아웃 ID 저장하여 정리 가능하게 함
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Google Sheets 연결 타임아웃')), 10000); // 10초로 증가
      });
      
      // SimpleGoogleSheetsRepository 직접 사용
      const SimpleGoogleSheetsRepository = require('../../infrastructure/repositories/SimpleGoogleSheetsRepository');
      const profileRepo = new SimpleGoogleSheetsRepository({
        spreadsheetId: sheetsId
      });
      
      // 초기화 시도
      console.log(chalk.gray('  Google Sheets 초기화 중...'));
      await profileRepo.initialize();
      
      // 타임아웃과 함께 프로필 로드
      try {
        const profiles = await Promise.race([
          profileRepo.getAdsPowerProfiles(),
          timeout
        ]);
        
        // 타임아웃 정리
        if (timeoutId) clearTimeout(timeoutId);
        
        this.profileMapping = new Map();
        if (profiles && Array.isArray(profiles)) {
          profiles.forEach(profile => {
            if (profile.googleId && profile.adsPowerId) {
              this.profileMapping.set(profile.googleId, {
                adsPowerId: profile.adsPowerId,
                group: profile.group,
                number: profile.adsPowerNumber
              });
            }
          });
        }
        
        this.lastMappingUpdate = new Date();
        return this.profileMapping;
      } catch (error) {
        // 타임아웃 또는 다른 오류 처리
        if (timeoutId) clearTimeout(timeoutId); // 타임아웃 정리
        
        if (error.message.includes('타임아웃')) {
          console.warn(chalk.yellow('⚠️ 프로필 매핑 로드 타임아웃 (10초 초과)'));
        } else {
          console.warn(chalk.yellow('⚠️ 프로필 매핑 로드 건너뛰기'));
        }
        this.profileMapping = new Map();
        return this.profileMapping;
      }
    } catch (error) {
      console.warn(chalk.yellow('⚠️ 프로필 매핑 로드 건너뛰기:', error.message));
      console.warn(chalk.yellow('   (Google Sheets 연결은 선택사항입니다)'));
      this.profileMapping = new Map();
      return this.profileMapping;
    }
  }

  /**
   * 초기화 상태 표시
   */
  displayInitStatus() {
    console.log();
    console.log(chalk.cyan('📊 시스템 상태:'));
    console.log(chalk.gray('  • AdsPower 연결: ') + chalk.green('✅'));
    console.log(chalk.gray('  • Google Sheets: ') + chalk.green('✅'));
    console.log(chalk.gray('  • 매핑된 프로필: ') + chalk.yellow(`${this.profileMapping.size}개`));
    console.log(chalk.gray('  • 스프레드시트 ID: ') + chalk.blue(process.env.GOOGLE_SHEETS_ID));
    console.log(chalk.gray('  • 로그 파일: ') + chalk.cyan('./logs'));
    console.log();
  }

  /**
   * 헤더 표시
   *
   * [버전 업그레이드 시 수정 필요]
   * - VERSION: 새 버전 번호
   * - VERSION_DATE: 릴리즈 날짜
   * - VERSION_DESC: 주요 변경사항 요약 (20자 이내 권장)
   */
  displayHeader() {
    // ═══════════════════════════════════════════════════════════
    // 🔄 버전 정보 - 업그레이드 시 이 영역만 수정
    // ═══════════════════════════════════════════════════════════
    const VERSION = 'v2.41';
    const VERSION_DATE = '2026-03-15 KST';
    const VERSION_DESC = '비밀번호 입력 포커스 안전장치 (좁은 뷰포트 1-column 레이아웃 대응)';
    // ═══════════════════════════════════════════════════════════

    console.clear();
    console.log(chalk.cyan.bold('\n┌' + '─'.repeat(60) + '┐'));
    console.log(chalk.cyan.bold('│') + chalk.white.bold('  🎯 YouTube Premium 구독 자동화 시스템'.padEnd(52)) + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('│') + chalk.yellow(`     ${VERSION}`) + chalk.gray(` (${VERSION_DATE}) - ${VERSION_DESC}`.padEnd(48)) + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('│') + chalk.gray('     AdsPower + Puppeteer | Clean Architecture'.padEnd(59)) + chalk.cyan.bold('│'));
    console.log(chalk.cyan.bold('└' + '─'.repeat(60) + '┘'));
    console.log();
  }

  /**
   * 메인 메뉴
   */
  async showMainMenu() {
    this.displayHeader();
    
    console.log(chalk.cyan('\n메뉴 표시 중...\n'));
    
    try {
      const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '작업을 선택하세요:',
        choices: [
          new inquirer.Separator(chalk.gray('─── 프로필 관리 ───')),
          { name: '📋 프로필 목록', value: 'listProfiles' },
          { name: '➕ 프로필 추가', value: 'addProfile' },
          { name: '🔄 프로필 동기화', value: 'syncProfiles' },
          
          new inquirer.Separator(chalk.gray('─── 단일 작업 (1개씩 처리) ───')),
          { name: '⏸️  구독 일시중지 (단일)', value: 'pauseSubscription' },
          { name: '▶️  구독 재개 (단일)', value: 'resumeSubscription' },
          { name: '🔍 갱신확인 일시중지 (결제 갱신 후에만)', value: 'renewalCheckPause' },
          { name: '💳 백업카드 변경', value: 'backupCardChange' },

          new inquirer.Separator(chalk.gray('─── 배치 작업 (방어적 분산 처리) ───')),
          { name: '📅 시간체크 통합 워커 (일시중지+재개)', value: 'scheduledWorker' },
          { name: '🛡️  배치 일시중지 (방어적 분산)', value: 'batchPauseOptimized' },
          { name: '🛡️  배치 재개 (방어적 분산)', value: 'batchResumeOptimized' },
          { name: '📊 상태 확인', value: 'checkStatus' },
          { name: '🔗 초대링크 확인 (일반 Chrome)', value: 'checkInviteLinks' },
          { name: '👨‍👩‍👧‍👦 가족요금제 자동 검증 (Windows 11)', value: 'checkFamilyPlan' },
          { name: '🏠 가족요금제 기존 계정 확인 (IP 전환)', value: 'checkExistingFamilyPlan' },
          
          new inquirer.Separator(chalk.gray('─── 백업/복원 ───')),
          { name: '📤 TXT → Google Sheets 백업', value: 'txtBackup' },
          { name: '📥 Google Sheets → TXT 복원', value: 'txtRestore' },
          
          new inquirer.Separator(chalk.gray('─── 프로필 관리 ───')),
          { name: '🗑️ 프로필 삭제 (최적화됨)', value: 'deleteProfiles' },
          
          new inquirer.Separator(chalk.gray('─── 시스템 ───')),
          { name: '🔧 설정', value: 'settings' },
          { name: '📋 로그 보기', value: 'viewLogs' },
          { name: '🧹 로그/스크린샷 정리', value: 'logCleanup' },
          { name: '🧑 테스트', value: 'runTests' },

          new inquirer.Separator(),
          { name: chalk.red('❌ 종료'), value: 'exit' }
        ]
      }
    ]);

    return action;
    } catch (error) {
      console.error(chalk.red('\n❌ 메뉴 표시 오류:'), error.message);
      console.log(chalk.yellow('\n💡 PowerShell에서 문제가 발생할 수 있습니다.'));
      console.log(chalk.cyan('다음 방법을 시도해보세요:'));
      console.log(chalk.gray('1. Windows Terminal 사용: wt'));
      console.log(chalk.gray('2. CMD 사용: cmd 입력 후 npm start'));
      console.log(chalk.gray('3. Git Bash 사용'));
      return 'exit';
    }
  }

  /**
   * 프로필 목록 표시
   */
  async listProfiles() {
    try {
      this.spinner = ora('프로필 매핑 정보 조회 중...').start();
      
      // 직접 인스턴스 생성
      const EnhancedGoogleSheetsRepository = require('../../infrastructure/repositories/EnhancedGoogleSheetsRepository');
      const sheetsRepository = new EnhancedGoogleSheetsRepository({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID
      });
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      
      // Google Sheets에서 매핑 정보 가져오기
      const mappingData = await sheetsRepository.getAdsPowerProfiles();
      
      // AdsPower에서 전체 프로필 목록 가져오기 (페이지네이션 처리)
      const { profiles, total } = await adsPowerAdapter.getAllProfiles();
      
      this.spinner.succeed(`매핑: ${mappingData.length}개, AdsPower: ${total}개`);
      
      if (mappingData.length > 0) {
        console.log(chalk.cyan('\n📋 프로필 매핑 현황 (애즈파워현황 탭)\n'));
        
        const table = new Table({
          head: ['번호', 'Google ID', 'AdsPower ID', '그룹', '상태'],
          colWidths: [8, 30, 20, 15, 10]
        });

        mappingData.slice(0, 30).forEach((mapping, index) => {
          // AdsPower에서 해당 프로필 찾기
          const adsPowerProfile = profiles.find(p => p.user_id === mapping.adsPowerId);
          
          table.push([
            mapping.adsPowerNumber || (index + 1).toString(),
            mapping.googleId || '-',
            mapping.adsPowerId ? mapping.adsPowerId.substring(0, 18) : '미매핑',
            mapping.group || '-',
            adsPowerProfile ? '✅' : '❌'
          ]);
        });

        console.log(table.toString());
        
        if (mappingData.length > 30) {
          console.log(chalk.gray(`\n... 그리고 ${mappingData.length - 30}개 더`));
        }

        // 통계
        const mappedCount = mappingData.filter(m => m.adsPowerId).length;
        const unmappedCount = mappingData.length - mappedCount;
        const activeCount = mappingData.filter(m => {
          const profile = profiles.find(p => p.user_id === m.adsPowerId);
          return profile !== undefined;
        }).length;

        console.log(chalk.cyan('\n📊 통계:'));
        console.log(chalk.gray(`  • 전체 계정: ${mappingData.length}개`));
        console.log(chalk.green(`  • 매핑됨: ${mappedCount}개`));
        console.log(chalk.yellow(`  • 미매핑: ${unmappedCount}개`));
        console.log(chalk.blue(`  • AdsPower 활성: ${activeCount}개`));
      }
      
    } catch (error) {
      this.spinner.fail(`프로필 조회 실패: ${error.message}`);
    }

    await this.waitForEnter();
  }

  /**
   * 구독 일시중지
   */
  async pauseSubscription() {
    // 항상 개선된 워크플로우 사용
    return await this.pauseSubscriptionEnhanced();
  }

  /**
   * 구독 재개
   */
  async resumeSubscription() {
    // 항상 개선된 워크플로우 사용
    return await this.resumeSubscriptionEnhanced();
  }

  /**
   * 갱신확인 일시중지 (결제가 갱신된 계정만 일시중지)
   */
  async renewalCheckPause() {
    const workflowType = 'renewal-check-pause'; // 워크플로우 타입 명시
    try {
      // 스케줄 설정 여부 확인
      const { useSchedule } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useSchedule',
          message: '작업 시작 시간을 예약하시겠습니까?',
          default: false
        }
      ]);

      let scheduledTime = null;
      if (useSchedule) {
        scheduledTime = await this.getScheduledTime();
        if (!scheduledTime) {
          console.log(chalk.yellow('\n⚠️ 스케줄 설정이 취소되었습니다.'));
          await this.waitForEnter();
          return;
        }
      }

      // Google Sheets에서 일시중지 목록 가져오기 - 일반 일시중지와 동일한 방식 사용
      this.spinner = ora('일시중지 목록 조회 중...').start();

      const EnhancedGoogleSheetsRepository = require('../../infrastructure/repositories/EnhancedGoogleSheetsRepository');
      const sheetsRepository = new EnhancedGoogleSheetsRepository({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID
      });
      const pauseTasksWithMapping = await sheetsRepository.getPauseTasksWithMapping();
      this.spinner.stop();

      if (pauseTasksWithMapping.length === 0) {
        console.log(chalk.yellow('\n⚠️ 일시중지할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 매핑된 계정만 필터링
      const mappedTasks = pauseTasksWithMapping.filter(task => task.hasMapping);
      if (mappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ AdsPower ID가 매핑된 계정이 없습니다.'));
        console.log(chalk.gray('애즈파워현황 탭에서 매핑을 확인하세요.'));
        await this.waitForEnter();
        return;
      }

      // 재시도 설정 추가 - 일반 일시중지와 동일
      console.log(chalk.cyan.bold('\n⚙️ 재시도 설정\n'));
      const { maxRetries } = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: '실패 시 재시도 횟수 (0-5):',
          default: 1,
          validate: (value) => {
            if (value >= 0 && value <= 5) return true;
            return '0-5 사이의 값을 입력하세요 (0은 재시도 없음)';
          }
        }
      ])

      // 계정 목록 표시 - 일반 일시중지와 동일한 형식
      const Table = require('cli-table3');

      // 상태별 통계 계산
      const activeCount = mappedTasks.filter(task =>
        task.status === '결제중' || task.status === '활성' ||
        task.status === 'active' || task.status === 'Active'
      ).length;
      const pausedCount = mappedTasks.filter(task =>
        task.status === '일시중지' || task.status === 'paused' ||
        task.status === 'Paused' || task.status === '일시중단'
      ).length;

      console.log(chalk.cyan(`\n📋 갱신확인 가능한 계정: ${mappedTasks.length}개`));
      console.log(chalk.green(`   • 결제중: ${activeCount}개 (기본 선택)`));
      console.log(chalk.gray(`   • 일시중지: ${pausedCount}개`));
      console.log(chalk.gray(`   • 기타: ${mappedTasks.length - activeCount - pausedCount}개\n`));

      const table = new Table({
        head: ['Google ID', 'AdsPower ID', '현재 상태', '다음 결제일'],
        colWidths: [30, 20, 15, 20]
      });

      mappedTasks.forEach(task => {
        table.push([
          task.googleId,
          task.adsPowerId || '-',
          task.status || '미확인',
          task.nextPaymentDate || '-'
        ]);
      });

      console.log(table.toString());
      console.log(chalk.cyan.bold('\n🔍 갱신확인 일시중지 작업\n'));
      console.log(chalk.gray('결제가 갱신된 계정만 일시중지합니다.'))

      // '결제중' 상태의 계정만 필터링하여 기본 선택
      const activeAccounts = mappedTasks.filter(task =>
        task.status === '결제중' ||
        task.status === '활성' ||
        task.status === 'active' ||
        task.status === 'Active'
      );

      // 선택 옵션 준비 (결제중 상태는 기본 체크)
      const choices = mappedTasks.map(task => {
        const isActive = activeAccounts.includes(task);
        return {
          name: `${task.googleId} (${task.adsPowerId}) - ${task.status || '미확인'}`,
          value: task,
          checked: isActive // 결제중 상태면 기본 선택
        };
      });

      console.log(chalk.blue('\n💡 팁: 기본적으로 "결제중" 상태의 계정이 선택되어 있습니다.'));
      console.log(chalk.gray('   Space키로 선택/해제, Enter키로 진행\n'));

      // 작업 선택
      const { selectedTasks } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedTasks',
          message: '갱신 확인할 계정 선택:',
          choices: choices,
          pageSize: 15
        }
      ]);

      if (selectedTasks.length === 0) {
        console.log(chalk.yellow('선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 스케줄 대기 (일반 일시중지와 동일)
      if (scheduledTime) {
        await this.waitForScheduledTime(scheduledTime, workflowType);
      }

      console.log(chalk.cyan(`\n🚀 ${selectedTasks.length}개 계정 갱신확인 일시중지 시작 (개선된 워크플로우)...\n`));
      console.log(chalk.gray('='.repeat(60)));

      // 워크플로우 실행 - 일반 일시중지와 동일한 방식 사용
      const improvedPauseUseCase = this.container.resolve('improvedPauseSubscriptionUseCase');

      if (!improvedPauseUseCase) {
        console.error(chalk.red('❌ 일시중지 서비스를 찾을 수 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 개선된 워크플로우로 실행
      console.log(chalk.blue('='+'='.repeat(59)));
      const results = { success: [], failed: [] };

      for (let i = 0; i < selectedTasks.length; i++) {
        const task = selectedTasks[i];
        const index = i + 1;

        // ESC 키가 눌렸는지 확인
        if (this.gracefulShutdown && this.gracefulShutdown.isShuttingDownNow()) {
          console.log(chalk.yellow('\n⚠️ 종료 요청으로 작업 중단'));
          break;
        }

        // 취소 여부 확인
        if (this.isWorkflowCancelled) {
          console.log(chalk.yellow('\n⚠️ 사용자 요청으로 워크플로우 취소됨'));
          break;
        }

        try {
          console.log(chalk.blue('='.repeat(60)));
          console.log(chalk.cyan(`[${index}/${selectedTasks.length}] ${task.googleId}`));

          this.spinner = ora(`${task.googleId} 처리 중...`).start();

          // 현재 워크플로우 설정
          this.currentWorkflow = {
            type: 'renewal-check-pause',
            task: task,
            index: index,
            total: selectedTasks.length
          };

          // RenewalCheckPauseUseCase 사용
          const renewalCheckPauseUseCase = this.container.resolve('renewalCheckPauseUseCase');

          if (!renewalCheckPauseUseCase) {
            throw new Error('갱신확인 일시중지 서비스를 찾을 수 없습니다');
          }

          const result = await renewalCheckPauseUseCase.execute(task.adsPowerId, {
            googleId: task.googleId,
            email: task.googleId || task.email,
            password: task.password,
            recoveryEmail: task.recoveryEmail,
            totpSecret: task.totpSecret || task.code,
            code: task.code,
            rowIndex: task.rowIndex
          });

          if (result.status === 'skipped' || result.status === 'skipped_not_renewed') {
            this.spinner.warn(`${task.googleId} - 갱신 대기중`);
            console.log(chalk.yellow(`  ⏭️ 결제가 아직 갱신되지 않음`));
            console.log(chalk.gray(`  ⚠ 기존 날짜: ${result.existingDate || '없음'}`));
            console.log(chalk.gray(`  ⚠ 현재 날짜: ${result.detectedDate || result.nextBillingDate || '감지 실패'}`));
            results.success.push(task.googleId);
          } else if (result.success || result.status === 'success' || result.renewalStatus === 'renewed_and_paused') {
            this.spinner.succeed(`${task.googleId} 일시중지 성공`);
            console.log(chalk.green(`  ✔ 상태: ${result.status || '일시중지'}`));
            if (result.nextBillingDate) {
              console.log(chalk.green(`  ✔ 다음 결제일: ${result.nextBillingDate}`));
            }
            console.log(chalk.green(`  ✔ 처리 시간: ${result.duration || 0}초`));
            results.success.push(task.googleId);
          } else {
            this.spinner.fail(`${task.googleId} 일시중지 실패`);
            console.log(chalk.red(`  ✖ 오류: ${result.error || '알 수 없는 오류'}`));
            results.failed.push({ id: task.googleId, error: result.error });
          }

        } catch (error) {
          if (this.spinner) this.spinner.fail();
          console.log(chalk.red(`\n  ❌ 오류 발생: ${error.message}`));
          results.failed.push({ id: task.googleId, error: error.message });
        } finally {
          // 현재 워크플로우 초기화
          this.currentWorkflow = null;
          console.log(chalk.blue(`${'='.repeat(60)}\n`));
        }

        // 다음 작업 전 대기 (취소 체크 포함)
        if (i < selectedTasks.length - 1 && !this.isWorkflowCancelled) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // 결과 요약
      console.log(chalk.cyan.bold('\n📊 작업 결과 요약\n'));
      const successCount = results.filter(r => r.result && (r.result.status === 'success' || r.result.renewalStatus === 'renewed_and_paused')).length;
      const skippedCount = results.filter(r => r.result && (r.result.status === 'skipped' || r.result.status === 'skipped_not_renewed')).length;
      const errorCount = results.filter(r => r.result && (r.result.status === 'error' || (!r.result.status && r.result.error))).length;

      console.log(chalk.green(`✅ 성공: ${successCount}개`));
      console.log(chalk.yellow(`⏭️ 건너뜀 (갱신 대기): ${skippedCount}개`));
      console.log(chalk.red(`❌ 실패: ${errorCount}개`));

      await this.waitForEnter();

    } catch (error) {
      if (this.spinner) this.spinner.stop();
      console.error(chalk.red('\n❌ 갱신확인 일시중지 오류:'), error.message);
      await this.waitForEnter();
    }
  }


  /**
   * 상태 확인
   */
  async checkStatus() {
    console.log(chalk.cyan.bold('\n📊 상태 확인\n'));
    console.log(chalk.yellow('🚧 개발 중인 기능입니다.'));
    await this.waitForEnter();
  }

  /**
   * 설정 메뉴
   */
  async showSettings() {
    this.displayHeader();
    console.log(chalk.cyan.bold('\n⚙️ 설정\n'));

    // 현재 설정 표시
    console.log(chalk.gray('현재 설정:'));
    const modeDisplay = this.loginMode === 'macro' ? chalk.cyan('macro') + chalk.green(' (매크로)') :
                       this.loginMode === 'minimal' ? chalk.yellow('minimal') + chalk.green(' (권장)') :
                       chalk.gray('legacy');
    console.log(chalk.white(`  • 로그인 모드: ${modeDisplay}`));
    console.log(chalk.white(`  • 디버그 모드: ${this.config.debugMode ? chalk.green('활성화') : chalk.gray('비활성화')}`));
    console.log(chalk.white(`  • 배치 크기: ${chalk.yellow(this.config.batchSize)}`));
    console.log(chalk.white(`  • 스텔스 모드: ${this.config.stealthMode ? chalk.green('활성화') : chalk.gray('비활성화')}`));

    // 현재 Google Sheets 표시
    const sheetsConfigService = this.container.resolve('googleSheetsConfigService');
    if (sheetsConfigService) {
      try {
        const activeSheet = await sheetsConfigService.getActiveSheet();
        console.log(chalk.white(`  • Google Sheets: ${chalk.green(activeSheet.name)} ${chalk.gray(`(${activeSheet.id.substring(0, 10)}...)`)}`));
      } catch (e) {
        console.log(chalk.white(`  • Google Sheets: ${chalk.gray('기본 설정')}`));
      }
    }
    console.log();

    const { setting } = await inquirer.prompt([
      {
        type: 'list',
        name: 'setting',
        message: '변경할 설정을 선택하세요:',
        choices: [
          { name: '📊 Google Sheets 선택', value: 'googleSheets' },
          new inquirer.Separator('────── 시스템 설정 ──────'),
          { name: '🔑 로그인 모드 변경', value: 'loginMode' },
          { name: '🐛 디버그 모드 토글', value: 'debugMode' },
          { name: '📦 배치 크기 조정', value: 'batchSize' },
          { name: '🕵️ 스텔스 모드 토글', value: 'stealthMode' },
          new inquirer.Separator(),
          { name: '← 돌아가기', value: 'back' }
        ]
      }
    ]);

    switch (setting) {
      case 'googleSheets':
        await this.selectGoogleSheets();
        break;
      case 'loginMode':
        await this.changeLoginMode();
        break;
      case 'debugMode':
        this.config.debugMode = !this.config.debugMode;
        console.log(chalk.green(`\n✅ 디버그 모드가 ${this.config.debugMode ? '활성화' : '비활성화'}되었습니다.`));
        await this.waitForEnter();
        break;
      case 'batchSize':
        await this.changeBatchSize();
        break;
      case 'stealthMode':
        this.config.stealthMode = !this.config.stealthMode;
        console.log(chalk.green(`\n✅ 스텔스 모드가 ${this.config.stealthMode ? '활성화' : '비활성화'}되었습니다.`));
        await this.waitForEnter();
        break;
      case 'back':
        return;
    }

    // 설정 변경 후 다시 설정 메뉴 표시
    if (setting !== 'back') {
      await this.showSettings();
    }
  }

  /**
   * Google Sheets 선택 메뉴
   */
  async selectGoogleSheets() {
    console.log();
    console.log(chalk.cyan.bold('📊 Google Sheets 선택\n'));

    const sheetsConfigService = this.container.resolve('googleSheetsConfigService');

    if (!sheetsConfigService) {
      console.log(chalk.yellow('⚠️ Google Sheets 설정 서비스를 사용할 수 없습니다.'));
      await this.waitForEnter();
      return;
    }

    try {
      // 사용 가능한 시트 목록 가져오기
      const availableSheets = await sheetsConfigService.getAvailableSheets();

      if (availableSheets.length === 0) {
        console.log(chalk.yellow('⚠️ 설정된 Google Sheets가 없습니다.'));
        console.log(chalk.gray('.env 파일에 GOOGLE_SHEETS_ID를 설정해주세요.'));
        await this.waitForEnter();
        return;
      }

      // 현재 활성 시트 표시
      const activeSheet = availableSheets.find(s => s.isActive);
      console.log(chalk.gray('현재 활성 시트:'));
      console.log(chalk.green(`  • ${activeSheet.name}`));
      console.log(chalk.gray(`    ID: ${activeSheet.id}`));
      console.log();

      // 시트 선택 메뉴
      const choices = availableSheets.map((sheet, index) => ({
        name: `${sheet.isActive ? '✓ ' : '  '}${sheet.name} ${chalk.gray(`(${sheet.id.substring(0, 20)}...)`)}`,
        value: index,
        short: sheet.name
      }));

      choices.push(new inquirer.Separator());
      choices.push({ name: '➕ 새 시트 추가', value: 'add' });
      if (availableSheets.length > 1) {
        choices.push({ name: '➖ 시트 삭제', value: 'remove' });
      }
      choices.push({ name: '✏️ 시트 이름 변경', value: 'rename' });
      choices.push(new inquirer.Separator());
      choices.push({ name: '← 돌아가기', value: 'back' });

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: '사용할 Google Sheets를 선택하세요:',
          choices,
          pageSize: 10
        }
      ]);

      // 선택한 작업 처리
      if (action === 'back') {
        return;
      } else if (action === 'add') {
        await this.addNewSheet(sheetsConfigService);
      } else if (action === 'remove') {
        await this.removeSheet(sheetsConfigService, availableSheets);
      } else if (action === 'rename') {
        await this.renameSheet(sheetsConfigService, availableSheets);
      } else if (typeof action === 'number') {
        // 시트 선택
        const selectedSheet = await sheetsConfigService.setActiveSheet(action);

        // 컨테이너의 config 업데이트
        this.config.googleSheetsId = selectedSheet.id;
        this.config.serviceAccountPath = selectedSheet.path;

        // 모든 Repository 재초기화 (중요!)
        await this.reinitializeAllRepositories(selectedSheet);

        console.log(chalk.green(`\n✅ Google Sheets가 변경되었습니다: ${selectedSheet.name}`));
        console.log(chalk.gray('모든 프로그램에서 새로운 시트를 사용합니다.'));

        await this.waitForEnter();
      }

      // 다시 Google Sheets 선택 메뉴 표시
      await this.selectGoogleSheets();

    } catch (error) {
      console.error(chalk.red('오류:'), error.message);
      await this.waitForEnter();
    }
  }

  /**
   * 모든 Repository 재초기화
   * Google Sheets 변경 시 모든 Repository가 새로운 시트를 사용하도록 재설정
   */
  async reinitializeAllRepositories(selectedSheet) {
    try {
      // 1. GoogleSheetsProfileRepository 재초기화
      const profileRepo = this.container.resolve('profileRepository');
      if (profileRepo) {
        profileRepo.spreadsheetId = selectedSheet.id;
        if (profileRepo.initialize) {
          await profileRepo.initialize();
        }
      }

      // 2. EnhancedGoogleSheetsRepository 재초기화
      const enhancedRepo = this.container.resolve('enhancedSheetsRepository');
      if (enhancedRepo) {
        enhancedRepo.spreadsheetId = selectedSheet.id;
        if (enhancedRepo.switchSheet) {
          await enhancedRepo.switchSheet(selectedSheet.id, selectedSheet.path);
        } else if (enhancedRepo.initialize) {
          await enhancedRepo.initialize();
        }
      }

      // 3. PauseSheetRepository 재초기화
      const pauseRepo = this.container.resolve('pauseSheetRepository');
      if (pauseRepo) {
        pauseRepo.spreadsheetId = selectedSheet.id;
        if (pauseRepo.initialize) {
          await pauseRepo.initialize();
        }
      }

      // 4. UnifiedSheetsUpdateService 재초기화
      const unifiedService = this.container.resolve('unifiedSheetsUpdateService');
      if (unifiedService) {
        unifiedService.spreadsheetId = selectedSheet.id;
        if (unifiedService.reinitialize) {
          await unifiedService.reinitialize(selectedSheet.id);
        }
      }

      // 5. FamilyCheckRepository 재초기화 (있는 경우)
      const familyRepo = this.container.resolve('familyCheckRepository');
      if (familyRepo) {
        familyRepo.spreadsheetId = selectedSheet.id;
        if (familyRepo.initialize) {
          await familyRepo.initialize();
        }
      }

      console.log(chalk.dim('✔ 모든 Repository가 새로운 시트로 재초기화되었습니다.'));

    } catch (error) {
      console.error(chalk.red('⚠️ Repository 재초기화 중 오류:'), error.message);
      // 오류가 발생해도 계속 진행
    }
  }

  /**
   * 새 시트 추가
   */
  async addNewSheet(sheetsConfigService) {
    console.log();
    console.log(chalk.cyan('새 Google Sheets 추가'));
    console.log(chalk.gray('Google Sheets URL에서 ID를 복사하세요.'));
    console.log(chalk.gray('예시: https://docs.google.com/spreadsheets/d/[이 부분이 ID]/edit'));
    console.log();

    const { sheetId, sheetName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'sheetId',
        message: 'Google Sheets ID:',
        validate: (input) => {
          if (!input || input.length < 20) {
            return '유효한 Google Sheets ID를 입력하세요.';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'sheetName',
        message: '시트 이름 (표시용):',
        default: '새 시트',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return '시트 이름을 입력하세요.';
          }
          return true;
        }
      }
    ]);

    try {
      const newIndex = await sheetsConfigService.addSheet(sheetId, sheetName);
      console.log(chalk.green(`\n✅ 새 시트가 추가되었습니다: ${sheetName}`));

      // 바로 사용할지 물어보기
      const { useNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useNow',
          message: '지금 이 시트를 사용하시겠습니까?',
          default: true
        }
      ]);

      if (useNow) {
        await sheetsConfigService.setActiveSheet(newIndex);
        console.log(chalk.green('✅ 새 시트가 활성화되었습니다.'));
      }
    } catch (error) {
      console.error(chalk.red('오류:'), error.message);
    }

    await this.waitForEnter();
  }

  /**
   * 시트 삭제
   */
  async removeSheet(sheetsConfigService, sheets) {
    console.log();
    console.log(chalk.red.bold('⚠️ 시트 삭제'));
    console.log(chalk.yellow('주의: 시트 설정만 삭제되며, Google Sheets 자체는 삭제되지 않습니다.'));
    console.log();

    const choices = sheets.map((sheet, index) => ({
      name: `${sheet.name} ${sheet.isActive ? chalk.green('(활성)') : ''}`,
      value: index,
      disabled: sheet.isActive ? '활성 시트는 삭제할 수 없습니다' : false
    }));

    const { sheetIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sheetIndex',
        message: '삭제할 시트를 선택하세요:',
        choices
      }
    ]);

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `정말로 "${sheets[sheetIndex].name}" 시트를 삭제하시겠습니까?`,
        default: false
      }
    ]);

    if (confirm) {
      try {
        await sheetsConfigService.removeSheet(sheetIndex);
        console.log(chalk.green('✅ 시트가 삭제되었습니다.'));
      } catch (error) {
        console.error(chalk.red('오류:'), error.message);
      }
    }

    await this.waitForEnter();
  }

  /**
   * 시트 이름 변경
   */
  async renameSheet(sheetsConfigService, sheets) {
    console.log();
    console.log(chalk.cyan('시트 이름 변경'));
    console.log();

    const choices = sheets.map((sheet, index) => ({
      name: `${sheet.name} ${sheet.isActive ? chalk.green('(활성)') : ''}`,
      value: index
    }));

    const { sheetIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sheetIndex',
        message: '이름을 변경할 시트를 선택하세요:',
        choices
      }
    ]);

    const { newName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newName',
        message: '새 이름:',
        default: sheets[sheetIndex].name,
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return '시트 이름을 입력하세요.';
          }
          return true;
        }
      }
    ]);

    try {
      await sheetsConfigService.updateSheetName(sheetIndex, newName);
      console.log(chalk.green(`✅ 시트 이름이 변경되었습니다: ${newName}`));
    } catch (error) {
      console.error(chalk.red('오류:'), error.message);
    }

    await this.waitForEnter();
  }

  /**
   * 로그인 모드 변경
   */
  async changeLoginMode() {
    console.log();
    console.log(chalk.cyan('로그인 모드 선택'));
    console.log();
    console.log(chalk.gray('• Macro 모드: 인간처럼 마우스를 움직이는 매크로 방식 (최고 성공률)'));
    console.log(chalk.gray('• Minimal 모드: CDP 네이티브 클릭만 사용, Google 감지 회피'));
    console.log(chalk.gray('• Legacy 모드: 기존 방식, evaluateOnNewDocument 사용'));
    console.log();
    
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: '로그인 모드를 선택하세요:',
        choices: [
          { 
            name: '🖱️ Macro 모드 (인간처럼 마우스 움직임)', 
            value: 'macro' 
          },
          { 
            name: '🚀 Minimal 모드 (CDP 네이티브)', 
            value: 'minimal' 
          },
          { 
            name: '🔧 Legacy 모드', 
            value: 'legacy' 
          }
        ],
        default: this.loginMode
      }
    ]);
    
    const previousMode = this.loginMode;
    this.loginMode = mode;
    this.config.loginMode = mode;
    
    // AuthService 재설정
    if (mode === 'macro') {
      console.log(chalk.cyan('\n🖱️ Macro 로그인 모드 활성화'));
      console.log(chalk.gray('  • 베지어 곡선 마우스 움직임'));
      console.log(chalk.gray('  • 자연스러운 타이핑 속도'));
      console.log(chalk.gray('  • 랜덤 지연 및 망설임 효과'));
      console.log(chalk.gray('  • 최고 수준의 감지 회피'));
      this.authService = null; // Macro 모드에서는 Helper를 직접 사용
    } else if (mode === 'minimal') {
      console.log(chalk.cyan('\n🔧 Minimal 로그인 모드 활성화'));
      console.log(chalk.gray('  • evaluateOnNewDocument 제거'));
      console.log(chalk.gray('  • CDP 네이티브 클릭 사용'));
      console.log(chalk.gray('  • Google 감지 회피 최적화'));
      this.authService = null; // Minimal 모드에서는 Helper를 직접 사용
    } else {
      console.log(chalk.yellow('\n⚠️ Legacy 로그인 모드 활성화'));
      console.log(chalk.gray('  • 기존 방식 사용'));
      console.log(chalk.gray('  • Google 감지 위험 있음'));
      // Legacy 모드에서는 authService가 없어도 GoogleLoginHelper를 직접 사용
      // authService는 선택적이므로 null로 설정
      this.authService = null;
      console.log(chalk.gray('  • 로그인 시 GoogleLoginHelper 사용'));
    }
    
    // .env 파일 업데이트 옵션
    const { saveToEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveToEnv',
        message: '.env 파일에 설정을 저장하시겠습니까?',
        default: true
      }
    ]);
    
    if (saveToEnv) {
      await this.updateEnvFile('LOGIN_MODE', mode);
      console.log(chalk.green('\n✅ .env 파일이 업데이트되었습니다.'));
    }
    
    console.log(chalk.green(`\n✅ 로그인 모드가 ${previousMode}에서 ${mode}로 변경되었습니다.`));
    await this.waitForEnter();
  }

  /**
   * 배치 크기 변경
   */
  async changeBatchSize() {
    const { size } = await inquirer.prompt([
      {
        type: 'number',
        name: 'size',
        message: '새로운 배치 크기를 입력하세요 (1-20):',
        default: this.config.batchSize,
        validate: (input) => {
          if (input >= 1 && input <= 20) {
            return true;
          }
          return '배치 크기는 1에서 20 사이여야 합니다.';
        }
      }
    ]);
    
    this.config.batchSize = size;
    console.log(chalk.green(`\n✅ 배치 크기가 ${size}로 변경되었습니다.`));
    await this.waitForEnter();
  }

  /**
   * .env 파일 업데이트
   */
  async updateEnvFile(key, value) {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '../../../.env');
    
    try {
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      const lines = envContent.split('\n');
      let found = false;
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(`${key}=`)) {
          lines[i] = `${key}=${value}`;
          found = true;
          break;
        }
      }
      
      if (!found) {
        lines.push(`${key}=${value}`);
      }
      
      fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    } catch (error) {
      console.error(chalk.red('⚠️ .env 파일 업데이트 실패:'), error.message);
    }
  }


  /**
   * 프로필 선택
   */
  async selectProfile() {
    try {
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      const { profiles } = await adsPowerAdapter.getProfiles({ pageSize: 20 });
      
      if (profiles.length === 0) {
        console.log(chalk.yellow('⚠️ 프로필이 없습니다.'));
        return null;
      }

      const { profileId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'profileId',
          message: '프로필 선택:',
          choices: profiles.map(p => ({
            name: `${p.name || p.user_id} (${p.group_name || 'Default'})`,
            value: p.user_id
          }))
        }
      ]);

      return profileId;
      
    } catch (error) {
      console.log(chalk.red(`프로필 선택 실패: ${error.message}`));
      return null;
    }
  }

  /**
   * 여러 프로필 선택
   */
  async selectMultipleProfiles() {
    try {
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
      const { profiles } = await adsPowerAdapter.getProfiles({ pageSize: 50 });
      
      if (profiles.length === 0) {
        console.log(chalk.yellow('⚠️ 프로필이 없습니다.'));
        return [];
      }

      const { profileIds } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'profileIds',
          message: '프로필 선택 (Space로 선택):',
          choices: profiles.map(p => ({
            name: `${p.name || p.user_id} (${p.group_name || 'Default'})`,
            value: p.user_id
          }))
        }
      ]);

      return profileIds;
      
    } catch (error) {
      console.log(chalk.red(`프로필 선택 실패: ${error.message}`));
      return [];
    }
  }

  /**
   * 개선된 재개 워크플로우 실행
   */
  async resumeSubscriptionEnhanced() {
    const workflowType = 'resume'; // 워크플로우 타입 명시
    try {
      // DI 컨테이너 초기화 확인
      if (!this.container) {
        console.log(chalk.gray('🔧 DI 컨테이너 초기화 중...'));
        await this.initialize();
      }

      // 스케줄 설정 여부 확인 (일시중지와 동일한 방식)
      const { useSchedule } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useSchedule',
          message: '작업 시작 시간을 예약하시겠습니까?',
          default: false
        }
      ]);

      let scheduledTime = null;
      if (useSchedule) {
        scheduledTime = await this.getScheduledTime();
        if (!scheduledTime) {
          console.log(chalk.yellow('\n⚠️ 스케줄 설정이 취소되었습니다.'));
          await this.waitForEnter();
          return;
        }
      }

      // Google Sheets에서 재개 목록 가져오기
      this.spinner = ora('재개 목록 조회 중...').start();
      
      // SimpleGoogleSheetsRepository 사용
      const SimpleGoogleSheetsRepository = require('../../infrastructure/repositories/SimpleGoogleSheetsRepository');
      const sheetsRepository = new SimpleGoogleSheetsRepository({
        spreadsheetId: this.config.googleSheetsId || process.env.GOOGLE_SHEETS_ID
      });
      
      const resumeTasks = await sheetsRepository.getResumeTasksWithMapping();
      this.spinner.stop();

      if (resumeTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 재개할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 모든 계정 표시 (AdsPower ID 없는 계정 포함)
      const mappedTasks = resumeTasks.filter(task => task.hasMapping);
      const unmappedTasks = resumeTasks.filter(task => !task.hasMapping);
      
      if (mappedTasks.length === 0 && unmappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 재개할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }
      
      // AdsPower ID 없는 계정 알림
      if (unmappedTasks.length > 0) {
        console.log(chalk.red(`\n❌ AdsPower ID 없는 계정: ${unmappedTasks.length}개`));
        console.log(chalk.gray('   이 계정들은 자동화할 수 없으며, H열에 자동 기록됩니다.'));
      }
      
      if (mappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 자동화 가능한 계정이 없습니다.'));
        console.log(chalk.gray('애즈파워현황 탭에서 매핑을 확인하세요.'));
        await this.waitForEnter();
        return;
      }

      // 재시도 설정 추가
      console.log(chalk.cyan.bold('\n⚙️ 재시도 설정\n'));
      const { maxRetries } = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: '실패 시 재시도 횟수 (0-5):',
          default: 1,
          validate: (value) => {
            if (value >= 0 && value <= 5) return true;
            return '0-5 사이의 값을 입력하세요 (0은 재시도 없음)';
          }
        }
      ]);

      // 계정 목록 표시
      // 상태별 통곈4 곀4산
      const activeCount = mappedTasks.filter(task => 
        task.status === '결제중' || task.status === '활성' || 
        task.status === 'active' || task.status === 'Active'
      ).length;
      const pausedCount = mappedTasks.filter(task => 
        task.status === '일시중지' || task.status === 'paused' || 
        task.status === 'Paused' || task.status === '일시중단'
      ).length;
      
      console.log(chalk.cyan(`\n📋 총 계정: ${resumeTasks.length}개`));
      console.log(chalk.green(`   • 자동화 가능: ${mappedTasks.length}개`));
      console.log(chalk.red(`   • AdsPower ID 없음: ${unmappedTasks.length}개`));
      console.log(chalk.yellow(`   • 일시중지: ${pausedCount}개 (기본 선택)`));
      console.log(chalk.gray(`   • 결제중: ${activeCount}개`));
      console.log(chalk.gray(`   • 기타: ${mappedTasks.length - activeCount - pausedCount}개\n`));
      
      const table = new Table({
        head: ['Google ID', 'AdsPower ID', '현재 상태', '다음 결제일'],
        colWidths: [30, 20, 15, 20]
      });

      // 모든 계정을 테이블에 표시 (ID 없는 계정도 포함)
      resumeTasks.forEach(task => {
        const row = [
          task.googleId,
          task.adsPowerId || '❌ 없음',
          task.status || '미확인',
          task.nextPaymentDate || '-'
        ];
        
        // AdsPower ID가 없는 계정은 빨간색으로 표시
        if (!task.hasMapping) {
          row[1] = chalk.red('❌ 없음');
        }
        
        table.push(row);
      });

      console.log(table.toString());

      // '일시중지' 상태의 계정만 필터링하여 기본 선택 (AdsPower ID 있는 것만)
      const pausedAccounts = mappedTasks.filter(task => 
        task.status === '일시중지' || 
        task.status === 'paused' || 
        task.status === 'Paused' ||
        task.status === '일시중단'
      );
      
      // 선택 옵션 준비 (일시중지 상태는 기본 체크)
      const choices = mappedTasks.map(task => {
        const isPaused = pausedAccounts.includes(task);
        return {
          name: `${task.googleId} (${task.adsPowerId}) - ${task.status || '미확인'}`,
          value: task,
          checked: isPaused // 일시중지 상태면 기본 선택
        };
      });
      
      console.log(chalk.blue('\n💡 팁: 기본적으로 "일시중지" 상태의 계정이 선택되어 있습니다.'));
      console.log(chalk.gray('   Space키로 선택/해제, Enter키로 진행\n'));
      
      // 작업 선택
      const { selectedTasks } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedTasks',
          message: '재개할 계정 선택:',
          choices: choices,
          pageSize: 15
        }
      ]);

      if (selectedTasks.length === 0) {
        console.log(chalk.yellow('선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // Enhanced UseCase 사용
      const enhancedResumeUseCase = this.container.resolve('enhancedResumeSubscriptionUseCase');
      
      // 스케줄이 설정되었으면 예약 실행 (일시중지와 동일한 방식)
      if (scheduledTime) {
        const schedulerService = this.container.resolve('schedulerService');
        const taskId = `resume-${Date.now()}`;
        
        console.log(chalk.cyan(`\n⏰ 작업이 ${scheduledTime.toLocaleString('ko-KR')}에 예약되었습니다.`));
        console.log(chalk.gray(`작업 ID: ${taskId}`));
        
        // 스케줄 작업 등록
        schedulerService.scheduleTask(taskId, scheduledTime, async () => {
          console.log(chalk.green(`\n🚀 예약된 재개 작업을 시작합니다...`));
          await this.executeResumeWorkflow(selectedTasks, enhancedResumeUseCase, maxRetries, workflowType);
        }, { tasks: selectedTasks });
        
        // 대기 상태 표시
        const nextTask = schedulerService.getTaskInfo(taskId);
        console.log(chalk.blue(`\n남은 시간: ${nextTask.remainingTime}`));
        console.log(chalk.gray('\nESC 또는 Ctrl+C를 눌러 예약을 취소할 수 있습니다.'));
        
        await this.waitForEnter();
        return;
      }
      
      // 즉시 실행
      await this.executeResumeWorkflow(selectedTasks, enhancedResumeUseCase, maxRetries, workflowType);
    } catch (error) {
      console.error(chalk.red('\n❌ 워크플로우 실행 실패:'), error.message);
      await this.logger.logError(error, { method: 'resumeSubscriptionEnhanced' });
    }
  }
  
  /**
   * 재개 워크플로우 실행
   */
  async executeResumeWorkflow(selectedTasks, enhancedResumeUseCase, maxRetries = 1, workflowType = 'resume') {
    try {
      // 선택된 계정들 처리
      console.log(chalk.cyan(`\n🚀 ${selectedTasks.length}개 계정 재개 시작 (개선된 워크플로우)...\n`));

      const results = {
        success: [],
        failed: [],
        needRecheck: []  // v2.0: 결제 복구 후 재확인 필요한 계정
      };

      for (let i = 0; i < selectedTasks.length; i++) {
        const task = selectedTasks[i];

        // ESC 키 또는 Ctrl+C 취소 체크
        if (this.gracefulShutdown && this.gracefulShutdown.isShuttingDownNow()) {
          console.log(chalk.yellow('\n⚠️ 종료 요청으로 작업 중단'));
          break;
        }
        if (this.isWorkflowCancelled) {
          console.log(chalk.yellow('\n⚠️ 사용자에 의해 워크플로우가 취소되었습니다.'));
          break;
        }
        
        console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
        console.log(chalk.cyan(`🎯 처리 시작: ${task.googleId}`));
        console.log(chalk.gray(`  AdsPower ID: ${task.adsPowerId}`));
        console.log(chalk.gray(`  현재 상태: ${task.status || '미확인'}`));
        
        try {
          // 현재 워크플로우 설정
          this.currentWorkflow = task.googleId;
          this.spinner = ora(`[WorkflowManager] ${task.googleId} 워크플로우 준비 중...`).start();
          
          // Enhanced 워크플로우 실행 (프로핀 데이터 포함)
          // AdsPower ID 매핑 서비스 사용
          let actualAdsPowerId = task.adsPowerId;

          // 하드코딩된 올바른 매핑 (테스트에서 확인된 작동하는 ID)
          const correctMappings = {
            'evidanak388@gmail.com': 'k12f1376',  // k1243ybm 대신
            'wowuneja89@gmail.com': 'k12f1jpf',   // k124j34a 대신
            'tressiesoaresbd11@gmail.com': 'k13jyr12',
            'qoangteo12345@gmail.com': 'k14h1rw7'
          };

          // 이메일에 대한 올바른 ID가 있으면 사용
          const emailLower = task.googleId?.toLowerCase();
          if (correctMappings[emailLower]) {
            const newId = correctMappings[emailLower];
            console.log(chalk.cyan(`  🔄 ID 교체: ${actualAdsPowerId} → ${newId}`));
            actualAdsPowerId = newId;
          }

          // AdsPower ID가 비밀번호처럼 보이는 경우 (!, @, #, $ 등 특수문자 포함)
          // 또는 B열이 잘못 사용된 경우
          if (actualAdsPowerId && /[!@#$%^&*(),.?":{}|<>]/.test(actualAdsPowerId)) {
            console.log(chalk.yellow(`  ⚠️ 잘못된 AdsPower ID 감지 (패스워드로 추정): ${actualAdsPowerId.substring(0, 10)}...`));
            actualAdsPowerId = null; // null로 설정
          }

          // AdsPower ID가 없는 경우 매핑 서비스에서 검색
          if (!actualAdsPowerId) {
            const adsPowerIdMappingService = this.container.resolve('adsPowerIdMappingService');

            if (adsPowerIdMappingService) {
              console.log(chalk.cyan(`  🔍 애즈파워현황 시트에서 올바른 ID 검색 중...`));
              const correctId = await adsPowerIdMappingService.getFirstAvailableId(task.googleId);

              if (correctId) {
                console.log(chalk.green(`  ✅ 올바른 AdsPower ID 발견: ${correctId}`));
                actualAdsPowerId = correctId;
              } else {
                console.log(chalk.yellow(`  ⚠️ 애즈파워현황에서 매칭 ID를 찾을 수 없음`));
                console.log(chalk.yellow(`  🔍 UseCase에서 추가 검색 시도 예정`));
              }
            }
          }

          const result = await enhancedResumeUseCase.execute(actualAdsPowerId, {
            googleId: task.googleId,
            email: task.googleId,  // 명시적으로 이메일 전달
            rowIndex: task.rowIndex,
            profileData: {
              email: task.googleId,
              password: task.password,
              recoveryEmail: task.recoveryEmail,
              code: task.code,
              totpSecret: task.totpSecret || task.code,  // TOTP 시크릿 추가
              googleId: task.googleId
            }
          });
          
          // reCAPTCHA 감지된 경우 특별 처리
          if (result.status === 'recaptcha_required') {
            this.spinner.warn(`${task.googleId} - 번호인증계정`);
            console.log(chalk.yellow(`  ⚠ reCAPTCHA 감지 - 수동 로그인 필요`));
            console.log(chalk.yellow(`  ⚠ 처리 시간: ${result.duration}초`));
            results.failed.push({ id: task.googleId, error: '번호인증계정' });
            
            // Google Sheets에 번호인증계정으로 표시
            const now = new Date();
            const timeStr = now.toLocaleString('ko-KR', { 
              year: 'numeric',
              month: 'numeric', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            });
            // Google Sheets 업데이트는 제거 - EnhancedResumeSubscriptionUseCase에서 이미 처리됨
            // 번호인증 실패도 PauseSheetRepository.updateResumeStatus에서 이미 처리 완료
          } else if (result.success) {
            // ★ v2.2: "이미 활성 상태" 오판 방지를 위한 즉시 재시도
            // 20개 중 1개 꼴로 실제로는 활성이 아닌데 활성으로 잘못 판단하는 경우 방지
            if (result.status === 'already_active' && !task._alreadyActiveRetried) {
              this.spinner.warn(`${task.googleId} 이미 활성 상태 감지 - 재확인 필요`);
              console.log(chalk.yellow(`  ⚠️ "이미 활성 상태"로 감지됨 - 오판 가능성 검토`));
              console.log(chalk.cyan(`  🔄 즉시 재시도하여 상태 재확인합니다...`));

              // 브라우저 정리 대기
              await new Promise(resolve => setTimeout(resolve, 3000));

              // 즉시 재시도 플래그 설정 (무한루프 방지)
              task._alreadyActiveRetried = true;

              // 현재 인덱스를 다시 처리하도록 i 감소
              i--;

              // finally 블록 실행을 위해 continue 대신 직접 처리
              this.currentWorkflow = null;
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
              continue;
            }

            // 정상적인 성공 처리
            this.spinner.succeed(`${task.googleId} 재개 성공`);
            console.log(chalk.green(`  ✔ 상태: ${result.status}`));
            if (result.nextBillingDate) {
              console.log(chalk.green(`  ✔ 다음 결제일: ${result.nextBillingDate}`));
            }
            console.log(chalk.green(`  ✔ 처리 시간: ${result.duration}초`));

            // 재시도 후 성공한 경우 추가 메시지
            if (task._alreadyActiveRetried) {
              console.log(chalk.green(`  ✔ (재확인 완료 - 실제로 활성 상태)`));
            }

            results.success.push(task.googleId);

            // Google Sheets 업데이트는 제거 - EnhancedResumeSubscriptionUseCase에서 이미 처리됨
            // 중복 업데이트 방지를 위해 CLI에서는 업데이트하지 않음
            // PauseSheetRepository.updateResumeStatus에서 이미 처리 완료
          } else {
            this.spinner.fail(`${task.googleId} 재개 실패`);

            // ★ v2.2: "이미 활성 상태" 재시도 후 실패한 경우 메시지 추가
            if (task._alreadyActiveRetried) {
              console.log(chalk.yellow(`  ⚠️ (재확인 후 실패 - 실제로 재개 필요)`));
            }

            // v2.1: 결제 복구 성공 후 재확인 필요한 경우 - 재시도 대상에 포함
            if (result.error === 'PAYMENT_RECOVERED_NEED_RECHECK' ||
                result.error?.includes('PAYMENT_RECOVERED')) {
              console.log(chalk.green(`  ✔ 결제 문제 발생 후 재결제 완료`));
              console.log(chalk.yellow(`  ⚠ 다시 확인 필요 - 즉시 재시도합니다`));
              results.needRecheck.push({ id: task.googleId, status: '재결제 완료 - 재확인 필요' });
              // ★ v2.1: 재시도 대상에도 추가하여 자동 재시도 되도록 함
              results.failed.push({ id: task.googleId, error: 'PAYMENT_RECOVERED_NEED_RECHECK', isPaymentRecovered: true });
            }
            // 결제 수단 문제 특별 처리 (복구 실패)
            else if (result.error === 'PAYMENT_METHOD_ISSUE' ||
                result.error?.includes('payment') ||
                result.error?.includes('결제')) {
              console.log(chalk.red(`  ✖ 오류: 결제 수단 문제 - 결제 정보 업데이트 필요`));
              console.log(chalk.yellow(`  ⚠ YouTube Premium 페이지에서 "Update payment method" 버튼 확인됨`));
              results.failed.push({ id: task.googleId, error: '결제 수단 문제' });
            } else {
              console.log(chalk.red(`  ✖ 오류: ${result.error}`));
              results.failed.push({ id: task.googleId, error: result.error });
            }

            // Google Sheets 업데이트는 제거 - EnhancedResumeSubscriptionUseCase에서 이미 처리됨
            // 실패 케이스도 PauseSheetRepository.updateResumeStatus에서 이미 처리 완료
          }
          
        } catch (error) {
          if (this.spinner) this.spinner.fail();
          console.log(chalk.red(`\n  ❌ 오류 발생: ${error.message}`));
          results.failed.push({ id: task.googleId, error: error.message });
          
          // Google Sheets 업데이트는 제거 - EnhancedResumeSubscriptionUseCase에서 이미 처리됨
          // 오류 케이스도 PauseSheetRepository.updateResumeStatus에서 이미 처리 완료
        } finally {
          // 현재 워크플로우 초기화
          this.currentWorkflow = null;
          console.log(chalk.blue(`${'='.repeat(60)}\n`));
        }
        
        // 다음 작업 전 대기 (취소 체크 포함)
        if (selectedTasks.indexOf(task) < selectedTasks.length - 1 && !this.isWorkflowCancelled) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // 재시도 로직 (maxRetries 기반 자동 재시도)
      if (results.failed.length > 0 && maxRetries > 0) {
        // 번호인증 계정 제외하고 재시도할 계정 필터링
        let retryableTasks = results.failed.filter(item => 
          item.error !== '번호인증계정' && 
          !(item.error?.includes('reCAPTCHA'))
        );
        
        if (retryableTasks.length > 0) {
          console.log(chalk.yellow(`\n⚠️ ${retryableTasks.length}개 계정 재시도 가능 (번호인증 제외)`));
          
          for (let retryCount = 1; retryCount <= maxRetries; retryCount++) {
            if (retryableTasks.length === 0) break;
            
            console.log(chalk.cyan(`\n🔄 자동 재시도 ${retryCount}/${maxRetries} 시작...\n`));
            
            const currentRetryable = [...retryableTasks];
            retryableTasks = []; // 배열 재할당
            
            for (const failedItem of currentRetryable) {
              // ESC 키가 눌렸는지 확인
              if (this.gracefulShutdown && this.gracefulShutdown.isShuttingDownNow()) {
                console.log(chalk.yellow('\n⚠️ 종료 요청으로 재시도 중단'));
                break;
              }
              
              const originalTask = selectedTasks.find(t => t.googleId === failedItem.id);
              if (!originalTask) continue;
              
              try {
                console.log(chalk.blue(`${'='.repeat(60)}`));
                console.log(chalk.cyan(`재시도 ${retryCount}/${maxRetries}: ${originalTask.googleId}`));
                console.log(chalk.gray(`이전 실패 이유: ${failedItem.error}`));
                
                this.spinner = ora(`재시도 중...`).start();
                
                // 워크플로우 타입에 따라 적절한 UseCase 사용
                let retryResult;
                if (workflowType === 'pause') {
                  this.currentWorkflow = `pause_retry_${retryCount}`;
                  const enhancedPauseUseCase = this.container.resolve('enhancedPauseSubscriptionUseCase');
                  retryResult = await enhancedPauseUseCase.execute(originalTask.adsPowerId, {
                    googleId: originalTask.googleId,
                    rowIndex: originalTask.rowIndex,
                    profileData: {
                      email: originalTask.googleId,
                      password: originalTask.password,
                      recoveryEmail: originalTask.recoveryEmail,
                      code: originalTask.code,
                      totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                      googleId: originalTask.googleId
                    }
                  });
                } else {
                  this.currentWorkflow = `resume_retry_${retryCount}`;
                  const enhancedResumeUseCase = this.container.resolve('enhancedResumeSubscriptionUseCase');
                  retryResult = await enhancedResumeUseCase.execute(originalTask.adsPowerId, {
                    googleId: originalTask.googleId,
                    rowIndex: originalTask.rowIndex,
                    profileData: {
                      email: originalTask.googleId,
                      password: originalTask.password,
                      recoveryEmail: originalTask.recoveryEmail,
                      code: originalTask.code,
                      totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                      googleId: originalTask.googleId
                    }
                  });
                }
                
                if (retryResult.success) {
                  this.spinner.succeed(`${originalTask.googleId} 재시도 성공`);
                  results.success.push(originalTask.googleId);
                  const failedIndex = results.failed.findIndex(f => f.id === originalTask.googleId);
                  if (failedIndex > -1) {
                    results.failed.splice(failedIndex, 1);
                  }
                  console.log(chalk.green(`  ✔ 상태: ${retryResult.status}`));
                } else {
                  this.spinner.fail(`${originalTask.googleId} 재시도 ${retryCount} 실패`);
                  if (retryResult.error !== '번호인증계정' && !(retryResult.error?.includes('reCAPTCHA'))) {
                    retryableTasks.push({ id: originalTask.googleId, error: retryResult.error });
                  }
                  const failedItem = results.failed.find(f => f.id === originalTask.googleId);
                  if (failedItem) {
                    failedItem.error = `재시도 ${retryCount} 실패: ${retryResult.error}`;
                  }
                }
              } catch (error) {
                if (this.spinner) this.spinner.fail();
                console.log(chalk.red(`재시도 중 오류: ${error.message}`));
                retryableTasks.push({ id: originalTask.googleId, error: error.message });
              } finally {
                this.currentWorkflow = null;
              }
              
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
              await new Promise(r => setTimeout(r, 3000));
            }
            
            if (retryableTasks.length > 0 && retryCount < maxRetries) {
              console.log(chalk.gray(`다음 재시도까지 5초 대기...`));
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
      }
      
      // 최종 결과 요약 (자동 재시도 후)
      console.log(chalk.cyan('\n📊 최종 처리 결과:'));
      console.log(chalk.green(`  ✅ 성공: ${results.success.length}개`));

      // v2.0: 결제 복구 후 재확인 필요한 계정 표시
      if (results.needRecheck && results.needRecheck.length > 0) {
        console.log(chalk.yellow(`  🔄 재확인 필요: ${results.needRecheck.length}개 (결제 복구 완료)`));
        results.needRecheck.forEach(item => {
          console.log(chalk.yellow(`     - ${item.id}: ${item.status}`));
        });
      }

      if (results.failed.length > 0) {
        console.log(chalk.red(`  ❌ 실패: ${results.failed.length}개`));
        results.failed.forEach(item => {
          console.log(chalk.red(`     - ${item.id}: ${item.error}`));
        });

        // 이제 재시도는 자동으로 처리됨
        const retryableTasks = results.failed.filter(item =>
          item.error !== '번호인증계정' &&
          !(item.error?.includes('reCAPTCHA'))
        );

        // 이전 수동 재시도 로직은 주석 처리 (자동 재시도로 대체됨)
        /*
        if (retryableTasks.length > 0) {
          console.log(chalk.yellow(`\n🔄 ${retryableTasks.length}개 계정 재시도를 시작합니다...\n`));

          // 재시도 대기
          await new Promise(resolve => setTimeout(resolve, 5000));

          // 재시도 실행
          for (const failedItem of retryableTasks) {
            // 원본 task 객체 찾기
            const originalTask = selectedTasks.find(t => t.googleId === failedItem.id);
            if (!originalTask) continue;
            
            console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
            console.log(chalk.yellow(`🔄 재시도: ${originalTask.googleId}`));
            console.log(chalk.gray(`  AdsPower ID: ${originalTask.adsPowerId}`));
            console.log(chalk.gray(`  이전 오류: ${failedItem.error}`));
            
            try {
              this.spinner = ora(`[RetryManager] ${originalTask.googleId} 재시도 중...`).start();
              
              // 재시도 전 추가 대기 (브라우저 정리 시간)
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Enhanced 워크플로우 재실행
              const retryResult = await enhancedResumeUseCase.execute(originalTask.adsPowerId, {
                googleId: originalTask.googleId,
                rowIndex: originalTask.rowIndex,
                profileData: {
                  email: originalTask.googleId,
                  password: originalTask.password,
                  recoveryEmail: originalTask.recoveryEmail,
                  code: originalTask.code,
                  totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                  googleId: originalTask.googleId
                }
              });
              
              if (retryResult.success) {
                this.spinner.succeed(`${originalTask.googleId} 재시도 성공`);
                console.log(chalk.green(`  ✔ 상태: ${retryResult.status}`));
                if (retryResult.nextBillingDate) {
                  console.log(chalk.green(`  ✔ 다음 결제일: ${retryResult.nextBillingDate}`));
                }
                console.log(chalk.green(`  ✔ 처리 시간: ${retryResult.duration}초`));
                
                // 성공 목록에 추가하고 실패 목록에서 제거
                results.success.push(originalTask.googleId);
                const failedIndex = results.failed.findIndex(f => f.id === originalTask.googleId);
                if (failedIndex > -1) {
                  results.failed.splice(failedIndex, 1);
                }
                
                // Google Sheets 업데이트는 제거 - EnhancedResumeSubscriptionUseCase에서 이미 처리됨
                // 재시도 성공도 PauseSheetRepository.updateResumeStatus에서 이미 처리 완료
              } else {
                this.spinner.fail(`${originalTask.googleId} 재시도 실패`);
                console.log(chalk.red(`  ✖ 오류: ${retryResult.error}`));
                
                // 실패 정보 업데이트
                const failedItem = results.failed.find(f => f.id === originalTask.googleId);
                if (failedItem) {
                  failedItem.error = `재시도 실패: ${retryResult.error}`;
                }
              }
            } catch (error) {
              if (this.spinner) this.spinner.fail();
              console.log(chalk.red(`  ❌ 재시도 중 오류: ${error.message}`));
              
              // 실패 정보 업데이트
              const failedItem = results.failed.find(f => f.id === originalTask.googleId);
              if (failedItem) {
                failedItem.error = `재시도 오류: ${error.message}`;
              }
            } finally {
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
            }
            
            // 다음 재시도 전 대기
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        */
      }
      
      // 최종 결과 요약
      console.log(chalk.cyan('\n📊 최종 처리 결과:'));
      console.log(chalk.green(`  ✅ 성공: ${results.success.length}개`));
      if (results.needRecheck && results.needRecheck.length > 0) {
        console.log(chalk.yellow(`  🔄 재확인 필요: ${results.needRecheck.length}개 (결제 복구 완료)`));
        results.needRecheck.forEach(item => {
          console.log(chalk.yellow(`     - ${item.id}: ${item.status}`));
        });
      }
      if (results.failed.length > 0) {
        console.log(chalk.red(`  ❌ 실패: ${results.failed.length}개`));
        results.failed.forEach(item => {
          console.log(chalk.red(`     - ${item.id}: ${item.error}`));
        });
      }

      console.log(chalk.green('\n✅ 재개 작업 완료 (개선된 워크플로우)'));

    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
    }

    // 작업 완료 후 자동 종료 옵션
    if (process.env.AUTO_EXIT_AFTER_TASK === 'true' || process.argv.includes('--auto-exit')) {
      console.log(chalk.green('\n✅ 작업이 완료되었습니다. 프로그램을 종료합니다.'));
      process.exit(0);
    }

    // 종료 여부 확인
    const { shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldContinue',
        message: '다른 작업을 계속하시겠습니까?',
        default: false
      }
    ]);

    if (!shouldContinue) {
      console.log(chalk.green('\n✅ 프로그램을 종료합니다.'));
      process.exit(0);
    }

    await this.waitForEnter();
  }

  /**
   * 개선된 일시중지 워크플로우 실행
   */
  async pauseSubscriptionEnhanced() {
    console.log(chalk.cyan('\n===== pauseSubscriptionEnhanced 시작 ====='));
    const workflowType = 'pause'; // 워크플로우 타입 명시
    try {
      // DI 컨테이너 초기화 확인
      if (!this.container) {
        console.log(chalk.gray('🔧 DI 컨테이너 초기화 중...'));
        await this.initialize();
      }
      console.log(chalk.gray('✅ DI 컨테이너 준비됨'));

      // 스케줄 설정 여부 확인
      const { useSchedule } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useSchedule',
          message: '작업 시작 시간을 예약하시겠습니까?',
          default: false
        }
      ]);

      let scheduledTime = null;
      if (useSchedule) {
        scheduledTime = await this.getScheduledTime();
        if (!scheduledTime) {
          console.log(chalk.yellow('\n⚠️ 스케줄 설정이 취소되었습니다.'));
          await this.waitForEnter();
          return;
        }
      }

      // Google Sheets에서 일시중지 목록 가져오기
      this.spinner = ora('일시중지 목록 조회 중...').start();
      
      const EnhancedGoogleSheetsRepository = require('../../infrastructure/repositories/EnhancedGoogleSheetsRepository');
      const sheetsRepository = new EnhancedGoogleSheetsRepository({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID
      });
      const pauseTasks = await sheetsRepository.getPauseTasksWithMapping();
      this.spinner.stop();

      if (pauseTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 일시중지할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 매핑된 계정만 필터링
      const mappedTasks = pauseTasks.filter(task => task.hasMapping);
      if (mappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ AdsPower ID가 매핑된 계정이 없습니다.'));
        console.log(chalk.gray('애즈파워현황 탭에서 매핑을 확인하세요.'));
        await this.waitForEnter();
        return;
      }

      // 재시도 설정 추가
      console.log(chalk.cyan.bold('\n⚙️ 재시도 설정\n'));
      const { maxRetries } = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: '실패 시 재시도 횟수 (0-5):',
          default: 1,
          validate: (value) => {
            if (value >= 0 && value <= 5) return true;
            return '0-5 사이의 값을 입력하세요 (0은 재시도 없음)';
          }
        }
      ]);

      // 계정 목록 표시
      // 상태별 통곀4 곀4산
      const activeCount = mappedTasks.filter(task => 
        task.status === '결제중' || task.status === '활성' || 
        task.status === 'active' || task.status === 'Active'
      ).length;
      const pausedCount = mappedTasks.filter(task => 
        task.status === '일시중지' || task.status === 'paused' || 
        task.status === 'Paused' || task.status === '일시중단'
      ).length;
      
      console.log(chalk.cyan(`\n📋 일시중지 가능한 계정: ${mappedTasks.length}개`));
      console.log(chalk.green(`   • 결제중: ${activeCount}개 (기본 선택)`));
      console.log(chalk.gray(`   • 일시중지: ${pausedCount}개`));
      console.log(chalk.gray(`   • 기타: ${mappedTasks.length - activeCount - pausedCount}개\n`));
      
      const table = new Table({
        head: ['Google ID', 'AdsPower ID', '현재 상태', '다음 결제일'],
        colWidths: [30, 20, 15, 20]
      });

      mappedTasks.forEach(task => {
        table.push([
          task.googleId,
          task.adsPowerId || '-',
          task.status || '미확인',
          task.nextPaymentDate || '-'
        ]);
      });

      console.log(table.toString());

      // '결제중' 상태의 계정만 필터링하여 기본 선택
      const activeAccounts = mappedTasks.filter(task => 
        task.status === '결제중' || 
        task.status === '활성' || 
        task.status === 'active' ||
        task.status === 'Active'
      );
      
      // 선택 옵션 준비 (결제중 상태는 기본 체크)
      const choices = mappedTasks.map(task => {
        const isActive = activeAccounts.includes(task);
        return {
          name: `${task.googleId} (${task.adsPowerId}) - ${task.status || '미확인'}`,
          value: task,
          checked: isActive // 결제중 상태면 기본 선택
        };
      });
      
      console.log(chalk.blue('\n💡 팁: 기본적으로 "결제중" 상태의 계정이 선택되어 있습니다.'));
      console.log(chalk.gray('   Space키로 선택/해제, Enter키로 진행\n'));
      
      // 작업 선택
      const { selectedTasks } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedTasks',
          message: '일시중지할 계정 선택:',
          choices: choices,
          pageSize: 15
        }
      ]);

      console.log(chalk.gray(`\n🔍 선택된 계정 확인:`));
      console.log(chalk.gray(`  - selectedTasks 타입: ${typeof selectedTasks}`));
      console.log(chalk.gray(`  - selectedTasks 길이: ${selectedTasks ? selectedTasks.length : 'undefined'}`));
      if (selectedTasks && selectedTasks.length > 0) {
        console.log(chalk.gray(`  - 첫 번째 계정: ${JSON.stringify(selectedTasks[0])}`));
      }

      if (!selectedTasks || selectedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // Enhanced UseCase 사용
      console.log(chalk.gray('🔧 Enhanced Pause UseCase 로드 중...'));
      const enhancedPauseUseCase = this.container.resolve('enhancedPauseSubscriptionUseCase');

      if (!enhancedPauseUseCase) {
        console.error(chalk.red('❌ enhancedPauseSubscriptionUseCase를 찾을 수 없습니다.'));
        console.log(chalk.yellow('DI 컨테이너 확인이 필요합니다.'));
        await this.waitForEnter();
        return;
      }

      console.log(chalk.green('✅ Enhanced Pause UseCase 로드 완료'));

      // AdsPower ID 매핑 서비스 초기화 (대체 프로필 검색을 위해 필요)
      const mappingService = this.container.resolve('adsPowerIdMappingService');
      if (mappingService && !mappingService.initialized) {
        console.log(chalk.gray('📋 프로필 매핑 서비스 초기화 중...'));
        await mappingService.initialize();
        const stats = mappingService.getStats();
        console.log(chalk.gray(`✅ 매핑 로드 완료: ${stats.totalEmails}개 이메일, ${stats.totalIds}개 프로필`));
      }
      
      // 스케줄이 설정되었으면 예약 실행
      if (scheduledTime) {
        const schedulerService = this.container.resolve('schedulerService');
        const taskId = `pause-${Date.now()}`;
        
        console.log(chalk.cyan(`\n⏰ 작업이 ${scheduledTime.toLocaleString('ko-KR')}에 예약되었습니다.`));
        console.log(chalk.gray(`작업 ID: ${taskId}`));
        
        // 스케줄 작업 등록
        schedulerService.scheduleTask(taskId, scheduledTime, async () => {
          console.log(chalk.green(`\n🚀 예약된 일시중지 작업을 시작합니다...`));
          await this.executePauseWorkflow(selectedTasks, enhancedPauseUseCase, maxRetries, workflowType);
        }, { tasks: selectedTasks });
        
        // 대기 상태 표시
        const nextTask = schedulerService.getTaskInfo(taskId);
        console.log(chalk.blue(`\n남은 시간: ${nextTask.remainingTime}`));
        console.log(chalk.gray('\nESC 또는 Ctrl+C를 눌러 예약을 취소할 수 있습니다.'));
        
        await this.waitForEnter();
        return;
      }

      // 즉시 실행
      console.log(chalk.cyan(`\n📋 워크플로우 실행 준비:`));
      console.log(chalk.gray(`  - 선택된 계정: ${selectedTasks.length}개`));
      console.log(chalk.gray(`  - 재시도 횟수: ${maxRetries}`));
      console.log(chalk.gray(`  - 워크플로우 타입: ${workflowType}`));

      console.log(chalk.yellow('\n⏳ executePauseWorkflow 호출 중...'));
      await this.executePauseWorkflow(selectedTasks, enhancedPauseUseCase, maxRetries, workflowType);
      console.log(chalk.green('✅ executePauseWorkflow 완료'));
    } catch (error) {
      console.error(chalk.red('\n❌ pauseSubscriptionEnhanced 오류 발생:'));
      console.error(chalk.red('  - 오류 메시지:'), error.message);
      console.error(chalk.red('  - 오류 타입:'), error.name);
      console.error(chalk.red('  - 스택 트레이스:'), error.stack);

      if (this.logger) {
        await this.logger.logError(error, { method: 'pauseSubscriptionEnhanced' });
      }

      // 오류 발생 시에도 사용자에게 알림
      console.log(chalk.yellow('\n⚠️ 작업 중 오류가 발생했습니다.'));
      await this.waitForEnter();
    }
  }

  /**
   * 일시중지 워크플로우 실행
   */
  async executePauseWorkflow(selectedTasks, enhancedPauseUseCase, maxRetries = 1, workflowType = 'pause') {
    console.log(chalk.magenta('\n🔍 executePauseWorkflow 진입'));
    console.log(chalk.gray(`  - selectedTasks: ${selectedTasks ? selectedTasks.length : 'undefined'}`));
    console.log(chalk.gray(`  - enhancedPauseUseCase: ${enhancedPauseUseCase ? 'loaded' : 'undefined'}`));
    console.log(chalk.gray(`  - maxRetries: ${maxRetries}`));

    try {
      // 선택된 계정들 처리
      console.log(chalk.cyan(`\n🚀 ${selectedTasks.length}개 계정 일시중지 시작 (개선된 워크플로우)...\n`));

      const results = {
        success: [],
        failed: [],
        needRecheck: []  // v2.0: 결제 복구 후 재확인 필요한 계정
      };

      // ★ v2.3: AdsPower 어댑터 가져오기 (브라우저 명시적 종료를 위해)
      const adsPowerAdapter = this.container.resolve('adsPowerAdapter');

      // ★ v2.2: 인덱스 기반 루프로 변경 (즉시 재시도 지원)
      for (let i = 0; i < selectedTasks.length; i++) {
        const task = selectedTasks[i];

        // ESC 키 또는 Ctrl+C 취소 체크
        if (this.gracefulShutdown && this.gracefulShutdown.isShuttingDownNow()) {
          console.log(chalk.yellow('\n⚠️ 종료 요청으로 작업 중단'));
          break;
        }
        if (this.isWorkflowCancelled) {
          console.log(chalk.yellow('\n⚠️ 사용자에 의해 워크플로우가 취소되었습니다.'));
          break;
        }

        console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
        console.log(chalk.cyan(`🎯 처리 시작: ${task.googleId}`));
        console.log(chalk.gray(`  AdsPower ID: ${task.adsPowerId}`));
        console.log(chalk.gray(`  현재 상태: ${task.status || '미확인'}`));

        try {
          // 현재 워크플로우 설정
          this.currentWorkflow = task.googleId;
          this.spinner = ora(`[WorkflowManager] ${task.googleId} 워크플로우 준비 중...`).start();

          // Enhanced 워크플로우 실행 (프로필 데이터 포함)
          const result = await enhancedPauseUseCase.execute(task.adsPowerId, {
            googleId: task.googleId,
            rowIndex: task.rowIndex,
            profileData: {
              email: task.googleId,
              password: task.password,
              recoveryEmail: task.recoveryEmail,
              code: task.code,
              totpSecret: task.totpSecret || task.code,  // TOTP 시크릿 추가
              googleId: task.googleId
            }
          });

          // reCAPTCHA 감지된 경우 특별 처리
          if (result.status === 'recaptcha_required') {
            this.spinner.warn(`${task.googleId} - 번호인증계정`);
            console.log(chalk.yellow(`  ⚠ reCAPTCHA 감지 - 수동 로그인 필요`));
            console.log(chalk.yellow(`  ⚠ 처리 시간: ${result.duration}초`));
            results.failed.push({ id: task.googleId, error: '번호인증계정' });

            // Google Sheets에 번호인증계정으로 표시
            const now = new Date();
            const timeStr = now.toLocaleString('ko-KR', {
              year: 'numeric',
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            });
            // 번호인증 상태 업데이트는 UseCase에서 처리
            console.log(chalk.gray(`  ✔ Google Sheets에 번호인증 상태 기록`));
          } else if (result.success) {
            // ★ v2.2: "이미 일시중지 상태" 오판 방지를 위한 즉시 재시도
            // 20개 중 1개 꼴로 실제로는 일시중지가 아닌데 일시중지로 잘못 판단하는 경우 방지
            if (result.status === 'already_paused' && !task._alreadyPausedRetried) {
              this.spinner.warn(`${task.googleId} 이미 일시중지 상태 감지 - 재확인 필요`);
              console.log(chalk.yellow(`  ⚠️ "이미 일시중지 상태"로 감지됨 - 오판 가능성 검토`));
              console.log(chalk.cyan(`  🔄 즉시 재시도하여 상태 재확인합니다...`));

              // ★ v2.3: 브라우저 명시적 종료 (Stale WebSocket 연결 방지)
              try {
                console.log(chalk.gray(`  🔧 브라우저 세션 정리 중...`));
                await adsPowerAdapter.closeBrowser(task.adsPowerId);
                console.log(chalk.gray(`  ✅ 브라우저 세션 정리 완료`));
              } catch (closeError) {
                console.log(chalk.gray(`  ⚠️ 브라우저 종료 중 오류 (무시됨): ${closeError.message}`));
              }

              // 브라우저가 완전히 종료될 때까지 대기
              await new Promise(resolve => setTimeout(resolve, 5000));

              // 즉시 재시도 플래그 설정 (무한루프 방지)
              task._alreadyPausedRetried = true;

              // 현재 인덱스를 다시 처리하도록 i 감소
              i--;

              // finally 블록 실행을 위해 continue 대신 직접 처리
              this.currentWorkflow = null;
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
              continue;
            }

            // 정상적인 성공 처리
            this.spinner.succeed(`${task.googleId} 일시중지 성공`);
            console.log(chalk.green(`  ✔ 상태: ${result.status}`));
            if (result.nextBillingDate) {
              console.log(chalk.green(`  ✔ 다음 결제일: ${result.nextBillingDate}`));
            }
            console.log(chalk.green(`  ✔ 처리 시간: ${result.duration}초`));

            // 재시도 후 성공한 경우 추가 메시지
            if (task._alreadyPausedRetried) {
              console.log(chalk.green(`  ✔ (재확인 완료 - 실제로 일시중지 상태)`));
            }

            results.success.push(task.googleId);

            // Google Sheets 업데이트는 UseCase에서 이미 처리됨
            // 중복 업데이트 제거
            if (result.status !== 'already_paused') {
              // 이미 EnhancedPauseSubscriptionUseCase에서 업데이트 완료
              console.log(chalk.gray(`  ✔ Google Sheets 업데이트 완료`));
            }
          } else {
            this.spinner.fail(`${task.googleId} 일시중지 실패`);

            // ★ v2.2: "이미 일시중지 상태" 재시도 후 실패한 경우 메시지 추가
            if (task._alreadyPausedRetried) {
              console.log(chalk.yellow(`  ⚠️ (재확인 후 실패 - 실제로 일시중지 필요)`));
            }

            // [v2.22] 결제 미완료 상태 우선 처리 (통합워커 패턴)
            if (result.status === 'payment_pending') {
              console.log(chalk.yellow(`  ⏳ 결제 미완료: ${result.paymentPendingReason || '결제일 불일치'}`));
              console.log(chalk.gray(`    → 결제 완료 후 통합워커에서 자동 처리됩니다`));
              results.paymentPending = results.paymentPending || [];
              results.paymentPending.push({ id: task.googleId, reason: result.paymentPendingReason });
              // failed 배열에 추가하지 않음 → 자동 재시도 안함 (의도적)
            // v2.1: 결제 복구 성공 후 재확인 필요한 경우 - 재시도 대상에 포함
            } else if (result.error === 'PAYMENT_RECOVERED_NEED_RECHECK' ||
                result.error?.includes('PAYMENT_RECOVERED')) {
              console.log(chalk.green(`  ✔ 결제 문제 발생 후 재결제 완료`));
              console.log(chalk.yellow(`  ⚠ 다시 확인 필요 - 즉시 재시도합니다`));
              results.needRecheck.push({ id: task.googleId, status: '재결제 완료 - 재확인 필요' });
              // ★ v2.1: 재시도 대상에도 추가하여 자동 재시도 되도록 함
              results.failed.push({ id: task.googleId, error: 'PAYMENT_RECOVERED_NEED_RECHECK', isPaymentRecovered: true });
            // 결제 수단 문제 (복구 실패) 처리
            } else if (result.error === 'PAYMENT_METHOD_ISSUE' ||
                result.error?.includes('payment') ||
                result.error?.includes('결제')) {
              console.log(chalk.red(`  ✖ 오류: 결제 수단 문제 - 결제 정보 업데이트 필요`));
              console.log(chalk.yellow(`  ⚠ YouTube Premium 페이지에서 "Update payment method" 버튼 확인됨`));
              results.failed.push({ id: task.googleId, error: '결제 수단 문제' });
            } else {
              console.log(chalk.red(`  ✖ 오류: ${result.error}`));
              results.failed.push({ id: task.googleId, error: result.error });
            }

            // 실패 상태는 UseCase에서 처리
            console.log(chalk.gray(`  ✔ Google Sheets에 실패 상태 기록`));
          }

        } catch (error) {
          if (this.spinner) this.spinner.fail();
          console.log(chalk.red(`\n  ❌ 오류 발생: ${error.message}`));
          results.failed.push({ id: task.googleId, error: error.message });

          // 오류 상태는 UseCase에서 처리
          console.log(chalk.gray(`  ✔ Google Sheets에 오류 상태 기록`));
        } finally {
          // 현재 워크플로우 초기화
          this.currentWorkflow = null;
          console.log(chalk.blue(`${'='.repeat(60)}\n`));
        }

        // 다음 작업 전 대기 (취소 체크 포함)
        if (i < selectedTasks.length - 1 && !this.isWorkflowCancelled) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // 재시도 로직 (maxRetries 기반 자동 재시도)
      if (results.failed.length > 0 && maxRetries > 0) {
        // 번호인증 계정 제외하고 재시도할 계정 필터링
        let retryableTasks = results.failed.filter(item => 
          item.error !== '번호인증계정' && 
          !(item.error?.includes('reCAPTCHA'))
        );
        
        if (retryableTasks.length > 0) {
          console.log(chalk.yellow(`\n⚠️ ${retryableTasks.length}개 계정 재시도 가능 (번호인증 제외)`));
          
          for (let retryCount = 1; retryCount <= maxRetries; retryCount++) {
            if (retryableTasks.length === 0) break;
            
            console.log(chalk.cyan(`\n🔄 자동 재시도 ${retryCount}/${maxRetries} 시작...\n`));
            
            const currentRetryable = [...retryableTasks];
            retryableTasks = []; // 배열 재할당
            
            for (const failedItem of currentRetryable) {
              // ESC 키가 눌렸는지 확인
              if (this.gracefulShutdown && this.gracefulShutdown.isShuttingDownNow()) {
                console.log(chalk.yellow('\n⚠️ 종료 요청으로 재시도 중단'));
                break;
              }
              
              const originalTask = selectedTasks.find(t => t.googleId === failedItem.id);
              if (!originalTask) continue;
              
              try {
                console.log(chalk.blue(`${'='.repeat(60)}`));
                console.log(chalk.cyan(`재시도 ${retryCount}/${maxRetries}: ${originalTask.googleId}`));
                console.log(chalk.gray(`이전 실패 이유: ${failedItem.error}`));
                
                this.spinner = ora(`재시도 중...`).start();
                
                // 워크플로우 타입에 따라 적절한 UseCase 사용
                let retryResult;
                if (workflowType === 'pause') {
                  this.currentWorkflow = `pause_retry_${retryCount}`;
                  const enhancedPauseUseCase = this.container.resolve('enhancedPauseSubscriptionUseCase');
                  retryResult = await enhancedPauseUseCase.execute(originalTask.adsPowerId, {
                    googleId: originalTask.googleId,
                    rowIndex: originalTask.rowIndex,
                    profileData: {
                      email: originalTask.googleId,
                      password: originalTask.password,
                      recoveryEmail: originalTask.recoveryEmail,
                      code: originalTask.code,
                      totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                      googleId: originalTask.googleId
                    }
                  });
                } else {
                  this.currentWorkflow = `resume_retry_${retryCount}`;
                  const enhancedResumeUseCase = this.container.resolve('enhancedResumeSubscriptionUseCase');
                  retryResult = await enhancedResumeUseCase.execute(originalTask.adsPowerId, {
                    googleId: originalTask.googleId,
                    rowIndex: originalTask.rowIndex,
                    profileData: {
                      email: originalTask.googleId,
                      password: originalTask.password,
                      recoveryEmail: originalTask.recoveryEmail,
                      code: originalTask.code,
                      totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                      googleId: originalTask.googleId
                    }
                  });
                }
                
                if (retryResult.success) {
                  this.spinner.succeed(`${originalTask.googleId} 재시도 성공`);
                  results.success.push(originalTask.googleId);
                  const failedIndex = results.failed.findIndex(f => f.id === originalTask.googleId);
                  if (failedIndex > -1) {
                    results.failed.splice(failedIndex, 1);
                  }
                  console.log(chalk.green(`  ✔ 상태: ${retryResult.status}`));
                } else {
                  this.spinner.fail(`${originalTask.googleId} 재시도 ${retryCount} 실패`);
                  if (retryResult.error !== '번호인증계정' && !(retryResult.error?.includes('reCAPTCHA'))) {
                    retryableTasks.push({ id: originalTask.googleId, error: retryResult.error });
                  }
                  const failedItem = results.failed.find(f => f.id === originalTask.googleId);
                  if (failedItem) {
                    failedItem.error = `재시도 ${retryCount} 실패: ${retryResult.error}`;
                  }
                }
              } catch (error) {
                if (this.spinner) this.spinner.fail();
                console.log(chalk.red(`재시도 중 오류: ${error.message}`));
                retryableTasks.push({ id: originalTask.googleId, error: error.message });
              } finally {
                this.currentWorkflow = null;
              }
              
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
              await new Promise(r => setTimeout(r, 3000));
            }
            
            if (retryableTasks.length > 0 && retryCount < maxRetries) {
              console.log(chalk.gray(`다음 재시도까지 5초 대기...`));
              await new Promise(r => setTimeout(r, 5000));
            }
          }
        }
      }
      
      // 최종 결과 요약 (자동 재시도 후)
      console.log(chalk.cyan('\n📊 최종 처리 결과:'));
      console.log(chalk.green(`  ✅ 성공: ${results.success.length}개`));

      // v2.0: 결제 복구 후 재확인 필요한 계정 표시
      if (results.needRecheck && results.needRecheck.length > 0) {
        console.log(chalk.yellow(`  🔄 재확인 필요: ${results.needRecheck.length}개 (결제 복구 완료)`));
        results.needRecheck.forEach(item => {
          console.log(chalk.yellow(`     - ${item.id}: ${item.status}`));
        });
      }

      if (results.failed.length > 0) {
        console.log(chalk.red(`  ❌ 실패: ${results.failed.length}개`));
        results.failed.forEach(item => {
          console.log(chalk.red(`     - ${item.id}: ${item.error}`));
        });

        // 이제 재시도는 자동으로 처리됨
        const retryableTasks = results.failed.filter(item =>
          item.error !== '번호인증계정' &&
          !(item.error?.includes('reCAPTCHA'))
        );

        // 이전 수동 재시도 로직은 주석 처리 (자동 재시도로 대체됨)
        /*
        if (retryableTasks.length > 0) {
          console.log(chalk.yellow(`\n🔄 ${retryableTasks.length}개 계정 재시도를 시작합니다...\n`));

          // 재시도 대기
          await new Promise(resolve => setTimeout(resolve, 5000));

          // 재시도 실행
          for (const failedItem of retryableTasks) {
            // 원본 task 객체 찾기
            const originalTask = selectedTasks.find(t => t.googleId === failedItem.id);
            if (!originalTask) continue;
            
            console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
            console.log(chalk.yellow(`🔄 재시도: ${originalTask.googleId}`));
            console.log(chalk.gray(`  AdsPower ID: ${originalTask.adsPowerId}`));
            console.log(chalk.gray(`  이전 오류: ${failedItem.error}`));
            
            try {
              this.spinner = ora(`[RetryManager] ${originalTask.googleId} 재시도 중...`).start();
              
              // 재시도 전 추가 대기 (브라우저 정리 시간)
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Enhanced 워크플로우 재실행
              const retryResult = await enhancedPauseUseCase.execute(originalTask.adsPowerId, {
                googleId: originalTask.googleId,
                rowIndex: originalTask.rowIndex,
                profileData: {
                  email: originalTask.googleId,
                  password: originalTask.password,
                  recoveryEmail: originalTask.recoveryEmail,
                  code: originalTask.code,
                  totpSecret: originalTask.totpSecret || originalTask.code,  // TOTP 시크릿 추가
                  googleId: originalTask.googleId
                }
              });
              
              if (retryResult.success) {
                this.spinner.succeed(`${originalTask.googleId} 재시도 성공`);
                console.log(chalk.green(`  ✔ 상태: ${retryResult.status}`));
                if (retryResult.nextBillingDate) {
                  console.log(chalk.green(`  ✔ 다음 결제일: ${retryResult.nextBillingDate}`));
                }
                console.log(chalk.green(`  ✔ 처리 시간: ${retryResult.duration}초`));
                
                // 성공 목록에 추가하고 실패 목록에서 제거
                results.success.push(originalTask.googleId);
                const failedIndex = results.failed.findIndex(f => f.id === originalTask.googleId);
                if (failedIndex > -1) {
                  results.failed.splice(failedIndex, 1);
                }
              } else {
                this.spinner.fail(`${originalTask.googleId} 재시도 실패`);
                console.log(chalk.red(`  ✖ 오류: ${retryResult.error}`));
                
                // 실패 정보 업데이트
                const failedItem = results.failed.find(f => f.id === originalTask.googleId);
                if (failedItem) {
                  failedItem.error = `재시도 실패: ${retryResult.error}`;
                }
              }
            } catch (error) {
              if (this.spinner) this.spinner.fail();
              console.log(chalk.red(`  ❌ 재시도 중 오류: ${error.message}`));
              
              // 실패 정보 업데이트
              const failedItem = results.failed.find(f => f.id === originalTask.googleId);
              if (failedItem) {
                failedItem.error = `재시도 오류: ${error.message}`;
              }
            } finally {
              console.log(chalk.blue(`${'='.repeat(60)}\n`));
            }
            
            // 다음 재시도 전 대기
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        */
      }

      // 최종 결과 요약 (수동 재시도 후 - Pause 워크플로우)
      console.log(chalk.cyan('\n📊 최종 처리 결과:'));
      console.log(chalk.green(`  ✅ 성공: ${results.success.length}개`));

      // v2.0: 결제 복구 후 재확인 필요한 계정 표시
      if (results.needRecheck && results.needRecheck.length > 0) {
        console.log(chalk.yellow(`  🔄 재확인 필요: ${results.needRecheck.length}개 (결제 복구 완료)`));
        results.needRecheck.forEach(item => {
          console.log(chalk.yellow(`     - ${item.id}: ${item.status}`));
        });
      }

      if (results.failed.length > 0) {
        console.log(chalk.red(`  ❌ 실패: ${results.failed.length}개`));
        results.failed.forEach(item => {
          console.log(chalk.red(`     - ${item.id}: ${item.error}`));
        });
      }

      console.log(chalk.green('\n✅ 일시중지 작업 완료 (개선된 워크플로우)'));

    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
    }

    // 작업 완료 후 자동 종료 옵션
    if (process.env.AUTO_EXIT_AFTER_TASK === 'true' || process.argv.includes('--auto-exit')) {
      console.log(chalk.green('\n✅ 작업이 완료되었습니다. 프로그램을 종료합니다.'));
      process.exit(0);
    }

    // 종료 여부 확인
    const inquirer = require('inquirer');
    const { shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldContinue',
        message: '다른 작업을 계속하시겠습니까?',
        default: false
      }
    ]);

    if (!shouldContinue) {
      console.log(chalk.green('\n✅ 프로그램을 종료합니다.'));
      process.exit(0);
    }

    await this.waitForEnter();
  }

  /**
   * 스케줄 시간 입력 받기
   */
  async getScheduledTime() {
    try {
      const { scheduleType } = await inquirer.prompt([
        {
          type: 'list',
          name: 'scheduleType',
          message: '예약 시간을 선택하세요:',
          choices: [
            { name: '10분 후', value: 'minutes_10' },
            { name: '30분 후', value: 'minutes_30' },
            { name: '1시간 후', value: 'hours_1' },
            { name: '2시간 후', value: 'hours_2' },
            { name: '4시간 후', value: 'hours_4' },
            { name: '오늘 특정 시간', value: 'today_specific' },
            { name: '내일 특정 시간', value: 'tomorrow_specific' },
            { name: '직접 입력', value: 'custom' },
            { name: '취소', value: 'cancel' }
          ]
        }
      ]);

      if (scheduleType === 'cancel') {
        return null;
      }

      const now = new Date();
      let scheduledTime;

      switch (scheduleType) {
        case 'minutes_10':
          scheduledTime = new Date(now.getTime() + 10 * 60 * 1000);
          break;
        case 'minutes_30':
          scheduledTime = new Date(now.getTime() + 30 * 60 * 1000);
          break;
        case 'hours_1':
          scheduledTime = new Date(now.getTime() + 60 * 60 * 1000);
          break;
        case 'hours_2':
          scheduledTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
          break;
        case 'hours_4':
          scheduledTime = new Date(now.getTime() + 4 * 60 * 60 * 1000);
          break;
        case 'today_specific':
        case 'tomorrow_specific':
          const { hour, minute } = await inquirer.prompt([
            {
              type: 'input',
              name: 'hour',
              message: '시간을 입력하세요 (0-23):',
              validate: (value) => {
                const num = parseInt(value);
                return num >= 0 && num <= 23 ? true : '0-23 사이의 숫자를 입력하세요';
              }
            },
            {
              type: 'input',
              name: 'minute',
              message: '분을 입력하세요 (0-59):',
              validate: (value) => {
                const num = parseInt(value);
                return num >= 0 && num <= 59 ? true : '0-59 사이의 숫자를 입력하세요';
              }
            }
          ]);

          scheduledTime = new Date();
          scheduledTime.setHours(parseInt(hour));
          scheduledTime.setMinutes(parseInt(minute));
          scheduledTime.setSeconds(0);
          scheduledTime.setMilliseconds(0);

          if (scheduleType === 'tomorrow_specific') {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
          } else if (scheduledTime <= now) {
            // 오늘 설정했는데 이미 지난 시간이면 내일로 변경
            console.log(chalk.yellow('⚠️ 지정한 시간이 이미 지났습니다. 내일 같은 시간으로 설정합니다.'));
            scheduledTime.setDate(scheduledTime.getDate() + 1);
          }
          break;
        case 'custom':
          const { customDateTime } = await inquirer.prompt([
            {
              type: 'input',
              name: 'customDateTime',
              message: '날짜와 시간을 입력하세요 (예: 2024-12-25 14:30):',
              validate: (value) => {
                const date = new Date(value);
                if (isNaN(date.getTime())) {
                  return '올바른 날짜 형식을 입력하세요 (예: 2024-12-25 14:30)';
                }
                if (date <= now) {
                  return '미래 시간을 입력하세요';
                }
                const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                if (date > maxDate) {
                  return '최대 7일 이내의 시간만 설정 가능합니다';
                }
                return true;
              }
            }
          ]);
          scheduledTime = new Date(customDateTime);
          break;
      }

      // 스케줄러 서비스로 유효성 검증
      const schedulerService = this.container.resolve('schedulerService');
      const validation = schedulerService.validateScheduleTime(scheduledTime);
      
      if (!validation.valid) {
        console.log(chalk.red(`❌ ${validation.message}`));
        return null;
      }

      // 확인 메시지
      console.log(chalk.cyan(`\n📅 예약 시간: ${scheduledTime.toLocaleString('ko-KR')}`));
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: '이 시간으로 예약하시겠습니까?',
          default: true
        }
      ]);

      return confirm ? scheduledTime : null;
    } catch (error) {
      console.error(chalk.red('스케줄 설정 중 오류:'), error.message);
      return null;
    }
  }

  /**
   * Enter 키 대기
   */
  async waitForEnter() {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: chalk.gray('Enter 키를 눌러 계속...')
      }
    ]);
  }

  /**
   * CLI 실행
   */
  async run() {
    try {
      // 초기화
      await this.initialize();
      
      // 메인 루프
      while (true) {
        const action = await this.showMainMenu();
        
        if (action === 'exit') {
          console.log(chalk.green('\n👋 Enterprise CLI 종료'));
          await this.cleanup();
          process.exit(0);
        }

        // 액션 실행
        // batchPause는 제거되었으므로 특별 처리
        if (action === 'batchPause') {
          // batchPause는 batchPauseOptimized로 리다이렉트
          await this.batchPauseOptimized();
        } else if (action === 'settings') {
          // 설정 메뉴 표시
          await this.showSettings();
        } else if (action === 'deleteProfiles') {
          // 프로필 삭제 기능
          await this.deleteProfiles();
        } else if (action === 'checkInviteLinks') {
          // 초대링크 확인 기능
          await this.checkInviteLinks();
        } else if (action === 'checkExistingFamilyPlan') {
          // 가족요금제 기존 계정 확인
          await this.checkExistingFamilyPlan();
        } else if (this[action]) {
          console.log(chalk.gray(`\n🚀 액션 실행: ${action}`));
          console.log(chalk.gray(`  - 메서드 존재: ${typeof this[action] === 'function' ? '예' : '아니오'}`));
          await this[action]();
          console.log(chalk.gray(`✅ 액션 완료: ${action}\n`));
        } else {
          console.log(chalk.yellow('\n🚀 개발 중인 기능입니다.'));
          await this.waitForEnter();
        }
      }
      
    } catch (error) {
      console.error(chalk.red('\n❌ Fatal error:'), error);
      process.exit(1);
    }
  }

  /**
   * 배치 일시중지 최적화 - 방어적 분산 처리
   */
  async batchPauseOptimized() {
    try {
      console.log(chalk.cyan.bold('\n🛡️  방어적 분산 처리 시스템 - 배치 일시중지'));
      console.log(chalk.gray('─'.repeat(50)));

      // 개선된 시스템 사용 여부 확인
      const { useImproved } = await inquirer.prompt([
        {
          type: 'list',
          name: 'useImproved',
          message: '배치 처리 시스템을 선택하세요:',
          choices: [
            { name: '✨ 개선된 시스템 (배치 크기 선택, 진행 상황 표시, 실시간 컨트롤)', value: 'improved' },
            { name: '📊 시각적 컨트롤러 (초보자 친화적)', value: 'visual' },
            { name: '🔧 기존 방어적 시스템', value: 'legacy' }
          ]
        }
      ]);

      if (useImproved === 'improved') {
        // 개선된 방어적 배치 시스템 실행
        console.log(chalk.green('\n✅ 개선된 방어적 배치 시스템을 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'improved-defensive-batch.js');
        const child = execFile(process.execPath, [scriptPath, '--mode=pause'], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 배치 일시중지 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 배치 처리가 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      } else if (useImproved === 'visual') {
        // 시각적 컨트롤러 실행
        console.log(chalk.green('\n✅ 시각적 배치 컨트롤러를 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'visual-batch-controller.js');
        const child = execFile(process.execPath, [scriptPath], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 배치 작업 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 배치 작업이 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      } else {
        // 기존 방어적 분산 처리 시스템 실행
        console.log(chalk.green('\n✅ 기존 방어적 분산 처리 시스템을 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'run-defensive-distributed.js');
        const child = execFile(process.execPath, [scriptPath, '--mode=pause'], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 방어적 분산 일시중지 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 방어적 분산 처리가 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      }

      // 폴백 방식 제거 - 위의 선택지 중 하나를 반드시 실행

    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
      await this.waitForEnter();
    }
  }

  /**
   * 기존 배치 일시중지 로직 (별도 메서드로 분리)
   */
  async legacyBatchPause() {
    try {
      // Google Sheets에서 일시중지 목록 가져오기
      this.spinner = ora('일시중지 목록 조회 중...').start();

      const EnhancedGoogleSheetsRepository = require('../../infrastructure/repositories/EnhancedGoogleSheetsRepository');
      const sheetsRepository = new EnhancedGoogleSheetsRepository({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID
      });
      const pauseTasks = await sheetsRepository.getPauseTasksWithMapping();
      this.spinner.stop();

      if (pauseTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 일시중지할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 매핑된 계정만 필터링
      const mappedTasks = pauseTasks.filter(task => task.hasMapping);
      if (mappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ AdsPower ID가 매핑된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 상태별 통계
      const activeCount = mappedTasks.filter(task =>
        task.status === '결제중' || task.status === '활성' || task.status === 'active'
      ).length;
      
      console.log(chalk.cyan(`\n📋 일시중지 가능한 계정: ${mappedTasks.length}개`));
      console.log(chalk.green(`   • 결제중: ${activeCount}개`));
      console.log(chalk.gray(`   • 기타: ${mappedTasks.length - activeCount}개\n`));

      // 작업 설정
      const { concurrency, batchSize, autoStart } = await inquirer.prompt([
        {
          type: 'number',
          name: 'concurrency',
          message: '동시 실행 수 (1-5):',
          default: 3,
          validate: (value) => value >= 1 && value <= 5 ? true : '1-5 사이의 값을 입력하세요'
        },
        {
          type: 'number',
          name: 'batchSize',
          message: '배치 크기 (5-20):',
          default: 10,
          validate: (value) => value >= 5 && value <= 20 ? true : '5-20 사이의 값을 입력하세요'
        },
        {
          type: 'confirm',
          name: 'autoStart',
          message: `결제중 상태 ${activeCount}개 계정을 자동으로 처리하시겠습니까?`,
          default: true
        }
      ]);

      let selectedTasks = [];
      
      if (autoStart) {
        // 결제중 상태만 자동 선택
        selectedTasks = mappedTasks.filter(task => 
          task.status === '결제중' || task.status === '활성' || task.status === 'active'
        );
      } else {
        // 수동 선택
        const choices = mappedTasks.map(task => ({
          name: `${task.googleId} (${task.adsPowerId}) - ${task.status || '미확인'}`,
          value: task,
          checked: task.status === '결제중' || task.status === '활성'
        }));
        
        const { selected } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selected',
            message: '처리할 계정 선택:',
            choices: choices,
            pageSize: 15
          }
        ]);
        
        selectedTasks = selected;
      }

      if (selectedTasks.length === 0) {
        console.log(chalk.yellow('선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 최종 확인
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow(`${selectedTasks.length}개 계정을 일시중지하시겠습니까?`),
          default: true
        }
      ]);

      if (!confirm) {
        console.log(chalk.gray('취소되었습니다.'));
        await this.waitForEnter();
        return;
      }

      // 배치 일시중지 실행
      const batchPauseUseCase = this.container.resolve('batchPauseOptimizedUseCase');
      const result = await batchPauseUseCase.execute(selectedTasks, {
        concurrency,
        batchSize,
        retryEnabled: true,
        retryLimit: 1,
        delayBetweenBatches: 5000
      });

      console.log(chalk.green('\n✅ 배치 일시중지 완료'));
      await this.waitForEnter();
      
    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
      await this.waitForEnter();
    }
  }

  /**
   * 배치 재개 최적화 - 방어적 분산 처리
   */
  async batchResumeOptimized() {
    try {
      console.log(chalk.cyan.bold('\n🛡️  방어적 분산 처리 시스템 - 배치 재개'));
      console.log(chalk.gray('─'.repeat(50)));

      // 개선된 시스템 사용 여부 확인
      const { useImproved } = await inquirer.prompt([
        {
          type: 'list',
          name: 'useImproved',
          message: '배치 처리 시스템을 선택하세요:',
          choices: [
            { name: '✨ 개선된 시스템 (배치 크기 선택, 진행 상황 표시, 실시간 컨트롤)', value: 'improved' },
            { name: '📊 시각적 컨트롤러 (초보자 친화적)', value: 'visual' },
            { name: '🔧 기존 방어적 시스템', value: 'legacy' }
          ]
        }
      ]);

      if (useImproved === 'improved') {
        // 개선된 방어적 배치 시스템 실행
        console.log(chalk.green('\n✅ 개선된 방어적 배치 시스템을 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'improved-defensive-batch.js');
        const child = execFile(process.execPath, [scriptPath, '--mode=resume'], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 배치 재개 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 배치 처리가 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      } else if (useImproved === 'visual') {
        // 시각적 컨트롤러 실행
        console.log(chalk.green('\n✅ 시각적 배치 컨트롤러를 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'visual-batch-controller.js');
        const child = execFile(process.execPath, [scriptPath], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 배치 작업 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 배치 작업이 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      } else {
        // 기존 방어적 분산 처리 시스템 실행
        console.log(chalk.green('\n✅ 기존 방어적 분산 처리 시스템을 시작합니다...\n'));

        const { execFile } = require('child_process');
        const path = require('path');

        const scriptPath = path.join(__dirname, '..', '..', '..', 'run-defensive-distributed.js');
        const child = execFile(process.execPath, [scriptPath, '--mode=resume'], {
          stdio: 'inherit',
          windowsHide: true
        });

        return new Promise((resolve) => {
          child.on('exit', (code) => {
            if (code === 0) {
              console.log(chalk.green('\n✅ 방어적 분산 재개 완료'));
            } else {
              console.log(chalk.yellow('\n⚠️ 방어적 분산 처리가 종료되었습니다.'));
            }
            this.waitForEnter().then(resolve);
          });
        });
      }

    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
      await this.waitForEnter();
    }
  }

  /**
   * 시간체크 통합 워커 (일시중지 + 결제재개)
   * - 일시중지: 현재시간 + N분 이전의 계정 처리
   * - 결제재개: 현재시간 - M분 이전의 계정 처리
   * - 분산 워커: J열 잠금으로 여러 PC에서 충돌 없이 작업
   * - [v2.15] 설정값은 Google Sheets '설정' 탭에서 자동 참조
   */
  async scheduledWorker() {
    try {
      console.log(chalk.cyan.bold('\n📅 시간체크 통합 구독관리 워커 v2.41'));
      console.log(chalk.gray('─'.repeat(50)));

      // [v2.15] SharedConfig에서 설정값 로드
      const sharedConfig = this.container.resolve('sharedConfig');

      // SharedConfig 초기화 (최초 1회)
      if (!sharedConfig.isInitialized) {
        console.log(chalk.gray('  ⏳ Google Sheets "설정" 탭 로드 중...'));
        await sharedConfig.initialize();
      }

      // 현재 설정값 조회
      const resumeMinutesBefore = sharedConfig.getResumeMinutesBefore();
      const pauseMinutesAfter = sharedConfig.getPauseMinutesAfter();
      const checkIntervalSeconds = sharedConfig.getCheckIntervalSeconds();
      const maxRetryCount = sharedConfig.getMaxRetryCount();

      // [v2.34] Telegram 알림 설정 조회
      const tgCritical = sharedConfig.isTelegramNotifyCritical();
      const tgPaymentDelay = sharedConfig.isTelegramNotifyPaymentDelay();
      const tgInfiniteLoop = sharedConfig.isTelegramNotifyInfiniteLoop();
      const tgMaxRetry = sharedConfig.isTelegramNotifyMaxRetry();
      const tgPaymentIssue = sharedConfig.isTelegramNotifyPaymentIssue();
      const tgOnCount = [tgCritical, tgPaymentDelay, tgInfiniteLoop, tgMaxRetry, tgPaymentIssue].filter(Boolean).length;

      // 설정값 표시 (Google Sheets '설정' 탭 기준)
      console.log(chalk.cyan('  📋 현재 설정 (Google Sheets "설정" 탭 참조):'));
      console.log(chalk.white(`     • 결제재개: 결제 전 ${chalk.yellow(resumeMinutesBefore)}분에 "일시중지" → "결제중"`));
      console.log(chalk.white(`     • 일시중지: 결제 후 ${chalk.yellow(pauseMinutesAfter)}분에 "결제중" → "일시중지"`));
      console.log(chalk.white(`     • 체크 간격: ${chalk.yellow(checkIntervalSeconds)}초`));
      console.log(chalk.white(`     • 최대 재시도: ${chalk.yellow(maxRetryCount)}회`));

      // [v2.34] Telegram 알림 상태 표시
      const onOff = (v) => v ? chalk.green('ON') : chalk.red('OFF');
      console.log(chalk.white(`     • Telegram 알림: ${chalk.yellow(tgOnCount)}/5 활성화`));
      console.log(chalk.gray(`       영구실패=${onOff(tgCritical)} 결제지연=${onOff(tgPaymentDelay)} 무한루프=${onOff(tgInfiniteLoop)} 재시도초과=${onOff(tgMaxRetry)} 결제수단=${onOff(tgPaymentIssue)}`));

      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray('  💡 설정 변경: Google Sheets "설정" 탭에서 수정 (매 사이클 자동 반영)'));
      console.log(chalk.gray('  • 분산 워커: 여러 PC에서 동시 실행 가능'));
      console.log(chalk.gray('  • 지속 실행: 새 대상 자동 감지'));
      console.log(chalk.gray('  • 참조 탭: 통합워커'));
      console.log(chalk.gray('─'.repeat(50)));

      // 실행 옵션 입력 (윈도우 모드, 지속실행, 디버그 모드)
      const { windowMode, continuous, debugMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'windowMode',
          message: '실행 모드 선택:',
          choices: [
            {
              name: '🖥️  포커싱 모드 - 브라우저 창 확인하면서 작업 (권장)',
              value: 'focus',
              short: '포커싱'
            },
            {
              name: '🔲 백그라운드 모드 - 다른 작업하면서 자동 실행',
              value: 'background',
              short: '백그라운드'
            }
          ],
          default: 'focus'
        },
        {
          type: 'confirm',
          name: 'continuous',
          message: '지속 실행 모드? (Ctrl+C로 종료)',
          default: WORKER_DEFAULTS.continuous
        },
        {
          type: 'confirm',
          name: 'debugMode',
          message: '디버그 모드 활성화?',
          default: WORKER_DEFAULTS.debugMode
        }
      ]);

      // 백그라운드 모드 안내
      if (windowMode === 'background') {
        console.log(chalk.cyan('\n📋 백그라운드 모드 안내:'));
        console.log(chalk.gray('  • CDP(Chrome DevTools Protocol)로 동작하여 포커스 없이 정상 작동'));
        console.log(chalk.gray('  • 브라우저 창이 열려도 작업은 백그라운드에서 진행됩니다'));
        console.log(chalk.gray('  • 다른 작업을 하셔도 자동화가 중단되지 않습니다'));
        console.log(chalk.yellow('  ⚠️ 브라우저 창을 최소화하면 일부 렌더링 문제가 발생할 수 있습니다'));
        console.log('');
      }

      // 최종 확인
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: '위 설정으로 시작하시겠습니까?',
          default: true
        }
      ]);

      if (!confirm) {
        console.log(chalk.yellow('\n⚠️ 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }

      // UseCase 실행 (설정값은 UseCase 내부에서 sharedConfig 참조)
      const modeLabel = windowMode === 'background' ? '백그라운드' : '포커싱';
      console.log(chalk.green(`\n🚀 시간체크 통합 워커 v2.35 시작... [${modeLabel} 모드]\n`));

      const scheduledWorkerUseCase = this.container.resolve('scheduledSubscriptionWorkerUseCase');

      const result = await scheduledWorkerUseCase.execute({
        continuous,
        debugMode,
        windowMode  // 포커싱/백그라운드 모드 전달
        // 나머지 설정값은 UseCase에서 sharedConfig 통해 자동 참조
      });

      // 결과 표시
      if (result.success) {
        console.log(chalk.green('\n✅ 시간체크 통합 워커 완료'));
      } else {
        console.log(chalk.yellow('\n⚠️ 일부 작업이 실패했습니다.'));
      }

    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
      console.error(error);
    }

    await this.waitForEnter();
  }

  /**
   * 기존 배치 재개 로직 (별도 메서드로 분리)
   */
  async legacyBatchResume() {
    try {
      console.log(chalk.yellow('\n⚠️ 기존 배치 처리 방식을 사용합니다.'));

      // Google Sheets에서 재개 목록 가져오기
      this.spinner = ora('재개 목록 조회 중...').start();

      // SimpleGoogleSheetsRepository 사용
      const SimpleGoogleSheetsRepository = require('../../infrastructure/repositories/SimpleGoogleSheetsRepository');
      const sheetsRepository = new SimpleGoogleSheetsRepository({
        spreadsheetId: this.config.googleSheetsId || process.env.GOOGLE_SHEETS_ID
      });
      
      const resumeTasks = await sheetsRepository.getResumeTasksWithMapping();
      this.spinner.stop();

      if (resumeTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ 재개할 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 매핑된 계정만 필터링
      const mappedTasks = resumeTasks.filter(task => task.hasMapping);
      if (mappedTasks.length === 0) {
        console.log(chalk.yellow('\n⚠️ AdsPower ID가 매핑된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 상태별 통계
      const pausedCount = mappedTasks.filter(task => 
        task.status === '일시중지' || task.status === 'paused'
      ).length;
      
      console.log(chalk.cyan(`\n📋 재개 가능한 계정: ${mappedTasks.length}개`));
      console.log(chalk.yellow(`   • 일시중지: ${pausedCount}개`));
      console.log(chalk.gray(`   • 기타: ${mappedTasks.length - pausedCount}개\n`));

      // 작업 설정
      const { concurrency, batchSize, autoStart } = await inquirer.prompt([
        {
          type: 'number',
          name: 'concurrency',
          message: '동시 실행 수 (1-5):',
          default: 3,
          validate: (value) => value >= 1 && value <= 5 ? true : '1-5 사이의 값을 입력하세요'
        },
        {
          type: 'number',
          name: 'batchSize',
          message: '배치 크기 (5-20):',
          default: 10,
          validate: (value) => value >= 5 && value <= 20 ? true : '5-20 사이의 값을 입력하세요'
        },
        {
          type: 'confirm',
          name: 'autoStart',
          message: `일시중지 상태 ${pausedCount}개 계정을 자동으로 처리하시겠습니까?`,
          default: true
        }
      ]);

      let selectedTasks = [];
      
      if (autoStart) {
        // 일시중지 상태만 자동 선택
        selectedTasks = mappedTasks.filter(task => 
          task.status === '일시중지' || task.status === 'paused'
        );
      } else {
        // 수동 선택
        const choices = mappedTasks.map(task => ({
          name: `${task.googleId} (${task.adsPowerId}) - ${task.status || '미확인'}`,
          value: task,
          checked: task.status === '일시중지' || task.status === 'paused'
        }));
        
        const { selected } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selected',
            message: '처리할 계정 선택:',
            choices: choices,
            pageSize: 15
          }
        ]);
        
        selectedTasks = selected;
      }

      if (selectedTasks.length === 0) {
        console.log(chalk.yellow('선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 최종 확인
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow(`${selectedTasks.length}개 계정을 재개하시겠습니까?`),
          default: true
        }
      ]);

      if (!confirm) {
        console.log(chalk.gray('취소되었습니다.'));
        await this.waitForEnter();
        return;
      }

      // 배치 재개 실행
      const batchResumeUseCase = this.container.resolve('batchResumeOptimizedUseCase');
      const result = await batchResumeUseCase.execute(selectedTasks, {
        concurrency,
        batchSize,
        retryEnabled: true,
        retryLimit: 1,
        delayBetweenBatches: 5000
      });

      console.log(chalk.green('\n✅ 배치 재개 완료'));
      await this.waitForEnter();
      
    } catch (error) {
      if (this.spinner) this.spinner.fail();
      console.log(chalk.red(`\n❌ 오류: ${error.message}`));
      await this.waitForEnter();
    }
  }

  /**
   * TXT → Google Sheets 백업
   */
  async txtBackup() {
    console.log(chalk.cyan.bold('\n📤 TXT → Google Sheets 최종 백업\n'));
    console.log(chalk.gray('시트 내 중복 처리 & acc_id 정렬 포함'));
    
    try {
      // 최종 백업 Use Case 사용 (시트 내 중복 처리)
      const TxtBackupUseCaseFinal = require('../../application/usecases/TxtBackupUseCaseFinal');
      const txtBackupUseCase = new TxtBackupUseCaseFinal({
        googleSheetsRepository: this.container.resolve('profileRepository'),
        logger: this.logger
      });
      
      // 백업 실행 확인
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'data/text_export 폴더의 TXT 파일들을 Google Sheets로 백업하시겠습니까?',
          default: true
        }
      ]);
      
      if (!confirm) {
        console.log(chalk.gray('취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      console.log();
      console.log(chalk.yellow('📋 처리 옵션:'));
      console.log(chalk.gray('  • 중복 ID: 날짜가 최신인 데이터 유지'));
      console.log(chalk.gray('  • 정렬: acc_id 기준 오름차순'));
      console.log(chalk.gray('  • 처리 방식: 일괄 파싱 → 중복 제거 → 정렬 → 업로드'));
      console.log();
      
      const result = await txtBackupUseCase.execute();
      
      // 결과 표시
      if (result.successfulBackups > 0) {
        console.log(chalk.green(`\n✅ 백업 완료: ${result.successfulBackups}개 프로필`));
        console.log(chalk.blue(`📁 처리된 파일: ${result.processedFiles}개`));
        
        // 중복 처리 통계 표시
        if (result.duplicatesRemoved && result.duplicatesRemoved > 0) {
          console.log(chalk.yellow(`🔄 중복 ID 교체: ${result.duplicatesRemoved}개`));
        }
        
        if (result.movedFiles && result.movedFiles.length > 0) {
          console.log(chalk.cyan('\n이동된 파일:'));
          result.movedFiles.forEach(file => {
            console.log(chalk.gray(`  - ${file}`));
          });
        }
      } else {
        console.log(chalk.yellow('\n⚠️ 백업할 파일이 없거나 실패했습니다.'));
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 백업 실패: ${error.message}`));
      this.logger.error('TXT 백업 실패', error);
    }
    
    await this.waitForEnter();
  }
  
  /**
   * Google Sheets → TXT 복원
   */
  async txtRestore() {
    console.log(chalk.cyan.bold('\n📥 Google Sheets → TXT 복원\n'));
    
    try {
      // 복원 Use Case 실행
      const txtRestoreUseCase = this.container.resolve('txtRestoreUseCase');
      
      // 복원 옵션 선택
      const { restoreType } = await inquirer.prompt([
        {
          type: 'list',
          name: 'restoreType',
          message: '복원 방식을 선택하세요:',
          choices: [
            { name: '전체 데이터 복원', value: 'all' },
            { name: '그룹별 복원', value: 'group' },
            { name: '특정 프로필 복원', value: 'specific' },
            { name: '취소', value: 'cancel' }
          ]
        }
      ]);
      
      if (restoreType === 'cancel') {
        console.log(chalk.gray('취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      let options = {};
      
      // 복원 옵션 설정
      if (restoreType === 'group') {
        const { group } = await inquirer.prompt([
          {
            type: 'input',
            name: 'group',
            message: '복원할 그룹 이름:',
            validate: input => input.trim() !== ''
          }
        ]);
        options.filter = { group };
        
      } else if (restoreType === 'specific') {
        const { profileNames } = await inquirer.prompt([
          {
            type: 'input',
            name: 'profileNames',
            message: '복원할 프로필 이름 (쉼표로 구분):',
            validate: input => input.trim() !== ''
          }
        ]);
        
        const names = profileNames.split(',').map(n => n.trim());
        console.log();
        const result = await txtRestoreUseCase.restoreSpecificProfiles(names);
        
        if (result) {
          console.log(chalk.green(`\n✅ 복원 완료: ${result}`));
        }
        
        await this.waitForEnter();
        return;
      }
      
      // 파일명 입력
      const { fileName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'fileName',
          message: '출력 파일명 (선택사항, 엔터로 건너뛰기):',
          default: ''
        }
      ]);
      
      if (fileName) {
        options.outputFileName = fileName;
      }
      
      // 복원 실행
      console.log();
      const result = await txtRestoreUseCase.execute(options);
      
      // 결과 표시
      if (result.restoredProfiles > 0) {
        console.log(chalk.green(`\n✅ 복원 완료: ${result.restoredProfiles}개 프로필`));
        console.log(chalk.blue(`📄 생성된 파일: ${result.filesCreated.length}개`));
        
        if (result.filesCreated.length > 0) {
          console.log(chalk.cyan('\n생성된 파일:'));
          result.filesCreated.forEach(file => {
            console.log(chalk.gray(`  - data/restore_output/${file}`));
          });
        }
      } else {
        console.log(chalk.yellow('\n⚠️ 복원할 데이터가 없습니다.'));
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 복원 실패: ${error.message}`));
      this.logger.error('TXT 복원 실패', error);
    }
    
    await this.waitForEnter();
  }

  /**
   * 초대링크 확인 (일반 Chrome 사용)
   */
  async checkInviteLinks() {
    console.log(chalk.blue.bold('\n🔗 YouTube Family 초대링크 확인\n'));
    console.log(chalk.cyan('ℹ️  일반 Chrome 브라우저를 사용하여 링크를 확인합니다'));
    console.log(chalk.yellow('⚠️  Google Sheets "초대링크확인" 탭에서 링크를 읽어옵니다'));
    console.log(chalk.gray('='.repeat(60)));
    
    try {
      // InviteLinkCheckUseCase 실행
      const InviteLinkCheckUseCase = require('../../application/usecases/InviteLinkCheckUseCase');

      // sheetsRepository를 안전하게 resolve
      let sheetsRepository;
      try {
        sheetsRepository = this.container.resolve('googleSheetsRepository');
        if (!sheetsRepository) {
          // fallback으로 enhancedSheetsRepository 시도
          sheetsRepository = this.container.resolve('enhancedSheetsRepository');
        }
      } catch (resolveError) {
        console.log(chalk.yellow('⚠️  Google Sheets Repository를 찾을 수 없습니다. Mock 모드로 전환합니다.'));
        // Mock Repository 사용
        sheetsRepository = {
          async initialize() {},
          async fetchData() { return []; },
          async updateData() { return true; }
        };
      }

      const inviteLinkChecker = new InviteLinkCheckUseCase({
        sheetsRepository: sheetsRepository,
        logger: this.logger || console
      });
      
      // 실행
      const result = await inviteLinkChecker.execute();
      
      if (result.success) {
        console.log(chalk.green('\n✅ 초대링크 확인이 완료되었습니다!'));
        if (result.duration) {
          console.log(chalk.gray(`소요 시간: ${result.duration}초`));
        }
      } else {
        console.log(chalk.yellow('\n⚠️ 초대링크 확인이 완료되었지만 일부 오류가 있었습니다.'));
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 초대링크 확인 실패: ${error.message}`));
      this.logger.error('초대링크 확인 실패', error);
    }
    
    await this.waitForEnter();
  }

  /**
   * 가족요금제 자동 검증 (Windows 11) - 향상된 버전
   */
  async checkFamilyPlan() {
    console.log(chalk.cyan.bold('\n👨‍👩‍👧‍👦 YouTube 가족요금제 자동 검증 (Windows 11)\n'));
    console.log(chalk.yellow('📋 완전 자동화된 가족요금제 검증 시스템'));
    console.log(chalk.gray('✨ Windows 11 프로필 생성 + TOTP 2FA + 자동 프로필 관리'));
    console.log(chalk.gray('─'.repeat(60)));
    
    try {
      // 기능 설명
      console.log(chalk.white('\n워크플로우:'));
      console.log(chalk.gray('  1. Google Sheets "가족요금제" 탭에서 계정 로드'));
      console.log(chalk.gray('  2. Windows 11 OS로 AdsPower 프로필 생성'));
      console.log(chalk.gray('  3. Google 로그인 (TOTP 2FA 자동 처리)'));
      console.log(chalk.gray('  4. YouTube 가족요금제 상태 확인'));
      console.log(chalk.gray('  5. 가족요금제 있으면 프로필 유지, 없으면 삭제'));
      console.log(chalk.gray('  6. 결과를 Google Sheets G열에 업데이트'));
      console.log();
      
      // EnhancedFamilyPlanCheckUseCase 사용 (향상된 버전)
      const enhancedFamilyPlanCheckUseCase = this.container.resolve('enhancedFamilyPlanCheckUseCase');
      
      // Google Sheets에서 계정 목록 가져오기
      this.spinner = ora('가족요금제 계정 목록 조회 중...').start();
      
      // familyPlanSheetRepository가 없을 수 있으므로 직접 로드
      const accounts = await enhancedFamilyPlanCheckUseCase.loadFamilyPlanAccounts();
      this.spinner.stop();
      
      if (!accounts || accounts.length === 0) {
        console.log(chalk.yellow('\n⚠️ 가족요금제 탭에 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }
      
      // 상태별 계정 분류
      const emptyStatusAccounts = accounts.filter(acc => !acc.status || acc.status === '');
      const checkedAccounts = accounts.filter(acc => acc.status && acc.status !== '');
      
      console.log(chalk.cyan(`\n📋 전체 계정: ${accounts.length}개`));
      console.log(chalk.green(`   • 미처리 (G열 비어있음): ${emptyStatusAccounts.length}개`));
      console.log(chalk.gray(`   • 처리됨 (G열 값 있음): ${checkedAccounts.length}개`));
      console.log();
      
      // 계정 목록 테이블 표시
      const Table = require('cli-table3');
      const table = new Table({
        head: ['이메일', 'TOTP', 'E열(프로필번호)', 'F열(AdsPower ID)', 'G열(상태)'],
        colWidths: [30, 10, 15, 20, 30]
      });
      
      accounts.forEach(acc => {
        table.push([
          acc.email || '-',
          acc.totpSecret ? '✓' : '✗',
          acc.acc_id || '-',
          acc.profileId || '-',
          acc.status || '(비어있음)'
        ]);
      });
      
      console.log(table.toString());
      
      // 선택 옵션 제공
      const { selectionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectionMode',
          message: '검증할 계정 선택 방식:',
          choices: [
            { name: '📌 G열이 비어있는 계정만 (미처리)', value: 'empty' },
            { name: '✅ 전체 선택', value: 'all' },
            { name: '🔍 개별 선택', value: 'individual' },
            { name: '❌ 취소', value: 'cancel' }
          ],
          default: 'empty'
        }
      ]);
      
      if (selectionMode === 'cancel') {
        console.log(chalk.yellow('\n작업이 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      let selectedAccounts = [];
      
      switch (selectionMode) {
        case 'empty':
          selectedAccounts = emptyStatusAccounts;
          if (selectedAccounts.length === 0) {
            console.log(chalk.yellow('\n⚠️ G열이 비어있는 계정이 없습니다.'));
            await this.waitForEnter();
            return;
          }
          break;
          
        case 'all':
          selectedAccounts = accounts;
          break;
          
        case 'individual':
          // 개별 선택 (G열 비어있는 계정 기본 선택)
          const choices = accounts.map(acc => {
            const isEmpty = !acc.status || acc.status === '';
            return {
              name: `${acc.email} - ${acc.status || '(비어있음)'}`,
              value: acc,
              checked: isEmpty // G열이 비어있으면 기본 선택
            };
          });
          
          console.log(chalk.blue('\n💡 팁: G열이 비어있는 계정이 기본 선택되어 있습니다.'));
          console.log(chalk.gray('   Space키로 선택/해제, Enter키로 진행\n'));
          
          const { selected } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selected',
              message: '검증할 계정 선택:',
              choices: choices,
              pageSize: 15
            }
          ]);
          
          selectedAccounts = selected;
          break;
      }
      
      if (selectedAccounts.length === 0) {
        console.log(chalk.yellow('\n선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }
      
      // 사용자 확인
      console.log(chalk.cyan(`\n🎯 ${selectedAccounts.length}개 계정을 검증합니다.\n`));
      
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: '가족요금제 자동 검증을 시작하시겠습니까?',
          default: true
        }
      ]);
      
      if (!confirm) {
        console.log(chalk.yellow('\n작업이 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      console.log(chalk.cyan('\n🚀 자동 검증 시작...\n'));
      
      const result = await enhancedFamilyPlanCheckUseCase.execute({
        selectedAccounts: selectedAccounts
      });
      
      if (result.success) {
        console.log(chalk.green('\n✅ 가족요금제 자동 검증 완료'));
        console.log(chalk.cyan('\n📊 최종 결과:'));
        console.log(chalk.green(`  • 프로필 유지 (가족요금제 활성): ${result.kept || 0}개`));
        console.log(chalk.yellow(`  • 프로필 삭제 (가족요금제 없음): ${result.deleted || 0}개`));
        console.log(chalk.white(`  • 전체 처리: ${result.processed || 0}개`));
        
        // 상세 결과 표시 옵션
        if (result.results && result.results.length > 0) {
          const { showDetails } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'showDetails',
              message: '상세 결과를 보시겠습니까?',
              default: false
            }
          ]);
          
          if (showDetails) {
            console.log(chalk.cyan('\n📋 상세 결과:'));
            result.results.forEach((r, idx) => {
              const icon = r.hasFamilyPlan ? '✅' : 
                          r.status === 'ERROR' ? '❌' : '⚠️';
              const action = r.hasFamilyPlan ? 'KEPT' : 'DELETED';
              console.log(`  ${idx + 1}. ${icon} ${r.email} - ${action}`);
              if (r.error) {
                console.log(chalk.red(`     오류: ${r.error}`));
              }
            });
          }
        }
      } else {
        console.log(chalk.yellow('\n⚠️ 검증이 완료되지 않았습니다.'));
        if (result.message) {
          console.log(chalk.gray(`  사유: ${result.message}`));
        }
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 자동 검증 실패: ${error.message}`));
      this.logger.error('Enhanced family plan check failed', error);
    }
    
    await this.waitForEnter();
  }

  /**
   * 가족요금제 기존 계정 확인 (IP 전환)
   */
  async checkExistingFamilyPlan() {
    console.log(chalk.cyan.bold('\n🏠 가족요금제 기존 계정 확인 (IP 전환)\n'));
    console.log(chalk.yellow('📍 대상: Google Sheets "가족요금제기존" 탭'));
    console.log(chalk.gray('✨ 한국 IP로 로그인 확인 → 미국 IP로 가족 요금제 확인'));
    console.log(chalk.gray('─'.repeat(60)));
    
    try {
      // ExistingFamilyPlanCheckUseCase 사용
      const existingFamilyPlanCheckUseCase = this.container.resolve('existingFamilyPlanCheckUseCase');
      
      // Google Sheets에서 계정 목록 가져오기
      this.spinner = ora('가족요금제기존 계정 목록 조회 중...').start();
      
      const accounts = await existingFamilyPlanCheckUseCase.loadExistingFamilyPlanAccounts();
      this.spinner.stop();
      
      if (!accounts || accounts.length === 0) {
        console.log(chalk.yellow('\n⚠️ 가족요금제기존 탭에 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }
      
      // 상태별 계정 분류
      const emptyStatusAccounts = accounts.filter(acc => !acc.status || acc.status === '');
      const checkedAccounts = accounts.filter(acc => acc.status && acc.status !== '');
      
      console.log(chalk.cyan(`\n📋 전체 계정: ${accounts.length}개`));
      console.log(chalk.green(`   • 미처리 (E열 비어있음): ${emptyStatusAccounts.length}개`));
      console.log(chalk.gray(`   • 처리됨 (E열 값 있음): ${checkedAccounts.length}개`));
      console.log();
      
      // 계정 목록 테이블 표시
      const Table = require('cli-table3');
      const table = new Table({
        head: ['이메일', 'AdsPower ID', '현재 상태 (E열)'],
        colWidths: [35, 20, 30]
      });
      
      accounts.slice(0, 20).forEach(acc => {
        table.push([
          acc.email || '-',
          acc.adsPowerId ? acc.adsPowerId.substring(0, 18) : '❌ 없음',
          acc.status || '(비어있음)'
        ]);
      });
      
      if (accounts.length > 20) {
        table.push([chalk.gray('...'), chalk.gray(`+${accounts.length - 20}개 더`), chalk.gray('...')]);
      }
      
      console.log(table.toString());
      
      // 선택 옵션 제공
      const { selectionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectionMode',
          message: '검증할 계정 선택 방식:',
          choices: [
            { name: '📌 E열이 비어있는 계정만 (미처리)', value: 'empty' },
            { name: '✅ 전체 선택', value: 'all' },
            { name: '🔍 개별 선택', value: 'individual' },
            { name: '❌ 취소', value: 'cancel' }
          ],
          default: 'empty'
        }
      ]);
      
      if (selectionMode === 'cancel') {
        console.log(chalk.yellow('\n작업이 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      let selectedAccounts = [];
      
      switch (selectionMode) {
        case 'empty':
          selectedAccounts = emptyStatusAccounts;
          if (selectedAccounts.length === 0) {
            console.log(chalk.yellow('\n⚠️ E열이 비어있는 계정이 없습니다.'));
            await this.waitForEnter();
            return;
          }
          break;
          
        case 'all':
          selectedAccounts = accounts;
          break;
          
        case 'individual':
          const choices = accounts.map(acc => ({
            name: `${acc.email} - ${acc.status || '미확인'}`,
            value: acc,
            checked: !acc.status
          }));
          
          const { selected } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'selected',
              message: '검증할 계정 선택:',
              choices: choices,
              pageSize: 15
            }
          ]);
          
          selectedAccounts = selected;
          break;
      }
      
      if (selectedAccounts.length === 0) {
        console.log(chalk.yellow('\n선택된 계정이 없습니다.'));
        await this.waitForEnter();
        return;
      }
      
      // 사용자 확인
      console.log(chalk.cyan(`\n🎯 ${selectedAccounts.length}개 계정을 검증합니다.\n`));
      
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'IP 전환을 통한 가족 요금제 확인을 시작하시겠습니까?',
          default: true
        }
      ]);
      
      if (!confirm) {
        console.log(chalk.yellow('\n작업이 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }
      
      console.log(chalk.cyan('\n🚀 자동 검증 시작...\n'));
      
      const results = {
        success: [],
        failed: [],
        skipped: []
      };
      
      for (const account of selectedAccounts) {
        console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
        console.log(chalk.cyan(`🎯 처리 시작: ${account.email}`));
        
        // AdsPower ID가 없는 경우 건너뛰기
        if (!account.adsPowerId) {
          console.log(chalk.yellow(`  ⚠ AdsPower ID 없음 - 건너뛰기`));
          results.skipped.push(account);
          
          // Google Sheets에 업데이트
          await existingFamilyPlanCheckUseCase.updateStatus(
            account.email,
            'AdsPower ID 없음'
          );
          continue;
        }
        
        try {
          const result = await existingFamilyPlanCheckUseCase.execute(
            account.adsPowerId,
            {
              email: account.email,
              rowIndex: account.rowIndex
            }
          );
          
          if (result.success) {
            console.log(chalk.green(`  ✔ 검증 성공`));
            console.log(chalk.gray(`    상태: ${result.statusText}`));
            if (result.hasFamilyPlan) {
              console.log(chalk.green(`    가족 요금제: 활성`));
            } else {
              console.log(chalk.yellow(`    가족 요금제: 비활성`));
            }
            results.success.push(account);
          } else {
            console.log(chalk.red(`  ❌ 검증 실패: ${result.error}`));
            results.failed.push(account);
          }
          
        } catch (error) {
          console.log(chalk.red(`  ❌ 오류: ${error.message}`));
          results.failed.push(account);
          
          // Google Sheets에 오류 기록
          await existingFamilyPlanCheckUseCase.updateStatus(
            account.email,
            `오류: ${error.message}`
          );
        }
        
        // 진행 상황 표시
        const processed = results.success.length + results.failed.length + results.skipped.length;
        console.log(chalk.gray(`\n진행: ${processed}/${selectedAccounts.length}`));
      }
      
      // 최종 결과 표시
      console.log(chalk.blue(`\n${'='.repeat(60)}\n`));
      console.log(chalk.cyan.bold('📈 최종 결과:\n'));
      console.log(chalk.green(`  • 성공: ${results.success.length}개`));
      console.log(chalk.red(`  • 실패: ${results.failed.length}개`));
      console.log(chalk.yellow(`  • 건너뜀: ${results.skipped.length}개`));
      console.log(chalk.white(`  • 전체: ${selectedAccounts.length}개`));
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 가족 요금제 확인 실패: ${error.message}`));
      this.logger.error('Existing family plan check failed', error);
    }
    
    await this.waitForEnter();
  }

  /**
   * 프로필 삭제 (최적화된 버전)
   */
  async deleteProfiles() {
    console.log(chalk.red.bold('\n🗑️ 최적화된 프로필 삭제\n'));
    console.log(chalk.yellow('⚠️ Google Sheets "삭제" 탭에서 프로필 목록을 읽어 삭제합니다.'));
    console.log(chalk.cyan('⚡ 병렬 처리 & 배치 업데이트로 5-10배 빠른 속도'));
    console.log(chalk.gray('='.repeat(60)));
    
    try {
      // 최적화된 DeleteProfileUseCase 실행
      const deleteProfileUseCase = this.container.resolve('deleteProfileUseCase');
      
      // 삭제 작업 실행
      const stats = await deleteProfileUseCase.execute();
      
      // 결과 요약 (UseCase에서 이미 출력하므로 추가 메시지만)
      if (stats && stats.success > 0) {
        console.log(chalk.green('\n✅ 삭제 작업이 완료되었습니다.'));
        if (stats.duration) {
          console.log(chalk.gray(`처리 속도: ${(stats.total / stats.duration).toFixed(1)}개/초`));
        }
      } else if (stats && stats.total === 0) {
        console.log(chalk.yellow('\n삭제할 프로필이 없었습니다.'));
      } else if (stats && stats.cancelled) {
        console.log(chalk.yellow('\n삭제 작업이 취소되었습니다.'));
      }
      
    } catch (error) {
      console.error(chalk.red(`\n❌ 삭제 작업 실패: ${error.message}`));
      this.logger.error('프로필 삭제 실패', error);
    }
    
    await this.waitForEnter();
  }

  /**
   * 백업카드 변경 워크플로우
   */
  async backupCardChange() {
    console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan('   💳 백업카드 변경 (Backup Card Change)'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    try {
      // UseCase 및 Repository resolve
      const backupCardChangeUseCase = this.container.resolve('backupCardChangeUseCase');
      const backupCardRepository = this.container.resolve('backupCardRepository');

      // 대상 조회 및 필터링 선택
      const { filterOption } = await inquirer.prompt([
        {
          type: 'list',
          name: 'filterOption',
          message: '작업 대상 선택 방식을 선택하세요:',
          choices: [
            { name: '📋 기본 필터링 (대기중 또는 빈 상태만)', value: 'default' },
            { name: '📊 전체 선택 (모든 프로필)', value: 'all' },
            { name: '✏️  일부 선택 (특정 프로필 지정)', value: 'custom' }
          ],
          default: 'default'
        }
      ]);

      let targets = [];

      // 필터 옵션에 따라 대상 조회
      this.spinner = ora('대상 프로필 조회 중...').start();

      if (filterOption === 'default') {
        targets = await backupCardRepository.getBackupCardChangeTargets({ status: 'default' });
        this.spinner.succeed(`📋 대기중 프로필 ${targets.length}개 선택됨`);
      } else if (filterOption === 'all') {
        targets = await backupCardRepository.getBackupCardChangeTargets({ status: 'all' });
        this.spinner.succeed(`📋 전체 프로필 ${targets.length}개 선택됨`);
      } else if (filterOption === 'custom') {
        this.spinner.stop();
        const { selection } = await inquirer.prompt([
          {
            type: 'input',
            name: 'selection',
            message: '이메일 주소를 쉼표로 구분하여 입력하세요 (예: user1@gmail.com, user2@gmail.com):',
            validate: (input) => input.trim().length > 0 || '최소 1개 이메일 입력 필요'
          }
        ]);

        const emails = selection.split(',').map(s => s.trim());
        this.spinner = ora('선택된 프로필 조회 중...').start();
        targets = await backupCardRepository.getBackupCardChangeTargets({
          status: 'custom',
          emails
        });
        this.spinner.succeed(`📋 선택된 프로필 ${targets.length}개`);
      }

      if (targets.length === 0) {
        console.log(chalk.yellow('\n⚠️ 처리할 대상이 없습니다.'));
        await this.waitForEnter();
        return;
      }

      // 대상 목록 테이블 출력
      console.log(chalk.cyan('\n📋 백업카드 변경 대상 목록:\n'));
      const table = new Table({
        head: ['#', 'Email', '카드이름', '주소이름', '상태'],
        colWidths: [5, 40, 20, 20, 15]
      });

      targets.forEach((target, index) => {
        table.push([
          index + 1,
          target.email,
          target.cardName || '(랜덤)',
          target.addressName || '(랜덤)',
          target.status || '-'
        ]);
      });

      console.log(table.toString());

      // 실행 확인
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `총 ${targets.length}개 계정의 백업카드를 변경하시겠습니까?`,
          default: true
        }
      ]);

      if (!confirm) {
        console.log(chalk.yellow('\n⚠️ 작업이 취소되었습니다.'));
        await this.waitForEnter();
        return;
      }

      // 처리 시작
      console.log(chalk.cyan('\n🚀 백업카드 변경 시작...\n'));

      let successCount = 0;
      let failCount = 0;
      const results = [];

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        console.log(chalk.cyan(`\n[${i + 1}/${targets.length}] ${target.email} 처리 중...`));

        try {
          const result = await backupCardChangeUseCase.execute(target.email, {
            cardName: target.cardName, // 미리 지정된 경우
            addressName: target.addressName, // 미리 지정된 경우
            debugMode: this.config.debugMode
          });

          if (result.success) {
            successCount++;
            console.log(chalk.green(`✅ 성공: ${target.email}`));
            console.log(chalk.gray(`   카드: ${result.card}, 주소: ${result.address}`));
            console.log(chalk.gray(`   시나리오: ${result.scenario}, IP: ${result.ipAddress}`));
            results.push({ email: target.email, success: true, result });
          } else {
            failCount++;
            console.log(chalk.red(`❌ 실패: ${target.email}`));
            results.push({ email: target.email, success: false, error: 'Unknown error' });
          }
        } catch (error) {
          failCount++;
          console.log(chalk.red(`❌ 실패: ${target.email}`));
          console.log(chalk.red(`   에러: ${error.message}`));
          results.push({ email: target.email, success: false, error: error.message });
        }

        // 다음 계정 전 대기 (2초)
        if (i < targets.length - 1) {
          console.log(chalk.gray('\n⏳ 2초 대기 후 다음 계정 처리...'));
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // 최종 결과 출력
      console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.cyan('   📊 백업카드 변경 완료'));
      console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
      console.log(chalk.green(`✅ 성공: ${successCount}개`));
      console.log(chalk.red(`❌ 실패: ${failCount}개`));
      console.log(chalk.cyan(`📊 총 처리: ${targets.length}개\n`));

      // 실패한 계정 목록
      if (failCount > 0) {
        console.log(chalk.red('❌ 실패한 계정 목록:\n'));
        const failedTable = new Table({
          head: ['Email', 'Error'],
          colWidths: [40, 60]
        });

        results
          .filter(r => !r.success)
          .forEach(r => {
            failedTable.push([r.email, r.error || 'Unknown error']);
          });

        console.log(failedTable.toString());
      }

      await this.waitForEnter();

    } catch (error) {
      if (this.spinner) {
        this.spinner.fail('백업카드 변경 실패');
      }
      console.error(chalk.red('\n❌ 백업카드 변경 오류:'), error.message);
      console.error(chalk.gray(error.stack));
      await this.waitForEnter();
    }
  }

  /**
   * 로그/스크린샷 정리 (통합)
   * - 권장 기간: 디렉토리별 권장 보존 기간 적용
   * - 사용자 지정: 0일(모두 삭제) ~ N일(N일 이전 삭제)
   */
  async logCleanup() {
    try {
      const LogCleanupUseCase = require('../../application/usecases/LogCleanupUseCase');
      const logCleanupUseCase = new LogCleanupUseCase({ logger: console });

      console.log(chalk.cyan.bold('\n🧹 로그 및 스크린샷 정리'));
      console.log(chalk.gray('─'.repeat(50)));

      // 현재 상태 미리보기
      await logCleanupUseCase.preview();

      // 정리 모드 선택
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: '정리 방식을 선택하세요:',
          choices: [
            {
              name: '📋 권장 기간으로 정리 (디렉토리별 최적화)',
              value: 'recommended'
            },
            {
              name: '⚙️  사용자 지정 기간',
              value: 'custom'
            },
            {
              name: '🔍 미리보기만 (삭제 없음)',
              value: 'preview'
            },
            {
              name: '❌ 취소',
              value: 'cancel'
            }
          ]
        }
      ]);

      if (mode === 'cancel') {
        console.log(chalk.gray('\n취소되었습니다.'));
        await this.waitForEnter();
        return;
      }

      if (mode === 'preview') {
        // 권장 기간 정보 표시
        console.log(chalk.cyan('\n📋 디렉토리별 권장 보존 기간:'));
        console.log(chalk.gray('─'.repeat(50)));

        const retentionInfo = logCleanupUseCase.getRecommendedRetentionInfo();
        for (const info of retentionInfo) {
          console.log(chalk.white(`  ${info.path.padEnd(25)} → ${chalk.yellow(info.recommendedText)}`));
        }
        console.log(chalk.gray('─'.repeat(50)));

        await this.waitForEnter();
        return;
      }

      let days = 0;

      if (mode === 'custom') {
        // 사용자 지정 기간 입력
        const { customDays } = await inquirer.prompt([
          {
            type: 'list',
            name: 'customDays',
            message: '보존 기간을 선택하세요:',
            choices: [
              { name: '🗑️  0일 (모든 파일 삭제)', value: 0 },
              { name: '📅 1일 (24시간 이내 유지)', value: 1 },
              { name: '📅 2일 (48시간 이내 유지)', value: 2 },
              { name: '📅 3일', value: 3 },
              { name: '📅 7일 (1주일)', value: 7 },
              { name: '📅 14일 (2주일)', value: 14 },
              { name: '📅 30일 (1개월)', value: 30 },
              { name: '✏️  직접 입력', value: 'input' }
            ]
          }
        ]);

        if (customDays === 'input') {
          const { inputDays } = await inquirer.prompt([
            {
              type: 'input',
              name: 'inputDays',
              message: '보존할 일수를 입력하세요 (0 = 모두 삭제):',
              validate: (input) => {
                const num = parseInt(input, 10);
                if (isNaN(num) || num < 0) {
                  return '0 이상의 숫자를 입력하세요.';
                }
                return true;
              }
            }
          ]);
          days = parseInt(inputDays, 10);
        } else {
          days = customDays;
        }
      }

      // 삭제 확인
      const modeText = mode === 'recommended'
        ? '권장 보존 기간 이전의 파일'
        : days === 0
          ? '모든 파일'
          : `${days}일 이전의 파일`;

      console.log(chalk.yellow(`\n⚠️  ${modeText}을(를) 삭제합니다.`));

      // 0일(모두 삭제)인 경우 2단계 확인
      if (mode === 'custom' && days === 0) {
        const { confirm1 } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm1',
            message: chalk.red.bold('정말로 모든 파일을 삭제하시겠습니까?'),
            default: false
          }
        ]);

        if (!confirm1) {
          console.log(chalk.gray('\n취소되었습니다.'));
          await this.waitForEnter();
          return;
        }

        const { confirm2 } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm2',
            message: chalk.red.bold('최종 확인: 이 작업은 되돌릴 수 없습니다!'),
            default: false
          }
        ]);

        if (!confirm2) {
          console.log(chalk.gray('\n취소되었습니다.'));
          await this.waitForEnter();
          return;
        }
      } else {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: '계속 진행하시겠습니까?',
            default: true
          }
        ]);

        if (!confirm) {
          console.log(chalk.gray('\n취소되었습니다.'));
          await this.waitForEnter();
          return;
        }
      }

      // 정리 실행
      const result = await logCleanupUseCase.execute({
        mode: mode === 'recommended' ? 'recommended' : 'custom',
        days: days,
        dryRun: false
      });

      if (result.errors.length > 0) {
        console.log(chalk.yellow('\n⚠️  일부 오류가 발생했습니다:'));
        for (const err of result.errors.slice(0, 5)) {
          console.log(chalk.red(`  - ${err.path}: ${err.error}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.gray(`  ... 외 ${result.errors.length - 5}개`));
        }
      }

      await this.waitForEnter();

    } catch (error) {
      console.error(chalk.red('\n❌ 파일 정리 오류:'), error.message);
      await this.waitForEnter();
    }
  }

  /**
   * 정리
   */
  async cleanup() {
    try {
      // 워크플로우 취소 플래그 설정
      this.isWorkflowCancelled = true;

      // 스피너 정리
      if (this.spinner) {
        this.spinner.stop();
      }

      // 현재 워크플로우 종료
      if (this.currentWorkflow) {
        console.log(chalk.yellow('\n⚠️ 워크플로우 취소 중...'));
        this.currentWorkflow = null;
      }

      // AdsPower 어댑터 정리
      if (this.container) {
        const adsPowerAdapter = this.container.resolve('adsPowerAdapter');
        await adsPowerAdapter.cleanup();
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

module.exports = EnterpriseCLI;