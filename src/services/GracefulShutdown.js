/**
 * GracefulShutdown - ESC 키 및 안전 종료 처리
 * 작업 중 ESC 키를 누르면 현재 작업을 완료하고 로그를 저장한 후 종료
 */

const readline = require('readline');
const chalk = require('chalk');

class GracefulShutdown {
  constructor(sessionLogger) {
    this.sessionLogger = sessionLogger;
    this.isShuttingDown = false;
    this.shutdownCallbacks = [];
    this.rl = null;
    this.keyPressHandler = null;
  }

  /**
   * ESC 키 감지 시작
   */
  startListening() {
    // Windows에서 ESC 키 감지를 위한 설정
    if (process.platform === 'win32') {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      // Raw 모드 설정 (키 입력 즉시 감지)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      
      readline.emitKeypressEvents(process.stdin);
      
      // ESC 키 리스너
      this.keyPressHandler = (str, key) => {
        if (key && key.name === 'escape' && !this.isShuttingDown) {
          this.handleShutdown('user_requested');
        }
        // Ctrl+C 처리
        else if (key && key.ctrl && key.name === 'c') {
          this.handleForceShutdown();
        }
      };
      
      process.stdin.on('keypress', this.keyPressHandler);
      
      console.log(chalk.yellow('💡 팁: ESC 키를 누르면 현재 작업 완료 후 안전하게 종료됩니다.'));
      console.log(chalk.gray('    Ctrl+C를 누르면 즉시 강제 종료됩니다.\n'));
    }
    
    // 프로세스 종료 신호 처리
    process.on('SIGINT', () => this.handleShutdown('sigint'));
    process.on('SIGTERM', () => this.handleShutdown('sigterm'));
    process.on('SIGUSR2', () => this.handleShutdown('sigusr2')); // nodemon restart
    
    // 예외 처리
    process.on('uncaughtException', (error) => {
      console.error(chalk.red('예외 발생:'), error);
      this.handleShutdown('uncaught_exception');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error(chalk.red('처리되지 않은 Promise 거부:'), reason);
      // 로그만 기록하고 종료하지 않음
      if (this.sessionLogger && this.sessionLogger.logError) {
        this.sessionLogger.logError('Unhandled Promise Rejection', { reason });
      } else if (this.sessionLogger && this.sessionLogger.log) {
        this.sessionLogger.log('error', 'Unhandled Promise Rejection', { reason });
      }
      // 로거가 없어도 에러 발생하지 않도록 처리
    });
  }

  /**
   * ESC 키 감지 중지
   */
  stopListening() {
    if (this.keyPressHandler && process.stdin) {
      process.stdin.removeListener('keypress', this.keyPressHandler);
    }
    
    if (this.rl) {
      this.rl.close();
    }
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  /**
   * 종료 콜백 등록
   */
  onShutdown(callback) {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * 안전 종료 처리
   */
  async handleShutdown(reason) {
    if (this.isShuttingDown) {
      console.log(chalk.yellow('이미 종료 중입니다...'));
      return;
    }
    
    this.isShuttingDown = true;
    
    console.log('\n' + chalk.red.bold('🛑 종료 신호 감지!'));
    console.log(chalk.yellow(`종료 사유: ${this.getReasonText(reason)}`));
    console.log(chalk.cyan('현재 작업을 완료하고 로그를 저장합니다...\n'));
    
    // 키 입력 감지 중지
    this.stopListening();
    
    // 등록된 종료 콜백 실행
    for (const callback of this.shutdownCallbacks) {
      try {
        await callback(reason);
      } catch (error) {
        console.error(chalk.red('종료 콜백 실행 중 오류:'), error);
      }
    }
    
    // 세션 로그 저장
    if (this.sessionLogger) {
      console.log(chalk.yellow('\n📝 세션 로그 저장 중...'));
      
      try {
        // sessionLogger가 Proxy인 경우를 대비한 안전한 처리
        let loggerObj = this.sessionLogger;
        
        // Proxy 또는 lazy initialization 객체인 경우 실제 객체 가져오기
        if (loggerObj && typeof loggerObj === 'object') {
          // finalize 메서드가 있는지 안전하게 확인
          let hasFinalize = false;
          try {
            hasFinalize = 'finalize' in loggerObj && typeof loggerObj.finalize === 'function';
          } catch (e) {
            // Proxy 에러 무시
            hasFinalize = false;
          }
          
          if (hasFinalize) {
            const result = await loggerObj.finalize(reason);
            
            if (result) {
              console.log(chalk.green('\n✅ 모든 로그가 성공적으로 저장되었습니다.'));
              console.log(chalk.cyan(`   전체 로그: ${result.jsonFilepath}`));
              console.log(chalk.cyan(`   요약 보고서: ${result.reportFilepath}`));
            }
          } else {
            // saveLog 메서드 시도
            let hasSaveLog = false;
            try {
              hasSaveLog = 'saveLog' in loggerObj && typeof loggerObj.saveLog === 'function';
            } catch (e) {
              hasSaveLog = false;
            }
            
            if (hasSaveLog) {
              await loggerObj.saveLog();
              console.log(chalk.green('\n✅ 로그가 저장되었습니다.'));
            } else {
              console.log(chalk.yellow('⚠️ 세션 로거를 사용할 수 없습니다.'));
            }
          }
        }
      } catch (error) {
        console.error(chalk.red('로그 저장 중 오류:'), error);
      }
    }
    
    // 종료 메시지
    console.log(chalk.magenta.bold('\n👋 프로그램을 종료합니다. 감사합니다!\n'));
    
    // 프로세스 종료
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }

  /**
   * 강제 종료 처리 (Ctrl+C)
   */
  async handleForceShutdown() {
    console.log(chalk.red.bold('\n⚠️ 강제 종료 요청!'));
    
    if (this.sessionLogger) {
      // 긴급 로그 저장 시도
      try {
        await this.sessionLogger.handleEmergencyShutdown();
      } catch (error) {
        // 무시
      }
    }
    
    process.exit(1);
  }

  /**
   * 종료 사유 텍스트 변환
   */
  getReasonText(reason) {
    const reasons = {
      'user_requested': 'ESC 키 입력 (사용자 요청)',
      'sigint': 'Ctrl+C 신호',
      'sigterm': '시스템 종료 신호',
      'sigusr2': 'nodemon 재시작',
      'uncaught_exception': '처리되지 않은 예외',
      'normal': '정상 종료',
      'emergency_shutdown': '비상 종료'
    };
    
    return reasons[reason] || reason;
  }

  /**
   * 현재 종료 중인지 확인
   */
  isShuttingDownNow() {
    return this.isShuttingDown;
  }
}

module.exports = GracefulShutdown;