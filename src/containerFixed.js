/**
 * 수정된 의존성 주입 컨테이너
 * evaluateOnNewDocument 제거된 Fixed 버전 사용
 */

const { createContainer, asClass, asValue, asFunction } = require('awilix');
const path = require('path');

// 도메인 엔티티
const Profile = require('./domain/entities/Profile');
const Subscription = require('./domain/entities/Subscription');
const WorkflowResult = require('./domain/entities/WorkflowResult');

// 도메인 서비스
const YouTubePremiumService = require('./domain/services/YouTubePremiumService');

// 수정된 인프라 어댑터 (Fixed 버전)
const AdsPowerAdapterFixed = require('./infrastructure/adapters/AdsPowerAdapterFixed');
const YouTubeAutomationAdapter = require('./infrastructure/adapters/YouTubeAutomationAdapter');
const BrowserController = require('./infrastructure/adapters/BrowserController');

// 레포지토리
const GoogleSheetsProfileRepository = require('./infrastructure/repositories/GoogleSheetsProfileRepository');
const EnhancedGoogleSheetsRepository = require('./infrastructure/repositories/EnhancedGoogleSheetsRepository');
const PauseSheetRepository = require('./infrastructure/repositories/PauseSheetRepository');
const ResumeSheetRepository = require('./infrastructure/repositories/ResumeSheetRepository');

// 로깅 시스템
const { LoggerAdapter } = require('./infrastructure/logging/LoggerAdapter');

// 애플리케이션 유스케이스
const EnhancedPauseSubscriptionUseCase = require('./application/usecases/EnhancedPauseSubscriptionUseCase');
const EnhancedResumeSubscriptionUseCase = require('./application/usecases/EnhancedResumeSubscriptionUseCase');
const BatchPauseOptimizedUseCase = require('./application/usecases/BatchPauseOptimizedUseCase');
const BatchResumeOptimizedUseCase = require('./application/usecases/BatchResumeOptimizedUseCase');

/**
 * 컨테이너 생성 및 설정
 */
function setupContainer(config = {}) {
  const container = createContainer();

  // 설정 등록
  container.register({
    config: asValue({
      adsPowerApiUrl: config.adsPowerApiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
      googleSheetsId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
      debugMode: config.debugMode || false,
      simpleMode: config.simpleMode !== false, // 기본적으로 단순 모드 사용
      ...config
    }),

    // 로거
    logger: asFunction(() => {
      return new LoggerAdapter({
        baseDir: config.logDir || path.join(path.join(__dirname, '..'), 'logs'),
        enableConsole: config.enableConsoleLog !== false,
        enableFile: config.enableFileLog !== false,
        level: config.logLevel || 'INFO'
      });
    }).singleton(),

    // 수정된 AdsPower 어댑터 (Fixed 버전 사용)
    adsPowerAdapter: asClass(AdsPowerAdapterFixed)
      .singleton()
      .inject(() => ({
        apiUrl: config.adsPowerApiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
        debugMode: config.debugMode || false,
        simpleMode: config.simpleMode !== false,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 2000
      })),

    youtubeAdapter: asClass(YouTubeAutomationAdapter)
      .singleton()
      .inject(() => ({
        debugMode: config.debugMode || false,
        premiumUrl: 'https://www.youtube.com/paid_memberships',
        forceLanguage: config.forceLanguage || null,
        screenshotEnabled: config.screenshotEnabled !== false
      })),

    // 레포지토리
    profileRepository: asClass(GoogleSheetsProfileRepository)
      .singleton()
      .inject(() => ({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
        sheetName: '애즈파워현황'
      })),

    enhancedSheetsRepository: asClass(EnhancedGoogleSheetsRepository)
      .singleton()
      .inject(() => ({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json')
      })),

    pauseSheetRepository: asClass(PauseSheetRepository)
      .singleton()
      .inject(() => ({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
        sheetName: '일시정지'
      })),

    resumeSheetRepository: asClass(ResumeSheetRepository)
      .singleton()
      .inject(() => ({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
        sheetName: '결제재개'
      })),

    // 도메인 서비스
    youtubePremiumService: asClass(YouTubePremiumService).singleton(),

    // 유스케이스
    pauseSubscriptionUseCase: asClass(EnhancedPauseSubscriptionUseCase).scoped(),
    resumeSubscriptionUseCase: asClass(EnhancedResumeSubscriptionUseCase).scoped(),
    batchPauseUseCase: asClass(BatchPauseOptimizedUseCase).scoped(),
    batchResumeUseCase: asClass(BatchResumeOptimizedUseCase).scoped(),

    // 브라우저 컨트롤러 팩토리
    browserControllerFactory: asFunction(({ config }) => {
      return (page) => new BrowserController(page, {
        debugMode: config.debugMode,
        humanMode: !config.simpleMode, // 단순 모드일 때는 인간 모드 비활성화
        screenshotDir: path.join(__dirname, '..', 'screenshots')
      });
    })
  });

  return container;
}

module.exports = { setupContainer };