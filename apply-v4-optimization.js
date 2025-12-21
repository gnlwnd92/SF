#!/usr/bin/env node

/**
 * AdsPower 프로필 v4.0 최적화 일괄 적용 스크립트
 * 
 * 실행 방법:
 * node apply-v4-optimization.js
 * 
 * 이 스크립트는:
 * 1. AdsPower Global Settings 확인을 안내합니다
 * 2. 모든 프로필에 v4.0 최적화 설정을 적용합니다
 * 3. 검증 체크리스트를 제공합니다
 */

const chalk = require('chalk');
const inquirer = require('inquirer');
const AdsPowerProfileOptimizer = require('./src/utils/AdsPowerProfileOptimizer');

// 배너 출력
function printBanner() {
  console.clear();
  console.log(chalk.cyan.bold('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║                                                          ║'));
  console.log(chalk.cyan.bold('║     AdsPower 프로필 최적화 v4.0 - 일괄 적용 도구        ║'));
  console.log(chalk.cyan.bold('║                                                          ║'));
  console.log(chalk.cyan.bold('║     최소 개발 원칙 - AdsPower 기본 기능 최대 활용       ║'));
  console.log(chalk.cyan.bold('║                                                          ║'));
  console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════╝'));
  console.log();
}

// Global Settings 안내
function printGlobalSettingsGuide() {
  console.log(chalk.yellow.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.yellow.bold('🔧 AdsPower Global Settings 확인 필수!'));
  console.log(chalk.yellow.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();
  console.log(chalk.white('1. AdsPower 프로그램 실행'));
  console.log(chalk.white('2. Settings → Global Settings → Browser Settings'));
  console.log(chalk.green.bold('3. ✅ "Match timezone and geolocation automatically" 활성화'));
  console.log(chalk.white('4. Save 클릭'));
  console.log();
  console.log(chalk.gray('이 설정을 활성화하지 않으면 최적화가 제대로 작동하지 않습니다!'));
  console.log();
}

// 검증 체크리스트
function printVerificationChecklist() {
  console.log();
  console.log(chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold('✓ 검증 체크리스트'));
  console.log(chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();
  console.log('□ AdsPower v3.6.2 이상 버전 확인');
  console.log('□ Global Settings 자동 매칭 활성화');
  console.log('□ 각 프로필에 프록시 설정 확인');
  console.log('□ AdsPower Assistant로 지문 확인');
  console.log('□ BrowserLeaks.com에서 누출 테스트');
  console.log('□ 실제 YouTube Premium 페이지 테스트');
  console.log();
}

// 결과 요약
function printResults(result) {
  console.log();
  console.log(chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan.bold('📊 적용 결과'));
  console.log(chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();
  console.log(`총 프로필 수: ${result.total}`);
  console.log(chalk.green(`✅ 성공: ${result.successCount}개`));
  if (result.failCount > 0) {
    console.log(chalk.red(`❌ 실패: ${result.failCount}개`));
  }
  console.log();

  // 실패한 프로필 목록 표시
  if (result.failCount > 0) {
    console.log(chalk.red.bold('실패한 프로필:'));
    result.results.filter(r => !r.success).forEach(r => {
      console.log(chalk.red(`  - ${r.profileName || r.profileId}: ${r.error}`));
    });
    console.log();
  }
}

// 프리셋 선택
async function selectPreset() {
  const presets = [
    {
      name: 'YouTube/Google 일반 사용 (권장)',
      value: 'youtube',
      description: 'YouTube Premium 및 Google 서비스에 최적화'
    },
    {
      name: 'WebRTC 필요 사이트',
      value: 'webrtc_site',
      description: '화상통화 등 WebRTC가 필요한 사이트용'
    },
    {
      name: '고보안 모드',
      value: 'high_security',
      description: '최대 보안 설정 (일부 기능 제한될 수 있음)'
    },
    {
      name: '최소 설정 (문제 해결용)',
      value: 'minimal',
      description: '문제 발생 시 테스트용 최소 설정'
    },
    {
      name: '커스텀 설정',
      value: 'custom',
      description: '직접 설정 입력'
    }
  ];

  const { preset } = await inquirer.prompt([
    {
      type: 'list',
      name: 'preset',
      message: '적용할 프리셋을 선택하세요:',
      choices: presets.map(p => ({
        name: `${p.name}\n    ${chalk.gray(p.description)}`,
        value: p.value
      }))
    }
  ]);

  return preset;
}

// 커스텀 설정 입력
async function getCustomConfig() {
  const { config } = await inquirer.prompt([
    {
      type: 'editor',
      name: 'config',
      message: 'fingerprint_config JSON을 입력하세요:',
      default: JSON.stringify({
        automatic_timezone: "1",
        location_switch: "1",
        webrtc: "disabled",
        canvas: "1",
        webgl: "3",
        audio: "1",
        media_devices: "1"
      }, null, 2)
    }
  ]);

  try {
    return JSON.parse(config);
  } catch (error) {
    console.log(chalk.red('❌ 잘못된 JSON 형식입니다.'));
    return null;
  }
}

// 메인 실행 함수
async function main() {
  try {
    // 배너 출력
    printBanner();

    // Global Settings 안내
    printGlobalSettingsGuide();

    // 사용자 확인
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Global Settings를 확인하셨나요?',
        default: false
      }
    ]);

    if (!confirmed) {
      console.log(chalk.yellow('\n먼저 Global Settings를 확인해주세요.'));
      console.log(chalk.gray('스크립트를 종료합니다.'));
      process.exit(0);
    }

    // AdsPower 연결 확인
    console.log(chalk.cyan('\n🔍 AdsPower 연결 확인 중...'));
    const optimizer = new AdsPowerProfileOptimizer({
      debugMode: true
    });

    // 프로필 목록 조회
    const profiles = await optimizer.getProfileList();
    
    if (!profiles || profiles.length === 0) {
      console.log(chalk.red('❌ 프로필을 찾을 수 없습니다.'));
      console.log(chalk.yellow('AdsPower가 실행 중인지 확인해주세요.'));
      process.exit(1);
    }

    console.log(chalk.green(`✅ ${profiles.length}개 프로필 발견`));
    console.log();

    // 프리셋 선택
    const preset = await selectPreset();
    let customConfig = null;

    if (preset === 'custom') {
      customConfig = await getCustomConfig();
      if (!customConfig) {
        console.log(chalk.red('설정 입력이 취소되었습니다.'));
        process.exit(1);
      }
    }

    // 최종 확인
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `${profiles.length}개 프로필에 ${preset} 설정을 적용하시겠습니까?`,
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow('\n작업이 취소되었습니다.'));
      process.exit(0);
    }

    // 프로필 업데이트 시작
    console.log(chalk.cyan.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan.bold('🚀 프로필 최적화 시작'));
    console.log(chalk.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    // 프리셋 설정 가져오기
    let presetConfig = null;
    if (preset !== 'custom') {
      presetConfig = optimizer.getPresetConfig(preset);
    }

    // 업데이트 실행
    const result = await optimizer.updateAllProfiles({
      customConfig: customConfig || presetConfig
    });

    // 결과 출력
    printResults(result);

    // 검증 체크리스트
    printVerificationChecklist();

    // 완료 메시지
    if (result.success) {
      console.log(chalk.green.bold('✨ 모든 프로필 최적화가 완료되었습니다!'));
    } else {
      console.log(chalk.yellow.bold('⚠️ 일부 프로필 업데이트에 실패했습니다.'));
      console.log(chalk.gray('실패한 프로필은 개별적으로 확인이 필요합니다.'));
    }

    console.log();
    console.log(chalk.gray('작업 완료. 스크립트를 종료합니다.'));

  } catch (error) {
    console.error(chalk.red.bold('\n❌ 오류 발생:'), error.message);
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// 스크립트 실행
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red.bold('치명적 오류:'), error);
    process.exit(1);
  });
}

module.exports = { main };