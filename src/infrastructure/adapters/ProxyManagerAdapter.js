/**
 * ProxyManagerAdapter - 프록시 관리 및 로테이션 서비스
 *
 * 한국/파키스탄 프록시 풀 관리 및 AdsPower 프로필 프록시 설정
 */

const chalk = require('chalk');
const axios = require('axios');
const { getApiUrl, createApiClient } = require('../../utils/adsPowerPortDetector');

class ProxyManagerAdapter {
  constructor({ adsPowerUrl, debugMode = false, hashProxyMapper }) {
    this.configApiUrl = adsPowerUrl || 'http://local.adspower.net:50325';
    this.apiUrl = null; // 초기화 시 설정됨
    this.apiClient = null; // 초기화 시 생성됨
    this.initialized = false;
    this.debugMode = debugMode;

    // [v2.23] hashProxyMapper 의존성 주입
    this.hashProxyMapper = hashProxyMapper || null;

    // [v2.23] 하드코딩 프록시 풀 제거 - 시트에서 동적 조회
    // 레거시 호환성을 위해 빈 풀 유지
    this.proxyPools = {
      kr: [],
      pk: []
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

    if (this.debugMode) {
      console.log(chalk.cyan('🌐 ProxyManagerAdapter 초기화'));
      console.log(chalk.gray(`  • 프록시 소스: Google Sheets '프록시' 탭`));
    }
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
   * [v2.23 DEPRECATED] 한국 프록시 초기화 - 하드코딩 제거됨
   * @deprecated getAvailableProxyFromSheet() 사용
   */
  initializeKoreanProxies() {
    console.warn(chalk.yellow('[DEPRECATED] initializeKoreanProxies()는 더 이상 사용되지 않습니다.'));
    return [];
  }

  /**
   * [v2.23 DEPRECATED] 파키스탄 프록시 초기화 - 하드코딩 제거됨
   * @deprecated getAvailableProxyFromSheet() 사용
   */
  initializePakistanProxies() {
    console.warn(chalk.yellow('[DEPRECATED] initializePakistanProxies()는 더 이상 사용되지 않습니다.'));
    return [];
  }

  /**
   * [v2.23] 시트에서 프록시 조회
   * @param {string} country - 국가 코드 (kr, pk, us 등)
   * @returns {Promise<Object>} AdsPower 형식 프록시 객체
   */
  async getAvailableProxyFromSheet(country) {
    if (!this.hashProxyMapper) {
      throw new Error('hashProxyMapper가 주입되지 않았습니다. container.js 설정을 확인하세요.');
    }

    try {
      const result = await this.hashProxyMapper.getRandomProxyFromSheet(country);

      if (this.debugMode) {
        console.log(chalk.gray(`📡 프록시 조회 (${country}): ${result.proxy.proxy_host}:${result.proxy.proxy_port}`));
      }

      // 레거시 형식으로 변환 (호환성)
      return {
        host: result.proxy.proxy_host,
        port: parseInt(result.proxy.proxy_port, 10),
        username: result.proxy.proxy_user,
        password: result.proxy.proxy_password,
        type: result.proxy.proxy_type || 'socks5',
        id: result.proxyId,
        country: country.toUpperCase(),
        adsPowerFormat: result.proxy  // 원본 AdsPower 형식도 포함
      };
    } catch (error) {
      console.log(chalk.red(`❌ ${country} 프록시 조회 실패: ${error.message}`));
      throw new Error(`프록시 시트 접근 실패: ${error.message}. Google Sheets '프록시' 탭을 확인하세요.`);
    }
  }

  /**
   * [v2.23 DEPRECATED] 사용 가능한 프록시 가져오기 - getAvailableProxyFromSheet() 사용
   * @deprecated
   */
  getAvailableProxy(country) {
    // 동기 메서드로는 시트에서 조회 불가, 에러 throw
    throw new Error('[v2.23] getAvailableProxy()는 deprecated됨. getAvailableProxyFromSheet() (async)를 사용하세요.');
  }

  /**
   * [v2.23 DEPRECATED] 랜덤 프록시 선택 - 하드코딩 제거됨
   * @deprecated getAvailableProxyFromSheet() 사용
   */
  getRandomProxy(proxyList) {
    console.warn(chalk.yellow('[DEPRECATED] getRandomProxy()는 더 이상 사용되지 않습니다.'));
    return proxyList && proxyList.length > 0 ? proxyList[0] : null;
  }

  /**
   * AdsPower 프로필에 프록시 설정
   * [v2.23] getAvailableProxyFromSheet() 사용으로 변경
   */
  async setProfileProxy(profileId, country) {
    // API 클라이언트 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // [v2.23] 시트에서 프록시 조회
      const proxy = await this.getAvailableProxyFromSheet(country);

      const updateData = {
        user_id: profileId,
        // [v2.23] AdsPower 형식 프록시 사용
        user_proxy_config: proxy.adsPowerFormat || {
          proxy_soft: 'other',
          proxy_type: proxy.type,
          proxy_host: proxy.host,
          proxy_port: String(proxy.port),
          proxy_user: proxy.username,
          proxy_password: proxy.password
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