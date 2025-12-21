/**
 * 범용 상태 감지 서비스
 * 언어와 무관하게 YouTube Premium 멤버십 상태를 정확히 판별
 *
 * 핵심 로직:
 * 1. Manage membership 버튼 클릭 후 확장된 UI 확인
 * 2. 날짜 패턴과 버튼 조합으로 상태 판별
 * 3. 언어별 텍스트가 아닌 UI 구조로 판단
 */

const chalk = require('chalk');

class UniversalStatusDetector {
  constructor(logger = console) {
    this.logger = logger;
    this.debugMode = process.env.DEBUG_MODE === 'true';
  }

  /**
   * 멤버십 관리 버튼 클릭 및 상태 확인
   */
  async detectMembershipStatus(page) {
    console.log(chalk.cyan('\n🔍 범용 멤버십 상태 감지 시작\n'));

    try {
      // 1단계: Manage membership 버튼 찾기 및 클릭
      const manageClicked = await this.clickManageButton(page);

      // 클릭 여부와 상관없이 잠시 대기 (DOM 안정화)
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1500)));

      // 2단계: 현재 상태 확인 (확장된 상태든 아니든)
      const status = await this.analyzeExpandedUI(page);

      // 3단계: 결과 로깅
      this.logStatusResult(status);

      return status;

    } catch (error) {
      console.error(chalk.red(`상태 감지 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * Manage membership 버튼 클릭
   */
  async clickManageButton(page) {
    console.log(chalk.gray('  1️⃣ Manage membership 버튼 확인...'));

    // 먼저 이미 확장된 상태인지 확인
    const isAlreadyExpanded = await page.evaluate(() => {
      // Resume, Pause, Cancel 버튼이 이미 보이는지 확인
      const actionButtons = document.querySelectorAll('button, [role="button"], tp-yt-paper-button');
      for (const btn of actionButtons) {
        const text = btn.textContent?.trim()?.toLowerCase() || '';
        const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

        // 이미 액션 버튼이 보이면 확장된 상태
        if (text.includes('resume') || text.includes('pause') || text.includes('cancel') ||
            text.includes('재개') || text.includes('일시정지') || text.includes('취소') ||
            ariaLabel.includes('resume') || ariaLabel.includes('pause') || ariaLabel.includes('cancel')) {
          return true;
        }
      }

      // 날짜 정보가 보이는지도 확인
      const datePatterns = ['pauses on', 'resumes on', 'membership resumes', '일시정지 날짜', '재개 날짜'];
      const pageText = document.body.innerText.toLowerCase();
      for (const pattern of datePatterns) {
        if (pageText.includes(pattern.toLowerCase())) {
          return true;
        }
      }

      return false;
    });

    if (isAlreadyExpanded) {
      console.log(chalk.green('  ✅ 이미 확장된 상태 (액션 버튼 또는 날짜 정보 표시됨)'));
      return false; // 클릭하지 않음
    }

    const clicked = await page.evaluate(() => {
      // 모든 버튼과 클릭 가능한 요소 찾기
      const elements = document.querySelectorAll('button, [role="button"], tp-yt-paper-button, yt-formatted-string');

      for (const elem of elements) {
        const text = elem.textContent?.trim() || '';
        const ariaLabel = elem.getAttribute('aria-label') || '';

        // 다양한 언어의 "Manage membership" 텍스트 패턴
        const managePatterns = [
          'Manage membership',        // 영어
          '멤버십 관리',                // 한국어
          'Administrar membresía',    // 스페인어
          'Gérer l\'abonnement',      // 프랑스어
          'Управление подпиской',     // 러시아어
          'Gerenciar assinatura',     // 포르투갈어
          'Mitgliedschaft verwalten', // 독일어
          '管理会员资格',              // 중국어
          'メンバーシップを管理',        // 일본어
        ];

        // 패턴 매칭 또는 아이콘 기반 감지
        const isManageButton = managePatterns.some(pattern =>
          text.includes(pattern) || ariaLabel.includes(pattern)
        );

        // 또는 Chevron 아이콘으로 판별 (확장 가능한 섹션)
        const hasChevron = elem.querySelector('svg path[d*="M7.41"]') ||
                          elem.querySelector('[class*="chevron"]') ||
                          elem.querySelector('[class*="expand"]');

        if (isManageButton || (hasChevron && text.includes('PKR'))) {
          console.log(`Found manage button: "${text}"`);
          elem.click();
          return true;
        }
      }

      // "Pause" 또는 "Resume" 버튼이 이미 보이면 클릭 불필요
      const pauseButton = Array.from(document.querySelectorAll('button')).find(btn =>
        btn.textContent?.trim() === 'Pause' || btn.textContent?.trim() === 'Pausar'
      );
      const resumeButton = Array.from(document.querySelectorAll('button')).find(btn =>
        btn.textContent?.trim() === 'Resume' || btn.textContent?.trim() === 'Retomar'
      );

      if (pauseButton || resumeButton) {
        console.log('UI already expanded (Pause/Resume button visible)');
        return false; // 이미 확장됨
      }

      return false;
    });

    if (clicked) {
      console.log(chalk.green('  ✅ Manage membership 버튼 클릭됨'));
      // Puppeteer에서 지원하는 올바른 대기 메서드 사용
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
    }

    return clicked;
  }

  /**
   * 확장된 UI 분석 (언어 무관)
   */
  async analyzeExpandedUI(page) {
    console.log(chalk.gray('  2️⃣ 확장된 UI 분석 중...'));

    const status = await page.evaluate(() => {
      const result = {
        isActive: false,
        isPaused: false,
        hasPauseButton: false,
        hasResumeButton: false,
        nextBillingDate: null,
        pauseDate: null,
        resumeDate: null,
        detectedIndicators: [],
        rawTexts: [],
        language: 'unknown'
      };

      // 전체 텍스트 수집
      const bodyText = document.body?.innerText || '';
      result.rawTexts.push(bodyText.substring(0, 1000));

      // 모든 버튼 수집
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], tp-yt-paper-button'));
      const visibleButtons = buttons.filter(btn => {
        const rect = btn.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0;
      });

      // 버튼 텍스트 수집
      const buttonTexts = visibleButtons.map(btn => btn.textContent?.trim()).filter(t => t);

      // ===========================================
      // 핵심 판별 로직: 날짜 패턴과 버튼 조합
      // ===========================================

      // 패턴 1: "pauses on" + "resumes on" = 일시중지 상태
      const pausesOnPattern = /pauses on:|pausará el|приостановлена|pausada em|일시중지 예정/i;
      const resumesOnPattern = /resumes on:|reanudará el|возобновлена|retomada em|재개 예정/i;

      if (pausesOnPattern.test(bodyText) && resumesOnPattern.test(bodyText)) {
        result.isPaused = true;
        result.detectedIndicators.push('Pause + Resume 날짜 패턴 감지');
      }

      // 패턴 2: "Next billing date" = 활성 상태
      const nextBillingPattern = /Next billing date|Próxima fecha de facturación|Следующая дата оплаты|Próxima data de faturação|다음 결제일/i;

      if (nextBillingPattern.test(bodyText) && !pausesOnPattern.test(bodyText)) {
        result.isActive = true;
        result.detectedIndicators.push('Next billing date 패턴 감지');
      }

      // ===========================================
      // 버튼 기반 판별 (가장 정확)
      // ===========================================

      // Pause 버튼 찾기 (모든 언어)
      const pauseButtonPatterns = [
        'Pause', 'Pausar', 'Приостановить', '일시중지', '暂停',
        'Mettre en pause', 'Pausieren', 'Pausa', '一時停止'
      ];

      const hasPauseButton = buttonTexts.some(text =>
        pauseButtonPatterns.some(pattern => text.includes(pattern))
      );

      if (hasPauseButton) {
        result.hasPauseButton = true;
        result.isActive = true;
        result.isPaused = false;
        result.detectedIndicators.push('Pause 버튼 발견 → 활성 상태');
      }

      // Resume 버튼 찾기 (모든 언어)
      const resumeButtonPatterns = [
        'Resume', 'Reanudar', 'Возобновить', '재개', '恢复',
        'Reprendre', 'Fortsetzen', 'Riprendi', 'Retomar', '再開'
      ];

      const hasResumeButton = buttonTexts.some(text =>
        resumeButtonPatterns.some(pattern => text.includes(pattern))
      );

      if (hasResumeButton) {
        result.hasResumeButton = true;
        result.isPaused = true;
        result.isActive = false;
        result.detectedIndicators.push('Resume 버튼 발견 → 일시중지 상태');
      }

      // ===========================================
      // 날짜 추출 (선택적)
      // ===========================================

      // 다양한 날짜 형식 추출
      const datePatterns = [
        /(\w+\s+\d{1,2}(?:,?\s+\d{4})?)/g,  // Oct 7, 2025
        /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/g, // 10/7/2025
        /(\d{4}-\d{2}-\d{2})/g,              // 2025-10-07
        /(\d{1,2}\s+\w+(?:\s+\d{4})?)/g      // 7 октября 2025
      ];

      datePatterns.forEach(pattern => {
        const matches = bodyText.match(pattern);
        if (matches && matches.length > 0) {
          if (result.isPaused) {
            result.pauseDate = matches[0];
            if (matches[1]) result.resumeDate = matches[1];
          } else if (result.isActive) {
            result.nextBillingDate = matches[0];
          }
        }
      });

      // ===========================================
      // 언어 감지 (선택적)
      // ===========================================

      if (bodyText.includes('Membership')) result.language = 'en';
      else if (bodyText.includes('멤버십')) result.language = 'ko';
      else if (bodyText.includes('Подписка')) result.language = 'ru';
      else if (bodyText.includes('Assinatura')) result.language = 'pt';
      else if (bodyText.includes('Membresía')) result.language = 'es';
      else if (bodyText.includes('会员')) result.language = 'zh';
      else if (bodyText.includes('メンバーシップ')) result.language = 'ja';

      // ===========================================
      // 최종 검증
      // ===========================================

      // 상태가 모호한 경우 버튼 우선
      if (!result.isActive && !result.isPaused) {
        if (result.hasPauseButton) {
          result.isActive = true;
          result.detectedIndicators.push('버튼 기반 최종 판정: 활성');
        } else if (result.hasResumeButton) {
          result.isPaused = true;
          result.detectedIndicators.push('버튼 기반 최종 판정: 일시중지');
        }
      }

      return result;
    });

    return status;
  }

  /**
   * 상태 결과 로깅
   */
  logStatusResult(status) {
    console.log(chalk.cyan('\n📊 상태 분석 결과:'));

    if (status.isActive) {
      console.log(chalk.green('  ✅ 상태: 활성 (결제중)'));
      console.log(chalk.gray(`  📅 다음 결제일: ${status.nextBillingDate || '확인 불가'}`));
    } else if (status.isPaused) {
      console.log(chalk.yellow('  ⏸️ 상태: 일시중지'));
      console.log(chalk.gray(`  📅 일시중지일: ${status.pauseDate || '확인 불가'}`));
      console.log(chalk.gray(`  📅 재개 예정일: ${status.resumeDate || '확인 불가'}`));
    } else {
      console.log(chalk.red('  ❓ 상태: 불명확'));
    }

    console.log(chalk.gray(`  🔍 감지 지표: ${status.detectedIndicators.join(', ')}`));
    console.log(chalk.gray(`  🌐 언어: ${status.language}`));
    console.log(chalk.gray(`  🔘 Pause 버튼: ${status.hasPauseButton ? '있음' : '없음'}`));
    console.log(chalk.gray(`  🔘 Resume 버튼: ${status.hasResumeButton ? '있음' : '없음'}`));

    if (this.debugMode) {
      console.log(chalk.gray(`  📝 Raw text (first 200 chars): ${status.rawTexts[0]?.substring(0, 200)}`));
    }
  }

  /**
   * 간단한 상태 확인 (버튼만으로 판별)
   */
  async quickStatusCheck(page) {
    return await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const buttonTexts = buttons.map(b => b.textContent?.trim()).filter(t => t);

      const hasPause = buttonTexts.some(text =>
        ['Pause', 'Pausar', 'Приостановить', '일시중지'].some(p => text.includes(p))
      );

      const hasResume = buttonTexts.some(text =>
        ['Resume', 'Reanudar', 'Возобновить', '재개', 'Retomar'].some(r => text.includes(r))
      );

      if (hasPause) return { status: 'active', button: 'pause' };
      if (hasResume) return { status: 'paused', button: 'resume' };
      return { status: 'unknown', button: 'none' };
    });
  }
}

module.exports = UniversalStatusDetector;