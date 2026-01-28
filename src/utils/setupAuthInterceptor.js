import { getAuthenticatedHttpClient } from '@edx/frontend-platform/auth';
import { logRequestDetails, logResponseDetails, logErrorResponse } from './error-logging';

// Safe wrappers for frontend-platform logging that may not be initialized yet
function safeLogInfo(message, data) {
  try {
    // Try to import dynamically - may fail if not initialized
    const { logInfo } = require('@edx/frontend-platform/logging');
    if (logInfo && typeof logInfo === 'function') {
      logInfo(message, data);
    }
  } catch (e) {
    // Logging not available yet - this is expected during early initialization
    // console.log is already called, which is sufficient
  }
}

function safeLogError(message, data) {
  try {
    // Try to import dynamically - may fail if not initialized
    const { logError } = require('@edx/frontend-platform/logging');
    if (logError && typeof logError === 'function') {
      logError(message, data);
    }
  } catch (e) {
    // Logging not available yet - this is expected during early initialization
    // console.error is already called, which is sufficient
  }
}

/**
 * Global state for JWT authentication.
 * This allows the interceptor to access current auth state without React context.
 */
let globalAuthState = {
  mode: 'cookie',
  jwtToken: null,
};

/**
 * Sets the global authentication state.
 * This is called by the AuthenticatedHttpClientProvider when auth state changes.
 *
 * @param {string} mode - Authentication mode: 'cookie' or 'jwt'
 * @param {string|null} jwtToken - JWT token if in JWT mode
 */
export function setGlobalAuthState(mode, jwtToken) {
  const previousMode = globalAuthState.mode;
  const previousHasToken = !!globalAuthState.jwtToken;
  const newHasToken = !!jwtToken;

  globalAuthState = {
    mode,
    jwtToken,
  };

}

/**
 * Gets the current global authentication state.
 *
 * @returns {Object} Current auth state
 */
export function getGlobalAuthState() {
  return { ...globalAuthState };
}

/**
 * Sets up a global interceptor on the authenticated HTTP client.
 * This interceptor checks the current auth state on each request and adds
 * JWT token header when needed.
 *
 * This allows API functions to continue using getAuthenticatedHttpClient()
 * without modification, while still supporting JWT authentication.
 *
 * @returns {Object} Object with cleanup function to remove interceptors
 */
export function setupAuthInterceptor() {
  try {
    const client = getAuthenticatedHttpClient();

    if (!client) {
      safeLogError('[JWT Auth] getAuthenticatedHttpClient returned null/undefined', {});
      return { remove: () => {} }; // Return no-op cleanup function
    }


    // Request interceptor to add JWT token when needed
    const requestInterceptorId = client.interceptors.request.use(
      (config) => {
        const { mode, jwtToken } = globalAuthState;
        const url = config.url || config.baseURL || 'unknown';

        // Ensure headers object exists
        if (!config.headers) {
          config.headers = {};
        }


        // If we're in JWT mode and have a token, add Authorization header
        if (mode === 'jwt' && jwtToken) {
          // CRITICAL: Skip frontend-platform's JWT token refresh interceptor
          // This prevents it from trying to refresh token from cookies (which don't exist in JWT mode)
          config.skipJwtTokenRefresh = true;

          // Add JWT token to Authorization header
          // Format: Authorization: JWT <token> (exactly like Postman)
          // CRITICAL: Set directly on config.headers.Authorization first (most direct way)
          // Then also set on common and method-specific for Axios header merging
          const authHeaderValue = `JWT ${jwtToken}`;

          // Set Authorization header directly on config.headers
          // NOTE: Do NOT set config.headers.common or config.headers[method] - these get
          // serialized as actual headers in newer Axios versions, causing CORS errors
          config.headers.Authorization = authHeaderValue;

          // For cross-origin requests, disable credentials (cookies)
          // This ensures we're using JWT instead of cookies
          // CRITICAL: Must set this AFTER headers are set to avoid config errors
          config.withCredentials = false;

          // Log detailed JWT usage for verification
          const authHeader = config.headers.Authorization || 'NOT SET';
          const hasAuthHeader = authHeader.startsWith('JWT ');
          const usingCookies = config.withCredentials === true;

          // Verify header format matches Postman exactly: "JWT <token>"
          const headerFormatCorrect = typeof authHeader === 'string' && authHeader.startsWith('JWT ') && authHeader.length > 4;

        } else {
          // Cookie-based authentication: ensure credentials are sent
          // This is the default behavior, but we make it explicit
          config.withCredentials = true;

          // Remove Authorization header if it exists (from previous JWT mode)
          delete config.headers.Authorization;

          // Log cookie-based auth usage for verification
          const hasAuthHeader = config.headers.Authorization && config.headers.Authorization.startsWith('JWT ');
          const usingCookies = config.withCredentials === true;

        }

        // Final verification - ensure Authorization header is set
        if (mode === 'jwt' && jwtToken) {
          if (!config.headers.Authorization) {
            config.headers.Authorization = `JWT ${jwtToken}`;
          }
        }

        // Log request details AFTER all modifications (so we see the final config)
        logRequestDetails(config, 'request');

        // Remove notify_all_learners from POST requests to threads endpoint (safety measure)
        if (config.method === 'post' && url.includes('/api/discussion/v1/threads/')) {
          if (config.data && typeof config.data === 'object' && 'notify_all_learners' in config.data) {
            delete config.data.notify_all_learners;
          }
        }

        return config;
      },
      (error) => {
        // Request error - pass through
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    const responseInterceptorId = client.interceptors.response.use(
      (response) => {
        // Verify Authorization header was sent (check the request config from response)
        if (response.config) {
          const sentAuthHeader = response.config.headers?.Authorization ||
                                 response.config.headers?.common?.Authorization ||
                                 response.config.headers?.[(response.config.method || 'get').toLowerCase()]?.Authorization;

        }

        // Log successful response details
        logResponseDetails(response, 'success');
        // Success response - pass through
        return response;
      },
      (error) => {
        // Log error response details with full headers
        logErrorResponse(error);

        // Handle authentication errors
        const status = error?.response?.status;
        const { mode, jwtToken } = globalAuthState;

        // Handle 401 in JWT mode - request token refresh
        if (status === 401 && mode === 'jwt' && jwtToken) {
          try {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'auth.jwt.token.refresh' }, '*');
            }
          } catch (err) {
            // Silent fail - parent may not be listening
          }
        }

        // Re-throw the error so calling code can handle it
        return Promise.reject(error);
      }
    );

    // Return cleanup function
    return {
      remove: () => {
        safeLogInfo('[JWT Auth] Removing auth interceptors', {});
        client.interceptors.request.eject(requestInterceptorId);
        client.interceptors.response.eject(responseInterceptorId);
      },
    };
  } catch (error) {
    safeLogError('[JWT Auth] Error setting up auth interceptor', { error: error.message });
    // Return no-op cleanup function on error
    return { remove: () => {} };
  }
}

