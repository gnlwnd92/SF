const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs').promises;

/**
 * @class BrowserController
 * @description Puppeteer 브라우저 제어 컨트롤러 (인간적인 행동 모방)
 */
class BrowserController extends EventEmitter {
  constructor(page, config = {}) {
    super();
    
    this.page = page;
    this.config = {
      screenshotDir: config.screenshotDir || path.join(process.cwd(), 'screenshots'),
      debugMode: config.debugMode || false,
      humanMode: config.humanMode !== false, // 기본적으로 인간 모드 활성화
      ...config
    };

    // 인간적인 타이밍 설정
    this.timings = {
      typing: { min: 50, max: 150 },
      click: { min: 100, max: 500 },
      hover: { min: 50, max: 200 },
      scroll: { min: 100, max: 500 },
      wait: { min: 500, max: 2000 },
      between: { min: 200, max: 1000 }
    };

    // 마우스 위치 추적
    this.currentMousePosition = { x: 0, y: 0 };
  }

  /**
   * 랜덤 지연 생성
   */
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 인간적인 지연
   */
  async humanDelay(type = 'wait') {
    if (!this.config.humanMode) return;
    
    const timing = this.timings[type] || this.timings.wait;
    const delay = this.getRandomDelay(timing.min, timing.max);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 마우스를 베지어 공선으로 이동 (자연스러운 마우스 움직임)
   */
  async moveMouseSmoothly(targetX, targetY) {
    if (!this.config.humanMode) {
      await this.page.mouse.move(targetX, targetY);
      return;
    }

    const steps = this.getRandomDelay(10, 25);
    const startX = this.currentMousePosition.x;
    const startY = this.currentMousePosition.y;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 베지어 공선 계산
      const x = startX + (targetX - startX) * t * t * (3 - 2 * t);
      const y = startY + (targetY - startY) * t * t * (3 - 2 * t);
      
      // 약간의 랜덤 진동 추가
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;
      
      await this.page.mouse.move(x + jitterX, y + jitterY);
      await new Promise(resolve => setTimeout(resolve, this.getRandomDelay(5, 15)));
    }

    this.currentMousePosition = { x: targetX, y: targetY };
  }

  /**
   * 개선된 마우스 이동 - 가속/감속 패턴 적용
   */
  async moveMouseWithAcceleration(targetX, targetY, options = {}) {
    if (!this.config.humanMode) {
      await this.page.mouse.move(targetX, targetY);
      return;
    }

    const startX = this.currentMousePosition.x || 0;
    const startY = this.currentMousePosition.y || 0;
    
    // 거리 계산
    const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2));
    
    // 속도 프로파일 설정 (거리에 따라 조정) - 더 빠르고 자연스럽게
    const baseDuration = Math.min(1200, Math.max(200, distance * 0.8)); // 기존 1.5배에서 0.8배로 단축
    const duration = baseDuration + this.getRandomDelay(-50, 100); // 변동 폭도 줄임
    const fps = 60;
    const steps = Math.max(5, Math.ceil(duration / (1000 / fps))); // 최소 5단계는 유지
    
    // 가속도 커브 유형 랜덤 선택
    const curveTypes = ['easeInOut', 'easeOut', 'easeInOutQuad', 'easeInOutCubic'];
    const selectedCurve = curveTypes[Math.floor(Math.random() * curveTypes.length)];
    
    // 마우스 경로에 약간의 곡선 추가 (직선 이동 방지)
    const controlPointX = startX + (targetX - startX) * 0.5 + (Math.random() - 0.5) * distance * 0.2;
    const controlPointY = startY + (targetY - startY) * 0.5 + (Math.random() - 0.5) * distance * 0.2;
    
    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      let eased;
      
      // 가속/감속 곡선 적용
      switch (selectedCurve) {
        case 'easeInOut':
          eased = progress < 0.5 
            ? 2 * progress * progress 
            : -1 + (4 - 2 * progress) * progress;
          break;
        case 'easeOut':
          eased = 1 - Math.pow(1 - progress, 3);
          break;
        case 'easeInOutQuad':
          eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          break;
        case 'easeInOutCubic':
          eased = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          break;
        default:
          eased = progress;
      }
      
      // 2차 베지어 곡선을 통한 경로 계산
      const t = eased;
      const x = Math.pow(1 - t, 2) * startX + 
                2 * (1 - t) * t * controlPointX + 
                Math.pow(t, 2) * targetX;
      const y = Math.pow(1 - t, 2) * startY + 
                2 * (1 - t) * t * controlPointY + 
                Math.pow(t, 2) * targetY;
      
      // 속도에 따른 지터 조정 (빠를수록 지터 감소)
      const speed = i === 0 ? 0 : 
        Math.sqrt(Math.pow(x - this.currentMousePosition.x, 2) + 
                  Math.pow(y - this.currentMousePosition.y, 2));
      const jitterScale = Math.max(0.1, 1 - speed / 20);
      const jitterX = (Math.random() - 0.5) * 2 * jitterScale;
      const jitterY = (Math.random() - 0.5) * 2 * jitterScale;
      
      await this.page.mouse.move(x + jitterX, y + jitterY);
      
      // 프레임 간 대기 시간 (약간의 변동성 추가)
      const frameDelay = (1000 / fps) + (Math.random() - 0.5) * 5;
      await new Promise(resolve => setTimeout(resolve, frameDelay));
    }
    
    // 최종 위치 정확히 설정
    await this.page.mouse.move(targetX, targetY);
    this.currentMousePosition = { x: targetX, y: targetY };
    
    // 도착 후 미세한 조정 (인간적인 행동)
    if (Math.random() < 0.3) {
      await new Promise(resolve => setTimeout(resolve, this.getRandomDelay(50, 150)));
      const microAdjustX = targetX + (Math.random() - 0.5) * 3;
      const microAdjustY = targetY + (Math.random() - 0.5) * 3;
      await this.page.mouse.move(microAdjustX, microAdjustY);
      await new Promise(resolve => setTimeout(resolve, this.getRandomDelay(30, 80)));
      await this.page.mouse.move(targetX, targetY);
    }
  }

  /**
   * 인간적인 클릭
   */
  async humanClick(selector, options = {}) {
    try {
      // 요소 대기
      await this.waitForSelector(selector, options);
      
      // 요소 위치 가져오기
      const element = await this.page.$(selector);
      const box = await element.boundingBox();
      
      if (!box) {
        throw new Error(`Element ${selector} not visible`);
      }

      // 클릭 위치에 약간의 랜덤성 추가
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);

      // 개선된 마우스 이동 사용 (가속/감속 패턴)
      await this.moveMouseWithAcceleration(x, y);
      
      // 호버 효과
      await this.humanDelay('hover');
      
      // 클릭 전 미세한 움직임 (긴장감 표현)
      if (Math.random() < 0.2) {
        const nervousX = x + (Math.random() - 0.5) * 2;
        const nervousY = y + (Math.random() - 0.5) * 2;
        await this.page.mouse.move(nervousX, nervousY);
        await new Promise(resolve => setTimeout(resolve, this.getRandomDelay(20, 50)));
        await this.page.mouse.move(x, y);
      }
      
      // 클릭 (더 자연스러운 클릭 패턴)
      const clickDelay = this.getRandomDelay(50, 150);
      await this.page.mouse.down();
      await new Promise(resolve => setTimeout(resolve, clickDelay));
      await this.page.mouse.up();

      await this.humanDelay('click');
      
      this.emit('action', { type: 'click', selector, position: { x, y } });
      
    } catch (error) {
      this.emit('error', { type: 'click', selector, error });
      throw error;
    }
  }

  /**
   * 인간적인 타이핑
   */
  async humanType(selector, text, options = {}) {
    try {
      // 입력 필드 클릭
      await this.humanClick(selector);
      
      // 기존 텍스트 삭제 (필요시)
      if (options.clear) {
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('a');
        await this.page.keyboard.up('Control');
        await this.humanDelay('typing');
        await this.page.keyboard.press('Backspace');
      }

      // 한 글자씩 타이핑
      for (const char of text) {
        await this.page.keyboard.type(char, {
          delay: this.getRandomDelay(
            this.timings.typing.min,
            this.timings.typing.max
          )
        });
        
        // 가끔 짧은 정지
        if (Math.random() < 0.1) {
          await this.humanDelay('typing');
        }
      }

      this.emit('action', { type: 'type', selector, text: text.substring(0, 10) + '...' });
      
    } catch (error) {
      this.emit('error', { type: 'type', selector, error });
      throw error;
    }
  }

  /**
   * 인간적인 스크롤
   */
  async humanScroll(direction = 'down', distance = null) {
    try {
      const scrollDistance = distance || this.getRandomDelay(100, 500);
      const steps = this.getRandomDelay(3, 8);
      const stepDistance = scrollDistance / steps;

      for (let i = 0; i < steps; i++) {
        const scrollY = direction === 'down' ? stepDistance : -stepDistance;
        
        await this.page.evaluate((y) => {
          window.scrollBy(0, y);
        }, scrollY);
        
        await this.humanDelay('scroll');
      }

      this.emit('action', { type: 'scroll', direction, distance: scrollDistance });
      
    } catch (error) {
      this.emit('error', { type: 'scroll', error });
      throw error;
    }
  }

  /**
   * 안전한 셀렉터 대기
   */
  async waitForSelector(selector, options = {}) {
    const timeout = options.timeout || 30000;
    const visible = options.visible !== false;
    
    try {
      await this.page.waitForSelector(selector, {
        timeout,
        visible
      });
      
      // 추가 안정화 대기
      await this.humanDelay('wait');
      
      return true;
      
    } catch (error) {
      this.emit('warning', `Selector ${selector} not found within ${timeout}ms`);
      return false;
    }
  }

  /**
   * 텍스트 기반 요소 찾기 및 클릭
   */
  async clickByText(text, options = {}) {
    try {
      const element = await this.findElementByText(text, options);
      
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          
          await this.moveMouseSmoothly(x, y);
          await this.humanDelay('hover');
          await this.page.mouse.click(x, y);
          await this.humanDelay('click');
          
          this.emit('action', { type: 'clickByText', text });
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      this.emit('error', { type: 'clickByText', text, error });
      return false;
    }
  }

  /**
   * 텍스트로 요소 찾기
   */
  async findElementByText(text, options = {}) {
    const { exact = false, tag = '*' } = options;
    
    const elements = await this.page.$$(tag);
    
    for (const element of elements) {
      const textContent = await element.evaluate(el => el.textContent?.trim());
      
      if (exact ? textContent === text : textContent?.includes(text)) {
        return element;
      }
    }
    
    return null;
  }

  /**
   * 스크린샷 촬영
   */
  async takeScreenshot(name = 'screenshot') {
    try {
      // 스크린샷 디렉토리 생성
      await fs.mkdir(this.config.screenshotDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}_${timestamp}.png`;
      const filepath = path.join(this.config.screenshotDir, filename);
      
      await this.page.screenshot({
        path: filepath,
        fullPage: false
      });
      
      this.emit('screenshot', { name, filepath });
      return filepath;
      
    } catch (error) {
      this.emit('error', { type: 'screenshot', error });
      return null;
    }
  }

  /**
   * 대기 후 조건 확인
   */
  async waitForCondition(conditionFn, options = {}) {
    const timeout = options.timeout || 30000;
    const interval = options.interval || 500;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const result = await this.page.evaluate(conditionFn);
        if (result) {
          return true;
        }
      } catch (error) {
        // 평가 오류 무시
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    return false;
  }

  /**
   * 페이지 텍스트 가져오기
   */
  async getPageText() {
    try {
      return await this.page.evaluate(() => document.body.innerText);
    } catch (error) {
      this.emit('error', { type: 'getPageText', error });
      return '';
    }
  }

  /**
   * 현재 URL 가져오기
   */
  getCurrentUrl() {
    return this.page.url();
  }

  /**
   * 페이지 새로고침
   */
  async refresh(options = {}) {
    try {
      await this.page.reload({
        waitUntil: options.waitUntil || 'networkidle2',
        timeout: options.timeout || 30000
      });
      
      await this.humanDelay('wait');
      
    } catch (error) {
      this.emit('error', { type: 'refresh', error });
      throw error;
    }
  }

  /**
   * 뒤로 가기
   */
  async goBack() {
    try {
      await this.page.goBack();
      await this.humanDelay('wait');
    } catch (error) {
      this.emit('error', { type: 'goBack', error });
      throw error;
    }
  }

  /**
   * 앞으로 가기
   */
  async goForward() {
    try {
      await this.page.goForward();
      await this.humanDelay('wait');
    } catch (error) {
      this.emit('error', { type: 'goForward', error });
      throw error;
    }
  }

  /**
   * 쿠키 설정
   */
  async setCookies(cookies) {
    try {
      await this.page.setCookie(...cookies);
    } catch (error) {
      this.emit('error', { type: 'setCookies', error });
      throw error;
    }
  }

  /**
   * 쿠키 가져오기
   */
  async getCookies() {
    try {
      return await this.page.cookies();
    } catch (error) {
      this.emit('error', { type: 'getCookies', error });
      return [];
    }
  }

  /**
   * 팔로우 링크 클릭 (타겟 속성 처리)
   */
  async clickLink(selector, options = {}) {
    try {
      const element = await this.page.$(selector);
      if (!element) {
        throw new Error(`Link ${selector} not found`);
      }

      const target = await element.evaluate(el => el.getAttribute('target'));
      
      if (target === '_blank') {
        // 새 탭에서 열리는 링크 처리
        const [newPage] = await Promise.all([
          new Promise(resolve => 
            this.page.browser().once('targetcreated', async target => {
              const page = await target.page();
              resolve(page);
            })
          ),
          element.click()
        ]);
        
        return newPage;
      } else {
        await this.humanClick(selector, options);
        return this.page;
      }
      
    } catch (error) {
      this.emit('error', { type: 'clickLink', selector, error });
      throw error;
    }
  }
}

module.exports = BrowserController;