import React, { createContext, useContext, useEffect } from 'react';
import PropTypes from 'prop-types';
import { getAuthenticatedHttpClient } from '@edx/frontend-platform/auth';
import { useAuthMode } from '../hooks/useAuthMode';
import { setGlobalAuthState } from '../utils/setupAuthInterceptor';

/**
 * Context for providing authenticated HTTP client to components.
 * The client is configured based on the current authentication mode (cookie or JWT).
 */
const AuthenticatedHttpClientContext = createContext(null);

/**
 * Provider component that syncs authentication state to global state.
 * This allows the global interceptor to access current auth state for API calls.
 *
 * The provider also provides the HTTP client via context for components that need it,
 * though most API functions will use getAuthenticatedHttpClient() directly.
 *
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function AuthenticatedHttpClientProvider({ children }) {
  const { mode: authMode, jwtToken } = useAuthMode();
  const client = getAuthenticatedHttpClient();

  // Sync auth state to global state for the interceptor
  useEffect(() => {
    setGlobalAuthState(authMode, jwtToken);
  }, [authMode, jwtToken]);

  return (
    <AuthenticatedHttpClientContext.Provider value={client}>
      {children}
    </AuthenticatedHttpClientContext.Provider>
  );
}

AuthenticatedHttpClientProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

/**
 * Hook to access the authenticated HTTP client from context.
 *
 * @returns {Object} The authenticated axios client instance
 * @throws {Error} If used outside of AuthenticatedHttpClientProvider
 */
export function useAuthenticatedHttpClient() {
  const client = useContext(AuthenticatedHttpClientContext);
  if (!client) {
    throw new Error('useAuthenticatedHttpClient must be used within AuthenticatedHttpClientProvider');
  }
  return client;
}

