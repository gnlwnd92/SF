# checkCurrentStatus() 클릭 방식 개선 설계 (v2.6)

> 작성일: 2025-12-27

## 문제 요약

### 발견된 버그

```
checkCurrentStatus() 단계에서 Manage 버튼 클릭 실패
→ findAndClickPauseButton() 단계에서는 동일 버튼 클릭 성공
```

### 근본 원인

| 단계 | 사용 메서드 | 반환값 | 성공 조건 | 결과 |
|------|------------|--------|-----------|------|
| checkCurrentStatus | `EnhancedButtonInteractionService.clickManageMembershipButton()` | `{ success, navigated }` | `result.clicked` | **실패** (undefined) |
| findAndClickPauseButton | 직접 `page.$()` + `element.click()` | `true/false` | `manageButtonClicked` | **성공** |

**핵심 버그**: `clickManageMembershipButton()`이 반환하는 객체에 `clicked` 속성이 없음!

## 해결 방안

### 선택: 방안 A - 직접 클릭 방식 채택

findAndClickPauseButton()에서 **이미 검증된** 직접 클릭 로직을 checkCurrentStatus()에 적용

### 추가 개선: 토글 문제 방지

Manage membership 버튼은 **토글** 방식:
- 패널 닫힘 → 클릭 → 패널 열림
- 패널 열림 → 클릭 → 패널 닫힘 (문제!)

**해결**: Resume/Pause 버튼이 이미 보이면 Manage 클릭 스킵

## 구현 상세

### 1. EnhancedPauseSubscriptionUseCase.checkCurrentStatus()

```javascript
// [v2.6] 직접 클릭 방식 (검증된 로직)
let manageButtonClicked = false;

// 방법 1: CSS 선택자로 버튼 찾기
const manageButtonSelectors = [
  'ytd-button-renderer button',
  'yt-button-shape button',
  'button',
  '[role="button"]'
];

for (const selector of manageButtonSelectors) {
  const buttons = await this.page.$$(selector);
  for (const btn of buttons) {
    const buttonText = await btn.evaluate(el => el.textContent);
    if (buttonText.includes('Manage membership') || buttonText.includes('멤버십 관리')) {
      await btn.click();
      manageButtonClicked = true;
      break;
    }
  }
}

// 방법 2: 폴백 - evaluate로 직접 찾기
if (!manageButtonClicked) {
  const clicked = await this.page.evaluate(() => {
    // ... 직접 DOM 검색 및 클릭
  });
}
```

### 2. 양쪽 UseCase에 선행 체크 추가

```javascript
// [v2.6] 먼저 Resume/Pause 버튼이 이미 보이는지 확인
const buttonsAlreadyVisible = await this.page.evaluate((langData) => {
  const buttons = document.querySelectorAll('button, [role="button"]');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    const hasPause = langData.buttons.pause?.some(p => text.includes(p));
    const hasResume = langData.buttons.resume?.some(r => text.includes(r));
    if (hasPause || hasResume) {
      return { visible: true, buttonText: text };
    }
  }
  return { visible: false };
}, lang);

if (buttonsAlreadyVisible.visible) {
  // Manage 클릭 스킵 (토글 방지)
} else {
  // Manage 클릭 실행
}
```

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `EnhancedPauseSubscriptionUseCase.js` | 직접 클릭 방식 적용 + 선행 체크 |
| `EnhancedResumeSubscriptionUseCase.js` | 선행 체크 추가 |

## 플로우 비교

### 변경 전

```
checkCurrentStatus()
  │
  └─ EnhancedButtonInteractionService.clickManageMembershipButton()
       │
       └─ FrameRecoveryService.clickAndWaitForNavigation()
            │
            └─ 반환: { success, navigated }  ← clicked 없음!
                 │
                 └─ result.clicked 체크 → undefined → 실패
```

### 변경 후

```
checkCurrentStatus()
  │
  ├─ 1. 선행 체크: Resume/Pause 버튼 이미 보임?
  │     │
  │     ├─ YES → Manage 클릭 스킵 (토글 방지)
  │     │
  │     └─ NO → 2. 직접 클릭 방식
  │
  └─ 2. 직접 클릭: page.$$() + element.click()
       │
       └─ manageButtonClicked = true → 성공!
```

## 테스트 시나리오

1. **이미 일시중지 상태** (Resume 버튼 보임)
   - 예상: "Resume/Pause 버튼 이미 표시됨 - Manage 클릭 스킵" 로그
   - 결과: isPaused = true → "일시중지, 이미완료"

2. **정상 활성 상태** (Pause 버튼 보임)
   - 예상: Manage 클릭 → 패널 확장 → Pause 버튼 클릭
   - 결과: 일시중지 성공

3. **패널 닫힌 상태**
   - 예상: Manage 클릭 성공 → 패널 열림 → 상태 확인
   - 결과: 정상 작동

## 커밋 정보

- **커밋**: `02d8374`
- **메시지**: fix(v2.6): Replace Frame Recovery click with direct click in checkCurrentStatus
