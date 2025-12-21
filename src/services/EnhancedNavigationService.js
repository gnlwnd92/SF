/**
 * Enhanced Navigation Service with Frame Recovery
 * Frame detached 오류를 자동으로 감지하고 복구하는 개선된 네비게이션 서비스
 *
 * AdsPower 브라우저 환경에서 안정적인 페이지 이동 보장
 */

const chalk = require('chalk');
const FrameRecoveryService = require('./FrameRecoveryService');

class EnhancedNavigationService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode !== undefined ? config.debugMode : true,
      defaultTimeout: config.defaultTimeout || 30000,
      waitForNavigationTimeout: config.waitForNavigationTimeout || 15000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      frameRecoveryEnabled: config.frameRecoveryEnabled !== undefined ? config.frameRecoveryEnabled : true,
      adsPowerMode: config.adsPowerMode !== undefined ? config.adsPowerMode : true,
      maxFrameRecoveryAttempts: config.maxFrameRecoveryAttempts || 2, // Frame Recovery 최대 2회로 제한
      totalTimeoutMs: config.totalTimeoutMs || 120000, // 전체 작업 2분 제한
      ...config
    };

    // Frame Recovery Service 초기화
    this.frameRecovery = new FrameRecoveryService({
      maxRetries: 2, // 3회에서 2회로 감소
      retryDelay: 2000,
      debugMode: this.config.debugMode
    });

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

    // Frame Recovery 시도 카운터 (무한 루프 방지)
    this.frameRecoveryAttempts = 0;
    this.lastFrameRecoveryTime = 0;

    // 전체 작업 시작 시간
    this.navigationStartTime = 0;

    this.log('Enhanced Navigation Service 초기화 완료 (Frame Recovery 활성화, 무한 루프 방지)');
  }

  log(message, level = 'info') {
    if (this.config.debugMode) {
      const colors = {
        info: chalk.cyan,
        success: chalk.green,
        warning: chalk.yellow,
        error: chalk.red,
        debug: chalk.gray
      };
      const color = colors[level] || chalk.gray;
      console.log(color(`[NavigationService] ${message}`));
    }
  }

  /**
   * Frame-safe 페이지 이동 (핵심 메서드)
   */
  async safeNavigate(page, url, options = {}) {
    const maxRetries = options.maxRetries || this.config.retryAttempts;
    let lastError = null;
    let currentUrl = null;

    // 전체 작업 시작 시간 기록
    if (this.navigationStartTime === 0) {
      this.navigationStartTime = Date.now();
    }

    // 전체 타임아웃 체크
    const checkTotalTimeout = () => {
      const elapsed = Date.now() - this.navigationStartTime;
      if (elapsed > this.config.totalTimeoutMs) {
        throw new Error(`전체 네비게이션 타임아웃 (${this.config.totalTimeoutMs / 1000}초 초과)`);
      }
    };

    // Frame Recovery 횟수 리셋 (1분 경과 시)
    if (Date.now() - this.lastFrameRecoveryTime > 60000) {
      this.frameRecoveryAttempts = 0;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 전체 타임아웃 체크
        checkTotalTimeout();

        this.log(`페이지 이동 시도 ${attempt}/${maxRetries}: ${url}`, 'debug');

        // Frame Recovery 횟수 체크
        if (this.frameRecoveryAttempts >= this.config.maxFrameRecoveryAttempts) {
          this.log('Frame Recovery 최대 횟수 초과, 중단', 'error');
          throw new Error('Frame Recovery 최대 횟수 초과');
        }

        // 현재 Frame 상태 확인
        const frameStateBefore = await this.frameRecovery.checkFrameState(page);
        if (frameStateBefore.status === 'detached') {
          this.log('이동 전 Frame detached 감지, 복구 중...', 'warning');
          this.frameRecoveryAttempts++;
          this.lastFrameRecoveryTime = Date.now();

          // Frame Recovery가 너무 많이 시도되면 포기
          if (this.frameRecoveryAttempts >= this.config.maxFrameRecoveryAttempts) {
            throw new Error('Frame Recovery 실패 - 페이지 상태 복구 불가');
          }

          await this.frameRecovery.recoverFrame(page);
        }

        // AdsPower 특수 처리 - 이동 전 현재 URL 저장
        try {
          currentUrl = page.url();
        } catch (e) {
          currentUrl = 'unknown';
        }

        // 네비게이션 실행 (Frame-safe)
        const navigationResult = await this.performNavigation(page, url, {
          ...options,
          attempt,
          currentUrl
        });

        if (navigationResult.success) {
          this.log(`페이지 이동 성공: ${navigationResult.finalUrl}`, 'success');

          // 성공 시 카운터 리셋
          this.frameRecoveryAttempts = 0;
          this.navigationStartTime = 0;

          // 네비게이션 히스토리 기록
          this.addToHistory({
            url: navigationResult.finalUrl,
            originalUrl: url,
            timestamp: new Date().toISOString(),
            attempt,
            success: true
          });

          return navigationResult;
        }

      } catch (error) {
        lastError = error;
        this.log(`시도 ${attempt} 실패: ${error.message}`, 'error');

        // 전체 타임아웃이거나 Frame Recovery 최대 횟수 초과면 즉시 중단
        if (error.message.includes('타임아웃') || error.message.includes('최대 횟수')) {
          throw error;
        }

        // Frame detached 오류인 경우 특별 처리
        if (this.isFrameDetachedError(error.message)) {
          this.log('Frame detached 오류 감지, 복구 시도...', 'warning');
          this.frameRecoveryAttempts++;
          this.lastFrameRecoveryTime = Date.now();

          // Frame Recovery 최대 횟수 체크
          if (this.frameRecoveryAttempts >= this.config.maxFrameRecoveryAttempts) {
            throw new Error('Frame Recovery 최대 횟수 초과 - 중단');
          }

          // Frame 복구 시도
          try {
            await this.frameRecovery.recoverFrame(page);
            await new Promise(r => setTimeout(r, 1000));
          } catch (recoveryError) {
            this.log(`Frame 복구 실패: ${recoveryError.message}`, 'error');
            throw new Error('Frame 복구 실패 - 네비게이션 중단');
          }
        }

        // 마지막 시도가 아니면 대기 후 재시도
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, this.config.retryDelay));
        }
      }
    }

    // 모든 시도 실패
    const errorMessage = `페이지 이동 실패 (${maxRetries}회 시도): ${lastError?.message}`;
    this.log(errorMessage, 'error');

    this.addToHistory({
      url,
      timestamp: new Date().toISOString(),
      success: false,
      error: lastError?.message
    });

    throw new Error(errorMessage);
  }

  /**
   * 실제 네비게이션 수행
   */
  async performNavigation(page, url, options = {}) {
    const { waitUntil = 'domcontentloaded', timeout = this.config.waitForNavigationTimeout } = options;

    try {
      // AdsPower 브라우저 특별 처리
      if (this.config.adsPowerMode) {
        return await this.adsPowerNavigation(page, url, options);
      }

      // 일반 네비게이션
      const response = await page.goto(url, {
        waitUntil,
        timeout
      });

      // 응답 확인
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()} 오류`);
      }

      // Frame 상태 재확인
      const frameStateAfter = await this.frameRecovery.checkFrameState(page);
      if (frameStateAfter.status === 'detached') {
        throw new Error('Navigation completed but frame is detached');
      }

      const finalUrl = page.url();

      return {
        success: true,
        finalUrl,
        status: response?.status(),
        redirected: finalUrl !== url
      };

    } catch (error) {
      throw error;
    }
  }

  /**
   * AdsPower 브라우저 특수 네비게이션
   */
  async adsPowerNavigation(page, url, options = {}) {
    const { waitUntil = 'domcontentloaded', timeout = this.config.waitForNavigationTimeout } = options;

    try {
      // Method 1: Navigation with Promise.race
      const navigationPromise = page.goto(url, {
        waitUntil,
        timeout
      }).catch(err => {
        // Frame detached 에러는 AdsPower에서 자주 발생
        if (this.isFrameDetachedError(err.message)) {
          return null;
        }
        throw err;
      });

      // 네비게이션 완료 또는 타임아웃 대기
      const result = await Promise.race([
        navigationPromise,
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeout))
      ]);

      // 타임아웃 체크
      if (result?.timeout) {
        this.log('네비게이션 타임아웃, 현재 상태 확인...', 'warning');
      }

      // Frame detached 에러 후 복구 확인
      let finalUrl;
      try {
        // Frame 상태 체크
        const frameState = await this.frameRecovery.checkFrameState(page);

        if (frameState.status === 'detached') {
          // Frame 복구
          this.log('네비게이션 후 Frame 복구 필요', 'warning');
          await this.frameRecovery.recoverFrame(page);
        }

        // URL 확인
        finalUrl = page.url();

      } catch (error) {
        // URL 가져오기 실패 시 복구 시도
        this.log('URL 확인 실패, Frame 복구 시도...', 'warning');
        await this.frameRecovery.recoverFrame(page);

        // 재시도
        try {
          finalUrl = page.url();
        } catch (e) {
          finalUrl = url; // 최후의 수단으로 요청 URL 사용
        }
      }

      // 목적지 도달 확인
      const isTargetReached = finalUrl.includes(new URL(url).hostname);

      if (isTargetReached || finalUrl.includes('youtube.com')) {
        this.log(`AdsPower 네비게이션 성공: ${finalUrl}`, 'success');

        // 추가 안정화 시간
        await new Promise(r => setTimeout(r, 1000));

        return {
          success: true,
          finalUrl,
          status: result?.status?.() || 200,
          redirected: finalUrl !== url
        };
      }

      throw new Error(`목적지 도달 실패: ${finalUrl}`);

    } catch (error) {
      // Frame detached 에러 특별 처리
      if (this.isFrameDetachedError(error.message)) {
        this.log('Frame detached during navigation, attempting recovery...', 'warning');

        // 페이지 재로드 시도
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
          const recoveredUrl = page.url();

          if (recoveredUrl.includes('youtube.com') || recoveredUrl === url) {
            return {
              success: true,
              finalUrl: recoveredUrl,
              status: 200,
              recovered: true
            };
          }
        } catch (reloadError) {
          this.log(`재로드 실패: ${reloadError.message}`, 'error');
        }
      }

      throw error;
    }
  }

  /**
   * 멤버십 페이지로 이동 (Frame-safe)
   */
  async goToMembershipPage(page, options = {}) {
    const startTime = Date.now();

    try {
      this.log('YouTube Premium 멤버십 페이지로 이동 중...', 'info');

      // 로그인 후 처음 이동인 경우 세션 안정화
      if (options.afterLogin) {
        await this.stabilizeSessionAfterLogin(page);
      }

      // Frame-safe 네비게이션
      const result = await this.safeNavigate(
        page,
        this.urls.membershipPage,
        {
          ...options,
          extraRetryOnFrameError: true
        }
      );

      // 페이지 로드 완료 대기 (Frame-safe)
      await this.waitForPageReady(page, {
        selectors: [
          'ytd-account-item-renderer',
          '[aria-label*="membership"]',
          '[aria-label*="Membership"]',
          'button'
        ],
        timeout: this.config.defaultTimeout
      });

      const duration = Date.now() - startTime;
      this.log(`멤버십 페이지 로드 완료 (${duration}ms)`, 'success');

      return {
        ...result,
        duration
      };

    } catch (error) {
      this.log(`멤버십 페이지 이동 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 로그인 후 세션 안정화
   */
  async stabilizeSessionAfterLogin(page) {
    this.log('🔐 로그인 세션 안정화 시작...', 'info');

    // 1. 충분한 대기 시간
    this.log('세션 쿠키 설정 대기 (5초)...', 'debug');
    await new Promise(r => setTimeout(r, 5000));

    // 2. Frame-safe 새로고침
    try {
      await this.frameRecovery.safeEvaluate(page, () => {
        window.location.reload();
      });
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      this.log('새로고침 실패, 계속 진행', 'warning');
    }

    // 3. YouTube 홈페이지로 이동 (Frame-safe)
    try {
      await this.safeNavigate(page, 'https://www.youtube.com', {
        maxRetries: 1,
        timeout: 15000
      });
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      this.log('YouTube 홈 이동 실패, 계속 진행', 'warning');
    }

    // 4. 최종 대기
    this.log('최종 세션 안정화 (2초)...', 'debug');
    await new Promise(r => setTimeout(r, 2000));

    this.log('✅ 세션 안정화 완료', 'success');
  }

  /**
   * 페이지 준비 상태 대기 (Frame-safe)
   */
  async waitForPageReady(page, options = {}) {
    const { selectors = [], timeout = this.config.defaultTimeout } = options;

    this.log('페이지 준비 대기 중...', 'debug');

    try {
      // Frame-safe DOM 확인
      const isReady = await this.frameRecovery.safeEvaluate(page, () => {
        return document.readyState === 'complete' || document.readyState === 'interactive';
      });

      if (!isReady) {
        await page.waitForFunction(
          () => document.readyState === 'complete',
          { timeout: 5000 }
        ).catch(() => {});
      }

      // 선택자 대기 (Frame-safe)
      if (selectors.length > 0) {
        for (const selector of selectors) {
          try {
            const exists = await this.frameRecovery.safeEvaluate(page, (sel) => {
              return !!document.querySelector(sel);
            }, selector);

            if (exists) {
              this.log(`요소 발견: ${selector}`, 'debug');
              break;
            }
          } catch (e) {
            // 계속 진행
          }
        }
      }

      // 추가 안정화
      await new Promise(r => setTimeout(r, 500));

      return {
        ready: true,
        url: page.url()
      };

    } catch (error) {
      this.log(`페이지 준비 확인 실패: ${error.message}`, 'warning');
      return {
        ready: false,
        error: error.message
      };
    }
  }

  /**
   * Frame detached 오류 확인
   */
  isFrameDetachedError(message) {
    if (!message) return false;

    const patterns = [
      'detached Frame',
      'Execution context was destroyed',
      'Cannot find context',
      'frame was detached',
      'Navigating frame was detached',
      'Session closed'
    ];

    return patterns.some(pattern =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * 네비게이션 히스토리 추가
   */
  addToHistory(entry) {
    this.navigationHistory.push(entry);

    // 최대 50개까지만 유지
    if (this.navigationHistory.length > 50) {
      this.navigationHistory.shift();
    }
  }

  /**
   * 페이지 뒤로 가기 (Frame-safe)
   */
  async goBack(page, options = {}) {
    try {
      await this.frameRecovery.safeEvaluate(page, () => {
        window.history.back();
      });

      await new Promise(r => setTimeout(r, 2000));

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
   * 페이지 새로고침 (Frame-safe)
   */
  async reload(page, options = {}) {
    try {
      await this.frameRecovery.safeEvaluate(page, () => {
        window.location.reload();
      });

      await new Promise(r => setTimeout(r, 3000));

      return {
        success: true,
        url: page.url()
      };
    } catch (error) {
      this.log(`새로고침 실패: ${error.message}`, 'error');

      // 대체 방법: page.reload() 사용
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        return {
          success: true,
          url: page.url()
        };
      } catch (e) {
        throw error;
      }
    }
  }
}

module.exports = EnhancedNavigationService;