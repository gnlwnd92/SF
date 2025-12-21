/**
 * Google Login Bypass Service
 * 계정 선택 페이지 클릭 문제를 우회하는 다양한 방법 구현
 */

const chalk = require('chalk');

class GoogleLoginBypassService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
  }

  log(message, type = 'info') {
    if (!this.debugMode) return;
    
    const prefix = '[LoginBypass]';
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
   * 방법 1: URL 직접 조작으로 로그인 페이지 이동
   */
  async bypassWithDirectURL(page, email) {
    try {
      this.log(`URL 직접 조작 시도: ${email}`, 'info');
      
      // 현재 URL 파싱
      const currentUrl = page.url();
      const url = new URL(currentUrl);
      
      // Google 로그인 URL 생성
      const loginUrl = new URL('https://accounts.google.com/signin/v2/identifier');
      
      // 기존 파라미터 복사
      url.searchParams.forEach((value, key) => {
        if (key !== 'email' && key !== 'flowEntry') {
          loginUrl.searchParams.set(key, value);
        }
      });
      
      // 이메일 힌트 추가
      loginUrl.searchParams.set('flowEntry', 'ServiceLogin');
      loginUrl.searchParams.set('Email', email);
      loginUrl.searchParams.set('identifierid', email);
      
      this.log(`생성된 URL: ${loginUrl.toString().substring(0, 100)}...`, 'info');
      
      // 페이지 이동
      await page.goto(loginUrl.toString(), {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // 이메일 입력 필드 확인
      const hasEmailField = await page.evaluate(() => {
        return !!document.querySelector('input[type="email"]') || 
               !!document.querySelector('#identifierId');
      });
      
      if (hasEmailField) {
        this.log('이메일 입력 페이지로 이동 성공', 'success');
        
        // 이메일 자동 입력
        const emailInput = await page.$('input[type="email"]') || await page.$('#identifierId');
        if (emailInput) {
          await emailInput.click({ clickCount: 3 });
          await emailInput.type(email, { delay: 50 });
          
          // Next 버튼 클릭
          const nextButton = await page.$('#identifierNext') || 
                            await page.$('button[jsname="LgbsSe"]');
          if (nextButton) {
            await nextButton.click();
            this.log('이메일 입력 및 Next 클릭 완료', 'success');
            await new Promise(r => setTimeout(r, 3000));
            return true;
          }
        }
      }
      
      // 비밀번호 페이지로 바로 이동한 경우
      const hasPasswordField = await page.evaluate(() => {
        return !!document.querySelector('input[type="password"]');
      });
      
      if (hasPasswordField) {
        this.log('비밀번호 페이지로 바로 이동됨', 'success');
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`URL 직접 조작 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 방법 2: "다른 계정 사용" 버튼 클릭
   */
  async bypassWithUseAnother(page, email) {
    try {
      this.log('"다른 계정 사용" 옵션 찾기', 'info');
      
      // 다양한 선택자로 시도
      const selectors = [
        'text="다른 계정 사용"',
        'text="Use another account"',
        '[data-action="choose-other-account"]',
        'li:last-child', // 보통 마지막 옵션
        'a[href*="RemoveLocalAccount"]'
      ];
      
      let clicked = false;
      
      for (const selector of selectors) {
        try {
          // evaluate 내에서 클릭
          clicked = await page.evaluate((sel) => {
            let element = null;
            
            if (sel.startsWith('text=')) {
              const text = sel.substring(5);
              const elements = Array.from(document.querySelectorAll('*'));
              element = elements.find(el => 
                el.textContent?.trim() === text && 
                (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'DIV' || el.tagName === 'LI')
              );
            } else {
              element = document.querySelector(sel);
            }
            
            if (element && element.offsetHeight > 0) {
              element.click();
              return true;
            }
            return false;
          }, selector);
          
          if (clicked) {
            this.log(`"다른 계정 사용" 클릭 성공 (${selector})`, 'success');
            break;
          }
        } catch (e) {
          // 계속 시도
        }
      }
      
      if (clicked) {
        await new Promise(r => setTimeout(r, 3000));
        
        // 이메일 입력 페이지 확인
        const hasEmailField = await page.evaluate(() => {
          return !!document.querySelector('input[type="email"]') || 
                 !!document.querySelector('#identifierId');
        });
        
        if (hasEmailField) {
          this.log('이메일 입력 페이지로 이동 성공', 'success');
          
          // 이메일 입력
          await this.inputEmail(page, email);
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      this.log(`"다른 계정 사용" 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 방법 3: JavaScript로 form submit
   */
  async bypassWithFormSubmit(page, email) {
    try {
      this.log('Form submit 방법 시도', 'info');
      
      const submitted = await page.evaluate((email) => {
        // 숨겨진 form 찾기
        const forms = document.querySelectorAll('form');
        
        for (const form of forms) {
          // 이메일 입력 필드 찾기
          const emailInput = form.querySelector('input[name="Email"]') || 
                           form.querySelector('input[name="identifier"]') ||
                           form.querySelector('input[type="email"]');
          
          if (emailInput) {
            emailInput.value = email;
            
            // hidden 필드들도 설정
            const hiddenInputs = form.querySelectorAll('input[type="hidden"]');
            hiddenInputs.forEach(input => {
              if (input.name === 'Email') {
                input.value = email;
              }
            });
            
            // form submit
            form.submit();
            return true;
          }
        }
        
        return false;
      }, email);
      
      if (submitted) {
        this.log('Form submit 성공', 'success');
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`Form submit 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 방법 4: 쿠키/세션 초기화 후 새로 시작
   */
  async bypassWithClearSession(page) {
    try {
      this.log('세션 초기화 시도', 'info');
      
      // 쿠키 삭제
      const cookies = await page.cookies();
      await page.deleteCookie(...cookies);
      
      // 로컬 스토리지 초기화
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      
      // YouTube로 이동 (로그인 리다이렉트 유도)
      await page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await new Promise(r => setTimeout(r, 3000));
      
      // 로그인 페이지로 리다이렉트되었는지 확인
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com')) {
        this.log('세션 초기화 후 로그인 페이지로 이동', 'success');
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`세션 초기화 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 이메일 입력 헬퍼
   */
  async inputEmail(page, email) {
    const emailInput = await page.$('input[type="email"]') || await page.$('#identifierId');
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(email, { delay: 50 });
      
      const nextButton = await page.$('#identifierNext') || 
                        await page.$('button[jsname="LgbsSe"]');
      if (nextButton) {
        await nextButton.click();
        this.log('이메일 입력 완료', 'success');
        return true;
      }
    }
    return false;
  }

  /**
   * 비밀번호 입력 헬퍼
   */
  async inputPassword(page, password) {
    await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
    
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click({ clickCount: 3 });
      await passwordInput.type(password, { delay: 50 });
      
      const nextButton = await page.$('#passwordNext') || 
                        await page.$('button[jsname="LgbsSe"]');
      if (nextButton) {
        await nextButton.click();
        this.log('비밀번호 입력 완료', 'success');
        return true;
      }
    }
    return false;
  }

  /**
   * 통합 우회 프로세스 (모든 방법 순차 시도)
   */
  async performBypassLogin(page, account) {
    try {
      this.log('🔐 Google 로그인 우회 프로세스 시작', 'info');
      
      const currentUrl = page.url();
      
      // 계정 선택 페이지인 경우
      if (currentUrl.includes('accountchooser')) {
        this.log('계정 선택 페이지 감지 - 우회 방법 시도', 'warning');
        
        // 1. "다른 계정 사용" 시도
        let success = await this.bypassWithUseAnother(page, account.email);
        
        // 2. URL 직접 조작 시도
        if (!success) {
          this.log('URL 직접 조작 방법 시도', 'info');
          success = await this.bypassWithDirectURL(page, account.email);
        }
        
        // 3. Form submit 시도
        if (!success) {
          this.log('Form submit 방법 시도', 'info');
          success = await this.bypassWithFormSubmit(page, account.email);
        }
        
        // 4. 세션 초기화 시도
        if (!success) {
          this.log('세션 초기화 방법 시도', 'info');
          success = await this.bypassWithClearSession(page);
          
          if (success) {
            // 이메일 입력
            await this.inputEmail(page, account.email);
          }
        }
        
        if (success) {
          // 비밀번호 입력
          await new Promise(r => setTimeout(r, 3000));
          await this.inputPassword(page, account.password);
          
          await new Promise(r => setTimeout(r, 5000));
          
          // 최종 확인
          const finalUrl = page.url();
          if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
            this.log('✅ 로그인 성공!', 'success');
            return { success: true };
          }
        }
      }
      
      return { success: false, reason: 'All bypass methods failed' };
      
    } catch (error) {
      this.log(`❌ 로그인 우회 실패: ${error.message}`, 'error');
      return { success: false, reason: error.message };
    }
  }
}

module.exports = GoogleLoginBypassService;