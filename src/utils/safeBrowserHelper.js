/**
 * Safe Browser Helper
 * Detached Frame 오류를 방지하는 최소한의 유틸리티
 *
 * KISS 원칙 적용: Keep It Simple, Stupid
 */

const chalk = require('chalk');

/**
 * 안전한 클릭 - 단순하고 효과적
 */
async function safeClick(page, selector, options = {}) {
  const maxRetries = options.retries || 3;
  const debug = options.debug || false;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Playwright의 기본 기능 활용 - auto-waiting 포함
      await page.click(selector, {
        timeout: options.timeout || 10000,
        strict: true  // 정확히 하나의 요소만 매칭
      });

      if (debug) {
        console.log(chalk.green(`✅ 클릭 성공: ${selector}`));
      }
      return true;

    } catch (error) {
      const isDetached = error.message.includes('detached') ||
                        error.message.includes('Execution context');

      if (isDetached && i < maxRetries - 1) {
        if (debug) {
          console.log(chalk.yellow(`⚠️ Detached context 감지, 재시도 ${i + 1}/${maxRetries}`));
        }
        // 점진적 대기
        await page.waitForTimeout(1000 * (i + 1));
        continue;
      }

      // 다른 오류이거나 마지막 시도 실패
      throw error;
    }
  }
}

/**
 * 안전한 평가 - page.evaluate를 안전하게 래핑
 */
async function safeEvaluate(page, fn, ...args) {
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (error) {
      const isDetached = error.message.includes('detached') ||
                        error.message.includes('Execution context') ||
                        error.message.includes('Cannot find context');

      if (isDetached && i < maxRetries - 1) {
        // 짧은 대기 후 재시도
        await page.waitForTimeout(500 * (i + 1));
        continue;
      }

      throw error;
    }
  }
}

/**
 * 페이지 안정화 대기 - 간단한 버전
 */
async function waitForStable(page) {
  // waitForNavigation은 네비게이션이 시작되기 전에 호출되어야 함
  // 이미 네비게이션이 완료된 후에는 사용하지 않음

  // 1. 페이지 안정화를 위한 대기
  await page.waitForTimeout(2000);

  // 2. body 요소 확인
  try {
    await page.waitForSelector('body', {
      visible: true,
      timeout: 3000
    });
  } catch (error) {
    // body 요소를 못 찾아도 계속 진행
  }

  // 3. 추가 안정화 시간
  await page.waitForTimeout(1000);
}

/**
 * 안전한 네비게이션
 */
async function safeGoto(page, url, options = {}) {
  try {
    await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000
    });

    // 페이지 안정화 대기
    await waitForStable(page);
    return true;

  } catch (error) {
    // 네비게이션 실패시 재시도
    if (error.message.includes('detached')) {
      await page.waitForTimeout(2000);
      return await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    }
    throw error;
  }
}

/**
 * 텍스트 기반 클릭 - 더 안정적
 */
async function clickByText(page, text, options = {}) {
  const maxRetries = options.retries || 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Playwright의 텍스트 선택자 활용
      await page.click(`text="${text}"`, {
        timeout: options.timeout || 10000
      });
      return true;

    } catch (error) {
      if (error.message.includes('detached') && i < maxRetries - 1) {
        await page.waitForTimeout(1000 * (i + 1));
        continue;
      }

      // 텍스트를 찾을 수 없는 경우 부분 매칭 시도
      if (i === maxRetries - 1) {
        try {
          await page.click(`text*="${text}"`, {
            timeout: 5000
          });
          return true;
        } catch {
          throw error;
        }
      }
    }
  }
}

/**
 * 요소 존재 확인 - 안전하게
 */
async function hasElement(page, selector) {
  try {
    const element = await page.$(selector);
    return element !== null;
  } catch (error) {
    // Detached context 오류는 false로 처리
    if (error.message.includes('detached')) {
      return false;
    }
    throw error;
  }
}

/**
 * 안전한 텍스트 가져오기
 */
async function safeGetText(page, selector) {
  try {
    return await page.textContent(selector);
  } catch (error) {
    if (error.message.includes('detached')) {
      // 재시도
      await page.waitForTimeout(1000);
      return await page.textContent(selector);
    }
    throw error;
  }
}

module.exports = {
  safeClick,
  safeEvaluate,
  waitForStable,
  safeGoto,
  clickByText,
  hasElement,
  safeGetText
};