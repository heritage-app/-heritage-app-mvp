"use client";

import { UserManagement } from "@/components/admin/UserManagement";

export default function UsersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-black text-white tracking-tighter uppercase">User Management</h2>
        <p className="text-white/40 text-xs font-medium uppercase tracking-[0.2em] mt-2">
          Assign roles and manage system permissions for authors and moderators.
        </p>
      </div>
      
      <UserManagement />
    </div>
  );
}
