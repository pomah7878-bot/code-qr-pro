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
  plans: () => req('GET', '/api/plans')
};
