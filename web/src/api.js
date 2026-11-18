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

// query string без пустых значений
export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export const api = {
  register: (b) => req('POST', '/api/auth/register', b),
  login: (b) => req('POST', '/api/auth/login', b),
  logout: () => req('POST', '/api/auth/logout'),
  changePassword: (b) => req('POST', '/api/auth/password', b),
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
  prepareLabel: (b) => req('POST', '/api/labels/prepare', b),
  checkout: (b) => req('POST', '/api/billing/checkout', b),
  checkOrder: (b) => req('POST', '/api/billing/check', b),
  orders: () => req('GET', '/api/billing/orders'),
  subscription: () => req('GET', '/api/billing/subscription'),

  // Админка
  adminStats: () => req('GET', '/api/admin/stats'),
  adminUsers: (params) => req('GET', '/api/admin/users' + qs(params)),
  adminUser: (id) => req('GET', '/api/admin/users/' + id),
  adminGrant: (id, days) => req('POST', `/api/admin/users/${id}/grant`, { days }),
  adminRevoke: (id) => req('POST', `/api/admin/users/${id}/revoke`),
  adminBlock: (id, reason) => req('POST', `/api/admin/users/${id}/block`, { reason }),
  adminUnblock: (id) => req('POST', `/api/admin/users/${id}/unblock`),
  adminRole: (id, role) => req('POST', `/api/admin/users/${id}/role`, { role }),
  adminResetPassword: (id) => req('POST', `/api/admin/users/${id}/password-reset`),
  adminNote: (id, note) => req('POST', `/api/admin/users/${id}/note`, { note }),
  adminDeleteUser: (id, confirmEmail) => req('DELETE', `/api/admin/users/${id}`, { confirmEmail }),
  adminKillSessions: (id) => req('DELETE', `/api/admin/users/${id}/sessions`),
  adminKillSession: (token) => req('DELETE', '/api/admin/sessions/' + token),
  adminOrders: (params) => req('GET', '/api/admin/orders' + qs(params)),
  adminConfirmOrder: (id) => req('POST', `/api/admin/orders/${id}/confirm`),
  adminCancelOrder: (id) => req('POST', `/api/admin/orders/${id}/cancel`),
  adminRefundOrder: (id, revoke) => req('POST', `/api/admin/orders/${id}/refund`, { revoke }),
  adminRecheckOrder: (id) => req('POST', `/api/admin/orders/${id}/recheck`),
  adminSettings: () => req('GET', '/api/admin/settings'),
  adminSaveSettings: (b) => req('PUT', '/api/admin/settings', b),
  adminPricing: () => req('GET', '/api/admin/pricing'),
  adminSavePricing: (b) => req('PUT', '/api/admin/pricing', b),

  reviews: () => req('GET', '/api/reviews'),
  myReview: () => req('GET', '/api/reviews/mine'),
  submitReview: (b) => req('POST', '/api/reviews', b),
  deleteReview: (id) => req('DELETE', '/api/reviews/' + id),
  adminReviews: () => req('GET', '/api/admin/reviews'),
  adminModerateReview: (id, b) => req('POST', `/api/admin/reviews/${id}/moderate`, b),
  keys: () => req('GET', '/api/keys'),
  createKey: (b) => req('POST', '/api/keys', b),
  deleteKey: (id) => req('DELETE', '/api/keys/' + id),
  czVerify: (b) => req('POST', '/api/cz/verify', b)
};
