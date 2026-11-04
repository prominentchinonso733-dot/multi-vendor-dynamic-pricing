const adjustDemandScore = ({ demandScore, stock, orderUnitsLast24h = 0 }) => {
  let score = demandScore;
  if (Number.isFinite(stock)) {
    if (stock <= 2) score += 15;
    else if (stock <= 5) score += 10;
    else if (stock <= 10) score += 5;
    else if (stock >= 50) score -= 10;
  }
  if (Number.isFinite(orderUnitsLast24h) && orderUnitsLast24h > 0) {
    score += Math.min(20, orderUnitsLast24h * 2);
  }
  return Math.min(100, Math.max(0, score));
};

const calculateCurrentPrice = ({
  basePrice,
  demandScore,
  priceFloor,
  priceCeiling,
  stock,
  orderUnitsLast24h,
  lastOrderAt,
}) => {
  if (
    ![basePrice, demandScore, priceFloor, priceCeiling].every(
      Number.isFinite,
    ) ||
    basePrice <= 0 ||
    priceFloor <= 0 ||
    priceFloor > priceCeiling ||
    demandScore < 0 ||
    demandScore > 100
  ) {
    throw new RangeError("Product pricing values are invalid.");
  }

  const adjustedDemandScore = adjustDemandScore({
    demandScore,
    stock,
    orderUnitsLast24h:
      lastOrderAt instanceof Date &&
      lastOrderAt.getTime() <= Date.now() - 24 * 60 * 60 * 1000
        ? 0
        : orderUnitsLast24h,
  });
  const floorMinor = Math.ceil(priceFloor * 100 - Number.EPSILON * 100);
  const ceilingMinor = Math.floor(priceCeiling * 100 + Number.EPSILON * 100);
  if (floorMinor > ceilingMinor) {
    throw new RangeError(
      "Product price limits must contain a valid two-decimal price.",
    );
  }

  const calculatedMinor = Math.round(
    basePrice * (1 + (adjustedDemandScore - 50) / 100) * 100,
  );
  return Math.min(ceilingMinor, Math.max(floorMinor, calculatedMinor)) / 100;
};

module.exports = calculateCurrentPrice;
module.exports.adjustDemandScore = adjustDemandScore;
