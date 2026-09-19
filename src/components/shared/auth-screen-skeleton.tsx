import { Logo } from '@/components/shared/logo';
import { Skeleton } from '@/components/ui/skeleton';

type AuthScreenSkeletonProps = {
  variant: 'login' | 'invite';
};

function LoadingAnnouncement({ label }: { label: string }) {
  return <span className="sr-only">{label}</span>;
}

export function AuthScreenSkeleton({ variant }: AuthScreenSkeletonProps) {
  if (variant === 'invite') {
    return (
      <main
        aria-busy="true"
        aria-label="Carregando convite"
        className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12"
      >
        <LoadingAnnouncement label="Carregando convite" />
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3">
            <Logo className="h-7 w-auto" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="flex flex-col gap-4 rounded-(--card-radius) border border-(--card-border) bg-(--card-bg) p-(--card-pad) shadow-sm">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      aria-busy="true"
      aria-label="Carregando acesso"
      className="grid min-h-screen bg-surface lg:grid-cols-2"
    >
      <LoadingAnnouncement label="Carregando acesso" />
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <Logo className="h-7 w-auto" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-sm flex-col gap-4">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
            <div className="mt-2 flex flex-col gap-2">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
        <Skeleton className="h-3 w-40" />
      </div>
      <aside aria-hidden="true" className="hidden bg-primary lg:block" />
    </main>
  );
}
