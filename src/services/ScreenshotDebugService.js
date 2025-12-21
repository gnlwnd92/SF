/**
 * ScreenshotDebugService - 디버깅을 위한 스크린샷 캡처 서비스
 * 
 * 각 단계별로 스크린샷을 저장하고 페이지 상태를 로그에 기록
 * 타임스탬프와 단계 정보를 포함한 파일명으로 저장
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class ScreenshotDebugService {
  constructor(config = {}) {
    this.config = {
      screenshotPath: config.screenshotPath || path.join(process.cwd(), 'screenshots', 'debug'),
      enableAutoCapture: config.enableAutoCapture !== false,
      captureOnError: config.captureOnError !== false,
      includeFullPage: config.includeFullPage || false,
      logPageInfo: config.logPageInfo !== false,
      ...config
    };
    
    // 스크린샷 저장 디렉토리 생성
    this.ensureDirectoryExists();
    
    // 현재 세션 ID (타임스탬프 기반)
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    this.stepCounter = 0;
  }

  /**
   * 디렉토리 존재 확인 및 생성
   */
  ensureDirectoryExists() {
    const dirs = [
      this.config.screenshotPath,
      path.join(this.config.screenshotPath, 'family-check'),
      path.join(this.config.screenshotPath, 'errors'),
      path.join(this.config.screenshotPath, 'login'),
      path.join(this.config.screenshotPath, 'navigation')
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 스크린샷 캡처 및 페이지 정보 로깅
   */
  async captureDebugScreenshot(page, context = {}) {
    try {
      const {
        step = 'unknown',
        category = 'general',
        profileName = 'unknown',
        description = '',
        includePageInfo = true
      } = context;
      
      this.stepCounter++;
      
      // 페이지 정보 수집
      const pageInfo = await this.collectPageInfo(page);
      
      // 스크린샷 파일명 생성
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileName = `${this.sessionId}_${String(this.stepCounter).padStart(3, '0')}_${step}_${timestamp}.png`;
      const filePath = path.join(this.config.screenshotPath, category, fileName);
      
      // 스크린샷 캡처
      const screenshotOptions = {
        path: filePath,
        fullPage: this.config.includeFullPage
      };
      
      await page.screenshot(screenshotOptions);
      
      // 로그 출력
      this.logCaptureInfo({
        step,
        category,
        profileName,
        description,
        fileName,
        pageInfo,
        timestamp
      });
      
      // 페이지 정보를 별도 JSON 파일로 저장
      if (includePageInfo) {
        const infoPath = filePath.replace('.png', '_info.json');
        fs.writeFileSync(infoPath, JSON.stringify({
          ...pageInfo,
          context,
          timestamp,
          sessionId: this.sessionId,
          stepNumber: this.stepCounter
        }, null, 2));
      }
      
      return {
        success: true,
        filePath,
        fileName,
        pageInfo
      };
      
    } catch (error) {
      console.error(chalk.red(`[ScreenshotDebug] 캡처 실패: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 페이지 정보 수집
   */
  async collectPageInfo(page) {
    try {
      const info = await page.evaluate(() => {
        // 페이지 기본 정보
        const basicInfo = {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          referrer: document.referrer,
          hostname: window.location.hostname,
          pathname: window.location.pathname,
          search: window.location.search
        };
        
        // 중요 요소 존재 여부
        const elements = {
          // Google 로그인 관련
          hasGoogleSignIn: !!document.querySelector('[data-identifier]'),
          hasEmailInput: !!document.querySelector('input[type="email"]'),
          hasPasswordInput: !!document.querySelector('input[type="password"]'),
          hasNextButton: !!document.querySelector('#identifierNext, #passwordNext'),
          
          // YouTube Premium 관련
          hasManageButton: !!document.querySelector('button[aria-label*="Manage"], button:has-text("Manage")'),
          hasPauseButton: !!document.querySelector('button[aria-label*="Pause"], button:has-text("Pause")'),
          hasResumeButton: !!document.querySelector('button[aria-label*="Resume"], button:has-text("Resume")'),
          hasFamilyPlan: !!document.querySelector('[aria-label*="Family"], *:has-text("Family")'),
          
          // 에러 메시지
          hasError: !!document.querySelector('[aria-live="assertive"], .error-message, [role="alert"]'),
          errorText: document.querySelector('[aria-live="assertive"], .error-message, [role="alert"]')?.textContent?.trim()
        };
        
        // 버튼 텍스트 수집
        const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
          text: btn.textContent?.trim(),
          ariaLabel: btn.getAttribute('aria-label'),
          disabled: btn.disabled,
          visible: btn.offsetParent !== null
        })).filter(btn => btn.text || btn.ariaLabel);
        
        // 언어 감지
        const language = document.documentElement.lang || 
                        document.querySelector('html')?.getAttribute('lang') || 
                        'unknown';
        
        return {
          ...basicInfo,
          elements,
          buttonCount: buttons.length,
          buttons: buttons.slice(0, 10), // 처음 10개만
          language,
          bodyText: document.body.textContent?.slice(0, 500) // 처음 500자
        };
      });
      
      return info;
    } catch (error) {
      return {
        error: `페이지 정보 수집 실패: ${error.message}`
      };
    }
  }

  /**
   * 캡처 정보 로깅
   */
  logCaptureInfo(info) {
    const {
      step,
      category,
      profileName,
      description,
      fileName,
      pageInfo,
      timestamp
    } = info;
    
    console.log(chalk.blue('╔════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║') + chalk.yellow.bold(' 📸 스크린샷 캡처 ') + chalk.blue('║'));
    console.log(chalk.blue('╠════════════════════════════════════════════════════════════════╣'));
    
    console.log(chalk.blue('║') + chalk.white(` 단계: ${step.padEnd(57)}`) + chalk.blue('║'));
    console.log(chalk.blue('║') + chalk.white(` 카테고리: ${category.padEnd(53)}`) + chalk.blue('║'));
    console.log(chalk.blue('║') + chalk.white(` 프로필: ${profileName.padEnd(55)}`) + chalk.blue('║'));
    
    if (description) {
      console.log(chalk.blue('║') + chalk.gray(` 설명: ${description.padEnd(57)}`) + chalk.blue('║'));
    }
    
    console.log(chalk.blue('║') + chalk.green(` 파일: ${fileName.padEnd(57)}`) + chalk.blue('║'));
    
    // 페이지 정보 출력
    if (pageInfo && !pageInfo.error) {
      console.log(chalk.blue('╠════════════════════════════════════════════════════════════════╣'));
      console.log(chalk.blue('║') + chalk.cyan(' 📄 페이지 정보:'.padEnd(64)) + chalk.blue('║'));
      console.log(chalk.blue('║') + chalk.white(` URL: ${(pageInfo.url || 'N/A').slice(0, 57).padEnd(58)}`) + chalk.blue('║'));
      console.log(chalk.blue('║') + chalk.white(` 제목: ${(pageInfo.title || 'N/A').slice(0, 56).padEnd(57)}`) + chalk.blue('║'));
      console.log(chalk.blue('║') + chalk.white(` 언어: ${(pageInfo.language || 'N/A').padEnd(57)}`) + chalk.blue('║'));
      
      // 중요 요소 상태
      if (pageInfo.elements) {
        const e = pageInfo.elements;
        if (e.hasGoogleSignIn || e.hasEmailInput || e.hasPasswordInput) {
          console.log(chalk.blue('║') + chalk.yellow(` ⚠️ Google 로그인 페이지 감지`.padEnd(71)) + chalk.blue('║'));
        }
        if (e.hasManageButton || e.hasPauseButton || e.hasResumeButton) {
          console.log(chalk.blue('║') + chalk.green(` ✓ YouTube Premium 관리 버튼 감지`.padEnd(71)) + chalk.blue('║'));
        }
        if (e.hasFamilyPlan) {
          console.log(chalk.blue('║') + chalk.magenta(` 👨‍👩‍👧‍👦 가족 요금제 감지`.padEnd(71)) + chalk.blue('║'));
        }
        if (e.hasError) {
          console.log(chalk.blue('║') + chalk.red(` ❌ 에러: ${(e.errorText || 'Unknown error').slice(0, 50).padEnd(51)}`) + chalk.blue('║'));
        }
      }
      
      // 버튼 정보
      if (pageInfo.buttonCount > 0) {
        console.log(chalk.blue('║') + chalk.white(` 버튼 수: ${String(pageInfo.buttonCount).padEnd(53)}`) + chalk.blue('║'));
        if (pageInfo.buttons && pageInfo.buttons.length > 0) {
          console.log(chalk.blue('║') + chalk.gray(' 주요 버튼:'.padEnd(64)) + chalk.blue('║'));
          pageInfo.buttons.slice(0, 3).forEach(btn => {
            const btnText = (btn.text || btn.ariaLabel || 'Unknown').slice(0, 50);
            const status = btn.disabled ? '(비활성)' : '(활성)';
            console.log(chalk.blue('║') + chalk.gray(`   - ${btnText} ${status}`.padEnd(62)) + chalk.blue('║'));
          });
        }
      }
    }
    
    console.log(chalk.blue('║') + chalk.gray(` 시간: ${timestamp.padEnd(57)}`) + chalk.blue('║'));
    console.log(chalk.blue('╚════════════════════════════════════════════════════════════════╝'));
  }

  /**
   * 에러 발생 시 자동 캡처
   */
  async captureError(page, error, context = {}) {
    if (!this.config.captureOnError) return;
    
    return await this.captureDebugScreenshot(page, {
      ...context,
      step: `error_${context.step || 'unknown'}`,
      category: 'errors',
      description: error.message || error
    });
  }

  /**
   * 비교 스크린샷 (이전/이후)
   */
  async captureBeforeAfter(page, action, context = {}) {
    const results = {};
    
    // Before 캡처
    results.before = await this.captureDebugScreenshot(page, {
      ...context,
      step: `before_${action}`,
      description: `Before ${action}`
    });
    
    return {
      getAfter: async () => {
        // After 캡처
        results.after = await this.captureDebugScreenshot(page, {
          ...context,
          step: `after_${action}`,
          description: `After ${action}`
        });
        return results;
      }
    };
  }

  /**
   * 세션 요약 생성
   */
  generateSessionSummary() {
    const summaryPath = path.join(this.config.screenshotPath, `session_${this.sessionId}_summary.json`);
    const summary = {
      sessionId: this.sessionId,
      totalSteps: this.stepCounter,
      timestamp: new Date().toISOString(),
      screenshotPath: this.config.screenshotPath
    };
    
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log(chalk.green(`\n📋 세션 요약 저장: ${summaryPath}`));
    console.log(chalk.yellow(`   총 ${this.stepCounter}개 스크린샷 캡처`));
    
    return summary;
  }

  /**
   * 디버그 모드 상태 확인
   */
  isDebugMode() {
    return this.config.enableAutoCapture;
  }

  /**
   * 스크린샷 경로 가져오기
   */
  getScreenshotPath() {
    return this.config.screenshotPath;
  }
}

module.exports = ScreenshotDebugService;