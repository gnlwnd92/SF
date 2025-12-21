const fs = require('fs').promises;
const path = require('path');

/**
 * @class GoogleSheetsConfigService
 * @description Google Sheets 다중 설정 관리 서비스
 */
class GoogleSheetsConfigService {
  constructor(config = {}) {
    this.baseDir = path.resolve(__dirname, '..', '..');
    this.configPath = path.join(this.baseDir, 'config', 'sheets-config.json');
    this.config = null;
    this.initialized = false;
  }

  /**
   * 설정 초기화
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 설정 파일 로드 시도
      await this.loadConfig();
    } catch (error) {
      console.log('📋 기존 설정이 없습니다. 새로운 설정을 생성합니다.');
      await this.createDefaultConfig();
    }

    this.initialized = true;
  }

  /**
   * 기본 설정 생성
   */
  async createDefaultConfig() {
    // .env에서 시트 정보 읽기
    const sheets = [];

    // 메인 시트
    if (process.env.GOOGLE_SHEETS_ID) {
      sheets.push({
        id: process.env.GOOGLE_SHEETS_ID,
        name: process.env.GOOGLE_SHEETS_NAME || '메인 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json'
      });
    }

    // 두 번째 시트
    if (process.env.GOOGLE_SHEETS_ID_2) {
      sheets.push({
        id: process.env.GOOGLE_SHEETS_ID_2,
        name: process.env.GOOGLE_SHEETS_NAME_2 || '백업 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH_2 || './credentials/service-account.json'
      });
    }

    // 세 번째 시트
    if (process.env.GOOGLE_SHEETS_ID_3) {
      sheets.push({
        id: process.env.GOOGLE_SHEETS_ID_3,
        name: process.env.GOOGLE_SHEETS_NAME_3 || '테스트 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH_3 || './credentials/service-account.json'
      });
    }

    // 기본 시트가 없으면 오류 발생
    if (sheets.length === 0) {
      throw new Error(
        '❌ Google Sheets ID가 설정되지 않았습니다!\n' +
        '.env 파일에 GOOGLE_SHEETS_ID를 설정해주세요.\n' +
        '예시: GOOGLE_SHEETS_ID=your_google_sheets_id_here'
      );
    }

    this.config = {
      sheets,
      activeIndex: parseInt(process.env.ACTIVE_SHEET_INDEX) || 0,
      lastModified: new Date().toISOString()
    };

    await this.saveConfig();
  }

  /**
   * 설정 로드
   */
  async loadConfig() {
    const configData = await fs.readFile(this.configPath, 'utf8');
    this.config = JSON.parse(configData);

    // 환경 변수에서 추가 시트 확인 및 동기화
    await this.syncWithEnv();
  }

  /**
   * 환경 변수와 동기화
   */
  async syncWithEnv() {
    let modified = false;

    // 환경 변수의 시트들을 확인
    const envSheets = [];
    if (process.env.GOOGLE_SHEETS_ID) {
      envSheets.push({
        id: process.env.GOOGLE_SHEETS_ID,
        name: process.env.GOOGLE_SHEETS_NAME || '메인 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json'
      });
    }
    if (process.env.GOOGLE_SHEETS_ID_2) {
      envSheets.push({
        id: process.env.GOOGLE_SHEETS_ID_2,
        name: process.env.GOOGLE_SHEETS_NAME_2 || '백업 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH_2 || './credentials/service-account.json'
      });
    }
    if (process.env.GOOGLE_SHEETS_ID_3) {
      envSheets.push({
        id: process.env.GOOGLE_SHEETS_ID_3,
        name: process.env.GOOGLE_SHEETS_NAME_3 || '테스트 시트',
        path: process.env.GOOGLE_SERVICE_ACCOUNT_PATH_3 || './credentials/service-account.json'
      });
    }

    // 새로운 시트 추가
    for (const envSheet of envSheets) {
      const exists = this.config.sheets.some(s => s.id === envSheet.id);
      if (!exists) {
        this.config.sheets.push(envSheet);
        modified = true;
      }
    }

    if (modified) {
      await this.saveConfig();
    }
  }

  /**
   * 설정 저장
   */
  async saveConfig() {
    // config 디렉토리 확인 및 생성
    const configDir = path.dirname(this.configPath);
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }

    await fs.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      'utf8'
    );
  }

  /**
   * 사용 가능한 모든 시트 목록 반환
   */
  async getAvailableSheets() {
    await this.initialize();
    return this.config.sheets.map((sheet, index) => ({
      ...sheet,
      index,
      isActive: index === this.config.activeIndex
    }));
  }

  /**
   * 현재 활성 시트 정보 반환
   */
  async getActiveSheet() {
    await this.initialize();
    const activeSheet = this.config.sheets[this.config.activeIndex];
    if (!activeSheet) {
      // 활성 시트가 없으면 첫 번째 시트 선택
      this.config.activeIndex = 0;
      await this.saveConfig();
      return this.config.sheets[0];
    }
    return activeSheet;
  }

  /**
   * 활성 시트 변경
   */
  async setActiveSheet(sheetIndex) {
    await this.initialize();

    if (sheetIndex < 0 || sheetIndex >= this.config.sheets.length) {
      throw new Error(`잘못된 시트 인덱스: ${sheetIndex}`);
    }

    this.config.activeIndex = sheetIndex;
    this.config.lastModified = new Date().toISOString();

    // 설정 저장
    await this.saveConfig();

    // .env 파일 업데이트 (선택적)
    await this.updateEnvFile(sheetIndex);

    return this.config.sheets[sheetIndex];
  }

  /**
   * .env 파일 업데이트 및 process.env 재로드
   */
  async updateEnvFile(sheetIndex) {
    const envPath = path.join(this.baseDir, '.env');
    const selectedSheet = this.config.sheets[sheetIndex];

    try {
      let envContent = await fs.readFile(envPath, 'utf8');

      // GOOGLE_SHEETS_ID 업데이트 (메인 시트 ID 변경)
      if (envContent.includes('GOOGLE_SHEETS_ID=')) {
        envContent = envContent.replace(
          /GOOGLE_SHEETS_ID=[^\r\n]*/,
          `GOOGLE_SHEETS_ID=${selectedSheet.id}`
        );
      } else {
        envContent += `\n# Google Sheets ID\nGOOGLE_SHEETS_ID=${selectedSheet.id}\n`;
      }

      // GOOGLE_SHEETS_NAME 업데이트
      if (envContent.includes('GOOGLE_SHEETS_NAME=')) {
        envContent = envContent.replace(
          /GOOGLE_SHEETS_NAME=[^\r\n]*/,
          `GOOGLE_SHEETS_NAME=${selectedSheet.name}`
        );
      } else {
        envContent += `GOOGLE_SHEETS_NAME=${selectedSheet.name}\n`;
      }

      // ACTIVE_SHEET_INDEX 업데이트
      if (envContent.includes('ACTIVE_SHEET_INDEX=')) {
        envContent = envContent.replace(
          /ACTIVE_SHEET_INDEX=\d+/,
          `ACTIVE_SHEET_INDEX=${sheetIndex}`
        );
      } else {
        envContent += `\n# 활성 Google Sheets 인덱스\nACTIVE_SHEET_INDEX=${sheetIndex}\n`;
      }

      await fs.writeFile(envPath, envContent, 'utf8');
      console.log('✅ .env 파일이 업데이트되었습니다.');

      // process.env 직접 업데이트 (현재 프로세스에 즉시 반영)
      process.env.GOOGLE_SHEETS_ID = selectedSheet.id;
      process.env.GOOGLE_SHEETS_NAME = selectedSheet.name;
      process.env.ACTIVE_SHEET_INDEX = String(sheetIndex);

      // dotenv 재로드 (안전성을 위해)
      try {
        const dotenv = require('dotenv');
        dotenv.config({ override: true });
      } catch (e) {
        // dotenv 재로드 실패 시 무시
      }

      console.log(`📊 시트가 변경되었습니다: ${selectedSheet.id}`);

    } catch (error) {
      console.warn('⚠️ .env 파일 업데이트 실패:', error.message);
    }
  }

  /**
   * 시트 이름 업데이트
   */
  async updateSheetName(sheetIndex, newName) {
    await this.initialize();

    if (sheetIndex < 0 || sheetIndex >= this.config.sheets.length) {
      throw new Error(`잘못된 시트 인덱스: ${sheetIndex}`);
    }

    this.config.sheets[sheetIndex].name = newName;
    this.config.lastModified = new Date().toISOString();

    await this.saveConfig();
  }

  /**
   * 시트 추가
   */
  async addSheet(sheetId, sheetName, serviceAccountPath = './credentials/service-account.json') {
    await this.initialize();

    // 중복 체크
    const exists = this.config.sheets.some(s => s.id === sheetId);
    if (exists) {
      throw new Error('이미 존재하는 시트 ID입니다.');
    }

    this.config.sheets.push({
      id: sheetId,
      name: sheetName,
      path: serviceAccountPath
    });

    this.config.lastModified = new Date().toISOString();
    await this.saveConfig();

    return this.config.sheets.length - 1; // 새로 추가된 시트의 인덱스 반환
  }

  /**
   * 시트 삭제
   */
  async removeSheet(sheetIndex) {
    await this.initialize();

    if (sheetIndex < 0 || sheetIndex >= this.config.sheets.length) {
      throw new Error(`잘못된 시트 인덱스: ${sheetIndex}`);
    }

    if (this.config.sheets.length <= 1) {
      throw new Error('최소 하나의 시트는 유지되어야 합니다.');
    }

    this.config.sheets.splice(sheetIndex, 1);

    // 활성 인덱스 조정
    if (this.config.activeIndex >= this.config.sheets.length) {
      this.config.activeIndex = this.config.sheets.length - 1;
    }

    this.config.lastModified = new Date().toISOString();
    await this.saveConfig();
  }

  /**
   * 설정 리셋 (기본값으로)
   */
  async resetConfig() {
    await this.createDefaultConfig();
  }
}

module.exports = GoogleSheetsConfigService;