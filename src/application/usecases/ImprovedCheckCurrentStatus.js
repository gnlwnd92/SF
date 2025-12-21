/**
 * 개선된 구독 상태 확인 로직
 * 페이지 로딩 완료 확인 및 다중 검증 포함
 */

const chalk = require('chalk');

class ImprovedCheckCurrentStatus {
  constructor(logger) {
    this.logger = logger || console;
  }

  /**
   * 페이지 로딩 완료 대기
   */
  async waitForPageLoad(page, options = {}) {
    const {
      timeout = 30000,
      checkInterval = 500,
      requiredElements = []
    } = options;

    const startTime = Date.now();

    this.log('⏳ 페이지 로딩 대기 중...', 'info');

    while (Date.now() - startTime < timeout) {
      try {
        // 1. 네트워크 활동 확인 (Puppeteer 방식)
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 3000))
        ]);

        // 2. 필수 요소들이 로드되었는지 확인
        const elementsLoaded = await page.evaluate((selectors) => {
          // 기본 체크: body에 충분한 콘텐츠가 있는지
          const bodyText = document.body?.innerText || '';
          if (bodyText.length < 100) {
            return false; // 콘텐츠가 너무 적으면 아직 로딩 중
          }

          // 버튼 존재 여부 확인 (Pause, Resume, Manage 중 하나는 있어야 함)
          const hasActionButton =
            bodyText.includes('Pause') || bodyText.includes('일시중지') ||
            bodyText.includes('Resume') || bodyText.includes('재개') ||
            bodyText.includes('Manage') || bodyText.includes('관리');

          if (!hasActionButton) {
            return false; // 액션 버튼이 하나도 없으면 아직 로딩 중
          }

          // 추가 선택자 체크
          if (selectors && selectors.length > 0) {
            for (const selector of selectors) {
              if (!document.querySelector(selector)) {
                return false;
              }
            }
          }

          return true;
        }, requiredElements);

        if (elementsLoaded) {
          this.log('✅ 페이지 로딩 완료', 'success');
          return true;
        }

      } catch (error) {
        // 타임아웃이나 에러 무시하고 계속 시도
      }

      await new Promise(r => setTimeout(r, checkInterval));
    }

    this.log('⚠️ 페이지 로딩 타임아웃', 'warning');
    return false;
  }

  /**
   * 개선된 현재 구독 상태 확인
   * 페이지 로딩 완료 후 다중 검증 수행
   */
  async checkCurrentStatus(page, options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 2000,
      requireStableState = true
    } = options;

    try {
      // 1. 페이지 로딩 완료 대기
      const pageLoaded = await this.waitForPageLoad(page, {
        timeout: 30000,
        requiredElements: ['button', 'a[role="button"]']
      });

      if (!pageLoaded) {
        this.log('❌ 페이지 로딩 실패', 'error');
        return {
          isActive: null,
          hasResumeButton: false,
          hasPauseButton: false,
          isLoading: true,
          error: '페이지 로딩 미완료'
        };
      }

      // 2. 안정적인 상태 확인을 위해 여러 번 체크
      let attempts = 0;
      let lastStatus = null;
      let stableCount = 0;

      while (attempts < maxRetries) {
        attempts++;
        this.log(`🔍 상태 확인 시도 ${attempts}/${maxRetries}`, 'debug');

        const status = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';

          // 버튼 요소 직접 확인 (텍스트뿐만 아니라 실제 요소 체크)
          const buttons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));

          let hasPauseButton = false;
          let hasResumeButton = false;
          let hasManageButton = false;

          buttons.forEach(btn => {
            const text = btn.textContent?.trim().toLowerCase() || '';
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

            // Pause 버튼 확인
            if (text.includes('pause') || text.includes('일시중지') ||
                ariaLabel.includes('pause') || ariaLabel.includes('일시중지')) {
              hasPauseButton = true;
            }

            // Resume 버튼 확인
            if (text.includes('resume') || text.includes('재개') ||
                ariaLabel.includes('resume') || ariaLabel.includes('재개')) {
              hasResumeButton = true;
            }

            // Manage 버튼 확인
            if (text.includes('manage') || text.includes('관리') ||
                ariaLabel.includes('manage') || ariaLabel.includes('관리')) {
              hasManageButton = true;
            }
          });

          // 추가 상태 지표 확인
          const hasNextBilling = bodyText.includes('Next billing') ||
                                 bodyText.includes('다음 결제일') ||
                                 bodyText.includes('Próxima cobrança') ||
                                 bodyText.includes('下次付款');

          const isPausedText = bodyText.includes('Paused until') ||
                               bodyText.includes('일시중지됨') ||
                               bodyText.includes('Pausado até') ||
                               bodyText.includes('暫停至');

          // 날짜 정보 추출
          let nextBillingDate = null;
          const dateMatches = bodyText.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})|(\d{1,2}[-./]\d{1,2}[-./]\d{4})/g);
          if (dateMatches && dateMatches.length > 0) {
            nextBillingDate = dateMatches[0];
          }

          // 상태 판단 로직 개선
          let isActive = null;

          // 명확한 지표가 있는 경우만 판단
          if (hasPauseButton && !hasResumeButton) {
            // Pause 버튼만 있고 Resume 버튼이 없으면 활성 상태
            isActive = true;
          } else if (hasResumeButton && !hasPauseButton) {
            // Resume 버튼만 있고 Pause 버튼이 없으면 일시중지 상태
            isActive = false;
          } else if (hasManageButton && hasNextBilling && !isPausedText) {
            // Manage 버튼과 다음 결제일이 있고 일시중지 텍스트가 없으면 활성
            isActive = true;
          } else if (isPausedText && hasResumeButton) {
            // 일시중지 텍스트와 Resume 버튼이 있으면 비활성
            isActive = false;
          }
          // 둘 다 없거나 불명확한 경우 null 반환 (로딩 중일 가능성)

          return {
            isActive,
            hasResumeButton,
            hasPauseButton,
            hasManageButton,
            hasNextBilling,
            isPausedText,
            nextBillingDate,
            bodyTextLength: bodyText.length,
            buttonCount: buttons.length,
            bodyTextSnippet: bodyText.substring(0, 200)
          };
        });

        // 상태가 안정적인지 확인
        if (requireStableState && lastStatus) {
          if (JSON.stringify(lastStatus) === JSON.stringify(status)) {
            stableCount++;
            if (stableCount >= 2) {
              // 2번 연속 같은 상태면 안정적
              this.log('✅ 안정적인 상태 확인됨', 'success');
              this.logStatusDetails(status);
              return status;
            }
          } else {
            stableCount = 0;
          }
        }

        lastStatus = status;

        // 명확한 상태가 확인되면 즉시 반환
        if (status.isActive !== null) {
          this.log('✅ 구독 상태 확인 완료', 'success');
          this.logStatusDetails(status);
          return status;
        }

        // 다음 시도 전 대기
        if (attempts < maxRetries) {
          this.log(`⏳ ${retryDelay}ms 후 재시도...`, 'info');
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }

      // 모든 시도 후에도 불명확한 경우
      this.log('⚠️ 구독 상태를 명확히 확인할 수 없음', 'warning');
      this.logStatusDetails(lastStatus);

      return {
        ...lastStatus,
        isUncertain: true,
        error: '상태 확인 불가 - 페이지가 아직 로딩 중이거나 예상치 못한 상태'
      };

    } catch (error) {
      this.log(`❌ 상태 확인 실패: ${error.message}`, 'error');
      return {
        isActive: null,
        hasResumeButton: false,
        hasPauseButton: false,
        error: error.message
      };
    }
  }

  /**
   * 상태 세부 정보 로깅
   */
  logStatusDetails(status) {
    this.log('📊 구독 상태 상세:', 'info');

    if (status.isActive === true) {
      this.log('  ✅ 활성 상태', 'success');
    } else if (status.isActive === false) {
      this.log('  ⏸️ 일시중지 상태', 'warning');
    } else {
      this.log('  ❓ 상태 불명확', 'warning');
    }

    this.log(`  Pause 버튼: ${status.hasPauseButton ? '✅' : '❌'}`, 'debug');
    this.log(`  Resume 버튼: ${status.hasResumeButton ? '✅' : '❌'}`, 'debug');
    this.log(`  Manage 버튼: ${status.hasManageButton ? '✅' : '❌'}`, 'debug');
    this.log(`  다음 결제일: ${status.hasNextBilling ? '✅' : '❌'}`, 'debug');
    this.log(`  일시중지 텍스트: ${status.isPausedText ? '✅' : '❌'}`, 'debug');
    this.log(`  날짜: ${status.nextBillingDate || '없음'}`, 'debug');
    this.log(`  버튼 수: ${status.buttonCount || 0}개`, 'debug');
    this.log(`  텍스트 길이: ${status.bodyTextLength || 0}자`, 'debug');
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };

    const color = colors[level] || 'white';

    if (this.logger && this.logger.log) {
      this.logger.log(message, level);
    } else {
      console.log(chalk[color](message));
    }
  }
}

module.exports = ImprovedCheckCurrentStatus;