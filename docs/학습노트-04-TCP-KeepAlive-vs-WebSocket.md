# TCP Keep-Alive vs WebSocket 비교

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #04

---

## 실시간 통신 기술 비교

| 기술 | 방향 | 오버헤드 | 지연시간 | 확장성 |
|------|------|---------|---------|--------|
| **WebSocket** | 양방향 | 2 bytes/frame | 매우 낮음 | 높음 |
| **SSE** | 서버→클라 | 5 bytes/msg | 낮음 | 중간 |
| **Long Polling** | 양방향 | 수백 bytes | 높음 | 낮음 |
| **Short Polling** | 양방향 | 매우 높음 | 매우 높음 | 매우 낮음 |

---

## TCP Keep-Alive

### 특징
```
- 기본 비활성화 (대부분 OS)
- 기본 간격: 2시간+ (실시간 부적합)
- OS 레벨 연결 상태 체크
- 프레임 최소화
```

### 설정 (Linux)
```bash
# /etc/sysctl.conf
net.ipv4.tcp_keepalive_time = 60      # 첫 검사까지 (초)
net.ipv4.tcp_keepalive_intvl = 10     # 검사 간격 (초)
net.ipv4.tcp_keepalive_probes = 6     # 실패 허용 횟수

# 적용
sysctl -p
```

### Node.js 설정
```javascript
const net = require('net');

const socket = net.connect(port, host);
socket.setKeepAlive(true, 60000);  // 60초 간격
```

---

## WebSocket

### 특징
```
- HTTP로 시작 → 업그레이드 → TCP 유지
- 양방향 (Full-Duplex)
- 프레임 오버헤드: 2-14 bytes
- 내장 Ping/Pong 메커니즘
```

### Handshake
```
클라이언트 → 서버:
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

서버 → 클라이언트:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

### Keep-Alive (Ping/Pong)
```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// 30초마다 Ping
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
```

---

## SSE (Server-Sent Events)

### 특징
```
- 서버 → 클라이언트 단방향
- HTTP 기반 (방화벽 친화적)
- 자동 재연결
- 간단한 구현
```

### 서버 (Node.js)
```javascript
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 이벤트 전송
    const interval = setInterval(() => {
        sendEvent({ time: Date.now() });
    }, 1000);

    req.on('close', () => clearInterval(interval));
});
```

### 클라이언트
```javascript
const eventSource = new EventSource('/events');

eventSource.onmessage = (event) => {
    console.log(JSON.parse(event.data));
};

eventSource.onerror = () => {
    // 자동 재연결됨
};
```

---

## Long Polling

### 특징
```
- 요청 → 대기 → 응답 → 반복
- HTTP 호환성 최고
- 서버 부하 높음
- 레거시 지원용
```

### 구현
```javascript
// 클라이언트
async function longPoll() {
    try {
        const response = await fetch('/poll');
        const data = await response.json();
        handleData(data);
    } finally {
        longPoll();  // 재연결
    }
}

// 서버
app.get('/poll', async (req, res) => {
    // 이벤트 발생까지 대기 (최대 30초)
    const data = await waitForEvent(30000);
    res.json(data);
});
```

---

## 프록시/방화벽 고려사항

```
┌────────────────────────────────────────────────┐
│ 문제: 유휴 연결 30-120초 후 종료               │
├────────────────────────────────────────────────┤
│ WebSocket: Ping/Pong으로 해결 (20초 권장)      │
│ SSE: 주기적 주석 ": keep-alive\n\n" 전송       │
│ TCP: Keep-Alive 간격 줄이기                    │
└────────────────────────────────────────────────┘
```

---

## 1억 AI 도시 적용

### SSH Hub 실시간 통신

| 용도 | 기술 선택 | 이유 |
|------|----------|------|
| 터미널 I/O | WebSocket | 양방향, 저지연 |
| 서버 상태 | SSE | 단방향, 간단 |
| 헬스체크 | TCP Keep-Alive | 저수준, 효율적 |

### 현재 SSH Hub 구조
```javascript
// WebSocket for terminal
wss.on('connection', (ws, req) => {
    const serverId = req.url.split('/')[2];
    const ssh = connectSSH(serverId);

    ssh.on('data', (data) => ws.send(data));
    ws.on('message', (msg) => ssh.write(msg));

    // Keep-Alive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// 30초마다 Ping
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
```

---

## 참고 자료

- [WebSocket Keepalive](https://websockets.readthedocs.io/en/stable/topics/keepalive.html)
- [WebSockets vs Long Polling](https://ably.com/blog/websockets-vs-long-polling)
- [SSE vs WebSockets vs Long Polling](https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html)
- [Real-Time Communication Patterns](https://dev.to/karanpratapsingh/system-design-long-polling-websockets-server-sent-events-sse-1hip)

---

## 다음 학습

- [ ] WebSocket 대규모 연결 최적화
- [ ] Socket.io vs ws 비교
- [ ] WebTransport (차세대 기술)
