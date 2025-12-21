/**
 * 삭제 시트 레포지토리
 * Google Sheets의 '삭제' 탭 데이터 관리
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

class DeleteSheetRepository {
    constructor({ spreadsheetId, serviceAccountPath, logger }) {
        this.spreadsheetId = spreadsheetId;
        this.serviceAccountPath = serviceAccountPath || path.join(__dirname, '../../..', 'credentials', 'service-account.json');
        this.logger = logger || console;
        this.sheets = null;
        this.sheetName = '삭제';  // 삭제 탭 이름
    }

    /**
     * Google Sheets API 초기화
     */
    async initialize() {
        if (this.sheets) return;

        try {
            // 서비스 계정 키 파일 읽기
            const keyFile = await fs.readJson(this.serviceAccountPath);
            
            // JWT 클라이언트 생성
            const auth = new google.auth.JWT(
                keyFile.client_email,
                null,
                keyFile.private_key,
                ['https://www.googleapis.com/auth/spreadsheets']
            );

            // 인증
            await auth.authorize();
            
            // Sheets API 클라이언트 생성
            this.sheets = google.sheets({ version: 'v4', auth });
            
            this.logger.info('Google Sheets API 초기화 완료');
        } catch (error) {
            this.logger.error('Google Sheets API 초기화 실패', error);
            throw new Error(`Sheets 초기화 실패: ${error.message}`);
        }
    }

    /**
     * 삭제할 프로필 목록 가져오기
     * A열: acc_id(serial_number), B열: id(user_id), C열: 그룹, D열: 이름(이메일), E열: 결과
     * 수정: B열의 user_id를 사용하도록 변경
     */
    async getProfilesToDelete() {
        await this.initialize();

        try {
            // 데이터 범위 읽기 (A2:F 전체 - F열은 타임스탬프)
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A2:F`
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) {
                this.logger.info('삭제 탭에 데이터가 없습니다');
                return [];
            }

            // 프로필 목록 생성 (E열이 비어있는 행만)
            const profiles = [];
            rows.forEach((row, index) => {
                // 실제 Google Sheets 구조:
                // A열: acc_id (serial_number), B열: id (user_id), C열: group, D열: name (email), E열: 결과
                const [accId, userId, group, email, result] = row;
                
                // user_id(B열)가 있고 결과가 없는 경우만 삭제 대상
                if (userId && !result) {
                    profiles.push({
                        id: userId.trim(),  // AdsPower API에 전달할 user_id (B열)
                        accId: accId?.trim() || '',  // serial_number (A열)
                        name: email?.trim() || '',  // 이메일 (D열)
                        group: group?.trim() || '',  // 그룹 (C열)
                        email: email?.trim() || '',  // 이메일 (D열)
                        rowNumber: index + 2  // 실제 행 번호 (헤더 제외)
                    });
                }
            });

            this.logger.info(`${profiles.length}개 삭제 대상 프로필 로드`);
            
            // 디버깅용 로그
            if (profiles.length > 0) {
                this.logger.info(`첫 번째 프로필: user_id=${profiles[0].id}, acc_id=${profiles[0].accId}`);
            }
            
            return profiles;

        } catch (error) {
            this.logger.error('프로필 목록 로드 실패', error);
            throw new Error(`프로필 로드 실패: ${error.message}`);
        }
    }

    /**
     * 삭제 상태 업데이트
     * E열에 결과, F열에 타임스탬프 기록
     */
    async updateDeleteStatus(rowNumber, status, timestamp) {
        await this.initialize();

        try {
            // E열과 F열 업데이트
            const range = `${this.sheetName}!E${rowNumber}:F${rowNumber}`;
            const values = [[status, timestamp]];

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                resource: { values }
            });

            this.logger.info(`행 ${rowNumber} 상태 업데이트: ${status}`);

        } catch (error) {
            this.logger.error(`행 ${rowNumber} 업데이트 실패`, error);
            throw new Error(`상태 업데이트 실패: ${error.message}`);
        }
    }

    /**
     * 배치 상태 업데이트
     */
    async batchUpdateStatus(updates) {
        await this.initialize();

        try {
            const data = updates.map(update => ({
                range: `${this.sheetName}!E${update.rowNumber}:F${update.rowNumber}`,
                values: [[update.status, update.timestamp]]
            }));

            await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: this.spreadsheetId,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data
                }
            });

            this.logger.info(`${updates.length}개 행 배치 업데이트 완료`);

        } catch (error) {
            this.logger.error('배치 업데이트 실패', error);
            throw new Error(`배치 업데이트 실패: ${error.message}`);
        }
    }

    /**
     * 헤더 설정 (필요시)
     * 실제 구조: acc_id, id, group, name, 결과, 처리시간
     */
    async ensureHeaders() {
        await this.initialize();

        try {
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A1:F1`
            });

            const headers = response.data.values?.[0] || [];
            
            // 헤더가 없거나 불완전한 경우 설정
            if (headers.length < 6 || headers[0] !== 'acc_id') {
                const newHeaders = [['acc_id', 'id', 'group', 'name', '결과', '처리시간']];
                
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: `${this.sheetName}!A1:F1`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: newHeaders }
                });

                this.logger.info('헤더 설정 완료');
            }

        } catch (error) {
            this.logger.error('헤더 설정 실패', error);
            // 헤더 설정 실패는 무시하고 계속 진행
        }
    }

    /**
     * 시트 존재 여부 확인
     */
    async checkSheetExists() {
        await this.initialize();

        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId
            });

            const sheets = response.data.sheets || [];
            const deleteSheet = sheets.find(sheet => 
                sheet.properties.title === this.sheetName
            );

            if (!deleteSheet) {
                this.logger.warn(`'${this.sheetName}' 탭이 존재하지 않습니다`);
                // 시트 생성 로직 추가 가능
                await this.createDeleteSheet();
            }

            return true;

        } catch (error) {
            this.logger.error('시트 확인 실패', error);
            throw new Error(`시트 확인 실패: ${error.message}`);
        }
    }

    /**
     * 삭제 시트 생성
     */
    async createDeleteSheet() {
        try {
            const request = {
                spreadsheetId: this.spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: this.sheetName,
                                gridProperties: {
                                    rowCount: 1000,
                                    columnCount: 6
                                }
                            }
                        }
                    }]
                }
            };

            await this.sheets.spreadsheets.batchUpdate(request);
            this.logger.info(`'${this.sheetName}' 탭 생성 완료`);

            // 헤더 추가
            await this.ensureHeaders();

        } catch (error) {
            if (error.message.includes('already exists')) {
                this.logger.info(`'${this.sheetName}' 탭이 이미 존재합니다`);
            } else {
                throw error;
            }
        }
    }

    /**
     * 연결 테스트
     */
    async testConnection() {
        try {
            await this.initialize();
            await this.checkSheetExists();
            
            console.log(chalk.green(`✅ '${this.sheetName}' 탭 연결 성공`));
            return true;
        } catch (error) {
            console.error(chalk.red(`❌ '${this.sheetName}' 탭 연결 실패:`, error.message));
            return false;
        }
    }
}

module.exports = DeleteSheetRepository;