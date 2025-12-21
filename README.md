# 🚀 AdsPower YouTube Automation - Standalone Version

독립적으로 작동하는 YouTube Premium 자동화 시스템입니다. 이 폴더를 그대로 다른 컴퓨터로 복사하여 사용할 수 있습니다.

## 📋 목차
1. [시스템 요구사항](#-시스템-요구사항)
2. [빠른 시작](#-빠른-시작)
3. [설치 가이드](#-설치-가이드)
4. [환경 설정](#-환경-설정)
5. [사용 방법](#-사용-방법)
6. [문제 해결](#-문제-해결)
7. [이전 가이드](#-이전-가이드)

---

## 🖥️ 시스템 요구사항

### 필수 소프트웨어
- **Node.js**: v16.0.0 이상 (권장: v18.x LTS)
- **AdsPower**: 최신 버전 설치 및 실행 중
- **Google Chrome**: AdsPower에서 사용할 브라우저

### 운영체제
- Windows 10/11 (64비트)
- macOS 10.15 이상
- Ubuntu 20.04 LTS 이상

### 하드웨어
- RAM: 최소 8GB (권장 16GB)
- 저장공간: 최소 2GB 여유 공간
- 인터넷: 안정적인 연결 필요

---

## ⚡ 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 초기 설정 실행
npm run setup

# 3. 프로그램 시작
npm start
```

---

## 📦 설치 가이드

### 1단계: 폴더 복사
이 `independent` 폴더를 원하는 위치에 복사합니다.

```bash
# 예시: C:\automation 폴더로 복사
xcopy /E /I "independent" "C:\automation\youtube-automation"
cd C:\automation\youtube-automation
```

### 2단계: Node.js 패키지 설치
```bash
npm install
```

### 3단계: 초기 설정
```bash
npm run setup
```
설정 마법사가 실행되어 필요한 정보를 입력받습니다.

### 4단계: Google Service Account 설정

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. Google Sheets API 활성화
4. Service Account 생성 및 키 다운로드
5. 다운로드한 JSON 파일을 `credentials/service-account.json`으로 저장

```bash
# credentials 폴더가 없으면 생성
mkdir credentials
# service-account.json 파일을 해당 폴더에 복사
```

### 5단계: Google Sheets 권한 설정

1. Google Sheets 문서 열기
2. Service Account 이메일로 공유 (편집 권한)
3. Sheets ID 복사 (URL의 /d/ 다음 부분)

---

## ⚙️ 환경 설정

### .env 파일 구성

`.env.example` 파일을 `.env`로 복사하고 수정:

```bash
cp .env.example .env
```

### 필수 설정 항목

```env
# AdsPower API
ADSPOWER_API_URL=http://local.adspower.net:50325

# Google Sheets
GOOGLE_SHEETS_ID=your_sheets_id_here
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json

# 기본 설정
DEFAULT_LANGUAGE=ko
DEBUG_MODE=false
BATCH_SIZE=5

# 로그인 모드 (신규)
LOGIN_MODE=minimal  # minimal(권장) 또는 legacy
```

### 선택적 설정

```env
# 성능 튜닝
DEFAULT_WAIT_TIME=3000
NAVIGATION_TIMEOUT=30000
MAX_RETRIES=3

# 로깅
LOG_LEVEL=info
SAVE_SCREENSHOTS=true

# 알림 (선택사항)
SLACK_WEBHOOK_URL=
DISCORD_WEBHOOK_URL=
```

---

## 🎮 사용 방법

### 대화형 모드 (권장)
```bash
npm start
```
메뉴에서 원하는 작업을 선택합니다.

#### 🎆 신규 기능: 로그인 모드 설정

CLI 실행 중 로그인 모드를 변경할 수 있습니다:

1. 메인 메뉴에서 **"🔧 설정"** 선택
2. **"🔑 로그인 모드 변경"** 선택
3. 원하는 모드 선택:
   - **🚀 Minimal 모드 (권장)**: CDP 네이티브 클릭, Google 감지 회피
   - **🔧 Legacy 모드**: 기존 방식
4. .env 파일 자동 저장 옵션

```bash
# 환경변수로 직접 설정도 가능
set LOGIN_MODE=minimal
npm start

# 또는 Legacy 모드
set LOGIN_MODE=legacy
npm start
```

### 명령줄 모드

#### 일시정지 워크플로우
```bash
npm run pause
# 또는
node index.js --mode pause
```

#### 재개 워크플로우
```bash
npm run resume
# 또는
node index.js --mode resume
```

#### 상태 확인
```bash
npm run check
# 또는
node index.js --mode check
```

### 개발 모드
```bash
npm run dev
```
파일 변경 시 자동으로 재시작됩니다.

---

## 🔧 문제 해결

### 1. AdsPower 연결 실패

**증상**: "AdsPower 연결 실패" 오류

**💡 자동 포트 감지 기능**:
- v2.0부터 포트 자동 감지를 지원합니다
- 연결 실패 시 50325, 50326, 50327 포트를 자동으로 순차 시도
- 작동하는 포트를 찾으면 자동으로 연결하고 콘솔에 안내 메시지 표시

**수동 해결책**:
1. AdsPower가 실행 중인지 확인
```bash
# AdsPower 상태 확인 (Windows)
tasklist | findstr "AdsPower"

# macOS/Linux
ps aux | grep AdsPower
```

2. 포트 확인 및 변경
```bash
# Windows - 50xxx 범위 포트 스캔
netstat -an | findstr "LISTENING" | findstr ":50"

# macOS/Linux - 50xxx 범위 포트 스캔
netstat -an | grep LISTEN | grep ":50"

# 발견된 포트로 API 테스트 (예: 50326)
curl -X GET "http://127.0.0.1:50326/api/v1/user/list?page_size=1"
```

3. `.env` 파일 업데이트 (선택사항, 더 빠른 시작을 위해)
```env
# AdsPower 업데이트 후 포트가 변경될 수 있습니다
# 일반적으로 50325, 50326, 50327 중 하나 사용
ADSPOWER_API_URL=http://127.0.0.1:50326
```

4. 방화벽 설정 확인
- AdsPower API 포트(50325-50327)가 차단되지 않았는지 확인

### 2. Google Sheets 권한 오류

**증상**: "권한이 없습니다" 오류

**해결책**:
1. Service Account 이메일이 Sheets에 공유되었는지 확인
2. 편집 권한이 부여되었는지 확인
3. Sheets ID가 올바른지 확인

### 3. 의존성 설치 실패

**증상**: npm install 오류

**해결책**:
```bash
# 캐시 정리
npm cache clean --force

# node_modules 삭제 후 재설치
rm -rf node_modules package-lock.json
npm install
```

### 4. 한글/특수문자 경로 문제

**증상**: 파일을 찾을 수 없음 오류

**해결책**:
영문 경로로 프로젝트 이동
```bash
# 권장 경로 예시
C:\automation\youtube
D:\projects\adspower
```

---

## 📦 이전 가이드

### 다른 컴퓨터로 이전하기

#### 1. 현재 설정 백업
```bash
# 백업 스크립트 실행
node backup.js
```

#### 2. 필수 파일 목록
```
independent/
├── src/                    # 소스 코드 (필수)
├── credentials/            # Google 인증 파일 (필수)
│   └── service-account.json
├── .env                    # 환경 설정 (필수)
├── package.json           # 프로젝트 설정 (필수)
├── package-lock.json      # 의존성 잠금 (권장)
├── logs/                  # 로그 파일 (선택)
└── screenshots/           # 스크린샷 (선택)
```

#### 3. 새 컴퓨터에서 설정

1. 전체 폴더 복사
2. Node.js 설치
3. AdsPower 설치 및 실행
4. 터미널에서 실행:
```bash
cd [복사한 폴더 경로]
npm install
npm test  # 연결 테스트
npm start # 실행
```

---

## 📊 프로젝트 구조

```
independent/
├── index.js               # 메인 진입점
├── setup.js              # 설정 마법사
├── package.json          # 프로젝트 메타데이터
├── .env.example          # 환경 변수 템플릿
├── .env                  # 실제 환경 변수 (Git 제외)
│
├── src/                  # 소스 코드
│   ├── application/      # 비즈니스 로직
│   ├── domain/          # 도메인 모델
│   ├── infrastructure/  # 외부 서비스 연동
│   ├── presentation/    # CLI 인터페이스
│   └── workflows/       # 워크플로우 구현
│
├── credentials/         # 인증 파일
│   └── service-account.json
│
├── logs/               # 로그 디렉터리
│   ├── daily/         # 일별 로그
│   ├── errors/        # 오류 로그
│   ├── sessions/      # 세션 로그
│   └── workflows/     # 워크플로우 로그
│
├── screenshots/        # 스크린샷 저장
└── backup/            # 백업 파일
```

---

## 🛡️ 보안 주의사항

1. **절대 공개하지 마세요**:
   - `.env` 파일
   - `credentials/` 폴더
   - API 키 및 토큰

2. **권장 사항**:
   - 정기적으로 Service Account 키 교체
   - 로그 파일 주기적 정리
   - 민감한 데이터 암호화

3. **Git 사용 시**:
   - `.gitignore`에 민감한 파일 추가
   - 환경 변수는 `.env.example`만 커밋

---

## 📞 지원

문제가 발생하거나 도움이 필요한 경우:

1. 로그 파일 확인: `logs/errors/` 
2. 디버그 모드 활성화: `DEBUG_MODE=true`
3. 스크린샷 확인: `screenshots/`

---

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능

---

**버전**: 2.0.0  
**최종 업데이트**: 2025.08.13  
**작성자**: SuperClaude