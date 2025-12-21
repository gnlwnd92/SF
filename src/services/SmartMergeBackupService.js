/**
 * SmartMergeBackupService - 지능형 병합 백업 서비스
 * 
 * 주요 기능:
 * 1. 여러 백업 파일을 최신 데이터 우선으로 병합
 * 2. 파일명 타임스탬프 기반 우선순위 결정
 * 3. 필드별 업데이트 추적
 * 4. 충돌 해결 로직
 * 5. 병합 리포트 생성
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class SmartMergeBackupService {
  constructor() {
    this.mergeStats = {
      totalFiles: 0,
      totalRecords: 0,
      uniqueRecords: 0,
      duplicates: 0,
      updates: 0,
      conflicts: []
    };
  }

  /**
   * 여러 백업 파일 병합 (최신 데이터 우선)
   */
  async mergeBackupFiles(backupDir, outputPath) {
    console.log(chalk.cyan('\n🔄 지능형 백업 파일 병합 시작\n'));
    
    try {
      // 1. 백업 파일 목록 가져오기 (타임스탬프 순으로 정렬)
      const files = await this.getBackupFiles(backupDir);
      
      if (files.length === 0) {
        throw new Error('백업 파일을 찾을 수 없습니다');
      }
      
      console.log(chalk.cyan(`📁 발견된 백업 파일: ${files.length}개\n`));
      
      // 2. 파일별로 데이터 로드 및 병합
      const mergedData = new Map(); // acc_id -> {data, timestamp, source}
      const header = await this.extractHeader(files[0].path);
      
      for (const file of files) {
        console.log(chalk.blue(`\n처리 중: ${file.name}`));
        console.log(chalk.gray(`  타임스탬프: ${new Date(file.timestamp).toLocaleString('ko-KR')}`));
        
        const fileData = await this.processFile(file, mergedData);
        
        console.log(chalk.gray(`  → 레코드: ${fileData.total}개 (신규: ${fileData.new}, 업데이트: ${fileData.updated})`));
        
        this.mergeStats.totalFiles++;
        this.mergeStats.totalRecords += fileData.total;
      }
      
      // 3. 병합된 데이터 정렬
      const sortedData = this.sortMergedData(mergedData);
      
      // 4. 출력 파일 생성
      await this.writeOutput(outputPath, header, sortedData);
      
      // 5. 병합 리포트 생성
      await this.generateReport(outputPath, files, mergedData);
      
      // 6. 통계 출력
      this.printStatistics();
      
      return {
        success: true,
        stats: this.mergeStats,
        outputPath
      };
      
    } catch (error) {
      console.error(chalk.red('❌ 병합 실패:'), error.message);
      throw error;
    }
  }

  /**
   * 백업 파일 목록 가져오기 (타임스탬프 순)
   */
  async getBackupFiles(backupDir) {
    const files = await fs.readdir(backupDir);
    const backupFiles = [];
    
    for (const file of files) {
      if (!file.endsWith('.txt')) continue;
      
      const filePath = path.join(backupDir, file);
      const stats = await fs.stat(filePath);
      const timestamp = this.extractTimestamp(file);
      
      backupFiles.push({
        name: file,
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        timestamp: timestamp || stats.mtime.getTime(),
        priority: timestamp ? this.calculatePriority(file, timestamp) : 0
      });
    }
    
    // 타임스탬프 기준 오름차순 정렬 (오래된 것부터 처리하여 최신이 덮어쓰도록)
    backupFiles.sort((a, b) => a.timestamp - b.timestamp);
    
    return backupFiles;
  }

  /**
   * 파일명에서 타임스탬프 추출
   */
  extractTimestamp(filename) {
    // 패턴 1: profiles_YYYY_MM_DD_HH_MM_SS_*.txt
    const pattern1 = /profiles_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/;
    const match1 = filename.match(pattern1);
    
    if (match1) {
      const [_, year, month, day, hour, minute, second] = match1;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      ).getTime();
    }
    
    // 패턴 2: backup_YYYY_MM_DD.txt 또는 *_YYYY_MM_DD_* 형식
    const pattern2 = /(\d{4})_(\d{2})_(\d{2})(?:_(\d{2})_(\d{2}))?/;
    const match2 = filename.match(pattern2);
    
    if (match2) {
      const [_, year, month, day, hour = '00', minute = '00'] = match2;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        0
      ).getTime();
    }
    
    // 패턴 3: ISO 타임스탬프 (2025-09-10T16-13-00)
    const pattern3 = /(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/g;
    const matches3 = [...filename.matchAll(pattern3)];
    
    if (matches3.length > 0) {
      // 가장 최신 타임스탬프 사용
      const timestamps = matches3.map(match => {
        const [_, year, month, day, hour, minute, second] = match;
        return new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second)
        ).getTime();
      });
      
      return Math.max(...timestamps);
    }
    
    return null;
  }

  /**
   * 우선순위 계산 (최신 파일일수록 높은 우선순위)
   */
  calculatePriority(filename, timestamp) {
    let priority = timestamp;
    
    // 추가 타임스탬프가 있으면 보너스 우선순위
    const additionalTimestamps = (filename.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/g) || []).length;
    priority += additionalTimestamps * 1000000; // 추가 타임스탬프당 보너스
    
    return priority;
  }

  /**
   * 헤더 추출
   */
  async extractHeader(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines[0];
  }

  /**
   * 파일 처리 및 병합
   * B열(index 1) = id 필드로 중복 판단
   * X열(index 23) = 소스파일명으로 최신 데이터 판단
   */
  async processFile(file, mergedData) {
    const content = await fs.readFile(file.path, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // 헤더 제외
    const dataLines = lines.slice(1);
    
    let newCount = 0;
    let updateCount = 0;
    let skipCount = 0;
    
    for (const line of dataLines) {
      const fields = line.split('\t');
      if (fields.length < 24) continue; // 최소 X열(24개)까지 있어야 함
      
      // B열(index 1) = id 필드
      const id = fields[1];
      
      if (!id || id === 'id' || id === 'ID') continue; // 헤더 또는 빈 값 스킵
      
      // X열(index 23) = 소스파일명에서 날짜 추출
      const sourceFile = fields[23] || file.name;
      const currentTimestamp = this.extractTimestamp(sourceFile) || file.timestamp;
      
      if (!mergedData.has(id)) {
        // 새로운 레코드
        mergedData.set(id, {
          data: fields,
          timestamp: currentTimestamp,
          source: sourceFile,
          originalFile: file.name,
          updateHistory: [{
            timestamp: currentTimestamp,
            source: sourceFile,
            action: 'created'
          }]
        });
        newCount++;
      } else {
        // 기존 레코드와 비교
        const existing = mergedData.get(id);
        
        // X열의 소스파일명 기준으로 최신 데이터 판단
        if (currentTimestamp > existing.timestamp) {
          // 변경된 필드 추적
          const changes = this.detectChanges(existing.data, fields);
          
          if (changes.length > 0) {
            // 업데이트 이력 추가
            existing.updateHistory.push({
              timestamp: currentTimestamp,
              source: sourceFile,
              action: 'updated',
              changes: changes
            });
            
            // 데이터 업데이트 (더 최신 데이터로 덮어쓰기)
            existing.data = fields;
            existing.timestamp = currentTimestamp;
            existing.source = sourceFile;
            existing.originalFile = file.name;
            
            updateCount++;
            this.mergeStats.updates++;
            
            // 중요 필드 변경 시 로그 (A, B, C열)
            if (changes.some(c => c.field <= 2)) {
              console.log(chalk.yellow(`    ⚠️ ID ${id}: ${changes.length}개 필드 업데이트 (${sourceFile})`));
            }
          }
        } else {
          // 기존 데이터가 더 최신인 경우 스킵
          skipCount++;
          console.log(chalk.gray(`    ⏭️ ID ${id}: 기존 데이터가 더 최신 (기존: ${existing.source}, 현재: ${sourceFile})`));
        }
        
        this.mergeStats.duplicates++;
      }
    }
    
    console.log(chalk.blue(`    📊 처리 결과: 신규 ${newCount}개, 업데이트 ${updateCount}개, 스킵 ${skipCount}개`));
    
    return {
      total: dataLines.length,
      new: newCount,
      updated: updateCount,
      skipped: skipCount
    };
  }

  /**
   * 변경 사항 감지
   */
  detectChanges(oldData, newData) {
    const changes = [];
    const maxLength = Math.max(oldData.length, newData.length);
    
    for (let i = 0; i < maxLength; i++) {
      const oldValue = oldData[i] || '';
      const newValue = newData[i] || '';
      
      if (oldValue !== newValue) {
        changes.push({
          field: i,
          old: oldValue,
          new: newValue
        });
      }
    }
    
    return changes;
  }

  /**
   * 병합된 데이터 정렬
   * B열(id) 기준 내림차순 정렬
   */
  sortMergedData(mergedData) {
    // Map을 배열로 변환하고 id 기준 내림차순 정렬
    const entries = Array.from(mergedData.entries());
    
    entries.sort((a, b) => {
      // id는 문자열일 수도 있으므로 숫자 변환 시도
      const idA = parseInt(a[0]) || a[0];
      const idB = parseInt(b[0]) || b[0];
      
      // 숫자인 경우 숫자 비교, 문자열인 경우 문자열 비교
      if (typeof idA === 'number' && typeof idB === 'number') {
        return idB - idA; // 숫자 내림차순
      } else {
        return String(idB).localeCompare(String(idA)); // 문자열 내림차순
      }
    });
    
    return entries;
  }

  /**
   * 출력 파일 작성
   * X열(index 23)에 소스파일명이 있는지 확인하고 업데이트
   */
  async writeOutput(outputPath, header, sortedData) {
    const lines = [header];
    
    for (const [id, record] of sortedData) {
      // X열(index 23)에 소스파일명 확인 및 업데이트
      if (record.data.length > 23) {
        // X열이 비어있거나 값이 없으면 소스파일명 추가
        if (!record.data[23] || record.data[23].trim() === '') {
          record.data[23] = record.source || record.originalFile || '';
        }
      } else {
        // X열까지 데이터가 없으면 빈 값으로 채우고 소스파일명 추가
        while (record.data.length < 23) {
          record.data.push('');
        }
        record.data.push(record.source || record.originalFile || '');
      }
      
      lines.push(record.data.join('\t'));
    }
    
    await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
    
    this.mergeStats.uniqueRecords = sortedData.length;
    
    console.log(chalk.green(`\n✅ 병합 완료: ${outputPath}`));
    console.log(chalk.green(`   총 ${sortedData.length}개 고유 레코드 (B열 id 기준)`));
  }

  /**
   * 병합 리포트 생성
   */
  async generateReport(outputPath, files, mergedData) {
    const reportPath = outputPath.replace('.txt', '_merge_report.json');
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.mergeStats,
      files: files.map(f => ({
        name: f.name,
        timestamp: new Date(f.timestamp).toISOString(),
        size: f.size,
        priority: f.priority
      })),
      topUpdates: this.getTopUpdates(mergedData, 10),
      conflictResolution: 'latest_wins' // 최신 데이터 우선 정책
    };
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    
    console.log(chalk.blue(`\n📊 병합 리포트: ${reportPath}`));
  }

  /**
   * 가장 많이 업데이트된 레코드 추출
   */
  getTopUpdates(mergedData, limit = 10) {
    const updates = [];
    
    for (const [accId, record] of mergedData.entries()) {
      if (record.updateHistory.length > 1) {
        updates.push({
          accId,
          updateCount: record.updateHistory.length - 1,
          lastUpdate: record.updateHistory[record.updateHistory.length - 1],
          sources: [...new Set(record.updateHistory.map(h => h.source))]
        });
      }
    }
    
    // 업데이트 횟수 기준 내림차순 정렬
    updates.sort((a, b) => b.updateCount - a.updateCount);
    
    return updates.slice(0, limit);
  }

  /**
   * 통계 출력
   */
  printStatistics() {
    console.log(chalk.cyan('\n📊 병합 통계\n'));
    console.log(chalk.white(`   • 처리된 파일: ${this.mergeStats.totalFiles}개`));
    console.log(chalk.white(`   • 전체 레코드: ${this.mergeStats.totalRecords}개`));
    console.log(chalk.green(`   • 고유 레코드: ${this.mergeStats.uniqueRecords}개`));
    console.log(chalk.yellow(`   • 중복 제거: ${this.mergeStats.duplicates}개`));
    console.log(chalk.blue(`   • 업데이트: ${this.mergeStats.updates}개`));
    
    const compressionRate = ((1 - this.mergeStats.uniqueRecords / this.mergeStats.totalRecords) * 100).toFixed(1);
    console.log(chalk.magenta(`   • 압축률: ${compressionRate}%`));
  }

  /**
   * Alias 메서드 - 테스트와의 호환성을 위해
   */
  async mergeFiles(backupDir, outputPath) {
    return this.mergeBackupFiles(backupDir, outputPath);
  }
}

module.exports = SmartMergeBackupService;