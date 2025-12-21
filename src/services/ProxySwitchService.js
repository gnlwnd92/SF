/**
 * ProxySwitchService - 프록시 전환 서비스
 * 
 * 한국 → 파키스탄 프록시 전환을 관리
 * 브라우저 종료 → 프록시 변경 → 재시작 워크플로우
 */

const chalk = require('chalk');
const axios = require('axios');

class ProxySwitchService {
  constructor({ sunbrowserAdapter, proxyManager, logger }) {
    this.sunbrowser = sunbrowserAdapter;
    this.proxyManager = proxyManager;
    this.logger = logger;
    
    // IP 확인 서비스
    this.ipCheckServices = [
      'https://ipapi.co/json/',
      'https://api.ipify.org?format=json',
      'https://ipinfo.io/json'
    ];
  }

  /**
   * 국가별 프록시 전환
   */
  async switchCountry(profileId, fromCountry, toCountry, options = {}) {
    const startTime = Date.now();
    console.log(chalk.cyan(`🔄 프록시 전환: ${fromCountry.toUpperCase()} → ${toCountry.toUpperCase()}`));
    
    try {
      // 1. 현재 브라우저 상태 확인
      const browserStatus = await this.sunbrowser.checkBrowserStatus(profileId);
      if (browserStatus.isActive) {
        console.log(chalk.yellow('브라우저 종료 중...'));
        await this.sunbrowser.closeBrowser(profileId);
        await this.delay(3000); // 완전 종료 대기
      }
      
      // 2. 새 프록시 선택
      const newProxy = this.proxyManager.getAvailableProxy(toCountry);
      console.log(chalk.gray(`새 프록시: ${newProxy.host}:${newProxy.port}`));
      
      // 3. 프로필 프록시 업데이트
      const updateSuccess = await this.sunbrowser.updateProfileProxy(profileId, newProxy);
      if (!updateSuccess) {
        throw new Error('프록시 업데이트 실패');
      }
      
      // 4. 프록시 연결 테스트 (선택적)
      if (options.testConnection) {
        const testResult = await this.testProxyConnection(newProxy);
        if (!testResult.success) {
          console.log(chalk.yellow('⚠️ 프록시 연결 테스트 실패, 다른 프록시 시도...'));
          // 다른 프록시로 재시도
          return await this.switchCountry(profileId, fromCountry, toCountry, options);
        }
        console.log(chalk.green(`✅ 프록시 연결 확인: ${testResult.country} (${testResult.ip})`));
      }
      
      // 5. 브라우저 재시작 (선택적)
      if (options.restartBrowser) {
        console.log(chalk.yellow('브라우저 재시작 중...'));
        const launchResult = await this.sunbrowser.launchBrowser(profileId);
        
        if (!launchResult.success) {
          throw new Error('브라우저 재시작 실패');
        }
        
        // IP 위치 확인
        if (options.verifyLocation) {
          const location = await this.verifyBrowserLocation(launchResult.wsEndpoint);
          console.log(chalk.green(`📍 현재 위치: ${location.country} (${location.city})`));
          
          // 국가 확인
          if (!this.isCountryMatch(location.country, toCountry)) {
            console.log(chalk.yellow('⚠️ 위치 불일치, 재시도...'));
            await this.sunbrowser.closeBrowser(profileId);
            return await this.switchCountry(profileId, fromCountry, toCountry, options);
          }
        }
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(chalk.green(`✅ 프록시 전환 완료 (${duration}초)`));
      
      return {
        success: true,
        fromCountry,
        toCountry,
        proxy: newProxy,
        duration,
        profileId
      };
      
    } catch (error) {
      console.error(chalk.red(`❌ 프록시 전환 실패: ${error.message}`));
      this.logger.error('Proxy switch failed', { profileId, fromCountry, toCountry, error });
      
      return {
        success: false,
        error: error.message,
        fromCountry,
        toCountry
      };
    }
  }

  /**
   * 프록시 연결 테스트
   */
  async testProxyConnection(proxy) {
    for (const serviceUrl of this.ipCheckServices) {
      try {
        const response = await axios.get(serviceUrl, {
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
        
        const data = response.data;
        
        return {
          success: true,
          ip: data.ip || data.query,
          country: data.country_code || data.countryCode || data.country,
          city: data.city,
          isp: data.org || data.isp,
          service: serviceUrl
        };
        
      } catch (error) {
        console.log(chalk.gray(`IP 확인 서비스 실패: ${serviceUrl}`));
        continue;
      }
    }
    
    return {
      success: false,
      error: '모든 IP 확인 서비스 실패'
    };
  }

  /**
   * 브라우저에서 위치 확인
   */
  async verifyBrowserLocation(wsEndpoint) {
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null
      });
      
      const page = await browser.newPage();
      
      // IP 확인 페이지로 이동
      await page.goto('https://ipapi.co/json/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // JSON 데이터 추출
      const locationData = await page.evaluate(() => {
        const pre = document.querySelector('pre');
        if (pre) {
          try {
            return JSON.parse(pre.textContent);
          } catch (e) {
            return null;
          }
        }
        return null;
      });
      
      await page.close();
      
      if (locationData) {
        return {
          ip: locationData.ip,
          country: locationData.country_code,
          countryName: locationData.country_name,
          city: locationData.city,
          region: locationData.region,
          timezone: locationData.timezone,
          isp: locationData.org
        };
      }
      
      throw new Error('위치 데이터 추출 실패');
      
    } catch (error) {
      console.error('브라우저 위치 확인 실패:', error);
      return {
        country: 'UNKNOWN',
        error: error.message
      };
    }
  }

  /**
   * 국가 코드 매칭 확인
   */
  isCountryMatch(detectedCountry, expectedCountry) {
    const countryMap = {
      'kr': ['KR', 'KOR', 'Korea', 'South Korea'],
      'pk': ['PK', 'PAK', 'Pakistan']
    };
    
    const expected = countryMap[expectedCountry.toLowerCase()] || [expectedCountry.toUpperCase()];
    
    return expected.some(code => 
      detectedCountry.toUpperCase().includes(code.toUpperCase())
    );
  }

  /**
   * 배치 프록시 전환
   */
  async batchSwitch(profiles, fromCountry, toCountry, options = {}) {
    console.log(chalk.cyan(`📦 배치 프록시 전환: ${profiles.length}개 프로필`));
    
    const results = [];
    const { parallel = false, batchSize = 5 } = options;
    
    if (parallel) {
      // 병렬 처리
      for (let i = 0; i < profiles.length; i += batchSize) {
        const batch = profiles.slice(i, Math.min(i + batchSize, profiles.length));
        
        const batchResults = await Promise.all(
          batch.map(profile => 
            this.switchCountry(profile.id, fromCountry, toCountry, options)
              .catch(error => ({
                success: false,
                profileId: profile.id,
                error: error.message
              }))
          )
        );
        
        results.push(...batchResults);
        
        // 배치 간 지연
        if (i + batchSize < profiles.length) {
          await this.delay(3000);
        }
      }
    } else {
      // 순차 처리
      for (const profile of profiles) {
        const result = await this.switchCountry(profile.id, fromCountry, toCountry, options);
        results.push(result);
        
        // 프로필 간 지연
        await this.delay(2000);
      }
    }
    
    // 결과 요약
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(chalk.cyan('\n📊 배치 프록시 전환 완료'));
    console.log(chalk.green(`  ✅ 성공: ${successful}개`));
    console.log(chalk.red(`  ❌ 실패: ${failed}개`));
    
    return results;
  }

  /**
   * 프록시 상태 모니터링
   */
  async monitorProxyHealth(country) {
    const proxies = this.proxyManager.proxyPools[country];
    const healthStatus = [];
    
    console.log(chalk.cyan(`🔍 ${country.toUpperCase()} 프록시 상태 확인 중...`));
    
    // 샘플 프록시 테스트 (처음 10개)
    const sampleSize = Math.min(10, proxies.length);
    for (let i = 0; i < sampleSize; i++) {
      const proxy = proxies[i];
      const result = await this.testProxyConnection(proxy);
      
      healthStatus.push({
        proxy: `${proxy.host}:${proxy.port}`,
        healthy: result.success,
        country: result.country,
        ip: result.ip,
        responseTime: result.duration
      });
      
      // 짧은 지연
      await this.delay(500);
    }
    
    const healthyCount = healthStatus.filter(s => s.healthy).length;
    const healthRate = (healthyCount / sampleSize * 100).toFixed(2);
    
    console.log(chalk.cyan(`\n📊 프록시 상태 요약 (${country.toUpperCase()})`));
    console.log(chalk.gray(`  - 테스트: ${sampleSize}개`));
    console.log(chalk.green(`  - 정상: ${healthyCount}개`));
    console.log(chalk.yellow(`  - 실패: ${sampleSize - healthyCount}개`));
    console.log(chalk.cyan(`  - 건강도: ${healthRate}%`));
    
    return {
      country,
      tested: sampleSize,
      healthy: healthyCount,
      failed: sampleSize - healthyCount,
      healthRate,
      details: healthStatus
    };
  }

  /**
   * 최적 프록시 선택
   */
  async selectOptimalProxy(country, testCount = 5) {
    console.log(chalk.cyan(`🎯 최적 프록시 선택 중 (${country.toUpperCase()})...`));
    
    const candidates = [];
    
    // 랜덤하게 프록시 테스트
    for (let i = 0; i < testCount; i++) {
      const proxy = this.proxyManager.getAvailableProxy(country);
      const startTime = Date.now();
      const result = await this.testProxyConnection(proxy);
      const responseTime = Date.now() - startTime;
      
      if (result.success) {
        candidates.push({
          proxy,
          responseTime,
          ...result
        });
      }
      
      await this.delay(500);
    }
    
    if (candidates.length === 0) {
      throw new Error(`사용 가능한 ${country} 프록시를 찾을 수 없습니다`);
    }
    
    // 응답 시간 기준 정렬
    candidates.sort((a, b) => a.responseTime - b.responseTime);
    
    const optimal = candidates[0];
    console.log(chalk.green(`✅ 최적 프록시 선택: ${optimal.proxy.host}:${optimal.proxy.port}`));
    console.log(chalk.gray(`  - 응답시간: ${optimal.responseTime}ms`));
    console.log(chalk.gray(`  - IP: ${optimal.ip}`));
    console.log(chalk.gray(`  - 국가: ${optimal.country}`));
    
    return optimal.proxy;
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ProxySwitchService;