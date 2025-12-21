/**
 * Hybrid AdsPower Adapter
 * Google 자동화 감지를 우회하는 스마트 하이브리드 어댑터
 * 
 * 핵심 전략:
 * 1. 기본적으로 Puppeteer 연결 없이 브라우저만 실행
 * 2. 로그인 필요시 수동 개입 요청
 * 3. 로그인 완료 후에만 최소한의 자동화 적용
 */

const axios = require('axios');
const puppeteer = require('puppeteer');
const CDP = require('chrome-remote-interface');
const { EventEmitter } = require('events');
const chalk = require('chalk');

class HybridAdsPowerAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      apiUrl: config.apiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
      timeout: config.timeout || 30000,
      debugMode: config.debugMode || false,
      // 하이브리드 모드 설정
      autoLoginThreshold: config.autoLoginThreshold || 0.8, // 자동화 안전도 임계값
      useManualFallback: config.useManualFallback !== false, // 수동 폴백 사용
      cdpOnly: config.cdpOnly || false, // CDP만 사용 (Puppeteer 제외)
    };
    
    this.activeSessions = new Map();
    this.riskScores = new Map(); // 계정별 위험도 점수
    
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout
    });
  }
  
  /**
   * 계정 위험도 평가
   */
  assessAccountRisk(email) {
    const riskFactors = {
      newAccount: email.includes('2024') || email.includes('2025'), // 0.3
      previousFailure: this.riskScores.get(email) > 0.5, // 0.3
      highValue: email.includes('premium') || email.includes('business'), // 0.2
      recentActivity: this.hasRecentActivity(email), // 0.2
    };
    
    let score = 0;
    if (riskFactors.newAccount) score += 0.3;
    if (riskFactors.previousFailure) score += 0.3;
    if (riskFactors.highValue) score += 0.2;
    if (riskFactors.recentActivity) score += 0.2;
    
    return score;
  }
  
  hasRecentActivity(email) {
    // 최근 활동 체크 로직
    return false;
  }
  
  /**
   * 스마트 브라우저 실행 (상황별 전략 선택)
   */
  async launchSmartBrowser(profileId, options = {}) {
    try {
      const email = options.email || '';
      const riskScore = this.assessAccountRisk(email);
      
      this.log(`계정 위험도 평가: ${email} = ${riskScore.toFixed(2)}`, 'info');
      
      // 위험도에 따른 전략 선택
      if (riskScore >= this.config.autoLoginThreshold) {
        // 고위험: 완전 수동 모드
        return await this.launchManualMode(profileId, options);
      } else if (riskScore >= 0.5) {
        // 중간 위험: CDP 전용 모드
        return await this.launchCDPMode(profileId, options);
      } else {
        // 저위험: 최소 Puppeteer 모드
        return await this.launchMinimalPuppeteer(profileId, options);
      }
      
    } catch (error) {
      this.emit('error', { type: 'browser:launch', profileId, error });
      throw error;
    }
  }
  
  /**
   * 수동 모드 - Puppeteer 연결 없음
   */
  async launchManualMode(profileId, options = {}) {
    this.log('🔐 수동 모드로 브라우저 실행 (자동화 없음)', 'warning');
    
    // AdsPower API로 브라우저만 실행
    const params = {
      user_id: profileId,
      open_tabs: 1,
      // 자동화 관련 파라미터 모두 제거
    };
    
    const response = await this.apiClient.get('/api/v1/browser/start', { params });
    
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Failed to launch browser');
    }
    
    const data = response.data.data;
    
    // Puppeteer 연결하지 않음
    const session = {
      profileId,
      browser: null, // Puppeteer 없음
      page: null,
      debugPort: data.debug_port,
      webdriver: data.webdriver,
      wsEndpoint: data.ws.puppeteer,
      mode: 'manual',
      startTime: new Date()
    };
    
    this.activeSessions.set(profileId, session);
    
    // 사용자에게 수동 작업 안내
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
    this.log('브라우저가 열렸습니다. 수동으로 로그인해주세요.', 'yellow');
    this.log('로그인 완료 후 Enter를 눌러주세요...', 'yellow');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
    
    // 사용자 입력 대기
    if (options.waitForManual !== false) {
      await this.waitForUserConfirmation();
      
      // 로그인 완료 후 최소한의 CDP 연결
      if (options.connectAfterLogin) {
        session.cdp = await this.connectCDPOnly(data.debug_port);
      }
    }
    
    return session;
  }
  
  /**
   * CDP 전용 모드 - Puppeteer 없이 Chrome DevTools Protocol만 사용
   */
  async launchCDPMode(profileId, options = {}) {
    this.log('🔧 CDP 모드로 브라우저 실행 (Puppeteer 없음)', 'info');
    
    // 브라우저 시작
    const params = {
      user_id: profileId,
      open_tabs: 1
    };
    
    const response = await this.apiClient.get('/api/v1/browser/start', { params });
    
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Failed to launch browser');
    }
    
    const data = response.data.data;
    
    // CDP 직접 연결
    const cdp = await this.connectCDPOnly(data.debug_port);
    
    const session = {
      profileId,
      browser: null,
      page: null,
      cdp, // CDP 클라이언트
      debugPort: data.debug_port,
      webdriver: data.webdriver,
      wsEndpoint: data.ws.puppeteer,
      mode: 'cdp',
      startTime: new Date()
    };
    
    this.activeSessions.set(profileId, session);
    
    // CDP를 통한 기본 설정 (최소한만)
    if (cdp) {
      await this.setupMinimalCDP(cdp);
    }
    
    return session;
  }
  
  /**
   * 최소 Puppeteer 모드 - 필수 작업만 수행
   */
  async launchMinimalPuppeteer(profileId, options = {}) {
    this.log('⚡ 최소 Puppeteer 모드로 브라우저 실행', 'info');
    
    // 브라우저 시작
    const params = {
      user_id: profileId,
      open_tabs: 1
    };
    
    const response = await this.apiClient.get('/api/v1/browser/start', { params });
    
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Failed to launch browser');
    }
    
    const data = response.data.data;
    
    // 최소한의 Puppeteer 연결
    const browser = await puppeteer.connect({
      browserWSEndpoint: data.ws.puppeteer,
      defaultViewport: null
      // 중요: slowMo, ignoreHTTPSErrors 등 제거
    });
    
    const pages = await browser.pages();
    const page = pages[0];
    
    // 중요: evaluateOnNewDocument 사용하지 않음
    // 중요: setBypassCSP 사용하지 않음
    // 중요: navigator 속성 수정하지 않음
    
    // 최소한의 설정만
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    
    const session = {
      profileId,
      browser,
      page,
      cdp: null,
      debugPort: data.debug_port,
      webdriver: data.webdriver,
      wsEndpoint: data.ws.puppeteer,
      mode: 'minimal',
      startTime: new Date()
    };
    
    this.activeSessions.set(profileId, session);
    
    return session;
  }
  
  /**
   * CDP 직접 연결
   */
  async connectCDPOnly(port) {
    try {
      const client = await CDP({ port });
      const { Page, Runtime, Network } = client;
      
      await Page.enable();
      await Runtime.enable();
      await Network.enable();
      
      return client;
      
    } catch (error) {
      this.log(`CDP 연결 실패: ${error.message}`, 'error');
      return null;
    }
  }
  
  /**
   * CDP 최소 설정
   */
  async setupMinimalCDP(client) {
    try {
      const { Page, Network } = client;
      
      // 최소한의 네트워크 설정
      await Network.setExtraHTTPHeaders({
        headers: {
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });
      
      // 페이지 로드 이벤트 리스너
      Page.loadEventFired(() => {
        this.log('페이지 로드 완료', 'debug');
      });
      
    } catch (error) {
      this.log(`CDP 설정 실패: ${error.message}`, 'warning');
    }
  }
  
  /**
   * 네이티브 클릭 (CDP 사용)
   */
  async performNativeClick(session, x, y) {
    if (!session.cdp) {
      this.log('CDP 연결이 없어 네이티브 클릭 불가', 'warning');
      return false;
    }
    
    try {
      const { Input } = session.cdp;
      
      // 마우스 이동
      await Input.dispatchMouseEvent({
        type: 'mouseMoved',
        x: x,
        y: y
      });
      
      // 자연스러운 지연
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      
      // 클릭
      await Input.dispatchMouseEvent({
        type: 'mousePressed',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      });
      
      await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
      
      await Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x: x,
        y: y,
        button: 'left',
        clickCount: 1
      });
      
      return true;
      
    } catch (error) {
      this.log(`네이티브 클릭 실패: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * 네이티브 타이핑 (CDP 사용)
   */
  async performNativeType(session, text) {
    if (!session.cdp) {
      this.log('CDP 연결이 없어 네이티브 타이핑 불가', 'warning');
      return false;
    }
    
    try {
      const { Input } = session.cdp;
      
      for (const char of text) {
        await Input.dispatchKeyEvent({
          type: 'keyDown',
          text: char,
          key: char
        });
        
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
        
        await Input.dispatchKeyEvent({
          type: 'keyUp',
          text: char,
          key: char
        });
      }
      
      return true;
      
    } catch (error) {
      this.log(`네이티브 타이핑 실패: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * 사용자 확인 대기
   */
  async waitForUserConfirmation() {
    return new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }
  
  /**
   * 자동화 신호 체크 (디버깅용)
   */
  async checkAutomationSignals(session) {
    if (!session.page) {
      return { error: 'No Puppeteer page available' };
    }
    
    try {
      const signals = await session.page.evaluate(() => {
        return {
          webdriver: navigator.webdriver,
          chrome: !!window.chrome,
          chromeRuntime: !!window.chrome?.runtime,
          cdpDetected: !!window.__puppeteer_evaluation_script__,
          headless: navigator.userAgent.includes('HeadlessChrome'),
          plugins: navigator.plugins.length,
          languages: navigator.languages.join(',')
        };
      });
      
      const risks = [];
      if (signals.webdriver === true) risks.push('webdriver=true');
      if (!signals.chrome) risks.push('no-chrome');
      if (!signals.chromeRuntime) risks.push('no-runtime');
      if (signals.cdpDetected) risks.push('cdp-detected');
      if (signals.headless) risks.push('headless');
      if (signals.plugins === 0) risks.push('no-plugins');
      
      return {
        signals,
        risks,
        riskLevel: risks.length === 0 ? 'LOW' : 
                  risks.length <= 2 ? 'MEDIUM' : 'HIGH'
      };
      
    } catch (error) {
      return { error: error.message };
    }
  }
  
  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId) {
    try {
      const session = this.activeSessions.get(profileId);
      
      // Puppeteer 연결 해제
      if (session?.browser?.isConnected()) {
        await session.browser.disconnect();
      }
      
      // CDP 연결 해제
      if (session?.cdp) {
        await session.cdp.close();
      }
      
      // AdsPower API로 브라우저 종료
      await this.apiClient.get('/api/v1/browser/stop', {
        params: { user_id: profileId }
      });
      
      this.activeSessions.delete(profileId);
      
      return true;
      
    } catch (error) {
      this.log(`브라우저 종료 실패: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') {
      return;
    }
    
    const colors = {
      error: 'red',
      warning: 'yellow',
      success: 'green',
      info: 'cyan',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[HybridAdapter] ${message}`));
  }
}

module.exports = HybridAdsPowerAdapter;