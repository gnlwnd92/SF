/**
 * YouTube Premium 백업 결제수단 추가 어댑터
 * 2가지 팝업 시나리오 자동 감지 및 처리
 *
 * Scenario 1: 직접 추가 팝업 (바로 백업 카드 추가)
 * Scenario 2: 변경 후 추가 팝업 (현재 결제수단 변경 → 백업 카드 추가)
 */

class YouTubePaymentAdapter {
  constructor({
    page,
    logger,
    languageService,
    buttonService,
    navigationService,
    backupCardService,
    popupService,
    multiLanguageTexts
  }) {
    this.page = page;
    this.logger = logger;
    this.languageService = languageService;
    this.buttonService = buttonService;
    this.navigationService = navigationService;
    this.backupCardService = backupCardService;
    this.popupService = popupService;
    this.texts = multiLanguageTexts;
  }

  /**
   * 백업 결제수단 추가 (메인 진입점)
   * @param {Object} card - 카드 객체 { cardName, cardNumber, expiryDate, cvv, cardType }
   * @param {Object} address - 주소 객체 { addressName, country, streetAddress, city, postalCode }
   * @returns {Object} { success, scenario, card, address, reason? }
   */
  async addBackupPaymentMethod(card, address) {
    this.logger.info('[YouTubePaymentAdapter] 🔄 백업 결제수단 추가 시작...');
    this.logger.info(`[YouTubePaymentAdapter] 📋 카드: ${card.cardName}, 주소: ${address.addressName}`);

    try {
      // 1. 현재 언어 감지
      this.logger.info('[YouTubePaymentAdapter] 🌐 Step 1: 언어 감지 시작');
      const detectResult = await this.languageService.detectLanguage(this.page);
      const currentLang = detectResult.language;
      this.logger.info(`[YouTubePaymentAdapter] ✅ 감지된 언어: ${currentLang} (신뢰도: ${detectResult.confidence})`);

      // 2. 팝업 시나리오 감지
      console.log('[DEBUG] ========================================');
      console.log('[DEBUG] Line 47-49 도달! detectPopupScenario 호출 직전');
      console.log('[DEBUG] currentLang:', currentLang);
      console.log('[DEBUG] ========================================');

      this.logger.info('[YouTubePaymentAdapter] 🔍 Step 2: 팝업 시나리오 감지 시작...');

      console.log('[DEBUG] detectPopupScenario() 호출 중...');
      const scenario = await this.detectPopupScenario(currentLang);
      console.log('[DEBUG] detectPopupScenario() 반환값:', scenario);

      if (!scenario) {
        this.logger.error('[YouTubePaymentAdapter] ❌ 팝업 시나리오를 감지할 수 없습니다');

        // 디버깅: 페이지 컨텐츠 일부 로그
        const pageContent = await this.page.content();
        const contentPreview = pageContent.substring(0, 500);
        this.logger.error(`[YouTubePaymentAdapter] 📄 페이지 컨텐츠 미리보기 (500자): ${contentPreview}...`);

        throw new Error('백업 결제수단 추가 팝업을 감지할 수 없습니다');
      }

      // 3. 시나리오별 처리
      if (scenario === 'directAdd') {
        // Scenario 1: 직접 추가 팝업
        this.logger.info('[YouTubePaymentAdapter] ✅ Scenario 1 감지: 직접 추가 팝업');
        return await this.handleDirectAddPopup(card, address, currentLang);
      } else if (scenario === 'changeAndAdd') {
        // Scenario 2: 변경 후 추가 팝업
        this.logger.info('[YouTubePaymentAdapter] ✅ Scenario 2 감지: 변경 후 추가 팝업');
        return await this.handleChangeAndAddPopup(card, address, currentLang);
      } else {
        this.logger.error(`[YouTubePaymentAdapter] ❌ 알 수 없는 시나리오: ${scenario}`);
        throw new Error(`알 수 없는 팝업 시나리오: ${scenario}`);
      }
    } catch (error) {
      this.logger.error(`[YouTubePaymentAdapter] ❌ 백업 결제수단 추가 실패: ${error.message}`);
      this.logger.error(`[YouTubePaymentAdapter] Stack Trace: ${error.stack}`);
      throw error;
    }
  }

  /**
   * 팝업 시나리오 감지 (능동적 대기)
   * @param {string} lang - 현재 언어 코드
   * @returns {string|null} 'directAdd' | 'changeAndAdd' | null
   */
  async detectPopupScenario(lang) {
    const langTexts = this.texts[lang] || this.texts['en'];

    this.logger.info(`[YouTubePaymentAdapter] ⏳ 팝업 감지 시작 (능동적 감지, 최대 20초)...`);

    // ✅ 능동적 팝업 감지: 키워드가 나타날 때까지 폴링
    const directAddKeywords = langTexts.paymentMethod?.addBackup || [];
    const changeKeywords = langTexts.paymentMethod?.updatePayment || [];

    this.logger.info(`[YouTubePaymentAdapter] 🔑 Scenario 1 키워드: ${JSON.stringify(directAddKeywords)}`);
    this.logger.info(`[YouTubePaymentAdapter] 🔑 Scenario 2 키워드: ${JSON.stringify(changeKeywords)}`);

    const maxAttempts = 40; // 20초 (0.5초 간격 × 40회)
    const pollInterval = 500; // 0.5초

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 페이지 컨텐츠 가져오기
      const pageContent = await this.page.content();

      // Scenario 1 감지
      for (const keyword of directAddKeywords) {
        if (pageContent.includes(keyword)) {
          this.logger.info(`[YouTubePaymentAdapter] ✅ Scenario 1 감지 완료 (${attempt * pollInterval / 1000}초): "${keyword}"`);
          return 'directAdd';
        }
      }

      // Scenario 2 감지
      for (const keyword of changeKeywords) {
        if (pageContent.includes(keyword)) {
          this.logger.info(`[YouTubePaymentAdapter] ✅ Scenario 2 감지 완료 (${attempt * pollInterval / 1000}초): "${keyword}"`);
          return 'changeAndAdd';
        }
      }

      // 진행 상황 로그 (5초마다)
      if (attempt % 10 === 0) {
        this.logger.info(`[YouTubePaymentAdapter] ⏳ 팝업 대기 중... (${attempt * pollInterval / 1000}초 경과)`);
      }

      // 다음 시도 전 대기
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // 감지 실패 - 상세 로그
    this.logger.error('[YouTubePaymentAdapter] ❌ 팝업 시나리오 감지 실패 (20초 타임아웃)');
    this.logger.error(`[YouTubePaymentAdapter] 사용 언어: ${lang}`);
    this.logger.error(`[YouTubePaymentAdapter] 시도한 Scenario 1 키워드: ${JSON.stringify(directAddKeywords)}`);
    this.logger.error(`[YouTubePaymentAdapter] 시도한 Scenario 2 키워드: ${JSON.stringify(changeKeywords)}`);

    // 페이지 URL 및 컨텐츠 일부 로그
    const currentUrl = this.page.url();
    const finalContent = await this.page.content();
    this.logger.error(`[YouTubePaymentAdapter] 현재 페이지 URL: ${currentUrl}`);
    this.logger.error(`[YouTubePaymentAdapter] 페이지 컨텐츠 미리보기 (500자): ${finalContent.substring(0, 500)}...`);

    return null;
  }

  /**
   * Scenario 1: 직접 추가 팝업 처리
   * @param {Object} card - 카드 객체
   * @param {Object} address - 주소 객체
   * @param {string} lang - 현재 언어 코드
   * @returns {Object} { success, scenario, card, address }
   */
  async handleDirectAddPopup(card, address, lang) {
    this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-11: 카드 정보 입력 (Scenario 1)');

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 1. 카드번호 입력
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔍 카드번호 입력 필드 찾는 중...');
      const cardNumberInput = await this.page.waitForSelector(
        'input[name*="cardnumber"], input[name*="card-number"], input[aria-label*="Card number"], input[autocomplete="cc-number"]',
        { timeout: 20000 } // ✅ 20초로 증가 (팝업 전환 시간 고려)
      );

      // 공백 제거하고 입력
      const cleanedCardNumber = card.cardNumber.replace(/[\s-]/g, '');
      await cardNumberInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await cardNumberInput.type(cleanedCardNumber, { delay: 100 });

      this.logger.info(`[YouTubePaymentAdapter] ✅ 카드번호 입력 완료: ${this.backupCardService.maskCardNumber(card.cardNumber)}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 2. 유효기간 입력 (MM/YY)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔍 유효기간 입력 필드 찾는 중...');
      const expiryInput = await this.page.waitForSelector(
        'input[name*="exp"], input[name*="expiry"], input[aria-label*="Expiration"], input[autocomplete="cc-exp"]',
        { timeout: 5000 }
      );

      await expiryInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await expiryInput.type(card.expiryDate, { delay: 100 });

      this.logger.info(`[YouTubePaymentAdapter] ✅ 유효기간 입력 완료: ${this.backupCardService.maskExpiryDate(card.expiryDate)}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 3. CVV 입력
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔍 CVV 입력 필드 찾는 중...');
      const cvvInput = await this.page.waitForSelector(
        'input[name*="cvc"], input[name*="cvv"], input[name*="security"], input[aria-label*="Security"], input[autocomplete="cc-csc"]',
        { timeout: 5000 }
      );

      await cvvInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await cvvInput.type(card.cvv, { delay: 100 });

      this.logger.info(`[YouTubePaymentAdapter] ✅ CVV 입력 완료: ${this.backupCardService.maskCVV(card.cvv)}`);

      // ⚠️ 중요: 카드소유자명(cardholderName)은 입력하지 않음
      // YouTube Premium 백업 결제수단 추가 팝업에는 해당 필드가 없음

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 4. 주소 정보 입력
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-12: 주소 정보 입력 (Scenario 1)');

      // 국가 선택 (Pakistan)
      this.logger.info('[YouTubePaymentAdapter] 🔍 국가 선택 드롭다운 찾는 중...');
      const countryDropdown = await this.page.waitForSelector(
        'select[name*="country"], select[aria-label*="Country"]',
        { timeout: 5000 }
      );

      await countryDropdown.select(address.country);
      await new Promise(resolve => setTimeout(resolve, 500));
      this.logger.info(`[YouTubePaymentAdapter] ✅ 국가 선택: ${address.country}`);

      // 도로명주소
      this.logger.info('[YouTubePaymentAdapter] 🔍 도로명주소 입력 필드 찾는 중...');
      const streetInput = await this.page.waitForSelector(
        'input[name*="address"], input[name*="street"], input[aria-label*="Street"], input[aria-label*="Address"]',
        { timeout: 5000 }
      );

      await streetInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await streetInput.type(address.streetAddress, { delay: 100 });
      this.logger.info(`[YouTubePaymentAdapter] ✅ 도로명주소 입력: ${address.streetAddress}`);

      // 도시
      this.logger.info('[YouTubePaymentAdapter] 🔍 도시 입력 필드 찾는 중...');
      const cityInput = await this.page.waitForSelector(
        'input[name*="city"], input[aria-label*="City"]',
        { timeout: 5000 }
      );

      await cityInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await cityInput.type(address.city, { delay: 100 });
      this.logger.info(`[YouTubePaymentAdapter] ✅ 도시 입력: ${address.city}`);

      // 우편번호
      this.logger.info('[YouTubePaymentAdapter] 🔍 우편번호 입력 필드 찾는 중...');
      const postalInput = await this.page.waitForSelector(
        'input[name*="postal"], input[name*="zip"], input[aria-label*="Postal"], input[aria-label*="ZIP"]',
        { timeout: 5000 }
      );

      await postalInput.click({ delay: 100 });
      await new Promise(resolve => setTimeout(resolve, 500));
      await postalInput.type(address.postalCode, { delay: 100 });
      this.logger.info(`[YouTubePaymentAdapter] ✅ 우편번호 입력: ${address.postalCode}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 5. 저장 버튼 클릭
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-13: 저장 버튼 클릭 (Scenario 1)');
      const langTexts = this.texts[lang] || this.texts['en'];
      const saveKeywords = langTexts.paymentMethod?.saveCard || ['Save', 'Confirm', 'Add'];

      this.logger.info('[YouTubePaymentAdapter] 🔍 저장 버튼 찾는 중...');
      const clickResult = await this.buttonService.clickButtonByTexts(
        this.page,
        saveKeywords,
        {
          description: 'Save',
          scrollIfNotFound: true
        }
      );

      if (!clickResult.clicked) {
        throw new Error('저장 버튼을 찾을 수 없습니다');
      }

      this.logger.info('[YouTubePaymentAdapter] ✅ 저장 버튼 클릭 완료');

      // 저장 완료 대기 (5초)
      this.logger.info('[YouTubePaymentAdapter] ⏳ 저장 완료 대기 (5초)...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      this.logger.info('[YouTubePaymentAdapter] ✅ Scenario 1 처리 완료');

      return {
        success: true,
        scenario: 'directAdd',
        card: card.cardName,
        address: address.addressName
      };
    } catch (error) {
      this.logger.error(`[YouTubePaymentAdapter] ❌ Scenario 1 처리 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * Scenario 2: 변경 후 추가 팝업 처리
   * @param {Object} card - 카드 객체
   * @param {Object} address - 주소 객체
   * @param {string} lang - 현재 언어 코드
   * @returns {Object} { success, scenario, card, address, reason? }
   */
  async handleChangeAndAddPopup(card, address, lang) {
    this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-14: "Update your payment method" 팝업 처리 (Scenario 2)');

    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // (1) "Use a different payment method" 라디오 버튼 클릭
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 📝 (1/3) "Use a different payment method" 라디오 버튼 클릭 중...');

      // ✅ 개선: Puppeteer의 실제 클릭 사용 (evaluate 대신)
      const useDifferentTexts = [
        'Use a different payment method',
        'Usar un método de pago diferente',
        'Использовать другой способ оплаты',
        'Usar um método de pagamento diferente',
        'Utiliser un autre mode de paiement',
        'Eine andere Zahlungsmethode verwenden',
        '別の支払い方法を使用',
        '使用其他付款方式',
        '使用其他付款方式'
      ];

      // 1단계: 모든 라디오 버튼 찾기
      const radioButtons = await this.page.$$('input[type="radio"]');
      this.logger.info(`[YouTubePaymentAdapter] 🔍 발견된 라디오 버튼: ${radioButtons.length}개`);

      let radioClicked = false;
      let clickedText = '';

      // 2단계: 각 라디오 버튼의 텍스트 확인 후 클릭
      for (let i = 0; i < radioButtons.length; i++) {
        const radio = radioButtons[i];

        // 라디오 버튼 주변 텍스트 확인
        const textNearby = await this.page.evaluate((radioEl) => {
          // 부모 요소들의 텍스트 확인 (최대 5단계)
          let parent = radioEl.parentElement;
          for (let j = 0; j < 5; j++) {
            if (!parent) break;
            const text = parent.textContent?.trim() || '';
            if (text.length > 0 && text.length < 500) {
              return text;
            }
            parent = parent.parentElement;
          }
          return '';
        }, radio);

        this.logger.info(`[YouTubePaymentAdapter] 📝 라디오 버튼 ${i + 1} 주변 텍스트: "${textNearby.substring(0, 100)}..."`);

        // "Use a different payment method" 텍스트 포함 여부 확인
        if (useDifferentTexts.some(keyword => textNearby.includes(keyword))) {
          // 이미 선택되어 있는지 확인
          const isChecked = await this.page.evaluate((radioEl) => radioEl.checked, radio);

          if (!isChecked) {
            this.logger.info(`[YouTubePaymentAdapter] ✅ 일치하는 라디오 버튼 발견 (${i + 1}/${radioButtons.length}), 클릭 시도...`);

            // ✅ Puppeteer 호환: evaluate로 스크롤
            await this.page.evaluate((radioEl) => {
              radioEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, radio);
            await new Promise(resolve => setTimeout(resolve, 500));

            // 실제 Puppeteer 클릭 사용 (사용자 클릭과 동일)
            await radio.click();
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 클릭 후 선택되었는지 확인
            const isNowChecked = await this.page.evaluate((radioEl) => radioEl.checked, radio);
            if (isNowChecked) {
              radioClicked = true;
              clickedText = textNearby.substring(0, 50);
              this.logger.info(`[YouTubePaymentAdapter] ✅ 라디오 버튼 선택 확인됨`);
              break;
            } else {
              this.logger.warn(`[YouTubePaymentAdapter] ⚠️ 클릭했지만 선택되지 않음, 다음 시도...`);
            }
          } else {
            this.logger.info(`[YouTubePaymentAdapter] ℹ️ 이미 선택되어 있음`);
            radioClicked = true;
            clickedText = textNearby.substring(0, 50);
            break;
          }
        }
      }

      if (!radioClicked) {
        throw new Error(`"Use a different payment method" 라디오 버튼을 찾을 수 없습니다`);
      }

      this.logger.info(`[YouTubePaymentAdapter] ✅ (1/3) 라디오 버튼 클릭 완료: ${clickedText}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // (2) 라디오 버튼 선택 후 대기
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const waitTime = 2000; // ✅ 2초로 변경 (이미 클릭 후 1초 대기했음)
      this.logger.info(`[YouTubePaymentAdapter] ⏳ (2/3) ${waitTime/1000}초 대기 중...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // (3) CONTINUE 버튼 클릭
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 📝 (3/3) CONTINUE 버튼 클릭 중...');

      const continueTexts = ['CONTINUE', 'CONTINUAR', 'ПРОДОЛЖИТЬ', 'CONTINUER', 'WEITER', '続ける', '继续', '繼續'];

      const continueResult = await this.buttonService.clickButtonByTexts(
        this.page,
        continueTexts,
        {
          description: 'CONTINUE button',
          scrollIfNotFound: false
        }
      );

      if (!continueResult.clicked) {
        throw new Error('CONTINUE 버튼을 찾을 수 없습니다');
      }

      this.logger.info(`[YouTubePaymentAdapter] ✅ (3/3) CONTINUE 버튼 클릭 완료: ${continueResult.text}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // (4) 카드 입력 팝업 대기 (충분히 대기)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const cardFormWaitTime = 3000; // ✅ 3초로 변경 (총 대기: 0.5 + 1 + 2 + 3 = 6.5초)
      this.logger.info(`[YouTubePaymentAdapter] ⏳ 카드 입력 팝업 대기 (${cardFormWaitTime/1000}초)...`);
      await new Promise(resolve => setTimeout(resolve, cardFormWaitTime));

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // (5) 카드 정보 입력 (Scenario 1과 동일)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-15: 카드 정보 입력 (Scenario 2)');
      this.logger.info('[YouTubePaymentAdapter] 📝 카드 정보 입력 중...');
      await this.handleDirectAddPopup(card, address, lang);

      this.logger.info('[YouTubePaymentAdapter] 🔧 Step 2-16: 백업 결제수단 추가 완료 (Scenario 2)');
      this.logger.info('[YouTubePaymentAdapter] ✅ Scenario 2 처리 완료');

      return {
        success: true,
        scenario: 'changeAndAdd',
        card: card.cardName,
        address: address.addressName
      };
    } catch (error) {
      this.logger.error(`[YouTubePaymentAdapter] ❌ Scenario 2 처리 실패: ${error.message}`);
      throw error;
    }
  }
}

module.exports = YouTubePaymentAdapter;
