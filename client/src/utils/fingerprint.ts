/**
 * Simple browser fingerprint generator for user identification
 *
 * Creates a stable fingerprint based on browser characteristics.
 * For production, consider using FingerprintJS or similar library.
 */

/**
 * Generate a simple browser fingerprint
 * Uses stable browser properties to create a consistent ID
 */
export async function generateFingerprint(): Promise<string> {
  const components: string[] = [];

  // Screen properties
  components.push(`${screen.width}x${screen.height}`);
  components.push(`${screen.colorDepth}`);
  components.push(`${window.devicePixelRatio || 1}`);

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Language
  components.push(navigator.language);

  // Platform
  components.push(navigator.platform);

  // Available plugins (limited in modern browsers but still useful)
  const plugins = Array.from(navigator.plugins || [])
    .map((p) => p.name)
    .slice(0, 5)
    .join(",");
  components.push(plugins || "none");

  // WebGL renderer (stable hardware identifier)
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl && gl instanceof WebGLRenderingContext) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
      }
    }
  } catch {
    components.push("webgl-unavailable");
  }

  // Canvas fingerprint (simple)
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      canvas.width = 100;
      canvas.height = 30;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(0, 0, 100, 30);
      ctx.fillStyle = "#069";
      ctx.font = "11px Arial";
      ctx.fillText("VoiceJibJab", 2, 15);
      components.push(canvas.toDataURL().slice(-50));
    }
  } catch {
    components.push("canvas-unavailable");
  }

  // Generate hash from components
  const fingerprint = await hashString(components.join("|"));

  return fingerprint;
}

/**
 * Hash a string using SHA-256
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get or generate a persistent fingerprint
 * Caches the fingerprint in localStorage for consistency
 */
export async function getPersistedFingerprint(): Promise<string> {
  const storageKey = "vjj-fingerprint";

  // Check for existing fingerprint
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  // Generate new fingerprint
  const fingerprint = await generateFingerprint();
  localStorage.setItem(storageKey, fingerprint);

  return fingerprint;
}
