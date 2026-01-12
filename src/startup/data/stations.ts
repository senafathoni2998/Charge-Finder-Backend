import { Station } from "../../models/station";

export const MOCK_STATIONS: Station[] = [
  {
    id: "st-001",
    name: "Central Plaza Fast Charge",
    lat: -6.2009,
    lng: 106.8167,
    address: "Jl. MH Thamrin, Jakarta",
    connectors: [
      { type: "CCS2", powerKW: 100, ports: 4, availablePorts: 2 },
      { type: "Type2", powerKW: 22, ports: 6, availablePorts: 5 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 7 * 60_000).toISOString(),
    photos: [
      {
        label: "Entrance",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.55), rgba(0,229,255,0.35))",
      },
      {
        label: "Bays",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.45), rgba(255,193,7,0.28))",
      },
      {
        label: "Payment",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.34), rgba(244,67,54,0.22))",
      },
    ],
    pricing: { currency: "IDR", perKwh: 2700, parkingFee: "Free 1 hour" },
    amenities: ["Restroom", "Coffee", "24/7 Security", "Wi‑Fi"],
    notes:
      "Best access from the basement entrance. Signal is strong near the payment kiosk.",
  },
  {
    id: "st-002",
    name: "Sudirman Hub",
    lat: -6.2146,
    lng: 106.8227,
    address: "Jl. Jend. Sudirman, Jakarta",
    connectors: [
      { type: "CCS2", powerKW: 60, ports: 2, availablePorts: 0 },
      { type: "CHAdeMO", powerKW: 50, ports: 1, availablePorts: 0 },
    ],
    status: "BUSY",
    lastUpdatedISO: new Date(Date.now() - 18 * 60_000).toISOString(),
    photos: [
      {
        label: "Hub",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.08), rgba(124,92,255,0.35))",
      },
      {
        label: "Signage",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.34), rgba(10,10,16,0.06))",
      },
      {
        label: "Queue",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.32), rgba(10,10,16,0.06))",
      },
    ],
    pricing: { currency: "IDR", perKwh: 3000, perMinute: 150 },
    amenities: ["Food court", "Restroom", "ATM"],
    notes: "Peak time 5–7pm. Queue usually moves every ~15 minutes.",
  },
  {
    id: "st-003",
    name: "Gandaria City Charger",
    lat: -6.2446,
    lng: 106.783,
    address: "Kebayoran Lama, Jakarta",
    connectors: [{ type: "Type2", powerKW: 11, ports: 2, availablePorts: 0 }],
    status: "OFFLINE",
    lastUpdatedISO: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    photos: [
      {
        label: "Mall entrance",
        gradient:
          "linear-gradient(135deg, rgba(244,67,54,0.22), rgba(10,10,16,0.06))",
      },
      {
        label: "Parking",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.06), rgba(255,193,7,0.28))",
      },
      {
        label: "Bay",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.06), rgba(0,229,255,0.26))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2600,
      parkingFee: "Parking rate applies",
    },
    amenities: ["Restroom", "Coffee", "Shopping"],
    notes: "Reported offline since morning. Consider nearby alternatives.",
  },
  {
    id: "st-004",
    name: "Kelapa Gading Supercharge",
    lat: -6.1577,
    lng: 106.905,
    address: "Kelapa Gading, Jakarta",
    connectors: [
      { type: "CCS2", powerKW: 150, ports: 6, availablePorts: 4 },
      { type: "Type2", powerKW: 22, ports: 4, availablePorts: 3 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 4 * 60_000).toISOString(),
    photos: [
      {
        label: "Drive‑in",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.30), rgba(124,92,255,0.40))",
      },
      {
        label: "Bays",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.28), rgba(10,10,16,0.06))",
      },
      {
        label: "Night",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.06), rgba(0,229,255,0.26))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 3200,
      parkingFee: "Free with validation",
    },
    amenities: ["24/7", "Restroom", "Coffee", "Kids area"],
  },
];
