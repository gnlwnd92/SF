/**
 * WorkflowResult - 표준화된 워크플로우 결과 객체
 * 
 * 모든 워크플로우의 실행 결과를 일관된 형식으로 관리
 */

class WorkflowResult {
  constructor(config = {}) {
    this.profileId = config.profileId;
    this.workflowType = config.workflowType;
    this.success = false;
    this.status = 'pending';
    this.error = null;
    this.data = {};
    this.metadata = {};
    this.startTime = Date.now();
    this.endTime = null;
    this.duration = 0;
    
    // 워크플로우별 특정 데이터
    this.pauseDate = null;
    this.resumeDate = null;
    this.nextBillingDate = null;
    this.membershipStatus = null;
  }

  /**
   * 성공 설정
   */
  setSuccess(success) {
    this.success = success;
    if (success) {
      this.status = 'completed';
    }
  }

  /**
   * 상태 설정
   */
  setStatus(status) {
    this.status = status;
  }

  /**
   * 에러 설정
   */
  setError(error) {
    this.success = false;
    this.status = 'error';
    
    if (error instanceof Error) {
      this.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    } else {
      this.error = error;
    }
  }

  /**
   * 데이터 설정
   */
  setData(key, value) {
    this.data[key] = value;
  }

  /**
   * 메타데이터 설정
   */
  setMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * 실행 시간 설정
   */
  setDuration(duration) {
    this.endTime = Date.now();
    this.duration = duration || (this.endTime - this.startTime);
  }

  /**
   * 워크플로우 결과 병합
   */
  mergeWorkflowResult(workflowResult) {
    if (workflowResult.success !== undefined) {
      this.success = workflowResult.success;
    }
    
    if (workflowResult.status) {
      this.status = workflowResult.status;
    }
    
    if (workflowResult.pauseDate) {
      this.pauseDate = workflowResult.pauseDate;
    }
    
    if (workflowResult.resumeDate) {
      this.resumeDate = workflowResult.resumeDate;
    }
    
    if (workflowResult.nextBillingDate) {
      this.nextBillingDate = workflowResult.nextBillingDate;
    }
    
    if (workflowResult.error) {
      this.error = workflowResult.error;
    }
    
    // 데이터 병합
    if (workflowResult.data) {
      this.data = { ...this.data, ...workflowResult.data };
    }
  }

  /**
   * Google Sheets 데이터 형식으로 변환
   */
  toSheetData() {
    const baseData = {
      profileId: this.profileId,
      status: this.status,
      success: this.success,
      error: this.error?.message || this.error,
      executionTime: `${Math.round(this.duration / 1000)}s`,
      timestamp: new Date().toISOString()
    };

    // 워크플로우 타입별 추가 데이터
    if (this.workflowType === 'pause') {
      return {
        ...baseData,
        status: this.success ? '일시중지' : '오류',
        result: this.success ? '성공' : (this.error || '실패'),
        pauseDate: this.pauseDate,
        resumeDate: this.resumeDate,
        nextBillingDate: this.nextBillingDate || this.resumeDate
      };
    } else if (this.workflowType === 'resume') {
      return {
        ...baseData,
        status: this.success ? '활성' : '오류',
        result: this.success ? '재개 성공' : (this.error || '실패'),
        resumeDate: this.resumeDate,
        nextBillingDate: this.nextBillingDate
      };
    }

    return baseData;
  }

  /**
   * JSON 형식으로 변환
   */
  toJSON() {
    return {
      profileId: this.profileId,
      workflowType: this.workflowType,
      success: this.success,
      status: this.status,
      error: this.error,
      data: this.data,
      metadata: this.metadata,
      pauseDate: this.pauseDate,
      resumeDate: this.resumeDate,
      nextBillingDate: this.nextBillingDate,
      membershipStatus: this.membershipStatus,
      duration: this.duration,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }

  /**
   * 요약 문자열 생성
   */
  toString() {
    const status = this.success ? '✅ 성공' : '❌ 실패';
    const duration = `${Math.round(this.duration / 1000)}초`;
    
    let summary = `[${this.workflowType}] ${status} - ${duration}`;
    
    if (this.error) {
      summary += ` - 오류: ${this.error.message || this.error}`;
    }
    
    if (this.pauseDate) {
      summary += ` - 일시중지: ${this.pauseDate}`;
    }
    
    if (this.resumeDate) {
      summary += ` - 재개: ${this.resumeDate}`;
    }
    
    return summary;
  }

  /**
   * 성공 여부 확인
   */
  isSuccess() {
    return this.success === true;
  }

  /**
   * 실패 여부 확인
   */
  isFailure() {
    return this.success === false;
  }

  /**
   * reCAPTCHA 필요 여부
   */
  requiresRecaptcha() {
    return this.status === 'recaptcha_required' || 
           this.error?.includes('RECAPTCHA');
  }
}

module.exports = WorkflowResult;