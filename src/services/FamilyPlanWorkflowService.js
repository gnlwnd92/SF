/**
 * FamilyPlanWorkflowService - 전체 Family Plan 체크 워크플로우 관리
 * 
 * 워크플로우:
 * 1. Google Sheets에서 계정 정보 로드
 * 2. Sunbrowser 프로필 생성/확인
 * 3. 한국 프록시로 Google 로그인
 * 4. 파키스탄 프록시로 전환
 * 5. YouTube Family Plan 체크
 * 6. 결과를 Google Sheets에 업데이트
 */

const chalk = require('chalk');
const puppeteer = require('puppeteer');

class FamilyPlanWorkflowService {
  constructor({
    sunbrowserAdapter,
    googleAuthService,
    proxySwitchService,
    youtubeFamilyPlanService,
    familyPlanSheetRepository,
    browserController,
    logger,
    config
  }) {
    this.sunbrowser = sunbrowserAdapter;
    this.googleAuth = googleAuthService;
    this.proxySwitch = proxySwitchService;
    this.familyPlanChecker = youtubeFamilyPlanService;
    this.sheetsRepo = familyPlanSheetRepository;
    this.browserController = browserController;
    this.logger = logger;
    this.config = config;
    
    // 워크플로우 설정
    this.maxRetries = config.maxRetries || 3;
    this.debugMode = config.debugMode || false;
  }

  /**
   * 단일 계정 처리
   */
  async processAccount(account) {
    const startTime = Date.now();
    const workflowId = `workflow_${Date.now()}`;
    
    console.log(chalk.cyan.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan.bold(`🚀 Family Plan 체크 워크플로우 시작`));
    console.log(chalk.cyan(`계정: ${account.email}`));
    console.log(chalk.cyan(`워크플로우 ID: ${workflowId}`));
    console.log(chalk.cyan.bold(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
    
    let browser = null;
    let profileId = null;
    
    try {
      // Step 1: 프로필 생성/확인
      console.log(chalk.yellow('\n📋 Step 1: 프로필 준비'));
      console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━'));
      
      const profileResult = await this.prepareProfile(account);
      profileId = profileResult.profileId;
      
      // Step 2: 한국 프록시로 Google 로그인
      console.log(chalk.yellow('\n🇰🇷 Step 2: 한국 프록시로 Google 로그인'));
      console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━'));
      
      const loginResult = await this.performGoogleLogin(profileId, account);
      if (!loginResult.success) {
        throw new Error(`로그인 실패: ${loginResult.error}`);
      }
      
      // Step 3: 파키스탄 프록시로 전환
      console.log(chalk.yellow('\n🇵🇰 Step 3: 파키스탄 프록시로 전환'));
      console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━'));
      
      const switchResult = await this.proxySwitch.switchCountry(
        profileId, 
        'kr', 
        'pk', 
        { 
          testConnection: true,
          restartBrowser: true,
          verifyLocation: true 
        }
      );
      
      if (!switchResult.success) {
        throw new Error(`프록시 전환 실패: ${switchResult.error}`);
      }
      
      // Step 4: YouTube Family Plan 체크
      console.log(chalk.yellow('\n🎵 Step 4: YouTube Family Plan 체크'));
      console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━'));
      
      // 브라우저 재연결
      const browserInfo = await this.sunbrowser.openBrowser(profileId);
      browser = await this.browserController.connect(browserInfo.ws);
      const page = await browser.newPage();
      
      const checkResult = await this.familyPlanChecker.checkFamilyPlan(page, {
        id: profileId,
        name: account.email.split('@')[0]
      });
      
      // Step 5: 결과 저장
      console.log(chalk.yellow('\n💾 Step 5: 결과 저장'));
      console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━'));
      
      await this.updateSheets(account, checkResult);
      
      // 성공 로그
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(chalk.green.bold(`\n✅ 워크플로우 완료!`));
      console.log(chalk.green(`총 소요 시간: ${duration}초`));
      console.log(chalk.green(`최종 상태: ${checkResult.status}`));
      
      if (checkResult.price) {
        console.log(chalk.green(`감지된 가격: ${checkResult.price.full}`));
      }
      
      return {
        success: true,
        account: account.email,
        status: checkResult.status,
        price: checkResult.price,
        screenshot: checkResult.screenshot,
        duration,
        workflowId
      };
      
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.error(chalk.red.bold(`\n❌ 워크플로우 실패!`));
      console.error(chalk.red(`오류: ${error.message}`));
      console.error(chalk.red(`소요 시간: ${duration}초`));
      
      // 에러 로깅
      this.logger.error('Family Plan workflow failed', {
        workflowId,
        account: account.email,
        error: error.message,
        stack: error.stack,
        duration
      });
      
      // Sheets에 에러 상태 업데이트
      await this.updateSheets(account, {
        status: 'ERROR',
        message: error.message
      }).catch(console.error);
      
      return {
        success: false,
        account: account.email,
        error: error.message,
        duration,
        workflowId
      };
      
    } finally {
      // 정리 작업
      if (browser) {
        await browser.close().catch(console.error);
      }
      
      if (profileId) {
        await this.sunbrowser.closeBrowser(profileId).catch(console.error);
      }
    }
  }

  /**
   * 프로필 준비 (생성 또는 확인)
   */
  async prepareProfile(account) {
    try {
      const profileName = account.email.split('@')[0];
      
      // 기존 프로필 검색
      const existingProfile = await this.sunbrowser.findProfileByName(profileName);
      
      if (existingProfile) {
        console.log(chalk.green(`✅ 기존 프로필 사용: ${profileName}`));
        
        // Google Sheets에 프로필 ID 업데이트
        await this.sheetsRepo.updateProfileIds(account.email, {
          acc_id: existingProfile.user_id,
          profile_id: existingProfile.user_id
        }).catch(console.error);
        
        return {
          profileId: existingProfile.user_id,
          isNew: false
        };
      }
      
      // 새 프로필 생성
      console.log(chalk.yellow(`📝 새 프로필 생성 중: ${profileName}`));
      
      const newProfile = await this.sunbrowser.createFamilyPlanProfile({
        name: profileName,
        email: account.email,
        password: account.password,
        recoveryEmail: account.recoveryEmail,
        totpSecret: account.totpSecret
      });
      
      console.log(chalk.green(`✅ 프로필 생성 완료: ${newProfile.data.serial_number}`));
      
      // Google Sheets에 프로필 ID 업데이트
      await this.sheetsRepo.updateProfileIds(account.email, {
        acc_id: newProfile.data.user_id,
        profile_id: newProfile.data.user_id
      }).catch(console.error);
      
      return {
        profileId: newProfile.data.user_id,
        isNew: true
      };
      
    } catch (error) {
      console.error(chalk.red(`프로필 준비 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * Google 로그인 수행
   */
  async performGoogleLogin(profileId, account) {
    let browser = null;
    
    try {
      // 한국 프록시 설정
      const krProxy = this.proxySwitch.proxyManager.getAvailableProxy('kr');
      await this.sunbrowser.updateProfileProxy(profileId, krProxy);
      
      console.log(chalk.gray(`프록시 설정: ${krProxy.host}:${krProxy.port}`));
      
      // 브라우저 실행
      const browserInfo = await this.sunbrowser.openBrowser(profileId);
      browser = await this.browserController.connect(browserInfo.ws);
      const page = await browser.newPage();
      
      console.log(chalk.green('✅ 브라우저 연결 성공'));
      
      // Google 로그인
      const loginResult = await this.googleAuth.login(page, {
        email: account.email,
        password: account.password,
        recoveryEmail: account.recoveryEmail,
        totpSecret: account.totpSecret
      });
      
      // 로그인 성공 후 3초 대기
      if (loginResult.success) {
        await this.delay(3000);
      }
      
      return loginResult;
      
    } catch (error) {
      console.error(chalk.red(`로그인 실패: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
      
    } finally {
      if (browser) {
        await browser.close().catch(console.error);
      }
      await this.sunbrowser.closeBrowser(profileId).catch(console.error);
    }
  }

  /**
   * Google Sheets 업데이트
   */
  async updateSheets(account, result) {
    try {
      // 상태 메시지 생성
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      let statusMessage = `[${timestamp}] ${result.status}`;
      
      if (result.price) {
        statusMessage += ` | ${result.price.full}`;
      }
      
      if (result.message) {
        statusMessage += ` | ${result.message}`;
      }
      
      // Sheets 업데이트
      await this.sheetsRepo.updateStatus(account.email, statusMessage);
      
      console.log(chalk.green(`✅ Google Sheets 업데이트 완료`));
      
    } catch (error) {
      console.error(chalk.red(`Sheets 업데이트 실패: ${error.message}`));
      // 에러는 throw하지 않음 (워크플로우는 계속 진행)
    }
  }

  /**
   * 배치 처리
   */
  async processBatch(accounts, options = {}) {
    const { concurrent = 1 } = options;
    
    console.log(chalk.cyan.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan.bold(`📦 배치 처리 시작`));
    console.log(chalk.cyan(`총 계정 수: ${accounts.length}`));
    console.log(chalk.cyan(`동시 처리: ${concurrent}개`));
    console.log(chalk.cyan.bold(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
    
    const results = [];
    
    // 순차 처리 (동시 처리는 추후 구현)
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      
      console.log(chalk.cyan(`\n[${i + 1}/${accounts.length}] 처리 중...`));
      
      const result = await this.processAccount(account);
      results.push(result);
      
      // 다음 계정 처리 전 지연
      if (i < accounts.length - 1) {
        console.log(chalk.gray(`\n다음 계정 처리까지 5초 대기...`));
        await this.delay(5000);
      }
    }
    
    // 결과 요약
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(chalk.cyan.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan.bold(`📊 배치 처리 완료`));
    console.log(chalk.green(`  ✅ 성공: ${successful}개`));
    console.log(chalk.red(`  ❌ 실패: ${failed}개`));
    
    // 상태별 집계
    const statusCount = {};
    results.forEach(r => {
      if (r.status) {
        statusCount[r.status] = (statusCount[r.status] || 0) + 1;
      }
    });
    
    console.log(chalk.cyan(`\n상태별 집계:`));
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(chalk.gray(`  - ${status}: ${count}개`));
    });
    
    console.log(chalk.cyan.bold(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
    
    return results;
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FamilyPlanWorkflowService;