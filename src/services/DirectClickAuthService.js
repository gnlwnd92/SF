/**
 * Direct Click Authentication Service
 * Puppeteer 네이티브 API를 사용한 직접적인 클릭 처리
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

class DirectClickAuthService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.maxRetries = options.maxRetries || 3;
  }

  log(message, type = 'info') {
    const prefix = '[DirectAuth]';
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
   * 로그인 상태 확인 - 엄격한 기준 적용
   */
  async checkLoginStatus(page) {
    try {
      const url = page.url();
      
      // Google 계정 페이지는 무조건 로그인 필요
      if (url.includes('accounts.google.com')) {
        this.log('Google 계정 페이지 감지 - 로그인 필요', 'warning');
        return false;
      }
      
      // YouTube Premium 페이지에서 콘텐츠 확인
      if (url.includes('youtube.com/paid_memberships')) {
        const hasContent = await page.evaluate(() => {
          const text = document.body?.innerText || '';
          // 로그인 버튼이 있으면 로그인 안됨
          if (text.includes('Sign in') || text.includes('로그인')) {
            return false;
          }
          // Premium 관련 콘텐츠가 있으면 로그인됨
          return text.includes('YouTube Premium') || 
                 text.includes('YouTube 프리미엄') ||
                 text.includes('Manage membership') ||
                 text.includes('구독 관리');
        });
        
        if (hasContent) {
          this.log('YouTube Premium 콘텐츠 확인 - 로그인됨', 'success');
          return true;
        }
      }
      
      // YouTube 일반 페이지에서 사용자 메뉴 확인
      if (url.includes('youtube.com')) {
        const hasUserMenu = await page.evaluate(() => {
          // 아바타 버튼이나 계정 메뉴가 있으면 로그인됨
          return !!document.querySelector('#avatar-btn') ||
                 !!document.querySelector('button[aria-label*="Account"]') ||
                 !!document.querySelector('ytd-topbar-menu-button-renderer');
        });
        
        if (hasUserMenu) {
          this.log('사용자 메뉴 확인 - 로그인됨', 'success');
          return true;
        }
      }
      
      this.log('로그인 상태 확인 불가 - 로그인 필요로 간주', 'warning');
      return false;
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 계정 선택 페이지에서 직접 클릭
   */
  async handleAccountChooserDirect(page, email, password) {
    this.log('계정 선택 페이지 직접 처리 시작', 'info');
    
    try {
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 3000));
      
      // 계정 찾기 - XPath 사용
      const accountXPath = `//div[@data-identifier="${email}"]`;
      await page.waitForXPath(accountXPath, { timeout: 10000 }).catch(() => {
        this.log('XPath로 계정을 찾을 수 없음', 'warning');
      });
      
      // 계정 정보 수집
      const accountInfo = await page.evaluate((targetEmail) => {
        const elements = document.querySelectorAll('[data-identifier]');
        for (const element of elements) {
          if (element.getAttribute('data-identifier') === targetEmail) {
            const rect = element.getBoundingClientRect();
            const parent = element.closest('li') || element.closest('[role="link"]');
            const parentRect = parent ? parent.getBoundingClientRect() : rect;
            
            // 텍스트 내용 확인
            const text = parent ? parent.innerText : '';
            const isLoggedOut = text.includes('로그아웃됨') || text.includes('Signed out');
            
            return {
              found: true,
              isLoggedOut,
              elementRect: {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2
              },
              parentRect: {
                x: parentRect.x + parentRect.width / 2,
                y: parentRect.y + parentRect.height / 2
              }
            };
          }
        }
        return { found: false };
      }, email);
      
      if (!accountInfo.found) {
        this.log('계정을 찾을 수 없음 - 다른 계정 사용', 'warning');
        return await this.useAnotherAccount(page, email, password);
      }
      
      this.log(`계정 발견: ${email} (${accountInfo.isLoggedOut ? '로그아웃됨' : '로그인됨'})`, 'info');
      
      if (accountInfo.isLoggedOut) {
        this.log('로그아웃된 계정 - Puppeteer 네이티브 클릭 시도', 'warning');
        
        // 방법 1: 부모 요소 직접 클릭
        try {
          await page.mouse.click(accountInfo.parentRect.x, accountInfo.parentRect.y);
          this.log('부모 요소 클릭 완료', 'success');
        } catch (err) {
          this.log('부모 클릭 실패, 요소 직접 클릭 시도', 'warning');
          await page.mouse.click(accountInfo.elementRect.x, accountInfo.elementRect.y);
        }
        
        // 클릭 후 대기
        await new Promise(r => setTimeout(r, 3000));
        
        // 페이지 전환 확인
        const currentUrl = page.url();
        const hasPasswordField = await page.evaluate(() => {
          return !!document.querySelector('input[type="password"]');
        });
        
        if (hasPasswordField || currentUrl.includes('/signin/v2/challenge/pwd')) {
          this.log('비밀번호 페이지로 전환 성공!', 'success');
          return await this.inputPassword(page, password);
        }
        
        // 전환 실패 시 방법 2: 요소 handle로 클릭
        this.log('페이지 전환 실패 - ElementHandle 클릭 시도', 'warning');
        const elementHandle = await page.$(`[data-identifier="${email}"]`);
        if (elementHandle) {
          const parentHandle = await page.evaluateHandle(el => {
            return el.closest('li') || el.closest('[role="link"]') || el;
          }, elementHandle);
          
          await parentHandle.click();
          await new Promise(r => setTimeout(r, 3000));
          
          // 다시 확인
          const hasPasswordNow = await page.evaluate(() => {
            return !!document.querySelector('input[type="password"]');
          });
          
          if (hasPasswordNow) {
            this.log('비밀번호 페이지로 전환 성공! (2차 시도)', 'success');
            return await this.inputPassword(page, password);
          }
        }
        
        // 모든 시도 실패 - 다른 계정 사용
        this.log('계정 클릭 모든 시도 실패 - 다른 계정 사용', 'error');
        return await this.useAnotherAccount(page, email, password);
        
      } else {
        // 이미 로그인된 계정 클릭
        this.log('이미 로그인된 계정 클릭', 'info');
        const elementHandle = await page.$(`[data-identifier="${email}"]`);
        if (elementHandle) {
          await elementHandle.click();
          await new Promise(r => setTimeout(r, 3000));
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.log(`계정 선택 처리 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * "다른 계정 사용" 옵션으로 로그인
   */
  async useAnotherAccount(page, email, password) {
    this.log('"다른 계정 사용" 옵션 시도', 'info');
    
    try {
      // "다른 계정 사용" 링크 클릭
      const clicked = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('div, a, button'));
        for (const element of elements) {
          const text = element.textContent || '';
          if (text.includes('다른 계정 사용') || text.includes('Use another account')) {
            element.click();
            return true;
          }
        }
        return false;
      });
      
      if (!clicked) {
        // 링크를 못 찾으면 XPath로 시도
        const xpaths = [
          "//div[contains(text(), '다른 계정')]",
          "//a[contains(text(), 'Use another')]",
          "//button[contains(text(), '다른')]"
        ];
        
        for (const xpath of xpaths) {
          const [element] = await page.$x(xpath);
          if (element) {
            await element.click();
            this.log('"다른 계정 사용" 클릭 (XPath)', 'success');
            break;
          }
        }
      } else {
        this.log('"다른 계정 사용" 클릭 완료', 'success');
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      // 이메일 입력
      await this.inputEmail(page, email);
      await new Promise(r => setTimeout(r, 3000));
      
      // 비밀번호 입력
      await this.inputPassword(page, password);
      
      return true;
    } catch (error) {
      this.log(`"다른 계정 사용" 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 이메일 입력
   */
  async inputEmail(page, email) {
    this.log('이메일 입력 시작', 'info');
    
    try {
      // 이메일 필드 대기
      await page.waitForSelector('input[type="email"], #identifierId', { timeout: 10000 });
      
      const emailInput = await page.$('input[type="email"]') || await page.$('#identifierId');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 }); // 전체 선택
        await emailInput.type(email, { delay: 50 });
        this.log(`이메일 입력: ${email}`, 'success');
        
        // Next 버튼 클릭
        const nextButton = await page.$('#identifierNext') || 
                          await page.$('button[jsname="LgbsSe"]');
        if (nextButton) {
          await nextButton.click();
          this.log('Next 버튼 클릭 완료', 'success');
        }
        
        return true;
      }
    } catch (error) {
      this.log(`이메일 입력 실패: ${error.message}`, 'error');
    }
    
    return false;
  }

  /**
   * 비밀번호 입력
   */
  async inputPassword(page, password) {
    this.log('비밀번호 입력 시작', 'info');
    
    try {
      // 비밀번호 필드 대기
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 }); // 전체 선택
        await passwordInput.type(password, { delay: 50 });
        this.log('비밀번호 입력 완료', 'success');
        
        // Next 버튼 클릭
        const nextButton = await page.$('#passwordNext') || 
                          await page.$('button[jsname="LgbsSe"]');
        if (nextButton) {
          await nextButton.click();
          this.log('Next 버튼 클릭 완료', 'success');
        }
        
        return true;
      }
    } catch (error) {
      this.log(`비밀번호 입력 실패: ${error.message}`, 'error');
    }
    
    return false;
  }

  /**
   * TOTP 2단계 인증 처리
   */
  async handleTOTP(page, totpSecret) {
    this.log('2단계 인증 처리 시작', 'info');
    
    try {
      // TOTP 코드 생성
      const token = speakeasy.totp({
        secret: totpSecret,
        encoding: 'base32'
      });
      
      this.log(`TOTP 코드 생성: ${token}`, 'info');
      
      // TOTP 입력 필드 대기
      await page.waitForSelector('input[type="tel"][maxlength="6"], #totpPin', { timeout: 10000 });
      
      const totpInput = await page.$('input[type="tel"][maxlength="6"]') || await page.$('#totpPin');
      if (totpInput) {
        await totpInput.click({ clickCount: 3 });
        await totpInput.type(token, { delay: 50 });
        this.log('TOTP 코드 입력 완료', 'success');
        
        // Next 버튼 클릭
        const nextButton = await page.$('#totpNext') || 
                          await page.$('button[jsname="LgbsSe"]');
        if (nextButton) {
          await nextButton.click();
          this.log('인증 버튼 클릭 완료', 'success');
        }
        
        return true;
      }
    } catch (error) {
      this.log(`TOTP 처리 실패: ${error.message}`, 'error');
    }
    
    return false;
  }

  /**
   * 통합 로그인 프로세스
   */
  async performLogin(page, account) {
    const startTime = Date.now();
    
    try {
      this.log('🔐 직접 클릭 로그인 프로세스 시작', 'info');
      
      const currentUrl = page.url();
      
      // 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser') || currentUrl.includes('accounts.google.com')) {
        const success = await this.handleAccountChooserDirect(page, account.email, account.password);
        
        if (success) {
          await new Promise(r => setTimeout(r, 5000));
          
          // 2단계 인증 필요 여부 확인
          const needsTOTP = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            return text.includes('2-Step Verification') || 
                   text.includes('2단계 인증') ||
                   !!document.querySelector('input[type="tel"][maxlength="6"]');
          });
          
          if (needsTOTP && account.totpSecret) {
            await this.handleTOTP(page, account.totpSecret);
            await new Promise(r => setTimeout(r, 5000));
          }
          
          // 최종 확인
          const finalUrl = page.url();
          if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
            this.log('✅ 로그인 성공!', 'success');
            return {
              success: true,
              loginTime: Date.now() - startTime
            };
          }
        }
      }
      
      // 이메일 입력 페이지
      if (currentUrl.includes('/signin/v2/identifier')) {
        await this.inputEmail(page, account.email);
        await new Promise(r => setTimeout(r, 3000));
        await this.inputPassword(page, account.password);
        await new Promise(r => setTimeout(r, 5000));
        
        // 2단계 인증 확인
        const needsTOTP = await page.evaluate(() => {
          return !!document.querySelector('input[type="tel"][maxlength="6"]');
        });
        
        if (needsTOTP && account.totpSecret) {
          await this.handleTOTP(page, account.totpSecret);
          await new Promise(r => setTimeout(r, 5000));
        }
        
        const finalUrl = page.url();
        if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
          this.log('✅ 로그인 성공!', 'success');
          return {
            success: true,
            loginTime: Date.now() - startTime
          };
        }
      }
      
      // 로그인 실패
      this.log('❌ 로그인 실패', 'error');
      return {
        success: false,
        reason: 'Login failed after all attempts',
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
}

module.exports = DirectClickAuthService;