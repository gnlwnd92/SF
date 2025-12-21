/**
 * @class Profile
 * @description AdsPower 브라우저 프로필 도메인 엔티티
 */
class Profile {
  /**
   * @param {Object} data 프로필 데이터
   * @param {string} data.id 프로필 ID
   * @param {string} data.name 프로필 이름
   * @param {string} data.email 연결된 이메일
   * @param {string} data.status 프로필 상태
   * @param {Object} data.metadata 추가 메타데이터
   */
  constructor(data) {
    // profileId 또는 id를 받을 수 있도록 처리
    this.id = data.id || data.profileId;
    this.profileId = data.profileId || data.id;
    this.name = data.name;
    this.email = data.email;
    this.status = data.status || 'inactive';
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    
    this.validate();
  }

  /**
   * 프로필 데이터 유효성 검증
   */
  validate() {
    if (!this.id && !this.profileId) {
      throw new Error('Profile ID is required');
    }
    // name은 선택사항으로 변경 (실제 데이터에서 비어있을 수 있음)
    // if (!this.name) {
    //   throw new Error('Profile name is required');
    // }
    if (!this.isValidStatus()) {
      throw new Error(`Invalid profile status: ${this.status}`);
    }
  }

  /**
   * 상태 유효성 확인
   */
  isValidStatus() {
    const validStatuses = ['active', 'inactive', 'paused', 'error', 'processing', 'Unknown', 'unknown'];
    return validStatuses.includes(this.status);
  }

  /**
   * 프로필 활성화
   */
  activate() {
    this.status = 'active';
    this.updatedAt = new Date();
  }

  /**
   * 프로필 일시중지
   */
  pause() {
    this.status = 'paused';
    this.updatedAt = new Date();
  }

  /**
   * 프로필 비활성화
   */
  deactivate() {
    this.status = 'inactive';
    this.updatedAt = new Date();
  }

  /**
   * 메타데이터 업데이트
   */
  updateMetadata(key, value) {
    this.metadata[key] = value;
    this.updatedAt = new Date();
  }

  /**
   * JSON 변환
   */
  toJSON() {
    return {
      id: this.id,
      profileId: this.profileId,
      name: this.name,
      email: this.email,
      status: this.status,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 팩토리 메서드: JSON에서 생성
   */
  static fromJSON(json) {
    return new Profile(json);
  }
}

module.exports = Profile;