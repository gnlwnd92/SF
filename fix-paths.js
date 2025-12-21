#!/usr/bin/env node

/**
 * 독립 실행 패키지 경로 수정 스크립트
 * 다른 컴퓨터에서도 작동하도록 모든 경로를 상대 경로로 수정
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

console.log(chalk.cyan.bold('🔧 독립 실행 패키지 경로 수정 중...'));
console.log();

let fixCount = 0;
let errorCount = 0;

// 1. 필수 디렉터리 생성
console.log(chalk.yellow('📁 필수 디렉터리 생성...'));
const dirs = ['credentials', 'logs', 'logs/daily', 'logs/errors', 'logs/sessions', 'logs/workflows', 'screenshots', 'backup', 'temp'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(chalk.green(`  ✅ ${dir} 폴더 생성됨`));
    fixCount++;
  } else {
    console.log(chalk.gray(`  ⏭️  ${dir} 폴더 이미 존재`));
  }
});

// 2. service_account.json 파일 이동 (있으면)
console.log();
console.log(chalk.yellow('📄 Service Account 파일 정리...'));
const oldPath = path.join(__dirname, 'service_account.json');
const newPath = path.join(__dirname, 'credentials', 'service-account.json');

if (fs.existsSync(oldPath)) {
  if (!fs.existsSync(newPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(chalk.green('  ✅ service_account.json을 credentials 폴더로 이동'));
    fixCount++;
  } else {
    fs.unlinkSync(oldPath);
    console.log(chalk.yellow('  ⚠️  중복 파일 제거 (credentials에 이미 존재)'));
    fixCount++;
  }
} else {
  console.log(chalk.gray('  ⏭️  이동할 파일 없음'));
}

// 3. container.js 수정
console.log();
console.log(chalk.yellow('🔨 container.js 경로 수정...'));
const containerPath = path.join(__dirname, 'src', 'container.js');

try {
  let containerContent = fs.readFileSync(containerPath, 'utf8');
  let modified = false;

  // 경로 수정 1: service_account.json
  if (containerContent.includes("path.join(process.cwd(), 'service_account.json')")) {
    containerContent = containerContent.replace(
      "path.join(process.cwd(), 'service_account.json')",
      "path.join(__dirname, '..', 'credentials', 'service-account.json')"
    );
    console.log(chalk.green('  ✅ Service Account 경로 수정'));
    modified = true;
    fixCount++;
  }

  // 경로 수정 2: 하드코딩된 Sheets ID 제거
  const hardcodedIds = [
    "'1kHXW5JRPNBzrgv1Nkx-UBEaNMBNTTmcTCq-hvJzIw3k'",
    "'1TlfNvqanGr0FRR9j1FLBijR2-8HUKqUqK3FMnhx5HaM'"
  ];

  hardcodedIds.forEach(id => {
    if (containerContent.includes(id)) {
      containerContent = containerContent.replace(
        new RegExp(`config\\.googleSheetsId \\|\\| ${id}`, 'g'),
        "config.googleSheetsId || process.env.GOOGLE_SHEETS_ID"
      );
      console.log(chalk.green(`  ✅ 하드코딩된 Sheets ID 제거: ${id.slice(1, 15)}...`));
      modified = true;
      fixCount++;
    }
  });

  // 경로 수정 3: process.cwd()를 __dirname으로
  if (containerContent.includes('process.cwd()')) {
    const cwdCount = (containerContent.match(/process\.cwd\(\)/g) || []).length;
    containerContent = containerContent.replace(
      /process\.cwd\(\)/g,
      "path.join(__dirname, '..')"
    );
    console.log(chalk.green(`  ✅ process.cwd() ${cwdCount}개를 상대 경로로 변경`));
    modified = true;
    fixCount++;
  }

  // 경로 수정 4: 기본 serviceAccountPath 수정
  if (!containerContent.includes("config.serviceAccountPath || path.join(__dirname")) {
    containerContent = containerContent.replace(
      /serviceAccountPath: config\.serviceAccountPath \|\| path\.join\([^)]+\)/g,
      "serviceAccountPath: config.serviceAccountPath || path.join(__dirname, '..', 'credentials', 'service-account.json')"
    );
    console.log(chalk.green('  ✅ 기본 serviceAccountPath 경로 수정'));
    modified = true;
    fixCount++;
  }

  if (modified) {
    fs.writeFileSync(containerPath, containerContent);
    console.log(chalk.green('  ✅ container.js 저장 완료'));
  } else {
    console.log(chalk.gray('  ⏭️  수정할 내용 없음'));
  }
} catch (error) {
  console.log(chalk.red(`  ❌ container.js 수정 실패: ${error.message}`));
  errorCount++;
}

// 4. index.js 수정 - 초기화 코드 추가
console.log();
console.log(chalk.yellow('🔨 index.js 초기화 코드 추가...'));
const indexPath = path.join(__dirname, 'index.js');

try {
  let indexContent = fs.readFileSync(indexPath, 'utf8');
  let modified = false;

  // 디렉터리 생성 코드 추가
  if (!indexContent.includes('// 필수 디렉터리 생성')) {
    const initCode = `
// 필수 디렉터리 생성
const requiredDirs = ['credentials', 'logs', 'logs/daily', 'logs/errors', 'logs/sessions', 'logs/workflows', 'screenshots', 'backup', 'temp'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});
`;
    
    // dotenv 로드 직후에 추가
    indexContent = indexContent.replace(
      "require('dotenv').config({ path: envPath });",
      `require('dotenv').config({ path: envPath });
${initCode}`
    );
    
    console.log(chalk.green('  ✅ 디렉터리 자동 생성 코드 추가'));
    modified = true;
    fixCount++;
  }

  // GOOGLE_SERVICE_ACCOUNT_PATH 기본값 수정
  if (indexContent.includes("'./credentials/service-account.json'") && 
      !indexContent.includes("path.join(__dirname, 'credentials'")) {
    indexContent = indexContent.replace(
      "process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json'",
      "process.env.GOOGLE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'credentials', 'service-account.json')"
    );
    console.log(chalk.green('  ✅ Google Service Account 경로 수정'));
    modified = true;
    fixCount++;
  }

  if (modified) {
    fs.writeFileSync(indexPath, indexContent);
    console.log(chalk.green('  ✅ index.js 저장 완료'));
  } else {
    console.log(chalk.gray('  ⏭️  수정할 내용 없음'));
  }
} catch (error) {
  console.log(chalk.red(`  ❌ index.js 수정 실패: ${error.message}`));
  errorCount++;
}

// 5. .env.example 업데이트
console.log();
console.log(chalk.yellow('📝 .env.example 업데이트...'));
const envExamplePath = path.join(__dirname, '.env.example');

if (fs.existsSync(envExamplePath)) {
  let envContent = fs.readFileSync(envExamplePath, 'utf8');
  
  // 잘못된 예시 수정
  if (envContent.includes('your_google_sheets_id_here')) {
    console.log(chalk.yellow('  ⚠️  .env.example에서 실제 Sheets ID 필요'));
    console.log(chalk.gray('      Google Sheets URL에서 ID를 복사하세요'));
  }
}

// 6. 최종 리포트
console.log();
console.log(chalk.cyan.bold('=' .repeat(60)));
console.log(chalk.cyan.bold('수정 완료 리포트'));
console.log(chalk.cyan.bold('=' .repeat(60)));
console.log();

if (errorCount === 0) {
  console.log(chalk.green(`✅ 모든 수정 완료! (${fixCount}개 항목 수정됨)`));
  console.log();
  console.log(chalk.white('다음 단계:'));
  console.log(chalk.cyan('  1. npm install        # 의존성 설치'));
  console.log(chalk.cyan('  2. npm run setup      # 환경 설정'));
  console.log(chalk.cyan('  3. npm test           # 연결 테스트'));
} else {
  console.log(chalk.red(`⚠️  일부 오류 발생 (성공: ${fixCount}, 실패: ${errorCount})`));
  console.log();
  console.log(chalk.yellow('수동으로 확인이 필요한 항목이 있습니다.'));
}

console.log();
console.log(chalk.gray('=' .repeat(60)));

// 7. 추가 권장사항
console.log();
console.log(chalk.blue('💡 추가 권장사항:'));
console.log(chalk.gray('  • credentials/service-account.json 파일 추가'));
console.log(chalk.gray('  • .env 파일에 GOOGLE_SHEETS_ID 설정'));
console.log(chalk.gray('  • Google Sheets에 Service Account 이메일 공유'));
console.log();