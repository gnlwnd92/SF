/**
 * SafeGoogleSheetsBackupService v2 - 최적화된 Google Sheets 백업 서비스
 *
 * v2 개선사항:
 * - 동적 배치 크기 계산 (targetPayloadMB 기반)
 * - 인라인 검증 (응답의 updatedRows로 별도 읽기 API 불필요)
 * - 원자적 시트 swap (batchUpdate 1회에 삭제+이름변경)
 * - 502/503 시 배치 크기 절반 축소 자동 폴백
 * - 고아 임시 시트 자동 정리
 *
 * 예상 효과: ~306회 API → ~14회 API, 8-13분 → 40-60초
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class SafeGoogleSheetsBackupService {
  constructor(sheetsId, credentialsPath) {
    this.sheetsId = sheetsId;
    this.credentialsPath = credentialsPath;
    this.sheets = null;
    this.auth = null;

    // 백업 설정 (v2)
    this.config = {
      targetPayloadMB: 1.5,        // 목표 페이로드 크기 (2MB 권장의 75%)
      minBatchSize: 100,            // 최소 배치 크기
      maxBatchSize: 3000,           // 최대 배치 크기
      maxRetries: 3,                // 최대 재시도 횟수
      retryDelay: 5000,             // 재시도 지연 시간 (5초)
      backupRetention: 7,           // 백업 보관 일수
      rateLimitDelay: 1500,         // API 호출 간 지연 (1.5초, 안전 마진)
      useTemporarySheet: true,      // 임시 시트 사용
    };

    // 상태 관리
    this.state = {
      inProgress: false,
      currentBatch: 0,
      totalBatches: 0,
      processedRows: 0,
      totalRows: 0,
      checkpointFile: null,
      backupFile: null,
      errors: [],
      startTime: null
    };

    // API 호출 카운터 (통계용)
    this._apiCalls = 0;
  }

  /**
   * 초기화
   */
  async initialize() {
    try {
      const credentials = require(this.credentialsPath);

      this.auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const authClient = await this.auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });

      console.log(chalk.green('✅ Google Sheets API 초기화 완료'));
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Google Sheets API 초기화 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 동적 배치 크기 계산
   * 전체 rows의 10% (최소 100행) 샘플링 → 행당 바이트 측정 → targetPayloadMB 기준 역산
   */
  calculateSafeBatchSize(rows) {
    const sampleCount = Math.max(100, Math.floor(rows.length * 0.1));
    const sampleSize = Math.min(sampleCount, rows.length);

    // 균등 간격 샘플링
    let totalBytes = 0;
    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor((i / sampleSize) * rows.length);
      totalBytes += JSON.stringify(rows[idx]).length;
    }

    const avgBytesPerRow = totalBytes / sampleSize;
    const targetBytes = this.config.targetPayloadMB * 1024 * 1024;
    const calculatedSize = Math.floor(targetBytes / avgBytesPerRow);

    // minBatchSize ~ maxBatchSize 범위 클램핑
    const batchSize = Math.max(
      this.config.minBatchSize,
      Math.min(this.config.maxBatchSize, calculatedSize)
    );

    const estimatedBatches = Math.ceil(rows.length / batchSize);

    console.log(chalk.cyan(`   행당 평균 크기: ${Math.round(avgBytesPerRow)}B`));
    console.log(chalk.cyan(`   동적 배치 크기: ${batchSize}행 (${estimatedBatches}개 배치 예상)`));

    return batchSize;
  }

  /**
   * 고아 임시 시트 정리
   * 이전 실패로 남은 _temp_ 시트를 삭제 (해당 sheetName 관련만)
   */
  async cleanupOrphanedTempSheets(sheetName) {
    try {
      const sheets = await this.getSheets();
      this._apiCalls++;

      const orphanedSheets = sheets.filter(s => {
        const title = s.properties.title;
        return title.includes('_temp_') && title.startsWith(sheetName);
      });

      if (orphanedSheets.length === 0) return;

      console.log(chalk.yellow(`   고아 임시 시트 ${orphanedSheets.length}개 발견, 정리 중...`));

      const requests = orphanedSheets.map(s => ({
        deleteSheet: { sheetId: s.properties.sheetId }
      }));

      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetsId,
        resource: { requests }
      });
      this._apiCalls++;

      console.log(chalk.green(`   고아 임시 시트 ${orphanedSheets.length}개 정리 완료`));
    } catch (error) {
      // best-effort: 실패해도 무시
      console.log(chalk.gray(`   고아 임시 시트 정리 실패 (무시): ${error.message}`));
    }
  }

  /**
   * 안전한 백업 실행 (v2 최적화)
   */
  async safeBackup(txtFilePath, sheetName, options = {}) {
    if (this.state.inProgress) {
      throw new Error('백업이 이미 진행 중입니다');
    }

    this.state.inProgress = true;
    this.state.startTime = Date.now();
    this._apiCalls = 0;

    let backupData = null;

    try {
      console.log(chalk.cyan('\n🔒 안전한 백업 모드 시작 (v2 최적화)\n'));

      // Phase 0: 고아 임시 시트 정리
      await this.cleanupOrphanedTempSheets(sheetName);

      // Phase 1: 기존 데이터 로컬 백업
      backupData = await this.createLocalBackup(sheetName);
      console.log(chalk.green(`✅ 로컬 백업 생성 완료: ${backupData.backupFile}`));

      // Phase 2: 체크포인트 확인 (이전 실패 복구)
      const checkpoint = await this.loadCheckpoint(txtFilePath, sheetName);
      if (checkpoint) {
        console.log(chalk.yellow(`⚠️ 이전 백업 체크포인트 발견: 행 ${checkpoint.processedRows || 0}부터 재개`));
        this.state = { ...this.state, ...checkpoint };
      }

      // Phase 3: TXT 파일 읽기 및 처리
      const data = await this.processTxtFile(txtFilePath);
      console.log(chalk.cyan(`📊 처리할 데이터: ${data.uniqueRows}개 (중복 ${data.duplicates}개 제거)`));

      // Phase 4: 동적 배치 크기 계산
      const batchSize = this.calculateSafeBatchSize(data.rows);

      // Phase 5: 임시 시트 생성
      let targetSheet = sheetName;
      if (this.config.useTemporarySheet) {
        targetSheet = await this.createTemporarySheet(sheetName);
        console.log(chalk.cyan(`📝 임시 시트 생성: ${targetSheet}`));
      }

      // Phase 6: 스마트 배치 업로드
      const uploadResult = await this.smartBatchUpload(data.rows, targetSheet, batchSize);

      // Phase 7: 최종 검증
      if (uploadResult.success) {
        const isValid = await this.validateUpload(data.rows, targetSheet);

        if (isValid) {
          // Phase 8: 원자적 시트 교체
          if (this.config.useTemporarySheet) {
            await this.atomicSwapSheets(targetSheet, sheetName);
            console.log(chalk.green('✅ 임시 시트를 원본으로 원자적 교체 완료'));
          }

          // Phase 9: 체크포인트 정리
          await this.clearCheckpoint(txtFilePath, sheetName);
          console.log(chalk.green('✅ 백업 완료 및 체크포인트 정리'));

          // 통계 출력
          this.printStatistics(uploadResult, batchSize);

          return {
            success: true,
            processedRows: uploadResult.processedRows,
            duration: Date.now() - this.state.startTime,
            backupFile: backupData.backupFile
          };
        } else {
          throw new Error('업로드 검증 실패');
        }
      } else {
        throw new Error('업로드 실패');
      }

    } catch (error) {
      console.error(chalk.red('❌ 백업 실패:'), error.message);

      // 롤백 처리
      if (backupData) {
        console.log(chalk.yellow('⚠️ 롤백 시작...'));
        await this.rollback(sheetName, backupData);
      }

      throw error;
    } finally {
      this.state.inProgress = false;
    }
  }

  /**
   * 스마트 배치 업로드 (v2)
   * - 인라인 검증 (응답의 updatedRows 확인)
   * - 502/503 시 배치 크기 절반 축소 자동 폴백
   * - 조건부 체크포인트 (배치 20개 초과 시만)
   */
  async smartBatchUpload(rows, sheetName, initialBatchSize) {
    let currentBatchSize = initialBatchSize;
    let rowIndex = this.state.processedRows || 0;
    let batchesCompleted = 0;
    let fallbackOccurred = false;

    console.log(chalk.cyan(`\n📤 스마트 배치 업로드 시작 (행 ${rowIndex}부터)\n`));

    while (rowIndex < rows.length) {
      const batch = rows.slice(rowIndex, rowIndex + currentBatchSize);
      const totalBatches = Math.ceil((rows.length - (this.state.processedRows || 0)) / currentBatchSize);
      const batchNum = batchesCompleted + 1;

      let success = false;
      let retries = 0;

      while (!success && retries < this.config.maxRetries) {
        try {
          if (rowIndex > 0 || retries > 0) {
            await this.delay(this.config.rateLimitDelay);
          }

          const response = await this.uploadBatch(batch, sheetName, rowIndex);
          this._apiCalls++;

          // 인라인 검증: 응답의 updatedRows 확인
          if (response.updatedRows !== batch.length) {
            throw new Error(`행 수 불일치: 전송 ${batch.length}, 기록 ${response.updatedRows}`);
          }

          // 로그 (페이로드 크기 포함)
          const payloadKB = Math.round(JSON.stringify(batch).length / 1024);
          console.log(chalk.green(
            `   [${batchNum}/${totalBatches}] ${batch.length}행 업로드 완료 (${payloadKB}KB)`
          ));

          success = true;
          rowIndex += batch.length;
          batchesCompleted++;
          this.state.processedRows = rowIndex;
          this.state.currentBatch = batchesCompleted;

          // 조건부 체크포인트 (배치 20개 초과 시 5개마다)
          if (totalBatches > 20 && batchesCompleted % 5 === 0) {
            await this.saveCheckpoint();
          }

        } catch (error) {
          retries++;
          const is5xx = error.message.includes('502') || error.message.includes('503');

          if (is5xx && currentBatchSize > this.config.minBatchSize) {
            // 배치 크기 절반 축소
            const prevSize = currentBatchSize;
            currentBatchSize = Math.max(this.config.minBatchSize, Math.floor(currentBatchSize / 2));
            fallbackOccurred = true;
            console.log(chalk.yellow(
              `   배치 크기 축소: ${prevSize} → ${currentBatchSize}행`
            ));
            retries = 0; // 새 배치 크기로 재시도 카운트 리셋
            continue;
          }

          console.error(chalk.yellow(
            `   ⚠️ 배치 업로드 실패 (시도 ${retries}/${this.config.maxRetries}): ${error.message}`
          ));

          if (retries < this.config.maxRetries) {
            const waitTime = this.config.retryDelay * Math.pow(2, retries - 1);
            console.log(chalk.yellow(`   ${waitTime / 1000}초 후 재시도...`));
            await this.delay(waitTime);
          } else {
            this.state.errors.push({
              batch: batchesCompleted + 1,
              error: error.message,
              timestamp: new Date().toISOString()
            });
            await this.saveCheckpoint();
            throw new Error(`배치 업로드 실패 (행 ${rowIndex}~, ${this.config.maxRetries}회 재시도 초과)`);
          }
        }
      }
    }

    return {
      success: true,
      processedRows: rowIndex,
      totalBatches: batchesCompleted,
      finalBatchSize: currentBatchSize,
      fallbackOccurred,
      errors: this.state.errors
    };
  }

  /**
   * 원자적 시트 교체 (v2)
   * getSheets 1회 + batchUpdate 1회로 삭제+이름변경 동시 수행
   */
  async atomicSwapSheets(tempSheet, originalSheet) {
    const sheets = await this.getSheets();
    this._apiCalls++;

    const originalSheetObj = sheets.find(s => s.properties.title === originalSheet);
    const tempSheetObj = sheets.find(s => s.properties.title === tempSheet);

    if (!originalSheetObj) throw new Error(`시트를 찾을 수 없음: ${originalSheet}`);
    if (!tempSheetObj) throw new Error(`시트를 찾을 수 없음: ${tempSheet}`);

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.sheetsId,
      resource: {
        requests: [
          { deleteSheet: { sheetId: originalSheetObj.properties.sheetId } },
          { updateSheetProperties: {
            properties: {
              sheetId: tempSheetObj.properties.sheetId,
              title: originalSheet
            },
            fields: 'title'
          }}
        ]
      }
    });
    this._apiCalls++;
  }

  /**
   * TXT 파일 처리 (중복 제거 및 정렬)
   * 최신 데이터 우선 정책 적용
   */
  async processTxtFile(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // 헤더와 데이터 분리
    const header = lines[0];
    const dataLines = lines.slice(1);

    // 파일명에서 타임스탬프 추출
    const getTimestamp = (filename) => {
      const matches = filename.match(/(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})/);
      if (matches) {
        const parts = matches[1].split('_');
        return new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2]),
          parseInt(parts[3]),
          parseInt(parts[4]),
          parseInt(parts[5])
        ).getTime();
      }

      const isoMatches = filename.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      if (isoMatches) {
        const timestamp = isoMatches[1].replace(/-/g, ':').replace('T', 'T');
        return new Date(timestamp).getTime();
      }

      return 0;
    };

    const fileTimestamp = getTimestamp(path.basename(filePath));

    // 중복 제거 (acc_id 기준, 최신 데이터 우선)
    const uniqueMap = new Map();
    const timestampMap = new Map();
    let duplicates = 0;
    let updatedCount = 0;

    for (const line of dataLines) {
      const fields = line.split('\t');
      const accId = fields[0];

      if (!uniqueMap.has(accId)) {
        uniqueMap.set(accId, fields);
        timestampMap.set(accId, fileTimestamp);
      } else {
        duplicates++;

        const existingTimestamp = timestampMap.get(accId) || 0;

        if (fileTimestamp > existingTimestamp) {
          uniqueMap.set(accId, fields);
          timestampMap.set(accId, fileTimestamp);
          updatedCount++;
          console.log(chalk.blue(`   → acc_id ${accId}: 최신 데이터로 업데이트`));
        }
      }
    }

    if (updatedCount > 0) {
      console.log(chalk.yellow(`   ⚠️ ${updatedCount}개 항목이 최신 데이터로 업데이트됨`));
    }

    // acc_id 기준 내림차순 정렬
    const sortedData = Array.from(uniqueMap.values()).sort((a, b) => {
      const idA = parseInt(a[0]) || 0;
      const idB = parseInt(b[0]) || 0;
      return idB - idA;
    });

    // Google Sheets 형식으로 변환
    const rows = [
      header.split('\t'),
      ...sortedData
    ];

    return {
      rows,
      uniqueRows: sortedData.length,
      duplicates,
      totalRows: dataLines.length,
      updatedCount
    };
  }

  /**
   * 단일 배치 업로드
   */
  async uploadBatch(batch, sheetName, startRow) {
    const range = `${sheetName}!A${startRow + 1}`;

    const request = {
      spreadsheetId: this.sheetsId,
      range,
      valueInputOption: 'RAW',
      resource: {
        values: batch
      }
    };

    const response = await this.sheets.spreadsheets.values.update(request);
    return response.data;
  }

  /**
   * 로컬 백업 생성
   */
  async createLocalBackup(sheetName) {
    const backupDir = path.join(process.cwd(), 'backups', 'sheets');
    await fs.mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${sheetName}_${timestamp}.json`);

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range: `${sheetName}!A:Z`
      });
      this._apiCalls++;

      const data = response.data.values || [];

      await fs.writeFile(backupFile, JSON.stringify({
        sheetName,
        timestamp,
        rowCount: data.length,
        data
      }, null, 2));

      this.state.backupFile = backupFile;

      return {
        backupFile,
        rowCount: data.length
      };
    } catch (error) {
      console.error(chalk.red('로컬 백업 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 롤백
   */
  async rollback(sheetName, backupData) {
    try {
      console.log(chalk.yellow('🔄 롤백 시작...'));

      const backupContent = await fs.readFile(backupData.backupFile, 'utf-8');
      const backup = JSON.parse(backupContent);

      // 시트 초기화
      await this.clearSheet(sheetName);

      // 백업 데이터 복원
      if (backup.data && backup.data.length > 0) {
        const batchSize = this.calculateSafeBatchSize(backup.data);
        // 단순 순차 업로드 (롤백이므로 안전하게)
        for (let i = 0; i < backup.data.length; i += batchSize) {
          const batch = backup.data.slice(i, i + batchSize);
          await this.uploadBatch(batch, sheetName, i);
          if (i + batchSize < backup.data.length) {
            await this.delay(this.config.rateLimitDelay);
          }
        }
      }

      console.log(chalk.green('✅ 롤백 완료'));
      return true;
    } catch (error) {
      console.error(chalk.red('❌ 롤백 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 시트 초기화
   */
  async clearSheet(sheetName) {
    try {
      const request = {
        spreadsheetId: this.sheetsId,
        range: `${sheetName}!A:Z`,
        resource: {}
      };

      await this.sheets.spreadsheets.values.clear(request);
      this._apiCalls++;
      return true;
    } catch (error) {
      console.error(chalk.red('시트 초기화 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 임시 시트 생성
   */
  async createTemporarySheet(originalName) {
    const tempName = `${originalName}_temp_${Date.now()}`;

    try {
      const request = {
        spreadsheetId: this.sheetsId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: tempName
              }
            }
          }]
        }
      };

      await this.sheets.spreadsheets.batchUpdate(request);
      this._apiCalls++;
      return tempName;
    } catch (error) {
      console.error(chalk.red('임시 시트 생성 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 시트 목록 가져오기
   */
  async getSheets() {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.sheetsId
    });

    return response.data.sheets || [];
  }

  /**
   * 체크포인트 저장
   */
  async saveCheckpoint() {
    const checkpointDir = path.join(process.cwd(), 'checkpoints');
    await fs.mkdir(checkpointDir, { recursive: true });

    const checkpointFile = path.join(checkpointDir, `checkpoint_${this.sheetsId}.json`);

    const checkpoint = {
      ...this.state,
      timestamp: new Date().toISOString()
    };

    await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2));
    this.state.checkpointFile = checkpointFile;

    return checkpointFile;
  }

  /**
   * 체크포인트 로드
   */
  async loadCheckpoint(txtFilePath, sheetName) {
    const checkpointDir = path.join(process.cwd(), 'checkpoints');
    const checkpointFile = path.join(checkpointDir, `checkpoint_${this.sheetsId}.json`);

    try {
      const content = await fs.readFile(checkpointFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * 체크포인트 정리
   */
  async clearCheckpoint() {
    if (this.state.checkpointFile) {
      try {
        await fs.unlink(this.state.checkpointFile);
        console.log(chalk.gray('체크포인트 파일 삭제'));
      } catch (error) {
        // 무시
      }
    }
  }

  /**
   * 전체 업로드 검증
   */
  async validateUpload(expectedData, sheetName) {
    try {
      console.log(chalk.cyan('🔍 업로드 검증 중...'));

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range: `${sheetName}!A:A`
      });
      this._apiCalls++;

      const actualData = response.data.values || [];

      // 행 수 비교
      if (actualData.length !== expectedData.length) {
        console.error(chalk.red(`❌ 행 수 불일치: 예상 ${expectedData.length}, 실제 ${actualData.length}`));
        return false;
      }

      // 샘플 검증 (전체의 1% 또는 최소 10개)
      const sampleSize = Math.max(10, Math.floor(expectedData.length * 0.01));
      const sampleIndices = new Set();

      while (sampleIndices.size < sampleSize) {
        sampleIndices.add(Math.floor(Math.random() * expectedData.length));
      }

      for (const index of sampleIndices) {
        if (expectedData[index][0] !== actualData[index][0]) {
          console.error(chalk.red(`❌ 데이터 불일치: 행 ${index + 1}`));
          return false;
        }
      }

      console.log(chalk.green('✅ 업로드 검증 완료'));
      return true;
    } catch (error) {
      console.error(chalk.red('검증 실패:'), error.message);
      return false;
    }
  }

  /**
   * 통계 출력 (v2 개선)
   */
  printStatistics(result, batchSize) {
    const duration = Date.now() - this.state.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    console.log(chalk.cyan('\n📊 백업 통계\n'));
    console.log(chalk.green(`✅ 처리된 행: ${result.processedRows}개`));
    console.log(chalk.green(`✅ 총 배치: ${result.totalBatches}개`));
    console.log(chalk.green(`✅ 동적 배치 크기: ${batchSize}행`));
    console.log(chalk.green(`✅ 최종 배치 크기: ${result.finalBatchSize}행${result.fallbackOccurred ? ' (폴백 발생)' : ''}`));
    console.log(chalk.green(`✅ 총 API 호출: ${this._apiCalls}회`));
    console.log(chalk.green(`✅ 소요 시간: ${minutes}분 ${seconds}초`));

    if (result.errors.length > 0) {
      console.log(chalk.yellow(`⚠️ 오류 발생: ${result.errors.length}건`));
      result.errors.forEach(err => {
        console.log(chalk.yellow(`   - 배치 ${err.batch}: ${err.error}`));
      });
    }
  }

  /**
   * 지연
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 오래된 백업 정리
   * backup_completed 폴더는 절대 정리하지 않음
   */
  async cleanupOldBackups() {
    const backupDir = path.join(process.cwd(), 'backups', 'sheets');
    const retentionMs = this.config.backupRetention * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const files = await fs.readdir(backupDir);

      for (const file of files) {
        const filePath = path.join(backupDir, file);

        if (filePath.includes('backup_completed')) {
          console.log(chalk.yellow(`⚠️ ${file}: backup_completed 폴더는 영구 보호됨 - 건너뜀`));
          continue;
        }

        if (file.includes('DO_NOT_DELETE')) {
          console.log(chalk.yellow(`⚠️ ${file}: 보호된 파일 - 건너뜀`));
          continue;
        }

        const dirPath = path.dirname(filePath);
        const protectedMarker = path.join(dirPath, '.protectedfolder');
        try {
          await fs.access(protectedMarker);
          console.log(chalk.yellow(`⚠️ ${file}: 보호된 폴더 내 파일 - 건너뜀`));
          continue;
        } catch {
          // 마커 파일이 없으면 계속 진행
        }

        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > retentionMs) {
          await fs.unlink(filePath);
          console.log(chalk.gray(`오래된 백업 삭제: ${file}`));
        }
      }
    } catch (error) {
      // 무시
    }
  }
}

module.exports = SafeGoogleSheetsBackupService;
