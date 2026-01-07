/**
 * Google 계정 선택 페이지 처리 모듈
 * - 로그아웃된 계정을 클릭 (휴먼라이크 모션)
 * - 시간에 따른 페이지 변화 모니터링
 * - 여러 번 클릭 시도로 성공률 향상
 */

const chalk = require('chalk');

class ImprovedAccountChooserHandler {
  constructor(page, options = {}) {
    this.page = page;
    this.logger = options.logger || console;
    this.debugMode = options.debugMode || false;
    this.screenshotEnabled = options.screenshotEnabled !== false;
    this.mouseSpeed = options.mouseSpeed || 'normal';
  }

  /**
   * 계정 선택 페이지인지 확인
   * - Google 계정 선택 페이지의 다양한 URL 패턴 지원
   */
  async isAccountChooserPage() {
    const url = this.page.url();

    // URL 기반 확인
    if (url.includes('accountchooser') ||
        url.includes('accounts.google.com/v3/signin/identifier') ||
        url.includes('accounts.google.com/signin/v2/identifier')) {
      return true;
    }

    // DOM 기반 확인 - "계정을 선택하세요" 텍스트가 있는지
    try {
      const hasAccountChooserText = await this.page.evaluate(() => {
        const bodyText = document.body?.textContent || '';
        return bodyText.includes('계정을 선택하세요') ||
               bodyText.includes('Choose an account') ||
               bodyText.includes('계정 선택') ||
               bodyText.includes('Use your Google Account');
      });
      return hasAccountChooserText;
    } catch (e) {
      return false;
    }
  }

  /**
   * 계정 선택 페이지 처리 (v2.0 - 로그아웃되지 않은 계정도 클릭 가능)
   *
   * 개선사항:
   * - 로그아웃된 계정 우선 클릭
   * - 로그아웃되지 않은 계정도 클릭 가능 (방어적 처리)
   * - 계정이 목록에 있으면 무조건 클릭 시도
   */
  async handleAccountChooser(email) {
    this.logger.info('🔍 계정 선택 페이지 처리 시작 (v2.0)', { email });

    // 이메일 정규화 (소문자로)
    const normalizedEmail = email.toLowerCase().trim();

    // 현재 페이지 확인
    if (!await this.isAccountChooserPage()) {
      this.logger.warn('계정 선택 페이지가 아닙니다');
      return { success: false, reason: 'not_account_chooser' };
    }

    // 페이지 구조 분석 (디버깅용)
    const pageInfo = await this.analyzeAccountChooserPage();

    // 대소문자 무시하고 이메일 비교
    const hasTargetEmail = pageInfo.emails.some(e =>
      e.toLowerCase() === normalizedEmail
    );
    const isTargetLoggedOut = pageInfo.loggedOutEmails.some(e =>
      e.toLowerCase() === normalizedEmail
    );

    this.logger.info('📄 계정 선택 페이지 분석 결과:', {
      totalAccounts: pageInfo.totalAccounts,
      loggedOutAccounts: pageInfo.loggedOutAccounts,
      hasTargetEmail: hasTargetEmail,
      isTargetLoggedOut: isTargetLoggedOut,
      allEmails: pageInfo.emails,
      loggedOutEmails: pageInfo.loggedOutEmails
    });

    // v2.0: 로그아웃 상태 여부와 관계없이 계정이 있으면 클릭 시도
    if (hasTargetEmail && !isTargetLoggedOut) {
      this.logger.info(`ℹ️ 계정 ${email}이(가) 로그아웃 상태가 아니지만 클릭 시도합니다`);
    }

    // 계정 클릭 시도 (로그아웃 여부 관계없이)
    const result = await this.clickAccount(email, !isTargetLoggedOut);

    if (result.success) {
      this.logger.info(`✅ 로그아웃된 계정 선택 성공: ${email}`);
      // 스크린샷 저장
      if (this.screenshotEnabled) {
        await this.saveScreenshot(`after_logged_out_account_click_${Date.now()}.png`);
      }
    } else {
      this.logger.error(`❌ 로그아웃된 계정 선택 실패: ${email}`);

      // 실패 시 페이지 상태 스크린샷
      if (this.screenshotEnabled) {
        await this.saveScreenshot(`failed_to_find_logged_out_account_${Date.now()}.png`);
      }
    }

    return result;
  }

  /**
   * 계정 선택 페이지 분석 (디버깅용)
   */
  async analyzeAccountChooserPage() {
    return await this.page.evaluate(() => {
      const loggedOutTexts = [
        '로그아웃됨', '로그아웃 됨', 'Signed out', 'Logged out'
      ];
      
      const accounts = document.querySelectorAll('[data-identifier]');
      const emails = [];
      const loggedOutEmails = [];
      let loggedOutCount = 0;
      
      // 디버깅: 페이지의 전체 HTML 구조 일부 출력
      console.log('📋 페이지 구조 분석:');
      const accountContainer = document.querySelector('.VmOpGe') || 
                              document.querySelector('[role="list"]') ||
                              document.querySelector('ul');
      if (accountContainer) {
        console.log('계정 컨테이너 HTML (처음 500자):', accountContainer.innerHTML.substring(0, 500));
      }
      
      accounts.forEach(account => {
        const email = account.getAttribute('data-identifier');
        if (email) {
          emails.push(email);
          
          // 로그아웃 상태 확인 - 더 넓은 범위로 검색
          let checkElement = account;
          let isLoggedOut = false;
          
          // 최대 5단계 위로 올라가며 로그아웃 텍스트 찾기
          for (let i = 0; i < 5 && checkElement; i++) {
            const text = checkElement.textContent || '';
            if (loggedOutTexts.some(logoutText => text.includes(logoutText))) {
              isLoggedOut = true;
              loggedOutCount++;
              loggedOutEmails.push(email);
              console.log(`✅ 로그아웃된 계정 발견: ${email}`);
              break;
            }
            checkElement = checkElement.parentElement;
          }
          
          if (!isLoggedOut) {
            console.log(`⚠️ 로그인된 계정: ${email}`);
          }
        }
      });
      
      // 추가 디버깅: 모든 로그아웃 텍스트가 있는 요소 찾기
      console.log('🔍 로그아웃 텍스트가 포함된 요소 검색:');
      loggedOutTexts.forEach(text => {
        const elements = Array.from(document.querySelectorAll('*')).filter(el => 
          el.textContent && el.textContent.includes(text)
        );
        if (elements.length > 0) {
          console.log(`"${text}" 텍스트를 포함한 요소: ${elements.length}개`);
        }
      });
      
      return {
        totalAccounts: accounts.length,
        loggedOutAccounts: loggedOutCount,
        emails: emails,
        loggedOutEmails: loggedOutEmails
      };
    });
  }

  /**
   * 계정 요소 찾기 (v2.0 - 로그아웃되지 않은 계정도 찾을 수 있음)
   *
   * @param {string} email - 찾을 계정 이메일
   * @param {boolean} allowNonLoggedOut - true이면 로그아웃되지 않은 계정도 반환 (기본: false)
   */
  async findAccountElement(email, allowNonLoggedOut = false) {
    return await this.page.evaluate((targetEmail, allowNonLoggedOutArg) => {
      // 디버깅: 페이지의 모든 계정 관련 요소 출력
      console.log('🔍 페이지 분석 시작...');

      // 로그아웃된 계정을 찾기 위한 로그아웃 텍스트 패턴
      const loggedOutTexts = [
        '로그아웃됨', '로그아웃 됨', 'Signed out', 'Logged out',
        'Desconectado', 'Déconnecté', 'Abgemeldet', '已登出', 'ログアウト済み'
      ];

      // 디버깅: 모든 data-identifier 속성 확인
      const allIdentifiers = document.querySelectorAll('[data-identifier]');
      console.log(`📌 발견된 data-identifier 요소: ${allIdentifiers.length}개`);
      allIdentifiers.forEach((elem, idx) => {
        const identifier = elem.getAttribute('data-identifier');
        const parent = elem.closest('li') || elem.closest('[role="link"]') || elem.closest('[role="button"]') || elem.parentElement;
        const parentText = parent ? parent.textContent : '';
        console.log(`  ${idx + 1}. ${identifier} - 텍스트: ${parentText.substring(0, 100)}`);
      });

      // 방법 1: data-identifier와 로그아웃 상태 확인
      // 이메일을 소문자로 정규화하여 비교
      const normalizedTargetEmail = targetEmail.toLowerCase().trim();

      // 모든 data-identifier 요소를 가져와서 대소문자 무시 비교
      let byIdentifier = null;
      const allIdentifiersForMatch = document.querySelectorAll('[data-identifier]');
      for (const elem of allIdentifiersForMatch) {
        const identifier = elem.getAttribute('data-identifier');
        if (identifier && identifier.toLowerCase().trim() === normalizedTargetEmail) {
          byIdentifier = elem;
          console.log(`📧 data-identifier 매치 (대소문자 무시): ${identifier}`);
          break;
        }
      }

      // 백업: 정확한 매칭 시도 (레거시 호환)
      if (!byIdentifier) {
        const emailVariations = [
          targetEmail,
          targetEmail.toLowerCase(),
          targetEmail.charAt(0).toUpperCase() + targetEmail.slice(1).toLowerCase()
        ];

        for (const emailVar of emailVariations) {
          byIdentifier = document.querySelector(`[data-identifier="${emailVar}"]`);
          if (byIdentifier) {
            console.log(`📧 data-identifier 매치 (정확): ${emailVar}`);
            break;
          }
        }
      }

      if (byIdentifier) {
        console.log(`✅ data-identifier 발견: ${targetEmail}`);

        // data-identifier 요소 자체의 위치 정보 출력
        const identifierRect = byIdentifier.getBoundingClientRect();
        console.log(`  data-identifier 요소 위치: (${identifierRect.x}, ${identifierRect.y})`);
        console.log(`  data-identifier 요소 크기: ${identifierRect.width}x${identifierRect.height}`);

        // 상위 클릭 가능한 요소 찾기 - 더 정확하게
        let clickableParent = byIdentifier;
        let foundClickable = false;

        // 최대 10단계까지 상위로 올라가며 클릭 가능한 요소 찾기
        for (let i = 0; i < 10; i++) {
          const parent = clickableParent.parentElement;
          if (!parent) break;

          // "다른 계정 사용" 관련 텍스트가 있는지 먼저 확인
          const parentText = parent.textContent || '';
          const forbiddenTexts = ['다른 계정 사용', 'Use another account', 'Add another account', '계정 추가'];
          const hasForbiddenText = forbiddenTexts.some(text => parentText.includes(text));

          if (hasForbiddenText) {
            console.log(`⚠️ "다른 계정 사용" 버튼이 부모에 있음 - 중단`);
            break; // 더 이상 상위로 가지 않음
          }

          // 클릭 가능한 요소 타입 확인
          const isClickable =
            parent.hasAttribute('role') ||
            parent.tagName === 'LI' ||
            parent.tagName === 'BUTTON' ||
            parent.tagName === 'A' ||
            parent.hasAttribute('data-identifier') ||
            parent.classList.contains('VmOpGe') || // Google 계정 선택 컨테이너
            parent.hasAttribute('jsaction');

          if (isClickable) {
            clickableParent = parent;
            foundClickable = true;
            console.log(`🎯 클릭 가능한 부모 발견 (레벨 ${i}): ${parent.tagName} ${parent.className}`);
          }
          // 중요: clickableParent = parent를 제거! isClickable일 때만 업데이트
        }

        const parentText = clickableParent.textContent || '';
        console.log(`최종 부모 요소 텍스트: ${parentText.substring(0, 150)}`);
        console.log(`최종 부모 요소 태그: ${clickableParent.tagName}, 클래스: ${clickableParent.className}`);

        // 최종 검증: "다른 계정 사용" 텍스트가 없어야 함
        const forbiddenTexts = ['다른 계정 사용', 'Use another account', 'Add another account', '계정 추가'];
        const containsForbidden = forbiddenTexts.some(text => parentText.includes(text));

        if (containsForbidden) {
          console.log(`❌ 최종 요소에 "다른 계정 사용" 텍스트 포함 - 건너뜀`);
          // 방법 2로 넘어가기
        } else {
          // 로그아웃 상태인지 확인
          const isLoggedOut = loggedOutTexts.some(text => parentText.includes(text));

          // v2.0: 로그아웃 상태이거나 allowNonLoggedOut이면 반환
          if (isLoggedOut || allowNonLoggedOutArg) {
            const finalRect = clickableParent.getBoundingClientRect();

            // 요소가 화면에 보이는지 확인
            const isVisible = finalRect.width > 0 && finalRect.height > 0 &&
                            finalRect.top >= 0 && finalRect.left >= 0;

            if (!isVisible) {
              console.log(`⚠️ 요소가 화면에 보이지 않음: ${finalRect.width}x${finalRect.height}`);
            }

            const statusText = isLoggedOut ? '로그아웃된' : '로그인된 (v2.0 방어적 처리)';
            console.log(`✅ ${statusText} 계정 발견: ${targetEmail}`);
            console.log(`  위치: (${finalRect.x}, ${finalRect.y}), 크기: ${finalRect.width}x${finalRect.height}`);

            // 요소에 ID 부여 (클릭 시 참조용)
            clickableParent.setAttribute('data-account-click-target', 'true');

            return {
              found: true,
              method: isLoggedOut ? 'data-identifier-logged-out' : 'data-identifier-non-logged-out',
              isLoggedOut: isLoggedOut,
              x: finalRect.x + finalRect.width / 2,
              y: finalRect.y + finalRect.height / 2,
              width: finalRect.width,
              height: finalRect.height,
              originalUrl: window.location.href,
              elementTag: clickableParent.tagName,
              elementClass: clickableParent.className
            };
          } else {
            console.log(`⚠️ 계정은 있지만 로그아웃 상태 아님 (allowNonLoggedOut=false): ${targetEmail}`);
            console.log(`  부모 텍스트 확인: ${parentText}`);
          }
        }
      } else {
        console.log(`❌ data-identifier를 찾을 수 없음: ${targetEmail}`);
      }
      
      // 방법 2: 정밀한 선택자 기반 검색
      console.log('📌 방법 2: 정밀한 선택자 기반 검색 시작...');

      // "다른 계정 사용" 관련 텍스트들 (이 텍스트가 포함된 요소는 절대 클릭하면 안 됨)
      const forbiddenTexts = [
        '다른 계정 사용',
        'Use another account',
        'Add another account',
        '계정 추가',
        '別のアカウントを使用',
        '使用其他帳戶',
        'Usar otra cuenta',
        'Utiliser un autre compte'
      ];

      // Google 계정 선택 페이지의 계정 컨테이너 찾기
      // 일반적으로 li, [role="link"], [role="button"], 또는 특정 클래스를 가진 div
      const accountContainers = document.querySelectorAll('li, [role="link"], [role="button"], [jsaction*="JIbuQc"]');

      console.log(`📦 발견된 계정 컨테이너: ${accountContainers.length}개`);

      for (const container of accountContainers) {
        const containerText = container.textContent || '';
        const lowerText = containerText.toLowerCase();
        const lowerEmail = targetEmail.toLowerCase();

        // 이메일이 포함되어 있는지 확인
        if (!lowerText.includes(lowerEmail) && !lowerText.includes(lowerEmail.split('@')[0])) {
          continue;
        }

        console.log(`🔍 이메일 포함된 컨테이너 발견: ${containerText.substring(0, 100)}`);

        // "다른 계정 사용" 텍스트가 포함되어 있는지 확인
        const isForbidden = forbiddenTexts.some(forbiddenText => containerText.includes(forbiddenText));
        if (isForbidden) {
          console.log(`⚠️ "다른 계정 사용" 텍스트 포함 - 건너뜀`);
          continue;
        }

        // 로그아웃 상태 확인
        const hasLoggedOutText = loggedOutTexts.some(logoutText => containerText.includes(logoutText));

        // v2.0: 로그아웃 텍스트가 없어도 allowNonLoggedOut이면 계속 진행
        if (!hasLoggedOutText && !allowNonLoggedOutArg) {
          console.log(`⚠️ 로그아웃 텍스트 없음 (allowNonLoggedOut=false) - 건너뜀`);
          continue;
        }

        // 시각적으로 보이는지 확인
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          console.log(`⚠️ 요소가 보이지 않음 - 건너뜀`);
          continue;
        }

        // 유효한 계정 요소 찾음!
        const statusText = hasLoggedOutText ? '로그아웃된' : '로그인된 (v2.0 방어적 처리)';
        console.log(`✅ ${statusText} 계정 발견!`);
        console.log(`  이메일: ${targetEmail}`);
        console.log(`  요소: ${container.tagName}`);
        console.log(`  위치: (${rect.x}, ${rect.y})`);
        console.log(`  크기: ${rect.width}x${rect.height}`);

        // 디버깅을 위해 요소 강조
        container.style.border = '2px solid red';
        container.setAttribute('data-account-click-target', 'true');

        return {
          found: true,
          method: hasLoggedOutText ? 'precise-selector-search' : 'precise-selector-non-logged-out',
          isLoggedOut: hasLoggedOutText,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          width: rect.width,
          height: rect.height,
          originalUrl: window.location.href
        };
      }

      console.log('❌ 방법 2로도 계정을 찾지 못함');
      
      // 방법 3: 이메일이 포함된 요소 근처에서 로그아웃 텍스트 찾기 (또는 allowNonLoggedOut이면 직접 클릭)
      console.log('📌 방법 3: 이메일 요소 부모 탐색 시작...');
      const emailElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.textContent?.trim();
        return text && text.toLowerCase().includes(targetEmail.toLowerCase()) && el.offsetHeight > 0;
      });

      console.log(`📧 이메일 텍스트가 포함된 요소: ${emailElements.length}개`);

      for (const emailEl of emailElements) {
        // "다른 계정 사용" 텍스트가 있는지 먼저 확인
        const emailElText = emailEl.textContent || '';
        const forbiddenTexts = ['다른 계정 사용', 'Use another account', 'Add another account', '계정 추가'];
        if (forbiddenTexts.some(ft => emailElText.includes(ft))) {
          console.log('⚠️ "다른 계정 사용" 요소 건너뜀');
          continue;
        }

        // 부모 요소에서 로그아웃 텍스트 확인
        let parent = emailEl.parentElement;
        let depth = 0;

        while (parent && depth < 5) {
          const parentText = parent.textContent || '';
          const hasLoggedOutText = loggedOutTexts.some(text => parentText.includes(text));

          // v2.0: 로그아웃 텍스트가 있거나 allowNonLoggedOut이면 반환
          if (hasLoggedOutText || allowNonLoggedOutArg) {
            // "다른 계정 사용" 텍스트가 포함되어 있으면 건너뜀
            if (forbiddenTexts.some(ft => parentText.includes(ft))) {
              break; // 이 이메일 요소는 건너뛰고 다음으로
            }

            // 클릭 가능한 상위 요소 찾기
            const clickable = parent.closest('[role="button"]') ||
                            parent.closest('[role="link"]') ||
                            parent.closest('li') ||
                            parent;

            const rect = clickable.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const statusText = hasLoggedOutText ? '로그아웃된' : '로그인된 (v2.0 방어적 처리)';
              console.log(`✅ ${statusText} 계정 발견 (부모 탐색): ${targetEmail}`);

              clickable.setAttribute('data-account-click-target', 'true');

              return {
                found: true,
                method: hasLoggedOutText ? 'parent-search-logged-out' : 'parent-search-non-logged-out',
                isLoggedOut: hasLoggedOutText,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                width: rect.width,
                height: rect.height,
                originalUrl: window.location.href
              };
            }
          }

          parent = parent.parentElement;
          depth++;
        }
      }

      console.log(`❌ 계정을 찾을 수 없음 (allowNonLoggedOut=${allowNonLoggedOutArg}): ${targetEmail}`);
      return { found: false, isLoggedOut: false };
    }, email, allowNonLoggedOut);
  }

  /**
   * "다른 계정 사용" 버튼 찾기
   */
  async findUseAnotherAccountButton() {
    return await this.page.evaluate(() => {
      const texts = ['다른 계정 사용', 'Use another account', '계정 추가', 'Add another account'];

      for (const text of texts) {
        // 모든 요소를 검색
        const elements = Array.from(document.querySelectorAll('*')).filter(el => {
          const elText = el.textContent?.trim();
          // 정확한 텍스트 매칭 또는 포함 여부 확인
          return elText && (elText === text || elText.includes(text)) &&
                 el.offsetHeight > 0 && el.offsetWidth > 0;
        });

        for (const element of elements) {
          // 클릭 가능한 요소인지 확인
          const clickable = element.tagName === 'BUTTON' ||
                          element.tagName === 'A' ||
                          element.hasAttribute('role') ||
                          element.onclick ||
                          element.closest('button') ||
                          element.closest('a') ||
                          element.closest('[role="button"]');

          if (clickable) {
            const targetEl = element.closest('button') ||
                           element.closest('a') ||
                           element.closest('[role="button"]') ||
                           element;

            const rect = targetEl.getBoundingClientRect();

            // 선택자 생성 시도
            let selector = null;
            if (targetEl.id) {
              selector = `#${targetEl.id}`;
            } else if (targetEl.className) {
              selector = `.${targetEl.className.split(' ').join('.')}`;
            }

            return {
              found: true,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              selector: selector,
              text: text
            };
          }
        }
      }

      return { found: false };
    });
  }

  /**
   * 계정 클릭 (v2.0 - 로그아웃되지 않은 계정도 클릭 가능)
   *
   * @param {string} email - 클릭할 계정 이메일
   * @param {boolean} allowNonLoggedOut - true이면 로그아웃되지 않은 계정도 클릭 (기본: false)
   */
  async clickAccount(email, allowNonLoggedOut = false) {
    const startTime = Date.now();
    const maxRetries = 3;
    const originalUrl = this.page.url();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.logger.info(`계정 클릭 시도 ${attempt}/${maxRetries}`, { email, allowNonLoggedOut });
      
      // 스크린샷 저장 (디버깅용)
      if (this.screenshotEnabled && attempt === 1) {
        await this.saveScreenshot(`account_chooser_before_click_${Date.now()}.png`);
      }
      
      try {
        // 계정 요소 찾기 (v2.0: allowNonLoggedOut 파라미터 전달)
        const accountInfo = await this.findAccountElement(email, allowNonLoggedOut);

        if (!accountInfo.found) {
          this.logger.warn('계정을 찾을 수 없음', { email, attempt, allowNonLoggedOut });

          // 첫 번째 시도에서만 "다른 계정 사용" 버튼 클릭 시도
          if (attempt === 1) {
            this.logger.info('계정이 목록에 없음 - "다른 계정 사용" 버튼 클릭 시도');
            const anotherAccountBtn = await this.findUseAnotherAccountButton();

            if (anotherAccountBtn.found) {
              this.logger.info('✅ "다른 계정 사용" 버튼 발견 - 클릭');
              await this.page.click(anotherAccountBtn.selector ||
                                   `[data-identifier="${anotherAccountBtn.x},${anotherAccountBtn.y}"]`).catch(() => {
                // 선택자로 실패하면 좌표로 클릭
                return this.page.mouse.click(anotherAccountBtn.x, anotherAccountBtn.y);
              });

              // 페이지 전환 대기
              await new Promise(r => setTimeout(r, 3000));

              // 이메일 입력 페이지로 전환되었는지 확인
              const currentUrl = this.page.url();
              if (currentUrl.includes('identifier') || currentUrl !== originalUrl) {
                this.logger.info('✅ "다른 계정 사용" 클릭 후 페이지 전환됨');
                return {
                  success: false,  // false를 반환하여 상위에서 이메일 입력 처리하도록
                  error: 'ACCOUNT_NOT_FOUND',
                  redirected: true
                };
              }
            } else {
              this.logger.warn('"다른 계정 사용" 버튼도 찾을 수 없음');
            }
          }

          // 페이지 새로고침 시도
          if (attempt < maxRetries) {
            this.logger.info('페이지 새로고침 후 재시도');
            await this.page.reload({ waitUntil: 'networkidle0' });
            await new Promise(r => setTimeout(r, 2000));
          }

          continue;
        }
        
        // v2.0: 로그아웃 상태 확인 (allowNonLoggedOut이면 건너뜀)
        if (!accountInfo.isLoggedOut && !allowNonLoggedOut) {
          this.logger.warn('계정이 로그아웃 상태가 아님 (allowNonLoggedOut=false)', { email });
          continue;
        }

        // 로그아웃되지 않은 계정 클릭 시 로그
        if (!accountInfo.isLoggedOut && allowNonLoggedOut) {
          this.logger.info('ℹ️ 로그아웃되지 않은 계정을 클릭합니다 (v2.0 방어적 처리)', { email });
        }
        
        this.logger.info(`계정 요소 발견 (${accountInfo.method})`, {
          position: `(${Math.round(accountInfo.x)}, ${Math.round(accountInfo.y)})`,
          size: `${Math.round(accountInfo.width)}x${Math.round(accountInfo.height)}`,
          tag: accountInfo.elementTag,
          class: accountInfo.elementClass
        });

        // 여러 클릭 방법 시도
        let clicked = false;

        // 방법 1: Puppeteer 좌표 클릭 (더 안정적)
        if (attempt === 1) {
          this.logger.info('🖱️ 방법 1: Puppeteer 좌표 클릭');

          // 마우스를 천천히 이동 (조심스럽게 조준)
          await this.moveMouseNaturally(accountInfo.x, accountInfo.y, 'slow');

          // 호버링 (확인하는 동작)
          await this.randomDelay(500, 1000);

          // 약간의 떨림 후 클릭 (긴장)
          await this.mouseJitter(accountInfo.x, accountInfo.y, 3);

          await this.performHumanLikeClick(accountInfo.x, accountInfo.y, 1);

          // 페이지 변화 모니터링 (기다리면서 확인)
          const changeDetected = await this.monitorPageChanges(originalUrl, 4000, 500);

          if (changeDetected) {
            this.logger.info('✅ 좌표 클릭 성공!');
            return { success: true, navigated: true };
          }

          // 실패 시 좌절감 표현 (마우스 움직임)
          await this.expressfrustration(accountInfo.x, accountInfo.y);
        }

        // 방법 2: JavaScript 직접 클릭 (폴백)
        if (!clicked) {
          try {
            this.logger.info('🖱️ 방법 2: JavaScript 직접 클릭');
            await this.page.evaluate(() => {
              const target = document.querySelector('[data-account-click-target="true"]');
              if (target) {
                console.log('✅ 클릭 대상 요소 발견:', target.tagName, target.className);
                target.click();
                // 여러 이벤트 발생
                const events = ['mousedown', 'mouseup', 'click'];
                events.forEach(eventType => {
                  const event = new MouseEvent(eventType, {
                    view: window,
                    bubbles: true,
                    cancelable: true
                  });
                  target.dispatchEvent(event);
                });
              }
            });

            await this.randomDelay(2000, 3000);

            // 페이지 변화 확인
            const currentUrl = this.page.url();
            if (currentUrl !== originalUrl) {
              this.logger.info('✅ JavaScript 클릭 성공 - URL 변경됨');
              clicked = true;
              return { success: true, navigated: true };
            }
          } catch (e) {
            this.logger.warn(`JavaScript 클릭 실패: ${e.message}`);
          }
        }

        // 두 번째 시도: 더 적극적인 클릭
        if (attempt === 2) {
          this.logger.info('🖱️ 더 강하게 클릭 시도...');
          
          // 빠르게 이동 (조급함)
          await this.moveMouseNaturally(accountInfo.x, accountInfo.y, 'fast');
          
          // 여러 번 클릭 (확실하게)
          await this.performHumanLikeClick(accountInfo.x, accountInfo.y, 2 + Math.floor(Math.random() * 2));
          
          const changeDetected = await this.monitorPageChanges(originalUrl, 3000, 500);
          
          if (changeDetected) {
            this.logger.info('✅ 여러 번 클릭으로 성공!');
            return { success: true, navigated: true };
          }
          
          // 더 큰 좌절감
          await this.expressfrustration(accountInfo.x, accountInfo.y, 'medium');
        }

        // 세 번째 시도: 다양한 방법 시도
        if (attempt === 3) {
          this.logger.info('🖱️ 마지막 시도 - 다양한 클릭 패턴...');
          
          // 전략 1: 더블클릭
          if (clickStrategy < 0.3) {
            await this.moveMouseNaturally(accountInfo.x, accountInfo.y, 'normal');
            await this.page.mouse.click(accountInfo.x, accountInfo.y, { clickCount: 2 });
          }
          // 전략 2: 롱 클릭
          else if (clickStrategy < 0.6) {
            await this.page.mouse.move(accountInfo.x, accountInfo.y);
            await this.page.mouse.down();
            await this.randomDelay(500, 1000);
            await this.page.mouse.up();
          }
          // 전략 3: 여러 위치 클릭
          else {
            const positions = [
              { x: accountInfo.x - accountInfo.width * 0.2, y: accountInfo.y },
              { x: accountInfo.x, y: accountInfo.y },
              { x: accountInfo.x + accountInfo.width * 0.2, y: accountInfo.y }
            ];
            
            for (const pos of positions) {
              await this.performHumanLikeClick(pos.x, pos.y, 1);
              await this.randomDelay(200, 400);
            }
          }
          
          const changeDetected = await this.monitorPageChanges(originalUrl, 3000, 500);
          
          if (changeDetected) {
            this.logger.info('✅ 마지막 시도 성공!');
            return { success: true, navigated: true };
          }
        }
        
        this.logger.warn(`시도 ${attempt} 실패 - 페이지 변화 없음`);
        
      } catch (error) {
        this.logger.error(`계정 클릭 시도 ${attempt} 오류:`, error);
      }
      
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    const elapsed = Date.now() - startTime;
    this.logger.error('모든 계정 클릭 시도 실패', { email, elapsed });
    return { success: false };
  }

  /**
   * 휴먼라이크 클릭 수행 (향상된 버전)
   */
  async performHumanLikeClick(x, y, attempts = 1) {
    // 클릭 전 랜덤 대기 (사람이 생각하는 시간)
    await this.randomDelay(300, 800);
    
    for (let i = 0; i < attempts; i++) {
      // 각 시도마다 클릭 위치를 조금씩 다르게 (사람이 정확히 같은 곳을 클릭하지 않음)
      let offsetX, offsetY;
      
      if (i === 0) {
        // 첫 클릭은 중앙 근처
        offsetX = (Math.random() - 0.5) * 6;
        offsetY = (Math.random() - 0.5) * 6;
      } else {
        // 재시도 시 더 넓은 범위로 클릭 위치 조정
        offsetX = (Math.random() - 0.5) * 15;
        offsetY = (Math.random() - 0.5) * 15;
      }
      
      const clickX = x + offsetX;
      const clickY = y + offsetY;
      
      this.logger.debug(`클릭 시도 ${i + 1}/${attempts}: (${Math.round(clickX)}, ${Math.round(clickY)})`);
      
      if (i === 0) {
        // 첫 클릭은 부드러운 움직임으로
        const viewport = this.page.viewport() || { width: 1920, height: 1080 };
        const startX = viewport.width * Math.random();
        const startY = viewport.height * Math.random();
        
        // Bezier 곡선을 따라 마우스 이동
        const steps = this.calculateMouseSteps(startX, startY, clickX, clickY);
        
        for (const step of steps) {
          await this.page.mouse.move(step.x, step.y);
          await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
        }
      } else {
        // 이후 클릭은 현재 위치에서 작은 움직임만
        await this.page.mouse.move(clickX, clickY, { steps: 10 });
      }
      
      // 마우스 호버 (사람이 클릭 전 잠시 멈추는 동작)
      await this.randomDelay(100, 300);
      
      // 때때로 마우스를 약간 흔들기 (긴장하거나 조준하는 동작)
      if (Math.random() > 0.5 && i > 0) {
        await this.page.mouse.move(clickX + 2, clickY + 2);
        await this.randomDelay(50, 100);
        await this.page.mouse.move(clickX - 1, clickY - 1);
        await this.randomDelay(50, 100);
        await this.page.mouse.move(clickX, clickY);
      }
      
      // 클릭 전 짧은 대기 (사람이 클릭 결정하는 순간)
      await this.randomDelay(200, 400);
      
      // 마우스 다운 (클릭 압력 시뮬레이션)
      await this.page.mouse.down();
      
      // 클릭 홀드 시간 (사람마다 다른 클릭 속도)
      const holdTime = 30 + Math.random() * 100;
      await new Promise(r => setTimeout(r, holdTime));
      
      // 때때로 약간의 드래그 (실수로 마우스가 움직임)
      if (Math.random() > 0.8) {
        const dragX = clickX + (Math.random() - 0.5) * 3;
        const dragY = clickY + (Math.random() - 0.5) * 3;
        await this.page.mouse.move(dragX, dragY);
      }
      
      // 마우스 업
      await this.page.mouse.up();
      
      // 클릭 후 대기 (반응 확인 시간)
      await this.randomDelay(300, 700);
      
      // 클릭이 안 된 것 같으면 빠르게 재클릭 (더블클릭처럼)
      if (i < attempts - 1) {
        if (Math.random() > 0.6) {
          // 빠른 재클릭 (더블클릭)
          await this.randomDelay(50, 150);
          await this.page.mouse.down();
          await this.randomDelay(20, 60);
          await this.page.mouse.up();
          await this.randomDelay(500, 1000);
        } else {
          // 일반 재시도 대기
          await this.randomDelay(800, 1500);
        }
      }
    }
  }

  /**
   * 페이지 변화 모니터링
   */
  async monitorPageChanges(originalUrl, duration = 5000, interval = 1000) {
    this.logger.info(`${duration/1000}초 동안 페이지 변화 모니터링`);
    
    for (let elapsed = 0; elapsed <= duration; elapsed += interval) {
      const currentUrl = this.page.url();
      
      // 페이지 상태 확인
      const pageState = await this.page.evaluate(() => {
        return {
          hasPasswordField: !!document.querySelector('input[type="password"]'),
          hasEmailField: !!document.querySelector('input[type="email"]'),
          bodyLength: document.body.innerText.length,
          title: document.title
        };
      });
      
      // URL 변경 또는 비밀번호 필드 출현 확인
      if (currentUrl !== originalUrl || pageState.hasPasswordField) {
        this.logger.info(`✅ [${elapsed/1000}초] 페이지 변화 감지!`);
        this.logger.debug('페이지 상태:', pageState);
        
        // 변화 감지 시 스크린샷
        await this.saveScreenshot(`page_changed_${Date.now()}.png`);
        return true;
      }
      
      this.logger.debug(`[${elapsed/1000}초] 변화 없음`);
      
      // 모니터링 중 스크린샷 (1초마다)
      if (elapsed % 1000 === 0) {
        await this.saveScreenshot(`monitoring_${elapsed/1000}s_${Date.now()}.png`);
      }
      
      if (elapsed < duration) {
        await new Promise(r => setTimeout(r, interval));
      }
    }
    
    return false;
  }

  /**
   * 자연스러운 마우스 이동 (속도 옵션 포함)
   */
  async moveMouseNaturally(x, y, speed = 'normal') {
    const currentPosition = await this.page.evaluate(() => ({
      x: window.mouseX || 0,
      y: window.mouseY || 0
    }));
    
    const distance = Math.sqrt(
      Math.pow(x - currentPosition.x, 2) + 
      Math.pow(y - currentPosition.y, 2)
    );
    
    // 속도에 따른 단계 수 결정
    let steps;
    switch(speed) {
      case 'slow':
        steps = Math.max(20, Math.floor(distance / 10));
        break;
      case 'fast':
        steps = Math.max(5, Math.floor(distance / 50));
        break;
      default: // 'normal'
        steps = Math.max(10, Math.floor(distance / 25));
    }
    
    // Bezier 곡선 경로 생성
    const path = this.calculateMouseSteps(currentPosition.x, currentPosition.y, x, y);
    
    // 경로를 따라 이동
    for (let i = 0; i < path.length; i++) {
      await this.page.mouse.move(path[i].x, path[i].y);
      
      // 속도 변화 (더 인간적인 움직임)
      const baseDelay = speed === 'slow' ? 20 : speed === 'fast' ? 5 : 10;
      const variableDelay = baseDelay + Math.random() * baseDelay;
      await new Promise(r => setTimeout(r, variableDelay));
    }
  }

  /**
   * 좌절감 표현 (클릭 실패 시 마우스 움직임)
   */
  async expressfrustration(x, y, intensity = 'low') {
    // 마우스를 빠르게 움직이거나 흔들기
    switch(intensity) {
      case 'high':
        // 큰 원 그리기 (화남)
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
          const circleX = x + Math.cos(angle) * 50;
          const circleY = y + Math.sin(angle) * 50;
          await this.page.mouse.move(circleX, circleY);
          await this.randomDelay(50, 100);
        }
        break;
      case 'medium':
        // 좌우로 빠르게 움직이기
        await this.page.mouse.move(x - 30, y);
        await this.randomDelay(100, 200);
        await this.page.mouse.move(x + 30, y);
        await this.randomDelay(100, 200);
        await this.page.mouse.move(x, y);
        break;
      default: // 'low'
        // 작은 흔들림
        await this.mouseJitter(x, y, 5);
    }
    
    // 잠시 멈춤 (다시 시도하기 전 생각)
    await this.randomDelay(500, 1000);
  }

  /**
   * 랜덤 지연 시간 (사람의 반응 속도 시뮬레이션)
   */
  async randomDelay(min, max) {
    const delay = min + Math.random() * (max - min);
    await new Promise(r => setTimeout(r, delay));
  }

  /**
   * 타이핑 속도 시뮬레이션 (휴먼라이크 타이핑)
   */
  async humanType(text, inputElement = null) {
    for (const char of text) {
      if (inputElement) {
        await inputElement.type(char);
      } else {
        await this.page.keyboard.type(char);
      }
      
      // 타이핑 속도 변화 (사람마다, 글자마다 다름)
      const baseDelay = 50 + Math.random() * 100;
      
      // 때때로 더 긴 멈춤 (생각하거나 실수 수정)
      if (Math.random() > 0.9) {
        await this.randomDelay(baseDelay * 2, baseDelay * 4);
      } else {
        await this.randomDelay(baseDelay * 0.8, baseDelay * 1.2);
      }
    }
  }

  /**
   * 마우스 떨림 효과 (긴장하거나 정밀한 클릭 시도)
   */
  async mouseJitter(x, y, intensity = 2) {
    const jitterCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < jitterCount; i++) {
      const jitterX = x + (Math.random() - 0.5) * intensity;
      const jitterY = y + (Math.random() - 0.5) * intensity;
      await this.page.mouse.move(jitterX, jitterY);
      await this.randomDelay(20, 50);
    }
    await this.page.mouse.move(x, y);
  }

  /**
   * Bezier 곡선 마우스 경로 계산
   */
  calculateMouseSteps(startX, startY, endX, endY) {
    const steps = [];
    const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const numSteps = Math.min(Math.max(5, Math.floor(distance / 50)), 20);
    
    // 제어점 (약간의 곡선)
    const controlX = startX + (endX - startX) * 0.5 + (Math.random() - 0.5) * 50;
    const controlY = startY + (endY - startY) * 0.5 + (Math.random() - 0.5) * 50;
    
    for (let i = 0; i <= numSteps; i++) {
      const t = i / numSteps;
      
      // 2차 Bezier 곡선 공식
      const x = Math.pow(1 - t, 2) * startX + 
                2 * (1 - t) * t * controlX + 
                Math.pow(t, 2) * endX;
      const y = Math.pow(1 - t, 2) * startY + 
                2 * (1 - t) * t * controlY + 
                Math.pow(t, 2) * endY;
      
      steps.push({ x, y });
    }
    
    return steps;
  }

  /**
   * 스크린샷 저장
   */
  async saveScreenshot(filename) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(process.cwd(), 'screenshots');
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      await this.page.screenshot({
        path: path.join(dir, filename),
        fullPage: false
      });
      
      this.logger.debug(`스크린샷 저장: ${filename}`);
    } catch (error) {
      this.logger.debug(`스크린샷 저장 실패: ${error.message}`);
    }
  }
}

module.exports = ImprovedAccountChooserHandler;