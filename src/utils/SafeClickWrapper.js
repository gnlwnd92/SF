/**
 * Safe Click Wrapper
 * 기존 클릭 메서드를 래핑하여 Detached Frame 오류를 방지
 */

const FrameSafetyHandler = require('./FrameSafetyHandler');
const chalk = require('chalk');

class SafeClickWrapper {
  constructor(page, options = {}) {
    this.page = page;
    this.frameSafetyHandler = new FrameSafetyHandler({
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 2000,
      stabilityWait: options.stabilityWait || 1500,
      debug: options.debug || false
    });
    this.debug = options.debug || false;
  }

  /**
   * 안전한 evaluate 내에서의 클릭 처리
   */
  async safeEvaluateClick(evaluateFunction, ...args) {
    return await this.frameSafetyHandler.executeWithFrameSafety(this.page, async () => {
      try {
        // 페이지 안정화 대기
        await this.frameSafetyHandler.waitForStability(this.page);

        // evaluate 실행
        const result = await this.page.evaluate(evaluateFunction, ...args);

        // 클릭이 성공한 경우 추가 안정화
        if (result) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return result;
      } catch (error) {
        if (this.debug) {
          console.log(chalk.yellow(`⚠️ Evaluate 클릭 오류: ${error.message}`));
        }

        // Detached Frame 오류인 경우 재시도
        if (this.frameSafetyHandler.isDetachedFrameError(error)) {
          await this.frameSafetyHandler.recoverPageState(this.page);

          // 한 번 더 시도
          return await this.page.evaluate(evaluateFunction, ...args).catch(() => false);
        }

        throw error;
      }
    });
  }

  /**
   * 버튼 찾기 및 클릭 (텍스트 기반)
   */
  async clickButtonByText(buttonTexts, options = {}) {
    const selector = options.selector || 'button, tp-yt-paper-button, [role="button"]';

    return await this.safeEvaluateClick((texts, sel) => {
      const buttons = Array.from(document.querySelectorAll(sel));

      for (const text of texts) {
        const button = buttons.find(btn => {
          const btnText = btn.textContent?.trim();
          return btnText && (btnText === text || btnText.includes(text));
        });

        if (button && button.offsetHeight > 0) {
          // 버튼이 보이는 경우에만 클릭
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // 스크롤 완료 대기
          setTimeout(() => {
            button.click();
          }, 300);

          return { success: true, text: button.textContent?.trim() };
        }
      }

      return { success: false };
    }, buttonTexts, selector);
  }

  /**
   * 선택자로 직접 클릭
   */
  async clickBySelector(selector, options = {}) {
    return await this.frameSafetyHandler.safeClick(this.page, selector, options);
  }

  /**
   * 복잡한 클릭 작업 (스크롤, 대기, 클릭)
   */
  async complexClick(findFunction, clickFunction, options = {}) {
    return await this.frameSafetyHandler.executeWithFrameSafety(this.page, async () => {
      // 요소 찾기
      const element = await this.page.evaluate(findFunction);

      if (!element || !element.found) {
        return false;
      }

      // 스크롤
      if (element.needsScroll) {
        await this.page.evaluate((scrollData) => {
          const target = document.querySelector(scrollData.selector);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, element);

        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // 클릭 실행
      const clicked = await this.page.evaluate(clickFunction, element);

      if (clicked && options.waitAfterClick) {
        await new Promise(resolve => setTimeout(resolve, options.waitAfterClick));
      }

      return clicked;
    });
  }

  /**
   * 팝업/다이얼로그 내 버튼 클릭
   */
  async clickInDialog(buttonTexts, options = {}) {
    // 다이얼로그/팝업 특별 처리
    const dialogSelectors = [
      'tp-yt-paper-dialog',
      'ytd-popup-container',
      '[role="dialog"]',
      '.dialog-content',
      'yt-confirm-dialog-renderer'
    ];

    return await this.safeEvaluateClick((texts, selectors) => {
      // 다이얼로그 찾기
      let dialog = null;
      for (const selector of selectors) {
        dialog = document.querySelector(selector);
        if (dialog) break;
      }

      if (!dialog) {
        // 전체 페이지에서 찾기
        dialog = document.body;
      }

      // 다이얼로그 내 버튼 찾기
      const buttons = Array.from(dialog.querySelectorAll('button, tp-yt-paper-button, [role="button"]'));

      for (const text of texts) {
        const button = buttons.find(btn => {
          const btnText = btn.textContent?.trim();
          return btnText && (btnText === text || btnText.includes(text));
        });

        if (button && button.offsetHeight > 0) {
          button.scrollIntoView({ behavior: 'instant', block: 'center' });
          button.click();
          return { success: true, text: button.textContent?.trim() };
        }
      }

      return { success: false };
    }, buttonTexts, dialogSelectors);
  }

  /**
   * 드롭다운 메뉴 클릭
   */
  async clickDropdownOption(optionTexts, options = {}) {
    return await this.safeEvaluateClick((texts) => {
      // 드롭다운 옵션 선택자들
      const optionSelectors = [
        'tp-yt-paper-item',
        'ytd-menu-service-item-renderer',
        '[role="option"]',
        '[role="menuitem"]'
      ];

      let foundOption = null;

      for (const selector of optionSelectors) {
        const options = Array.from(document.querySelectorAll(selector));

        for (const text of texts) {
          foundOption = options.find(opt => {
            const optText = opt.textContent?.trim();
            return optText && (optText === text || optText.includes(text));
          });

          if (foundOption) break;
        }

        if (foundOption) break;
      }

      if (foundOption && foundOption.offsetHeight > 0) {
        foundOption.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        foundOption.click();
        return { success: true, text: foundOption.textContent?.trim() };
      }

      return { success: false };
    }, optionTexts);
  }

  /**
   * 여러 클릭 시도 (폴백 전략)
   */
  async tryMultipleClickStrategies(strategies) {
    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result) {
          if (this.debug) {
            console.log(chalk.green('✅ 클릭 전략 성공'));
          }
          return result;
        }
      } catch (error) {
        if (this.debug) {
          console.log(chalk.yellow(`⚠️ 클릭 전략 실패: ${error.message}`));
        }
        // 다음 전략 시도
        continue;
      }
    }

    return false;
  }
}

module.exports = SafeClickWrapper;