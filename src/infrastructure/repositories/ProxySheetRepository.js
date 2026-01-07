/**
 * ProxySheetRepository
 * Google Sheets '프록시' 시트에서 프록시 정보를 읽어오는 Repository
 *
 * 시트 구조:
 * A: ID (Proxy_kr_1)
 * B: 유형 (SOCKS5)
 * C: 호스트 (gate.decodo.com)
 * D: 포트 (7000)
 * E: 사용자명 (session-N-sessionduration-1440-country-kr)
 * F: 비밀번호
 * G: 국가 (KR)
 * H: 상태 (활성/비활성)
 * I: 연속실패횟수 (0)
 * J: 마지막사용시간
 * K: 최근IP
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;

class ProxySheetRepository {
  constructor({ spreadsheetId, serviceAccountPath }) {
    this.spreadsheetId = spreadsheetId;
    this.serviceAccountPath = serviceAccountPath;
    this.sheets = null;
    this.auth = null;
    this.sheetName = '프록시';
    this.initialized = false;
  }

  /**
   * Google Sheets 인증 초기화
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 서비스 계정 키 파일 경로 - 여러 위치 시도
      const baseDir = path.resolve(__dirname, '..', '..', '..');
      const possiblePaths = [
        this.serviceAccountPath,
        path.join(baseDir, 'credentials', 'service-account.json'),
        path.join(baseDir, 'service_account.json')
      ].filter(Boolean);

      let keyFile = null;
      let keyPath = null;

      for (const testPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(testPath, 'utf8');
          keyPath = testPath;
          console.log(`[ProxySheetRepository] 서비스 계정 키 로드: ${keyPath}`);
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

      // 인증
      await this.auth.authorize();

      // Sheets API 클라이언트 생성
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });

      this.initialized = true;
      console.log('[ProxySheetRepository] Google Sheets 연결 성공');
      return true;

    } catch (error) {
      console.error('[ProxySheetRepository] 초기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * 국가별 프록시 목록 조회
   * @param {string} country - 국가 코드 (예: 'kr', 'us')
   * @returns {Promise<Array>} 프록시 목록
   */
  async getProxiesByCountry(country) {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:K`
      });

      const rows = response.data.values || [];

      // 헤더만 있거나 빈 시트인 경우
      if (rows.length <= 1) {
        console.warn(`[ProxySheetRepository] '${this.sheetName}' 시트에 프록시 데이터가 없습니다`);
        return [];
      }

      // 데이터 파싱 (첫 번째 행은 헤더)
      // [v2.23] 빈 상태는 '비활성화'로 처리 (명시적으로 '활성' 설정 필요)
      const proxies = rows.slice(1).map((row, idx) => ({
        id: row[0] || '',
        유형: row[1] || 'SOCKS5',
        호스트: row[2] || '',
        포트: row[3] || '',
        사용자명: row[4] || '',
        비밀번호: row[5] || '',
        국가: row[6] || 'KR',
        상태: row[7] || '비활성화',  // [v2.23] 빈 값 → 비활성화 (기존: 활성)
        연속실패횟수: row[8] || '0',
        마지막사용시간: row[9] || '',
        최근IP: row[10] || '',
        rowIndex: idx + 2  // 실제 시트 행 번호 (헤더=1, 데이터는 2부터)
      }));

      // 국가 필터링
      const filtered = proxies.filter(p =>
        p.국가.toUpperCase() === country.toUpperCase()
      );

      console.log(`[ProxySheetRepository] ${country.toUpperCase()} 프록시 ${filtered.length}개 조회됨`);

      return filtered;

    } catch (error) {
      console.error(`[ProxySheetRepository] 프록시 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 모든 프록시 목록 조회
   * @returns {Promise<Array>} 전체 프록시 목록
   */
  async getAllProxies() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:K`
      });

      const rows = response.data.values || [];

      if (rows.length <= 1) {
        return [];
      }

      // [v2.23] 빈 상태는 '비활성화'로 처리 (명시적으로 '활성' 설정 필요)
      return rows.slice(1).map((row, idx) => ({
        id: row[0] || '',
        유형: row[1] || 'SOCKS5',
        호스트: row[2] || '',
        포트: row[3] || '',
        사용자명: row[4] || '',
        비밀번호: row[5] || '',
        국가: row[6] || 'KR',
        상태: row[7] || '비활성화',  // [v2.23] 빈 값 → 비활성화 (기존: 활성)
        연속실패횟수: row[8] || '0',
        마지막사용시간: row[9] || '',
        최근IP: row[10] || '',
        rowIndex: idx + 2
      }));

    } catch (error) {
      console.error(`[ProxySheetRepository] 전체 프록시 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 프록시 사용 정보 업데이트
   * @param {string} proxyId - 프록시 ID (예: Proxy_kr_1)
   * @param {Object} updateData - 업데이트할 데이터
   * @param {string} updateData.ip - 최근 IP
   * @param {Date} updateData.lastUsed - 마지막 사용 시간
   */
  async updateProxyUsage(proxyId, updateData = {}) {
    await this.initialize();

    try {
      // 먼저 프록시 ID로 행 번호 찾기
      const proxies = await this.getAllProxies();
      const proxy = proxies.find(p => p.id === proxyId);

      if (!proxy) {
        console.warn(`[ProxySheetRepository] 프록시를 찾을 수 없음: ${proxyId}`);
        return false;
      }

      const rowIndex = proxy.rowIndex;
      const updates = [];

      // 마지막 사용 시간 업데이트 (J열)
      if (updateData.lastUsed) {
        const timestamp = updateData.lastUsed instanceof Date
          ? updateData.lastUsed.toISOString()
          : new Date().toISOString();
        updates.push({
          range: `${this.sheetName}!J${rowIndex}`,
          values: [[timestamp]]
        });
      }

      // 최근 IP 업데이트 (K열)
      if (updateData.ip) {
        updates.push({
          range: `${this.sheetName}!K${rowIndex}`,
          values: [[updateData.ip]]
        });
      }

      if (updates.length === 0) {
        return true;
      }

      // 배치 업데이트
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          data: updates,
          valueInputOption: 'RAW'
        }
      });

      console.log(`[ProxySheetRepository] 프록시 사용 정보 업데이트: ${proxyId}`);
      return true;

    } catch (error) {
      console.error(`[ProxySheetRepository] 프록시 업데이트 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 프록시 연속 실패 횟수 증가
   * [v2.23] 2회 이상 실패 시 상태를 '비활성화'로 변경
   * @param {string} proxyId - 프록시 ID
   * @param {number} deactivateThreshold - 비활성화 임계값 (기본 2)
   * @returns {Promise<{success: boolean, newCount: number, deactivated: boolean}>}
   */
  async incrementFailureCount(proxyId, deactivateThreshold = 2) {
    await this.initialize();

    try {
      const proxies = await this.getAllProxies();
      const proxy = proxies.find(p => p.id === proxyId);

      if (!proxy) {
        return { success: false, newCount: 0, deactivated: false };
      }

      const newCount = (parseInt(proxy.연속실패횟수) || 0) + 1;
      let deactivated = false;

      // I열: 연속실패횟수 업데이트
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!I${proxy.rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [[String(newCount)]] }
      });

      // [v2.23] 2회 이상 실패 시 상태를 '비활성화'로 변경
      if (newCount >= deactivateThreshold) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!H${proxy.rowIndex}`,
          valueInputOption: 'RAW',
          resource: { values: [['비활성화']] }
        });
        deactivated = true;
        console.warn(`[ProxySheetRepository] ⚠️ 프록시 비활성화: ${proxyId} (${newCount}회 연속 실패)`);
      } else {
        console.warn(`[ProxySheetRepository] 프록시 실패 횟수 증가: ${proxyId} → ${newCount}`);
      }

      return { success: true, newCount, deactivated };

    } catch (error) {
      console.error(`[ProxySheetRepository] 실패 횟수 업데이트 실패: ${error.message}`);
      return { success: false, newCount: 0, deactivated: false };
    }
  }

  /**
   * 프록시 연속 실패 횟수 초기화
   * @param {string} proxyId - 프록시 ID
   */
  async resetFailureCount(proxyId) {
    await this.initialize();

    try {
      const proxies = await this.getAllProxies();
      const proxy = proxies.find(p => p.id === proxyId);

      if (!proxy) {
        return false;
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!I${proxy.rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [['0']] }
      });

      console.log(`[ProxySheetRepository] 프록시 실패 횟수 초기화: ${proxyId}`);
      return true;

    } catch (error) {
      console.error(`[ProxySheetRepository] 실패 횟수 초기화 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 국가별 프록시 통계 조회
   * [v2.23] '비활성화' 상태 체크 추가
   * @returns {Promise<Object>} 국가별 프록시 수
   */
  async getProxyStats() {
    try {
      const proxies = await this.getAllProxies();

      const stats = proxies.reduce((acc, proxy) => {
        const country = proxy.국가.toUpperCase();
        if (!acc[country]) {
          acc[country] = { total: 0, active: 0, inactive: 0 };
        }
        acc[country].total++;

        // [v2.23] '비활성화' 상태 포함 (2회 연속 실패 시 자동 설정)
        const inactiveStatuses = ['비활성', '비활성화', 'inactive', 'Inactive'];
        const isActive = !inactiveStatuses.includes(proxy.상태) &&
          (parseInt(proxy.연속실패횟수) || 0) < 3;
        if (isActive) {
          acc[country].active++;
        } else {
          acc[country].inactive++;
        }
        return acc;
      }, {});

      return stats;

    } catch (error) {
      console.error(`[ProxySheetRepository] 통계 조회 실패: ${error.message}`);
      return {};
    }
  }

  /**
   * 프록시 재활성화 (수동)
   * [v2.23] 비활성화된 프록시를 다시 활성화하고 실패 횟수 초기화
   * @param {string} proxyId - 프록시 ID
   * @returns {Promise<boolean>} 성공 여부
   */
  async reactivateProxy(proxyId) {
    await this.initialize();

    try {
      const proxies = await this.getAllProxies();
      const proxy = proxies.find(p => p.id === proxyId);

      if (!proxy) {
        console.warn(`[ProxySheetRepository] 프록시를 찾을 수 없음: ${proxyId}`);
        return false;
      }

      // H열: 상태를 '활성'으로 변경
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!H${proxy.rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [['활성']] }
      });

      // I열: 연속실패횟수 0으로 초기화
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!I${proxy.rowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [['0']] }
      });

      console.log(`[ProxySheetRepository] ✅ 프록시 재활성화 완료: ${proxyId}`);
      return true;

    } catch (error) {
      console.error(`[ProxySheetRepository] 프록시 재활성화 실패: ${error.message}`);
      return false;
    }
  }
}

module.exports = ProxySheetRepository;
