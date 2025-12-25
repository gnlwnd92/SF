/**
 * Enhanced Pause Subscription Use Case
 * 다국어 지원 및 개선된 일시중지 워크플로우
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const GoogleLoginHelper = require('../../infrastructure/adapters/GoogleLoginHelperUltimate');
const ImprovedAuthenticationService = require('../../services/ImprovedAuthenticationService');
const ImprovedAccountChooserHandler = require('../../services/ImprovedAccountChooserHandler');
const { languages, detectLanguage } = require('../../infrastructure/config/multilanguage');
const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
const PageStateAnalyzer = require('../../services/PageStateAnalyzer');
const NavigationStrategy = require('../../services/NavigationStrategy');
// 프록시 풀 설정 추가
const { getRandomProxy, getProxyPoolStatus } = require('../../infrastructure/config/proxy-pools');
// Frame 안전성 처리를 위한 헬퍼 추가
const FrameSafetyHandler = require('../../utils/FrameSafetyHandler');
const SafeClickWrapper = require('../../utils/SafeClickWrapper');

class EnhancedPauseSubscriptionUseCase {
  constructor({
    adsPowerAdapter,
    youtubeAdapter,
    profileRepository,
    pauseSheetRepository,
    logger,
    config,  // config 파라미터 추가
    sessionLogger,  // 세션 로거 추가
    detailedErrorLogger,  // 상세 에러 로거 추가
    dateParser,  // 날짜 파싱 서비스 추가
    buttonService,  // ButtonInteractionService 추가
    mappingService  // ProfileMappingService 추가
  }) {
    // config를 먼저 저장 (다른 초기화에서 사용하기 위해)
    this.config = config || {};

    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubeAdapter = youtubeAdapter;
    this.profileRepository = profileRepository;
    this.pauseSheetRepository = pauseSheetRepository;
    this.logger = logger || console;
    this.sessionLogger = sessionLogger;  // 세션 로거 저장
    this.detailedErrorLogger = detailedErrorLogger;  // 상세 에러 로거 저장
    this.dateParser = dateParser;  // 날짜 파싱 서비스 저장
    this.buttonService = buttonService;  // ButtonInteractionService 저장
    this.mappingService = mappingService;  // ProfileMappingService 저장
    this.page = null; // 페이지 참조 저장용
    this.currentLanguage = 'en';
    this.pauseInfo = {};
    this.managementPageOpened = false; // 멤버십 관리 페이지 열림 여부 추적
    this.actualProfileId = null;  // 실제 사용된 프로필 ID 추적
    
    // 개선된 인증 서비스 초기화 (계정 선택 페이지 및 2FA 처리)
    this.authService = new ImprovedAuthenticationService({
      debugMode: true,
      maxRetries: 3,
      screenshotEnabled: true,
      humanLikeMotion: true  // 휴먼라이크 마우스 동작 활성화
    });
    
    // 페이지 상태 분석기 및 네비게이션 전략 초기화
    this.pageAnalyzer = new PageStateAnalyzer(logger);
    this.navigationStrategy = new NavigationStrategy(logger);

    // Frame 안전성 처리 헬퍼 초기화
    this.frameSafetyHandler = new FrameSafetyHandler({
      maxRetries: 3,
      retryDelay: 2000,
      stabilityWait: 1500,
      debug: this.config?.debugMode || false  // this.config에서 debugMode 가져오기
    });
  }

  /**
   * 안전한 버튼 클릭 헬퍼
   * Detached Frame 오류를 방지하기 위한 래퍼 메서드
   */
  async safeButtonClick(selector, buttonText = null) {
    try {
      // FrameSafetyHandler를 사용한 안전한 클릭
      return await this.frameSafetyHandler.executeWithFrameSafety(this.page, async () => {
        // 버튼 존재 확인
        const button = await this.page.waitForSelector(selector, {
          state: 'visible',
          timeout: 5000
        }).catch(() => null);

        if (!button) {
          this.log(`버튼을 찾을 수 없음: ${selector}`, 'warning');
          return false;
        }

        // 스크롤 및 클릭
        await this.page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, selector);

        await new Promise(resolve => setTimeout(resolve, 500));

        // 실제 클릭
        await this.page.click(selector);

        if (buttonText) {
          this.log(`버튼 클릭 완료: ${buttonText}`, 'success');
        }

        return true;
      });
    } catch (error) {
      this.log(`버튼 클릭 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 일시중지 워크플로우 실행
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 프로필 데이터 저장 (로그인용)
    this.profileData = options.profileData || {};
    this.debugMode = options.debugMode || false;
    
    // 세션 로거에 프로필 작업 시작 기록
    if (this.sessionLogger) {
      const email = this.profileData?.email || this.profileData?.googleId;
      this.sessionLogger.startProfile(profileId, email);
    }
    
    const result = {
      profileId,
      email: this.profileData?.email || this.profileData?.googleId,
      success: false,
      status: null,
      pauseDate: null,
      resumeDate: null,
      nextBillingDate: null,
      language: null,  // 감지된 언어 (통합워커용)
      error: null,
      duration: 0
    };

    try {
      // 대체 ID 추적 변수 초기화
      this.actualProfileId = null;

      this.log(`프로필 ${profileId} 일시중지 시작`, 'info');
      console.log(chalk.cyan(`📄 [PauseWorkflow] 프로필 ${profileId} 일시중지 시작`));

      // DetailedErrorLogger 초기화
      if (this.detailedErrorLogger) {
        await this.detailedErrorLogger.initialize();
        this.detailedErrorLogger.reset();
      }

      // 1. 브라우저 연결 (대체 ID 지원을 위해 email도 전달)
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('브라우저 연결', {
          profileId,
          email: result.email
        });
      }

      const browser = await this.connectBrowser(profileId, result.email);
      if (!browser) {
        throw new Error('브라우저 연결 실패');
      }
      
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ browserConnected: true });
      }

      // 2. YouTube Premium 페이지 이동
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('YouTube Premium 페이지 이동');
      }

      await this.navigateToPremiumPage(browser);

      // SafeClickWrapper 초기화 (페이지 로드 후)
      this.safeClickWrapper = new SafeClickWrapper(this.page, {
        debug: this.debugMode,
        maxRetries: 3
      });

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ pageNavigated: true });
      }

      // 3. 언어 감지
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('언어 감지');
      }
      
      this.currentLanguage = await this.detectPageLanguage(browser);
      result.language = this.currentLanguage;  // 통합워커용 언어 정보 저장

      // 언어 변형(pt-br, pt-pt)을 안전하게 처리
      const langInfo = languages[this.currentLanguage] || languages['pt'] || { name: this.currentLanguage };
      const displayName = langInfo.name || this.currentLanguage;

      this.log(`감지된 언어: ${displayName}`, 'info');
      console.log(chalk.cyan(`📄 [LanguageDetect] 감지된 언어: ${displayName}`));
      
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ 
          language: this.currentLanguage,
          languageName: displayName 
        });
      }

      // 3-1. 초기 구독 상태 체크 (만료 상태 감지 - 방어적 업데이트)
      // - Inactive Memberships 섹션 확인
      // - "Benefits end:" + "Renew" 버튼 패턴 확인 (만료 예정/만료 상태)
      this.log('초기 구독 상태 확인 중...', 'info');
      // Frame-safe 버튼 서비스 사용
      const EnhancedButtonInteractionService = require('../../services/EnhancedButtonInteractionService');
      const buttonService = new EnhancedButtonInteractionService({
        debugMode: true,
        frameRecoveryEnabled: true
      });
      const initialCheck = await buttonService.checkSubscriptionExpired(this.page, false);

      // 디버그 로깅 - 만료 감지 결과 상세 출력
      console.log(chalk.gray(`📊 [ExpiredCheck] 만료 상태 확인 결과:`));
      console.log(chalk.gray(`  - hasInactiveSection: ${initialCheck.hasInactiveSection}`));
      console.log(chalk.gray(`  - isExpired: ${initialCheck.isExpired}`));
      console.log(chalk.gray(`  - hasBenefitsEnd: ${initialCheck.hasBenefitsEnd}`));
      console.log(chalk.gray(`  - hasRenewButton: ${initialCheck.hasRenewButton}`));
      console.log(chalk.gray(`  - hasPauseButton: ${initialCheck.hasPauseButton}`));
      console.log(chalk.gray(`  - hasResumeButton: ${initialCheck.hasResumeButton}`));
      if (initialCheck.indicator) {
        console.log(chalk.gray(`  - indicator: ${initialCheck.indicator}`));
      }

      // 메인 페이지에서 만료 상태 감지 (확장된 조건)
      // 1. Inactive Memberships 섹션이 있거나
      // 2. Benefits end + Renew 버튼이 있고 Pause 버튼이 없는 경우
      if (initialCheck.isExpired || initialCheck.hasInactiveSection) {
        this.log(`⚠️ 구독이 만료됨 (메인 페이지): ${initialCheck.indicator}`, 'warning');
        console.log(chalk.yellow(`⚠️ [SubscriptionExpired] 메인 페이지에서 만료 감지: ${initialCheck.indicator}`));
        
        // 만료 상태로 바로 처리
        result.status = 'subscription_expired';
        result.error = '구독 만료됨';
        result.success = false;
        
        // Google Sheets 업데이트
        const email = this.profileData?.email || this.profileData?.googleId;
        if (email) {
          console.log(chalk.yellow(`⚠️ [ExpiredUpdate] 만료 상태를 Google Sheets에 기록 중...`));
          
          const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
          const sheetsService = new UnifiedSheetsUpdateService({ 
            debugMode: true,
            spreadsheetId: process.env.GOOGLE_SHEETS_ID
          });
          await sheetsService.initialize();
          
          const updateResult = await sheetsService.updatePauseStatus(email, {
            status: '만료됨',
            error: '❌ 결제 만료됨 - 수동 확인 필요',
            page: this.page,
            detailedResult: `❌ 결제 만료됨 - 수동 확인 필요 ┃ ${new Date().toLocaleTimeString('ko-KR')}`
          });
          
          if (updateResult) {
            console.log(chalk.green(`✅ [ExpiredUpdate] Google Sheets에 만료 상태 기록 완료`));
          }
        }
        
        // 스크린샷 캡처
        await this.captureScreenshot(profileId, result);
        
        // 브라우저 연결 해제
        const profileIdToClose = this.actualProfileId || profileId;
        await this.disconnectBrowser(profileIdToClose);
        
        // 만료 상태로 즉시 반환 (불필요한 재시도 방지)
        result.duration = Math.round((Date.now() - startTime) / 1000);
        this.log(`처리 시간: ${result.duration}초`, 'info');
        
        return result;
      }
      
      // Manage membership 버튼이 있으면 활성 구독으로 간주
      if (initialCheck.hasManageButton) {
        console.log(chalk.green('✅ [SubscriptionActive] Manage membership 버튼 발견 - 활성 구독으로 진행'));
      }

      // 4. 현재 상태 확인
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('현재 구독 상태 확인');
      }
      
      const currentStatus = await this.checkCurrentStatus(browser);
      
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ 
          isPaused: currentStatus.isPaused,
          nextBillingDate: currentStatus.nextBillingDate 
        });
      }
      
      // 이미 일시중지 상태인 경우
      if (currentStatus.isPaused) {
        this.log('이미 일시중지 상태입니다', 'warning');
        result.status = 'already_paused';
        result.success = true;
        
        // 날짜 정보 추출
        if (currentStatus.nextBillingDate) {
          result.nextBillingDate = currentStatus.nextBillingDate; // 이미 파싱됨
          result.resumeDate = currentStatus.nextBillingDate;
        } else if (currentStatus.resumeDate) {
          // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
          if (this.dateParser) {
            result.resumeDate = this.dateParser.parseDate(currentStatus.resumeDate, this.currentLanguage);
          } else {
            // 폴백: 기존 방식 사용
            const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
            const sheetsService = new UnifiedSheetsUpdateService();
            result.resumeDate = sheetsService.parseDate(currentStatus.resumeDate);
          }
          // result.nextBillingDate는 이미 일시정지일이 저장되어 있음
          // result.resumeDate는 재개 예정일로 별도 저장
        }
      } else {
        // checkCurrentStatus에서 얻은 날짜 저장 (일시중지 전)
        this.savedNextBillingDate = currentStatus.nextBillingDate;
        // 5. 일시중지 프로세스 실행
        const pauseResult = await this.executePauseWorkflow(browser);
        
        if (pauseResult.success) {
          result.success = true;
          result.status = 'paused';
          result.pauseDate = pauseResult.pauseDate;
          result.resumeDate = pauseResult.resumeDate;
          
          // 날짜를 올바르게 파싱하여 저장
          // 중요: pauseDate (일시정지일)을 우선적으로 사용
          // 포르투갈어의 경우: pauseDate = "4/10" (일시정지일), resumeDate = "04/11/2025" (재개일)
          // 한국어의 경우: pauseDate = "10월 4일" (일시정지일)
          
          if (pauseResult.pauseDate) {
            // 일시정지일이 있으면 이를 다음 결제일로 사용
            this.log(`📅 팝업에서 추출된 일시정지일: ${pauseResult.pauseDate}`, 'info');
            
            // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
            const parsedDate = this.dateParser ? 
              this.dateParser.parseDate(pauseResult.pauseDate, this.currentLanguage) : 
              (() => {
                const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
                const sheetsService = new UnifiedSheetsUpdateService();
                return sheetsService.parseDate(pauseResult.pauseDate);
              })();
            
            this.log(`✅ 파싱된 다음 결제일 (일시정지일 기준): ${parsedDate}`, 'success');
            result.nextBillingDate = parsedDate || pauseResult.pauseDate;
            
            // resumeDate도 있으면 저장 (참고용)
            if (pauseResult.resumeDate) {
              this.log(`📅 참고: 재개 예정일: ${pauseResult.resumeDate}`, 'info');
              const resumeParsed = this.dateParser ? 
                this.dateParser.parseDate(pauseResult.resumeDate, this.currentLanguage) : 
                pauseResult.resumeDate;
              result.resumeDate = resumeParsed;
            }
            
          } else if (pauseResult.resumeDate) {
            // pauseDate가 없고 resumeDate만 있는 경우 (특수한 경우)
            this.log(`📅 팝업에서 추출된 재개일 (일시정지일 없음): ${pauseResult.resumeDate}`, 'warning');
            
            const parsedDate = this.dateParser ? 
              this.dateParser.parseDate(pauseResult.resumeDate, this.currentLanguage) : 
              (() => {
                const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
                const sheetsService = new UnifiedSheetsUpdateService();
                return sheetsService.parseDate(pauseResult.resumeDate);
              })();
            
            this.log(`⚠️ 재개일을 다음 결제일로 사용: ${parsedDate}`, 'warning');
            result.nextBillingDate = parsedDate || pauseResult.resumeDate;
            result.resumeDate = parsedDate || pauseResult.resumeDate;
            
          } else if (this.savedNextBillingDate) {
            // 팝업에서 날짜를 못 찾았지만 이전에 저장한 날짜가 있으면 사용
            this.log('팝업에서 날짜를 찾지 못함, 이전에 저장한 날짜 사용', 'warning');
            result.nextBillingDate = this.savedNextBillingDate;
            this.log(`저장된 날짜 사용: ${result.nextBillingDate}`, 'info');
          } else {
            this.log('날짜를 찾을 수 없음', 'warning');
            result.nextBillingDate = null;
          }
          
          this.log('일시중지 성공', 'success');
      console.log(chalk.green(`✅ [WorkflowComplete] 일시중지 성공`));
        } else {
          throw new Error(pauseResult.error || '일시중지 실패');
        }
      }

      // 6. Google Sheets 업데이트 (통합 서비스 사용)
      // profileData에서 email 가져오기
      const email = this.profileData?.email || this.profileData?.googleId;
      if (email) {
        // 날짜 디버깅
        console.log(chalk.yellow(`🔍 [DateDebug] Google Sheets 업데이트 시작`));
        console.log(chalk.yellow(`🔍 [DateDebug] nextBillingDate (일시중지일/다음 결제일): ${result.nextBillingDate}`));
        console.log(chalk.yellow(`🔍 [DateDebug] resumeDate (재개 예정일): ${result.resumeDate}`));
        console.log(chalk.yellow(`🔍 [DateDebug] 다음 결제일 필드에 저장할 날짜 (일시중지일): ${result.nextBillingDate}`));
        
        const sheetsService = new UnifiedSheetsUpdateService({ 
          debugMode: true, // 디버그 모드 활성화
          spreadsheetId: process.env.GOOGLE_SHEETS_ID // 올바른 스프레드시트 ID
        });
        await sheetsService.initialize();
        
        // 브라우저의 page 객체를 전달하여 브라우저 IP 가져오기
        // 상세 상태 정보도 함께 전달
        // 중요: 일시정지일(nextBillingDate)을 다음 결제일 필드에 저장
        const updateResult = await sheetsService.updatePauseStatus(email, {
          nextBillingDate: result.nextBillingDate, // 일시정지일(다음 결제일) 저장
          status: '일시중지',
          page: this.page, // 브라우저 page 객체 전달
          isAlreadyPaused: result.status === 'already_paused',
          isNewlyPaused: result.status === 'paused',
          error: result.error,
          detailedResult: this.getDetailedResultMessage(result)
        });
        
        if (updateResult) {
          console.log(chalk.green(`✅ [DateDebug] Google Sheets 업데이트 성공`));
        } else {
          console.log(chalk.red(`❌ [DateDebug] Google Sheets 업데이트 실패`));
        }
      } else {
        this.log('Google Sheets 업데이트 실패: 이메일 정보 없음', 'warning');
      }

      // 7. 스크린샷 캡처 (브라우저 연결 해제 전에 실행)
      await this.captureScreenshot(profileId, result);
      
      // 8. 브라우저 연결 해제 (대체 ID 고려)
      const profileIdToClose = this.actualProfileId || profileId;
      await this.disconnectBrowser(profileIdToClose);

    } catch (error) {
      this.log(`오류 발생: ${error.message}`, 'error');
      result.error = error.message;
      
      // reCAPTCHA 감지된 경우 특별 처리
      if (error.isRecaptcha || error.message === 'RECAPTCHA_DETECTED') {
        this.log('🛑 reCAPTCHA로 인해 건너뜁니다', 'warning');
        result.status = 'recaptcha_detected';  // Resume과 동일한 상태값 사용
        result.error = 'RECAPTCHA_DETECTED';
        result.recaptchaDetected = true;
        result.success = false;
        result.skipToNext = true;  // 다음 계정으로 진행 플래그
        result.skipRetry = true;    // 재시도 방지

        // reCAPTCHA 감지시 스크린샷 저장
        try {
          if (this.page) {
            const screenshotPath = `screenshots/recaptcha_${profileId}_${Date.now()}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(chalk.gray(`  📸 reCAPTCHA 스크린샷: ${screenshotPath}`));
          }
        } catch (e) {
          // 무시
        }
      } else if (error.isCaptcha || error.message === 'IMAGE_CAPTCHA_DETECTED') {
        // ★ 이미지 CAPTCHA 감지된 경우 - 재시도 허용
        this.log('🖼️ 이미지 CAPTCHA로 인해 재시도 필요', 'warning');
        result.status = 'captcha_detected';
        result.error = 'IMAGE_CAPTCHA_DETECTED';
        result.captchaDetected = true;
        result.success = false;
        result.skipToNext = false;  // 재시도 허용
        result.skipRetry = false;   // ★ 재시도 허용
        result.shouldRetry = true;  // ★ 재시도 플래그
        result.retryReason = 'image_captcha';

        // CAPTCHA 감지시 스크린샷 저장
        try {
          if (this.page) {
            const screenshotPath = `screenshots/image_captcha_${profileId}_${Date.now()}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(chalk.gray(`  📸 이미지 CAPTCHA 스크린샷: ${screenshotPath}`));
          }
        } catch (e) {
          // 무시
        }
      } else if (error.message === 'SUBSCRIPTION_EXPIRED' || error.message === 'MEMBERSHIP_EXPIRED') {
        // 구독 만료된 경우 특별 처리
        result.status = 'membership_expired';
        result.error = '만료된 계정';
        result.success = false;
      } else {
        result.status = 'error';
      }
      
      // 실패 시에도 Google Sheets 업데이트 (중요!)
      const email = this.profileData?.email || this.profileData?.googleId;
      if (email) {
        console.log(chalk.yellow(`⚠️ [Error] 실패한 작업에 대해 Google Sheets 업데이트 중...`));
        
        try {
          const sheetsService = new UnifiedSheetsUpdateService({ 
            debugMode: true,
            spreadsheetId: process.env.GOOGLE_SHEETS_ID
          });
          await sheetsService.initialize();
          
          // 실패 상태 업데이트 (구독 만료, reCAPTCHA, 이미지 CAPTCHA 특별 처리)
          let statusToUpdate = '오류';
          let errorMessage = `❌ 실패: ${result.error}`;

          if (result.status === 'subscription_expired' || result.status === 'membership_expired') {
            statusToUpdate = '만료됨';
            errorMessage = '❌ 만료된 계정';
          } else if (result.status === 'recaptcha_detected' || result.recaptchaDetected) {
            statusToUpdate = '번호인증필요';
            errorMessage = '🔐 번호인증계정 - reCAPTCHA 감지됨';
          } else if (result.status === 'captcha_detected' || result.captchaDetected || result.shouldRetry) {
            // ★ 이미지 CAPTCHA는 재시도 중이므로 Sheets 업데이트하지 않음
            statusToUpdate = null;  // 업데이트 건너뛰기
            errorMessage = null;
            console.log(chalk.yellow('  ⏭️ 이미지 CAPTCHA - 재시도 예정이므로 Sheets 업데이트 건너뜀'));
          }
          
          // ★ statusToUpdate가 null이면 Sheets 업데이트 건너뛰기 (이미지 CAPTCHA 재시도 시)
          if (statusToUpdate !== null) {
            const updateResult = await sheetsService.updatePauseStatus(email, {
              status: statusToUpdate,
              error: errorMessage,
              page: this.page,
              detailedResult: this.getDetailedResultMessage(result)
            });

            if (updateResult) {
              console.log(chalk.green(`✅ [Error] Google Sheets에 실패 상태 기록 완료`));
            } else {
              console.log(chalk.red(`❌ [Error] Google Sheets 실패 상태 기록 실패`));
            }
          }
        } catch (sheetsError) {
          console.log(chalk.red(`❌ [Error] Google Sheets 업데이트 중 오류: ${sheetsError.message}`));
        }
      }
      
      // 스크린샷 시도 (오류 발생 시에도, 브라우저 연결 해제 전에)
      try {
        await this.captureScreenshot(profileId, result);
      } catch (e) {
        this.log(`스크린샷 캡처 실패: ${e.message}`, 'warning');
      }
      
      // 브라우저 연결 해제 시도 (대체 ID 고려)
      try {
        const profileIdToClose = this.actualProfileId || profileId;
        await this.disconnectBrowser(profileIdToClose);
      } catch (e) {
        // 무시
      }
    }

    result.duration = Math.round((Date.now() - startTime) / 1000);
    
    // 결과 반환 전에 날짜가 올바르게 파싱되었는지 확인
    if (result.nextBillingDate && typeof result.nextBillingDate === 'string') {
      // 이미 파싱된 형식인지 확인 (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(result.nextBillingDate)) {
        // 파싱되지 않았다면 다시 파싱
        // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
        const parsedDate = this.dateParser ? 
          this.dateParser.parseDate(result.nextBillingDate, this.currentLanguage) : 
          (() => {
            const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
            const sheetsService = new UnifiedSheetsUpdateService();
            return sheetsService.parseDate(result.nextBillingDate);
          })();
        if (parsedDate !== result.nextBillingDate) {
          this.log(`날짜 재파싱: ${result.nextBillingDate} → ${parsedDate}`, 'info');
          result.nextBillingDate = parsedDate;
        }
      }
    }
    
    this.log(`처리 시간: ${result.duration}초`, 'info');
    console.log(chalk.cyan(`📄 [Performance] 처리 시간: ${result.duration}초`));

    // 세션 로거에 프로필 작업 완료 기록
    if (this.sessionLogger) {
      this.sessionLogger.endProfile(profileId, result);
    }
    
    // DetailedErrorLogger 리포트 생성 (성공/실패 모두)
    if (this.detailedErrorLogger) {
      const report = this.detailedErrorLogger.generateErrorReport();
      if (report.failedSteps > 0 || !result.success) {
        console.log(chalk.yellow('\n📊 단계별 실행 요약:'));
        console.log(chalk.yellow(`  전체 단계: ${report.totalSteps}`));
        console.log(chalk.green(`  성공 단계: ${report.successfulSteps}`));
        console.log(chalk.red(`  실패 단계: ${report.failedSteps}`));
        if (report.lastFailedStep) {
          console.log(chalk.red(`  마지막 실패: ${report.lastFailedStep.name}`));
        }
      }
    }

    return result;
  }

  /**
   * 상세 결과 메시지 생성
   */
  getDetailedResultMessage(result) {
    const now = new Date();
    const timeStr = now.toLocaleString('ko-KR', { 
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    const dateStr = now.toLocaleDateString('ko-KR');
    const lang = languages[this.currentLanguage]?.name || '알 수 없음';
    
    if (result.status === 'already_paused') {
      // 이미 일시중지 상태인 경우
      const resumeDate = result.resumeDate || result.nextBillingDate || 'N/A';
      return `✅ 이미 일시중지됨 ┃ 언어: ${lang} ┃ 재개예정: ${resumeDate} ┃ ${timeStr}`;
    } else if (result.status === 'paused') {
      // 새로 일시중지한 경우
      const resumeDate = result.resumeDate || result.nextBillingDate || 'N/A';
      return `🆕 신규 일시중지 성공 ┃ 언어: ${lang} ┃ 재개예정: ${resumeDate} ┃ ${timeStr}`;
    } else if (result.status === 'subscription_expired' || result.status === 'membership_expired') {
      // 구독이 만료된 경우
      return `❌ 만료된 계정 ┃ ${timeStr}`;
    } else if (result.error) {
      // 오류가 있는 경우
      return `❌ 실패: ${result.error} ┃ ${timeStr}`;
    } else {
      // 기본 성공 메시지
      return `✅ 성공 ┃ 언어: ${lang} ┃ ${timeStr} ┃ ${dateStr}`;
    }
  }

  /**
   * 대체 AdsPower ID 찾기 (Google Sheets 기반)
   * '애즈파워현황' 시트의 D열(이메일)에서 매칭되는 B열(AdsPower ID) 찾기
   */
  async findAlternativeAdsPowerIds(email) {
    try {
      console.log(chalk.cyan(`\n🔍 대체 AdsPower ID 검색 시작...`));
      console.log(chalk.gray(`  이메일: ${email}`));

      const alternativeIds = [];

      // 방법 1: ProfileMappingService 사용 (캐시된 데이터)
      if (this.mappingService) {
        console.log(chalk.gray('  방법 1: ProfileMappingService 사용'));
        const mappedIds = this.mappingService.getAdsPowerIdsByEmail(email);
        if (mappedIds && mappedIds.length > 0) {
          console.log(chalk.green(`  ✅ 매핑 서비스에서 ${mappedIds.length}개 ID 발견`));
          // 중복 제거하면서 추가
          for (const id of mappedIds) {
            if (!alternativeIds.includes(id)) {
              alternativeIds.push(id);
            }
          }
        } else {
          console.log(chalk.yellow('  ⚠️ 매핑 서비스에서 ID를 찾을 수 없습니다'));
        }
      }

      // 방법 2: pauseSheetRepository 직접 사용 (Google Sheets)
      if (!this.pauseSheetRepository) {
        console.log(chalk.gray('  Google Sheets 연결 없음'));
        return alternativeIds;
      }

      console.log(chalk.gray('  방법 2: Google Sheets에서 직접 검색'));

      // pauseSheetRepository가 초기화되지 않았으면 초기화
      if (!this.pauseSheetRepository.initialized && this.pauseSheetRepository.initialize) {
        try {
          await this.pauseSheetRepository.initialize();
        } catch (initError) {
          console.log(chalk.yellow(`  ⚠️ Repository 초기화 실패: ${initError.message}`));
        }
      }

      // auth가 없으면 직접 인증 시도
      if (!this.pauseSheetRepository.auth) {
        try {
          const { google } = require('googleapis');
          const fs = require('fs').promises;
          const path = require('path');

          // Service Account 파일 경로 확인
          const serviceAccountPath = this.pauseSheetRepository.serviceAccountPath ||
                                    path.join(__dirname, '..', '..', '..', 'service_account.json');

          const keyFile = await fs.readFile(serviceAccountPath, 'utf8');
          const serviceAccount = JSON.parse(keyFile);

          // JWT 클라이언트 생성
          const auth = new google.auth.JWT(
            serviceAccount.client_email,
            null,
            serviceAccount.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
          );

          await auth.authorize();
          this.pauseSheetRepository.auth = auth;
          console.log(chalk.gray('  ✅ Google Sheets 인증 성공'));
        } catch (authError) {
          console.log(chalk.red(`  ❌ Google Sheets 인증 실패: ${authError.message}`));
          return [];
        }
      }

      const { google } = require('googleapis');
      const sheets = google.sheets({ version: 'v4', auth: this.pauseSheetRepository.auth });

      // 애즈파워현황 시트에서 데이터 가져오기
      console.log(chalk.gray('  "애즈파워현황" 시트에서 이메일 매칭 검색 중...'));
      console.log(chalk.yellow(`  🔍 검색할 이메일: "${email}" (정규화 전)`));
      console.log(chalk.yellow(`  🔍 정규화된 이메일: "${email.toLowerCase().trim()}"`));;

      // 전체 시트를 가져오기 위해 범위를 지정하지 않음
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.pauseSheetRepository.spreadsheetId,
        range: '애즈파워현황' // 범위 제한 없이 전체 시트 가져오기
      });

      const rows = response.data.values || [];

      console.log(chalk.cyan(`  📊 전체 데이터: ${rows.length}개 행 검색`));

      // 헤더 행 확인 (첫 번째 행)
      if (rows.length > 0) {
        const headers = rows[0];
        console.log(chalk.gray('  📋 컬럼 구조:'));
        headers.forEach((header, idx) => {
          if (idx < 5) { // A~E열만 표시
            const columnLetter = String.fromCharCode(65 + idx); // A, B, C, D, E
            console.log(chalk.gray(`    ${columnLetter}열(${idx}): ${header}`));
          }
        });
      }

      // '애즈파워현황' 시트에서 D열(이메일)로 매칭되는 B열(AdsPower ID) 찾기
      // 시트 구조:
      // A열(0): 애즈파워번호
      // B열(1): 애즈파워아이디 ← 이것을 찾아서 사용
      // C열(2): group
      // D열(3): 아이디(이메일) ← 이것으로 매칭
      // E열(4): 비밀번호

      let matchCount = 0;
      let debugLogCount = 0;
      const searchEmail = email.toLowerCase().trim();

      // 헤더 행 건너뛰고 데이터 행부터 시작 (i=1)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 4) continue;

        const rowEmail = row[3]?.toString().trim().toLowerCase(); // D열 - 이메일
        const adsPowerId = row[1]?.toString().trim(); // B열 - AdsPower ID

        // 디버깅: 처음 5개와 타겟 이메일과 유사한 이메일만 로그
        if (debugLogCount < 5 || (rowEmail && rowEmail.includes('wowuneja'))) {
          console.log(chalk.gray(`    행 ${i+1}: D열="${rowEmail}" vs 검색="${searchEmail}" (일치: ${rowEmail === searchEmail})`));
          debugLogCount++;
        }

        // 이메일 매칭 확인 (정확히 일치)
        if (rowEmail && rowEmail === searchEmail) {
          matchCount++;
          console.log(chalk.green(`  ✅ 매칭 발견! 행 ${i+1}: ${rowEmail} → AdsPower ID: ${adsPowerId}`));

          if (adsPowerId && adsPowerId !== '' && adsPowerId !== 'undefined' && adsPowerId !== 'null') {
            // AdsPower ID 유효성 체크 (패스워드가 아닌지 확인)
            const passwordPattern = /[!@#$%^&*(),.?":{}|<>]/;
            if (passwordPattern.test(adsPowerId)) {
              console.log(chalk.red(`    ⚠️ AdsPower ID가 패스워드로 보임 (특수문자 포함): ${adsPowerId.substring(0, 5)}...`));
            } else if (!alternativeIds.includes(adsPowerId)) {
              alternativeIds.push(adsPowerId);
              console.log(chalk.cyan(`    → 대체 ID로 추가: ${adsPowerId}`));
            } else {
              console.log(chalk.gray(`    → 이미 추가된 ID: ${adsPowerId}`));
            }
          } else {
            console.log(chalk.yellow(`    ⚠️ AdsPower ID가 비어있거나 유효하지 않음: "${adsPowerId}"`));
          }
        }
      }

      // 검색 결과 요약
      console.log(chalk.cyan(`\n  📊 Google Sheets 검색 완료:`));
      console.log(chalk.gray(`    - 검색한 이메일: ${searchEmail}`));
      console.log(chalk.gray(`    - 검색한 총 행수: ${rows.length - 1}개 (헤더 제외)`));
      console.log(chalk.gray(`    - 매칭된 행: ${matchCount}개`));
      console.log(chalk.gray(`    - 발견된 고유 ID: ${alternativeIds.filter(id => id).length}개`));

      // wowuneja89 관련 추가 디버깅
      if (searchEmail.includes('wowuneja89')) {
        console.log(chalk.yellow('\n  🔍 wowuneja89 이메일 디버깅:'));
        let foundWowuneja = false;
        for (let i = 1; i < Math.min(rows.length, 2000); i++) {
          const row = rows[i];
          if (row && row[3]) {
            const rowEmail = row[3].toString();
            if (rowEmail.toLowerCase().includes('wowuneja')) {
              console.log(chalk.yellow(`    행 ${i+1}: D열="${rowEmail}" B열="${row[1]}"`));
              foundWowuneja = true;
            }
          }
        }
        if (!foundWowuneja) {
          console.log(chalk.red('    wowuneja 관련 이메일을 찾을 수 없음'));
        }
      }

      // 최종 결과 표시
      if (alternativeIds.length > 0) {
        console.log(chalk.green(`\n  ✅ 총 ${alternativeIds.length}개의 대체 AdsPower ID 발견:`));
        alternativeIds.forEach((id, idx) => {
          console.log(chalk.cyan(`    ${idx + 1}. ${id}`));
        });
      } else {
        console.log(chalk.red('\n  ❌ 대체 AdsPower ID를 찾을 수 없습니다'));
        console.log(chalk.yellow('  💡 "애즈파워현황" 시트의 D열에 이메일이 올바르게 입력되어 있는지 확인하세요'));
      }

      return alternativeIds;
    } catch (error) {
      console.log(chalk.red(`  ❌ 대체 ID 검색 오류: ${error.message}`));
      // 부분 성공한 경우 지금까지 찾은 ID 반환
      if (alternativeIds && alternativeIds.length > 0) {
        console.log(chalk.yellow(`  ⚠️ 오류 발생했지만 ${alternativeIds.length}개 ID는 사용 가능`));
        return alternativeIds;
      }
      return [];
    }
  }

  /**
   * 특정 ID로 브라우저 연결 (내부 메서드)
   */
  async _connectBrowserWithId(profileId) {
    try {
      // 프록시 설정 (환경변수로 제어)
      const useProxy = process.env.USE_PROXY !== 'false';

      if (useProxy) {
        console.log(chalk.cyan('  🌐 한국 프록시 설정 중...'));
        const krProxy = getRandomProxy('kr');
        console.log(chalk.cyan(`  🇰🇷 한국 프록시 사용: ${krProxy.proxy_host}:${krProxy.proxy_port}`));

        // AdsPower API로 프록시 업데이트
        try {
          await this.adsPowerAdapter.updateProfile(profileId, {
            user_proxy_config: krProxy
          });
          console.log(chalk.green('  ✅ 한국 프록시 설정 완료'));
        } catch (proxyError) {
          console.log(chalk.yellow(`  ⚠️ 프록시 설정 실패: ${proxyError.message}`));
          console.log(chalk.yellow('  ℹ️ 프록시 없이 계속 진행합니다. USE_PROXY=false로 설정하면 이 메시지를 숨길 수 있습니다.'));
          // 프록시 설정 실패해도 계속 진행
        }

        // 프록시 설정 후 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(chalk.gray('  ℹ️ 프록시 설정을 건너뜁니다 (USE_PROXY=false)'));
      }

      // AdsPower 브라우저 실행
      const session = await this.adsPowerAdapter.launchBrowser(profileId);

      if (!session || !session.browser) {
        throw new Error('브라우저 세션 획득 실패');
      }

      // 페이지 가져오기
      const page = await this.adsPowerAdapter.getPage(profileId);
      if (!page) {
        throw new Error('브라우저 페이지 획득 실패');
      }

      this.browser = session.browser;
      this.page = page;

      // 브라우저가 완전히 준비될 때까지 대기
      await new Promise(resolve => setTimeout(resolve, 3000));

      // BrowserController 인스턴스 생성 (로그인에 필요)
      const BrowserController = require('../../infrastructure/adapters/BrowserController');
      this.controller = new BrowserController(page, {
        debugMode: this.debugMode,
        humanMode: true
      });

      return { browser: session.browser, page };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 브라우저 연결 (대체 ID 지원)
   */
  async connectBrowser(profileId, email = null) {
    let attemptedIds = [];
    let lastError = null;

    // profileId가 null이거나 비밀번호 형태인 경우 바로 대체 ID 검색
    const isInvalidId = !profileId || /[!@#$%^&*(),.?":{}|<>]/.test(profileId);

    if (isInvalidId) {
      console.log(chalk.yellow(`\n⚠️ 유효하지 않은 AdsPower ID: ${profileId ? profileId.substring(0, 10) + '...' : 'null'}`));
      console.log(chalk.yellow(`🔍 바로 대체 ID 검색 시작...`));
    } else {
      // 첫 번째 ID로 시도
      try {
        console.log(chalk.blue(`\n🔧 AdsPower ID 시도 1: ${profileId}`));
        attemptedIds.push(profileId);
        return await this._connectBrowserWithId(profileId);
      } catch (error) {
        console.log(chalk.red(`  ❌ 첫 번째 ID 실패: ${error.message}`));
        lastError = error;
      }
    }

    // 대체 ID 검색 필요
    if (isInvalidId || lastError?.message.includes('Profile does not exist') ||
        lastError?.message.includes('none exists') ||
        lastError?.message.includes('profile_id is required')) {

      if (!email) {
        console.log(chalk.yellow('  ⚠️ 이메일 정보가 없어 대체 ID를 찾을 수 없습니다'));
        this.log(`브라우저 연결 실패: ${lastError?.message || '이메일 정보 없음'}`, 'error');
        return null;
      }

      // 대체 AdsPower ID 찾기
      const alternativeIds = await this.findAlternativeAdsPowerIds(email);

      if (alternativeIds.length === 0) {
        console.log(chalk.red('  ❌ 대체 AdsPower ID를 찾을 수 없습니다'));
        this.log(`브라우저 연결 실패: AdsPower 프로필을 찾을 수 없습니다`, 'error');
        return null;
      }

      // 대체 ID로 시도
      for (const altId of alternativeIds) {
        if (attemptedIds.includes(altId)) {
          console.log(chalk.gray(`  ⏩ 이미 시도한 ID 건너뛰기: ${altId}`));
          continue;
        }

        try {
          console.log(chalk.blue(`\n🔧 대체 AdsPower ID 시도: ${altId}`));
          attemptedIds.push(altId);

          // 대체 ID로 성공하면 해당 ID 반환
          const result = await this._connectBrowserWithId(altId);

          // 성공하면 사용한 ID 저장
          this.actualProfileId = altId;
          console.log(chalk.green(`  ✅ 대체 ID로 연결 성공: ${altId}`));

          return result;
        } catch (altError) {
          console.log(chalk.red(`  ❌ 대체 ID ${altId} 실패: ${altError.message}`));
          lastError = altError;
        }
      }
    }

    // 모든 시도 실패
    console.log(chalk.red('\n❌ 모든 AdsPower ID 시도 실패'));
    console.log(chalk.gray('  시도한 ID: ' + attemptedIds.join(', ')));
    this.log(`브라우저 연결 실패: ${lastError?.message || '알 수 없는 오류'}`, 'error');
    return null;
  }

  /**
   * YouTube Premium 페이지로 이동 (로그인 처리 포함)
   * v2.1 - beforeunload 다이얼로그 자동 처리 기능 추가
   */
  async navigateToPremiumPage(browser) {
    // v2.1 - beforeunload 다이얼로그 자동 처리 설정
    // Gmail 등에서 "사이트에서 나가시겠습니까?" 다이얼로그로 인한 블로킹 방지
    try {
      console.log(chalk.cyan('🔧 [Dialog] beforeunload 다이얼로그 핸들러 설정 중...'));

      // 1. Puppeteer dialog 이벤트 핸들러 등록 (이미 등록되어 있지 않은 경우)
      if (!this._dialogHandlerRegistered) {
        this.page.on('dialog', async (dialog) => {
          const dialogType = dialog.type();
          const message = dialog.message();
          console.log(chalk.yellow(`\n📌 [Dialog] 다이얼로그 감지 [${dialogType}]: ${message.substring(0, 80)}...`));

          try {
            if (dialogType === 'beforeunload') {
              await dialog.accept();
              console.log(chalk.green(`   ✅ beforeunload 다이얼로그 자동 수락 (페이지 이동 허용)`));
            } else if (dialogType === 'confirm') {
              await dialog.accept();
              console.log(chalk.green(`   ✅ confirm 다이얼로그 자동 수락`));
            } else {
              await dialog.accept();
              console.log(chalk.green(`   ✅ 다이얼로그 자동 수락 [${dialogType}]`));
            }
          } catch (err) {
            console.log(chalk.red(`   ❌ 다이얼로그 처리 실패: ${err.message}`));
          }
        });
        this._dialogHandlerRegistered = true;
        console.log(chalk.green('   ✅ 다이얼로그 핸들러 등록 완료'));
      }

      // 2. beforeunload 이벤트 리스너 제거 (원천 차단)
      await this.page.evaluate(() => {
        window.onbeforeunload = null;

        // addEventListener로 등록된 beforeunload 차단
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = function(type, listener, options) {
          if (type === 'beforeunload') return;
          return originalAddEventListener.call(this, type, listener, options);
        };
      }).catch(() => {});

      console.log(chalk.green('   ✅ beforeunload 이벤트 리스너 제거 완료'));
    } catch (dialogSetupError) {
      console.log(chalk.yellow(`⚠️ [Dialog] 다이얼로그 핸들러 설정 실패 (계속 진행): ${dialogSetupError.message}`));
    }

    let retryCount = 0;
    const maxRetries = 3;
    let pageLoaded = false;

    while (retryCount < maxRetries) {
      try {
        console.log(chalk.cyan(`📄 [Navigation] YouTube Premium 페이지로 이동 (시도 ${retryCount + 1}/${maxRetries})`));

        // YouTube Premium 페이지로 직접 이동 시도
        const premiumUrl = 'https://www.youtube.com/paid_memberships';
        console.log(chalk.gray(`🌐 이동 URL: ${premiumUrl}`));
        
        await this.page.goto(premiumUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        
        await new Promise(r => setTimeout(r, 3000));
        
        // 현재 URL 확인
        const currentUrl = this.page.url();
        const pageTitle = await this.page.title();
        console.log(chalk.yellow(`📍 현재 URL: ${currentUrl}`));
        console.log(chalk.yellow(`📝 페이지 제목: ${pageTitle}`));
        
        // YouTube Music으로 잘못 리다이렉트된 경우 처리
        if (currentUrl.includes('music.youtube.com') || 
            (pageTitle.toLowerCase().includes('music') && !pageTitle.toLowerCase().includes('premium'))) {
          console.log(chalk.yellow('⚠️ YouTube Music 페이지로 리다이렉트됨'));
          console.log(chalk.cyan('🔄 YouTube Premium 페이지로 다시 이동...'));
          
          // YouTube Premium으로 명시적으로 이동
          await this.page.goto('https://www.youtube.com/premium', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await new Promise(r => setTimeout(r, 3000));
          
          const finalUrl = this.page.url();
          const finalTitle = await this.page.title();
          console.log(chalk.green(`✅ 최종 URL: ${finalUrl}`));
          console.log(chalk.green(`✅ 최종 제목: ${finalTitle}`));
        }
        
        // URL로 로그인 상태 판단 (재개 워크플로우와 동일)
        const isLoggedIn = !currentUrl.includes('accounts.google.com') && 
                          !currentUrl.includes('signin') &&
                          (currentUrl.includes('youtube.com/paid_memberships') || 
                           currentUrl.includes('youtube.com/premium'));
        
        if (isLoggedIn) {
          console.log(chalk.green(`✅ [Login] 이미 로그인되어 있음 - Premium 페이지 정상 로드`));
          pageLoaded = true;
          break;
        } else {
          // 로그인 페이지로 리다이렉션된 경우
          console.log(chalk.yellow(`🔐 [Login] 로그인 필요 (로그인 페이지로 리다이렉션됨)`));
          
          // 로그인 처리
          const loginResult = await this.handleLoginIfNeeded();

          // reCAPTCHA 감지된 경우 - 다음 계정으로 넘어가도록 특별한 에러 throw
          if (loginResult && (loginResult.error === 'RECAPTCHA_DETECTED' || loginResult.recaptchaDetected)) {
            console.log(chalk.red('❌ reCAPTCHA 감지 - 다음 계정으로 넘어갑니다'));
            const recaptchaError = new Error('RECAPTCHA_DETECTED');
            recaptchaError.isRecaptcha = true;  // 특별한 플래그 추가
            throw recaptchaError;
          }

          // ★ 이미지 CAPTCHA 감지된 경우 - 재시도 가능하도록 처리
          if (loginResult && (loginResult.error === 'IMAGE_CAPTCHA_DETECTED' || loginResult.shouldRetry)) {
            console.log(chalk.yellow('🖼️ 이미지 CAPTCHA 감지 - 재시도 필요'));
            const captchaError = new Error('IMAGE_CAPTCHA_DETECTED');
            captchaError.isCaptcha = true;
            captchaError.shouldRetry = true;  // 재시도 플래그
            throw captchaError;
          }

          // 계정 사용 중지 처리
          if (loginResult && (loginResult.error === 'ACCOUNT_DISABLED' || loginResult.status === 'account_disabled')) {
            console.log(chalk.red('🚫 계정이 사용 중지되었습니다'));
            console.log(chalk.yellow(`  사유: ${loginResult.message || '계정 사용 중지'}`));

            // 결과 객체 생성 (오류를 throw하지 않고 결과 반환)
            const disabledResult = {
              profileName: this.profileName,
              success: false,
              error: '계정 사용 중지',
              status: '계정사용중지',
              email: this.email,
              message: loginResult.message || '계정이 사용 중지되었습니다',
              accountStatus: 'disabled'
            };

            // 스크린샷 저장
            try {
              const timestamp = Date.now();
              const screenshotPath = path.join('screenshots', 'account-disabled',
                `${this.profileName}_disabled_${timestamp}.png`);
              await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
              await this.page.screenshot({ path: screenshotPath, fullPage: true });
              console.log(chalk.gray(`📸 계정 사용 중지 스크린샷: ${screenshotPath}`));
            } catch (e) {
              console.log(chalk.yellow(`⚠️ 스크린샷 저장 실패: ${e.message}`));
            }

            // 로그인 실패로 처리하고 다음 계정으로 넘어가도록
            return disabledResult;
          }

          // 일반 로그인 실패
          if (!loginResult || !loginResult.success) {
            console.log(chalk.red('❌ 로그인 실패'));
            throw new Error(loginResult?.error || '로그인 실패');
          }
          
          // 로그인 성공 후 YouTube Premium 페이지로 다시 이동
          console.log(chalk.cyan('🎯 로그인 후 YouTube Premium 페이지로 다시 이동...'));
          await this.page.goto('https://www.youtube.com/paid_memberships', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          
          await new Promise(r => setTimeout(r, 3000));
          
          const finalUrl = this.page.url();
          const finalTitle = await this.page.title();
          
          // YouTube Music으로 리다이렉트된 경우 처리
          if (finalUrl.includes('music.youtube.com')) {
            console.log(chalk.yellow('⚠️ YouTube Music으로 리다이렉트됨. Premium으로 다시 이동...'));
            await this.page.goto('https://www.youtube.com/premium', {
              waitUntil: 'domcontentloaded',
              timeout: 30000
            });
            await new Promise(r => setTimeout(r, 3000));
          }
          
          if (finalUrl.includes('youtube.com/paid_memberships') || finalUrl.includes('youtube.com/premium') || 
              finalUrl.includes('youtube.com') && !finalUrl.includes('music')) {
            console.log(chalk.green('✅ YouTube Premium 페이지 로드 성공'));
            pageLoaded = true;
            break;
          } else if (finalUrl.includes('accounts.google.com')) {
            // 여전히 로그인 페이지에 있는 경우
            console.log(chalk.red('❌ 로그인 후에도 여전히 로그인 페이지에 있음'));
            throw new Error('로그인 실패 - 계정 문제 가능성');
          }
        }
        
        // 예전 코드는 제거 (페이지 상태 분석기 사용 부분)
        // const currentState = await this.pageAnalyzer.analyzePageState(this.page);
        console.log(chalk.cyan(`📄 [PageState] 현재 상태: ${currentState.pageType}, 로그인: ${currentState.loginStatus.isLoggedIn ? '✅' : '❌'}`));
        
        // 로그인이 필요한 경우
        if (!currentState.loginStatus.isLoggedIn) {
          console.log(chalk.yellow(`🔐 [Login] 로그인 필요 감지`));
          await this.handleLoginIfNeeded(currentState);
          // 로그인 후 상태 재확인
          const afterLoginState = await this.pageAnalyzer.analyzePageState(this.page);
          if (!afterLoginState.loginStatus.isLoggedIn) {
            throw new Error('로그인 실패');
          }
        }
        
        // YouTube Premium 페이지로 네비게이션 계획 수립
        const navPlan = await this.navigationStrategy.planNavigation(currentState, 'youtube_premium');
        
        // 네비게이션 실행
        for (const step of navPlan.steps) {
          const result = await this.navigationStrategy.executeStep(this.page, step);
          if (result.needsLogin) {
            await this.handleLoginIfNeeded(result.loginDetails);
          } else if (result.completed) {
            console.log(chalk.green(`✅ [Navigation] 완료: ${result.reason}`));
            break;
          }
        }
        
        // 페이지 로드 대기 및 최종 상태 확인
        const finalState = await this.pageAnalyzer.waitForPageReady(this.page, {
          targetPage: 'premium',
          timeout: 15000
        });
        
        this.log(`최종 페이지 타입: ${finalState.pageType}`, 'debug');
        
        // YouTube Premium 페이지 확인
        if (finalState.pageType.includes('youtube_premium')) {
          this.log('YouTube Premium 페이지 확인됨', 'success');
          pageLoaded = true;
          break;
        } else if (finalState.pageContent.hasError) {
          this.log('오류 감지', 'error');
          throw new Error('페이지 로드 실패');
        } else {
          this.log(`현재 페이지 타입: ${finalState.pageType}`, 'warning');
        }
        
        
      } catch (error) {
        // reCAPTCHA 에러는 재시도하지 않고 즉시 throw
        if (error.isRecaptcha || error.message === 'RECAPTCHA_DETECTED') {
          this.log('🛑 reCAPTCHA 감지로 인한 즉시 중단', 'warning');
          throw error;  // 상위로 전파하여 execute의 catch로 이동
        }

        // ★ 이미지 CAPTCHA 에러 - shouldRetry가 true면 재시도 허용
        if (error.isCaptcha || error.message === 'IMAGE_CAPTCHA_DETECTED') {
          this.log('🖼️ 이미지 CAPTCHA 감지로 인한 재시도 필요', 'warning');
          throw error;  // 상위로 전파하여 재시도 로직에서 처리
        }

        retryCount++;
        this.log(`페이지 이동 실패 (시도 ${retryCount}/${maxRetries}): ${error.message}`, 'warning');
        
        // 현재 페이지 상태 디버깅
        try {
          const debugInfo = await this.page.evaluate(() => {
            return {
              url: window.location.href,
              title: document.title,
              readyState: document.readyState,
              bodyLength: document.body?.innerHTML?.length || 0,
              hasYouTubeElements: !!document.querySelector('ytd-app'),
              visibleText: document.body?.innerText?.substring(0, 200) || ''
            };
          });
          this.log(`디버그 정보: ${JSON.stringify(debugInfo, null, 2)}`, 'debug');
        } catch (debugError) {
          this.log(`디버그 정보 수집 실패: ${debugError.message}`, 'debug');
        }
        
        if (retryCount < maxRetries) {
          // 실제 네트워크 오류인 경우만 특별 처리
          if (error.message.includes('ERR_FAILED') || 
              error.message.includes('ERR_CONNECTION') ||
              error.message.includes('네트워크 오류')) {
            
            this.log('실제 네트워크 오류 - 브라우저 캐시 정리 및 재시도', 'info');
            
            // 브라우저 캐시 정리 시도
            try {
              await this.page.evaluate(() => {
                // 로컬 스토리지 정리
                localStorage.clear();
                sessionStorage.clear();
              });
            } catch (e) {
              // 무시
            }
            
            // 대기 시간을 점진적으로 증가
            const waitTime = 3000 * retryCount;
            this.log(`${waitTime/1000}초 대기 후 재시도`, 'info');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // 페이지 새로고침 대신 현재 페이지에서 계속 진행 시도
            this.log('페이지 새로고침 대신 현재 상태 확인', 'info');
            
            // 현재 페이지 URL 확인
            const currentPageUrl = await this.page.url();
            
            // YouTube Premium 페이지에 이미 있는 경우
            if (currentPageUrl.includes('paid_memberships')) {
              this.log('YouTube Premium 페이지에 이미 있음', 'info');
              
              // 페이지 콘텐츠 확인
              const hasContent = await this.page.evaluate(() => {
                const body = document.body?.innerText || '';
                return body.length > 100 && 
                       (body.includes('YouTube') || body.includes('Google'));
              });
              
              if (hasContent) {
                this.log('페이지 콘텐츠 확인됨, 계속 진행', 'success');
                pageLoaded = true;
                break;  // 재시도 루프 탈출
              }
            }
          }
        } else {
          this.log('최대 재시도 횟수 초과', 'info');

          // 마지막으로 현재 페이지 상태 확인
          const finalUrl = await this.page.url();

          // ⚠️ 중요: 로그인 페이지에 있으면 절대 성공으로 판단하지 않음!
          if (finalUrl.includes('accounts.google.com')) {
            this.log('로그인 페이지에서 벗어나지 못함 - 자동 로그인 실패', 'error');
            throw new Error('자동 로그인 실패 - 로그인 페이지에서 진행 불가');
          }

          const finalContent = await this.page.evaluate(() => {
            return {
              hasContent: document.body?.innerHTML?.length > 100,
              hasPremiumElements: !!document.querySelector('[aria-label*="Premium"]') ||
                                 !!document.querySelector('[aria-label*="membership"]'),
              bodyText: document.body?.innerText?.substring(0, 100) || ''
            };
          });

          this.log(`최종 상태 - URL: ${finalUrl}, 콘텐츠: ${finalContent.hasContent}`, 'info');

          // URL이 맞고 콘텐츠가 있으면 성공으로 처리
          if (finalUrl.includes('paid_memberships') && finalContent.hasContent) {
            this.log('페이지 로드 성공 (초기 감지 지연)', 'info');
            pageLoaded = true;
          } else {
            // 정말 실패한 경우만 오류 발생
            this.log('YouTube Premium 페이지 로드 실패', 'error');
            throw new Error('YouTube Premium 페이지 로드 실패');
          }
        }
      }
    }
    
    // 페이지가 제대로 로드되지 않았으면 오류 발생
    if (!pageLoaded && retryCount >= 3) {
      throw new Error('YouTube Premium 페이지 접근 실패 - 네트워크 오류');
    }
  }
  
  /**
   * 로그인이 필요한 경우 처리 (Resume 워크플로우와 완전히 동일한 로직)
   */
  async handleLoginIfNeeded(loginDetails = null, result = null) {
    console.log(chalk.cyan('\n🔐 [Login Process] 로그인 처리 시작'));

    // 디버깅을 위한 스크린샷 저장 함수
    const saveDebugScreenshot = async (step, suffix = '') => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `debug-login-${step}${suffix ? '-' + suffix : ''}-${timestamp}.png`;
        const filepath = path.join('screenshots', 'debug', filename);
        await fs.mkdir(path.join('screenshots', 'debug'), { recursive: true });
        await this.page.screenshot({ path: filepath, fullPage: true });
        console.log(chalk.gray(`📸 [DEBUG] 스크린샷 저장: ${filename}`));
      } catch (e) {
        console.log(chalk.yellow(`⚠️ 디버그 스크린샷 저장 실패: ${e.message}`));
      }
    };

    try {
      this.log('🔍 로그인 상태 확인 중...', 'info');
      console.log(chalk.blue('  [Step 1/5] 로그인 상태 확인'));

      // 로그인 확인 전 스크린샷
      await saveDebugScreenshot('status-check-before');

      // 로그인 모드 확인 - working 모드를 기본으로 (Resume과 동일)
      const loginMode = this.config?.loginMode || process.env.LOGIN_MODE || 'working';
      const useWorkingMode = loginMode === 'working';
      const useImprovedMode = loginMode === 'improved' || this.config?.useImprovedAuth === true;

      console.log(chalk.gray(`  로그인 모드: ${loginMode}`));

      // 로그인 상태 확인
      let isLoggedIn = false;
      let needsLogin = false;

      // URL 기반 로그인 상태 빠른 체크
      const currentUrl = this.page.url();
      const quickCheck = !currentUrl.includes('accounts.google.com') &&
                         !currentUrl.includes('signin') &&
                         !currentUrl.includes('ServiceLogin');

      if (quickCheck) {
        // 페이지 콘텐츠로 추가 확인
        const pageContent = await this.page.evaluate(() => document.body?.innerText || '');
        isLoggedIn = !pageContent.includes('Sign in') && !pageContent.includes('로그인');
      }

      needsLogin = loginDetails ? !loginDetails.isLoggedIn : !isLoggedIn;

      if (needsLogin) {
        console.log(chalk.yellow('  ⚠️ 로그인 필요 감지'));

        const modeName = useWorkingMode ? 'Working (가장 안정적)' :
                        (useImprovedMode ? 'Improved (계정 선택/reCAPTCHA 처리)' : '기본');
        this.log(`🔐 로그인이 필요합니다. ${modeName} 모드로 로그인 시작...`, 'warning');
        console.log(chalk.blue(`  [Step 2/5] ${modeName} 모드로 로그인 시작`));

        // 로그인 필요 상태 스크린샷
        await saveDebugScreenshot('login-required');

        // Google Sheets에서 계정 정보 가져오기 (올바른 컬럼 매핑)
        const accountInfo = {
          email: this.profileData?.email || this.profileData?.googleId,
          password: this.profileData?.password,       // B열
          recoveryEmail: this.profileData?.recoveryEmail, // C열
          totpSecret: this.profileData?.code || this.profileData?.totpSecret, // D열
          profileId: this.profileData?.profileId || this.actualProfileId
        };

        this.log(`📧 로그인 계정: ${accountInfo.email}`, 'info');
        console.log(chalk.cyan(`  📧 계정: ${accountInfo.email}`));

        if (!accountInfo.email || !accountInfo.password) {
          this.log('❌ 로그인 정보가 없습니다. 수동 로그인이 필요합니다.', 'error');
          console.log(chalk.red('  ❌ 로그인 정보 없음'));
          await saveDebugScreenshot('login-info-missing');
          throw new Error('로그인 정보 없음');
        }

        // TOTP 시크릿 키 확인
        if (accountInfo.totpSecret) {
          this.log(`✅ TOTP 시크릿 키 존재`, 'success');
          console.log(chalk.green('  ✅ TOTP 키 존재'));
        } else {
          this.log(`⚠️ TOTP 시크릿 키 없음`, 'warning');
          console.log(chalk.yellow('  ⚠️ TOTP 키 없음'));
        }

        // 현재 페이지 상태 확인
        this.log(`📍 로그인 시작 URL: ${currentUrl}`, 'info');
        console.log(chalk.gray(`  현재 URL: ${currentUrl}`));

        let loginResult;

        if (useWorkingMode) {
          // Working 모드 - Resume과 완전히 동일한 가장 안정적인 로그인
          this.log('🎯 Working 모드 로그인 시작 (Resume과 동일한 가장 안정적인 방식)...', 'info');
          console.log(chalk.blue('  [Step 3/5] Working 모드로 로그인'));

          const WorkingAuthenticationService = require('../../services/WorkingAuthenticationService');
          const workingAuthService = new WorkingAuthenticationService({
            debugMode: true,
            maxRetries: 3,
            screenshotEnabled: true
          });

          try {
            loginResult = await workingAuthService.authenticate(this.page, accountInfo, {
              targetUrl: 'https://www.youtube.com/paid_memberships',
              debugMode: true
            });

            console.log(chalk.green('  ✅ Working 모드 인증 성공'));
          } catch (error) {
            await saveDebugScreenshot('login-error-working');

            // reCAPTCHA 에러인 경우 그대로 반환
            if (error.message === 'RECAPTCHA_DETECTED' || error.isRecaptcha) {
              this.log('🤖 reCAPTCHA 감지됨 - 로그인 중단', 'warning');
              console.log(chalk.yellow('  🤖 reCAPTCHA로 인한 로그인 중단'));
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }

            this.log(`❌ Working 모드 로그인 실패: ${error.message}`, 'error');
            console.log(chalk.red(`  ❌ 로그인 실패: ${error.message}`));
            loginResult = { success: false, error: error.message };
          }

        } else if (useImprovedMode) {
          // Improved 모드 로그인 (계정 선택 페이지, reCAPTCHA 처리 포함)
          this.log('✨ Improved 모드 로그인 시작 (계정 선택/reCAPTCHA 자동 처리)...', 'info');
          console.log(chalk.blue('  [Step 3/5] 이메일 입력'));

          // 로그인 시작 전 스크린샷
          await saveDebugScreenshot('login-start');

          try {
            loginResult = await this.authService.handleAuthentication(this.page, {
              email: accountInfo.email,
              password: accountInfo.password,
              totpSecret: accountInfo.totpSecret
            });

            // 로그인 완료 후 스크린샷
            await saveDebugScreenshot('login-after-auth');

            // reCAPTCHA 감지된 경우 처리
            if (loginResult.error === 'RECAPTCHA_DETECTED') {
              this.log('⚠️ reCAPTCHA가 감지되었습니다.', 'warning');
              console.log(chalk.yellow('  🤖 reCAPTCHA 감지'));

              await saveDebugScreenshot('recaptcha-detected');

              // reCAPTCHA 플래그 설정
              if (result) {
                result.recaptchaDetected = true;
                result.recaptchaTime = new Date().toLocaleString('ko-KR');
              }

              // reCAPTCHA 결과 반환 (throw하지 않음)
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }

            console.log(chalk.green('  ✅ 인증 성공'));

          } catch (error) {
            await saveDebugScreenshot('login-error');

            // reCAPTCHA 에러인 경우 그대로 반환
            if (error.message === 'RECAPTCHA_DETECTED' || error.isRecaptcha) {
              this.log('🤖 reCAPTCHA 감지됨 - 로그인 중단', 'warning');
              console.log(chalk.yellow('  🤖 reCAPTCHA로 인한 로그인 중단'));
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }

            this.log(`❌ Improved 모드 로그인 실패: ${error.message}`, 'error');
            console.log(chalk.red(`  ❌ 로그인 실패: ${error.message}`));
            loginResult = { success: false, error: error.message };
          }

        } else {
          // 기본 모드 - ImprovedAuthenticationService 사용
          this.log('🚀 기본 인증 서비스로 로그인 시작...', 'info');

          try {
            loginResult = await this.authService.handleAuthentication(this.page, {
              email: accountInfo.email,
              password: accountInfo.password,
              totpSecret: accountInfo.totpSecret,
              profileId: accountInfo.profileId
            });

            // reCAPTCHA 감지 체크
            if (loginResult.error === 'RECAPTCHA_DETECTED') {
              this.log('⚠️ reCAPTCHA가 감지되었습니다.', 'warning');

              if (result) {
                result.recaptchaDetected = true;
                result.recaptchaTime = new Date().toLocaleString('ko-KR');
              }

              // reCAPTCHA 에러를 반환
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }
          } catch (loginError) {
            this.log(`💥 handleAuthentication 호출 중 오류: ${loginError.message}`, 'error');

            // reCAPTCHA 에러인 경우
            if (loginError.message === 'RECAPTCHA_DETECTED' || loginError.isRecaptcha) {
              return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
            }

            throw loginError;
          }
        }

        if (loginResult.success) {
          const modeName = useWorkingMode ? 'Working' :
                          (useImprovedMode ? 'Improved' : '기본');
          this.log(`✅ 자동 로그인 성공 (${modeName} 모드)`, 'success');
          console.log(chalk.green(`  ✅ 로그인 성공 (${modeName} 모드)`));

          // 로그인 성공 스크린샷
          await saveDebugScreenshot('login-success');

          // 로그인 후 URL 확인
          const afterLoginUrl = this.page.url();
          this.log(`📍 로그인 후 URL: ${afterLoginUrl}`, 'info');
          console.log(chalk.gray(`  로그인 후 URL: ${afterLoginUrl}`));

          // 현재 URL이 이미 YouTube Premium 페이지인지 확인
          if (afterLoginUrl.includes('youtube.com/paid_memberships') ||
              afterLoginUrl.includes('youtube.com/premium')) {
            this.log('✅ 이미 YouTube Premium 페이지에 있습니다', 'success');
            console.log(chalk.green('  ✅ 이미 Premium 페이지에 위치'));
            await saveDebugScreenshot('login-already-on-premium');
            await new Promise(r => setTimeout(r, 3000));
            return { success: true };
          }

          // YouTube Premium 페이지로 다시 이동
          this.log('🎯 YouTube Premium 페이지로 이동 중...', 'info');
          console.log(chalk.blue('  [Step 5/5] Premium 페이지로 이동'));

          try {
            await this.page.goto('https://www.youtube.com/paid_memberships', {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            });
            await new Promise(r => setTimeout(r, 3000));

            // 페이지 로딩 완료 확인
            const finalUrl = this.page.url();
            this.log(`📍 최종 페이지 URL: ${finalUrl}`, 'info');
            console.log(chalk.gray(`  최종 URL: ${finalUrl}`));

            await saveDebugScreenshot('login-final-navigation');

          } catch (navError) {
            this.log(`⚠️ 네비게이션 오류: ${navError.message}`, 'warning');
            console.log(chalk.yellow(`  ⚠️ 네비게이션 오류: ${navError.message}`));
            await saveDebugScreenshot('login-navigation-error');
            // 네비게이션 오류가 발생해도 계속 진행
          }

          console.log(chalk.green('🔐 [Login Process] 로그인 완료\n'));

          // 로그인 성공 반환
          return { success: true };

        } else {
          this.log(`❌ 자동 로그인 실패: ${loginResult.reason || loginResult.error}`, 'error');
          console.log(chalk.red(`  ❌ 로그인 실패: ${loginResult.reason || loginResult.error || '알 수 없음'}`));

          // 로그인 실패 스크린샷
          await saveDebugScreenshot('login-failed');

          // 실패 이유별 처리
          if (loginResult.error === 'RECAPTCHA_DETECTED' || loginResult.reason === 'RECAPTCHA_DETECTED') {
            this.log('🛡️ reCAPTCHA 감지 - 번호인증계정으로 표시', 'warning');
            console.log(chalk.yellow('  🛡️ reCAPTCHA 감지'));
            await saveDebugScreenshot('login-recaptcha');
            return { success: false, error: 'RECAPTCHA_DETECTED', isRecaptcha: true };
          }

          throw new Error('자동 로그인 실패');
        }
      } else {
        this.log('✅ 이미 로그인되어 있습니다.', 'info');
        console.log(chalk.green('  ✅ 이미 로그인되어 있음'));

        // 로그인된 상태 스크린샷
        await saveDebugScreenshot('already-logged-in');

        console.log(chalk.green('🔐 [Login Process] 로그인 확인 완료 (이미 로그인됨)\n'));

        return { success: true, alreadyLoggedIn: true };
      }

    } catch (error) {
      this.log(`💥 로그인 처리 중 오류: ${error.message}`, 'error');
      console.log(chalk.red(`  💥 로그인 오류: ${error.message}`));

      // 오류 발생 시 현재 페이지 스크린샷 저장
      try {
        await saveDebugScreenshot('login-error-critical');

        const timestamp = Date.now();
        const screenshotPath = `screenshots/login_error_${timestamp}.png`;
        await this.page.screenshot({ path: screenshotPath });
        this.log(`📸 오류 스크린샷 저장: ${screenshotPath}`, 'warning');
      } catch (e) {
        this.log(`스크린샷 저장 실패: ${e.message}`, 'warning');
      }

      // reCAPTCHA 에러는 다시 throw하여 상위로 전파
      if (error.message === 'RECAPTCHA_DETECTED' || error.isRecaptcha) {
        const recaptchaError = new Error('RECAPTCHA_DETECTED');
        recaptchaError.isRecaptcha = true;
        throw recaptchaError;
      }

      throw error;
    }
  }

  /**
   * 페이지 언어 감지
   */
  async detectPageLanguage(browser) {
    const pageText = await this.page.evaluate(() => document.body?.textContent || '');
    return detectLanguage(pageText);
  }

  /**
   * 현재 상태 확인
   */
  async checkCurrentStatus(browser) {
    // 언어 변형(pt-br, pt-pt)을 안전하게 처리
    const lang = languages[this.currentLanguage] || languages['pt'] || languages['en'];

    this.log('현재 상태 확인 시작', 'debug');

    // Frame-safe 버튼 서비스 사용하여 멤버십 관리 버튼 클릭
    const EnhancedButtonInteractionService = require('../../services/EnhancedButtonInteractionService');
    const enhancedButtonService = new EnhancedButtonInteractionService({
      debugMode: true,
      frameRecoveryEnabled: true
    });

    const clickResult = await enhancedButtonService.clickManageMembershipButton(
      this.page,
      this.currentLanguage,
      { maxRetries: 3 }
    );

    if (clickResult.clicked) {
      this.managementPageOpened = true; // 멤버십 관리 페이지 열림 표시
      this.log('멤버십 관리 페이지 열림 상태 저장', 'debug');

      // 멤버십 관리 버튼을 클릭한 후 만료 상태 확인 (방어적 업데이트)
      // afterManageClick를 true로 설정하여 정확한 만료 판단
      // "Benefits end:" + "Renew" 버튼 패턴도 확인
      const expiredCheck = await enhancedButtonService.checkSubscriptionExpired(this.page, true);

      // 디버그 로깅
      console.log(chalk.gray(`📊 [ExpiredCheck-AfterManage] 만료 상태 확인 결과:`));
      console.log(chalk.gray(`  - isExpired: ${expiredCheck.isExpired}`));
      console.log(chalk.gray(`  - hasBenefitsEnd: ${expiredCheck.hasBenefitsEnd}`));
      console.log(chalk.gray(`  - hasRenewButton: ${expiredCheck.hasRenewButton}`));
      console.log(chalk.gray(`  - hasPauseButton: ${expiredCheck.hasPauseButton}`));
      if (expiredCheck.indicator) {
        console.log(chalk.gray(`  - indicator: ${expiredCheck.indicator}`));
      }

      if (expiredCheck.isExpired) {
        this.log(`⚠️ 구독이 만료됨: ${expiredCheck.indicator}`, 'warning');
        console.log(chalk.yellow(`⚠️ [SubscriptionExpired] Manage 버튼 클릭 후 만료 감지: ${expiredCheck.indicator}`));
        throw new Error('SUBSCRIPTION_EXPIRED');
      }
    }

    // 상태 확인
    const status = await this.page.evaluate((langData) => {
      const pageText = document.body?.textContent || '';
      const result = {
        isPaused: false,
        hasResumeButton: false,
        resumeDate: null,
        nextBillingDate: null,
        pausedUntilDate: null  // 일시중지 상태에서 재개 날짜
      };

      // Resume 버튼 확인
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && langData.buttons.resume.some(resumeText => btnText.includes(resumeText))) {
          result.hasResumeButton = true;
          result.isPaused = true;
          break;
        }
      }

      // 일시중지 상태인 경우 "멤버십 재개" 날짜 추출
      if (result.isPaused) {
        // "멤버십 재개: 2025. 10. 29." 형식
        const resumePatterns = [
          /멤버십 재개:\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/i, // 한국어 전체 연도
          /Resume membership:\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i, // 영어
          /Resume on:\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i, // 영어 대체
          /Membership resumes:\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i, // 영어 대체2
          /멤버십 재개:\s*(\d{1,2}월\s+\d{1,2}일)/i, // 한국어 월일만
          /Membership resumes:\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/i, // 날짜 형식
          /Возобновление:\s*([\d\s\w\.]+)/i, // 러시아어
          /Retomar em:\s*([\d\s\w\.]+)/i // 포르투갈어
        ];
        
        for (const pattern of resumePatterns) {
          const match = pageText.match(pattern);
          if (match) {
            result.pausedUntilDate = match[1].trim();
            console.log('일시중지 재개 날짜 발견:', result.pausedUntilDate);
            break;
          }
        }

        // "멤버십 일시중지: 10월 3일" 형식 체크 - 이것이 다음 결제일!
        const pauseDatePatterns = [
          /멤버십 일시중지:\s*(\d{1,2}월\s+\d{1,2}일)/i,
          /일시중지:\s*(\d{1,2}월\s+\d{1,2}일)/i,
          /Membership pauses on:\s*([A-Za-z]+\s+\d{1,2})/i,
          /pauses on:\s*([A-Za-z]+\s+\d{1,2})/i,
          /A subscrição vai ser colocada em pausa a:\s*(\d{1,2}\/\d{1,2})/i,  // 포르투갈어
          /Дата приостановки подписки:\s*(\d{1,2}\s+[а-яА-ЯёЁ]+\.?)/i  // 러시아어
        ];
        
        for (const pattern of pauseDatePatterns) {
          const match = pageText.match(pattern);
          if (match) {
            // 일시중지일이 실제 다음 결제일임!
            result.pauseDate = match[1].trim();
            console.log('📌 일시중지일(다음 결제일) 발견:', result.pauseDate);
            break;
          }
        }
      }

      // Next billing date 추출 (활성 상태인 경우)
      if (!result.isPaused) {
        const billingPatterns = [
          /Next billing date:\s*([A-Za-z]+\s+\d{1,2})/i, // 영어
          /Ngày thanh toán tiếp theo:\s*(\d{1,2}\s+thg\s+\d{1,2})/i, // 베트남어 YouTube 형식
          /Ngày thanh toán tiếp theo:\s*(\d{1,2}\s+tháng\s+\d{1,2})/i, // 베트남어 표준
          /다음 결제일:\s*(\d{1,2}월\s+\d{1,2}일)/i, // 한국어
          /Sonraki faturalandırma:\s*(\d{1,2}\s+\w+)/i, // 터키어
          /Следующий платёж:\s*(\d{1,2}\s+\w+)/i // 러시아어
        ];
        
        for (const pattern of billingPatterns) {
          const match = pageText.match(pattern);
          if (match) {
            result.nextBillingDate = match[1];
            break;
          }
        }
      }

      // 날짜 정보 추출 - 영어 월 이름 형식
      const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;
      const dateMatches = pageText.match(datePattern);
      if (dateMatches && !result.resumeDate) {
        result.resumeDate = dateMatches[0];
      }

      return result;
    }, lang);

    // 날짜 파싱 (UnifiedSheetsUpdateService 사용)
    const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
    const sheetsService = new UnifiedSheetsUpdateService();
    
    if (status.nextBillingDate) {
      // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
      status.nextBillingDate = this.dateParser ? 
        this.dateParser.parseDate(status.nextBillingDate, this.currentLanguage) : 
        sheetsService.parseDate(status.nextBillingDate);
      this.log(`다음 결제일 파싱: ${status.nextBillingDate}`, 'info');
    }
    
    // 일시중지 재개 날짜 파싱
    if (status.pausedUntilDate) {
      // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
      status.pausedUntilDate = this.dateParser ? 
        this.dateParser.parseDate(status.pausedUntilDate, this.currentLanguage) : 
        sheetsService.parseDate(status.pausedUntilDate);
      this.log(`재개일 파싱: ${status.pausedUntilDate}`, 'info');
    }
    
    // 중요: 일시중지 날짜가 다음 결제일 (재개일이 아님!)
    if (status.pauseDate) {
      if (!status.nextBillingDate || status.nextBillingDate === status.pausedUntilDate) {
        status.nextBillingDate = status.pauseDate;
        this.log(`📌 일시중지일을 다음 결제일로 설정: ${status.nextBillingDate}`, 'important');
      }
    } else if (status.isPaused && status.pausedUntilDate && !status.nextBillingDate) {
      // pauseDate가 없고 일시중지 상태인 경우에만 재개일을 다음 결제일로 사용 (fallback)
      status.nextBillingDate = status.pausedUntilDate;
      this.log(`📌 일시중지일이 없어서 재개일을 다음 결제일로 설정 (fallback): ${status.nextBillingDate}`, 'info');
    }

    return status;
  }

  /**
   * 멤버십 관리 버튼 클릭
   */
  async clickManageButton() {
    // 언어 변형(pt-br, pt-pt)을 안전하게 처리
    const lang = languages[this.currentLanguage] || languages['pt'] || languages['en'];

    this.log('멤버십 관리 버튼 찾기 시작', 'debug');

    // SafeClickWrapper가 초기화되지 않은 경우 초기화
    if (!this.safeClickWrapper) {
      this.safeClickWrapper = new SafeClickWrapper(this.page, {
        debug: this.debugMode,
        maxRetries: 3
      });
    }

    // SafeClickWrapper를 사용한 안전한 클릭
    const clickResult = await this.safeClickWrapper.clickButtonByText(
      lang.buttons.manageMemership,
      { selector: 'button, tp-yt-paper-button, [role="button"]' }
    );

    if (clickResult && clickResult.success) {
      this.log(`멤버십 관리 버튼 클릭 성공: "${clickResult.text}"`, 'success');

      // 클릭 후 페이지 업데이트 대기 시간 증가 (5초 -> 7초)
      await new Promise(resolve => setTimeout(resolve, 7000));

      // 페이지 업데이트 확인 - 특정 요소를 기다리지 말고 상태 변경만 확인
      const pageUpdated = await this.page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        // Pause, Resume 버튼이 나타나면 업데이트 완료
        return bodyText.includes('Pause') || bodyText.includes('일시중지') ||
               bodyText.includes('Resume') || bodyText.includes('재개');
      });

      if (pageUpdated) {
        this.log('페이지 업데이트 확인됨', 'debug');
      } else {
        this.log('페이지 업데이트를 확인할 수 없지만 계속 진행', 'debug');
      }

      return true;
    } else {
      this.log('멤버십 관리 버튼을 찾을 수 없음', 'warning');
    }

    return false;
  }

  /**
   * 일시중지 워크플로우 실행
   */
  async executePauseWorkflow(browser) {
    const result = {
      success: false,
      pauseDate: null,
      resumeDate: null,
      error: null
    };

    try {
      // 1. 일시중지 버튼 클릭 (재시도 로직 포함)
      let pauseClicked = false;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (!pauseClicked && attempts < maxAttempts) {
        attempts++;
        this.log(`일시중지 버튼 클릭 시도 ${attempts}/${maxAttempts}`, 'info');
        
        pauseClicked = await this.clickPauseButton();
        
        if (!pauseClicked && attempts < maxAttempts) {
          this.log('일시중지 버튼을 찾지 못함, 다시 시도...', 'warning');
          
          // 멤버십 관리 버튼 다시 클릭
          await this.clickManageButton();
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      if (!pauseClicked) {
        throw new Error('일시중지 버튼을 찾을 수 없음');
      }

      // 2. 팝업 확인 및 날짜 추출
      const popupResult = await this.confirmPauseInPopup();
      if (!popupResult.confirmed) {
        // 팝업 없이 이미 일시중지된 상태인지 확인
        const isAlreadyPaused = await this.checkCurrentStatus(browser);
        if (isAlreadyPaused.isPaused) {
          this.log('이미 일시중지 상태', 'success');
          popupResult.confirmed = true;
          popupResult.resumeDate = isAlreadyPaused.nextBillingDate;
        } else {
          throw new Error('팝업 확인 실패');
        }
      }

      result.pauseDate = popupResult.pauseDate;
      result.resumeDate = popupResult.resumeDate;

      // 3. 최종 상태 확인
      const finalStatus = await this.verifyPauseSuccess();
      if (finalStatus.success) {
        result.success = true;
        
        // 날짜 정보 업데이트
        if (finalStatus.resumeDate && !result.resumeDate) {
          result.resumeDate = finalStatus.resumeDate;
        }
        
        // 팝업에서 날짜를 못 찾았지만 이전에 저장한 날짜가 있는 경우
        if (!result.resumeDate && this.savedNextBillingDate) {
          this.log('최종 검증에서도 날짜 미발견, 초기 저장 날짜 사용', 'info');
          result.resumeDate = this.savedNextBillingDate;
        }
      } else {
        throw new Error('일시중지 검증 실패');
      }

    } catch (error) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * 일시중지 버튼 클릭 (페이지 내용 변경 방식)
   * 멤버십 관리 버튼 클릭 후 페이지 내용에서 일시중지 버튼을 찾음
   */
  async clickPauseButton() {
    const lang = languages[this.currentLanguage];
    
    this.log('일시중지 버튼 탐색 시작', 'info');
    this.log(`현재 언어: ${this.currentLanguage} (${lang.name})`, 'info');
    this.log(`멤버십 관리 페이지 열림 상태: ${this.managementPageOpened}`, 'debug');
    
    // 현재 페이지에 이미 일시중지 버튼이 있는지 먼저 확인
    // 또는 checkCurrentStatus에서 이미 멤버십 관리 페이지를 열었는지 확인
    const alreadyInManagementPage = this.managementPageOpened || await this.page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      // Pause 또는 Resume 버튼이 있으면 이미 멤버십 관리 페이지에 있는 것
      return bodyText.includes('Pause') || bodyText.includes('일시중지') ||
             bodyText.includes('Resume') || bodyText.includes('재개') ||
             bodyText.includes('Tạm dừng') || bodyText.includes('Tiếp tục'); // 베트남어
    });
    
    let manageButtonClicked = false;
    
    // 이미 멤버십 관리 페이지에 있지 않은 경우에만 멤버십 관리 버튼 클릭
    if (!alreadyInManagementPage) {
      this.log('멤버십 관리 페이지가 아님, 멤버십 관리 버튼 클릭 필요', 'info');
      
      // "멤버십 관리" 버튼 찾기 및 클릭
      const manageButtonSelectors = [
        'button:has-text("멤버십 관리")',
        'button:has-text("Manage membership")',
        '[aria-label*="멤버십 관리"]',
        '[aria-label*="Manage membership"]',
        'ytd-button-renderer button'
      ];
      
      for (const selector of manageButtonSelectors) {
        try {
          const manageButton = await this.page.$(selector);
          if (manageButton) {
            const buttonText = await manageButton.evaluate(el => el.textContent || el.innerText);
            if (buttonText && (buttonText.includes('멤버십 관리') || buttonText.includes('Manage membership') || 
                              buttonText.includes('Quản lý gói thành viên') || buttonText.includes('Quản lý'))) {
              this.log(`멤버십 관리 버튼 발견: "${buttonText}"`, 'info');
              await manageButton.click();
              manageButtonClicked = true;
              this.log('멤버십 관리 버튼 클릭 성공', 'success');
              break;
            }
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (!manageButtonClicked) {
        // CSS 선택자로 못 찾으면 evaluate로 직접 찾기
        const clicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button'));
          for (const btn of buttons) {
            const text = btn.textContent || btn.innerText;
            if (text && (text.includes('멤버십 관리') || text.includes('Manage membership') || 
                        text.includes('Quản lý gói thành viên') || text.includes('Quản lý'))) {
              btn.click();
              return true;
            }
          }
          return false;
        });
        
        if (clicked) {
          manageButtonClicked = true;
          this.log('멤버십 관리 버튼 클릭 성공 (evaluate)', 'success');
        }
      }
    } else {
      this.log('이미 멤버십 관리 페이지에 있음, 멤버십 관리 버튼 클릭 건너뜀', 'success');
      
      // 이미 페이지에 있으므로 바로 일시중지 버튼 찾기로 진행
      const currentPageContent = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.map(btn => btn.textContent?.trim()).filter(t => t).slice(0, 10);
      });
      this.log(`현재 페이지의 버튼들: ${currentPageContent.join(', ')}`, 'debug');
    }
    
    // 멤버십 관리 버튼을 클릭한 경우에만 대기
    if (manageButtonClicked) {
      // 멤버십 관리 버튼 클릭 후 페이지가 업데이트될 때까지 충분히 대기
      this.log('멤버십 관리 페이지 로딩 대기 (7초)...', 'info');
      await new Promise(resolve => setTimeout(resolve, 7000));
      
      // 멤버십 관리 버튼 클릭 후 만료 상태 확인
      // afterManageClick를 true로 설정하여 정확한 만료 판단
      // Frame-safe 버튼 서비스 사용
      const EnhancedButtonInteractionService = require('../../services/EnhancedButtonInteractionService');
      const buttonService = new EnhancedButtonInteractionService({
        debugMode: true,
        frameRecoveryEnabled: true
      });
      const expiredCheck = await buttonService.checkSubscriptionExpired(this.page, true);
      
      if (expiredCheck.isExpired) {
        this.log(`⚠️ 구독이 만료됨: ${expiredCheck.indicator}`, 'warning');
        throw new Error('MEMBERSHIP_EXPIRED');
      }
      
      // 페이지 업데이트 확인
      const pageUpdated = await this.page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        return bodyText.includes('Pause') || bodyText.includes('일시중지') ||
               bodyText.includes('Resume') || bodyText.includes('재개');
      });
      
      if (pageUpdated) {
        this.log('멤버십 관리 페이지 로드 완료', 'success');
      } else {
        this.log('페이지 업데이트 확인 실패, 계속 진행', 'warning');
      }
    } else if (!alreadyInManagementPage) {
      this.log('멤버십 관리 버튼을 찾을 수 없음, 일시중지 버튼 직접 탐색', 'warning');
    }
    
    // 페이지 내에서 일시중지 관련 요소 찾기
    this.log('페이지 내에서 일시중지 요소 탐색', 'info');
    
    // 현재 언어에 맞는 일시중지 버튼 텍스트 배열 준비
    const pauseButtonTexts = [
      ...(lang.buttons.pause || []),
      ...(lang.buttons.pauseMembership || []),
      // 러시아어 특별 처리
      'Приостановить', 
      'Пауза',
      'Приостановить подписку',
      'Приостановить членство',
      // 영어 fallback
      'Pause',
      'Pause membership',
      // 한국어 fallback
      '일시중지',
      '멤버십 일시중지'
    ];
    
    this.log(`찾을 버튼 텍스트: ${pauseButtonTexts.join(', ')}`, 'debug');
    
    const pauseInfo = await this.page.evaluate((pauseTexts) => {
      const result = {
        found: false,
        element: null,
        text: null,
        type: null
      };
      
      // 모든 텍스트 요소 확인
      const allElements = document.querySelectorAll('*');
      
      for (const el of allElements) {
        const text = el.textContent?.trim();
        
        // "멤버십 일시중지" 텍스트를 포함하는 요소 찾기
        if (text && (text.includes('멤버십 일시중지') || text.includes('Pause membership'))) {
          // 해당 요소의 자식 요소 중 클릭 가능한 버튼/링크 찾기
          const clickableElements = el.querySelectorAll('button, a, [role="button"], [role="link"]');
          
          for (const clickable of clickableElements) {
            const clickableText = clickable.textContent?.trim();
            
            // 일시중지 버튼 찾기
            if (clickableText && pauseTexts.some(pauseText => 
              clickableText === pauseText || clickableText.includes(pauseText)
            )) {
              result.found = true;
              result.text = clickableText;
              result.type = clickable.tagName.toLowerCase();
              
              // 클릭
              if (clickable.offsetHeight > 0) {
                clickable.click();
                return result;
              }
            }
          }
        }
        
        // 단독 "일시중지" 버튼 찾기
        if (text && pauseTexts.some(pauseText => text === pauseText)) {
          if (el.tagName === 'BUTTON' || el.tagName === 'A' || 
              el.getAttribute('role') === 'button') {
            
            result.found = true;
            result.text = text;
            result.type = el.tagName.toLowerCase();
            
            if (el.offsetHeight > 0) {
              el.click();
              return result;
            }
          }
        }
      }
      
      // 찾지 못한 경우 더 넓은 검색
      if (!result.found) {
        // 모든 버튼과 링크 확인
        const buttons = document.querySelectorAll('button, a[role="button"]');
        for (const btn of buttons) {
          const btnText = btn.textContent?.trim();
          if (btnText && pauseTexts.some(pauseText => 
            btnText === pauseText || btnText.includes(pauseText)
          )) {
            if (btn.offsetHeight > 0) {
              btn.click();
              result.found = true;
              result.text = btnText;
              result.type = btn.tagName.toLowerCase();
              return result;
            }
          }
        }
      }
      
      return result;
    }, pauseButtonTexts);
    
    if (pauseInfo.found) {
      this.log(`일시중지 버튼 클릭 성공: "${pauseInfo.text}" (${pauseInfo.type})`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      return true;
    }
    
    // 일시중지 버튼을 찾지 못한 경우 스크롤 시도
    this.log('일시중지 버튼을 찾지 못함. 페이지 스크롤 시도', 'warning');
    
    await this.page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    
    await new Promise(r => setTimeout(r, 1000));
    
    // 스크롤 후 다시 시도
    const pauseInfoAfterScroll = await this.page.evaluate((pauseTexts) => {
      const buttons = document.querySelectorAll('button, a[role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && pauseTexts.some(pauseText => 
          btnText === pauseText || btnText.includes(pauseText)
        )) {
          if (btn.offsetHeight > 0) {
            btn.click();
            return {
              found: true,
              text: btnText
            };
          }
        }
      }
      return { found: false };
    }, pauseButtonTexts);
    
    if (pauseInfoAfterScroll.found) {
      this.log(`스크롤 후 일시중지 버튼 클릭 성공: "${pauseInfoAfterScroll.text}"`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      return true;
    }
    
    // 일시중지 버튼을 찾지 못한 경우 - 먼저 결제 수단 문제 확인
    this.log('일시중지 버튼을 찾을 수 없음. 원인 분석 중...', 'warning');

    // 결제 수단 문제 확인
    const paymentIssueCheck = await this.page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const indicators = {
        hasPaymentIssue: false,
        hasUpdatePaymentButton: false,
        hasActionNeeded: false,
        hasPaymentError: false,
        detectedText: null
      };

      // "Action needed" 또는 "Update payment method" 텍스트 확인
      if (bodyText.includes('Action needed') ||
          bodyText.includes('update payment method') ||
          bodyText.includes('Update payment method') ||
          bodyText.includes('Payment method problem') ||
          bodyText.includes('결제 수단 문제') ||
          bodyText.includes('결제 방법 업데이트') ||
          bodyText.includes('작업 필요') ||
          // 러시아어 추가
          bodyText.includes('Не удалось списать средства за подписку') ||
          bodyText.includes('Не удалось обработать платеж') ||
          bodyText.includes('срок ее действия закончится через') ||
          bodyText.includes('обновите платежные данные') ||
          bodyText.includes('подписка будет приостановлена') ||
          // 기타 언어
          bodyText.includes('支付方式有问题') ||
          bodyText.includes('お支払い方法の問題') ||
          bodyText.includes('Problema con el método de pago')) {
        indicators.hasActionNeeded = true;
        indicators.hasPaymentIssue = true;
        indicators.detectedText = 'Action needed or payment update text';
      }

      // "Update payment method" 버튼 확인
      const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));
      for (const button of buttons) {
        const text = button.textContent?.trim() || '';
        if (text.includes('Update payment') ||
            text.includes('결제 수단 업데이트') ||
            text.includes('결제 방법 업데이트') ||
            // 러시아어 버튼 추가
            text.includes('Обновить способ оплаты') ||
            text.includes('обновите платежные данные') ||
            text.includes('Изменить способ оплаты') ||
            // 기타 언어
            text.includes('更新付款方式') ||
            text.includes('お支払い方法を更新')) {
          indicators.hasUpdatePaymentButton = true;
          indicators.hasPaymentIssue = true;
          indicators.detectedText = text;
          break;
        }
      }

      // 결제 오류 메시지 확인
      if (bodyText.includes('payment failed') ||
          bodyText.includes('payment declined') ||
          bodyText.includes('결제 실패') ||
          bodyText.includes('결제가 거부됨') ||
          // 러시아어 결제 오류
          bodyText.includes('Не удалось списать средства') ||
          bodyText.includes('Не удалось обработать платеж') ||
          bodyText.includes('платеж не прошел') ||
          bodyText.includes('Платеж отклонен') ||
          bodyText.includes('Ошибка оплаты') ||
          // 일본어
          bodyText.includes('支払いに失敗') ||
          bodyText.includes('決済エラー') ||
          // 중국어
          bodyText.includes('支付失败') ||
          bodyText.includes('付款失败') ||
          // 스페인어
          bodyText.includes('pago rechazado') ||
          bodyText.includes('error de pago') ||
          // 포르투갈어
          bodyText.includes('pagamento falhou') ||
          bodyText.includes('pagamento recusado')) {
        indicators.hasPaymentError = true;
        indicators.hasPaymentIssue = true;
        indicators.detectedText = 'Payment error message';
      }

      return indicators;
    });

    // 결제 수단 문제가 감지된 경우
    if (paymentIssueCheck.hasPaymentIssue) {
      this.log(`❌ 결제 수단 문제 감지됨: ${paymentIssueCheck.detectedText}`, 'error');
      this.log('• Update payment button 존재: ' + (paymentIssueCheck.hasUpdatePaymentButton ? '✅' : '❌'), 'debug');
      this.log('• Action needed 메시지: ' + (paymentIssueCheck.hasActionNeeded ? '✅' : '❌'), 'debug');
      this.log('• Payment error 메시지: ' + (paymentIssueCheck.hasPaymentError ? '✅' : '❌'), 'debug');

      // 스크린샷 저장
      const screenshotPath = `screenshots/payment-issue-${Date.now()}.png`;
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      this.log(`📸 결제 문제 스크린샷 저장: ${screenshotPath}`, 'info');

      // ========================================
      // v2.0: 결제 복구 시도 (2024-12-09 추가)
      // ========================================
      console.log('\n' + '='.repeat(60));
      console.log(chalk.magenta('🔧 [PaymentRecovery v2.0] 결제 복구 프로세스 시작'));
      console.log('='.repeat(60));

      this.log('💳 결제 복구 시도 중... (Update payment method → CONTINUE → PAY NOW → OK)', 'info');

      try {
        const ButtonInteractionService = require('../../services/ButtonInteractionService');
        const buttonService = new ButtonInteractionService({ debugMode: true });

        console.log(chalk.cyan('  📍 ButtonInteractionService 로드 완료'));
        console.log(chalk.cyan('  📍 attemptPaymentRecovery() 호출 시작...'));

        const recoveryResult = await buttonService.attemptPaymentRecovery(this.page);

        console.log(chalk.cyan(`  📍 attemptPaymentRecovery() 완료: success=${recoveryResult.success}, recovered=${recoveryResult.recovered}`));

        if (recoveryResult.success && recoveryResult.recovered) {
          // 재결제 성공 - 특별한 상태로 반환
          console.log(chalk.green('  🎉 결제 복구 성공!'));
          this.log('🎉 결제 복구 성공! 다시 확인이 필요합니다.', 'info');
          throw new Error('PAYMENT_RECOVERED_NEED_RECHECK');
        } else {
          // 결제 복구 실패 - 기존처럼 PAYMENT_METHOD_ISSUE 반환
          console.log(chalk.red(`  ❌ 결제 복구 실패: ${recoveryResult.error}`));
          this.log(`❌ 결제 복구 실패: ${recoveryResult.error}`, 'error');
          throw new Error('PAYMENT_METHOD_ISSUE');
        }
      } catch (recoveryError) {
        // 결제 복구 과정에서 예외 발생시
        if (recoveryError.message === 'PAYMENT_RECOVERED_NEED_RECHECK' ||
            recoveryError.message === 'PAYMENT_METHOD_ISSUE') {
          // 정상적인 throw - 다시 던지기
          throw recoveryError;
        }
        // 예상치 못한 오류
        console.log(chalk.red(`  ❌ 결제 복구 중 예외 발생: ${recoveryError.message}`));
        this.log(`❌ 결제 복구 중 예외 발생: ${recoveryError.message}`, 'error');
        throw new Error('PAYMENT_METHOD_ISSUE');
      }
    }

    // 결제 수단 문제가 아닌 경우 만료 상태 확인
    this.log('결제 수단 문제 아님. 만료 상태 확인 중...', 'info');

    // 멤버십 관리 페이지가 열린 후 만료 상태 확인 (방어적 업데이트)
    // - "Benefits end:" + "Renew" 버튼 패턴도 확인
    // Frame-safe 버튼 서비스 사용
    const EnhancedButtonInteractionService = require('../../services/EnhancedButtonInteractionService');
    const buttonService = new EnhancedButtonInteractionService({
      debugMode: true,
      frameRecoveryEnabled: true
    });
    const expiredCheck = await buttonService.checkSubscriptionExpired(this.page, true);

    // 디버그 로깅
    console.log(chalk.gray(`📊 [ExpiredCheck-PauseNotFound] 만료 상태 확인 결과:`));
    console.log(chalk.gray(`  - isExpired: ${expiredCheck.isExpired}`));
    console.log(chalk.gray(`  - hasBenefitsEnd: ${expiredCheck.hasBenefitsEnd}`));
    console.log(chalk.gray(`  - hasRenewButton: ${expiredCheck.hasRenewButton}`));
    console.log(chalk.gray(`  - hasPauseButton: ${expiredCheck.hasPauseButton}`));
    if (expiredCheck.indicator) {
      console.log(chalk.gray(`  - indicator: ${expiredCheck.indicator}`));
    }

    if (expiredCheck.isExpired || expiredCheck.expired) {
      this.log(`⚠️ 구독이 만료됨: ${expiredCheck.indicator}`, 'warning');
      console.log(chalk.yellow(`⚠️ [SubscriptionExpired] Pause 버튼 미발견 후 만료 감지: ${expiredCheck.indicator}`));
      throw new Error('MEMBERSHIP_EXPIRED');
    }
    
    // 만료되지 않았으면 단순히 버튼을 찾지 못한 것
    this.log('일시중지 버튼을 찾을 수 없습니다', 'error');
    return false;
  }

  /**
   * 팝업 확인 및 날짜 추출
   */
  async confirmPauseInPopup() {
    this.log('팝업 확인 시작', 'debug');

    // 버튼 클릭 후 DOM 안정화 대기
    await new Promise(r => setTimeout(r, 2000));

    // 팝업이 나타날 때까지 대기 (최대 15초)
    let popupFound = false;
    let attempts = 0;
    const maxAttempts = 15;

    while (!popupFound && attempts < maxAttempts) {
      attempts++;
      this.log(`팝업 대기 중... (${attempts}/${maxAttempts})`, 'debug');

      try {
        // 팝업 체크 - 더 포괄적인 선택자 사용
        const hasPopup = await this.page.evaluate(() => {
        // 다양한 팝업 선택자
        const popupSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog',
          'ytd-popup-container',
          'tp-yt-iron-dropdown',
          'yt-dialog',
          '.ytd-popup-container',
          'div[slot="content"]',
          '[dialog-type]',
          'iron-overlay-backdrop + *',
          '.opened',
          '.style-scope.ytd-popup-container'
        ];
        
        for (const selector of popupSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.offsetHeight > 0 && element.offsetWidth > 0) {
              const text = element.textContent || '';
              // 팝업 내용 확인 (더 넓은 키워드)
              if (text.includes('Pause') || text.includes('일시중지') || 
                  text.includes('membership') || text.includes('멤버십') ||
                  text.includes('subscription') || text.includes('구독') ||
                  text.includes('billing') || text.includes('결제') ||
                  text.includes('YouTube Premium')) {
                console.log('팝업 발견:', selector, '- 내용 길이:', text.length);
                return true;
              }
            }
          }
        }
        
        // 페이지에 오버레이가 있는지 확인
        const hasOverlay = !!document.querySelector('iron-overlay-backdrop:not([hidden])');
        if (hasOverlay) {
          console.log('오버레이 감지됨');
        }
        
        return false;
      });

      if (hasPopup) {
        popupFound = true;
        this.log('팝업 발견!', 'success');
        break;
      }
      } catch (error) {
        // Frame detached 오류 처리
        if (error.message.includes('detached') || error.message.includes('Execution context')) {
          this.log('Frame detached 오류 발생, 재시도...', 'warning');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw error;
      }

      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!popupFound) {
      this.log('팝업이 나타나지 않음', 'warning');
      
      // 팝업 없이 페이지가 바로 변경된 경우 확인
      try {
        const pageChanged = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes('Resume membership') ||
                 bodyText.includes('멤버십 재개') ||
                 bodyText.includes('Your membership is paused') ||
                 bodyText.includes('멤버십이 일시중지');
        });

        if (pageChanged) {
          this.log('팝업 없이 일시중지 성공', 'success');
          return { confirmed: true, pauseDate: null, resumeDate: null };
        }
      } catch (error) {
        this.log('페이지 변경 확인 중 오류 발생, 건너뜀', 'warning');
      }
    }
    
    const lang = languages[this.currentLanguage];
    const result = {
      confirmed: false,
      pauseDate: null,
      resumeDate: null
    };
    
    // 팝업 내용 상세 로깅 - 더 포괄적인 선택자
    let popupContent = null;
    try {
      popupContent = await this.page.evaluate(() => {
      const popupSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'ytd-popup-container',
        'tp-yt-iron-dropdown',
        'yt-dialog',
        '.ytd-popup-container',
        '.opened'
      ];
      
      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element.offsetHeight > 0 && element.offsetWidth > 0) {
            // 버튼 찾기 - 다양한 선택자
            const buttonSelectors = [
              'button',
              'tp-yt-paper-button',
              '[role="button"]',
              'yt-button-renderer',
              'ytd-button-renderer',
              'a[role="button"]',
              '.yt-spec-button-shape-next'
            ];
            
            const buttons = [];
            for (const btnSelector of buttonSelectors) {
              const btns = element.querySelectorAll(btnSelector);
              btns.forEach(btn => {
                const text = btn.textContent?.trim();
                if (text && !buttons.includes(text)) {
                  buttons.push(text);
                }
              });
            }
            
            return {
              selector: selector,
              text: element.textContent?.substring(0, 500) || '',
              buttons: buttons,
              className: element.className,
              id: element.id || 'no-id'
            };
          }
        }
      }
      return null;
    });
    } catch (error) {
      this.log('팝업 내용 추출 중 오류, 건너뜀', 'warning');
      popupContent = null;
    }

    if (popupContent) {
      this.log(`팝업 선택자: ${popupContent.selector}`, 'debug');
      this.log(`팝업 ID: ${popupContent.id}, 클래스: ${popupContent.className}`, 'debug');
      this.log(`팝업 내용: ${popupContent.text.substring(0, 200)}...`, 'debug');
      this.log(`팝업 버튼들: ${popupContent.buttons.join(', ')}`, 'debug');
    } else {
      this.log('팝업 콘텐츠를 가져올 수 없음', 'warning');
    }
    
    // 팝업에서 날짜 추출 및 확인 버튼 클릭
    let popupResult = null;
    try {
      popupResult = await this.page.evaluate((langData) => {
      console.log('팝업 버튼 찾기 시작...');
      
      const popupSelectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'ytd-popup-container',
        'tp-yt-iron-dropdown',
        'yt-dialog',
        '.opened'
      ];
      
      let dialog = null;
      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (element.offsetHeight > 0 && element.offsetWidth > 0) {
            dialog = element;
            console.log('활성 팝업 찾음:', selector);
            break;
          }
        }
        if (dialog) break;
      }
      
      if (dialog) {
        
        const popupText = dialog.textContent || '';
        const result = {
          hasPopup: true,
          clicked: false,
          dates: []
        };
        
        // 날짜 추출 - 각 언어별 패턴 (더 포괄적으로)
        const datePatterns = [
          // 영어 - 다양한 형식
          /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/gi,
          /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}/gi,
          /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)/gi,
          /\d{1,2}\/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)/gi,
          
          // 베트남어 YouTube 형식
          /\d{1,2}\s+thg\s+\d{1,2}/g,
          // 베트남어 표준
          /\d{1,2}\s+tháng\s+\d{1,2}/g,
          
          // 한국어
          /\d{1,2}월\s*\d{1,2}일/g,
          /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
          
          // 터키어
          /\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/gi,
          /\d{1,2}\s+(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)/gi,
          /(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\s+\d{1,2}/gi,
          /\d{1,2}\s+(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\s+\d{4}/gi,
          
          // 러시아어
          /\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/gi,
          
          // 포르투갈어 - 일시정지 날짜 패턴
          /após\s+(\d{1,2}\/\d{1,2})(?!\/)/gi,  // "após 4/10" 패턴
          /retomada\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/gi,  // "retomada a 04/11/2025" 패턴
          
          // 숫자 날짜 형식 (fallback)
          /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
          /\b\d{4}-\d{2}-\d{2}\b/g,
          /\b\d{2}\.\d{2}\.\d{4}\b/g
        ];
        
        // 포르투갈어 특별 처리 - 우선순위 높음
        if (popupText.includes('após') || popupText.includes('retomada')) {
          console.log('포르투갈어 팝업 감지');
          // após 패턴 찾기 (일시정지일)
          const aposMatch = popupText.match(/após\s+(\d{1,2}\/\d{1,2})(?!\/)/i);
          if (aposMatch) {
            console.log('포르투갈어 일시정지 날짜 찾음:', aposMatch[0]);
            if (!result.dates.includes(aposMatch[1])) {
              result.dates.push(aposMatch[1]); // 중복 방지
            }
          }
          // retomada 패턴 찾기 (재개일)
          const retomadaMatch = popupText.match(/retomada\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
          if (retomadaMatch) {
            console.log('포르투갈어 재개 날짜 찾음:', retomadaMatch[0]);
            if (!result.dates.includes(retomadaMatch[1])) {
              result.dates.push(retomadaMatch[1]); // 중복 방지
            }
          }
          
          // 포르투갈어는 특별 처리했으므로 일반 패턴 처리 건너뜀
          console.log('포르투갈어 날짜 추출 완료:', result.dates);
          
        } else {
          // 다른 언어는 기존 패턴 사용
          for (const pattern of datePatterns) {
            const matches = popupText.match(pattern);
            if (matches && matches.length > 0) {
              // 중복 제거
              for (const match of matches) {
                if (!result.dates.includes(match)) {
                  result.dates.push(match);
                }
              }
            }
          }
        }
        
        // 확인 버튼 클릭 - 다양한 선택자 사용
        const buttonSelectors = [
          'button',
          'tp-yt-paper-button', 
          '[role="button"]',
          'yt-button-renderer button',
          'ytd-button-renderer button',
          '.yt-spec-button-shape-next',
          'a[role="button"]'
        ];
        
        const allButtons = [];
        for (const selector of buttonSelectors) {
          const buttons = dialog.querySelectorAll(selector);
          buttons.forEach(btn => {
            if (!allButtons.includes(btn)) {
              allButtons.push(btn);
            }
          });
        }
        
        console.log(`팝업에서 ${allButtons.length}개 버튼 발견`);
        
        // 버튼 텍스트 우선순위 목록
        const buttonPriority = [
          // 영어
          'Pause membership',
          'Pause',
          'Confirm pause',
          'Yes, pause',
          'Confirm',
          'OK',
          'Continue',
          // 한국어
          '멤버십 일시중지',
          '일시중지',
          '일시중지 확인',
          '예, 일시중지',
          '확인',
          '계속',
          // 터키어
          'Üyeliği duraklat',
          'Duraklat',
          'Duraklatmayı onayla',
          'Evet, duraklat',
          'Onayla',
          'Tamam',
          'Devam',
          // 포르투갈어
          'Pausar subscrição',
          'Pausar',
          'Confirmar pausa',
          'Sim, pausar',
          'Confirmar',
          'OK',
          'Continuar',
          // 러시아어
          'Приостановить подписку',
          'Приостановить',
          'Подтвердить приостановку',
          'Да, приостановить',
          'Подтвердить',
          'ОК',
          'Продолжить',
        ];
        
        // 우선순위에 따라 버튼 찾기
        for (const targetText of buttonPriority) {
          for (const button of allButtons) {
            const btnText = button.textContent?.trim();
            
            if (btnText && (btnText === targetText || btnText.includes(targetText))) {
              console.log(`팝업 버튼 발견 및 클릭: "${btnText}"`);
              
              // 버튼이 보이는지 확인
              if (button.offsetHeight > 0 && button.offsetWidth > 0) {
                button.scrollIntoView({ behavior: 'instant', block: 'center' });
                button.click();
                result.clicked = true;
                console.log('버튼 클릭 완료!');
                return result;
              } else {
                console.log('버튼이 보이지 않음:', btnText);
              }
            }
          }
        }
        
        // 우선순위 매칭 실패 시 언어 데이터 기반 확인
        console.log('우선순위 매칭 실패, 언어 데이터 확인...');
        for (const button of allButtons) {
          const btnText = button.textContent?.trim();
          
          if (!btnText) continue;
          
          // 언어 데이터 기반 확인
          for (const pauseText of langData.buttons.pauseMembership) {
            if (btnText === pauseText || btnText.includes(pauseText)) {
              console.log(`팝업 버튼 클릭 (언어 데이터): "${btnText}"`);
              
              if (button.offsetHeight > 0 && button.offsetWidth > 0) {
                button.scrollIntoView({ behavior: 'instant', block: 'center' });
                button.click();
                result.clicked = true;
                return result;
              }
            }
          }
        }
        
        // 그래도 못 찾았으면 모든 버튼 정보 로깅
        console.log('적합한 버튼을 찾지 못함. 모든 버튼 텍스트:');
        allButtons.forEach((btn, index) => {
          const text = btn.textContent?.trim();
          if (text) {
            console.log(`  ${index + 1}. "${text}" (visible: ${btn.offsetHeight > 0})`);
          }
        });
      } else {
        console.log('활성 팝업을 찾을 수 없음');
      }
      
      return { hasPopup: false, clicked: false };
    }, lang);
    } catch (error) {
      this.log('팝업 버튼 처리 중 오류 발생', 'error');
      if (error.message.includes('detached') || error.message.includes('Execution context')) {
        this.log('Frame detached 오류 - 일시중지가 이미 완료되었을 수 있습니다', 'warning');
        // Frame detached는 페이지가 이동했다는 의미일 수 있으므로 성공으로 처리
        return { confirmed: true, pauseDate: null, resumeDate: null };
      }
      throw error;
    }

    if (popupResult && popupResult.clicked) {
      this.log('팝업 버튼 클릭 성공!', 'success');
      result.confirmed = true;
      
      if (popupResult.dates && popupResult.dates.length > 0) {
        this.log(`팝업에서 추출된 날짜: ${popupResult.dates.join(', ')}`, 'info');
        
        // 언어별 날짜 선택 전략 (실제 팝업 텍스트 기반)
        // 중요: YouTube Premium에서 "다음 결제일"은 일시정지가 시작되는 날
        
        let nextBillingDate = null;
        let resumeDate = null;
        
        // 팝업 텍스트에서 키워드 찾기
        const popupTextLower = (popupResult.popupText || '').toLowerCase();
        
        // 날짜가 2개 이상인 경우
        if (popupResult.dates.length >= 2) {
          // 언어별 처리
          if (this.currentLanguage === 'ko') {
            // 한국어: 첫 번째가 일시정지일(다음 결제일), 두 번째가 재개일
            nextBillingDate = popupResult.dates[0];
            resumeDate = popupResult.dates[1];
            this.log(`🇰🇷 한국어 패턴: 일시정지일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else if (this.currentLanguage === 'pt' || this.currentLanguage === 'pt-br') {
            // 포르투갈어(브라질): "pausada depois de" 또는 "após" 다음이 일시정지일
            // "retomado em" 다음이 재개일
            if (popupTextLower.includes('depois de') || popupTextLower.includes('após')) {
              // 날짜 순서: 재개일이 먼저, 일시정지일이 나중
              // "retomado em 7 de nov" ... "pausada depois de 7 de out"
              // 더 가까운 날짜가 일시정지일
              const parsed1 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
              const parsed2 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
              
              // 더 가까운 날짜를 일시정지일로
              if (new Date(parsed1) < new Date(parsed2)) {
                nextBillingDate = popupResult.dates[0];
                resumeDate = popupResult.dates[1];
              } else {
                nextBillingDate = popupResult.dates[1];
                resumeDate = popupResult.dates[0];
              }
            } else {
              // 기본: 첫 번째가 재개일, 두 번째가 일시정지일
              resumeDate = popupResult.dates[0];
              nextBillingDate = popupResult.dates[1];
            }
            this.log(`🇧🇷 포르투갈어 패턴: 일시정지일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else if (this.currentLanguage === 'pt-pt') {
            // 포르투갈어(포르투갈): "em pausa após" 다음이 일시정지일
            // 보통 DD/MM 형식이 일시정지일, DD/MM/YYYY가 재개일
            const hasYear1 = popupResult.dates[0].includes('202');
            const hasYear2 = popupResult.dates[1] && popupResult.dates[1].includes('202');
            
            if (hasYear1 && !hasYear2) {
              // 첫 번째에만 연도 → 첫 번째가 재개일
              resumeDate = popupResult.dates[0];
              nextBillingDate = popupResult.dates[1];
            } else if (!hasYear1 && hasYear2) {
              // 두 번째에만 연도 → 두 번째가 재개일
              nextBillingDate = popupResult.dates[0];
              resumeDate = popupResult.dates[1];
            } else {
              // 더 가까운 날짜가 일시정지일
              const parsed1 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
              const parsed2 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
              
              if (new Date(parsed1) < new Date(parsed2)) {
                nextBillingDate = popupResult.dates[0];
                resumeDate = popupResult.dates[1];
              } else {
                nextBillingDate = popupResult.dates[1];
                resumeDate = popupResult.dates[0];
              }
            }
            this.log(`🇵🇹 포르투갈어(PT) 패턴: 일시정지일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else if (this.currentLanguage === 'ru') {
            // 러시아어: "приостановлена... то есть" 다음이 일시정지일
            // "снова начнут списываться" 다음이 재개일
            // 보통 첫 번째가 재개일, 두 번째가 일시정지일
            if (popupTextLower.includes('то есть')) {
              // 더 가까운 날짜가 일시정지일
              const parsed1 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
              const parsed2 = this.dateParser ? 
                this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
              
              if (new Date(parsed1) < new Date(parsed2)) {
                nextBillingDate = popupResult.dates[0];
                resumeDate = popupResult.dates[1];
              } else {
                nextBillingDate = popupResult.dates[1];
                resumeDate = popupResult.dates[0];
              }
            } else {
              resumeDate = popupResult.dates[0];
              nextBillingDate = popupResult.dates[1];
            }
            this.log(`🇷🇺 러시아어 패턴: 일시정지일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else if (this.currentLanguage === 'vi') {
            // 베트남어: "tạm dừng sau" 다음이 일시정지일
            // "tiếp tục vào" 다음이 재개일
            // 더 가까운 날짜가 일시정지일
            const parsed1 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
            const parsed2 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
            
            if (new Date(parsed1) < new Date(parsed2)) {
              nextBillingDate = popupResult.dates[0];
              resumeDate = popupResult.dates[1];
            } else {
              nextBillingDate = popupResult.dates[1];
              resumeDate = popupResult.dates[0];
            }
            this.log(`🇻🇳 베트남어 패턴: 일시정지일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else if (this.currentLanguage === 'en' || this.currentLanguage === 'en-us') {
            // 영어: "paused until [date]" → 날짜는 재개일
            // 더 가까운 날짜를 다음 결제일로 사용
            const parsed1 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
            const parsed2 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
            
            // 더 가까운 날짜를 다음 결제일로 사용
            if (new Date(parsed1) < new Date(parsed2)) {
              nextBillingDate = popupResult.dates[0];
              resumeDate = popupResult.dates[1];
            } else {
              nextBillingDate = popupResult.dates[1];
              resumeDate = popupResult.dates[0];
            }
            this.log(`🇺🇸 영어 패턴: 다음결제일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
            
          } else {
            // 기타 언어: 더 가까운 날짜를 다음 결제일로 사용
            const parsed1 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[0], this.currentLanguage) : popupResult.dates[0];
            const parsed2 = this.dateParser ? 
              this.dateParser.parseDate(popupResult.dates[1], this.currentLanguage) : popupResult.dates[1];
            
            if (new Date(parsed1) < new Date(parsed2)) {
              nextBillingDate = popupResult.dates[0];
              resumeDate = popupResult.dates[1];
            } else {
              nextBillingDate = popupResult.dates[1];
              resumeDate = popupResult.dates[0];
            }
            this.log(`🌍 기타 언어(${this.currentLanguage}): 다음결제일="${nextBillingDate}", 재개일="${resumeDate}"`, 'info');
          }
        } else if (popupResult.dates.length === 1) {
          // 날짜가 하나만 있는 경우
          // 대부분 일시정지일(다음 결제일)로 간주
          nextBillingDate = popupResult.dates[0];
          this.log(`📅 단일 날짜를 다음 결제일로 사용: ${nextBillingDate}`, 'warning');
        }
        
        // 파싱 수행
        if (nextBillingDate) {
          result.pauseDate = this.dateParser ? 
            this.dateParser.parseDate(nextBillingDate, this.currentLanguage) : nextBillingDate;
          this.log(`✅ 다음 결제일(일시정지일) 파싱: ${nextBillingDate} → ${result.pauseDate}`, 'success');
        }
        
        if (resumeDate) {
          result.resumeDate = this.dateParser ? 
            this.dateParser.parseDate(resumeDate, this.currentLanguage) : resumeDate;
          this.log(`✅ 재개일 파싱: ${resumeDate} → ${result.resumeDate}`, 'success');
        }
      } else {
        // 날짜를 못 찾은 경우 디버깅 정보 출력
        this.log('팝업에서 날짜를 찾지 못함 - 팝업 내용 확인 필요', 'warning');
        
        // 팝업 내용 샘플링 (디버그용)
        if (this.debugMode) {
          const popupSample = await this.page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], tp-yt-paper-dialog');
            for (const dialog of dialogs) {
              if (dialog.offsetHeight > 0) {
                return dialog.textContent?.substring(0, 200) || '';
              }
            }
            return '';
          });
          this.log(`팝업 내용 샘플: ${popupSample}`, 'debug');
        }
      }
      
      await new Promise(r => setTimeout(r, 5000));
    } else {
      this.log('팝업 버튼 클릭 실패', 'error');
      
      // 실패 시 스크린샷 저장
      try {
        const timestamp = Date.now();
        await this.page.screenshot({ 
          path: `popup_error_${timestamp}.png`,
          fullPage: false
        });
        this.log(`팝업 오류 스크린샷 저장: popup_error_${timestamp}.png`, 'debug');
      } catch (e) {
        // 무시
      }
    }
    
    return result;
  }

  /**
   * 일시중지 성공 확인
   */
  async verifyPauseSuccess() {
    // 페이지 새로고침
    await this.page.goto('https://www.youtube.com/paid_memberships', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // 멤버십 관리 버튼 클릭
    await this.clickManageButton();
    
    const lang = languages[this.currentLanguage];
    
    // Resume 버튼 확인
    const status = await this.page.evaluate((langData) => {
      const result = {
        success: false,
        resumeDate: null
      };
      
      // Resume 버튼 확인
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && langData.buttons.resume.some(resumeText => btnText.includes(resumeText))) {
          result.success = true;
          break;
        }
      }
      
      // 날짜 추출 - 각 언어별 패턴
      const pageText = document.body?.textContent || '';
      const datePatterns = [
        // 영어
        /(?:Next billing date:\s*)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i,
        // 베트남어 YouTube 형식
        /(?:Ngày thanh toán tiếp theo:\s*)?(\d{1,2}\s+thg\s+\d{1,2})/i,
        // 베트남어 표준
        /(?:Ngày thanh toán tiếp theo:\s*)?(\d{1,2}\s+tháng\s+\d{1,2})/i,
        // 한국어
        /(?:다음 결제일:\s*)?(\d{1,2}월\s+\d{1,2}일)/i,
        // 터키어
        /(?:Sonraki faturalandırma:\s*)?(\d{1,2}\s+(?:Ocak|Mart|Şubat|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık))/i,
        // 러시아어
        /(?:Следующий платёж:\s*)?(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/i
      ];
      
      for (const pattern of datePatterns) {
        const dateMatch = pageText.match(pattern);
        if (dateMatch) {
          // "다음 결제일: " 등의 접두사 제거
          result.resumeDate = dateMatch[1] || dateMatch[0].replace(/.*:\s*/, '');
          break;
        }
      }
      
      return result;
    }, lang);
    
    if (status.resumeDate) {
      // EnhancedDateParsingService 사용하여 상세 로그와 함께 날짜 파싱
      status.resumeDate = this.dateParser ? 
        this.dateParser.parseDate(status.resumeDate, this.currentLanguage) : 
        status.resumeDate;
    }
    
    return status;
  }

  /**
   * Google Sheets 업데이트
   */
  async updateGoogleSheets(profileId, result) {
    try {
      if (!this.pauseSheetRepository) {
        this.log('Google Sheets Repository가 설정되지 않음', 'warning');
        return;
      }

      await this.pauseSheetRepository.initialize();
      
      // 이메일로 검색하도록 변경
      const email = this.profileData?.email || this.profileData?.googleId;
      if (!email) {
        this.log('이메일 정보가 없어 프로필 ID로 시도', 'warning');
        // email이 없으면 프로필 ID로 fallback
      }
      
      const searchIdentifier = email || profileId;
      
      let updateData;
      
      // reCAPTCHA 감지된 경우
      if (result.status === 'recaptcha_detected' || result.recaptchaDetected) {
        updateData = {
          status: '번호인증필요',
          result: '번호인증계정',
          note: 'reCAPTCHA 감지 - 수동 로그인 필요'
        };
      } else if (result.success) {
        // 성공 케이스를 더 상세하게 구분
        let detailedResult = '';
        let detailedNote = '';
        
        if (result.status === 'already_paused') {
          // 이미 일시중지 상태였던 경우
          detailedResult = '이미 일시중지됨';
          detailedNote = `✅ 이미 일시중지 상태 | 언어: ${languages[this.currentLanguage].name} | 재개예정: ${result.resumeDate || result.nextBillingDate || 'N/A'}`;
        } else if (result.status === 'paused') {
          // 새로 일시중지한 경우
          detailedResult = '신규 일시중지 성공';
          detailedNote = `🆕 신규 일시중지 완료 | 언어: ${languages[this.currentLanguage].name} | 일시중지일: ${new Date().toLocaleDateString('ko-KR')} | 재개예정: ${result.resumeDate || result.nextBillingDate || 'N/A'}`;
        } else {
          // 기타 성공 케이스
          detailedResult = '성공';
          detailedNote = `✅ 작업 완료 | 언어: ${languages[this.currentLanguage].name} | 상태: ${result.status}`;
        }
        
        updateData = {
          status: '일시중지',
          result: detailedResult,
          nextBillingDate: result.nextBillingDate, // 일시정지일(다음 결제일) 저장
          note: detailedNote
        };
      } else {
        updateData = {
          status: '오류',
          result: result.error || '실패',
          note: `오류: ${result.error}`,
          error: result.error // 오류 정보 전달 (ErrorClassifier가 처리)
        };
      }
      
      const updated = await this.pauseSheetRepository.updatePauseStatus(searchIdentifier, updateData);
      
      if (updated) {
        this.log('Google Sheets 업데이트 성공', 'success');
      } else {
        this.log('Google Sheets 업데이트 실패', 'warning');
      }
    } catch (error) {
      this.log(`Sheets 업데이트 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 스크린샷 캡처
   */
  async captureScreenshot(profileId, result) {
    try {
      if (!this.page) {
        this.log('스크린샷 캡처 실패: 페이지 객체 없음', 'warning');
        return;
      }

      // 스크린샷 디렉토리 생성
      const screenshotDir = path.join(process.cwd(), 'logs', 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });

      // 파일명 생성: 날짜-시간-계정아이디
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS
      const email = this.profileData.email || this.profileData.googleId || 'unknown';
      const cleanEmail = email.replace(/@.*/, ''); // @ 이후 제거
      const status = result.success ? 'success' : 'failed';
      
      const filename = `${dateStr}_${timeStr}_${cleanEmail}_${status}.png`;
      const filepath = path.join(screenshotDir, filename);

      // 스크린샷 캡처
      await this.page.screenshot({
        path: filepath,
        fullPage: false // 현재 보이는 화면만
      });

      this.log(`📷 스크린샷 저장: ${filename}`, 'info');
      
      // Logger가 있으면 로깅
      if (this.logger && typeof this.logger.info === 'function') {
        await this.logger.info(`스크린샷 저장됨`, {
          profileId,
          email,
          filename,
          path: filepath,
          status
        });
      }
      
    } catch (error) {
      this.log(`스크린샷 캡처 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 브라우저 연결 해제
   */
  async disconnectBrowser(profileId) {
    try {
      // 대체 ID로 연결한 경우 actualProfileId 사용
      const actualId = this.actualProfileId || profileId;
      if (actualId) {
        if (this.actualProfileId && this.actualProfileId !== profileId) {
          console.log(chalk.yellow(`[브라우저 종료] 대체 ID 사용: ${actualId} (원래 ID: ${profileId})`));
        } else {
          console.log(chalk.gray(`[브라우저 종료] AdsPower ID: ${actualId}`));
        }
        await this.adsPowerAdapter.closeBrowser(actualId);
      }
      this.browser = null;
      this.page = null;
      this.controller = null; // controller도 정리
    } catch (error) {
      // 오류가 발생해도 로컬 참조는 정리
      this.browser = null;
      this.page = null;
      this.controller = null;
      this.log(`브라우저 연결 해제 중 오류 (무시): ${error.message}`, 'debug');
    }
  }

  /**
   * 로그 출력
   */
  log(message, type = 'info') {
    const colors = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      debug: chalk.gray
    };
    
    const color = colors[type] || chalk.white;
    const prefix = type === 'success' ? '✅' : 
                   type === 'error' ? '❌' : 
                   type === 'warning' ? '⚠️' : 
                   type === 'debug' ? '🔍' : '📌';
    
    const timestamp = new Date().toISOString();
    const formattedMessage = `${timestamp} [${type.toUpperCase().padEnd(7)}] ${prefix} ${message}`;
    
    // 모든 로그 출력 (debug 포함)
    console.log(color(formattedMessage));
    
    // 로거에도 저장
    if (this.logger && this.logger.log) {
      this.logger.log(formattedMessage);
    }
  }
}

module.exports = EnhancedPauseSubscriptionUseCase;