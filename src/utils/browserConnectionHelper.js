/**
 * Browser Connection Helper
 * ConnectionClosedError 해결을 위한 연결 관리 유틸리티
 */

const chalk = require('chalk');
const { exec } = require('child_process').promises;
const os = require('os');

class BrowserConnectionHelper {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
    this.debugMode = options.debugMode || false;
  }

  /**
   * 브라우저 연결 (재시도 포함)
   */
  async connectWithRetry(adsPowerAdapter, profileId) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.log(`🔄 브라우저 연결 시도 ${attempt}/${this.maxRetries} - 프로필: ${profileId}`);

        // 1. 연결 전 시스템 체크
        await this.preConnectionCheck();

        // 2. 기존 세션 정리
        await this.cleanupExistingSession(adsPowerAdapter, profileId);

        // 3. 브라우저 열기
        const result = await this.openBrowserSafely(adsPowerAdapter, profileId);

        // 4. 연결 검증
        if (await this.verifyConnection(result)) {
          this.log('✅ 브라우저 연결 성공');
          return result;
        }

      } catch (error) {
        lastError = error;
        this.log(`❌ 연결 실패 (시도 ${attempt}): ${error.message}`, 'error');

        if (this.isConnectionError(error)) {
          if (attempt < this.maxRetries) {
            await this.handleConnectionError(attempt);
          }
        } else {
          // Connection 오류가 아니면 즉시 throw
          throw error;
        }
      }
    }

    throw new Error(`브라우저 연결 최종 실패 (${this.maxRetries}회 시도): ${lastError?.message}`);
  }

  /**
   * 연결 전 시스템 체크
   */
  async preConnectionCheck() {
    // 1. AdsPower 실행 확인
    const isRunning = await this.isAdsPowerRunning();
    if (!isRunning) {
      throw new Error('AdsPower가 실행되지 않습니다. AdsPower를 먼저 실행해주세요.');
    }

    // 2. 메모리 체크
    const memoryOk = await this.checkMemory();
    if (!memoryOk) {
      this.log('⚠️ 메모리 부족 - Chrome 프로세스 정리 중...', 'warning');
      await this.cleanupChromeProcesses();
    }

    // 3. 과도한 Chrome 프로세스 확인
    const chromeCount = await this.countChromeProcesses();
    if (chromeCount > 15) {
      this.log(`⚠️ Chrome 프로세스가 너무 많습니다 (${chromeCount}개) - 정리 중...`, 'warning');
      await this.cleanupChromeProcesses();
    }
  }

  /**
   * 기존 세션 정리
   */
  async cleanupExistingSession(adapter, profileId) {
    try {
      this.log('🧹 기존 세션 정리 중...');

      // AdsPower API로 브라우저 닫기
      await adapter.closeBrowser(profileId);

      // 정리 후 대기
      await this.delay(2000);

      this.log('✅ 세션 정리 완료');
    } catch (error) {
      // 세션이 없을 수 있으므로 오류 무시
      this.log('세션 정리 생략 (이미 닫혀있음)', 'debug');
    }
  }

  /**
   * 안전한 브라우저 열기
   */
  async openBrowserSafely(adapter, profileId) {
    // 브라우저 시작 전 대기
    await this.delay(1000);

    // 브라우저 열기 (adapter의 기존 메소드 사용)
    const result = await adapter.openBrowser(profileId);

    // 브라우저 초기화 대기
    await this.delay(2000);

    return result;
  }

  /**
   * 연결 검증
   */
  async verifyConnection(result) {
    if (!result || !result.browser || !result.page) {
      this.log('❌ 브라우저 또는 페이지 객체가 없습니다', 'error');
      return false;
    }

    try {
      // 페이지가 실제로 작동하는지 테스트
      await result.page.evaluate(() => true);

      // 브라우저 버전 확인
      await result.browser.version();

      return true;
    } catch (error) {
      this.log(`❌ 연결 검증 실패: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * Connection 오류인지 확인
   */
  isConnectionError(error) {
    const errorMessage = error.message || error.toString();
    return errorMessage.includes('Connection closed') ||
           errorMessage.includes('Connection refused') ||
           errorMessage.includes('Protocol error') ||
           errorMessage.includes('Target closed');
  }

  /**
   * Connection 오류 처리
   */
  async handleConnectionError(attemptNumber) {
    this.log(`⏳ ${this.retryDelay * attemptNumber}ms 대기 후 재시도...`, 'info');

    // 점진적 대기
    await this.delay(this.retryDelay * attemptNumber);

    // 3번째 시도에서는 AdsPower 재시작 권고
    if (attemptNumber === 2) {
      this.log('💡 AdsPower 재시작을 권장합니다', 'warning');
      await this.suggestRestart();
    }
  }

  /**
   * AdsPower 실행 확인
   */
  async isAdsPowerRunning() {
    try {
      const { stdout } = await exec('tasklist | findstr "AdsPower"');
      return stdout.includes('AdsPower');
    } catch (error) {
      return false;
    }
  }

  /**
   * 메모리 체크
   */
  async checkMemory() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const freeMemGB = (freeMem / 1024 / 1024 / 1024).toFixed(1);
    const usedPercent = ((totalMem - freeMem) / totalMem * 100).toFixed(1);

    this.log(`💾 메모리: ${usedPercent}% 사용중, ${freeMemGB}GB 여유`, 'debug');

    // 2GB 미만이면 false
    return freeMem > 2 * 1024 * 1024 * 1024;
  }

  /**
   * Chrome 프로세스 수 확인
   */
  async countChromeProcesses() {
    try {
      const { stdout } = await exec('tasklist | findstr "chrome" | find /c /v ""');
      return parseInt(stdout.trim()) || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Chrome 프로세스 정리
   */
  async cleanupChromeProcesses() {
    try {
      // 응답 없는 Chrome 프로세스만 종료
      await exec('taskkill /f /im "chrome.exe" /fi "STATUS eq NOT RESPONDING"');
      this.log('✅ 응답 없는 Chrome 프로세스 정리 완료', 'info');

      // 메모리를 과도하게 사용하는 Chrome 프로세스 종료 (500MB 이상)
      await exec('taskkill /f /im "chrome.exe" /fi "MEMUSAGE gt 500000"');
      this.log('✅ 과도한 메모리 사용 Chrome 프로세스 정리 완료', 'info');

      // 정리 후 대기
      await this.delay(3000);
    } catch (error) {
      // 정리할 프로세스가 없을 수 있음
      this.log('Chrome 프로세스 정리 생략', 'debug');
    }
  }

  /**
   * AdsPower 재시작 제안
   */
  async suggestRestart() {
    console.log(chalk.yellow('\n' + '='.repeat(50)));
    console.log(chalk.yellow('💡 AdsPower 재시작 권장'));
    console.log(chalk.yellow('='.repeat(50)));
    console.log(chalk.cyan('1. 작업 관리자에서 AdsPower.exe 종료'));
    console.log(chalk.cyan('2. 모든 chrome.exe 프로세스 종료'));
    console.log(chalk.cyan('3. AdsPower 다시 실행'));
    console.log(chalk.cyan('4. 30초 대기 후 다시 시도'));
    console.log(chalk.yellow('='.repeat(50) + '\n'));
  }

  /**
   * 로깅
   */
  log(message, level = 'info') {
    if (!this.debugMode && level === 'debug') {
      return;
    }

    const colors = {
      info: 'blue',
      error: 'red',
      warning: 'yellow',
      success: 'green',
      debug: 'gray'
    };

    const color = colors[level] || 'white';
    console.log(chalk[color](message));
  }

  /**
   * 대기
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 정적 메소드: 빠른 진단
   */
  static async quickDiagnose() {
    const helper = new BrowserConnectionHelper({ debugMode: true });

    console.log(chalk.cyan('\n🔍 브라우저 연결 상태 진단\n'));

    // AdsPower 확인
    const adsPowerRunning = await helper.isAdsPowerRunning();
    console.log(adsPowerRunning
      ? chalk.green('✅ AdsPower 실행 중')
      : chalk.red('❌ AdsPower 미실행'));

    // 메모리 확인
    const memoryOk = await helper.checkMemory();
    console.log(memoryOk
      ? chalk.green('✅ 메모리 충분')
      : chalk.yellow('⚠️ 메모리 부족'));

    // Chrome 프로세스 확인
    const chromeCount = await helper.countChromeProcesses();
    const chromeOk = chromeCount < 15;
    console.log(chromeOk
      ? chalk.green(`✅ Chrome 프로세스: ${chromeCount}개`)
      : chalk.yellow(`⚠️ Chrome 프로세스 과다: ${chromeCount}개`));

    // API 연결 테스트
    try {
      const axios = require('axios');
      await axios.get('http://localhost:50325/api/v1/user/list', { timeout: 5000 });
      console.log(chalk.green('✅ AdsPower API 응답 정상'));
    } catch (error) {
      console.log(chalk.red('❌ AdsPower API 연결 실패'));
    }

    console.log(chalk.cyan('\n진단 완료!\n'));

    return {
      adsPowerRunning,
      memoryOk,
      chromeOk,
      chromeCount
    };
  }
}

module.exports = BrowserConnectionHelper;