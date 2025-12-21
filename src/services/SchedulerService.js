const chalk = require('chalk');
const ora = require('ora');

/**
 * @class SchedulerService
 * @description 작업 스케줄링을 담당하는 서비스
 */
class SchedulerService {
  constructor({ logger }) {
    this.logger = logger;
    this.scheduledTasks = new Map();
    this.isRunning = false;
  }

  /**
   * 스케줄 작업 등록
   * @param {string} taskId - 작업 ID
   * @param {Date} scheduledTime - 예약 시간
   * @param {Function} taskFunction - 실행할 함수
   * @param {Object} taskOptions - 작업 옵션
   */
  scheduleTask(taskId, scheduledTime, taskFunction, taskOptions = {}) {
    if (this.scheduledTasks.has(taskId)) {
      this.logger.warn(`작업 ${taskId}가 이미 예약되어 있습니다. 덮어씁니다.`);
      this.cancelTask(taskId);
    }

    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      this.logger.warn(`예약 시간이 과거입니다. 즉시 실행합니다.`);
      this.executeTask(taskId, taskFunction, taskOptions);
      return;
    }

    const timeoutId = setTimeout(() => {
      this.executeTask(taskId, taskFunction, taskOptions);
    }, delay);

    this.scheduledTasks.set(taskId, {
      timeoutId,
      scheduledTime,
      taskFunction,
      taskOptions,
      status: 'scheduled'
    });

    this.logger.info(`작업 ${taskId} 예약 완료`, {
      scheduledTime: scheduledTime.toLocaleString('ko-KR'),
      delay: this.formatDelay(delay)
    });

    return taskId;
  }

  /**
   * 작업 실행
   */
  async executeTask(taskId, taskFunction, taskOptions) {
    const task = this.scheduledTasks.get(taskId);
    if (task) {
      task.status = 'running';
    }

    this.logger.info(`작업 ${taskId} 실행 시작`);

    try {
      await taskFunction(taskOptions);
      
      if (task) {
        task.status = 'completed';
      }
      
      this.logger.info(`작업 ${taskId} 완료`);
      this.scheduledTasks.delete(taskId);
    } catch (error) {
      if (task) {
        task.status = 'failed';
        task.error = error.message;
      }
      
      this.logger.error(`작업 ${taskId} 실행 실패`, error);
      throw error;
    }
  }

  /**
   * 작업 취소
   */
  cancelTask(taskId) {
    const task = this.scheduledTasks.get(taskId);
    if (!task) {
      this.logger.warn(`작업 ${taskId}를 찾을 수 없습니다.`);
      return false;
    }

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }

    this.scheduledTasks.delete(taskId);
    this.logger.info(`작업 ${taskId} 취소됨`);
    return true;
  }

  /**
   * 모든 작업 취소
   */
  cancelAllTasks() {
    for (const [taskId, task] of this.scheduledTasks) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
    }
    
    const count = this.scheduledTasks.size;
    this.scheduledTasks.clear();
    this.logger.info(`${count}개의 예약 작업이 모두 취소되었습니다.`);
    return count;
  }

  /**
   * 예약된 작업 목록 조회
   */
  getScheduledTasks() {
    const tasks = [];
    for (const [taskId, task] of this.scheduledTasks) {
      tasks.push({
        id: taskId,
        scheduledTime: task.scheduledTime,
        status: task.status,
        options: task.taskOptions
      });
    }
    return tasks.sort((a, b) => a.scheduledTime - b.scheduledTime);
  }

  /**
   * 특정 작업 정보 조회
   */
  getTaskInfo(taskId) {
    const task = this.scheduledTasks.get(taskId);
    if (!task) {
      return null;
    }

    return {
      id: taskId,
      scheduledTime: task.scheduledTime,
      status: task.status,
      options: task.taskOptions,
      remainingTime: this.getRemainingTime(task.scheduledTime)
    };
  }

  /**
   * 남은 시간 계산
   */
  getRemainingTime(scheduledTime) {
    const now = new Date();
    const remaining = scheduledTime.getTime() - now.getTime();
    
    if (remaining <= 0) {
      return '실행 중 또는 완료';
    }

    return this.formatDelay(remaining);
  }

  /**
   * 지연 시간 포맷팅
   */
  formatDelay(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}일 ${hours % 24}시간 ${minutes % 60}분`;
    } else if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분 ${seconds % 60}초`;
    } else if (minutes > 0) {
      return `${minutes}분 ${seconds % 60}초`;
    } else {
      return `${seconds}초`;
    }
  }

  /**
   * 대기 중인 작업이 있는지 확인
   */
  hasPendingTasks() {
    return this.scheduledTasks.size > 0;
  }

  /**
   * 다음 예약 작업 정보
   */
  getNextTask() {
    const tasks = this.getScheduledTasks();
    return tasks.length > 0 ? tasks[0] : null;
  }

  /**
   * 예약 시간 유효성 검사
   */
  validateScheduleTime(scheduledTime) {
    const now = new Date();
    const maxFutureTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 최대 7일 후

    if (scheduledTime < now) {
      return {
        valid: false,
        message: '예약 시간은 현재 시간 이후여야 합니다.'
      };
    }

    if (scheduledTime > maxFutureTime) {
      return {
        valid: false,
        message: '예약은 최대 7일 이내만 가능합니다.'
      };
    }

    return {
      valid: true,
      message: 'OK'
    };
  }

  /**
   * 크론 표현식으로 반복 작업 등록 (선택적 기능)
   */
  scheduleRecurringTask(taskId, cronExpression, taskFunction, taskOptions = {}) {
    // 추후 node-cron 등을 사용하여 구현 가능
    this.logger.info(`반복 작업 기능은 추후 지원 예정입니다.`);
    return false;
  }

  /**
   * 작업 실행 이력 저장 (선택적 기능)
   */
  async saveTaskHistory(taskId, status, result = null, error = null) {
    const history = {
      taskId,
      status,
      executedAt: new Date(),
      result,
      error: error ? error.message : null
    };

    // 파일이나 데이터베이스에 저장
    this.logger.info('작업 이력 저장', history);
    return history;
  }

  /**
   * 시스템 시작 시 이전 스케줄 복원 (선택적 기능)
   */
  async restoreSchedules() {
    // 파일이나 데이터베이스에서 이전 스케줄 정보 로드
    this.logger.info('이전 스케줄 복원 기능은 추후 지원 예정입니다.');
    return [];
  }

  /**
   * 스케줄러 종료
   */
  shutdown() {
    this.cancelAllTasks();
    this.isRunning = false;
    this.logger.info('스케줄러 서비스 종료');
  }
}

module.exports = SchedulerService;