export type KosovoImportTaxInput = {
  price: number;
  customsRate: number;
  vatRate: number;
  exciseRate?: number;
};

export type KosovoImportTaxResult = {
  price: number;
  customsDuty: number;
  exciseAmount: number;
  vatBase: number;
  vatAmount: number;
  totalTaxes: number;
  totalPayable: number;
};

function toPositiveNumber(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || Number.isNaN(numberValue)) {
    return 0;
  }
  return numberValue < 0 ? 0 : numberValue;
}

function toRate(value: unknown): number {
  const rate = toPositiveNumber(value);
  return rate > 1000 ? 1000 : rate;
}

export function calcKosovoImportTaxes(
  input: KosovoImportTaxInput
): KosovoImportTaxResult {
  const price = toPositiveNumber(input.price);
  const customsRate = toRate(input.customsRate);
  const vatRate = toRate(input.vatRate);
  const exciseRate = toRate(input.exciseRate ?? 0);

  const customsDuty = (price * customsRate) / 100;
  const exciseAmount = (price * exciseRate) / 100;
  const vatBase = price + customsDuty + exciseAmount;
  const vatAmount = (vatBase * vatRate) / 100;
  const totalTaxes = customsDuty + exciseAmount + vatAmount;
  const totalPayable = price + totalTaxes;

  return {
    price,
    customsDuty,
    exciseAmount,
    vatBase,
    vatAmount,
    totalTaxes,
    totalPayable,
  };
}
