/**
 * Logger 어댑터
 * 기존 코드와 새로운 Logger 시스템을 연결하는 브릿지
 */

const { Logger } = require('./Logger');

class LoggerAdapter {
  constructor(config = {}) {
    // 새로운 Logger 인스턴스 생성
    this.logger = new Logger({
      ...config,
      enableConsole: true,
      enableFile: true
    });
    
    // console 메서드들을 오버라이드
    this.setupConsoleMethods();
  }

  /**
   * console 스타일 메서드 제공
   */
  setupConsoleMethods() {
    this.log = this.info.bind(this);
    this.warn = this.warning.bind(this);
    this.error = this.error.bind(this);
  }

  /**
   * 레벨별 로깅 메서드
   */
  async debug(message, data) {
    await this.logger.debug(message, data);
  }

  async info(message, data) {
    await this.logger.info(message, data);
  }

  async warning(message, data) {
    await this.logger.warning(message, data);
  }

  async error(message, data) {
    await this.logger.error(message, data);
  }

  /**
   * 워크플로우 관련 메서드
   */
  async logWorkflowStart(workflowName, params) {
    await this.logger.logWorkflowStart(workflowName, params);
  }

  async logWorkflowEnd(workflowName, result) {
    await this.logger.logWorkflowEnd(workflowName, result);
  }

  async logStep(stepName, details) {
    await this.logger.logStep(stepName, details);
  }

  async logPerformance(operation, duration, details) {
    await this.logger.logPerformance(operation, duration, details);
  }

  /**
   * 컨텍스트 관리
   */
  pushContext(context) {
    this.logger.pushContext(context);
    return this;
  }

  popContext() {
    this.logger.popContext();
    return this;
  }

  /**
   * 통계 조회
   */
  async getLogStats() {
    return await this.logger.getLogStats();
  }
}

/**
 * 싱글톤 팩토리
 */
let instance = null;

function createLoggerAdapter(config = {}) {
  if (!instance) {
    instance = new LoggerAdapter(config);
  }
  return instance;
}

module.exports = {
  LoggerAdapter,
  createLoggerAdapter
};