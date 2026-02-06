/**
 * Google Sheets '설정' 탭 기반 설정 키 정의
 *
 * 단일 소스 (Single Source of Truth)
 * - ConfigRepository: 설정 탭 CRUD
 * - SharedConfig: 캐싱 + 5분 자동 동기화
 * - ScheduledSubscriptionWorkerUseCase: 통합워커
 * - EnhancedPauseSubscriptionUseCase: 일시중지
 * - EnhancedResumeSubscriptionUseCase: 재개
 */

/**
 * 설정 키 상수
 * Google Sheets '설정' 탭의 A열(설정키)과 매핑
 */
const CONFIG_KEYS = {
  // ▶ 시간 설정
  RESUME_MINUTES_BEFORE: 'RESUME_MINUTES_BEFORE',
  PAUSE_MINUTES_AFTER: 'PAUSE_MINUTES_AFTER',
  CHECK_INTERVAL_SECONDS: 'CHECK_INTERVAL_SECONDS',

  // ▶ 재시도 설정
  MAX_RETRY_COUNT: 'MAX_RETRY_COUNT',
  RETRY_DELAY_MS: 'RETRY_DELAY_MS',
  RETRY_ATTEMPTS: 'RETRY_ATTEMPTS',

  // ▶ 결제 미완료
  PAYMENT_PENDING_MAX_HOURS: 'PAYMENT_PENDING_MAX_HOURS',
  PAYMENT_PENDING_RETRY_MINUTES: 'PAYMENT_PENDING_RETRY_MINUTES',

  // ▶ 대기 시간
  CLICK_WAIT_MIN_MS: 'CLICK_WAIT_MIN_MS',
  CLICK_WAIT_MAX_MS: 'CLICK_WAIT_MAX_MS',
  PAGE_LOAD_WAIT_MS: 'PAGE_LOAD_WAIT_MS',
  POPUP_WAIT_MS: 'POPUP_WAIT_MS',

  // ▶ 타임아웃
  NAVIGATION_TIMEOUT_MS: 'NAVIGATION_TIMEOUT_MS',
  LOGIN_CHECK_TIMEOUT_MS: 'LOGIN_CHECK_TIMEOUT_MS',
  LANGUAGE_DETECT_TIMEOUT_MS: 'LANGUAGE_DETECT_TIMEOUT_MS',

  // ▶ 브라우저
  BROWSER_CLOSE_DELAY_MS: 'BROWSER_CLOSE_DELAY_MS',
  BROWSER_REOPEN_DELAY_MS: 'BROWSER_REOPEN_DELAY_MS',

  // ▶ 잠금
  LOCK_EXPIRY_MINUTES: 'LOCK_EXPIRY_MINUTES',

  // ▶ 자동화 탐지 우회 (v2.16)
  ENABLE_RANDOM_ENTRY: 'ENABLE_RANDOM_ENTRY',

  // ▶ 프록시 우회 (v2.20)
  PROXY_RETRY_THRESHOLD: 'PROXY_RETRY_THRESHOLD',

  // ▶ Telegram 알림 (유형별 ON/OFF)
  TELEGRAM_NOTIFY_CRITICAL: 'TELEGRAM_NOTIFY_CRITICAL',
  TELEGRAM_NOTIFY_PAYMENT_DELAY: 'TELEGRAM_NOTIFY_PAYMENT_DELAY',
  TELEGRAM_NOTIFY_INFINITE_LOOP: 'TELEGRAM_NOTIFY_INFINITE_LOOP',
  TELEGRAM_NOTIFY_MAX_RETRY: 'TELEGRAM_NOTIFY_MAX_RETRY',
  TELEGRAM_NOTIFY_PAYMENT_ISSUE: 'TELEGRAM_NOTIFY_PAYMENT_ISSUE'
};

/**
 * 기본값 (프로젝트 실제 값 기준)
 * Google Sheets '설정' 탭에 값이 없을 때 사용
 */
const CONFIG_DEFAULTS = {
  // ▶ 시간 설정
  [CONFIG_KEYS.RESUME_MINUTES_BEFORE]: 30,       // 결제 전 M분에 "일시중지" → "결제중"
  [CONFIG_KEYS.PAUSE_MINUTES_AFTER]: 10,         // 결제 후 N분에 "결제중" → "일시중지"
  [CONFIG_KEYS.CHECK_INTERVAL_SECONDS]: 60,      // 통합워커 체크 간격 (초)

  // ▶ 재시도 설정
  [CONFIG_KEYS.MAX_RETRY_COUNT]: 10,             // 최대 재시도 횟수
  [CONFIG_KEYS.RETRY_DELAY_MS]: 2000,            // 재시도 간 대기 시간 (ms)
  [CONFIG_KEYS.RETRY_ATTEMPTS]: 3,               // AdsPower API 재시도 횟수

  // ▶ 결제 미완료
  [CONFIG_KEYS.PAYMENT_PENDING_MAX_HOURS]: 24,   // 결제 미완료 최대 대기 (시간)
  [CONFIG_KEYS.PAYMENT_PENDING_RETRY_MINUTES]: 30, // 결제 미완료 재시도 간격 (분)

  // ▶ 대기 시간
  [CONFIG_KEYS.CLICK_WAIT_MIN_MS]: 500,          // 클릭 전 최소 대기 (ms)
  [CONFIG_KEYS.CLICK_WAIT_MAX_MS]: 1500,         // 클릭 전 최대 대기 (ms)
  [CONFIG_KEYS.PAGE_LOAD_WAIT_MS]: 3000,         // 페이지 로드 대기 (ms)
  [CONFIG_KEYS.POPUP_WAIT_MS]: 2000,             // 팝업 표시 대기 (ms)

  // ▶ 타임아웃
  [CONFIG_KEYS.NAVIGATION_TIMEOUT_MS]: 30000,    // 페이지 네비게이션 타임아웃 (ms)
  [CONFIG_KEYS.LOGIN_CHECK_TIMEOUT_MS]: 10000,   // 로그인 체크 타임아웃 (ms)
  [CONFIG_KEYS.LANGUAGE_DETECT_TIMEOUT_MS]: 5000, // 언어 감지 타임아웃 (ms)

  // ▶ 브라우저
  [CONFIG_KEYS.BROWSER_CLOSE_DELAY_MS]: 2000,    // 브라우저 종료 후 대기 (ms)
  [CONFIG_KEYS.BROWSER_REOPEN_DELAY_MS]: 5000,   // 브라우저 재시작 전 대기 (ms)

  // ▶ 잠금
  [CONFIG_KEYS.LOCK_EXPIRY_MINUTES]: 15,         // 좀비 잠금 만료 시간 (분)

  // ▶ 자동화 탐지 우회 (v2.16)
  [CONFIG_KEYS.ENABLE_RANDOM_ENTRY]: true,       // 랜덤 진입 경로 활성화

  // ▶ 프록시 우회 (v2.20, v2.23 기본값 변경: 2→1)
  [CONFIG_KEYS.PROXY_RETRY_THRESHOLD]: 1,        // N회 실패 시 다른 프록시로 우회

  // ▶ Telegram 알림 (유형별 ON/OFF)
  [CONFIG_KEYS.TELEGRAM_NOTIFY_CRITICAL]: true,           // 영구실패 알림 (만료/계정잠김/reCAPTCHA)
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_DELAY]: true,      // 결제 미완료 24시간 초과 알림
  [CONFIG_KEYS.TELEGRAM_NOTIFY_INFINITE_LOOP]: true,      // 무한루프 감지 알림
  [CONFIG_KEYS.TELEGRAM_NOTIFY_MAX_RETRY]: true,          // 최대 재시도 초과 알림
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_ISSUE]: true       // 결제수단 문제 알림 (Action needed)
};

/**
 * 설정 설명 (C열)
 */
const CONFIG_DESCRIPTIONS = {
  [CONFIG_KEYS.RESUME_MINUTES_BEFORE]: '결제 전 M분에 "일시중지" → "결제중" 전환',
  [CONFIG_KEYS.PAUSE_MINUTES_AFTER]: '결제 후 N분에 "결제중" → "일시중지" 전환',
  [CONFIG_KEYS.CHECK_INTERVAL_SECONDS]: '통합워커 체크 간격 (초)',

  [CONFIG_KEYS.MAX_RETRY_COUNT]: '최대 재시도 횟수',
  [CONFIG_KEYS.RETRY_DELAY_MS]: '재시도 간 대기 시간 (ms)',
  [CONFIG_KEYS.RETRY_ATTEMPTS]: 'AdsPower API 재시도 횟수',

  [CONFIG_KEYS.PAYMENT_PENDING_MAX_HOURS]: '결제 미완료 최대 대기 (시간)',
  [CONFIG_KEYS.PAYMENT_PENDING_RETRY_MINUTES]: '결제 미완료 재시도 간격 (분)',

  [CONFIG_KEYS.CLICK_WAIT_MIN_MS]: '클릭 전 최소 대기 (ms)',
  [CONFIG_KEYS.CLICK_WAIT_MAX_MS]: '클릭 전 최대 대기 (ms)',
  [CONFIG_KEYS.PAGE_LOAD_WAIT_MS]: '페이지 로드 대기 (ms)',
  [CONFIG_KEYS.POPUP_WAIT_MS]: '팝업 표시 대기 (ms)',

  [CONFIG_KEYS.NAVIGATION_TIMEOUT_MS]: '페이지 네비게이션 타임아웃 (ms)',
  [CONFIG_KEYS.LOGIN_CHECK_TIMEOUT_MS]: '로그인 체크 타임아웃 (ms)',
  [CONFIG_KEYS.LANGUAGE_DETECT_TIMEOUT_MS]: '언어 감지 타임아웃 (ms)',

  [CONFIG_KEYS.BROWSER_CLOSE_DELAY_MS]: '브라우저 종료 후 대기 (ms)',
  [CONFIG_KEYS.BROWSER_REOPEN_DELAY_MS]: '브라우저 재시작 전 대기 (ms)',

  [CONFIG_KEYS.LOCK_EXPIRY_MINUTES]: '좀비 잠금 만료 시간 (분)',

  [CONFIG_KEYS.ENABLE_RANDOM_ENTRY]: '랜덤 진입 경로 활성화 (자동화 탐지 우회)',

  [CONFIG_KEYS.PROXY_RETRY_THRESHOLD]: 'N회 실패 시 다른 프록시로 우회',

  [CONFIG_KEYS.TELEGRAM_NOTIFY_CRITICAL]: '영구실패 알림 (만료/계정잠김/reCAPTCHA)',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_DELAY]: '결제 미완료 24시간 초과 알림',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_INFINITE_LOOP]: '무한루프 감지 알림',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_MAX_RETRY]: '최대 재시도 초과 알림',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_ISSUE]: '결제수단 문제 알림 (Action needed)'
};

/**
 * 타입 정의 (값 파싱용)
 * number | boolean | string
 */
const CONFIG_TYPES = {
  [CONFIG_KEYS.RESUME_MINUTES_BEFORE]: 'number',
  [CONFIG_KEYS.PAUSE_MINUTES_AFTER]: 'number',
  [CONFIG_KEYS.CHECK_INTERVAL_SECONDS]: 'number',

  [CONFIG_KEYS.MAX_RETRY_COUNT]: 'number',
  [CONFIG_KEYS.RETRY_DELAY_MS]: 'number',
  [CONFIG_KEYS.RETRY_ATTEMPTS]: 'number',

  [CONFIG_KEYS.PAYMENT_PENDING_MAX_HOURS]: 'number',
  [CONFIG_KEYS.PAYMENT_PENDING_RETRY_MINUTES]: 'number',

  [CONFIG_KEYS.CLICK_WAIT_MIN_MS]: 'number',
  [CONFIG_KEYS.CLICK_WAIT_MAX_MS]: 'number',
  [CONFIG_KEYS.PAGE_LOAD_WAIT_MS]: 'number',
  [CONFIG_KEYS.POPUP_WAIT_MS]: 'number',

  [CONFIG_KEYS.NAVIGATION_TIMEOUT_MS]: 'number',
  [CONFIG_KEYS.LOGIN_CHECK_TIMEOUT_MS]: 'number',
  [CONFIG_KEYS.LANGUAGE_DETECT_TIMEOUT_MS]: 'number',

  [CONFIG_KEYS.BROWSER_CLOSE_DELAY_MS]: 'number',
  [CONFIG_KEYS.BROWSER_REOPEN_DELAY_MS]: 'number',

  [CONFIG_KEYS.LOCK_EXPIRY_MINUTES]: 'number',

  [CONFIG_KEYS.ENABLE_RANDOM_ENTRY]: 'boolean',

  [CONFIG_KEYS.PROXY_RETRY_THRESHOLD]: 'number',

  [CONFIG_KEYS.TELEGRAM_NOTIFY_CRITICAL]: 'boolean',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_DELAY]: 'boolean',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_INFINITE_LOOP]: 'boolean',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_MAX_RETRY]: 'boolean',
  [CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_ISSUE]: 'boolean'
};

/**
 * 카테고리 정의 (Google Sheets 시각화용)
 */
const CONFIG_CATEGORIES = {
  TIME_SETTINGS: {
    label: '▶ 시간 설정',
    keys: [
      CONFIG_KEYS.RESUME_MINUTES_BEFORE,
      CONFIG_KEYS.PAUSE_MINUTES_AFTER,
      CONFIG_KEYS.CHECK_INTERVAL_SECONDS
    ]
  },
  RETRY_SETTINGS: {
    label: '▶ 재시도 설정',
    keys: [
      CONFIG_KEYS.MAX_RETRY_COUNT,
      CONFIG_KEYS.RETRY_DELAY_MS,
      CONFIG_KEYS.RETRY_ATTEMPTS
    ]
  },
  PAYMENT_PENDING: {
    label: '▶ 결제 미완료',
    keys: [
      CONFIG_KEYS.PAYMENT_PENDING_MAX_HOURS,
      CONFIG_KEYS.PAYMENT_PENDING_RETRY_MINUTES
    ]
  },
  WAIT_TIMES: {
    label: '▶ 대기 시간',
    keys: [
      CONFIG_KEYS.CLICK_WAIT_MIN_MS,
      CONFIG_KEYS.CLICK_WAIT_MAX_MS,
      CONFIG_KEYS.PAGE_LOAD_WAIT_MS,
      CONFIG_KEYS.POPUP_WAIT_MS
    ]
  },
  TIMEOUTS: {
    label: '▶ 타임아웃',
    keys: [
      CONFIG_KEYS.NAVIGATION_TIMEOUT_MS,
      CONFIG_KEYS.LOGIN_CHECK_TIMEOUT_MS,
      CONFIG_KEYS.LANGUAGE_DETECT_TIMEOUT_MS
    ]
  },
  BROWSER: {
    label: '▶ 브라우저',
    keys: [
      CONFIG_KEYS.BROWSER_CLOSE_DELAY_MS,
      CONFIG_KEYS.BROWSER_REOPEN_DELAY_MS
    ]
  },
  LOCK: {
    label: '▶ 잠금',
    keys: [
      CONFIG_KEYS.LOCK_EXPIRY_MINUTES
    ]
  },
  ANTI_DETECTION: {
    label: '▶ 자동화 탐지 우회',
    keys: [
      CONFIG_KEYS.ENABLE_RANDOM_ENTRY
    ]
  },
  PROXY: {
    label: '▶ 프록시 우회',
    keys: [
      CONFIG_KEYS.PROXY_RETRY_THRESHOLD
    ]
  },
  TELEGRAM: {
    label: '▶ Telegram 알림',
    keys: [
      CONFIG_KEYS.TELEGRAM_NOTIFY_CRITICAL,
      CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_DELAY,
      CONFIG_KEYS.TELEGRAM_NOTIFY_INFINITE_LOOP,
      CONFIG_KEYS.TELEGRAM_NOTIFY_MAX_RETRY,
      CONFIG_KEYS.TELEGRAM_NOTIFY_PAYMENT_ISSUE
    ]
  }
};

module.exports = {
  CONFIG_KEYS,
  CONFIG_DEFAULTS,
  CONFIG_DESCRIPTIONS,
  CONFIG_TYPES,
  CONFIG_CATEGORIES
};
