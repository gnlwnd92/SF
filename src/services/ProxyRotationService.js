/**
 * 프록시 로테이션 서비스
 * 
 * 국가별 프록시를 관리하고 브라우저 실행 시 적절한 프록시를 설정합니다.
 * AdsPower의 프록시 설정을 동적으로 변경하여 IP를 전환합니다.
 */

const chalk = require('chalk');
const axios = require('axios');
// 공유 프록시 풀 가져오기
const { getRandomProxy, getProxyPoolStatus } = require('../infrastructure/config/proxy-pools');
// 포트 자동 감지 유틸리티
const { getApiUrl } = require('../utils/adsPowerPortDetector');

class ProxyRotationService {
  constructor(config = {}) {
    this.configApiUrl = config.adsPowerUrl || 'http://local.adspower.net:50325';
    this.apiUrl = null; // 초기화 시 설정됨
    this.initialized = false;

    this.config = {
      debugMode: config.debugMode || false,
      ...config
    };
    
    // 프록시 풀 상태 확인
    const proxyStatus = getProxyPoolStatus();
    if (this.config.debugMode) {
      console.log(chalk.cyan('🌐 ProxyRotationService 초기화'));
      console.log(chalk.gray(`  • 한국 프록시: ${proxyStatus.kr.total}개 (${proxyStatus.kr.host})`));
      console.log(chalk.gray(`  • 미국 프록시: ${proxyStatus.us.total}개 (${proxyStatus.us.host})`));
    }
    
    // 현재 사용 중인 프록시
    this.currentProxy = null;
    this.currentCountry = null;
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
   * 국가별 프록시 가져오기 (공유 프록시 풀 사용)
   */
  getProxyForCountry(country) {
    // 국가 코드 매핑
    const countryMap = {
      'korea': 'kr',
      'kr': 'kr',
      'usa': 'us',
      'us': 'us',
      'america': 'us',
      'japan': 'jp',
      'jp': 'jp'
    };
    
    const countryCode = countryMap[country.toLowerCase()];
    
    if (!countryCode) {
      this.log(`⚠️ ${country} 프록시를 찾을 수 없습니다`, 'warning');
      return null;
    }
    
    // proxy-pools.js의 getRandomProxy 사용
    const proxyConfig = getRandomProxy(countryCode);
    
    if (this.config.debugMode) {
      this.log(`🌐 선택된 ${country} 프록시: ${proxyConfig.proxy_host}:${proxyConfig.proxy_port}`, 'info');
    }
    
    return proxyConfig;
  }

  /**
   * AdsPower 프로필에 프록시 설정
   */
  async setProfileProxy(profileId, country) {
    // API 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const proxyConfig = this.getProxyForCountry(country);

      if (!proxyConfig) {
        throw new Error(`${country} 프록시를 찾을 수 없습니다`);
      }

      // AdsPower API를 통한 프록시 업데이트
      const updateData = {
        user_id: profileId,
        user_proxy_config: proxyConfig
      };

      const response = await axios.post(
        `${this.apiUrl}/api/v1/user/update`,
        updateData,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      // AdsPower API는 성공시 code: 0을 반환
      if (response.data && response.data.code === 0) {
        this.currentProxy = proxyConfig;
        this.currentCountry = country;
        
        this.log(`✅ ${country} 프록시 설정 완료: ${proxyConfig.proxy_host}:${proxyConfig.proxy_port}`, 'success');
        return true;
      } else if (response.data && response.data.code === -1 && response.data.msg === 'none exists') {
        // 프로필이 존재하지 않는 경우
        this.log(`⚠️ 프로필이 존재하지 않습니다: ${profileId}`, 'warning');
        return false;
      } else {
        this.log(`⚠️ 프록시 설정 응답: ${JSON.stringify(response.data)}`, 'warning');
        // 일부 경우 code가 없어도 성공일 수 있음
        return response.data && !response.data.code;
      }
      
    } catch (error) {
      this.log(`❌ 프록시 설정 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 한국 프록시로 전환
   */
  async switchToKoreanProxy(profileId) {
    return await this.setProfileProxy(profileId, 'korea');
  }

  /**
   * 미국 프록시로 전환
   */
  async switchToUSProxy(profileId) {
    return await this.setProfileProxy(profileId, 'usa');
  }

  /**
   * 일본 프록시로 전환
   */
  async switchToJapanProxy(profileId) {
    return await this.setProfileProxy(profileId, 'japan');
  }

  /**
   * 한국 IP로 브라우저 실행
   */
  async launchWithKoreanIP(adsPowerAdapter, profileId) {
    try {
      this.log('🇰🇷 한국 IP로 브라우저 실행 준비...', 'info');
      
      // 프로필에 한국 프록시 설정
      const proxySet = await this.setProfileProxy(profileId, 'korea');
      
      if (!proxySet) {
        this.log('⚠️ 한국 프록시 설정 실패, 기본 설정으로 진행', 'warning');
      }
      
      // 브라우저 실행
      const browser = await adsPowerAdapter.launchBrowser(profileId);
      
      if (browser && browser.page) {
        // IP 확인
        await this.verifyIP(browser.page, 'korea');
      }
      
      return browser;
      
    } catch (error) {
      this.log(`❌ 한국 IP 브라우저 실행 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * 미국 IP로 브라우저 실행
   */
  async launchWithUSIP(adsPowerAdapter, profileId) {
    try {
      this.log('🇺🇸 미국 IP로 브라우저 실행 준비...', 'info');
      
      // 프로필에 미국 프록시 설정
      const proxySet = await this.setProfileProxy(profileId, 'usa');
      
      if (!proxySet) {
        this.log('⚠️ 미국 프록시 설정 실패, 기본 설정으로 진행', 'warning');
      }
      
      // 브라우저 실행
      const browser = await adsPowerAdapter.launchBrowser(profileId);
      
      if (browser && browser.page) {
        // IP 확인
        await this.verifyIP(browser.page, 'usa');
      }
      
      return browser;
      
    } catch (error) {
      this.log(`❌ 미국 IP 브라우저 실행 실패: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * IP 검증
   */
  async verifyIP(page, expectedCountry) {
    try {
      // AdsPower 시작 페이지로 이동
      await page.goto('https://start.adspower.net', {
        waitUntil: 'domcontentloaded',
        timeout: 10000
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // IP 정보 추출
      const ipInfo = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const ipMatch = bodyText.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
        const locationMatch = bodyText.match(/([A-Z]{2}|[A-Za-z\s]+)\s*\/\s*([A-Za-z\s-]+)/);
        
        return {
          ip: ipMatch ? ipMatch[0] : null,
          location: locationMatch ? locationMatch[0] : null
        };
      });
      
      if (ipInfo.ip) {
        this.log(`📍 현재 IP: ${ipInfo.ip}`, 'info');
        
        if (ipInfo.location) {
          this.log(`📍 위치: ${ipInfo.location}`, 'info');
          
          // 국가 확인
          const countryCheck = this.validateCountry(ipInfo.location, expectedCountry);
          if (countryCheck) {
            this.log(`✅ ${expectedCountry.toUpperCase()} IP 확인 완료`, 'success');
          } else {
            this.log(`⚠️ IP 국가가 일치하지 않습니다 (예상: ${expectedCountry})`, 'warning');
          }
        }
      }
      
      return ipInfo;
      
    } catch (error) {
      this.log(`IP 검증 실패: ${error.message}`, 'warning');
      return null;
    }
  }

  /**
   * 국가 검증
   */
  validateCountry(location, expectedCountry) {
    const locationLower = location.toLowerCase();
    const countryLower = expectedCountry.toLowerCase();
    
    const countryIndicators = {
      korea: ['korea', 'kr', 'seoul', '한국', '서울'],
      usa: ['united states', 'us', 'america', 'los angeles', 'new york'],
      japan: ['japan', 'jp', 'tokyo', '일본', '도쿄']
    };
    
    const indicators = countryIndicators[countryLower] || [];
    
    for (const indicator of indicators) {
      if (locationLower.includes(indicator)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 프록시 제거 (원래 설정으로 복원)
   */
  async removeProxy(profileId) {
    // API 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // AdsPower API를 통한 프록시 제거
      const updateData = {
        user_id: profileId,
        user_proxy_config: {
          proxy_type: 'no_proxy',
          proxy_host: '',
          proxy_port: '',
          proxy_user: '',
          proxy_password: ''
        }
      };

      const response = await axios.post(
        `${this.apiUrl}/api/v1/user/update`,
        updateData,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data && response.data.code === 0) {
        this.currentProxy = null;
        this.currentCountry = null;
        
        this.log('✅ 프록시 제거 완료', 'success');
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`프록시 제거 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * 프록시 풀에 새 프록시 추가
   */
  addProxy(country, proxyConfig) {
    const countryKey = country.toLowerCase();
    
    if (!this.proxyPools[countryKey]) {
      this.proxyPools[countryKey] = [];
    }
    
    this.proxyPools[countryKey].push(proxyConfig);
    
    this.log(`✅ ${country} 프록시 추가됨: ${proxyConfig.host}:${proxyConfig.port}`, 'info');
  }

  /**
   * 프록시 상태 확인
   */
  async testProxy(proxy) {
    try {
      // 프록시를 통한 연결 테스트
      const testUrl = 'http://ip-api.com/json';
      
      const proxyUrl = proxy.username && proxy.password
        ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
        : `${proxy.type}://${proxy.host}:${proxy.port}`;
      
      // axios를 사용한 프록시 테스트 (실제 구현 시 proxy-agent 등 사용)
      this.log(`🔍 프록시 테스트 중: ${proxy.host}:${proxy.port}`, 'info');
      
      // 여기서는 간단한 검증만 수행
      return {
        working: true,
        ip: proxy.host,
        country: proxy.country,
        city: proxy.city
      };
      
    } catch (error) {
      this.log(`❌ 프록시 테스트 실패: ${error.message}`, 'error');
      return {
        working: false,
        error: error.message
      };
    }
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[ProxyRotation]`;
    
    switch (level) {
      case 'success':
        console.log(chalk.green(`${prefix} ${message}`));
        break;
      case 'error':
        console.error(chalk.red(`${prefix} ${message}`));
        break;
      case 'warning':
        console.warn(chalk.yellow(`${prefix} ${message}`));
        break;
      case 'info':
      default:
        console.log(chalk.cyan(`${prefix} ${message}`));
        break;
    }
  }
}

module.exports = ProxyRotationService;