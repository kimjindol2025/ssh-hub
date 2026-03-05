# rsync & NFS 동기화 모니터링

> 학습일: 2025-12-27
> 3번 Claude 학습노트 #14

---

## 1. rsync 기본

### 개념
```
rsync = remote sync
- 증분 동기화 (변경분만 전송)
- 압축 전송 지원
- SSH 암호화 지원
```

### 기본 사용법
```bash
# 로컬 동기화
rsync -av /source/ /destination/

# 원격으로 푸시
rsync -av /local/ user@server:/remote/

# 원격에서 풀
rsync -av user@server:/remote/ /local/

# SSH 포트 지정
rsync -av -e "ssh -p 2222" /local/ user@server:/remote/
```

---

## 2. rsync 진행상황 모니터링

### 진행률 표시
```bash
# 기본 진행률
rsync -av --progress /source/ /dest/

# 축약형 (-P = --progress + --partial)
rsync -avP /source/ /dest/

# 사람 읽기 쉬운 형식
rsync -avhP /source/ /dest/

# 통계 포함
rsync -avhP --stats /source/ /dest/
```

### 출력 예시
```
sending incremental file list
data/file.zip
     1,234,567 100%   12.34MB/s    0:00:00 (xfr#1, to-chk=99/100)

sent 1,234,567 bytes  received 35 bytes  2,469,204.00 bytes/sec
total size is 1,234,567  speedup is 1.00
```

---

## 3. rsync 드라이런 (테스트)

```bash
# 실제 전송 없이 미리보기
rsync -avhPn /source/ /dest/
rsync -avhP --dry-run /source/ /dest/

# 출력
# - 전송될 파일 목록
# - 예상 크기
# - 삭제될 파일 (--delete 시)
```

---

## 4. NFS 상태 모니터링

### NFS 마운트 확인
```bash
# 마운트 목록
mount | grep nfs

# 상세 정보
df -hT | grep nfs

# NFS 통계
nfsstat -c  # 클라이언트
nfsstat -s  # 서버
```

### NFS 연결 상태
```bash
# RPC 상태
rpcinfo -p

# NFS 서버 연결 확인
showmount -e 192.168.45.253

# 마운트 테스트
mount -t nfs 192.168.45.253:/home/ai /mnt/test
```

---

## 5. 동기화 스크립트 예시

### 3서버 동기화 상태 확인
```bash
#!/bin/bash
# check-sync.sh

SERVERS=("192.168.45.73" "192.168.45.232" "192.168.45.253")
SOURCE="/home/ai"

echo "=== 동기화 상태 확인 $(date) ==="

for SERVER in "${SERVERS[@]}"; do
    echo -e "\n[Server: $SERVER]"

    # 파일 개수 비교
    LOCAL_COUNT=$(find $SOURCE -type f | wc -l)
    REMOTE_COUNT=$(ssh $SERVER "find $SOURCE -type f | wc -l")

    echo "로컬 파일: $LOCAL_COUNT"
    echo "원격 파일: $REMOTE_COUNT"

    if [ "$LOCAL_COUNT" -eq "$REMOTE_COUNT" ]; then
        echo "상태: ✅ 동기화됨"
    else
        echo "상태: ⚠️ 불일치!"

        # 차이 확인 (드라이런)
        rsync -avhPn $SOURCE/ $SERVER:$SOURCE/ | tail -5
    fi
done
```

### rsync 로그 기록
```bash
#!/bin/bash
# sync-with-log.sh

LOG_FILE="/var/log/rsync/sync-$(date +%Y%m%d).log"

rsync -avhP --stats \
    /home/ai/ \
    192.168.45.232:/home/ai/ \
    2>&1 | tee -a $LOG_FILE

echo "=== 완료: $(date) ===" >> $LOG_FILE
```

---

## 6. NFS vs rsync 비교

| 항목 | NFS | rsync |
|------|-----|-------|
| 방식 | 실시간 마운트 | 배치 동기화 |
| 속도 | 소용량 빠름 | 대용량 빠름 |
| 네트워크 | 항상 연결 | 필요시만 |
| 충돌 | 동시 쓰기 문제 | 단방향 안전 |
| 용도 | 공유 스토리지 | 백업/복제 |

---

## 7. SSH Hub 구현 계획

### API 설계
```
GET /api/sync/status     → 3서버 동기화 상태
GET /api/sync/diff       → 파일 차이점
POST /api/sync/run       → 동기화 실행
GET /api/nfs/status      → NFS 마운트 상태
```

### NexusSSH 활용
```javascript
// NFS 마운트 상태
const nfs = await ssh.run('mount | grep nfs');

// 파일 개수 비교
const count = await ssh.run('find /home/ai -type f | wc -l');

// rsync 드라이런
const diff = await ssh.run('rsync -avhPn /home/ai/ 192.168.45.232:/home/ai/ 2>&1');

// 실제 동기화 (백그라운드)
const sync = await ssh.runBackground('rsync -avhP /home/ai/ 192.168.45.232:/home/ai/ > /tmp/sync.log 2>&1');
```

---

## 8. 주의사항

### rsync + NFS
```
- NFS 마운트 쪽이 수신 측이면 -O 옵션 사용
- 소용량 파일 대량 전송 시 NFS 병목
- I/O 에러 시 삭제 자동 비활성화
```

### 권장 옵션
```bash
rsync -avhP \
    --delete \           # 소스에 없는 파일 삭제
    --exclude='.git' \   # 제외 패턴
    -O \                 # NFS 디렉토리 시간 무시
    source/ dest/
```

---

## 참고 자료

- [DigitalOcean rsync Guide](https://www.digitalocean.com/community/tutorials/how-to-use-rsync-to-sync-local-and-remote-directories)
- [rsync Progress Monitoring](https://www.resilio.com/blog/rsync-progress)
- [rsync man page](https://linux.die.net/man/1/rsync)

---

**rsync/NFS 동기화 학습 완료!**
