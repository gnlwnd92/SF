/**
 * DialogHandler - 브라우저 다이얼로그 자동 처리 유틸리티
 *
 * 브라우저의 네이티브 다이얼로그(alert, confirm, prompt, beforeunload)를
 * 자동으로 처리하여 워크플로우가 막히지 않도록 합니다.
 *
 * 주요 기능:
 * - beforeunload 다이얼로그 자동 수락 ("사이트에서 나가시겠습니까?")
 * - alert/confirm/prompt 다이얼로그 자동 처리
 * - 이벤트 리스너 제거로 다이얼로그 발생 원천 차단
 *
 * @module utils/DialogHandler
 */

const chalk = require('chalk');

class DialogHandler {
  constructor(options = {}) {
    this.options = {
      debugMode: options.debugMode || false,
      autoAccept: options.autoAccept !== false, // 기본: 자동 수락
      logDialogs: options.logDialogs !== false,  // 기본: 로깅 활성화
      ...options
    };

    // 처리된 다이얼로그 통계
    this.stats = {
      totalHandled: 0,
      beforeunload: 0,
      alert: 0,
      confirm: 0,
      prompt: 0
    };

    // 등록된 페이지 추적
    this.registeredPages = new WeakSet();
  }

  /**
   * 페이지에 다이얼로그 핸들러 등록
   *
   * @param {Page} page - Puppeteer/Playwright 페이지 객체
   * @returns {boolean} 등록 성공 여부
   */
  registerDialogHandler(page) {
    if (!page) {
      this.log('페이지 객체가 없습니다', 'error');
      return false;
    }

    // 이미 등록된 페이지인지 확인
    if (this.registeredPages.has(page)) {
      this.log('이미 다이얼로그 핸들러가 등록된 페이지입니다', 'debug');
      return true;
    }

    try {
      // Puppeteer와 Playwright 모두 지원
      page.on('dialog', async (dialog) => {
        await this.handleDialog(dialog);
      });

      this.registeredPages.add(page);
      this.log('✅ 다이얼로그 핸들러 등록 완료', 'success');
      return true;

    } catch (error) {
      this.log(`다이얼로그 핸들러 등록 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 다이얼로그 처리
   *
   * @param {Dialog} dialog - 브라우저 다이얼로그 객체
   */
  async handleDialog(dialog) {
    const dialogType = dialog.type();
    const message = dialog.message();

    this.stats.totalHandled++;

    // 다이얼로그 타입별 통계 업데이트
    if (this.stats[dialogType] !== undefined) {
      this.stats[dialogType]++;
    }

    if (this.options.logDialogs) {
      this.log(`📌 다이얼로그 감지 [${dialogType}]: ${message.substring(0, 100)}...`, 'info');
    }

    try {
      if (this.options.autoAccept) {
        // beforeunload는 항상 accept (페이지 이동 허용)
        // confirm도 기본적으로 accept
        // alert는 dismiss
        if (dialogType === 'beforeunload' || dialogType === 'confirm') {
          await dialog.accept();
          this.log(`✅ 다이얼로그 수락됨 [${dialogType}]`, 'success');
        } else if (dialogType === 'alert') {
          await dialog.dismiss();
          this.log(`✅ Alert 닫힘`, 'success');
        } else if (dialogType === 'prompt') {
          await dialog.accept(''); // 빈 값으로 수락
          this.log(`✅ Prompt 빈 값으로 수락됨`, 'success');
        } else {
          await dialog.accept();
          this.log(`✅ 알 수 없는 다이얼로그 수락됨 [${dialogType}]`, 'warning');
        }
      }
    } catch (error) {
      this.log(`다이얼로그 처리 실패: ${error.message}`, 'error');
      // 실패해도 계속 진행
    }
  }

  /**
   * 페이지의 beforeunload 이벤트 리스너 제거
   * 다이얼로그 발생을 원천적으로 차단합니다.
   *
   * @param {Page} page - Puppeteer/Playwright 페이지 객체
   * @returns {Promise<boolean>} 성공 여부
   */
  async removeBeforeunloadListeners(page) {
    if (!page) return false;

    try {
      await page.evaluate(() => {
        // beforeunload 이벤트 리스너 제거
        window.onbeforeunload = null;

        // 모든 beforeunload 이벤트 리스너 제거 시도
        // 일부 사이트는 addEventListener로 등록하므로 이 방법도 시도
        const noop = () => {};

        // window의 이벤트 리스너 덮어쓰기
        window.addEventListener = new Proxy(window.addEventListener, {
          apply: function(target, thisArg, args) {
            // beforeunload 이벤트는 무시
            if (args[0] === 'beforeunload') {
              return;
            }
            return Reflect.apply(target, thisArg, args);
          }
        });

        // returnValue 설정 방지 (Chrome의 beforeunload 동작)
        Object.defineProperty(Event.prototype, 'returnValue', {
          set: function() {},
          get: function() { return ''; }
        });
      });

      this.log('✅ beforeunload 리스너 제거 완료', 'success');
      return true;

    } catch (error) {
      // 에러가 발생해도 크리티컬하지 않음
      this.log(`beforeunload 리스너 제거 실패 (무시): ${error.message}`, 'debug');
      return false;
    }
  }

  /**
   * 안전한 페이지 이동 (beforeunload 처리 포함)
   *
   * @param {Page} page - 페이지 객체
   * @param {string} url - 이동할 URL
   * @param {Object} options - 이동 옵션
   * @returns {Promise<Object>} 이동 결과
   */
  async safeNavigate(page, url, options = {}) {
    const timeout = options.timeout || 30000;
    const waitUntil = options.waitUntil || 'domcontentloaded';

    try {
      // 1. 다이얼로그 핸들러 등록 확인
      this.registerDialogHandler(page);

      // 2. beforeunload 리스너 제거 시도
      await this.removeBeforeunloadListeners(page);

      // 3. 짧은 대기 (DOM 안정화)
      await new Promise(r => setTimeout(r, 100));

      // 4. 페이지 이동
      this.log(`🌐 페이지 이동: ${url}`, 'info');

      const response = await page.goto(url, {
        waitUntil,
        timeout
      });

      return {
        success: true,
        url: page.url(),
        status: response?.status ? response.status() : null
      };

    } catch (error) {
      // Navigation timeout인 경우에도 다이얼로그 확인
      if (error.message.includes('Navigation timeout')) {
        this.log('⏱️ 네비게이션 타임아웃 - 다이얼로그로 인한 블로킹 가능성', 'warning');
      }

      return {
        success: false,
        error: error.message,
        url: page.url()
      };
    }
  }

  /**
   * 페이지 새로고침 전 beforeunload 처리
   *
   * @param {Page} page - 페이지 객체
   * @param {Object} options - 옵션
   */
  async safeReload(page, options = {}) {
    try {
      this.registerDialogHandler(page);
      await this.removeBeforeunloadListeners(page);

      await page.reload({
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || 30000
      });

      return { success: true };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Gmail/Google 앱 전용 beforeunload 제거
   * Gmail은 특별한 방식으로 beforeunload를 등록하므로 별도 처리
   *
   * @param {Page} page - 페이지 객체
   */
  async removeGoogleAppBeforeunload(page) {
    if (!page) return false;

    try {
      const currentUrl = page.url();

      // Google/Gmail 관련 페이지인 경우에만 적용
      if (!currentUrl.includes('google.com') && !currentUrl.includes('gmail.com')) {
        return true;
      }

      await page.evaluate(() => {
        // Gmail 전용: window.onbeforeunload 완전 제거
        window.onbeforeunload = null;

        // Gmail의 draft 저장 관련 beforeunload 제거
        if (window._iframeManager) {
          window._iframeManager = null;
        }

        // Gmail의 모든 unload 관련 핸들러 제거 시도
        const events = ['beforeunload', 'unload', 'pagehide'];
        events.forEach(event => {
          // 이벤트 리스너 목록을 가져올 수 없으므로,
          // 새로운 빈 핸들러로 덮어쓰기
          window[`on${event}`] = null;
        });

        // 페이지 변경 추적 비활성화
        if (window.history && window.history.pushState) {
          // pushState의 beforeunload 트리거 방지
          const originalPushState = window.history.pushState;
          window.history.pushState = function() {
            window.onbeforeunload = null;
            return originalPushState.apply(this, arguments);
          };
        }
      });

      this.log('✅ Google 앱 beforeunload 핸들러 제거 완료', 'success');
      return true;

    } catch (error) {
      this.log(`Google 앱 핸들러 제거 실패: ${error.message}`, 'debug');
      return false;
    }
  }

  /**
   * 통계 가져오기
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 통계 초기화
   */
  resetStats() {
    this.stats = {
      totalHandled: 0,
      beforeunload: 0,
      alert: 0,
      confirm: 0,
      prompt: 0
    };
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.options.debugMode && level === 'debug') {
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
    console.log(chalk[color](`[DialogHandler] ${message}`));
  }
}

// 싱글톤 인스턴스 (전역 사용을 위해)
const globalDialogHandler = new DialogHandler();

module.exports = DialogHandler;
module.exports.globalDialogHandler = globalDialogHandler;
