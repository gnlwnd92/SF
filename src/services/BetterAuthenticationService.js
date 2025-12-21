/**
 * Better Authentication Service
 * 개선된 Google 로그인 처리 서비스
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

class BetterAuthenticationService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.maxRetries = options.maxRetries || 3;
    this.waitTime = options.waitTime || 3000;
  }

  log(message, type = 'info') {
    const prefix = '[BetterAuth]';
    const formattedMessage = `${prefix} ${message}`;
    
    switch(type) {
      case 'success':
        console.log(chalk.green(formattedMessage));
        break;
      case 'error':
        console.log(chalk.red(formattedMessage));
        break;
      case 'warning':
        console.log(chalk.yellow(formattedMessage));
        break;
      default:
        console.log(chalk.cyan(formattedMessage));
    }
  }

  /**
   * 로그인 상태 확인 (더 정확한 방법)
   */
  async checkLoginStatus(page) {
    try {
      const url = page.url();
      
      // 1. Google 로그인 페이지에 있으면 로그인 안됨
      if (url.includes('accounts.google.com')) {
        this.log('Google 로그인 페이지 감지 - 로그인 필요', 'warning');
        return false;
      }
      
      // 2. YouTube에서 구체적인 요소 확인
      if (url.includes('youtube.com')) {
        const loginStatus = await page.evaluate(() => {
          // 로그인 버튼이 있는지 확인
          const hasSignInButton = !!document.querySelector('[aria-label*="Sign in"]') || 
                                  !!document.querySelector('[aria-label*="로그인"]') ||
                                  !!document.querySelector('a[href*="ServiceLogin"]') ||
                                  !!document.querySelector('tp-yt-paper-button#button[aria-label*="Sign in"]');
          
          // 사용자 메뉴가 있는지 확인
          const hasUserMenu = !!document.querySelector('#avatar-btn') ||
                             !!document.querySelector('button[aria-label*="Account"]') ||
                             !!document.querySelector('#avatar') ||
                             !!document.querySelector('button#avatar-btn');
          
          // 페이지 텍스트 확인
          const bodyText = document.body?.innerText || '';
          const needsSignIn = bodyText.includes('Sign in to') || 
                             bodyText.includes('로그인하여') ||
                             bodyText.includes('로그인하세요');
          
          return {
            hasSignInButton,
            hasUserMenu,
            needsSignIn,
            url: window.location.href,
            title: document.title
          };
        });
        
        // 로그인 버튼이 있고 사용자 메뉴가 없으면 로그인 안됨
        if (loginStatus.hasSignInButton && !loginStatus.hasUserMenu) {
          this.log('로그인 버튼 발견, 사용자 메뉴 없음 - 로그인 필요', 'warning');
          return false;
        }
        
        // 로그인하라는 메시지가 있으면 로그인 안됨
        if (loginStatus.needsSignIn) {
          this.log('로그인 필요 메시지 발견 - 로그인 필요', 'warning');
          return false;
        }
        
        // 사용자 메뉴가 있으면 로그인됨
        if (loginStatus.hasUserMenu) {
          this.log('사용자 메뉴 발견 - 로그인 확인', 'success');
          return true;
        }
      }
      
      // 3. 기본값: URL이 YouTube이고 Google 로그인 페이지가 아니면 로그인됨
      const isLoggedIn = url.includes('youtube.com') && !url.includes('accounts.google.com');
      this.log(`로그인 상태: ${isLoggedIn ? '로그인됨' : '로그인 필요'}`, isLoggedIn ? 'success' : 'warning');
      return isLoggedIn;
      
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 완전한 로그인 프로세스
   */
  async performLogin(page, account, options = {}) {
    const startTime = Date.now();
    
    try {
      this.log('🔐 로그인 프로세스 시작', 'info');
      
      let retryCount = 0;
      while (retryCount < this.maxRetries) {
        try {
          // 현재 페이지 상태 확인
          const currentUrl = page.url();
          this.log(`현재 URL: ${currentUrl}`, 'info');
          
          // 1. 계정 선택 페이지 처리
          if (currentUrl.includes('accountchooser')) {
            await this.handleAccountChooser(page, account.email);
            await new Promise(r => setTimeout(r, 5000));
          }
          
          // 2. 이메일 입력 페이지 처리
          else if (await this.needsEmailInput(page)) {
            await this.inputEmail(page, account.email);
            await new Promise(r => setTimeout(r, 3000));
          }
          
          // 3. 비밀번호 입력 페이지 처리
          const passwordNeeded = await this.needsPasswordInput(page);
          if (passwordNeeded) {
            await this.inputPassword(page, account.password);
            await new Promise(r => setTimeout(r, 5000));
          }
          
          // 4. 2단계 인증 처리
          const totpNeeded = await this.needsTOTP(page);
          if (totpNeeded && account.totpSecret) {
            await this.inputTOTP(page, account.totpSecret);
            await new Promise(r => setTimeout(r, 5000));
          }
          
          // 5. Passkey 건너뛰기
          if (await this.hasPasskeyPrompt(page)) {
            await this.skipPasskey(page);
            await new Promise(r => setTimeout(r, 3000));
          }
          
          // 6. 로그인 완료 확인
          const finalUrl = page.url();
          if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
            this.log('✅ 로그인 성공!', 'success');
            return {
              success: true,
              loginTime: Date.now() - startTime
            };
          }
          
          // YouTube Premium 페이지로 직접 이동 시도
          if (!finalUrl.includes('paid_memberships')) {
            this.log('YouTube Premium 페이지로 이동 시도', 'info');
            await page.goto('https://www.youtube.com/paid_memberships', {
              waitUntil: 'networkidle2',
              timeout: 30000
            });
            await new Promise(r => setTimeout(r, 5000));
            
            // 다시 로그인이 필요한지 확인
            const needsLogin = page.url().includes('accounts.google.com');
            if (!needsLogin) {
              this.log('✅ 로그인 성공 (리다이렉트 후)', 'success');
              return {
                success: true,
                loginTime: Date.now() - startTime
              };
            }
          }
          
        } catch (innerError) {
          this.log(`로그인 시도 ${retryCount + 1} 실패: ${innerError.message}`, 'warning');
        }
        
        retryCount++;
        if (retryCount < this.maxRetries) {
          this.log(`재시도 ${retryCount}/${this.maxRetries}...`, 'info');
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      
      // 모든 시도 실패
      this.log('❌ 로그인 실패 - 모든 시도 소진', 'error');
      return {
        success: false,
        reason: 'Max retries exceeded',
        loginTime: Date.now() - startTime
      };
      
    } catch (error) {
      this.log(`❌ 로그인 오류: ${error.message}`, 'error');
      return {
        success: false,
        reason: error.message,
        loginTime: Date.now() - startTime
      };
    }
  }

  /**
   * 계정 선택 페이지 처리
   */
  async handleAccountChooser(page, email) {
    this.log('계정 선택 페이지 처리', 'info');
    
    // 먼저 대상 계정이 있는지 확인
    const hasAccount = await page.evaluate((targetEmail) => {
      const accounts = document.querySelectorAll('[data-identifier]');
      for (const account of accounts) {
        if (account.getAttribute('data-identifier') === targetEmail) {
          return true;
        }
      }
      return false;
    }, email);
    
    if (hasAccount) {
      // 계정 클릭
      this.log(`계정 발견: ${email}`, 'info');
      await page.evaluate((targetEmail) => {
        const accounts = document.querySelectorAll('[data-identifier]');
        for (const account of accounts) {
          if (account.getAttribute('data-identifier') === targetEmail) {
            account.click();
            return true;
          }
        }
        return false;
      }, email);
      
      this.log('계정 클릭 완료', 'success');
      await new Promise(r => setTimeout(r, 3000));
      
      // 비밀번호 입력 페이지로 이동했는지 확인
      const needsPassword = await this.needsPasswordInput(page);
      if (!needsPassword) {
        // 여전히 계정 선택 페이지라면 "로그아웃됨" 상태일 수 있음
        this.log('계정이 로그아웃 상태일 수 있음, 다시 시도', 'warning');
        
        // 계정 다시 클릭
        await page.evaluate((targetEmail) => {
          const accounts = document.querySelectorAll('[data-identifier]');
          for (const account of accounts) {
            if (account.getAttribute('data-identifier') === targetEmail) {
              // 계정 카드 전체를 클릭
              const card = account.closest('li') || account.closest('div[role="link"]') || account;
              if (card) card.click();
              return true;
            }
          }
          return false;
        }, email);
        
        await new Promise(r => setTimeout(r, 5000));
      }
      
    } else {
      // "다른 계정 사용" 클릭
      this.log('계정이 목록에 없음, 다른 계정 사용 클릭', 'info');
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, div, button'));
        for (const link of links) {
          if (link.textContent?.includes('다른 계정') || 
              link.textContent?.includes('Use another')) {
            link.click();
            return true;
          }
        }
        return false;
      });
      
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  /**
   * 이메일 입력 필요 여부 확인
   */
  async needsEmailInput(page) {
    return await page.evaluate(() => {
      return !!document.querySelector('input[type="email"]') ||
             !!document.querySelector('#identifierId');
    });
  }

  /**
   * 이메일 입력
   */
  async inputEmail(page, email) {
    this.log('이메일 입력', 'info');
    
    await page.evaluate((email) => {
      const input = document.querySelector('input[type="email"]') || 
                   document.querySelector('#identifierId');
      if (input) {
        input.value = email;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, email);
    
    await new Promise(r => setTimeout(r, 500));
    
    // Next 버튼 클릭
    await page.evaluate(() => {
      const button = document.querySelector('#identifierNext') ||
                    document.querySelector('button[jsname="LgbsSe"]') ||
                    document.querySelector('div[role="button"][id*="Next"]');
      if (button) button.click();
    });
    
    this.log('이메일 입력 완료', 'success');
  }

  /**
   * 비밀번호 입력 필요 여부 확인
   */
  async needsPasswordInput(page) {
    await new Promise(r => setTimeout(r, 2000)); // 페이지 로드 대기
    
    return await page.evaluate(() => {
      return !!document.querySelector('input[type="password"]') ||
             !!document.querySelector('input[name="password"]') ||
             !!document.querySelector('input[name="Passwd"]');
    });
  }

  /**
   * 비밀번호 입력
   */
  async inputPassword(page, password) {
    this.log('비밀번호 입력', 'info');
    
    // 비밀번호 필드가 나타날 때까지 대기
    await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
    
    await page.evaluate((pwd) => {
      const input = document.querySelector('input[type="password"]') ||
                   document.querySelector('input[name="password"]') ||
                   document.querySelector('input[name="Passwd"]');
      if (input) {
        input.focus();
        input.value = pwd;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, password);
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Next 버튼 클릭
    await page.evaluate(() => {
      const button = document.querySelector('#passwordNext') ||
                    document.querySelector('button[jsname="LgbsSe"]') ||
                    document.querySelector('div[role="button"][id*="Next"]');
      if (button) button.click();
    });
    
    this.log('비밀번호 입력 완료', 'success');
  }

  /**
   * TOTP 필요 여부 확인
   */
  async needsTOTP(page) {
    await new Promise(r => setTimeout(r, 3000));
    
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('2-Step Verification') ||
             bodyText.includes('2단계 인증') ||
             !!document.querySelector('input[type="tel"][maxlength="6"]') ||
             !!document.querySelector('#totpPin');
    });
  }

  /**
   * TOTP 입력
   */
  async inputTOTP(page, totpSecret) {
    this.log('2단계 인증 코드 생성', 'info');
    
    const token = speakeasy.totp({
      secret: totpSecret,
      encoding: 'base32'
    });
    
    this.log(`TOTP 코드: ${token}`, 'info');
    
    // TOTP 입력
    await page.evaluate((code) => {
      const input = document.querySelector('input[type="tel"][maxlength="6"]') ||
                   document.querySelector('#totpPin') ||
                   document.querySelector('input[aria-label*="code"]');
      if (input) {
        input.focus();
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, token);
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Next 버튼 클릭
    await page.evaluate(() => {
      const button = document.querySelector('#totpNext') ||
                    document.querySelector('button[jsname="LgbsSe"]') ||
                    document.querySelector('div[role="button"][id*="Next"]');
      if (button) button.click();
    });
    
    this.log('2단계 인증 완료', 'success');
  }

  /**
   * Passkey 프롬프트 확인
   */
  async hasPasskeyPrompt(page) {
    return await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return bodyText.includes('passkey') ||
             bodyText.includes('Passkey') ||
             bodyText.includes('패스키') ||
             bodyText.includes('Use your passkey');
    });
  }

  /**
   * Passkey 건너뛰기
   */
  async skipPasskey(page) {
    this.log('Passkey 건너뛰기', 'info');
    
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a, button, div[role="button"]'));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || '';
        if (text.includes('try another') || 
            text.includes('다른 방법') ||
            text.includes('skip')) {
          link.click();
          return true;
        }
      }
      return false;
    });
    
    this.log('Passkey 건너뛰기 완료', 'success');
  }
}

module.exports = BetterAuthenticationService;