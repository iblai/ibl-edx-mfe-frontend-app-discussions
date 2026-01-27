import 'core-js/stable';
import 'regenerator-runtime/runtime';

import React, { StrictMode } from 'react';

// eslint-disable-next-line import/no-unresolved
import { createRoot } from 'react-dom/client';

import {
  APP_INIT_ERROR, APP_READY, initialize, mergeConfig,
  subscribe, getConfig,
} from '@edx/frontend-platform';
import {
  fetchAuthenticatedUser,
  ensureAuthenticatedUser,
  setAuthenticatedUser,
  getAuthenticatedUser,
  hydrateAuthenticatedUser,
} from '@edx/frontend-platform/auth';
import { AppProvider, ErrorPage } from '@edx/frontend-platform/react';

import Head from './components/Head/Head';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiscussionsHome } from './discussions';
import messages from './i18n';
import store from './store';
import { AuthenticatedHttpClientProvider } from './contexts/AuthenticatedHttpClientContext';
import { setupAuthInterceptor } from './utils/setupAuthInterceptor';
import { decodeJWT } from './utils/jwt-utils';

import './index.scss';

// Verify we're using local frontend-platform (not npm package)
// This console log confirms webpack aliases are working and resolving to /openedx/frontend-platform/dist
if (typeof window !== 'undefined') {
  console.log('[JWT Auth] Frontend-Platform Verification', {
    source: 'LOCAL BUILD',
    path: '/openedx/frontend-platform/dist',
    note: 'Using local frontend-platform from ibl-edx-mfe-frontend-platform (branch: ibl-develop)',
    webpackAlias: 'Active - @edx/frontend-platform resolves to local build',
  });

  // Build version check - helps verify iframe is using latest build
  console.log('[Discussion-BuildCheck] ===== BUILD VERSION CHECK =====');
  console.log('[Discussion-BuildCheck] Build timestamp:', new Date().toISOString());
  console.log('[Discussion-BuildCheck] Latest commit includes:', 'notify_all_learners removal + interceptor logging');
  console.log('[Discussion-BuildCheck] If you see this log, the latest build is loaded');
  console.log('[Discussion-BuildCheck] If you DON\'T see Discussion logs on submit, the build is cached');
}

// Shared function to render React app - called from both APP_READY and APP_INIT_ERROR (when allowing continue)
let reactRoot = null;
function renderReactApp() {
  // Prevent double rendering
  if (reactRoot) {
    return;
  }

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('[JWT Auth] Cannot render React app - root element not found');
    return;
  }

  reactRoot = createRoot(rootElement);

  // Set up auth interceptor BEFORE rendering (so it's ready for API calls)
  const interceptorCleanup = setupAuthInterceptor();

  reactRoot.render(
    <StrictMode>
      <AppProvider store={store}>
        <AuthenticatedHttpClientProvider>
          <ErrorBoundary>
            <Head />
            <DiscussionsHome />
          </ErrorBoundary>
        </AuthenticatedHttpClientProvider>
      </AppProvider>
    </StrictMode>,
  );
}

subscribe(APP_READY, () => {
  renderReactApp();
});

subscribe(APP_INIT_ERROR, (error) => {
  // Check if we're in JWT iframe mode (custom domain with JWT auth)
  // If so, allow app to continue even if APP_INIT_ERROR fires
  const isInIframe = window.self !== window.top;
  const jwtAuthEnabled = process.env.JWT_AUTH_ENABLED === 'true' || !!process.env.JWT_TEST_TOKEN;
  const isJWTIframeMode = isInIframe && jwtAuthEnabled;

  // Also check for early token stored by index.jsx listener
  const hasEarlyToken = !!window.__EARLY_JWT_TOKEN__;

  if (isJWTIframeMode || (isInIframe && hasEarlyToken)) {
    // Check for JWT token (test token, early token, or from window)
    const hasJwtToken = !!process.env.JWT_TEST_TOKEN || !!window.__JWT_TOKEN__ || hasEarlyToken;

    if (hasJwtToken) {
      console.warn('[JWT Auth] APP_INIT_ERROR in JWT iframe mode - allowing app to continue', {
        hasJwtToken: true,
        hasEarlyToken,
        errorMessage: error?.message,
      });

      // Force render React app after a delay to allow APP_READY to fire if it will
      // If APP_READY doesn't fire, we'll render anyway
      setTimeout(() => {
        if (!reactRoot) {
          console.warn('[JWT Auth] APP_READY did not fire - forcing React render');
          renderReactApp();
        }
      }, 500);
      return;
    }
  }

  // Standard error handling - show error page
  const root = createRoot(document.getElementById('root'));
  root.render(
    <StrictMode>
      <ErrorPage message={error.message} />
    </StrictMode>,
  );
});

// Determine authentication strategy:
// - If NOT in iframe: Always use cookie-based auth (require authenticated user)
// - If in iframe: Don't require auth upfront - let custom auth handler decide based on MFE_CONFIG
const isInIframe = window.self !== window.top;

// For shouldRequireAuth, we only check isInIframe here.
// The actual JWT_AUTH_ENABLED check happens inside customAuthHandler where getConfig() is available.
// If in iframe, don't require auth upfront - let the custom handler decide.
const shouldRequireAuth = !isInIframe;


// Set up message listener IMMEDIATELY to catch JWT tokens before React loads
if (isInIframe) {
  const earlyMessageHandler = (event) => {
    if (event.data?.type === 'auth.jwt.token' && event.data?.edx_jwt_token) {
      // Store token temporarily so useJWTToken hook can pick it up
      window.__EARLY_JWT_TOKEN__ = event.data.edx_jwt_token;
    }
  };
  window.addEventListener('message', earlyMessageHandler);
}

// Send ready message to parent when MFE initializes in iframe
// This happens early, before React components render, to ensure parent knows MFE is ready
if (isInIframe && window.parent && window.parent !== window) {
  try {
    const readyMessage = {
      type: 'auth.jwt.ready',
    };
    window.parent.postMessage(readyMessage, '*');
  } catch (error) {
    console.error('[JWT Auth] Error sending ready message during initialization', {
      error: error.message,
    });
  }
}

/**
 * Custom auth handler that skips the /login_refresh call in JWT mode.
 * In JWT mode, authentication is handled via postMessage from the parent window,
 * not via cookies. This prevents the 401 error from /login_refresh when cookies
 * are blocked in Safari iframe context.
 *
 * NOTE: This handler is called AFTER config is loaded, so getConfig() is available.
 *
 * @param {boolean} requireUser - Whether to redirect to login if not authenticated
 * @param {boolean} hydrateUser - Whether to fetch additional user account data
 */
async function customAuthHandler(requireUser, hydrateUser) {
  // Get JWT_AUTH_ENABLED from MFE_CONFIG (set via Tutor plugin or /api/mfe_config/v1)
  // This is checked here (not at module level) because getConfig() is only available after config loads
  const config = getConfig();
  const jwtAuthEnabled = config.JWT_AUTH_ENABLED === true || config.JWT_AUTH_ENABLED === 'true';
  const hasTestToken = !!config.JWT_TEST_TOKEN;

  // Determine if we should use JWT auth mode
  const useJwtAuthMode = isInIframe && (jwtAuthEnabled || hasTestToken);

  console.log('[JWT Auth] Auth handler called', {
    isInIframe,
    jwtAuthEnabled,
    hasTestToken,
    useJwtAuthMode,
    configKeys: Object.keys(config).filter(k => k.includes('JWT')),
  });

  if (useJwtAuthMode) {
    console.log('[JWT Auth] Using JWT auth mode - skipping cookie-based /login_refresh');

    // Check for early token (from postMessage) or test token from config
    const token = config.JWT_TEST_TOKEN || window.__EARLY_JWT_TOKEN__;

    if (token) {
      // Decode token and set user data
      const decoded = decodeJWT(token);
      if (decoded) {
        const userData = {
          userId: decoded.user_id,
          username: decoded.preferred_username || decoded.username,
          email: decoded.email,
          roles: decoded.roles || [],
          administrator: decoded.administrator || false,
          name: decoded.name,
        };
        setAuthenticatedUser(userData);
        console.log('[JWT Auth] User set from JWT token during init', {
          username: userData.username,
          userId: userData.userId,
        });
      } else {
        console.warn('[JWT Auth] Failed to decode early JWT token');
      }
    } else {
      console.log('[JWT Auth] No early token available - user will be set later via postMessage');
      // Don't set user - it will be set later when token arrives via postMessage
      // The AuthenticatedHttpClientProvider and useJWTToken hook handle this
    }

    // Skip hydrateUser in JWT mode - we don't have cookie auth to make the API call
    return;
  }

  // Cookie mode - use normal auth flow
  console.log('[JWT Auth] Using cookie auth mode');
  if (requireUser) {
    await ensureAuthenticatedUser(globalThis.location.href);
  } else {
    await fetchAuthenticatedUser();
  }

  if (hydrateUser && getAuthenticatedUser() !== null) {
    // We intentionally do not await - additional data is nice-to-have
    hydrateAuthenticatedUser();
  }
}

initialize({
  requireAuthenticatedUser: shouldRequireAuth,
  messages,
  handlers: {
    // Use custom auth handler that skips /login_refresh in JWT mode
    auth: customAuthHandler,
    config: () => {
      mergeConfig({
        LEARNING_BASE_URL: process.env.LEARNING_BASE_URL,
        LEARNER_FEEDBACK_URL: process.env.LEARNER_FEEDBACK_URL,
        STAFF_FEEDBACK_URL: process.env.STAFF_FEEDBACK_URL,
      }, 'DiscussionsConfig');
    },
  },
});
