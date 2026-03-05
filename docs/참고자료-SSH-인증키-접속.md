# SSH 인증키 접속 (ssh-agent 활용법)

> 출처: https://blog.pages.kr/423

## 개요

SSH 인증키를 사용하면 "단지 개인키를 사용하기 위한 패스프레이즈 비밀번호만을 입력"하여 접속할 수 있습니다.

**장점:**
- 계정별 비밀번호 기억 불필요
- 보안 강화
- 여러 시스템에 같은 패스프레이즈로 로그인 가능

---

## 1. Private Key 생성하기

```bash
ssh-keygen -t rsa -b 4096
```

- 패스프레이즈 없이 키를 생성하면 비밀번호 입력 없이 접속 가능

---

## 2. 설정 파일 확인

`/etc/ssh/sshd_config`:

```
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
RSAAuthentication yes
```

주석 처리되어 있으면 제거 후 서버 재시작

---

## 3. 개인키 권한 설정

```bash
chmod 600 ~/.ssh/id_rsa
chmod 700 ~/.ssh
```

**중요:** 개인키에 대해 모든 사람이 읽을 수 있으면 OpenSSH는 개인키를 무시합니다.

---

## 4. SCP (Secure Copy)

```bash
# 파일 복사
scp [파일] [user@host:경로]

# 디렉토리 재귀 복사
scp -r [디렉토리] [user@host:경로]
```

---

## 5. SSH 설정 파일

| 파일 | 용도 |
|------|------|
| `~/.ssh/config` | 사용자별 클라이언트 설정 |
| `/etc/ssh/ssh_config` | 시스템 전역 클라이언트 설정 |
| `/etc/ssh/sshd_config` | 서버 데몬 설정 |
| `~/.ssh/id_rsa` | 개인키 |
| `~/.ssh/authorized_keys` | 로그인 허용 공개키 목록 |

---

## 6. SSH Agent 사용

에이전트는 "개인키를 메모리에 로드하고 있다가 클라이언트의 요청이 있으면 인증을 처리"합니다.

### 에이전트 시작

```bash
eval $(ssh-agent -s)  # 백그라운드 실행
```

### 개인키 등록

```bash
ssh-add ~/.ssh/id_rsa    # 키 등록
ssh-add -l               # 등록된 키 확인
ssh-add -d               # 키 제거
ssh-add -D               # 모든 키 제거
```

등록 후 패스프레이즈를 한 번만 입력하면 이후 로그인 시 자동 인증

---

## 7. Agent Forwarding

여러 서버에 순차 접속할 때 에이전트를 포워딩:

```
로컬 → 중계서버 → 최종서버
```

**설정:** `~/.ssh/config`

```
Host *
    ForwardAgent yes
```

**장점:**
- 로컬 컴퓨터의 에이전트가 중간 서버를 통해 원격 서버 인증 처리
- 각 서버마다 개인키를 배치할 필요 없음

---

## 8. SSH Config 예시

```
# ~/.ssh/config

Host 73
    HostName 192.168.45.73
    User kim
    Port 2222
    IdentityFile ~/.ssh/id_rsa

Host 232
    HostName 192.168.45.232
    User kim
    Port 2222
    IdentityFile ~/.ssh/id_rsa

Host 253
    HostName 192.168.45.253
    User kimjin
    Port 22
    IdentityFile ~/.ssh/id_rsa
```

사용:
```bash
ssh 73    # 192.168.45.73:2222 kim 자동 접속
ssh 232   # 192.168.45.232:2222 kim 자동 접속
```

---

## 1억 AI 도시 적용

| 기능 | 활용 |
|------|------|
| SSH Key 인증 | AI 자동 접속 (비밀번호 없이) |
| Agent Forwarding | 서버 간 이동 시 재인증 없음 |
| SSH Config | 서버별 설정 자동화 |
