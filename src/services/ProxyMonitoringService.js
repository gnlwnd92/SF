/**
 * ProxyMonitoringService
 * 프록시 품질 모니터링 및 관리 서비스
 * AdsPower 프로필별 프록시 상태 추적 및 평가
 */

const chalk = require('chalk');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class ProxyMonitoringService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      checkInterval: config.checkInterval || 300000, // 5분마다 체크
      blacklistThreshold: config.blacklistThreshold || 3, // 3회 연속 실패 시 블랙리스트
      reCaptchaThreshold: config.reCaptchaThreshold || 5, // 5회 reCAPTCHA 시 경고
      ...config
    };
    
    // 프록시 상태 추적
    this.proxyStats = new Map();
    this.blacklistedProxies = new Set();
    
    // 로그 파일 경로
    this.logPath = path.join(__dirname, '../../logs/proxy-monitoring.json');
  }

  /**
   * 프록시 상태 초기화 또는 로드
   */
  async initialize() {
    try {
      // 기존 로그 파일 로드
      const logData = await fs.readFile(this.logPath, 'utf8').catch(() => '{}');
      const parsed = JSON.parse(logData);
      
      // 복원
      if (parsed.proxyStats) {
        this.proxyStats = new Map(Object.entries(parsed.proxyStats));
      }
      if (parsed.blacklistedProxies) {
        this.blacklistedProxies = new Set(parsed.blacklistedProxies);
      }
      
      this.log('프록시 모니터링 서비스 초기화 완료', 'success');
    } catch (error) {
      this.log(`초기화 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 프록시 이벤트 기록
   */
  async recordEvent(profileId, proxyInfo, eventType, details = {}) {
    const proxy = proxyInfo.ip || proxyInfo.address || 'unknown';
    
    if (!this.proxyStats.has(proxy)) {
      this.proxyStats.set(proxy, {
        profileId,
        ip: proxy,
        country: proxyInfo.country || null,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        events: {
          success: 0,
          failure: 0,
          reCaptcha: 0,
          blocked: 0,
          timeout: 0
        },
        consecutiveFailures: 0,
        trustScore: 100 // 초기 신뢰 점수
      });
    }
    
    const stats = this.proxyStats.get(proxy);
    stats.lastSeen = new Date().toISOString();
    
    // 이벤트 타입별 처리
    switch (eventType) {
      case 'success':
        stats.events.success++;
        stats.consecutiveFailures = 0;
        stats.trustScore = Math.min(100, stats.trustScore + 1);
        break;
        
      case 'failure':
        stats.events.failure++;
        stats.consecutiveFailures++;
        stats.trustScore = Math.max(0, stats.trustScore - 10);
        
        // 연속 실패 임계값 도달 시 블랙리스트
        if (stats.consecutiveFailures >= this.config.blacklistThreshold) {
          this.blacklistProxy(proxy, 'consecutive_failures');
        }
        break;
        
      case 'reCaptcha':
        stats.events.reCaptcha++;
        stats.trustScore = Math.max(0, stats.trustScore - 5);
        
        // reCAPTCHA 빈도가 높으면 경고
        if (stats.events.reCaptcha >= this.config.reCaptchaThreshold) {
          this.log(`⚠️ 프록시 ${proxy}에서 reCAPTCHA 빈발 (${stats.events.reCaptcha}회)`, 'warning');
        }
        break;
        
      case 'blocked':
        stats.events.blocked++;
        stats.trustScore = Math.max(0, stats.trustScore - 20);
        this.blacklistProxy(proxy, 'blocked');
        break;
        
      case 'timeout':
        stats.events.timeout++;
        stats.trustScore = Math.max(0, stats.trustScore - 3);
        break;
    }
    
    // 상세 정보 추가
    if (details.responseTime) {
      stats.avgResponseTime = stats.avgResponseTime 
        ? (stats.avgResponseTime + details.responseTime) / 2 
        : details.responseTime;
    }
    
    // 로그 저장
    await this.saveStats();
    
    return stats;
  }

  /**
   * 프록시 블랙리스트 추가
   */
  blacklistProxy(proxy, reason) {
    this.blacklistedProxies.add(proxy);
    
    const stats = this.proxyStats.get(proxy);
    if (stats) {
      stats.blacklisted = true;
      stats.blacklistReason = reason;
      stats.blacklistTime = new Date().toISOString();
      stats.trustScore = 0;
    }
    
    this.log(`🚫 프록시 ${proxy} 블랙리스트 추가 (사유: ${reason})`, 'error');
  }

  /**
   * 프록시 상태 확인
   */
  isProxyHealthy(proxy) {
    if (this.blacklistedProxies.has(proxy)) {
      return false;
    }
    
    const stats = this.proxyStats.get(proxy);
    if (!stats) {
      return true; // 새 프록시는 일단 신뢰
    }
    
    // 신뢰 점수 기반 평가
    return stats.trustScore >= 30;
  }

  /**
   * 프록시 추천 (가장 신뢰도 높은 프록시)
   */
  recommendProxy(availableProxies) {
    const healthyProxies = availableProxies.filter(proxy => 
      this.isProxyHealthy(proxy.ip || proxy.address)
    );
    
    if (healthyProxies.length === 0) {
      this.log('⚠️ 건강한 프록시가 없습니다', 'warning');
      return availableProxies[0]; // 어쩔 수 없이 첫 번째 반환
    }
    
    // 신뢰 점수로 정렬
    healthyProxies.sort((a, b) => {
      const aStats = this.proxyStats.get(a.ip || a.address);
      const bStats = this.proxyStats.get(b.ip || b.address);
      
      const aScore = aStats ? aStats.trustScore : 50;
      const bScore = bStats ? bStats.trustScore : 50;
      
      return bScore - aScore;
    });
    
    return healthyProxies[0];
  }

  /**
   * 프록시 상태 리포트 생성
   */
  async generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalProxies: this.proxyStats.size,
      blacklisted: this.blacklistedProxies.size,
      healthy: 0,
      warning: 0,
      critical: 0,
      proxies: []
    };
    
    for (const [proxy, stats] of this.proxyStats) {
      const status = this.getProxyStatus(stats);
      
      if (status === 'healthy') report.healthy++;
      else if (status === 'warning') report.warning++;
      else if (status === 'critical') report.critical++;
      
      report.proxies.push({
        ip: proxy,
        status,
        trustScore: stats.trustScore,
        events: stats.events,
        lastSeen: stats.lastSeen,
        blacklisted: stats.blacklisted || false
      });
    }
    
    // 신뢰 점수로 정렬
    report.proxies.sort((a, b) => b.trustScore - a.trustScore);
    
    return report;
  }

  /**
   * 프록시 상태 판정
   */
  getProxyStatus(stats) {
    if (stats.blacklisted) return 'blacklisted';
    if (stats.trustScore >= 70) return 'healthy';
    if (stats.trustScore >= 30) return 'warning';
    return 'critical';
  }

  /**
   * IP 품질 체크 (외부 API 활용)
   */
  async checkIPQuality(ip) {
    try {
      // IP 평판 체크 서비스 예시 (실제 서비스는 API 키 필요)
      // 여기서는 간단한 로컬 체크만 수행
      
      // 1. IP 형식 검증
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ip)) {
        return { valid: false, reason: 'invalid_format' };
      }
      
      // 2. 예약된 IP 대역 체크
      const reserved = [
        /^10\./,        // Private
        /^172\.(1[6-9]|2\d|3[01])\./,  // Private
        /^192\.168\./,  // Private
        /^127\./,       // Loopback
        /^169\.254\./   // Link-local
      ];
      
      for (const pattern of reserved) {
        if (pattern.test(ip)) {
          return { valid: false, reason: 'reserved_ip' };
        }
      }
      
      // 3. 블랙리스트 체크
      if (this.blacklistedProxies.has(ip)) {
        return { valid: false, reason: 'blacklisted' };
      }
      
      return { valid: true, trustScore: this.proxyStats.get(ip)?.trustScore || 50 };
    } catch (error) {
      this.log(`IP 품질 체크 실패: ${error.message}`, 'error');
      return { valid: true, trustScore: 50 }; // 실패 시 중립적 평가
    }
  }

  /**
   * 자동 프록시 교체 제안
   */
  async suggestProxyRotation(profileId) {
    const suggestions = [];
    
    for (const [proxy, stats] of this.proxyStats) {
      if (stats.profileId === profileId) {
        const status = this.getProxyStatus(stats);
        
        if (status === 'blacklisted' || status === 'critical') {
          suggestions.push({
            action: 'replace',
            proxy,
            reason: stats.blacklistReason || 'low_trust_score',
            trustScore: stats.trustScore
          });
        } else if (status === 'warning') {
          suggestions.push({
            action: 'monitor',
            proxy,
            reason: 'declining_performance',
            trustScore: stats.trustScore
          });
        }
      }
    }
    
    return suggestions;
  }

  /**
   * 통계 저장
   */
  async saveStats() {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        proxyStats: Object.fromEntries(this.proxyStats),
        blacklistedProxies: Array.from(this.blacklistedProxies)
      };
      
      // 디렉토리 생성
      const dir = path.dirname(this.logPath);
      await fs.mkdir(dir, { recursive: true });
      
      // 파일 저장
      await fs.writeFile(this.logPath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.log(`통계 저장 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 로깅 헬퍼
   */
  log(message, type = 'info') {
    if (!this.config.debugMode) return;
    
    const prefix = chalk.cyan('[ProxyMonitor]');
    switch (type) {
      case 'success':
        console.log(prefix, chalk.green(message));
        break;
      case 'error':
        console.log(prefix, chalk.red(message));
        break;
      case 'warning':
        console.log(prefix, chalk.yellow(message));
        break;
      default:
        console.log(prefix, message);
    }
  }
}

module.exports = ProxyMonitoringService;