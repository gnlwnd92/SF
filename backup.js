#!/usr/bin/env node

/**
 * AdsPower YouTube Automation - 백업 스크립트
 * 설정 및 중요 파일을 백업합니다
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class BackupManager {
  constructor() {
    this.backupDir = path.join(__dirname, 'backup');
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    this.backupPath = path.join(this.backupDir, `backup_${this.timestamp}`);
  }

  async run() {
    console.clear();
    console.log(chalk.cyan.bold('='.repeat(60)));
    console.log(chalk.cyan.bold('AdsPower YouTube Automation - 백업 도구'));
    console.log(chalk.cyan.bold('='.repeat(60)));
    console.log();

    try {
      // 백업 디렉터리 생성
      await this.createBackupDirectory();
      
      // 설정 파일 백업
      await this.backupConfigFiles();
      
      // 인증 파일 백업
      await this.backupCredentials();
      
      // 로그 파일 백업 (선택적)
      await this.backupLogs();
      
      // 백업 압축
      await this.compressBackup();
      
      // 백업 정보 저장
      await this.saveBackupInfo();
      
      // 완료 보고
      this.showReport();
      
    } catch (error) {
      console.error(chalk.red('\\n❌ 백업 중 오류 발생:'), error.message);
      process.exit(1);
    }
  }

  async createBackupDirectory() {
    const spinner = ora('백업 디렉터리 생성 중...').start();
    
    try {
      await fs.mkdir(this.backupPath, { recursive: true });
      await fs.mkdir(path.join(this.backupPath, 'config'), { recursive: true });
      await fs.mkdir(path.join(this.backupPath, 'credentials'), { recursive: true });
      await fs.mkdir(path.join(this.backupPath, 'logs'), { recursive: true });
      
      spinner.succeed('백업 디렉터리 생성 완료');
    } catch (error) {
      spinner.fail('백업 디렉터리 생성 실패');
      throw error;
    }
  }

  async backupConfigFiles() {
    const spinner = ora('설정 파일 백업 중...').start();
    
    const configFiles = [
      '.env',
      '.env.example',
      'package.json',
      'package-lock.json'
    ];

    let backedUpCount = 0;
    
    for (const file of configFiles) {
      const sourcePath = path.join(__dirname, file);
      const destPath = path.join(this.backupPath, 'config', file);
      
      try {
        await fs.access(sourcePath);
        await fs.copyFile(sourcePath, destPath);
        backedUpCount++;
      } catch (error) {
        // 파일이 없을 수 있음
      }
    }
    
    spinner.succeed(`설정 파일 ${backedUpCount}개 백업 완료`);
  }

  async backupCredentials() {
    const spinner = ora('인증 파일 백업 중...').start();
    
    const credPath = path.join(__dirname, 'credentials');
    const backupCredPath = path.join(this.backupPath, 'credentials');
    
    try {
      const files = await fs.readdir(credPath);
      let backedUpCount = 0;
      
      for (const file of files) {
        const sourcePath = path.join(credPath, file);
        const destPath = path.join(backupCredPath, file);
        
        try {
          const stat = await fs.stat(sourcePath);
          if (stat.isFile()) {
            await fs.copyFile(sourcePath, destPath);
            backedUpCount++;
          }
        } catch (error) {
          // 파일 복사 실패 무시
        }
      }
      
      if (backedUpCount > 0) {
        spinner.succeed(`인증 파일 ${backedUpCount}개 백업 완료`);
      } else {
        spinner.warn('백업할 인증 파일이 없습니다');
      }
    } catch (error) {
      spinner.warn('credentials 폴더가 없습니다');
    }
  }

  async backupLogs() {
    const spinner = ora('로그 파일 백업 중...').start();
    
    const logsPath = path.join(__dirname, 'logs');
    const backupLogsPath = path.join(this.backupPath, 'logs');
    
    try {
      // 최근 로그 파일만 백업 (최근 7일)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      let backedUpCount = 0;
      
      async function copyRecentLogs(dir, backupDir) {
        try {
          const items = await fs.readdir(dir);
          
          for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = await fs.stat(itemPath);
            
            if (stat.isFile() && stat.mtimeMs > sevenDaysAgo) {
              const destPath = path.join(backupDir, item);
              await fs.mkdir(path.dirname(destPath), { recursive: true });
              await fs.copyFile(itemPath, destPath);
              backedUpCount++;
            } else if (stat.isDirectory()) {
              const newBackupDir = path.join(backupDir, item);
              await copyRecentLogs(itemPath, newBackupDir);
            }
          }
        } catch (error) {
          // 디렉터리 읽기 실패 무시
        }
      }
      
      await copyRecentLogs(logsPath, backupLogsPath);
      
      if (backedUpCount > 0) {
        spinner.succeed(`최근 로그 파일 ${backedUpCount}개 백업 완료`);
      } else {
        spinner.info('백업할 최근 로그 파일이 없습니다');
      }
    } catch (error) {
      spinner.info('logs 폴더가 없습니다');
    }
  }

  async compressBackup() {
    const spinner = ora('백업 압축 중...').start();
    
    if (process.platform === 'win32') {
      // Windows에서 PowerShell을 사용한 압축
      const zipPath = `${this.backupPath}.zip`;
      const command = `powershell Compress-Archive -Path "${this.backupPath}" -DestinationPath "${zipPath}" -Force`;
      
      try {
        await execAsync(command);
        
        // 원본 폴더 삭제
        await this.deleteDirectory(this.backupPath);
        
        spinner.succeed(`백업 압축 완료: backup_${this.timestamp}.zip`);
      } catch (error) {
        spinner.warn('백업 압축 실패 (압축되지 않은 백업은 유지됩니다)');
      }
    } else {
      // Unix 계열에서 tar 사용
      const tarPath = `${this.backupPath}.tar.gz`;
      const command = `tar -czf "${tarPath}" -C "${this.backupDir}" "backup_${this.timestamp}"`;
      
      try {
        await execAsync(command);
        
        // 원본 폴더 삭제
        await this.deleteDirectory(this.backupPath);
        
        spinner.succeed(`백업 압축 완료: backup_${this.timestamp}.tar.gz`);
      } catch (error) {
        spinner.warn('백업 압축 실패 (압축되지 않은 백업은 유지됩니다)');
      }
    }
  }

  async deleteDirectory(dirPath) {
    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          await this.deleteDirectory(itemPath);
        } else {
          await fs.unlink(itemPath);
        }
      }
      
      await fs.rmdir(dirPath);
    } catch (error) {
      // 삭제 실패 무시
    }
  }

  async saveBackupInfo() {
    const spinner = ora('백업 정보 저장 중...').start();
    
    const backupInfo = {
      timestamp: this.timestamp,
      date: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      backupType: 'full',
      files: {
        config: [],
        credentials: [],
        logs: []
      }
    };

    // 백업된 파일 목록 수집
    try {
      const zipExists = await fs.access(`${this.backupPath}.zip`).then(() => true).catch(() => false);
      const tarExists = await fs.access(`${this.backupPath}.tar.gz`).then(() => true).catch(() => false);
      
      if (zipExists) {
        backupInfo.archive = `backup_${this.timestamp}.zip`;
      } else if (tarExists) {
        backupInfo.archive = `backup_${this.timestamp}.tar.gz`;
      } else {
        backupInfo.archive = `backup_${this.timestamp}`;
      }
    } catch (error) {
      // 아카이브 정보 수집 실패
    }

    // 백업 정보 파일 저장
    const infoPath = path.join(this.backupDir, 'backup_history.json');
    let history = [];
    
    try {
      const existingHistory = await fs.readFile(infoPath, 'utf8');
      history = JSON.parse(existingHistory);
    } catch (error) {
      // 기존 히스토리 없음
    }
    
    history.push(backupInfo);
    
    // 최근 10개만 유지
    if (history.length > 10) {
      history = history.slice(-10);
    }
    
    await fs.writeFile(infoPath, JSON.stringify(history, null, 2));
    
    spinner.succeed('백업 정보 저장 완료');
  }

  showReport() {
    console.log(chalk.green('\\n✅ 백업이 성공적으로 완료되었습니다!'));
    console.log(chalk.cyan('\\n백업 정보:'));
    console.log(chalk.white(`  • 타임스탬프: ${this.timestamp}`));
    console.log(chalk.white(`  • 위치: ${this.backupDir}`));
    
    const zipExists = fs.existsSync(`${this.backupPath}.zip`);
    const tarExists = fs.existsSync(`${this.backupPath}.tar.gz`);
    
    if (zipExists) {
      console.log(chalk.white(`  • 파일명: backup_${this.timestamp}.zip`));
    } else if (tarExists) {
      console.log(chalk.white(`  • 파일명: backup_${this.timestamp}.tar.gz`));
    } else {
      console.log(chalk.white(`  • 폴더명: backup_${this.timestamp}`));
    }
    
    console.log(chalk.yellow('\\n💡 복원 방법:'));
    console.log(chalk.gray('  1. 백업 파일을 새 위치에 복사'));
    console.log(chalk.gray('  2. 압축 해제'));
    console.log(chalk.gray('  3. config/.env 파일을 프로젝트 루트로 복사'));
    console.log(chalk.gray('  4. credentials 폴더를 프로젝트 루트로 복사'));
    console.log(chalk.gray('  5. npm install 실행'));
    
    console.log(chalk.gray('\\n' + '='.repeat(60)));
  }
}

// 실행
if (require.main === module) {
  const manager = new BackupManager();
  manager.run().catch(console.error);
}

module.exports = BackupManager;