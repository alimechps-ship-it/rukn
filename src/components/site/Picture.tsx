import type { Media } from "@/lib/types";

/** Responsive, lazy-loaded image. Renders a neutral placeholder when no media is set. */
export function Picture({
  media, sizes = "100vw", priority = false, className,
}: { media: Media | null; sizes?: string; priority?: boolean; illustrativeLabel?: string; className?: string }) {
  if (!media) {
    return (
      <div className={`placeholder ${className ?? ""}`} role="img" aria-label="">
        <span />
      </div>
    );
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.src}
        srcSet={media.srcSet || undefined}
        sizes={sizes}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        alt={media.alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className={className}
      />
    </>
  );
}
