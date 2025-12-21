const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { EventEmitter } = require('events');

// Stealth 플러그인 적용 (테스트 스크립트와 동일)
puppeteer.use(StealthPlugin());

/**
 * @class AdsPowerAdapterFixed
 * @description 수정된 AdsPower 브라우저 자동화 어댑터 (테스트된 방식 적용)
 */
class AdsPowerAdapterFixed extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // 설정
    this.config = {
      apiUrl: config.apiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      debugMode: config.debugMode || false,
      simpleMode: config.simpleMode !== false // 기본적으로 단순 모드 사용
    };

    // 상태 관리
    this.activeSessions = new Map();
    this.browserInstances = new Map();
    
    // API 클라이언트 설정
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * API 연결 확인
   */
  async checkConnection() {
    try {
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: { page_size: 1 }
      });
      return response.data.code === 0;
    } catch (error) {
      this.emit('error', { type: 'connection', error });
      return false;
    }
  }

  /**
   * 프로필 목록 조회
   */
  async getProfiles(options = {}) {
    try {
      const params = {
        page_size: options.pageSize || 100,
        page_no: options.page || 1
      };

      if (options.groupName) params.group_name = options.groupName;
      if (options.searchText) params.search = options.searchText;

      const response = await this.apiClient.get('/api/v1/user/list', { params });
      
      if (response.data.code !== 0) {
        throw new Error(response.data.msg || 'Failed to get profiles');
      }

      return {
        profiles: response.data.data.list || [],
        total: response.data.data.total_count || 0,
        page: response.data.data.page_no || 1,
        pageSize: response.data.data.page_size || params.page_size
      };
    } catch (error) {
      this.emit('error', { type: 'api', method: 'getProfiles', error });
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
          wsEndpoint: data.ws?.puppeteer || null,
          debugPort: data.debug_port || null
        };
      }
      
      return { isActive: false };
    } catch (error) {
      this.emit('debug', `브라우저 상태 확인 실패: ${error.message}`);
      return { isActive: false };
    }
  }

  /**
   * 브라우저 실행 (테스트된 단순한 방식)
   */
  async launchBrowser(profileId, options = {}) {
    try {
      // 1. 기존 세션 확인
      if (this.activeSessions.has(profileId)) {
        const session = this.activeSessions.get(profileId);
        if (session.browser && session.browser.isConnected()) {
          this.emit('info', `Profile ${profileId} already running`);
          return session;
        } else {
          this.activeSessions.delete(profileId);
          this.browserInstances.delete(profileId);
        }
      }

      // 2. 브라우저 상태 확인
      const browserStatus = await this.checkBrowserStatus(profileId);
      
      if (browserStatus.isActive && browserStatus.wsEndpoint) {
        this.emit('info', `Reconnecting to existing browser for ${profileId}`);
        
        try {
          // 단순한 재연결 (테스트와 동일)
          const browser = await puppeteer.connect({
            browserWSEndpoint: browserStatus.wsEndpoint,
            defaultViewport: null
          });
          
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
          
          return session;
        } catch (reconnectError) {
          this.emit('warning', `재연결 실패, 새로 시작: ${reconnectError.message}`);
          await this.apiClient.get('/api/v1/browser/stop', {
            params: { user_id: profileId }
          }).catch(() => {});
        }
      }

      // 3. 새 브라우저 시작
      const params = {
        user_id: profileId,
        open_tabs: options.openTabs || 1
      };

      const response = await this.apiClient.get('/api/v1/browser/start', { params });
      
      if (response.data.code !== 0) {
        throw new Error(response.data.msg || 'Failed to launch browser');
      }

      const data = response.data.data;
      
      // 단순한 Puppeteer 연결 (테스트와 동일)
      const browser = await puppeteer.connect({
        browserWSEndpoint: data.ws.puppeteer,
        defaultViewport: null
      });
      
      // 세션 저장
      const session = {
        profileId,
        browser,
        wsEndpoint: data.ws.puppeteer,
        debugPort: data.debug_port,
        startTime: new Date(),
        pages: new Map()
      };

      this.activeSessions.set(profileId, session);
      this.browserInstances.set(profileId, browser);

      this.emit('browser:launched', { profileId, session });
      
      return session;
      
    } catch (error) {
      this.emit('error', { type: 'browser:launch', profileId, error });
      throw error;
    }
  }

  /**
   * 페이지 가져오기 또는 생성
   */
  async getPage(browser, options = {}) {
    try {
      const pages = await browser.pages();
      
      if (pages.length > 0) {
        const page = pages[0];
        
        // 기본 타임아웃 설정
        page.setDefaultTimeout(this.config.timeout);
        page.setDefaultNavigationTimeout(this.config.timeout);
        
        return page;
      }
      
      // 새 페이지 생성
      const page = await browser.newPage();
      
      // 기본 타임아웃 설정
      page.setDefaultTimeout(this.config.timeout);
      page.setDefaultNavigationTimeout(this.config.timeout);
      
      return page;
      
    } catch (error) {
      this.emit('error', { type: 'page:get', error });
      throw error;
    }
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId) {
    try {
      // 로컬 세션 정리
      this.activeSessions.delete(profileId);
      this.browserInstances.delete(profileId);
      
      // AdsPower API로 브라우저 종료
      const response = await this.apiClient.get('/api/v1/browser/stop', {
        params: { user_id: profileId }
      });
      
      if (response.data.code !== 0) {
        throw new Error(response.data.msg || 'Failed to close browser');
      }
      
      this.emit('browser:closed', { profileId });
      return true;
      
    } catch (error) {
      this.emit('error', { type: 'browser:close', profileId, error });
      return false;
    }
  }

  /**
   * 모든 브라우저 종료
   */
  async closeAllBrowsers() {
    const results = [];
    
    for (const [profileId] of this.activeSessions) {
      const result = await this.closeBrowser(profileId);
      results.push({ profileId, success: result });
    }
    
    return results;
  }

  /**
   * 페이지 네비게이션 (SPA 지원)
   */
  async navigateTo(page, url, options = {}) {
    try {
      await page.goto(url, {
        waitUntil: options.waitUntil || 'networkidle2',
        timeout: options.timeout || this.config.timeout
      });
      
      // 추가 안정화 대기
      await new Promise(r => setTimeout(r, 2000));
      
      return true;
    } catch (error) {
      this.emit('error', { type: 'navigation', url, error });
      throw error;
    }
  }

  /**
   * 요소 클릭 (native click 사용)
   */
  async clickElement(page, selector, options = {}) {
    try {
      // 요소 대기
      await page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout || 10000
      });
      
      // Native click 사용 (테스트와 동일)
      const element = await page.$(selector);
      if (element) {
        await element.click();
        
        // SPA 네비게이션 대기
        if (options.waitForNavigation) {
          await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
            new Promise(r => setTimeout(r, 3000)))
          ]);
        } else {
          await new Promise(r => setTimeout(r, 1000));
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      this.emit('error', { type: 'click', selector, error });
      return false;
    }
  }

  /**
   * 텍스트 입력
   */
  async typeText(page, selector, text, options = {}) {
    try {
      // 요소 대기
      await page.waitForSelector(selector, {
        visible: true,
        timeout: options.timeout || 10000
      });
      
      // 기존 텍스트 삭제
      if (options.clear) {
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
      }
      
      // 텍스트 입력
      await page.type(selector, text, {
        delay: options.delay || 100
      });
      
      return true;
    } catch (error) {
      this.emit('error', { type: 'type', selector, error });
      return false;
    }
  }

  /**
   * 현재 활성 세션 목록
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * 세션 정보 가져오기
   */
  getSession(profileId) {
    return this.activeSessions.get(profileId);
  }
}

module.exports = AdsPowerAdapterFixed;