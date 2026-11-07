/** Lines arrive as rupees / quantities / percentages typed by Sales; the server stores exact paise / milli / bps. */
export interface LineDraft {
  category: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  discountPercent: string;
  taxCode: string;
  estimatedUnitCost: string;
  costSource: string;
}
