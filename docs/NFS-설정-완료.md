# NFS 공유 스토리지 설정 완료

**설정일:** 2025-12-27
**버전:** SSH Hub v3.0.0

---

## 구성

```
253 (NFS 서버)
├── /home/ai (1.9TB 가용)
│
├── 73 (클라이언트) ✅
└── 232 (클라이언트) ✅
```

---

## 서버별 설정

### 253 (NFS 서버)

```bash
# /etc/exports
/home/ai 192.168.45.0/24(rw,sync,no_subtree_check,no_root_squash)
```

### 73, 232 (클라이언트)

```bash
# /etc/fstab
192.168.45.253:/home/ai /home/ai nfs defaults 0 0
```

---

## 검증

```
파일 시스템              크기  사용  가용 사용% 마운트위치
192.168.45.253:/home/ai  1.9T  450G  1.4T   26% /home/ai
```

- 73에서 파일 생성 → 232, 253에서 확인 ✅
- 재부팅 후 자동 마운트 ✅

---

## 1억 AI 분산 시스템 효과

AI가 어느 서버에 접속하든:
- `/home/ai` 동일
- 작업 파일 공유
- 세션 이동 시 끊김 없음

---

**dclub.kr Infrastructure** | 1억 AI 도시 - 3번 Claude
