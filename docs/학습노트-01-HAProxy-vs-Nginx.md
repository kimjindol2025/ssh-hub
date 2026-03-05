# HAProxy vs Nginx 로드밸런서 비교 연구

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #01

---

## 핵심 요약

| 항목 | HAProxy | Nginx |
|------|---------|-------|
| **주 용도** | 전용 로드밸런서 | 웹서버 + 로드밸런서 |
| **성능** | 10-15% 우위 (연결 처리) | 정적 콘텐츠에 강함 |
| **아키텍처** | 멀티스레드 단일 프로세스 | 워커 프로세스 기반 |
| **L4/L7** | 둘 다 지원 (강점) | 주로 L7 |
| **프로토콜** | TCP, HTTP, SMTP, WebSocket | HTTP, HTTPS 중심 |

---

## 성능 벤치마크

```
기본 설정 (Round-Robin):
HAProxy: 19% 더 빠름

클릭 테스트:
Nginx: 400% 더 긴 응답 시간
```

**결론:** 순수 로드밸런싱은 HAProxy 승

---

## Layer 4 vs Layer 7

### Layer 4 (TCP 모드)
```
클라이언트 ──TCP──> HAProxy ──TCP──> 서버
                    (패킷 내용 안 봄)
```

**특징:**
- 빠름, 가벼움
- IP + 포트만 보고 라우팅
- DB (MySQL, PostgreSQL, Redis) 로드밸런싱에 적합
- TLS 패스스루 가능

**HAProxy 설정:**
```haproxy
frontend db_front
    mode tcp
    bind *:5432
    default_backend postgres_servers

backend postgres_servers
    mode tcp
    balance roundrobin
    server db1 192.168.45.232:5432
    server db2 192.168.45.253:5432
```

### Layer 7 (HTTP 모드)
```
클라이언트 ──HTTP──> HAProxy ──HTTP──> 서버
                    (헤더, 쿠키, URL 분석)
```

**특징:**
- URL 기반 라우팅 가능
- 세션 스티키 (쿠키)
- WAF, Rate Limit 가능
- 약간 느림 (내용 파싱)

**HAProxy 설정:**
```haproxy
frontend web_front
    mode http
    bind *:80

    # URL 기반 라우팅
    acl is_api path_beg /api
    use_backend api_servers if is_api
    default_backend web_servers

backend web_servers
    mode http
    balance leastconn
    server web1 192.168.45.73:3000
    server web2 192.168.45.253:3000
```

---

## 1억 AI 도시 적용

### 현재 SSH Hub 구조
```
클라이언트 → SSH Hub (Node.js) → 서버 선택 → SSH 연결
```

### HAProxy 적용 시
```
클라이언트 → HAProxy (L4) → SSH 서버
                ↓
          헬스체크 + 로드밸런싱
```

**장점:**
1. Node.js 부하 감소
2. 더 빠른 연결 처리
3. 자동 페일오버 내장

### 권장 설정
```haproxy
frontend ssh_front
    mode tcp
    bind *:2222
    default_backend ssh_servers

backend ssh_servers
    mode tcp
    balance leastconn
    option tcp-check

    server ssh73 192.168.45.73:2222 check
    server ssh232 192.168.45.232:2222 check
    server ssh253 192.168.45.253:22 check
```

---

## 언제 뭘 쓸까?

| 상황 | 선택 |
|------|------|
| 이미 Nginx 사용 + 간단한 LB | Nginx |
| 순수 로드밸런싱 + 고성능 | HAProxy |
| TCP 프록시 (DB, SSH) | HAProxy |
| 정적 파일 + 캐싱 | Nginx |
| 둘 다 필요 | HAProxy (LB) + Nginx (웹서버) |

---

## 참고 자료

- [HAProxy vs NGINX Performance - Last9](https://last9.io/blog/haproxy-vs-nginx-performance/)
- [Layer 4 vs Layer 7 Proxy Mode - HAProxy](https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode)
- [NGINX vs HAProxy - OpenLogic](https://www.openlogic.com/blog/nginx-vs-haproxy)
- [Benchmarking 5 Load Balancers - Loggly](https://www.loggly.com/blog/benchmarking-5-popular-load-balancers-nginx-haproxy-envoy-traefik-and-alb/)

---

## 다음 학습

- [ ] HAProxy 실제 설치 및 테스트
- [ ] Consistent Hashing으로 세션 유지
- [ ] HAProxy + SSH Hub 연동 설계
