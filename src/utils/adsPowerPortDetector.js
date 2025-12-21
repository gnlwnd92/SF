/**
 * AdsPower 포트 자동 감지 유틸리티
 * 50325, 50326, 50327 포트 자동 탐지
 */

const axios = require('axios');
const chalk = require('chalk');

class AdsPowerPortDetector {
  constructor() {
    // 가장 일반적인 포트부터 시도 (50325 → 50326 → 50327)
    this.possiblePorts = [50325, 50326, 50327];
    this.baseHost = 'http://127.0.0.1';
    this.cachedPort = null; // 캐시된 작동 포트
    this.lastCheck = null;
    this.cacheTimeout = 60000; // 1분
  }

  /**
   * 작동하는 포트 URL 감지
   * @param {boolean} silent - 로그 출력 여부
   * @returns {Promise<string|null>} 작동하는 포트 URL, 실패시 null
   */
  async detectWorkingPort(silent = false) {
    // 캐시 확인 (1분 이내면 캐시 사용)
    if (this.cachedPort && this.lastCheck && Date.now() - this.lastCheck < this.cacheTimeout) {
      if (!silent) {
        console.log(chalk.gray(`[AdsPower] 캐시된 포트 사용: ${this.cachedPort}`));
      }
      return this.cachedPort;
    }

    if (!silent) {
      console.log(chalk.cyan(`[AdsPower] 포트 자동 감지 시작... (${this.possiblePorts.join(', ')} 시도)`));
    }

    for (const port of this.possiblePorts) {
      const testUrl = `${this.baseHost}:${port}`;
      try {
        const testClient = axios.create({
          baseURL: testUrl,
          timeout: 3000, // 빠른 타임아웃
          headers: { 'Content-Type': 'application/json' }
        });

        const response = await testClient.get('/api/v1/user/list', {
          params: { page_size: 1 }
        });

        if (response.data.code === 0) {
          if (!silent) {
            console.log(chalk.green(`[AdsPower] ✅ 포트 ${port} 연결 성공!`));
          }

          // 캐시 업데이트
          this.cachedPort = testUrl;
          this.lastCheck = Date.now();

          return testUrl;
        }
      } catch (error) {
        if (!silent) {
          console.log(chalk.gray(`[AdsPower] ⏭️  포트 ${port} 연결 실패, 다음 포트 시도...`));
        }
      }
    }

    // 모든 포트 실패
    this.cachedPort = null;
    this.lastCheck = null;

    return null;
  }

  /**
   * API URL 가져오기 (자동 감지 포함)
   * @param {string} configUrl - 설정 파일의 URL (선택)
   * @param {boolean} silent - 로그 출력 여부
   * @returns {Promise<string>} 작동하는 API URL
   * @throws {Error} 모든 포트 연결 실패시
   */
  async getApiUrl(configUrl = null, silent = false) {
    // 1. 설정된 URL이 있으면 먼저 시도
    if (configUrl) {
      try {
        const testClient = axios.create({
          baseURL: configUrl,
          timeout: 3000,
          headers: { 'Content-Type': 'application/json' }
        });

        const response = await testClient.get('/api/v1/user/list', {
          params: { page_size: 1 }
        });

        if (response.data.code === 0) {
          if (!silent) {
            console.log(chalk.green(`[AdsPower] ✅ 설정된 URL 연결 성공: ${configUrl}`));
          }

          // 캐시 업데이트
          this.cachedPort = configUrl;
          this.lastCheck = Date.now();

          return configUrl;
        }
      } catch (error) {
        if (!silent) {
          console.log(chalk.yellow(`[AdsPower] ⚠️  설정된 URL 연결 실패: ${configUrl}`));
        }
      }
    }

    // 2. 자동 포트 감지
    const workingUrl = await this.detectWorkingPort(silent);

    if (!workingUrl) {
      const errorMsg = 'AdsPower API에 연결할 수 없습니다.\n' +
        '다음을 확인하세요:\n' +
        '1. AdsPower가 실행 중인지 확인\n' +
        '2. 포트 50325, 50326, 50327 중 하나가 열려있는지 확인\n' +
        '3. 방화벽 설정 확인';
      throw new Error(errorMsg);
    }

    if (!silent) {
      console.log(chalk.cyan(`[AdsPower] 💡 TIP: .env 파일을 다음과 같이 업데이트하면 더 빠르게 시작할 수 있습니다:`));
      console.log(chalk.cyan(`[AdsPower]      ADSPOWER_API_URL=${workingUrl}`));
    }

    return workingUrl;
  }

  /**
   * 포트 감지 후 axios 클라이언트 생성
   * @param {string} configUrl - 설정 파일의 URL (선택)
   * @param {number} timeout - 타임아웃 (기본 30초)
   * @param {boolean} silent - 로그 출력 여부
   * @returns {Promise<object>} axios 인스턴스와 URL
   */
  async createApiClient(configUrl = null, timeout = 30000, silent = false) {
    const apiUrl = await this.getApiUrl(configUrl, silent);

    const client = axios.create({
      baseURL: apiUrl,
      timeout: timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return { client, url: apiUrl };
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.cachedPort = null;
    this.lastCheck = null;
  }

  /**
   * 현재 캐시된 포트 URL 가져오기
   * @returns {string|null}
   */
  getCachedPort() {
    if (this.cachedPort && this.lastCheck && Date.now() - this.lastCheck < this.cacheTimeout) {
      return this.cachedPort;
    }
    return null;
  }

  /**
   * AdsPower 실행 여부 확인
   * @returns {Promise<boolean>}
   */
  async isAdsPowerRunning() {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync('tasklist | findstr "AdsPower"');
      return stdout.includes('AdsPower');
    } catch (error) {
      return false;
    }
  }

  /**
   * 빠른 진단 (포트 상태 확인)
   * @returns {Promise<object>} 진단 결과
   */
  async quickDiagnose() {
    console.log(chalk.cyan('\n🔍 AdsPower 포트 진단\n'));

    // AdsPower 실행 확인
    const isRunning = await this.isAdsPowerRunning();
    console.log(isRunning
      ? chalk.green('✅ AdsPower 실행 중')
      : chalk.red('❌ AdsPower 미실행'));

    if (!isRunning) {
      console.log(chalk.yellow('\n💡 AdsPower를 먼저 실행해주세요.\n'));
      return { running: false, port: null };
    }

    // 각 포트 상태 확인
    const portStatus = {};
    for (const port of this.possiblePorts) {
      const testUrl = `${this.baseHost}:${port}`;
      try {
        const testClient = axios.create({
          baseURL: testUrl,
          timeout: 2000,
          headers: { 'Content-Type': 'application/json' }
        });

        const response = await testClient.get('/api/v1/user/list', {
          params: { page_size: 1 }
        });

        if (response.data.code === 0) {
          console.log(chalk.green(`✅ 포트 ${port}: 정상`));
          portStatus[port] = 'ok';
        } else {
          console.log(chalk.yellow(`⚠️  포트 ${port}: 응답 이상`));
          portStatus[port] = 'error';
        }
      } catch (error) {
        console.log(chalk.red(`❌ 포트 ${port}: 연결 실패`));
        portStatus[port] = 'failed';
      }
    }

    // 작동하는 포트 찾기
    const workingPort = Object.keys(portStatus).find(port => portStatus[port] === 'ok');

    if (workingPort) {
      console.log(chalk.green(`\n✅ 사용 가능한 포트: ${workingPort}`));
      console.log(chalk.cyan(`권장 설정: ADSPOWER_API_URL=http://127.0.0.1:${workingPort}\n`));
    } else {
      console.log(chalk.red('\n❌ 작동하는 포트를 찾을 수 없습니다.'));
      console.log(chalk.yellow('AdsPower를 재시작해보세요.\n'));
    }

    return {
      running: isRunning,
      portStatus,
      workingPort: workingPort ? parseInt(workingPort) : null
    };
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * 싱글톤 인스턴스 가져오기
 * @returns {AdsPowerPortDetector}
 */
function getInstance() {
  if (!instance) {
    instance = new AdsPowerPortDetector();
  }
  return instance;
}

module.exports = {
  AdsPowerPortDetector,
  getInstance,
  // 편의 함수들
  detectWorkingPort: async (silent = false) => getInstance().detectWorkingPort(silent),
  getApiUrl: async (configUrl = null, silent = false) => getInstance().getApiUrl(configUrl, silent),
  createApiClient: async (configUrl = null, timeout = 30000, silent = false) =>
    getInstance().createApiClient(configUrl, timeout, silent),
  quickDiagnose: async () => getInstance().quickDiagnose(),
  clearCache: () => getInstance().clearCache()
};