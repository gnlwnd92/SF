/**
 * 수정된 재개 버튼 클릭 메서드
 * 멤버십 관리 버튼 클릭 후 페이지 내용에서 재개 버튼을 찾는 방식
 */

async clickResumeButton() {
  const lang = languages[this.currentLanguage];
  
  this.log('재개 버튼 탐색 시작', 'info');
  
  // Step 1: 멤버십 관리 버튼 클릭 (이미 clickManageButton에서 처리됨)
  // 멤버십 관리 버튼 클릭 시 페이지 내용이 변경됨
  
  // Step 2: 페이지가 업데이트될 때까지 잠시 대기
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 3: 페이지 내에서 재개 관련 요소 찾기
  this.log('페이지 내에서 재개 요소 탐색', 'info');
  
  const resumeInfo = await this.page.evaluate((resumeTexts) => {
    const result = {
      found: false,
      element: null,
      text: null,
      type: null
    };
    
    // 모든 텍스트 요소 확인
    const allElements = document.querySelectorAll('*');
    
    for (const el of allElements) {
      const text = el.textContent?.trim();
      
      // "멤버십 재개" 텍스트를 포함하는 요소 찾기
      if (text && (text.includes('멤버십 재개') || text.includes('Resume membership'))) {
        // 해당 요소의 자식 요소 중 클릭 가능한 버튼/링크 찾기
        const clickableElements = el.querySelectorAll('button, a, [role="button"], [role="link"]');
        
        for (const clickable of clickableElements) {
          const clickableText = clickable.textContent?.trim();
          
          // 재개 버튼 찾기
          if (clickableText && resumeTexts.some(resumeText => 
            clickableText === resumeText || clickableText.includes(resumeText)
          )) {
            result.found = true;
            result.text = clickableText;
            result.type = clickable.tagName.toLowerCase();
            
            // 클릭
            if (clickable.offsetHeight > 0) {
              clickable.click();
              return result;
            }
          }
        }
        
        // 재개 텍스트가 있는 요소 자체가 클릭 가능한 경우
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || 
            el.getAttribute('role') === 'button' || el.style.cursor === 'pointer') {
          
          // "재개" 텍스트만 있는 버튼 찾기
          if (resumeTexts.some(resumeText => text === resumeText)) {
            result.found = true;
            result.text = text;
            result.type = el.tagName.toLowerCase();
            
            if (el.offsetHeight > 0) {
              el.click();
              return result;
            }
          }
        }
      }
      
      // 단독 "재개" 버튼 찾기
      if (text && resumeTexts.some(resumeText => text === resumeText)) {
        if (el.tagName === 'BUTTON' || el.tagName === 'A' || 
            el.getAttribute('role') === 'button') {
          
          result.found = true;
          result.text = text;
          result.type = el.tagName.toLowerCase();
          
          if (el.offsetHeight > 0) {
            el.click();
            return result;
          }
        }
      }
    }
    
    // 찾지 못한 경우 더 넓은 검색
    if (!result.found) {
      // 모든 버튼과 링크 확인
      const buttons = document.querySelectorAll('button, a[role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && resumeTexts.some(resumeText => 
          btnText === resumeText || btnText.includes(resumeText)
        )) {
          if (btn.offsetHeight > 0) {
            btn.click();
            result.found = true;
            result.text = btnText;
            result.type = btn.tagName.toLowerCase();
            return result;
          }
        }
      }
    }
    
    return result;
  }, lang.buttons.resume);
  
  if (resumeInfo.found) {
    this.log(`재개 버튼 클릭 성공: "${resumeInfo.text}" (${resumeInfo.type})`, 'success');
    await new Promise(r => setTimeout(r, 3000));
    return true;
  }
  
  // Step 4: 재개 버튼을 찾지 못한 경우 스크롤 시도
  this.log('재개 버튼을 찾지 못함. 페이지 스크롤 시도', 'warning');
  
  await this.page.evaluate(() => {
    window.scrollBy(0, 300);
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  // 스크롤 후 다시 시도
  const resumeInfoAfterScroll = await this.page.evaluate((resumeTexts) => {
    const buttons = document.querySelectorAll('button, a[role="button"]');
    for (const btn of buttons) {
      const btnText = btn.textContent?.trim();
      if (btnText && resumeTexts.some(resumeText => 
        btnText === resumeText || btnText.includes(resumeText)
      )) {
        if (btn.offsetHeight > 0) {
          btn.click();
          return {
            found: true,
            text: btnText
          };
        }
      }
    }
    return { found: false };
  }, lang.buttons.resume);
  
  if (resumeInfoAfterScroll.found) {
    this.log(`스크롤 후 재개 버튼 클릭 성공: "${resumeInfoAfterScroll.text}"`, 'success');
    await new Promise(r => setTimeout(r, 3000));
    return true;
  }
  
  this.log('재개 버튼을 찾을 수 없습니다', 'error');
  return false;
}