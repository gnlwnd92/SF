/**
 * ParallelFamilyPlanCheckUseCase - 병렬 Family Plan 체크
 * 
 * Day 9: 여러 계정을 동시에 체크하는 고성능 UseCase
 */

const chalk = require('chalk');

class ParallelFamilyPlanCheckUseCase {
  constructor({
    familyPlanWorkflowService,
    parallelBatchProcessor,
    familyPlanSheetRepository,
    sunbrowserAdapter,
    proxyManager,
    logger
  }) {
    this.workflowService = familyPlanWorkflowService;
    this.batchProcessor = parallelBatchProcessor;
    this.sheetsRepo = familyPlanSheetRepository;
    this.sunbrowser = sunbrowserAdapter;
    this.proxyManager = proxyManager;
    this.logger = logger;
    
    // 설정
    this.config = {
      maxConcurrency: 5,      // 최대 동시 실행 수
      retryAttempts: 3,       // 재시도 횟수
      retryDelay: 5000,       // 재시도 지연 (ms)
      batchSize: 10,          // 한 번에 처리할 최대 계정 수
      profileCooldown: 3000   // 프로필 간 대기 시간
    };
    
    // 처리 결과 추적
    this.processResults = [];
    
    // 이벤트 리스너 등록
    this.setupEventListeners();
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    if (!this.batchProcessor) return;
    
    // 작업 시작 알림
    this.batchProcessor.on('taskStart', ({ item, index }) => {
      console.log(chalk.cyan(`🚀 [${index + 1}] ${item.email} 체크 시작`));
    });
    
    // 작업 완료 알림
    this.batchProcessor.on('taskComplete', ({ item, index, result }) => {
      console.log(chalk.green(`✅ [${index + 1}] ${item.email} 체크 완료`));
    });
    
    // 작업 실패 알림
    this.batchProcessor.on('taskFailed', ({ item, index, error }) => {
      console.error(chalk.red(`❌ [${index + 1}] ${item.email} 체크 실패: ${error.message}`));
    });
  }

  /**
   * 메인 실행
   */
  async execute(options = {}) {
    console.log(chalk.cyan.bold('\n🚀 병렬 Family Plan 체크 시작\n'));
    
    try {
      // 1. Google Sheets 초기화 및 계정 로드
      const accounts = await this.loadAccounts(options);
      if (accounts.length === 0) {
        console.log(chalk.yellow('체크할 계정이 없습니다.'));
        return { success: false, message: '계정 없음' };
      }
      
      // 2. 배치 처리 설정
      this.configureBatchProcessor(options);
      
      // 3. 병렬 처리 실행
      const results = await this.processBatch(accounts);
      
      // 4. 최종 리포트 생성
      const report = await this.generateFinalReport(results);
      
      return {
        success: true,
        results,
        report
      };
      
    } catch (error) {
      this.logger.error('병렬 체크 실패', error);
      throw error;
    }
  }

  /**
   * 계정 로드
   */
  async loadAccounts(options) {
    console.log(chalk.gray('📋 Google Sheets에서 계정 로드 중...'));
    
    // Sheets 초기화
    await this.sheetsRepo.initialize();
    
    // 모든 계정 가져오기
    let accounts = await this.sheetsRepo.getAllAccounts();
    
    // 필터링 (필요시)
    if (options.filterUnchecked) {
      accounts = accounts.filter(acc => !acc.status || acc.status === '');
    }
    
    if (options.filterWithoutProfile) {
      accounts = accounts.filter(acc => !acc.profileId);
    }
    
    // 제한 (필요시)
    if (options.limit) {
      accounts = accounts.slice(0, options.limit);
    }
    
    console.log(chalk.green(`✅ ${accounts.length}개 계정 로드 완료\n`));
    
    return accounts;
  }

  /**
   * 배치 프로세서 설정
   */
  configureBatchProcessor(options) {
    if (options.maxConcurrency) {
      this.config.maxConcurrency = options.maxConcurrency;
    }
    
    if (options.retryAttempts) {
      this.config.retryAttempts = options.retryAttempts;
    }
    
    console.log(chalk.gray(`⚡ 동시 실행: ${this.config.maxConcurrency}개`));
    console.log(chalk.gray(`🔄 재시도: ${this.config.retryAttempts}회\n`));
  }

  /**
   * 배치 처리 실행
   */
  async processBatch(accounts) {
    // 처리 함수 정의
    const processorFunction = async (account, index) => {
      return this.processAccount(account, index);
    };
    
    // 병렬 처리 실행
    const result = await this.batchProcessor.processBatch(
      accounts,
      processorFunction
    );
    
    return result;
  }

  /**
   * 단일 계정 처리
   */
  async processAccount(account, index) {
    const startTime = Date.now();
    const results = {
      email: account.email,
      profileCreated: false,
      loginSuccess: false,
      proxySwitch: false,
      familyPlanStatus: null,
      sheetsUpdated: false,
      error: null
    };
    
    let browser = null;
    let profileId = account.profileId;
    
    try {
      // Step 1: 프로필 생성/확인
      if (!profileId) {
        const profileResult = await this.createProfile(account);
        if (profileResult.success) {
          profileId = profileResult.profileId;
          results.profileCreated = true;
          
          // Sheets 업데이트
          await this.sheetsRepo.updateAdsPowerIds(
            account.rowNumber,
            profileResult.accId,
            profileId
          );
        } else {
          throw new Error('프로필 생성 실패');
        }
      }
      
      // Step 2: 한국 프록시 설정
      await this.proxyManager.setProfileProxy(profileId, 'kr');
      
      // Step 3: 브라우저 실행 및 로그인
      const browserResult = await this.sunbrowser.openBrowser(profileId);
      if (browserResult.success) {
        browser = await this.sunbrowser.connectPuppeteer(browserResult.ws);
        const page = (await browser.pages())[0] || await browser.newPage();
        
        // Google 로그인 (간단화된 플로우)
        await page.goto('https://accounts.google.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        results.loginSuccess = true;
        
        // Step 4: 파키스탄 프록시로 전환
        await browser.close();
        browser = null;
        
        await this.proxyManager.setProfileProxy(profileId, 'pk');
        results.proxySwitch = true;
        
        // Step 5: YouTube Family Plan 체크
        const checkResult = await this.checkFamilyPlanStatus(profileId);
        results.familyPlanStatus = checkResult;
        
        // Step 6: Sheets 업데이트
        await this.updateSheets(account, checkResult);
        results.sheetsUpdated = true;
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(chalk.green(`✅ ${account.email} 처리 완료 (${duration}초)`));
      
      return results;
      
    } catch (error) {
      results.error = error.message;
      console.error(chalk.red(`❌ ${account.email} 처리 실패: ${error.message}`));
      throw error;
      
    } finally {
      // 브라우저 정리
      if (browser) {
        try {
          await browser.close();
        } catch (e) {
          // 무시
        }
      }
      
      // 지연 (다음 프로필을 위해)
      await new Promise(resolve => setTimeout(resolve, this.config.profileCooldown));
    }
  }

  /**
   * 프로필 생성
   */
  async createProfile(account) {
    return this.sunbrowser.createFamilyPlanProfile({
      email: account.email,
      password: account.password,
      recoveryEmail: account.recoveryEmail,
      totpSecret: account.totpSecret
    });
  }

  /**
   * Family Plan 상태 체크
   */
  async checkFamilyPlanStatus(profileId) {
    // 브라우저 재실행
    const browserResult = await this.sunbrowser.openBrowser(profileId);
    if (!browserResult.success) {
      throw new Error('브라우저 실행 실패');
    }
    
    const browser = await this.sunbrowser.connectPuppeteer(browserResult.ws);
    const page = (await browser.pages())[0] || await browser.newPage();
    
    try {
      // YouTube Family 페이지 이동
      await page.goto('https://www.youtube.com/premium/family', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // 페이지 내용 가져오기
      const content = await page.content();
      const text = await page.evaluate(() => document.body.innerText);
      
      // Family Plan 상태 감지
      const isEligible = /PKR|\u20a8|299|family/i.test(text);
      const hasPrice = /299/.test(text);
      const currency = /PKR|\u20a8/.test(text) ? 'PKR' : 'Unknown';
      
      return {
        isEligible,
        price: hasPrice ? '299' : null,
        currency,
        message: isEligible ? 'Family Plan available' : 'Not eligible'
      };
      
    } finally {
      await browser.close();
    }
  }

  /**
   * Sheets 업데이트
   */
  async updateSheets(account, status) {
    const statusText = status.isEligible ? 'ELIGIBLE' : 'INELIGIBLE';
    const details = {
      price: status.price,
      currency: status.currency,
      message: status.message,
      checkedAt: new Date().toISOString()
    };
    
    await this.sheetsRepo.updateAccountStatus(
      account.rowNumber,
      statusText,
      details
    );
  }

  /**
   * 최종 리포트 생성
   */
  async generateFinalReport(results) {
    const { stats, results: batchResults } = results;
    
    // 성공/실패 분류
    const successful = batchResults.filter(r => r.status === 'fulfilled');
    const failed = batchResults.filter(r => r.status === 'rejected');
    
    // Family Plan 상태 분석
    const eligible = successful.filter(r => 
      r.value?.familyPlanStatus?.isEligible
    ).length;
    
    const ineligible = successful.filter(r => 
      r.value?.familyPlanStatus && !r.value.familyPlanStatus.isEligible
    ).length;
    
    const report = {
      summary: {
        total: stats.total,
        completed: stats.completed,
        failed: stats.failed,
        successRate: ((stats.completed / stats.total) * 100).toFixed(1)
      },
      familyPlanStatus: {
        eligible,
        ineligible,
        unknown: stats.total - eligible - ineligible
      },
      performance: {
        totalTime: ((stats.endTime - stats.startTime) / 1000).toFixed(2),
        avgTimePerAccount: ((stats.endTime - stats.startTime) / 1000 / stats.total).toFixed(2)
      },
      details: {
        successful,
        failed
      }
    };
    
    // 콘솔 출력
    this.printReport(report);
    
    // Sheets 리포트 업데이트
    if (this.sheetsRepo.generateReport) {
      await this.sheetsRepo.generateReport();
    }
    
    return report;
  }

  /**
   * 리포트 출력
   */
  printReport(report) {
    console.log(chalk.cyan.bold('\n📊 Family Plan Check 최종 리포트\n'));
    
    console.log(chalk.yellow('📈 처리 결과:'));
    console.log(chalk.gray(`  전체: ${report.summary.total}개`));
    console.log(chalk.green(`  성공: ${report.summary.completed}개`));
    console.log(chalk.red(`  실패: ${report.summary.failed}개`));
    console.log(chalk.cyan(`  성공률: ${report.summary.successRate}%\n`));
    
    console.log(chalk.yellow('🏠 Family Plan 상태:'));
    console.log(chalk.green(`  ✅ 가입 가능: ${report.familyPlanStatus.eligible}개`));
    console.log(chalk.red(`  ❌ 가입 불가: ${report.familyPlanStatus.ineligible}개`));
    console.log(chalk.gray(`  ❓ 확인 필요: ${report.familyPlanStatus.unknown}개\n`));
    
    console.log(chalk.yellow('⚡ 성능:'));
    console.log(chalk.gray(`  총 소요시간: ${report.performance.totalTime}초`));
    console.log(chalk.gray(`  평균 처리시간: ${report.performance.avgTimePerAccount}초/계정\n`));
  }
}

module.exports = ParallelFamilyPlanCheckUseCase;