/**
 * @class Subscription
 * @description YouTube Premium 구독 도메인 엔티티
 */
class Subscription {
  /**
   * @param {Object} data 구독 데이터
   */
  constructor(data) {
    this.id = data.id;
    this.profileId = data.profileId;
    this.type = data.type || 'youtube_premium';
    this.status = data.status || 'active';
    this.billingCycle = data.billingCycle || 'monthly';
    this.price = data.price || 0;
    this.currency = data.currency || 'USD';
    this.startDate = data.startDate || new Date();
    this.nextBillingDate = data.nextBillingDate;
    this.pausedAt = data.pausedAt || null;
    this.resumedAt = data.resumedAt || null;
    this.history = data.history || [];
    
    this.validate();
  }

  /**
   * 구독 데이터 유효성 검증
   */
  validate() {
    if (!this.id) {
      throw new Error('Subscription ID is required');
    }
    if (!this.profileId) {
      throw new Error('Profile ID is required');
    }
    if (!this.isValidStatus()) {
      throw new Error(`Invalid subscription status: ${this.status}`);
    }
    if (!this.isValidBillingCycle()) {
      throw new Error(`Invalid billing cycle: ${this.billingCycle}`);
    }
  }

  /**
   * 상태 유효성 확인
   */
  isValidStatus() {
    const validStatuses = ['active', 'paused', 'cancelled', 'expired', 'pending'];
    return validStatuses.includes(this.status);
  }

  /**
   * 결제 주기 유효성 확인
   */
  isValidBillingCycle() {
    const validCycles = ['monthly', 'yearly', 'weekly', 'daily'];
    return validCycles.includes(this.billingCycle);
  }

  /**
   * 구독 일시중지
   */
  pause() {
    if (this.status !== 'active') {
      throw new Error('Can only pause active subscriptions');
    }
    
    this.status = 'paused';
    this.pausedAt = new Date();
    this.addHistory('paused', 'Subscription paused');
  }

  /**
   * 구독 재개
   */
  resume() {
    if (this.status !== 'paused') {
      throw new Error('Can only resume paused subscriptions');
    }
    
    this.status = 'active';
    this.resumedAt = new Date();
    this.addHistory('resumed', 'Subscription resumed');
  }

  /**
   * 구독 취소
   */
  cancel() {
    if (this.status === 'cancelled') {
      throw new Error('Subscription already cancelled');
    }
    
    this.status = 'cancelled';
    this.addHistory('cancelled', 'Subscription cancelled');
  }

  /**
   * 히스토리 추가
   */
  addHistory(action, description) {
    this.history.push({
      action,
      description,
      timestamp: new Date(),
      previousStatus: this.history.length > 0 ? 
        this.history[this.history.length - 1].newStatus : null,
      newStatus: this.status
    });
  }

  /**
   * 다음 결제일 계산
   */
  calculateNextBillingDate() {
    const now = new Date();
    const next = new Date(this.nextBillingDate || now);
    
    switch (this.billingCycle) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    
    this.nextBillingDate = next;
    return next;
  }

  /**
   * 구독 활성 여부 확인
   */
  isActive() {
    return this.status === 'active';
  }

  /**
   * 구독 일시중지 여부 확인
   */
  isPaused() {
    return this.status === 'paused';
  }

  /**
   * JSON 변환
   */
  toJSON() {
    return {
      id: this.id,
      profileId: this.profileId,
      type: this.type,
      status: this.status,
      billingCycle: this.billingCycle,
      price: this.price,
      currency: this.currency,
      startDate: this.startDate,
      nextBillingDate: this.nextBillingDate,
      pausedAt: this.pausedAt,
      resumedAt: this.resumedAt,
      history: this.history
    };
  }

  /**
   * 팩토리 메서드: JSON에서 생성
   */
  static fromJSON(json) {
    return new Subscription(json);
  }
}

module.exports = Subscription;