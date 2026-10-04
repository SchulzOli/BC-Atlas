// Detached helper started by the update notice: refreshes the cached latest
// version and exits. Failures are silent; the next command tries again.
import { refreshCache } from "./update.js";

try {
  await refreshCache();
} catch {
  // Offline, proxy, or registry errors only delay the notice.
}
