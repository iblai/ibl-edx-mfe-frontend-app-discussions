import React from 'react';
import { ErrorPage } from '@edx/frontend-platform/react';
import { logErrorDetails } from '../utils/error-logging';
import { logToServer } from '../utils/server-logger';

/**
 * React Error Boundary to catch component errors.
 * This catches errors that occur during rendering, in lifecycle methods, etc.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log detailed error information
    const context = {
      errorType: 'react_error_boundary',
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    };

    logErrorDetails(error, context);

    // Also log to server
    logToServer('react_error_boundary', {
      message: error.message,
      name: error.name,
      componentStack: errorInfo.componentStack,
      stack: error.stack,
    });

    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      // Render custom fallback UI or default ErrorPage
      const errorMessage = this.state.error?.message || 'An unexpected error occurred.';

      console.error('[JWT Auth] ErrorBoundary: Rendering error page', {
        error: this.state.error,
        errorMessage: this.state.error?.message,
        errorName: this.state.error?.name,
        errorStack: this.state.error?.stack,
        errorInfo: this.state.errorInfo,
        componentStack: this.state.errorInfo?.componentStack,
      });
      // Also log error message prominently
      console.error('[JWT Auth] ErrorBoundary ERROR:', this.state.error?.message || 'Unknown error');
      console.error('[JWT Auth] ErrorBoundary STACK:', this.state.error?.stack);

      return (
        <ErrorPage
          message={errorMessage}
          error={this.state.error}
          errorInfo={this.state.errorInfo}
        />
      );
    }

    return this.props.children;
  }
}

