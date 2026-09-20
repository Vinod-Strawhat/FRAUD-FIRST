const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateIncidentId(now = new Date()): string {
  const date = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `FF-${date}-${suffix}`;
}

export function makeEntityId(prefix: "ev" | "tl"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}