// Orbit Meeting — Reminder System
// Persists scheduled meetings in localStorage and manages browser notifications.

export type ScheduledMeeting = {
  id: string;
  title: string;
  scheduledAt: string; // ISO string
  link: string;
  createdAt: string; // ISO string
  reminded: number[]; // timestamps (ms) of reminders already sent
};

const STORAGE_KEY = "orbit.scheduledMeetings";
const MINUTES_BEFORE = 15; // default reminder: 15 min before

// ── Persistence ───────────────────────────────────────────────────────────

export function getScheduledMeetings(): ScheduledMeeting[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScheduledMeeting[];
  } catch {
    return [];
  }
}

export function saveScheduledMeeting(meeting: ScheduledMeeting): void {
  if (typeof window === "undefined") return;
  const meetings = getScheduledMeetings();
  const idx = meetings.findIndex((m) => m.id === meeting.id);
  if (idx !== -1) {
    meetings[idx] = meeting;
  } else {
    meetings.push(meeting);
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
}

export function removeScheduledMeeting(id: string): void {
  if (typeof window === "undefined") return;
  const meetings = getScheduledMeetings().filter((m) => m.id !== id);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
}

export function clearPastMeetings(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const meetings = getScheduledMeetings().filter((m) => {
    const meetingTime = new Date(m.scheduledAt).getTime();
    // Keep meetings within the last hour (so "just started" still shows),
    // remove anything older than 1 hour past the meeting time.
    return meetingTime > now - 3_600_000;
  });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
}

// ── Queries ───────────────────────────────────────────────────────────────

export function getUpcomingMeetings(hoursAhead = 24): ScheduledMeeting[] {
  const now = Date.now();
  const cutoff = now + hoursAhead * 3_600_000;
  return getScheduledMeetings()
    .filter((m) => {
      const t = new Date(m.scheduledAt).getTime();
      return t > now - 600_000 && t < cutoff; // within window (allow 10min past)
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export function getNextMeeting(): ScheduledMeeting | null {
  const upcoming = getUpcomingMeetings(24);
  return upcoming.length > 0 ? upcoming[0] : null;
}

export function getMinutesUntilMeeting(meeting: ScheduledMeeting): number {
  const diff = new Date(meeting.scheduledAt).getTime() - Date.now();
  return Math.max(0, Math.round(diff / 60_000));
}

export function getMsUntilReminder(meeting: ScheduledMeeting, minutesBefore = MINUTES_BEFORE): number {
  const meetingTime = new Date(meeting.scheduledAt).getTime();
  const reminderTime = meetingTime - minutesBefore * 60_000;
  const now = Date.now();
  return Math.max(0, reminderTime - now);
}

// ── Browser Notifications ─────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export function showBrowserNotification(title: string, body: string, link: string): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  // Try via Service Worker first (works when page is in background)
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: "orbit-show-notification",
      payload: { title, body, link, tag: `orbit-reminder-${link}` },
    });
    return;
  }

  // Fallback: show directly
  try {
    const notif = new Notification(title, {
      body,
      tag: `orbit-reminder-${link}`,
      icon: "/icon.svg",
      badge: "/icon.svg",
    });
    notif.onclick = () => {
      window.focus();
      window.location.href = link;
      notif.close();
    };
  } catch {
    // Silently fail if notifications unavailable
  }
}

// ── Scheduling ────────────────────────────────────────────────────────────

const _reminderTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Schedule a browser notification for a meeting.
 * Marks the reminder as "sent" in localStorage after firing.
 */
export function scheduleMeetingReminder(
  meeting: ScheduledMeeting,
  minutesBefore = MINUTES_BEFORE,
): void {
  if (typeof window === "undefined") return;

  const ms = getMsUntilReminder(meeting, minutesBefore);
  if (ms <= 0) return; // already past reminder time

  const reminderKey = `${meeting.id}@${minutesBefore}`;

  // Don't double-schedule
  if (_reminderTimeouts.has(reminderKey)) return;
  // Check if this reminder was already sent
  const reminderTimestamp = new Date(meeting.scheduledAt).getTime() - minutesBefore * 60_000;
  if (meeting.reminded.includes(reminderTimestamp)) return;

  const timeout = setTimeout(() => {
    const title = "🔔 Meeting Reminder";
    const body = `"${meeting.title}" starts in ${minutesBefore} minutes`;
    showBrowserNotification(title, body, meeting.link);

    // Mark as reminded
    meeting.reminded.push(reminderTimestamp);
    saveScheduledMeeting(meeting);

    // Clean up
    _reminderTimeouts.delete(reminderKey);
  }, ms);

  _reminderTimeouts.set(reminderKey, timeout);
}

/**
 * Reschedule all pending reminders from stored meetings.
 * Call on every page mount / route change.
 */
export function rescheduleAllReminders(): void {
  if (typeof window === "undefined") return;
  // Clear existing timeouts
  for (const [, timeout] of _reminderTimeouts) {
    clearTimeout(timeout);
  }
  _reminderTimeouts.clear();

  clearPastMeetings();

  const meetings = getScheduledMeetings();
  for (const meeting of meetings) {
    scheduleMeetingReminder(meeting, MINUTES_BEFORE);
    // Also schedule an "at time" reminder if not already sent
    scheduleMeetingReminder(meeting, 0);
  }
}

// ── Calendar (ICS) export ─────────────────────────────────────────────────

export function generateIcsContent(meeting: ScheduledMeeting): string {
  const dtStart = new Date(meeting.scheduledAt);
  const dtEnd = new Date(dtStart.getTime() + 3_600_000); // assume 1h duration
  const uid = meeting.id;

  const fmtICS = (d: Date): string =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbit Meeting//EN",
    "BEGIN:VEVENT",
    `UID:${uid}@orbit-meeting`,
    `DTSTAMP:${fmtICS(new Date())}`,
    `DTSTART:${fmtICS(dtStart)}`,
    `DTEND:${fmtICS(dtEnd)}`,
    `SUMMARY:${meeting.title}`,
    `DESCRIPTION:Join Orbit Meeting: ${meeting.link}`,
    `URL:${meeting.link}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadIcsFile(meeting: ScheduledMeeting): void {
  const content = generateIcsContent(meeting);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meeting.title.replace(/[^a-z0-9]/gi, "_")}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Formatted helpers ─────────────────────────────────────────────────────

export function formatMeetingTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `in ${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}
