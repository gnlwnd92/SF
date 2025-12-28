/**
 * HashBasedProxyMappingService
 *
 * 해시 기반 프록시 매핑 서비스
 * - 계정 ID를 해시하여 항상 동일한 프록시에 매핑
 * - 24시간 Sticky 세션과 함께 사용하여 IP 일관성 유지
 * - Google 자동화 탐지 우회를 위한 계정-IP 1:1 고정
 */

const crypto = require('crypto');

class HashBasedProxyMappingService {
  constructor({ proxySheetRepository, logger }) {
    this.proxySheetRepository = proxySheetRepository;
    this.logger = logger;
    this.proxyCache = new Map();  // 국가별 프록시 캐시
    this.cacheLifetimeMs = 5 * 60 * 1000;  // 5분 캐시
  }

  /**
   * 안전한 로깅 헬퍼
   * 로거 메서드가 없어도 에러 발생하지 않음
   */
  _log(level, message) {
    if (!this.logger) return;

    // 해당 레벨 메서드가 있으면 사용, 없으면 info로 폴백
    if (typeof this.logger[level] === 'function') {
      this.logger[level](message);
    } else if (typeof this.logger.info === 'function') {
      this.logger.info(message);
    }
  }

  /**
   * 계정에 할당된 프록시 반환 (결정론적)
   * 동일 accountId는 항상 동일한 프록시를 반환
   *
   * @param {string} accountId - 이메일 또는 프로필ID
   * @param {string} country - 국가 코드 ('kr', 'us' 등)
   * @returns {Promise<Object>} AdsPower 프록시 설정 객체
   */
  async getProxyForAccount(accountId, country = 'kr') {
    if (!accountId) {
      throw new Error('accountId가 필요합니다');
    }

    const proxies = await this.getActiveProxies(country);

    if (proxies.length === 0) {
      throw new Error(`사용 가능한 ${country.toUpperCase()} 프록시가 없습니다`);
    }

    // SHA-256 해시 → 인덱스 계산
    const hash = crypto.createHash('sha256')
      .update(accountId.toLowerCase().trim())
      .digest('hex');

    // 해시의 첫 8자를 16진수로 변환하여 인덱스 계산
    const index = parseInt(hash.substring(0, 8), 16) % proxies.length;

    const proxy = proxies[index];

    this._log('info', `[HashProxyMapper] ${this.maskEmail(accountId)} → ${proxy.id} (index ${index}/${proxies.length})`);

    return this.formatForAdsPower(proxy);
  }

  /**
   * 활성 프록시 목록 조회 (캐시 적용)
   *
   * @param {string} country - 국가 코드
   * @returns {Promise<Array>} 활성 프록시 목록
   */
  async getActiveProxies(country) {
    const cacheKey = country.toLowerCase();

    // 캐시 확인
    if (this.proxyCache.has(cacheKey)) {
      const cached = this.proxyCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheLifetimeMs) {
        this._log('debug', `[HashProxyMapper] 캐시 사용: ${cacheKey} (${cached.proxies.length}개)`);
        return cached.proxies;
      }
    }

    // 시트에서 프록시 조회
    const proxies = await this.proxySheetRepository.getProxiesByCountry(country);

    // 활성 프록시만 필터링
    // 조건: 상태가 '비활성'이 아니고, 연속실패횟수가 3 미만
    const activeProxies = proxies.filter(p =>
      p.상태 !== '비활성' &&
      (parseInt(p.연속실패횟수) || 0) < 3 &&
      p.호스트 &&  // 호스트가 있어야 함
      p.포트       // 포트가 있어야 함
    );

    // ID 기준으로 정렬 (숫자 인식 정렬로 일관된 순서 보장)
    // Proxy_kr_1, Proxy_kr_2, ..., Proxy_kr_10 순서 (문자열 정렬은 1, 10, 2 순)
    activeProxies.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

    // 캐시 저장
    this.proxyCache.set(cacheKey, {
      proxies: activeProxies,
      timestamp: Date.now()
    });

    this._log('info', `[HashProxyMapper] ${country.toUpperCase()} 활성 프록시 ${activeProxies.length}개 로드 (전체 ${proxies.length}개)`);

    return activeProxies;
  }

  /**
   * AdsPower API 형식으로 변환
   *
   * @param {Object} proxy - 프록시 객체
   * @returns {Object} AdsPower 프록시 설정 객체
   */
  formatForAdsPower(proxy) {
    return {
      proxy_type: (proxy.유형 || 'socks5').toLowerCase(),
      proxy_host: proxy.호스트,
      proxy_port: String(proxy.포트),
      proxy_user: proxy.사용자명 || '',
      proxy_password: proxy.비밀번호 || '',
      proxy_soft: 'other'
    };
  }

  /**
   * 특정 계정의 프록시 매핑 정보 조회 (디버깅용)
   *
   * @param {string} accountId - 계정 ID
   * @param {string} country - 국가 코드
   * @returns {Promise<Object>} 매핑 정보
   */
  async getMappingInfo(accountId, country = 'kr') {
    const proxies = await this.getActiveProxies(country);

    if (proxies.length === 0) {
      return { error: `사용 가능한 ${country.toUpperCase()} 프록시 없음` };
    }

    const hash = crypto.createHash('sha256')
      .update(accountId.toLowerCase().trim())
      .digest('hex');

    const index = parseInt(hash.substring(0, 8), 16) % proxies.length;
    const proxy = proxies[index];

    return {
      accountId: this.maskEmail(accountId),
      hashPrefix: hash.substring(0, 8),
      hashFull: hash,
      proxyIndex: index,
      totalProxies: proxies.length,
      proxyId: proxy.id,
      proxyHost: proxy.호스트,
      proxyPort: proxy.포트,
      proxyCountry: proxy.국가
    };
  }

  /**
   * 캐시 무효화
   * 프록시 추가/삭제 후 호출
   *
   * @param {string} country - 특정 국가만 무효화 (생략 시 전체)
   */
  invalidateCache(country = null) {
    if (country) {
      this.proxyCache.delete(country.toLowerCase());
      this._log('info', `[HashProxyMapper] ${country.toUpperCase()} 캐시 무효화`);
    } else {
      this.proxyCache.clear();
      this._log('info', '[HashProxyMapper] 전체 캐시 무효화');
    }
  }

  /**
   * 프록시 사용 성공 기록
   *
   * @param {string} proxyId - 프록시 ID
   * @param {string} ip - 확인된 IP
   */
  async recordSuccess(proxyId, ip) {
    try {
      await this.proxySheetRepository.updateProxyUsage(proxyId, {
        ip,
        lastUsed: new Date()
      });
      await this.proxySheetRepository.resetFailureCount(proxyId);
    } catch (error) {
      this._log('warn', `[HashProxyMapper] 성공 기록 실패: ${error.message}`);
    }
  }

  /**
   * 프록시 사용 실패 기록
   *
   * @param {string} proxyId - 프록시 ID
   */
  async recordFailure(proxyId) {
    try {
      await this.proxySheetRepository.incrementFailureCount(proxyId);

      // 캐시 무효화 (실패한 프록시가 비활성화될 수 있으므로)
      this.invalidateCache();
    } catch (error) {
      this._log('warn', `[HashProxyMapper] 실패 기록 실패: ${error.message}`);
    }
  }

  /**
   * 프록시 통계 조회
   *
   * @returns {Promise<Object>} 국가별 통계
   */
  async getStats() {
    return await this.proxySheetRepository.getProxyStats();
  }

  /**
   * 이메일 마스킹 (로깅용)
   *
   * @param {string} email - 이메일
   * @returns {string} 마스킹된 이메일
   */
  maskEmail(email) {
    if (!email || !email.includes('@')) {
      return email ? `${email.substring(0, 3)}***` : '(empty)';
    }
    const [local, domain] = email.split('@');
    const masked = local.length > 3
      ? `${local.substring(0, 3)}***@${domain}`
      : `${local[0]}***@${domain}`;
    return masked;
  }

  /**
   * 시트에서 랜덤 프록시 선택 (폴백용)
   * getRandomProxy('kr') 대신 사용 - 동일한 Sticky 세션 프록시 풀에서 선택
   *
   * @param {string} country - 국가 코드
   * @returns {Promise<Object>} { proxy: AdsPower 프록시 설정, proxyId: 프록시 ID }
   */
  async getRandomProxyFromSheet(country = 'kr') {
    try {
      const proxies = await this.getActiveProxies(country);

      if (proxies.length === 0) {
        throw new Error(`사용 가능한 ${country.toUpperCase()} 프록시가 없습니다`);
      }

      // 랜덤 선택
      const randomIndex = Math.floor(Math.random() * proxies.length);
      const proxy = proxies[randomIndex];

      this._log('info', `[HashProxyMapper] 랜덤 프록시 선택: ${proxy.id} (${randomIndex}/${proxies.length})`);

      return {
        proxy: this.formatForAdsPower(proxy),
        proxyId: `random_${proxy.id}`  // 랜덤 선택임을 표시
      };
    } catch (error) {
      this._log('warn', `[HashProxyMapper] 시트 랜덤 프록시 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 여러 계정의 프록시 매핑 미리보기 (배치 작업 전 확인용)
   *
   * @param {Array<string>} accountIds - 계정 ID 목록
   * @param {string} country - 국가 코드
   * @returns {Promise<Array>} 매핑 미리보기
   */
  async previewMappings(accountIds, country = 'kr') {
    const proxies = await this.getActiveProxies(country);

    if (proxies.length === 0) {
      return [];
    }

    return accountIds.map(accountId => {
      const hash = crypto.createHash('sha256')
        .update(accountId.toLowerCase().trim())
        .digest('hex');
      const index = parseInt(hash.substring(0, 8), 16) % proxies.length;
      const proxy = proxies[index];

      return {
        accountId: this.maskEmail(accountId),
        proxyId: proxy.id,
        proxyHost: `${proxy.호스트}:${proxy.포트}`
      };
    });
  }
}

module.exports = HashBasedProxyMappingService;
