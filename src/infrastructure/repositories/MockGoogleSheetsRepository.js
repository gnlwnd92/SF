/**
 * Mock Google Sheets Repository
 * Service Account 파일 없이 테스트용으로 사용
 */

class MockGoogleSheetsRepository {
  constructor(config = {}) {
    console.log('[MockRepository] Created with config:', config.spreadsheetId || 'mock-sheet');
    this.config = config;
    this.initialized = false;
  }

  async initialize() {
    console.log('[MockRepository] Initializing (mock mode)...');
    // 실제 Google Sheets 연결 없이 즉시 성공
    this.initialized = true;
    return true;
  }

  async getAll() {
    console.log('[MockRepository] Returning mock profiles');
    return [
      {
        id: 'mock-1',
        name: 'Test Profile 1',
        email: 'test1@example.com',
        status: 'active'
      },
      {
        id: 'mock-2', 
        name: 'Test Profile 2',
        email: 'test2@example.com',
        status: 'paused'
      }
    ];
  }

  async getById(id) {
    console.log('[MockRepository] Getting profile by id:', id);
    return {
      id: id,
      name: `Profile ${id}`,
      email: `${id}@example.com`,
      status: 'active'
    };
  }

  async save(profile) {
    console.log('[MockRepository] Saving profile:', profile.name);
    return profile;
  }

  async update(id, profile) {
    console.log('[MockRepository] Updating profile:', id);
    return { ...profile, id };
  }

  async delete(id) {
    console.log('[MockRepository] Deleting profile:', id);
    return true;
  }

  // EnhancedGoogleSheetsRepository 메서드들
  async getAdsPowerProfiles() {
    console.log('[MockRepository] Getting AdsPower profiles');
    return [];
  }

  async getPauseTargets() {
    console.log('[MockRepository] Getting pause targets');
    return [];
  }

  async getResumeTargets() {
    console.log('[MockRepository] Getting resume targets');
    return [];
  }

  async updatePauseStatus(email, status, date) {
    console.log('[MockRepository] Updating pause status:', email, status);
    return true;
  }

  async updateResumeStatus(email, status, date) {
    console.log('[MockRepository] Updating resume status:', email, status);
    return true;
  }
}

module.exports = MockGoogleSheetsRepository;