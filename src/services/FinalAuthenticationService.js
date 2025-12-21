/**
 * 최종 인증 서비스
 * 계정 선택 페이지에서 "다른 계정 사용" 클릭으로 우회
 */

const chalk = require('chalk');

class FinalAuthenticationService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
  }

  log(message, type = 'info') {
    if (!this.debugMode) return;
    
    const prefix = '[FinalAuth]';
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
   * 로그인 상태 확인
   */
  async checkLoginStatus(page) {
    try {
      const currentUrl = page.url();
      
      // 로그인 페이지인지 확인
      if (currentUrl.includes('accounts.google.com')) {
        this.log('로그인이 필요한 상태', 'warning');
        return false;
      }
      
      // YouTube에서 로그인 확인
      if (currentUrl.includes('youtube.com')) {
        const isLoggedIn = await page.evaluate(() => {
          // 아바타 버튼 확인
          const avatarBtn = document.querySelector('#avatar-btn, button#avatar-btn');
          if (avatarBtn) return true;
          
          // 로그인 링크가 없는지 확인
          const signInLink = document.querySelector('a[href*="ServiceLogin"]');
          if (!signInLink) return true;
          
          // 페이지 텍스트 확인
          const pageText = document.body?.innerText || '';
          const hasManageButton = pageText.includes('Manage membership') || 
                                 pageText.includes('구독 관리') ||
                                 pageText.includes('관리');
          if (hasManageButton) return true;
          
          return false;
        });
        
        if (isLoggedIn) {
          this.log('로그인 상태 확인됨', 'success');
        } else {
          this.log('로그인되지 않음', 'warning');
        }
        
        return isLoggedIn;
      }
      
      return true;
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 계정 선택 페이지 처리
   */
  async handleAccountChooser(page, email) {
    try {
      this.log('계정 선택 페이지 처리 시작', 'info');
      
      // 먼저 계정이 있는지 확인
      const accountExists = await page.evaluate((targetEmail) => {
        const accounts = document.querySelectorAll('[data-identifier]');
        for (const account of accounts) {
          if (account.getAttribute('data-identifier') === targetEmail) {
            // 로그아웃된 상태인지 확인
            const parentElement = account.closest('li') || account.parentElement;
            const text = parentElement?.innerText || '';
            return {
              exists: true,
              isLoggedOut: text.includes('로그아웃됨') || text.includes('Signed out')
            };
          }
        }
        return { exists: false };
      }, email);
      
      if (accountExists.exists && accountExists.isLoggedOut) {
        this.log(`${email} 계정이 로그아웃 상태입니다. "다른 계정 사용" 클릭`, 'warning');
      }
      
      // "다른 계정 사용" 버튼 클릭
      const useAnotherClicked = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('li, div, button'));
        for (const elem of elements) {
          const text = elem.textContent?.trim();
          if (text === '다른 계정 사용' || text === 'Use another account' || 
              text === '다른 계정 추가' || text === 'Add another account') {
            elem.click();
            return true;
          }
        }
        return false;
      });
      
      if (useAnotherClicked) {
        this.log('"다른 계정 사용" 클릭 성공', 'success');
        await new Promise(r => setTimeout(r, 2000));
        return true;
      } else {
        this.log('"다른 계정 사용" 버튼을 찾을 수 없음', 'error');
        return false;
      }
      
    } catch (error) {
      this.log(`계정 선택 페이지 처리 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 이메일 입력
   */
  async inputEmail(page, email) {
    try {
      this.log('이메일 입력 시작', 'info');
      
      // 이메일 입력 필드 대기
      await page.waitForSelector('input[type="email"], input#identifierId', { 
        visible: true, 
        timeout: 10000 
      });
      
      // 이메일 입력
      const emailInput = await page.$('input[type="email"]') || await page.$('#identifierId');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email, { delay: 100 });
        this.log(`이메일 입력: ${email}`, 'success');
        
        // 다음 버튼 클릭
        const nextClicked = await page.evaluate(() => {
          const nextBtn = document.querySelector('#identifierNext') || 
                         document.querySelector('button[jsname="LgbsSe"]');
          if (nextBtn) {
            nextBtn.click();
            return true;
          }
          return false;
        });
        
        if (nextClicked) {
          this.log('다음 버튼 클릭 성공', 'success');
        } else {
          // Enter 키로 시도
          await page.keyboard.press('Enter');
          this.log('Enter 키로 진행', 'info');
        }
        
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`이메일 입력 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 비밀번호 입력
   */
  async inputPassword(page, password) {
    try {
      this.log('비밀번호 입력 시작', 'info');
      
      // 비밀번호 필드 대기
      await page.waitForSelector('input[type="password"]', { 
        visible: true, 
        timeout: 10000 
      });
      
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.type(password, { delay: 100 });
        this.log('비밀번호 입력 완료', 'success');
        
        // 다음 버튼 클릭
        const nextClicked = await page.evaluate(() => {
          const nextBtn = document.querySelector('#passwordNext') || 
                         document.querySelector('button[jsname="LgbsSe"]');
          if (nextBtn) {
            nextBtn.click();
            return true;
          }
          return false;
        });
        
        if (nextClicked) {
          this.log('다음 버튼 클릭 성공', 'success');
        } else {
          // Enter 키로 시도
          await page.keyboard.press('Enter');
          this.log('Enter 키로 진행', 'info');
        }
        
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`비밀번호 입력 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 통합 로그인 프로세스
   */
  async performLogin(page, credentials) {
    try {
      this.log('🔐 로그인 프로세스 시작', 'info');
      
      const currentUrl = page.url();
      
      // 1. 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        await this.handleAccountChooser(page, credentials.email);
      }
      
      // 2. 이메일 입력
      const hasEmailField = await page.$('input[type="email"], input#identifierId');
      if (hasEmailField) {
        await this.inputEmail(page, credentials.email);
      }
      
      // 3. 비밀번호 입력
      const hasPasswordField = await page.$('input[type="password"]');
      if (hasPasswordField) {
        await this.inputPassword(page, credentials.password);
      }
      
      // 4. 로그인 완료 대기
      await new Promise(r => setTimeout(r, 5000));
      
      // 5. 최종 상태 확인
      const finalUrl = page.url();
      if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
        this.log('✅ 로그인 성공!', 'success');
        
        // YouTube Premium 페이지로 이동
        if (!finalUrl.includes('paid_memberships')) {
          await page.goto('https://www.youtube.com/paid_memberships', {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
        }
        
        return { success: true };
      }
      
      // 6. 패스키 건너뛰기 처리
      if (finalUrl.includes('passkeys') || finalUrl.includes('passwordless')) {
        this.log('패스키 등록 건너뛰기', 'warning');
        const skipClicked = await page.evaluate(() => {
          const skipBtn = Array.from(document.querySelectorAll('button')).find(btn => 
            btn.textContent?.includes('나중에') || 
            btn.textContent?.includes('Skip') ||
            btn.textContent?.includes('Not now')
          );
          if (skipBtn) {
            skipBtn.click();
            return true;
          }
          return false;
        });
        
        if (skipClicked) {
          await new Promise(r => setTimeout(r, 3000));
          return { success: true };
        }
      }
      
      return { success: false, reason: 'Login incomplete' };
      
    } catch (error) {
      this.log(`❌ 로그인 실패: ${error.message}`, 'error');
      return { success: false, reason: error.message };
    }
  }
}

module.exports = FinalAuthenticationService;