/**
 * 최적화된 프로필 삭제 Use Case
 * - 병렬 처리로 속도 향상
 * - 배치 업데이트로 Google Sheets API 쿼터 관리
 * - 재시도 로직 포함
 */

const chalk = require('chalk');
const pLimit = require('p-limit');
const ora = require('ora');

// 설정 상수
const CONFIG = {
    CONCURRENT_DELETES: 3,      // 동시 삭제 프로필 수
    BATCH_UPDATE_SIZE: 50,       // Google Sheets 배치 업데이트 크기
    UPDATE_INTERVAL: 5000,       // Sheets 업데이트 주기 (5초)
    API_DELAY: 500,             // API 호출 간 지연 (ms)
    MAX_RETRIES: 3,             // 최대 재시도 횟수
    SHEETS_QUOTA_DELAY: 1100    // Sheets API 쿼터 관리 지연 (1.1초)
};

class OptimizedDeleteProfileUseCase {
    constructor({ 
        deleteSheetRepository, 
        adsPowerAdapter, 
        logger 
    }) {
        this.deleteSheetRepository = deleteSheetRepository;
        this.adsPowerAdapter = adsPowerAdapter;
        this.logger = logger;
        
        // 결과 저장용
        this.pendingUpdates = [];
        this.results = {
            success: [],
            failed: [],
            error: []
        };
        
        // 통계
        this.stats = {
            startTime: null,
            endTime: null,
            totalProfiles: 0,
            processedCount: 0,
            sheetsUpdates: 0
        };
        
        this.spinner = null;
        this.updateInterval = null;
    }
    
    /**
     * 프로필 삭제 (재시도 로직 포함)
     */
    async deleteProfileWithRetry(profile, retries = CONFIG.MAX_RETRIES) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const result = await this.adsPowerAdapter.deleteProfile(profile.id);
                
                if (result.success) {
                    return { success: true, profile };
                } else if (attempt === retries) {
                    return { success: false, profile, error: result.error };
                }
                
                // 재시도 전 지연
                await this.delay(CONFIG.API_DELAY * attempt);
                
            } catch (error) {
                if (attempt === retries) {
                    return { success: false, profile, error: error.message };
                }
                await this.delay(CONFIG.API_DELAY * attempt);
            }
        }
    }
    
    /**
     * 배치 업데이트 실행
     */
    async flushPendingUpdates(force = false) {
        if (this.pendingUpdates.length === 0) return;
        
        // 강제 실행이 아니면 배치 크기 확인
        if (!force && this.pendingUpdates.length < CONFIG.BATCH_UPDATE_SIZE) {
            return;
        }
        
        const updates = [...this.pendingUpdates];
        this.pendingUpdates = [];
        
        try {
            // Spinner 일시 정지
            if (this.spinner) {
                this.spinner.stop();
            }
            
            console.log(chalk.cyan(`\n📝 Google Sheets 배치 업데이트 (${updates.length}개)...`));
            
            // 배치 업데이트 실행
            await this.deleteSheetRepository.batchUpdateStatus(updates);
            
            this.stats.sheetsUpdates++;
            console.log(chalk.green(`✅ ${updates.length}개 행 업데이트 완료`));
            
            // Spinner 재시작
            if (this.spinner) {
                this.updateSpinner();
            }
            
            // API 쿼터 관리를 위한 지연
            await this.delay(CONFIG.SHEETS_QUOTA_DELAY);
            
        } catch (error) {
            console.error(chalk.red(`❌ 배치 업데이트 실패: ${error.message}`));
            this.logger.error('배치 업데이트 실패', error);
            
            // 실패한 업데이트는 다시 대기열에 추가
            this.pendingUpdates.push(...updates);
            
            // 쿼터 초과 시 더 긴 지연
            if (error.message.includes('Quota exceeded')) {
                console.log(chalk.yellow('⏳ API 쿼터 대기 중 (60초)...'));
                await this.delay(60000);
            }
        }
    }
    
    /**
     * 주기적 업데이트 시작
     */
    startPeriodicUpdate() {
        this.updateInterval = setInterval(async () => {
            await this.flushPendingUpdates();
        }, CONFIG.UPDATE_INTERVAL);
    }
    
    /**
     * 주기적 업데이트 중지
     */
    stopPeriodicUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
    
    /**
     * 지연 함수
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Spinner 업데이트
     */
    updateSpinner() {
        const processed = this.stats.processedCount;
        const total = this.stats.totalProfiles;
        const percentage = ((processed / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
        const rate = processed > 0 ? (processed / elapsed).toFixed(1) : '0';
        
        const text = `진행: [${processed}/${total}] ${percentage}% | ` +
                    `성공: ${this.results.success.length} | ` +
                    `실패: ${this.results.failed.length} | ` +
                    `속도: ${rate}/초`;
        
        if (this.spinner) {
            this.spinner.text = text;
            this.spinner.start();
        }
    }
    
    /**
     * 메인 실행 함수
     */
    async execute() {
        console.log(chalk.blue('═'.repeat(60)));
        console.log(chalk.blue.bold('🚀 최적화된 프로필 삭제'));
        console.log(chalk.blue('═'.repeat(60)));
        
        try {
            // 1. 삭제 대상 프로필 로드
            console.log(chalk.cyan('\n📋 삭제 대상 프로필 로드 중...'));
            const profiles = await this.deleteSheetRepository.getProfilesToDelete();
            
            if (profiles.length === 0) {
                console.log(chalk.yellow('\n⚠️ 삭제할 프로필이 없습니다.'));
                console.log(chalk.gray('Google Sheets의 "삭제" 탭에 프로필을 추가하고 다시 시도하세요.'));
                return {
                    success: 0,
                    failed: 0,
                    total: 0
                };
            }
            
            this.stats.totalProfiles = profiles.length;
            
            // 프로필 목록 표시
            console.log(chalk.green(`\n✅ ${profiles.length}개 프로필 발견`));
            console.log(chalk.gray(`설정: 동시 ${CONFIG.CONCURRENT_DELETES}개 처리, ${CONFIG.BATCH_UPDATE_SIZE}개씩 배치 업데이트`));
            
            // 샘플 표시 (처음 5개)
            console.log(chalk.cyan('\n프로필 샘플:'));
            profiles.slice(0, 5).forEach((profile, index) => {
                console.log(chalk.gray(`  ${index + 1}. ${profile.id} - ${profile.email || profile.name}`));
            });
            if (profiles.length > 5) {
                console.log(chalk.gray(`  ... 외 ${profiles.length - 5}개`));
            }
            
            // 2. 사용자 확인
            const inquirer = require('inquirer');
            const { confirmDelete } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmDelete',
                    message: chalk.red.bold(`⚠️ 정말로 ${profiles.length}개 프로필을 삭제하시겠습니까? (복구 불가)`),
                    default: false
                }
            ]);
            
            if (!confirmDelete) {
                console.log(chalk.yellow('\n❌ 삭제 취소'));
                return {
                    success: 0,
                    failed: 0,
                    total: profiles.length,
                    cancelled: true
                };
            }
            
            // 3. 삭제 작업 실행
            console.log(chalk.cyan('\n🔄 삭제 작업 시작...\n'));
            this.stats.startTime = Date.now();
            
            // Spinner 시작
            this.spinner = ora('삭제 진행 중...').start();
            
            // 주기적 업데이트 시작
            this.startPeriodicUpdate();
            
            // 동시 실행 제한 설정
            const limit = pLimit(CONFIG.CONCURRENT_DELETES);
            
            // 병렬 처리 작업 생성
            const deletePromises = profiles.map(profile => 
                limit(async () => {
                    const result = await this.deleteProfileWithRetry(profile);
                    
                    // 결과 처리
                    const timestamp = new Date().toLocaleString('ko-KR');
                    
                    if (result.success) {
                        this.results.success.push(result.profile);
                        this.pendingUpdates.push({
                            rowNumber: result.profile.rowNumber,
                            status: '삭제 완료',
                            timestamp
                        });
                        this.logger.info(`프로필 삭제 성공: ${result.profile.id}`);
                    } else {
                        this.results.failed.push(result);
                        this.pendingUpdates.push({
                            rowNumber: result.profile.rowNumber,
                            status: `실패: ${result.error}`,
                            timestamp
                        });
                        this.logger.warn(`프로필 삭제 실패: ${result.profile.id} - ${result.error}`);
                    }
                    
                    this.stats.processedCount++;
                    this.updateSpinner();
                    
                    // 배치 크기 도달 시 즉시 업데이트
                    if (this.pendingUpdates.length >= CONFIG.BATCH_UPDATE_SIZE) {
                        await this.flushPendingUpdates();
                    }
                    
                    // API 부하 관리
                    await this.delay(CONFIG.API_DELAY);
                })
            );
            
            // 모든 삭제 작업 완료 대기
            await Promise.all(deletePromises);
            
            // Spinner 종료
            if (this.spinner) {
                this.spinner.stop();
                this.spinner = null;
            }
            
            // 주기적 업데이트 중지
            this.stopPeriodicUpdate();
            
            // 남은 업데이트 처리
            await this.flushPendingUpdates(true);
            
            this.stats.endTime = Date.now();
            
            // 4. 결과 요약
            this.showResults();
            
            return {
                success: this.results.success.length,
                failed: this.results.failed.length,
                total: this.stats.totalProfiles,
                duration: (this.stats.endTime - this.stats.startTime) / 1000
            };
            
        } catch (error) {
            console.error(chalk.red('\n❌ 워크플로우 실패:'), error.message);
            this.logger.error('삭제 워크플로우 실패', error);
            
            if (this.spinner) {
                this.spinner.fail('삭제 작업 실패');
                this.spinner = null;
            }
            
            throw error;
            
        } finally {
            // Spinner 강제 종료
            if (this.spinner) {
                if (this.spinner.isSpinning) {
                    this.spinner.stop();
                }
                this.spinner = null;
            }
            
            this.stopPeriodicUpdate();
            
            // 남은 업데이트 강제 처리
            if (this.pendingUpdates.length > 0) {
                await this.flushPendingUpdates(true);
            }
        }
    }
    
    /**
     * 결과 표시
     */
    showResults() {
        const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(1);
        const rate = this.stats.totalProfiles > 0 ? (this.stats.totalProfiles / duration).toFixed(1) : '0';
        
        console.log(chalk.blue('\n' + '═'.repeat(60)));
        console.log(chalk.blue.bold('📊 삭제 작업 결과'));
        console.log(chalk.blue('═'.repeat(60)));
        
        console.log(chalk.white('\n📈 통계:'));
        console.log(chalk.cyan(`  • 전체: ${this.stats.totalProfiles}개`));
        console.log(chalk.green(`  • 성공: ${this.results.success.length}개`));
        console.log(chalk.red(`  • 실패: ${this.results.failed.length}개`));
        console.log(chalk.white(`  • 소요 시간: ${duration}초`));
        console.log(chalk.white(`  • 처리 속도: ${rate}개/초`));
        console.log(chalk.white(`  • Sheets 업데이트: ${this.stats.sheetsUpdates}회`));
        
        // 성공률 계산
        const successRate = this.stats.totalProfiles > 0 
            ? (this.results.success.length / this.stats.totalProfiles * 100).toFixed(1)
            : '0';
        console.log(chalk.white('\n📊 성공률: ') + 
                   (successRate >= 80 ? chalk.green : successRate >= 50 ? chalk.yellow : chalk.red)
                   (`${successRate}%`));
        
        // 실패한 프로필 표시 (처음 10개만)
        if (this.results.failed.length > 0) {
            console.log(chalk.red('\n❌ 실패한 프로필:'));
            this.results.failed.slice(0, 10).forEach(({ profile, error }) => {
                console.log(chalk.gray(`  - ${profile.id}: ${error}`));
            });
            if (this.results.failed.length > 10) {
                console.log(chalk.gray(`  ... 외 ${this.results.failed.length - 10}개`));
            }
            
            // 실패 로그 파일 저장
            try {
                const fs = require('fs');
                const path = require('path');
                const logsDir = path.join(process.cwd(), 'logs');
                
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }
                
                const failedFile = path.join(logsDir, `failed-profiles-${new Date().toISOString().split('T')[0]}.json`);
                fs.writeFileSync(
                    failedFile,
                    JSON.stringify(this.results.failed, null, 2)
                );
                console.log(chalk.yellow(`\n💾 실패 목록 저장: ${failedFile}`));
            } catch (err) {
                this.logger.error('실패 로그 저장 실패', err);
            }
        }
        
        console.log(chalk.blue('\n' + '═'.repeat(60)));
    }
}

module.exports = OptimizedDeleteProfileUseCase;