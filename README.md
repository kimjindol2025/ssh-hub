# SSH Hub

**중앙 SSH 관리 시스템** | https://ssh.dclub.kr

## 개요

SSH Hub는 dclub.kr 인프라의 SSH 접속을 중앙에서 관리하는 시스템입니다.

- 다중 서버 SSH 프록시
- 실시간 접속 모니터링
- 웹 푸시 알림 (외부 접속 감지)
- 텍스트 기반 접속 로그

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      SSH Hub (73 서버)                       │
│                     https://ssh.dclub.kr                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Web Dashboard│  │  WebSocket   │  │  Push API    │       │
│  │   :50200     │  │  실시간 로그  │  │  알림 전송    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   SSH 프록시 (socat)                 │    │
│  ├─────────────┬─────────────┬─────────────────────────┤    │
│  │ :10073      │ :10032      │ :10053                  │    │
│  │ → 73:22     │ → 232:2222  │ → 253:22                │    │
│  └─────────────┴─────────────┴─────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Server-73│   │Server-232│   │Server-253│
        │  (Main)  │   │          │   │(kimjin-X99)│
        └──────────┘   └──────────┘   └──────────┘
```

## 외부 접속

| 서버 | 접속 명령어 | 포트 |
|------|-------------|------|
| Server-73 | `ssh -p 10073 kimjin@ssh.dclub.kr` | 10073 |
| Server-232 | `ssh -p 10032 kimjin@ssh.dclub.kr` | 10032 |
| Server-253 | `ssh -p 10053 kimjin@ssh.dclub.kr` | 10053 |

### 간편 접속 (SSH Config)

```bash
# ~/.ssh/config
Host ssh.dclub.kr
    HostName ssh.dclub.kr
    User kimjin
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no

# 사용법
ssh -p 10073 ssh.dclub.kr  # Server-73
ssh -p 10053 ssh.dclub.kr  # Server-253
```

## API 엔드포인트

### 프록시 관리

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/proxy/status` | 프록시 상태 조회 |
| POST | `/api/proxy/:name/start` | 프록시 시작 |
| POST | `/api/proxy/:name/stop` | 프록시 중지 |

### 접속 로그

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/logs` | 접속 로그 조회 |
| GET | `/api/stats` | 접속 통계 |
| POST | `/api/log/access` | 접속 로그 기록 |
| GET | `/api/log/access.txt` | 텍스트 로그 파일 |

### 푸시 알림

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/push/vapid-public-key` | VAPID 공개키 |
| POST | `/api/push/subscribe` | 푸시 구독 등록 |
| POST | `/api/push/unsubscribe` | 푸시 구독 해제 |
| POST | `/api/push/test` | 테스트 푸시 전송 |

### SSH 키 관리

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/keys` | SSH 키 목록 |
| POST | `/api/keys/generate` | 새 키 생성 |
| POST | `/api/keys/:name/deploy` | 키 배포 |

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 모드
node server.js

# PM2로 실행
pm2 start server.js --name ssh-hub
```

## 환경 설정

### 프록시 설정 (server.js)

```javascript
const PROXIES = [
    { name: 'server-73', port: 10073, target: '192.168.45.73:22',
      domain: '73.ssh.dclub.kr', user: 'kim' },
    // ...
];
```

### VAPID 키 (data/vapid-keys.json)

푸시 알림용 VAPID 키. 최초 실행 시 자동 생성.

```bash
npx web-push generate-vapid-keys --json > data/vapid-keys.json
```

## 파일 구조

```
ssh-hub/
├── server.js              # 메인 서버
├── package.json
├── public/
│   ├── index.html         # 대시보드 UI
│   └── sw.js              # Service Worker (푸시)
├── data/
│   ├── vapid-keys.json    # VAPID 키
│   ├── ssh-access.log     # 접속 로그
│   └── push-subscriptions.json  # 푸시 구독 목록
└── kimnexus-log.js        # KimNexus v9 로그 모듈
```

## 보안

### 접속 시 배너 (MOTD)

```
###########################################################
#            WARNING: MILLION AI CITY GATEWAY             #
#    Authorized Access Only. Monitored by KimNexus v9.    #
#  Unauthorized entry will be met with Digital Police.    #
###########################################################
```

### 외부 접속 알림

외부 IP에서 SSH 접속 시 웹 푸시 알림 자동 전송.

## 관련 시스템

- **KimNexus v9**: 중앙 로그 시스템
- **DNS Manager**: https://dns.dclub.kr
- **Security Dashboard**: https://security.dclub.kr
- **Sentinel**: 보안 모니터링

## 버전 이력

| 버전 | 날짜 | 변경사항 |
|------|------|----------|
| 2.2.0 | 2025-12-27 | NSE (Nexus Stress Engine) 통합 - 800만 유저 스케일 테스트 |
| 2.1.0 | 2025-12-27 | Server-73 사용자 kimjin으로 변경, NexusSSH Pro 연동 |
| 2.0.0 | 2025-12-26 | Enterprise 업그레이드: SSO, SSH CA, 세션 녹화, JIT 승인 |
| 1.1.0 | 2025-12-26 | 웹 푸시 알림 시스템 추가 |
| 1.0.0 | 2025-12-26 | 초기 버전, 서브도메인 지원 |

## 연동 시스템

### NexusSSH Pro (api_hub)

SSH Hub와 연동하는 61개 API 함수 제공:

```javascript
const { NexusSSH, SERVER_PRESETS } = require("nexus-ssh");

// Server-253 연결
const ssh = new NexusSSH();
await ssh.connect(SERVER_PRESETS["253"]);

// 명령 실행
const result = await ssh.run("uname -a");

// 상태 점검
const health = await ssh.healthCheck();
```

- **저장소**: https://gogs.ai-empire.kr/kim/api_hub
- **API**: https://nexus.dclub.kr

### NSE: Nexus Stress Engine

800만 유저 스케일 인프라 검증을 위한 스트레스 테스트 엔진:

```
┌─────────────────────────────────────────────────────┐
│              NSE (Nexus Stress Engine)              │
├─────────────────────────────────────────────────────┤
│  [NSE-P] Population    │  800만 유저 배치/인격 제어  │
│  [NSE-I] Injector      │  극한 부하 주입 (Chaos)     │
│  [NSE-V] Validator     │  OS 심부 메트릭/임계점 분석 │
└─────────────────────────────────────────────────────┘
```

**API 엔드포인트 (12개):**
- `POST /nse/p/spawn` - 대량 유저 생성 (비대칭 샤드 배치)
- `POST /nse/i/spike` - 순간 폭주 (100만 Write/sec)
- `POST /nse/i/vacuum` - 프로세스 Kill (HA 복구력 검증)
- `GET /nse/v/deep-scan` - CPU/MEM/TCP/Disk I/O 심부 분석
- `GET /nse/v/report` - 임계점 지도 (Point of Failure) 생성

**수집 메트릭:**
- Context Switch, I/O Wait, TCP Wait Queue
- PostgreSQL Lock Queue, Slow Queries
- File Descriptors, Load Average

- **포트**: 50301
- **용도**: 상용 서비스 투입 전 인프라 한계 검증

---

**dclub.kr Infrastructure** | Monitored by KimNexus v9
