/**
 * Frame Safety Handler
 * Detached Frame 오류를 방지하는 유틸리티 클래스
 */

const chalk = require('chalk');

class FrameSafetyHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 2000;
    this.stabilityWait = options.stabilityWait || 1500;
    this.debug = options.debug || false;
  }

  /**
   * 안전한 클릭 실행
   */
  async safeClick(page, selector, options = {}) {
    return await this.executeWithFrameSafety(page, async () => {
      // 페이지 안정화 대기
      await this.waitForStability(page);

      // 요소 존재 확인
      await page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout || 5000
      });

      // 클릭 가능 여부 확인 (Puppeteer 방식)
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const isClickable = await element.evaluate(el => {
        return el && !el.disabled && el.offsetParent !== null;
      });

      if (!isClickable) {
        throw new Error(`Element not clickable: ${selector}`);
      }

      // 실제 클릭
      await page.click(selector, {
        timeout: options.timeout || 5000,
        force: options.force || false
      });

      if (this.debug) {
        console.log(chalk.green(`✅ 안전하게 클릭됨: ${selector}`));
      }
    });
  }

  /**
   * 안전한 텍스트 입력
   */
  async safeType(page, selector, text, options = {}) {
    return await this.executeWithFrameSafety(page, async () => {
      await this.waitForStability(page);

      await page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout || 5000
      });

      // 기존 텍스트 지우기
      if (options.clear !== false) {
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
      }

      // 텍스트 입력
      await page.type(selector, text, {
        delay: options.delay || 50
      });

      if (this.debug) {
        console.log(chalk.green(`✅ 안전하게 입력됨: ${selector}`));
      }
    });
  }

  /**
   * 안전한 선택
   */
  async safeSelect(page, selector, value, options = {}) {
    return await this.executeWithFrameSafety(page, async () => {
      await this.waitForStability(page);

      await page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout || 5000
      });

      await page.selectOption(selector, value);

      if (this.debug) {
        console.log(chalk.green(`✅ 안전하게 선택됨: ${selector} -> ${value}`));
      }
    });
  }

  /**
   * 안전한 요소 가져오기
   */
  async safeGetElement(page, selector, options = {}) {
    return await this.executeWithFrameSafety(page, async () => {
      await this.waitForStability(page);

      const element = await page.waitForSelector(selector, {
        state: 'visible',
        timeout: options.timeout || 5000
      });

      // 요소가 여전히 연결되어 있는지 확인
      const isAttached = await element.evaluate(el => el.isConnected);

      if (!isAttached) {
        throw new Error(`Element detached: ${selector}`);
      }

      return element;
    });
  }

  /**
   * Frame 안전성을 보장하면서 작업 실행
   */
  async executeWithFrameSafety(page, operation, retryCount = 0) {
    try {
      return await operation();
    } catch (error) {
      // Detached Frame 오류 확인
      if (this.isDetachedFrameError(error)) {
        if (retryCount < this.maxRetries) {
          if (this.debug) {
            console.log(chalk.yellow(
              `⚠️  Detached Frame 감지, 재시도 ${retryCount + 1}/${this.maxRetries}`
            ));
          }

          // 점진적 대기
          const delay = this.retryDelay * (retryCount + 1);
          await this.wait(delay);

          // 페이지 상태 복구 시도
          await this.recoverPageState(page);

          // 재시도
          return await this.executeWithFrameSafety(page, operation, retryCount + 1);
        } else {
          console.error(chalk.red('❌ Detached Frame 오류 해결 실패'));
          throw error;
        }
      }

      // 다른 오류는 그대로 전달
      throw error;
    }
  }

  /**
   * Detached Frame 오류인지 확인
   */
  isDetachedFrameError(error) {
    const errorMessage = error.message || error.toString();
    return errorMessage.includes('detached Frame') ||
           errorMessage.includes('Execution context was destroyed') ||
           errorMessage.includes('Cannot find context with specified id') ||
           errorMessage.includes('Node is detached from document');
  }

  /**
   * 페이지 상태 복구
   */
  async recoverPageState(page) {
    try {
      // 현재 URL 저장
      const currentUrl = page.url();

      // 페이지가 여전히 응답하는지 확인
      const isResponsive = await page.evaluate(() => true).catch(() => false);

      if (!isResponsive) {
        if (this.debug) {
          console.log(chalk.yellow('⚠️  페이지 응답 없음, 새로고침 시도'));
        }
        await page.reload({ waitUntil: 'networkidle' });
      }

      // 필요시 URL 복구
      if (page.url() !== currentUrl && currentUrl !== 'about:blank') {
        await page.goto(currentUrl, { waitUntil: 'networkidle' });
      }

      // 페이지 안정화 대기
      await this.waitForStability(page);

    } catch (error) {
      console.error(chalk.red('❌ 페이지 상태 복구 실패:', error.message));
    }
  }

  /**
   * 페이지 안정화 대기
   */
  async waitForStability(page) {
    // waitForNavigation은 네비게이션이 시작되기 전에 호출되어야 함
    // 이미 네비게이션이 완료된 후에는 사용하지 않음

    // 1. 페이지가 안정화되도록 대기
    await this.wait(2000);

    // 2. 기본 요소 확인 (Puppeteer 방식)
    await page.waitForSelector('body', {
      visible: true,
      timeout: 2000
    }).catch(() => {});

    // 3. 추가 안정화 시간
    await this.wait(this.stabilityWait);
  }

  /**
   * Frame 상태 확인
   */
  async checkFrameStatus(page, frameNameOrIndex) {
    try {
      let frame;

      if (typeof frameNameOrIndex === 'number') {
        frame = page.frames()[frameNameOrIndex];
      } else {
        frame = page.frame({ name: frameNameOrIndex });
      }

      if (!frame) {
        return { exists: false, detached: true };
      }

      // Frame이 분리되었는지 확인
      const isDetached = frame.detached();

      // Frame이 응답하는지 확인
      const isResponsive = await frame.evaluate(() => true).catch(() => false);

      return {
        exists: true,
        detached: isDetached,
        responsive: isResponsive
      };
    } catch (error) {
      return { exists: false, detached: true, error: error.message };
    }
  }

  /**
   * 안전한 Frame 작업
   */
  async safeFrameOperation(page, frameIdentifier, operation) {
    const maxFrameRetries = 3;

    for (let i = 0; i < maxFrameRetries; i++) {
      try {
        // Frame 상태 확인
        const status = await this.checkFrameStatus(page, frameIdentifier);

        if (!status.exists || status.detached) {
          if (this.debug) {
            console.log(chalk.yellow(`⚠️  Frame 사용 불가, 페이지 새로고침 시도 ${i + 1}/${maxFrameRetries}`));
          }
          await page.reload();
          await this.waitForStability(page);
          continue;
        }

        // Frame 가져오기
        const frame = typeof frameIdentifier === 'number'
          ? page.frames()[frameIdentifier]
          : page.frame({ name: frameIdentifier });

        // 작업 실행
        return await operation(frame);

      } catch (error) {
        if (this.isDetachedFrameError(error) && i < maxFrameRetries - 1) {
          await this.wait(2000 * (i + 1));
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Frame 작업 실패: ${frameIdentifier}`);
  }

  /**
   * 대기 함수
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 다중 재시도 실행
   */
  async retryWithExponentialBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const initialDelay = options.initialDelay || 1000;
    const maxDelay = options.maxDelay || 30000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (this.isDetachedFrameError(error)) {
          if (i === maxRetries - 1) throw error;

          const delay = Math.min(initialDelay * Math.pow(2, i), maxDelay);

          if (this.debug) {
            console.log(chalk.yellow(
              `⏳ 재시도 대기 ${delay}ms (시도 ${i + 1}/${maxRetries})`
            ));
          }

          await this.wait(delay);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * 안전한 네비게이션
   */
  async safeNavigation(page, url, options = {}) {
    return await this.executeWithFrameSafety(page, async () => {
      // 네비게이션 전 현재 상태 저장
      const previousUrl = page.url();

      try {
        // 네비게이션 실행
        await page.goto(url, {
          waitUntil: options.waitUntil || 'networkidle',
          timeout: options.timeout || 30000
        });

        // 페이지 안정화 대기
        await this.waitForStability(page);

        if (this.debug) {
          console.log(chalk.green(`✅ 안전하게 이동됨: ${url}`));
        }

      } catch (error) {
        // 네비게이션 실패시 복구 시도
        if (previousUrl !== 'about:blank') {
          await page.goto(previousUrl, { waitUntil: 'domcontentloaded' });
        }
        throw error;
      }
    });
  }
}

module.exports = FrameSafetyHandler;