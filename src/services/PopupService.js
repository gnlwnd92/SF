/**
 * PopupService - 팝업 감지 및 처리 서비스
 * 
 * YouTube Premium 워크플로우에서 나타나는 모든 팝업 처리
 * 날짜 정보 추출 및 확인 버튼 처리
 */

const chalk = require('chalk');

class PopupService {
  constructor(config = {}) {
    this.config = {
      debugMode: config.debugMode || false,
      waitForPopup: config.waitForPopup || 3000,
      popupTimeout: config.popupTimeout || 10000,
      ...config
    };
    
    this.buttonService = config.buttonService || null;
  }

  /**
   * 팝업 대기 및 감지
   */
  async waitForPopup(page, timeout = null) {
    const waitTime = timeout || this.config.waitForPopup;

    if (this.config.debugMode) {
      console.log(chalk.gray(`Waiting ${waitTime}ms for popup...`));
    }

    await new Promise(r => setTimeout(r, waitTime));

    return await this.detectPopup(page);
  }

  /**
   * SunBrowser 팝업 감지 및 닫기
   */
  async detectAndCloseSunBrowserPopup(page) {
    try {
      // SunBrowser 팝업 감지
      const hasSunBrowserPopup = await page.evaluate(() => {
        // SunBrowser 특정 텍스트로 감지
        const texts = [
          'Make SunBrowser your own',
          'Use SunBrowser without an account',
          'Sign in to SunBrowser',
          'To get your passwords and more on all your devices'
        ];

        for (const text of texts) {
          const elements = Array.from(document.querySelectorAll('*')).filter(el =>
            el.textContent?.includes(text) &&
            !el.querySelector('*')?.textContent?.includes(text)
          );

          if (elements.length > 0) {
            console.log('SunBrowser 팝업 감지:', text);
            return true;
          }
        }

        // Armenio 계정 관련 요소 확인
        const accountElement = document.querySelector('[data-identifier*="armenio"]');
        if (accountElement) {
          const parent = accountElement.closest('[role="dialog"], .modal, .popup');
          if (parent && parent.textContent?.includes('SunBrowser')) {
            console.log('SunBrowser 계정 팝업 감지');
            return true;
          }
        }

        return false;
      });

      if (hasSunBrowserPopup) {
        console.log(chalk.yellow('🌐 SunBrowser 팝업 감지됨, 닫기 시도...'));

        // 방법 1: "Use SunBrowser without an account" 버튼 클릭
        const buttonClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (const button of buttons) {
            if (button.textContent?.includes('Use SunBrowser without an account') ||
                button.textContent?.includes('without an account')) {
              button.click();
              return true;
            }
          }
          return false;
        });

        if (buttonClicked) {
          console.log(chalk.green('✅ SunBrowser 팝업 닫기 버튼 클릭'));
          await new Promise(r => setTimeout(r, 1000));
          return true;
        }

        // 방법 2: ESC 키로 닫기
        console.log(chalk.yellow('⌨️ ESC 키로 SunBrowser 팝업 닫기 시도...'));
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 1000));

        // 팝업이 닫혔는지 확인
        const stillExists = await page.evaluate(() => {
          const texts = ['Make SunBrowser your own', 'Sign in to SunBrowser'];
          for (const text of texts) {
            const elements = Array.from(document.querySelectorAll('*')).filter(el =>
              el.textContent?.includes(text)
            );
            if (elements.length > 0) return true;
          }
          return false;
        });

        if (!stillExists) {
          console.log(chalk.green('✅ ESC 키로 SunBrowser 팝업 닫기 성공'));
          return true;
        }

        // 방법 3: 팝업 외부 클릭
        console.log(chalk.yellow('🖱️ 팝업 외부 클릭으로 닫기 시도...'));
        await page.mouse.click(10, 10);
        await new Promise(r => setTimeout(r, 1000));

        return true;
      }

      return false;
    } catch (error) {
      console.log(chalk.red('⚠️ SunBrowser 팝업 처리 중 오류:', error.message));
      return false;
    }
  }

  /**
   * 팝업 감지
   */
  async detectPopup(page) {
    const popupInfo = await page.evaluate(() => {
      const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'yt-dialog',
        'ytd-popup-container',
        '.popup',
        '.modal'
      ];
      
      const dialogs = document.querySelectorAll(selectors.join(', '));
      
      for (const dialog of dialogs) {
        // 표시되는 팝업만 확인
        if (dialog.offsetHeight > 0 && dialog.offsetWidth > 0) {
          // 여러 방법으로 텍스트 추출 시도 (잘림 방지)
          let fullText = '';
          
          // 방법 1: 모든 텍스트 노드 직접 수집
          const collectTextNodes = (element) => {
            let text = '';
            for (const node of element.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                // 버튼은 제외
                if (node.tagName !== 'BUTTON') {
                  text += collectTextNodes(node);
                }
              }
            }
            return text;
          };
          
          // 방법 2: innerText 사용 (일반적으로 가장 정확)
          const innerTextContent = dialog.innerText?.trim() || '';
          
          // 방법 3: textContent 사용 (fallback)
          const textContentOnly = dialog.textContent?.trim() || '';
          
          // 방법 4: YouTube 특화 텍스트 수집 (강화)
          const specificTexts = [];
          
          // YouTube 전용 요소들 우선 수집
          const youtubeElements = dialog.querySelectorAll('yt-formatted-string, ytd-expandable-text-renderer, tp-yt-paper-dialog-scrollable');
          youtubeElements.forEach(el => {
            if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
              // innerText와 textContent 둘 다 시도
              const innerText = el.innerText?.trim();
              const textContent = el.textContent?.trim();
              const text = (innerText && innerText.length > 50) ? innerText : textContent;
              
              if (text && text.length > 0) {
                // 중복 제거하면서 추가
                if (!specificTexts.some(t => t.includes(text) || text.includes(t))) {
                  specificTexts.push(text);
                }
              }
            }
          });
          
          // 일반 텍스트 요소들도 수집
          const textElements = dialog.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6');
          textElements.forEach(el => {
            // 버튼이 아닌 요소만 처리
            if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
              const text = el.innerText?.trim() || el.textContent?.trim();
              if (text && text.length > 10 && !specificTexts.some(t => t.includes(text) || text.includes(t))) {
                specificTexts.push(text);
              }
            }
          });
          
          // 방법 5: 재귀적 텍스트 수집 (더 정확함)
          const recursiveText = collectTextNodes(dialog);
          
          // 가장 긴 텍스트 선택 (잘림 방지)
          fullText = innerTextContent;
          if (textContentOnly.length > fullText.length) {
            fullText = textContentOnly;
          }
          if (specificTexts.join('\n').length > fullText.length) {
            fullText = specificTexts.join('\n');
          }
          if (recursiveText.length > fullText.length) {
            fullText = recursiveText;
          }
          
          const buttons = dialog.querySelectorAll('button');
          
          return {
            hasPopup: true,
            text: fullText, // 전체 텍스트 반환 (잘리지 않도록)
            buttonCount: buttons.length,
            buttons: Array.from(buttons).map(btn => btn.textContent?.trim()).filter(Boolean),
            type: dialog.tagName.toLowerCase(),
            className: dialog.className,
            id: dialog.id || 'no-id'
          };
        }
      }
      
      return { hasPopup: false };
    });
    
    if (this.config.debugMode) {
      if (popupInfo.hasPopup) {
        console.log(chalk.green('✓ Popup detected'));
        console.log(chalk.gray(`  Type: ${popupInfo.type}`));
        console.log(chalk.gray(`  Buttons: ${popupInfo.buttons.join(', ')}`));
      } else {
        console.log(chalk.yellow('✗ No popup found'));
      }
    }
    
    return popupInfo;
  }

  /**
   * 일시중지 확인 팝업 처리 - 개선된 팝업 감지
   */
  async handlePausePopup(page, language = 'en') {
    // 첫 번째 시도
    let popupInfo = await this.waitForPopup(page);
    
    // 팝업이 감지되지 않으면 추가 대기 및 재시도
    if (!popupInfo.hasPopup) {
      console.log(chalk.yellow('⚠️ 팝업이 나타나지 않음, 추가 대기 중...'));
      
      // 팝업이 완전히 렌더링되도록 추가 대기
      await new Promise(r => setTimeout(r, 2000));
      
      // 직접 팝업 감지 재시도
      popupInfo = await this.detectPopup(page);
      
      if (!popupInfo.hasPopup) {
        // 최종 시도 - 더 긴 대기 시간
        await new Promise(r => setTimeout(r, 3000));
        popupInfo = await this.detectPopup(page);
      }
    }
    
    if (!popupInfo.hasPopup) {
      return {
        handled: false,
        reason: 'No popup detected after retries'
      };
    }
    
    // 팝업 텍스트가 너무 짧으면 경고 (포르투갈어는 150자 이상 필요)
    const minTextLength = popupInfo.text?.includes('Pausar') || popupInfo.text?.includes('pausada') ? 150 : 100;
    
    if (popupInfo.text && popupInfo.text.length < minTextLength) {
      console.log(chalk.yellow(`⚠️ 팝업 텍스트가 짧음 (${popupInfo.text.length}자) - 잘렸을 가능성`));
      
      // 팝업 텍스트 재수집 시도 (더 강력한 방법)
      const fullText = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"], .yt-dialog-base, tp-yt-paper-dialog');
        if (!dialog) return null;
        
        // 방법 1: YouTube 특화 요소 우선 수집
        const ytTexts = [];
        const ytElements = dialog.querySelectorAll('yt-formatted-string, ytd-expandable-text-renderer');
        ytElements.forEach(el => {
          const text = el.innerText?.trim() || el.textContent?.trim();
          if (text && text.length > 0) {
            ytTexts.push(text);
          }
        });
        
        // 방법 2: 모든 텍스트 노드 수집 (더 깊이)
        const allTexts = [];
        const walker = document.createTreeWalker(
          dialog,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              // 버튼 텍스트는 제외
              if (node.parentElement?.tagName === 'BUTTON') {
                return NodeFilter.FILTER_REJECT;
              }
              // 빈 텍스트 제외
              if (!node.textContent?.trim()) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );
        
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent?.trim();
          if (text && text.length > 0) {
            allTexts.push(text);
          }
        }
        
        // 방법 3: 특정 클래스 요소들 수집
        const specificTexts = [];
        const specificElements = dialog.querySelectorAll('[class*="message"], [class*="text"], [class*="description"], [class*="content"]');
        specificElements.forEach(el => {
          const text = el.innerText?.trim() || el.textContent?.trim();
          if (text && text.length > 10) {
            specificTexts.push(text);
          }
        });
        
        // 가장 긴 결과 선택
        const ytText = ytTexts.join('\n');
        const allText = allTexts.join('\n');
        const specificText = specificTexts.join('\n');
        
        let longest = ytText;
        if (allText.length > longest.length) longest = allText;
        if (specificText.length > longest.length) longest = specificText;
        
        return longest;
      });
      
      if (fullText && fullText.length > popupInfo.text.length) {
        console.log(chalk.green(`✅ 전체 텍스트 재수집 성공 (${fullText.length}자)`));
        popupInfo.text = fullText;
      } else {
        // 최종 시도: 짧은 대기 후 재시도
        await new Promise(r => setTimeout(r, 1000));
        const retryPopup = await this.detectPopup(page);
        if (retryPopup.hasPopup && retryPopup.text.length > popupInfo.text.length) {
          console.log(chalk.green(`✅ 재시도로 더 긴 텍스트 획득 (${retryPopup.text.length}자)`));
          popupInfo.text = retryPopup.text;
        }
      }
    }
    
    // 날짜 정보 추출
    const dates = this.extractDatesFromText(popupInfo.text);
    
    // 확인 버튼 클릭
    const confirmResult = await this.clickConfirmButton(page, language, 'pause');
    
    if (confirmResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitForPopup));
      
      // 날짜 순서 정정 - 날짜 형식으로 자동 판단
      let resumeDate = null;
      let pauseDate = null;
      
      if (dates.length === 2) {
        // 두 날짜가 있을 때 형식으로 판단
        const date1 = dates[0];
        const date2 = dates[1];
        
        // 날짜 형식 분석 함수
        const hasYear = (dateStr) => {
          return dateStr && (dateStr.includes('2025') || dateStr.includes('2026') || dateStr.includes('2024'));
        };
        
        // 일반적으로 재개일은 년도를 포함하고, 일시정지일은 년도가 없는 짧은 형식
        // 예: "2025-11-07" (재개일) vs "2025-10-07" (일시정지일)
        // 또는 "07/11/2025" (재개일) vs "7/10" (일시정지일)
        
        if (hasYear(date1) && !hasYear(date2)) {
          // 첫 번째가 년도 포함, 두 번째가 년도 없음
          resumeDate = date1;
          pauseDate = date2;
        } else if (!hasYear(date1) && hasYear(date2)) {
          // 첫 번째가 년도 없음, 두 번째가 년도 포함
          pauseDate = date1;
          resumeDate = date2;
        } else {
          // 둘 다 년도가 있거나 둘 다 없는 경우
          // 날짜 값으로 판단 (일시정지일이 재개일보다 이전)
          const parseMonth = (dateStr) => {
            // "2025-10-07" 또는 "2025. 10. 7" 형식에서 월 추출
            const isoMatch = dateStr.match(/\d{4}[-.\s]+(\d{1,2})[-.\s]+\d{1,2}/);
            if (isoMatch) return parseInt(isoMatch[1]);
            
            // "7/10" 또는 "07/11/2025" 형식에서 월 추출
            const slashMatch = dateStr.match(/\d{1,2}\/(\d{1,2})/);
            if (slashMatch) return parseInt(slashMatch[1]);
            
            return 0;
          };
          
          const month1 = parseMonth(date1);
          const month2 = parseMonth(date2);
          
          // 일반적으로 일시정지일이 재개일보다 한 달 전
          if (month1 < month2) {
            pauseDate = date1;
            resumeDate = date2;
          } else {
            resumeDate = date1;
            pauseDate = date2;
          }
        }
      } else if (dates.length === 1) {
        // 날짜가 하나만 있는 경우
        const dateStr = dates[0];
        // 년도가 포함된 경우 재개일, 아니면 일시정지일로 간주
        if (dateStr.includes('2025') || dateStr.includes('2026')) {
          resumeDate = dates[0];
        } else {
          pauseDate = dates[0];
        }
      }
      
      // 디버깅: 추출된 날짜 확인
      if (dates.length > 0) {
        console.log(chalk.yellow(`🔍 추출된 날짜들: ${dates.join(', ')}`));
        console.log(chalk.yellow(`🔍 일시정지일 (pauseDate): ${pauseDate}`));
        console.log(chalk.yellow(`🔍 재개일 (resumeDate): ${resumeDate}`));
      }
      
      return {
        handled: true,
        pauseDate: pauseDate,
        resumeDate: resumeDate,
        buttonClicked: confirmResult.text,
        popupText: popupInfo.text, // 팝업 전체 텍스트 추가
        dates: dates // 전체 날짜 배열도 포함
      };
    }
    
    return {
      handled: false,
      reason: 'Confirm button not found',
      dates,
      popupText: popupInfo.text // 팝업 전체 텍스트 추가
    };
  }

  /**
   * 재개 확인 팝업 처리 - 향상된 다국어 지원
   */
  async handleResumePopup(page, language = 'en') {
    // 먼저 일반 팝업 대기
    await new Promise(r => setTimeout(r, this.config.waitForPopup));
    
    // 재개 팝업 감지 (다국어 지원)
    let popupInfo = await this.detectResumePopup(page, language);
    
    // 팝업이 감지되지 않으면 fallback 시도
    if (!popupInfo.hasPopup) {
      if (this.config.debugMode) {
        console.log(chalk.yellow('⚠ No resume popup detected with language-specific texts, trying fallback...'));
      }
      popupInfo = await this.detectResumePopupFallback(page, language);
    }
    
    if (!popupInfo.hasPopup) {
      // 일반 팝업 감지 시도
      const generalPopup = await this.detectPopup(page);
      
      if (!generalPopup.hasPopup) {
        if (this.config.debugMode) {
          console.log(chalk.yellow('✗ No resume popup detected'));
          
          // 페이지 상태 상세 로그
          try {
            const pageInfo = await page.evaluate(() => {
              return {
                title: document.title,
                url: window.location.href,
                bodyTextLength: document.body?.innerText?.length || 0,
                dialogElements: document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]').length,
                overlayElements: document.querySelectorAll('iron-overlay-backdrop, .overlay, .modal').length,
                visibleButtons: Array.from(document.querySelectorAll('button:not([hidden])')).map(btn => 
                  btn.innerText?.trim() || btn.textContent?.trim()
                ).filter(text => text).slice(0, 5)
              };
            });
            
            console.log(chalk.gray('📋 페이지 상태:'));
            console.log(chalk.gray(`  - URL: ${pageInfo.url}`));
            console.log(chalk.gray(`  - Title: ${pageInfo.title}`));
            console.log(chalk.gray(`  - Body text length: ${pageInfo.bodyTextLength}`));
            console.log(chalk.gray(`  - Dialog elements: ${pageInfo.dialogElements}`));
            console.log(chalk.gray(`  - Overlay elements: ${pageInfo.overlayElements}`));
            console.log(chalk.gray(`  - Visible buttons: ${pageInfo.visibleButtons.join(', ')}`));
          } catch (e) {
            console.log(chalk.gray('페이지 상태 로그 실패:', e.message));
          }
        }
        return {
          handled: false,
          reason: 'No popup detected'
        };
      }
      
      // 일반 팝업이 있지만 재개 팝업이 아닌 경우
      if (this.config.debugMode) {
        console.log(chalk.gray('Found popup but not resume popup'));
      }
    }
    
    if (this.config.debugMode) {
      console.log(chalk.green('✓ Resume popup detected'));
      console.log(chalk.gray(`  Language: ${language}`));
    }
    
    // 날짜 정보 추출 (안전한 처리)
    const popupText = popupInfo?.text || '';
    const dates = popupText ? this.extractDatesFromText(popupText) : [];
    
    // 확인 버튼 클릭 (향상된 다국어 지원)
    console.log(chalk.cyan(`📋 팝업 처리 언어: ${language}`));
    const confirmResult = await this.clickResumeConfirmButton(page, language);
    
    if (confirmResult.clicked) {
      await new Promise(r => setTimeout(r, this.config.waitForPopup));
      
      if (confirmResult.text === 'Cancelar') {
        console.log(chalk.red('⚠️ 잘못된 버튼 클릭: "Cancelar" (취소 버튼)'));
        return {
          handled: false,
          reason: 'Wrong button clicked - Cancelar',
          buttonClicked: confirmResult.text
        };
      }
      
      console.log(chalk.green(`✅ ✅ 팝업 내 재개 버튼 클릭 성공: "${confirmResult.text}"`));
      
      return {
        handled: true,
        resumeDate: dates[0] || null,
        nextBillingDate: dates[1] || dates[0] || null,
        buttonClicked: confirmResult.text,
        popupText: popupText // 팝업 전체 텍스트 추가
      };
    }
    
    return {
      handled: false,
      reason: 'Confirm button not found',
      dates,
      availableButtons: popupInfo.buttons
    };
  }
  
  /**
   * 재개 확인 버튼 클릭 - 다국어 지원 (포르투갈어 수정)
   */
  async clickResumeConfirmButton(page, language) {
    const { languages } = require('../infrastructure/config/multilanguage');
    const langData = languages[language] || languages.en;
    
    // 언어별 특별 처리
    if (language === 'pt') {
      // 포르투갈어는 팝업에서 "Retomar" 버튼을 정확히 찾아 클릭
      console.log('📌 포르투갈어 팝업 처리 시작');
      
      return await page.evaluate(() => {
        // 모든 가능한 다이얼로그 선택자
        const dialogSelectors = [
          '[role="dialog"]',
          '[aria-modal="true"]', 
          'tp-yt-paper-dialog',
          'ytd-popup-container',
          '.ytd-popup-container'
        ];
        
        let dialog = null;
        for (const selector of dialogSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            if (el.offsetHeight > 0 && el.style.display !== 'none') {
              dialog = el;
              console.log('📌 활성 다이얼로그 발견:', selector);
              break;
            }
          }
          if (dialog) break;
        }
        
        if (!dialog) {
          console.log('❌ 다이얼로그를 찾을 수 없음');
          return { clicked: false, reason: 'No dialog found' };
        }
        
        // 모든 가능한 버튼 선택자
        const buttonSelectors = [
          'button',
          'tp-yt-paper-button',
          'yt-button-renderer button',
          'ytd-button-renderer button',
          '[role="button"]',
          '.yt-spec-button-shape-next'
        ];
        
        const allButtons = [];
        for (const selector of buttonSelectors) {
          const buttons = dialog.querySelectorAll(selector);
          buttons.forEach(btn => {
            if (!allButtons.includes(btn) && btn.offsetHeight > 0) {
              allButtons.push(btn);
            }
          });
        }
        
        console.log(`📌 팝업에서 ${allButtons.length}개 버튼 발견`);
        
        // 모든 버튼의 텍스트 출력 (디버깅용)
        allButtons.forEach((btn, index) => {
          const text = btn.textContent?.trim();
          console.log(`  버튼 ${index + 1}: "${text}"`);
        });
        
        // 방법 1: 정확한 "Retomar" 텍스트 매칭
        for (const button of allButtons) {
          const btnText = button.textContent?.trim();
          if (btnText === 'Retomar') {
            console.log('✅ "Retomar" 버튼 발견 및 클릭!');
            button.click();
            return { clicked: true, text: btnText };
          }
        }
        
        // 방법 2: 파란색 버튼 찾기 (일반적으로 확인 버튼)
        for (const button of allButtons) {
          const btnText = button.textContent?.trim();
          const styles = window.getComputedStyle(button);
          const bgColor = styles.backgroundColor;
          
          // 파란색 계열 버튼이고 Cancelar가 아닌 경우
          if (btnText !== 'Cancelar' && 
              (bgColor.includes('rgb(6, 95, 212)') || // YouTube 파란색
               bgColor.includes('rgb(26, 115, 232)') || // Google 파란색
               button.classList.contains('yt-spec-button-shape-next--call-to-action') ||
               button.classList.contains('yt-spec-button-shape-next--filled'))) {
            console.log(`✅ 파란색 확인 버튼 클릭: "${btnText}"`);
            button.click();
            return { clicked: true, text: btnText };
          }
        }
        
        // 방법 3: 마지막 버튼 클릭 (일반적으로 확인 버튼)
        if (allButtons.length >= 2) {
          const lastButton = allButtons[allButtons.length - 1];
          const btnText = lastButton.textContent?.trim();
          
          if (btnText && btnText !== 'Cancelar') {
            console.log(`✅ 마지막 버튼 클릭 (대체 방법): "${btnText}"`);
            lastButton.click();
            return { clicked: true, text: btnText };
          }
        }
        
        console.log('❌ Retomar 버튼을 찾을 수 없음');
        return { clicked: false, reason: 'Retomar button not found' };
      });
    }
    
    // 다른 언어의 경우 기존 로직 사용
    // 확인 버튼 텍스트 목록
    const confirmTexts = [
      ...(langData.buttons.confirm || []),
      ...(langData.buttons.resume || []),
      'OK', 'Yes'
    ];
    
    // 취소 버튼 텍스트 (제외용)
    const cancelTexts = langData.buttons.cancel || ['Cancel', '취소'];
    
    return await page.evaluate((confirm, cancel) => {
      const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], tp-yt-paper-dialog');
      
      for (const dialog of dialogs) {
        if (dialog.offsetHeight === 0) continue;
        
        const buttons = dialog.querySelectorAll('button, tp-yt-paper-button, yt-button-renderer button');
        
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          if (!btnText) continue;
          
          // 취소 버튼 제외
          if (cancel.some(text => btnText === text || btnText.includes(text))) {
            continue;
          }
          
          // 확인 버튼 찾기
          if (confirm.some(text => btnText === text || btnText.includes(text))) {
            button.click();
            return { clicked: true, text: btnText };
          }
        }
      }
      
      return { clicked: false };
    }, confirmTexts, cancelTexts);
  }

  /**
   * 일반 팝업 처리
   */
  async handleGenericPopup(page, language = 'en') {
    const popupInfo = await this.detectPopup(page);
    
    if (!popupInfo.hasPopup) {
      return { handled: false };
    }
    
    // 팝업 내용 분석
    const analysis = this.analyzePopupContent(popupInfo.text);
    
    // 적절한 버튼 클릭
    if (analysis.requiresConfirmation) {
      const confirmResult = await this.clickConfirmButton(page, language, 'general');
      
      return {
        handled: confirmResult.clicked,
        type: analysis.type,
        action: confirmResult.text
      };
    }
    
    // 취소가 필요한 경우
    if (analysis.requiresCancellation) {
      const cancelResult = await this.clickCancelButton(page, language);
      
      return {
        handled: cancelResult.clicked,
        type: analysis.type,
        action: 'cancelled'
      };
    }
    
    return {
      handled: false,
      type: analysis.type
    };
  }

  /**
   * 확인 버튼 클릭
   */
  async clickConfirmButton(page, language, action) {
    if (this.buttonService) {
      return await this.buttonService.clickPopupConfirmButton(page, language, action);
    }
    
    // 직접 구현
    const confirmTexts = this.getConfirmTexts(language, action);
    
    return await page.evaluate((texts) => {
      const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
      
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
            return { clicked: true, text: btnText };
          }
        }
      }
      
      return { clicked: false };
    }, confirmTexts);
  }

  /**
   * 취소 버튼 클릭
   */
  async clickCancelButton(page, language) {
    const cancelTexts = language === 'ko' ? 
      ['취소', '닫기', '아니오'] : 
      ['Cancel', 'Close', 'No'];
    
    return await page.evaluate((texts) => {
      const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
      
      for (const dialog of dialogs) {
        if (dialog.offsetHeight === 0) continue;
        
        const buttons = dialog.querySelectorAll('button');
        for (const button of buttons) {
          const btnText = button.textContent?.trim();
          
          if (btnText && texts.some(text => btnText === text)) {
            button.click();
            return { clicked: true, text: btnText };
          }
        }
      }
      
      return { clicked: false };
    }, cancelTexts);
  }

  /**
   * 팝업 닫기 (X 버튼 또는 ESC)
   */
  async closePopup(page) {
    // X 버튼 클릭 시도
    const closeButtonClicked = await page.evaluate(() => {
      const closeButtons = document.querySelectorAll(
        '[aria-label*="Close"], [aria-label*="닫기"], .close-button, .modal-close'
      );
      
      for (const button of closeButtons) {
        if (button.offsetHeight > 0) {
          button.click();
          return true;
        }
      }
      
      return false;
    });
    
    if (closeButtonClicked) {
      return { closed: true, method: 'button' };
    }
    
    // ESC 키 시도
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    
    // 팝업이 닫혔는지 확인
    const stillHasPopup = await this.detectPopup(page);
    
    return {
      closed: !stillHasPopup.hasPopup,
      method: 'escape'
    };
  }

  /**
   * 날짜 추출 및 정규화
   * 특히 YouTube Premium의 "Next billing date" 형식을 정확히 처리
   */
  extractDatesFromText(text) {
    if (!text) return [];
    
    const dates = [];
    const DateParsingService = require('./DateParsingService');
    const dateParser = new DateParsingService();
    
    // 디버깅: 전체 텍스트 길이 확인
    console.log(chalk.gray(`📝 팝업 텍스트 길이: ${text.length}자`));
    
    // 텍스트가 너무 짧으면 경고
    if (text.length < 50) {
      console.log(chalk.yellow(`⚠️ 팝업 텍스트가 잘렸을 가능성 있음`));
    }
    
    // 러시아어 날짜 패턴 (7 окт., 7 нояб. 2025 г.)
    const russianPattern1 = /(\d{1,2})\s+([\u0430-\u044f]+)\.?\s*(\d{4})?\s*г?\.?/gi;
    const russianMatches = text.matchAll(russianPattern1);
    for (const match of russianMatches) {
      const dateStr = match[0];
      const parsed = dateParser.parseRussianDate(dateStr);
      if (parsed && !dates.includes(parsed)) {
        dates.push(parsed);
        console.log(chalk.green(`✅ 러시아어 날짜 추출: ${parsed}`));
      }
    }
    
    // 포르투갈어(브라질) 날짜 패턴 - 개선된 버전
    // "7 de out.", "7 de nov. de 2025", "em 7 de nov."
    const portugueseBrazilPatterns = [
      /em\s+(\d{1,2})\s+de\s+([a-zç]+)\.?(?:\s+de\s+(\d{4}))?/gi,  // "em 7 de nov."
      /(\d{1,2})\s+de\s+([a-zç]+)\.?(?:\s+de\s+(\d{4}))?/gi,       // "7 de out."
      /depois\s+de\s+(\d{1,2})\s+de\s+([a-zç]+)/gi,                // "depois de 7 de out."
      /após\s+(\d{1,2})\s+de\s+([a-zç]+)/gi                        // "após 7 de out."
    ];
    
    for (const pattern of portugueseBrazilPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const dateStr = match[0];
        const parsed = dateParser.parsePortugueseDate(dateStr);
        if (parsed && !dates.includes(parsed)) {
          dates.push(parsed);
          console.log(chalk.green(`✅ 포르투갈어(브라질) 날짜 추출: ${parsed}`));
        }
      }
    }
    
    // 포르투갈어(포르투갈) DD/MM/YYYY 또는 DD/MM 형식
    // "7/10", "07/11/2025", "a 07/11/2025", "após 7/10"
    const portugalPatterns = [
      /a\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g,     // "a 07/11/2025"
      /após\s+(\d{1,2})\/(\d{1,2})/g,                 // "após 7/10"
      /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/g          // "7/10" ou "07/11/2025"
    ];
    
    for (const pattern of portugalPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const dateStr = match[0];
        const parsed = dateParser.parsePortugueseDate(dateStr);
        if (parsed && !dates.includes(parsed)) {
          dates.push(parsed);
          console.log(chalk.green(`✅ 포르투갈어(포르투갈) 날짜 추출: ${parsed}`));
        }
      }
    }
    
    // 한국어 날짜 특별 처리
    const koreanPattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
    const koreanMatches = text.matchAll(koreanPattern);
    for (const match of koreanMatches) {
      dates.push(match[0]);
      console.log(chalk.green(`✅ 한국어 날짜 추출: ${match[0]}`));
    }
    
    // 다양한 날짜 형식 패턴
    const patterns = [
      // DD.MM.YYYY 형식 (독일어, 러시아어 등)
      /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g,
      // YYYY년 MM월 DD일 형식 (한국어, 일본어)
      /\b(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\b/g
    ];
    
    // 다른 패턴들로 날짜 찾기
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const dateStr = match[0];
        if (!dates.includes(dateStr)) {
          dates.push(dateStr);
        }
      }
    }
    
    // 디버그 로그
    if (this.config.debugMode && dates.length > 0) {
      console.log(chalk.cyan(`📅 추출된 날짜들: ${dates.join(', ')}`));
    }
    
    return dates;
  }

  /**
   * 날짜 형식 정규화 (YYYY-MM-DD 형식으로 변환)
   */
  normalizeDate(dateStr) {
    try {
      // 입력값 검증
      if (!dateStr || typeof dateStr !== 'string') {
        return null;
      }
      
      // 공백 제거 및 정규화
      dateStr = dateStr.trim();
      // 월 이름 맵핑
      const monthMap = {
        'january': '01', 'jan': '01',
        'february': '02', 'feb': '02',
        'march': '03', 'mar': '03',
        'april': '04', 'apr': '04',
        'may': '05',
        'june': '06', 'jun': '06',
        'july': '07', 'jul': '07',
        'august': '08', 'aug': '08',
        'september': '09', 'sep': '09', 'sept': '09',
        'october': '10', 'oct': '10',
        'november': '11', 'nov': '11',
        'december': '12', 'dec': '12'
      };

      let year, month, day;
      
      // 현재 날짜 정보 (년도가 없는 경우 사용)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // ISO 형식 (2024-01-01)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
      }

      // 점 구분 형식 (2024.01.01 또는 2024. 01. 01)
      if (/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}$/.test(dateStr)) {
        const parts = dateStr.split(/\.\s*/);
        year = parts[0];
        month = parts[1].padStart(2, '0');
        day = parts[2].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      // 한국어 날짜 (2024년 1월 1일)
      if (/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$/.test(dateStr)) {
        const match = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
        year = match[1];
        month = match[2].padStart(2, '0');
        day = match[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      // 영어 날짜 (January 1, 2024)
      const engMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/i);
      if (engMatch) {
        const monthName = engMatch[1].toLowerCase();
        month = monthMap[monthName];
        if (!month) return null;
        day = engMatch[2].padStart(2, '0');
        year = engMatch[3];
        return `${year}-${month}-${day}`;
      }
      
      // 월 일 형식 (Sep 11) - 년도 없음
      const monthDayMatch = dateStr.match(/^([A-Za-z]+)\s+(\d{1,2})$/i);
      if (monthDayMatch) {
        const monthName = monthDayMatch[1].toLowerCase();
        month = monthMap[monthName];
        if (!month) return null;
        day = monthDayMatch[2].padStart(2, '0');
        
        // 현재 날짜와 비교하여 년도 결정
        const monthNum = parseInt(month);
        if (monthNum < currentMonth) {
          // 해당 월이 현재 월보다 이전이면 내년
          year = currentYear + 1;
        } else {
          // 해당 월이 현재 월 이후면 올해
          year = currentYear;
        }
        
        return `${year}-${month}-${day}`;
      }

      // 슬래시 형식 (MM/DD/YYYY)
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const parts = dateStr.split('/');
        month = parts[0].padStart(2, '0');
        day = parts[1].padStart(2, '0');
        year = parts[2];
        return `${year}-${month}-${day}`;
      }

      // 슬래시 형식 (YYYY/MM/DD)
      if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(dateStr)) {
        const parts = dateStr.split('/');
        year = parts[0];
        month = parts[1].padStart(2, '0');
        day = parts[2].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      // 파싱 실패 시 원본 반환
      console.log(`날짜 파싱 실패: ${dateStr}`);
      return null;
      
    } catch (error) {
      console.error(`날짜 정규화 오류: ${dateStr}`, error);
      return null;
    }
  }

  /**
   * 팝업 내용 분석
   */
  analyzePopupContent(text) {
    const analysis = {
      type: 'unknown',
      requiresConfirmation: false,
      requiresCancellation: false,
      isError: false,
      isWarning: false
    };
    
    // 에러 팝업 감지
    if (text.includes('error') || text.includes('오류') || 
        text.includes('failed') || text.includes('실패')) {
      analysis.type = 'error';
      analysis.isError = true;
      analysis.requiresConfirmation = true;
    }
    
    // 경고 팝업 감지
    else if (text.includes('warning') || text.includes('경고') ||
             text.includes('notice') || text.includes('알림')) {
      analysis.type = 'warning';
      analysis.isWarning = true;
      analysis.requiresConfirmation = true;
    }
    
    // 확인 팝업 감지
    else if (text.includes('confirm') || text.includes('확인') ||
             text.includes('are you sure') || text.includes('정말')) {
      analysis.type = 'confirmation';
      analysis.requiresConfirmation = true;
    }
    
    // 정보 팝업
    else {
      analysis.type = 'info';
      analysis.requiresConfirmation = true;
    }
    
    return analysis;
  }

  /**
   * 확인 텍스트 가져오기 - 다국어 지원
   */
  getConfirmTexts(language, action) {
    // multilanguage.js에서 언어 데이터 가져오기
    const { languages } = require('../infrastructure/config/multilanguage');
    const langData = languages[language] || languages.en;
    
    // 액션별 확인 텍스트 매핑
    if (action === 'pause') {
      return [
        ...(langData.buttons.pauseMembership || []),
        ...(langData.buttons.confirm || []),
        langData.buttons.pause?.[0] || 'Pause'
      ];
    } else if (action === 'resume') {
      return [
        ...(langData.buttons.resumeMembership || []),
        ...(langData.buttons.resume || []),
        ...(langData.buttons.confirm || []),
        'OK', 'Yes'
      ];
    } else {
      return langData.buttons.confirm || ['Confirm', 'OK', 'Yes'];
    }
  }
  
  /**
   * 재개 팝업 감지 향상 - 다국어 지원
   */
  async detectResumePopup(page, language = 'en') {
    const { languages } = require('../infrastructure/config/multilanguage');
    const langData = languages[language] || languages.en;
    
    // 디버그 로깅 추가
    if (this.config.debugMode) {
      console.log(chalk.gray(`[DetectResumePopup] Language: ${language}`));
      console.log(chalk.gray(`[DetectResumePopup] Has popupTexts: ${!!langData.popupTexts}`));
      if (langData.popupTexts) {
        console.log(chalk.gray(`[DetectResumePopup] Resume texts: ${langData.popupTexts.resumeConfirmation?.join(', ') || 'None'}}`));
      }
    }
    
    const popupInfo = await page.evaluate((popupTexts) => {
      const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'yt-dialog',
        'ytd-popup-container'
      ];
      
      for (const selector of selectors) {
        const dialogs = document.querySelectorAll(selector);
        
        for (const dialog of dialogs) {
          if (dialog.offsetHeight > 0 && dialog.offsetWidth > 0) {
            const text = dialog.textContent?.trim() || '';
            
            // 재개 관련 텍스트 확인 - 안전한 처리
            const hasResumeText = 
              (popupTexts?.resumeConfirmation && popupTexts.resumeConfirmation.some(t => text.includes(t))) ||
              (popupTexts?.willBeResumed && popupTexts.willBeResumed.some(t => text.includes(t))) ||
              (popupTexts?.nextCharge && popupTexts.nextCharge.some(t => text.includes(t))) ||
              // 러시아어 특별 처리 - popupTexts가 없어도 키워드 검색
              text.includes('Возобновить подписку') ||
              text.includes('Подписка будет возобновлена') ||
              text.includes('Следующий платеж') ||
              text.includes('Следующее списание');
            
            if (hasResumeText) {
              const buttons = dialog.querySelectorAll('button');
              return {
                hasPopup: true,
                isResumePopup: true,
                text: text.substring(0, 500),
                buttons: Array.from(buttons).map(btn => ({
                  text: btn.textContent?.trim(),
                  ariaLabel: btn.getAttribute('aria-label')
                })).filter(b => b.text)
              };
            }
          }
        }
      }
      
      return { hasPopup: false };
    }, langData.popupTexts || {});
    
    // 디버그 로깅
    if (this.config.debugMode) {
      console.log(chalk.gray(`[DetectResumePopup] Result: ${popupInfo.hasPopup ? 'Found' : 'Not found'}`));
      if (popupInfo.hasPopup) {
        console.log(chalk.gray(`[DetectResumePopup] Text snippet: ${popupInfo.text?.substring(0, 100)}...`));
        console.log(chalk.gray(`[DetectResumePopup] Buttons: ${popupInfo.buttons?.map(b => b.text).join(', ')}`));
      }
    }
    
    return popupInfo;
  }
  
  /**
   * 재개 팝업 fallback 감지 - 언어에 관계없이 버튼으로 판단
   */
  async detectResumePopupFallback(page, language) {
    const popupInfo = await page.evaluate(() => {
      const selectors = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'tp-yt-paper-dialog',
        'yt-dialog',
        'ytd-popup-container'
      ];
      
      for (const selector of selectors) {
        const dialogs = document.querySelectorAll(selector);
        
        for (const dialog of dialogs) {
          if (dialog.offsetHeight > 0 && dialog.offsetWidth > 0) {
            const text = dialog.textContent?.trim() || '';
            const buttons = dialog.querySelectorAll('button');
            const buttonTexts = Array.from(buttons).map(btn => btn.textContent?.trim()).filter(t => t);
            
            // 버튼 텍스트로 재개 팝업 판단
            // 재개 팝업은 보통 확인/취소 2개 버튼을 가짐
            const hasConfirmCancel = buttonTexts.length === 2 && 
              buttonTexts.some(t => 
                // 확인 버튼 키워드
                t.includes('Возобновить') || // 러시아어 "재개"
                t.includes('재개') || // 한국어
                t.includes('Resume') || // 영어
                t.includes('Reanudar') || // 스페인어
                t.includes('Reprendre') || // 프랑스어
                t.includes('Retomar') || // 포르투갈어
                t.includes('Fortsetzen') || // 독일어
                t.includes('Devam') || // 터키어
                t.includes('Tiếp tục') // 베트남어
              ) &&
              buttonTexts.some(t => 
                // 취소 버튼 키워드
                t.includes('Отмена') || // 러시아어 "취소"
                t.includes('취소') || // 한국어
                t.includes('Cancel') || // 영어
                t.includes('Cancelar') || // 스페인어/포르투갈어
                t.includes('Annuler') || // 프랑스어
                t.includes('Abbrechen') || // 독일어
                t.includes('İptal') // 터키어
              );
            
            // 또는 팝업 텍스트에 날짜 패턴이 있는지 확인
            const hasDatePattern = /\d{1,2}[\s\/\-\.]\d{1,2}|\d{4}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{1,2}/.test(text);
            
            if (hasConfirmCancel || hasDatePattern) {
              return {
                hasPopup: true,
                isResumePopup: true,
                text: text.substring(0, 500),
                buttons: buttonTexts.map(text => ({ text })),
                detectedBy: 'fallback'
              };
            }
          }
        }
      }
      
      return { hasPopup: false };
    });
    
    if (this.config.debugMode) {
      console.log(chalk.gray(`[DetectResumePopupFallback] Result: ${popupInfo.hasPopup ? 'Found' : 'Not found'}`));
      if (popupInfo.hasPopup) {
        console.log(chalk.gray(`[DetectResumePopupFallback] Detected by: ${popupInfo.detectedBy}`));
        console.log(chalk.gray(`[DetectResumePopupFallback] Buttons: ${popupInfo.buttons?.map(b => b.text).join(', ')}`));
      }
    }
    
    return popupInfo;
  }
}

module.exports = PopupService;