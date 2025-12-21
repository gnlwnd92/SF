/**
 * Improved Pause Subscription Use Case
 * GOOGLE_LOGIN_SOLUTION_REPORT 기반 개선된 구독 일시중지 워크플로우
 * 
 * 개선사항:
 * 1. ImprovedAuthenticationService 통합
 * 2. 정확한 구글 시트 데이터 사용
 * 3. TOTP 인증 최적화
 * 4. 단계별 검증 강화
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const ImprovedAuthenticationService = require('../../services/ImprovedAuthenticationService');
const { languages, detectLanguage, parseDate } = require('../../infrastructure/config/multilanguage');
const { google } = require('googleapis');

class ImprovedPauseSubscriptionUseCase {
  constructor({
    adsPowerAdapter,
    youtubeAdapter,
    profileRepository,
    pauseSheetRepository,
    logger
  }) {
    this.adsPowerAdapter = adsPowerAdapter;
    this.youtubeAdapter = youtubeAdapter;
    this.profileRepository = profileRepository;
    this.pauseSheetRepository = pauseSheetRepository;
    this.logger = logger || console;
    
    // 개선된 인증 서비스 초기화
    this.authService = new ImprovedAuthenticationService({
      debugMode: false,
      totpInputDelay: 50,  // TOTP 입력 최적화
      passwordInputDelay: 100
    });
    
    this.currentLanguage = 'en';
    this.pauseInfo = {};
  }

  /**
   * 결제 일시중지 워크플로우 실행
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 프로필 데이터 저장 (로그인용)
    this.profileData = options.profileData || {};
    this.debugMode = options.debugMode || false;
    this.pauseDuration = options.pauseDuration || 1; // 기본 1개월
    
    const result = {
      profileId,
      success: false,
      status: null,
      pauseDate: null,
      resumeDate: null,
      nextBillingDate: null,
      browserIP: null,
      error: null,
      duration: 0,
      loginAttempts: 0
    };

    try {
      this.log(`⏸️ 프로필 ${profileId} 결제 일시중지 시작`, 'info');

      // 1. 구글 시트에서 계정 정보 가져오기
      const accountInfo = await this.fetchAccountFromSheets(profileId);
      if (!accountInfo) {
        throw new Error('구글 시트에서 계정 정보를 찾을 수 없습니다');
      }

      // 2. 브라우저 연결
      const browser = await this.connectBrowser(profileId);
      if (!browser) {
        throw new Error('브라우저 연결 실패');
      }

      // 3. 페이지 객체 가져오기
      const page = await this.getPage(browser);
      if (!page) {
        throw new Error('페이지 객체를 가져올 수 없습니다');
      }

      // 4. YouTube Premium 페이지로 이동 및 로그인
      const loginResult = await this.navigateAndLogin(page, accountInfo);
      result.loginAttempts = loginResult.attempts || 1;
      
      if (!loginResult.success) {
        throw new Error(`로그인 실패: ${loginResult.reason || 'Unknown'}`);
      }

      // 5. 언어 감지
      this.currentLanguage = await this.detectPageLanguage(page);
      this.log(`🌐 감지된 언어: ${languages[this.currentLanguage].name}`, 'info');

      // 6. 현재 상태 확인
      const currentStatus = await this.checkCurrentStatus(page);
      
      // 이미 일시중지 상태인 경우
      if (currentStatus.isPaused) {
        this.log('✅ 이미 일시중지 상태입니다', 'warning');
        result.status = 'already_paused';
        result.success = true;
        
        // 날짜 정보 추출
        if (currentStatus.resumeDate) {
          result.resumeDate = parseDate(currentStatus.resumeDate, this.currentLanguage);
        }
      } else if (!currentStatus.isActive) {
        this.log('⚠️ 구독이 활성 상태가 아닙니다', 'warning');
        result.status = 'not_active';
        result.success = false;
        result.error = '구독이 활성 상태가 아님';
      } else {
        // 7. 일시중지 프로세스 실행
        const pauseResult = await this.executePauseWorkflow(page, this.pauseDuration);
        
        if (pauseResult.success) {
          result.success = true;
          result.status = 'paused';
          result.pauseDate = pauseResult.pauseDate;
          result.resumeDate = pauseResult.resumeDate;
          result.nextBillingDate = pauseResult.nextBillingDate;
          
          this.log('✅ 결제 일시중지 성공', 'success');
        } else {
          result.success = false;
          result.status = 'pause_failed';
          result.error = pauseResult.error || 'Pause 실패';
        }
      }

      // 8. 브라우저 IP 저장
      result.browserIP = await this.getBrowserIP(page);

      // 9. 스크린샷 저장
      if (this.debugMode || options.saveScreenshot) {
        const screenshotPath = await this.saveScreenshot(page, `pause-${profileId}-${Date.now()}.png`);
        result.screenshotPath = screenshotPath;
      }

      // 10. 구글 시트 업데이트
      if (result.success && this.pauseSheetRepository) {
        await this.updatePauseSheet(profileId, result);
      }

    } catch (error) {
      this.log(`❌ 결제 일시중지 실패: ${error.message}`, 'error');
      result.success = false;
      result.status = 'error';
      result.error = error.message;
      
      // 에러 스크린샷 저장
      if (this.debugMode) {
        try {
          const page = await this.getPageFromBrowser(profileId);
          if (page) {
            await this.saveScreenshot(page, `pause-error-${profileId}-${Date.now()}.png`);
          }
        } catch (screenshotError) {
          // 스크린샷 실패는 무시
        }
      }
    } finally {
      // 실행 시간 기록
      result.duration = Date.now() - startTime;
      
      // 결과 로깅
      this.logResult(result);
      
      // 브라우저 정리 (옵션에 따라)
      if (options.closeBrowser) {
        await this.closeBrowser(profileId);
      }
    }

    return result;
  }

  /**
   * 구글 시트에서 계정 정보 가져오기
   */
  async fetchAccountFromSheets(profileId) {
    try {
      // 구글 시트 API 초기화
      const credentials = JSON.parse(
        await fs.readFile('./credentials/service-account.json', 'utf8')
      );
      
      const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });
      
      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
      
      if (!spreadsheetId) {
        throw new Error('GOOGLE_SHEETS_ID가 설정되지 않았습니다');
      }
      
      // 결제일시중지 탭에서 계정 정보 찾기
      const pauseResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: '결제일시중지!A:D'
      });
      
      const pauseRows = pauseResponse.data.values;
      if (!pauseRows || pauseRows.length < 2) {
        // 결제재개 탭에서 찾기 (폴백)
        const resumeResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId,
          range: '결제재개!A:D'
        });
        
        const resumeRows = resumeResponse.data.values;
        if (!resumeRows || resumeRows.length < 2) {
          throw new Error('구글 시트에 데이터가 없습니다');
        }
        
        pauseRows = resumeRows;
      }
      
      // 애즈파워현황 탭에서 프로필 매칭
      const statusResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: '애즈파워현황!A:D'
      });
      
      const statusRows = statusResponse.data.values;
      let targetEmail = null;
      
      // 프로필 ID로 이메일 찾기
      if (statusRows && statusRows.length > 1) {
        for (let i = 1; i < statusRows.length; i++) {
          const row = statusRows[i];
          if (row[1] === profileId) { // B열이 프로필 ID
            targetEmail = row[3]; // D열이 이메일
            break;
          }
        }
      }
      
      if (!targetEmail) {
        throw new Error(`프로필 ${profileId}에 해당하는 이메일을 찾을 수 없습니다`);
      }
      
      // 계정 정보 찾기
      for (let i = 1; i < pauseRows.length; i++) {
        const row = pauseRows[i];
        if (row[0] === targetEmail) { // A열이 이메일
          return {
            email: row[0],          // A열
            password: row[1],       // B열
            recoveryEmail: row[2],  // C열
            totpSecret: row[3]      // D열
          };
        }
      }
      
      throw new Error(`이메일 ${targetEmail}에 대한 계정 정보를 찾을 수 없습니다`);
      
    } catch (error) {
      this.log(`구글 시트 조회 실패: ${error.message}`, 'error');
      
      // 폴백: profileData 사용
      if (this.profileData && this.profileData.email) {
        this.log('프로필 데이터 사용 (폴백)', 'warning');
        return {
          email: this.profileData.email,
          password: this.profileData.password,
          recoveryEmail: this.profileData.recoveryEmail,
          totpSecret: this.profileData.totpSecret || this.profileData.otpSecret
        };
      }
      
      throw error;
    }
  }

  /**
   * 페이지 이동 및 로그인
   */
  async navigateAndLogin(page, accountInfo) {
    const maxAttempts = 3;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        this.log(`🔐 로그인 시도 ${attempts}/${maxAttempts}`, 'info');
        
        // 개선된 로그인 서비스 사용
        const loginResult = await this.authService.performImprovedLogin(page, accountInfo, {
          profileId: this.profileId,
          saveScreenshot: this.debugMode
        });
        
        if (loginResult.success) {
          return {
            success: true,
            attempts: attempts
          };
        }
        
        // 로그인 실패
        if (loginResult.reason === 'TOTP secret missing' && attempts < maxAttempts) {
          this.log('TOTP 시크릿이 없습니다. 재시도...', 'warning');
          continue;
        }
        
      } catch (error) {
        this.log(`로그인 오류: ${error.message}`, 'error');
        
        if (attempts >= maxAttempts) {
          throw error;
        }
      }
      
      // 재시도 전 대기
      await new Promise(r => setTimeout(r, 5000));
    }
    
    return {
      success: false,
      attempts: attempts,
      reason: 'Max attempts reached'
    };
  }

  /**
   * 페이지 언어 감지
   */
  async detectPageLanguage(page) {
    try {
      const pageContent = await page.evaluate(() => {
        return document.body?.innerText || '';
      });
      
      const detectedLang = detectLanguage(pageContent);
      return detectedLang;
    } catch (error) {
      this.log(`언어 감지 실패: ${error.message}`, 'warning');
      return 'en'; // 기본값
    }
  }

  /**
   * 현재 구독 상태 확인
   */
  async checkCurrentStatus(page) {
    try {
      const status = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        
        // 활성 상태 확인
        const isActive = bodyText.includes('Manage') || 
                        bodyText.includes('관리') ||
                        bodyText.includes('Next billing');
        
        // 일시중지 상태 확인
        const isPaused = bodyText.includes('Paused') || 
                        bodyText.includes('일시중지됨') ||
                        bodyText.includes('Resume');
        
        // 날짜 정보 추출
        let resumeDate = null;
        const dateMatches = bodyText.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})|(\d{1,2}[-./]\d{1,2}[-./]\d{4})/g);
        if (dateMatches && dateMatches.length > 0) {
          resumeDate = dateMatches[0];
        }
        
        return {
          isActive,
          isPaused,
          resumeDate,
          bodyText: bodyText.substring(0, 500)
        };
      });
      
      this.log('📊 현재 상태:', 'info');
      this.log(`  활성: ${status.isActive ? '✅' : '❌'}`, 'info');
      this.log(`  일시중지: ${status.isPaused ? '✅' : '❌'}`, 'info');
      this.log(`  재개 예정일: ${status.resumeDate || '없음'}`, 'info');
      
      return status;
    } catch (error) {
      this.log(`상태 확인 실패: ${error.message}`, 'error');
      return {
        isActive: false,
        isPaused: false,
        resumeDate: null
      };
    }
  }

  /**
   * 일시중지 워크플로우 실행
   */
  async executePauseWorkflow(page, pauseDuration = 1) {
    try {
      // Manage 버튼 클릭
      const manageClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('Manage') || text.includes('관리')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (!manageClicked) {
        throw new Error('Manage 버튼을 찾을 수 없습니다');
      }
      
      this.log('✅ Manage 버튼 클릭', 'success');
      await new Promise(r => setTimeout(r, 5000));
      
      // Pause 버튼 클릭
      const pauseClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('Pause') || text.includes('일시중지')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (!pauseClicked) {
        throw new Error('Pause 버튼을 찾을 수 없습니다');
      }
      
      this.log('✅ Pause 버튼 클릭', 'success');
      await new Promise(r => setTimeout(r, 5000));
      
      // 일시중지 기간 선택
      const durationSelected = await page.evaluate((duration) => {
        const radios = document.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          const label = radio.parentElement?.textContent || '';
          if (label.includes(`${duration} month`) || label.includes(`${duration}개월`)) {
            radio.click();
            return true;
          }
        }
        return false;
      }, pauseDuration);
      
      if (durationSelected) {
        this.log(`✅ ${pauseDuration}개월 선택`, 'success');
      }
      
      // 확인 버튼 클릭
      const confirmClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text.includes('Pause') || 
              text.includes('일시중지') || 
              text.includes('Confirm') || 
              text.includes('확인')) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (confirmClicked) {
        this.log('✅ 확인 버튼 클릭', 'success');
      }
      
      // 결과 대기
      await new Promise(r => setTimeout(r, 10000));
      
      // 일시중지 결과 확인
      const result = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        
        const success = bodyText.includes('successfully') || 
                       bodyText.includes('성공') ||
                       bodyText.includes('paused') ||
                       bodyText.includes('일시중지되었습니다');
        
        // 날짜 정보 추출
        let resumeDate = null;
        const dateMatches = bodyText.match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})|(\d{1,2}[-./]\d{1,2}[-./]\d{4})/g);
        if (dateMatches && dateMatches.length > 0) {
          resumeDate = dateMatches[0];
        }
        
        return {
          success,
          resumeDate,
          pauseDate: new Date().toISOString()
        };
      });
      
      return result;
      
    } catch (error) {
      this.log(`일시중지 실행 실패: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 구글 시트 업데이트
   */
  async updatePauseSheet(profileId, result) {
    try {
      if (this.pauseSheetRepository) {
        await this.pauseSheetRepository.updatePauseStatus({
          profileId,
          status: 'paused',
          pauseDate: result.pauseDate,
          resumeDate: result.resumeDate,
          updatedAt: new Date().toISOString()
        });
        
        this.log('✅ 구글 시트 업데이트 완료', 'success');
      }
    } catch (error) {
      this.log(`구글 시트 업데이트 실패: ${error.message}`, 'warning');
      // 업데이트 실패는 전체 프로세스를 실패시키지 않음
    }
  }

  /**
   * 브라우저 연결
   */
  async connectBrowser(profileId) {
    try {
      // AdsPowerAdapter의 launchBrowser 메서드 사용
      const session = await this.adsPowerAdapter.launchBrowser(profileId);
      if (session && session.browser) {
        return session.browser;
      }
      throw new Error('브라우저 세션을 가져올 수 없습니다');
    } catch (error) {
      this.log(`브라우저 연결 실패: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * 페이지 객체 가져오기
   */
  async getPage(browser) {
    try {
      const pages = await browser.pages();
      return pages[0] || await browser.newPage();
    } catch (error) {
      this.log(`페이지 가져오기 실패: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * 브라우저 IP 가져오기
   */
  async getBrowserIP(page) {
    try {
      const response = await page.goto('https://api.ipify.org?format=json', {
        waitUntil: 'domcontentloaded',
        timeout: 10000
      });
      
      const data = await response.json();
      return data.ip;
    } catch (error) {
      this.log(`IP 조회 실패: ${error.message}`, 'warning');
      return null;
    }
  }

  /**
   * 스크린샷 저장
   */
  async saveScreenshot(page, filename) {
    try {
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      await fs.mkdir(screenshotDir, { recursive: true });
      
      const filepath = path.join(screenshotDir, filename);
      await page.screenshot({
        path: filepath,
        fullPage: false
      });
      
      this.log(`📸 스크린샷 저장: ${filename}`, 'debug');
      return filepath;
    } catch (error) {
      this.log(`스크린샷 저장 실패: ${error.message}`, 'warning');
      return null;
    }
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser(profileId) {
    try {
      await this.adsPowerAdapter.closeBrowser(profileId);
      this.log('브라우저 종료', 'debug');
    } catch (error) {
      this.log(`브라우저 종료 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * 결과 로깅
   */
  logResult(result) {
    const emoji = result.success ? '✅' : '❌';
    const statusText = result.success ? '성공' : '실패';
    
    this.log(`${emoji} 결제 일시중지 ${statusText}`, result.success ? 'success' : 'error');
    this.log(`  프로필: ${result.profileId}`, 'info');
    this.log(`  상태: ${result.status}`, 'info');
    this.log(`  소요시간: ${result.duration}ms`, 'info');
    
    if (result.resumeDate) {
      this.log(`  재개 예정일: ${result.resumeDate}`, 'info');
    }
    
    if (result.error) {
      this.log(`  오류: ${result.error}`, 'error');
    }
  }

  /**
   * 로그 출력
   */
  log(message, level = 'info') {
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    console.log(chalk[color](`[PauseUseCase] ${message}`));
  }
}

module.exports = ImprovedPauseSubscriptionUseCase;