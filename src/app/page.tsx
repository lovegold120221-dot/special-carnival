"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type ActivePanel = "join" | "schedule";

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [creating, setCreating] = useState(false);
  // All hooks must be called before any conditional returns (Rules of Hooks).
  const [activePanel, setActivePanel] = useState<ActivePanel>("join");
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("Orbit Meeting");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduledLink, setScheduledLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<any[]>([]);
  const [customName, setCustomName] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const { profile } = useUser();
  const theme = profile?.theme || "system";
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const waitingForAuth = supabaseConfigured && authLoading;
  const redirectingToAuth = supabaseConfigured && !authLoading && !user;

  // Redirect unauthenticated users to the login page.
  // Skip redirect if Supabase isn't configured (anonymous usage).
  useEffect(() => {
    if (redirectingToAuth) {
      router.replace("/auth/login");
    }
  }, [redirectingToAuth, router]);

  // Show nothing while auth state is loading or redirecting.
  if (waitingForAuth) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Orbit Meeting</h1>
        </div>
      </main>
    );
  }
  if (redirectingToAuth) return null;

  function createSession() {
    setCreating(true);
    const sessionId = crypto.randomUUID();
    window.sessionStorage.setItem("orbitHostRoom", sessionId);
    router.push(`/session/${sessionId}`);
  }

  function parseMeetingId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";

    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      const sessionIndex = parts.indexOf("session");
      if (sessionIndex !== -1 && parts[sessionIndex + 1]) {
        return parts[sessionIndex + 1];
      }
    } catch {
      // Plain room names are handled below.
    }

    return trimmed
      .replace(/^\/+|\/+$/g, "")
      .replace(/^session\//, "")
      .replace(/\/room$/, "");
  }

  function joinMeeting() {
    const meetingId = parseMeetingId(joinValue);
    if (!meetingId) {
      setJoinError("Enter a meeting link or meeting ID.");
      return;
    }
    setJoinError("");
    router.push(`/session/${encodeURIComponent(meetingId)}`);
  }

  async function showSchedulePanel() {
    setActivePanel("schedule");
    setCopied(false);
    if (!scheduleTime) {
      setScheduleTime(getDefaultScheduleTime());
    }
    if (!scheduledLink) {
      setScheduledLink(`${window.location.origin}/session/${crypto.randomUUID()}`);
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, phone")
        .neq("id", user?.id || "");
      if (!error && data) {
        setAvailableProfiles(data);
      }
    } catch (e) {
      console.error("Failed to load profiles for invites:", e);
    }
  }

  async function copyScheduleLink() {
    if (!scheduledLink) return;
    await navigator.clipboard.writeText(scheduledLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const selectableProfiles = availableProfiles.filter(
    (p) => !selectedParticipants.some((sp) => sp.id === p.id)
  );

  const handleSelectProfile = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const profileId = e.target.value;
    if (!profileId) return;

    const selected = availableProfiles.find((p) => p.id === profileId);
    if (selected) {
      setSelectedParticipants((prev) => [...prev, selected]);
    }
    e.target.value = "";
  };

  function addCustomParticipant() {
    if (!customName.trim()) return;
    const newParticipant = {
      id: `custom-${crypto.randomUUID()}`,
      name: customName.trim(),
      email: customEmail.trim(),
      phone: customPhone.trim(),
      isCustom: true,
    };
    setSelectedParticipants((prev) => [...prev, newParticipant]);
    setCustomName("");
    setCustomEmail("");
    setCustomPhone("");
    setShowCustomForm(false);
  }

  function removeParticipant(index: number) {
    setSelectedParticipants((prev) => prev.filter((_, i) => i !== index));
  }

  function getEmailLink(participant: any) {
    if (!participant.email) return "#";
    const timeStr = scheduleTime ? formatScheduleTime(scheduleTime) : "Not set";
    const subject = `Invitation: ${scheduleTitle}`;
    const body = `Hi ${participant.name},\n\nYou are invited to join an Orbit Meeting!\n\nTopic: ${scheduleTitle}\nTime: ${timeStr}\nJoin Link: ${scheduledLink}\n\nSee you there!`;
    return `mailto:${encodeURIComponent(participant.email)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  }

  function getWhatsAppLink(participant: any) {
    if (!participant.phone) return "#";
    const sanitizedPhone = participant.phone.trim().replace(/[^0-9]/g, "");
    const timeStr = scheduleTime ? formatScheduleTime(scheduleTime) : "Not set";
    const text = `You are invited to join an Orbit Meeting!\n\nTopic: ${scheduleTitle}\nTime: ${timeStr}\nLink: ${scheduledLink}`;
    return `https://api.whatsapp.com/send?phone=${encodeURIComponent(
      sanitizedPhone
    )}&text=${encodeURIComponent(text)}`;
  }

  return (
    <main className="entry-shell" data-theme-preference={theme}>

      <section className="entry-main">
        <header className="entry-topbar">
          <div className="entry-topbar-inner">
            <div className="entry-topbar-left">
              <div className="entry-brand">
                <Image src="/icon-eburon.svg" alt="Eburon AI" width={34} height={34} className="entry-brand-logo" unoptimized />
                <span>Orbit Meeting</span>
              </div>
            </div>
            <div className="entry-topbar-actions">
              {user ? (
                <div className="entry-auth-section">
                  <span className="entry-auth-email" title={user.email ?? ""}>{user.email}</span>
                  <button className="entry-auth-btn" onClick={() => signOut()}>Sign out</button>
                </div>
              ) : (
                <div className="entry-auth-section">
                  <Link href="/auth/login" className="entry-auth-btn">Sign in</Link>
                  <Link href="/auth/signup" className="entry-auth-btn">Create account</Link>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="entry-content">
          <section className="entry-actions" aria-label="Meeting actions">
            <button
              className="meeting-action meeting-action--create"
              onClick={createSession}
              disabled={creating}
              id="create-session-btn"
            >
              <span className="meeting-action-icon" aria-hidden>
                <VideoPlusIcon />
              </span>
              <span>{creating ? "Creating..." : "Create"}</span>
            </button>

            <button
              className="meeting-action meeting-action--join"
              onClick={() => setActivePanel("join")}
            >
              <span className="meeting-action-icon" aria-hidden>
                <JoinIcon />
              </span>
              <span>Join</span>
            </button>

            <button
              className="meeting-action meeting-action--schedule"
              onClick={showSchedulePanel}
            >
              <span className="meeting-action-icon" aria-hidden>
                <CalendarIcon />
              </span>
              <span>Schedule meeting</span>
            </button>
          </section>

          <section className="entry-panel" aria-live="polite">
            {activePanel === "join" ? (
              <form
                className="entry-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  joinMeeting();
                }}
              >
                <div>
                  <p className="entry-panel-eyebrow">Join meeting</p>
                  <h2>Enter a meeting link or ID</h2>
                </div>
                <label className="entry-field">
                  <span>Meeting link or ID</span>
                  <input
                    value={joinValue}
                    onChange={(event) => {
                      setJoinValue(event.target.value);
                      setJoinError("");
                    }}
                    placeholder="https://.../session/room-id"
                    autoComplete="off"
                  />
                </label>
                {joinError && <p className="entry-error">{joinError}</p>}
                <button className="entry-primary" type="submit">
                  Join meeting
                </button>
              </form>
            ) : (
              <div className="entry-form">
                <div>
                  <p className="entry-panel-eyebrow">Schedule meeting</p>
                  <h2>Create an invite link</h2>
                </div>
                <label className="entry-field">
                  <span>Topic</span>
                  <input
                    value={scheduleTitle}
                    onChange={(event) => setScheduleTitle(event.target.value)}
                    maxLength={60}
                  />
                </label>
                <label className="entry-field">
                  <span>Date and time</span>
                  <input
                    type="datetime-local"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                  />
                </label>
                <div className="schedule-link">
                  <span>{scheduledLink}</span>
                </div>
                <button
                  className="entry-primary"
                  type="button"
                  onClick={copyScheduleLink}
                  style={{ marginBottom: "16px" }}
                >
                  {copied ? "Copied" : "Copy invite"}
                </button>

                <div className="invite-participants-section">
                  <div className="invite-section-title">Invite Participants</div>
                  
                  <div className="participant-select-row">
                    <label className="entry-field">
                      <span>Select Registered Profile</span>
                      <select
                        className="select-field"
                        onChange={handleSelectProfile}
                        defaultValue=""
                      >
                        <option value="" disabled>Select participant...</option>
                        {selectableProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.email || "Unnamed Profile"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      className="custom-participant-toggle-btn"
                      onClick={() => setShowCustomForm(!showCustomForm)}
                    >
                      {showCustomForm ? "Close Form" : "Add Custom Participant"}
                    </button>
                  </div>

                  {showCustomForm && (
                    <div className="custom-participant-form">
                      <span className="custom-participant-form-title">Custom Participant</span>
                      <div className="custom-participant-fields">
                        <label className="entry-field">
                          <span>Name</span>
                          <input
                            value={customName}
                            onChange={(e) => setCustomName(e.target.value)}
                            placeholder="e.g. John Doe"
                          />
                        </label>
                        <label className="entry-field">
                          <span>Email</span>
                          <input
                            type="email"
                            value={customEmail}
                            onChange={(e) => setCustomEmail(e.target.value)}
                            placeholder="e.g. john@example.com"
                          />
                        </label>
                        <label className="entry-field">
                          <span>Phone (WhatsApp)</span>
                          <input
                            type="tel"
                            value={customPhone}
                            onChange={(e) => setCustomPhone(e.target.value)}
                            placeholder="e.g. +1234567890"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="custom-participant-btn"
                        onClick={addCustomParticipant}
                        disabled={!customName.trim()}
                      >
                        Add
                      </button>
                    </div>
                  )}

                  {selectedParticipants.length > 0 && (
                    <div className="participants-list">
                      {selectedParticipants.map((participant, index) => (
                        <div className="participant-card" key={participant.id || index}>
                          <div className="participant-info">
                            <span className="participant-name">{participant.name}</span>
                            <div className="participant-meta">
                              {participant.email && <span>{participant.email}</span>}
                              {participant.phone && <span>{participant.phone}</span>}
                            </div>
                          </div>
                          <div className="participant-actions">
                            <button
                              type="button"
                              onClick={() => {
                                const link = getEmailLink(participant);
                                if (link !== "#") window.location.href = link;
                              }}
                              className="invite-btn invite-btn-email"
                              title="Send Email Invite"
                              disabled={!participant.email}
                            >
                              <MailIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const link = getWhatsAppLink(participant);
                                if (link !== "#") window.open(link, "_blank", "noopener,noreferrer");
                              }}
                              className="invite-btn invite-btn-whatsapp"
                              title="Send WhatsApp Invite"
                              disabled={!participant.phone}
                            >
                              <WhatsAppIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeParticipant(index)}
                              className="invite-btn invite-btn-remove"
                              title="Remove Participant"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="entry-upcoming" aria-label="Upcoming meeting">
          <div>
            <p className="entry-panel-eyebrow">Next up</p>
            <h2>{activePanel === "schedule" ? scheduleTitle : "Ready when you are"}</h2>
          </div>
          <p>
            {activePanel === "schedule" && scheduleTime
              ? formatScheduleTime(scheduleTime)
              : "Create a room now or join with an invite link."}
          </p>
        </section>
      </section>
    </main>
  );
}

function getDefaultScheduleTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function formatScheduleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function VideoPlusIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 16.5z" />
      <path d="m16 10 4-2.5v9L16 14" />
      <path d="M10 9v6" />
      <path d="M7 12h6" />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h11" />
      <path d="m11 8 4 4-4 4" />
      <path d="M15 5h2.5A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5H15" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3v4" />
      <path d="M17 3v4" />
      <path d="M4.5 8.5h15" />
      <path
        d="M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5z"
      />
      <path d="M9 13h6" />
      <path d="M9 16h3" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}
