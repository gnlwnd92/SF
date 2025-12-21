/**
 * 오류 분류 및 상세 설명 시스템
 * 각 오류 케이스를 분류하고 해결 방법을 제시
 */

class ErrorClassifier {
  constructor() {
    // 오류 패턴 정의
    this.errorPatterns = {
      // 네트워크 관련
      NETWORK_TIMEOUT: {
        patterns: [/timeout/i, /ETIMEDOUT/i, /network timeout/i],
        category: '네트워크',
        description: '네트워크 연결 시간 초과',
        solution: 'VPN 확인 또는 재시도',
        severity: 'medium'
      },
      NETWORK_ERROR: {
        patterns: [/ECONNREFUSED/i, /ENOTFOUND/i, /network error/i, /ERR_NETWORK/i],
        category: '네트워크',
        description: '네트워크 연결 실패',
        solution: '인터넷 연결 확인',
        severity: 'high'
      },

      // 인증 관련
      LOGIN_FAILED: {
        patterns: [/login failed/i, /authentication failed/i, /로그인 실패/],
        category: '인증',
        description: '로그인 실패',
        solution: '비밀번호 확인 필요',
        severity: 'high'
      },
      TWO_FACTOR_AUTH: {
        patterns: [/2-step verification/i, /2FA/i, /two-factor/i, /번호인증/],
        category: '인증',
        description: '2단계 인증 필요',
        solution: '수동 인증 필요',
        severity: 'critical'
      },
      CAPTCHA_REQUIRED: {
        patterns: [/captcha/i, /reCAPTCHA/i, /human verification/i],
        category: '인증',
        description: 'CAPTCHA 인증 필요',
        solution: '수동 인증 필요',
        severity: 'critical'
      },
      PASSKEY_PAGE: {
        patterns: [/passkey/i, /passwordless/i, /빠르게 로그인/],
        category: '인증',
        description: '패스키 페이지 처리 실패',
        solution: '나중에 버튼 클릭 로직 확인',
        severity: 'medium'
      },

      // 브라우저 관련
      BROWSER_NOT_FOUND: {
        patterns: [/browser not found/i, /브라우저를 찾을 수 없/],
        category: '브라우저',
        description: '브라우저 프로필 없음',
        solution: 'AdsPower에서 프로필 생성',
        severity: 'high'
      },
      BROWSER_LAUNCH_FAILED: {
        patterns: [/failed to launch/i, /browser launch failed/i],
        category: '브라우저',
        description: '브라우저 실행 실패',
        solution: 'AdsPower 재시작',
        severity: 'high'
      },
      BROWSER_DISCONNECTED: {
        patterns: [/target closed/i, /browser disconnected/i, /protocol error/i],
        category: '브라우저',
        description: '브라우저 연결 끊김',
        solution: '브라우저 재실행',
        severity: 'medium'
      },

      // 페이지 요소 관련
      ELEMENT_NOT_FOUND: {
        patterns: [/element not found/i, /selector not found/i, /찾을 수 없/],
        category: '페이지',
        description: '페이지 요소 없음',
        solution: '페이지 구조 변경 확인',
        severity: 'medium'
      },
      BUTTON_NOT_FOUND: {
        patterns: [/button not found/i, /버튼을 찾을 수 없/],
        category: '페이지',
        description: '버튼 찾기 실패',
        solution: '언어 설정 확인',
        severity: 'medium'
      },
      PAGE_LOAD_ERROR: {
        patterns: [/page load error/i, /navigation failed/i],
        category: '페이지',
        description: '페이지 로드 실패',
        solution: '네트워크 상태 확인',
        severity: 'medium'
      },

      // YouTube 구독 관련
      ALREADY_PAUSED: {
        patterns: [/already paused/i, /이미 일시중지/],
        category: '구독',
        description: '이미 일시중지 상태',
        solution: '상태 확인 필요',
        severity: 'low'
      },
      ALREADY_ACTIVE: {
        patterns: [/already active/i, /이미 활성/],
        category: '구독',
        description: '이미 활성 상태',
        solution: '상태 확인 필요',
        severity: 'low'
      },
      SUBSCRIPTION_NOT_FOUND: {
        patterns: [/subscription not found/i, /구독을 찾을 수 없/],
        category: '구독',
        description: '구독 정보 없음',
        solution: '구독 상태 확인',
        severity: 'high'
      },
      PAYMENT_ISSUE: {
        patterns: [
          /payment/i,
          /결제/,
          // 러시아어
          /Не удалось списать средства/i,  // "결제 청구 실패"
          /Не удалось обработать платеж/i,  // "결제 처리 실패"
          /обновите платежные данные/i,     // "결제 정보 업데이트"
          /Обновить способ оплаты/i,        // "결제 방법 업데이트"
          /проблема с оплатой/i,             // "결제 문제"
          /платеж не прошел/i,               // "결제 실패"
          // 일본어
          /支払い.*失敗/,
          /決済.*エラー/,
          // 중국어
          /支付.*失败/,
          /付款.*问题/,
          // 스페인어
          /pago.*falla/i,
          /pago.*rechazado/i,
          /método de pago/i,
          // 포르투갈어
          /pagamento.*falhou/i,
          /forma de pagamento/i
        ],
        category: '결제',
        description: '결제 정보 문제',
        solution: '결제 수단 확인',
        severity: 'high'
      },

      // 기타
      UNKNOWN_ERROR: {
        patterns: [],
        category: '기타',
        description: '알 수 없는 오류',
        solution: '로그 확인 필요',
        severity: 'medium'
      }
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 백업카드 변경 전용 오류 패턴 (21개)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    this.backupCardErrorPatterns = {
      // 1. 카드 입력 관련 (7개)
      CARD_INVALID_NUMBER: {
        patterns: [/invalid card number/i, /카드번호.*오류/i, /card number.*invalid/i, /invalid.*card/i],
        category: '결제수단',
        description: '카드번호 형식 오류',
        solution: '16자리 숫자 확인',
        severity: 'high'
      },
      CARD_EXPIRED: {
        patterns: [/card expired/i, /유효기간.*만료/i, /expired.*card/i, /expiration.*date/i],
        category: '결제수단',
        description: '카드 유효기간 만료',
        solution: '다른 카드 사용',
        severity: 'high'
      },
      CARD_CVV_INVALID: {
        patterns: [/invalid cvv/i, /invalid cvc/i, /CVV.*오류/i, /security code.*invalid/i],
        category: '결제수단',
        description: 'CVV 보안코드 오류',
        solution: 'CVV 3자리 확인',
        severity: 'high'
      },
      CARD_DECLINED: {
        patterns: [/card declined/i, /카드.*거부/i, /declined.*transaction/i, /payment.*declined/i],
        category: '결제수단',
        description: '카드 거부됨',
        solution: '은행 문의 필요',
        severity: 'critical'
      },
      CARD_UNSUPPORTED_TYPE: {
        patterns: [/card type.*not supported/i, /unsupported.*card/i, /카드 유형.*지원.*안/i],
        category: '결제수단',
        description: '지원하지 않는 카드 유형',
        solution: 'VISA/Mastercard 사용',
        severity: 'high'
      },
      CARD_NAME_MISMATCH: {
        patterns: [/name.*mismatch/i, /cardholder.*name/i, /이름.*불일치/i],
        category: '결제수단',
        description: '카드 소유자 이름 불일치',
        solution: '카드명의 확인',
        severity: 'medium'
      },
      CARD_INPUT_TIMEOUT: {
        patterns: [/card input.*timeout/i, /카드 입력.*시간 초과/i, /input field.*timeout/i],
        category: '결제수단',
        description: '카드 입력 시간 초과',
        solution: '입력 속도 조정',
        severity: 'medium'
      },

      // 2. 주소 입력 관련 (5개)
      ADDRESS_INVALID_FORMAT: {
        patterns: [/invalid address/i, /주소.*형식.*오류/i, /address format/i, /invalid.*address line/i],
        category: '주소',
        description: '주소 형식 오류',
        solution: '주소 형식 확인',
        severity: 'medium'
      },
      POSTAL_CODE_INVALID: {
        patterns: [/invalid postal code/i, /우편번호.*오류/i, /zip code.*invalid/i, /postcode.*error/i],
        category: '주소',
        description: '우편번호 형식 오류',
        solution: '5자리 숫자 확인',
        severity: 'medium'
      },
      COUNTRY_NOT_SUPPORTED: {
        patterns: [/country not supported/i, /국가.*지원.*안/i, /unsupported country/i],
        category: '주소',
        description: '지원하지 않는 국가',
        solution: '파키스탄 선택 확인',
        severity: 'high'
      },
      CITY_REQUIRED: {
        patterns: [/city.*required/i, /도시.*필수/i, /missing city/i],
        category: '주소',
        description: '도시 입력 필수',
        solution: '도시 필드 확인',
        severity: 'medium'
      },
      ADDRESS_VERIFICATION_FAILED: {
        patterns: [/address verification/i, /주소 확인.*실패/i, /cannot verify.*address/i],
        category: '주소',
        description: '주소 검증 실패',
        solution: '주소 정확성 확인',
        severity: 'medium'
      },

      // 3. 팝업 처리 관련 (4개)
      POPUP_NOT_APPEARED: {
        patterns: [/popup not found/i, /팝업.*미출현/i, /popup.*not.*appeared/i, /dialog.*not found/i],
        category: '팝업',
        description: '백업카드 추가 팝업 미출현',
        solution: '수동 확인 필요',
        severity: 'medium'
      },
      POPUP_TIMEOUT: {
        patterns: [/popup.*timeout/i, /팝업.*시간 초과/i, /waiting.*popup.*timeout/i],
        category: '팝업',
        description: '팝업 대기 시간 초과',
        solution: '페이지 로딩 확인',
        severity: 'medium'
      },
      POPUP_SCENARIO_UNKNOWN: {
        patterns: [/unknown popup scenario/i, /팝업 시나리오.*알 수 없/i, /cannot detect.*scenario/i],
        category: '팝업',
        description: '팝업 시나리오 감지 실패',
        solution: 'PRD 시나리오 확인',
        severity: 'high'
      },
      POPUP_CLOSE_FAILED: {
        patterns: [/popup.*close.*failed/i, /팝업 닫기.*실패/i, /cannot close.*dialog/i],
        category: '팝업',
        description: '팝업 닫기 실패',
        solution: '브라우저 재시작',
        severity: 'low'
      },

      // 4. 시트 데이터 관련 (5개)
      SHEET_CARD_NOT_FOUND: {
        patterns: [/card not found in sheet/i, /백업카드 시트.*카드 없음/i, /no active cards/i],
        category: '시트',
        description: '백업카드 시트에 카드 없음',
        solution: '백업카드 시트에 카드 추가',
        severity: 'high'
      },
      SHEET_ADDRESS_NOT_FOUND: {
        patterns: [/address not found in sheet/i, /주소 시트.*주소 없음/i, /no active addresses/i],
        category: '시트',
        description: '파키스탄주소 시트에 주소 없음',
        solution: '파키스탄주소 시트에 주소 추가',
        severity: 'high'
      },
      SHEET_EMAIL_NOT_FOUND: {
        patterns: [/email not found/i, /이메일.*찾을 수 없/i, /profile.*email.*not found/i],
        category: '시트',
        description: '백업카드변경 시트에 이메일 없음',
        solution: '시트에 프로필 추가',
        severity: 'high'
      },
      SHEET_UPDATE_FAILED: {
        patterns: [/sheet update failed/i, /시트 업데이트.*실패/i, /cannot update.*sheet/i],
        category: '시트',
        description: 'Google Sheets 업데이트 실패',
        solution: '권한 및 네트워크 확인',
        severity: 'medium'
      },
      SHEET_NO_ACTIVE_ITEMS: {
        patterns: [/no active.*items/i, /활성화.*항목 없음/i, /all items.*inactive/i],
        category: '시트',
        description: '활성화된 카드/주소 없음',
        solution: '활성화 컬럼 확인',
        severity: 'high'
      }
    };
  }

  /**
   * 오류 분류
   * @param {string|Error} error - 오류 메시지 또는 Error 객체
   * @returns {Object} 분류된 오류 정보
   */
  classify(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // 각 패턴과 매칭
    for (const [code, errorInfo] of Object.entries(this.errorPatterns)) {
      if (code === 'UNKNOWN_ERROR') continue; // 기본값은 마지막에
      
      for (const pattern of errorInfo.patterns) {
        if (pattern.test(errorMessage)) {
          return {
            code,
            ...errorInfo,
            originalMessage: errorMessage,
            timestamp: new Date().toISOString()
          };
        }
      }
    }
    
    // 매칭되는 패턴이 없으면 UNKNOWN_ERROR
    return {
      code: 'UNKNOWN_ERROR',
      ...this.errorPatterns.UNKNOWN_ERROR,
      originalMessage: errorMessage,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Google Sheets용 오류 포맷팅
   * @param {Object} classifiedError - 분류된 오류
   * @returns {string} 포맷팅된 오류 메시지
   */
  formatForSheets(classifiedError) {
    const { code, category, description, solution, severity, originalMessage } = classifiedError;
    
    // 심각도에 따른 이모지
    const severityEmoji = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢'
    };
    
    return `${severityEmoji[severity]} [${category}] ${description}\n` +
           `원인: ${originalMessage.substring(0, 100)}\n` +
           `해결: ${solution}\n` +
           `코드: ${code}`;
  }

  /**
   * 간단한 오류 메시지 (상태 컬럼용)
   * @param {Object} classifiedError - 분류된 오류
   * @returns {string} 간단한 오류 메시지
   */
  getSimpleMessage(classifiedError) {
    const { category, description, severity } = classifiedError;
    
    const severityEmoji = {
      critical: '❌',
      high: '⚠️',
      medium: '⚡',
      low: 'ℹ️'
    };
    
    return `${severityEmoji[severity]} ${category}: ${description}`;
  }

  /**
   * 재시도 가능 여부 판단
   * @param {Object} classifiedError - 분류된 오류
   * @returns {boolean} 재시도 가능 여부
   */
  isRetryable(classifiedError) {
    const nonRetryableCodes = [
      'TWO_FACTOR_AUTH',
      'CAPTCHA_REQUIRED',
      'ALREADY_PAUSED',
      'ALREADY_ACTIVE',
      'SUBSCRIPTION_NOT_FOUND',
      'PAYMENT_ISSUE'
    ];
    
    return !nonRetryableCodes.includes(classifiedError.code);
  }

  /**
   * 오류 통계 생성
   * @param {Array} errors - 오류 배열
   * @returns {Object} 통계 정보
   */
  generateStatistics(errors) {
    const stats = {
      total: errors.length,
      byCategory: {},
      bySeverity: {},
      retryable: 0,
      nonRetryable: 0
    };

    errors.forEach(error => {
      const classified = this.classify(error);

      // 카테고리별 집계
      stats.byCategory[classified.category] =
        (stats.byCategory[classified.category] || 0) + 1;

      // 심각도별 집계
      stats.bySeverity[classified.severity] =
        (stats.bySeverity[classified.severity] || 0) + 1;

      // 재시도 가능 여부
      if (this.isRetryable(classified)) {
        stats.retryable++;
      } else {
        stats.nonRetryable++;
      }
    });

    return stats;
  }

  /**
   * 백업카드 변경 전용 오류 분류
   * @param {string|Error} error - 오류 메시지 또는 Error 객체
   * @returns {Object} 분류된 오류 정보
   */
  classifyBackupCardError(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 1. 백업카드 전용 패턴 우선 검사 (21개)
    for (const [code, errorInfo] of Object.entries(this.backupCardErrorPatterns)) {
      for (const pattern of errorInfo.patterns) {
        if (pattern.test(errorMessage)) {
          return {
            code,
            ...errorInfo,
            originalMessage: errorMessage,
            timestamp: new Date().toISOString(),
            source: 'backup-card' // 백업카드 전용 에러임을 표시
          };
        }
      }
    }

    // 2. 매칭되지 않으면 일반 패턴으로 fallback
    const generalClassified = this.classify(error);

    // source 필드 추가
    return {
      ...generalClassified,
      source: 'general' // 일반 에러임을 표시
    };
  }

  /**
   * 백업카드 변경 재시도 가능 여부 판단
   * @param {Object} classifiedError - 분류된 오류
   * @returns {boolean} 재시도 가능 여부
   */
  isBackupCardRetryable(classifiedError) {
    const nonRetryableCodes = [
      // 결제수단 관련
      'CARD_DECLINED',           // 카드 거부 (은행 문제)
      'CARD_UNSUPPORTED_TYPE',   // 지원 안 하는 카드 유형

      // 주소 관련
      'COUNTRY_NOT_SUPPORTED',   // 지원 안 하는 국가

      // 팝업 관련
      'POPUP_SCENARIO_UNKNOWN',  // 알 수 없는 팝업 시나리오

      // 시트 데이터 관련
      'SHEET_CARD_NOT_FOUND',    // 카드 없음
      'SHEET_ADDRESS_NOT_FOUND', // 주소 없음
      'SHEET_EMAIL_NOT_FOUND',   // 이메일 없음
      'SHEET_NO_ACTIVE_ITEMS',   // 활성화된 항목 없음

      // 기존 일반 에러
      'TWO_FACTOR_AUTH',
      'CAPTCHA_REQUIRED',
      'SUBSCRIPTION_NOT_FOUND'
    ];

    return !nonRetryableCodes.includes(classifiedError.code);
  }
}

module.exports = ErrorClassifier;