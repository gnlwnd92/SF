/**
 * FamilyPlanCheckUseCaseV2 - YouTube Family Plan 자격 확인 자동화 (개선판)
 * 
 * 주요 개선사항:
 * - Sunbrowser 전용 프로필 생성
 * - TOTP 2FA 지원
 * - 복구 이메일 처리
 * - 향상된 에러 처리
 */

const chalk = require('chalk');
const ora = require('ora');
const speakeasy = require('speakeasy');

class FamilyPlanCheckUseCaseV2 {
  constructor({
    sunbrowserAdapter,  // SunbrowserAdapter 사용
    browserController,
    familyPlanSheetRepository,
    proxyManager,
    familyPlanDetector,
    googleLoginHelper,
    logger,
    config
  }) {
    this.sunbrowser = sunbrowserAdapter;
    this.browser = browserController;
    this.sheets = familyPlanSheetRepository;
    this.proxyManager = proxyManager;
    this.detector = familyPlanDetector;
    this.googleLogin = googleLoginHelper;
    this.logger = logger;
    this.config = config;
  }

  /**
   * 메인 실행 메서드
   */
  async execute(options = {}) {
    const spinner = ora('가족요금제 체크 시작').start();
    const { batchMode = false, maxAccounts = null, testMode = false } = options;
    
    try {
      // 1. 초기화
      spinner.text = '시스템 초기화 중...';
      await this.initialize();
      
      // 2. 계정 정보 로드
      spinner.text = '계정 정보 로드 중...';
      const accounts = await this.loadAccounts(maxAccounts);
      
      if (accounts.length === 0) {
        spinner.warn('처리할 계정이 없습니다');
        return { success: false, message: 'No accounts to process' };
      }
      
      console.log(chalk.cyan.bold(`\n📋 ${accounts.length}개 계정 처리 시작\n`));
      
      // 3. 계정 처리 (배치 또는 순차)
      const results = batchMode ? 
        await this.processBatch(accounts, spinner) : 
        await this.processSequential(accounts, spinner);
      
      spinner.succeed('가족요금제 체크 완료');
      
      // 4. 결과 요약 및 리포트
      await this.generateReport(results);
      
      return {
        success: true,
        results,
        processed: results.length,
        summary: this.getSummary(results)
      };
      
    } catch (error) {
      spinner.fail(`오류 발생: ${error.message}`);
      this.logger.error('FamilyPlanCheckV2 failed', error);
      throw error;
    }
  }

  /**
   * 시스템 초기화
   */
  async initialize() {
    // Google Sheets 초기화
    await this.sheets.initialize();
    
    // 프록시 매니저 초기화
    const proxyStatus = this.proxyManager.getPoolStatus();
    console.log(chalk.gray('프록시 풀 상태:'));
    console.log(chalk.gray(`  - 한국: ${proxyStatus.kr.total}개 (사용 가능: ${proxyStatus.kr.available}개)`));
    console.log(chalk.gray(`  - 파키스탄: ${proxyStatus.pk.total}개 (사용 가능: ${proxyStatus.pk.available}개)`));
  }

  /**
   * 계정 정보 로드
   */
  async loadAccounts(limit = null) {
    const allAccounts = await this.sheets.getAllAccounts();
    
    // 미처리 계정만 필터링 (상태가 비어있거나 ERROR인 경우)
    const pendingAccounts = allAccounts.filter(acc => 
      !acc.status || 
      acc.status.includes('ERROR') || 
      acc.status.includes('RETRY')
    );
    
    // 제한이 있으면 적용
    const accounts = limit ? pendingAccounts.slice(0, limit) : pendingAccounts;
    
    console.log(chalk.gray(`전체: ${allAccounts.length}개, 미처리: ${pendingAccounts.length}개, 처리 예정: ${accounts.length}개`));
    
    return accounts;
  }

  /**
   * 순차 처리
   */
  async processSequential(accounts, spinner) {
    const results = [];
    
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const progress = `[${i + 1}/${accounts.length}]`;
      
      spinner.text = `${progress} ${account.email} 처리 중...`;
      
      try {
        const result = await this.processAccount(account);
        results.push(result);
        
        // 실시간 Google Sheets 업데이트
        await this.updateAccountStatus(account, result);
        
        console.log(chalk.green(`${progress} ✅ ${account.email}: ${result.status}`));
        
      } catch (error) {
        const errorResult = {
          email: account.email,
          status: 'ERROR',
          reason: error.message,
          timestamp: new Date().toISOString()
        };
        
        results.push(errorResult);
        await this.updateAccountStatus(account, errorResult);
        
        console.log(chalk.red(`${progress} ❌ ${account.email}: ${error.message}`));
      }
      
      // Rate limiting
      if (i < accounts.length - 1) {
        await this.delay(3000);
      }
    }
    
    return results;
  }

  /**
   * 배치 처리 (병렬)
   */
  async processBatch(accounts, spinner, batchSize = 5) {
    const results = [];
    
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, Math.min(i + batchSize, accounts.length));
      spinner.text = `배치 처리 중... (${i + 1}-${i + batch.length}/${accounts.length})`;
      
      const batchResults = await Promise.all(
        batch.map(account => this.processAccount(account).catch(error => ({
          email: account.email,
          status: 'ERROR',
          reason: error.message
        })))
      );
      
      // 결과 저장 및 업데이트
      for (let j = 0; j < batch.length; j++) {
        results.push(batchResults[j]);
        await this.updateAccountStatus(batch[j], batchResults[j]);
      }
      
      // 배치 간 지연
      if (i + batchSize < accounts.length) {
        await this.delay(5000);
      }
    }
    
    return results;
  }

  /**
   * 개별 계정 처리
   */
  async processAccount(account) {
    let browser = null;
    let profileInfo = null;
    
    try {
      console.log(chalk.cyan(`\n🔄 ${account.email} 처리 시작`));
      
      // 1. Sunbrowser 프로필 생성/확인
      profileInfo = await this.createOrGetProfile(account);
      
      // 2. 한국 프록시로 로그인
      await this.performLoginWithKoreanProxy(profileInfo.profileId, account);
      
      // 3. 파키스탄 프록시로 Family Plan 체크
      const checkResult = await this.checkFamilyPlanWithPakistanProxy(profileInfo.profileId, account);
      
      return {
        email: account.email,
        profileId: profileInfo.profileId,
        accId: profileInfo.accId,
        ...checkResult,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Account processing failed: ${account.email}`, error);
      throw error;
      
    } finally {
      // 브라우저 정리
      if (browser) {
        try {
          await this.sunbrowser.closeBrowser(profileInfo.profileId);
        } catch (e) {
          // 무시
        }
      }
    }
  }

  /**
   * 프로필 생성 또는 가져오기
   */
  async createOrGetProfile(account) {
    // 기존 프로필 확인
    if (account.profileId) {
      console.log(chalk.gray(`기존 프로필 사용: ${account.profileId}`));
      return {
        profileId: account.profileId,
        accId: account.accId || 'default',
        isNew: false
      };
    }
    
    // 새 프로필 생성
    console.log(chalk.yellow('📱 새 Sunbrowser 프로필 생성 중...'));
    const result = await this.sunbrowser.createFamilyPlanProfile(account);
    
    if (!result.success) {
      throw new Error(`프로필 생성 실패: ${result.message}`);
    }
    
    // Google Sheets에 ID 저장
    await this.sheets.updateAdsPowerIds(
      account.rowNumber,
      result.accId,
      result.profileId
    );
    
    return {
      profileId: result.profileId,
      accId: result.accId,
      isNew: true
    };
  }

  /**
   * 한국 프록시로 로그인
   */
  async performLoginWithKoreanProxy(profileId, account) {
    console.log(chalk.cyan('🇰🇷 한국 프록시로 Google 로그인...'));
    
    // 1. 한국 프록시 설정
    const krProxy = this.proxyManager.getAvailableProxy('kr');
    await this.sunbrowser.updateProfileProxy(profileId, krProxy);
    
    // 2. 브라우저 실행
    const launchResult = await this.sunbrowser.launchBrowser(profileId);
    if (!launchResult.success) {
      throw new Error('브라우저 실행 실패');
    }
    
    // 3. Puppeteer 연결
    await this.browser.connect(launchResult.wsEndpoint);
    const page = await this.browser.getPage();
    
    try {
      // 4. Google 로그인 수행
      await this.performEnhancedGoogleLogin(page, account);
      
      // 5. 로그인 성공 확인
      await page.goto('https://myaccount.google.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      const isLoggedIn = await this.verifyLogin(page);
      if (!isLoggedIn) {
        throw new Error('로그인 확인 실패');
      }
      
      console.log(chalk.green('✅ Google 로그인 성공'));
      
    } finally {
      // 6. 브라우저 종료
      await this.sunbrowser.closeBrowser(profileId);
      await this.delay(3000); // 프록시 전환 전 대기
    }
  }

  /**
   * 향상된 Google 로그인 (복구 이메일, TOTP 지원)
   */
  async performEnhancedGoogleLogin(page, account) {
    // Google 로그인 페이지
    await page.goto('https://accounts.google.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 이메일 입력
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', account.email, { delay: 100 });
    await page.keyboard.press('Enter');
    
    await this.delay(3000);
    
    // 비밀번호 입력
    const passwordSelector = await page.waitForSelector('input[type="password"]', { 
      timeout: 10000,
      visible: true 
    });
    
    if (passwordSelector) {
      await page.type('input[type="password"]', account.password, { delay: 100 });
      await page.keyboard.press('Enter');
      await this.delay(3000);
    }
    
    // 추가 인증 처리
    await this.handleAuthChallenges(page, account);
  }

  /**
   * 인증 챌린지 처리
   */
  async handleAuthChallenges(page, account) {
    // 복구 이메일 확인
    const recoveryEmailPrompt = await page.$('[data-challengetype="12"]');
    if (recoveryEmailPrompt && account.recoveryEmail) {
      console.log(chalk.yellow('📧 복구 이메일 입력...'));
      await recoveryEmailPrompt.click();
      await this.delay(2000);
      
      const emailInput = await page.waitForSelector('#knowledge-preregistered-email-response', {
        timeout: 5000
      });
      
      if (emailInput) {
        await page.type('#knowledge-preregistered-email-response', account.recoveryEmail, {
          delay: 100
        });
        await page.keyboard.press('Enter');
        await this.delay(3000);
      }
    }
    
    // TOTP 2FA 처리
    const totpInput = await page.$('#totpPin');
    if (totpInput && account.totpSecret) {
      console.log(chalk.yellow('🔐 TOTP 2FA 코드 생성...'));
      
      const token = speakeasy.totp({
        secret: account.totpSecret,
        encoding: 'base32',
        window: 1
      });
      
      await page.type('#totpPin', token, { delay: 50 });
      await page.keyboard.press('Enter');
      await this.delay(3000);
    }
    
    // "예, 저입니다" 확인
    const confirmButton = await page.$('button:contains("예")');
    if (confirmButton) {
      await confirmButton.click();
      await this.delay(2000);
    }
  }

  /**
   * 로그인 확인
   */
  async verifyLogin(page) {
    try {
      // 쿠키 확인
      const cookies = await page.cookies();
      const hasAuthCookie = cookies.some(cookie => 
        cookie.name === 'SID' || 
        cookie.name === 'HSID' || 
        cookie.name === 'SSID'
      );
      
      // 프로필 이미지 확인
      const profileImage = await page.$('img[aria-label*="Google Account"]');
      
      return hasAuthCookie || profileImage !== null;
      
    } catch (error) {
      return false;
    }
  }

  /**
   * 파키스탄 프록시로 Family Plan 체크
   */
  async checkFamilyPlanWithPakistanProxy(profileId, account) {
    console.log(chalk.cyan('🇵🇰 파키스탄 프록시로 Family Plan 체크...'));
    
    // 1. 파키스탄 프록시 설정
    const pkProxy = this.proxyManager.getAvailableProxy('pk');
    await this.sunbrowser.updateProfileProxy(profileId, pkProxy);
    
    // 2. 브라우저 재실행
    const launchResult = await this.sunbrowser.launchBrowser(profileId);
    if (!launchResult.success) {
      throw new Error('브라우저 재실행 실패');
    }
    
    // 3. Puppeteer 연결
    await this.browser.connect(launchResult.wsEndpoint);
    const page = await this.browser.getPage();
    
    try {
      // 4. YouTube Music Family 페이지 접속
      await page.goto('https://music.youtube.com/youtube_premium/family', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await this.delay(5000);
      
      // 5. Family Plan 상태 감지
      const status = await this.detector.checkFamilyPlanStatus(page);
      
      // 6. 증거 수집
      const screenshotPath = await this.captureEvidence(page, account.email);
      
      console.log(chalk.green(`✅ Family Plan 체크 완료: ${status.eligible ? 'ELIGIBLE' : status.reason}`));
      
      return {
        status: status.eligible ? 'ELIGIBLE' : status.reason,
        eligible: status.eligible,
        price: status.price,
        currency: status.currency,
        details: status,
        screenshot: screenshotPath
      };
      
    } finally {
      // 7. 브라우저 종료
      await this.sunbrowser.closeBrowser(profileId);
    }
  }

  /**
   * 증거 수집 (스크린샷)
   */
  async captureEvidence(page, email) {
    const timestamp = Date.now();
    const emailPrefix = email.split('@')[0];
    const screenshotPath = `screenshots/family-plan-${emailPrefix}-${timestamp}.png`;
    
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });
    
    return screenshotPath;
  }

  /**
   * Google Sheets 상태 업데이트
   */
  async updateAccountStatus(account, result) {
    const timestamp = new Date().toLocaleString('ko-KR');
    let statusText = `[${timestamp}] ${result.status}`;
    
    // 상세 정보 추가
    if (result.eligible) {
      statusText += ` | ✅ 가입 가능`;
    }
    if (result.price && result.currency) {
      statusText += ` | ${result.currency} ${result.price}`;
    }
    if (result.reason) {
      statusText += ` | ${result.reason}`;
    }
    
    await this.sheets.updateAccountStatus(
      account.rowNumber,
      result.status,
      {
        price: result.price,
        currency: result.currency,
        message: result.reason || result.status
      }
    );
  }

  /**
   * 결과 요약
   */
  getSummary(results) {
    const summary = {
      total: results.length,
      eligible: results.filter(r => r.status === 'ELIGIBLE').length,
      ineligible: results.filter(r => r.status === 'INELIGIBLE' || r.status === 'REGION_BLOCKED').length,
      alreadyMember: results.filter(r => r.status === 'ALREADY_MEMBER').length,
      errors: results.filter(r => r.status === 'ERROR').length
    };
    
    summary.successRate = ((summary.eligible + summary.alreadyMember) / summary.total * 100).toFixed(2) + '%';
    
    return summary;
  }

  /**
   * 리포트 생성
   */
  async generateReport(results) {
    const summary = this.getSummary(results);
    const report = await this.sheets.generateReport();
    
    console.log(chalk.cyan.bold('\n' + '='.repeat(50)));
    console.log(chalk.cyan.bold('📊 Family Plan Check Report'));
    console.log(chalk.cyan.bold('='.repeat(50)));
    
    console.log(chalk.white(`\n전체 처리: ${summary.total}개`));
    console.log(chalk.green(`✅ 가입 가능: ${summary.eligible}개`));
    console.log(chalk.yellow(`⚠️ 이미 가입: ${summary.alreadyMember}개`));
    console.log(chalk.red(`❌ 가입 불가: ${summary.ineligible}개`));
    console.log(chalk.red(`❗ 오류: ${summary.errors}개`));
    console.log(chalk.cyan(`\n성공률: ${summary.successRate}`));
    
    console.log(chalk.cyan.bold('='.repeat(50) + '\n'));
    
    return report;
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FamilyPlanCheckUseCaseV2;