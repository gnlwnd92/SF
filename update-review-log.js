/**
 * 검토 로그 업데이트 유틸리티
 * 사용법: node update-review-log.js [command] [options]
 */

const chalk = require('chalk');
const ReviewLogManager = require('./src/utils/ReviewLogManager');

class ReviewLogUpdater {
  constructor() {
    this.logManager = new ReviewLogManager();
  }

  /**
   * 도움말 표시
   */
  showHelp() {
    console.log(chalk.cyan('🔧 구독재개 검토 로그 업데이트 유틸리티\n'));
    console.log(chalk.yellow('사용법:'));
    console.log('  node update-review-log.js <command> [options]\n');
    
    console.log(chalk.yellow('명령어:'));
    console.log('  step-complete <stepNumber> <stepName>  - 단계 완료 업데이트');
    console.log('  add-issue <title> <description>        - 발견된 문제점 추가');
    console.log('  add-improvement <title> <description>  - 개선사항 추가');
    console.log('  update-progress <stepNumber>           - 진행상황 업데이트');
    console.log('  backup                                 - 로그 파일 백업');
    console.log('  validate                               - 로그 파일 검증');
    console.log('  test                                   - 테스트 업데이트 실행\n');
    
    console.log(chalk.yellow('예시:'));
    console.log('  node update-review-log.js step-complete 1 "구글 시트 데이터 읽기"');
    console.log('  node update-review-log.js add-issue "스프레드시트 ID 불일치" "환경변수 설정 문제"');
    console.log('  node update-review-log.js backup');
  }

  /**
   * 단계 완료 업데이트
   */
  async updateStepComplete(stepNumber, stepName, additionalData = {}) {
    console.log(chalk.blue(`🔄 ${stepNumber}단계 완료 업데이트 중...`));
    
    const data = {
      success: true,
      data: {
        stepNumber,
        stepName,
        completedAt: new Date().toISOString(),
        ...additionalData
      },
      details: `${stepName} 검증 완료`
    };

    const success = await this.logManager.updateStepCompletion(stepNumber, stepName, data);
    
    if (success) {
      console.log(chalk.green(`✅ ${stepNumber}단계 업데이트 완료`));
    } else {
      console.log(chalk.red(`❌ ${stepNumber}단계 업데이트 실패`));
    }
    
    return success;
  }

  /**
   * 문제점 추가
   */
  async addIssue(title, description, solution = null) {
    console.log(chalk.blue(`🔄 문제점 추가 중: ${title}`));
    
    const success = await this.logManager.addDiscoveredIssue(title, description, solution);
    
    if (success) {
      console.log(chalk.green('✅ 문제점 추가 완료'));
    } else {
      console.log(chalk.red('❌ 문제점 추가 실패'));
    }
    
    return success;
  }

  /**
   * 개선사항 추가
   */
  async addImprovement(title, description, codeExample = null) {
    console.log(chalk.blue(`🔄 개선사항 추가 중: ${title}`));
    
    const success = await this.logManager.addImprovement(title, description, codeExample);
    
    if (success) {
      console.log(chalk.green('✅ 개선사항 추가 완료'));
    } else {
      console.log(chalk.red('❌ 개선사항 추가 실패'));
    }
    
    return success;
  }

  /**
   * 진행상황 업데이트
   */
  async updateProgress(stepNumber, isCompleted = true, details = null) {
    console.log(chalk.blue(`🔄 ${stepNumber}단계 진행상황 업데이트 중...`));
    
    const success = await this.logManager.updateProgressChecklist(stepNumber, isCompleted, details);
    
    if (success) {
      console.log(chalk.green('✅ 진행상황 업데이트 완료'));
    } else {
      console.log(chalk.red('❌ 진행상황 업데이트 실패'));
    }
    
    return success;
  }

  /**
   * 로그 파일 백업
   */
  async backupLog() {
    console.log(chalk.blue('🔄 로그 파일 백업 중...'));
    
    const success = await this.logManager.backupLogFile();
    return success;
  }

  /**
   * 로그 파일 검증
   */
  async validateLog() {
    console.log(chalk.blue('🔄 로그 파일 검증 중...'));
    
    const isValid = await this.logManager.validateLogFile();
    
    if (isValid) {
      console.log(chalk.green('✅ 로그 파일 검증 통과'));
    } else {
      console.log(chalk.red('❌ 로그 파일 검증 실패'));
    }
    
    return isValid;
  }

  /**
   * 테스트 업데이트 실행
   */
  async runTest() {
    console.log(chalk.cyan('🧪 테스트 업데이트 실행 중...\n'));
    
    // 1단계 완료 업데이트 테스트
    await this.updateStepComplete(1, '구글 시트 데이터 읽기', {
      email: 'juelzosu34065@gmail.com',
      status: '일시중지',
      extractedAt: new Date().toISOString()
    });
    
    // 2단계 완료 업데이트 테스트
    await this.updateStepComplete(2, '프로필 ID 매칭', {
      profileId: '8587',
      adsId: 'k11w7on9',
      searchedRows: 3745
    });
    
    // 3단계 완료 업데이트 테스트
    await this.updateStepComplete(3, 'AdsPower 브라우저 실행 테스트', {
      connectionTested: true,
      errorHandlingImplemented: true
    });
    
    console.log(chalk.green('\n✅ 테스트 업데이트 완료'));
  }

  /**
   * 명령행 인터페이스 실행
   */
  async run() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      this.showHelp();
      return;
    }
    
    const command = args[0];
    
    try {
      switch (command) {
        case 'step-complete':
          if (args.length < 3) {
            console.log(chalk.red('❌ 사용법: step-complete <stepNumber> <stepName>'));
            return;
          }
          await this.updateStepComplete(args[1], args[2]);
          break;
          
        case 'add-issue':
          if (args.length < 3) {
            console.log(chalk.red('❌ 사용법: add-issue <title> <description>'));
            return;
          }
          await this.addIssue(args[1], args[2], args[3]);
          break;
          
        case 'add-improvement':
          if (args.length < 3) {
            console.log(chalk.red('❌ 사용법: add-improvement <title> <description>'));
            return;
          }
          await this.addImprovement(args[1], args[2], args[3]);
          break;
          
        case 'update-progress':
          if (args.length < 2) {
            console.log(chalk.red('❌ 사용법: update-progress <stepNumber>'));
            return;
          }
          await this.updateProgress(args[1], true, args[2]);
          break;
          
        case 'backup':
          await this.backupLog();
          break;
          
        case 'validate':
          await this.validateLog();
          break;
          
        case 'test':
          await this.runTest();
          break;
          
        case 'help':
        case '--help':
        case '-h':
          this.showHelp();
          break;
          
        default:
          console.log(chalk.red(`❌ 알 수 없는 명령어: ${command}`));
          this.showHelp();
      }
    } catch (error) {
      console.error(chalk.red('❌ 명령 실행 실패:'), error.message);
    }
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  const updater = new ReviewLogUpdater();
  updater.run();
}

module.exports = ReviewLogUpdater;