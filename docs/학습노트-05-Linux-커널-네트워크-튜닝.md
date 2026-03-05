# Linux 커널 네트워크 튜닝 파라미터 정리

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #05

---

## C10K → C10M 문제

```
C10K  = 10,000 동시 연결 (2000년대 문제, 해결됨)
C100K = 100,000 동시 연결
C1M   = 1,000,000 동시 연결
C10M  = 10,000,000 동시 연결 (현재 도전)
```

**핵심:** 커널 최적화 + 이벤트 드리븐 아키텍처

---

## 필수 sysctl 파라미터

### 1. 파일 디스크립터
```bash
# /etc/sysctl.conf

# 시스템 전체 파일 핸들 수
fs.file-max = 4000000

# 프로세스당 파일 핸들 (ulimit)
# /etc/security/limits.conf
* soft nofile 1000000
* hard nofile 1000000
root soft nofile 1000000
root hard nofile 1000000
```

### 2. TCP 버퍼 크기
```bash
# 수신 버퍼 (min, default, max)
net.ipv4.tcp_rmem = 4096 87380 16777216

# 송신 버퍼 (min, default, max)
net.ipv4.tcp_wmem = 4096 65536 16777216

# 코어 버퍼
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
```

### 3. 연결 백로그
```bash
# SYN 백로그 (대기 연결 큐)
net.ipv4.tcp_max_syn_backlog = 65536

# LISTEN 소켓 백로그
net.core.somaxconn = 65535

# 네트워크 장치 백로그
net.core.netdev_max_backlog = 65536
```

### 4. TIME_WAIT 최적화
```bash
# TIME_WAIT 소켓 재사용
net.ipv4.tcp_tw_reuse = 1

# FIN 타임아웃 (기본 60초 → 15초)
net.ipv4.tcp_fin_timeout = 15

# 로컬 포트 범위 확장
net.ipv4.ip_local_port_range = 1024 65535
```

### 5. 연결 추적 (conntrack)
```bash
# conntrack 테이블 크기
net.netfilter.nf_conntrack_max = 2621440

# 해시 테이블 크기
net.netfilter.nf_conntrack_buckets = 655360
```

### 6. TCP 혼잡 제어
```bash
# BBR 활성화 (Google 개발)
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
```

---

## 1억 연결용 설정 (완성본)

```bash
# /etc/sysctl.d/99-million-connections.conf

# === 파일 핸들 ===
fs.file-max = 12000000
fs.nr_open = 12000000

# === TCP 버퍼 ===
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_rmem = 4096 1048576 67108864
net.ipv4.tcp_wmem = 4096 1048576 67108864
net.ipv4.tcp_mem = 786432 1048576 26777216

# === 백로그 ===
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65536
net.ipv4.tcp_max_syn_backlog = 65536

# === TIME_WAIT ===
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 10
net.ipv4.ip_local_port_range = 1024 65535

# === conntrack ===
net.netfilter.nf_conntrack_max = 10485760

# === TCP 최적화 ===
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_no_metrics_save = 1

# === 혼잡 제어 ===
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# === Keep-Alive ===
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 3
```

### 적용
```bash
sudo sysctl -p /etc/sysctl.d/99-million-connections.conf
```

---

## ulimit 설정

```bash
# /etc/security/limits.conf

# 모든 사용자
* soft nofile 10000000
* hard nofile 10000000
* soft nproc 10000000
* hard nproc 10000000

# root
root soft nofile 10000000
root hard nofile 10000000
```

### 확인
```bash
ulimit -n        # 현재 제한
ulimit -Hn       # Hard limit
cat /proc/sys/fs/file-max
```

---

## NIC 인터럽트 분산

```bash
# 인터럽트 확인
cat /proc/interrupts | grep eth

# CPU 코어별 분산 (smp_affinity)
echo 1 > /proc/irq/24/smp_affinity  # CPU 0
echo 2 > /proc/irq/25/smp_affinity  # CPU 1
echo 4 > /proc/irq/26/smp_affinity  # CPU 2
echo 8 > /proc/irq/27/smp_affinity  # CPU 3
```

### ethtool 최적화
```bash
# 링 버퍼 확인
ethtool -g eth0

# 링 버퍼 증가
ethtool -G eth0 rx 4096 tx 4096

# 인터럽트 coalescing
ethtool -C eth0 adaptive-rx on
```

---

## Huge Pages (대규모 연결용)

```bash
# 2MB 페이지 활성화
echo 30720 > /proc/sys/vm/nr_hugepages

# /etc/sysctl.conf
vm.nr_hugepages = 30720

# 확인
cat /proc/meminfo | grep Huge
```

---

## 현재 상태 모니터링

```bash
# 열린 파일 수
cat /proc/sys/fs/file-nr

# 연결 상태
ss -s

# TIME_WAIT 수
ss -tan | grep TIME-WAIT | wc -l

# 소켓 메모리
cat /proc/net/sockstat
```

---

## 1억 AI 도시 적용

### 73 서버 최적화 스크립트
```bash
#!/bin/bash
# optimize-network.sh

echo "=== 1억 AI 네트워크 최적화 ==="

# sysctl 적용
sysctl -p /etc/sysctl.d/99-million-connections.conf

# 링 버퍼 증가
for eth in /sys/class/net/eth*; do
    ethtool -G $(basename $eth) rx 4096 tx 4096 2>/dev/null
done

# 현재 상태
echo "File-nr: $(cat /proc/sys/fs/file-nr)"
echo "Connections: $(ss -s | grep TCP:)"
```

### 예상 효과
```
튜닝 전: ~10,000 연결 (기본값)
튜닝 후: ~1,000,000+ 연결 가능

서버 3대 × 100만 = 300만 동시 연결
→ 1억 AI 순차 접속 충분
```

---

## 참고 자료

- [Linux Network Performance Parameters](https://github.com/leandromoreira/linux-network-performance-parameters)
- [MigratoryData C10M Solution](https://migratorydata.com/blog/migratorydata-solved-the-c10m-problem/)
- [Linux TCP Tuning](https://fasterdata.es.net/host-tuning/linux)
- [C10K Problem - Wikipedia](https://en.wikipedia.org/wiki/C10k_problem)

---

## 다음 학습

- [ ] BBR vs CUBIC 혼잡 제어 비교
- [ ] io_uring 비동기 I/O
- [ ] eBPF 네트워크 최적화
