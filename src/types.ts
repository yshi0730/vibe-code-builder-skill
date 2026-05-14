export const VALID_APP_TYPES = [
  "CRM",
  "calendar",
  "billing",
  "comparison",
  "pricing-page",
  "other",
] as const;

export type AppType = (typeof VALID_APP_TYPES)[number];
