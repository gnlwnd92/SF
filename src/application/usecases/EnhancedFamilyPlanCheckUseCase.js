/**
 * EnhancedFamilyPlanCheckUseCase - YouTube 가족요금제 자동 검증 시스템 (수정 버전)
 * 
 * 워크플로우:
 * 1. Google Sheets '가족요금제' 탭에서 계정 정보 로드
 * 2. Windows 11 고정 OS로 AdsPower 프로필 생성
 * 3. Google 로그인 (https://accounts.google.com에서 시작, TOTP 2FA 지원)
 * 4. YouTube Music Premium 페이지로 이동하여 가족요금제 상태 확인
 * 5. 결과에 따라 프로필 유지/삭제
 * 6. Google Sheets 업데이트
 */

const chalk = require('chalk');
const ora = require('ora');
const speakeasy = require('speakeasy');
const axios = require('axios');
const ScreenshotDebugService = require('../../services/ScreenshotDebugService');
// 개선된 인증 서비스 - 복구 이메일 선택 문제 해결 버전
const ImprovedAuthenticationService = require('../../services/ImprovedAuthenticationService-enhanced');
// [v2.23] proxy-pools.js 하드코딩 제거 - 모든 프록시는 '프록시' 시트에서 조회
// SunBrowser 프로필 생성기 추가
const SunbrowserProfileCreator = require('../../infrastructure/adapters/SunbrowserProfileCreator');
// 포트 자동 감지 유틸리티
const { getApiUrl } = require('../../utils/adsPowerPortDetector');

class EnhancedFamilyPlanCheckUseCase {
  constructor({
    adsPowerAdapter,
    browserController,
    googleSheetsRepository,
    familyPlanSheetRepository,
    familyPlanDetectionService,
    authService,
    hashProxyMapper,  // 프록시 시트에서 프록시 가져오기
    logger,
    config
  }) {
    this.adsPower = adsPowerAdapter;
    this.browser = browserController;
    this.sheets = googleSheetsRepository;
    this.familySheets = familyPlanSheetRepository;
    this.detector = familyPlanDetectionService;
    this.hashProxyMapper = hashProxyMapper;  // 프록시 시트 서비스
    this.logger = logger;
    this.config = config;
    
    // ImprovedAuthenticationService 사용 (계정 선택 및 2FA 처리)
    this.authService = new ImprovedAuthenticationService({
      debugMode: true,
      maxRetries: 3,
      screenshotEnabled: true,
      humanLikeMotion: true
    });
    
    // SunBrowser 프로필 생성기 초기화
    this.profileCreator = new SunbrowserProfileCreator({
      apiUrl: this.adsPower.apiUrl || process.env.ADSPOWER_API_URL
    });
    
    // 프록시 상태 확인
    const proxyStatus = getProxyPoolStatus();
    console.log(chalk.cyan('🌐 프록시 풀 상태:'));
    console.log(chalk.gray(`  한국: ${proxyStatus.kr.total}개 (${proxyStatus.kr.portRange})`));
    console.log(chalk.gray(`  미국: ${proxyStatus.us.total}개 (${proxyStatus.us.portRange}) - 가족요금제 확인용`));
    
    // 스크린샷 디버깅 서비스 초기화
    this.screenshotDebug = new ScreenshotDebugService({
      screenshotPath: require('path').join(process.cwd(), 'screenshots', 'family-plan-debug'),
      enableAutoCapture: true,
      captureOnError: true,
      includeFullPage: false,
      logPageInfo: true
    });
  }

  /**
   * 메인 실행 메서드
   */
  async execute(options = {}) {
    const spinner = ora('가족요금제 자동 검증 시작').start();
    
    try {
      // 1. Google Sheets에서 계정 정보 로드
      spinner.text = '계정 정보 로드 중...';
      const accounts = await this.loadFamilyPlanAccounts();
      
      if (accounts.length === 0) {
        spinner.warn('처리할 계정이 없습니다');
        return { success: false, message: 'No accounts to process' };
      }
      
      spinner.stop();
      
      // 상태별 계정 분류
      const emptyStatusAccounts = accounts.filter(acc => !acc.status || acc.status === '');
      const checkedAccounts = accounts.filter(acc => acc.status && acc.status !== '');
      
      console.log(chalk.cyan(`\n📋 전체 계정: ${accounts.length}개`));
      console.log(chalk.green(`   • 미처리 (G열 비어있음): ${emptyStatusAccounts.length}개 (기본 선택)`));
      console.log(chalk.gray(`   • 처리됨 (G열 값 있음): ${checkedAccounts.length}개`));
      console.log();
      
      // 선택된 계정들
      let accountsToProcess = [];
      
      // 옵션이 있으면 직접 처리 (CLI가 아닌 경우)
      if (options.selectedAccounts) {
        accountsToProcess = options.selectedAccounts;
      } else if (options.autoSelectEmpty) {
        // 자동으로 빈 상태만 선택
        accountsToProcess = emptyStatusAccounts;
      } else {
        // 테스트 모드에서는 계정 수 제한
        const maxAccounts = options.maxAccounts || accounts.length;
        accountsToProcess = emptyStatusAccounts.slice(0, maxAccounts);
      }
      
      if (accountsToProcess.length === 0) {
        console.log(chalk.yellow('\n⚠️ 처리할 미처리 계정이 없습니다.'));
        return { success: false, message: 'No unchecked accounts to process' };
      }
      
      console.log(chalk.cyan(`\n🎯 ${accountsToProcess.length}개 계정 처리 예정\n`));
      
      const results = [];
      let keepCount = 0;
      let deleteCount = 0;
      
      // 2. 각 계정 처리
      for (let i = 0; i < accountsToProcess.length; i++) {
        const account = accountsToProcess[i];
        spinner.text = `[${i + 1}/${accountsToProcess.length}] ${account.email} 처리 중...`;
        
        try {
          const result = await this.processAccount(account, i);
          results.push(result);
          
          // 프로필 유지/삭제 결정
          if (result.hasFamilyPlan) {
            keepCount++;
            console.log(chalk.green(`✅ ${account.email}: 가족요금제 활성 - 프로필 유지`));
          } else {
            deleteCount++;
            console.log(chalk.yellow(`⚠️ ${account.email}: 가족요금제 없음 - 프로필 삭제됨`));
          }
          
          // Google Sheets 업데이트는 processAccount 내부에서 이미 처리됨
          // 중복 제거를 위해 여기서는 호출하지 않음
          // await this.updateAccountStatus(account, result);
          
        } catch (error) {
          console.log(chalk.red(`❌ ${account.email}: ${error.message}`));
          results.push({
            email: account.email,
            status: 'ERROR',
            error: error.message
          });
        }
        
        // Rate limiting
        if (i < accountsToProcess.length - 1) {
          await this.delay(5000);
        }
      }
      
      spinner.succeed('가족요금제 검증 완료');
      
      // 3. 결과 요약
      this.printSummary(results, keepCount, deleteCount);
      
      return {
        success: true,
        results,
        processed: results.length,
        kept: keepCount,
        deleted: deleteCount
      };
      
    } catch (error) {
      spinner.fail(`오류 발생: ${error.message}`);
      this.logger.error('EnhancedFamilyPlanCheck failed', error);
      throw error;
    }
  }

  /**
   * 개별 계정 처리
   */
  async processAccount(account, index) {
    const profileName = account.email;
    let profileId = null;
    let profileSerialNumber = '0'; // 프로필 고유번호 초기화
    let browser = null;
    
    try {
      // 1. Windows 11 프로필 생성
      console.log(chalk.cyan(`\n📱 Windows 11 프로필 생성: ${profileName}`));
      const profileResult = await this.createWindows11Profile(profileName, account);
      
      // 프로필 생성 결과에서 ID 추출
      if (typeof profileResult === 'object') {
        profileId = profileResult.profileId;
      } else {
        profileId = profileResult; // 기존 방식 호환
      }
      
      // 프로필 생성 후 serial_number 조회
      // getProfileDetails는 serial_number를 반환하지 않으므로 직접 API 호출
      try {
        // 포트 자동 감지를 사용하여 API URL 가져오기
        const apiUrl = await getApiUrl(this.adsPower.apiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325', true);
        const response = await axios.get(`${apiUrl}/api/v1/user/list`, {
          params: { user_id: profileId }
        });
        
        if (response.data && response.data.code === 0 && response.data.data) {
          const profiles = response.data.data.list || [];
          const createdProfile = profiles.find(p => p.user_id === profileId);
          
          if (createdProfile && createdProfile.serial_number) {
            profileSerialNumber = createdProfile.serial_number.toString();
            console.log(chalk.gray(`  - 프로필 고유번호(serial_number): ${profileSerialNumber}`));
          }
        }
      } catch (err) {
        console.log(chalk.yellow(`⚠️ Serial number 조회 실패: ${err.message}`));
      }
      
      // 2. 브라우저 실행
      console.log(chalk.cyan('🌐 브라우저 실행...'));
      const session = await this.adsPower.launchBrowser(profileId);
      browser = session; // 나중에 close를 위해 저장
      
      // 페이지 가져오기 - Google 계정 페이지로 이동
      console.log(chalk.yellow('  📍 Google 계정 페이지로 이동...'));
      const page = await this.adsPower.getPage(profileId, 'https://accounts.google.com');
      
      // 페이지 로드 대기
      await this.delay(3000);
      
      // 초기 페이지 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: '01_browser_launched',
        category: 'family-check',
        profileName,
        description: '브라우저 실행 직후'
      });
      
      // 3. Google 로그인 수행 (accounts.google.com에서 시작)
      console.log(chalk.yellow('🔐 Google 로그인 시작'));
      const loginResult = await this.performGoogleLogin(page, account);
      
      if (!loginResult || !loginResult.success) {
        // 로그인 실패 스크린샷
        const errorType = loginResult?.errorType || 'UNKNOWN';
        const errorMessage = loginResult?.errorMessage || 'Google 로그인 실패';
        
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: '03_login_failed',
          category: 'family-check',
          profileName,
          description: `Google 로그인 실패: ${errorType}`
        });
        
        // 오류 타입에 따른 상세 메시지 생성
        let detailMessage = errorMessage;
        if (errorType === 'RECAPTCHA_DETECTED') {
          detailMessage = 'reCAPTCHA 발생으로 인한 로그인 차단';
        } else if (errorType === 'WRONG_PASSWORD') {
          detailMessage = '비밀번호 불일치 - Google Sheets B열 확인 필요';
        } else if (errorType === 'ACCOUNT_NOT_FOUND') {
          detailMessage = '계정을 찾을 수 없음 - 이메일 확인 필요';
        } else if (errorType === 'RECOVERY_EMAIL_MISMATCH') {
          detailMessage = '복구 이메일 불일치 - Google Sheets C열 확인 필요';
        } else if (errorType === 'NO_TOTP_SECRET') {
          detailMessage = 'TOTP 시크릿 없음 - Google Sheets D열 확인 필요';
        } else if (errorType === 'WRONG_TOTP') {
          detailMessage = 'TOTP 코드 불일치 - 시크릿 키 확인 필요';
        } else if (errorType === 'TOO_MANY_ATTEMPTS') {
          detailMessage = '너무 많은 시도로 인한 차단';
        }
        
        throw new Error(detailMessage);
      }
      
      // 로그인 성공 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: '04_login_success',
        category: 'family-check',
        profileName,
        description: 'Google 로그인 성공'
      });
      
      // 4. 로그인 후 브라우저 종료 (프록시 전환을 위해)
      console.log(chalk.yellow('🔄 프록시 전환을 위해 브라우저 종료...'));
      await browser.close();
      browser = null;
      
      // 5. 미국 프록시로 전환 (가족요금제 확인용)
      console.log(chalk.cyan('🌍 미국 프록시로 전환 중...'));

      // 미국 프록시 선택 (시트 → 하드코딩 폴백)
      let usProxy;
      let usProxyId = 'hardcoded_random';

      try {
        if (this.hashProxyMapper) {
          const result = await this.hashProxyMapper.getRandomProxyFromSheet('us');
          usProxy = result.proxy;
          usProxyId = result.proxyId;
          console.log(chalk.cyan('🇺🇸 프록시 시트에서 선택:', `${usProxy.proxy_host}:${usProxy.proxy_port} (${usProxyId})`));
        } else {
          throw new Error('hashProxyMapper not available');
        }
      } catch (proxyError) {
        // [v2.23] 하드코딩 폴백 제거 - 시트 접근 실패 시 에러 throw
        console.log(chalk.red(`❌ 미국 프록시 조회 실패: ${proxyError.message}`));
        throw new Error(`프록시 시트 접근 실패: ${proxyError.message}. Google Sheets '프록시' 탭을 확인하세요.`);
      }
      
      // AdsPower API로 프록시 변경
      await this.adsPower.updateProfile(profileId, {
        user_proxy_config: usProxy
      });
      console.log(chalk.green('✅ 미국 프록시 설정 완료'));
      
      await this.delay(2000);
      
      // 6. 미국 프록시로 브라우저 재실행
      console.log(chalk.cyan('🚀 미국 프록시로 브라우저 재실행...'));
      const usSession = await this.adsPower.launchBrowser(profileId);
      browser = usSession; // 재실행된 브라우저 저장
      
      // 새로 실행한 브라우저에서 페이지 가져오기
      const usPage = await this.adsPower.getPage(profileId);
      
      // 7. YouTube Premium 페이지로 이동
      console.log(chalk.cyan('🎵 YouTube Premium 페이지 접속 시도...'));
      
      try {
        // 미국 프록시 적용 후 페이지 상태 확인 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(usPage, {
          step: '05_before_youtube_navigation',
          category: 'family-check',
          profileName,
          description: '미국 프록시 브라우저 재실행 후 상태'
        });
        
        // YouTube Premium 가족 요금제 페이지로 이동
        await usPage.goto('https://www.youtube.com/premium/family', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.delay(3000); // 페이지 완전 로드 대기
        
        // 쿠키 동의 페이지 체크
        let currentUrl = usPage.url();
        if (currentUrl.includes('consent.youtube.com')) {
          console.log(chalk.yellow('  🍪 YouTube 쿠키 동의 페이지 감지 (초기 접속)'));
          
          // handleCookieConsent 메서드 호출
          const consentHandled = await this.handleCookieConsent(usPage, profileName);
          
          if (consentHandled) {
            // 동의 후 페이지 재로드 대기
            await this.delay(3000);
            currentUrl = usPage.url();
            
            // Premium 페이지로 리다이렉트되지 않으면 다시 이동
            if (!currentUrl.includes('youtube.com/premium')) {
              console.log(chalk.yellow('  📍 YouTube Premium 페이지로 재이동'));
              await usPage.goto('https://www.youtube.com/premium/family', {
                waitUntil: 'networkidle2',
                timeout: 30000
              });
              await this.delay(3000);
            }
          }
        }
        
        // YouTube Premium 페이지 로드 성공 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(usPage, {
          step: '06_youtube_premium_loaded',
          category: 'family-check',
          profileName,
          description: 'YouTube Premium 페이지 로드 완료'
        });
        
        // Sign in 버튼 감지 및 처리
        console.log(chalk.cyan('🔍 로그인 상태 확인 중...'));
        
        // 다양한 Sign in 버튼 셀렉터 시도
        const signInSelectors = [
          'a[aria-label="Sign in"]',
          'button[aria-label="Sign in"]',
          'tp-yt-paper-button:has-text("Sign in")',
          'yt-button-renderer a[href*="accounts.google.com"]',
          'a.yt-simple-endpoint[href*="accounts.google.com"]',
          'ytd-button-renderer a[href*="ServiceLogin"]'
        ];
        
        let signInButton = null;
        for (const selector of signInSelectors) {
          try {
            signInButton = await usPage.$(selector);
            if (signInButton) {
              console.log(chalk.green(`✅ Sign in 버튼 발견: ${selector}`));
              break;
            }
          } catch (e) {
            // 선택자 오류 무시
          }
        }
        
        if (signInButton) {
          console.log(chalk.yellow('⚠️ 로그인이 필요합니다. Sign in 버튼을 클릭합니다...'));
          
          // 스크린샷 캡처 (로그인 전)
          await this.screenshotDebug.captureDebugScreenshot(usPage, {
            step: '05a_before_signin',
            category: 'family-check',
            profileName,
            description: 'Sign in 버튼 클릭 전'
          });
          
          // Sign in 버튼 클릭
          await signInButton.click();
          console.log(chalk.gray('⏳ Google 로그인 페이지로 이동 중...'));
          await this.delay(3000);
          
          // 페이지 네비게이션 대기
          try {
            await usPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
          } catch (navError) {
            console.log(chalk.yellow('⚠️ 네비게이션 타임아웃 - 계속 진행'));
          }
          
          // 현재 URL 확인
          const currentUrl = await usPage.url();
          console.log(chalk.gray(`현재 URL: ${currentUrl}`));
          
          // Google 로그인 페이지인지 확인
          if (currentUrl.includes('accounts.google.com')) {
            console.log(chalk.cyan('📧 Google 로그인 페이지 감지'));
            
            // 계정 선택 페이지인지 확인
            if (currentUrl.includes('AccountChooser') || currentUrl.includes('v3/signin/identifier')) {
              console.log(chalk.cyan('👥 계정 선택 페이지 감지'));
              
              // 기존 계정 찾기
              const accountElement = await usPage.$(`div[data-email="${account.email}"]`);
              if (accountElement) {
                console.log(chalk.green(`✅ 기존 계정 발견: ${account.email}`));
                await accountElement.click();
                await this.delay(3000);
                
                // 비밀번호 입력이 필요한 경우
                const passwordInput = await usPage.$('input[type="password"]');
                if (passwordInput) {
                  console.log(chalk.cyan('🔐 비밀번호 입력 중...'));
                  await passwordInput.type(account.password);
                  await this.delay(1000);
                  const nextButton = await usPage.$('#passwordNext');
                  if (nextButton) {
                    await nextButton.click();
                    await this.delay(3000);
                  }
                }
              } else {
                // 계정이 없으면 새로 로그인
                console.log(chalk.yellow('⚠️ 계정을 찾을 수 없어 새로 로그인합니다...'));
                const loginResult = await this.performGoogleLogin(usPage, account, profileName);
                if (!loginResult.success) {
                  throw new Error(`로그인 실패: ${loginResult.errorMessage || '알 수 없는 오류'}`);
                }
              }
            } else {
              // 직접 로그인 페이지
              console.log(chalk.cyan('🔓 로그인 페이지에서 직접 로그인...'));
              const loginResult = await this.performGoogleLogin(usPage, account, profileName);
              if (!loginResult.success) {
                throw new Error(`로그인 실패: ${loginResult.errorMessage || '알 수 없는 오류'}`);
              }
            }
            
            // 로그인 후 YouTube Premium 페이지로 돌아가기 대기
            console.log(chalk.gray('⏳ YouTube Premium 페이지로 리다이렉트 대기...'));
            await this.delay(5000);
            
            // 현재 URL 다시 확인
            const afterLoginUrl = await usPage.url();
            if (!afterLoginUrl.includes('youtube.com/premium')) {
              console.log(chalk.yellow('⚠️ YouTube Premium 페이지로 다시 이동'));
              await usPage.goto('https://www.youtube.com/premium/family', {
                waitUntil: 'networkidle2',
                timeout: 30000
              });
              await this.delay(3000);
            }
          }
        } else {
          console.log(chalk.green('✅ 이미 로그인된 상태입니다.'));
        }
        
      } catch (error) {
        console.error(chalk.red('❌ YouTube Premium 페이지 로드 실패:'), error.message);
        
        // 오류 발생 시 현재 페이지 상태 스크린샷
        try {
          await this.screenshotDebug.captureDebugScreenshot(usPage, {
            step: 'error_youtube_load_failed',
            category: 'family-check-error',
            profileName,
            description: `YouTube Premium 페이지 로드 실패: ${error.message}`
          });
          
          // 현재 페이지 URL과 제목 수집
          const currentUrl = usPage.url();
          const currentTitle = await usPage.title();
          console.log(chalk.yellow(`  현재 URL: ${currentUrl}`));
          console.log(chalk.yellow(`  페이지 제목: ${currentTitle}`));
          
          // 페이지 내용 일부 추출
          const pageContent = await usPage.evaluate(() => {
            const body = document.body;
            if (!body) return '페이지 내용 없음';
            const text = body.innerText || body.textContent || '';
            return text.substring(0, 500); // 처음 500자만
          }).catch(() => '페이지 내용 추출 실패');
          
          console.log(chalk.yellow(`  페이지 내용 (처음 500자):\n${pageContent}`));
          
        } catch (screenshotError) {
          console.log(chalk.yellow(`  스크린샷 캡처 실패: ${screenshotError.message}`));
        }
        
        throw new Error(`가족요금제 페이지 로드 실패: ${error.message}`);
      }
      
      // Premium 페이지 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(usPage, {
        step: '05_youtube_premium',
        category: 'family-check',
        profileName,
        description: 'YouTube Premium 페이지 로드 완료'
      });
      
      // 8. 가족요금제 상태 확인
      console.log(chalk.cyan('🔍 가족요금제 상태 확인 중...'));
      // page 객체에 profileName 추가
      usPage.profileName = profileName;
      const familyPlanStatus = await this.checkFamilyPlanStatus(usPage);
      
      // 최종 상태 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(usPage, {
        step: '06_family_plan_status',
        category: 'family-check',
        profileName,
        description: `가족요금제 상태: ${familyPlanStatus ? '활성' : '없음'}`
      });
      
      // 9. 전체 페이지 스크린샷
      const screenshotPath = `screenshots/family-plan-${profileName.replace('@', '-')}-${Date.now()}.png`;
      await usPage.screenshot({ path: screenshotPath, fullPage: true });
      
      // 10. 브라우저 종료
      await browser.close();
      browser = null;
      
      // 11. 결과에 따른 프로필 처리 및 Google Sheets 업데이트
      let statusDetail = '';
      const currentTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      
      if (!familyPlanStatus) {
        // 가족요금제가 없으면 프로필 삭제
        console.log(chalk.yellow(`🗑️ 가족요금제 없음 - 프로필 삭제: ${profileId}`));
        
        statusDetail = `[❌ 가족요금제 없음] ${currentTime} - 개인 플랜만 표시됨 - 프로필 삭제됨`;
        
        // 브라우저를 먼저 닫고 프로필 삭제
        if (browser) {
          try {
            await browser.close();
            browser = null;
          } catch (e) {
            // 무시
          }
        }
        
        // 프로필 삭제
        await this.adsPower.deleteProfile(profileId);
        console.log(chalk.gray(`프로필 삭제 완료: ${profileId}`));
      } else {
        console.log(chalk.green(`✅ 가족요금제 활성 - 프로필 유지: ${profileId}`));
        
        statusDetail = `[✅ 가족요금제 확인] ${currentTime} - Family plan 확인됨 - 프로필 유지 - KR 프록시 재설정 완료`;
        
        // 브라우저 종료
        if (browser) {
          try {
            await browser.close();
            browser = null;
          } catch (e) {
            // 무시
          }
        }
        
        // 한국 프록시로 재전환 (프로필 유지를 위해)
        console.log(chalk.cyan('🔄 한국 프록시로 재전환...'));

        // 한국 프록시 선택 (시트 → 하드코딩 폴백)
        let newKrProxy;
        let newKrProxyId = 'hardcoded_random';

        try {
          if (this.hashProxyMapper) {
            const result = await this.hashProxyMapper.getRandomProxyFromSheet('kr');
            newKrProxy = result.proxy;
            newKrProxyId = result.proxyId;
            console.log(chalk.cyan('🇰🇷 프록시 시트에서 선택:', `${newKrProxy.proxy_host}:${newKrProxy.proxy_port} (${newKrProxyId})`));
          } else {
            throw new Error('hashProxyMapper not available');
          }
        } catch (proxyError) {
          // [v2.23] 하드코딩 폴백 제거 - 시트 접근 실패 시 에러 throw
          console.log(chalk.red(`❌ 한국 프록시 조회 실패: ${proxyError.message}`));
          throw new Error(`프록시 시트 접근 실패: ${proxyError.message}. Google Sheets '프록시' 탭을 확인하세요.`);
        }

        await this.adsPower.updateProfile(profileId, {
          user_proxy_config: newKrProxy
        });
        console.log(chalk.green('✅ 한국 프록시로 재설정 완료'));
      }
      
      // 12. Google Sheets 업데이트 (E열: acc_id, F열: id, G열: 상태)
      console.log(chalk.cyan('📝 Google Sheets 업데이트 중...'));
      
      // profileSerialNumber는 이미 프로필 생성 시점에서 설정됨
      // 추가로 getProfileDetails를 호출할 필요 없음
      const adsPowerId = profileId; // AdsPower 프로필 ID
      
      console.log(chalk.gray(`  - 프로필 고유번호: ${profileSerialNumber}`));
      console.log(chalk.gray(`  - AdsPower ID: ${adsPowerId}`));
      
      await this.updateGoogleSheets(account, profileSerialNumber, adsPowerId, statusDetail);
      
      return {
        email: account.email,
        profileId: adsPowerId,
        profileSerialNumber: profileSerialNumber,  // AdsPower 프로필 고유번호
        hasFamilyPlan: familyPlanStatus,
        status: familyPlanStatus ? 'FAMILY_PLAN_ACTIVE' : 'NO_FAMILY_PLAN',
        profileDeleted: !familyPlanStatus,  // 가족요금제 없으면 삭제됨
        statusDetail,
        screenshot: screenshotPath,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error(`Account processing failed: ${account.email}`, error);
      
      // 오류 상태를 Google Sheets에 기록
      const errorTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      let errorDetail = error.message || '알 수 없는 오류';
      
      // 오류 메시지를 더 구체적으로 작성
      if (error.message) {
        if (error.message.includes('reCAPTCHA')) {
          errorDetail = '🤖 reCAPTCHA 인증 요구 - 자동화 감지됨';
        } else if (error.message.includes('비밀번호')) {
          errorDetail = '🔒 비밀번호 오류 - Google Sheets B열 확인 필요';
        } else if (error.message.includes('복구 이메일')) {
          errorDetail = '📧 복구 이메일 오류 - Google Sheets C열 확인 필요';
        } else if (error.message.includes('TOTP') || error.message.includes('시크릿')) {
          errorDetail = '🔐 TOTP 오류 - Google Sheets D열 확인 필요';
        } else if (error.message.includes('차단')) {
          errorDetail = '⛔ 계정 차단/비활성화 - Google 계정 상태 확인 필요';
        } else if (error.message.includes('계정을 찾을 수 없')) {
          errorDetail = '🔍 계정을 찾을 수 없음 - 이메일 확인 필요';
        } else if (error.message.includes('너무 많은 시도')) {
          errorDetail = '⏱️ 너무 많은 시도 - 나중에 다시 시도 필요';
        }
      }
      
      const errorStatus = `[❗ 오류] ${errorTime} - ${errorDetail} - 프로필 삭제됨`;
      
      // Google Sheets 업데이트 (오류 상태)
      // profileSerialNumber는 processAccount 시작 부분에서 초기화됨
      // 프로필 생성에 성공했다면 이미 값이 설정되어 있음
      await this.updateGoogleSheets(account, profileSerialNumber || '0', profileId || 'N/A', errorStatus);
      
      // 오류 발생시에도 프로필 삭제
      if (profileId) {
        try {
          await this.adsPower.deleteProfile(profileId);
          console.log(chalk.gray(`프로필 삭제됨: ${profileId}`));
        } catch (deleteError) {
          console.log(chalk.gray(`프로필 삭제 실패: ${deleteError.message}`));
        }
      }
      
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
   * Windows 11 프로필 생성 (SunBrowser + 요구사항 적용)
   */
  async createWindows11Profile(name, account) {
    // 한국 프록시 선택 (시트 → 하드코딩 폴백)
    let krProxy;
    let proxyId = 'hardcoded_random';

    try {
      if (this.hashProxyMapper) {
        const result = await this.hashProxyMapper.getRandomProxyFromSheet('kr');
        krProxy = result.proxy;
        proxyId = result.proxyId;
        console.log(chalk.cyan('🇰🇷 프록시 시트에서 선택:', `${krProxy.proxy_host}:${krProxy.proxy_port} (${proxyId})`));
      } else {
        throw new Error('hashProxyMapper not available');
      }
    } catch (proxyError) {
      // [v2.23] 하드코딩 폴백 제거 - 시트 접근 실패 시 에러 throw
      console.log(chalk.red(`❌ 프록시 조회 실패: ${proxyError.message}`));
      throw new Error(`프록시 시트 접근 실패: ${proxyError.message}. Google Sheets '프록시' 탭을 확인하세요.`);
    }

    try {
      // SunbrowserProfileCreator를 사용하여 프로필 생성
      // 이메일 사용
      const email = account.email || name;
      
      // 프로필 생성 (SunBrowser + 랜덤 설정)
      const result = await this.profileCreator.createProfile(email, {
        proxy: krProxy,  // 프록시 설정 전달
        groupId: "0"    // 기본 그룹
      });
      
      if (result.success) {
        console.log(chalk.green('✅ SunBrowser 프로필 생성 성공'));
        console.log(chalk.gray(`  - Profile ID: ${result.profileId}`));
        console.log(chalk.gray(`  - Account ID: ${result.accountId || 'N/A'}`));
        console.log(chalk.gray(`  - Browser: ${result.details?.fingerprint_config?.browser_kernel_config?.type || 'SunBrowser'}`));
        console.log(chalk.gray(`  - Chrome Version: ${result.details?.fingerprint_config?.browser_kernel_config?.version || 'Random'}`));
        console.log(chalk.gray(`  - Resolution: ${result.details?.fingerprint_config?.screen_resolution || 'Random'}`));
        console.log(chalk.gray(`  - Canvas: 기본값, WebGL: 무작위`));
        
        // 프로필 ID와 Account ID를 객체로 반환
        return {
          profileId: result.profileId,
          accountId: result.accountId || result.acc_id || '0'
        };
      } else {
        throw new Error(`프로필 생성 실패: ${result.error}`);
      }
      
    } catch (error) {
      console.log(chalk.red(`❌ 프로필 생성 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * Google 로그인 수행 (개선된 버전)
   */
  async performGoogleLogin(page, account) {
    try {
      // 이미 getPage에서 accounts.google.com으로 이동했으므로 현재 URL 확인만
      const currentUrl = page.url();
      console.log(chalk.gray(`  현재 URL: ${currentUrl}`));
      
      // 페이지가 완전히 로드되었는지 확인
      await this.delay(2000);
      
      // 로그인 페이지 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: 'login_01_accounts_page',
        category: 'login',
        profileName: account.email,
        description: 'Google 계정 페이지 로드'
      });
      
      // 2. 이미 로그인되어 있는지 확인
      const isLoggedIn = await page.evaluate(() => {
        const url = window.location.href;
        return url.includes('myaccount.google.com') || 
               url.includes('/ManageAccount') ||
               document.querySelector('[data-email]') !== null ||
               document.querySelector('img[aria-label*="Account"]') !== null;
      });
      
      if (isLoggedIn) {
        console.log(chalk.green('  ✅ 이미 Google에 로그인되어 있음'));
        return { success: true };
      }
      
      // 3. ImprovedAuthenticationService를 사용하여 로그인
      console.log(chalk.cyan('  🔐 향상된 인증 서비스로 로그인 시도...'));
      
      const loginResult = await this.authService.handleAuthentication(page, {
        email: account.email,
        password: account.password,
        recoveryEmail: account.recoveryEmail,  // C열: 복구 이메일 추가
        totpSecret: account.totpSecret || account.code  // D열: TOTP 시크릿
      });
      
      if (!loginResult.success) {
        // 상세한 오류 타입 판별
        let errorType = 'UNKNOWN';
        let errorMessage = loginResult.error || '알 수 없는 오류';
        
        // 전화번호 인증 감지
        if (loginResult.error === 'PHONE_VERIFICATION_REQUIRED' || 
            loginResult.status === 'phone_verification_required' ||
            loginResult.message?.includes('번호인증')) {
          errorType = 'PHONE_VERIFICATION_REQUIRED';
          errorMessage = '📱 번호인증 필요';
          console.log(chalk.yellow('  📱 전화번호 인증이 필요한 계정입니다'));
        }
        // reCAPTCHA 감지
        else if (loginResult.error === 'RECAPTCHA_DETECTED' || 
            loginResult.status === 'recaptcha_detected' ||
            page.url().includes('/challenge/recaptcha')) {
          errorType = 'RECAPTCHA_DETECTED';
          errorMessage = 'reCAPTCHA 인증 필요';
          console.log(chalk.yellow('  🤖 reCAPTCHA 감지됨'));
        }
        // 2FA 관련
        else if (loginResult.error === '2FA_REQUIRED' || loginResult.error === 'NO_TOTP_SECRET') {
          errorType = 'NO_TOTP_SECRET';
          errorMessage = 'TOTP 시크릿 없음';
        }
        // 비밀번호 관련
        else if (loginResult.error && loginResult.error.includes('비밀번호')) {
          errorType = 'WRONG_PASSWORD';
          errorMessage = '비밀번호 불일치';
        }
        // 계정 관련
        else if (loginResult.error && loginResult.error.includes('계정')) {
          errorType = 'ACCOUNT_NOT_FOUND';
          errorMessage = '계정을 찾을 수 없음';
        }
        
        console.log(chalk.red(`  ❌ 로그인 실패: ${errorMessage}`));
        return { 
          success: false, 
          errorType: errorType,
          errorMessage: errorMessage
        };
      }
      
      console.log(chalk.green('  ✅ Google 로그인 성공'));
      
      // 로그인 성공 후 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: 'login_final_success',
        category: 'login',
        profileName: account.email,
        description: 'Google 로그인 완료'
      });
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Google login failed', error);
      console.log(chalk.red(`  ❌ 로그인 중 오류: ${error.message}`));
      
      // 예외에서도 reCAPTCHA 확인
      if (error.message && error.message.includes('recaptcha')) {
        return { 
          success: false, 
          errorType: 'RECAPTCHA_DETECTED',
          errorMessage: 'reCAPTCHA 감지'
        };
      }
      
      return { 
        success: false, 
        errorType: 'LOGIN_ERROR',
        errorMessage: error.message 
      };
    }
  }

  /**
   * YouTube 쿠키 동의 처리
   */
  async handleCookieConsent(page, profileName = 'unknown') {
    try {
      console.log(chalk.yellow('  🍪 쿠키 동의 처리 시작'));
      
      // 쿠키 동의 페이지 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: 'cookie_consent_page',
        category: 'family-check',
        profileName,
        description: 'YouTube 쿠키 동의 페이지'
      });
      
      // "Accept all" 버튼 찾기 및 클릭
      const buttons = await page.$$('button');
      let acceptClicked = false;
      
      for (const button of buttons) {
        const text = await button.evaluate(el => el.textContent || '');
        if (text.toLowerCase().includes('accept all') || 
            text.includes('모두 수락') || 
            text.includes('전체 동의')) {
          console.log(chalk.green(`  ✅ Accept 버튼 발견: "${text.trim()}"`));
          await button.click();
          acceptClicked = true;
          break;
        }
      }
      
      if (!acceptClicked) {
        // 다른 선택자 시도
        const acceptSelectors = [
          'button[aria-label*="Accept all"]',
          'button[aria-label*="accept all"]',
          '[jsname*="accept"]'
        ];
        
        for (const selector of acceptSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              await button.click();
              console.log(chalk.green(`  ✅ Accept 버튼 클릭: ${selector}`));
              acceptClicked = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (acceptClicked) {
        console.log(chalk.green('  ✅ 쿠키 동의 완료'));
        await this.delay(3000);
        
        // 쿠키 동의 후 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: 'after_cookie_consent',
          category: 'family-check',
          profileName,
          description: '쿠키 동의 후 페이지'
        });
        
        return true;
      } else {
        console.log(chalk.yellow('  ⚠️ Accept 버튼을 찾을 수 없음'));
        return false;
      }
    } catch (error) {
      console.log(chalk.yellow(`  ⚠️ 쿠키 동의 처리 실패: ${error.message}`));
      return false;
    }
  }

  /**
   * 가족요금제 상태 확인 (다국어 지원 강화)
   */
  async checkFamilyPlanStatus(page) {
    try {
      // 페이지 로드 완료 대기
      await this.delay(3000);
      
      // 현재 페이지 URL 확인
      let currentUrl = page.url();
      console.log(chalk.gray(`  가족요금제 확인 URL: ${currentUrl}`));
      
      // YouTube 쿠키 동의 페이지 처리
      if (currentUrl.includes('consent.youtube.com')) {
        console.log(chalk.yellow('  🍪 YouTube 쿠키 동의 페이지 감지'));
        
        // handleCookieConsent 메서드 호출
        const consentHandled = await this.handleCookieConsent(page, page.profileName || 'unknown');
        
        if (consentHandled) {
          // 페이지 로드 대기
          await this.delay(5000);
          
          // URL이 변경되었는지 확인
          currentUrl = page.url();
          console.log(chalk.gray(`  리다이렉트 후 URL: ${currentUrl}`));
        } else {
          console.log(chalk.yellow('  ⚠️ 쿠키 동의 처리 실패 - 계속 진행'));
        }
      }
      
      // 가족요금제 확인 페이지 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: 'family_plan_check',
        category: 'family-check',
        profileName: page.profileName || 'unknown',
        description: '가족요금제 상태 확인 페이지'
      });
      
      // 페이지 전체 텍스트 가져오기
      const pageText = await page.evaluate(() => document.body.innerText || '');
      
      // 1. 가족요금제 가격 체크 (다양한 통화 지원)
      const familyPlanPrices = [
        // 파키스탄 루피 (PKR)
        'PKR 899', 'PKR 899.00', 'Rs 899', 'Rs. 899', '899.00/month', '899/month',
        
        // 미국 달러 (USD) - 미국 프록시
        'USD 22.99', 'US$22.99', '$22.99', '22.99/month', '22.99 USD', 'US$ 22.99',
        'USD22.99', 'US $22.99', '$ 22.99', '22.99 per month',
        
        // 한국 원 (KRW)
        '₩14,500', 'KRW 14,500', '14,500원', '14500원',
        
        // 일본 엔 (JPY)
        '¥1,780', 'JPY 1,780', '1,780円', '1780円',
        
        // 유로 (EUR)
        '€17.99', 'EUR 17.99', '17.99 EUR', '17,99 €',
        
        // 영국 파운드 (GBP)
        '£16.99', 'GBP 16.99', '16.99 GBP',
        
        // 브라질 레알 (BRL)
        'R$ 34,90', 'BRL 34.90', 'R$34,90',
        
        // 인도 루피 (INR)
        '₹149', 'INR 149', 'Rs. 149',
        
        // 터키 리라 (TRY)
        '₺159.99', 'TRY 159.99', '159,99 TL',
        
        // 멕시코 페소 (MXN)
        'MX$179', 'MXN 179', '$179 MXN',
        
        // 인도네시아 루피아 (IDR)
        'Rp 79,000', 'IDR 79,000', 'Rp79.000'
      ];
      
      let hasFamilyPrice = false;
      let detectedPrice = null;
      for (const price of familyPlanPrices) {
        if (pageText.includes(price)) {
          console.log(chalk.green(`  ✅ 가족요금제 가격 발견: "${price}"`));
          hasFamilyPrice = true;
          detectedPrice = price;
          break;
        }
      }
      
      // 2. 개인 요금제 가격 체크 (반대 지표)
      const individualPlanPrices = [
        // 파키스탄 루피
        'PKR 479', 'PKR 479.00', 'Rs 479', 'Rs. 479', '479.00/month', '479/month',
        
        // 미국 달러
        'USD 13.99', 'US$13.99', '$13.99', '13.99/month', '13.99 USD',
        'USD13.99', 'US $13.99', '$ 13.99', '13.99 per month',
        
        // 한국 원
        '₩10,900', 'KRW 10,900', '10,900원', '10900원',
        
        // 일본 엔
        '¥1,180', 'JPY 1,180', '1,180円',
        
        // 유로
        '€11.99', 'EUR 11.99', '11,99 €',
        
        // 영국 파운드
        '£10.99', 'GBP 10.99'
      ];
      
      let hasIndividualPrice = false;
      for (const price of individualPlanPrices) {
        if (pageText.includes(price)) {
          console.log(chalk.yellow(`  ⚠️ 개인 요금제 가격 발견: "${price}"`));
          hasIndividualPrice = true;
          break;
        }
      }
      
      // 3. "6 accounts" 관련 텍스트 확인 (다국어)
      const sixAccountsPatterns = [
        // 영어
        '6 accounts', '6 account', 'six accounts', 'up to 6', 'Up to 6',
        '6 members', '6 people', '6 household members',
        
        // 한국어
        '6개 계정', '최대 6명', '6명까지', '가족 구성원 6명',
        
        // 스페인어
        '6 cuentas', 'hasta 6', '6 miembros',
        
        // 프랑스어
        '6 comptes', "jusqu'à 6", '6 membres',
        
        // 포르투갈어
        '6 contas', 'até 6', '6 membros',
        
        // 독일어
        '6 Konten', 'bis zu 6', '6 Mitglieder',
        
        // 이탈리아어
        '6 account', 'fino a 6', '6 membri',
        
        // 러시아어
        '6 аккаунтов', 'до 6', '6 участников',
        
        // 일본어
        '6アカウント', '最大6人', '6人まで',
        
        // 중국어
        '6个账户', '最多6人', '6位成员',
        
        // 베트남어
        '6 tài khoản', 'tối đa 6', '6 thành viên',
        
        // 태국어
        '6 บัญชี', 'สูงสุด 6',
        
        // 인도네시아어
        '6 akun', 'hingga 6', '6 anggota',
        
        // 터키어
        '6 hesap', 'en fazla 6',
        
        // 우르두어
        '6 اکاؤنٹس', '۶ اکاؤنٹس', 'چھ اکاؤنٹس',
        
        // 아랍어
        '6 حسابات', 'حتى 6',
        
        // 힌디어
        '6 खाते', '6 सदस्य',
        
        // 5 members (이전 버전 호환)
        '5 family members', 'up to 5 family members'
      ];
      
      let hasSixAccounts = false;
      for (const pattern of sixAccountsPatterns) {
        if (pageText.includes(pattern)) {
          console.log(chalk.green(`  ✅ 가족 계정 텍스트 발견: "${pattern}"`));
          hasSixAccounts = true;
          break;
        }
      }
      
      // 4. Family 키워드 확인 (다국어)
      const familyKeywords = [
        // 영어
        'Family plan', 'family plan', 'Family Plan', 'FAMILY PLAN', 'Family', 'family',
        
        // 한국어
        '가족 요금제', '가족요금제', '패밀리 플랜', '패밀리', '가족',
        
        // 스페인어
        'Plan familiar', 'plan familiar', 'Familiar', 'familiar',
        
        // 프랑스어
        'Forfait Famille', 'forfait famille', 'Famille', 'famille',
        
        // 포르투갈어
        'Plano família', 'plano família', 'Família', 'família',
        
        // 독일어
        'Familienabo', 'Familien-Abo', 'Familie',
        
        // 이탈리아어
        'Piano famiglia', 'piano famiglia', 'Famiglia', 'famiglia',
        
        // 러시아어
        'Семейная подписка', 'семейная подписка', 'Семейный', 'семейный',
        
        // 일본어
        'ファミリープラン', 'ファミリー', '家族プラン',
        
        // 중국어
        '家庭方案', '家庭计划', '家人共享',
        
        // 베트남어
        'Gói gia đình', 'gói gia đình', 'Gia đình',
        
        // 태국어
        'แผนครอบครัว', 'ครอบครัว',
        
        // 인도네시아어
        'Paket Keluarga', 'paket keluarga', 'Keluarga',
        
        // 터키어
        'Aile planı', 'aile planı', 'Aile',
        
        // 폴란드어
        'Plan rodzinny', 'plan rodzinny', 'Rodzina',
        
        // 네덜란드어
        'Gezinsabonnement', 'gezinsabonnement', 'Gezin',
        
        // 스웨덴어
        'Familjeplan', 'familjeplan', 'Familj',
        
        // 우르두어
        'خاندانی', 'فیملی', 'عائلی',
        
        // 아랍어
        'خطة العائلة', 'العائلة',
        
        // 힌디어
        'परिवार योजना', 'परिवार'
      ];
      
      let hasFamilyKeyword = false;
      for (const keyword of familyKeywords) {
        if (pageText.includes(keyword)) {
          console.log(chalk.green(`  ✅ Family 키워드 발견: "${keyword}"`));
          hasFamilyKeyword = true;
          break;
        }
      }
      
      // 5. 가족요금제 버튼/링크 확인
      const familyPlanButtons = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a, [role="button"]');
        const familyTexts = [
          'Get Family plan',
          'Try Family plan',
          'Start Family plan',
          'Choose Family plan',
          'Family',
          'family',
          'اہل خانہ',         // Family in Urdu
          'خاندان'            // Family in Urdu
        ];
        
        for (const btn of buttons) {
          const text = btn.textContent || btn.innerText || '';
          for (const familyText of familyTexts) {
            if (text.includes(familyText)) {
              return text;
            }
          }
        }
        return null;
      });
      
      if (familyPlanButtons) {
        console.log(chalk.green(`  ✅ 가족요금제 버튼 발견: "${familyPlanButtons}"`));
      }
      
      // 6. 최종 판단 로직
      console.log(chalk.gray('  📊 페이지 분석 결과:'));
      console.log(chalk.gray(`     - URL: ${currentUrl}`));
      console.log(chalk.gray(`     - 가족 가격 감지: ${hasFamilyPrice} ${detectedPrice ? `(${detectedPrice})` : ''}`));
      console.log(chalk.gray(`     - 개인 가격 감지: ${hasIndividualPrice}`));
      console.log(chalk.gray(`     - 6개 계정 텍스트: ${hasSixAccounts}`));
      console.log(chalk.gray(`     - Family 키워드: ${hasFamilyKeyword}`));
      console.log(chalk.gray(`     - Family 버튼: ${!!familyPlanButtons}`));
      
      // 판단 기준:
      // 1. 가족 요금제 가격이 있으면 가족 요금제 (USD 22.99, PKR 899 등)
      // 2. 개인 요금제 가격만 있고 family 키워드가 없으면 개인 요금제
      // 3. 6 accounts 텍스트가 있으면 가족 요금제
      // 4. Family 키워드나 버튼이 있으면 가족 요금제
      
      if (hasFamilyPrice) {
        console.log(chalk.green(`  ✅ 가족요금제 사용 가능 (${detectedPrice} 가격 확인)`));
        // 가족요금제 발견 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: 'family_plan_found_price',
          category: 'family-check',
          profileName: page.profileName || 'unknown',
          description: `가족요금제 확인 - ${detectedPrice} 가격 발견`
        });
        return true;
      }
      
      if (hasSixAccounts) {
        console.log(chalk.green('  ✅ 가족요금제 사용 가능 (6개 계정 확인)'));
        // 가족요금제 발견 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: 'family_plan_found_accounts',
          category: 'family-check',
          profileName: page.profileName || 'unknown',
          description: '가족요금제 확인 - 6개 계정 텍스트 발견'
        });
        return true;
      }
      
      if (hasFamilyKeyword || familyPlanButtons) {
        console.log(chalk.green('  ✅ 가족요금제 사용 가능 (Family 키워드/버튼 확인)'));
        // 가족요금제 발견 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: 'family_plan_found_keyword',
          category: 'family-check',
          profileName: page.profileName || 'unknown',
          description: '가족요금제 확인 - Family 키워드/버튼 발견'
        });
        return true;
      }
      
      if (hasIndividualPrice && !hasFamilyPrice && !hasFamilyKeyword && !hasSixAccounts) {
        console.log(chalk.yellow('  ❌ 개인 요금제만 사용 가능'));
        // 개인 요금제만 있는 경우 스크린샷
        await this.screenshotDebug.captureDebugScreenshot(page, {
          step: 'individual_plan_only',
          category: 'family-check',
          profileName: page.profileName || 'unknown',
          description: '개인 요금제만 확인'
        });
        return false;
      }
      
      // 명확한 지표가 없는 경우
      console.log(chalk.yellow('  ❌ 가족요금제 없음으로 판단'));
      // 가족요금제 없음 스크린샷
      await this.screenshotDebug.captureDebugScreenshot(page, {
        step: 'no_family_plan',
        category: 'family-check',
        profileName: page.profileName || 'unknown',
        description: '가족요금제 확인 불가 - 명확한 지표 없음'
      });
      return false;
      
    } catch (error) {
      this.logger.error('Family plan status check failed', error);
      return false;
    }
  }

  /**
   * Google Sheets 업데이트 (E열: AdsPower 프로필 고유번호, F열: AdsPower ID, G열: 상태)
   */
  async updateGoogleSheets(account, profileSerialNumber, adsPowerId, statusDetail) {
    try {
      if (!this.familySheets) {
        console.log(chalk.yellow('⚠️ Google Sheets 연결 없음 (Mock 모드)'));
        return;
      }

      // 계정의 행 번호 찾기 (rowIndex를 rowNumber로 매핑)
      const rowNumber = account.rowNumber || account.rowIndex || account.row;
      
      if (!rowNumber) {
        console.log(chalk.yellow('⚠️ 행 번호를 찾을 수 없음'));
        return;
      }

      // E열(5번째): acc_id
      // F열(6번째): profile id  
      // G열(7번째): 상태
      
      // 컬럼 문자 매핑 (A=1, B=2, ..., E=5, F=6, G=7)
      const columnLetters = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
      
      // 각 셀을 개별적으로 업데이트
      // E열: AdsPower 프로필 고유번호 (serial_number)
      if (profileSerialNumber) {
        const cellE = `E${rowNumber}`;
        await this.familySheets.updateCell(cellE, profileSerialNumber || '0');
        console.log(chalk.gray(`   - E${rowNumber} (프로필 고유번호): ${profileSerialNumber}`));
      }
      
      // F열: AdsPower 프로필 ID
      if (adsPowerId) {
        const cellF = `F${rowNumber}`;
        await this.familySheets.updateCell(cellF, adsPowerId || '');
        console.log(chalk.gray(`   - F${rowNumber} (AdsPower ID): ${adsPowerId}`));
      }
      
      // G열: 상태
      if (statusDetail) {
        const cellG = `G${rowNumber}`;
        await this.familySheets.updateCell(cellG, statusDetail || '');
        console.log(chalk.gray(`   - G${rowNumber} (상태): ${statusDetail.substring(0, 50)}...`));
      }

      console.log(chalk.green('✅ Google Sheets 업데이트 완료'));
      console.log(chalk.gray(`   - 행: ${rowNumber}`));

    } catch (error) {
      console.log(chalk.red('❌ Google Sheets 업데이트 실패:', error.message));
      // 상세 에러 로그
      if (error.response && error.response.data) {
        console.log(chalk.red('   상세 에러:', JSON.stringify(error.response.data, null, 2)));
      }
      // 업데이트 실패해도 계속 진행
    }
  }

  /**
   * Google Sheets에서 계정 정보 로드
   */
  async loadFamilyPlanAccounts() {
    // Mock 모드 체크
    if (process.env.USE_MOCK_REPOSITORY === 'true') {
      console.log(chalk.yellow('📋 Mock 모드 - 테스트 데이터 사용'));
      return [
        {
          email: 'test1@gmail.com',
          password: 'password123',
          recoveryEmail: 'recovery1@gmail.com',
          totpSecret: 'JBSWY3DPEHPK3PXP',
          code: 'JBSWY3DPEHPK3PXP',
          acc_id: '',
          profileId: '',
          status: '',
          rowNumber: 2,  // 행 번호 추가
          rowIndex: 2
        },
        {
          email: 'test2@gmail.com',
          password: 'password456',
          recoveryEmail: 'recovery2@gmail.com',
          totpSecret: 'KRSXG5CTMVRXEZLU',
          code: 'KRSXG5CTMVRXEZLU',
          acc_id: '',
          profileId: '',
          status: '',
          rowNumber: 3,  // 행 번호 추가
          rowIndex: 3
        }
      ];
    }
    
    // FamilyPlanSheetRepository 사용
    if (this.familySheets) {
      try {
        await this.familySheets.initialize();
        const accounts = await this.familySheets.getAllAccounts();
        
        return accounts.map(acc => ({
          email: acc.email,
          password: acc.password,
          recoveryEmail: acc.recoveryEmail,
          totpSecret: acc.totpSecret || acc.code,  // D열: TOTP Secret
          code: acc.totpSecret || acc.code,        // 호환성을 위해 code도 설정
          acc_id: acc.accId,                       // E열: AdsPower Account ID
          profileId: acc.profileId,                 // F열: AdsPower Profile ID
          status: acc.status,                       // G열: 상태
          rowNumber: acc.rowNumber,  // 행 번호 추가
          rowIndex: acc.rowNumber
        }));
      } catch (error) {
        this.logger.error('Failed to load from FamilyPlanSheetRepository', error);
      }
    }
    
    // 기본 GoogleSheetsRepository 사용
    if (this.sheets) {
      try {
        await this.sheets.initialize();
        const profiles = await this.sheets.getProfiles('가족요금제');
        
        return profiles.map((profile, index) => ({
          email: profile.email || profile['이메일'],
          password: profile.password || profile['비밀번호'],
          recoveryEmail: profile.recoveryEmail || profile['복구이메일'],
          totpSecret: profile.totpSecret || profile.code || profile['코드'],
          code: profile.totpSecret || profile.code || profile['코드'],
          acc_id: profile.acc_id || '',
          profileId: profile.profileId || '',
          status: profile.status || '',
          rowNumber: index + 2,  // 행 번호 추가
          rowIndex: index + 2
        }));
      } catch (error) {
        this.logger.error('Failed to load from GoogleSheetsRepository', error);
      }
    }
    
    throw new Error('No repository available for loading family plan accounts');
  }

  /**
   * Google Sheets 업데이트 (Deprecated - updateGoogleSheets 사용)
   * @deprecated processAccount 내부에서 updateGoogleSheets를 직접 호출하므로 사용하지 않음
   */
  // async updateAccountStatus(account, result) {
  //   // 이 메서드는 중복 업데이트를 방지하기 위해 사용하지 않습니다
  //   // processAccount 내부에서 updateGoogleSheets를 직접 호출합니다
  // }

  /**
   * 결과 요약 출력
   */
  printSummary(results, keepCount, deleteCount) {
    console.log(chalk.cyan('\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('📊 가족요금제 검증 결과 요약'));
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.white(`총 처리: ${results.length}개 계정`));
    console.log(chalk.green(`✅ 가족요금제 활성 (유지): ${keepCount}개`));
    console.log(chalk.yellow(`⚠️ 가족요금제 없음 (삭제): ${deleteCount}개`));
    console.log(chalk.red(`❌ 오류: ${results.filter(r => r.status === 'ERROR').length}개`));
    console.log(chalk.cyan('='.repeat(60) + '\n'));
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = EnhancedFamilyPlanCheckUseCase;