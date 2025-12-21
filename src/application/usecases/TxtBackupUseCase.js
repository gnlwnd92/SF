/**
 * 📤 TXT 파일 → Google Sheets 백업 Use Case
 * 
 * TXT 파일들을 읽어서 Google Sheets에 백업하는 기능
 * Clean Architecture 패턴을 따라 구현
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

class TxtBackupUseCase {
    constructor({ googleSheetsRepository, logger }) {
        this.googleSheetsRepository = googleSheetsRepository;
        this.logger = logger;
        
        this.config = {
            textExportDir: './data/text_export',
            backupCompletedDir: './data/backup_completed',
            sheetName: '백업',
            batchSize: 500,
            maxRetries: 3,
            retryDelay: 2000
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
            totalFiles: 0,
            processedFiles: 0,
            totalProfiles: 0,
            successfulBackups: 0,
            movedFiles: [],
            errors: [],
            startTime: null,
            endTime: null
        };
    }

    /**
     * 메인 실행 메서드
     */
    async execute() {
        console.log(chalk.blue.bold('\n📤 TXT → Google Sheets 백업 시작\n'));
        console.log(chalk.gray('='.repeat(60)));

        this.stats.startTime = new Date();

        try {
            // 1. 디렉터리 준비
            await this.ensureDirectories();

            // 2. TXT 파일 목록 가져오기
            const txtFiles = await this.getTxtFiles();
            if (txtFiles.length === 0) {
                console.log(chalk.yellow('⚠️ 백업할 TXT 파일이 없습니다.'));
                return this.stats;
            }

            this.stats.totalFiles = txtFiles.length;
            console.log(chalk.cyan(`📁 발견된 TXT 파일: ${txtFiles.length}개`));

            // 3. Google Sheets 초기화
            await this.initializeGoogleSheets();

            // 4. 각 파일 처리
            for (const file of txtFiles) {
                await this.processFile(file);
            }

            // 5. 통계 출력
            this.stats.endTime = new Date();
            this.printStatistics();

            return this.stats;

        } catch (error) {
            this.logger.error('백업 실행 중 오류', error);
            console.error(chalk.red('❌ 백업 실행 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 디렉터리 확인 및 생성
     */
    async ensureDirectories() {
        await fs.ensureDir(this.config.textExportDir);
        await fs.ensureDir(this.config.backupCompletedDir);
        
        console.log(chalk.gray(`📁 소스 디렉터리: ${this.config.textExportDir}`));
        console.log(chalk.gray(`📁 완료 디렉터리: ${this.config.backupCompletedDir}`));
    }

    /**
     * TXT 파일 목록 가져오기
     */
    async getTxtFiles() {
        const files = await fs.readdir(this.config.textExportDir);
        return files.filter(file => file.endsWith('.txt'));
    }

    /**
     * Google Sheets 초기화
     */
    async initializeGoogleSheets() {
        console.log(chalk.blue('🔄 Google Sheets 연결 중...'));
        
        // 백업 시트 확인 및 생성
        const sheetExists = await this.googleSheetsRepository.checkSheetExists(this.config.sheetName);
        if (!sheetExists) {
            console.log(chalk.yellow(`📝 '${this.config.sheetName}' 시트 생성 중...`));
            await this.googleSheetsRepository.createSheet(this.config.sheetName);
        }

        // 헤더 설정
        await this.googleSheetsRepository.setHeaders(this.config.sheetName, this.templateHeaders);
        console.log(chalk.green('✅ Google Sheets 준비 완료'));
    }

    /**
     * 개별 파일 처리
     */
    async processFile(filename) {
        console.log(chalk.blue(`\n📄 파일 처리 중: ${filename}`));
        
        try {
            const filePath = path.join(this.config.textExportDir, filename);
            const content = await fs.readFile(filePath, 'utf-8');
            
            // 프로필 데이터 파싱
            const profiles = this.parseTxtContent(content, filename);
            
            if (profiles.length === 0) {
                console.log(chalk.yellow(`⚠️ ${filename}에서 프로필을 찾을 수 없습니다.`));
                return;
            }

            console.log(chalk.cyan(`   발견된 프로필: ${profiles.length}개`));
            this.stats.totalProfiles += profiles.length;

            // 배치 처리
            await this.uploadInBatches(profiles);

            // 파일 이동
            await this.moveProcessedFile(filename);
            
            this.stats.processedFiles++;
            console.log(chalk.green(`✅ ${filename} 처리 완료`));

        } catch (error) {
            this.logger.error(`파일 처리 실패: ${filename}`, error);
            console.error(chalk.red(`❌ ${filename} 처리 실패:`), error.message);
            this.stats.errors.push({ file: filename, error: error.message });
        }
    }

    /**
     * TXT 내용 파싱 (key=value 형식)
     */
    parseTxtContent(content, sourceFile) {
        const profiles = [];
        
        // 프로필을 ******************로 구분
        const profileBlocks = content.split('******************').filter(block => block.trim());
        
        for (const block of profileBlocks) {
            const profile = {};
            const lines = block.split('\n').filter(line => line.trim());
            
            // 각 라인을 key=value로 파싱
            for (const line of lines) {
                const equalIndex = line.indexOf('=');
                if (equalIndex === -1) continue;
                
                const key = line.substring(0, equalIndex).trim();
                const value = line.substring(equalIndex + 1).trim();
                
                // 템플릿 헤더에 있는 키만 저장
                if (this.templateHeaders.includes(key)) {
                    // acc_id와 proxyid는 숫자로 변환
                    if (key === 'acc_id' || key === 'proxyid') {
                        profile[key] = value ? parseInt(value, 10) : '';
                    } 
                    // cookie 필드는 JSON 배열이므로 그대로 저장
                    else if (key === 'cookie') {
                        profile[key] = value;
                    } 
                    // 나머지 필드는 문자열로 저장
                    else {
                        profile[key] = value;
                    }
                }
            }
            
            // 필수 필드 확인 (최소한 id와 name이 있어야 함)
            if (profile.id || profile.name) {
                // 소스 파일 추가
                profile.source_file = sourceFile;
                profiles.push(profile);
            }
        }

        return profiles;
    }

    /**
     * 배치 단위로 업로드
     */
    async uploadInBatches(profiles) {
        const batches = [];
        for (let i = 0; i < profiles.length; i += this.config.batchSize) {
            batches.push(profiles.slice(i, i + this.config.batchSize));
        }

        console.log(chalk.cyan(`   배치 수: ${batches.length} (각 ${this.config.batchSize}개)`));

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            console.log(chalk.gray(`   배치 ${i + 1}/${batches.length} 업로드 중...`));
            
            const rows = batch.map(profile => 
                this.templateHeaders.map(header => {
                    const value = profile[header];
                    // acc_id와 proxyid는 숫자 형식 유지
                    if ((header === 'acc_id' || header === 'proxyid') && typeof value === 'number') {
                        return value;
                    }
                    // 그 외는 문자열 또는 빈 문자열
                    return value !== undefined && value !== null ? value : '';
                })
            );

            let retries = 0;
            while (retries < this.config.maxRetries) {
                try {
                    await this.googleSheetsRepository.appendRows(this.config.sheetName, rows);
                    this.stats.successfulBackups += batch.length;
                    break;
                } catch (error) {
                    retries++;
                    if (retries >= this.config.maxRetries) {
                        throw error;
                    }
                    console.log(chalk.yellow(`   재시도 ${retries}/${this.config.maxRetries}...`));
                    await new Promise(r => setTimeout(r, this.config.retryDelay));
                }
            }
        }
    }

    /**
     * 처리된 파일 이동
     */
    async moveProcessedFile(filename) {
        const sourcePath = path.join(this.config.textExportDir, filename);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const destFilename = `${path.basename(filename, '.txt')}_${timestamp}.txt`;
        const destPath = path.join(this.config.backupCompletedDir, destFilename);

        await fs.move(sourcePath, destPath, { overwrite: true });
        this.stats.movedFiles.push(destFilename);
        
        console.log(chalk.green(`   ✅ 파일 이동: ${destFilename}`));
    }

    /**
     * 통계 출력
     */
    printStatistics() {
        const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2);
        
        console.log(chalk.blue.bold('\n📊 백업 완료 통계'));
        console.log(chalk.gray('='.repeat(60)));
        console.log(chalk.white(`총 파일 수: ${this.stats.totalFiles}개`));
        console.log(chalk.green(`처리된 파일: ${this.stats.processedFiles}개`));
        console.log(chalk.white(`총 프로필 수: ${this.stats.totalProfiles}개`));
        console.log(chalk.green(`백업 성공: ${this.stats.successfulBackups}개`));
        
        if (this.stats.errors.length > 0) {
            console.log(chalk.red(`오류 발생: ${this.stats.errors.length}개`));
            this.stats.errors.forEach(err => {
                console.log(chalk.red(`  - ${err.file}: ${err.error}`));
            });
        }
        
        console.log(chalk.cyan(`소요 시간: ${duration}초`));
        console.log(chalk.gray('='.repeat(60)));
    }
}

module.exports = TxtBackupUseCase;