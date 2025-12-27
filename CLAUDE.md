# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

**AdsPower YouTube Premium Automation** - Clean Architecture 기반 브라우저 자동화 시스템. AdsPower API + Puppeteer로 YouTube Premium 구독 관리. Awilix DI 컨테이너, 다국어 지원.

**Tech Stack**: Node.js 16+, Awilix (DI), Puppeteer, Google Sheets API, chalk/inquirer (CLI)

## Core Commands

```bash
# Quick Start (Mock 모드 - Google Sheets 불필요)
set USE_MOCK_REPOSITORY=true && npm start

# 실제 데이터 사용
npm start                         # CLI 메인 메뉴
npm run start:improved            # 개선된 CLI

# 주요 워크플로우
npm run pause                     # 구독 일시정지
npm run resume                    # 구독 재개
npm run family:check              # 가족 요금제 확인
npm run backup-card:change        # 백업 카드 변경

# 테스트 및 검증
npm test                          # AdsPower 연결 테스트
npm run verify:dates              # 다국어 날짜 파싱 검증
node test-connection.js           # 단일 프로필 연결 테스트

# 배치 작업
npm run batch:visual              # 시각적 배치 컨트롤러
npm run batch:improved:pause      # 개선된 배치 일시정지
npm run batch:improved:resume     # 개선된 배치 재개
```

## Critical Implementation Rules

### 1. AdsPower 페이지네이션 (필수)
API는 페이지당 최대 100개만 반환. 반드시 `getAllProfiles()` 사용:
```javascript
// ❌ 100개만 가져옴
const { profiles } = await adapter.getProfiles({ pageSize: 100 });

// ✅ 모든 프로필 (자동 페이지네이션)
const { profiles, total } = await adapter.getAllProfiles();
```
**위치**: `src/infrastructure/adapters/AdsPowerAdapter.js:137-219`

### 2. 브라우저 세션 관리 (try-finally 필수)
```javascript
let browser = null;
try {
  const existing = await adapter.getActiveBrowser(profileId);
  if (existing) await adapter.closeBrowser(profileId);
  ({ browser } = await adapter.openBrowser(profileId));
  await doWork(browser);
} finally {
  if (browser) await adapter.closeBrowser(profileId);  // 반드시 정리
}
```

### 3. DI 컨테이너 등록 (새 서비스 추가시 필수)
모든 서비스는 `src/container.js`에 등록:
```javascript
container.register({
  myService: asClass(MyService).singleton(),
  myAdapter: asClass(MyAdapter).scoped()
});
```

### 4. Repository 지연 초기화 패턴
Repository는 `createLazyRepository()` 래퍼로 첫 호출시 자동 초기화됨. 직접 초기화 불필요.

### 5. 재시도 전 브라우저 정리 (v2.3)
"이미 일시중지 상태" 재확인 시 Stale WebSocket 연결 방지:
```javascript
// ✅ 명시적 브라우저 종료 후 재시도
await adsPowerAdapter.closeBrowser(task.adsPowerId);
await new Promise(resolve => setTimeout(resolve, 5000));
```

### 6. 다국어 버튼 텍스트 동기화 (중요)
`multilanguage.js`에 정의된 버튼 텍스트가 UseCase의 `buttonPriority` 배열에도 포함되어야 함:
```javascript
// src/infrastructure/config/multilanguage.js 에 정의된 텍스트가
// EnhancedPauseSubscriptionUseCase.js의 confirmPauseInPopup() 내
// buttonPriority 배열에도 추가되어야 팝업 확인이 작동함
```
**실제 사례**: 러시아어 버튼이 `multilanguage.js`에는 있었지만 `buttonPriority` 배열에 없어서 팝업 확인 실패

### 7. 서비스 간 의존성 주입 순서
`src/container.js`에서 순환 의존성 주의:
- `config` → `logger` → `adapters` → `repositories` → `services` → `usecases`
- `asFunction(() => container.resolve('...'))`로 지연 해결 가능

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Presentation Layer                                 │
│  └─ src/presentation/cli/EnterpriseCLI.js          │
├─────────────────────────────────────────────────────┤
│  Application Layer (UseCases - 30+개)              │
│  └─ src/application/usecases/                      │
│     ├─ EnhancedPauseSubscriptionUseCase.js         │
│     ├─ EnhancedResumeSubscriptionUseCase.js        │
│     ├─ ScheduledSubscriptionWorkerUseCase.js  # 통합워커 │
│     ├─ LogCleanupUseCase.js                   # 로그정리 │
│     ├─ BatchPauseOptimizedUseCase.js               │
│     └─ FamilyPlanCheckUseCase.js                   │
├─────────────────────────────────────────────────────┤
│  Domain Layer                                       │
│  └─ src/domain/ (entities/, services/)             │
├─────────────────────────────────────────────────────┤
│  Infrastructure Layer                               │
│  ├─ adapters/                                      │
│  │   ├─ AdsPowerAdapter.js    ⚠️ getAllProfiles() │
│  │   └─ BrowserController.js                       │
│  ├─ repositories/                                  │
│  │   ├─ EnhancedGoogleSheetsRepository.js         │
│  │   ├─ PauseSheetRepository.js   # 통합워커 탭   │
│  │   └─ MockGoogleSheetsRepository.js             │
│  └─ config/                                        │
│      ├─ multilanguage.js  # 다국어 UI 텍스트      │
│      └─ languages.js                               │
├─────────────────────────────────────────────────────┤
│  Services (횡단 관심사)                             │
│  └─ src/services/                                  │
│      ├─ AuthenticationService.js                   │
│      ├─ ImprovedAuthenticationService.js  # CDP 클릭 │
│      ├─ NavigationService.js                       │
│      ├─ LanguageService.js                         │
│      ├─ ButtonInteractionService.js                │
│      ├─ PopupService.js                            │
│      ├─ EnhancedDateParsingService.js  # 다국어 날짜 │
│      ├─ WorkerLockService.js      # 분산 잠금     │
│      └─ TimeFilterService.js      # 시간 필터     │
└─────────────────────────────────────────────────────┘
```

## Key Files

| 파일 | 역할 |
|------|------|
| `index.js` | 메인 진입점 |
| `src/container.js` | Awilix DI 컨테이너 (⚠️ 새 서비스 등록 필수) |
| `src/config/workerDefaults.js` | 통합워커 기본값 (단일 소스) |
| `src/presentation/cli/EnterpriseCLI.js` | 대화형 CLI 메뉴 |
| `src/infrastructure/adapters/AdsPowerAdapter.js` | 브라우저 제어 핵심 |
| `src/infrastructure/adapters/HumanLikeMouseHelper.js` | 베지어 곡선 마우스 이동 |
| `src/infrastructure/adapters/CDPClickHelper.js` | CDP 네이티브 클릭 |
| `src/infrastructure/config/multilanguage.js` | 다국어 UI 텍스트 |
| `src/services/EnhancedDateParsingService.js` | 다국어 날짜 파싱 |

## Environment Variables (.env)

```bash
# 필수
ADSPOWER_API_URL=auto            # 자동 포트 감지 (50325, 50326, 50327)
GOOGLE_SHEETS_ID=<sheets_id>
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json

# Mock 모드 (Google Sheets 없이 개발)
USE_MOCK_REPOSITORY=true

# 워크플로우 설정
BATCH_SIZE=5                     # 동시 처리 프로필 수
NAVIGATION_TIMEOUT=30000         # 30초
LOGIN_MODE=improved              # improved/legacy/minimal

# 선택사항
DEBUG_MODE=false
ANTI_CAPTCHA_API_KEY=            # 이미지 CAPTCHA 자동 해결
```

## Development Workflows

### 새 UseCase 추가 (3단계)
1. `src/application/usecases/MyUseCase.js` 생성
2. `src/container.js`에 등록 (inject 설정 포함)
3. `src/presentation/cli/EnterpriseCLI.js`에 메뉴 추가

### 다국어 지원 추가
1. `src/infrastructure/config/multilanguage.js` 업데이트
2. `src/services/EnhancedDateParsingService.js` monthMappings 추가
3. **UseCase의 buttonPriority 배열에도 추가** (중요!)
4. `npm run verify:dates` 실행하여 날짜 파싱 검증

### 서비스 의존성 주입 예시
```javascript
// src/container.js
myUseCase: asClass(MyUseCase)
  .inject(() => ({
    adsPowerAdapter: container.resolve('adsPowerAdapter'),
    sheetsRepository: container.resolve('enhancedSheetsRepository'),
    logger: container.resolve('logger')
  }))
```

## Google Sheets 시트 구조

| 시트명 | 용도 |
|--------|------|
| `애즈파워현황` | 전체 프로필 목록 (AdsPower ID 매핑) |
| `일시정지` | 일시정지 대상 |
| `재개` | 재개 대상 |
| `통합워커` | 상태 기반 자동 관리 (E열: 상태, I열: 시간, J열: 잠금, L열: 재시도) |
| `가족요금제` | 가족 요금제 확인 |
| `백업카드변경` | 결제 수단 변경 |

## 통합워커 시스템 (v2.0)

분산 PC에서 동시 작업 시 충돌 방지하는 시간 기반 자동 관리 시스템:

```
E열 상태: "일시중지" ↔ "결제중"
J열 잠금: "작업중:WORKER-PC1:14:35" (15분 초과 시 자동 해제)
L열 재시도: 실패 횟수 공유
```

**기본값 설정** (`src/config/workerDefaults.js`):
```javascript
{
  resumeMinutesBefore: 30,    // 결제재개: 결제 전 30분
  pauseMinutesAfter: 10,      // 일시중지: 결제 후 10분
  checkIntervalSeconds: 60,   // 체크 간격 60초
  maxRetryCount: 3,           // 최대 재시도 3회
  continuous: true,           // 지속 실행 모드
  debugMode: true,            // 디버그 모드
  humanLikeMotion: true       // 휴먼라이크 인터랙션
}
```

**관련 파일:**
- `WorkerLockService.js` - 분산 잠금 관리
- `TimeFilterService.js` - 결제 시간 기준 필터링
- `ScheduledSubscriptionWorkerUseCase.js` - 지속 실행 워커
- `src/config/workerDefaults.js` - 기본값 단일 소스

## 휴먼라이크 인터랙션 (v2.4)

봇 탐지 우회를 위한 자연스러운 마우스/클릭 동작:

| 모듈 | 파일 위치 | 핵심 기능 |
|------|-----------|-----------|
| HumanLikeMouseHelper | `src/infrastructure/adapters/` | 베지어 곡선, 손떨림, 가속/감속 |
| CDPClickHelper | `src/infrastructure/adapters/` | CDP 네이티브 입력 이벤트 |
| HumanLikeClickService | `src/services/` | 호버 + 딜레이 클릭 |
| AdvancedClickHelper | `src/infrastructure/adapters/` | 다중 클릭 전략 |

**활성화 방법**: `humanLikeMotion: true` (기본값)

**적용 서비스**:
- `ImprovedAuthenticationService` - 로그인 화면 마우스 이동
- `ButtonInteractionService` - 버튼 클릭
- `EnhancedButtonInteractionService` - 팝업 확인 버튼

## Troubleshooting

### AdsPower 연결 실패
```bash
tasklist | findstr "AdsPower"    # 실행 확인
netstat -an | findstr "50325"    # API 포트 확인
# ADSPOWER_API_URL=auto 설정 시 자동 포트 감지
```

### 브라우저 세션 충돌 / ECONNREFUSED 오류
```bash
taskkill /f /im "chrome.exe"     # 좀비 프로세스 정리
```
재시도 시 반드시 `closeBrowser()` 호출 (v2.3)

### Google Sheets 권한 오류
1. `credentials/service-account.json` 존재 확인
2. Service Account 이메일이 Sheets에 편집자로 추가되었는지 확인

### 팝업 확인 실패 (다국어)
1. `multilanguage.js`에 버튼 텍스트 정의 확인
2. UseCase의 `buttonPriority` 배열에도 해당 언어 버튼 추가 확인

## 지원 언어

**날짜 파싱**: ko, en, ja, zh, vi, th, id, ms, pt, es, de, fr, ru, tr, it (15개)
**UI 버튼**: multilanguage.js 참조 (언어별 상이)

## 로그 위치

| 디렉토리 | 용도 | 권장 보존 |
|----------|------|-----------|
| `logs/terminal/` | 터미널 로그 (JSON) | 48시간 |
| `logs/sessions/` | 세션 로그 | 48시간 |
| `logs/errors/` | 에러 로그 | 7일 |
| `screenshots/debug/` | 디버그 스크린샷 | 24시간 |

CLI에서 `🧹 로그/스크린샷 정리` 메뉴로 정리 가능

## 코드 수정 시 체크리스트

1. **새 UseCase 추가시**: `src/container.js`에 등록 + `inject()` 설정
2. **브라우저 조작시**: try-finally로 `closeBrowser()` 보장
3. **프로필 조회시**: `getAllProfiles()` 사용 (페이지네이션 자동)
4. **다국어 텍스트 추가시**: `multilanguage.js` + UseCase buttonPriority + `verify:dates`
5. **환경변수 추가시**: `.env.example` 동기화
6. **기본값 변경시**: `src/config/workerDefaults.js` 수정 (단일 소스)
7. **휴먼라이크 옵션**: `humanLikeMotion` 기본값 true (봇 탐지 우회)
