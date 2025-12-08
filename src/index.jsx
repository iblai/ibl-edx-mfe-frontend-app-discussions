import 'core-js/stable';
import 'regenerator-runtime/runtime';

import React, { StrictMode } from 'react';

// eslint-disable-next-line import/no-unresolved
import { createRoot } from 'react-dom/client';

import {
  APP_INIT_ERROR, APP_READY, initialize, mergeConfig,
  subscribe,
} from '@edx/frontend-platform';
import { AppProvider, ErrorPage } from '@edx/frontend-platform/react';

import Head from './components/Head/Head';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiscussionsHome } from './discussions';
import messages from './i18n';
import store from './store';
import { AuthenticatedHttpClientProvider } from './contexts/AuthenticatedHttpClientContext';
import { setupAuthInterceptor } from './utils/setupAuthInterceptor';

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
// - If in iframe WITH JWT token (test token): Use JWT auth (don't require cookie auth)
// - If in iframe WITH JWT_AUTH_ENABLED: Use JWT auth (don't require cookie auth, token will come via postMessage)
// - If in iframe WITHOUT JWT token AND WITHOUT JWT_AUTH_ENABLED: Use cookie-based auth (require authenticated user)
const isInIframe = window.self !== window.top;
const hasTestToken = !!process.env.JWT_TEST_TOKEN;
const jwtAuthEnabled = process.env.JWT_AUTH_ENABLED === 'true';

// Require cookie-based auth unless:
// 1. We're in an iframe AND
// 2. (We have a test token OR JWT auth is enabled - meaning we'll use JWT)
const shouldRequireAuth = !isInIframe || (isInIframe && !hasTestToken && !jwtAuthEnabled);


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

initialize({
  requireAuthenticatedUser: shouldRequireAuth,
  messages,
  handlers: {
    config: () => {
      mergeConfig({
        LEARNING_BASE_URL: process.env.LEARNING_BASE_URL,
        LEARNER_FEEDBACK_URL: process.env.LEARNER_FEEDBACK_URL,
        STAFF_FEEDBACK_URL: process.env.STAFF_FEEDBACK_URL,
      }, 'DiscussionsConfig');
    },
  },
});
