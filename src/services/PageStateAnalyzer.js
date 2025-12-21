/**
 * Page State Analyzer
 * 현재 페이지 상태를 분석하여 로그인 필요 여부, 현재 위치 등을 판단
 */

const chalk = require('chalk');

class PageStateAnalyzer {
  constructor(logger) {
    this.logger = logger || console;
  }

  /**
   * 현재 페이지 상태 종합 분석
   */
  async analyzePageState(page, options = {}) {
    try {
      const url = page.url();
      const title = await page.title();
      
      // silent 옵션이 true면 로그 출력 안함 (waitForPageReady에서 호출 시)
      if (!options.silent) {
        console.log(chalk.cyan(`📍 [PageAnalyzer] 현재 페이지 분석 중...`));
        console.log(chalk.gray(`  URL: ${url}`));
        console.log(chalk.gray(`  Title: ${title}`));
      }

      // 페이지 콘텐츠 분석
      const pageContent = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const html = document.documentElement?.innerHTML || '';
        
        return {
          bodyText: text.substring(0, 5000), // 처음 5000자만
          hasGoogleLogin: html.includes('accounts.google.com') || 
                         text.includes('Sign in') || 
                         text.includes('로그인'),
          hasPasswordField: !!document.querySelector('input[type="password"]'),
          hasEmailField: !!document.querySelector('input[type="email"]'),
          hasTOTPField: !!document.querySelector('input[type="tel"][maxlength="6"]'),
          hasPasskeyPrompt: text.includes('passkey') || 
                           text.includes('Passkey') ||
                           text.includes('패스키'),
          hasYouTubePremium: text.includes('YouTube Premium') || 
                            text.includes('YouTube 프리미엄'),
          hasManageButton: text.includes('Manage membership') || 
                          text.includes('구독 관리') ||
                          text.includes('멤버십 관리'),
          hasPauseOption: text.includes('Pause membership') || 
                         text.includes('일시중지'),
          hasResumeOption: text.includes('Resume membership') || 
                          text.includes('재개') ||
                          text.includes('결제 재개'),
          isAlreadyPaused: text.includes('paused') || 
                          text.includes('일시중지됨') ||
                          text.includes('일시중지 상태'),
          hasError: text.includes('Something went wrong') || 
                   text.includes('오류가 발생했습니다') ||
                   text.includes('ERR_') ||
                   text.includes('This page isn\'t available'),
          hasCaptcha: html.includes('recaptcha') || 
                      html.includes('captcha')
        };
      });

      // 페이지 타입 결정
      const pageType = this.determinePageType(url, pageContent);
      
      // 로그인 상태 확인
      const loginStatus = await this.checkLoginStatus(page, pageContent);
      
      // 필요한 액션 결정
      const requiredActions = this.determineRequiredActions(pageType, loginStatus, pageContent);

      const result = {
        url,
        title,
        pageType,
        loginStatus,
        requiredActions,
        pageContent: {
          hasYouTubePremium: pageContent.hasYouTubePremium,
          hasManageButton: pageContent.hasManageButton,
          hasPauseOption: pageContent.hasPauseOption,
          hasResumeOption: pageContent.hasResumeOption,
          isAlreadyPaused: pageContent.isAlreadyPaused,
          hasError: pageContent.hasError,
          hasCaptcha: pageContent.hasCaptcha
        }
      };

      // 상태 로깅 (silent 모드가 아닐 때만)
      if (!options.silent) {
        console.log(chalk.cyan(`📄 [PageState] 분석 결과:`));
        console.log(chalk.gray(`  페이지 타입: ${pageType}`));
        console.log(chalk.gray(`  로그인 상태: ${loginStatus.isLoggedIn ? '✅ 로그인됨' : '❌ 로그인 필요'}`));
        if (loginStatus.needsAction) {
          console.log(chalk.yellow(`  필요한 작업: ${loginStatus.needsAction}`));
        }
        if (requiredActions.length > 0) {
          console.log(chalk.yellow(`  다음 단계: ${requiredActions.join(', ')}`));
        }
      }

      return result;
    } catch (error) {
      console.error(chalk.red(`❌ [PageAnalyzer] 페이지 분석 실패:`, error.message));
      throw error;
    }
  }

  /**
   * 페이지 타입 결정
   */
  determinePageType(url, content) {
    // Google 로그인 페이지
    if (url.includes('accounts.google.com')) {
      if (content.hasPasswordField) {
        return 'google_login_password';
      } else if (content.hasEmailField) {
        return 'google_login_email';
      } else if (content.hasTOTPField) {
        return 'google_login_2fa';
      } else if (content.hasPasskeyPrompt) {
        return 'google_login_passkey';
      }
      return 'google_login_unknown';
    }
    
    // YouTube 페이지
    if (url.includes('youtube.com')) {
      // paid_memberships가 실제 YouTube Premium 관리 페이지
      if (url.includes('/paid_memberships')) {
        if (content.hasManageButton) {
          return 'youtube_premium_overview';
        } else if (content.hasPauseOption || content.hasResumeOption) {
          return 'youtube_premium_management';
        }
        return 'youtube_premium_page';
      } else if (url.includes('/premium')) {
        // /premium은 마케팅 페이지
        return 'youtube_premium_marketing';
      }
      return 'youtube_other';
    }
    
    // myaccount.google.com
    if (url.includes('myaccount.google.com')) {
      if (url.includes('/subscriptions')) {
        return 'google_subscriptions';
      }
      return 'google_myaccount';
    }
    
    return 'unknown';
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus(page, content) {
    const url = page.url();
    
    // Google 로그인 페이지에 있으면 무조건 로그인 필요
    if (url.includes('accounts.google.com')) {
      // 계정 선택 페이지
      if (url.includes('accountchooser') || url.includes('signin/v2/identifier')) {
        return {
          isLoggedIn: false,
          needsAction: 'choose_account_or_email',
          stage: 'account_chooser'
        };
      } else if (content.hasEmailField) {
        return {
          isLoggedIn: false,
          needsAction: 'enter_email',
          stage: 'email'
        };
      } else if (content.hasPasswordField) {
        return {
          isLoggedIn: false,
          needsAction: 'enter_password',
          stage: 'password'
        };
      } else if (content.hasTOTPField) {
        return {
          isLoggedIn: false,
          needsAction: 'enter_totp',
          stage: '2fa'
        };
      } else if (content.hasPasskeyPrompt) {
        return {
          isLoggedIn: false,
          needsAction: 'skip_passkey',
          stage: 'passkey'
        };
      }
      
      // Google 로그인 페이지의 모든 경우 로그인 안됨으로 처리
      return {
        isLoggedIn: false,
        needsAction: 'login_required',
        stage: 'google_login'
      };
    }
    
    // YouTube에서 특정 요소 확인으로 로그인 상태 판단
    if (url.includes('youtube.com')) {
      // 세밀한 로그인 상태 확인
      const loginCheck = await page.evaluate(() => {
        // 로그인 버튼이 있는지 확인
        const hasSignInButton = !!document.querySelector('[aria-label*="Sign in"]') || 
                                !!document.querySelector('[aria-label*="로그인"]') ||
                                !!document.querySelector('a[href*="accounts.google.com/ServiceLogin"]');
        
        // 사용자 아바타가 있는지 확인
        const hasUserAvatar = !!document.querySelector('button[id="avatar-btn"]') ||
                             !!document.querySelector('img[alt*="Avatar"]') ||
                             !!document.querySelector('#avatar') ||
                             !!document.querySelector('button[aria-label*="Account"]');
        
        // YouTube Premium 관련 콘텐츠가 있는지
        const bodyText = document.body?.innerText || '';
        const hasPremiumContent = bodyText.includes('YouTube Premium') || 
                                  bodyText.includes('YouTube 프리미엄') ||
                                  bodyText.includes('Manage membership') ||
                                  bodyText.includes('구독 관리');
        
        // 로그인 필요 메시지가 있는지
        const needsSignIn = bodyText.includes('Sign in to') || 
                           bodyText.includes('로그인하여') ||
                           bodyText.includes('Sign in for');
        
        return {
          hasSignInButton,
          hasUserAvatar,
          hasPremiumContent,
          needsSignIn
        };
      });
      
      // 로그인 버튼이 있고 사용자 아바타가 없으면 로그인 안됨
      if (loginCheck.hasSignInButton && !loginCheck.hasUserAvatar) {
        return {
          isLoggedIn: false,
          needsAction: 'login_required',
          stage: 'not_logged_in'
        };
      }
      
      // "로그인하여" 메시지가 있으면 로그인 안됨
      if (loginCheck.needsSignIn) {
        return {
          isLoggedIn: false,
          needsAction: 'login_required',
          stage: 'not_logged_in'
        };
      }
      
      // 사용자 아바타가 있거나 Premium 콘텐츠가 있으면 로그인됨
      if (loginCheck.hasUserAvatar || loginCheck.hasPremiumContent) {
        return {
          isLoggedIn: true,
          needsAction: null,
          stage: 'complete'
        };
      }
    }
    
    // 쿠키 체크 (보조 방법)
    try {
      const cookies = await page.cookies();
      const hasGoogleAuth = cookies.some(c => 
        c.name === 'SID' || c.name === 'HSID' || c.name === 'SSID' || c.name === 'LOGIN_INFO'
      );
      
      if (hasGoogleAuth) {
        return {
          isLoggedIn: true,
          needsAction: null,
          stage: 'complete'
        };
      }
    } catch (e) {
      // 쿠키 체크 실패 시 무시
    }
    
    // 기본값 - Google 로그인 창이 있으면 로그인 안됨
    return {
      isLoggedIn: !content.hasGoogleLogin,
      needsAction: content.hasGoogleLogin ? 'login_required' : null,
      stage: 'unknown'
    };
  }

  /**
   * 필요한 액션 결정
   */
  determineRequiredActions(pageType, loginStatus, content) {
    const actions = [];
    
    // 로그인이 필요한 경우
    if (!loginStatus.isLoggedIn) {
      if (loginStatus.needsAction === 'enter_email') {
        actions.push('input_email');
      } else if (loginStatus.needsAction === 'enter_password') {
        actions.push('input_password');
      } else if (loginStatus.needsAction === 'enter_totp') {
        actions.push('input_totp');
      } else if (loginStatus.needsAction === 'skip_passkey') {
        actions.push('click_try_another_way');
      } else {
        actions.push('perform_login');
      }
      return actions;
    }
    
    // 페이지 타입별 액션
    switch (pageType) {
      case 'youtube_premium_overview':
        if (content.hasManageButton) {
          actions.push('click_manage_membership');
        }
        break;
        
      case 'youtube_premium_management':
        if (content.isAlreadyPaused) {
          actions.push('already_paused');
        } else if (content.hasPauseOption) {
          actions.push('click_pause_button');
        } else if (content.hasResumeOption) {
          actions.push('click_resume_button');
        }
        break;
        
      case 'youtube_premium_page':
        actions.push('navigate_to_management');
        break;
        
      case 'youtube_other':
        actions.push('navigate_to_premium');
        break;
        
      default:
        if (!content.hasYouTubePremium) {
          actions.push('navigate_to_premium');
        }
    }
    
    return actions;
  }

  /**
   * 페이지 로드 대기 및 상태 확인
   */
  async waitForPageReady(page, options = {}) {
    const { timeout = 30000, checkInterval = 3000, maxChecks = 3 } = options;
    const startTime = Date.now();
    let checkCount = 0;
    let lastPageType = null;
    let sameTypeCount = 0;
    
    console.log(chalk.cyan(`⏳ [PageAnalyzer] 페이지 로드 대기 중... (최대 ${maxChecks}회 체크)`));
    
    while (Date.now() - startTime < timeout && checkCount < maxChecks) {
      try {
        // 페이지가 로드될 때까지 대기
        await new Promise(r => setTimeout(r, checkInterval));
        
        // 페이지 상태 확인 (silent 모드로 중복 로그 방지)
        const state = await this.analyzePageState(page, { silent: true });
        checkCount++;
        
        // 체크 진행 상황 표시 (간단하게)
        console.log(chalk.gray(`  [체크 ${checkCount}/${maxChecks}] 페이지 타입: ${state.pageType}`));
        
        // 같은 페이지 타입이 연속으로 나오면 조기 종료
        if (state.pageType === lastPageType) {
          sameTypeCount++;
          if (sameTypeCount >= 2) {
            console.log(chalk.green(`✅ [PageAnalyzer] 페이지 상태 안정화 (${state.pageType})`));
            // 최종 상태를 한 번만 출력
            return await this.analyzePageState(page);
          }
        } else {
          sameTypeCount = 0;
        }
        lastPageType = state.pageType;
        
        // 캡차가 있으면 즉시 반환
        if (state.pageContent.hasCaptcha) {
          console.log(chalk.yellow(`⚠️ [PageAnalyzer] 캡차 감지`));
          // 최종 상태를 한 번만 출력
          return await this.analyzePageState(page);
        }
        
        // 목표 페이지에 도달했는지 확인
        if (this.isTargetPageReached(state, options.targetPage)) {
          console.log(chalk.green(`✅ [PageAnalyzer] 목표 페이지 도달 (${state.pageType})`));
          // 최종 상태를 한 번만 출력
          return await this.analyzePageState(page);
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        console.error(chalk.yellow(`⚠️ [PageAnalyzer] 대기 중 오류:`, error.message));
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        checkCount++;
      }
    }
    
    // 타임아웃 또는 최대 체크 도달 시 현재 상태 반환
    if (checkCount >= maxChecks) {
      console.log(chalk.yellow(`⚠️ [PageAnalyzer] 최대 체크 횟수 도달 (${maxChecks}회)`));
    } else {
      console.log(chalk.yellow(`⚠️ [PageAnalyzer] 대기 시간 초과`));
    }
    // 최종 상태를 한 번만 출력
    return await this.analyzePageState(page);
  }

  /**
   * 목표 페이지 도달 확인
   */
  isTargetPageReached(state, targetPage) {
    if (!targetPage) return true;
    
    switch (targetPage) {
      case 'premium':
        return state.pageType.includes('youtube_premium') && 
               state.loginStatus.isLoggedIn;
               
      case 'management':
        return state.pageType === 'youtube_premium_management' && 
               state.loginStatus.isLoggedIn;
               
      case 'login_complete':
        return state.loginStatus.isLoggedIn && 
               !state.url.includes('accounts.google.com');
               
      default:
        return true;
    }
  }
}

module.exports = PageStateAnalyzer;