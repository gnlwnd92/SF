/**
 * SunbrowserAdapter - Sunbrowser 전용 프로필 생성 및 관리
 * 
 * YouTube Family Plan Check를 위한 최적화된 브라우저 프로필 생성
 * - Sunbrowser (최신 Chrome 버전)
 * - Windows OS 기본 설정
 * - 자동화 감지 우회 설정 포함
 */

const AdsPowerAdapter = require('./AdsPowerAdapter');
const chalk = require('chalk');

class SunbrowserAdapter extends AdsPowerAdapter {
  constructor(options = {}) {
    super(options);
    
    // 디버그 모드 설정
    this.debug = options.debug || process.env.DEBUG_MODE === 'true';
    
    // Sunbrowser 전용 설정
    this.browserConfig = {
      browser_type: "sun",
      browser_kernel_ver: "latest", // 최신 Chrome 버전
      os: "Windows",  // AdsPower API는 "Windows"만 인식 ("Windows 11"은 무시됨)
      os_version: "11",  // 버전은 별도로 지정
      sys_os_type: 7,  // Windows 시스템 타입 코드
      hardware_concurrency: 4,
      device_memory: 8,
      max_touch_points: 0,
      navigator_platform: "Win32"
    };
    
    // Family Plan 전용 그룹 ID (Windows 11 고정 그룹)
    // AdsPower에서 이 그룹을 생성하고 OS를 Windows 11로 고정 설정해야 함
    this.familyPlanGroupId = options.familyPlanGroupId || "windows_11_family_plan";
    
    // API 클라이언트 (부모 클래스에서 상속)
    this.apiClient = require('axios').create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout
    });
  }

  /**
   * Sunbrowser 프로필 생성
   * @param {Object} accountInfo - 계정 정보
   * @returns {Object} 생성된 프로필 정보
   */
  async createFamilyPlanProfile(accountInfo) {
    try {
      const { email, password, recoveryEmail, totpSecret } = accountInfo;
      
      // 프로필 이름 생성 (이메일 @ 앞부분)
      const profileName = email.split('@')[0];
      
      console.log(chalk.cyan(`🌟 Sunbrowser 프로필 생성 시작: ${profileName}`));
      
      // 기존 프로필 확인
      const existingProfile = await this.findProfileByName(profileName);
      if (existingProfile) {
        console.log(chalk.yellow(`⚠️ 기존 프로필 발견: ${existingProfile.user_id}`));
        return {
          success: true,
          profileId: existingProfile.user_id,
          accId: existingProfile.acc_id || 'default',
          isExisting: true,
          message: '기존 프로필 사용'
        };
      }
      
      // 프로필 생성 파라미터
      const profileData = {
        // 기본 정보
        name: profileName,
        username: profileName,
        domain_name: "https://www.google.com",
        open_urls: ["https://www.google.com"],
        repeat_config: "0", // 반복 설정 없음
        
        // 그룹 설정
        group_id: this.familyPlanGroupId,
        
        // 브라우저 설정
        user_agent: this.generateUserAgent(),
        browser_kernel_config: {
          version: this.browserConfig.browser_kernel_ver,
          type: this.browserConfig.browser_type
        },
        
        // OS 설정 - Windows 11 강제 (모든 가능한 파라미터 사용)
        os: "Windows",                    // 기본 OS
        os_type: "Windows",               // 대체 파라미터
        os_version: "11",                 // Windows 11 버전
        sys_os_type: 7,                   // Windows 시스템 코드
        sys_os_version: "Windows 11",     // 시스템 OS 버전 문자열
        platform: "Win32",                // 플랫폼
        navigator_platform: "Win32",      // Navigator.platform 값
        
        // 하드웨어 지문 설정
        webgl: "3",           // WebGL 노이즈 추가
        webgl_config: {
          vendor: "Google Inc. (NVIDIA)",
          renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
          unmasked_vendor: "Google Inc. (NVIDIA)",
          unmasked_renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)"
        },
        
        canvas: "1",          // Canvas 노이즈 추가
        audio: "1",           // Audio 노이즈 추가
        
        media_devices: "1",   // 미디어 디바이스 노이즈
        client_rects: "1",    // ClientRects 노이즈
        
        // 언어 및 시간대
        languages: "ko-KR,ko,en-US,en",
        sys_language: "ko-KR",
        time_zone: "Asia/Seoul",
        
        // 화면 해상도
        resolution: "1920x1080x24",
        device_scale_factor: "1",
        
        // 하드웨어 설정
        hardware_concurrency: this.browserConfig.hardware_concurrency,
        device_memory: this.browserConfig.device_memory,
        
        // 쿠키 설정
        cookie: "",  // 빈 쿠키로 시작
        local_storage: "",
        
        // 기타 설정
        do_not_track: "0",
        ports_protect: "0",
        
        // Fingerprint 설정 (Windows 11 강제)
        fingerprint_config: {
          automatic_timezone: "0",  // 수동 시간대 설정
          os_type: "Windows",        // OS 타입 고정
          os_version: "11",          // Windows 11
          browser: "chrome",         // Chrome 브라우저
          version: this.browserConfig.browser_kernel_ver,
          random_ua: "0"             // User-Agent 랜덤화 비활성화
        },
        
        // 비고
        remark: `Family Plan Check - Windows 11 - ${new Date().toISOString()}`
      };
      
      // 프로필 생성 API 호출
      const response = await this.apiClient.post('/api/v1/user/create', profileData);
      
      if (response.data.code === 0) {
        const profileId = response.data.data.id;
        const accId = response.data.data.acc_id || 'default';
        
        console.log(chalk.green(`✅ Sunbrowser 프로필 생성 성공`));
        console.log(chalk.gray(`  - Profile ID: ${profileId}`));
        console.log(chalk.gray(`  - Account ID: ${accId}`));
        console.log(chalk.gray(`  - Profile Name: ${profileName}`));
        
        // 계정 정보 저장 (보안을 위해 로컬 저장소에만)
        await this.saveAccountCredentials(profileId, {
          email,
          password: this.encryptPassword(password),
          recoveryEmail,
          totpSecret
        });
        
        // 생성된 프로필의 실제 OS 확인 (디버깅용)
        if (this.debug) {
          try {
            const checkResponse = await this.apiClient.get(`/api/v1/user/list`, {
              params: { user_id: profileId }
            });
            
            if (checkResponse.data.code === 0 && checkResponse.data.data.list.length > 0) {
              const createdProfile = checkResponse.data.data.list[0];
              console.log(chalk.blue(`📊 생성된 프로필 OS 확인:`));
              console.log(chalk.gray(`  - OS: ${createdProfile.os || 'N/A'}`));
              console.log(chalk.gray(`  - OS Version: ${createdProfile.os_version || 'N/A'}`));
              console.log(chalk.gray(`  - User Agent: ${createdProfile.user_agent ? createdProfile.user_agent.substring(0, 50) + '...' : 'N/A'}`));
              
              // Windows 11이 아닌 경우 경고
              if (createdProfile.os && !createdProfile.os.includes('Windows')) {
                console.log(chalk.yellow(`⚠️ 경고: 프로필이 Windows 11이 아닌 ${createdProfile.os}로 생성되었습니다.`));
                console.log(chalk.yellow(`  AdsPower 설정에서 Random Fingerprint를 비활성화하거나`));
                console.log(chalk.yellow(`  그룹 설정을 사용하여 OS를 고정해주세요.`));
              }
            }
          } catch (checkError) {
            console.log(chalk.gray(`프로필 OS 확인 실패: ${checkError.message}`));
          }
        }
        
        return {
          success: true,
          profileId,
          accId,
          isExisting: false,
          message: '새 프로필 생성 완료'
        };
        
      } else {
        throw new Error(response.data.msg || '프로필 생성 실패');
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ Sunbrowser 프로필 생성 오류: ${error.message}`));
      return {
        success: false,
        message: error.message,
        error
      };
    }
  }

  /**
   * User-Agent 생성 (최신 Chrome 버전)
   */
  generateUserAgent() {
    const chromeVersion = "120.0.6099.129"; // 최신 버전으로 업데이트
    const userAgents = [
      // Windows 11 User-Agents (Windows NT 10.0은 Windows 10/11 공통, 하지만 실제로 Windows 11도 10.0을 사용)
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`,
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 Edg/120.0.2210.91`,
      // 참고: Windows 11도 User-Agent에서는 "Windows NT 10.0"을 사용함 (보안상 이유)
    ];
    
    // 첫 번째 User-Agent를 기본으로 사용 (일관성을 위해)
    return userAgents[0];
  }

  /**
   * 계정 정보 암호화 저장
   */
  async saveAccountCredentials(profileId, credentials) {
    // TODO: 실제 구현시 암호화 필요
    // 임시로 메모리에만 저장
    if (!this.credentials) {
      this.credentials = new Map();
    }
    this.credentials.set(profileId, credentials);
  }

  /**
   * 계정 정보 가져오기
   */
  async getAccountCredentials(profileId) {
    if (this.credentials && this.credentials.has(profileId)) {
      return this.credentials.get(profileId);
    }
    return null;
  }

  /**
   * 비밀번호 암호화 (간단한 Base64, 실제로는 더 강력한 암호화 필요)
   */
  encryptPassword(password) {
    return Buffer.from(password).toString('base64');
  }

  /**
   * 비밀번호 복호화
   */
  decryptPassword(encrypted) {
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }

  /**
   * 프로필 검증
   */
  async validateProfile(profileId) {
    try {
      const response = await this.apiClient.get('/api/v1/user/detail', {
        params: { user_id: profileId }
      });
      
      if (response.data.code === 0 && response.data.data) {
        const profile = response.data.data;
        
        // 필수 설정 검증
        const validations = {
          browserType: profile.browser_kernel_config?.type === 'sun',
          os: profile.os?.includes('Windows'),
          webgl: profile.webgl === '3',
          canvas: profile.canvas === '1'
        };
        
        const isValid = Object.values(validations).every(v => v === true);
        
        if (!isValid) {
          console.log(chalk.yellow('⚠️ 프로필 검증 실패:'));
          Object.entries(validations).forEach(([key, value]) => {
            if (!value) {
              console.log(chalk.red(`  ❌ ${key}: 검증 실패`));
            }
          });
        }
        
        return isValid;
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red(`프로필 검증 오류: ${error.message}`));
      return false;
    }
  }

  /**
   * 프로필 업데이트 (프록시 설정 등)
   */
  async updateProfileProxy(profileId, proxyConfig) {
    try {
      const updateData = {
        user_id: profileId,
        user_proxy_config: {
          proxy_soft: "other",
          proxy_type: proxyConfig.type || "http",
          proxy_host: proxyConfig.host,
          proxy_port: String(proxyConfig.port),
          proxy_user: proxyConfig.username,
          proxy_password: proxyConfig.password
        }
      };
      
      const response = await this.apiClient.post('/api/v1/user/update', updateData);
      
      if (response.data.code === 0) {
        console.log(chalk.green(`✅ 프로필 프록시 업데이트 완료: ${proxyConfig.host}:${proxyConfig.port}`));
        return true;
      }
      
      throw new Error(response.data.msg || '프록시 업데이트 실패');
      
    } catch (error) {
      console.error(chalk.red(`프록시 업데이트 오류: ${error.message}`));
      return false;
    }
  }

  /**
   * 배치 프로필 생성
   */
  async createBatchProfiles(accounts, options = {}) {
    const results = [];
    const { parallel = false, batchSize = 5 } = options;
    
    console.log(chalk.cyan(`📦 배치 프로필 생성 시작: ${accounts.length}개 계정`));
    
    if (parallel) {
      // 병렬 처리
      for (let i = 0; i < accounts.length; i += batchSize) {
        const batch = accounts.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(account => this.createFamilyPlanProfile(account))
        );
        results.push(...batchResults);
        
        // API Rate Limit 방지
        if (i + batchSize < accounts.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    } else {
      // 순차 처리
      for (const account of accounts) {
        const result = await this.createFamilyPlanProfile(account);
        results.push(result);
        
        // API Rate Limit 방지
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 결과 요약
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(chalk.cyan('\n📊 배치 프로필 생성 완료'));
    console.log(chalk.green(`  ✅ 성공: ${successful}개`));
    console.log(chalk.red(`  ❌ 실패: ${failed}개`));
    
    return results;
  }
  /**
   * 프로필명으로 프로필 찾기
   */
  async findProfileByName(profileName) {
    try {
      console.log(chalk.gray(`프로필 검색: ${profileName}`));
      
      // 프로필 목록 가져오기
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: {
          page_size: 100,
          search_username: profileName
        }
      });
      
      if (response.data.code === 0 && response.data.data.list) {
        const profile = response.data.data.list.find(
          p => p.username === profileName || p.name === profileName
        );
        
        if (profile) {
          console.log(chalk.green(`✅ 프로필 찾음: ${profile.user_id}`));
          return profile;
        }
      }
      
      console.log(chalk.yellow(`프로필을 찾을 수 없음: ${profileName}`));
      return null;
      
    } catch (error) {
      console.error(chalk.red(`프로필 검색 실패: ${error.message}`));
      return null;
    }
  }

  /**
   * 프로필 프록시 업데이트
   */
  async updateProfileProxy(profileId, proxy) {
    try {
      console.log(chalk.gray(`프록시 업데이트: ${profileId}`));
      
      const updateData = {
        user_id: profileId,
        user_proxy_config: {
          proxy_type: proxy.type || "http",
          proxy_host: proxy.host,
          proxy_port: proxy.port,
          proxy_user: proxy.username,
          proxy_password: proxy.password,
          proxy_soft: "other"
        }
      };
      
      const response = await this.apiClient.post('/api/v1/user/update', updateData);
      
      if (response.data.code === 0) {
        console.log(chalk.green(`✅ 프록시 업데이트 성공`));
        return true;
      } else {
        console.error(chalk.red(`프록시 업데이트 실패: ${response.data.msg}`));
        return false;
      }
      
    } catch (error) {
      console.error(chalk.red(`프록시 업데이트 오류: ${error.message}`));
      return false;
    }
  }

  /**
   * 브라우저 열기 (Sunbrowser 특화)
   */
  async openBrowser(profileId) {
    try {
      console.log(chalk.cyan(`🌐 Sunbrowser 실행: ${profileId}`));
      
      // 브라우저 실행
      const response = await this.apiClient.get('/api/v1/browser/start', {
        params: {
          user_id: profileId,
          open_tabs: 1,
          clear_cache_after_closing: 0,
          enable_password_saving: 1
        }
      });
      
      if (response.data.code === 0) {
        const wsEndpoint = response.data.data.ws;
        const debugPort = response.data.data.debug_port;
        
        console.log(chalk.green(`✅ Sunbrowser 실행 성공`));
        console.log(chalk.gray(`  - WebSocket: ${wsEndpoint}`));
        console.log(chalk.gray(`  - Debug Port: ${debugPort}`));
        
        return {
          success: true,
          ws: wsEndpoint,
          debugPort,
          profileId
        };
      } else {
        throw new Error(response.data.msg || 'Browser start failed');
      }
      
    } catch (error) {
      console.error(chalk.red(`브라우저 실행 실패: ${error.message}`));
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 브라우저 닫기
   */
  async closeBrowser(profileId) {
    try {
      console.log(chalk.gray(`브라우저 종료: ${profileId}`));
      
      const response = await this.apiClient.get('/api/v1/browser/stop', {
        params: { user_id: profileId }
      });
      
      if (response.data.code === 0) {
        console.log(chalk.green('✅ 브라우저 종료 완료'));
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(chalk.red(`브라우저 종료 실패: ${error.message}`));
      return false;
    }
  }

  /**
   * 브라우저 상태 확인
   */
  async checkBrowserStatus(profileId) {
    try {
      const response = await this.apiClient.get('/api/v1/browser/active', {
        params: { user_id: profileId }
      });
      
      return {
        isActive: response.data.code === 0 && response.data.data.status === 'Active',
        data: response.data.data
      };
      
    } catch (error) {
      return {
        isActive: false,
        error: error.message
      };
    }
  }
}

module.exports = SunbrowserAdapter;