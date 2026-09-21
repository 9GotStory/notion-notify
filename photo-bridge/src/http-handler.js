import {
  AuthError,
  authenticateRequest,
  requireRole,
} from './auth.js';

import { ArchiveInputError } from './archive-service.js';

import {
  UploadConflictError,
  UploadPolicyError,
} from './upload-service.js';

import {
  ManagerConflictError,
  ManagerNotFoundError,
} from './manager-service.js';

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

export async function handleHttpRequest(request, context) {
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

    if (method === 'GET' && url.pathname === '/v1/topics') {
      if (!context.archiveService) {
        throw new Error('Archive service unavailable');
      }

      const topics =
        await context.archiveService.listSelectableTopics();

      return response(200, {
        ok: true,
        topics,
      });
    }

    if (
      method === 'GET' &&
      url.pathname === '/v1/activities'
    ) {
      if (!context.archiveService) {
        throw new Error('Archive service unavailable');
      }

      const activities =
        await context.archiveService.listActivities(
          url.searchParams.get('topic'),
          url.searchParams.get('year')
        );

      return response(200, {
        ok: true,
        activities,
      });
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/activities'
    ) {
      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body)
      ) {
        throw new ArchiveInputError(
          'JSON body is required'
        );
      }

      if (!context.archiveService) {
        throw new Error('Archive service unavailable');
      }

      const result =
        await context.archiveService.createActivity(
          request.body.topic,
          request.body.year,
          request.body.activityName
        );

      return response(
        result.created ? 201 : 200,
        {
          ok: true,
          created: result.created,
          activity: result.activity,
        }
      );
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/uploads'
    ) {
      if (!context.uploadService) {
        throw new Error('Upload service unavailable');
      }

      const file =
        await context.uploadService.uploadToActivity({
          topic: url.searchParams.get('topic'),
          year: url.searchParams.get('year'),
          activityName:
            url.searchParams.get('activity'),
          filename:
            url.searchParams.get('filename'),
          content: request.body,
        });

      return response(201, {
        ok: true,
        file,
      });
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/inbox/uploads'
    ) {
      if (!context.uploadService) {
        throw new Error('Upload service unavailable');
      }

      const file =
        await context.uploadService.uploadToInbox({
          filename:
            url.searchParams.get('filename'),
          content: request.body,
        });

      return response(201, {
        ok: true,
        file,
      });
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/archive'
    ) {
      requireRole(actor, ['manager', 'admin']);

      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body)
      ) {
        throw new ArchiveInputError(
          'JSON body is required'
        );
      }

      if (!context.managerService) {
        throw new Error(
          'Manager service unavailable'
        );
      }

      const result =
        await context.managerService.archiveActivity({
          topic: request.body.topic,
          year: request.body.year,
          activityName:
            request.body.activityName,
        });

      return response(200, {
        ok: true,
        archived: result,
      });
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/rename'
    ) {
      requireRole(actor, ['manager', 'admin']);

      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body)
      ) {
        throw new ArchiveInputError(
          'JSON body is required'
        );
      }

      if (!context.managerService) {
        throw new Error(
          'Manager service unavailable'
        );
      }

      const result =
        await context.managerService.renameActivity({
          topic: request.body.topic,
          year: request.body.year,
          activityName:
            request.body.activityName,
          newActivityName:
            request.body.newActivityName,
        });

      return response(200, {
        ok: true,
        renamed: result,
      });
    }

    if (
      method === 'POST' &&
      url.pathname === '/v1/move'
    ) {
      requireRole(actor, ['manager', 'admin']);

      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body)
      ) {
        throw new ArchiveInputError(
          'JSON body is required'
        );
      }

      if (!context.managerService) {
        throw new Error(
          'Manager service unavailable'
        );
      }

      const result =
        await context.managerService.moveFromInbox({
          filename: request.body.filename,
          topic: request.body.topic,
          year: request.body.year,
          activityName:
            request.body.activityName,
        });

      return response(200, {
        ok: true,
        moved: result,
      });
    }

    if (
      method === 'GET' &&
      url.pathname === '/v1/manager/session'
    ) {
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
    if (
      error instanceof AuthError ||
      error instanceof ArchiveInputError ||
      error instanceof UploadPolicyError ||
      error instanceof UploadConflictError ||
      error instanceof ManagerNotFoundError ||
      error instanceof ManagerConflictError
    ) {
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
