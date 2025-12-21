/**
 * 전체 언어 날짜 파싱 검증 스크립트
 * 실제 브라우저 없이 파싱 로직만 빠르게 테스트
 */

const EnhancedDateParsingService = require('./src/services/EnhancedDateParsingService');
const chalk = require('chalk');

// 날짜 파싱 서비스 초기화
const dateParser = new EnhancedDateParsingService();

// 전체 테스트 케이스 (15개 언어)
const testCases = [
  {
    name: '한국어 (Korean)',
    language: 'ko',
    pauseDate: '10월 3일',
    resumeDate: '11월 3일',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '영어 (English)',
    language: 'en',
    pauseDate: 'Oct 3',
    resumeDate: 'Nov 3, 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '터키어 (Turkish)',
    language: 'tr',
    pauseDate: '3 Eki',
    resumeDate: '3 Kas 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '포르투갈어 (Portuguese)',
    language: 'pt',
    pauseDate: '3/10',
    resumeDate: '03/11/2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '러시아어 (Russian)',
    language: 'ru',
    pauseDate: '3 окт.',
    resumeDate: '3 нояб. 2025 г.',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '스페인어 (Spanish)',
    language: 'es',
    pauseDate: '3 oct',
    resumeDate: '3 nov 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '프랑스어 (French)',
    language: 'fr',
    pauseDate: '3 oct.',
    resumeDate: '3 nov. 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '독일어 (German)',
    language: 'de',
    pauseDate: '3. Okt.',
    resumeDate: '3. Nov. 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '이탈리아어 (Italian)',
    language: 'it',
    pauseDate: '3 ott',
    resumeDate: '3 nov 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '일본어 (Japanese)',
    language: 'ja',
    pauseDate: '10月3日',
    resumeDate: '2025年11月3日',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '중국어 (Chinese)',
    language: 'zh',
    pauseDate: '10月3日',
    resumeDate: '2025年11月3日',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '베트남어 (Vietnamese)',
    language: 'vi',
    pauseDate: 'Ngày 3 tháng 10',
    resumeDate: 'Ngày 3 tháng 11 năm 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '인도네시아어 (Indonesian)',
    language: 'id',
    pauseDate: '3 Okt',
    resumeDate: '3 Nov 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '아랍어 (Arabic)',
    language: 'ar',
    pauseDate: '3 أكتوبر',
    resumeDate: '3 نوفمبر 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  },
  {
    name: '힌디어 (Hindi)',
    language: 'hi',
    pauseDate: '3 अक्टूबर',
    resumeDate: '3 नवंबर 2025',
    expectedPauseDate: '2025-10-03',
    expectedResumeDate: '2025-11-03'
  }
];

console.log(chalk.cyan('='.repeat(70)));
console.log(chalk.cyan.bold('🌍 15개 언어 날짜 파싱 전체 검증'));
console.log(chalk.cyan('='.repeat(70)));

let totalTests = 0;
let passedTests = 0;
const failedLanguages = [];
const partialLanguages = [];

for (const testCase of testCases) {
  console.log(chalk.yellow(`\n📝 ${testCase.name} 테스트`));
  console.log(chalk.gray('━'.repeat(50)));
  
  let languagePassed = true;
  
  // 일시중지일 파싱
  console.log(chalk.blue(`일시중지일: "${testCase.pauseDate}"`));
  const parsedPauseDate = dateParser.parseDate(testCase.pauseDate, testCase.language);
  totalTests++;
  
  if (parsedPauseDate === testCase.expectedPauseDate) {
    console.log(chalk.green(`  ✅ ${parsedPauseDate}`));
    passedTests++;
  } else {
    console.log(chalk.red(`  ❌ ${parsedPauseDate || 'null'} (기대값: ${testCase.expectedPauseDate})`));
    languagePassed = false;
  }
  
  // 재개일 파싱
  console.log(chalk.blue(`재개일: "${testCase.resumeDate}"`));
  const parsedResumeDate = dateParser.parseDate(testCase.resumeDate, testCase.language);
  totalTests++;
  
  if (parsedResumeDate === testCase.expectedResumeDate) {
    console.log(chalk.green(`  ✅ ${parsedResumeDate}`));
    passedTests++;
  } else {
    console.log(chalk.red(`  ❌ ${parsedResumeDate || 'null'} (기대값: ${testCase.expectedResumeDate})`));
    languagePassed = false;
  }
  
  // 언어별 결과 집계
  if (!languagePassed) {
    if (parsedPauseDate || parsedResumeDate) {
      partialLanguages.push(testCase.name);
    } else {
      failedLanguages.push(testCase.name);
    }
  }
}

// 최종 결과
console.log(chalk.cyan('\n' + '='.repeat(70)));
console.log(chalk.cyan.bold('테스트 결과 요약'));
console.log(chalk.cyan('='.repeat(70)));

console.log(chalk.green(`\n✅ 성공: ${passedTests}/${totalTests} (${Math.round(passedTests / totalTests * 100)}%)`));
console.log(chalk.red(`❌ 실패: ${totalTests - passedTests}/${totalTests}`));

if (failedLanguages.length > 0) {
  console.log(chalk.red('\n⚠️ 완전 실패한 언어:'));
  failedLanguages.forEach(lang => console.log(chalk.red(`  - ${lang}`)));
}

if (partialLanguages.length > 0) {
  console.log(chalk.yellow('\n⚠️ 부분적으로 실패한 언어:'));
  partialLanguages.forEach(lang => console.log(chalk.yellow(`  - ${lang}`)));
}

// 언어별 지원 현황
console.log(chalk.cyan('\n' + '='.repeat(70)));
console.log(chalk.cyan.bold('언어별 지원 현황'));
console.log(chalk.cyan('='.repeat(70)));

const languageStatus = testCases.map(tc => {
  const pauseOk = dateParser.parseDate(tc.pauseDate, tc.language) === tc.expectedPauseDate;
  const resumeOk = dateParser.parseDate(tc.resumeDate, tc.language) === tc.expectedResumeDate;
  
  let status = '✅';
  if (!pauseOk && !resumeOk) status = '❌';
  else if (!pauseOk || !resumeOk) status = '⚠️';
  
  return {
    name: tc.name.split(' ')[0],
    code: tc.language,
    status
  };
});

console.log('\n언어 코드별 상태:');
languageStatus.forEach(lang => {
  console.log(`  ${lang.status} ${lang.code.padEnd(3)} - ${lang.name}`);
});

// 성공률 기준 평가
const successRate = Math.round(passedTests / totalTests * 100);

console.log(chalk.cyan('\n' + '='.repeat(70)));
if (successRate === 100) {
  console.log(chalk.green.bold('🎉 완벽! 모든 언어에서 날짜 파싱이 정상 작동합니다!'));
  console.log(chalk.green('포르투갈어와 러시아어를 포함한 15개 언어가 모두 지원됩니다.'));
} else if (successRate >= 90) {
  console.log(chalk.green.bold('👍 우수! 대부분의 언어에서 정상 작동합니다.'));
  console.log(chalk.yellow('일부 언어는 추가 개선이 필요합니다.'));
} else if (successRate >= 70) {
  console.log(chalk.yellow.bold('⚠️ 개선 필요! 일부 언어에서 문제가 있습니다.'));
} else {
  console.log(chalk.red.bold('❌ 심각! 많은 언어에서 파싱이 실패합니다.'));
}

// 다음 단계 제안
console.log(chalk.cyan('\n다음 단계:'));
if (successRate === 100) {
  console.log(chalk.green('✓ npm run multilanguage:test - 실제 프로필로 통합 테스트'));
  console.log(chalk.green('✓ npm run pause - 프로덕션 환경에서 일시중지 워크플로우 실행'));
} else {
  console.log(chalk.yellow('1. EnhancedDateParsingService.js에서 실패한 언어 패턴 수정'));
  console.log(chalk.yellow('2. 이 스크립트를 다시 실행하여 검증'));
  console.log(chalk.yellow('3. 모든 테스트 통과 후 실제 프로필로 테스트'));
}

console.log(chalk.cyan('='.repeat(70)));

// 종료 코드
process.exit(successRate === 100 ? 0 : 1);