import { create } from "zustand";

interface UserProfile {
  id?: string;
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  role: string | null;
}

interface UserState {
  profile: UserProfile | null;
  isLoaded: boolean;
  displayName: string;
  setProfile: (profile: UserProfile | null, email?: string) => void;
  clearProfile: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  isLoaded: false,
  displayName: "Guest",

  setProfile: (profile, email) => {
    let name = "Guest";
    
    if (profile?.display_name) {
      name = profile.display_name;
    } else if (profile?.first_name) {
      name = `${profile.first_name} ${profile.last_name || ""}`.trim();
    } else if (profile?.email) {
      name = profile.email.split('@')[0];
    } else if (email) {
      name = email.split('@')[0];
    }

    set({ 
      profile, 
      isLoaded: true, 
      displayName: name 
    });
  },

  clearProfile: () => {
    set({ 
      profile: null, 
      isLoaded: true, 
      displayName: "Guest" 
    });
  },
}));
