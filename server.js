const express = require('express');
const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const webpush = require('web-push');
// API 키 인증 사용 (JWT 제거)
const { Client: SSHClient } = require('ssh2');
const { v4: uuidv4 } = require('uuid');

// NexusSSH Pro 연동 (4번 Claude 작품)
let NexusSSH = null;
try {
    const nexusModule = require('../api_hub');
    NexusSSH = nexusModule.NexusSSH;
    console.log('NexusSSH Pro loaded: 61 API functions available');
} catch (e) {
    console.log('NexusSSH Pro not available, using fallback');
}

const execPromise = util.promisify(exec);
const { apiOptimizerMiddleware } = require('./api-optimizer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 50200;
const LOG_FILE = path.join(__dirname, 'data', 'ssh-access.log');
const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
const JIT_FILE = path.join(__dirname, 'data', 'jit-requests.json');
const CA_KEY = path.join(__dirname, 'data', 'ssh-ca');
const CA_PUB = path.join(__dirname, 'data', 'ssh-ca.pub');

// API 키 인증 설정
const API_KEY = process.env.SSH_HUB_API_KEY || 'dclub-api-key-2025-secure';
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'push-subscriptions.json');

// Web Push 설정
const VAPID_KEYS = {
    publicKey: 'BLy4nxZ9DDttspNZuqcmwwu27yZ3lrSOpwfbVuiDKWMhcdUsT4-0927fiuLrv4UaVl2Ik3hQPyvortZjfe8YOuI',
    privateKey: 'Z3E19pml2eMSdEi0xxjvziIYatpOa5ZGlgSxBP2kA_8'
};
webpush.setVapidDetails('mailto:admin@dclub.kr', VAPID_KEYS.publicKey, VAPID_KEYS.privateKey);

// 구독 관리
let pushSubscriptions = [];
async function loadSubscriptions() {
    try {
        const data = await fs.readFile(SUBSCRIPTIONS_FILE, 'utf8');
        pushSubscriptions = JSON.parse(data);
    } catch (e) { pushSubscriptions = []; }
}
async function saveSubscriptions() {
    await fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2));
}
loadSubscriptions();

// 푸시 알림 전송
async function sendPushNotification(title, body, data = {}) {
    const payload = JSON.stringify({ title, body, data, timestamp: Date.now() });
    const results = [];
    for (const sub of pushSubscriptions) {
        try {
            await webpush.sendNotification(sub, payload);
            results.push({ success: true });
        } catch (err) {
            if (err.statusCode === 410) {
                pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
                await saveSubscriptions();
            }
            results.push({ success: false, error: err.message });
        }
    }
    return results;
}

// KimNexus v9 Central Log
const nexusLog = require('./kimnexus-log')('ssh-hub', '73');

app.use(express.json());
app.use(express.static('public'));

// ✅ API Optimizer: Selective Fields + Caching (모든 API에 적용)
app.use('/api/', apiOptimizerMiddleware());

// ============ API 키 인증 ============

// API 키 검증 미들웨어
function requireAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.query.key;
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }
    if (apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    req.user = { role: 'admin', name: 'Admin' }; // API 키 사용자는 관리자
    next();
}

// 관리자 미들웨어 (API 키 사용자는 모두 관리자)
function requireAdmin(req, res, next) {
    next();
}

// ============ API 키 검증 엔드포인트 ============

// API 키 검증
app.post('/api/auth/verify', (req, res) => {
    const { apiKey } = req.body;
    if (apiKey === API_KEY) {
        res.json({ valid: true, message: 'API key verified' });
    } else {
        res.status(401).json({ valid: false, error: 'Invalid API key' });
    }
});

// WebSocket 클라이언트 관리
const wsClients = new Set();
wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
});

// 브로드캐스트 함수
function broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// 프록시 설정
const PROXIES = [
    { name: 'mobile', port: 10022, target: '모바일 장치', domain: 'mobile.ssh.dclub.kr', user: 'user' },
    { name: 'company', port: 10030, target: '121.164.205.220:2222', domain: 'company.ssh.dclub.kr', user: 'user' },
    { name: 'server-73', port: 10073, target: '192.168.45.73:2222', domain: '73.ssh.dclub.kr', user: 'kimjin' },
    { name: 'server-232', port: 10032, target: '192.168.45.232:2222', domain: '232.ssh.dclub.kr', user: 'kimjin' },
    { name: 'server-253', port: 10053, target: '192.168.45.253:22', domain: '253.ssh.dclub.kr', user: 'kimjin' },
    { name: 'server-253-direct', port: 22253, target: '192.168.45.253:22', domain: '253.ssh.dclub.kr', user: 'kimjin' }
];

const SERVERS = [
    { id: '73', name: 'Server-73', host: '192.168.45.73', user: 'kim' },
    { id: '232', name: 'Server-232', host: '192.168.45.232', port: 2222, user: 'kim' },
    { id: '253', name: 'Server-253', host: '192.168.45.253', user: 'kimjin' }
];

// 내부 IP → 서버 ID 매핑
const IP_TO_SERVER = {
    '192.168.45.73': '73',
    '192.168.45.232': '232',
    '192.168.45.253': '253',
    '192.168.45.141': 'Mobile',
    '192.168.45.78': '73-WiFi'
};

// ============ 1억 AI 분산 시스템: 헬스체크 & 로드밸런서 ============

const MAX_CONNECTIONS = 10000; // 서버당 최대 연결 수
const serverHealth = new Map(); // 서버 상태 저장소

// 서버 헬스 데이터 구조
// { cpu: 30, mem: 40, connections: 100, alive: true, lastCheck: Date, score: 25 }

// 단일 서버 헬스체크 (NexusSSH Pro 연동)
async function getServerHealth(server) {
    const startTime = Date.now();

    // NexusSSH Pro 사용 가능하면 사용
    if (NexusSSH) {
        try {
            const serverKey = server.id + '-local'; // 내부 네트워크용 프리셋
            const ssh = new NexusSSH(serverKey);
            await ssh.connect();

            // NexusSSH의 모니터링 API 사용
            const [cpuResult, memResult] = await Promise.all([
                ssh.run("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
                ssh.run("free | grep Mem | awk '{printf \"%.0f\", $3/$2*100}'")
            ]);

            const cpu = parseFloat(cpuResult.stdout) || 0;
            const mem = parseFloat(memResult.stdout) || 0;
            const responseTime = Date.now() - startTime;
            const score = (cpu * 0.4) + (mem * 0.3);

            ssh.close();

            return {
                cpu: Math.round(cpu),
                mem: Math.round(mem),
                connections: 0,
                alive: true,
                responseTime,
                score: Math.round(score),
                lastCheck: new Date().toISOString(),
                via: 'NexusSSH'
            };
        } catch (e) {
            // NexusSSH 실패 시 fallback
        }
    }

    // Fallback: 기존 방식
    try {
        let stdout;
        // LANG=C로 로케일 강제 (한국어 환경에서도 영어 출력)
        const cmd = `LANG=C top -bn1 | grep 'Cpu(s)' | awk '{print $2}'; LANG=C free | grep Mem | awk '{printf "%.0f\\n", $3/$2*100}'; who | wc -l`;

        if (server.id === '73') {
            const result = await execPromise(cmd, { timeout: 3000 });
            stdout = result.stdout;
        } else {
            const sshPort = server.port || 22;
            const result = await execPromise(
                `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${server.user}@${server.host} "${cmd}" 2>/dev/null`,
                { timeout: 5000 }
            );
            stdout = result.stdout;
        }

        const lines = stdout.trim().split('\n');
        const cpu = parseFloat(lines[0]) || 0;
        const mem = parseFloat(lines[1]) || 0;
        const connections = parseInt(lines[2]) || 0;
        const responseTime = Date.now() - startTime;
        const score = (cpu * 0.4) + (mem * 0.3) + ((connections / MAX_CONNECTIONS) * 100 * 0.3);

        return {
            cpu: Math.round(cpu),
            mem: Math.round(mem),
            connections,
            alive: true,
            responseTime,
            score: Math.round(score),
            lastCheck: new Date().toISOString(),
            via: 'SSH'
        };
    } catch (e) {
        return {
            cpu: 0,
            mem: 0,
            connections: 0,
            alive: false,
            responseTime: Date.now() - startTime,
            score: 999,
            lastCheck: new Date().toISOString(),
            error: e.message
        };
    }
}

// 모든 서버 헬스체크 (병렬)
async function checkAllServers() {
    const checks = SERVERS.map(async (server) => {
        const health = await getServerHealth(server);
        const prevHealth = serverHealth.get(server.id);

        // 상태 변경 감지 (alive → dead 또는 dead → alive)
        if (prevHealth && prevHealth.alive !== health.alive) {
            if (!health.alive) {
                onServerDown(server.id);
            } else {
                onServerUp(server.id);
            }
        }

        serverHealth.set(server.id, health);
    });

    await Promise.all(checks);
}

// 서버 다운 시 처리
function onServerDown(serverId) {
    console.log(`[CLUSTER] Server ${serverId} DOWN!`);
    nexusLog.error('server_down', { serverId });

    // 푸시 알림
    sendPushNotification(
        '서버 다운',
        `${serverId} 서버가 응답하지 않습니다. 자동 페일오버 진행 중...`
    );

    // 해당 서버 세션에 페일오버 알림
    const alternative = selectBestServer([serverId]);
    broadcast('failover', {
        downServer: serverId,
        newServer: alternative,
        reason: 'server_down'
    });
}

// 서버 복구 시 처리
function onServerUp(serverId) {
    console.log(`[CLUSTER] Server ${serverId} UP!`);
    nexusLog.info('server_up', { serverId });

    sendPushNotification(
        '서버 복구',
        `${serverId} 서버가 다시 온라인 상태입니다.`
    );

    broadcast('server_up', { serverId });
}

// 최적 서버 선택 (로드밸런싱)
function selectBestServer(excludeIds = []) {
    const candidates = [...serverHealth.entries()]
        .filter(([id, h]) => h.alive && !excludeIds.includes(id) && h.cpu < 80)
        .sort((a, b) => a[1].score - b[1].score);

    if (candidates.length === 0) {
        // 모든 서버가 과부하면 그나마 살아있는 서버
        const alive = [...serverHealth.entries()]
            .filter(([id, h]) => h.alive && !excludeIds.includes(id));
        return alive[0]?.[0] || SERVERS[0].id;
    }

    return candidates[0][0];
}

// 클러스터 상태 요약
function getClusterStatus() {
    const servers = SERVERS.map(s => {
        const h = serverHealth.get(s.id) || { alive: false, cpu: 0, mem: 0, connections: 0, score: 999 };
        return { id: s.id, ...h };
    });

    const alive = servers.filter(s => s.alive).length;
    const total = servers.length;
    const avgCpu = Math.round(servers.reduce((a, s) => a + s.cpu, 0) / total);
    const avgMem = Math.round(servers.reduce((a, s) => a + s.mem, 0) / total);
    const best = selectBestServer();

    return {
        servers,
        summary: {
            alive,
            total,
            avgCpu,
            avgMem,
            best
        }
    };
}

// 1초마다 헬스체크 시작
setInterval(checkAllServers, 1000);
checkAllServers(); // 초기 체크

// 접속 방향 파싱 (예: 73→232, 외부→73)
function getConnectionDirection(sourceIP, targetServerId) {
    if (!sourceIP || sourceIP === 'local') {
        return `${targetServerId}(local)`;  // 로컬 세션
    }

    // localhost
    if (sourceIP === '127.0.0.1' || sourceIP === '::1') {
        return `${targetServerId}(local)`;
    }

    // 내부 IP 확인
    if (sourceIP.startsWith('192.168.45.')) {
        const sourceId = IP_TO_SERVER[sourceIP] || sourceIP.split('.')[3];
        return `${sourceId}→${targetServerId}`;
    }

    // 외부 접속
    return `외부→${targetServerId}`;
}

// ============ 프록시 API (인증 필요) ============

// 프록시 상태
app.get('/api/proxy/status', requireAuth, async (req, res) => {
    try {
        const results = [];
        for (const proxy of PROXIES) {
            let running = false;
            let pid = null;
            try {
                const { stdout } = await execPromise(`ss -tlnp | grep ":${proxy.port}" | head -1`);
                running = stdout.trim().length > 0;
                const pidMatch = stdout.match(/pid=(\d+)/);
                pid = pidMatch ? pidMatch[1] : null;
            } catch (e) {}

            // 외부 접속 테스트
            let externalOk = false;
            try {
                await execPromise(`timeout 2 nc -zv 123.212.111.26 ${proxy.port} 2>&1`);
                externalOk = true;
            } catch (e) {}

            results.push({
                ...proxy,
                running,
                pid,
                externalOk,
                status: running && externalOk ? 'ok' : running ? 'partial' : 'down'
            });
        }
        res.json({ proxies: results, externalIP: '123.212.111.26' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 프록시 시작
app.post('/api/proxy/:name/start', requireAuth, requireAdmin, async (req, res) => {
    try {
        const proxy = PROXIES.find(p => p.name === req.params.name);
        if (!proxy) return res.status(404).json({ error: 'Proxy not found' });

        // 타겟 주소 파싱
        let targetHost, targetPort;
        if (proxy.target.includes(':')) {
            [targetHost, targetPort] = proxy.target.split(':');
        } else {
            return res.status(400).json({ error: 'Invalid target for this proxy' });
        }

        await execPromise(`socat TCP-LISTEN:${proxy.port},fork,reuseaddr TCP:${targetHost}:${targetPort} &`);
        nexusLog.info('Proxy started', { name: proxy.name, port: proxy.port }, ['proxy']);
        res.json({ success: true, message: `${proxy.name} 시작됨` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 프록시 중지
app.post('/api/proxy/:name/stop', requireAuth, requireAdmin, async (req, res) => {
    try {
        const proxy = PROXIES.find(p => p.name === req.params.name);
        if (!proxy) return res.status(404).json({ error: 'Proxy not found' });

        const { stdout } = await execPromise(`ss -tlnp | grep ":${proxy.port}" | head -1`);
        const pidMatch = stdout.match(/pid=(\d+)/);
        if (pidMatch) {
            await execPromise(`kill ${pidMatch[1]}`);
            nexusLog.info('Proxy stopped', { name: proxy.name, port: proxy.port }, ['proxy']);
            res.json({ success: true, message: `${proxy.name} 중지됨` });
        } else {
            res.json({ success: false, message: '실행 중인 프로세스 없음' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SSH 키 API ============

// 키 목록

// ============ 로그 API ============

// 접속 로그 (모든 서버에서 수집)
app.get('/api/logs', requireAuth, async (req, res) => {
    try {
        const allLogs = [];

        // 로컬 서버 (73) 로그 - SSH만 (Accepted)
        try {
            const { stdout } = await execPromise(
                `grep "Accepted" /var/log/auth.log 2>/dev/null | tail -30 || echo ""`
            );
            stdout.split('\n').filter(l => l.trim()).forEach(line => {
                const parsed = parseAuthLog(line);
                if (parsed) {
                    const direction = getConnectionDirection(parsed.ip, '73');
                    allLogs.push({ ...parsed, server: direction });
                }
            });
        } catch (e) {}

        // 원격 서버들 로그 수집 - SSH만
        for (const server of SERVERS.filter(s => s.id !== '73')) {
            try {
                const sshPort = server.port || 22;
                const { stdout } = await execPromise(
                    `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${server.user}@${server.host} "grep 'Accepted' /var/log/auth.log 2>/dev/null | tail -15" 2>/dev/null || echo ""`
                );
                stdout.split('\n').filter(l => l.trim()).forEach(line => {
                    const parsed = parseAuthLog(line);
                    if (parsed) {
                        const direction = getConnectionDirection(parsed.ip, server.id);
                        allLogs.push({ ...parsed, server: direction });
                    }
                });
            } catch (e) {}
        }

        // 시간순 정렬
        allLogs.sort((a, b) => b.timestamp - a.timestamp);

        res.json({ logs: allLogs.slice(0, 30) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 로그 파싱 헬퍼 (ISO 형식 + syslog 형식 지원)
function parseAuthLog(line) {
    let time = '';
    let timestamp = 0;

    // ISO 형식: 2025-12-25T23:59:18
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (isoMatch) {
        const d = new Date(isoMatch[1]);
        timestamp = d.getTime();
        time = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    // Syslog 형식: Dec 26 00:01:10
    if (!time) {
        const syslogMatch = line.match(/^([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})/);
        if (syslogMatch) {
            const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
            const month = months[syslogMatch[1]];
            const day = parseInt(syslogMatch[2]);
            const hour = parseInt(syslogMatch[3]);
            const minute = parseInt(syslogMatch[4]);
            const d = new Date();
            d.setMonth(month);
            d.setDate(day);
            d.setHours(hour, minute, 0, 0);
            timestamp = d.getTime();
            time = `${month+1}/${day} ${hour}:${String(minute).padStart(2,'0')}`;
        }
    }

    const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
    const userMatch = line.match(/for\s+(\w+)/);

    if (!time) return null;

    return {
        time,
        timestamp,
        user: userMatch ? userMatch[1] : 'unknown',
        ip: ipMatch ? ipMatch[1] : 'local',
        type: line.includes('Accepted') ? 'login' : 'session'
    };
}

// 실패 로그 (모든 서버에서 수집)
app.get('/api/logs/failed', requireAuth, async (req, res) => {
    try {
        const allLogs = [];

        // 로컬 서버 (73) 로그
        try {
            const { stdout } = await execPromise(
                `grep "Failed password\\|Invalid user" /var/log/auth.log 2>/dev/null | tail -20 || echo ""`
            );
            stdout.split('\n').filter(l => l.trim()).forEach(line => {
                const parsed = parseFailedLog(line);
                if (parsed) {
                    const direction = getConnectionDirection(parsed.ip, '73');
                    allLogs.push({ ...parsed, server: direction });
                }
            });
        } catch (e) {}

        // 원격 서버들 로그 수집
        for (const server of SERVERS.filter(s => s.id !== '73')) {
            try {
                const sshPort = server.port || 22;
                const { stdout } = await execPromise(
                    `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${server.user}@${server.host} "grep 'Failed password\\|Invalid user' /var/log/auth.log 2>/dev/null | tail -10" 2>/dev/null || echo ""`
                );
                stdout.split('\n').filter(l => l.trim()).forEach(line => {
                    const parsed = parseFailedLog(line);
                    if (parsed) {
                        const direction = getConnectionDirection(parsed.ip, server.id);
                        allLogs.push({ ...parsed, server: direction });
                    }
                });
            } catch (e) {}
        }

        // 시간순 정렬
        allLogs.sort((a, b) => b.timestamp - a.timestamp);

        res.json({ logs: allLogs.slice(0, 30) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 실패 로그 파싱 헬퍼 (ISO 형식 + syslog 형식 지원)
function parseFailedLog(line) {
    let time = '';
    let timestamp = 0;

    // ISO 형식
    const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (isoMatch) {
        const d = new Date(isoMatch[1]);
        timestamp = d.getTime();
        time = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    // Syslog 형식
    if (!time) {
        const syslogMatch = line.match(/^([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})/);
        if (syslogMatch) {
            const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
            const month = months[syslogMatch[1]];
            const day = parseInt(syslogMatch[2]);
            const hour = parseInt(syslogMatch[3]);
            const minute = parseInt(syslogMatch[4]);
            const d = new Date();
            d.setMonth(month);
            d.setDate(day);
            d.setHours(hour, minute, 0, 0);
            timestamp = d.getTime();
            time = `${month+1}/${day} ${hour}:${String(minute).padStart(2,'0')}`;
        }
    }

    const ipMatch = line.match(/(\d+\.\d+\.\d+\.\d+)/);
    const userMatch = line.match(/(?:for|user)\s+(\w+)/);

    if (!time) return null;

    return {
        time,
        timestamp,
        user: userMatch ? userMatch[1] : 'unknown',
        ip: ipMatch ? ipMatch[1] : 'unknown',
        type: line.includes('Invalid user') ? 'invalid_user' : 'failed_password'
    };
}

// ============ 서버 API ============

app.get('/api/servers', requireAuth, async (req, res) => {
    try {
        const results = [];
        for (const server of SERVERS) {
            let sshOk = false;
            const sshPort = server.port || 22;
            try {
                await execPromise(`timeout 2 nc -zv ${server.host} ${sshPort} 2>&1`);
                sshOk = true;
            } catch (e) {}
            results.push({ ...server, sshOk });
        }
        res.json({ servers: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ Fail2ban API ============

app.get('/api/fail2ban', requireAuth, async (req, res) => {
    try {
        const { stdout: status } = await execPromise('sudo fail2ban-client status sshd 2>/dev/null || echo ""');

        const bannedMatch = status.match(/Currently banned:\s*(\d+)/);
        const totalMatch = status.match(/Total banned:\s*(\d+)/);
        const ipsMatch = status.match(/Banned IP list:\s*(.+)/);

        res.json({
            currentlyBanned: bannedMatch ? parseInt(bannedMatch[1]) : 0,
            totalBanned: totalMatch ? parseInt(totalMatch[1]) : 0,
            bannedIPs: ipsMatch ? ipsMatch[1].trim().split(' ').filter(ip => ip) : []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// IP 차단 해제
app.post('/api/fail2ban/unban/:ip', requireAuth, requireAdmin, async (req, res) => {
    try {
        await execPromise(`sudo fail2ban-client set sshd unbanip ${req.params.ip}`);
        nexusLog.info('IP unbanned', { ip: req.params.ip }, ['fail2ban']);
        res.json({ success: true, message: `${req.params.ip} 차단 해제됨` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ 활성 세션 API ============

app.get('/api/sessions', requireAuth, async (req, res) => {
    try {
        const allSessions = [];

        // 로컬 서버 (73) 세션
        try {
            const { stdout } = await execPromise(`who -u 2>/dev/null || echo ""`);
            stdout.split('\n').filter(l => l.trim()).forEach(line => {
                const parts = line.split(/\s+/);
                if (parts.length >= 5) {
                    allSessions.push({
                        server: '73',
                        user: parts[0],
                        tty: parts[1],
                        loginTime: `${parts[2]} ${parts[3]}`,
                        pid: parts[4],
                        from: parts[5] ? parts[5].replace(/[()]/g, '') : 'local'
                    });
                }
            });
        } catch (e) {}

        // 원격 서버들
        for (const srv of SERVERS.filter(s => s.id !== '73')) {
            try {
                const sshPort = srv.port || 22;
                const { stdout } = await execPromise(
                    `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${srv.user}@${srv.host} "who -u 2>/dev/null" 2>/dev/null || echo ""`
                );
                stdout.split('\n').filter(l => l.trim()).forEach(line => {
                    const parts = line.split(/\s+/);
                    if (parts.length >= 5) {
                        allSessions.push({
                            server: srv.id,
                            user: parts[0],
                            tty: parts[1],
                            loginTime: `${parts[2]} ${parts[3]}`,
                            pid: parts[4],
                            from: parts[5] ? parts[5].replace(/[()]/g, '') : 'local'
                        });
                    }
                });
            } catch (e) {}
        }

        res.json({ sessions: allSessions, total: allSessions.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 세션 강제 종료
app.post('/api/sessions/kill', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { server, pid } = req.body;
        if (server === '73') {
            await execPromise(`kill -9 ${pid}`);
        } else {
            const srv = SERVERS.find(s => s.id === server);
            if (srv) {
                const sshPort = srv.port || 22;
                await execPromise(`ssh -p ${sshPort} -o ConnectTimeout=2 ${srv.user}@${srv.host} "kill -9 ${pid}" 2>/dev/null`);
            }
        }
        nexusLog.info('Session killed', { server, pid }, ['sessions']);
        res.json({ success: true, message: '세션 종료됨' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ 통계 API ============

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const stats = { daily: {}, hourly: {}, byUser: {}, byServer: {}, bySource: {}, external: 0, internal: 0 };

        // 로컬 서버 (73) 로그
        try {
            const { stdout } = await execPromise(
                `grep "Accepted" /var/log/auth.log 2>/dev/null | tail -200 || echo ""`
            );
            processStatsLogs(stdout, '73', stats);
        } catch (e) {}

        // 원격 서버들 로그
        for (const server of SERVERS.filter(s => s.id !== '73')) {
            try {
                const sshPort = server.port || 22;
                const { stdout } = await execPromise(
                    `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${server.user}@${server.host} "grep 'Accepted' /var/log/auth.log 2>/dev/null | tail -100" 2>/dev/null || echo ""`
                );
                processStatsLogs(stdout, server.id, stats);
            } catch (e) {}
        }

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 통계 로그 처리 헬퍼
function processStatsLogs(stdout, serverId, stats) {
    stdout.split('\n').filter(l => l.trim()).forEach(line => {
        const parsed = parseAuthLog(line);
        if (!parsed) return;

        // 2시간 단위 (예: "12/26 08", "12/26 10")
        const timeParts = parsed.time.split(' ');
        if (timeParts.length >= 2) {
            const date = timeParts[0];
            const hour = parseInt(timeParts[1].split(':')[0]);
            const slot = Math.floor(hour / 2) * 2;  // 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22
            const slotKey = `${date} ${String(slot).padStart(2,'0')}:00`;
            stats.hourly[slotKey] = (stats.hourly[slotKey] || 0) + 1;
        }

        // 날짜별 (유지)
        const dateKey = timeParts[0];
        stats.daily[dateKey] = (stats.daily[dateKey] || 0) + 1;

        // 사용자별
        stats.byUser[parsed.user] = (stats.byUser[parsed.user] || 0) + 1;

        // 서버별
        stats.byServer[serverId] = (stats.byServer[serverId] || 0) + 1;

        // 소스별
        if (parsed.ip && parsed.ip !== 'local') {
            if (parsed.ip.startsWith('192.168.')) {
                stats.internal++;
                const sourceId = IP_TO_SERVER[parsed.ip] || parsed.ip;
                stats.bySource[sourceId] = (stats.bySource[sourceId] || 0) + 1;
            } else {
                stats.external++;
                stats.bySource['외부'] = (stats.bySource['외부'] || 0) + 1;
            }
        }
    });
}

// ============ 로그 필터/검색/CSV API ============

app.get('/api/logs/search', requireAuth, async (req, res) => {
    try {
        const { user, server, startDate, endDate, type, limit = 100 } = req.query;
        let allLogs = [];

        // 로그 수집
        const { stdout } = await execPromise(
            `grep "Accepted\\|Failed password\\|Invalid user" /var/log/auth.log 2>/dev/null | tail -500 || echo ""`
        );

        stdout.split('\n').filter(l => l.trim()).forEach(line => {
            const isAccepted = line.includes('Accepted');
            const parsed = isAccepted ? parseAuthLog(line) : parseFailedLog(line);
            if (!parsed) return;

            const direction = getConnectionDirection(parsed.ip, '73');
            allLogs.push({ ...parsed, server: direction, logType: isAccepted ? 'success' : 'failed' });
        });

        // 필터 적용
        if (user) allLogs = allLogs.filter(l => l.user.includes(user));
        if (server) allLogs = allLogs.filter(l => l.server.includes(server));
        if (type === 'success') allLogs = allLogs.filter(l => l.logType === 'success');
        if (type === 'failed') allLogs = allLogs.filter(l => l.logType === 'failed');

        // 정렬 및 제한
        allLogs.sort((a, b) => b.timestamp - a.timestamp);
        allLogs = allLogs.slice(0, parseInt(limit));

        res.json({ logs: allLogs, total: allLogs.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CSV 내보내기
app.get('/api/logs/export', requireAuth, async (req, res) => {
    try {
        const { stdout } = await execPromise(
            `grep "Accepted" /var/log/auth.log 2>/dev/null | tail -200 || echo ""`
        );

        let csv = 'Time,User,IP,Server,Type\n';
        stdout.split('\n').filter(l => l.trim()).forEach(line => {
            const parsed = parseAuthLog(line);
            if (parsed) {
                const direction = getConnectionDirection(parsed.ip, '73');
                csv += `"${parsed.time}","${parsed.user}","${parsed.ip}","${direction}","login"\n`;
            }
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=ssh-logs-${Date.now()}.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ 실시간 로그 모니터링 ============

let logWatcher = null;
let lastLogLine = '';

function startLogWatcher() {
    if (logWatcher) return;

    logWatcher = spawn('tail', ['-F', '/var/log/auth.log']);

    logWatcher.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
            if (line === lastLogLine) return;
            lastLogLine = line;

            // SSH 로그인만 처리
            if (line.includes('Accepted')) {
                const parsed = parseAuthLog(line);
                if (parsed) {
                    const direction = getConnectionDirection(parsed.ip, '73');
                    const logData = { ...parsed, server: direction };

                    // 외부 접속이면 알림
                    if (direction.startsWith('외부')) {
                        broadcast('external_access', logData);
                    }

                    broadcast('new_login', logData);
                }
            }

            // 실패 시도
            if (line.includes('Failed password') || line.includes('Invalid user')) {
                const parsed = parseFailedLog(line);
                if (parsed) {
                    const direction = getConnectionDirection(parsed.ip, '73');
                    broadcast('failed_attempt', { ...parsed, server: direction });
                }
            }
        });
    });

    logWatcher.on('error', (err) => {
        console.error('Log watcher error:', err);
    });
}

// ============ 푸시 알림 API ============

// VAPID 공개키 조회
app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: VAPID_KEYS.publicKey });
});

// 푸시 구독 등록
app.post('/api/push/subscribe', async (req, res) => {
    const subscription = req.body;
    if (!pushSubscriptions.find(s => s.endpoint === subscription.endpoint)) {
        pushSubscriptions.push(subscription);
        await saveSubscriptions();
    }
    res.json({ success: true, count: pushSubscriptions.length });
});

// 푸시 구독 해제
app.post('/api/push/unsubscribe', async (req, res) => {
    const { endpoint } = req.body;
    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
    await saveSubscriptions();
    res.json({ success: true });
});

// 테스트 푸시 전송
app.post('/api/push/test', async (req, res) => {
    const results = await sendPushNotification('SSH Hub 테스트', '푸시 알림이 정상 작동합니다!');
    res.json({ success: true, results });
});

// ============ 텍스트 로그 API ============

// 로그 기록 함수
async function logAccess(server, user, ip, action = 'login') {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const logLine = `[${timestamp}] ${action.toUpperCase()} | Server: ${server} | User: ${user} | IP: ${ip}\n`;
    try {
        await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
        await fs.appendFile(LOG_FILE, logLine);
        broadcast('access-log', { timestamp, server, user, ip, action });

        // 외부 접속 시 푸시 알림
        if (!ip.startsWith('192.168.') && ip !== '127.0.0.1') {
            sendPushNotification(
                `🚨 외부 SSH 접속`,
                `Server: ${server} | User: ${user} | IP: ${ip}`,
                { server, user, ip, action }
            );
        }
    } catch (e) {
        console.error('Log write error:', e);
    }
}

// 접속 로그 기록 API
app.post('/api/log/access', async (req, res) => {
    const { server, user, ip, action } = req.body;
    await logAccess(server || 'unknown', user || 'unknown', ip || req.ip, action || 'login');
    res.json({ success: true });
});

// 텍스트 로그 조회 API
app.get('/api/log/access', async (req, res) => {
    try {
        const data = await fs.readFile(LOG_FILE, 'utf8');
        const lines = data.trim().split('\n').slice(-100); // 최근 100개
        res.json({ logs: lines });
    } catch (e) {
        res.json({ logs: [] });
    }
});

// 텍스트 로그 파일 직접 보기
app.get('/api/log/access.txt', async (req, res) => {
    try {
        const data = await fs.readFile(LOG_FILE, 'utf8');
        res.type('text/plain').send(data);
    } catch (e) {
        res.type('text/plain').send('No logs yet.');
    }
});

// ============ SSH CA API ============

// CA 초기화 (없으면 생성)
async function initSSHCA() {
    try {
        await fs.access(CA_KEY);
    } catch (e) {
        // CA 키 생성
        await fs.mkdir(path.dirname(CA_KEY), { recursive: true });
        await execPromise(`ssh-keygen -t ed25519 -f ${CA_KEY} -C "SSH Hub CA" -N ""`);
        nexusLog.info('SSH CA created', {}, ['ca']);
    }
}
initSSHCA();

// CA 공개키 조회
app.get('/api/ca/public-key', async (req, res) => {
    try {
        const pubKey = await fs.readFile(CA_PUB, 'utf8');
        res.json({ publicKey: pubKey.trim() });
    } catch (e) {
        res.status(500).json({ error: 'CA not initialized' });
    }
});

// 인증서 발급 (인증 필요)
app.post('/api/ca/sign', requireAuth, async (req, res) => {
    const { publicKey, principal, validity = '+8h' } = req.body;

    if (!publicKey || !principal) {
        return res.status(400).json({ error: 'publicKey and principal required' });
    }

    try {
        const certId = `${req.user.email}_${Date.now()}`;
        const tempPubFile = `/tmp/ssh-hub-${uuidv4()}.pub`;
        const tempCertFile = tempPubFile.replace('.pub', '-cert.pub');

        // 공개키 저장
        await fs.writeFile(tempPubFile, publicKey);

        // 인증서 서명
        await execPromise(`ssh-keygen -s ${CA_KEY} -I "${certId}" -n ${principal} -V ${validity} ${tempPubFile}`);

        // 인증서 읽기
        const certificate = await fs.readFile(tempCertFile, 'utf8');

        // 임시 파일 삭제
        await fs.unlink(tempPubFile).catch(() => {});
        await fs.unlink(tempCertFile).catch(() => {});

        // 발급 로그
        nexusLog.info('Certificate issued', { user: req.user.email, principal, validity }, ['ca']);

        res.json({
            success: true,
            certificate: certificate.trim(),
            certId,
            expiresIn: validity
        });
    } catch (err) {
        console.error('Certificate signing error:', err);
        res.status(500).json({ error: 'Failed to sign certificate' });
    }
});

// ============ 세션 녹화 API ============

// 세션 목록
app.get('/api/recordings', requireAuth, async (req, res) => {
    try {
        await fs.mkdir(SESSIONS_DIR, { recursive: true });
        const files = await fs.readdir(SESSIONS_DIR);
        const sessions = [];

        for (const file of files) {
            if (file.endsWith('.cast')) {
                const stat = await fs.stat(path.join(SESSIONS_DIR, file));
                const parts = file.replace('.cast', '').split('_');
                sessions.push({
                    id: file.replace('.cast', ''),
                    filename: file,
                    date: parts[0] || '',
                    time: parts[1] || '',
                    user: parts[2] || '',
                    server: parts[3] || '',
                    size: stat.size,
                    created: stat.birthtime
                });
            }
        }

        sessions.sort((a, b) => b.created - a.created);
        res.json({ sessions });
    } catch (e) {
        res.json({ sessions: [] });
    }
});

// 세션 재생 데이터
app.get('/api/recordings/:id', requireAuth, async (req, res) => {
    try {
        const file = path.join(SESSIONS_DIR, req.params.id + '.cast');
        const data = await fs.readFile(file, 'utf8');
        res.type('application/json').send(data);
    } catch (e) {
        res.status(404).json({ error: 'Recording not found' });
    }
});

// 세션 다운로드
app.get('/api/recordings/:id/download', requireAuth, async (req, res) => {
    try {
        const file = path.join(SESSIONS_DIR, req.params.id + '.cast');
        res.download(file);
    } catch (e) {
        res.status(404).json({ error: 'Recording not found' });
    }
});

// ============ 웹 터미널 API ============

// 터미널 WebSocket 연결
const terminalSessions = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // 일반 WebSocket은 기존 로직
    if (!url.pathname.startsWith('/terminal/')) {
        wsClients.add(ws);
        ws.on('close', () => wsClients.delete(ws));
        return;
    }

    // 터미널 WebSocket
    const serverName = url.pathname.split('/')[2];
    const proxy = PROXIES.find(p => p.name === serverName);

    if (!proxy) {
        ws.send(JSON.stringify({ type: 'error', message: 'Server not found' }));
        ws.close();
        return;
    }

    // SSH 연결
    const sshClient = new SSHClient();
    const sessionId = `${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${Date.now()}_terminal_${serverName}`;
    const recordingFile = path.join(SESSIONS_DIR, sessionId + '.cast');
    const startTime = Date.now();
    let recordingStream = null;

    // asciicast 헤더
    const castHeader = JSON.stringify({
        version: 2,
        width: 120,
        height: 40,
        timestamp: Math.floor(startTime / 1000),
        env: { TERM: 'xterm-256color', SHELL: '/bin/bash' }
    }) + '\n';

    fs.mkdir(SESSIONS_DIR, { recursive: true }).then(() => {
        fs.writeFile(recordingFile, castHeader);
    });

    sshClient.on('ready', () => {
        sshClient.shell({
            term: 'xterm-256color',
            cols: 120,
            rows: 40,
            env: {
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            }
        }, (err, stream) => {
            if (err) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }));
                return;
            }

            ws.send(JSON.stringify({ type: 'connected', sessionId }));
            terminalSessions.set(sessionId, { ws, sshClient, stream });

            stream.on('data', async (data) => {
                const elapsed = (Date.now() - startTime) / 1000;
                const output = data.toString('base64');

                // WebSocket으로 전송
                ws.send(JSON.stringify({ type: 'output', data: output }));

                // 녹화 (asciicast v2)
                const line = JSON.stringify([elapsed, 'o', data.toString()]) + '\n';
                await fs.appendFile(recordingFile, line).catch(() => {});
            });

            stream.on('close', () => {
                ws.send(JSON.stringify({ type: 'disconnected' }));
                ws.close();
                terminalSessions.delete(sessionId);
            });

            ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg);
                    if (data.type === 'input') {
                        stream.write(Buffer.from(data.data, 'base64'));
                    } else if (data.type === 'resize') {
                        stream.setWindow(data.rows, data.cols, 0, 0);
                    }
                } catch (e) {}
            });
        });
    });

    sshClient.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close();
    });

    ws.on('close', () => {
        sshClient.end();
        terminalSessions.delete(sessionId);
    });

    // SSH 연결 시작
    const [targetHost, targetPort] = proxy.target.includes(':') ? proxy.target.split(':') : [proxy.target, '22'];
    sshClient.connect({
        host: targetHost,
        port: parseInt(targetPort),
        username: proxy.user,
        privateKey: require('fs').readFileSync('/home/kim/.ssh/id_ed25519')
    });
});

// ============ JIT 승인 API ============

// JIT 요청 데이터 로드
async function loadJITRequests() {
    try {
        const data = await fs.readFile(JIT_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { requests: [] };
    }
}

async function saveJITRequests(data) {
    await fs.mkdir(path.dirname(JIT_FILE), { recursive: true });
    await fs.writeFile(JIT_FILE, JSON.stringify(data, null, 2));
}

// 접속 요청 생성
app.post('/api/jit/request', requireAuth, async (req, res) => {
    const { server, duration = 14400, reason = '' } = req.body; // 기본 4시간

    if (!server) {
        return res.status(400).json({ error: 'server required' });
    }

    const data = await loadJITRequests();
    const request = {
        id: uuidv4(),
        user: req.user.email,
        userId: req.user.sub,
        server,
        reason,
        duration,
        requestedAt: new Date().toISOString(),
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        expiresAt: null
    };

    data.requests.push(request);
    await saveJITRequests(data);

    // 관리자에게 푸시 알림
    sendPushNotification(
        '🔐 SSH 접속 요청',
        `${req.user.name || req.user.email}님이 ${server} 접속을 요청했습니다.`,
        { type: 'jit_request', requestId: request.id }
    );

    nexusLog.info('JIT request created', { user: req.user.email, server }, ['jit']);
    res.json({ success: true, request });
});

// 대기중 요청 목록
app.get('/api/jit/pending', requireAuth, async (req, res) => {
    const data = await loadJITRequests();

    // 만료된 요청 상태 업데이트
    const now = new Date();
    data.requests.forEach(r => {
        if (r.status === 'approved' && r.expiresAt && new Date(r.expiresAt) < now) {
            r.status = 'expired';
        }
    });
    await saveJITRequests(data);

    // 관리자는 모든 요청, 일반 사용자는 자신의 요청만
    let requests = data.requests;
    if (req.user.role !== 'admin') {
        requests = requests.filter(r => r.userId === req.user.sub);
    }

    res.json({ requests: requests.filter(r => r.status === 'pending') });
});

// 전체 요청 히스토리
app.get('/api/jit/history', requireAuth, async (req, res) => {
    const data = await loadJITRequests();
    let requests = data.requests;

    if (req.user.role !== 'admin') {
        requests = requests.filter(r => r.userId === req.user.sub);
    }

    res.json({ requests: requests.slice(-50).reverse() });
});

// 승인
app.post('/api/jit/:id/approve', requireAuth, requireAdmin, async (req, res) => {
    const data = await loadJITRequests();
    const request = data.requests.find(r => r.id === req.params.id);

    if (!request) {
        return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request already processed' });
    }

    request.status = 'approved';
    request.approvedBy = req.user.email;
    request.approvedAt = new Date().toISOString();
    request.expiresAt = new Date(Date.now() + request.duration * 1000).toISOString();

    await saveJITRequests(data);

    // 요청자에게 알림
    sendPushNotification(
        '✅ 접속 승인됨',
        `${request.server} 접속이 승인되었습니다. ${Math.floor(request.duration / 3600)}시간 동안 유효합니다.`,
        { type: 'jit_approved', requestId: request.id }
    );

    nexusLog.info('JIT request approved', { requestId: request.id, approvedBy: req.user.email }, ['jit']);
    res.json({ success: true, request });
});

// 거부
app.post('/api/jit/:id/deny', requireAuth, requireAdmin, async (req, res) => {
    const data = await loadJITRequests();
    const request = data.requests.find(r => r.id === req.params.id);

    if (!request) {
        return res.status(404).json({ error: 'Request not found' });
    }

    if (request.status !== 'pending') {
        return res.status(400).json({ error: 'Request already processed' });
    }

    request.status = 'denied';
    request.approvedBy = req.user.email;
    request.approvedAt = new Date().toISOString();

    await saveJITRequests(data);

    // 요청자에게 알림
    sendPushNotification(
        '❌ 접속 거부됨',
        `${request.server} 접속 요청이 거부되었습니다.`,
        { type: 'jit_denied', requestId: request.id }
    );

    nexusLog.info('JIT request denied', { requestId: request.id, deniedBy: req.user.email }, ['jit']);
    res.json({ success: true, request });
});

// 현재 유효한 접속 권한 확인
app.get('/api/jit/access/:server', requireAuth, async (req, res) => {
    const data = await loadJITRequests();
    const now = new Date();

    const hasAccess = data.requests.some(r =>
        r.userId === req.user.sub &&
        r.server === req.params.server &&
        r.status === 'approved' &&
        r.expiresAt &&
        new Date(r.expiresAt) > now
    );

    // 관리자는 항상 접속 가능
    const isAdmin = req.user.role === 'admin';

    res.json({ hasAccess: hasAccess || isAdmin, isAdmin });
});

// ============ 클러스터 관리 API ============

// 클러스터 전체 상태
app.get('/api/cluster/status', requireAuth, (req, res) => {
    res.json(getClusterStatus());
});

// 헬스체크 결과만
app.get('/api/cluster/health', requireAuth, (req, res) => {
    const health = {};
    serverHealth.forEach((v, k) => { health[k] = v; });
    res.json(health);
});

// 최적 서버 추천
app.get('/api/cluster/best', requireAuth, (req, res) => {
    const best = selectBestServer();
    const health = serverHealth.get(best);
    res.json({ server: best, health });
});

// 서버 동적 추가
app.post('/api/cluster/add', requireAuth, (req, res) => {
    const { id, host, port, user } = req.body;

    if (!id || !host || !user) {
        return res.status(400).json({ error: 'id, host, user required' });
    }

    // 중복 체크
    if (SERVERS.find(s => s.id === id)) {
        return res.status(400).json({ error: 'Server ID already exists' });
    }

    SERVERS.push({ id, name: `Server-${id}`, host, port: port || 22, user });
    nexusLog.info('server_added', { id, host, user });

    res.json({ success: true, total: SERVERS.length });
});

// 서버 동적 제거
app.delete('/api/cluster/remove/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const idx = SERVERS.findIndex(s => s.id === id);

    if (idx < 0) {
        return res.status(404).json({ error: 'Server not found' });
    }

    SERVERS.splice(idx, 1);
    serverHealth.delete(id);
    nexusLog.info('server_removed', { id });

    res.json({ success: true, remaining: SERVERS.length });
});

// ============ 스토리지 관리 API ============

// 서버에서 명령 실행 (NexusSSH 우선, Fallback SSH)
async function runOnServer(server, cmd) {
    const startTime = Date.now();

    // NexusSSH 사용 가능하면 사용
    if (NexusSSH) {
        try {
            const serverKey = server.id + '-local';
            const ssh = new NexusSSH(serverKey);
            await ssh.connect();
            const result = await ssh.run(cmd);
            ssh.close();
            return { stdout: result.stdout, duration: Date.now() - startTime, via: 'NexusSSH' };
        } catch (e) {
            // Fallback
        }
    }

    // Fallback: SSH exec 또는 로컬 실행
    try {
        if (server.id === '73') {
            const result = await execPromise(cmd, { timeout: 30000 });
            return { stdout: result.stdout, duration: Date.now() - startTime, via: 'local' };
        } else {
            const sshPort = server.port || 22;
            const result = await execPromise(
                `ssh -p ${sshPort} -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${server.user}@${server.host} "${cmd}" 2>/dev/null`,
                { timeout: 30000 }
            );
            return { stdout: result.stdout, duration: Date.now() - startTime, via: 'SSH' };
        }
    } catch (e) {
        return { stdout: '', error: e.message, duration: Date.now() - startTime };
    }
}

// 3서버 병렬 실행
async function runOnAllServers(cmd) {
    return Promise.all(SERVERS.map(async (server) => {
        const result = await runOnServer(server, cmd);
        return { server: server.id, ...result };
    }));
}

// 디스크 사용량 파싱
function parseDiskOutput(output) {
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.map(line => {
        const parts = line.split(/\s+/);
        return {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            avail: parts[3],
            percent: parseInt(parts[4]) || 0,
            mount: parts[5]
        };
    });
}

// 1. 디스크 모니터 - 3서버 전체
app.get('/api/storage/disk', requireAuth, async (req, res) => {
    try {
        const cmd = "LANG=C df -h / /home /tmp 2>/dev/null | tail -n +2";
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => ({
            id: r.server,
            disks: r.stdout ? parseDiskOutput(r.stdout) : [],
            via: r.via,
            error: r.error
        }));

        res.json({
            servers,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. 최근 변경 파일
app.get('/api/storage/files/recent', requireAuth, async (req, res) => {
    try {
        const minutes = parseInt(req.query.minutes) || 60;
        const path = req.query.path || '/home';
        const cmd = `find ${path} -mmin -${minutes} -type f 2>/dev/null | head -50`;
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => ({
            id: r.server,
            files: r.stdout ? r.stdout.trim().split('\n').filter(Boolean) : [],
            count: r.stdout ? r.stdout.trim().split('\n').filter(Boolean).length : 0,
            error: r.error
        }));

        res.json({
            servers,
            minutes,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. 대용량 파일
app.get('/api/storage/files/big', requireAuth, async (req, res) => {
    try {
        const size = req.query.size || '100M';
        const path = req.query.path || '/home';
        const cmd = `find ${path} -size +${size} -type f -exec ls -lh {} \\; 2>/dev/null | head -20`;
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => {
            const files = r.stdout ? r.stdout.trim().split('\n').filter(Boolean).map(line => {
                const parts = line.split(/\s+/);
                return {
                    size: parts[4],
                    path: parts[8] || parts[parts.length - 1]
                };
            }) : [];
            return { id: r.server, files, count: files.length, error: r.error };
        });

        res.json({ servers, minSize: size, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. 시스템 에러 로그
app.get('/api/storage/logs/errors', requireAuth, async (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 1;
        const cmd = `journalctl -p err --since '${hours} hour ago' --no-pager -n 30 2>/dev/null || tail -50 /var/log/syslog 2>/dev/null | grep -i error`;
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => ({
            id: r.server,
            logs: r.stdout ? r.stdout.trim().split('\n').filter(Boolean) : [],
            count: r.stdout ? r.stdout.trim().split('\n').filter(Boolean).length : 0,
            error: r.error
        }));

        res.json({ servers, hours, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. 인증 로그 (SSH 실패)
app.get('/api/storage/logs/auth', requireAuth, async (req, res) => {
    try {
        const cmd = "grep 'Failed password\\|Invalid user' /var/log/auth.log 2>/dev/null | tail -30";
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => ({
            id: r.server,
            failures: r.stdout ? r.stdout.trim().split('\n').filter(Boolean) : [],
            count: r.stdout ? r.stdout.trim().split('\n').filter(Boolean).length : 0,
            error: r.error
        }));

        res.json({ servers, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. NFS/동기화 상태
app.get('/api/storage/sync/status', requireAuth, async (req, res) => {
    try {
        const nfsCmd = "mount | grep nfs || echo 'No NFS mounts'";
        const results = await runOnAllServers(nfsCmd);

        const servers = results.map(r => ({
            id: r.server,
            nfs: r.stdout ? r.stdout.trim().split('\n').filter(Boolean) : [],
            hasNfs: r.stdout && !r.stdout.includes('No NFS'),
            error: r.error
        }));

        res.json({ servers, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 7. 좀비 프로세스
app.get('/api/storage/process/zombie', requireAuth, async (req, res) => {
    try {
        const cmd = "ps aux | grep -w Z | grep -v grep || echo 'No zombie processes'";
        const results = await runOnAllServers(cmd);

        const servers = results.map(r => ({
            id: r.server,
            zombies: r.stdout && !r.stdout.includes('No zombie') ? r.stdout.trim().split('\n').filter(Boolean) : [],
            count: r.stdout && !r.stdout.includes('No zombie') ? r.stdout.trim().split('\n').filter(Boolean).length : 0,
            error: r.error
        }));

        res.json({ servers, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 8. AI용 스토리지 상태 (토큰 최소)
app.get('/api/ai/storage', requireAuth, async (req, res) => {
    try {
        const diskCmd = "LANG=C df -h / 2>/dev/null | tail -1 | tr -s ' ' | cut -d' ' -f5";
        const fileCmd = "find /home -mmin -60 -type f 2>/dev/null | wc -l";
        const errCmd = "journalctl -p err --since '1 hour ago' --no-pager 2>/dev/null | wc -l";

        const [diskResults, fileResults, errResults] = await Promise.all([
            runOnAllServers(diskCmd),
            runOnAllServers(fileCmd),
            runOnAllServers(errCmd)
        ]);

        const diskStr = diskResults.map(r => `${r.server}:${r.stdout?.trim() || '?'}`).join(',');
        const newFiles = fileResults.reduce((sum, r) => sum + (parseInt(r.stdout) || 0), 0);
        const errors = errResults.reduce((sum, r) => sum + (parseInt(r.stdout) || 0), 0);

        res.type('text/plain').send(`${diskStr}|new:${newFiles}|err:${errors}`);
    } catch (e) {
        res.type('text/plain').send(`error:${e.message}`);
    }
});

// AI용 클러스터 상태 (토큰 최소)
app.get('/api/ai/cluster', requireAuth, (req, res) => {
    const status = getClusterStatus();
    const s = status.summary;
    const serverStates = status.servers.map(srv =>
        `${srv.id}:${srv.alive ? 'OK' : 'DOWN'}(${srv.cpu}%)`
    ).join(' ');

    res.type('text/plain').send(
        `${s.alive}/${s.total}srv avg:${s.avgCpu}% best:${s.best}\n${serverStates}`
    );
});

// ============ AI 모드 API (토큰 효율적) ============

// AI 가이드 - 읽으면 바로 사용 가능
app.get('/api/ai/guide', (req, res) => {
    res.type('text/plain').send(`# SSH Hub 빠른 가이드

## 서버 접속
ssh73     # 73 서버 (kim)
ssh232    # 232 서버 (kim)
ssh253    # 253 서버 (kimjin)

## 원격 실행 (접속 없이)
exec73 "pm2 list"
exec232 "docker ps"
exec253 "df -h"

## API (토큰 최소)
curl -s ssh.dclub.kr/api/ai/status -H "X-API-Key: dclub-api-key-2025-secure"
curl -s "ssh.dclub.kr/api/ai/exec?server=232&cmd=hostname" -H "X-API-Key: dclub-api-key-2025-secure"
curl -s ssh.dclub.kr/api/ai/quick/pm2 -H "X-API-Key: dclub-api-key-2025-secure"
curl -s ssh.dclub.kr/api/ai/quick/disk -H "X-API-Key: dclub-api-key-2025-secure"

## Quick 명령어
pm2, docker, disk, mem, cpu, load

## alias 설치 (한 번만)
curl -s ssh.dclub.kr/api/ai/install | bash
`);
});

// AI alias 설치 스크립트
app.get('/api/ai/install', (req, res) => {
    res.type('text/plain').send(`#!/bin/bash
# SSH Hub alias 설치

cat >> ~/.bashrc << 'SSHEOF'

# === SSH Hub Aliases ===
alias ssh73='ssh -p 2222 kim@192.168.45.73'
alias ssh232='ssh -p 2222 kim@192.168.45.232'
alias ssh253='ssh kimjin@192.168.45.253'

exec73() { ssh -p 2222 kim@192.168.45.73 "$@"; }
exec232() { ssh -p 2222 kim@192.168.45.232 "$@"; }
exec253() { ssh kimjin@192.168.45.253 "$@"; }

sshub() {
  curl -s "https://ssh.dclub.kr/api/ai/$1" -H "X-API-Key: dclub-api-key-2025-secure"
}
# === End SSH Hub ===
SSHEOF

source ~/.bashrc
echo "SSH Hub aliases installed! Commands: ssh73, ssh232, ssh253, exec73, exec232, exec253, sshub"
`);
});

// AI 상태 - 한 줄로 전체 서버 상태
app.get('/api/ai/status', requireAuth, async (req, res) => {
    try {
        const results = [];
        for (const server of SERVERS) {
            const sshPort = server.port || 22;
            let status = 'DOWN';
            let info = '';

            try {
                let stdout;
                // 73 서버는 로컬이므로 직접 실행
                if (server.id === '73') {
                    const result = await execPromise(
                        `uptime -p 2>/dev/null | cut -d' ' -f2-4; df -h / 2>/dev/null | tail -1 | awk '{print $5}'`,
                        { timeout: 3000 }
                    );
                    stdout = result.stdout;
                } else {
                    // 원격 서버는 SSH
                    const result = await execPromise(
                        `ssh -p ${sshPort} -o ConnectTimeout=2 -o StrictHostKeyChecking=no ${server.user}@${server.host} "uptime -p 2>/dev/null | cut -d' ' -f2-4; df -h / 2>/dev/null | tail -1 | awk '{print \\$5}'" 2>/dev/null`,
                        { timeout: 5000 }
                    );
                    stdout = result.stdout;
                }
                const lines = stdout.trim().split('\n');
                const uptime = lines[0] || '?';
                const disk = lines[1] || '?';
                status = 'OK';
                info = `up:${uptime},disk:${disk}`;
            } catch (e) {
                status = 'DOWN';
            }

            results.push(`${server.id}:${status}${info ? '(' + info + ')' : ''}`);
        }

        // 한 줄 응답
        res.type('text/plain').send(results.join(' '));
    } catch (error) {
        res.status(500).send('ERROR:' + error.message);
    }
});

// AI 단일 명령 실행
app.get('/api/ai/exec', requireAuth, async (req, res) => {
    const { server, cmd } = req.query;

    if (!server || !cmd) {
        return res.status(400).send('ERROR:server,cmd required');
    }

    const srv = SERVERS.find(s => s.id === server);
    if (!srv) {
        return res.status(404).send('ERROR:server not found');
    }

    try {
        let stdout, stderr;
        // 73 서버는 로컬 직접 실행
        if (srv.id === '73') {
            const result = await execPromise(cmd, { timeout: 30000 });
            stdout = result.stdout;
            stderr = result.stderr;
        } else {
            const sshPort = srv.port || 22;
            const result = await execPromise(
                `ssh -p ${sshPort} -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${srv.user}@${srv.host} "${cmd.replace(/"/g, '\\"')}" 2>&1`,
                { timeout: 30000 }
            );
            stdout = result.stdout;
            stderr = result.stderr;
        }

        res.type('text/plain').send(stdout || stderr || '(no output)');
    } catch (error) {
        res.status(500).send('ERROR:' + (error.stdout || error.stderr || error.message));
    }
});

// AI 배치 실행 - 여러 서버에 동시 명령
app.post('/api/ai/batch', requireAuth, async (req, res) => {
    const { commands } = req.body;

    // commands: [{ server: "73", cmd: "pm2 list" }, ...]
    if (!commands || !Array.isArray(commands)) {
        return res.status(400).send('ERROR:commands array required');
    }

    const results = [];

    await Promise.all(commands.map(async ({ server, cmd }) => {
        const srv = SERVERS.find(s => s.id === server);
        if (!srv) {
            results.push(`${server}:ERROR(not found)`);
            return;
        }

        try {
            const sshPort = srv.port || 22;
            const { stdout } = await execPromise(
                `ssh -p ${sshPort} -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${srv.user}@${srv.host} "${cmd.replace(/"/g, '\\"')}" 2>&1`,
                { timeout: 30000 }
            );

            // 결과 압축 (첫 3줄만)
            const lines = stdout.trim().split('\n');
            const brief = lines.slice(0, 3).join(' | ');
            results.push(`${server}:${brief}${lines.length > 3 ? '...(+' + (lines.length - 3) + ')' : ''}`);
        } catch (error) {
            results.push(`${server}:ERROR(${error.message.slice(0, 50)})`);
        }
    }));

    res.type('text/plain').send(results.join('\n'));
});

// AI 빠른 명령 (자주 쓰는 것들)
app.get('/api/ai/quick/:action', requireAuth, async (req, res) => {
    const { action } = req.params;
    const { server } = req.query;

    const quickCommands = {
        'pm2': 'pm2 list --no-color | head -20',
        'docker': 'docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null || echo "no docker"',
        'disk': 'df -h / | tail -1 | awk \'{print $5}\'',
        'mem': 'free -h | grep Mem | awk \'{print $3"/"$2}\'',
        'cpu': 'top -bn1 | grep "Cpu(s)" | awk \'{print $2}\'',
        'load': 'uptime | awk -F"load average:" \'{print $2}\' | xargs'
    };

    const cmd = quickCommands[action];
    if (!cmd) {
        return res.status(400).send('ERROR:unknown action. available: ' + Object.keys(quickCommands).join(','));
    }

    // 서버 지정 없으면 전체
    const targetServers = server ? SERVERS.filter(s => s.id === server) : SERVERS;

    const results = [];
    await Promise.all(targetServers.map(async (srv) => {
        try {
            let stdout;
            // 73 서버는 로컬 직접 실행
            if (srv.id === '73') {
                const result = await execPromise(cmd, { timeout: 10000 });
                stdout = result.stdout;
            } else {
                const sshPort = srv.port || 22;
                const result = await execPromise(
                    `ssh -p ${sshPort} -o ConnectTimeout=3 -o StrictHostKeyChecking=no ${srv.user}@${srv.host} "${cmd}" 2>/dev/null`,
                    { timeout: 10000 }
                );
                stdout = result.stdout;
            }
            results.push(`${srv.id}:${stdout.trim().replace(/\n/g, ' ')}`);
        } catch (e) {
            results.push(`${srv.id}:ERROR`);
        }
    }));

    res.type('text/plain').send(results.join('\n'));
});

// ============ 메인 페이지 ============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 터미널 페이지
app.get('/terminal', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terminal.html'));
});

// 세션 재생 페이지
app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// 서버 시작
server.listen(PORT, '0.0.0.0', () => {
    nexusLog.info('System Integrated', { port: PORT }, ['startup']);
    console.log(`SSH Hub running on http://localhost:${PORT}`);
    startLogWatcher();  // 실시간 로그 모니터링 시작
});

// 에러 핸들러
process.on('uncaughtException', (error) => {
    nexusLog.error('Uncaught Exception', error, ['fatal']);
});
process.on('unhandledRejection', (reason) => {
    nexusLog.error('Unhandled Rejection', { reason: String(reason) }, ['fatal']);
});

// 종료 시 정리
process.on('SIGTERM', () => {
    if (logWatcher) logWatcher.kill();
    process.exit(0);
});
