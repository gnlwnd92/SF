/**
 * @interface IProfileRepository
 * @description 프로필 레포지토리 인터페이스
 */
class IProfileRepository {
  /**
   * 프로필 ID로 조회
   * @param {string} profileId
   * @returns {Promise<Profile|null>}
   */
  async findById(profileId) {
    throw new Error('Method not implemented');
  }

  /**
   * 이메일로 프로필 조회
   * @param {string} email
   * @returns {Promise<Profile|null>}
   */
  async findByEmail(email) {
    throw new Error('Method not implemented');
  }

  /**
   * 모든 프로필 조회
   * @param {Object} options
   * @returns {Promise<Array<Profile>>}
   */
  async findAll(options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * 프로필 저장
   * @param {Profile} profile
   * @returns {Promise<Profile>}
   */
  async save(profile) {
    throw new Error('Method not implemented');
  }

  /**
   * 프로필 업데이트
   * @param {string} profileId
   * @param {Object} updates
   * @returns {Promise<Profile>}
   */
  async update(profileId, updates) {
    throw new Error('Method not implemented');
  }

  /**
   * 프로필 삭제
   * @param {string} profileId
   * @returns {Promise<boolean>}
   */
  async delete(profileId) {
    throw new Error('Method not implemented');
  }

  /**
   * 상태별 프로필 조회
   * @param {string} status
   * @returns {Promise<Array<Profile>>}
   */
  async findByStatus(status) {
    throw new Error('Method not implemented');
  }
}

module.exports = IProfileRepository;