/**
 * ImprovedAuthenticationService 최종 버전
 * 
 * 주요 개선사항:
 * 1. 복구 이메일 선택 페이지에서 정확한 요소 클릭
 * 2. 로그인 성공 여부를 accounts.google.com으로 이동하여 확인
 * 3. 2FA TOTP 자동 처리
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

// 기존 ImprovedAuthenticationService 가져오기
const ImprovedAuthenticationService = require('./ImprovedAuthenticationService');

// 원본 메서드 백업
const originalDetectPageType = ImprovedAuthenticationService.prototype.detectPageType;
const originalAttemptLogin = ImprovedAuthenticationService.prototype.attemptLogin;
const originalHandlePasswordLogin = ImprovedAuthenticationService.prototype.handlePasswordLogin;
const originalCheckLoginStatus = ImprovedAuthenticationService.prototype.checkLoginStatus;

/**
 * 페이지 타입 감지 메서드 확장
 */
ImprovedAuthenticationService.prototype.detectPageType = async function(page) {
  try {
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const bodyText = document.body?.textContent || '';
      const title = document.title || '';
      
      console.log('[Page Detection] URL:', url);
      console.log('[Page Detection] Title:', title);
      console.log('[Page Detection] Body Text Sample:', bodyText.substring(0, 200));
      
      // 1. 복구 이메일/보안 확인 선택 페이지 (가장 높은 우선순위)
      // /challenge/selection URL은 다양한 인증 옵션을 선택하는 페이지
      if (url.includes('/challenge/selection') || 
          url.includes('/signin/challenge/selection') ||
          url.includes('/signin/v2/challenge/selection')) {
        console.log('[Page Detection] 📋 복구/보안 확인 선택 페이지 감지');
        
        // 선택 페이지에서 어떤 옵션들이 있는지 확인
        const hasRecoveryEmail = bodyText.includes('복구 이메일') || bodyText.includes('recovery email');
        const hasPhone = bodyText.includes('전화') || bodyText.includes('phone');
        const hasTryAnother = bodyText.includes('다른 방법 시도') || bodyText.includes('Try another way');
        
        console.log('[Page Detection] 선택 옵션 - 복구이메일:', hasRecoveryEmail, ', 전화:', hasPhone);
        return { type: 'recovery_selection' };
      }
      
      // 2. 전화번호 인증 페이지 감지 (실제 전화번호 입력 페이지)
      // selection 페이지가 아닌 경우에만 전화번호 인증으로 판단
      if (url.includes('/challenge/phone') ||
          url.includes('/challenge/iap') ||  // iap는 전화번호 인증 페이지
          url.includes('/signin/v2/challenge/ipp') ||
          url.includes('/signin/v2/challenge/iap') ||
          url.includes('/signin/v2/challenge/sk/phone') ||
          url.includes('/challenge/ipe') ||
          url.includes('/challenge/sms') ||
          // SMS 관련 텍스트가 있는 경우
          bodyText.includes('SMS를 받을 전화번호') ||
          bodyText.includes('인증 코드가 포함된 SMS') ||
          bodyText.includes('전화번호를 입력하세요') ||
          // 전화번호 입력 필드가 있고 selection 페이지가 아닌 경우
          (document.querySelector('input[type="tel"][name="phoneNumber"]') && !url.includes('selection')) ||
          (document.querySelector('input[autocomplete="tel"]') && !url.includes('selection')) ||
          // 본인 인증 텍스트가 있지만 selection 페이지가 아닌 경우
          (!url.includes('selection') && (
            bodyText.includes('전화번호를 확인하세요') ||
            bodyText.includes('전화번호 확인') ||
            bodyText.includes('휴대전화 번호를 입력') ||
            bodyText.includes('Verify your phone number') ||
            bodyText.includes('Enter your phone number') ||
            bodyText.includes('Phone verification')
          ))) {
        console.log('[Page Detection] 📱 전화번호 인증 페이지 감지');
        return { type: 'phone_verification' };
      }
      
      // 3. 2단계 인증 페이지 (TOTP)
      // TOTP는 전화번호 인증과 구분하여 처리
      // SMS나 전화번호 관련 텍스트가 없고, 인증 앱 관련 텍스트가 있는 경우만 TOTP로 판단
      if (url.includes('/challenge/totp') || 
          url.includes('/signin/challenge/totp') ||
          url.includes('/signin/v2/challenge/totp') ||
          // 2단계 인증 + 인증 앱 텍스트가 있고 SMS/전화번호 텍스트가 없는 경우
          (bodyText.includes('2단계 인증') && 
           (bodyText.includes('인증 앱') || bodyText.includes('authenticator app')) &&
           !bodyText.includes('SMS') && !bodyText.includes('전화번호')) ||
          bodyText.includes('Google OTP') ||
          bodyText.includes('Google Authenticator') ||
          document.querySelector('input[name="totpPin"]') ||
          document.querySelector('#totpPin') ||
          // tel 타입이지만 totpPin 이름을 가진 경우만 TOTP로 판단
          // SMS나 전화번호 텍스트가 없는 경우에만
          (document.querySelector('input[type="tel"]') && 
           !bodyText.includes('SMS') && 
           !bodyText.includes('전화번호') &&
           !bodyText.includes('phone') &&
           (bodyText.includes('6자리 코드') || 
            bodyText.includes('6-digit code') || 
            bodyText.includes('authenticator')))) {
        console.log('[Page Detection] 🔐 2FA TOTP 페이지 감지');
        return { type: 'two_factor_totp' };
      }
      
      // 4. 비밀번호 입력 페이지
      if (url.includes('/challenge/pwd') || 
          document.querySelector('input[type="password"]:not([aria-hidden="true"])')) {
        return { type: 'password_input' };
      }
      
      // 5. 이메일 입력 페이지
      if (url.includes('/identifier') || 
          document.querySelector('input[type="email"]:not([aria-hidden="true"])') ||
          document.querySelector('#identifierId')) {
        return { type: 'email_input' };
      }
      
      // 6. 로그인 완료
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
 * 복구 이메일 선택 페이지 처리 (사람처럼 여러 번 클릭 시도 + 페이지 변화 감지)
 */
ImprovedAuthenticationService.prototype.handleRecoverySelection = async function(page, credentials) {
  this.log('📧 복구 이메일 확인 페이지 처리', 'info');
  
  try {
    // 스크린샷 저장
    if (this.config.screenshotEnabled) {
      await this.saveScreenshot(page, `screenshots/recovery_selection_${Date.now()}.png`);
    }
    
    // 초기 상태 저장
    const initialUrl = page.url();
    const initialTitle = await page.title();
    this.log(`초기 URL: ${initialUrl}`, 'debug');
    this.log(`초기 제목: ${initialTitle}`, 'debug');
    
    // 최대 5번 클릭 시도 (사람처럼 여러 번)
    const maxClickAttempts = 5;
    let pageChanged = false;
    let clickSuccess = false; // 전체 메서드 스코프에서 사용할 변수 선언
    
    for (let attempt = 1; attempt <= maxClickAttempts && !pageChanged; attempt++) {
      this.log(`클릭 시도 ${attempt}/${maxClickAttempts}`, 'info');
      
      // 복구 이메일 관련 텍스트 패턴
      const targetTexts = [
        '복구 이메일 확인',
        '이메일 확인',
        '복구 이메일',
        'Confirm your recovery email',
        'Recovery email',
        'Confirm recovery',
        credentials.recoveryEmail || credentials.email
      ];
      
      let targetElement = null;
      
      // 방법 1: 텍스트 기반으로 요소 찾기
      for (const targetText of targetTexts) {
        if (!targetText) continue;
        
        try {
          // XPath로 정확한 요소 찾기
          const xpaths = [
            `//div[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${targetText.toLowerCase()}')]`,
            `//span[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${targetText.toLowerCase()}')]`,
            `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${targetText.toLowerCase()}')]/ancestor::div[@role="link" or @role="button"][1]`
          ];
          
          for (const xpath of xpaths) {
            const elements = await page.$x(xpath);
            if (elements.length > 0 && !targetElement) {
              const element = elements[0];
              const isVisible = await element.evaluate(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              
              if (isVisible) {
                targetElement = element;
                const text = await element.evaluate(el => el.textContent);
                this.log(`복구 이메일 옵션 발견: "${text?.substring(0, 50)}..."`, 'info');
                break;
              }
            }
          }
        } catch (e) {
          // 다음 패턴 시도
        }
        
        if (targetElement) break;
      }
      
      // 방법 2: CSS 선택자로 모든 클릭 가능한 요소 확인
      if (!targetElement) {
        const allClickables = await page.$$('div[role="link"], div[role="button"], button, a, div[jsaction*="click"], [data-challengetype]');
        this.log(`찾은 클릭 가능한 요소 수: ${allClickables.length}`, 'debug');
        
        // 복구 이메일 옵션 찾기
        for (let i = 0; i < allClickables.length; i++) {
          const element = allClickables[i];
          const elementInfo = await element.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return {
              text: (el.textContent || '').trim(),
              isVisible: rect.width > 0 && rect.height > 0,
              challengeType: el.getAttribute('data-challengetype'),
              ariaLabel: el.getAttribute('aria-label') || ''
            };
          });
            
            // 복구 이메일 관련 텍스트 확인 (엄격한 조건)
            const isRecoveryEmail = 
              elementInfo.text.includes('복구 이메일') ||
              elementInfo.text.includes('이메일 확인') ||
              elementInfo.text.includes('recovery email') ||
              elementInfo.text.includes('Confirm') ||
              elementInfo.ariaLabel.includes('복구') ||
              elementInfo.ariaLabel.includes('recovery') ||
              elementInfo.challengeType === '12'; // 복구 이메일 challenge type
            
            if (isRecoveryEmail) {
              this.log(`복구 이메일 옵션 발견 (인덱스 ${i}): ${elementInfo.text.substring(0, 100)}`, 'info');
              
              try {
                // 요소 클릭
                await element.scrollIntoViewIfNeeded();
                await new Promise(r => setTimeout(r, 300));
                
                // 클릭 시도
                await element.click({ delay: 100 });
                this.log(`✅ 복구 이메일 옵션 클릭 성공`, 'success');
                clickSuccess = true;
                break;
              } catch (e) {
                // JavaScript 클릭 시도
                try {
                  await element.evaluate(el => el.click());
                  this.log(`✅ 복구 이메일 옵션 JS 클릭 성공`, 'success');
                  clickSuccess = true;
                  break;
                } catch (e2) {
                  this.log(`클릭 실패, 다음 요소 시도...`, 'debug');
                }
              }
            }
        }
        
        // 여전히 실패한 경우, 인덱스 기반으로 시도 (보통 두 번째 옵션이 복구 이메일)
        if (!clickSuccess && allClickables.length >= 2) {
          this.log('텍스트 매칭 실패, 두 번째 옵션 클릭 시도', 'warning');
          try {
            await allClickables[1].click({ delay: 100 });
            this.log('✅ 두 번째 옵션 클릭 (추정: 복구 이메일)', 'success');
            clickSuccess = true;
          } catch (e) {
            // 실패
          }
        }
        
        if (clickSuccess) break;
      }
      
      // 방법 2: JavaScript로 클릭 시도
      if (!clickSuccess) {
        const result = await page.evaluate((recoveryEmail, attemptNum) => {
          console.log(`[Recovery] JavaScript 클릭 시도 ${attemptNum}`);
          
          // 모든 요소 검색
          const allElements = Array.from(document.querySelectorAll('*'));
          let candidates = [];
          
          // 복구 이메일 관련 요소 찾기
          for (const element of allElements) {
            const text = (element.textContent || '').toLowerCase();
            const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
            
            // 복구 이메일 관련 텍스트 포함 확인
            const isRecoveryRelated = 
              text.includes(recoveryEmail.toLowerCase()) ||
              text.includes('복구') ||
              text.includes('recovery') ||
              text.includes('이메일 확인') ||
              text.includes('confirm your recovery') ||
              ariaLabel.includes('복구') ||
              ariaLabel.includes('recovery');
            
            if (isRecoveryRelated) {
              // 클릭 가능한 요소 또는 그 부모 찾기
              let clickableElement = element;
              let parent = element.parentElement;
              let depth = 0;
              
              while (parent && depth < 5) {
                if (parent.getAttribute('role') === 'link' ||
                    parent.getAttribute('role') === 'button' ||
                    parent.tagName === 'BUTTON' ||
                    parent.tagName === 'A' ||
                    parent.onclick ||
                    parent.style.cursor === 'pointer') {
                  clickableElement = parent;
                  break;
                }
                parent = parent.parentElement;
                depth++;
              }
              
              candidates.push({
                element: clickableElement,
                text: text.substring(0, 100),
                priority: text.includes(recoveryEmail.toLowerCase()) ? 1 : 2
              });
            }
          }
          
          // 우선순위 정렬
          candidates.sort((a, b) => a.priority - b.priority);
          
          // 클릭 시도
          for (const candidate of candidates) {
            try {
              // 여러 클릭 방법 시도
              candidate.element.click();
              
              // 클릭이 안 되면 이벤트 직접 발생
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              candidate.element.dispatchEvent(clickEvent);
              
              console.log('[Recovery] 클릭 성공:', candidate.text.substring(0, 50));
              return { success: true, clicked: candidate.text };
            } catch (e) {
              console.log('[Recovery] 클릭 실패, 다음 후보 시도...');
            }
          }
          
          // 마지막 시도: 첫 번째 옵션 클릭
          if (attemptNum === 3) {
            const anyOption = document.querySelector('[role="link"], [role="button"], div[jsname]');
            if (anyOption) {
              anyOption.click();
              console.log('[Recovery] 마지막 시도 - 첫 번째 옵션 클릭');
              return { success: true, clicked: 'first_available_option' };
            }
          }
          
          return { success: false };
        }, credentials.recoveryEmail, attempt);
        
        if (result.success) {
          this.log(`✅ JavaScript 클릭 성공 (시도 ${attempt}): ${result.clicked}`, 'success');
          clickSuccess = true;
          break;
        }
      }
      
      // 클릭 후 페이지 변화 확인
      if (clickSuccess) {
        await new Promise(r => setTimeout(r, 2000));
        const currentUrl = page.url();
        
        // URL이 변경되었는지 확인
        if (!currentUrl.includes('/challenge/selection')) {
          this.log('✅ 페이지 전환 확인', 'success');
          break;
        } else {
          this.log(`⚠️ 페이지가 변경되지 않음, 재시도...`, 'warning');
          clickSuccess = false;
          // 다시 시도하기 전 대기
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        }
      } else {
        // 실패 시 대기 후 재시도
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      }
    }
    
    // 최종 결과 처리
    let result = { success: clickSuccess };
    
    if (result.success) {
      this.log(`✅ 복구 옵션 클릭: ${result.clicked}`, 'success');
      await new Promise(r => setTimeout(r, 5000)); // 페이지 로드 대기
      
      // 클릭 후 페이지 변화 확인
      const currentUrl = page.url();
      this.log(`클릭 후 URL: ${currentUrl}`, 'debug');
      
      // 복구 이메일 입력 페이지로 이동했는지 확인
      if (currentUrl.includes('challenge/') && !currentUrl.includes('/challenge/selection')) {
        this.log('📧 복구 이메일 입력 페이지로 이동', 'info');
        
        // 복구 이메일 입력 필드 찾기
        try {
          // 여러 선택자 시도
          const emailSelectors = [
            'input[type="email"]:not([aria-hidden="true"])',
            'input[type="text"]:not([aria-hidden="true"])',
            'input[name="knowledgePreregisteredEmailResponse"]',
            'input[aria-label*="이메일"]',
            'input[aria-label*="email"]'
          ];
          
          let emailInput = null;
          for (const selector of emailSelectors) {
            emailInput = await page.$(selector);
            if (emailInput) {
              const isVisible = await emailInput.evaluate(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              if (isVisible) break;
            }
          }
          
          if (emailInput) {
            // 복구 이메일이 있으면 사용, 없을 때만 로그인 이메일 사용
            const recoveryEmail = credentials.recoveryEmail || credentials.email;
            
            // 복구 이메일과 로그인 이메일이 다른 경우 로그 출력
            if (credentials.recoveryEmail && credentials.recoveryEmail !== credentials.email) {
              this.log(`📧 복구 이메일 사용 (C열): ${recoveryEmail}`, 'info');
            }
            
            await emailInput.click();
            await page.keyboard.type(recoveryEmail, { delay: 100 });
            this.log(`✅ 복구 이메일 입력 완료: ${recoveryEmail}`, 'success');
            
            // 확인 버튼 클릭 또는 Enter 키
            const nextButton = await page.$('#passwordNext button, button[jsname="LgbsSe"], button[type="submit"]');
            if (nextButton) {
              await nextButton.click();
            } else {
              await page.keyboard.press('Enter');
            }
            
            await new Promise(r => setTimeout(r, 5000));
          } else {
            this.log('⚠️ 복구 이메일 입력 필드를 찾을 수 없음', 'warning');
          }
        } catch (e) {
          this.log(`복구 이메일 입력 오류: ${e.message}`, 'warning');
        }
      }
      
      // 로그인 성공 여부 확인 (개선된 방법)
      const loginSuccess = await this.verifyLoginStatus(page);
      return { success: loginSuccess, message: loginSuccess ? '로그인 성공' : '추가 확인 필요' };
      
    } else {
      this.log('⚠️ 복구 옵션 클릭 실패', 'warning');
      return { success: false, message: '복구 옵션을 찾을 수 없음' };
    }
    
  } catch (error) {
    this.log(`복구 이메일 처리 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 로그인 상태 확인 (재시도 로직 포함 개선된 버전)
 */
ImprovedAuthenticationService.prototype.verifyLoginStatus = async function(page) {
  this.log('🔍 로그인 상태 확인 중...', 'info');
  
  // 최대 재시도 횟수 설정
  const maxRetries = 5;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      // 재시도 중인 경우 로그 출력
      if (retryCount > 0) {
        this.log(`🔄 로그인 상태 재확인 시도 ${retryCount + 1}/${maxRetries}`, 'info');
        // 재시도 전 대기 (점진적으로 증가)
        await new Promise(r => setTimeout(r, 2000 * retryCount));
      }
      
      // 현재 URL 확인
      const currentUrl = page.url();
      
      // 이미 로그인 완료 페이지인지 확인
      if (currentUrl.includes('myaccount.google.com') || 
          currentUrl.includes('/ManageAccount')) {
        this.log('✅ 이미 로그인 완료 페이지', 'success');
        return true;
      }
      
      // accounts.google.com으로 이동하여 확인
      this.log('📍 accounts.google.com으로 이동하여 로그인 확인', 'info');
      
      try {
        await page.goto('https://accounts.google.com', {
          waitUntil: 'networkidle2',
          timeout: 15000
        });
      } catch (navError) {
        // 네트워크 오류 처리
        if (navError.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
            navError.message.includes('ERR_NETWORK_CHANGED') ||
            navError.message.includes('ERR_NAME_NOT_RESOLVED') ||
            navError.message.includes('ERR_CONNECTION_RESET')) {
          this.log(`⚠️ 네트워크 오류 발생: ${navError.message}`, 'warning');
          lastError = navError;
          retryCount++;
          continue; // 재시도
        }
        throw navError; // 다른 오류는 그대로 발생
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
      // 이동 후 URL 확인
      const finalUrl = page.url();
      this.log(`최종 URL: ${finalUrl}`, 'debug');
      
      // 로그인 페이지로 리다이렉트되었는지 확인
      if (finalUrl.includes('/signin/') || 
          finalUrl.includes('/identifier') ||
          finalUrl.includes('/challenge/')) {
        // 첫 시도에서만 실패로 간주, 재시도 시에는 계속 확인
        if (retryCount === 0) {
          this.log('⚠️ 로그인 페이지로 리다이렉트됨 - 재확인 필요', 'warning');
          retryCount++;
          continue;
        }
        // 여러 번 시도 후에도 로그인 페이지면 실패
        if (retryCount >= 2) {
          this.log('❌ 로그인 페이지로 리다이렉트됨 - 로그인 실패', 'error');
          return false;
        }
      }
      
      // 로그인 완료 페이지인지 확인
      if (finalUrl.includes('myaccount.google.com') || 
          finalUrl.includes('/ManageAccount')) {
        this.log('✅ 로그인 완료 확인', 'success');
        return true;
      }
      
      // DOM에서 로그인 상태 확인
      let isLoggedIn = false;
      try {
        isLoggedIn = await page.evaluate(() => {
          // 프로필 이미지나 계정 정보가 있는지 확인
          const hasProfile = document.querySelector('[data-email]') !== null ||
                            document.querySelector('img[aria-label*="Account"]') !== null ||
                            document.querySelector('a[aria-label*="Google Account"]') !== null ||
                            document.querySelector('[aria-label*="계정"]') !== null;
          
          // 로그인 양식이 있는지 확인
          const hasLoginForm = document.querySelector('input[type="email"]') !== null ||
                               document.querySelector('input[type="password"]') !== null ||
                               document.querySelector('#identifierId') !== null;
          
          // 오류 페이지인지 확인
          const isErrorPage = document.body?.textContent?.includes('ERR_') || 
                             document.title?.includes('Error') ||
                             document.title?.includes('오류');
          
          // 오류 페이지가 아니고 프로필이 있으면 로그인 성공
          if (isErrorPage) {
            console.log('[Login Check] 오류 페이지 감지');
            return null; // null은 재시도 필요를 의미
          }
          
          return hasProfile && !hasLoginForm;
        });
      } catch (evalError) {
        this.log(`DOM 평가 오류: ${evalError.message}`, 'warning');
        lastError = evalError;
        retryCount++;
        continue;
      }
      
      // null이면 오류 페이지이므로 재시도
      if (isLoggedIn === null) {
        this.log('⚠️ 오류 페이지 감지 - 재시도 필요', 'warning');
        retryCount++;
        continue;
      }
      
      if (isLoggedIn) {
        this.log('✅ DOM 확인 - 로그인 성공', 'success');
        return true;
      } else {
        // 첫 시도에서 실패하면 재시도
        if (retryCount < 2) {
          this.log('⚠️ DOM 확인 - 로그인 상태 불확실, 재시도', 'warning');
          retryCount++;
          continue;
        }
        this.log('❌ DOM 확인 - 로그인 실패', 'error');
        return false;
      }
      
    } catch (error) {
      lastError = error;
      this.log(`로그인 상태 확인 오류 (시도 ${retryCount + 1}): ${error.message}`, 'error');
      
      // 네트워크 관련 오류면 재시도
      if (error.message.includes('ERR_') || 
          error.message.includes('Navigation') ||
          error.message.includes('timeout')) {
        retryCount++;
        if (retryCount < maxRetries) {
          this.log('⚠️ 네트워크 오류로 인한 재시도', 'warning');
          continue;
        }
      } else {
        // 다른 오류는 즉시 실패 반환
        return false;
      }
    }
  }
  
  // 모든 재시도 실패
  this.log(`❌ 로그인 상태 확인 실패 - ${maxRetries}번 시도 후 포기`, 'error');
  if (lastError) {
    this.log(`마지막 오류: ${lastError.message}`, 'error');
  }
  return false;
};

/**
 * 2단계 인증 TOTP 처리 (개선된 버전)
 */
ImprovedAuthenticationService.prototype.handle2FATotp = async function(page, credentials) {
  this.log('🔐 2단계 인증 (TOTP) 페이지 처리', 'info');
  
  try {
    // TOTP 시크릿 확인
    const totpSecret = credentials.totpSecret || credentials.code;
    if (!totpSecret) {
      this.log('❌ TOTP 시크릿이 없습니다', 'error');
      return { success: false, error: 'TOTP 시크릿 없음' };
    }
    
    // 공백 제거 및 대문자 변환
    const cleanSecret = totpSecret.replace(/\s+/g, '').toUpperCase();
    
    // TOTP 코드 생성
    const token = speakeasy.totp({
      secret: cleanSecret,
      encoding: 'base32'
    });
    
    this.log(`📱 TOTP 코드 생성: ${token}`, 'info');
    
    // 입력 필드 찾기
    const totpInput = await page.waitForSelector(
      'input[type="tel"], input[name="totpPin"], #totpPin, input[aria-label*="code"]',
      { timeout: 5000 }
    );
    
    if (totpInput) {
      await totpInput.click();
      await new Promise(r => setTimeout(r, 500));
      
      // 기존 값 삭제
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      
      // TOTP 코드 입력
      for (const digit of token) {
        await page.keyboard.type(digit);
        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
      }
      
      this.log('✅ TOTP 코드 입력 완료', 'success');
      
      // Enter 키 또는 다음 버튼
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 5000));
      
      // 로그인 성공 확인
      const loginSuccess = await this.verifyLoginStatus(page);
      return { success: loginSuccess };
    }
    
    return { success: false, error: 'TOTP 입력 필드를 찾을 수 없음' };
    
  } catch (error) {
    this.log(`2FA 처리 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 전체 인증 플로우 처리 (이메일 → 비밀번호 → 2FA → 완료)
 */
ImprovedAuthenticationService.prototype.handleAuthentication = async function(page, credentials, options = {}) {
  this.log('🔐 인증 시작', 'info');
  
  try {
    let maxAttempts = 10; // 최대 단계 수
    let currentAttempt = 0;
    let isAuthenticated = false;
    
    while (currentAttempt < maxAttempts && !isAuthenticated) {
      currentAttempt++;
      
      // 현재 페이지 타입 확인
      const pageType = await this.detectPageType(page);
      this.log(`단계 ${currentAttempt}: ${pageType}`, 'info');
      
      // 페이지 타입에 따른 처리
      switch (pageType) {
        case 'email_input':
          // 이메일 입력
          const emailResult = await this.handleEmailLogin(page, credentials, options);
          if (!emailResult.success) {
            return emailResult;
          }
          await new Promise(r => setTimeout(r, 3000));
          break;
          
        case 'password_input':
          // 비밀번호 입력
          const pwdResult = await this.handlePasswordLogin(page, credentials, options);
          if (!pwdResult.success) {
            return pwdResult;
          }
          await new Promise(r => setTimeout(r, 3000));
          break;
          
        case 'recovery_selection':
          // 복구 이메일 선택
          const recoveryResult = await this.handleRecoverySelection(page, credentials);
          if (!recoveryResult.success) {
            return recoveryResult;
          }
          await new Promise(r => setTimeout(r, 3000));
          break;
          
        case 'phone_verification':
          // 전화번호 인증 필요 - 건너뛰기
          this.log('📱 전화번호 인증 페이지 감지됨', 'warning');
          return { 
            success: false, 
            error: 'PHONE_VERIFICATION_REQUIRED',
            message: '번호인증 필요',
            status: 'phone_verification_required',
            skipRetry: true  // 재시도 방지
          };
          
        case 'two_factor_totp':
          // 2FA TOTP 처리
          const totpResult = await this.handle2FATotp(page, credentials);
          if (!totpResult.success) {
            return totpResult;
          }
          await new Promise(r => setTimeout(r, 3000));
          break;
          
        case 'logged_in':
          // 로그인 완료
          this.log('✅ 인증 완료', 'success');
          isAuthenticated = true;
          break;
          
        case 'unknown':
          // 알 수 없는 페이지 - 로그인 상태 확인
          const loginStatus = await this.verifyLoginStatus(page);
          if (loginStatus) {
            this.log('✅ 로그인 확인됨', 'success');
            isAuthenticated = true;
          } else {
            this.log('❌ 알 수 없는 페이지 상태', 'error');
            return { 
              success: false, 
              error: 'Unknown page state',
              pageUrl: page.url()
            };
          }
          break;
          
        default:
          this.log(`⚠️ 처리되지 않은 페이지 타입: ${pageType}`, 'warning');
          await new Promise(r => setTimeout(r, 3000));
          break;
      }
      
      // 무한 루프 방지
      if (currentAttempt >= maxAttempts - 1) {
        this.log('❌ 인증 단계 초과', 'error');
        return { 
          success: false, 
          error: 'Too many authentication steps',
          lastPageType: pageType
        };
      }
    }
    
    // 최종 로그인 확인
    if (isAuthenticated) {
      const finalCheck = await this.verifyLoginStatus(page);
      if (finalCheck) {
        return { success: true, message: 'Authentication successful' };
      } else {
        return { success: false, error: 'Final verification failed' };
      }
    }
    
    return { success: false, error: 'Authentication incomplete' };
    
  } catch (error) {
    this.log(`인증 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 이메일 입력 처리
 */
ImprovedAuthenticationService.prototype.handleEmailLogin = async function(page, credentials, options = {}) {
  this.log('📧 이메일 입력 페이지 처리', 'info');
  
  try {
    // 이메일 입력 필드 찾기
    const emailSelectors = [
      'input[type="email"]',
      'input[name="identifier"]',
      '#identifierId',
      'input[aria-label*="이메일"]',
      'input[aria-label*="Email"]',
      'input[autocomplete="username"]'
    ];
    
    let emailInput = null;
    
    // 입력 필드 찾기
    for (const selector of emailSelectors) {
      try {
        emailInput = await page.waitForSelector(selector, {
          visible: true,
          timeout: 3000
        });
        if (emailInput) {
          this.log(`✅ 이메일 필드 발견: ${selector}`, 'debug');
          break;
        }
      } catch (e) {
        // 다음 선택자 시도
      }
    }
    
    if (!emailInput) {
      this.log('❌ 이메일 입력 필드를 찾을 수 없습니다', 'error');
      return { success: false, error: '이메일 입력 필드 없음' };
    }
    
    // 기존 내용 지우기
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    
    // 이메일 입력
    await emailInput.type(credentials.email, { delay: 100 });
    this.log(`📝 이메일 입력: ${credentials.email}`, 'info');
    
    // 다음 버튼 찾기 및 클릭
    await new Promise(r => setTimeout(r, 500));
    
    // 다음 버튼 선택자들
    const nextButtonSelectors = [
      'button[jsname="LgbsSe"]',
      '#identifierNext button',
      'button[type="button"]:has-text("다음")',
      'button[type="button"]:has-text("Next")',
      'div[role="button"][id*="Next"]',
      '#identifierNext'
    ];
    
    let clicked = false;
    
    // CSS 선택자로 시도
    for (const selector of nextButtonSelectors) {
      try {
        // :has-text는 Puppeteer에서 지원하지 않으므로 제외
        if (selector.includes(':has-text')) continue;
        
        const button = await page.$(selector);
        if (button) {
          await button.click();
          this.log(`✅ 다음 버튼 클릭: ${selector}`, 'debug');
          clicked = true;
          break;
        }
      } catch (e) {
        // 다음 선택자 시도
      }
    }
    
    // XPath로 시도
    if (!clicked) {
      const xpaths = [
        '//button[contains(., "다음")]',
        '//button[contains(., "Next")]',
        '//span[contains(., "다음")]/parent::button',
        '//div[@role="button" and contains(., "다음")]'
      ];
      
      for (const xpath of xpaths) {
        try {
          const [button] = await page.$x(xpath);
          if (button) {
            await button.click();
            this.log(`✅ 다음 버튼 클릭 (XPath): ${xpath}`, 'debug');
            clicked = true;
            break;
          }
        } catch (e) {
          // 다음 XPath 시도
        }
      }
    }
    
    // JavaScript로 클릭 시도
    if (!clicked) {
      const jsClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const nextButton = buttons.find(btn => {
          const text = btn.textContent || '';
          return text.includes('다음') || text.includes('Next');
        });
        
        if (nextButton) {
          nextButton.click();
          return true;
        }
        return false;
      });
      
      if (jsClicked) {
        this.log('✅ 다음 버튼 클릭 (JavaScript)', 'debug');
        clicked = true;
      }
    }
    
    if (!clicked) {
      // Enter 키로 시도
      await page.keyboard.press('Enter');
      this.log('⏎ Enter 키 전송', 'debug');
    }
    
    // 페이지 전환 대기
    await new Promise(r => setTimeout(r, 3000));
    
    // 다음 페이지 확인
    const newUrl = page.url();
    this.log(`새 URL: ${newUrl}`, 'debug');
    
    return { success: true };
    
  } catch (error) {
    this.log(`이메일 입력 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
};

/**
 * 비밀번호 로그인 처리 확장 (개선된 버전)
 */
ImprovedAuthenticationService.prototype.handlePasswordLogin = async function(page, credentials, options = {}) {
  this.log('🔑 비밀번호 입력 페이지 처리', 'info');
  
  // 비밀번호 확인
  if (!credentials.password) {
    this.log('❌ 비밀번호가 없습니다', 'error');
    return { success: false, error: '비밀번호 누락' };
  }
  
  try {
    // 비밀번호 입력 필드 찾기 (대기 포함)
    await new Promise(r => setTimeout(r, 2000)); // 페이지 안정화 대기
    
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[name="Passwd"]',
      '#password',
      'input[aria-label*="비밀번호"]',
      'input[aria-label*="password"]',
      'input[autocomplete="current-password"]'
    ];
    
    let passwordInput = null;
    
    // 먼저 waitForSelector로 시도
    try {
      passwordInput = await page.waitForSelector('input[type="password"]', {
        visible: true,
        timeout: 10000
      });
      this.log('✅ 비밀번호 필드 발견 (waitForSelector)', 'debug');
    } catch (e) {
      this.log('waitForSelector 실패, 다른 방법 시도...', 'debug');
      
      // 대안: 각 선택자로 직접 시도
      for (const selector of passwordSelectors) {
        try {
          const elements = await page.$$(selector);
          for (const element of elements) {
            const isVisible = await element.evaluate(el => {
              if (el.offsetParent === null) return false;
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && 
                     rect.height > 0 && 
                     style.display !== 'none' &&
                     style.visibility !== 'hidden' &&
                     style.opacity !== '0';
            });
            
            if (isVisible) {
              passwordInput = element;
              this.log(`✅ 비밀번호 필드 발견: ${selector}`, 'debug');
              break;
            }
          }
          if (passwordInput) break;
        } catch (e) {
          // 다음 선택자 시도
        }
      }
    }
    
    if (!passwordInput) {
      // 마지막 시도: evaluate로 직접 찾기
      const found = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        for (const input of inputs) {
          if (input.type === 'password' && !input.hidden && input.offsetParent !== null) {
            input.style.border = '2px solid red'; // 디버그용
            return true;
          }
        }
        return false;
      });
      
      if (found) {
        passwordInput = await page.$('input[type="password"]');
      }
    }
    
    if (!passwordInput) {
      this.log('❌ 비밀번호 입력 필드를 찾을 수 없습니다', 'error');
      
      // 현재 페이지 정보 로깅
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasPasswordInput: document.querySelector('input[type="password"]') !== null,
          inputCount: document.querySelectorAll('input').length
        };
      });
      this.log(`페이지 정보: ${JSON.stringify(pageInfo)}`, 'debug');
      
      return { success: false, error: '비밀번호 필드 없음' };
    }
    
    // 비밀번호 입력 (사람처럼)
    await passwordInput.click();
    await new Promise(r => setTimeout(r, 500));
    
    // 기존 값 지우기
    await passwordInput.evaluate(el => el.value = '');
    await new Promise(r => setTimeout(r, 300));
    
    // 비밀번호 타이핑 (한 글자씩)
    for (const char of credentials.password) {
      await page.keyboard.type(char);
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    }
    
    this.log('✅ 비밀번호 입력 완료', 'success');
    await new Promise(r => setTimeout(r, 500));
    
    // 다음 버튼 찾기 및 클릭
    const nextButtonSelectors = [
      '#passwordNext',
      'button[type="submit"]',
      'button[jsname="LgbsSe"]',  // Google의 다음 버튼
      'div[id="passwordNext"]',
      'div[role="button"][id="passwordNext"]'
    ];
    
    let nextButton = null;
    for (const selector of nextButtonSelectors) {
      try {
        nextButton = await page.$(selector);
        if (nextButton) {
          const isVisible = await nextButton.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (isVisible) {
            this.log(`✅ 다음 버튼 발견: ${selector}`, 'debug');
            break;
          }
        }
      } catch (e) {
        // 다음 선택자 시도
      }
    }
    
    if (nextButton) {
      await nextButton.click();
      this.log('✅ 다음 버튼 클릭', 'debug');
    } else {
      // 버튼을 찾을 수 없으면 Enter 키 사용
      await page.keyboard.press('Enter');
      this.log('✅ Enter 키 입력', 'debug');
    }
    
    // 페이지 변화 대기
    await new Promise(r => setTimeout(r, 3000));
    
    // 에러 메시지 확인
    const hasError = await page.evaluate(() => {
      const errorMessages = [
        '잘못된 비밀번호',
        'Wrong password',
        '비밀번호가 올바르지 않습니다',
        'incorrect password'
      ];
      const bodyText = document.body?.textContent || '';
      return errorMessages.some(msg => bodyText.toLowerCase().includes(msg.toLowerCase()));
    });
    
    if (hasError) {
      this.log('❌ 잘못된 비밀번호', 'error');
      return { success: false, error: '비밀번호 오류' };
    }
    
    // 성공적으로 입력되었다고 가정
    const result = { success: true };
    
  } catch (error) {
    this.log(`비밀번호 입력 오류: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
  
  // 비밀번호 입력 후 페이지 확인
  await new Promise(r => setTimeout(r, 5000));
  
  // 현재 URL 및 페이지 상태 확인 (디버깅용)
  const currentUrl = page.url();
  const pageTitle = await page.title();
  this.log(`비밀번호 입력 후 URL: ${currentUrl}`, 'info');
  this.log(`페이지 제목: ${pageTitle}`, 'info');
  
  // 페이지 텍스트 수집 (디버깅용)
  const pageBodyText = await page.evaluate(() => {
    const body = document.body;
    if (!body) return '';
    return (body.innerText || body.textContent || '').substring(0, 300);
  }).catch(() => '');
  this.log(`페이지 텍스트 (처음 300자): ${pageBodyText}`, 'debug');
  
  const nextPageType = await this.detectPageType(page);
  this.log(`비밀번호 입력 후 페이지 타입: ${nextPageType}`, 'info');
  
  // 페이지 타입 감지 실패 시 디버깅을 위한 스크린샷
  if (this.config.screenshotEnabled) {
    await this.saveScreenshot(page, `screenshots/after_password_${nextPageType}_${Date.now()}.png`);
  }
  
  // 다음 페이지 타입에 따른 처리
  switch (nextPageType) {
    case 'phone_verification':
      // 전화번호 인증 필요
      this.log('📱 비밀번호 입력 후 전화번호 인증 요구됨', 'warning');
      return { 
        success: false, 
        error: 'PHONE_VERIFICATION_REQUIRED',
        message: '번호인증 필요',
        status: 'phone_verification_required',
        skipRetry: true
      };
      
    case 'recovery_selection':
      // 복구 이메일 선택 페이지
      const recoveryResult = await this.handleRecoverySelection(page, credentials);
      if (!recoveryResult.success) {
        return recoveryResult;
      }
      // 복구 이메일 처리 후 최종 로그인 확인
      const finalLoginCheck = await this.verifyLoginStatus(page);
      return { success: finalLoginCheck };
      
    case 'two_factor_totp':
      // 2단계 인증 페이지
      return await this.handle2FATotp(page, credentials);
      
    case 'logged_in':
      // 로그인 성공
      return { success: true };
      
    default:
      // 추가 확인
      const isLoggedIn = await this.verifyLoginStatus(page);
      return { success: isLoggedIn };
  }
};

/**
 * attemptLogin 메서드 확장
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
    let result;
    let needsFinalVerification = false; // 최종 확인이 필요한지 여부
    
    switch (pageType) {
      case 'recovery_selection':
        result = await this.handleRecoverySelection(page, credentials);
        // 복구 이메일 선택은 중간 단계이므로 최종 확인 불필요
        break;
        
      case 'phone_verification':
        // 전화번호 인증 필요
        this.log('📱 전화번호 인증 페이지 감지됨', 'warning');
        result = { 
          success: false, 
          error: 'PHONE_VERIFICATION_REQUIRED',
          message: '번호인증 필요',
          status: 'phone_verification_required',
          skipRetry: true
        };
        break;
        
      case 'two_factor_totp':
        result = await this.handle2FATotp(page, credentials);
        // 2FA 완료 후에는 최종 확인 필요
        needsFinalVerification = true;
        break;
        
      case 'email_input':
        result = await this.handleEmailLogin(page, credentials, options);
        // 이메일 입력은 첫 단계일 뿐, 최종 확인 불필요
        break;
        
      case 'password_input':
        result = await this.handlePasswordLogin(page, credentials, options);
        // 비밀번호 입력 후 추가 보안 단계가 있을 수 있음
        // 페이지 이동 후 상태 확인 필요
        needsFinalVerification = true;
        break;
        
      case 'logged_in':
        this.log('이미 로그인되어 있습니다', 'success');
        result = { success: true };
        needsFinalVerification = false; // 이미 로그인됨
        break;
        
      default:
        // 원본 메서드 호출
        result = await originalAttemptLogin.call(this, page, credentials, options);
        needsFinalVerification = true;
    }
    
    // 최종 로그인 확인 (필요한 경우에만)
    if (result && result.success && needsFinalVerification) {
      // 페이지 안정화 대기
      await new Promise(r => setTimeout(r, 3000));
      
      const finalCheck = await this.verifyLoginStatus(page);
      if (!finalCheck) {
        this.log('⚠️ 최종 로그인 확인 실패', 'warning');
        result.success = false;
        result.message = '로그인 최종 확인 실패';
      }
    }
    
    return result;
    
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

/**
 * checkLoginStatus 메서드 확장 - 재시도 로직 추가
 */
ImprovedAuthenticationService.prototype.checkLoginStatus = async function(page) {
  this.log('🔍 로그인 상태 확인 (checkLoginStatus)', 'info');
  
  // 최대 재시도 횟수
  const maxRetries = 5;
  let retryCount = 0;
  let lastError = null;
  let lastResult = false;
  
  while (retryCount < maxRetries) {
    try {
      if (retryCount > 0) {
        this.log(`🔄 로그인 상태 재확인 (시도 ${retryCount + 1}/${maxRetries})`, 'info');
        // 재시도 전 대기
        await new Promise(r => setTimeout(r, 2000 + (retryCount * 1000)));
      }
      
      // 원본 checkLoginStatus 호출 시도
      if (originalCheckLoginStatus) {
        try {
          lastResult = await originalCheckLoginStatus.call(this, page);
          
          // 성공하면 바로 반환
          if (lastResult === true) {
            this.log('✅ 로그인 상태 확인 성공', 'success');
            return true;
          }
          
          // 실패했지만 네트워크 오류일 가능성 확인
          const currentUrl = page.url();
          if (currentUrl.includes('ERR_') || currentUrl.includes('error')) {
            this.log('⚠️ 오류 페이지 감지 - 재시도', 'warning');
            retryCount++;
            continue;
          }
          
          // 첫 시도 실패 시 재시도
          if (retryCount === 0) {
            retryCount++;
            continue;
          }
          
          return lastResult;
          
        } catch (error) {
          lastError = error;
          // 네트워크 오류면 재시도
          if (error.message.includes('ERR_') || 
              error.message.includes('Navigation') ||
              error.message.includes('timeout')) {
            this.log(`⚠️ 네트워크 오류: ${error.message}`, 'warning');
            retryCount++;
            continue;
          }
          throw error;
        }
      }
      
      // 원본 메서드가 없으면 verifyLoginStatus 사용
      lastResult = await this.verifyLoginStatus(page);
      
      if (lastResult === true) {
        return true;
      }
      
      // 첫 시도 실패 시 재시도
      if (retryCount === 0) {
        retryCount++;
        continue;
      }
      
      return lastResult;
      
    } catch (error) {
      lastError = error;
      this.log(`로그인 상태 확인 오류: ${error.message}`, 'error');
      
      // 네트워크 오류면 재시도
      if (error.message.includes('ERR_TUNNEL_CONNECTION_FAILED') ||
          error.message.includes('ERR_NETWORK_CHANGED') ||
          error.message.includes('ERR_CONNECTION_RESET') ||
          error.message.includes('Navigation') ||
          error.message.includes('timeout')) {
        retryCount++;
        if (retryCount < maxRetries) {
          continue;
        }
      }
      
      // 다른 오류는 즉시 반환
      return false;
    }
  }
  
  // 모든 재시도 실패
  this.log(`❌ 로그인 상태 확인 실패 - ${maxRetries}번 시도 후 실패`, 'error');
  if (lastError) {
    this.log(`마지막 오류: ${lastError.message}`, 'debug');
  }
  return false;
};

module.exports = ImprovedAuthenticationService;