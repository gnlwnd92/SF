/**
 * Backup Card Change Use Case
 * YouTube Premium 백업 결제수단 변경 메인 비즈니스 로직
 *
 * 워크플로우:
 * 1. Email → ProfileID 매핑 (Fallback 지원)
 * 2. 브라우저 실행 (여러 프로필 순차 시도)
 * 2.5. 프록시 안정화 대기 (ERR_CONNECTION_CLOSED 방지)
 * 3. IP 주소 확인
 * 4. 카드/주소 선택 (미리 지정 또는 랜덤)
 * 5. 프로필 데이터 조회 (로그인 필요시 사용)
 * 6. YouTube Premium 페이지 이동 및 로그인 상태 확인
 *    → 이미 로그인되어 있으면 스킵
 *    → 로그인 필요시 자동 Google 로그인
 * 7. Manage membership 버튼 클릭
 * 7.5. Backup payment method Edit 버튼 클릭
 * 8. 백업 결제수단 추가 (2가지 팝업 자동 감지)
 * 9. 사용 기록 업데이트
 * 10. 백업카드변경 시트 업데이트
 * 11. 브라우저 종료
 */

const fs = require('fs').promises;
const path = require('path');

class BackupCardChangeUseCase {
  constructor({
    adsPowerAdapter,
    youtubePaymentAdapter,
    backupCardRepository,
    logger,
    sessionLogger,          // 세션 전체 추적
    detailedErrorLogger,    // 단계별 에러 추적
    dateParser,             // EnhancedDateParsingService
    buttonService,          // ButtonInteractionService
    navigationService,      // NavigationService
    authService,            // ImprovedAuthenticationService
    backupCardService,      // BackupCardService
    ipService,              // IPService
    languageService,        // LanguageService
    popupService,           // PopupService
    errorClassifier         // ErrorClassifier
  }) {
    // 의존성 주입
    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubePaymentAdapter = youtubePaymentAdapter;
    this.backupCardRepository = backupCardRepository;
    this.logger = logger || console;
    this.sessionLogger = sessionLogger;
    this.detailedErrorLogger = detailedErrorLogger;
    this.dateParser = dateParser;
    this.buttonService = buttonService;
    this.navigationService = navigationService;
    this.authService = authService;
    this.backupCardService = backupCardService;
    this.ipService = ipService;
    this.languageService = languageService;
    this.popupService = popupService;
    this.errorClassifier = errorClassifier;

    // Workflow 설정
    this.workflowTimeout = 5 * 60 * 1000; // 5분
    this.maxStuckTime = 30 * 1000;        // 30초
  }

  /**
   * 백업카드 변경 실행 (메인 진입점)
   * @param {string} email - 대상 이메일
   * @param {Object} options - 옵션 { cardName?, addressName?, debugMode? }
   * @returns {Object} 실행 결과
   */
  async execute(email, options = {}) {
    const startTime = Date.now();

    // ProfileID는 나중에 결정되므로 임시 ID 사용
    const tempProfileId = `backup-card-${email}`;

    // SessionLogger에 프로필 작업 시작 기록
    if (this.sessionLogger) {
      this.sessionLogger.startProfile(tempProfileId, email);
    }

    // Workflow timeout 설정
    let workflowTimeout;
    let stuckChecker;
    let currentStep = '초기화';
    let lastProgressTime = Date.now();

    const updateProgress = (step) => {
      currentStep = step;
      lastProgressTime = Date.now();
      this.logger.info(`[BackupCardChangeUseCase] 🔄 진행 단계: ${step}`);
    };

    // Stuck detection (30초)
    stuckChecker = setInterval(() => {
      const stuckTime = Date.now() - lastProgressTime;
      if (stuckTime > this.maxStuckTime) {
        this.logger.error(
          `[BackupCardChangeUseCase] ⚠️ 워크플로우 정체 감지: ${currentStep} (${Math.floor(stuckTime / 1000)}초)`
        );
      }
    }, 5000);

    // Workflow timeout (5분)
    const timeoutPromise = new Promise((_, reject) => {
      workflowTimeout = setTimeout(() => {
        reject(new Error(`워크플로우 타임아웃 (5분 초과): ${currentStep}`));
      }, this.workflowTimeout);
    });

    try {
      // 실제 워크플로우 실행
      const result = await Promise.race([
        this.runWorkflow(email, options, updateProgress, tempProfileId),
        timeoutPromise
      ]);

      // 실행 시간 기록
      result.duration = Date.now() - startTime;

      // SessionLogger에 성공 기록
      if (this.sessionLogger) {
        this.sessionLogger.endProfile(tempProfileId, result);
      }

      return result;

    } catch (error) {
      // 에러 발생시 duration 기록
      const duration = Date.now() - startTime;
      this.logger.error(`[BackupCardChangeUseCase] ❌ 실행 실패 (${Math.floor(duration / 1000)}초): ${error.message}`);

      // SessionLogger에 실패 기록
      if (this.sessionLogger) {
        this.sessionLogger.endProfile(tempProfileId, {
          email,
          success: false,
          error: error.message,
          duration: Math.floor(duration / 1000)
        });
      }

      throw error;

    } finally {
      // 정리
      clearTimeout(workflowTimeout);
      clearInterval(stuckChecker);
    }
  }

  /**
   * 백업카드 변경 워크플로우 실행 (11단계)
   * @param {string} email - 대상 이메일
   * @param {Object} options - 옵션
   * @param {Function} updateProgress - 진행 상황 업데이트 함수
   * @param {string} sessionId - 세션 ID
   * @returns {Object} 실행 결과
   */
  async runWorkflow(email, options, updateProgress, sessionId) {
    let profileId = null;
    let browser = null;
    let page = null;
    let selectedCard = null;
    let selectedAddress = null;
    let ipAddress = 'Unknown';
    const timestamp = Date.now(); // 스크린샷용 타임스탬프

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 1: 이메일 → ProfileID 매핑 (Fallback 지원)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 1: 이메일 → ProfileID 매핑');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 1: 이메일 → ProfileID 매핑 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('ProfileID 매핑', {
          email,
          method: 'findAllProfileIdsByEmail'
        });
      }

      const profileMatches = await this.backupCardRepository.findAllProfileIdsByEmail(email);

      if (!profileMatches || profileMatches.length === 0) {
        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('ProfileID 매핑', {
            success: false,
            error: '매칭된 프로필 없음'
          });
        }
        throw new Error(`이메일 ${email}에 매칭된 애즈파워 프로필이 없습니다`);
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ 매칭된 프로필 ${profileMatches.length}개 발견`);
      profileMatches.forEach((match, index) => {
        this.logger.info(`[BackupCardChangeUseCase]   ${index + 1}. ${match.profileId} (${match.profileName})`);
      });

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep('ProfileID 매핑', {
          success: true,
          matchCount: profileMatches.length,
          profiles: profileMatches.map(m => m.profileId)
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 2: 브라우저 실행 (Fallback 지원)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 2: 브라우저 실행 (Fallback)');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 2: 브라우저 실행 (Fallback) 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('브라우저 실행', {
          profileCount: profileMatches.length
        });
      }

      let browserOpened = false;
      let lastError = null;

      for (let i = 0; i < profileMatches.length; i++) {
        const match = profileMatches[i];
        profileId = match.profileId;

        try {
          this.logger.info(
            `[BackupCardChangeUseCase] 🔄 프로필 시도 ${i + 1}/${profileMatches.length}: ${profileId} (${match.profileName})`
          );

          // 기존 브라우저 종료 (있으면)
          try {
            this.logger.info(`[BackupCardChangeUseCase] 🔄 기존 브라우저 종료 시도: ${profileId}`);
            await this.adsPowerAdapter.closeBrowser(profileId);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
          } catch (closeError) {
            // 브라우저가 없으면 무시
            this.logger.info(`[BackupCardChangeUseCase] ℹ️ 기존 브라우저 없음 (정상): ${profileId}`);
          }

          // 브라우저 실행
          const result = await this.adsPowerAdapter.openBrowser(profileId);
          browser = result.browser;
          page = result.page;

          browserOpened = true;
          this.logger.info(`[BackupCardChangeUseCase] ✅ 브라우저 실행 성공: ${profileId}`);

          if (this.detailedErrorLogger) {
            this.detailedErrorLogger.endStep('브라우저 실행', {
              success: true,
              profileId,
              profileName: match.profileName,
              attemptNumber: i + 1
            });
          }

          break; // 성공시 루프 종료

        } catch (error) {
          lastError = error;
          this.logger.warn(`[BackupCardChangeUseCase] ⚠️ 프로필 ${profileId} 실행 실패: ${error.message}`);

          if (i === profileMatches.length - 1) {
            // 마지막 프로필까지 실패
            if (this.detailedErrorLogger) {
              this.detailedErrorLogger.endStep('브라우저 실행', {
                success: false,
                error: `모든 프로필 실패 (${profileMatches.length}개)`,
                lastError: lastError.message
              });
            }

            throw new Error(
              `모든 매칭 프로필(${profileMatches.length}개) 실행 실패\n` +
              `시도한 프로필: ${profileMatches.map(p => p.profileId).join(', ')}\n` +
              `마지막 에러: ${lastError.message}`
            );
          }

          // 다음 프로필로 재시도 (1초 대기)
          this.logger.info(`[BackupCardChangeUseCase] ⏳ 1초 후 다음 프로필로 재시도...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!browserOpened) {
        throw new Error('브라우저 실행 실패 (모든 프로필 시도 실패)');
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 2.5: 프록시 안정화 대기 (ERR_CONNECTION_CLOSED 방지)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 2.5: 프록시 안정화 대기');
      this.logger.info(`[BackupCardChangeUseCase] ⏳ 프록시 연결 안정화 대기 중... (3초)`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      this.logger.info(`[BackupCardChangeUseCase] ✅ 프록시 안정화 완료`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 3: IP 주소 확인
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 3: IP 주소 확인');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 3: IP 주소 확인 시작`);

      try {
        ipAddress = await this.ipService.getCurrentIP(page);
        this.logger.info(`[BackupCardChangeUseCase] 📍 현재 IP: ${ipAddress}`);
      } catch (error) {
        this.logger.warn(`[BackupCardChangeUseCase] ⚠️ IP 확인 실패: ${error.message}`);
        ipAddress = 'Unknown';
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 4: 카드/주소 선택 (미리 지정 또는 랜덤)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 4: 카드/주소 선택');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 4: 카드/주소 선택 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('카드/주소 선택', {
          preSelectedCard: options.cardName || 'random',
          preSelectedAddress: options.addressName || 'random'
        });
      }

      // 카드 선택
      selectedCard = await this.backupCardService.selectCard(
        email,
        options.cardName
      );

      // 주소 선택
      selectedAddress = await this.backupCardService.selectAddress(
        email,
        options.addressName
      );

      // 검증
      const { valid, errors } = await this.backupCardService.selectAndValidate(
        email,
        options.cardName,
        options.addressName
      );

      if (!valid) {
        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('카드/주소 선택', {
            success: false,
            errors
          });
        }
        throw new Error(`카드/주소 검증 실패:\n${errors.join('\n')}`);
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ 선택 완료: 카드=${selectedCard.cardName}, 주소=${selectedAddress.addressName}`);
      this.logger.info(
        `[BackupCardChangeUseCase]   카드: ${this.backupCardService.maskCardNumber(selectedCard.cardNumber)}`
      );
      this.logger.info(`[BackupCardChangeUseCase]   주소: ${selectedAddress.city}, ${selectedAddress.country}`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep('카드/주소 선택', {
          success: true,
          card: selectedCard.cardName,
          address: selectedAddress.addressName
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 5: 프로필 데이터 조회 (로그인 필요시 사용)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 5: 프로필 데이터 조회');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 5: 프로필 데이터 조회 시작`);

      const targets = await this.backupCardRepository.getBackupCardChangeTargets({
        status: 'all'
      });

      const profile = targets.find(t => t.email === email);

      if (!profile) {
        throw new Error(`백업카드변경 시트에서 ${email}을 찾을 수 없습니다`);
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ 프로필 데이터 조회 완료`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 6: YouTube Premium 페이지 이동 및 로그인 상태 확인
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 6: YouTube Premium 페이지 이동');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 6: YouTube Premium 페이지 이동 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('YouTube Premium 페이지 이동');
      }

      // YouTube Premium 페이지로 직접 이동 (Resume/Pause 워크플로우와 동일 패턴)
      const premiumUrl = 'https://www.youtube.com/paid_memberships';

      // 먼저 현재 URL 확인 (불필요한 페이지 이동 방지)
      let currentUrl = await page.evaluate(() => window.location.href);
      this.logger.info(`[BackupCardChangeUseCase] 📍 현재 페이지 URL: ${currentUrl}`);

      try {
        // 이미 Premium 페이지에 있는지 확인
        const alreadyOnPremiumPage = currentUrl.includes('youtube.com/paid_memberships') ||
                                     currentUrl.includes('youtube.com/premium');

        if (alreadyOnPremiumPage) {
          this.logger.info(`[BackupCardChangeUseCase] ✅ 이미 YouTube Premium 페이지에 있음 - 페이지 이동 생략`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 안정화 대기
        } else {
          this.logger.info(`[BackupCardChangeUseCase] 🌐 YouTube Premium 페이지로 이동: ${premiumUrl}`);
          await page.goto(premiumUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // 현재 URL 재확인
        currentUrl = await page.evaluate(() => window.location.href);
        this.logger.info(`[BackupCardChangeUseCase] 📍 최종 URL: ${currentUrl}`);

        // 로그인 상태 확인 (URL 기반)
        const isLoggedIn = !currentUrl.includes('accounts.google.com') &&
                          !currentUrl.includes('signin') &&
                          (currentUrl.includes('youtube.com/paid_memberships') ||
                           currentUrl.includes('youtube.com/premium'));

        if (isLoggedIn) {
          this.logger.info('[BackupCardChangeUseCase] ✅ 이미 로그인되어 있음 - Premium 페이지 정상 로드');

          if (this.detailedErrorLogger) {
            this.detailedErrorLogger.endStep('YouTube Premium 페이지 이동', {
              success: true,
              loginStatus: 'already_logged_in'
            });
          }
        } else {
          // 로그인 필요 - Google 계정 페이지로 리디렉션됨
          this.logger.info('[BackupCardChangeUseCase] ⚠️ 로그인 필요 - Google 로그인 시도');

          if (this.detailedErrorLogger) {
            this.detailedErrorLogger.startStep('Google 로그인 (자동 트리거)', {
              email: profile.email,
              authMode: 'improved'
            });
          }

          const loginResult = await this.authService.performLogin(page, {
            email: profile.email,
            password: profile.password,
            recoveryEmail: profile.recoveryEmail,
            totpSecret: profile.totpSecret
          }, {
            profileId,
            maxAttempts: 3
          });

          if (!loginResult.success) {
            if (this.detailedErrorLogger) {
              this.detailedErrorLogger.endStep('Google 로그인 (자동 트리거)', {
                success: false,
                error: loginResult.error || '로그인 실패'
              });
              this.detailedErrorLogger.endStep('YouTube Premium 페이지 이동', {
                success: false,
                error: '로그인 실패로 인한 페이지 접근 불가'
              });
            }
            throw new Error(`Google 로그인 실패: ${loginResult.message || loginResult.error || 'Unknown error'}`);
          }

          this.logger.info('[BackupCardChangeUseCase] ✅ Google 로그인 성공');

          if (this.detailedErrorLogger) {
            this.detailedErrorLogger.endStep('Google 로그인 (자동 트리거)', {
              success: true
            });
          }

          // 로그인 후 YouTube Premium 페이지로 다시 이동
          this.logger.info('[BackupCardChangeUseCase] 🎯 로그인 후 YouTube Premium 페이지로 다시 이동');
          await page.goto(premiumUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await new Promise(resolve => setTimeout(resolve, 3000));

          if (this.detailedErrorLogger) {
            this.detailedErrorLogger.endStep('YouTube Premium 페이지 이동', {
              success: true,
              loginStatus: 'logged_in_manually'
            });
          }
        }

      } catch (error) {
        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('YouTube Premium 페이지 이동', {
            success: false,
            error: error.message
          });
        }
        throw new Error(`YouTube Premium 페이지 이동 실패: ${error.message}`);
      }

      this.logger.info('[BackupCardChangeUseCase] ✅ YouTube Premium 페이지 준비 완료');

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 7: Manage membership 버튼 클릭
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 7: Manage membership 버튼 클릭');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 7: Manage membership 버튼 클릭 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('Manage membership 버튼 클릭');
      }

      // 현재 언어 감지
      const detectResult = await this.languageService.detectLanguage(page);
      const currentLang = detectResult.language;
      this.logger.info(`[BackupCardChangeUseCase] 🌐 감지된 언어: ${currentLang} (신뢰도: ${detectResult.confidence})`);

      // "Manage membership" 버튼 찾기
      const langTexts = this.languageService.translations[currentLang] || this.languageService.translations['en'];
      const manageKeywords = langTexts.buttons?.manageMembership || ['Manage', 'Manage membership'];

      this.logger.info(`[BackupCardChangeUseCase] 🔍 "Manage membership" 버튼 찾는 중...`);
      this.logger.info(`[BackupCardChangeUseCase]   검색 키워드: ${manageKeywords.join(', ')}`);

      const clickResult = await this.buttonService.clickButtonByTexts(
        page,
        manageKeywords,
        {
          description: 'Manage membership',
          scrollIfNotFound: true
        }
      );

      if (!clickResult.clicked) {
        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('Manage membership 버튼 클릭', {
            success: false,
            error: 'Manage membership 버튼 없음'
          });
        }
        throw new Error('Manage membership 버튼을 찾을 수 없습니다');
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ "Manage membership" 버튼 클릭 성공: ${clickResult.text}`);

      // 📸 Manage membership 클릭 직후 스크린샷
      const afterManageClickPath = `screenshots/step7-after-manage-click-${timestamp}.png`;
      await this.saveScreenshot(page, afterManageClickPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 Manage membership 클릭 직후 스크린샷: ${afterManageClickPath}`);

      await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5초 대기

      // 📸 1.5초 대기 후 스크린샷
      const after1_5sPath = `screenshots/step7-after-1.5s-${timestamp}.png`;
      await this.saveScreenshot(page, after1_5sPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 1.5초 대기 후 스크린샷: ${after1_5sPath}`);

      await new Promise(resolve => setTimeout(resolve, 1500)); // 추가 1.5초 대기 (총 3초)

      // 📸 확장 섹션 로딩 완료 스크린샷
      const sectionExpandedPath = `screenshots/step7-section-expanded-${timestamp}.png`;
      await this.saveScreenshot(page, sectionExpandedPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 확장 섹션 로딩 완료 스크린샷: ${sectionExpandedPath}`);

      this.logger.info('[BackupCardChangeUseCase] ✅ Manage membership 확장 섹션 로딩 완료');

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep('Manage membership 버튼 클릭', {
          success: true
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 7.5: Backup payment method Edit 버튼 클릭
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 7.5: Backup payment method Edit 버튼 클릭');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 7.5: Backup payment method Edit 버튼 클릭 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('Backup payment method Edit 버튼 클릭');
      }

      // 📸 Step 7.5 시작 전 스크린샷
      const beforeEditButtonPath = `screenshots/step7.5-before-edit-button-${timestamp}.png`;
      await this.saveScreenshot(page, beforeEditButtonPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 Step 7.5 시작 전 스크린샷: ${beforeEditButtonPath}`);

      // "Backup payment method" 섹션의 "Edit" 버튼 찾기 (상세 로그 추가)
      this.logger.info(`[BackupCardChangeUseCase] 🔍 "Backup payment method" Edit 버튼 찾는 중...`);

      // 먼저 페이지에 어떤 텍스트가 있는지 확인
      const pageAnalysis = await page.evaluate(() => {
        const backupTextKeywords = [
          'Backup payment method',
          'Método de pago de respaldo',
          'Резервный способ оплаты',
          'Método de pagamento de backup',
          'Méthode de paiement de secours',
          'Backup-Zahlungsmethode',
          'バックアップ支払い方法',
          '备用付款方式',
          '備用付款方式'
        ];

        // 페이지의 모든 텍스트 수집
        const allText = document.body.innerText || '';

        // "Backup payment method" 관련 텍스트 찾기
        const foundBackupTexts = [];
        const allElements = document.querySelectorAll('*');

        for (const elem of allElements) {
          const text = elem.textContent?.trim() || '';
          for (const keyword of backupTextKeywords) {
            if (text.includes(keyword)) {
              foundBackupTexts.push({
                keyword,
                tagName: elem.tagName,
                text: text.substring(0, 100), // 처음 100자만
                hasButton: elem.querySelector('button, [role="button"]') !== null
              });
              break; // 첫 번째 매칭만
            }
          }
        }

        // 모든 버튼 찾기
        const allButtons = [];
        const buttons = document.querySelectorAll('button, [role="button"], a[role="button"]');
        buttons.forEach(btn => {
          if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
            allButtons.push({
              text: btn.textContent?.trim() || '',
              tagName: btn.tagName,
              ariaLabel: btn.getAttribute('aria-label') || ''
            });
          }
        });

        return {
          pageUrl: window.location.href,
          pageTitle: document.title,
          foundBackupTexts,
          totalButtons: allButtons.length,
          allButtons: allButtons.slice(0, 20) // 처음 20개만
        };
      });

      this.logger.info(`[BackupCardChangeUseCase] 📊 페이지 분석 결과:`);
      this.logger.info(`  URL: ${pageAnalysis.pageUrl}`);
      this.logger.info(`  제목: ${pageAnalysis.pageTitle}`);
      this.logger.info(`  "Backup payment method" 텍스트 발견: ${pageAnalysis.foundBackupTexts.length}개`);
      pageAnalysis.foundBackupTexts.forEach((item, idx) => {
        this.logger.info(`    [${idx + 1}] ${item.keyword} (${item.tagName}) - 버튼 있음: ${item.hasButton}`);
        this.logger.info(`        텍스트: ${item.text}`);
      });
      this.logger.info(`  전체 버튼 개수: ${pageAnalysis.totalButtons}개`);
      this.logger.info(`  버튼 샘플 (최대 20개):`);
      pageAnalysis.allButtons.forEach((btn, idx) => {
        this.logger.info(`    [${idx + 1}] ${btn.tagName}: "${btn.text}" (aria-label: "${btn.ariaLabel}")`);
      });

      // 📸 페이지 분석 후 스크린샷
      const afterAnalysisPath = `screenshots/step7.5-after-analysis-${timestamp}.png`;
      await this.saveScreenshot(page, afterAnalysisPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 페이지 분석 후 스크린샷: ${afterAnalysisPath}`);

      // 실제 Edit 버튼 클릭 시도
      const editClickResult = await page.evaluate(() => {
        // "Backup payment method" 텍스트를 찾기
        const backupTextKeywords = [
          'Backup payment method',
          'Método de pago de respaldo',
          'Резервный способ оплаты',
          'Método de pagamento de backup',
          'Méthode de paiement de secours',
          'Backup-Zahlungsmethode',
          'バックアップ支払い方法',
          '备用付款方式',
          '備用付款方式'
        ];

        const editKeywords = ['Edit', '편집', 'Éditer', 'Редактировать', 'Bearbeiten', 'Editar', '編集', '编辑'];

        // 모든 요소를 순회하면서 정확한 "Backup payment method" 텍스트를 가진 요소 찾기
        const allElements = document.querySelectorAll('*');
        let backupTextElement = null;
        let smallestTextLength = Infinity;

        // "Backup payment method"만 포함하는 가장 작은 요소 찾기 (다른 섹션과 구분)
        for (const elem of allElements) {
          const text = elem.textContent?.trim() || '';
          const directText = elem.innerText?.trim() || '';

          for (const keyword of backupTextKeywords) {
            if (text.includes(keyword)) {
              // 텍스트 길이가 짧을수록 더 정확한 요소
              if (text.length < smallestTextLength) {
                backupTextElement = elem;
                smallestTextLength = text.length;
              }
            }
          }
        }

        if (!backupTextElement) {
          return {
            clicked: false,
            error: 'Backup payment method 텍스트를 찾을 수 없습니다',
            debug: {
              foundBackupSection: false
            }
          };
        }

        const debugInfo = {
          foundBackupSection: true,
          backupSectionTag: backupTextElement.tagName,
          backupTextLength: smallestTextLength,
          searchStrategy: []
        };

        // 전략 1: 형제 요소(sibling)에서 Edit 버튼 찾기 (우선 순위 높음)
        const checkSiblings = (element) => {
          const parent = element.parentElement;
          if (!parent) return null;

          const siblings = Array.from(parent.children);
          for (const sibling of siblings) {
            if (sibling === element) continue; // 자기 자신은 제외

            // 직접 버튼인 경우
            if (sibling.tagName === 'BUTTON' || sibling.tagName === 'A' || sibling.getAttribute('role') === 'button') {
              const sibText = sibling.textContent?.trim() || '';
              if (editKeywords.some(kw => sibText === kw || sibText.includes(kw))) {
                if (sibling.offsetHeight > 0 && sibling.offsetWidth > 0) {
                  return { button: sibling, location: 'sibling-direct' };
                }
              }
            }

            // 형제 요소 안에 버튼이 있는 경우
            const buttonsInSibling = sibling.querySelectorAll('button, [role="button"], a[role="button"]');
            for (const btn of buttonsInSibling) {
              const btnText = btn.textContent?.trim() || '';
              if (editKeywords.some(kw => btnText === kw || btnText.includes(kw))) {
                if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                  return { button: btn, location: 'sibling-child' };
                }
              }
            }
          }
          return null;
        };

        // 전략 2: 부모 요소 내에서 Edit 버튼 찾기 (단, Backup payment method와 같은 container 안에서만)
        const checkParent = (element, maxLevel = 3) => {
          let currentElement = element;

          for (let level = 0; level < maxLevel; level++) {
            const parent = currentElement.parentElement;
            if (!parent) break;

            debugInfo.searchStrategy.push({
              level,
              parentTag: parent.tagName,
              method: 'parent-search'
            });

            // 부모 요소의 직계 자식 중에서 Edit 버튼 찾기
            const directButtons = Array.from(parent.children).filter(child =>
              child.tagName === 'BUTTON' || child.tagName === 'A' || child.getAttribute('role') === 'button'
            );

            for (const btn of directButtons) {
              const btnText = btn.textContent?.trim() || '';
              if (editKeywords.some(kw => btnText === kw || btnText.includes(kw))) {
                if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                  // 버튼이 "Backup payment method" 텍스트와 비슷한 Y 위치에 있는지 확인
                  const textRect = element.getBoundingClientRect();
                  const btnRect = btn.getBoundingClientRect();
                  const yDiff = Math.abs(textRect.top - btnRect.top);

                  // 같은 행에 있으면 Y 차이가 50px 이내
                  if (yDiff < 50) {
                    return { button: btn, location: `parent-level-${level}`, yDiff };
                  }
                }
              }
            }

            currentElement = parent;
          }
          return null;
        };

        // 전략 1 실행: 형제 요소 검색 (우선)
        let result = checkSiblings(backupTextElement);
        if (result) {
          debugInfo.searchStrategy.push({ method: 'sibling', success: true, location: result.location });
          result.button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          result.button.click();
          return {
            clicked: true,
            text: result.button.textContent?.trim(),
            element: result.button.tagName.toLowerCase(),
            strategy: result.location,
            debug: debugInfo
          };
        }

        // 전략 2 실행: 부모 요소 검색 (같은 행에 있는지 확인)
        result = checkParent(backupTextElement);
        if (result) {
          debugInfo.searchStrategy.push({ method: 'parent', success: true, location: result.location, yDiff: result.yDiff });
          result.button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          result.button.click();
          return {
            clicked: true,
            text: result.button.textContent?.trim(),
            element: result.button.tagName.toLowerCase(),
            strategy: result.location,
            yDiff: result.yDiff,
            debug: debugInfo
          };
        }

        return {
          clicked: false,
          error: 'Edit 버튼을 찾을 수 없습니다 (형제/부모 요소 모두 검색 실패)',
          debug: debugInfo
        };
      });

      this.logger.info(`[BackupCardChangeUseCase] 🔍 Edit 버튼 클릭 시도 결과:`);
      this.logger.info(`  클릭 성공: ${editClickResult.clicked}`);
      if (editClickResult.debug) {
        this.logger.info(`  디버그 정보:`);
        this.logger.info(`    Backup 섹션 발견: ${editClickResult.debug.foundBackupSection}`);
        if (editClickResult.debug.backupSectionTag) {
          this.logger.info(`    Backup 섹션 태그: ${editClickResult.debug.backupSectionTag}`);
        }
        if (editClickResult.debug.backupTextLength) {
          this.logger.info(`    Backup 텍스트 길이: ${editClickResult.debug.backupTextLength}자`);
        }
        if (editClickResult.debug.searchStrategy && editClickResult.debug.searchStrategy.length > 0) {
          this.logger.info(`    검색 전략:`);
          editClickResult.debug.searchStrategy.forEach((strategy, idx) => {
            this.logger.info(`      [${idx + 1}] ${strategy.method} (${strategy.location || strategy.parentTag || 'N/A'})`);
            if (strategy.yDiff !== undefined) {
              this.logger.info(`          Y 위치 차이: ${strategy.yDiff}px`);
            }
          });
        }
      }
      if (editClickResult.clicked && editClickResult.strategy) {
        this.logger.info(`  클릭 전략: ${editClickResult.strategy}`);
        if (editClickResult.yDiff !== undefined) {
          this.logger.info(`  Y 위치 차이: ${editClickResult.yDiff}px (같은 행 확인)`);
        }
      }

      // 📸 Edit 버튼 클릭 시도 후 스크린샷
      const afterClickAttemptPath = `screenshots/step7.5-after-click-attempt-${timestamp}.png`;
      await this.saveScreenshot(page, afterClickAttemptPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 클릭 시도 후 스크린샷: ${afterClickAttemptPath}`);

      if (!editClickResult.clicked) {
        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('Backup payment method Edit 버튼 클릭', {
            success: false,
            error: editClickResult.error || 'Edit 버튼 없음',
            debug: editClickResult.debug
          });
        }
        throw new Error(`Backup payment method Edit 버튼을 찾을 수 없습니다: ${editClickResult.error || '알 수 없음'}`);
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ "Edit" 버튼 클릭 성공: ${editClickResult.text} (전략: ${editClickResult.strategy})`);

      // 📸 Edit 버튼 클릭 직후 스크린샷
      const afterEditClickPath = `screenshots/step7.5-after-edit-click-${timestamp}.png`;
      await this.saveScreenshot(page, afterEditClickPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 Edit 클릭 직후 스크린샷: ${afterEditClickPath}`);

      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기

      // 📸 2초 대기 후 스크린샷
      const after2sPath = `screenshots/step7.5-after-2s-${timestamp}.png`;
      await this.saveScreenshot(page, after2sPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 2초 대기 후 스크린샷: ${after2sPath}`);

      await new Promise(resolve => setTimeout(resolve, 3000)); // 추가 3초 대기 (총 5초)

      // 📸 팝업 등장 완료 스크린샷
      const popupReadyPath = `screenshots/step7.5-popup-ready-${timestamp}.png`;
      await this.saveScreenshot(page, popupReadyPath);
      this.logger.info(`[BackupCardChangeUseCase] 📸 팝업 등장 완료 스크린샷: ${popupReadyPath}`);

      this.logger.info('[BackupCardChangeUseCase] ✅ Backup payment method 팝업 등장 완료');

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep('Backup payment method Edit 버튼 클릭', {
          success: true,
          clickedButton: editClickResult.text,
          level: editClickResult.level
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 8: 백업 결제수단 추가 (2가지 팝업 자동 감지)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 8: 백업 결제수단 추가');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 8: 백업 결제수단 추가 시작`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('백업 결제수단 추가', {
          card: selectedCard.cardName,
          address: selectedAddress.addressName
        });
      }

      // 디버깅: 페이지 상태 확인
      const currentPageUrl = await page.url();
      this.logger.info(`[BackupCardChangeUseCase] 📍 Step 8 페이지 URL: ${currentPageUrl}`);

      // 디버깅: Step 8 시작 전 스크린샷
      const beforePaymentPath = `screenshots/diagnostics/step8-before-payment-${timestamp}.png`;
      try {
        await this.saveScreenshot(page, beforePaymentPath);
        this.logger.info(`[BackupCardChangeUseCase] 📸 Step 8 시작 전 스크린샷: ${beforePaymentPath}`);
      } catch (screenshotError) {
        this.logger.warn(`[BackupCardChangeUseCase] ⚠️ 스크린샷 저장 실패: ${screenshotError.message}`);
      }

      // YouTubePaymentAdapter에 page 전달 (동적 주입)
      this.youtubePaymentAdapter.page = page;
      this.logger.info('[BackupCardChangeUseCase] 🔧 YouTubePaymentAdapter.addBackupPaymentMethod() 호출 시작...');

      let paymentResult = null;
      try {
        paymentResult = await this.youtubePaymentAdapter.addBackupPaymentMethod(
          selectedCard,
          selectedAddress
        );

        this.logger.info(`[BackupCardChangeUseCase] 🔧 addBackupPaymentMethod() 완료. Result: ${JSON.stringify(paymentResult)}`);
      } catch (paymentError) {
        this.logger.error(`[BackupCardChangeUseCase] ❌ YouTubePaymentAdapter 예외 발생: ${paymentError.message}`);
        this.logger.error(`[BackupCardChangeUseCase] Stack: ${paymentError.stack}`);

        // 에러 발생시 스크린샷
        const errorScreenshotPath = `screenshots/errors/step8-payment-error-${timestamp}.png`;
        try {
          await this.saveScreenshot(page, errorScreenshotPath);
          this.logger.info(`[BackupCardChangeUseCase] 📸 에러 발생 시점 스크린샷: ${errorScreenshotPath}`);
        } catch (screenshotError) {
          // 스크린샷 실패는 무시
        }

        throw paymentError; // 에러 재throw
      }

      if (!paymentResult.success) {
        this.logger.error(`[BackupCardChangeUseCase] ❌ 백업 결제수단 추가 실패 - Scenario: ${paymentResult.scenario}, Reason: ${paymentResult.reason}`);

        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep('백업 결제수단 추가', {
            success: false,
            scenario: paymentResult.scenario,
            reason: paymentResult.reason
          });
        }
        throw new Error(`백업 결제수단 추가 실패: ${paymentResult.reason}`);
      }

      this.logger.info(`[BackupCardChangeUseCase] ✅ 백업 결제수단 추가 성공 (Scenario: ${paymentResult.scenario})`);

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep('백업 결제수단 추가', {
          success: true,
          scenario: paymentResult.scenario
        });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 9: 사용 기록 업데이트
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 9: 사용 기록 업데이트');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 9: 사용 기록 업데이트 시작`);

      await this.backupCardService.recordCardUsage(
        selectedCard.cardName,
        selectedAddress.addressName
      );

      this.logger.info('[BackupCardChangeUseCase] ✅ 사용 기록 업데이트 완료');

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 10: 백업카드변경 시트 업데이트
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 10: 백업카드변경 시트 업데이트');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 10: 백업카드변경 시트 업데이트 시작`);

      const now = new Date();
      const koreaTime = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      await this.backupCardRepository.updateBackupCardChangeStatus(email, {
        cardName: selectedCard.cardName,      // E열
        addressName: selectedAddress.addressName, // F열
        status: '완료',                       // G열
        ipAddress,                            // H열
        result: `✅ 성공 (Scenario: ${paymentResult.scenario}) (${koreaTime})` // I열
      });

      this.logger.info('[BackupCardChangeUseCase] ✅ 백업카드변경 시트 업데이트 완료');

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 11: 브라우저 종료
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      updateProgress('Step 11: 브라우저 종료');
      this.logger.info(`[BackupCardChangeUseCase] 🔍 Step 11: 브라우저 종료 시작`);

      await this.adsPowerAdapter.closeBrowser(profileId);

      this.logger.info('[BackupCardChangeUseCase] ✅ 브라우저 종료 완료');

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 성공 결과 반환
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[BackupCardChangeUseCase] 🎉 백업카드 변경 워크플로우 완료');

      return {
        success: true,
        email,
        profileId,
        card: selectedCard.cardName,
        address: selectedAddress.addressName,
        scenario: paymentResult.scenario,
        ipAddress,
        timestamp: koreaTime
      };

    } catch (error) {
      this.logger.error(`[BackupCardChangeUseCase] ❌ 백업카드 변경 실패: ${error.message}`);

      // 에러 분류 (ErrorClassifier 사용)
      let classifiedError = null;
      if (this.errorClassifier) {
        classifiedError = this.errorClassifier.classifyBackupCardError(error);
        this.logger.error(`[BackupCardChangeUseCase] 📋 에러 분류: ${classifiedError.code} (${classifiedError.description})`);
        this.logger.error(`[BackupCardChangeUseCase] 💡 해결 방법: ${classifiedError.solution}`);
      }

      // 백업카드변경 시트 업데이트 (에러)
      try {
        // IP 주소 재확인 (page가 있으면)
        if (page && !ipAddress) {
          try {
            ipAddress = await this.ipService.getCurrentIP(page);
          } catch (ipError) {
            ipAddress = 'Unknown';
          }
        }

        const now = new Date();
        const koreaTime = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        await this.backupCardRepository.updateBackupCardChangeStatus(email, {
          cardName: selectedCard?.cardName || '',
          addressName: selectedAddress?.addressName || '',
          status: '실패',
          ipAddress,
          result: classifiedError
            ? `❌ ${classifiedError.code}: ${classifiedError.description} (${koreaTime})`
            : `❌ ${error.message} (${koreaTime})`
        });

        this.logger.info('[BackupCardChangeUseCase] ✅ 에러 상태 시트 업데이트 완료');
      } catch (updateError) {
        this.logger.error(`[BackupCardChangeUseCase] ⚠️ 시트 업데이트 실패: ${updateError.message}`);
      }

      // 브라우저 정리
      if (profileId) {
        try {
          this.logger.info(`[BackupCardChangeUseCase] 🔄 브라우저 정리 중... (${profileId})`);
          await this.adsPowerAdapter.closeBrowser(profileId);
          this.logger.info('[BackupCardChangeUseCase] ✅ 브라우저 정리 완료');
        } catch (closeError) {
          this.logger.error(`[BackupCardChangeUseCase] ⚠️ 브라우저 종료 실패: ${closeError.message}`);
        }
      }

      // 에러 전파
      throw error;
    }
  }

  /**
   * 스크린샷 저장 헬퍼 메서드
   * @param {Object} page - Puppeteer 페이지 객체
   * @param {String} filename - 파일명
   * @returns {String|null} - 저장된 파일 경로 또는 null
   */
  async saveScreenshot(page, filename) {
    try {
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });

      const filepath = path.join(screenshotDir, filename);
      await page.screenshot({
        path: filepath,
        fullPage: false
      });

      this.logger.info(`[BackupCardChangeUseCase] 📸 스크린샷 저장: ${filename}`);
      return filepath;
    } catch (error) {
      this.logger.warn(`[BackupCardChangeUseCase] ⚠️ 스크린샷 저장 실패: ${error.message}`);
      return null;
    }
  }
}

module.exports = BackupCardChangeUseCase;
