/**
 * 언어 독립적인 범용 DOM 처리 서비스
 * 텍스트 매칭 대신 DOM 구조와 속성을 활용한 안정적인 자동화
 * 
 * @author SuperClaude
 * @date 2025-01-09
 */

class UniversalDOMService {
  constructor({ logger, debugMode = false }) {
    this.logger = logger;
    this.debugMode = debugMode;
  }

  /**
   * YouTube Premium 페이지의 구조 분석
   * 언어에 관계없이 동일한 DOM 구조를 활용
   */
  async analyzePageStructure(page) {
    return await page.evaluate(() => {
      const structure = {
        hasManagementSection: false,
        hasResumeButton: false,
        hasPauseButton: false,
        hasActiveSubscription: false,
        buttons: [],
        sections: []
      };

      // 1. data-속성 기반 탐색 (YouTube는 data-속성을 광범위하게 사용)
      const managementButtons = document.querySelectorAll([
        '[data-item-id*="manage"]',
        '[data-endpoint*="manage"]',
        '[aria-label*="manage" i]',
        'button[id*="manage"]',
        'tp-yt-paper-button[id*="manage"]'
      ].join(','));

      structure.hasManagementSection = managementButtons.length > 0;

      // 2. 아이콘 기반 버튼 탐색 (YouTube는 Material Icons 사용)
      const allButtons = document.querySelectorAll('button, tp-yt-paper-button, [role="button"]');
      
      allButtons.forEach(button => {
        // 버튼의 위치와 스타일 정보 수집
        const rect = button.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(button);
        
        // 아이콘 확인
        const icon = button.querySelector('yt-icon, iron-icon, svg');
        const iconType = icon ? (icon.getAttribute('icon') || icon.getAttribute('name') || '') : '';
        
        // 버튼 색상으로 타입 추론 (Primary, Secondary, Danger)
        const backgroundColor = computedStyle.backgroundColor;
        const color = computedStyle.color;
        
        const buttonInfo = {
          element: button,
          position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visible: rect.width > 0 && rect.height > 0,
          iconType,
          isPrimary: backgroundColor.includes('rgb(6, 95, 212)') || // YouTube Blue
                     backgroundColor.includes('rgb(26, 115, 232)'),
          isSecondary: backgroundColor === 'transparent' || 
                       backgroundColor.includes('rgba(0, 0, 0, 0)'),
          isDanger: color.includes('rgb(234, 67, 53)') || // YouTube Red
                    backgroundColor.includes('rgb(234, 67, 53)'),
          text: button.textContent?.trim() || '',
          ariaLabel: button.getAttribute('aria-label') || '',
          dataTestId: button.getAttribute('data-test-id') || '',
          parentSection: button.closest('[role="region"], [role="section"], ytd-expandable-section-body-renderer')
        };

        structure.buttons.push(buttonInfo);
      });

      // 3. 섹션 구조 분석 (Expandable sections)
      const expandableSections = document.querySelectorAll('ytd-expandable-section-body-renderer');
      expandableSections.forEach(section => {
        const isExpanded = section.offsetHeight > 0;
        const buttons = section.querySelectorAll('button, tp-yt-paper-button');
        
        structure.sections.push({
          expanded: isExpanded,
          buttonCount: buttons.length,
          hasPrimaryButton: Array.from(buttons).some(btn => 
            window.getComputedStyle(btn).backgroundColor.includes('rgb(6, 95, 212)')
          )
        });
      });

      // 4. 구독 상태 확인 (날짜 형식 패턴으로)
      const pageText = document.body.textContent || '';
      // 모든 언어에서 날짜는 숫자를 포함
      const hasDatePattern = /\d{1,2}[\/\-\.\s]\d{1,2}|\d{4}[\/\-\.]\d{1,2}/.test(pageText);
      structure.hasActiveSubscription = hasDatePattern;

      return structure;
    });
  }

  /**
   * 멤버십 관리 버튼 찾기 (언어 독립적)
   * 위치와 스타일 기반으로 식별
   */
  async findManagementButton(page) {
    return await page.evaluate(() => {
      // 전략 1: 위치 기반 - 첫 번째 주요 액션 버튼
      const primaryButtons = Array.from(document.querySelectorAll('button, tp-yt-paper-button'))
        .filter(btn => {
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          
          // 화면 중앙 근처에 있고, 충분한 크기를 가진 버튼
          return rect.width > 100 && 
                 rect.height > 30 &&
                 rect.top < window.innerHeight * 0.7 &&
                 rect.top > 100 &&
                 !style.backgroundColor.includes('transparent');
        });

      // 전략 2: 계층 구조 기반
      const managementCandidates = primaryButtons.filter(btn => {
        // 부모 요소가 subscription 관련 컨테이너인지 확인
        const parent = btn.closest('ytd-membership-item-renderer, [class*="membership"], [class*="subscription"]');
        return parent !== null;
      });

      // 전략 3: 아이콘 기반 (설정/관리 아이콘)
      const iconButtons = primaryButtons.filter(btn => {
        const icon = btn.querySelector('yt-icon[icon*="settings"], yt-icon[icon*="manage"], svg');
        return icon !== null;
      });

      // 우선순위: 관리 후보 > 아이콘 버튼 > 일반 Primary 버튼
      const targetButton = managementCandidates[0] || iconButtons[0] || primaryButtons[0];
      
      if (targetButton) {
        console.log('멤버십 관리 버튼 발견 (언어 독립적)');
        targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { found: true, element: targetButton };
      }

      return { found: false };
    });
  }

  /**
   * 재개/일시정지 버튼 찾기 (확장된 섹션 내에서)
   * 버튼 색상과 위치로 구분
   */
  async findActionButtonInExpandedSection(page, actionType = 'resume') {
    return await page.evaluate((type) => {
      // 확장된 섹션 찾기
      const expandedSections = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          const style = window.getComputedStyle(el);
          const height = el.offsetHeight;
          
          // 확장된 섹션: 높이가 있고, overflow가 visible
          return height > 50 && 
                 height < 500 && // 너무 큰 섹션 제외
                 (style.overflow === 'visible' || style.overflow === 'auto') &&
                 el.querySelector('button, tp-yt-paper-button');
        });

      for (const section of expandedSections) {
        const buttons = Array.from(section.querySelectorAll('button, tp-yt-paper-button'))
          .filter(btn => btn.offsetWidth > 0 && btn.offsetHeight > 0);

        // 색상으로 버튼 타입 구분
        for (const button of buttons) {
          const style = window.getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          
          if (type === 'resume') {
            // 재개 버튼: 일반적으로 Primary 색상 (파란색)
            if (style.backgroundColor.includes('rgb(6, 95, 212)') ||
                style.backgroundColor.includes('rgb(26, 115, 232)') ||
                style.color.includes('rgb(6, 95, 212)')) {
              console.log('재개 버튼 발견 (색상 기반)');
              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return { found: true, element: button };
            }
          } else if (type === 'pause') {
            // 일시정지 버튼: 일반적으로 Secondary 또는 경고 색상
            if (!style.backgroundColor.includes('rgb(6, 95, 212)') &&
                (style.borderColor || style.color.includes('rgb(234, 67, 53)'))) {
              console.log('일시정지 버튼 발견 (색상 기반)');
              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return { found: true, element: button };
            }
          }
        }

        // 대체 전략: 위치 기반 (섹션 내 첫 번째/두 번째 버튼)
        if (buttons.length > 0) {
          const targetButton = type === 'resume' ? buttons[0] : buttons[buttons.length - 1];
          console.log(`${type} 버튼 발견 (위치 기반)`);
          targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { found: true, element: targetButton };
        }
      }

      return { found: false };
    }, actionType);
  }

  /**
   * 팝업 다이얼로그 처리 (언어 독립적)
   * 팝업 구조와 버튼 위치로 처리
   */
  async handlePopupDialog(page, confirmAction = true) {
    return await page.evaluate((confirm) => {
      // 팝업 다이얼로그 선택자 (YouTube 공통)
      const dialogSelectors = [
        'tp-yt-paper-dialog:not([aria-hidden="true"])',
        '[role="dialog"]:not([aria-hidden="true"])',
        '[aria-modal="true"]',
        'ytd-popup-container:not([hidden])',
        '.opened[role="dialog"]'
      ];

      let dialog = null;
      for (const selector of dialogSelectors) {
        const candidate = document.querySelector(selector);
        if (candidate && candidate.offsetHeight > 0) {
          dialog = candidate;
          break;
        }
      }

      if (!dialog) {
        console.log('팝업 다이얼로그를 찾을 수 없음');
        return { found: false };
      }

      console.log('팝업 다이얼로그 발견');

      // 팝업 내 버튼 찾기
      const buttons = Array.from(dialog.querySelectorAll('button, tp-yt-paper-button, [role="button"]'))
        .filter(btn => btn.offsetWidth > 0 && btn.offsetHeight > 0);

      console.log(`팝업 내 ${buttons.length}개 버튼 발견`);

      if (buttons.length === 0) {
        return { found: true, clicked: false, error: '버튼 없음' };
      }

      // 버튼 분석: 색상과 위치로 타입 결정
      const buttonAnalysis = buttons.map(btn => {
        const style = window.getComputedStyle(btn);
        const rect = btn.getBoundingClientRect();
        
        return {
          element: btn,
          isPrimary: style.backgroundColor.includes('rgb(6, 95, 212)') ||
                     style.backgroundColor.includes('rgb(26, 115, 232)'),
          isSecondary: style.backgroundColor === 'transparent' ||
                       style.borderWidth !== '0px',
          position: rect.x,
          text: btn.textContent?.trim() || ''
        };
      });

      // 확인/취소 버튼 결정
      let targetButton;
      if (confirm) {
        // 확인: Primary 버튼 또는 오른쪽 버튼
        targetButton = buttonAnalysis.find(b => b.isPrimary) ||
                      buttonAnalysis.sort((a, b) => b.position - a.position)[0];
      } else {
        // 취소: Secondary 버튼 또는 왼쪽 버튼
        targetButton = buttonAnalysis.find(b => b.isSecondary) ||
                      buttonAnalysis.sort((a, b) => a.position - b.position)[0];
      }

      if (targetButton) {
        console.log(`${confirm ? '확인' : '취소'} 버튼 클릭 (위치: ${targetButton.position})`);
        
        // 클릭 이벤트 발송
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1
        });
        
        targetButton.element.dispatchEvent(clickEvent);
        
        // 대체 클릭 방법
        if (targetButton.element.click) {
          targetButton.element.click();
        }
        
        return { found: true, clicked: true, buttonType: confirm ? 'confirm' : 'cancel' };
      }

      return { found: true, clicked: false, error: '적절한 버튼을 찾을 수 없음' };
    }, confirmAction);
  }

  /**
   * 섹션 확장 상태 확인 (언어 독립적)
   */
  async isSectionExpanded(page) {
    return await page.evaluate(() => {
      // 확장 가능한 섹션 찾기
      const expandableSections = document.querySelectorAll([
        'ytd-expandable-section-body-renderer',
        '[class*="expandable"]',
        '[aria-expanded]'
      ].join(','));

      for (const section of expandableSections) {
        // 높이로 확장 여부 판단
        if (section.offsetHeight > 100) {
          // 섹션 내에 버튼이 있는지 확인
          const buttons = section.querySelectorAll('button, tp-yt-paper-button');
          if (buttons.length > 0) {
            return true;
          }
        }
        
        // aria-expanded 속성 확인
        if (section.getAttribute('aria-expanded') === 'true') {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * 스마트 클릭 - 여러 방법으로 클릭 시도
   */
  async smartClick(page, element) {
    return await page.evaluate((el) => {
      if (!el) return false;

      // 1. 스크롤하여 뷰포트에 표시
      el.scrollIntoView({ behavior: 'instant', block: 'center' });

      // 2. 다양한 클릭 방법 시도
      const clickMethods = [
        // MouseEvent dispatch
        () => {
          const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            buttons: 1
          });
          el.dispatchEvent(event);
        },
        // PointerEvent dispatch
        () => {
          const event = new PointerEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            buttons: 1
          });
          el.dispatchEvent(event);
        },
        // 직접 click() 호출
        () => el.click(),
        // jQuery 클릭 (있는 경우)
        () => {
          if (window.jQuery) {
            window.jQuery(el).trigger('click');
          }
        }
      ];

      // 모든 방법 시도
      for (const method of clickMethods) {
        try {
          method();
          console.log('클릭 성공');
          return true;
        } catch (e) {
          console.log('클릭 방법 실패, 다음 시도...');
        }
      }

      return false;
    }, element);
  }
}

module.exports = UniversalDOMService;