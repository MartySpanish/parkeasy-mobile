// src/data.js

import {
    Building,
    Building2,
    Landmark,
    Mountain,
    Plane,
    Ship,
    ShoppingBag,
    Wrench,
    Zap,
} from 'lucide-react-native';

// Enhanced Belfast destinations with more categories
export const belfastDestinations = [
  { id: 'divis', name: 'Divis Mountain', icon: Mountain, lat: 54.5896, lng: -5.9989, category: 'outdoor' },
  { id: 'titanic', name: 'Titanic Quarter', icon: Ship, lat: 54.6089, lng: -5.9099, category: 'attraction' },
  { id: 'castle', name: 'Belfast Castle', icon: Landmark, lat: 54.6391, lng: -5.9494, category: 'attraction' },
  { id: 'cityhall', name: 'City Hall', icon: Building2, lat: 54.5973, lng: -5.9301, category: 'city' },
  { id: 'queens', name: "Queen's University", icon: Building, lat: 54.5844, lng: -5.9342, category: 'education' },
  { id: 'victoria', name: 'Victoria Square', icon: ShoppingBag, lat: 54.5977, lng: -5.9283, category: 'shopping' },
  { id: 'airport', name: 'Belfast Airport', icon: Plane, lat: 54.6575, lng: -6.2158, category: 'transport' },
  { id: 'evhubs', name: 'EV Charging Hubs', icon: Zap, category: 'charging' },
  { id: 'garages', name: 'Garages & Services', icon: Wrench, category: 'service' },
];

// MASSIVE comprehensive parking database
export const mockParkingSpots = [
  // paste the entire mockParkingSpots array here, unchanged
];
