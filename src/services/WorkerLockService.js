/**
 * WorkerLockService v2.11 - 분산 워커 잠금 관리 서비스
 *
 * Google Sheets J열을 사용한 분산 잠금 메커니즘
 * - 여러 PC에서 동시 작업 시 충돌 방지
 * - 5분 초과 잠금 자동 무효화 (v2.11: 15분 → 5분으로 단축)
 */
const os = require('os');

class WorkerLockService {
  /**
   * @param {Object} options
   * @param {Object} options.sheetsRepository - Google Sheets Repository
   * @param {Object} options.logger - 로거
   * @param {boolean} options.debugMode - 디버그 모드
   * @param {number} options.lockExpiryMinutes - 잠금 만료 시간 (분) - 기본값 5분 (v2.11)
   */
  constructor({ sheetsRepository, logger, debugMode = false, lockExpiryMinutes = 5 } = {}) {
    this.sheetsRepository = sheetsRepository;
    this.logger = logger || console;
    this.debugMode = debugMode;
    this.lockExpiryMinutes = lockExpiryMinutes;
    this.workerId = this.generateWorkerId();
  }

  /**
   * 워커 ID 생성
   * 형식: WORKER-{hostname 앞4자}-{timestamp 뒤6자}
   * 예: WORKER-DESK-123456
   *
   * @returns {string}
   */
  generateWorkerId() {
    const hostname = os.hostname().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'NODE';
    const timestamp = Date.now().toString().slice(-6);
    return `WORKER-${hostname}-${timestamp}`;
  }

  /**
   * 현재 워커 ID 반환
   * @returns {string}
   */
  getWorkerId() {
    return this.workerId;
  }

  /**
   * 현재 시간 문자열 (HH:mm 형식)
   * @returns {string}
   */
  getCurrentTimeStr() {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }

  /**
   * 잠금 문자열 생성
   * 형식: "작업중:WORKER-DESK-123456:14:35"
   *
   * @returns {string}
   */
  createLockValue() {
    return `작업중:${this.workerId}:${this.getCurrentTimeStr()}`;
  }

  /**
   * 잠금 문자열 파싱
   *
   * @param {string} lockValue
   * @returns {{ status: string, workerId: string, time: string } | null}
   */
  parseLockValue(lockValue) {
    if (!lockValue || typeof lockValue !== 'string') {
      return null;
    }

    const parts = lockValue.split(':');
    if (parts.length < 3) {
      return null;
    }

    return {
      status: parts[0],
      workerId: parts[1],
      time: parts.slice(2).join(':')  // 시간에 : 포함될 수 있음
    };
  }

  /**
   * 잠금 유효성 검사
   * - 빈 값이면 잠금 없음 → true (획득 가능)
   * - 15분 초과 시 무효 → true (획득 가능)
   * - 유효한 잠금 → false (획득 불가)
   *
   * @param {string} lockValue - J열 값
   * @returns {boolean} true면 잠금 획득 가능
   */
  isLockExpiredOrEmpty(lockValue) {
    if (!lockValue || lockValue.trim() === '') {
      return true;  // 잠금 없음
    }

    const parsed = this.parseLockValue(lockValue);
    if (!parsed) {
      return true;  // 파싱 실패 = 무효한 잠금
    }

    // 시간 파싱
    const timeParts = parsed.time.split(':').map(p => parseInt(p, 10));
    if (timeParts.length < 2 || isNaN(timeParts[0]) || isNaN(timeParts[1])) {
      return true;  // 시간 파싱 실패
    }

    const [lockHour, lockMinute] = timeParts;
    const now = new Date();
    const lockTime = new Date();
    lockTime.setHours(lockHour, lockMinute, 0, 0);

    // 자정을 넘긴 경우 처리 (예: 잠금 23:50, 현재 00:10)
    if (lockTime > now) {
      lockTime.setDate(lockTime.getDate() - 1);
    }

    const diffMinutes = (now - lockTime) / (1000 * 60);

    if (this.debugMode) {
      this.logger.log(`[WorkerLockService] 잠금 유효성: ${lockValue}, 경과: ${diffMinutes.toFixed(1)}분, 만료기준: ${this.lockExpiryMinutes}분`);
    }

    return diffMinutes >= this.lockExpiryMinutes;
  }

  /**
   * 잠금 획득 시도
   * 1. J열 현재 값 확인
   * 2. 비어있거나 만료된 잠금이면 내 잠금 기록
   * 3. 0.5초 대기 (race condition 방지)
   * 4. J열 재확인하여 내 워커ID인지 검증
   *
   * @param {string} sheetName - 시트 이름 ("일시중지" 또는 "결제재개")
   * @param {number} rowIndex - 행 인덱스 (1-based)
   * @returns {Promise<boolean>} true면 잠금 성공
   */
  async acquireLock(sheetName, rowIndex) {
    try {
      // 1. 현재 잠금 상태 확인
      const currentLock = await this.sheetsRepository.getLockValue(sheetName, rowIndex);

      if (!this.isLockExpiredOrEmpty(currentLock)) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 잠금 실패 - 이미 잠금됨: ${currentLock}`);
        }
        return false;
      }

      // 2. 내 잠금 기록
      const myLock = this.createLockValue();
      await this.sheetsRepository.setLockValue(sheetName, rowIndex, myLock);

      // 3. Race condition 방지 대기
      await this.delay(500);

      // 4. 재확인
      const verifyLock = await this.sheetsRepository.getLockValue(sheetName, rowIndex);
      const parsed = this.parseLockValue(verifyLock);

      if (parsed && parsed.workerId === this.workerId) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 잠금 성공: ${sheetName} 행${rowIndex}`);
        }
        return true;
      } else {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 잠금 실패 - 다른 워커가 선점: ${verifyLock}`);
        }
        return false;
      }
    } catch (error) {
      this.logger.error(`[WorkerLockService] 잠금 획득 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 잠금 해제 (J열 비우기)
   *
   * @param {string} sheetName
   * @param {number} rowIndex
   * @returns {Promise<boolean>}
   */
  async releaseLock(sheetName, rowIndex) {
    try {
      await this.sheetsRepository.setLockValue(sheetName, rowIndex, '');

      if (this.debugMode) {
        this.logger.log(`[WorkerLockService] 잠금 해제: ${sheetName} 행${rowIndex}`);
      }

      return true;
    } catch (error) {
      this.logger.error(`[WorkerLockService] 잠금 해제 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 잠금되지 않은 작업만 필터링
   *
   * @param {Array} tasks - 작업 목록 (lockValue 필드 필요)
   * @returns {Array} 잠금되지 않은 작업 목록
   */
  filterUnlockedTasks(tasks) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter(task => {
      const lockValue = task.lockValue || task.lock || '';
      return this.isLockExpiredOrEmpty(lockValue);
    });
  }

  /**
   * 대기 유틸
   * @param {number} ms
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // 통합워커 v2.0 전용 메서드
  // ============================================================

  /**
   * 통합워커 탭 잠금 획득
   * Repository의 통합워커 전용 메서드 사용
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<boolean>} true면 잠금 성공
   */
  async acquireIntegratedWorkerLock(rowIndex) {
    try {
      // 1. 현재 잠금 상태 확인
      const currentLock = await this.sheetsRepository.getIntegratedWorkerLockValue(rowIndex);

      if (!this.isLockExpiredOrEmpty(currentLock)) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 통합워커 잠금 실패 - 이미 잠금됨: ${currentLock}`);
        }
        return false;
      }

      // 2. 내 잠금 기록
      const myLock = this.createLockValue();
      await this.sheetsRepository.setIntegratedWorkerLockValue(rowIndex, myLock);

      // 3. Race condition 방지 대기
      await this.delay(500);

      // 4. 재확인
      const verifyLock = await this.sheetsRepository.getIntegratedWorkerLockValue(rowIndex);
      const parsed = this.parseLockValue(verifyLock);

      if (parsed && parsed.workerId === this.workerId) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 통합워커 잠금 성공: 행${rowIndex}`);
        }
        return true;
      } else {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 통합워커 잠금 실패 - 다른 워커가 선점: ${verifyLock}`);
        }
        return false;
      }
    } catch (error) {
      this.logger.error(`[WorkerLockService] 통합워커 잠금 획득 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 통합워커 탭 잠금 해제
   *
   * @param {number} rowIndex - 행 번호 (1-based)
   * @returns {Promise<boolean>}
   */
  async releaseIntegratedWorkerLock(rowIndex) {
    try {
      await this.sheetsRepository.setIntegratedWorkerLockValue(rowIndex, '');

      if (this.debugMode) {
        this.logger.log(`[WorkerLockService] 통합워커 잠금 해제: 행${rowIndex}`);
      }

      return true;
    } catch (error) {
      this.logger.error(`[WorkerLockService] 통합워커 잠금 해제 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 재시도 가능한 작업만 필터링
   *
   * @param {Array} tasks - 작업 목록 (retryCount 필드 필요)
   * @param {number} maxRetry - 최대 재시도 횟수
   * @returns {Array} 재시도 가능한 작업 목록
   */
  filterRetryableTasks(tasks, maxRetry = 3) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter(task => {
      const retryCount = parseInt(task.retryCount, 10) || 0;
      const isRetryable = retryCount < maxRetry;

      if (!isRetryable && this.debugMode) {
        this.logger.log(`[WorkerLockService] 재시도 초과 스킵: ${task.email} (${retryCount}/${maxRetry})`);
      }

      return isRetryable;
    });
  }

  /**
   * 통합워커용 작업 필터링 (잠금 + 재시도 동시 체크)
   *
   * @param {Array} tasks - 작업 목록
   * @param {number} maxRetry - 최대 재시도 횟수
   * @returns {Array} 처리 가능한 작업 목록
   */
  filterAvailableTasks(tasks, maxRetry = 3) {
    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter(task => {
      // 잠금 체크
      const lockValue = task.lockValue || '';
      if (!this.isLockExpiredOrEmpty(lockValue)) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 잠금됨 스킵: ${task.email}`);
        }
        return false;
      }

      // 재시도 체크
      const retryCount = parseInt(task.retryCount, 10) || 0;
      if (retryCount >= maxRetry) {
        if (this.debugMode) {
          this.logger.log(`[WorkerLockService] 재시도 초과 스킵: ${task.email} (${retryCount}/${maxRetry})`);
        }
        return false;
      }

      return true;
    });
  }
}

module.exports = WorkerLockService;
