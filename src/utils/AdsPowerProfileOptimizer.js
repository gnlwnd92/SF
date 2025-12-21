/**
 * AdsPowerProfileOptimizer
 * 
 * v4.0 - 최소 개발 원칙
 * AdsPower API 설정만으로 모든 자동화 감지 우회 처리
 * 커스텀 JS 코드 제거, AdsPower 기본 기능 최대 활용
 */

const axios = require('axios');
const chalk = require('chalk');

class AdsPowerProfileOptimizer {
  constructor(config = {}) {
    this.config = {
      apiUrl: config.apiUrl || 'http://local.adspower.net:50325',
      debugMode: config.debugMode || false,
      ...config
    };
    
    // API 클라이언트
    this.apiClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * 프로필 최적화 설정 (v4.0)
   * AdsPower 기본 기능만 사용, 커스텀 코드 제로
   */
  getOptimalFingerprintConfig() {
    return {
      // 위치/시간대 (IP 기반 자동 매칭)
      automatic_timezone: "1",     // IP 기반 시간대 자동 설정
      location_switch: "1",         // IP 기반 위치 자동 설정
      location: "ask",              // 위치 권한 요청 시 물어보기
      
      // 언어 (IP 기반)
      language_switch: "1",         // IP 기반 언어 자동 설정
      
      // WebRTC (YouTube는 disabled로 충분)
      webrtc: "disabled",           // YouTube에는 WebRTC 불필요
      // 옵션: "local" (Real IP), "proxy" (Replace), "forward" (Google 서버 경유)
      
      // Canvas/WebGL/Audio (AdsPower 기본 노이즈)
      canvas: "1",                  // Canvas 노이즈 활성화
      webgl_image: "1",             // WebGL 이미지 노이즈
      webgl: "3",                   // WebGL 메타데이터 노이즈
      audio: "1",                   // Audio 노이즈
      
      // 미디어 장치 (기본값)
      media_devices: "1",           // 노이즈 (로컬 장치 수 따름)
      // 필요시: media_devices: "2" + media_devices_num 설정
      
      // 폰트 (기본값)
      font: "1",                    // 폰트 리스트 노이즈
      
      // 기타 권장 설정
      do_not_track: "1",            // DNT 헤더 활성화
      port_scan_protect: "1",       // 포트 스캔 보호
      
      // AdsPower v3.6.2+는 plugins를 자동으로 cloaking
      // 별도 설정 불필요
    };
  }

  /**
   * 단일 프로필 업데이트
   */
  async updateProfile(profileId, customConfig = {}) {
    try {
      const fingerprintConfig = {
        ...this.getOptimalFingerprintConfig(),
        ...customConfig
      };
      
      const response = await this.apiClient.post('/api/v1/user/update', {
        user_id: profileId,
        fingerprint_config: fingerprintConfig
      });
      
      if (response.data.code === 0) {
        this.log(`✅ 프로필 ${profileId} 최적화 완료`, 'success');
        return { success: true, data: response.data };
      } else {
        throw new Error(response.data.msg || 'Update failed');
      }
      
    } catch (error) {
      this.log(`❌ 프로필 ${profileId} 업데이트 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 모든 프로필 일괄 업데이트
   */
  async updateAllProfiles(options = {}) {
    try {
      // 1. 프로필 목록 조회
      const profiles = await this.getProfileList();
      
      if (!profiles || profiles.length === 0) {
        this.log('업데이트할 프로필이 없습니다', 'warning');
        return { success: false, message: 'No profiles found' };
      }
      
      this.log(`총 ${profiles.length}개 프로필 발견`, 'info');
      
      // 2. 각 프로필 업데이트
      const results = [];
      let successCount = 0;
      let failCount = 0;
      
      for (const profile of profiles) {
        const result = await this.updateProfile(profile.user_id, options.customConfig);
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
        
        results.push({
          profileId: profile.user_id,
          profileName: profile.name || profile.user_id,
          ...result
        });
        
        // Rate limiting 방지
        await this.delay(500);
      }
      
      // 3. 결과 요약
      this.log('\n=== 업데이트 완료 ===', 'info');
      this.log(`✅ 성공: ${successCount}개`, 'success');
      if (failCount > 0) {
        this.log(`❌ 실패: ${failCount}개`, 'error');
      }
      
      return {
        success: failCount === 0,
        total: profiles.length,
        successCount,
        failCount,
        results
      };
      
    } catch (error) {
      this.log(`일괄 업데이트 실패: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * 프로필 목록 조회
   */
  async getProfileList() {
    try {
      const response = await this.apiClient.get('/api/v1/user/list', {
        params: {
          page_size: 100,
          page: 1
        }
      });
      
      if (response.data.code === 0) {
        return response.data.data.list || [];
      }
      
      throw new Error(response.data.msg || 'Failed to get profiles');
      
    } catch (error) {
      this.log(`프로필 목록 조회 실패: ${error.message}`, 'error');
      return [];
    }
  }

  /**
   * 특정 상황별 프리셋 설정
   */
  getPresetConfig(preset) {
    const presets = {
      // YouTube/Google 일반 사용
      youtube: {
        webrtc: "disabled",
        media_devices: "1"
      },
      
      // WebRTC 필요 사이트
      webrtc_site: {
        webrtc: "proxy",
        media_devices: "2",
        media_devices_num: {
          audioinput_num: "1",
          videoinput_num: "1",
          audiooutput_num: "1"
        }
      },
      
      // 고보안 필요
      high_security: {
        webrtc: "forward",
        canvas: "1",
        webgl: "3",
        audio: "1"
      },
      
      // 최소 설정 (문제 해결용)
      minimal: {
        automatic_timezone: "1",
        location_switch: "1",
        webrtc: "disabled"
      }
    };
    
    return presets[preset] || presets.youtube;
  }

  /**
   * Global Settings 확인 안내
   */
  printGlobalSettingsGuide() {
    console.log(chalk.cyan('\n=== AdsPower Global Settings 확인 ==='));
    console.log('1. AdsPower 실행');
    console.log('2. Settings → Global Settings → Browser Settings');
    console.log('3. ✅ "Match timezone and geolocation automatically" 활성화');
    console.log('4. Save 클릭\n');
  }

  /**
   * 검증 체크리스트 출력
   */
  printVerificationChecklist() {
    console.log(chalk.cyan('\n=== 검증 체크리스트 ==='));
    console.log('□ AdsPower v3.6.2 이상 버전 확인');
    console.log('□ Global Settings 자동 매칭 활성화');
    console.log('□ 각 프로필에 프록시 설정 확인');
    console.log('□ AdsPower Assistant로 지문 확인');
    console.log('□ BrowserLeaks.com에서 누출 테스트');
    console.log('□ 실제 YouTube Premium 페이지 테스트\n');
  }

  /**
   * 유틸리티 함수들
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(message, type = 'info') {
    if (!this.config.debugMode && type === 'debug') return;
    
    const prefix = chalk.cyan('[ProfileOptimizer]');
    switch (type) {
      case 'success':
        console.log(prefix, chalk.green(message));
        break;
      case 'error':
        console.log(prefix, chalk.red(message));
        break;
      case 'warning':
        console.log(prefix, chalk.yellow(message));
        break;
      default:
        console.log(prefix, message);
    }
  }
}

// CLI 실행
if (require.main === module) {
  (async () => {
    const optimizer = new AdsPowerProfileOptimizer({
      debugMode: true
    });
    
    console.log(chalk.cyan.bold('\n=== AdsPower 프로필 최적화 v4.0 ==='));
    console.log(chalk.gray('최소 개발 원칙 - AdsPower 기본 기능 최대 활용\n'));
    
    // Global Settings 안내
    optimizer.printGlobalSettingsGuide();
    
    // 사용자 확인
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('Global Settings를 확인하셨나요? (y/n): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('\n먼저 Global Settings를 확인해주세요.'));
      process.exit(0);
    }
    
    // 프로필 업데이트
    console.log(chalk.cyan('\n모든 프로필 업데이트를 시작합니다...'));
    const result = await optimizer.updateAllProfiles();
    
    if (result.success) {
      console.log(chalk.green.bold('\n✅ 모든 프로필 최적화 완료!'));
    } else {
      console.log(chalk.yellow('\n⚠️ 일부 프로필 업데이트 실패'));
    }
    
    // 검증 체크리스트
    optimizer.printVerificationChecklist();
  })();
}

module.exports = AdsPowerProfileOptimizer;