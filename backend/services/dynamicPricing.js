const calculateCurrentPrice = ({
  basePrice,
  demandScore,
  priceFloor,
  priceCeiling,
}) => {
  if (
    ![basePrice, demandScore, priceFloor, priceCeiling].every(Number.isFinite) ||
    basePrice <= 0 ||
    priceFloor <= 0 ||
    priceFloor > priceCeiling ||
    demandScore < 0 ||
    demandScore > 100
  ) {
    throw new RangeError("Product pricing values are invalid.");
  }

  return Math.min(
    priceCeiling,
    Math.max(
      priceFloor,
      basePrice * (1 + (demandScore - 50) / 100),
    ),
  );
};

module.exports = calculateCurrentPrice;
