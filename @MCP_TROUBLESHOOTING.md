# MCP 서버 트러블슈팅 가이드

## 진단 결과 (2025-12-24)

### 발견된 문제
1. **모든 MCP 서버 연결 실패** - 설정 변경 후 세션 재시작 필요
2. **과다한 Node.js 프로세스** - 28개 좀비 프로세스 발견 (정리 완료)
3. **설정 파일 형식 문제** - `%PATH%` 환경변수 확장 실패

### 적용된 수정사항

#### settings.json 수정 (`C:\Users\PC\.claude\settings.json`)
```json
{
  "mcpServers": {
    "sequential": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

주요 변경:
- `cmd /c npx -y` 형식으로 통일 (Windows 안정성 향상)
- `-y` 플래그 추가 (패키지 자동 설치)
- `%PATH%` 환경변수 제거 (문제 유발)
- 현재 프로젝트 폴더(SF)를 filesystem에 추가

---

## 해결 방법

### 1. Claude Code 재시작 (필수)
MCP 설정 변경은 **세션 재시작 후 적용**됩니다.

```bash
# Claude Code 종료 후 재시작
# 터미널에서 Ctrl+C로 종료 후 다시 실행
claude
```

### 2. 좀비 Node 프로세스 정리
```bash
# Windows
taskkill /f /im node.exe

# 정리 후 확인
tasklist | findstr "node"
```

### 3. npm 캐시 정리 (선택)
```bash
npm cache clean --force
```

### 4. MCP 패키지 사전 설치 (속도 향상)
```bash
npx -y @modelcontextprotocol/server-sequential-thinking --help
npx -y @upstash/context7-mcp --help
npx -y @modelcontextprotocol/server-filesystem --help
```

---

## MCP 서버 상태 확인 명령어
```bash
claude mcp list
```

---

## 일반적인 MCP 문제 및 해결책

| 증상 | 원인 | 해결책 |
|------|------|--------|
| Failed to connect | 패키지 미설치 또는 타임아웃 | `-y` 플래그 확인, 패키지 사전 캐싱 |
| 설정 변경 미반영 | 세션 캐시 | Claude Code 재시작 |
| ENOENT 오류 | 경로 문제 | 경로에 공백/한글 확인, 따옴표 사용 |
| 환경변수 미확장 | `%PATH%` 형식 문제 | env 섹션에서 제거 또는 실제 값 사용 |

---

## 현재 활성 MCP 서버 (settings.json)

| 서버 | 패키지 | 용도 |
|------|--------|------|
| sequential | @modelcontextprotocol/server-sequential-thinking | 순차적 사고 |
| context7 | @upstash/context7-mcp | 컨텍스트 관리 |
| filesystem | @modelcontextprotocol/server-filesystem | 파일 시스템 접근 |
| playwright | @playwright/mcp | 브라우저 자동화 |
| magic | @21st-dev/magic | UI 컴포넌트 생성 |
| github | @modelcontextprotocol/server-github | GitHub 연동 |
| ccusage | ccusage | Claude 사용량 추적 |

---

## 설정 파일 위치
- 전역 설정: `C:\Users\PC\.claude\settings.json`
- 프로젝트 설정: `.claude\settings.local.json`
