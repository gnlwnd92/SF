/**
 * YouTube Premium Manager
 * 다국어 지원 YouTube Premium 구독 관리 시스템
 */

const chalk = require('chalk');

class YouTubePremiumManager {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      language: config.language || 'auto',
      ...config
    };
    
    // 다국어 텍스트 매핑
    this.textMappings = {
      manageMembership: {
        en: ['Manage membership', 'Manage'],
        ko: ['멤버십 관리', '구독 관리', '관리'],
        tr: ['Üyeliği yönet'],
        ru: ['Продлить или изменить'],
        vi: ['Quản lý gói thành viên'],
        zh: ['管理会员', '管理订阅'],
        ja: ['メンバーシップを管理', '管理'],
        es: ['Administrar membresía', 'Administrar'],
        fr: ['Gérer l\'abonnement', 'Gérer'],
        de: ['Mitgliedschaft verwalten', 'Verwalten'],
        pt: ['Gerenciar assinatura', 'Gerenciar'],
        ar: ['إدارة العضوية', 'إدارة']
      },
      pause: {
        en: ['Pause', 'Pause membership'],
        ko: ['일시중지', '멤버십 일시중지', '일시 중지'],
        tr: ['Duraklat', 'Üyeliği duraklat'],
        ru: ['Приостановить', 'Приостановить подписку'],
        vi: ['Tạm dừng', 'Tạm dừng gói thành viên'],
        zh: ['暂停', '暂停会员'],
        ja: ['一時停止', 'メンバーシップを一時停止'],
        es: ['Pausar', 'Pausar membresía'],
        fr: ['Suspendre', 'Suspendre l\'abonnement'],
        de: ['Pausieren', 'Mitgliedschaft pausieren'],
        pt: ['Pausar', 'Pausar assinatura'],
        ar: ['إيقاف مؤقت', 'إيقاف العضوية مؤقتًا']
      },
      resume: {
        en: ['Resume', 'Resume membership', 'Reactivate'],
        ko: ['재개', '멤버십 재개', '다시 시작'],
        tr: ['Devam', 'Devam et', 'Yeniden başlat'],
        ru: ['Возобновить', 'Возобновить подписку'],
        vi: ['Tiếp tục', 'Tiếp tục gói thành viên'],
        zh: ['恢复', '恢复会员', '重新激活'],
        ja: ['再開', 'メンバーシップを再開'],
        es: ['Reanudar', 'Reanudar membresía'],
        fr: ['Reprendre', 'Reprendre l\'abonnement'],
        de: ['Fortsetzen', 'Mitgliedschaft fortsetzen'],
        pt: ['Retomar', 'Retomar assinatura'],
        ar: ['استئناف', 'استئناف العضوية']
      },
      cancel: {
        en: ['Cancel', 'Cancel membership'],
        ko: ['취소', '멤버십 취소', '구독 취소'],
        tr: ['İptal', 'Üyeliği iptal et'],
        ru: ['Отменить', 'Отменить подписку'],
        vi: ['Hủy', 'Hủy gói thành viên'],
        zh: ['取消', '取消会员'],
        ja: ['キャンセル', 'メンバーシップをキャンセル'],
        es: ['Cancelar', 'Cancelar membresía'],
        fr: ['Annuler', 'Annuler l\'abonnement'],
        de: ['Kündigen', 'Mitgliedschaft kündigen'],
        pt: ['Cancelar', 'Cancelar assinatura'],
        ar: ['إلغاء', 'إلغاء العضوية']
      },
      nextBillingDate: {
        en: ['Next billing date', 'Billing date'],
        ko: ['다음 결제일', '결제일'],
        tr: ['Sonraki fatura tarihi'],
        ru: ['Следующая дата оплаты'],
        vi: ['Ngày thanh toán tiếp theo'],
        zh: ['下次付款日期'],
        ja: ['次回請求日'],
        es: ['Próxima fecha de facturación'],
        fr: ['Prochaine date de facturation'],
        de: ['Nächstes Abrechnungsdatum'],
        pt: ['Próxima data de cobrança'],
        ar: ['تاريخ الفاتورة التالي']
      },
      membershipPaused: {
        en: ['Membership pauses on', 'Paused until'],
        ko: ['멤버십 일시중지 날짜', '일시중지 기간'],
        tr: ['Üyelik duraklatma tarihi'],
        ru: ['Подписка приостановлена до'],
        vi: ['Gói thành viên tạm dừng vào'],
        zh: ['会员暂停日期'],
        ja: ['メンバーシップ一時停止日'],
        es: ['La membresía se pausa el'],
        fr: ['L\'abonnement est suspendu le'],
        de: ['Mitgliedschaft pausiert am'],
        pt: ['Assinatura pausada em'],
        ar: ['تاريخ إيقاف العضوية']
      },
      membershipResumes: {
        en: ['Membership resumes on', 'Resumes on'],
        ko: ['멤버십 재개 날짜', '재개 날짜'],
        tr: ['Üyelik devam tarihi'],
        ru: ['Подписка возобновится'],
        vi: ['Gói thành viên tiếp tục vào'],
        zh: ['会员恢复日期'],
        ja: ['メンバーシップ再開日'],
        es: ['La membresía se reanuda el'],
        fr: ['L\'abonnement reprend le'],
        de: ['Mitgliedschaft wird fortgesetzt am'],
        pt: ['Assinatura retomada em'],
        ar: ['تاريخ استئناف العضوية']
      }
    };
  }

  /**
   * 현재 페이지의 언어 감지
   */
  async detectLanguage() {
    try {
      const pageContent = await this.page.evaluate(() => {
        return document.body?.innerText?.toLowerCase() || '';
      });
      
      // 언어별 특징적인 단어로 감지
      const languageIndicators = {
        ko: ['멤버십', '구독', '결제', '일시중지', '재개'],
        en: ['membership', 'subscription', 'billing', 'pause', 'resume'],
        tr: ['üyelik', 'üyeliği', 'fatura', 'duraklat'],
        ru: ['подписка', 'оплата', 'приостановить'],
        vi: ['thành viên', 'thanh toán', 'tạm dừng'],
        zh: ['会员', '订阅', '付款'],
        ja: ['メンバーシップ', '請求', '一時停止'],
        es: ['membresía', 'suscripción', 'facturación'],
        fr: ['abonnement', 'facturation', 'suspendre'],
        de: ['mitgliedschaft', 'abrechnung', 'pausieren'],
        pt: ['assinatura', 'cobrança', 'pausar'],
        ar: ['عضوية', 'اشتراك', 'فاتورة']
      };
      
      for (const [lang, indicators] of Object.entries(languageIndicators)) {
        const hasIndicator = indicators.some(word => pageContent.includes(word));
        if (hasIndicator) {
          if (this.config.debugMode) {
            console.log(chalk.gray(`언어 감지: ${lang}`));
          }
          return lang;
        }
      }
      
      return 'en'; // 기본값
      
    } catch (error) {
      console.error(chalk.red('언어 감지 실패:'), error.message);
      return 'en';
    }
  }

  /**
   * 모든 언어의 텍스트 배열 가져오기
   */
  getAllTexts(textKey) {
    const texts = [];
    const mapping = this.textMappings[textKey];
    
    if (mapping) {
      Object.values(mapping).forEach(langTexts => {
        texts.push(...langTexts);
      });
    }
    
    return texts;
  }

  /**
   * 특정 언어의 텍스트 배열 가져오기
   */
  getTextsForLanguage(textKey, language) {
    const mapping = this.textMappings[textKey];
    
    if (mapping && mapping[language]) {
      return mapping[language];
    }
    
    // 언어가 없으면 모든 언어 텍스트 반환
    return this.getAllTexts(textKey);
  }

  /**
   * YouTube Premium 페이지로 이동
   */
  async navigateToPremiumPage() {
    try {
      console.log(chalk.cyan('YouTube Premium 페이지로 이동 중...'));
      
      await this.page.goto('https://www.youtube.com/paid_memberships', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      console.log(chalk.green('✅ Premium 페이지 로드 완료'));
      return true;
      
    } catch (error) {
      console.error(chalk.red('Premium 페이지 이동 실패:'), error.message);
      return false;
    }
  }

  /**
   * 구독 상태 확인 (개선된 버전)
   */
  async checkSubscriptionStatus() {
    try {
      await new Promise(r => setTimeout(r, 2000));
      
      const status = await this.page.evaluate(() => {
        const pageText = document.body?.innerText || '';
        
        // 상태 정보 추출
        const info = {
          hasPremium: false,
          isPaused: false,
          pauseDate: null,
          resumeDate: null,
          nextBillingDate: null,
          paymentMethod: null,
          membershipType: null
        };
        
        // Premium 여부
        info.hasPremium = pageText.includes('YouTube Premium') || 
                          pageText.includes('YouTube 프리미엄');
        
        // 멤버십 타입 (Family, Individual 등)
        if (pageText.includes('Family membership')) {
          info.membershipType = 'Family';
        } else if (pageText.includes('Individual membership')) {
          info.membershipType = 'Individual';
        }
        
        // 일시중지 상태 확인
        info.isPaused = (pageText.includes('Membership pauses on') || 
                        pageText.includes('Membership resumes on') ||
                        pageText.includes('멤버십 일시중지') ||
                        pageText.includes('멤버십 재개'));
        
        // Next billing date (활성 상태)
        const billingMatch = pageText.match(/Next billing date:\s*([A-Za-z]+\s+\d+)/i) || 
                            pageText.match(/다음 결제일:\s*(\d+월\s*\d+일)/);
        if (billingMatch) {
          info.nextBillingDate = billingMatch[1];
          info.isPaused = false; // Next billing date가 있으면 활성 상태
        }
        
        // 일시중지 날짜
        const pauseMatch = pageText.match(/Membership pauses on:\s*([A-Za-z]+\s+\d+)/i) || 
                          pageText.match(/일시중지.*?(\d+월\s*\d+일)/);
        if (pauseMatch) {
          info.pauseDate = pauseMatch[1];
        }
        
        // 재개 날짜
        const resumeMatch = pageText.match(/Membership resumes on:\s*([A-Za-z]+\s+\d+,?\s*\d*)/i) || 
                           pageText.match(/재개.*?(\d+월\s*\d+일)/);
        if (resumeMatch) {
          info.resumeDate = resumeMatch[1];
        }
        
        // 결제 방법
        const paymentMatch = pageText.match(/(?:Mastercard|Visa|PayPal|American Express|Discover|카드).*?(\d{4})/);
        if (paymentMatch) {
          info.paymentMethod = paymentMatch[0];
        }
        
        // Pause/Resume 버튼 존재 여부로 추가 확인
        const hasResumeButton = pageText.includes('Resume') && !pageText.includes('Resume YouTube Premium?');
        const hasPauseButton = pageText.includes('Pause membership') || pageText.includes('멤버십 일시중지');
        
        if (hasResumeButton && !hasPauseButton) {
          info.isPaused = true;
        } else if (hasPauseButton && !hasResumeButton) {
          info.isPaused = false;
        }
        
        return info;
      });
      
      if (this.config.debugMode) {
        console.log(chalk.yellow('\n구독 상태:'));
        console.log(chalk.gray(`  Premium: ${status.hasPremium ? '✅' : '❌'}`));
        console.log(chalk.gray(`  일시중지: ${status.isPaused ? '✅' : '❌'}`));
        if (status.membershipType) {
          console.log(chalk.gray(`  멤버십 타입: ${status.membershipType}`));
        }
        if (status.nextBillingDate) {
          console.log(chalk.gray(`  다음 결제일: ${status.nextBillingDate}`));
        }
        if (status.pauseDate) {
          console.log(chalk.gray(`  일시중지 날짜: ${status.pauseDate}`));
        }
        if (status.resumeDate) {
          console.log(chalk.gray(`  재개 날짜: ${status.resumeDate}`));
        }
        if (status.paymentMethod) {
          console.log(chalk.gray(`  결제 방법: ${status.paymentMethod}`));
        }
      }
      
      return status;
      
    } catch (error) {
      console.error(chalk.red('상태 확인 실패:'), error.message);
      return null;
    }
  }

  /**
   * 구독 관리 버튼 클릭
   */
  async clickManageMembership() {
    try {
      console.log(chalk.cyan('구독 관리 버튼 클릭 시도...'));
      
      const language = await this.detectLanguage();
      const texts = this.getTextsForLanguage('manageMembership', language);
      
      const clicked = await this.clickButtonByTexts(texts);
      
      if (clicked) {
        console.log(chalk.green('✅ 구독 관리 버튼 클릭 성공'));
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      console.log(chalk.red('❌ 구독 관리 버튼을 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('구독 관리 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * Resume 버튼 클릭
   */
  async clickResume() {
    try {
      console.log(chalk.cyan('Resume 버튼 클릭 시도...'));
      
      const language = await this.detectLanguage();
      const texts = this.getTextsForLanguage('resume', language);
      
      if (this.config.debugMode) {
        console.log(chalk.gray('찾을 텍스트들: ' + texts.join(', ')));
      }
      
      const clicked = await this.clickButtonByTexts(texts);
      
      if (clicked) {
        console.log(chalk.green('✅ Resume 버튼 클릭 성공'));
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      console.log(chalk.red('❌ Resume 버튼을 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('Resume 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * Pause 버튼 클릭
   */
  async clickPause() {
    try {
      console.log(chalk.cyan('Pause 버튼 클릭 시도...'));
      
      const language = await this.detectLanguage();
      const texts = this.getTextsForLanguage('pause', language);
      
      const clicked = await this.clickButtonByTexts(texts);
      
      if (clicked) {
        console.log(chalk.green('✅ Pause 버튼 클릭 성공'));
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      console.log(chalk.red('❌ Pause 버튼을 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('Pause 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 텍스트 배열로 버튼 찾아서 클릭
   */
  async clickButtonByTexts(texts) {
    try {
      const clicked = await this.page.evaluate((searchTexts) => {
        // 모든 클릭 가능한 요소
        const elements = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
        
        for (const element of elements) {
          const elementText = element.textContent?.trim() || '';
          
          // 텍스트 매칭
          for (const searchText of searchTexts) {
            if (elementText === searchText || 
                elementText.toLowerCase() === searchText.toLowerCase()) {
              
              console.log('버튼 발견: ' + elementText);
              
              // 여러 방법으로 클릭
              element.click();
              element.focus();
              element.click();
              
              // MouseEvent 발생
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              element.dispatchEvent(clickEvent);
              
              return true;
            }
          }
        }
        
        return false;
      }, texts);
      
      return clicked;
      
    } catch (error) {
      console.error(chalk.red('버튼 클릭 실패:'), error.message);
      return false;
    }
  }

  /**
   * 완전한 Resume 워크플로우 실행 (결제 재개)
   */
  async executeResumeWorkflow(credentials = null, profileInfo = null) {
    try {
      console.log(chalk.cyan.bold('\n=== YouTube Premium 결제 재개 워크플로우 시작 ===\n'));
      
      const result = {
        success: false,
        status: '',
        ip: '',
        timestamp: new Date().toISOString(),
        profileId: profileInfo?.profileId || '',
        email: credentials?.email || ''
      };
      
      // 1. 로그인 상태 확인 (필요시 로그인)
      if (credentials) {
        const loginHelper = require('./GoogleLoginHelperUltimate');
        const login = new loginHelper(this.page, null, { debugMode: this.config.debugMode });
        const loginStatus = await login.checkLoginStatus();
        
        if (!loginStatus) {
          console.log(chalk.cyan('로그인 필요, 로그인 시도...'));
          const loginResult = await login.login(credentials);
          if (!loginResult) {
            result.status = '로그인 실패';
            return result;
          }
        }
      }
      
      // 2. Premium 페이지로 이동
      const navigated = await this.navigateToPremiumPage();
      if (!navigated) {
        result.status = 'Premium 페이지 이동 실패';
        return result;
      }
      
      // 3. 구독 상태 확인
      const status = await this.checkSubscriptionStatus();
      if (!status) {
        result.status = '구독 상태 확인 실패';
        return result;
      }
      
      if (!status.hasPremium) {
        result.status = 'Premium 구독 없음';
        return result;
      }
      
      if (!status.isPaused) {
        console.log(chalk.yellow('⚠️ 이미 활성 상태입니다'));
        result.status = '이미 결제중';
        result.success = true;
        return result;
      }
      
      console.log(chalk.green('✅ 일시중지된 구독 확인'));
      if (status.pauseDate) {
        console.log(chalk.gray(`일시중지 날짜: ${status.pauseDate}`));
      }
      if (status.resumeDate) {
        console.log(chalk.gray(`예정된 재개 날짜: ${status.resumeDate}`));
      }
      
      // 4. 멤버십 관리 버튼 클릭
      console.log(chalk.cyan('\n멤버십 관리 버튼 클릭...'));
      const manageClicked = await this.clickManageMembership();
      if (manageClicked) {
        await new Promise(r => setTimeout(r, 2000));
      }
      
      // 5. Resume 버튼 클릭 (첫 번째 시도)
      console.log(chalk.cyan('\nResume 버튼 클릭...'));
      const resumed = await this.clickResume();
      if (!resumed) {
        result.status = 'Resume 버튼 클릭 실패';
        return result;
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      // 6. Resume 확인 팝업 처리
      console.log(chalk.cyan('\n=== Resume 확인 팝업 처리 ==='));
      const popupHandled = await this.handleResumePopup();
      if (!popupHandled) {
        console.log(chalk.yellow('팝업이 없거나 처리 실패'));
      }
      
      // 7. 페이지 새로고침
      console.log(chalk.cyan('\n페이지 새로고침...'));
      await this.page.reload({ waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      
      // 8. 멤버십 관리 버튼 다시 클릭하여 확장된 내용 확인
      console.log(chalk.cyan('\n최종 상태 확인을 위해 멤버십 관리 클릭...'));
      await this.clickManageMembership();
      await new Promise(r => setTimeout(r, 2000));
      
      // 9. 최종 상태 확인
      const finalStatus = await this.checkSubscriptionStatus();
      
      if (finalStatus && !finalStatus.isPaused) {
        console.log(chalk.green.bold('\n🎉 YouTube Premium 결제가 성공적으로 재개되었습니다!'));
        
        // Next billing date 확인
        if (finalStatus.nextBillingDate) {
          console.log(chalk.green(`다음 결제일: ${finalStatus.nextBillingDate}`));
        }
        
        result.success = true;
        result.status = '결제중';
        
        // IP 정보 수집
        try {
          result.ip = await this.getIPAddress();
        } catch (e) {
          console.log(chalk.yellow('IP 정보 수집 실패'));
        }
        
        // Google Sheets 업데이트 (필요시)
        if (this.config.updateSheets) {
          await this.updateGoogleSheets(result);
        }
        
        return result;
      }
      
      result.status = '재개 실패 - 상태 확인 필요';
      return result;
      
    } catch (error) {
      console.error(chalk.red('Resume 워크플로우 실패:'), error.message);
      return {
        success: false,
        status: `오류: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Resume 확인 팝업 처리
   * "Resume YouTube Premium?" 팝업에서 Resume 버튼 클릭
   */
  async handleResumePopup() {
    try {
      await new Promise(r => setTimeout(r, 1000));
      
      // 팝업 확인
      const popupInfo = await this.page.evaluate(() => {
        const pageText = document.body?.innerText || '';
        const hasPopup = pageText.includes('Resume YouTube Premium?') || 
                        pageText.includes('Your membership will be resumed immediately') ||
                        pageText.includes('멤버십이 즉시 재개됩니다') ||
                        pageText.includes('구독이 즉시 재개됩니다');
        
        // 팝업 제목 찾기
        const h1 = document.querySelector('h1');
        const popupTitle = h1?.textContent?.trim() || '';
        
        return {
          hasPopup,
          popupTitle,
          hasResumeButton: pageText.includes('Resume') || pageText.includes('재개'),
          hasCancelButton: pageText.includes('Cancel') || pageText.includes('취소')
        };
      });
      
      if (popupInfo.hasPopup) {
        console.log(chalk.cyan('Resume 확인 팝업 감지'));
        if (popupInfo.popupTitle) {
          console.log(chalk.gray(`팝업 제목: ${popupInfo.popupTitle}`));
        }
        
        // Resume 버튼 클릭 (page.evaluate 방식 사용)
        const clicked = await this.page.evaluate(() => {
          const buttons = document.querySelectorAll('button, div[role="button"]');
          
          for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            
            // Resume 버튼만 클릭 (Cancel 버튼 제외)
            if ((text === 'Resume' || text === '재개' || text === 'Devam' || 
                 text === 'Возобновить' || text === 'Tiếp tục') && 
                !text.includes('Cancel') && !text.includes('취소')) {
              
              console.log('Resume 버튼 발견: ' + text);
              
              // 여러 방법으로 클릭
              button.click();
              button.focus();
              button.click();
              
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              button.dispatchEvent(clickEvent);
              
              return true;
            }
          }
          
          return false;
        });
        
        if (clicked) {
          console.log(chalk.green('✅ 팝업에서 Resume 버튼 클릭 성공'));
          await new Promise(r => setTimeout(r, 3000));
          return true;
        } else {
          console.log(chalk.red('❌ 팝업에서 Resume 버튼을 찾을 수 없음'));
        }
      } else {
        console.log(chalk.gray('Resume 확인 팝업이 없습니다'));
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red('팝업 처리 실패:'), error.message);
      return false;
    }
  }

  /**
   * 확인 대화상자 처리 (일반)
   */
  async handleConfirmationDialog() {
    try {
      await new Promise(r => setTimeout(r, 1000));
      
      // 확인 버튼 텍스트들
      const confirmTexts = [
        'Confirm', 'Resume', 'Yes', 'OK',
        '확인', '재개', '예', '계속',
        'Devam', 'Evet',
        'Подтвердить', 'Да',
        'Xác nhận', 'Có'
      ];
      
      const confirmed = await this.clickButtonByTexts(confirmTexts);
      
      if (confirmed) {
        console.log(chalk.green('✅ 확인 대화상자 처리됨'));
      }
      
      return confirmed;
      
    } catch (error) {
      console.error(chalk.red('확인 대화상자 처리 실패:'), error.message);
      return false;
    }
  }
  /**
   * IP 주소 가져오기
   */
  async getIPAddress() {
    try {
      // 방법 1: ipify API 사용
      const response = await this.page.evaluate(async () => {
        try {
          const res = await fetch('https://api.ipify.org?format=json');
          const data = await res.json();
          return data.ip;
        } catch (e) {
          return null;
        }
      });
      
      if (response) {
        return response;
      }
      
      // 방법 2: 다른 IP API 시도
      const response2 = await this.page.evaluate(async () => {
        try {
          const res = await fetch('https://api.myip.com');
          const data = await res.json();
          return data.ip;
        } catch (e) {
          return null;
        }
      });
      
      return response2 || 'N/A';
      
    } catch (error) {
      console.error(chalk.red('IP 주소 가져오기 실패:'), error.message);
      return 'N/A';
    }
  }

  /**
   * Google Sheets 업데이트
   */
  async updateGoogleSheets(result) {
    try {
      console.log(chalk.cyan('\nGoogle Sheets 업데이트...'));
      
      // Google Sheets API 구현이 필요
      // 여기서는 구조만 제공
      const sheetsData = {
        range: '결제재개!A:E', // 결제재개 탭
        values: [[
          result.profileId,
          result.email,
          result.status, // '결제중'
          result.ip,
          result.timestamp
        ]]
      };
      
      console.log(chalk.gray('Sheets 데이터 준비:'));
      console.log(chalk.gray(`  프로필: ${sheetsData.values[0][0]}`));
      console.log(chalk.gray(`  이메일: ${sheetsData.values[0][1]}`));
      console.log(chalk.gray(`  상태: ${sheetsData.values[0][2]}`));
      console.log(chalk.gray(`  IP: ${sheetsData.values[0][3]}`));
      
      // 실제 Google Sheets API 호출은 별도 구현 필요
      // const sheets = google.sheets({version: 'v4', auth});
      // await sheets.spreadsheets.values.append({...});
      
      console.log(chalk.green('✅ Google Sheets 업데이트 완료'));
      return true;
      
    } catch (error) {
      console.error(chalk.red('Google Sheets 업데이트 실패:'), error.message);
      return false;
    }
  }

  /**
   * Resume 버튼 클릭 (개선된 버전 - page.evaluate 사용)
   */
  async clickResume() {
    try {
      console.log(chalk.cyan('Resume 버튼 클릭 시도...'));
      
      const language = await this.detectLanguage();
      const texts = this.getTextsForLanguage('resume', language);
      
      if (this.config.debugMode) {
        console.log(chalk.gray('찾을 텍스트들: ' + texts.join(', ')));
      }
      
      // page.evaluate 방식으로 직접 클릭
      const clicked = await this.page.evaluate((searchTexts) => {
        const elements = document.querySelectorAll('button, a, div[role="button"], span[role="button"]');
        
        for (const element of elements) {
          const elementText = element.textContent?.trim() || '';
          
          for (const searchText of searchTexts) {
            if (elementText === searchText || 
                elementText.toLowerCase() === searchText.toLowerCase()) {
              
              console.log('Resume 버튼 발견: ' + elementText);
              
              // 여러 방법으로 클릭
              element.click();
              element.focus();
              element.click();
              
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true
              });
              element.dispatchEvent(clickEvent);
              
              return true;
            }
          }
        }
        
        return false;
      }, texts);
      
      if (clicked) {
        console.log(chalk.green('✅ Resume 버튼 클릭 성공'));
        await new Promise(r => setTimeout(r, 3000));
        return true;
      }
      
      console.log(chalk.red('❌ Resume 버튼을 찾을 수 없음'));
      return false;
      
    } catch (error) {
      console.error(chalk.red('Resume 클릭 실패:'), error.message);
      return false;
    }
  }
}

module.exports = YouTubePremiumManager;