/**
 * WorkflowContext - 워크플로우 실행 컨텍스트
 * 
 * 워크플로우 실행 중 필요한 모든 상태와 데이터를 관리
 * 서비스 간 데이터 공유를 위한 중앙 저장소
 */

class WorkflowContext {
  constructor() {
    this.reset();
  }

  /**
   * 컨텍스트 초기화
   */
  initialize(config = {}) {
    this.profileId = config.profileId;
    this.profileData = config.profileData || {};
    this.debugMode = config.debugMode || false;
    this.workflowType = config.workflowType || 'unknown';
    this.language = 'en';
    this.state = {};
    this.metadata = {};
    this.startTime = Date.now();
  }

  /**
   * 브라우저 설정
   */
  setBrowser(browser) {
    this.browser = browser;
  }

  /**
   * 페이지 설정
   */
  setPage(page) {
    this.page = page;
  }

  /**
   * 언어 설정
   */
  setLanguage(language) {
    this.language = language;
  }

  /**
   * 상태 설정
   */
  setState(state) {
    this.state = { ...this.state, ...state };
  }

  /**
   * 상태 가져오기
   */
  getState(key = null) {
    if (key) {
      return this.state[key];
    }
    return this.state;
  }

  /**
   * 메타데이터 설정
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * 메타데이터 가져오기
   */
  getMetadata(key = null) {
    if (key) {
      return this.metadata[key];
    }
    return this.metadata;
  }

  /**
   * 자격증명 가져오기
   */
  getCredentials() {
    return {
      email: this.profileData?.email || this.profileData?.googleId,
      password: this.profileData?.password,
      recoveryEmail: this.profileData?.recoveryEmail,
      backupCode: this.profileData?.code
    };
  }

  /**
   * 현재 URL 가져오기
   */
  async getCurrentUrl() {
    if (this.page) {
      return this.page.url();
    }
    return null;
  }

  /**
   * 페이지 텍스트 가져오기
   */
  async getPageText() {
    if (this.page) {
      return await this.page.evaluate(() => document.body?.textContent || '');
    }
    return '';
  }

  /**
   * 실행 시간 계산
   */
  getElapsedTime() {
    return Date.now() - this.startTime;
  }

  /**
   * 컨텍스트 정리
   */
  clear() {
    this.browser = null;
    this.page = null;
    this.state = {};
    this.metadata = {};
  }

  /**
   * 컨텍스트 리셋
   */
  reset() {
    this.profileId = null;
    this.profileData = {};
    this.debugMode = false;
    this.workflowType = null;
    this.browser = null;
    this.page = null;
    this.language = 'en';
    this.state = {};
    this.metadata = {};
    this.startTime = null;
  }

  /**
   * 컨텍스트 스냅샷
   */
  snapshot() {
    return {
      profileId: this.profileId,
      workflowType: this.workflowType,
      language: this.language,
      state: { ...this.state },
      metadata: { ...this.metadata },
      elapsedTime: this.getElapsedTime()
    };
  }

  /**
   * 컨텍스트 복원
   */
  restore(snapshot) {
    this.profileId = snapshot.profileId;
    this.workflowType = snapshot.workflowType;
    this.language = snapshot.language;
    this.state = { ...snapshot.state };
    this.metadata = { ...snapshot.metadata };
  }
}

module.exports = WorkflowContext;