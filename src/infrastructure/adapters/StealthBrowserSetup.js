/**
 * Stealth Browser Setup
 * Puppeteer Stealth 플러그인을 적용하여 자동화 감지를 우회
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Stealth 플러그인 설정
puppeteer.use(StealthPlugin());

/**
 * Stealth 모드로 브라우저 페이지 설정
 */
async function setupStealthPage(page) {
  try {
    // 중요: AdsPower가 이미 설정한 User-Agent와 뷰포트를 변경하지 않음
    // AdsPower의 anti-fingerprinting 기능을 유지하기 위해 브라우저 설정 보존

    // WebDriver 속성 제거
    await page.evaluateOnNewDocument(() => {
      // navigator.webdriver 제거
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Chrome 속성 추가
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };

      // Permission 덮어쓰기
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Plugin 배열 수정
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {
              type: "application/x-google-chrome-pdf",
              suffixes: "pdf",
              description: "Portable Document Format",
              enabledPlugin: Plugin
            },
            description: "Portable Document Format",
            filename: "internal-pdf-viewer",
            length: 1,
            name: "Chrome PDF Plugin"
          },
          {
            0: {
              type: "application/pdf",
              suffixes: "pdf",
              description: "",
              enabledPlugin: Plugin
            },
            description: "",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            length: 1,
            name: "Chrome PDF Viewer"
          },
          {
            0: {
              type: "application/x-nacl",
              suffixes: "",
              description: "Native Client Executable",
              enabledPlugin: Plugin
            },
            1: {
              type: "application/x-pnacl",
              suffixes: "",
              description: "Portable Native Client Executable",
              enabledPlugin: Plugin
            },
            description: "",
            filename: "internal-nacl-plugin",
            length: 2,
            name: "Native Client"
          }
        ],
      });

      // Languages 수정
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en'],
      });

      // Platform 수정
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
      });

      // Hardware concurrency 수정
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });

      // Device memory 수정
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    });

    // WebGL Vendor 수정
    await page.evaluateOnNewDocument(() => {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return getParameter.apply(this, arguments);
      };
    });

    // Canvas Fingerprint 방지
    await page.evaluateOnNewDocument(() => {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png' && this.width === 280 && this.height === 60) {
          return "data:image/png;base64,";
        }
        return originalToDataURL.apply(this, arguments);
      };
    });

    // Console 메시지 제거 (자동화 감지 회피)
    await page.evaluateOnNewDocument(() => {
      const originalConsole = window.console;
      window.console = new Proxy(originalConsole, {
        get(target, prop) {
          if (prop === 'debug') {
            return () => {};
          }
          return target[prop];
        }
      });
    });

    // 추가 헤더 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    });

    // CDP 세션을 통한 추가 설정
    const client = await page.target().createCDPSession();
    
    // 자동화 플래그 제거
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        Object.defineProperty(window, 'navigator', {
          value: new Proxy(navigator, {
            has: (target, key) => {
              if (key === 'webdriver') {
                return false;
              }
              return key in target;
            },
            get: (target, key) => {
              if (key === 'webdriver') {
                return undefined;
              }
              return typeof target[key] === 'function' 
                ? target[key].bind(target)
                : target[key];
            }
          })
        });
      `
    });

    // 브라우저 자동화 감지 무력화
    await client.send('Runtime.enable');
    await client.send('Runtime.addBinding', {
      name: 'windowLoaded'
    });

    console.log('✅ Stealth 모드 설정 완료');
    return true;

  } catch (error) {
    console.error('⚠️ Stealth 설정 중 오류:', error.message);
    return false;
  }
}

/**
 * 추가적인 자동화 감지 우회 기법
 */
async function applyAdvancedEvasion(page) {
  try {
    // 마우스 움직임 시뮬레이션
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 200);
    
    // 스크롤 이벤트 시뮬레이션
    await page.evaluate(() => {
      window.scrollTo(0, 100);
      window.scrollTo(0, 0);
    });

    // 키보드 포커스 이벤트
    await page.evaluate(() => {
      document.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });

    return true;
  } catch (error) {
    console.error('⚠️ 고급 회피 기법 적용 실패:', error.message);
    return false;
  }
}

module.exports = {
  setupStealthPage,
  applyAdvancedEvasion,
  puppeteer
};