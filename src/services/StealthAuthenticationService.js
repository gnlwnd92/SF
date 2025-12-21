/**
 * Stealth Authentication Service
 * PDF 문서 기반 Google 자동화 감지 우회 솔루션
 * - Puppeteer Extra Stealth 플러그인 사용
 * - CSP 우회 설정
 * - AutomationControlled 플래그 비활성화
 */

const chalk = require('chalk');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Stealth 플러그인 적용
puppeteer.use(StealthPlugin());

class StealthAuthenticationService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
  }

  log(message, type = 'info') {
    if (!this.debugMode) return;
    
    const prefix = '[StealthAuth]';
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
   * 페이지 Stealth 설정 적용
   */
  async applyStealthSettings(page) {
    try {
      this.log('Stealth 설정 적용 중...', 'info');
      
      // 1. CSP 우회 설정 (PDF 권장사항)
      await page.setBypassCSP(true);
      this.log('✅ CSP 우회 설정 완료', 'success');
      
      // 2. navigator.webdriver 제거
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
      });
      this.log('✅ navigator.webdriver 제거', 'success');
      
      // 3. Chrome 자동화 플래그 제거
      await page.evaluateOnNewDocument(() => {
        // Chrome 자동화 관련 속성 제거
        window.chrome = {
          runtime: {},
        };
        
        // 권한 API 모킹
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });
      this.log('✅ Chrome 자동화 플래그 제거', 'success');
      
      // 중요: AdsPower가 이미 설정한 User-Agent와 뷰포트를 변경하지 않음
      // AdsPower의 anti-fingerprinting 기능을 유지하기 위해 브라우저 설정 보존
      this.log('✅ AdsPower 브라우저 설정 유지', 'success');
      
      return true;
      
    } catch (error) {
      this.log(`Stealth 설정 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 인간적인 마우스 움직임 시뮬레이션
   */
  async humanLikeMouseMove(page, x, y) {
    const steps = 5;
    const startX = await page.evaluate(() => window.mouseX || 0);
    const startY = await page.evaluate(() => window.mouseY || 0);
    
    for (let i = 1; i <= steps; i++) {
      const progressX = startX + (x - startX) * (i / steps);
      const progressY = startY + (y - startY) * (i / steps);
      await page.mouse.move(progressX, progressY);
      await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    }
    
    // 최종 위치에 정확히 이동
    await page.mouse.move(x, y);
  }

  /**
   * 계정 선택 페이지에서 계정 클릭 (Stealth 모드)
   */
  async clickAccountWithStealth(page, email) {
    try {
      this.log(`계정 클릭 시도: ${email}`, 'info');
      
      // Stealth 설정 먼저 적용
      await this.applyStealthSettings(page);
      
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 1. 먼저 계정이 있는지 확인
      const accountInfo = await page.evaluate((targetEmail) => {
        const accounts = document.querySelectorAll('[data-identifier]');
        for (const account of accounts) {
          if (account.getAttribute('data-identifier') === targetEmail) {
            const rect = account.getBoundingClientRect();
            const parent = account.closest('li') || account.closest('[role="link"]');
            const parentRect = parent ? parent.getBoundingClientRect() : rect;
            
            return {
              found: true,
              x: parentRect.x + parentRect.width / 2,
              y: parentRect.y + parentRect.height / 2,
              width: parentRect.width,
              height: parentRect.height
            };
          }
        }
        return { found: false };
      }, email);
      
      if (!accountInfo.found) {
        this.log('계정을 찾을 수 없음', 'error');
        return false;
      }
      
      this.log(`계정 위치: (${accountInfo.x}, ${accountInfo.y})`, 'info');
      
      // 2. 인간적인 딜레이 추가
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
      
      // 3. 마우스를 천천히 이동
      await this.humanLikeMouseMove(page, accountInfo.x, accountInfo.y);
      
      // 4. 호버 효과를 위한 대기
      await new Promise(r => setTimeout(r, 300));
      
      // 5. 클릭 (인간적인 클릭 시뮬레이션)
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
      await page.mouse.up();
      
      this.log('클릭 완료', 'success');
      
      // 6. 페이지 전환 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 7. 페이지 전환 확인
      const newUrl = page.url();
      const hasPasswordField = await page.$('input[type="password"]');
      
      if (hasPasswordField) {
        this.log('✅ 비밀번호 페이지로 전환 성공!', 'success');
        return true;
      }
      
      // 8. 페이지 전환이 안 되었다면 키보드 방식 시도
      this.log('마우스 클릭 실패, 키보드 방식 시도', 'warning');
      return await this.tryKeyboardSelection(page, email);
      
    } catch (error) {
      this.log(`계정 클릭 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 키보드를 이용한 계정 선택 (대체 방법)
   */
  async tryKeyboardSelection(page, email) {
    try {
      this.log('키보드 네비게이션 시작', 'info');
      
      // body에 포커스
      await page.click('body');
      
      // Tab 키로 계정 찾기
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 200));
        
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          
          // data-identifier 확인
          const identifier = el.getAttribute('data-identifier') || 
                           el.querySelector('[data-identifier]')?.getAttribute('data-identifier');
          
          return {
            identifier,
            tagName: el.tagName,
            text: el.textContent?.substring(0, 100)
          };
        });
        
        if (focused?.identifier === email) {
          this.log(`✅ 키보드로 계정 찾음: ${email}`, 'success');
          
          // Enter 키로 선택
          await page.keyboard.press('Enter');
          await new Promise(r => setTimeout(r, 2000));
          
          return true;
        }
      }
      
      this.log('키보드로도 계정을 찾을 수 없음', 'error');
      return false;
      
    } catch (error) {
      this.log(`키보드 선택 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 로그인 플로우 우회 (쿠키 초기화 방식)
   */
  async bypassWithCookieClear(page) {
    try {
      this.log('쿠키 초기화로 계정 선택 우회', 'info');
      
      // 모든 쿠키 삭제
      const cookies = await page.cookies();
      await page.deleteCookie(...cookies);
      
      // 로컬/세션 스토리지 초기화
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      
      this.log('✅ 쿠키 및 스토리지 초기화 완료', 'success');
      
      // Google 로그인 페이지로 직접 이동
      await page.goto('https://accounts.google.com/signin', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // 이메일 입력 필드 확인
      const hasEmailField = await page.$('input[type="email"], input#identifierId');
      
      if (hasEmailField) {
        this.log('✅ 이메일 입력 페이지로 직접 이동 성공', 'success');
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`쿠키 초기화 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 통합 로그인 프로세스 (Stealth 모드)
   */
  async performStealthLogin(page, credentials) {
    try {
      this.log('🔐 Stealth 로그인 프로세스 시작', 'info');
      
      // Stealth 설정 적용
      await this.applyStealthSettings(page);
      
      const currentUrl = page.url();
      
      // 계정 선택 페이지인 경우
      if (currentUrl.includes('accountchooser')) {
        this.log('계정 선택 페이지 감지', 'info');
        
        // 1. Stealth 모드로 계정 클릭 시도
        const clickSuccess = await this.clickAccountWithStealth(page, credentials.email);
        
        if (!clickSuccess) {
          // 2. 실패 시 쿠키 초기화로 우회
          this.log('계정 클릭 실패, 쿠키 초기화 우회 시도', 'warning');
          const bypassSuccess = await this.bypassWithCookieClear(page);
          
          if (bypassSuccess) {
            // 이메일 입력
            await this.inputEmailWithDelay(page, credentials.email);
          } else {
            return { success: false, reason: 'All methods failed' };
          }
        }
      }
      
      // 비밀번호 입력 (필요한 경우)
      const hasPasswordField = await page.$('input[type="password"]');
      if (hasPasswordField && credentials.password) {
        await this.inputPasswordWithDelay(page, credentials.password);
      }
      
      // 최종 확인
      await new Promise(r => setTimeout(r, 3000));
      const finalUrl = page.url();
      
      if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
        this.log('✅ Stealth 로그인 성공!', 'success');
        return { success: true };
      }
      
      return { success: false, reason: 'Login incomplete' };
      
    } catch (error) {
      this.log(`❌ Stealth 로그인 실패: ${error.message}`, 'error');
      return { success: false, reason: error.message };
    }
  }

  /**
   * 인간적인 타이핑 시뮬레이션으로 이메일 입력
   */
  async inputEmailWithDelay(page, email) {
    const emailInput = await page.$('input[type="email"], input#identifierId');
    if (emailInput) {
      await emailInput.click();
      await new Promise(r => setTimeout(r, 300));
      
      // 한 글자씩 타이핑 (랜덤 딜레이)
      for (const char of email) {
        await page.keyboard.type(char);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      }
      
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.press('Enter');
      this.log('이메일 입력 완료', 'success');
    }
  }

  /**
   * 인간적인 타이핑 시뮬레이션으로 비밀번호 입력
   */
  async inputPasswordWithDelay(page, password) {
    await new Promise(r => setTimeout(r, 1000));
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await new Promise(r => setTimeout(r, 300));
      
      // 한 글자씩 타이핑 (랜덤 딜레이)
      for (const char of password) {
        await page.keyboard.type(char);
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      }
      
      await new Promise(r => setTimeout(r, 500));
      await page.keyboard.press('Enter');
      this.log('비밀번호 입력 완료', 'success');
    }
  }
}

module.exports = StealthAuthenticationService;