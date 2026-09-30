import Link from "next/link";
export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="Model Lab home">
      <span className="brand-mark">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 6h12M6 6l6 12M18 6l-6 12"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {[
            [6, 6],
            [18, 6],
            [12, 18],
          ].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="3" fill="currentColor" />
          ))}
        </svg>
      </span>
      <span>
        model<span className="brand-light">lab</span>
        <span className="brand-period">.</span>
      </span>
    </Link>
  );
}
