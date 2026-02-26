/**
 * SharedConfig - Google Sheets '설정' 탭 캐싱 서비스
 *
 * 특징:
 * - 메모리 캐싱으로 빠른 조회
 * - 5분마다 자동 동기화 (setInterval)
 * - 타입 자동 변환 (문자열 → 숫자/불리언)
 * - 설정 키 상수 기반 타입 안전성
 *
 * 사용법:
 *   const value = sharedConfig.get('RESUME_MINUTES_BEFORE');
 *   const wait = sharedConfig.getRandomClickWait(); // 편의 메서드
 */

const { CONFIG_KEYS, CONFIG_DEFAULTS, CONFIG_TYPES } = require('../config/configKeys');

class SharedConfig {
  /**
   * @param {Object} options
   * @param {ConfigRepository} options.configRepository - ConfigRepository 인스턴스
   * @param {Object} [options.logger] - 로거 (선택)
   * @param {number} [options.syncIntervalMs=300000] - 동기화 간격 (기본 5분)
   */
  constructor({ configRepository, logger, syncIntervalMs = 5 * 60 * 1000 }) {
    this.configRepository = configRepository;
    this.logger = logger;
    this.syncIntervalMs = syncIntervalMs;

    // 캐시 초기화 (기본값으로)
    this.cache = new Map();
    for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
      this.cache.set(key, value);
    }

    this.lastSyncTime = null;
    this.syncIntervalId = null;
    this.isInitialized = false;
  }

  /**
   * 로거 헬퍼 (옵셔널 메서드 호환)
   */
  _log(level, message, ...args) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, ...args);
    } else if (level === 'error') {
      console.error(`[SharedConfig] ${message}`, ...args);
    } else {
      console.log(`[SharedConfig] ${message}`, ...args);
    }
  }

  /**
   * 초기화 (최초 동기화 + 자동 동기화 시작)
   *
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.isInitialized) return true;

    try {
      // 최초 동기화
      await this.sync();

      // 자동 동기화 시작
      this.startAutoSync();

      this.isInitialized = true;
      this._log('info', `✅ SharedConfig 초기화 완료 (동기화 간격: ${this.syncIntervalMs / 1000}초)`);
      return true;
    } catch (error) {
      this._log('error', '❌ SharedConfig 초기화 실패:', error.message);
      return false;
    }
  }

  /**
   * Google Sheets에서 설정 동기화
   *
   * @returns {Promise<void>}
   */
  async sync() {
    try {
      const config = await this.configRepository.getAll();
      const fromSheet = config._fromSheet !== false;  // API 성공 여부

      if (!fromSheet) {
        // API 실패 → 기본값이 반환됨 → 기존 캐시 유지 (덮어쓰지 않음)
        this._log('warn', `⚠️ 설정 동기화: API 실패로 기본값 반환됨 → 기존 캐시 유지`);
        return;
      }

      // 캐시 업데이트
      for (const [key, value] of config.entries()) {
        if (key === '_fromSheet') continue;  // 내부 플래그 제외
        this.cache.set(key, value);
      }

      this.lastSyncTime = new Date();
    } catch (error) {
      this._log('error', '설정 동기화 실패:', error.message);
      // 실패해도 기존 캐시(또는 기본값) 유지
    }
  }

  /**
   * 자동 동기화 시작
   */
  startAutoSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }

    this.syncIntervalId = setInterval(async () => {
      await this.sync();
    }, this.syncIntervalMs);

    // Node.js가 인터벌 때문에 종료되지 않도록 unref
    if (this.syncIntervalId.unref) {
      this.syncIntervalId.unref();
    }
  }

  /**
   * 자동 동기화 중지
   */
  stopAutoSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
      this._log('info', '자동 동기화 중지됨');
    }
  }

  /**
   * 설정 값 조회 (캐시에서)
   *
   * @param {string} key - 설정 키 (CONFIG_KEYS 상수 사용 권장)
   * @returns {any} 설정 값
   */
  get(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // 캐시에 없으면 기본값
    if (CONFIG_DEFAULTS.hasOwnProperty(key)) {
      return CONFIG_DEFAULTS[key];
    }

    this._log('warn', `알 수 없는 설정 키: ${key}`);
    return undefined;
  }

  /**
   * 설정 값 강제 새로고침 후 조회
   *
   * @param {string} key - 설정 키
   * @returns {Promise<any>} 설정 값
   */
  async getRefreshed(key) {
    await this.sync();
    return this.get(key);
  }

  /**
   * 설정 값 저장 (캐시 + 시트)
   *
   * @param {string} key - 설정 키
   * @param {any} value - 설정 값
   * @returns {Promise<boolean>}
   */
  async set(key, value) {
    const success = await this.configRepository.set(key, value);
    if (success) {
      // 캐시 즉시 업데이트
      this.cache.set(key, this.configRepository.parseValue(key, value));
    }
    return success;
  }

  /**
   * 모든 설정 조회 (캐시에서)
   *
   * @returns {Map<string, any>}
   */
  getAll() {
    return new Map(this.cache);
  }

  /**
   * 마지막 동기화 시간 조회
   *
   * @returns {Date|null}
   */
  getLastSyncTime() {
    return this.lastSyncTime;
  }

  // ============================================================
  // 편의 메서드 (Convenience Methods)
  // ============================================================

  // ▶ 시간 설정
  getResumeMinutesBefore() {
    return this.get(CONFIG_KEYS.RESUME_MINUTES_BEFORE);
  }

  getPauseMinutesAfter() {
    return this.get(CONFIG_KEYS.PAUSE_MINUTES_AFTER);
  }

  getCheckIntervalSeconds() {
    return this.get(CONFIG_KEYS.CHECK_INTERVAL_SECONDS);
  }

  // ▶ 재시도 설정
  getMaxRetryCount() {
    return this.get(CONFIG_KEYS.MAX_RETRY_COUNT);
  }

  getRetryDelayMs() {
    return this.get(CONFIG_KEYS.RETRY_DELAY_MS);
  }

  getRetryAttempts() {
    return this.get(CONFIG_KEYS.RETRY_ATTEMPTS);
  }

  // ▶ 결제 미완료
  getPaymentPendingMaxHours() {
    return this.get(CONFIG_KEYS.PAYMENT_PENDING_MAX_HOURS);
  }

  getPaymentPendingRetryMinutes() {
    return this.get(CONFIG_KEYS.PAYMENT_PENDING_RETRY_MINUTES);
  }

  // ▶ 대기 시간
  getClickWaitMinMs() {
    return this.get(CONFIG_KEYS.CLICK_WAIT_MIN_MS);
  }

  getClickWaitMaxMs() {
    return this.get(CONFIG_KEYS.CLICK_WAIT_MAX_MS);
  }

  getPageLoadWaitMs() {
    return this.get(CONFIG_KEYS.PAGE_LOAD_WAIT_MS);
  }

  getPopupWaitMs() {
    return this.get(CONFIG_KEYS.POPUP_WAIT_MS);
  }

  /**
   * 랜덤 클릭 대기 시간 (min ~ max 사이)
   *
   * @returns {number} 대기 시간 (ms)
   */
  getRandomClickWait() {
    const min = this.getClickWaitMinMs();
    const max = this.getClickWaitMaxMs();
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ▶ 타임아웃
  getNavigationTimeoutMs() {
    return this.get(CONFIG_KEYS.NAVIGATION_TIMEOUT_MS);
  }

  getLoginCheckTimeoutMs() {
    return this.get(CONFIG_KEYS.LOGIN_CHECK_TIMEOUT_MS);
  }

  getLanguageDetectTimeoutMs() {
    return this.get(CONFIG_KEYS.LANGUAGE_DETECT_TIMEOUT_MS);
  }

  // ▶ 브라우저
  getBrowserCloseDelayMs() {
    return this.get(CONFIG_KEYS.BROWSER_CLOSE_DELAY_MS);
  }

  getBrowserReopenDelayMs() {
    return this.get(CONFIG_KEYS.BROWSER_REOPEN_DELAY_MS);
  }

  // ▶ 잠금
  getLockExpiryMinutes() {
    return this.get(CONFIG_KEYS.LOCK_EXPIRY_MINUTES);
  }

  // ▶ Telegram 알림 (유형별 ON/OFF)
  isTelegramNotifyCritical() {
    return this.get(CONFIG_KEYS.TELEGRAM_NOTIFY_CRITICAL);
  }

  isTelegramNotifyPaymentDelay() {
    return this.get(CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_DELAY);
  }

  isTelegramNotifyInfiniteLoop() {
    return this.get(CONFIG_KEYS.TELEGRAM_NOTIFY_INFINITE_LOOP);
  }

  isTelegramNotifyMaxRetry() {
    return this.get(CONFIG_KEYS.TELEGRAM_NOTIFY_MAX_RETRY);
  }

  isTelegramNotifyPaymentIssue() {
    return this.get(CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_ISSUE);
  }

  // ============================================================
  // 디버그/진단 메서드
  // ============================================================

  /**
   * 현재 캐시 상태 출력 (디버그용)
   */
  printStatus() {
    console.log('\n========== SharedConfig 상태 ==========');
    console.log(`마지막 동기화: ${this.lastSyncTime ? this.lastSyncTime.toLocaleString('ko-KR') : '없음'}`);
    console.log(`동기화 간격: ${this.syncIntervalMs / 1000}초`);
    console.log(`자동 동기화: ${this.syncIntervalId ? '활성' : '비활성'}`);
    console.log('\n현재 설정:');

    for (const [key, value] of this.cache.entries()) {
      const defaultValue = CONFIG_DEFAULTS[key];
      const isDefault = value === defaultValue;
      console.log(`  ${key}: ${value}${isDefault ? ' (기본값)' : ''}`);
    }

    console.log('==========================================\n');
  }

  /**
   * 설정 요약 객체 반환
   *
   * @returns {Object}
   */
  getSummary() {
    return {
      lastSyncTime: this.lastSyncTime,
      syncIntervalMs: this.syncIntervalMs,
      isAutoSyncActive: !!this.syncIntervalId,
      configCount: this.cache.size,
      config: Object.fromEntries(this.cache)
    };
  }
}

module.exports = SharedConfig;
