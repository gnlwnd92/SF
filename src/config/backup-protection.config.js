/**
 * 백업 보호 설정 파일
 * 
 * 중요한 백업 데이터를 보호하고 실수로 삭제되지 않도록 관리
 */

const path = require('path');

// 보호된 디렉토리 목록
const PROTECTED_DIRECTORIES = [
  'data/backup_completed',           // 완성된 백업 파일
  'data/backup_completed_archive',   // 아카이브된 백업
  'data/critical_backups',          // 중요 백업
  'credentials',                     // 인증 정보
  'backups/permanent'               // 영구 보관 백업
];

// 보호된 파일 패턴
const PROTECTED_FILE_PATTERNS = [
  /^애즈파워현황_\d{4}_\d{2}_\d{2}_final\.txt$/,  // 최종 백업 파일
  /^profiles_.*_verified\.txt$/,                    // 검증된 프로필
  /^backup_.*_protected\.*/,                        // 보호 표시된 백업
  /\.protected\./,                                  // .protected. 포함 파일
  /^DO_NOT_DELETE/                                  // 삭제 금지 표시 파일
];

// 백업 보관 정책
const RETENTION_POLICY = {
  // 폴더별 보관 기간 (일)
  'data/txt-backup': 30,              // 일반 백업: 30일
  'data/backup_completed': Infinity,   // 완성 백업: 영구 보관
  'data/processed': 7,                 // 처리된 파일: 7일
  'data/temp': 1,                      // 임시 파일: 1일
  'screenshots': 14,                   // 스크린샷: 14일
  'logs': 60,                         // 로그: 60일
  'checkpoints': 3                    // 체크포인트: 3일
};

// 자동 정리 제외 목록
const CLEANUP_EXCLUSIONS = [
  'data/backup_completed/**/*',       // 완성 백업 전체 제외
  'data/backup_completed_archive/**/*',
  '**/*.protected.*',                 // 보호 표시 파일
  '**/DO_NOT_DELETE*',               // 삭제 금지 파일
  '**/.gitkeep'                      // Git 유지 파일
];

/**
 * 디렉토리가 보호되어 있는지 확인
 */
function isProtectedDirectory(dirPath) {
  const normalizedPath = path.normalize(dirPath).replace(/\\/g, '/');
  
  return PROTECTED_DIRECTORIES.some(protectedDir => {
    const protectedPath = path.normalize(protectedDir).replace(/\\/g, '/');
    return normalizedPath.includes(protectedPath);
  });
}

/**
 * 파일이 보호되어 있는지 확인
 */
function isProtectedFile(filePath) {
  const basename = path.basename(filePath);
  const dirPath = path.dirname(filePath);
  
  // 보호된 디렉토리 내의 파일인지 확인
  if (isProtectedDirectory(dirPath)) {
    return true;
  }
  
  // 보호된 파일 패턴과 일치하는지 확인
  return PROTECTED_FILE_PATTERNS.some(pattern => pattern.test(basename));
}

/**
 * 파일 삭제 가능 여부 확인
 */
function canDelete(filePath, options = {}) {
  // 강제 삭제 옵션이 있어도 backup_completed는 보호
  if (filePath.includes('backup_completed')) {
    if (!options.allowBackupCompleted) {
      return {
        canDelete: false,
        reason: 'backup_completed 폴더는 영구 보호됨'
      };
    }
  }
  
  // 보호된 파일인지 확인
  if (isProtectedFile(filePath)) {
    return {
      canDelete: false,
      reason: '보호된 파일'
    };
  }
  
  // 보관 기간 확인
  const dir = Object.keys(RETENTION_POLICY).find(d => 
    filePath.includes(d.replace(/\//g, path.sep))
  );
  
  if (dir && RETENTION_POLICY[dir] === Infinity) {
    return {
      canDelete: false,
      reason: '영구 보관 대상'
    };
  }
  
  return {
    canDelete: true,
    reason: null
  };
}

/**
 * 백업 파일 보호 표시 추가
 */
function markAsProtected(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);
  
  return path.join(dir, `${basename}.protected${ext}`);
}

/**
 * 보관 기간 계산
 */
function getRetentionDays(filePath) {
  const dir = Object.keys(RETENTION_POLICY).find(d => 
    filePath.includes(d.replace(/\//g, path.sep))
  );
  
  return dir ? RETENTION_POLICY[dir] : 30; // 기본 30일
}

/**
 * 정리 대상인지 확인
 */
function shouldCleanup(filePath, fileAge) {
  // 보호된 파일은 정리하지 않음
  if (!canDelete(filePath).canDelete) {
    return false;
  }
  
  const retentionDays = getRetentionDays(filePath);
  
  // 무한 보관인 경우
  if (retentionDays === Infinity) {
    return false;
  }
  
  // 파일 나이가 보관 기간을 초과했는지 확인
  const ageDays = fileAge / (1000 * 60 * 60 * 24);
  return ageDays > retentionDays;
}

/**
 * 안전한 삭제 확인
 */
async function confirmDeletion(files, options = {}) {
  const protectedFiles = files.filter(f => !canDelete(f).canDelete);
  const deletableFiles = files.filter(f => canDelete(f).canDelete);
  
  if (protectedFiles.length > 0) {
    console.log('⚠️ 다음 파일들은 보호되어 삭제할 수 없습니다:');
    protectedFiles.forEach(f => {
      const result = canDelete(f);
      console.log(`  - ${path.basename(f)} (${result.reason})`);
    });
  }
  
  if (deletableFiles.length === 0) {
    return [];
  }
  
  if (!options.skipConfirmation) {
    console.log(`\n${deletableFiles.length}개 파일을 삭제하시겠습니까?`);
    // 여기에 사용자 확인 로직 추가
  }
  
  return deletableFiles;
}

module.exports = {
  PROTECTED_DIRECTORIES,
  PROTECTED_FILE_PATTERNS,
  RETENTION_POLICY,
  CLEANUP_EXCLUSIONS,
  isProtectedDirectory,
  isProtectedFile,
  canDelete,
  markAsProtected,
  getRetentionDays,
  shouldCleanup,
  confirmDeletion
};