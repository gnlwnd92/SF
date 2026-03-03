const axios = require('axios');
const puppeteer = require('puppeteer');
const { EventEmitter } = require('events');
const { execSync } = require('child_process');
// v4.0 - EnhancedStealthAdapter 완전 제거 (AdsPower 기본 기능만 사용)
// v4.1 - DialogHandler 통합 (beforeunload 다이얼로그 자동 처리)
const DialogHandler = require('../../utils/DialogHandler');

/**
 * @class AdsPowerAdapter
 * @description AdsPower 브라우저 자동화 어댑터 (자동화 감지 회피 적용)
 * v4.1 - beforeunload 다이얼로그 자동 처리 기능 추가
 */
class AdsPowerAdapter extends EventEmitter {
  constructor(config = {}) {
    super();

    // 환경변수에서 API URL 가져오기
    const envApiUrl = config.apiUrl || process.env.ADSPOWER_API_URL || 'auto';

    // v4.2 - 자동 포트 감지 모드 지원
    // 'auto' 또는 포트 없는 URL이면 자동 감지 모드
    this.autoDetectMode = envApiUrl === 'auto' ||
                          envApiUrl === 'AUTO' ||
                          !envApiUrl.match(/:(\d+)$/);

    // 설정
    this.config = {
      apiUrl: this.autoDetectMode ? 'http://127.0.0.1:50325' : envApiUrl, // 기본값 설정
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 2000,
      debugMode: config.debugMode || false,
      // v4.0 - 모든 커스텀 스텔스 코드 제거
      // AdsPower 기본 기능만으로 충분
    };

    // v4.0 - 스텔스 어댑터 완전 제거 (AdsPower가 모든 것을 처리)
    // this.stealthAdapter 참조 모두 제거됨

    // 상태 관리
    this.activeSessions = new Map();
    this.browserInstances = new Map();

    // API 클라이언트 설정 (자동 감지 모드면 나중에 업데이트됨)
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 인간적인 타이밍 설정
    this.humanTiming = {
      minDelay: 100,
      maxDelay: 3000,
      typingSpeed: { min: 50, max: 150 },
      clickDelay: { min: 50, max: 500 },
      scrollDelay: { min: 100, max: 500 },
      pageLoadDelay: { min: 2000, max: 5000 }
    };

    // v4.1 - DialogHandler 인스턴스 (beforeunload 자동 처리)
    this.dialogHandler = new DialogHandler({
      debugMode: config.debugMode,
      autoAccept: true,
      logDialogs: true  // 다이얼로그 처리 로깅 활성화
    });
  }

  /**
   * 랜덤 지연 생성 (인간적인 행동 모방)
   */
  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 인간적인 지연 적용
   */
  async humanDelay(type = 'default') {
    let delay;
    switch (type) {
      case 'typing':
        delay = this.getRandomDelay(this.humanTiming.typingSpeed.min, this.humanTiming.typingSpeed.max);
        break;
      case 'click':
        delay = this.getRandomDelay(this.humanTiming.clickDelay.min, this.humanTiming.clickDelay.max);
        break;
      case 'scroll':
        delay = this.getRandomDelay(this.humanTiming.scrollDelay.min, this.humanTiming.scrollDelay.max);
        break;
      case 'pageLoad':
        delay = this.getRandomDelay(this.humanTiming.pageLoadDelay.min, this.humanTiming.pageLoadDelay.max);
        break;
      default:
        delay = this.getRandomDelay(this.humanTiming.minDelay, this.humanTiming.maxDelay);
    }
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * AdsPower 프로세스가 리슨하는 포트를 OS에서 직접 탐지
   * Windows: tasklist → PID 추출 → netstat로 해당 PID의 LISTENING 포트 조회
   * @returns {number[]} 감지된 포트 배열 (중복 제거, 정렬됨)
   */
  detectPortsFromProcess() {
    try {
      // 1단계: AdsPower 프로세스 PID 찾기
      // 프로세스명이 버전마다 다름 (adspower.exe, ads_core_api.exe, AdsPower Global.exe 등)
      // → 전체 tasklist에서 'adspower' 키워드로 매칭
      const pids = [];

      try {
        const output = execSync('tasklist /FO CSV /NH', {
          encoding: 'utf-8', timeout: 5000, windowsHide: true
        });
        for (const line of output.trim().split('\n')) {
          // CSV: "AdsPower Global.exe","12345","Console","1","150,000 K"
          if (!line.toLowerCase().includes('adspower')) continue;
          const match = line.match(/"[^"]+","(\d+)"/);
          if (match) pids.push(match[1]);
        }
      } catch { /* tasklist 실행 실패 */ }

      if (pids.length === 0) {
        console.log('[AdsPower] ⚠️  AdsPower 프로세스를 찾을 수 없습니다.');
        return [];
      }

      console.log(`[AdsPower] 🔍 AdsPower PID 발견: ${pids.join(', ')}`);

      // 2단계: 해당 PID가 LISTENING하는 포트 추출
      const netstatOutput = execSync('netstat -ano', {
        encoding: 'utf-8', timeout: 10000, windowsHide: true
      });

      const ports = new Set();
      const pidSet = new Set(pids);

      for (const line of netstatOutput.split('\n')) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        // [TCP, 127.0.0.1:50326, 0.0.0.0:0, LISTENING, 12345]
        const pid = parts[parts.length - 1];
        if (!pidSet.has(pid)) continue;
        const portMatch = (parts[1] || '').match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          if (port >= 1024) ports.add(port);
        }
      }

      const sortedPorts = [...ports].sort((a, b) => a - b);
      if (sortedPorts.length > 0) {
        console.log(`[AdsPower] 🔍 프로세스 리슨 포트 감지: ${sortedPorts.join(', ')}`);
      }
      return sortedPorts;
    } catch (error) {
      console.log(`[AdsPower] ⚠️  프로세스 포트 감지 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 지정된 포트에서 AdsPower API 응답 확인
   * @param {number} port
   * @returns {Promise<boolean>}
   */
  async verifyAdsPowerPort(port) {
    try {
      const testClient = axios.create({
        baseURL: `http://127.0.0.1:${port}`,
        timeout: 3000,
        headers: { 'Content-Type': 'application/json' }
      });
      const response = await testClient.get('/api/v1/user/list', {
        params: { page_size: 1 }
      });
      return response.data.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * 포트 자동 감지 - 프로세스 기반 탐지 우선, 실패 시 고정 범위 폴백
   * @returns {Promise<string|null>} 작동하는 포트 URL, 실패시 null
   */
  async detectWorkingPort() {
    const baseHost = 'http://127.0.0.1';

    // 1단계: OS 프로세스에서 AdsPower 리슨 포트 직접 탐지
    const detectedPorts = this.detectPortsFromProcess();

    if (detectedPorts.length > 0) {
      console.log(`[AdsPower] 자동 포트 감지 시작... (프로세스 기반: ${detectedPorts.join(', ')})`);

      for (const port of detectedPorts) {
        if (await this.verifyAdsPowerPort(port)) {
          console.log(`[AdsPower] ✅ 포트 ${port} API 검증 성공!`);
          return `${baseHost}:${port}`;
        }
        console.log(`[AdsPower] ⏭️  포트 ${port} API 응답 없음, 다음 시도...`);
      }
    }

    // 2단계: 폴백 - 고정 포트 범위 스캔
    const fallbackPorts = [50326, 50325, 50327];
    console.log(`[AdsPower] 프로세스 감지 실패, 고정 포트 스캔... (${fallbackPorts.join(', ')})`);

    for (const port of fallbackPorts) {
      if (await this.verifyAdsPowerPort(port)) {
        console.log(`[AdsPower] ✅ 포트 ${port} 연결 성공!`);
        return `${baseHost}:${port}`;
      }
      console.log(`[AdsPower] ⏭️  포트 ${port} 연결 실패, 다음 포트 시도...`);
    }

    return null;
  }

  /**
   * API 연결 확인 (자동 포트 감지 포함)
   * v4.2 - autoDetectMode 지원: 'auto' 설정 시 항상 포트 스캔 먼저 실행
   */
  async checkConnection() {
    try {
      // v4.2 - 자동 감지 모드면 바로 포트 스캔
      if (this.autoDetectMode) {
        console.log(`[AdsPower] 🔍 자동 포트 감지 모드 활성화`);
        const workingUrl = await this.detectWorkingPort();

        if (workingUrl) {
          this.config.apiUrl = workingUrl;
          this.apiClient = axios.create({
            baseURL: workingUrl,
            timeout: this.config.timeout,
            headers: { 'Content-Type': 'application/json' }
          });
          console.log(`[AdsPower] ✅ 자동 감지 완료: ${workingUrl}`);
          return true;
        }

        const error = new Error('AdsPower API에 연결할 수 없습니다. AdsPower가 실행 중인지 확인하세요.');
        this.emit('error', { type: 'connection', error });
        return false;
      }

      // 기존 로직: 설정된 URL로 먼저 시도
      try {
        const response = await this.apiClient.get('/api/v1/user/list', {
          params: { page_size: 1 }
        });

        if (response.data.code === 0) {
          console.log(`[AdsPower] ✅ 포트 연결 성공: ${this.config.apiUrl}`);
          return true;
        }
      } catch (initialError) {
        console.log(`[AdsPower] ⚠️  기존 포트 연결 실패: ${this.config.apiUrl}`);
      }

      // 자동 포트 감지 시도 (fallback)
      const workingUrl = await this.detectWorkingPort();

      if (workingUrl) {
        // 작동하는 포트 발견 - API 클라이언트 업데이트
        this.config.apiUrl = workingUrl;
        this.apiClient = axios.create({
          baseURL: workingUrl,
          timeout: this.config.timeout,
          headers: { 'Content-Type': 'application/json' }
        });

        console.log(`[AdsPower] 🔄 API URL 자동 업데이트: ${workingUrl}`);
        return true;
      }

      // 모든 포트 실패
      const error = new Error('AdsPower API에 연결할 수 없습니다. AdsPower가 실행 중인지 확인하세요.');
      this.emit('error', { type: 'connection', error });
      return false;

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
   * 모든 프로필 가져오기 (페이지네이션 처리)
   * @param {Object} options - 옵션
   * @param {number} options.pageSize - 페이지당 프로필 수 (기본: 100)
   * @param {number} options.maxProfiles - 최대 프로필 수 (기본: 100000)
   * @param {boolean} options.showProgress - 진행 상황 표시 (기본: true)
   */
  async getAllProfiles(options = {}) {
    try {
      const allProfiles = [];
      let currentPage = 1;
      let hasMore = true;
      const pageSize = options.pageSize || 100;
      const maxProfiles = options.maxProfiles || 100000; // 최대 100000개 프로필 (안전 제한)
      const maxPages = Math.ceil(maxProfiles / pageSize);
      const showProgress = options.showProgress !== false;
      const startTime = Date.now();
      
      if (showProgress) {
        console.log(`[AdsPower] 전체 프로필 목록 가져오기 시작... (최대 ${maxProfiles}개)`);
      }
      
      while (hasMore && currentPage <= maxPages && allProfiles.length < maxProfiles) {
        // 페이지 번호가 1보다 큰 경우 지연 추가 (첫 페이지 제외)
        if (currentPage > 1) {
          // API 과부하 방지를 위한 동적 지연
          // 10페이지마다 추가 지연을 줘서 API 안정성 확보
          const delay = currentPage % 10 === 0 ? 2000 : 1000;
          if (showProgress && currentPage % 10 === 0) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[AdsPower] ${currentPage}페이지 처리 중... (${allProfiles.length}개 로드, ${elapsed}초 경과)`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        if (showProgress && currentPage <= 10 || currentPage % 50 === 0) {
          console.log(`[AdsPower] 페이지 ${currentPage}/${maxPages} 로드 중...`);
        }
        
        const result = await this.getProfiles({
          ...options,
          pageSize,
          page: currentPage
        });
        
        // 프로필이 없으면 종료
        if (!result.profiles || result.profiles.length === 0) {
          console.log(`[AdsPower] 페이지 ${currentPage}에 프로필이 없음. 로드 완료.`);
          hasMore = false;
          break;
        }
        
        // 최대 개수 체크하여 필요한 만큼만 추가
        const remainingSlots = maxProfiles - allProfiles.length;
        const profilesToAdd = result.profiles.slice(0, remainingSlots);
        allProfiles.push(...profilesToAdd);
        
        if (showProgress && (currentPage <= 5 || currentPage % 20 === 0)) {
          console.log(`[AdsPower] 페이지 ${currentPage}: ${profilesToAdd.length}개 프로필 로드`);
        }
        
        // 다음 페이지 확인
        // 현재 페이지의 프로필 수가 pageSize보다 작으면 마지막 페이지
        if (result.profiles.length < pageSize) {
          console.log(`[AdsPower] 마지막 페이지 도달 (${result.profiles.length} < ${pageSize})`);
          hasMore = false;
        } else {
          currentPage++;
        }
      }
      
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      
      if (currentPage > maxPages) {
        console.log(`[AdsPower] 최대 페이지 수(${maxPages}) 도달. 로드 중단.`);
      } else if (allProfiles.length >= maxProfiles) {
        console.log(`[AdsPower] 최대 프로필 수(${maxProfiles}) 도달. 로드 중단.`);
      }
      
      console.log(`[AdsPower] 전체 ${allProfiles.length}개 프로필 로드 완료 (소요시간: ${totalTime}초, 평균: ${(totalTime/currentPage).toFixed(2)}초/페이지)`);
      
      return {
        profiles: allProfiles,
        total: allProfiles.length
      };
    } catch (error) {
      this.emit('error', { type: 'api', method: 'getAllProfiles', error });
      throw error;
    }
  }

  /**
   * 프로필 이름으로 검색
   * @param {string} profileName - 검색할 프로필 이름
   * @returns {Object|null} 찾은 프로필 또는 null
   */
  async findProfileByName(profileName) {
    try {
      console.log(`[AdsPower] 프로필 검색: ${profileName}`);
      
      // API에서 직접 검색 시도 (user_id 파라미터로)
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: {
          user_id: profileName,
          page_size: 10
        }
      });
      
      if (response.data.code === 0 && response.data.data) {
        const profiles = response.data.data.list || [];
        
        // 정확한 이름 매칭
        const exactMatch = profiles.find(p => p.user === profileName);
        if (exactMatch) {
          console.log(`[AdsPower] 프로필 발견: ${exactMatch.user_id}`);
          return exactMatch;
        }
        
        // 부분 매칭
        const partialMatch = profiles.find(p => 
          p.user && p.user.toLowerCase().includes(profileName.toLowerCase())
        );
        if (partialMatch) {
          console.log(`[AdsPower] 프로필 발견 (부분 매칭): ${partialMatch.user} (${partialMatch.user_id})`);
          return partialMatch;
        }
      }
      
      // 검색 실패시 페이지네이션으로 검색 (최대 10페이지)
      console.log(`[AdsPower] 직접 검색 실패, 페이지네이션 검색 시작...`);
      for (let page = 1; page <= 10; page++) {
        // Rate limit 방지를 위한 지연
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const result = await this.getProfiles({ 
          pageSize: 100, 
          page 
        });
        
        if (!result.profiles || result.profiles.length === 0) {
          break;
        }
        
        const found = result.profiles.find(p => p.user === profileName);
        if (found) {
          console.log(`[AdsPower] 페이지 ${page}에서 프로필 발견: ${found.user_id}`);
          return found;
        }
      }
      
      console.log(`[AdsPower] 프로필을 찾을 수 없음: ${profileName}`);
      return null;
      
    } catch (error) {
      console.error(`[AdsPower] 프로필 검색 오류: ${error.message}`);
      return null;
    }
  }

  /**
   * AdsPower API를 통해 브라우저 상태 확인
   */
  async checkBrowserStatus(profileId) {
    try {
      const response = await this.apiClient.get('/api/v1/browser/active', {
        params: { user_id: profileId }
      });
      
      if (response.data.code === 0 && response.data.data) {
        const data = response.data.data;
        // status가 'Active'이고 ws 엔드포인트가 있으면 실행 중
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
   * 브라우저 실행 (자동화 감지 회피 적용)
   */
  async launchBrowser(profileId, options = {}) {
    try {
      // 1. 먼저 로컬 세션 맵 확인
      if (this.activeSessions.has(profileId)) {
        const session = this.activeSessions.get(profileId);
        if (session.browser && session.browser.isConnected()) {
          this.emit('info', `Profile ${profileId} already running (from local cache)`);
          console.log(`[AdsPower] 📌 기존 브라우저 재사용: ${profileId}`);
          
          // getActivePage 메서드가 없다면 추가
          if (!session.getActivePage) {
            session.getActivePage = async () => {
              const pages = await session.browser.pages();
              return pages[pages.length - 1] || pages[0];
            };
          }
          if (!session.close) {
            session.close = async () => {
              if (session.browser && session.browser.isConnected()) {
                await session.browser.close();
              }
            };
          }
          
          return session;
        } else {
          // 연결이 끊긴 세션은 정리
          this.activeSessions.delete(profileId);
          this.browserInstances.delete(profileId);
        }
      }

      // 2. AdsPower API를 통해 실제 브라우저 상태 확인
      const browserStatus = await this.checkBrowserStatus(profileId);
      
      if (browserStatus.isActive && browserStatus.wsEndpoint) {
        this.emit('info', `Profile ${profileId} already running (from AdsPower API)`);
        console.log(`[AdsPower] ✅ 실행 중인 브라우저 감지: ${profileId}`);
        
        try {
          // 기존 브라우저에 재연결 시도
          const browser = await this.connectPuppeteer(browserStatus.wsEndpoint, profileId);
          
          const session = {
            profileId,
            browser,
            wsEndpoint: browserStatus.wsEndpoint,
            debugPort: browserStatus.debugPort,
            startTime: new Date(),
            pages: new Map(),
            reused: true, // 재사용된 세션 표시
            // getActivePage 메서드 추가
            getActivePage: async () => {
              const pages = await browser.pages();
              return pages[pages.length - 1] || pages[0];
            },
            // close 메서드도 추가 
            close: async () => {
              if (browser && browser.isConnected()) {
                await browser.close();
              }
            }
          };
          
          this.activeSessions.set(profileId, session);
          this.browserInstances.set(profileId, browser);
          
          this.emit('browser:reused', { profileId, session });
          console.log(`[AdsPower] ♻️ 기존 브라우저 재연결 성공: ${profileId}`);
          return session;
          
        } catch (reconnectError) {
          this.emit('warning', `기존 브라우저 재연결 실패: ${reconnectError.message}`);
          console.log(`[AdsPower] ⚠️ 재연결 실패, 브라우저 종료 후 재시작 필요: ${profileId}`);
          
          // 재연결 실패 시 브라우저 완전 종료
          try {
            await this.apiClient.get('/api/v1/browser/stop', {
              params: { user_id: profileId }
            });
            console.log(`[AdsPower] 🔄 브라우저 종료 완료: ${profileId}`);
            // 종료 후 충분한 대기 시간
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (stopError) {
            console.log(`[AdsPower] ⚠️ 브라우저 종료 실패 (무시): ${stopError.message}`);
          }
        }
      }

      // 3. 새 브라우저 시작
      console.log(`[AdsPower] 🚀 새 브라우저 시작: ${profileId}`);
      
      // GUI와 동일하게 최소 파라미터만 사용
      const params = {
        user_id: profileId,
        open_tabs: 0,  // 0으로 설정하여 기본 탭만 열리도록 함
        launch_args: JSON.stringify(["--no-first-run", "--no-default-browser-check"])  // 중복 실행 방지
      };

      // 재시도 로직
      let lastError;
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          this.emit('info', `Starting browser for profile ${profileId} (attempt ${attempt}/${this.config.retryAttempts})`);
          console.log(`[AdsPower] 🔧 브라우저 시작 시도 ${attempt}/${this.config.retryAttempts}`);
          
          const response = await this.apiClient.get('/api/v1/browser/start', { params });
          
          // 디버그 로깅 추가
          if (this.config.debugMode || true) {  // 항상 로깅
            console.log('[AdsPower] API Response Code:', response.data.code);
            console.log('[AdsPower] WS Endpoint:', response.data.data?.ws?.puppeteer);
          }
          
          if (response.data.code !== 0) {
            throw new Error(response.data.msg || 'Failed to launch browser');
          }

          const data = response.data.data;

          // 🔥 프로필 오류 감지를 위한 연결 검증
          console.log(`[AdsPower] ✅ 새 브라우저 시작 완료: ${profileId}`);
          console.log(`[AdsPower] ⏳ AdsPower 세션 복원 대기 중... (5초)`);
          await this.humanDelay(5000); // AdsPower가 프로필을 로드할 시간 제공

          // Puppeteer 연결 시도 (프로필 오류 감지 포함)
          let browser;
          try {
            browser = await this.connectPuppeteer(data.ws.puppeteer, profileId);
            console.log(`[AdsPower] ✅ Puppeteer 연결 성공: ${profileId}`);
          } catch (connectError) {
            // 프로필 오류 감지
            if (connectError.message.includes('PROFILE_ERROR') ||
                connectError.message.includes('timeout') ||
                connectError.message.includes('connect ECONNREFUSED')) {
              console.error(`[AdsPower] ❌ 프로필 오류 감지: ${profileId}`);
              console.log(`[AdsPower] 🔄 브라우저 강제 종료 후 재시도...`);

              // 브라우저 강제 종료
              try {
                await this.apiClient.get('/api/v1/browser/stop', {
                  params: { user_id: profileId }
                });
              } catch (e) {
                // 무시
              }

              // 프로필 오류로 인한 재시도는 더 긴 대기 시간 필요
              await this.humanDelay(10000);

              // 프로필 오류 예외 발생
              const error = new Error(`프로필 오류: ${profileId} - ${connectError.message}`);
              error.code = 'PROFILE_ERROR';
              throw error;
            }
            throw connectError;
          }

          // 세션 저장
          const session = {
            profileId,
            browser,
            wsEndpoint: data.ws.puppeteer,
            debugPort: data.debug_port,
            webdriver: data.webdriver,
            startTime: new Date(),
            pages: new Map(),
            // getActivePage 메서드 추가
            getActivePage: async () => {
              const pages = await browser.pages();
              return pages[pages.length - 1] || pages[0];
            },
            // close 메서드도 추가
            close: async () => {
              if (browser && browser.isConnected()) {
                await browser.close();
              }
            }
          };

          this.activeSessions.set(profileId, session);
          this.browserInstances.set(profileId, browser);

          this.emit('browser:launched', { profileId, session });
          console.log(`[AdsPower] ✅ 새 브라우저 시작 완료: ${profileId}`);
          
          return session;
          
        } catch (error) {
          lastError = error;
          this.emit('warning', `Browser launch attempt ${attempt} failed: ${error.message}`);
          
          if (attempt < this.config.retryAttempts) {
            await this.humanDelay();
          }
        }
      }

      throw lastError;
      
    } catch (error) {
      this.emit('error', { type: 'browser:launch', profileId, error });
      throw error;
    }
  }

  /**
   * Puppeteer 연결 (자동화 감지 회피 적용)
   */
  async connectPuppeteer(wsEndpoint, profileId) {
    try {
      // 연결 시도 전 로그
      console.log(`[AdsPower] 🔗 Puppeteer 연결 시도: ${profileId}`);
      console.log(`[AdsPower] WebSocket: ${wsEndpoint}`);

      // 연결 타임아웃을 Promise.race로 구현
      const connectPromise = puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null,
        slowMo: 0, // 지연 없음
        protocolTimeout: 180000, // 3분으로 증가 (Google 로그인 페이지의 느린 evaluate() 방지)
        timeout: 30000 // 연결 타임아웃 30초로 단축 (프로필 오류 빠른 감지)
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('PROFILE_ERROR: 브라우저 연결 타임아웃 - 프로필 오류 가능성'));
        }, 30000); // 30초 타임아웃
      });

      // 연결 시도
      const browser = await Promise.race([connectPromise, timeoutPromise]);

      // 모든 페이지에 스텔스 설정 적용
      const pages = await browser.pages();
      for (const page of pages) {
        // v4.0 - 스텔스 설정 제거 (AdsPower가 처리)
        // 커스텀 스텔스 코드 사용하지 않음
      }

      // 새 페이지 생성 시 자동으로 스텔스 설정 적용
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const page = await target.page();
          if (page) {
            // v4.0 - 새 페이지에도 커스텀 스텔스 적용하지 않음
            // AdsPower가 모든 anti-detection 처리
          }
        }
      });

      return browser;
      
    } catch (error) {
      this.emit('error', { type: 'puppeteer:connect', profileId, error });
      throw error;
    }
  }

  /**
   * 페이지에 스텔스 설정 적용 (v4.0 - 비활성화됨)
   * AdsPower가 모든 anti-detection을 처리하므로 커스텀 코드 불필요
   */
  async applyStealthSettings(page) {
    return; // v4.0 - AdsPower가 모든 것을 처리

    try {
      // 1. navigator.webdriver 숨기기
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });
      });

      // 2. Chrome 자동화 속성 숨기기
      await page.evaluateOnNewDocument(() => {
        window.navigator.chrome = {
          runtime: {},
        };
      });

      // 3. Permissions API 정상화
      await page.evaluateOnNewDocument(() => {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      });

      // 4. 플러그인 배열 정상화
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            {0: {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format'}},
            {1: {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: ''}},
            {2: {name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client Executable'}}
          ]
        });
      });

      // 5. 언어 설정
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });
      });

      // 6. WebGL Vendor 정상화
      await page.evaluateOnNewDocument(() => {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine';
          }
          return getParameter(parameter);
        };
      });

      // 7. User Agent - AdsPower가 설정한 값 유지
      // 중요: AdsPower의 anti-fingerprinting을 위해 User-Agent 변경하지 않음

      // 8. 시간대 설정
      await page.emulateTimezone('Asia/Seoul');

      // 9. 마우스 움직임 시뮬레이션 활성화
      page.mouse.move(
        this.getRandomDelay(100, 800),
        this.getRandomDelay(100, 600)
      );

      // 10. [AdsPower가 제공] Canvas/WebGL/Audio Fingerprinting은 AdsPower가 프로필별로 관리
      // AdsPower가 각 프로필마다 고유한 Canvas, WebGL, AudioContext 지문을 자동으로 제공하므로
      // 추가 조작이 불필요하며 오히려 충돌을 일으킬 수 있음

      // 11. WebRTC IP 누출 차단
      await page.evaluateOnNewDocument(() => {
        // WebRTC 완전 차단이 아닌 가짜 IP 제공 (더 자연스러움)
        const originalRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        
        if (originalRTCPeerConnection) {
          window.RTCPeerConnection = new Proxy(originalRTCPeerConnection, {
            construct(target, args) {
              const instance = new target(...args);
              
              // createDataChannel 오버라이드
              const originalCreateDataChannel = instance.createDataChannel;
              instance.createDataChannel = function(...args) {
                // 프라이빗 IP 숨기기
                return originalCreateDataChannel.apply(this, args);
              };
              
              // createOffer 오버라이드
              const originalCreateOffer = instance.createOffer;
              instance.createOffer = async function(...args) {
                const offer = await originalCreateOffer.apply(this, args);
                // SDP에서 실제 IP 제거
                if (offer && offer.sdp) {
                  offer.sdp = offer.sdp.replace(/([0-9]{1,3}\.){3}[0-9]{1,3}/g, (match) => {
                    // 로컬 IP 범위면 가짜 IP로 대체
                    if (match.startsWith('192.168.') || match.startsWith('10.') || match.startsWith('172.')) {
                      return '10.0.0.' + Math.floor(Math.random() * 255);
                    }
                    return match;
                  });
                }
                return offer;
              };
              
              return instance;
            }
          });
          
          // MediaDevices 보호
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
            navigator.mediaDevices.getUserMedia = function(constraints) {
              // 오디오/비디오 요청 시 가짜 스트림 반환 고려
              if (constraints && (constraints.audio || constraints.video)) {
                return Promise.reject(new DOMException('Permission denied'));
              }
              return originalGetUserMedia.apply(this, arguments);
            };
          }
        }
      });

      // 12. [AdsPower가 제공] AudioContext와 Font Fingerprinting도 AdsPower가 프로필별로 관리
      // AdsPower가 자동으로 처리하므로 추가 코드 불필요

      this.emit('debug', `Advanced stealth settings applied to page`);
      
    } catch (error) {
      this.emit('warning', `Failed to apply some stealth settings: ${error.message}`);
    }
  }

  /**
   * 네트워크 패턴 랜덤화 적용 (v4.0 - 비활성화됨)
   * AdsPower가 네트워크 패턴도 자체적으로 처리
   */
  async applyNetworkRandomization(page) {
    return; // v4.0 - AdsPower가 처리
    
    // 이미 적용된 경우 건너뛰기
    if (page._networkRandomizationApplied) return;
    page._networkRandomizationApplied = true;

    try {
      // 요청 간격 랜덤화를 위한 큐
      const requestQueue = new Map();
      const requestDelayRange = { min: 50, max: 500 };
      
      // 간단하고 효과적인 요청 인터셉트 설정
      await page.setRequestInterception(true);
      
      page.on('request', async (request) => {
        try {
          const resourceType = request.resourceType();
          
          // 주요 리소스 타입에만 짧은 랜덤 지연 적용
          if (['xhr', 'fetch', 'script', 'stylesheet'].includes(resourceType)) {
            // 50-200ms 사이의 짧은 랜덤 지연
            const delay = this.getRandomDelay(50, 200);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // 헤더는 AdsPower가 프로필별로 관리하므로 수정하지 않음
          // 단순히 요청 계속 진행
          if (!request.isInterceptResolutionHandled()) {
            request.continue();
          }
          
        } catch (error) {
          // 오류 시 요청 계속 진행
          if (!request.isInterceptResolutionHandled()) {
            request.continue();
          }
        }
      });
      
      // 응답 타이밍 랜덤화
      page.on('response', async (response) => {
        // 응답 처리에도 약간의 지연 추가
        const delay = this.getRandomDelay(10, 50);
        await new Promise(resolve => setTimeout(resolve, delay));
      });
      
      // 페이지 내 타이밍 랜덤화 (간단하게)
      await page.evaluateOnNewDocument(() => {
        // fetch와 XHR에 짧은 랜덤 지연 추가
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          return new Promise((resolve, reject) => {
            // 10-100ms 사이의 짧은 지연
            const delay = 10 + Math.random() * 90;
            setTimeout(() => {
              originalFetch.apply(this, args).then(resolve).catch(reject);
            }, delay);
          });
        };
      });
      
      this.emit('debug', 'Network randomization applied to page');
      
    } catch (error) {
      this.emit('warning', `Failed to apply network randomization: ${error.message}`);
    }
  }

  /**
   * 브라우저 열기 (단일 탭 보장)
   * launchBrowser와 getPage를 통합한 메서드
   */
  async openBrowser(profileId, options = {}) {
    try {
      console.log(`[AdsPower] 🚀 브라우저 열기 시작: ${profileId}`);

      // 프로필 오류 재시도 로직
      let session = null;
      let lastError;
      let profileErrorCount = 0;
      const maxProfileRetries = 3;

      for (let retry = 1; retry <= maxProfileRetries; retry++) {
        try {
          // 1. 브라우저 실행
          session = await this.launchBrowser(profileId, options);

          if (!session || !session.browser) {
            throw new Error('브라우저 실행 실패');
          }

          // 성공하면 루프 탈출하고 계속 진행
          console.log(`[AdsPower] ✅ 브라우저 정상 시작 (시도 ${retry}/${maxProfileRetries})`);
          lastError = null;
          break;

        } catch (error) {
          lastError = error;

          // 프로필 오류인 경우 특별 처리
          if (error.code === 'PROFILE_ERROR' || error.message.includes('프로필 오류')) {
            profileErrorCount++;
            console.error(`[AdsPower] ⚠️ 프로필 오류 발생 (${profileErrorCount}/${maxProfileRetries}): ${profileId}`);

            if (retry < maxProfileRetries) {
              console.log(`[AdsPower] 🔄 프로필 복구 시도 중... (30초 대기)`);

              // 프로필 복구 시도
              await this.repairProfile(profileId);

              // 더 긴 대기 시간
              await new Promise(resolve => setTimeout(resolve, 30000));
            } else {
              console.error(`[AdsPower] ❌ 프로필 복구 실패: ${profileId}`);
              throw new Error(`프로필 영구 오류: ${profileId} - 모든 재시도 실패`);
            }
          } else {
            // 일반 오류는 즉시 전파
            throw error;
          }
        }
      }

      // 모든 재시도 실패
      if (lastError) {
        throw lastError;
      }

      // session이 없으면 오류
      if (!session || !session.browser) {
        throw new Error('브라우저 세션 생성 실패');
      }

      // 2. AdsPower가 세션 복원 및 탭 생성 완료될 때까지 대기
      console.log(`[AdsPower] ⏳ AdsPower 세션 복원 대기 중... (5초)`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. 강력한 탭 정리 - 5번 반복하여 완전히 정리
      console.log(`[AdsPower] 🔍 탭 정리 시작 (강화된 모드)`);

      for (let attempt = 1; attempt <= 5; attempt++) {
        let pages = await session.browser.pages();
        console.log(`[AdsPower] 📑 시도 ${attempt}/5 - 현재 탭 수: ${pages.length}`);

        // 여러 탭이 열려있으면 정리
        if (pages.length > 1) {
          console.log(`[AdsPower] 🧹 추가 탭 정리 중... (${pages.length - 1}개 닫기)`);

          // 첫 번째 탭만 유지, 나머지 모두 닫기
          for (let i = pages.length - 1; i >= 1; i--) {  // 뒤에서부터 닫기
            try {
              await pages[i].close();
              console.log(`[AdsPower] ❌ 탭 ${i + 1} 닫음`);
              await new Promise(r => setTimeout(r, 200));  // 탭 닫기 간 짧은 대기
            } catch (error) {
              console.log(`[AdsPower] ⚠️ 탭 ${i + 1} 닫기 실패: ${error.message}`);
            }
          }

          // 정리 후 다시 확인
          await new Promise(resolve => setTimeout(resolve, 500));
          pages = await session.browser.pages();
          console.log(`[AdsPower] ✅ 탭 정리 완료, 현재 탭 수: ${pages.length}`);
        }

        // 탭이 1개만 남으면 성공
        if (pages.length === 1) {
          console.log(`[AdsPower] ✅ 단일 탭 확인 완료`);
          break;
        }

        // 마지막 시도가 아니면 대기 후 재확인
        if (attempt < 5) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // 최종 탭 수 확인
      let pages = await session.browser.pages();
      console.log(`[AdsPower] 🎯 최종 탭 수: ${pages.length}`);

      if (pages.length > 1) {
        console.log(`[AdsPower] ⚠️ 경고: 여전히 ${pages.length}개 탭이 열려있음 - 강제 정리`);
        // 마지막 시도: 첫 번째 탭 외 모든 탭 강제 닫기
        for (let i = pages.length - 1; i >= 1; i--) {
          try {
            await pages[i].close();
          } catch (e) {
            // 무시
          }
        }
        // 최종 확인
        pages = await session.browser.pages();
        console.log(`[AdsPower] 🎯 강제 정리 후 탭 수: ${pages.length}`);
      }

      // 4. 메인 페이지 가져오기 (없으면 생성)
      let page;
      if (pages.length === 0) {
        console.log(`[AdsPower] 📄 새 탭 생성`);
        page = await session.browser.newPage();
      } else {
        page = pages[0];
        console.log(`[AdsPower] ✅ 첫 번째 탭 사용`);
      }

      // 5. about:blank나 빈 페이지인 경우 처리 (프록시 안정화 포함)
      const currentUrl = page.url();
      console.log(`[AdsPower] 📍 현재 URL: ${currentUrl}`);

      if (currentUrl === 'about:blank' || currentUrl === '' || currentUrl.includes('start.adspower')) {
        console.log(`[AdsPower] 🌐 초기 페이지로 이동`);
        const initialUrl = options.initialUrl || 'https://www.google.com';

        // 프록시 연결 안정화 대기 (특히 한국 프록시 설정 후)
        console.log(`[AdsPower] ⏳ 프록시 연결 안정화 대기 중... (3초)`);
        await new Promise(r => setTimeout(r, 3000));

        // 재시도 로직 (최대 3번)
        let navigationSuccess = false;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[AdsPower] 🌐 페이지 이동 시도 ${attempt}/3: ${initialUrl}`);
            await page.goto(initialUrl, {
              waitUntil: 'networkidle2',
              timeout: 40000  // 30초 → 40초 증가
            });
            navigationSuccess = true;
            console.log(`[AdsPower] ✅ 초기 페이지 로드 완료: ${await page.url()}`);
            break;
          } catch (navError) {
            lastError = navError;
            console.log(`[AdsPower] ⚠️ 페이지 이동 실패 (시도 ${attempt}/3): ${navError.message}`);

            // ERR_CONNECTION_CLOSED 에러인 경우 추가 대기
            if (navError.message.includes('ERR_CONNECTION_CLOSED')) {
              console.log(`[AdsPower] 🔄 프록시 재연결 대기 중... (5초)`);
              await new Promise(r => setTimeout(r, 5000));
            } else {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }

        // 모든 시도 실패 시 경고만 출력하고 계속 진행
        if (!navigationSuccess) {
          console.log(`[AdsPower] ⚠️ 초기 페이지 이동 실패 (3번 시도 모두 실패)`);
          console.log(`[AdsPower] 📌 마지막 에러: ${lastError?.message || '알 수 없음'}`);
          console.log(`[AdsPower] 🔄 현재 페이지로 계속 진행: ${page.url()}`);
          // throw하지 않고 계속 진행 - 워크플로우에서 처리하도록
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 6. 최종 탭 수 로그
      const finalPages = await session.browser.pages();
      console.log(`[AdsPower] 🎯 브라우저 준비 완료 - 최종 탭 수: ${finalPages.length}`);

      // v4.1 - 다이얼로그 핸들러 등록 (beforeunload 자동 처리)
      // Gmail 등에서 "사이트에서 나가시겠습니까?" 다이얼로그 자동 처리
      console.log(`[AdsPower] 🔧 다이얼로그 핸들러 등록 중...`);
      try {
        // Puppeteer dialog 이벤트 핸들러 등록
        page.on('dialog', async (dialog) => {
          const dialogType = dialog.type();
          const message = dialog.message();

          console.log(`\n[AdsPower] 📌 다이얼로그 감지 [${dialogType}]: ${message.substring(0, 80)}...`);

          try {
            // beforeunload는 항상 accept (페이지 이동 허용)
            if (dialogType === 'beforeunload') {
              await dialog.accept();
              console.log(`[AdsPower] ✅ beforeunload 다이얼로그 자동 수락 (페이지 이동 허용)`);
            } else if (dialogType === 'confirm') {
              await dialog.accept();
              console.log(`[AdsPower] ✅ confirm 다이얼로그 자동 수락`);
            } else if (dialogType === 'alert') {
              await dialog.dismiss();
              console.log(`[AdsPower] ✅ alert 다이얼로그 닫힘`);
            } else {
              await dialog.accept();
              console.log(`[AdsPower] ✅ 다이얼로그 자동 수락 [${dialogType}]`);
            }
          } catch (err) {
            console.log(`[AdsPower] ⚠️ 다이얼로그 처리 실패: ${err.message}`);
          }
        });

        // beforeunload 이벤트 리스너 제거 시도
        await page.evaluate(() => {
          window.onbeforeunload = null;
        }).catch(() => {});

        console.log(`[AdsPower] ✅ 다이얼로그 핸들러 등록 완료`);
      } catch (dialogError) {
        console.log(`[AdsPower] ⚠️ 다이얼로그 핸들러 등록 실패 (무시): ${dialogError.message}`);
      }

      // 7. 반환 객체 구성
      const result = {
        success: true,
        browser: session.browser,
        page,
        session,
        profileId,
        wsEndpoint: session.wsEndpoint,
        debugPort: session.debugPort
      };

      console.log(`[AdsPower] ✅ 브라우저 열기 완료: ${profileId}`);
      return result;

    } catch (error) {
      console.error(`[AdsPower] ❌ 브라우저 열기 실패: ${error.message}`);
      this.emit('error', { type: 'browser:open', profileId, error });

      return {
        success: false,
        error: error.message,
        profileId
      };
    }
  }

  /**
   * 페이지 생성 또는 가져오기
   */
      async getPage(profileId, url = null) {
    const session = this.activeSessions.get(profileId);
    if (!session) {
      throw new Error(`No active session for profile ${profileId}`);
    }

    let page;
    
    // 기존 페이지 확인
    const pages = await session.browser.pages();
    console.log(`[AdsPower] 📑 현재 열린 탭 수: ${pages.length} (프로필: ${profileId})`);
    
    // 여러 탭이 열려있으면 첫 번째를 제외하고 모두 닫기
    if (pages.length > 1) {
      this.emit('info', `여러 탭 감지 (${pages.length}개), 추가 탭 닫는 중...`);
      console.log(`[AdsPower] 🧹 추가 탭 정리 중... (${pages.length - 1}개 닫기)`);
      
      // 첫 번째 탭 유지, 나머지 닫기
      for (let i = 1; i < pages.length; i++) {
        try {
          await pages[i].close();
          this.emit('debug', `탭 ${i + 1} 닫음`);
        } catch (error) {
          this.emit('warning', `탭 닫기 실패: ${error.message}`);
        }
      }
      
      // 다시 페이지 목록 가져오기
      const remainingPages = await session.browser.pages();
      page = remainingPages[0];
      this.emit('info', `남은 탭 수: ${remainingPages.length}`);
      console.log(`[AdsPower] ✅ 탭 정리 완료, 현재 탭 수: ${remainingPages.length}`);
    } else if (pages.length === 1) {
      page = pages[0];
      console.log(`[AdsPower] ✅ 단일 탭 사용 중`);
    } else {
      // 페이지가 없으면 새로 생성
      page = await session.browser.newPage();
    }
        // about:blank에서 시작하는 경우 YouTube로 이동
    const currentUrl = page.url();
    if (currentUrl === 'about:blank' || currentUrl === '') {
      this.emit('debug', 'Page is at about:blank, navigating to YouTube...');
      await this.navigateWithRetry(page, 'https://www.youtube.com');
      await new Promise(r => setTimeout(r, 3000)); // 페이지 로드 대기
    }
    
    // URL로 이동 (지정된 경우)
    if (url && url !== currentUrl) {
      await this.navigateWithRetry(page, url);
    }

    // 세션에 페이지 저장 (안전한 방식으로)
    try {
      const pageId = page.target()._targetId || `page_${Date.now()}`;
      session.pages.set(pageId, page);
    } catch (e) {
      // 페이지 ID 저장 실패 시 무시
      this.emit('debug', 'Could not store page ID, continuing...');
    }

    return page;
  }

  /**
   * 안전한 페이지 네비게이션 (재시도 로직 포함)
   */
  async navigateWithRetry(page, url, options = {}) {
    const maxAttempts = options.maxAttempts || 3;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.emit('debug', `Navigating to ${url} (attempt ${attempt}/${maxAttempts})`);
        
        await page.goto(url, {
          waitUntil: options.waitUntil || 'networkidle2',
          timeout: options.timeout || 30000
        });

        // 페이지 로드 후 인간적인 지연
        await this.humanDelay('pageLoad');
        
        return true;
        
      } catch (error) {
        lastError = error;
        this.emit('warning', `Navigation attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          await this.humanDelay();
        }
      }
    }

    throw lastError;
  }

  /**
   * 프로필 생성
   * @param {Object} options - 프로필 생성 옵션
   * @returns {Object} 생성 결과
   */
  async createProfile(options = {}) {
    try {
      const { 
        name, 
        group_id = '0', 
        browser_type = 'sun',  // 기본값을 SunBrowser로 설정
        browser_kernel_ver = 'latest',
        // Windows 11 OS 설정 파라미터들
        operating_system,
        os_version,
        platform,
        platform_version,
        device_operating_system,
        sys_os_type,  // 레거시 지원
        user_agent,  // User Agent 설정 추가
        fingerprint_config,  // 지문 설정 추가
        user_proxy_config = null, 
        proxy = null 
      } = options;
      
      if (!name) {
        throw new Error('프로필 이름은 필수입니다');
      }
      
      console.log(`[AdsPower] 새 프로필 생성: ${name} (브라우저: ${browser_type})`);
      
      const profileData = {
        name,
        group_id,
        browser_type,  // SunBrowser 타입 추가
        browser_kernel_ver,  // 브라우저 커널 버전
        domain_name: 'https://www.google.com',
        open_urls: ['https://www.google.com'],
        // username을 제거 - 플랫폼 계정에 데이터를 넣지 않기 위함
        // username: name,  // 사용자 요청에 따라 제거됨
        remark: `Created at ${new Date().toISOString()}`
      };
      
      // Windows 11 OS 설정 추가 (검증된 파라미터들)
      if (operating_system) profileData.operating_system = operating_system;
      if (os_version) profileData.os_version = os_version;
      if (platform) profileData.platform = platform;
      if (platform_version) profileData.platform_version = platform_version;
      if (device_operating_system) profileData.device_operating_system = device_operating_system;
      
      // 레거시 sys_os_type 지원
      if (sys_os_type !== undefined) {
        profileData.sys_os_type = sys_os_type;
      }
      
      // User Agent가 있으면 추가
      if (user_agent) {
        profileData.user_agent = user_agent;
      }
      
      // 지문 설정이 있으면 추가
      if (fingerprint_config) {
        profileData.fingerprint_config = fingerprint_config;
      }
      
      // 프록시 설정이 있으면 추가 (user_proxy_config 우선, 없으면 proxy 사용)
      if (user_proxy_config) {
        console.log('[AdsPower] 프록시 설정 추가:', JSON.stringify(user_proxy_config, null, 2));
        profileData.user_proxy_config = user_proxy_config;
      } else if (proxy) {
        console.log('[AdsPower] 프록시 설정 추가 (proxy):', JSON.stringify(proxy, null, 2));
        profileData.user_proxy_config = proxy;
      }
      
      console.log('[AdsPower] 프로필 생성 요청 데이터:', JSON.stringify(profileData, null, 2));
      const response = await this.apiClient.post('/api/v1/user/create', profileData);
      
      if (response.data.code === 0) {
        const profileId = response.data.data.id;
        const accId = response.data.data.acc_id || response.data.data.serial_number;
        console.log(`[AdsPower] 프로필 생성 성공: ${profileId}`);
        
        return {
          success: true,
          id: profileId,  // FamilyPlanCheckUseCase가 기대하는 필드명
          profileId,       // 호환성을 위해 유지
          acc_id: accId,
          message: '프로필 생성 성공'
        };
      } else {
        throw new Error(response.data.msg || '프로필 생성 실패');
      }
      
    } catch (error) {
      console.error(`[AdsPower] 프로필 생성 오류: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 프로필 업데이트
   * @param {string} profileId - 프로필 ID
   * @param {object} updateData - 업데이트할 데이터
   */
  async updateProfile(profileId, updateData = {}) {
    try {
      console.log(`[AdsPower] 프로필 업데이트: ${profileId}`);
      console.log(`[AdsPower] 업데이트 데이터:`, JSON.stringify(updateData, null, 2));
      
      // 업데이트 데이터 준비
      const requestData = {
        user_id: profileId,
        ...updateData
      };
      
      // 프록시 설정이 있으면 user_proxy_config로 변환
      if (updateData.proxy) {
        requestData.user_proxy_config = updateData.proxy;
        delete requestData.proxy;
      }
      
      console.log(`[AdsPower] API 요청 데이터:`, JSON.stringify(requestData, null, 2));
      const response = await this.apiClient.post('/api/v1/user/update', requestData);
      
      if (response.data.code === 0) {
        console.log(`[AdsPower] 프로필 업데이트 성공: ${profileId}`);
        return {
          success: true,
          message: 'Profile updated successfully'
        };
      } else {
        throw new Error(response.data.msg || 'Profile update failed');
      }
    } catch (error) {
      console.error(`[AdsPower] 프로필 업데이트 실패: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId, forceClose = false) {
    try {
      console.log(`[AdsPower] 🔚 브라우저 종료 시작: ${profileId}`);
      
      // Puppeteer 브라우저 연결 해제
      const session = this.activeSessions.get(profileId);
      if (session && session.browser) {
        try {
          await session.browser.disconnect();
          console.log(`[AdsPower] 🔌 Puppeteer 연결 해제 완료: ${profileId}`);
        } catch (disconnectError) {
          this.emit('debug', `브라우저 연결 해제 실패 (무시): ${disconnectError.message}`);
        }
      }

      // 세션 정리를 먼저 수행 (중복 방지)
      this.activeSessions.delete(profileId);
      this.browserInstances.delete(profileId);
      console.log(`[AdsPower] 🧹 로컬 세션 정리 완료: ${profileId}`);

      // AdsPower API로 브라우저 종료 (타임아웃 10초)
      try {
        const response = await Promise.race([
          this.apiClient.get('/api/v1/browser/stop', {
            params: { user_id: profileId }
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('API timeout')), 10000)
          )
        ]);

        if (response.data.code === 0) {
          console.log(`[AdsPower] ✅ 브라우저 종료 완료: ${profileId}`);
          this.emit('browser:closed', { profileId });
          return true;
        } else {
          console.log(`[AdsPower] ⚠️ 브라우저 종료 API 응답 코드: ${response.data.code}`);
          return false;
        }
      } catch (apiError) {
        console.log(`[AdsPower] ⚠️ 브라우저 종료 API 실패 (무시): ${apiError.message}`);
        // API 실패해도 로컬 세션은 이미 정리했으므로 true 반환
        return true;
      }
      
    } catch (error) {
      // 오류가 발생해도 세션 정리는 수행
      this.activeSessions.delete(profileId);
      this.browserInstances.delete(profileId);
      
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
   * 활성 세션 상태 확인
   */
  getActiveSessionsInfo() {
    const info = [];
    
    for (const [profileId, session] of this.activeSessions) {
      info.push({
        profileId,
        startTime: session.startTime,
        isConnected: session.browser.isConnected(),
        pagesCount: session.pages.size,
        duration: Date.now() - session.startTime.getTime()
      });
    }

    return info;
  }

  /**
   * 리소스 정리
   */
  async cleanup() {
    await this.closeAllBrowsers();
    this.removeAllListeners();
  }

  /**
   * 프로필 상세 정보 가져오기
   * @param {string} profileId - 프로필 ID
   * @returns {Object} 프로필 상세 정보
   */
  async getProfileDetails(profileId) {
    try {
      const url = `${this.apiUrl}/api/v1/user/list`;
      const response = await axios.get(url, {
        params: {
          user_id: profileId
        }
      });
      
      if (response.data && response.data.code === 0 && response.data.data) {
        const profiles = response.data.data.list || [];
        const profile = profiles.find(p => p.user_id === profileId);
        
        if (profile) {
          return {
            success: true,
            ...profile
          };
        }
      }
      
      return {
        success: false,
        error: '프로필을 찾을 수 없습니다'
      };
      
    } catch (error) {
      console.error(`[AdsPower] 프로필 정보 조회 실패:`, error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 프로필 삭제
   * @param {string} profileId - 삭제할 프로필 ID
   * @returns {Object} 삭제 결과
   */
  async deleteProfile(profileId) {
    try {
      console.log(`[AdsPower] 🗑️ 프로필 삭제 시작: ${profileId}`);
      
      // 먼저 해당 프로필의 브라우저가 열려있다면 닫기
      if (this.activeSessions.has(profileId)) {
        await this.closeBrowser(profileId, true);
      }
      
      // AdsPower API를 통해 프로필 삭제
      const response = await this.apiClient.post('/api/v1/user/delete', {
        user_ids: [profileId]  // 배열로 전달
      });
      
      if (response.data && response.data.code === 0) {
        console.log(`[AdsPower] ✅ 프로필 ${profileId} 삭제 성공`);
        
        // 활성 세션에서 제거
        this.activeSessions.delete(profileId);
        
        return {
          success: true,
          profileId,
          message: '프로필 삭제 완료'
        };
      } else {
        const error = response.data?.msg || '알 수 없는 오류';
        console.error(`[AdsPower] ❌ 프로필 ${profileId} 삭제 실패: ${error}`);
        
        return {
          success: false,
          profileId,
          error,
          code: response.data?.code
        };
      }
      
    } catch (error) {
      console.error(`[AdsPower] ❌ 프로필 삭제 오류:`, error.message);
      
      // API 에러 상세 정보
      if (error.response) {
        console.error('API 응답:', error.response.data);
      }
      
      return {
        success: false,
        profileId,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * 여러 프로필 일괄 삭제
   * @param {Array<string>} profileIds - 삭제할 프로필 ID 배열
   * @returns {Object} 일괄 삭제 결과
   */
  async deleteProfiles(profileIds) {
    try {
      console.log(`[AdsPower] 🗑️ ${profileIds.length}개 프로필 일괄 삭제 시작`);
      
      // 열려있는 브라우저들 먼저 닫기
      for (const profileId of profileIds) {
        if (this.activeSessions.has(profileId)) {
          await this.closeBrowser(profileId, true);
        }
      }
      
      // AdsPower API를 통해 일괄 삭제
      const response = await this.apiClient.post('/api/v1/user/delete', {
        user_ids: profileIds
      });
      
      if (response.data && response.data.code === 0) {
        console.log(`[AdsPower] ✅ ${profileIds.length}개 프로필 삭제 성공`);
        
        // 활성 세션에서 제거
        profileIds.forEach(id => this.activeSessions.delete(id));
        
        return {
          success: true,
          count: profileIds.length,
          profileIds,
          message: '프로필 일괄 삭제 완료'
        };
      } else {
        const error = response.data?.msg || '알 수 없는 오류';
        console.error(`[AdsPower] ❌ 프로필 일괄 삭제 실패: ${error}`);
        
        return {
          success: false,
          error,
          code: response.data?.code,
          profileIds
        };
      }
      
    } catch (error) {
      console.error(`[AdsPower] ❌ 프로필 일괄 삭제 오류:`, error.message);
      
      return {
        success: false,
        error: error.message,
        profileIds,
        details: error.response?.data
      };
    }
  }

  /**
   * 프로필 복구 시도
   * 프로필 오류 시 자동 복구 메커니즘
   */
  async repairProfile(profileId) {
    try {
      console.log(`[AdsPower] 🔧 프로필 복구 시작: ${profileId}`);

      // 1. 먼저 브라우저가 실행 중인지 확인
      const browserStatus = await this.checkBrowserStatus(profileId);
      if (browserStatus.isActive) {
        console.log(`[AdsPower] 📌 실행 중인 브라우저 종료...`);
        try {
          await this.closeBrowser(profileId);
        } catch (e) {
          // 무시
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 2. 프로필 정보 조회
      try {
        const profileInfo = await this.apiClient.get('/api/v1/user/list', {
          params: {
            user_id: profileId,
            page: 1,
            page_size: 1
          }
        });

        if (profileInfo.data.code === 0 && profileInfo.data.data?.list?.length > 0) {
          const profile = profileInfo.data.data.list[0];
          console.log(`[AdsPower] 📋 프로필 정보 조회 성공: ${profile.name || profileId}`);

          // 3. 프로필 캐시 정리 (있다면)
          console.log(`[AdsPower] 🧹 프로필 캐시 정리 중...`);
          try {
            // AdsPower API에 캐시 정리 엔드포인트가 있다면 호출
            // 현재는 프로필 업데이트로 대체
            const updateData = {
              user_id: profileId,
              name: profile.name || profileId,
              // 캐시 관련 설정 초기화
              cache_clear: true
            };

            await this.updateProfile(profileId, updateData);
            console.log(`[AdsPower] ✅ 프로필 업데이트 완료`);
          } catch (e) {
            console.log(`[AdsPower] ⚠️ 프로필 업데이트 실패: ${e.message}`);
          }

        } else {
          console.log(`[AdsPower] ⚠️ 프로필 정보를 찾을 수 없음: ${profileId}`);
        }

      } catch (error) {
        console.error(`[AdsPower] ❌ 프로필 조회 실패: ${error.message}`);
      }

      // 4. 로컬 세션 정리
      if (this.activeSessions.has(profileId)) {
        this.activeSessions.delete(profileId);
        console.log(`[AdsPower] 🗑️ 로컬 세션 제거됨`);
      }
      if (this.browserInstances.has(profileId)) {
        this.browserInstances.delete(profileId);
        console.log(`[AdsPower] 🗑️ 브라우저 인스턴스 제거됨`);
      }

      // 5. 시스템 안정화 대기
      console.log(`[AdsPower] ⏳ 시스템 안정화 대기 중... (5초)`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log(`[AdsPower] ✅ 프로필 복구 완료: ${profileId}`);
      return true;

    } catch (error) {
      console.error(`[AdsPower] ❌ 프로필 복구 실패: ${error.message}`);
      return false;
    }
  }
}

module.exports = AdsPowerAdapter;