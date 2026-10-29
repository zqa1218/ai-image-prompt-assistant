import { create } from "zustand";
import { getSettings, saveSettings, type SettingsResponse } from "./api.ts";

export const useTransport = create<{
  settings: SettingsResponse | null;
  saving: boolean;
  error: string;
  refresh: () => Promise<void>;
  save: (patch: Parameters<typeof saveSettings>[0]) => Promise<boolean>;
}>((set, get) => ({
  settings: null,
  saving: false,
  error: "",
  async refresh() {
    try {
      set({ settings: await getSettings(), error: "" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
  async save(patch) {
    if (get().saving) return false;
    set({ saving: true, error: "" });
    try {
      set({ settings: await saveSettings(patch) });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set({ saving: false });
    }
  },
}));
