/**
 * 📤 최종 TXT 파일 → Google Sheets 백업 Use Case
 * 
 * 처리 방식:
 * 1. 모든 TXT 파일을 Google Sheets에 먼저 백업
 * 2. Sheets 내에서 중복 ID 확인 및 처리
 * 3. 최신 데이터로 업데이트 (source_file 날짜 기준)
 * 4. acc_id 기준 정렬
 */

const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');

class TxtBackupUseCaseFinal {
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
            duplicatesProcessed: 0,
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
     */
    extractDateFromFilename(filename) {
        const match = filename.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
        if (match) {
            const [_, year, month, day, hour, minute, second] = match;
            return new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second)
            );
        }
        return null;
    }

    /**
     * 메인 실행 메서드
     */
    async execute(options = {}) {
        this.stats.startTime = new Date();
        console.log(chalk.cyan.bold('\n📤 TXT → Google Sheets 백업 시작 (최종 버전)\n'));
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

            // 4. 모든 파일 데이터를 Google Sheets에 먼저 추가 (중복 체크 없이)
            console.log(chalk.blue('📤 Google Sheets에 모든 데이터 업로드 중...'));
            
            for (const file of files) {
                try {
                    const profiles = await this.parseFile(file);
                    if (profiles.length > 0) {
                        await this.appendProfilesToSheet(profiles);
                        this.stats.processedFiles++;
                        this.stats.totalProfiles += profiles.length;
                        console.log(chalk.green(`   ✓ ${file.name}: ${profiles.length}개 프로필 업로드`));
                    }
                } catch (error) {
                    console.error(chalk.red(`   ✗ ${file.name}: ${error.message}`));
                    this.stats.errors.push({ file: file.name, error: error.message });
                }
            }

            console.log(chalk.green(`\n✅ 총 ${this.stats.totalProfiles}개 프로필 업로드 완료\n`));

            // 5. Google Sheets 내에서 중복 처리 및 정렬
            console.log(chalk.blue('🔍 Google Sheets 내에서 중복 처리 및 정렬...'));
            await this.processDuplicatesInSheets();

            // 6. 처리된 파일 이동
            console.log(chalk.blue('\n📁 파일 정리 중...'));
            for (const file of files) {
                await this.moveProcessedFile(file.path, file.name);
                this.stats.movedFiles.push(file.name);
            }

            // 7. 완료
            this.stats.endTime = new Date();
            const duration = ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2);
            
            console.log(chalk.green.bold('\n✅ 백업 완료!\n'));
            console.log(chalk.cyan('📊 처리 통계:'));
            console.log(chalk.white(`   • 처리된 파일: ${this.stats.processedFiles}/${this.stats.totalFiles}`));
            console.log(chalk.white(`   • 업로드된 프로필: ${this.stats.totalProfiles}개`));
            console.log(chalk.white(`   • 최종 프로필 수: ${this.stats.successfulBackups}개`));
            console.log(chalk.yellow(`   • 중복 처리: ${this.stats.duplicatesProcessed}개`));
            console.log(chalk.white(`   • 소요 시간: ${duration}초`));

            return this.stats;

        } catch (error) {
            this.logger.error('백업 실패', error);
            console.error(chalk.red.bold('\n❌ 백업 실패:'), error.message);
            throw error;
        }
    }

    /**
     * Google Sheets 내에서 중복 처리
     */
    async processDuplicatesInSheets() {
        try {
            // 1. 전체 데이터 읽기
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:X`
            });

            const rows = response.data.values || [];
            if (rows.length <= 1) {
                console.log(chalk.gray('   → 데이터가 없거나 헤더만 있습니다.'));
                return;
            }

            const headers = rows[0];
            const dataRows = rows.slice(1);
            
            console.log(chalk.gray(`   → 총 ${dataRows.length}개 행 로드`));

            // 2. ID별로 그룹화하고 최신 데이터 선택
            const profileMap = new Map();
            let duplicateCount = 0;

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                const profile = this.rowToProfile(row, headers);
                
                if (!profile.id) continue;

                const existing = profileMap.get(profile.id);
                
                if (existing) {
                    duplicateCount++;
                    // 날짜 비교하여 최신 데이터 선택
                    if (this.shouldReplaceProfile(existing, profile)) {
                        console.log(chalk.yellow(`   → ID ${profile.id} 교체: ${existing.source_file} → ${profile.source_file}`));
                        profileMap.set(profile.id, profile);
                    }
                } else {
                    profileMap.set(profile.id, profile);
                }
            }

            this.stats.duplicatesProcessed = duplicateCount;
            console.log(chalk.yellow(`   → ${duplicateCount}개 중복 발견 및 처리`));

            // 3. acc_id 기준 정렬 (내림차순: 큰 값이 먼저)
            const uniqueProfiles = Array.from(profileMap.values());
            uniqueProfiles.sort((a, b) => {
                const accIdA = typeof a.acc_id === 'number' ? a.acc_id : parseInt(a.acc_id) || 0;
                const accIdB = typeof b.acc_id === 'number' ? b.acc_id : parseInt(b.acc_id) || 0;
                return accIdB - accIdA;  // 내림차순 정렬
            });

            console.log(chalk.blue(`   → acc_id 기준 내림차순 정렬 완료`));

            // 4. 시트 초기화 후 정렬된 데이터 다시 쓰기
            await this.clearSheet();
            await this.setHeaders();
            
            // 배치로 나누어 업로드
            const totalBatches = Math.ceil(uniqueProfiles.length / this.config.batchSize);
            
            for (let i = 0; i < totalBatches; i++) {
                const start = i * this.config.batchSize;
                const end = Math.min(start + this.config.batchSize, uniqueProfiles.length);
                const batch = uniqueProfiles.slice(start, end);
                
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
                
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.config.spreadsheetId,
                    range: `${this.config.sheetName}!A:X`,
                    valueInputOption: 'RAW',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: {
                        values: rows
                    }
                });
                
                console.log(chalk.gray(`   → 배치 ${i + 1}/${totalBatches} 재업로드 완료 (${batch.length}개)`));
            }

            this.stats.successfulBackups = uniqueProfiles.length;
            console.log(chalk.green(`   → 최종 ${uniqueProfiles.length}개 프로필 저장 완료`));

        } catch (error) {
            console.error(chalk.red('Sheets 내 중복 처리 실패:'), error.message);
            throw error;
        }
    }

    /**
     * 행 데이터를 프로필 객체로 변환
     */
    rowToProfile(row, headers) {
        const profile = {};
        headers.forEach((header, index) => {
            if (header === 'acc_id' || header === 'proxyid') {
                profile[header] = row[index] ? parseInt(row[index], 10) : '';
            } else {
                profile[header] = row[index] || '';
            }
        });
        return profile;
    }

    /**
     * 프로필 교체 여부 결정 (날짜 기반)
     */
    shouldReplaceProfile(existing, candidate) {
        // 1. 같은 source_file인 경우 항상 교체
        if (existing.source_file === candidate.source_file) {
            return true;
        }
        
        // 2. 다른 source_file인 경우 날짜 비교
        const existingDate = this.extractDateFromFilename(existing.source_file);
        const candidateDate = this.extractDateFromFilename(candidate.source_file);
        
        if (!existingDate || !candidateDate) {
            return existing.source_file < candidate.source_file;
        }
        
        return candidateDate > existingDate;
    }

    /**
     * 프로필을 시트에 추가 (중복 체크 없이)
     */
    async appendProfilesToSheet(profiles) {
        if (profiles.length === 0) return;

        const rows = profiles.map(profile => 
            this.templateHeaders.map(header => {
                const value = profile[header];
                if ((header === 'acc_id' || header === 'proxyid') && typeof value === 'number') {
                    return value;
                }
                return value || '';
            })
        );

        await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.config.spreadsheetId,
            range: `${this.config.sheetName}!A:X`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: rows
            }
        });
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
                const value = valueParts.join('=');
                
                if (key && this.templateHeaders.includes(key)) {
                    if (key === 'acc_id' || key === 'proxyid') {
                        profile[key] = value ? parseInt(value, 10) : '';
                    } else {
                        profile[key] = value || '';
                    }
                }
            }
            
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
            await this.sheets.spreadsheets.values.clear({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:Z`
            });
            console.log(chalk.gray('   → 시트 초기화 완료'));
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
            } else {
                // 기존 시트가 있으면 헤더 확인 및 설정
                const headerResponse = await this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.config.spreadsheetId,
                    range: `${this.config.sheetName}!A1:X1`
                });
                
                if (!headerResponse.data.values || headerResponse.data.values.length === 0) {
                    await this.setHeaders();
                }
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
            
            // 헤더 추가
            await this.setHeaders();
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

module.exports = TxtBackupUseCaseFinal;