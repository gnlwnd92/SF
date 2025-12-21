#!/usr/bin/env node

/**
 * AdsPower YouTube Automation - 초기 설정 스크립트
 * 필요한 디렉터리 생성 및 환경 검증
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class SetupWizard {
  constructor() {
    this.config = {};
    this.errors = [];
    this.warnings = [];
  }

  async run() {
    console.clear();
    console.log(chalk.cyan.bold('='.repeat(60)));
    console.log(chalk.cyan.bold('AdsPower YouTube Automation - 설정 마법사'));
    console.log(chalk.cyan.bold('='.repeat(60)));
    console.log();

    try {
      // 1. 필수 디렉터리 생성
      await this.createDirectories();
      
      // 2. 환경 검증
      await this.checkEnvironment();
      
      // 3. .env 파일 설정
      await this.setupEnvFile();
      
      // 4. Google 인증 설정
      await this.setupGoogleAuth();
      
      // 5. AdsPower 연결 테스트
      await this.testAdsPowerConnection();
      
      // 6. 최종 리포트
      this.showFinalReport();
      
    } catch (error) {
      console.error(chalk.red('\n❌ 설정 중 오류 발생:'), error.message);
      process.exit(1);
    }
  }

  async createDirectories() {
    console.log(chalk.yellow('\n📁 필수 디렉터리 생성 중...'));
    
    const directories = [
      'logs',
      'logs/daily',
      'logs/errors',
      'logs/sessions',
      'logs/workflows',
      'screenshots',
      'credentials',
      'backup',
      'temp'
    ];

    for (const dir of directories) {
      const dirPath = path.join(__dirname, dir);
      try {
        await fs.mkdir(dirPath, { recursive: true });
        console.log(chalk.green(`  ✓ ${dir}`));
      } catch (error) {
        console.log(chalk.red(`  ✗ ${dir}: ${error.message}`));
      }
    }
  }

  async checkEnvironment() {
    console.log(chalk.yellow('\n🔍 환경 검사 중...'));
    
    // Node.js 버전 확인
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 16) {
      this.errors.push(`Node.js 버전이 너무 낮습니다. (현재: ${nodeVersion}, 필요: >=16.0.0)`);
    } else {
      console.log(chalk.green(`  ✓ Node.js ${nodeVersion}`));
    }

    // npm 패키지 확인
    try {
      const packageJson = require('./package.json');
      console.log(chalk.green(`  ✓ 프로젝트 버전: ${packageJson.version}`));
    } catch (error) {
      this.errors.push('package.json을 찾을 수 없습니다.');
    }

    // AdsPower 실행 확인 (Windows)
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('tasklist | findstr "AdsPower"');
        if (stdout) {
          console.log(chalk.green('  ✓ AdsPower가 실행 중입니다'));
        } else {
          this.warnings.push('AdsPower가 실행되지 않았습니다. 프로그램을 먼저 시작해주세요.');
        }
      } catch (error) {
        this.warnings.push('AdsPower 실행 상태를 확인할 수 없습니다.');
      }
    }
  }

  async setupEnvFile() {
    console.log(chalk.yellow('\n⚙️  환경 변수 설정...'));
    
    // .env 파일 존재 확인
    const envPath = path.join(__dirname, '.env');
    const envExamplePath = path.join(__dirname, '.env.example');
    
    try {
      await fs.access(envPath);
      console.log(chalk.green('  ✓ .env 파일이 이미 존재합니다'));
      
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: '.env 파일을 다시 설정하시겠습니까?',
          default: false
        }
      ]);
      
      if (!overwrite) {
        return;
      }
    } catch {
      // .env 파일이 없으면 생성
    }

    // 사용자 입력 받기
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'adsPowerUrl',
        message: 'AdsPower API URL:',
        default: 'http://local.adspower.net:50325'
      },
      {
        type: 'input',
        name: 'googleSheetsId',
        message: 'Google Sheets ID:',
        validate: (input) => {
          if (!input) return '필수 입력 항목입니다';
          return true;
        }
      },
      {
        type: 'list',
        name: 'language',
        message: '기본 언어 선택:',
        choices: [
          { name: '한국어', value: 'ko' },
          { name: 'English', value: 'en' },
          { name: '日本語', value: 'ja' },
          { name: '中文', value: 'zh' },
          { name: 'Tiếng Việt', value: 'vi' }
        ],
        default: 'ko'
      },
      {
        type: 'confirm',
        name: 'debugMode',
        message: '디버그 모드를 활성화하시겠습니까?',
        default: false
      }
    ]);

    // .env 파일 생성
    const envContent = `# AdsPower YouTube Automation 설정
# 생성일: ${new Date().toISOString()}

# AdsPower API
ADSPOWER_API_URL=${answers.adsPowerUrl}

# Google Sheets
GOOGLE_SHEETS_ID=${answers.googleSheetsId}
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json

# 워크플로우 설정
DEBUG_MODE=${answers.debugMode}
STEALTH_MODE=true
DEFAULT_LANGUAGE=${answers.language}

# 로깅
LOG_LEVEL=info
LOG_FILE_PATH=./logs
SAVE_SCREENSHOTS=true
SCREENSHOT_PATH=./screenshots

# 성능 설정
BATCH_SIZE=5
DEFAULT_WAIT_TIME=3000
NAVIGATION_TIMEOUT=30000
MAX_RETRIES=3
`;

    await fs.writeFile(envPath, envContent);
    console.log(chalk.green('  ✓ .env 파일이 생성되었습니다'));
    this.config = answers;
  }

  async setupGoogleAuth() {
    console.log(chalk.yellow('\n🔐 Google 인증 설정...'));
    
    const credPath = path.join(__dirname, 'credentials', 'service-account.json');
    
    try {
      await fs.access(credPath);
      console.log(chalk.green('  ✓ Google Service Account 파일이 존재합니다'));
    } catch {
      console.log(chalk.yellow('  ⚠️  Google Service Account 파일이 없습니다'));
      console.log(chalk.gray('     credentials/service-account.json 파일을 추가해주세요'));
      console.log(chalk.gray('     참고: https://console.cloud.google.com/apis/credentials'));
      this.warnings.push('Google Service Account 설정이 필요합니다');
    }
  }

  async testAdsPowerConnection() {
    console.log(chalk.yellow('\n🔌 AdsPower 연결 테스트...'));
    
    const axios = require('axios');
    const apiUrl = this.config.adsPowerUrl || 'http://local.adspower.net:50325';
    
    try {
      const response = await axios.get(`${apiUrl}/api/v1/user/list`, {
        timeout: 5000
      });
      
      if (response.data && response.data.code === 0) {
        const profileCount = response.data.data?.list?.length || 0;
        console.log(chalk.green(`  ✓ AdsPower 연결 성공 (프로필 수: ${profileCount})`));
      } else {
        this.warnings.push('AdsPower API 응답이 예상과 다릅니다');
      }
    } catch (error) {
      this.errors.push(`AdsPower 연결 실패: ${error.message}`);
    }
  }

  showFinalReport() {
    console.log(chalk.cyan.bold('\n' + '='.repeat(60)));
    console.log(chalk.cyan.bold('설정 완료 리포트'));
    console.log(chalk.cyan.bold('='.repeat(60)));

    if (this.errors.length > 0) {
      console.log(chalk.red('\n❌ 오류:'));
      this.errors.forEach(error => {
        console.log(chalk.red(`  • ${error}`));
      });
    }

    if (this.warnings.length > 0) {
      console.log(chalk.yellow('\n⚠️  경고:'));
      this.warnings.forEach(warning => {
        console.log(chalk.yellow(`  • ${warning}`));
      });
    }

    if (this.errors.length === 0) {
      console.log(chalk.green('\n✅ 설정이 완료되었습니다!'));
      console.log(chalk.white('\n다음 명령어로 프로그램을 시작하세요:'));
      console.log(chalk.cyan('  npm start'));
      console.log(chalk.white('\n또는 특정 모드로 실행:'));
      console.log(chalk.cyan('  npm run pause  # 일시정지 워크플로우'));
      console.log(chalk.cyan('  npm run resume # 재개 워크플로우'));
    } else {
      console.log(chalk.red('\n⚠️  오류를 해결한 후 다시 설정을 실행하세요:'));
      console.log(chalk.cyan('  npm run setup'));
    }

    console.log(chalk.gray('\n' + '='.repeat(60)));
  }
}

// 실행
if (require.main === module) {
  const wizard = new SetupWizard();
  wizard.run().catch(console.error);
}