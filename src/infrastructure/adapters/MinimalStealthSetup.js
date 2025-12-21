/**
 * Minimal Stealth Setup
 * Google 자동화 감지를 피하기 위한 최소한의 설정만 적용
 * 
 * 핵심 원칙:
 * 1. evaluateOnNewDocument 사용 금지
 * 2. 브라우저 속성 수정 최소화
 * 3. AdsPower의 기본 설정 유지
 */

/**
 * 최소한의 Stealth 설정 적용
 * @param {Page} page - Puppeteer 페이지 객체
 */
async function setupMinimalStealth(page) {
  try {
    // 1. 기본 HTTP 헤더만 설정 (과도한 수정 없음)
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    
    // 2. 타임아웃 설정 (네트워크 안정성)
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(30000);
    
    // 3. 에러 처리
    page.on('error', err => {
      console.error('Page error:', err.message);
    });
    
    page.on('pageerror', err => {
      console.error('Page script error:', err.message);
    });
    
    // 중요: 다음 항목들은 의도적으로 하지 않음
    // ❌ evaluateOnNewDocument - Google이 감지함
    // ❌ navigator.webdriver 수정 - 오히려 의심받음
    // ❌ Chrome 속성 추가 - 불일치 감지됨
    // ❌ Canvas/WebGL 수정 - Fingerprint 변조 감지됨
    // ❌ setUserAgent - AdsPower 설정과 충돌
    // ❌ setViewport - AdsPower 설정 유지
    
    return true;
  } catch (error) {
    console.error('Minimal stealth setup error:', error);
    return false;
  }
}

/**
 * CDP를 통한 네이티브 클릭 (Puppeteer 클릭 대신 사용)
 */
async function performNativeClick(page, x, y) {
  const client = await page.target().createCDPSession();
  
  // 마우스 이동
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: x,
    y: y
  });
  
  // 약간의 지연 (자연스러운 동작)
  await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
  
  // 마우스 클릭
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: x,
    y: y,
    button: 'left',
    clickCount: 1
  });
  
  await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
  
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x,
    y: y,
    button: 'left',
    clickCount: 1
  });
  
  await client.detach();
}

/**
 * CDP를 통한 네이티브 타이핑 (Puppeteer type 대신 사용)
 */
async function performNativeType(page, text) {
  const client = await page.target().createCDPSession();
  
  for (const char of text) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
      key: char
    });
    
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      text: char,
      key: char
    });
  }
  
  await client.detach();
}

/**
 * 페이지 로드 대기 (자동화 감지 최소화)
 */
async function waitForPageLoad(page, options = {}) {
  const {
    timeout = 30000,
    waitForSelector = null
  } = options;
  
  try {
    // 네트워크 안정화 대기 (Puppeteer 방식)
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeout / 2 }).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, Math.min(3000, timeout / 2)))
    ]);
    
    // 선택자가 있으면 대기
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, {
        visible: true,
        timeout: timeout / 2
      });
    }
    
    // 약간의 추가 대기 (페이지 안정화)
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    
    return true;
  } catch (error) {
    console.warn('Page load wait timeout, continuing anyway');
    return false;
  }
}

/**
 * 자동화 감지 신호 체크 (디버깅용)
 */
async function checkAutomationSignals(page) {
  try {
    const signals = await page.evaluate(() => {
      return {
        // 주요 감지 신호들
        webdriver: navigator.webdriver,
        headless: navigator.userAgent.includes('HeadlessChrome'),
        chrome: !!window.chrome,
        chromeRuntime: !!window.chrome?.runtime,
        
        // CDP 관련
        cdpDetected: !!window.__puppeteer_evaluation_script__,
        
        // 권한 API
        permissions: typeof navigator.permissions?.query,
        
        // 플러그인
        pluginsLength: navigator.plugins.length,
        
        // 언어
        languages: navigator.languages.join(','),
        
        // 플랫폼
        platform: navigator.platform,
        
        // User Agent
        userAgent: navigator.userAgent
      };
    });
    
    // 위험 신호 분석
    const risks = [];
    if (signals.webdriver === true) risks.push('webdriver is true');
    if (signals.headless) risks.push('Headless Chrome detected');
    if (!signals.chrome) risks.push('No chrome object');
    if (!signals.chromeRuntime) risks.push('No chrome.runtime');
    if (signals.cdpDetected) risks.push('CDP script detected');
    if (signals.pluginsLength === 0) risks.push('No plugins');
    
    return {
      signals,
      risks,
      riskLevel: risks.length === 0 ? 'LOW' : risks.length <= 2 ? 'MEDIUM' : 'HIGH'
    };
  } catch (error) {
    console.error('Failed to check automation signals:', error);
    return null;
  }
}

module.exports = {
  setupMinimalStealth,
  performNativeClick,
  performNativeType,
  waitForPageLoad,
  checkAutomationSignals
};