/**
 * 프로필 삭제 유스케이스
 * Google Sheets '삭제' 탭에서 프로필 정보를 읽어 AdsPower에서 삭제
 */

const chalk = require('chalk');
const ora = require('ora');

class DeleteProfileUseCase {
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
            ...config
        };
        
        this.stats = {
            total: 0,
            deleted: 0,
            failed: 0,
            skipped: 0
        };
    }

    /**
     * 실행
     */
    async execute() {
        console.log(chalk.red.bold('\n🗑️ 프로필 삭제 작업 시작\n'));
        console.log(chalk.gray('='.repeat(60)));
        
        try {
            // 1. 삭제 대상 프로필 로드
            const spinner = ora('삭제 대상 프로필 로드 중...').start();
            const profiles = await this.deleteSheetRepository.getProfilesToDelete();
            spinner.succeed(`${profiles.length}개 프로필 로드 완료`);
            
            if (profiles.length === 0) {
                console.log(chalk.yellow('\n⚠️ 삭제할 프로필이 없습니다.'));
                return this.stats;
            }
            
            this.stats.total = profiles.length;
            
            // 2. 프로필 정보 표시
            console.log(chalk.cyan('\n📋 삭제 대상 프로필:'));
            profiles.forEach((profile, index) => {
                console.log(chalk.gray(`  ${index + 1}. ID: ${profile.id}, 이름: ${profile.name || 'N/A'}`));
            });
            
            // 3. 삭제 확인
            console.log(chalk.yellow('\n⚠️ 주의: 삭제된 프로필은 복구할 수 없습니다!'));
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise(resolve => {
                rl.question(chalk.red('정말 삭제하시겠습니까? (yes/N): '), resolve);
            });
            rl.close();
            
            if (answer.toLowerCase() !== 'yes') {
                console.log(chalk.gray('삭제 작업이 취소되었습니다.'));
                return this.stats;
            }
            
            // 4. 배치 단위로 삭제 실행
            console.log(chalk.cyan('\n🔄 삭제 작업 진행 중...\n'));
            
            for (let i = 0; i < profiles.length; i += this.config.batchSize) {
                const batch = profiles.slice(i, Math.min(i + this.config.batchSize, profiles.length));
                await this.processBatch(batch, i / this.config.batchSize + 1);
                
                // 마지막 배치가 아니면 대기
                if (i + this.config.batchSize < profiles.length) {
                    await this.delay(this.config.delayBetweenDeletes);
                }
            }
            
            // 5. 결과 요약
            this.printSummary();
            
            return this.stats;
            
        } catch (error) {
            this.logger.error('프로필 삭제 중 오류 발생', error);
            console.error(chalk.red('\n❌ 삭제 작업 실패:'), error.message);
            throw error;
        }
    }
    
    /**
     * 배치 처리
     */
    async processBatch(profiles, batchNumber) {
        console.log(chalk.blue(`\n배치 ${batchNumber} 처리 중...`));
        
        const promises = profiles.map(profile => this.deleteProfile(profile));
        const results = await Promise.allSettled(promises);
        
        results.forEach((result, index) => {
            const profile = profiles[index];
            if (result.status === 'fulfilled' && result.value.success) {
                this.stats.deleted++;
                console.log(chalk.green(`  ✅ ${profile.id} 삭제 완료`));
            } else {
                this.stats.failed++;
                const error = result.reason || result.value?.error || '알 수 없는 오류';
                console.log(chalk.red(`  ❌ ${profile.id} 삭제 실패: ${error}`));
            }
        });
    }
    
    /**
     * 개별 프로필 삭제
     */
    async deleteProfile(profile) {
        try {
            // AdsPower에서 프로필 삭제
            const result = await this.adsPowerAdapter.deleteProfile(profile.id);
            
            // 결과를 Google Sheets에 업데이트
            const status = result.success ? '삭제완료' : `실패: ${result.error}`;
            const timestamp = new Date().toLocaleString('ko-KR', { 
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            await this.deleteSheetRepository.updateDeleteStatus(
                profile.rowNumber,
                status,
                timestamp
            );
            
            return result;
            
        } catch (error) {
            this.logger.error(`프로필 ${profile.id} 삭제 실패`, error);
            
            // 에러 상태 업데이트
            try {
                await this.deleteSheetRepository.updateDeleteStatus(
                    profile.rowNumber,
                    `오류: ${error.message}`,
                    new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                );
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
        
        const successRate = this.stats.total > 0 
            ? ((this.stats.deleted / this.stats.total) * 100).toFixed(1)
            : 0;
        
        console.log(chalk.cyan(`\n  성공률: ${successRate}%`));
        console.log(chalk.cyan('='.repeat(60)));
    }
    
    /**
     * 지연 유틸리티
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = DeleteProfileUseCase;