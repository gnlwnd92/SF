/**
 * Navigation Strategy
 * 현재 페이지에서 목표 페이지까지의 최적 네비게이션 전략 수립
 */

const chalk = require('chalk');

class NavigationStrategy {
  constructor(logger) {
    this.logger = logger || console;
    
    // YouTube Premium 관련 URL들
    this.URLS = {
      YOUTUBE_HOME: 'https://www.youtube.com',
      YOUTUBE_PREMIUM: 'https://www.youtube.com/paid_memberships',  // 정확한 YouTube Premium 페이지
      YOUTUBE_MEMBERSHIPS: 'https://www.youtube.com/paid_memberships',
      GOOGLE_SUBSCRIPTIONS: 'https://myaccount.google.com/subscriptions',
      GOOGLE_ACCOUNT: 'https://myaccount.google.com'
    };
  }

  /**
   * 네비게이션 전략 수립
   */
  async planNavigation(currentState, targetPage) {
    console.log(chalk.cyan(`🗺️ [Navigation] 네비게이션 전략 수립 중...`));
    console.log(chalk.gray(`  현재 위치: ${currentState.pageType}`));
    console.log(chalk.gray(`  목표: ${targetPage}`));

    const steps = [];

    // 로그인이 필요한 경우
    if (!currentState.loginStatus.isLoggedIn) {
      console.log(chalk.yellow(`🔐 [Navigation] 로그인 필요 감지`));
      steps.push({
        action: 'handle_login',
        details: currentState.loginStatus
      });
    }

    // 목표별 네비게이션 경로
    switch (targetPage) {
      case 'youtube_premium':
        steps.push(...this.planPremiumNavigation(currentState));
        break;
        
      case 'youtube_management':
        steps.push(...this.planManagementNavigation(currentState));
        break;
        
      case 'pause_membership':
        steps.push(...this.planPauseNavigation(currentState));
        break;
        
      case 'resume_membership':
        steps.push(...this.planResumeNavigation(currentState));
        break;
        
      default:
        console.log(chalk.yellow(`⚠️ [Navigation] 알 수 없는 목표: ${targetPage}`));
    }

    // 전략 로깅
    if (steps.length > 0) {
      console.log(chalk.cyan(`📋 [Navigation] 네비게이션 계획 (${steps.length}단계):`));
      steps.forEach((step, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${step.action}`));
        if (step.details) {
          console.log(chalk.gray(`     상세: ${JSON.stringify(step.details)}`));
        }
      });
    }

    return {
      currentState,
      targetPage,
      steps,
      estimatedTime: steps.length * 3000 // 각 단계당 약 3초 예상
    };
  }

  /**
   * YouTube Premium 페이지로 이동 계획
   */
  planPremiumNavigation(currentState) {
    const steps = [];

    switch (currentState.pageType) {
      case 'youtube_premium_overview':
      case 'youtube_premium_management':
        // 이미 Premium 페이지에 있음
        break;
        
      case 'youtube_other':
        // YouTube 내에서 Premium으로 이동
        steps.push({
          action: 'navigate_direct',
          url: this.URLS.YOUTUBE_PREMIUM,
          waitFor: 'page_load'
        });
        break;
        
      case 'google_subscriptions':
        // Google 구독에서 YouTube로 이동
        steps.push({
          action: 'find_youtube_subscription',
          selector: 'YouTube Premium'
        });
        steps.push({
          action: 'click_manage',
          waitFor: 'navigation'
        });
        break;
        
      default:
        // 다른 곳에서 직접 이동
        steps.push({
          action: 'navigate_direct',
          url: this.URLS.YOUTUBE_PREMIUM,
          waitFor: 'page_load'
        });
    }

    return steps;
  }

  /**
   * 멤버십 관리 페이지로 이동 계획
   */
  planManagementNavigation(currentState) {
    const steps = [];

    // 먼저 Premium 페이지로 이동
    if (!currentState.pageType.includes('youtube_premium')) {
      steps.push(...this.planPremiumNavigation(currentState));
    }

    // 관리 페이지가 아닌 경우
    if (currentState.pageType !== 'youtube_premium_management') {
      if (currentState.pageContent.hasManageButton) {
        steps.push({
          action: 'click_manage_membership',
          selectors: [
            'button:has-text("Manage membership")',
            'button:has-text("구독 관리")',
            'button:has-text("멤버십 관리")',
            'a[href*="manage"]'
          ],
          waitFor: 'navigation'
        });
      } else {
        // 관리 버튼이 없으면 직접 URL로 시도
        steps.push({
          action: 'navigate_direct',
          url: this.URLS.YOUTUBE_MEMBERSHIPS,
          waitFor: 'page_load'
        });
      }
    }

    return steps;
  }

  /**
   * 일시중지 실행 계획
   */
  planPauseNavigation(currentState) {
    const steps = [];

    // 이미 일시중지 상태인지 확인
    if (currentState.pageContent.isAlreadyPaused) {
      console.log(chalk.yellow(`⚠️ [Navigation] 이미 일시중지 상태`));
      return [{
        action: 'already_paused',
        skipRemaining: true
      }];
    }

    // 관리 페이지로 이동
    steps.push(...this.planManagementNavigation(currentState));

    // 일시중지 버튼 클릭
    if (currentState.pageContent.hasPauseOption) {
      steps.push({
        action: 'click_pause_button',
        selectors: [
          'button:has-text("Pause membership")',
          'button:has-text("일시중지")',
          'button:has-text("멤버십 일시중지")',
          '[aria-label*="pause"]',
          '[aria-label*="일시중지"]'
        ],
        waitFor: 'modal_or_navigation'
      });

      // 확인 단계
      steps.push({
        action: 'confirm_pause',
        selectors: [
          'button:has-text("Pause")',
          'button:has-text("일시중지")',
          'button:has-text("확인")',
          'button[aria-label*="confirm"]'
        ],
        waitFor: 'confirmation'
      });
    }

    return steps;
  }

  /**
   * 재개 실행 계획
   */
  planResumeNavigation(currentState) {
    const steps = [];

    // 이미 활성 상태인지 확인
    if (!currentState.pageContent.isAlreadyPaused && 
        currentState.pageContent.hasYouTubePremium &&
        !currentState.pageContent.hasResumeOption) {
      console.log(chalk.yellow(`⚠️ [Navigation] 이미 활성 상태`));
      return [{
        action: 'already_active',
        skipRemaining: true
      }];
    }

    // 관리 페이지로 이동
    steps.push(...this.planManagementNavigation(currentState));

    // 재개 버튼 클릭
    if (currentState.pageContent.hasResumeOption) {
      steps.push({
        action: 'click_resume_button',
        selectors: [
          'button:has-text("Resume membership")',
          'button:has-text("재개")',
          'button:has-text("결제 재개")',
          'button:has-text("멤버십 재개")',
          '[aria-label*="resume"]',
          '[aria-label*="재개"]'
        ],
        waitFor: 'modal_or_navigation'
      });

      // 확인 단계
      steps.push({
        action: 'confirm_resume',
        selectors: [
          'button:has-text("Resume")',
          'button:has-text("재개")',
          'button:has-text("확인")',
          'button[aria-label*="confirm"]'
        ],
        waitFor: 'confirmation'
      });
    }

    return steps;
  }

  /**
   * 네비게이션 단계 실행
   */
  async executeStep(page, step) {
    console.log(chalk.cyan(`▶️ [Navigation] 실행: ${step.action}`));

    try {
      switch (step.action) {
        case 'navigate_direct':
          await this.navigateDirect(page, step.url, step.waitFor);
          break;
          
        case 'click_manage_membership':
        case 'click_pause_button':
        case 'click_resume_button':
          await this.clickElement(page, step.selectors, step.waitFor);
          break;
          
        case 'confirm_pause':
        case 'confirm_resume':
          await this.confirmAction(page, step.selectors, step.waitFor);
          break;
          
        case 'handle_login':
          // 로그인 처리는 별도 서비스에서
          return { needsLogin: true, loginDetails: step.details };
          
        case 'already_paused':
        case 'already_active':
          return { completed: true, reason: step.action };
          
        default:
          console.log(chalk.yellow(`⚠️ [Navigation] 알 수 없는 액션: ${step.action}`));
      }

      // 각 단계 후 잠시 대기
      await new Promise(r => setTimeout(r, 2000));
      return { success: true };

    } catch (error) {
      console.error(chalk.red(`❌ [Navigation] 단계 실행 실패:`, error.message));
      return { success: false, error: error.message };
    }
  }

  /**
   * 직접 URL 이동
   */
  async navigateDirect(page, url, waitFor) {
    console.log(chalk.cyan(`🔗 [Navigation] URL로 이동: ${url}`));
    
    await page.goto(url, {
      waitUntil: waitFor === 'page_load' ? 'networkidle2' : 'domcontentloaded',
      timeout: 30000
    });
    
    // 추가 대기
    if (waitFor === 'page_load') {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  /**
   * 요소 클릭
   */
  async clickElement(page, selectors, waitFor) {
    console.log(chalk.cyan(`🖱️ [Navigation] 요소 클릭 시도`));
    
    let clicked = false;
    
    // 여러 셀렉터 시도
    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          console.log(chalk.green(`✅ [Navigation] 클릭 성공: ${selector}`));
          clicked = true;
          break;
        }
      } catch (e) {
        // 다음 셀렉터 시도
        continue;
      }
    }
    
    if (!clicked) {
      throw new Error('클릭 가능한 요소를 찾을 수 없습니다');
    }
    
    // 결과 대기
    if (waitFor === 'navigation') {
      await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    } else if (waitFor === 'modal_or_navigation') {
      await Promise.race([
        page.waitForNavigation({ timeout: 5000 }),
        new Promise(r => setTimeout(r, 3000))
      ]).catch(() => {});
    }
  }

  /**
   * 액션 확인
   */
  async confirmAction(page, selectors, waitFor) {
    console.log(chalk.cyan(`✔️ [Navigation] 확인 버튼 클릭`));
    
    // 모달이 나타날 때까지 대기
    await new Promise(r => setTimeout(r, 2000));
    
    // 확인 버튼 클릭
    await this.clickElement(page, selectors, 'none');
    
    // 결과 대기
    if (waitFor === 'confirmation') {
      await new Promise(r => setTimeout(r, 5000));
      
      // 성공 메시지 확인
      const success = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.includes('successfully') || 
               text.includes('성공') ||
               text.includes('완료');
      });
      
      if (success) {
        console.log(chalk.green(`✅ [Navigation] 작업 완료 확인`));
      }
    }
  }

  /**
   * 네비게이션 복구 전략
   */
  async recoverNavigation(page, targetPage, attempt = 1) {
    console.log(chalk.yellow(`🔄 [Navigation] 네비게이션 복구 시도 ${attempt}/3`));
    
    if (attempt > 3) {
      throw new Error('네비게이션 복구 실패');
    }
    
    try {
      // 페이지 새로고침
      await page.reload({ waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      
      // 직접 URL로 이동 시도
      if (targetPage === 'youtube_premium') {
        await page.goto(this.URLS.YOUTUBE_PREMIUM, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
      } else if (targetPage === 'youtube_management') {
        await page.goto(this.URLS.YOUTUBE_MEMBERSHIPS, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
      }
      
      await new Promise(r => setTimeout(r, 3000));
      console.log(chalk.green(`✅ [Navigation] 복구 성공`));
      
    } catch (error) {
      console.error(chalk.red(`❌ [Navigation] 복구 실패:`, error.message));
      // 재시도
      await this.recoverNavigation(page, targetPage, attempt + 1);
    }
  }
}

module.exports = NavigationStrategy;