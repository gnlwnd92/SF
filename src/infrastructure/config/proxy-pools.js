/**
 * 프록시 풀 설정
 * 한국(KR), 파키스탄(PK), 미국(US) 프록시 각 100개
 */

// 프록시 기본 인증 정보
const PROXY_AUTH = {
  username: 'user-sproxq5yy8-sessionduration-1',
  password: 'CcI9pU1jfbcrU4m2+l'
};

// 한국 프록시 풀 (100개) - HTTPS 형식
const KR_PROXIES = Array.from({ length: 100 }, (_, i) => ({
  type: 'https',  // HTTPS로 변경
  host: 'kr.decodo.com',
  port: 10001 + i,
  username: PROXY_AUTH.username,
  password: PROXY_AUTH.password,
  url: `https://${PROXY_AUTH.username}:${PROXY_AUTH.password}@kr.decodo.com:${10001 + i}`
}));

// 파키스탄 프록시 풀 (100개) - 더 이상 사용하지 않음 (미국으로 대체)
const PK_PROXIES = Array.from({ length: 100 }, (_, i) => ({
  type: 'https',  // HTTPS로 변경
  host: 'pk.decodo.com',
  port: 10001 + i,
  username: PROXY_AUTH.username,
  password: PROXY_AUTH.password,
  url: `https://${PROXY_AUTH.username}:${PROXY_AUTH.password}@pk.decodo.com:${10001 + i}`
}));

// 미국 프록시 풀 (100개) - HTTPS 형식 (가족 요금제 확인용)
const US_PROXIES = Array.from({ length: 100 }, (_, i) => ({
  type: 'https',  // HTTPS로 변경
  host: 'us.decodo.com',
  port: 10001 + i,
  username: PROXY_AUTH.username,
  password: PROXY_AUTH.password,
  url: `https://${PROXY_AUTH.username}:${PROXY_AUTH.password}@us.decodo.com:${10001 + i}`
}));

/**
 * 랜덤 프록시 선택
 * @param {string} country - 'kr', 'pk', 'us', 또는 'none' (프록시 비활성화)
 * @returns {Object|null} 프록시 설정 객체 또는 null (프록시 없이 연결)
 */
function getRandomProxy(country) {
  // 'none' 옵션 추가: 프록시 없이 직접 연결
  if (country === 'none' || country === 'direct' || country === null) {
    console.log('✅ 프록시 없이 직접 연결 모드');
    return null;
  }

  let pool;
  switch(country.toLowerCase()) {
    case 'kr':
      pool = KR_PROXIES;
      break;
    case 'pk':
      pool = PK_PROXIES;
      break;
    case 'us':
      pool = US_PROXIES;
      break;
    default:
      console.warn(`⚠️ 알 수 없는 국가 코드: ${country}, 기본값으로 한국 프록시 사용`);
      pool = KR_PROXIES;
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  const proxy = pool[randomIndex];

  console.log(`🎲 랜덤 프록시 선택: ${proxy.host}:${proxy.port}`);

  return {
    proxy_type: proxy.type,
    proxy_host: proxy.host,
    proxy_port: String(proxy.port),
    proxy_user: proxy.username,
    proxy_password: proxy.password,
    proxy_soft: 'other'
  };
}

/**
 * 특정 포트의 프록시 가져오기
 * @param {string} country - 'kr', 'pk', 또는 'us'
 * @param {number} port - 포트 번호 (10001-10100)
 * @returns {Object} 프록시 설정 객체
 */
function getProxyByPort(country, port) {
  let pool;
  switch(country.toLowerCase()) {
    case 'kr':
      pool = KR_PROXIES;
      break;
    case 'pk':
      pool = PK_PROXIES;
      break;
    case 'us':
      pool = US_PROXIES;
      break;
    default:
      pool = KR_PROXIES;
  }
  const proxy = pool.find(p => p.port === port);
  
  if (!proxy) {
    console.warn(`⚠️ 프록시를 찾을 수 없음: ${country}:${port}`);
    return getRandomProxy(country);
  }
  
  return {
    proxy_type: proxy.type,
    proxy_host: proxy.host,
    proxy_port: String(proxy.port),
    proxy_user: proxy.username,
    proxy_password: proxy.password,
    proxy_soft: 'other'
  };
}

/**
 * 프록시 풀 상태 확인
 */
function getProxyPoolStatus() {
  return {
    kr: {
      total: KR_PROXIES.length,
      available: KR_PROXIES.length,
      host: 'kr.decodo.com',
      portRange: '10001-10100'
    },
    pk: {
      total: PK_PROXIES.length,
      available: PK_PROXIES.length,
      host: 'pk.decodo.com',
      portRange: '10001-10100'
    },
    us: {
      total: US_PROXIES.length,
      available: US_PROXIES.length,
      host: 'us.decodo.com',
      portRange: '10001-10100'
    }
  };
}

module.exports = {
  KR_PROXIES,
  PK_PROXIES,
  US_PROXIES,
  PROXY_AUTH,
  getRandomProxy,
  getProxyByPort,
  getProxyPoolStatus
};