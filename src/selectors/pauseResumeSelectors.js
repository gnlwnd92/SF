/**
 * YouTube Premium Pause/Resume Subscription Selectors
 * Multi-language support for subscription management
 *
 * @module pauseResumeSelectors
 * @version 1.0.0
 *
 * Pattern follows cardChangeSelectors.js structure
 * Base language: English (en)
 * Supported: en, ko, ja (extensible)
 */

// =============================================================================
// SUPPORTED LANGUAGES
// =============================================================================

const SUPPORTED_PAUSE_RESUME_LANGUAGES = ['en', 'ko', 'ja'];

// =============================================================================
// LANGUAGE DETECTION INDICATORS
// =============================================================================

const PAUSE_RESUME_LANGUAGE_INDICATORS = {
  en: ['Membership', 'Manage membership', 'Premium', 'Billing', 'Your membership'],
  ko: ['멤버십', '멤버십 관리', '프리미엄', '결제', '내 멤버십'],
  ja: ['メンバーシップ', 'メンバーシップを管理', 'プレミアム', '請求', 'お客様のメンバーシップ']
};

// =============================================================================
// COMMON CSS SELECTORS
// =============================================================================

const PAUSE_RESUME_COMMON_SELECTORS = {
  // Page containers
  MEMBERSHIPS_PAGE: '#primary, ytd-browse[page-subtype="paid_memberships"]',
  SUBSCRIPTION_PANEL: '[class*="subscription"], [class*="membership"], ytd-section-list-renderer, [role="dialog"]',
  MODAL_CONTAINER: 'ytd-popup-container, tp-yt-paper-dialog, [role="dialog"]',

  // Interactive elements
  BUTTON_BASE: 'button, [role="button"], tp-yt-paper-button, yt-button-renderer, a[href]',
  CLICKABLE: 'button, [role="button"], a, [tabindex="0"]',

  // Manage membership
  MANAGE_LINK: 'a[href*="paid_memberships"], a[href*="membership"]',
  SETTINGS_BUTTON: '[class*="manage"], [class*="settings"], [aria-label*="anage"]',

  // Status indicators
  STATUS_BADGE: '[class*="status"], [class*="badge"], [class*="label"], [class*="chip"]',
  DATE_CONTAINER: '[class*="date"], [class*="billing"], [class*="renewal"]',

  // Form elements
  RADIO_BUTTON: 'input[type="radio"], [role="radio"], tp-yt-paper-radio-button',
  CHECKBOX: 'input[type="checkbox"], [role="checkbox"]'
};

// =============================================================================
// TEXT PATTERNS BY LANGUAGE
// =============================================================================

const PAUSE_RESUME_TEXT_PATTERNS = {
  // ---------------------------------------------------------------------------
  // ENGLISH (Base Language)
  // ---------------------------------------------------------------------------
  en: {
    // Navigation & Management
    MANAGE_MEMBERSHIP: ['Manage membership', 'Manage', 'Membership settings', 'Settings'],
    VIEW_MEMBERSHIP: ['View membership', 'Membership details', 'Your membership'],

    // === PAUSE FLOW ===
    // Initial deactivation options
    DEACTIVATE: ['Deactivate', 'Cancel membership', 'Cancel', 'Deactivate membership'],
    PAUSE: ['Pause', 'Pause membership', 'Pause payments'],

    // Pause confirmation variants
    PAUSE_INSTEAD: ['Pause instead', 'Pause payments instead', "I'd rather pause", 'Or pause instead'],
    PAUSE_PAYMENTS: ['Pause payments', 'Pause my payments', 'Pause billing'],
    PAUSE_CONFIRM: ['Pause', 'Yes, pause', 'Confirm pause'],

    // Pause reasons (for selection)
    PAUSE_REASONS: [
      'Too expensive',
      'Cost',
      "Don't use it enough",
      'Technical issues',
      'Missing content',
      'Switching to another service',
      'Other'
    ],

    // === RESUME FLOW ===
    RESUME: ['Resume', 'Resume membership', 'Resume payments', 'Resume billing'],
    RESTORE: ['Restore', 'Restore membership', 'Restore payments'],
    REACTIVATE: ['Reactivate', 'Reactivate membership', 'Turn back on'],
    RESUME_CONFIRM: ['Confirm', 'Yes, resume', 'Resume now', 'Confirm resume'],

    // === STATUS INDICATORS ===
    STATUS_PAUSED: ['Paused', 'Your membership is paused', 'Payments paused', 'Membership paused'],
    STATUS_ACTIVE: ['Active', 'Your membership is active', 'Next billing date', 'Renews on'],
    STATUS_CANCELLED: ['Cancelled', 'Expired', 'No active membership', 'Membership ended'],

    // === SUCCESS MESSAGES ===
    PAUSE_SUCCESS: ['successfully paused', 'Membership paused', 'Paused until', 'Your membership has been paused'],
    RESUME_SUCCESS: ['successfully resumed', 'Membership resumed', 'Welcome back', 'Your membership is now active'],

    // === DATE CONTEXT ===
    DATE_PREFIXES: ['Paused until', 'Resumes on', 'Next billing date:', 'Renews on', 'Expires on'],

    // === CONFIRMATION DIALOGS ===
    CONFIRM_DIALOG: ['Are you sure', 'Confirm', 'Continue'],
    CANCEL_BUTTON: ['Cancel', 'Go back', 'Never mind', 'No thanks']
  },

  // ---------------------------------------------------------------------------
  // KOREAN
  // ---------------------------------------------------------------------------
  ko: {
    MANAGE_MEMBERSHIP: ['멤버십 관리', '관리', '멤버십 설정', '설정'],
    VIEW_MEMBERSHIP: ['멤버십 보기', '멤버십 세부정보', '내 멤버십'],

    DEACTIVATE: ['비활성화', '멤버십 취소', '취소', '구독 취소', '해지'],
    PAUSE: ['일시중지', '멤버십 일시중지', '결제 일시중지', '일시정지'],

    PAUSE_INSTEAD: ['일시중지로 변경', '대신 일시중지', '일시중지하기', '일시중지를 원합니다'],
    PAUSE_PAYMENTS: ['결제 일시중지', '결제를 일시중지', '청구 일시중지'],
    PAUSE_CONFIRM: ['일시중지', '네, 일시중지합니다', '일시중지 확인'],

    PAUSE_REASONS: [
      '너무 비싸요',
      '비용',
      '자주 사용하지 않음',
      '기술적 문제',
      '콘텐츠 부족',
      '다른 서비스로 전환',
      '기타'
    ],

    RESUME: ['재개', '멤버십 재개', '결제 재개', '다시 시작', '재시작'],
    RESTORE: ['복원', '멤버십 복원', '결제 복원'],
    REACTIVATE: ['재활성화', '멤버십 재활성화', '다시 켜기'],
    RESUME_CONFIRM: ['확인', '네, 재개합니다', '지금 재개', '재개 확인'],

    STATUS_PAUSED: ['일시중지됨', '멤버십이 일시중지됨', '결제 일시중지됨', '일시정지됨', '일시정지 상태'],
    STATUS_ACTIVE: ['활성', '멤버십 활성', '다음 결제일', '갱신 예정일'],
    STATUS_CANCELLED: ['취소됨', '만료됨', '활성 멤버십 없음', '멤버십 종료'],

    PAUSE_SUCCESS: ['일시중지되었습니다', '멤버십 일시중지됨', '까지 일시중지', '멤버십이 일시중지되었습니다'],
    RESUME_SUCCESS: ['재개되었습니다', '멤버십 재개됨', '다시 오신 것을 환영', '멤버십이 활성화되었습니다'],

    DATE_PREFIXES: ['까지 일시중지', '재개일:', '다음 결제일:', '갱신일:', '만료일:'],

    CONFIRM_DIALOG: ['정말', '확인', '계속'],
    CANCEL_BUTTON: ['취소', '돌아가기', '아니요']
  },

  // ---------------------------------------------------------------------------
  // JAPANESE
  // ---------------------------------------------------------------------------
  ja: {
    MANAGE_MEMBERSHIP: ['メンバーシップを管理', '管理', 'メンバーシップ設定', '設定'],
    VIEW_MEMBERSHIP: ['メンバーシップを表示', 'メンバーシップの詳細', 'お客様のメンバーシップ'],

    DEACTIVATE: ['無効にする', 'メンバーシップをキャンセル', 'キャンセル', '解約'],
    PAUSE: ['一時停止', 'メンバーシップを一時停止', '支払いを一時停止'],

    PAUSE_INSTEAD: ['代わりに一時停止', '一時停止に変更', '一時停止を希望'],
    PAUSE_PAYMENTS: ['支払いを一時停止', '請求を一時停止'],
    PAUSE_CONFIRM: ['一時停止', 'はい、一時停止します', '一時停止を確認'],

    PAUSE_REASONS: [
      '高すぎる',
      '費用',
      'あまり使わない',
      '技術的な問題',
      'コンテンツ不足',
      '別のサービスに切り替え',
      'その他'
    ],

    RESUME: ['再開', 'メンバーシップを再開', '支払いを再開'],
    RESTORE: ['復元', 'メンバーシップを復元'],
    REACTIVATE: ['再有効化', 'メンバーシップを再有効化', '再度有効にする'],
    RESUME_CONFIRM: ['確認', 'はい、再開します', '今すぐ再開', '再開を確認'],

    STATUS_PAUSED: ['一時停止中', 'メンバーシップは一時停止中', '支払い一時停止中'],
    STATUS_ACTIVE: ['アクティブ', 'メンバーシップはアクティブ', '次の請求日'],
    STATUS_CANCELLED: ['キャンセル済み', '期限切れ', 'アクティブなメンバーシップなし'],

    PAUSE_SUCCESS: ['一時停止されました', 'メンバーシップが一時停止されました', 'まで一時停止'],
    RESUME_SUCCESS: ['再開されました', 'メンバーシップが再開されました', 'お帰りなさい'],

    DATE_PREFIXES: ['まで一時停止', '再開日:', '次の請求日:', '更新日:'],

    CONFIRM_DIALOG: ['本当に', '確認', '続行'],
    CANCEL_BUTTON: ['キャンセル', '戻る', 'いいえ']
  }
};

// =============================================================================
// DATE PARSING PATTERNS
// =============================================================================

const DATE_PATTERNS = {
  en: [
    // "January 15, 2024" or "Jan 15, 2024"
    /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}/gi,
    // "01/15/2024" or "1/15/24"
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
    // "2024-01-15"
    /\d{4}-\d{2}-\d{2}/g
  ],
  ko: [
    // "2024년 1월 15일"
    /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
    // "1월 15일"
    /\d{1,2}월\s*\d{1,2}일/g,
    // "2024.01.15"
    /\d{4}\.\d{1,2}\.\d{1,2}/g
  ],
  ja: [
    // "2024年1月15日"
    /\d{4}年\d{1,2}月\d{1,2}日/g,
    // "1月15日"
    /\d{1,2}月\d{1,2}日/g
  ]
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get selectors for a specific language
 * Falls back to English if language not supported
 *
 * @param {string} language - Language code (en, ko, ja)
 * @returns {Object} Combined selectors and text patterns
 */
function getPauseResumeSelectors(language = 'en') {
  const lang = SUPPORTED_PAUSE_RESUME_LANGUAGES.includes(language) ? language : 'en';

  return {
    ...PAUSE_RESUME_COMMON_SELECTORS,
    texts: PAUSE_RESUME_TEXT_PATTERNS[lang],
    datePatterns: DATE_PATTERNS[lang] || DATE_PATTERNS.en,
    language: lang
  };
}

/**
 * Detect page language from content
 *
 * @param {Object} page - Puppeteer page object
 * @returns {Promise<string>} Detected language code
 */
async function detectPauseResumeLanguage(page) {
  const pageText = await page.evaluate(() => document.body?.innerText || '');

  for (const [lang, indicators] of Object.entries(PAUSE_RESUME_LANGUAGE_INDICATORS)) {
    for (const indicator of indicators) {
      if (pageText.includes(indicator)) {
        return lang;
      }
    }
  }

  return 'en'; // Default to English
}

/**
 * Find element by matching text content
 *
 * @param {Object} page - Puppeteer page object
 * @param {string[]} textPatterns - Array of text patterns to match
 * @param {string} selectorBase - Base CSS selector
 * @returns {Promise<Object|null>} Found element or null
 */
async function findPauseResumeElement(page, textPatterns, selectorBase = PAUSE_RESUME_COMMON_SELECTORS.BUTTON_BASE) {
  for (const text of textPatterns) {
    try {
      const element = await page.evaluateHandle(
        (searchText, selector) => {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const elText = el.innerText || el.textContent || '';
            if (elText.toLowerCase().includes(searchText.toLowerCase())) {
              // Check if element is visible
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return el;
              }
            }
          }
          return null;
        },
        text,
        selectorBase
      );

      const jsHandle = element.asElement();
      if (jsHandle) {
        return jsHandle;
      }
    } catch (e) {
      // Continue to next pattern
      continue;
    }
  }

  return null;
}

/**
 * Find first matching element from multiple pattern sets
 *
 * @param {Object} page - Puppeteer page object
 * @param {Array<{texts: string[], selector: string}>} options - Search options
 * @returns {Promise<Object|null>} Found element or null
 */
async function findFirstPauseResumeElement(page, options) {
  for (const option of options) {
    const element = await findPauseResumeElement(
      page,
      option.texts,
      option.selector || PAUSE_RESUME_COMMON_SELECTORS.BUTTON_BASE
    );
    if (element) {
      return element;
    }
  }
  return null;
}

/**
 * Check if any of the text patterns exist on page
 *
 * @param {Object} page - Puppeteer page object
 * @param {string[][]} textArrays - Arrays of text patterns
 * @returns {Promise<boolean>} Whether any pattern was found
 */
async function checkPauseResumePageContent(page, textArrays) {
  const pageText = await page.evaluate(() => document.body?.innerText || '');
  const lowerPageText = pageText.toLowerCase();

  for (const texts of textArrays) {
    for (const text of texts) {
      if (lowerPageText.includes(text.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Wait for element to appear on page
 *
 * @param {Object} page - Puppeteer page object
 * @param {string[]} textPatterns - Text patterns to match
 * @param {string} selectorBase - Base CSS selector
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Found element
 * @throws {Error} If element not found within timeout
 */
async function waitForPauseResumeElement(page, textPatterns, selectorBase, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = await findPauseResumeElement(page, textPatterns, selectorBase);
    if (element) {
      return element;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Element with text [${textPatterns.join(', ')}] not found within ${timeout}ms`);
}

/**
 * Get element center coordinates for clicking
 *
 * @param {Object} page - Puppeteer page object
 * @param {Object} element - Element to get center of
 * @returns {Promise<{x: number, y: number}>} Center coordinates
 */
async function getElementCenter(page, element) {
  const box = await element.boundingBox();
  if (!box) {
    throw new Error('Element has no bounding box - may not be visible');
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

/**
 * Check subscription status on the page
 *
 * @param {Object} page - Puppeteer page object
 * @param {string} language - Language code
 * @returns {Promise<string>} Status: 'active', 'paused', 'cancelled', or 'unknown'
 */
async function checkSubscriptionStatus(page, language = 'en') {
  const texts = PAUSE_RESUME_TEXT_PATTERNS[language] || PAUSE_RESUME_TEXT_PATTERNS.en;

  // Check for paused status
  const isPaused = await checkPauseResumePageContent(page, [texts.STATUS_PAUSED]);
  if (isPaused) return 'paused';

  // Check for active status
  const isActive = await checkPauseResumePageContent(page, [texts.STATUS_ACTIVE]);
  if (isActive) return 'active';

  // Check for cancelled status
  const isCancelled = await checkPauseResumePageContent(page, [texts.STATUS_CANCELLED]);
  if (isCancelled) return 'cancelled';

  return 'unknown';
}

// =============================================================================
// EXPORTS (CommonJS for SF project compatibility)
// =============================================================================

module.exports = {
  SUPPORTED_LANGUAGES: SUPPORTED_PAUSE_RESUME_LANGUAGES,
  LANGUAGE_INDICATORS: PAUSE_RESUME_LANGUAGE_INDICATORS,
  COMMON_SELECTORS: PAUSE_RESUME_COMMON_SELECTORS,
  TEXT_PATTERNS: PAUSE_RESUME_TEXT_PATTERNS,
  DATE_PATTERNS,
  getSelectors: getPauseResumeSelectors,
  detectLanguage: detectPauseResumeLanguage,
  findElement: findPauseResumeElement,
  findFirstElement: findFirstPauseResumeElement,
  checkPageContent: checkPauseResumePageContent,
  waitForElement: waitForPauseResumeElement,
  getElementCenter,
  checkSubscriptionStatus
};
