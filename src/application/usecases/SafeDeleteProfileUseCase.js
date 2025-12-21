/**
 * 안전한 프로필 삭제 유스케이스
 * 보안 검증과 백업 기능이 강화된 버전
 */

const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs-extra');
const path = require('path');

class SafeDeleteProfileUseCase {
    constructor({
        adsPowerAdapter,
        deleteSheetRepository,
        logger,
        config = {}
    }) {
        this.adsPowerAdapter = adsPowerAdapter;
        this.deleteSheetRepository = deleteSheetRepository;
        this.logger = logger;
        this.config = {
            batchSize: config.batchSize || 5,
            delayBetweenDeletes: config.delayBetweenDeletes || 2000,
            maxDailyDeletes: config.maxDailyDeletes || 50,
            testMode: config.testMode || false,
            backupEnabled: config.backupEnabled !== false,
            ...config
        };
        
        this.stats = {
            total: 0,
            deleted: 0,
            failed: 0,
            skipped: 0,
            backedUp: 0
        };

        // 보호된 프로필 ID 목록
        this.protectedProfiles = ['admin', 'master', 'main', 'default'];
        
        // 백업 디렉토리
        this.backupDir = path.join(__dirname, '../../../data/profile_backups');
    }

    /**
     * ID 형식 검증
     */
    validateProfileId(profileId) {
        if (!profileId || typeof profileId !== 'string') {
            return { valid: false, error: 'ID가 비어있거나 문자열이 아닙니다' };
        }

        // 공백 제거
        const trimmedId = profileId.trim();
        
        if (trimmedId.length === 0) {
            return { valid: false, error: 'ID가 비어있습니다' };
        }

        // AdsPower ID 형식 검증 (알파벳, 숫자, 언더스코어, 하이픈)
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
            return { valid: false, error: 'ID 형식이 올바르지 않습니다' };
        }

        // 보호된 프로필 체크
        if (this.protectedProfiles.includes(trimmedId.toLowerCase())) {
            return { valid: false, error: '보호된 프로필은 삭제할 수 없습니다' };
        }

        return { valid: true, id: trimmedId };
    }

    /**
     * 프로필 백업
     */
    async backupProfile(profile) {
        if (!this.config.backupEnabled) {
            return;
        }

        try {
            await fs.ensureDir(this.backupDir);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(
                this.backupDir,
                `${profile.id}_${timestamp}.json`
            );

            // AdsPower에서 프로필 상세 정보 가져오기
            const profileDetails = await this.adsPowerAdapter.getProfileDetails(profile.id);
            
            const backupData = {
                timestamp: new Date().toISOString(),
                profile: {
                    ...profile,
                    ...profileDetails
                },
                deletedBy: process.env.USER || 'unknown',
                reason: 'Google Sheets 삭제 탭에서 요청'
            };

            await fs.writeJson(backupFile, backupData, { spaces: 2 });
            
            this.logger.info(`프로필 백업 완료: ${backupFile}`);
            this.stats.backedUp++;
            
            return backupFile;
        } catch (error) {
            this.logger.error(`프로필 백업 실패: ${profile.id}`, error);
            // 백업 실패해도 삭제는 계속 진행 (설정에 따라)
            if (this.config.requireBackup) {
                throw new Error(`백업 실패로 삭제 중단: ${error.message}`);
            }
        }
    }

    /**
     * 오늘 삭제한 프로필 수 확인
     */
    async getTodayDeleteCount() {
        try {
            const logsDir = path.join(__dirname, '../../../logs');
            const today = new Date().toISOString().split('T')[0];
            const logFile = path.join(logsDir, `delete_audit_${today}.json`);
            
            if (await fs.pathExists(logFile)) {
                const logs = await fs.readJson(logFile);
                return logs.filter(log => log.action === 'DELETE_SUCCESS').length;
            }
            
            return 0;
        } catch (error) {
            this.logger.warn('삭제 카운트 확인 실패', error);
            return 0;
        }
    }

    /**
     * 감사 로그 저장
     */
    async saveAuditLog(action, profileId, result, details = {}) {
        try {
            const logsDir = path.join(__dirname, '../../../logs');
            await fs.ensureDir(logsDir);
            
            const today = new Date().toISOString().split('T')[0];
            const logFile = path.join(logsDir, `delete_audit_${today}.json`);
            
            let logs = [];
            if (await fs.pathExists(logFile)) {
                logs = await fs.readJson(logFile);
            }
            
            const logEntry = {
                timestamp: new Date().toISOString(),
                action,
                profileId,
                result,
                operator: process.env.USER || 'unknown',
                ...details
            };
            
            logs.push(logEntry);
            await fs.writeJson(logFile, logs, { spaces: 2 });
            
        } catch (error) {
            this.logger.error('감사 로그 저장 실패', error);
        }
    }

    /**
     * 실행
     */
    async execute() {
        console.log(chalk.red.bold('\n🗑️ 안전한 프로필 삭제 작업 시작\n'));
        console.log(chalk.gray('='.repeat(60)));
        
        // 테스트 모드 체크
        if (this.config.testMode) {
            console.log(chalk.yellow.bold('🧪 테스트 모드 활성화 - 실제 삭제되지 않습니다\n'));
        }
        
        try {
            // 1. 일일 삭제 제한 체크
            const todayDeletes = await this.getTodayDeleteCount();
            console.log(chalk.cyan(`오늘 삭제한 프로필: ${todayDeletes}/${this.config.maxDailyDeletes}`));
            
            // 2. 삭제 대상 프로필 로드
            const spinner = ora('삭제 대상 프로필 로드 중...').start();
            const profiles = await this.deleteSheetRepository.getProfilesToDelete();
            spinner.succeed(`${profiles.length}개 프로필 로드 완료`);
            
            if (profiles.length === 0) {
                console.log(chalk.yellow('\n⚠️ 삭제할 프로필이 없습니다.'));
                return this.stats;
            }
            
            // 3. 일일 제한 체크
            if (todayDeletes + profiles.length > this.config.maxDailyDeletes) {
                const available = this.config.maxDailyDeletes - todayDeletes;
                console.log(chalk.red(`\n❌ 일일 삭제 제한 초과!`));
                console.log(chalk.yellow(`   남은 삭제 가능 수: ${available}개`));
                console.log(chalk.yellow(`   요청된 삭제 수: ${profiles.length}개`));
                
                // 부분 삭제 옵션 제공
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const answer = await new Promise(resolve => {
                    rl.question(chalk.yellow(`${available}개만 삭제하시겠습니까? (y/N): `), resolve);
                });
                rl.close();
                
                if (answer.toLowerCase() !== 'y') {
                    console.log(chalk.gray('삭제 작업이 취소되었습니다.'));
                    return this.stats;
                }
                
                profiles.splice(available); // 제한 수만큼만 처리
            }
            
            this.stats.total = profiles.length;
            
            // 4. ID 검증
            console.log(chalk.cyan('\n📋 프로필 ID 검증 중...'));
            const validProfiles = [];
            const invalidProfiles = [];
            
            for (const profile of profiles) {
                const validation = this.validateProfileId(profile.id);
                if (validation.valid) {
                    profile.id = validation.id; // trim된 ID 사용
                    validProfiles.push(profile);
                } else {
                    invalidProfiles.push({ ...profile, error: validation.error });
                    console.log(chalk.red(`  ❌ ${profile.id}: ${validation.error}`));
                    
                    // 시트에 오류 기록
                    await this.deleteSheetRepository.updateDeleteStatus(
                        profile.rowNumber,
                        `검증실패: ${validation.error}`,
                        new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                    );
                }
            }
            
            if (invalidProfiles.length > 0) {
                console.log(chalk.yellow(`\n⚠️ ${invalidProfiles.length}개 프로필이 검증 실패`));
                this.stats.skipped = invalidProfiles.length;
            }
            
            if (validProfiles.length === 0) {
                console.log(chalk.yellow('\n삭제 가능한 프로필이 없습니다.'));
                return this.stats;
            }
            
            // 5. 프로필 정보 표시
            console.log(chalk.cyan(`\n📋 삭제 대상 프로필 (${validProfiles.length}개):`));
            validProfiles.forEach((profile, index) => {
                console.log(chalk.gray(`  ${index + 1}. ID: ${profile.id}, 이름: ${profile.name || 'N/A'}`));
            });
            
            // 6. 최종 확인 (강화된 확인)
            console.log(chalk.red.bold('\n⚠️ 경고: 삭제된 프로필은 복구할 수 없습니다!'));
            if (this.config.backupEnabled) {
                console.log(chalk.blue('📦 백업이 활성화되어 있습니다.'));
            }
            
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const confirmation = await new Promise(resolve => {
                rl.question(chalk.red('삭제하려면 "DELETE"를 입력하세요: '), resolve);
            });
            rl.close();
            
            if (confirmation !== 'DELETE') {
                console.log(chalk.gray('삭제 작업이 취소되었습니다.'));
                await this.saveAuditLog('DELETE_CANCELLED', 'N/A', 'CANCELLED', {
                    profileCount: validProfiles.length
                });
                return this.stats;
            }
            
            // 7. 배치 단위로 삭제 실행
            console.log(chalk.cyan('\n🔄 삭제 작업 진행 중...\n'));
            
            for (let i = 0; i < validProfiles.length; i += this.config.batchSize) {
                const batch = validProfiles.slice(i, Math.min(i + this.config.batchSize, validProfiles.length));
                await this.processBatch(batch, i / this.config.batchSize + 1);
                
                // 마지막 배치가 아니면 대기
                if (i + this.config.batchSize < validProfiles.length) {
                    await this.delay(this.config.delayBetweenDeletes);
                }
            }
            
            // 8. 결과 요약
            this.printSummary();
            
            return this.stats;
            
        } catch (error) {
            this.logger.error('프로필 삭제 중 오류 발생', error);
            console.error(chalk.red('\n❌ 삭제 작업 실패:'), error.message);
            
            await this.saveAuditLog('DELETE_ERROR', 'N/A', 'ERROR', {
                error: error.message
            });
            
            throw error;
        }
    }
    
    /**
     * 배치 처리
     */
    async processBatch(profiles, batchNumber) {
        console.log(chalk.blue(`\n배치 ${batchNumber} 처리 중 (${profiles.length}개)...`));
        
        for (const profile of profiles) {
            await this.deleteProfile(profile);
        }
    }
    
    /**
     * 개별 프로필 삭제
     */
    async deleteProfile(profile) {
        try {
            // 상태를 '삭제중'으로 먼저 업데이트
            await this.deleteSheetRepository.updateDeleteStatus(
                profile.rowNumber,
                '삭제중...',
                new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            );
            
            // 백업
            if (this.config.backupEnabled) {
                console.log(chalk.blue(`  📦 ${profile.id} 백업 중...`));
                await this.backupProfile(profile);
            }
            
            // 테스트 모드면 실제 삭제 건너뛰기
            if (this.config.testMode) {
                console.log(chalk.yellow(`  🧪 ${profile.id} (테스트 모드 - 삭제 시뮬레이션)`));
                
                // 테스트 모드에서도 시트 업데이트
                await this.deleteSheetRepository.updateDeleteStatus(
                    profile.rowNumber,
                    '삭제완료(테스트)',
                    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                );
                
                this.stats.deleted++;
                return { success: true, testMode: true };
            }
            
            // AdsPower에서 프로필 삭제
            const result = await this.adsPowerAdapter.deleteProfile(profile.id);
            
            if (result.success) {
                this.stats.deleted++;
                console.log(chalk.green(`  ✅ ${profile.id} 삭제 완료`));
                
                // 성공 상태 업데이트
                await this.deleteSheetRepository.updateDeleteStatus(
                    profile.rowNumber,
                    '삭제완료',
                    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                );
                
                // 감사 로그
                await this.saveAuditLog('DELETE_SUCCESS', profile.id, 'SUCCESS', {
                    profileName: profile.name,
                    backupFile: this.config.backupEnabled ? 'Yes' : 'No'
                });
                
            } else {
                this.stats.failed++;
                const errorMsg = result.error || '알 수 없는 오류';
                console.log(chalk.red(`  ❌ ${profile.id} 삭제 실패: ${errorMsg}`));
                
                // 실패 상태 업데이트
                await this.deleteSheetRepository.updateDeleteStatus(
                    profile.rowNumber,
                    `실패: ${errorMsg}`,
                    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                );
                
                // 감사 로그
                await this.saveAuditLog('DELETE_FAILED', profile.id, 'FAILED', {
                    error: errorMsg
                });
            }
            
            return result;
            
        } catch (error) {
            this.logger.error(`프로필 ${profile.id} 삭제 실패`, error);
            this.stats.failed++;
            
            // 에러 상태 업데이트
            try {
                await this.deleteSheetRepository.updateDeleteStatus(
                    profile.rowNumber,
                    `오류: ${error.message}`,
                    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                );
                
                // 감사 로그
                await this.saveAuditLog('DELETE_ERROR', profile.id, 'ERROR', {
                    error: error.message
                });
            } catch (updateError) {
                this.logger.error('상태 업데이트 실패', updateError);
            }
            
            throw error;
        }
    }
    
    /**
     * 결과 요약 출력
     */
    printSummary() {
        console.log(chalk.cyan('\n' + '='.repeat(60)));
        console.log(chalk.cyan.bold('📊 삭제 작업 결과\n'));
        
        console.log(chalk.white(`  • 전체: ${this.stats.total}개`));
        console.log(chalk.green(`  • 삭제 성공: ${this.stats.deleted}개`));
        console.log(chalk.red(`  • 삭제 실패: ${this.stats.failed}개`));
        console.log(chalk.gray(`  • 건너뜀: ${this.stats.skipped}개`));
        
        if (this.config.backupEnabled) {
            console.log(chalk.blue(`  • 백업됨: ${this.stats.backedUp}개`));
        }
        
        const successRate = this.stats.total > 0 
            ? ((this.stats.deleted / this.stats.total) * 100).toFixed(1)
            : 0;
        
        console.log(chalk.cyan(`\n  성공률: ${successRate}%`));
        
        if (this.config.testMode) {
            console.log(chalk.yellow('\n  🧪 테스트 모드였습니다. 실제 삭제되지 않았습니다.'));
        }
        
        console.log(chalk.cyan('='.repeat(60)));
    }
    
    /**
     * 지연 유틸리티
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SafeDeleteProfileUseCase;