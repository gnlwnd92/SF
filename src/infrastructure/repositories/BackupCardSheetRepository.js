/**
 * 백업카드 변경 Google Sheets Repository
 * 3개 시트 관리: 백업카드변경, 백업카드, 파키스탄주소
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;

class BackupCardSheetRepository {
  constructor({ spreadsheetId, serviceAccountPath }) {
    this.spreadsheetId = spreadsheetId;
    this.serviceAccountPath = serviceAccountPath;
    this.sheets = null;
    this.auth = null;

    // 시트 이름 정의
    this.SHEET_NAMES = {
      BACKUP_CARD_CHANGE: '백업카드변경',  // A~I (9열)
      BACKUP_CARD: '백업카드',             // A~J (10열)
      PAKISTAN_ADDRESS: '파키스탄주소',    // A~I (9열)
      ADSPOWER_STATUS: '애즈파워현황'      // 프로필 매핑용
    };
  }

  /**
   * Google Sheets 인증 초기화
   */
  async initialize() {
    try {
      // 서비스 계정 키 파일 경로 - 여러 위치 시도
      const baseDir = path.resolve(__dirname, '..', '..', '..');
      const possiblePaths = [
        this.serviceAccountPath,
        path.join(baseDir, 'credentials', 'service-account.json'),
        path.join(baseDir, 'config', 'youtube-automation-439913-b1c8dfe38d92.json'),
        path.join(baseDir, 'service_account.json')
      ];

      let keyFile = null;
      let keyPath = null;

      for (const testPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(testPath, 'utf8');
          keyPath = testPath;
          console.log(`✅ 서비스 계정 키 파일 로드: ${keyPath}`);
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

      console.log('✅ Google Sheets 연결 성공');
      return true;
    } catch (error) {
      console.error('❌ Google Sheets 연결 실패:', error.message);
      throw error;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 백업카드변경 탭 메서드 (A~I, 9열)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 백업카드변경 대상 조회 (필터링 지원)
   * @param {Object} filter - 필터 옵션
   * @param {string} filter.status - 'default' | 'all' | 'custom'
   * @param {Array<string>} filter.emails - custom 모드시 이메일 목록
   * @returns {Array<Object>} 대상 프로필 배열
   */
  async getBackupCardChangeTargets(filter = {}) {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!A:I`
      });

      const rows = response.data.values || [];
      if (rows.length < 2) {
        console.log('[BackupCardSheetRepository] 백업카드변경 시트가 비어있습니다');
        return [];
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);

      // 모든 행을 객체로 변환
      let targets = dataRows.map((row, index) => ({
        email: row[0] || '',           // A열: 아이디 (이메일)
        password: row[1] || '',         // B열: 비밀번호
        recoveryEmail: row[2] || '',    // C열: 복구이메일
        totpSecret: row[3] || '',       // D열: 코드
        cardName: row[4] || '',         // E열: 카드이름
        addressName: row[5] || '',      // F열: 주소이름
        status: row[6] || '',           // G열: 상태
        ipAddress: row[7] || '',        // H열: IP
        result: row[8] || '',           // I열: 결과
        rowIndex: index + 2             // Sheet 행 번호 (1-based, 헤더 제외)
      }));

      // 필터 적용
      const statusFilter = filter.status || 'default';

      if (statusFilter === 'default') {
        // 대기중 또는 빈 상태만
        targets = targets.filter(t =>
          t.status === '대기중' || t.status === '' || !t.status
        );
        console.log(`[BackupCardSheetRepository] 기본 필터링: ${targets.length}개 프로필 (대기중/빈 상태)`);
      } else if (statusFilter === 'custom' && filter.emails) {
        // 특정 이메일만
        const emailSet = new Set(filter.emails);
        targets = targets.filter(t => emailSet.has(t.email));
        console.log(`[BackupCardSheetRepository] 커스텀 필터링: ${targets.length}개 프로필 (지정된 이메일)`);
      } else if (statusFilter === 'all') {
        // 전체 반환
        console.log(`[BackupCardSheetRepository] 전체 선택: ${targets.length}개 프로필`);
      }

      return targets;
    } catch (error) {
      console.error('[BackupCardSheetRepository] 백업카드변경 대상 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * 이메일로 프로필 ID 찾기 (애즈파워현황 D열 → B열 매핑)
   * @param {string} email - 이메일 주소
   * @returns {string|null} 프로필 ID
   */
  async findProfileIdByEmail(email) {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.SHEET_NAMES.ADSPOWER_STATUS}!A:D`
      });

      const rows = response.data.values || [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[3] === email) { // D열이 이메일
          console.log(`[BackupCardSheetRepository] 프로필 ID 매핑: ${email} → ${row[1]}`);
          return row[1]; // B열이 profileId
        }
      }

      console.log(`[BackupCardSheetRepository] ⚠️ 이메일 ${email}에 매칭된 프로필 없음`);
      return null;
    } catch (error) {
      console.error(`[BackupCardSheetRepository] 프로필 ID 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 이메일로 모든 매칭 프로필 ID 찾기 (Fallback용)
   * @param {string} email - 이메일 주소
   * @returns {Array<Object>} 매칭된 프로필 배열
   */
  async findAllProfileIdsByEmail(email) {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.SHEET_NAMES.ADSPOWER_STATUS}!A:D`
      });

      const rows = response.data.values || [];
      const matches = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[3] === email) { // D열이 이메일
          matches.push({
            profileId: row[1],       // B열: 애즈파워아이디
            profileName: row[0],     // A열: 프로필명
            email: row[3],           // D열: 이메일
            rowIndex: i + 1
          });
        }
      }

      console.log(`[BackupCardSheetRepository] 이메일 ${email} → ${matches.length}개 프로필 발견`);
      return matches;
    } catch (error) {
      console.error(`[BackupCardSheetRepository] 모든 프로필 ID 조회 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 백업카드변경 결과 업데이트 (Retry 지원)
   * @param {string} email - 이메일
   * @param {Object} data - 업데이트 데이터
   * @param {number} retryCount - 재시도 횟수 (기본 3회)
   * @returns {boolean} 성공 여부
   */
  async updateBackupCardChangeStatus(email, data, retryCount = 3) {
    if (!this.sheets) {
      await this.initialize();
    }

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        // 행 찾기
        const targets = await this.getBackupCardChangeTargets({ status: 'all' });
        const target = targets.find(t => t.email === email);

        if (!target) {
          throw new Error(`이메일 ${email}을 백업카드변경 시트에서 찾을 수 없습니다`);
        }

        const rowIndex = target.rowIndex;
        const updateData = [];

        // E열: 카드이름 (선택된 카드 기록)
        if (data.cardName !== undefined) {
          updateData.push({
            range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!E${rowIndex}`,
            values: [[data.cardName]]
          });
        }

        // F열: 주소이름 (선택된 주소 기록)
        if (data.addressName !== undefined) {
          updateData.push({
            range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!F${rowIndex}`,
            values: [[data.addressName]]
          });
        }

        // G열: 상태
        if (data.status !== undefined) {
          updateData.push({
            range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!G${rowIndex}`,
            values: [[data.status]]
          });
        }

        // H열: IP
        if (data.ipAddress !== undefined) {
          updateData.push({
            range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!H${rowIndex}`,
            values: [[data.ipAddress]]
          });
        }

        // I열: 결과
        if (data.result !== undefined) {
          updateData.push({
            range: `${this.SHEET_NAMES.BACKUP_CARD_CHANGE}!I${rowIndex}`,
            values: [[data.result]]
          });
        }

        // 배치 업데이트 실행
        if (updateData.length > 0) {
          await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              valueInputOption: 'USER_ENTERED',
              data: updateData
            }
          });

          console.log(`[BackupCardSheetRepository] ✅ 백업카드변경 시트 업데이트 완료: ${email} (행 ${rowIndex})`);
          return true;
        }

        return false;

      } catch (error) {
        console.error(`[BackupCardSheetRepository] ⚠️ 업데이트 실패 (시도 ${attempt + 1}/${retryCount}): ${error.message}`);

        if (attempt === retryCount - 1) {
          throw error; // 마지막 시도 실패시 에러 전파
        }

        // 재시도 전 1초 대기
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 백업카드 탭 메서드 (A~J, 10열)
  // ⚠️ E열 cardholderName은 사용하지 않음
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 활성화된 백업카드 조회
   * @returns {Array<Object>} 활성 카드 배열
   */
  async getActiveCards() {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.SHEET_NAMES.BACKUP_CARD}!A:J`
      });

      const rows = response.data.values || [];
      if (rows.length < 2) {
        console.log('[BackupCardSheetRepository] 백업카드 시트가 비어있습니다');
        return [];
      }

      const dataRows = rows.slice(1);

      // G열(활성화) = 'TRUE'인 카드만
      const activeCards = dataRows
        .filter(row => row[6] === 'TRUE')
        .map(row => ({
          cardName: row[0],
          cardNumber: row[1],         // 마스킹 필요
          expiryDate: row[2],
          cvv: row[3],
          // cardholderName: row[4],  // ⚠️ 사용하지 않음 (YouTube 입력 필드 없음)
          cardType: row[5],
          isActive: row[6],
          usageCount: parseInt(row[7] || '0'),
          lastUsedDate: row[8] || '',
          notes: row[9] || ''
        }));

      console.log(`[BackupCardSheetRepository] 활성화된 백업카드 ${activeCards.length}개 조회`);
      return activeCards;
    } catch (error) {
      console.error('[BackupCardSheetRepository] 백업카드 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * 카드 이름으로 카드 찾기
   * @param {string} cardName - 카드 이름
   * @returns {Object|null} 카드 객체
   */
  async findCardByName(cardName) {
    const allCards = await this.getActiveCards();
    const card = allCards.find(card => card.cardName === cardName);

    if (card) {
      console.log(`[BackupCardSheetRepository] 카드 발견: ${cardName}`);
    } else {
      console.log(`[BackupCardSheetRepository] ⚠️ 카드 없음: ${cardName}`);
    }

    return card || null;
  }

  /**
   * 카드 사용 횟수 업데이트 (Retry 지원)
   * @param {string} cardName - 카드 이름
   * @param {number} retryCount - 재시도 횟수 (기본 3회)
   * @returns {boolean} 성공 여부
   */
  async incrementCardUsage(cardName, retryCount = 3) {
    if (!this.sheets) {
      await this.initialize();
    }

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${this.SHEET_NAMES.BACKUP_CARD}!A:J`
        });

        const rows = response.data.values || [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row[0] === cardName) {
            const currentCount = parseInt(row[7] || '0');
            const newCount = currentCount + 1;
            const today = new Date().toISOString().split('T')[0];

            await this.sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: this.spreadsheetId,
              resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                  {
                    range: `${this.SHEET_NAMES.BACKUP_CARD}!H${i + 1}`, // H열: 사용횟수
                    values: [[newCount]]
                  },
                  {
                    range: `${this.SHEET_NAMES.BACKUP_CARD}!I${i + 1}`, // I열: 마지막사용일
                    values: [[today]]
                  }
                ]
              }
            });

            console.log(`[BackupCardSheetRepository] ✅ 카드 사용 횟수 업데이트: ${cardName} (${newCount}회)`);
            return true;
          }
        }

        console.log(`[BackupCardSheetRepository] ⚠️ 카드 없음: ${cardName}`);
        return false;

      } catch (error) {
        console.error(`[BackupCardSheetRepository] ⚠️ 카드 사용 횟수 업데이트 실패 (시도 ${attempt + 1}/${retryCount}): ${error.message}`);

        if (attempt === retryCount - 1) {
          throw error;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 파키스탄주소 탭 메서드 (A~I, 9열)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 활성화된 주소 조회
   * @returns {Array<Object>} 활성 주소 배열
   */
  async getActiveAddresses() {
    if (!this.sheets) {
      await this.initialize();
    }

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.SHEET_NAMES.PAKISTAN_ADDRESS}!A:I`
      });

      const rows = response.data.values || [];
      if (rows.length < 2) {
        console.log('[BackupCardSheetRepository] 파키스탄주소 시트가 비어있습니다');
        return [];
      }

      const dataRows = rows.slice(1);

      // F열(활성화) = 'TRUE'인 주소만
      const activeAddresses = dataRows
        .filter(row => row[5] === 'TRUE')
        .map(row => ({
          addressName: row[0],
          country: row[1],
          streetAddress: row[2],
          city: row[3],
          postalCode: row[4],
          isActive: row[5],
          usageCount: parseInt(row[6] || '0'),
          lastUsedDate: row[7] || '',
          notes: row[8] || ''
        }));

      console.log(`[BackupCardSheetRepository] 활성화된 주소 ${activeAddresses.length}개 조회`);
      return activeAddresses;
    } catch (error) {
      console.error('[BackupCardSheetRepository] 파키스탄주소 조회 실패:', error.message);
      throw error;
    }
  }

  /**
   * 주소 이름으로 주소 찾기
   * @param {string} addressName - 주소 이름
   * @returns {Object|null} 주소 객체
   */
  async findAddressByName(addressName) {
    const allAddresses = await this.getActiveAddresses();
    const address = allAddresses.find(addr => addr.addressName === addressName);

    if (address) {
      console.log(`[BackupCardSheetRepository] 주소 발견: ${addressName}`);
    } else {
      console.log(`[BackupCardSheetRepository] ⚠️ 주소 없음: ${addressName}`);
    }

    return address || null;
  }

  /**
   * 주소 사용 횟수 업데이트 (Retry 지원)
   * @param {string} addressName - 주소 이름
   * @param {number} retryCount - 재시도 횟수 (기본 3회)
   * @returns {boolean} 성공 여부
   */
  async incrementAddressUsage(addressName, retryCount = 3) {
    if (!this.sheets) {
      await this.initialize();
    }

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${this.SHEET_NAMES.PAKISTAN_ADDRESS}!A:I`
        });

        const rows = response.data.values || [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row[0] === addressName) {
            const currentCount = parseInt(row[6] || '0');
            const newCount = currentCount + 1;
            const today = new Date().toISOString().split('T')[0];

            await this.sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: this.spreadsheetId,
              resource: {
                valueInputOption: 'USER_ENTERED',
                data: [
                  {
                    range: `${this.SHEET_NAMES.PAKISTAN_ADDRESS}!G${i + 1}`, // G열: 사용횟수
                    values: [[newCount]]
                  },
                  {
                    range: `${this.SHEET_NAMES.PAKISTAN_ADDRESS}!H${i + 1}`, // H열: 마지막사용일
                    values: [[today]]
                  }
                ]
              }
            });

            console.log(`[BackupCardSheetRepository] ✅ 주소 사용 횟수 업데이트: ${addressName} (${newCount}회)`);
            return true;
          }
        }

        console.log(`[BackupCardSheetRepository] ⚠️ 주소 없음: ${addressName}`);
        return false;

      } catch (error) {
        console.error(`[BackupCardSheetRepository] ⚠️ 주소 사용 횟수 업데이트 실패 (시도 ${attempt + 1}/${retryCount}): ${error.message}`);

        if (attempt === retryCount - 1) {
          throw error;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * 숫자를 알파벳 컬럼으로 변환 (0 -> A, 1 -> B, ...)
   * @param {number} column - 컬럼 인덱스
   * @returns {string} 알파벳 컬럼
   */
  columnToLetter(column) {
    let temp;
    let letter = '';
    while (column >= 0) {
      temp = column % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = Math.floor(column / 26) - 1;
    }
    return letter;
  }
}

module.exports = BackupCardSheetRepository;
