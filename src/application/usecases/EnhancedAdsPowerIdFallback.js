/**
 * 강화된 AdsPower ID 폴백 로직
 * 애즈파워현황 시트에서 모든 대체 ID를 찾아 순차적으로 시도
 */

const chalk = require('chalk');
const { google } = require('googleapis');

class EnhancedAdsPowerIdFallback {
  constructor({ adsPowerAdapter, logger, config }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.logger = logger || console;
    this.config = config || {};
    this.attemptedIds = new Set();
    this.emailToIdsCache = new Map();
  }

  /**
   * 이메일로 모든 가능한 AdsPower ID 찾기
   * 애즈파워현황 시트의 모든 데이터를 검색
   */
  async findAllAdsPowerIdsByEmail(email, options = {}) {
    const {
      useCache = true,
      includeHardcoded = true,
      searchAllSheets = false
    } = options;

    if (!email) {
      this.log('❌ 이메일이 제공되지 않았습니다', 'error');
      return [];
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 캐시 확인
    if (useCache && this.emailToIdsCache.has(normalizedEmail)) {
      const cachedIds = this.emailToIdsCache.get(normalizedEmail);
      this.log(`📦 캐시에서 ${cachedIds.length}개 ID 발견`, 'info');
      return cachedIds;
    }

    const allIds = new Set();

    // 1. 하드코딩된 매핑 추가 (테스트에서 확인된 ID들)
    if (includeHardcoded) {
      const hardcodedMappings = {
        'evidanak388@gmail.com': ['k12f1376', 'k1243ybm'],
        'wowuneja89@gmail.com': ['k12f1jpf', 'k124j34a'],
        'tressiesoaresbd11@gmail.com': ['k13jyr12'],
        'qoangteo12345@gmail.com': ['k14h1rw7', 'k132lrwh'],
        'maddox9johnson@gmail.com': ['k123x8ms'],
        'avacatellanos67@gmail.com': ['k11w7on9'],
        'brendawilliams9409@gmail.com': ['k124djd3'],
        'tracydbradford45@gmail.com': ['k145hfyi']
      };

      if (hardcodedMappings[normalizedEmail]) {
        hardcodedMappings[normalizedEmail].forEach(id => allIds.add(id));
        this.log(`✅ 하드코딩 매핑: ${Array.from(allIds).join(', ')}`, 'success');
      }
    }

    // 2. Google Sheets에서 검색
    try {
      const sheetsIds = await this.searchInGoogleSheets(normalizedEmail, searchAllSheets);
      sheetsIds.forEach(id => allIds.add(id));

      if (sheetsIds.length > 0) {
        this.log(`📊 Google Sheets에서 ${sheetsIds.length}개 ID 발견`, 'success');
      }
    } catch (error) {
      this.log(`⚠️ Google Sheets 검색 실패: ${error.message}`, 'warning');
    }

    // 3. AdsPowerIdMappingService 활용 (있는 경우)
    if (this.adsPowerIdMappingService) {
      try {
        const mappingIds = await this.adsPowerIdMappingService.findAdsPowerIds(normalizedEmail);
        mappingIds.forEach(id => allIds.add(id));

        if (mappingIds.length > 0) {
          this.log(`🗺️ ID 매핑 서비스에서 ${mappingIds.length}개 추가 발견`, 'success');
        }
      } catch (error) {
        // 매핑 서비스 실패는 무시
      }
    }

    const result = Array.from(allIds);

    // 캐시 저장
    if (useCache && result.length > 0) {
      this.emailToIdsCache.set(normalizedEmail, result);
    }

    this.log(`📌 총 ${result.length}개 AdsPower ID 수집: ${result.join(', ')}`, 'info');
    return result;
  }

  /**
   * Google Sheets에서 직접 검색
   */
  async searchInGoogleSheets(email, searchAllSheets = false) {
    const ids = [];

    try {
      // Google Sheets 인증
      const keyFile = await require('fs').promises.readFile('./credentials/service-account.json', 'utf8');
      const credentials = JSON.parse(keyFile);

      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });

      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

      if (!spreadsheetId) {
        throw new Error('GOOGLE_SHEETS_ID 환경변수가 설정되지 않았습니다');
      }

      // 검색할 시트 목록
      const sheetsToSearch = ['애즈파워현황'];

      if (searchAllSheets) {
        sheetsToSearch.push('일시정지', '결제재개', '삭제');
      }

      for (const sheetName of sheetsToSearch) {
        try {
          this.log(`  🔍 ${sheetName} 시트 검색 중...`, 'debug');

          const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:E`  // A-E 열 전체 검색
          });

          const rows = response.data.values;
          if (!rows || rows.length < 2) continue;

          // 헤더 분석 (첫 번째 행)
          const headers = rows[0];
          const emailColIndex = this.findEmailColumnIndex(headers);
          const idColIndex = this.findIdColumnIndex(headers);

          if (emailColIndex === -1 || idColIndex === -1) {
            this.log(`  ⚠️ ${sheetName}: 필요한 열을 찾을 수 없음`, 'warning');
            continue;
          }

          // 데이터 행 검색
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length <= Math.max(emailColIndex, idColIndex)) continue;

            const rowEmail = row[emailColIndex]?.toString().trim().toLowerCase();
            const rowId = row[idColIndex]?.toString().trim();

            if (rowEmail === email && rowId && !rowId.includes('@')) {
              // 이메일이 일치하고 ID가 유효한 경우
              ids.push(rowId);
              this.log(`    ✅ ${sheetName} 행 ${i + 1}: ${rowId}`, 'debug');
            }
          }
        } catch (error) {
          this.log(`  ❌ ${sheetName} 시트 검색 실패: ${error.message}`, 'error');
        }
      }
    } catch (error) {
      this.log(`❌ Google Sheets API 오류: ${error.message}`, 'error');
    }

    return ids;
  }

  /**
   * 이메일 열 인덱스 찾기
   */
  findEmailColumnIndex(headers) {
    const emailKeywords = ['email', 'e-mail', '이메일', 'gmail', 'google'];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]?.toString().toLowerCase() || '';
      if (emailKeywords.some(keyword => header.includes(keyword))) {
        return i;
      }
    }

    // 기본값: D열 (인덱스 3)
    return 3;
  }

  /**
   * AdsPower ID 열 인덱스 찾기
   */
  findIdColumnIndex(headers) {
    const idKeywords = ['adspower', '애즈파워', 'profile', 'id'];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]?.toString().toLowerCase() || '';
      if (idKeywords.some(keyword => header.includes(keyword))) {
        return i;
      }
    }

    // 기본값: B열 (인덱스 1)
    return 1;
  }

  /**
   * 브라우저 연결 시도 (폴백 로직 포함)
   */
  async connectBrowserWithFallback(primaryId, email, options = {}) {
    const {
      maxAttempts = 10,
      retryDelay = 1000,
      searchAllSheets = false
    } = options;

    const attemptedIds = new Set();
    let lastError = null;
    let successfulId = null;

    // 1. Primary ID로 먼저 시도
    if (primaryId && !this.isInvalidId(primaryId)) {
      this.log(`🔧 Primary ID 시도: ${primaryId}`, 'info');

      try {
        const browser = await this.tryLaunchBrowser(primaryId);
        if (browser) {
          this.log(`✅ Primary ID 성공: ${primaryId}`, 'success');
          return { browser, profileId: primaryId };
        }
      } catch (error) {
        this.log(`❌ Primary ID 실패: ${error.message}`, 'error');
        lastError = error;
        attemptedIds.add(primaryId);
      }
    }

    // 2. 이메일이 없으면 더 이상 진행 불가
    if (!email) {
      this.log('❌ 이메일 정보가 없어 대체 ID를 찾을 수 없습니다', 'error');
      throw lastError || new Error('프로필 ID와 이메일이 모두 제공되지 않았습니다');
    }

    // 3. 모든 가능한 대체 ID 찾기
    this.log(`🔍 ${email}의 모든 대체 ID 검색 중...`, 'info');
    const allPossibleIds = await this.findAllAdsPowerIdsByEmail(email, {
      useCache: true,
      includeHardcoded: true,
      searchAllSheets
    });

    if (allPossibleIds.length === 0) {
      this.log('❌ 대체 ID를 찾을 수 없습니다', 'error');
      throw new Error(`${email}에 대한 AdsPower 프로필을 찾을 수 없습니다`);
    }

    // 4. 모든 대체 ID로 순차적 시도
    this.log(`🔄 ${allPossibleIds.length}개의 ID로 시도합니다...`, 'info');

    for (let i = 0; i < allPossibleIds.length && i < maxAttempts; i++) {
      const candidateId = allPossibleIds[i];

      // 이미 시도한 ID는 건너뛰기
      if (attemptedIds.has(candidateId)) {
        this.log(`⏩ 이미 시도함: ${candidateId}`, 'debug');
        continue;
      }

      attemptedIds.add(candidateId);

      try {
        this.log(`🔧 대체 ID 시도 ${i + 1}/${Math.min(allPossibleIds.length, maxAttempts)}: ${candidateId}`, 'info');

        const browser = await this.tryLaunchBrowser(candidateId);

        if (browser) {
          successfulId = candidateId;
          this.log(`🎉 성공! 작동하는 ID: ${candidateId}`, 'success');
          this.log(`📌 앞으로 이 ID를 우선 사용하도록 캐시에 저장합니다`, 'info');

          // 성공한 ID를 캐시 맨 앞에 추가
          this.updateCacheWithSuccessfulId(email, candidateId);

          return { browser, profileId: candidateId };
        }
      } catch (error) {
        this.log(`❌ ${candidateId} 실패: ${error.message}`, 'warning');
        lastError = error;

        // 다음 시도 전 짧은 대기
        if (i < allPossibleIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    // 5. 모든 시도 실패
    this.log('❌ 모든 AdsPower ID 시도 실패', 'error');
    this.log(`  시도한 ID: ${Array.from(attemptedIds).join(', ')}`, 'error');

    throw lastError || new Error('사용 가능한 AdsPower 프로필을 찾을 수 없습니다');
  }

  /**
   * 브라우저 실행 시도
   */
  async tryLaunchBrowser(profileId) {
    if (!this.adsPowerAdapter) {
      throw new Error('AdsPowerAdapter가 설정되지 않았습니다');
    }

    const session = await this.adsPowerAdapter.launchBrowser(profileId);

    if (session && session.browser) {
      return session.browser;
    }

    throw new Error('브라우저 세션을 생성할 수 없습니다');
  }

  /**
   * 유효하지 않은 ID 체크
   */
  isInvalidId(profileId) {
    if (!profileId) return true;

    // 이메일 형식이거나 특수문자가 많은 경우 (비밀번호일 가능성)
    const invalidPatterns = [
      /@/,  // 이메일
      /[!#$%^&*(),.?":{}|<>]{3,}/  // 3개 이상의 특수문자
    ];

    return invalidPatterns.some(pattern => pattern.test(profileId));
  }

  /**
   * 성공한 ID로 캐시 업데이트
   */
  updateCacheWithSuccessfulId(email, successfulId) {
    const normalizedEmail = email.toLowerCase().trim();
    const currentIds = this.emailToIdsCache.get(normalizedEmail) || [];

    // 성공한 ID를 맨 앞으로 이동
    const updatedIds = [
      successfulId,
      ...currentIds.filter(id => id !== successfulId)
    ];

    this.emailToIdsCache.set(normalizedEmail, updatedIds);
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };

    const color = colors[level] || 'white';

    if (this.logger && typeof this.logger.log === 'function') {
      this.logger.log(message, level);
    } else {
      console.log(chalk[color](`[${timestamp}] ${message}`));
    }
  }
}

module.exports = EnhancedAdsPowerIdFallback;