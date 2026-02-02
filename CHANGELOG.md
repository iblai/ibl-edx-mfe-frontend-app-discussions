# Changelog

## [0.1.1] - 2026-02-02

### Fixed
- **USE-JWT-COOKIE CORS Fix**: Suppress `USE-JWT-COOKIE` header to prevent CORS preflight failures on direct access
  - When accessing the MFE directly (not in iframe), the backend does not provide JWT tokens
  - The `USE-JWT-COOKIE` header was triggering CORS preflight requests that the server rejected
  - Added `skipUseJwtCookieHeader` flag in auth interceptor to suppress the header
  - MFE now correctly falls back to session cookie authentication on direct access

---

## [0.1.0] - 2026-01-28

### Fixed
- **CORS Error Fix**: Removed `config.headers.common` to fix CORS errors with newer Axios versions
  - Axios was serializing header objects as actual headers, causing preflight failures
  - Now sets `Authorization` header directly on `config.headers` only

- **Safari Iframe 401 Fix**: Skip `/login_refresh` call in JWT iframe mode
  - Prevents 401 errors when cookies are blocked in Safari iframe context
  - Custom auth handler detects JWT mode and skips cookie-based refresh

- **MFE_CONFIG Integration**: Use `MFE_CONFIG` for `JWT_AUTH_ENABLED` instead of `process.env`
  - Allows runtime configuration via Tutor plugin or `/api/mfe_config/v1`
  - JWT_AUTH_ENABLED now properly reads from MFE configuration

### Changed
- **Production Cleanup**: Removed all verbose console.log statements
  - Removed `[JWT Auth]` prefixed debug logs from all files
  - Removed `[Discussion-Interceptor]` debug logs for POST request inspection
  - Removed `[Discussion-postThread]` debug logs for API function calls
  - Removed `[Discussion-createNewThread]` thunk execution logs
  - Removed `[Discussion-PostEditor]` form submission logs
  - Removed `[Discussion-BuildCheck]` build version check logs
  - Kept only essential error logging wrapped in `NODE_ENV === 'development'` check
  - Removed token preview logs that exposed sensitive data
  - Removed unused imports (`logInfo`, `logError`) from cleaned files

### Files Modified in Production Cleanup
- `src/utils/error-logging.js` - Development-only error logging
- `src/utils/auth-utils.js` - Removed cookie/iframe detection logs
- `src/utils/setupAuthInterceptor.js` - Removed interceptor debug logs
- `src/utils/jwt-utils.js` - Removed token decode error log
- `src/index.jsx` - Removed build check and auth handler logs
- `src/hooks/useAuthMode.js` - Removed test mode logs
- `src/hooks/useJWTToken.js` - Removed message/error logs
- `src/contexts/AuthenticatedHttpClientContext.jsx` - Removed sync logs
- `src/components/ErrorBoundary.jsx` - Removed verbose error logs
- `src/discussions/posts/data/api.js` - Removed POST debugging logs
- `src/discussions/posts/data/thunks.js` - Removed thunk execution logs
- `src/discussions/posts/post-editor/PostEditor.jsx` - Removed form submission logs

---

## [Previous] - 2025-12-08

### Fixed
- **POST Request Payload**: Removed `notify_all_learners` field from POST requests to `/api/discussion/v1/threads/` endpoint
  - The backend expects this field not to be initialized to avoid the error: "This field is not initializable."
  - Multiple safeguards implemented to ensure the field is never sent:
    - Removed from `PostEditor.jsx` form submission
    - Removed from `createNewThread` thunk function
    - Removed from `postThread` API function with explicit filtering
    - Added interceptor-level removal as final safety measure
  - POST requests now succeed with 200 OK status

### Added
- **JWT Authentication Support**: Full JWT token-based authentication for iframe embedding
  - `useJWTToken` hook for receiving JWT tokens via postMessage from parent window
  - `useAuthMode` hook for determining authentication mode (cookie vs JWT)
  - `AuthenticatedHttpClientProvider` context for syncing auth state globally
  - `setupAuthInterceptor` for automatically adding JWT Authorization headers
  - Early message listener in `index.jsx` to capture JWT tokens before React loads
  - Ready message (`auth.jwt.ready`) sent to parent window when MFE is initialized
  - Token refresh request on 401 errors or token expiry

- **Error Handling**
  - `ErrorBoundary` component to catch React rendering errors
  - Null checks for `authenticatedUser.username` to prevent errors in JWT mode

### Changed
- **POST Request Payload Construction**: Completely refactored `postThread` function
  - Only required fields are included by default
  - Optional fields are conditionally added only if defined
  - Multiple layers of filtering to prevent unwanted fields

### Known Issues
- **"My posts" Tab**: The `/api/discussion/v1/courses/{courseId}/learner/` endpoint returns 404 with JWT auth
  - This is a backend API limitation - endpoint does not support JWT authentication
  - Works correctly with cookie-based authentication
  - No frontend workaround available - requires backend support

## Configuration

### Environment Variables
- `JWT_AUTH_ENABLED`: Enable JWT authentication mode (set via MFE_CONFIG)
- `JWT_TEST_TOKEN`: Hardcoded test token for development
- `JWT_AUTH_ORIGIN_WHITELIST`: Array of allowed origins for postMessage

### postMessage Protocol
Parent window sends JWT token:
```javascript
{ type: 'auth.jwt.token', edx_jwt_token: '<JWT_TOKEN_STRING>' }
```

MFE signals ready:
```javascript
{ type: 'auth.jwt.ready' }
```

MFE requests token refresh:
```javascript
{ type: 'auth.jwt.token.refresh' }
```

## Security Notes
- `notify_all_learners` field is explicitly removed from all POST requests
- JWT tokens are stored in memory only (React state), never persisted to localStorage
- Origin validation for postMessage to prevent token injection from unauthorized sources
