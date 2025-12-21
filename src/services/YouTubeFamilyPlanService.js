/**
 * YouTubeFamilyPlanService - YouTube Music Family Plan 체크 서비스
 * 
 * 기능:
 * - YouTube Music Family Plan 페이지 접속
 * - 가입 가능 여부 감지
 * - 가격 정보 추출
 * - 지역 제한 확인
 * - 스크린샷 증거 저장
 */

const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

class YouTubeFamilyPlanService {
  constructor(options = {}) {
    this.debugMode = options.debugMode || false;
    this.screenshotDir = options.screenshotDir || 'screenshots/family-plan';
    
    // YouTube Music Family Plan URL
    this.FAMILY_PLAN_URL = 'https://music.youtube.com/youtube_premium/family';
    
    // 감지 패턴 정의 (다국어 지원)
    this.detectionPatterns = {
      // 가입 가능 상태
      eligible: {
        patterns: [
          // 영어
          /get family plan/i,
          /start your family group/i,
          /create.*family.*group/i,
          /₨\s*299/,  // 파키스탄 루피
          /PKR\s*299/,
          /RS\s*299/i,
          
          // 한국어
          /가족 요금제.*시작/,
          /가족 그룹.*만들/,
          /₨\s*299.*월/,
          
          // 스페인어
          /plan familiar/i,
          /crear.*grupo.*familiar/i,
          
          // 아랍어
          /العائلة/,
          /خطة العائلة/
        ],
        confidence: 0.9
      },
      
      // 이미 가입됨
      alreadyMember: {
        patterns: [
          // 영어
          /manage.*family.*group/i,
          /you.*already.*family.*group/i,
          /current.*plan/i,
          /your.*family.*members/i,
          /invite.*family.*members/i,
          
          // 한국어
          /가족 그룹.*관리/,
          /이미.*가족.*그룹/,
          /현재.*요금제/,
          /가족.*구성원/,
          
          // 기타
          /administrar.*grupo.*familiar/i,
          /gérer.*groupe.*familial/i
        ],
        confidence: 0.9
      },
      
      // 지역 제한
      regionBlocked: {
        patterns: [
          // 영어
          /not.*available.*country/i,
          /not.*available.*region/i,
          /region.*restricted/i,
          /unavailable.*location/i,
          
          // 한국어
          /지역.*사용.*불가/,
          /국가.*이용.*불가/,
          /해당.*지역.*제공/,
          
          // 기타
          /no.*disponible.*país/i,
          /non.*disponible.*pays/i,
          /nicht.*verfügbar.*land/i
        ],
        confidence: 0.85
      },
      
      // 오류 상태
      error: {
        patterns: [
          /something.*went.*wrong/i,
          /error.*occurred/i,
          /try.*again.*later/i,
          /오류.*발생/,
          /다시.*시도/,
          /문제.*발생/
        ],
        confidence: 0.8
      }
    };
    
    // 가격 추출 패턴
    this.pricePatterns = [
      // 파키스탄 루피
      /₨\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
      /PKR\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      /RS\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i,
      
      // 일반 통화
      /\$\s*(\d+(?:\.\d{2})?)/,
      /€\s*(\d+(?:\.\d{2})?)/,
      /£\s*(\d+(?:\.\d{2})?)/,
      /₩\s*(\d+(?:,\d{3})*)/,
      /¥\s*(\d+(?:,\d{3})*)/
    ];
  }

  /**
   * Family Plan 페이지로 이동 및 체크
   */
  async checkFamilyPlan(page, profileInfo = {}) {
    const startTime = Date.now();
    console.log(chalk.cyan('🎯 YouTube Family Plan 체크 시작'));
    
    try {
      // 1. Family Plan 페이지로 이동
      console.log(chalk.gray(`페이지 이동: ${this.FAMILY_PLAN_URL}`));
      
      await page.goto(this.FAMILY_PLAN_URL, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // 페이지 로딩 대기
      await this.delay(3000);
      
      // 2. 로그인 상태 확인
      const isLoggedIn = await this.checkLoginStatus(page);
      if (!isLoggedIn) {
        console.log(chalk.yellow('⚠️ 로그인 필요'));
        return {
          status: 'LOGIN_REQUIRED',
          message: '로그인이 필요합니다',
          profileId: profileInfo.id
        };
      }
      
      // 3. 페이지 콘텐츠 분석
      const pageContent = await this.extractPageContent(page);
      
      // 4. Family Plan 상태 감지
      const detectionResult = this.detectStatus(pageContent);
      
      // 5. 가격 정보 추출
      const priceInfo = this.extractPrice(pageContent);
      
      // 6. 스크린샷 저장
      const screenshotPath = await this.captureEvidence(page, profileInfo, detectionResult.status);
      
      // 7. 결과 생성
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      const result = {
        status: detectionResult.status,
        confidence: detectionResult.confidence,
        message: detectionResult.message,
        price: priceInfo,
        screenshot: screenshotPath,
        duration,
        timestamp: new Date().toISOString(),
        profileId: profileInfo.id,
        profileName: profileInfo.name
      };
      
      // 상태별 로그
      this.logResult(result);
      
      return result;
      
    } catch (error) {
      console.error(chalk.red(`❌ Family Plan 체크 실패: ${error.message}`));
      
      // 에러 스크린샷
      const errorScreenshot = await this.captureEvidence(
        page, 
        profileInfo, 
        'ERROR'
      ).catch(() => null);
      
      return {
        status: 'ERROR',
        message: error.message,
        screenshot: errorScreenshot,
        duration: ((Date.now() - startTime) / 1000).toFixed(2),
        timestamp: new Date().toISOString(),
        profileId: profileInfo.id
      };
    }
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus(page) {
    try {
      // YouTube Music 로그인 확인 방법들
      
      // 1. 프로필 이미지 확인
      const profileImage = await page.$('img[alt*="Google"]');
      if (profileImage) return true;
      
      // 2. 로그인 버튼이 없는지 확인
      const signInButton = await page.$('a[aria-label*="Sign in"]');
      if (!signInButton) return true;
      
      // 3. URL에서 로그인 페이지로 리다이렉트되었는지 확인
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com')) {
        return false;
      }
      
      // 4. 쿠키 확인
      const cookies = await page.cookies();
      const authCookies = cookies.filter(c => 
        c.name === 'SID' || 
        c.name === 'HSID' || 
        c.name === 'SSID'
      );
      
      return authCookies.length > 0;
      
    } catch (error) {
      console.error('로그인 상태 확인 실패:', error);
      return false;
    }
  }

  /**
   * 페이지 콘텐츠 추출
   */
  async extractPageContent(page) {
    try {
      // 여러 방법으로 콘텐츠 추출
      
      // 1. 전체 텍스트 콘텐츠
      const textContent = await page.evaluate(() => {
        return document.body.innerText || document.body.textContent || '';
      });
      
      // 2. 주요 요소들의 텍스트
      const mainContent = await page.evaluate(() => {
        const elements = [];
        
        // 제목들
        document.querySelectorAll('h1, h2, h3').forEach(el => {
          elements.push(el.innerText);
        });
        
        // 버튼들
        document.querySelectorAll('button').forEach(el => {
          elements.push(el.innerText);
        });
        
        // 가격 정보가 있을 만한 요소들
        document.querySelectorAll('[class*="price"], [class*="cost"], [class*="amount"]').forEach(el => {
          elements.push(el.innerText);
        });
        
        // 링크들
        document.querySelectorAll('a').forEach(el => {
          elements.push(el.innerText);
        });
        
        return elements.join(' ');
      });
      
      // 3. HTML 구조 (필요시)
      const htmlContent = await page.content();
      
      return {
        text: textContent,
        main: mainContent,
        html: htmlContent,
        url: page.url()
      };
      
    } catch (error) {
      console.error('콘텐츠 추출 실패:', error);
      return {
        text: '',
        main: '',
        html: '',
        url: page.url()
      };
    }
  }

  /**
   * Family Plan 상태 감지
   */
  detectStatus(pageContent) {
    const combinedText = `${pageContent.text} ${pageContent.main}`.toLowerCase();
    
    // 각 상태별로 체크
    for (const [status, config] of Object.entries(this.detectionPatterns)) {
      for (const pattern of config.patterns) {
        if (pattern.test(combinedText)) {
          if (this.debugMode) {
            console.log(chalk.gray(`매칭 패턴: ${pattern} → ${status}`));
          }
          
          return {
            status: status.toUpperCase(),
            confidence: config.confidence,
            message: this.getStatusMessage(status),
            matchedPattern: pattern.toString()
          };
        }
      }
    }
    
    // 패턴이 매칭되지 않은 경우
    return {
      status: 'UNKNOWN',
      confidence: 0.5,
      message: '상태를 확인할 수 없습니다',
      matchedPattern: null
    };
  }

  /**
   * 가격 정보 추출
   */
  extractPrice(pageContent) {
    const combinedText = `${pageContent.text} ${pageContent.main}`;
    
    for (const pattern of this.pricePatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        return {
          amount: match[1],
          currency: this.detectCurrency(match[0]),
          full: match[0]
        };
      }
    }
    
    return null;
  }

  /**
   * 통화 감지
   */
  detectCurrency(priceString) {
    if (priceString.includes('₨') || priceString.match(/PKR/i) || priceString.match(/RS/i)) {
      return 'PKR'; // 파키스탄 루피
    } else if (priceString.includes('$')) {
      return 'USD';
    } else if (priceString.includes('€')) {
      return 'EUR';
    } else if (priceString.includes('£')) {
      return 'GBP';
    } else if (priceString.includes('₩')) {
      return 'KRW';
    } else if (priceString.includes('¥')) {
      return 'JPY';
    }
    return 'UNKNOWN';
  }

  /**
   * 스크린샷 증거 저장
   */
  async captureEvidence(page, profileInfo, status) {
    try {
      // 디렉토리 생성
      await fs.mkdir(this.screenshotDir, { recursive: true });
      
      // 파일명 생성
      const timestamp = Date.now();
      const profileName = profileInfo.name || profileInfo.id || 'unknown';
      const fileName = `family-plan-${profileName}-${status}-${timestamp}.png`;
      const filePath = path.join(this.screenshotDir, fileName);
      
      // 스크린샷 캡처
      await page.screenshot({
        path: filePath,
        fullPage: true
      });
      
      console.log(chalk.gray(`📸 스크린샷 저장: ${fileName}`));
      
      return filePath;
      
    } catch (error) {
      console.error('스크린샷 저장 실패:', error);
      return null;
    }
  }

  /**
   * 상태 메시지 생성
   */
  getStatusMessage(status) {
    const messages = {
      eligible: '✅ Family Plan 가입 가능',
      alreadyMember: '⚠️ 이미 Family Plan 가입됨',
      regionBlocked: '❌ 해당 지역에서 이용 불가',
      error: '❗ 오류 발생',
      unknown: '❓ 상태 불명'
    };
    
    return messages[status] || messages.unknown;
  }

  /**
   * 결과 로깅
   */
  logResult(result) {
    const statusColors = {
      ELIGIBLE: chalk.green,
      ALREADYMEMBER: chalk.yellow,
      REGIONBLOCKED: chalk.red,
      ERROR: chalk.red,
      UNKNOWN: chalk.gray,
      LOGIN_REQUIRED: chalk.blue
    };
    
    const color = statusColors[result.status] || chalk.white;
    
    console.log(color(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(color(`📊 Family Plan 체크 결과`));
    console.log(color(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(color(`상태: ${result.message}`));
    console.log(color(`신뢰도: ${(result.confidence * 100).toFixed(0)}%`));
    
    if (result.price) {
      console.log(color(`가격: ${result.price.full} (${result.price.currency})`));
    }
    
    console.log(color(`프로필: ${result.profileName || result.profileId}`));
    console.log(color(`소요 시간: ${result.duration}초`));
    console.log(color(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = YouTubeFamilyPlanService;