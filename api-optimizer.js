/**
 * API Optimizer Middleware
 * 모든 API 응답에 자동으로 적용:
 * - Selective Fields (필드 선택): ?fields=id,name,...
 * - Memory Caching: 요청 조합별 캐싱
 * - Response Wrapper: 표준화된 응답 형식
 */

const crypto = require('crypto');

// 메모리 캐시 (맵 기반)
const memCache = new Map();
const MAX_CACHE_SIZE = 1000;
const DEFAULT_TTL = 300; // 5분

class APIOptimizer {
  /**
   * 필드 선택 함수
   * ?fields=id,name,url 형식으로 필요한 필드만 반환
   */
  static selectFields(data, fields) {
    if (!fields || fields === '*') return data;
    
    if (Array.isArray(data)) {
      return data.map(item => this.selectFields(item, fields));
    }
    
    if (typeof data !== 'object') return data;
    
    const fieldList = fields.split(',').map(f => f.trim());
    const result = {};
    fieldList.forEach(field => {
      if (field in data) {
        result[field] = data[field];
      }
    });
    return result;
  }

  /**
   * 캐시 키 생성
   */
  static generateCacheKey(req, data) {
    const key = `${req.method}:${req.path}:${JSON.stringify(req.query)}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * 캐시에서 조회
   */
  static getFromCache(cacheKey) {
    const cached = memCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return { hit: true, data: cached.data };
    }
    if (cached) {
      memCache.delete(cacheKey);
    }
    return { hit: false };
  }

  /**
   * 캐시에 저장
   */
  static setCache(cacheKey, data, ttl = DEFAULT_TTL) {
    // 캐시 크기 제한
    if (memCache.size >= MAX_CACHE_SIZE) {
      const firstKey = memCache.keys().next().value;
      memCache.delete(firstKey);
    }
    
    memCache.set(cacheKey, {
      data,
      expiry: Date.now() + (ttl * 1000)
    });
  }

  /**
   * 캐시 통계
   */
  static getStats() {
    return {
      cache_size: memCache.size,
      max_size: MAX_CACHE_SIZE
    };
  }

  /**
   * 캐시 초기화
   */
  static clearCache() {
    memCache.clear();
  }
}

/**
 * Express 미들웨어: API 최적화
 * JSON 응답을 자동으로 최적화
 */
function apiOptimizerMiddleware() {
  return (req, res, next) => {
    const originalJson = res.json;
    const fields = req.query.fields || null;
    const cacheKey = APIOptimizer.generateCacheKey(req, {});

    // 캐시 확인 (GET 요청만)
    if (req.method === 'GET') {
      const cached = APIOptimizer.getFromCache(cacheKey);
      if (cached.hit) {
        return res.status(200).json({
          success: true,
          source: '⚡ cache (memory)',
          data: cached.data,
          timestamp: new Date().toISOString()
        });
      }
    }

    // res.json() 오버라이드
    res.json = function(data) {
      // 데이터 추출 (success, data, 또는 직접 배열/객체)
      let payload = data;
      let isSuccess = true;

      if (data && typeof data === 'object' && 'success' in data) {
        isSuccess = data.success;
        payload = data.data || data;
      }

      // 필드 선택 적용
      if (fields && isSuccess) {
        payload = APIOptimizer.selectFields(payload, fields);
      }

      // 응답 생성
      const response = {
        success: isSuccess,
        source: '📊 database (fresh)',
        data: payload,
        timestamp: new Date().toISOString()
      };

      // 원본 응답에 추가 정보가 있으면 병합
      if (data && typeof data === 'object') {
        if (data.pagination) response.pagination = data.pagination;
        if (data.error) response.error = data.error;
        if (data.message) response.message = data.message;
      }

      // 캐시 저장 (GET, 성공한 경우만)
      if (req.method === 'GET' && isSuccess && payload) {
        APIOptimizer.setCache(cacheKey, payload);
        response.cache_size = APIOptimizer.getStats().cache_size;
      }

      // 기본 json 호출
      return originalJson.call(this, response);
    };

    next();
  };
}

module.exports = {
  APIOptimizer,
  apiOptimizerMiddleware
};
