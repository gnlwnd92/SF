/**
 * 이메일 정규화 유틸리티
 * Google Sheets 매핑 시 이메일 주소 일관성 보장
 */

class EmailNormalizer {
  /**
   * 이메일 주소 정규화
   * @param {string} email - 원본 이메일 주소
   * @returns {string|null} - 정규화된 이메일 주소
   */
  static normalize(email) {
    if (!email) return null;
    
    // 문자열로 변환 (혹시 다른 타입이 들어올 경우 대비)
    email = String(email);
    
    // 1. 앞뒤 공백 제거
    email = email.trim();
    
    // 2. 소문자 변환
    email = email.toLowerCase();
    
    // 3. 이메일 유효성 기본 검증
    if (!email.includes('@')) {
      return null;
    }
    
    // 4. Gmail 특수 처리
    if (email.includes('@gmail.com') || email.includes('@googlemail.com')) {
      // Gmail alias (+) 제거
      email = email.replace(/\+[^@]*@/, '@');
      
      // googlemail.com을 gmail.com으로 통일
      email = email.replace('@googlemail.com', '@gmail.com');
      
      // Gmail은 점(.)을 무시하므로 점 제거 (@ 앞부분만)
      const [localPart, domain] = email.split('@');
      const normalizedLocal = localPart.replace(/\./g, '');
      email = `${normalizedLocal}@${domain}`;
    }
    
    // 5. 여러 개의 연속 공백을 단일 공백으로
    email = email.replace(/\s+/g, ' ');
    
    // 6. 이메일에 공백이 있으면 제거
    email = email.replace(/\s/g, '');
    
    return email;
  }
  
  /**
   * 두 이메일이 같은지 비교 (정규화 후 비교)
   * @param {string} email1 - 첫 번째 이메일
   * @param {string} email2 - 두 번째 이메일
   * @returns {boolean} - 동일 여부
   */
  static equals(email1, email2) {
    const normalized1 = this.normalize(email1);
    const normalized2 = this.normalize(email2);
    
    if (!normalized1 || !normalized2) return false;
    
    return normalized1 === normalized2;
  }
  
  /**
   * 이메일 리스트에서 정규화된 매핑 생성
   * @param {Array} emails - 이메일 배열
   * @returns {Map} - 정규화된 이메일 -> 원본 이메일 매핑
   */
  static createNormalizedMap(emails) {
    const map = new Map();
    
    emails.forEach(email => {
      const normalized = this.normalize(email);
      if (normalized) {
        // 정규화된 이메일을 키로, 원본을 값으로
        map.set(normalized, email);
      }
    });
    
    return map;
  }
  
  /**
   * fuzzy matching을 위한 유저네임 추출
   * @param {string} email - 이메일 주소
   * @returns {string|null} - 유저네임 부분
   */
  static extractUsername(email) {
    const normalized = this.normalize(email);
    if (!normalized) return null;
    
    const [username] = normalized.split('@');
    return username;
  }
  
  /**
   * 도메인 추출
   * @param {string} email - 이메일 주소
   * @returns {string|null} - 도메인 부분
   */
  static extractDomain(email) {
    const normalized = this.normalize(email);
    if (!normalized) return null;
    
    const parts = normalized.split('@');
    return parts.length === 2 ? parts[1] : null;
  }
}

module.exports = EmailNormalizer;