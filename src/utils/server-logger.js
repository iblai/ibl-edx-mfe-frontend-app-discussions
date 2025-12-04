/**
 * Server-side logging utility for JWT authentication.
 * Sends logs to a server endpoint that can be captured in Docker logs.
 * Falls back silently if endpoint is not available.
 */

/**
 * Logs JWT authentication events to server (for Docker log visibility).
 * This sends a beacon request that appears in server access logs.
 *
 * @param {string} event - Event name (e.g., 'jwt_token_received', 'auth_mode_determined')
 * @param {Object} data - Event data to log
 */
export function logToServer(event, data = {}) {
  // DEBUGGING: Disable all server logging calls - just show static page
  // TODO: Re-enable when iframe works
  return;

  // Original code commented out for debugging
  // try {
  //   // Create a minimal log endpoint request
  //   // Using a GET request with query params so it shows in access logs
  //   const params = new URLSearchParams({
  //     event,
  //     timestamp: Date.now().toString(),
  //     ...Object.fromEntries(
  //       Object.entries(data).map(([key, value]) => [
  //         key,
  //         typeof value === 'object' ? JSON.stringify(value) : String(value)
  //       ])
  //     ),
  //   });

  //   // Use a beacon or fetch to send log (non-blocking)
  //   // This will appear in server access logs
  //   const logUrl = `/discussions/api/jwt-auth-log?${params.toString()}`;

  //   // Use GET request with fetch (sendBeacon always uses POST)
  //   // This will appear in Docker access logs as GET requests
  //   fetch(logUrl, {
  //     method: 'GET',
  //     keepalive: true,
  //     credentials: 'same-origin'
  //   }).catch(() => {
  //     // Silently fail - logging should never break the app
  //   });
  // } catch (error) {
  //   // Silently fail - logging should never break the app
  //   // console.error('[JWT Auth] Failed to log to server', error);
  // }
}

/**
 * Logs JWT authentication state changes to server
 */
export function logAuthStateToServer(state) {
  logToServer('jwt_auth_state', {
    mode: state.mode,
    inIframe: state.isInIframe,
    hasCookies: state.hasCookies,
    hasJwtToken: !!state.jwtToken,
    jwtLoading: state.jwtLoading,
  });
}

