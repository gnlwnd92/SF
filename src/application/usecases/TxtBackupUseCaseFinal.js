/**
 * 📤 최종 TXT 파일 → Google Sheets 백업 Use Case (v2.40 성능 최적화)
 *
 * 처리 방식:
 * 1. 모든 TXT 파일을 Google Sheets에 먼저 백업
 * 2. Sheets 내에서 중복 ID의 행만 삭제 (deleteDimension)
 * 3. 서버 측 정렬 (sortRange) — 데이터 재전송 불필요
 * 4. 빈 행 트림 (updateSheetProperties) — 셀 수 제한 방지
 * 5. 삭제 + 정렬 + 트림을 단일 batchUpdate로 실행 (API 1회)
 *
 * v2.40 개선: 299배치 재업로드 → 단일 batchUpdate (약 100배 성능 향상)
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
            batchSize: 50,           // [v2.7] 500 → 50 (Google API 502 방지)
            maxRetries: 3,
            retryDelay: 2000,
            batchDelay: 1000,        // [v2.7] 배치 간 대기 시간
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
            emptyRowsTrimmed: 0,
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
            if (this.stats.emptyRowsTrimmed > 0) {
                console.log(chalk.blue(`   • 빈 행 정리: ${this.stats.emptyRowsTrimmed}개 (셀 수 최적화)`));
            }
            console.log(chalk.white(`   • 소요 시간: ${duration}초`));

            return this.stats;

        } catch (error) {
            this.logger.error('백업 실패', error);
            console.error(chalk.red.bold('\n❌ 백업 실패:'), error.message);
            throw error;
        }
    }

    /**
     * [v2.40] Google Sheets 내에서 중복 처리 (최적화)
     *
     * 기존: 전체 클리어 → 299배치 재업로드 (302 API calls, ~6-12분)
     * 개선: 중복 행만 삭제 + 서버 정렬 + 빈 행 트림 (1 batchUpdate, ~3-5초)
     */
    async processDuplicatesInSheets() {
        try {
            // 1. 시트 메타정보 + 데이터 동시 조회 (2 API calls, 병렬)
            const [sheetInfo, dataResponse] = await Promise.all([
                this.getSheetInfo(this.config.sheetName),
                this.sheets.spreadsheets.values.get({
                    spreadsheetId: this.config.spreadsheetId,
                    range: `${this.config.sheetName}!A:X`
                })
            ]);

            const { sheetId, gridRowCount } = sheetInfo;
            const rows = dataResponse.data.values || [];

            if (rows.length <= 1) {
                console.log(chalk.gray('   → 데이터가 없거나 헤더만 있습니다.'));
                if (gridRowCount > 100) {
                    await this.trimSheetToSize(sheetId, 100);
                    console.log(chalk.blue(`   → 빈 시트 크기 축소: ${gridRowCount} → 100행`));
                }
                return;
            }

            const headers = rows[0];
            const dataRows = rows.slice(1);
            console.log(chalk.gray(`   → 총 ${dataRows.length}개 행 로드 (시트 격자: ${gridRowCount}행)`));

            // 2. 중복 감지 + 삭제할 행의 시트 인덱스 수집
            const profileMap = new Map(); // id → { sheetRowIndex, profile }
            const rowsToDelete = [];      // 0-based 시트 행 인덱스 (header=0)
            let duplicateCount = 0;

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                const profile = this.rowToProfile(row, headers);
                const sheetRowIndex = i + 1; // 0-based (header=0, 첫 데이터=1)

                // ID 없는 행은 삭제 대상
                if (!profile.id) {
                    rowsToDelete.push(sheetRowIndex);
                    continue;
                }

                const existing = profileMap.get(profile.id);

                if (existing) {
                    duplicateCount++;
                    if (this.shouldReplaceProfile(existing.profile, profile)) {
                        // candidate가 최신 → 기존 행 삭제
                        rowsToDelete.push(existing.sheetRowIndex);
                        profileMap.set(profile.id, { sheetRowIndex, profile });
                    } else {
                        // 기존이 최신 → 현재 행 삭제
                        rowsToDelete.push(sheetRowIndex);
                    }
                } else {
                    profileMap.set(profile.id, { sheetRowIndex, profile });
                }
            }

            this.stats.duplicatesProcessed = duplicateCount;
            console.log(chalk.yellow(`   → ${duplicateCount}개 중복 발견`));

            // 3. batchUpdate 요청 구성 (삭제 + 정렬 + 트림을 1회 API 호출로)
            const requests = [];

            // 3a. 중복/빈 행 삭제 (내림차순, 연속 행 그룹핑으로 요청 수 최소화)
            if (rowsToDelete.length > 0) {
                rowsToDelete.sort((a, b) => b - a); // 내림차순 (인덱스 시프트 방지)
                const deleteRanges = this.groupConsecutiveIndices(rowsToDelete);

                for (const range of deleteRanges) {
                    requests.push({
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension: 'ROWS',
                                startIndex: range.start,
                                endIndex: range.end
                            }
                        }
                    });
                }
                console.log(chalk.yellow(`   → ${rowsToDelete.length}개 행 삭제 (${deleteRanges.length}개 범위로 그룹화)`));
            }

            // 3b. acc_id 기준 내림차순 정렬 (sortRange: 데이터 전송 없이 서버에서 정렬)
            const finalDataCount = dataRows.length - rowsToDelete.length;
            if (finalDataCount > 0) {
                requests.push({
                    sortRange: {
                        range: {
                            sheetId,
                            startRowIndex: 1,                              // 헤더 제외
                            endRowIndex: finalDataCount + 1,               // 삭제 후 남은 데이터 + 헤더
                            startColumnIndex: 0,
                            endColumnIndex: this.templateHeaders.length    // 24열
                        },
                        sortSpecs: [{
                            dimensionIndex: 0,       // Column A (acc_id)
                            sortOrder: 'DESCENDING'
                        }]
                    }
                });
                console.log(chalk.blue(`   → acc_id 기준 내림차순 정렬`));
            }

            // 3c. 빈 행 정리 — 시트 격자 크기 축소 (셀 수 제한 방지)
            //     Google Sheets는 스프레드시트당 1,000만 셀 제한
            //     values.append(INSERT_ROWS)가 격자를 계속 늘리고, values.clear()는 줄이지 못함
            //     updateSheetProperties로 격자를 실제 데이터 크기에 맞춰 축소
            const targetRowCount = Math.max(finalDataCount + 1 + 10, 100); // 헤더 + 데이터 + 여유 10행, 최소 100행
            const postDeletionGridRows = gridRowCount - rowsToDelete.length;

            if (postDeletionGridRows > targetRowCount) {
                requests.push({
                    updateSheetProperties: {
                        properties: {
                            sheetId,
                            gridProperties: {
                                rowCount: targetRowCount
                            }
                        },
                        fields: 'gridProperties.rowCount'
                    }
                });
                const trimmed = postDeletionGridRows - targetRowCount;
                this.stats.emptyRowsTrimmed = trimmed;
                console.log(chalk.blue(`   → 빈 행 ${trimmed}개 정리 (${postDeletionGridRows} → ${targetRowCount}행)`));
            }

            // 4. 단일 batchUpdate 실행 (모든 작업을 1번의 API 호출로)
            if (requests.length > 0) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.config.spreadsheetId,
                    requestBody: { requests }
                });
            }

            this.stats.successfulBackups = finalDataCount;
            console.log(chalk.green(`   → 완료: ${finalDataCount}개 프로필 (API 호출 ${requests.length > 0 ? 1 : 0}회)`));

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
     * 시트 메타정보 조회 (sheetId + gridProperties)
     * deleteDimension/sortRange/updateSheetProperties에 숫자 sheetId가 필수
     */
    async getSheetInfo(sheetName) {
        const response = await this.sheets.spreadsheets.get({
            spreadsheetId: this.config.spreadsheetId,
            fields: 'sheets.properties'
        });

        const sheet = (response.data.sheets || []).find(
            s => s.properties.title === sheetName
        );

        return {
            sheetId: sheet ? sheet.properties.sheetId : 0,
            gridRowCount: sheet?.properties?.gridProperties?.rowCount || 0,
            gridColumnCount: sheet?.properties?.gridProperties?.columnCount || 26
        };
    }

    /**
     * 내림차순 정렬된 인덱스를 연속 범위로 그룹핑
     * 예: [100, 99, 98, 50, 10, 9] → [{start:98,end:101}, {start:50,end:51}, {start:9,end:11}]
     * deleteDimension 요청 수를 최소화 (개별 1000개 → 그룹 ~수십 개)
     */
    groupConsecutiveIndices(sortedDescIndices) {
        if (sortedDescIndices.length === 0) return [];

        const ranges = [];
        let end = sortedDescIndices[0] + 1; // exclusive
        let start = sortedDescIndices[0];

        for (let i = 1; i < sortedDescIndices.length; i++) {
            if (sortedDescIndices[i] === start - 1) {
                // 연속 (내림차순으로 진행)
                start = sortedDescIndices[i];
            } else {
                // 갭 발견 → 현재 범위 저장
                ranges.push({ start, end });
                end = sortedDescIndices[i] + 1;
                start = sortedDescIndices[i];
            }
        }
        ranges.push({ start, end });

        return ranges; // 내림차순 유지 (높은 인덱스부터 삭제)
    }

    /**
     * 시트 격자 크기를 지정된 행 수로 축소 (빈 데이터 전용)
     */
    async trimSheetToSize(sheetId, targetRowCount) {
        await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.config.spreadsheetId,
            requestBody: {
                requests: [{
                    updateSheetProperties: {
                        properties: {
                            sheetId,
                            gridProperties: { rowCount: targetRowCount }
                        },
                        fields: 'gridProperties.rowCount'
                    }
                }]
            }
        });
    }

    /**
     * 프로필을 시트에 추가 (배치 업로드 + 재시도)
     * [v2.7] Google Sheets API 오류 방지를 위한 배치 처리
     */
    async appendProfilesToSheet(profiles) {
        if (profiles.length === 0) return;

        const BATCH_SIZE = 50; // 50개씩 나누어 업로드
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000; // 2초
        const BATCH_DELAY = 1000; // 배치 간 1초 대기

        const rows = profiles.map(profile =>
            this.templateHeaders.map(header => {
                const value = profile[header];
                if ((header === 'acc_id' || header === 'proxyid') && typeof value === 'number') {
                    return value;
                }
                return value || '';
            })
        );

        const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

        for (let i = 0; i < totalBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, rows.length);
            const batch = rows.slice(start, end);

            // 재시도 로직
            let success = false;
            for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
                try {
                    await this.sheets.spreadsheets.values.append({
                        spreadsheetId: this.config.spreadsheetId,
                        range: `${this.config.sheetName}!A:X`,
                        valueInputOption: 'RAW',
                        insertDataOption: 'INSERT_ROWS',
                        requestBody: {
                            values: batch
                        }
                    });
                    success = true;

                    if (totalBatches > 1) {
                        console.log(chalk.gray(`      → 배치 ${i + 1}/${totalBatches} 업로드 완료 (${batch.length}개)`));
                    }
                } catch (error) {
                    if (attempt < MAX_RETRIES) {
                        console.log(chalk.yellow(`      ⚠️ 배치 ${i + 1} 실패 (시도 ${attempt}/${MAX_RETRIES}): ${error.message}`));
                        await this.delay(RETRY_DELAY * attempt); // 지수 백오프
                    } else {
                        throw new Error(`배치 ${i + 1} 업로드 실패 (최대 재시도 초과): ${error.message}`);
                    }
                }
            }

            // 다음 배치 전 대기 (API 제한 방지)
            if (i < totalBatches - 1) {
                await this.delay(BATCH_DELAY);
            }
        }
    }

    /**
     * 지연 함수
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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