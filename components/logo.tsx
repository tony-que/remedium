import Image from "next/image";

// The Remedium logo: the navy version on light backgrounds, the white version (logo-dark.png) when
// the visitor's system is in dark mode. Size it with a height class.
export function Logo({ className = "h-8" }: { className?: string }) {
  return (
    <>
      <Image src="/logo.png" alt="Remedium Healthcare Products" width={518} height={134} priority className={`w-auto dark:hidden ${className}`} />
      <Image src="/logo-dark.png" alt="Remedium Healthcare Products" width={454} height={118} priority className={`hidden w-auto dark:block ${className}`} />
    </>
  );
}
