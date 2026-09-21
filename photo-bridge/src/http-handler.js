import {
  AuthError,
  authenticateRequest,
  requireRole,
} from './auth.js';

function response(status, body) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body,
  };
}

function safeActor(actor) {
  return {
    sub: actor.sub,
    staffKey: actor.staffKey,
    role: actor.role,
    exp: actor.exp,
  };
}

export function handleHttpRequest(request, context) {
  const method = String(request.method || 'GET').toUpperCase();
  const url = new URL(request.url, 'http://localhost');

  if (method === 'GET' && url.pathname === '/health') {
    return response(200, {
      ok: true,
      service: 'photo-bridge',
    });
  }

  try {
    const actor = authenticateRequest(
      request.headers || {},
      context.config,
      context.authOptions || {}
    );

    if (method === 'GET' && url.pathname === '/v1/session') {
      return response(200, {
        ok: true,
        actor: safeActor(actor),
      });
    }

    if (method === 'GET' && url.pathname === '/v1/manager/session') {
      requireRole(actor, ['manager', 'admin']);

      return response(200, {
        ok: true,
        actor: safeActor(actor),
      });
    }

    return response(404, {
      ok: false,
      error: 'Not found',
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return response(error.statusCode, {
        ok: false,
        error: error.message,
      });
    }

    return response(500, {
      ok: false,
      error: 'Internal server error',
    });
  }
}
