import { useMemo } from 'react';
import { getConfig } from '@edx/frontend-platform';
import { logInfo } from '@edx/frontend-platform/logging';
import { isInIframe, hasSessionCookies } from '../utils/auth-utils';
import { useJWTToken } from './useJWTToken';
import { logAuthStateToServer } from '../utils/server-logger';

/**
 * React hook that determines the authentication mode to use.
 *
 * Decision logic:
 * - If in iframe AND no cookies available AND JWT token available → use JWT
 * - Otherwise → use cookie-based authentication
 *
 * @returns {Object} Object containing:
 *   - mode: 'cookie' | 'jwt' - The authentication mode to use
 *   - jwtToken: string | null - The JWT token if in JWT mode, null otherwise
 *   - isInIframe: boolean - Whether running in iframe context
 *   - hasCookies: boolean - Whether session cookies are available
 */
export function useAuthMode() {
  const { token: jwtToken, isLoading: jwtLoading } = useJWTToken();

  // Determine if we're in an iframe
  const inIframe = useMemo(() => isInIframe(), []);

  // Check if session cookies are available
  const cookiesAvailable = useMemo(() => hasSessionCookies(), []);

  // Check if JWT auth is enabled via feature flag OR test token is present
  const jwtAuthEnabled = useMemo(() => {
    const config = getConfig();
    // Enable JWT auth if feature flag is on OR if test token is present
    // Get test token from config (merged from env var) or directly from process.env
    const testToken = config?.JWT_TEST_TOKEN || process.env.JWT_TEST_TOKEN;
    const hasTestToken = !!testToken;
    const enabled = config.JWT_AUTH_ENABLED === true || hasTestToken;

    if (hasTestToken) {
      console.log('[JWT Auth] TEST MODE: JWT auth enabled due to test token', {
        tokenLength: testToken.length,
        tokenPreview: testToken.substring(0, 30) + '...',
        fullToken: testToken, // Log full token for testing verification
      });
      logInfo('[JWT Auth] TEST MODE: JWT auth enabled due to test token', {
        tokenLength: testToken.length,
        tokenPreview: testToken.substring(0, 30) + '...',
      });
    }

    return enabled;
  }, []);

  // Determine authentication mode
  const authMode = useMemo(() => {
    // TEST MODE: If test token exists, force JWT mode regardless of iframe/cookies
    const config = getConfig();
    // Get test token from config (merged from env var) or directly from process.env
    const testToken = config?.JWT_TEST_TOKEN || process.env.JWT_TEST_TOKEN;
    const hasTestToken = !!testToken;


    // Priority 1: If cookies are available (same base domain), always use cookie-based auth
    // This works for both direct access and same-origin iframes
    if (cookiesAvailable) {
      logInfo('[JWT Auth] Authentication mode determined', {
        mode: 'cookie',
        reason: inIframe ? 'in iframe but cookies available' : 'direct access with cookies',
      });
      return 'cookie';
    }

    // Priority 2: If in iframe WITHOUT cookies (cross-origin), use JWT if available
    // TEST MODE: If test token exists AND we're in iframe AND no cookies, use JWT
    if (hasTestToken && inIframe && !cookiesAvailable) {
      // Use test token directly if jwtToken from hook is not available yet
      const tokenToUse = jwtToken || testToken;
      logInfo('[JWT Auth] Authentication mode determined (TEST MODE)', {
        mode: 'jwt',
        reason: 'in iframe, no cookies, test token available',
      });
      return 'jwt';
    }

    // Priority 3: If in iframe WITHOUT cookies AND we have a JWT token, use JWT mode
    // This applies even if jwtAuthEnabled is false, because the parent sent us a token
    // The jwtAuthEnabled flag only controls whether we listen for tokens, not whether we use them
    if (inIframe && !cookiesAvailable && jwtToken) {
      logInfo('[JWT Auth] Authentication mode determined', {
        mode: 'jwt',
        reason: jwtAuthEnabled
          ? 'in iframe, no cookies, JWT token available (feature enabled)'
          : 'in iframe, no cookies, JWT token received via postMessage',
      });
      return 'jwt';
    }

    // Default to cookie-based authentication
    // This covers:
    // - Not in iframe (direct access) - always use cookies
    // - In iframe but no JWT token received yet (will wait for token or fallback to cookies)
    // - Cookies are available (same-origin iframe)
    const reason = !inIframe ? 'not in iframe' :
                   cookiesAvailable ? 'cookies available' :
                   !jwtToken ? 'no JWT token' : 'unknown';
    logInfo('[JWT Auth] Authentication mode determined', {
      mode: 'cookie',
      reason,
    });
    return 'cookie';
  }, [jwtAuthEnabled, inIframe, cookiesAvailable, jwtToken]);

  // In TEST MODE, use test token directly if jwtToken from hook is not available
  const config = getConfig();
  const testToken = config?.JWT_TEST_TOKEN || process.env.JWT_TEST_TOKEN;
  const tokenToUse = authMode === 'jwt'
    ? (jwtToken || testToken) // Use test token if jwtToken not available yet
    : null;

  const authState = {
    mode: authMode,
    jwtToken: tokenToUse,
    isInIframe: inIframe,
    hasCookies: cookiesAvailable,
    jwtLoading, // Expose loading state for components that need it
  };


  // Log auth state changes to server for Docker log visibility
  useMemo(() => {
    logAuthStateToServer(authState);
  }, [authMode, inIframe, cookiesAvailable, jwtToken, jwtLoading]);

  return authState;
}

