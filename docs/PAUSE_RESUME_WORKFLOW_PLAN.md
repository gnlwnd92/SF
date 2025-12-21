# YouTube Premium Pause/Resume Subscription Workflow Plan

> Version: 1.0.0
> Date: 2025-12-21
> Target Project: GYN (ypsas-core)

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Pause Subscription Workflow](#3-pause-subscription-workflow)
4. [Resume Subscription Workflow](#4-resume-subscription-workflow)
5. [Selector Definitions](#5-selector-definitions)
6. [Language Pack Structure](#6-language-pack-structure)
7. [Physical Input Integration](#7-physical-input-integration)
8. [Error Handling & Retry Strategy](#8-error-handling--retry-strategy)
9. [Date Parsing Service](#9-date-parsing-service)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Overview

### 1.1 Purpose

Implement YouTube Premium subscription pause and resume functionality using:
- **CDP (Chrome DevTools Protocol)** for element detection and DOM querying
- **Physical mouse/keyboard input** via nut-js for human-like interactions
- **Human behavior simulation** to bypass automation detection

### 1.2 Key Requirements

| Requirement | Implementation |
|-------------|----------------|
| Element Detection | CDP `Runtime.evaluate`, `DOM.querySelector` |
| Mouse Movement | Bezier curves with Gaussian randomization |
| Keyboard Input | Physical keystrokes with variable delays |
| Scrolling | Physical scroll events with momentum simulation |
| Language Support | English base + Korean + extensible language packs |
| Anti-Detection | Random delays, natural mouse paths, isTrusted events |

### 1.3 Reference Implementation

Based on existing `CardSwitcher.js` pattern:
- 8-step workflow structure
- `HumanMouseMover` class for natural mouse movement
- Step-based retry configuration
- Coordinate transformation for physical input

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    PauseResumeService                        │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ PauseWorkflow   │  │ ResumeWorkflow  │                   │
│  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                             │
│           ▼                    ▼                             │
│  ┌─────────────────────────────────────────────────┐        │
│  │              WorkflowExecutor                    │        │
│  │  - Step management                               │        │
│  │  - Retry logic                                   │        │
│  │  - State persistence                             │        │
│  └────────────────────────┬────────────────────────┘        │
└───────────────────────────┼─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ ElementFinder │  │ HumanMouseMover│ │PhysicalInput  │
│ (CDP-based)   │  │ (Bezier+Random)│ │Service        │
└───────────────┘  └───────────────┘  └───────────────┘
        │                   │                   │
        │                   ▼                   │
        │          ┌───────────────┐           │
        │          │ Coordinate    │           │
        │          │ Transformer   │           │
        │          └───────────────┘           │
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   pauseResumeSelectors │
                │   (Multi-language)     │
                └───────────────────────┘
```

### 2.2 File Structure

```
src/
├── services/
│   └── subscription/
│       ├── PauseResumeService.js      # Main orchestrator
│       ├── PauseWorkflow.js           # Pause-specific steps
│       ├── ResumeWorkflow.js          # Resume-specific steps
│       └── SubscriptionDateParser.js  # Date extraction & parsing
├── selectors/
│   └── pauseResumeSelectors.js        # Multi-language selectors
└── utils/
    └── HumanMouseMover.js             # (Existing, shared)
```

---

## 3. Pause Subscription Workflow

### 3.1 Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  PAUSE SUBSCRIPTION WORKFLOW                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: Navigate to Memberships                            │
│     └── URL: youtube.com/paid_memberships                   │
│                                                              │
│  Step 2: Detect Language                                    │
│     └── Parse page content for language indicators          │
│                                                              │
│  Step 3: Find "Manage membership" button                    │
│     └── CDP querySelector + text matching                   │
│                                                              │
│  Step 4: Click "Manage membership"                          │
│     └── Physical mouse click with Bezier movement           │
│                                                              │
│  Step 5: Wait for subscription panel                        │
│     └── Wait for panel animation complete                   │
│                                                              │
│  Step 6: Find "Deactivate" or "Pause" button               │
│     └── Language-aware text search                          │
│                                                              │
│  Step 7: Click deactivate/pause button                      │
│     └── Physical click                                       │
│                                                              │
│  Step 8: Handle pause reason selection                      │
│     └── Select reason (if prompted)                         │
│                                                              │
│  Step 9: Find "Pause payments" or "Pause instead"          │
│     └── Primary pause confirmation button                   │
│                                                              │
│  Step 10: Click pause confirmation                          │
│     └── Physical click + verification                       │
│                                                              │
│  Step 11: Verify pause success                              │
│     └── Check for "Paused" status or confirmation message  │
│                                                              │
│  Step 12: Extract pause end date                            │
│     └── Parse date from confirmation screen                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Step Definitions

```javascript
const PAUSE_WORKFLOW_STEPS = {
  NAVIGATE: {
    id: 'navigate',
    name: 'Navigate to Memberships',
    timeout: 15000,
    retries: 2,
    action: async (ctx) => {
      await ctx.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 15000
      });
    }
  },

  DETECT_LANGUAGE: {
    id: 'detect_language',
    name: 'Detect Page Language',
    timeout: 5000,
    retries: 1,
    action: async (ctx) => {
      const language = await detectPageLanguage(ctx.page);
      ctx.state.language = language;
      return { language };
    }
  },

  FIND_MANAGE_BUTTON: {
    id: 'find_manage_button',
    name: 'Find Manage Membership Button',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);
      const element = await findElementByText(
        ctx.page,
        selectors.MANAGE_MEMBERSHIP_TEXTS,
        selectors.MANAGE_MEMBERSHIP_SELECTORS
      );
      ctx.state.manageButton = element;
      return { found: !!element };
    }
  },

  CLICK_MANAGE: {
    id: 'click_manage',
    name: 'Click Manage Membership',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.manageButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(800, 1500);
    }
  },

  WAIT_PANEL: {
    id: 'wait_panel',
    name: 'Wait for Subscription Panel',
    timeout: 8000,
    retries: 2,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);
      await ctx.page.waitForSelector(selectors.SUBSCRIPTION_PANEL, {
        visible: true,
        timeout: 8000
      });
      await randomDelay(500, 1000); // Panel animation
    }
  },

  FIND_DEACTIVATE: {
    id: 'find_deactivate',
    name: 'Find Deactivate/Pause Button',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);
      const element = await findElementByText(
        ctx.page,
        selectors.DEACTIVATE_TEXTS,
        selectors.BUTTON_SELECTORS
      );
      ctx.state.deactivateButton = element;
      return { found: !!element };
    }
  },

  CLICK_DEACTIVATE: {
    id: 'click_deactivate',
    name: 'Click Deactivate Button',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.deactivateButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(1000, 2000);
    }
  },

  HANDLE_REASON: {
    id: 'handle_reason',
    name: 'Handle Pause Reason Selection',
    timeout: 10000,
    retries: 2,
    optional: true, // May not appear
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // Check if reason selection exists
      const reasonRadio = await findElementByText(
        ctx.page,
        selectors.PAUSE_REASON_TEXTS,
        'input[type="radio"], [role="radio"]'
      );

      if (reasonRadio) {
        const coords = await getElementCenter(ctx.page, reasonRadio);
        await ctx.mouseMover.moveAndClick(coords.x, coords.y);
        await randomDelay(500, 1000);
      }

      return { reasonSelected: !!reasonRadio };
    }
  },

  FIND_PAUSE_CONFIRM: {
    id: 'find_pause_confirm',
    name: 'Find Pause Confirmation Button',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // Priority order: "Pause instead" > "Pause payments" > "Pause"
      const element = await findFirstElement(ctx.page, [
        { texts: selectors.PAUSE_INSTEAD_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.PAUSE_PAYMENTS_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.PAUSE_TEXTS, selector: selectors.BUTTON_SELECTORS }
      ]);

      ctx.state.pauseConfirmButton = element;
      return { found: !!element };
    }
  },

  CLICK_PAUSE_CONFIRM: {
    id: 'click_pause_confirm',
    name: 'Click Pause Confirmation',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.pauseConfirmButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(2000, 3000);
    }
  },

  VERIFY_SUCCESS: {
    id: 'verify_success',
    name: 'Verify Pause Success',
    timeout: 15000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // Check for success indicators
      const success = await checkForElements(ctx.page, [
        selectors.PAUSED_STATUS_TEXTS,
        selectors.PAUSE_SUCCESS_TEXTS,
        selectors.RESUME_BUTTON_TEXTS // If resume button appears, pause was successful
      ]);

      if (!success) {
        throw new Error('Pause verification failed - no success indicators found');
      }

      return { verified: true };
    }
  },

  EXTRACT_DATE: {
    id: 'extract_date',
    name: 'Extract Pause End Date',
    timeout: 5000,
    retries: 1,
    optional: true,
    action: async (ctx) => {
      const dateText = await extractDateFromPage(ctx.page, ctx.state.language);
      ctx.state.pauseEndDate = dateText;
      return { date: dateText };
    }
  }
};
```

### 3.3 Status Detection

```javascript
/**
 * Detect current subscription status before starting workflow
 */
const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',           // Normal active subscription
  PAUSED: 'paused',           // Currently paused
  CANCELLED: 'cancelled',     // Cancelled/expired
  UNKNOWN: 'unknown'
};

async function detectSubscriptionStatus(page, language) {
  const selectors = getSelectors(language);

  // Check for paused status
  const pausedIndicator = await findElementByText(
    page,
    selectors.PAUSED_STATUS_TEXTS,
    '*'
  );
  if (pausedIndicator) return SUBSCRIPTION_STATUS.PAUSED;

  // Check for active status
  const activeIndicator = await findElementByText(
    page,
    selectors.ACTIVE_STATUS_TEXTS,
    '*'
  );
  if (activeIndicator) return SUBSCRIPTION_STATUS.ACTIVE;

  // Check for cancelled
  const cancelledIndicator = await findElementByText(
    page,
    selectors.CANCELLED_STATUS_TEXTS,
    '*'
  );
  if (cancelledIndicator) return SUBSCRIPTION_STATUS.CANCELLED;

  return SUBSCRIPTION_STATUS.UNKNOWN;
}
```

---

## 4. Resume Subscription Workflow

### 4.1 Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                 RESUME SUBSCRIPTION WORKFLOW                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: Navigate to Memberships                            │
│     └── URL: youtube.com/paid_memberships                   │
│                                                              │
│  Step 2: Detect Language                                    │
│     └── Parse page content for language indicators          │
│                                                              │
│  Step 3: Verify Paused Status                               │
│     └── Confirm subscription is currently paused            │
│                                                              │
│  Step 4: Find "Manage membership" button                    │
│     └── CDP querySelector + text matching                   │
│                                                              │
│  Step 5: Click "Manage membership"                          │
│     └── Physical mouse click with Bezier movement           │
│                                                              │
│  Step 6: Wait for subscription panel                        │
│     └── Wait for panel animation complete                   │
│                                                              │
│  Step 7: Find "Resume" or "Restore" button                  │
│     └── Language-aware text search                          │
│                                                              │
│  Step 8: Click resume button                                │
│     └── Physical click                                       │
│                                                              │
│  Step 9: Handle confirmation dialog (if any)                │
│     └── Confirm resume action                               │
│                                                              │
│  Step 10: Verify resume success                             │
│     └── Check for "Active" status or success message        │
│                                                              │
│  Step 11: Extract next billing date                         │
│     └── Parse date from confirmation screen                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Step Definitions

```javascript
const RESUME_WORKFLOW_STEPS = {
  NAVIGATE: {
    id: 'navigate',
    name: 'Navigate to Memberships',
    timeout: 15000,
    retries: 2,
    action: async (ctx) => {
      await ctx.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 15000
      });
    }
  },

  DETECT_LANGUAGE: {
    id: 'detect_language',
    name: 'Detect Page Language',
    timeout: 5000,
    retries: 1,
    action: async (ctx) => {
      const language = await detectPageLanguage(ctx.page);
      ctx.state.language = language;
      return { language };
    }
  },

  VERIFY_PAUSED: {
    id: 'verify_paused',
    name: 'Verify Subscription is Paused',
    timeout: 10000,
    retries: 2,
    action: async (ctx) => {
      const status = await detectSubscriptionStatus(ctx.page, ctx.state.language);

      if (status === SUBSCRIPTION_STATUS.ACTIVE) {
        throw new Error('ALREADY_ACTIVE: Subscription is already active');
      }

      if (status !== SUBSCRIPTION_STATUS.PAUSED) {
        throw new Error(`INVALID_STATUS: Expected paused, got ${status}`);
      }

      return { status };
    }
  },

  FIND_MANAGE_BUTTON: {
    id: 'find_manage_button',
    name: 'Find Manage Membership Button',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);
      const element = await findElementByText(
        ctx.page,
        selectors.MANAGE_MEMBERSHIP_TEXTS,
        selectors.MANAGE_MEMBERSHIP_SELECTORS
      );
      ctx.state.manageButton = element;
      return { found: !!element };
    }
  },

  CLICK_MANAGE: {
    id: 'click_manage',
    name: 'Click Manage Membership',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.manageButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(800, 1500);
    }
  },

  WAIT_PANEL: {
    id: 'wait_panel',
    name: 'Wait for Subscription Panel',
    timeout: 8000,
    retries: 2,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);
      await ctx.page.waitForSelector(selectors.SUBSCRIPTION_PANEL, {
        visible: true,
        timeout: 8000
      });
      await randomDelay(500, 1000);
    }
  },

  FIND_RESUME_BUTTON: {
    id: 'find_resume',
    name: 'Find Resume Button',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      const element = await findFirstElement(ctx.page, [
        { texts: selectors.RESUME_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.RESTORE_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.REACTIVATE_TEXTS, selector: selectors.BUTTON_SELECTORS }
      ]);

      ctx.state.resumeButton = element;
      return { found: !!element };
    }
  },

  CLICK_RESUME: {
    id: 'click_resume',
    name: 'Click Resume Button',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.resumeButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(1500, 2500);
    }
  },

  HANDLE_CONFIRM_DIALOG: {
    id: 'handle_confirm',
    name: 'Handle Confirmation Dialog',
    timeout: 10000,
    retries: 2,
    optional: true,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // Check for confirmation dialog
      const confirmButton = await findElementByText(
        ctx.page,
        selectors.CONFIRM_RESUME_TEXTS,
        selectors.BUTTON_SELECTORS
      );

      if (confirmButton) {
        const coords = await getElementCenter(ctx.page, confirmButton);
        await ctx.mouseMover.moveAndClick(coords.x, coords.y);
        await randomDelay(2000, 3000);
      }

      return { dialogHandled: !!confirmButton };
    }
  },

  VERIFY_SUCCESS: {
    id: 'verify_success',
    name: 'Verify Resume Success',
    timeout: 15000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // Check for success indicators
      const success = await checkForElements(ctx.page, [
        selectors.ACTIVE_STATUS_TEXTS,
        selectors.RESUME_SUCCESS_TEXTS,
        selectors.DEACTIVATE_TEXTS // If deactivate button appears, resume was successful
      ]);

      if (!success) {
        throw new Error('Resume verification failed - no success indicators found');
      }

      return { verified: true };
    }
  },

  EXTRACT_BILLING_DATE: {
    id: 'extract_date',
    name: 'Extract Next Billing Date',
    timeout: 5000,
    retries: 1,
    optional: true,
    action: async (ctx) => {
      const dateText = await extractBillingDateFromPage(ctx.page, ctx.state.language);
      ctx.state.nextBillingDate = dateText;
      return { date: dateText };
    }
  }
};
```

---

## 5. Selector Definitions

### 5.1 pauseResumeSelectors.js Structure

```javascript
/**
 * YouTube Premium Pause/Resume Selectors
 * Multi-language support with English as base
 *
 * Pattern follows cardChangeSelectors.js structure
 */

// Supported languages for pause/resume
export const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'de', 'fr', 'es', 'pt', 'vi', 'th', 'id'];

// Language detection indicators
export const LANGUAGE_INDICATORS = {
  en: ['Membership', 'Manage membership', 'Premium', 'Billing'],
  ko: ['멤버십', '멤버십 관리', '프리미엄', '결제'],
  ja: ['メンバーシップ', 'メンバーシップを管理', 'プレミアム'],
  de: ['Mitgliedschaft', 'Mitgliedschaft verwalten', 'Premium'],
  fr: ['Abonnement', 'Gérer l\'abonnement', 'Premium'],
  es: ['Membresía', 'Gestionar membresía', 'Premium'],
  pt: ['Assinatura', 'Gerenciar assinatura', 'Premium'],
  vi: ['Gói thành viên', 'Quản lý gói thành viên', 'Premium'],
  th: ['สมาชิก', 'จัดการสมาชิก', 'พรีเมียม'],
  id: ['Keanggotaan', 'Kelola keanggotaan', 'Premium']
};

// Common CSS selectors
export const COMMON_SELECTORS = {
  // Membership page
  SUBSCRIPTION_PANEL: '[class*="subscription"], [class*="membership"], ytd-section-list-renderer',

  // Buttons
  BUTTON_SELECTORS: 'button, [role="button"], a[href*="youtube"], tp-yt-paper-button, yt-button-renderer',

  // Manage membership specific
  MANAGE_MEMBERSHIP_SELECTORS: 'a[href*="paid_memberships"], button[aria-label*="Manage"], [class*="manage"]',

  // Status indicators
  STATUS_CONTAINER: '[class*="status"], [class*="badge"], [class*="label"]'
};

// Text patterns by language
export const TEXT_PATTERNS = {
  en: {
    // Navigation & Management
    MANAGE_MEMBERSHIP_TEXTS: ['Manage membership', 'Manage', 'Membership settings'],

    // Pause flow
    DEACTIVATE_TEXTS: ['Deactivate', 'Cancel membership', 'Cancel', 'Deactivate membership'],
    PAUSE_TEXTS: ['Pause', 'Pause membership', 'Pause payments'],
    PAUSE_INSTEAD_TEXTS: ['Pause instead', 'Pause payments instead', 'I\'d rather pause'],
    PAUSE_PAYMENTS_TEXTS: ['Pause payments', 'Pause my payments'],
    PAUSE_REASON_TEXTS: ['Too expensive', 'Cost', 'Don\'t use it enough', 'Technical issues'],

    // Resume flow
    RESUME_TEXTS: ['Resume', 'Resume membership', 'Resume payments'],
    RESTORE_TEXTS: ['Restore', 'Restore membership'],
    REACTIVATE_TEXTS: ['Reactivate', 'Reactivate membership'],
    CONFIRM_RESUME_TEXTS: ['Confirm', 'Yes, resume', 'Resume now'],

    // Status texts
    PAUSED_STATUS_TEXTS: ['Paused', 'Your membership is paused', 'Payments paused'],
    ACTIVE_STATUS_TEXTS: ['Active', 'Your membership is active', 'Next billing date'],
    CANCELLED_STATUS_TEXTS: ['Cancelled', 'Expired', 'No active membership'],

    // Success messages
    PAUSE_SUCCESS_TEXTS: ['successfully paused', 'Membership paused', 'Paused until'],
    RESUME_SUCCESS_TEXTS: ['successfully resumed', 'Membership resumed', 'Welcome back'],

    // Date patterns
    DATE_PATTERNS: [
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/gi,
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
      /\d{4}-\d{2}-\d{2}/g
    ]
  },

  ko: {
    // Navigation & Management
    MANAGE_MEMBERSHIP_TEXTS: ['멤버십 관리', '관리', '멤버십 설정'],

    // Pause flow
    DEACTIVATE_TEXTS: ['비활성화', '멤버십 취소', '취소', '구독 취소'],
    PAUSE_TEXTS: ['일시중지', '멤버십 일시중지', '결제 일시중지'],
    PAUSE_INSTEAD_TEXTS: ['일시중지로 변경', '대신 일시중지', '일시중지하기'],
    PAUSE_PAYMENTS_TEXTS: ['결제 일시중지', '결제를 일시중지'],
    PAUSE_REASON_TEXTS: ['너무 비싸요', '비용', '자주 사용하지 않음', '기술적 문제'],

    // Resume flow
    RESUME_TEXTS: ['재개', '멤버십 재개', '결제 재개', '다시 시작'],
    RESTORE_TEXTS: ['복원', '멤버십 복원'],
    REACTIVATE_TEXTS: ['재활성화', '멤버십 재활성화'],
    CONFIRM_RESUME_TEXTS: ['확인', '네, 재개합니다', '지금 재개'],

    // Status texts
    PAUSED_STATUS_TEXTS: ['일시중지됨', '멤버십이 일시중지됨', '결제 일시중지됨', '일시정지'],
    ACTIVE_STATUS_TEXTS: ['활성', '멤버십 활성', '다음 결제일'],
    CANCELLED_STATUS_TEXTS: ['취소됨', '만료됨', '활성 멤버십 없음'],

    // Success messages
    PAUSE_SUCCESS_TEXTS: ['일시중지되었습니다', '멤버십 일시중지됨', '까지 일시중지'],
    RESUME_SUCCESS_TEXTS: ['재개되었습니다', '멤버십 재개됨', '다시 오신 것을 환영'],

    // Date patterns
    DATE_PATTERNS: [
      /\d{4}년 \d{1,2}월 \d{1,2}일/g,
      /\d{1,2}월 \d{1,2}일/g,
      /\d{4}\.\d{1,2}\.\d{1,2}/g
    ]
  },

  ja: {
    MANAGE_MEMBERSHIP_TEXTS: ['メンバーシップを管理', '管理', 'メンバーシップ設定'],
    DEACTIVATE_TEXTS: ['無効にする', 'メンバーシップをキャンセル', 'キャンセル'],
    PAUSE_TEXTS: ['一時停止', 'メンバーシップを一時停止', '支払いを一時停止'],
    PAUSE_INSTEAD_TEXTS: ['代わりに一時停止', '一時停止に変更'],
    PAUSE_PAYMENTS_TEXTS: ['支払いを一時停止'],
    PAUSE_REASON_TEXTS: ['高すぎる', '費用', 'あまり使わない', '技術的な問題'],
    RESUME_TEXTS: ['再開', 'メンバーシップを再開', '支払いを再開'],
    RESTORE_TEXTS: ['復元', 'メンバーシップを復元'],
    REACTIVATE_TEXTS: ['再有効化'],
    CONFIRM_RESUME_TEXTS: ['確認', 'はい、再開します', '今すぐ再開'],
    PAUSED_STATUS_TEXTS: ['一時停止中', 'メンバーシップは一時停止中'],
    ACTIVE_STATUS_TEXTS: ['アクティブ', 'メンバーシップはアクティブ', '次の請求日'],
    CANCELLED_STATUS_TEXTS: ['キャンセル済み', '期限切れ'],
    PAUSE_SUCCESS_TEXTS: ['一時停止されました', 'メンバーシップが一時停止'],
    RESUME_SUCCESS_TEXTS: ['再開されました', 'メンバーシップが再開'],
    DATE_PATTERNS: [
      /\d{4}年\d{1,2}月\d{1,2}日/g,
      /\d{1,2}月\d{1,2}日/g
    ]
  }

  // Additional languages follow same pattern...
};

// Helper function to get selectors for a specific language
export function getSelectors(language = 'en') {
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  return {
    ...COMMON_SELECTORS,
    ...TEXT_PATTERNS[lang],
    language: lang
  };
}

// Detect page language from content
export async function detectPageLanguage(page) {
  const pageText = await page.evaluate(() => document.body.innerText);

  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
    for (const indicator of indicators) {
      if (pageText.includes(indicator)) {
        return lang;
      }
    }
  }

  return 'en'; // Default to English
}

// Find element by text content
export async function findElementByText(page, textPatterns, selectorBase) {
  for (const text of textPatterns) {
    try {
      const element = await page.evaluateHandle((text, selector) => {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el.innerText?.includes(text) || el.textContent?.includes(text)) {
            return el;
          }
        }
        return null;
      }, text, selectorBase);

      if (element.asElement()) {
        return element;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// Find first matching element from multiple options
export async function findFirstElement(page, options) {
  for (const option of options) {
    const element = await findElementByText(page, option.texts, option.selector);
    if (element) return element;
  }
  return null;
}

// Check if any of the text patterns exist on page
export async function checkForElements(page, textArrays) {
  const pageText = await page.evaluate(() => document.body.innerText);

  for (const texts of textArrays) {
    for (const text of texts) {
      if (pageText.includes(text)) {
        return true;
      }
    }
  }
  return false;
}

// Wait for element with timeout
export async function waitForElement(page, textPatterns, selectorBase, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = await findElementByText(page, textPatterns, selectorBase);
    if (element) return element;
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`Element not found within ${timeout}ms`);
}
```

---

## 6. Language Pack Structure

### 6.1 Language Pack Interface

```javascript
/**
 * Language Pack Interface
 * All language packs must implement this structure
 */
export const LanguagePackInterface = {
  // Metadata
  code: 'string',           // ISO 639-1 code (en, ko, ja, etc.)
  name: 'string',           // Display name
  nativeName: 'string',     // Native name (English, 한국어, 日本語)

  // Detection indicators
  indicators: ['string'],   // Strings to detect this language on page

  // Text patterns
  texts: {
    // Management
    manageMemembership: ['string'],

    // Pause flow
    deactivate: ['string'],
    pause: ['string'],
    pauseInstead: ['string'],
    pausePayments: ['string'],
    pauseReasons: ['string'],

    // Resume flow
    resume: ['string'],
    restore: ['string'],
    reactivate: ['string'],
    confirmResume: ['string'],

    // Status
    pausedStatus: ['string'],
    activeStatus: ['string'],
    cancelledStatus: ['string'],

    // Success
    pauseSuccess: ['string'],
    resumeSuccess: ['string']
  },

  // Date parsing
  datePatterns: [RegExp],
  dateParser: Function  // (dateString) => Date
};
```

### 6.2 Adding New Language Pack

```javascript
// Example: Adding Vietnamese language pack
// File: src/selectors/languagePacks/vi.js

export const vietnamesePack = {
  code: 'vi',
  name: 'Vietnamese',
  nativeName: 'Tiếng Việt',

  indicators: ['Gói thành viên', 'Quản lý gói thành viên', 'Premium'],

  texts: {
    manageMembership: ['Quản lý gói thành viên', 'Quản lý'],
    deactivate: ['Hủy kích hoạt', 'Hủy gói thành viên'],
    pause: ['Tạm dừng', 'Tạm dừng gói thành viên'],
    pauseInstead: ['Thay vào đó, hãy tạm dừng'],
    pausePayments: ['Tạm dừng thanh toán'],
    pauseReasons: ['Quá đắt', 'Không sử dụng đủ'],
    resume: ['Tiếp tục', 'Tiếp tục gói thành viên'],
    restore: ['Khôi phục'],
    reactivate: ['Kích hoạt lại'],
    confirmResume: ['Xác nhận', 'Có, tiếp tục'],
    pausedStatus: ['Đã tạm dừng', 'Gói thành viên đã tạm dừng'],
    activeStatus: ['Đang hoạt động', 'Ngày thanh toán tiếp theo'],
    cancelledStatus: ['Đã hủy', 'Hết hạn'],
    pauseSuccess: ['đã tạm dừng thành công'],
    resumeSuccess: ['đã tiếp tục thành công']
  },

  datePatterns: [
    /\d{1,2}\/\d{1,2}\/\d{4}/g,
    /ngày \d{1,2} tháng \d{1,2} năm \d{4}/gi
  ],

  dateParser: (dateString) => {
    // Vietnamese date parsing logic
    const match = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      return new Date(match[3], match[2] - 1, match[1]);
    }
    return null;
  }
};
```

### 6.3 Language Pack Registry

```javascript
// src/selectors/languageRegistry.js

import { englishPack } from './languagePacks/en.js';
import { koreanPack } from './languagePacks/ko.js';
import { japanesePack } from './languagePacks/ja.js';
// ... other imports

class LanguageRegistry {
  constructor() {
    this.packs = new Map();
    this.defaultLanguage = 'en';
  }

  register(pack) {
    if (!this.validatePack(pack)) {
      throw new Error(`Invalid language pack: ${pack.code}`);
    }
    this.packs.set(pack.code, pack);
  }

  validatePack(pack) {
    const required = ['code', 'name', 'indicators', 'texts', 'datePatterns'];
    return required.every(key => pack[key] !== undefined);
  }

  get(code) {
    return this.packs.get(code) || this.packs.get(this.defaultLanguage);
  }

  detect(pageText) {
    for (const [code, pack] of this.packs) {
      for (const indicator of pack.indicators) {
        if (pageText.includes(indicator)) {
          return code;
        }
      }
    }
    return this.defaultLanguage;
  }

  getSupportedLanguages() {
    return Array.from(this.packs.keys());
  }
}

// Singleton instance
export const languageRegistry = new LanguageRegistry();

// Register default language packs
languageRegistry.register(englishPack);
languageRegistry.register(koreanPack);
languageRegistry.register(japanesePack);
```

---

## 7. Physical Input Integration

### 7.1 HumanMouseMover (Enhanced)

```javascript
/**
 * Human-like Mouse Movement with Bezier Curves
 * Enhanced version with scroll support
 */
export class HumanMouseMover {
  constructor(physicalInputService, coordinateTransformer) {
    this.input = physicalInputService;
    this.transformer = coordinateTransformer;
    this.lastPosition = { x: 0, y: 0 };

    // Movement configuration
    this.config = {
      minSteps: 20,
      maxSteps: 50,
      minDelay: 5,
      maxDelay: 15,
      overshootProbability: 0.3,
      overshootDistance: 5,
      jitterAmount: 2
    };
  }

  /**
   * Move to element and click with human-like behavior
   */
  async moveAndClick(targetX, targetY, options = {}) {
    const { button = 'left', doubleClick = false } = options;

    // Convert viewport coordinates to absolute screen coordinates
    const absCoords = await this.transformer.toAbsolute(targetX, targetY);

    // Generate Bezier path
    const path = this.generateBezierPath(
      this.lastPosition.x,
      this.lastPosition.y,
      absCoords.x,
      absCoords.y
    );

    // Execute movement
    for (const point of path) {
      await this.input.moveMouse(point.x, point.y);
      await this.randomDelay(this.config.minDelay, this.config.maxDelay);
    }

    // Small pause before clicking (human behavior)
    await this.randomDelay(50, 150);

    // Click
    if (doubleClick) {
      await this.input.doubleClick(button);
    } else {
      await this.input.click(button);
    }

    // Update last position
    this.lastPosition = absCoords;

    // Post-click pause
    await this.randomDelay(100, 300);
  }

  /**
   * Human-like scrolling
   */
  async scroll(deltaY, options = {}) {
    const { smooth = true, steps = 5 } = options;

    if (smooth) {
      // Smooth scrolling with variable speed
      const stepSize = deltaY / steps;
      for (let i = 0; i < steps; i++) {
        // Variable scroll amount per step
        const variance = this.gaussianRandom() * 10;
        await this.input.scroll(stepSize + variance);
        await this.randomDelay(30, 80);
      }
    } else {
      await this.input.scroll(deltaY);
    }

    // Scroll settling delay
    await this.randomDelay(200, 400);
  }

  /**
   * Generate Bezier curve path between two points
   */
  generateBezierPath(startX, startY, endX, endY) {
    const points = [];
    const steps = this.randomInt(this.config.minSteps, this.config.maxSteps);

    // Calculate control points for natural curve
    const distance = Math.hypot(endX - startX, endY - startY);
    const controlOffset = distance * 0.3;

    // Random control points
    const cp1x = startX + (endX - startX) * 0.25 + this.gaussianRandom() * controlOffset;
    const cp1y = startY + (endY - startY) * 0.25 + this.gaussianRandom() * controlOffset;
    const cp2x = startX + (endX - startX) * 0.75 + this.gaussianRandom() * controlOffset;
    const cp2y = startY + (endY - startY) * 0.75 + this.gaussianRandom() * controlOffset;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;

      // Cubic Bezier formula
      const x = Math.pow(1-t, 3) * startX +
                3 * Math.pow(1-t, 2) * t * cp1x +
                3 * (1-t) * Math.pow(t, 2) * cp2x +
                Math.pow(t, 3) * endX;
      const y = Math.pow(1-t, 3) * startY +
                3 * Math.pow(1-t, 2) * t * cp1y +
                3 * (1-t) * Math.pow(t, 2) * cp2y +
                Math.pow(t, 3) * endY;

      // Add jitter for naturalness
      const jitterX = this.gaussianRandom() * this.config.jitterAmount;
      const jitterY = this.gaussianRandom() * this.config.jitterAmount;

      points.push({
        x: Math.round(x + jitterX),
        y: Math.round(y + jitterY)
      });
    }

    // Possible overshoot
    if (Math.random() < this.config.overshootProbability) {
      const overshoot = this.config.overshootDistance;
      const angle = Math.atan2(endY - startY, endX - startX);
      points.push({
        x: Math.round(endX + Math.cos(angle) * overshoot),
        y: Math.round(endY + Math.sin(angle) * overshoot)
      });
      points.push({ x: Math.round(endX), y: Math.round(endY) });
    }

    return points;
  }

  gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  randomDelay(min, max) {
    const delay = this.randomInt(min, max);
    return new Promise(r => setTimeout(r, delay));
  }
}
```

### 7.2 Physical Keyboard Input

```javascript
/**
 * Human-like keyboard input
 */
async function typeWithHumanBehavior(physicalInput, text, options = {}) {
  const {
    minDelay = 50,
    maxDelay = 150,
    mistakeProbability = 0.02,
    pauseProbability = 0.05
  } = options;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Random typing mistake
    if (Math.random() < mistakeProbability) {
      const wrongChar = getRandomNearbyKey(char);
      await physicalInput.typeChar(wrongChar);
      await randomDelay(100, 200);
      await physicalInput.pressKey('backspace');
      await randomDelay(50, 100);
    }

    // Type the correct character
    await physicalInput.typeChar(char);

    // Variable delay between keystrokes
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    await new Promise(r => setTimeout(r, delay));

    // Occasional pause (thinking)
    if (Math.random() < pauseProbability) {
      await randomDelay(200, 500);
    }
  }
}

function getRandomNearbyKey(char) {
  const keyboard = {
    'a': ['s', 'q', 'z'],
    'b': ['v', 'n', 'g'],
    // ... full keyboard mapping
  };
  const nearby = keyboard[char.toLowerCase()];
  if (!nearby) return char;
  return nearby[Math.floor(Math.random() * nearby.length)];
}
```

---

## 8. Error Handling & Retry Strategy

### 8.1 Error Types

```javascript
export const ERROR_TYPES = {
  // Recoverable errors
  ELEMENT_NOT_FOUND: {
    code: 'ELEMENT_NOT_FOUND',
    recoverable: true,
    retryable: true,
    message: 'Target element not found on page'
  },
  TIMEOUT: {
    code: 'TIMEOUT',
    recoverable: true,
    retryable: true,
    message: 'Operation timed out'
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    recoverable: true,
    retryable: true,
    message: 'Network request failed'
  },

  // Business logic errors
  ALREADY_PAUSED: {
    code: 'ALREADY_PAUSED',
    recoverable: false,
    retryable: false,
    message: 'Subscription is already paused'
  },
  ALREADY_ACTIVE: {
    code: 'ALREADY_ACTIVE',
    recoverable: false,
    retryable: false,
    message: 'Subscription is already active'
  },
  NO_SUBSCRIPTION: {
    code: 'NO_SUBSCRIPTION',
    recoverable: false,
    retryable: false,
    message: 'No active subscription found'
  },

  // Critical errors
  BROWSER_CRASHED: {
    code: 'BROWSER_CRASHED',
    recoverable: false,
    retryable: false,
    message: 'Browser session crashed'
  },
  AUTH_FAILED: {
    code: 'AUTH_FAILED',
    recoverable: false,
    retryable: false,
    message: 'Authentication failed'
  }
};
```

### 8.2 Retry Configuration

```javascript
export const RETRY_CONFIG = {
  // Default retry settings
  default: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitterFactor: 0.2
  },

  // Step-specific overrides
  steps: {
    navigate: { maxRetries: 2, baseDelay: 2000 },
    find_element: { maxRetries: 3, baseDelay: 1000 },
    click: { maxRetries: 2, baseDelay: 500 },
    verify: { maxRetries: 3, baseDelay: 2000 }
  }
};

/**
 * Calculate retry delay with exponential backoff and jitter
 */
function calculateRetryDelay(attempt, config) {
  const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = config;

  // Exponential backoff
  let delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);

  // Cap at max delay
  delay = Math.min(delay, maxDelay);

  // Add jitter
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
  delay += jitter;

  return Math.round(delay);
}
```

### 8.3 Workflow Executor with Retry

```javascript
export class WorkflowExecutor {
  constructor(steps, config = {}) {
    this.steps = steps;
    this.config = { ...RETRY_CONFIG.default, ...config };
    this.state = {};
    this.results = [];
  }

  async execute(context) {
    for (const step of Object.values(this.steps)) {
      const result = await this.executeStep(step, context);
      this.results.push(result);

      if (!result.success && !step.optional) {
        return {
          success: false,
          failedStep: step.id,
          error: result.error,
          results: this.results
        };
      }
    }

    return {
      success: true,
      results: this.results,
      state: this.state
    };
  }

  async executeStep(step, context) {
    const stepConfig = RETRY_CONFIG.steps[step.id] || this.config;
    let lastError;

    for (let attempt = 1; attempt <= stepConfig.maxRetries; attempt++) {
      try {
        console.log(`[${step.id}] Attempt ${attempt}/${stepConfig.maxRetries}: ${step.name}`);

        const ctx = { ...context, state: this.state };
        const result = await Promise.race([
          step.action(ctx),
          this.timeout(step.timeout || 10000, step.id)
        ]);

        console.log(`[${step.id}] Success`);
        return { success: true, step: step.id, result };

      } catch (error) {
        lastError = error;
        console.error(`[${step.id}] Failed: ${error.message}`);

        // Check if error is retryable
        const errorType = this.classifyError(error);
        if (!errorType.retryable) {
          break;
        }

        // Calculate and wait retry delay
        if (attempt < stepConfig.maxRetries) {
          const delay = calculateRetryDelay(attempt, stepConfig);
          console.log(`[${step.id}] Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    return {
      success: false,
      step: step.id,
      error: lastError,
      errorType: this.classifyError(lastError)
    };
  }

  timeout(ms, stepId) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Step ${stepId} timed out after ${ms}ms`)), ms);
    });
  }

  classifyError(error) {
    const message = error.message || '';

    if (message.includes('ALREADY_PAUSED')) return ERROR_TYPES.ALREADY_PAUSED;
    if (message.includes('ALREADY_ACTIVE')) return ERROR_TYPES.ALREADY_ACTIVE;
    if (message.includes('not found')) return ERROR_TYPES.ELEMENT_NOT_FOUND;
    if (message.includes('timed out')) return ERROR_TYPES.TIMEOUT;
    if (message.includes('network') || message.includes('ECONNREFUSED')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    return { code: 'UNKNOWN', recoverable: false, retryable: false };
  }
}
```

---

## 9. Date Parsing Service

### 9.1 Multi-Language Date Parser

```javascript
/**
 * Subscription Date Parser Service
 * Extracts and parses dates from YouTube Premium pages
 */
export class SubscriptionDateParser {
  constructor(languageRegistry) {
    this.registry = languageRegistry;
  }

  /**
   * Extract date from page content
   */
  async extractDateFromPage(page, language = 'en') {
    const pack = this.registry.get(language);
    const pageText = await page.evaluate(() => document.body.innerText);

    // Try each date pattern
    for (const pattern of pack.datePatterns) {
      const matches = pageText.match(pattern);
      if (matches && matches.length > 0) {
        // Return the first match
        return this.parseDate(matches[0], language);
      }
    }

    return null;
  }

  /**
   * Parse date string based on language
   */
  parseDate(dateString, language = 'en') {
    const pack = this.registry.get(language);

    // Use language-specific parser if available
    if (pack.dateParser) {
      return pack.dateParser(dateString);
    }

    // Fallback to standard parsing
    return this.standardParse(dateString, language);
  }

  /**
   * Standard date parsing with language awareness
   */
  standardParse(dateString, language) {
    const parsers = {
      en: this.parseEnglishDate.bind(this),
      ko: this.parseKoreanDate.bind(this),
      ja: this.parseJapaneseDate.bind(this)
      // ... other languages
    };

    const parser = parsers[language] || parsers.en;
    return parser(dateString);
  }

  parseEnglishDate(dateString) {
    // Handle formats like "January 15, 2024", "Jan 15 2024", "01/15/2024"
    const months = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };

    // Try "Month Day, Year" format
    const mdyMatch = dateString.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (mdyMatch) {
      const month = months[mdyMatch[1].toLowerCase()];
      return new Date(parseInt(mdyMatch[3]), month, parseInt(mdyMatch[2]));
    }

    // Try "MM/DD/YYYY" format
    const slashMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
      let year = parseInt(slashMatch[3]);
      if (year < 100) year += 2000;
      return new Date(year, parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
    }

    // Try ISO format "YYYY-MM-DD"
    const isoMatch = dateString.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    return null;
  }

  parseKoreanDate(dateString) {
    // Handle formats like "2024년 1월 15일", "1월 15일", "2024.01.15"

    // Try "YYYY년 MM월 DD일" format
    const fullMatch = dateString.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (fullMatch) {
      return new Date(parseInt(fullMatch[1]), parseInt(fullMatch[2]) - 1, parseInt(fullMatch[3]));
    }

    // Try "MM월 DD일" format (assume current year)
    const shortMatch = dateString.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (shortMatch) {
      const year = new Date().getFullYear();
      return new Date(year, parseInt(shortMatch[1]) - 1, parseInt(shortMatch[2]));
    }

    // Try "YYYY.MM.DD" format
    const dotMatch = dateString.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (dotMatch) {
      return new Date(parseInt(dotMatch[1]), parseInt(dotMatch[2]) - 1, parseInt(dotMatch[3]));
    }

    return null;
  }

  parseJapaneseDate(dateString) {
    // Handle formats like "2024年1月15日", "1月15日"

    const fullMatch = dateString.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (fullMatch) {
      return new Date(parseInt(fullMatch[1]), parseInt(fullMatch[2]) - 1, parseInt(fullMatch[3]));
    }

    const shortMatch = dateString.match(/(\d{1,2})月(\d{1,2})日/);
    if (shortMatch) {
      const year = new Date().getFullYear();
      return new Date(year, parseInt(shortMatch[1]) - 1, parseInt(shortMatch[2]));
    }

    return null;
  }

  /**
   * Format date for display/storage
   */
  formatDate(date, format = 'ISO') {
    if (!date || !(date instanceof Date)) return null;

    const formats = {
      ISO: () => date.toISOString().split('T')[0],
      US: () => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
      KR: () => `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,
      JP: () => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    };

    return (formats[format] || formats.ISO)();
  }
}
```

---

## 10. Implementation Checklist

### Phase 1: Foundation (Week 1)

- [ ] Create `src/services/subscription/` directory structure
- [ ] Implement `pauseResumeSelectors.js` with English + Korean
- [ ] Create `LanguageRegistry` class
- [ ] Set up base `WorkflowExecutor` class
- [ ] Implement error types and retry configuration

### Phase 2: Core Workflows (Week 2)

- [ ] Implement `PauseWorkflow.js` with all steps
- [ ] Implement `ResumeWorkflow.js` with all steps
- [ ] Integrate with existing `HumanMouseMover`
- [ ] Add status detection logic
- [ ] Implement date extraction/parsing

### Phase 3: Integration (Week 3)

- [ ] Create main `PauseResumeService.js` orchestrator
- [ ] Integrate with existing `GoogleLoginModule`
- [ ] Connect to repository for data persistence
- [ ] Add logging and monitoring
- [ ] Create CLI commands

### Phase 4: Testing & Refinement (Week 4)

- [ ] Test with English accounts
- [ ] Test with Korean accounts
- [ ] Add Japanese language pack
- [ ] Handle edge cases (already paused, no subscription, etc.)
- [ ] Performance optimization

### Phase 5: Additional Languages (Ongoing)

- [ ] German (de)
- [ ] French (fr)
- [ ] Spanish (es)
- [ ] Portuguese (pt)
- [ ] Vietnamese (vi)
- [ ] Thai (th)
- [ ] Indonesian (id)

---

## Appendix A: Coordinate Transformation Reference

```javascript
/**
 * Transform viewport coordinates to absolute screen coordinates
 * Required for physical mouse input (nut-js)
 *
 * Formula:
 *   absoluteX = windowX + viewportOffsetX + elementX
 *   absoluteY = windowY + viewportOffsetY + elementY
 */
async function transformCoordinates(page, viewportX, viewportY) {
  // Get browser window position
  const windowBounds = await page.evaluate(() => ({
    x: window.screenX || window.screenLeft,
    y: window.screenY || window.screenTop
  }));

  // Get viewport offset (browser chrome)
  const viewportOffset = await page.evaluate(() => ({
    x: window.outerWidth - window.innerWidth,
    y: window.outerHeight - window.innerHeight
  }));

  // Calculate absolute position
  return {
    x: windowBounds.x + (viewportOffset.x / 2) + viewportX,
    y: windowBounds.y + viewportOffset.y + viewportY
  };
}
```

---

## Appendix B: Anti-Detection Best Practices

1. **Variable Timing**: Never use fixed delays. Always use ranges with randomization.

2. **Natural Mouse Movement**:
   - Use Bezier curves, not linear paths
   - Include overshoot and correction
   - Add micro-jitter during movement

3. **Human-like Scrolling**:
   - Variable scroll speeds
   - Momentum-based deceleration
   - Occasional pauses

4. **Keyboard Input**:
   - Variable keystroke timing
   - Occasional typos with correction
   - Natural pause patterns

5. **Session Behavior**:
   - Random intervals between actions
   - Occasional "distraction" behaviors
   - Realistic session durations

---

*Document prepared for GYN Project implementation*
*Reference: SF Project pause/resume workflows + CardSwitcher pattern*
