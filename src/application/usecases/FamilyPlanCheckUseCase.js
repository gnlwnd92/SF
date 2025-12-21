/**
 * FamilyPlanCheckUseCase - YouTube Family Plan 자격 확인 자동화
 * 
 * 워크플로우:
 * 1. Google Sheets에서 계정 정보 로드
 * 2. AdsPower 프로필 생성 또는 업데이트
 * 3. 한국 프록시로 Google 로그인
 * 4. 파키스탄 프록시로 전환 후 Family Plan 체크
 * 5. 결과를 Google Sheets에 업데이트
 */

const chalk = require('chalk');
const ora = require('ora');

class FamilyPlanCheckUseCase {
  constructor({
    adsPowerAdapter,
    browserController,
    googleSheetsRepository,
    proxyManager,
    familyPlanDetector,
    logger,
    config
  }) {
    this.adsPower = adsPowerAdapter;
    this.browser = browserController;
    this.sheets = googleSheetsRepository;
    this.proxyManager = proxyManager;
    this.detector = familyPlanDetector;
    this.logger = logger;
    this.config = config;
    
    // 프록시 리스트
    this.koreanProxies = this.generateProxyList('kr', 100);
    this.pakistanProxies = this.generateProxyList('pk', 100);
  }

  /**
   * 메인 실행 메서드
   */
  async execute(options = {}) {
    const spinner = ora('가족요금제 체크 시작').start();
    
    try {
      // 1. Google Sheets에서 계정 정보 로드
      spinner.text = '계정 정보 로드 중...';
      const accounts = await this.loadFamilyPlanAccounts();
      
      if (accounts.length === 0) {
        spinner.warn('처리할 계정이 없습니다');
        return { success: false, message: 'No accounts to process' };
      }
      
      console.log(chalk.cyan(`\n📋 ${accounts.length}개 계정 발견\n`));
      
      const results = [];
      
      // 2. 각 계정 처리
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        spinner.text = `[${i + 1}/${accounts.length}] ${account.email} 처리 중...`;
        
        try {
          const result = await this.processAccount(account);
          results.push(result);
          
          // Google Sheets 업데이트
          await this.updateAccountStatus(account, result);
          
          console.log(chalk.green(`✅ ${account.email}: ${result.status}`));
        } catch (error) {
          console.log(chalk.red(`❌ ${account.email}: ${error.message}`));
          results.push({
            email: account.email,
            status: 'ERROR',
            error: error.message
          });
        }
        
        // Rate limiting
        if (i < accounts.length - 1) {
          await this.delay(5000);
        }
      }
      
      spinner.succeed('가족요금제 체크 완료');
      
      // 3. 결과 요약
      this.printSummary(results);
      
      return {
        success: true,
        results,
        processed: results.length
      };
      
    } catch (error) {
      spinner.fail(`오류 발생: ${error.message}`);
      this.logger.error('FamilyPlanCheck failed', error);
      throw error;
    }
  }

  /**
   * 개별 계정 처리
   */
  async processAccount(account) {
    // 프로필명은 이메일 주소 전체 사용
    const profileName = account.email;
    let profileId = account.adsPowerProfileId;
    let browser = null;
    
    try {
      // 1. AdsPower 프로필 생성 또는 확인 (프록시 설정 포함)
      if (profileId) {
        // 기존 프로필이 있다고 되어있는 경우, 실제로 존재하는지 확인
        console.log(chalk.gray(`🔍 기존 프로필 확인: ${profileId}`));
        const profileExists = await this.checkProfileExists(profileId);
        
        if (!profileExists) {
          console.log(chalk.yellow(`⚠️ 프로필 ${profileId}가 존재하지 않음. 새로 생성합니다.`));
          profileId = null; // 새로 생성하도록 설정
        }
      }
      
      if (!profileId) {
        console.log(chalk.yellow(`📱 새 프로필 생성: ${profileName}`));
        // 한국 프록시를 프로필 생성 시점에 설정
        const koreanProxy = this.getRandomProxy(this.koreanProxies);
        profileId = await this.createAdsPowerProfile(profileName, account, koreanProxy);
      } else {
        // 기존 프로필이 있으면 한국 프록시로 업데이트
        console.log(chalk.gray(`🔄 프로필 프록시 업데이트: ${profileId}`));
        const koreanProxy = this.getRandomProxy(this.koreanProxies);
        await this.updateProfileProxy(profileId, koreanProxy);
      }
      
      // 3. 브라우저 실행 및 로그인
      console.log(chalk.cyan('🌐 한국 프록시로 로그인...'));
      console.log(chalk.gray(`   프로필 ID: ${profileId}`));
      
      if (!profileId) {
        throw new Error('프로필 ID가 없습니다. 프로필 생성이 실패했을 수 있습니다.');
      }
      
      browser = await this.adsPower.launchBrowser(profileId);
      const page = await browser.getActivePage();
      
      // Google 로그인
      const loginSuccess = await this.performGoogleLogin(page, account);
      if (!loginSuccess) {
        throw new Error('Google 로그인 실패');
      }
      
      // 4. 브라우저 종료
      await browser.close();
      await this.delay(3000);
      
      // 5. 파키스탄 프록시로 전환
      console.log(chalk.cyan('🌍 파키스탄 프록시로 전환...'));
      const pakistanProxy = this.getRandomProxy(this.pakistanProxies);
      await this.updateProfileProxy(profileId, pakistanProxy);
      
      // 6. 브라우저 재실행
      browser = await this.adsPower.launchBrowser(profileId);
      const newPage = await browser.getActivePage();
      
      // 7. YouTube Music Family 페이지 접근
      console.log(chalk.cyan('🎵 YouTube Music Family 페이지 접근...'));
      await newPage.goto('https://music.youtube.com/youtube_premium/family', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await this.delay(5000);
      
      // 8. Family Plan 상태 확인
      const status = await this.detector.checkFamilyPlanStatus(newPage);
      
      // 9. 스크린샷 저장
      const screenshotPath = `screenshots/family-plan-${profileName}-${Date.now()}.png`;
      await newPage.screenshot({ path: screenshotPath, fullPage: true });
      
      return {
        email: account.email,
        profileId,
        status: status.eligible ? 'ELIGIBLE' : status.reason,
        details: status,
        screenshot: screenshotPath,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Account processing failed: ${account.email}`, error);
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
    }
  }

  /**
   * AdsPower 프로필 생성 (프록시 설정 포함)
   */
  async createAdsPowerProfile(name, account, proxyUrl) {
    // 프록시 URL 파싱
    const proxyConfig = this.parseProxy(proxyUrl);
    
    const profileData = {
      name: name,
      group_id: '0', // 기본 그룹
      browser_type: 'sun',  // SunBrowser 사용
      browser_kernel_ver: 'latest',  // 최신 버전
      // Windows 11 OS 설정 (검증된 방법)
      operating_system: 'Windows',
      os_version: '11',
      platform: 'Windows',
      platform_version: '11',
      device_operating_system: 'Windows 11',
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // 프록시 설정을 프로필 생성 시점에 포함 (올바른 형식)
      user_proxy_config: {
        proxy_soft: 'other',  // 필수 필드
        proxy_type: 'http',
        proxy_host: proxyConfig.host,
        proxy_port: parseInt(proxyConfig.port),
        proxy_user: proxyConfig.username,
        proxy_password: proxyConfig.password
      },
      fingerprint_config: {
        webgl: 1,  // 1 = noise 활성화
        canvas: 1,  // 1 = noise 활성화  
        audio: 1,  // 1 = noise 활성화
        timezone: 'Asia/Seoul',
        language: ['ko-KR', 'ko', 'en-US', 'en'],
        screen_resolution: '1920_1080',  // AdsPower는 underscore 형식 사용
        platform: 'Win32',  // Windows 플랫폼
        hardware_concurrency: 8,  // CPU 코어 수
        device_memory: 8  // 메모리 (GB)
      }
    };
    
    const response = await this.adsPower.createProfile(profileData);
    
    // 성공 응답 처리
    if (response.success) {
      // Google Sheets에 프로필 ID 저장
      await this.sheets.updateAdsPowerIds(
        account.rowIndex,
        response.acc_id || 'N/A',
        response.id
      );
      
      return response.id;
    } else {
      throw new Error(response.message || 'Failed to create profile');
    }
  }

  /**
   * 프로필 프록시 업데이트
   */
  async updateProfileProxy(profileId, proxyUrl) {
    const proxyConfig = this.parseProxy(proxyUrl);
    
    return await this.adsPower.updateProfile(profileId, {
      user_proxy_config: {
        proxy_soft: 'other',  // 필수 필드
        proxy_type: 'http',
        proxy_host: proxyConfig.host,
        proxy_port: parseInt(proxyConfig.port),
        proxy_user: proxyConfig.username,
        proxy_password: proxyConfig.password
      }
    });
  }

  /**
   * Google 로그인 수행
   */
  async performGoogleLogin(page, account) {
    try {
      // Google 로그인 페이지로 이동
      await page.goto('https://accounts.google.com', {
        waitUntil: 'networkidle2'
      });
      
      // 이메일 입력
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', account.email, { delay: 100 });
      await page.keyboard.press('Enter');
      
      await this.delay(3000);
      
      // 비밀번호 입력
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', account.password, { delay: 100 });
      await page.keyboard.press('Enter');
      
      await this.delay(5000);
      
      // 로그인 성공 확인
      const cookies = await page.cookies();
      return cookies.some(cookie => cookie.name === 'SID' || cookie.name === 'HSID');
      
    } catch (error) {
      this.logger.error('Google login failed', error);
      return false;
    }
  }

  /**
   * Google Sheets에서 계정 정보 로드
   */
  async loadFamilyPlanAccounts() {
    await this.sheets.initialize();
    
    // FamilyPlanSheetRepository의 getAllAccounts() 메서드 사용
    const accounts = await this.sheets.getAllAccounts();
    
    // 기존 형식과 호환되도록 필드명 매핑
    return accounts.map(acc => ({
      email: acc.email,
      password: acc.password,
      recoveryEmail: acc.recoveryEmail,
      id: acc.totpSecret,  // D열이 TOTP 시크릿으로 변경됨
      acc_id: acc.accId,
      adsPowerProfileId: acc.profileId,
      status: acc.status,
      rowIndex: acc.rowNumber
    }));
  }

  /**
   * 계정 상태 업데이트
   */
  async updateAccountStatus(account, result) {
    // FamilyPlanSheetRepository의 메서드 사용
    const details = {
      price: result.price,
      currency: result.currency,
      message: result.message || result.error
    };
    
    await this.sheets.updateAccountStatus(
      account.rowIndex,
      result.status,
      details
    );
    
    // AdsPower ID 업데이트 (있는 경우)
    if (result.profileId && !account.adsPowerProfileId) {
      await this.sheets.updateAdsPowerIds(
        account.rowIndex,
        result.acc_id || account.acc_id,
        result.profileId
      );
    }
  }

  /**
   * 프록시 리스트 생성
   */
  generateProxyList(country, count) {
    const proxies = [];
    const domain = country === 'kr' ? 'kr.decodo.com' : 'pk.decodo.com';
    
    for (let i = 1; i <= count; i++) {
      const port = 10000 + i;
      proxies.push(`https://user-sproxq5yy8-sessionduration-1:CcI9pU1jfbcrU4m2+l@${domain}:${port}`);
    }
    
    return proxies;
  }

  /**
   * 랜덤 프록시 선택
   */
  getRandomProxy(proxyList) {
    return proxyList[Math.floor(Math.random() * proxyList.length)];
  }

  /**
   * 프록시 URL 파싱
   */
  parseProxy(proxyUrl) {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: url.port,
      username: url.username,
      password: url.password
    };
  }

  /**
   * 프로필 존재 여부 확인
   */
  async checkProfileExists(profileId) {
    try {
      // AdsPower API를 통해 프로필 존재 여부 확인
      const profiles = await this.adsPower.getProfiles({ page_size: 100 });
      if (profiles && profiles.profiles) {
        return profiles.profiles.some(p => p.user_id === profileId);
      }
      return false;
    } catch (error) {
      console.log(chalk.red(`프로필 확인 실패: ${error.message}`));
      return false;
    }
  }

  /**
   * 결과 요약 출력
   */
  printSummary(results) {
    console.log(chalk.cyan.bold('\n📊 처리 결과 요약\n'));
    
    const eligible = results.filter(r => r.status === 'ELIGIBLE').length;
    const ineligible = results.filter(r => r.status === 'INELIGIBLE').length;
    const errors = results.filter(r => r.status === 'ERROR').length;
    const unknown = results.length - eligible - ineligible - errors;
    
    console.log(chalk.green(`✅ 가입 가능: ${eligible}개`));
    console.log(chalk.yellow(`❌ 가입 불가: ${ineligible}개`));
    console.log(chalk.red(`⚠️ 오류: ${errors}개`));
    console.log(chalk.gray(`❓ 불명: ${unknown}개`));
    console.log(chalk.white(`📋 전체: ${results.length}개`));
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FamilyPlanCheckUseCase;