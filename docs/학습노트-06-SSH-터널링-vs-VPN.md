# SSH 터널링 vs VPN 성능/보안 비교

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #06

---

## 비교 요약

| 항목 | SSH 터널링 | WireGuard | OpenVPN |
|------|-----------|-----------|---------|
| **성능** | 좋음 | 최고 | 보통 |
| **오버헤드** | 낮음 | 4.5% | 17-20% |
| **코드량** | 중간 | 4,000줄 | 70,000줄 |
| **연결 시간** | 빠름 | 100ms | 8초 |
| **계층** | 애플리케이션 | 커널 (L3) | 유저스페이스 |
| **용도** | 포트 포워딩 | 풀 VPN | 풀 VPN |

---

## SSH 터널링

### 종류
```bash
# Local Port Forwarding (-L)
# 로컬 → 원격 서버 → 목적지
ssh -L 3306:db.internal:3306 user@gateway

# Remote Port Forwarding (-R)
# 외부 → 원격 서버 → 로컬
ssh -R 8080:localhost:3000 user@gateway

# Dynamic Port Forwarding (-D)
# SOCKS5 프록시
ssh -D 1080 user@gateway
```

### 장점
```
✅ 별도 설치 불필요 (SSH만 있으면 됨)
✅ 특정 포트만 터널링 (가벼움)
✅ TCP 분할로 불안정한 네트워크에서 유리
✅ 익숙한 인증 (키, 패스워드)
```

### 단점
```
❌ 전체 네트워크 터널링 불가
❌ UDP 지원 안됨
❌ 다중 연결 시 복잡
```

---

## WireGuard

### 특징
```
- 리눅스 커널 내장 (5.6+)
- 4,000줄 코드 (최소 공격 면)
- ChaCha20, Curve25519 암호화
- UDP 기반
- 100ms 연결
```

### 설정 예시
```bash
# /etc/wireguard/wg0.conf (서버)
[Interface]
PrivateKey = SERVER_PRIVATE_KEY
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = CLIENT_PUBLIC_KEY
AllowedIPs = 10.0.0.2/32

# /etc/wireguard/wg0.conf (클라이언트)
[Interface]
PrivateKey = CLIENT_PRIVATE_KEY
Address = 10.0.0.2/24

[Peer]
PublicKey = SERVER_PUBLIC_KEY
Endpoint = server.example.com:51820
AllowedIPs = 0.0.0.0/0
```

### 시작
```bash
wg-quick up wg0
wg show
```

---

## OpenVPN

### 특징
```
- 22년 역사 (2001년~)
- 70,000줄 코드
- 유저스페이스 실행
- TCP/UDP 지원
- 철저한 감사
```

### 단점
```
- 높은 오버헤드 (17-20%)
- 느린 연결 (최대 8초)
- 복잡한 설정
```

---

## 성능 벤치마크

### 다운로드 속도 (100Mbps 기준)
```
VPN 없음:    100 Mbps
WireGuard:   ~95 Mbps (5% 손실)
SSH 터널:    ~90 Mbps (10% 손실)
OpenVPN UDP: ~83 Mbps (17% 손실)
OpenVPN TCP: ~80 Mbps (20% 손실)
```

### 지연 시간 추가
```
WireGuard:   +1-2ms
SSH 터널:    +2-5ms
OpenVPN:     +5-10ms
```

---

## 언제 무엇을 쓸까?

| 상황 | 추천 |
|------|------|
| 단일 포트 접근 | SSH 터널 |
| 전체 네트워크 | WireGuard |
| 기업 호환성 | OpenVPN |
| 최고 성능 필요 | WireGuard |
| 빠른 설정 | SSH 터널 |
| 방화벽 우회 | SSH 터널 (443 포트) |

---

## SSH Hub 시나리오

### 현재: SSH 터널링
```
사용자 → SSH Hub → SSH 터널 → 서버 (73/232/253)
```

### WireGuard 적용 시
```
사용자 → WireGuard VPN → 내부 네트워크 직접 접근
```

### 하이브리드 권장
```
┌─────────────────────────────────────────┐
│ 외부 접근: SSH Hub (웹 기반 터미널)      │
│ 내부 통신: WireGuard (서버 간 VPN)       │
└─────────────────────────────────────────┘

73 ──WireGuard── 232
 │                │
 └──WireGuard────253
```

### WireGuard 서버 간 설정
```bash
# 73 서버 (/etc/wireguard/wg0.conf)
[Interface]
PrivateKey = 73_PRIVATE_KEY
Address = 10.100.0.1/24
ListenPort = 51820

[Peer]
PublicKey = 232_PUBLIC_KEY
AllowedIPs = 10.100.0.2/32
Endpoint = 192.168.45.232:51820

[Peer]
PublicKey = 253_PUBLIC_KEY
AllowedIPs = 10.100.0.3/32
Endpoint = 192.168.45.253:51820
```

---

## 보안 비교

### 암호화 알고리즘
| 기술 | 암호화 |
|------|--------|
| SSH | AES-256, ChaCha20 |
| WireGuard | ChaCha20-Poly1305, Curve25519 |
| OpenVPN | AES-256-GCM, RSA |

### 공격 면
```
WireGuard: 4,000줄 → 감사 용이
OpenVPN: 70,000줄 → 복잡, 오래 검증됨
SSH: 중간 → 매우 성숙
```

---

## 참고 자료

- [WireGuard Official](https://www.wireguard.com/)
- [WireGuard vs OpenVPN - Palo Alto](https://www.paloaltonetworks.com/cyberpedia/wireguard-vs-openvpn)
- [Performance Comparison - RTINGS](https://www.rtings.com/vpn/learn/wireguard-vs-openvpn)
- [SSH vs WireGuard - HN Discussion](https://news.ycombinator.com/item?id=21162273)

---

## 다음 학습

- [ ] WireGuard 실제 설치 테스트
- [ ] mTLS (Mutual TLS) 인증
- [ ] Zero Trust Network Access
