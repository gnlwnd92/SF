/**
 * Anti-Captcha 서비스
 *
 * Google 로그인 시 나타나는 이미지 CAPTCHA를 자동으로 해결합니다.
 * Anti-Captcha API (https://anti-captcha.com)를 사용합니다.
 *
 * 주요 기능:
 * - 이미지 CAPTCHA 감지 (다국어 지원)
 * - Anti-Captcha API를 통한 자동 해결
 * - 수동 대기 모드 (API 실패 시 백업)
 * - 해결 통계 추적
 *
 * @see https://anti-captcha.com/ko/apidoc/task-types/ImageToTextTask
 */

const axios = require('axios');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

class AntiCaptchaService {
  /**
   * @param {Object} config - 설정 객체
   * @param {string} config.apiKey - Anti-Captcha API 키
   * @param {boolean} config.debugMode - 디버그 모드
   * @param {number} config.maxWaitTime - 최대 대기 시간 (ms)
   * @param {number} config.manualWaitTime - 수동 해결 대기 시간 (ms)
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.ANTI_CAPTCHA_API_KEY;
    this.debugMode = config.debugMode || process.env.DEBUG_MODE === 'true';
    this.maxWaitTime = config.maxWaitTime || 120000; // 2분
    this.manualWaitTime = config.manualWaitTime || 60000; // 1분

    // Anti-Captcha API 엔드포인트
    this.apiUrl = 'https://api.anti-captcha.com';

    // 통계 추적
    this.stats = {
      detected: 0,
      solved: 0,
      failed: 0,
      manualSolved: 0
    };

    // CAPTCHA 감지 패턴 (다국어)
    this.captchaIndicators = {
      // 이미지 CAPTCHA 텍스트 입력 필드 관련
      textInput: [
        '들리거나 표시된 텍스트 입력',  // 한국어
        'Type the text you hear or see',  // 영어
        'Escribe el texto que ves o escuchas',  // 스페인어
        'Digite o texto que você vê ou ouve',  // 포르투갈어
        'Geben Sie den Text ein',  // 독일어
        '入力してください',  // 일본어
        '请输入您看到或听到的文字',  // 중국어
        'Введите текст',  // 러시아어
      ],
      // reCAPTCHA 체크박스
      recaptcha: [
        'reCAPTCHA',
        'I\'m not a robot',
        '로봇이 아닙니다',
        'No soy un robot',
        '私はロボットではありません',
        '我不是机器人',
        'Я не робот',
      ],
      // 이메일 찾기 관련 (스크린샷에서 보이는 패턴)
      emailVerify: [
        '이메일을 잊으셨나요?',
        'Forgot email?',
        '¿Olvidaste el correo?',
      ]
    };

    this.log('✅ AntiCaptchaService 초기화 완료', 'success');
    if (!this.apiKey) {
      this.log('⚠️ ANTI_CAPTCHA_API_KEY가 설정되지 않았습니다. 수동 모드로 동작합니다.', 'warning');
    }
  }

  /**
   * 로그 출력
   */
  log(message, type = 'info') {
    const prefix = chalk.gray(`[AntiCaptcha]`);
    switch (type) {
      case 'success':
        console.log(prefix, chalk.green(message));
        break;
      case 'error':
        console.log(prefix, chalk.red(message));
        break;
      case 'warning':
        console.log(prefix, chalk.yellow(message));
        break;
      case 'debug':
        if (this.debugMode) {
          console.log(prefix, chalk.gray(message));
        }
        break;
      default:
        console.log(prefix, chalk.blue(message));
    }
  }

  /**
   * 페이지에서 CAPTCHA 감지
   * @param {Page} page - Puppeteer 페이지 객체
   * @returns {Object} - { hasCaptcha, type, element }
   */
  async detectCaptcha(page) {
    try {
      const result = await page.evaluate((indicators) => {
        const bodyText = document.body?.textContent || '';
        const response = {
          hasCaptcha: false,
          type: null,
          hasInputField: false,
          hasCaptchaImage: false,
          detectedText: null
        };

        // 1. 텍스트 입력 CAPTCHA 감지
        for (const text of indicators.textInput) {
          if (bodyText.includes(text)) {
            response.hasCaptcha = true;
            response.type = 'image-to-text';
            response.detectedText = text;
            break;
          }
        }

        // 2. reCAPTCHA 감지
        if (!response.hasCaptcha) {
          for (const text of indicators.recaptcha) {
            if (bodyText.includes(text)) {
              response.hasCaptcha = true;
              response.type = 'recaptcha';
              response.detectedText = text;
              break;
            }
          }
        }

        // 3. 입력 필드 존재 확인
        const captchaInput = document.querySelector(
          'input[name="ca"], input[name="captcha"], input[aria-label*="captcha"], ' +
          'input[placeholder*="텍스트"], input[placeholder*="text"]'
        );
        response.hasInputField = !!captchaInput;

        // 4. CAPTCHA 이미지 존재 확인
        const captchaImage = document.querySelector(
          'img[src*="captcha"], img[alt*="captcha"], ' +
          '[class*="captcha"] img, [id*="captcha"] img, ' +
          'canvas[class*="captcha"]'
        );
        response.hasCaptchaImage = !!captchaImage;

        // 최종 판정: 입력 필드가 있거나 이미지가 있으면 CAPTCHA로 간주
        if (!response.hasCaptcha && (response.hasInputField || response.hasCaptchaImage)) {
          response.hasCaptcha = true;
          response.type = 'image-to-text';
        }

        return response;
      }, this.captchaIndicators);

      if (result.hasCaptcha) {
        this.stats.detected++;
        this.log(`🔍 CAPTCHA 감지됨! 유형: ${result.type}, 텍스트: ${result.detectedText}`, 'warning');
      }

      return result;
    } catch (error) {
      this.log(`CAPTCHA 감지 오류: ${error.message}`, 'error');
      return { hasCaptcha: false, type: null };
    }
  }

  /**
   * CAPTCHA 이미지 캡처
   * @param {Page} page - Puppeteer 페이지 객체
   * @returns {string|null} - base64 인코딩된 이미지 또는 null
   */
  async captureCaptchaImage(page) {
    try {
      // CAPTCHA 이미지 요소 찾기
      const captchaElement = await page.$([
        'img[src*="captcha"]',
        '[class*="captcha"] img',
        '[id*="captcha"] img',
        'canvas[class*="captcha"]',
        // Google 로그인 페이지의 CAPTCHA 이미지 선택자
        '[data-challengeresult] img',
        '[jsname="GxI4Ce"]'
      ].join(', '));

      if (captchaElement) {
        // 요소만 스크린샷
        const imageBuffer = await captchaElement.screenshot({ encoding: 'base64' });
        this.log('📸 CAPTCHA 이미지 캡처 완료 (요소)', 'debug');
        return imageBuffer;
      }

      // 요소를 못 찾으면 CAPTCHA 영역 전체 스크린샷
      const captchaContainer = await page.$([
        '[class*="captcha"]',
        '[id*="captcha"]',
        '[data-challengeresult]',
        '[jscontroller*="Captcha"]'
      ].join(', '));

      if (captchaContainer) {
        const imageBuffer = await captchaContainer.screenshot({ encoding: 'base64' });
        this.log('📸 CAPTCHA 영역 캡처 완료 (컨테이너)', 'debug');
        return imageBuffer;
      }

      // 마지막 수단: 전체 페이지 스크린샷 후 중앙 영역 추출
      this.log('⚠️ CAPTCHA 요소를 찾을 수 없어 전체 페이지 캡처', 'warning');
      const fullPageBuffer = await page.screenshot({ encoding: 'base64' });
      return fullPageBuffer;

    } catch (error) {
      this.log(`CAPTCHA 이미지 캡처 오류: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * Anti-Captcha API로 작업 생성
   * @param {string} imageBase64 - base64 인코딩된 이미지
   * @returns {number|null} - 작업 ID 또는 null
   */
  async createTask(imageBase64) {
    if (!this.apiKey) {
      this.log('API 키 없음 - 수동 모드로 전환', 'warning');
      return null;
    }

    try {
      const response = await axios.post(`${this.apiUrl}/createTask`, {
        clientKey: this.apiKey,
        task: {
          type: 'ImageToTextTask',
          body: imageBase64,
          phrase: false,        // 공백 포함 여부
          case: true,           // 대소문자 구분
          numeric: 0,           // 0=무제한, 1=숫자만, 2=숫자 제외
          math: false,          // 수식 계산 필요 여부
          minLength: 0,         // 최소 길이
          maxLength: 0,         // 최대 길이 (0=무제한)
          comment: 'Google login CAPTCHA - please solve carefully',
          languagePool: 'en'    // 작업자 풀 언어
        }
      }, {
        timeout: 30000
      });

      if (response.data.errorId === 0) {
        this.log(`✅ 작업 생성 성공! Task ID: ${response.data.taskId}`, 'success');
        return response.data.taskId;
      } else {
        this.log(`❌ 작업 생성 실패: ${response.data.errorDescription}`, 'error');
        return null;
      }
    } catch (error) {
      this.log(`API 호출 오류: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * 작업 결과 조회 (폴링)
   * @param {number} taskId - 작업 ID
   * @returns {string|null} - 해결된 텍스트 또는 null
   */
  async getTaskResult(taskId) {
    const maxAttempts = 60;  // 최대 60번 시도 (약 2분)
    const pollInterval = 2000;  // 2초 간격

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.post(`${this.apiUrl}/getTaskResult`, {
          clientKey: this.apiKey,
          taskId: taskId
        }, {
          timeout: 10000
        });

        if (response.data.errorId !== 0) {
          this.log(`결과 조회 오류: ${response.data.errorDescription}`, 'error');
          return null;
        }

        if (response.data.status === 'ready') {
          const solvedText = response.data.solution.text;
          this.log(`✅ CAPTCHA 해결 완료: "${solvedText}"`, 'success');
          this.log(`💰 비용: $${response.data.cost}`, 'debug');
          return solvedText;
        }

        this.log(`⏳ 대기 중... (${attempt}/${maxAttempts})`, 'debug');
        await new Promise(r => setTimeout(r, pollInterval));

      } catch (error) {
        this.log(`결과 조회 오류: ${error.message}`, 'error');
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }

    this.log('⚠️ CAPTCHA 해결 시간 초과', 'warning');
    return null;
  }

  /**
   * CAPTCHA 입력 필드에 텍스트 입력
   * @param {Page} page - Puppeteer 페이지 객체
   * @param {string} text - 입력할 텍스트
   * @returns {boolean} - 성공 여부
   */
  async inputCaptchaText(page, text) {
    try {
      // CAPTCHA 입력 필드 선택자들
      const inputSelectors = [
        'input[name="ca"]',
        'input[name="captcha"]',
        'input[aria-label*="captcha"]',
        'input[placeholder*="텍스트"]',
        'input[placeholder*="text"]',
        'input[type="text"][autocomplete="off"]',
        '[data-challengeresult] input',
        'input[jsname]'
      ];

      for (const selector of inputSelectors) {
        const input = await page.$(selector);
        if (input) {
          // 기존 텍스트 클리어
          await input.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');

          // 휴먼라이크 타이핑
          await this.humanLikeType(page, input, text);

          this.log(`✅ CAPTCHA 텍스트 입력 완료: "${text}"`, 'success');
          return true;
        }
      }

      this.log('❌ CAPTCHA 입력 필드를 찾을 수 없음', 'error');
      return false;

    } catch (error) {
      this.log(`CAPTCHA 텍스트 입력 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 휴먼라이크 타이핑
   */
  async humanLikeType(page, element, text) {
    for (const char of text) {
      await element.type(char);
      // 랜덤 딜레이 (50-150ms)
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    }
  }

  /**
   * 제출 버튼 클릭
   * @param {Page} page - Puppeteer 페이지 객체
   * @returns {boolean} - 성공 여부
   */
  async submitCaptcha(page) {
    try {
      // 제출 버튼 선택자들
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:contains("다음")',
        'button:contains("Next")',
        'button:contains("확인")',
        'button:contains("Verify")',
        '[jsname="LgbsSe"]',  // Google 다음 버튼
        'div[role="button"][data-idom-class*="submit"]'
      ];

      // XPath로 "다음" 버튼 찾기
      const nextButtonXPath = [
        '//button[contains(text(), "다음")]',
        '//button[contains(text(), "Next")]',
        '//span[contains(text(), "다음")]/ancestor::button',
        '//span[contains(text(), "Next")]/ancestor::button'
      ];

      // CSS 선택자로 시도
      for (const selector of submitSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            this.log('✅ 제출 버튼 클릭 완료', 'success');
            return true;
          }
        } catch (e) {
          // 다음 선택자 시도
        }
      }

      // XPath로 시도
      for (const xpath of nextButtonXPath) {
        try {
          const [button] = await page.$x(xpath);
          if (button) {
            await button.click();
            this.log('✅ 제출 버튼 클릭 완료 (XPath)', 'success');
            return true;
          }
        } catch (e) {
          // 다음 XPath 시도
        }
      }

      this.log('⚠️ 제출 버튼을 찾을 수 없음', 'warning');
      return false;

    } catch (error) {
      this.log(`제출 버튼 클릭 오류: ${error.message}`, 'error');
      return false;
    }
  }

  /**
   * 수동 해결 대기 모드
   * @param {Page} page - Puppeteer 페이지 객체
   * @param {number} timeout - 최대 대기 시간 (ms)
   * @returns {boolean} - 해결 여부
   */
  async waitForManualSolve(page, timeout = null) {
    const waitTime = timeout || this.manualWaitTime;

    this.log(`\n${'='.repeat(60)}`, 'warning');
    this.log(`⚠️  CAPTCHA 수동 해결 필요!`, 'warning');
    this.log(`브라우저에서 직접 CAPTCHA를 해결해주세요.`, 'warning');
    this.log(`대기 시간: ${waitTime / 1000}초`, 'warning');
    this.log(`${'='.repeat(60)}\n`, 'warning');

    const startTime = Date.now();
    const checkInterval = 2000;  // 2초마다 체크

    while (Date.now() - startTime < waitTime) {
      // CAPTCHA가 사라졌는지 확인
      const detection = await this.detectCaptcha(page);

      if (!detection.hasCaptcha) {
        this.log('✅ CAPTCHA가 해결되었습니다!', 'success');
        this.stats.manualSolved++;
        return true;
      }

      // URL 변경 확인 (로그인 성공)
      const currentUrl = page.url();
      if (!currentUrl.includes('captcha') && !currentUrl.includes('signin/challenge')) {
        this.log('✅ 페이지가 변경되었습니다 (로그인 성공 추정)', 'success');
        this.stats.manualSolved++;
        return true;
      }

      const remaining = Math.ceil((waitTime - (Date.now() - startTime)) / 1000);
      this.log(`⏳ 남은 시간: ${remaining}초...`, 'debug');

      await new Promise(r => setTimeout(r, checkInterval));
    }

    this.log('⚠️ 수동 해결 시간 초과', 'warning');
    return false;
  }

  /**
   * CAPTCHA 해결 (메인 메서드)
   * @param {Page} page - Puppeteer 페이지 객체
   * @param {Object} options - 옵션
   * @returns {Object} - { success, method, text }
   */
  async solveCaptcha(page, options = {}) {
    const { forceManual = false, screenshotPath = null } = options;

    this.log('\n🔐 CAPTCHA 해결 프로세스 시작', 'info');

    // 1. CAPTCHA 감지
    const detection = await this.detectCaptcha(page);

    if (!detection.hasCaptcha) {
      this.log('ℹ️ CAPTCHA가 감지되지 않았습니다', 'info');
      return { success: true, method: 'none', text: null };
    }

    // 2. 스크린샷 저장 (디버그용)
    if (screenshotPath || this.debugMode) {
      const timestamp = Date.now();
      const savePath = screenshotPath || `screenshots/captcha_${timestamp}.png`;
      try {
        await page.screenshot({ path: savePath, fullPage: true });
        this.log(`📸 CAPTCHA 스크린샷 저장: ${savePath}`, 'debug');
      } catch (e) {
        // 무시
      }
    }

    // 3. API 키가 없거나 수동 모드 강제인 경우
    if (!this.apiKey || forceManual) {
      this.log('수동 해결 모드로 전환', 'info');
      const manualResult = await this.waitForManualSolve(page);
      return {
        success: manualResult,
        method: 'manual',
        text: null
      };
    }

    // 4. Anti-Captcha API로 자동 해결 시도
    this.log('🤖 Anti-Captcha API로 자동 해결 시도', 'info');

    // 4-1. CAPTCHA 이미지 캡처
    const imageBase64 = await this.captureCaptchaImage(page);

    if (!imageBase64) {
      this.log('이미지 캡처 실패 - 수동 모드로 전환', 'warning');
      const manualResult = await this.waitForManualSolve(page);
      return { success: manualResult, method: 'manual', text: null };
    }

    // 4-2. 작업 생성
    const taskId = await this.createTask(imageBase64);

    if (!taskId) {
      this.log('작업 생성 실패 - 수동 모드로 전환', 'warning');
      const manualResult = await this.waitForManualSolve(page);
      return { success: manualResult, method: 'manual', text: null };
    }

    // 4-3. 결과 대기
    const solvedText = await this.getTaskResult(taskId);

    if (!solvedText) {
      this.log('CAPTCHA 해결 실패 - 수동 모드로 전환', 'warning');
      this.stats.failed++;
      const manualResult = await this.waitForManualSolve(page);
      return { success: manualResult, method: 'manual', text: null };
    }

    // 4-4. 텍스트 입력
    const inputSuccess = await this.inputCaptchaText(page, solvedText);

    if (!inputSuccess) {
      this.log('텍스트 입력 실패 - 수동 모드로 전환', 'warning');
      const manualResult = await this.waitForManualSolve(page);
      return { success: manualResult, method: 'manual', text: solvedText };
    }

    // 4-5. 제출
    await new Promise(r => setTimeout(r, 500)); // 짧은 대기
    await this.submitCaptcha(page);

    // 4-6. 결과 확인 (잠시 대기 후)
    await new Promise(r => setTimeout(r, 3000));

    const afterDetection = await this.detectCaptcha(page);

    if (!afterDetection.hasCaptcha) {
      this.log('✅ CAPTCHA 자동 해결 성공!', 'success');
      this.stats.solved++;
      return { success: true, method: 'auto', text: solvedText };
    } else {
      this.log('⚠️ CAPTCHA가 여전히 존재함 - 수동 모드로 전환', 'warning');
      this.stats.failed++;
      const manualResult = await this.waitForManualSolve(page);
      return { success: manualResult, method: 'manual', text: solvedText };
    }
  }

  /**
   * API 잔액 확인
   * @returns {number|null} - 잔액 (USD) 또는 null
   */
  async getBalance() {
    if (!this.apiKey) {
      return null;
    }

    try {
      const response = await axios.post(`${this.apiUrl}/getBalance`, {
        clientKey: this.apiKey
      }, {
        timeout: 10000
      });

      if (response.data.errorId === 0) {
        const balance = response.data.balance;
        this.log(`💰 API 잔액: $${balance.toFixed(4)}`, 'info');
        return balance;
      } else {
        this.log(`잔액 조회 실패: ${response.data.errorDescription}`, 'error');
        return null;
      }
    } catch (error) {
      this.log(`잔액 조회 오류: ${error.message}`, 'error');
      return null;
    }
  }

  /**
   * 통계 조회
   * @returns {Object} - 통계 객체
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.detected > 0
        ? ((this.stats.solved + this.stats.manualSolved) / this.stats.detected * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }

  /**
   * 통계 출력
   */
  printStats() {
    const stats = this.getStats();
    console.log('\n' + chalk.cyan('═'.repeat(50)));
    console.log(chalk.cyan.bold('📊 CAPTCHA 해결 통계'));
    console.log(chalk.cyan('═'.repeat(50)));
    console.log(chalk.white(`  감지됨:      ${stats.detected}`));
    console.log(chalk.green(`  자동 해결:   ${stats.solved}`));
    console.log(chalk.yellow(`  수동 해결:   ${stats.manualSolved}`));
    console.log(chalk.red(`  실패:        ${stats.failed}`));
    console.log(chalk.blue(`  성공률:      ${stats.successRate}`));
    console.log(chalk.cyan('═'.repeat(50)) + '\n');
  }
}

module.exports = AntiCaptchaService;
