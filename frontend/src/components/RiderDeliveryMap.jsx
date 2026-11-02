import { useState } from "react";
import { MapPin } from "lucide-react";
import PropTypes from "prop-types";
import "./RiderDeliveryMap.css";

export default function RiderDeliveryMap({ pickup, destination }) {
  const [selectedStop, setSelectedStop] = useState("destination");
  const selectedLocation =
    selectedStop === "pickup" ? pickup : destination;

  return (
    <section className="rider-map" aria-label="Delivery map">
      <header className="rider-map__header">
        <div>
          <span className="rider-map__eyebrow">LAGOS DELIVERY COVERAGE</span>
          <h3>Route overview</h3>
        </div>
        <span className="rider-map__region">Lagos State · Nigeria</span>
      </header>
      <div className="rider-map__canvas">
        <svg
          aria-hidden="true"
          className="rider-map__roads"
          preserveAspectRatio="none"
          viewBox="0 0 640 280"
        >
          <path className="rider-map__water" d="M0 205 C150 165 205 252 348 207 S530 180 640 212 V280 H0Z" />
          <path d="M-20 48 170 130 322 62 660 138" />
          <path d="M34 290 160 185 260 195 390 88 655 20" />
          <path d="M95-20 206 90 204 173 340 280" />
          <path d="M440-20 389 74 470 160 444 300" />
          <path d="M-20 147 130 112 265 133 390 114 660 187" />
          <path className="rider-map__main-road" d="M132 224 246 176 343 160 452 94 533 66" />
          <path className="rider-map__route" d="M174 193 Q330 78 470 116" />
        </svg>
        <span className="rider-map__area rider-map__area--west">SURULERE</span>
        <span className="rider-map__area rider-map__area--center">IKEJA</span>
        <span className="rider-map__area rider-map__area--east">LEKKI</span>
        <button
          aria-label={`Pickup location: ${pickup}`}
          aria-pressed={selectedStop === "pickup"}
          className="rider-map__marker rider-map__marker--pickup"
          onClick={() => setSelectedStop("pickup")}
          type="button"
        >
          <MapPin aria-hidden="true" size={24} />
          <span>Pickup</span>
        </button>
        <button
          aria-label={`Delivery destination: ${destination}`}
          aria-pressed={selectedStop === "destination"}
          className="rider-map__marker rider-map__marker--destination"
          onClick={() => setSelectedStop("destination")}
          type="button"
        >
          <MapPin aria-hidden="true" size={24} />
          <span>Drop-off</span>
        </button>
      </div>
      <p className="rider-map__selected" role="status">
        <MapPin aria-hidden="true" size={16} />
        <strong>{selectedStop === "pickup" ? "Pickup" : "Destination"}:</strong>
        <span>{selectedLocation}</span>
      </p>
      <p className="rider-map__note">
        Map preview for regional coverage; confirm the exact address with the customer.
      </p>
    </section>
  );
}

RiderDeliveryMap.propTypes = {
  pickup: PropTypes.string.isRequired,
  destination: PropTypes.string.isRequired,
};
