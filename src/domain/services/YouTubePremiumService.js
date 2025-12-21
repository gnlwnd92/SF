const Subscription = require('../entities/Subscription');
const WorkflowResult = require('../entities/WorkflowResult');

/**
 * @class YouTubePremiumService
 * @description YouTube Premium 관련 비즈니스 로직을 처리하는 도메인 서비스
 */
class YouTubePremiumService {
  /**
   * @param {Object} repositories 레포지토리 인스턴스들
   */
  constructor(repositories) {
    this.subscriptionRepository = repositories.subscriptionRepository;
    this.workflowRepository = repositories.workflowRepository;
  }

  /**
   * 구독 일시중지 워크플로우
   * @param {string} profileId 프로필 ID
   * @returns {Promise<WorkflowResult>}
   */
  async pauseSubscription(profileId) {
    const workflow = new WorkflowResult({
      workflowType: 'pause_subscription',
      profileId
    });

    try {
      workflow.start();

      // 1. 구독 정보 조회
      workflow.addStep('fetch_subscription', 'Fetching subscription information');
      const subscription = await this.subscriptionRepository.findByProfileId(profileId);
      
      if (!subscription) {
        throw new Error(`No subscription found for profile ${profileId}`);
      }

      if (!subscription.isActive()) {
        throw new Error(`Subscription is not active (current status: ${subscription.status})`);
      }

      workflow.updateCurrentStep('completed', { subscriptionId: subscription.id });

      // 2. 구독 일시중지 실행
      workflow.addStep('pause_subscription', 'Pausing subscription');
      subscription.pause();
      
      // 3. 변경사항 저장
      workflow.addStep('save_changes', 'Saving subscription changes');
      await this.subscriptionRepository.save(subscription);
      workflow.updateCurrentStep('completed');

      // 4. 워크플로우 완료
      workflow.complete();
      workflow.updateMetadata('subscriptionId', subscription.id);
      workflow.updateMetadata('pausedAt', subscription.pausedAt);

      // 워크플로우 결과 저장
      await this.workflowRepository.save(workflow);

      return workflow;

    } catch (error) {
      workflow.fail(error);
      await this.workflowRepository.save(workflow);
      throw error;
    }
  }

  /**
   * 구독 재개 워크플로우
   * @param {string} profileId 프로필 ID
   * @returns {Promise<WorkflowResult>}
   */
  async resumeSubscription(profileId) {
    const workflow = new WorkflowResult({
      workflowType: 'resume_subscription',
      profileId
    });

    try {
      workflow.start();

      // 1. 구독 정보 조회
      workflow.addStep('fetch_subscription', 'Fetching subscription information');
      const subscription = await this.subscriptionRepository.findByProfileId(profileId);
      
      if (!subscription) {
        throw new Error(`No subscription found for profile ${profileId}`);
      }

      if (!subscription.isPaused()) {
        throw new Error(`Subscription is not paused (current status: ${subscription.status})`);
      }

      workflow.updateCurrentStep('completed', { subscriptionId: subscription.id });

      // 2. 구독 재개 실행
      workflow.addStep('resume_subscription', 'Resuming subscription');
      subscription.resume();
      
      // 3. 변경사항 저장
      workflow.addStep('save_changes', 'Saving subscription changes');
      await this.subscriptionRepository.save(subscription);
      workflow.updateCurrentStep('completed');

      // 4. 워크플로우 완료
      workflow.complete();
      workflow.updateMetadata('subscriptionId', subscription.id);
      workflow.updateMetadata('resumedAt', subscription.resumedAt);

      // 워크플로우 결과 저장
      await this.workflowRepository.save(workflow);

      return workflow;

    } catch (error) {
      workflow.fail(error);
      await this.workflowRepository.save(workflow);
      throw error;
    }
  }

  /**
   * 배치 일시중지 워크플로우
   * @param {Array<string>} profileIds 프로필 ID 배열
   * @returns {Promise<Array<WorkflowResult>>}
   */
  async pauseSubscriptionBatch(profileIds) {
    const results = [];
    
    for (const profileId of profileIds) {
      try {
        const result = await this.pauseSubscription(profileId);
        results.push(result);
      } catch (error) {
        // 개별 실패는 기록하고 계속 진행
        const failedWorkflow = new WorkflowResult({
          workflowType: 'pause_subscription',
          profileId
        });
        failedWorkflow.fail(error);
        results.push(failedWorkflow);
      }
    }

    return results;
  }

  /**
   * 배치 재개 워크플로우
   * @param {Array<string>} profileIds 프로필 ID 배열
   * @returns {Promise<Array<WorkflowResult>>}
   */
  async resumeSubscriptionBatch(profileIds) {
    const results = [];
    
    for (const profileId of profileIds) {
      try {
        const result = await this.resumeSubscription(profileId);
        results.push(result);
      } catch (error) {
        // 개별 실패는 기록하고 계속 진행
        const failedWorkflow = new WorkflowResult({
          workflowType: 'resume_subscription',
          profileId
        });
        failedWorkflow.fail(error);
        results.push(failedWorkflow);
      }
    }

    return results;
  }

  /**
   * 구독 상태 확인
   * @param {string} profileId 프로핀 ID
   * @returns {Promise<Object>}
   */
  async checkSubscriptionStatus(profileId) {
    const subscription = await this.subscriptionRepository.findByProfileId(profileId);
    
    if (!subscription) {
      return {
        exists: false,
        profileId
      };
    }

    return {
      exists: true,
      profileId,
      subscriptionId: subscription.id,
      status: subscription.status,
      type: subscription.type,
      billingCycle: subscription.billingCycle,
      nextBillingDate: subscription.nextBillingDate,
      pausedAt: subscription.pausedAt,
      resumedAt: subscription.resumedAt,
      isActive: subscription.isActive(),
      isPaused: subscription.isPaused()
    };
  }

  /**
   * 구독 히스토리 조회
   * @param {string} profileId 프로필 ID
   * @returns {Promise<Array>}
   */
  async getSubscriptionHistory(profileId) {
    const subscription = await this.subscriptionRepository.findByProfileId(profileId);
    
    if (!subscription) {
      return [];
    }

    return subscription.history;
  }
}

module.exports = YouTubePremiumService;