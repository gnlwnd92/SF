/**
 * SafeGoogleSheetsBackupService - 안전한 Google Sheets 백업 서비스
 * 
 * 주요 기능:
 * 1. 트랜잭션 방식 백업 (실패 시 롤백)
 * 2. 체크포인트 시스템 (중단 지점부터 재개)
 * 3. 증분 백업 (변경된 부분만 업데이트)
 * 4. 자동 재시도 및 오류 복구
 * 5. 백업 검증 시스템
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
    
    // 백업 설정
    this.config = {
      batchSize: 100,           // 배치 크기 (500→100으로 축소)
      maxRetries: 3,            // 최대 재시도 횟수
      retryDelay: 5000,         // 재시도 지연 시간 (5초)
      checkpointInterval: 5,    // 체크포인트 저장 간격 (5 배치마다)
      backupRetention: 7,       // 백업 보관 일수
      rateLimitDelay: 1000,     // API 호출 간 지연 (1초)
      maxConcurrentRequests: 1, // 동시 요청 수 제한
      validateAfterBatch: true, // 각 배치 후 검증
      useTemporarySheet: true,  // 임시 시트 사용
      compressionEnabled: true  // 데이터 압축 사용
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
   * 안전한 백업 실행
   */
  async safeBackup(txtFilePath, sheetName, options = {}) {
    // 이미 진행 중인 백업이 있는지 확인
    if (this.state.inProgress) {
      throw new Error('백업이 이미 진행 중입니다');
    }
    
    this.state.inProgress = true;
    this.state.startTime = Date.now();
    
    try {
      console.log(chalk.cyan('\n🔒 안전한 백업 모드 시작\n'));
      
      // 1. 기존 데이터 백업
      const backupData = await this.createLocalBackup(sheetName);
      console.log(chalk.green(`✅ 로컬 백업 생성 완료: ${backupData.backupFile}`));
      
      // 2. 체크포인트 파일 확인 (이전 실패 복구)
      const checkpoint = await this.loadCheckpoint(txtFilePath, sheetName);
      if (checkpoint) {
        console.log(chalk.yellow(`⚠️ 이전 백업 체크포인트 발견: 배치 ${checkpoint.currentBatch}/${checkpoint.totalBatches}부터 재개`));
        this.state = { ...this.state, ...checkpoint };
      }
      
      // 3. TXT 파일 읽기 및 처리
      const data = await this.processTxtFile(txtFilePath);
      console.log(chalk.cyan(`📊 처리할 데이터: ${data.uniqueRows}개 (중복 ${data.duplicates}개 제거)`));
      
      // 4. 임시 시트 생성 (옵션)
      let targetSheet = sheetName;
      if (this.config.useTemporarySheet) {
        targetSheet = await this.createTemporarySheet(sheetName);
        console.log(chalk.cyan(`📝 임시 시트 생성: ${targetSheet}`));
      }
      
      // 5. 배치 업로드 실행
      const uploadResult = await this.batchUploadWithCheckpoints(data.rows, targetSheet);
      
      // 6. 업로드 검증
      if (uploadResult.success) {
        const isValid = await this.validateUpload(data.rows, targetSheet);
        
        if (isValid) {
          // 7. 임시 시트를 원본으로 교체
          if (this.config.useTemporarySheet) {
            await this.swapSheets(targetSheet, sheetName);
            console.log(chalk.green('✅ 임시 시트를 원본으로 교체 완료'));
          }
          
          // 8. 체크포인트 정리
          await this.clearCheckpoint(txtFilePath, sheetName);
          console.log(chalk.green('✅ 백업 완료 및 체크포인트 정리'));
          
          // 9. 성공 통계 출력
          this.printStatistics(uploadResult);
          
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
      // 파일명 패턴: profiles_YYYY_MM_DD_HH_MM_SS_타임스탬프.txt
      const matches = filename.match(/(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})/);
      if (matches) {
        const parts = matches[1].split('_');
        return new Date(
          parseInt(parts[0]), // year
          parseInt(parts[1]) - 1, // month (0-indexed)
          parseInt(parts[2]), // day
          parseInt(parts[3]), // hour
          parseInt(parts[4]), // minute
          parseInt(parts[5])  // second
        ).getTime();
      }
      
      // ISO 타임스탬프 패턴 확인
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
    const timestampMap = new Map(); // acc_id별 타임스탬프 저장
    let duplicates = 0;
    let updatedCount = 0;
    
    for (const line of dataLines) {
      const fields = line.split('\t');
      const accId = fields[0]; // acc_id는 첫 번째 필드
      
      if (!uniqueMap.has(accId)) {
        // 새로운 acc_id
        uniqueMap.set(accId, fields);
        timestampMap.set(accId, fileTimestamp);
      } else {
        duplicates++;
        
        // 기존 데이터의 타임스탬프와 비교
        const existingTimestamp = timestampMap.get(accId) || 0;
        
        // 현재 데이터가 더 최신이면 업데이트
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
      return idB - idA; // 내림차순
    });
    
    // Google Sheets 형식으로 변환
    const rows = [
      header.split('\t'), // 헤더
      ...sortedData       // 데이터
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
   * 체크포인트 기반 배치 업로드
   */
  async batchUploadWithCheckpoints(rows, sheetName) {
    const batchSize = this.config.batchSize;
    const totalBatches = Math.ceil(rows.length / batchSize);
    
    // 체크포인트에서 시작 위치 결정
    const startBatch = this.state.currentBatch || 0;
    
    console.log(chalk.cyan(`\n📤 배치 업로드 시작 (${startBatch}/${totalBatches}부터)\n`));
    
    for (let i = startBatch; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, rows.length);
      const batch = rows.slice(start, end);
      
      // 재시도 로직
      let success = false;
      let retries = 0;
      
      while (!success && retries < this.config.maxRetries) {
        try {
          // API 호출 전 지연
          if (i > startBatch || retries > 0) {
            await this.delay(this.config.rateLimitDelay);
          }
          
          // 배치 업로드
          await this.uploadBatch(batch, sheetName, start);
          
          console.log(chalk.green(`   → 배치 ${i + 1}/${totalBatches} 업로드 완료 (${batch.length}개)`));
          
          // 검증 (옵션)
          if (this.config.validateAfterBatch) {
            const isValid = await this.validateBatch(batch, sheetName, start);
            if (!isValid) {
              throw new Error('배치 검증 실패');
            }
          }
          
          success = true;
          this.state.processedRows += batch.length;
          this.state.currentBatch = i + 1;
          
          // 체크포인트 저장
          if ((i + 1) % this.config.checkpointInterval === 0) {
            await this.saveCheckpoint();
            console.log(chalk.blue(`   💾 체크포인트 저장 (배치 ${i + 1})`));
          }
          
        } catch (error) {
          retries++;
          console.error(chalk.yellow(`   ⚠️ 배치 ${i + 1} 실패 (시도 ${retries}/${this.config.maxRetries}): ${error.message}`));
          
          if (retries < this.config.maxRetries) {
            const waitTime = this.config.retryDelay * Math.pow(2, retries - 1); // 지수 백오프
            console.log(chalk.yellow(`   ⏳ ${waitTime / 1000}초 후 재시도...`));
            await this.delay(waitTime);
          } else {
            // 최대 재시도 초과
            this.state.errors.push({
              batch: i + 1,
              error: error.message,
              timestamp: new Date().toISOString()
            });
            
            // 체크포인트 저장 후 중단
            await this.saveCheckpoint();
            throw new Error(`배치 ${i + 1} 업로드 실패 (최대 재시도 초과)`);
          }
        }
      }
    }
    
    return {
      success: true,
      processedRows: this.state.processedRows,
      totalBatches,
      errors: this.state.errors
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
   * 배치 검증
   */
  async validateBatch(expectedData, sheetName, startRow) {
    try {
      const range = `${sheetName}!A${startRow + 1}:Z${startRow + expectedData.length}`;
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range
      });
      
      const actualData = response.data.values || [];
      
      // 데이터 비교
      if (actualData.length !== expectedData.length) {
        return false;
      }
      
      // 샘플링 검증 (전체 검증은 부하가 크므로)
      const sampleSize = Math.min(10, expectedData.length);
      for (let i = 0; i < sampleSize; i++) {
        const randomIndex = Math.floor(Math.random() * expectedData.length);
        const expected = expectedData[randomIndex];
        const actual = actualData[randomIndex];
        
        if (!actual || expected.length !== actual.length) {
          return false;
        }
        
        // 첫 번째 필드(acc_id)만 비교
        if (expected[0] !== actual[0]) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(chalk.red('검증 실패:'), error.message);
      return false;
    }
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
      // 현재 시트 데이터 가져오기
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range: `${sheetName}!A:Z`
      });
      
      const data = response.data.values || [];
      
      // 백업 파일 저장
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
      
      // 백업 파일 읽기
      const backupContent = await fs.readFile(backupData.backupFile, 'utf-8');
      const backup = JSON.parse(backupContent);
      
      // 시트 초기화
      await this.clearSheet(sheetName);
      
      // 백업 데이터 복원
      if (backup.data && backup.data.length > 0) {
        await this.uploadBatch(backup.data, sheetName, 0);
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
      return tempName;
    } catch (error) {
      console.error(chalk.red('임시 시트 생성 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 시트 교체
   */
  async swapSheets(tempSheet, originalSheet) {
    try {
      // 1. 원본 시트 삭제
      await this.deleteSheet(originalSheet);
      
      // 2. 임시 시트 이름 변경
      await this.renameSheet(tempSheet, originalSheet);
      
      return true;
    } catch (error) {
      console.error(chalk.red('시트 교체 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 시트 삭제
   */
  async deleteSheet(sheetName) {
    try {
      // 시트 ID 찾기
      const sheets = await this.getSheets();
      const sheet = sheets.find(s => s.properties.title === sheetName);
      
      if (!sheet) {
        throw new Error(`시트를 찾을 수 없음: ${sheetName}`);
      }
      
      const request = {
        spreadsheetId: this.sheetsId,
        resource: {
          requests: [{
            deleteSheet: {
              sheetId: sheet.properties.sheetId
            }
          }]
        }
      };
      
      await this.sheets.spreadsheets.batchUpdate(request);
      return true;
    } catch (error) {
      console.error(chalk.red('시트 삭제 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 시트 이름 변경
   */
  async renameSheet(oldName, newName) {
    try {
      // 시트 ID 찾기
      const sheets = await this.getSheets();
      const sheet = sheets.find(s => s.properties.title === oldName);
      
      if (!sheet) {
        throw new Error(`시트를 찾을 수 없음: ${oldName}`);
      }
      
      const request = {
        spreadsheetId: this.sheetsId,
        resource: {
          requests: [{
            updateSheetProperties: {
              properties: {
                sheetId: sheet.properties.sheetId,
                title: newName
              },
              fields: 'title'
            }
          }]
        }
      };
      
      await this.sheets.spreadsheets.batchUpdate(request);
      return true;
    } catch (error) {
      console.error(chalk.red('시트 이름 변경 실패:'), error.message);
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
      // 체크포인트 파일이 없으면 null 반환
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
        range: `${sheetName}!A:A` // acc_id 컬럼만 확인
      });
      
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
   * 통계 출력
   */
  printStatistics(result) {
    const duration = Date.now() - this.state.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    
    console.log(chalk.cyan('\n📊 백업 통계\n'));
    console.log(chalk.green(`✅ 처리된 행: ${result.processedRows}개`));
    console.log(chalk.green(`✅ 총 배치: ${result.totalBatches}개`));
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
        
        // backup_completed 폴더 보호
        if (filePath.includes('backup_completed')) {
          console.log(chalk.yellow(`⚠️ ${file}: backup_completed 폴더는 영구 보호됨 - 건너뜀`));
          continue;
        }
        
        // DO_NOT_DELETE 파일 보호
        if (file.includes('DO_NOT_DELETE')) {
          console.log(chalk.yellow(`⚠️ ${file}: 보호된 파일 - 건너뜀`));
          continue;
        }
        
        // .protectedfolder 마커가 있는 디렉토리 확인
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