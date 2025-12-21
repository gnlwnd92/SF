/**
 * Ultimate Authentication Service
 * ULTIMATE_GOOGLE_LOGIN_AUTOMATION_GUIDE_2025.md 기반 최적화된 로그인 서비스
 * 
 * 핵심 전략:
 * 1. 실제 Chrome 세션 재사용 (성공률 95%)
 * 2. Undetected 모드 (성공률 85%)
 * 3. Human Behavior Simulation
 * 4. Profile Rotation
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

class UltimateAuthenticationService {
  constructor(options = {}) {
    this.config = {
      debugMode: options.debugMode || false,
      strategy: options.strategy || 'hybrid', // hybrid, undetected, realSession
      maxRetries: options.maxRetries || 3,
      humanBehavior: options.humanBehavior !== false,
      profileRotation: options.profileRotation !== false,
      ...options
    };
    
    this.profileManager = new ProfileRotator();
    this.behaviorEngine = new HumanBehavior();
    this.attemptHistory = new Map();
  }
  
  /**
   * 최적화된 로그인 프로세스
   */
  async performLogin(page, credentials) {
    try {
      this.log('🚀 Ultimate 로그인 프로세스 시작', 'info');
      
      // 1. 전략 선택
      const strategy = this.selectStrategy(credentials.email);
      this.log(`선택된 전략: ${strategy}`, 'info');
      
      // 2. 감지 우회 설정 적용
      await this.applyUltimateEvasion(page);
      
      // 3. 전략별 로그인 수행
      let result;
      switch (strategy) {
        case 'realSession':
          result = await this.useRealChromeSession(credentials);
          break;
        case 'undetected':
          result = await this.performUndetectedLogin(page, credentials);
          break;
        default:
          result = await this.performHybridLogin(page, credentials);
      }
      
      // 4. 성공 기록
      if (result.success) {
        this.recordSuccess(credentials.email, strategy);
      }
      
      return result;
      
    } catch (error) {
      this.log(`로그인 실패: ${error.message}`, 'error');
      
      // 실패시 자동 폴백
      return await this.fallbackStrategy(page, credentials);
    }
  }
  
  /**
   * 전략 선택 (성공률 기반)
   */
  selectStrategy(email) {
    const history = this.attemptHistory.get(email);
    
    // 이전 성공 전략이 있으면 재사용
    if (history?.lastSuccess) {
      return history.lastSuccess;
    }
    
    // 실패 횟수에 따른 전략 변경
    const failureCount = history?.failures || 0;
    
    if (failureCount === 0) {
      // 첫 시도: Undetected 모드 (빠르고 성공률 높음)
      return 'undetected';
    } else if (failureCount === 1) {
      // 두번째 시도: 실제 세션
      return 'realSession';
    } else {
      // 세번째 이상: 하이브리드 + 수동
      return 'hybrid';
    }
  }
  
  /**
   * Ultimate Evasion 설정 (가이드 기반)
   */
  async applyUltimateEvasion(page) {
    // 1. 기본 webdriver 제거 (안전한 방법)
    await page.evaluateOnNewDocument(() => {
      // webdriver 제거
      const newProto = navigator.__proto__;
      delete newProto.webdriver;
      
      // Chrome 객체 복원
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      }
      
      // Permissions API 정상화
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };
      
      // Plugin 배열 정상화
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', length: 1 },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
          { name: 'Native Client', filename: 'internal-nacl-plugin', length: 2 }
        ]
      });
      
      // 언어 설정
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en']
      });
    });
    
    // 2. CDP를 통한 추가 우회
    try {
      const client = await page.target().createCDPSession();
      
      // User-Agent 정상화
      await client.send('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      
      // WebGL Vendor 수정
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.apply(this, arguments);
          };
        `
      });
      
      await client.detach();
    } catch (error) {
      this.log('CDP 우회 설정 실패 (계속 진행)', 'warning');
    }
    
    // 3. 타이밍 랜덤화
    await page.setDefaultTimeout(30000 + Math.random() * 10000);
    await page.setDefaultNavigationTimeout(30000 + Math.random() * 10000);
  }
  
  /**
   * Undetected 로그인 (성공률 85%)
   */
  async performUndetectedLogin(page, credentials) {
    this.log('🥷 Undetected 모드 로그인 시작', 'info');
    
    try {
      // 1. 로그인 페이지 이동
      await page.goto('https://accounts.google.com/ServiceLogin', {
        waitUntil: 'networkidle2'
      });
      
      // 2. 페이지 로드 대기 (인간적인 지연)
      await this.behaviorEngine.wait(2000 + Math.random() * 2000);
      
      // 3. 이메일 입력
      const emailInput = await page.waitForSelector('input[type="email"], input#identifierId', {
        visible: true,
        timeout: 10000
      });
      
      if (emailInput) {
        // 클릭 전 마우스 이동
        const box = await emailInput.boundingBox();
        if (box && this.config.humanBehavior) {
          await this.behaviorEngine.moveMouseHuman(page, box.x + box.width/2, box.y + box.height/2);
        }
        
        await emailInput.click();
        await this.behaviorEngine.wait(500 + Math.random() * 500);
        
        // 인간적인 타이핑
        if (this.config.humanBehavior) {
          await this.behaviorEngine.typeHuman(emailInput, credentials.email);
        } else {
          await emailInput.type(credentials.email, { delay: 100 + Math.random() * 50 });
        }
        
        // 다음 버튼 클릭
        await this.behaviorEngine.wait(500 + Math.random() * 1000);
        
        const nextButton = await page.$('#identifierNext');
        if (nextButton) {
          const nextBox = await nextButton.boundingBox();
          if (nextBox && this.config.humanBehavior) {
            await this.behaviorEngine.moveMouseHuman(page, nextBox.x + nextBox.width/2, nextBox.y + nextBox.height/2);
          }
          await nextButton.click();
        } else {
          await page.keyboard.press('Enter');
        }
        
        // 4. 비밀번호 페이지 대기
        await this.behaviorEngine.wait(2000 + Math.random() * 2000);
        
        const passwordInput = await page.waitForSelector('input[type="password"]', {
          visible: true,
          timeout: 10000
        });
        
        if (passwordInput) {
          await passwordInput.click();
          await this.behaviorEngine.wait(500 + Math.random() * 500);
          
          // 비밀번호 입력
          if (this.config.humanBehavior) {
            await this.behaviorEngine.typeHuman(passwordInput, credentials.password);
          } else {
            await passwordInput.type(credentials.password, { delay: 100 + Math.random() * 50 });
          }
          
          // 로그인 버튼 클릭
          await this.behaviorEngine.wait(500 + Math.random() * 1000);
          
          const passwordNext = await page.$('#passwordNext');
          if (passwordNext) {
            await passwordNext.click();
          } else {
            await page.keyboard.press('Enter');
          }
          
          // 5. 로그인 완료 대기
          await this.behaviorEngine.wait(3000 + Math.random() * 2000);
          
          // 6. 성공 확인
          const currentUrl = page.url();
          if (!currentUrl.includes('accounts.google.com/signin')) {
            this.log('✅ Undetected 로그인 성공', 'success');
            return { success: true, method: 'undetected' };
          }
        }
      }
      
      return { success: false, error: 'Login failed' };
      
    } catch (error) {
      this.log(`Undetected 로그인 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 실제 Chrome 세션 사용 (성공률 95%)
   */
  async useRealChromeSession(credentials) {
    this.log('🌐 실제 Chrome 세션 사용', 'info');
    
    // 실제 Chrome을 디버그 모드로 실행하는 명령
    const chromeCommand = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\ChromeProfile_${Date.now()}"`;
    
    this.log('Chrome을 디버그 모드로 실행해주세요:', 'yellow');
    this.log(chromeCommand, 'white');
    this.log('실행 후 Enter를 눌러주세요...', 'yellow');
    
    // 사용자 확인 대기
    await this.waitForUserConfirmation();
    
    try {
      // 실제 Chrome에 연결
      const puppeteer = require('puppeteer-core');
      const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null
      });
      
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      
      // 로그인 페이지로 이동
      await page.goto('https://accounts.google.com');
      
      this.log('브라우저에서 직접 로그인해주세요.', 'yellow');
      this.log('로그인 완료 후 Enter를 눌러주세요...', 'yellow');
      
      await this.waitForUserConfirmation();
      
      // 로그인 확인
      const currentUrl = page.url();
      if (!currentUrl.includes('accounts.google.com/signin')) {
        this.log('✅ 실제 세션 로그인 성공', 'success');
        return { success: true, method: 'realSession', browser, page };
      }
      
    } catch (error) {
      this.log(`실제 세션 연결 실패: ${error.message}`, 'error');
    }
    
    return { success: false, error: 'Real session failed' };
  }
  
  /**
   * 하이브리드 로그인 (폴백)
   */
  async performHybridLogin(page, credentials) {
    this.log('🔀 하이브리드 로그인 시작', 'info');
    
    // Undetected 시도
    let result = await this.performUndetectedLogin(page, credentials);
    
    if (!result.success) {
      // 실패시 수동 개입 요청
      this.log('자동 로그인 실패. 수동 로그인이 필요합니다.', 'warning');
      this.log('브라우저에서 직접 로그인해주세요.', 'yellow');
      this.log('로그인 완료 후 Enter를 눌러주세요...', 'yellow');
      
      await this.waitForUserConfirmation();
      
      const currentUrl = page.url();
      if (!currentUrl.includes('accounts.google.com')) {
        return { success: true, method: 'manual' };
      }
    }
    
    return result;
  }
  
  /**
   * 폴백 전략
   */
  async fallbackStrategy(page, credentials) {
    const failureCount = this.recordFailure(credentials.email);
    
    if (failureCount < this.config.maxRetries) {
      this.log(`재시도 ${failureCount}/${this.config.maxRetries}`, 'warning');
      
      // 지수 백오프
      await this.behaviorEngine.wait(Math.pow(2, failureCount) * 1000);
      
      // 다른 전략으로 재시도
      return await this.performLogin(page, credentials);
    }
    
    // 최종 수단: 수동
    this.log('모든 자동화 시도 실패. 수동 로그인 필요.', 'error');
    return { success: false, requiresManual: true };
  }
  
  /**
   * 성공/실패 기록
   */
  recordSuccess(email, strategy) {
    const history = this.attemptHistory.get(email) || { failures: 0 };
    history.lastSuccess = strategy;
    history.failures = 0;
    this.attemptHistory.set(email, history);
  }
  
  recordFailure(email) {
    const history = this.attemptHistory.get(email) || { failures: 0 };
    history.failures++;
    this.attemptHistory.set(email, history);
    return history.failures;
  }
  
  waitForUserConfirmation() {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
  
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') return;
    
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      white: 'white',
      debug: 'gray'
    };
    
    console.log(chalk[colors[level] || 'white'](`[UltimateAuth] ${message}`));
  }
}

/**
 * Human Behavior Engine
 * 인간적인 행동 시뮬레이션
 */
class HumanBehavior {
  async typeHuman(element, text) {
    for (const char of text) {
      await element.type(char);
      
      // 가변 지연 (Gaussian 분포)
      const delay = this.gaussianRandom(100, 30);
      await this.wait(delay);
      
      // 5% 확률로 오타 + 수정
      if (Math.random() < 0.05 && char !== '@' && char !== '.') {
        await element.type('x');
        await this.wait(200);
        await element.press('Backspace');
        await this.wait(150);
      }
    }
  }
  
  async moveMouseHuman(page, targetX, targetY) {
    const steps = 20 + Math.random() * 10;
    const currentPos = await page.evaluate(() => ({
      x: window.mouseX || Math.random() * 500,
      y: window.mouseY || Math.random() * 500
    }));
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 베지어 곡선
      const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      
      const x = currentPos.x + (targetX - currentPos.x) * easedT;
      const y = currentPos.y + (targetY - currentPos.y) * easedT;
      
      // 미세한 떨림
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;
      
      await page.mouse.move(x + jitterX, y + jitterY);
      await this.wait(10 + Math.random() * 20);
    }
  }
  
  gaussianRandom(mean, stdDev) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return num * stdDev + mean;
  }
  
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Profile Rotator
 * 프로필 로테이션 관리
 */
class ProfileRotator {
  constructor() {
    this.profiles = new Map();
    this.profileDir = path.join(process.cwd(), 'chrome-profiles');
    fs.ensureDirSync(this.profileDir);
  }
  
  async getOrCreateProfile(email) {
    if (!this.profiles.has(email)) {
      const profilePath = path.join(this.profileDir, `profile_${Buffer.from(email).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`);
      fs.ensureDirSync(profilePath);
      
      this.profiles.set(email, {
        path: profilePath,
        useCount: 0,
        lastUsed: null
      });
    }
    
    const profile = this.profiles.get(email);
    profile.useCount++;
    profile.lastUsed = new Date();
    
    // 3회 사용 후 리셋
    if (profile.useCount >= 3) {
      await this.resetProfile(email);
    }
    
    return profile.path;
  }
  
  async resetProfile(email) {
    const profile = this.profiles.get(email);
    if (profile) {
      // 캐시만 삭제 (쿠키는 유지)
      const cachePath = path.join(profile.path, 'Default', 'Cache');
      if (fs.existsSync(cachePath)) {
        await fs.remove(cachePath);
      }
      profile.useCount = 0;
    }
  }
}

module.exports = UltimateAuthenticationService;