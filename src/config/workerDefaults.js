/**
 * 통합워커 기본값 설정
 *
 * 단일 소스 (Single Source of Truth)
 * - ScheduledSubscriptionWorkerUseCase
 * - EnterpriseCLI
 * 에서 공통으로 사용
 */

module.exports = {
  // 시간 설정
  resumeMinutesBefore: 30,    // 결제재개: 결제 전 M분
  pauseMinutesAfter: 10,      // 일시중지: 결제 후 N분
  checkIntervalSeconds: 60,   // 체크 간격 (초)

  // 재시도 설정
  maxRetryCount: 10,          // 최대 재시도 횟수

  // [v2.14] 결제 미완료 재시도 설정 (시간 기반)
  paymentPendingMaxHours: 24,        // 최대 대기 시간 (시간)
  paymentPendingRetryMinutes: 30,    // 재시도 간격 (분)

  // 실행 모드
  continuous: true,           // 지속 실행 모드
  debugMode: true,            // 디버그 모드

  // 휴먼라이크 인터랙션
  humanLikeMotion: true       // 베지어 곡선 + CDP 네이티브 클릭
};
