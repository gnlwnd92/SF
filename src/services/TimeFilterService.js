/**
 * TimeFilterService - 시간 기반 작업 필터링 서비스
 *
 * F열(날짜) + I열(시간) 조합으로 작업 예정 시각을 계산하고
 * 시간 조건에 맞는 작업만 필터링합니다.
 *
 * 모든 시간 연산은 KST (Asia/Seoul) 기준입니다.
 */
class TimeFilterService {
  constructor({ logger, debugMode = false } = {}) {
    this.logger = logger || console;
    this.debugMode = debugMode;
    this.timezone = 'Asia/Seoul';
  }

  /**
   * F열(날짜) + I열(시간) → Date 객체 변환 (KST)
   *
   * @param {string} dateStr - F열 날짜 ("2025. 12. 25" 또는 "2025-12-25")
   * @param {string} timeStr - I열 시간 ("7:12" 또는 "14:30")
   * @returns {Date|null} KST Date 객체 또는 파싱 실패 시 null
   */
  parseScheduledDateTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) {
      return null;
    }

    try {
      // 날짜 파싱: "2025. 12. 25" 또는 "2025-12-25" 형식
      let year, month, day;

      if (dateStr.includes('.')) {
        // "2025. 12. 25" 형식
        const parts = dateStr.split('.').map(p => parseInt(p.trim(), 10));
        if (parts.length >= 3) {
          [year, month, day] = parts;
        } else {
          return null;
        }
      } else if (dateStr.includes('-')) {
        // "2025-12-25" 형식
        const parts = dateStr.split('-').map(p => parseInt(p.trim(), 10));
        if (parts.length >= 3) {
          [year, month, day] = parts;
        } else {
          return null;
        }
      } else {
        return null;
      }

      // 시간 파싱: "7:12" 또는 "14:30" 형식
      const timeParts = timeStr.split(':').map(p => parseInt(p.trim(), 10));
      if (timeParts.length < 2) {
        return null;
      }
      const [hour, minute] = timeParts;

      // 유효성 검사
      if (isNaN(year) || isNaN(month) || isNaN(day) ||
          isNaN(hour) || isNaN(minute)) {
        return null;
      }

      // KST로 Date 생성 (month는 0-indexed)
      const date = new Date(year, month - 1, day, hour, minute, 0);

      if (isNaN(date.getTime())) {
        return null;
      }

      return date;
    } catch (error) {
      if (this.debugMode) {
        this.logger.warn(`[TimeFilterService] 날짜/시간 파싱 실패: ${dateStr} ${timeStr}`, error);
      }
      return null;
    }
  }

  /**
   * 현재 시간 (KST) 반환
   * @returns {Date}
   */
  getNow() {
    return new Date();
  }

  /**
   * 일시중지 대상 필터링
   * 조건: 작업예정시각 <= 현재시간 + minutesAhead
   *
   * @param {Array} tasks - 작업 목록 (scheduledTime 또는 nextPaymentDate + scheduledTimeStr 필요)
   * @param {number} minutesAhead - 몇 분 후까지 처리할지
   * @returns {Array} 필터링된 작업 목록
   */
  filterPauseTasks(tasks, minutesAhead) {
    if (!Array.isArray(tasks) || !minutesAhead) {
      return [];
    }

    const now = this.getNow();
    const threshold = new Date(now.getTime() + minutesAhead * 60 * 1000);

    if (this.debugMode) {
      this.logger.log(`[TimeFilterService] 일시중지 필터링 - 현재: ${this.formatDateTime(now)}, 기준: ${this.formatDateTime(threshold)} (${minutesAhead}분 후)`);
    }

    return tasks.filter(task => {
      const scheduledTime = this.getScheduledTime(task);
      if (!scheduledTime) {
        if (this.debugMode) {
          this.logger.warn(`[TimeFilterService] 시간 정보 없음: ${task.googleId || task.email}`);
        }
        return false;
      }

      const isTarget = scheduledTime <= threshold;

      if (this.debugMode) {
        this.logger.log(`  - ${task.googleId || task.email}: ${this.formatDateTime(scheduledTime)} ${isTarget ? '✅ 처리대상' : '❌ 제외'}`);
      }

      return isTarget;
    });
  }

  /**
   * 결제재개 대상 필터링
   * 조건: 작업예정시각 <= 현재시간 - minutesBefore
   *
   * @param {Array} tasks - 작업 목록
   * @param {number} minutesBefore - 몇 분 전까지의 작업을 처리할지
   * @returns {Array} 필터링된 작업 목록
   */
  filterResumeTasks(tasks, minutesBefore) {
    if (!Array.isArray(tasks) || !minutesBefore) {
      return [];
    }

    const now = this.getNow();
    const threshold = new Date(now.getTime() - minutesBefore * 60 * 1000);

    if (this.debugMode) {
      this.logger.log(`[TimeFilterService] 결제재개 필터링 - 현재: ${this.formatDateTime(now)}, 기준: ${this.formatDateTime(threshold)} (${minutesBefore}분 전)`);
    }

    return tasks.filter(task => {
      const scheduledTime = this.getScheduledTime(task);
      if (!scheduledTime) {
        if (this.debugMode) {
          this.logger.warn(`[TimeFilterService] 시간 정보 없음: ${task.googleId || task.email}`);
        }
        return false;
      }

      const isTarget = scheduledTime <= threshold;

      if (this.debugMode) {
        this.logger.log(`  - ${task.googleId || task.email}: ${this.formatDateTime(scheduledTime)} ${isTarget ? '✅ 처리대상' : '❌ 제외'}`);
      }

      return isTarget;
    });
  }

  /**
   * 작업 목록에 scheduledTime 필드 추가
   *
   * @param {Array} tasks - 작업 목록
   * @returns {Array} scheduledTime이 추가된 작업 목록
   */
  enrichTasksWithScheduledTime(tasks) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.map(task => {
      const scheduledTime = this.parseScheduledDateTime(
        task.nextPaymentDate || task.dateStr,
        task.scheduledTimeStr || task.timeStr
      );

      return {
        ...task,
        scheduledTime,
        scheduledTimeFormatted: scheduledTime ? this.formatDateTime(scheduledTime) : null
      };
    });
  }

  /**
   * task에서 scheduledTime 추출
   * @private
   */
  getScheduledTime(task) {
    if (task.scheduledTime instanceof Date) {
      return task.scheduledTime;
    }

    return this.parseScheduledDateTime(
      task.nextPaymentDate || task.dateStr,
      task.scheduledTimeStr || task.timeStr
    );
  }

  /**
   * 날짜/시간을 포맷팅된 문자열로 변환
   * @param {Date} date
   * @returns {string}
   */
  formatDateTime(date) {
    if (!date || !(date instanceof Date)) {
      return 'N/A';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  /**
   * 짧은 날짜/시간 포맷 (결과 기록용)
   * @param {Date} date
   * @returns {string} "12/25 14:30" 형식
   */
  formatShortDateTime(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    return `${month}/${day} ${hour}:${minute}`;
  }

  // ============================================================
  // 통합워커 v2.0 - 상태 기반 필터링 메서드
  // ============================================================

  /**
   * 결제재개 대상 필터링 (통합워커용)
   *
   * 조건:
   * - E열 상태 = "일시중지"
   * - (F열+I열) 결제시각 <= 현재시간 + minutesBefore
   * - 재시도 횟수 < maxRetry
   *
   * 정렬: 결제시각 ASC (임박한 순서 먼저)
   *
   * @param {Array} tasks - 작업 목록 (getIntegratedWorkerTasks()로 조회된)
   * @param {number} minutesBefore - 결제 전 M분 기준
   * @param {number} [maxRetry=3] - 최대 재시도 횟수
   * @returns {Array} 필터링 및 정렬된 작업 목록
   */
  filterResumeTargets(tasks, minutesBefore, maxRetry = 3) {
    if (!Array.isArray(tasks) || !minutesBefore) {
      return [];
    }

    const now = this.getNow();
    const threshold = new Date(now.getTime() + minutesBefore * 60 * 1000);

    if (this.debugMode) {
      this.logger.log(`\n[TimeFilterService] ===== 결제재개 대상 필터링 =====`);
      this.logger.log(`  현재 시간: ${this.formatDateTime(now)}`);
      this.logger.log(`  기준 시간: ${this.formatDateTime(threshold)} (현재 + ${minutesBefore}분)`);
      this.logger.log(`  대상 상태: "일시중지"`);
      this.logger.log(`  최대 재시도: ${maxRetry}회`);
    }

    // 1. enrichTasksWithScheduledTime 호출
    const enrichedTasks = this.enrichTasksWithScheduledTime(tasks);

    // 2. 필터링
    const filtered = enrichedTasks.filter(task => {
      // 상태 체크: "일시중지"만
      if (task.status !== '일시중지') {
        return false;
      }

      // 재시도 횟수 체크
      const retryCount = parseInt(task.retryCount, 10) || 0;
      if (retryCount >= maxRetry) {
        if (this.debugMode) {
          this.logger.log(`  ⏭️ ${task.email}: 재시도 초과 (${retryCount}/${maxRetry})`);
        }
        return false;
      }

      // 시간 체크
      const scheduledTime = task.scheduledTime;
      if (!scheduledTime) {
        if (this.debugMode) {
          this.logger.warn(`  ⚠️ ${task.email}: 시간 정보 없음`);
        }
        return false;
      }

      const isTarget = scheduledTime <= threshold;

      if (this.debugMode) {
        const status = isTarget ? '✅ 대상' : '❌ 제외';
        this.logger.log(`  ${status} ${task.email}: ${this.formatDateTime(scheduledTime)} (재시도: ${retryCount})`);
      }

      return isTarget;
    });

    // 3. 정렬: 결제시각 ASC (임박한 순서 먼저), 재시도 많은 것 후순위
    filtered.sort((a, b) => {
      // 먼저 scheduledTime으로 정렬
      const timeDiff = (a.scheduledTime?.getTime() || 0) - (b.scheduledTime?.getTime() || 0);
      if (timeDiff !== 0) return timeDiff;

      // 같은 시간이면 재시도 적은 것 먼저
      const retryA = parseInt(a.retryCount, 10) || 0;
      const retryB = parseInt(b.retryCount, 10) || 0;
      return retryA - retryB;
    });

    if (this.debugMode) {
      this.logger.log(`  결과: ${filtered.length}개 대상`);
      this.logger.log(`===================================\n`);
    }

    return filtered;
  }

  /**
   * 일시중지 대상 필터링 (통합워커용)
   *
   * 조건:
   * - E열 상태 = "결제중"
   * - (F열+I열) 결제시각 <= 현재시간 - minutesAfter
   * - 재시도 횟수 < maxRetry
   *
   * 정렬: 결제시각 ASC (오래된 순서 먼저)
   *
   * @param {Array} tasks - 작업 목록 (getIntegratedWorkerTasks()로 조회된)
   * @param {number} minutesAfter - 결제 후 N분 기준
   * @param {number} [maxRetry=3] - 최대 재시도 횟수
   * @returns {Array} 필터링 및 정렬된 작업 목록
   */
  filterPauseTargets(tasks, minutesAfter, maxRetry = 3) {
    if (!Array.isArray(tasks) || !minutesAfter) {
      return [];
    }

    const now = this.getNow();
    const threshold = new Date(now.getTime() - minutesAfter * 60 * 1000);

    if (this.debugMode) {
      this.logger.log(`\n[TimeFilterService] ===== 일시중지 대상 필터링 =====`);
      this.logger.log(`  현재 시간: ${this.formatDateTime(now)}`);
      this.logger.log(`  기준 시간: ${this.formatDateTime(threshold)} (현재 - ${minutesAfter}분)`);
      this.logger.log(`  대상 상태: "결제중"`);
      this.logger.log(`  최대 재시도: ${maxRetry}회`);
    }

    // 1. enrichTasksWithScheduledTime 호출
    const enrichedTasks = this.enrichTasksWithScheduledTime(tasks);

    // 2. 필터링
    const filtered = enrichedTasks.filter(task => {
      // 상태 체크: "결제중"만
      if (task.status !== '결제중') {
        return false;
      }

      // 재시도 횟수 체크
      const retryCount = parseInt(task.retryCount, 10) || 0;
      if (retryCount >= maxRetry) {
        if (this.debugMode) {
          this.logger.log(`  ⏭️ ${task.email}: 재시도 초과 (${retryCount}/${maxRetry})`);
        }
        return false;
      }

      // 시간 체크
      const scheduledTime = task.scheduledTime;
      if (!scheduledTime) {
        if (this.debugMode) {
          this.logger.warn(`  ⚠️ ${task.email}: 시간 정보 없음`);
        }
        return false;
      }

      const isTarget = scheduledTime <= threshold;

      if (this.debugMode) {
        const status = isTarget ? '✅ 대상' : '❌ 제외';
        this.logger.log(`  ${status} ${task.email}: ${this.formatDateTime(scheduledTime)} (재시도: ${retryCount})`);
      }

      return isTarget;
    });

    // 3. 정렬: 결제시각 ASC (오래된 순서 먼저), 재시도 많은 것 후순위
    filtered.sort((a, b) => {
      // 먼저 scheduledTime으로 정렬
      const timeDiff = (a.scheduledTime?.getTime() || 0) - (b.scheduledTime?.getTime() || 0);
      if (timeDiff !== 0) return timeDiff;

      // 같은 시간이면 재시도 적은 것 먼저
      const retryA = parseInt(a.retryCount, 10) || 0;
      const retryB = parseInt(b.retryCount, 10) || 0;
      return retryA - retryB;
    });

    if (this.debugMode) {
      this.logger.log(`  결과: ${filtered.length}개 대상`);
      this.logger.log(`===================================\n`);
    }

    return filtered;
  }

  /**
   * 통합워커 작업 목록에서 잠금되지 않은 작업만 필터링
   * (WorkerLockService.filterUnlockedTasks 위임용)
   *
   * @param {Array} tasks - 작업 목록
   * @param {Function} isLockExpiredOrEmpty - 잠금 만료 판단 함수
   * @returns {Array} 잠금되지 않은 작업 목록
   */
  filterUnlockedTasks(tasks, isLockExpiredOrEmpty) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter(task => {
      const lockValue = task.lockValue || '';
      return isLockExpiredOrEmpty(lockValue);
    });
  }

  /**
   * 재시도 가능한 작업만 필터링
   *
   * @param {Array} tasks - 작업 목록
   * @param {number} maxRetry - 최대 재시도 횟수
   * @returns {Array} 재시도 가능한 작업 목록
   */
  filterRetryableTasks(tasks, maxRetry) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter(task => {
      const retryCount = parseInt(task.retryCount, 10) || 0;
      return retryCount < maxRetry;
    });
  }
}

module.exports = TimeFilterService;
