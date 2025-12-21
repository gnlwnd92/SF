/**
 * ResumeWorkflow - 리팩터링된 재개 워크플로우
 * 
 * BaseWorkflow를 상속받아 재개 특화 로직만 구현
 * 공통 기능은 모두 베이스 클래스와 서비스에 위임
 */

const BaseWorkflow = require('../core/BaseWorkflow');
const ButtonInteractionService = require('../services/ButtonInteractionService');
const PopupService = require('../services/PopupService');
const { languages } = require('../infrastructure/config/multilanguage');

class ResumeWorkflow extends BaseWorkflow {
  constructor(dependencies) {
    super(dependencies);
    
    this.workflowType = 'resume';
    
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
  }

  /**
   * 현재 상태 확인 - 재개 가능 여부
   */
  async checkCurrentState() {
    this.log('멤버십 상태 확인', 'info');
    
    const page = this.context.page;
    const lang = languages[this.context.language];
    
    // 멤버십 관리 버튼 클릭
    await this.services.button.clickManageButton(page, this.context.language);
    
    // 상태 확인
    const status = await page.evaluate((langData) => {
      const pageText = document.body?.textContent || '';
      const result = {
        isActive: false,
        isPaused: false,
        hasResumeButton: false,
        hasPauseButton: false,
        nextBillingDate: null,
        detectionReasons: []  // 판단 근거 배열 추가
      };

      // 버튼 확인
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (!btnText) continue;

        // Resume 버튼이 있으면 일시중지 상태 (재개 가능)
        if (langData.buttons.resume.some(resumeText => btnText.includes(resumeText))) {
          result.hasResumeButton = true;
          result.isPaused = true;
          result.detectionReasons.push('Resume 버튼 발견');
        }

        // Pause 버튼이 있으면 이미 활성 상태
        if (langData.buttons.pause.some(pauseText => btnText.includes(pauseText))) {
          result.hasPauseButton = true;
          result.isActive = true;
          result.detectionReasons.push('Pause 버튼 발견');
        }
      }

      // Next Billing Date 패턴 확인
      if (result.isActive && /Next billing date|다음 결제일|Próxima fecha/i.test(pageText)) {
        result.detectionReasons.push('Next Billing Date 패턴');
      }

      // 날짜 정보 추출
      const datePattern = /\d{4}[\.\/-]\s*\d{1,2}[\.\/-]\s*\d{1,2}|[A-Za-z]+\s+\d{1,2},?\s*\d{4}/gi;
      const dates = pageText.match(datePattern);
      if (dates && dates.length > 0) {
        result.nextBillingDate = dates[0];
      }

      return result;
    }, lang);
    
    this.log(`상태: ${status.isActive ? '활성' : status.isPaused ? '일시중지됨' : '확인불가'}`, 'info');
    
    return status;
  }

  /**
   * 워크플로우 실행 - 재개 프로세스
   */
  async executeWorkflow() {
    const currentState = this.context.getState();
    
    // 이미 활성 상태인 경우
    if (currentState.isActive) {
      const reasons = currentState.detectionReasons || ['Pause 버튼 존재'];
      this.log(`이미 활성 상태입니다 (근거: ${reasons.join(', ')})`, 'warning');
      return {
        success: true,
        status: 'already_active',
        nextBillingDate: currentState.nextBillingDate,
        detectionReason: reasons.join(', ')  // 판단 근거 포함
      };
    }
    
    // 재개 불가능한 경우
    if (!currentState.isPaused || !currentState.hasResumeButton) {
      this.log('재개할 수 없는 상태입니다', 'error');
      return {
        success: false,
        status: 'cannot_resume',
        error: '일시중지된 멤버십이 없거나 재개 옵션이 없습니다'
      };
    }
    
    try {
      // 1. 재개 버튼 클릭
      this.log('재개 버튼 클릭', 'info');
      const resumeClicked = await this.services.button.clickResumeButton(
        this.context.page,
        this.context.language
      );
      
      if (!resumeClicked.clicked) {
        throw new Error('재개 버튼을 찾을 수 없습니다');
      }
      
      // 2. 팝업 처리
      this.log('확인 팝업 처리', 'info');
      const popupResult = await this.services.popup.handleResumePopup(
        this.context.page,
        this.context.language
      );
      
      if (!popupResult.handled) {
        this.log('팝업을 처리할 수 없습니다', 'warning');
        // 팝업이 없어도 계속 진행 (일부 계정은 팝업 없이 처리됨)
      } else {
        this.log('팝업 확인 완료', 'success');
      }
      
      // 3. 최종 상태 확인
      await this.context.new Promise(r => setTimeout(r, 3000)));
      const finalStatus = await this.verifyResumeSuccess();
      
      if (finalStatus.success) {
        return {
          success: true,
          status: 'resumed',
          resumeDate: popupResult.resumeDate || new Date().toISOString(),
          nextBillingDate: popupResult.nextBillingDate || finalStatus.nextBillingDate
        };
      } else {
        throw new Error('재개 검증 실패');
      }
      
    } catch (error) {
      this.log(`재개 실패: ${error.message}`, 'error');
      return {
        success: false,
        status: 'failed',
        error: error.message
      };
    }
  }

  /**
   * 재개 성공 검증
   */
  async verifyResumeSuccess() {
    this.log('재개 성공 여부 확인', 'info');
    
    // 페이지 새로고침
    await this.context.page.goto('https://www.youtube.com/paid_memberships', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await this.context.new Promise(r => setTimeout(r, 3000)));
    
    // 멤버십 관리 버튼 다시 클릭
    await this.services.button.clickManageButton(
      this.context.page,
      this.context.language
    );
    
    // Pause 버튼 확인 (활성 상태의 증거)
    const lang = languages[this.context.language];
    const status = await this.context.page.evaluate((langData) => {
      const result = {
        success: false,
        hasPauseButton: false,
        hasResumeButton: false,
        nextBillingDate: null
      };
      
      // 버튼 확인
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (!btnText) continue;
        
        // Pause 버튼이 있으면 활성 상태 (재개 성공)
        if (langData.buttons.pause.some(pauseText => btnText.includes(pauseText))) {
          result.hasPauseButton = true;
          result.success = true;
        }
        
        // Resume 버튼이 여전히 있으면 재개 실패
        if (langData.buttons.resume.some(resumeText => btnText.includes(resumeText))) {
          result.hasResumeButton = true;
        }
      }
      
      // 재개 성공 추가 확인
      const pageText = document.body?.textContent || '';
      const activeKeywords = ['활성', 'Active', '다음 결제', 'Next billing'];
      const hasActiveKeyword = activeKeywords.some(keyword => pageText.includes(keyword));
      
      if (!result.hasResumeButton && (result.hasPauseButton || hasActiveKeyword)) {
        result.success = true;
      }
      
      // 날짜 추출
      const datePattern = /\d{4}[\.\/-]\s*\d{1,2}[\.\/-]\s*\d{1,2}/;
      const dateMatch = pageText.match(datePattern);
      if (dateMatch) {
        result.nextBillingDate = dateMatch[0];
      }
      
      return result;
    }, lang);
    
    if (status.success) {
      this.log('재개 성공 확인됨', 'success');
    } else {
      this.log('재개 상태를 확인할 수 없습니다', 'warning');
    }
    
    return status;
  }

  /**
   * 결과 저장 - 재개 특화 (상세 로그 포함)
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
      
      // 시간만 추출 (오전/오후 포함)
      const hours = kstTime.getHours();
      const minutes = kstTime.getMinutes();
      const seconds = kstTime.getSeconds();
      const period = hours < 12 ? '오전' : '오후';
      const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const timeStr = `${period} ${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      
      // 언어 정보 가져오기
      const langData = languages[this.context.language || 'en'];
      const languageName = langData ? langData.name : (this.context.language || 'Unknown');
      
      // 다음 결제일 포맷팅
      const nextBilling = result.nextBillingDate || 'N/A';
      
      // 상세한 결과 메시지 생성 (일시중지 작업과 동일한 형식)
      let detailedResult = '';
      if (result.success) {
        if (result.status === 'already_active') {
          const reason = result.detectionReason || '상태 확인';
          detailedResult = `✅ 이미 활성 상태 (${reason}) | 언어: ${languageName} | 다음결제: ${nextBilling} | ${timeStr}`;
        } else if (result.status === 'resumed') {
          // 신규 재개인지 확인 (이전 상태가 일시중지였는지)
          const isNewResume = result.previousStatus === 'paused' || result.previousStatus === '일시중지';
          if (isNewResume) {
            detailedResult = `🆕 신규 재개 성공 | 언어: ${languageName} | 다음결제: ${nextBilling} | ${timeStr}`;
          } else {
            detailedResult = `✅ 재개 성공 | 언어: ${languageName} | 다음결제: ${nextBilling} | ${timeStr}`;
          }
        } else {
          detailedResult = `✅ 성공 | 언어: ${languageName} | 다음결제: ${nextBilling} | ${timeStr}`;
        }
      } else {
        if (result.status === 'cannot_resume') {
          detailedResult = `⚠️ 재개 불가 (일시중지 아님) | 언어: ${languageName} | ${timeStr}`;
        } else if (result.status === 'failed') {
          detailedResult = `❌ 재개 실패: ${result.error} | 언어: ${languageName} | ${timeStr}`;
        } else {
          detailedResult = `❌ 오류: ${result.error || '알 수 없음'} | 언어: ${languageName} | ${timeStr}`;
        }
      }
      
      const updateData = {
        status: result.success ? '결제중' : '오류',
        result: detailedResult,
        nextBillingDate: result.nextBillingDate || nextBilling
      };
      
      // reCAPTCHA 특수 처리
      if (result.status === 'recaptcha_required') {
        updateData.status = '번호인증필요';
        updateData.result = `🔐 번호인증 필요 | 언어: ${languageName} | ${timeStr}`;
      }
      
      // 로그 출력
      this.log(`Sheets 업데이트 데이터: ${JSON.stringify(updateData, null, 2)}`, 'debug');
      
      // pauseSheetRepository를 사용하는 경우
      if (this.sheetRepository.updatePauseStatus) {
        await this.sheetRepository.updatePauseStatus(
          this.context.profileId,
          updateData
        );
      } else {
        // 다른 repository 메서드 사용
        await this.sheetRepository.updateStatus(
          this.context.profileId,
          updateData
        );
      }
      
      this.log('Google Sheets 업데이트 완료 (상세 로그 포함)', 'success');
      
    } catch (error) {
      this.log(`Sheets 업데이트 실패: ${error.message}`, 'warning');
      // 실패해도 작업은 계속 진행
    }
  }
}

module.exports = ResumeWorkflow;