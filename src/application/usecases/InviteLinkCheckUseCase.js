/**
 * 초대링크 확인 Use Case
 * YouTube Family 초대 링크의 유효성을 일반 Chrome 브라우저로 확인
 */

const chalk = require('chalk');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');

// Stealth 플러그인 사용 (자동화 감지 우회)
puppeteer.use(StealthPlugin());

class InviteLinkCheckUseCase {
  constructor({ sheetsRepository, logger }) {
    this.sheetsRepository = sheetsRepository;
    this.logger = logger;
    this.rl = null; // readline은 필요시 생성
    
    // 설정
    this.config = {
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      sheetName: '초대링크확인',
      linkColumns: ['S', 'V', 'Y', 'AB', 'AE'], // 초대링크가 있는 열들
      resultColumns: ['R', 'U', 'X', 'AA', 'AD'], // 결과를 기록할 열들
      headless: false, // 브라우저 창 표시
      userDataDir: 'C:/Temp/chrome_session_invite', // Chrome 세션 디렉토리
      checkDelay: 2000, // 링크 확인 간 대기 시간 (ms)
      pageLoadTimeout: 30000, // 페이지 로딩 타임아웃
    };
    
    this.browser = null;
    this.page = null;
  }

  /**
   * 실행 메인 메서드
   */
  async execute() {
    const result = {
      success: false,
      totalLinks: 0,
      validLinks: 0,
      expiredLinks: 0,
      alreadyJoined: 0,
      unknownStatus: 0,
      error: null,
      startTime: Date.now()
    };

    try {
      this.log('🚀 초대링크 확인 작업 시작', 'info');
      
      // 1. 브라우저 초기화
      await this.initializeBrowser();
      
      // 2. 로그인 상태 확인 - 로그인 되어 있으면 자동 진행
      const isLoggedIn = await this.checkLoginStatus();
      if (!isLoggedIn) {
        this.log('로그인이 필요합니다. 사용자 입력을 기다립니다...', 'warning');
        await this.performLogin();
      } else {
        this.log('✅ 이미 로그인되어 있습니다. 자동으로 진행합니다...', 'success');
      }
      
      // 3. Google Sheets에서 데이터 읽기
      const linkData = await this.fetchLinkData();
      if (!linkData || linkData.length === 0) {
        this.log('검사할 초대링크가 없습니다', 'warning');
        result.success = true;
        return result;
      }
      
      result.totalLinks = linkData.length;
      this.log(`총 ${result.totalLinks}개의 링크를 검사합니다`, 'info');
      
      // 4. 각 링크 검증
      const validationResults = [];
      const progressStartTime = Date.now();
      
      for (let i = 0; i < linkData.length; i++) {
        const row = linkData[i];
        
        // 진행률 표시 (Python 프로그램과 동일)
        const elapsed = (Date.now() - progressStartTime) / 1000;
        const percent = ((i + 1) / linkData.length * 100).toFixed(1);
        const speed = elapsed > 0 ? ((i + 1) / elapsed * 60).toFixed(1) : 0;
        const remaining = i > 0 ? ((linkData.length - i - 1) / ((i + 1) / elapsed) / 60).toFixed(1) : '계산중';
        
        this.log(`🚀 진행률: ${i + 1}/${linkData.length} (${percent}%) | 속도: ${speed}행/분 | 예상 완료: ${remaining}분 후`, 'info');
        
        const rowResult = await this.validateRow(row);
        validationResults.push(rowResult);
        
        // 통계 업데이트
        for (const status of Object.values(rowResult.results)) {
          if (status === '유효') result.validLinks++;
          else if (status === '만료') result.expiredLinks++;
          else if (status === '가입됨') result.alreadyJoined++;
          else if (status === '확인불가') result.unknownStatus++;
        }
        
        // 중간 업데이트 (20행마다)
        if ((i + 1) % 20 === 0) {
          await this.updateSheets(validationResults.slice(i - 19, i + 1));
          this.log(`중간 업데이트 완료 (${i + 1}/${linkData.length})`, 'success');
        }
      }
      
      // 5. 최종 결과 업데이트
      await this.updateSheets(validationResults);
      
      // 6. 결과 요약
      this.printSummary(result);
      
      result.success = true;
      result.duration = Math.round((Date.now() - result.startTime) / 1000);
      
    } catch (error) {
      this.log(`오류 발생: ${error.message}`, 'error');
      result.error = error.message;
    } finally {
      // 브라우저 정리
      if (this.browser) {
        await this.browser.close();
      }
    }
    
    return result;
  }

  /**
   * 브라우저 초기화
   */
  async initializeBrowser() {
    this.log('Chrome 브라우저 초기화 중...', 'info');
    
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--window-size=1920,1080'
    ];
    
    // 시스템에 설치된 Chrome 사용
    const fs = require('fs');
    const possiblePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.CHROME_PATH // 환경변수로 설정 가능
    ];

    let executablePath = null;
    for (const path of possiblePaths) {
      if (path && fs.existsSync(path)) {
        executablePath = path;
        this.log(`Chrome 발견: ${path}`, 'info');
        break;
      }
    }

    // Launch 옵션 설정
    const launchOptions = {
      headless: this.config.headless,
      userDataDir: this.config.userDataDir,
      args: args,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
    };

    // Chrome 경로가 있으면 추가
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    try {
      this.browser = await puppeteer.launch(launchOptions);
    } catch (launchError) {
      // Chrome을 찾을 수 없는 경우 Puppeteer 다운로드 시도
      this.log('Chrome 브라우저를 찾을 수 없습니다. Puppeteer Chrome 다운로드를 시도합니다...', 'warning');
      const puppeteer = require('puppeteer');
      this.browser = await puppeteer.launch({
        ...launchOptions,
        executablePath: undefined // 시스템 Chrome 대신 Puppeteer Chrome 사용
      });
    }
    
    this.page = await this.browser.newPage();
    
    // User-Agent 설정
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    // 타임아웃 설정
    this.page.setDefaultTimeout(this.config.pageLoadTimeout);
    
    this.log('브라우저 초기화 완료', 'success');
  }

  /**
   * 로그인 상태 확인
   */
  async checkLoginStatus() {
    try {
      this.log('로그인 상태 확인 중...', 'info');
      
      // Gmail로 먼저 시도 (더 안정적)
      try {
        await this.page.goto('https://mail.google.com', { 
          waitUntil: 'domcontentloaded', 
          timeout: 10000 
        });
        await new Promise(r => setTimeout(r, 2000));
        const url = this.page.url();
        if (url.includes('mail.google.com/mail') && !url.includes('accounts.google.com')) {
          this.log('✅ Gmail을 통해 로그인 확인됨', 'success');
          return true;
        }
      } catch(e) {}
      
      // myaccount.google.com 폴백
      await this.page.goto('https://myaccount.google.com', {
        waitUntil: 'networkidle2'
      });
      
      // 로그인 상태 확인 (프로필 이미지나 이메일 주소 존재 여부)
      const isLoggedIn = await this.page.evaluate(() => {
        return document.querySelector('[data-email]') !== null || 
               document.querySelector('img[aria-label*="Profile"]') !== null;
      });
      
      if (isLoggedIn) {
        this.log('✅ 이미 로그인되어 있습니다', 'success');
        return true;
      }
      
      this.log('로그인이 필요합니다', 'warning');
      return false;
      
    } catch (error) {
      this.log(`로그인 상태 확인 실패: ${error.message}`, 'warning');
      return false;
    }
  }

  /**
   * Google 로그인 수행
   */
  async performLogin() {
    this.log('Google 로그인 프로세스 시작', 'info');
    
    await this.page.goto('https://accounts.google.com', {
      waitUntil: 'networkidle2'
    });
    
    console.log(chalk.yellow('\n' + '='.repeat(60)));
    console.log(chalk.yellow('📌 수동 로그인이 필요합니다!'));
    console.log(chalk.yellow('브라우저 창에서 Google 계정으로 로그인해주세요.'));
    console.log(chalk.yellow('='.repeat(60) + '\n'));
    
    // readline을 사용하여 Y/N 입력 받기
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      rl.question('로그인을 완료하셨나요? (Y/N): ', (ans) => {
        rl.close();
        resolve(ans);
      });
    });
    
    if (answer.toLowerCase() !== 'y') {
      throw new Error('로그인이 취소되었습니다');
    }
    
    // 로그인 완료 확인
    const loginSuccess = await this.checkLoginStatus();
    if (!loginSuccess) {
      throw new Error('로그인 확인에 실패했습니다. 다시 시도해주세요.');
    }
    
    this.log('✅ 로그인 성공!', 'success');
  }

  /**
   * Google Sheets에서 링크 데이터 가져오기
   */
  async fetchLinkData() {
    this.log('Google Sheets에서 데이터 읽는 중...', 'info');

    try {
      // Mock Repository나 간단한 Repository를 위한 처리
      if (this.sheetsRepository.fetchData) {
        const rows = await this.sheetsRepository.fetchData(this.config.sheetName);
        if (!rows || rows.length === 0) return [];

        const linkData = [];
        // Mock 데이터는 이미 처리된 형태일 수 있음
        return linkData; // 빈 배열 반환 (테스트용)
      }

      // 실제 Google Sheets API 사용
      // sheetsRepository 초기화 및 sheets 객체 가져오기
      if (!this.sheetsRepository.sheets) {
        await this.sheetsRepository.initialize();
      }
      const sheets = this.sheetsRepository.sheets;

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: `${this.config.sheetName}!A:AE` // 전체 범위
      });

      const rows = response.data.values || [];
      if (rows.length === 0) return [];

      const linkData = [];
      const headers = rows[0];

      // 링크 열의 인덱스 찾기
      const linkColumnIndices = {};
      for (const col of this.config.linkColumns) {
        const index = this.columnToIndex(col);
        linkColumnIndices[col] = index;
      }

      // 데이터 행 처리 (헤더 제외)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const links = {};

        // 각 링크 열에서 URL 추출
        let hasLink = false;
        for (const [col, index] of Object.entries(linkColumnIndices)) {
          const link = row[index] || '';
          if (link && link.startsWith('http')) {
            links[col] = link;
            hasLink = true;
          }
        }

        // 링크가 있는 행만 추가
        if (hasLink) {
          linkData.push({
            rowNumber: i + 1, // 1-based 행 번호
            links: links
          });
        }
      }

      this.log(`${linkData.length}개 행에서 초대링크 발견`, 'info');
      return linkData;

    } catch (error) {
      this.log(`데이터 가져오기 실패: ${error.message}`, 'error');
      // 오류 시 빈 배열 반환
      return [];
    }
  }

  /**
   * 한 행의 모든 링크 검증
   */
  async validateRow(rowData) {
    const results = {};
    
    for (const [column, link] of Object.entries(rowData.links)) {
      this.log(`  열 ${column}: ${link.substring(0, 50)}...`, 'debug');
      
      const status = await this.checkInviteLink(link);
      results[column] = status;
      
      this.log(`  → 상태: ${status}`, status === '유효' ? 'success' : 'warning');
      
      // 링크 간 대기
      await this.delay(this.config.checkDelay);
    }
    
    return {
      rowNumber: rowData.rowNumber,
      results: results
    };
  }

  /**
   * 개별 초대링크 확인
   */
  async checkInviteLink(url) {
    try {
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.pageLoadTimeout
      });
      
      // 페이지 내용 가져오기
      const pageContent = await this.page.content();
      const pageText = await this.page.evaluate(() => document.body.innerText);
      
      // 상태 키워드 확인
      const statusKeywords = {
        '유효': [
          '가입하도록 초대', '초대했습니다', '가족 그룹에 가입',
          'join the family group', 'invite family members',
          'accept invitation', '가족 멤버', '초대를 수락'
        ],
        '만료': [
          '초대장이 유효하지 않음', '만료', 'invitation expired',
          'no longer valid', '더 이상 유효하지 않음',
          '같은 국가에 있지 않', '12개월', '잘못된 요청'
        ],
        '가입됨': [
          '이미 가족 그룹을 사용 중', '가족 그룹에 이미 가입',
          'already using a family group', 'already a member',
          '다른 가족 그룹', 'already in a family'
        ]
      };
      
      // 키워드 매칭
      for (const [status, keywords] of Object.entries(statusKeywords)) {
        for (const keyword of keywords) {
          if (pageText.toLowerCase().includes(keyword.toLowerCase())) {
            return status;
          }
        }
      }
      
      return '확인불가';
      
    } catch (error) {
      this.log(`링크 확인 중 오류: ${error.message}`, 'error');
      return '확인불가';
    }
  }

  /**
   * Google Sheets에 결과 업데이트
   */
  async updateSheets(results) {
    try {
      // sheetsRepository 초기화 및 sheets 객체 가져오기
      if (!this.sheetsRepository.sheets) {
        await this.sheetsRepository.initialize();
      }
      const sheets = this.sheetsRepository.sheets;
      const updateData = [];
      
      for (const result of results) {
        const rowNumber = result.rowNumber;
        
        // 각 결과 열에 상태 업데이트
        for (const [linkCol, status] of Object.entries(result.results)) {
          const linkIndex = this.config.linkColumns.indexOf(linkCol);
          if (linkIndex !== -1) {
            const resultCol = this.config.resultColumns[linkIndex];
            const range = `${this.config.sheetName}!${resultCol}${rowNumber}`;
            
            updateData.push({
              range: range,
              values: [[status]]
            });
          }
        }
      }
      
      if (updateData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.config.spreadsheetId,
          resource: {
            valueInputOption: 'USER_ENTERED',
            data: updateData
          }
        });
        
        this.log(`${updateData.length}개 셀 업데이트 완료`, 'success');
      }
      
    } catch (error) {
      this.log(`Sheets 업데이트 실패: ${error.message}`, 'error');
    }
  }

  /**
   * 결과 요약 출력
   */
  printSummary(result) {
    console.log('\n' + chalk.blue('='.repeat(50)));
    console.log(chalk.blue.bold('📊 초대링크 검사 결과 요약'));
    console.log(chalk.blue('='.repeat(50)));
    console.log(chalk.cyan(`총 검사 링크 수: ${result.totalLinks}`));
    console.log(chalk.green(`✅ 유효한 링크: ${result.validLinks}개`));
    console.log(chalk.yellow(`⏰ 만료된 링크: ${result.expiredLinks}개`));
    console.log(chalk.gray(`👥 이미 가입된 링크: ${result.alreadyJoined}개`));
    console.log(chalk.red(`❓ 확인 불가: ${result.unknownStatus}개`));
    
    if (result.totalLinks > 0) {
      const validRate = ((result.validLinks / result.totalLinks) * 100).toFixed(1);
      console.log(chalk.cyan(`\n유효한 링크 비율: ${validRate}%`));
    }
    console.log(chalk.blue('='.repeat(50)));
  }

  /**
   * 열 문자를 인덱스로 변환 (A=0, B=1, ..., Z=25, AA=26, ...)
   */
  columnToIndex(column) {
    let index = 0;
    for (let i = 0; i < column.length; i++) {
      index = index * 26 + (column.charCodeAt(i) - 65) + 1;
    }
    return index - 1;
  }

  /**
   * 지연 헬퍼
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로깅 헬퍼
   */
  log(message, level = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = `[${timestamp}] [InviteCheck]`;
    
    switch(level) {
      case 'success':
        console.log(chalk.green(`${prefix} ✅ ${message}`));
        break;
      case 'error':
        console.log(chalk.red(`${prefix} ❌ ${message}`));
        break;
      case 'warning':
        console.log(chalk.yellow(`${prefix} ⚠️ ${message}`));
        break;
      case 'debug':
        if (process.env.DEBUG_MODE === 'true') {
          console.log(chalk.gray(`${prefix} 🔍 ${message}`));
        }
        break;
      default:
        console.log(chalk.cyan(`${prefix} ${message}`));
    }
    
    // Logger 호출
    if (this.logger) {
      // level을 logger의 표준 메서드로 매핑
      const loggerLevel = level === "success" ? "info" :
                         level === "warning" ? "warn" :
                         level;

      // logger 메서드가 존재하는지 확인 후 호출
      if (typeof this.logger[loggerLevel] === "function") {
        try {
          // logger가 동기 메서드일 수도 있으므로 직접 호출
          const result = this.logger[loggerLevel](message);
          // Promise인 경우에만 catch 처리
          if (result && typeof result.catch === 'function') {
            result.catch(err => {
              console.error("Logger error:", err);
            });
          }
        } catch (err) {
          console.error("Logger error:", err);
        }
      }
    }
  }
}

module.exports = InviteLinkCheckUseCase;