/**
 * 배치 작업 실시간 모니터링 대시보드
 * blessed 라이브러리를 사용한 터미널 UI
 */

const blessed = require('blessed');
const contrib = require('blessed-contrib');
const chalk = require('chalk');
const BatchJobManager = require('../../services/BatchJobManager');

class BatchMonitorDashboard {
  constructor() {
    this.jobManager = BatchJobManager.getInstance();
    this.screen = null;
    this.grid = null;
    this.widgets = {};
    this.selectedJobId = null;
    this.updateInterval = null;
    this.isRunning = false;
  }

  /**
   * 대시보드 시작
   */
  async start(jobId = null) {
    if (this.isRunning) {
      console.log(chalk.yellow('대시보드가 이미 실행 중입니다.'));
      return;
    }

    this.isRunning = true;
    this.selectedJobId = jobId;

    // 화면 생성
    this.createScreen();

    // 위젯 생성
    this.createWidgets();

    // 이벤트 리스너 설정
    this.setupEventListeners();

    // 데이터 업데이트 시작
    this.startDataUpdate();

    // 화면 렌더링
    this.screen.render();
  }

  /**
   * 화면 생성
   */
  createScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'AdsPower 배치 작업 모니터',
      fullUnicode: true
    });

    // 그리드 레이아웃
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });
  }

  /**
   * 위젯 생성
   */
  createWidgets() {
    // 제목 바
    this.widgets.title = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: '{center}📊 AdsPower 배치 작업 모니터링 대시보드{/center}',
      tags: true,
      style: {
        fg: 'cyan',
        border: { fg: 'cyan' }
      }
    });

    // 작업 목록 (왼쪽)
    this.widgets.jobList = this.grid.set(1, 0, 5, 4, blessed.list, {
      label: ' 활성 작업 ',
      keys: true,
      vi: true,
      mouse: true,
      interactive: true,
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'yellow' }
      }
    });

    // 진행률 차트 (중앙 상단)
    this.widgets.progressGauge = this.grid.set(1, 4, 2, 4, contrib.gauge, {
      label: ' 전체 진행률 ',
      stroke: 'green',
      fill: 'white',
      style: {
        border: { fg: 'green' }
      }
    });

    // 속도 차트 (중앙 중단)
    this.widgets.speedChart = this.grid.set(3, 4, 3, 4, contrib.line, {
      label: ' 처리 속도 (작업/분) ',
      showLegend: false,
      style: {
        line: 'yellow',
        text: 'green',
        baseline: 'black',
        border: { fg: 'yellow' }
      }
    });

    // 상태 요약 (오른쪽 상단)
    this.widgets.statusBox = this.grid.set(1, 8, 3, 4, blessed.box, {
      label: ' 상태 요약 ',
      tags: true,
      style: {
        border: { fg: 'green' }
      }
    });

    // 메모리 사용량 (오른쪽 중단)
    this.widgets.memoryGauge = this.grid.set(4, 8, 2, 4, contrib.gauge, {
      label: ' 메모리 사용량 ',
      stroke: 'yellow',
      fill: 'white',
      style: {
        border: { fg: 'yellow' }
      }
    });

    // 작업 상세 정보 (하단 왼쪽)
    this.widgets.taskDetails = this.grid.set(6, 0, 4, 6, blessed.box, {
      label: ' 현재 작업 상세 ',
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      style: {
        border: { fg: 'blue' }
      }
    });

    // 에러 로그 (하단 오른쪽)
    this.widgets.errorLog = this.grid.set(6, 6, 4, 6, blessed.log, {
      label: ' 에러 로그 ',
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      style: {
        border: { fg: 'red' }
      }
    });

    // 컨트롤 패널 (최하단)
    this.widgets.controls = this.grid.set(10, 0, 2, 12, blessed.box, {
      content: this.getControlsText(),
      tags: true,
      style: {
        border: { fg: 'white' }
      }
    });
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 종료 키
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
    });

    // 작업 선택
    this.widgets.jobList.on('select', (item, index) => {
      const jobs = this.jobManager.getActiveJobs();
      if (jobs[index]) {
        this.selectedJobId = jobs[index].id;
        this.updateDisplay();
      }
    });

    // 작업 취소 (C 키)
    this.screen.key(['c', 'C'], () => {
      if (this.selectedJobId) {
        this.cancelSelectedJob();
      }
    });

    // 작업 일시정지 (P 키)
    this.screen.key(['p', 'P'], () => {
      if (this.selectedJobId) {
        this.pauseSelectedJob();
      }
    });

    // 작업 재개 (R 키)
    this.screen.key(['r', 'R'], () => {
      if (this.selectedJobId) {
        this.resumeSelectedJob();
      }
    });

    // 새로고침 (F5 키)
    this.screen.key(['f5'], () => {
      this.updateDisplay();
    });

    // 작업 관리자 이벤트 구독
    this.jobManager.on('jobStarted', (job) => this.onJobStarted(job));
    this.jobManager.on('jobProgress', (data) => this.onJobProgress(data));
    this.jobManager.on('jobCompleted', (data) => this.onJobCompleted(data));
    this.jobManager.on('taskStarted', (data) => this.onTaskStarted(data));
    this.jobManager.on('taskCompleted', (data) => this.onTaskCompleted(data));
    this.jobManager.on('memoryWarning', (data) => this.onMemoryWarning(data));
  }

  /**
   * 데이터 업데이트 시작
   */
  startDataUpdate() {
    // 초기 업데이트
    this.updateDisplay();

    // 주기적 업데이트 (1초마다)
    this.updateInterval = setInterval(() => {
      this.updateDisplay();
    }, 1000);
  }

  /**
   * 화면 업데이트
   */
  updateDisplay() {
    try {
      // 작업 목록 업데이트
      this.updateJobList();

      // 선택된 작업 상세 업데이트
      if (this.selectedJobId) {
        this.updateJobDetails();
        this.updateProgressGauge();
        this.updateSpeedChart();
        this.updateStatusBox();
      }

      // 메모리 사용량 업데이트
      this.updateMemoryGauge();

      // 화면 새로고침
      this.screen.render();
    } catch (error) {
      this.addErrorLog(`디스플레이 업데이트 오류: ${error.message}`);
    }
  }

  /**
   * 작업 목록 업데이트
   */
  updateJobList() {
    const jobs = this.jobManager.getActiveJobs();
    const items = jobs.map(job => {
      const progress = this.jobManager.calculateProgress(job);
      const status = this.getStatusIcon(job.status);
      return `${status} ${job.id} (${progress.percentage}%)`;
    });

    // 작업 이력 추가 (최근 5개)
    const history = this.jobManager.jobHistory.slice(0, 5);
    if (history.length > 0) {
      items.push('{gray-fg}──── 최근 완료 ────{/gray-fg}');
      history.forEach(job => {
        const status = this.getStatusIcon(job.status);
        items.push(`{gray-fg}${status} ${job.id}{/gray-fg}`);
      });
    }

    this.widgets.jobList.setItems(items);
  }

  /**
   * 작업 상세 정보 업데이트
   */
  updateJobDetails() {
    const job = this.jobManager.getJob(this.selectedJobId);
    if (!job) return;

    const progress = this.jobManager.calculateProgress(job);
    const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(0);

    let content = `{bold}작업 ID:{/bold} ${job.id}\n`;
    content += `{bold}타입:{/bold} ${job.type}\n`;
    content += `{bold}상태:{/bold} ${job.status}\n\n`;

    content += `{bold}진행 상황:{/bold}\n`;
    content += `  • 전체: ${job.totalTasks}개\n`;
    content += `  • 완료: {green-fg}${job.completedTasks}{/green-fg}\n`;
    content += `  • 실패: {red-fg}${job.failedTasks}{/red-fg}\n`;
    content += `  • 스킵: {gray-fg}${job.skippedTasks}{/gray-fg}\n`;
    content += `  • 처리중: {yellow-fg}${progress.processed - job.completedTasks - job.failedTasks - job.skippedTasks}{/yellow-fg}\n\n`;

    content += `{bold}시간:{/bold}\n`;
    content += `  • 경과: ${elapsed}초\n`;
    content += `  • 예상 남은 시간: ${progress.estimatedTimeRemaining || 'N/A'}초\n`;
    content += `  • 평균 속도: ${(job.metrics?.avgProcessingTime / 1000).toFixed(1)}초/작업\n\n`;

    if (job.currentTask) {
      content += `{bold}현재 작업:{/bold}\n`;
      content += `  • ID: ${job.currentTask.id}\n`;
      content += `  • 프로필: ${job.currentTask.profile}\n`;
      const taskElapsed = ((Date.now() - job.currentTask.startTime) / 1000).toFixed(0);
      content += `  • 경과: ${taskElapsed}초\n`;
    }

    this.widgets.taskDetails.setContent(content);
  }

  /**
   * 진행률 게이지 업데이트
   */
  updateProgressGauge() {
    const job = this.jobManager.getJob(this.selectedJobId);
    if (!job) return;

    const progress = this.jobManager.calculateProgress(job);
    this.widgets.progressGauge.setPercent(progress.percentage);
  }

  /**
   * 속도 차트 업데이트
   */
  updateSpeedChart() {
    const job = this.jobManager.getJob(this.selectedJobId);
    if (!job) return;

    // 속도 계산 (작업/분)
    const elapsed = (Date.now() - job.startTime) / 1000 / 60; // 분 단위
    const processed = job.completedTasks + job.failedTasks + job.skippedTasks;
    const speed = elapsed > 0 ? (processed / elapsed).toFixed(1) : 0;

    // 차트 데이터 업데이트 (최근 20개 포인트)
    if (!this.speedData) {
      this.speedData = { x: [], y: [] };
    }

    this.speedData.x.push(new Date().toLocaleTimeString());
    this.speedData.y.push(parseFloat(speed));

    if (this.speedData.x.length > 20) {
      this.speedData.x.shift();
      this.speedData.y.shift();
    }

    this.widgets.speedChart.setData([{
      x: this.speedData.x,
      y: this.speedData.y
    }]);
  }

  /**
   * 상태 요약 업데이트
   */
  updateStatusBox() {
    const job = this.jobManager.getJob(this.selectedJobId);
    if (!job) return;

    let content = '';

    // 성공률
    const total = job.completedTasks + job.failedTasks;
    const successRate = total > 0 ? ((job.completedTasks / total) * 100).toFixed(1) : 0;

    content += `{bold}성공률:{/bold} ${successRate}%\n\n`;

    // 최근 에러
    if (job.errors && job.errors.length > 0) {
      content += `{bold}최근 에러:{/bold}\n`;
      job.errors.slice(-3).forEach(error => {
        content += `{red-fg}• ${error.substring(0, 30)}...{/red-fg}\n`;
      });
    } else {
      content += `{green-fg}에러 없음{/green-fg}\n`;
    }

    // 옵션
    content += `\n{bold}옵션:{/bold}\n`;
    content += `• 동시 실행: ${job.options?.concurrency || 1}개\n`;
    content += `• 배치 크기: ${job.options?.batchSize || 10}개\n`;
    content += `• 재시도: ${job.options?.retryEnabled ? '활성' : '비활성'}\n`;

    this.widgets.statusBox.setContent(content);
  }

  /**
   * 메모리 게이지 업데이트
   */
  updateMemoryGauge() {
    const memUsage = process.memoryUsage();
    const percentage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

    this.widgets.memoryGauge.setPercent(percentage);

    // 색상 변경
    if (percentage > 80) {
      this.widgets.memoryGauge.style.stroke = 'red';
    } else if (percentage > 60) {
      this.widgets.memoryGauge.style.stroke = 'yellow';
    } else {
      this.widgets.memoryGauge.style.stroke = 'green';
    }
  }

  /**
   * 에러 로그 추가
   */
  addErrorLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.widgets.errorLog.log(`{red-fg}[${timestamp}] ${message}{/red-fg}`);
  }

  /**
   * 선택된 작업 취소
   */
  cancelSelectedJob() {
    if (!this.selectedJobId) return;

    const job = this.jobManager.getJob(this.selectedJobId);
    if (job && job.status === 'running') {
      this.jobManager.cancelJob(this.selectedJobId, '사용자 요청');
      this.addErrorLog(`작업 취소 요청: ${this.selectedJobId}`);
    }
  }

  /**
   * 선택된 작업 일시정지
   */
  pauseSelectedJob() {
    if (!this.selectedJobId) return;

    const job = this.jobManager.getJob(this.selectedJobId);
    if (job && job.status === 'running') {
      this.jobManager.pauseJob(this.selectedJobId);
      this.addErrorLog(`작업 일시정지: ${this.selectedJobId}`);
    }
  }

  /**
   * 선택된 작업 재개
   */
  resumeSelectedJob() {
    if (!this.selectedJobId) return;

    const job = this.jobManager.getJob(this.selectedJobId);
    if (job && job.status === 'paused') {
      this.jobManager.resumeJob(this.selectedJobId);
      this.addErrorLog(`작업 재개: ${this.selectedJobId}`);
    }
  }

  /**
   * 상태 아이콘 가져오기
   */
  getStatusIcon(status) {
    switch (status) {
      case 'running': return '🔄';
      case 'paused': return '⏸️';
      case 'completed': return '✅';
      case 'cancelled': return '❌';
      case 'failed': return '💥';
      case 'pausing': return '⏸️';
      case 'cancelling': return '🛑';
      default: return '❓';
    }
  }

  /**
   * 컨트롤 텍스트
   */
  getControlsText() {
    return '{center}' +
      '{bold}컨트롤:{/bold} ' +
      '[↑↓] 작업 선택 | ' +
      '[C] 취소 | ' +
      '[P] 일시정지 | ' +
      '[R] 재개 | ' +
      '[F5] 새로고침 | ' +
      '[Q/ESC] 종료' +
      '{/center}';
  }

  /**
   * 이벤트 핸들러들
   */
  onJobStarted(job) {
    this.addErrorLog(`새 작업 시작: ${job.id}`);
    this.updateDisplay();
  }

  onJobProgress(data) {
    // 진행률 업데이트는 자동으로 처리됨
  }

  onJobCompleted(data) {
    this.addErrorLog(`작업 완료: ${data.jobId} (${data.job.status})`);

    // 선택된 작업이 완료되면 선택 해제
    if (this.selectedJobId === data.jobId) {
      this.selectedJobId = null;
    }

    this.updateDisplay();
  }

  onTaskStarted(data) {
    // 현재 작업 표시 업데이트
    if (this.selectedJobId === data.jobId) {
      this.updateDisplay();
    }
  }

  onTaskCompleted(data) {
    // 결과에 따라 로그 추가
    if (data.result.status === 'failed') {
      this.addErrorLog(`작업 실패: ${data.result.error}`);
    }
  }

  onMemoryWarning(data) {
    this.addErrorLog(`메모리 경고: ${data.usage.toFixed(1)}%`);
  }

  /**
   * 대시보드 정지
   */
  stop() {
    this.isRunning = false;

    // 업데이트 인터벌 정리
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // 이벤트 리스너 제거
    this.jobManager.removeAllListeners();

    // 화면 종료
    if (this.screen) {
      this.screen.destroy();
    }

    console.log(chalk.cyan('\n대시보드를 종료했습니다.'));
    process.exit(0);
  }
}

module.exports = BatchMonitorDashboard;