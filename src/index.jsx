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
  console.log('[JWT Auth] Setting up auth interceptor before rendering');
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

  if (isJWTIframeMode) {
    // Check for JWT token (test token or from window)
    const hasJwtToken = !!process.env.JWT_TEST_TOKEN || !!window.__JWT_TOKEN__;

    if (hasJwtToken) {
      console.warn('[JWT Auth] APP_INIT_ERROR in JWT iframe mode - allowing app to continue', {
        hasJwtToken: true,
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

console.log('[JWT Auth] Initialization auth strategy', {
  isInIframe,
  hasTestToken,
  jwtAuthEnabled,
  willUseJWT: isInIframe && (hasTestToken || jwtAuthEnabled),
  shouldRequireAuth,
  strategy: shouldRequireAuth
    ? 'cookie-based (require authenticated user)'
    : 'JWT (allow unauthenticated, will use JWT token)',
});

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
