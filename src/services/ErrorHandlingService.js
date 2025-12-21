/**
 * ErrorHandlingService - 에러 발생 시 자동 스크린샷 및 상세 로깅
 * 
 * 주요 기능:
 * - 에러 발생 시 자동 스크린샷 캡처
 * - 구조화된 에러 로그 생성
 * - 브라우저 콘솔 로그 수집
 * - 네트워크 요청 기록
 * - 시스템 상태 정보 포함
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class ErrorHandlingService {
  constructor({ logger }) {
    this.logger = logger;
    this.screenshotDir = path.join(process.cwd(), 'screenshots', 'errors');
    this.logDir = path.join(process.cwd(), 'logs', 'errors');
    this.ensureDirectories();
  }

  /**
   * 디렉토리 생성 보장
   */
  async ensureDirectories() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('디렉토리 생성 실패:', error);
    }
  }

  /**
   * 에러 발생 시 자동 처리
   */
  async handleError(error, context = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const errorId = `error-${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(chalk.red.bold('\n🚨 에러 발생 - 자동 디버깅 정보 수집 중...'));
    
    // 에러 정보 구조화
    const errorInfo = {
      id: errorId,
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code
      },
      context: {
        ...context,
        profile: context.profile || 'unknown',
        workflow: context.workflow || 'unknown',
        step: context.step || 'unknown',
        url: context.url || 'unknown'
      },
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    // 브라우저 페이지가 있는 경우 추가 정보 수집
    if (context.page && !context.page.isClosed()) {
      try {
        // 스크린샷 캡처
        const screenshotPath = await this.captureScreenshot(context.page, errorId);
        errorInfo.screenshot = screenshotPath;
        
        // 페이지 정보 수집
        errorInfo.pageInfo = await this.collectPageInfo(context.page);
        
        // 콘솔 로그 수집
        errorInfo.consoleLogs = context.consoleLogs || [];
        
        // 네트워크 로그 수집
        errorInfo.networkLogs = context.networkLogs || [];
        
      } catch (captureError) {
        console.error(chalk.yellow('추가 정보 수집 중 오류:'), captureError.message);
        errorInfo.captureError = captureError.message;
      }
    }

    // 에러 로그 파일 저장
    const logFilePath = path.join(this.logDir, `${errorId}.json`);
    await this.saveErrorLog(logFilePath, errorInfo);
    
    // 콘솔에 요약 출력
    this.printErrorSummary(errorInfo);
    
    // 로거에 기록
    this.logger.error('Error captured', errorInfo);
    
    return errorInfo;
  }

  /**
   * 스크린샷 캡처
   */
  async captureScreenshot(page, errorId) {
    try {
      const screenshotPath = path.join(this.screenshotDir, `${errorId}.png`);
      
      // 전체 페이지 스크린샷
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      
      // 뷰포트 스크린샷 (현재 보이는 영역)
      const viewportPath = path.join(this.screenshotDir, `${errorId}-viewport.png`);
      await page.screenshot({
        path: viewportPath,
        fullPage: false
      });
      
      console.log(chalk.green(`✅ 스크린샷 저장: ${screenshotPath}`));
      
      return {
        fullPage: screenshotPath,
        viewport: viewportPath
      };
    } catch (error) {
      console.error(chalk.red('스크린샷 캡처 실패:'), error.message);
      return null;
    }
  }

  /**
   * 페이지 정보 수집
   */
  async collectPageInfo(page) {
    try {
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          documentHeight: document.documentElement.scrollHeight,
          documentWidth: document.documentElement.scrollWidth,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          scrollPosition: {
            x: window.pageXOffset,
            y: window.pageYOffset
          },
          // 현재 포커스된 요소
          activeElement: {
            tagName: document.activeElement?.tagName,
            id: document.activeElement?.id,
            className: document.activeElement?.className,
            value: document.activeElement?.value
          },
          // 에러 관련 요소 찾기
          errorElements: Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [id*="error"], [id*="Error"]'))
            .slice(0, 5)
            .map(el => ({
              tagName: el.tagName,
              id: el.id,
              className: el.className,
              text: el.textContent?.substring(0, 100)
            })),
          // 모달/다이얼로그 확인
          hasModal: document.querySelector('[role="dialog"], .modal, .dialog, .popup') !== null,
          // 폼 정보
          forms: Array.from(document.querySelectorAll('form')).map(form => ({
            id: form.id,
            action: form.action,
            method: form.method,
            fields: Array.from(form.elements).length
          }))
        };
      });

      // HTML 스냅샷 저장 (디버깅용)
      const htmlContent = await page.content();
      const htmlPath = path.join(this.screenshotDir, `${pageInfo.url.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.html`);
      await fs.writeFile(htmlPath, htmlContent, 'utf-8');
      pageInfo.htmlSnapshot = htmlPath;

      return pageInfo;
    } catch (error) {
      console.error(chalk.yellow('페이지 정보 수집 실패:'), error.message);
      return { error: error.message };
    }
  }

  /**
   * 에러 로그 저장
   */
  async saveErrorLog(filePath, errorInfo) {
    try {
      await fs.writeFile(filePath, JSON.stringify(errorInfo, null, 2), 'utf-8');
      console.log(chalk.green(`✅ 에러 로그 저장: ${filePath}`));
      
      // 최근 에러 로그 업데이트
      const recentErrorsPath = path.join(this.logDir, 'recent-errors.json');
      let recentErrors = [];
      
      try {
        const existing = await fs.readFile(recentErrorsPath, 'utf-8');
        recentErrors = JSON.parse(existing);
      } catch {
        // 파일이 없으면 새로 생성
      }
      
      // 최근 10개만 유지
      recentErrors.unshift({
        id: errorInfo.id,
        timestamp: errorInfo.timestamp,
        message: errorInfo.error.message,
        context: errorInfo.context,
        logFile: filePath
      });
      recentErrors = recentErrors.slice(0, 10);
      
      await fs.writeFile(recentErrorsPath, JSON.stringify(recentErrors, null, 2), 'utf-8');
      
    } catch (error) {
      console.error(chalk.red('로그 저장 실패:'), error.message);
    }
  }

  /**
   * 에러 요약 출력
   */
  printErrorSummary(errorInfo) {
    console.log(chalk.red.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.red.bold('📋 에러 요약'));
    console.log(chalk.red.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    
    console.log(chalk.yellow('에러 ID:'), errorInfo.id);
    console.log(chalk.yellow('시간:'), errorInfo.timestamp);
    console.log(chalk.yellow('메시지:'), errorInfo.error.message);
    console.log(chalk.yellow('워크플로우:'), errorInfo.context.workflow);
    console.log(chalk.yellow('단계:'), errorInfo.context.step);
    console.log(chalk.yellow('프로필:'), errorInfo.context.profile);
    
    if (errorInfo.screenshot) {
      console.log(chalk.green('\n📸 스크린샷:'));
      console.log('  - 전체:', errorInfo.screenshot.fullPage);
      console.log('  - 뷰포트:', errorInfo.screenshot.viewport);
    }
    
    if (errorInfo.pageInfo) {
      console.log(chalk.cyan('\n📄 페이지 정보:'));
      console.log('  - URL:', errorInfo.pageInfo.url);
      console.log('  - 제목:', errorInfo.pageInfo.title);
      console.log('  - 상태:', errorInfo.pageInfo.readyState);
      
      if (errorInfo.pageInfo.errorElements?.length > 0) {
        console.log(chalk.red('\n⚠️ 에러 요소 감지:'));
        errorInfo.pageInfo.errorElements.forEach(el => {
          console.log(`  - ${el.tagName}: ${el.text?.substring(0, 50)}...`);
        });
      }
    }
    
    console.log(chalk.red.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    
    // 디버깅 팁 제공
    console.log(chalk.cyan('💡 디버깅 팁:'));
    console.log(`  1. 스크린샷 확인: ${this.screenshotDir}`);
    console.log(`  2. 상세 로그 확인: ${path.join(this.logDir, `${errorInfo.id}.json`)}`);
    console.log(`  3. HTML 스냅샷 확인: ${errorInfo.pageInfo?.htmlSnapshot || 'N/A'}`);
    console.log(`  4. 최근 에러 목록: ${path.join(this.logDir, 'recent-errors.json')}\n`);
  }

  /**
   * 브라우저 콘솔 로그 수집 설정
   */
  setupConsoleLogging(page) {
    const consoleLogs = [];
    
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString()
      });
      
      // 에러 레벨 로그는 즉시 출력 (동영상 스트리밍 에러 제외)
      if (msg.type() === 'error') {
        const text = msg.text();
        // googlevideo.com 관련 에러는 무시 (동영상 스트리밍 403은 정상적인 동작)
        if (!text.includes('googlevideo.com') && !text.includes('videoplayback')) {
          console.log(chalk.red(`[Browser Console Error] ${text}`));
        }
      }
    });
    
    page.on('pageerror', error => {
      consoleLogs.push({
        type: 'pageerror',
        text: error.toString(),
        timestamp: new Date().toISOString()
      });
      console.log(chalk.red(`[Page Error] ${error}`));
    });
    
    return consoleLogs;
  }

  /**
   * 네트워크 로그 수집 설정
   */
  setupNetworkLogging(page) {
    const networkLogs = [];
    
    page.on('requestfailed', request => {
      const url = request.url();
      networkLogs.push({
        type: 'failed',
        url: url,
        method: request.method(),
        errorText: request.failure()?.errorText,
        timestamp: new Date().toISOString()
      });
      // googlevideo.com 관련 실패는 무시 (동영상 스트리밍 403은 정상)
      if (!url.includes('googlevideo.com') && !url.includes('videoplayback')) {
        console.log(chalk.red(`[Network Failed] ${request.method()} ${url}`));
      }
    });
    
    page.on('response', response => {
      if (response.status() >= 400) {
        const url = response.url();
        networkLogs.push({
          type: 'error',
          url: url,
          status: response.status(),
          statusText: response.statusText(),
          timestamp: new Date().toISOString()
        });
        // googlevideo.com 관련 403 에러는 무시 (동영상 스트리밍 정상 동작)
        if (!url.includes('googlevideo.com') && !url.includes('videoplayback')) {
          console.log(chalk.yellow(`[HTTP ${response.status()}] ${url}`));
        }
      }
    });
    
    return networkLogs;
  }
}

module.exports = ErrorHandlingService;