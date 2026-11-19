export type PaperOptionContract = {
  tradingSymbol: string;
  instrumentToken: number;
  strike: number;
  expiry: string;
  optionType: 'CE' | 'PE';
  lotSize: number;
  source: string;
  exchange: string;
  product: string;
};
