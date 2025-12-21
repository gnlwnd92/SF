/**
 * Robust Authentication Service
 * 더 안정적인 Google 로그인 처리
 */

const chalk = require('chalk');
const speakeasy = require('speakeasy');

class RobustAuthenticationService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.maxRetries = options.maxRetries || 3;
  }

  log(message, type = 'info') {
    const prefix = '[RobustAuth]';
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
      const url = page.url();
      
      // Google 로그인 페이지에 있으면 로그인 필요
      if (url.includes('accounts.google.com')) {
        this.log('Google 로그인 페이지 - 로그인 필요', 'warning');
        return false;
      }
      
      // YouTube Premium 페이지에서 확인
      if (url.includes('youtube.com/paid_memberships')) {
        const hasContent = await page.evaluate(() => {
          const text = document.body?.innerText || '';
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
      
      // 기본 YouTube 페이지에서 사용자 메뉴 확인
      if (url.includes('youtube.com')) {
        const hasUserMenu = await page.evaluate(() => {
          return !!document.querySelector('#avatar-btn') ||
                 !!document.querySelector('button[aria-label*="Account"]');
        });
        
        if (hasUserMenu) {
          this.log('사용자 메뉴 확인 - 로그인됨', 'success');
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 계정 선택 페이지에서 로그인
   */
  async handleAccountChooser(page, email, password) {
    this.log('계정 선택 페이지 처리 시작', 'info');
    
    try {
      // 페이지가 완전히 로드될 때까지 대기
      await new Promise(r => setTimeout(r, 3000));
      
      // 계정 목록 확인
      const accounts = await page.evaluate(() => {
        const elements = document.querySelectorAll('[data-identifier]');
        const results = [];
        elements.forEach(el => {
          const email = el.getAttribute('data-identifier');
          const card = el.closest('li') || el.closest('div[role="link"]') || el.closest('.JDAKTe');
          if (card) {
            const text = card.innerText || '';
            const isLoggedOut = text.includes('로그아웃됨') || text.includes('Signed out');
            results.push({ email, isLoggedOut, elementId: card.id || '' });
          }
        });
        return results;
      });
      
      this.log(`발견된 계정: ${accounts.length}개`, 'info');
      accounts.forEach(acc => {
        this.log(`  - ${acc.email} (${acc.isLoggedOut ? '로그아웃됨' : '로그인됨'})`, 'info');
      });
      
      const targetAccount = accounts.find(acc => acc.email === email);
      
      if (targetAccount) {
        this.log(`대상 계정 발견: ${email}`, 'success');
        
        if (targetAccount.isLoggedOut) {
          this.log('계정이 로그아웃 상태 - 비밀번호 입력 필요', 'warning');
          
          // 계정 카드 클릭 (더 정확한 방법)
          const clicked = await page.evaluate((email) => {
            const element = document.querySelector(`[data-identifier="${email}"]`);
            if (!element) return false;
            
            // 클릭 가능한 부모 요소 찾기
            let clickTarget = element;
            let parent = element.parentElement;
            
            while (parent) {
              if (parent.tagName === 'LI' || 
                  parent.getAttribute('role') === 'link' ||
                  parent.classList.contains('JDAKTe') ||
                  parent.classList.contains('d2CFce')) {
                clickTarget = parent;
                break;
              }
              parent = parent.parentElement;
            }
            
            // 실제 클릭 이벤트 발생
            const clickEvent = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            clickTarget.dispatchEvent(clickEvent);
            
            // 추가로 요소 자체도 클릭
            clickTarget.click();
            
            return true;
          }, email);
          
          if (clicked) {
            this.log('계정 클릭 완료', 'success');
            await new Promise(r => setTimeout(r, 5000));
            
            // 비밀번호 페이지로 이동했는지 확인
            const hasPasswordField = await page.evaluate(() => {
              return !!document.querySelector('input[type="password"]');
            });
            
            if (hasPasswordField) {
              this.log('비밀번호 페이지로 이동 성공', 'success');
              await this.inputPassword(page, password);
              return true;
            } else {
              // 여전히 계정 선택 페이지라면 다른 방법 시도
              this.log('비밀번호 페이지로 이동 실패 - 다른 방법 시도', 'warning');
              
              // "다른 계정 사용" 클릭 후 이메일 직접 입력
              const useAnother = await page.evaluate(() => {
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
              
              if (useAnother) {
                this.log('"다른 계정 사용" 클릭', 'info');
                await new Promise(r => setTimeout(r, 3000));
                await this.inputEmail(page, email);
                await new Promise(r => setTimeout(r, 3000));
                await this.inputPassword(page, password);
                return true;
              }
            }
          }
        } else {
          // 이미 로그인된 계정
          this.log('계정이 이미 로그인 상태', 'info');
          
          await page.evaluate((email) => {
            const element = document.querySelector(`[data-identifier="${email}"]`);
            if (element) {
              const card = element.closest('li') || element.closest('div[role="link"]');
              if (card) card.click();
            }
          }, email);
          
          await new Promise(r => setTimeout(r, 3000));
          return true;
        }
      } else {
        // 계정이 목록에 없음 - 새로 입력
        this.log('계정이 목록에 없음 - 새로 입력', 'warning');
        
        const useAnother = await page.evaluate(() => {
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
        
        if (useAnother) {
          await new Promise(r => setTimeout(r, 3000));
          await this.inputEmail(page, email);
          await new Promise(r => setTimeout(r, 3000));
          await this.inputPassword(page, password);
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
   * 이메일 입력
   */
  async inputEmail(page, email) {
    this.log('이메일 입력', 'info');
    
    const emailInput = await page.$('input[type="email"]') || await page.$('#identifierId');
    if (emailInput) {
      await emailInput.click();
      await page.keyboard.type(email, { delay: 100 });
      await new Promise(r => setTimeout(r, 1000));
      
      // Next 버튼 클릭
      const nextButton = await page.$('#identifierNext') || 
                        await page.$('button[jsname="LgbsSe"]');
      if (nextButton) {
        await nextButton.click();
        this.log('이메일 입력 완료', 'success');
      }
    }
  }

  /**
   * 비밀번호 입력
   */
  async inputPassword(page, password) {
    this.log('비밀번호 입력', 'info');
    
    // 비밀번호 필드 대기
    await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {});
    
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await page.keyboard.type(password, { delay: 100 });
      await new Promise(r => setTimeout(r, 1000));
      
      // Next 버튼 클릭
      const nextButton = await page.$('#passwordNext') || 
                        await page.$('button[jsname="LgbsSe"]');
      if (nextButton) {
        await nextButton.click();
        this.log('비밀번호 입력 완료', 'success');
      }
    }
  }

  /**
   * TOTP 입력
   */
  async inputTOTP(page, totpSecret) {
    this.log('2단계 인증 처리', 'info');
    
    try {
      const token = speakeasy.totp({
        secret: totpSecret,
        encoding: 'base32'
      });
      
      this.log(`TOTP 코드: ${token}`, 'info');
      
      const totpInput = await page.$('input[type="tel"][maxlength="6"]') || 
                       await page.$('#totpPin');
      if (totpInput) {
        await totpInput.click();
        await page.keyboard.type(token, { delay: 50 });
        await new Promise(r => setTimeout(r, 1000));
        
        const nextButton = await page.$('#totpNext') || 
                          await page.$('button[jsname="LgbsSe"]');
        if (nextButton) {
          await nextButton.click();
          this.log('TOTP 입력 완료', 'success');
        }
      }
    } catch (error) {
      this.log(`TOTP 처리 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 통합 로그인 프로세스
   */
  async performLogin(page, account) {
    const startTime = Date.now();
    
    try {
      this.log('🔐 로그인 프로세스 시작', 'info');
      
      const currentUrl = page.url();
      
      // 계정 선택 페이지인 경우
      if (currentUrl.includes('accountchooser')) {
        const success = await this.handleAccountChooser(page, account.email, account.password);
        
        if (success) {
          await new Promise(r => setTimeout(r, 5000));
          
          // TOTP 필요 여부 확인
          const needsTOTP = await page.evaluate(() => {
            const text = document.body?.innerText || '';
            return text.includes('2-Step Verification') || 
                   text.includes('2단계 인증') ||
                   !!document.querySelector('input[type="tel"][maxlength="6"]');
          });
          
          if (needsTOTP && account.totpSecret) {
            await this.inputTOTP(page, account.totpSecret);
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
      
      // 실패
      this.log('❌ 로그인 실패', 'error');
      return {
        success: false,
        reason: 'Login failed',
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

module.exports = RobustAuthenticationService;