/**
 * 구독재개 검토 로그 관리자
 * SUBSCRIPTION_RESUME_REVIEW_LOG.md 파일을 프로그래밍 방식으로 업데이트
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class ReviewLogManager {
  constructor() {
    this.logFilePath = path.join(__dirname, '..', '..', 'SUBSCRIPTION_RESUME_REVIEW_LOG.md');
    this.currentDate = new Date().toISOString().split('T')[0];
    this.currentTime = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  }

  /**
   * 로그 파일 읽기
   */
  async readLogFile() {
    try {
      return await fs.readFile(this.logFilePath, 'utf8');
    } catch (error) {
      console.error(chalk.red('로그 파일 읽기 실패:'), error.message);
      return null;
    }
  }

  /**
   * 로그 파일 쓰기
   */
  async writeLogFile(content) {
    try {
      await fs.writeFile(this.logFilePath, content, 'utf8');
      console.log(chalk.green('✅ 검토 로그 업데이트 완료'));
      return true;
    } catch (error) {
      console.error(chalk.red('로그 파일 쓰기 실패:'), error.message);
      return false;
    }
  }

  /**
   * 최종 업데이트 날짜 갱신
   */
  async updateLastModified() {
    const content = await this.readLogFile();
    if (!content) return false;

    const updatedContent = content.replace(
      /(\*\*최종 업데이트\*\*: )\d{4}-\d{2}-\d{2}/,
      `$1${this.currentDate}`
    );

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 단계별 검토 결과 업데이트
   */
  async updateStepResult(stepNumber, stepName, result) {
    const content = await this.readLogFile();
    if (!content) return false;

    const timestamp = `${this.currentDate} ${this.currentTime}`;
    const status = result.success ? '✅' : '❌';
    
    // 해당 단계 섹션 찾기
    const stepPattern = new RegExp(`(### 2\\.${stepNumber} ${stepNumber}단계: [^#]+)(\\*\\*검토일시\\*\\*: )([^\\n]+)`, 's');
    
    let updatedContent = content.replace(stepPattern, (match, stepSection, timeLabel, oldTime) => {
      return stepSection + timeLabel + timestamp;
    });

    // 성공 결과 추가
    if (result.success && result.data) {
      const dataSection = `\n#### 성공 결과\n\`\`\`javascript\n${JSON.stringify(result.data, null, 2)}\n\`\`\`\n`;
      
      // 기존 성공 결과 섹션 교체 또는 추가
      const successPattern = new RegExp(`(### 2\\.${stepNumber}[^#]+?)(#### 성공 결과[^#]+?)?(#### [^#]|### |---)`, 's');
      updatedContent = updatedContent.replace(successPattern, (match, beforeSection, oldData, afterSection) => {
        return beforeSection + dataSection + afterSection;
      });
    }

    // 체크리스트 업데이트
    const checklistPattern = new RegExp(`(- \\[[ x]\\] \\*\\*${stepNumber}단계 검토)[^*]+`, 'g');
    updatedContent = updatedContent.replace(checklistPattern, `$1 완료** (${this.currentDate})`);

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 발견된 문제점 추가
   */
  async addDiscoveredIssue(issueTitle, description, solution = null) {
    const content = await this.readLogFile();
    if (!content) return false;

    const issueSection = `\n### 3.X ${issueTitle}\n\n**발견일시**: ${this.currentDate} ${this.currentTime}\n\n**문제 설명**: ${description}\n`;
    
    let solutionSection = '';
    if (solution) {
      solutionSection = `\n**해결책**:\n\`\`\`javascript\n${solution}\n\`\`\`\n`;
    }

    // "## 3. 발견된 문제점" 섹션 뒤에 추가
    const problemsPattern = /(## 3\. 발견된 문제점[^#]+)(## 4\. 해결된 개선사항)/s;
    const updatedContent = content.replace(problemsPattern, `$1${issueSection}${solutionSection}\n$2`);

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 해결된 개선사항 추가
   */
  async addImprovement(improvementTitle, description, codeExample = null) {
    const content = await this.readLogFile();
    if (!content) return false;

    const improvementSection = `\n### 4.X ${improvementTitle}\n\n**개선일시**: ${this.currentDate} ${this.currentTime}\n\n${description}\n`;
    
    let codeSection = '';
    if (codeExample) {
      codeSection = `\n\`\`\`javascript\n${codeExample}\n\`\`\`\n`;
    }

    // "## 4. 해결된 개선사항" 섹션 뒤에 추가
    const improvementsPattern = /(## 4\. 해결된 개선사항[^#]+)(## 5\. 향후 적용 방안)/s;
    const updatedContent = content.replace(improvementsPattern, `$1${improvementSection}${codeSection}\n$2`);

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 업데이트 이력 추가
   */
  async addUpdateHistory(content, author = 'Claude') {
    const logContent = await this.readLogFile();
    if (!logContent) return false;

    const newEntry = `| ${this.currentDate} | ${content} | ${author} |`;
    
    // 업데이트 이력 테이블에 추가 (마지막 줄 앞에 삽입)
    const historyPattern = /(\| 날짜 \| 내용 \| 담당자 \|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|)/s;
    const updatedContent = logContent.replace(historyPattern, `$1\n${newEntry}`);

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 진행 상황 체크리스트 업데이트
   */
  async updateProgressChecklist(stepNumber, isCompleted = true, details = null) {
    const content = await this.readLogFile();
    if (!content) return false;

    const checkMark = isCompleted ? 'x' : ' ';
    const timestamp = isCompleted ? ` (${this.currentDate})` : '';
    const additionalInfo = details ? `\n  - ${details}` : '';

    // 해당 단계의 체크리스트 찾기 및 업데이트
    const checklistPattern = new RegExp(`(- \\[[ x]\\] \\*\\*${stepNumber}단계 검토[^\\n]*)(\\n|$)`, 'g');
    const updatedContent = content.replace(checklistPattern, `- [${checkMark}] **${stepNumber}단계 검토 완료**${timestamp}${additionalInfo}$2`);

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 성능 데이터 업데이트
   */
  async updatePerformanceData(stepNumber, performanceData) {
    const content = await this.readLogFile();
    if (!content) return false;

    const perfSection = `\n#### 성능 분석\n${Object.entries(performanceData).map(([key, value]) => `- **${key}**: ${value}`).join('\n')}\n`;

    // 해당 단계 섹션에 성능 데이터 추가
    const stepPattern = new RegExp(`(### 2\\.${stepNumber}[^#]+?)(#### 구현된 기능|#### 해결된 문제|### 2\\.|---)`, 's');
    const updatedContent = content.replace(stepPattern, (match, stepSection, nextSection) => {
      return stepSection + perfSection + nextSection;
    });

    return await this.writeLogFile(updatedContent);
  }

  /**
   * 통합 업데이트 - 단계 완료 시 한번에 업데이트
   */
  async updateStepCompletion(stepNumber, stepName, data) {
    console.log(chalk.blue(`📝 ${stepNumber}단계 검토 로그 업데이트 중...`));

    const updates = [
      this.updateLastModified(),
      this.updateStepResult(stepNumber, stepName, data),
      this.updateProgressChecklist(stepNumber, true, data.details),
      this.addUpdateHistory(`${stepNumber}단계 검토 완료: ${stepName}`)
    ];

    if (data.performance) {
      updates.push(this.updatePerformanceData(stepNumber, data.performance));
    }

    const results = await Promise.all(updates);
    const success = results.every(result => result);

    if (success) {
      console.log(chalk.green(`✅ ${stepNumber}단계 로그 업데이트 완료`));
    } else {
      console.log(chalk.red(`❌ ${stepNumber}단계 로그 업데이트 일부 실패`));
    }

    return success;
  }

  /**
   * 로그 파일 백업
   */
  async backupLogFile() {
    try {
      const content = await this.readLogFile();
      if (!content) return false;

      const backupPath = this.logFilePath.replace('.md', `_backup_${this.currentDate}.md`);
      await fs.writeFile(backupPath, content, 'utf8');
      
      console.log(chalk.green(`✅ 로그 파일 백업 완료: ${backupPath}`));
      return true;
    } catch (error) {
      console.error(chalk.red('로그 파일 백업 실패:'), error.message);
      return false;
    }
  }

  /**
   * 로그 파일 검증
   */
  async validateLogFile() {
    const content = await this.readLogFile();
    if (!content) return false;

    const validations = [
      { check: content.includes('## 1. 현재 시스템 분석'), message: '시스템 분석 섹션 존재' },
      { check: content.includes('## 2. 단계별 검토 결과'), message: '검토 결과 섹션 존재' },
      { check: content.includes('## 7. 검토 진행 상황'), message: '진행 상황 섹션 존재' },
      { check: content.includes('📝 업데이트 이력'), message: '업데이트 이력 존재' }
    ];

    const isValid = validations.every(v => v.check);
    
    console.log(chalk.cyan('📋 로그 파일 검증 결과:'));
    validations.forEach(v => {
      const status = v.check ? chalk.green('✅') : chalk.red('❌');
      console.log(`  ${status} ${v.message}`);
    });

    return isValid;
  }
}

module.exports = ReviewLogManager;