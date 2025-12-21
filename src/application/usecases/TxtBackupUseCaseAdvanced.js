/**
 * 📤 고급 TXT 파일 → Google Sheets 백업 Use Case
 * 
 * 개선된 중복 처리 및 정렬 기능:
 * - source_file 날짜 기반 우선순위 처리
 * - 일괄 백업 후 중복 제거
 * - acc_id 기준 자동 정렬
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');

class TxtBackupUseCaseAdvanced {
    constructor({ googleSheetsRepository, logger }) {
        this.googleSheetsRepository = googleSheetsRepository;
        this.logger = logger;
        
        this.config = {
            textExportDir: './data/text_export',
            backupCompletedDir: './data/backup_completed',
            sheetName: '백업',
            batchSize: 500,
            maxRetries: 3,
            retryDelay: 2000,
            spreadsheetId: process.env.GOOGLE_SHEETS_ID
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
            duplicatesRemoved: 0,
            movedFiles: [],
            errors: [],
            startTime: null,
            endTime: null
        };

        this.sheets = null;
        this.auth = null;
    }

    /**
     * Google Sheets API 직접 초기화
     */
    async initializeSheetsAPI() {
        if (this.sheets) return;

        try {
            // 서비스 계정 키 파일 찾기
            const baseDir = path.resolve(__dirname, '..', '..', '..');
            const possiblePaths = [
                path.join(baseDir, 'service_account.json'),
                path.join(baseDir, 'credentials', 'service-account.json'),
            ];

            let keyFile = null;
            for (const tryPath of possiblePaths) {
                try {
                    keyFile = await fs.readFile(tryPath, 'utf8');
                    console.log(chalk.gray(`   서비스 계정 키 로드: ${tryPath}`));
                    break;
                } catch (e) {
                    continue;
                }
            }

            if (!keyFile) {
                throw new Error('서비스 계정 키 파일을 찾을 수 없습니다');
            }

            const key = JSON.parse(keyFile);

            // 인증 설정
            this.auth = new google.auth.GoogleAuth({
                credentials: key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });

            // Sheets API 클라이언트 생성
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            
        } catch (error) {
            throw new Error(`Google Sheets API 초기화 실패: ${error.message}`);
        }
    }

    /**
     * source_file 이름에서 날짜 추출
     * 예: profiles_2025_08_25_17_44_01.txt → Date 객체
     */
    extractDateFromFilename(filename) {
        // profiles_YYYY_MM_DD_HH_mm_ss.txt 패턴
        const match = filename.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
        if (match) {
            const [_, year, month, day, hour, minute, second] = match;
            return new Date(
                parseInt(year),
                parseInt(month) - 1,  // 월은 0부터 시작
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
        }
        
        // 날짜를 추출할 수 없으면 파일 수정 시간 사용
        return null;
    }

    /**
     * 메인 실행 메서드 (개선된 버전)
     */
    async execute(options = {}) {
        this.stats.startTime = new Date();
        console.log(chalk.cyan.bold('\n📤 고급 TXT → Google Sheets 백업 시작\n'));
        console.log(chalk.gray('='.repeat(60)));

        try {
            // 1. Google Sheets API 초기화
            await this.initializeSheetsAPI();

            // 2. 백업 시트 확인 및 생성
            await this.ensureBackupSheet();

            // 3. 모든 TXT 파일 수집
            const files = await this.collectTxtFiles();
            if (files.length === 0) {
                console.log(chalk.yellow('⚠️ 백업할 TXT 파일이 없습니다.'));
                return this.stats;
            }

            this.stats.totalFiles = files.length;
            console.log(chalk.blue(`📁 발견된 파일: ${files.length}개\n`));

            // 4. 모든 파일에서 프로필 데이터 수집 (파싱만)
            console.log(chalk.blue('📊 모든 파일 파싱 중...'));
            const allProfiles = [];
            
            for (const file of files) {
                try {
                    const profiles = await this.parseFile(file);
                    allProfiles.push(...profiles);
                    this.stats.processedFiles++;
                    console.log(chalk.gray(`   ✓ ${file.name}: ${profiles.length}개 프로필`));
                } catch (error) {
                    console.error(chalk.red(`   ✗ ${file.name}: ${error.message}`));
                    this.stats.errors.push({ file: file.name, error: error.message });
                }
            }

            this.stats.totalProfiles = allProfiles.length;
            console.log(chalk.green(`\n✅ 총 ${allProfiles.length}개 프로필 파싱 완료\n`));

            // 5. 중복 처리 (날짜 기반 우선순위)
            console.log(chalk.blue('🔍 중복 ID 처리 중...'));
            const uniqueProfiles = this.processDuplicates(allProfiles);
            const duplicatesCount = allProfiles.length - uniqueProfiles.length;
            this.stats.duplicatesRemoved = duplicatesCount;

            if (duplicatesCount > 0) {
                console.log(chalk.yellow(`   → ${duplicatesCount}개 중복 제거됨`));
            }

            // 6. acc_id 기준 정렬
            console.log(chalk.blue('📊 acc_id 기준 정렬 중...'));
            uniqueProfiles.sort((a, b) => {
                const accIdA = typeof a.acc_id === 'number' ? a.acc_id : parseInt(a.acc_id) || 0;
                const accIdB = typeof b.acc_id === 'number' ? b.acc_id : parseInt(b.acc_id) || 0;
                return accIdA - accIdB;
            });

            // 7. Google Sheets에 업로드
            console.log(chalk.blue('\n📤 Google Sheets 업로드 중...'));
            
            // 기존 데이터 모두 삭제
            await this.clearSheet();
            
            // 헤더 설정
            await this.setHeaders();
            
            // 데이터 업로드 (배치 처리)
            await this.uploadProfiles(uniqueProfiles);
            
            this.stats.successfulBackups = uniqueProfiles.length;

            // 8. 처리된 파일 이동
            console.log(chalk.blue('\n📁 파일 정리 중...'));
            for (const file of files) {
                await this.moveProcessedFile(file.path, file.name);
                this.stats.movedFiles.push(file.name);
            }

            // 9. 완료
            this.stats.endTime = new Date();
            const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2);
            
            console.log(chalk.green.bold('\n✅ 백업 완료!\n'));
            console.log(chalk.cyan('📊 처리 통계:'));
            console.log(chalk.white(`   • 처리된 파일: ${this.stats.processedFiles}/${this.stats.totalFiles}`));
            console.log(chalk.white(`   • 총 프로필: ${this.stats.totalProfiles}개`));
            console.log(chalk.white(`   • 백업된 프로필: ${this.stats.successfulBackups}개`));
            console.log(chalk.yellow(`   • 중복 제거: ${this.stats.duplicatesRemoved}개`));
            console.log(chalk.white(`   • 소요 시간: ${duration}초`));

            return this.stats;

        } catch (error) {
            this.logger.error('백업 실패', error);
            console.error(chalk.red.bold('\n❌ 백업 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 중복 처리 (날짜 기반 우선순위)
     */
    processDuplicates(profiles) {
        const profileMap = new Map();
        
        for (const profile of profiles) {
            const existingProfile = profileMap.get(profile.id);
            
            if (!existingProfile) {
                // 첫 번째 프로필은 그냥 저장
                profileMap.set(profile.id, profile);
            } else {
                // 중복인 경우 날짜 비교
                const shouldReplace = this.shouldReplaceProfile(existingProfile, profile);
                
                if (shouldReplace) {
                    console.log(chalk.yellow(`   → ID ${profile.id} 교체: ${existingProfile.source_file} → ${profile.source_file}`));
                    profileMap.set(profile.id, profile);
                } else {
                    console.log(chalk.gray(`   → ID ${profile.id} 유지: ${existingProfile.source_file} (더 최신)`));
                }
            }
        }
        
        return Array.from(profileMap.values());
    }

    /**
     * 프로필 교체 여부 결정 (날짜 기반)
     */
    shouldReplaceProfile(existing, candidate) {
        // 1. 같은 source_file인 경우 항상 교체 (파일 내 중복은 마지막 것 사용)
        if (existing.source_file === candidate.source_file) {
            return true;
        }
        
        // 2. 다른 source_file인 경우 날짜 비교
        const existingDate = this.extractDateFromFilename(existing.source_file);
        const candidateDate = this.extractDateFromFilename(candidate.source_file);
        
        // 날짜를 추출할 수 없는 경우
        if (!existingDate || !candidateDate) {
            // 파일명 문자열 비교 (더 큰 값이 최신)
            return existing.source_file < candidate.source_file;
        }
        
        // 날짜가 더 최신인 것 사용
        return candidateDate > existingDate;
    }

    /**
     * 파일 수집
     */
    async collectTxtFiles() {
        const dir = path.resolve(this.config.textExportDir);
        
        if (!await fs.pathExists(dir)) {
            await fs.ensureDir(dir);
            return [];
        }

        const files = await fs.readdir(dir);
        const txtFiles = files
            .filter(file => file.endsWith('.txt'))
            .map(file => ({
                name: file,
                path: path.join(dir, file)
            }));

        return txtFiles;
    }

    /**
     * 파일 파싱
     */
    async parseFile(file) {
        const content = await fs.readFile(file.path, 'utf-8');
        return this.parseTxtContent(content, file.name);
    }

    /**
     * TXT 내용 파싱 (key=value 형식)
     */
    parseTxtContent(content, fileName) {
        const profiles = [];
        const blocks = content.split('******************').filter(block => block.trim());
        
        for (const block of blocks) {
            const lines = block.trim().split('\n');
            const profile = { source_file: fileName };
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;
                
                const [key, ...valueParts] = trimmedLine.split('=');
                const value = valueParts.join('='); // '=' 가 값에 포함될 수 있음
                
                if (key && this.templateHeaders.includes(key)) {
                    // acc_id와 proxyid는 숫자로 변환
                    if (key === 'acc_id' || key === 'proxyid') {
                        profile[key] = value ? parseInt(value, 10) : '';
                    } else {
                        profile[key] = value || '';
                    }
                }
            }
            
            // ID가 있는 프로필만 추가
            if (profile.id) {
                profiles.push(profile);
            }
        }
        
        return profiles;
    }

    /**
     * 시트 초기화
     */
    async clearSheet() {
        try {
            // 시트의 모든 내용 삭제 (헤더 포함)
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:Z`
            });
            console.log(chalk.gray('   → 기존 데이터 삭제 완료'));
        } catch (error) {
            console.error(chalk.red('시트 초기화 실패:'), error.message);
        }
    }

    /**
     * 헤더 설정
     */
    async setHeaders() {
        try {
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A1:X1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [this.templateHeaders]
                }
            });
            console.log(chalk.gray('   → 헤더 설정 완료'));
        } catch (error) {
            console.error(chalk.red('헤더 설정 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 프로필 업로드 (배치 처리)
     */
    async uploadProfiles(profiles) {
        const totalBatches = Math.ceil(profiles.length / this.config.batchSize);
        
        for (let i = 0; i < totalBatches; i++) {
            const start = i * this.config.batchSize;
            const end = Math.min(start + this.config.batchSize, profiles.length);
            const batch = profiles.slice(start, end);
            
            // 데이터 행 생성
            const rows = batch.map(profile => 
                this.templateHeaders.map(header => {
                    const value = profile[header];
                    // 숫자 타입 유지
                    if ((header === 'acc_id' || header === 'proxyid') && typeof value === 'number') {
                        return value;
                    }
                    return value || '';
                })
            );
            
            // 배치 업로드
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:X`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values: rows
                }
            });
            
            console.log(chalk.gray(`   → 배치 ${i + 1}/${totalBatches} 업로드 완료 (${batch.length}개)`));
            
            // 다음 배치 전 잠시 대기
            if (i < totalBatches - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * 백업 시트 확인 및 생성
     */
    async ensureBackupSheet() {
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.config.spreadsheetId,
                fields: 'sheets.properties.title'
            });
            
            const sheets = response.data.sheets || [];
            const backupSheetExists = sheets.some(sheet => 
                sheet.properties.title === this.config.sheetName
            );
            
            if (!backupSheetExists) {
                console.log(chalk.yellow('⚠️ 백업 시트가 없습니다. 생성 중...'));
                await this.createBackupSheet();
            }
        } catch (error) {
            console.error(chalk.red('시트 확인 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 백업 시트 생성
     */
    async createBackupSheet() {
        try {
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: this.config.spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: this.config.sheetName
                            }
                        }
                    }]
                }
            });
            console.log(chalk.green('✅ 백업 시트 생성 완료'));
        } catch (error) {
            throw new Error(`백업 시트 생성 실패: ${error.message}`);
        }
    }

    /**
     * 처리된 파일 이동
     */
    async moveProcessedFile(filePath, fileName) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newFileName = fileName.replace('.txt', `_${timestamp}.txt`);
            const destPath = path.join(this.config.backupCompletedDir, newFileName);
            
            await fs.ensureDir(this.config.backupCompletedDir);
            await fs.move(filePath, destPath, { overwrite: true });
            
            console.log(chalk.gray(`   → ${fileName} 이동 완료`));
        } catch (error) {
            console.error(chalk.red(`파일 이동 실패: ${fileName}`), error.message);
            this.stats.errors.push({ file: fileName, error: `이동 실패: ${error.message}` });
        }
    }
}

module.exports = TxtBackupUseCaseAdvanced;