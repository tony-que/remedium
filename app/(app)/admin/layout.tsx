import { requireAdmin } from "@/lib/access";

// Admin pages. Each admin server action also calls requireAdmin itself,
// because a layout check doesn't protect actions posted directly.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
