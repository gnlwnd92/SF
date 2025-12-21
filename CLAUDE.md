# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

**AdsPower YouTube Premium Automation** - Clean Architecture 기반 브라우저 자동화 시스템. AdsPower API + Puppeteer로 YouTube Premium 구독 관리. Awilix DI 컨테이너, 15개 언어 지원.

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
npm run backup:txt                # 프로필 TXT 백업
npm run backup-card:change        # 백업 카드 변경

# 테스트 및 검증
npm test                          # AdsPower 연결 테스트
npm run verify:dates              # 15개 언어 날짜 파싱 검증
node test-connection.js           # 단일 프로필 연결 테스트

# 배치 작업
npm run batch:visual              # 시각적 배치 컨트롤러
npm run batch:improved:pause      # 개선된 배치 일시정지
npm run batch:improved:resume     # 개선된 배치 재개

# 로그 및 진단
npm run logs:stats                # 로그 통계 확인
npm run logs:cleanup              # 오래된 로그 정리
npm run batch:diagnose            # 배치 작업 진단
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
Repository는 `createLazyRepository()` 래퍼를 통해 첫 호출시 자동 초기화됨.

### 5. 재시도 전 브라우저 정리 (v2.3)
"이미 일시중지 상태" 재확인 시 Stale WebSocket 연결 방지:
```javascript
// ❌ 브라우저 종료 없이 재시도 - ECONNREFUSED 발생
await new Promise(resolve => setTimeout(resolve, 3000));
i--;
continue;

// ✅ 명시적 브라우저 종료 후 재시도
await adsPowerAdapter.closeBrowser(task.adsPowerId);
await new Promise(resolve => setTimeout(resolve, 5000));
i--;
continue;
```

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
│     ├─ BatchPauseOptimizedUseCase.js               │
│     ├─ FamilyPlanCheckUseCase.js                   │
│     └─ BackupCardChangeUseCase.js                  │
├─────────────────────────────────────────────────────┤
│  Domain Layer                                       │
│  └─ src/domain/                                    │
│     ├─ entities/ (Profile, Subscription)           │
│     └─ services/ (YouTubePremiumService)           │
├─────────────────────────────────────────────────────┤
│  Infrastructure Layer                               │
│  ├─ adapters/                                      │
│  │   ├─ AdsPowerAdapter.js    ⚠️ getAllProfiles() │
│  │   ├─ BrowserController.js                       │
│  │   └─ YouTubeAutomationAdapter.js               │
│  ├─ repositories/                                  │
│  │   ├─ EnhancedGoogleSheetsRepository.js         │
│  │   ├─ PauseSheetRepository.js                   │
│  │   └─ MockGoogleSheetsRepository.js             │
│  └─ config/                                        │
│      ├─ multilanguage.js  # 15개 언어 UI 텍스트   │
│      └─ languages.js      # 언어 감지 로직         │
├─────────────────────────────────────────────────────┤
│  Services (횡단 관심사)                             │
│  └─ src/services/                                  │
│      ├─ AuthenticationService.js                   │
│      ├─ NavigationService.js                       │
│      ├─ LanguageService.js                         │
│      ├─ ButtonInteractionService.js                │
│      ├─ PopupService.js                            │
│      ├─ DateParsingService.js (15개 언어 날짜)     │
│      └─ IPService.js                               │
└─────────────────────────────────────────────────────┘
```

## Key Files

| 파일 | 역할 |
|------|------|
| `index.js` | 메인 진입점, 터미널 로거 초기화, CLI 시작 |
| `src/container.js` | Awilix DI 컨테이너 설정 (⚠️ 새 서비스 등록 필수) |
| `src/presentation/cli/EnterpriseCLI.js` | 대화형 CLI 메뉴 |
| `src/infrastructure/adapters/AdsPowerAdapter.js` | 브라우저 제어 핵심 |
| `src/services/EnhancedDateParsingService.js` | 15개 언어 날짜 파싱 |
| `src/infrastructure/config/multilanguage.js` | 다국어 UI 텍스트 |

## Environment Variables (.env)

```bash
# 필수
ADSPOWER_API_URL=auto            # 자동 포트 감지 (50325, 50326, 50327)
# 또는 ADSPOWER_API_URL=http://127.0.0.1:50326  # 수동 지정
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
2. `npm run verify:dates` 실행하여 날짜 파싱 검증

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
| `애즈파워현황` | 전체 프로필 목록 |
| `일시정지` | 일시정지 대상 |
| `재개` | 재개 대상 |
| `가족요금제` | 가족 요금제 확인 |
| `백업카드변경` | 결제 수단 변경 |

필수 열: 프로필명, 이메일, 비밀번호, 상태, 마지막작업일시, AdsPower ID

## Troubleshooting

### AdsPower 연결 실패
```bash
tasklist | findstr "AdsPower"    # 실행 확인
netstat -an | findstr "50325"    # API 포트 확인 (50325, 50326, 50327)
set USE_MOCK_REPOSITORY=true     # Mock 모드 전환
# ADSPOWER_API_URL=auto 설정 시 자동 포트 감지
```

### 브라우저 세션 충돌 / ECONNREFUSED 오류
```bash
taskkill /f /im "chrome.exe"     # 좀비 프로세스 정리
taskkill /f /im "AdsPower.exe"   # AdsPower 재시작
```
재시도 시 `closeBrowser()` 호출로 Stale WebSocket 연결 방지 (v2.3)

### Google Sheets 권한 오류
1. `credentials/service-account.json` 존재 확인
2. Service Account 이메일이 Sheets에 편집자로 추가되었는지 확인
3. GOOGLE_SHEETS_ID가 하드코딩 대신 `process.env.GOOGLE_SHEETS_ID` 사용 확인

### 메모리 누수 방지
- 브라우저 사용 후 반드시 `closeBrowser()` 호출
- 배치 작업 후 `npm cache clean --force`

## 지원 언어 (15개)
ko, en, ja, zh, vi, th, id, ms, pt, es, de, fr, ru, ar, hi

## 로그 위치
- 터미널 로그: `logs/terminal/` (JSON, 48시간 보존)
- 에러 스크린샷: `screenshots/`
- 세션 로그: `logs/sessions/`
