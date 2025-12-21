/**
 * AdsPower 브라우저 어댑터 - 최소 파라미터 버전
 * GUI 실행과 동일하게 최소한의 파라미터만 사용
 */

const axios = require('axios');
const puppeteer = require('puppeteer');
const EventEmitter = require('events');
const { setupStealthPage } = require('./StealthHelper');
const { applyAdvancedEvasion } = require('./AdvancedEvasionHelper');

class AdsPowerAdapterMinimal extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      apiUrl: config.apiUrl || 'http://local.adspower.net:50325',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      debugMode: config.debugMode || false,
      stealthMode: config.stealthMode !== false,
      // 브라우저 실행 모드
      launchMode: config.launchMode || 'minimal' // minimal, standard, custom
    };
    
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout
    });
    
    this.activeSessions = new Map();
    this.browserInstances = new Map();
  }

  /**
   * 브라우저 실행 - GUI와 동일한 최소 파라미터 방식
   */
  async launchBrowser(profileId, options = {}) {
    try {
      // 1. 기존 세션 확인
      if (this.activeSessions.has(profileId)) {
        const session = this.activeSessions.get(profileId);
        if (session.browser && session.browser.isConnected()) {
          this.emit('info', `Profile ${profileId} already running (from cache)`);
          return session;
        } else {
          this.activeSessions.delete(profileId);
          this.browserInstances.delete(profileId);
        }
      }

      // 2. AdsPower API를 통해 브라우저 상태 확인
      const browserStatus = await this.checkBrowserStatus(profileId);
      
      if (browserStatus.isActive && browserStatus.wsEndpoint) {
        this.emit('info', `Profile ${profileId} already running (from API)`);
        
        try {
          const browser = await this.connectPuppeteer(browserStatus.wsEndpoint, profileId);
          
          const session = {
            profileId,
            browser,
            wsEndpoint: browserStatus.wsEndpoint,
            debugPort: browserStatus.debugPort,
            startTime: new Date(),
            pages: new Map(),
            reused: true
          };
          
          this.activeSessions.set(profileId, session);
          this.browserInstances.set(profileId, browser);
          
          this.emit('browser:reused', { profileId, session });
          return session;
          
        } catch (reconnectError) {
          this.emit('warning', `재연결 실패, 새로 시작: ${reconnectError.message}`);
          await this.apiClient.get('/api/v1/browser/stop', {
            params: { user_id: profileId }
          }).catch(() => {});
        }
      }

      // 3. 새 브라우저 시작 - 실행 모드에 따른 파라미터 설정
      let params;
      
      switch (this.config.launchMode) {
        case 'minimal':
          // GUI와 동일 - user_id만 전송
          params = {
            user_id: profileId
          };
          this.emit('info', `최소 파라미터 모드로 브라우저 실행 (GUI 동일)`);
          break;
          
        case 'secure':
          // 보안 강화 모드
          params = {
            user_id: profileId,
            disable_password_filling: 1,  // 자동 채우기 비활성화
            enable_password_saving: 0     // 비밀번호 저장 비활성화
          };
          this.emit('info', `보안 강화 모드로 브라우저 실행`);
          break;
          
        case 'stealth':
          // 자동화 회피 모드
          params = {
            user_id: profileId,
            launch_args: JSON.stringify([
              "--disable-blink-features=AutomationControlled",
              "--exclude-switches=enable-automation",
              "--disable-infobars",
              "--disable-dev-shm-usage",
              "--no-sandbox",
              "--disable-setuid-sandbox"
            ])
          };
          this.emit('info', `자동화 회피 모드로 브라우저 실행`);
          break;
          
        case 'standard':
        default:
          // 기존 표준 모드
          params = {
            user_id: profileId,
            open_tabs: options.openTabs || 1,
            ip_tab: 0,
            headless: 0,
            disable_password_filling: 0,
            clear_cache_after_closing: 0,
            enable_password_saving: 1
          };
          this.emit('info', `표준 모드로 브라우저 실행`);
          break;
      }

      // 커스텀 파라미터 오버라이드
      if (options.customParams) {
        params = { ...params, ...options.customParams };
        this.emit('info', `커스텀 파라미터 적용: ${JSON.stringify(options.customParams)}`);
      }

      // 재시도 로직
      let lastError;
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          this.emit('info', `브라우저 시작 중... (시도 ${attempt}/${this.config.retryAttempts})`);
          
          const response = await this.apiClient.get('/api/v1/browser/start', { params });
          
          if (this.config.debugMode) {
            console.log('API Response:', JSON.stringify(response.data, null, 2));
            console.log('사용된 파라미터:', params);
          }
          
          if (response.data.code !== 0) {
            throw new Error(response.data.msg || 'Failed to launch browser');
          }

          const data = response.data.data;
          
          // Puppeteer 연결
          const browser = await this.connectPuppeteer(data.ws.puppeteer, profileId);
          
          // 세션 저장
          const session = {
            profileId,
            browser,
            wsEndpoint: data.ws.puppeteer,
            debugPort: data.debug_port,
            webdriver: data.webdriver,
            startTime: new Date(),
            pages: new Map(),
            launchMode: this.config.launchMode,
            parameters: params
          };
          
          this.activeSessions.set(profileId, session);
          this.browserInstances.set(profileId, browser);
          
          this.emit('browser:launched', { profileId, session });
          
          return session;
          
        } catch (error) {
          lastError = error;
          this.emit('warning', `시도 ${attempt} 실패: ${error.message}`);
          
          if (attempt < this.config.retryAttempts) {
            await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          }
        }
      }
      
      throw lastError || new Error('Failed to launch browser after all attempts');
      
    } catch (error) {
      this.emit('error', { type: 'browser:launch', profileId, error });
      throw error;
    }
  }

  /**
   * 브라우저 상태 확인
   */
  async checkBrowserStatus(profileId) {
    try {
      const response = await this.apiClient.get('/api/v1/browser/active', {
        params: { user_id: profileId }
      });
      
      if (response.data.code === 0 && response.data.data) {
        const data = response.data.data;
        return {
          isActive: data.status === 'Active',
          wsEndpoint: data.ws?.puppeteer,
          debugPort: data.debug_port,
          webdriver: data.webdriver
        };
      }
      
      return { isActive: false };
      
    } catch (error) {
      this.emit('debug', `브라우저 상태 확인 실패: ${error.message}`);
      return { isActive: false };
    }
  }

  /**
   * Puppeteer 연결
   */
  async connectPuppeteer(wsEndpoint, profileId) {
    try {
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null,
        slowMo: this.config.stealthMode ? this.getRandomDelay(30, 100) : 0
      });

      // 스텔스 설정 적용 (launchMode가 minimal일 때는 최소화)
      if (this.config.launchMode !== 'minimal') {
        const pages = await browser.pages();
        for (const page of pages) {
          await setupStealthPage(page);
          await this.applyStealthSettings(page);
          if (this.config.launchMode === 'stealth') {
            await applyAdvancedEvasion(page);
          }
        }

        browser.on('targetcreated', async (target) => {
          if (target.type() === 'page') {
            const page = await target.page();
            if (page) {
              await setupStealthPage(page);
              await this.applyStealthSettings(page);
              if (this.config.launchMode === 'stealth') {
                await applyAdvancedEvasion(page);
              }
            }
          }
        });
      }

      return browser;
      
    } catch (error) {
      this.emit('error', { type: 'puppeteer:connect', profileId, error });
      throw error;
    }
  }

  /**
   * 스텔스 설정 적용 (최소화 버전)
   */
  async applyStealthSettings(page) {
    if (this.config.launchMode === 'minimal') {
      // 최소 모드에서는 스텔스 설정 생략
      return;
    }
    
    try {
      // 기본 네비게이터 속성만 수정
      await page.evaluateOnNewDocument(() => {
        // webdriver 속성 숨기기
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
        
        // plugins 배열 설정
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
      });
      
    } catch (error) {
      this.emit('debug', `스텔스 설정 적용 실패: ${error.message}`);
    }
  }

  /**
   * 랜덤 지연 시간 생성
   */
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId) {
    try {
      // 로컬 세션 정리
      if (this.activeSessions.has(profileId)) {
        const session = this.activeSessions.get(profileId);
        if (session.browser) {
          await session.browser.disconnect();
        }
        this.activeSessions.delete(profileId);
        this.browserInstances.delete(profileId);
      }
      
      // AdsPower API로 브라우저 종료
      await this.apiClient.get('/api/v1/browser/stop', {
        params: { user_id: profileId }
      });
      
      this.emit('browser:closed', { profileId });
      
    } catch (error) {
      this.emit('error', { type: 'browser:close', profileId, error });
      throw error;
    }
  }

  /**
   * 모든 브라우저 종료
   */
  async closeAllBrowsers() {
    const profileIds = Array.from(this.activeSessions.keys());
    
    for (const profileId of profileIds) {
      await this.closeBrowser(profileId).catch(error => {
        this.emit('warning', `Failed to close browser ${profileId}: ${error.message}`);
      });
    }
  }
}

module.exports = AdsPowerAdapterMinimal;