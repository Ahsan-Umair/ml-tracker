import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { Brand } from "./brand";
export function AuthFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Model Lab">
        <Brand href="/login" />
        <div className="auth-story-copy">
          <p className="section-tag">
            A LITTLE STRUCTURE. A LOT OF POSSIBILITY.
          </p>
          <h2>
            Good ideas deserve
            <br />a great <em>record.</em>
          </h2>
          <p>
            A home for your models, experiments, and the small discoveries that
            move your work forward.
          </p>
        </div>
        <div className="research-figure" aria-hidden="true">
          <div className="figure-label">
            THE EXPERIMENT SPACE <ArrowUpRight size={17} />
          </div>
          <svg viewBox="0 0 500 260" fill="none">
            <g stroke="#354d43">
              {[100, 200, 300, 400].map((x) => (
                <path key={x} d={`M${x} 12v220`} />
              ))}
              {[60, 120, 180, 240].map((y) => (
                <path key={y} d={`M20 ${y}h460`} />
              ))}
              {[
                [188, 101],
                [137, 72],
                [80, 43],
              ].map(([rx, ry]) => (
                <ellipse
                  key={rx}
                  cx="252"
                  cy="130"
                  rx={rx}
                  ry={ry}
                  transform="rotate(-12 252 130)"
                />
              ))}
            </g>
            <path
              d="M65 213C135 200 116 137 194 162S270 67 332 98S389 50 443 51"
              stroke="#c5f194"
              strokeWidth="2.5"
            />
            <path
              d="M65 213Q170 60 260 165T443 100"
              stroke="#72897c"
              strokeDasharray="5 7"
            />
            {[
              [65, 213],
              [194, 162],
              [332, 98],
              [443, 51],
            ].map(([x, y], i) => (
              <g key={x}>
                <circle
                  cx={x}
                  cy={y}
                  r="6"
                  fill="#c5f194"
                  stroke="#203b30"
                  strokeWidth="3"
                />
                <text x={x - 5} y={y - 17} fill="#b3c6bb" fontSize="10">
                  0{i + 1}
                </text>
              </g>
            ))}
          </svg>
          <div className="figure-steps">
            <span>01 / Explore</span>
            <span>02 / Experiment</span>
            <span>03 / Improve</span>
          </div>
        </div>
        <div className="auth-story-footer">
          <span>Built for the work behind the result.</span>
          <span>MODEL LAB / 01</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <Brand href="/login" />
        </div>
        <div className="auth-box">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-copy">{description}</p>
          {children}
        </div>
        <p className="auth-security">
          <LockKeyhole size={13} />
          Your workspace stays private.
        </p>
      </section>
    </main>
  );
}
