/**
 * Human-like Click Service
 * AdsPower 브라우저에서 자동화 감지를 우회하기 위한 인간적인 클릭 구현
 * 
 * 이전 성공 사례 (SUBSCRIPTION_RESUME_REVIEW_LOG.md)를 기반으로 구현
 */

const chalk = require('chalk');

class HumanLikeClickService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.currentMouse = { x: 0, y: 0 };
  }

  log(message, type = 'info') {
    if (!this.debugMode) return;
    
    const prefix = '[HumanClick]';
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
   * 랜덤 지연 생성
   */
  getRandomDelay(min = 50, max = 150) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 베지어 곡선을 사용한 자연스러운 마우스 경로 생성
   */
  generateBezierPath(start, end, steps = 10) {
    const path = [];
    
    // 제어점 생성 (약간의 랜덤성 추가)
    const control1 = {
      x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 50,
      y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 50
    };
    
    const control2 = {
      x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 50,
      y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 50
    };
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.pow(1-t, 3) * start.x + 
                3 * Math.pow(1-t, 2) * t * control1.x + 
                3 * (1-t) * Math.pow(t, 2) * control2.x + 
                Math.pow(t, 3) * end.x;
                
      const y = Math.pow(1-t, 3) * start.y + 
                3 * Math.pow(1-t, 2) * t * control1.y + 
                3 * (1-t) * Math.pow(t, 2) * control2.y + 
                Math.pow(t, 3) * end.y;
                
      path.push({ x, y });
    }
    
    return path;
  }

  /**
   * 인간적인 마우스 움직임 시뮬레이션
   */
  async moveMouseNaturally(page, targetX, targetY) {
    this.log(`마우스 이동: (${this.currentMouse.x}, ${this.currentMouse.y}) → (${targetX}, ${targetY})`);
    
    const path = this.generateBezierPath(
      this.currentMouse,
      { x: targetX, y: targetY },
      15 // 더 많은 단계로 부드럽게
    );
    
    for (const point of path) {
      await page.mouse.move(point.x, point.y);
      await new Promise(r => setTimeout(r, this.getRandomDelay(10, 30)));
    }
    
    this.currentMouse = { x: targetX, y: targetY };
  }

  /**
   * 인간적인 클릭 수행 (이전 성공 사례 기반)
   */
  async performHumanLikeClick(page, x, y, identifier = '') {
    try {
      this.log(`Human-like 클릭 시작: ${identifier} at (${x}, ${y})`, 'info');
      
      // 1. 자연스러운 마우스 이동
      await this.moveMouseNaturally(page, x, y);
      
      // 2. 호버 효과를 위한 짧은 대기
      await new Promise(r => setTimeout(r, this.getRandomDelay(100, 300)));
      
      // 3. 마우스 다운 (누르기)
      await page.mouse.down();
      this.log('마우스 다운', 'info');
      
      // 4. 인간적인 클릭 지속 시간
      await new Promise(r => setTimeout(r, this.getRandomDelay(50, 150)));
      
      // 5. 마우스 업 (떼기)
      await page.mouse.up();
      this.log('마우스 업', 'info');
      
      // 6. 클릭 후 짧은 대기
      await new Promise(r => setTimeout(r, this.getRandomDelay(200, 500)));
      
      this.log(`Human-like 클릭 완료: ${identifier}`, 'success');
      return true;
      
    } catch (error) {
      this.log(`Human-like 클릭 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Google 계정 선택 페이지에서 계정 클릭 (특화된 메서드)
   */
  async clickGoogleAccount(page, email) {
    try {
      this.log(`Google 계정 클릭 시도: ${email}`, 'info');
      
      // 1. 계정 요소 찾기 및 위치 계산
      const accountInfo = await page.evaluate((targetEmail) => {
        const element = document.querySelector(`[data-identifier="${targetEmail}"]`);
        if (!element) return null;
        
        // 클릭 가능한 부모 요소 찾기
        const parent = element.closest('li') || 
                      element.closest('[role="link"]') || 
                      element.closest('.JDAKTe') ||
                      element.closest('.d2CFce');
        
        if (!parent) return null;
        
        const rect = parent.getBoundingClientRect();
        
        // 요소의 중앙이 아닌 약간 랜덤한 위치 선택 (더 자연스럽게)
        const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
        const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
        
        return {
          x: x,
          y: y,
          width: rect.width,
          height: rect.height,
          text: parent.innerText || '',
          isLoggedOut: (parent.innerText || '').includes('로그아웃됨')
        };
      }, email);
      
      if (!accountInfo) {
        this.log('계정 요소를 찾을 수 없음', 'error');
        return false;
      }
      
      this.log(`계정 발견: ${email} (${accountInfo.isLoggedOut ? '로그아웃됨' : '로그인됨'})`, 'info');
      
      // 2. 페이지 스크롤 (요소가 화면에 보이도록)
      await page.evaluate((y) => {
        window.scrollTo({
          top: y - window.innerHeight / 2,
          behavior: 'smooth'
        });
      }, accountInfo.y);
      
      await new Promise(r => setTimeout(r, this.getRandomDelay(500, 1000)));
      
      // 3. Human-like 클릭 수행
      const success = await this.performHumanLikeClick(
        page, 
        accountInfo.x, 
        accountInfo.y, 
        email
      );
      
      if (success) {
        // 4. 클릭 후 페이지 전환 대기
        await new Promise(r => setTimeout(r, this.getRandomDelay(2000, 3000)));
        
        // 5. 페이지 전환 확인
        const newUrl = page.url();
        const hasPasswordField = await page.evaluate(() => {
          return !!document.querySelector('input[type="password"]');
        });
        
        if (hasPasswordField) {
          this.log('비밀번호 페이지로 전환 성공!', 'success');
          return true;
        } else if (!newUrl.includes('accountchooser')) {
          this.log('계정 선택 페이지를 벗어남', 'success');
          return true;
        } else {
          this.log('페이지 전환 실패 - 추가 시도 필요', 'warning');
          
          // 실패 시 대체 방법: 더 강한 클릭
          await this.performStrongClick(page, accountInfo.x, accountInfo.y);
          return false;
        }
      }
      
      return false;
      
    } catch (error) {
      this.log(`계정 클릭 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 더 강한 클릭 (실패 시 대체 방법)
   */
  async performStrongClick(page, x, y) {
    try {
      this.log('강한 클릭 시도', 'warning');
      
      // 1. 직접 좌표 클릭
      await page.mouse.click(x, y, { clickCount: 1, delay: 100 });
      await new Promise(r => setTimeout(r, 1000));
      
      // 2. JavaScript 클릭 이벤트 발생
      await page.evaluate(({x, y}) => {
        const element = document.elementFromPoint(x, y);
        if (element) {
          // 모든 클릭 관련 이벤트 발생
          ['mousedown', 'mouseup', 'click'].forEach(eventType => {
            const event = new MouseEvent(eventType, {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y
            });
            element.dispatchEvent(event);
          });
        }
      }, {x, y});
      
      this.log('강한 클릭 완료', 'success');
      
    } catch (error) {
      this.log(`강한 클릭 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 일반 버튼 클릭 (Human-like)
   */
  async clickButton(page, selector, buttonText = '') {
    try {
      this.log(`버튼 클릭 시도: ${buttonText || selector}`, 'info');
      
      // 버튼 요소 찾기
      const button = await page.$(selector);
      if (!button) {
        this.log('버튼을 찾을 수 없음', 'error');
        return false;
      }
      
      // 버튼 위치 가져오기
      const box = await button.boundingBox();
      if (!box) {
        this.log('버튼 위치를 가져올 수 없음', 'error');
        return false;
      }
      
      // 버튼 중앙이 아닌 약간 랜덤한 위치 클릭
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      
      // Human-like 클릭 수행
      return await this.performHumanLikeClick(page, x, y, buttonText);
      
    } catch (error) {
      this.log(`버튼 클릭 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 입력 필드에 텍스트 입력 (Human-like)
   */
  async typeText(page, selector, text) {
    try {
      this.log(`텍스트 입력: ${selector}`, 'info');
      
      const input = await page.$(selector);
      if (!input) {
        this.log('입력 필드를 찾을 수 없음', 'error');
        return false;
      }
      
      // 입력 필드 클릭
      await input.click();
      await new Promise(r => setTimeout(r, this.getRandomDelay(200, 500)));
      
      // 기존 텍스트 선택 및 삭제
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await new Promise(r => setTimeout(r, this.getRandomDelay(100, 200)));
      
      // 한 글자씩 입력 (랜덤 딜레이)
      for (const char of text) {
        await page.keyboard.type(char);
        await new Promise(r => setTimeout(r, this.getRandomDelay(50, 150)));
      }
      
      this.log('텍스트 입력 완료', 'success');
      return true;
      
    } catch (error) {
      this.log(`텍스트 입력 오류: ${error.message}`, 'error');
      return false;
    }
  }
}

module.exports = HumanLikeClickService;