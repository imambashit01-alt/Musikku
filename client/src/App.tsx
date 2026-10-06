import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Album,
  ArrowDownUp,
  ChevronDown,
  Cog,
  Download,
  Edit3,
  Heart,
  Library,
  ListMusic,
  MoreHorizontal,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Sun,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Quote,
  RotateCw,
} from "lucide-react";
import { api } from "./lib/api";
import { AlbumArt } from "./components/AlbumArt";
import { findActiveLyricIndex, parseLrc } from "./lib/lyrics";
import { formatTime } from "./lib/time";
import {
  initializeAudio,
  pausePlayback,
  playPlayback,
  seekTo,
  togglePlayback,
  usePlayerStore,
} from "./store/player";
import {
  trackCoverUrl,
  type AuthUser,
  type BackupPayload,
  type DesktopUpdateState,
  type ImportProgress,
  type Playlist,
  type Track,
} from "./types";

type Section = "Songs" | "Albums" | "Artists" | "Playlists" | "Favorites" | "Settings";
type TrackSort = "title" | "artist" | "album" | "recentlyAdded";

function registerMediaAction(
  mediaSession: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotSupportedError") return;
    throw error;
  }
}

const navItems: { label: Section; icon: typeof Library }[] = [
  { label: "Songs", icon: Library },
  { label: "Albums", icon: Album },
  { label: "Artists", icon: Music2 },
  { label: "Playlists", icon: ListMusic },
  { label: "Favorites", icon: Heart },
  { label: "Settings", icon: Cog },
];

function useCoverColor(track: Track | null): string {
  const [coverColor, setCoverColor] = useState("rgba(80, 80, 90, .16)");

  useEffect(() => {
    const url = track ? trackCoverUrl(track) : null;
    if (!url) {
      setCoverColor("rgba(80, 80, 90, .16)");
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 16);
      try {
        const pixels = context.getImageData(0, 0, 16, 16).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if ((pixels[index + 3] ?? 0) < 128) continue;
          red += pixels[index] ?? 0;
          green += pixels[index + 1] ?? 0;
          blue += pixels[index + 2] ?? 0;
          count += 1;
        }
        if (count)
          setCoverColor(
            `rgba(${Math.round(red / count)}, ${Math.round(green / count)}, ${Math.round(blue / count)}, .42)`,
          );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
        setCoverColor("rgba(80, 80, 90, .16)");
      }
    };
    image.src = url;
  }, [track]);

  return coverColor;
}

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (track: Track) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const importFolder = useCallback(async () => {
    if (!window.musikkuDesktop) {
      folderInput.current?.click();
      return;
    }
    setBusy(true);
    setMessage("");
    const unsubscribe = window.musikkuDesktop.onImportProgress(setProgress);
    try {
      const result = await window.musikkuDesktop.importAudio("folder");
      result.imported.forEach(onUploaded);
      const importedCount = result.imported.length - result.duplicates;
      const summary = `${importedCount} lagu ditambahkan${result.duplicates ? `, ${result.duplicates} duplikat dilewati` : ""}.`;
      setMessage(result.failures.length ? `${summary} ${result.failures.join(" ")}` : summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Impor folder gagal.");
    } finally {
      unsubscribe();
      setProgress(null);
      setBusy(false);
    }
  }, [onUploaded]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const selectedFiles = Array.from(files);
      const relativePath = (file: File) =>
        ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)
          .replaceAll("\\", "/")
          .toLocaleLowerCase();
      const sidecars = new Map(
        selectedFiles
          .filter((file) => file.name.toLocaleLowerCase().endsWith(".lrc"))
          .map((file) => [relativePath(file), file]),
      );
      const candidates = selectedFiles.filter((file) =>
        /\.(?:mp3|m4a|flac|wav|ogg)$/i.test(file.name),
      );
      if (!candidates.length) return;
      setBusy(true);
      setMessage("");
      try {
        for (const file of candidates) {
          const formData = new FormData();
          formData.append("file", file);
          const filePath = relativePath(file);
          const fileRelativePath = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath;
          if (fileRelativePath) formData.append("relativePath", fileRelativePath);
          const sidecarPath = filePath.replace(/\.[^/.]+$/, ".lrc");
          const sidecar = sidecars.get(sidecarPath);
          if (sidecar) {
            if (sidecar.size > 1024 * 1024) {
              throw new Error(`File lirik ${sidecar.name} melebihi ukuran 1 MB.`);
            }
            formData.append("lyricsLrc", await sidecar.text());
          }
          const track = await api<Track>("/tracks", { method: "POST", body: formData });
          onUploaded(track);
        }
        setMessage(`${candidates.length} lagu berhasil ditambahkan.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Upload gagal.");
      } finally {
        setBusy(false);
      }
    },
    [onUploaded],
  );

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">TAMBAHKAN KE KOLEKSI</p>
            <h2 id="upload-title">Unggah musik</h2>
          </div>
          <button className="icon-button" aria-label="Tutup unggah" onClick={onClose}>
            <X />
          </button>
        </div>
        <button
          className={`dropzone ${dragging ? "dropzone-active" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadFiles(event.dataTransfer.files);
          }}
          disabled={busy}
        >
          <span className="upload-icon">
            <Upload size={23} />
          </span>
          <strong>
            {busy && progress
              ? `Memindai ${progress.completed}/${progress.total}: ${progress.fileName}`
              : busy
                ? "Sedang mengunggah…"
                : "Tarik file ke sini"}
          </strong>
          <span className="muted">atau pilih file dari perangkatmu</span>
          <span className="file-types">MP3 · M4A · FLAC · WAV · OGG · Tanpa batas ukuran/file</span>
        </button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".mp3,.m4a,.flac,.wav,.ogg,audio/*"
          multiple
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={(element) => {
            folderInput.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          className="visually-hidden"
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          className="sort-button folder-import-button"
          onClick={() => void importFolder()}
          disabled={busy}
        >
          <Upload size={15} /> Tambah folder
        </button>
        <p className="legal-note">
          Hanya tambahkan musik dan lirik yang kamu miliki atau berlisensi bebas.
        </p>
        {message && (
          <p className="upload-message" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}

function PlaylistNameDialog({
  initialName = "",
  onClose,
  onSave,
}: {
  initialName?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(name.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playlist gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="playlist-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-dialog-title"
        onSubmit={submit}
      >
        <button
          className="icon-button dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Tutup"
        >
          <X />
        </button>
        <p className="eyebrow">KOLEKSI MUSIK</p>
        <h2 id="playlist-dialog-title">{initialName ? "Ubah nama playlist" : "Playlist baru"}</h2>
        <label htmlFor="playlist-name">Nama playlist</label>
        <input
          id="playlist-name"
          autoFocus
          autoComplete="off"
          maxLength={80}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="sort-button" type="button" onClick={onClose}>
            Batal
          </button>
          <button className="button button-primary" type="submit" disabled={saving || !name.trim()}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TrackInfoDialog({
  track,
  onClose,
  onSave,
  onUploadCover,
}: {
  track: Track;
  onClose: () => void;
  onSave: (track: Track, fields: Pick<Track, "title" | "artist" | "album">) => Promise<void>;
  onUploadCover: (track: Track, file: File) => Promise<Track>;
}) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const [saving, setSaving] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverPreview, setCoverPreview] = useState(track);
  const [error, setError] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);

  async function uploadCover(file: File) {
    setCoverSaving(true);
    setError("");
    try {
      setCoverPreview(await onUploadCover(track, file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sampul gagal disimpan.");
    } finally {
      setCoverSaving(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(track, { title: title.trim(), artist: artist.trim(), album: album.trim() });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Info lagu gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="playlist-name-dialog track-info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-info-title"
        onSubmit={submit}
      >
        <button
          className="icon-button dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Tutup"
        >
          <X />
        </button>
        <p className="eyebrow">INFO LAGU</p>
        <h2 id="track-info-title">Edit info</h2>
        <label htmlFor="edit-track-title">Judul</label>
        <input
          id="edit-track-title"
          autoFocus
          maxLength={300}
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="edit-track-artist">Artis</label>
        <input
          id="edit-track-artist"
          maxLength={300}
          required
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
        />
        <label htmlFor="edit-track-album">Album</label>
        <input
          id="edit-track-album"
          maxLength={300}
          required
          value={album}
          onChange={(event) => setAlbum(event.target.value)}
        />
        <label>Sampul album</label>
        <div className="track-cover-editor">
          <AlbumArt track={coverPreview} className="track-cover-preview" />
          <div>
            <button
              className="sort-button"
              type="button"
              onClick={() => coverInput.current?.click()}
              disabled={coverSaving}
            >
              <Upload size={15} /> {coverSaving ? "Mengunggah…" : "Pilih gambar"}
            </button>
            <p className="muted">JPEG, PNG, GIF, atau WebP · Tanpa batas ukuran</p>
          </div>
        </div>
        <input
          ref={coverInput}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadCover(file);
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="sort-button" type="button" onClick={onClose}>
            Batal
          </button>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmationDialog({
  message,
  onClose,
  onConfirm,
  onError,
}: {
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Tindakan gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="playlist-name-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <p className="eyebrow">KONFIRMASI</p>
        <h2 id="confirm-title">Yakin ingin melanjutkan?</h2>
        <p id="confirm-message" className="muted">
          {message}
        </p>
        <div className="dialog-actions">
          <button className="sort-button" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="button button-primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Menghapus…" : "Hapus"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SongRow({
  track,
  index,
  tracks,
  playlists,
  favorite,
  onDelete,
  onToggleFavorite,
  onAddToQueue,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onDragTrack,
  onDropTrack,
  onEditInfo,
}: {
  track: Track;
  index: number;
  tracks: Track[];
  playlists: Playlist[];
  favorite: boolean;
  onDelete?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
  onDragTrack?: (track: Track) => void;
  onDropTrack?: (track: Track) => void;
  onEditInfo?: (track: Track) => void;
}) {
  const current = usePlayerStore((state) => state.track?.id === track.id);
  const playing = usePlayerStore((state) => state.playing);
  const setTrack = usePlayerStore((state) => state.setTrack);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menuPosition) return;
    const closeMenu = () => setMenuPosition(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuPosition]);

  return (
    <div
      className={`song-row ${current ? "song-row-current" : ""}`}
      onContextMenu={(event) => {
        if (!onEditInfo) return;
        event.preventDefault();
        setMenuPosition({
          x: Math.min(event.clientX, window.innerWidth - 170),
          y: Math.min(event.clientY, window.innerHeight - 70),
        });
      }}
      draggable={Boolean(onDropTrack)}
      onDragStart={() => onDragTrack?.(track)}
      onDragOver={(event) => {
        if (onDropTrack) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropTrack?.(track);
      }}
    >
      <span className="song-index">
        {current && playing ? <span className="playing-bars">•••</span> : index + 1}
      </span>
      <button
        className="row-cover-button"
        onClick={() => setTrack(track, tracks, index)}
        aria-label={`Putar ${track.title}`}
      >
        <AlbumArt track={track} className="row-cover" />
        <span className="row-play">
          <Play size={14} fill="currentColor" />
        </span>
      </button>
      <button className="song-main" onClick={() => setTrack(track, tracks, index)}>
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </button>
      <span className="song-album">{track.album}</span>
      <span className="song-duration">{formatTime(track.duration)}</span>
      <div className="row-actions">
        <button
          className={`row-action icon-button ${favorite ? "favorite-active" : ""}`}
          aria-label={favorite ? "Hapus dari favorit" : "Tambahkan ke favorit"}
          title={favorite ? "Hapus dari favorit" : "Favorit"}
          onClick={() => onToggleFavorite(track)}
        >
          <Heart size={16} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="row-action icon-button"
          aria-label="Tambahkan ke antrean"
          title="Tambahkan ke antrean"
          onClick={() => onAddToQueue(track)}
        >
          <ListMusic size={16} />
        </button>
        {playlists.length > 0 && (
          <select
            className="row-playlist-select"
            aria-label={`Tambahkan ${track.title} ke playlist`}
            value=""
            onChange={(event) => {
              if (event.target.value) onAddToPlaylist(event.target.value, track);
            }}
          >
            <option value="">＋</option>
            {playlists.map((playlist) => (
              <option value={playlist.id} key={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
        )}
        {onRemoveFromPlaylist && (
          <button
            className="row-action icon-button"
            aria-label={`Hapus ${track.title} dari playlist`}
            onClick={() => onRemoveFromPlaylist(track)}
          >
            <X size={16} />
          </button>
        )}
        {onDelete && (
          <button
            className="row-action icon-button"
            aria-label={`Hapus ${track.title}`}
            title="Hapus lagu"
            onClick={() => onDelete(track)}
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </div>
      {menuPosition && onEditInfo && (
        <div
          className="track-context-menu"
          role="menu"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => {
              onEditInfo(track);
              setMenuPosition(null);
            }}
          >
            <Edit3 size={15} /> Edit info
          </button>
        </div>
      )}
    </div>
  );
}

function SeekSlider({ duration, trackId }: { duration: number; trackId: string }) {
  const currentTime = usePlayerStore((state) => state.currentTime);
  const [hoverTime, setHoverTime] = useState<{ left: number; time: number } | null>(null);
  const max = duration > 0 ? duration : 1;

  return (
    <div
      className="seek-slider-wrap"
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const left = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        setHoverTime({ left: left * 100, time: left * max });
      }}
      onPointerLeave={() => setHoverTime(null)}
    >
      {hoverTime && (
        <span className="seek-tooltip" style={{ left: `${hoverTime.left}%` }} aria-hidden="true">
          {formatTime(hoverTime.time)}
        </span>
      )}
      <input
        className="range-input seek-input"
        aria-label="Posisi lagu"
        aria-valuetext={formatTime(currentTime)}
        type="range"
        min="0"
        max={max}
        value={Math.min(currentTime, max)}
        style={{
          background: `linear-gradient(to right, #fa2d48 ${(Math.min(currentTime, max) / max) * 100}%, var(--line) ${(Math.min(currentTime, max) / max) * 100}%)`,
        }}
        onChange={(event) => seekTo(Number(event.target.value))}
        key={trackId}
      />
    </div>
  );
}

function PlaybackTimeline({ track, layout }: { track: Track; layout: "compact" | "expanded" }) {
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration) || track.duration;
  const [showRemaining, setShowRemaining] = useState(false);

  if (layout === "expanded") {
    return (
      <div className="now-playing-seek">
        <SeekSlider duration={duration} trackId={track.id} />
        <div className="now-playing-seek-times">
          <time>{formatTime(currentTime)}</time>
          <time>{formatTime(duration)}</time>
        </div>
      </div>
    );
  }

  return (
    <div className="seek-row">
      <time>{formatTime(currentTime)}</time>
      <SeekSlider duration={duration} trackId={track.id} />
      <button
        className="time-toggle"
        type="button"
        aria-label={showRemaining ? "Tampilkan durasi total" : "Tampilkan sisa durasi"}
        title={showRemaining ? "Tampilkan durasi total" : "Tampilkan sisa durasi"}
        onClick={() => setShowRemaining((remaining) => !remaining)}
      >
        {showRemaining
          ? `-${formatTime(Math.max(0, duration - currentTime))}`
          : formatTime(duration)}
      </button>
    </div>
  );
}

function MiniPlayerBar({
  onExpand,
  onLyrics,
  onToggleFavorite,
  isFavorite,
}: {
  onExpand: () => void;
  onLyrics: () => void;
  onToggleFavorite: (track: Track) => void;
  isFavorite: boolean;
}) {
  const track = usePlayerStore((state) => state.track);
  const playing = usePlayerStore((state) => state.playing);
  const volume = usePlayerStore((state) => state.volume);
  const previous = usePlayerStore((state) => state.previous);
  const next = usePlayerStore((state) => state.next);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const lastAudibleVolume = useRef(volume || 0.75);

  useEffect(() => {
    if (volume > 0) lastAudibleVolume.current = volume;
  }, [volume]);

  if (!track) return null;

  return (
    <aside className="mini-player-bar" aria-label="Mini player">
      <button className="mini-player-cover-button" onClick={() => onExpand()} aria-label="Buka pemutar layar penuh">
        <AlbumArt track={track} className="mini-player-cover" />
      </button>
      <div className="mini-player-meta">
        <strong>{track.title}</strong>
        <span>{track.artist}</span>
      </div>
      <div className="mini-player-controls">
        <button className="control-button secondary" onClick={previous} aria-label="Lagu sebelumnya">
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button className="control-button play-button" onClick={togglePlayback} aria-label={playing ? "Jeda" : "Putar"}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button className="control-button secondary" onClick={() => next()} aria-label="Lagu berikutnya">
          <SkipForward size={16} fill="currentColor" />
        </button>
      </div>
      <div className="mini-player-actions">
        <button
          className="icon-button player-volume-toggle"
          type="button"
          aria-label={volume > 0 ? "Bisukan" : "Nyalakan suara"}
          onClick={() => setVolume(volume > 0 ? 0 : lastAudibleVolume.current)}
        >
          {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <button className={`player-heart icon-button ${isFavorite ? "favorite-active" : ""}`} aria-label={isFavorite ? "Hapus dari favorit" : "Tambahkan ke favorit"} title="Favorit" onClick={() => onToggleFavorite(track)}>
          <Heart size={15} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        <button className="icon-button" aria-label="Tampilkan lirik" title="Lirik" onClick={onLyrics}>
          <Quote size={15} />
        </button>
        <button className="icon-button" aria-label="Perluas pemutar" title="Perluas pemutar" onClick={onExpand}>
          <ChevronDown size={17} />
        </button>
      </div>
    </aside>
  );
}

function PlayerBar({
  onExpand,
  onLyrics,
  isFavorite,
  onToggleFavorite,
  onToggleMini,
}: {
  onExpand: () => void;
  onLyrics: () => void;
  isFavorite: boolean;
  onToggleFavorite: (track: Track) => void;
  onToggleMini: () => void;
}) {
  const track = usePlayerStore((state) => state.track);
  const playing = usePlayerStore((state) => state.playing);
  const volume = usePlayerStore((state) => state.volume);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const error = usePlayerStore((state) => state.error);
  const previous = usePlayerStore((state) => state.previous);
  const next = usePlayerStore((state) => state.next);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const queue = usePlayerStore((state) => state.queue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const lastAudibleVolume = useRef(volume || 0.75);

  useEffect(() => {
    if (volume > 0) lastAudibleVolume.current = volume;
  }, [volume]);

  if (!track) return null;
  return (
    <footer className="player-bar" aria-label="Pemutar musik">
      <div className="player-track">
        <button
          className="player-cover-button"
          onClick={onExpand}
          aria-label="Buka pemutar layar penuh"
        >
          <AlbumArt track={track} className="player-cover" />
        </button>
        <button className="player-track-info" onClick={onExpand}>
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </button>
        <button
          className={`player-heart icon-button ${isFavorite ? "favorite-active" : ""}`}
          aria-label={isFavorite ? "Hapus dari favorit" : "Tambahkan ke favorit"}
          title="Favorit"
          onClick={() => onToggleFavorite(track)}
        >
          <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
        </button>
        <button
          className="player-lyrics icon-button"
          aria-label="Tampilkan lirik"
          title="Lirik"
          onClick={onLyrics}
        >
          <Quote size={18} />
        </button>
      </div>
      <div className="player-center">
        <div className="player-controls">
          <button
            className="control-button secondary"
            onClick={previous}
            aria-label="Lagu sebelumnya"
          >
            <SkipBack size={19} fill="currentColor" />
          </button>
          <button
            className="control-button play-button"
            onClick={togglePlayback}
            aria-label={playing ? "Jeda" : "Putar"}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            className="control-button secondary"
            onClick={() => next()}
            aria-label="Lagu berikutnya"
          >
            <SkipForward size={19} fill="currentColor" />
          </button>
          <button
            className={`control-button secondary repeat-control ${repeat !== "off" ? "is-active" : ""}`}
            onClick={cycleRepeat}
            aria-label={`Ulangi: ${repeat}`}
          >
            <span className="repeat-glyph">↻</span>
            {repeat === "one" && <small>1</small>}
          </button>
          <button
            className={`control-button secondary ${shuffle ? "is-active" : ""}`}
            onClick={toggleShuffle}
            aria-label="Acak"
            aria-pressed={shuffle}
          >
            <ArrowDownUp size={16} />
          </button>
        </div>
        <PlaybackTimeline track={track} layout="compact" />
      </div>
      <div className="player-actions">
        <button
          className="control-button secondary mini-toggle"
          onClick={onToggleMini}
          aria-label="Mode mini player"
          title="Mode mini player"
        >
          <ChevronDown size={17} />
        </button>
        <button
          className="control-button player-queue-button"
          onClick={onExpand}
          aria-label={`Buka antrean, ${Math.max(0, queue.length - queueIndex - 1)} lagu berikutnya`}
          title="Buka antrean"
        >
          <ListMusic size={17} />
          {queue.length - queueIndex > 1 && (
            <small className="player-queue-count">{queue.length - queueIndex - 1}</small>
          )}
        </button>
        <div className="player-volume">
          {error && (
            <span className="player-error" role="status">
              {error}
            </span>
          )}
          <button
            className="icon-button player-volume-toggle"
            type="button"
            aria-label={volume > 0 ? "Bisukan" : "Nyalakan suara"}
            title={volume > 0 ? "Bisukan" : "Nyalakan suara"}
            onClick={() => setVolume(volume > 0 ? 0 : lastAudibleVolume.current)}
          >
            {volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <input
            className="range-input volume-input"
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            style={{
              background: `linear-gradient(to right, #fa2d48 ${volume * 100}%, var(--line) ${volume * 100}%)`,
            }}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </div>
      </div>
    </footer>
  );
}

function NowPlayingView({
  isFavorite,
  onLyrics,
  onClose,
  onToggleFavorite,
}: {
  isFavorite: boolean;
  onLyrics: () => void;
  onClose: () => void;
  onToggleFavorite: (track: Track) => void;
}) {
  const track = usePlayerStore((state) => state.track);
  const queue = usePlayerStore((state) => state.queue);
  const queueIndex = usePlayerStore((state) => state.queueIndex);
  const playing = usePlayerStore((state) => state.playing);
  const volume = usePlayerStore((state) => state.volume);
  const shuffle = usePlayerStore((state) => state.shuffle);
  const repeat = usePlayerStore((state) => state.repeat);
  const setTrack = usePlayerStore((state) => state.setTrack);
  const previous = usePlayerStore((state) => state.previous);
  const next = usePlayerStore((state) => state.next);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);
  const clearQueue = usePlayerStore((state) => state.clearQueue);
  const coverColor = useCoverColor(track);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  if (!track) return null;
  return (
    <div className="now-playing-backdrop" role="presentation">
      <section
        className="now-playing"
        role="dialog"
        aria-modal="true"
        aria-label="Sedang diputar"
        style={{ background: `linear-gradient(180deg, ${coverColor} 0%, var(--canvas) 68%)` }}
      >
        <header className="now-playing-header">
          <button className="icon-button" onClick={onClose} aria-label="Tutup Sedang Diputar">
            <ChevronDown />
          </button>
          <div>
            <span>Sedang Diputar</span>
            <small>{track.album}</small>
          </div>
          <button className="icon-button" aria-label="Tampilkan lirik" onClick={onLyrics}>
            <Quote />
          </button>
        </header>

        <div className="now-playing-body">
          <div className="now-playing-current">
            <AlbumArt track={track} className="now-playing-cover" />
            <div className="now-playing-meta">
              <div>
                <h1>{track.title}</h1>
                <p>{track.artist}</p>
              </div>
              <button
                className={`icon-button now-playing-heart ${isFavorite ? "favorite-active" : ""}`}
                aria-label={isFavorite ? "Hapus dari favorit" : "Tambahkan ke favorit"}
                onClick={() => onToggleFavorite(track)}
              >
                <Heart fill={isFavorite ? "currentColor" : "none"} />
              </button>
            </div>
            <PlaybackTimeline track={track} layout="expanded" />
            <div className="now-playing-controls">
              <button
                className={`control-button secondary ${shuffle ? "is-active" : ""}`}
                onClick={toggleShuffle}
                aria-label="Acak"
                aria-pressed={shuffle}
              >
                <ArrowDownUp />
              </button>
              <button
                className="control-button secondary"
                onClick={previous}
                aria-label="Lagu sebelumnya"
              >
                <SkipBack fill="currentColor" />
              </button>
              <button
                className="control-button play-button"
                onClick={togglePlayback}
                aria-label={playing ? "Jeda" : "Putar"}
              >
                {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              </button>
              <button
                className="control-button secondary"
                onClick={() => next()}
                aria-label="Lagu berikutnya"
              >
                <SkipForward fill="currentColor" />
              </button>
              <button
                className={`control-button secondary ${repeat !== "off" ? "is-active" : ""}`}
                onClick={cycleRepeat}
                aria-label={`Ulangi: ${repeat}`}
              >
                <span className="repeat-glyph">↻</span>
                {repeat === "one" && <small>1</small>}
              </button>
            </div>
            <label className="now-playing-volume">
              <Volume2 size={17} />
              <input
                className="range-input"
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
          </div>

          <aside className="up-next">
            <div className="up-next-heading">
              <div>
                <p className="eyebrow">ANTREAN PEMUTARAN</p>
                <h2>Berikutnya</h2>
              </div>
              <div className="up-next-actions">
                <span>{Math.max(0, queue.length - queueIndex - 1)} berikutnya</span>
                {queue.length - queueIndex > 1 && (
                  <button
                    className="icon-button"
                    aria-label="Kosongkan antrean"
                    title="Kosongkan antrean"
                    onClick={clearQueue}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="up-next-list">
              {queue.slice(queueIndex).map((queuedTrack, offset) => {
                const index = queueIndex + offset;
                return (
                  <div
                    className={`up-next-row ${index === queueIndex ? "up-next-current" : ""}`}
                    key={`${queuedTrack.id}-${index}`}
                    draggable={index > queueIndex}
                    onDragStart={() => setDraggingIndex(index)}
                    onDragOver={(event) => {
                      if (index > queueIndex) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingIndex !== null) reorderQueue(draggingIndex, index);
                      setDraggingIndex(null);
                    }}
                  >
                    <button
                      className="up-next-track"
                      onClick={() => setTrack(queuedTrack, queue, index)}
                    >
                      <AlbumArt track={queuedTrack} className="up-next-cover" />
                      <span>
                        <strong>{queuedTrack.title}</strong>
                        <small>{queuedTrack.artist}</small>
                      </span>
                    </button>
                    {index === queueIndex ? (
                      <span className="now-playing-indicator" aria-label="Sedang diputar">
                        ♫
                      </span>
                    ) : (
                      <button
                        className="icon-button up-next-remove"
                        aria-label={`Hapus ${queuedTrack.title} dari antrean`}
                        onClick={() => removeFromQueue(index)}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
              {queue.length <= queueIndex + 1 && (
                <p className="muted up-next-empty">
                  Tidak ada lagu berikutnya. Putar album atau tambahkan lagu dari koleksi.
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function LyricsView({
  onClose,
  onUpdated,
}: {
  onClose: () => void;
  onUpdated: (track: Track) => void;
}) {
  const track = usePlayerStore((state) => state.track);
  const coverColor = useCoverColor(track);
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [activeIndex, setActiveIndex] = useState(-1);
  const parsed = useMemo(() => parseLrc(text, offset), [offset, text]);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(-1);
  const autoScrollPausedUntil = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!track) return;
    let mounted = true;
    setLoading(true);
    setError("");
    void api<{ text: string; offset: number }>(`/tracks/${encodeURIComponent(track.id)}/lyrics`)
      .then((result) => {
        if (!mounted) return;
        setText(result.text);
        setDraft(result.text);
        setOffset(result.offset);
      })
      .catch((caught: unknown) => {
        if (mounted) setError(caught instanceof Error ? caught.message : "Lirik gagal dimuat.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [track?.id]);

  const scrollToCue = useCallback((index: number) => {
    const container = containerRef.current;
    const line = container?.querySelector<HTMLElement>(`[data-lyric-index="${index}"]`);
    if (!container || !line || index < 0 || Date.now() < autoScrollPausedUntil.current) {
      return;
    }
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const start = container.scrollTop;
    const target = Math.max(
      0,
      start + lineRect.top - containerRect.top - container.clientHeight / 3,
    );
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 500);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      container.scrollTop = start + (target - start) * eased;
      if (progress < 1) scrollFrame.current = requestAnimationFrame(animate);
      else scrollFrame.current = null;
    };
    scrollFrame.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const updateActiveCue = (currentTime: number) => {
      const nextIndex = findActiveLyricIndex(parsed.cues, currentTime);
      if (nextIndex === activeIndexRef.current) return;
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    };
    updateActiveCue(usePlayerStore.getState().currentTime);
    return usePlayerStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime) updateActiveCue(state.currentTime);
    });
  }, [parsed.cues]);

  useEffect(() => {
    scrollToCue(activeIndex);
  }, [activeIndex, scrollToCue]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    },
    [],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      if (editing) setEditing(false);
      else onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [editing, onClose]);

  const pauseAutoScroll = () => {
    autoScrollPausedUntil.current = Date.now() + 3000;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      autoScrollPausedUntil.current = 0;
      scrollToCue(activeIndexRef.current);
    }, 3000);
  };

  const save = async (nextText: string, nextOffset: number) => {
    if (!track) return;
    setSaving(true);
    setError("");
    try {
      await api(`/tracks/${encodeURIComponent(track.id)}/lyrics`, {
        method: "PATCH",
        body: JSON.stringify({ text: nextText, offset: nextOffset }),
      });
      setText(nextText);
      setOffset(nextOffset);
      setDraft(nextText);
      onUpdated({ ...track, hasLyrics: Boolean(nextText.trim()) });
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lirik gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  const adjustOffset = async (amount: number) => {
    const nextOffset = Math.max(-600, Math.min(600, offset + amount));
    await save(text, nextOffset);
  };

  const importLyrics = async () => {
    setError("");
    if (window.musikkuDesktop) {
      try {
        const imported = await window.musikkuDesktop.importLyrics();
        if (imported) setDraft(imported.text);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "File lirik gagal dibaca.");
      }
    } else {
      fileInput.current?.click();
    }
  };

  if (!track) return null;
  const hasText = Boolean(text.trim());
  return (
    <div
      className="lyrics-screen"
      role="dialog"
      aria-modal="true"
      aria-label={`Lirik ${track.title}`}
      style={{
        background: `radial-gradient(ellipse at 50% 15%, ${coverColor}, transparent 65%), #111114`,
      }}
    >
      <div
        className="lyrics-background"
        style={{ backgroundColor: coverColor }}
        aria-hidden="true"
      />
      <header className="lyrics-header">
        <button className="icon-button" aria-label="Tutup lirik" onClick={onClose}>
          <ChevronDown />
        </button>
        <div className="lyrics-heading">
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>
        <button
          className="icon-button lyrics-import"
          aria-label={hasText ? "Edit atau impor lirik" : "Impor lirik"}
          title={hasText ? "Edit atau impor lirik" : "Impor lirik"}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <Edit3 />
        </button>
      </header>

      <div
        className={`lyrics-content lyrics-font-${fontSize}`}
        ref={containerRef}
        onWheel={pauseAutoScroll}
        onTouchMove={pauseAutoScroll}
        onPointerDown={pauseAutoScroll}
        aria-live="off"
      >
        {loading ? (
          <p className="lyrics-status">Memuat lirik…</p>
        ) : error && !hasText ? (
          <div className="lyrics-empty">
            <p role="alert">{error}</p>
            <button className="button button-primary" onClick={() => setEditing(true)}>
              Impor lirik
            </button>
          </div>
        ) : parsed.cues.length ? (
          <div className="lyrics-lines">
            {parsed.cues.map((cue, index) => {
              const distance = Math.abs(index - activeIndex);
              return (
                <button
                  className={`lyric-line ${index === activeIndex ? "lyric-line-active" : ""}`}
                  data-lyric-index={index}
                  key={`${cue.time}-${index}`}
                  onClick={() => seekTo(cue.time)}
                  aria-current={index === activeIndex ? "true" : undefined}
                  style={{
                    opacity: index === activeIndex ? 1 : Math.max(0.38, 0.5 - distance * 0.035),
                    filter:
                      index === activeIndex
                        ? "blur(0)"
                        : `blur(${Math.min(distance * 0.35, 2.5)}px)`,
                  }}
                >
                  {cue.text || "\u00a0"}
                </button>
              );
            })}
          </div>
        ) : hasText ? (
          <div className="lyrics-plain-text">{parsed.plainText || text}</div>
        ) : (
          <div className="lyrics-empty">
            <Quote size={30} />
            <p>Belum ada lirik untuk lagu ini</p>
            <button
              className="button button-primary"
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
            >
              Impor lirik
            </button>
          </div>
        )}
      </div>

      <footer className="lyrics-controls">
        <div className="lyrics-offset-controls">
          <span>Sinkronisasi</span>
          <button
            className="icon-button"
            aria-label="Percepat lirik 0,5 detik"
            title="Percepat lirik 0,5 detik"
            onClick={() => void adjustOffset(-0.5)}
            disabled={!hasText || saving}
          >
            −
          </button>
          <span>
            {offset > 0 ? "+" : ""}
            {offset.toFixed(1)} dtk
          </span>
          <button
            className="icon-button"
            aria-label="Perlambat lirik 0,5 detik"
            title="Perlambat lirik 0,5 detik"
            onClick={() => void adjustOffset(0.5)}
            disabled={!hasText || saving}
          >
            +
          </button>
        </div>
        <div className="lyrics-font-controls" aria-label="Ukuran font lirik">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              className={fontSize === size ? "lyrics-font-active" : ""}
              key={size}
              onClick={() => setFontSize(size)}
              aria-pressed={fontSize === size}
            >
              {size === "small" ? "Kecil" : size === "medium" ? "Sedang" : "Besar"}
            </button>
          ))}
        </div>
      </footer>
      {error && hasText && (
        <p className="lyrics-error" role="alert">
          {error}
        </p>
      )}

      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".lrc,.txt,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > 1024 * 1024) {
            setError("File lirik melebihi ukuran 1 MB.");
            return;
          }
          void file
            .text()
            .then((content) => {
              setDraft(content);
              setError("");
            })
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : "File lirik gagal dibaca."),
            );
        }}
      />

      {editing && (
        <div className="modal-backdrop lyrics-editor-backdrop" role="presentation">
          <section
            className="lyrics-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lyrics-editor-title"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">LIRIK LOKAL</p>
                <h2 id="lyrics-editor-title">Impor atau edit lirik</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Tutup editor lirik"
                onClick={() => setEditing(false)}
              >
                <X />
              </button>
            </div>
            <textarea
              aria-label="Teks lirik"
              maxLength={1024 * 1024}
              rows={11}
              placeholder={"Tempel lirik atau format LRC, misalnya:\n[00:12.50]Baris lirik"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="lyrics-editor-actions">
              <button className="sort-button" onClick={() => void importLyrics()}>
                <Upload size={15} /> Pilih .lrc atau .txt
              </button>
              <span className="muted">Maks. 1 MB · hanya disimpan di Musikku</span>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="sort-button" onClick={() => setEditing(false)}>
                Batal
              </button>
              <button
                className="button button-primary"
                disabled={saving}
                onClick={() => void save(draft, offset)}
              >
                {saving ? "Menyimpan…" : "Simpan lirik"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MediaSessionBridge() {
  const track = usePlayerStore((state) => state.track);
  const playing = usePlayerStore((state) => state.playing);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const duration = usePlayerStore((state) => state.duration);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    if (!track) {
      mediaSession.metadata = null;
      mediaSession.playbackState = "none";
      return;
    }
    const cover = trackCoverUrl(track);
    mediaSession.metadata =
      typeof MediaMetadata === "undefined"
        ? null
        : new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album,
            artwork: cover
              ? [{ src: new URL(cover, window.location.href).href, sizes: "512x512" }]
              : [],
          });
    mediaSession.playbackState = playing ? "playing" : "paused";
    if (duration > 0 && typeof mediaSession.setPositionState === "function") {
      mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    }
  }, [currentTime, duration, playing, track]);

  return null;
}

function SettingsPanel({
  backupPath,
  onBackup,
  onRestore,
}: {
  backupPath: string | null;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
}) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <p className="eyebrow">PENGATURAN</p>
          <h1>Backup &amp; Restore</h1>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <h2>Buat cadangan</h2>
          <p className="muted">
            Simpan playlist, favorit, metadata, pengaturan, dan informasi pustaka yang saat ini
            tersimpan di aplikasi.
          </p>
          <button className="button button-primary" onClick={() => void onBackup()}>
            <Download size={16} /> Create Backup
          </button>
        </div>

        <div className="settings-card">
          <h2>Pulihkan cadangan</h2>
          <p className="muted">
            Pilih file cadangan dan pilih untuk mengganti data saat ini dengan yang sudah aman.
          </p>
          <button className="button" onClick={() => void onRestore()}>
            <Upload size={16} /> Restore Backup
          </button>
        </div>
      </div>

      <div className="settings-meta">
        <span>Last Backup:</span>
        <strong>{backupPath ? backupPath : "Never"}</strong>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [section, setSection] = useState<Section>("Songs");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<TrackSort>("title");
  const [sortDescending, setSortDescending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [playlistDialog, setPlaylistDialog] = useState<
    { mode: "create" } | { mode: "rename"; playlist: Playlist } | null
  >(null);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("musikku-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [manualTheme, setManualTheme] = useState(
    () => localStorage.getItem("musikku-theme") !== null,
  );
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => {
    const value = localStorage.getItem("musikku-last-backup");
    return value || null;
  });
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    status: "unavailable",
  });
  const searchInput = useRef<HTMLInputElement>(null);
  const hasTrack = usePlayerStore((state) => state.track !== null);
  const currentTrack = usePlayerStore((state) => state.track);

  useEffect(() => {
    const desktop = window.musikkuDesktop;
    if (!desktop) return;
    const unsubscribe = desktop.onUpdateState(setUpdateState);
    void desktop.getUpdateState().then(setUpdateState, (error: unknown) =>
      setUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Pemeriksaan pembaruan gagal.",
      }),
    );
    return unsubscribe;
  }, []);

  async function runUpdateAction(action: "check" | "download" | "install") {
    const desktop = window.musikkuDesktop;
    if (!desktop) return;
    try {
      const nextState =
        action === "check"
          ? await desktop.checkForUpdates()
          : action === "download"
            ? await desktop.downloadUpdate()
            : await desktop.installUpdate();
      setUpdateState(nextState);
    } catch (error) {
      setUpdateState({
        status: "error",
        message: error instanceof Error ? error.message : "Pembaruan gagal dijalankan.",
      });
    }
  }

  const createBackupPayload = useCallback(async (): Promise<BackupPayload> => {
    const [nextTracks, nextPlaylists, nextFavorites] = await Promise.all([
      api<Track[]>("/tracks"),
      api<Playlist[]>("/playlists"),
      api<Track[]>("/favorites"),
    ]);
    const playerState = usePlayerStore.getState();
    const settings = {
      theme,
      manualTheme,
      volume: playerState.volume,
      repeat: playerState.repeat,
      shuffle: playerState.shuffle,
      queueIndex: playerState.queueIndex,
    };

    return {
      backupVersion: 1,
      applicationVersion: "1.0.0",
      createdAt: new Date().toISOString(),
      settings,
      playlists: nextPlaylists,
      favorites: nextFavorites,
      recentlyPlayed: [],
      queue: playerState.queue,
      library: nextTracks,
    };
  }, [manualTheme, theme]);

  async function createBackup() {
    const desktop = window.musikkuDesktop;
    if (!desktop) {
      setError("Cadangan desktop tidak tersedia di browser ini.");
      return;
    }
    try {
      const payload = await createBackupPayload();
      const savedPath = await desktop.exportBackup(payload);
      if (!savedPath) return;
      localStorage.setItem("musikku-last-backup", payload.createdAt);
      setLastBackupAt(payload.createdAt);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cadangan gagal dibuat.");
    }
  }

  async function restoreBackup() {
    const desktop = window.musikkuDesktop;
    if (!desktop) {
      setError("Pemulihan cadangan tidak tersedia di browser ini.");
      return;
    }
    const nextConfirmation = window.confirm(
      "Restore Backup?\n\nIni akan mengganti data playlist, favorit, dan pengaturan saat ini. Data saat ini dapat terpengaruh.",
    );
    if (!nextConfirmation) return;

    try {
      const filePath = window.prompt("Masukkan jalur file cadangan (.mpbak)", "");
      if (!filePath) return;
      const backup = await desktop.restoreBackup(filePath);
      const currentData = {
        playlists: playlists,
        favorites: Array.from(favoriteIds),
        settings: Object.fromEntries(Object.entries(localStorage)),
      };
      localStorage.setItem("musikku-backup-safety", JSON.stringify(currentData));

      await Promise.all(
        playlists.map(async (playlist) => {
          await api<void>(`/playlists/${playlist.id}`, { method: "DELETE" });
        }),
      );
      await Promise.all(
        Array.from(favoriteIds).map(async (trackId) => {
          await api<void>(`/favorites/${trackId}`, { method: "DELETE" });
        }),
      );

      for (const playlist of backup.playlists) {
        const created = await api<Playlist>("/playlists", {
          method: "POST",
          body: JSON.stringify({ name: playlist.name }),
        });
        for (const track of playlist.tracks) {
          try {
            await api<void>(`/playlists/${created.id}/tracks`, {
              method: "POST",
              body: JSON.stringify({ trackId: track.id }),
            });
          } catch {
            // skip missing tracks during restore
          }
        }
      }

      for (const track of backup.favorites) {
        try {
          await api<void>(`/favorites/${track.id}`, { method: "POST" });
        } catch {
          // skip missing favorites during restore
        }
      }

      for (const [key, value] of Object.entries(backup.settings ?? {})) {
        if (typeof value === "string") localStorage.setItem(key, value);
        else if (typeof value === "number" || typeof value === "boolean")
          localStorage.setItem(key, String(value));
      }
      if (backup.settings?.theme === "light" || backup.settings?.theme === "dark") {
        setTheme(backup.settings.theme);
        setManualTheme(true);
      }

      const queue = backup.queue ?? [];
      if (queue.length) {
        const nextIndex = Math.min(backup.settings?.queueIndex ?? 0, queue.length - 1);
        usePlayerStore.getState().setQueue(queue, nextIndex);
      }

      const restoredAt = backup.createdAt ?? new Date().toISOString();
      localStorage.setItem("musikku-last-backup", restoredAt);
      setLastBackupAt(restoredAt);
      await Promise.all([loadTracks(), loadPlaylistsAndFavorites()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pemulihan cadangan gagal.");
    }
  }

  const loadTracks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setTracks(await api<Track[]>("/tracks"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Koleksi gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPlaylistsAndFavorites = useCallback(async () => {
    try {
      const [nextPlaylists, favorites] = await Promise.all([
        api<Playlist[]>("/playlists"),
        api<Track[]>("/favorites"),
      ]);
      setPlaylists(nextPlaylists);
      setFavoriteIds(new Set(favorites.map((track) => track.id)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playlist dan favorit gagal dimuat.");
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (manualTheme) localStorage.setItem("musikku-theme", theme);
  }, [manualTheme, theme]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const updateFromSystem = (event: MediaQueryListEvent) => {
      if (!manualTheme) setTheme(event.matches ? "dark" : "light");
    };
    preference.addEventListener("change", updateFromSystem);
    return () => preference.removeEventListener("change", updateFromSystem);
  }, [manualTheme]);

  useEffect(() => {
    initializeAudio();
    void api<{ user: AuthUser }>("/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setSessionError(true))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (user) {
      void loadTracks();
      void loadPlaylistsAndFavorites();
    }
  }, [user, loadTracks, loadPlaylistsAndFavorites]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (
        editing ||
        (target instanceof HTMLElement && target.closest("button, a, [role='button']"))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const state = usePlayerStore.getState();
        seekTo(Math.max(0, state.currentTime - (event.shiftKey ? 15 : 5)));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const state = usePlayerStore.getState();
        seekTo(
          Math.min(
            state.duration || Number.MAX_SAFE_INTEGER,
            state.currentTime + (event.shiftKey ? 15 : 5),
          ),
        );
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    registerMediaAction(mediaSession, "play", () => playPlayback());
    registerMediaAction(mediaSession, "pause", () => pausePlayback());
    registerMediaAction(mediaSession, "previoustrack", () => usePlayerStore.getState().previous());
    registerMediaAction(mediaSession, "nexttrack", () => usePlayerStore.getState().next());
    registerMediaAction(mediaSession, "seekbackward", () => {
      const state = usePlayerStore.getState();
      seekTo(Math.max(0, state.currentTime - 10));
    });
    registerMediaAction(mediaSession, "seekforward", () => {
      const state = usePlayerStore.getState();
      seekTo(Math.min(state.duration, state.currentTime + 10));
    });
    registerMediaAction(mediaSession, "seekto", (details) => {
      if (typeof details.seekTime === "number") seekTo(details.seekTime);
    });
  }, []);

  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;
  const filteredTracks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const source =
      section === "Favorites"
        ? tracks.filter((track) => favoriteIds.has(track.id))
        : section === "Playlists"
          ? (selectedPlaylist?.tracks ?? [])
          : tracks;
    const matches = source.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(needle),
    );
    if (section === "Playlists") return matches;
    return matches.sort((left, right) => {
      if (sortBy === "recentlyAdded") {
        return (
          (Date.parse(left.createdAt) - Date.parse(right.createdAt)) * (sortDescending ? 1 : -1)
        );
      }
      const compared = left[sortBy].localeCompare(right[sortBy], "id", { sensitivity: "base" });
      return compared * (sortDescending ? -1 : 1);
    });
  }, [favoriteIds, search, section, selectedPlaylist, sortBy, sortDescending, tracks]);

  const groups = useMemo(() => {
    const key = section === "Artists" ? "artist" : "album";
    const grouped = new Map<string, Track[]>();
    for (const track of filteredTracks) {
      const name = track[key] || "Tidak diketahui";
      grouped.set(name, [...(grouped.get(name) ?? []), track]);
    }
    return Array.from(grouped.entries());
  }, [filteredTracks, section]);

  async function deleteTrack(track: Track) {
    await api<void>(`/tracks/${encodeURIComponent(track.id)}`, { method: "DELETE" });
    usePlayerStore.getState().clearTrack(track.id);
    setTracks((current) => current.filter((item) => item.id !== track.id));
    setPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.filter((item) => item.id !== track.id),
      })),
    );
    setFavoriteIds((current) => {
      const next = new Set(current);
      next.delete(track.id);
      return next;
    });
    setError("");
  }

  async function saveTrackInfo(track: Track, fields: Pick<Track, "title" | "artist" | "album">) {
    const updated = await api<Track>(`/tracks/${encodeURIComponent(track.id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    setTracks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((item) => (item.id === updated.id ? updated : item)),
      })),
    );
    usePlayerStore.getState().updateTrackInfo(updated);
    setError("");
  }

  async function saveTrackCover(track: Track, file: File): Promise<Track> {
    const formData = new FormData();
    formData.append("cover", file);
    const updated = await api<Track>(`/tracks/${encodeURIComponent(track.id)}/cover`, {
      method: "PATCH",
      body: formData,
    });
    setTracks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((item) => (item.id === updated.id ? updated : item)),
      })),
    );
    usePlayerStore.getState().updateTrackInfo(updated);
    return updated;
  }

  function selectSection(nextSection: Section) {
    setSection(nextSection);
    if (nextSection === "Playlists") setSelectedPlaylistId(null);
  }

  const closeNowPlaying = useCallback(() => setExpandedPlayer(false), []);
  const onLyricsUpdated = useCallback((updatedTrack: Track) => {
    setTracks((current) =>
      current.map((track) => (track.id === updatedTrack.id ? updatedTrack : track)),
    );
    setPlaylists((current) =>
      current.map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks.map((track) =>
          track.id === updatedTrack.id ? updatedTrack : track,
        ),
      })),
    );
    usePlayerStore.getState().updateTrackInfo(updatedTrack);
  }, []);

  function createPlaylist() {
    setPlaylistDialog({ mode: "create" });
  }

  function renamePlaylist(playlist: Playlist) {
    setPlaylistDialog({ mode: "rename", playlist });
  }

  async function savePlaylistName(name: string) {
    if (!playlistDialog) return;
    const isRename = playlistDialog.mode === "rename";
    const updated = await api<Playlist>(
      isRename ? `/playlists/${playlistDialog.playlist.id}` : "/playlists",
      {
        method: isRename ? "PATCH" : "POST",
        body: JSON.stringify({ name }),
      },
    );
    setPlaylists((current) =>
      isRename
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [...current, updated],
    );
    if (!isRename) {
      setSelectedPlaylistId(updated.id);
      setSection("Playlists");
    }
    setPlaylistDialog(null);
    setError("");
  }

  async function deletePlaylist(playlist: Playlist) {
    await api<void>(`/playlists/${playlist.id}`, { method: "DELETE" });
    setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
    setSelectedPlaylistId(null);
    setError("");
  }

  async function addToPlaylist(playlistId: string, track: Track) {
    try {
      const updated = await api<Playlist>(`/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ trackId: track.id }),
      });
      setPlaylists((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lagu gagal ditambahkan ke playlist.");
    }
  }

  async function removeFromPlaylist(track: Track) {
    if (!selectedPlaylist) return;
    try {
      await api<void>(`/playlists/${selectedPlaylist.id}/tracks/${track.id}`, { method: "DELETE" });
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === selectedPlaylist.id
            ? { ...playlist, tracks: playlist.tracks.filter((item) => item.id !== track.id) }
            : playlist,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lagu gagal dihapus dari playlist.");
    }
  }

  async function toggleFavorite(track: Track) {
    const isFavorite = favoriteIds.has(track.id);
    try {
      await api<void>(`/favorites/${track.id}`, { method: isFavorite ? "DELETE" : "POST" });
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (isFavorite) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Favorit gagal diperbarui.");
    }
  }

  async function movePlaylistTrack(target: Track) {
    if (!selectedPlaylist || !draggedTrackId || draggedTrackId === target.id) return;
    const trackIds = selectedPlaylist.tracks.map((track) => track.id);
    const fromIndex = trackIds.indexOf(draggedTrackId);
    const toIndex = trackIds.indexOf(target.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = trackIds.splice(fromIndex, 1);
    if (moved) trackIds.splice(toIndex, 0, moved);
    setPlaylists((current) =>
      current.map((playlist) =>
        playlist.id === selectedPlaylist.id
          ? {
              ...playlist,
              tracks: trackIds.map((id) =>
                selectedPlaylist.tracks.find((track) => track.id === id)!,
              ),
            }
          : playlist,
      ),
    );
    setDraggedTrackId(null);
    try {
      const updated = await api<Playlist>(`/playlists/${selectedPlaylist.id}/tracks`, {
        method: "PATCH",
        body: JSON.stringify({ trackIds }),
      });
      setPlaylists((current) =>
        current.map((playlist) => (playlist.id === updated.id ? updated : playlist)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Urutan playlist gagal disimpan.");
      void loadPlaylistsAndFavorites();
    }
  }

  if (checking) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          <Music2 />
        </div>
        <span>Menyiapkan Musikku…</span>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="loading-screen" role="alert">
        <div className="brand-mark">
          <Music2 />
        </div>
        <span>
          {sessionError
            ? "Sesi berakhir, tutup dan buka lagi aplikasi"
            : "Sesi aplikasi tidak tersedia. Tutup dan buka lagi aplikasi."}
        </span>
      </main>
    );
  }

  return (
    <div className={`app-shell ${hasTrack ? "has-player" : ""}`}>
      <MediaSessionBridge />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Music2 size={19} />
          </div>
          <span>Musikku</span>
        </div>
        <div className="sidebar-label">KOLEKSI</div>
        <nav aria-label="Navigasi utama" className="main-nav">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${section === label ? "nav-item-active" : ""}`}
              onClick={() => selectSection(label)}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>
                {label === "Songs"
                  ? "Lagu"
                  : label === "Albums"
                    ? "Album"
                    : label === "Artists"
                      ? "Artis"
                      : label === "Playlists"
                        ? "Playlist"
                        : label === "Settings"
                          ? "Pengaturan"
                          : "Favorit"}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-label">AKUN</div>
          <div className="account-row">
            <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
            <span>{user.username}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Perpustakaan</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {section === "Songs"
                ? "Lagu"
                : section === "Albums"
                  ? "Album"
                  : section === "Artists"
                    ? "Artis"
                    : section === "Playlists"
                      ? "Playlist"
                      : section === "Settings"
                        ? "Pengaturan"
                        : "Favorit"}
            </strong>
          </div>
          <div className="topbar-actions">
            <label className="search-field">
              <Search size={17} />
              <input
                ref={searchInput}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari koleksi"
                aria-label="Cari koleksi"
              />
              <kbd>{navigator.platform.toLowerCase().includes("mac") ? "⌘ K" : "Ctrl K"}</kbd>
            </label>
            <button
              className="icon-button theme-button"
              onClick={() => {
                setManualTheme(true);
                setTheme(theme === "dark" ? "light" : "dark");
              }}
              aria-label={theme === "dark" ? "Gunakan tema terang" : "Gunakan tema gelap"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="button button-primary upload-button"
              onClick={() => setUploadOpen(true)}
            >
              <Plus size={17} />
              <span>Tambah musik</span>
            </button>
          </div>
        </header>

        {updateState.status === "available" ||
        updateState.status === "downloading" ||
        updateState.status === "downloaded" ||
        updateState.status === "error" ? (
          <section className="update-banner" role="status" aria-live="polite">
            <div className="update-message">
              <strong>
                {updateState.status === "available"
                  ? `Pembaruan ${updateState.version} tersedia`
                  : updateState.status === "downloading"
                    ? "Mengunduh pembaruan…"
                    : updateState.status === "downloaded"
                      ? `Pembaruan ${updateState.version} siap`
                      : "Pembaruan gagal"}
              </strong>
              <span>
                {updateState.status === "available"
                  ? "Unduh versi terbaru untuk memasangnya."
                  : updateState.status === "downloading"
                    ? `${updateState.percent}%`
                    : updateState.status === "downloaded"
                      ? "Restart aplikasi untuk menyelesaikan instalasi."
                      : updateState.status === "error"
                        ? updateState.message
                        : ""}
              </span>
            </div>
            {updateState.status === "available" ? (
              <button
                className="button button-primary update-action"
                onClick={() => void runUpdateAction("download")}
              >
                <Download size={16} /> Download Update
              </button>
            ) : updateState.status === "downloading" ? (
              <progress className="update-progress" max={100} value={updateState.percent} />
            ) : updateState.status === "downloaded" ? (
              <button
                className="button button-primary update-action"
                onClick={() => void runUpdateAction("install")}
              >
                <RotateCw size={16} /> Restart &amp; Install
              </button>
            ) : (
              <button
                className="button update-action"
                onClick={() => void runUpdateAction("check")}
              >
                Coba lagi
              </button>
            )}
          </section>
        ) : null}

        <section className="library-content">
          {section === "Settings" ? (
            <SettingsPanel
              backupPath={
                lastBackupAt
                  ? new Date(lastBackupAt).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : null
              }
              onBackup={() => createBackup()}
              onRestore={() => restoreBackup()}
            />
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">MUSIKMU, CARA KAMU</p>
                  <h1>
                    {section === "Songs"
                      ? "Semua lagu"
                      : section === "Albums"
                        ? "Album"
                        : section === "Artists"
                          ? "Artis"
                          : section === "Playlists"
                            ? (selectedPlaylist?.name ?? "Playlist")
                            : "Favorit"}
                  </h1>
                  <p className="muted">
                    {section === "Playlists" && selectedPlaylist
                      ? `${selectedPlaylist.tracks.length} lagu`
                      : section === "Favorites"
                        ? `${filteredTracks.length} lagu favorit`
                        : `${tracks.length} lagu dalam koleksi`}
                  </p>
                </div>
                <div className="section-tools">
                  {section === "Songs" && (
                    <span className="count-pill">{filteredTracks.length} lagu</span>
                  )}
                  {section === "Playlists" && !selectedPlaylist && (
                    <button className="button button-primary" onClick={() => void createPlaylist()}>
                      <Plus size={16} /> Playlist baru
                    </button>
                  )}
                  {section === "Playlists" && selectedPlaylist && (
                    <>
                      <button className="sort-button" onClick={() => setSelectedPlaylistId(null)}>
                        Semua playlist
                      </button>
                      <button
                        className="sort-button"
                        onClick={() => void renamePlaylist(selectedPlaylist)}
                      >
                        Ubah nama
                      </button>
                      <button
                        className="sort-button"
                        onClick={() =>
                          setConfirmation({
                            message: `Hapus playlist “${selectedPlaylist.name}”?`,
                            onConfirm: () => deletePlaylist(selectedPlaylist),
                          })
                        }
                      >
                        Hapus
                      </button>
                    </>
                  )}
                  {section !== "Playlists" && (
                    <>
                      <select
                        className="sort-select"
                        aria-label="Urutkan lagu"
                        value={sortBy}
                        onChange={(event) => setSortBy(event.target.value as TrackSort)}
                      >
                        <option value="title">Judul</option>
                        <option value="artist">Artis</option>
                        <option value="album">Album</option>
                        <option value="recentlyAdded">Baru ditambahkan</option>
                      </select>
                      <button
                        className="sort-button sort-direction"
                        onClick={() => setSortDescending((descending) => !descending)}
                        aria-label={sortDescending ? "Urutkan naik" : "Urutkan turun"}
                        title={sortDescending ? "Urutan naik" : "Urutan turun"}
                      >
                        <ArrowDownUp size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="quick-tabs" role="tablist" aria-label="Jenis koleksi">
            {navItems.map(({ label }) => (
              <button
                role="tab"
                aria-selected={section === label}
                className={section === label ? "quick-tab active" : "quick-tab"}
                key={label}
                onClick={() => selectSection(label)}
              >
                {label === "Songs"
                  ? "Lagu"
                  : label === "Albums"
                    ? "Album"
                    : label === "Artists"
                      ? "Artis"
                      : label === "Playlists"
                        ? "Playlist"
                        : label === "Settings"
                          ? "Pengaturan"
                          : "Favorit"}
              </button>
            ))}
          </div>
            </>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() => {
                  void loadTracks();
                  void loadPlaylistsAndFavorites();
                }}
              >
                Coba lagi
              </button>
            </div>
          )}
          {loading ? (
            <div className="skeleton-list" aria-label="Memuat koleksi">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="skeleton-row" key={index}>
                  <span />
                  <div>
                    <i />
                    <i />
                  </div>
                </div>
              ))}
            </div>
          ) : section === "Playlists" && !selectedPlaylist ? (
            playlists.length ? (
              <div className="playlist-grid">
                {playlists.map((playlist) => (
                  <article className="playlist-card" key={playlist.id}>
                    <button
                      className="playlist-open"
                      onClick={() => setSelectedPlaylistId(playlist.id)}
                    >
                      <span className="playlist-art">
                        <ListMusic size={29} />
                      </span>
                      <strong>{playlist.name}</strong>
                      <span>{playlist.tracks.length} lagu</span>
                    </button>
                    <div className="playlist-card-actions">
                      <button className="text-button" onClick={() => void renamePlaylist(playlist)}>
                        Ubah nama
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          setConfirmation({
                            message: `Hapus playlist “${playlist.name}”?`,
                            onConfirm: () => deletePlaylist(playlist),
                          })
                        }
                      >
                        Hapus
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                query=""
                heading="Buat playlist pertamamu"
                description="Kumpulkan lagu favorit dalam daftar putar yang kamu susun sendiri."
                actionLabel="Playlist baru"
                onUpload={() => void createPlaylist()}
              />
            )
          ) : section === "Songs" ||
            section === "Favorites" ||
            (section === "Playlists" && selectedPlaylist !== null) ? (
            filteredTracks.length ? (
              <div className="song-list">
                <div className="list-heading">
                  <span>#</span>
                  <span>JUDUL</span>
                  <span>ALBUM</span>
                  <span>DURASI</span>
                  <span />
                </div>
                {filteredTracks.map((track, index) => (
                  <SongRow
                    key={track.id}
                    track={track}
                    index={index}
                    tracks={filteredTracks}
                    playlists={playlists}
                    favorite={favoriteIds.has(track.id)}
                    onDelete={
                      section === "Songs"
                        ? (item) =>
                            setConfirmation({
                              message: `Hapus “${item.title}” dari koleksi?`,
                              onConfirm: () => deleteTrack(item),
                            })
                        : undefined
                    }
                    onToggleFavorite={(item) => void toggleFavorite(item)}
                    onAddToQueue={(item) => usePlayerStore.getState().enqueue(item)}
                    onAddToPlaylist={(playlistId, item) => void addToPlaylist(playlistId, item)}
                    onRemoveFromPlaylist={
                      section === "Playlists" ? (item) => void removeFromPlaylist(item) : undefined
                    }
                    onDragTrack={
                      section === "Playlists" ? (item) => setDraggedTrackId(item.id) : undefined
                    }
                    onDropTrack={
                      section === "Playlists" ? (item) => void movePlaylistTrack(item) : undefined
                    }
                    onEditInfo={(item) => setEditingTrack(item)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                query={search}
                heading={
                  section === "Favorites"
                    ? "Belum ada favorit"
                    : section === "Playlists"
                      ? "Playlist ini masih kosong"
                      : undefined
                }
                description={
                  section === "Favorites"
                    ? "Tekan ikon hati pada lagu untuk menyimpannya di sini."
                    : section === "Playlists"
                      ? "Tambahkan lagu melalui menu + di baris lagu."
                      : undefined
                }
                onUpload={section === "Songs" ? () => setUploadOpen(true) : undefined}
              />
            )
          ) : section === "Albums" || section === "Artists" ? (
            groups.length ? (
              <div className={`collection-grid ${section === "Artists" ? "artist-grid" : ""}`}>
                {groups.map(([name, groupTracks]) => (
                  <button
                    className="collection-card"
                    key={name}
                    onClick={() => usePlayerStore.getState().setQueue(groupTracks, 0)}
                  >
                    <div className="collection-art">
                      <AlbumArt track={groupTracks[0]!} className="collection-cover" />
                      <span className="collection-play">
                        <Play size={20} fill="currentColor" />
                      </span>
                    </div>
                    <strong>{name}</strong>
                    <span>{section === "Artists" ? "Artis" : `${groupTracks.length} lagu`}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState query={search} onUpload={() => setUploadOpen(true)} />
            )
          ) : (
            <EmptyState query="" onUpload={() => setUploadOpen(true)} />
          )}
        </section>
      </main>

      <nav className="mobile-nav" aria-label="Navigasi bawah">
        {navItems.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={section === label ? "mobile-nav-item mobile-nav-active" : "mobile-nav-item"}
            aria-current={section === label ? "page" : undefined}
            onClick={() => selectSection(label)}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span>
              {label === "Songs"
                ? "Lagu"
                : label === "Albums"
                  ? "Album"
                  : label === "Artists"
                    ? "Artis"
                    : label === "Playlists"
                      ? "Playlist"
                      : "Favorit"}
            </span>
          </button>
        ))}
      </nav>
      {!isMiniPlayer && (
        <PlayerBar
          onExpand={() => setExpandedPlayer(true)}
          onLyrics={() => setLyricsOpen(true)}
          isFavorite={currentTrack ? favoriteIds.has(currentTrack.id) : false}
          onToggleFavorite={(track) => void toggleFavorite(track)}
          onToggleMini={() => setIsMiniPlayer(true)}
        />
      )}
      {isMiniPlayer && currentTrack && (
        <MiniPlayerBar
          onExpand={() => {
            setIsMiniPlayer(false);
            setExpandedPlayer(true);
          }}
          onLyrics={() => setLyricsOpen(true)}
          isFavorite={currentTrack ? favoriteIds.has(currentTrack.id) : false}
          onToggleFavorite={(track) => void toggleFavorite(track)}
        />
      )}
      {expandedPlayer && (
        <NowPlayingView
          isFavorite={currentTrack ? favoriteIds.has(currentTrack.id) : false}
          onLyrics={() => setLyricsOpen(true)}
          onClose={closeNowPlaying}
          onToggleFavorite={(track) => void toggleFavorite(track)}
        />
      )}
      {lyricsOpen && (
        <LyricsView onClose={() => setLyricsOpen(false)} onUpdated={onLyricsUpdated} />
      )}
      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={(track) =>
            setTracks((current) => [
              track,
              ...current.filter((existing) => existing.id !== track.id),
            ])
          }
        />
      )}
      {editingTrack && (
        <TrackInfoDialog
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSave={saveTrackInfo}
          onUploadCover={saveTrackCover}
        />
      )}
      {playlistDialog && (
        <PlaylistNameDialog
          initialName={playlistDialog.mode === "rename" ? playlistDialog.playlist.name : ""}
          onClose={() => setPlaylistDialog(null)}
          onSave={savePlaylistName}
        />
      )}
      {confirmation && (
        <ConfirmationDialog
          message={confirmation.message}
          onClose={() => setConfirmation(null)}
          onConfirm={confirmation.onConfirm}
          onError={(message) => setError(message)}
        />
      )}
    </div>
  );
}

function EmptyState({
  query,
  onUpload,
  heading,
  description,
  actionLabel,
}: {
  query: string;
  onUpload?: () => void;
  heading?: string;
  description?: string;
  actionLabel?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Music2 size={25} />
      </div>
      <h2>{heading ?? (query ? "Tidak ada hasil" : "Musikmu dimulai di sini")}</h2>
      <p>
        {description ??
          (query
            ? "Coba kata kunci lain."
            : "Tambahkan lagu dari file musik milikmu. Koleksimu hanya tersimpan di server pribadi.")}
      </p>
      {!query && onUpload && (
        <button className="button button-primary" onClick={onUpload}>
          <Upload size={16} /> {actionLabel ?? "Unggah lagu pertama"}
        </button>
      )}
    </div>
  );
}
