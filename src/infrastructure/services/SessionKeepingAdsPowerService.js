/**
 * 세션 유지형 AdsPower 서비스
 * 기존 브라우저 세션과 탭을 재사용하여 쿠키와 상태를 유지
 */

const axios = require('axios');
const chalk = require('chalk');

class SessionKeepingAdsPowerService {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'http://local.adspower.net:50325';
    this.debugMode = config.debugMode || false;
    this.activeSessions = new Map(); // 활성 세션 추적
  }

  /**
   * 활성 브라우저 확인
   */
  async checkActiveBrowser(profileId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/browser/active`, {
        params: { user_id: profileId }
      });

      if (response.data.code === 0 && response.data.data) {
        const data = response.data.data;
        
        // 브라우저가 이미 열려있는지 확인
        if (data.status === 'Active') {
          if (this.debugMode) {
            console.log(chalk.green(`✅ 브라우저가 이미 열려있음: ${profileId}`));
          }
          
          return {
            isActive: true,
            ws: data.ws?.puppeteer || null,
            debugPort: data.debug_port || null
          };
        }
      }
      
      return { isActive: false };
    } catch (error) {
      if (this.debugMode) {
        console.log(chalk.yellow(`⚠️ 활성 브라우저 확인 실패: ${error.message}`));
      }
      return { isActive: false };
    }
  }

  /**
   * 브라우저 열기 또는 재사용
   */
  async openOrReuseBrowser(profileId, options = {}) {
    try {
      // 1. 먼저 활성 브라우저 확인
      const activeCheck = await this.checkActiveBrowser(profileId);
      
      if (activeCheck.isActive && activeCheck.ws) {
        if (this.debugMode) {
          console.log(chalk.cyan('🔄 기존 브라우저 세션 재사용'));
        }
        
        // 캐시된 세션 정보 반환
        this.activeSessions.set(profileId, {
          ws: activeCheck.ws,
          debugPort: activeCheck.debugPort,
          reused: true
        });
        
        return {
          success: true,
          wsEndpoint: activeCheck.ws,
          debugPort: activeCheck.debugPort,
          reused: true,
          message: '기존 브라우저 세션 재사용'
        };
      }

      // 2. 브라우저가 열려있지 않으면 새로 열기
      if (this.debugMode) {
        console.log(chalk.yellow('🚀 새 브라우저 세션 시작'));
      }

      const params = {
        user_id: profileId,
        open_tabs: options.openNewTab ? 1 : 0,  // 새 탭 열지 않기
        ip_tab: 0,  // IP 탭 표시 안함
        new_first_tab: '',  // 새 탭 URL 설정 안함
        clear_cache_after_closing: 0,  // 캐시 유지
        enable_password_saving: 1,  // 비밀번호 저장 활성화
        disable_password_filling: 0  // 비밀번호 자동완성 활성화
      };

      // 추가 옵션이 있으면 적용
      if (options.headless) params.headless = 1;
      if (options.launchArgs) params.launch_args = options.launchArgs;

      const response = await axios.get(`${this.apiUrl}/api/v1/browser/start`, { params });

      if (response.data.code !== 0) {
        throw new Error(response.data.msg || '브라우저 시작 실패');
      }

      const data = response.data.data;
      
      // 세션 정보 저장
      this.activeSessions.set(profileId, {
        ws: data.ws?.puppeteer,
        debugPort: data.debug_port,
        reused: false
      });

      return {
        success: true,
        wsEndpoint: data.ws?.puppeteer,
        debugPort: data.debug_port,
        reused: false,
        message: '새 브라우저 세션 시작됨'
      };

    } catch (error) {
      console.error(chalk.red(`❌ 브라우저 열기 실패: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 현재 탭 URL 가져오기
   */
  async getCurrentTabUrl(profileId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/browser/tabs`, {
        params: { user_id: profileId }
      });

      if (response.data.code === 0 && response.data.data) {
        const tabs = response.data.data.tabs || [];
        if (tabs.length > 0) {
          return tabs[0].url;  // 첫 번째 탭의 URL
        }
      }
      
      return null;
    } catch (error) {
      if (this.debugMode) {
        console.log(chalk.yellow(`⚠️ 탭 정보 가져오기 실패: ${error.message}`));
      }
      return null;
    }
  }

  /**
   * 브라우저 닫기 (선택적)
   */
  async closeBrowser(profileId, keepOpen = false) {
    if (keepOpen) {
      if (this.debugMode) {
        console.log(chalk.cyan('🔄 브라우저를 열어둔 상태로 유지'));
      }
      return { success: true, message: '브라우저 유지' };
    }

    try {
      const response = await axios.get(`${this.apiUrl}/api/v1/browser/stop`, {
        params: { user_id: profileId }
      });

      // 세션 정보 제거
      this.activeSessions.delete(profileId);

      return {
        success: response.data.code === 0,
        message: response.data.msg || '브라우저 종료됨'
      };
    } catch (error) {
      console.error(chalk.red(`❌ 브라우저 종료 실패: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 활성 세션 정보 가져오기
   */
  getActiveSession(profileId) {
    return this.activeSessions.get(profileId);
  }

  /**
   * 모든 활성 세션 가져오기
   */
  getAllActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([profileId, session]) => ({
      profileId,
      ...session
    }));
  }

  /**
   * 세션 정리
   */
  clearSession(profileId) {
    this.activeSessions.delete(profileId);
  }

  /**
   * 모든 세션 정리
   */
  clearAllSessions() {
    this.activeSessions.clear();
  }
}

module.exports = SessionKeepingAdsPowerService;