/**
 * 최소한의 의존성 주입 컨테이너
 * 필수 기능만 로드하여 빠른 시작
 */

const { createContainer, asClass, asValue, asFunction } = require('awilix');
const path = require('path');

/**
 * 최소 컨테이너 생성
 */
function createApplicationContainer(config = {}) {
  console.log('[Container] Creating minimal container...');
  
  const container = createContainer();

  // 기본 설정
  container.register({
    config: asValue(config),
    paths: asValue({
      root: path.dirname(__dirname),
      logs: path.join(path.dirname(__dirname), 'logs'),
      screenshots: path.join(path.dirname(__dirname), 'screenshots')
    })
  });

  // 어댑터와 리포지토리
  container.register({
    // AdsPower 간단한 Mock (실제 어댑터가 로딩 문제 있음)
    adsPowerAdapter: asValue({
      async checkConnection() {
        console.log('[AdsPower] 연결 확인 시작...');
        const url = config.adsPowerApiUrl || 'http://local.adspower.net:50325';
        console.log('[AdsPower] API URL:', url);
        
        try {
          const axios = require('axios');
          console.log('[AdsPower] axios 로드 완료');
          
          const startTime = Date.now();
          console.log('[AdsPower] HTTP 요청 시작...');
          
          const response = await axios.get(`${url}/status`, {
            timeout: 3000,
            validateStatus: () => true // 모든 상태 코드 허용
          });
          
          const elapsed = Date.now() - startTime;
          console.log(`[AdsPower] 응답 받음 (${elapsed}ms):`, response.status);
          
          // AdsPower는 status 엔드포인트에서 {"code": 0} 반환
          return response.status === 200 && response.data?.code === 0;
        } catch (error) {
          console.log('[AdsPower] 연결 실패 상세:', {
            code: error.code,
            message: error.message,
            stack: error.stack?.split('\n')[0]
          });
          
          // 연결 거부나 타임아웃인 경우에도 false 반환
          return false;
        }
      },
      async getProfiles(params = {}) {
        try {
          const axios = require('axios');
          const response = await axios.get(`${config.adsPowerApiUrl || 'http://local.adspower.net:50325'}/api/v1/user/list`, {
            params: { page_size: params.pageSize || 100 },
            timeout: 5000
          });
          return {
            profiles: response.data?.data?.list || [],
            total: response.data?.data?.total || 0
          };
        } catch (error) {
          console.log('[AdsPower] 프로필 조회 실패:', error.message);
          return { profiles: [], total: 0 };
        }
      },
      async openBrowser(profileId) {
        try {
          const axios = require('axios');
          const response = await axios.get(`${config.adsPowerApiUrl || 'http://local.adspower.net:50325'}/api/v1/browser/start`, {
            params: { user_id: profileId },
            timeout: 10000
          });
          return response.data;
        } catch (error) {
          console.log('[AdsPower] 브라우저 열기 실패:', error.message);
          return null;
        }
      },
      async closeBrowser(profileId) {
        try {
          const axios = require('axios');
          await axios.get(`${config.adsPowerApiUrl || 'http://local.adspower.net:50325'}/api/v1/browser/stop`, {
            params: { user_id: profileId },
            timeout: 5000
          });
          return true;
        } catch (error) {
          return false;
        }
      }
    }),
    
    // SimpleGoogleSheetsRepository 사용
    profileRepository: asFunction(() => {
      const SimpleGoogleSheetsRepository = require('./infrastructure/repositories/SimpleGoogleSheetsRepository');
      return new SimpleGoogleSheetsRepository({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID
      });
    }).singleton(),
    
    // Logger Mock
    logger: asValue({
      async logWorkflowStart() {},
      async logWorkflowEnd() {},
      async logError() {},
      info() {},
      warn() {},
      error() {}
    }),
    
    // Session Logger Mock
    sessionLogger: asValue({
      async initialize() {}
    }),
    
    // GracefulShutdown Mock
    gracefulShutdown: asValue({
      startListening() {},
      onShutdown() {}
    }),
    
    // ResumeWorkflow Mock
    resumeWorkflow: asValue({
      async execute(profileId) {
        console.log(`[Mock] Executing resume workflow for ${profileId}`);
        return {
          success: false,
          message: 'Mock 모드: 실제 재개 작업은 AdsPower 연결이 필요합니다'
        };
      }
    }),
    
    // PauseWorkflow Mock
    pauseWorkflow: asValue({
      async execute(profileId) {
        console.log(`[Mock] Executing pause workflow for ${profileId}`);
        return {
          success: false,
          message: 'Mock 모드: 실제 일시정지 작업은 AdsPower 연결이 필요합니다'
        };
      }
    }),
    
    // YouTubeAutomationAdapter Mock
    youTubeAutomationAdapter: asValue({
      async pauseSubscription() {
        return { success: false };
      },
      async resumeSubscription() {
        return { success: false };
      }
    })
  });

  console.log('[Container] Minimal container ready');
  return container;
}

module.exports = {
  createApplicationContainer
};