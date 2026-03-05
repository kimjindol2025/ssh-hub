# NexusSSH Pro API 분석

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #11

---

## NexusSSH Pro 구조

```
api_hub/
├── index.js              # 통합 진입점
├── nexus-ssh.js          # 기본 SSH 연결
├── nexus-sftp.js         # SFTP 기본
├── nexus-sftp-advanced.js # SFTP 고급
├── nexus-monitor.js      # 모니터링 ★
├── nexus-tunnel.js       # 터널링
├── nexus-security.js     # 보안
├── nexus-shell.js        # 대화형 셸
└── nse-engine.js         # 스트레스 엔진
```

---

## API 목록 (61개)

### 1. 연결/인증 (10개)
```javascript
connect()           // SSH 연결
close()             // 연결 종료
isConnected()       // 연결 상태
ping()              // 핑 테스트
connectWithAgent()  // SSH Agent 사용
getPooled()         // 커넥션 풀에서 획득
releasePool()       // 커넥션 풀에 반환
verifyHostKey()     // 호스트 키 검증
getFingerprint()    // 서버 핑거프린트
getConnectionInfo() // 연결 정보
```

### 2. 명령 실행 (10개)
```javascript
run(cmd)            // 명령 실행
sudo(cmd)           // sudo 명령
runBackground(cmd)  // 백그라운드 실행
runSequence(cmds)   // 순차 실행
runParallel(cmds)   // 병렬 실행
isProcessRunning(name) // 프로세스 확인
killProcess(pid)    // 프로세스 종료
getExitCode()       // 종료 코드
interactiveShell()  // 대화형 셸
expect(patterns)    // 패턴 매칭
```

### 3. SFTP (15개) ★ 파일 관리
```javascript
upload(local, remote)     // 파일 업로드
download(remote, local)   // 파일 다운로드
uploadDir(local, remote)  // 디렉토리 업로드
downloadDir(remote, local)// 디렉토리 다운로드
fastUpload(local, remote) // 병렬 업로드
stat(path)                // 파일 정보
exists(path)              // 존재 확인
size(path)                // 파일 크기
md5(path)                 // MD5 해시
sha256(path)              // SHA256 해시
verifyIntegrity(l, r)     // 무결성 검사
ls(path)                  // 목록 조회
walk(path)                // 재귀 탐색 ★
mkdir(path)               // 디렉토리 생성
rm(path)                  // 삭제
chmod(path, mode)         // 권한 변경
chown(path, uid, gid)     // 소유자 변경
symlink(target, link)     // 심볼릭 링크
readlink(link)            // 링크 읽기
readFile(path)            // 파일 읽기
writeFile(path, content)  // 파일 쓰기
createReadStream(path)    // 스트림 읽기
createWriteStream(path)   // 스트림 쓰기
```

### 4. 터널링 (5개)
```javascript
localForward(lPort, rHost, rPort)  // 로컬 포워딩
remoteForward(rPort, lHost, lPort) // 원격 포워딩
dynamicForward(port)               // 동적 포워딩 (SOCKS)
waitForPort(host, port)            // 포트 대기
isPortOpen(host, port)             // 포트 확인
```

### 5. 모니터링 (13개) ★ 핵심
```javascript
getCpuUsage()              // CPU 사용률
getMemUsage()              // 메모리 사용량
getDiskUsage(mount)        // 디스크 사용량 ★
getLoadAverage()           // 시스템 부하
getUptime()                // 가동 시간
getServiceStatus(name)     // 서비스 상태
restartService(name)       // 서비스 재시작
getPM2List()               // PM2 프로세스
restartPM2(name)           // PM2 재시작
tailLog(path, lines)       // 로그 tail ★
searchLog(path, pattern)   // 로그 검색 ★
getSystemStatus()          // 종합 상태
healthCheck(thresholds)    // 헬스체크
```

---

## SSH Hub에서 활용할 API

### 디스크 모니터링
```javascript
// getDiskUsage 활용
const disk = await ssh.getDiskUsage('/');
const home = await ssh.getDiskUsage('/home');
const data = await ssh.getDiskUsage('/data');
```

### 파일 변경 추적
```javascript
// walk + 시간 필터
const newFiles = await ssh.walk('/home/ai', {
    filter: (f) => f.mtime > lastCheck
});
```

### 대용량 파일 탐지
```javascript
// walk + 크기 필터
const bigFiles = await ssh.walk('/', {
    filter: (f) => f.size > 100 * 1024 * 1024
});
```

### 로그 분석
```javascript
// searchLog 활용
const errors = await ssh.searchLog('/var/log/syslog', 'error', { ignoreCase: true });
const auth = await ssh.searchLog('/var/log/auth.log', 'Failed');
```

---

## 사용 예시

### 기본 연결
```javascript
const { NexusSSH } = require('../api_hub');

const ssh = new NexusSSH('253-local');
await ssh.connect();

const status = await ssh.getSystemStatus();
console.log(status);
// { cpu: 10%, memory: 68%, disk: 45%, healthy: true }

ssh.close();
```

### 클러스터 관리
```javascript
const { clusterRun } = require('../api_hub');

// 3서버 동시 명령
const results = await clusterRun(
    ['73-local', '232-local', '253-local'],
    'df -h /'
);
```

---

## 다음 구현 목표

```
SSH Hub 스토리지 대시보드:
├── 1. getDiskUsage() → 3서버 디스크 현황
├── 2. walk() → 파일 변경 추적
├── 3. searchLog() → 오류/보안 로그
├── 4. tailLog() → 실시간 로그
└── 5. healthCheck() → 종합 알림
```

---

**4번 Claude 작품 - 3번 Claude 학습 완료!**
