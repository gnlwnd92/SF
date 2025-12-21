/**
 * ImprovedAuthenticationService 패치 - 복구 이메일 선택 페이지 처리 추가
 * 
 * Google 로그인 시 challenge/selection 페이지에서 복구 이메일 확인 처리
 */

// 기존 ImprovedAuthenticationService를 확장
const ImprovedAuthenticationService = require('./ImprovedAuthenticationService');

// 원본 클래스의 프로토타입 확장
const originalDetectPageType = ImprovedAuthenticationService.prototype.detectPageType;
const originalAttemptLogin = ImprovedAuthenticationService.prototype.attemptLogin;

/**
 * 페이지 타입 감지 메서드 오버라이드
 */
ImprovedAuthenticationService.prototype.detectPageType = async function(page) {
  try {
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const bodyText = document.body?.textContent || '';
      
      // 복구 이메일 확인 페이지 감지
      if (url.includes('/challenge/selection') || 
          url.includes('/signin/challenge/selection')) {
        
        // 복구 이메일 관련 텍스트 확인
        const hasRecoveryEmail = bodyText.includes('복구 이메일') || 
                                 bodyText.includes('recovery email') ||
                                 bodyText.includes('본인 확인') ||
                                 bodyText.includes('Confirm your recovery email') ||
                                 bodyText.includes('다른 방법 사용') ||
                                 bodyText.includes('Try another way');
        
        if (hasRecoveryEmail) {
          return { type: 'recovery_email_selection' };
        }
      }
      
      return null;
    });
    
    if (pageInfo && pageInfo.type === 'recovery_email_selection') {
      this.log('📧 복구 이메일 확인 페이지 감지', 'info');
      return 'recovery_email_selection';
    }
    
    // 원본 메서드 호출
    return originalDetectPageType.call(this, page);
    
  } catch (error) {
    // 오류 시 원본 메서드 호출
    return originalDetectPageType.call(this, page);
  }
};

/**
 * 복구 이메일 선택 페이지 처리
 */
ImprovedAuthenticationService.prototype.handleRecoveryEmailSelection = async function(page, credentials, options = {}) {
  this.log('📧 복구 이메일 확인 페이지 처리', 'info');
  
  try {
    // 페이지 스크린샷 저장
    if (this.config.screenshotEnabled) {
      const screenshotPath = `screenshots/recovery_email_page_${Date.now()}.png`;
      await this.saveScreenshot(page, screenshotPath);
      this.log(`📸 복구 이메일 페이지 스크린샷: ${screenshotPath}`, 'debug');
    }
    
    // 복구 이메일 옵션 찾기 및 클릭
    const clicked = await page.evaluate((recoveryEmail) => {
      // 모든 선택 가능한 옵션 찾기
      const options = document.querySelectorAll('[role="link"], [role="button"], div[data-challengetype], div[jsname]');
      
      for (const option of options) {
        const text = option.textContent || '';
        
        // 복구 이메일 확인 옵션 찾기
        if (text.includes('복구 이메일 확인') || 
            text.includes('Confirm your recovery email') ||
            text.includes('이메일로 확인') ||
            text.includes('Get a verification code') ||
            (recoveryEmail && text.includes(recoveryEmail))) {
          
          console.log('[Recovery] 복구 이메일 옵션 발견:', text);
          
          // 클릭 가능한 요소 찾기
          const clickableElement = option.querySelector('[role="link"], [role="button"]') || option;
          
          // 휴먼라이크 클릭
          const rect = clickableElement.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          
          // 마우스 이벤트 시뮬레이션
          const mouseEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          });
          
          clickableElement.dispatchEvent(mouseEvent);
          return true;
        }
      }
      
      // 복구 이메일 옵션을 찾지 못한 경우 "다른 방법 사용" 클릭
      for (const option of options) {
        const text = option.textContent || '';
        if (text.includes('다른 방법 사용') || text.includes('Try another way')) {
          console.log('[Recovery] "다른 방법 사용" 옵션 클릭');
          option.click();
          return true;
        }
      }
      
      return false;
    }, credentials.recoveryEmail);
    
    if (!clicked) {
      this.log('⚠️ 복구 이메일 옵션을 찾을 수 없습니다', 'warning');
      
      // 대체 방법: Enter 키 눌러보기
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 2000));
    } else {
      this.log('✅ 복구 이메일 옵션 클릭 성공', 'success');
    }
    
    // 클릭 후 페이지 로드 대기
    await new Promise(r => setTimeout(r, 3000));
    
    // 다음 페이지 확인
    const nextPageType = await this.detectPageType(page);
    this.log(`복구 이메일 선택 후 페이지: ${nextPageType}`, 'info');
    
    // 복구 이메일 입력 페이지로 이동한 경우
    if (nextPageType === 'email_input' || page.url().includes('challenge/recvmail')) {
      // 복구 이메일 입력
      const emailInput = await page.$('input[type="email"], input[type="text"]');
      if (emailInput && credentials.recoveryEmail) {
        await emailInput.click();
        await page.keyboard.type(credentials.recoveryEmail, { delay: 100 });
        await page.keyboard.press('Enter');
        
        this.log('✅ 복구 이메일 입력 완료', 'success');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    
    // 로그인 성공 확인
    const isLoggedIn = await this.checkLoginStatus(page);
    if (isLoggedIn) {
      return { success: true };
    }
    
    // 다음 단계 처리를 위해 false 반환 (재시도 유도)
    return { success: false, message: '복구 이메일 확인 후 추가 단계 필요' };
    
  } catch (error) {
    this.log(`복구 이메일 처리 중 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * attemptLogin 메서드 오버라이드 - recovery_email_selection 케이스 추가
 */
ImprovedAuthenticationService.prototype.attemptLogin = async function(page, credentials, options = {}) {
  try {
    // 현재 페이지 URL 확인
    let currentUrl = page.url();
    this.log(`현재 URL: ${currentUrl}`, 'debug');
    
    // Google 로그인 페이지가 아니면 이동
    if (!currentUrl.includes('accounts.google.com')) {
      this.log('Google 로그인 페이지로 이동', 'info');
      await page.goto('https://accounts.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, this.config.waitTimes.pageLoad));
    }
    
    // 현재 페이지 타입 확인
    currentUrl = page.url();
    const pageType = await this.detectPageType(page);
    this.log(`페이지 타입: ${pageType}`, 'info');
    
    // 페이지 타입에 따른 처리
    switch (pageType) {
      case 'recovery_email_selection':
        // 복구 이메일 선택 페이지 처리
        return await this.handleRecoveryEmailSelection(page, credentials, options);
        
      case 'recaptcha':
        this.log('⚠️ reCAPTCHA 감지됨', 'warning');
        if (options.screenshotEnabled) {
          await page.screenshot({
            path: `screenshots/recaptcha_detected_${Date.now()}.png`
          });
        }
        return { 
          success: false, 
          error: 'RECAPTCHA_DETECTED',
          message: 'reCAPTCHA 인증 필요',
          status: 'recaptcha_detected',
          skipRetry: true
        };
        
      case 'account_chooser':
        return await this.handleAccountChooserLogin(page, credentials, options);
        
      case 'email_input':
        return await this.handleEmailLogin(page, credentials, options);
        
      case 'password_input':
        return await this.handlePasswordLogin(page, credentials, options);
        
      case 'two_factor':
        return await this.handle2FALogin(page, credentials, options);
        
      case 'logged_in':
        this.log('이미 로그인되어 있습니다', 'success');
        return { success: true };
        
      default:
        // 원본 메서드 호출
        return originalAttemptLogin.call(this, page, credentials, options);
    }
    
  } catch (error) {
    this.log(`로그인 중 오류: ${error.message}`, 'error');
    
    if (options.screenshotEnabled) {
      try {
        await page.screenshot({
          path: `screenshots/login_error_${Date.now()}.png`
        });
      } catch (e) {
        // 스크린샷 실패 무시
      }
    }
    
    throw error;
  }
};

module.exports = ImprovedAuthenticationService;