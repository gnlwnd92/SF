/**
 * ProxyManagerAdapter - 프록시 관리 및 로테이션 서비스
 *
 * 한국/파키스탄 프록시 풀 관리 및 AdsPower 프로필 프록시 설정
 */

const chalk = require('chalk');
const axios = require('axios');
const { getApiUrl, createApiClient } = require('../../utils/adsPowerPortDetector');

class ProxyManagerAdapter {
  constructor({ adsPowerUrl, debugMode = false }) {
    this.configApiUrl = adsPowerUrl || 'http://local.adspower.net:50325';
    this.apiUrl = null; // 초기화 시 설정됨
    this.apiClient = null; // 초기화 시 생성됨
    this.initialized = false;
    this.debugMode = debugMode;
    
    // 프록시 풀 초기화
    this.proxyPools = {
      kr: this.initializeKoreanProxies(),
      pk: this.initializePakistanProxies()
    };
    
    // 프록시 사용 추적 (로테이션용)
    this.usedProxies = {
      kr: new Set(),
      pk: new Set()
    };
    
    // 프록시 상태 캐시
    this.proxyStatus = new Map();
    
    // 별칭 추가 (호환성)
    this.proxies = this.proxyPools;
  }

  /**
   * API 클라이언트 초기화 (포트 자동 감지)
   */
  async initialize(silent = true) {
    if (this.initialized) {
      return;
    }

    try {
      // 포트 자동 감지 및 API URL 가져오기
      this.apiUrl = await getApiUrl(this.configApiUrl, silent);
      this.initialized = true;

      if (!silent && this.debugMode) {
        console.log(chalk.green(`[ProxyManagerAdapter] ✅ API 초기화 완료: ${this.apiUrl}`));
      }
    } catch (error) {
      if (!silent) {
        console.error(chalk.red(`[ProxyManagerAdapter] ❌ API 초기화 실패: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * 한국 프록시 초기화
   */
  initializeKoreanProxies() {
    const proxies = [];
    const baseConfig = {
      host: 'kr.decodo.com',
      username: 'user-sproxq5yy8-sessionduration-1',
      password: 'CcI9pU1jfbcrU4m2+l',
      type: 'http'
    };
    
    for (let i = 1; i <= 100; i++) {
      proxies.push({
        ...baseConfig,
        port: 10000 + i,
        id: `kr_${i}`,
        country: 'KR'
      });
    }
    
    if (this.debugMode) {
      console.log(chalk.cyan(`✅ ${proxies.length}개 한국 프록시 초기화`));
    }
    
    return proxies;
  }

  /**
   * 파키스탄 프록시 초기화
   */
  initializePakistanProxies() {
    const proxies = [];
    const baseConfig = {
      host: 'pk.decodo.com',
      username: 'user-sproxq5yy8-sessionduration-1',
      password: 'CcI9pU1jfbcrU4m2+l',
      type: 'http'
    };
    
    for (let i = 1; i <= 100; i++) {
      proxies.push({
        ...baseConfig,
        port: 10000 + i,
        id: `pk_${i}`,
        country: 'PK'
      });
    }
    
    if (this.debugMode) {
      console.log(chalk.cyan(`✅ ${proxies.length}개 파키스탄 프록시 초기화`));
    }
    
    return proxies;
  }

  /**
   * 사용 가능한 프록시 가져오기
   */
  getAvailableProxy(country) {
    const pool = this.proxyPools[country];
    if (!pool || pool.length === 0) {
      throw new Error(`No proxies available for country: ${country}`);
    }
    
    // 사용하지 않은 프록시 찾기
    const unused = pool.filter(proxy => !this.usedProxies[country].has(proxy.id));
    
    // 모든 프록시가 사용된 경우 리셋
    if (unused.length === 0) {
      if (this.debugMode) {
        console.log(chalk.yellow(`🔄 ${country} 프록시 풀 리셋`));
      }
      this.usedProxies[country].clear();
      return this.getRandomProxy(pool);
    }
    
    // 랜덤 선택
    const proxy = this.getRandomProxy(unused);
    this.usedProxies[country].add(proxy.id);
    
    if (this.debugMode) {
      console.log(chalk.gray(`📡 프록시 선택: ${proxy.id} (${proxy.host}:${proxy.port})`));
    }
    
    return proxy;
  }

  /**
   * 랜덤 프록시 선택
   */
  getRandomProxy(proxyList) {
    return proxyList[Math.floor(Math.random() * proxyList.length)];
  }

  /**
   * AdsPower 프로필에 프록시 설정
   */
  async setProfileProxy(profileId, country) {
    // API 클라이언트 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const proxy = this.getAvailableProxy(country);
      
      const updateData = {
        user_id: profileId,
        proxy: {
          type: proxy.type,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password
        }
      };
      
      if (this.debugMode) {
        console.log(chalk.cyan(`🔧 프로필 ${profileId} 프록시 업데이트 중...`));
      }
      
      // AdsPower API 호출
      const response = await axios.post(
        `${this.apiUrl}/api/v1/user/update`,
        updateData,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );
      
      if (response.data.code !== 0) {
        throw new Error(`Failed to update proxy: ${response.data.msg}`);
      }
      
      console.log(chalk.green(`✅ 프록시 설정 완료: ${country.toUpperCase()} (${proxy.host}:${proxy.port})`));
      
      // 상태 캐시 업데이트
      this.proxyStatus.set(profileId, {
        proxy,
        country,
        updatedAt: new Date()
      });
      
      return proxy;
      
    } catch (error) {
      console.error(chalk.red(`프록시 설정 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * 프록시 전환 (한국 → 파키스탄)
   */
  async switchProxy(profileId, fromCountry, toCountry) {
    console.log(chalk.cyan(`🔄 프록시 전환: ${fromCountry.toUpperCase()} → ${toCountry.toUpperCase()}`));
    
    try {
      // 새 프록시 설정
      const newProxy = await this.setProfileProxy(profileId, toCountry);
      
      // 전환 성공
      console.log(chalk.green('✅ 프록시 전환 완료'));
      
      return {
        success: true,
        previousCountry: fromCountry,
        currentCountry: toCountry,
        proxy: newProxy
      };
      
    } catch (error) {
      console.error(chalk.red('프록시 전환 실패:'), error);
      throw error;
    }
  }

  /**
   * 프록시 연결 테스트
   */
  async testProxy(proxy) {
    try {
      const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
      
      // IP 확인 서비스로 테스트
      const response = await axios.get('https://ipapi.co/json/', {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          auth: {
            username: proxy.username,
            password: proxy.password
          }
        },
        timeout: 10000
      });
      
      const ipInfo = response.data;
      
      if (this.debugMode) {
        console.log(chalk.green('✅ 프록시 테스트 성공:'));
        console.log(chalk.gray(`  - IP: ${ipInfo.ip}`));
        console.log(chalk.gray(`  - 국가: ${ipInfo.country_name} (${ipInfo.country_code})`));
        console.log(chalk.gray(`  - 도시: ${ipInfo.city}`));
      }
      
      return {
        success: true,
        ip: ipInfo.ip,
        country: ipInfo.country_code,
        city: ipInfo.city
      };
      
    } catch (error) {
      if (this.debugMode) {
        console.error(chalk.red('프록시 테스트 실패:'), error.message);
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 프로필의 현재 프록시 정보 가져오기
   */
  async getProfileProxy(profileId) {
    // API 클라이언트 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const response = await axios.get(
        `${this.apiUrl}/api/v1/user/detail`,
        {
          params: { user_id: profileId },
          timeout: 10000
        }
      );
      
      if (response.data.code === 0 && response.data.data) {
        const proxyInfo = response.data.data.proxy;
        return proxyInfo || null;
      }
      
      return null;
      
    } catch (error) {
      console.error('프로필 프록시 정보 조회 실패:', error);
      return null;
    }
  }

  /**
   * 프록시 풀 상태 확인
   */
  getPoolStatus() {
    const status = {};
    
    for (const country in this.proxyPools) {
      const total = this.proxyPools[country].length;
      const used = this.usedProxies[country].size;
      const available = total - used;
      
      status[country] = {
        total,
        used,
        available,
        usageRate: Math.round((used / total) * 100)
      };
    }
    
    return status;
  }

  /**
   * 프록시 사용 통계 리셋
   */
  resetUsageStats() {
    for (const country in this.usedProxies) {
      this.usedProxies[country].clear();
    }
    
    console.log(chalk.yellow('🔄 프록시 사용 통계 리셋'));
  }

  /**
   * 특정 프록시 차단/해제
   */
  blockProxy(proxyId, reason) {
    // 차단된 프록시 관리 (향후 구현)
    console.log(chalk.red(`🚫 프록시 차단: ${proxyId} (${reason})`));
  }

  /**
   * 프록시 설정을 AdsPower 형식으로 변환
   */
  formatProxyForAdsPower(proxy) {
    return {
      proxy_type: proxy.type,
      proxy_host: proxy.host,
      proxy_port: String(proxy.port),
      proxy_user: proxy.username,
      proxy_password: proxy.password,
      proxy_soft: 'other'
    };
  }
}

module.exports = ProxyManagerAdapter;