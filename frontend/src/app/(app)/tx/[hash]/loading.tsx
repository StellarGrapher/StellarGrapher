import { SkeletonBlock, SkeletonLine } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div>
      <SkeletonLine className="h-7 w-40 mb-2" />
      <SkeletonLine className="h-4 w-96 mb-8" />
      <div className="space-y-6">
        <div className="rounded-lg border border-zinc-800 p-4">
          <SkeletonLine className="h-5 w-32 mb-4" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SkeletonLine className="h-4 w-full" />
            <SkeletonLine className="h-4 w-full" />
            <SkeletonLine className="h-4 w-3/4" />
            <SkeletonLine className="h-4 w-2/3" />
            <SkeletonLine className="h-4 w-5/6" />
            <SkeletonLine className="h-4 w-1/2" />
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 p-4">
          <SkeletonLine className="h-5 w-40 mb-4" />
          <div className="space-y-3">
            <SkeletonLine className="h-4 w-full" />
            <SkeletonLine className="h-4 w-11/12" />
            <SkeletonLine className="h-4 w-4/5" />
            <SkeletonLine className="h-4 w-3/4" />
          </div>
        </div>
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-64" />
      </div>
    </div>
  );
}
