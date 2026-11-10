import Decimal from "decimal.js";
export interface Rate {
  perMinute: string;
  connectionFee: string;
  minimumSeconds: number;
  incrementSeconds: number;
}
export function rateCall(duration: number, rate: Rate) {
  if (
    !Number.isInteger(duration) ||
    duration < 0 ||
    !Number.isInteger(rate.minimumSeconds) ||
    rate.minimumSeconds < 0 ||
    !Number.isInteger(rate.incrementSeconds) ||
    rate.incrementSeconds < 1
  )
    throw new Error("Invalid duration or increment");
  const perMinute = new Decimal(rate.perMinute),
    connection = new Decimal(rate.connectionFee);
  if (
    perMinute.isNegative() ||
    connection.isNegative() ||
    !perMinute.isFinite() ||
    !connection.isFinite()
  )
    throw new Error("Invalid rate");
  const seconds =
    Math.ceil(Math.max(duration, rate.minimumSeconds) / rate.incrementSeconds) *
    rate.incrementSeconds;
  return {
    billableSeconds: seconds,
    amount: connection
      .add(new Decimal(seconds).times(perMinute).div(60))
      .toFixed(6, Decimal.ROUND_HALF_UP),
  };
}
export function invoiceTotals(
  items: { quantity: string; unitPrice: string; taxPercent: string }[],
) {
  let subtotal = new Decimal(0),
    tax = new Decimal(0);
  for (const item of items) {
    const quantity = new Decimal(item.quantity),
      price = new Decimal(item.unitPrice),
      percent = new Decimal(item.taxPercent);
    if (
      !quantity.isPositive() ||
      price.isNegative() ||
      percent.isNegative() ||
      percent.gt(100)
    )
      throw new Error("Invalid invoice item");
    const line = quantity.times(price).toDecimalPlaces(6);
    subtotal = subtotal.add(line);
    tax = tax.add(line.times(percent).div(100).toDecimalPlaces(6));
  }
  return {
    subtotal: subtotal.toFixed(6),
    tax: tax.toFixed(6),
    total: subtotal.add(tax).toFixed(6),
  };
}
