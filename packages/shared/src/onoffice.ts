export interface OnOfficeStatus {
  configured: boolean;
  source: "settings" | "env" | null;
  apiUrl: string;
  automationCreates: boolean;
  writeAccess: boolean;
}

export interface OnOfficeConfigInput {
  token?: string;
  secret?: string;
}
