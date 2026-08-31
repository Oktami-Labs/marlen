/**
 * Socket state: "off" (no socket: never paired, pairing expired, or unlinked),
 * "pairing" (QR flow active), "connecting" (paired, dialing), "open".
 */
export type WhatsAppConnection = "off" | "pairing" | "connecting" | "open";

export interface WhatsAppStatus {
  linked: boolean;
  connection: WhatsAppConnection;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  pushName: string | null;
  sendAccess: boolean;
  /** Business fallback used when no personal account is linked. */
  business: { connected: boolean; name: string | null; accountId: string | null };
}
