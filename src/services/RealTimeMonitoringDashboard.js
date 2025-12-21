/**
 * RealTimeMonitoringDashboard - 실시간 모니터링 대시보드
 * 
 * Day 10: 실시간으로 작업 진행 상황을 모니터링하는 대시보드
 * - 실시간 통계
 * - 성공/실패 추적
 * - 성능 메트릭
 * - 알림 시스템
 */

const chalk = require('chalk');
const EventEmitter = require('events');

// Optional dependencies - blessed는 모니터링 기능 사용시에만 필요
let blessed, contrib;
try {
  blessed = require('blessed');
  contrib = require('blessed-contrib');
} catch (error) {
  console.log(chalk.yellow('⚠️ blessed/blessed-contrib not installed. Monitoring dashboard will be disabled.'));
}

class RealTimeMonitoringDashboard extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      refreshInterval: 1000,  // 1초마다 갱신
      showGrid: true,
      title: 'YouTube Family Plan Check Monitor',
      ...options
    };
    
    // 통계 데이터
    this.stats = {
      total: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      eligible: 0,
      ineligible: 0,
      avgProcessTime: 0,
      startTime: null,
      currentThroughput: 0
    };
    
    // 시계열 데이터
    this.timeSeriesData = {
      throughput: [],
      successRate: [],
      responseTime: []
    };
    
    // 최근 작업 로그
    this.recentLogs = [];
    this.maxLogs = 10;
    
    // 알림 큐
    this.alerts = [];
    this.maxAlerts = 5;
  }

  /**
   * 대시보드 초기화
   */
  initialize() {
    // 터미널 화면 생성
    this.screen = blessed.screen({
      smartCSR: true,
      title: this.options.title
    });
    
    // 그리드 레이아웃
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });
    
    // 컴포넌트 생성
    this.createComponents();
    
    // 이벤트 핸들러 설정
    this.setupEventHandlers();
    
    // 갱신 타이머 시작
    this.startUpdateTimer();
    
    // 키보드 이벤트
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy();
      process.exit(0);
    });
    
    // 화면 렌더링
    this.screen.render();
    
    console.log(chalk.green('✅ 모니터링 대시보드 시작'));
    console.log(chalk.gray('ESC 또는 Q를 눌러 종료'));
  }

  /**
   * 대시보드 컴포넌트 생성
   */
  createComponents() {
    // 1. 타이틀 바
    this.titleBar = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: `{center}${this.options.title}{/center}`,
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });
    
    // 2. 실시간 통계
    this.statsTable = this.grid.set(1, 0, 3, 4, contrib.table, {
      keys: false,
      label: ' 📊 실시간 통계 ',
      columnSpacing: 3,
      columnWidth: [15, 10],
      style: {
        border: { fg: 'cyan' },
        header: { fg: 'yellow', bold: true }
      }
    });
    
    // 3. 처리량 그래프
    this.throughputChart = this.grid.set(1, 4, 3, 4, contrib.line, {
      label: ' ⚡ 처리량 (accounts/min) ',
      showLegend: false,
      style: {
        line: 'green',
        text: 'white',
        baseline: 'white',
        border: { fg: 'cyan' }
      }
    });
    
    // 4. 성공률 그래프
    this.successRateChart = this.grid.set(1, 8, 3, 4, contrib.line, {
      label: ' 🎯 성공률 (%) ',
      showLegend: false,
      minY: 0,
      maxY: 100,
      style: {
        line: 'yellow',
        text: 'white',
        baseline: 'white',
        border: { fg: 'cyan' }
      }
    });
    
    // 5. Family Plan 상태 파이 차트
    this.statusPie = this.grid.set(4, 0, 3, 4, contrib.donut, {
      label: ' 🏠 Family Plan 상태 ',
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2,
      style: {
        border: { fg: 'cyan' }
      }
    });
    
    // 6. 실행 중인 작업
    this.activeTasksList = this.grid.set(4, 4, 3, 4, blessed.list, {
      label: ' 🔄 실행 중 ',
      mouse: true,
      keys: true,
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue' }
      }
    });
    
    // 7. 응답 시간 히스토그램
    this.responseTimeBar = this.grid.set(4, 8, 3, 4, contrib.bar, {
      label: ' 🕒 응답 시간 (s) ',
      barWidth: 4,
      barSpacing: 6,
      xOffset: 0,
      maxHeight: 9,
      style: {
        border: { fg: 'cyan' },
        bar: { bg: 'green' }
      }
    });
    
    // 8. 최근 로그
    this.logsBox = this.grid.set(7, 0, 3, 8, contrib.log, {
      label: ' 📋 최근 활동 ',
      tags: true,
      style: {
        border: { fg: 'cyan' }
      }
    });
    
    // 9. 알림/경고
    this.alertsBox = this.grid.set(7, 8, 3, 4, blessed.list, {
      label: ' 🔔 알림 ',
      mouse: true,
      style: {
        border: { fg: 'red' },
        selected: { bg: 'red' }
      }
    });
    
    // 10. 진행률 바
    this.progressBar = this.grid.set(10, 0, 1, 12, contrib.gauge, {
      label: ' 전체 진행률 ',
      stroke: 'green',
      fill: 'white',
      style: {
        border: { fg: 'cyan' }
      }
    });
    
    // 11. 상태 바
    this.statusBar = this.grid.set(11, 0, 1, 12, blessed.box, {
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });
  }

  /**
   * 통계 업데이트
   */
  updateStats(newStats) {
    Object.assign(this.stats, newStats);
    this.updateDisplay();
  }

  /**
   * 화면 업데이트
   */
  updateDisplay() {
    // 1. 통계 테이블 업데이트
    this.statsTable.setData({
      headers: ['항목', '값'],
      data: [
        ['전체 계정', String(this.stats.total)],
        ['처리 중', String(this.stats.processing)],
        ['완료', String(this.stats.completed)],
        ['실패', String(this.stats.failed)],
        ['가입 가능', String(this.stats.eligible)],
        ['가입 불가', String(this.stats.ineligible)],
        ['평균 처리시간', `${this.stats.avgProcessTime}s`]
      ]
    });
    
    // 2. 처리량 차트 업데이트
    this.updateThroughputChart();
    
    // 3. 성공률 차트 업데이트
    this.updateSuccessRateChart();
    
    // 4. Family Plan 파이 차트
    this.updateStatusPie();
    
    // 5. 진행률 바
    const progress = this.stats.total > 0 
      ? Math.round((this.stats.completed + this.stats.failed) / this.stats.total * 100)
      : 0;
    this.progressBar.setPercent(progress);
    
    // 6. 상태 바
    this.updateStatusBar();
    
    // 화면 렌더링
    this.screen.render();
  }

  /**
   * 처리량 차트 업데이트
   */
  updateThroughputChart() {
    // 새 데이터 추가
    this.timeSeriesData.throughput.push(this.stats.currentThroughput);
    
    // 최대 100개 포인트만 유지
    if (this.timeSeriesData.throughput.length > 100) {
      this.timeSeriesData.throughput.shift();
    }
    
    // 차트 데이터 설정
    const x = Array.from({ length: this.timeSeriesData.throughput.length }, (_, i) => i);
    this.throughputChart.setData([{
      x: x,
      y: this.timeSeriesData.throughput
    }]);
  }

  /**
   * 성공률 차트 업데이트
   */
  updateSuccessRateChart() {
    const total = this.stats.completed + this.stats.failed;
    const rate = total > 0 ? (this.stats.completed / total * 100) : 0;
    
    this.timeSeriesData.successRate.push(rate);
    
    if (this.timeSeriesData.successRate.length > 100) {
      this.timeSeriesData.successRate.shift();
    }
    
    const x = Array.from({ length: this.timeSeriesData.successRate.length }, (_, i) => i);
    this.successRateChart.setData([{
      x: x,
      y: this.timeSeriesData.successRate
    }]);
  }

  /**
   * Family Plan 상태 파이 차트
   */
  updateStatusPie() {
    const data = [
      { percent: this.stats.eligible, label: 'Eligible', color: 'green' },
      { percent: this.stats.ineligible, label: 'Ineligible', color: 'red' },
      { percent: this.stats.processing, label: 'Processing', color: 'yellow' }
    ];
    
    this.statusPie.setData(data);
  }

  /**
   * 상태 바 업데이트
   */
  updateStatusBar() {
    const elapsed = this.stats.startTime 
      ? Math.floor((Date.now() - this.stats.startTime) / 1000)
      : 0;
      
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const content = `{cyan-fg}⏰ 경과시간: ${timeStr}{/} | ` +
                   `{green-fg}✅ 성공: ${this.stats.completed}{/} | ` +
                   `{red-fg}❌ 실패: ${this.stats.failed}{/} | ` +
                   `{yellow-fg}🔄 처리중: ${this.stats.processing}{/} | ` +
                   `[Q] 종료`;
    
    this.statusBar.setContent(content);
  }

  /**
   * 작업 시작 알림
   */
  onTaskStart(task) {
    this.stats.processing++;
    
    // 실행 중 목록에 추가
    this.activeTasksList.addItem(`${task.email} - ${task.step || 'Starting'}`);
    
    // 로그 추가
    this.addLog(`{green-fg}🚀{/} ${task.email} 작업 시작`);
    
    this.updateDisplay();
  }

  /**
   * 작업 완료 알림
   */
  onTaskComplete(task) {
    this.stats.processing--;
    this.stats.completed++;
    
    if (task.status === 'ELIGIBLE') {
      this.stats.eligible++;
    } else if (task.status === 'INELIGIBLE') {
      this.stats.ineligible++;
    }
    
    // 평균 처리시간 업데이트
    if (task.processingTime) {
      const currentAvg = this.stats.avgProcessTime;
      const totalCompleted = this.stats.completed;
      this.stats.avgProcessTime = ((currentAvg * (totalCompleted - 1)) + task.processingTime) / totalCompleted;
    }
    
    // 실행 중 목록에서 제거
    this.removeFromActiveList(task.email);
    
    // 로그 추가
    this.addLog(`{green-fg}✅{/} ${task.email} 완료 (${task.status})`);
    
    this.updateDisplay();
  }

  /**
   * 작업 실패 알림
   */
  onTaskFailed(task) {
    this.stats.processing--;
    this.stats.failed++;
    
    // 실행 중 목록에서 제거
    this.removeFromActiveList(task.email);
    
    // 로그 추가
    this.addLog(`{red-fg}❌{/} ${task.email} 실패: ${task.error}`);
    
    // 알림 추가
    this.addAlert(`실패: ${task.email}`, 'error');
    
    this.updateDisplay();
  }

  /**
   * 실행 중 목록에서 제거
   */
  removeFromActiveList(email) {
    const items = this.activeTasksList.items || [];
    const index = items.findIndex(item => item.content.includes(email));
    if (index !== -1) {
      this.activeTasksList.removeItem(index);
    }
  }

  /**
   * 로그 추가
   */
  addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.logsBox.log(`[${timestamp}] ${message}`);
  }

  /**
   * 알림 추가
   */
  addAlert(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    
    this.alerts.unshift(`${icon} [${timestamp}] ${message}`);
    
    // 최대 개수 유지
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.pop();
    }
    
    this.alertsBox.setItems(this.alerts);
    this.screen.render();
  }

  /**
   * 갱신 타이머 시작
   */
  startUpdateTimer() {
    this.updateTimer = setInterval(() => {
      // 처리량 계산
      const elapsed = this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 / 60 : 0;
      if (elapsed > 0) {
        this.stats.currentThroughput = Math.round((this.stats.completed + this.stats.failed) / elapsed);
      }
      
      this.updateDisplay();
    }, this.options.refreshInterval);
  }

  /**
   * 갱신 타이머 중지
   */
  stopUpdateTimer() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * 이벤트 핸들러 설정
   */
  setupEventHandlers() {
    // 키보드 이벤트
    this.screen.key(['r'], () => {
      this.resetStats();
    });
    
    this.screen.key(['p'], () => {
      this.togglePause();
    });
    
    this.screen.key(['c'], () => {
      this.clearLogs();
    });
  }

  /**
   * 통계 리셋
   */
  resetStats() {
    this.stats = {
      total: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      eligible: 0,
      ineligible: 0,
      avgProcessTime: 0,
      startTime: Date.now(),
      currentThroughput: 0
    };
    
    this.timeSeriesData = {
      throughput: [],
      successRate: [],
      responseTime: []
    };
    
    this.addLog('{yellow-fg}🔄 통계 리셋{/}');
    this.updateDisplay();
  }

  /**
   * 로그 클리어
   */
  clearLogs() {
    this.logsBox.setContent('');
    this.alerts = [];
    this.alertsBox.setItems([]);
    this.screen.render();
  }

  /**
   * 일시정지 토글
   */
  togglePause() {
    this.isPaused = !this.isPaused;
    const status = this.isPaused ? '일시정지' : '재개';
    this.addLog(`{yellow-fg}⏸️ 작업 ${status}{/}`);
    this.emit('pauseToggle', this.isPaused);
  }

  /**
   * 대시보드 종료
   */
  destroy() {
    this.stopUpdateTimer();
    if (this.screen) {
      this.screen.destroy();
    }
    console.log(chalk.yellow('\n📊 모니터링 대시보드 종료'));
  }

  /**
   * 시작 시간 설정
   */
  setStartTime() {
    this.stats.startTime = Date.now();
  }

  /**
   * 전체 작업 수 설정
   */
  setTotal(total) {
    this.stats.total = total;
    this.updateDisplay();
  }
}

module.exports = RealTimeMonitoringDashboard;