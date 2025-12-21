/**
 * YouTube Premium 다국어 텍스트 매핑
 * 새로운 언어 추가 시 이 파일만 수정하면 됨
 */

const YOUTUBE_LANGUAGES = {
  // 터키어
  tr: {
    name: 'Türkçe',
    manage: ['Üyeliği yönet', 'Yönet'],
    pause: ['Duraklat', 'Üyeliği duraklat', 'Ara ver'],
    pauseConfirm: ['Üyeliği duraklat'],  // 팝업에서 최종 확인
    resume: ['Devam', 'Devam et', 'Yeniden başlat'],
    resumeConfirm: ['Üyeliği devam ettir'],  // 팝업에서 최종 확인
    confirm: ['Onayla', 'Evet', 'Tamam'],
    cancel: ['İptal', 'Hayır'],
    membership: ['Üyelik', 'Abonelik'],
    status: {
      paused: ['Duraklatıldı', 'Durduruldu'],
      active: ['Aktif', 'Etkin'],
      error: ['Hata', 'Başarısız']
    }
  },

  // 포르투갈어 (브라질/포르투갈)
  pt: {
    name: 'Português',
    manage: ['Gerenciar assinatura', 'Gerenciar', 'Gerir subscrição', 'Gerir', 'Gerir assinatura'],
    pause: ['Pausar', 'Pausar assinatura', 'Pausar subscrição', 'Suspender'],
    pauseConfirm: ['Pausar assinatura', 'Pausar subscrição'],  // 팝업에서 최종 확인
    resume: ['Retomar', 'Continuar', 'Reativar'],
    resumeConfirm: ['Retomar assinatura', 'Retomar subscrição', 'Retomar'],  // 팝업에서 최종 확인
    confirm: ['Confirmar', 'Sim', 'OK', 'Continuar'],
    cancel: ['Cancelar', 'Não'],
    membership: ['Assinatura', 'Subscrição', 'Subscrição familiar'],
    billing: ['Faturado com', 'Método de pagamento', 'Forma de pagamento'],
    family: ['Definições de partilha', 'partilha com a família', 'compartilhamento familiar'],
    edit: ['Editar'],
    status: {
      paused: ['Pausada', 'Suspensa', 'vai ser colocada em pausa', 'será pausada'],
      active: ['Ativa', 'Ativo'],
      resume: ['vai ser retomada', 'será retomada'],
      error: ['Erro', 'Falha']
    }
  },

  // 인도네시아어
  id: {
    name: 'Bahasa Indonesia',
    manage: ['Kelola langganan', 'Kelola', 'Kelola keanggotaan'],
    pause: ['Jeda', 'Jeda langganan', 'Tangguhkan'],
    pauseConfirm: ['Jeda langganan'],  // 팝업에서 최종 확인
    resume: ['Lanjutkan', 'Lanjutkan langganan', 'Aktifkan kembali'],
    resumeConfirm: ['Lanjutkan langganan'],  // 팝업에서 최종 확인
    confirm: ['Konfirmasi', 'Ya', 'OK', 'Lanjutkan'],
    cancel: ['Batal', 'Tidak'],
    membership: ['Langganan', 'Keanggotaan'],
    status: {
      paused: ['Dijeda', 'Ditangguhkan'],
      active: ['Aktif', 'Berjalan'],
      error: ['Error', 'Gagal']
    }
  },

  // 러시아어
  ru: {
    name: 'Русский',
    manage: ['Продлить или изменить', 'Управление', 'Управлять подпиской'],
    pause: ['Приостановить', 'Приостановить подписку', 'Пауза'],
    pauseConfirm: ['Приостановить подписку'],  // 팝업에서 최종 확인
    resume: ['Возобновить', 'Продолжить', 'Восстановить'],
    resumeConfirm: ['Возобновить подписку'],  // 팝업에서 최종 확인
    confirm: ['Подтвердить', 'Да', 'ОК'],
    cancel: ['Отмена', 'Нет'],
    membership: ['Подписка', 'Членство'],
    status: {
      paused: ['Приостановлено', 'На паузе'],
      active: ['Активно', 'Действует'],
      error: ['Ошибка', 'Неудача']
    }
  },

  // 영어
  en: {
    name: 'English',
    manage: ['Manage membership', 'Manage', 'Manage subscription'],
    pause: ['Pause', 'Pause membership', 'Pause subscription'],
    pauseConfirm: ['Pause membership', 'Pause'],  // 팝업에서 최종 확인
    resume: ['Resume', 'Resume membership', 'Resume subscription'],
    resumeConfirm: ['Resume membership', 'Resume'],  // 팝업에서 최종 확인
    confirm: ['Confirm', 'Yes', 'OK', 'Continue'],
    cancel: ['Cancel', 'No'],
    membership: ['Membership', 'Subscription'],
    status: {
      paused: ['Paused', 'On hold'],
      active: ['Active', 'Running'],
      error: ['Error', 'Failed']
    }
  },

  // 한국어
  ko: {
    name: '한국어',
    manage: ['멤버십 관리', '관리', '구독 관리'],
    pause: ['일시중지', '멤버십 일시중지', '일시 중지', '구독 일시중지'],
    pauseConfirm: ['멤버십 일시중지', '일시중지'],  // 팝업에서 최종 확인
    resume: ['재개', '다시 시작', '멤버십 재개', '구독 재개'],
    resumeConfirm: ['멤버십 재개', '재개'],  // 팝업에서 최종 확인
    confirm: ['확인', '예', '계속'],
    cancel: ['취소', '아니오'],
    membership: ['멤버십', '구독'],
    status: {
      paused: ['일시중지됨', '일시중지 상태', '일시 중지됨'],
      active: ['활성', '구독 중', '활성화됨'],
      error: ['오류', '실패']
    }
  },

  // 베트남어
  vi: {
    name: 'Tiếng Việt',
    manage: ['Quản lý gói thành viên', 'Quản lý', 'Quản lý đăng ký'],
    pause: ['Tạm dừng', 'Tạm dừng gói thành viên', 'Tạm ngưng'],
    pauseConfirm: ['Tạm dừng gói thành viên'],  // 팝업에서 최종 확인
    resume: ['Tiếp tục', 'Khôi phục', 'Bắt đầu lại'],
    resumeConfirm: ['Tiếp tục gói thành viên'],  // 팝업에서 최종 확인
    confirm: ['Xác nhận', 'Có', 'Đồng ý', 'OK'],
    cancel: ['Hủy', 'Không'],
    membership: ['Gói thành viên', 'Đăng ký'],
    status: {
      paused: ['Đã tạm dừng', 'Tạm ngưng'],
      active: ['Đang hoạt động', 'Hoạt động'],
      error: ['Lỗi', 'Thất bại']
    }
  },

  // 스페인어
  es: {
    name: 'Español',
    manage: ['Administrar membresía', 'Administrar', 'Gestionar suscripción'],
    pause: ['Pausar', 'Pausar membresía', 'Suspender'],
    pauseConfirm: ['Pausar membresía'],
    resume: ['Reanudar', 'Continuar', 'Restaurar'],
    resumeConfirm: ['Reanudar membresía'],
    confirm: ['Confirmar', 'Sí', 'Aceptar'],
    cancel: ['Cancelar', 'No'],
    membership: ['Membresía', 'Suscripción'],
    status: {
      paused: ['Pausado', 'Suspendido'],
      active: ['Activo', 'En curso'],
      error: ['Error', 'Fallo']
    }
  },

  // 일본어
  ja: {
    name: '日本語',
    manage: ['メンバーシップを管理', '管理', 'サブスクリプション管理'],
    pause: ['一時停止', 'メンバーシップを一時停止', '停止'],
    pauseConfirm: ['メンバーシップを一時停止'],
    resume: ['再開', '再開する', '続ける'],
    resumeConfirm: ['メンバーシップを再開'],
    confirm: ['確認', 'はい', 'OK'],
    cancel: ['キャンセル', 'いいえ'],
    membership: ['メンバーシップ', 'サブスクリプション'],
    status: {
      paused: ['一時停止中', '停止中'],
      active: ['アクティブ', '有効'],
      error: ['エラー', '失敗']
    }
  },

  // 중국어 (간체)
  'zh-CN': {
    name: '简体中文',
    manage: ['管理会员', '管理', '管理订阅'],
    pause: ['暂停', '暂停会员', '暂停订阅'],
    pauseConfirm: ['暂停会员'],
    resume: ['恢复', '继续', '重新开始'],
    resumeConfirm: ['恢复会员'],
    confirm: ['确认', '是', '确定'],
    cancel: ['取消', '否'],
    membership: ['会员', '订阅'],
    status: {
      paused: ['已暂停', '暂停中'],
      active: ['活跃', '使用中'],
      error: ['错误', '失败']
    }
  },

  // 독일어
  de: {
    name: 'Deutsch',
    manage: ['Mitgliedschaft verwalten', 'Verwalten', 'Abo verwalten'],
    pause: ['Pausieren', 'Mitgliedschaft pausieren', 'Unterbrechen'],
    pauseConfirm: ['Mitgliedschaft pausieren'],
    resume: ['Fortsetzen', 'Wieder aufnehmen', 'Weitermachen'],
    resumeConfirm: ['Mitgliedschaft fortsetzen'],
    confirm: ['Bestätigen', 'Ja', 'OK'],
    cancel: ['Abbrechen', 'Nein'],
    membership: ['Mitgliedschaft', 'Abo'],  // 'Abonnement' 제거 (프랑스어와 충돌)
    status: {
      paused: ['Pausiert', 'Angehalten', 'Mitgliedschaft pausiert'],  // 독일어 고유 표현 추가
      active: ['Aktiv', 'Läuft'],
      error: ['Fehler', 'Fehlgeschlagen']
    }
  },

  // 프랑스어
  fr: {
    name: 'Français',
    manage: ['Gérer la souscription', 'Gérer l\'abonnement', 'Gérer'],
    pause: ['Suspendre', 'Suspendre l\'abonnement', 'Mettre en pause'],
    pauseConfirm: ['Suspendre l\'abonnement', 'Suspendre la souscription'],
    resume: ['Reprendre', 'Continuer', 'Réactiver'],
    resumeConfirm: ['Reprendre l\'abonnement', 'Reprendre la souscription'],
    confirm: ['Confirmer', 'Oui', 'OK', 'Valider'],
    cancel: ['Annuler', 'Non'],
    membership: ['Souscription', 'Abonnement'],
    status: {
      paused: ['Suspendu', 'En pause', 'Abonnement suspendu', 'Souscription suspendue'],
      active: ['Actif', 'En cours', 'Active'],
      error: ['Erreur', 'Échec']
    }
  },

  // 우르두어 (파키스탄)
  ur: {
    name: 'اردو',
    manage: ['رکنیت کا انتظام', 'انتظام کریں', 'سبسکرپشن کا انتظام'],
    pause: ['موقوف کریں', 'رکنیت موقوف کریں', 'عارضی طور پر بند کریں'],
    pauseConfirm: ['رکنیت موقوف کریں'],
    resume: ['دوبارہ شروع کریں', 'جاری رکھیں', 'بحال کریں'],
    resumeConfirm: ['رکنیت دوبارہ شروع کریں'],
    confirm: ['تصدیق کریں', 'جی ہاں', 'ٹھیک ہے'],
    cancel: ['منسوخ کریں', 'نہیں'],
    membership: ['رکنیت', 'سبسکرپشن'],
    status: {
      paused: ['موقوف', 'عارضی طور پر بند'],
      active: ['فعال', 'چل رہا ہے'],
      error: ['خرابی', 'ناکام']
    }
  },

  // 힌디어 (인도/파키스탄 일부)
  hi: {
    name: 'हिन्दी',
    manage: ['सदस्यता प्रबंधित करें', 'प्रबंधित करें', 'सब्सक्रिप्शन प्रबंधन'],
    pause: ['रोकें', 'सदस्यता रोकें', 'विराम'],
    pauseConfirm: ['सदस्यता रोकें'],
    resume: ['फिर से शुरू करें', 'जारी रखें', 'पुनः आरंभ करें'],
    resumeConfirm: ['सदस्यता फिर से शुरू करें'],
    confirm: ['पुष्टि करें', 'हाँ', 'ठीक है'],
    cancel: ['रद्द करें', 'नहीं'],
    membership: ['सदस्यता', 'सब्सक्रिप्शन'],
    status: {
      paused: ['रोका गया', 'विराम में'],
      active: ['सक्रिय', 'चालू'],
      error: ['त्रुटि', 'विफल']
    }
  }
};

/**
 * 모든 언어의 특정 키워드 가져오기
 */
function getAllTextsForAction(action) {
  const texts = [];
  Object.values(YOUTUBE_LANGUAGES).forEach(lang => {
    if (lang[action]) {
      texts.push(...lang[action]);
    }
  });
  return [...new Set(texts)]; // 중복 제거
}

/**
 * 언어 코드로 언어 정보 가져오기
 */
function getLanguage(langCode) {
  // 언어 코드 정규화 (예: en-US -> en)
  const normalizedCode = langCode.toLowerCase().split('-')[0];
  
  // 정확한 매치 찾기
  if (YOUTUBE_LANGUAGES[langCode]) {
    return YOUTUBE_LANGUAGES[langCode];
  }
  
  // 기본 언어 코드로 찾기
  if (YOUTUBE_LANGUAGES[normalizedCode]) {
    return YOUTUBE_LANGUAGES[normalizedCode];
  }
  
  // 부분 매치 찾기 (예: zh-TW -> zh-CN)
  const partialMatch = Object.keys(YOUTUBE_LANGUAGES).find(key => 
    key.startsWith(normalizedCode) || normalizedCode.startsWith(key.split('-')[0])
  );
  
  if (partialMatch) {
    return YOUTUBE_LANGUAGES[partialMatch];
  }
  
  // 기본값: 영어
  return YOUTUBE_LANGUAGES.en;
}

/**
 * 페이지에서 언어 감지
 */
async function detectPageLanguage(page) {
  try {
    const langCode = await page.evaluate(() => {
      // 1. html lang 속성
      const htmlLang = document.documentElement.lang;
      if (htmlLang) return htmlLang;
      
      // 2. YouTube 특정 언어 표시
      const langElement = document.querySelector('[lang]');
      if (langElement) return langElement.getAttribute('lang');
      
      // 3. URL 파라미터
      const urlParams = new URLSearchParams(window.location.search);
      const hlParam = urlParams.get('hl');
      if (hlParam) return hlParam;
      
      // 4. 메타 태그
      const metaLang = document.querySelector('meta[http-equiv="content-language"]');
      if (metaLang) return metaLang.content;
      
      return 'en'; // 기본값
    });
    
    return langCode;
  } catch (error) {
    console.log('언어 감지 실패:', error.message);
    return 'en';
  }
}

/**
 * 지원 언어 목록
 */
function getSupportedLanguages() {
  return Object.keys(YOUTUBE_LANGUAGES).map(code => ({
    code,
    name: YOUTUBE_LANGUAGES[code].name
  }));
}

/**
 * 새 언어 추가 (런타임)
 */
function addLanguage(langCode, langData) {
  YOUTUBE_LANGUAGES[langCode] = langData;
}

module.exports = {
  YOUTUBE_LANGUAGES,
  getAllTextsForAction,
  getLanguage,
  detectPageLanguage,
  getSupportedLanguages,
  addLanguage
};