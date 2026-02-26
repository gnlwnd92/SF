/**
 * Google Sheets '설정' 탭 관리 Repository
 *
 * 시트 구조:
 *   A열: 설정키
 *   B열: 설정값
 *   C열: 설명
 *   D열: 수정시간
 *
 * 카테고리 헤더 (▶로 시작)는 자동 필터링
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;
const { CONFIG_KEYS, CONFIG_DEFAULTS, CONFIG_TYPES } = require('../../config/configKeys');

class ConfigRepository {
  // 세션당 연결 메시지 1회만 출력
  static hasLoggedConnection = false;

  constructor({ logger } = {}) {
    this.auth = null;
    this.sheets = null;
    this.spreadsheetId = null;
    this.sheetName = '설정';
    this.logger = logger;
  }

  /**
   * 로거 헬퍼 (옵셔널 메서드 호환)
   */
  _log(level, message, ...args) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, ...args);
    } else if (level === 'error') {
      console.error(`[ConfigRepository] ${message}`, ...args);
    } else {
      console.log(`[ConfigRepository] ${message}`, ...args);
    }
  }

  /**
   * Google Sheets 인증 초기화
   */
  async initialize() {
    if (this.sheets) return true;

    try {
      // 서비스 계정 키 파일 경로 - 여러 위치 시도
      const baseDir = path.resolve(__dirname, '..', '..', '..');
      const possiblePaths = [
        path.join(__dirname, '../../config/youtube-automation-439913-b1c8dfe38d92.json'),
        path.join(baseDir, 'credentials', 'service-account.json'),
        path.join(baseDir, 'service_account.json'),
        path.join(baseDir, '..', 'service_account.json'),
        path.join(baseDir, '..', '..', 'service_account.json')
      ];

      let keyFile = null;

      for (const testPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(testPath, 'utf8');
          if (!ConfigRepository.hasLoggedConnection) {
            this._log('info', `서비스 계정 키 파일 로드: ${testPath}`);
          }
          break;
        } catch (e) {
          // 다음 경로 시도
        }
      }

      if (!keyFile) {
        throw new Error('서비스 계정 키 파일을 찾을 수 없습니다');
      }

      const key = JSON.parse(keyFile);

      // JWT 클라이언트 생성
      this.auth = new google.auth.JWT(
        key.client_email,
        null,
        key.private_key,
        ['https://www.googleapis.com/auth/spreadsheets']
      );

      await this.auth.authorize();

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;

      if (!this.spreadsheetId) {
        throw new Error(
          '❌ Google Sheets ID가 설정되지 않았습니다!\n' +
          '.env 파일에 GOOGLE_SHEETS_ID를 설정해주세요.'
        );
      }

      if (!ConfigRepository.hasLoggedConnection) {
        this._log('info', `✅ 설정 탭 연결 성공 (시트: ${this.sheetName})`);
        ConfigRepository.hasLoggedConnection = true;
      }

      return true;
    } catch (error) {
      this._log('error', '❌ 설정 탭 연결 실패:', error.message);
      return false;
    }
  }

  /**
   * 값 파싱 (시트에서 읽은 문자열 → 적절한 타입)
   *
   * @param {string} key - 설정 키
   * @param {string} value - 시트에서 읽은 값 (문자열)
   * @returns {any} 파싱된 값
   */
  parseValue(key, value) {
    if (value === null || value === undefined || value === '') {
      return CONFIG_DEFAULTS[key];
    }

    const type = CONFIG_TYPES[key];

    switch (type) {
      case 'number':
        const num = parseFloat(value);
        return isNaN(num) ? CONFIG_DEFAULTS[key] : num;

      case 'boolean':
        if (typeof value === 'boolean') return value;
        const lower = String(value).toLowerCase().trim();
        return lower === 'true' || lower === '1' || lower === 'yes';

      case 'string':
      default:
        return String(value);
    }
  }

  /**
   * 모든 설정 조회 (▶ 카테고리 헤더 필터링)
   *
   * @returns {Promise<Map<string, any>>} 설정 Map
   */
  async getAll() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:D`
      });

      const rows = response.data.values || [];
      const config = new Map();

      // 첫 번째 행이 헤더인 경우 스킵
      const startRow = rows.length > 0 && rows[0][0] === '설정키' ? 1 : 0;

      for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;

        const key = String(row[0]).trim();

        // 카테고리 헤더 필터링 (▶, #, // 등)
        if (key.startsWith('▶') || key.startsWith('#') || key.startsWith('//')) {
          continue;
        }

        // 빈 키 스킵
        if (!key) continue;

        // 유효한 설정 키인지 확인
        if (!Object.values(CONFIG_KEYS).includes(key)) {
          this._log('warn', `알 수 없는 설정 키 무시: ${key}`);
          continue;
        }

        const value = row[1];
        config.set(key, this.parseValue(key, value));
      }

      // 시트에 없는 키는 기본값으로 채움
      for (const [key, defaultValue] of Object.entries(CONFIG_DEFAULTS)) {
        if (!config.has(key)) {
          config.set(key, defaultValue);
        }
      }

      config._fromSheet = true;  // 시트에서 정상 조회됨 표시
      return config;
    } catch (error) {
      this._log('error', `⚠️ 설정 조회 실패 (기본값 사용): ${error.message}`);

      // 실패 시 기본값 반환
      const defaults = new Map();
      for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
        defaults.set(key, value);
      }
      defaults._fromSheet = false;  // API 실패로 기본값 반환됨 표시
      return defaults;
    }
  }

  /**
   * 단일 설정 조회
   *
   * @param {string} key - 설정 키
   * @returns {Promise<any>} 설정 값
   */
  async get(key) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:B`
      });

      const rows = response.data.values || [];

      for (const row of rows) {
        if (row && row[0] && String(row[0]).trim() === key) {
          return this.parseValue(key, row[1]);
        }
      }

      // 찾지 못한 경우 기본값 반환
      return CONFIG_DEFAULTS[key];
    } catch (error) {
      this._log('error', `설정 조회 실패 (${key}):`, error.message);
      return CONFIG_DEFAULTS[key];
    }
  }

  /**
   * 설정 저장/업데이트
   *
   * @param {string} key - 설정 키
   * @param {any} value - 설정 값
   * @returns {Promise<boolean>} 성공 여부
   */
  async set(key, value) {
    await this.initialize();

    try {
      // 먼저 해당 키가 있는 행 찾기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:D`
      });

      const rows = response.data.values || [];
      let rowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i][0]).trim() === key) {
          rowIndex = i + 1; // 1-based
          break;
        }
      }

      // 수정 시간
      const now = new Date();
      const timestamp = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      if (rowIndex > 0) {
        // 기존 행 업데이트 (B열: 값, D열: 수정시간)
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: [
              {
                range: `${this.sheetName}!B${rowIndex}`,
                values: [[String(value)]]
              },
              {
                range: `${this.sheetName}!D${rowIndex}`,
                values: [[timestamp]]
              }
            ]
          }
        });

        this._log('info', `설정 업데이트: ${key} = ${value}`);
      } else {
        // 새 행 추가
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A:D`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: [[key, String(value), '', timestamp]]
          }
        });

        this._log('info', `설정 추가: ${key} = ${value}`);
      }

      return true;
    } catch (error) {
      this._log('error', `설정 저장 실패 (${key}):`, error.message);
      return false;
    }
  }

  /**
   * 여러 설정 일괄 저장
   *
   * @param {Map|Object} configs - 설정 Map 또는 객체
   * @returns {Promise<boolean>} 성공 여부
   */
  async setMultiple(configs) {
    const entries = configs instanceof Map
      ? Array.from(configs.entries())
      : Object.entries(configs);

    let success = true;
    for (const [key, value] of entries) {
      const result = await this.set(key, value);
      if (!result) success = false;
    }

    return success;
  }

  /**
   * 설정 탭이 존재하는지 확인
   *
   * @returns {Promise<boolean>}
   */
  async sheetExists() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const sheets = response.data.sheets || [];
      return sheets.some(sheet =>
        sheet.properties && sheet.properties.title === this.sheetName
      );
    } catch (error) {
      this._log('error', '시트 존재 확인 실패:', error.message);
      return false;
    }
  }

  /**
   * 설정 값 유효성 검증
   *
   * @param {string} key - 설정 키
   * @param {any} value - 검증할 값
   * @returns {boolean} 유효 여부
   */
  validateValue(key, value) {
    const type = CONFIG_TYPES[key];

    switch (type) {
      case 'number':
        const num = parseFloat(value);
        return !isNaN(num) && num >= 0;

      case 'boolean':
        if (typeof value === 'boolean') return true;
        const lower = String(value).toLowerCase().trim();
        return ['true', 'false', '1', '0', 'yes', 'no'].includes(lower);

      case 'string':
      default:
        return typeof value === 'string' || typeof value === 'number';
    }
  }
}

module.exports = ConfigRepository;
