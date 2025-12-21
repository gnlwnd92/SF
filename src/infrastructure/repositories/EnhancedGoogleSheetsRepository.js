const { google } = require('googleapis');
const path = require('path');
const fs = require('fs').promises;

/**
 * @class EnhancedGoogleSheetsRepository
 * @description Google Sheets 통합 레포지토리 (여러 탭 및 다중 시트 지원)
 */
class EnhancedGoogleSheetsRepository {
  constructor(config = {}) {
    // __dirname 기반으로 경로 설정 (경로 독립성 보장)
    const baseDir = path.resolve(__dirname, '..', '..', '..');

    // GoogleSheetsConfigService가 제공한 설정 우선 사용
    const spreadsheetId = config.spreadsheetId || process.env.GOOGLE_SHEETS_ID;

    if (!spreadsheetId) {
      throw new Error(
        '❌ Google Sheets ID가 설정되지 않았습니다!\n' +
        '.env 파일에 GOOGLE_SHEETS_ID를 설정하거나\n' +
        'config.spreadsheetId를 전달해주세요.'
      );
    }

    this.config = {
      spreadsheetId,
      serviceAccountPath: config.serviceAccountPath || path.join(baseDir, 'service_account.json'), // 상대 경로: ./service_account.json
      ...config
    };

    this.sheets = null;
    this.initialized = false;
    this.cache = new Map();
    this.currentSheetId = this.config.spreadsheetId; // 현재 시트 ID 추적
  }

  /**
   * 시트 ID 동적 변경
   */
  switchSheet(newSheetId, newServiceAccountPath = null) {
    if (this.currentSheetId === newSheetId) {
      console.log('📊 이미 선택된 시트입니다.');
      return;
    }

    this.config.spreadsheetId = newSheetId;
    this.currentSheetId = newSheetId;

    if (newServiceAccountPath) {
      this.config.serviceAccountPath = newServiceAccountPath;
    }

    // 재초기화 필요
    this.initialized = false;
    this.cache.clear();
    console.log(`📊 시트가 변경되었습니다: ${newSheetId}`);
  }

  /**
   * Google Sheets API 초기화 (타임아웃 개선)
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // 서비스 계정 키 파일 찾기
      let keyPath = this.config.serviceAccountPath;
      const baseDir = path.resolve(__dirname, '..', '..', '..');
      
      // 여러 경로 시도 (__dirname 기반)
      const possiblePaths = [
        keyPath,
        path.join(baseDir, 'credentials', 'service-account.json'),
        path.join(baseDir, 'service_account.json'),
        path.join(baseDir, '..', 'service_account.json'),
        path.join(baseDir, '..', '..', 'service_account.json'),
        process.env.GOOGLE_APPLICATION_CREDENTIALS
      ].filter(Boolean);

      let keyFile = null;
      for (const tryPath of possiblePaths) {
        try {
          keyFile = await fs.readFile(tryPath, 'utf8');
          console.log(`✅ 서비스 계정 키 파일 로드: ${tryPath}`);
          break;
        } catch (e) {
          continue;
        }
      }

      if (!keyFile) {
        throw new Error('서비스 계정 키 파일을 찾을 수 없습니다');
      }

      const key = JSON.parse(keyFile);

      // 인증 설정 (타임아웃 추가)
      const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        clientOptions: {
          timeout: 10000, // 10초 타임아웃
          retryOptions: {
            retries: 3,
            retryDelayMultiplier: 2,
            maxRetryDelay: 5000
          }
        }
      });

      // Sheets API 클라이언트 생성 (재시도 옵션 포함)
      this.sheets = google.sheets({ 
        version: 'v4', 
        auth,
        retry: true,
        retryConfig: {
          retries: 3,
          retryDelay: 1000
        }
      });
      this.initialized = true;
      
    } catch (error) {
      throw new Error(`Google Sheets 초기화 실패: ${error.message}`);
    }
  }

  /**
   * 애즈파워현황 탭 읽기
   * [애즈파워번호, 애즈파워아이디, group, 아이디]
   */
  async getAdsPowerProfiles() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '애즈파워현황!A:D'
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return [];

      const headers = rows[0];
      const data = rows.slice(1);

      return data.map(row => ({
        adsPowerNumber: row[0] || '',
        adsPowerId: row[1] || '',
        group: row[2] || '',
        googleId: row[3] || ''
      }));
    } catch (error) {
      console.error(`애즈파워현황 탭 읽기 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 일시중지 탭 읽기
   * [아이디, 비밀번호, 복구이메일, 코드, 상태, 다음결제일, IP, 결과]
   */
  async getPauseList() {
    await this.initialize();

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '일시중지!A:H'
      });

      const rows = response.data.values || [];
      if (rows.length <= 1) return [];

      const headers = rows[0];
      const data = rows.slice(1);

      return data.map((row, index) => ({
        rowIndex: index + 2, // 시트에서의 실제 행 번호 (헤더 제외)
        googleId: row[0] || '',
        password: row[1] || '',
        recoveryEmail: row[2] || '',
        code: row[3] || '',
        status: row[4] || '',
        nextPaymentDate: row[5] || '',
        ip: row[6] || '',
        result: row[7] || ''
      }));
    } catch (error) {
      console.error(`일시중지 탭 읽기 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 결제재개 탭 읽기 (타임아웃 포함)
   * [아이디, 비밀번호, 복구이메일, 코드, 상태, 다음결제일, IP, 결과]
   */
  async getResumeList() {
    await this.initialize();

    try {
      // API 호출을 타임아웃과 함께 실행
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('시트 읽기 타임아웃 (10초)')), 10000)
      );
      
      const dataPromise = this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '결제재개!A:H'
      });
      
      const response = await Promise.race([dataPromise, timeoutPromise]);

      const rows = response.data.values || [];
      if (rows.length <= 1) return [];

      const headers = rows[0];
      const data = rows.slice(1);

      return data.map((row, index) => ({
        rowIndex: index + 2, // 시트에서의 실제 행 번호
        googleId: row[0] || '',
        password: row[1] || '',
        recoveryEmail: row[2] || '',
        code: row[3] || '',
        status: row[4] || '',
        nextPaymentDate: row[5] || '',
        ip: row[6] || '',
        result: row[7] || ''
      }));
    } catch (error) {
      console.error(`결제재개 탭 읽기 실패: ${error.message}`);
      
      // 타임아웃 발생 시 더 자세한 로그
      if (error.message.includes('타임아웃')) {
        console.log('⚠️ Google Sheets API 응답 지연 - 네트워크 또는 권한 문제 확인 필요');
      }
      
      return [];
    }
  }

  /**
   * 결과 업데이트 (일시중지 탭)
   */
  async updatePauseResult(rowIndex, result, status = null, nextPaymentDate = null) {
    await this.initialize();

    try {
      const updates = [];
      
      // 결과 업데이트 (H열)
      updates.push({
        range: `일시중지!H${rowIndex}`,
        values: [[result]]
      });

      // 상태 업데이트 (E열)
      if (status) {
        updates.push({
          range: `일시중지!E${rowIndex}`,
          values: [[status]]
        });
      }

      // 다음 결제일 업데이트 (F열)
      if (nextPaymentDate) {
        updates.push({
          range: `일시중지!F${rowIndex}`,
          values: [[nextPaymentDate]]
        });
      }

      // 타임스탬프 추가 (결과에 포함)
      const timestamp = new Date().toLocaleString('ko-KR');
      updates[0].values[0][0] = `${result} (${timestamp})`;

      const response = await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          data: updates,
          valueInputOption: 'RAW'
        }
      });

      return response.data;
    } catch (error) {
      console.error(`결과 업데이트 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 결과 업데이트 (결제재개 탭)
   */
  async updateResumeResult(rowIndex, result, status = null, nextPaymentDate = null) {
    await this.initialize();

    try {
      const updates = [];
      
      // 결과 업데이트 (H열)
      updates.push({
        range: `결제재개!H${rowIndex}`,
        values: [[result]]
      });

      // 상태 업데이트 (E열)
      if (status) {
        updates.push({
          range: `결제재개!E${rowIndex}`,
          values: [[status]]
        });
      }

      // 다음 결제일 업데이트 (F열)
      if (nextPaymentDate) {
        updates.push({
          range: `결제재개!F${rowIndex}`,
          values: [[nextPaymentDate]]
        });
      }

      // 타임스탬프 추가
      const timestamp = new Date().toLocaleString('ko-KR');
      updates[0].values[0][0] = `${result} (${timestamp})`;

      const response = await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          data: updates,
          valueInputOption: 'RAW'
        }
      });

      return response.data;
    } catch (error) {
      console.error(`결과 업데이트 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 이메일 정규화 함수
   * 대소문자, 점(.), 하이픈(-), 언더스코어(_), 공백 등을 정규화
   */
  normalizeEmail(email) {
    if (!email) return '';
    
    // 이메일을 소문자로 변환하고 공백 제거
    let normalized = email.toLowerCase().trim();
    
    // Gmail의 경우 점(.)과 +이후 부분 제거
    if (normalized.includes('@gmail.com') || normalized.includes('@googlemail.com')) {
      // @ 앞부분과 뒷부분 분리
      const [localPart, domain] = normalized.split('@');
      // 점(.) 제거 및 + 이후 제거
      const cleanLocal = localPart.split('+')[0].replace(/\./g, '');
      // gmail.com과 googlemail.com 통일
      const cleanDomain = domain.replace('googlemail.com', 'gmail.com');
      normalized = `${cleanLocal}@${cleanDomain}`;
    }
    
    return normalized;
  }

  /**
   * 프로필 매핑 생성 (정규화된 이메일로 매핑)
   * Google ID -> AdsPower ID 매핑
   */
  async createProfileMapping() {
    const profiles = await this.getAdsPowerProfiles();
    const mapping = new Map();
    const normalizedMapping = new Map(); // 정규화된 이메일 매핑

    profiles.forEach(profile => {
      if (profile.googleId && profile.adsPowerId) {
        // 원본 이메일로 매핑
        mapping.set(profile.googleId, profile.adsPowerId);
        
        // 정규화된 이메일로도 매핑 (fallback용)
        const normalized = this.normalizeEmail(profile.googleId);
        if (normalized) {
          normalizedMapping.set(normalized, profile.adsPowerId);
        }
      }
    });

    // 통합 매핑 반환 (원본 우선, 정규화 fallback)
    return {
      get: (email) => {
        // 1. 원본 이메일로 먼저 찾기
        if (mapping.has(email)) {
          return mapping.get(email);
        }
        
        // 2. 정규화된 이메일로 찾기
        const normalized = this.normalizeEmail(email);
        if (normalizedMapping.has(normalized)) {
          console.log(`[Mapping] 정규화 매칭 성공: ${email} → ${normalized}`);
          return normalizedMapping.get(normalized);
        }
        
        // 3. 부분 매칭 시도 (유사도 기반)
        for (const [originalEmail, adsPowerId] of mapping.entries()) {
          if (this.isSimilarEmail(email, originalEmail)) {
            console.log(`[Mapping] 유사 매칭 성공: ${email} ≈ ${originalEmail}`);
            return adsPowerId;
          }
        }
        
        return null;
      },
      has: (email) => {
        return mapping.has(email) || 
               normalizedMapping.has(this.normalizeEmail(email));
      }
    };
  }

  /**
   * 이메일 유사도 체크
   */
  isSimilarEmail(email1, email2) {
    if (!email1 || !email2) return false;
    
    const norm1 = this.normalizeEmail(email1);
    const norm2 = this.normalizeEmail(email2);
    
    // 정규화 후 같으면 유사한 것으로 판단
    if (norm1 === norm2) return true;
    
    // @ 앞부분만 비교 (도메인 다른 경우)
    const [local1] = norm1.split('@');
    const [local2] = norm2.split('@');
    
    // 로컬 파트가 같고 길이가 충분하면 매칭
    if (local1 === local2 && local1.length > 5) {
      return true;
    }
    
    return false;
  }

  /**
   * 일시중지 작업 목록 가져오기 (매핑 포함)
   */
  async getPauseTasksWithMapping() {
    const [pauseList, mapping] = await Promise.all([
      this.getPauseList(),
      this.createProfileMapping()
    ]);

    return pauseList.map(task => ({
      ...task,
      adsPowerId: mapping.get(task.googleId) || null,
      hasMapping: mapping.has(task.googleId)
    }));
  }

  /**
   * 재개 작업 목록 가져오기 (매핑 포함) - 타임아웃 추가
   */
  async getResumeTasksWithMapping() {
    try {
      // 타임아웃 설정 (15초)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Google Sheets 조회 타임아웃 (15초)')), 15000)
      );
      
      // 실제 데이터 조회
      const dataPromise = Promise.all([
        this.getResumeList(),
        this.createProfileMapping()
      ]);
      
      // 타임아웃과 경쟁
      const [resumeList, mapping] = await Promise.race([dataPromise, timeoutPromise]);

      // AdsPower ID가 없는 계정 처리
      const noIdAccounts = [];
      const results = [];

      for (const task of resumeList) {
        const adsPowerId = mapping.get(task.googleId);
        
        if (!adsPowerId) {
          // AdsPower ID가 없는 계정
          noIdAccounts.push(task);
          
          // H열(결과)에 자동 기록 (비어있는 경우만)
          if (!task.result || task.result === '') {
            try {
              await this.updateResumeResult(
                task.rowIndex,
                '애즈파워 ID 없음 - 건너뜀',
                task.status,
                task.nextPaymentDate
              );
            } catch (updateError) {
              console.error(`결과 업데이트 실패 (${task.googleId}):`, updateError.message);
            }
          }
        }
        
        // 모든 계정을 결과에 포함 (ID 없는 계정도 표시)
        results.push({
          ...task,
          adsPowerId: adsPowerId || null,
          hasMapping: !!adsPowerId,
          skipReason: !adsPowerId ? 'NO_ADSPOWER_ID' : null
        });
      }

      // AdsPower ID 없는 계정 로그
      if (noIdAccounts.length > 0) {
        const chalk = require('chalk');
        console.log(chalk.yellow(`\n⚠️ AdsPower ID 없는 계정 ${noIdAccounts.length}개 발견:`));
        noIdAccounts.forEach(acc => {
          console.log(chalk.gray(`   - ${acc.googleId} (행 ${acc.rowIndex})`));
        });
        console.log(chalk.gray('   → H열에 "애즈파워 ID 없음 - 건너뜀" 기록\n'));
      }

      return results;
    } catch (error) {
      console.error('재개 작업 목록 조회 실패:', error.message);
      
      // 타임아웃 에러인 경우 빈 배열 반환
      if (error.message.includes('타임아웃')) {
        console.log('⚠️ Google Sheets 응답 없음 - 빈 목록 반환');
        return [];
      }
      
      throw error;
    }
  }

  /**
   * 가족요금제기존 탭에서 계정 목록 가져오기
   */
  async getExistingFamilyPlanAccounts() {
    await this.initialize();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '가족요금제기존!A:E'
      });
      
      const rows = response.data.values || [];
      if (rows.length <= 1) return [];
      
      const headers = rows[0];
      const data = rows.slice(1);
      
      return data.map((row, index) => ({
        rowIndex: index + 2, // 헤더 제외한 실제 행 번호
        googleId: row[0] || '',      // A열: 아이디
        password: row[1] || '',       // B열: 비밀번호
        recoveryEmail: row[2] || '',  // C열: 복구이메일
        totpSecret: row[3] || '',     // D열: TOTP 시크릿
        status: row[4] || '',         // E열: 상태
      }));
    } catch (error) {
      console.error(`가족요금제기존 탭 읽기 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 가족요금제기존 탭 상태 업데이트
   */
  async updateExistingFamilyPlanStatus(email, statusText, details = {}) {
    await this.initialize();
    
    try {
      // 먼저 해당 이메일의 행 찾기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: '가족요금제기존!A:A'
      });
      
      const emails = response.data.values || [];
      let targetRow = -1;
      
      // 이메일 정규화 (대소문자 무시, 공백 제거)
      const normalizedSearchEmail = this.normalizeEmail(email);
      
      for (let i = 1; i < emails.length; i++) {
        if (emails[i] && emails[i][0]) {
          const normalizedSheetEmail = this.normalizeEmail(emails[i][0]);
          if (normalizedSheetEmail === normalizedSearchEmail || 
              emails[i][0] === email) {
            targetRow = i + 1; // 시트에서의 실제 행 번호
            console.log(`✅ 이메일 매칭 성공: ${email} (행: ${targetRow})`);
            break;
          }
        }
      }
      
      if (targetRow === -1) {
        console.error(`❌ 이메일을 찾을 수 없습니다: ${email}`);
        console.log(`   시도한 이메일: ${email} (정규화: ${normalizedSearchEmail})`);
        console.log(`   전체 이메일 수: ${emails.length - 1}개`);
        return false;
      }
      
      // E열(상태) 업데이트
      const updateRange = `가족요금제기존!E${targetRow}`;
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.spreadsheetId,
        range: updateRange,
        valueInputOption: 'RAW',
        resource: {
          values: [[statusText]]
        }
      });
      
      console.log(`✅ 가족요금제기존 상태 업데이트 완료: ${email} → ${statusText}`);
      return true;
      
    } catch (error) {
      console.error(`가족요금제기존 업데이트 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 가족요금제기존 계정과 AdsPower 프로필 매핑 (정규화 매칭 포함)
   */
  async getExistingFamilyPlanWithMapping() {
    const [familyAccounts, mapping] = await Promise.all([
      this.getExistingFamilyPlanAccounts(),
      this.createProfileMapping()
    ]);
    
    // 매핑 통계
    let mappedCount = 0;
    let normalizedCount = 0;
    let similarCount = 0;
    
    const result = familyAccounts.map(account => {
      const email = account.googleId;
      const adsPowerId = mapping.get(email);
      
      // 매핑 유형 추적
      if (adsPowerId) {
        const normalized = this.normalizeEmail(email);
        if (email.toLowerCase() !== email) {
          normalizedCount++; // 대소문자 차이로 매핑
        } else if (normalized !== email.toLowerCase()) {
          normalizedCount++; // 정규화로 매핑
        } else {
          mappedCount++; // 직접 매핑
        }
      }
      
      return {
        ...account,
        email: email, // email 필드 추가 (googleId를 email로 사용)
        adsPowerId: adsPowerId || null,
        hasMapping: !!adsPowerId
      };
    });
    
    // 매핑 통계 출력
    const totalAccounts = familyAccounts.length;
    const totalMapped = result.filter(acc => acc.hasMapping).length;
    const unmapped = totalAccounts - totalMapped;
    
    console.log(`[Mapping] 전체: ${totalAccounts}개, 매핑: ${totalMapped}개, 미매핑: ${unmapped}개`);
    if (normalizedCount > 0) {
      console.log(`[Mapping] 정규화 매칭: ${normalizedCount}개`);
    }
    
    return result;
  }
}

module.exports = EnhancedGoogleSheetsRepository;