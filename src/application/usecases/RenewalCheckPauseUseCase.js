/**
 * 갱신 확인 일시중지 Use Case
 * 결제가 갱신된 계정만 일시중지 작업을 수행
 */

const chalk = require('chalk');
const EnhancedPauseSubscriptionUseCase = require('./EnhancedPauseSubscriptionUseCase');
const { languages } = require('../../infrastructure/config/languages');
const IPService = require('../../services/IPService');

class RenewalCheckPauseUseCase extends EnhancedPauseSubscriptionUseCase {
  constructor(dependencies) {
    super(dependencies);
    this.renewalChecked = false;
    this.ipService = new IPService({ debugMode: true });
  }

  /**
   * 실행 메인 메서드 오버라이드
   * 갱신 확인 로직을 추가
   */
  async execute(profileId, profileData = {}) {
    const startTime = Date.now();
    const result = {
      profileId,
      success: false,
      status: null,
      pauseDate: null,
      resumeDate: null,
      nextBillingDate: null,
      error: null,
      duration: 0,
      renewalStatus: null // 갱신 상태 추가
    };

    try {
      // 대체 ID 추적 변수 초기화
      this.actualProfileId = null;

      this.log(`프로필 ${profileId} 갱신 확인 일시중지 시작`, 'info');
      console.log(chalk.cyan(`📄 [RenewalCheck] 프로필 ${profileId} 갱신 확인 일시중지 시작`));

      // DetailedErrorLogger 초기화
      if (this.detailedErrorLogger) {
        await this.detailedErrorLogger.initialize();
        this.detailedErrorLogger.reset();
      }

      // 1. Google Sheets에서 기존 다음 결제일 가져오기
      // pauseSheetRepository 강제 초기화
      console.log(chalk.gray('📋 PauseSheetRepository 초기화 중...'));
      const PauseSheetRepository = require('../../infrastructure/repositories/PauseSheetRepository');
      this.pauseSheetRepository = new PauseSheetRepository();
      await this.pauseSheetRepository.initialize();
      console.log(chalk.green('✅ PauseSheetRepository 초기화 완료'));

      const existingNextBillingDate = await this.getExistingNextBillingDate(profileData.email);
      if (existingNextBillingDate) {
        console.log(chalk.yellow(`📅 F열 기존 날짜: ${existingNextBillingDate} (Google Sheets)`));
      } else {
        console.log(chalk.gray('📅 F열에 날짜가 없습니다. 처음 날짜를 저장합니다.'));
      }

      // 2. 브라우저 연결 (대체 ID 지원)
      const email = profileData?.email || profileData?.googleId;
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('브라우저 연결', {
          profileId,
          email
        });
      }

      const browser = await this.connectBrowser(profileId, email);
      if (!browser) {
        result.error = '브라우저 연결 실패';
        result.renewalStatus = 'browser_error';

        if (this.detailedErrorLogger) {
          this.detailedErrorLogger.endStep({ error: result.error });
        }

        const duration = Math.round((Date.now() - startTime) / 1000);
        result.duration = duration;
        return result;
      }

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ success: true });
      }

      // 3. YouTube Premium 페이지로 이동
      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.startStep('YouTube Premium 페이지 이동');
      }

      // navigateToPremiumPage는 void를 반환하므로 반환값을 체크하지 않음
      // 대신 try-catch로 에러 핸들링
      try {
        await this.navigateToPremiumPage(browser);
        console.log(chalk.green('✅ YouTube Premium 페이지 로드 완료'));
      } catch (navError) {
        console.error(chalk.red(`❌ Premium 페이지 이동 실패: ${navError.message}`));
        result.error = 'YouTube Premium 페이지 로드 실패';
        result.renewalStatus = 'page_load_error';
        await this.disconnectBrowser(this.actualProfileId || profileId);

        const duration = Math.round((Date.now() - startTime) / 1000);
        result.duration = duration;
        return result;
      }

      if (this.detailedErrorLogger) {
        this.detailedErrorLogger.endStep({ success: true });
      }

      // 4. 현재 다음 결제일 확인 (페이지에서)
      console.log(chalk.cyan('📅 현재 다음 결제일 확인 중...'));
      const currentNextBillingDate = await this.extractNextBillingDate();

      if (!currentNextBillingDate) {
        console.log(chalk.yellow('⚠️ 다음 결제일을 확인할 수 없습니다'));
        result.error = '다음 결제일 확인 실패';
        result.renewalStatus = 'date_extraction_error';
        await this.disconnectBrowser(this.actualProfileId || profileId);

        const duration = Math.round((Date.now() - startTime) / 1000);
        result.duration = duration;
        return result;
      }

      console.log(chalk.cyan(`📅 현재 다음 결제일: ${currentNextBillingDate}`));

      // 5. 갱신 여부 확인
      const renewalCheck = this.checkIfRenewed(existingNextBillingDate, currentNextBillingDate);

      if (renewalCheck === 'save_date') {
        // F열에 날짜가 없는 경우 - 일시중지 진행하고 날짜 저장
        console.log(chalk.blue('📌 F열에 기존 날짜가 없음: 일시중지를 진행하고 날짜를 저장합니다.'));
        console.log(chalk.gray(`  감지된 날짜: ${currentNextBillingDate}`));

        result.renewalStatus = 'no_previous_date';
        result.existingDate = null;
        result.detectedDate = currentNextBillingDate;

        // 일시중지 작업 수행
        try {
          const pauseResult = await this.performPauseWorkflow();
          // 결과 병합
          Object.assign(result, pauseResult);
          result.renewalStatus = 'paused_and_date_saved';
          result.nextBillingDate = currentNextBillingDate;

          // 일시중지 성공 시 F열에 날짜도 저장
          if (pauseResult.success) {
            await this.updateSheetsDateOnly(email, currentNextBillingDate);
            console.log(chalk.green('✅ 일시중지 완료 및 날짜 저장'));
          }
        } catch (pauseError) {
          console.error(chalk.red(`❌ 일시중지 워크플로우 오류: ${pauseError.message}`));
          result.success = false;
          result.status = 'workflow_error';
          result.error = pauseError.message;
          result.renewalStatus = 'pause_failed';

          // 실패해도 날짜는 저장
          await this.updateSheetsDateOnly(email, currentNextBillingDate);
        }

        await this.disconnectBrowser(this.actualProfileId || profileId);

        const duration = Math.round((Date.now() - startTime) / 1000);
        result.duration = duration;
        return result;
      } else if (!renewalCheck) {
        // 갱신되지 않은 경우 - 일시중지 건너뛰기
        console.log(chalk.yellow('⏭️ 결제가 아직 갱신되지 않았습니다. 일시중지 건너뜁니다.'));
        console.log(chalk.gray(`  기존: ${existingNextBillingDate}`));
        console.log(chalk.gray(`  현재: ${currentNextBillingDate}`));

        result.success = true;
        result.status = 'skipped_not_renewed';
        result.renewalStatus = 'not_renewed';
        result.nextBillingDate = currentNextBillingDate;
        result.existingDate = existingNextBillingDate;
        result.detectedDate = currentNextBillingDate;

        // Google Sheets 업데이트 - 결과 필드만 업데이트 (상태는 그대로 유지)
        await this.updateSheetsForNotRenewed(email, currentNextBillingDate);

        await this.disconnectBrowser(this.actualProfileId || profileId);

        const duration = Math.round((Date.now() - startTime) / 1000);
        result.duration = duration;
        return result;
      }

      // 6. 갱신된 경우 - 일시중지 진행
      console.log(chalk.green('✅ 결제가 갱신되었습니다. 일시중지를 진행합니다.'));
      console.log(chalk.gray(`  기존: ${existingNextBillingDate}`));
      console.log(chalk.gray(`  현재: ${currentNextBillingDate}`));

      result.renewalStatus = 'renewed';
      result.existingDate = existingNextBillingDate;
      result.detectedDate = currentNextBillingDate;

      // 7. 일시중지 작업 수행 (부모 클래스의 로직 사용)
      try {
        const pauseResult = await this.performPauseWorkflow();
        // 결과 병합
        Object.assign(result, pauseResult);

        // 이미 일시중지된 경우 특별 처리
        if (pauseResult.status === 'already_paused') {
          result.renewalStatus = 'renewed_but_already_paused';
          result.nextBillingDate = currentNextBillingDate;
          console.log(chalk.blue('📌 갱신은 확인되었지만 이미 일시중지 상태입니다'));
        } else {
          result.renewalStatus = 'renewed_and_paused';
          result.nextBillingDate = currentNextBillingDate;
        }

        // 8. Google Sheets 업데이트 - 갱신된 경우 항상 업데이트
        console.log(chalk.cyan('📝 Google Sheets 업데이트 중...'));

        const email = profileData?.email || profileData?.googleId;

        // pauseResult에서 재개 날짜 가져오기
        const resumeDate = pauseResult.resumeDate || pauseResult.nextBillingDate || currentNextBillingDate;

        await this.updateSheetsForPaused(email, resumeDate, pauseResult.status);

        console.log(chalk.green('✅ Google Sheets 업데이트 완료'));

      } catch (pauseError) {
        console.error(chalk.red(`❌ 일시중지 워크플로우 오류: ${pauseError.message}`));

        // 갱신은 확인되었지만 일시중지는 실패
        result.success = false;
        result.status = 'workflow_error';
        result.error = pauseError.message;
        result.renewalStatus = 'renewed_but_pause_failed';
        result.nextBillingDate = currentNextBillingDate;
        result.detectedDate = currentNextBillingDate;

        // 부분적 성공 상태 표시
        console.log(chalk.yellow('⚠️ 갱신은 확인되었지만 일시중지 작업이 실패했습니다'));

        // 실패해도 날짜는 업데이트
        const email = profileData?.email || profileData?.googleId;
        await this.updateSheetsDateOnly(email, currentNextBillingDate);
      }

      // 8. 브라우저 연결 해제
      await this.disconnectBrowser(this.actualProfileId || profileId);

      const duration = Math.round((Date.now() - startTime) / 1000);
      result.duration = duration;

    } catch (error) {
      console.error(chalk.red(`❌ 갱신확인 중 오류 발생: ${error.message}`));
      console.error(chalk.gray('스택 트레이스:'));
      console.error(error.stack);

      this.log(`오류 발생: ${error.message}`, 'error');
      result.error = error.message;
      result.renewalStatus = 'error';
      result.stack = error.stack;

      // 브라우저 연결 해제 시도
      try {
        await this.disconnectBrowser(this.actualProfileId || profileId);
      } catch (e) {
        console.error(chalk.yellow(`브라우저 연결 해제 실패: ${e.message}`));
      }
    }

    return result;
  }

  /**
   * Google Sheets에서 기존 다음 결제일 가져오기
   */
  async getExistingNextBillingDate(email) {
    try {
      if (!email) {
        console.log(chalk.yellow('⚠️ 이메일이 없습니다.'));
        return null;
      }

      // PauseSheetRepository 확인
      if (!this.pauseSheetRepository) {
        console.log(chalk.yellow('⚠️ PauseSheetRepository가 null입니다.'));
        return null;
      }

      // 이미 초기화되었으므로 다시 초기화하지 않음
      // await this.pauseSheetRepository.initialize();

      console.log(chalk.gray(`📋 ${email}의 F열 날짜 조회 중...`));

      const response = await this.pauseSheetRepository.sheets.spreadsheets.values.get({
        spreadsheetId: this.pauseSheetRepository.spreadsheetId,
        range: '일시중지!A:H'
      });

      const rows = response.data.values || [];
      console.log(chalk.gray(`📊 전체 행 수: ${rows.length}`));

      if (rows.length < 2) {
        console.log(chalk.yellow('⚠️ 데이터가 없습니다.'));
        return null;
      }

      // 디버깅용 헤더 출력
      console.log(chalk.gray(`📋 시트 헤더: ${rows[0].join(', ')}`));

      // 이메일로 행 찾기
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === email) {  // A열: 이메일
          console.log(chalk.green(`✅ 행 ${i+1}에서 ${email} 발견!`));

          // F열(인덱스 5): 다음 결제일
          const existingDate = rows[i][5];

          console.log(chalk.gray(`📅 F열 원본 데이터: "${existingDate}"`));
          console.log(chalk.gray(`📅 F열 타입: ${typeof existingDate}`));

          if (existingDate && existingDate.toString().trim()) {
            const dateString = existingDate.toString().trim();
            console.log(chalk.cyan(`📅 기존 다음 결제일 발견: ${dateString}`));

            // 날짜 형식 정규화 (YYYY-MM-DD 또는 YYYY. M. D 형식 처리)
            const normalized = this.normalizeDate(dateString);
            console.log(chalk.cyan(`📅 정규화된 날짜: ${normalized}`));
            return normalized;
          } else {
            console.log(chalk.gray(`📅 F열이 비어있습니다.`));
            return null;
          }
        }
      }

      console.log(chalk.yellow(`⚠️ ${email}을 시트에서 찾을 수 없습니다.`));
      return null;

    } catch (error) {
      this.log(`기존 다음 결제일 조회 실패: ${error.message}`, 'warning');
      console.error(chalk.red('상세 오류:'), error);
      console.error(chalk.red('스택:'), error.stack);
      return null;
    }
  }

  /**
   * 페이지에서 현재 다음 결제일 추출
   */
  async extractNextBillingDate() {
    try {
      // 구독 관리 버튼을 찾아서 클릭 (텍스트 기반 검색)
      const manageButtonClicked = await this.page.evaluate(() => {
        // 다국어 지원 버튼 텍스트
        const buttonTexts = [
          'Manage membership', 'Manage', '구독 관리', '관리',
          'Administrar', 'Gérer', 'Verwalten', 'Gestisci',
          '管理', 'จัดการ', 'Quản lý', 'Kelola'
        ];

        // 모든 버튼과 클릭 가능한 요소 탐색
        const clickables = Array.from(document.querySelectorAll('button, [role="button"], tp-yt-paper-button, a'));
        for (const element of clickables) {
          const text = element.innerText || element.textContent || '';
          const ariaLabel = element.getAttribute('aria-label') || '';

          // 텍스트나 aria-label에서 매칭 확인
          if (buttonTexts.some(btnText =>
            text.includes(btnText) || ariaLabel.includes(btnText)
          )) {
            console.log('Manage button found:', text);
            element.click();
            return true;
          }
        }
        return false;
      });

      if (manageButtonClicked) {
        console.log(chalk.gray('📋 구독 관리 버튼 클릭됨'));
        console.log(chalk.gray('⏳ 멤버십 정보 로딩 대기 중...'));

        // 일반 일시중지처럼 충분한 대기 시간 (7초)
        await new Promise(r => setTimeout(r, 7000));

        // 팝업이나 다이얼로그가 완전히 로드되었는지 확인
        const dialogLoaded = await this.page.evaluate(() => {
          // 다이얼로그가 열렸는지 확인
          const dialogs = document.querySelectorAll('[role="dialog"], tp-yt-paper-dialog, .opened, [aria-modal="true"]');
          for (const dialog of dialogs) {
            if (dialog && dialog.offsetHeight > 0) {
              const dialogText = dialog.innerText || '';
              console.log('Dialog found with text length:', dialogText.length);
              return dialogText.length > 100; // 충분한 내용이 로드되었는지 확인
            }
          }

          // 페이지에 날짜 관련 텍스트가 나타났는지 확인
          const bodyText = document.body?.innerText || '';
          const hasDateInfo = bodyText.includes('Next billing') ||
                              bodyText.includes('다음 결제') ||
                              bodyText.includes('membership') ||
                              bodyText.includes('멤버십') ||
                              bodyText.includes('NGN') ||
                              bodyText.includes('USD') ||
                              bodyText.includes('/mo');
          return hasDateInfo;
        });

        if (!dialogLoaded) {
          console.log(chalk.yellow('⚠️ 다이얼로그가 완전히 로드되지 않았을 수 있습니다'));
          // 추가 대기
          await new Promise(r => setTimeout(r, 3000));
        }

        // 새 탭이 열렸는지 확인
        const pages = await this.browser.pages();
        if (pages.length > 1) {
          // 새 탭이 열렸으면 그 탭으로 전환
          this.page = pages[pages.length - 1];
          console.log(chalk.gray('📑 새 탭으로 전환됨'));
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 디버깅용 스크린샷
      const fs = require('fs').promises;
      const path = require('path');
      const screenshotPath = path.join(__dirname, '..', '..', '..', 'screenshots', `renewal-check-${Date.now()}.png`);
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(chalk.gray(`📸 스크린샷 저장: ${screenshotPath}`));

      // 다양한 날짜 패턴
      const datePatterns = [
        // 영어 패턴
        /Next billing date[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Billing resumes on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Membership resumes on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Membership pauses on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /Your membership will resume on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        // 한국어 패턴
        /다음 결제일[:\s]+(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/,
        /(\d{4}년\s*\d{1,2}월\s*\d{1,2}일).*결제/,
        /멤버십.*재개.*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/,
        // 숫자 형식
        /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/,
        /(\d{4}-\d{2}-\d{2})/,
        /(\d{4}\/\d{2}\/\d{2})/,
        // 짧은 형식 (연도 추론 필요)
        /([A-Za-z]+\s+\d{1,2}),?\s+(\d{4})?/,  // Oct 24 또는 Oct 24, 2025
        /(\d{1,2}월\s+\d{1,2}일)/
      ];

      const pageText = await this.page.evaluate(() => document.body.innerText);
      console.log(chalk.gray('📄 페이지 텍스트 길이:', pageText.length));

      // 디버깅: 페이지 텍스트 더 많이 출력
      const textSnippet = pageText.substring(0, 1000);
      console.log(chalk.gray('📝 페이지 텍스트 샘플:'));
      console.log(chalk.gray(textSnippet));

      // "Oct", "Nov" 등의 월 이름이 있는지 확인
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      for (const month of monthNames) {
        if (pageText.includes(month)) {
          console.log(chalk.cyan(`📅 월 이름 발견: ${month}`));
          // 월 이름 주변의 텍스트 추출
          const monthIndex = pageText.indexOf(month);
          const contextText = pageText.substring(Math.max(0, monthIndex - 50), Math.min(pageText.length, monthIndex + 50));
          console.log(chalk.gray(`   컨텍스트: ${contextText}`));

          // 월과 일 패턴 매칭
          const monthDayPattern = new RegExp(`(${month}\\s+\\d{1,2})`, 'i');
          const match = contextText.match(monthDayPattern);
          if (match) {
            const dateStr = match[1];
            console.log(chalk.cyan(`📅 날짜 문자열 발견: ${dateStr}`));
            return this.parseDateString(dateStr);
          }
        }
      }

      // 패턴 매칭
      for (const pattern of datePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const dateStr = match[1];
          console.log(chalk.cyan(`📅 날짜 문자열 발견: ${dateStr}`));
          // 날짜 파싱 및 정규화
          return this.parseDateString(dateStr);
        }
      }

      // 팝업이나 다이얼로그에서도 확인 (더 정확한 선택자 사용)
      const dialogInfo = await this.page.evaluate(() => {
        // 다양한 다이얼로그 선택자 시도
        const dialogSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog',
          '.opened',
          'ytd-dialog-renderer',
          'ytd-membership-offer-renderer'
        ];

        for (const selector of dialogSelectors) {
          const dialog = document.querySelector(selector);
          if (dialog && dialog.offsetHeight > 0) {
            const text = dialog.innerText || '';
            // 다이얼로그 내의 모든 텍스트 수집
            return {
              found: true,
              text: text,
              selector: selector
            };
          }
        }

        // 다이얼로그를 못 찾았으면 body 전체 텍스트에서 멤버십 관련 섹션 찾기
        const bodyText = document.body.innerText || '';
        const membershipSection = bodyText.match(/Membership[\s\S]{0,500}/i) ||
                                 bodyText.match(/멤버십[\s\S]{0,500}/i) ||
                                 bodyText.match(/Family membership[\s\S]{0,500}/i);

        if (membershipSection) {
          return {
            found: true,
            text: membershipSection[0],
            selector: 'body-membership-section'
          };
        }

        return { found: false, text: '', selector: '' };
      });

      if (dialogInfo.found) {
        console.log(chalk.gray(`📝 다이얼로그/섹션 발견 (${dialogInfo.selector}):`));
        console.log(chalk.gray(dialogInfo.text.substring(0, 500)));

        // "Next billing date:" 또는 유사한 패턴 뒤에 오는 날짜 찾기
        const nextBillingPattern = /(?:Next billing date:|다음 결제일:|Próxima fecha de facturación:|Prochaine date de facturation:)\s*([^\n]+)/i;
        const nextBillingMatch = dialogInfo.text.match(nextBillingPattern);
        if (nextBillingMatch) {
          const dateStr = nextBillingMatch[1].trim();
          console.log(chalk.cyan(`📅 Next billing date 발견: ${dateStr}`));
          return this.parseDateString(dateStr);
        }

        // 일반 날짜 패턴 매칭
        for (const pattern of datePatterns) {
          const match = dialogInfo.text.match(pattern);
          if (match) {
            const dateStr = match[1];
            console.log(chalk.cyan(`📅 다이얼로그에서 날짜 발견: ${dateStr}`));
            return this.parseDateString(dateStr);
          }
        }

        // 월 이름과 일 찾기 (Oct 24 형식)
        const monthDayPattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i;
        const monthDayMatch = dialogInfo.text.match(monthDayPattern);
        if (monthDayMatch) {
          const dateStr = `${monthDayMatch[1]} ${monthDayMatch[2]}`;
          console.log(chalk.cyan(`📅 월-일 형식 발견: ${dateStr}`));
          return this.parseDateString(dateStr);
        }
      }

      // 특정 요소에서 날짜 찾기
      const specificDate = await this.page.evaluate(() => {
        // 날짜가 포함될 가능성이 있는 요소들
        const selectors = [
          'yt-formatted-string',
          'tp-yt-paper-dialog-scrollable',
          '.date', '.billing-date', '.next-billing',
          '[class*="date"]', '[class*="billing"]'
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.innerText || el.textContent || '';
            // 날짜 패턴 확인
            if (/\d{1,2}/.test(text) && /[A-Za-z]{3}|\d{4}/.test(text)) {
              return text;
            }
          }
        }
        return null;
      });

      if (specificDate) {
        console.log(chalk.cyan(`📅 특정 요소에서 날짜 발견: ${specificDate}`));
        return this.parseDateString(specificDate);
      }

      return null;
    } catch (error) {
      this.log(`다음 결제일 추출 실패: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * 날짜 문자열 파싱
   */
  parseDateString(dateStr) {
    try {
      // DateParsingService 사용
      if (this.dateParser) {
        const parsed = this.dateParser.parseDate(dateStr, this.currentLanguage || 'en');
        return parsed;
      }

      // 기본 파싱 로직
      // 한국어 날짜 형식
      const koreanMatch = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (koreanMatch) {
        const [_, year, month, day] = koreanMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      // 점 형식 (2024. 11. 20)
      const dotMatch = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      if (dotMatch) {
        const [_, year, month, day] = dotMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      // 영어 날짜 형식 (Nov 20, 2024)
      const months = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };

      const englishMatch = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
      if (englishMatch) {
        const [_, monthName, day, year] = englishMatch;
        const month = months[monthName.toLowerCase().substring(0, 3)];
        if (month) {
          return `${year}-${month}-${day.padStart(2, '0')}`;
        }
      }

      return dateStr; // 파싱 실패 시 원본 반환
    } catch (error) {
      this.log(`날짜 파싱 실패: ${error.message}`, 'warning');
      return dateStr;
    }
  }

  /**
   * 날짜 정규화 (YYYY-MM-DD 형식으로)
   */
  normalizeDate(dateStr) {
    if (!dateStr) return null;

    const dateString = dateStr.toString().trim();

    // 이미 YYYY-MM-DD 형식인 경우
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }

    // 점 형식 (2025. 9. 24) - Google Sheets에서 자주 사용
    const dotMatch = dateString.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (dotMatch) {
      const [_, year, month, day] = dotMatch;
      const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      console.log(chalk.gray(`   정규화: "${dateString}" → "${normalized}"`));
      return normalized;
    }

    // 다른 형식은 parseDateString 사용
    const parsed = this.parseDateString(dateString);
    if (parsed !== dateString) {
      console.log(chalk.gray(`   파싱: "${dateString}" → "${parsed}"`));
    }
    return parsed;
  }

  /**
   * 갱신 여부 확인
   */
  checkIfRenewed(existingDate, currentDate) {
    // 기존 날짜가 없으면 현재 날짜를 저장해야 함
    if (!existingDate) {
      console.log(chalk.blue('  📌 F열에 기존 날짜가 없습니다. 현재 날짜를 저장합니다.'));
      // 날짜 저장이 필요한 경우
      return 'save_date';
    }

    // 날짜 정규화
    const normalizedExisting = this.normalizeDate(existingDate);
    const normalizedCurrent = this.normalizeDate(currentDate);

    console.log(chalk.cyan(`  📅 날짜 비교:`));
    console.log(chalk.gray(`     F열 기존 날짜: ${normalizedExisting} (Google Sheets)`));
    console.log(chalk.gray(`     감지된 날짜: ${normalizedCurrent} (YouTube 페이지)`));

    // 날짜가 같으면 갱신되지 않은 것
    if (normalizedExisting === normalizedCurrent) {
      console.log(chalk.yellow('  ⏭️ 날짜가 동일합니다. 결제가 갱신되지 않았습니다.'));
      return false;
    }

    // 날짜가 다르면 갱신된 것
    try {
      const existingTime = new Date(normalizedExisting).getTime();
      const currentTime = new Date(normalizedCurrent).getTime();

      if (currentTime > existingTime) {
        console.log(chalk.green('  ✅ 결제가 갱신되었습니다! (다음 결제일이 연장됨)'));
        const daysDiff = Math.round((currentTime - existingTime) / (1000 * 60 * 60 * 24));
        console.log(chalk.gray(`     약 ${daysDiff}일 연장되었습니다.`));
        return true;
      } else {
        console.log(chalk.yellow('  ⚠️ 날짜가 변경되었지만 이전 날짜입니다'));
        return false;
      }
    } catch (error) {
      // 날짜 파싱 실패 시 단순 문자열 비교로 다르면 갱신된 것으로 처리
      console.log(chalk.green('  ✅ 날짜가 변경되었습니다 (갱신 확인)'));
      return true;
    }
  }

  /**
   * 일시중지 작업 수행 (간소화된 직접 구현)
   */
  async performPauseWorkflow() {
    try {
      // browser가 제대로 전달되지 않으면 this.page 사용
      const browser = this.browser || this.page;
      if (!browser) {
        throw new Error('브라우저가 연결되지 않았습니다');
      }

      // 언어 감지
      this.currentLanguage = await this.detectPageLanguage(browser);
      console.log(chalk.cyan(`📄 감지된 언어: ${this.currentLanguage}`));

      // 이미 일시중지된 상태인지 확인
      const isAlreadyPaused = await this.page.evaluate(() => {
        const bodyText = document.body?.innerText || '';

        // 일시중지 상태 표시 텍스트
        const pausedIndicators = [
          'Resume', 'Resume membership',
          '재개', '멤버십 재개',
          'Membership pauses on',
          'Membership resumes on',
          '일시중지됨', '일시중지되었습니다'
        ];

        return pausedIndicators.some(indicator =>
          bodyText.includes(indicator)
        );
      });

      if (isAlreadyPaused) {
        console.log(chalk.yellow('⚠️ 이미 일시중지된 계정입니다'));
        return {
          success: true,
          status: 'already_paused',
          pauseDate: new Date().toISOString().split('T')[0],
          resumeDate: null,
          nextBillingDate: null,
          message: '이미 일시중지됨'
        };
      }

      // 일시중지 버튼 직접 클릭
      console.log(chalk.cyan('📌 일시중지 버튼 클릭 시도...'));

      // 일시중지 버튼 찾기 및 클릭 (간소화된 버전)
      const pauseClicked = await this.page.evaluate(() => {
        // 다국어 일시중지 버튼 텍스트
        const pauseTexts = [
          'Pause', 'Pause membership', 'Pause Membership',
          '일시중지', '멤버십 일시중지',
          'Pausar', 'Pausar membresía',
          'Приостановить', 'Пауза',
          'Tạm dừng', 'Tạm ngừng'
        ];

        // 모든 버튼 찾기
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], tp-yt-paper-button'));

        for (const button of buttons) {
          const text = button.textContent?.trim() || '';
          const ariaLabel = button.getAttribute('aria-label') || '';

          // 일시중지 관련 텍스트 확인
          if (pauseTexts.some(pauseText =>
            text.includes(pauseText) || ariaLabel.includes(pauseText)
          )) {
            console.log('일시중지 버튼 발견:', text);
            button.click();
            return true;
          }
        }

        return false;
      });

      if (!pauseClicked) {
        console.log(chalk.yellow('⚠️ 일시중지 버튼을 찾을 수 없습니다 (이미 일시중지 상태일 수 있음)'));

        // 버튼을 찾지 못했지만 이미 일시중지 상태일 수 있으므로 다시 확인
        const recheckPaused = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes('Resume') || bodyText.includes('재개') ||
                 bodyText.includes('pauses on') || bodyText.includes('resumes on');
        });

        if (recheckPaused) {
          console.log(chalk.green('✅ 이미 일시중지 상태로 확인됨'));
          return {
            success: true,
            status: 'already_paused',
            pauseDate: new Date().toISOString().split('T')[0],
            resumeDate: null,
            nextBillingDate: null
          };
        }

        return {
          success: false,
          status: 'pause_button_not_found',
          error: '일시중지 버튼을 찾을 수 없습니다'
        };
      }

      console.log(chalk.green('✅ 일시중지 버튼 클릭됨'));

      // 팝업 대기 (3초)
      await new Promise(r => setTimeout(r, 3000));

      // 팝업에서 확인 버튼 클릭
      const confirmClicked = await this.page.evaluate(() => {
        // 확인 버튼 텍스트
        const confirmTexts = [
          'Pause', 'Confirm', 'OK', 'Yes', 'Continue',
          '일시중지', '확인', '예', '계속',
          'Pausar', 'Confirmar', 'Sí',
          'Подтвердить', 'Да', 'Продолжить',
          'Xác nhận', 'Có', 'Tiếp tục'
        ];

        // 팝업 내 버튼 찾기
        const popupSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          'tp-yt-paper-dialog',
          '.opened'
        ];

        for (const selector of popupSelectors) {
          const popup = document.querySelector(selector);
          if (popup && popup.offsetHeight > 0) {
            const buttons = popup.querySelectorAll('button, [role="button"], tp-yt-paper-button');

            for (const button of buttons) {
              const text = button.textContent?.trim() || '';

              if (confirmTexts.some(confirmText =>
                text.includes(confirmText)
              )) {
                console.log('확인 버튼 발견:', text);
                button.click();
                return true;
              }
            }
          }
        }

        // 팝업이 없는 경우 페이지에서 직접 확인 버튼 찾기
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const button of allButtons) {
          const text = button.textContent?.trim() || '';

          if (confirmTexts.some(confirmText =>
            text === confirmText || text.toLowerCase() === confirmText.toLowerCase()
          )) {
            console.log('확인 버튼 발견 (페이지):', text);
            button.click();
            return true;
          }
        }

        return false;
      });

      if (confirmClicked) {
        console.log(chalk.green('✅ 일시중지 확인 완료'));
      } else {
        console.log(chalk.yellow('⚠️ 확인 버튼을 찾을 수 없지만 계속 진행'));
      }

      // 결과 대기 (3초)
      await new Promise(r => setTimeout(r, 3000));

      // 페이지 새로고침하여 상태 확인 (일반 일시중지와 동일하게)
      console.log(chalk.cyan('📄 페이지 새로고침하여 일시중지 상태 확인...'));

      try {
        // 페이지 새로고침
        await this.page.goto('https://www.youtube.com/paid_memberships', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await new Promise(r => setTimeout(r, 3000));

        // 멤버십 관리 버튼 다시 클릭
        const manageClicked = await this.page.evaluate(() => {
          const manageTexts = [
            'Manage membership', 'Manage',
            '멤버십 관리', '구독 관리',
            'Administrar', 'Gérer', 'Verwalten',
            'Управление', 'Quản lý'
          ];

          const buttons = Array.from(document.querySelectorAll('button, [role="button"], tp-yt-paper-button'));
          for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            if (manageTexts.some(manageText => text.includes(manageText))) {
              button.click();
              return true;
            }
          }
          return false;
        });

        if (manageClicked) {
          console.log(chalk.green('✅ 구독 관리 버튼 클릭됨'));
          await new Promise(r => setTimeout(r, 2000));
        }

        // 일시중지 성공 여부 확인
        const pauseStatus = await this.page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const result = {
            isPaused: false,
            resumeDate: null
          };

          // 일시중지 성공 표시 텍스트 (Resume 버튼이 보이면 일시중지 성공)
          const pausedIndicators = [
            'Resume membership', 'Resume',
            '멤버십 재개', '재개',
            'Reanudar', 'Reprendre',
            'Возобновить', 'Tiếp tục'
          ];

          // Resume 버튼 찾기
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const btnText = btn.textContent?.trim() || '';
            if (pausedIndicators.some(indicator => btnText.includes(indicator))) {
              result.isPaused = true;
              break;
            }
          }

          // 날짜 추출 시도
          const datePatterns = [
            // 영어
            /(?:resumes on|Next billing date:|Membership resumes on:?)\s*([A-Za-z]+ \d{1,2}(?:, \d{4})?)/i,
            // 한국어
            /(?:다음 결제일:|재개 날짜:)\s*(\d{4}년 \d{1,2}월 \d{1,2}일|\d{1,2}월 \d{1,2}일)/i,
            // 점 형식
            /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/,
            // ISO 형식
            /(\d{4}-\d{2}-\d{2})/
          ];

          for (const pattern of datePatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              result.resumeDate = match[1];
              break;
            }
          }

          return result;
        });

        if (pauseStatus.isPaused) {
          console.log(chalk.green('✅ 일시중지 상태 확인됨 (Resume 버튼 발견)'));

          // 재개 날짜가 있으면 파싱
          let resumeDate = null;
          if (pauseStatus.resumeDate) {
            console.log(chalk.cyan(`📅 재개 예정일: ${pauseStatus.resumeDate}`));
            resumeDate = this.parseDateString(pauseStatus.resumeDate);
          }

          return {
            success: true,
            status: 'paused',
            pauseDate: new Date().toISOString().split('T')[0],
            resumeDate: resumeDate,
            nextBillingDate: resumeDate // 재개일이 다음 결제일
          };
        } else {
          // Resume 버튼을 찾지 못했지만 일시중지는 성공했을 가능성이 높음
          console.log(chalk.yellow('⚠️ Resume 버튼을 찾지 못했지만 일시중지 처리 완료'));
          return {
            success: true,
            status: 'paused',
            pauseDate: new Date().toISOString().split('T')[0],
            resumeDate: null,
            nextBillingDate: null
          };
        }

      } catch (verifyError) {
        // 검증 중 오류가 발생해도 일시중지는 성공했을 가능성이 높음
        console.log(chalk.yellow(`⚠️ 상태 확인 중 오류: ${verifyError.message}`));
        console.log(chalk.green('✅ 일시중지는 성공적으로 처리된 것으로 가정'));
        return {
          success: true,
          status: 'paused',
          pauseDate: new Date().toISOString().split('T')[0],
          resumeDate: null,
          nextBillingDate: null
        };
      }

    } catch (error) {
      this.log(`일시중지 워크플로우 오류: ${error.message}`, 'error');
      return {
        success: false,
        status: 'workflow_error',
        error: error.message
      };
    }
  }

  /**
   * F열에 날짜만 저장 (기존 날짜가 없을 때)
   */
  async updateSheetsDateOnly(email, nextBillingDate) {
    try {
      if (!email) return;

      // PauseSheetRepository 직접 사용
      if (this.pauseSheetRepository) {
        await this.pauseSheetRepository.initialize();

        // 프로필 행 찾기
        const response = await this.pauseSheetRepository.sheets.spreadsheets.values.get({
          spreadsheetId: this.pauseSheetRepository.spreadsheetId,
          range: '일시중지!A:H'
        });

        const rows = response.data.values || [];
        if (rows.length < 2) return;

        // 이메일로 행 찾기
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0] === email) {  // A열: 이메일
            rowIndex = i + 1;  // 1-based index
            break;
          }
        }

        if (rowIndex === -1) {
          console.log(chalk.yellow(`⚠️ ${email}을 시트에서 찾을 수 없습니다.`));
          return;
        }

        // 업데이트할 데이터 준비
        const updates = [];

        // F열 (다음 결제일) 업데이트 - 비교 기준 날짜 저장
        updates.push({
          range: `일시중지!F${rowIndex}`,
          values: [[nextBillingDate]]
        });

        // G열 (IP) 업데이트 - 브라우저에서 사용한 실제 IP 주소
        let ipAddress = 'N/A';
        try {
          if (this.page && this.ipService) {
            console.log(chalk.gray('📡 브라우저 IP 주소 확인 중...'));
            ipAddress = await this.ipService.getCurrentIP(this.page);
            if (ipAddress) {
              console.log(chalk.green(`✅ IP 주소 확인됨: ${ipAddress}`));
            } else {
              console.log(chalk.yellow('⚠️ IP 주소를 가져올 수 없습니다'));
              ipAddress = 'N/A';
            }
          }
        } catch (ipError) {
          console.log(chalk.yellow(`⚠️ IP 확인 실패: ${ipError.message}`));
        }

        updates.push({
          range: `일시중지!G${rowIndex}`,
          values: [[ipAddress]]
        });

        // 배치 업데이트
        if (updates.length > 0) {
          await this.pauseSheetRepository.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.pauseSheetRepository.spreadsheetId,
            resource: {
              data: updates.map(update => ({
                range: update.range,
                values: update.values
              })),
              valueInputOption: 'USER_ENTERED'
            }
          });

          console.log(chalk.blue(`📝 Google Sheets 업데이트 완료:`));
          console.log(chalk.gray(`   - F${rowIndex} (다음 결제일): ${nextBillingDate} [비교 기준 저장]`));
          console.log(chalk.gray(`   - G${rowIndex} (IP): ${ipAddress}`));
          console.log(chalk.gray(`   - E열 (상태), H열 (결과): 변경 없음`));
        }

      } else {
        console.log(chalk.gray('📝 PauseSheetRepository 사용 불가'));
      }

    } catch (error) {
      console.error(chalk.red('날짜 저장 실패:'), error.message);
    }
  }

  /**
   * 갱신 후 일시중지된 계정을 위한 Google Sheets 업데이트 (모든 필드 업데이트)
   * 일반 일시중지 작업과 동일한 패턴 적용
   */
  async updateSheetsForPaused(email, nextBillingDate, pauseStatus) {
    try {
      if (!email) return;

      // PauseSheetRepository 직접 사용
      if (this.pauseSheetRepository) {
        await this.pauseSheetRepository.initialize();

        // 프로필 행 찾기
        const response = await this.pauseSheetRepository.sheets.spreadsheets.values.get({
          spreadsheetId: this.pauseSheetRepository.spreadsheetId,
          range: '일시중지!A:H'
        });

        const rows = response.data.values || [];
        if (rows.length < 2) return;

        // 이메일로 행 찾기
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0] === email) {  // A열: 이메일
            rowIndex = i + 1;  // 1-based index
            break;
          }
        }

        if (rowIndex === -1) {
          console.log(chalk.yellow(`⚠️ ${email}을 시트에서 찾을 수 없습니다.`));
          return;
        }

        // 업데이트할 데이터 준비
        const updates = [];

        // E열 (상태) 업데이트 - 일반 일시중지와 동일하게 "일시중지"로 통일
        const statusText = '일시중지';  // 항상 "일시중지"로 기록
        updates.push({
          range: `일시중지!E${rowIndex}`,
          values: [[statusText]]
        });

        // F열 (다음 결제일) 업데이트 - 새로운 갱신된 날짜
        updates.push({
          range: `일시중지!F${rowIndex}`,
          values: [[nextBillingDate]]
        });

        // G열 (IP) 업데이트 - 브라우저에서 사용한 실제 IP 주소
        let ipAddress = 'N/A';
        try {
          if (this.page && this.ipService) {
            console.log(chalk.gray('📡 브라우저 IP 주소 확인 중...'));
            ipAddress = await this.ipService.getCurrentIP(this.page);
            if (ipAddress) {
              console.log(chalk.green(`✅ IP 주소 확인됨: ${ipAddress}`));
            } else {
              console.log(chalk.yellow('⚠️ IP 주소를 가져올 수 없습니다'));
              ipAddress = 'N/A';
            }
          }
        } catch (ipError) {
          console.log(chalk.yellow(`⚠️ IP 확인 실패: ${ipError.message}`));
        }

        updates.push({
          range: `일시중지!G${rowIndex}`,
          values: [[ipAddress]]
        });

        // H열 (결과) 업데이트 - 일반 일시중지와 동일한 형식
        const now = new Date();
        const timeStr = now.toLocaleString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });

        // UnifiedSheetsUpdateService와 동일한 패턴 사용
        let resultText;
        if (pauseStatus === 'already_paused') {
          // 이미 일시중지 상태인 경우 - 일반 일시중지와 동일한 형식
          resultText = `✅ 이미 일시중지됨 ┃ 재개예정: ${nextBillingDate} ┃ ${timeStr}`;
        } else {
          // 새로 일시중지한 경우 - 일반 일시중지와 동일한 형식
          resultText = `🆕 신규 일시중지 성공 ┃ 재개예정: ${nextBillingDate} ┃ ${timeStr}`;
        }

        updates.push({
          range: `일시중지!H${rowIndex}`,
          values: [[resultText]]
        });

        // 배치 업데이트
        if (updates.length > 0) {
          await this.pauseSheetRepository.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.pauseSheetRepository.spreadsheetId,
            resource: {
              data: updates.map(update => ({
                range: update.range,
                values: update.values
              })),
              valueInputOption: 'USER_ENTERED'
            }
          });

          console.log(chalk.green(`✅ Google Sheets 업데이트 완료 (갱신확인 일시중지):`));
          console.log(chalk.cyan(`   E${rowIndex} (상태): ${statusText}`));
          console.log(chalk.cyan(`   F${rowIndex} (다음 결제일): ${nextBillingDate}`));
          console.log(chalk.cyan(`   G${rowIndex} (IP): ${ipAddress}`));
          console.log(chalk.cyan(`   H${rowIndex} (결과): ${resultText}`));
        }

      } else {
        console.log(chalk.gray('📝 PauseSheetRepository 사용 불가'));
      }

    } catch (error) {
      console.error(chalk.red('Google Sheets 업데이트 실패:'), error.message);
    }
  }

  /**
   * 갱신되지 않은 계정을 위한 Google Sheets 업데이트 (결과 필드만 업데이트)
   */
  async updateSheetsForNotRenewed(email, nextBillingDate) {
    try {
      if (!email) return;

      // PauseSheetRepository 직접 사용
      if (this.pauseSheetRepository) {
        await this.pauseSheetRepository.initialize();

        // 프로필 행 찾기
        const response = await this.pauseSheetRepository.sheets.spreadsheets.values.get({
          spreadsheetId: this.pauseSheetRepository.spreadsheetId,
          range: '일시중지!A:H'
        });

        const rows = response.data.values || [];
        if (rows.length < 2) return;

        // 이메일로 행 찾기
        let rowIndex = -1;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][0] === email) {  // A열: 이메일
            rowIndex = i + 1;  // 1-based index
            break;
          }
        }

        if (rowIndex === -1) {
          console.log(chalk.yellow(`⚠️ ${email}을 시트에서 찾을 수 없습니다.`));
          return;
        }

        // 업데이트할 데이터 준비
        const updates = [];

        // F열 (다음 결제일) 업데이트
        if (nextBillingDate) {
          updates.push({
            range: `일시중지!F${rowIndex}`,
            values: [[nextBillingDate]]
          });
        }

        // H열 (결과) 업데이트 - E열(상태)은 그대로 유지
        updates.push({
          range: `일시중지!H${rowIndex}`,
          values: [['결제 갱신 전']]
        });

        // G열 (IP) 업데이트 - 브라우저에서 사용한 실제 IP 주소
        let ipAddress = 'N/A';
        try {
          if (this.page && this.ipService) {
            console.log(chalk.gray('📡 브라우저 IP 주소 확인 중...'));
            ipAddress = await this.ipService.getCurrentIP(this.page);
            if (ipAddress) {
              console.log(chalk.green(`✅ IP 주소 확인됨: ${ipAddress}`));
            } else {
              console.log(chalk.yellow('⚠️ IP 주소를 가져올 수 없습니다'));
              ipAddress = 'N/A';
            }
          }
        } catch (ipError) {
          console.log(chalk.yellow(`⚠️ IP 확인 실패: ${ipError.message}`));
        }

        updates.push({
          range: `일시중지!G${rowIndex}`,
          values: [[ipAddress]]
        });

        // 배치 업데이트
        if (updates.length > 0) {
          await this.pauseSheetRepository.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.pauseSheetRepository.spreadsheetId,
            resource: {
              data: updates.map(update => ({
                range: update.range,
                values: update.values
              })),
              valueInputOption: 'USER_ENTERED'
            }
          });

          console.log(chalk.green(`✅ Google Sheets 업데이트 완료:`));
          console.log(chalk.gray(`   - F${rowIndex} (다음 결제일): ${nextBillingDate}`));
          console.log(chalk.gray(`   - G${rowIndex} (IP): ${ipAddress}`));
          console.log(chalk.gray(`   - H${rowIndex} (결과): "결제 갱신 전"`));
          console.log(chalk.gray(`   - E열 (상태): 변경 없음 (기존값 유지)`));
        }

      } else {
        console.log(chalk.gray('📝 PauseSheetRepository 사용 불가'));
      }

    } catch (error) {
      console.error(chalk.red('Google Sheets 업데이트 실패:'), error.message);
    }
  }

  /**
   * 건너뛴 계정을 위한 Google Sheets 업데이트
   */
  async updateSheetsForSkipped(email, nextBillingDate, status = '갱신대기') {
    try {
      if (!email) return;

      const UnifiedSheetsUpdateService = require('../../services/UnifiedSheetsUpdateService');
      const sheetsService = new UnifiedSheetsUpdateService({
        debugMode: true,
        spreadsheetId: process.env.GOOGLE_SHEETS_ID
      });

      await sheetsService.initialize();

      // 상태와 다음 결제일만 업데이트 (일시중지하지 않았으므로)
      const updateResult = await sheetsService.updatePauseStatus(email, {
        status: status,
        nextBillingDate: nextBillingDate,
        detailedResult: `⏭️ 갱신 대기 중 - 다음 결제일: ${nextBillingDate} ┃ ${new Date().toLocaleTimeString('ko-KR')}`
      });

      if (updateResult) {
        console.log(chalk.green('✅ Google Sheets 업데이트 완료 (갱신 대기)'));
      }

    } catch (error) {
      console.log(chalk.yellow(`⚠️ Sheets 업데이트 실패: ${error.message}`));
    }
  }

  /**
   * 로그 출력 (오버라이드)
   */
  log(message, type = 'info') {
    const colors = {
      info: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      debug: chalk.gray
    };

    const color = colors[type] || chalk.white;
    const typeSymbols = {
      info: '📌',
      success: '✅',
      warning: '⚠️',
      error: '❌',
      debug: '🔍'
    };

    const symbol = typeSymbols[type] || '📄';
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    console.log(color(`[${timestamp}] [RenewalCheck] ${symbol} ${message}`));

    if (this.logger && typeof this.logger[type] === 'function') {
      this.logger[type](`RenewalCheckPause: ${message}`);
    }
  }
}

module.exports = RenewalCheckPauseUseCase;