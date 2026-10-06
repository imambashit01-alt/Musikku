import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "../types";
import { trackStreamUrl } from "../types";

export type RepeatMode = "off" | "all" | "one";

type PlayerState = {
  track: Track | null;
  queue: Track[];
  queueIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  error: string | null;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (currentTime: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setError: (error: string | null) => void;
  setQueue: (queue: Track[], startIndex: number) => void;
  clearQueue: () => void;
  clearTrack: (trackId: string) => void;
  updateTrackInfo: (track: Track) => void;
  enqueue: (track: Track) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setTrack: (track: Track, queue: Track[], index: number) => void;
  next: (automatic?: boolean) => void;
  previous: () => void;
  removeFromQueue: (index: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
};

let audio: HTMLAudioElement | null = null;
let lastPositionUpdate = -1;

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      track: null,
      queue: [],
      queueIndex: 0,
      playing: false,
      currentTime: 0,
      duration: 0,
      volume: 0.75,
      shuffle: false,
      repeat: "off",
      error: null,
      setPlaying: (playing) => set({ playing }),
      setCurrentTime: (currentTime) => set({ currentTime }),
      setDuration: (duration) => set({ duration }),
      setVolume: (volume) => {
        if (audio) audio.volume = volume;
        set({ volume });
      },
      setError: (error) => set({ error }),
      setQueue: (queue, startIndex) => {
        if (queue[startIndex]) get().setTrack(queue[startIndex], queue, startIndex);
      },
      clearQueue: () => {
        const track = get().track;
        set({ queue: track ? [track] : [], queueIndex: 0 });
      },
      clearTrack: (trackId) => {
        const state = get();
        if (state.track?.id === trackId) {
          audio?.pause();
          if (audio) {
            audio.removeAttribute("src");
            audio.load();
          }
          set({
            track: null,
            queue: [],
            queueIndex: 0,
            playing: false,
            currentTime: 0,
            duration: 0,
            error: null,
          });
          return;
        }
        const removedIndex = state.queue.findIndex((track) => track.id === trackId);
        if (removedIndex < 0) return;
        set({
          queue: state.queue.filter((track) => track.id !== trackId),
          queueIndex: Math.max(0, state.queueIndex - Number(removedIndex < state.queueIndex)),
        });
      },
      updateTrackInfo: (updatedTrack) =>
        set((state) => ({
          track: state.track?.id === updatedTrack.id ? updatedTrack : state.track,
          queue: state.queue.map((track) => (track.id === updatedTrack.id ? updatedTrack : track)),
        })),
      enqueue: (track) => {
        const state = get();
        if (!state.track) {
          get().setTrack(track, [track], 0);
          return;
        }
        set((current) => ({ queue: [...current.queue, track] }));
      },
      reorderQueue: (fromIndex, toIndex) =>
        set((state) => {
          if (
            fromIndex < 0 ||
            fromIndex >= state.queue.length ||
            toIndex < 0 ||
            toIndex >= state.queue.length ||
            fromIndex === toIndex
          ) {
            return state;
          }
          const queue = [...state.queue];
          const [moved] = queue.splice(fromIndex, 1);
          if (!moved) return state;
          queue.splice(toIndex, 0, moved);
          let queueIndex = state.queueIndex;
          if (fromIndex === state.queueIndex) queueIndex = toIndex;
          else if (fromIndex < state.queueIndex && toIndex >= state.queueIndex) queueIndex -= 1;
          else if (fromIndex > state.queueIndex && toIndex <= state.queueIndex) queueIndex += 1;
          return { queue, queueIndex };
        }),
      setTrack: (track, queue, index) => {
        const current = get().track;
        if (current?.id === track.id && audio) {
          if (audio.paused)
            void audio.play().catch(() => set({ error: "Audio tidak dapat diputar." }));
          else audio.pause();
          return;
        }

        if (!audio) initializeAudio();
        const player = audio!;
        lastPositionUpdate = -1;
        player.src = trackStreamUrl(track);
        player.load();
        set({ track, queue, queueIndex: index, currentTime: 0, duration: 0, error: null });
        void player
          .play()
          .catch(() => set({ playing: false, error: "Audio tidak dapat diputar." }));
      },
      next: (automatic = false) => {
        const state = get();
        if (state.repeat === "one" && automatic && audio) {
          audio.currentTime = 0;
          void audio
            .play()
            .catch(() => set({ playing: false, error: "Audio tidak dapat diputar." }));
          return;
        }
        if (!state.queue.length) return;
        let index = state.queueIndex + 1;
        if (state.shuffle && state.queue.length > 1) {
          index = Math.floor(Math.random() * state.queue.length);
          if (index === state.queueIndex) index = (index + 1) % state.queue.length;
        } else if (index >= state.queue.length) {
          if (state.repeat !== "all") {
            set({ playing: false });
            return;
          }
          index = 0;
        }
        get().setTrack(state.queue[index]!, state.queue, index);
      },
      previous: () => {
        const state = get();
        if (audio && audio.currentTime > 3) {
          audio.currentTime = 0;
          return;
        }
        if (!state.queue.length) return;
        const index = state.queueIndex > 0 ? state.queueIndex - 1 : state.queue.length - 1;
        get().setTrack(state.queue[index]!, state.queue, index);
      },
      removeFromQueue: (index) =>
        set((state) => {
          if (index <= state.queueIndex || index >= state.queue.length) return state;
          return { queue: state.queue.filter((_, queueIndex) => queueIndex !== index) };
        }),
      toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
      cycleRepeat: () =>
        set((state) => ({
          repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off",
        })),
    }),
    {
      name: "musikku-player",
      partialize: ({ track, queue, queueIndex, currentTime, volume, shuffle, repeat }) => ({
        track,
        queue,
        queueIndex,
        currentTime,
        volume,
        shuffle,
        repeat,
      }),
    },
  ),
);

export function initializeAudio(): void {
  if (audio) return;
  audio = new Audio();
  audio.preload = "metadata";
  audio.volume = usePlayerStore.getState().volume;
  const restoredTrack = usePlayerStore.getState().track;
  if (restoredTrack) {
    audio.src = trackStreamUrl(restoredTrack);
    audio.load();
  }
  audio.addEventListener("play", () => usePlayerStore.getState().setPlaying(true));
  audio.addEventListener("pause", () => usePlayerStore.getState().setPlaying(false));
  audio.addEventListener("timeupdate", () => {
    const currentTime = audio?.currentTime ?? 0;
    if (currentTime - lastPositionUpdate >= 0.2 || lastPositionUpdate < 0) {
      lastPositionUpdate = currentTime;
      usePlayerStore.getState().setCurrentTime(currentTime);
    }
  });
  audio.addEventListener("loadedmetadata", () => {
    const store = usePlayerStore.getState();
    store.setDuration(audio?.duration ?? 0);
    if (store.currentTime > 0 && audio) {
      audio.currentTime = Math.min(store.currentTime, audio.duration || store.currentTime);
    }
  });
  audio.addEventListener("seeking", () => {
    if (!audio) return;
    lastPositionUpdate = audio.currentTime;
    usePlayerStore.getState().setCurrentTime(audio.currentTime);
  });
  audio.addEventListener("ended", () => usePlayerStore.getState().next(true));
  audio.addEventListener("error", () => {
    if (usePlayerStore.getState().track) {
      usePlayerStore.getState().setError("Lagu gagal dimuat. Periksa file audio di server.");
    }
  });
}

export function togglePlayback(): void {
  if (!audio) return;
  if (audio.paused) playPlayback();
  else pausePlayback();
}

export function playPlayback(): void {
  if (audio?.paused) {
    void audio.play().catch(() => usePlayerStore.getState().setError("Audio tidak dapat diputar."));
  }
}

export function pausePlayback(): void {
  audio?.pause();
}

export function seekTo(seconds: number): void {
  if (!audio || !Number.isFinite(seconds)) return;
  const target = Math.max(
    0,
    Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds),
  );
  audio.currentTime = target;
  lastPositionUpdate = target;
  usePlayerStore.getState().setCurrentTime(target);
}
