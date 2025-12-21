#!/usr/bin/env node

/**
 * 지능형 백업 병합 스크립트
 * 
 * 여러 백업 파일을 최신 데이터 우선으로 병합
 * 
 * 사용법:
 * node smart-merge-backups.js [옵션]
 * 
 * 옵션:
 * --dir <path>      : 백업 파일 디렉토리 (기본: data/txt-backup)
 * --output <path>   : 출력 파일 경로 (기본: 애즈파워현황_merged_날짜.txt)
 * --sheets          : 병합 후 Google Sheets에 업로드
 * --analyze         : 병합 전 분석만 수행
 * --help            : 도움말 표시
 */

const chalk = require('chalk');
const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs').promises;
const ora = require('ora');
const SmartMergeBackupService = require('./src/services/SmartMergeBackupService');
const SafeGoogleSheetsBackupService = require('./src/services/SafeGoogleSheetsBackupService');

class SmartMergeCLI {
  constructor() {
    this.config = {
      backupDir: './data/txt-backup',
      outputDir: './data/txt-backup',
      sheetsId: process.env.GOOGLE_SHEETS_ID,
      credentialsPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json'
    };
  }

  /**
   * 메인 실행
   */
  async run() {
    try {
      console.log(chalk.cyan('\n╔════════════════════════════════════════════╗'));
      console.log(chalk.cyan('║   🔄 지능형 백업 병합 시스템              ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════════╝\n'));

      const args = this.parseArgs();
      
      if (args.analyze) {
        await this.analyzeMode();
      } else if (args.dir) {
        await this.executeMerge(args);
      } else {
        await this.interactiveMode();
      }
      
    } catch (error) {
      console.error(chalk.red('\n❌ 오류 발생:'), error.message);
      process.exit(1);
    }
  }

  /**
   * 분석 모드
   */
  async analyzeMode() {
    const spinner = ora('백업 파일 분석 중...').start();
    
    try {
      const files = await this.scanBackupFiles(this.config.backupDir);
      spinner.stop();
      
      if (files.length === 0) {
        console.log(chalk.yellow('⚠️ 백업 파일을 찾을 수 없습니다.'));
        return;
      }
      
      console.log(chalk.cyan('\n📊 백업 파일 분석 결과\n'));
      console.log(chalk.white(`총 ${files.length}개 파일 발견\n`));
      
      // 파일별 정보 표시
      for (const file of files) {
        console.log(chalk.blue(`📁 ${file.name}`));
        console.log(chalk.gray(`   • 크기: ${(file.size / 1024).toFixed(1)} KB`));
        console.log(chalk.gray(`   • 생성: ${file.created}`));
        console.log(chalk.gray(`   • 레코드: ${file.recordCount}개`));
        
        if (file.duplicateFiles.length > 0) {
          console.log(chalk.yellow(`   • 관련 파일: ${file.duplicateFiles.length}개`));
        }
        console.log();
      }
      
      // 중복 분석
      const duplicateAnalysis = await this.analyzeDuplicates(files);
      
      console.log(chalk.cyan('📈 중복 분석\n'));
      console.log(chalk.white(`   • 총 레코드: ${duplicateAnalysis.totalRecords}개`));
      console.log(chalk.yellow(`   • 예상 중복: ${duplicateAnalysis.expectedDuplicates}개`));
      console.log(chalk.green(`   • 예상 고유 레코드: ${duplicateAnalysis.expectedUnique}개`));
      console.log(chalk.magenta(`   • 예상 압축률: ${duplicateAnalysis.compressionRate}%`));
      
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * 대화형 모드
   */
  async interactiveMode() {
    // 1. 백업 디렉토리 선택
    const { backupDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'backupDir',
        message: '백업 파일 디렉토리:',
        default: this.config.backupDir
      }
    ]);
    
    // 2. 파일 스캔
    const files = await this.scanBackupFiles(backupDir);
    
    if (files.length === 0) {
      console.log(chalk.yellow('⚠️ 백업 파일을 찾을 수 없습니다.'));
      return;
    }
    
    console.log(chalk.cyan(`\n📁 ${files.length}개 백업 파일 발견\n`));
    
    // 3. 병합할 파일 선택
    const { selectedFiles } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedFiles',
        message: '병합할 파일 선택 (Space로 선택, Enter로 확인):',
        choices: files.map(f => ({
          name: `${f.name} (${(f.size / 1024).toFixed(1)} KB, ${f.recordCount}개 레코드)`,
          value: f.path,
          checked: true // 기본적으로 모두 선택
        }))
      }
    ]);
    
    if (selectedFiles.length === 0) {
      console.log(chalk.yellow('선택된 파일이 없습니다.'));
      return;
    }
    
    // 4. 출력 파일명 입력
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const defaultOutput = `애즈파워현황_merged_${timestamp}.txt`;
    
    const { outputFile } = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputFile',
        message: '출력 파일명:',
        default: defaultOutput
      }
    ]);
    
    // 5. 추가 옵션
    const { options } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'options',
        message: '추가 옵션:',
        choices: [
          { name: 'Google Sheets에 업로드', value: 'sheets' },
          { name: '병합 리포트 생성', value: 'report', checked: true },
          { name: '원본 파일 백업', value: 'backup' },
          { name: '병합 후 원본 파일 정리', value: 'cleanup' }
        ]
      }
    ]);
    
    // 6. 확인
    console.log(chalk.cyan('\n📋 병합 설정 요약:\n'));
    console.log(chalk.white(`   • 선택된 파일: ${selectedFiles.length}개`));
    console.log(chalk.white(`   • 출력 파일: ${outputFile}`));
    console.log(chalk.white(`   • 옵션: ${options.join(', ') || '없음'}`));
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '병합을 시작하시겠습니까?',
        default: true
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.yellow('병합이 취소되었습니다.'));
      return;
    }
    
    // 병합 실행
    await this.executeMerge({
      dir: backupDir,
      files: selectedFiles,
      output: path.join(this.config.outputDir, outputFile),
      sheets: options.includes('sheets'),
      report: options.includes('report'),
      backup: options.includes('backup'),
      cleanup: options.includes('cleanup')
    });
  }

  /**
   * 병합 실행
   */
  async executeMerge(options) {
    const spinner = ora('병합 준비 중...').start();
    
    try {
      // 1. 원본 백업 (옵션)
      if (options.backup) {
        spinner.text = '원본 파일 백업 중...';
        await this.backupOriginalFiles(options.dir);
      }
      
      // 2. SmartMergeBackupService로 병합
      spinner.text = '파일 병합 중...';
      const mergeService = new SmartMergeBackupService();
      
      const result = await mergeService.mergeBackupFiles(
        options.dir || this.config.backupDir,
        options.output || path.join(this.config.outputDir, `애즈파워현황_merged_${Date.now()}.txt`)
      );
      
      spinner.stop();
      
      if (result.success) {
        console.log(chalk.green('\n✅ 병합 완료!'));
        console.log(chalk.green(`   • 출력 파일: ${result.outputPath}`));
        console.log(chalk.green(`   • 고유 레코드: ${result.stats.uniqueRecords}개`));
        
        // 3. Google Sheets 업로드 (옵션)
        if (options.sheets) {
          await this.uploadToSheets(result.outputPath);
        }
        
        // 4. 파일 정리 (옵션)
        if (options.cleanup) {
          await this.cleanupFiles(options.dir, options.files);
        }
      }
      
    } catch (error) {
      spinner.stop();
      throw error;
    }
  }

  /**
   * Google Sheets 업로드
   */
  async uploadToSheets(mergedFile) {
    const spinner = ora('Google Sheets 업로드 준비 중...').start();
    
    try {
      const sheetsService = new SafeGoogleSheetsBackupService(
        this.config.sheetsId,
        this.config.credentialsPath
      );
      
      // 작은 배치 크기로 안전하게 업로드
      sheetsService.config.batchSize = 100;
      sheetsService.config.maxRetries = 3;
      
      spinner.text = 'Google Sheets API 연결 중...';
      await sheetsService.initialize();
      
      spinner.stop();
      
      console.log(chalk.cyan('\n📤 Google Sheets 업로드 시작\n'));
      
      const result = await sheetsService.safeBackup(
        mergedFile,
        '애즈파워현황',
        { resume: false }
      );
      
      if (result.success) {
        console.log(chalk.green('\n✅ Google Sheets 업로드 완료!'));
      }
      
    } catch (error) {
      spinner.stop();
      console.error(chalk.red('❌ Google Sheets 업로드 실패:'), error.message);
    }
  }

  /**
   * 백업 파일 스캔
   */
  async scanBackupFiles(dir) {
    const files = await fs.readdir(dir);
    const backupFiles = [];
    
    for (const file of files) {
      if (!file.endsWith('.txt')) continue;
      if (file.includes('_merged_')) continue; // 이미 병합된 파일 제외
      
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      
      // 레코드 수 계산 (빠른 추정)
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // 관련 파일 찾기 (같은 프로필의 다른 백업)
      const basePattern = file.split('_').slice(0, 6).join('_');
      const duplicateFiles = files.filter(f => 
        f !== file && f.startsWith(basePattern) && f.endsWith('.txt')
      );
      
      backupFiles.push({
        name: file,
        path: filePath,
        size: stats.size,
        created: new Date(stats.birthtime).toLocaleString('ko-KR'),
        recordCount: lines.length - 1, // 헤더 제외
        duplicateFiles
      });
    }
    
    // 크기 기준 내림차순 정렬
    backupFiles.sort((a, b) => b.size - a.size);
    
    return backupFiles;
  }

  /**
   * 중복 분석
   */
  async analyzeDuplicates(files) {
    let totalRecords = 0;
    const uniqueIds = new Set();
    
    for (const file of files) {
      const content = await fs.readFile(file.path, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split('\t');
        if (fields[0]) {
          uniqueIds.add(fields[0]);
          totalRecords++;
        }
      }
    }
    
    const expectedUnique = uniqueIds.size;
    const expectedDuplicates = totalRecords - expectedUnique;
    const compressionRate = ((expectedDuplicates / totalRecords) * 100).toFixed(1);
    
    return {
      totalRecords,
      expectedUnique,
      expectedDuplicates,
      compressionRate
    };
  }

  /**
   * 원본 파일 백업
   */
  async backupOriginalFiles(dir) {
    const backupDir = path.join(dir, 'original_backup', new Date().toISOString().split('T')[0]);
    await fs.mkdir(backupDir, { recursive: true });
    
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.txt') && !file.includes('_merged_')) {
        const src = path.join(dir, file);
        const dest = path.join(backupDir, file);
        await fs.copyFile(src, dest);
      }
    }
    
    console.log(chalk.gray(`원본 백업 완료: ${backupDir}`));
  }

  /**
   * 파일 정리
   */
  async cleanupFiles(dir, processedFiles) {
    const archiveDir = path.join(dir, 'processed', new Date().toISOString().split('T')[0]);
    await fs.mkdir(archiveDir, { recursive: true });
    
    for (const file of processedFiles || []) {
      const filename = path.basename(file);
      const dest = path.join(archiveDir, filename);
      await fs.rename(file, dest);
    }
    
    console.log(chalk.gray(`처리된 파일 이동 완료: ${archiveDir}`));
  }

  /**
   * 명령줄 인수 파싱
   */
  parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--dir':
          options.dir = args[++i];
          break;
        case '--output':
          options.output = args[++i];
          break;
        case '--sheets':
          options.sheets = true;
          break;
        case '--analyze':
          options.analyze = true;
          break;
        case '--help':
          this.showHelp();
          process.exit(0);
      }
    }
    
    return options;
  }

  /**
   * 도움말 표시
   */
  showHelp() {
    console.log(chalk.cyan('\n지능형 백업 병합 도구\n'));
    console.log('사용법: node smart-merge-backups.js [옵션]\n');
    console.log('옵션:');
    console.log('  --dir <path>      백업 파일 디렉토리');
    console.log('  --output <path>   출력 파일 경로');
    console.log('  --sheets          병합 후 Google Sheets에 업로드');
    console.log('  --analyze         병합 전 분석만 수행');
    console.log('  --help            이 도움말 표시\n');
    console.log('예시:');
    console.log('  node smart-merge-backups.js');
    console.log('  node smart-merge-backups.js --analyze');
    console.log('  node smart-merge-backups.js --sheets');
  }
}

// 환경 변수 로드
require('dotenv').config();

// CLI 실행
const cli = new SmartMergeCLI();
cli.run();