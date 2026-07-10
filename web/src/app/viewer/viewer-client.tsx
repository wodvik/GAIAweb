"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const OrbitViewer = dynamic(() => import("@/components/viewer/OrbitViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-muted text-sm">
      loading viewer…
    </div>
  ),
});

function ViewerWithParams() {
  const params = useSearchParams();
  const star = params.get("star") ?? undefined;
  return <OrbitViewer initialStar={star} />;
}

export default function ViewerClient() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          loading viewer…
        </div>
      }
    >
      <ViewerWithParams />
    </Suspense>
  );
}
