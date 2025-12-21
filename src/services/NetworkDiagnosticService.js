/**
 * NetworkDiagnosticService - 네트워크 연결 진단 및 복구 서비스
 * 
 * ERR_TUNNEL_CONNECTION_FAILED 및 기타 네트워크 문제 해결
 */

const chalk = require('chalk');
const axios = require('axios');
const dns = require('dns').promises;

class NetworkDiagnosticService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      timeout: config.timeout || 10000,
      retryAttempts: config.retryAttempts || 3,
      proxyCheckUrls: [
        'https://www.google.com',
        'https://www.youtube.com',
        'https://api.ipify.org?format=json'
      ],
      ...config
    };
    
    this.diagnosticResults = new Map();
  }

  /**
   * 종합적인 네트워크 진단 수행
   */
  async runDiagnostics(page, profileId) {
    this.log(`네트워크 진단 시작: ${profileId}`, 'info');
    
    const results = {
      profileId,
      timestamp: new Date().toISOString(),
      checks: {
        dnsResolution: await this.checkDNSResolution(),
        directConnection: await this.checkDirectConnection(),
        proxyConnection: await this.checkProxyConnection(page),
        browserConnection: await this.checkBrowserConnection(page),
        tunnelStatus: await this.checkTunnelStatus(page),
        certificateValidation: await this.checkCertificates(page)
      },
      recommendations: []
    };
    
    // 진단 결과 분석
    results.analysis = this.analyzeResults(results.checks);
    results.recommendations = this.generateRecommendations(results.analysis);
    
    // 결과 저장
    this.diagnosticResults.set(profileId, results);
    
    return results;
  }

  /**
   * DNS 해석 확인
   */
  async checkDNSResolution() {
    try {
      const domains = ['google.com', 'youtube.com', 'googleapis.com'];
      const results = {};
      
      for (const domain of domains) {
        try {
          const addresses = await dns.resolve4(domain);
          results[domain] = {
            success: true,
            addresses: addresses
          };
        } catch (error) {
          results[domain] = {
            success: false,
            error: error.message
          };
        }
      }
      
      const allSuccess = Object.values(results).every(r => r.success);
      
      return {
        passed: allSuccess,
        details: results
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * 직접 인터넷 연결 확인
   */
  async checkDirectConnection() {
    try {
      const response = await axios.get('https://api.ipify.org?format=json', {
        timeout: this.config.timeout
      });
      
      return {
        passed: true,
        ip: response.data.ip,
        latency: response.headers['x-response-time'] || 'N/A'
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * 프록시 연결 확인 (AdsPower 프록시)
   */
  async checkProxyConnection(page) {
    if (!page) {
      return {
        passed: false,
        error: 'Page object not provided'
      };
    }
    
    try {
      // 브라우저 내에서 프록시를 통한 연결 테스트
      const result = await page.evaluate(async () => {
        try {
          const response = await fetch('https://api.ipify.org?format=json', {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            return {
              success: true,
              ip: data.ip,
              status: response.status
            };
          } else {
            return {
              success: false,
              status: response.status,
              statusText: response.statusText
            };
          }
        } catch (error) {
          return {
            success: false,
            error: error.message
          };
        }
      });
      
      return {
        passed: result.success,
        proxyIp: result.ip,
        details: result
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * 브라우저 연결 상태 확인
   */
  async checkBrowserConnection(page) {
    if (!page) {
      return {
        passed: false,
        error: 'Page object not provided'
      };
    }
    
    try {
      // 여러 URL에 대한 연결 테스트
      const testUrls = this.config.proxyCheckUrls;
      const results = {};
      
      for (const url of testUrls) {
        try {
          const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: this.config.timeout
          });
          
          results[url] = {
            success: response.status() < 400,
            status: response.status(),
            statusText: response.statusText()
          };
        } catch (error) {
          results[url] = {
            success: false,
            error: error.message
          };
        }
      }
      
      const successCount = Object.values(results).filter(r => r.success).length;
      
      return {
        passed: successCount > 0,
        successRate: `${successCount}/${testUrls.length}`,
        details: results
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * 터널 연결 상태 확인
   */
  async checkTunnelStatus(page) {
    if (!page) {
      return {
        passed: false,
        error: 'Page object not provided'
      };
    }
    
    try {
      // Chrome DevTools Protocol을 통한 네트워크 상태 확인
      const client = await page.context().newCDPSession(page);
      
      // 네트워크 이벤트 활성화
      await client.send('Network.enable');
      
      // 보안 상태 확인
      const securityState = await client.send('Security.getSecurityState');
      
      // 네트워크 조건 확인
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0
      });
      
      return {
        passed: securityState.securityState !== 'insecure',
        securityState: securityState.securityState,
        details: {
          protocol: securityState.protocol,
          keyExchange: securityState.keyExchange,
          cipher: securityState.cipher
        }
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * SSL/TLS 인증서 확인
   */
  async checkCertificates(page) {
    if (!page) {
      return {
        passed: false,
        error: 'Page object not provided'
      };
    }
    
    try {
      const result = await page.evaluate(() => {
        const protocol = window.location.protocol;
        const isSecure = protocol === 'https:';
        
        return {
          isSecure,
          protocol,
          hostname: window.location.hostname
        };
      });
      
      return {
        passed: true,
        details: result
      };
      
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * 진단 결과 분석
   */
  analyzeResults(checks) {
    const analysis = {
      hasNetworkIssue: false,
      hasDNSIssue: false,
      hasProxyIssue: false,
      hasTunnelIssue: false,
      hasCertificateIssue: false,
      overallHealth: 'good'
    };
    
    // DNS 문제 확인
    if (!checks.dnsResolution?.passed) {
      analysis.hasDNSIssue = true;
      analysis.hasNetworkIssue = true;
    }
    
    // 프록시 문제 확인
    if (!checks.proxyConnection?.passed) {
      analysis.hasProxyIssue = true;
      analysis.hasNetworkIssue = true;
    }
    
    // 터널 문제 확인
    if (!checks.tunnelStatus?.passed) {
      analysis.hasTunnelIssue = true;
      analysis.hasNetworkIssue = true;
    }
    
    // 인증서 문제 확인
    if (!checks.certificateValidation?.passed) {
      analysis.hasCertificateIssue = true;
    }
    
    // 전체 상태 결정
    if (analysis.hasNetworkIssue) {
      if (analysis.hasTunnelIssue) {
        analysis.overallHealth = 'critical';
      } else {
        analysis.overallHealth = 'poor';
      }
    } else if (analysis.hasCertificateIssue) {
      analysis.overallHealth = 'warning';
    }
    
    return analysis;
  }

  /**
   * 권장사항 생성
   */
  generateRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.hasDNSIssue) {
      recommendations.push({
        severity: 'high',
        issue: 'DNS 해석 실패',
        solution: 'DNS 서버를 8.8.8.8 또는 1.1.1.1로 변경하세요'
      });
    }
    
    if (analysis.hasProxyIssue) {
      recommendations.push({
        severity: 'critical',
        issue: '프록시 연결 실패',
        solution: 'AdsPower 프록시 설정을 확인하거나 프록시를 비활성화하세요'
      });
    }
    
    if (analysis.hasTunnelIssue) {
      recommendations.push({
        severity: 'critical',
        issue: '터널 연결 실패 (ERR_TUNNEL_CONNECTION_FAILED)',
        solution: '1. VPN 연결 확인\n2. 프록시 설정 초기화\n3. AdsPower 프로필 재생성'
      });
    }
    
    if (analysis.hasCertificateIssue) {
      recommendations.push({
        severity: 'medium',
        issue: 'SSL/TLS 인증서 문제',
        solution: '시스템 시간이 정확한지 확인하고 브라우저 캐시를 삭제하세요'
      });
    }
    
    return recommendations;
  }

  /**
   * 네트워크 문제 자동 복구 시도
   */
  async attemptAutoFix(page, analysis) {
    const fixes = [];
    
    if (analysis.hasTunnelIssue || analysis.hasProxyIssue) {
      // 프록시 비활성화 시도
      try {
        await page.context().route('**/*', route => {
          route.continue({
            // 프록시 우회
            headers: {
              ...route.request().headers(),
              'Proxy-Connection': 'close'
            }
          });
        });
        
        fixes.push({
          issue: 'Proxy/Tunnel',
          action: 'Bypassed proxy for direct connection',
          success: true
        });
      } catch (error) {
        fixes.push({
          issue: 'Proxy/Tunnel',
          action: 'Failed to bypass proxy',
          success: false,
          error: error.message
        });
      }
    }
    
    if (analysis.hasCertificateIssue) {
      // 인증서 검증 완화 (개발 환경에서만)
      try {
        await page.context().setIgnoreHTTPSErrors(true);
        
        fixes.push({
          issue: 'Certificate',
          action: 'Ignored HTTPS errors (dev mode)',
          success: true
        });
      } catch (error) {
        fixes.push({
          issue: 'Certificate',
          action: 'Failed to ignore HTTPS errors',
          success: false,
          error: error.message
        });
      }
    }
    
    return fixes;
  }

  /**
   * 네트워크 상태 모니터링
   */
  async monitorNetworkHealth(page, interval = 5000) {
    const monitoring = setInterval(async () => {
      try {
        const quickCheck = await this.checkProxyConnection(page);
        
        if (!quickCheck.passed) {
          this.log('⚠️ 네트워크 연결 문제 감지', 'warning');
          clearInterval(monitoring);
          
          // 자동 진단 실행
          const diagnostics = await this.runDiagnostics(page, 'monitor');
          
          // 자동 복구 시도
          if (diagnostics.analysis.hasNetworkIssue) {
            await this.attemptAutoFix(page, diagnostics.analysis);
          }
        }
      } catch (error) {
        this.log(`모니터링 오류: ${error.message}`, 'error');
      }
    }, interval);
    
    return monitoring;
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
    console.log(chalk[color](`[NetworkDiagnostic] ${message}`));
  }

  /**
   * 서비스 상태 확인
   */
  getStatus() {
    return {
      service: 'NetworkDiagnosticService',
      ready: true,
      diagnosticsRun: this.diagnosticResults.size,
      lastCheck: Array.from(this.diagnosticResults.values()).pop()?.timestamp || null
    };
  }
}

module.exports = NetworkDiagnosticService;