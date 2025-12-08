# Changelog

## [Unreleased] - 2025-12-08

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
- **Comprehensive Logging**: Added detailed console logging throughout the POST request flow
  - `[Discussion-PostEditor]` logs for form submission
  - `[Discussion-createNewThread]` logs for thunk execution
  - `[Discussion-postThread]` logs for API calls
  - `[Discussion-Interceptor]` logs for request interception
  - All logs use `[Discussion-*]` prefix for easy filtering in browser console
  - Build version check log to verify iframe is using latest build

### Changed
- **POST Request Payload Construction**: Completely refactored `postThread` function to explicitly control which fields are sent
  - Only required fields are included by default
  - Optional fields are conditionally added only if defined
  - Multiple layers of filtering to prevent unwanted fields

### Technical Details
- **Files Modified**:
  - `src/discussions/posts/post-editor/PostEditor.jsx` - Removed `notifyAllLearners` from form submission
  - `src/discussions/posts/data/thunks.js` - Removed `notifyAllLearners` from thunk parameters
  - `src/discussions/posts/data/api.js` - Added explicit field filtering and removal
  - `src/utils/setupAuthInterceptor.js` - Added interceptor-level field removal and logging
  - `src/index.jsx` - Added build version check logging

### Known Issues
- **"My posts" Tab**: The `/api/discussion/v1/courses/{courseId}/learner/` endpoint returns 404 when using JWT authentication
  - This is a backend API limitation - the endpoint does not support JWT authentication
  - Works correctly with cookie-based authentication
  - No frontend workaround available - requires backend support

