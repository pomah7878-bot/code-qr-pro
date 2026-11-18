async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
export const api = {
  register: (b) => req('POST', '/api/auth/register', b),
  login: (b) => req('POST', '/api/auth/login', b),
  logout: () => req('POST', '/api/auth/logout'),
  me: () => req('GET', '/api/me'),
  plans: () => req('GET', '/api/plans'),
  validate: (b) => req('POST', '/api/jobs/validate', b),
  createJob: (b) => req('POST', '/api/jobs', b),
  jobs: () => req('GET', '/api/jobs'),
  job: (id) => req('GET', '/api/jobs/' + id),
  deleteJob: (id) => req('DELETE', '/api/jobs/' + id),
  templates: () => req('GET', '/api/templates'),
  createTemplate: (b) => req('POST', '/api/templates', b),
  updateTemplate: (id, b) => req('PUT', '/api/templates/' + id, b),
  deleteTemplate: (id) => req('DELETE', '/api/templates/' + id),
  prepareLabel: (b) => req('POST', '/api/labels/prepare', b)
};
