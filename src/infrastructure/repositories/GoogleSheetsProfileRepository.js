const { google } = require('googleapis');
const IProfileRepository = require('../../domain/repositories/IProfileRepository');
const Profile = require('../../domain/entities/Profile');
const path = require('path');
const fs = require('fs').promises;

/**
 * @class GoogleSheetsProfileRepository
 * @description Google Sheets를 사용한 프로필 레포지토리 구현
 */
class GoogleSheetsProfileRepository extends IProfileRepository {
  constructor(config = {}) {
    super();
    
    // __dirname 기반으로 경로 설정 (경로 독립성 보장)
    const baseDir = path.resolve(__dirname, '..', '..', '..');
    
    this.config = {
      spreadsheetId: config.spreadsheetId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath || path.join(baseDir, 'credentials', 'service-account.json'), // 상대 경로: ./credentials/service-account.json
      sheetName: config.sheetName || '애즈파워현황'
    };

    this.sheets = null;
    this.initialized = false;
  }

  /**
   * Google Sheets API 초기화
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 서비스 계정 키 파일 읽기
      const keyFile = await fs.readFile(this.config.serviceAccountPath, 'utf8');
      const key = JSON.parse(keyFile);

      // 인증 설정
      const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      // Sheets API 클라이언트 생성
      this.sheets = google.sheets({ version: 'v4', auth });
      this.initialized = true;
      
    } catch (error) {
      throw new Error(`Failed to initialize Google Sheets: ${error.message}`);
    }
  }

  /**
   * 시트 데이터 가져오기
   */
  async getSheetData() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:Z`
      });

      const rows = response.data.values || [];
      if (rows.length === 0) return [];

      const headers = rows[0];
      const data = rows.slice(1);

      return data.map(row => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });
    } catch (error) {
      throw new Error(`Failed to get sheet data: ${error.message}`);
    }
  }

  /**
   * 시트에 데이터 쓰기
   */
  async updateSheetData(data) {
    await this.initialize();

    try {
      // 헤더 구성
      const headers = [
        'profileId', 'name', 'email', 'status', 
        'createdAt', 'updatedAt', 'metadata'
      ];

      // 데이터 행 구성
      const rows = [headers];
      data.forEach(item => {
        rows.push([
          item.profileId || item.id,
          item.name,
          item.email,
          item.status,
          item.createdAt?.toISOString ? item.createdAt.toISOString() : item.createdAt,
          item.updatedAt?.toISOString ? item.updatedAt.toISOString() : item.updatedAt,
          JSON.stringify(item.metadata || {})
        ]);
      });

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:G`,
        valueInputOption: 'RAW',
        requestBody: {
          values: rows
        }
      });

      return true;
    } catch (error) {
      throw new Error(`Failed to update sheet data: ${error.message}`);
    }
  }

  /**
   * 프로필 ID로 조회
   */
  async findById(profileId) {
    try {
      const data = await this.getSheetData();
      const row = data.find(r => r.profileId === profileId || r.id === profileId);
      
      if (!row) return null;

      return new Profile({
        id: row.profileId || row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
      });
    } catch (error) {
      console.error(`Error finding profile by ID: ${error.message}`);
      return null;
    }
  }

  /**
   * 이메일로 프로필 조회
   */
  async findByEmail(email) {
    try {
      const data = await this.getSheetData();
      const row = data.find(r => r.email === email);
      
      if (!row) return null;

      return new Profile({
        id: row.profileId || row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
      });
    } catch (error) {
      console.error(`Error finding profile by email: ${error.message}`);
      return null;
    }
  }

  /**
   * 모든 프로필 조회
   */
  async findAll(options = {}) {
    try {
      const data = await this.getSheetData();
      
      const profiles = data.map(row => new Profile({
        id: row.profileId || row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date()
      }));

      // 필터링 옵션 적용
      if (options.status) {
        return profiles.filter(p => p.status === options.status);
      }

      if (options.limit) {
        return profiles.slice(0, options.limit);
      }

      return profiles;
    } catch (error) {
      console.error(`Error finding all profiles: ${error.message}`);
      return [];
    }
  }

  /**
   * 프로필 저장
   */
  async save(profile) {
    try {
      const data = await this.getSheetData();
      
      // 기존 프로필 찾기
      const existingIndex = data.findIndex(r => 
        r.profileId === profile.id || r.id === profile.id
      );

      const profileData = {
        profileId: profile.id,
        name: profile.name,
        email: profile.email,
        status: profile.status,
        createdAt: profile.createdAt?.toISOString ? profile.createdAt.toISOString() : profile.createdAt,
        updatedAt: new Date().toISOString(),
        metadata: JSON.stringify(profile.metadata || {})
      };

      if (existingIndex >= 0) {
        // 업데이트
        data[existingIndex] = profileData;
      } else {
        // 새로 추가
        data.push(profileData);
      }

      await this.updateSheetData(data);
      return profile;
      
    } catch (error) {
      throw new Error(`Failed to save profile: ${error.message}`);
    }
  }

  /**
   * 프로필 업데이트
   */
  async update(profileId, updates) {
    try {
      const profile = await this.findById(profileId);
      if (!profile) {
        throw new Error(`Profile ${profileId} not found`);
      }

      // 업데이트 적용
      Object.keys(updates).forEach(key => {
        if (key !== 'id' && updates[key] !== undefined) {
          profile[key] = updates[key];
        }
      });

      profile.updatedAt = new Date();
      
      return await this.save(profile);
    } catch (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }
  }

  /**
   * 프로필 삭제
   */
  async delete(profileId) {
    try {
      const data = await this.getSheetData();
      const filteredData = data.filter(r => 
        r.profileId !== profileId && r.id !== profileId
      );

      if (data.length === filteredData.length) {
        return false; // 삭제할 항목이 없음
      }

      await this.updateSheetData(filteredData);
      return true;
      
    } catch (error) {
      console.error(`Error deleting profile: ${error.message}`);
      return false;
    }
  }

  /**
   * 애즈파워현황 시트에서 데이터 가져오기
   * @returns {Array} 시트의 모든 행 데이터 (2차원 배열)
   */
  async getAdsPowerStatusData() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '애즈파워현황!A:E' // A~E열만 가져오기 (프로필번호, AdsPower ID, 그룹, 이메일, 기타)
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return []; // 헤더만 있거나 비어있는 경우

      // 헤더 제외하고 데이터 행만 반환
      return rows.slice(1);

    } catch (error) {
      console.error(`애즈파워현황 시트 읽기 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 결제재개 시트에서 데이터 가져오기
   * @returns {Array} 시트의 모든 행 데이터 (2차원 배열)
   */
  async getResumeSheetData() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '결제재개!A:F' // A~F열 가져오기
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return []; // 헤더만 있거나 비어있는 경우

      // 헤더 제외하고 데이터 행만 반환
      return rows.slice(1);

    } catch (error) {
      console.error(`결제재개 시트 읽기 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 상태별 프로필 조회
   */
  async findByStatus(status) {
    return await this.findAll({ status });
  }

  /**
   * 모든 프로필 조회
   */
  async getAllProfiles() {
    try {
      // 애즈파워현황 시트 실제 구조:
      // A: 애즈파워번호, B: 애즈파워아이디(profileId), C: group, D: 아이디(이메일)
      await this.initialize();
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:D`
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return []; // 헤더만 있거나 비어있는 경우

      // 헤더를 제외한 데이터 행들을 Profile로 변환
      const profiles = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue; // 빈 행 건너뛰기
        
        // profileId와 이메일이 있는 경우만 추가
        if (row[1] && row[3]) {
          profiles.push(new Profile({
            profileId: row[1], // B열: 애즈파워아이디
            name: row[2] || '', // C열: group (이름 대신 사용)
            email: row[3], // D열: 아이디(이메일)
            status: 'active', // 기본값으로 active 설정
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
              number: row[0] || '', // A열: 애즈파워번호
              group: row[2] || '' // C열: group
            }
          }));
        }
      }
      
      return profiles;
    } catch (error) {
      console.error(`Error getting all profiles: ${error.message}`);
      return [];
    }
  }

  /**
   * 프로필을 이메일로 조회 (별칭)
   */
  async getProfileByEmail(email) {
    return await this.findByEmail(email);
  }

  /**
   * 연결 테스트
   */
  async testConnection() {
    try {
      await this.initialize();
      
      // 시트 메타데이터 가져오기 시도
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId
      });
      
      return response.data ? true : false;
    } catch (error) {
      console.error(`Connection test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 시트 존재 여부 확인
   * @param {string} sheetName - 확인할 시트 이름
   * @returns {Promise<boolean>}
   */
  async checkSheetExists(sheetName) {
    await this.initialize();
    
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.config.spreadsheetId,
        fields: 'sheets.properties.title'
      });
      
      const sheets = response.data.sheets || [];
      return sheets.some(sheet => sheet.properties.title === sheetName);
    } catch (error) {
      console.error(`시트 확인 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 새 시트 생성
   * @param {string} sheetName - 생성할 시트 이름
   * @returns {Promise<void>}
   */
  async createSheet(sheetName) {
    await this.initialize();
    
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });
    } catch (error) {
      throw new Error(`시트 생성 실패: ${error.message}`);
    }
  }

  /**
   * 시트에 헤더 설정
   * @param {string} sheetName - 시트 이름
   * @param {string[]} headers - 헤더 배열
   * @returns {Promise<void>}
   */
  async setHeaders(sheetName, headers) {
    await this.initialize();
    
    try {
      const range = `${sheetName}!A1:${String.fromCharCode(65 + headers.length - 1)}1`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers]
        }
      });
    } catch (error) {
      throw new Error(`헤더 설정 실패: ${error.message}`);
    }
  }

  /**
   * 시트에 행 추가
   * @param {string} sheetName - 시트 이름
   * @param {Array<Array<string>>} rows - 추가할 행 데이터
   * @returns {Promise<void>}
   */
  async appendRows(sheetName, rows) {
    await this.initialize();
    
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows
        }
      });
    } catch (error) {
      throw new Error(`행 추가 실패: ${error.message}`);
    }
  }

  /**
   * 시트 데이터 읽기
   * @param {string} range - 읽을 범위 (예: 'Sheet1!A:Z')
   * @returns {Promise<Array<Array<string>>>}
   */
  async readSheet(range) {
    await this.initialize();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range
      });
      
      return response.data.values || [];
    } catch (error) {
      throw new Error(`시트 읽기 실패: ${error.message}`);
    }
  }
}

module.exports = GoogleSheetsProfileRepository;