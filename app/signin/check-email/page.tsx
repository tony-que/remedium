export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-4 py-12">
      <h1 className="text-2xl font-semibold">Check your email</h1>
      <p className="opacity-80">
        If that address has access, a sign-in link is on its way. The link works once, for 15 minutes.
      </p>
      <a href="/signin" className="text-sm underline underline-offset-4">
        Back to sign-in
      </a>
    </main>
  );
}
