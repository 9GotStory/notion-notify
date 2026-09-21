import { verifyPhotoTicket } from './photo-ticket.js';

export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export function bearerToken(headers = {}) {
  const raw =
    typeof headers.get === 'function'
      ? headers.get('authorization')
      : headers.authorization || headers.Authorization;

  const value = String(raw || '').trim();
  const match = /^Bearer[ ]+(.+)$/i.exec(value);

  if (match === null) {
    throw new AuthError('Bearer photo ticket is required', 401);
  }

  return match[1];
}

export function authenticateRequest(headers, config, options = {}) {
  let actor;

  try {
    actor = verifyPhotoTicket(
      bearerToken(headers),
      config.ticketSecret,
      options
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(error.message, 401);
  }

  const lifetime = actor.exp - actor.iat;

  if (lifetime > config.ticketTtlSeconds) {
    throw new AuthError('Photo ticket lifetime exceeds policy', 401);
  }

  return actor;
}

export function requireRole(actor, roles) {
  const allowed = new Set(roles);

  if (allowed.has(actor.role) === false) {
    throw new AuthError('Insufficient photo permission', 403);
  }

  return actor;
}
