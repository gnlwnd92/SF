/**
 * 의존성 주입 컨테이너
 * 모든 컴포넌트의 생성과 연결을 관리
 *
 * v2.8: 성능 최적화 - 조건부 로깅 + UseCase 지연 로딩
 */

// [v2.8] 조건부 로깅 헬퍼
const DEBUG_STARTUP = process.env.DEBUG_STARTUP === 'true';
const debugLog = (msg) => { if (DEBUG_STARTUP) console.log(msg); };

debugLog('[Container] Starting container initialization...');

const { createContainer, asClass, asValue, asFunction } = require('awilix');
const path = require('path');

/**
 * [v2.8] 지연 로딩 헬퍼 - 실제 사용 시점에 require()
 * @param {string} modulePath - 모듈 경로
 * @returns {Function} 모듈을 반환하는 함수
 */
function lazyRequire(modulePath) {
  let cached = null;
  return () => {
    if (!cached) {
      cached = require(modulePath);
    }
    return cached;
  };
}

debugLog('[Container] Core modules loaded');

// 도메인 엔티티
debugLog('[Container] Loading domain entities...');
const Profile = require('./domain/entities/Profile');
const Subscription = require('./domain/entities/Subscription');
const WorkflowResult = require('./domain/entities/WorkflowResult');

// 도메인 서비스  
debugLog('[Container] Loading domain services...');
const YouTubePremiumService = require('./domain/services/YouTubePremiumService');

// 인프라 어댑터
debugLog('[Container] Loading AdsPowerAdapter...');
// v4.0 - AdsPowerAdapter에서 스텔스 코드만 비활성화하여 사용
const AdsPowerAdapter = require('./infrastructure/adapters/AdsPowerAdapter');

debugLog('[Container] Loading YouTubeAutomationAdapter...');
// AdsPowerAdapterMinimal은 StealthHelper 의존성 문제로 사용 보류
const YouTubeAutomationAdapter = require('./infrastructure/adapters/YouTubeAutomationAdapter');

debugLog('[Container] Loading BrowserController...');
const BrowserController = require('./infrastructure/adapters/BrowserController');

// 레포지토리
debugLog('[Container] Loading repositories...');
let GoogleSheetsProfileRepository;
let EnhancedGoogleSheetsRepository;

// Mock 모드 체크
if (process.env.USE_MOCK_REPOSITORY === 'true') {
  debugLog('[Container] Using Mock repositories');
  // SimpleGoogleSheetsRepository 사용 (Fixed 로직 적용됨)
    try {
      const SimpleGoogleSheetsRepository = require('./infrastructure/repositories/SimpleGoogleSheetsRepository');
      GoogleSheetsProfileRepository = SimpleGoogleSheetsRepository;
      EnhancedGoogleSheetsRepository = SimpleGoogleSheetsRepository;
      debugLog('[Container] SimpleGoogleSheetsRepository loaded (with Fixed mapping)');
    } catch (e) {
      debugLog('[Container] SimpleGoogleSheetsRepository load failed, using Mock');
      const MockRepository = require('./infrastructure/repositories/MockGoogleSheetsRepository');
      GoogleSheetsProfileRepository = MockRepository;
      EnhancedGoogleSheetsRepository = MockRepository;
    }
} else {
  // Service Account 파일 존재 체크
  const fs = require('fs');
  const serviceAccountPaths = [
    path.join(__dirname, '..', 'credentials', 'service-account.json'),
    path.join(__dirname, '..', 'service_account.json')
  ];
  
  let hasServiceAccount = false;
  for (const p of serviceAccountPaths) {
    if (fs.existsSync(p)) {
      hasServiceAccount = true;
      debugLog('[Container] Service Account found');
      break;
    }
  }
  
  if (!hasServiceAccount) {
    debugLog('[Container] No Service Account, using Mock');
    // SimpleGoogleSheetsRepository 사용 (Fixed 로직 적용됨)
    try {
      const SimpleGoogleSheetsRepository = require('./infrastructure/repositories/SimpleGoogleSheetsRepository');
      GoogleSheetsProfileRepository = SimpleGoogleSheetsRepository;
      EnhancedGoogleSheetsRepository = SimpleGoogleSheetsRepository;
      debugLog('[Container] SimpleGoogleSheetsRepository loaded (with Fixed mapping)');
    } catch (e) {
      debugLog('[Container] SimpleGoogleSheetsRepository load failed, using Mock');
      const MockRepository = require('./infrastructure/repositories/MockGoogleSheetsRepository');
      GoogleSheetsProfileRepository = MockRepository;
      EnhancedGoogleSheetsRepository = MockRepository;
    }
  } else {
    // GoogleSheetsProfileRepository 파일이 없으므로 EnhancedGoogleSheetsRepository 사용
    debugLog('[Container] GoogleSheetsProfileRepository not found, using EnhancedGoogleSheetsRepository');
    try {
      // EnhancedGoogleSheetsRepository를 기본으로 사용
      const EnhancedRepo = require('./infrastructure/repositories/EnhancedGoogleSheetsRepository');
      GoogleSheetsProfileRepository = EnhancedRepo;
      EnhancedGoogleSheetsRepository = EnhancedRepo;
      debugLog('[Container] EnhancedGoogleSheetsRepository loaded successfully');
    } catch (e) {
      debugLog('[Container] EnhancedGoogleSheetsRepository load failed, trying SimpleGoogleSheetsRepository');
      // Fallback to SimpleGoogleSheetsRepository
      try {
        const SimpleGoogleSheetsRepository = require('./infrastructure/repositories/SimpleGoogleSheetsRepository');
        GoogleSheetsProfileRepository = SimpleGoogleSheetsRepository;
        EnhancedGoogleSheetsRepository = SimpleGoogleSheetsRepository;
        debugLog('[Container] SimpleGoogleSheetsRepository loaded (with Fixed mapping)');
      } catch (e2) {
        debugLog('[Container] SimpleGoogleSheetsRepository load failed, using Mock');
        const MockRepository = require('./infrastructure/repositories/MockGoogleSheetsRepository');
        GoogleSheetsProfileRepository = MockRepository;
        EnhancedGoogleSheetsRepository = MockRepository;
      }
    }
  }
}
debugLog('[Container] Repositories loaded');

// Google Sheets 설정 서비스
debugLog('[Container] Loading GoogleSheetsConfigService...');
let GoogleSheetsConfigService;
try {
  GoogleSheetsConfigService = require('./services/GoogleSheetsConfigService');
  debugLog('[Container] GoogleSheetsConfigService loaded successfully');
} catch (error) {
  console.warn('[Container] GoogleSheetsConfigService not found, using default settings');
}

// 로깅 시스템
debugLog('[Container] Loading logging system...');

let LoggerAdapter, SessionLogger, GracefulShutdown, DetailedErrorLogger, ErrorHandlingService;

// LoggerAdapter 간단한 Mock 사용 (파일 로딩 문제 우회)
debugLog('[Container] Using Mock LoggerAdapter');
LoggerAdapter = class MockLoggerAdapter {
  constructor() {}
  async logWorkflowStart() {}
  async logWorkflowEnd() {}
  async logError() {}
  info() {}
  warn() {}
  error() {}
};

try {
  debugLog('[Container] Loading SessionLogger...');
  SessionLogger = require('./services/SessionLogger');
} catch (error) {
  console.warn('[Container] SessionLogger not found, skipping');
}

try {
  debugLog('[Container] Loading GracefulShutdown...');
  GracefulShutdown = require('./services/GracefulShutdown');
} catch (error) {
  console.warn('[Container] GracefulShutdown not found, skipping');
}

try {
  debugLog('[Container] Loading DetailedErrorLogger...');
  DetailedErrorLogger = require('./services/DetailedErrorLogger');
} catch (error) {
  console.warn('[Container] DetailedErrorLogger not found, skipping');
}

try {
  debugLog('[Container] Loading ErrorHandlingService...');
  ErrorHandlingService = require('./services/ErrorHandlingService');
} catch (error) {
  console.warn('[Container] ErrorHandlingService not found, skipping');
}

debugLog('[Container] Logging system loaded');

// 애플리케이션 유스케이스
debugLog('[Container] Loading use cases...');

let EnhancedPauseSubscriptionUseCase, EnhancedResumeSubscriptionUseCase;
let BatchPauseOptimizedUseCase, BatchResumeOptimizedUseCase;
let DeleteProfileUseCase, OptimizedDeleteProfileUseCase;
let RenewalCheckPauseUseCase;

try {
  debugLog('[Container] Loading EnhancedPauseSubscriptionUseCase...');
  EnhancedPauseSubscriptionUseCase = require('./application/usecases/EnhancedPauseSubscriptionUseCase');
} catch (error) {
  console.error('[Container] Failed to load EnhancedPauseSubscriptionUseCase:', error.message);
  process.exit(1);
}

try {
  debugLog('[Container] Loading RenewalCheckPauseUseCase...');
  RenewalCheckPauseUseCase = require('./application/usecases/RenewalCheckPauseUseCase');
  debugLog('[Container] RenewalCheckPauseUseCase loaded successfully');
} catch (error) {
  console.warn('[Container] RenewalCheckPauseUseCase not found:', error.message);
}

try {
  debugLog('[Container] Loading EnhancedResumeSubscriptionUseCase...');
  EnhancedResumeSubscriptionUseCase = require('./application/usecases/EnhancedResumeSubscriptionUseCase');
  debugLog('[Container] EnhancedResumeSubscriptionUseCase loaded successfully');
} catch (error) {
  console.error('[Container] Failed to load EnhancedResumeSubscriptionUseCase:', error.message);
  console.error('[Container] Stack trace:', error.stack);
  // 파일은 있으므로 임시로 ImprovedResumeSubscriptionUseCase 사용
  try {
    debugLog('[Container] Fallback to ImprovedResumeSubscriptionUseCase...');
    EnhancedResumeSubscriptionUseCase = require('./application/usecases/ImprovedResumeSubscriptionUseCase');
  } catch (fallbackError) {
    console.error('[Container] Fallback also failed:', fallbackError.message);
    process.exit(1);
  }
}

try {
  BatchPauseOptimizedUseCase = require('./application/usecases/BatchPauseOptimizedUseCase');
} catch (error) {
  console.warn('[Container] BatchPauseOptimizedUseCase not found');
}

try {
  BatchResumeOptimizedUseCase = require('./application/usecases/BatchResumeOptimizedUseCase');
} catch (error) {
  console.warn('[Container] BatchResumeOptimizedUseCase not found');
}

try {
  DeleteProfileUseCase = require('./application/usecases/DeleteProfileUseCase');
} catch (error) {
  console.warn('[Container] DeleteProfileUseCase not found');
}

try {
  OptimizedDeleteProfileUseCase = require('./application/usecases/OptimizedDeleteProfileUseCase');
} catch (error) {
  console.warn('[Container] OptimizedDeleteProfileUseCase not found');
}

// 개선된 유스케이스 (GOOGLE_LOGIN_SOLUTION_REPORT 기반)
debugLog('[Container] Loading ImprovedPauseSubscriptionUseCase...');
const ImprovedPauseSubscriptionUseCase = require('./application/usecases/ImprovedPauseSubscriptionUseCase');
debugLog('[Container] ImprovedPauseSubscriptionUseCase loaded');
debugLog('[Container] Loading ImprovedResumeSubscriptionUseCase...');
const ImprovedResumeSubscriptionUseCase = require('./application/usecases/ImprovedResumeSubscriptionUseCase');
debugLog('[Container] ImprovedResumeSubscriptionUseCase loaded');

// 백업/복원 유스케이스
debugLog('[Container] Loading backup/restore use cases...');
const TxtBackupUseCase = require('./application/usecases/TxtBackupUseCase');
debugLog('[Container] TxtBackupUseCase loaded');
const TxtBackupUseCaseEnhanced = require('./application/usecases/TxtBackupUseCaseEnhanced');
debugLog('[Container] TxtBackupUseCaseEnhanced loaded');
const TxtBackupUseCaseAdvanced = require('./application/usecases/TxtBackupUseCaseAdvanced');
debugLog('[Container] TxtBackupUseCaseAdvanced loaded');
const TxtRestoreUseCase = require('./application/usecases/TxtRestoreUseCase');
debugLog('[Container] TxtRestoreUseCase loaded');
const TxtBackupUseCaseFinal = require('./application/usecases/TxtBackupUseCaseFinal');
debugLog('[Container] TxtBackupUseCaseFinal loaded');

// 가족요금제 체크 유스케이스
debugLog('[Container] Loading family plan use cases...');
let FamilyPlanCheckUseCase, FamilyPlanCheckUseCaseV2, EnhancedFamilyPlanCheckUseCase;

try {
  FamilyPlanCheckUseCase = require('./application/usecases/FamilyPlanCheckUseCase');
  debugLog('[Container] FamilyPlanCheckUseCase loaded');
} catch (error) {
  console.warn('[Container] FamilyPlanCheckUseCase load failed:', error.message);
}

try {
  FamilyPlanCheckUseCaseV2 = require('./application/usecases/FamilyPlanCheckUseCaseV2');
  debugLog('[Container] FamilyPlanCheckUseCaseV2 loaded');
} catch (error) {
  console.warn('[Container] FamilyPlanCheckUseCaseV2 load failed:', error.message);
}

try {
  EnhancedFamilyPlanCheckUseCase = require('./application/usecases/EnhancedFamilyPlanCheckUseCase');
  debugLog('[Container] EnhancedFamilyPlanCheckUseCase loaded');
} catch (error) {
  console.warn('[Container] EnhancedFamilyPlanCheckUseCase load failed:', error.message);
}

// 레포지토리 - PauseSheet, ResumeSheet, DeleteSheet 추가
debugLog('[Container] Loading sheet repositories...');
let PauseSheetRepository, ResumeSheetRepository, DeleteSheetRepository, FamilyPlanSheetRepository;

try {
  PauseSheetRepository = require('./infrastructure/repositories/PauseSheetRepository');
  debugLog('[Container] PauseSheetRepository loaded');
} catch (error) {
  console.warn('[Container] PauseSheetRepository load failed:', error.message);
}

try {
  ResumeSheetRepository = require('./infrastructure/repositories/ResumeSheetRepository');
  debugLog('[Container] ResumeSheetRepository loaded');
} catch (error) {
  console.warn('[Container] ResumeSheetRepository load failed:', error.message);
}

try {
  DeleteSheetRepository = require('./infrastructure/repositories/DeleteSheetRepository');
  debugLog('[Container] DeleteSheetRepository loaded');
} catch (error) {
  console.warn('[Container] DeleteSheetRepository load failed:', error.message);
}

try {
  FamilyPlanSheetRepository = require('./infrastructure/repositories/FamilyPlanSheetRepository');
  debugLog('[Container] FamilyPlanSheetRepository loaded');
} catch (error) {
  console.warn('[Container] FamilyPlanSheetRepository load failed:', error.message);
}

// 가족요금제 관련 서비스
debugLog('[Container] Loading family plan services...');
let ProxyManagerAdapter, SunbrowserAdapter, FamilyPlanDetectionService;
let GoogleAuthService, ProxySwitchService, YouTubeFamilyPlanService, FamilyPlanWorkflowService;

try {
  ProxyManagerAdapter = require('./infrastructure/adapters/ProxyManagerAdapter');
  debugLog('[Container] ProxyManagerAdapter loaded');
} catch (error) {
  console.warn('[Container] ProxyManagerAdapter load failed:', error.message);
}

try {
  SunbrowserAdapter = require('./infrastructure/adapters/SunbrowserAdapter');
  debugLog('[Container] SunbrowserAdapter loaded');
} catch (error) {
  console.warn('[Container] SunbrowserAdapter load failed:', error.message);
}

try {
  FamilyPlanDetectionService = require('./services/FamilyPlanDetectionService');
  debugLog('[Container] FamilyPlanDetectionService loaded');
} catch (error) {
  console.warn('[Container] FamilyPlanDetectionService load failed:', error.message);
}

try {
  GoogleAuthService = require('./services/GoogleAuthService');
  debugLog('[Container] GoogleAuthService loaded');
} catch (error) {
  console.warn('[Container] GoogleAuthService load failed:', error.message);
}

try {
  ProxySwitchService = require('./services/ProxySwitchService');
  debugLog('[Container] ProxySwitchService loaded');
} catch (error) {
  console.warn('[Container] ProxySwitchService load failed:', error.message);
}

try {
  YouTubeFamilyPlanService = require('./services/YouTubeFamilyPlanService');
  debugLog('[Container] YouTubeFamilyPlanService loaded');
} catch (error) {
  console.warn('[Container] YouTubeFamilyPlanService load failed:', error.message);
}

try {
  FamilyPlanWorkflowService = require('./services/FamilyPlanWorkflowService');
  debugLog('[Container] FamilyPlanWorkflowService loaded');
} catch (error) {
  console.warn('[Container] FamilyPlanWorkflowService load failed:', error.message);
}

// 네트워크 진단 서비스
const NetworkDiagnosticService = require('./services/NetworkDiagnosticService');

// 인증 서비스
const AuthenticationService = require('./services/AuthenticationService');
const ImprovedAuthenticationService = require('./services/ImprovedAuthenticationService');
const ImprovedAccountChooserHandler = require('./services/ImprovedAccountChooserHandler');
const AntiCaptchaService = require('./services/AntiCaptchaService');

// 네비게이션 및 언어 서비스
const NavigationService = require('./services/NavigationService');
const LanguageService = require('./services/LanguageService');
const ButtonInteractionService = require('./services/ButtonInteractionService');
const PopupService = require('./services/PopupService');

// AdsPower ID 매핑 서비스
const AdsPowerIdMappingService = require('./services/AdsPowerIdMappingService');
debugLog('[Container] AdsPowerIdMappingService loaded');

// 날짜 파싱 서비스
const EnhancedDateParsingService = require('./services/EnhancedDateParsingService');

// 스케줄링 서비스
const SchedulerService = require('./services/SchedulerService');

// 시간체크 통합 워커 관련 서비스
const TimeFilterService = require('./services/TimeFilterService');
const WorkerLockService = require('./services/WorkerLockService');
const ScheduledSubscriptionWorkerUseCase = require('./application/usecases/ScheduledSubscriptionWorkerUseCase');

// 세션 로그 서비스 (스크린샷 + 로그 통합 관리)
const SessionLogService = require('./services/SessionLogService');

// 설정 관리 서비스 (Google Sheets '설정' 탭)
const ConfigRepository = require('./infrastructure/repositories/ConfigRepository');
const SharedConfig = require('./services/SharedConfig');

// 병렬 처리 및 모니터링 서비스 (Day 9-10)
const ParallelBatchProcessor = require('./services/ParallelBatchProcessor');
const RealTimeMonitoringDashboard = require('./services/RealTimeMonitoringDashboard');
const ParallelFamilyPlanCheckUseCase = require('./application/usecases/ParallelFamilyPlanCheckUseCase');

// IP 및 프록시 관련 서비스
const ProxyRotationService = require('./services/ProxyRotationService');
const IPService = require('./services/IPService');
const HashBasedProxyMappingService = require('./services/HashBasedProxyMappingService');
const ProxySheetRepository = require('./infrastructure/repositories/ProxySheetRepository');

// 가족 요금제 기존 계정 확인 UseCase
const ExistingFamilyPlanCheckUseCase = require('./application/usecases/ExistingFamilyPlanCheckUseCase');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 백업카드 변경 관련 (Phase 1-6)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
debugLog('[Container] Loading backup card modules...');
const BackupCardChangeUseCase = require('./application/usecases/BackupCardChangeUseCase');
const BackupCardSheetRepository = require('./infrastructure/repositories/BackupCardSheetRepository');
const BackupCardService = require('./services/BackupCardService');
const YouTubePaymentAdapter = require('./infrastructure/adapters/YouTubePaymentAdapter');
const ErrorClassifier = require('./utils/ErrorClassifier');
const backupCardMultiLanguage = require('./infrastructure/config/backup-card-multilanguage');
debugLog('[Container] Backup card modules loaded');

/**
 * 비동기 레포지토리 래퍼 - 지연 초기화 패턴
 */
function createLazyRepository(RepositoryClass, config) {
  return asFunction(() => {
    const instance = new RepositoryClass(config);
    let initPromise = null;
    
    // 초기화를 지연시키는 프록시 생성
    const proxy = new Proxy(instance, {
      get(target, prop) {
        // 초기화가 필요한 메서드들
        const methodsNeedingInit = [
          'getAll', 'getById', 'save', 'update', 'delete',
          'getAdsPowerProfiles', 'getPauseList', 'getResumeList',
          'getPauseTargets', 'getResumeTargets',
          'updatePauseStatus', 'updateResumeStatus',
          'updatePauseResult', 'updateResumeResult',
          'createProfileMapping', 'getPauseTasksWithMapping',
          'getResumeTasksWithMapping',
          // 프록시 Repository 메서드
          'getProxiesByCountry', 'getAllProxies', 'updateProxyUsage',
          'incrementFailureCount', 'resetFailureCount', 'getProxyStats'
        ];
        
        if (methodsNeedingInit.includes(prop) && typeof target[prop] === 'function') {
          return async function(...args) {
            // 초기화가 아직 안 되었으면 초기화 시도
            if (!target.initialized && !initPromise) {
              initPromise = target.initialize().catch(err => {
                console.warn(`[Container] Repository initialization failed: ${err.message}`);
                debugLog('[Container] Repository will work in limited mode');
                target.initialized = true; // 실패해도 계속 진행
              });
            }
            
            if (initPromise) {
              await initPromise;
            }
            
            return target[prop].apply(target, args);
          };
        }
        
        return target[prop];
      }
    });
    
    return proxy;
  }).singleton();
}

/**
 * 컨테이너 생성 및 설정
 */
function setupContainer(initialConfig = {}) {
  const container = createContainer();
  const config = initialConfig;  // config를 로컬 변수로 저장

  // Google Sheets 설정 서비스가 있으면 등록
  if (GoogleSheetsConfigService) {
    container.register({
      googleSheetsConfigService: asClass(GoogleSheetsConfigService).singleton()
    });
  }

  // 설정 등록 (GoogleSheetsConfigService의 동적 설정 지원)
  container.register({
    config: asFunction(({ googleSheetsConfigService }) => {
      let activeSheetId = config.googleSheetsId || process.env.GOOGLE_SHEETS_ID;
      let activeSheetPath = config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json');

      // GoogleSheetsConfigService가 있으면 활성 시트 정보 사용
      if (googleSheetsConfigService) {
        // 동기적으로 처리하기 위해 Promise를 사용하지 않고 초기값 사용
        // 실제 시트 선택은 CLI에서 처리
      }

      return {
        adsPowerApiUrl: config.adsPowerApiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
        googleSheetsId: activeSheetId,
        serviceAccountPath: activeSheetPath,
        debugMode: config.debugMode || false,
        // v4.0 - stealthMode 제거 (AdsPower 기본 기능 사용)
        ...config
      };
    }).singleton(),

    // 로거 (새로운 LoggerAdapter 시스템)
    logger: asFunction(() => {
      return new LoggerAdapter({
        baseDir: config.logDir || path.join(path.join(__dirname, '..'), 'logs'),
        enableConsole: config.enableConsoleLog !== false,
        enableFile: config.enableFileLog !== false,
        level: config.logLevel || 'INFO'
      });
    }).singleton(),

    // 인프라 어댑터 (v4.0 - AdsPowerAdapterMinimal 사용, stealthMode 제거)
    adsPowerAdapter: asClass(AdsPowerAdapter)
      .singleton()
      .inject(() => ({
        apiUrl: config.adsPowerApiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325',
        debugMode: config.debugMode || false,
        // v4.0 - stealthMode 제거 (AdsPower가 모든 anti-detection 처리)
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

    // 레포지토리 (지연 초기화 패턴 적용)
    profileRepository: createLazyRepository(GoogleSheetsProfileRepository, {
      spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
      sheetName: '애즈파워현황'
    }),

    // Enhanced Google Sheets 레포지토리 (지연 초기화)
    enhancedSheetsRepository: createLazyRepository(EnhancedGoogleSheetsRepository, {
      spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath
    }),

    // Google Sheets Repository 별칭 (InviteLinkCheckUseCase를 위해 추가)
    googleSheetsRepository: asFunction(() => {
      return container.resolve("enhancedSheetsRepository");
    }).singleton(),


    // 워크플로우 레포지토리 (임시 - 메모리)
    workflowRepository: asValue({
      workflows: new Map(),
      async save(workflow) {
        this.workflows.set(workflow.id, workflow);
        return workflow;
      },
      async findById(id) {
        return this.workflows.get(id) || null;
      },
      async findByProfileId(profileId) {
        const results = [];
        for (const [id, workflow] of this.workflows) {
          if (workflow.profileId === profileId) {
            results.push(workflow);
          }
        }
        return results;
      }
    }),

    // 도메인 서비스
    youtubePremiumService: asClass(YouTubePremiumService)
      .inject(() => ({
        repositories: {
          subscriptionRepository: container.resolve('subscriptionRepository'),
          workflowRepository: container.resolve('workflowRepository')
        }
      })),

    // 구독 레포지토리 (임시 - 메모리)
    subscriptionRepository: asValue({
      subscriptions: new Map(),
      async save(subscription) {
        this.subscriptions.set(subscription.id, subscription);
        return subscription;
      },
      async findById(id) {
        return this.subscriptions.get(id) || null;
      },
      async findByProfileId(profileId) {
        for (const [id, subscription] of this.subscriptions) {
          if (subscription.profileId === profileId) {
            return subscription;
          }
        }
        return null;
      }
    }),

    // 세션 로거 추가
    sessionLogger: asClass(SessionLogger)
      .singleton(),
    
    // 상세 에러 로거 추가
    detailedErrorLogger: asClass(DetailedErrorLogger)
      .singleton(),
    
    // 안전 종료 핸들러 추가
    gracefulShutdown: asClass(GracefulShutdown)
      .singleton()
      .inject(() => ({
        sessionLogger: container.resolve('sessionLogger')
      })),

    // 네트워크 진단 서비스 추가
    networkDiagnosticService: asFunction(() => {
      return new NetworkDiagnosticService({
        debugMode: config.debugMode || false,
        timeout: config.networkTimeout || 10000,
        retryAttempts: config.networkRetryAttempts || 3
      });
    }).singleton(),

    // 에러 핸들링 서비스 추가
    errorHandlingService: asClass(ErrorHandlingService)
      .singleton()
      .inject(() => ({
        logger: container.resolve('logger')
      })),

    // 인증 서비스 추가 (개선된 버전 - 계정 선택 페이지 처리 포함)
    // v2.17: sessionLogService 주입으로 로그인 단계별 로깅 지원
    authService: asFunction(({ sessionLogService }) => {
      // 개선된 버전 사용 여부 확인
      const useImprovedAuth = config.useImprovedAuth !== false;

      if (useImprovedAuth) {
        return new ImprovedAuthenticationService({
          sessionLogService, // v2.17: 로그인 단계별 스크린샷
          debugMode: config.debugMode || false,
          loginCheckTimeout: config.loginCheckTimeout || 10000,
          recaptchaTimeout: config.recaptchaTimeout || 30000,
          sessionTimeout: config.sessionTimeout || 3600000,
          maxLoginAttempts: config.maxLoginAttempts || 3,
          screenshotEnabled: config.screenshotEnabled !== false,
          humanLikeMotion: config.humanLikeMotion !== false
        });
      } else {
        return new AuthenticationService({
          debugMode: config.debugMode || false,
          loginCheckTimeout: config.loginCheckTimeout || 10000,
          recaptchaTimeout: config.recaptchaTimeout || 30000,
          sessionTimeout: config.sessionTimeout || 3600000,
          maxLoginAttempts: config.maxLoginAttempts || 3
        });
      }
    }).singleton(),

    // authenticationService alias for compatibility
    // v2.17: sessionLogService 주입으로 로그인 단계별 로깅 지원
    authenticationService: asFunction(({ sessionLogService }) => {
      const useImprovedAuth = config.useImprovedAuth !== false;

      if (useImprovedAuth) {
        return new ImprovedAuthenticationService({
          sessionLogService, // v2.17: 로그인 단계별 스크린샷
          debugMode: config.debugMode || false,
          loginCheckTimeout: config.loginCheckTimeout || 10000,
          recaptchaTimeout: config.recaptchaTimeout || 30000,
          sessionTimeout: config.sessionTimeout || 3600000,
          maxLoginAttempts: config.maxLoginAttempts || 3,
          screenshotEnabled: config.screenshotEnabled !== false,
          humanLikeMotion: config.humanLikeMotion !== false
        });
      } else {
        return new AuthenticationService({
          debugMode: config.debugMode || false,
          loginCheckTimeout: config.loginCheckTimeout || 10000,
          recaptchaTimeout: config.recaptchaTimeout || 30000,
          sessionTimeout: config.sessionTimeout || 3600000,
          maxLoginAttempts: config.maxLoginAttempts || 3
        });
      }
    }).singleton(),
    
    // 계정 선택 핸들러 (단독 사용 가능)
    accountChooserHandler: asFunction(() => {
      return ImprovedAccountChooserHandler;
    }).singleton(),

    // Anti-Captcha 서비스 (이미지 CAPTCHA 자동 해결)
    antiCaptchaService: asFunction(() => {
      return new AntiCaptchaService({
        apiKey: process.env.ANTI_CAPTCHA_API_KEY,
        debugMode: config.debugMode || false,
        maxWaitTime: 120000,  // 2분
        manualWaitTime: 60000  // 1분
      });
    }).singleton(),

    // 향상된 날짜 파싱 서비스 추가
    dateParser: asFunction(() => {
      return new EnhancedDateParsingService({
        debugMode: config.debugMode || false,
        logger: container.resolve('logger')
      });
    }).singleton(),
    
    // 스케줄링 서비스 추가
    schedulerService: asClass(SchedulerService)
      .singleton()
      .inject(() => ({
        logger: container.resolve('logger')
      })),
    
    // 네비게이션 서비스 추가
    navigationService: asFunction(() => {
      const config = container.resolve('config');
      const logger = container.resolve('logger');
      const popupService = container.resolve('popupService');
      return new NavigationService({
        debugMode: config.debugMode || false,
        logger: logger,
        popupService: popupService
      });
    }).singleton(),
      
    // 언어 서비스 추가
    languageService: asFunction(() => {
      const config = container.resolve('config');
      return new LanguageService({
        debugMode: config.debugMode || false,
        defaultLanguage: config.defaultLanguage || 'en',
        detectTimeout: config.detectTimeout || 5000
      });
    }).singleton(),

    // 버튼 상호작용 서비스 추가
    buttonService: asFunction(() => {
      const config = container.resolve('config');
      return new ButtonInteractionService({
        debugMode: config.debugMode || false
      });
    }).singleton(),

    // 팝업 서비스 추가
    popupService: asFunction(() => {
      const config = container.resolve('config');
      return new PopupService({
        debugMode: config.debugMode || false
      });
    }).singleton(),

    // AdsPower ID 매핑 서비스 추가
    adsPowerIdMappingService: asFunction(() => {
      const profileRepository = container.resolve('profileRepository');
      const logger = container.resolve('logger');
      return new AdsPowerIdMappingService({
        googleSheetsProfileRepository: profileRepository,
        logger: logger
      });
    }).singleton(),

    // Google Sheets Profile Repository 별칭 (매핑 서비스용)
    googleSheetsProfileRepository: asFunction(() => {
      return container.resolve('profileRepository');
    }).singleton(),

    // 브라우저 컨트롤러 추가
    browserController: asClass(BrowserController)
      .inject(() => ({
        debugMode: container.resolve('config').debugMode || false,
        stealthMode: container.resolve('config').stealthMode !== false
      })),

    // PauseSheet 레포지토리 추가 (싱글톤으로 수정)
    pauseSheetRepository: asFunction(() => {
      const instance = new PauseSheetRepository();
      // config는 생성자가 받지 않으므로 직접 initialize에서 환경변수로 처리
      return instance;
    }).singleton(),

    // ResumeSheet 레포지토리 추가 (지연 초기화)
    resumeSheetRepository: createLazyRepository(ResumeSheetRepository, {
      spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
      serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json')
    }),

    // DeleteSheet 레포지토리 추가 (지연 초기화)
    deleteSheetRepository: asFunction(() => {
      const config = container.resolve('config');
      const logger = container.resolve('logger');
      return new DeleteSheetRepository({
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json'),
        logger: logger
      });
    }).singleton(),

    // 애플리케이션 유스케이스

    // Enhanced 일시중지 유스케이스 (새로운 버전)
    enhancedPauseSubscriptionUseCase: asClass(EnhancedPauseSubscriptionUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        logger: container.resolve('logger'),
        sessionLogger: container.resolve('sessionLogger'),
        detailedErrorLogger: container.resolve('detailedErrorLogger'),
        config: container.resolve('config'),
        dateParser: container.resolve('dateParser'),  // 날짜 파싱 서비스 주입
        buttonService: container.resolve('buttonService'),  // ButtonInteractionService 주입
        mappingService: container.resolve('adsPowerIdMappingService'),  // AdsPowerIdMappingService 주입
        hashProxyMapper: container.resolve('hashProxyMapper'),  // 해시 기반 프록시 매핑 서비스 주입
        sessionLogService: container.resolve('sessionLogService'),  // 세션 로그 서비스 주입
        sharedConfig: container.resolve('sharedConfig')  // 설정 서비스 주입
      })),

    // 갱신확인 일시중지 유스케이스
    renewalCheckPauseUseCase: RenewalCheckPauseUseCase ? asClass(RenewalCheckPauseUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        logger: container.resolve('logger'),
        sessionLogger: container.resolve('sessionLogger'),
        detailedErrorLogger: container.resolve('detailedErrorLogger'),
        config: container.resolve('config'),
        dateParser: container.resolve('dateParser'),  // 날짜 파싱 서비스 주입
        buttonService: container.resolve('buttonService'),  // ButtonInteractionService 주입
        mappingService: container.resolve('adsPowerIdMappingService')  // AdsPowerIdMappingService 주입
      })) : null,

    // Enhanced 재개 유스케이스 (새로운 버전)
    enhancedResumeSubscriptionUseCase: EnhancedResumeSubscriptionUseCase ? asClass(EnhancedResumeSubscriptionUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        authService: container.resolve('authService'),  // 인증 서비스 주입
        errorHandlingService: container.resolve('errorHandlingService'),  // 에러 핸들링 서비스 주입
        logger: container.resolve('logger'),
        sessionLogger: container.resolve('sessionLogger'),
        detailedErrorLogger: container.resolve('detailedErrorLogger'),
        config: container.resolve('config'),
        dateParser: container.resolve('dateParser'),  // 날짜 파싱 서비스 주입
        adsPowerIdMappingService: container.resolve('adsPowerIdMappingService'),  // AdsPower ID 매핑 서비스 주입
        hashProxyMapper: container.resolve('hashProxyMapper'),  // 해시 기반 프록시 매핑 서비스 주입
        sessionLogService: container.resolve('sessionLogService'),  // 세션 로그 서비스 주입
        sharedConfig: container.resolve('sharedConfig')  // 설정 서비스 주입
      })) : asClass(ImprovedResumeSubscriptionUseCase).inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        authService: container.resolve('authService'),  // 인증 서비스 주입
        errorHandlingService: container.resolve('errorHandlingService'),  // 에러 핸들링 서비스 주입
        logger: container.resolve('logger'),
        sessionLogger: container.resolve('sessionLogger'),
        detailedErrorLogger: container.resolve('detailedErrorLogger'),
        config: container.resolve('config'),
        dateParser: container.resolve('dateParser')
      })),

    // 배치 일시중지 최적화 유스케이스
    batchPauseOptimizedUseCase: asClass(BatchPauseOptimizedUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        pauseUseCase: container.resolve('enhancedPauseSubscriptionUseCase'),
        sheetsRepository: container.resolve('enhancedSheetsRepository'),
        logger: container.resolve('logger')
      })),

    // 배치 재개 최적화 유스케이스
    batchResumeOptimizedUseCase: asClass(BatchResumeOptimizedUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        resumeUseCase: container.resolve('enhancedResumeSubscriptionUseCase'),
        sheetsRepository: container.resolve('enhancedSheetsRepository'),
        logger: container.resolve('logger')
      })),

    // 개선된 일시중지 유스케이스 (GOOGLE_LOGIN_SOLUTION_REPORT 기반)
    improvedPauseSubscriptionUseCase: asClass(ImprovedPauseSubscriptionUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        logger: container.resolve('logger')
      })),

    // 개선된 재개 유스케이스 (GOOGLE_LOGIN_SOLUTION_REPORT 기반)
    improvedResumeSubscriptionUseCase: asClass(ImprovedResumeSubscriptionUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubeAdapter: container.resolve('youtubeAdapter'),
        profileRepository: container.resolve('profileRepository'),
        pauseSheetRepository: container.resolve('pauseSheetRepository'),
        logger: container.resolve('logger'),
        adsPowerIdMappingService: container.resolve('adsPowerIdMappingService')  // AdsPower ID 매핑 서비스 추가
      })),

    // 언어 독립적 Universal 재개 유스케이스
    universalResumeSubscriptionUseCase: asClass(require('./application/usecases/UniversalResumeSubscriptionUseCase'))
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        sheetsRepository: container.resolve('enhancedSheetsRepository'),
        logger: container.resolve('logger'),
        dateParser: container.resolve('dateParser'),
        languageService: container.resolve('languageService'),
        navigationService: container.resolve('navigationService'),
        buttonService: container.resolve('buttonService'),
        ipService: container.resolve('ipService'),
        popupService: container.resolve('popupService'),
        authService: container.resolve('authService'),
        config: container.resolve('config')
      })),

    // 백업/복원 유스케이스
    txtBackupUseCase: asClass(TxtBackupUseCase)
      .inject(() => ({
        googleSheetsRepository: container.resolve('profileRepository'),
        logger: container.resolve('logger')
      })),

    // 향상된 백업 유스케이스 (중복 ID 처리 포함)
    txtBackupUseCaseEnhanced: asClass(TxtBackupUseCaseEnhanced)
      .inject(() => ({
        googleSheetsRepository: container.resolve('profileRepository'),
        logger: container.resolve('logger')
      })),

    // 고급 백업 유스케이스 (날짜 우선순위 & 정렬)
    txtBackupUseCaseAdvanced: asClass(TxtBackupUseCaseAdvanced)
      .inject(() => ({
        googleSheetsRepository: container.resolve('profileRepository'),
        logger: container.resolve('logger')
      })),

    // 최종 백업 유스케이스 (Sheets 내 중복 처리)
    txtBackupUseCaseFinal: asClass(TxtBackupUseCaseFinal)
      .inject(() => ({
        googleSheetsRepository: container.resolve('profileRepository'),
        logger: container.resolve('logger')
      })),
    txtRestoreUseCase: asClass(TxtRestoreUseCase)
      .inject(() => ({
        googleSheetsRepository: container.resolve('profileRepository'),
        logger: container.resolve('logger')
      })),

    // 프로필 삭제 유스케이스 (기존 - 호환성용)
    deleteProfileUseCaseLegacy: asClass(DeleteProfileUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        deleteSheetRepository: container.resolve('deleteSheetRepository'),
        logger: container.resolve('logger'),
        config: container.resolve('config')
      })),
    
    // 최적화된 프로필 삭제 유스케이스 (기본)
    deleteProfileUseCase: asClass(OptimizedDeleteProfileUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        deleteSheetRepository: container.resolve('deleteSheetRepository'),
        logger: container.resolve('logger')
      })),

    // 가족요금제 체크 유스케이스 (조건부 등록)
    // [v2.23] hashProxyMapper 의존성 추가
    ...(FamilyPlanCheckUseCase ? {
      familyPlanCheckUseCase: asClass(FamilyPlanCheckUseCase)
        .inject(() => ({
          adsPowerAdapter: container.resolve('adsPowerAdapter'),
          browserController: container.resolve('browserController'),
          googleSheetsRepository: container.resolve('familyPlanSheetRepository'),
          proxyManager: container.resolve('proxyManager'),
          familyPlanDetector: container.resolve('familyPlanDetector'),
          logger: container.resolve('logger'),
          config: container.resolve('config'),
          hashProxyMapper: container.resolve('hashProxyMapper')
        }))
    } : {}),

    // 가족요금제 체크 V2 (향상된 버전) - 조건부 등록
    ...(FamilyPlanCheckUseCaseV2 ? {
      familyPlanCheckUseCaseV2: asClass(FamilyPlanCheckUseCaseV2)
        .inject(() => ({
          sunbrowserAdapter: container.resolve('sunbrowserAdapter'),
          adsPowerAdapter: container.resolve('adsPowerAdapter'),
          proxyManagerAdapter: container.resolve('proxyManager'),
          proxySwitchService: container.resolve('proxySwitchService'),
          googleAuthService: container.resolve('googleAuthService'),
          familyPlanSheetRepository: container.resolve('familyPlanSheetRepository'),
          familyPlanDetector: container.resolve('familyPlanDetector'),
          logger: container.resolve('logger'),
          config: container.resolve('config')
        }))
    } : {}),

    // 향상된 가족요금제 체크 (Windows 11 프로필 + TOTP) - 조건부 등록
    ...(EnhancedFamilyPlanCheckUseCase ? {
      enhancedFamilyPlanCheckUseCase: asClass(EnhancedFamilyPlanCheckUseCase)
        .inject(() => ({
          adsPowerAdapter: container.resolve('adsPowerAdapter'),
          browserController: container.resolve('browserController'),
          googleSheetsRepository: container.resolve('googleSheetsRepository'),
          familyPlanSheetRepository: container.resolve('familyPlanSheetRepository'),
          familyPlanDetectionService: container.resolve('familyPlanDetectionService'),
          authService: container.resolve('authService'),
          hashProxyMapper: container.resolve('hashProxyMapper'),  // 프록시 시트에서 프록시 가져오기
          proxyManager: container.resolve('proxyManager'),        // 프록시 풀 상태 확인용
          logger: container.resolve('logger'),
          config: container.resolve('config')
        }))
    } : {}),

    // 가족요금제 관련 서비스
    // [v2.23] hashProxyMapper 의존성 추가
    ...(ProxyManagerAdapter ? {
      proxyManager: asClass(ProxyManagerAdapter)
        .inject(() => ({
          adsPowerUrl: container.resolve('config').adsPowerUrl,
          debugMode: container.resolve('config').debugMode,
          hashProxyMapper: container.resolve('hashProxyMapper')
        }))
    } : {}),

    ...(SunbrowserAdapter ? {
      sunbrowserAdapter: asClass(SunbrowserAdapter)
        .inject(() => ({
          apiUrl: container.resolve('config').adsPowerUrl || 'http://local.adspower.net:50325',
          timeout: container.resolve('config').navigationTimeout || 30000,
          retryAttempts: container.resolve('config').maxRetries || 3,
          retryDelay: container.resolve('config').retryDelay || 2000,
          debugMode: container.resolve('config').debugMode,
          familyPlanGroupId: container.resolve('config').familyPlanGroupId || 'family_plan_group'
        }))
    } : {}),

    ...(FamilyPlanDetectionService ? {
      familyPlanDetector: asClass(FamilyPlanDetectionService)
        .inject(() => ({
          debugMode: container.resolve('config').debugMode
        })),
      
      // Alias for compatibility
      familyPlanDetectionService: asClass(FamilyPlanDetectionService)
        .inject(() => ({
          debugMode: container.resolve('config').debugMode
        }))
    } : {}),
    
    // 중복 제거 - familyPlanCheckUseCase는 위에서 이미 조건부로 등록함

    familyPlanSheetRepository: asFunction(() => {
      const config = container.resolve('config');
      
      // Mock 모드 체크
      if (process.env.USE_MOCK_REPOSITORY === 'true') {
        // Mock 모드에서는 MockRepository 사용
        const MockRepository = require('./infrastructure/repositories/MockGoogleSheetsRepository');
        return new MockRepository(config);
      }
      
      const serviceAccountPath = config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json');
      
      // credentials 파일 존재 체크
      const fs = require('fs');
      if (!fs.existsSync(serviceAccountPath)) {
        console.warn('[Container] FamilyPlanSheetRepository: Service account file not found, using mock');
        const MockRepository = require('./infrastructure/repositories/MockGoogleSheetsRepository');
        return new MockRepository(config);
      }
      
      const credentials = require(serviceAccountPath);
      
      const repository = new FamilyPlanSheetRepository({
        credentials,
        sheetsId: config.googleSheetsId,
        debugMode: config.debugMode
      });
      
      // Proxy를 통해 자동 초기화 처리
      return new Proxy(repository, {
        get(target, prop) {
          // 메서드 호출 시 자동으로 초기화
          if (typeof target[prop] === 'function' && prop !== 'initialize') {
            return async function(...args) {
              if (!target.auth || !target.sheets) {
                await target.initialize();
              }
              return target[prop].apply(target, args);
            };
          }
          return target[prop];
        }
      });
    }).singleton(),

    // Google 인증 서비스
    googleAuthService: asClass(GoogleAuthService)
      .inject(() => ({
        debugMode: container.resolve('config').debugMode,
        maxRetries: container.resolve('config').maxRetries || 3,
        humanTypingDelay: { min: 50, max: 150 }
      })),

    // 프록시 전환 서비스
    proxySwitchService: asClass(ProxySwitchService)
      .inject(() => ({
        sunbrowserAdapter: container.resolve('sunbrowserAdapter'),
        proxyManager: container.resolve('proxyManager'),
        logger: container.resolve('logger')
      })),

    // YouTube Family Plan 체크 서비스
    youtubeFamilyPlanService: asClass(YouTubeFamilyPlanService)
      .inject(() => ({
        debugMode: container.resolve('config').debugMode,
        screenshotDir: container.resolve('config').screenshotDir || 'screenshots/family-plan'
      })),

    // Family Plan 전체 워크플로우 서비스
    familyPlanWorkflowService: asClass(FamilyPlanWorkflowService)
      .inject(() => ({
        sunbrowserAdapter: container.resolve('sunbrowserAdapter'),
        googleAuthService: container.resolve('googleAuthService'),
        proxySwitchService: container.resolve('proxySwitchService'),
        youtubeFamilyPlanService: container.resolve('youtubeFamilyPlanService'),
        familyPlanSheetRepository: container.resolve('familyPlanSheetRepository'),
        browserController: container.resolve('browserController'),
        logger: container.resolve('logger'),
        config: container.resolve('config')
      })),

    // Day 9-10: 병렬 처리 및 모니터링
    parallelBatchProcessor: asClass(ParallelBatchProcessor)
      .inject(() => ({
        maxConcurrency: container.resolve('config').maxConcurrency || 5,
        retryAttempts: container.resolve('config').retryAttempts || 3,
        retryDelay: container.resolve('config').retryDelay || 5000,
        debugMode: container.resolve('config').debugMode
      })),

    realTimeMonitoringDashboard: asClass(RealTimeMonitoringDashboard)
      .inject(() => ({
        refreshInterval: 1000,
        title: 'YouTube Family Plan Check Monitor',
        showGrid: true
      })),

    parallelFamilyPlanCheckUseCase: asClass(ParallelFamilyPlanCheckUseCase)
      .inject(() => ({
        familyPlanWorkflowService: container.resolve('familyPlanWorkflowService'),
        parallelBatchProcessor: container.resolve('parallelBatchProcessor'),
        familyPlanSheetRepository: container.resolve('familyPlanSheetRepository'),
        sunbrowserAdapter: container.resolve('sunbrowserAdapter'),
        proxyManager: container.resolve('proxyManager'),
        logger: container.resolve('logger')
      })),

    // IP 서비스 등록
    ipService: asFunction(() => {
      return new IPService({
        debugMode: config.debugMode || false,
        adsPowerUrl: config.adsPowerApiUrl || 'http://local.adspower.net:50325'
      });
    }).singleton(),

    // 프록시 로테이션 서비스 등록
    // [v2.23] hashProxyMapper 의존성 주입 추가
    proxyRotationService: asFunction(() => {
      return new ProxyRotationService({
        debugMode: config.debugMode || false,
        adsPowerUrl: config.adsPowerApiUrl || 'http://local.adspower.net:50325',
        hashProxyMapper: container.resolve('hashProxyMapper')
      });
    }).singleton(),

    // 프록시 시트 Repository 등록 (Lazy Proxy Pattern)
    proxySheetRepository: createLazyRepository(
      ProxySheetRepository,
      {
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json')
      }
    ),

    // 해시 기반 프록시 매핑 서비스 등록
    hashProxyMapper: asFunction(() => {
      return new HashBasedProxyMappingService({
        proxySheetRepository: container.resolve('proxySheetRepository'),
        logger: container.resolve('logger')
      });
    }).singleton(),

    // 가족 요금제 기존 계정 확인 UseCase 등록
    existingFamilyPlanCheckUseCase: asClass(ExistingFamilyPlanCheckUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        sheetsRepository: container.resolve('enhancedSheetsRepository'),
        proxyRotationService: container.resolve('proxyRotationService'),
        ipService: container.resolve('ipService'),
        authService: container.resolve('authService'),
        languageService: container.resolve('languageService'),
        navigationService: container.resolve('navigationService'),
        buttonService: container.resolve('buttonService'),
        popupService: container.resolve('popupService'),
        logger: container.resolve('logger'),
        config: container.resolve('config')
      })),

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 백업카드 변경 관련 서비스 (Phase 1-7)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ErrorClassifier (백업카드 에러 분류)
    errorClassifier: asFunction(() => {
      return new ErrorClassifier();
    }).singleton(),

    // BackupCardSheetRepository (Lazy Proxy Pattern)
    backupCardRepository: createLazyRepository(
      BackupCardSheetRepository,
      {
        spreadsheetId: config.googleSheetsId || process.env.GOOGLE_SHEETS_ID,
        serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json')
      }
    ),

    // BackupCardService (Singleton)
    backupCardService: asClass(BackupCardService)
      .singleton()
      .inject(() => ({
        backupCardRepository: container.resolve('backupCardRepository'),
        logger: container.resolve('logger')
      })),

    // YouTubePaymentAdapter (Scoped - page는 런타임에 주입)
    youtubePaymentAdapter: asFunction(() => {
      // YouTubePaymentAdapter는 page가 런타임에 주입되므로 Factory 패턴 사용
      const logger = container.resolve('logger');
      const languageService = container.resolve('languageService');
      const buttonService = container.resolve('buttonService');
      const navigationService = container.resolve('navigationService');
      const backupCardService = container.resolve('backupCardService');
      const popupService = container.resolve('popupService');

      return new YouTubePaymentAdapter({
        page: null, // 런타임에 설정됨
        logger,
        languageService,
        buttonService,
        navigationService,
        backupCardService,
        popupService,
        multiLanguageTexts: backupCardMultiLanguage
      });
    }).scoped(),

    // BackupCardChangeUseCase (Scoped)
    backupCardChangeUseCase: asClass(BackupCardChangeUseCase)
      .scoped()
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        youtubePaymentAdapter: container.resolve('youtubePaymentAdapter'),
        backupCardRepository: container.resolve('backupCardRepository'),
        logger: container.resolve('logger'),
        sessionLogger: container.resolve('sessionLogger'),
        detailedErrorLogger: container.resolve('detailedErrorLogger'),
        dateParser: container.resolve('dateParser'),
        buttonService: container.resolve('buttonService'),
        navigationService: container.resolve('navigationService'),
        authService: container.resolve('authService'),
        backupCardService: container.resolve('backupCardService'),
        ipService: container.resolve('ipService'),
        languageService: container.resolve('languageService'),
        popupService: container.resolve('popupService'),
        errorClassifier: container.resolve('errorClassifier')
      })),

    // 배치 작업 관리자 (싱글톤)
    batchJobManager: asFunction(() => {
      const BatchJobManager = require('./services/BatchJobManager');
      return BatchJobManager.getInstance();
    }).singleton(),

    // 강화된 배치 처리 UseCase
    enhancedBatchProcessingUseCase: asClass(require('./application/usecases/EnhancedBatchProcessingUseCase'))
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        pauseUseCase: container.resolve('enhancedPauseSubscriptionUseCase'),
        resumeUseCase: container.resolve('enhancedResumeSubscriptionUseCase'),
        sheetsRepository: container.resolve('enhancedSheetsRepository'),
        logger: container.resolve('logger')
      })),

    // 배치 모니터 대시보드 (싱글톤)
    batchMonitorDashboard: asClass(require('./presentation/cli/BatchMonitorDashboard')).singleton(),

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 시간체크 통합 구독관리 워커 시스템
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 설정 저장소 (Google Sheets '설정' 탭)
    configRepository: asClass(ConfigRepository)
      .singleton()
      .inject(() => ({
        logger: container.resolve('logger')
      })),

    // 설정 캐싱 서비스 (5분 자동 동기화)
    sharedConfig: asFunction(({ configRepository, logger }) => {
      const sharedConfig = new SharedConfig({
        configRepository,
        logger,
        syncIntervalMs: 5 * 60 * 1000  // 5분
      });
      // 비동기 초기화는 사용 시점에 수행
      return sharedConfig;
    }).singleton(),

    // 시간 필터링 서비스 (KST 기준 시간 조건 필터링)
    timeFilterService: asFunction(() => {
      return new TimeFilterService({
        logger: container.resolve('logger'),
        debugMode: config.debugMode || false
      });
    }).singleton(),

    // 워커 잠금 서비스 (분산 작업 충돌 방지)
    workerLockService: asFunction(() => {
      return new WorkerLockService({
        sheetsRepository: container.resolve('pauseSheetRepository'),
        logger: container.resolve('logger'),
        debugMode: config.debugMode || false,
        lockExpiryMinutes: container.resolve('sharedConfig').getLockExpiryMinutes()
      });
    }).singleton(),

    // 세션 로그 서비스 (스크린샷 + 로그 통합 관리) v1.0
    sessionLogService: asFunction(() => {
      return new SessionLogService({
        logger: container.resolve('logger'),
        debugMode: config.debugMode || false
      });
    }).singleton(),

    // 시간체크 통합 구독관리 워커 UseCase v2.0
    // '통합워커' 탭에서 상태 기반 결제 주기 관리
    scheduledSubscriptionWorkerUseCase: asClass(ScheduledSubscriptionWorkerUseCase)
      .inject(() => ({
        adsPowerAdapter: container.resolve('adsPowerAdapter'),
        adsPowerIdMappingService: container.resolve('adsPowerIdMappingService'),  // 이메일 → AdsPower ID 매핑
        pauseUseCase: container.resolve('enhancedPauseSubscriptionUseCase'),
        resumeUseCase: container.resolve('enhancedResumeSubscriptionUseCase'),
        sheetsRepository: container.resolve('pauseSheetRepository'),
        timeFilterService: container.resolve('timeFilterService'),
        workerLockService: container.resolve('workerLockService'),
        sharedConfig: container.resolve('sharedConfig'),  // 설정 서비스 주입
        logger: container.resolve('logger')
      })),

  });

  return container;
}

/**
 * 컨테이너 팩토리
 */
function createApplicationContainer(config = {}) {
  debugLog('[Container] Creating application container...');
  return setupContainer(config);
}

debugLog('[Container] Exporting module...');
module.exports = {
  setupContainer,
  createApplicationContainer
};
debugLog('[Container] Module exported successfully');