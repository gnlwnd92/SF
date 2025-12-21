/**
 * 📥 Google Sheets → TXT 파일 복원 Use Case
 * 
 * Google Sheets에서 데이터를 읽어 TXT 파일로 복원하는 기능
 * Clean Architecture 패턴을 따라 구현
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

class TxtRestoreUseCase {
    constructor({ googleSheetsRepository, logger }) {
        this.googleSheetsRepository = googleSheetsRepository;
        this.logger = logger;
        
        this.config = {
            restoreOutputDir: './data/restore_output',
            sourceSheetName: '백업',
            batchSize: 1000,
            maxRetries: 3,
            retryDelay: 2000,
            fileFormat: 'txt', // txt 또는 tsv
            encoding: 'utf-8'
        };

        // 24개 필드 템플릿 헤더
        this.templateHeaders = [
            'acc_id', 'id', 'group', 'name', 'remark', 'tags',
            'tab', 'platform', 'username', 'password', 'fakey', 'cookie',
            'proxytype', 'ipchecker', 'proxy', 'proxyurl', 'proxyid',
            'ip', 'countrycode', 'ua', 'resolution', 'sharee',
            'share_time', 'source_file'
        ];

        this.stats = {
            totalProfiles: 0,
            restoredProfiles: 0,
            filesCreated: [],
            errors: [],
            startTime: null,
            endTime: null
        };
    }

    /**
     * 메인 실행 메서드
     * @param {Object} options - 복원 옵션
     * @param {string} options.filter - 필터 조건 (group, tab 등)
     * @param {number} options.limit - 복원할 최대 프로필 수
     * @param {string} options.outputFileName - 출력 파일명
     */
    async execute(options = {}) {
        console.log(chalk.blue.bold('\n📥 Google Sheets → TXT 복원 시작\n'));
        console.log(chalk.gray('='.repeat(60)));

        this.stats.startTime = new Date();

        try {
            // 1. 디렉터리 준비
            await this.ensureDirectories();

            // 2. Google Sheets에서 데이터 읽기
            const profiles = await this.fetchProfilesFromSheets(options.filter, options.limit);
            
            if (profiles.length === 0) {
                console.log(chalk.yellow('⚠️ 복원할 프로필이 없습니다.'));
                return this.stats;
            }

            this.stats.totalProfiles = profiles.length;
            console.log(chalk.cyan(`📊 복원할 프로필: ${profiles.length}개`));

            // 3. 그룹별로 분류
            const groupedProfiles = this.groupProfiles(profiles);

            // 4. TXT 파일 생성
            await this.createTxtFiles(groupedProfiles, options.outputFileName);

            // 5. 통계 출력
            this.stats.endTime = new Date();
            this.printStatistics();

            return this.stats;

        } catch (error) {
            this.logger.error('복원 실행 중 오류', error);
            console.error(chalk.red('❌ 복원 실행 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 디렉터리 확인 및 생성
     */
    async ensureDirectories() {
        await fs.ensureDir(this.config.restoreOutputDir);
        console.log(chalk.gray(`📁 복원 디렉터리: ${this.config.restoreOutputDir}`));
    }

    /**
     * Google Sheets에서 프로필 데이터 가져오기
     */
    async fetchProfilesFromSheets(filter, limit) {
        console.log(chalk.blue('🔄 Google Sheets에서 데이터 읽기 중...'));
        
        try {
            // 시트 존재 확인
            const sheetExists = await this.googleSheetsRepository.checkSheetExists(this.config.sourceSheetName);
            if (!sheetExists) {
                throw new Error(`'${this.config.sourceSheetName}' 시트를 찾을 수 없습니다.`);
            }

            // 전체 데이터 읽기
            const range = `${this.config.sourceSheetName}!A:X`; // 24개 열
            const rows = await this.googleSheetsRepository.readSheet(range);
            
            if (!rows || rows.length <= 1) {
                return [];
            }

            // 헤더 제외하고 데이터 파싱
            const headers = rows[0];
            const profiles = [];
            
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;
                
                const profile = {};
                headers.forEach((header, index) => {
                    profile[header] = row[index] || '';
                });
                
                // 필터 적용
                if (filter && !this.matchFilter(profile, filter)) {
                    continue;
                }
                
                profiles.push(profile);
                
                // 제한 확인
                if (limit && profiles.length >= limit) {
                    break;
                }
            }

            console.log(chalk.green(`✅ ${profiles.length}개 프로필 로드 완료`));
            return profiles;

        } catch (error) {
            this.logger.error('Google Sheets 데이터 읽기 실패', error);
            throw error;
        }
    }

    /**
     * 필터 조건 매칭
     */
    matchFilter(profile, filter) {
        if (!filter) return true;
        
        // 그룹 필터
        if (filter.group && profile.group !== filter.group) {
            return false;
        }
        
        // 탭 필터
        if (filter.tab && profile.tab !== filter.tab) {
            return false;
        }
        
        // 플랫폼 필터
        if (filter.platform && profile.platform !== filter.platform) {
            return false;
        }
        
        return true;
    }

    /**
     * 프로필을 그룹별로 분류
     */
    groupProfiles(profiles) {
        const grouped = {};
        
        profiles.forEach(profile => {
            const group = profile.group || 'default';
            if (!grouped[group]) {
                grouped[group] = [];
            }
            grouped[group].push(profile);
        });
        
        console.log(chalk.cyan(`📂 ${Object.keys(grouped).length}개 그룹으로 분류 완료`));
        Object.entries(grouped).forEach(([group, profiles]) => {
            console.log(chalk.gray(`   - ${group}: ${profiles.length}개`));
        });
        
        return grouped;
    }

    /**
     * TXT 파일 생성
     */
    async createTxtFiles(groupedProfiles, customFileName) {
        console.log(chalk.blue('\n📝 TXT 파일 생성 중...'));
        
        for (const [group, profiles] of Object.entries(groupedProfiles)) {
            try {
                // 파일명 생성
                const timestamp = new Date().toISOString().split('T')[0];
                const fileName = customFileName 
                    ? `${customFileName}_${group}_${timestamp}.txt`
                    : `restore_${group}_${timestamp}.txt`;
                const filePath = path.join(this.config.restoreOutputDir, fileName);
                
                // TXT 내용 생성
                const content = this.generateTxtContent(profiles);
                
                // 파일 쓰기
                await fs.writeFile(filePath, content, this.config.encoding);
                
                this.stats.filesCreated.push(fileName);
                this.stats.restoredProfiles += profiles.length;
                
                console.log(chalk.green(`   ✅ ${fileName} (${profiles.length}개 프로필)`));
                
            } catch (error) {
                this.logger.error(`파일 생성 실패: ${group}`, error);
                console.error(chalk.red(`   ❌ ${group} 그룹 파일 생성 실패:`), error.message);
                this.stats.errors.push({ group, error: error.message });
            }
        }
    }

    /**
     * TXT 내용 생성
     */
    generateTxtContent(profiles) {
        const lines = [];
        
        // 헤더 추가 (옵션)
        // lines.push(this.templateHeaders.join('\t'));
        
        // 프로필 데이터 추가
        profiles.forEach(profile => {
            const fields = this.templateHeaders.map(header => {
                const value = profile[header] || '';
                // 탭과 줄바꿈 문자 제거
                return value.toString().replace(/[\t\n\r]/g, ' ');
            });
            lines.push(fields.join('\t'));
        });
        
        return lines.join('\n');
    }

    /**
     * 통계 출력
     */
    printStatistics() {
        const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2);
        
        console.log(chalk.blue.bold('\n📊 복원 완료 통계'));
        console.log(chalk.gray('='.repeat(60)));
        console.log(chalk.white(`총 프로필 수: ${this.stats.totalProfiles}개`));
        console.log(chalk.green(`복원된 프로필: ${this.stats.restoredProfiles}개`));
        console.log(chalk.white(`생성된 파일: ${this.stats.filesCreated.length}개`));
        
        if (this.stats.filesCreated.length > 0) {
            console.log(chalk.cyan('📄 생성된 파일 목록:'));
            this.stats.filesCreated.forEach(file => {
                console.log(chalk.gray(`   - ${file}`));
            });
        }
        
        if (this.stats.errors.length > 0) {
            console.log(chalk.red(`오류 발생: ${this.stats.errors.length}개`));
            this.stats.errors.forEach(err => {
                console.log(chalk.red(`   - ${err.group}: ${err.error}`));
            });
        }
        
        console.log(chalk.cyan(`소요 시간: ${duration}초`));
        console.log(chalk.gray('='.repeat(60)));
    }

    /**
     * 특정 프로필 검색 및 복원
     */
    async restoreSpecificProfiles(profileNames) {
        console.log(chalk.blue(`🔍 특정 프로필 복원: ${profileNames.length}개`));
        
        const profiles = await this.fetchProfilesFromSheets();
        const matchedProfiles = profiles.filter(p => 
            profileNames.includes(p.name) || profileNames.includes(p.id)
        );
        
        if (matchedProfiles.length === 0) {
            console.log(chalk.yellow('⚠️ 일치하는 프로필을 찾을 수 없습니다.'));
            return null;
        }
        
        console.log(chalk.green(`✅ ${matchedProfiles.length}개 프로필 발견`));
        
        // 단일 파일로 생성
        const timestamp = new Date().toISOString().split('T')[0];
        const fileName = `restore_specific_${timestamp}.txt`;
        const filePath = path.join(this.config.restoreOutputDir, fileName);
        
        const content = this.generateTxtContent(matchedProfiles);
        await fs.writeFile(filePath, content, this.config.encoding);
        
        console.log(chalk.green(`✅ 파일 생성 완료: ${fileName}`));
        return filePath;
    }
}

module.exports = TxtRestoreUseCase;