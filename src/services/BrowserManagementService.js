/**
 * BrowserManagementService - 브라우저 생명주기 관리 서비스
 * 
 * AdsPower 브라우저 연결, 상태 모니터링, 자동 재연결, 리소스 정리
 * 브라우저 크래시 처리 및 복구 메커니즘 포함
 */

const chalk = require('chalk');
const axios = require('axios');
const { chromium } = require('playwright');
// 포트 자동 감지 유틸리티
const { getApiUrl } = require('../utils/adsPowerPortDetector');

class BrowserManagementService {
  constructor(config = {}) {
    this.configApiUrl = config.apiUrl || 'http://local.adspower.com:50325';
    this.apiUrl = null; // 초기화 시 설정됨
    this.initialized = false;

    this.config = {
      debugMode: config.debugMode || false,
      connectTimeout: config.connectTimeout || 30000,
      reconnectAttempts: config.reconnectAttempts || 3,
      reconnectDelay: config.reconnectDelay || 5000,
      healthCheckInterval: config.healthCheckInterval || 30000,
      resourceCleanupInterval: config.resourceCleanupInterval || 60000,
      maxMemoryUsage: config.maxMemoryUsage || 512 * 1024 * 1024, // 512MB
      ...config
    };
    
    // 활성 연결 관리
    this.connections = new Map();
    
    // 헬스체크 타이머
    this.healthCheckTimers = new Map();
    
    // 리소스 모니터링
    this.resourceMonitor = null;
    
    // 연결 통계
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
      reconnections: 0,
      crashes: 0
    };
  }

  /**
   * API 클라이언트 초기화 (포트 자동 감지)
   */
  async initialize(silent = true) {
    if (this.initialized) {
      return;
    }

    try {
      this.apiUrl = await getApiUrl(this.configApiUrl, silent);
      this.initialized = true;

      if (!silent && this.config.debugMode) {
        this.log(`✅ API 초기화 완료: ${this.apiUrl}`, 'info');
      }
    } catch (error) {
      if (!silent) {
        this.log(`❌ API 초기화 실패: ${error.message}`, 'error');
      }
      throw error;
    }
  }

  /**
   * AdsPower 브라우저에 연결
   */
  async connect(profileId, options = {}) {
    // API 초기화 확인
    if (!this.initialized) {
      await this.initialize(true);
    }
    const startTime = Date.now();
    this.log(`프로필 ${profileId} 브라우저 연결 중...`, 'info');
    
    try {
      // 이미 연결된 경우 재사용
      if (this.connections.has(profileId)) {
        const existing = this.connections.get(profileId);
        if (existing.browser && existing.browser.isConnected()) {
          this.log(`기존 연결 재사용: ${profileId}`, 'debug');
          return existing;
        }
      }
      
      // AdsPower API로 브라우저 시작
      const browserInfo = await this.startBrowser(profileId);
      
      if (!browserInfo.success) {
        throw new Error(`브라우저 시작 실패: ${browserInfo.message}`);
      }
      
      // Playwright로 연결
      const wsEndpoint = browserInfo.ws?.puppeteer || browserInfo.ws?.playwright;
      
      if (!wsEndpoint) {
        throw new Error('WebSocket 엔드포인트를 찾을 수 없습니다');
      }
      
      this.log(`WebSocket 연결: ${wsEndpoint}`, 'debug');
      
      // 브라우저 연결
      const browser = await chromium.connectOverCDP(wsEndpoint, {
        timeout: this.config.connectTimeout
      });
      
      // 페이지 가져오기
      const pages = browser.contexts()[0].pages();
      const page = pages.length > 0 ? pages[0] : await browser.contexts()[0].newPage();
      
      // 연결 정보 저장
      const connection = {
        profileId,
        browser,
        page,
        wsEndpoint,
        connectedAt: new Date().toISOString(),
        lastHealthCheck: Date.now()
      };
      
      this.connections.set(profileId, connection);
      
      // 헬스체크 시작
      this.startHealthCheck(profileId);
      
      // 통계 업데이트
      this.stats.totalConnections++;
      this.stats.activeConnections = this.connections.size;
      
      const duration = Date.now() - startTime;
      this.log(`✅ 브라우저 연결 성공 (${duration}ms)`, 'success');
      
      return {
        success: true,
        browser,
        page,
        profileId,
        duration
      };
      
    } catch (error) {
      this.log(`브라우저 연결 실패: ${error.message}`, 'error');
      this.stats.failedConnections++;
      
      // 재연결 시도
      if (options.autoReconnect !== false) {
        return await this.reconnect(profileId, options);
      }
      
      throw error;
    }
  }

  /**
   * AdsPower API로 브라우저 시작
   */
  async startBrowser(profileId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/browser/start`, {
        params: {
          user_id: profileId,
          open_tabs: 1,
          headless: 0
        },
        timeout: 10000
      });
      
      return {
        success: response.data.code === 0,
        ws: response.data.data?.ws,
        message: response.data.msg
      };
      
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 브라우저 연결 해제
   */
  async disconnect(profileId, options = {}) {
    this.log(`프로필 ${profileId} 연결 해제 중...`, 'info');
    
    try {
      const connection = this.connections.get(profileId);
      
      if (!connection) {
        this.log(`연결이 없습니다: ${profileId}`, 'warning');
        return { success: true, alreadyDisconnected: true };
      }
      
      // 헬스체크 중지
      this.stopHealthCheck(profileId);
      
      // 브라우저 닫기
      if (connection.browser && connection.browser.isConnected()) {
        await connection.browser.close();
      }
      
      // AdsPower API로 브라우저 중지
      if (!options.keepBrowserOpen) {
        await this.stopBrowser(profileId);
      }
      
      // 연결 정보 제거
      this.connections.delete(profileId);
      this.stats.activeConnections = this.connections.size;
      
      this.log(`✅ 연결 해제 완료: ${profileId}`, 'success');
      
      return { success: true };
      
    } catch (error) {
      this.log(`연결 해제 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * AdsPower API로 브라우저 중지
   */
  async stopBrowser(profileId) {
    try {
      await axios.get(`${this.apiUrl}/api/v1/browser/stop`, {
        params: { user_id: profileId },
        timeout: 5000
      });
      return true;
    } catch (error) {
      this.log(`브라우저 중지 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * 재연결 시도
   */
  async reconnect(profileId, options = {}) {
    const maxAttempts = options.maxAttempts || this.config.reconnectAttempts;
    const delay = options.delay || this.config.reconnectDelay;
    
    this.log(`재연결 시도 중... (최대 ${maxAttempts}회)`, 'info');
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.log(`재연결 시도 ${attempt}/${maxAttempts}`, 'debug');
        
        // 기존 연결 정리
        await this.disconnect(profileId, { keepBrowserOpen: true });
        
        // 대기
        await this.delay(delay);
        
        // 재연결
        const result = await this.connect(profileId, {
          ...options,
          autoReconnect: false // 무한 재귀 방지
        });
        
        if (result.success) {
          this.stats.reconnections++;
          this.log(`✅ 재연결 성공 (시도 ${attempt})`, 'success');
          return result;
        }
        
      } catch (error) {
        this.log(`재연결 시도 ${attempt} 실패: ${error.message}`, 'warning');
        
        if (attempt === maxAttempts) {
          throw new Error(`재연결 실패 (${maxAttempts}회 시도)`);
        }
      }
    }
    
    throw new Error('재연결 실패');
  }

  /**
   * 모든 연결 정리
   */
  async cleanup() {
    this.log('모든 브라우저 연결 정리 중...', 'info');
    
    // 헬스체크 모두 중지
    this.healthCheckTimers.forEach((timer) => clearInterval(timer));
    this.healthCheckTimers.clear();
    
    // 리소스 모니터 중지
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
      this.resourceMonitor = null;
    }
    
    // 모든 연결 해제
    const disconnectPromises = Array.from(this.connections.keys()).map(profileId => 
      this.disconnect(profileId)
    );
    
    await Promise.allSettled(disconnectPromises);
    
    this.log('✅ 정리 완료', 'success');
    
    return {
      cleaned: disconnectPromises.length,
      stats: this.getStats()
    };
  }

  /**
   * 크래시 처리
   */
  async handleCrash(profileId, error) {
    this.log(`⚠️ 브라우저 크래시 감지: ${profileId}`, 'error');
    this.stats.crashes++;
    
    // 크래시 정보 기록
    const crashInfo = {
      profileId,
      error: error?.message || 'Unknown crash',
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage()
    };
    
    // 자동 복구 시도
    try {
      this.log('자동 복구 시도 중...', 'info');
      
      // 기존 연결 강제 정리
      const connection = this.connections.get(profileId);
      if (connection) {
        this.connections.delete(profileId);
        this.stopHealthCheck(profileId);
      }
      
      // 재연결
      const result = await this.reconnect(profileId, {
        maxAttempts: 2,
        delay: 3000
      });
      
      if (result.success) {
        this.log('✅ 자동 복구 성공', 'success');
        return {
          recovered: true,
          crashInfo,
          newConnection: result
        };
      }
      
    } catch (recoveryError) {
      this.log(`자동 복구 실패: ${recoveryError.message}`, 'error');
    }
    
    return {
      recovered: false,
      crashInfo
    };
  }

  /**
   * 헬스체크 시작
   */
  startHealthCheck(profileId) {
    // 기존 헬스체크 중지
    this.stopHealthCheck(profileId);
    
    const timer = setInterval(async () => {
      await this.performHealthCheck(profileId);
    }, this.config.healthCheckInterval);
    
    this.healthCheckTimers.set(profileId, timer);
  }

  /**
   * 헬스체크 중지
   */
  stopHealthCheck(profileId) {
    const timer = this.healthCheckTimers.get(profileId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(profileId);
    }
  }

  /**
   * 헬스체크 수행
   */
  async performHealthCheck(profileId) {
    const connection = this.connections.get(profileId);
    
    if (!connection) {
      this.stopHealthCheck(profileId);
      return;
    }
    
    try {
      // 브라우저 연결 상태 확인
      const isConnected = connection.browser && connection.browser.isConnected();
      
      if (!isConnected) {
        this.log(`헬스체크 실패: ${profileId} - 연결 끊김`, 'warning');
        await this.handleCrash(profileId, new Error('Connection lost'));
        return;
      }
      
      // 페이지 응답 확인
      try {
        await connection.page.evaluate(() => true);
        connection.lastHealthCheck = Date.now();
      } catch (error) {
        this.log(`헬스체크 실패: ${profileId} - 페이지 응답 없음`, 'warning');
        await this.handleCrash(profileId, error);
      }
      
    } catch (error) {
      this.log(`헬스체크 오류: ${error.message}`, 'error');
    }
  }

  /**
   * 리소스 모니터링 시작
   */
  startResourceMonitoring() {
    if (this.resourceMonitor) return;
    
    this.resourceMonitor = setInterval(() => {
      this.checkResourceUsage();
    }, this.config.resourceCleanupInterval);
  }

  /**
   * 리소스 사용량 확인
   */
  checkResourceUsage() {
    const memUsage = process.memoryUsage();
    
    if (memUsage.heapUsed > this.config.maxMemoryUsage) {
      this.log(`⚠️ 메모리 사용량 초과: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`, 'warning');
      
      // 가비지 컬렉션 강제 실행
      if (global.gc) {
        global.gc();
        this.log('가비지 컬렉션 실행', 'debug');
      }
    }
    
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      activeConnections: this.connections.size
    };
  }

  /**
   * 연결 상태 확인
   */
  getConnection(profileId) {
    return this.connections.get(profileId);
  }

  /**
   * 모든 연결 가져오기
   */
  getAllConnections() {
    return Array.from(this.connections.entries()).map(([id, conn]) => ({
      profileId: id,
      connected: conn.browser?.isConnected() || false,
      connectedAt: conn.connectedAt,
      lastHealthCheck: conn.lastHealthCheck
    }));
  }

  /**
   * 통계 가져오기
   */
  getStats() {
    return {
      ...this.stats,
      activeConnections: this.connections.size,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * 지연 함수
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    if (!this.config.debugMode && level === 'debug') {
      return;
    }
    
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[BrowserService] ${message}`));
  }

  /**
   * 서비스 상태 확인
   */
  getStatus() {
    return {
      service: 'BrowserManagementService',
      ready: true,
      connections: this.getAllConnections(),
      stats: this.getStats(),
      config: {
        debugMode: this.config.debugMode,
        apiUrl: this.config.apiUrl,
        reconnectAttempts: this.config.reconnectAttempts
      }
    };
  }
}

module.exports = BrowserManagementService;