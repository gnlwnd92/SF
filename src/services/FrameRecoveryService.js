/**
 * Frame Recovery Service
 * Frame detached 오류를 감지하고 자동으로 복구하는 서비스
 */

const chalk = require('chalk');

class FrameRecoveryService {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 2000;
    this.debugMode = options.debugMode || true;
  }

  /**
   * Frame-safe evaluate 실행
   * Frame이 detached 되면 자동으로 재연결 시도
   */
  async safeEvaluate(page, fn, ...args) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // 현재 Frame 상태 체크
        const frameState = await this.checkFrameState(page);
        if (this.debugMode) {
          console.log(chalk.gray(`[FrameRecovery] Frame 상태 (시도 ${attempt}): ${frameState.status}`));
          if (frameState.url) {
            console.log(chalk.gray(`[FrameRecovery] 현재 URL: ${frameState.url}`));
          }
        }

        // evaluate 실행
        const result = await page.evaluate(fn, ...args);

        if (this.debugMode && attempt > 1) {
          console.log(chalk.green(`[FrameRecovery] ✅ 재시도 ${attempt}에서 성공`));
        }

        return result;

      } catch (error) {
        lastError = error;
        const errorMsg = error.message || '';

        if (this.debugMode) {
          console.log(chalk.yellow(`[FrameRecovery] ⚠️ 시도 ${attempt} 실패: ${errorMsg}`));
        }

        // Frame detached 오류 확인
        if (this.isFrameDetachedError(errorMsg)) {
          console.log(chalk.yellow(`[FrameRecovery] 🔄 Frame detached 감지, 복구 시도 중...`));

          // Frame 복구 시도
          await this.recoverFrame(page);

          // 재시도 전 대기
          await new Promise(r => setTimeout(r, this.retryDelay));

        } else if (this.isNavigationError(errorMsg)) {
          console.log(chalk.yellow(`[FrameRecovery] 🔄 페이지 네비게이션 감지, 대기 중...`));

          // 페이지 안정화 대기
          await this.waitForStability(page);

        } else {
          // Frame 관련이 아닌 오류는 즉시 throw
          throw error;
        }
      }
    }

    // 모든 재시도 실패
    console.log(chalk.red(`[FrameRecovery] ❌ ${this.maxRetries}회 재시도 후에도 실패`));
    throw lastError;
  }

  /**
   * Frame detached 오류인지 확인
   */
  isFrameDetachedError(errorMessage) {
    const patterns = [
      'detached Frame',
      'Execution context was destroyed',
      'Cannot find context',
      'Execution context is not available',
      'frame was detached'
    ];

    return patterns.some(pattern =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * 네비게이션 관련 오류인지 확인
   */
  isNavigationError(errorMessage) {
    const patterns = [
      'navigation',
      'page is navigating',
      'page closed'
    ];

    return patterns.some(pattern =>
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * 현재 Frame 상태 확인
   */
  async checkFrameState(page) {
    try {
      // 기본 정보 수집
      const url = page.url();
      const title = await page.title().catch(() => 'N/A');

      // Frame 접근 가능 여부 확인
      const canAccess = await page.evaluate(() => {
        return {
          hasDocument: typeof document !== 'undefined',
          readyState: document?.readyState || 'unknown',
          hasBody: !!document?.body,
          timestamp: Date.now()
        };
      }).catch(err => ({ error: err.message }));

      return {
        status: canAccess.error ? 'detached' : 'attached',
        url,
        title,
        details: canAccess
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Frame 복구 시도
   */
  async recoverFrame(page) {
    try {
      console.log(chalk.blue('[FrameRecovery] 🔧 Frame 복구 시작...'));

      // 1. 현재 URL 확인
      const currentUrl = page.url();
      console.log(chalk.gray(`[FrameRecovery] 현재 URL: ${currentUrl}`));

      // 2. 페이지 안정화 대기
      await this.waitForStability(page);

      // 3. Main frame 재설정 시도
      try {
        await page.mainFrame();
        console.log(chalk.green('[FrameRecovery] ✅ Main frame 재연결 성공'));
      } catch (err) {
        console.log(chalk.yellow(`[FrameRecovery] ⚠️ Main frame 재연결 실패: ${err.message}`));
      }

      // 4. DOM 로드 확인
      const domReady = await page.evaluate(() => {
        return document.readyState === 'complete' || document.readyState === 'interactive';
      }).catch(() => false);

      if (domReady) {
        console.log(chalk.green('[FrameRecovery] ✅ DOM 준비 완료'));
      } else {
        console.log(chalk.yellow('[FrameRecovery] ⚠️ DOM 아직 준비 중...'));
        await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
      }

      console.log(chalk.blue('[FrameRecovery] 🔧 Frame 복구 완료'));

    } catch (error) {
      console.log(chalk.red(`[FrameRecovery] ❌ Frame 복구 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * 페이지 안정화 대기
   */
  async waitForStability(page, timeout = 5000) {
    const startTime = Date.now();

    console.log(chalk.gray('[FrameRecovery] ⏳ 페이지 안정화 대기 중...'));

    // 1. 기본 대기
    await new Promise(r => setTimeout(r, 1000));

    // 2. DOM 로드 대기
    try {
      await page.waitForFunction(
        () => document.readyState === 'complete',
        { timeout: timeout - 1000 }
      );
    } catch (err) {
      // 타임아웃은 무시
    }

    // 3. 추가 안정화 시간
    await new Promise(r => setTimeout(r, 500));

    const elapsed = Date.now() - startTime;
    console.log(chalk.gray(`[FrameRecovery] ⏳ 안정화 완료 (${elapsed}ms)`));
  }

  /**
   * 안전한 클릭 실행
   */
  async safeClick(page, selector, options = {}) {
    const { timeout = 5000, waitAfter = 1000 } = options;

    try {
      console.log(chalk.gray(`[FrameRecovery] 🖱️ 클릭 시도: ${selector}`));

      // 요소 대기
      await page.waitForSelector(selector, {
        visible: true,
        timeout
      });

      // 클릭 전 Frame 상태 확인
      const beforeState = await this.checkFrameState(page);
      console.log(chalk.gray(`[FrameRecovery] 클릭 전 Frame 상태: ${beforeState.status}`));

      // 클릭 실행
      await page.click(selector);

      // 클릭 후 대기
      await new Promise(r => setTimeout(r, waitAfter));

      // 클릭 후 Frame 상태 확인
      const afterState = await this.checkFrameState(page);
      console.log(chalk.gray(`[FrameRecovery] 클릭 후 Frame 상태: ${afterState.status}`));

      // Frame이 변경되었다면 복구
      if (afterState.status === 'detached' || beforeState.url !== afterState.url) {
        console.log(chalk.yellow('[FrameRecovery] 🔄 클릭 후 Frame 변경 감지'));
        await this.recoverFrame(page);
      }

      return { success: true };

    } catch (error) {
      console.log(chalk.red(`[FrameRecovery] ❌ 안전한 클릭 실패: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * 버튼 클릭과 페이지 전환을 안전하게 처리
   */
  async clickAndWaitForNavigation(page, clickFn, options = {}) {
    const { timeout = 30000, waitUntil = 'domcontentloaded' } = options;

    console.log(chalk.blue('[FrameRecovery] 🔄 네비게이션 대기 클릭 시작'));

    try {
      // 현재 URL 저장
      const originalUrl = page.url();

      // Promise.race를 사용하여 네비게이션 또는 팝업 감지
      const result = await Promise.race([
        // 네비게이션 대기
        Promise.all([
          page.waitForNavigation({
            waitUntil,
            timeout: timeout / 2
          }).catch(() => null),
          clickFn()
        ]),

        // 팝업/다이얼로그 대기
        new Promise(async (resolve) => {
          await clickFn();
          await new Promise(r => setTimeout(r, 2000));

          // 팝업 확인
          const hasPopup = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
            return dialogs.length > 0;
          }).catch(() => false);

          if (hasPopup) {
            resolve({ type: 'popup' });
          }
        }),

        // 타임아웃
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Navigation timeout')), timeout)
        )
      ]);

      // URL 변경 확인
      const newUrl = page.url();
      const navigated = originalUrl !== newUrl;

      console.log(chalk.green(`[FrameRecovery] ✅ 클릭 완료 (네비게이션: ${navigated ? '예' : '아니오'})`));

      // Frame 복구
      if (navigated || result?.type === 'popup') {
        await this.recoverFrame(page);
      }

      return {
        success: true,
        navigated,
        hasPopup: result?.type === 'popup'
      };

    } catch (error) {
      console.log(chalk.red(`[FrameRecovery] ❌ 네비게이션 클릭 실패: ${error.message}`));

      // 오류 발생 시에도 Frame 복구 시도
      await this.recoverFrame(page).catch(() => {});

      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = FrameRecoveryService;