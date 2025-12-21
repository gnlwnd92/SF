/**
 * PauseWorkflow - 리팩터링된 일시중지 워크플로우
 * 
 * BaseWorkflow를 상속받아 일시중지 특화 로직만 구현
 * 공통 기능은 모두 베이스 클래스와 서비스에 위임
 */

const BaseWorkflow = require('../core/BaseWorkflow');
const ButtonInteractionService = require('../services/ButtonInteractionService');
const PopupService = require('../services/PopupService');
const FrameRecoveryService = require('../services/FrameRecoveryService');
const { languages } = require('../infrastructure/config/multilanguage');

class PauseWorkflow extends BaseWorkflow {
  constructor(dependencies) {
    super(dependencies);

    this.workflowType = 'pause';

    // 서비스 초기화
    if (!this.services.button) {
      this.services.button = new ButtonInteractionService({
        debugMode: this.context?.debugMode
      });
    }

    if (!this.services.popup) {
      this.services.popup = new PopupService({
        debugMode: this.context?.debugMode,
        buttonService: this.services.button
      });
    }

    // Frame Recovery 서비스 추가
    if (!this.services.frameRecovery) {
      this.services.frameRecovery = new FrameRecoveryService({
        debugMode: this.context?.debugMode,
        maxRetries: 3,
        retryDelay: 2000
      });
    }
  }

  /**
   * 현재 상태 확인 - 일시중지 가능 여부
   */
  async checkCurrentState() {
    this.log('멤버십 상태 확인', 'info');
    
    const page = this.context.page;
    const lang = languages[this.context.language];
    
    // 먼저 구독 만료 상태 체크
    const expiredCheck = await this.services.button.checkSubscriptionExpired(page);
    if (expiredCheck.expired) {
      this.log(`구독이 만료됨: ${expiredCheck.indicator}`, 'warning');
      return {
        isExpired: true,
        isPaused: false,
        isActive: false,
        hasResumeButton: false,
        hasPauseButton: false,
        expiredIndicator: expiredCheck.indicator
      };
    }
    
    // 멤버십 관리 버튼 클릭 (Frame-safe)
    this.log('[Frame Debug] 멤버십 관리 버튼 클릭 시작', 'debug');
    const clickResult = await this.services.frameRecovery.clickAndWaitForNavigation(
      page,
      async () => {
        return await this.services.button.clickManageButton(page, this.context.language);
      },
      { timeout: 10000 }
    );

    if (!clickResult.success) {
      this.log('[Frame Debug] 멤버십 관리 버튼 클릭 실패', 'warning');
    } else {
      this.log(`[Frame Debug] 클릭 성공 - 네비게이션: ${clickResult.navigated}, 팝업: ${clickResult.hasPopup}`, 'debug');
    }

    // 클릭 후 안정화 대기
    await this.services.frameRecovery.waitForStability(page, 3000);

    // 상태 확인 (Frame-safe evaluate)
    this.log('[Frame Debug] 상태 확인 시작', 'debug');
    const status = await this.services.frameRecovery.safeEvaluate(page, (langData) => {
      const pageText = document.body?.textContent || '';
      const result = {
        isPaused: false,
        isActive: false,
        hasResumeButton: false,
        hasPauseButton: false,
        resumeDate: null
      };
      
      // 버튼 확인
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (!btnText) continue;
        
        // Resume 버튼이 있으면 이미 일시중지 상태
        if (langData.buttons.resume.some(resumeText => btnText.includes(resumeText))) {
          result.hasResumeButton = true;
          result.isPaused = true;
        }
        
        // Pause 버튼이 있으면 활성 상태
        if (langData.buttons.pause.some(pauseText => btnText.includes(pauseText))) {
          result.hasPauseButton = true;
          result.isActive = true;
        }
      }
      
      // 날짜 정보 추출
      const datePattern = /\d{4}[\.\/-]\s*\d{1,2}[\.\/-]\s*\d{1,2}|[A-Za-z]+\s+\d{1,2},?\s*\d{4}/gi;
      const dates = pageText.match(datePattern);
      if (dates && dates.length > 0) {
        result.resumeDate = dates[0];
      }
      
      return result;
    }, lang);
    
    this.log(`상태: ${status.isPaused ? '일시중지됨' : status.isActive ? '활성' : '확인불가'}`, 'info');
    
    return status;
  }

  /**
   * 워크플로우 실행 - 일시중지 프로세스
   */
  async executeWorkflow() {
    const currentState = this.context.getState();
    
    // 구독이 만료된 경우
    if (currentState.isExpired) {
      this.log('구독이 만료되었습니다', 'error');
      return {
        success: false,
        status: 'subscription_expired',
        error: '구독 만료됨',
        expiredIndicator: currentState.expiredIndicator
      };
    }
    
    // 이미 일시중지 상태인 경우
    if (currentState.isPaused) {
      this.log('이미 일시중지 상태입니다', 'warning');
      return {
        success: true,
        status: 'already_paused',
        resumeDate: currentState.resumeDate
      };
    }
    
    // 일시중지 불가능한 경우
    if (!currentState.isActive || !currentState.hasPauseButton) {
      this.log('일시중지할 수 없는 상태입니다', 'error');
      return {
        success: false,
        status: 'cannot_pause',
        error: '활성 멤버십이 없거나 일시중지 옵션이 없습니다'
      };
    }
    
    try {
      // 1. 일시중지 버튼 클릭 (Frame-safe)
      this.log('일시중지 버튼 클릭', 'info');
      this.log('[Frame Debug] 일시중지 버튼 클릭 전 Frame 상태 확인', 'debug');

      const pauseClickResult = await this.services.frameRecovery.clickAndWaitForNavigation(
        this.context.page,
        async () => {
          const result = await this.services.button.clickPauseButton(
            this.context.page,
            this.context.language
          );
          if (!result.clicked) {
            throw new Error('일시중지 버튼을 찾을 수 없습니다');
          }
          return result;
        },
        { timeout: 15000 }
      );

      if (!pauseClickResult.success) {
        throw new Error(pauseClickResult.error || '일시중지 버튼 클릭 실패');
      }

      this.log(`[Frame Debug] 일시중지 버튼 클릭 완료 - 팝업: ${pauseClickResult.hasPopup}`, 'debug');

      // 2. 팝업 처리 (Frame-safe)
      this.log('확인 팝업 처리', 'info');

      // 팝업이 있는 경우에만 처리
      if (pauseClickResult.hasPopup) {
        this.log('[Frame Debug] 팝업 감지됨, 처리 시작', 'debug');

        // Frame 안정화 대기
        await this.services.frameRecovery.waitForStability(this.context.page, 2000);

        // Frame-safe 팝업 처리
        const popupResult = await this.services.frameRecovery.safeEvaluate(
          this.context.page,
          async () => {
            return await this.services.popup.handlePausePopup(
              this.context.page,
              this.context.language
            );
          }
        ).catch(err => {
          this.log(`[Frame Debug] 팝업 처리 중 오류: ${err.message}`, 'warning');
          return { handled: false, error: err.message };
        });

        if (popupResult.handled) {
          this.log('팝업 확인 완료', 'success');
        } else {
          this.log('팝업을 처리할 수 없습니다', 'warning');
        }
      } else {
        this.log('[Frame Debug] 팝업 없음, 다음 단계 진행', 'debug');
      }

      // 3. 최종 상태 확인
      await this.services.frameRecovery.waitForStability(this.context.page, 3000);
      const finalStatus = await this.verifyPauseSuccess();
      
      if (finalStatus.success) {
        return {
          success: true,
          status: 'paused',
          pauseDate: popupResult.pauseDate || new Date().toISOString(),
          resumeDate: popupResult.resumeDate || finalStatus.resumeDate,
          nextBillingDate: popupResult.resumeDate || finalStatus.resumeDate
        };
      } else {
        throw new Error('일시중지 검증 실패');
      }
      
    } catch (error) {
      this.log(`일시중지 실패: ${error.message}`, 'error');
      return {
        success: false,
        status: 'failed',
        error: error.message
      };
    }
  }

  /**
   * 일시중지 성공 검증
   */
  async verifyPauseSuccess() {
    this.log('일시중지 성공 여부 확인', 'info');
    this.log('[Frame Debug] 검증을 위한 페이지 새로고침', 'debug');

    // 페이지 새로고침
    await this.context.page.goto('https://www.youtube.com/paid_memberships', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    // Frame 안정화 대기
    await this.services.frameRecovery.waitForStability(this.context.page, 3000);

    // 멤버십 관리 버튼 다시 클릭 (Frame-safe)
    this.log('[Frame Debug] 검증을 위한 멤버십 관리 버튼 클릭', 'debug');
    const clickResult = await this.services.frameRecovery.clickAndWaitForNavigation(
      this.context.page,
      async () => {
        return await this.services.button.clickManageButton(
          this.context.page,
          this.context.language
        );
      },
      { timeout: 10000 }
    );

    if (!clickResult.success) {
      this.log('[Frame Debug] 검증용 멤버십 관리 버튼 클릭 실패', 'warning');
    }

    // Resume 버튼 확인 (Frame-safe)
    const lang = languages[this.context.language];
    const status = await this.services.frameRecovery.safeEvaluate(this.context.page, (langData) => {
      const result = {
        success: false,
        hasResumeButton: false,
        resumeDate: null
      };
      
      // Resume 버튼 확인
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText && langData.buttons.resume.some(resumeText => 
          btnText.includes(resumeText)
        )) {
          result.hasResumeButton = true;
          result.success = true;
          break;
        }
      }
      
      // 날짜 추출
      const pageText = document.body?.textContent || '';
      const datePattern = /\d{4}[\.\/-]\s*\d{1,2}[\.\/-]\s*\d{1,2}/;
      const dateMatch = pageText.match(datePattern);
      if (dateMatch) {
        result.resumeDate = dateMatch[0];
      }
      
      return result;
    }, lang);
    
    if (status.success) {
      this.log('일시중지 성공 확인됨', 'success');
    } else {
      this.log('일시중지 상태를 확인할 수 없습니다', 'warning');
    }
    
    return status;
  }

  /**
   * 결과 저장 - 일시중지 특화 (상세 로그 포함)
   */
  async saveResults(result) {
    if (!this.sheetRepository) {
      return;
    }
    
    try {
      await this.sheetRepository.initialize();
      
      // 현재 시간 (한국 시간)
      const now = new Date();
      const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const timestamp = kstTime.toISOString().replace('T', ' ').substring(0, 19);
      
      // 상세한 결과 메시지 생성
      let detailedResult = '';
      if (result.success) {
        if (result.status === 'already_paused') {
          detailedResult = `이미 일시중지 상태 (${timestamp})`;
        } else if (result.status === 'paused') {
          detailedResult = `일시중지 성공 (${timestamp})`;
        } else {
          detailedResult = `성공 (${timestamp})`;
        }
      } else {
        if (result.status === 'subscription_expired') {
          detailedResult = `❌ 결제 만료됨 - 수동 확인 필요 (${timestamp})`;
        } else if (result.status === 'cannot_pause') {
          detailedResult = `일시중지 불가 - 활성 멤버십 없음 (${timestamp})`;
        } else if (result.status === 'failed') {
          detailedResult = `일시중지 실패: ${result.error} (${timestamp})`;
        } else {
          detailedResult = `오류: ${result.error || '알 수 없는 오류'} (${timestamp})`;
        }
      }
      
      // 언어 정보와 추가 컨텍스트
      const languageInfo = languages[this.context.language];
      const languageName = languageInfo ? languageInfo.name : this.context.language;
      
      // 상세 노트 생성
      let detailedNote = [
        `언어: ${languageName}`,
        `프로필: ${this.context.profileId}`,
        `자동화 방식: Pause Workflow v2`,
        `처리 시간: ${timestamp}`
      ];
      
      // 날짜 정보 추가
      if (result.nextBillingDate) {
        detailedNote.push(`다음 결제일: ${result.nextBillingDate}`);
      }
      if (result.resumeDate) {
        detailedNote.push(`재개 예정일: ${result.resumeDate}`);
      }
      if (result.pauseDate) {
        detailedNote.push(`일시중지일: ${result.pauseDate}`);
      }
      
      // 특수 상태 추가
      if (result.status === 'already_paused') {
        detailedNote.push('특이사항: 이미 일시중지 상태였음');
      } else if (result.status === 'cannot_pause') {
        detailedNote.push('특이사항: 활성 멤버십이 없거나 일시중지 옵션 없음');
      } else if (result.status === 'subscription_expired') {
        detailedNote.push('특이사항: 구독이 만료됨');
      }
      
      const updateData = {
        status: result.status === 'subscription_expired' ? '만료됨' : (result.success ? '일시중지' : '오류'),
        result: detailedResult,
        nextBillingDate: result.nextBillingDate || result.resumeDate,
        note: detailedNote.join(' | ')
      };
      
      // reCAPTCHA 특수 처리
      if (result.status === 'recaptcha_required') {
        updateData.status = '번호인증필요';
        updateData.result = `번호인증 필요 (${timestamp})`;
        updateData.note = [
          'reCAPTCHA 감지',
          '수동 로그인 필요',
          `언어: ${languageName}`,
          `시도 시간: ${timestamp}`
        ].join(' | ');
      }
      
      // 로그 출력
      this.log(`Sheets 업데이트 데이터: ${JSON.stringify(updateData, null, 2)}`, 'debug');
      
      await this.sheetRepository.updatePauseStatus(
        this.context.profileId,
        updateData
      );
      
      this.log('Google Sheets 업데이트 완료 (상세 로그 포함)', 'success');
      
    } catch (error) {
      this.log(`Sheets 업데이트 실패: ${error.message}`, 'warning');
      // 실패해도 작업은 계속 진행
    }
  }
}

module.exports = PauseWorkflow;