/**
 * TelegramNotificationService - Telegram 봇 알림 서비스
 *
 * 통합워커에서 심각한 에러 또는 최대 재시도 초과 시
 * Telegram 단체 대화방으로 알림을 전송합니다.
 *
 * 설계 원칙:
 * - 모든 public 메서드는 내부 try-catch → 절대 throw 안 함 (메인 로직 영향 없음)
 * - enabled === false 이면 즉시 return
 * - 슬라이딩 윈도우 rate limit (분당 20회)
 * - 메시지 4096자 제한 truncation 처리
 * - timeout 10초 (Telegram API 응답 지연 시 메인 루프 블로킹 최소화)
 */

const axios = require('axios');

class TelegramNotificationService {
  /**
   * @param {Object} options
   * @param {string} options.botToken - Telegram Bot API 토큰
   * @param {string} options.chatId - 알림 대상 채팅방 ID
   * @param {boolean} options.enabled - 알림 활성화 여부
   * @param {boolean} options.debugMode - 디버그 모드
   * @param {Object} [options.sharedConfig] - SharedConfig 인스턴스 (유형별 ON/OFF)
   */
  constructor({ botToken, chatId, enabled = true, debugMode = false, sharedConfig }) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.enabled = enabled && !!botToken && !!chatId;
    this.debugMode = debugMode;
    this.sharedConfig = sharedConfig || null;

    // rate limit: 슬라이딩 윈도우 (분당 20회)
    this.rateLimitWindow = 60 * 1000; // 1분
    this.rateLimitMax = 20;
    this.messageTimestamps = [];

    // Telegram API 기본 URL
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;

    if (this.debugMode && this.enabled) {
      console.log('[TelegramService] 초기화 완료 (활성화)');
    }
  }

  /**
   * 에러 알림 전송
   *
   * @param {Object} params
   * @param {string} params.email - 계정 이메일
   * @param {string} params.action - 작업 유형 (pause/resume)
   * @param {string} params.error - 에러 내용
   * @param {string} params.severity - 심각도 (critical/high)
   * @param {string} params.workerId - 워커 ID
   * @param {string} [params.notificationType] - 알림 유형 (critical/paymentDelay/infiniteLoop/maxRetry/paymentIssue)
   */
  async notifyError({ email, action, error, severity = 'critical', workerId, notificationType }) {
    if (!this.enabled) return;
    if (notificationType && !this._isNotificationEnabled(notificationType)) return;

    try {
      const severityEmoji = severity === 'critical' ? '\u{1F534}' : '\u{1F7E0}';
      const severityText = severity === 'critical' ? '\uC2EC\uAC01 \uC624\uB958' : '\uC8FC\uC758 \uC624\uB958';
      const actionText = action === 'pause' ? '\uC77C\uC2DC\uC911\uC9C0' : action === 'resume' ? '\uACB0\uC81C\uC7AC\uAC1C' : action;

      const message = [
        `${severityEmoji} <b>${severityText} \uBC1C\uC0DD</b>`,
        '',
        `\u{1F4E7} \uACC4\uC815: <code>${this._escapeHtml(email || 'Unknown')}</code>`,
        `\u{1F527} \uC791\uC5C5: ${this._escapeHtml(actionText)}`,
        `\u274C \uC624\uB958: ${this._escapeHtml(String(error || '\uC54C \uC218 \uC5C6\uC74C').substring(0, 200))}`,
        `\u{1F5A5}\uFE0F \uC6CC\uCEE4: ${this._escapeHtml(workerId || 'Unknown')}`,
        `\u23F0 \uC2DC\uAC04: ${this._getKSTTimeStr()}`,
        '',
        `\u{1F4A1} \uC870\uCE58: \uC218\uB3D9 \uD655\uC778 \uD544\uC694`
      ].join('\n');

      await this._sendMessage(message);
    } catch (err) {
      if (this.debugMode) {
        console.error(`[TelegramService] notifyError \uC2E4\uD328: ${err.message}`);
      }
    }
  }

  /**
   * 결제 지연 알림 전송
   *
   * @param {Object} params
   * @param {string} params.email - 계정 이메일
   * @param {number} params.hoursElapsed - 경과 시간(시)
   * @param {string} params.workerId - 워커 ID
   * @param {string} [params.notificationType] - 알림 유형
   */
  async notifyPaymentDelay({ email, hoursElapsed, workerId, notificationType }) {
    if (!this.enabled) return;
    if (notificationType && !this._isNotificationEnabled(notificationType)) return;

    try {
      const message = [
        `\u23F0 <b>\uACB0\uC81C \uBBF8\uC644\uB8CC ${hoursElapsed}\uC2DC\uAC04 \uCD08\uACFC</b>`,
        '',
        `\u{1F4E7} \uACC4\uC815: <code>${this._escapeHtml(email || 'Unknown')}</code>`,
        `\u{1F4C5} \uACBD\uACFC: ${hoursElapsed}\uC2DC\uAC04 \uC774\uC0C1 \uACB0\uC81C \uBBF8\uC644\uB8CC`,
        `\u{1F5A5}\uFE0F \uC6CC\uCEE4: ${this._escapeHtml(workerId || 'Unknown')}`,
        `\u23F0 \uC2DC\uAC04: ${this._getKSTTimeStr()}`,
        '',
        `\u{1F4A1} \uC870\uCE58: \uC218\uB3D9\uCCB4\uD06C-\uACB0\uC81C\uC9C0\uC5F0 \uC0C1\uD0DC\uB85C \uC804\uD658\uB428`
      ].join('\n');

      await this._sendMessage(message);
    } catch (err) {
      if (this.debugMode) {
        console.error(`[TelegramService] notifyPaymentDelay \uC2E4\uD328: ${err.message}`);
      }
    }
  }

  /**
   * Telegram API로 메시지 전송
   *
   * @param {string} text - HTML 형식 메시지
   * @returns {Promise<boolean>} 전송 성공 여부
   * @private
   */
  async _sendMessage(text) {
    // rate limit 체크
    if (this._isRateLimited()) {
      if (this.debugMode) {
        console.warn('[TelegramService] Rate limit \uCD08\uACFC - \uBA54\uC2DC\uC9C0 \uC0DD\uB7B5');
      }
      return false;
    }

    // 메시지 길이 제한 (Telegram: 4096자)
    const truncatedText = text.length > 4096
      ? text.substring(0, 4090) + '\n...'
      : text;

    try {
      await axios.post(
        `${this.apiBaseUrl}/sendMessage`,
        {
          chat_id: this.chatId,
          text: truncatedText,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        },
        {
          timeout: 10000 // 10초 타임아웃
        }
      );

      // rate limit 타임스탬프 기록
      this.messageTimestamps.push(Date.now());

      if (this.debugMode) {
        console.log('[TelegramService] \uBA54\uC2DC\uC9C0 \uC804\uC1A1 \uC131\uACF5');
      }

      return true;
    } catch (err) {
      if (this.debugMode) {
        console.error(`[TelegramService] API \uD638\uCD9C \uC2E4\uD328: ${err.message}`);
      }
      return false;
    }
  }

  /**
   * 슬라이딩 윈도우 rate limit 체크
   *
   * @returns {boolean} rate limit 초과 시 true
   * @private
   */
  _isRateLimited() {
    const now = Date.now();
    // 윈도우 밖의 오래된 타임스탬프 제거
    this.messageTimestamps = this.messageTimestamps.filter(
      ts => now - ts < this.rateLimitWindow
    );
    return this.messageTimestamps.length >= this.rateLimitMax;
  }

  /**
   * 한국 시간(KST) 문자열 반환
   *
   * @returns {string} 'YYYY-MM-DD HH:mm:ss (KST)' 형식
   * @private
   */
  _getKSTTimeStr() {
    const now = new Date();
    const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const y = kst.getFullYear();
    const M = String(kst.getMonth() + 1).padStart(2, '0');
    const d = String(kst.getDate()).padStart(2, '0');
    const h = String(kst.getHours()).padStart(2, '0');
    const m = String(kst.getMinutes()).padStart(2, '0');
    const s = String(kst.getSeconds()).padStart(2, '0');
    return `${y}-${M}-${d} ${h}:${m}:${s} (KST)`;
  }

  /**
   * HTML 특수문자 이스케이프
   *
   * @param {string} text - 이스케이프할 텍스트
   * @returns {string} 이스케이프된 텍스트
   * @private
   */
  _escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 알림 유형별 활성화 여부 확인 (SharedConfig 기반)
   *
   * @param {string} notificationType - 알림 유형
   * @returns {boolean} 활성화 여부 (sharedConfig 없으면 기본 true)
   * @private
   */
  _isNotificationEnabled(notificationType) {
    if (!this.sharedConfig) return true;

    const typeMap = {
      critical: 'isTelegramNotifyCritical',
      paymentDelay: 'isTelegramNotifyPaymentDelay',
      infiniteLoop: 'isTelegramNotifyInfiniteLoop',
      maxRetry: 'isTelegramNotifyMaxRetry',
      paymentIssue: 'isTelegramNotifyPaymentIssue'
    };

    const method = typeMap[notificationType];
    if (!method || typeof this.sharedConfig[method] !== 'function') return true;

    return this.sharedConfig[method]();
  }
}

module.exports = TelegramNotificationService;
