/**
 * SessionLogService v1.1 - 세션 로그 및 스크린샷 통합 관리 서비스
 *
 * 기능:
 * - 폴더 구조: 날짜/계정/시간_작업종류/단계
 * - log.txt (단계별 간단 로그) + terminal.txt (터미널 상세 로그) + meta.json (프로그램용)
 * - 3일 자동 정리 + 전체 비우기
 *
 * v1.1 변경사항:
 * - terminal.txt 추가: UseCase에서 출력하는 모든 터미널 로그 기록
 * - logTerminal() 메서드 추가: 터미널 로그 버퍼링
 */
const fs = require('fs');
const path = require('path');

class SessionLogService {
  /**
   * @param {Object} options
   * @param {Object} options.logger - 로거
   * @param {boolean} options.debugMode - 디버그 모드
   */
  constructor({ logger, debugMode = false } = {}) {
    this.logger = logger || console;
    this.debugMode = debugMode;
    this.baseDir = path.join(process.cwd(), 'logs', 'screenshots');
    this.session = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════

  /**
   * 현재 날짜 문자열 (YYYY-MM-DD)
   */
  getDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 현재 시간 문자열 (HH-MM-SS)
   */
  getTimeStr() {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${hour}-${minute}-${second}`;
  }

  /**
   * 로그용 시간 문자열 (HH:MM:SS)
   */
  getLogTimeStr() {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${hour}:${minute}:${second}`;
  }

  /**
   * 폴더 생성 (재귀)
   */
  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 세션 관리
  // ═══════════════════════════════════════════════════════════════

  /**
   * 작업 세션 시작 - 폴더 생성
   * @param {string} email - 계정 이메일
   * @param {string} action - 'pause' | 'resume'
   * @param {Object} options - 추가 옵션
   * @param {string} options.profileId - AdsPower 프로필 ID
   * @returns {string} 세션 폴더 경로
   */
  startSession(email, action, options = {}) {
    const dateStr = this.getDateStr();
    const timeStr = this.getTimeStr();
    const folderName = `${timeStr}_${action}`;

    // 폴더 경로: logs/screenshots/2025-12-28/john@gmail.com/09-30-15_pause/
    const sessionPath = path.join(this.baseDir, dateStr, email, folderName);
    this.ensureDir(sessionPath);

    // 세션 정보 초기화
    this.session = {
      id: `${dateStr.replace(/-/g, '')}-${timeStr.replace(/-/g, '')}-${action}`,
      email,
      action,
      profileId: options.profileId || null,
      startTime: new Date(),
      path: sessionPath,
      screenshots: [],
      logs: [],
      terminalLogs: []  // v1.1: 터미널 상세 로그 버퍼
    };

    // 시작 로그 작성
    this.writeLog('세션 시작', true);

    if (this.debugMode) {
      this.logger.log(`[SessionLogService] 세션 시작: ${sessionPath}`);
    }

    return sessionPath;
  }

  /**
   * 세션 종료 - meta.json 및 log.txt 마무리
   * @param {string} result - 'success' | 'error'
   * @param {Object} details - 추가 정보
   * @param {string} details.resultType - 'newly_completed' | 'already_completed' (상세 결과 타입)
   */
  endSession(result, details = {}) {
    if (!this.session) {
      if (this.debugMode) {
        this.logger.warn('[SessionLogService] 활성 세션이 없습니다.');
      }
      return;
    }

    const endTime = new Date();
    const duration = Math.round((endTime - this.session.startTime) / 1000);

    // 종료 로그 작성 (상세 결과 타입 포함)
    const resultEmoji = result === 'success' ? '✅' : '❌';
    const resultTypeLabel = this._getResultTypeLabel(result, details.resultType);
    this.writeLog(`작업 완료: ${resultTypeLabel}`, true);

    // log.txt 마무리
    this._writeLogFooter(result, duration, details);

    // v1.1: terminal.txt 저장 (터미널 상세 로그)
    this._writeTerminalLog();

    // meta.json 저장
    this._writeMetaJson(result, endTime, duration, details);

    if (this.debugMode) {
      this.logger.log(`[SessionLogService] 세션 종료: ${resultTypeLabel}, ${duration}초`);
    }

    // 세션 초기화
    this.session = null;
  }

  /**
   * 결과 타입 레이블 반환
   * @param {string} result - 'success' | 'error'
   * @param {string} resultType - 'newly_completed' | 'already_completed'
   */
  _getResultTypeLabel(result, resultType) {
    if (result !== 'success') {
      return result; // error는 그대로
    }

    // 성공인 경우 상세 타입 구분
    if (resultType === 'already_completed') {
      return '이미완료';
    } else if (resultType === 'newly_completed') {
      return '신규성공';
    }
    return 'success'; // 기본값 (하위 호환성)
  }

  /**
   * 세션 활성 여부 확인
   */
  hasActiveSession() {
    return this.session !== null;
  }

  /**
   * 현재 세션 경로 반환
   */
  getSessionPath() {
    return this.session?.path || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 스크린샷 촬영
  // ═══════════════════════════════════════════════════════════════

  /**
   * 스크린샷 촬영
   * @param {Page} page - Puppeteer 페이지
   * @param {string} step - '01_navigation' | '03_button' | 'error_timeout'
   * @param {string} description - 스크린샷 설명 (로그용)
   * @returns {Promise<string|null>} 저장된 파일 경로
   */
  async capture(page, step, description = '') {
    if (!this.session) {
      if (this.debugMode) {
        this.logger.warn('[SessionLogService] 활성 세션이 없어 스크린샷을 건너뜁니다.');
      }
      return null;
    }

    try {
      const filename = `${step}.png`;
      const filepath = path.join(this.session.path, filename);

      await page.screenshot({ path: filepath, fullPage: true });

      // 스크린샷 기록
      const time = this.getLogTimeStr();
      this.session.screenshots.push({
        file: filename,
        step: step.replace(/^\d+_/, '').replace(/^error_/, ''),
        time
      });

      // 로그 기록
      const desc = description || step;
      this.writeLog(`${filename} - ${desc}`, false, '📸');

      if (this.debugMode) {
        this.logger.log(`[SessionLogService] 스크린샷 저장: ${filename}`);
      }

      return filepath;
    } catch (error) {
      this.logger.error(`[SessionLogService] 스크린샷 오류: ${error.message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 로그 기록
  // ═══════════════════════════════════════════════════════════════

  /**
   * log.txt에 메시지 추가
   * @param {string} message - 로그 메시지
   * @param {boolean} isHeader - 헤더/푸터 여부
   * @param {string} emoji - 이모지 (기본: 없음)
   */
  writeLog(message, isHeader = false, emoji = '') {
    if (!this.session) return;

    const time = this.getLogTimeStr();
    const logPath = path.join(this.session.path, 'log.txt');

    // 첫 로그면 헤더 작성
    if (!fs.existsSync(logPath)) {
      this._writeLogHeader();
    }

    // 로그 라인 포맷
    const prefix = emoji ? `${emoji} ` : '';
    const line = `[${time}] ${prefix}${message}\n`;

    fs.appendFileSync(logPath, line, 'utf8');

    // 세션 로그 배열에도 추가
    this.session.logs.push({ time, message });
  }

  /**
   * 터미널 로그 기록 (상세 로그 - terminal.txt용)
   * UseCase의 log() 메서드에서 호출하여 터미널에 출력되는 모든 로그를 기록
   *
   * @param {string} message - 로그 메시지 (chalk 색상 코드 포함 가능)
   * @param {string} type - 로그 타입 (info, success, warning, error, debug)
   * @param {Object} options - 추가 옵션
   * @param {boolean} options.raw - true면 chalk 색상 코드 제거
   */
  logTerminal(message, type = 'info', options = {}) {
    if (!this.session) return;

    const time = this.getLogTimeStr();

    // chalk 색상 코드 제거 (ANSI escape codes)
    let cleanMessage = message;
    if (options.raw !== false) {
      // ANSI escape codes 제거: \x1b[...m 패턴
      cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
    }

    // 타입별 prefix
    const typePrefix = {
      info: '[INFO]',
      success: '[SUCCESS]',
      warning: '[WARN]',
      error: '[ERROR]',
      debug: '[DEBUG]'
    };

    const prefix = typePrefix[type] || '[INFO]';
    const logLine = `[${time}] ${prefix.padEnd(9)} ${cleanMessage}`;

    // 버퍼에 추가
    this.session.terminalLogs.push({
      time,
      type,
      message: cleanMessage,
      formatted: logLine
    });
  }

  /**
   * terminal.txt 저장
   */
  _writeTerminalLog() {
    if (!this.session || this.session.terminalLogs.length === 0) return;

    const terminalPath = path.join(this.session.path, 'terminal.txt');
    const startTimeStr = this.session.startTime.toLocaleString('ko-KR');
    const actionLabel = this.session.action === 'pause' ? '일시중지' : '결제재개';

    // 헤더
    let content = `════════════════════════════════════════════════════════════════════════════════
📺 터미널 로그 | ${actionLabel} | ${this.session.email}
   시작: ${startTimeStr}
════════════════════════════════════════════════════════════════════════════════

`;

    // 모든 터미널 로그 출력
    for (const log of this.session.terminalLogs) {
      content += log.formatted + '\n';
    }

    // 푸터
    const endTimeStr = new Date().toLocaleString('ko-KR');
    const duration = Math.round((new Date() - this.session.startTime) / 1000);

    content += `
════════════════════════════════════════════════════════════════════════════════
   종료: ${endTimeStr}
   소요: ${duration}초
   로그 수: ${this.session.terminalLogs.length}개
════════════════════════════════════════════════════════════════════════════════
`;

    fs.writeFileSync(terminalPath, content, 'utf8');

    if (this.debugMode) {
      this.logger.log(`[SessionLogService] 터미널 로그 저장: ${this.session.terminalLogs.length}줄`);
    }
  }

  /**
   * log.txt 헤더 작성
   */
  _writeLogHeader() {
    if (!this.session) return;

    const logPath = path.join(this.session.path, 'log.txt');
    const startTimeStr = this.session.startTime.toLocaleString('ko-KR');
    const actionLabel = this.session.action === 'pause' ? '일시중지' : '결제재개';

    const header = `════════════════════════════════════════════════════════
📋 작업 세션: ${actionLabel} | ${this.session.email}
   시작: ${startTimeStr}
════════════════════════════════════════════════════════

`;

    fs.writeFileSync(logPath, header, 'utf8');
  }

  /**
   * log.txt 푸터 작성
   */
  _writeLogFooter(result, duration, details) {
    if (!this.session) return;

    const logPath = path.join(this.session.path, 'log.txt');
    const endTimeStr = new Date().toLocaleString('ko-KR');
    const resultEmoji = result === 'success' ? '✅' : '❌';

    // 상세 결과 레이블 결정
    let resultLabel;
    if (result === 'success') {
      if (details.resultType === 'already_completed') {
        resultLabel = '이미완료 (기존 상태 확인)';
      } else if (details.resultType === 'newly_completed') {
        resultLabel = '신규성공 (상태 변경됨)';
      } else {
        resultLabel = '작업 완료';
      }
    } else {
      resultLabel = '작업 실패';
    }

    let footer = `
════════════════════════════════════════════════════════
${resultEmoji} ${resultLabel}
   종료: ${endTimeStr}
   소요: ${duration}초
`;

    // 추가 정보
    if (details.nextBillingDate) {
      footer += `   다음 결제일: ${details.nextBillingDate}\n`;
    }
    if (details.error) {
      footer += `   원인: ${details.error}\n`;
    }

    footer += `════════════════════════════════════════════════════════\n`;

    fs.appendFileSync(logPath, footer, 'utf8');
  }

  /**
   * meta.json 저장
   */
  _writeMetaJson(result, endTime, duration, details) {
    if (!this.session) return;

    const metaPath = path.join(this.session.path, 'meta.json');

    const meta = {
      session: {
        id: this.session.id,
        email: this.session.email,
        action: this.session.action,
        startTime: this.session.startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration
      },
      result: {
        status: result,
        // v2.15: 상세 결과 타입 추가 (신규성공 vs 이미완료)
        resultType: details.resultType || null,
        isNewlyCompleted: details.resultType === 'newly_completed',
        isAlreadyCompleted: details.resultType === 'already_completed',
        nextBillingDate: details.nextBillingDate || null,
        error: result === 'error' ? {
          type: details.errorType || 'unknown',
          message: details.error || null,
          step: details.errorStep || null
        } : null
      },
      environment: {
        language: details.language || null,
        profileId: this.session.profileId
      },
      // ★ v2.36: 상태 판단 진단 정보 (사후 분석용)
      diagnostics: details.diagnostics || null,
      screenshots: this.session.screenshots,
      logs: this.session.logs
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  }

  // ═══════════════════════════════════════════════════════════════
  // 정리 기능
  // ═══════════════════════════════════════════════════════════════

  /**
   * N일 이전 폴더 자동 삭제
   * @param {number} days - 보관 일수 (기본 3일)
   * @returns {Object} 삭제 통계
   */
  async cleanup(days = 3) {
    const stats = {
      sessions: 0,
      screenshots: 0,
      logs: 0,
      bytes: 0,
      deletedDates: []
    };

    if (!fs.existsSync(this.baseDir)) {
      return stats;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);

    const dateFolders = fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name));

    for (const dateFolder of dateFolders) {
      const folderDate = new Date(dateFolder + 'T00:00:00');

      if (folderDate < cutoffDate) {
        const datePath = path.join(this.baseDir, dateFolder);
        const folderStats = this._getFolderStats(datePath);

        stats.sessions += folderStats.sessions;
        stats.screenshots += folderStats.screenshots;
        stats.logs += folderStats.logs;
        stats.bytes += folderStats.bytes;
        stats.deletedDates.push(dateFolder);

        // 폴더 삭제 (재귀)
        this._deleteFolderRecursive(datePath);
      }
    }

    if (this.debugMode && stats.sessions > 0) {
      this.logger.log(`[SessionLogService] 정리 완료: ${stats.sessions}개 세션, ${this._formatBytes(stats.bytes)}`);
    }

    return stats;
  }

  /**
   * 전체 스크린샷 폴더 비우기
   * @returns {Object} 삭제 통계
   */
  async clearAll() {
    const stats = this._getFolderStats(this.baseDir);

    if (fs.existsSync(this.baseDir)) {
      this._deleteFolderRecursive(this.baseDir);
      fs.mkdirSync(this.baseDir, { recursive: true });
    }

    if (this.debugMode) {
      this.logger.log(`[SessionLogService] 전체 삭제: ${stats.sessions}개 세션`);
    }

    return stats;
  }

  /**
   * 세션 통계 조회
   * @returns {Object} 통계 정보
   */
  async getStats() {
    const stats = {
      dates: [],
      totals: {
        sessions: 0,
        success: 0,
        error: 0,
        screenshots: 0,
        logs: 0,
        bytes: 0
      }
    };

    if (!fs.existsSync(this.baseDir)) {
      return stats;
    }

    const dateFolders = fs.readdirSync(this.baseDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort()
      .reverse();

    for (const dateFolder of dateFolders) {
      const datePath = path.join(this.baseDir, dateFolder);
      const dateStats = this._getDateStats(datePath);

      stats.dates.push({
        date: dateFolder,
        ...dateStats
      });

      stats.totals.sessions += dateStats.sessions;
      stats.totals.success += dateStats.success;
      stats.totals.error += dateStats.error;
      stats.totals.screenshots += dateStats.screenshots;
      stats.totals.logs += dateStats.logs;
      stats.totals.bytes += dateStats.bytes;
    }

    return stats;
  }

  /**
   * 폴더 통계 조회
   */
  _getFolderStats(folderPath) {
    const stats = { sessions: 0, screenshots: 0, logs: 0, bytes: 0 };

    if (!fs.existsSync(folderPath)) {
      return stats;
    }

    const walkDir = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          // 세션 폴더 확인 (시간_작업 형식)
          if (/^\d{2}-\d{2}-\d{2}_(pause|resume)$/.test(item.name)) {
            stats.sessions++;
          }
          walkDir(itemPath);
        } else {
          const fileStats = fs.statSync(itemPath);
          stats.bytes += fileStats.size;

          if (item.name.endsWith('.png')) {
            stats.screenshots++;
          } else if (item.name === 'log.txt' || item.name === 'meta.json') {
            stats.logs++;
          }
        }
      }
    };

    walkDir(folderPath);
    return stats;
  }

  /**
   * 날짜별 통계 조회 (성공/실패 구분)
   */
  _getDateStats(datePath) {
    const stats = { sessions: 0, success: 0, error: 0, screenshots: 0, logs: 0, bytes: 0 };

    const walkEmailDir = (emailPath) => {
      const sessionFolders = fs.readdirSync(emailPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{2}-\d{2}-\d{2}_(pause|resume)$/.test(d.name));

      for (const sessionFolder of sessionFolders) {
        stats.sessions++;
        const sessionPath = path.join(emailPath, sessionFolder.name);
        const metaPath = path.join(sessionPath, 'meta.json');

        // 결과 확인
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.result?.status === 'success') {
              stats.success++;
            } else {
              stats.error++;
            }
          } catch {
            stats.error++;
          }
        }

        // 파일 통계
        const files = fs.readdirSync(sessionPath);
        for (const file of files) {
          const filePath = path.join(sessionPath, file);
          const fileStats = fs.statSync(filePath);
          stats.bytes += fileStats.size;

          if (file.endsWith('.png')) {
            stats.screenshots++;
          } else if (file === 'log.txt' || file === 'meta.json') {
            stats.logs++;
          }
        }
      }
    };

    const emailFolders = fs.readdirSync(datePath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const emailFolder of emailFolders) {
      walkEmailDir(path.join(datePath, emailFolder.name));
    }

    return stats;
  }

  /**
   * 폴더 재귀 삭제
   */
  _deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach(file => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          this._deleteFolderRecursive(curPath);
        } else {
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(folderPath);
    }
  }

  /**
   * 바이트 포맷팅
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

module.exports = SessionLogService;
