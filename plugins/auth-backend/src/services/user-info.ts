import { createServiceRef } from "@checkmate/backend-api";
import { User } from "better-auth/types";

export interface UserInfoService {
  getUser(headers: Headers): Promise<User | undefined>;
}

export const userInfoRef = createServiceRef<UserInfoService>(
  "auth-backend.user-info"
);
