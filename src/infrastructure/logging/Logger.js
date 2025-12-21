/**
 * 중앙 집중식 로그 시스템
 * 모든 워크플로우의 상세 로그를 파일로 저장
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { format } = require('date-fns');

class Logger {
  constructor(config = {}) {
    this.config = {
      baseDir: config.baseDir || path.join(process.cwd(), 'logs'),
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 30, // 30일치 보관
      enableConsole: config.enableConsole !== false,
      enableFile: config.enableFile !== false,
      level: config.level || 'INFO', // DEBUG, INFO, WARNING, ERROR
      ...config
    };
    
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARNING: 2,
      ERROR: 3
    };
    
    this.currentLevel = this.levels[this.config.level] || 1;
    this.contextStack = [];
    this.sessionId = this.generateSessionId();
    
    // 로그 디렉토리 생성
    this.initializeLogDirectory();
  }

  /**
   * 로그 디렉토리 초기화
   */
  async initializeLogDirectory() {
    try {
      // 메인 로그 디렉토리
      await fs.mkdir(this.config.baseDir, { recursive: true });
      
      // 서브 디렉토리들
      const subDirs = ['workflows', 'errors', 'sessions', 'daily'];
      for (const dir of subDirs) {
        await fs.mkdir(path.join(this.config.baseDir, dir), { recursive: true });
      }
      
      // 로그 정리 (오래된 파일 삭제)
      await this.cleanOldLogs();
    } catch (error) {
      console.error('로그 디렉토리 생성 실패:', error);
    }
  }

  /**
   * 세션 ID 생성
   */
  generateSessionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
  }

  /**
   * 컨텍스트 추가 (워크플로우, 프로필 등)
   */
  pushContext(context) {
    this.contextStack.push(context);
    return this;
  }

  /**
   * 컨텍스트 제거
   */
  popContext() {
    this.contextStack.pop();
    return this;
  }

  /**
   * 현재 컨텍스트 문자열 생성
   */
  getContextString() {
    if (this.contextStack.length === 0) return '';
    return `[${this.contextStack.join(' > ')}]`;
  }

  /**
   * 로그 메시지 포맷팅
   */
  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const context = this.getContextString();
    
    let formattedMessage = {
      timestamp,
      sessionId: this.sessionId,
      level,
      context: this.contextStack,
      message,
      data: data || undefined
    };
    
    // 파일용 JSON 포맷
    const fileFormat = JSON.stringify(formattedMessage);
    
    // 콘솔용 컬러 포맷
    const levelColors = {
      DEBUG: chalk.gray,
      INFO: chalk.cyan,
      WARNING: chalk.yellow,
      ERROR: chalk.red
    };
    
    const color = levelColors[level] || chalk.white;
    const consoleFormat = `${chalk.gray(timestamp)} ${color(`[${level}]`)} ${context} ${message}`;
    
    return { fileFormat, consoleFormat, structured: formattedMessage };
  }

  /**
   * 로그 파일 경로 생성
   */
  getLogFilePath(type = 'general') {
    const date = format(new Date(), 'yyyy-MM-dd');
    const hour = format(new Date(), 'HH');
    
    switch (type) {
      case 'workflow':
        return path.join(this.config.baseDir, 'workflows', `workflow_${date}_${hour}.log`);
      case 'error':
        return path.join(this.config.baseDir, 'errors', `error_${date}.log`);
      case 'session':
        return path.join(this.config.baseDir, 'sessions', `${this.sessionId}.log`);
      case 'daily':
        return path.join(this.config.baseDir, 'daily', `daily_${date}.log`);
      default:
        return path.join(this.config.baseDir, `general_${date}.log`);
    }
  }

  /**
   * 파일에 로그 쓰기
   */
  async writeToFile(message, type = 'general') {
    if (!this.config.enableFile) return;
    
    try {
      const filePath = this.getLogFilePath(type);
      await fs.appendFile(filePath, message.fileFormat + '\n', 'utf8');
      
      // 세션 로그에도 기록
      const sessionPath = this.getLogFilePath('session');
      await fs.appendFile(sessionPath, message.fileFormat + '\n', 'utf8');
      
    } catch (error) {
      console.error('로그 파일 쓰기 실패:', error);
    }
  }

  /**
   * 콘솔에 로그 출력
   */
  writeToConsole(message) {
    if (!this.config.enableConsole) return;
    console.log(message.consoleFormat);
  }

  /**
   * 메인 로그 메서드
   */
  async log(level, message, data = null) {
    // 레벨 체크
    if (this.levels[level] < this.currentLevel) return;
    
    const formatted = this.formatMessage(level, message, data);
    
    // 콘솔 출력
    this.writeToConsole(formatted);
    
    // 파일 저장
    const fileType = level === 'ERROR' ? 'error' : 
                     this.contextStack.includes('Workflow') ? 'workflow' : 
                     'daily';
    await this.writeToFile(formatted, fileType);
    
    // 구조화된 데이터 반환
    return formatted.structured;
  }

  /**
   * 레벨별 편의 메서드
   */
  async debug(message, data = null) {
    return this.log('DEBUG', message, data);
  }

  async info(message, data = null) {
    return this.log('INFO', message, data);
  }

  async warning(message, data = null) {
    return this.log('WARNING', message, data);
  }

  async error(message, data = null) {
    return this.log('ERROR', message, data);
  }

  /**
   * 워크플로우 시작 로깅
   */
  async logWorkflowStart(workflowName, params = {}) {
    this.pushContext('Workflow');
    this.pushContext(workflowName);
    
    await this.info(`워크플로우 시작: ${workflowName}`, {
      type: 'WORKFLOW_START',
      workflow: workflowName,
      params,
      startTime: new Date().toISOString()
    });
  }

  /**
   * 워크플로우 종료 로깅
   */
  async logWorkflowEnd(workflowName, result = {}) {
    await this.info(`워크플로우 종료: ${workflowName}`, {
      type: 'WORKFLOW_END',
      workflow: workflowName,
      result,
      endTime: new Date().toISOString()
    });
    
    this.popContext(); // workflowName
    this.popContext(); // Workflow
  }

  /**
   * 단계별 로깅
   */
  async logStep(stepName, details = {}) {
    await this.info(`단계 실행: ${stepName}`, {
      type: 'STEP',
      step: stepName,
      details
    });
  }

  /**
   * 성능 측정 로깅
   */
  async logPerformance(operation, duration, details = {}) {
    await this.debug(`성능 측정: ${operation} - ${duration}ms`, {
      type: 'PERFORMANCE',
      operation,
      duration,
      details
    });
  }

  /**
   * 오래된 로그 파일 정리
   */
  async cleanOldLogs() {
    try {
      const dirs = ['workflows', 'errors', 'sessions', 'daily'];
      const maxAge = this.config.maxFiles * 24 * 60 * 60 * 1000; // 일수를 밀리초로
      const now = Date.now();
      
      for (const dir of dirs) {
        const dirPath = path.join(this.config.baseDir, dir);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
            console.log(chalk.gray(`오래된 로그 삭제: ${file}`));
          }
        }
      }
    } catch (error) {
      console.error('로그 정리 실패:', error);
    }
  }

  /**
   * 로그 통계 조회
   */
  async getLogStats() {
    try {
      const stats = {
        sessionId: this.sessionId,
        totalLogs: 0,
        byLevel: { DEBUG: 0, INFO: 0, WARNING: 0, ERROR: 0 },
        byType: { workflows: 0, errors: 0, sessions: 0, daily: 0 }
      };
      
      // 현재 세션 로그 분석
      const sessionPath = this.getLogFilePath('session');
      try {
        const content = await fs.readFile(sessionPath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        stats.totalLogs = lines.length;
        
        lines.forEach(line => {
          try {
            const log = JSON.parse(line);
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
          } catch (e) {
            // JSON 파싱 실패 무시
          }
        });
      } catch (e) {
        // 파일이 없을 수 있음
      }
      
      return stats;
    } catch (error) {
      console.error('로그 통계 조회 실패:', error);
      return null;
    }
  }
}

// 싱글톤 인스턴스
let loggerInstance = null;

/**
 * 로거 인스턴스 생성 또는 반환
 */
function createLogger(config = {}) {
  if (!loggerInstance) {
    loggerInstance = new Logger(config);
  }
  return loggerInstance;
}

module.exports = {
  Logger,
  createLogger
};