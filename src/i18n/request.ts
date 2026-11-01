import { getRequestConfig } from "next-intl/server";

import messages from "../../messages/en.json";

// One language, English, and Swedish time for every date (plan 4 and 5.4).
export const TIME_ZONE = "Europe/Stockholm";

export default getRequestConfig(async () => ({
  locale: "en",
  messages,
  timeZone: TIME_ZONE,
}));
