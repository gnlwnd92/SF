const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const util = require('util');

/**
 * 개선된 터미널 로거 - JSON 파싱 오류 해결
 * 
 * 주요 개선사항:
 * 1. 안전한 JSON 직렬화
 * 2. 특수 문자 및 Unicode 처리
 * 3. 파일 잠금 메커니즘
 * 4. 에러 복구 로직
 */
class ImprovedTerminalLogger {
  constructor(config = {}) {
    this.config = {
      logDir: config.logDir || path.join(process.cwd(), 'logs', 'terminal'),
      maxBufferSize: config.maxBufferSize || 10,
      flushInterval: config.flushInterval || 5000,
      ...config
    };
    
    this.logBuffer = [];
    this.currentLogFile = null;
    this.originalConsole = {};
    this.isWriting = false;
    this.writeQueue = [];
    this.flushTimer = null;
  }

  /**
   * 로거 초기화
   */
  async initialize() {
    try {
      await this.ensureLogDirectory();
      this.currentLogFile = await this.createLogFile();
      this.overrideConsole();
      this.startFlushTimer();
      
      // 프로세스 종료 이벤트 핸들링
      process.on('exit', () => this.flushBufferSync());
      process.on('SIGINT', () => this.handleShutdown('SIGINT'));
      process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
      
      return true;
    } catch (error) {
      console.error('터미널 로거 초기화 실패:', error);
      return false;
    }
  }

  /**
   * 로그 디렉토리 확인 및 생성
   */
  async ensureLogDirectory() {
    if (!fsSync.existsSync(this.config.logDir)) {
      await fs.mkdir(this.config.logDir, { recursive: true });
    }
  }

  /**
   * 로그 파일 생성
   */
  async createLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionId = this.getSessionId();
    const filename = `terminal-log-${timestamp}-${sessionId}.json`;
    const filepath = path.join(this.config.logDir, filename);
    
    const metadata = {
      version: '2.0.0',
      sessionId: sessionId,
      startTime: new Date().toISOString(),
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      env: {
        USE_MOCK_REPOSITORY: process.env.USE_MOCK_REPOSITORY,
        DEBUG_MODE: process.env.DEBUG_MODE,
        NODE_ENV: process.env.NODE_ENV
      },
      logs: []
    };
    
    await fs.writeFile(filepath, JSON.stringify(metadata, null, 2));
    return filepath;
  }

  /**
   * 세션 ID 생성
   */
  getSessionId() {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Console 메서드 오버라이드
   */
  overrideConsole() {
    const methods = ['log', 'info', 'warn', 'error', 'debug'];
    
    methods.forEach(method => {
      this.originalConsole[method] = console[method];
      
      console[method] = (...args) => {
        // 원본 console 출력
        this.originalConsole[method](...args);
        
        // 로그 저장 (비동기, 에러 무시)
        this.captureLog(method, args).catch(() => {});
      };
    });
  }

  /**
   * 안전한 문자열 변환
   * Unicode 및 특수 문자 처리
   */
  safeStringify(obj) {
    try {
      // 순환 참조 처리를 위한 캐시
      const cache = new Set();
      
      return JSON.stringify(obj, (key, value) => {
        // 순환 참조 체크
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) {
            return '[Circular Reference]';
          }
          cache.add(value);
        }
        
        // 특수 타입 처리
        if (value === undefined) return '[undefined]';
        if (value === null) return null;
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'symbol') return '[Symbol]';
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        }
        
        // 문자열 정제
        if (typeof value === 'string') {
          // ANSI 색상 코드 제거
          value = value.replace(/\x1b\[[0-9;]*m/g, '');
          
          // 제어 문자 제거 (탭, 줄바꿈 제외)
          value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
          
          // 유효하지 않은 Unicode 대체
          value = value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�');
          value = value.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
          
          // 긴 문자열 자르기
          if (value.length > 10000) {
            value = value.substring(0, 10000) + '... [truncated]';
          }
        }
        
        return value;
      }, 2);
    } catch (error) {
      // JSON 직렬화 실패 시 안전한 문자열 반환
      return JSON.stringify({
        error: 'Failed to serialize',
        type: typeof obj,
        message: String(obj).substring(0, 1000)
      });
    }
  }

  /**
   * 로그 캡처 및 저장
   */
  async captureLog(level, args) {
    try {
      // 로그 메시지 포맷팅
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          return util.inspect(arg, { 
            depth: 3, 
            colors: false,
            maxArrayLength: 100,
            breakLength: 120
          });
        }
        // ANSI 색상 코드 제거
        return String(arg).replace(/\x1b\[[0-9;]*m/g, '');
      }).join(' ');
      
      // 로그 엔트리 생성
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: level,
        message: this.sanitizeMessage(message),
        raw: this.safeSerializeArgs(args)
      };
      
      // 버퍼에 추가
      this.logBuffer.push(logEntry);
      
      // 버퍼가 일정 크기 이상이면 파일에 기록
      if (this.logBuffer.length >= this.config.maxBufferSize) {
        await this.flushBuffer();
      }
      
    } catch (error) {
      // 로깅 실패는 조용히 처리 (무한 루프 방지)
    }
  }

  /**
   * 메시지 정제
   */
  sanitizeMessage(message) {
    if (typeof message !== 'string') {
      message = String(message);
    }
    
    // 최대 길이 제한
    if (message.length > 50000) {
      message = message.substring(0, 50000) + '... [truncated]';
    }
    
    // 제어 문자 제거
    message = message.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    return message;
  }

  /**
   * 인자 안전 직렬화
   */
  safeSerializeArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          // 깊은 복사 후 직렬화
          const parsed = JSON.parse(this.safeStringify(arg));
          return parsed;
        } catch {
          return String(arg).substring(0, 1000);
        }
      }
      
      if (typeof arg === 'string') {
        return this.sanitizeMessage(arg);
      }
      
      return arg;
    });
  }

  /**
   * 버퍼 플러시 (개선된 버전)
   */
  async flushBuffer() {
    if (this.logBuffer.length === 0 || !this.currentLogFile) return;
    
    // 이미 쓰기 중이면 큐에 추가
    if (this.isWriting) {
      return new Promise((resolve) => {
        this.writeQueue.push(resolve);
      });
    }
    
    this.isWriting = true;
    const bufferCopy = [...this.logBuffer];
    this.logBuffer = [];
    
    try {
      // 파일 읽기 시도
      let data;
      try {
        const content = await fs.readFile(this.currentLogFile, 'utf-8');
        data = JSON.parse(content);
      } catch (error) {
        // 파일 읽기 실패 시 새로운 구조 생성
        data = {
          version: '2.0.0',
          sessionId: this.getSessionId(),
          startTime: new Date().toISOString(),
          logs: [],
          errors: []
        };
      }
      
      // 로그 추가
      data.logs.push(...bufferCopy);
      data.lastUpdate = new Date().toISOString();
      
      // 안전한 JSON 문자열 생성
      const jsonString = this.safeStringify(data);
      
      // 파일에 쓰기
      await fs.writeFile(this.currentLogFile, jsonString);
      
    } catch (error) {
      // 에러 발생 시 백업 파일에 저장
      try {
        const backupFile = this.currentLogFile.replace('.json', '-backup.json');
        const backupData = {
          error: 'Failed to write to main log',
          timestamp: new Date().toISOString(),
          logs: bufferCopy
        };
        await fs.writeFile(backupFile, this.safeStringify(backupData));
      } catch {
        // 백업도 실패하면 포기
      }
    } finally {
      this.isWriting = false;
      
      // 대기 중인 쓰기 작업 처리
      const queue = this.writeQueue;
      this.writeQueue = [];
      queue.forEach(resolve => resolve());
    }
  }

  /**
   * 동기적 버퍼 플러시 (강제 종료 시)
   */
  flushBufferSync() {
    if (this.logBuffer.length === 0 || !this.currentLogFile) return;
    
    try {
      let data;
      try {
        const content = fsSync.readFileSync(this.currentLogFile, 'utf-8');
        data = JSON.parse(content);
      } catch {
        data = {
          version: '2.0.0',
          sessionId: this.getSessionId(),
          logs: [],
          forcedShutdown: true
        };
      }
      
      data.logs.push(...this.logBuffer);
      data.lastUpdate = new Date().toISOString();
      data.forcedShutdown = true;
      
      const jsonString = this.safeStringify(data);
      fsSync.writeFileSync(this.currentLogFile, jsonString);
      
      this.logBuffer = [];
    } catch (error) {
      // 동기 플러시 실패 시 콘솔에 출력
      console.error('동기 로그 플러시 실패:', error.message);
    }
  }

  /**
   * 주기적 플러시 타이머 시작
   */
  startFlushTimer() {
    this.flushTimer = setInterval(() => {
      this.flushBuffer().catch(() => {});
    }, this.config.flushInterval);
  }

  /**
   * 종료 처리
   */
  async handleShutdown(signal) {
    console.log(`\n🔄 ${signal} 시그널 받음. 안전하게 종료 중...`);
    
    // 타이머 정리
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // 마지막 로그 저장
    await this.flushBuffer();
    
    // 콘솔 복원
    this.restoreConsole();
    
    console.log('✓ 로그 저장 완료');
    
    if (this.currentLogFile) {
      console.log(`📝 로그 파일: ${path.basename(this.currentLogFile)}`);
    }
    
    process.exit(0);
  }

  /**
   * Console 원래대로 복원
   */
  restoreConsole() {
    Object.keys(this.originalConsole).forEach(method => {
      if (this.originalConsole[method]) {
        console[method] = this.originalConsole[method];
      }
    });
  }

  /**
   * 싱글톤 인스턴스 가져오기
   */
  static getInstance(config) {
    if (!ImprovedTerminalLogger.instance) {
      ImprovedTerminalLogger.instance = new ImprovedTerminalLogger(config);
    }
    return ImprovedTerminalLogger.instance;
  }
}

// 기본 내보내기
module.exports = ImprovedTerminalLogger;

// 편의 함수
module.exports.getTerminalLogger = (config) => {
  return ImprovedTerminalLogger.getInstance(config);
};