import { createServiceRef } from "@checkmate/core-api";
import { User } from "better-auth/types";

export interface UserInfoService {
  getUser(headers: Headers): Promise<User | null>;
}

export const userInfoRef = createServiceRef<UserInfoService>(
  "auth-backend.user-info"
);
