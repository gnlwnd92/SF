/**
 * EnhancedPauseWorkflow - 서비스 기반 일시중지 워크플로우
 * 
 * 기존 UseCase를 새로운 서비스 아키텍처로 마이그레이션
 * 모든 공통 로직은 서비스로 위임하여 코드 중복 제거
 */

const BaseWorkflow = require('../core/BaseWorkflow');
const NavigationService = require('../services/NavigationService');
const AuthenticationService = require('../services/AuthenticationService');
const LanguageService = require('../services/LanguageService');
const BrowserManagementService = require('../services/BrowserManagementService');
const ButtonInteractionService = require('../services/ButtonInteractionService');
const PopupService = require('../services/PopupService');
const IPService = require('../services/IPService');
const DateParsingService = require('../services/DateParsingService');
const UniversalDateExtractor = require('../services/UniversalDateExtractor');

class EnhancedPauseWorkflow extends BaseWorkflow {
  constructor(dependencies) {
    super(dependencies);
    
    this.workflowType = 'pause';
    this.workflowVersion = '2.0';
    
    // 서비스 초기화
    this.initializeServices();
  }

  /**
   * 서비스 초기화
   */
  initializeServices() {
    // 네비게이션 서비스
    if (!this.services.navigation) {
      this.services.navigation = new NavigationService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 인증 서비스
    if (!this.services.auth) {
      this.services.auth = new AuthenticationService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 언어 서비스
    if (!this.services.language) {
      this.services.language = new LanguageService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 브라우저 관리 서비스
    if (!this.services.browser) {
      this.services.browser = new BrowserManagementService({
        debugMode: this.context?.debugMode,
        apiUrl: this.config?.adsPowerUrl
      });
    }
    
    // 버튼 상호작용 서비스
    if (!this.services.button) {
      this.services.button = new ButtonInteractionService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 팝업 서비스
    if (!this.services.popup) {
      this.services.popup = new PopupService({
        debugMode: this.context?.debugMode,
        buttonService: this.services.button
      });
    }
    
    // IP 서비스
    if (!this.services.ip) {
      this.services.ip = new IPService({
        debugMode: this.context?.debugMode
      });
    }
    
    // 날짜 파싱 서비스
    if (!this.services.dateParser) {
      this.services.dateParser = new DateParsingService({
        debugMode: true // 항상 상세 로그
      });
    }
    
    // 범용 날짜 추출 서비스
    if (!this.services.universalDateExtractor) {
      this.services.universalDateExtractor = new UniversalDateExtractor({
        debugMode: true // 상세 로그 활성화
      });
    }
  }

  /**
   * 워크플로우 실행 - 메인 로직
   */
  async execute(profileId, options = {}) {
    const startTime = Date.now();
    
    // 컨텍스트 초기화
    this.context.setProfileId(profileId);
    this.context.setState({ 
      debugMode: options.debugMode || false,
      profileData: options.profileData || {}
    });
    
    // 결과 객체 초기화
    const result = this.createResult();
    
    try {
      console.log('\n' + '='.repeat(80));
      console.log(`[EnhancedPauseWorkflow] 🚀 워크플로우 시작`);
      console.log(`[EnhancedPauseWorkflow] 프로필 ID: ${profileId}`);
      console.log(`[EnhancedPauseWorkflow] 이메일: ${options.profileData?.email || 'N/A'}`);
      console.log(`[EnhancedPauseWorkflow] 시작 시간: ${new Date().toISOString()}`);
      console.log('='.repeat(80));
      
      // 1. 브라우저 연결
      console.log('\n[EnhancedPauseWorkflow] Step 1/8: 브라우저 연결 시작');
      const browserConnection = await this.services.browser.connect(profileId);
      
      if (!browserConnection.success) {
        throw new Error('브라우저 연결 실패');
      }
      
      this.context.setBrowser(browserConnection.browser);
      this.context.setPage(browserConnection.page);
      
      // 2. 로그인 상태 확인
      console.log('\n[EnhancedPauseWorkflow] Step 2/8: 로그인 상태 확인');
      const loginStatus = await this.services.auth.checkLoginStatus(
        this.context.page,
        { profileId }
      );
      
      if (!loginStatus.isLoggedIn) {
        this.log('로그인 필요 - 자동 로그인 시도', 'warning');
        
        // 자동 로그인 시도
        const profileData = this.context.getState().profileData;
        if (profileData?.email && profileData?.password) {
          await this.services.auth.performLogin(
            this.context.page,
            {
              email: profileData.email,
              password: profileData.password
            }
          );
        } else {
          throw new Error('로그인 정보가 없습니다');
        }
      }
      
      // 3. YouTube Premium 페이지로 이동
      console.log('\n[EnhancedPauseWorkflow] Step 3/8: YouTube Premium 페이지 이동');
      await this.services.navigation.goToMembershipPage(this.context.page);

      // 3-1. SunBrowser 팝업 처리
      try {
        console.log('\n[EnhancedPauseWorkflow] Step 3-1/8: SunBrowser 팝업 확인 및 처리');
        if (this.services.popup && this.services.popup.detectAndCloseSunBrowserPopup) {
          const popupClosed = await this.services.popup.detectAndCloseSunBrowserPopup(this.context.page);
          if (popupClosed) {
            this.log('SunBrowser 팝업이 감지되어 처리했습니다', 'success');
            // 팝업 닫은 후 페이지 안정화 대기
            await new Promise(r => setTimeout(r, 2000));
          } else {
            this.log('SunBrowser 팝업이 감지되지 않았습니다', 'info');
          }
        }
      } catch (popupError) {
        this.log(`SunBrowser 팝업 처리 중 오류 (계속 진행): ${popupError.message}`, 'warning');
        // 팝업 처리 실패해도 워크플로우는 계속 진행
      }

      // 4. 언어 감지 (세부 변형 포함)
      console.log('\n[EnhancedPauseWorkflow] Step 4/8: 언어 감지');
      const languageDetection = await this.services.language.detectLanguage(
        this.context.page
      );
      
      // 언어 변형 구분을 위한 세부 감지
      let detectedLanguage = languageDetection.language;
      if (detectedLanguage === 'pt' || detectedLanguage === 'pt-br' || detectedLanguage === 'pt-pt') {
        // 포르투갈어의 경우 브라질/포르투갈 변형 구분
        const pageContent = await this.context.page.evaluate(() => document.body.innerText);
        if (pageContent.includes('assinatura') || pageContent.includes('Gerenciar') || pageContent.includes('faturamento')) {
          detectedLanguage = 'pt-br';
          this.log(`포르투갈어(브라질) 감지됨`, 'info');
        } else if (pageContent.includes('subscrição') || pageContent.includes('Gerir') || pageContent.includes('faturação')) {
          detectedLanguage = 'pt-pt';
          this.log(`포르투갈어(포르투갈) 감지됨`, 'info');
        }
      }
      
      this.context.setLanguage(detectedLanguage);
      this.log(`감지된 언어: ${this.getLanguageDisplayName(detectedLanguage)}`, 'info');
      
      // 5. IP 주소 확인
      console.log('\n[EnhancedPauseWorkflow] Step 5/8: IP 주소 확인');
      const ipAddress = await this.services.ip.getCurrentIP(this.context.page);
      if (ipAddress) {
        this.context.ipAddress = ipAddress;
        this.log(`IP 주소: ${ipAddress}`, 'info');
      }
      
      // 6. 현재 멤버십 상태 확인
      console.log('\n[EnhancedPauseWorkflow] Step 6/8: 멤버십 상태 확인');
      const currentStatus = await this.checkMembershipStatus();
      
      if (currentStatus.isPaused) {
        this.log('이미 일시중지 상태입니다', 'warning');
        result.setStatus('already_paused');
        result.setSuccess(true);
        result.resumeDate = currentStatus.resumeDate;
        result.nextBillingDate = currentStatus.nextBillingDate || currentStatus.resumeDate;
      } else if (!currentStatus.isActive) {
        throw new Error('활성 멤버십이 없습니다');
      } else {
        // 7. 일시중지 실행
        console.log('\n[EnhancedPauseWorkflow] Step 7/8: 일시중지 프로세스 실행');
        const pauseResult = await this.executePauseProcess();
        
        if (pauseResult.success) {
          result.setSuccess(true);
          result.setStatus('paused');
          result.pauseDate = pauseResult.pauseDate;
          result.resumeDate = pauseResult.resumeDate;
          result.nextBillingDate = pauseResult.resumeDate;
          
          this.log('✅ 일시중지 성공', 'success');
        } else {
          throw new Error(pauseResult.error || '일시중지 실패');
        }
      }
      
      // 8. Google Sheets 업데이트
      if (this.sheetRepository) {
        console.log('\n[EnhancedPauseWorkflow] Step 8/8: Google Sheets 업데이트');
        await this.updateSheets(result);
      } else {
        console.log('\n[EnhancedPauseWorkflow] Step 8/8: Google Sheets 업데이트 (건너뜀 - Repository 없음)');
      }
      
    } catch (error) {
      this.log(`❌ 워크플로우 실패: ${error.message}`, 'error');
      result.setError(error);
      result.setStatus('failed');
      
      // 에러 시 Sheets 업데이트
      if (this.sheetRepository) {
        await this.updateSheets(result);
      }
      
    } finally {
      // 브라우저 정리
      if (this.context.browser) {
        await this.services.browser.disconnect(profileId, {
          keepBrowserOpen: true
        });
      }
      
      // 실행 시간 기록
      result.setDuration(Date.now() - startTime);
      
      this.log(`워크플로우 완료 (${result.duration}ms)`, 'info');
    }
    
    return result;
  }

  /**
   * 멤버십 상태 확인 - 개선된 날짜 파싱 로직
   */
  async checkMembershipStatus() {
    const page = this.context.page;
    const language = this.context.language;
    
    // 멤버십 관리 버튼 클릭 (재시도 로직 포함)
    const clickResult = await this.services.button.clickManageButtonWithRetry(page, language, {
      maxRetries: 3,
      verifyPageChange: true,
      debugMode: this.context?.debugMode
    });
    
    if (!clickResult.clicked) {
      throw new Error('멤버십 관리 버튼을 클릭할 수 없습니다');
    }
    
    // 페이지 내용 분석
    let pageText = '';
    try {
      pageText = await page.evaluate(() => document.body.innerText || '');
    } catch (error) {
      this.log(`페이지 텍스트 추출 실패: ${error.message}`, 'warning');
    }
    const buttons = await this.services.button.getAllButtonTexts(page);
    
    const status = {
      isActive: false,
      isPaused: false,
      resumeDate: null,
      nextBillingDate: null,
      pauseDate: null
    };
    
    // 버튼으로 상태 판단
    const pauseButtonTexts = this.services.language.getLocalizedText('buttons.pause', language);
    const resumeButtonTexts = this.services.language.getLocalizedText('buttons.resume', language);
    
    // Pause 버튼이 있으면 활성 상태
    if (buttons.some(btn => pauseButtonTexts.includes(btn.text))) {
      status.isActive = true;
    }
    
    // Resume 버튼이 있으면 일시중지 상태
    if (buttons.some(btn => resumeButtonTexts.includes(btn.text))) {
      status.isPaused = true;
    }
    
    // yt-formatted-string 요소에서 날짜 직접 추출 (가장 정확한 방법)
    try {
      const ytStrings = await page.$$eval('yt-formatted-string', elements => 
        elements.map(el => el.textContent?.trim()).filter(Boolean)
      );
      
      this.log(`📋 yt-formatted-string 요소에서 날짜 검색 (${ytStrings.length}개 요소)`, 'info');
      
      // 먼저 모든 텍스트를 출력해서 확인
      for (let i = 0; i < Math.min(10, ytStrings.length); i++) {
        this.log(`  [${i}] ${ytStrings[i].substring(0, 50)}...`, 'debug');
      }
      
      for (const text of ytStrings) {
        // 짧은 날짜 패턴 (일시중지일) - "10월 3일" 형식
        if (!status.pauseDate && /\d{1,2}월\s*\d{1,2}일/.test(text)) {
          const match = text.match(/\d{1,2}월\s*\d{1,2}일/);
          if (match) {
            const parsed = this.services.dateParser.parseDate(match[0], language);
            if (parsed) {
              status.pauseDate = parsed;
              status.nextBillingDate = parsed;
              this.log(`📌 yt-formatted-string에서 일시중지일 발견: ${match[0]} → ${parsed}`, 'important');
            }
          }
        }
        
        // 긴 날짜 패턴 (재개일) - "2025. 11. 3" 형식
        if (!status.resumeDate && /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(text)) {
          const match = text.match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/);
          if (match) {
            const parsed = this.services.dateParser.parseDate(match[0], language);
            if (parsed) {
              status.resumeDate = parsed;
              this.log(`📌 yt-formatted-string에서 재개일 발견: ${match[0]} → ${parsed}`, 'info');
            }
          }
        }
      }
    } catch (error) {
      this.log(`yt-formatted-string 처리 중 오류: ${error.message}`, 'debug');
    }
    
    // 키워드 기반 날짜 추출 (fallback)
    try {
      // 언어별 키워드 정의
      const pauseKeywords = {
        ko: ['멤버십 일시중지:', '일시중지:', '일시정지:'],
        en: ['Membership pauses on:', 'pauses on:', 'Pauses on:'],
        tr: ['Üyeliğin duraklatılacağı tarih:', 'duraklatılacağı tarih:'],
        es: ['La membresía se pausará el:', 'se pausará el:'],
        pt: ['A assinatura será pausada em:', 'será pausada em:'],
        ja: ['一時停止日:', 'メンバーシップの一時停止:'],
        fr: ['L\'abonnement sera suspendu le:', 'sera suspendu le:'],
        de: ['Mitgliedschaft wird pausiert am:', 'wird pausiert am:'],
        ru: ['Подписка приостановлена:', 'приостановлена:'],
        vi: ['Tư cách thành viên tạm dừng vào:', 'tạm dừng vào:'],
        id: ['Keanggotaan dijeda pada:', 'dijeda pada:'],
        th: ['การเป็นสมาชิกจะหยุดชั่วคราวในวันที่:', 'หยุดชั่วคราวในวันที่:']
      };
      
      const resumeKeywords = {
        ko: ['멤버십 재개:', '재개:', '구독 재개:'],
        en: ['Membership resumes on:', 'resumes on:', 'Resumes on:'],
        tr: ['Üyeliğin devam ettirileceği tarih:', 'devam ettirileceği tarih:'],
        es: ['La membresía se reanudará el:', 'se reanudará el:'],
        pt: ['A assinatura será retomada em:', 'será retomada em:'],
        ja: ['再開日:', 'メンバーシップの再開:'],
        fr: ['L\'abonnement reprendra le:', 'reprendra le:'],
        de: ['Mitgliedschaft wird fortgesetzt am:', 'wird fortgesetzt am:'],
        ru: ['Подписка возобновится:', 'возобновится:'],
        vi: ['Tư cách thành viên tiếp tục vào:', 'tiếp tục vào:'],
        id: ['Keanggotaan dilanjutkan pada:', 'dilanjutkan pada:'],
        th: ['การเป็นสมาชิกจะดำเนินต่อในวันที่:', 'ดำเนินต่อในวันที่:']
      };
      
      // 텍스트를 라인별로 분석
      const lines = pageText.split(/\n|\r/);
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // 일시중지 날짜 찾기
        const pauseKeys = pauseKeywords[language] || pauseKeywords['en'];
        for (const keyword of pauseKeys) {
          if (trimmed.includes(keyword)) {
            // 키워드 이후 부분 추출
            let datePart = trimmed.substring(trimmed.indexOf(keyword) + keyword.length).trim();
            // 콜론이 있으면 제거
            datePart = datePart.replace(/^:/, '').trim();
            
            this.log(`📅 일시중지 날짜 키워드 발견: "${keyword}"`, 'info');
            this.log(`   날짜 부분: "${datePart}"`, 'debug');
            
            const parsedDate = this.services.dateParser.parseDate(datePart, language);
            if (parsedDate) {
              status.pauseDate = parsedDate;
              // 일시중지 날짜가 다음 결제일
              status.nextBillingDate = parsedDate;
              this.log(`✅ 일시중지일(다음 결제일) 파싱: ${parsedDate}`, 'info');
            }
            break;
          }
        }
        
        // 재개 날짜 찾기
        const resumeKeys = resumeKeywords[language] || resumeKeywords['en'];
        for (const keyword of resumeKeys) {
          if (trimmed.includes(keyword)) {
            // 키워드 이후 부분 추출
            let datePart = trimmed.substring(trimmed.indexOf(keyword) + keyword.length).trim();
            // 콜론이 있으면 제거
            datePart = datePart.replace(/^:/, '').trim();
            
            this.log(`📅 재개 날짜 키워드 발견: "${keyword}"`, 'info');
            this.log(`   날짜 부분: "${datePart}"`, 'debug');
            
            const parsedDate = this.services.dateParser.parseDate(datePart, language);
            if (parsedDate) {
              status.resumeDate = parsedDate;
              this.log(`✅ 재개일 파싱: ${parsedDate}`, 'info');
            }
            break;
          }
        }
      }
      
      // 중요: 일시중지일이 있으면 이것이 다음 결제일
      if (status.pauseDate) {
        status.nextBillingDate = status.pauseDate;
        this.log(`📌 일시중지일을 다음 결제일로 설정: ${status.nextBillingDate}`, 'important');
      }
      
      // 키워드 매칭이 실패하거나 날짜가 없는 경우, 전체 텍스트에서 날짜 패턴 직접 찾기
      if (!status.pauseDate || !status.resumeDate) {
        this.log('📅 키워드 매칭 실패, 전체 텍스트에서 날짜 패턴 검색', 'info');
        
        // 날짜 패턴 정의 (짧은 형식과 긴 형식 구분)
        const shortDatePatterns = [
          /\d{1,2}월\s*\d{1,2}일/g,              // 10월 3일
          /[A-Z][a-z]+\s+\d{1,2}(?![,\s]*\d{4})/g, // Oct 3 (년도 없음)
          /\d{1,2}\s+[A-Z][a-z]+(?!\s+\d{4})/g    // 3 Oct (년도 없음)
        ];
        
        const fullDatePatterns = [
          /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/g,     // 2025. 11. 3
          /\d{4}-\d{1,2}-\d{1,2}/g,             // 2025-11-03
          /[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}/g,   // Nov 3, 2025
          /\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/g      // 3 Nov 2025
        ];
        
        // 짧은 날짜 찾기 (일시중지일로 간주)
        for (const pattern of shortDatePatterns) {
          const matches = pageText.match(pattern);
          if (matches && matches.length > 0 && !status.pauseDate) {
            const parsedDate = this.services.dateParser.parseDate(matches[0], language);
            if (parsedDate) {
              status.pauseDate = parsedDate;
              status.nextBillingDate = parsedDate;
              this.log(`📅 짧은 날짜를 일시중지일로 설정: ${matches[0]} → ${parsedDate}`, 'important');
              break;
            }
          }
        }
        
        // 긴 날짜 찾기 (재개일로 간주)
        for (const pattern of fullDatePatterns) {
          const matches = pageText.match(pattern);
          if (matches && matches.length > 0 && !status.resumeDate) {
            const parsedDate = this.services.dateParser.parseDate(matches[0], language);
            if (parsedDate) {
              status.resumeDate = parsedDate;
              this.log(`📅 긴 날짜를 재개일로 설정: ${matches[0]} → ${parsedDate}`, 'info');
              
              // pauseDate가 없는 경우에만 nextBillingDate로 설정
              if (!status.nextBillingDate && !status.pauseDate) {
                status.nextBillingDate = parsedDate;
                this.log(`📌 긴 날짜를 다음 결제일로 설정 (pauseDate 없음): ${parsedDate}`, 'info');
              }
              break;
            }
          }
        }
        
        // 날짜를 모두 찾은 후 최종 확인
        if (status.pauseDate) {
          status.nextBillingDate = status.pauseDate;
          this.log(`📌 최종: 일시중지일을 다음 결제일로 확정: ${status.nextBillingDate}`, 'important');
        }
      }
      
    } catch (error) {
      this.log(`날짜 추출 중 오류: ${error.message}`, 'warning');
    }
    
    // 상태에 따른 최종 날짜 설정
    if (status.isPaused) {
      // 일시중지 상태에서 pauseDate가 있으면 그것을 다음 결제일로 (이미 위에서 설정됨)
      if (status.pauseDate && status.nextBillingDate !== status.pauseDate) {
        status.nextBillingDate = status.pauseDate;
        this.log(`📌 최종 확인: 일시중지일을 다음 결제일로 설정: ${status.nextBillingDate}`, 'info');
      }
      // pauseDate가 없지만 resumeDate가 있으면 그것을 다음 결제일로 (fallback)
      else if (!status.nextBillingDate && status.resumeDate) {
        status.nextBillingDate = status.resumeDate;
        this.log(`📌 일시중지 상태 - 재개일을 다음 결제일로 설정: ${status.nextBillingDate}`, 'info');
      }
    }
    
    // 디버그 로깅
    this.log(`🔍 상태 확인 결과:`, 'debug');
    this.log(`  - 활성: ${status.isActive}`, 'debug');
    this.log(`  - 일시중지: ${status.isPaused}`, 'debug');
    this.log(`  - 일시중지일: ${status.pauseDate || 'N/A'}`, 'debug');
    this.log(`  - 재개일: ${status.resumeDate || 'N/A'}`, 'debug');
    this.log(`  - 다음 결제일: ${status.nextBillingDate || 'N/A'}`, 'debug');
    
    return status;
  }

  /**
   * 일시중지 프로세스 실행
   */
  async executePauseProcess() {
    const page = this.context.page;
    const language = this.context.language;
    
    try {
      // 1. 일시중지 버튼 클릭
      this.log('일시중지 버튼 클릭', 'info');
      const pauseClicked = await this.services.button.clickPauseButton(page, language);
      
      if (!pauseClicked.clicked) {
        throw new Error('일시중지 버튼을 찾을 수 없습니다');
      }
      
      // 2. 확인 팝업 처리
      this.log('확인 팝업 처리', 'info');
      const popupResult = await this.services.popup.handlePausePopup(page, language);
      
      // 팝업에서 추출한 날짜 저장 
      let extractedPauseDate = null;
      let extractedResumeDate = null;
      
      if (popupResult.handled) {
        // 팝업 텍스트에서 날짜 추출 - EnhancedDateParsingService 사용
        if (popupResult.popupText) {
          // 팝업 텍스트에서 모든 날짜 찾기
          const textLines = popupResult.popupText.split(/\n|\r|\t/);
          
          for (const line of textLines) {
            // 일시중지 날짜 키워드 체크 (다국어)
            const pauseKeywords = ['paused until', 'pausado até', 'pausado hasta', 'duraklatıldı', '일시중지일', '일시 중지', 'pause'];
            const resumeKeywords = ['resume', 'retomada', 'reanudar', 'devam', '재개', 'reprendre'];
            
            const lowerLine = line.toLowerCase();
            
            // 일시중지 날짜 추출 (보통 첫 번째 날짜)
            if (!extractedPauseDate && pauseKeywords.some(keyword => lowerLine.includes(keyword))) {
              const parsedDate = this.services.dateParser.parseDate(line, language);
              if (parsedDate) {
                extractedPauseDate = parsedDate;
                this.log(`📅 일시중지 날짜 추출: ${extractedPauseDate}`, 'info');
              }
            }
            
            // 재개 날짜 추출 (보통 두 번째 날짜)
            if (!extractedResumeDate && resumeKeywords.some(keyword => lowerLine.includes(keyword))) {
              const parsedDate = this.services.dateParser.parseDate(line, language);
              if (parsedDate) {
                extractedResumeDate = parsedDate;
                this.log(`📅 재개 날짜 추출: ${extractedResumeDate}`, 'info');
              }
            }
          }
          
          // 날짜가 하나만 있는 경우 (보통 일시중지일)
          if (!extractedPauseDate && !extractedResumeDate) {
            const parsedDate = this.services.dateParser.parseDate(popupResult.popupText, language);
            if (parsedDate) {
              extractedPauseDate = parsedDate;
              this.log(`📅 단일 날짜를 일시중지일로 간주: ${extractedPauseDate}`, 'info');
            }
          }
        }
        
        // 기존 방식으로도 추출된 날짜가 있으면 사용 (fallback)
        if (!extractedPauseDate && popupResult.pauseDate) {
          extractedPauseDate = popupResult.pauseDate;
        }
        if (!extractedResumeDate && popupResult.resumeDate) {
          extractedResumeDate = popupResult.resumeDate;
        }
      }
      
      // 3. 최종 상태 확인
      await new Promise(r => setTimeout(r, 3000));
      const finalStatus = await this.verifyPauseSuccess(page, language);
      
      // 페이지에서도 날짜 추출 시도
      if ((!extractedPauseDate || !extractedResumeDate) && finalStatus.pageText) {
        const pageDate = this.services.dateParser.parseDate(finalStatus.pageText, language);
        if (pageDate) {
          if (!extractedPauseDate) extractedPauseDate = pageDate;
          if (!extractedResumeDate) extractedResumeDate = pageDate;
          this.log(`📅 페이지에서 추출한 날짜: ${pageDate}`, 'info');
        }
      }
      
      // 최종 날짜 결정 - 일시중지일을 다음 결제일로 설정
      const nextBillingDate = extractedPauseDate || extractedResumeDate || finalStatus.resumeDate;
      
      return {
        success: finalStatus.success,
        status: 'paused',
        pauseDate: extractedPauseDate || new Date().toISOString(),
        resumeDate: extractedResumeDate || finalStatus.resumeDate,
        nextBillingDate: nextBillingDate, // 일시중지일을 다음 결제일로 설정
        extractedFromPopup: !!(extractedPauseDate || extractedResumeDate)
      };
      } else {
        throw new Error('일시중지 검증 실패');
      }
      
    } catch (error) {
      this.log(`일시중지 프로세스 오류: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 일시중지 성공 검증
   */
  async verifyPauseSuccess() {
    const page = this.context.page;
    const language = this.context.language;
    
    // 페이지 새로고침
    await this.services.navigation.refresh(page);
    await new Promise(r => setTimeout(r, 2000));
    
    // 멤버십 관리 다시 클릭 (재시도 로직 포함)
    const clickResult = await this.services.button.clickManageButtonWithRetry(page, language, {
      maxRetries: 3,
      verifyPageChange: true,
      debugMode: this.context?.debugMode
    });
    
    if (!clickResult.clicked) {
      return {
        success: false,
        error: '멤버십 관리 페이지에 접근할 수 없습니다'
      };
    }
    
    // Resume 버튼 확인
    const buttons = await this.services.button.getAllButtonTexts(page);
    const resumeButtonTexts = this.services.language.getLocalizedText('buttons.resume', language);
    
    const hasResumeButton = buttons.some(btn => 
      resumeButtonTexts.some(text => btn.text.includes(text))
    );
    
    // 페이지 텍스트 가져오기
    const pageText = await page.textContent('body');
    
    if (hasResumeButton) {
      // 재개 날짜 추출
      const dates = this.services.dateParser.extractDatesFromText(pageText);
      
      return {
        success: true,
        resumeDate: dates[0] || null,
        pageText: pageText // 페이지 텍스트 추가
      };
    }
    
    return {
      success: false,
      pageText: pageText // 페이지 텍스트 추가
    };
  }

  /**
   * Google Sheets 업데이트
   */
  async updateSheets(result) {
    try {
      await this.sheetRepository.initialize();
      
      const updateData = {
        status: result.success ? '일시중지' : '오류',
        result: result.success ? '성공' : (result.error || '실패'),
        pauseDate: result.pauseDate,
        resumeDate: result.resumeDate,
        nextBillingDate: result.nextBillingDate || result.resumeDate,
        ipAddress: this.context.ipAddress || '',
        note: `언어: ${this.context.language}, 자동 처리 v2.0`
      };
      
      // 이메일 또는 프로필 ID 사용 (이메일 우선)
      const identifier = this.context.getState().profileData?.email || this.context.profileId;
      
      await this.sheetRepository.updatePauseStatus(
        identifier,
        updateData
      );
      
      this.log('Google Sheets 업데이트 완료', 'success');
      
    } catch (error) {
      this.log(`Sheets 업데이트 실패: ${error.message}`, 'warning');
    }
  }

  /**
   * 언어 표시 이름 가져오기
   */
  getLanguageDisplayName(langCode) {
    const languageNames = {
      'ko': '한국어',
      'en': 'English',
      'pt': 'Português',
      'pt-br': 'Português (Brasil)',
      'pt-pt': 'Português (Portugal)',
      'ru': 'Русский',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'it': 'Italiano',
      'tr': 'Türkçe',
      'ja': '日本語',
      'zh': '中文',
      'vi': 'Tiếng Việt',
      'th': 'ไทย',
      'id': 'Bahasa Indonesia',
      'ms': 'Bahasa Melayu',
      'ar': 'العربية',
      'hi': 'हिन्दी'
    };
    return languageNames[langCode] || langCode;
  }
  
  /**
   * 워크플로우 결과 객체 생성
   */
  createResult() {
    const WorkflowResult = require('../core/WorkflowResult');
    return new WorkflowResult({
      profileId: this.context.profileId,
      workflowType: this.workflowType
    });
  }
}

module.exports = EnhancedPauseWorkflow;