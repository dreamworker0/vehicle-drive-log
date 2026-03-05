/**
 * helpers — Cloud Functions 공통 유틸리티
 * 구조화 로깅, HTTP 에러 래퍼, Callable 에러 래퍼
 */

/**
 * 구조화 로깅 — Cloud Logging에서 severity 기반 필터링 가능
 * @param {'INFO'|'WARNING'|'ERROR'} severity
 * @param {string} functionName
 * @param {string} message
 * @param {object} [extra] - 추가 메타데이터
 */
function log(severity, functionName, message, extra = {}) {
    const entry = {
        severity,
        function: functionName,
        message,
        timestamp: new Date().toISOString(),
        ...extra,
    };

    if (severity === "ERROR") {
        console.error(JSON.stringify(entry));
    } else if (severity === "WARNING") {
        console.warn(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

/**
 * onRequest 핸들러용 에러 래퍼
 * try-catch를 감싸서 일관된 에러 응답과 구조화 로깅 제공
 * @param {string} functionName - 함수 이름 (로깅용)
 * @param {Function} handler - async (req, res) => void
 * @returns {Function} 래핑된 핸들러
 */
function wrapHttps(functionName, handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            log("ERROR", functionName, err.message, {
                stack: err.stack,
                method: req.method,
                path: req.path,
            });
            if (!res.headersSent) {
                res.status(500).json({ error: `${functionName} 처리 중 오류가 발생했습니다.` });
            }
        }
    };
}

/**
 * onCall / onDocumentCreated 등 비-HTTP 핸들러용 에러 래퍼
 * @param {string} functionName - 함수 이름 (로깅용)
 * @param {Function} handler - async (...args) => any
 * @returns {Function} 래핑된 핸들러
 */
function wrapHandler(functionName, handler) {
    return async (...args) => {
        try {
            return await handler(...args);
        } catch (err) {
            log("ERROR", functionName, err.message, { stack: err.stack });
            throw err; // 호출자에게 에러 전파
        }
    };
}

module.exports = { log, wrapHttps, wrapHandler };
