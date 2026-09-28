const POST_BODY_POLICY = new Map([
  ['/v1/activities', 'json'],
  ['/v1/uploads', 'binary'],
  ['/v1/draft-activity/uploads', 'binary'],
  ['/v1/inbox/uploads', 'binary'],
  ['/v1/organization/uploads', 'binary'],
  ['/v1/move', 'json'],
  ['/v1/rename', 'json'],
  ['/v1/archive', 'json'],
]);

export function requestBodyKind(method, pathname) {
  const normalizedMethod =
    String(
      method || ''
    ).toUpperCase();

  if (
    pathname === '/v1/photos/tags'
  ) {
    if (
      normalizedMethod === 'PUT' ||
      normalizedMethod === 'DELETE'
    ) {
      return 'json';
    }

    return null;
  }

  if (
    normalizedMethod !== 'POST'
  ) {
    return null;
  }

  return POST_BODY_POLICY.get(pathname) || null;
}
