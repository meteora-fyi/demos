export type Metric = { label: string; value: string };
export type Receipt = { label: string; signature: string };
export type WorkshopState = {
  metrics: Metric[];
  receipts: Receipt[];
  notice?: string;
  initialized?: boolean;
};
