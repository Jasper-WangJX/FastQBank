// Yellow strip at the top of AppLayout that appears whenever the browser
// reports `navigator.onLine === false`. Driven by `window.online` /
// `window.offline` events — no polling, no backend probe.
//
// Trade-off: navigator.onLine can lie under VPN/virtual-NIC stacks. A
// real failed request will still surface as a sonner toast (api.ts).

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState<boolean>(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="border-b border-yellow-300 bg-yellow-50 px-4 py-2 text-center font-mono text-xs text-yellow-900"
    >
      [ NET ] · Offline — changes may not save
    </div>
  );
}
