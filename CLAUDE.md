# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

**AdsPower YouTube Premium Automation** - Clean Architecture 기반 브라우저 자동화 시스템. AdsPower API + Puppeteer로 YouTube Premium 구독 관리. Awilix DI 컨테이너, 다국어 지원.

**Tech Stack**: Node.js 16+, Awilix (DI), Puppeteer, Google Sheets API, chalk/inquirer (CLI)

**버전**: v2.14 (2025-12-29)

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

# 백업/복원
npm run backup:txt                # TXT → Google Sheets 백업
npm run restore                   # Google Sheets → TXT 복원

# 로그 관리
npm run logs:stats                # 로그 통계 확인
npm run logs:cleanup              # 오래된 로그 정리
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
`multilanguage.js`에 정의된 버튼 텍스트가 UseCase의 `buttonPriority` 배열에도 포함되어야 함.
**실제 사례**: 러시아어 버튼이 `multilanguage.js`에는 있었지만 `buttonPriority` 배열에 없어서 팝업 확인 실패

### 7. 버튼 셀렉터 통일 (v2.5)
YouTube가 `<div role="button">`으로 렌더링할 수 있으므로 항상 통일된 셀렉터 사용:
```javascript
// ✅ 모든 버튼 형태 감지
document.querySelectorAll('button, [role="button"]')
```

### 8. Manage 버튼 토글 방지 (v2.6)
Manage membership 버튼은 토글 방식이므로 패널이 이미 열려있으면 클릭 시 닫힘:
```javascript
// checkCurrentStatus()에서 먼저 Resume/Pause 버튼이 보이는지 확인
const buttonsAlreadyVisible = await this.page.evaluate((langData) => {
  // Resume/Pause 버튼 체크 후 보이면 Manage 클릭 스킵
}, lang);
```

### 9. checkCurrentStatus() 직접 클릭 방식 (v2.6)
`EnhancedButtonInteractionService.clickManageMembershipButton()`은 반환값 불일치 문제가 있음:
```javascript
// ✅ 직접 클릭 방식 사용 (검증된 로직)
const buttons = await this.page.$$('ytd-button-renderer button, button, [role="button"]');
for (const btn of buttons) {
  const buttonText = await btn.evaluate(el => el.textContent);
  if (buttonText.includes('Manage membership')) {
    await btn.click();
    break;
  }
}
```

### 10. TXT 백업 배치 업로드 (v2.7)
Google Sheets API 502 오류 방지를 위한 배치 처리:
```javascript
// TxtBackupUseCaseFinal.js 설정
this.config = {
  batchSize: 50,        // 500 → 50 (API 502 방지)
  maxRetries: 3,        // 재시도 횟수
  retryDelay: 2000,     // 재시도 대기 (지수 백오프)
  batchDelay: 1000      // 배치 간 대기
};
```

### 11. 해시 기반 프록시 매핑 (v2.9)
Google 자동화 탐지 우회를 위한 계정-프록시 1:1 고정 매핑:
```javascript
// 동일 계정은 항상 동일한 프록시 사용
const hashProxyMapper = container.resolve('hashProxyMapper');
const proxy = await hashProxyMapper.getProxyForAccount(email, 'kr');
// hash(email) % activeProxyCount → 결정론적 매핑

// 폴백 계층: 해시 매핑 → 시트 랜덤 → 하드코딩 랜덤
try {
  const result = await hashProxyMapper.getRandomProxyFromSheet('kr');
  krProxy = result.proxy;        // gate.decodo.com (24h Sticky)
  proxyId = result.proxyId;      // 'random_Proxy_kr_15'
} catch {
  krProxy = getRandomProxy('kr'); // kr.decodo.com (하드코딩)
  proxyId = 'hardcoded_random';
}
```
**관련 파일**:
- `src/services/HashBasedProxyMappingService.js` - 해시 매핑 + `_log()` 로거 호환성
- `src/infrastructure/repositories/ProxySheetRepository.js` - 프록시 시트 읽기
- Google Sheets '프록시' 시트 (A-K열: ID, 유형, 호스트, 포트, 사용자명, 비밀번호, 국가, 상태, 연속실패횟수, 마지막사용시간, 최근IP)

### 12. AdsPower 프록시 설정 형식 (v2.9)
프록시 설정 시 필드 형식 주의:
```javascript
// ✅ 올바른 형식
{
  proxy_soft: 'other',           // 항상 'other' (커스텀 프록시)
  proxy_type: 'socks5',          // 프로토콜 타입
  proxy_host: 'gate.decodo.com',
  proxy_port: String(port),      // ⚠️ 반드시 문자열
  proxy_user: 'session-xxx',
  proxy_password: 'xxx'
}

// ❌ 잘못된 형식
{
  proxy_soft: 'socks5',          // 'other'여야 함
  proxy_port: 7000,              // 숫자 안됨, String 필수
}
```

### 13. 프록시 변경 전 기존 브라우저 종료 (v2.10, 필수!)
`updateProfile()` API는 프로필 설정만 변경하며, **실행 중인 브라우저에는 적용되지 않음**:
```javascript
// ❌ 잘못된 순서 - 기존 브라우저가 이전 프록시로 재사용됨
await adsPowerAdapter.updateProfile(profileId, { user_proxy_config: krProxy });
const { browser } = await adsPowerAdapter.openBrowser(profileId);
// → 이미 실행 중인 브라우저를 재연결하면 새 프록시가 적용되지 않음!

// ✅ 올바른 순서 - 기존 브라우저 종료 후 프록시 설정
await adsPowerAdapter.closeBrowser(profileId);  // 기존 브라우저 종료
await delay(2000);                              // 정리 대기
await adsPowerAdapter.updateProfile(profileId, { user_proxy_config: krProxy });
const { browser } = await adsPowerAdapter.openBrowser(profileId);  // 새 브라우저
// → 새 브라우저가 새 프록시로 시작됨
```
**증상**: 검은 화면, `ERR_SOCKS_CONNECTION_FAILED`, "Manage membership 버튼 클릭 실패"

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
│     └─ TxtBackupUseCaseFinal.js               # 백업 │
├─────────────────────────────────────────────────────┤
│  Domain Layer                                       │
│  └─ src/domain/ (entities/, services/)             │
├─────────────────────────────────────────────────────┤
│  Infrastructure Layer                               │
│  ├─ adapters/                                      │
│  │   ├─ AdsPowerAdapter.js    ⚠️ getAllProfiles() │
│  │   ├─ HumanLikeMouseHelper.js   # 베지어 곡선   │
│  │   └─ CDPClickHelper.js         # CDP 클릭      │
│  ├─ repositories/                                  │
│  │   ├─ EnhancedGoogleSheetsRepository.js         │
│  │   └─ PauseSheetRepository.js   # 통합워커 탭   │
│  └─ config/                                        │
│      └─ multilanguage.js  # 다국어 UI 텍스트      │
├─────────────────────────────────────────────────────┤
│  Services (횡단 관심사)                             │
│  └─ src/services/                                  │
│      ├─ ImprovedAuthenticationService.js  # CDP 클릭 │
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
| `src/infrastructure/config/multilanguage.js` | 다국어 UI 텍스트 |

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

# 디버그
DEBUG_MODE=false
DEBUG_STARTUP=false              # 시작 시 로그 출력
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

## Google Sheets 시트 구조

| 시트명 | 용도 |
|--------|------|
| `애즈파워현황` | 전체 프로필 목록 (AdsPower ID 매핑) |
| `일시정지` | 일시정지 대상 |
| `재개` | 재개 대상 |
| `통합워커` | 상태 기반 자동 관리 (E열: 상태, F열: 다음결제일, G열: IP, H열: 결과, I열: 시간, J열: 잠금, K열: 결제카드, L열: 재시도, M열: proxyId, N열: 결제미완료_체크, O열: 결제미완료_재시작) |
| `백업` | TXT 백업 데이터 |
| `프록시` | 24h Sticky 세션 프록시 (A-K열: ID, 유형, 호스트, 포트, 사용자명, 비밀번호, 국가, 상태, 연속실패횟수, 마지막사용시간, 최근IP) |

## 통합워커 시스템 (v2.0)

분산 PC에서 동시 작업 시 충돌 방지하는 시간 기반 자동 관리 시스템:

**기본값 설정** (`src/config/workerDefaults.js`):
```javascript
{
  resumeMinutesBefore: 30,    // 결제재개: 결제 전 30분
  pauseMinutesAfter: 10,      // 일시중지: 결제 후 10분
  checkIntervalSeconds: 60,   // 체크 간격 60초
  maxRetryCount: 3,           // 최대 재시도 3회
  humanLikeMotion: true,      // 휴먼라이크 인터랙션

  // [v2.14] 결제 미완료 재시도 설정
  paymentPendingMaxHours: 24,       // 최대 대기 시간 (시간)
  paymentPendingRetryMinutes: 30    // 재시도 간격 (분)
}
```

### 결제 미완료 감지 시스템 (v2.14)

시트에 기록된 결제일이 잘못된 경우, 결제가 안 됐는데 일시중지 작업을 진행하는 문제 방지:

**감지 조건**: 다음 결제일이 오늘 ±1일 이내
**처리 방식**: 시간 기반 24시간 재시도 (횟수 기반 아님)

| 열 | 필드명 | 용도 |
|----|--------|------|
| N | 결제미완료_체크 | 최초 감지 시각 (한국 시간) - 24시간 제한 기준 |
| O | 결제미완료_재시작 | 다음 재시도 시각 (한국 시간) - 분산 워커 동기화 |

**흐름**:
1. `checkCurrentStatus()`에서 결제 미완료 감지 (Pause 클릭 전)
2. N열 최초 설정 → O열에 30분 후 시각 기록
3. `filterPaymentPendingRetryTargets()`로 재시도 대상 필터링
4. 24시간 초과 시 '수동체크-결제지연' 상태로 전환

**중요**: `filterPauseTargets()`에서 `pendingRetryAt`이 있는 작업은 반드시 제외해야 함

## 휴먼라이크 인터랙션 (v2.4)

봇 탐지 우회를 위한 자연스러운 마우스/클릭 동작:

| 모듈 | 핵심 기능 |
|------|-----------|
| HumanLikeMouseHelper | 베지어 곡선, 손떨림, 가속/감속 |
| CDPClickHelper | CDP 네이티브 입력 이벤트 |

**활성화**: `humanLikeMotion: true` (기본값)

## 성능 최적화

### 초기화 지연 원인 (v2.8)
새 환경에서 `npm start`가 느린 경우:
1. **Cold Module Cache**: 80+ 모듈 순차 로딩 (3-5초)
2. **Google Sheets OAuth**: 서비스 계정 인증 (1-3초)
3. **AdsPower API 체크**: HTTP 연결 확인 (0.5-1초)

**해결 방안**: `docs/plans/2025-12-28-startup-performance-design.md` 참조

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

### Google Sheets 502 오류 (TXT 백업)
- 배치 크기: 50 이하 유지
- 재시도 로직 필수
- `TxtBackupUseCaseFinal.js` 설정 확인

### 팝업 확인 실패 (다국어)
1. `multilanguage.js`에 버튼 텍스트 정의 확인
2. UseCase의 `buttonPriority` 배열에도 해당 언어 버튼 추가 확인

## 지원 언어

**날짜 파싱**: ko, en, ja, zh, vi, th, id, ms, pt, es, de, fr, ru, tr, it (15개)

## 로그 위치

| 디렉토리 | 용도 |
|----------|------|
| `logs/terminal/` | 터미널 로그 (JSON, 48시간) |
| `logs/sessions/` | 세션 로그 |
| `logs/errors/` | 에러 로그 |
| `screenshots/debug/` | 디버그 스크린샷 |

## 코드 수정 시 체크리스트

1. **새 UseCase 추가시**: `src/container.js`에 등록 + `inject()` 설정
2. **브라우저 조작시**: try-finally로 `closeBrowser()` 보장
3. **프로필 조회시**: `getAllProfiles()` 사용 (페이지네이션 자동)
4. **다국어 텍스트 추가시**: `multilanguage.js` + UseCase buttonPriority + `verify:dates`
5. **환경변수 추가시**: `.env.example` 동기화
6. **기본값 변경시**: `src/config/workerDefaults.js` 수정 (단일 소스)
7. **버튼 탐색시**: `button, [role="button"]` 셀렉터 사용 (통일)
8. **Manage 버튼 클릭시**: Resume/Pause 버튼 선행 체크 (토글 방지)
9. **checkCurrentStatus 수정시**: 직접 클릭 방식 사용
10. **TXT 백업 수정시**: 배치 크기 50 이하 + 재시도 로직 필수
11. **프록시 설정시**: `proxy_port: String(port)`, `proxy_soft: 'other'` 필수
12. **로거 사용시**: 옵셔널 메서드는 `_log()` 헬퍼 패턴 사용 (debug/warn 없을 수 있음)
13. **프록시 변경시**: 반드시 `closeBrowser()` 후 `updateProfile()` → `openBrowser()` 순서
14. **결제 미완료 필터링시**: `pendingRetryAt`이 있는 작업은 `filterPauseTargets()`에서 제외 (v2.14)
15. **한국 시간 사용시**: `Intl.DateTimeFormat`과 `Asia/Seoul` 타임존 사용 (로컬 시간 메서드 X)
