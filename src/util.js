import crypto from 'node:crypto';

export const newId = () => crypto.randomUUID().slice(0, 8);
export const now = () => new Date().toISOString();
export const rupiah = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function emptyTenant({ name, code, maxEmployees = 5 }) {
  return {
    id: newId(), name, code, maxEmployees, active: true, createdAt: now(),
    managerState: { step: 'ask_count' },
    managerChat: [],
    employees: [], items: [], movements: [], transactions: [], reports: [], alerts: [],
  };
}
