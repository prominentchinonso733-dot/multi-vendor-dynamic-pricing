import PropTypes from "prop-types";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./RiderDeliveryMap.css";

const pickupIcon = divIcon({
  className: "rider-map__leaflet-icon",
  html: '<span class="rider-map__leaflet-pin"><span>P</span></span>',
  iconSize: [32, 38],
  iconAnchor: [16, 36],
  popupAnchor: [0, -32],
});
const destinationIcon = divIcon({
  className: "rider-map__leaflet-icon rider-map__leaflet-icon--destination",
  html: '<span class="rider-map__leaflet-pin"><span>D</span></span>',
  iconSize: [32, 38],
  iconAnchor: [16, 36],
  popupAnchor: [0, -32],
});

export default function RiderDeliveryMap({ assignmentId, pickup, destination }) {
  return (
    <section className="rider-map" aria-label="Delivery map">
      <header className="rider-map__header">
        <div>
          <span className="rider-map__eyebrow">LAGOS DELIVERY COVERAGE</span>
          <h2>Route overview</h2>
        </div>
        <span className="rider-map__region">Lagos State · Nigeria</span>
      </header>
      <MapContainer
        key={assignmentId}
        center={[6.5244, 3.3792]}
        className="rider-map__canvas"
        scrollWheelZoom
        zoom={11}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker icon={pickupIcon} position={[6.6018, 3.3515]}>
          <Popup>
            <strong>Pickup store</strong>
            <br />
            {pickup}
          </Popup>
        </Marker>
        <Marker icon={destinationIcon} position={[6.4474, 3.4723]}>
          <Popup>
            <strong>Delivery destination</strong>
            <br />
            {destination}
          </Popup>
        </Marker>
      </MapContainer>
      <p className="rider-map__note">
        Pins use central Ikeja and Lekki coordinates as regional placeholders.
        Confirm exact addresses with the customer and pickup store.
      </p>
    </section>
  );
}

RiderDeliveryMap.propTypes = {
  assignmentId: PropTypes.string.isRequired,
  pickup: PropTypes.string.isRequired,
  destination: PropTypes.string.isRequired,
};
