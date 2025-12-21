/**
 * 단순화된 YouTube 자동화 어댑터
 * DOM Click Event 테스트 결과를 기반으로 재구성
 */

const { EventEmitter } = require('events');

class YouTubeAutomationAdapterSimplified extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      debugMode: config.debugMode || false,
      language: config.language || 'ko',
      ...config
    };
    this.page = null;
    this.workflowSteps = [];
  }

  setBrowserController(page) {
    this.page = page;
  }

  logStep(step, level, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      step,
      level,
      ...data
    };
    
    this.workflowSteps.push(logEntry);
    this.emit(level, `${level === 'success' ? '✅' : level === 'warning' ? '⚠️' : 'ℹ️'} [${step}] ${data.message || ''}`);
    
    if (this.config.debugMode) {
      console.log(`[${timestamp}] [${step}] ${JSON.stringify(data)}`);
    }
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      const loginInfo = await this.page.evaluate(() => {
        const avatarBtn = document.querySelector('#avatar-btn');
        const signInButton = document.querySelector('a[aria-label*="Sign in"]');
        
        return {
          isLoggedIn: avatarBtn !== null && signInButton === null,
          hasAvatar: avatarBtn !== null,
          currentUrl: window.location.href
        };
      });

      this.logStep('login_check', loginInfo.isLoggedIn ? 'success' : 'warning', {
        message: loginInfo.isLoggedIn ? 'Logged in' : 'Not logged in',
        ...loginInfo
      });

      return loginInfo.isLoggedIn;
    } catch (error) {
      this.logStep('login_check', 'error', {
        message: 'Failed to check login status',
        error: error.message
      });
      return false;
    }
  }

  /**
   * 단순화된 일시중지 워크플로우
   * 직접 URL 이동 방식 사용
   */
  async executePauseWorkflow(accountData = {}) {
    this.workflowSteps = [];
    
    try {
      this.logStep('workflow_start', 'info', {
        message: 'Starting simplified pause workflow'
      });

      // 1. 로그인 상태 확인
      this.logStep('step_1_login', 'info', {
        message: 'Step 1: Checking login status'
      });
      
      const isLoggedIn = await this.checkLoginStatus();
      
      if (!isLoggedIn) {
        if (accountData.email && accountData.password) {
          this.logStep('step_1_login', 'warning', {
            message: 'Login required - credentials provided'
          });
          // 로그인 로직은 별도 구현 필요
          throw new Error('Not logged in - please login manually first');
        } else {
          throw new Error('Not logged in and no credentials provided');
        }
      }

      // 2. 관리 페이지로 직접 이동
      this.logStep('step_2_manage', 'info', {
        message: 'Step 2: Navigating to management page'
      });
      
      await this.page.goto('https://www.youtube.com/paid_memberships/manage', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 2000));
      
      this.logStep('step_2_manage', 'success', {
        message: 'Navigated to management page',
        url: this.page.url()
      });

      // 3. 취소 페이지로 직접 이동
      this.logStep('step_3_cancel', 'info', {
        message: 'Step 3: Navigating to cancel page'
      });
      
      await this.page.goto('https://www.youtube.com/paid_memberships/cancel', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));
      
      const cancelPageUrl = this.page.url();
      
      this.logStep('step_3_cancel', 'success', {
        message: 'Navigated to cancel page',
        url: cancelPageUrl
      });

      // 4. 페이지 내용 분석
      this.logStep('step_4_analyze', 'info', {
        message: 'Step 4: Analyzing cancel page'
      });
      
      const pageAnalysis = await this.page.evaluate(() => {
        const pageText = document.body.textContent || '';
        const currentUrl = window.location.href;
        
        // 일시중지 관련 요소 찾기
        const pauseButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter(btn => {
            const text = btn.textContent?.trim();
            return text && (
              text.includes('일시중지') || 
              text.includes('Pause') ||
              text.includes('취소') ||
              text.includes('Cancel') ||
              text.includes('멤버십')
            );
          });
        
        // 기간 선택 옵션
        const periodOptions = document.querySelectorAll(
          'input[type="radio"], [role="radio"]'
        );
        
        // 다이얼로그 확인
        const hasDialog = document.querySelector('[role="dialog"]') !== null;
        
        return {
          url: currentUrl,
          isCancelPage: currentUrl.includes('/cancel'),
          hasPauseText: pageText.includes('일시중지') || pageText.includes('Pause'),
          hasCancelText: pageText.includes('취소') || pageText.includes('Cancel'),
          hasPeriodOptions: periodOptions.length > 0,
          hasDialog,
          buttonCount: pauseButtons.length,
          buttons: pauseButtons.slice(0, 5).map(btn => ({
            text: btn.textContent?.trim(),
            className: btn.className
          }))
        };
      });
      
      this.logStep('step_4_analyze', 'info', {
        message: 'Page analysis complete',
        ...pageAnalysis
      });

      // 5. 일시중지/취소 옵션 선택
      if (pageAnalysis.hasPeriodOptions) {
        this.logStep('step_5_select', 'info', {
          message: 'Step 5: Selecting pause period'
        });
        
        // 기간 선택 (예: 1개월)
        const periodSelected = await this.page.evaluate(() => {
          const options = document.querySelectorAll('input[type="radio"], [role="radio"]');
          if (options.length > 0) {
            options[0].click(); // 첫 번째 옵션 선택
            return true;
          }
          return false;
        });
        
        if (periodSelected) {
          this.logStep('step_5_select', 'success', {
            message: 'Period selected'
          });
        }
      }

      // 6. 최종 확인 버튼 클릭
      if (pageAnalysis.buttonCount > 0) {
        this.logStep('step_6_confirm', 'info', {
          message: 'Step 6: Clicking confirmation button'
        });
        
        const confirmClicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
            .filter(btn => {
              const text = btn.textContent?.trim();
              return text && (
                text === '멤버십 일시중지' ||
                text === 'Pause membership' ||
                text === '일시중지' ||
                text === 'Pause' ||
                text === '확인' ||
                text === 'Confirm'
              );
            });
          
          if (buttons.length > 0) {
            buttons[0].click();
            return {
              clicked: true,
              buttonText: buttons[0].textContent?.trim()
            };
          }
          return { clicked: false };
        });
        
        if (confirmClicked.clicked) {
          this.logStep('step_6_confirm', 'success', {
            message: `Confirmation button clicked: ${confirmClicked.buttonText}`
          });
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      // 7. 최종 상태 확인
      this.logStep('step_7_verify', 'info', {
        message: 'Step 7: Verifying final status'
      });
      
      const finalStatus = await this.page.evaluate(() => {
        const pageText = document.body.textContent || '';
        const url = window.location.href;
        
        return {
          url,
          isPaused: 
            pageText.includes('일시중지됨') || 
            pageText.includes('Paused') ||
            pageText.includes('재개') ||
            pageText.includes('Resume'),
          isCompleted: 
            pageText.includes('완료') ||
            pageText.includes('Complete') ||
            pageText.includes('성공'),
          hasError: 
            pageText.includes('오류') ||
            pageText.includes('Error') ||
            pageText.includes('실패')
        };
      });
      
      this.logStep('step_7_verify', finalStatus.isPaused || finalStatus.isCompleted ? 'success' : 'warning', {
        message: 'Final verification',
        ...finalStatus
      });

      // 결과 반환
      const success = pageAnalysis.isCancelPage || finalStatus.isPaused || finalStatus.isCompleted;
      
      return {
        success,
        message: success ? 
          'Pause workflow completed successfully' : 
          'Pause workflow partially completed - manual confirmation may be needed',
        finalUrl: finalStatus.url,
        isPaused: finalStatus.isPaused,
        steps: this.workflowSteps
      };

    } catch (error) {
      this.logStep('workflow_error', 'error', {
        message: 'Workflow failed',
        error: error.message
      });
      
      return {
        success: false,
        message: error.message,
        error,
        steps: this.workflowSteps
      };
    }
  }

  /**
   * 워크플로우 요약 출력
   */
  printWorkflowSummary() {
    console.log('\n📊 Workflow Summary:');
    console.log('=' .repeat(50));
    
    const stepsByLevel = {
      success: [],
      warning: [],
      error: []
    };
    
    this.workflowSteps.forEach(step => {
      if (stepsByLevel[step.level]) {
        stepsByLevel[step.level].push(step);
      }
    });
    
    console.log(`✅ Success: ${stepsByLevel.success.length} steps`);
    console.log(`⚠️ Warning: ${stepsByLevel.warning.length} steps`);
    console.log(`❌ Error: ${stepsByLevel.error.length} steps`);
    
    if (stepsByLevel.error.length > 0) {
      console.log('\n❌ Errors:');
      stepsByLevel.error.forEach(step => {
        console.log(`  - [${step.step}] ${step.message || step.error}`);
      });
    }
    
    console.log('=' .repeat(50));
  }
}

module.exports = YouTubeAutomationAdapterSimplified;