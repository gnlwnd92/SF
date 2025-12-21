/**
 * YouTube Premium 백업카드 변경 다국어 지원 설정
 * 15개 언어 지원 - 결제수단 관리 페이지 UI 텍스트
 */

const backupCardLanguages = {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 영어 (English)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  en: {
    code: 'en',
    name: 'English',
    paymentMethod: {
      // 결제수단 관리 페이지
      managePayment: ['Manage payment', 'Payment methods', 'Manage payment methods'],
      addBackup: ['Add backup payment method', 'Add backup', 'Backup payment method'],
      updatePayment: ['Update payment method', 'Update payment', 'Change payment method'],

      // 카드 입력 필드
      cardNumber: ['Card number', 'Card Number'],
      expiryDate: ['Expiration date', 'Expiry date', 'MM/YY', 'Expires'],
      securityCode: ['Security code', 'CVV', 'CVC', 'Card security code'],
      cvv: ['CVV', 'CVC', 'Security code'],
      cardholderName: ['Cardholder name', 'Name on card'],

      // 주소 입력 필드
      country: ['Country', 'Country/Region'],
      streetAddress: ['Street address', 'Address', 'Address line 1'],
      city: ['City'],
      postalCode: ['Postal code', 'ZIP code', 'Postcode'],
      state: ['State', 'Province'],

      // 버튼
      saveCard: ['Save', 'Save card', 'Add card', 'Continue'],
      cancel: ['Cancel'],
      confirm: ['Confirm', 'OK'],

      // 상태 메시지
      cardAdded: ['Card added', 'Backup payment method added'],
      cardUpdated: ['Payment method updated'],
      errorOccurred: ['An error occurred', 'Error']
    },

    popupScenarios: {
      // Scenario 1: 직접 추가 팝업
      directAdd: {
        title: ['Add backup payment method', 'Backup payment'],
        subtitle: ['Add a backup payment method for your subscription']
      },

      // Scenario 2: 변경 후 추가 팝업
      changeAndAdd: {
        updateFirst: ['Update payment method first', 'Update payment'],
        thenAddBackup: ['Then add backup payment method', 'Add backup']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 한국어 (Korean)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ko: {
    code: 'ko',
    name: '한국어',
    paymentMethod: {
      managePayment: ['결제 수단 관리', '결제수단', '결제 관리'],
      addBackup: ['백업 결제 수단 추가', '백업 추가', '백업 결제수단'],
      updatePayment: ['결제 수단 업데이트', '결제수단 변경', '결제 방법 변경'],

      cardNumber: ['카드 번호', '카드번호'],
      expiryDate: ['유효기간', '만료일', 'MM/YY'],
      securityCode: ['보안 코드', 'CVV', 'CVC', '카드 보안 코드'],
      cvv: ['CVV', 'CVC', '보안 코드'],
      cardholderName: ['카드 소유자 이름', '카드 소유자'],

      country: ['국가', '국가/지역'],
      streetAddress: ['도로명 주소', '주소', '주소 1'],
      city: ['도시'],
      postalCode: ['우편번호'],
      state: ['시/도', '주'],

      saveCard: ['저장', '카드 저장', '카드 추가', '계속'],
      cancel: ['취소'],
      confirm: ['확인'],

      cardAdded: ['카드가 추가됨', '백업 결제 수단이 추가됨'],
      cardUpdated: ['결제 수단이 업데이트됨'],
      errorOccurred: ['오류 발생', '오류']
    },

    popupScenarios: {
      directAdd: {
        title: ['백업 결제 수단 추가', '백업 결제'],
        subtitle: ['구독에 대한 백업 결제 수단을 추가하세요']
      },

      changeAndAdd: {
        updateFirst: ['먼저 결제 수단 업데이트', '결제수단 변경'],
        thenAddBackup: ['그런 다음 백업 결제 수단 추가', '백업 추가']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 일본어 (Japanese)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ja: {
    code: 'ja',
    name: '日本語',
    paymentMethod: {
      managePayment: ['お支払い方法の管理', 'お支払い方法', '支払い管理'],
      addBackup: ['予備のお支払い方法を追加', 'バックアップ追加', '予備の支払い方法'],
      updatePayment: ['お支払い方法を更新', '支払い方法の変更'],

      cardNumber: ['カード番号'],
      expiryDate: ['有効期限', 'MM/YY'],
      securityCode: ['セキュリティコード', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'セキュリティコード'],
      cardholderName: ['カード名義人', 'カード所有者名'],

      country: ['国', '国/地域'],
      streetAddress: ['住所', '番地'],
      city: ['市区町村'],
      postalCode: ['郵便番号'],
      state: ['都道府県'],

      saveCard: ['保存', 'カードを保存', 'カードを追加', '続行'],
      cancel: ['キャンセル'],
      confirm: ['確認', 'OK'],

      cardAdded: ['カードが追加されました', '予備のお支払い方法が追加されました'],
      cardUpdated: ['お支払い方法が更新されました'],
      errorOccurred: ['エラーが発生しました', 'エラー']
    },

    popupScenarios: {
      directAdd: {
        title: ['予備のお支払い方法を追加', 'バックアップ支払い'],
        subtitle: ['サブスクリプションの予備のお支払い方法を追加']
      },

      changeAndAdd: {
        updateFirst: ['まずお支払い方法を更新', '支払い方法変更'],
        thenAddBackup: ['次に予備のお支払い方法を追加', 'バックアップ追加']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 중국어 간체 (Simplified Chinese)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  'zh-CN': {
    code: 'zh-CN',
    name: '简体中文',
    paymentMethod: {
      managePayment: ['管理付款方式', '付款方式', '付款管理'],
      addBackup: ['添加备用付款方式', '添加备用', '备用付款方式'],
      updatePayment: ['更新付款方式', '更改付款方式'],

      cardNumber: ['卡号'],
      expiryDate: ['有效期', '到期日期', 'MM/YY'],
      securityCode: ['安全码', 'CVV', 'CVC', '卡安全码'],
      cvv: ['CVV', 'CVC', '安全码'],
      cardholderName: ['持卡人姓名'],

      country: ['国家', '国家/地区'],
      streetAddress: ['街道地址', '地址', '地址第1行'],
      city: ['城市'],
      postalCode: ['邮政编码'],
      state: ['省/州'],

      saveCard: ['保存', '保存卡', '添加卡', '继续'],
      cancel: ['取消'],
      confirm: ['确认'],

      cardAdded: ['已添加卡', '已添加备用付款方式'],
      cardUpdated: ['付款方式已更新'],
      errorOccurred: ['发生错误', '错误']
    },

    popupScenarios: {
      directAdd: {
        title: ['添加备用付款方式', '备用付款'],
        subtitle: ['为您的订阅添加备用付款方式']
      },

      changeAndAdd: {
        updateFirst: ['首先更新付款方式', '更改付款方式'],
        thenAddBackup: ['然后添加备用付款方式', '添加备用']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 중국어 번체 (Traditional Chinese)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  'zh-TW': {
    code: 'zh-TW',
    name: '繁體中文',
    paymentMethod: {
      managePayment: ['管理付款方式', '付款方式', '付款管理'],
      addBackup: ['新增備用付款方式', '新增備用', '備用付款方式'],
      updatePayment: ['更新付款方式', '變更付款方式'],

      cardNumber: ['卡號'],
      expiryDate: ['有效期限', '到期日期', 'MM/YY'],
      securityCode: ['安全碼', 'CVV', 'CVC', '卡片安全碼'],
      cvv: ['CVV', 'CVC', '安全碼'],
      cardholderName: ['持卡人姓名'],

      country: ['國家', '國家/地區'],
      streetAddress: ['街道地址', '地址', '地址第1行'],
      city: ['城市'],
      postalCode: ['郵遞區號'],
      state: ['省/州'],

      saveCard: ['儲存', '儲存卡片', '新增卡片', '繼續'],
      cancel: ['取消'],
      confirm: ['確認'],

      cardAdded: ['已新增卡片', '已新增備用付款方式'],
      cardUpdated: ['付款方式已更新'],
      errorOccurred: ['發生錯誤', '錯誤']
    },

    popupScenarios: {
      directAdd: {
        title: ['新增備用付款方式', '備用付款'],
        subtitle: ['為您的訂閱新增備用付款方式']
      },

      changeAndAdd: {
        updateFirst: ['首先更新付款方式', '變更付款方式'],
        thenAddBackup: ['然後新增備用付款方式', '新增備用']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 스페인어 (Spanish)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  es: {
    code: 'es',
    name: 'Español',
    paymentMethod: {
      managePayment: ['Administrar pago', 'Métodos de pago', 'Administrar métodos de pago'],
      addBackup: ['Agregar método de pago de respaldo', 'Agregar respaldo', 'Método de pago de respaldo'],
      updatePayment: ['Actualizar método de pago', 'Cambiar método de pago'],

      cardNumber: ['Número de tarjeta'],
      expiryDate: ['Fecha de vencimiento', 'Vencimiento', 'MM/AA'],
      securityCode: ['Código de seguridad', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Código de seguridad'],
      cardholderName: ['Nombre del titular', 'Titular de la tarjeta'],

      country: ['País', 'País/Región'],
      streetAddress: ['Dirección', 'Calle', 'Dirección línea 1'],
      city: ['Ciudad'],
      postalCode: ['Código postal', 'CP'],
      state: ['Estado', 'Provincia'],

      saveCard: ['Guardar', 'Guardar tarjeta', 'Agregar tarjeta', 'Continuar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'Aceptar'],

      cardAdded: ['Tarjeta agregada', 'Método de pago de respaldo agregado'],
      cardUpdated: ['Método de pago actualizado'],
      errorOccurred: ['Ocurrió un error', 'Error']
    },

    popupScenarios: {
      directAdd: {
        title: ['Agregar método de pago de respaldo', 'Pago de respaldo'],
        subtitle: ['Agrega un método de pago de respaldo para tu suscripción']
      },

      changeAndAdd: {
        updateFirst: ['Actualizar método de pago primero', 'Actualizar pago'],
        thenAddBackup: ['Luego agregar método de pago de respaldo', 'Agregar respaldo']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 프랑스어 (French)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  fr: {
    code: 'fr',
    name: 'Français',
    paymentMethod: {
      managePayment: ['Gérer le paiement', 'Modes de paiement', 'Gérer les modes de paiement'],
      addBackup: ['Ajouter un mode de paiement de secours', 'Ajouter un secours', 'Mode de paiement de secours'],
      updatePayment: ['Mettre à jour le mode de paiement', 'Changer le mode de paiement'],

      cardNumber: ['Numéro de carte'],
      expiryDate: ['Date d\'expiration', 'Expiration', 'MM/AA'],
      securityCode: ['Code de sécurité', 'CVV', 'CVC', 'Cryptogramme'],
      cvv: ['CVV', 'CVC', 'Code de sécurité'],
      cardholderName: ['Nom du titulaire', 'Titulaire de la carte'],

      country: ['Pays', 'Pays/Région'],
      streetAddress: ['Adresse', 'Rue', 'Ligne d\'adresse 1'],
      city: ['Ville'],
      postalCode: ['Code postal'],
      state: ['État', 'Province', 'Région'],

      saveCard: ['Enregistrer', 'Enregistrer la carte', 'Ajouter une carte', 'Continuer'],
      cancel: ['Annuler'],
      confirm: ['Confirmer', 'OK'],

      cardAdded: ['Carte ajoutée', 'Mode de paiement de secours ajouté'],
      cardUpdated: ['Mode de paiement mis à jour'],
      errorOccurred: ['Une erreur s\'est produite', 'Erreur']
    },

    popupScenarios: {
      directAdd: {
        title: ['Ajouter un mode de paiement de secours', 'Paiement de secours'],
        subtitle: ['Ajoutez un mode de paiement de secours pour votre abonnement']
      },

      changeAndAdd: {
        updateFirst: ['Mettre à jour le mode de paiement d\'abord', 'Mettre à jour le paiement'],
        thenAddBackup: ['Puis ajouter un mode de paiement de secours', 'Ajouter un secours']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 독일어 (German)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  de: {
    code: 'de',
    name: 'Deutsch',
    paymentMethod: {
      managePayment: ['Zahlung verwalten', 'Zahlungsmethoden', 'Zahlungsmethoden verwalten'],
      addBackup: ['Ersatz-Zahlungsmethode hinzufügen', 'Ersatz hinzufügen', 'Ersatz-Zahlungsmethode'],
      updatePayment: ['Zahlungsmethode aktualisieren', 'Zahlungsmethode ändern'],

      cardNumber: ['Kartennummer'],
      expiryDate: ['Ablaufdatum', 'Gültig bis', 'MM/JJ'],
      securityCode: ['Sicherheitscode', 'CVV', 'CVC', 'Prüfziffer'],
      cvv: ['CVV', 'CVC', 'Sicherheitscode'],
      cardholderName: ['Karteninhaber', 'Name auf der Karte'],

      country: ['Land', 'Land/Region'],
      streetAddress: ['Straße', 'Adresse', 'Adresszeile 1'],
      city: ['Stadt'],
      postalCode: ['Postleitzahl', 'PLZ'],
      state: ['Bundesland', 'Staat'],

      saveCard: ['Speichern', 'Karte speichern', 'Karte hinzufügen', 'Weiter'],
      cancel: ['Abbrechen'],
      confirm: ['Bestätigen', 'OK'],

      cardAdded: ['Karte hinzugefügt', 'Ersatz-Zahlungsmethode hinzugefügt'],
      cardUpdated: ['Zahlungsmethode aktualisiert'],
      errorOccurred: ['Ein Fehler ist aufgetreten', 'Fehler']
    },

    popupScenarios: {
      directAdd: {
        title: ['Ersatz-Zahlungsmethode hinzufügen', 'Ersatzzahlung'],
        subtitle: ['Fügen Sie eine Ersatz-Zahlungsmethode für Ihr Abonnement hinzu']
      },

      changeAndAdd: {
        updateFirst: ['Zahlungsmethode zuerst aktualisieren', 'Zahlung aktualisieren'],
        thenAddBackup: ['Dann Ersatz-Zahlungsmethode hinzufügen', 'Ersatz hinzufügen']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 포르투갈어 (Portuguese)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  pt: {
    code: 'pt',
    name: 'Português',
    paymentMethod: {
      managePayment: ['Gerenciar pagamento', 'Métodos de pagamento', 'Gerenciar métodos de pagamento'],
      addBackup: ['Adicionar método de pagamento de backup', 'Adicionar backup', 'Método de pagamento de backup'],
      updatePayment: ['Atualizar método de pagamento', 'Alterar método de pagamento'],

      cardNumber: ['Número do cartão'],
      expiryDate: ['Data de validade', 'Validade', 'MM/AA'],
      securityCode: ['Código de segurança', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Código de segurança'],
      cardholderName: ['Nome do titular', 'Titular do cartão'],

      country: ['País', 'País/Região'],
      streetAddress: ['Endereço', 'Rua', 'Linha de endereço 1'],
      city: ['Cidade'],
      postalCode: ['Código postal', 'CEP'],
      state: ['Estado', 'Província'],

      saveCard: ['Salvar', 'Salvar cartão', 'Adicionar cartão', 'Continuar'],
      cancel: ['Cancelar'],
      confirm: ['Confirmar', 'OK'],

      cardAdded: ['Cartão adicionado', 'Método de pagamento de backup adicionado'],
      cardUpdated: ['Método de pagamento atualizado'],
      errorOccurred: ['Ocorreu um erro', 'Erro']
    },

    popupScenarios: {
      directAdd: {
        title: ['Adicionar método de pagamento de backup', 'Pagamento de backup'],
        subtitle: ['Adicione um método de pagamento de backup para sua assinatura']
      },

      changeAndAdd: {
        updateFirst: ['Atualizar método de pagamento primeiro', 'Atualizar pagamento'],
        thenAddBackup: ['Depois adicionar método de pagamento de backup', 'Adicionar backup']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 러시아어 (Russian)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ru: {
    code: 'ru',
    name: 'Русский',
    paymentMethod: {
      managePayment: ['Управление платежами', 'Способы оплаты', 'Управление способами оплаты'],
      addBackup: ['Добавить резервный способ оплаты', 'Добавить резервный', 'Резервный способ оплаты'],
      updatePayment: ['Обновить способ оплаты', 'Изменить способ оплаты'],

      cardNumber: ['Номер карты'],
      expiryDate: ['Срок действия', 'Действителен до', 'MM/ГГ'],
      securityCode: ['Код безопасности', 'CVV', 'CVC', 'Код CVV'],
      cvv: ['CVV', 'CVC', 'Код безопасности'],
      cardholderName: ['Имя владельца карты', 'Владелец карты'],

      country: ['Страна', 'Страна/Регион'],
      streetAddress: ['Адрес', 'Улица', 'Адресная строка 1'],
      city: ['Город'],
      postalCode: ['Почтовый индекс'],
      state: ['Область', 'Штат'],

      saveCard: ['Сохранить', 'Сохранить карту', 'Добавить карту', 'Продолжить'],
      cancel: ['Отмена'],
      confirm: ['Подтвердить', 'ОК'],

      cardAdded: ['Карта добавлена', 'Резервный способ оплаты добавлен'],
      cardUpdated: ['Способ оплаты обновлен'],
      errorOccurred: ['Произошла ошибка', 'Ошибка']
    },

    popupScenarios: {
      directAdd: {
        title: ['Добавить резервный способ оплаты', 'Резервный платеж'],
        subtitle: ['Добавьте резервный способ оплаты для вашей подписки']
      },

      changeAndAdd: {
        updateFirst: ['Сначала обновите способ оплаты', 'Обновить оплату'],
        thenAddBackup: ['Затем добавьте резервный способ оплаты', 'Добавить резервный']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 이탈리아어 (Italian)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  it: {
    code: 'it',
    name: 'Italiano',
    paymentMethod: {
      managePayment: ['Gestisci pagamento', 'Metodi di pagamento', 'Gestisci metodi di pagamento'],
      addBackup: ['Aggiungi metodo di pagamento di riserva', 'Aggiungi riserva', 'Metodo di pagamento di riserva'],
      updatePayment: ['Aggiorna metodo di pagamento', 'Cambia metodo di pagamento'],

      cardNumber: ['Numero carta'],
      expiryDate: ['Data di scadenza', 'Scadenza', 'MM/AA'],
      securityCode: ['Codice di sicurezza', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Codice di sicurezza'],
      cardholderName: ['Nome titolare', 'Titolare della carta'],

      country: ['Paese', 'Paese/Regione'],
      streetAddress: ['Indirizzo', 'Via', 'Riga indirizzo 1'],
      city: ['Città'],
      postalCode: ['Codice postale', 'CAP'],
      state: ['Stato', 'Provincia'],

      saveCard: ['Salva', 'Salva carta', 'Aggiungi carta', 'Continua'],
      cancel: ['Annulla'],
      confirm: ['Conferma', 'OK'],

      cardAdded: ['Carta aggiunta', 'Metodo di pagamento di riserva aggiunto'],
      cardUpdated: ['Metodo di pagamento aggiornato'],
      errorOccurred: ['Si è verificato un errore', 'Errore']
    },

    popupScenarios: {
      directAdd: {
        title: ['Aggiungi metodo di pagamento di riserva', 'Pagamento di riserva'],
        subtitle: ['Aggiungi un metodo di pagamento di riserva per il tuo abbonamento']
      },

      changeAndAdd: {
        updateFirst: ['Aggiorna prima il metodo di pagamento', 'Aggiorna pagamento'],
        thenAddBackup: ['Poi aggiungi metodo di pagamento di riserva', 'Aggiungi riserva']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 네덜란드어 (Dutch)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  nl: {
    code: 'nl',
    name: 'Nederlands',
    paymentMethod: {
      managePayment: ['Betaling beheren', 'Betaalmethoden', 'Betaalmethoden beheren'],
      addBackup: ['Reservebetaalmethode toevoegen', 'Reserve toevoegen', 'Reservebetaalmethode'],
      updatePayment: ['Betaalmethode bijwerken', 'Betaalmethode wijzigen'],

      cardNumber: ['Kaartnummer'],
      expiryDate: ['Vervaldatum', 'Geldig tot', 'MM/JJ'],
      securityCode: ['Beveiligingscode', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Beveiligingscode'],
      cardholderName: ['Naam kaarthouder', 'Kaarthouder'],

      country: ['Land', 'Land/Regio'],
      streetAddress: ['Adres', 'Straat', 'Adresregel 1'],
      city: ['Stad'],
      postalCode: ['Postcode'],
      state: ['Provincie', 'Staat'],

      saveCard: ['Opslaan', 'Kaart opslaan', 'Kaart toevoegen', 'Doorgaan'],
      cancel: ['Annuleren'],
      confirm: ['Bevestigen', 'OK'],

      cardAdded: ['Kaart toegevoegd', 'Reservebetaalmethode toegevoegd'],
      cardUpdated: ['Betaalmethode bijgewerkt'],
      errorOccurred: ['Er is een fout opgetreden', 'Fout']
    },

    popupScenarios: {
      directAdd: {
        title: ['Reservebetaalmethode toevoegen', 'Reservebetaling'],
        subtitle: ['Voeg een reservebetaalmethode toe voor je abonnement']
      },

      changeAndAdd: {
        updateFirst: ['Werk eerst de betaalmethode bij', 'Betaling bijwerken'],
        thenAddBackup: ['Voeg dan reservebetaalmethode toe', 'Reserve toevoegen']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 터키어 (Turkish)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  tr: {
    code: 'tr',
    name: 'Türkçe',
    paymentMethod: {
      managePayment: ['Ödemeyi yönet', 'Ödeme yöntemleri', 'Ödeme yöntemlerini yönet'],
      addBackup: ['Yedek ödeme yöntemi ekle', 'Yedek ekle', 'Yedek ödeme yöntemi'],
      updatePayment: ['Ödeme yöntemini güncelle', 'Ödeme yöntemini değiştir'],

      cardNumber: ['Kart numarası'],
      expiryDate: ['Son kullanma tarihi', 'AA/YY'],
      securityCode: ['Güvenlik kodu', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Güvenlik kodu'],
      cardholderName: ['Kart sahibinin adı', 'Kart sahibi'],

      country: ['Ülke', 'Ülke/Bölge'],
      streetAddress: ['Adres', 'Sokak', 'Adres satırı 1'],
      city: ['Şehir'],
      postalCode: ['Posta kodu'],
      state: ['İl', 'Eyalet'],

      saveCard: ['Kaydet', 'Kartı kaydet', 'Kart ekle', 'Devam'],
      cancel: ['İptal'],
      confirm: ['Onayla', 'Tamam'],

      cardAdded: ['Kart eklendi', 'Yedek ödeme yöntemi eklendi'],
      cardUpdated: ['Ödeme yöntemi güncellendi'],
      errorOccurred: ['Bir hata oluştu', 'Hata']
    },

    popupScenarios: {
      directAdd: {
        title: ['Yedek ödeme yöntemi ekle', 'Yedek ödeme'],
        subtitle: ['Aboneliğiniz için yedek ödeme yöntemi ekleyin']
      },

      changeAndAdd: {
        updateFirst: ['Önce ödeme yöntemini güncelle', 'Ödemeyi güncelle'],
        thenAddBackup: ['Sonra yedek ödeme yöntemi ekle', 'Yedek ekle']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 베트남어 (Vietnamese)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  vi: {
    code: 'vi',
    name: 'Tiếng Việt',
    paymentMethod: {
      managePayment: ['Quản lý thanh toán', 'Phương thức thanh toán', 'Quản lý phương thức thanh toán'],
      addBackup: ['Thêm phương thức thanh toán dự phòng', 'Thêm dự phòng', 'Phương thức thanh toán dự phòng'],
      updatePayment: ['Cập nhật phương thức thanh toán', 'Thay đổi phương thức thanh toán'],

      cardNumber: ['Số thẻ'],
      expiryDate: ['Ngày hết hạn', 'Hết hạn', 'MM/YY'],
      securityCode: ['Mã bảo mật', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'Mã bảo mật'],
      cardholderName: ['Tên chủ thẻ', 'Chủ thẻ'],

      country: ['Quốc gia', 'Quốc gia/Khu vực'],
      streetAddress: ['Địa chỉ', 'Đường', 'Dòng địa chỉ 1'],
      city: ['Thành phố'],
      postalCode: ['Mã bưu điện'],
      state: ['Tỉnh', 'Bang'],

      saveCard: ['Lưu', 'Lưu thẻ', 'Thêm thẻ', 'Tiếp tục'],
      cancel: ['Hủy'],
      confirm: ['Xác nhận', 'OK'],

      cardAdded: ['Đã thêm thẻ', 'Đã thêm phương thức thanh toán dự phòng'],
      cardUpdated: ['Đã cập nhật phương thức thanh toán'],
      errorOccurred: ['Đã xảy ra lỗi', 'Lỗi']
    },

    popupScenarios: {
      directAdd: {
        title: ['Thêm phương thức thanh toán dự phòng', 'Thanh toán dự phòng'],
        subtitle: ['Thêm phương thức thanh toán dự phòng cho gói đăng ký của bạn']
      },

      changeAndAdd: {
        updateFirst: ['Cập nhật phương thức thanh toán trước', 'Cập nhật thanh toán'],
        thenAddBackup: ['Sau đó thêm phương thức thanh toán dự phòng', 'Thêm dự phòng']
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 아랍어 (Arabic)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ar: {
    code: 'ar',
    name: 'العربية',
    paymentMethod: {
      managePayment: ['إدارة الدفع', 'طرق الدفع', 'إدارة طرق الدفع'],
      addBackup: ['إضافة طريقة دفع احتياطية', 'إضافة احتياطي', 'طريقة دفع احتياطية'],
      updatePayment: ['تحديث طريقة الدفع', 'تغيير طريقة الدفع'],

      cardNumber: ['رقم البطاقة'],
      expiryDate: ['تاريخ الانتهاء', 'الانتهاء', 'MM/YY'],
      securityCode: ['رمز الأمان', 'CVV', 'CVC'],
      cvv: ['CVV', 'CVC', 'رمز الأمان'],
      cardholderName: ['اسم حامل البطاقة', 'حامل البطاقة'],

      country: ['البلد', 'البلد/المنطقة'],
      streetAddress: ['العنوان', 'الشارع', 'سطر العنوان 1'],
      city: ['المدينة'],
      postalCode: ['الرمز البريدي'],
      state: ['الولاية', 'المحافظة'],

      saveCard: ['حفظ', 'حفظ البطاقة', 'إضافة بطاقة', 'متابعة'],
      cancel: ['إلغاء'],
      confirm: ['تأكيد', 'موافق'],

      cardAdded: ['تمت إضافة البطاقة', 'تمت إضافة طريقة الدفع الاحتياطية'],
      cardUpdated: ['تم تحديث طريقة الدفع'],
      errorOccurred: ['حدث خطأ', 'خطأ']
    },

    popupScenarios: {
      directAdd: {
        title: ['إضافة طريقة دفع احتياطية', 'الدفع الاحتياطي'],
        subtitle: ['أضف طريقة دفع احتياطية لاشتراكك']
      },

      changeAndAdd: {
        updateFirst: ['تحديث طريقة الدفع أولاً', 'تحديث الدفع'],
        thenAddBackup: ['ثم إضافة طريقة دفع احتياطية', 'إضافة احتياطي']
      }
    }
  }
};

module.exports = backupCardLanguages;
