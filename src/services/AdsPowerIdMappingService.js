/**
 * AdsPower ID 매핑 서비스
 * 애즈파워현황 시트에서 이메일 기반으로 올바른 AdsPower ID를 찾습니다
 */

class AdsPowerIdMappingService {
  constructor({ googleSheetsProfileRepository, logger }) {
    this.sheetsRepo = googleSheetsProfileRepository;
    this.logger = logger;
    this.emailToIdsMap = new Map();
    this.initialized = false;
  }

  /**
   * 서비스 초기화 - 애즈파워현황 시트에서 모든 매핑 로드
   */
  async initialize() {
    try {
      this.logger.info('AdsPower ID 매핑 서비스 초기화 시작...');

      // 애즈파워현황 시트에서 모든 데이터 로드
      let adsPowerData = [];

      // sheetsRepo가 getAdsPowerStatusData 메서드를 가지고 있는지 확인
      if (typeof this.sheetsRepo.getAdsPowerStatusData === 'function') {
        adsPowerData = await this.sheetsRepo.getAdsPowerStatusData();
      } else {
        // 없으면 직접 Google Sheets API 호출
        const { google } = require('googleapis');
        const path = require('path');
        const fs = require('fs').promises;

        try {
          // Service Account 인증
          const keyPath = path.join(__dirname, '..', '..', 'credentials', 'service-account.json');
          const keyFile = await fs.readFile(keyPath, 'utf8');
          const key = JSON.parse(keyFile);

          const auth = new google.auth.JWT(
            key.client_email,
            null,
            key.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
          );

          await auth.authorize();
          const sheets = google.sheets({ version: 'v4', auth });

          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: '애즈파워현황!A:D'
          });

          adsPowerData = response.data.values || [];
        } catch (apiError) {
          this.logger.error('Google Sheets API 직접 호출 실패:', apiError);
        }
      }

      if (!adsPowerData || adsPowerData.length === 0) {
        this.logger.warn('애즈파워현황 시트가 비어있거나 접근할 수 없습니다');
        this.initialized = true;
        return;
      }

      // 이메일별로 AdsPower ID들을 매핑
      let mappingCount = 0;
      for (const row of adsPowerData) {
        // D열(인덱스 3)에 이메일, B열(인덱스 1)에 AdsPower ID
        const email = row[3]?.toString().trim().toLowerCase();
        const adsPowerId = row[1]?.toString().trim();

        if (email && adsPowerId) {
          if (!this.emailToIdsMap.has(email)) {
            this.emailToIdsMap.set(email, []);
          }

          // 중복 제거하면서 추가
          const existingIds = this.emailToIdsMap.get(email);
          if (!existingIds.includes(adsPowerId)) {
            existingIds.push(adsPowerId);
            mappingCount++;
          }
        }
      }

      this.logger.info(`✅ AdsPower ID 매핑 완료: ${this.emailToIdsMap.size}개 이메일, ${mappingCount}개 ID`);
      this.initialized = true;

    } catch (error) {
      this.logger.error('AdsPower ID 매핑 초기화 실패:', error);
      // 실패해도 서비스는 계속 실행 (빈 맵으로)
      this.initialized = true;
    }
  }

  /**
   * 이메일로 AdsPower ID 찾기
   * @param {string} email - 검색할 이메일
   * @returns {Array<string>} AdsPower ID 배열
   */
  async findAdsPowerIds(email) {
    // 초기화되지 않았다면 초기화
    if (!this.initialized) {
      await this.initialize();
    }

    if (!email) {
      this.logger.warn('이메일이 제공되지 않았습니다');
      return [];
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    const ids = this.emailToIdsMap.get(normalizedEmail) || [];

    if (ids.length === 0) {
      // 맵에 없다면 시트에서 직접 검색 시도 (실시간 업데이트 대응)
      this.logger.info(`캐시에서 찾을 수 없어 시트에서 직접 검색: ${email}`);
      const freshIds = await this.searchInSheet(normalizedEmail);

      if (freshIds.length > 0) {
        // 캐시 업데이트
        this.emailToIdsMap.set(normalizedEmail, freshIds);
        return freshIds;
      }
    }

    return ids;
  }

  /**
   * 시트에서 직접 검색 (캐시 미스 시)
   */
  async searchInSheet(email) {
    try {
      let adsPowerData = [];

      // sheetsRepo가 getAdsPowerStatusData 메서드를 가지고 있는지 확인
      if (typeof this.sheetsRepo.getAdsPowerStatusData === 'function') {
        adsPowerData = await this.sheetsRepo.getAdsPowerStatusData();
      } else {
        // 없으면 직접 Google Sheets API 호출
        const { google } = require('googleapis');
        const path = require('path');
        const fs = require('fs').promises;

        try {
          const keyPath = path.join(__dirname, '..', '..', 'credentials', 'service-account.json');
          const keyFile = await fs.readFile(keyPath, 'utf8');
          const key = JSON.parse(keyFile);

          const auth = new google.auth.JWT(
            key.client_email,
            null,
            key.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
          );

          await auth.authorize();
          const sheets = google.sheets({ version: 'v4', auth });

          const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

          const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: '애즈파워현황!A:D'
          });

          adsPowerData = response.data.values || [];
        } catch (apiError) {
          this.logger.error('Google Sheets API 직접 호출 실패:', apiError);
          return [];
        }
      }
      const foundIds = [];

      for (const row of adsPowerData) {
        const rowEmail = row[3]?.toString().trim().toLowerCase();
        const adsPowerId = row[1]?.toString().trim();

        if (rowEmail === email && adsPowerId) {
          if (!foundIds.includes(adsPowerId)) {
            foundIds.push(adsPowerId);
          }
        }
      }

      if (foundIds.length > 0) {
        this.logger.info(`✅ 시트에서 ${email}에 대한 ${foundIds.length}개 ID 발견`);
      }

      return foundIds;

    } catch (error) {
      this.logger.error(`시트 검색 실패 (${email}):`, error);
      return [];
    }
  }

  /**
   * 이메일로 AdsPower ID 목록 가져오기 (결제재개와 동일한 메서드명)
   * @param {string} email - 검색할 이메일
   * @returns {Array<string>} AdsPower ID 배열
   */
  getAdsPowerIdsByEmail(email) {
    // findAdsPowerIds와 동일한 기능이지만 동기 버전으로 캐시에서만 가져옴
    if (!email) return [];
    const normalizedEmail = email.toString().trim().toLowerCase();
    return this.emailToIdsMap.get(normalizedEmail) || [];
  }

  /**
   * 첫 번째 사용 가능한 AdsPower ID 반환
   * @param {string} email - 검색할 이메일
   * @returns {string|null} AdsPower ID 또는 null
   */
  async getFirstAvailableId(email) {
    const ids = await this.findAdsPowerIds(email);
    return ids.length > 0 ? ids[0] : null;
  }

  /**
   * 특정 ID가 유효한지 확인 (패스워드가 아닌지 체크)
   * @param {string} id - 검증할 ID
   * @returns {boolean} 유효한 AdsPower ID인지 여부
   */
  isValidAdsPowerId(id) {
    if (!id) return false;

    // 패스워드 특성 체크 (특수문자 포함)
    const passwordPattern = /[!@#$%^&*(),.?":{}|<>]/;
    if (passwordPattern.test(id)) {
      this.logger.warn(`잘못된 AdsPower ID 감지 (패스워드로 추정): ${id.substring(0, 10)}...`);
      return false;
    }

    // AdsPower ID 형식 체크 (보통 알파벳과 숫자 조합)
    const validIdPattern = /^[a-zA-Z0-9]+$/;
    return validIdPattern.test(id);
  }

  /**
   * 캐시 새로고침
   */
  async refresh() {
    this.logger.info('AdsPower ID 매핑 캐시 새로고침...');
    this.emailToIdsMap.clear();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * 현재 매핑 통계 반환
   */
  getStats() {
    const totalEmails = this.emailToIdsMap.size;
    let totalIds = 0;
    let multiIdEmails = 0;

    for (const [email, ids] of this.emailToIdsMap) {
      totalIds += ids.length;
      if (ids.length > 1) {
        multiIdEmails++;
      }
    }

    return {
      totalEmails,
      totalIds,
      multiIdEmails,
      averageIdsPerEmail: totalEmails > 0 ? (totalIds / totalEmails).toFixed(2) : 0
    };
  }
}

module.exports = AdsPowerIdMappingService;