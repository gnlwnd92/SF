/**
 * SessionLogger - 세션별 상세 로그 관리 서비스
 * 작업 시작부터 종료까지 모든 활동을 기록하고 파일로 저장
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class SessionLogger {
  constructor() {
    this.sessionId = this.generateSessionId();
    this.startTime = new Date();
    this.logs = [];
    this.statistics = {
      totalProfiles: 0,
      successCount: 0,
      failureCount: 0,
      skipCount: 0,
      errors: [],
      processedProfiles: []
    };
    this.logDir = path.join(process.cwd(), 'logs', 'sessions');
    this.currentProfile = null;
    this.isTerminating = false;
  }

  /**
   * 세션 ID 생성 (날짜-시간 기반)
   */
  generateSessionId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `session_${dateStr}_${timeStr}`;
  }

  /**
   * 로그 디렉토리 초기화
   */
  async initialize() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      this.log('info', 'SessionLogger 초기화 완료', { sessionId: this.sessionId });
      console.log(chalk.cyan(`📝 세션 로그 시작: ${this.sessionId}`));
      return true;
    } catch (error) {
      console.error(chalk.red('로그 디렉토리 생성 실패:'), error);
      return false;
    }
  }

  /**
   * 로그 기록
   */
  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      profile: this.currentProfile,
      data
    };
    
    this.logs.push(logEntry);
    
    // 콘솔에도 출력 (레벨별 색상)
    const colors = {
      info: 'cyan',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      debug: 'gray'
    };
    
    const color = colors[level] || 'white';
    const prefix = this.currentProfile ? `[${this.currentProfile}]` : '';
    console.log(chalk[color](`[${timestamp.slice(11, 19)}] ${prefix} ${message}`));
    
    // 실시간 파일 기록 (비동기)
    this.appendToFile(logEntry).catch(err => {
      console.error('로그 파일 기록 실패:', err);
    });
  }

  /**
   * 프로필 작업 시작
   */
  startProfile(profileId, email) {
    this.currentProfile = profileId;
    this.log('info', `프로필 작업 시작: ${email || profileId}`, {
      profileId,
      email,
      startTime: new Date().toISOString()
    });
    this.statistics.totalProfiles++;
  }

  /**
   * 프로필 작업 완료
   */
  endProfile(profileId, result) {
    const profile = {
      profileId,
      email: result.email,
      status: result.success ? 'success' : 'failure',
      error: result.error,
      duration: result.duration,
      details: result
    };
    
    this.statistics.processedProfiles.push(profile);
    
    if (result.success) {
      this.statistics.successCount++;
      this.log('success', `프로필 작업 성공: ${result.status || '완료'}`, profile);
    } else if (result.error) {
      this.statistics.failureCount++;
      this.statistics.errors.push({
        profileId,
        error: result.error,
        timestamp: new Date().toISOString()
      });
      this.log('error', `프로필 작업 실패: ${result.error}`, profile);
    } else {
      this.statistics.skipCount++;
      this.log('warning', `프로필 작업 건너뜀: ${result.reason || '알 수 없음'}`, profile);
    }
    
    this.currentProfile = null;
  }

  /**
   * 실시간 로그 파일 추가
   */
  async appendToFile(logEntry) {
    const filename = `${this.sessionId}.log`;
    const filepath = path.join(this.logDir, filename);
    const line = JSON.stringify(logEntry) + '\n';
    
    try {
      await fs.appendFile(filepath, line, 'utf8');
    } catch (error) {
      // 파일 기록 실패는 조용히 처리
    }
  }

  /**
   * 세션 종료 및 최종 보고서 생성
   */
  async finalize(reason = 'normal') {
    if (this.isTerminating) return;
    this.isTerminating = true;
    
    console.log(chalk.yellow('\n📊 세션 종료 중...'));
    
    const endTime = new Date();
    const duration = Math.round((endTime - this.startTime) / 1000);
    
    // 최종 통계
    const summary = {
      sessionId: this.sessionId,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: `${Math.floor(duration / 60)}분 ${duration % 60}초`,
      terminationReason: reason,
      statistics: this.statistics,
      logs: this.logs
    };
    
    // 요약 보고서 생성 (읽기 쉬운 형식)
    const report = this.generateReport(summary);
    
    // JSON 형식 전체 로그 저장
    const jsonFilename = `${this.sessionId}_full.json`;
    const jsonFilepath = path.join(this.logDir, jsonFilename);
    
    // 텍스트 형식 요약 보고서 저장
    const reportFilename = `${this.sessionId}_report.txt`;
    const reportFilepath = path.join(this.logDir, reportFilename);
    
    try {
      // JSON 로그 저장
      await fs.writeFile(jsonFilepath, JSON.stringify(summary, null, 2), 'utf8');
      console.log(chalk.green(`✅ 전체 로그 저장: ${jsonFilename}`));
      
      // 텍스트 보고서 저장
      await fs.writeFile(reportFilepath, report, 'utf8');
      console.log(chalk.green(`✅ 요약 보고서 저장: ${reportFilename}`));
      
      // 콘솔에 요약 출력
      console.log(chalk.cyan('\n' + '='.repeat(80)));
      console.log(chalk.cyan.bold('📋 세션 요약 보고서'));
      console.log(chalk.cyan('='.repeat(80)));
      console.log(report);
      
      return { jsonFilepath, reportFilepath };
    } catch (error) {
      console.error(chalk.red('로그 파일 저장 실패:'), error);
      return null;
    }
  }

  /**
   * 읽기 쉬운 보고서 생성
   */
  generateReport(summary) {
    const lines = [];
    
    lines.push('YouTube Premium 자동화 세션 보고서');
    lines.push('=' .repeat(60));
    lines.push('');
    lines.push(`세션 ID: ${summary.sessionId}`);
    lines.push(`시작 시간: ${new Date(summary.startTime).toLocaleString('ko-KR')}`);
    lines.push(`종료 시간: ${new Date(summary.endTime).toLocaleString('ko-KR')}`);
    lines.push(`총 소요 시간: ${summary.duration}`);
    lines.push(`종료 사유: ${summary.terminationReason}`);
    lines.push('');
    lines.push('📊 작업 통계');
    lines.push('-'.repeat(60));
    lines.push(`총 프로필 수: ${summary.statistics.totalProfiles}`);
    lines.push(`성공: ${summary.statistics.successCount} (${this.getPercentage(summary.statistics.successCount, summary.statistics.totalProfiles)}%)`);
    lines.push(`실패: ${summary.statistics.failureCount} (${this.getPercentage(summary.statistics.failureCount, summary.statistics.totalProfiles)}%)`);
    lines.push(`건너뜀: ${summary.statistics.skipCount} (${this.getPercentage(summary.statistics.skipCount, summary.statistics.totalProfiles)}%)`);
    lines.push('');
    
    if (summary.statistics.processedProfiles.length > 0) {
      lines.push('📝 처리된 프로필 상세');
      lines.push('-'.repeat(60));
      
      summary.statistics.processedProfiles.forEach((profile, index) => {
        lines.push(`${index + 1}. ${profile.email || profile.profileId}`);
        lines.push(`   상태: ${profile.status}`);
        if (profile.duration) {
          lines.push(`   소요 시간: ${profile.duration}초`);
        }
        if (profile.error) {
          lines.push(`   오류: ${profile.error}`);
        }
        if (profile.details?.nextBillingDate) {
          lines.push(`   다음 결제일: ${profile.details.nextBillingDate}`);
        }
        lines.push('');
      });
    }
    
    if (summary.statistics.errors.length > 0) {
      lines.push('❌ 오류 목록');
      lines.push('-'.repeat(60));
      
      summary.statistics.errors.forEach((error, index) => {
        lines.push(`${index + 1}. [${new Date(error.timestamp).toLocaleTimeString('ko-KR')}] ${error.profileId}`);
        lines.push(`   ${error.error}`);
        lines.push('');
      });
    }
    
    lines.push('');
    lines.push('=' .repeat(60));
    lines.push(`보고서 생성: ${new Date().toLocaleString('ko-KR')}`);
    
    return lines.join('\n');
  }

  /**
   * 백분율 계산
   */
  getPercentage(value, total) {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  /**
   * 비정상 종료 처리
   */
  async handleEmergencyShutdown() {
    this.log('warning', '비정상 종료 감지 - 로그 저장 중...');
    await this.finalize('emergency_shutdown');
  }
}

module.exports = SessionLogger;