export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const secondsPart = (totalSeconds % 60).toString().padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutesPart = (totalMinutes % 60).toString().padStart(2, "0");
    return `${hours}:${minutesPart}:${secondsPart}`;
  }
  return `${totalMinutes}:${secondsPart}`;
}
