# Redis Cluster 세션 공유 방식 조사

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #03

---

## Redis Cluster 개요

### 핵심 특징
- 분산 Redis 구현 (최대 1000 노드)
- 자동 샤딩 (Hash Slots)
- 고가용성 (자동 페일오버)
- 비동기 복제

---

## Hash Slots 구조

### 16384개 슬롯
```
┌─────────────────────────────────────────────┐
│              Hash Slots (0-16383)           │
├──────────────┬──────────────┬───────────────┤
│  Master 1    │   Master 2   │   Master 3    │
│  0-5460      │  5461-10922  │ 10923-16383   │
├──────────────┼──────────────┼───────────────┤
│  Replica 1   │   Replica 2  │   Replica 3   │
│  (백업)       │   (백업)      │   (백업)       │
└──────────────┴──────────────┴───────────────┘
```

### 슬롯 계산
```javascript
// 키에 대한 슬롯 계산
slot = CRC16(key) % 16384

// 예시
CRC16("AI-12345") % 16384 = 8234  → Master 2 담당
CRC16("AI-67890") % 16384 = 3421  → Master 1 담당
```

---

## 세션 공유 아키텍처

### 기존 문제
```
서버1 (세션A) ←→ 사용자
서버2 (세션B) ←→ 사용자  ← 세션 불일치!
서버3 (세션C) ←→ 사용자
```

### Redis로 해결
```
       ┌─────────────────┐
       │  Redis Cluster  │
       │   (세션 저장소)   │
       └────────┬────────┘
                │
    ┌───────────┼───────────┐
    ↓           ↓           ↓
 서버1        서버2        서버3
    ↑           ↑           ↑
    └───────────┴───────────┘
              사용자
```

---

## 세션 저장 예시 (Node.js)

```javascript
const Redis = require('ioredis');

// Redis Cluster 연결
const cluster = new Redis.Cluster([
    { host: '192.168.45.73', port: 6379 },
    { host: '192.168.45.232', port: 6379 },
    { host: '192.168.45.253', port: 6379 }
]);

// 세션 저장
async function saveSession(sessionId, data, ttl = 3600) {
    await cluster.setex(
        `session:${sessionId}`,
        ttl,
        JSON.stringify(data)
    );
}

// 세션 조회
async function getSession(sessionId) {
    const data = await cluster.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
}

// 세션 삭제
async function deleteSession(sessionId) {
    await cluster.del(`session:${sessionId}`);
}
```

---

## 클러스터 설정

### 최소 구성 (6노드)
```
3 Master + 3 Replica = 6 노드

192.168.45.73:6379  (Master 1)
192.168.45.73:6380  (Replica 2)
192.168.45.232:6379 (Master 2)
192.168.45.232:6380 (Replica 3)
192.168.45.253:6379 (Master 3)
192.168.45.253:6380 (Replica 1)
```

### 클러스터 생성
```bash
redis-cli --cluster create \
    192.168.45.73:6379 \
    192.168.45.232:6379 \
    192.168.45.253:6379 \
    192.168.45.73:6380 \
    192.168.45.232:6380 \
    192.168.45.253:6380 \
    --cluster-replicas 1
```

### 상태 확인
```bash
redis-cli --cluster info 192.168.45.73:6379
```

---

## Hash Slot vs Consistent Hashing

| 항목 | Hash Slot (Redis) | Consistent Hashing |
|------|-------------------|-------------------|
| 슬롯 수 | 고정 16384개 | 가상 노드 수 가변 |
| 재분배 | 슬롯 이동 | 키 재해싱 |
| 복잡도 | 단순 | 구현 복잡 |
| 유연성 | 슬롯 단위 | 키 단위 |

---

## 주의사항

### Cross-Slot 에러
```javascript
// ❌ 에러 발생 (다른 슬롯의 키)
await cluster.mget('user:1', 'user:2', 'user:3');
// Error: CROSSSLOT Keys in request don't hash to the same slot

// ✅ 해결: Hash Tag 사용
await cluster.mget('{user}:1', '{user}:2', '{user}:3');
// {} 안의 문자열로 슬롯 계산
```

### Split-Brain 방지
```
권장: 홀수 Master + 2 Replica per Master

3 Master + 6 Replica = 9 노드 (안정)
5 Master + 10 Replica = 15 노드 (대규모)
```

---

## 1억 AI 도시 적용

### SSH Hub 세션 공유
```javascript
// AI 접속 시 세션 저장
app.post('/api/ai/connect', async (req, res) => {
    const { aiId, serverId } = req.body;

    await cluster.setex(`ai:session:${aiId}`, 3600, JSON.stringify({
        serverId,
        connectedAt: Date.now(),
        lastActive: Date.now()
    }));

    res.json({ success: true });
});

// 어떤 서버에서든 세션 조회 가능
app.get('/api/ai/session/:aiId', async (req, res) => {
    const session = await getSession(req.params.aiId);
    res.json(session);
});
```

### 장점
```
1. 서버 이동 시 세션 유지
2. 페일오버 시 자동 복구
3. 수평 확장 가능
4. 1억 세션 분산 저장
```

---

## 참고 자료

- [Redis Cluster Specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Hash Slot vs Consistent Hashing](https://severalnines.com/blog/hash-slot-vs-consistent-hashing-redis/)
- [Session Management with Redis](https://redis.com/solutions/use-cases/session-management/)

---

## 다음 학습

- [ ] Redis Sentinel vs Cluster 비교
- [ ] ioredis 클러스터 옵션 상세
- [ ] Redis 메모리 최적화
