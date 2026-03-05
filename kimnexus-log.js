/**
 * KimNexus v9 Log SDK
 * 중앙 로그 서버로 로그를 전송하는 클라이언트 라이브러리
 *
 * 사용법:
 *   const log = require('./kimnexus-log')('my-project', '253');
 *   log.info('서버 시작됨');
 *   log.error('DB 연결 실패', { code: 'DB_ERR', stack: err.stack });
 */

const https = require('http');

const LOG_SERVER = process.env.LOG_SERVER || '192.168.45.253';
const LOG_PORT = process.env.LOG_PORT || 50100;

class KimNexusLogger {
  constructor(projectId, server = '') {
    this.pid = projectId;
    this.srv = server;
    this.queue = [];
    this.flushInterval = null;
    this.batchSize = 10;
    this.flushDelay = 1000; // 1초마다 배치 전송

    // 배치 전송 시작
    this._startBatching();
  }

  /**
   * Trace ID 생성
   */
  _generateTid() {
    return 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 로그 전송 (내부)
   */
  async _send(logData) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(logData);

      const options = {
        hostname: LOG_SERVER,
        port: LOG_PORT,
        path: '/log',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 3000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body || '{}')));
      });

      req.on('error', (e) => {
        // 로그 서버 장애 시 조용히 실패 (앱에 영향 X)
        console.error('[KimNexus] Log send failed:', e.message);
        resolve({ success: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false });
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * 배치 전송 (벌크)
   */
  async _sendBatch(logs) {
    if (logs.length === 0) return;

    return new Promise((resolve) => {
      const data = JSON.stringify(logs);

      const options = {
        hostname: LOG_SERVER,
        port: LOG_PORT,
        path: '/logs',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
      };

      const req = https.request(options, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });

      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });

      req.write(data);
      req.end();
    });
  }

  /**
   * 배치 처리 시작
   */
  _startBatching() {
    this.flushInterval = setInterval(() => {
      if (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        this._sendBatch(batch);
      }
    }, this.flushDelay);

    // 프로세스 종료 시 남은 로그 전송
    process.on('beforeExit', () => this.flush());
  }

  /**
   * 즉시 전송 (남은 큐 비우기)
   */
  async flush() {
    if (this.queue.length > 0) {
      await this._sendBatch(this.queue);
      this.queue = [];
    }
  }

  /**
   * 로그 기록 (공통)
   */
  _log(level, message, meta = {}, tags = []) {
    const logData = {
      v: 9,
      pid: this.pid,
      lvl: level,
      msg: message,
      ts: new Date().toISOString(),
      srv: this.srv,
      tid: this._generateTid(),
      tag: tags,
      meta: meta
    };

    // error는 즉시 전송, 나머지는 배치
    if (level === 'error') {
      this._send(logData);
    } else {
      this.queue.push(logData);
    }

    return logData.tid;
  }

  // ===== Public API =====

  /**
   * 정보 로그
   * @param {string} message
   * @param {object} meta
   * @param {string[]} tags
   */
  info(message, meta = {}, tags = []) {
    return this._log('info', message, meta, tags);
  }

  /**
   * 경고 로그
   */
  warn(message, meta = {}, tags = []) {
    return this._log('warn', message, meta, tags);
  }

  /**
   * 에러 로그 (즉시 전송)
   */
  error(message, meta = {}, tags = []) {
    // 에러 객체 처리
    if (meta instanceof Error) {
      meta = {
        name: meta.name,
        message: meta.message,
        stack: meta.stack
      };
    }
    return this._log('error', message, meta, tags);
  }

  /**
   * 디버그 로그
   */
  debug(message, meta = {}, tags = []) {
    return this._log('debug', message, meta, tags);
  }

  /**
   * 커스텀 레벨 로그
   */
  log(level, message, meta = {}, tags = []) {
    return this._log(level, message, meta, tags);
  }

  /**
   * Trace ID로 연관 로그 그룹화
   * @param {string} tid - 기존 Trace ID
   */
  withTrace(tid) {
    const self = this;
    return {
      info: (msg, meta, tags) => self._logWithTid(tid, 'info', msg, meta, tags),
      warn: (msg, meta, tags) => self._logWithTid(tid, 'warn', msg, meta, tags),
      error: (msg, meta, tags) => self._logWithTid(tid, 'error', msg, meta, tags),
      debug: (msg, meta, tags) => self._logWithTid(tid, 'debug', msg, meta, tags)
    };
  }

  _logWithTid(tid, level, message, meta = {}, tags = []) {
    const logData = {
      v: 9,
      pid: this.pid,
      lvl: level,
      msg: message,
      ts: new Date().toISOString(),
      srv: this.srv,
      tid: tid,
      tag: tags,
      meta: meta
    };

    if (level === 'error') {
      this._send(logData);
    } else {
      this.queue.push(logData);
    }

    return tid;
  }

  /**
   * Express/Fastify 미들웨어
   */
  middleware() {
    const self = this;
    return (req, res, next) => {
      const tid = self._generateTid();
      req.tid = tid;

      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        self._log(
          res.statusCode >= 400 ? 'warn' : 'info',
          `${req.method} ${req.url} ${res.statusCode}`,
          { duration, statusCode: res.statusCode, method: req.method, url: req.url },
          ['http']
        );
      });

      next();
    };
  }
}

/**
 * 팩토리 함수
 * @param {string} projectId - 프로젝트 ID
 * @param {string} server - 서버 식별자 (예: '253', '73')
 */
function createLogger(projectId, server = '') {
  return new KimNexusLogger(projectId, server);
}

module.exports = createLogger;
module.exports.KimNexusLogger = KimNexusLogger;
