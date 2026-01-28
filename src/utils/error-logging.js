/**
 * Comprehensive error logging utilities.
 * These run BEFORE React mounts to catch early initialization errors.
 */

import { logToServer } from './server-logger';

/**
 * Safe wrapper for logError - no-op for now
 * We removed frontend-platform logging from this file to avoid initialization errors
 * Console logging is sufficient for debugging and always works
 */
function safeLogError(message, data) {
  // No-op - console.error is already called, which is sufficient
  // Frontend-platform logging can be added later once initialization is stable
}

/**
 * Safe wrapper for logInfo - no-op for now
 * We removed frontend-platform logging from this file to avoid initialization errors
 * Console logging is sufficient for debugging and always works
 */
function safeLogInfo(message, data) {
  // No-op - console.log is already called, which is sufficient
  // Frontend-platform logging can be added later once initialization is stable
}

/**
 * Logs detailed information about an error, including stack trace and context.
 */
function logErrorDetails(error, context = {}) {
  const errorInfo = {
    message: error?.message || String(error),
    name: error?.name || 'UnknownError',
    stack: error?.stack || 'No stack trace available',
    url: window.location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    inIframe: window.self !== window.top,
    ...context,
  };

  // Only log errors in development mode
  if (process.env.NODE_ENV === 'development') {
    console.error('[JWT Auth] Error:', errorInfo.message);
  }

  // Frontend-platform logging (safe - checks if available)
  safeLogError('[JWT Auth] Error', errorInfo);

  // Server logging (for Docker logs)
  logToServer('error_occurred', {
    message: errorInfo.message,
    name: errorInfo.name,
    url: errorInfo.url,
    inIframe: errorInfo.inIframe,
    ...context,
  });

  return errorInfo;
}

/**
 * Sets up global error handlers that catch errors BEFORE React mounts.
 * This is critical for debugging initialization failures.
 */
export function setupGlobalErrorHandlers() {
  // Silent setup - no console logging needed for production

  // Catch synchronous JavaScript errors
  window.onerror = (message, source, lineno, colno, error) => {
    const errorObj = error || new Error(message);

    // Store error globally so APP_INIT_ERROR handler can access it
    window.__INIT_ERROR__ = errorObj;
    window.__LAST_ERROR__ = {
      message,
      source,
      lineno,
      colno,
      error: errorObj,
      timestamp: new Date().toISOString(),
    };

    logErrorDetails(errorObj, {
      source,
      lineno,
      colno,
      errorType: 'window.onerror',
      originalMessage: message,
    });
    return false; // Don't prevent default error handling
  };

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error
      ? event.reason
      : new Error(String(event.reason));

    // Store error globally so APP_INIT_ERROR handler can access it
    window.__INIT_ERROR__ = error;
    window.__LAST_PROMISE_REJECTION__ = {
      error,
      reason: event.reason,
      timestamp: new Date().toISOString(),
    };

    logErrorDetails(error, {
      errorType: 'unhandledrejection',
      promiseRejection: true,
      reason: event.reason,
    });
  });

  // Catch resource loading errors (images, scripts, etc.)
  window.addEventListener('error', (event) => {
    // Only log resource errors (not JavaScript errors, which are handled by onerror)
    if (event.target !== window && event.target !== document) {
      logErrorDetails(new Error(`Resource load error: ${event.target.tagName} ${event.target.src || event.target.href}`), {
        errorType: 'resource_error',
        tagName: event.target.tagName,
        src: event.target.src || event.target.href,
        type: event.target.type,
      });
    }
  }, true); // Use capture phase
}

/**
 * Logs initialization milestones to track the app startup sequence.
 */
export function logInitializationMilestone(milestone, data = {}) {
  const logData = {
    milestone,
    url: window.location.href,
    referrer: document.referrer,
    inIframe: window.self !== window.top,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Only log in development mode
  if (process.env.NODE_ENV === 'development') {
    console.log(`[JWT Auth] Init: ${milestone}`);
  }
  logToServer('init_milestone', { milestone, ...data });
}

/**
 * Logs detailed request information including all headers.
 */
export function logRequestDetails(config, phase = 'request') {
  const logData = {
    phase,
    url: config.url || config.baseURL || 'unknown',
    method: config.method || 'GET',
    headers: { ...config.headers },
    withCredentials: config.withCredentials,
    timeout: config.timeout,
    timestamp: new Date().toISOString(),
  };

  // Log Authorization header separately (but truncated for security)
  if (logData.headers.Authorization) {
    const authHeader = logData.headers.Authorization;
    logData.headers.Authorization = authHeader.length > 50
      ? `${authHeader.substring(0, 50)}...`
      : authHeader;
  }

  // Silent in production - server logging only
  logToServer(`request_${phase}`, {
    url: logData.url,
    method: logData.method,
    hasAuthHeader: !!config.headers.Authorization,
    withCredentials: logData.withCredentials,
  });
}

/**
 * Logs detailed response information including status and headers.
 * Note: We avoid JSON.stringify on response.data to prevent consuming the response stream
 * which could cause SIGPIPE errors if the response isn't fully read.
 */
export function logResponseDetails(response, phase = 'response') {
  // Calculate data size safely without consuming the stream
  let dataSize = 0;
  try {
    if (response.data) {
      // Only calculate size if data is already parsed (not a stream)
      if (typeof response.data === 'object' && !(response.data instanceof Blob) && !(response.data instanceof ArrayBuffer)) {
        dataSize = JSON.stringify(response.data).length;
      } else if (typeof response.data === 'string') {
        dataSize = response.data.length;
      }
    }
  } catch (e) {
    // If stringify fails, dataSize remains 0 - this is fine for logging
  }

  const logData = {
    phase,
    url: response.config?.url || 'unknown',
    method: response.config?.method || 'GET',
    status: response.status,
    statusText: response.statusText,
    headers: response.headers ? { ...response.headers } : {},
    dataSize,
    hasData: !!response.data,
    timestamp: new Date().toISOString(),
  };

  // Silent in production - server logging only
  logToServer(`response_${phase}`, {
    url: logData.url,
    method: logData.method,
    status: logData.status,
  });
}

/**
 * Logs error response details.
 */
export function logErrorResponse(error) {
  // Safely extract error information with proper null checks
  const errorConfig = error?.config || {};
  const errorResponse = error?.response || {};
  const errorRequest = error?.request || {};

  const logData = {
    message: error?.message || 'Unknown error',
    status: errorResponse?.status,
    statusText: errorResponse?.statusText,
    url: errorConfig?.url || errorRequest?.responseURL || 'unknown',
    method: (errorConfig?.method || 'GET').toUpperCase(),
    headers: errorResponse?.headers ? { ...errorResponse.headers } : {},
    requestHeaders: errorConfig?.headers ? { ...errorConfig.headers } : {},
    // Include error type and custom attributes for config errors
    errorType: error?.customAttributes?.httpErrorType || 'unknown',
    errorMessage: error?.customAttributes?.httpErrorMessage || error?.message || 'Unknown error',
    hasResponse: !!error?.response,
    hasRequest: !!error?.request,
    hasConfig: !!error?.config,
    withCredentials: errorConfig?.withCredentials,
    timestamp: new Date().toISOString(),
  };

  // Log all header locations to debug header merging issues
  // Safely access headers with proper null checks
  const requestHeaders = logData.requestHeaders || {};
  const allHeaderLocations = {
    direct: requestHeaders.Authorization,
    common: requestHeaders.common?.Authorization,
    get: requestHeaders.get?.Authorization,
    post: requestHeaders.post?.Authorization,
  };

  // Truncate Authorization header if present (in all locations)
  Object.keys(allHeaderLocations).forEach(key => {
    if (allHeaderLocations[key] && typeof allHeaderLocations[key] === 'string') {
      const authHeader = allHeaderLocations[key];
      allHeaderLocations[key] = authHeader.length > 50
        ? `${authHeader.substring(0, 50)}...`
        : authHeader;
    }
  });

  // Add header locations to log data
  logData.headerLocations = allHeaderLocations;

  // Truncate Authorization header if present (for backward compatibility)
  if (logData.requestHeaders?.Authorization && typeof logData.requestHeaders.Authorization === 'string') {
    const authHeader = logData.requestHeaders.Authorization;
    logData.requestHeaders.Authorization = authHeader.length > 50
      ? `${authHeader.substring(0, 50)}...`
      : authHeader;
  }

  // Only log errors in development mode
  if (process.env.NODE_ENV === 'development') {
    console.error('[JWT Auth] Response Error:', logData.status, logData.url);
  }
  logToServer('response_error', {
    url: logData.url,
    method: logData.method,
    status: logData.status,
    message: logData.message,
    errorType: logData.errorType,
    errorMessage: logData.errorMessage,
  });
}

