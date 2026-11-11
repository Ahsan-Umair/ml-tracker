import Link from "next/link";
import Image from "next/image";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="Model Lab home">
      <Image
        className="brand-logo"
        src="/brand/model-lab-wordmark.webp"
        alt=""
        width={704}
        height={114}
        unoptimized
      />
    </Link>
  );
}
