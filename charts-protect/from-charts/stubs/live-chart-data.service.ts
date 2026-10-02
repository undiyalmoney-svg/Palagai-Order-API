export type ChartBookId = 'nifty' | 'bank' | 'crude';
export const CHART_BOOKS: ReadonlyArray<{ id: ChartBookId; label: string }> = [
  { id: 'nifty', label: 'Nifty 50' },
  { id: 'bank', label: 'Bank Nifty' },
  { id: 'crude', label: 'Crude Oil Mini' },
];
