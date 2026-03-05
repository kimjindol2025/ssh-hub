# PM2 Cluster Mode 내부 구조 분석

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #09

---

## PM2 Cluster Mode란?

```
Node.js 앱을 모든 CPU 코어에 분산 실행
코드 수정 없이 수평 확장 가능
내장 로드 밸런서 제공
```

---

## 내부 아키텍처

### Node.js Cluster Module 기반
```
┌─────────────────────────────────────────┐
│              PM2 God Daemon             │
├─────────────────────────────────────────┤
│         Node.js Cluster Module          │
├──────────┬──────────┬───────────────────┤
│ Worker 0 │ Worker 1 │    Worker N       │
│ (CPU 0)  │ (CPU 1)  │    (CPU N)        │
└──────────┴──────────┴───────────────────┘
         ↑      ↑           ↑
         └──────┴───────────┘
              공유 포트
```

### 로드 밸런싱
```
기본: Round-Robin (순차 분배)

요청1 → Worker 0
요청2 → Worker 1
요청3 → Worker 2
요청4 → Worker 0 (순환)
```

---

## 사용법

### 기본 명령어
```bash
# 모든 CPU 사용
pm2 start app.js -i max

# 특정 개수
pm2 start app.js -i 4

# ecosystem 파일
pm2 start ecosystem.config.js
```

### ecosystem.config.js
```javascript
module.exports = {
    apps: [{
        name: 'ssh-hub',
        script: 'server.js',
        instances: 'max',        // 또는 숫자
        exec_mode: 'cluster',    // 필수!
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'production',
            PORT: 50200
        }
    }]
};
```

---

## Zero-Downtime Reload

### Graceful Reload
```bash
pm2 reload ssh-hub
```

### 내부 동작
```
1. 새 Worker 시작
2. 새 Worker 준비 완료 대기
3. 이전 Worker에 SIGINT 전송
4. 이전 Worker 종료 (graceful)
5. 다음 Worker 반복

결과: 서비스 중단 없음!
```

### Graceful Shutdown 코드
```javascript
process.on('SIGINT', () => {
    console.log('Graceful shutdown...');

    // 새 연결 거부
    server.close(() => {
        // 기존 연결 완료 대기
        console.log('Closed all connections');
        process.exit(0);
    });

    // 타임아웃 (강제 종료)
    setTimeout(() => {
        process.exit(1);
    }, 10000);
});
```

---

## 상태 비저장 필수

### 문제
```javascript
// ❌ 클러스터 모드에서 문제
const sessions = new Map();  // 워커별로 다름!

app.get('/session', (req, res) => {
    // Worker 0에서 저장한 세션
    // Worker 1에서 조회 불가!
});
```

### 해결
```javascript
// ✅ Redis로 상태 공유
const Redis = require('ioredis');
const redis = new Redis();

app.get('/session', async (req, res) => {
    const session = await redis.get(req.sessionId);
    // 모든 Worker에서 동일한 세션 접근
});
```

---

## SSH Hub에 적용

### 현재 상태
```bash
$ pm2 status
┌─────────┬────────┬───────────┬──────────┐
│ name    │ mode   │ instances │ status   │
├─────────┼────────┼───────────┼──────────┤
│ ssh-hub │ fork   │ 1         │ online   │
└─────────┴────────┴───────────┴──────────┘
```

### Cluster Mode 적용
```bash
pm2 delete ssh-hub
pm2 start server.js --name ssh-hub -i max
```

### 예상 결과
```bash
$ pm2 status
┌─────────┬─────────┬───────────┬──────────┐
│ name    │ mode    │ instances │ status   │
├─────────┼─────────┼───────────┼──────────┤
│ ssh-hub │ cluster │ 8         │ online   │
└─────────┴─────────┴───────────┴──────────┘
```

### 주의사항
```
SSH Hub WebSocket 연결:
- 세션 상태 Redis로 이동 필요
- WebSocket sticky session 또는
- Redis Pub/Sub로 메시지 브로드캐스트
```

---

## 모니터링

### PM2 모니터
```bash
pm2 monit
```

### 로그
```bash
pm2 logs ssh-hub --lines 100
```

### 메트릭
```bash
pm2 show ssh-hub
```

---

## 고급 설정

### CPU/Memory 제한
```javascript
{
    instances: 4,
    max_memory_restart: '500M',
    node_args: '--max-old-space-size=512'
}
```

### 환경별 설정
```javascript
{
    env_production: {
        NODE_ENV: 'production',
        PORT: 80
    },
    env_development: {
        NODE_ENV: 'development',
        PORT: 3000
    }
}
```

---

## 참고 자료

- [PM2 Cluster Mode](https://pm2.keymetrics.io/docs/usage/cluster-mode/)
- [PM2 Load Balancing](https://pm2.io/docs/runtime/guide/load-balancing/)
- [Node.js Cluster Module](https://nodejs.org/api/cluster.html)
- [PM2 GitHub](https://github.com/Unitech/pm2)

---

## 다음 학습

- [ ] PM2 + Socket.io sticky session
- [ ] PM2 Plus 모니터링
- [ ] Kubernetes vs PM2
