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
    pricing: {
      currency: "IDR",
      perKwh: 2700,
      fastPerKwh: 3000,
      ultraFastPerKwh: 3300,
      parkingFee: "Free 1 hour",
    },
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
    pricing: {
      currency: "IDR",
      perKwh: 3000,
      fastPerKwh: 3300,
      ultraFastPerKwh: 3600,
      perMinute: 150,
    },
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
      fastPerKwh: 2900,
      ultraFastPerKwh: 3200,
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
      fastPerKwh: 3500,
      ultraFastPerKwh: 3800,
      parkingFee: "Free with validation",
    },
    amenities: ["24/7", "Restroom", "Coffee", "Kids area"],
  },
  {
    id: "st-005",
    name: "Bogor Botanical Charge Hub",
    lat: -6.5972,
    lng: 106.8059,
    address: "Jl. Ir. H. Juanda, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 120, ports: 4, availablePorts: 2 },
      { type: "Type2", powerKW: 22, ports: 4, availablePorts: 4 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 6 * 60_000).toISOString(),
    photos: [
      {
        label: "Entrance",
        gradient:
          "linear-gradient(135deg, rgba(33,150,83,0.30), rgba(0,229,255,0.25))",
      },
      {
        label: "Garden view",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.28), rgba(255,193,7,0.22))",
      },
      {
        label: "Plaza",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.26), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2800,
      fastPerKwh: 3100,
      ultraFastPerKwh: 3400,
      parkingFee: "Paid parking",
    },
    amenities: ["Restroom", "Coffee", "Wi-Fi", "Green park"],
    notes: "Main gate access; closest to the north parking area.",
  },
  {
    id: "st-006",
    name: "Pajajaran Avenue Fast Charge",
    lat: -6.5907,
    lng: 106.8075,
    address: "Jl. Pajajaran, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 90, ports: 3, availablePorts: 1 },
      { type: "CHAdeMO", powerKW: 50, ports: 1, availablePorts: 1 },
    ],
    status: "BUSY",
    lastUpdatedISO: new Date(Date.now() - 14 * 60_000).toISOString(),
    photos: [
      {
        label: "Canopy",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.32), rgba(10,10,16,0.08))",
      },
      {
        label: "Queue",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.30), rgba(10,10,16,0.08))",
      },
      {
        label: "Retail",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.28), rgba(124,92,255,0.24))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2950,
      fastPerKwh: 3250,
      ultraFastPerKwh: 3550,
      perMinute: 120,
    },
    amenities: ["Food court", "ATM", "Restroom"],
    notes: "Peak after 5pm; short queue on weekdays.",
  },
  {
    id: "st-007",
    name: "Cibinong City Charge Point",
    lat: -6.485,
    lng: 106.845,
    address: "Jl. Raya Bogor KM 46, Cibinong, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 80, ports: 3, availablePorts: 2 },
      { type: "Type2", powerKW: 22, ports: 4, availablePorts: 3 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 9 * 60_000).toISOString(),
    photos: [
      {
        label: "Drop-off",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.28), rgba(33,150,83,0.24))",
      },
      {
        label: "Parking row",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.26), rgba(10,10,16,0.08))",
      },
      {
        label: "Retail strip",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.24), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2750,
      fastPerKwh: 3050,
      ultraFastPerKwh: 3350,
      perMinute: 100,
    },
    amenities: ["Mini market", "Restroom", "Coffee"],
    notes: "Easy access from the main boulevard; best spot near the south gate.",
  },
  {
    id: "st-008",
    name: "Bogor Trade Center EV Station",
    lat: -6.595,
    lng: 106.799,
    address: "Jl. Ir. H. Juanda No. 68, Bogor, West Java",
    connectors: [
      { type: "Type2", powerKW: 22, ports: 6, availablePorts: 4 },
      { type: "CHAdeMO", powerKW: 50, ports: 1, availablePorts: 1 },
    ],
    status: "BUSY",
    lastUpdatedISO: new Date(Date.now() - 16 * 60_000).toISOString(),
    photos: [
      {
        label: "Lobby",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.06), rgba(0,229,255,0.30))",
      },
      {
        label: "Signage",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.28), rgba(10,10,16,0.08))",
      },
      {
        label: "Mall lane",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.28), rgba(0,229,255,0.20))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 3100,
      fastPerKwh: 3400,
      ultraFastPerKwh: 3700,
      perMinute: 140,
    },
    amenities: ["Food court", "Restroom", "ATM"],
    notes: "Queue moves fast before lunch; avoid after 6pm.",
  },
  {
    id: "st-009",
    name: "Sentul Highlands Charge Stop",
    lat: -6.536,
    lng: 106.839,
    address: "Sentul City, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 150, ports: 4, availablePorts: 1 },
      { type: "Type2", powerKW: 11, ports: 2, availablePorts: 2 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 5 * 60_000).toISOString(),
    photos: [
      {
        label: "Hillside",
        gradient:
          "linear-gradient(135deg, rgba(33,150,83,0.28), rgba(10,10,16,0.06))",
      },
      {
        label: "Canopy",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.24), rgba(124,92,255,0.24))",
      },
      {
        label: "Night view",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.08), rgba(255,193,7,0.24))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 3300,
      fastPerKwh: 3600,
      ultraFastPerKwh: 3900,
      parkingFee: "Free with validation",
    },
    amenities: ["Cafe", "Restroom", "Scenic view"],
    notes: "Steady availability in the morning; best signal near the kiosk.",
  },
  {
    id: "st-010",
    name: "Dramaga Campus Charger",
    lat: -6.558,
    lng: 106.724,
    address: "Dramaga, Bogor, West Java",
    connectors: [{ type: "Type2", powerKW: 7, ports: 4, availablePorts: 2 }],
    status: "OFFLINE",
    lastUpdatedISO: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    photos: [
      {
        label: "Campus gate",
        gradient:
          "linear-gradient(135deg, rgba(244,67,54,0.22), rgba(10,10,16,0.06))",
      },
      {
        label: "Parking lot",
        gradient:
          "linear-gradient(135deg, rgba(10,10,16,0.06), rgba(0,229,255,0.24))",
      },
      {
        label: "Library",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.24), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2500,
      fastPerKwh: 2800,
      ultraFastPerKwh: 3100,
    },
    amenities: ["Restroom", "Campus shuttle"],
    notes: "Maintenance scheduled; check again later today.",
  },
  {
    id: "st-011",
    name: "Tajur Trade Park Charge",
    lat: -6.6356,
    lng: 106.8048,
    address: "Tajur, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 100, ports: 4, availablePorts: 2 },
      { type: "Type2", powerKW: 22, ports: 4, availablePorts: 3 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 8 * 60_000).toISOString(),
    photos: [
      {
        label: "Entrance",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.26), rgba(33,150,83,0.24))",
      },
      {
        label: "Shops",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.24), rgba(10,10,16,0.06))",
      },
      {
        label: "Bays",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.24), rgba(10,10,16,0.08))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2900,
      fastPerKwh: 3200,
      ultraFastPerKwh: 3500,
      perMinute: 120,
    },
    amenities: ["Restroom", "Coffee", "Wi-Fi"],
    notes: "Close to the main entrance; best access from the south gate.",
  },
  {
    id: "st-012",
    name: "Ciawi Gateway Fast Charge",
    lat: -6.6452,
    lng: 106.8056,
    address: "Ciawi, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 120, ports: 3, availablePorts: 1 },
      { type: "CHAdeMO", powerKW: 50, ports: 1, availablePorts: 1 },
    ],
    status: "BUSY",
    lastUpdatedISO: new Date(Date.now() - 12 * 60_000).toISOString(),
    photos: [
      {
        label: "Canopy",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.28), rgba(10,10,16,0.08))",
      },
      {
        label: "Queue",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.30), rgba(10,10,16,0.08))",
      },
      {
        label: "Signage",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.26), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 3050,
      fastPerKwh: 3350,
      ultraFastPerKwh: 3650,
      perMinute: 140,
    },
    amenities: ["Food court", "ATM", "Restroom"],
    notes: "Peak on weekends; queue moves every 10-15 minutes.",
  },
  {
    id: "st-013",
    name: "Katulampa Riverside Charger",
    lat: -6.6318,
    lng: 106.8112,
    address: "Katulampa, Bogor, West Java",
    connectors: [
      { type: "Type2", powerKW: 11, ports: 4, availablePorts: 4 },
      { type: "CCS2", powerKW: 60, ports: 2, availablePorts: 2 },
    ],
    status: "AVAILABLE",
    lastUpdatedISO: new Date(Date.now() - 5 * 60_000).toISOString(),
    photos: [
      {
        label: "Riverside",
        gradient:
          "linear-gradient(135deg, rgba(33,150,83,0.26), rgba(10,10,16,0.06))",
      },
      {
        label: "Shelter",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.24), rgba(124,92,255,0.20))",
      },
      {
        label: "Cafe",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.24), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 2650,
      fastPerKwh: 2950,
      ultraFastPerKwh: 3250,
      parkingFee: "Paid parking",
    },
    amenities: ["Cafe", "Restroom", "Scenic view"],
    notes: "Quiet during weekdays; shaded bays near the river.",
  },
  {
    id: "st-014",
    name: "Baranangsiang Transit EV Bay",
    lat: -6.6399,
    lng: 106.7965,
    address: "Baranangsiang, Bogor, West Java",
    connectors: [
      { type: "CCS2", powerKW: 150, ports: 2, availablePorts: 0 },
      { type: "Type2", powerKW: 22, ports: 2, availablePorts: 1 },
    ],
    status: "BUSY",
    lastUpdatedISO: new Date(Date.now() - 17 * 60_000).toISOString(),
    photos: [
      {
        label: "Transit hub",
        gradient:
          "linear-gradient(135deg, rgba(0,229,255,0.26), rgba(10,10,16,0.06))",
      },
      {
        label: "Drop-off",
        gradient:
          "linear-gradient(135deg, rgba(124,92,255,0.24), rgba(10,10,16,0.08))",
      },
      {
        label: "Platform",
        gradient:
          "linear-gradient(135deg, rgba(255,193,7,0.22), rgba(10,10,16,0.06))",
      },
    ],
    pricing: {
      currency: "IDR",
      perKwh: 3200,
      fastPerKwh: 3500,
      ultraFastPerKwh: 3800,
      perMinute: 150,
    },
    amenities: ["Retail", "Restroom", "ATM"],
    notes: "Next to the transit hub; short stays recommended.",
  },
];
