#!/usr/bin/env node

/**
 * 안전한 TXT → Google Sheets 백업 스크립트 (v2 최적화)
 *
 * 사용법:
 * node safe-backup-to-sheets.js [옵션]
 *
 * 옵션:
 * --txt <path>      : TXT 백업 파일 경로 (기본: data/txt-backup/애즈파워현황_*.txt)
 * --sheet <name>    : 대상 시트 이름 (기본: 애즈파워현황)
 * --retry <count>   : 최대 재시도 횟수 (기본: 3)
 * --resume          : 체크포인트에서 재개
 * --validate        : 업로드 후 최종 검증 (기본 활성화)
 * --test            : 테스트 모드 (처음 10개만)
 */

const chalk = require('chalk');
const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs').promises;
const ora = require('ora');
const SafeGoogleSheetsBackupService = require('./src/services/SafeGoogleSheetsBackupService');

class SafeBackupCLI {
  constructor() {
    this.config = {
      sheetsId: process.env.GOOGLE_SHEETS_ID,
      credentialsPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json',
      defaultSheet: '애즈파워현황',
      backupDir: './data/txt-backup'
    };
  }

  /**
   * 메인 실행
   */
  async run() {
    try {
      console.log(chalk.cyan('\n╔════════════════════════════════════════════╗'));
      console.log(chalk.cyan('║   🔒 안전한 Google Sheets 백업 시스템 v2   ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════════╝\n'));

      // 명령줄 인수 파싱
      const args = this.parseArgs();

      // 대화형 모드 또는 직접 실행
      if (args.txt && args.sheet) {
        await this.executeBackup(args);
      } else {
        await this.interactiveMode();
      }

    } catch (error) {
      console.error(chalk.red('\n❌ 오류 발생:'), error.message);
      process.exit(1);
    }
  }

  /**
   * 대화형 모드
   */
  async interactiveMode() {
    // 1. 백업 파일 선택
    const txtFiles = await this.findBackupFiles();

    if (txtFiles.length === 0) {
      console.log(chalk.yellow('⚠️ 백업 파일을 찾을 수 없습니다.'));
      console.log(chalk.gray('먼저 "npm run backup:txt"를 실행하여 백업을 생성하세요.'));
      return;
    }

    const { selectedFile } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedFile',
        message: '백업 파일 선택:',
        choices: txtFiles.map(file => ({
          name: `${file.name} (${file.size} KB, ${file.modified})`,
          value: file.path
        }))
      }
    ]);

    // 2. 대상 시트 선택
    const { sheetName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'sheetName',
        message: '대상 시트 이름:',
        default: this.config.defaultSheet
      }
    ]);

    // 3. 백업 옵션 설정
    const { options } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'options',
        message: '백업 옵션 선택:',
        choices: [
          { name: '체크포인트에서 재개', value: 'resume', checked: false },
          { name: '업로드 후 최종 검증', value: 'validate', checked: true },
          { name: '임시 시트 사용', value: 'tempSheet', checked: true },
          { name: '테스트 모드 (10개만)', value: 'test', checked: false }
        ]
      }
    ]);

    // 4. 고급 설정
    const { advanced } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'advanced',
        message: '고급 설정을 변경하시겠습니까?',
        default: false
      }
    ]);

    let maxRetries = 3;

    if (advanced) {
      const advancedSettings = await inquirer.prompt([
        {
          type: 'number',
          name: 'maxRetries',
          message: '최대 재시도 횟수:',
          default: 3
        }
      ]);

      maxRetries = advancedSettings.maxRetries;
    }

    // 5. 확인
    console.log(chalk.cyan('\n📋 백업 설정 요약:\n'));
    console.log(chalk.white(`   • 백업 파일: ${path.basename(selectedFile)}`));
    console.log(chalk.white(`   • 대상 시트: ${sheetName}`));
    console.log(chalk.white(`   • 배치 크기: 자동 (동적 계산)`));
    console.log(chalk.white(`   • 재시도 횟수: ${maxRetries}`));
    console.log(chalk.white(`   • 옵션: ${options.join(', ') || '없음'}`));

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '백업을 시작하시겠습니까?',
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('백업이 취소되었습니다.'));
      return;
    }

    // 백업 실행
    await this.executeBackup({
      txt: selectedFile,
      sheet: sheetName,
      retry: maxRetries,
      resume: options.includes('resume'),
      validate: options.includes('validate'),
      tempSheet: options.includes('tempSheet'),
      test: options.includes('test')
    });
  }

  /**
   * 백업 실행
   */
  async executeBackup(options) {
    const spinner = ora('백업 서비스 초기화 중...').start();

    try {
      // SafeGoogleSheetsBackupService 초기화
      const backupService = new SafeGoogleSheetsBackupService(
        this.config.sheetsId,
        this.config.credentialsPath
      );

      // 설정 커스터마이징
      if (options.retry) {
        backupService.config.maxRetries = options.retry;
      }
      if (options.tempSheet !== undefined) {
        backupService.config.useTemporarySheet = options.tempSheet;
      }

      // 초기화
      spinner.text = 'Google Sheets API 연결 중...';
      await backupService.initialize();

      spinner.stop();

      // 테스트 모드 처리
      let txtPath = options.txt;
      if (options.test) {
        console.log(chalk.yellow('\n⚠️ 테스트 모드: 처음 10개 데이터만 처리합니다.\n'));
        txtPath = await this.createTestFile(options.txt);
      }

      // 백업 실행
      console.log(chalk.cyan('\n🚀 백업 시작 (v2 동적 배치)\n'));

      const result = await backupService.safeBackup(
        txtPath,
        options.sheet,
        {
          resume: options.resume
        }
      );

      if (result.success) {
        const duration = Math.floor(result.duration / 1000);
        console.log(chalk.green('\n✅ 백업 완료!'));
        console.log(chalk.green(`   • 처리된 행: ${result.processedRows}개`));
        console.log(chalk.green(`   • 소요 시간: ${duration}초`));
        console.log(chalk.green(`   • 백업 파일: ${result.backupFile}`));
      }

      // 오래된 백업 정리
      await backupService.cleanupOldBackups();

    } catch (error) {
      spinner.stop();

      if (error.message.includes('502') || error.message.includes('Server Error')) {
        console.error(chalk.red('\n❌ Google Sheets API 오류 (502)'));
        console.log(chalk.yellow('\n💡 해결 방법:'));
        console.log(chalk.yellow('   1. 잠시 후 다시 시도하세요'));
        console.log(chalk.yellow('   2. --resume 옵션으로 중단된 지점부터 재개하세요'));
        console.log(chalk.yellow('   3. 배치 크기가 자동으로 축소됩니다'));
        console.log(chalk.yellow('\n예시: node safe-backup-to-sheets.js --resume'));
      } else {
        console.error(chalk.red('\n❌ 백업 실패:'), error.message);
      }

      // 체크포인트 정보 표시
      const checkpointFile = path.join(process.cwd(), 'checkpoints', `checkpoint_${this.config.sheetsId}.json`);
      try {
        await fs.access(checkpointFile);
        console.log(chalk.yellow('\n💾 체크포인트가 저장되었습니다.'));
        console.log(chalk.yellow('   --resume 옵션으로 재개할 수 있습니다.'));
      } catch {
        // 체크포인트 없음
      }
    }
  }

  /**
   * 백업 파일 찾기
   */
  async findBackupFiles() {
    try {
      const files = await fs.readdir(this.config.backupDir);
      const txtFiles = [];

      for (const file of files) {
        if (file.endsWith('.txt')) {
          const filePath = path.join(this.config.backupDir, file);
          const stats = await fs.stat(filePath);

          txtFiles.push({
            name: file,
            path: filePath,
            size: Math.round(stats.size / 1024),
            modified: new Date(stats.mtime).toLocaleString('ko-KR')
          });
        }
      }

      // 수정 시간 기준 내림차순 정렬
      txtFiles.sort((a, b) => b.modified.localeCompare(a.modified));

      return txtFiles;
    } catch (error) {
      return [];
    }
  }

  /**
   * 테스트 파일 생성
   */
  async createTestFile(originalPath) {
    const content = await fs.readFile(originalPath, 'utf-8');
    const lines = content.split('\n');

    // 헤더 + 10개 데이터
    const testLines = lines.slice(0, 11);

    const testPath = path.join(this.config.backupDir, 'test_backup.txt');
    await fs.writeFile(testPath, testLines.join('\n'));

    return testPath;
  }

  /**
   * 명령줄 인수 파싱
   */
  parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '--txt':
          options.txt = args[++i];
          break;
        case '--sheet':
          options.sheet = args[++i];
          break;
        case '--retry':
          options.retry = parseInt(args[++i]);
          break;
        case '--resume':
          options.resume = true;
          break;
        case '--validate':
          options.validate = true;
          break;
        case '--test':
          options.test = true;
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
    console.log(chalk.cyan('\n안전한 Google Sheets 백업 도구 v2\n'));
    console.log('사용법: node safe-backup-to-sheets.js [옵션]\n');
    console.log('옵션:');
    console.log('  --txt <path>      TXT 백업 파일 경로');
    console.log('  --sheet <name>    대상 시트 이름 (기본: 애즈파워현황)');
    console.log('  --retry <count>   최대 재시도 횟수 (기본: 3)');
    console.log('  --resume          체크포인트에서 재개');
    console.log('  --validate        업로드 후 최종 검증');
    console.log('  --test            테스트 모드 (처음 10개만)');
    console.log('  --help            이 도움말 표시\n');
    console.log('배치 크기는 데이터 크기에 따라 자동으로 계산됩니다 (100~3000행).\n');
    console.log('예시:');
    console.log('  node safe-backup-to-sheets.js');
    console.log('  node safe-backup-to-sheets.js --resume');
    console.log('  node safe-backup-to-sheets.js --test --validate');
  }
}

// 환경 변수 로드
require('dotenv').config();

// CLI 실행
const cli = new SafeBackupCLI();
cli.run();
