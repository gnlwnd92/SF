/**
 * 백업카드 선택 및 마스킹 서비스
 * 카드/주소 랜덤 선택, 카드번호 마스킹, 사용 기록 관리
 */

class BackupCardService {
  constructor({ backupCardRepository, logger }) {
    this.repository = backupCardRepository;
    this.logger = logger;
  }

  /**
   * 카드 선택 (미리 지정 또는 랜덤)
   * @param {string} email - 이메일 (백업카드변경 시트에 기록용)
   * @param {string|null} preSelectedCardName - 미리 지정된 카드 이름 (옵션)
   * @returns {Object} 선택된 카드 객체
   */
  async selectCard(email, preSelectedCardName = null) {
    if (preSelectedCardName && preSelectedCardName.trim() !== '') {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 시나리오 1: 미리 지정된 카드 사용
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const card = await this.repository.findCardByName(preSelectedCardName);

      if (!card) {
        throw new Error(`카드 "${preSelectedCardName}"을 백업카드 시트에서 찾을 수 없습니다`);
      }

      this.logger.info(`[BackupCardService] ✅ 미리 지정된 카드 사용: ${preSelectedCardName}`);
      return card;

    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 시나리오 2: 활성 카드 중 랜덤 선택
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const activeCards = await this.repository.getActiveCards();

      if (activeCards.length === 0) {
        throw new Error('활성화된 백업카드가 없습니다. 백업카드 시트를 확인하세요. (G열 = TRUE)');
      }

      // 랜덤 선택
      const randomIndex = Math.floor(Math.random() * activeCards.length);
      const selectedCard = activeCards[randomIndex];

      this.logger.info(`[BackupCardService] 🎲 랜덤 카드 선택: ${selectedCard.cardName} (${activeCards.length}개 중)`);

      // ⚠️ 중요: 백업카드변경 시트에 선택된 카드 이름 즉시 기록
      try {
        await this.repository.updateBackupCardChangeStatus(email, {
          cardName: selectedCard.cardName
        });
        this.logger.info(`[BackupCardService] ✅ 선택된 카드 백업카드변경 시트에 기록: ${selectedCard.cardName}`);
      } catch (error) {
        this.logger.warn(`[BackupCardService] ⚠️ 카드 이름 기록 실패: ${error.message}`);
        // 기록 실패해도 선택은 계속 진행
      }

      return selectedCard;
    }
  }

  /**
   * 주소 선택 (미리 지정 또는 랜덤)
   * @param {string} email - 이메일 (백업카드변경 시트에 기록용)
   * @param {string|null} preSelectedAddressName - 미리 지정된 주소 이름 (옵션)
   * @returns {Object} 선택된 주소 객체
   */
  async selectAddress(email, preSelectedAddressName = null) {
    if (preSelectedAddressName && preSelectedAddressName.trim() !== '') {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 시나리오 1: 미리 지정된 주소 사용
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const address = await this.repository.findAddressByName(preSelectedAddressName);

      if (!address) {
        throw new Error(`주소 "${preSelectedAddressName}"을 파키스탄주소 시트에서 찾을 수 없습니다`);
      }

      this.logger.info(`[BackupCardService] ✅ 미리 지정된 주소 사용: ${preSelectedAddressName}`);
      return address;

    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 시나리오 2: 활성 주소 중 랜덤 선택
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const activeAddresses = await this.repository.getActiveAddresses();

      if (activeAddresses.length === 0) {
        throw new Error('활성화된 주소가 없습니다. 파키스탄주소 시트를 확인하세요. (F열 = TRUE)');
      }

      // 랜덤 선택
      const randomIndex = Math.floor(Math.random() * activeAddresses.length);
      const selectedAddress = activeAddresses[randomIndex];

      this.logger.info(`[BackupCardService] 🎲 랜덤 주소 선택: ${selectedAddress.addressName} (${activeAddresses.length}개 중)`);

      // ⚠️ 중요: 백업카드변경 시트에 선택된 주소 이름 즉시 기록
      try {
        await this.repository.updateBackupCardChangeStatus(email, {
          addressName: selectedAddress.addressName
        });
        this.logger.info(`[BackupCardService] ✅ 선택된 주소 백업카드변경 시트에 기록: ${selectedAddress.addressName}`);
      } catch (error) {
        this.logger.warn(`[BackupCardService] ⚠️ 주소 이름 기록 실패: ${error.message}`);
        // 기록 실패해도 선택은 계속 진행
      }

      return selectedAddress;
    }
  }

  /**
   * 카드번호 마스킹 (로그 출력용)
   * @param {string} cardNumber - 16자리 카드번호
   * @returns {string} 마스킹된 카드번호 (예: 1234-****-****-5678)
   */
  maskCardNumber(cardNumber) {
    if (!cardNumber || cardNumber.length < 16) {
      return '****-****-****-****';
    }

    // 공백/하이픈 제거
    const cleaned = cardNumber.replace(/[\s-]/g, '');

    if (cleaned.length < 16) {
      return '****-****-****-****';
    }

    // 앞 4자리 + **** + **** + 뒤 4자리
    const first4 = cleaned.substring(0, 4);
    const last4 = cleaned.substring(12, 16);

    return `${first4}-****-****-${last4}`;
  }

  /**
   * CVV 마스킹 (로그 출력용)
   * @param {string} cvv - CVV 3자리
   * @returns {string} 마스킹된 CVV (***)
   */
  maskCVV(cvv) {
    return '***';
  }

  /**
   * 유효기간 마스킹 (로그 출력용)
   * @param {string} expiryDate - 유효기간 (MM/YY)
   * @returns {string} 마스킹된 유효기간 (MM/**)
   */
  maskExpiryDate(expiryDate) {
    if (!expiryDate || !expiryDate.includes('/')) {
      return '**/**';
    }

    const parts = expiryDate.split('/');
    return `${parts[0]}/**`;
  }

  /**
   * 카드/주소 사용 기록 (사용 횟수 증가)
   * @param {string} cardName - 카드 이름
   * @param {string} addressName - 주소 이름
   * @returns {Object} 업데이트 결과
   */
  async recordCardUsage(cardName, addressName) {
    try {
      // 병렬 실행
      const [cardResult, addressResult] = await Promise.all([
        this.repository.incrementCardUsage(cardName),
        this.repository.incrementAddressUsage(addressName)
      ]);

      this.logger.info(`[BackupCardService] 📝 사용 기록 완료: 카드=${cardName}, 주소=${addressName}`);

      return {
        cardUpdated: cardResult,
        addressUpdated: addressResult
      };
    } catch (error) {
      this.logger.error(`[BackupCardService] ❌ 사용 기록 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 카드 정보 유효성 검사
   * @param {Object} card - 카드 객체
   * @returns {Object} 검사 결과 { valid: boolean, errors: Array }
   */
  validateCard(card) {
    const errors = [];

    // 카드번호 검사 (16자리)
    if (!card.cardNumber) {
      errors.push('카드번호가 없습니다');
    } else {
      const cleaned = card.cardNumber.replace(/[\s-]/g, '');
      if (cleaned.length !== 16) {
        errors.push(`카드번호는 16자리여야 합니다 (현재: ${cleaned.length}자리)`);
      }
      if (!/^\d+$/.test(cleaned)) {
        errors.push('카드번호는 숫자만 포함해야 합니다');
      }
    }

    // 유효기간 검사 (MM/YY 형식)
    if (!card.expiryDate) {
      errors.push('유효기간이 없습니다');
    } else {
      if (!/^\d{2}\/\d{2}$/.test(card.expiryDate)) {
        errors.push('유효기간 형식이 올바르지 않습니다 (MM/YY 형식 필요)');
      } else {
        const [month, year] = card.expiryDate.split('/').map(n => parseInt(n));
        if (month < 1 || month > 12) {
          errors.push(`유효하지 않은 월: ${month}`);
        }

        // 만료 확인 (현재 날짜 기준)
        const now = new Date();
        const currentYear = now.getFullYear() % 100; // 2025 → 25
        const currentMonth = now.getMonth() + 1;

        if (year < currentYear || (year === currentYear && month < currentMonth)) {
          errors.push(`카드가 만료되었습니다: ${card.expiryDate}`);
        }
      }
    }

    // CVV 검사 (3자리)
    if (!card.cvv) {
      errors.push('CVV가 없습니다');
    } else {
      if (!/^\d{3}$/.test(card.cvv)) {
        errors.push('CVV는 3자리 숫자여야 합니다');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 주소 정보 유효성 검사
   * @param {Object} address - 주소 객체
   * @returns {Object} 검사 결과 { valid: boolean, errors: Array }
   */
  validateAddress(address) {
    const errors = [];

    // 국가 검사 (Pakistan 또는 PK 허용)
    if (!address.country) {
      errors.push('국가가 없습니다');
    } else {
      const normalizedCountry = address.country.trim().toUpperCase();
      const validCountries = ['PAKISTAN', 'PK'];

      if (!validCountries.includes(normalizedCountry)) {
        errors.push(`파키스탄이 아닌 국가: ${address.country}`);
      }
    }

    // 도로명주소 검사
    if (!address.streetAddress || address.streetAddress.trim() === '') {
      errors.push('도로명주소가 없습니다');
    }

    // 도시 검사
    if (!address.city || address.city.trim() === '') {
      errors.push('도시가 없습니다');
    }

    // 우편번호 검사 (5자리)
    if (!address.postalCode) {
      errors.push('우편번호가 없습니다');
    } else {
      if (!/^\d{5}$/.test(address.postalCode)) {
        errors.push('우편번호는 5자리 숫자여야 합니다');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 카드/주소 선택 및 검증 (통합 메서드)
   * @param {string} email - 이메일
   * @param {string|null} preSelectedCardName - 미리 지정된 카드 이름
   * @param {string|null} preSelectedAddressName - 미리 지정된 주소 이름
   * @returns {Object} { card, address, valid: boolean, errors: Array }
   */
  async selectAndValidate(email, preSelectedCardName = null, preSelectedAddressName = null) {
    try {
      // 1. 카드 선택
      const card = await this.selectCard(email, preSelectedCardName);

      // 2. 주소 선택
      const address = await this.selectAddress(email, preSelectedAddressName);

      // 3. 검증
      const cardValidation = this.validateCard(card);
      const addressValidation = this.validateAddress(address);

      const allErrors = [
        ...cardValidation.errors.map(e => `[카드] ${e}`),
        ...addressValidation.errors.map(e => `[주소] ${e}`)
      ];

      const isValid = cardValidation.valid && addressValidation.valid;

      if (!isValid) {
        this.logger.error(`[BackupCardService] ❌ 검증 실패:\n${allErrors.join('\n')}`);
      } else {
        this.logger.info(`[BackupCardService] ✅ 카드/주소 선택 및 검증 완료`);
        this.logger.info(`[BackupCardService]   카드: ${card.cardName} (${this.maskCardNumber(card.cardNumber)})`);
        this.logger.info(`[BackupCardService]   주소: ${address.addressName} (${address.city}, ${address.country})`);
      }

      return {
        card,
        address,
        valid: isValid,
        errors: allErrors
      };
    } catch (error) {
      this.logger.error(`[BackupCardService] ❌ 선택/검증 실패: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BackupCardService;
