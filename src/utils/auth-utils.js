import { getConfig } from '@edx/frontend-platform';

/**
 * Detects if the current window is running inside an iframe.
 * @returns {boolean} True if running in an iframe, false otherwise
 */
export function isInIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    // Cross-origin iframe - accessing window.top throws an error
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
      return false;
    }

    const cookies = document.cookie;

    // Check for key OpenEdx session cookies
    const hasSessionId = cookies.includes('sessionid=');
    const hasCsrfToken = cookies.includes('csrftoken=');

    // Consider cookies available if we have at least sessionid and csrftoken
    return hasSessionId && hasCsrfToken;
  } catch (e) {
    // Cross-origin iframe - cookies not accessible
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

    const isInIframe = window.self !== window.top;

    // If we're in an iframe, allow JWT token messages even if JWT_AUTH_ENABLED is false
    // The useAuthMode hook will decide whether to actually use the token for auth
    // This allows the parent to send tokens, and the MFE can decide later if it needs them
    if (!config.JWT_AUTH_ENABLED && !isInIframe) {
      logInfo('[JWT Auth] Origin validation', { origin, valid: false, reason: 'JWT_AUTH_ENABLED is false and not in iframe' });
      return false;
    }

    // Get whitelist from config, fallback to empty array
    const whitelist = config.JWT_AUTH_ORIGIN_WHITELIST;

    // If no whitelist is configured, allow messages when in iframe (parent is sending token)
    // In development mode, allow all origins
    // In production, if in iframe and no whitelist, still allow (parent is trusted)
    if (!whitelist || !Array.isArray(whitelist) || whitelist.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      // If in iframe and no whitelist, allow the message (parent is sending token)
      if (isInIframe) {
        logInfo('[JWT Auth] Origin validation (iframe mode)', { origin, valid: true, reason: 'in iframe - no whitelist' });
        return true;
      }
      logInfo('[JWT Auth] Origin validation', { origin, valid: false, reason: 'whitelist is empty and not in iframe' });
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
    return false;
  }
}

