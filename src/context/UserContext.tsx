"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export type GlossaryEntry = {
  source: string;       // original term/phrase
  translation: string;  // preferred translation
};

export type ThemePreference = "system" | "light" | "dark";

export type UserProfile = {
  id: string;
  name: string;
  theme: ThemePreference;
  default_language: string;
  voice: string;
  // Audio
  mic_device_id?: string;
  speaker_device_id?: string;
  auto_join_audio?: boolean;
  noise_suppression?: boolean;
  // Video
  cam_device_id?: string;
  mirror_video?: boolean;
  camera_off_on_join?: boolean;
  video_background?: string; // "none" | "blur" | "color-#hex" | "custom-{name}"
  // Translation
  content_type?: "normal" | "movie" | "cinematic_faithful";
  show_captions?: boolean;
  mute_original_audio?: boolean;
  translate_audio_playback?: boolean;
  glossary?: GlossaryEntry[];
  // Recording
  recording_save_path?: string;
  recording_auto_start?: boolean;
  email?: string;
  phone?: string;
};

type UserContextType = {
  profile: UserProfile | null;
  loading: boolean;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "orbit.theme";

const DEFAULT_PROFILE: UserProfile = {
  id: "",
  name: "",
  theme: "system",
  default_language: "en",
  voice: "Orus",
  auto_join_audio: false,
  noise_suppression: true,
  mirror_video: true,
  camera_off_on_join: false,
  video_background: "none",
  content_type: "normal",
  show_captions: true,
  mute_original_audio: true,
  translate_audio_playback: true,
  glossary: [],
  recording_save_path: "",
  recording_auto_start: false,
  email: "",
  phone: "",
};

function normalizeThemePreference(theme: unknown): ThemePreference {
  return theme === "light" || theme === "dark" || theme === "system"
    ? theme
    : "system";
}

function resolveThemePreference(theme: ThemePreference): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyThemePreference(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  const normalized = normalizeThemePreference(theme);
  const resolved = resolveThemePreference(normalized);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.style.colorScheme = resolved;
  window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      // Wait for auth to settle
      if (authLoading) return;

      if (!user) {
        // Not logged in — use anonymous profile for limited functionality
        let anonId = window.localStorage.getItem("orbitUserId");
        if (!anonId) {
          anonId = crypto.randomUUID();
          window.localStorage.setItem("orbitUserId", anonId);
        }

        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", anonId)
          .single();

        if (data) {
          const loadedProfile = {
            ...DEFAULT_PROFILE,
            ...data,
            theme: normalizeThemePreference(data.theme),
          };
          setProfile(loadedProfile);
          applyThemePreference(loadedProfile.theme);
        } else {
          const anonProfile = { ...DEFAULT_PROFILE, id: anonId };
          setProfile(anonProfile);
          applyThemePreference(anonProfile.theme);
          try {
            await supabase.from("profiles").upsert(anonProfile);
          } catch (err) {
            console.warn(
              "Supabase 'profiles' table may not exist (migration not run). " +
                "Anonymous settings will not persist.",
              err,
            );
          }
        }
        setLoading(false);
        return;
      }

      // Logged in — use auth user ID
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (data) {
          const loadedProfile = {
            ...DEFAULT_PROFILE,
            ...data,
            email: user.email || data.email || "",
            phone: user.phone || data.phone || "",
            theme: normalizeThemePreference(data.theme),
          };
          setProfile(loadedProfile);
          applyThemePreference(loadedProfile.theme);
        } else {
          // Profile should have been auto-created by the DB trigger,
          // but just in case, create it now
          const newProfile: UserProfile = {
            ...DEFAULT_PROFILE,
            id: user.id,
            name: user.user_metadata?.name || "",
            email: user.email || "",
            phone: user.phone || "",
          };
          setProfile(newProfile);
          applyThemePreference(newProfile.theme);
          try {
            await supabase.from("profiles").upsert(newProfile);
          } catch (err) {
            console.warn(
              "Supabase 'profiles' table may not exist (migration not run). " +
                "Settings will not persist.",
              err,
            );
          }
        }
      } catch (err) {
        console.error("Failed to load profile:", err);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [user, authLoading]);

  useEffect(() => {
    if (profile?.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => applyThemePreference("system");
    syncSystemTheme();
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [profile?.theme]);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!profile) return;
    const theme = normalizeThemePreference(updates.theme ?? profile.theme);
    const newProfile = { ...profile, ...updates, theme };
    setProfile(newProfile);
    applyThemePreference(theme);

    try {
      await supabase.from("profiles").upsert(newProfile);
    } catch (err) {
      console.error("Failed to sync profile:", err);
    }
  };

  return (
    <UserContext.Provider value={{ profile, loading, updateProfile }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
