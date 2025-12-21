/**
 * Ultimate AdsPower Adapter
 * ULTIMATE_GOOGLE_LOGIN_AUTOMATION_GUIDE_2025.md 기반 최적화
 * 
 * 핵심 개선사항:
 * 1. Chromium 사용 (Chrome 대신)
 * 2. 최소한의 자동화 플래그
 * 3. 실제 Chrome 세션 연결 지원
 * 4. 프로필 로테이션
 */

const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { EventEmitter } = require('events');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');

// Stealth 플러그인 커스터마이징
const stealth = StealthPlugin();
// 문제가 되는 evasion 비활성화
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
stealth.enabledEvasions.delete('navigator.webdriver');  // 직접 처리

puppeteer.use(stealth);

class UltimateAdsPowerAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      apiUrl: config.apiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
      timeout: config.timeout || 30000,
      debugMode: config.debugMode || false,
      
      // Ultimate 설정
      useChromium: config.useChromium !== false,  // Chromium 사용
      realSessionPort: config.realSessionPort || 9222,  // 실제 Chrome 포트
      profileRotation: config.profileRotation !== false,
      maxProfileUse: config.maxProfileUse || 3,
      
      // 브라우저 경로
      chromiumPath: config.chromiumPath || this.findChromiumPath(),
      
      ...config
    };
    
    this.activeSessions = new Map();
    this.profileManager = new ProfileManager();
    
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout
    });
  }
  
  /**
   * Chromium 경로 찾기
   */
  findChromiumPath() {
    const possiblePaths = [
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',  // 대체
      process.env.CHROMIUM_PATH
    ];
    
    for (const path of possiblePaths) {
      if (path && fs.existsSync(path)) {
        this.log(`Chromium 경로: ${path}`, 'debug');
        return path;
      }
    }
    
    return null;  // Puppeteer 기본값 사용
  }
  
  /**
   * Ultimate 브라우저 실행
   */
  async launchUltimateBrowser(profileId, options = {}) {
    try {
      this.log('🚀 Ultimate 브라우저 실행', 'info');
      
      // 1. 실제 Chrome 세션 시도
      if (options.useRealSession) {
        const realSession = await this.connectToRealChrome();
        if (realSession) {
          return realSession;
        }
      }
      
      // 2. AdsPower를 통한 브라우저 실행
      const params = {
        user_id: profileId,
        open_tabs: 1,
        // 핵심: 자동화 관련 플래그 제거
        launch_args: JSON.stringify([
          '--disable-blink-features=AutomationControlled',
          '--exclude-switches=enable-automation',
          '--disable-features=site-per-process',
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins',
          '--disable-site-isolation-trials',
          '--window-size=1920,1080',
          '--start-maximized'
        ])
      };
      
      // 프로필 로테이션
      if (this.config.profileRotation) {
        const profilePath = await this.profileManager.getProfile(profileId);
        if (profilePath) {
          params.user_data_dir = profilePath;
        }
      }
      
      const response = await this.apiClient.get('/api/v1/browser/start', { params });
      
      if (response.data.code !== 0) {
        throw new Error(response.data.msg || 'Failed to launch browser');
      }
      
      const data = response.data.data;
      
      // 3. Puppeteer 연결 (Ultimate 설정)
      const browser = await this.connectUltimatePuppeteer(data.ws.puppeteer, profileId);
      
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      
      // 4. Ultimate Evasion 적용
      await this.applyUltimateEvasion(page);
      
      const session = {
        profileId,
        browser,
        page,
        wsEndpoint: data.ws.puppeteer,
        debugPort: data.debug_port,
        mode: 'ultimate',
        startTime: new Date()
      };
      
      this.activeSessions.set(profileId, session);
      
      this.emit('browser:launched', { profileId, session });
      
      return session;
      
    } catch (error) {
      this.emit('error', { type: 'browser:launch', profileId, error });
      throw error;
    }
  }
  
  /**
   * 실제 Chrome 세션 연결
   */
  async connectToRealChrome() {
    try {
      this.log('실제 Chrome 세션 연결 시도...', 'info');
      
      const puppeteerCore = require('puppeteer-core');
      const browser = await puppeteerCore.connect({
        browserURL: `http://127.0.0.1:${this.config.realSessionPort}`,
        defaultViewport: null
      });
      
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      
      this.log('✅ 실제 Chrome 세션 연결 성공', 'success');
      
      return {
        browser,
        page,
        mode: 'realSession',
        wsEndpoint: null
      };
      
    } catch (error) {
      this.log('실제 Chrome 세션 연결 실패 (AdsPower로 폴백)', 'warning');
      return null;
    }
  }
  
  /**
   * Ultimate Puppeteer 연결
   */
  async connectUltimatePuppeteer(wsEndpoint, profileId) {
    const connectOptions = {
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null,
      // slowMo 제거 - 자동화 신호
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled']
    };
    
    // Chromium 경로 설정
    if (this.config.useChromium && this.config.chromiumPath) {
      connectOptions.executablePath = this.config.chromiumPath;
    }
    
    const browser = await puppeteer.connect(connectOptions);
    
    // 브라우저 수준 설정
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        const page = await target.page();
        if (page) {
          await this.applyUltimateEvasion(page);
        }
      }
    });
    
    return browser;
  }
  
  /**
   * Ultimate Evasion 적용
   */
  async applyUltimateEvasion(page) {
    // 1. 안전한 webdriver 제거
    await page.evaluateOnNewDocument(() => {
      // webdriver 속성 제거 (프로토타입 체인 조작)
      const newProto = navigator.__proto__;
      delete newProto.webdriver;
      
      // Chrome 객체 복원
      if (!window.chrome || !window.chrome.runtime) {
        window.chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {}
          },
          loadTimes: function() {
            return {
              commitLoadTime: Date.now() / 1000,
              connectionInfo: 'cellular',
              finishDocumentLoadTime: Date.now() / 1000,
              finishLoadTime: Date.now() / 1000,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1000,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'h2',
              requestTime: Date.now() / 1000 - 1,
              startLoadTime: Date.now() / 1000 - 1,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: true,
              wasNpnNegotiated: true
            };
          },
          csi: function() { return { onloadT: Date.now(), pageT: 500 }; },
          app: {
            isInstalled: false,
            getDetails: () => null,
            getIsInstalled: () => false,
            installState: () => ({ DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }),
            runningState: () => ({ CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' })
          }
        };
      }
      
      // Permissions API 정상화
      if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (parameters) => {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery(parameters);
        };
      }
      
      // 플러그인 배열
      if (navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            return [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', length: 1, description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1, description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', length: 2, description: '' }
            ];
          }
        });
      }
      
      // 언어 정상화
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en']
      });
      
      // 하드웨어 동시성
      if (navigator.hardwareConcurrency < 2) {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 4 + Math.floor(Math.random() * 4)
        });
      }
      
      // 디바이스 메모리
      if (!navigator.deviceMemory || navigator.deviceMemory < 2) {
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });
      }
    });
    
    // 2. CDP를 통한 추가 설정
    try {
      const client = await page.target().createCDPSession();
      
      // User-Agent Override
      await client.send('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        platform: 'Win32'
      });
      
      // WebGL Vendor
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          // WebGL Vendor Spoofing
          const getParameter = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.apply(this, arguments);
          };
          
          // Canvas Fingerprint 노이즈 추가
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          HTMLCanvasElement.prototype.toDataURL = function() {
            const context = this.getContext('2d');
            if (context) {
              const imageData = context.getImageData(0, 0, this.width, this.height);
              for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] += Math.random() * 0.1;  // 미세한 노이즈
              }
              context.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.apply(this, arguments);
          };
        `
      });
      
      await client.detach();
      
    } catch (error) {
      this.log('CDP 설정 부분 실패 (계속 진행)', 'debug');
    }
    
    // 3. 페이지 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // 4. 타임아웃 랜덤화
    const randomTimeout = 30000 + Math.floor(Math.random() * 10000);
    page.setDefaultTimeout(randomTimeout);
    page.setDefaultNavigationTimeout(randomTimeout);
  }
  
  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId) {
    try {
      const session = this.activeSessions.get(profileId);
      
      if (session) {
        // Puppeteer 연결 해제
        if (session.browser && session.browser.isConnected()) {
          await session.browser.disconnect();
        }
        
        // AdsPower API로 브라우저 종료 (실제 세션이 아닌 경우)
        if (session.mode !== 'realSession') {
          await this.apiClient.get('/api/v1/browser/stop', {
            params: { user_id: profileId }
          });
        }
        
        this.activeSessions.delete(profileId);
      }
      
      return true;
      
    } catch (error) {
      this.log(`브라우저 종료 실패: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * 자동화 감지 체크 (디버깅용)
   */
  async checkDetection(page) {
    const signals = await page.evaluate(() => {
      return {
        webdriver: navigator.webdriver,
        chrome: !!window.chrome,
        chromeRuntime: !!window.chrome?.runtime,
        plugins: navigator.plugins.length,
        languages: navigator.languages.join(','),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        // CDP 감지
        cdpDetection: !!window.__puppeteer_evaluation_script__,
        // 함수 덮어쓰기 감지
        functionModified: Function.prototype.toString.toString() !== 'function toString() { [native code] }'
      };
    });
    
    const risks = [];
    if (signals.webdriver === true) risks.push('webdriver=true');
    if (!signals.chrome) risks.push('no-chrome');
    if (!signals.chromeRuntime) risks.push('no-chrome-runtime');
    if (signals.plugins === 0) risks.push('no-plugins');
    if (signals.cdpDetection) risks.push('cdp-detected');
    if (signals.functionModified) risks.push('function-modified');
    
    return {
      signals,
      risks,
      riskLevel: risks.length === 0 ? 'LOW' : risks.length <= 2 ? 'MEDIUM' : 'HIGH'
    };
  }
  
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') return;
    
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    console.log(chalk[colors[level] || 'white'](`[UltimateAdapter] ${message}`));
  }
}

/**
 * 프로필 관리자
 */
class ProfileManager {
  constructor() {
    this.profiles = new Map();
    this.baseDir = path.join(process.cwd(), 'chrome-profiles');
    fs.ensureDirSync(this.baseDir);
  }
  
  async getProfile(profileId) {
    if (!this.profiles.has(profileId)) {
      const profilePath = path.join(this.baseDir, `profile_${profileId}`);
      fs.ensureDirSync(profilePath);
      
      this.profiles.set(profileId, {
        path: profilePath,
        useCount: 0,
        created: new Date()
      });
    }
    
    const profile = this.profiles.get(profileId);
    profile.useCount++;
    
    // 3회 사용 후 리셋
    if (profile.useCount >= 3) {
      await this.resetProfile(profileId);
    }
    
    return profile.path;
  }
  
  async resetProfile(profileId) {
    const profile = this.profiles.get(profileId);
    if (profile) {
      const cachePath = path.join(profile.path, 'Default', 'Cache');
      if (fs.existsSync(cachePath)) {
        await fs.remove(cachePath);
      }
      profile.useCount = 0;
    }
  }
}

module.exports = UltimateAdsPowerAdapter;