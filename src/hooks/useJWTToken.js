import { useCallback, useState, useEffect, useRef } from 'react';
import { useEventListener } from '../generic/hooks';
import { validateMessageOrigin } from '../utils/auth-utils';
import { isTokenExpired, getTimeUntilExpiration } from '../utils/jwt-utils';
import { logInfo, logError } from '@edx/frontend-platform/logging';
import { logToServer } from '../utils/server-logger';
import { getConfig } from '@edx/frontend-platform';

/**
 * React hook that listens for JWT tokens sent via postMessage from the parent window.
 * The token is stored in memory (component state) and never persisted to localStorage.
 *
 * Expected message format from parent:
 * {
 *   type: 'auth.jwt.token',
 *   edx_jwt_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 * }
 *
 * @returns {Object} Object containing:
 *   - token: string | null - The JWT token if received, null otherwise
 *   - isLoading: boolean - True while waiting for initial token
 *   - error: string | null - Error message if token reception fails
 */
export function useJWTToken() {
  // TEST MODE: Allow hardcoded JWT token for testing
  // Get from config (set via environment variable: JWT_TEST_TOKEN at build time)
  const config = getConfig();
  const testToken = config?.JWT_TEST_TOKEN || process.env.JWT_TEST_TOKEN || null;

  // Log test token presence - log full token for verification in test mode
  if (testToken) {
    const tokenPreview = testToken.substring(0, 50) + '...';
    const tokenLength = testToken.length;
    console.log('[JWT Auth] TEST MODE: Hardcoded JWT token detected', {
      tokenLength,
      tokenPreview,
      hasToken: true,
      tokenStart: testToken.substring(0, 20),
      // Log full token for verification (test mode only)
      testTokenFull: testToken,
    });
    logInfo('[JWT Auth] TEST MODE: Hardcoded JWT token detected', {
      tokenLength,
      tokenPreview,
      hasToken: true,
    });
  } else {
    console.log('[JWT Auth] No test token found - will listen for postMessage', {
      configAvailable: !!config,
      configKeys: config ? Object.keys(config).filter(k => k.includes('JWT')) : [],
      processEnvToken: !!process.env.JWT_TEST_TOKEN,
    });
  }

  const [token, setToken] = useState(testToken); // Initialize with test token if available
  const [isLoading, setIsLoading] = useState(!testToken); // If test token exists, not loading
  const [error, setError] = useState(null);
  const expiryCheckIntervalRef = useRef(null);
  const refreshRequestedRef = useRef(false);

  /**
   * Request token refresh from parent window.
   * Sends a postMessage to parent requesting a new token.
   */
  const requestTokenRefresh = useCallback(() => {
    // Prevent multiple simultaneous refresh requests
    if (refreshRequestedRef.current) {
      logInfo('[JWT Auth] Token refresh already requested, skipping', {});
      return;
    }

    try {
      if (window.parent && window.parent !== window) {
        logInfo('[JWT Auth] Requesting token refresh from parent', {});
        refreshRequestedRef.current = true;
        window.parent.postMessage(
          {
            type: 'auth.jwt.token.refresh',
          },
          '*' // In production, should specify target origin
        );
        setIsLoading(true);
        setError(null);

        // Reset refresh request flag after a delay
        setTimeout(() => {
          refreshRequestedRef.current = false;
          logInfo('[JWT Auth] Token refresh cooldown expired', {});
        }, 5000); // 5 second cooldown
      } else {
        logError('[JWT Auth] Cannot request token refresh - not in iframe', {});
      }
    } catch (err) {
      logError('[JWT Auth] Error requesting token refresh', { error: err.message });
      setError('Failed to request token refresh');
      refreshRequestedRef.current = false;
    }
  }, []);

  /**
   * Sets up an interval to check token expiry and request refresh if needed.
   *
   * @param {string} currentToken - The current JWT token
   */
  const setupExpiryCheck = useCallback((currentToken) => {
    // Clear any existing interval
    if (expiryCheckIntervalRef.current) {
      clearInterval(expiryCheckIntervalRef.current);
      expiryCheckIntervalRef.current = null;
    }

    if (!currentToken) {
      return;
    }

    // Get time until expiration
    const timeUntilExpiration = getTimeUntilExpiration(currentToken);

    if (!timeUntilExpiration) {
      // Token is expired or invalid
      requestTokenRefresh();
      return;
    }

    // Check every minute, or when token is about to expire (whichever is sooner)
    const checkInterval = Math.min(60000, timeUntilExpiration / 2); // Check at least every minute, or halfway to expiry

    logInfo('[JWT Auth] Setting up token expiry check', {
      checkIntervalMs: checkInterval,
      checkIntervalMinutes: Math.round(checkInterval / 60000),
      timeUntilExpirationMs: timeUntilExpiration,
    });

    // Set up interval to check token expiry
    expiryCheckIntervalRef.current = setInterval(() => {
      if (isTokenExpired(currentToken)) {
        logInfo('[JWT Auth] Token expired during expiry check - requesting refresh', {});
        // Token expired - request refresh
        requestTokenRefresh();
        // Clear interval
        if (expiryCheckIntervalRef.current) {
          clearInterval(expiryCheckIntervalRef.current);
          expiryCheckIntervalRef.current = null;
        }
      }
    }, checkInterval);
  }, [requestTokenRefresh]);

  /**
   * Handles incoming postMessage events for JWT token.
   * Validates origin and extracts token from message.
   */
  const receiveMessage = useCallback((event) => {
    try {
      // Force console output for iframe debugging - log ALL messages first
      console.log('[JWT Auth] Received postMessage (ALL MESSAGES)', {
        origin: event.origin,
        type: event.data?.type,
        hasData: !!event.data,
        dataKeys: event.data ? Object.keys(event.data) : [],
        fullData: event.data,
        source: event.source,
        timestamp: new Date().toISOString(),
      });
      logInfo('[JWT Auth] Received postMessage', { origin: event.origin, type: event.data?.type });

      // Validate message origin for security
      const originValid = validateMessageOrigin(event.origin);
      console.log('[JWT Auth] Origin validation result', {
        origin: event.origin,
        isValid: originValid,
        timestamp: new Date().toISOString(),
      });

      if (!originValid) {
        // Log rejection with more details
        console.warn('[JWT Auth] Message rejected - origin not whitelisted', {
          origin: event.origin,
          messageType: event.data?.type,
          timestamp: new Date().toISOString(),
        });
        logInfo('[JWT Auth] Message rejected - origin not whitelisted', { origin: event.origin });
        return;
      }

      const { data } = event;
      console.log('[JWT Auth] Message passed origin validation', {
        origin: event.origin,
        dataType: data?.type,
        hasData: !!data,
        timestamp: new Date().toISOString(),
      });

      // Check if this is a JWT token message
      if (!data || data.type !== 'auth.jwt.token') {
        console.log('[JWT Auth] Message ignored - not a JWT token message', {
          type: data?.type,
          expectedType: 'auth.jwt.token',
          hasData: !!data,
          timestamp: new Date().toISOString(),
        });
        logInfo('[JWT Auth] Message ignored - not a JWT token message', { type: data?.type });
        return;
      }

      // Extract token from message
      const jwtToken = data.edx_jwt_token || data.token;
      console.log('[JWT Auth] Extracting token from message', {
        hasEdxJwtToken: !!data.edx_jwt_token,
        hasToken: !!data.token,
        jwtTokenLength: jwtToken?.length || 0,
        timestamp: new Date().toISOString(),
      });

      if (!jwtToken) {
        console.error('[JWT Auth] JWT token not found in message', {
          dataKeys: Object.keys(data),
          hasEdxJwtToken: !!data.edx_jwt_token,
          hasToken: !!data.token,
          timestamp: new Date().toISOString(),
        });
        setError('JWT token not found in message');
        setIsLoading(false);
        return;
      }

      // Validate token format (basic check - should start with typical JWT pattern)
      if (typeof jwtToken !== 'string' || jwtToken.trim().length === 0) {
        setError('Invalid JWT token format');
        setIsLoading(false);
        return;
      }

      // Store token in memory (state)
      const trimmedToken = jwtToken.trim();
      const tokenLength = trimmedToken.length;
      const tokenPreview = trimmedToken.substring(0, 20) + '...';

      console.log('[JWT Auth] JWT token received and validated', {
        tokenLength,
        tokenPreview,
        hasToken: !!trimmedToken,
        tokenStart: trimmedToken.substring(0, 30),
        timestamp: new Date().toISOString(),
      });
      logInfo('[JWT Auth] JWT token received', {
        tokenLength,
        tokenPreview,
        hasToken: !!trimmedToken,
      });

      // Log to server for Docker log visibility
      logToServer('jwt_token_received', {
        tokenLength,
        hasToken: true,
        inIframe: window.self !== window.top,
      });

      setToken(trimmedToken);
      setError(null);
      setIsLoading(false);
      refreshRequestedRef.current = false; // Reset refresh request flag

      // Check if token is already expired
      if (isTokenExpired(trimmedToken)) {
        logError('[JWT Auth] Token is expired on receipt', { tokenPreview });
        setError('JWT token is expired');
        // Request new token
        requestTokenRefresh();
      } else {
        const timeUntilExpiration = getTimeUntilExpiration(trimmedToken);
        logInfo('[JWT Auth] Token is valid', {
          timeUntilExpirationMs: timeUntilExpiration,
          timeUntilExpirationMinutes: timeUntilExpiration ? Math.round(timeUntilExpiration / 60000) : null,
        });
        // Set up expiry check interval
        setupExpiryCheck(trimmedToken);
      }
    } catch (err) {
      console.error('Error processing JWT token message:', err);
      setError('Failed to process JWT token message');
      setIsLoading(false);
    }
  }, [requestTokenRefresh, setupExpiryCheck]);

  // Log hook initialization with both console.log and logInfo
  useEffect(() => {
    const inIframe = window.self !== window.top;
    const logData = {
      inIframe,
      hasTestToken: !!testToken,
      tokenLength: testToken ? testToken.length : 0,
      tokenPreview: testToken ? testToken.substring(0, 30) + '...' : null,
    };

    // Use console.log to ensure visibility even if logInfo doesn't work
    // Force output to console with multiple methods
    if (testToken) {
      console.log('[JWT Auth] TEST MODE: Using hardcoded JWT token', {
        tokenLength: testToken.length,
        tokenPreview: testToken.substring(0, 30) + '...',
        tokenStart: testToken.substring(0, 20),
        tokenEnd: '...' + testToken.substring(testToken.length - 10),
        fullToken: testToken, // Log full token for testing (remove in production)
      });
      console.log('[JWT Auth] useJWTToken hook initialized - TEST MODE with hardcoded token', logData);
    } else {
      console.log('[JWT Auth] useJWTToken hook initialized - listening for JWT tokens via postMessage', logData);
    }
    console.info('[JWT Auth] useJWTToken hook initialized', logData);
    logInfo('[JWT Auth] useJWTToken hook initialized', logData);

    // Log to server for Docker log visibility
    logToServer('jwt_hook_initialized', logData);

    // Send ready message to parent window when hook is initialized (if in iframe)
    // Always send ready message if in iframe, regardless of jwtAuthEnabled
    // This allows the parent to know the MFE is ready to receive JWT tokens
    const hasParent = window.parent && window.parent !== window;
    console.log('[JWT Auth] Checking if ready message should be sent', {
      inIframe,
      hasParent,
      willSend: inIframe && hasParent,
      timestamp: new Date().toISOString(),
    });

    if (inIframe && hasParent) {
      try {
        const readyMessage = {
          type: 'auth.jwt.ready',
        };
        console.log('[JWT Auth] Sending ready message to parent window', {
          message: readyMessage,
          parentExists: !!window.parent,
          parentSameAsSelf: window.parent === window,
          timestamp: new Date().toISOString(),
        });
        // Send to parent - use '*' for origin since we don't know the parent origin
        // The parent will validate the origin on their side
        window.parent.postMessage(readyMessage, '*');
        console.log('[JWT Auth] ✅ Ready message sent successfully', {
          timestamp: new Date().toISOString(),
        });
        logInfo('[JWT Auth] Ready message sent to parent', {});
      } catch (error) {
        console.error('[JWT Auth] ❌ Error sending ready message to parent', {
          error: error.message,
          errorStack: error.stack,
          timestamp: new Date().toISOString(),
        });
        logError('[JWT Auth] Error sending ready message to parent', { error: error.message });
      }
    } else {
      console.log('[JWT Auth] Not sending ready message', {
        reason: !inIframe ? 'not in iframe' : !hasParent ? 'no parent window' : 'unknown',
        inIframe,
        hasParent,
        timestamp: new Date().toISOString(),
      });
    }
  }, [testToken]);

  // Listen for postMessage events (after initialization logging)
  useEventListener('message', receiveMessage);

  // Add a global message listener for debugging - logs ALL messages before filtering
  useEffect(() => {
    const globalMessageHandler = (event) => {
      // Only log messages that might be JWT-related or from parent
      if (event.data?.type === 'auth.jwt.token' || event.origin) {
        console.log('[JWT Auth] Global message listener caught postMessage', {
          origin: event.origin,
          type: event.data?.type,
          hasData: !!event.data,
          source: event.source,
          isFromParent: event.source === window.parent,
          timestamp: new Date().toISOString(),
        });
      }
    };

    window.addEventListener('message', globalMessageHandler);
    console.log('[JWT Auth] Global message listener registered', {
      timestamp: new Date().toISOString(),
    });

    return () => {
      window.removeEventListener('message', globalMessageHandler);
    };
  }, []);

  /**
   * Clear the stored token.
   * Useful for logout or error recovery.
   */
  const clearToken = useCallback(() => {
    setToken(null);
    setError(null);
    setIsLoading(false);

    // Clear expiry check interval
    if (expiryCheckIntervalRef.current) {
      clearInterval(expiryCheckIntervalRef.current);
      expiryCheckIntervalRef.current = null;
    }

    refreshRequestedRef.current = false;
  }, []);

  // Set initial loading state timeout
  // If no token is received within a reasonable time, stop loading
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isLoading && !token) {
        // No token received - this might be normal if cookies are available
        // Don't set error, just stop loading
        logInfo('[JWT Auth] No JWT token received within timeout - this is normal if cookies are available', {
          timeoutMs: 5000,
        });
        setIsLoading(false);
      }
    }, 5000); // 5 second timeout

    return () => clearTimeout(timeout);
  }, [isLoading, token]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (expiryCheckIntervalRef.current) {
        clearInterval(expiryCheckIntervalRef.current);
        expiryCheckIntervalRef.current = null;
      }
    };
  }, []);

  return {
    token,
    isLoading,
    error,
    requestTokenRefresh,
    clearToken,
  };
}

