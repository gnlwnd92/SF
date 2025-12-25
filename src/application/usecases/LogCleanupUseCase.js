/**
 * LogCleanupUseCase - 로그 및 스크린샷 정리 유즈케이스
 *
 * 기능:
 * - 권장 보존 기간 또는 사용자 지정 기간으로 정리
 * - 0일: 모든 파일 삭제
 * - N일: N일 이전 파일만 삭제
 * - 권장: 디렉토리별 권장 보존 기간 적용
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chalk = require('chalk');

class LogCleanupUseCase {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    this.baseDir = process.cwd();

    // 정리 대상 디렉토리 및 권장 보존 기간 (시간 단위)
    this.cleanupTargets = [
      {
        path: 'logs/terminal',
        description: '터미널 로그 (JSON)',
        recommendedHours: 48,
        extensions: ['.json']
      },
      {
        path: 'logs/sessions',
        description: '세션 로그',
        recommendedHours: 48,
        extensions: ['.log']
      },
      {
        path: 'logs/errors',
        description: '에러 로그',
        recommendedHours: 168, // 7일
        extensions: ['.json', '.log']
      },
      {
        path: 'logs/screenshots',
        description: '결과 스크린샷',
        recommendedHours: 168, // 7일
        extensions: ['.png', '.jpg', '.jpeg']
      },
      {
        path: 'screenshots/debug',
        description: '디버그 스크린샷',
        recommendedHours: 24,
        extensions: ['.png', '.jpg', '.jpeg']
      },
      {
        path: 'screenshots',
        description: '임시 스크린샷 (루트)',
        recommendedHours: 24,
        extensions: ['.png', '.jpg', '.jpeg'],
        excludeSubdirs: true // 하위 디렉토리 제외 (debug 폴더는 별도 처리)
      }
    ];
  }

  /**
   * 메인 실행 - 정리 수행
   * @param {Object} options
   * @param {string} options.mode - 'recommended' | 'custom'
   * @param {number} options.days - custom 모드일 때 보존 기간 (일)
   * @param {boolean} options.dryRun - true면 실제 삭제 없이 미리보기만
   */
  async execute(options = {}) {
    const { mode = 'recommended', days = 0, dryRun = false } = options;

    console.log(chalk.cyan('\n🧹 로그 및 스크린샷 정리 시작'));
    console.log(chalk.gray('─'.repeat(50)));

    if (dryRun) {
      console.log(chalk.yellow('⚠️  미리보기 모드 (실제 삭제 없음)\n'));
    }

    const results = {
      totalFiles: 0,
      totalSize: 0,
      deletedFiles: 0,
      deletedSize: 0,
      errors: [],
      details: []
    };

    for (const target of this.cleanupTargets) {
      const targetPath = path.join(this.baseDir, target.path);

      // 디렉토리 존재 확인
      if (!fsSync.existsSync(targetPath)) {
        continue;
      }

      // 보존 시간 계산
      let retentionHours;
      if (mode === 'recommended') {
        retentionHours = target.recommendedHours;
      } else {
        retentionHours = days * 24; // 일 -> 시간 변환
      }

      const retentionMs = retentionHours * 60 * 60 * 1000;
      const cutoffTime = Date.now() - retentionMs;

      console.log(chalk.cyan(`\n📁 ${target.description}`));
      console.log(chalk.gray(`   경로: ${target.path}`));
      console.log(chalk.gray(`   보존: ${this.formatDuration(retentionHours)}`));

      const dirResult = await this.cleanDirectory(
        targetPath,
        cutoffTime,
        target.extensions,
        target.excludeSubdirs || false,
        dryRun
      );

      results.totalFiles += dirResult.totalFiles;
      results.totalSize += dirResult.totalSize;
      results.deletedFiles += dirResult.deletedFiles;
      results.deletedSize += dirResult.deletedSize;
      results.errors.push(...dirResult.errors);

      results.details.push({
        path: target.path,
        description: target.description,
        ...dirResult
      });

      // 결과 출력
      if (dirResult.deletedFiles > 0) {
        console.log(chalk.green(`   ✅ ${dirResult.deletedFiles}개 파일 정리 (${this.formatSize(dirResult.deletedSize)})`));
      } else if (dirResult.totalFiles > 0) {
        console.log(chalk.gray(`   ℹ️  정리할 파일 없음 (전체 ${dirResult.totalFiles}개)`));
      } else {
        console.log(chalk.gray(`   ℹ️  파일 없음`));
      }
    }

    // 최종 요약
    console.log(chalk.gray('\n' + '─'.repeat(50)));
    console.log(chalk.cyan('📊 정리 결과 요약'));
    console.log(chalk.gray('─'.repeat(50)));

    if (dryRun) {
      console.log(chalk.yellow(`   🔍 삭제 예정: ${results.deletedFiles}개 파일 (${this.formatSize(results.deletedSize)})`));
      console.log(chalk.yellow(`   📦 유지 예정: ${results.totalFiles - results.deletedFiles}개 파일`));
    } else {
      console.log(chalk.green(`   🗑️  삭제됨: ${results.deletedFiles}개 파일 (${this.formatSize(results.deletedSize)})`));
      console.log(chalk.blue(`   📦 유지됨: ${results.totalFiles - results.deletedFiles}개 파일`));
    }

    if (results.errors.length > 0) {
      console.log(chalk.red(`   ❌ 오류: ${results.errors.length}개`));
    }

    console.log(chalk.gray('─'.repeat(50)));

    return results;
  }

  /**
   * 디렉토리 정리
   */
  async cleanDirectory(dirPath, cutoffTime, extensions, excludeSubdirs, dryRun) {
    const result = {
      totalFiles: 0,
      totalSize: 0,
      deletedFiles: 0,
      deletedSize: 0,
      errors: []
    };

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // 하위 디렉토리 처리
          if (!excludeSubdirs) {
            const subResult = await this.cleanDirectory(
              entryPath,
              cutoffTime,
              extensions,
              false,
              dryRun
            );
            result.totalFiles += subResult.totalFiles;
            result.totalSize += subResult.totalSize;
            result.deletedFiles += subResult.deletedFiles;
            result.deletedSize += subResult.deletedSize;
            result.errors.push(...subResult.errors);
          }
          continue;
        }

        // 파일 처리
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.length > 0 && !extensions.includes(ext)) {
          continue; // 확장자 필터링
        }

        try {
          const stats = await fs.stat(entryPath);
          result.totalFiles++;
          result.totalSize += stats.size;

          // 수정 시간이 cutoff 이전이면 삭제 대상
          if (stats.mtimeMs < cutoffTime) {
            if (!dryRun) {
              await fs.unlink(entryPath);
            }
            result.deletedFiles++;
            result.deletedSize += stats.size;
          }
        } catch (error) {
          result.errors.push({
            path: entryPath,
            error: error.message
          });
        }
      }

      // 빈 디렉토리 정리 (dryRun이 아닐 때만)
      if (!dryRun && !excludeSubdirs) {
        await this.removeEmptyDirs(dirPath);
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        result.errors.push({
          path: dirPath,
          error: error.message
        });
      }
    }

    return result;
  }

  /**
   * 빈 디렉토리 제거
   */
  async removeEmptyDirs(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDirPath = path.join(dirPath, entry.name);
          await this.removeEmptyDirs(subDirPath);

          // 하위 디렉토리가 비었으면 삭제
          const subEntries = await fs.readdir(subDirPath);
          if (subEntries.length === 0) {
            await fs.rmdir(subDirPath);
          }
        }
      }
    } catch (error) {
      // 무시
    }
  }

  /**
   * 현재 상태 미리보기 (삭제 없이)
   */
  async preview() {
    console.log(chalk.cyan('\n📊 로그 및 스크린샷 현황'));
    console.log(chalk.gray('─'.repeat(60)));

    const stats = [];
    let grandTotalFiles = 0;
    let grandTotalSize = 0;

    for (const target of this.cleanupTargets) {
      const targetPath = path.join(this.baseDir, target.path);

      if (!fsSync.existsSync(targetPath)) {
        stats.push({
          ...target,
          totalFiles: 0,
          totalSize: 0,
          oldFiles: 0,
          oldSize: 0
        });
        continue;
      }

      const cutoffTime = Date.now() - (target.recommendedHours * 60 * 60 * 1000);
      const dirStats = await this.getDirectoryStats(
        targetPath,
        cutoffTime,
        target.extensions,
        target.excludeSubdirs || false
      );

      stats.push({
        ...target,
        ...dirStats
      });

      grandTotalFiles += dirStats.totalFiles;
      grandTotalSize += dirStats.totalSize;
    }

    // 테이블 출력
    console.log(chalk.white.bold(
      '  디렉토리'.padEnd(25) +
      '전체 파일'.padStart(12) +
      '전체 크기'.padStart(12) +
      '정리 대상'.padStart(12) +
      '정리 크기'.padStart(12)
    ));
    console.log(chalk.gray('─'.repeat(60)));

    let totalOldFiles = 0;
    let totalOldSize = 0;

    for (const stat of stats) {
      totalOldFiles += stat.oldFiles;
      totalOldSize += stat.oldSize;

      const oldFilesColor = stat.oldFiles > 0 ? chalk.yellow : chalk.gray;

      console.log(
        chalk.cyan(`  ${stat.path}`.padEnd(25)) +
        chalk.white(`${stat.totalFiles}개`.padStart(12)) +
        chalk.white(this.formatSize(stat.totalSize).padStart(12)) +
        oldFilesColor(`${stat.oldFiles}개`.padStart(12)) +
        oldFilesColor(this.formatSize(stat.oldSize).padStart(12))
      );
    }

    console.log(chalk.gray('─'.repeat(60)));
    console.log(
      chalk.white.bold('  합계'.padEnd(25)) +
      chalk.white.bold(`${grandTotalFiles}개`.padStart(12)) +
      chalk.white.bold(this.formatSize(grandTotalSize).padStart(12)) +
      chalk.yellow.bold(`${totalOldFiles}개`.padStart(12)) +
      chalk.yellow.bold(this.formatSize(totalOldSize).padStart(12))
    );
    console.log(chalk.gray('─'.repeat(60)));

    return {
      stats,
      grandTotalFiles,
      grandTotalSize,
      totalOldFiles,
      totalOldSize
    };
  }

  /**
   * 디렉토리 통계 조회
   */
  async getDirectoryStats(dirPath, cutoffTime, extensions, excludeSubdirs) {
    const result = {
      totalFiles: 0,
      totalSize: 0,
      oldFiles: 0,
      oldSize: 0
    };

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (!excludeSubdirs) {
            const subStats = await this.getDirectoryStats(
              entryPath,
              cutoffTime,
              extensions,
              false
            );
            result.totalFiles += subStats.totalFiles;
            result.totalSize += subStats.totalSize;
            result.oldFiles += subStats.oldFiles;
            result.oldSize += subStats.oldSize;
          }
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.length > 0 && !extensions.includes(ext)) {
          continue;
        }

        try {
          const stats = await fs.stat(entryPath);
          result.totalFiles++;
          result.totalSize += stats.size;

          if (stats.mtimeMs < cutoffTime) {
            result.oldFiles++;
            result.oldSize += stats.size;
          }
        } catch (error) {
          // 무시
        }
      }
    } catch (error) {
      // 무시
    }

    return result;
  }

  /**
   * 파일 크기 포맷팅
   */
  formatSize(bytes) {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
  }

  /**
   * 시간 포맷팅
   */
  formatDuration(hours) {
    if (hours === 0) return '모두 삭제';
    if (hours < 24) return `${hours}시간`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days}일`;
    return `${days}일 ${remainingHours}시간`;
  }

  /**
   * 권장 보존 기간 정보 반환
   */
  getRecommendedRetentionInfo() {
    return this.cleanupTargets.map(target => ({
      path: target.path,
      description: target.description,
      recommendedHours: target.recommendedHours,
      recommendedText: this.formatDuration(target.recommendedHours)
    }));
  }
}

module.exports = LogCleanupUseCase;
