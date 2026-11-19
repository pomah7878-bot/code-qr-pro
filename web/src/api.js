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
  forgotPassword: (b) => req('POST', '/api/auth/forgot', b),
  resetPassword: (b) => req('POST', '/api/auth/reset', b),
  logout: () => req('POST', '/api/auth/logout'),
  sessions: () => req('GET', '/api/auth/sessions'),
  logoutAll: () => req('POST', '/api/auth/sessions/logout-all'),
  changePassword: (b) => req('POST', '/api/auth/password', b),
  twoFactorSetup: () => req('POST', '/api/auth/2fa/setup'),
  twoFactorEnable: (code) => req('POST', '/api/auth/2fa/enable', { code }),
  twoFactorDisable: (b) => req('POST', '/api/auth/2fa/disable', b),
  twoFactorChallenge: (b) => req('POST', '/api/auth/2fa/challenge', b),
  me: () => req('GET', '/api/me'),
  plans: () => req('GET', '/api/plans'),
  validate: (b) => req('POST', '/api/jobs/validate', b),
  createJob: (b) => req('POST', '/api/jobs', b),
  jobs: () => req('GET', '/api/jobs'),
  history: () => req('GET', '/api/history'),
  setTemplates: () => req('GET', '/api/sets/templates'),
  createSetTemplate: (b) => req('POST', '/api/sets/templates', b),
  updateSetTemplate: (id, b) => req('PUT', `/api/sets/templates/${id}`, b),
  deleteSetTemplate: (id) => req('DELETE', `/api/sets/templates/${id}`),
  job: (id) => req('GET', '/api/jobs/' + id),
  retryJob: (id) => req('POST', `/api/jobs/${id}/retry`),
  deleteJob: (id) => req('DELETE', '/api/jobs/' + id),
  templates: () => req('GET', '/api/templates'),
  createTemplate: (b) => req('POST', '/api/templates', b),
  updateTemplate: (id, b) => req('PUT', '/api/templates/' + id, b),
  deleteTemplate: (id) => req('DELETE', '/api/templates/' + id),
  prepareLabel: (b) => req('POST', '/api/labels/prepare', b),
  checkout: (b) => req('POST', '/api/billing/checkout', b),
  checkPromo: (b) => req('POST', '/api/billing/promo/check', b),
  checkOrder: (b) => req('POST', '/api/billing/check', b),
  orders: () => req('GET', '/api/billing/orders'),
  subscription: () => req('GET', '/api/billing/subscription'),
  billingArchive: () => req('GET', '/api/billing/archive'),

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
  adminOverview: (days = 30) => req('GET', '/api/admin/overview?days=' + days),
  adminSeries: (days = 30) => req('GET', '/api/admin/series?days=' + days),
  adminHealth: () => req('GET', '/api/admin/health'),
  adminJobs: (params) => req('GET', '/api/admin/jobs' + qs(params)),
  adminRetryJob: (id) => req('POST', `/api/admin/jobs/${id}/retry`),
  adminDeleteJob: (id) => req('DELETE', '/api/admin/jobs/' + id),
  adminConfirmOrder: (id) => req('POST', `/api/admin/orders/${id}/confirm`),
  adminCancelOrder: (id) => req('POST', `/api/admin/orders/${id}/cancel`),
  adminRefundOrder: (id, revoke) => req('POST', `/api/admin/orders/${id}/refund`, { revoke }),
  adminRecheckOrder: (id) => req('POST', `/api/admin/orders/${id}/recheck`),
  adminAudit: (params) => req('GET', '/api/admin/audit' + qs(params)),
  adminPlans: () => req('GET', '/api/admin/plans'),
  adminSavePlans: (plans) => req('PUT', '/api/admin/plans', { plans }),
  adminPromo: () => req('GET', '/api/admin/promo'),
  adminCreatePromo: (b) => req('POST', '/api/admin/promo', b),
  adminUpdatePromo: (id, b) => req('PUT', '/api/admin/promo/' + id, b),
  adminDeletePromo: (id) => req('DELETE', '/api/admin/promo/' + id),
  adminPromoRedemptions: (id) => req('GET', `/api/admin/promo/${id}/redemptions`),
  adminSmtp: () => req('GET', '/api/admin/settings/smtp'),
  adminStorage: () => req('GET', '/api/admin/settings/storage'),
  adminStorageAnalytics: () => req('GET', '/api/admin/storage'),
  adminSaveStorage: (b) => req('PUT', '/api/admin/settings/storage', b),
  adminTestStorage: () => req('POST', '/api/admin/settings/storage/test'),
  adminSaveSmtp: (b) => req('PUT', '/api/admin/settings/smtp', b),
  adminTestSmtp: (to) => req('POST', '/api/admin/settings/smtp/test', { to }),
  adminEmailCampaigns: () => req('GET', '/api/admin/email/campaigns'),
  adminEmailPreview: (b) => req('POST', '/api/admin/email/preview', b),
  adminEmailSend: (b) => req('POST', '/api/admin/email/send', b),
  adminEmailCampaign: (id) => req('GET', '/api/admin/email/campaigns/' + id),
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
