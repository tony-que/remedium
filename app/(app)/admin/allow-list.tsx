"use client";

import { useActionState } from "react";
import { addUserAction, removeUserAction, setRoleAction, type ActionResult } from "./actions";

export interface AllowedUserRow {
  email: string;
  role: "admin" | "viewer";
  addedBy: string;
  createdAt: string;
}

function Status({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
      {state.message}
    </p>
  );
}

type FormAction = (fd: FormData) => void;

function Row({
  user,
  me,
  removeAction,
  removePending,
}: {
  user: AllowedUserRow;
  me: string;
  // Removal is handled by the list, because a removed row unmounts and
  // would take its own status message with it.
  removeAction: FormAction;
  removePending: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState(setRoleAction, null);
  const isMe = user.email === me;
  const nextRole = user.role === "admin" ? "viewer" : "admin";

  return (
    <tr className="border-t border-current/10 align-top">
      <td className="py-2 pr-4 break-all">
        {user.email}
        {isMe && <span className="ml-2 text-xs opacity-60">(you)</span>}
        <Status state={roleState} />
      </td>
      <td className="py-2 pr-4 capitalize">{user.role}</td>
      <td className="hidden py-2 pr-4 text-sm opacity-70 sm:table-cell">
        {user.addedBy} · {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-2">
          <form action={roleAction}>
            <input type="hidden" name="email" value={user.email} />
            <input type="hidden" name="role" value={nextRole} />
            <button
              type="submit"
              disabled={rolePending}
              className="rounded border border-current/30 px-2 py-1 text-sm hover:bg-current/5 disabled:opacity-50"
            >
              Make {nextRole}
            </button>
          </form>
          {!isMe && (
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!confirm(`Remove ${user.email}? They lose access immediately.`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="email" value={user.email} />
              <button
                type="submit"
                disabled={removePending}
                className="rounded border border-red-600/40 px-2 py-1 text-sm text-red-700 hover:bg-red-600/10 disabled:opacity-50 dark:text-red-400"
              >
                Remove
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

export function AllowList({ users, me }: { users: AllowedUserRow[]; me: string }) {
  const [addState, addAction, addPending] = useActionState(addUserAction, null);
  const [removeState, removeAction, removePending] = useActionState(removeUserAction, null);

  return (
    <div className="flex flex-col gap-4">
      <form action={addAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            placeholder="name@remedium-usa.com"
            className="rounded-md border border-current/20 bg-transparent px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <select name="role" defaultValue="viewer" className="rounded-md border border-current/20 bg-transparent px-3 py-2 text-base">
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={addPending}
          className="rounded-md bg-foreground px-4 py-2 font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      <Status state={addState} />
      <Status state={removeState} />

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-sm opacity-70">
            <tr>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="hidden py-2 pr-4 font-medium sm:table-cell">Added by</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Row key={u.email} user={u} me={me} removeAction={removeAction} removePending={removePending} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
