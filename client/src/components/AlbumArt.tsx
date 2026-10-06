import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { trackCoverUrl, type Track } from "../types";

export function AlbumArt({ track, className = "" }: { track: Track; className?: string }) {
  const source = trackCoverUrl(track);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = source !== null && failedSource === source;
  useEffect(() => {
    setFailedSource(null);
  }, [source]);

  return (
    <div className={`cover ${className}`} role="img" aria-label={`${track.album} cover`}>
      {source && !failed ? (
        <img
          key={source}
          src={source}
          alt=""
          loading="lazy"
          onError={() => setFailedSource(source)}
        />
      ) : (
        <div className="cover-placeholder" aria-hidden="true">
          <Music2 />
        </div>
      )}
    </div>
  );
}
