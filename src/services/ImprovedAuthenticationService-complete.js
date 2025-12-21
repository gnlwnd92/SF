/**
 * ImprovedAuthenticationService 완전판 - 모든 보안 확인 페이지 처리
 * 
 * 비밀번호 입력 후 나타날 수 있는 페이지들:
 * 1. 복구 이메일 확인 선택 (challenge/selection)
 * 2. 2단계 인증 TOTP (challenge/totp)
 * 3. 기타 보안 확인
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

// 기존 ImprovedAuthenticationService 가져오기
const ImprovedAuthenticationService = require('./ImprovedAuthenticationService');

// 원본 메서드 백업
const originalDetectPageType = ImprovedAuthenticationService.prototype.detectPageType;
const originalAttemptLogin = ImprovedAuthenticationService.prototype.attemptLogin;
const originalHandlePasswordLogin = ImprovedAuthenticationService.prototype.handlePasswordLogin;

/**
 * 페이지 타입 감지 메서드 확장
 */
ImprovedAuthenticationService.prototype.detectPageType = async function(page) {
  try {
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const bodyText = document.body?.textContent || '';
      const title = document.title || '';
      
      // 디버그 정보
      console.log('[Page Detection] URL:', url);
      console.log('[Page Detection] Title:', title);
      
      // 1. 2단계 인증 페이지 (우선순위 높음)
      if (url.includes('/challenge/totp') || 
          url.includes('/signin/challenge/totp') ||
          bodyText.includes('2단계 인증') ||
          bodyText.includes('Google OTP') ||
          bodyText.includes('2-Step Verification') ||
          document.querySelector('input[type="tel"]') ||
          document.querySelector('input[name="totpPin"]')) {
        console.log('[Page Detection] 2FA TOTP 페이지 감지');
        return { type: 'two_factor_totp' };
      }
      
      // 2. 복구 이메일 확인 선택 페이지
      if (url.includes('/challenge/selection') || 
          url.includes('/signin/challenge/selection')) {
        
        // 옵션들 확인
        const hasRecoveryOptions = bodyText.includes('본인 인증') || 
                                   bodyText.includes('계정 보호를 위해') ||
                                   bodyText.includes('로그인 방법을 선택하세요') ||
                                   bodyText.includes('복구 이메일') ||
                                   bodyText.includes('recovery email') ||
                                   bodyText.includes('다른 방법') ||
                                   bodyText.includes('Try another way');
        
        if (hasRecoveryOptions) {
          console.log('[Page Detection] 복구 이메일 선택 페이지 감지');
          return { type: 'recovery_selection' };
        }
      }
      
      // 3. 비밀번호 입력 페이지
      if (url.includes('/challenge/pwd') || 
          document.querySelector('input[type="password"]:not([aria-hidden="true"])')) {
        return { type: 'password_input' };
      }
      
      // 4. 이메일 입력 페이지
      if (url.includes('/identifier') || 
          document.querySelector('input[type="email"]:not([aria-hidden="true"])') ||
          document.querySelector('#identifierId')) {
        return { type: 'email_input' };
      }
      
      // 5. 로그인 완료
      if (url.includes('myaccount.google.com') || 
          url.includes('accounts.google.com/ManageAccount')) {
        return { type: 'logged_in' };
      }
      
      return null;
    });
    
    if (pageInfo && pageInfo.type) {
      this.log(`📄 페이지 타입 감지: ${pageInfo.type}`, 'info');
      return pageInfo.type;
    }
    
    // 원본 메서드 호출
    return originalDetectPageType.call(this, page);
    
  } catch (error) {
    this.log(`페이지 타입 감지 오류: ${error.message}`, 'error');
    return originalDetectPageType.call(this, page);
  }
};

/**
 * 복구 이메일 선택 페이지 처리
 */
ImprovedAuthenticationService.prototype.handleRecoverySelection = async function(page, credentials) {
  this.log('📧 복구 이메일 확인 페이지 처리', 'info');
  
  try {
    // 스크린샷 저장
    if (this.config.screenshotEnabled) {
      await this.saveScreenshot(page, `screenshots/recovery_selection_${Date.now()}.png`);
    }
    
    // 복구 이메일 옵션 찾기 및 클릭
    const clicked = await page.evaluate((recoveryEmail) => {
      // 모든 클릭 가능한 요소 찾기
      const options = Array.from(document.querySelectorAll('div[role="link"], div[role="button"], div[jsname], div[data-challengetype]'));
      
      console.log('[Recovery] 찾은 옵션 수:', options.length);
      
      // 1. 먼저 복구 이메일 옵션 찾기
      for (const option of options) {
        const text = option.textContent || '';
        
        // 복구 이메일 관련 텍스트 확인
        if (text.includes('복구 이메일') || 
            text.includes('recovery email') ||
            text.includes('이메일로 확인') ||
            (recoveryEmail && text.includes(recoveryEmail)) ||
            text.includes('이메일 확인')) {
          
          console.log('[Recovery] 복구 이메일 옵션 발견:', text);
          
          // 클릭
          option.click();
          return 'recovery_email_clicked';
        }
      }
      
      // 2. 복구 이메일이 없으면 다른 방법 시도
      for (const option of options) {
        const text = option.textContent || '';
        
        // 북구 이메일 확인 버튼
        if (text.includes('북구 이메일 확인') ||
            text.includes('Confirm recovery email')) {
          console.log('[Recovery] 북구 이메일 확인 클릭');
          option.click();
          return 'confirm_clicked';
        }
      }
      
      // 3. 첫 번째 옵션 클릭 (보통 복구 이메일)
      if (options.length > 0) {
        console.log('[Recovery] 첫 번째 옵션 클릭');
        options[0].click();
        return 'first_option_clicked';
      }
      
      return false;
    }, credentials.recoveryEmail);
    
    if (clicked) {
      this.log(`✅ 복구 옵션 선택 완료: ${clicked}`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      
      // 다음 페이지 확인
      const nextPageType = await this.detectPageType(page);
      this.log(`다음 페이지: ${nextPageType}`, 'info');
      
      // 복구 이메일 입력이 필요한 경우
      if (nextPageType === 'email_input' || page.url().includes('challenge/recvmail')) {
        if (credentials.recoveryEmail) {
          const emailInput = await page.$('input[type="email"], input[type="text"]');
          if (emailInput) {
            await emailInput.click();
            await emailInput.type(credentials.recoveryEmail, { delay: 100 });
            await page.keyboard.press('Enter');
            this.log('✅ 복구 이메일 입력 완료', 'success');
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }
      
      return { success: true, message: '복구 이메일 확인 처리 완료' };
    }
    
    // 실패한 경우 Enter 키 시도
    this.log('⚠️ 옵션 클릭 실패, Enter 키 시도', 'warning');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2000));
    
    return { success: false, message: '복구 이메일 선택 실패' };
    
  } catch (error) {
    this.log(`복구 이메일 처리 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 2단계 인증 TOTP 처리
 */
ImprovedAuthenticationService.prototype.handle2FATotp = async function(page, credentials) {
  this.log('🔐 2단계 인증 (TOTP) 페이지 처리', 'info');
  
  try {
    // 스크린샷 저장
    if (this.config.screenshotEnabled) {
      await this.saveScreenshot(page, `screenshots/2fa_totp_${Date.now()}.png`);
    }
    
    // TOTP 시크릿 확인
    if (!credentials.totpSecret && !credentials.code) {
      this.log('❌ TOTP 시크릿이 없습니다', 'error');
      return { success: false, error: 'TOTP 시크릿 없음' };
    }
    
    const totpSecret = credentials.totpSecret || credentials.code;
    
    // 공백 제거 및 대문자 변환
    const cleanSecret = totpSecret.replace(/\s+/g, '').toUpperCase();
    
    // TOTP 코드 생성
    const token = speakeasy.totp({
      secret: cleanSecret,
      encoding: 'base32'
    });
    
    this.log(`📱 TOTP 코드 생성: ${token}`, 'info');
    
    // 입력 필드 찾기
    const totpInput = await page.waitForSelector('input[type="tel"], input[name="totpPin"], #totpPin, input[aria-label*="code"]', {
      timeout: 5000
    });
    
    if (totpInput) {
      // 입력 필드 클릭
      await totpInput.click();
      await new Promise(r => setTimeout(r, 500));
      
      // 기존 값 삭제
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      
      // TOTP 코드 입력 (휴먼라이크)
      for (const digit of token) {
        await page.keyboard.type(digit);
        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
      }
      
      this.log('✅ TOTP 코드 입력 완료', 'success');
      
      // 다음 버튼 클릭 또는 Enter
      const nextButton = await page.$('button[type="submit"], button:has-text("다음"), button:has-text("Next")');
      if (nextButton) {
        await nextButton.click();
      } else {
        await page.keyboard.press('Enter');
      }
      
      // 결과 대기
      await new Promise(r => setTimeout(r, 3000));
      
      // 로그인 성공 확인
      const currentUrl = page.url();
      if (currentUrl.includes('myaccount.google.com') || 
          !currentUrl.includes('/challenge/')) {
        this.log('✅ 2FA 인증 성공', 'success');
        return { success: true };
      }
      
      // 오류 메시지 확인
      const hasError = await page.evaluate(() => {
        const errorText = document.body?.textContent || '';
        return errorText.includes('잘못된') || 
               errorText.includes('incorrect') ||
               errorText.includes('다시 시도');
      });
      
      if (hasError) {
        this.log('❌ TOTP 코드가 올바르지 않습니다', 'error');
        return { success: false, error: 'Invalid TOTP code' };
      }
      
      return { success: true, message: '2FA 처리 중' };
      
    } else {
      this.log('❌ TOTP 입력 필드를 찾을 수 없습니다', 'error');
      return { success: false, error: 'TOTP input not found' };
    }
    
  } catch (error) {
    this.log(`2FA 처리 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 비밀번호 로그인 처리 확장 - 다음 페이지 처리 추가
 */
ImprovedAuthenticationService.prototype.handlePasswordLogin = async function(page, credentials, options = {}) {
  this.log('🔑 비밀번호 입력 페이지 처리', 'info');
  
  // 먼저 원본 비밀번호 입력 처리
  const result = await originalHandlePasswordLogin.call(this, page, credentials, options);
  
  if (!result.success) {
    return result;
  }
  
  // 비밀번호 입력 후 나타나는 페이지 확인
  await new Promise(r => setTimeout(r, 3000));
  const nextPageType = await this.detectPageType(page);
  
  this.log(`비밀번호 입력 후 페이지: ${nextPageType}`, 'info');
  
  // 다음 페이지 타입에 따른 처리
  switch (nextPageType) {
    case 'recovery_selection':
      // 복구 이메일 선택 페이지
      return await this.handleRecoverySelection(page, credentials);
      
    case 'two_factor_totp':
      // 2단계 인증 페이지
      return await this.handle2FATotp(page, credentials);
      
    case 'logged_in':
      // 로그인 성공
      return { success: true };
      
    default:
      // 그 외의 경우 성공으로 처리
      return result;
  }
};

/**
 * attemptLogin 메서드 확장 - 새로운 페이지 타입 처리
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
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // 현재 페이지 타입 확인
    const pageType = await this.detectPageType(page);
    this.log(`페이지 타입: ${pageType}`, 'info');
    
    // 페이지 타입에 따른 처리
    switch (pageType) {
      case 'recovery_selection':
        // 복구 이메일 선택 페이지
        const recoveryResult = await this.handleRecoverySelection(page, credentials);
        if (recoveryResult.success) {
          // 다음 단계 확인
          const afterRecovery = await this.detectPageType(page);
          if (afterRecovery === 'logged_in') {
            return { success: true };
          }
        }
        return recoveryResult;
        
      case 'two_factor_totp':
        // 2단계 인증 페이지
        return await this.handle2FATotp(page, credentials);
        
      case 'email_input':
        // 이메일 입력
        return await this.handleEmailLogin(page, credentials, options);
        
      case 'password_input':
        // 비밀번호 입력
        return await this.handlePasswordLogin(page, credentials, options);
        
      case 'logged_in':
        // 이미 로그인됨
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