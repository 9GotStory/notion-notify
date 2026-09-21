const POST_BODY_POLICY = new Map([
  ['/v1/activities', 'json'],
  ['/v1/uploads', 'binary'],
  ['/v1/inbox/uploads', 'binary'],
  ['/v1/move', 'json'],
  ['/v1/rename', 'json'],
  ['/v1/archive', 'json'],
]);

export function requestBodyKind(method, pathname) {
  if (
    String(method || '').toUpperCase() !== 'POST'
  ) {
    return null;
  }

  return POST_BODY_POLICY.get(pathname) || null;
}
