import { createContext } from "react";

export type Profile = {
  id: number;
  avatar: string;
  permission: boolean;
  name: string;
  apiKey?: string;
}

export type ProfileContextType = {
  profile: Profile | undefined;
  setProfile: (profile: Profile | undefined) => void;
}

export const ProfileContext = createContext<ProfileContextType>({
  profile: undefined,
  setProfile: () => { }
});
