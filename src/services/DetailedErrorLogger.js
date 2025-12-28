/**
 * DetailedErrorLogger - 상세한 에러 로깅 서비스
 * 실패 시 페이지 상태, 단계, 원인을 상세히 기록
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class DetailedErrorLogger {
  constructor() {
    this.currentStep = null;
    this.stepHistory = [];
    this.errorContext = {};
    this.screenshotDir = path.join(process.cwd(), 'logs', 'error-screenshots');
    this.htmlSnapshotDir = path.join(process.cwd(), 'logs', 'html-snapshots');
  }

  /**
   * 초기화
   */
  async initialize() {
    await fs.mkdir(this.screenshotDir, { recursive: true });
    await fs.mkdir(this.htmlSnapshotDir, { recursive: true });
  }

  /**
   * 새로운 단계 시작
   */
  startStep(stepName, details = {}) {
    const timestamp = new Date().toISOString();
    const step = {
      name: stepName,
      startTime: timestamp,
      details,
      status: 'in_progress'
    };
    
    this.currentStep = step;
    this.stepHistory.push(step);
    
    console.log(chalk.blue(`📍 [${timestamp.slice(11, 19)}] 단계 시작: ${stepName}`));
    if (Object.keys(details).length > 0) {
      console.log(chalk.gray(`   세부사항: ${JSON.stringify(details)}`));
    }
  }

  /**
   * 현재 단계 성공
   */
  endStep(result = {}) {
    if (this.currentStep) {
      this.currentStep.endTime = new Date().toISOString();
      this.currentStep.status = 'success';
      this.currentStep.result = result;
      
      const duration = new Date(this.currentStep.endTime) - new Date(this.currentStep.startTime);
      console.log(chalk.green(`✅ 단계 완료: ${this.currentStep.name} (${duration}ms)`));
    }
  }

  /**
   * 페이지 상태 기록
   */
  async capturePageState(page, reason = 'error') {
    try {
      const timestamp = Date.now();
      const pageState = {};
      
      // 1. 현재 URL
      pageState.url = await page.url();
      console.log(chalk.yellow(`📄 현재 페이지: ${pageState.url}`));
      
      // 2. 페이지 제목
      pageState.title = await page.title();
      
      // 3. 페이지 상태 정보
      pageState.pageInfo = await page.evaluate(() => {
        return {
          readyState: document.readyState,
          documentTitle: document.title,
          bodyText: document.body?.innerText?.substring(0, 500) || '',
          hasContent: document.body?.innerHTML?.length > 100,
          visibleElements: {
            buttons: document.querySelectorAll('button:not([style*="display: none"])').length,
            inputs: document.querySelectorAll('input:not([type="hidden"])').length,
            links: document.querySelectorAll('a[href]').length,
            forms: document.querySelectorAll('form').length
          },
          // 주요 텍스트 요소들
          headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent?.trim()).filter(t => t).slice(0, 5),
          // 에러 메시지 가능성이 있는 요소들
          errorMessages: Array.from(document.querySelectorAll('[class*="error"], [class*="alert"], [class*="warning"], [role="alert"]'))
            .map(el => el.textContent?.trim())
            .filter(t => t && t.length < 200)
            .slice(0, 3),
          // 버튼 텍스트들
          buttonTexts: Array.from(document.querySelectorAll('button, [role="button"]'))
            .map(btn => btn.textContent?.trim())
            .filter(t => t && t.length < 50)
            .slice(0, 10)
        };
      });
      
      // 4. 스크린샷 저장
      const screenshotName = `error_${timestamp}_${reason}.png`;
      const screenshotPath = path.join(this.screenshotDir, screenshotName);
      await page.screenshot({ 
        path: screenshotPath, 
        fullPage: false,
        quality: 80 
      });
      pageState.screenshot = screenshotName;
      console.log(chalk.cyan(`📸 스크린샷 저장: ${screenshotName}`));
      
      // 5. HTML 스냅샷 저장
      const htmlContent = await page.content();
      const htmlName = `snapshot_${timestamp}_${reason}.html`;
      const htmlPath = path.join(this.htmlSnapshotDir, htmlName);
      await fs.writeFile(htmlPath, htmlContent, 'utf8');
      pageState.htmlSnapshot = htmlName;
      console.log(chalk.cyan(`📝 HTML 스냅샷 저장: ${htmlName}`));
      
      // 6. 콘솔 로그 수집
      pageState.consoleLogs = await page.evaluate(() => {
        const logs = [];
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        
        // 최근 콘솔 로그 캡처 (실제로는 page.on('console')를 사용해야 함)
        return logs;
      });
      
      return pageState;
    } catch (error) {
      console.error(chalk.red('페이지 상태 캡처 실패:'), error.message);
      return {
        error: error.message,
        url: 'unknown'
      };
    }
  }

  /**
   * 에러 로깅
   */
  async logError(error, page = null, context = {}) {
    const timestamp = new Date().toISOString();
    const errorId = `error_${Date.now()}`;
    
    console.log(chalk.red.bold('\n' + '='.repeat(80)));
    console.log(chalk.red.bold('❌ 에러 발생'));
    console.log(chalk.red('='.repeat(80)));
    
    // 에러 정보 수집
    const errorInfo = {
      id: errorId,
      timestamp,
      message: error.message || String(error),
      stack: error.stack,
      currentStep: this.currentStep,
      stepHistory: this.stepHistory,
      context
    };
    
    // 현재 단계 정보
    if (this.currentStep) {
      console.log(chalk.yellow(`\n📍 실패 단계: ${this.currentStep.name}`));
      if (this.currentStep.details) {
        console.log(chalk.gray(`   단계 세부사항: ${JSON.stringify(this.currentStep.details)}`));
      }
      
      // 단계를 실패로 표시
      this.currentStep.status = 'failed';
      this.currentStep.error = error.message;
      this.currentStep.endTime = timestamp;
    }
    
    // 에러 메시지
    console.log(chalk.red(`\n💥 에러 메시지: ${error.message}`));
    
    // 페이지 상태 캡처
    if (page) {
      console.log(chalk.yellow('\n📊 페이지 상태 캡처 중...'));
      errorInfo.pageState = await this.capturePageState(page, 'error');
      
      // 페이지 정보 출력
      if (errorInfo.pageState.pageInfo) {
        const info = errorInfo.pageState.pageInfo;
        console.log(chalk.cyan('\n📄 페이지 정보:'));
        console.log(`   - URL: ${errorInfo.pageState.url}`);
        console.log(`   - 제목: ${errorInfo.pageState.title}`);
        console.log(`   - 준비 상태: ${info.readyState}`);
        console.log(`   - 버튼 수: ${info.visibleElements.buttons}`);
        console.log(`   - 입력 필드: ${info.visibleElements.inputs}`);
        
        if (info.errorMessages.length > 0) {
          console.log(chalk.red('\n⚠️ 감지된 에러 메시지:'));
          info.errorMessages.forEach(msg => {
            console.log(chalk.red(`   - ${msg}`));
          });
        }
        
        if (info.buttonTexts.length > 0) {
          console.log(chalk.gray('\n🔘 페이지의 버튼들:'));
          info.buttonTexts.forEach(text => {
            console.log(chalk.gray(`   - ${text}`));
          });
        }
      }
    }
    
    // 단계 히스토리
    console.log(chalk.yellow('\n📋 실행 단계 히스토리:'));
    this.stepHistory.slice(-5).forEach((step, index) => {
      const icon = step.status === 'success' ? '✅' : 
                   step.status === 'failed' ? '❌' : '⏳';
      console.log(`   ${index + 1}. ${icon} ${step.name} (${step.startTime.slice(11, 19)})`);
      if (step.details && Object.keys(step.details).length > 0) {
        console.log(chalk.gray(`      ${JSON.stringify(step.details)}`));
      }
    });
    
    // 에러 스택 (개발 모드에서만)
    if (process.env.DEBUG_MODE === 'true' && error.stack) {
      console.log(chalk.gray('\n📚 스택 트레이스:'));
      console.log(chalk.gray(error.stack));
    }
    
    // 에러 로그 파일 저장 (error-screenshots 폴더에 통합)
    const errorLogPath = path.join(this.screenshotDir, `${errorId}.json`);
    await fs.mkdir(path.dirname(errorLogPath), { recursive: true });
    await fs.writeFile(errorLogPath, JSON.stringify(errorInfo, null, 2), 'utf8');
    
    console.log(chalk.yellow(`\n💾 에러 로그 저장: ${errorLogPath}`));
    console.log(chalk.red('='.repeat(80) + '\n'));
    
    return errorInfo;
  }

  /**
   * 실패 원인 분석
   */
  analyzeFailure(error, pageState) {
    const analysis = {
      category: 'unknown',
      reason: error.message,
      suggestions: []
    };
    
    // 에러 메시지 기반 분류
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('timeout')) {
      analysis.category = 'timeout';
      analysis.reason = '작업 시간 초과';
      analysis.suggestions.push('네트워크 연결 확인');
      analysis.suggestions.push('타임아웃 시간 증가');
    } else if (errorMessage.includes('login')) {
      analysis.category = 'authentication';
      analysis.reason = '로그인 실패';
      analysis.suggestions.push('계정 정보 확인');
      analysis.suggestions.push('2단계 인증 설정 확인');
    } else if (errorMessage.includes('button') || errorMessage.includes('element')) {
      analysis.category = 'ui_element';
      analysis.reason = 'UI 요소를 찾을 수 없음';
      analysis.suggestions.push('페이지 구조 변경 확인');
      analysis.suggestions.push('언어 설정 확인');
    } else if (errorMessage.includes('network')) {
      analysis.category = 'network';
      analysis.reason = '네트워크 오류';
      analysis.suggestions.push('인터넷 연결 확인');
      analysis.suggestions.push('프록시 설정 확인');
    }
    
    // 페이지 상태 기반 추가 분석
    if (pageState && pageState.pageInfo) {
      if (pageState.pageInfo.errorMessages.length > 0) {
        analysis.pageErrors = pageState.pageInfo.errorMessages;
      }
      
      if (pageState.url.includes('accounts.google.com')) {
        analysis.suggestions.push('Google 계정 로그인 필요');
      }
      
      if (pageState.pageInfo.visibleElements.buttons === 0) {
        analysis.suggestions.push('페이지 로딩 대기 시간 증가');
      }
    }
    
    return analysis;
  }

  /**
   * 요약 보고서 생성
   */
  generateErrorReport() {
    const report = {
      totalSteps: this.stepHistory.length,
      successfulSteps: this.stepHistory.filter(s => s.status === 'success').length,
      failedSteps: this.stepHistory.filter(s => s.status === 'failed').length,
      lastFailedStep: this.stepHistory.filter(s => s.status === 'failed').pop(),
      timeline: this.stepHistory.map(s => ({
        name: s.name,
        status: s.status,
        duration: s.endTime ? new Date(s.endTime) - new Date(s.startTime) : null
      }))
    };
    
    return report;
  }

  /**
   * 초기화
   */
  reset() {
    this.currentStep = null;
    this.stepHistory = [];
    this.errorContext = {};
  }
}

module.exports = DetailedErrorLogger;