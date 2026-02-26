# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

**AdsPower YouTube Premium Automation** - Clean Architecture 기반 브라우저 자동화 시스템. AdsPower API + Puppeteer로 YouTube Premium 구독 관리.

**Tech Stack**: Node.js 16+, Awilix (DI), Puppeteer, Google Sheets API, chalk/inquirer (CLI)

**버전**: v2.39 (2026-02-26 KST) | package.json: 2.0.0

## Core Commands

```bash
# Quick Start
set USE_MOCK_REPOSITORY=true && npm start  # Mock 모드 (Google Sheets 불필요)
npm start                                   # CLI 메인 메뉴 (index.js)

# 주요 워크플로우
npm run pause                     # 구독 일시정지 (--mode pause)
npm run resume                    # 구독 재개 (--mode resume)
npm run check                     # 상태 확인 (--mode check)
npm run family:check              # 가족 요금제 확인

# 테스트/검증
npm run verify:dates              # 다국어 날짜 파싱 검증
node test-connection.js           # 단일 프로필 연결 테스트

# 배치 작업
npm run batch:visual              # 시각적 배치 컨트롤러
npm run batch:improved:pause      # 배치 일시정지
npm run batch:improved:resume     # 배치 재개

# 백업/복원
npm run backup:txt                # TXT → Google Sheets 백업
npm run backup:safe               # 안전한 배치 백업
npm run restore                   # Google Sheets → TXT 복원

# 세션 관리
npm run sessions:cleanup          # 세션 정리
npm run sessions:stats            # 세션 통계

# 디버그
DEBUG_MODE=true npm start         # 상세 로그 출력
DEBUG_STARTUP=true npm start      # 컨테이너 시작 로그 출력
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Presentation Layer                                 │
│  └─ src/presentation/cli/                          │
│     ├─ EnterpriseCLI.js            # 메인 CLI     │
│     ├─ ImprovedEnterpriseCLI.js    # 개선 CLI     │
│     └─ BatchMonitorDashboard.js    # 배치 대시보드 │
├─────────────────────────────────────────────────────┤
│  Application Layer (UseCases)                       │
│  └─ src/application/usecases/                      │
│     ├─ EnhancedPauseSubscriptionUseCase.js         │
│     ├─ EnhancedResumeSubscriptionUseCase.js        │
│     ├─ ScheduledSubscriptionWorkerUseCase.js  # 통합워커 │
│     ├─ BackupCardChangeUseCase.js  # 백업카드 변경 │
│     ├─ EnhancedBatchProcessingUseCase.js  # 배치처리 │
│     └─ ParallelFamilyPlanCheckUseCase.js  # 병렬체크 │
├─────────────────────────────────────────────────────┤
│  Domain Layer                                       │
│  └─ src/domain/ (entities/, services/)             │
├─────────────────────────────────────────────────────┤
│  Infrastructure Layer                               │
│  ├─ adapters/                                      │
│  │   ├─ AdsPowerAdapter.js         # 브라우저 제어 │
│  │   ├─ HumanLikeMouseHelper.js    # 베지어 곡선  │
│  │   ├─ CDPClickHelper.js          # CDP 클릭     │
│  │   └─ YouTubePaymentAdapter.js   # 결제 어댑터  │
│  ├─ repositories/                                  │
│  │   ├─ EnhancedGoogleSheetsRepository.js         │
│  │   ├─ PauseSheetRepository.js    # 통합워커 탭  │
│  │   ├─ ProxySheetRepository.js    # 프록시 탭    │
│  │   ├─ ConfigRepository.js        # 설정 탭      │
│  │   └─ BackupCardSheetRepository.js # 백업카드   │
│  └─ config/                                        │
│      ├─ multilanguage.js           # 다국어 UI    │
│      └─ backup-card-multilanguage.js # 백업카드 다국어 │
├─────────────────────────────────────────────────────┤
│  Services (횡단 관심사)                             │
│  └─ src/services/                                  │
│      ├─ ImprovedAuthenticationService.js  # 로그인 │
│      ├─ EnhancedDateParsingService.js  # 날짜 파싱 │
│      ├─ WorkerLockService.js       # 분산 잠금    │
│      ├─ HashBasedProxyMappingService.js  # 프록시 │
│      ├─ SharedConfig.js            # 설정 캐싱    │
│      ├─ SessionLogService.js       # 세션 로그    │
│      ├─ TimeFilterService.js       # 시간 필터링  │
│      └─ BackupCardService.js       # 백업카드     │
└─────────────────────────────────────────────────────┘
```

**핵심 파일**:
| 파일 | 역할 |
|------|------|
| `index.js` | 진입점: .env 로드 → config 생성 → CLI 시작, SIGINT/SIGTERM 핸들러 |
| `src/container.js` | Awilix DI 컨테이너 (새 서비스 등록 필수) |
| `src/config/workerDefaults.js` | 통합워커 기본값 (Single Source of Truth) |
| `src/config/configKeys.js` | 설정 키 상수/기본값/타입 정의 (20개 항목) |
| `src/infrastructure/config/multilanguage.js` | 다국어 UI 텍스트 (15개 언어) |
| `src/utils/ErrorClassifier.js` | 에러 분류 (백업카드 등) |

**Container 모듈 로드 순서** (`src/container.js`):
1. Repository Fallback 체인: `EnhancedGoogleSheetsRepository` → `SimpleGoogleSheetsRepository` → `MockGoogleSheetsRepository`
2. Mock 모드 (`USE_MOCK_REPOSITORY=true`): Simple/Mock 직접 사용
3. Service Account 미존재 시: 자동으로 Mock Fallback
4. `lazyRequire()`: 실제 사용 시점에 `require()` 호출 (성능 최적화)
5. `createLazyRepository()`: Proxy 패턴으로 첫 메서드 호출 시 `initialize()` 자동 실행

## Critical Implementation Rules

### 1. AdsPower 페이지네이션 (필수)
API는 페이지당 최대 100개만 반환. 반드시 `getAllProfiles()` 사용:
```javascript
// ✅ 모든 프로필 (자동 페이지네이션)
const { profiles, total } = await adapter.getAllProfiles();
```

### 2. 브라우저 세션 관리 (try-finally 필수)
```javascript
let browser = null;
try {
  await adapter.closeBrowser(profileId);  // 기존 브라우저 정리
  ({ browser } = await adapter.openBrowser(profileId));
  await doWork(browser);
} finally {
  if (browser) await adapter.closeBrowser(profileId);
}
```

### 3. DI 컨테이너 등록
모든 서비스는 `src/container.js`에 등록:
```javascript
container.register({
  myService: asClass(MyService).singleton(),
  myAdapter: asClass(MyAdapter).scoped()
});
```

### 4. 다국어 버튼 텍스트 동기화
`multilanguage.js`에 정의된 버튼 텍스트가 UseCase의 `buttonPriority` 배열에도 포함되어야 함.

### 5. 버튼 셀렉터 통일
YouTube가 `<div role="button">`으로 렌더링할 수 있음:
```javascript
document.querySelectorAll('button, [role="button"]')
```

### 6. 프록시 설정 형식
```javascript
{
  proxy_soft: 'other',           // 항상 'other'
  proxy_type: 'socks5',
  proxy_host: 'gate.decodo.com',
  proxy_port: String(port),      // 반드시 문자열
  proxy_user: 'session-xxx',
  proxy_password: 'xxx'
}
```

### 7. 프록시 변경 전 브라우저 종료 (필수)
`updateProfile()`은 실행 중인 브라우저에 적용되지 않음:
```javascript
await adsPowerAdapter.closeBrowser(profileId);  // 먼저 종료
await delay(2000);
await adsPowerAdapter.updateProfile(profileId, { user_proxy_config: krProxy });
const { browser } = await adsPowerAdapter.openBrowser(profileId);  // 새로 시작
```

### 8. TXT 백업 배치 처리
Google Sheets API 502 오류 방지:
```javascript
this.config = {
  batchSize: 50,        // 500 → 50
  maxRetries: 3,
  retryDelay: 2000,     // 지수 백오프
  batchDelay: 1000
};
```

## Google Sheets 시트 구조

| 시트명 | 용도 | 주요 열 |
|--------|------|---------|
| `애즈파워현황` | 프로필 목록 | AdsPower ID 매핑 |
| `통합워커` | 상태 기반 자동 관리 | E:상태, F:다음결제일, J:잠금, L:재시도, N/O:결제미완료 |
| `프록시` | 24h Sticky 세션 | H:상태, I:연속실패횟수 |
| `설정` | 동적 설정값 | A:설정키, B:설정값 (20개 항목) |

## 통합워커 시스템

분산 PC에서 동시 작업 시 충돌 방지하는 시간 기반 자동 관리 시스템.

**기본값** (`src/config/workerDefaults.js`):
```javascript
{
  resumeMinutesBefore: 30,    // 결제 전 30분에 재개
  pauseMinutesAfter: 10,      // 결제 후 10분에 일시중지
  checkIntervalSeconds: 60,   // 체크 간격
  maxRetryCount: 10,
  humanLikeMotion: true
}
```

### 분산 잠금 메커니즘

**J열 잠금 형식**: `작업중:WORKER-DESK-123456:03:54`

| 시나리오 | 잠금 해제 |
|----------|-----------|
| 정상 완료 | 즉시 (3단계 순차 업데이트) |
| Ctrl+C | 즉시 (SIGINT 핸들러) |
| 비정상 종료 | 15분 후 자동 만료 |

**중복 방지 메커니즘**:
1. **상태 재검증**: 잠금 획득 후 최신 상태 재확인 → 변경됐으면 스킵
2. **3단계 순차 업데이트**: E열(상태) → 나머지 → J열(잠금 해제)
3. **잠금 대기 랜덤화**: 500-1000ms (동시 획득 충돌 방지)

### 결제 미완료 감지

시트 결제일이 잘못된 경우 일시중지 작업 방지:
- **N열**: 최초 감지 시각 (24시간 제한 기준)
- **O열**: 다음 재시도 시각 (30분 간격)
- 24시간 초과 시 '수동체크-결제지연' 상태로 전환

### 해시 기반 프록시 매핑

```javascript
// 첫 시도: 해시 기반 고정 프록시
const proxy = await hashProxyMapper.getProxyForAccount(email, 'kr');
// hash(email) % activeProxyCount → 결정론적 매핑

// 재시도: 완전 랜덤 프록시 (죽은 프록시 우회)
const proxy = await hashProxyMapper.getProxyForAccount(email, 'kr', retryCount);
```

**프록시 자동 비활성화**: 2회 연속 실패 시 H열 '비활성화'로 변경

## 설정 관리 (SharedConfig)

Google Sheets '설정' 탭에서 동적으로 변경 가능. 코드 수정 불필요.

```javascript
// UseCase에서 설정 조회 (캐시에서 즉시 반환, 5분 자동 동기화)
const timeout = this.sharedConfig.getNavigationTimeoutMs();
const clickWait = this.sharedConfig.getRandomClickWait();

// 우선순위: options > sharedConfig > WORKER_DEFAULTS
```

**주요 설정** (전체 목록: `src/config/configKeys.js`):
- `RESUME_MINUTES_BEFORE`, `PAUSE_MINUTES_AFTER`: 작업 타이밍
- `MAX_RETRY_COUNT`, `LOCK_EXPIRY_MINUTES`: 재시도/잠금
- `NAVIGATION_TIMEOUT_MS`, `CLICK_WAIT_*_MS`: 타임아웃/대기
- `ENABLE_RANDOM_ENTRY`: 자동화 탐지 우회용 랜덤 진입 경로

## Environment Variables (.env)

```bash
# 필수
ADSPOWER_API_URL=auto            # 자동 포트 감지 (50325, 50326, 50327)
GOOGLE_SHEETS_ID=<sheets_id>
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json

# 개발
USE_MOCK_REPOSITORY=true         # Google Sheets 없이 개발 (Mock/SimpleRepository)
DEBUG_MODE=false
DEBUG_STARTUP=true               # 컨테이너 초기화 로그

# 선택
LOGIN_MODE=minimal               # minimal(권장) 또는 legacy
ANTI_CAPTCHA_API_KEY=            # 이미지 CAPTCHA 자동 해결 (선택)
```

## Repository 모드

**Mock 모드** (`USE_MOCK_REPOSITORY=true`):
- Google Sheets 연결 없이 로컬 개발
- `SimpleGoogleSheetsRepository` 또는 `MockGoogleSheetsRepository` 사용
- Service Account 파일 없어도 동작

**실제 모드** (기본):
- `credentials/service-account.json` 필요
- `EnhancedGoogleSheetsRepository` 사용
- 자동 Fallback: Enhanced → Simple → Mock

## Troubleshooting

### AdsPower 연결 실패
```bash
tasklist | findstr "AdsPower"    # 실행 확인
netstat -an | findstr "50325"    # API 포트 확인
```

### 브라우저 세션 충돌 / ECONNREFUSED
```bash
taskkill /f /im "chrome.exe"     # 좀비 프로세스 정리
```

### Google Sheets 502 오류
배치 크기 50 이하 유지, 재시도 로직 필수

### 팝업 확인 실패 (다국어)
1. `multilanguage.js`에 버튼 텍스트 정의 확인
2. UseCase의 `buttonPriority` 배열에도 추가 확인

## 로그 위치

| 디렉토리 | 용도 |
|----------|------|
| `logs/screenshots/{날짜}/{이메일}/` | 세션별 스크린샷 + log.txt |
| `logs/terminal/` | 터미널 로그 (JSON, 48시간) |
| `logs/errors/` | 에러 로그 |

**스크린샷 번호 체계**: 로그인 0x (00-08), 작업 1x (10-14)

## 코드 수정 시 체크리스트

1. **새 UseCase 추가**: `src/container.js`에 등록 + `inject()` 설정
2. **브라우저 조작**: try-finally로 `closeBrowser()` 보장
3. **프로필 조회**: `getAllProfiles()` 사용 (페이지네이션 자동)
4. **다국어 텍스트 추가**: `multilanguage.js` + UseCase `buttonPriority` + `npm run verify:dates`
5. **버튼 탐색**: `button, [role="button"]` 셀렉터 사용
6. **프록시 변경**: `closeBrowser()` → `updateProfile()` → `openBrowser()` 순서
7. **프록시 설정**: `proxy_port: String(port)`, `proxy_soft: 'other'`
8. **한국 시간**: `Intl.DateTimeFormat` + `Asia/Seoul` 타임존
9. **설정값 변경**: `configKeys.js` 수정 후 '설정' 시트에도 반영
10. **버전 업데이트**: `EnterpriseCLI.js`의 `displayHeader()` + 이 파일 상단 버전

## 의존성 주입 패턴

`src/container.js`에서 Awilix를 사용한 DI 패턴:
```javascript
// 1. 클래스 등록 (싱글톤)
myService: asClass(MyService).singleton()

// 2. 팩토리 함수 (의존성 주입)
myService: asFunction(({ dep1, dep2 }) => new MyService({ dep1, dep2 })).singleton()

// 3. Lazy Repository (지연 초기화)
myRepo: createLazyRepository(MyRepository, config)

// 4. inject() 패턴
myUseCase: asClass(MyUseCase).inject(() => ({
  dep1: container.resolve('dep1'),
  dep2: container.resolve('dep2')
}))
```

**등록 순서 주의**: 의존하는 서비스보다 먼저 등록해야 함

## Development Workflows

### 새 UseCase 추가 (3단계)
1. `src/application/usecases/MyUseCase.js` 생성
2. `src/container.js`에 등록 (inject 설정 포함)
3. `src/presentation/cli/EnterpriseCLI.js`에 메뉴 추가

### 다국어 지원 추가
1. `src/infrastructure/config/multilanguage.js` 업데이트
2. `src/services/EnhancedDateParsingService.js` monthMappings 추가
3. UseCase의 `buttonPriority` 배열에 추가
4. `npm run verify:dates` 실행

### 백업카드 변경 시스템 (Phase 1-7)
백업카드 변경은 별도의 UseCase/Adapter/Repository/Service 체계:
1. `BackupCardChangeUseCase` → `YouTubePaymentAdapter` → `BackupCardService`
2. `BackupCardSheetRepository`: Google Sheets '백업카드' 탭 CRUD
3. `backup-card-multilanguage.js`: 결제 페이지 전용 다국어 텍스트
4. `ErrorClassifier`: 백업카드 에러 자동 분류

### 포커싱/백그라운드 모드
통합워커 시작 시 선택 가능:
- **포커싱 모드**: 브라우저 창이 앞에 표시 (모니터링용, 권장)
- **백그라운드 모드**: 브라우저 창이 뒤에 유지 (다른 작업 병행 시)

CDP를 통해 윈도우 포커스와 무관하게 마우스/키보드 이벤트 정상 동작.

### 병렬 배치 처리 (Day 9-10)
`ParallelBatchProcessor` + `RealTimeMonitoringDashboard` + `ParallelFamilyPlanCheckUseCase`
- 최대 동시 실행 수: `config.maxConcurrency` (기본 5)
- blessed-contrib 기반 실시간 모니터링 대시보드

## 애플리케이션 진입점

`index.js` → `src/presentation/cli/EnterpriseCLI.js` (또는 `--improved` 시 `ImprovedEnterpriseCLI.js`)

**`index.js` 초기화 흐름**:
1. `TerminalLogger` 초기화 (비동기)
2. `.env` 파일 로드 (없으면 즉시 종료)
3. 필수 디렉터리 생성 (`credentials`, `logs/*`, `screenshots`, `backup`, `temp`)
4. 필수 환경 변수 검증 (`ADSPOWER_API_URL`, `GOOGLE_SHEETS_ID`)
5. CLI 모듈 로드 (일반/개선 선택)
6. SIGINT/SIGTERM 핸들러 등록 (GracefulShutdown)
7. `cli.run()` 실행

CLI 모드별 실행:
```bash
node index.js                    # 대화형 메뉴
node index.js --mode pause       # 일시중지 워크플로우
node index.js --mode resume      # 재개 워크플로우
node index.js --mode check       # 상태 확인
node index.js --mode txt-backup  # TXT 백업
node index.js --improved         # 개선된 CLI (USE_IMPROVED_CLI=true 와 동일)
node index.js --mode renewal-check-pause  # 갱신확인 일시정지
```

## 주요 서비스 역할

| 서비스 | 역할 |
|--------|------|
| `ImprovedAuthenticationService` | Google 계정 로그인, 계정 선택 페이지 처리 |
| `EnhancedDateParsingService` | 15개 언어 날짜 파싱 (YouTube UI에서 결제일 추출) |
| `HumanLikeMouseHelper` | 베지어 곡선 기반 자연스러운 마우스 이동 |
| `CDPClickHelper` | Chrome DevTools Protocol 네이티브 클릭 |
| `SharedConfig` | Google Sheets '설정' 탭 기반 동적 설정 (5분 캐시) |
| `WorkerLockService` | 분산 PC 작업 충돌 방지 (J열 잠금) |
| `HashBasedProxyMappingService` | 이메일 → 프록시 결정론적 매핑 |
| `SessionLogService` | 세션별 스크린샷 + 로그 통합 관리 |
| `TimeFilterService` | KST 기준 시간 조건 필터링 (통합워커용) |
| `ConfigRepository` | Google Sheets '설정' 탭 CRUD |
| `BackupCardService` | 백업카드 변경 워크플로우 지원 |
| `AntiCaptchaService` | 이미지 CAPTCHA 자동/수동 해결 |
| `BatchJobManager` | 배치 작업 싱글톤 관리자 |
| `TerminalLogger` | 터미널 출력 JSON 로깅 (48시간 보관, `index.js`에서 초기화) |
