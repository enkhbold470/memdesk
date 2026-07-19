export interface WindowContext {
  app: string | null;
  title: string | null;
}

// Frontmost process name + its front window title. Window title needs
// Accessibility permission; if that is missing we still return the app name.
const SCRIPT = `
tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  set winTitle to ""
  try
    set winTitle to name of front window of (first application process whose frontmost is true)
  end try
end tell
return frontApp & "\n" & winTitle
`;

/** Read the frontmost app and window title via osascript. Never throws. */
export async function getContext(): Promise<WindowContext> {
  try {
    const proc = Bun.spawn(["osascript", "-e", SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return { app: null, title: null };
    const lines = out.split("\n");
    const app = (lines[0] ?? "").trim();
    const title = lines.slice(1).join("\n").trim();
    return { app: app || null, title: title || null };
  } catch {
    return { app: null, title: null };
  }
}

/** True when `app` matches any exclusion entry (case-insensitive substring). */
export function isExcluded(app: string | null, excludeApps: string[]): boolean {
  if (!app) return false;
  const a = app.toLowerCase();
  return excludeApps.some((e) => e && a.includes(e.toLowerCase()));
}
