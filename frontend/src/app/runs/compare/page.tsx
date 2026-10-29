import { Suspense } from "react";
import { RunComparison } from "@/components/run-comparison";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening comparison…</p>}>
      <RunComparison />
    </Suspense>
  );
}
