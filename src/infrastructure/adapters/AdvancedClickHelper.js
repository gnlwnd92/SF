/**
 * Advanced Click Helper for AdsPower Browser
 * AdsPower 브라우저에서 클릭이 제대로 작동하지 않는 문제를 해결
 */

const chalk = require('chalk');

class AdvancedClickHelper {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      maxRetries: config.maxRetries || 3,
      ...config
    };
  }

  /**
   * 모든 클릭 방법을 시도하는 메인 메서드
   */
  async clickElement(selector, options = {}) {
    console.log(chalk.blue(`\n클릭 시도: ${selector}`));
    
    // 1. 먼저 요소가 존재하는지 확인
    const element = await this.page.$(selector);
    if (!element) {
      console.log(chalk.red(`요소를 찾을 수 없음: ${selector}`));
      return false;
    }

    // 2. 요소 정보 수집
    const elementInfo = await this.getElementInfo(element);
    console.log(chalk.gray('요소 정보:'), elementInfo);

    // 클릭 전 URL 저장
    const beforeUrl = this.page.url();

    // 3. 여러 클릭 방법 시도
    const clickMethods = [
      { name: 'CDP 클릭', fn: () => this.cdpClick(element) },
      { name: 'dispatchEvent 클릭', fn: () => this.dispatchEventClick(element) },
      { name: '마우스 이벤트 시뮬레이션', fn: () => this.simulateMouseClick(element) },
      { name: 'JavaScript 강제 클릭', fn: () => this.forceJavaScriptClick(element) },
      { name: 'Puppeteer 기본 클릭', fn: () => this.puppeteerClick(element) },
      { name: 'Enter 키 시뮬레이션', fn: () => this.enterKeyClick(element) }
    ];

    for (const method of clickMethods) {
      try {
        console.log(chalk.yellow(`시도: ${method.name}`));
        await method.fn();
        
        // 클릭 후 대기
        await new Promise(r => setTimeout(r, 2000));
        
        // 페이지 변화 확인
        const afterUrl = this.page.url();
        const pageChanged = beforeUrl !== afterUrl;
        
        if (pageChanged) {
          console.log(chalk.green(`✅ ${method.name} 성공 - 페이지 전환됨`));
          console.log(chalk.gray(`  이전: ${beforeUrl}`));
          console.log(chalk.gray(`  이후: ${afterUrl}`));
          return true;
        }
        
        // DOM 변화 확인
        const domChanged = await this.checkDOMChange(selector);
        if (domChanged) {
          console.log(chalk.green(`✅ ${method.name} 성공 - DOM 변경됨`));
          return true;
        }
        
        console.log(chalk.yellow(`${method.name} - 변화 없음`));
        
      } catch (error) {
        console.log(chalk.red(`${method.name} 실패:`, error.message));
      }
    }

    console.log(chalk.red('❌ 모든 클릭 방법 실패'));
    return false;
  }

  /**
   * 요소 정보 수집
   */
  async getElementInfo(element) {
    return await element.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      
      return {
        tagName: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        visible: el.offsetParent !== null,
        clickable: computed.pointerEvents !== 'none' && computed.cursor === 'pointer',
        position: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        attributes: {
          role: el.getAttribute('role'),
          jsname: el.getAttribute('jsname'),
          dataIdentifier: el.getAttribute('data-identifier'),
          onclick: !!el.onclick,
          href: el.getAttribute('href')
        }
      };
    });
  }

  /**
   * CDP(Chrome DevTools Protocol)를 사용한 클릭
   */
  async cdpClick(element) {
    const client = await this.page.target().createCDPSession();
    
    try {
      // 요소의 중앙 좌표 계산
      const box = await element.boundingBox();
      if (!box) throw new Error('요소의 위치를 찾을 수 없음');
      
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      
      // CDP로 마우스 이벤트 전송
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      });
      
      await new Promise(r => setTimeout(r, 50));
      
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      });
      
    } finally {
      await client.detach();
    }
  }

  /**
   * dispatchEvent를 사용한 클릭
   */
  async dispatchEventClick(element) {
    await element.evaluate(el => {
      // MouseEvent 생성
      const mousedownEvent = new MouseEvent('mousedown', {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      
      const mouseupEvent = new MouseEvent('mouseup', {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 0
      });
      
      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      });
      
      // 이벤트 발생
      el.dispatchEvent(mousedownEvent);
      el.dispatchEvent(mouseupEvent);
      el.dispatchEvent(clickEvent);
      
      // PointerEvent도 시도 (최신 브라우저)
      const pointerDownEvent = new PointerEvent('pointerdown', {
        view: window,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse'
      });
      
      const pointerUpEvent = new PointerEvent('pointerup', {
        view: window,
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse'
      });
      
      el.dispatchEvent(pointerDownEvent);
      el.dispatchEvent(pointerUpEvent);
    });
  }

  /**
   * 마우스 이벤트 완전 시뮬레이션
   */
  async simulateMouseClick(element) {
    const box = await element.boundingBox();
    if (!box) throw new Error('요소의 위치를 찾을 수 없음');
    
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    
    // 마우스 이동
    await this.page.mouse.move(x, y, { steps: 10 });
    await new Promise(r => setTimeout(r, 100));
    
    // hover 이벤트 발생
    await element.hover();
    await new Promise(r => setTimeout(r, 100));
    
    // 마우스 다운
    await this.page.mouse.down();
    await new Promise(r => setTimeout(r, 50));
    
    // 마우스 업
    await this.page.mouse.up();
  }

  /**
   * JavaScript 강제 클릭
   */
  async forceJavaScriptClick(element) {
    await element.evaluate(el => {
      // 직접 클릭
      el.click();
      
      // href가 있는 경우 직접 이동
      const href = el.getAttribute('href');
      if (href && href !== '#') {
        window.location.href = href;
      }
      
      // onclick 핸들러가 있는 경우 실행
      if (el.onclick) {
        el.onclick();
      }
      
      // 부모 요소들의 클릭 핸들러도 실행
      let parent = el.parentElement;
      while (parent) {
        if (parent.onclick) {
          parent.onclick();
          break;
        }
        parent = parent.parentElement;
      }
    });
  }

  /**
   * Puppeteer 기본 클릭
   */
  async puppeteerClick(element) {
    // 여러 옵션으로 시도
    const clickOptions = [
      { delay: 100 },
      { clickCount: 1, delay: 50 },
      { button: 'left' },
      {}
    ];
    
    for (const options of clickOptions) {
      try {
        await element.click(options);
        await new Promise(r => setTimeout(r, 500));
        return;
      } catch (e) {
        // 다음 옵션 시도
      }
    }
  }

  /**
   * Enter 키로 클릭 시뮬레이션
   */
  async enterKeyClick(element) {
    // 요소에 포커스
    await element.focus();
    await new Promise(r => setTimeout(r, 100));
    
    // Space 키 시도
    await this.page.keyboard.press('Space');
    await new Promise(r => setTimeout(r, 500));
    
    // Enter 키 시도
    await this.page.keyboard.press('Enter');
  }

  /**
   * DOM 변화 확인
   */
  async checkDOMChange(selector) {
    try {
      // 원래 요소가 사라졌는지 확인
      const element = await this.page.$(selector);
      if (!element) {
        return true; // 요소가 사라짐 = 변화 발생
      }
      
      // 새로운 요소가 나타났는지 확인
      const hasEmailField = await this.page.$('input[type="email"]');
      const hasPasswordField = await this.page.$('input[type="password"]');
      
      return !!(hasEmailField || hasPasswordField);
      
    } catch (error) {
      return false;
    }
  }
}

module.exports = AdvancedClickHelper;