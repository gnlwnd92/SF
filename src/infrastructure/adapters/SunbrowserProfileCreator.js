/**
 * AdsPower SunBrowser 프로필 생성 모듈
 * Windows 11 + SunBrowser + 하드웨어 노이즈 최적화
 * 
 * @description
 * 가족 요금제 검증용 AdsPower 프로필 자동 생성
 * - OS: Windows 11
 * - Browser: SunBrowser (Chrome 137/138/139)
 * - Hardware Noise: Canvas 기본값, WebGL 무작위
 * - Screen: 무작위 해상도
 */

const axios = require('axios');
const chalk = require('chalk');
const crypto = require('crypto');
const { getApiUrl, createApiClient } = require('../../utils/adsPowerPortDetector');

class SunbrowserProfileCreator {
  constructor(config = {}) {
    this.configApiUrl = config.apiUrl || process.env.ADSPOWER_API_URL || 'http://local.adspower.net:50325';
    this.apiUrl = null; // 초기화 시 설정됨
    this.apiClient = null; // 초기화 시 생성됨
    this.initialized = false;
    
    // Chrome 버전 풀 (137, 138, 139)
    this.chromeVersions = [
      { version: '137', full: '137.0.0.0' },
      { version: '138', full: '138.0.0.0' },
      { version: '139', full: '139.0.0.0' }
    ];
    
    // 화면 해상도 풀 (일반적인 해상도) - AdsPower는 _ 형식 사용
    this.resolutions = [
      '1920_1080',  // Full HD (가장 일반적)
      '2560_1440',  // QHD
      '1366_768',   // HD
      '1440_900',   // WXGA+
      '1680_1050',  // WSXGA+
      '1920_1200',  // WUXGA
      '3840_2160',  // 4K
      '1536_864',   // Surface Pro
      '1600_900',   // HD+
      '2560_1600'   // MacBook Pro like
    ];
    
    // WebGL 벤더/렌더러 풀 (실제 하드웨어 기반)
    this.webglVendors = [
      {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'
      },
      {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0)'
      },
      {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0)'
      },
      {
        vendor: 'Google Inc. (AMD)',
        renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)'
      },
      {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)'
      },
      {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)'
      }
    ];
    
    // 하드웨어 스펙 풀
    this.hardwareSpecs = [
      { cores: 4, memory: 8 },
      { cores: 6, memory: 16 },
      { cores: 8, memory: 16 },
      { cores: 8, memory: 32 },
      { cores: 12, memory: 32 },
      { cores: 16, memory: 64 }
    ];
  }

  /**
   * API 클라이언트 초기화 (포트 자동 감지)
   */
  async initialize(silent = false) {
    if (this.initialized) {
      return;
    }

    try {
      // 포트 자동 감지 및 API 클라이언트 생성
      const { client, url } = await createApiClient(this.configApiUrl, 30000, silent);
      this.apiClient = client;
      this.apiUrl = url;
      this.initialized = true;

      if (!silent) {
        console.log(chalk.green(`[SunbrowserProfileCreator] ✅ API 초기화 완료: ${url}`));
      }
    } catch (error) {
      console.error(chalk.red(`[SunbrowserProfileCreator] ❌ API 초기화 실패: ${error.message}`));
      throw error;
    }
  }

  /**
   * 랜덤 요소 선택 헬퍼
   */
  getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
  }
  
  /**
   * Windows 11 User Agent 생성
   */
  generateWindows11UserAgent(chromeVersion) {
    // Windows 11도 보안상 "Windows NT 10.0"으로 표시
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  
  /**
   * 프로필 생성 파라미터 구성
   */
  buildProfileData(email, options = {}) {
    // 랜덤 선택
    const chromeVersion = this.getRandomElement(this.chromeVersions);
    const resolution = this.getRandomElement(this.resolutions);
    const webglConfig = this.getRandomElement(this.webglVendors);
    const hardwareSpec = this.getRandomElement(this.hardwareSpecs);
    
    // 해상도 파싱 (언더스코어 형식)
    const [width, height] = resolution.split('_').map(Number);
    
    const profileData = {
      // 기본 정보
      name: email,  // 전체 이메일을 프로필명으로 사용
      // username 제거 - domain_name과 함께 사용해야 함
      remark: `Windows 11 / SunBrowser Chrome ${chromeVersion.version}`,
      group_id: options.groupId || "0",
      
      // OS 설정 (Windows 11)
      fingerprint_config: {
        // User Agent 설정
        ua: this.generateWindows11UserAgent(chromeVersion.full),
        
        // 브라우저 커널 설정 
        browser_kernel_config: {
          type: "chrome",  // Chrome 엔진 (SunBrowser는 별도 설정)
          version: chromeVersion.version  // Chrome 버전
        },
        
        // OS 정보
        os_type: "Windows",
        os_version: "11",
        
        // 플랫폼
        navigator_platform: "Win32",
        
        // 화면 해상도 (무작위)
        screen_resolution: resolution,
        color_depth: 24,
        device_scale_factor: 1,
        
        // 하드웨어 노이즈 설정
        canvas: "0",  // 0: 기본값 (실제값)
        webgl: "3",   // 3: 커스텀 (무작위)
        webgl_image: "0",  // 0: 기본값
        audio: "1",   // 1: 노이즈 추가
        media_devices: "1",  // 1: 노이즈
        client_rects: "1",   // 1: 노이즈
        // fonts 제거 - AdsPower API에서 형식 오류 발생
        
        // WebGL 커스텀 설정 (webgl: "3"일 때 사용)
        webgl_config: {
          vendor: webglConfig.vendor,
          renderer: webglConfig.renderer,
          unmasked_vendor: webglConfig.vendor,
          unmasked_renderer: webglConfig.renderer
        },
        
        // 하드웨어 정보
        hardware_concurrency: hardwareSpec.cores,  // CPU 코어
        device_memory: hardwareSpec.memory,  // RAM (GB)
        max_touch_points: 0,  // 비터치 디바이스
        
        // 언어 설정
        language: ["ko-KR", "ko", "en-US", "en"],
        accept_language: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        
        // 시간대
        automatic_timezone: "1",
        timezone: "Asia/Seoul",
        
        // WebRTC
        webrtc: "local",  // local: 로컬 IP만 노출
        
        // 추적 방지
        do_not_track: "true",
        
        // 자동화 감지 우회
        disable_webdriver: true,
        disable_automation: true
      },
      
      // 추가 브라우저 설정
      disable_password_filling: "0",
      enable_password_saving: "1",
      clear_cache_after_closing: "0",
      disable_notifications: "0",
      
      // 시작 URL
      open_urls: ["https://www.google.com"],
      
      // 프록시 설정 (필수 - 프록시 없을 경우 no_proxy)
      user_proxy_config: options.proxy || {
        proxy_soft: "no_proxy"
      }
    };
    
    return profileData;
  }
  
  /**
   * 단일 프로필 생성
   */
  async createProfile(email, options = {}) {
    // API 클라이언트 초기화 확인
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const profileData = this.buildProfileData(email, options);
      
      console.log(chalk.cyan(`🚀 프로필 생성 중: ${email}`));
      console.log(chalk.gray(`  - Browser: SunBrowser Chrome ${profileData.fingerprint_config.browser_kernel_config.version}`));
      console.log(chalk.gray(`  - Resolution: ${profileData.fingerprint_config.screen_resolution}`));
      console.log(chalk.gray(`  - WebGL: Custom (Random)`));
      
      const response = await this.apiClient.post('/api/v1/user/create', profileData);
      
      if (response.data.code === 0) {
        // AdsPower API는 id를 직접 반환
        const profileId = response.data.data.id || response.data.data.user_id;
        const accId = response.data.data.acc_id || 'N/A';
        
        console.log(chalk.green(`✅ 프로필 생성 성공`));
        console.log(chalk.gray(`  - Profile ID: ${profileId}`));
        console.log(chalk.gray(`  - Account ID: ${accId}`));
        
        return {
          success: true,
          profileId: profileId,
          accountId: accId,
          email: email,
          details: profileData
        };
      } else {
        throw new Error(response.data.msg || 'Unknown error');
      }
      
    } catch (error) {
      console.log(chalk.red(`❌ 프로필 생성 실패: ${email}`));
      console.log(chalk.red(`  오류: ${error.message}`));
      
      return {
        success: false,
        email: email,
        error: error.message
      };
    }
  }
  
  /**
   * 배치 프로필 생성
   */
  async createBatchProfiles(emails, options = {}) {
    console.log(chalk.cyan('\n📦 배치 프로필 생성 시작'));
    console.log(chalk.gray(`  총 ${emails.length}개 프로필 생성 예정\n`));
    
    const results = [];
    
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      console.log(chalk.blue(`\n[${i + 1}/${emails.length}] 처리 중...`));
      
      const result = await this.createProfile(email, options);
      results.push(result);
      
      // API 제한 방지를 위한 지연
      if (i < emails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // 결과 요약
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(chalk.cyan('\n📊 생성 결과 요약'));
    console.log(chalk.green(`  ✅ 성공: ${successful}개`));
    if (failed > 0) {
      console.log(chalk.red(`  ❌ 실패: ${failed}개`));
    }
    
    return results;
  }
  
  /**
   * 프로필 존재 확인
   */
  async checkProfileExists(email) {
    try {
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: { 
          page_size: 100,
          query_user_name: email
        }
      });
      
      if (response.data.code === 0) {
        const profiles = response.data.data.list || [];
        return profiles.some(p => 
          p.username === email || 
          p.name === email  // 전체 이메일로 매칭
        );
      }
      
      return false;
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 프로필 확인 실패: ${error.message}`));
      return false;
    }
  }
  
  /**
   * 기존 프로필 삭제
   */
  async deleteProfile(email) {
    try {
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: { 
          page_size: 100,
          query_user_name: email
        }
      });
      
      if (response.data.code === 0) {
        const profiles = response.data.data.list || [];
        const targetProfiles = profiles.filter(p => 
          p.username === email || 
          p.name === email  // 전체 이메일로 매칭
        );
        
        if (targetProfiles.length > 0) {
          const ids = targetProfiles.map(p => p.user_id);
          
          await this.apiClient.post('/api/v1/user/delete', {
            user_ids: ids
          });
          
          console.log(chalk.green(`✅ ${targetProfiles.length}개 프로필 삭제 완료: ${email}`));
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.log(chalk.yellow(`⚠️ 프로필 삭제 실패: ${error.message}`));
      return false;
    }
  }
}

module.exports = SunbrowserProfileCreator;