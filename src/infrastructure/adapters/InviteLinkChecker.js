/**
 * YouTube Premium 초대링크 확인 시스템
 * Google Sheets '초대링크확인' 탭과 연동
 */

const chalk = require('chalk');
const { google } = require('googleapis');
const path = require('path');

class InviteLinkChecker {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      debugMode: config.debugMode || false,
      screenshotEnabled: config.screenshotEnabled !== false,
      spreadsheetId: config.spreadsheetId || process.env.GOOGLE_SHEETS_ID,
      sheetName: config.sheetName || '초대링크확인',
      ...config
    };
    
    // 필드 인덱스 매핑
    this.fieldMapping = {
      번호: 0,
      아이디: 1,
      비밀번호: 2,
      복구이메일: 3,
      코드: 4,
      포워딩메일: 5,
      만료날짜: 6,
      국가: 7,
      정기결제일: 8,
      데드라인: 9,
      카드: 10,
      일시중지: 11,
      다음결제일: 12,
      cvc: 13,
      백업: 14,
      특이사항: 15,
      사용자1: 16,
      비밀번호1: 17,
      초대링크1: 18,
      사용자2: 19,
      비밀번호2: 20,
      초대링크2: 21,
      사용자3: 22,
      비밀번호3: 23,
      초대링크3: 24,
      사용자4: 25,
      비밀번호4: 26,
      초대링크4: 27,
      사용자5: 28,
      비밀번호5: 29,
      초대링크5: 30
    };
    
    this.sheets = null;
    this.auth = null;
  }

  /**
   * Google Sheets API 초기화
   */
  async initGoogleSheets() {
    try {
      const keyFile = path.join(__dirname, '../../../service_account.json');
      const auth = new google.auth.GoogleAuth({
        keyFile: keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      this.auth = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log(chalk.green('✅ Google Sheets API 초기화 완료'));
      return true;
      
    } catch (error) {
      console.error(chalk.red('Google Sheets 초기화 실패:'), error.message);
      return false;
    }
  }

  /**
   * 초대링크확인 탭에서 데이터 읽기
   */
  async readInviteData() {
    try {
      if (!this.sheets) {
        await this.initGoogleSheets();
      }
      
      const range = `${this.config.sheetName}!A:AE`; // A부터 AE열까지 (31개 컬럼)
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.spreadsheetId,
        range: range
      });
      
      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log(chalk.yellow('데이터가 없습니다'));
        return [];
      }
      
      // 헤더 제외하고 데이터 파싱
      const data = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row[this.fieldMapping.아이디]) { // 아이디가 있는 행만 처리
          const account = {
            rowIndex: i + 1, // 시트에서의 실제 행 번호
            email: row[this.fieldMapping.아이디] || '',
            password: row[this.fieldMapping.비밀번호] || '',
            recoveryEmail: row[this.fieldMapping.복구이메일] || '',
            pauseStatus: row[this.fieldMapping.일시중지] || '',
            nextBillingDate: row[this.fieldMapping.다음결제일] || '',
            inviteLinks: []
          };
          
          // 초대링크 정보 수집 (최대 5개)
          for (let j = 1; j <= 5; j++) {
            const linkField = `초대링크${j}`;
            const userField = `사용자${j}`;
            const passField = `비밀번호${j}`;
            
            if (row[this.fieldMapping[linkField]]) {
              account.inviteLinks.push({
                index: j,
                user: row[this.fieldMapping[userField]] || '',
                password: row[this.fieldMapping[passField]] || '',
                link: row[this.fieldMapping[linkField]] || '',
                status: '미확인'
              });
            }
          }
          
          data.push(account);
        }
      }
      
      console.log(chalk.green(`✅ ${data.length}개 계정 데이터 로드됨`));
      return data;
      
    } catch (error) {
      console.error(chalk.red('데이터 읽기 실패:'), error.message);
      return [];
    }
  }

  /**
   * 초대링크 상태 확인
   */
  async checkInviteLink(link) {
    try {
      if (!link) return { status: '링크없음', active: false };
      
      console.log(chalk.cyan(`초대링크 확인: ${link.substring(0, 50)}...`));
      
      // 초대링크 페이지로 이동
      await this.page.goto(link, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      // 페이지 상태 확인
      const linkStatus = await this.page.evaluate(() => {
        const pageText = document.body?.innerText || '';
        const pageTitle = document.title || '';
        
        // 다양한 상태 체크
        if (pageText.includes('expired') || pageText.includes('만료')) {
          return { status: '만료됨', active: false, details: '초대링크가 만료되었습니다' };
        }
        
        if (pageText.includes('invalid') || pageText.includes('유효하지')) {
          return { status: '유효하지않음', active: false, details: '유효하지 않은 링크입니다' };
        }
        
        if (pageText.includes('already') || pageText.includes('이미')) {
          return { status: '이미사용됨', active: false, details: '이미 사용된 링크입니다' };
        }
        
        if (pageText.includes('Join') || pageText.includes('가입') || 
            pageText.includes('Accept') || pageText.includes('수락')) {
          return { status: '활성', active: true, details: '초대 수락 가능' };
        }
        
        if (pageText.includes('Sign in') || pageText.includes('로그인')) {
          return { status: '로그인필요', active: true, details: '로그인 후 확인 필요' };
        }
        
        // YouTube Premium Family 관련
        if (pageText.includes('Family') || pageText.includes('가족')) {
          if (pageText.includes('full') || pageText.includes('가득')) {
            return { status: '가족그룹만원', active: false, details: '가족 그룹이 가득 참' };
          }
          return { status: '활성', active: true, details: '가족 그룹 초대 가능' };
        }
        
        return { status: '확인필요', active: false, details: pageTitle };
      });
      
      if (this.config.debugMode) {
        console.log(chalk.gray(`상태: ${linkStatus.status}`));
        console.log(chalk.gray(`세부: ${linkStatus.details}`));
      }
      
      return linkStatus;
      
    } catch (error) {
      console.error(chalk.red('링크 확인 실패:'), error.message);
      return { status: '오류', active: false, details: error.message };
    }
  }

  /**
   * 계정별 모든 초대링크 확인
   */
  async checkAccountInviteLinks(account) {
    try {
      console.log(chalk.cyan(`\n=== ${account.email} 초대링크 확인 ===`));
      
      const results = [];
      
      for (const invite of account.inviteLinks) {
        console.log(chalk.gray(`\n사용자${invite.index}: ${invite.user}`));
        
        const linkStatus = await this.checkInviteLink(invite.link);
        
        results.push({
          ...invite,
          status: linkStatus.status,
          active: linkStatus.active,
          details: linkStatus.details
        });
        
        // 스크린샷 저장 (필요시)
        if (this.config.screenshotEnabled) {
          const screenshotPath = `screenshots/invite-${account.email}-user${invite.index}-${Date.now()}.png`;
          await this.page.screenshot({ path: screenshotPath });
        }
        
        // 요청 간 대기
        await new Promise(r => setTimeout(r, 2000));
      }
      
      return results;
      
    } catch (error) {
      console.error(chalk.red('계정 초대링크 확인 실패:'), error.message);
      return [];
    }
  }

  /**
   * Google Sheets 업데이트
   */
  async updateInviteStatus(account, results) {
    try {
      if (!this.sheets) {
        await this.initGoogleSheets();
      }
      
      const updates = [];
      
      // 각 초대링크 상태 업데이트
      for (const result of results) {
        const statusColumn = this.getColumnLetter(this.fieldMapping[`초대링크${result.index}`] + 2); // 상태는 링크 다음 열
        const range = `${this.config.sheetName}!${statusColumn}${account.rowIndex}`;
        
        updates.push({
          range: range,
          values: [[`${result.status} (${new Date().toLocaleDateString()})`]]
        });
      }
      
      // 특이사항 업데이트
      const noteColumn = this.getColumnLetter(this.fieldMapping.특이사항 + 1);
      const noteRange = `${this.config.sheetName}!${noteColumn}${account.rowIndex}`;
      const activeCount = results.filter(r => r.active).length;
      const totalCount = results.length;
      
      updates.push({
        range: noteRange,
        values: [[`초대링크: ${activeCount}/${totalCount} 활성 (${new Date().toLocaleString()})`]]
      });
      
      // 배치 업데이트
      if (updates.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.config.spreadsheetId,
          requestBody: {
            data: updates,
            valueInputOption: 'USER_ENTERED'
          }
        });
        
        console.log(chalk.green('✅ Google Sheets 업데이트 완료'));
      }
      
      return true;
      
    } catch (error) {
      console.error(chalk.red('Sheets 업데이트 실패:'), error.message);
      return false;
    }
  }

  /**
   * 열 번호를 문자로 변환 (1 -> A, 27 -> AA)
   */
  getColumnLetter(columnNumber) {
    let letter = '';
    while (columnNumber > 0) {
      const remainder = (columnNumber - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      columnNumber = Math.floor((columnNumber - 1) / 26);
    }
    return letter;
  }

  /**
   * 전체 초대링크 확인 워크플로우
   */
  async executeInviteCheckWorkflow() {
    try {
      console.log(chalk.cyan.bold('\n=== 초대링크 확인 워크플로우 시작 ===\n'));
      
      // 1. Google Sheets에서 데이터 읽기
      console.log(chalk.cyan('1. Google Sheets 데이터 로드...'));
      const accounts = await this.readInviteData();
      
      if (accounts.length === 0) {
        console.log(chalk.yellow('확인할 계정이 없습니다'));
        return { success: false, message: '데이터 없음' };
      }
      
      const results = [];
      let successCount = 0;
      let totalLinks = 0;
      let activeLinks = 0;
      
      // 2. 각 계정별 초대링크 확인
      for (const account of accounts) {
        if (account.inviteLinks.length === 0) {
          console.log(chalk.gray(`${account.email}: 초대링크 없음`));
          continue;
        }
        
        console.log(chalk.cyan(`\n2. ${account.email} 처리 중...`));
        
        // 초대링크 확인
        const linkResults = await this.checkAccountInviteLinks(account);
        
        // 결과 집계
        totalLinks += linkResults.length;
        activeLinks += linkResults.filter(r => r.active).length;
        
        // Google Sheets 업데이트
        const updateSuccess = await this.updateInviteStatus(account, linkResults);
        if (updateSuccess) {
          successCount++;
        }
        
        results.push({
          email: account.email,
          links: linkResults,
          updated: updateSuccess
        });
        
        // 계정 간 대기
        await new Promise(r => setTimeout(r, 3000));
      }
      
      // 3. 결과 요약
      console.log(chalk.cyan('\n=== 초대링크 확인 완료 ==='));
      console.log(chalk.gray(`처리된 계정: ${results.length}개`));
      console.log(chalk.gray(`전체 링크: ${totalLinks}개`));
      console.log(chalk.gray(`활성 링크: ${activeLinks}개`));
      console.log(chalk.gray(`Sheets 업데이트: ${successCount}/${results.length} 성공`));
      
      return {
        success: true,
        summary: {
          accountsProcessed: results.length,
          totalLinks: totalLinks,
          activeLinks: activeLinks,
          updatedAccounts: successCount
        },
        details: results
      };
      
    } catch (error) {
      console.error(chalk.red('워크플로우 실패:'), error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = InviteLinkChecker;