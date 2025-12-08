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

  // Log state changes
  if (previousMode !== mode || previousHasToken !== newHasToken) {
    console.log('[JWT Auth] Global auth state updated', {
      previousMode,
      newMode: mode,
      previousHasToken,
      newHasToken,
      tokenLength: jwtToken ? jwtToken.length : 0,
    });
    safeLogInfo('[JWT Auth] Global auth state updated', {
      previousMode,
      newMode: mode,
      previousHasToken,
      newHasToken,
      tokenLength: jwtToken ? jwtToken.length : 0,
    });
  }
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

    console.log('[JWT Auth] Setting up global auth interceptor');
    safeLogInfo('[JWT Auth] Setting up global auth interceptor', {});

    // Request interceptor to add JWT token when needed
    const requestInterceptorId = client.interceptors.request.use(
      (config) => {
        const { mode, jwtToken } = globalAuthState;
        const url = config.url || config.baseURL || 'unknown';

        // Ensure headers object exists
        if (!config.headers) {
          config.headers = {};
        }

        // Log interceptor state for debugging (before modification)
        console.log('[JWT Auth] Request interceptor called', {
          mode,
          hasToken: !!jwtToken,
          tokenLength: jwtToken ? jwtToken.length : 0,
          tokenPreview: jwtToken ? jwtToken.substring(0, 30) + '...' : null,
          url,
          method: config.method,
          originalWithCredentials: config.withCredentials,
        });

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

          // PRIMARY: Set directly on headers (this is what Axios will use)
          config.headers.Authorization = authHeaderValue;

          // SECONDARY: Also set on common headers (Axios merges these for all methods)
          if (!config.headers.common) {
            config.headers.common = {};
          }
          config.headers.common.Authorization = authHeaderValue;

          // TERTIARY: Also set on method-specific header (Axios merges these per method)
          const method = (config.method || 'get').toLowerCase();
          if (!config.headers[method]) {
            config.headers[method] = {};
          }
          config.headers[method].Authorization = authHeaderValue;

          // CRITICAL: Ensure the header is a string, not an object
          // Axios expects headers to be strings, not objects
          if (typeof config.headers.Authorization !== 'string') {
            console.error('[JWT Auth] ERROR: Authorization header is not a string!', {
              type: typeof config.headers.Authorization,
              value: config.headers.Authorization,
            });
            config.headers.Authorization = authHeaderValue; // Force it to be a string
          }
          console.log('[JWT Auth] Authorization header', {
            type: typeof config.headers.Authorization,
            value: config.headers.Authorization,
          });
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

          console.log('[JWT Auth] ✅ REQUEST USING JWT TOKEN', {
            url,
            method: config.method,
            authMode: 'JWT',
            hasJwtToken: true,
            tokenLength: jwtToken ? jwtToken.length : 0,
            tokenPreview: jwtToken ? jwtToken.substring(0, 50) + '...' : null,
            authorizationHeader: hasAuthHeader ? `${authHeader.substring(0, 50)}...` : 'MISSING',
            headerFormat: headerFormatCorrect ? '✅ CORRECT (matches Postman: "JWT <token>")' : '❌ INCORRECT FORMAT',
            headerType: typeof authHeader,
            withCredentials: config.withCredentials,
            usingCookies: usingCookies,
            confirmation: hasAuthHeader && !usingCookies && headerFormatCorrect ? '✅ JWT AUTH CONFIRMED' : '❌ JWT AUTH NOT WORKING',
            note: 'Check Network tab → Request Headers → Authorization to verify it was sent',
          });
          safeLogInfo('[JWT Auth] Request interceptor - JWT mode', {
            url,
            method: config.method,
            hasToken: !!jwtToken,
            tokenLength: jwtToken ? jwtToken.length : 0,
          });
        } else {
          // Cookie-based authentication: ensure credentials are sent
          // This is the default behavior, but we make it explicit
          config.withCredentials = true;

          // Remove Authorization header if it exists (from previous JWT mode)
          delete config.headers.Authorization;

          // Log cookie-based auth usage for verification
          const hasAuthHeader = config.headers.Authorization && config.headers.Authorization.startsWith('JWT ');
          const usingCookies = config.withCredentials === true;

          console.log('[JWT Auth] 🍪 REQUEST USING COOKIES', {
            url,
            method: config.method,
            authMode: 'COOKIE',
            hasJwtToken: !!jwtToken,
            authorizationHeader: hasAuthHeader ? 'PRESENT (should not be)' : 'NOT SET (correct)',
            withCredentials: config.withCredentials,
            usingCookies: usingCookies,
            confirmation: !hasAuthHeader && usingCookies ? '✅ COOKIE AUTH CONFIRMED' : '⚠️ AUTH MODE UNCLEAR',
          });
        }

        // CRITICAL: Final verification - ensure Authorization header is set correctly
        // Axios merges headers from common, method-specific, and direct properties
        // We need to ensure it's in the right place for Axios to use it
        if (mode === 'jwt' && jwtToken) {
          // Get method for this request (needed for method-specific header location)
          const requestMethod = (config.method || 'get').toLowerCase();

          // Final check - verify header is accessible from all locations
          const directHeader = config.headers.Authorization;
          const commonHeader = config.headers.common?.Authorization;
          const methodHeader = config.headers[requestMethod]?.Authorization;

          // If any are missing, set them all again
          if (!directHeader || !commonHeader || !methodHeader) {
            const authHeaderValue = `JWT ${jwtToken}`;
            config.headers.Authorization = authHeaderValue;
            if (!config.headers.common) {
              config.headers.common = {};
            }
            config.headers.common.Authorization = authHeaderValue;
            if (!config.headers[requestMethod]) {
              config.headers[requestMethod] = {};
            }
            config.headers[requestMethod].Authorization = authHeaderValue;

            console.warn('[JWT Auth] Re-applied Authorization header - some locations were missing', {
              url,
              hadDirect: !!directHeader,
              hadCommon: !!commonHeader,
              hadMethod: !!methodHeader,
            });
          }

          // Final verification log
          console.log('[JWT Auth] Final header verification before request', {
            url,
            method: config.method,
            directHeader: config.headers.Authorization ? `${config.headers.Authorization.substring(0, 50)}...` : 'MISSING',
            commonHeader: config.headers.common?.Authorization ? `${config.headers.common.Authorization.substring(0, 50)}...` : 'MISSING',
            methodHeader: config.headers[requestMethod]?.Authorization ? `${config.headers[requestMethod].Authorization.substring(0, 50)}...` : 'MISSING',
            allHeadersKeys: Object.keys(config.headers),
          });
        }

        // Log request details AFTER all modifications (so we see the final config)
        logRequestDetails(config, 'request');

        // CRITICAL: Log request body/data for POST requests to threads endpoint
        if (config.method === 'post' && url.includes('/api/discussion/v1/threads/')) {
          console.log('[Discussion-Interceptor] ===== REQUEST INTERCEPTOR - POST TO THREADS =====');
          console.log('[Discussion-Interceptor] Request URL:', url);
          console.log('[Discussion-Interceptor] Request data/body:', config.data);
          console.log('[Discussion-Interceptor] Request data type:', typeof config.data);
          if (typeof config.data === 'string') {
            try {
              const parsed = JSON.parse(config.data);
              console.log('[Discussion-Interceptor] Parsed request body:', parsed);
              console.log('[Discussion-Interceptor] notify_all_learners in body?', 'notify_all_learners' in parsed);
              if ('notify_all_learners' in parsed) {
                console.log('[Discussion-Interceptor] ⚠️⚠️⚠️ WARNING: notify_all_learners found in request body!', parsed.notify_all_learners);
              }
            } catch (e) {
              console.log('[Discussion-Interceptor] Could not parse request body as JSON:', e);
            }
          } else if (config.data && typeof config.data === 'object') {
            console.log('[Discussion-Interceptor] Request body object:', config.data);
            console.log('[Discussion-Interceptor] notify_all_learners in body?', 'notify_all_learners' in config.data);
            if ('notify_all_learners' in config.data) {
              console.log('[Discussion-Interceptor] ⚠️⚠️⚠️ WARNING: notify_all_learners found in request body!', config.data.notify_all_learners);
              // Remove it here as a safety measure
              delete config.data.notify_all_learners;
              console.log('[Discussion-Interceptor] Removed notify_all_learners from request body');
            }
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

          if (globalAuthState.mode === 'jwt' && globalAuthState.jwtToken) {
            const hasAuthHeader = sentAuthHeader && sentAuthHeader.startsWith('JWT ');
            console.log('[JWT Auth] Response received - verifying Authorization header was sent', {
              url: response.config.url,
              method: response.config.method,
              status: response.status,
              hasAuthHeader,
              authHeaderPreview: hasAuthHeader ? `${sentAuthHeader.substring(0, 50)}...` : 'MISSING',
              confirmation: hasAuthHeader ? '✅ Authorization header was sent' : '❌ Authorization header missing',
            });
          }
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

        if (status === 401) {
          // Unauthorized - token may be invalid or expired
          if (mode === 'jwt' && jwtToken) {
            console.error('[JWT Auth] Authentication failed: 401 Unauthorized', {
              error: error.message,
              authMode: mode,
              url: error?.config?.url,
              method: error?.config?.method,
              hasToken: !!jwtToken,
            });
            safeLogError('[JWT Auth] Authentication failed: 401 Unauthorized', {
              error: error.message,
              authMode: mode,
              url: error?.config?.url,
              method: error?.config?.method,
              hasToken: !!jwtToken,
            });

            // Request token refresh from parent window
            try {
              if (window.parent && window.parent !== window) {
                safeLogInfo('[JWT Auth] Requesting token refresh due to 401 error', {
                  url: error?.config?.url,
                });
                window.parent.postMessage(
                  {
                    type: 'auth.jwt.token.refresh',
                  },
                  '*' // In production, should specify target origin
                );
              } else {
                safeLogError('[JWT Auth] Cannot request token refresh - not in iframe', {
                  url: error?.config?.url,
                });
              }
            } catch (err) {
              safeLogError('[JWT Auth] Failed to request token refresh on 401 error', {
                error: err.message,
                url: error?.config?.url,
              });
            }
          } else {
            safeLogInfo('[JWT Auth] 401 error (not JWT mode)', {
              mode,
              hasJwtToken: !!jwtToken,
              url: error?.config?.url,
            });
          }
        } else if (status === 403) {
          // Forbidden - insufficient permissions
          if (mode === 'jwt') {
            safeLogError('[JWT Auth] Authentication failed: 403 Forbidden', {
              error: error.message,
              authMode: mode,
              url: error?.config?.url,
              method: error?.config?.method,
            });
          } else {
            safeLogInfo('[JWT Auth] 403 error (not JWT mode)', {
              mode,
              url: error?.config?.url,
            });
          }
        } else {
          // Other errors
          safeLogInfo('[JWT Auth] Response error', {
            status,
            mode,
            url: error?.config?.url,
            method: error?.config?.method,
          });
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

