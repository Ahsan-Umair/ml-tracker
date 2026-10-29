import { Suspense } from "react";
import { ResourceList } from "@/components/resource-list";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening workspace…</p>}>
      <ResourceList kind="projects" />
    </Suspense>
  );
}
