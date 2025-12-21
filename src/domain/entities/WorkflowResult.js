/**
 * @class WorkflowResult
 * @description 워크플로우 실행 결과 도메인 엔티티
 */
class WorkflowResult {
  /**
   * @param {Object} data 워크플로우 결과 데이터
   */
  constructor(data) {
    this.id = data.id || this.generateId();
    this.workflowType = data.workflowType;
    this.profileId = data.profileId;
    this.startTime = data.startTime || new Date();
    this.endTime = data.endTime || null;
    this.status = data.status || 'pending';
    this.steps = data.steps || [];
    this.error = data.error || null;
    this.metadata = data.metadata || {};
    this.retryCount = data.retryCount || 0;
    this.maxRetries = data.maxRetries || 3;
    
    this.validate();
  }

  /**
   * ID 생성
   */
  generateId() {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 데이터 유효성 검증
   */
  validate() {
    if (!this.workflowType) {
      throw new Error('Workflow type is required');
    }
    if (!this.profileId) {
      throw new Error('Profile ID is required');
    }
    if (!this.isValidStatus()) {
      throw new Error(`Invalid workflow status: ${this.status}`);
    }
  }

  /**
   * 상태 유효성 확인
   */
  isValidStatus() {
    const validStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled', 'retrying'];
    return validStatuses.includes(this.status);
  }

  /**
   * 워크플로우 시작
   */
  start() {
    this.status = 'running';
    this.startTime = new Date();
    this.addStep('workflow_started', 'Workflow execution started');
  }

  /**
   * 워크플로우 완료
   */
  complete() {
    this.status = 'completed';
    this.endTime = new Date();
    this.addStep('workflow_completed', 'Workflow execution completed successfully');
  }

  /**
   * 워크플로우 실패
   */
  fail(error) {
    this.status = 'failed';
    this.endTime = new Date();
    this.error = error;
    this.addStep('workflow_failed', `Workflow failed: ${error.message || error}`);
  }

  /**
   * 워크플로우 취소
   */
  cancel() {
    this.status = 'cancelled';
    this.endTime = new Date();
    this.addStep('workflow_cancelled', 'Workflow cancelled by user');
  }

  /**
   * 워크플로우 재시도
   */
  retry() {
    if (this.retryCount >= this.maxRetries) {
      throw new Error('Maximum retry attempts exceeded');
    }
    
    this.retryCount++;
    this.status = 'retrying';
    this.error = null;
    this.addStep('workflow_retrying', `Retrying workflow (attempt ${this.retryCount}/${this.maxRetries})`);
  }

  /**
   * 단계 추가
   */
  addStep(type, description, data = {}) {
    const step = {
      id: `step_${this.steps.length + 1}`,
      type,
      description,
      timestamp: new Date(),
      duration: null,
      status: 'pending',
      data
    };
    
    // 이전 단계의 duration 계산
    if (this.steps.length > 0) {
      const previousStep = this.steps[this.steps.length - 1];
      previousStep.duration = step.timestamp - previousStep.timestamp;
    }
    
    this.steps.push(step);
    return step;
  }

  /**
   * 현재 단계 업데이트
   */
  updateCurrentStep(status, data = {}) {
    if (this.steps.length === 0) {
      throw new Error('No steps to update');
    }
    
    const currentStep = this.steps[this.steps.length - 1];
    currentStep.status = status;
    currentStep.data = { ...currentStep.data, ...data };
  }

  /**
   * 실행 시간 계산
   */
  getExecutionTime() {
    if (!this.endTime) {
      return Date.now() - this.startTime;
    }
    return this.endTime - this.startTime;
  }

  /**
   * 성공 여부 확인
   */
  isSuccessful() {
    return this.status === 'completed';
  }

  /**
   * 실패 여부 확인
   */
  isFailed() {
    return this.status === 'failed';
  }

  /**
   * 진행 중 여부 확인
   */
  isRunning() {
    return this.status === 'running' || this.status === 'retrying';
  }

  /**
   * 재시도 가능 여부 확인
   */
  canRetry() {
    return this.status === 'failed' && this.retryCount < this.maxRetries;
  }

  /**
   * 메타데이터 업데이트
   */
  updateMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * 요약 정보 반환
   */
  getSummary() {
    return {
      id: this.id,
      type: this.workflowType,
      profileId: this.profileId,
      status: this.status,
      executionTime: this.getExecutionTime(),
      stepCount: this.steps.length,
      retryCount: this.retryCount,
      error: this.error ? this.error.message || this.error : null
    };
  }

  /**
   * JSON 변환
   */
  toJSON() {
    return {
      id: this.id,
      workflowType: this.workflowType,
      profileId: this.profileId,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      steps: this.steps,
      error: this.error,
      metadata: this.metadata,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries
    };
  }

  /**
   * 팩토리 메서드: JSON에서 생성
   */
  static fromJSON(json) {
    return new WorkflowResult(json);
  }
}

module.exports = WorkflowResult;