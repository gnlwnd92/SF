/**
 * YouTube Premium 다국어 지원 설정
 * 각 언어별 UI 텍스트 정의
 */

const languages = {
  // 영어
  en: {
    code: 'en',
    name: 'English',
    buttons: {
      manageMemership: ['Manage membership', 'Manage'],
      pause: ['Pause'],
      pauseMembership: ['Pause membership'],
      resume: ['Resume'],
      cancel: ['Cancel'],
      confirm: ['Confirm', 'OK'],
      moreActions: ['More actions', 'More'],
      // 팝업 확인 버튼 (action별 분리)
      confirmButtons: {
        pause: ['Pause', 'Pause membership', 'Confirm', 'OK', 'Yes'],
        resume: ['Resume', 'Resume membership', 'Confirm', 'OK', 'Yes'],
        general: ['Confirm', 'OK', 'Yes']
      }
    },
    status: {
      paused: ['Paused', 'Membership paused'],
      active: ['Active'],
      pausedUntil: 'Paused until',
      resumeOn: 'Resume on',
      nextBilling: 'Next billing'
    },
    popupTexts: {
      resumeConfirmation: ['Resume membership', 'Confirm resume', 'Resume subscription'],
      willBeResumed: ['Membership will resume', 'will be resumed'],
      nextCharge: ['Next billing date', 'Next charge', 'Next payment']
    },
    datePatterns: {
      // 영어 날짜 패턴: "23 Sept" 또는 "23 Oct 2025"
      shortDate: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)(?:\s+(\d{4}))?/i,
      // "September 23" 또는 "September 23, 2025"
      monthDay: /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
      // "23 September 2025"
      dayMonth: /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i,
      // 기존 패턴도 유지
      fullDate: /(\w+)\s+(\d{1,2}),?\s*(\d{4})?/
    },
    paymentMethod: {
      addBackup: [
        'Add backup payment method',
        'Add a backup payment method',
        'Backup payment method'
      ],
      updatePayment: [
        'Update your payment method',
        'Update payment method',
        'Keep',
        'Use a different payment method'
      ],
      saveCard: ['Save', 'Confirm', 'Add']
    }
  },

  // 한국어
  ko: {
    code: 'ko',
    name: '한국어',
    buttons: {
      manageMemership: ['멤버십 관리', '구독 관리', '관리'],
      pause: ['일시중지'],
      pauseMembership: ['멤버십 일시중지'],
      resume: ['재개', '다시 시작'],
      resumeMembership: ['멤버십 재개'],
      cancel: ['취소', '멤버십 취소'],
      confirm: ['확인'],
      moreActions: ['추가 작업', '더보기'],
      edit: ['수정'],
      // 팝업 확인 버튼 (action별 분리) - 스크린샷에서 확인된 실제 버튼 텍스트
      confirmButtons: {
        pause: ['멤버십 일시중지', '일시중지', '확인', '예'],
        resume: ['재개', '멤버십 재개', '다시 시작', '확인', '예'],
        general: ['확인', '예', 'OK']
      }
    },
    status: {
      paused: ['일시중지됨', '멤버십 일시중지'],
      active: ['활성'],
      pausedUntil: '멤버십 일시중지',
      resumeOn: '멤버십 재개',
      nextBilling: '다음 결제일',
      trialEnds: '무료 체험 종료일',
      familyMembership: '가족 멤버십',
      familySharing: '가족 공유 설정',
      paymentCard: '결제 카드',
      backupPayment: '백업 결제 수단'
    },
    popupTexts: {
      resumeConfirmation: ['멤버십 재개', '재개 확인', '구독 재개'],
      willBeResumed: ['멤버십이 재개됩니다', '재개됩니다'],
      nextCharge: ['다음 결제일', '다음 청구일', '다음 결제'],
      // 일시중지 팝업 텍스트 (스크린샷에서 확인)
      selectPauseDuration: '일시중지 기간 선택',
      pauseDuration: ['1개월', '2개월', '3개월'],
      paymentWillRestart: '결제가 다시 시작됩니다',
      membershipWillBePaused: '멤버십이 일시중지됩니다'
    },
    datePatterns: {
      // 한국어 날짜 패턴: "9월 11일" 또는 "2026. 1. 22." (스크린샷에서 확인)
      monthDay: /(\d{1,2})월\s*(\d{1,2})일/,
      fullDate: /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/
    },
    paymentMethod: {
      addBackup: [
        '백업 결제수단 추가',
        '백업 결제 수단 추가',
        '백업 결제수단'
      ],
      updatePayment: [
        '결제수단 업데이트',
        '결제 수단 업데이트',
        '유지',
        '다른 결제수단 사용'
      ],
      saveCard: ['저장', '확인', '추가']
    }
  },

  // 터키어
  tr: {
    code: 'tr',
    name: 'Türkçe',
    buttons: {
      manageMemership: ['Üyeliği yönet', 'Yönet'],
      pause: ['Duraklat'],
      pauseMembership: ['Üyeliği duraklat'],
      resume: ['Devam', 'Devam et'],
      cancel: ['İptal'],
      confirm: ['Onayla', 'Tamam'],
      moreActions: ['Diğer işlemler', 'Daha fazla']
    },
    status: {
      paused: ['Duraklatıldı', 'Üyelik duraklatıldı'],
      active: ['Aktif'],
      pausedUntil: 'Şu tarihe kadar duraklatıldı',
      resumeOn: 'Devam tarihi',
      nextBilling: 'Sonraki faturalandırma'
    },
    popupTexts: {
      resumeConfirmation: ['Üyeliği devam ettir', 'Devamı onayla', 'Aboneliği devam ettir'],
      willBeResumed: ['Üyelik devam ettirilecek', 'devam ettirilecek'],
      nextCharge: ['Sonraki faturalandırma tarihi', 'Sonraki ücret', 'Sonraki ödeme']
    },
    datePatterns: {
      // 터키어 날짜 패턴 "11 Eylül" 형식
      monthDay: /(\d{1,2})\s+(Ocak|Mart|Şubat|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)/i,
      fullDate: /(\d{1,2})\s+(Ocak|Mart|Şubat|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(\d{4})?/i
    },
    paymentMethod: {
      addBackup: [
        'Yedek ödeme yöntemi ekle',
        'Yedek ödeme yöntemi',
        'Ödeme yöntemi ekle'
      ],
      updatePayment: [
        'Ödeme yönteminizi güncelleyin',
        'Ödeme yöntemini güncelle',
        'Tut',
        'Farklı bir ödeme yöntemi kullan'
      ],
      saveCard: ['Kaydet', 'Onayla', 'Ekle']
    }
  },

  // 포르투갈어 (브라질)
  // 포르투갈어 (브라질)
  'pt-br': {
    code: 'pt-br',
    name: 'Português (Brasil)',
    buttons: {
      manageMemership: ['Gerenciar assinatura', 'Gerenciar'],
      pause: ['Pausar'],
      pauseMembership: ['Pausar assinatura'],
      resume: ['Retomar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'OK'],
      moreActions: ['Mais ações', 'Mais']
    },
    status: {
      paused: ['Pausada', 'Assinatura pausada'],
      active: ['Ativa'],
      pausedUntil: 'Pausada até',
      pauseDate: 'A assinatura será pausada em',
      resumeOn: 'Retoma em',
      resumeDate: 'A assinatura será retomada em',
      nextBilling: 'Próxima cobrança',
      billingInfo: 'Faturado com',
      familySharing: 'Configurações de compartilhamento familiar',
      edit: 'Editar',
      alternativePayment: 'Forma de pagamento alternativa'
    },
    popupTexts: {
      resumeConfirmation: ['Retomar assinatura', 'Confirmar retomada'],
      willBeResumed: ['A assinatura será retomada', 'será retomada'],
      nextCharge: ['Próxima data de cobrança', 'Próxima cobrança', 'Próximo pagamento']
    },
    datePatterns: {
      full: /(\d{1,2}) de ([a-zç]+)\.? de (\d{4})/i,
      monthDay: /(\d{1,2}) de ([a-zç]+)/i,
      slashFormat: /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/
    },
    paymentMethod: {
      addBackup: [
        'Adicionar forma de pagamento alternativa',
        'Forma de pagamento alternativa',
        'Adicionar pagamento'
      ],
      updatePayment: [
        'Atualizar forma de pagamento',
        'Atualizar pagamento',
        'Manter',
        'Usar uma forma de pagamento diferente'
      ],
      saveCard: ['Salvar', 'Confirmar', 'Adicionar']
    }
  },
  
  // 포르투갈어 (포르투갈)
  'pt-pt': {
    code: 'pt-pt',
    name: 'Português (Portugal)',
    buttons: {
      manageMemership: ['Gerir subscrição', 'Gerir'],
      pause: ['Pausar'],
      pauseMembership: ['Pausar subscrição'],
      resume: ['Retomar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'OK'],
      moreActions: ['Mais ações', 'Mais']
    },
    status: {
      paused: ['Pausada', 'Subscrição pausada'],
      active: ['Ativa'],
      pausedUntil: 'Pausada até',
      pauseDate: 'A subscrição será pausada em',
      resumeOn: 'Retoma em',
      resumeDate: 'A subscrição será retomada em',
      nextBilling: 'Próxima faturação',
      billingInfo: 'Faturado com',
      familySharing: 'Configurações de partilha familiar',
      edit: 'Editar',
      alternativePayment: 'Forma de pagamento alternativa'
    },
    popupTexts: {
      resumeConfirmation: ['Retomar subscrição', 'Confirmar retomada'],
      willBeResumed: ['A subscrição será retomada', 'será retomada'],
      nextCharge: ['Próxima data de faturação', 'Próxima faturação', 'Próximo pagamento']
    },
    datePatterns: {
      full: /(\d{1,2}) de ([a-zç]+)\.? de (\d{4})/i,
      monthDay: /(\d{1,2}) de ([a-zç]+)/i,
      slashFormat: /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/
    },
    paymentMethod: {
      addBackup: [
        'Adicionar forma de pagamento alternativa',
        'Forma de pagamento alternativa',
        'Adicionar pagamento'
      ],
      updatePayment: [
        'Atualizar forma de pagamento',
        'Atualizar pagamento',
        'Manter',
        'Usar uma forma de pagamento diferente'
      ],
      saveCard: ['Guardar', 'Confirmar', 'Adicionar']
    }
  },

  // 포르투갈어 (폴백)
  pt: {
    code: 'pt',
    name: 'Português',
    buttons: {
      manageMemership: ['Gerenciar assinatura', 'Gerenciar', 'Gerir subscrição', 'Gerir'],
      pause: ['Pausar'],
      pauseMembership: ['Pausar assinatura', 'Pausar subscrição'],
      resume: ['Retomar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'OK'],
      moreActions: ['Mais ações', 'Mais']
    },
    status: {
      paused: ['Pausada', 'Assinatura pausada', 'Subscrição pausada'],
      active: ['Ativa'],
      pausedUntil: 'Pausada até',
      pauseDate: 'A assinatura será pausada em',
      resumeOn: 'Retoma em',
      resumeDate: 'A assinatura será retomada em',
      nextBilling: 'Próxima cobrança',
      billingInfo: 'Faturado com',
      familySharing: 'Configurações de compartilhamento familiar',
      edit: 'Editar',
      alternativePayment: 'Forma de pagamento alternativa'
    },
    popupTexts: {
      resumeConfirmation: ['Retomar assinatura', 'Confirmar retomada', 'Retomar subscrição'],
      willBeResumed: ['A assinatura será retomada', 'será retomada'],
      nextCharge: ['Próxima data de cobrança', 'Próxima cobrança', 'Próximo pagamento']
    },
    datePatterns: {
      // 포르투갈어 날짜 패턴
      // DD/MM/YYYY 또는 DD/MM 형식 (예: 22/10/2025 또는 22/09)
      slashDate: /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/,

      // "25 de ago." 또는 "25 de set. de 2025" 형식 (축약형 + 연도 옵션)
      monthDayShort: /(\d{1,2})\s+(?:de\s+)?(jan\.?|fev\.?|mar\.?|abr\.?|mai\.?|jun\.?|jul\.?|ago\.?|set\.?|out\.?|nov\.?|dez\.?)(?:\s+de\s+(\d{4}))?/i,

      // "11 de setembro" 형식 (전체 월 이름)
      monthDayFull: /(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/i,

      // 통합 패턴 - 모든 월 이름 형식 지원
      monthDay: /(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan\.?|fev\.?|mar\.?|abr\.?|mai\.?|jun\.?|jul\.?|ago\.?|set\.?|out\.?|nov\.?|dez\.?)(?:\s+de\s+(\d{4}))?/i,

      // 전체 날짜 (레거시 호환성)
      fullDate: /(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{4})?/i
    },
    paymentMethod: {
      addBackup: [
        'Adicionar forma de pagamento alternativa',
        'Forma de pagamento alternativa',
        'Adicionar pagamento',
        'Adicionar forma de pagamento'
      ],
      updatePayment: [
        'Atualizar forma de pagamento',
        'Atualizar pagamento',
        'Manter',
        'Usar uma forma de pagamento diferente',
        'Usar outra forma de pagamento'
      ],
      saveCard: ['Salvar', 'Guardar', 'Confirmar', 'Adicionar']
    }
  },

  // 인도네시아어
  id: {
    code: 'id',
    name: 'Bahasa Indonesia',
    buttons: {
      manageMemership: ['Kelola langganan', 'Kelola', 'Kelola keanggotaan'],
      pause: ['Jeda'],
      pauseMembership: ['Jeda langganan'],
      resume: ['Lanjutkan'],
      cancel: ['Batal'],
      confirm: ['Konfirmasi', 'OK', 'Ya'],
      moreActions: ['Tindakan lainnya', 'Lainnya']
    },
    status: {
      paused: ['Dijeda', 'Langganan dijeda'],
      active: ['Aktif'],
      pausedUntil: 'Dijeda hingga',
      resumeOn: 'Dilanjutkan pada',
      nextBilling: 'Tagihan berikutnya'
    },
    popupTexts: {
      resumeConfirmation: ['Lanjutkan langganan', 'Konfirmasi melanjutkan', 'Lanjutkan keanggotaan'],
      willBeResumed: ['Langganan akan dilanjutkan', 'akan dilanjutkan'],
      nextCharge: ['Tanggal tagihan berikutnya', 'Tagihan berikutnya', 'Pembayaran berikutnya']
    },
    datePatterns: {
      // 인도네시아어 날짜 패턴 "11 September" 또는 "11 Sep" 형식
      monthDay: /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)/i,
      fullDate: /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})?/i
    },
    paymentMethod: {
      addBackup: [
        'Tambahkan metode pembayaran cadangan',
        'Metode pembayaran cadangan',
        'Tambahkan pembayaran'
      ],
      updatePayment: [
        'Perbarui metode pembayaran Anda',
        'Perbarui metode pembayaran',
        'Simpan',
        'Gunakan metode pembayaran yang berbeda'
      ],
      saveCard: ['Simpan', 'Konfirmasi', 'Tambahkan']
    }
  },


  // 베트남어
  vi: {
    code: 'vi',
    name: 'Tiếng Việt',
    buttons: {
      manageMemership: ['Quản lý gói thành viên', 'Quản lý'],
      pause: ['Tạm dừng', 'Tạm dừng gói thành viên'],
      pauseMembership: ['Tạm dừng gói thành viên'],
      resume: ['Tiếp tục', 'Tiếp tục làm thành viên'],
      cancel: ['Hủy'],
      confirm: ['Xác nhận', 'OK', 'Tạm dừng gói thành viên'],
      moreActions: ['Thao tác khác', 'Thêm'],
      edit: ['Chỉnh sửa']
    },
    status: {
      paused: ['Đã tạm dừng', 'Gói thành viên đã tạm dừng', 'sẽ tạm dừng'],
      active: ['Đang hoạt động'],
      pausedUntil: 'Tạm dừng đến',
      pauseDate: 'Bạn sẽ tạm dừng làm thành viên từ',
      resumeOn: 'Tiếp tục làm thành viên từ ngày',
      resumeDate: 'Tiếp tục làm thành viên từ ngày',
      nextBilling: 'Thanh toán tiếp theo',
      nextPayment: 'Thanh toán sẽ tiếp tục vào',
      membershipWillPause: 'Tư cách thành viên của bạn sẽ tạm dừng sau',
      endOfBillingCycle: 'cuối chu kỳ thanh toán hiện tại',
      familySharing: 'Chế độ chia sẻ với gia đình',
      billingInfo: 'Thanh toán bằng',
      alternativePayment: 'Phương thức thanh toán dự phòng'
    },
    popupTexts: {
      resumeConfirmation: ['Tiếp tục gói thành viên', 'Xác nhận tiếp tục', 'Tiếp tục đăng ký'],
      willBeResumed: ['Gói thành viên sẽ được tiếp tục', 'sẽ được tiếp tục', 'Thanh toán sẽ tiếp tục vào'],
      nextCharge: ['Ngày thanh toán tiếp theo', 'Thanh toán tiếp theo', 'Lần thanh toán tiếp theo', 'Thanh toán sẽ tiếp tục vào'],
      pauseConfirmation: ['Tạm dừng gói thành viên', 'Chọn thời gian tạm dừng'],
      pauseDuration: ['1 tháng', '2 tháng', '3 tháng'],
      pauseNotice: 'Trong thời gian gói thành viên Premium của bạn tạm dừng, chúng tôi sẽ giữ lại tất cả các video bạn đã tải xuống và danh sách phát của bạn trên YouTube Music',
      familyNotice: 'Tất cả các tài khoản của thành viên gia đình cũng sẽ tạm dừng trong khoảng thời gian này',
      resumeAnytime: 'Bạn có thể mua lại gói thành viên bất cứ lúc nào'
    },
    datePatterns: {
      // 베트남어 날짜 패턴
      // "11 thg 9" (YouTube에서 사용), "11 tháng 9", "ngày 11 tháng 9" 형식
      monthDay: /(?:ngày\s+)?(\d{1,2})\s+(?:thg|tháng)\s+(\d{1,2})/,
      fullDate: /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      // YouTube Premium에서 사용하는 축약 형식 "11 thg 9"
      shortMonthDay: /(\d{1,2})\s+thg\s+(\d{1,2})/
    },
    paymentMethod: {
      addBackup: [
        'Thêm phương thức thanh toán dự phòng',
        'Phương thức thanh toán dự phòng',
        'Thêm phương thức thanh toán'
      ],
      updatePayment: [
        'Cập nhật phương thức thanh toán',
        'Cập nhật phương thức thanh toán của bạn',
        'Giữ',
        'Sử dụng phương thức thanh toán khác'
      ],
      saveCard: ['Lưu', 'Xác nhận', 'Thêm']
    }
  },

  // 일본어
  ja: {
    code: 'ja',
    name: '日本語',
    buttons: {
      manageMemership: ['メンバーシップを管理', '管理'],
      pause: ['一時停止'],
      pauseMembership: ['メンバーシップを一時停止'],
      resume: ['再開'],
      cancel: ['キャンセル'],
      confirm: ['確認', 'OK'],
      moreActions: ['その他の操作', 'もっと見る']
    },
    status: {
      paused: ['一時停止中', 'メンバーシップ一時停止'],
      active: ['有効'],
      pausedUntil: '一時停止期限',
      resumeOn: '再開日',
      nextBilling: '次回請求日'
    },
    datePatterns: {
      // 일본어 날짜 패턴: "9月11日" 또는 "2025年10月11日"
      monthDay: /(\d{1,2})月(\d{1,2})日/,
      fullDate: /(\d{4})年(\d{1,2})月(\d{1,2})日/
    },
    paymentMethod: {
      addBackup: [
        'バックアップ支払い方法を追加',
        'バックアップ支払い方法',
        '支払い方法を追加'
      ],
      updatePayment: [
        'お支払い方法を更新',
        '支払い方法を更新',
        '保持',
        '別の支払い方法を使用'
      ],
      saveCard: ['保存', '確認', '追加']
    },
    popupTexts: {
      resumeConfirmation: ['メンバーシップを再開', '再開を確認', 'サブスクリプションを再開'],
      willBeResumed: ['メンバーシップが再開されます', '再開されます'],
      nextCharge: ['次回請求日', '次回請求', '次回支払い']
    }
  },

  // 중국어 (간체)
  'zh-CN': {
    code: 'zh-CN',
    name: '简体中文',
    buttons: {
      manageMemership: ['管理会员资格', '管理'],
      pause: ['暂停'],
      pauseMembership: ['暂停会员资格'],
      resume: ['恢复'],
      cancel: ['取消'],
      confirm: ['确认', '确定'],
      moreActions: ['更多操作', '更多']
    },
    status: {
      paused: ['已暂停', '会员资格已暂停'],
      active: ['活跃'],
      pausedUntil: '暂停至',
      resumeOn: '恢复日期',
      nextBilling: '下次付款'
    },
    datePatterns: {
      // 중국어 날짜 패턴: "9月11日" 또는 "2025年10月11日"
      monthDay: /(\d{1,2})月(\d{1,2})日/,
      fullDate: /(\d{4})年(\d{1,2})月(\d{1,2})日/
    },
    paymentMethod: {
      addBackup: [
        '添加备用付款方式',
        '备用付款方式',
        '添加付款方式'
      ],
      updatePayment: [
        '更新付款方式',
        '更新您的付款方式',
        '保留',
        '使用其他付款方式'
      ],
      saveCard: ['保存', '确认', '添加']
    },
    popupTexts: {
      resumeConfirmation: ['恢复会员资格', '确认恢复', '恢复订阅'],
      willBeResumed: ['会员资格将恢复', '将恢复'],
      nextCharge: ['下次付款日期', '下次付款', '下次扣款']
    }
  },

  // 스페인어
  es: {
    code: 'es',
    name: 'Español',
    buttons: {
      manageMemership: ['Gestionar suscripción', 'Administrar membresía', 'Gestionar'],
      pause: ['Pausar'],
      pauseMembership: ['Pausar membresía', 'Pausar suscripción'],
      resume: ['Reanudar', 'Continuar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'Aceptar'],
      moreActions: ['Más acciones', 'Más'],
      edit: ['Editar'],
      familySharing: ['Configuración de uso compartido con la familia']
    },
    status: {
      paused: ['Pausada', 'Membresía pausada', 'Suscripción pausada'],
      active: ['Activa'],
      pausedUntil: 'Pausada hasta',
      resumeOn: 'Se reanuda el',
      nextBilling: 'Próximo pago',
      pauseDate: 'Fecha de suspensión de la membresía',
      resumeDate: 'Fecha de reanudación de la membresía',
      familyMembership: 'Membresía familiar',
      monthly: 'mensuales',
      billedWith: 'Facturado con',
      alternativePayment: 'Forma de pago alternativa',
      recommendedUpdates: 'Actualizaciones recomendadas'
    },
    popupTexts: {
      resumeConfirmation: ['Reanudar membresía', 'Confirmar reanudación', 'Reanudar suscripción'],
      willBeResumed: ['La membresía se reanudará', 'se reanudará'],
      nextCharge: ['Próxima fecha de pago', 'Próximo cargo', 'Próximo cobro']
    },
    datePatterns: {
      // 스페인어 날짜 패턴 - "26 ago", "26 sept 2025" 등
      shortDate: /(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)(?:\s+(\d{4}))?/i,
      // "26 de agosto" 또는 "26 de agosto de 2025"
      monthDay: /(\d{1,2})\s+(?:de\s+)?(\w+)(?:\s+(?:de\s+)?(\d{4}))?/,
      fullDate: /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/
    },
    paymentMethod: {
      addBackup: [
        'Agregar forma de pago alternativa',
        'Forma de pago alternativa',
        'Agregar forma de pago'
      ],
      updatePayment: [
        'Actualizar forma de pago',
        'Actualizar tu forma de pago',
        'Mantener',
        'Usar una forma de pago diferente'
      ],
      saveCard: ['Guardar', 'Confirmar', 'Agregar']
    }
  },

  // 프랑스어
  fr: {
    code: 'fr',
    name: 'Français',
    buttons: {
      manageMemership: ['Gérer la souscription', 'Gérer l\'abonnement', 'Gérer'],
      pause: ['Suspendre'],
      pauseMembership: ['Suspendre l\'abonnement', 'Suspendre'],
      resume: ['Reprendre', 'Continuer'],
      resumeMembership: ['Reprendre l\'abonnement', 'Reprendre'],
      cancel: ['Annuler'],
      confirm: ['Confirmer', 'OK', 'Oui'],
      moreActions: ['Plus d\'actions', 'Plus'],
      edit: ['Modifier'],
      familySharing: ['Paramètres de partage familial']
    },
    status: {
      paused: ['Suspendu', 'Abonnement suspendu', 'Abonnement suspendu le'],
      active: ['Actif', 'Abonnement actif'],
      pausedUntil: 'Suspendu jusqu\'au',
      resumeOn: 'Reprise de l\'abonnement le',
      nextBilling: 'Prochaine facturation',
      pauseDate: 'Abonnement suspendu le',
      resumeDate: 'Reprise de l\'abonnement le',
      familyMembership: 'Abonnement famille',
      monthly: 'mois',
      billedWith: 'Mode de paiement',
      alternativePayment: 'Mode de paiement secondaire',
      recommendedUpdates: 'Mises à jour recommandées',
      perMonth: '/mois',
      currency: 'PKR'
    },
    popupTexts: {
      resumeConfirmation: ['Reprendre l\'abonnement', 'Confirmer la reprise', 'Reprendre la souscription'],
      willBeResumed: ['L\'abonnement sera repris', 'sera repris'],
      nextCharge: ['Prochaine date de facturation', 'Prochaine charge', 'Prochain paiement']
    },
    datePatterns: {
      // 프랑스어 날짜 패턴: "27 août", "27 sept. 2025", "27 septembre 2025"
      shortDate: /(\d{1,2})\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\.?(?:\s+(\d{4}))?/i,
      monthDay: /(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+(\d{4}))?/i,
      fullDate: /(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i
    },
    paymentMethod: {
      addBackup: [
        'Ajouter un mode de paiement secondaire',
        'Mode de paiement secondaire',
        'Ajouter un mode de paiement'
      ],
      updatePayment: [
        'Mettre à jour le mode de paiement',
        'Mettre à jour votre mode de paiement',
        'Conserver',
        'Utiliser un autre mode de paiement'
      ],
      saveCard: ['Enregistrer', 'Confirmer', 'Ajouter']
    }
  },

  // 러시아어
  ru: {
    code: 'ru',
    name: 'Русский',
    buttons: {
      manageMemership: ['Продлить или изменить', 'Управление подпиской', 'Управлять', 'Продлить/изменить'],
      pause: ['Приостановить', 'Пауза'],
      pauseMembership: ['Приостановить подписку', 'Приостановить членство'],
      resume: ['Возобновить', 'Продолжить'],
      resumeMembership: ['Возобновить подписку', 'Возобновить членство'],
      extendOrChange: ['Продлить или изменить'],
      cancel: ['Отмена', 'Отменить'],
      confirm: ['Подтвердить', 'ОК', 'Да'],
      moreActions: ['Другие действия', 'Еще', 'Ещё'],
      edit: ['Изменить', 'Редактировать'],
      accessSettings: ['Настройки доступа', 'Параметры доступа'],
      // 팝업 확인 버튼 (action별 분리) - 스크린샷에서 확인된 실제 버튼 텍스트
      confirmButtons: {
        pause: ['Приостановить подписку', 'Приостановить', 'Подтвердить', 'ОК', 'Да'],
        resume: ['Возобновить', 'Возобновить подписку', 'Подтвердить', 'ОК', 'Да'],
        general: ['Подтвердить', 'ОК', 'Да']
      }
    },
    status: {
      paused: ['Приостановлена', 'Подписка приостановлена'],
      active: ['Активна', 'Активная подписка'],
      pausedUntil: 'Приостановлена до',
      resumeOn: 'Возобновление',
      nextBilling: 'Следующий платеж',
      pauseDate: 'Дата приостановки подписки',
      resumeDate: 'Дата возобновления подписки',
      payment: 'Оплата',
      backupPayment: 'Резервный способ оплаты',
      billedWith: 'Способ оплаты',
      trialEnds: 'Пробный период завершается',
      familyMembership: 'Семейная подписка'
    },
    popupTexts: {
      // 재개 확인 팝업 텍스트
      resumeConfirmation: ['Возобновить подписку', 'Подтвердить возобновление', 'Возобновление подписки'],
      willBeResumed: ['Подписка будет возобновлена', 'будет возобновлена'],
      nextCharge: ['Следующий платеж', 'Следующее списание', 'Дата следующего платежа'],
      // 일시중지 팝업 텍스트 (스크린샷에서 확인)
      selectPauseDuration: 'Выберите продолжительность перерыва',
      pauseDuration: ['1 месяц', '2 месяца', '3 месяца'],
      paymentWillRestart: 'Средства снова начнут списываться',
      subscriptionWillBePaused: 'Ваша подписка будет приостановлена'
    },
    datePatterns: {
      // Русский формат: "9 сент.", "9 окт. 2025 г.", "9 сентября", "9 октября 2025 г."
      shortMonth: /(\d{1,2})\s+(янв|февр|март|апр|мая|июн|июл|авг|сент|окт|нояб|дек)\.?(?:\s+(\d{4})\s*г?\.?)?/i,
      fullMonth: /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4})\s*г?\.?)?/i,
      // Поддержка формата DD.MM.YYYY
      dotFormat: /(\d{1,2})\.(\d{1,2})\.(\d{4})/
    },
    months: {
      short: ['янв', 'февр', 'март', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'],
      full: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
    },
    paymentMethod: {
      addBackup: [
        'Добавить резервный способ оплаты',
        'Резервный способ оплаты',
        'Добавить способ оплаты'
      ],
      updatePayment: [
        'Обновить способ оплаты',
        'Обновите способ оплаты',
        'Сохранить',
        'Использовать другой способ оплаты'
      ],
      saveCard: ['Сохранить', 'Подтвердить', 'Добавить']
    }
  },

  // 우르두어 (파키스탄)
  ur: {
    code: 'ur',
    name: 'اردو',
    buttons: {
      manageMemership: ['رکنیت کا نظم کریں', 'رکنیت منتظم کریں', 'منتظم کریں'],
      pause: ['روکیں', 'موقوف کریں'],
      pauseMembership: ['رکنیت روکیں', 'رکنیت موقوف کریں'],
      resume: ['دوبارہ شروع کریں', 'جاری رکھیں'],
      resumeMembership: ['رکنیت دوبارہ شروع کریں'],
      cancel: ['منسوخ کریں', 'کینسل'],
      confirm: ['تصدیق کریں', 'ٹھیک ہے'],
      moreActions: ['مزید اعمال', 'مزید'],
      edit: ['ترمیم کریں'],
      familySharing: ['خاندانی اشتراک کی ترتیبات']
    },
    status: {
      paused: ['موقوف', 'رکنیت موقوف'],
      active: ['فعال', 'چالو'],
      pausedUntil: 'موقوف تک',
      resumeOn: 'دوبارہ شروع',
      nextBilling: 'اگلی بلنگ',
      pauseDate: 'رکنیت موقوف کرنے کی تاریخ',
      resumeDate: 'رکنیت دوبارہ شروع کرنے کی تاریخ',
      familyMembership: 'خاندانی رکنیت',
      monthly: 'ماہانہ',
      billedWith: 'بل کی ادائیگی',
      alternativePayment: 'متبادل ادائیگی کا طریقہ',
      recommendedUpdates: 'تجویز کردہ اپ ڈیٹس',
      currency: 'PKR',
      perMonth: '/ماہ'
    },
    datePatterns: {
      // اردو میں تاریخ عام طور پر انگریزی فارمیٹ میں لکھی جاتی ہے
      // لیکن مہینے اردو میں بھی ہو سکتے ہیں
      monthDay: /(\d{1,2})\s+(جنوری|فروری|مارچ|اپریل|مئی|جون|جولائی|اگست|ستمبر|اکتوبر|نومبر|دسمبر)/,
      fullDate: /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      // انگریزی فارمیٹ بھی سپورٹ کریں کیونکہ YouTube میں مکس ہو سکتا ہے
      englishFormat: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?/i
    },
    months: {
      urdu: ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر']
    },
    paymentMethod: {
      addBackup: [
        'متبادل ادائیگی کا طریقہ شامل کریں',
        'متبادل ادائیگی کا طریقہ',
        'ادائیگی کا طریقہ شامل کریں'
      ],
      updatePayment: [
        'اپنا ادائیگی کا طریقہ اپ ڈیٹ کریں',
        'ادائیگی کا طریقہ اپ ڈیٹ کریں',
        'رکھیں',
        'مختلف ادائیگی کا طریقہ استعمال کریں'
      ],
      saveCard: ['محفوظ کریں', 'تصدیق کریں', 'شامل کریں']
    }
  }
};

/**
 * 언어 감지 함수
 * 페이지 내용을 분석하여 현재 언어를 자동으로 감지
 */
function detectLanguage(pageText) {
  // 각 언어의 특징적인 키워드로 감지
  const languageIndicators = {
    ko: ['멤버십', '관리', '일시중지', '재개'],
    en: ['membership', 'Manage', 'Pause', 'Resume'],
    // 포르투갈어 변형 구분 - 브라질과 포르투갈 분리
    'pt-br': ['assinatura', 'Gerenciar', 'Pausar', 'Retomar', 'Próxima cobrança', 'faturamento', 'Pausar assinatura'],
    'pt-pt': ['subscrição', 'Gerir', 'Pausar', 'Retomar', 'Próxima faturação', 'faturação', 'Pausar subscrição'],
    pt: ['Pausar', 'Retomar'], // 공통 키워드 (폴백용)
    id: ['Kelola langganan', 'Kelola', 'Jeda', 'Lanjutkan', 'langganan', 'keanggotaan', 'Dijeda', 'Tagihan'],
    tr: ['Üyeliği', 'yönet', 'Duraklat', 'Devam'],
    ru: ['подписк', 'Приостановить', 'Возобновить', 'Продлить или изменить', 'Дата приостановки', 'Дата возобновления', 'Оплата', 'Изменить', 'Отмена'],
    ur: ['رکنیت', 'موقوف', 'دوبارہ شروع', 'منسوخ', 'ترمیم', 'خاندانی'],
    // 베트남어 키워드 추가 및 개선 - 대소문자 구분 필요
    vi: ['Quản lý gói thành viên', 'Quản lý', 'gói thành viên', 'Tạm dừng', 'Tiếp tục', 'thành viên', 
         'Đã tạm dừng', 'Thanh toán', 'Hủy', 'Chỉnh sửa', 'gia đình', 'tháng', 'thg', 
         'Chế độ chia sẻ', 'Phương thức thanh toán', 'chu kỳ thanh toán', 'Tiếp tục làm thành viên'],
    // 프랑스어 - 더 많은 고유 키워드 추가
    fr: ['Gérer la souscription', 'souscription', 'Suspendre', 'Reprendre', 'Prochaine facturation', 'Suspendu', 'Confirmer', 'Annuler'],
    ja: ['メンバーシップ', '一時停止', '再開'],
    'zh-CN': ['会员', '暂停', '恢复'],
    es: ['Administrar membresía', 'membresía', 'Pausar', 'Reanudar', 'Fecha de suspensión', 'Fecha de reanudación', 'Cancelar', 'familiar', 'mensuales'],
    // 독일어는 프랑스어 다음에 확인 (우선순위 낮춤)
    de: ['Mitgliedschaft', 'Verwalten', 'Pausieren', 'Fortsetzen']
  };

  let detectedLang = 'en'; // 기본값
  let maxMatches = 0;
  let debugInfo = {};

  // 포르투갈어 변형 먼저 확인 (pt-br, pt-pt)
  const portugueseVariants = ['pt-br', 'pt-pt'];
  for (const variant of portugueseVariants) {
    const keywords = languageIndicators[variant];
    const matches = keywords.filter(keyword => {
      return pageText.includes(keyword);
    }).length;
    
    debugInfo[variant] = matches;
    
    if (matches > 0) {
      // 브라질/포르투갈 고유 키워드가 발견되면 즉시 해당 변형 선택
      if (variant === 'pt-br' && (pageText.includes('assinatura') || pageText.includes('Gerenciar') || pageText.includes('faturamento'))) {
        console.log(`🌍 포르투갈어(브라질) 감지됨`);
        return 'pt-br';
      }
      if (variant === 'pt-pt' && (pageText.includes('subscrição') || pageText.includes('Gerir') || pageText.includes('faturação'))) {
        console.log(`🌍 포르투갈어(포르투갈) 감지됨`);
        return 'pt-pt';
      }
    }
  }

  // 다른 언어들 확인
  for (const [lang, keywords] of Object.entries(languageIndicators)) {
    // 포르투갈어 변형은 이미 확인했으므로 건너뜀
    if (portugueseVariants.includes(lang) || lang === 'pt') {
      continue;
    }
    
    // 베트남어는 대소문자 구분하여 검색 (이세 문자 고려)
    const matches = keywords.filter(keyword => {
      if (lang === 'vi') {
        // 베트남어는 대소문자 구분하여 검색
        return pageText.includes(keyword);
      } else {
        // 다른 언어는 대소문자 무시
        return pageText.toLowerCase().includes(keyword.toLowerCase());
      }
    }).length;
    
    debugInfo[lang] = matches;
    
    if (matches > maxMatches) {
      maxMatches = matches;
      detectedLang = lang;
    }
  }
  
  // 포르투갈어 공통 키워드만 있는 경우 일반 'pt'로 폴백
  if (detectedLang === 'en' && languageIndicators.pt) {
    const ptMatches = languageIndicators.pt.filter(keyword => 
      pageText.includes(keyword)
    ).length;
    
    if (ptMatches > 0) {
      console.log(`🌍 포르투갈어(일반) 감지됨`);
      return 'pt';
    }
  }
  
  // 디버깅 정보 출력 (필요시)
  if (global.debugLanguageDetection) {
    console.log('언어 감지 결과:', debugInfo);
    console.log('최종 감지 언어:', detectedLang, '(매칭 수:', maxMatches, ')');
  }

  return detectedLang;
}

/**
 * 날짜 파싱 함수
 * 각 언어별 날짜 형식을 파싱하여 표준 형식으로 변환
 */
function parseDate(dateString, langCode) {
  const lang = languages[langCode];
  if (!lang) {
    // 언어 정보가 없어도 영어로 시도
    langCode = 'en';
  }

  // 날짜 문자열 정규화
  const normalizedDate = dateString.trim();
  
  // 포르투갈어 DD/MM/YYYY 또는 DD/MM 형식 처리 (25/09, 25/09/2025 모두 지원)
  // pt, pt-br, pt-pt 모두 처리
  if (langCode === 'pt' || langCode === 'pt-br' || langCode === 'pt-pt') {
    // "7 de out." 또는 "7 de nov. de 2025" 형식 처리
    const deFormatMatch = normalizedDate.match(/(\d{1,2})\s+de\s+([a-zç]+)\.?(?:\s+de\s+(\d{4}))?/i);
    if (deFormatMatch) {
      const monthMap = {
        'jan': '01', 'janeiro': '01',
        'fev': '02', 'fevereiro': '02',
        'mar': '03', 'março': '03',
        'abr': '04', 'abril': '04',
        'mai': '05', 'maio': '05',
        'jun': '06', 'junho': '06',
        'jul': '07', 'julho': '07',
        'ago': '08', 'agosto': '08',
        'set': '09', 'setembro': '09',
        'out': '10', 'outubro': '10',
        'nov': '11', 'novembro': '11',
        'dez': '12', 'dezembro': '12'
      };
      
      const day = deFormatMatch[1].padStart(2, '0');
      const monthStr = deFormatMatch[2].toLowerCase().replace('.', '');
      const month = monthMap[monthStr];
      let year = deFormatMatch[3];
      
      if (!year) {
        // 연도가 없으면 동적으로 계산
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth() + 1;
        const parsedMonth = parseInt(month);
        
        // 현재 월보다 이전 월이면 다음 해로 설정
        if (parsedMonth < currentMonth) {
          year = currentYear + 1;
        } else {
          year = currentYear;
        }
      }
      
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }
    
    // DD/MM 또는 DD/MM/YYYY 형식 처리
    const slashMatch = normalizedDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      let year = slashMatch[3];
      if (!year) {
        // 연도가 없으면 현재 연도 사용
        year = new Date().getFullYear();
      } else if (year.length === 2) {
        // 두 자리 연도면 2000년대로 처리
        year = '20' + year;
      }
      return `${year}-${month}-${day}`;
    }
    
    // 기존 패턴도 체크
    if (lang.datePatterns && lang.datePatterns.slashDate) {
      const slashMatch2 = normalizedDate.match(lang.datePatterns.slashDate);
      if (slashMatch2) {
        const day = slashMatch2[1].padStart(2, '0');
        const month = slashMatch2[2].padStart(2, '0');
        const year = slashMatch2[3] || new Date().getFullYear();
        return `${year}-${month}-${day}`;
      }
    }
    
    // slashFormat 패턴도 체크 (pt-br, pt-pt용)
    if (lang.datePatterns && lang.datePatterns.slashFormat) {
      const slashMatch3 = normalizedDate.match(lang.datePatterns.slashFormat);
      if (slashMatch3) {
        const day = slashMatch3[1].padStart(2, '0');
        const month = slashMatch3[2].padStart(2, '0');
        const year = slashMatch3[3] || new Date().getFullYear();
        return `${year}-${month}-${day}`;
      }
    }
  }
  
  // 영어 "23 Sept" 또는 "23 Oct 2025" 형식 처리
  if (langCode === 'en' && lang.datePatterns && lang.datePatterns.shortDate) {
    const shortDateMatch = normalizedDate.match(lang.datePatterns.shortDate);
    if (shortDateMatch) {
      const monthMap = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'sept': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      const day = shortDateMatch[1].padStart(2, '0');
      const monthStr = shortDateMatch[2].toLowerCase().substring(0, 4);
      const month = monthMap[monthStr] || monthMap[monthStr.substring(0, 3)];
      const year = shortDateMatch[3] || new Date().getFullYear();
      return `${year}-${month}-${day}`;
    }
  }
  
  // 우르두어 날짜 처리
  if (langCode === 'ur' && lang.datePatterns) {
    // اردو مہینے والی تاریخ
    if (lang.datePatterns.monthDay) {
      const urduMatch = normalizedDate.match(lang.datePatterns.monthDay);
      if (urduMatch) {
        const monthMap = {
          'جنوری': '01', 'فروری': '02', 'مارچ': '03', 'اپریل': '04',
          'مئی': '05', 'جون': '06', 'جولائی': '07', 'اگست': '08',
          'ستمبر': '09', 'اکتوبر': '10', 'نومبر': '11', 'دسمبر': '12'
        };
        const day = urduMatch[1].padStart(2, '0');
        const monthStr = urduMatch[2];
        const month = monthMap[monthStr];
        const year = new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
    
    // DD/MM/YYYY فارمیٹ
    if (lang.datePatterns.fullDate) {
      const slashMatch = normalizedDate.match(lang.datePatterns.fullDate);
      if (slashMatch) {
        const day = slashMatch[1].padStart(2, '0');
        const month = slashMatch[2].padStart(2, '0');
        const year = slashMatch[3];
        return `${year}-${month}-${day}`;
      }
    }
    
    // English format fallback (YouTube might mix languages)
    if (lang.datePatterns.englishFormat) {
      const englishMatch = normalizedDate.match(lang.datePatterns.englishFormat);
      if (englishMatch) {
        const monthMap = {
          'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
          'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
          'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        };
        const day = englishMatch[1].padStart(2, '0');
        const monthStr = englishMatch[2].toLowerCase().substring(0, 3);
        const month = monthMap[monthStr];
        const year = englishMatch[3] || new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
  }
  
  // 러시아어 날짜 처리
  if (langCode === 'ru' && lang.datePatterns) {
    // DD.MM.YYYY 형식 처리
    if (lang.datePatterns.dotFormat) {
      const dotMatch = normalizedDate.match(lang.datePatterns.dotFormat);
      if (dotMatch) {
        const day = dotMatch[1].padStart(2, '0');
        const month = dotMatch[2].padStart(2, '0');
        const year = dotMatch[3];
        return `${year}-${month}-${day}`;
      }
    }
    
    // "9 сент.", "9 окт. 2025 г." 형식 처리
    if (lang.datePatterns.shortMonth) {
      const shortMatch = normalizedDate.match(lang.datePatterns.shortMonth);
      if (shortMatch) {
        const monthMap = {
          'янв': '01', 'февр': '02', 'март': '03', 'апр': '04',
          'мая': '05', 'май': '05', 'июн': '06', 'июл': '07',
          'авг': '08', 'сент': '09', 'окт': '10', 'нояб': '11', 'дек': '12'
        };
        const day = shortMatch[1].padStart(2, '0');
        const monthStr = shortMatch[2].toLowerCase().replace('.', '');
        const month = monthMap[monthStr];
        const year = shortMatch[3] || new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
    
    // "9 сентября", "9 октября 2025 г." 형식 처리
    if (lang.datePatterns.fullMonth) {
      const fullMatch = normalizedDate.match(lang.datePatterns.fullMonth);
      if (fullMatch) {
        const monthMap = {
          'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
          'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
          'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
        };
        const day = fullMatch[1].padStart(2, '0');
        const monthStr = fullMatch[2].toLowerCase();
        const month = monthMap[monthStr];
        const year = fullMatch[3] || new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
  }
  
  // 스페인어 "26 ago" 또는 "26 sept 2025" 형식 처리
  if (langCode === 'es' && lang.datePatterns && lang.datePatterns.shortDate) {
    const shortDateMatch = normalizedDate.match(lang.datePatterns.shortDate);
    if (shortDateMatch) {
      const monthMap = {
        'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'ago': '08',
        'sep': '09', 'sept': '09', 'oct': '10', 'nov': '11', 'dic': '12'
      };
      const day = shortDateMatch[1].padStart(2, '0');
      const monthStr = shortDateMatch[2].toLowerCase().substring(0, 4);
      const month = monthMap[monthStr] || monthMap[monthStr.substring(0, 3)];
      const year = shortDateMatch[3] || new Date().getFullYear();
      return `${year}-${month}-${day}`;
    }
  }
  
  // 프랑스어 "27 août", "27 sept.", "25 sept." 형식 처리 (연도 없이도 처리)
  if (langCode === 'fr') {
    // 짧은 형식: "27 août", "27 sept.", "27 sept. 2025"
    if (lang.datePatterns && lang.datePatterns.shortDate) {
      const shortDateMatch = normalizedDate.match(lang.datePatterns.shortDate);
      if (shortDateMatch) {
        const monthMap = {
          'janv': '01', 'févr': '02', 'mars': '03', 'avr': '04',
          'mai': '05', 'juin': '06', 'juil': '07', 'août': '08',
          'sept': '09', 'oct': '10', 'nov': '11', 'déc': '12'
        };
        const day = shortDateMatch[1].padStart(2, '0');
        const monthStr = shortDateMatch[2].toLowerCase().replace('.', '');
        const month = monthMap[monthStr];
        // 연도가 없으면 현재 연도 사용
        const year = shortDateMatch[3] || new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
    
    // 긴 형식: "27 septembre", "27 septembre 2025"
    if (lang.datePatterns && lang.datePatterns.monthDay) {
      const monthDayMatch = normalizedDate.match(lang.datePatterns.monthDay);
      if (monthDayMatch) {
        const monthMap = {
          'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
          'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
          'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const day = monthDayMatch[1].padStart(2, '0');
        const monthStr = monthDayMatch[2].toLowerCase();
        const month = monthMap[monthStr];
        const year = monthDayMatch[3] || new Date().getFullYear();
        if (month) {
          return `${year}-${month}-${day}`;
        }
      }
    }
  }
  
  // "Sep 11" 같은 짧은 형식 처리 (기존 코드 유지)
  const shortMonthMatch = normalizedDate.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})$/i);
  if (shortMonthMatch) {
    const monthMap = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 
      'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    const month = monthMap[shortMonthMatch[1].toLowerCase().substring(0, 3)];
    const day = shortMonthMatch[2].padStart(2, '0');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let year = currentYear;
    if (parseInt(month) < currentMonth) {
      year = currentYear + 1;
    }
    return `${year}-${month}-${day}`;
  }
  
  // 전체 날짜 패턴 시도
  if (lang && lang.datePatterns && lang.datePatterns.fullDate) {
    const fullMatch = normalizedDate.match(lang.datePatterns.fullDate);
    if (fullMatch) {
      // 언어별로 다른 날짜 형식 처리
      switch (langCode) {
        case 'ko':
          // 2025. 10. 11.
          return `${fullMatch[1]}-${fullMatch[2].padStart(2, '0')}-${fullMatch[3].padStart(2, '0')}`;
        case 'en':
          // September 11, 2025
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                             'July', 'August', 'September', 'October', 'November', 'December'];
          const monthNum = monthNames.findIndex(m => fullMatch[1].includes(m)) + 1;
          return `${fullMatch[3] || new Date().getFullYear()}-${monthNum.toString().padStart(2, '0')}-${fullMatch[2].padStart(2, '0')}`;
        case 'ja':
        case 'zh-CN':
          // 2025年10月11日
          return `${fullMatch[1]}-${fullMatch[2].padStart(2, '0')}-${fullMatch[3].padStart(2, '0')}`;
        case 'es':
          // 26 de agosto de 2025
          const spanishMonths = {
            'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
            'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
            'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
          };
          const esMonth = spanishMonths[fullMatch[2].toLowerCase()] || '01';
          return `${fullMatch[3]}-${esMonth}-${fullMatch[1].padStart(2, '0')}`;
        case 'pt':
          // 25 de setembro de 2025
          const portugueseMonths = {
            'janeiro': '01', 'fevereiro': '02', 'março': '03', 'abril': '04',
            'maio': '05', 'junho': '06', 'julho': '07', 'agosto': '08',
            'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12'
          };
          const ptMonth = portugueseMonths[fullMatch[2].toLowerCase()] || '01';
          const ptYear = fullMatch[3] || new Date().getFullYear();
          return `${ptYear}-${ptMonth}-${fullMatch[1].padStart(2, '0')}`;
        default:
          return normalizedDate; // 파싱 실패시 원본 반환
      }
    }
  }

  // 월/일만 있는 패턴 시도
  // 베트남어의 경우 shortMonthDay 패턴 먼저 시도 ("11 thg 9")
  if (langCode === 'vi' && lang.datePatterns.shortMonthDay) {
    const shortMatch = normalizedDate.match(lang.datePatterns.shortMonthDay);
    if (shortMatch) {
      const currentYear = new Date().getFullYear();
      const day = shortMatch[1].padStart(2, '0');
      const month = shortMatch[2].padStart(2, '0');
      // 베트남어 날짜를 표준 형식으로 변환
      return `${currentYear}-${month}-${day}`;
    }
  }
  
  if (lang.datePatterns.monthDay) {
    const monthDayMatch = normalizedDate.match(lang.datePatterns.monthDay);
    if (monthDayMatch) {
      const currentYear = new Date().getFullYear();
      
      switch (langCode) {
        case 'ko':
          // 9월 11일
          return `${currentYear}-${monthDayMatch[1].padStart(2, '0')}-${monthDayMatch[2].padStart(2, '0')}`;
        case 'es':
          // "26 de agosto" o "26 agosto"
          const spanishMonthsShort = {
            'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
            'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
            'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
          };
          const esMonthName = monthDayMatch[2].toLowerCase();
          const esMonthNum = spanishMonthsShort[esMonthName] || '01';
          const year = monthDayMatch[3] || currentYear;
          return `${year}-${esMonthNum}-${monthDayMatch[1].padStart(2, '0')}`;
        case 'vi':
          // "11 tháng 9" 형식 - 일이 먼저, 월이 나중에
          const viDay = monthDayMatch[1].padStart(2, '0');
          const viMonth = monthDayMatch[2].padStart(2, '0');
          // 베트남어 날짜를 표준 형식으로 변환
          return `${currentYear}-${viMonth}-${viDay}`;
        case 'pt':
          // "11 de setembro" 또는 "11 set." 형식 - 포르투갈어 월 이름을 숫자로 변환
          const ptDay = monthDayMatch[1].padStart(2, '0');
          const ptMonthNames = {
            'janeiro': '01', 'jan': '01',
            'fevereiro': '02', 'fev': '02',
            'março': '03', 'mar': '03',
            'abril': '04', 'abr': '04',
            'maio': '05', 'mai': '05',
            'junho': '06', 'jun': '06',
            'julho': '07', 'jul': '07',
            'agosto': '08', 'ago': '08',
            'setembro': '09', 'set': '09',
            'outubro': '10', 'out': '10',
            'novembro': '11', 'nov': '11',
            'dezembro': '12', 'dez': '12'
          };
          const ptMonth = ptMonthNames[monthDayMatch[2].toLowerCase().replace('.', '')] || monthDayMatch[2];
          if (ptMonth.length === 2) {
            return `${currentYear}-${ptMonth}-${ptDay}`;
          }
          break;
        case 'id':
          // "11 September" 또는 "11 Sep" 형식 - 인도네시아어 월 이름을 숫자로 변환
          const idDay = monthDayMatch[1].padStart(2, '0');
          const idMonthNames = {
            'januari': '01', 'jan': '01',
            'februari': '02', 'feb': '02',
            'maret': '03', 'mar': '03',
            'april': '04', 'apr': '04',
            'mei': '05',
            'juni': '06', 'jun': '06',
            'juli': '07', 'jul': '07',
            'agustus': '08', 'agu': '08',
            'september': '09', 'sep': '09',
            'oktober': '10', 'okt': '10',
            'november': '11', 'nov': '11',
            'desember': '12', 'des': '12'
          };
          const idMonth = idMonthNames[monthDayMatch[2].toLowerCase()] || monthDayMatch[2];
          if (idMonth.length === 2) {
            return `${currentYear}-${idMonth}-${idDay}`;
          }
          break;
        case 'tr':
          // "11 Eylül" 형식 - 터키어 월 이름을 숫자로 변환
          const trDay = monthDayMatch[1].padStart(2, '0');
          const trMonthNames = {
            'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04',
            'mayıs': '05', 'haziran': '06', 'temmuz': '07', 'ağustos': '08',
            'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12'
          };
          const trMonth = trMonthNames[monthDayMatch[2].toLowerCase()] || monthDayMatch[2];
          if (trMonth.length === 2) {
            return `${currentYear}-${trMonth}-${trDay}`;
          }
          break;
        case 'ru':
          // "11 сентября" 형식 - 러시아어 월 이름을 숫자로 변환
          const ruDay = monthDayMatch[1].padStart(2, '0');
          const ruMonthNames = {
            'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04',
            'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08',
            'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12'
          };
          const ruMonth = ruMonthNames[monthDayMatch[2].toLowerCase()] || monthDayMatch[2];
          if (ruMonth.length === 2) {
            return `${currentYear}-${ruMonth}-${ruDay}`;
          }
          break;
        case 'ja':
        case 'zh-CN':
          // 9月11日
          return `${currentYear}-${monthDayMatch[1].padStart(2, '0')}-${monthDayMatch[2].padStart(2, '0')}`;
        default:
          return normalizedDate;
      }
    }
  }

  return normalizedDate;
}

/**
 * 다국어 텍스트 매칭 함수
 */
function findButtonByMultilingualText(buttons, textList) {
  for (const button of buttons) {
    const btnText = button.textContent?.trim();
    if (!btnText) continue;
    
    for (const text of textList) {
      if (Array.isArray(text)) {
        // 배열인 경우 각 항목 체크
        if (text.some(t => btnText.includes(t))) {
          return button;
        }
      } else if (btnText.includes(text)) {
        return button;
      }
    }
  }
  return null;
}

module.exports = {
  languages,
  detectLanguage,
  parseDate,
  findButtonByMultilingualText
};