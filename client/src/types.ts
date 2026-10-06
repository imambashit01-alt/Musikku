export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  mimeType: string;
  fileSize: number;
  hasCover: boolean;
  coverVersion: number;
  albumArtist: string;
  trackNumber: number | null;
  year: number | null;
  genre: string | null;
  hasLyrics: boolean;
  createdAt: string;
};

export type AuthUser = { id: number; username: string };

export type Playlist = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tracks: Track[];
};

export type ImportProgress = { completed: number; total: number; fileName: string };
export type ImportResult = {
  imported: Track[];
  duplicates: number;
  failures: string[];
};
export type ImportedLyrics = { name: string; text: string };
export type DesktopUpdateState =
  | { status: "unavailable" | "unconfigured" | "checking" | "up-to-date" }
  | { status: "available" | "downloaded"; version: string }
  | { status: "downloading"; percent: number }
  | { status: "error"; message: string };

export type BackupPayload = {
  backupVersion: number;
  applicationVersion: string;
  createdAt: string;
  settings: Record<string, unknown>;
  playlists: Playlist[];
  favorites: Track[];
  recentlyPlayed: Track[];
  queue: Track[];
  library: Track[];
};

declare global {
  interface Window {
    musikkuDesktop?: {
      importAudio: (mode: "files" | "folder") => Promise<ImportResult>;
      importLyrics: () => Promise<ImportedLyrics | null>;
      exportBackup: (payload: BackupPayload) => Promise<string | null>;
      restoreBackup: (filePath: string) => Promise<BackupPayload>;
      onImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
      getUpdateState: () => Promise<DesktopUpdateState>;
      checkForUpdates: () => Promise<DesktopUpdateState>;
      downloadUpdate: () => Promise<DesktopUpdateState>;
      installUpdate: () => Promise<DesktopUpdateState>;
      onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
    };
  }
}

export const trackCoverUrl = (track: Track) =>
  track.hasCover
    ? `/api/tracks/${encodeURIComponent(track.id)}/cover?v=${track.coverVersion}`
    : null;

export const trackStreamUrl = (track: Track) =>
  `/api/tracks/${encodeURIComponent(track.id)}/stream`;
