/**
 * Working Authentication Service
 * 실제로 작동하는 Google 로그인 서비스
 * - 계정 선택 페이지 클릭 문제를 URL 조작으로 우회
 */

const chalk = require('chalk');

class WorkingAuthenticationService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
  }

  log(message, type = 'info') {
    if (!this.debugMode) return;
    
    const prefix = '[WorkingAuth]';
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
   * 계정 선택 페이지 처리 (URL 조작 방식)
   */
  async handleAccountChooser(page, email) {
    try {
      this.log('계정 선택 페이지 처리 시작', 'info');
      
      const currentUrl = page.url();
      const url = new URL(currentUrl);
      const params = new URLSearchParams(url.search);
      
      // 세션 정보 추출
      const sessionInfo = await page.evaluate((targetEmail) => {
        const accounts = [];
        document.querySelectorAll('[data-identifier]').forEach(el => {
          const email = el.getAttribute('data-identifier');
          const parent = el.closest('li');
          if (parent) {
            accounts.push({
              email,
              text: parent.innerText
            });
          }
        });
        
        return {
          accounts,
          hasTargetAccount: accounts.some(acc => acc.email === targetEmail)
        };
      }, email);
      
      this.log(`발견된 계정: ${sessionInfo.accounts.length}개`, 'info');
      sessionInfo.accounts.forEach(acc => {
        this.log(`  - ${acc.email}`, 'info');
      });
      
      if (sessionInfo.hasTargetAccount) {
        this.log(`${email} 계정 발견 - 다양한 방법으로 진행 시도`, 'success');
        
        // 방법 1: "다른 계정 사용" 버튼 클릭
        try {
          this.log('방법 1: "다른 계정 사용" 버튼 클릭 시도', 'info');
          
          // 페이지 상태 디버깅
          const pageDebugInfo = await page.evaluate(() => {
            const allLis = document.querySelectorAll('li');
            const debugInfo = {
              totalLis: allLis.length,
              lisWithoutIdentifier: [],
              emptyIdentifiers: [],
              allTexts: []
            };
            
            // 모든 li 요소 분석
            allLis.forEach((li, index) => {
              const text = li.innerText || '';
              const hasIdentifier = li.querySelector('[data-identifier]');
              
              if (!hasIdentifier) {
                debugInfo.lisWithoutIdentifier.push({
                  index,
                  text: text.substring(0, 100),
                  className: li.className
                });
              }
              
              if (text.length > 0) {
                debugInfo.allTexts.push(text.substring(0, 50));
              }
            });
            
            // 빈 data-identifier 찾기
            document.querySelectorAll('[data-identifier=""]').forEach((el) => {
              const parent = el.closest('li');
              debugInfo.emptyIdentifiers.push({
                tagName: el.tagName,
                parentText: parent ? parent.innerText.substring(0, 50) : 'no parent',
                className: el.className
              });
            });
            
            return debugInfo;
          });
          
          this.log(`페이지 분석: li 총 ${pageDebugInfo.totalLis}개, identifier 없는 li ${pageDebugInfo.lisWithoutIdentifier.length}개`, 'info');
          if (this.debugMode && pageDebugInfo.lisWithoutIdentifier.length > 0) {
            this.log(`Identifier 없는 항목들: ${JSON.stringify(pageDebugInfo.lisWithoutIdentifier, null, 2)}`, 'debug');
          }
          
          // "다른 계정 사용" 버튼 찾기 (개선된 로직)
          const useAnotherButton = await page.evaluate(() => {
            // 방법 1: 빈 data-identifier를 가진 요소 찾기
            const emptyIdentifier = document.querySelector('div[data-identifier=""]');
            if (emptyIdentifier) {
              const parent = emptyIdentifier.closest('li');
              if (parent) {
                const rect = parent.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: parent.innerText.substring(0, 50),
                  method: 'empty-identifier'
                };
              }
            }
            
            // 방법 2: 텍스트로 찾기
            const allListItems = document.querySelectorAll('li');
            for (const li of allListItems) {
              const text = li.innerText || '';
              const hasDataIdentifier = li.querySelector('[data-identifier]:not([data-identifier=""])');
              
              // data-identifier가 없고 관련 텍스트가 있는 항목
              if (!hasDataIdentifier && text.length > 0) {
                const lowerText = text.toLowerCase();
                if (lowerText.includes('다른') || 
                    lowerText.includes('another') || 
                    lowerText.includes('add') ||
                    lowerText.includes('추가') ||
                    lowerText.includes('different') ||
                    lowerText.includes('new')) {
                  const rect = li.getBoundingClientRect();
                  return {
                    found: true,
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    text: text.substring(0, 50),
                    method: 'text-search'
                  };
                }
              }
            }
            
            // 방법 3: 마지막 li 요소 (보통 "다른 계정" 버튼)
            const lastLi = allListItems[allListItems.length - 1];
            if (lastLi) {
              const hasIdentifier = lastLi.querySelector('[data-identifier]:not([data-identifier=""])');
              if (!hasIdentifier) {
                const rect = lastLi.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: lastLi.innerText.substring(0, 50),
                  method: 'last-item'
                };
              }
            }
            
            return { found: false };
          });
          
          if (useAnotherButton.found) {
            this.log(`"다른 계정 사용" 버튼 찾음 (${useAnotherButton.method}): ${useAnotherButton.text}`, 'success');
            
            // 클릭 실행
            await page.mouse.move(useAnotherButton.x, useAnotherButton.y);
            await new Promise(r => setTimeout(r, 300));
            await page.mouse.click(useAnotherButton.x, useAnotherButton.y);
            await new Promise(r => setTimeout(r, 2000));
            
            // 페이지 전환 확인
            const newUrl = page.url();
            this.log(`클릭 후 URL: ${newUrl}`, 'debug');
            
            // 이메일 필드 확인
            const hasEmailField = await page.$('input[type="email"], input#identifierId');
            if (hasEmailField) {
              this.log('이메일 입력 페이지로 이동 성공 (방법 1)', 'success');
              await this.inputEmail(page, email);
              
              // 비밀번호 페이지 대기
              await page.waitForSelector('input[type="password"]', { 
                visible: true, 
                timeout: 10000 
              }).catch(() => null);
              
              return true;
            } else {
              this.log('클릭 후 이메일 필드를 찾을 수 없음', 'warning');
            }
          } else {
            this.log('"다른 계정 사용" 버튼을 찾을 수 없음', 'warning');
          }
        } catch (error) {
          this.log(`방법 1 실패: ${error.message}`, 'warning');
        }
        
        // 방법 2: URL 조작
        try {
          this.log('방법 2: URL 조작으로 이메일 입력 페이지 이동 시도', 'info');
          
          const identifierUrl = new URL('https://accounts.google.com/signin/v2/identifier');
          identifierUrl.searchParams.set('continue', params.get('continue') || '');
          identifierUrl.searchParams.set('service', params.get('service') || 'youtube');
          identifierUrl.searchParams.set('hl', params.get('hl') || 'ko');
          identifierUrl.searchParams.set('flowName', params.get('flowName') || 'GlifWebSignIn');
          identifierUrl.searchParams.set('flowEntry', 'ServiceLogin');
          
          await page.goto(identifierUrl.toString(), {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
          
          await new Promise(r => setTimeout(r, 2000));
          
          // 페이지가 실제로 이동했는지 확인
          const newUrl = page.url();
          if (!newUrl.includes('accountchooser')) {
            const hasEmailField = await page.$('input[type="email"], input#identifierId');
            if (hasEmailField) {
              this.log('이메일 입력 페이지로 이동 성공 (방법 2)', 'success');
              await this.inputEmail(page, email);
              
              await page.waitForSelector('input[type="password"]', { 
                visible: true, 
                timeout: 10000 
              }).catch(() => null);
              
              return true;
            }
          } else {
            this.log('URL 조작 후에도 계정 선택 페이지에 머물러 있음', 'warning');
          }
        } catch (error) {
          this.log(`방법 2 실패: ${error.message}`, 'warning');
        }
        
        // 방법 3: 계정 직접 클릭 (부모 요소 li 클릭)
        try {
          this.log('방법 3: 계정 직접 클릭 시도', 'info');
          
          // 계정 요소와 부모 요소 찾기 (개선된 로직)
          const clickResult = await page.evaluate((targetEmail) => {
            // 계정 요소 찾기
            const accountEl = document.querySelector(`[data-identifier="${targetEmail}"]`);
            if (!accountEl) {
              // data-identifier가 없는 경우 텍스트로 찾기
              const allLis = document.querySelectorAll('li');
              for (const li of allLis) {
                const text = li.innerText || '';
                if (text.includes(targetEmail)) {
                  const rect = li.getBoundingClientRect();
                  return {
                    found: true,
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    width: rect.width,
                    height: rect.height,
                    tagName: 'LI',
                    className: li.className,
                    method: 'text-match'
                  };
                }
              }
              return { found: false, reason: 'no-element' };
            }
            
            // 클릭 가능한 부모 요소 찾기 (우선순위: li > div[role="link"] > 부모)
            let clickableParent = accountEl.closest('li');
            let method = 'li-parent';
            
            if (!clickableParent) {
              clickableParent = accountEl.closest('div[role="link"]');
              method = 'role-link';
            }
            
            if (!clickableParent) {
              clickableParent = accountEl.closest('[role="button"]');
              method = 'role-button';
            }
            
            if (!clickableParent) {
              clickableParent = accountEl.parentElement;
              method = 'direct-parent';
            }
            
            if (!clickableParent) {
              return { found: false, reason: 'no-parent' };
            }
            
            const rect = clickableParent.getBoundingClientRect();
            
            // 보이는 요소인지 확인
            const isVisible = rect.width > 0 && rect.height > 0 && 
                             rect.top >= 0 && rect.left >= 0;
            
            if (!isVisible) {
              return { found: false, reason: 'not-visible' };
            }
            
            return {
              found: true,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              width: rect.width,
              height: rect.height,
              tagName: clickableParent.tagName,
              className: clickableParent.className,
              method: method,
              accountText: accountEl.innerText || targetEmail
            };
          }, email);
          
          if (clickResult.found) {
            this.log(`계정 찾음 (${clickResult.method}): ${clickResult.accountText}`, 'success');
            this.log(`클릭 위치: (${Math.round(clickResult.x)}, ${Math.round(clickResult.y)})`, 'debug');
            this.log(`클릭 대상: ${clickResult.tagName} [${clickResult.width}x${clickResult.height}]`, 'debug');
            
            // 스크롤하여 요소가 보이도록 함
            await page.evaluate(({x, y}) => {
              window.scrollTo(0, Math.max(0, y - window.innerHeight / 2));
            }, {x: clickResult.x, y: clickResult.y});
            await new Promise(r => setTimeout(r, 300));
            
            // 마우스 이동 후 클릭
            await page.mouse.move(clickResult.x, clickResult.y);
            await new Promise(r => setTimeout(r, 300));
            await page.mouse.click(clickResult.x, clickResult.y);
            
            this.log('클릭 완료, 페이지 전환 대기 중...', 'info');
            await new Promise(r => setTimeout(r, 3000));
            
            // 페이지 전환 확인
            const newUrl = page.url();
            this.log(`클릭 후 URL: ${newUrl}`, 'debug');
            
            if (!newUrl.includes('accountchooser')) {
              // 비밀번호 필드 또는 이메일 필드 확인
              const hasPasswordField = await page.$('input[type="password"]');
              const hasEmailField = await page.$('input[type="email"], input#identifierId');
              
              if (hasPasswordField) {
                this.log('비밀번호 페이지로 이동 성공 (방법 3)', 'success');
                return true;
              } else if (hasEmailField) {
                this.log('이메일 입력 페이지로 이동 (로그아웃된 계정)', 'warning');
                // 로그아웃된 계정의 경우 이메일 입력 필요
                await this.inputEmail(page, email);
                
                // 비밀번호 페이지 대기
                await page.waitForSelector('input[type="password"]', { 
                  visible: true, 
                  timeout: 10000 
                }).catch(() => null);
                
                return true;
              } else {
                this.log('페이지 전환됐지만 입력 필드를 찾을 수 없음', 'warning');
              }
            } else {
              this.log('클릭 후에도 계정 선택 페이지에 머물러 있음', 'warning');
            }
          } else {
            this.log(`${email} 계정 요소를 찾을 수 없음 (이유: ${clickResult.reason})`, 'warning');
          }
        } catch (error) {
          this.log(`방법 3 실패: ${error.message}`, 'warning');
        }
        
        // 모든 방법이 실패한 경우
        this.log('모든 계정 선택 우회 방법 실패', 'error');
        return false;
      } else {
        this.log(`${email} 계정이 목록에 없음 - "다른 계정 사용" 클릭`, 'warning');
        
        // "다른 계정 사용" 버튼 클릭
        try {
          const useAnotherButton = await page.$('div[data-identifier=""]') || 
                                   await page.$('[aria-label*="다른 계정"]') ||
                                   await page.$('[aria-label*="Use another account"]');
          
          if (useAnotherButton) {
            await useAnotherButton.click();
            await new Promise(r => setTimeout(r, 2000));
            
            const hasEmailField = await page.$('input[type="email"], input#identifierId');
            if (hasEmailField) {
              this.log('이메일 입력 페이지로 이동 성공', 'success');
              await this.inputEmail(page, email);
              return true;
            }
          }
        } catch (error) {
          this.log(`"다른 계정 사용" 버튼 클릭 실패: ${error.message}`, 'warning');
        }
        
        // 대체 방법: URL 조작
        this.log('URL 조작으로 재시도', 'info');
        const identifierUrl = new URL('https://accounts.google.com/signin/v2/identifier');
        identifierUrl.searchParams.set('continue', params.get('continue') || '');
        identifierUrl.searchParams.set('service', params.get('service') || 'youtube');
        identifierUrl.searchParams.set('hl', params.get('hl') || 'ko');
        identifierUrl.searchParams.set('flowName', 'GlifWebSignIn');
        identifierUrl.searchParams.set('flowEntry', 'ServiceLogin');
        
        await page.goto(identifierUrl.toString(), {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        
        await new Promise(r => setTimeout(r, 2000));
        
        // 이메일 입력
        await this.inputEmail(page, email);
        return true;
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
      
      const emailInput = await page.$('input[type="email"], input#identifierId');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email, { delay: 100 });
        this.log(`이메일 입력: ${email}`, 'success');
        
        // 다음 버튼 클릭 또는 Enter
        const nextButton = await page.$('#identifierNext');
        if (nextButton) {
          await nextButton.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        this.log('다음 단계로 진행', 'success');
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
      }).catch(() => null);
      
      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.type(password, { delay: 100 });
        this.log('비밀번호 입력 완료', 'success');
        
        // 다음 버튼 클릭 또는 Enter
        const nextButton = await page.$('#passwordNext');
        if (nextButton) {
          await nextButton.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        this.log('로그인 진행 중...', 'info');
        await new Promise(r => setTimeout(r, 5000));
        
        // 패스키 페이지 확인 및 처리
        await this.handlePasskeyPage(page);
        
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`비밀번호 입력 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 패스키/빠른 로그인 페이지 처리
   */
  async handlePasskeyPage(page) {
    try {
      this.log('패스키 페이지 확인 중...', 'info');
      
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 패스키 페이지인지 확인
      const isPasskeyPage = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const url = window.location.href;
        
        // 패스키 관련 키워드 확인
        const passkeyKeywords = [
          '빠르게 로그인',
          '빠른 로그인',
          'Passkey',
          'passkey',
          'passwordless',
          '패스키',
          'Sign in faster',
          'Create a passkey',
          'Skip password when possible',
          '비밀번호 건너뛰기'
        ];
        
        const hasPasskeyText = passkeyKeywords.some(keyword => 
          text.toLowerCase().includes(keyword.toLowerCase())
        );
        
        const hasPasskeyUrl = url.includes('passkey') || 
                              url.includes('passwordless') ||
                              url.includes('signinoptions');
        
        return hasPasskeyText || hasPasskeyUrl;
      });
      
      if (isPasskeyPage) {
        this.log('패스키 페이지 감지됨 - "나중에" 버튼 찾기', 'warning');
        
        // "나중에" 버튼 찾기 (다양한 선택자 시도)
        const skipButton = await page.evaluate(() => {
          // 텍스트로 버튼 찾기
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
          
          const skipTexts = [
            '나중에',
            'Not now',
            'Skip',
            'Later',
            'Maybe later',
            '건너뛰기',
            'Remind me later',
            '다음에',
            'No thanks',
            '아니요',
            'Decline'
          ];
          
          for (const button of buttons) {
            const buttonText = button.innerText || button.textContent || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            
            for (const skipText of skipTexts) {
              if (buttonText.toLowerCase().includes(skipText.toLowerCase()) ||
                  ariaLabel.toLowerCase().includes(skipText.toLowerCase())) {
                const rect = button.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: buttonText.trim(),
                  selector: button.tagName
                };
              }
            }
          }
          
          // 링크로도 찾기
          const links = Array.from(document.querySelectorAll('a'));
          for (const link of links) {
            const linkText = link.innerText || link.textContent || '';
            for (const skipText of skipTexts) {
              if (linkText.toLowerCase().includes(skipText.toLowerCase())) {
                const rect = link.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: linkText.trim(),
                  selector: 'LINK'
                };
              }
            }
          }
          
          return { found: false };
        });
        
        if (skipButton.found) {
          this.log(`"나중에" 버튼 찾음: "${skipButton.text}" (${skipButton.selector})`, 'success');
          
          // 버튼 클릭
          await page.mouse.move(skipButton.x, skipButton.y);
          await new Promise(r => setTimeout(r, 300));
          await page.mouse.click(skipButton.x, skipButton.y);
          
          this.log('패스키 건너뛰기 완료', 'success');
          await new Promise(r => setTimeout(r, 3000));
          
          // 로그인 완료 확인
          const afterSkipUrl = page.url();
          if (afterSkipUrl.includes('youtube.com') && !afterSkipUrl.includes('accounts.google.com')) {
            this.log('패스키 건너뛰기 후 YouTube로 이동 성공', 'success');
          }
        } else {
          this.log('나중에 버튼을 찾을 수 없음 - 수동으로 처리 필요', 'error');
          
          // 대체 방법: ESC 키 또는 브라우저 뒤로가기
          try {
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 2000));
            
            const afterEscUrl = page.url();
            if (!afterEscUrl.includes('passkey') && !afterEscUrl.includes('passwordless')) {
              this.log('ESC 키로 패스키 페이지 우회 성공', 'success');
            }
          } catch (e) {
            this.log('ESC 키 우회도 실패', 'error');
          }
        }
      } else {
        this.log('패스키 페이지 아님 - 정상 진행', 'info');
      }
      
    } catch (error) {
      this.log(`패스키 페이지 처리 중 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 계정 복구 옵션 페이지 처리
   */
  async handleAccountRecoveryOptions(page) {
    try {
      this.log('계정 복구 옵션 페이지 확인 중...', 'info');
      
      // 페이지 로드 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 계정 복구 페이지인지 확인
      const isRecoveryPage = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const url = window.location.href;
        
        // 계정 복구 관련 키워드 확인
        const recoveryKeywords = [
          '언제든지 로그인할 수 있도록 설정하세요',
          '복구 옵션',
          '복구 정보를 업데이트',
          'recovery options',
          'Account Recovery Options',
          'Update recovery info',
          'Make your account easier to recover',
          '북구 이메일 추가',
          '북구 이메일을 입력하세요'
        ];
        
        const hasRecoveryText = recoveryKeywords.some(keyword => 
          text.toLowerCase().includes(keyword.toLowerCase())
        );
        
        const hasRecoveryUrl = url.includes('recoveryoptions') || 
                               url.includes('recovery') ||
                               url.includes('accountrecovery') ||
                               url.includes('signin/v2/challenge');
        
        return hasRecoveryText || hasRecoveryUrl;
      });
      
      if (isRecoveryPage) {
        this.log('계정 복구 옵션 페이지 감지됨 - "취소" 또는 "건너뛰기" 버튼 찾기', 'warning');
        
        // "취소" 또는 "건너뛰기" 버튼 찾기
        const skipButton = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], a'));
          
          const skipTexts = [
            '취소',
            '건너뛰기',
            '나중에',
            'Cancel',
            'Skip',
            'Not now',
            'Later',
            'Done',
            '완료'
          ];
          
          for (const button of buttons) {
            const buttonText = button.innerText || button.textContent || '';
            const ariaLabel = button.getAttribute('aria-label') || '';
            
            for (const skipText of skipTexts) {
              if (buttonText.toLowerCase().includes(skipText.toLowerCase()) ||
                  ariaLabel.toLowerCase().includes(skipText.toLowerCase())) {
                const rect = button.getBoundingClientRect();
                return {
                  found: true,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  text: buttonText
                };
              }
            }
          }
          
          return { found: false };
        });
        
        if (skipButton.found) {
          this.log(`계정 복구 페이지에서 "${skipButton.text}" 버튼 클릭`, 'info');
          await page.mouse.click(skipButton.x, skipButton.y);
          await new Promise(r => setTimeout(r, 3000));
          
          // 페이지 변경 확인
          const afterUrl = page.url();
          if (!afterUrl.includes('recovery')) {
            this.log('계정 복구 페이지 우회 성공', 'success');
            return true;
          }
        } else {
          this.log('계정 복구 페이지 버튼을 찾지 못함 - ESC 키 시도', 'warning');
          
          // ESC 키로 우회 시도
          try {
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 2000));
            
            const afterEscUrl = page.url();
            if (!afterEscUrl.includes('recovery')) {
              this.log('ESC 키로 계정 복구 페이지 우회 성공', 'success');
              return true;
            }
          } catch (e) {
            this.log('ESC 키 우회도 실패', 'error');
          }
        }
        
        // 최후의 수단: 직접 URL 이동
        this.log('직접 YouTube Premium 페이지로 이동 시도', 'warning');
        return false; // 호출하는 쪽에서 직접 이동 처리
      } else {
        this.log('계정 복구 페이지 아님 - 정상 진행', 'info');
        return true;
      }
      
    } catch (error) {
      this.log(`계정 복구 페이지 처리 중 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 통합 로그인 프로세스
   */
  async performLogin(page, credentials) {
    try {
      this.log('🔐 로그인 프로세스 시작', 'info');
      
      // 자동화 감지 우회 설정
      await page.setBypassCSP(true);
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
      });
      
      const currentUrl = page.url();
      
      // 1. 계정 선택 페이지 처리
      if (currentUrl.includes('accountchooser')) {
        const handled = await this.handleAccountChooser(page, credentials.email);
        if (!handled) {
          return { success: false, reason: 'Failed to handle account chooser' };
        }
      } else if (currentUrl.includes('accounts.google.com')) {
        // 2. 이미 로그인 페이지인 경우
        const hasEmailField = await page.$('input[type="email"], input#identifierId');
        if (hasEmailField) {
          await this.inputEmail(page, credentials.email);
        }
      }
      
      // 3. 비밀번호 입력
      const hasPasswordField = await page.$('input[type="password"]');
      if (hasPasswordField && credentials.password) {
        await this.inputPassword(page, credentials.password);
      }
      
      // 4. 로그인 완료 대기
      await new Promise(r => setTimeout(r, 5000));
      
      // 5. 패스키 페이지 처리 (performLogin에서도 호출)
      await this.handlePasskeyPage(page);
      
      // 6. 계정 복구 옵션 페이지 처리
      await this.handleAccountRecoveryOptions(page);
      
      // 7. 최종 상태 확인
      const finalUrl = page.url();
      if (finalUrl.includes('youtube.com') && !finalUrl.includes('accounts.google.com')) {
        this.log('✅ 로그인 성공!', 'success');
        
        // YouTube Premium 페이지로 직접 이동
        try {
          this.log('YouTube Premium 페이지로 직접 이동 중...', 'info');
          await page.goto('https://www.youtube.com/paid_memberships', {
            waitUntil: 'networkidle2',
            timeout: 30000
          });
          
          // 페이지 로드 대기
          await new Promise(r => setTimeout(r, 3000));
          
          // 로그인 상태 재확인
          const isStillLoggedIn = await this.isLoggedIn(page);
          if (isStillLoggedIn) {
            this.log('✅ YouTube Premium 페이지 이동 및 로그인 확인 완료', 'success');
            return { success: true, navigatedToPremium: true };
          } else {
            this.log('⚠️ YouTube Premium 페이지 이동 후 로그인 상태 확인 실패', 'warning');
            return { success: true, navigatedToPremium: false };
          }
        } catch (navError) {
          this.log(`YouTube Premium 페이지 이동 중 오류: ${navError.message}`, 'error');
          return { success: true, navigatedToPremium: false };
        }
      }
      
      // 7. 2단계 인증 확인
      const has2FA = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.includes('2-Step Verification') || 
               text.includes('2단계 인증') ||
               text.includes('확인 코드');
      });
      
      if (has2FA) {
        this.log('2단계 인증이 필요합니다', 'warning');
        return { success: false, reason: '2FA required' };
      }
      
      return { success: false, reason: 'Login incomplete' };
      
    } catch (error) {
      this.log(`❌ 로그인 실패: ${error.message}`, 'error');
      return { success: false, reason: error.message };
    }
  }
}

module.exports = WorkingAuthenticationService;