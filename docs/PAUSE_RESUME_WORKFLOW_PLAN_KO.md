# YouTube Premium 일시중지/재개 워크플로우 계획서

> 버전: 1.0.0
> 작성일: 2025-12-21
> 대상 프로젝트: GYN (ypsas-core)

---

## 목차

1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [일시중지 워크플로우](#3-일시중지-워크플로우)
4. [재개 워크플로우](#4-재개-워크플로우)
5. [셀렉터 정의](#5-셀렉터-정의)
6. [언어팩 구조](#6-언어팩-구조)
7. [물리적 입력 통합](#7-물리적-입력-통합)
8. [에러 처리 및 재시도 전략](#8-에러-처리-및-재시도-전략)
9. [날짜 파싱 서비스](#9-날짜-파싱-서비스)
10. [구현 체크리스트](#10-구현-체크리스트)

---

## 1. 개요

### 1.1 목적

YouTube Premium 구독의 **일시중지(Pause)**와 **재개(Resume)** 기능을 자동화하기 위한 구현 계획서입니다.

> **초보자를 위한 설명**
>
> 이 시스템은 YouTube Premium 구독을 자동으로 관리합니다:
> - **일시중지**: 결제를 일시적으로 멈춤 (구독료가 청구되지 않음)
> - **재개**: 일시중지된 구독을 다시 활성화
>
> 사람이 직접 마우스와 키보드로 하는 것처럼 동작하여, YouTube가 "이건 로봇이 아니구나"라고 인식하게 만드는 것이 핵심입니다.

사용 기술:
- **CDP (Chrome DevTools Protocol)**: 웹페이지의 요소를 찾고 정보를 읽는 데 사용
- **물리적 마우스/키보드 입력**: nut-js 라이브러리로 실제 사람처럼 클릭
- **인간 행동 시뮬레이션**: 자동화 탐지를 우회하기 위한 자연스러운 동작

### 1.2 핵심 요구사항

| 요구사항 | 구현 방식 | 초보자 설명 |
|---------|----------|------------|
| 요소 탐지 | CDP `Runtime.evaluate`, `DOM.querySelector` | 웹페이지에서 버튼, 텍스트 등을 찾음 |
| 마우스 이동 | 베지어 곡선 + 가우시안 랜덤화 | 직선이 아닌 자연스러운 곡선으로 이동 |
| 키보드 입력 | 물리적 키 입력 + 가변 딜레이 | 타자 속도가 일정하지 않고 자연스럽게 |
| 스크롤 | 물리적 스크롤 + 모멘텀 시뮬레이션 | 급정거 없이 부드럽게 멈추는 스크롤 |
| 다국어 지원 | 영어 기본 + 한국어 + 확장 가능한 언어팩 | 여러 나라의 YouTube 페이지 지원 |
| 탐지 방지 | 랜덤 딜레이, 자연스러운 경로, isTrusted 이벤트 | "사람처럼" 보이게 하는 다양한 기법들 |

> **isTrusted가 뭔가요?**
>
> 브라우저는 클릭 이벤트가 발생할 때 "이게 진짜 사람의 클릭인가?"를 판단합니다.
> - `isTrusted = true`: 실제 마우스/키보드에서 발생한 이벤트
> - `isTrusted = false`: 코드로 만든 가짜 이벤트
>
> YouTube 같은 사이트는 `isTrusted = false`인 이벤트를 의심합니다.
> 그래서 우리는 **물리적 입력**을 사용하여 `isTrusted = true`를 얻습니다.

### 1.3 참조 구현

기존 `CardSwitcher.js` 패턴을 기반으로 합니다:
- 8단계 워크플로우 구조
- `HumanMouseMover` 클래스로 자연스러운 마우스 이동
- 단계별 재시도 설정
- 물리적 입력을 위한 좌표 변환

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램

> **초보자를 위한 설명**
>
> 아래 그림은 시스템의 구조를 보여줍니다. 화살표는 "이 컴포넌트가 저 컴포넌트를 사용한다"는 의미입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                    PauseResumeService                        │
│                   (일시중지/재개 서비스)                       │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │ PauseWorkflow   │  │ ResumeWorkflow  │                   │
│  │ (일시중지 흐름)  │  │ (재개 흐름)      │                   │
│  └────────┬────────┘  └────────┬────────┘                   │
│           │                    │                             │
│           ▼                    ▼                             │
│  ┌─────────────────────────────────────────────────┐        │
│  │              WorkflowExecutor                    │        │
│  │              (워크플로우 실행기)                  │        │
│  │  - 단계 관리 (Step management)                   │        │
│  │  - 재시도 로직 (Retry logic)                     │        │
│  │  - 상태 저장 (State persistence)                 │        │
│  └────────────────────────┬────────────────────────┘        │
└───────────────────────────┼─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ ElementFinder │  │HumanMouseMover│  │PhysicalInput  │
│ (요소 찾기)    │  │(인간형 마우스) │  │Service        │
│ CDP 기반      │  │베지어+랜덤    │  │(물리적 입력)   │
└───────────────┘  └───────────────┘  └───────────────┘
        │                   │                   │
        │                   ▼                   │
        │          ┌───────────────┐           │
        │          │ Coordinate    │           │
        │          │ Transformer   │           │
        │          │ (좌표 변환기)  │           │
        │          └───────────────┘           │
        │                   │                   │
        └───────────────────┴───────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ pauseResumeSelectors  │
                │ (다국어 셀렉터)        │
                └───────────────────────┘
```

> **각 컴포넌트 역할**
>
> | 컴포넌트 | 역할 | 비유 |
> |---------|-----|-----|
> | PauseResumeService | 전체 작업을 총괄하는 지휘자 | 오케스트라 지휘자 |
> | WorkflowExecutor | 단계별로 작업을 실행하고 실패 시 재시도 | 작업 감독관 |
> | ElementFinder | 웹페이지에서 버튼, 텍스트 등을 찾음 | 탐정 |
> | HumanMouseMover | 마우스를 자연스러운 곡선으로 이동 | 손 |
> | CoordinateTransformer | "화면의 이 위치"를 "윈도우의 이 위치"로 변환 | GPS 네비게이션 |
> | pauseResumeSelectors | 각 언어별 버튼 텍스트 정의 | 사전 |

### 2.2 파일 구조

```
src/
├── services/
│   └── subscription/                      # 구독 관련 서비스
│       ├── PauseResumeService.js          # 메인 조율자 (전체 흐름 관리)
│       ├── PauseWorkflow.js               # 일시중지 전용 단계들
│       ├── ResumeWorkflow.js              # 재개 전용 단계들
│       └── SubscriptionDateParser.js      # 날짜 추출 및 파싱
├── selectors/
│   └── pauseResumeSelectors.js            # 다국어 셀렉터 (버튼 텍스트 등)
└── utils/
    └── HumanMouseMover.js                 # (기존 파일, 공유 사용)
```

---

## 3. 일시중지 워크플로우

### 3.1 워크플로우 개요

> **초보자를 위한 설명**
>
> "일시중지"는 YouTube Premium 구독료 결제를 잠시 멈추는 기능입니다.
> 아래는 그 과정을 12단계로 나눈 것입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                  일시중지 구독 워크플로우                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: 멤버십 페이지로 이동                                 │
│     └── URL: youtube.com/paid_memberships                   │
│     └── 설명: 구독 관리 페이지를 엽니다                       │
│                                                              │
│  Step 2: 언어 감지                                           │
│     └── 페이지 내용을 분석해서 어떤 언어인지 파악              │
│     └── 예: "Membership" → 영어, "멤버십" → 한국어            │
│                                                              │
│  Step 3: "멤버십 관리" 버튼 찾기                              │
│     └── CDP로 페이지에서 해당 텍스트를 가진 버튼 탐색          │
│                                                              │
│  Step 4: "멤버십 관리" 클릭                                   │
│     └── 물리적 마우스 클릭 (베지어 곡선으로 이동)              │
│                                                              │
│  Step 5: 구독 패널 대기                                       │
│     └── 패널이 열리고 애니메이션이 끝날 때까지 대기            │
│                                                              │
│  Step 6: "비활성화" 또는 "일시중지" 버튼 찾기                  │
│     └── 언어에 맞는 텍스트로 버튼 탐색                        │
│                                                              │
│  Step 7: 비활성화/일시중지 버튼 클릭                          │
│     └── 물리적 클릭                                          │
│                                                              │
│  Step 8: 일시중지 사유 선택 (나타나면)                        │
│     └── "너무 비싸서" 등의 사유 선택                          │
│                                                              │
│  Step 9: "결제 일시중지" 또는 "대신 일시중지" 버튼 찾기        │
│     └── 최종 확인 버튼 탐색                                   │
│                                                              │
│  Step 10: 일시중지 확인 클릭                                  │
│     └── 물리적 클릭 + 결과 확인                               │
│                                                              │
│  Step 11: 일시중지 성공 확인                                  │
│     └── "일시중지됨" 상태 또는 확인 메시지 체크               │
│                                                              │
│  Step 12: 일시중지 종료일 추출                                │
│     └── 확인 화면에서 날짜 파싱                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 단계별 정의 (코드)

> **초보자를 위한 설명**
>
> 아래 코드는 각 단계(Step)를 정의합니다.
> - `id`: 단계 식별자
> - `name`: 단계 이름 (로그에 표시)
> - `timeout`: 이 단계가 최대 몇 ms(밀리초) 안에 완료되어야 하는지
> - `retries`: 실패 시 몇 번까지 재시도할지
> - `action`: 실제로 수행할 동작 (함수)

```javascript
const PAUSE_WORKFLOW_STEPS = {
  // ============================================
  // Step 1: 멤버십 페이지로 이동
  // ============================================
  NAVIGATE: {
    id: 'navigate',
    name: '멤버십 페이지로 이동',
    timeout: 15000,  // 15초 (네트워크가 느릴 수 있으므로 넉넉하게)
    retries: 2,      // 실패 시 2번까지 재시도
    action: async (ctx) => {
      // ctx.page는 Puppeteer의 Page 객체
      await ctx.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',  // 네트워크 요청이 거의 없을 때까지 대기
        timeout: 15000
      });
      // 설명: 브라우저에서 해당 URL을 열고, 페이지가 완전히 로드될 때까지 기다립니다.
    }
  },

  // ============================================
  // Step 2: 페이지 언어 감지
  // ============================================
  DETECT_LANGUAGE: {
    id: 'detect_language',
    name: '페이지 언어 감지',
    timeout: 5000,   // 5초면 충분
    retries: 1,
    action: async (ctx) => {
      // 페이지 내용을 분석해서 언어 코드 반환 (예: 'en', 'ko')
      const language = await detectPageLanguage(ctx.page);
      ctx.state.language = language;  // 상태에 저장해서 이후 단계에서 사용
      return { language };
      // 설명: "Membership"이 있으면 영어, "멤버십"이 있으면 한국어로 판단
    }
  },

  // ============================================
  // Step 3: "멤버십 관리" 버튼 찾기
  // ============================================
  FIND_MANAGE_BUTTON: {
    id: 'find_manage_button',
    name: '멤버십 관리 버튼 찾기',
    timeout: 10000,
    retries: 3,      // 요소를 못 찾을 수 있으므로 3번 재시도
    action: async (ctx) => {
      // 현재 언어에 맞는 셀렉터 가져오기
      const selectors = getSelectors(ctx.state.language);

      // 텍스트로 요소 찾기
      const element = await findElementByText(
        ctx.page,
        selectors.MANAGE_MEMBERSHIP_TEXTS,  // ['Manage membership', 'Manage', ...]
        selectors.MANAGE_MEMBERSHIP_SELECTORS  // 'button, [role="button"], ...'
      );

      ctx.state.manageButton = element;  // 찾은 요소 저장
      return { found: !!element };
      // 설명: 페이지에서 "멤버십 관리"라는 텍스트를 가진 버튼을 찾습니다.
    }
  },

  // ============================================
  // Step 4: "멤버십 관리" 클릭
  // ============================================
  CLICK_MANAGE: {
    id: 'click_manage',
    name: '멤버십 관리 클릭',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      // 버튼의 중앙 좌표 계산
      const coords = await getElementCenter(ctx.page, ctx.state.manageButton);

      // 인간처럼 마우스 이동 후 클릭
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);

      // 800~1500ms 랜덤 대기 (사람은 클릭 후 바로 다음 동작을 안 함)
      await randomDelay(800, 1500);
      // 설명: 버튼 위치로 마우스를 곡선으로 이동시킨 뒤 클릭합니다.
    }
  },

  // ============================================
  // Step 5: 구독 패널 대기
  // ============================================
  WAIT_PANEL: {
    id: 'wait_panel',
    name: '구독 패널 대기',
    timeout: 8000,
    retries: 2,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // 패널이 화면에 나타날 때까지 대기
      await ctx.page.waitForSelector(selectors.SUBSCRIPTION_PANEL, {
        visible: true,  // 실제로 보이는 상태여야 함
        timeout: 8000
      });

      // 패널 애니메이션이 끝날 때까지 추가 대기
      await randomDelay(500, 1000);
      // 설명: "멤버십 관리"를 클릭하면 패널이 슬라이드로 나타납니다.
      //       그 애니메이션이 끝날 때까지 기다립니다.
    }
  },

  // ============================================
  // Step 6: "비활성화/일시중지" 버튼 찾기
  // ============================================
  FIND_DEACTIVATE: {
    id: 'find_deactivate',
    name: '비활성화/일시중지 버튼 찾기',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // "Deactivate", "Cancel", "비활성화" 등의 텍스트로 버튼 찾기
      const element = await findElementByText(
        ctx.page,
        selectors.DEACTIVATE_TEXTS,
        selectors.BUTTON_SELECTORS
      );

      ctx.state.deactivateButton = element;
      return { found: !!element };
    }
  },

  // ============================================
  // Step 7: 비활성화 버튼 클릭
  // ============================================
  CLICK_DEACTIVATE: {
    id: 'click_deactivate',
    name: '비활성화 버튼 클릭',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.deactivateButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(1000, 2000);  // 다음 화면 로드 대기
    }
  },

  // ============================================
  // Step 8: 일시중지 사유 선택 (선택적)
  // ============================================
  HANDLE_REASON: {
    id: 'handle_reason',
    name: '일시중지 사유 선택',
    timeout: 10000,
    retries: 2,
    optional: true,  // ★ 이 단계는 화면에 안 나타날 수도 있음
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // 사유 선택 라디오 버튼 찾기
      const reasonRadio = await findElementByText(
        ctx.page,
        selectors.PAUSE_REASON_TEXTS,  // ['너무 비싸요', 'Too expensive', ...]
        'input[type="radio"], [role="radio"]'
      );

      if (reasonRadio) {
        const coords = await getElementCenter(ctx.page, reasonRadio);
        await ctx.mouseMover.moveAndClick(coords.x, coords.y);
        await randomDelay(500, 1000);
      }

      return { reasonSelected: !!reasonRadio };
      // 설명: YouTube가 "왜 일시중지하나요?"라고 물어볼 때가 있습니다.
      //       그때 아무 사유나 선택합니다.
    }
  },

  // ============================================
  // Step 9: 최종 일시중지 확인 버튼 찾기
  // ============================================
  FIND_PAUSE_CONFIRM: {
    id: 'find_pause_confirm',
    name: '일시중지 확인 버튼 찾기',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // 우선순위: "대신 일시중지" > "결제 일시중지" > "일시중지"
      const element = await findFirstElement(ctx.page, [
        { texts: selectors.PAUSE_INSTEAD_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.PAUSE_PAYMENTS_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.PAUSE_TEXTS, selector: selectors.BUTTON_SELECTORS }
      ]);

      ctx.state.pauseConfirmButton = element;
      return { found: !!element };
      // 설명: YouTube는 "정말 취소할 건가요? 대신 일시중지 해보세요!"라고 제안할 때가 있습니다.
      //       그 "대신 일시중지" 버튼을 우선적으로 찾습니다.
    }
  },

  // ============================================
  // Step 10: 일시중지 확인 클릭
  // ============================================
  CLICK_PAUSE_CONFIRM: {
    id: 'click_pause_confirm',
    name: '일시중지 확인 클릭',
    timeout: 5000,
    retries: 2,
    action: async (ctx) => {
      const coords = await getElementCenter(ctx.page, ctx.state.pauseConfirmButton);
      await ctx.mouseMover.moveAndClick(coords.x, coords.y);
      await randomDelay(2000, 3000);  // 처리 완료까지 넉넉히 대기
    }
  },

  // ============================================
  // Step 11: 일시중지 성공 확인
  // ============================================
  VERIFY_SUCCESS: {
    id: 'verify_success',
    name: '일시중지 성공 확인',
    timeout: 15000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // 성공 지표 확인: "일시중지됨", "재개" 버튼 등
      const success = await checkForElements(ctx.page, [
        selectors.PAUSED_STATUS_TEXTS,    // ['Paused', '일시중지됨', ...]
        selectors.PAUSE_SUCCESS_TEXTS,    // ['successfully paused', ...]
        selectors.RESUME_BUTTON_TEXTS     // "재개" 버튼이 보이면 = 일시중지 성공
      ]);

      if (!success) {
        throw new Error('일시중지 확인 실패 - 성공 지표를 찾을 수 없음');
      }

      return { verified: true };
      // 설명: 일시중지가 정말 완료되었는지 확인합니다.
      //       "재개" 버튼이 나타나면 일시중지가 성공한 것입니다.
    }
  },

  // ============================================
  // Step 12: 일시중지 종료일 추출
  // ============================================
  EXTRACT_DATE: {
    id: 'extract_date',
    name: '일시중지 종료일 추출',
    timeout: 5000,
    retries: 1,
    optional: true,  // 날짜를 못 찾아도 전체 작업은 성공으로 처리
    action: async (ctx) => {
      const dateText = await extractDateFromPage(ctx.page, ctx.state.language);
      ctx.state.pauseEndDate = dateText;
      return { date: dateText };
      // 설명: "2025년 2월 15일까지 일시중지됩니다" 같은 문구에서 날짜를 추출합니다.
    }
  }
};
```

### 3.3 구독 상태 감지

> **초보자를 위한 설명**
>
> 작업을 시작하기 전에 현재 구독 상태를 먼저 확인합니다.
> 이미 일시중지된 상태에서 또 일시중지하려고 하면 에러가 나기 때문입니다.

```javascript
// 구독 상태 종류
const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',           // 정상 활성 구독
  PAUSED: 'paused',           // 현재 일시중지 상태
  CANCELLED: 'cancelled',     // 취소됨/만료됨
  UNKNOWN: 'unknown'          // 알 수 없음
};

/**
 * 현재 구독 상태 감지
 * @param {Page} page - Puppeteer Page 객체
 * @param {string} language - 현재 페이지 언어
 * @returns {string} 구독 상태
 */
async function detectSubscriptionStatus(page, language) {
  const selectors = getSelectors(language);

  // "일시중지됨" 텍스트가 있는지 확인
  const pausedIndicator = await findElementByText(
    page,
    selectors.PAUSED_STATUS_TEXTS,  // ['Paused', '일시중지됨', ...]
    '*'  // 모든 요소에서 검색
  );
  if (pausedIndicator) return SUBSCRIPTION_STATUS.PAUSED;

  // "활성" 텍스트가 있는지 확인
  const activeIndicator = await findElementByText(
    page,
    selectors.ACTIVE_STATUS_TEXTS,
    '*'
  );
  if (activeIndicator) return SUBSCRIPTION_STATUS.ACTIVE;

  // "취소됨" 텍스트가 있는지 확인
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

## 4. 재개 워크플로우

### 4.1 워크플로우 개요

> **초보자를 위한 설명**
>
> "재개"는 일시중지된 구독을 다시 활성화하는 기능입니다.
> 일시중지 워크플로우와 비슷하지만, "재개" 버튼을 클릭합니다.

```
┌─────────────────────────────────────────────────────────────┐
│                  재개 구독 워크플로우                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: 멤버십 페이지로 이동                                 │
│     └── URL: youtube.com/paid_memberships                   │
│                                                              │
│  Step 2: 언어 감지                                           │
│     └── 페이지 내용 분석                                     │
│                                                              │
│  Step 3: 일시중지 상태 확인 ★                                │
│     └── 구독이 현재 일시중지 상태인지 확인                    │
│     └── 이미 활성 상태면 에러 (재개할 필요 없음)              │
│                                                              │
│  Step 4: "멤버십 관리" 버튼 찾기                              │
│     └── CDP로 버튼 탐색                                      │
│                                                              │
│  Step 5: "멤버십 관리" 클릭                                   │
│     └── 물리적 마우스 클릭                                   │
│                                                              │
│  Step 6: 구독 패널 대기                                       │
│     └── 패널 애니메이션 완료 대기                            │
│                                                              │
│  Step 7: "재개" 또는 "복원" 버튼 찾기                         │
│     └── 언어별 텍스트로 탐색                                 │
│                                                              │
│  Step 8: 재개 버튼 클릭                                       │
│     └── 물리적 클릭                                          │
│                                                              │
│  Step 9: 확인 대화상자 처리 (있으면)                          │
│     └── 재개 확인 동작                                       │
│                                                              │
│  Step 10: 재개 성공 확인                                      │
│     └── "활성" 상태 또는 성공 메시지 체크                    │
│                                                              │
│  Step 11: 다음 결제일 추출                                    │
│     └── 확인 화면에서 날짜 파싱                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 단계별 정의 (코드)

```javascript
const RESUME_WORKFLOW_STEPS = {
  // Step 1, 2: 일시중지와 동일하므로 생략...

  // ============================================
  // Step 3: 일시중지 상태 확인 ★ 재개 전용
  // ============================================
  VERIFY_PAUSED: {
    id: 'verify_paused',
    name: '구독이 일시중지 상태인지 확인',
    timeout: 10000,
    retries: 2,
    action: async (ctx) => {
      const status = await detectSubscriptionStatus(ctx.page, ctx.state.language);

      // 이미 활성 상태면 재개할 필요 없음
      if (status === SUBSCRIPTION_STATUS.ACTIVE) {
        throw new Error('ALREADY_ACTIVE: 구독이 이미 활성 상태입니다');
      }

      // 일시중지 상태가 아니면 에러
      if (status !== SUBSCRIPTION_STATUS.PAUSED) {
        throw new Error(`INVALID_STATUS: 예상 상태는 paused, 실제 상태는 ${status}`);
      }

      return { status };
      // 설명: 재개하려면 먼저 일시중지 상태여야 합니다.
      //       이미 활성 상태면 작업을 중단합니다.
    }
  },

  // ============================================
  // Step 7: "재개" 버튼 찾기
  // ============================================
  FIND_RESUME_BUTTON: {
    id: 'find_resume',
    name: '재개 버튼 찾기',
    timeout: 10000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // "Resume", "Restore", "Reactivate" 등의 텍스트로 찾기
      const element = await findFirstElement(ctx.page, [
        { texts: selectors.RESUME_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.RESTORE_TEXTS, selector: selectors.BUTTON_SELECTORS },
        { texts: selectors.REACTIVATE_TEXTS, selector: selectors.BUTTON_SELECTORS }
      ]);

      ctx.state.resumeButton = element;
      return { found: !!element };
      // 설명: 여러 가지 표현 중 하나라도 있으면 재개 버튼으로 인식합니다.
    }
  },

  // ============================================
  // Step 9: 확인 대화상자 처리
  // ============================================
  HANDLE_CONFIRM_DIALOG: {
    id: 'handle_confirm',
    name: '확인 대화상자 처리',
    timeout: 10000,
    retries: 2,
    optional: true,  // 대화상자가 안 나타날 수도 있음
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // "확인", "네, 재개합니다" 같은 버튼 찾기
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

  // ============================================
  // Step 10: 재개 성공 확인
  // ============================================
  VERIFY_SUCCESS: {
    id: 'verify_success',
    name: '재개 성공 확인',
    timeout: 15000,
    retries: 3,
    action: async (ctx) => {
      const selectors = getSelectors(ctx.state.language);

      // 성공 지표 확인
      const success = await checkForElements(ctx.page, [
        selectors.ACTIVE_STATUS_TEXTS,    // ['Active', '활성', ...]
        selectors.RESUME_SUCCESS_TEXTS,   // ['successfully resumed', ...]
        selectors.DEACTIVATE_TEXTS        // "비활성화" 버튼이 보이면 = 재개 성공
      ]);

      if (!success) {
        throw new Error('재개 확인 실패 - 성공 지표를 찾을 수 없음');
      }

      return { verified: true };
      // 설명: 재개가 정말 완료되었는지 확인합니다.
      //       "비활성화" 버튼이 나타나면 재개가 성공한 것입니다.
    }
  },

  // ============================================
  // Step 11: 다음 결제일 추출
  // ============================================
  EXTRACT_BILLING_DATE: {
    id: 'extract_date',
    name: '다음 결제일 추출',
    timeout: 5000,
    retries: 1,
    optional: true,
    action: async (ctx) => {
      const dateText = await extractBillingDateFromPage(ctx.page, ctx.state.language);
      ctx.state.nextBillingDate = dateText;
      return { date: dateText };
      // 설명: "다음 결제일: 2025년 1월 15일" 같은 문구에서 날짜를 추출합니다.
    }
  }
};
```

---

## 5. 셀렉터 정의

### 5.1 pauseResumeSelectors.js 구조

> **초보자를 위한 설명**
>
> "셀렉터"란 웹페이지에서 특정 요소를 찾기 위한 규칙입니다.
>
> 예를 들어:
> - `button`: 모든 버튼을 찾아라
> - `button[class*="submit"]`: class에 "submit"이 포함된 버튼을 찾아라
>
> 문제는 YouTube가 여러 언어로 표시된다는 것입니다.
> 영어로는 "Manage membership", 한국어로는 "멤버십 관리"입니다.
> 그래서 각 언어별로 텍스트를 정의해둡니다.

```javascript
/**
 * YouTube Premium 일시중지/재개 셀렉터
 * 다국어 지원 (영어 기본)
 */

// 지원 언어 목록
export const SUPPORTED_LANGUAGES = ['en', 'ko', 'ja', 'de', 'fr', 'es', 'pt', 'vi', 'th', 'id'];

// 언어 감지용 키워드
// 페이지에 이 단어들이 있으면 해당 언어로 판단합니다
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

// 공통 CSS 셀렉터 (언어와 무관)
export const COMMON_SELECTORS = {
  // 멤버십 페이지 패널
  SUBSCRIPTION_PANEL: '[class*="subscription"], [class*="membership"], ytd-section-list-renderer',

  // 버튼류
  BUTTON_SELECTORS: 'button, [role="button"], a[href*="youtube"], tp-yt-paper-button, yt-button-renderer',

  // 멤버십 관리 전용
  MANAGE_MEMBERSHIP_SELECTORS: 'a[href*="paid_memberships"], button[aria-label*="Manage"], [class*="manage"]',

  // 상태 표시 영역
  STATUS_CONTAINER: '[class*="status"], [class*="badge"], [class*="label"]'
};

// 언어별 텍스트 패턴
export const TEXT_PATTERNS = {
  // ========================================
  // 영어 (English)
  // ========================================
  en: {
    // 네비게이션 & 관리
    MANAGE_MEMBERSHIP_TEXTS: ['Manage membership', 'Manage', 'Membership settings'],

    // 일시중지 흐름
    DEACTIVATE_TEXTS: ['Deactivate', 'Cancel membership', 'Cancel', 'Deactivate membership'],
    PAUSE_TEXTS: ['Pause', 'Pause membership', 'Pause payments'],
    PAUSE_INSTEAD_TEXTS: ['Pause instead', 'Pause payments instead', 'I\'d rather pause'],
    PAUSE_PAYMENTS_TEXTS: ['Pause payments', 'Pause my payments'],
    PAUSE_REASON_TEXTS: ['Too expensive', 'Cost', 'Don\'t use it enough', 'Technical issues'],

    // 재개 흐름
    RESUME_TEXTS: ['Resume', 'Resume membership', 'Resume payments'],
    RESTORE_TEXTS: ['Restore', 'Restore membership'],
    REACTIVATE_TEXTS: ['Reactivate', 'Reactivate membership'],
    CONFIRM_RESUME_TEXTS: ['Confirm', 'Yes, resume', 'Resume now'],

    // 상태 텍스트
    PAUSED_STATUS_TEXTS: ['Paused', 'Your membership is paused', 'Payments paused'],
    ACTIVE_STATUS_TEXTS: ['Active', 'Your membership is active', 'Next billing date'],
    CANCELLED_STATUS_TEXTS: ['Cancelled', 'Expired', 'No active membership'],

    // 성공 메시지
    PAUSE_SUCCESS_TEXTS: ['successfully paused', 'Membership paused', 'Paused until'],
    RESUME_SUCCESS_TEXTS: ['successfully resumed', 'Membership resumed', 'Welcome back'],

    // 날짜 패턴 (정규식)
    DATE_PATTERNS: [
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}/gi,  // January 15, 2024
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,  // 01/15/2024
      /\d{4}-\d{2}-\d{2}/g            // 2024-01-15 (ISO)
    ]
  },

  // ========================================
  // 한국어 (Korean)
  // ========================================
  ko: {
    // 네비게이션 & 관리
    MANAGE_MEMBERSHIP_TEXTS: ['멤버십 관리', '관리', '멤버십 설정'],

    // 일시중지 흐름
    DEACTIVATE_TEXTS: ['비활성화', '멤버십 취소', '취소', '구독 취소'],
    PAUSE_TEXTS: ['일시중지', '멤버십 일시중지', '결제 일시중지'],
    PAUSE_INSTEAD_TEXTS: ['일시중지로 변경', '대신 일시중지', '일시중지하기'],
    PAUSE_PAYMENTS_TEXTS: ['결제 일시중지', '결제를 일시중지'],
    PAUSE_REASON_TEXTS: ['너무 비싸요', '비용', '자주 사용하지 않음', '기술적 문제'],

    // 재개 흐름
    RESUME_TEXTS: ['재개', '멤버십 재개', '결제 재개', '다시 시작'],
    RESTORE_TEXTS: ['복원', '멤버십 복원'],
    REACTIVATE_TEXTS: ['재활성화', '멤버십 재활성화'],
    CONFIRM_RESUME_TEXTS: ['확인', '네, 재개합니다', '지금 재개'],

    // 상태 텍스트
    PAUSED_STATUS_TEXTS: ['일시중지됨', '멤버십이 일시중지됨', '결제 일시중지됨', '일시정지'],
    ACTIVE_STATUS_TEXTS: ['활성', '멤버십 활성', '다음 결제일'],
    CANCELLED_STATUS_TEXTS: ['취소됨', '만료됨', '활성 멤버십 없음'],

    // 성공 메시지
    PAUSE_SUCCESS_TEXTS: ['일시중지되었습니다', '멤버십 일시중지됨', '까지 일시중지'],
    RESUME_SUCCESS_TEXTS: ['재개되었습니다', '멤버십 재개됨', '다시 오신 것을 환영'],

    // 날짜 패턴
    DATE_PATTERNS: [
      /\d{4}년 \d{1,2}월 \d{1,2}일/g,  // 2024년 1월 15일
      /\d{1,2}월 \d{1,2}일/g,           // 1월 15일
      /\d{4}\.\d{1,2}\.\d{1,2}/g        // 2024.01.15
    ]
  },

  // ========================================
  // 일본어 (Japanese)
  // ========================================
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
      /\d{4}年\d{1,2}月\d{1,2}日/g,  // 2024年1月15日
      /\d{1,2}月\d{1,2}日/g           // 1月15日
    ]
  }

  // 다른 언어도 같은 패턴으로 추가...
};

/**
 * 특정 언어의 셀렉터 가져오기
 * @param {string} language - 언어 코드 (en, ko, ja, ...)
 * @returns {object} 해당 언어의 셀렉터와 텍스트 패턴
 */
export function getSelectors(language = 'en') {
  // 지원하지 않는 언어면 영어로 대체
  const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  return {
    ...COMMON_SELECTORS,      // 공통 CSS 셀렉터
    ...TEXT_PATTERNS[lang],   // 해당 언어 텍스트
    language: lang
  };
}

/**
 * 페이지 언어 감지
 * @param {Page} page - Puppeteer Page 객체
 * @returns {string} 감지된 언어 코드
 */
export async function detectPageLanguage(page) {
  // 페이지의 모든 텍스트 가져오기
  const pageText = await page.evaluate(() => document.body.innerText);

  // 각 언어의 키워드가 있는지 확인
  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
    for (const indicator of indicators) {
      if (pageText.includes(indicator)) {
        return lang;  // 첫 번째로 매칭되는 언어 반환
      }
    }
  }

  return 'en';  // 기본값: 영어
}

/**
 * 텍스트로 요소 찾기
 * @param {Page} page - Puppeteer Page 객체
 * @param {string[]} textPatterns - 찾을 텍스트 배열
 * @param {string} selectorBase - CSS 셀렉터
 * @returns {ElementHandle|null} 찾은 요소 또는 null
 */
export async function findElementByText(page, textPatterns, selectorBase) {
  for (const text of textPatterns) {
    try {
      // 브라우저 컨텍스트에서 실행
      const element = await page.evaluateHandle((text, selector) => {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // 요소의 텍스트에 우리가 찾는 텍스트가 포함되어 있는지 확인
          if (el.innerText?.includes(text) || el.textContent?.includes(text)) {
            return el;
          }
        }
        return null;
      }, text, selectorBase);

      if (element.asElement()) {
        return element;  // 찾았으면 반환
      }
    } catch (e) {
      continue;  // 에러 나면 다음 텍스트 시도
    }
  }
  return null;  // 못 찾음
}
```

---

## 6. 언어팩 구조

### 6.1 언어팩 인터페이스

> **초보자를 위한 설명**
>
> 새로운 언어를 추가하려면 정해진 형식을 따라야 합니다.
> 아래는 "언어팩이 반드시 가져야 할 속성들"을 정의한 것입니다.

```javascript
/**
 * 언어팩 인터페이스 (필수 구조)
 * 모든 언어팩은 이 구조를 따라야 합니다
 */
export const LanguagePackInterface = {
  // === 메타데이터 ===
  code: 'string',           // ISO 639-1 코드 (en, ko, ja 등)
  name: 'string',           // 표시 이름 (영어)
  nativeName: 'string',     // 원어 이름 (English, 한국어, 日本語)

  // === 언어 감지용 키워드 ===
  indicators: ['string'],   // 이 단어가 페이지에 있으면 이 언어로 판단

  // === 텍스트 패턴 ===
  texts: {
    // 관리
    manageMembership: ['string'],   // "멤버십 관리" 등

    // 일시중지 흐름
    deactivate: ['string'],         // "비활성화" 등
    pause: ['string'],              // "일시중지" 등
    pauseInstead: ['string'],       // "대신 일시중지" 등
    pausePayments: ['string'],      // "결제 일시중지" 등
    pauseReasons: ['string'],       // 사유 선택 옵션들

    // 재개 흐름
    resume: ['string'],             // "재개" 등
    restore: ['string'],            // "복원" 등
    reactivate: ['string'],         // "재활성화" 등
    confirmResume: ['string'],      // "확인" 등

    // 상태
    pausedStatus: ['string'],       // "일시중지됨" 등
    activeStatus: ['string'],       // "활성" 등
    cancelledStatus: ['string'],    // "취소됨" 등

    // 성공 메시지
    pauseSuccess: ['string'],       // "일시중지되었습니다" 등
    resumeSuccess: ['string']       // "재개되었습니다" 등
  },

  // === 날짜 파싱 ===
  datePatterns: [RegExp],           // 날짜를 찾는 정규식들
  dateParser: Function              // 날짜 문자열 → Date 객체 변환 함수
};
```

### 6.2 새 언어팩 추가 예시 (베트남어)

```javascript
// 파일: src/selectors/languagePacks/vi.js

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
    /\d{1,2}\/\d{1,2}\/\d{4}/g,                        // 15/01/2024
    /ngày \d{1,2} tháng \d{1,2} năm \d{4}/gi          // ngày 15 tháng 1 năm 2024
  ],

  dateParser: (dateString) => {
    // 베트남어 날짜 파싱 로직
    const match = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      // new Date(년, 월-1, 일) - 월은 0부터 시작
      return new Date(match[3], match[2] - 1, match[1]);
    }
    return null;
  }
};
```

### 6.3 언어팩 레지스트리

> **초보자를 위한 설명**
>
> "레지스트리"는 모든 언어팩을 모아두는 저장소입니다.
> 새 언어를 추가하면 여기에 등록합니다.

```javascript
// 파일: src/selectors/languageRegistry.js

import { englishPack } from './languagePacks/en.js';
import { koreanPack } from './languagePacks/ko.js';
import { japanesePack } from './languagePacks/ja.js';
// ... 다른 언어 import

class LanguageRegistry {
  constructor() {
    this.packs = new Map();           // 언어팩 저장소
    this.defaultLanguage = 'en';      // 기본 언어
  }

  /**
   * 언어팩 등록
   */
  register(pack) {
    if (!this.validatePack(pack)) {
      throw new Error(`잘못된 언어팩: ${pack.code}`);
    }
    this.packs.set(pack.code, pack);
  }

  /**
   * 언어팩 유효성 검사
   */
  validatePack(pack) {
    const required = ['code', 'name', 'indicators', 'texts', 'datePatterns'];
    return required.every(key => pack[key] !== undefined);
  }

  /**
   * 언어팩 가져오기
   */
  get(code) {
    return this.packs.get(code) || this.packs.get(this.defaultLanguage);
  }

  /**
   * 페이지 텍스트로 언어 감지
   */
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

  /**
   * 지원 언어 목록
   */
  getSupportedLanguages() {
    return Array.from(this.packs.keys());
  }
}

// 싱글톤 인스턴스 (전체 앱에서 하나만 사용)
export const languageRegistry = new LanguageRegistry();

// 기본 언어팩 등록
languageRegistry.register(englishPack);
languageRegistry.register(koreanPack);
languageRegistry.register(japanesePack);
```

---

## 7. 물리적 입력 통합

### 7.1 HumanMouseMover (향상된 버전)

> **초보자를 위한 설명**
>
> **베지어 곡선**이란?
>
> 사람이 마우스를 움직일 때는 직선으로 움직이지 않습니다.
> 살짝 곡선을 그리며 이동합니다.
>
> 베지어 곡선은 이런 자연스러운 곡선을 수학적으로 만드는 방법입니다.
>
> ```
> 직선 이동 (로봇):     곡선 이동 (사람):
>   A──────B            A
>                        ╲
>                         ╲
>                          ╰──B
> ```

```javascript
/**
 * 인간처럼 마우스를 움직이는 클래스
 * 베지어 곡선 + 랜덤 떨림 사용
 */
export class HumanMouseMover {
  constructor(physicalInputService, coordinateTransformer) {
    this.input = physicalInputService;       // 실제 마우스 제어
    this.transformer = coordinateTransformer; // 좌표 변환
    this.lastPosition = { x: 0, y: 0 };      // 마지막 마우스 위치

    // 움직임 설정
    this.config = {
      minSteps: 20,              // 최소 이동 단계 수
      maxSteps: 50,              // 최대 이동 단계 수
      minDelay: 5,               // 단계 사이 최소 대기 (ms)
      maxDelay: 15,              // 단계 사이 최대 대기 (ms)
      overshootProbability: 0.3, // 목표 지점을 살짝 지나칠 확률 (30%)
      overshootDistance: 5,      // 지나치는 거리 (픽셀)
      jitterAmount: 2            // 미세 떨림 정도 (픽셀)
    };
  }

  /**
   * 목표 지점으로 이동 후 클릭
   * @param {number} targetX - 뷰포트 X 좌표
   * @param {number} targetY - 뷰포트 Y 좌표
   * @param {object} options - 옵션 (button, doubleClick)
   */
  async moveAndClick(targetX, targetY, options = {}) {
    const { button = 'left', doubleClick = false } = options;

    // 1. 뷰포트 좌표 → 절대 화면 좌표 변환
    //    (브라우저 안의 좌표 → 모니터 전체 기준 좌표)
    const absCoords = await this.transformer.toAbsolute(targetX, targetY);

    // 2. 현재 위치에서 목표 위치까지 베지어 곡선 경로 생성
    const path = this.generateBezierPath(
      this.lastPosition.x,
      this.lastPosition.y,
      absCoords.x,
      absCoords.y
    );

    // 3. 경로를 따라 마우스 이동
    for (const point of path) {
      await this.input.moveMouse(point.x, point.y);
      await this.randomDelay(this.config.minDelay, this.config.maxDelay);
    }

    // 4. 클릭 전 잠시 대기 (사람은 바로 클릭 안 함)
    await this.randomDelay(50, 150);

    // 5. 클릭
    if (doubleClick) {
      await this.input.doubleClick(button);
    } else {
      await this.input.click(button);
    }

    // 6. 마지막 위치 저장
    this.lastPosition = absCoords;

    // 7. 클릭 후 잠시 대기
    await this.randomDelay(100, 300);
  }

  /**
   * 인간처럼 스크롤
   * @param {number} deltaY - 스크롤 양 (양수: 아래로, 음수: 위로)
   */
  async scroll(deltaY, options = {}) {
    const { smooth = true, steps = 5 } = options;

    if (smooth) {
      // 부드러운 스크롤: 여러 번에 나눠서
      const stepSize = deltaY / steps;
      for (let i = 0; i < steps; i++) {
        // 매번 조금씩 다른 양으로 스크롤 (자연스러움)
        const variance = this.gaussianRandom() * 10;
        await this.input.scroll(stepSize + variance);
        await this.randomDelay(30, 80);
      }
    } else {
      await this.input.scroll(deltaY);
    }

    // 스크롤 후 안정화 대기
    await this.randomDelay(200, 400);
  }

  /**
   * 베지어 곡선 경로 생성
   *
   * 수학적 설명:
   * 3차 베지어 곡선은 4개의 점으로 정의됩니다:
   * - P0: 시작점
   * - P1: 제어점1 (곡선이 이 방향으로 휘어짐)
   * - P2: 제어점2
   * - P3: 끝점
   *
   * t가 0→1로 변할 때 곡선 위의 점:
   * B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
   */
  generateBezierPath(startX, startY, endX, endY) {
    const points = [];
    const steps = this.randomInt(this.config.minSteps, this.config.maxSteps);

    // 제어점 계산을 위한 거리
    const distance = Math.hypot(endX - startX, endY - startY);
    const controlOffset = distance * 0.3;  // 거리의 30%만큼 휘어짐

    // 랜덤 제어점 (곡선의 형태 결정)
    const cp1x = startX + (endX - startX) * 0.25 + this.gaussianRandom() * controlOffset;
    const cp1y = startY + (endY - startY) * 0.25 + this.gaussianRandom() * controlOffset;
    const cp2x = startX + (endX - startX) * 0.75 + this.gaussianRandom() * controlOffset;
    const cp2y = startY + (endY - startY) * 0.75 + this.gaussianRandom() * controlOffset;

    // t를 0→1로 변화시키며 곡선 위의 점 계산
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;

      // 3차 베지어 공식
      const x = Math.pow(1-t, 3) * startX +
                3 * Math.pow(1-t, 2) * t * cp1x +
                3 * (1-t) * Math.pow(t, 2) * cp2x +
                Math.pow(t, 3) * endX;
      const y = Math.pow(1-t, 3) * startY +
                3 * Math.pow(1-t, 2) * t * cp1y +
                3 * (1-t) * Math.pow(t, 2) * cp2y +
                Math.pow(t, 3) * endY;

      // 미세 떨림 추가 (손이 완벽히 안정적이지 않음)
      const jitterX = this.gaussianRandom() * this.config.jitterAmount;
      const jitterY = this.gaussianRandom() * this.config.jitterAmount;

      points.push({
        x: Math.round(x + jitterX),
        y: Math.round(y + jitterY)
      });
    }

    // 30% 확률로 목표 지점을 살짝 지나쳤다가 돌아오기
    if (Math.random() < this.config.overshootProbability) {
      const overshoot = this.config.overshootDistance;
      const angle = Math.atan2(endY - startY, endX - startX);

      // 지나친 지점
      points.push({
        x: Math.round(endX + Math.cos(angle) * overshoot),
        y: Math.round(endY + Math.sin(angle) * overshoot)
      });
      // 다시 목표 지점으로
      points.push({ x: Math.round(endX), y: Math.round(endY) });
    }

    return points;
  }

  /**
   * 가우시안(정규분포) 랜덤 숫자 생성
   * Box-Muller 변환 사용
   *
   * 왜 가우시안?
   * - Math.random()은 균등 분포 (모든 값이 같은 확률)
   * - 가우시안은 평균 근처 값이 더 자주 나옴 (자연스러움)
   */
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

### 7.2 물리적 키보드 입력

> **초보자를 위한 설명**
>
> 사람이 타자를 칠 때:
> - 일정한 속도로 치지 않음 (빠르다가 느리다가)
> - 가끔 오타를 냄 (바로 지우고 다시 침)
> - 가끔 생각하느라 멈춤

```javascript
/**
 * 인간처럼 키보드 입력
 * @param {PhysicalInputService} physicalInput - 물리적 입력 서비스
 * @param {string} text - 입력할 텍스트
 * @param {object} options - 옵션
 */
async function typeWithHumanBehavior(physicalInput, text, options = {}) {
  const {
    minDelay = 50,           // 키 입력 사이 최소 대기 (ms)
    maxDelay = 150,          // 키 입력 사이 최대 대기 (ms)
    mistakeProbability = 0.02,  // 오타 확률 (2%)
    pauseProbability = 0.05     // 생각 멈춤 확률 (5%)
  } = options;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // 2% 확률로 오타 내기
    if (Math.random() < mistakeProbability) {
      // 근처 키 잘못 누르기
      const wrongChar = getRandomNearbyKey(char);
      await physicalInput.typeChar(wrongChar);
      await randomDelay(100, 200);

      // 오타 지우기
      await physicalInput.pressKey('backspace');
      await randomDelay(50, 100);
    }

    // 정확한 문자 입력
    await physicalInput.typeChar(char);

    // 가변 딜레이 (일정하지 않은 타이핑 속도)
    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    await new Promise(r => setTimeout(r, delay));

    // 5% 확률로 잠시 멈춤 (생각하는 척)
    if (Math.random() < pauseProbability) {
      await randomDelay(200, 500);
    }
  }
}

/**
 * 키보드에서 인접한 키 반환 (오타 시뮬레이션용)
 */
function getRandomNearbyKey(char) {
  // 실제 키보드 배열 기준 인접 키
  const keyboard = {
    'a': ['s', 'q', 'z', 'w'],
    'b': ['v', 'n', 'g', 'h'],
    'c': ['x', 'v', 'd', 'f'],
    'd': ['s', 'f', 'e', 'r', 'x', 'c'],
    'e': ['w', 'r', 'd', 's'],
    'f': ['d', 'g', 'r', 't', 'c', 'v'],
    // ... 나머지 키도 매핑
  };

  const nearby = keyboard[char.toLowerCase()];
  if (!nearby) return char;  // 매핑 없으면 원래 문자
  return nearby[Math.floor(Math.random() * nearby.length)];
}
```

---

## 8. 에러 처리 및 재시도 전략

### 8.1 에러 유형

> **초보자를 위한 설명**
>
> 자동화 과정에서 다양한 에러가 발생할 수 있습니다.
> 에러 유형에 따라 처리 방법이 다릅니다:
> - **복구 가능**: 잠시 기다렸다가 다시 시도
> - **복구 불가**: 작업 중단, 수동 확인 필요

```javascript
export const ERROR_TYPES = {
  // ========================================
  // 복구 가능한 에러 (재시도하면 될 수 있음)
  // ========================================
  ELEMENT_NOT_FOUND: {
    code: 'ELEMENT_NOT_FOUND',
    recoverable: true,
    retryable: true,
    message: '페이지에서 대상 요소를 찾을 수 없음'
    // 예: 페이지 로딩이 느려서 버튼이 아직 안 나타남
    //     → 잠시 기다렸다가 다시 찾으면 됨
  },
  TIMEOUT: {
    code: 'TIMEOUT',
    recoverable: true,
    retryable: true,
    message: '작업 시간 초과'
    // 예: 네트워크가 느림
    //     → 다시 시도하면 될 수 있음
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    recoverable: true,
    retryable: true,
    message: '네트워크 요청 실패'
  },

  // ========================================
  // 비즈니스 로직 에러 (재시도해도 안 됨)
  // ========================================
  ALREADY_PAUSED: {
    code: 'ALREADY_PAUSED',
    recoverable: false,
    retryable: false,
    message: '구독이 이미 일시중지 상태입니다'
    // 이미 일시중지 상태면 또 일시중지할 수 없음
    // → 작업 성공으로 처리하거나 건너뜀
  },
  ALREADY_ACTIVE: {
    code: 'ALREADY_ACTIVE',
    recoverable: false,
    retryable: false,
    message: '구독이 이미 활성 상태입니다'
  },
  NO_SUBSCRIPTION: {
    code: 'NO_SUBSCRIPTION',
    recoverable: false,
    retryable: false,
    message: '활성 구독을 찾을 수 없음'
    // 구독 자체가 없으면 어떤 작업도 불가
  },

  // ========================================
  // 치명적 에러 (즉시 중단)
  // ========================================
  BROWSER_CRASHED: {
    code: 'BROWSER_CRASHED',
    recoverable: false,
    retryable: false,
    message: '브라우저 세션 충돌'
  },
  AUTH_FAILED: {
    code: 'AUTH_FAILED',
    recoverable: false,
    retryable: false,
    message: '인증 실패'
    // 비밀번호가 틀리거나 계정이 잠김
  }
};
```

### 8.2 재시도 설정

> **초보자를 위한 설명**
>
> **지수 백오프 (Exponential Backoff)**란?
>
> 실패할 때마다 대기 시간을 2배씩 늘리는 전략입니다.
>
> 예: 1초 → 2초 → 4초 → 8초 ...
>
> 왜? 서버가 바쁘면 계속 요청하면 더 바빠짐.
> 대기 시간을 늘려서 서버에 부담을 줄임.
>
> **지터 (Jitter)**란?
>
> 여러 클라이언트가 동시에 재시도하면 또 서버가 바빠짐.
> 대기 시간에 랜덤값을 더해서 분산시킴.

```javascript
export const RETRY_CONFIG = {
  // 기본 재시도 설정
  default: {
    maxRetries: 3,           // 최대 3번 재시도
    baseDelay: 1000,         // 기본 대기: 1초
    maxDelay: 10000,         // 최대 대기: 10초
    backoffMultiplier: 2,    // 대기 시간 증가 배수
    jitterFactor: 0.2        // 지터 범위 (±20%)
  },

  // 단계별 커스텀 설정
  steps: {
    navigate: { maxRetries: 2, baseDelay: 2000 },    // 페이지 로드는 2초씩
    find_element: { maxRetries: 3, baseDelay: 1000 }, // 요소 찾기는 3번 시도
    click: { maxRetries: 2, baseDelay: 500 },         // 클릭은 빠르게
    verify: { maxRetries: 3, baseDelay: 2000 }        // 검증은 넉넉히
  }
};

/**
 * 재시도 대기 시간 계산 (지수 백오프 + 지터)
 * @param {number} attempt - 현재 시도 횟수 (1부터 시작)
 * @param {object} config - 재시도 설정
 * @returns {number} 대기 시간 (ms)
 */
function calculateRetryDelay(attempt, config) {
  const { baseDelay, maxDelay, backoffMultiplier, jitterFactor } = config;

  // 지수 백오프: 1초 → 2초 → 4초 → 8초 ...
  let delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);

  // 최대 대기 시간 제한
  delay = Math.min(delay, maxDelay);

  // 지터 추가 (±20%)
  const jitter = delay * jitterFactor * (Math.random() * 2 - 1);
  delay += jitter;

  return Math.round(delay);
}

// 예시:
// 1번째 시도 실패 → calculateRetryDelay(1) ≈ 1000ms (±200ms)
// 2번째 시도 실패 → calculateRetryDelay(2) ≈ 2000ms (±400ms)
// 3번째 시도 실패 → calculateRetryDelay(3) ≈ 4000ms (±800ms)
```

### 8.3 워크플로우 실행기

```javascript
/**
 * 워크플로우 실행기
 * 단계들을 순서대로 실행하고, 실패 시 재시도
 */
export class WorkflowExecutor {
  constructor(steps, config = {}) {
    this.steps = steps;
    this.config = { ...RETRY_CONFIG.default, ...config };
    this.state = {};       // 단계 간 공유 상태
    this.results = [];     // 각 단계 결과
  }

  /**
   * 전체 워크플로우 실행
   * @param {object} context - 실행 컨텍스트 (page, mouseMover 등)
   * @returns {object} 실행 결과
   */
  async execute(context) {
    for (const step of Object.values(this.steps)) {
      const result = await this.executeStep(step, context);
      this.results.push(result);

      // 필수 단계가 실패하면 전체 중단
      if (!result.success && !step.optional) {
        return {
          success: false,
          failedStep: step.id,
          error: result.error,
          results: this.results
        };
      }
    }

    // 모든 단계 성공
    return {
      success: true,
      results: this.results,
      state: this.state
    };
  }

  /**
   * 단일 단계 실행 (재시도 포함)
   */
  async executeStep(step, context) {
    const stepConfig = RETRY_CONFIG.steps[step.id] || this.config;
    let lastError;

    for (let attempt = 1; attempt <= stepConfig.maxRetries; attempt++) {
      try {
        console.log(`[${step.id}] 시도 ${attempt}/${stepConfig.maxRetries}: ${step.name}`);

        // 단계 실행 (타임아웃 포함)
        const ctx = { ...context, state: this.state };
        const result = await Promise.race([
          step.action(ctx),
          this.timeout(step.timeout || 10000, step.id)
        ]);

        console.log(`[${step.id}] 성공`);
        return { success: true, step: step.id, result };

      } catch (error) {
        lastError = error;
        console.error(`[${step.id}] 실패: ${error.message}`);

        // 재시도 불가능한 에러면 즉시 중단
        const errorType = this.classifyError(error);
        if (!errorType.retryable) {
          break;
        }

        // 다음 재시도 전 대기
        if (attempt < stepConfig.maxRetries) {
          const delay = calculateRetryDelay(attempt, stepConfig);
          console.log(`[${step.id}] ${delay}ms 후 재시도...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // 모든 재시도 실패
    return {
      success: false,
      step: step.id,
      error: lastError,
      errorType: this.classifyError(lastError)
    };
  }

  /**
   * 타임아웃 프로미스
   */
  timeout(ms, stepId) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`단계 ${stepId}이(가) ${ms}ms 후 시간 초과`)), ms);
    });
  }

  /**
   * 에러 분류
   */
  classifyError(error) {
    const message = error.message || '';

    if (message.includes('ALREADY_PAUSED')) return ERROR_TYPES.ALREADY_PAUSED;
    if (message.includes('ALREADY_ACTIVE')) return ERROR_TYPES.ALREADY_ACTIVE;
    if (message.includes('not found') || message.includes('찾을 수 없')) return ERROR_TYPES.ELEMENT_NOT_FOUND;
    if (message.includes('timed out') || message.includes('시간 초과')) return ERROR_TYPES.TIMEOUT;
    if (message.includes('network') || message.includes('ECONNREFUSED')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }

    // 알 수 없는 에러 (재시도 안 함)
    return { code: 'UNKNOWN', recoverable: false, retryable: false };
  }
}
```

---

## 9. 날짜 파싱 서비스

### 9.1 다국어 날짜 파서

> **초보자를 위한 설명**
>
> YouTube는 언어에 따라 날짜를 다르게 표시합니다:
> - 영어: "January 15, 2024"
> - 한국어: "2024년 1월 15일"
> - 일본어: "2024年1月15日"
>
> 이 서비스는 각 언어의 날짜 형식을 인식하고,
> JavaScript의 Date 객체로 변환합니다.

```javascript
/**
 * 구독 날짜 파싱 서비스
 * YouTube Premium 페이지에서 날짜를 추출하고 파싱
 */
export class SubscriptionDateParser {
  constructor(languageRegistry) {
    this.registry = languageRegistry;
  }

  /**
   * 페이지에서 날짜 추출
   * @param {Page} page - Puppeteer Page 객체
   * @param {string} language - 페이지 언어
   * @returns {Date|null} 파싱된 날짜 또는 null
   */
  async extractDateFromPage(page, language = 'en') {
    const pack = this.registry.get(language);
    const pageText = await page.evaluate(() => document.body.innerText);

    // 각 날짜 패턴으로 검색
    for (const pattern of pack.datePatterns) {
      const matches = pageText.match(pattern);
      if (matches && matches.length > 0) {
        // 첫 번째 매칭된 날짜 반환
        return this.parseDate(matches[0], language);
      }
    }

    return null;
  }

  /**
   * 날짜 문자열 파싱
   * @param {string} dateString - 날짜 문자열
   * @param {string} language - 언어 코드
   * @returns {Date|null} 파싱된 날짜
   */
  parseDate(dateString, language = 'en') {
    const pack = this.registry.get(language);

    // 언어팩에 전용 파서가 있으면 사용
    if (pack.dateParser) {
      return pack.dateParser(dateString);
    }

    // 없으면 표준 파서 사용
    return this.standardParse(dateString, language);
  }

  /**
   * 표준 날짜 파싱 (언어별)
   */
  standardParse(dateString, language) {
    const parsers = {
      en: this.parseEnglishDate.bind(this),
      ko: this.parseKoreanDate.bind(this),
      ja: this.parseJapaneseDate.bind(this)
    };

    const parser = parsers[language] || parsers.en;
    return parser(dateString);
  }

  /**
   * 영어 날짜 파싱
   * 지원 형식: "January 15, 2024", "Jan 15 2024", "01/15/2024", "2024-01-15"
   */
  parseEnglishDate(dateString) {
    // 월 이름 → 숫자 매핑 (0부터 시작)
    const months = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };

    // "January 15, 2024" 형식
    const mdyMatch = dateString.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (mdyMatch) {
      const month = months[mdyMatch[1].toLowerCase()];
      return new Date(parseInt(mdyMatch[3]), month, parseInt(mdyMatch[2]));
    }

    // "01/15/2024" 형식
    const slashMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
      let year = parseInt(slashMatch[3]);
      if (year < 100) year += 2000;  // 24 → 2024
      return new Date(year, parseInt(slashMatch[1]) - 1, parseInt(slashMatch[2]));
    }

    // "2024-01-15" ISO 형식
    const isoMatch = dateString.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    return null;
  }

  /**
   * 한국어 날짜 파싱
   * 지원 형식: "2024년 1월 15일", "1월 15일", "2024.01.15"
   */
  parseKoreanDate(dateString) {
    // "2024년 1월 15일" 형식
    const fullMatch = dateString.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (fullMatch) {
      return new Date(parseInt(fullMatch[1]), parseInt(fullMatch[2]) - 1, parseInt(fullMatch[3]));
    }

    // "1월 15일" 형식 (올해로 가정)
    const shortMatch = dateString.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (shortMatch) {
      const year = new Date().getFullYear();
      return new Date(year, parseInt(shortMatch[1]) - 1, parseInt(shortMatch[2]));
    }

    // "2024.01.15" 형식
    const dotMatch = dateString.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (dotMatch) {
      return new Date(parseInt(dotMatch[1]), parseInt(dotMatch[2]) - 1, parseInt(dotMatch[3]));
    }

    return null;
  }

  /**
   * 일본어 날짜 파싱
   * 지원 형식: "2024年1月15日", "1月15日"
   */
  parseJapaneseDate(dateString) {
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
   * 날짜 포맷팅 (표시/저장용)
   * @param {Date} date - Date 객체
   * @param {string} format - 출력 형식
   * @returns {string|null} 포맷된 날짜 문자열
   */
  formatDate(date, format = 'ISO') {
    if (!date || !(date instanceof Date)) return null;

    const formats = {
      ISO: () => date.toISOString().split('T')[0],  // 2024-01-15
      US: () => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,  // 1/15/2024
      KR: () => `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`,  // 2024년 1월 15일
      JP: () => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`    // 2024年1月15日
    };

    return (formats[format] || formats.ISO)();
  }
}
```

---

## 10. 구현 체크리스트

> **초보자를 위한 설명**
>
> 아래는 실제 구현을 위한 단계별 할 일 목록입니다.
> 체크박스를 하나씩 완료해 나가면 됩니다.

### Phase 1: 기반 작업

- [ ] `src/services/subscription/` 디렉토리 구조 생성
- [ ] `pauseResumeSelectors.js` 구현 (영어 + 한국어)
- [ ] `LanguageRegistry` 클래스 생성
- [ ] `WorkflowExecutor` 기본 클래스 설정
- [ ] 에러 유형 및 재시도 설정 구현

### Phase 2: 핵심 워크플로우

- [ ] `PauseWorkflow.js` 모든 단계 구현
- [ ] `ResumeWorkflow.js` 모든 단계 구현
- [ ] 기존 `HumanMouseMover`와 통합
- [ ] 구독 상태 감지 로직 추가
- [ ] 날짜 추출/파싱 구현

### Phase 3: 통합

- [ ] 메인 `PauseResumeService.js` 오케스트레이터 생성
- [ ] 기존 `GoogleLoginModule`과 연동
- [ ] Repository 연결 (데이터 저장)
- [ ] 로깅 및 모니터링 추가
- [ ] CLI 명령어 생성

### Phase 4: 테스트 및 개선

- [ ] 영어 계정 테스트
- [ ] 한국어 계정 테스트
- [ ] 일본어 언어팩 추가
- [ ] 엣지 케이스 처리 (이미 일시중지됨, 구독 없음 등)
- [ ] 성능 최적화

### Phase 5: 추가 언어 (점진적 확장)

- [ ] 독일어 (de)
- [ ] 프랑스어 (fr)
- [ ] 스페인어 (es)
- [ ] 포르투갈어 (pt)
- [ ] 베트남어 (vi)
- [ ] 태국어 (th)
- [ ] 인도네시아어 (id)

---

## 부록 A: 좌표 변환 참조

> **초보자를 위한 설명**
>
> **왜 좌표 변환이 필요한가?**
>
> 1. Puppeteer가 알려주는 좌표: "브라우저 안에서 (100, 200) 위치"
> 2. nut-js가 필요한 좌표: "모니터 전체에서 (500, 600) 위치"
>
> 브라우저 창이 모니터의 (400, 400)에 있고,
> 브라우저 상단바(주소창 등)가 80px라면:
>
> 절대 좌표 = 창 위치 + 상단바 + 뷰포트 좌표
>           = (400, 400) + (0, 80) + (100, 200)
>           = (500, 680)

```javascript
/**
 * 뷰포트 좌표 → 절대 화면 좌표 변환
 * 물리적 마우스 입력(nut-js)에 필요
 *
 * 공식:
 *   absoluteX = windowX + viewportOffsetX + elementX
 *   absoluteY = windowY + viewportOffsetY + elementY
 */
async function transformCoordinates(page, viewportX, viewportY) {
  // 브라우저 창의 화면상 위치
  const windowBounds = await page.evaluate(() => ({
    x: window.screenX || window.screenLeft,
    y: window.screenY || window.screenTop
  }));

  // 뷰포트 오프셋 (브라우저 UI 영역)
  // outerWidth/Height = 전체 창 크기
  // innerWidth/Height = 웹페이지 영역 크기
  // 차이 = 브라우저 UI (주소창, 탭바 등)
  const viewportOffset = await page.evaluate(() => ({
    x: window.outerWidth - window.innerWidth,    // 좌우 테두리
    y: window.outerHeight - window.innerHeight   // 상단바 (주소창, 탭 등)
  }));

  // 절대 좌표 계산
  return {
    x: windowBounds.x + (viewportOffset.x / 2) + viewportX,  // 좌우 테두리는 반반
    y: windowBounds.y + viewportOffset.y + viewportY         // 상단바는 전체
  };
}
```

---

## 부록 B: 탐지 방지 모범 사례

> **초보자를 위한 설명**
>
> YouTube 같은 사이트는 봇을 탐지하려고 합니다.
> 아래는 "사람처럼 보이게" 하는 핵심 기법들입니다.

### 1. 가변 타이밍
```javascript
// ❌ 나쁜 예: 고정 딜레이 (로봇처럼 보임)
await sleep(1000);

// ✅ 좋은 예: 랜덤 딜레이
await randomDelay(800, 1500);  // 800~1500ms 사이 랜덤
```

### 2. 자연스러운 마우스 이동
```javascript
// ❌ 나쁜 예: 직선 이동
moveTo(targetX, targetY);

// ✅ 좋은 예: 베지어 곡선 + 오버슈팅 + 미세 떨림
moveWithBezierCurve(targetX, targetY, {
  overshoot: true,
  jitter: 2
});
```

### 3. 인간적인 스크롤
```javascript
// ❌ 나쁜 예: 즉시 스크롤
window.scrollTo(0, 500);

// ✅ 좋은 예: 점진적 + 가변 속도
for (let i = 0; i < 5; i++) {
  scroll(100 + random(-20, 20));  // 매번 다른 양
  await sleep(random(30, 80));    // 매번 다른 속도
}
```

### 4. 키보드 입력
```javascript
// ❌ 나쁜 예: 즉시 입력
element.value = 'hello';

// ✅ 좋은 예: 한 글자씩 + 가변 속도 + 가끔 오타
for (const char of 'hello') {
  if (random() < 0.02) { // 2% 확률로 오타
    typeKey(nearbyKey(char));
    await sleep(random(100, 200));
    pressBackspace();
  }
  typeKey(char);
  await sleep(random(50, 150));
}
```

### 5. 세션 행동
- 액션 사이에 랜덤 간격
- 가끔 "멍때리기" (아무것도 안 함)
- 현실적인 세션 지속 시간

---

*문서 작성: GYN Project 구현용*
*참조: SF Project 일시중지/재개 워크플로우 + CardSwitcher 패턴*
