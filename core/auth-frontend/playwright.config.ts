import { createPlaywrightConfig } from "@checkmate-monitor/test-utils-frontend/playwright";

export default createPlaywrightConfig({
  baseURL: "http://localhost:5173",
});
