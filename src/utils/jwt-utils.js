import { logInfo, logError } from '@edx/frontend-platform/logging';

/**
 * Utility functions for JWT token handling.
 * Note: These functions only decode tokens for client-side checks.
 * Token signature verification is done by the backend.
 */

/**
 * Decodes a JWT token without verification.
 * This is safe for client-side expiry checks since we're not verifying the signature.
 *
 * @param {string} token - JWT token string
 * @returns {Object|null} Decoded token payload, or null if invalid
 */
export function decodeJWT(token) {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    // JWT tokens have three parts separated by dots: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    // Base64URL decode
    const payload = parts[1];

    // Replace URL-safe base64 characters
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if needed
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);

    // Decode base64
    const decoded = atob(padded);

    // Parse JSON
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Error decoding JWT token:', error);
    return null;
  }
}

/**
 * Checks if a JWT token is expired.
 *
 * @param {string} token - JWT token string
 * @returns {boolean} True if token is expired or invalid, false otherwise
 */
export function isTokenExpired(token) {
  const decoded = decodeJWT(token);

  if (!decoded) {
    logInfo('[JWT Auth] Token expiry check - invalid token', {});
    return true; // Invalid token is considered expired
  }

  // Check if token has expiration claim
  if (!decoded.exp) {
    logInfo('[JWT Auth] Token expiry check - no expiration claim', {});
    return false; // No expiration claim - assume not expired
  }

  // exp is in seconds since epoch, Date.now() is in milliseconds
  const expirationTime = decoded.exp * 1000;
  const currentTime = Date.now();

  // Add a small buffer (30 seconds) to account for clock skew and request time
  const bufferTime = 30 * 1000; // 30 seconds in milliseconds
  const isExpired = currentTime >= (expirationTime - bufferTime);

  if (isExpired) {
    const expiredBy = currentTime - (expirationTime - bufferTime);
    logInfo('[JWT Auth] Token expiry check - expired', {
      expiredByMs: expiredBy,
      expiredByMinutes: Math.round(expiredBy / 60000),
      expirationTime: new Date(expirationTime).toISOString(),
      currentTime: new Date(currentTime).toISOString(),
    });
  } else {
    const timeUntilExpiration = (expirationTime - bufferTime) - currentTime;
    logInfo('[JWT Auth] Token expiry check - valid', {
      timeUntilExpirationMs: timeUntilExpiration,
      timeUntilExpirationMinutes: timeUntilExpiration ? Math.round(timeUntilExpiration / 60000) : null,
      expirationTime: new Date(expirationTime).toISOString(),
    });
  }

  return isExpired;
}

/**
 * Gets the expiration time of a JWT token.
 *
 * @param {string} token - JWT token string
 * @returns {Date|null} Expiration date, or null if invalid or no expiration
 */
export function getTokenExpiration(token) {
  const decoded = decodeJWT(token);

  if (!decoded || !decoded.exp) {
    return null;
  }

  return new Date(decoded.exp * 1000);
}

/**
 * Gets the time until token expiration in milliseconds.
 *
 * @param {string} token - JWT token string
 * @returns {number|null} Milliseconds until expiration, or null if invalid/expired
 */
export function getTimeUntilExpiration(token) {
  const expiration = getTokenExpiration(token);

  if (!expiration) {
    return null;
  }

  const timeUntilExpiration = expiration.getTime() - Date.now();
  return timeUntilExpiration > 0 ? timeUntilExpiration : null;
}

