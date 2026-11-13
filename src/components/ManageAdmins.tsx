'use client';
import { useEffect, useState } from 'react';
import { ADMIN_ROLES, ROLE_LABEL, type AdminRole } from '@/core/auth/roles';
import { api } from '@/lib/api';
import { useToast } from './Toast';
import { primary, small } from './ui';

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
}

/** Moderator-only screen to add, promote/demote, reset password, or remove admins. */
export function ManageAdmins({ currentAdminId }: { currentAdminId: number }) {
  const toast = useToast();
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AdminRole>('ADMIN');
  const [creating, setCreating] = useState(false);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  async function reload() {
    const r = await api<{ admins: AdminUser[] }>('/api/admin/users');
    if (r.ok) {
      setList(r.data.admins);
      setLoadError(null);
    } else {
      setLoadError(r.message);
    }
  }

  useEffect(() => {
    let live = true;
    api<{ admins: AdminUser[] }>('/api/admin/users').then((r) => {
      if (!live) return;
      if (r.ok) {
        setList(r.data.admins);
        setLoadError(null);
      } else {
        setLoadError(r.message);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const r = await api<{ admin: AdminUser }>('/api/admin/users', {
      method: 'POST',
      body: { name, email, password, role },
    });
    setCreating(false);
    if (!r.ok) return toast(r.message, 'error');
    setName('');
    setEmail('');
    setPassword('');
    setRole('ADMIN');
    toast(`${ROLE_LABEL[r.data.admin.role]} account ready for ${r.data.admin.email}.`);
    await reload();
  }

  async function changeRole(u: AdminUser, nextRole: AdminRole) {
    setBusyId(u.id);
    const r = await api<{ admin: AdminUser }>(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: { role: nextRole },
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    toast(`${u.name} is now ${ROLE_LABEL[nextRole]}.`);
    await reload();
  }

  async function removeAdmin(u: AdminUser) {
    setBusyId(u.id);
    const r = await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    toast(`Removed ${u.name} (${u.email}).`);
    await reload();
  }

  async function restoreAdmin(u: AdminUser) {
    setBusyId(u.id);
    const r = await api(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: { isActive: true },
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    toast(`Restored ${u.name}.`);
    await reload();
  }

  async function savePassword(u: AdminUser) {
    setBusyId(u.id);
    const r = await api(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: { password: newPassword },
    });
    setBusyId(null);
    if (!r.ok) return toast(r.message, 'error');
    setResetId(null);
    setNewPassword('');
    toast(`Password updated for ${u.name}.`);
  }

  const active = list?.filter((u) => u.isActive) ?? [];
  const inactive = list?.filter((u) => !u.isActive) ?? [];

  return (
    <div className="space-y-6">
      {/* Add Admin / Moderator */}
      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-bold">Add Admin or Moderator</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Moderators can edit everything and manage admins. Admins can only update semester
            status.
          </p>
        </div>

        <form onSubmit={createAdmin} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="admin-name"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Name
            </label>
            <input
              id="admin-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label
              htmlFor="admin-email"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@ruet.ac.bd"
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password (min 10 chars)
            </label>
            <input
              id="admin-password"
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div>
            <label
              htmlFor="admin-role"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Role
            </label>
            <select
              id="admin-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {ADMIN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={creating} className={primary}>
              {creating ? 'Adding…' : 'Add account'}
            </button>
          </div>
        </form>
      </section>

      {/* Active Accounts */}
      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-bold">Active Accounts ({active.length})</h2>

        {loadError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}

        {!list && !loadError ? (
          <p className="text-sm text-zinc-500">Loading accounts…</p>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {active.map((u) => {
              const isSelf = u.id === currentAdminId;
              const isBusy = busyId === u.id;
              return (
                <div key={u.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {u.name}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            u.role === 'MODERATOR'
                              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          {ROLE_LABEL[u.role]}
                        </span>
                        {isSelf && (
                          <span className="text-xs font-medium text-zinc-500">(You)</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">{u.email}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {!isSelf && (
                        <>
                          {u.role === 'ADMIN' ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => changeRole(u, 'MODERATOR')}
                              className={small}
                            >
                              Make Moderator
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => changeRole(u, 'ADMIN')}
                              className={small}
                            >
                              Make Admin
                            </button>
                          )}
                        </>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setResetId(resetId === u.id ? null : u.id);
                          setNewPassword('');
                        }}
                        className={small}
                      >
                        {resetId === u.id ? 'Cancel' : 'Password'}
                      </button>

                      {!isSelf && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => removeAdmin(u)}
                          className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {resetId === u.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="password"
                        minLength={10}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 10 chars)"
                        className="w-60 rounded border border-zinc-300 px-2.5 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <button
                        type="button"
                        disabled={isBusy || newPassword.length < 10}
                        onClick={() => savePassword(u)}
                        className={primary}
                      >
                        Save password
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Removed Accounts */}
      {inactive.length > 0 && (
        <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-base font-bold text-zinc-700 dark:text-zinc-300">
            Removed Accounts ({inactive.length})
          </h2>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {inactive.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{u.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">({ROLE_LABEL[u.role]})</span>
                  <p className="text-xs text-zinc-500">{u.email}</p>
                </div>
                <button
                  type="button"
                  disabled={busyId === u.id}
                  onClick={() => restoreAdmin(u)}
                  className={small}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

