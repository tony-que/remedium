import { signOut } from "@/lib/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/signin" });
      }}
    >
      <button type="submit" className="text-sm underline underline-offset-4 hover:opacity-80">
        Sign out
      </button>
    </form>
  );
}
