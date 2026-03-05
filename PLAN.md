# SSH Hub - 중앙 SSH 관리 시스템

## 목표
SSH 키, 프록시, 접속 로그를 한 곳에서 관리하는 웹 대시보드

---

## 현재 버그 (즉시 수정)

### 🔴 Critical
1. **모바일 프록시 시작 실패** - target이 "모바일 장치"로 되어 있어 host:port 파싱 불가
   - 위치: `server.js:77-81`
   - 해결: 모바일 프록시 target 형식 수정 또는 예외 처리

2. **Fail2ban sudo 권한** - `sudo fail2ban-client` 실행 시 비밀번호 필요
   - 위치: `server.js:293`
   - 해결: sudoers 설정 또는 노드 권한 조정

### 🟡 Warning
3. **로그 날짜 파싱 불안정** - ISO 형식만 지원, 기존 syslog 형식 미지원
   - 위치: `server.js:212-217, 244-249`

4. **키 삭제 로직 버그** - 주석 라인 제외 후 인덱스 계산으로 잘못된 키 삭제 가능
   - 위치: `server.js:162-169`

---

## 2025 트렌드 기반 개선 (외부 학습 결과)

### Phase 1: UI/UX 개선 (Stripe/Twilio 스타일)

| 현재 | 개선 | 참고 |
|------|------|------|
| 단일 컬럼 카드 | Two-Panel 레이아웃 | Stripe API Docs |
| 기본 버튼 | 상태별 색상 피드백 | - |
| 수동 새로고침 | 실시간 WebSocket | Twilio |
| 없음 | 다크/라이트 토글 | 2025 필수 |

### Phase 2: API 문서화

```
추가할 페이지: /docs 또는 /api-docs

- OpenAPI 3.1 스펙 생성
- 인터랙티브 테스트 콘솔
- 다국어 코드 샘플 (curl, JS, Python)
- 에러 코드 표준화
```

### Phase 3: 기능 확장

1. **API 문서 페이지** (`/docs`)
   - 현재 API 엔드포인트 문서화
   - Try It 버튼으로 테스트

2. **실시간 업데이트**
   - WebSocket으로 프록시 상태 실시간 반영
   - 로그 스트리밍

3. **보안 강화**
   - API 키 인증 추가
   - Rate Limiting

---

## 기능 상세

### 1. SSH 프록시 관리
- 프록시 상태 실시간 모니터링 (10022, 10030, 10073, 10032, 10053)
- 프록시 시작/중지/재시작
- socat 프로세스 관리

### 2. SSH 키 관리
- 등록된 키 목록 조회 (~/.ssh/authorized_keys)
- 키 추가/삭제
- 키 로테이션 알림 (2년 주기)
- Ed25519 키 생성

### 3. 접속 로그
- 실시간 SSH 접속 로그
- 실패 시도 모니터링
- IP별 통계

### 4. 서버 관리
- 73, 232, 253 서버 SSH 상태
- 각 서버 authorized_keys 동기화

### 5. 보안 설정
- sshd_config 조회/편집
- Fail2ban 상태/차단 IP 관리

---

## 기술 스택
- Backend: Express.js
- Frontend: 정적 HTML + Vanilla JS
- 로그: KimNexus v9 SDK
- PM2 프로세스 관리

---

## API 엔드포인트

### 프록시
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/proxy/status | 프록시 상태 |
| POST | /api/proxy/:name/start | 프록시 시작 |
| POST | /api/proxy/:name/stop | 프록시 중지 |

### SSH 키
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/keys | 키 목록 |
| POST | /api/keys | 키 추가 |
| DELETE | /api/keys/:id | 키 삭제 |
| POST | /api/keys/generate | Ed25519 키 생성 |

### 로그
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/logs | 접속 로그 |
| GET | /api/logs/failed | 실패 로그 |

### 서버
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/servers | 서버 목록 |

### Fail2ban
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/fail2ban | 차단 상태 |
| POST | /api/fail2ban/unban/:ip | IP 차단 해제 |

---

## 구현 순서

### Step 1: 버그 수정 ✅
- [ ] 모바일 프록시 target 수정
- [ ] 키 삭제 로직 수정
- [ ] 로그 파싱 개선

### Step 2: UI 개선
- [ ] 다크/라이트 모드 토글
- [ ] 반응형 개선
- [ ] 로딩 상태 표시
- [ ] 에러 토스트 메시지

### Step 3: 기능 추가
- [ ] API 문서 페이지
- [ ] WebSocket 실시간 업데이트
- [ ] 서버별 키 동기화 기능

---

## 포트
- 50200 (시스템 범위)

## 도메인
- ssh.dclub.kr
