# 로그인 자동화 우회 솔루션 가이드

> **버전**: v2.10 | **최종 업데이트**: 2025-12-28

이 문서는 AdsPower YouTube Premium 자동화 프로젝트에서 사용하는 **Google 로그인 자동화 우회 기법**을 정리합니다.

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [핵심 우회 기법](#2-핵심-우회-기법)
3. [휴먼라이크 마우스 움직임](#3-휴먼라이크-마우스-움직임)
4. [CDP 네이티브 입력](#4-cdp-네이티브-입력)
5. [프록시 고정 매핑](#5-프록시-고정-매핑)
6. [페이지 타입 감지 및 처리](#6-페이지-타입-감지-및-처리)
7. [CAPTCHA 우회 전략](#7-captcha-우회-전략)
8. [Stealth 브라우저 설정](#8-stealth-브라우저-설정)
9. [설정 및 활성화](#9-설정-및-활성화)

---

## 1. 아키텍처 개요

### 핵심 파일 구조

```
src/
├── services/
│   ├── ImprovedAuthenticationService.js   ★ 메인 인증 서비스
│   ├── HashBasedProxyMappingService.js    ★ 프록시 1:1 고정 매핑
│   └── ImprovedAccountChooserHandler.js      계정 선택 처리
│
├── infrastructure/adapters/
│   ├── HumanLikeMouseHelper.js            ★ 베지어 곡선 마우스
│   ├── CDPClickHelper.js                  ★ CDP 네이티브 클릭
│   ├── StealthBrowserSetup.js                Stealth 플러그인
│   └── MinimalStealthSetup.js                최소 Stealth 설정
│
└── container.js                              DI 컨테이너 등록
```

### 우회 계층 구조

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 프록시 고정 매핑 (IP 일관성)                      │
│  └─ 계정별 동일 프록시 → Google 신뢰도 상승                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Stealth 브라우저 설정                             │
│  └─ navigator.webdriver 제거, 플러그인 위장                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 휴먼라이크 인터랙션                               │
│  └─ 베지어 곡선 + 손떨림 + 자연스러운 타이핑                │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: CDP 네이티브 입력                                 │
│  └─ Puppeteer 우회, Chrome DevTools Protocol 직접 사용     │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: 지능적 페이지 처리                                │
│  └─ 20+ 페이지 타입 감지, CAPTCHA 자동 우회                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 핵심 우회 기법

| 기법 | 목적 | 구현 파일 |
|------|------|-----------|
| **베지어 곡선 마우스** | 직선 이동 탐지 우회 | `HumanLikeMouseHelper.js` |
| **CDP 네이티브 클릭** | Puppeteer 클릭 탐지 우회 | `CDPClickHelper.js` |
| **해시 프록시 매핑** | IP 일관성으로 신뢰도 상승 | `HashBasedProxyMappingService.js` |
| **자연스러운 타이핑** | 일정 속도 타이핑 탐지 우회 | `ImprovedAuthenticationService.js` |
| **CAPTCHA 우회** | "다른 계정 사용" 버튼 활용 | `ImprovedAuthenticationService.js` |
| **페이지 타입 감지** | 다양한 로그인 상태 자동 처리 | `ImprovedAuthenticationService.js` |

---

## 3. 휴먼라이크 마우스 움직임

### 파일 위치
`src/infrastructure/adapters/HumanLikeMouseHelper.js`

### 핵심 원리

**문제**: 봇은 마우스를 **직선**으로 이동 → Google이 감지
**해결**: **베지어 곡선**으로 자연스러운 곡선 경로 생성

### 베지어 곡선 공식

```javascript
// 3차 베지어 곡선: P(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
bezierCurve(t, start, control1, control2, end) {
  const u = 1 - t;
  return {
    x: u*u*u * start.x + 3*u*u*t * control1.x + 3*u*t*t * control2.x + t*t*t * end.x,
    y: u*u*u * start.y + 3*u*u*t * control1.y + 3*u*t*t * control2.y + t*t*t * end.y
  };
}
```

### 시각적 비교

```
봇 움직임 (직선):          사람 움직임 (곡선):

  A ──────────────> B       A ╭──────╮
                              ╰──────╯──> B
```

### 추가 인간화 기법

| 기법 | 설명 | 설정값 |
|------|------|--------|
| **손떨림 (Jitter)** | 이동 중 미세한 흔들림 추가 | ±3px |
| **가변 속도** | 시작/끝은 느리게, 중간은 빠르게 | slow/normal/fast |
| **미세 조정** | 도착 후 작은 움직임 | 30% 확률 |
| **짧은 정지** | 이동 중 잠시 멈춤 | 5% 확률 |

### 코드 예시

```javascript
// 초기화
const mouseHelper = new HumanLikeMouseHelper(page, {
  jitterAmount: 3,      // 손떨림 정도 (px)
  moveSpeed: 'normal',  // 이동 속도
  mouseMoveSteps: 20    // 이동 단계 수
});

// 사용
await mouseHelper.moveMouseHumanLike(targetX, targetY);
await mouseHelper.humanClick(x, y);
```

---

## 4. CDP 네이티브 입력

### 파일 위치
`src/infrastructure/adapters/CDPClickHelper.js`

### 핵심 원리

**문제**: `page.click()`은 Puppeteer API → 자동화로 탐지됨
**해결**: **Chrome DevTools Protocol (CDP)** 직접 사용 → 네이티브 이벤트 발생

### Puppeteer vs CDP 비교

```javascript
// ❌ Puppeteer 방식 (탐지됨)
await page.click('#button');

// ✅ CDP 방식 (탐지 어려움)
await cdpClient.send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: 100, y: 200,
  button: 'left',
  clickCount: 1
});
```

### CDP 클릭 시퀀스

```
1. mouseMoved    → 마우스 이동 (호버 효과)
2. [대기 300ms]  → 자연스러운 지연
3. mousePressed  → 버튼 누르기
4. [대기 50ms]   → 클릭 유지
5. mouseReleased → 버튼 떼기
```

### 코드 예시

```javascript
// 초기화
const cdpHelper = new CDPClickHelper(page, {
  naturalDelay: true,  // 자연스러운 지연 활성화
  verbose: false       // 디버그 로그
});
await cdpHelper.initialize();

// 사용
await cdpHelper.click('#submit-button');           // 셀렉터 기반
await cdpHelper.clickAtCoordinates(100, 200);      // 좌표 기반
await cdpHelper.clickByText(['확인', 'Confirm']);  // 텍스트 기반
```

---

## 5. 프록시 고정 매핑

### 파일 위치
`src/services/HashBasedProxyMappingService.js`

### 핵심 원리

**문제**: 동일 계정이 다른 IP로 로그인 → Google이 의심
**해결**: **계정별 프록시 고정** → 항상 동일 IP로 접속

### 해시 매핑 알고리즘

```javascript
// SHA-256 해시 → 프록시 인덱스 계산
const hash = crypto.createHash('sha256')
  .update(email.toLowerCase())
  .digest('hex');

const index = parseInt(hash.substring(0, 8), 16) % proxyCount;
// → 동일 이메일은 항상 동일 인덱스 반환
```

### 시각적 예시

```
계정 A (hash: 0x3F...) ──→ 프록시 #3 (gate.decodo.com:7003)
계정 B (hash: 0x7A...) ──→ 프록시 #7 (gate.decodo.com:7007)
계정 C (hash: 0x12...) ──→ 프록시 #1 (gate.decodo.com:7001)

⚠️ 계정 A는 항상 프록시 #3 사용 (해시값 고정)
```

### 폴백 계층

```
1순위: 해시 기반 고정 매핑 (HashProxyMapper)
   ↓ 실패
2순위: 시트에서 랜덤 선택 (ProxySheetRepository)
   ↓ 실패
3순위: 하드코딩 프록시 풀 (getRandomProxy)
```

### 코드 예시

```javascript
// 해시 기반 프록시 조회
const hashProxyMapper = container.resolve('hashProxyMapper');
const proxy = await hashProxyMapper.getProxyForAccount(email, 'kr');

// AdsPower에 프록시 설정
await adsPowerAdapter.updateProfile(profileId, {
  user_proxy_config: {
    proxy_soft: 'other',           // ⚠️ 항상 'other'
    proxy_type: 'socks5',
    proxy_host: proxy.proxy_host,
    proxy_port: String(proxy.proxy_port),  // ⚠️ 문자열 필수
    proxy_user: proxy.proxy_user,
    proxy_password: proxy.proxy_password
  }
});
```

---

## 6. 페이지 타입 감지 및 처리

### 파일 위치
`src/services/ImprovedAuthenticationService.js`

### 감지되는 페이지 타입 (20+)

| 타입 | 설명 | 처리 방법 |
|------|------|-----------|
| `adspower_start` | AdsPower 시작 페이지 | Google 로그인으로 이동 |
| `email_input` | 이메일 입력 페이지 | 이메일 입력 + Next 클릭 |
| `password_input` | 비밀번호 입력 페이지 | 비밀번호 입력 + Next 클릭 |
| `account_chooser` | 계정 선택 페이지 | 해당 계정 클릭 |
| `two_factor` | 2단계 인증 (TOTP) | TOTP 코드 입력 |
| `image_captcha` | 이미지 CAPTCHA | "다른 계정 사용"으로 우회 |
| `recaptcha` | reCAPTCHA | 에러 반환 (수동 처리 필요) |
| `logged_in` | 로그인 완료 | 성공 반환 |
| `logged_in_premium` | YouTube Premium 페이지 | 성공 반환 |
| `account_disabled` | 계정 사용 중지 | 에러 반환 |
| `browser_error` | 브라우저 오류 | 재시도 필요 |

### 상태 머신 흐름

```
┌─────────────┐
│ adspower_   │ ──→ accounts.google.com 이동
│ start       │
└─────────────┘
       ↓
┌─────────────┐     ┌─────────────┐
│ email_input │ ──→ │ password_   │
│             │     │ input       │
└─────────────┘     └─────────────┘
       ↑                   ↓
       │            ┌─────────────┐
       │            │ two_factor  │ (TOTP)
       │            └─────────────┘
       │                   ↓
       │            ┌─────────────┐
       └── 우회 ────│ image_      │
                    │ captcha     │
                    └─────────────┘
                           ↓
                    ┌─────────────┐
                    │ logged_in   │ ✅ 성공
                    └─────────────┘
```

### 코드 예시

```javascript
// 페이지 타입 감지
const pageType = await this.detectPageType(page);

switch (pageType) {
  case 'email_input':
    await this.handleEmailLogin(page, credentials);
    break;
  case 'password_input':
    await this.handlePasswordLogin(page, credentials);
    break;
  case 'image_captcha':
    await this.bypassCaptcha(page);
    break;
  // ...
}
```

---

## 7. CAPTCHA 우회 전략

### 이미지 CAPTCHA 우회

**전략**: Google 이미지 CAPTCHA 감지 시 → "다른 계정 사용" 버튼 클릭으로 우회

```javascript
case 'image_captcha':
  console.log('🖼️ 이미지 CAPTCHA 감지됨');

  // 1. 뒤로가기 (계정 선택 페이지로)
  await page.goBack({ waitUntil: 'networkidle2' });
  await delay(2000);

  // 2. "다른 계정 사용" 클릭
  const success = await this.clickUseAnotherAccount(page);

  if (success) {
    console.log('✅ CAPTCHA 우회 성공');
    continue;  // 이메일 입력 페이지로 이동
  }

  // 3. 실패 시 브라우저 재시작 권고
  return { error: 'IMAGE_CAPTCHA_DETECTED', shouldRetry: true };
```

### reCAPTCHA 처리

**전략**: 자동 해결 불가 → 명확한 에러 반환

```javascript
case 'recaptcha':
  return {
    success: false,
    error: 'RECAPTCHA_DETECTED',
    message: 'reCAPTCHA 인증 필요 - 수동 처리 필요',
    skipRetry: true  // 재시도 무의미
  };
```

### CAPTCHA 발생 감소 방법

| 방법 | 효과 |
|------|------|
| 프록시 고정 매핑 | IP 일관성 → 신뢰도 상승 |
| 휴먼라이크 마우스 | 봇 패턴 감소 |
| 자연스러운 타이핑 | 일정 속도 패턴 제거 |
| 24h Sticky 세션 | 프록시 IP 고정 |
| 적절한 대기 시간 | 급한 동작 패턴 제거 |

---

## 8. Stealth 브라우저 설정

### 파일 위치
- `src/infrastructure/adapters/StealthBrowserSetup.js` (전체 설정)
- `src/infrastructure/adapters/MinimalStealthSetup.js` (최소 설정)

### 주요 속성 변조

| 속성 | 원본 값 | 변조 값 |
|------|---------|---------|
| `navigator.webdriver` | `true` | `undefined` |
| `navigator.plugins` | `[]` | `[Chrome PDF Plugin, ...]` |
| `navigator.languages` | `['en-US']` | `['ko-KR', 'ko', 'en']` |
| `navigator.platform` | 다양 | `'Win32'` |
| `navigator.hardwareConcurrency` | 다양 | `8` |
| `navigator.deviceMemory` | 다양 | `8` |

### Chrome 객체 추가

```javascript
// 봇은 window.chrome이 없음 → 추가하여 위장
window.chrome = {
  runtime: {},
  loadTimes: function() {},
  csi: function() {},
  app: {}
};
```

### 최소 Stealth 설정 (권장)

```javascript
// ✅ 하는 것
await page.setExtraHTTPHeaders({
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
});

// ❌ 하지 않는 것 (오히려 탐지됨)
// - navigator.webdriver 수정 → 불일치 감지
// - Canvas/WebGL 수정 → Fingerprint 변조 감지
// - setUserAgent → AdsPower 설정과 충돌
```

---

## 9. 설정 및 활성화

### 환경변수 (.env)

```bash
# 휴먼라이크 인터랙션 활성화
HUMAN_LIKE_MOTION=true

# 인증 서비스 선택
USE_IMPROVED_AUTH=true

# 디버그 모드
DEBUG_MODE=false
```

### container.js 등록

```javascript
// 메인 인증 서비스
authService: asFunction(() => {
  return new ImprovedAuthenticationService({
    debugMode: config.debugMode,
    humanLikeMotion: config.humanLikeMotion !== false  // 기본 활성화
  });
}).singleton()

// 해시 프록시 매퍼
hashProxyMapper: asClass(HashBasedProxyMappingService).singleton()
```

### 통합 사용 예시

```javascript
// 1. 프록시 설정 (고정 매핑)
const proxy = await hashProxyMapper.getProxyForAccount(email, 'kr');
await adsPowerAdapter.closeBrowser(profileId);  // ⚠️ 기존 브라우저 종료 필수
await adsPowerAdapter.updateProfile(profileId, { user_proxy_config: proxy });

// 2. 브라우저 열기
const { browser, page } = await adsPowerAdapter.openBrowser(profileId);

// 3. 휴먼라이크 헬퍼 초기화
await authService.initializeHumanLikeHelpers(page);

// 4. 로그인 시도 (자동 페이지 타입 감지)
const result = await authService.attemptLogin(page, {
  email: 'user@example.com',
  password: 'password123',
  totpSecret: 'JBSWY3DPEHPK3PXP'  // 선택사항
});

// 5. 결과 처리
if (result.success) {
  console.log('로그인 성공');
} else {
  console.log(`로그인 실패: ${result.error}`);
}
```

---

## 요약

이 프로젝트의 로그인 자동화 우회 시스템은 **5개 계층**의 방어책을 우회합니다:

1. **프록시 고정 매핑**: 계정별 IP 일관성 유지
2. **Stealth 브라우저**: 자동화 감지 속성 제거/위장
3. **휴먼라이크 마우스**: 베지어 곡선 + 손떨림으로 인간 모방
4. **CDP 네이티브 입력**: Puppeteer API 우회
5. **지능적 페이지 처리**: CAPTCHA 자동 우회

이러한 다층적 접근으로 Google의 자동화 탐지 체계를 효과적으로 우회하면서도 안정적인 로그인 자동화를 구현합니다.
