# n8n에서 원격 시스템 SSH 명령수행 자동화 및 명령로그 모니터링

> 출처: https://blog.pages.kr/3015

## 개요

n8n에서 SSH를 통해 원격 서버에 명령어를 실행할 때 발생하는 문제와 해결 방법을 다룹니다.

---

## SSH 터미널 할당 문제

### 문제 메시지
```
Pseudo-terminal will not be allocated because stdin is not a terminal
```

### 원인
1. 비대화식 SSH 세션: 스크립트나 프로그램을 통한 원격 명령어 실행
2. `-T` 옵션 사용: 터미널 할당을 시도하지 않도록 설정

### 해결 방법
```bash
ssh -t user@host "command"   # 강제 터미널 할당
```

---

## 중계시스템을 통한 SSH 접근

### 1단계: SSH 키 준비

```bash
# SSH 키 생성
ssh-keygen -t rsa

# 최종 목적지 서버의 authorized_keys에 등록
```

### 2단계: SSH 에이전트 포워딩

```bash
# 로컬 → 중계시스템
ssh -A user@intermediate-system

# 중계시스템 → 최종 목적지
ssh -i /path/to/key user@final-server
```

---

## n8n에서 SSH 옵션 제어

### 방법 1: Execute Command 노드

```bash
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null user@hostname "command"
```

### 방법 2: SSH 구성 파일

`~/.ssh/config`:

```
Host myserver
    HostName server.example.com
    User myuser
    Port 2222
    IdentityFile ~/.ssh/mykey
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null
```

### 방법 3: 프록시 커맨드

```
Host final-server
    HostName final.example.com
    ProxyCommand ssh -W %h:%p intermediate-server
    User finaluser
```

---

## SSH 명령어 실행 로깅

### 방법 1: SSHD 로깅 레벨 조정

`/etc/ssh/sshd_config`:

```
LogLevel DEBUG
```

```bash
sudo systemctl restart sshd
```

### 방법 2: auditd 사용

```bash
# 감사 규칙 추가
auditctl -a always,exit -F arch=b64 -S execve -F path=/bin/bash

# 규칙 확인
auditctl -l
```

### 방법 3: pam_exec 모듈

로깅 스크립트 (`/usr/local/bin/ssh-commands-logger.sh`):

```bash
#!/bin/bash
LOG_FILE="/var/log/ssh_commands.log"
DATE=$(date "+%Y-%m-%d %H:%M:%S")
echo "Date: $DATE User: $PAM_USER Remote: $PAM_RHOST" >> $LOG_FILE
```

```bash
chmod +x /usr/local/bin/ssh-commands-logger.sh
```

`/etc/pam.d/sshd`에 추가:

```
session optional pam_exec.so /usr/local/bin/ssh-commands-logger.sh
```

### 방법 4: ForceCommand 사용

로깅 스크립트 (`/usr/local/bin/log-all-commands.sh`):

```bash
#!/bin/bash
LOG_FILE="/var/log/user_commands.log"
echo "$(date) - USER: $USER, COMMAND: $SSH_ORIGINAL_COMMAND" >> $LOG_FILE

if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  exec /bin/bash
else
  exec $SSH_ORIGINAL_COMMAND
fi
```

`/etc/ssh/sshd_config`:

```
ForceCommand /usr/local/bin/log-all-commands.sh
```

---

## 특정 그룹에만 적용

### 그룹 생성

```bash
sudo groupadd ai_group
sudo usermod -a -G ai_group ai_user
```

### sshd_config 설정

```
Match Group ai_group
    ForceCommand /usr/local/bin/log-all-commands.sh
```

---

## 특정 사용자 제외

```bash
#!/bin/bash
EXCLUDE_USER="admin"

if [ "$USER" == "$EXCLUDE_USER" ]; then
  # 로깅 없이 실행
  if [ -n "$SSH_ORIGINAL_COMMAND" ]; then
    exec $SSH_ORIGINAL_COMMAND
  else
    exec /bin/bash
  fi
else
  # 로깅 후 실행
  LOG_FILE="/var/log/user_commands.log"
  echo "$(date) - USER: $USER, COMMAND: $SSH_ORIGINAL_COMMAND" >> $LOG_FILE
  if [ -n "$SSH_ORIGINAL_COMMAND" ]; then
    exec $SSH_ORIGINAL_COMMAND
  else
    exec /bin/bash
  fi
fi
```

---

## 1억 AI 도시 적용

| 기능 | 활용 |
|------|------|
| SSH 자동화 | AI가 서버 명령 자동 실행 |
| 명령 로깅 | AI 활동 추적/감사 |
| 그룹별 제어 | AI 그룹과 관리자 분리 |
| ProxyCommand | SSH Hub를 통한 중계 접속 |

### n8n + SSH Hub 연동 예시

```
n8n Workflow
    ↓
SSH Hub API (/api/ai/exec)
    ↓
서버 자동 선택 (로드밸런서)
    ↓
명령 실행 + 로깅
```
