# Raft 합의 알고리즘 이해

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #08

---

## Raft란?

```
Raft = Reliable, Replicated, Redundant, And Fault-Tolerant

목적: 분산 시스템에서 모든 노드가 같은 값에 동의하도록 함
특징: Paxos보다 이해하기 쉽게 설계됨
```

---

## 핵심 개념

### 노드 역할 (3가지)
```
┌─────────┐     ┌──────────┐     ┌──────────┐
│ Leader  │────>│ Follower │     │ Candidate│
│ (1개)   │     │ (N개)    │     │ (선거 중) │
└─────────┘     └──────────┘     └──────────┘
    │                                  ↑
    └──────────────────────────────────┘
           리더 없으면 후보 전환
```

### 용어
```
Term:     임기 (선거마다 증가)
Log:      명령 기록 (복제됨)
Commit:   과반 복제 완료된 상태
Heartbeat: 리더가 보내는 생존 신호
```

---

## 작동 원리

### 1. 리더 선거
```
시나리오: 리더 다운 감지

1. Follower → Candidate 전환
2. Term 증가, 자신에게 투표
3. 다른 노드에 투표 요청
4. 과반 득표 시 Leader 승격
5. Heartbeat 시작

타임아웃: 150-300ms (랜덤)
```

### 선거 예시
```
      Term 1              Term 2
┌─────────────────┐   ┌─────────────────┐
│ A: Leader       │   │ A: (다운)        │
│ B: Follower     │ → │ B: Candidate → Leader │
│ C: Follower     │   │ C: Follower     │
└─────────────────┘   └─────────────────┘
```

### 2. 로그 복제
```
클라이언트 요청 → 리더

1. 리더: 로그에 기록
2. 리더 → Follower: 로그 전파
3. Follower: 로그 기록, ACK 응답
4. 과반 ACK 받으면 Commit
5. 클라이언트에 응답
```

### 복제 예시
```
Client: SET x=5

Leader Log:  [SET x=5] ← Committed
             ↓ 복제
Follower1:   [SET x=5] ← ACK ✓
Follower2:   [SET x=5] ← ACK ✓
Follower3:   (지연)     ← 아직 ✗

과반 (2/3) ACK → Commit!
```

---

## 내결함성

### 허용 장애 수
```
노드 수:  3 → 1대 장애 허용
노드 수:  5 → 2대 장애 허용
노드 수:  7 → 3대 장애 허용

공식: (N-1)/2 대 장애 허용
```

### 1억 AI 도시 적용
```
3 서버 (73, 232, 253):
├── 1대 장애 허용
├── 2대 동시 장애 시 서비스 중단
└── 과반 (2대) 살아있으면 정상
```

---

## 실제 사용 사례

| 시스템 | 용도 |
|--------|------|
| **etcd** | Kubernetes 상태 저장 |
| **Consul** | 서비스 디스커버리 |
| **MongoDB** | 레플리카셋 |
| **CockroachDB** | 분산 SQL |
| **Kafka KRaft** | 메타데이터 관리 |
| **RabbitMQ** | 큐 복제 |

---

## 코드로 이해하기

### 단순화된 Raft (JavaScript)
```javascript
class RaftNode {
    constructor(id, peers) {
        this.id = id;
        this.peers = peers;
        this.state = 'follower';
        this.term = 0;
        this.votedFor = null;
        this.log = [];
    }

    // 선거 시작
    startElection() {
        this.term++;
        this.state = 'candidate';
        this.votedFor = this.id;

        let votes = 1;  // 자기 투표

        for (const peer of this.peers) {
            if (peer.requestVote(this.term, this.id)) {
                votes++;
            }
        }

        if (votes > this.peers.length / 2) {
            this.becomeLeader();
        }
    }

    // 투표 요청 처리
    requestVote(term, candidateId) {
        if (term > this.term && !this.votedFor) {
            this.term = term;
            this.votedFor = candidateId;
            return true;
        }
        return false;
    }

    // 리더 승격
    becomeLeader() {
        this.state = 'leader';
        this.sendHeartbeats();
    }

    // 로그 복제
    appendEntry(command) {
        this.log.push({ term: this.term, command });

        let acks = 1;
        for (const peer of this.peers) {
            if (peer.replicateLog(this.log)) {
                acks++;
            }
        }

        if (acks > this.peers.length / 2) {
            return 'committed';
        }
    }
}
```

---

## 시각화 학습

**추천:** https://thesecretlivesofdata.com/raft/
- 인터랙티브 Raft 시각화
- 단계별 애니메이션
- 한눈에 이해 가능

---

## 한계

```
❌ 비잔틴 장애 미지원 (악의적 노드)
❌ 리더 병목 가능성
❌ 네트워크 파티션 시 복잡
```

---

## 참고 자료

- [Raft Official](https://raft.github.io/)
- [Raft Visualization](https://thesecretlivesofdata.com/raft/)
- [Raft - GeeksforGeeks](https://www.geeksforgeeks.org/system-design/raft-consensus-algorithm/)
- [Raft Paper](https://raft.github.io/raft.pdf)

---

## 다음 학습

- [ ] etcd 설치 및 테스트
- [ ] Paxos vs Raft 비교
- [ ] 비잔틴 장애 허용 (PBFT)
