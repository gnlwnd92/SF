/**
 * ButtonInteractionService - 버튼 상호작용 서비스
 * 
 * 모든 버튼 찾기 및 클릭 로직을 중앙화
 * 다국어 지원 및 다양한 선택자 패턴 처리
 */

const chalk = require('chalk');

class ButtonInteractionService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      waitTimeout: config.waitTimeout || 2000,
      scrollAttempts: config.scrollAttempts || 3,
      useNaturalInteraction: true, // 자연스러운 상호작용 활성화
      ...config
    };
  }

  /**
   * 멤버십 관리 버튼 클릭
   */
  async clickManageButton(page, language = 'en') {
    const searchTexts = this.getManageButtonTexts(language);
    
    const result = await this.clickButtonByTexts(page, searchTexts, {
      description: 'Manage Membership',
      scrollIfNotFound: true
    });
    
    if (result.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
    }
    
    return result;
  }

  /**
   * 멤버십 관리 버튼 클릭 (페이지 변경 확인 및 재시도 포함)
   * 페이지 내용이 변경되지 않으면 새로고침 후 재시도
   */
  async clickManageButtonWithRetry(page, language = 'en', options = {}) {
    const {
      maxRetries = 3,
      verifyPageChange = true,
      debugMode = this.config.debugMode
    } = options;

    let attempt = 0;
    let lastResult = { clicked: false };

    while (attempt < maxRetries) {
      attempt++;
      
      if (debugMode) {
        console.log(chalk.cyan(`\n🔄 멤버십 관리 버튼 클릭 시도 ${attempt}/${maxRetries}`));
      }

      // 이전 페이지 내용 저장 (페이지 변경 확인용)
      let previousContent = '';
      if (verifyPageChange) {
        previousContent = await page.evaluate(() => {
          return document.body?.innerText || '';
        });
      }

      // 멤버십 관리 버튼 클릭
      const clickResult = await this.clickManageButton(page, language);
      lastResult = clickResult;

      if (!clickResult.clicked) {
        if (debugMode) {
          console.log(chalk.yellow('⚠️ 멤버십 관리 버튼을 찾을 수 없습니다'));
        }
        
        // 버튼을 찾을 수 없으면 페이지 새로고침 후 재시도
        if (attempt < maxRetries) {
          await this.refreshAndWait(page, debugMode);
          continue;
        }
        break;
      }

      // 버튼 클릭 성공
      if (debugMode) {
        console.log(chalk.green('✅ 멤버십 관리 버튼 클릭 성공'));
      }

      // 페이지 변경 확인이 필요한 경우
      if (verifyPageChange) {
        // 페이지 로드 대기
        await new Promise(r => setTimeout(r, 2000));

        // 페이지 내용 변경 확인
        const currentContent = await page.evaluate(() => {
          return document.body?.innerText || '';
        });

        const pageChanged = this.hasPageContentChanged(previousContent, currentContent);

        if (pageChanged) {
          if (debugMode) {
            console.log(chalk.green('✅ 페이지 내용 변경 확인됨'));
          }
          
          // 추가로 pause/resume 버튼 존재 확인
          const hasPauseOrResume = await this.checkForPauseResumeButtons(page, language);
          if (hasPauseOrResume) {
            if (debugMode) {
              console.log(chalk.green('✅ 일시중지/재개 버튼 발견'));
            }
            return { ...clickResult, pageChanged: true, verified: true };
          }
        } else {
          if (debugMode) {
            console.log(chalk.yellow('⚠️ 페이지 내용 변경이 감지되지 않음'));
          }
        }

        // 페이지가 변경되지 않았고 재시도가 가능한 경우
        if (!pageChanged && attempt < maxRetries) {
          if (debugMode) {
            console.log(chalk.cyan('🔄 페이지 새로고침 후 재시도합니다...'));
          }
          await this.refreshAndWait(page, debugMode);
          continue;
        }

        // 마지막 시도였거나 페이지가 변경된 경우
        return { ...clickResult, pageChanged, attempt };
      }

      // 페이지 변경 확인이 필요 없는 경우 성공 반환
      return { ...clickResult, attempt };
    }

    // 모든 시도 실패
    return { ...lastResult, attempt: maxRetries, failed: true };
  }

  /**
   * 페이지 새로고침 및 랜덤 대기
   */
  async refreshAndWait(page, debugMode = false) {
    if (debugMode) {
      console.log(chalk.gray('📄 페이지를 새로고침합니다...'));
    }
    
    await page.reload({ waitUntil: 'domcontentloaded' });
    
    // 2-3초 랜덤 대기 (사람처럼 보이도록)
    const waitTime = 2000 + Math.random() * 1000;
    if (debugMode) {
      console.log(chalk.gray(`⏳ ${(waitTime/1000).toFixed(1)}초 대기 중...`));
    }
    await new Promise(r => setTimeout(r, waitTime));
  }

  /**
   * 페이지 내용 변경 확인
   */
  hasPageContentChanged(previousContent, currentContent) {
    // 단순 길이 비교
    if (Math.abs(previousContent.length - currentContent.length) > 100) {
      return true;
    }

    // 주요 키워드 변경 확인
    const keywords = ['pause', '일시중지', 'resume', '재개', 'membership', '멤버십'];
    for (const keyword of keywords) {
      const prevCount = (previousContent.match(new RegExp(keyword, 'gi')) || []).length;
      const currCount = (currentContent.match(new RegExp(keyword, 'gi')) || []).length;
      if (prevCount !== currCount) {
        return true;
      }
    }

    return false;
  }

  /**
   * 일시중지/재개 버튼 존재 확인
   */
  async checkForPauseResumeButtons(page, language = 'en') {
    const pauseTexts = this.getPauseButtonTexts(language);
    const resumeTexts = this.getResumeButtonTexts(language);
    const allTexts = [...pauseTexts, ...resumeTexts];

    const hasButton = await this.hasButton(page, allTexts);
    return hasButton;
  }

  /**
   * 일시중지 버튼 클릭 (페이지 내)
   */
  async clickPauseButton(page, language = 'en') {
    const pauseTexts = this.getPauseButtonTexts(language);
    
    // 먼저 컨텍스트 내에서 찾기
    const contextResult = await this.clickButtonInContext(page, {
      contextTexts: ['멤버십 일시중지', 'Pause membership'],
      buttonTexts: pauseTexts,
      description: 'Pause'
    });
    
    if (contextResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
      return contextResult;
    }
    
    // 직접 버튼 찾기
    const directResult = await this.clickButtonByTexts(page, pauseTexts, {
      description: 'Pause',
      scrollIfNotFound: true
    });
    
    if (directResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
    }
    
    return directResult;
  }

  /**
   * 재개 버튼 클릭 (페이지 내)
   */
  async clickResumeButton(page, language = 'en') {
    const resumeTexts = this.getResumeButtonTexts(language);
    
    // 먼저 컨텍스트 내에서 찾기
    const contextResult = await this.clickButtonInContext(page, {
      contextTexts: ['멤버십 재개', 'Resume membership'],
      buttonTexts: resumeTexts,
      description: 'Resume'
    });
    
    if (contextResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
      return contextResult;
    }
    
    // 직접 버튼 찾기
    const directResult = await this.clickButtonByTexts(page, resumeTexts, {
      description: 'Resume',
      scrollIfNotFound: true
    });
    
    if (directResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
    }
    
    return directResult;
  }

  /**
   * 구독 만료 상태 확인
   * "Get YouTube Premium" 버튼이 있으면 구독이 만료된 것
   */
  async checkSubscriptionExpired(page) {
    try {
      const expiredIndicators = [
        'Get YouTube Premium',
        'YouTube Premium 구매',
        'YouTube Premium 가입',
        'Try it free',
        '무료로 사용해 보기',
        'Start your free trial',
        '무료 평가판 시작',
        'Get Premium',
        'Premium 구매',
        'Obtenir YouTube Premium',
        'Получить YouTube Premium',
        'Consigue YouTube Premium',
        'YouTube Premium kaufen'
      ];

      const result = await page.evaluate((texts) => {
        // 버튼 텍스트로 확인
        const buttons = document.querySelectorAll('button, a[role="button"], tp-yt-paper-button');
        for (const btn of buttons) {
          const btnText = btn.textContent?.trim();
          if (btnText && texts.some(text => btnText.includes(text))) {
            return {
              expired: true,
              indicator: btnText,
              type: 'button'
            };
          }
        }

        // 페이지 전체 텍스트로 확인 (멤버십 관리 페이지가 열리지 않은 경우)
        const pageText = document.body?.textContent || '';
        for (const text of texts) {
          if (pageText.includes(text)) {
            return {
              expired: true,
              indicator: text,
              type: 'text'
            };
          }
        }

        // 만료되지 않음
        return { expired: false };
      }, expiredIndicators);

      if (result.expired) {
        console.log(chalk.yellow(`⚠️ 구독 만료 감지: ${result.indicator}`));
      }

      return result;
    } catch (error) {
      console.log(chalk.red(`❌ 구독 만료 확인 실패: ${error.message}`));
      return { expired: false, error: error.message };
    }
  }

  /**
   * 팝업 내 확인 버튼 클릭
   */
  async clickPopupConfirmButton(page, language = 'en', action = 'confirm') {
    const confirmTexts = this.getConfirmButtonTexts(language, action);
    
    const result = await page.evaluate((texts) => {
      const dialogs = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], tp-yt-paper-dialog'
      );
      
      for (const dialog of dialogs) {
        if (dialog.offsetHeight === 0) continue;
        
        const buttons = dialog.querySelectorAll('button');
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          
          // 취소 버튼 제외
          if (btnText && (btnText === '취소' || btnText === 'Cancel')) {
            continue;
          }
          
          if (btnText && texts.some(text => btnText === text || btnText.includes(text))) {
            button.click();
            return {
              clicked: true,
              text: btnText,
              inDialog: true
            };
          }
        }
      }
      
      return { clicked: false };
    }, confirmTexts);
    
    if (result.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitTimeout));
    }
    
    return result;
  }

  /**
   * 텍스트로 버튼 찾아 클릭 (일반)
   */
  async clickButtonByTexts(page, searchTexts, options = {}) {
    const { description = 'button', scrollIfNotFound = false } = options;
    
    if (this.config.debugMode) {
      console.log(chalk.gray(`Finding ${description} button...`));
    }
    
    // 첫 시도
    let result = await this.attemptClick(page, searchTexts);
    
    if (!result.clicked && scrollIfNotFound) {
      // 스크롤 후 재시도
      for (let i = 0; i < this.config.scrollAttempts; i++) {
        if (this.config.debugMode) {
          console.log(chalk.gray(`Scroll attempt ${i + 1}/${this.config.scrollAttempts}`));
        }
        
        await page.evaluate(() => window.scrollBy(0, 300));
        await new Promise(r => setTimeout(r, 500));
        
        result = await this.attemptClick(page, searchTexts);
        if (result.clicked) break;
      }
    }
    
    if (this.config.debugMode) {
      if (result.clicked) {
        console.log(chalk.green(`✓ Clicked ${description}: "${result.text}"`));
      } else {
        console.log(chalk.yellow(`✗ ${description} button not found`));
      }
    }
    
    return result;
  }

  /**
   * 구독 만료 상태 체크 (개선된 버전)
   * Manage membership 클릭 후 화면에서만 정확한 판단
   */
  async checkSubscriptionExpired(page, afterManageClick = false) {
    try {
      const result = await page.evaluate((afterManageClick) => {
        const pageText = document.body?.textContent || '';
        const pageHTML = document.body?.innerHTML || '';

        // 만료 상태를 나타내는 핵심 지표들
        const inactiveSectionIndicators = [
          'Inactive Memberships',
          '비활성 멤버십',
          'Assinaturas inativas',
          'Неактивные подписки',
          'Suscripciones inactivas',
          'Mitgliedschaften inaktiv'
        ];

        // 만료 날짜 패턴 (다양한 언어 지원)
        const expiredDatePatterns = [
          /Expired:\s*[A-Za-z]+\s+\d{1,2},?\s*\d{4}/i,  // 영어: "Expired: Sep 10, 2025"
          /만료:\s*\d{4}년\s*\d{1,2}월\s*\d{1,2}일/,  // 한국어: "만료: 2025년 10월 9일"
          /Подписка\s+закончилась\s+\d{1,2}\s+[а-яА-Я]+\.?\s+\d{4}/i,  // 러시아어: "Подписка закончилась 9 окт. 2025"
          /закончилась\s+\d{1,2}\s+[а-яА-Я]+\.?\s+\d{4}/i,  // 러시아어 단축형
          /истекла\s+\d{1,2}\s+[а-яА-Я]+\.?\s+\d{4}/i,  // 러시아어: "истекла"
          /A\s+assinatura\s+expirou\s+em/i,  // 포르투갈어
          /La\s+suscripción\s+venció/i,  // 스페인어
          /L'abonnement\s+a\s+expiré/i,  // 프랑스어
          /Das\s+Abo\s+ist\s+abgelaufen/i,  // 독일어
          /期限切れ/,  // 일본어
          /已过期/,  // 중국어 간체
          /已過期/  // 중국어 번체
        ];

        // 만료를 나타내는 텍스트 지표들 (날짜 없이)
        const expiredTextIndicators = [
          'Подписка закончилась',  // 러시아어: "구독이 종료되었습니다"
          'Subscription expired',
          '구독 만료',
          'Assinatura expirou',
          'Suscripción vencida',
          'Abonnement expiré',
          'Abo abgelaufen',
          '期限切れ',
          '已过期'
        ];

        // 활성 멤버십 지표들 (만료되지 않은 상태)
        const activeMembershipIndicators = [
          'Membership pauses on',
          'Membership resumes on',
          '멤버십 일시중지 날짜',
          '멤버십 재개 날짜',
          'Pause membership',
          'Resume membership',
          'Cancel membership',
          'Приостановить подписку',  // 러시아어: "구독 일시정지"
          'Возобновить подписку',  // 러시아어: "구독 재개"
          'Отменить подписку'  // 러시아어: "구독 취소"
        ];

        let expired = false;
        let indicator = null;
        
        // afterManageClick이 true인 경우에만 정확한 판단
        if (afterManageClick) {
          // 1. Inactive Memberships 섹션이 있는지 확인 (최우선)
          for (const text of inactiveSectionIndicators) {
            if (pageText.includes(text)) {
              expired = true;
              indicator = `${text} section found after Manage click`;
              break;
            }
          }
          
          // 2. 명시적인 만료 날짜 패턴 확인
          if (!expired) {
            for (const pattern of expiredDatePatterns) {
              if (pattern.test(pageText)) {
                const match = pageText.match(pattern);
                if (match) {
                  expired = true;
                  indicator = match[0];
                  break;
                }
              }
            }
          }

          // 3. 만료 텍스트 지표 확인 (날짜 없이)
          if (!expired) {
            for (const text of expiredTextIndicators) {
              if (pageText.includes(text)) {
                expired = true;
                indicator = `Expired indicator: ${text}`;
                break;
              }
            }
          }
          
          // 4. 활성 멤버십 지표가 있으면 만료되지 않은 것으로 판단
          if (!expired) {
            for (const text of activeMembershipIndicators) {
              if (pageText.includes(text)) {
                expired = false;
                indicator = `Active membership indicator: ${text}`;
                break;
              }
            }
          }
        } else {
          // Manage 클릭 전에는 간단한 체크만 수행
          // 1. Inactive Memberships 섹션이 메인 페이지에 보이는 경우
          for (const text of inactiveSectionIndicators) {
            if (pageText.includes(text)) {
              expired = true;
              indicator = `${text} section found on main page`;
              break;
            }
          }

          // 2. 만료 텍스트가 보이는 경우
          if (!expired) {
            for (const text of expiredTextIndicators) {
              if (pageText.includes(text)) {
                expired = true;
                indicator = `Expired text on main page: ${text}`;
                break;
              }
            }
          }

          // 3. 만료 날짜 패턴이 보이는 경우
          if (!expired) {
            for (const pattern of expiredDatePatterns) {
              if (pattern.test(pageText)) {
                const match = pageText.match(pattern);
                if (match) {
                  expired = true;
                  indicator = `Expired date on main page: ${match[0]}`;
                  break;
                }
              }
            }
          }
        }
        
        // Manage membership 버튼 존재 여부
        const hasManageButton = !!document.querySelector('button[aria-label*="Manage membership"]') ||
                                Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Manage membership')) ||
                                pageText.includes('Manage membership');
        
        // Resume/Cancel 버튼 존재 여부 (일시중지 상태)
        const hasResumeButton = !!document.querySelector('button[aria-label*="Resume"]') ||
                                Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Resume')) ||
                                pageText.includes('Resume');
        
        const hasCancelButton = !!document.querySelector('button[aria-label*="Cancel"]') ||
                                Array.from(document.querySelectorAll('button')).some(btn => btn.textContent?.includes('Cancel')) ||
                                pageText.includes('Cancel');
        
        return {
          expired,
          indicator,
          hasManageButton,
          hasResumeButton,
          hasCancelButton,
          afterManageClick,
          hasInactiveSection: inactiveSectionIndicators.some(text => pageText.includes(text))
        };
      }, afterManageClick);
      
      return result;
    } catch (error) {
      console.log(`Error checking subscription expiry: ${error.message}`);
      return { expired: false, error: error.message };
    }
  }

  /**
   * 컨텍스트 내에서 버튼 찾아 클릭
   */
  async clickButtonInContext(page, options) {
    const { contextTexts, buttonTexts, description = 'button' } = options;
    
    if (this.config.debugMode) {
      console.log(chalk.gray(`Finding ${description} in context...`));
    }
    
    const result = await page.evaluate((context, buttons) => {
      const allElements = document.querySelectorAll('*');
      
      for (const el of allElements) {
        const text = el.textContent?.trim();
        
        // 컨텍스트 텍스트 찾기
        if (text && context.some(ct => text.includes(ct))) {
          // 해당 요소의 자식 중 클릭 가능한 요소 찾기
          const clickables = el.querySelectorAll('button, a, [role="button"], [role="link"]');
          
          for (const clickable of clickables) {
            const btnText = clickable.textContent?.trim();
            
            if (btnText && buttons.some(bt => btnText === bt || btnText.includes(bt))) {
              if (clickable.offsetHeight > 0) {
                clickable.click();
                return {
                  clicked: true,
                  text: btnText,
                  inContext: true
                };
              }
            }
          }
        }
      }
      
      return { clicked: false };
    }, contextTexts, buttonTexts);
    
    if (this.config.debugMode && result.clicked) {
      console.log(chalk.green(`✓ Clicked ${description} in context: "${result.text}"`));
    }
    
    return result;
  }

  /**
   * 클릭 시도
   */
  async attemptClick(page, searchTexts) {
    return await page.evaluate((texts) => {
      const selectors = [
        'button',
        '[role="button"]',
        'a[role="button"]',
        'yt-button-renderer',
        'ytd-button-renderer button',  // YouTube Desktop 버튼 렌더러
        'yt-button-shape button',       // 최신 YouTube 버튼 구조
        'tp-yt-paper-button',
        'paper-button'
      ];
      
      const buttons = document.querySelectorAll(selectors.join(', '));
      
      for (const button of buttons) {
        const btnText = button.textContent?.trim();
        
        if (btnText && texts.some(text => 
          btnText === text || 
          btnText.includes(text) ||
          btnText.toLowerCase().includes(text.toLowerCase())
        )) {
          if (button.offsetHeight > 0 && button.offsetWidth > 0) {
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            button.click();
            return {
              clicked: true,
              text: btnText,
              element: button.tagName.toLowerCase()
            };
          }
        }
      }
      
      return { clicked: false };
    }, searchTexts);
  }

  /**
   * 버튼 존재 여부 확인
   */
  async hasButton(page, searchTexts) {
    return await page.evaluate((texts) => {
      const buttons = document.querySelectorAll('button, [role="button"]');
      
      for (const button of buttons) {
        const btnText = button.textContent?.trim();
        
        if (btnText && texts.some(text => 
          btnText === text || btnText.includes(text)
        )) {
          if (button.offsetHeight > 0) {
            return true;
          }
        }
      }
      
      return false;
    }, searchTexts);
  }

  /**
   * 모든 버튼 텍스트 가져오기 (디버깅용)
   */
  async getAllButtonTexts(page) {
    return await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, [role="button"]');
      const texts = [];
      
      buttons.forEach(btn => {
        const text = btn.textContent?.trim();
        if (text && btn.offsetHeight > 0) {
          texts.push({
            text,
            visible: true,
            tag: btn.tagName.toLowerCase()
          });
        }
      });
      
      return texts;
    });
  }

  // 언어별 텍스트 정의
  getManageButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');
    
    // multilanguage.js에서 언어별 텍스트 가져오기
    if (languages[language] && languages[language].buttons && languages[language].buttons.manageMemership) {
      return languages[language].buttons.manageMemership;
    }
    
    // 폴백: 기본 텍스트
    const texts = {
      ko: ['멤버십 관리', '구독 관리', '관리'],
      en: ['Manage membership', 'Manage Membership', 'Manage subscription', 'Manage'],
      ru: ['Управление подпиской', 'Управлять', 'Продлить или изменить', 'Продлить/изменить']
    };
    return texts[language] || texts.en;
  }

  getPauseButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');
    
    // multilanguage.js에서 언어별 텍스트 가져오기
    if (languages[language] && languages[language].buttons) {
      const pauseTexts = [];
      if (languages[language].buttons.pause) {
        pauseTexts.push(...languages[language].buttons.pause);
      }
      if (languages[language].buttons.pauseMembership) {
        pauseTexts.push(...languages[language].buttons.pauseMembership);
      }
      if (pauseTexts.length > 0) {
        return pauseTexts;
      }
    }
    
    // 폴백: 기본 텍스트
    const texts = {
      ko: ['일시중지', '멤버십 일시중지', '일시 중지'],
      en: ['Pause', 'Pause membership', 'Pause subscription'],
      ru: ['Приостановить', 'Приостановить подписку', 'Пауза', 'Приостановить членство']
    };
    return texts[language] || texts.en;
  }

  getResumeButtonTexts(language) {
    const { languages } = require('../infrastructure/config/multilanguage');
    
    // multilanguage.js에서 언어별 텍스트 가져오기
    if (languages[language] && languages[language].buttons) {
      const resumeTexts = [];
      if (languages[language].buttons.resume) {
        resumeTexts.push(...languages[language].buttons.resume);
      }
      if (languages[language].buttons.resumeMembership) {
        resumeTexts.push(...languages[language].buttons.resumeMembership);
      }
      if (resumeTexts.length > 0) {
        return resumeTexts;
      }
    }
    
    // 폴백: 기본 텍스트
    const texts = {
      ko: ['재개', '멤버십 재개', '다시 시작'],
      en: ['Resume', 'Resume membership', 'Resume subscription', 'Restart'],
      ru: ['Возобновить', 'Возобновить подписку', 'Продолжить', 'Возобновить членство']
    };
    return texts[language] || texts.en;
  }

  getConfirmButtonTexts(language, action) {
    const { languages } = require('../infrastructure/config/multilanguage');

    // multilanguage.js에서 언어별 텍스트 가져오기
    if (languages[language]?.buttons?.confirmButtons) {
      const confirmButtons = languages[language].buttons.confirmButtons;
      if (confirmButtons[action]) {
        return confirmButtons[action];
      }
      if (confirmButtons.general) {
        return confirmButtons.general;
      }
    }

    // 폴백: 기본 텍스트 (영어 기본값 보장)
    const texts = {
      ko: {
        pause: ['멤버십 일시중지', '일시중지', '확인', '예'],
        resume: ['재개', '멤버십 재개', '다시 시작', '확인', '예'],
        general: ['확인', '예', 'OK']
      },
      en: {
        pause: ['Pause', 'Pause membership', 'Confirm', 'OK', 'Yes'],
        resume: ['Resume', 'Resume membership', 'Confirm', 'OK', 'Yes'],
        general: ['Confirm', 'OK', 'Yes']
      },
      ru: {
        pause: ['Приостановить подписку', 'Приостановить', 'Подтвердить', 'ОК', 'Да'],
        resume: ['Возобновить', 'Возобновить подписку', 'Подтвердить', 'ОК', 'Да'],
        general: ['Подтвердить', 'ОК', 'Да']
      }
    };

    const langTexts = texts[language] || texts.en;
    return langTexts[action] || langTexts.general;
  }

  /**
   * 결제 문제 감지 (PAYMENT_METHOD_ISSUE)
   * "Action needed – update payment method" 배너가 있는지 확인
   */
  async detectPaymentIssue(page) {
    try {
      const result = await page.evaluate(() => {
        const pageText = document.body?.textContent || '';

        // 결제 문제를 나타내는 텍스트들 (다국어)
        const paymentIssueIndicators = [
          'Action needed – update payment method',
          'Action needed - update payment method',
          'Update payment method',
          'payment method',
          'Your payment',
          "didn't go through",
          'payment failed',
          'Payment declined',
          '결제 수단 업데이트',
          '결제 실패',
          '결제가 실패',
          'Обновите способ оплаты',
          'Платеж не прошел'
        ];

        for (const indicator of paymentIssueIndicators) {
          if (pageText.toLowerCase().includes(indicator.toLowerCase())) {
            return {
              hasPaymentIssue: true,
              indicator: indicator
            };
          }
        }

        // "Update payment method" 버튼 존재 여부 확인
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const btnText = btn.textContent?.trim();
          if (btnText && (
            btnText.includes('Update payment method') ||
            btnText.includes('결제 수단 업데이트') ||
            btnText.includes('Обновить способ оплаты')
          )) {
            return {
              hasPaymentIssue: true,
              indicator: btnText,
              hasUpdateButton: true
            };
          }
        }

        return { hasPaymentIssue: false };
      });

      if (result.hasPaymentIssue) {
        console.log(chalk.yellow(`💳 결제 문제 감지: ${result.indicator}`));
      }

      return result;
    } catch (error) {
      console.log(chalk.red(`❌ 결제 문제 감지 실패: ${error.message}`));
      return { hasPaymentIssue: false, error: error.message };
    }
  }

  /**
   * 결제 문제 복구 시도 (v3.1 - 방어적 재시도 로직)
   *
   * 엄격한 플로우 (모든 단계 필수):
   * 1. "Update payment method" 버튼 클릭 → URL/모달 변화 확인
   * 2. "CONTINUE" 버튼 클릭 (최대 10초 대기) → 화면 변화 확인
   * 3. "PAY NOW" 버튼 클릭 (최대 10초 대기) → 결제 처리 대기
   * 4. "Payment successful" 확인 → "OK" 버튼 클릭
   *
   * @returns {Object} { success: boolean, recovered: boolean, error?: string }
   */
  async attemptPaymentRecovery(page, options = {}) {
    const { debugMode = this.config.debugMode } = options;

    console.log(chalk.cyan('\n💳 결제 문제 복구 시도 시작 (v3.1 - 방어적 재시도)...'));
    console.log(chalk.gray('  플로우: Update payment method → CONTINUE → PAY NOW → OK'));

    try {
      // ========================================
      // Step 1: "Update payment method" 버튼 클릭
      // ========================================
      console.log(chalk.gray('\n  1️⃣ "Update payment method" 버튼 클릭 시도...'));

      const updateBtnResult = await this.clickButtonWithRetry(page, [
        'Update payment method',
        '결제 수단 업데이트',
        'Обновить способ оплаты',
        'Actualizar método de pago',
        'Mettre à jour le mode de paiement'
      ], { maxWaitTime: 5000, retryInterval: 1000, buttonName: 'Update payment method' });

      if (!updateBtnResult.clicked) {
        console.log(chalk.red('  ❌ "Update payment method" 버튼을 찾을 수 없습니다'));
        await this.debugPageButtons(page);
        return { success: false, recovered: false, error: 'UPDATE_BUTTON_NOT_FOUND' };
      }

      console.log(chalk.green(`  ✅ "Update payment method" 버튼 클릭 완료 (텍스트: ${updateBtnResult.text})`));

      // 클릭 후 모달/페이지 변화 대기 (Google Pay 모달 로딩)
      console.log(chalk.gray('  ⏳ 결제 모달 로딩 대기 중 (최대 8초)...'));

      // 모달이 열릴 때까지 대기 (최대 8초)
      let modalOpened = false;
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const modalCheck = await this.verifyPaymentModalOpened(page);
        if (modalCheck.opened) {
          console.log(chalk.green(`  ✅ 결제 모달 열림 확인 (${i + 1}초 후, 지표: ${modalCheck.indicator})`));
          modalOpened = true;
          break;
        }
        console.log(chalk.gray(`    ... 대기 중 (${i + 1}/8초)`));
      }

      if (!modalOpened) {
        console.log(chalk.red('  ❌ 결제 모달이 열리지 않았습니다 (8초 타임아웃)'));
        await this.debugPageButtons(page);
        return { success: false, recovered: false, error: 'PAYMENT_MODAL_NOT_OPENED' };
      }

      // 모달 컨텐츠 로딩을 위한 추가 대기
      console.log(chalk.gray('  ⏳ 모달 컨텐츠 로딩 대기 (2초)...'));
      await new Promise(r => setTimeout(r, 2000));

      // ========================================
      // Step 2: "CONTINUE" 버튼 클릭 (최대 10초 대기)
      // ========================================
      console.log(chalk.gray('\n  2️⃣ "CONTINUE" 버튼 클릭 시도 (최대 10초 대기)...'));

      const continueBtnResult = await this.clickButtonWithRetry(page, [
        'CONTINUE',
        'Continue',
        '계속',
        'Продолжить',
        'Continuar',
        'Continuer',
        'Next',
        '다음'
      ], { maxWaitTime: 10000, retryInterval: 1000, buttonName: 'CONTINUE' });

      if (!continueBtnResult.clicked) {
        console.log(chalk.yellow('  ⚠️ "CONTINUE" 버튼을 10초 내에 찾지 못함'));
        // 디버그 출력
        await this.debugPageButtons(page);
        // CONTINUE 없이 PAY NOW로 직접 가는 경우도 있으므로 계속 진행
        console.log(chalk.yellow('  → PAY NOW 단계로 건너뜀'));
      } else {
        console.log(chalk.green(`  ✅ "CONTINUE" 버튼 클릭 완료 (텍스트: ${continueBtnResult.text})`));
        console.log(chalk.gray('  ⏳ 결제 확인 페이지 대기 중 (3초)...'));
        await new Promise(r => setTimeout(r, 3000));
      }

      // ========================================
      // Step 3: "PAY NOW" 버튼 클릭 (최대 10초 대기)
      // ========================================
      console.log(chalk.gray('\n  3️⃣ "PAY NOW" 버튼 클릭 시도 (최대 10초 대기)...'));

      const payNowBtnResult = await this.clickButtonWithRetry(page, [
        'PAY NOW',
        'Pay now',
        'Pay Now',
        'PAY',
        '지금 결제',
        'Оплатить',
        'Pagar ahora',
        'Payer maintenant',
        'BUY',
        'Buy',
        '구매',
        'CONFIRM',
        'Confirm'
      ], { maxWaitTime: 10000, retryInterval: 1000, buttonName: 'PAY NOW' });

      if (!payNowBtnResult.clicked) {
        console.log(chalk.red('  ❌ "PAY NOW" 버튼을 10초 내에 찾을 수 없습니다'));
        await this.debugPageButtons(page);
        return { success: false, recovered: false, error: 'PAY_NOW_BUTTON_NOT_FOUND' };
      }

      console.log(chalk.green(`  ✅ "PAY NOW" 버튼 클릭 완료 (텍스트: ${payNowBtnResult.text})`));
      console.log(chalk.gray('  ⏳ 결제 처리 대기 중 (최대 15초)...'));

      // 결제 처리 대기 (최대 15초, 1초마다 확인)
      let paymentSuccess = false;
      let paymentIndicator = null;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const paymentCheck = await this.checkPaymentResult(page);
        if (paymentCheck.success) {
          paymentSuccess = true;
          paymentIndicator = paymentCheck.indicator;
          console.log(chalk.green(`  ✅ 결제 성공 감지! (${i + 1}초 후)`));
          break;
        }
        if (i % 3 === 2) { // 3초마다 상태 출력
          console.log(chalk.gray(`    ... 결제 처리 중 (${i + 1}/15초)`));
        }
      }

      // ========================================
      // Step 4: 결제 성공 확인 및 "OK" 버튼 클릭
      // ========================================
      console.log(chalk.gray('\n  4️⃣ 결제 결과 확인 중...'));

      if (!paymentSuccess) {
        // 마지막으로 한 번 더 확인
        const finalCheck = await this.checkPaymentResult(page);
        if (finalCheck.success) {
          paymentSuccess = true;
          paymentIndicator = finalCheck.indicator;
        }
      }

      if (!paymentSuccess) {
        console.log(chalk.red('  ❌ 결제 성공을 확인할 수 없습니다 (15초 타임아웃)'));
        await this.debugPageButtons(page);
        return { success: false, recovered: false, error: 'PAYMENT_NOT_CONFIRMED' };
      }

      console.log(chalk.green(`  ✅ 결제 성공 확인! (지표: ${paymentIndicator})`));

      // OK 버튼 클릭 (최대 5초 대기)
      console.log(chalk.gray('  🔘 "OK" 버튼 클릭 시도 (최대 5초 대기)...'));

      const okBtnResult = await this.clickButtonWithRetry(page, [
        'OK',
        'Ok',
        '확인',
        'Окей',
        'ОК',
        'Aceptar',
        "D'accord",
        'Done',
        '완료',
        'GOT IT',
        'Got it'
      ], { maxWaitTime: 5000, retryInterval: 500, buttonName: 'OK' });

      if (okBtnResult.clicked) {
        console.log(chalk.green(`  ✅ "OK" 버튼 클릭 완료 (텍스트: ${okBtnResult.text})`));
      } else {
        console.log(chalk.yellow('  ⚠️ "OK" 버튼을 찾을 수 없음 (무시하고 계속)'));
      }

      console.log(chalk.green('\n🎉 결제 복구 성공! 재결제가 완료되었습니다.'));
      await new Promise(r => setTimeout(r, 2000));

      return {
        success: true,
        recovered: true,
        message: '결제 문제 발생 후 재결제 완료 - 다시 확인 필요'
      };

    } catch (error) {
      console.log(chalk.red(`❌ 결제 복구 중 오류: ${error.message}`));
      return { success: false, recovered: false, error: error.message };
    }
  }

  /**
   * 버튼을 재시도하며 클릭 (polling with timeout)
   * @param {Page} page - Puppeteer 페이지
   * @param {string[]} searchTexts - 찾을 버튼 텍스트들
   * @param {Object} options - { maxWaitTime: 최대 대기시간(ms), retryInterval: 재시도 간격(ms), buttonName: 로그용 이름 }
   */
  async clickButtonWithRetry(page, searchTexts, options = {}) {
    const { maxWaitTime = 10000, retryInterval = 1000, buttonName = 'button' } = options;
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < maxWaitTime) {
      attempts++;

      const result = await this.clickButtonWithPuppeteer(page, searchTexts);

      if (result.clicked) {
        return result;
      }

      // 남은 시간 확인
      const elapsed = Date.now() - startTime;
      const remaining = maxWaitTime - elapsed;

      if (remaining <= 0) {
        break;
      }

      // 재시도 대기 (마지막 시도가 아닌 경우에만 로그)
      if (remaining > retryInterval) {
        console.log(chalk.gray(`    ⏳ "${buttonName}" 버튼 대기 중... (시도 ${attempts}, ${Math.round(elapsed/1000)}/${Math.round(maxWaitTime/1000)}초)`));
      }

      await new Promise(r => setTimeout(r, Math.min(retryInterval, remaining)));
    }

    return { clicked: false, attempts };
  }

  /**
   * Puppeteer 네이티브 클릭으로 버튼 클릭 (page.click 사용)
   * v4.0 - iframe 내부 버튼도 검색하도록 개선
   *
   * 검색 순서:
   * 1. 메인 페이지에서 버튼 검색
   * 2. 메인 페이지에서 못 찾으면 모든 iframe 내부 검색
   */
  async clickButtonWithPuppeteer(page, searchTexts, options = {}) {
    const { timeout = 5000, waitForNavigation = false } = options;

    try {
      // 0. 먼저 메인 페이지에서 기존 마커 속성 모두 제거 (중요!)
      await page.evaluate(() => {
        document.querySelectorAll('[data-puppeteer-click-target]').forEach(el => {
          el.removeAttribute('data-puppeteer-click-target');
        });
      });

      // 1. 먼저 메인 페이지에서 버튼 찾기
      const mainPageResult = await this._findButtonInDocument(page, searchTexts, 'main');

      if (mainPageResult.found) {
        console.log(chalk.gray(`    🎯 메인 페이지에서 버튼 발견: "${mainPageResult.text}" (매칭: ${mainPageResult.searchText}, 점수: ${mainPageResult.score})`));
        return await this._clickMarkedButton(page, mainPageResult.text, waitForNavigation);
      }

      // 2. 메인 페이지에서 못 찾으면 iframe 내부 검색
      console.log(chalk.gray(`    🔍 메인 페이지에서 "${searchTexts[0]}" 버튼 없음 → iframe 검색 중...`));

      const frames = page.frames();
      console.log(chalk.gray(`    📋 검색할 iframe 수: ${frames.length - 1}개`));

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        // 메인 프레임은 이미 검색했으므로 스킵
        if (frame === page.mainFrame()) continue;

        try {
          const frameUrl = frame.url();
          const frameNameInfo = frameUrl ? frameUrl.substring(0, 60) : `frame-${i}`;

          // Google Pay iframe 우선 처리
          const isGooglePayFrame = frameUrl && (
            frameUrl.includes('payments.google.com') ||
            frameUrl.includes('pay.google.com') ||
            frameUrl.includes('wallet.google.com')
          );

          if (isGooglePayFrame) {
            console.log(chalk.cyan(`    💳 Google Pay iframe 발견: ${frameNameInfo}...`));
          }

          // iframe 내에서 버튼 찾기
          const frameResult = await this._findButtonInFrame(frame, searchTexts);

          if (frameResult.found) {
            console.log(chalk.green(`    🎯 iframe에서 버튼 발견: "${frameResult.text}" (${frameNameInfo})`));
            return await this._clickButtonInFrame(frame, frameResult.text, waitForNavigation);
          }
        } catch (frameError) {
          // cross-origin iframe은 접근 불가 - 무시
          if (!frameError.message.includes('cross-origin') && !frameError.message.includes('detached')) {
            console.log(chalk.gray(`    ⚠️ iframe 검색 오류: ${frameError.message.substring(0, 50)}`));
          }
        }
      }

      // 3. 어디서도 버튼을 찾지 못함
      console.log(chalk.gray(`    🔍 "${searchTexts[0]}" 버튼을 메인 페이지와 iframe에서 모두 찾지 못함`));
      return { clicked: false };

    } catch (error) {
      console.log(chalk.red(`    버튼 클릭 오류: ${error.message}`));
      // 오류 시에도 마커 제거
      await page.evaluate(() => {
        document.querySelectorAll('[data-puppeteer-click-target]').forEach(el => {
          el.removeAttribute('data-puppeteer-click-target');
        });
      }).catch(() => {});
      return { clicked: false, error: error.message };
    }
  }

  /**
   * 문서(메인 페이지)에서 버튼 찾기 (마커 설정)
   * @private
   */
  async _findButtonInDocument(page, searchTexts, source = 'main') {
    return await page.evaluate((texts) => {
      const selectors = [
        'button',
        '[role="button"]',
        'a[role="button"]',
        'yt-button-renderer',
        'tp-yt-paper-button',
        'input[type="submit"]',
        'div[role="button"]',
        'span[role="button"]'
      ];

      const allButtons = document.querySelectorAll(selectors.join(', '));
      const candidates = [];

      // 모든 버튼 수집 및 점수 부여
      for (const btn of allButtons) {
        const btnText = btn.textContent?.trim();

        if (!btnText || btn.offsetHeight <= 0 || btn.offsetWidth <= 0) continue;

        // 숨겨진 요소 제외
        const style = window.getComputedStyle(btn);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

        for (const searchText of texts) {
          // 정확히 일치 (최고 우선순위)
          if (btnText === searchText) {
            candidates.push({ btn, text: btnText, score: 100, searchText });
          }
          // 대소문자 무시 정확 매칭
          else if (btnText.toUpperCase() === searchText.toUpperCase()) {
            candidates.push({ btn, text: btnText, score: 90, searchText });
          }
          // 버튼 텍스트가 검색어로만 구성 (공백 제외)
          else if (btnText.replace(/\s+/g, '').toUpperCase() === searchText.replace(/\s+/g, '').toUpperCase()) {
            candidates.push({ btn, text: btnText, score: 80, searchText });
          }
        }
      }

      // 점수 순으로 정렬
      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length > 0) {
        const best = candidates[0];
        best.btn.setAttribute('data-puppeteer-click-target', 'true');
        return { found: true, text: best.text, score: best.score, searchText: best.searchText };
      }

      return { found: false };
    }, searchTexts);
  }

  /**
   * iframe 내에서 버튼 찾기
   * @private
   */
  async _findButtonInFrame(frame, searchTexts) {
    try {
      return await frame.evaluate((texts) => {
        const selectors = [
          'button',
          '[role="button"]',
          'a[role="button"]',
          'input[type="submit"]',
          'div[role="button"]',
          'span[role="button"]'
        ];

        const allButtons = document.querySelectorAll(selectors.join(', '));
        const candidates = [];

        for (const btn of allButtons) {
          const btnText = btn.textContent?.trim();

          if (!btnText || btn.offsetHeight <= 0 || btn.offsetWidth <= 0) continue;

          // 숨겨진 요소 제외
          try {
            const style = window.getComputedStyle(btn);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
          } catch (e) {
            continue;
          }

          for (const searchText of texts) {
            // 정확히 일치 (최고 우선순위)
            if (btnText === searchText) {
              candidates.push({ text: btnText, score: 100, searchText });
            }
            // 대소문자 무시 정확 매칭
            else if (btnText.toUpperCase() === searchText.toUpperCase()) {
              candidates.push({ text: btnText, score: 90, searchText });
            }
            // 버튼 텍스트가 검색어로만 구성 (공백 제외)
            else if (btnText.replace(/\s+/g, '').toUpperCase() === searchText.replace(/\s+/g, '').toUpperCase()) {
              candidates.push({ text: btnText, score: 80, searchText });
            }
          }
        }

        // 점수 순으로 정렬
        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          const best = candidates[0];
          // iframe에서는 마커 설정 대신 텍스트로 찾기
          return { found: true, text: best.text, score: best.score, searchText: best.searchText };
        }

        return { found: false };
      }, searchTexts);
    } catch (error) {
      return { found: false, error: error.message };
    }
  }

  /**
   * 마커가 설정된 버튼 클릭 (메인 페이지용)
   * @private
   */
  async _clickMarkedButton(page, buttonText, waitForNavigation = false) {
    try {
      const buttonSelector = '[data-puppeteer-click-target="true"]';

      // 버튼이 보이는지 확인
      await page.waitForSelector(buttonSelector, { visible: true, timeout: 3000 }).catch(() => null);

      // 버튼으로 스크롤
      await page.evaluate((selector) => {
        const btn = document.querySelector(selector);
        if (btn) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, buttonSelector);

      await new Promise(r => setTimeout(r, 500)); // 스크롤 완료 대기

      // Puppeteer 네이티브 클릭 실행
      if (waitForNavigation) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
          page.click(buttonSelector)
        ]);
      } else {
        await page.click(buttonSelector);
      }

      // 클릭 후 속성 제거
      await page.evaluate(() => {
        document.querySelectorAll('[data-puppeteer-click-target]').forEach(el => {
          el.removeAttribute('data-puppeteer-click-target');
        });
      });

      // 클릭 후 짧은 대기
      await new Promise(r => setTimeout(r, 1000));

      return { clicked: true, text: buttonText, source: 'main' };

    } catch (error) {
      // 오류 시에도 마커 제거
      await page.evaluate(() => {
        document.querySelectorAll('[data-puppeteer-click-target]').forEach(el => {
          el.removeAttribute('data-puppeteer-click-target');
        });
      }).catch(() => {});
      throw error;
    }
  }

  /**
   * iframe 내 버튼 클릭
   * @private
   */
  async _clickButtonInFrame(frame, buttonText, waitForNavigation = false) {
    try {
      // iframe 내에서 버튼 찾아서 클릭
      const clicked = await frame.evaluate((targetText) => {
        const selectors = [
          'button',
          '[role="button"]',
          'a[role="button"]',
          'input[type="submit"]',
          'div[role="button"]',
          'span[role="button"]'
        ];

        const allButtons = document.querySelectorAll(selectors.join(', '));

        for (const btn of allButtons) {
          const btnText = btn.textContent?.trim();

          if (btnText === targetText ||
              btnText?.toUpperCase() === targetText.toUpperCase()) {
            if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
              btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              btn.click();
              return true;
            }
          }
        }

        return false;
      }, buttonText);

      if (clicked) {
        // 클릭 후 대기
        await new Promise(r => setTimeout(r, 1000));
        return { clicked: true, text: buttonText, source: 'iframe' };
      }

      return { clicked: false };

    } catch (error) {
      console.log(chalk.red(`    iframe 내 버튼 클릭 오류: ${error.message}`));
      return { clicked: false, error: error.message };
    }
  }

  /**
   * 결제 모달이 열렸는지 확인 (v3.0 - 엄격한 확인)
   * URL 변화 또는 Google Pay iframe 확인
   */
  async verifyPaymentModalOpened(page) {
    try {
      const currentUrl = page.url();

      // URL 변화 확인 (Google Pay 결제 페이지로 이동했는지)
      if (currentUrl.includes('payments.google.com') || currentUrl.includes('pay.google.com')) {
        return { opened: true, indicator: 'Google Pay URL detected' };
      }

      const result = await page.evaluate(() => {
        // 1. Google Pay iframe 확인 (가장 확실한 지표)
        const paymentIframes = document.querySelectorAll('iframe[src*="payments.google"], iframe[src*="pay.google"]');
        if (paymentIframes.length > 0) {
          return { opened: true, indicator: 'Google Pay iframe' };
        }

        // 2. 결제 관련 모달/다이얼로그 확인
        const modalSelectors = [
          '[role="dialog"][aria-modal="true"]',
          '.gpay-card-info-container',
          '[class*="payment-modal"]',
          '[class*="gpay"]',
          'tp-yt-paper-dialog'
        ];

        for (const selector of modalSelectors) {
          const modal = document.querySelector(selector);
          if (modal && modal.offsetHeight > 0) {
            return { opened: true, indicator: `Modal: ${selector}` };
          }
        }

        // 3. 결제 관련 버튼이 새로 나타났는지 확인 (PAY NOW, CONTINUE 등)
        const paymentButtons = document.querySelectorAll('button, [role="button"]');
        const paymentButtonTexts = ['PAY NOW', 'Pay Now', 'CONTINUE', 'BUY', '지금 결제', 'Оплатить'];

        for (const btn of paymentButtons) {
          const btnText = btn.textContent?.trim();
          if (btnText && btn.offsetHeight > 0 && btn.offsetWidth > 0) {
            for (const target of paymentButtonTexts) {
              if (btnText === target || btnText.toUpperCase() === target.toUpperCase()) {
                return { opened: true, indicator: `Payment button: ${btnText}` };
              }
            }
          }
        }

        return { opened: false };
      });

      return result;
    } catch (error) {
      return { opened: false, error: error.message };
    }
  }

  /**
   * 디버그: 현재 페이지와 iframe의 모든 버튼 출력
   * v4.0 - iframe 내부 버튼도 출력
   */
  async debugPageButtons(page) {
    try {
      // 1. 메인 페이지 버튼
      const mainButtons = await page.evaluate(() => {
        const allButtons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
        return Array.from(allButtons)
          .filter(btn => btn.offsetHeight > 0 && btn.offsetWidth > 0)
          .slice(0, 10) // 최대 10개
          .map(btn => ({
            text: btn.textContent?.trim().substring(0, 60),
            tagName: btn.tagName,
            className: (btn.className || '').substring(0, 40)
          }));
      });

      console.log(chalk.gray('\n    📋 메인 페이지의 버튼들:'));
      if (mainButtons.length > 0) {
        mainButtons.forEach((btn, i) => {
          console.log(chalk.gray(`       ${i + 1}. [${btn.tagName}] "${btn.text}"`));
        });
      } else {
        console.log(chalk.gray('       (보이는 버튼 없음)'));
      }

      // 2. iframe 내부 버튼 검색
      const frames = page.frames();
      const iframeCount = frames.length - 1;

      if (iframeCount > 0) {
        console.log(chalk.gray(`\n    📋 iframe 내부 버튼들 (${iframeCount}개 iframe):`));

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          if (frame === page.mainFrame()) continue;

          try {
            const frameUrl = frame.url();
            const frameNameInfo = frameUrl ? frameUrl.substring(0, 50) : `frame-${i}`;

            const frameButtons = await frame.evaluate(() => {
              const allButtons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
              return Array.from(allButtons)
                .filter(btn => btn.offsetHeight > 0 && btn.offsetWidth > 0)
                .slice(0, 5) // iframe당 최대 5개
                .map(btn => ({
                  text: btn.textContent?.trim().substring(0, 60),
                  tagName: btn.tagName
                }));
            }).catch(() => []);

            if (frameButtons.length > 0) {
              console.log(chalk.cyan(`       [iframe: ${frameNameInfo}...]`));
              frameButtons.forEach((btn, j) => {
                console.log(chalk.cyan(`         ${j + 1}. [${btn.tagName}] "${btn.text}"`));
              });
            }
          } catch (frameError) {
            // cross-origin iframe 등은 무시
          }
        }
      }
    } catch (e) {
      console.log(chalk.gray(`    📋 버튼 디버그 실패: ${e.message}`));
    }
  }

  /**
   * 모달 내에서 버튼 클릭
   */
  async clickButtonInModal(page, buttonTexts, maxWaitTime = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const result = await page.evaluate((texts) => {
        // 모달/다이얼로그 찾기
        const modalSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]',
          '.modal',
          '.dialog',
          '[class*="modal"]',
          '[class*="dialog"]',
          '[class*="overlay"]',
          'tp-yt-paper-dialog'
        ];

        // 페이지 전체에서도 검색 (Google Pay 모달은 일반 div일 수 있음)
        const allButtons = document.querySelectorAll('button, [role="button"]');

        for (const btn of allButtons) {
          const btnText = btn.textContent?.trim();

          if (btnText && btn.offsetHeight > 0 && btn.offsetWidth > 0) {
            for (const searchText of texts) {
              // 정확한 매칭 또는 포함 매칭
              if (btnText === searchText ||
                  btnText.toUpperCase() === searchText.toUpperCase() ||
                  btnText.toLowerCase().includes(searchText.toLowerCase())) {
                // 클릭 가능한지 확인
                const style = window.getComputedStyle(btn);
                if (style.visibility !== 'hidden' && style.display !== 'none') {
                  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  btn.click();
                  return { clicked: true, text: btnText };
                }
              }
            }
          }
        }

        return { clicked: false };
      }, buttonTexts);

      if (result.clicked) {
        return result;
      }

      // 잠시 대기 후 재시도
      await new Promise(r => setTimeout(r, 500));
    }

    return { clicked: false };
  }

  /**
   * 결제 결과 확인 (v4.0 - iframe 내부 텍스트도 검색)
   * 주의: "paid" 같은 일반적인 텍스트는 제외 (페이지에 이미 "PKR 899 paid" 등이 있을 수 있음)
   *
   * 검색 순서:
   * 1. 메인 페이지 텍스트에서 결제 결과 확인
   * 2. 메인 페이지에서 못 찾으면 모든 iframe 내부 텍스트 검색
   */
  async checkPaymentResult(page) {
    // 성공 지표 (명확한 결제 성공 메시지만)
    const successIndicators = [
      'Payment successful',
      'Payment complete',
      'Payment completed',
      'Your payment was successful',
      '결제 성공',
      '결제가 완료되었습니다',
      '결제가 완료',
      'Платеж успешен',
      'Платёж успешно',
      'Платёж выполнен',
      'Pago exitoso',
      'Pago completado',
      'Paiement réussi',
      'Paiement effectué',
      'Zahlung erfolgreich',
      'Pagamento concluído',
      '支付成功',
      '決済完了'
    ];

    // 실패 지표
    const failureIndicators = [
      'Payment failed',
      'Payment declined',
      'Card declined',
      'Transaction failed',
      'payment issuer declined',
      '결제 실패',
      '카드 거부',
      '결제가 거부',
      'Платеж отклонен',
      'Платёж отклонён',
      'Pago rechazado',
      'Paiement refusé'
    ];

    try {
      // 1. 먼저 메인 페이지에서 확인
      const mainPageResult = await page.evaluate((successTexts, failureTexts) => {
        const pageText = document.body?.textContent || '';

        for (const indicator of successTexts) {
          if (pageText.includes(indicator)) {
            return { success: true, indicator, source: 'main' };
          }
        }

        for (const indicator of failureTexts) {
          if (pageText.toLowerCase().includes(indicator.toLowerCase())) {
            return { success: false, error: 'PAYMENT_DECLINED', indicator, source: 'main' };
          }
        }

        return null; // 메인 페이지에서 결과 없음
      }, successIndicators, failureIndicators);

      if (mainPageResult) {
        return mainPageResult;
      }

      // 2. 메인 페이지에서 못 찾으면 iframe 내부 검색
      const frames = page.frames();

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (frame === page.mainFrame()) continue;

        try {
          const frameUrl = frame.url();

          // Google Pay / YouTube 결제 iframe 우선 검색
          const isPaymentFrame = frameUrl && (
            frameUrl.includes('payments.google.com') ||
            frameUrl.includes('payments.youtube.com') ||
            frameUrl.includes('pay.google.com') ||
            frameUrl.includes('wallet.google.com')
          );

          const frameResult = await frame.evaluate((successTexts, failureTexts) => {
            const pageText = document.body?.textContent || '';

            for (const indicator of successTexts) {
              if (pageText.includes(indicator)) {
                return { success: true, indicator };
              }
            }

            for (const indicator of failureTexts) {
              if (pageText.toLowerCase().includes(indicator.toLowerCase())) {
                return { success: false, error: 'PAYMENT_DECLINED', indicator };
              }
            }

            return null;
          }, successIndicators, failureIndicators).catch(() => null);

          if (frameResult) {
            const frameNameInfo = frameUrl ? frameUrl.substring(0, 50) : `frame-${i}`;
            console.log(chalk.cyan(`    💳 iframe에서 결제 결과 감지: ${frameResult.indicator} (${frameNameInfo}...)`));
            return { ...frameResult, source: 'iframe', frameUrl: frameNameInfo };
          }
        } catch (frameError) {
          // cross-origin iframe은 접근 불가 - 무시
        }
      }

      // 알 수 없는 상태
      return { success: false, error: 'UNKNOWN_PAYMENT_STATUS' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ButtonInteractionService;