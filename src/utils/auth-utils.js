import { getConfig } from '@edx/frontend-platform';
import { logInfo, logError } from '@edx/frontend-platform/logging';

/**
 * Detects if the current window is running inside an iframe.
 * @returns {boolean} True if running in an iframe, false otherwise
 */
export function isInIframe() {
  try {
    const inIframe = window.self !== window.top;
    console.log('[JWT Auth] Iframe detection', { inIframe });
    logInfo('[JWT Auth] Iframe detection', { inIframe });
    return inIframe;
  } catch (e) {
    // Cross-origin iframe - accessing window.top throws an error
    // This means we're definitely in an iframe
    console.log('[JWT Auth] Iframe detection (cross-origin)', { inIframe: true, error: e.message });
    logInfo('[JWT Auth] Iframe detection (cross-origin)', { inIframe: true, error: e.message });
    return true;
  }
}

/**
 * Checks if OpenEdx session cookies are available.
 * In cross-origin iframe contexts, cookies may not be accessible due to browser security restrictions.
 * @returns {boolean} True if session cookies are available, false otherwise
 */
export function hasSessionCookies() {
  try {
    // Check if we can access document.cookie
    if (typeof document === 'undefined' || !document.cookie) {
      console.log('[JWT Auth] Cookie check', {
        hasCookies: false,
        reason: 'document.cookie not available',
        documentAvailable: typeof document !== 'undefined',
        cookieString: typeof document !== 'undefined' ? document.cookie : 'N/A',
      });
      logInfo('[JWT Auth] Cookie check', { hasCookies: false, reason: 'document.cookie not available' });
      return false;
    }

    const cookies = document.cookie;

    // Parse cookies into an object for easier inspection
    const cookieObj = {};
    if (cookies) {
      cookies.split(';').forEach(cookie => {
        const [name, ...valueParts] = cookie.trim().split('=');
        if (name) {
          cookieObj[name] = valueParts.join('='); // Rejoin in case value contains '='
        }
      });
    }

    // Check for key OpenEdx session cookies
    const hasSessionId = cookies.includes('sessionid=');
    const hasCsrfToken = cookies.includes('csrftoken=');

    // Optional: Check for JWT cookie (may be present in some setups)
    const hasJwtCookie = cookies.includes('edx-jwt-cookie-header-payload=');
    const hasJwtSignature = cookies.includes('edx-jwt-cookie-signature=');
    const hasUserInfo = cookies.includes('edx-user-info=');

    // Consider cookies available if we have at least sessionid and csrftoken
    const hasCookies = hasSessionId && hasCsrfToken;

    // Log all cookie names found (for debugging)
    const cookieNames = Object.keys(cookieObj);
    const edxCookieNames = cookieNames.filter(name =>
      name.includes('edx') ||
      name.includes('sessionid') ||
      name.includes('csrftoken') ||
      name.includes('ibl_')
    );

    console.log('[JWT Auth] Cookie check - detailed', {
      hasCookies,
      hasSessionId,
      hasCsrfToken,
      hasJwtCookie,
      hasJwtSignature,
      hasUserInfo,
      cookieLength: cookies.length,
      totalCookieCount: cookieNames.length,
      allCookieNames: cookieNames,
      edxRelatedCookies: edxCookieNames,
      sessionIdValue: cookieObj.sessionid ? `${cookieObj.sessionid.substring(0, 20)}...` : 'NOT FOUND',
      csrfTokenValue: cookieObj.csrftoken ? `${cookieObj.csrftoken.substring(0, 20)}...` : 'NOT FOUND',
      jwtCookieValue: cookieObj['edx-jwt-cookie-header-payload'] ? `${cookieObj['edx-jwt-cookie-header-payload'].substring(0, 30)}...` : 'NOT FOUND',
      fullCookieString: cookies, // Log full cookie string for complete visibility
    });

    logInfo('[JWT Auth] Cookie check', {
      hasCookies,
      hasSessionId,
      hasCsrfToken,
      hasJwtCookie,
      hasJwtSignature,
      hasUserInfo,
      cookieLength: cookies.length,
      totalCookieCount: cookieNames.length,
      edxRelatedCookies: edxCookieNames,
    });

    return hasCookies;
  } catch (e) {
    // Cross-origin iframe - cookies not accessible
    // This is expected in cross-origin scenarios
    console.log('[JWT Auth] Cookie check (cross-origin)', {
      hasCookies: false,
      error: e.message,
      errorType: e.name,
      stack: e.stack,
    });
    logInfo('[JWT Auth] Cookie check (cross-origin)', { hasCookies: false, error: e.message });
    return false;
  }
}

/**
 * Validates the origin of a postMessage event against a whitelist.
 * This is a security measure to prevent accepting messages from untrusted origins.
 * @param {string} origin - The origin of the message (from event.origin)
 * @returns {boolean} True if origin is whitelisted, false otherwise
 */
export function validateMessageOrigin(origin) {
  try {
    // Get config
    const config = getConfig();

    // Check if JWT auth is enabled
    if (!config.JWT_AUTH_ENABLED) {
      logInfo('[JWT Auth] Origin validation', { origin, valid: false, reason: 'JWT_AUTH_ENABLED is false' });
      return false;
    }

    // Get whitelist from config, fallback to empty array
    const whitelist = config.JWT_AUTH_ORIGIN_WHITELIST;

    // If no whitelist is configured, reject all messages for security
    if (!whitelist || !Array.isArray(whitelist) || whitelist.length === 0) {
      // In development, you might want to allow all origins for testing
      // In production, this should always reject if whitelist is empty
      if (process.env.NODE_ENV === 'development') {
        console.warn('[JWT Auth] JWT_AUTH_ORIGIN_WHITELIST is not configured. Allowing all origins in development mode.');
        logInfo('[JWT Auth] Origin validation (dev mode)', { origin, valid: true, reason: 'development mode - no whitelist' });
        return true;
      }
      logInfo('[JWT Auth] Origin validation', { origin, valid: false, reason: 'whitelist is empty' });
      return false;
    }

    // Check if origin matches any whitelisted origin
    // Support both exact matches and wildcard subdomain matches
    const isValid = whitelist.some((allowedOrigin) => {
      // Exact match
      if (origin === allowedOrigin) {
        return true;
      }

      // Wildcard subdomain match (e.g., *.example.com matches subdomain.example.com)
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.slice(2); // Remove '*.' prefix
        try {
          const originUrl = new URL(origin);
          const originHostname = originUrl.hostname;

          // Check if origin hostname ends with the domain
          // e.g., 'subdomain.example.com' ends with 'example.com'
          if (originHostname === domain || originHostname.endsWith(`.${domain}`)) {
            return true;
          }
        } catch (e) {
          // Invalid URL format
          return false;
        }
      }

      return false;
    });

    logInfo('[JWT Auth] Origin validation', { origin, valid: isValid, whitelist });
    return isValid;
  } catch (e) {
    // Error in validation - reject for security
    logError('[JWT Auth] Error validating message origin', { origin, error: e.message });
    return false;
  }
}

