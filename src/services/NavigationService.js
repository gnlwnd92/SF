/**
 * NavigationService - 페이지 네비게이션 서비스
 *
 * YouTube Premium 관련 모든 페이지 이동 및 네비게이션 로직 중앙화
 * 리다이렉트 처리, 페이지 로드 대기, 재시도 로직 포함
 *
 * v2.1 - beforeunload 다이얼로그 자동 처리 기능 추가
 * "사이트에서 나가시겠습니까?" 같은 다이얼로그를 자동으로 처리하여
 * 워크플로우가 막히지 않도록 합니다.
 */

const chalk = require('chalk');
const DialogHandler = require('../utils/DialogHandler');

class NavigationService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      defaultTimeout: config.defaultTimeout || 30000,
      waitForNavigationTimeout: config.waitForNavigationTimeout || 30000, // 30초로 증가
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      maxTotalRetries: config.maxTotalRetries || 6, // 전체 최대 재시도 제한
      ...config
    };

    // YouTube URLs
    this.urls = {
      membershipPage: 'https://www.youtube.com/paid_memberships',
      premiumPage: 'https://www.youtube.com/premium',
      accountPage: 'https://myaccount.google.com',
      billingPage: 'https://pay.youtube.com/payments/subscriptions',
      settingsPage: 'https://www.youtube.com/account'
    };

    // 네비게이션 히스토리
    this.navigationHistory = [];

    // 무한 루프 방지를 위한 전역 재시도 카운터
    this.totalRetryCount = 0;
    this.lastRetryReset = Date.now();

    // v2.1 - DialogHandler 인스턴스 (beforeunload 자동 처리)
    this.dialogHandler = new DialogHandler({
      debugMode: config.debugMode,
      autoAccept: true,
      logDialogs: config.debugMode
    });

    // 다이얼로그 핸들러가 등록된 페이지 추적
    this.pagesWithDialogHandler = new WeakSet();
  }

  /**
   * 페이지에 다이얼로그 핸들러 등록 (beforeunload 자동 처리)
   * 페이지당 한 번만 등록됩니다.
   *
   * @param {Page} page - Puppeteer 페이지 객체
   */
  ensureDialogHandler(page) {
    if (!page || this.pagesWithDialogHandler.has(page)) {
      return;
    }

    try {
      // Puppeteer의 dialog 이벤트 핸들러 등록
      page.on('dialog', async (dialog) => {
        const dialogType = dialog.type();
        const message = dialog.message();

        console.log(chalk.yellow(`\n📌 [DialogHandler] 다이얼로그 감지 [${dialogType}]`));
        console.log(chalk.gray(`   메시지: ${message.substring(0, 100)}...`));

        try {
          // beforeunload는 항상 accept (페이지 이동 허용)
          if (dialogType === 'beforeunload') {
            await dialog.accept();
            console.log(chalk.green(`   ✅ beforeunload 다이얼로그 자동 수락 (페이지 이동 허용)`));
          } else if (dialogType === 'confirm') {
            await dialog.accept();
            console.log(chalk.green(`   ✅ confirm 다이얼로그 자동 수락`));
          } else if (dialogType === 'alert') {
            await dialog.dismiss();
            console.log(chalk.green(`   ✅ alert 다이얼로그 닫힘`));
          } else {
            await dialog.accept();
            console.log(chalk.green(`   ✅ 다이얼로그 자동 수락 [${dialogType}]`));
          }
        } catch (err) {
          console.log(chalk.red(`   ❌ 다이얼로그 처리 실패: ${err.message}`));
        }
      });

      this.pagesWithDialogHandler.add(page);
      this.log('✅ 다이얼로그 핸들러 등록 완료 (beforeunload 자동 처리 활성화)', 'success');

    } catch (error) {
      this.log(`다이얼로그 핸들러 등록 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * beforeunload 이벤트 리스너 제거
   * Gmail, Google 앱 등에서 발생하는 "사이트에서 나가시겠습니까?" 방지
   *
   * @param {Page} page - Puppeteer 페이지 객체
   */
  async removeBeforeunloadListeners(page) {
    if (!page) return;

    try {
      await page.evaluate(() => {
        // 1. window.onbeforeunload 직접 제거
        window.onbeforeunload = null;

        // 2. beforeunload 이벤트 리스너 차단
        const originalAddEventListener = window.addEventListener;
        window.addEventListener = function(type, listener, options) {
          if (type === 'beforeunload') {
            // beforeunload 이벤트 등록 차단
            return;
          }
          return originalAddEventListener.call(this, type, listener, options);
        };

        // 3. Event.returnValue 설정 방지 (Chrome의 beforeunload 트리거)
        try {
          Object.defineProperty(Event.prototype, 'returnValue', {
            set: function() {},
            get: function() { return ''; },
            configurable: true
          });
        } catch (e) {
          // 이미 정의되어 있으면 무시
        }
      });

      if (this.config.debugMode) {
        this.log('beforeunload 리스너 제거 완료', 'debug');
      }

    } catch (error) {
      // 에러가 발생해도 크리티컬하지 않음
      if (this.config.debugMode) {
        this.log(`beforeunload 리스너 제거 실패: ${error.message}`, 'debug');
      }
    }
  }

  /**
   * 멤버십 페이지로 이동
   */
  async goToMembershipPage(page, options = {}) {
    const startTime = Date.now();
    
    try {
      this.log('멤버십 페이지로 이동 중...', 'info');
      
      // 로그인 후 처음 이동인 경우 세션 안정화
      if (options.afterLogin) {
        await this.stabilizeSessionAfterLogin(page);
      }
      
      const result = await this.navigateWithRetry(
        page,
        this.urls.membershipPage,
        {
          waitUntil: options.waitUntil || 'domcontentloaded',
          ...options
        }
      );
      
      // 페이지 로드 완료 대기
      await this.waitForPageReady(page, {
        selectors: [
          'ytd-account-item-renderer',
          '[aria-label*="membership"]',
          '[aria-label*="Membership"]',
          'button'
        ],
        timeout: this.config.defaultTimeout
      });

      // SunBrowser 팝업 처리 추가
      try {
        const popupService = this.config.popupService;
        if (popupService && popupService.detectAndCloseSunBrowserPopup) {
          const popupClosed = await popupService.detectAndCloseSunBrowserPopup(page);
          if (popupClosed) {
            this.log('SunBrowser 팝업 처리 완료', 'success');
            // 팝업 닫은 후 잠시 대기
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } catch (popupError) {
        this.log(`SunBrowser 팝업 처리 중 오류: ${popupError.message}`, 'warning');
        // 팝업 처리 실패해도 계속 진행
      }

      const duration = Date.now() - startTime;
      this.log(`멤버십 페이지 로드 완료 (${duration}ms)`, 'success');
      
      // 히스토리 기록
      this.addToHistory({
        url: this.urls.membershipPage,
        timestamp: new Date().toISOString(),
        duration,
        success: true
      });
      
      return {
        success: true,
        url: page.url(),
        duration
      };
      
    } catch (error) {
      this.log(`멤버십 페이지 이동 실패: ${error.message}`, 'error');
      
      this.addToHistory({
        url: this.urls.membershipPage,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * 로그인 후 세션 안정화
   */
  async stabilizeSessionAfterLogin(page) {
    this.log('🔐 로그인 세션 안정화 시작...', 'info');
    console.log(chalk.yellow('\n  ⏳ 로그인 세션 안정화를 위해 대기 중...'));
    
    // 1. 충분한 대기 시간
    console.log(chalk.gray('    [1/4] 세션 쿠키 설정 대기 (5초)...'));
    await new Promise(r => setTimeout(r, 5000));
    
    // 2. 현재 페이지 새로고침
    try {
      console.log(chalk.gray('    [2/4] 현재 페이지 새로고침...'));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log(chalk.gray('    ⚠️ 새로고침 실패, 계속 진행'));
    }
    
    // 3. YouTube 홈페이지로 이동
    try {
      console.log(chalk.gray('    [3/4] YouTube 홈페이지로 이동...'));
      await page.goto('https://www.youtube.com', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log(chalk.gray('    ⚠️ YouTube 홈 이동 실패, 계속 진행'));
    }
    
    // 4. 최종 대기
    console.log(chalk.gray('    [4/4] 최종 세션 안정화 (2초)...'));
    await new Promise(r => setTimeout(r, 2000));
    
    console.log(chalk.green('  ✅ 로그인 세션 안정화 완료'));
    this.log('✅ 세션 안정화 완료', 'success');
  }
  
  /**
   * 설정 페이지로 이동
   */
  async navigateToSettings(page, options = {}) {
    this.log('설정 페이지로 이동 중...', 'info');
    
    return await this.navigateWithRetry(
      page,
      this.urls.settingsPage,
      options
    );
  }

  /**
   * 결제 페이지로 이동
   */
  async navigateToBilling(page, options = {}) {
    this.log('결제 페이지로 이동 중...', 'info');
    
    return await this.navigateWithRetry(
      page,
      this.urls.billingPage,
      options
    );
  }

  /**
   * Google 계정 선택 팝업 처리
   */
  async handleAccountChooserPopup(page, timeout = 5000) {
    try {
      console.log(chalk.cyan('\n🔍 Google 계정 선택 팝업 확인 중...'));

      // 계정 선택 팝업 관련 선택자들
      const popupSelectors = [
        // "나가기" 버튼 선택자들 (한국어)
        'button[aria-label="나가기"]',
        'button[aria-label="닫기"]',
        'button[title="나가기"]',
        'button[title="닫기"]',
        '[aria-label*="나가기"]',
        '[title*="나가기"]',
        'button:has-text("나가기")',

        // 영어 버전
        'button[aria-label="Exit"]',
        'button[aria-label="Close"]',
        'button[title="Exit"]',
        'button[title="Close"]',
        '[aria-label*="Exit"]',
        '[title*="Exit"]',

        // X 버튼 및 닫기 아이콘
        'button[jsname="tJiF1e"]',  // Google 계정 선택 팝업의 특정 버튼
        'button[jsaction*="close"]',
        'button[jsaction*="exit"]',
        'div[role="button"][jsaction*="dismiss"]',

        // 일반적인 닫기 버튼
        'div[role="dialog"] button[aria-label]',
        'div[role="dialog"] button svg',
        'div.account-chooser button',  // 계정 선택자 닫기

        // iframe 내부
        'iframe button[aria-label*="나가기"]',
        'iframe button[aria-label*="Exit"]'
      ];

      // 팝업 확인
      for (const selector of popupSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            console.log(chalk.yellow(`  📌 팝업 발견: ${selector}`));

            // 버튼이 보이는지 확인
            const isVisible = await button.evaluate(el => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 &&
                     style.display !== 'none' &&
                     style.visibility !== 'hidden';
            });

            if (isVisible) {
              console.log(chalk.green('  🎯 "나가기" 버튼 클릭 중...'));
              await button.click();
              await this.delay(2000); // 팝업이 닫힐 때까지 대기
              console.log(chalk.green('  ✅ 팝업 처리 완료'));
              return true;
            }
          }
        } catch (err) {
          // 개별 선택자 실패는 무시
          continue;
        }
      }

      // iframe 내부 확인
      try {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;

          for (const selector of popupSelectors) {
            try {
              const button = await frame.$(selector);
              if (button) {
                console.log(chalk.yellow(`  📌 iframe 내 팝업 발견`));
                await button.click();
                await this.delay(2000);
                console.log(chalk.green('  ✅ iframe 팝업 처리 완료'));
                return true;
              }
            } catch (err) {
              continue;
            }
          }
        }
      } catch (err) {
        // iframe 처리 실패 무시
      }

      // JavaScript로 직접 팝업 찾기 및 클릭 시도
      console.log(chalk.cyan('  🔎 JavaScript로 팝업 검색 중...'));
      const jsResult = await page.evaluate(() => {
        // 다양한 방법으로 나가기 버튼 찾기
        const possibleButtons = [
          ...document.querySelectorAll('button'),
          ...document.querySelectorAll('[role="button"]'),
          ...document.querySelectorAll('[jsaction]')
        ];

        for (const btn of possibleButtons) {
          const text = btn.innerText || btn.textContent || '';
          const ariaLabel = btn.getAttribute('aria-label') || '';
          const title = btn.getAttribute('title') || '';

          // 나가기 관련 텍스트 확인
          if (text.includes('나가기') || text.includes('Exit') ||
              ariaLabel.includes('나가기') || ariaLabel.includes('Exit') ||
              title.includes('나가기') || title.includes('Exit') ||
              text.includes('닫기') || text.includes('Close') ||
              ariaLabel.includes('닫기') || ariaLabel.includes('Close')) {

            // 버튼이 보이는지 확인
            const rect = btn.getBoundingClientRect();
            const style = window.getComputedStyle(btn);
            if (rect.width > 0 && rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden') {

              // 클릭 시도
              btn.click();
              return { found: true, clicked: true, text: text || ariaLabel || title };
            }
          }
        }

        // SVG 닫기 아이콘 찾기
        const svgButtons = document.querySelectorAll('button svg');
        for (const svg of svgButtons) {
          const button = svg.closest('button');
          if (button) {
            const rect = button.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              button.click();
              return { found: true, clicked: true, text: 'SVG close button' };
            }
          }
        }

        return { found: false };
      });

      if (jsResult.found && jsResult.clicked) {
        console.log(chalk.green(`  ✅ JavaScript로 팝업 처리 완료: ${jsResult.text}`));
        await this.delay(2000);
        return true;
      }

      console.log(chalk.gray('  ℹ️ 계정 선택 팝업 없음'));
      return false;

    } catch (error) {
      console.log(chalk.yellow(`  ⚠️ 팝업 처리 중 오류: ${error.message}`));
      return false;
    }
  }

  /**
   * 재시도 로직을 포함한 네비게이션
   * v2.1 - beforeunload 다이얼로그 자동 처리 기능 추가
   */
  async navigateWithRetry(page, url, options = {}) {
    // 전체 재시도 카운터 리셋 (5분 경과 시)
    if (Date.now() - this.lastRetryReset > 5 * 60 * 1000) {
      this.totalRetryCount = 0;
      this.lastRetryReset = Date.now();
    }

    // 전체 재시도 제한 체크
    if (this.totalRetryCount >= this.config.maxTotalRetries) {
      const error = new Error(`전체 재시도 한계 도달: ${this.totalRetryCount}회 시도`);
      error.code = 'MAX_RETRIES_EXCEEDED';
      this.log(`⚠️ 무한 루프 방지: 전체 재시도 한계 도달`, 'error');
      throw error;
    }

    const maxRetries = options.maxRetries || this.config.retryAttempts;
    const retryDelay = options.retryDelay || this.config.retryDelay;

    // v2.1 - 다이얼로그 핸들러 등록 (beforeunload 자동 처리)
    // 페이지 이동 전에 항상 다이얼로그 핸들러가 등록되어 있는지 확인
    this.ensureDialogHandler(page);

    // v2.1 - beforeunload 이벤트 리스너 제거
    // Gmail 등에서 발생하는 "사이트에서 나가시겠습니까?" 다이얼로그 원천 차단
    await this.removeBeforeunloadListeners(page);

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.totalRetryCount++; // 전체 카운터 증가
      try {
        if (this.config.debugMode) {
          console.log(chalk.gray(`네비게이션 시도 ${attempt}/${maxRetries}: ${url}`));
        }

        // 네비게이션 시작 전 팝업 처리
        await this.handleAccountChooserPopup(page);

        // v2.1 - 각 시도마다 beforeunload 리스너 재제거 (안전을 위해)
        await this.removeBeforeunloadListeners(page);

        // 네비게이션 실행 (타임아웃 처리 개선)
        let response;
        try {
          response = await page.goto(url, {
            waitUntil: options.waitUntil || 'domcontentloaded',
            timeout: options.timeout || this.config.waitForNavigationTimeout
          });
        } catch (navError) {
          // 타임아웃 발생 시 팝업 재확인
          if (navError.message.includes('Navigation timeout')) {
            console.log(chalk.yellow('  ⏱️ 네비게이션 타임아웃 - 팝업/다이얼로그 재확인'));

            // v2.1 - 타임아웃 시 beforeunload 다이얼로그로 인한 블로킹인지 확인
            // dialog 이벤트 핸들러가 자동으로 처리했을 수 있으므로 잠시 대기
            await this.delay(1000);

            const popupHandled = await this.handleAccountChooserPopup(page);

            if (popupHandled) {
              // 팝업 처리 후 다시 시도
              console.log(chalk.cyan('  🔄 팝업 처리 후 재시도...'));
              await this.removeBeforeunloadListeners(page); // 재제거
              response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000 // 더 짧은 타임아웃으로 재시도
              });
            } else {
              throw navError;
            }
          } else {
            throw navError;
          }
        }

        // 네비게이션 완료 후 팝업 재확인
        await this.delay(1000);
        await this.handleAccountChooserPopup(page);

        // 응답 상태 확인
        if (response && response.status() >= 400) {
          throw new Error(`HTTP ${response.status()} 오류`);
        }

        // 리다이렉트 처리
        const finalUrl = page.url();
        if (finalUrl !== url) {
          await this.handleRedirects(page, url, finalUrl);
        }

        return {
          success: true,
          url: finalUrl,
          attempt,
          status: response?.status()
        };

      } catch (error) {
        lastError = error;

        if (this.config.debugMode) {
          console.log(chalk.yellow(`시도 ${attempt} 실패: ${error.message}`));
        }

        // 마지막 시도가 아니면 대기 후 재시도
        if (attempt < maxRetries) {
          await this.delay(retryDelay);

          // 페이지 새로고침 시도
          if (attempt === 2) {
            try {
              await page.reload({ waitUntil: 'domcontentloaded' });
            } catch (reloadError) {
              // 새로고침 실패 무시
            }
          }
        }
      }
    }

    // 모든 시도 실패
    throw new Error(`네비게이션 실패 (${maxRetries}회 시도): ${lastError?.message}`);
  }

  /**
   * 리다이렉트 처리
   */
  async handleRedirects(page, originalUrl, finalUrl) {
    if (this.config.debugMode) {
      console.log(chalk.gray(`리다이렉트 감지: ${originalUrl} → ${finalUrl}`));
    }
    
    // YouTube 도메인 내 리다이렉트는 정상
    if (finalUrl.includes('youtube.com') || finalUrl.includes('google.com')) {
      return {
        redirected: true,
        from: originalUrl,
        to: finalUrl,
        valid: true
      };
    }
    
    // 예상치 못한 리다이렉트
    if (!this.isValidRedirect(originalUrl, finalUrl)) {
      this.log(`예상치 못한 리다이렉트: ${finalUrl}`, 'warning');
    }
    
    return {
      redirected: true,
      from: originalUrl,
      to: finalUrl,
      valid: this.isValidRedirect(originalUrl, finalUrl)
    };
  }

  /**
   * 유효한 리다이렉트인지 확인
   */
  isValidRedirect(from, to) {
    const validDomains = [
      'youtube.com',
      'google.com',
      'accounts.google.com',
      'myaccount.google.com',
      'pay.youtube.com'
    ];
    
    return validDomains.some(domain => to.includes(domain));
  }

  /**
   * 페이지 준비 상태 대기
   */
  async waitForPageReady(page, options = {}) {
    const { selectors = [], timeout = this.config.defaultTimeout } = options;

    if (this.config.debugMode) {
      console.log(chalk.gray('페이지 준비 대기 중...'));
    }

    // 팝업 처리를 먼저 시도
    await this.handleAccountChooserPopup(page);

    // 네트워크 안정화 대기 (Puppeteer 호환)
    // 주의: waitForNavigation은 이미 네비게이션이 진행 중일 때만 사용
    // 여기서는 이미 page.goto()가 완료된 후이므로 waitForTimeout만 사용
    try {
      // 페이지가 안정화되도록 잠시 대기
      await page.waitForTimeout(2000);
    } catch (error) {
      // 대기 실패는 무시
    }

    // 팝업 재확인 (페이지 로드 후)
    await this.handleAccountChooserPopup(page);

    // 선택자 대기
    if (selectors.length > 0) {
      try {
        const elementFound = await Promise.race([
          ...selectors.map(selector =>
            page.waitForSelector(selector, {
              timeout,
              visible: true
            }).catch(() => null)
          ),
          // 팝업 체크도 병렬로 수행
          new Promise(async (resolve) => {
            for (let i = 0; i < 3; i++) {
              await this.delay(2000);
              const handled = await this.handleAccountChooserPopup(page);
              if (handled) {
                console.log(chalk.green('  ✅ 대기 중 팝업 처리됨'));
                resolve(true);
                break;
              }
            }
            resolve(false);
          })
        ]);

        if (!elementFound) {
          // 팝업 때문에 요소를 못 찾았을 수 있으므로 한 번 더 시도
          await this.handleAccountChooserPopup(page);
        }
      } catch (error) {
        this.log('페이지 요소 대기 시간 초과', 'warning');
      }
    }

    // 추가 안정화 대기
    await this.delay(500);

    return {
      ready: true,
      url: page.url()
    };
  }

  /**
   * 페이지 뒤로 가기
   */
  async goBack(page, options = {}) {
    try {
      await page.goBack({
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || this.config.waitForNavigationTimeout
      });
      
      return {
        success: true,
        url: page.url()
      };
    } catch (error) {
      this.log(`뒤로 가기 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 페이지 앞으로 가기
   */
  async goForward(page, options = {}) {
    try {
      await page.goForward({
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || this.config.waitForNavigationTimeout
      });
      
      return {
        success: true,
        url: page.url()
      };
    } catch (error) {
      this.log(`앞으로 가기 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 페이지 새로고침
   */
  async refresh(page, options = {}) {
    try {
      await page.reload({
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || this.config.waitForNavigationTimeout
      });
      
      return {
        success: true,
        url: page.url(),
        refreshed: true
      };
    } catch (error) {
      this.log(`새로고침 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 현재 URL 확인
   */
  getCurrentUrl(page) {
    return page.url();
  }

  /**
   * 특정 URL에 있는지 확인
   */
  isOnPage(page, expectedUrl) {
    const currentUrl = page.url();
    
    if (typeof expectedUrl === 'string') {
      return currentUrl.includes(expectedUrl);
    }
    
    if (expectedUrl instanceof RegExp) {
      return expectedUrl.test(currentUrl);
    }
    
    return false;
  }

  /**
   * 네비게이션 히스토리에 추가
   */
  addToHistory(entry) {
    this.navigationHistory.push(entry);
    
    // 최대 100개까지만 유지
    if (this.navigationHistory.length > 100) {
      this.navigationHistory.shift();
    }
  }

  /**
   * 네비게이션 히스토리 가져오기
   */
  getHistory(limit = 10) {
    return this.navigationHistory.slice(-limit);
  }

  /**
   * 네비게이션 히스토리 초기화
   */
  clearHistory() {
    this.navigationHistory = [];
  }

  /**
   * 지연 함수
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') {
      return;
    }
    
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[NavigationService] ${message}`));
  }

  /**
   * 서비스 상태 확인
   */
  getStatus() {
    return {
      service: 'NavigationService',
      ready: true,
      config: {
        debugMode: this.config.debugMode,
        defaultTimeout: this.config.defaultTimeout,
        retryAttempts: this.config.retryAttempts
      },
      historySize: this.navigationHistory.length,
      lastNavigation: this.navigationHistory[this.navigationHistory.length - 1] || null
    };
  }
}

module.exports = NavigationService;