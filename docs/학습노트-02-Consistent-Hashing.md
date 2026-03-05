# Consistent Hashing 알고리즘 심화 학습

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #02

---

## 핵심 개념

### 문제: 기존 해싱의 한계

```
서버 3대 → 4대로 증가 시:

기존 방식: hash(key) % 서버수
- 거의 모든 키 재배치 필요
- 데이터 대량 이동 발생
```

### 해결: Consistent Hashing

```
해시 링 (Hash Ring)
        0°
         ●
    315°/ \45°
      /   \
270° ●     ● 90°
      \   /
    225°\ /135°
         ●
       180°

서버와 키 모두 같은 링에 배치
→ 시계 방향으로 가장 가까운 서버에 할당
```

---

## 작동 원리

### 1. 링에 서버 배치
```javascript
// 서버 해싱
hash("server-73")  → 45°
hash("server-232") → 150°
hash("server-253") → 270°
```

### 2. 키 할당
```javascript
// 키 해싱 후 시계방향 탐색
hash("AI-12345") → 100°  → server-232 담당
hash("AI-67890") → 200°  → server-253 담당
hash("AI-11111") → 300°  → server-73 담당
```

### 3. 서버 추가/제거 시
```
서버 추가: 인접 키만 재배치
서버 제거: 해당 서버 키만 다음 서버로 이동

재배치 비율: k/n (k=총 키, n=총 서버)
예: 1억 키, 100 서버 → 100만 키만 이동 (1%)
```

---

## Virtual Nodes (가상 노드)

### 문제: 불균등 분포
```
서버 3대만 있으면 링에서 간격이 불균등
→ 특정 서버에 부하 집중 (핫스팟)
```

### 해결: 가상 노드
```
물리 서버 1개 → 가상 노드 100개

hash("server-73-vn1")  → 10°
hash("server-73-vn2")  → 95°
hash("server-73-vn3")  → 180°
...
hash("server-73-vn100") → 350°
```

### 효과
```
┌─────────────────────────────────────┐
│ 가상 노드 수 │ 부하 편차 │ 메모리  │
├─────────────────────────────────────┤
│     10개     │   ±25%   │   적음  │
│    100개     │   ±10%   │   보통  │
│   1000개     │   ±3%    │   많음  │
└─────────────────────────────────────┘
```

---

## 구현 (JavaScript)

```javascript
const crypto = require('crypto');

class ConsistentHash {
    constructor(replicas = 100) {
        this.replicas = replicas;  // 가상 노드 수
        this.ring = new Map();     // 해시 → 서버
        this.sortedKeys = [];      // 정렬된 해시값
    }

    // 해시 함수 (MD5)
    hash(key) {
        return crypto.createHash('md5')
            .update(key)
            .digest('hex')
            .substring(0, 8);
    }

    // 서버 추가
    addServer(server) {
        for (let i = 0; i < this.replicas; i++) {
            const virtualKey = `${server}-vn${i}`;
            const hash = this.hash(virtualKey);
            this.ring.set(hash, server);
            this.sortedKeys.push(hash);
        }
        this.sortedKeys.sort();
    }

    // 서버 제거
    removeServer(server) {
        for (let i = 0; i < this.replicas; i++) {
            const virtualKey = `${server}-vn${i}`;
            const hash = this.hash(virtualKey);
            this.ring.delete(hash);
            this.sortedKeys = this.sortedKeys.filter(k => k !== hash);
        }
    }

    // 키에 대한 서버 찾기
    getServer(key) {
        if (this.sortedKeys.length === 0) return null;

        const hash = this.hash(key);

        // 이진 탐색으로 다음 서버 찾기
        for (const ringKey of this.sortedKeys) {
            if (ringKey >= hash) {
                return this.ring.get(ringKey);
            }
        }

        // 링 끝이면 처음으로
        return this.ring.get(this.sortedKeys[0]);
    }
}

// 사용 예시
const ch = new ConsistentHash(100);
ch.addServer('192.168.45.73');
ch.addServer('192.168.45.232');
ch.addServer('192.168.45.253');

console.log(ch.getServer('AI-12345'));  // 192.168.45.232
console.log(ch.getServer('AI-67890'));  // 192.168.45.73
```

---

## 실제 사용 사례

| 시스템 | 용도 |
|--------|------|
| Amazon DynamoDB | 데이터 파티셔닝 |
| Apache Cassandra | 노드 간 데이터 분산 |
| Akamai CDN | 콘텐츠 캐시 서버 선택 |
| Vimeo | 비디오 스트리밍 로드밸런싱 |
| Redis Cluster | 슬롯 기반 샤딩 |

---

## 1억 AI 도시 적용

### SSH Hub에 Consistent Hashing 적용

```javascript
// server.js에 추가
const ConsistentHash = require('./consistent-hash');
const ch = new ConsistentHash(100);

// 서버 등록
SERVERS.forEach(s => ch.addServer(s.id));

// AI 연결 요청 시
app.post('/api/ai/connect', (req, res) => {
    const aiId = req.body.aiId;  // "AI-12345"

    // 같은 AI는 항상 같은 서버로
    const serverId = ch.getServer(aiId);

    res.json({ server: serverId });
});
```

### 장점
```
1. 세션 일관성: AI-12345는 항상 같은 서버
2. 부하 분산: 가상 노드로 균등 분배
3. 확장성: 서버 추가 시 최소 재배치
4. 장애 복구: 서버 제거 시 자동 재분배
```

---

## 참고 자료

- [Consistent Hashing Explained - AlgoMaster](https://blog.algomaster.io/p/consistent-hashing-explained)
- [Consistent Hashing - Wikipedia](https://en.wikipedia.org/wiki/Consistent_hashing)
- [Consistent Hashing - GeeksforGeeks](https://www.geeksforgeeks.org/system-design/consistent-hashing/)
- [Understanding Consistent Hashing - PubNub](https://www.pubnub.com/blog/consistent-hashing-in-distributed-systems/)

---

## 다음 학습

- [ ] Redis Cluster의 해시 슬롯 방식
- [ ] Consistent Hashing + Bounded Loads
- [ ] Jump Consistent Hash (더 빠른 변형)
