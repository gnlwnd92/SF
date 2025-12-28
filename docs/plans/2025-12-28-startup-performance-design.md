# npm start 초기화 성능 개선 설계

> 작성일: 2025-12-28

## 문제 정의

### 증상
- 새 환경에서 `npm start` 실행 시 5-15초 이상 지연
- 기존 환경에서는 1-2초 내 시작

### 근본 원인

| 원인 | 상세 | 소요 시간 (추정) |
|------|------|-----------------|
| **Cold Module Cache** | 80+ 모듈 순차 `require()` | 3-5초 |
| **Repository 폴백 체인** | 3중 try-catch 순차 시도 | 0.5-1초 |
| **Google Sheets OAuth** | 서비스 계정 인증 | 1-3초 |
| **AdsPower API 체크** | HTTP 연결 확인 | 0.5-1초 |
| **console.log 오버헤드** | 50+ 로그 출력 | 0.2-0.5초 |

**총 예상 지연: 5-10초** (새 환경 기준)

---

## 선택된 해결 방안: 지연 로딩 + 병렬화

### 핵심 변경 사항

#### 1. UseCase 지연 로딩 (container.js)

```javascript
// 변경 전: 즉시 로딩 (80+ 모듈)
const EnhancedPauseSubscriptionUseCase = require('./usecases/EnhancedPauseSubscriptionUseCase');
const EnhancedResumeSubscriptionUseCase = require('./usecases/EnhancedResumeSubscriptionUseCase');
// ... 30개 이상

// 변경 후: 지연 로딩 (Factory 패턴)
function lazyRequire(modulePath) {
  let module = null;
  return () => {
    if (!module) {
      module = require(modulePath);
    }
    return module;
  };
}

// UseCase 팩토리
const useCaseFactories = {
  pause: lazyRequire('./application/usecases/EnhancedPauseSubscriptionUseCase'),
  resume: lazyRequire('./application/usecases/EnhancedResumeSubscriptionUseCase'),
  // ...
};
```

#### 2. 필수 모듈만 즉시 로딩

```javascript
// 즉시 로딩 (필수)
const { createContainer, asClass, asValue, asFunction } = require('awilix');
const AdsPowerAdapter = require('./infrastructure/adapters/AdsPowerAdapter');

// 지연 로딩 (선택적)
let _pauseUseCase = null;
function getPauseUseCase() {
  if (!_pauseUseCase) {
    _pauseUseCase = require('./application/usecases/EnhancedPauseSubscriptionUseCase');
  }
  return _pauseUseCase;
}
```

#### 3. 네트워크 초기화 병렬화 (EnterpriseCLI.js)

```javascript
// 변경 전: 순차 초기화
await adsPowerAdapter.checkConnection();  // 1초
await this.loadProfileMapping();          // 2초
// 총: 3초

// 변경 후: 병렬 초기화
const [adsPowerConnected, profileMapping] = await Promise.all([
  adsPowerAdapter.checkConnection(),
  this.loadProfileMapping()
]);
// 총: 2초 (가장 느린 작업 기준)
```

#### 4. console.log 조건부 출력

```javascript
// 변경 전
console.log('[Container] Loading AdsPowerAdapter...');

// 변경 후
if (process.env.DEBUG_STARTUP === 'true') {
  console.log('[Container] Loading AdsPowerAdapter...');
}
```

---

## 수정 파일 목록

| 파일 | 변경 내용 | 우선순위 |
|------|-----------|----------|
| `src/container.js` | UseCase 지연 로딩 팩토리 | P0 |
| `src/presentation/cli/EnterpriseCLI.js` | 네트워크 초기화 병렬화 | P0 |
| `index.js` | 디버그 로그 조건부 출력 | P1 |

---

## 예상 개선 효과

| 지표 | 변경 전 | 변경 후 |
|------|---------|---------|
| 새 환경 시작 시간 | 5-10초 | 2-4초 |
| 기존 환경 시작 시간 | 1-2초 | 0.5-1초 |
| 초기 로딩 모듈 수 | 80+ | 20-30 |

---

## 구현 단계

### Phase 1: 핵심 개선 (P0)
1. `container.js`에 `lazyRequire()` 헬퍼 추가
2. UseCase 등록을 `asFunction`으로 변경 (실제 사용 시 require)
3. `EnterpriseCLI.js`에서 `Promise.all()` 병렬화

### Phase 2: 추가 최적화 (P1)
4. console.log 조건부 출력
5. Repository 폴백 로직 단순화

### Phase 3: 모니터링 (P2)
6. 시작 시간 측정 로깅 추가
7. 성능 벤치마크 스크립트 작성

---

## 롤백 계획

모든 변경은 기능적으로 동일하므로 롤백 필요 시:
1. Git revert 사용
2. 또는 `DISABLE_LAZY_LOADING=true` 환경 변수로 비활성화

---

## 테스트 시나리오

1. **새 환경 테스트**
   - 새 터미널 세션에서 `npm start` 실행
   - 예상: 메뉴 표시까지 3초 이내

2. **기존 환경 테스트**
   - 연속 `npm start` 실행
   - 예상: 메뉴 표시까지 1초 이내

3. **기능 테스트**
   - 모든 메뉴 기능 정상 작동 확인
   - UseCase 지연 로딩 시 오류 없음 확인

---

## 커밋 정보 (예정)

- **메시지**: `perf: Lazy loading for UseCase modules to improve startup time`
- **버전**: v2.8
