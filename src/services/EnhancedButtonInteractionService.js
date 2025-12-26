/**
 * Enhanced Button Interaction Service with Frame Recovery
 * Frame detached 오류를 자동으로 감지하고 복구하는 개선된 버튼 상호작용 서비스
 */

const chalk = require('chalk');
const FrameRecoveryService = require('./FrameRecoveryService');
const HumanLikeMouseHelper = require('../infrastructure/adapters/HumanLikeMouseHelper');
const CDPClickHelper = require('../infrastructure/adapters/CDPClickHelper');

class EnhancedButtonInteractionService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode !== undefined ? config.debugMode : true,
      maxRetries: config.maxRetries || 3,
      waitTimeout: config.waitTimeout || 3000,
      navigationTimeout: config.navigationTimeout || 30000,
      scrollAttempts: config.scrollAttempts || 3,
      frameRecoveryEnabled: config.frameRecoveryEnabled !== undefined ? config.frameRecoveryEnabled : true,
      humanLikeMotion: config.humanLikeMotion || false
    };

    // Frame Recovery Service 초기화
    this.frameRecovery = new FrameRecoveryService({
      maxRetries: 3,
      retryDelay: 2000,
      debugMode: this.config.debugMode
    });

    // 휴먼라이크 헬퍼 (페이지 연결 후 초기화)
    this.mouseHelper = null;
    this.cdpHelper = null;

    this.log('Enhanced Button Service 초기화 완료 (Frame Recovery 활성화)');
  }

  /**
   * 휴먼라이크 헬퍼 초기화
   * @param {Page} page - Puppeteer 페이지 객체
   */
  async initializeHumanLikeHelpers(page) {
    if (!this.config.humanLikeMotion) {
      this.log('휴먼라이크 모션 비활성화됨', 'info');
      return;
    }

    try {
      this.mouseHelper = new HumanLikeMouseHelper(page, {
        debugMode: this.config.debugMode,
        jitterAmount: 3,
        moveSpeed: 'normal',
        mouseMoveSteps: 20
      });

      this.cdpHelper = new CDPClickHelper(page, {
        verbose: this.config.debugMode,
        naturalDelay: true
      });

      await this.cdpHelper.initialize();
      this.log('✅ 휴먼라이크 헬퍼 초기화 완료 (베지어 곡선 + CDP 클릭)', 'success');
    } catch (error) {
      this.log(`⚠️ 휴먼라이크 헬퍼 초기화 실패: ${error.message}`, 'warning');
      this.mouseHelper = null;
      this.cdpHelper = null;
    }
  }

  /**
   * 버튼 좌표 찾기 (클릭하지 않음)
   * @param {Page} page - Puppeteer 페이지 객체
   * @param {string[]} searchTexts - 검색할 버튼 텍스트 배열
   * @returns {Object} { found, x, y, text, element }
   */
  async findButtonCoordinates(page, searchTexts) {
    try {
      return await this.frameRecovery.safeEvaluate(page, (texts) => {
        const selectors = [
          'button',
          '[role="button"]',
          'a[role="button"]',
          'yt-button-renderer',
          'ytd-button-renderer button',
          'yt-button-shape button',
          'tp-yt-paper-button',
          'paper-button',
          'ytd-toggle-button-renderer',
          'ytd-menu-renderer button',
          'yt-icon-button',
          '[aria-expanded]',
          'div[tabindex="0"]',
          'span[tabindex="0"]',
          '#expand',
          '.expand-button',
          'ytd-expander'
        ];

        const buttons = document.querySelectorAll(selectors.join(', '));

        for (const button of buttons) {
          const btnText = button.textContent?.trim();

          if (btnText && texts.some(text =>
            btnText === text ||
            btnText.includes(text) ||
            btnText.toLowerCase().includes(text.toLowerCase())
          )) {
            if (button.offsetHeight > 0 && button.offsetWidth > 0) {
              // 스크롤하여 보이게 함
              button.scrollIntoView({ behavior: 'smooth', block: 'center' });

              // 버튼 좌표 계산
              const rect = button.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;

              return {
                found: true,
                x: x,
                y: y,
                text: btnText,
                element: button.tagName.toLowerCase()
              };
            }
          }
        }

        return { found: false };
      }, searchTexts);
    } catch (error) {
      this.log(`버튼 좌표 찾기 실패: ${error.message}`, 'error');
      return { found: false };
    }
  }

  log(message, level = 'info') {
    if (this.config.debugMode) {
      const colors = {
        info: chalk.cyan,
        success: chalk.green,
        warning: chalk.yellow,
        error: chalk.red
      };
      const color = colors[level] || chalk.gray;
      console.log(color(`[ButtonService] ${message}`));
    }
  }

  /**
   * Manage membership 버튼 클릭 - Frame 안전 처리
   */
  async clickManageMembershipButton(page, language = 'en', options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    const debugMode = options.debugMode !== undefined ? options.debugMode : this.config.debugMode;

    this.log('Manage membership 버튼 클릭 시작 (Frame-Safe)');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`시도 ${attempt}/${maxRetries}`);

        // Frame 상태 확인
        const frameState = await this.frameRecovery.checkFrameState(page);
        if (frameState.status === 'detached') {
          this.log('Frame detached 감지, 복구 중...', 'warning');
          await this.frameRecovery.recoverFrame(page);
        }

        // Manage 버튼 텍스트 가져오기
        const manageTexts = this.getManageButtonTexts(language);

        // Frame-safe 클릭 실행
        const result = await this.performFrameSafeClick(page, manageTexts, {
          description: 'Manage membership',
          waitForNavigation: true,
          attempt
        });

        if (result.clicked) {
          this.log(`Manage membership 버튼 클릭 성공: "${result.text}"`, 'success');

          // 클릭 후 안정화 대기
          await this.waitForPostClickStability(page);

          // 페이지 전환 또는 다이얼로그 확인
          const postClickState = await this.checkPostClickState(page);

          if (postClickState.hasDialog) {
            this.log('다이얼로그/팝업 감지됨', 'info');
          }

          if (postClickState.navigated) {
            this.log('페이지 전환 감지됨', 'info');
          }

          return {
            ...result,
            ...postClickState,
            attempt
          };
        }

      } catch (error) {
        this.log(`시도 ${attempt} 실패: ${error.message}`, 'error');

        // Frame detached 오류인 경우 복구 후 재시도
        if (this.frameRecovery.isFrameDetachedError(error.message)) {
          this.log('Frame detached 오류 감지, 자동 복구 시도...', 'warning');
          await this.frameRecovery.recoverFrame(page);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // 마지막 시도가 아니면 재시도
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        throw error;
      }
    }

    this.log('모든 시도 실패', 'error');
    return { clicked: false, error: 'Max retries exceeded' };
  }

  /**
   * Frame-safe 클릭 실행
   */
  async performFrameSafeClick(page, searchTexts, options = {}) {
    const { description = 'button', waitForNavigation = false, attempt = 1 } = options;

    try {
      // 휴먼라이크 모드가 활성화된 경우
      if (this.mouseHelper && this.cdpHelper) {
        return await this.performHumanLikeClick(page, searchTexts, options);
      }

      // 기존 JS 클릭 (폴백)
      return await this.performJsClick(page, searchTexts, options);

    } catch (error) {
      this.log(`Frame-safe 클릭 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 휴먼라이크 클릭 실행 (베지어 곡선 + CDP 네이티브 클릭)
   */
  async performHumanLikeClick(page, searchTexts, options = {}) {
    const { description = 'button', waitForNavigation = false } = options;

    this.log(`🎯 휴먼라이크 클릭 시도: ${description}`, 'info');

    // 1. 버튼 좌표 찾기 (클릭하지 않음)
    const buttonInfo = await this.findButtonCoordinates(page, searchTexts);

    if (!buttonInfo.found) {
      this.log(`버튼 찾지 못함: ${description}`, 'warning');
      return { clicked: false };
    }

    // 스크롤 후 안정화 대기
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));

    // 좌표 다시 확인 (스크롤로 인해 변경될 수 있음)
    const updatedInfo = await this.findButtonCoordinates(page, searchTexts);
    const finalX = updatedInfo.found ? updatedInfo.x : buttonInfo.x;
    const finalY = updatedInfo.found ? updatedInfo.y : buttonInfo.y;

    // 2. 베지어 곡선으로 마우스 이동
    this.log(`🖱️ 베지어 곡선 마우스 이동: (${Math.round(finalX)}, ${Math.round(finalY)})`, 'info');
    await this.mouseHelper.moveMouseHumanLike(finalX, finalY);

    // 3. 클릭 전 짧은 대기 (인간적 반응)
    await new Promise(r => setTimeout(r, 100 + Math.random() * 150));

    // 4. CDP 네이티브 클릭
    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ timeout: this.config.navigationTimeout, waitUntil: 'domcontentloaded' }).catch(() => {}),
        this.cdpHelper.clickAtCoordinates(finalX, finalY)
      ]);
    } else {
      await this.cdpHelper.clickAtCoordinates(finalX, finalY);
    }

    this.log(`✅ 휴먼라이크 클릭 성공: "${buttonInfo.text}"`, 'success');

    return {
      clicked: true,
      text: buttonInfo.text,
      element: buttonInfo.element,
      humanLike: true
    };
  }

  /**
   * 기존 JS 클릭 (폴백)
   */
  async performJsClick(page, searchTexts, options = {}) {
    const { description = 'button', waitForNavigation = false, attempt = 1 } = options;

    try {
      // Frame Recovery Service를 통한 안전한 클릭
      if (waitForNavigation) {
        // 네비게이션이 예상되는 경우
        return await this.frameRecovery.clickAndWaitForNavigation(
          page,
          async () => {
            const clickResult = await this.frameRecovery.safeEvaluate(page, (texts) => {
              const selectors = [
                'button',
                '[role="button"]',
                'a[role="button"]',
                'yt-button-renderer',
                'ytd-button-renderer button',  // YouTube Desktop 버튼 렌더러
                'yt-button-shape button',       // 최신 YouTube 버튼 구조
                'tp-yt-paper-button',
                'paper-button',
                // 드롭다운/확장 가능한 버튼 구조
                'ytd-toggle-button-renderer',
                'ytd-menu-renderer button',
                'yt-icon-button',
                '[aria-expanded]',
                'div[tabindex="0"]',
                'span[tabindex="0"]',
                '#expand',
                '.expand-button',
                'ytd-expander'
              ];

              const buttons = document.querySelectorAll(selectors.join(', '));

              for (const button of buttons) {
                const btnText = button.textContent?.trim();

                if (btnText && texts.some(text =>
                  btnText === text ||
                  btnText.includes(text) ||
                  btnText.toLowerCase().includes(text.toLowerCase())
                )) {
                  if (button.offsetHeight > 0 && button.offsetWidth > 0) {
                    // 요소로 스크롤
                    button.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // 잠시 대기 (스크롤 완료 대기)
                    return new Promise((resolve) => {
                      setTimeout(() => {
                        button.click();
                        resolve({
                          clicked: true,
                          text: btnText,
                          element: button.tagName.toLowerCase()
                        });
                      }, 500);
                    });
                  }
                }
              }

              return { clicked: false };
            }, searchTexts);

            return clickResult;
          },
          { timeout: this.config.navigationTimeout }
        );
      } else {
        // 일반 클릭 (네비게이션 없음)
        const clickResult = await this.frameRecovery.safeEvaluate(page, (texts) => {
          const selectors = [
            'button',
            '[role="button"]',
            'a[role="button"]',
            'yt-button-renderer',
            'ytd-button-renderer button',  // YouTube Desktop 버튼 렌더러
            'yt-button-shape button',       // 최신 YouTube 버튼 구조
            'tp-yt-paper-button',
            'paper-button',
            // 드롭다운/확장 가능한 버튼 구조
            'ytd-toggle-button-renderer',
            'ytd-menu-renderer button',
            'yt-icon-button',
            '[aria-expanded]',
            'div[tabindex="0"]',
            'span[tabindex="0"]',
            '#expand',
            '.expand-button',
            'ytd-expander'
          ];

          const buttons = document.querySelectorAll(selectors.join(', '));

          for (const button of buttons) {
            const btnText = button.textContent?.trim();

            if (btnText && texts.some(text =>
              btnText === text ||
              btnText.includes(text) ||
              btnText.toLowerCase().includes(text.toLowerCase())
            )) {
              if (button.offsetHeight > 0 && button.offsetWidth > 0) {
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                button.click();
                return {
                  clicked: true,
                  text: btnText,
                  element: button.tagName.toLowerCase()
                };
              }
            }
          }

          return { clicked: false };
        }, searchTexts);

        return clickResult;
      }

    } catch (error) {
      this.log(`Frame-safe 클릭 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 클릭 후 안정화 대기
   */
  async waitForPostClickStability(page, timeout = 3000) {
    this.log('클릭 후 안정화 대기 중...', 'info');

    const startTime = Date.now();

    // 기본 대기
    await new Promise(r => setTimeout(r, 1000));

    // DOM 변경 감지
    try {
      await page.waitForFunction(
        () => {
          return document.readyState === 'complete' ||
                 document.readyState === 'interactive';
        },
        { timeout: timeout - 1000 }
      );
    } catch (err) {
      // 타임아웃 무시
    }

    // 추가 안정화 시간
    await new Promise(r => setTimeout(r, 500));

    const elapsed = Date.now() - startTime;
    this.log(`안정화 완료 (${elapsed}ms)`, 'info');
  }

  /**
   * 클릭 후 상태 확인
   */
  async checkPostClickState(page) {
    try {
      // 다이얼로그/팝업 확인
      const hasDialog = await this.frameRecovery.safeEvaluate(page, () => {
        const dialogs = document.querySelectorAll(
          '[role="dialog"], [aria-modal="true"], .yt-dialog, tp-yt-paper-dialog'
        );
        return dialogs.length > 0;
      }).catch(() => false);

      // URL 변경 확인
      const currentUrl = page.url();
      const navigated = !currentUrl.includes('paid_memberships');

      // 일시중지/재개 버튼 확인
      const hasPauseResume = await this.checkForPauseResumeButtons(page);

      return {
        hasDialog,
        navigated,
        hasPauseResume,
        currentUrl
      };

    } catch (error) {
      this.log(`클릭 후 상태 확인 실패: ${error.message}`, 'error');
      return {
        hasDialog: false,
        navigated: false,
        hasPauseResume: false
      };
    }
  }

  /**
   * 일시중지 버튼 클릭 (Frame-safe)
   */
  async clickPauseButton(page, language = 'en') {
    const pauseTexts = this.getPauseButtonTexts(language);

    this.log('일시중지 버튼 클릭 시도 (Frame-safe)', 'info');

    // Frame-safe 클릭 실행
    const result = await this.performFrameSafeClick(page, pauseTexts, {
      description: 'Pause',
      waitForNavigation: false
    });

    if (result.clicked) {
      this.log(`일시중지 버튼 클릭 성공: "${result.text}"`, 'success');
      await this.waitForPostClickStability(page);
    }

    return result;
  }

  /**
   * 재개 버튼 클릭 (Frame-safe)
   */
  async clickResumeButton(page, language = 'en') {
    const resumeTexts = this.getResumeButtonTexts(language);

    this.log('재개 버튼 클릭 시도 (Frame-safe)', 'info');

    // Frame-safe 클릭 실행
    const result = await this.performFrameSafeClick(page, resumeTexts, {
      description: 'Resume',
      waitForNavigation: false
    });

    if (result.clicked) {
      this.log(`재개 버튼 클릭 성공: "${result.text}"`, 'success');
      await this.waitForPostClickStability(page);
    }

    return result;
  }

  /**
   * 구독 만료 확인 (Frame-safe)
   * - Inactive Memberships 섹션 확인
   * - "Benefits end:" + "Renew" 패턴 확인 (만료 예정/만료 상태)
   * - 다국어 만료 지표 확인
   */
  async checkSubscriptionExpired(page, checkManageButton = true) {
    try {
      const result = await this.frameRecovery.safeEvaluate(page, (checkManage) => {
        const bodyText = document.body?.textContent || '';

        // ========== 1. Inactive Memberships 확인 ==========
        const inactiveTexts = ['Inactive Memberships', '비활성 멤버십', 'Неактивные подписки'];
        const hasInactive = inactiveTexts.some(text => bodyText.includes(text));

        // ========== 2. "Benefits end" + "Renew" 패턴 확인 ==========
        // 스크린샷: "Benefits end: Dec 8" + "Renew" 버튼 = 만료 예정/만료 상태
        const benefitsEndPatterns = [
          // 영어
          'Benefits end:',
          'Benefits end',
          'Benefits ended',
          'To avoid losing benefits',
          'To keep your benefits',
          'renew your membership',
          // 한국어
          '혜택 종료:',
          '혜택 종료',
          '혜택이 종료됩니다',
          '혜택을 계속 누리려면',
          '멤버십을 갱신하세요',
          // 스페인어
          'Los beneficios finalizan',
          'Renueva tu suscripción',
          // 포르투갈어
          'Os benefícios terminam',
          'Renove sua assinatura',
          // 프랑스어
          'Avantages se terminent',
          'Renouveler votre abonnement',
          // 독일어
          'Vorteile enden',
          'Mitgliedschaft verlängern',
          // 일본어
          '特典終了',
          'メンバーシップを更新',
          // 중국어
          '福利结束',
          '续订会员资格',
          // 러시아어
          'Преимущества заканчиваются',
          'Продлить подписку'
        ];

        let hasBenefitsEnd = false;
        let detectedBenefitsEndText = null;
        for (const pattern of benefitsEndPatterns) {
          if (bodyText.includes(pattern)) {
            hasBenefitsEnd = true;
            detectedBenefitsEndText = pattern;
            break;
          }
        }

        // ========== 3. Renew 버튼 확인 ==========
        const renewTexts = [
          'Renew', '갱신', '更新', '更新する', 'Renovar', 'Renouveler',
          'Verlängern', 'Продлить', 'Rinnova', 'Vernieuwen'
        ];
        let hasRenewButton = false;
        const buttons = document.querySelectorAll('button, [role="button"], a');
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          if (btnText && renewTexts.some(text =>
            btnText === text || btnText.includes(text)
          )) {
            if (button.offsetHeight > 0) {
              hasRenewButton = true;
              break;
            }
          }
        }

        // ========== 4. 추가 만료 지표 확인 ==========
        // 주의: "No purchases" / "구입한 항목이 없습니다"는 디지털 콘텐츠 구매 섹션의 메시지로
        // Premium 구독 상태와 무관하므로 만료 지표에서 제외
        const additionalExpiredTexts = [
          'Your membership has expired',
          '멤버십이 만료되었습니다',
          '구독이 만료되었습니다',
          'Expired',
          '만료됨',
          '만료된 멤버십'
        ];
        let hasAdditionalExpiredText = false;
        let detectedAdditionalText = null;
        for (const text of additionalExpiredTexts) {
          if (bodyText.includes(text)) {
            hasAdditionalExpiredText = true;
            detectedAdditionalText = text;
            break;
          }
        }

        // ========== 5. Manage 버튼 확인 (옵션) ==========
        let hasManageButton = false;
        if (checkManage) {
          const manageTexts = ['Manage membership', '멤버십 관리', 'Управление подпиской'];
          for (const button of buttons) {
            const btnText = button.textContent?.trim();
            if (btnText && manageTexts.some(text => btnText.includes(text))) {
              hasManageButton = true;
              break;
            }
          }
        }

        // ========== 6. Pause/Resume 버튼 확인 (활성 상태 지표) ==========
        const pauseTexts = ['Pause', '일시중지', 'Pausar', 'Mettre en pause', 'Pausieren'];
        const resumeTexts = ['Resume', '재개', 'Reanudar', 'Reprendre', 'Fortsetzen'];
        let hasPauseButton = false;
        let hasResumeButton = false;
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          if (btnText) {
            if (pauseTexts.some(text => btnText.includes(text))) {
              hasPauseButton = true;
            }
            if (resumeTexts.some(text => btnText.includes(text))) {
              hasResumeButton = true;
            }
          }
        }

        // ========== 최종 만료 판정 ==========
        // 만료 조건:
        // 1. Inactive Memberships 섹션 있음
        // 2. Benefits end + Renew 버튼 있고 Pause/Resume 버튼 없음
        // 3. 추가 만료 텍스트 있음
        const isExpiredByBenefitsEnd = hasBenefitsEnd && hasRenewButton && !hasPauseButton && !hasResumeButton;
        const isExpired = hasInactive || isExpiredByBenefitsEnd || hasAdditionalExpiredText;

        // 판정 근거 생성
        let indicator = null;
        if (hasInactive) {
          indicator = 'Inactive Memberships section found';
        } else if (isExpiredByBenefitsEnd) {
          indicator = `Benefits end detected: "${detectedBenefitsEndText}" + Renew button`;
        } else if (hasAdditionalExpiredText) {
          indicator = `Expired text found: "${detectedAdditionalText}"`;
        }

        return {
          // 기존 호환성 유지
          hasInactiveSection: hasInactive,
          hasManageButton: hasManageButton,
          indicator: indicator,
          // 확장된 만료 감지 결과
          isExpired: isExpired,
          expired: isExpired, // 별칭 (호환성)
          hasBenefitsEnd: hasBenefitsEnd,
          hasRenewButton: hasRenewButton,
          hasPauseButton: hasPauseButton,
          hasResumeButton: hasResumeButton,
          hasAdditionalExpiredText: hasAdditionalExpiredText,
          detectedPattern: detectedBenefitsEndText || detectedAdditionalText,
          // 디버그 정보
          debug: {
            bodyTextLength: bodyText.length,
            hasBenefitsEnd,
            hasRenewButton,
            hasPauseButton,
            hasResumeButton
          }
        };
      }, checkManageButton);

      // 로깅
      if (result.isExpired) {
        this.log(`⚠️ 만료 상태 감지: ${result.indicator}`, 'warning');
      }

      return result;

    } catch (error) {
      this.log(`구독 상태 확인 실패: ${error.message}`, 'error');
      return {
        hasInactiveSection: false,
        hasManageButton: false,
        isExpired: false,
        expired: false,
        error: error.message
      };
    }
  }

  /**
   * 일시중지/재개 버튼 존재 확인
   */
  async checkForPauseResumeButtons(page, language = 'en') {
    const pauseTexts = this.getPauseButtonTexts(language);
    const resumeTexts = this.getResumeButtonTexts(language);
    const allTexts = [...pauseTexts, ...resumeTexts];

    try {
      const hasButton = await this.frameRecovery.safeEvaluate(page, (texts) => {
        const buttons = document.querySelectorAll('button, [role="button"]');

        for (const button of buttons) {
          const btnText = button.textContent?.trim();

          if (btnText && texts.some(text =>
            btnText === text || btnText.includes(text)
          )) {
            if (button.offsetHeight > 0) {
              return true;
            }
          }
        }

        return false;
      }, allTexts);

      return hasButton;

    } catch (error) {
      this.log(`버튼 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  // 언어별 텍스트 정의 메서드들
  getManageButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');

    if (languages[language]?.buttons?.manageMemership) {
      return languages[language].buttons.manageMemership;
    }

    const texts = {
      ko: ['멤버십 관리', '구독 관리', '관리'],
      en: ['Manage membership', 'Manage Membership', 'Manage subscription', 'Manage'],
      ru: ['Управление подпиской', 'Управлять', 'Продлить или изменить'],
      ja: ['メンバーシップを管理', 'メンバーシップの管理', '管理'],
      es: ['Administrar membresía', 'Gestionar membresía', 'Administrar'],
      pt: ['Gerenciar assinatura', 'Gerenciar associação', 'Gerenciar'],
      fr: ['Gérer l\'abonnement', 'Gérer l\'adhésion', 'Gérer'],
      de: ['Mitgliedschaft verwalten', 'Abonnement verwalten', 'Verwalten']
    };

    return texts[language] || texts.en;
  }

  getPauseButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');

    if (languages[language]?.buttons) {
      const pauseTexts = [];
      if (languages[language].buttons.pause) {
        pauseTexts.push(...languages[language].buttons.pause);
      }
      if (languages[language].buttons.pauseMembership) {
        pauseTexts.push(...languages[language].buttons.pauseMembership);
      }
      if (pauseTexts.length > 0) {
        return pauseTexts;
      }
    }

    const texts = {
      ko: ['일시중지', '멤버십 일시중지', '일시 중지'],
      en: ['Pause', 'Pause membership', 'Pause subscription'],
      ru: ['Приостановить', 'Приостановить подписку', 'Пауза'],
      ja: ['一時停止', 'メンバーシップを一時停止', '一時停止する'],
      es: ['Pausar', 'Pausar membresía', 'Pausar suscripción'],
      pt: ['Pausar', 'Pausar assinatura', 'Pausar associação'],
      fr: ['Mettre en pause', 'Suspendre l\'abonnement', 'Pause'],
      de: ['Pausieren', 'Mitgliedschaft pausieren', 'Abonnement pausieren']
    };

    return texts[language] || texts.en;
  }

  getResumeButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');

    if (languages[language]?.buttons) {
      const resumeTexts = [];
      if (languages[language].buttons.resume) {
        resumeTexts.push(...languages[language].buttons.resume);
      }
      if (languages[language].buttons.resumeMembership) {
        resumeTexts.push(...languages[language].buttons.resumeMembership);
      }
      if (resumeTexts.length > 0) {
        return resumeTexts;
      }
    }

    const texts = {
      ko: ['재개', '멤버십 재개', '다시 시작'],
      en: ['Resume', 'Resume membership', 'Resume subscription', 'Restart'],
      ru: ['Возобновить', 'Возобновить подписку', 'Продолжить'],
      ja: ['再開', 'メンバーシップを再開', '再開する'],
      es: ['Reanudar', 'Reanudar membresía', 'Reanudar suscripción'],
      pt: ['Retomar', 'Retomar assinatura', 'Retomar associação'],
      fr: ['Reprendre', 'Reprendre l\'abonnement', 'Redémarrer'],
      de: ['Fortsetzen', 'Mitgliedschaft fortsetzen', 'Abonnement fortsetzen']
    };

    return texts[language] || texts.en;
  }

  getConfirmButtonTexts(language, action) {
    const texts = {
      ko: {
        pause: ['일시중지', '확인', '예'],
        resume: ['재개', '확인', '예'],
        general: ['확인', '예', 'OK']
      },
      en: {
        pause: ['Pause', 'Confirm', 'OK', 'Yes'],
        resume: ['Resume', 'Confirm', 'OK', 'Yes'],
        general: ['Confirm', 'OK', 'Yes']
      },
      ru: {
        pause: ['Приостановить', 'Подтвердить', 'ОК', 'Да'],
        resume: ['Возобновить', 'Подтвердить', 'ОК', 'Да'],
        general: ['Подтвердить', 'ОК', 'Да']
      }
    };

    const langTexts = texts[language] || texts.en;
    return langTexts[action] || langTexts.general;
  }
}

module.exports = EnhancedButtonInteractionService;