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

  // Check for early token stored by index.jsx listener (before React loaded)
  const earlyToken = window.__EARLY_JWT_TOKEN__ || null;
  if (earlyToken) {
    // Clear it so it's only used once
    delete window.__EARLY_JWT_TOKEN__;
  }

  // Log test token presence for production monitoring
  if (testToken) {
    const tokenPreview = testToken.substring(0, 50) + '...';
    const tokenLength = testToken.length;
    logInfo('[JWT Auth] TEST MODE: Hardcoded JWT token detected', {
      tokenLength,
      tokenPreview,
      hasToken: true,
    });
  }

  // Initialize with test token, early token, or null
  const initialToken = testToken || earlyToken || null;
  const [token, setToken] = useState(initialToken); // Initialize with test token or early token if available
  const [isLoading, setIsLoading] = useState(!initialToken); // If token exists, not loading
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
      logInfo('[JWT Auth] Received postMessage', { origin: event.origin, type: event.data?.type });

      // Validate message origin for security
      const originValid = validateMessageOrigin(event.origin);

      if (!originValid) {
        console.warn('[JWT Auth] Message rejected - origin not whitelisted', {
          origin: event.origin,
          messageType: event.data?.type,
        });
        logInfo('[JWT Auth] Message rejected - origin not whitelisted', { origin: event.origin });
        return;
      }

      const { data } = event;

      // Check if this is a JWT token message
      if (!data || data.type !== 'auth.jwt.token') {
        logInfo('[JWT Auth] Message ignored - not a JWT token message', { type: data?.type });
        return;
      }

      // Extract token from message
      const jwtToken = data.edx_jwt_token || data.token;

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

  // Log hook initialization for production monitoring
  useEffect(() => {
    const inIframe = window.self !== window.top;
    logInfo('[JWT Auth] useJWTToken hook initialized', {
      inIframe,
      hasTestToken: !!testToken,
    });

    // Send ready message to parent window when hook is initialized (if in iframe)
    // Always send ready message if in iframe, regardless of jwtAuthEnabled
    const hasParent = window.parent && window.parent !== window;
    if (inIframe && hasParent) {
      try {
        const readyMessage = {
          type: 'auth.jwt.ready',
        };
        window.parent.postMessage(readyMessage, '*');
        logInfo('[JWT Auth] Ready message sent to parent', {});
      } catch (error) {
        console.error('[JWT Auth] Error sending ready message to parent', {
          error: error.message,
        });
        logError('[JWT Auth] Error sending ready message to parent', { error: error.message });
      }
    }
  }, [testToken]);

  // Listen for postMessage events (after initialization logging)
  useEventListener('message', receiveMessage);

  // Add a global message listener for debugging - logs ALL messages before filtering
  // Set this up immediately, not in useEffect, to catch early messages
  // Global message listener is handled by receiveMessage callback
  // No need for separate global listener in production

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

