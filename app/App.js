// App.js (ParkEasy Global - Updated)

import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import {
  Accessibility,
  AlertTriangle,
  Award,
  Building2,
  Car,
  CheckCircle,
  Clock,
  Coffee,
  Crown,
  Eye,
  Filter,
  Globe,
  Heart,
  History,
  Landmark,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Palette,
  Plus,
  PoundSterling,
  RefreshCw,
  Search,
  ShoppingBag,
  Star,
  Timer,
  User,
  X,
  Zap,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { initiatePremiumUpgrade } from './stripeConfig';
import { auth, db } from './firebaseConfig';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

// ---------- API Integration ----------

const PARKAPI_BASE_URL = 'https://api.parkendd.de';

// Available cities from ParkAPI + Belfast local data
const AVAILABLE_CITIES = [
  { id: 'Belfast', name: 'Belfast', country: 'Northern Ireland', coords: { lat: 54.5973, lng: -5.9301 } },
  { id: 'Dresden', name: 'Dresden', country: 'Germany', coords: { lat: 51.05089, lng: 13.73832 } },
  { id: 'Hamburg', name: 'Hamburg', country: 'Germany', coords: { lat: 53.5558, lng: 9.9957 } },
  { id: 'Karlsruhe', name: 'Karlsruhe', country: 'Germany', coords: { lat: 49.013774, lng: 8.404425 } },
  { id: 'Basel', name: 'Basel', country: 'Switzerland', coords: { lat: 47.5595986, lng: 7.5885761 } },
  { id: 'Zuerich', name: 'Zürich', country: 'Switzerland', coords: { lat: 47.36667, lng: 8.55 } },
  { id: 'Heidelberg', name: 'Heidelberg', country: 'Germany', coords: { lat: 49.41212, lng: 8.71064 } },
  { id: 'Nuernberg', name: 'Nürnberg', country: 'Germany', coords: { lat: 49.455277, lng: 11.077134 } },
  { id: 'Freiburg', name: 'Freiburg', country: 'Germany', coords: { lat: 47.9946843, lng: 7.8474426 } },
  { id: 'Ulm', name: 'Ulm', country: 'Germany', coords: { lat: 48.39851, lng: 9.99109 } },
  { id: 'Wiesbaden', name: 'Wiesbaden', country: 'Germany', coords: { lat: 50.082, lng: 8.24175 } },
];

// ---------- Belfast Local Parking Data ----------
const BELFAST_PARKING_SPOTS = [
  // ===== CITY CENTRE =====
  { id: 'belfast-1', name: 'City Hall Multi-Storey', address: '15 Donegall Square North, Belfast BT1 5GS', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 2.50, dailyMax: 12 }, available: 24, total: 450, rating: 4.3, evCharging: { available: true, ports: 4, speed: '7kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.2, nearDestinations: ['City Hall', 'Victoria Square'], description: 'Central Belfast multi-storey near City Hall', coords: { lat: 54.5977, lng: -5.9300 }, state: 'open', hours: { open: '06:00', close: '00:00', note: 'Mon-Sat. Sun 12-6pm' } },
  { id: 'belfast-2', name: 'Victoria Square Car Park', address: 'Victoria Square, Belfast BT1 4QG', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 2.00, dailyMax: 14 }, available: 89, total: 1000, rating: 4.5, evCharging: { available: true, ports: 8, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.3, nearDestinations: ['Victoria Square', 'City Hall'], description: 'Large car park inside Victoria Square shopping centre', coords: { lat: 54.5977, lng: -5.9283 }, state: 'open', hours: { open: '07:00', close: '23:00', note: 'Opens with shopping centre' } },
  { id: 'belfast-3', name: 'Castle Court Car Park', address: 'Royal Avenue, Belfast BT1 1DD', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 1.80, dailyMax: 10 }, available: 56, total: 700, rating: 4.0, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: true, security: true }, distance: 0.4, nearDestinations: ['Castle Court', 'Cathedral Quarter'], description: 'Multi-storey at Castle Court Shopping Centre', coords: { lat: 54.6005, lng: -5.9319 }, state: 'open', hours: { open: '07:30', close: '21:00', note: 'Mon-Sat. Sun 1-6pm' } },
  { id: 'belfast-4', name: 'Great Victoria Street NCP', address: 'Great Victoria Street, Belfast BT2 7BJ', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 2.20, dailyMax: 13 }, available: 34, total: 580, rating: 4.2, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.5, nearDestinations: ['Grand Central Hotel', 'Europa Hotel'], description: 'NCP multi-storey near Great Victoria Street station', coords: { lat: 54.5945, lng: -5.9370 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24 hours' } },
  { id: 'belfast-5', name: 'St Anne\'s Square Parking', address: 'St Anne\'s Square, Belfast BT1 2LR', type: 'underground', pricing: { free: false, hourlyRate: 2.80, dailyMax: 15 }, available: 42, total: 300, rating: 4.6, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.3, nearDestinations: ['Cathedral Quarter', 'St Anne\'s Cathedral'], description: 'Underground parking in the Cathedral Quarter', coords: { lat: 54.6017, lng: -5.9271 }, state: 'open', hours: { open: '07:00', close: '00:00', note: 'Open late for nightlife' } },
  { id: 'belfast-6', name: 'Donegall Place NCP', address: 'Donegall Place, Belfast BT1 5AJ', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 2.40, dailyMax: 14 }, available: 31, total: 400, rating: 4.1, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.1, nearDestinations: ['City Hall', 'Castle Court'], description: 'Prime city centre location on the main shopping street', coords: { lat: 54.5995, lng: -5.9307 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24 hours' } },
  { id: 'belfast-7', name: 'High Street Car Park', address: 'High Street, Belfast BT1 2AA', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.60, dailyMax: 8 }, available: 15, total: 80, rating: 3.7, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 0.3, nearDestinations: ['Victoria Square', 'Cathedral Quarter'], description: 'Small surface car park on High Street near the Albert Clock', coords: { lat: 54.5998, lng: -5.9259 }, state: 'open', hours: { open: '08:00', close: '18:00', note: 'Mon-Sat only' } },
  { id: 'belfast-8', name: 'Corporation Street Car Park', address: 'Corporation Street, Belfast BT1 3BA', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.20, dailyMax: 6 }, available: 40, total: 120, rating: 3.5, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: true }, distance: 0.5, nearDestinations: ['Cathedral Quarter'], description: 'Affordable surface lot near the Cathedral Quarter', coords: { lat: 54.6032, lng: -5.9245 }, state: 'open', hours: { open: '07:00', close: '22:00', note: 'Daily' } },

  // ===== TITANIC / EAST =====
  { id: 'belfast-9', name: 'Odyssey Parking', address: '2 Queens Quay, Belfast BT3 9QQ', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.50, dailyMax: 8 }, available: 120, total: 1200, rating: 4.1, evCharging: { available: true, ports: 6, speed: '50kW' }, features: { accessible: true, covered: false, security: true }, distance: 0.8, nearDestinations: ['SSE Arena', 'Titanic Quarter'], description: 'Large surface car park at the SSE Arena complex', coords: { lat: 54.6048, lng: -5.9186 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open for events, 24hr access' } },
  { id: 'belfast-10', name: 'Titanic Quarter Car Park', address: 'Queens Road, Belfast BT3 9EP', type: 'surface_lot', pricing: { free: false, hourlyRate: 2.00, dailyMax: 10 }, available: 67, total: 500, rating: 4.4, evCharging: { available: true, ports: 10, speed: '50kW' }, features: { accessible: true, covered: false, security: true }, distance: 1.2, nearDestinations: ['Titanic Museum', 'SSE Arena'], description: 'Car park serving the Titanic Belfast visitor attraction', coords: { lat: 54.6089, lng: -5.9099 }, state: 'open', hours: { open: '09:00', close: '19:00', note: 'Extended hours in summer' } },
  { id: 'belfast-11', name: 'Titanic Exhibition Centre', address: 'Queens Road, Titanic Quarter, Belfast BT3 9DT', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.80, dailyMax: 8 }, available: 200, total: 600, rating: 4.0, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: false, security: true }, distance: 1.4, nearDestinations: ['Titanic Museum', 'SSE Arena'], description: 'Large event parking near Titanic Exhibition Centre', coords: { lat: 54.6078, lng: -5.9075 }, state: 'open', hours: { open: '07:00', close: '23:00', note: 'Event dependent' } },
  { id: 'belfast-12', name: 'Sydenham Road Parking', address: 'Sydenham Road, Belfast BT3 9HB', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.00, dailyMax: 5 }, available: 30, total: 60, rating: 3.6, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 2.0, nearDestinations: ['Titanic Quarter'], description: 'Budget parking within walking distance of Titanic Quarter', coords: { lat: 54.6035, lng: -5.8995 }, state: 'open', hours: { open: '06:00', close: '20:00', note: 'Mon-Fri' } },

  // ===== QUEENS / SOUTH =====
  { id: 'belfast-13', name: 'Queens University Car Park', address: 'University Road, Belfast BT7 1NN', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.20, dailyMax: 6 }, available: 18, total: 150, rating: 3.8, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 1.0, nearDestinations: ['Queens University', 'Botanic Gardens'], description: 'University car park near Botanic Avenue', coords: { lat: 54.5844, lng: -5.9342 }, state: 'open', hours: { open: '07:00', close: '22:00', note: 'Restricted during term time' } },
  { id: 'belfast-14', name: 'Botanic Gardens Car Park', address: 'Botanic Avenue, Belfast BT7 1JG', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 22, total: 40, rating: 4.2, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 1.1, nearDestinations: ['Botanic Gardens', 'Ulster Museum'], description: 'Free parking at Botanic Gardens, limited spaces', coords: { lat: 54.5834, lng: -5.9310 }, state: 'open', hours: { open: '07:30', close: '20:00', note: 'Closes at dusk in winter' } },
  { id: 'belfast-15', name: 'Stranmillis Car Park', address: 'Stranmillis Road, Belfast BT9 5AH', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 35, total: 80, rating: 3.9, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: false, security: false }, distance: 1.8, nearDestinations: ['Botanic Gardens', 'Queens University'], description: 'Free street-side parking near Stranmillis village', coords: { lat: 54.5770, lng: -5.9380 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'On-street, no time limit' } },
  { id: 'belfast-16', name: 'Lisburn Road NCP', address: 'Lisburn Road, Belfast BT9 7GE', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 1.50, dailyMax: 8 }, available: 55, total: 250, rating: 4.0, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 1.5, nearDestinations: ['Lisburn Road shops'], description: 'Multi-storey serving the Lisburn Road shopping area', coords: { lat: 54.5820, lng: -5.9470 }, state: 'open', hours: { open: '07:00', close: '21:00', note: 'Mon-Sat, Sun 12-6' } },
  { id: 'belfast-17', name: 'Ormeau Road Parking', address: 'Ormeau Road, Belfast BT7 1SH', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.00, dailyMax: 5 }, available: 20, total: 50, rating: 3.5, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.3, nearDestinations: ['Ormeau Park'], description: 'Small surface lot near Ormeau Park and local cafes', coords: { lat: 54.5880, lng: -5.9210 }, state: 'open', hours: { open: '08:00', close: '18:00', note: 'Mon-Sat' } },

  // ===== NORTH / WEST BELFAST =====
  { id: 'belfast-18', name: 'Royal Victoria Hospital Parking', address: 'Grosvenor Road, Belfast BT12 6BA', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 1.80, dailyMax: 10 }, available: 45, total: 800, rating: 3.4, evCharging: { available: true, ports: 6, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 1.2, nearDestinations: ['Royal Victoria Hospital'], description: 'Hospital visitor car park with Blue Badge spaces', coords: { lat: 54.5945, lng: -5.9515 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24/7 for hospital visitors' } },
  { id: 'belfast-19', name: 'Falls Road Car Park', address: 'Falls Road, Belfast BT12 4PD', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 30, total: 60, rating: 3.6, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 1.8, nearDestinations: ['Falls Road murals'], description: 'Free parking near the Falls Road political murals', coords: { lat: 54.5960, lng: -5.9600 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'On-street, unrestricted' } },
  { id: 'belfast-20', name: 'Crumlin Road Gaol Car Park', address: 'Crumlin Road, Belfast BT14 6ST', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.00, dailyMax: 5 }, available: 50, total: 100, rating: 4.1, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: true }, distance: 2.0, nearDestinations: ['Crumlin Road Gaol'], description: 'Visitor parking at the historic Crumlin Road Gaol', coords: { lat: 54.6110, lng: -5.9470 }, state: 'open', hours: { open: '09:00', close: '18:00', note: 'Matches attraction hours' } },
  { id: 'belfast-21', name: 'Shankill Road Parking', address: 'Shankill Road, Belfast BT13 1FD', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 25, total: 40, rating: 3.4, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.5, nearDestinations: ['Shankill Road murals'], description: 'Free on-street parking near Shankill murals', coords: { lat: 54.6040, lng: -5.9520 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'On-street, unrestricted' } },

  // ===== PARK & RIDE =====
  { id: 'belfast-22', name: 'Boucher Road Park & Ride', address: 'Boucher Road, Belfast BT12 6HR', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 95, total: 600, rating: 4.0, evCharging: { available: true, ports: 4, speed: '7kW' }, features: { accessible: true, covered: false, security: true }, distance: 2.5, nearDestinations: ['Boucher Retail Park'], description: 'Free Park & Ride with Glider bus links to city centre', coords: { lat: 54.5753, lng: -5.9512 }, state: 'open', hours: { open: '06:00', close: '23:30', note: 'Matches Glider timetable' } },
  { id: 'belfast-23', name: 'Dundonald Park & Ride', address: 'Old Dundonald Road, Belfast BT16 1XT', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 150, total: 800, rating: 3.9, evCharging: { available: true, ports: 6, speed: '22kW' }, features: { accessible: true, covered: false, security: true }, distance: 6.0, nearDestinations: ['Dundonald Ice Bowl'], description: 'Free Park & Ride on the east side of Belfast', coords: { lat: 54.5879, lng: -5.8379 }, state: 'open', hours: { open: '06:00', close: '23:00', note: 'Daily, Glider service' } },
  { id: 'belfast-24', name: 'Black\'s Gate Park & Ride', address: 'Springfield Road, Belfast BT12 7DU', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 80, total: 300, rating: 3.8, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: false, security: true }, distance: 3.0, nearDestinations: ['Falls Road murals'], description: 'Free Park & Ride serving West Belfast via Glider', coords: { lat: 54.5890, lng: -5.9750 }, state: 'open', hours: { open: '06:00', close: '23:00', note: 'Daily, Glider service' } },
  { id: 'belfast-25', name: 'Colin Park & Ride', address: 'Pembroke Loop Road, Dunmurry BT17 9BU', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 110, total: 400, rating: 3.7, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: false, security: true }, distance: 7.5, nearDestinations: ['Colin town centre'], description: 'Free Park & Ride serving SW Belfast and Lisburn corridor', coords: { lat: 54.5545, lng: -6.0080 }, state: 'open', hours: { open: '06:00', close: '22:30', note: 'Mon-Sat, limited Sun' } },

  // ===== SHOPPING / RETAIL =====
  { id: 'belfast-26', name: 'Kennedy Centre Car Park', address: 'Falls Road, Belfast BT11 9AE', type: 'multi_story_garage', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 80, total: 500, rating: 3.8, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: true, security: true }, distance: 3.5, nearDestinations: ['Kennedy Centre'], description: 'Free covered parking at Kennedy Centre shopping mall', coords: { lat: 54.5870, lng: -5.9800 }, state: 'open', hours: { open: '08:00', close: '21:00', note: 'Mon-Sat, Sun 12-6' } },
  { id: 'belfast-27', name: 'Connswater Shopping Centre', address: 'Bloomfield Avenue, Belfast BT5 5LP', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 150, total: 700, rating: 4.0, evCharging: { available: true, ports: 6, speed: '50kW' }, features: { accessible: true, covered: false, security: true }, distance: 3.0, nearDestinations: ['Connswater Greenway'], description: 'Free parking at Connswater with EV rapid chargers', coords: { lat: 54.5950, lng: -5.8900 }, state: 'open', hours: { open: '07:00', close: '22:00', note: 'Daily' } },
  { id: 'belfast-28', name: 'Abbey Centre Newtownabbey', address: 'Longwood Road, Newtownabbey BT37 9UH', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 200, total: 1500, rating: 4.1, evCharging: { available: true, ports: 8, speed: '50kW' }, features: { accessible: true, covered: false, security: true }, distance: 6.5, nearDestinations: ['Abbey Centre'], description: 'Massive free car park at Abbey Centre retail park', coords: { lat: 54.6580, lng: -5.9020 }, state: 'open', hours: { open: '07:00', close: '22:00', note: 'Mon-Sat, Sun 1-6' } },
  { id: 'belfast-29', name: 'Forestside Shopping Centre', address: 'Upper Galwally, Belfast BT8 6FX', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 180, total: 1200, rating: 4.3, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: false, security: true }, distance: 4.5, nearDestinations: ['Forestside'], description: 'Large free car park at Forestside shopping complex', coords: { lat: 54.5600, lng: -5.9100 }, state: 'open', hours: { open: '08:00', close: '21:00', note: 'Mon-Sat, Sun 1-6' } },

  // ===== TRAIN STATIONS =====
  { id: 'belfast-30', name: 'Lanyon Place Station Parking', address: 'East Bridge Street, Belfast BT1 3NP', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.80, dailyMax: 9 }, available: 20, total: 150, rating: 3.9, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: false, security: true }, distance: 0.6, nearDestinations: ['Lanyon Place Station', 'Waterfront Hall'], description: 'Station parking near Belfast Lanyon Place and Waterfront Hall', coords: { lat: 54.5953, lng: -5.9210 }, state: 'open', hours: { open: '05:30', close: '00:30', note: 'Matches train timetable' } },
  { id: 'belfast-31', name: 'Great Victoria St Station', address: 'Great Victoria Street, Belfast BT2 7AP', type: 'surface_lot', pricing: { free: false, hourlyRate: 2.00, dailyMax: 10 }, available: 15, total: 80, rating: 3.7, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: true }, distance: 0.5, nearDestinations: ['Grand Central Hotel', 'Europa Hotel'], description: 'Limited station parking, better to use nearby NCP', coords: { lat: 54.5948, lng: -5.9385 }, state: 'open', hours: { open: '06:00', close: '23:00', note: 'Daily' } },
  { id: 'belfast-32', name: 'Adelaide Station Park & Ride', address: 'Adelaide Station, Lisburn Road, Belfast BT9', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 40, total: 90, rating: 4.0, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 2.8, nearDestinations: ['Lisburn Road shops'], description: 'Free rail commuter parking at Adelaide halt', coords: { lat: 54.5750, lng: -5.9530 }, state: 'open', hours: { open: '06:00', close: '22:00', note: 'Commuter hours' } },

  // ===== BELFAST INTERNATIONAL / CITY AIRPORT =====
  { id: 'belfast-33', name: 'George Best Belfast City Airport Short Stay', address: 'Airport Road, Belfast BT3 9JH', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 4.00, dailyMax: 30 }, available: 60, total: 400, rating: 4.2, evCharging: { available: true, ports: 8, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 4.0, nearDestinations: ['City Airport'], description: 'Short-stay covered parking at Belfast City Airport', coords: { lat: 54.6181, lng: -5.8719 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24/7' } },
  { id: 'belfast-34', name: 'George Best Belfast City Airport Long Stay', address: 'Airport Road, Belfast BT3 9JH', type: 'surface_lot', pricing: { free: false, hourlyRate: 2.00, dailyMax: 12 }, available: 250, total: 1500, rating: 4.0, evCharging: { available: true, ports: 4, speed: '7kW' }, features: { accessible: true, covered: false, security: true }, distance: 4.2, nearDestinations: ['City Airport'], description: 'Long-stay value parking with shuttle to terminal', coords: { lat: 54.6170, lng: -5.8740 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24/7, shuttle every 10 min' } },

  // ===== ADDITIONAL CITY CENTRE =====
  { id: 'belfast-35', name: 'Ann Street Car Park', address: 'Ann Street, Belfast BT1 4EF', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.40, dailyMax: 7 }, available: 25, total: 65, rating: 3.6, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 0.3, nearDestinations: ['Victoria Square', 'City Hall'], description: 'Compact surface lot in the heart of the city', coords: { lat: 54.5985, lng: -5.9265 }, state: 'open', hours: { open: '08:00', close: '18:30', note: 'Mon-Sat' } },
  { id: 'belfast-36', name: 'Oxford Street Car Park', address: 'Oxford Street, Belfast BT1 3LA', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.50, dailyMax: 8 }, available: 30, total: 90, rating: 3.7, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 0.4, nearDestinations: ['Lanyon Place Station', 'Waterfront Hall'], description: 'Handy for Waterfront Hall events and concerts', coords: { lat: 54.5960, lng: -5.9230 }, state: 'open', hours: { open: '07:00', close: '23:00', note: 'Extended for events' } },
  { id: 'belfast-37', name: 'Dunbar Link Car Park', address: 'Dunbar Link, Belfast BT1 1HG', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.20, dailyMax: 6 }, available: 35, total: 100, rating: 3.4, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 0.5, nearDestinations: ['Cathedral Quarter'], description: 'Budget surface lot near the Cathedral Quarter', coords: { lat: 54.6045, lng: -5.9260 }, state: 'open', hours: { open: '08:00', close: '20:00', note: 'Mon-Sat' } },
  { id: 'belfast-38', name: 'Clarence Street West NCP', address: 'Clarence Street West, Belfast BT2 7GP', type: 'multi_story_garage', pricing: { free: false, hourlyRate: 1.90, dailyMax: 11 }, available: 48, total: 350, rating: 4.0, evCharging: { available: true, ports: 2, speed: '7kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.6, nearDestinations: ['Grand Central Hotel', 'City Hall'], description: 'Covered NCP near the Linen Quarter', coords: { lat: 54.5940, lng: -5.9400 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open 24 hours' } },
  { id: 'belfast-39', name: 'Waterfront Hall Parking', address: '2 Lanyon Place, Belfast BT1 3WH', type: 'underground', pricing: { free: false, hourlyRate: 3.00, dailyMax: 18 }, available: 28, total: 200, rating: 4.5, evCharging: { available: true, ports: 4, speed: '22kW' }, features: { accessible: true, covered: true, security: true }, distance: 0.5, nearDestinations: ['Waterfront Hall', 'Lanyon Place Station'], description: 'Premium underground parking at Belfast Waterfront', coords: { lat: 54.5940, lng: -5.9205 }, state: 'open', hours: { open: '07:00', close: '00:00', note: 'Extended for events' } },
  { id: 'belfast-40', name: 'May Street Car Park', address: 'May Street, Belfast BT1 4NL', type: 'surface_lot', pricing: { free: false, hourlyRate: 1.30, dailyMax: 7 }, available: 18, total: 55, rating: 3.5, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 0.4, nearDestinations: ['City Hall', 'Victoria Square'], description: 'Small surface lot near May Street and the Courts', coords: { lat: 54.5955, lng: -5.9280 }, state: 'open', hours: { open: '08:00', close: '18:00', note: 'Mon-Fri, court hours' } },

  // ===== FREE STREET PARKING & LAY-BYS =====
  { id: 'belfast-41', name: 'Stranmillis Embankment (Free Street)', address: 'Stranmillis Embankment, Belfast BT7 1QB', type: 'street_parking', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 12, total: 20, rating: 4.0, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.9, nearDestinations: ['Botanic Gardens', 'Queens University'], description: 'Free on-street parking along the Lagan towpath. Quiet spot, great for walks.', coords: { lat: 54.5780, lng: -5.9290 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Unrestricted' }, hiddenGem: true },
  { id: 'belfast-42', name: 'Ravenhill Road (Free After 6pm)', address: 'Ravenhill Road, Belfast BT6 8GJ', type: 'street_parking', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 20, total: 35, rating: 3.8, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 2.0, nearDestinations: ['Ormeau Park', 'Ravenhill Rugby Grounds'], description: 'Free on-street parking after 6pm and weekends. Handy for Kingspan Stadium.', coords: { lat: 54.5830, lng: -5.9140 }, state: 'open', hours: { open: '18:00', close: '08:00', note: 'Free evenings & weekends' }, hiddenGem: false },
  { id: 'belfast-43', name: 'Ormeau Embankment (Free)', address: 'Ormeau Embankment, Belfast BT7 3GG', type: 'street_parking', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 18, total: 30, rating: 4.1, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.5, nearDestinations: ['Ormeau Park'], description: 'Hidden free parking along the river. Walk across to Ormeau Park.', coords: { lat: 54.5860, lng: -5.9180 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Unrestricted' }, hiddenGem: true },
  { id: 'belfast-44', name: 'University Street (Free Evenings)', address: 'University Street, Belfast BT7 1HP', type: 'street_parking', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 10, total: 25, rating: 3.9, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.0, nearDestinations: ['Queens University', 'Botanic Gardens'], description: 'Free after 6pm. Walking distance to Botanic Ave restaurants.', coords: { lat: 54.5850, lng: -5.9320 }, state: 'open', hours: { open: '18:00', close: '08:00', note: 'Free evenings & weekends' }, hiddenGem: false },
  { id: 'belfast-45', name: 'Dee Street (Free)', address: 'Dee Street, Belfast BT4 1FT', type: 'street_parking', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 15, total: 30, rating: 3.5, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 1.8, nearDestinations: ['Titanic Quarter', 'SSE Arena'], description: 'Free residential street parking, 15 min walk to Titanic Quarter.', coords: { lat: 54.6010, lng: -5.9050 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Unrestricted' }, hiddenGem: true },

  // ===== BLACK MOUNTAIN / DIVIS AREA =====
  { id: 'belfast-46', name: 'Black Mountain Car Park', address: 'Whiterock Road, Belfast BT12 7PG', type: 'lay_by', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 15, total: 20, rating: 4.5, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 4.5, nearDestinations: ['Black Mountain', 'Divis'], description: 'Free car park at the Black Mountain/Divis trailhead. Popular with hikers. Gets busy weekends.', coords: { lat: 54.6050, lng: -5.9900 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Open access, no gates' }, hiddenGem: true },
  { id: 'belfast-47', name: 'Divis Road Lay-by', address: 'Upper Divis Road, Belfast BT17 0NF', type: 'lay_by', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 8, total: 12, rating: 4.2, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 5.0, nearDestinations: ['Black Mountain', 'Divis'], description: 'Small lay-by on the upper Divis road. Shortcut to the summit. Hidden gem for locals.', coords: { lat: 54.6080, lng: -5.9950 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Roadside lay-by' }, hiddenGem: true },
  { id: 'belfast-48', name: 'Whiterock Leisure Centre', address: 'Whiterock Road, Belfast BT12 7PG', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 25, total: 50, rating: 3.9, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 4.0, nearDestinations: ['Black Mountain', 'Divis'], description: 'Free leisure centre car park. Good alternative when the mountain car park is full.', coords: { lat: 54.6020, lng: -5.9850 }, state: 'open', hours: { open: '07:00', close: '22:00', note: 'Leisure centre hours' }, hiddenGem: false },
  { id: 'belfast-49', name: 'Hannahstown Hill Lay-by', address: 'Hannahstown Hill, Belfast BT17 0LT', type: 'lay_by', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 6, total: 8, rating: 4.3, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 6.0, nearDestinations: ['Black Mountain', 'Colin Glen'], description: 'Quiet lay-by on the back road to Black Mountain. Amazing views over Belfast.', coords: { lat: 54.5950, lng: -6.0050 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Roadside lay-by' }, hiddenGem: true },

  // ===== CAVE HILL / NORTH =====
  { id: 'belfast-50', name: 'Cave Hill Adventurous Playground Car Park', address: 'Belfast Castle Estate, Antrim Road, Belfast BT15 5GR', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 30, total: 80, rating: 4.4, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 4.0, nearDestinations: ['Cave Hill', 'Belfast Castle'], description: 'Free car park at Belfast Castle. Trail access to Cave Hill and Napoleon\'s Nose.', coords: { lat: 54.6300, lng: -5.9430 }, state: 'open', hours: { open: '07:30', close: '21:00', note: 'Gates lock at dusk in winter' }, hiddenGem: false },
  { id: 'belfast-51', name: 'Upper Hightown Road Lay-by', address: 'Upper Hightown Road, Belfast BT36 7QX', type: 'lay_by', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 5, total: 8, rating: 4.1, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: false, covered: false, security: false }, distance: 6.5, nearDestinations: ['Cave Hill'], description: 'Little-known lay-by giving back access to Cave Hill. Avoids the crowds.', coords: { lat: 54.6400, lng: -5.9500 }, state: 'open', hours: { open: '24hrs', close: '24hrs', note: 'Roadside lay-by' }, hiddenGem: true },

  // ===== COLIN GLEN / SOUTH WEST =====
  { id: 'belfast-52', name: 'Colin Glen Forest Park Car Park', address: 'Stewartstown Road, Belfast BT17 0HW', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 40, total: 80, rating: 4.3, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: true }, distance: 7.0, nearDestinations: ['Colin Glen'], description: 'Free car park at Colin Glen Forest Park. Gruffalo trail, zipline, and walks.', coords: { lat: 54.5650, lng: -6.0100 }, state: 'open', hours: { open: '08:00', close: '20:00', note: 'Seasonal hours vary' }, hiddenGem: false },

  // ===== LAGAN TOWPATH =====
  { id: 'belfast-53', name: 'Lockkeeper\'s Inn Car Park', address: 'Lock Keeper\'s Lane, Stranmillis, Belfast BT9 5GN', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 20, total: 40, rating: 4.2, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 2.5, nearDestinations: ['Lagan Towpath', 'Botanic Gardens'], description: 'Free car park at the Lockkeeper\'s. Start point for Lagan towpath walks.', coords: { lat: 54.5690, lng: -5.9320 }, state: 'open', hours: { open: '08:00', close: '22:00', note: 'Car park gates' }, hiddenGem: true },
  { id: 'belfast-54', name: 'Shaw\'s Bridge Car Park', address: 'Shaw\'s Bridge, Malone Road, Belfast BT9 5LE', type: 'surface_lot', pricing: { free: true, hourlyRate: 0, dailyMax: 0 }, available: 25, total: 50, rating: 4.4, evCharging: { available: false, ports: 0, speed: null }, features: { accessible: true, covered: false, security: false }, distance: 4.0, nearDestinations: ['Lagan Towpath', 'Barnett Demesne'], description: 'Free riverside car park. Popular for towpath walks, cycling, and dog walking.', coords: { lat: 54.5560, lng: -5.9440 }, state: 'open', hours: { open: '07:00', close: '21:00', note: 'Gates lock at dusk' }, hiddenGem: false },
];

// Fetch parking data — Belfast uses local data, other cities use ParkAPI
const fetchParkingData = async (cityId) => {
  // Belfast uses built-in local data
  if (cityId === 'Belfast') {
    return BELFAST_PARKING_SPOTS;
  }

  // Other cities use the ParkAPI
  try {
    const response = await fetch(`${PARKAPI_BASE_URL}/${cityId}`);
    const data = await response.json();

    // Transform API data to our format
    return data.lots?.map((lot, index) => ({
      id: `${cityId}-${index}`,
      name: lot.name,
      address: lot.address || 'Address not available',
      type: 'multi_story_garage',
      pricing: {
        free: lot.free === lot.total,
        hourlyRate: 2.5,
        dailyMax: 12,
      },
      available: lot.free || 0,
      total: lot.total || 0,
      rating: 4.2,
      evCharging: { available: false, ports: 0, speed: null },
      features: { accessible: true, covered: true, security: true },
      distance: 0,
      nearDestinations: [],
      description: `Parking facility in ${cityId}`,
      coords: lot.coords || { lat: 0, lng: 0 },
      state: lot.state || 'unknown',
    })) || [];
  } catch (error) {
    console.error('Error fetching parking data:', error);
    return [];
  }
};

// ---------- Popular Destinations by City ----------

const getDestinationsForCity = (cityId) => {
  const destinations = {
    Belfast: [
      { id: 'city_hall', name: 'City Hall', icon: Landmark },
      { id: 'victoria_square', name: 'Victoria Square', icon: ShoppingBag },
      { id: 'titanic_quarter', name: 'Titanic Quarter', icon: Landmark },
      { id: 'cathedral_quarter', name: 'Cathedral Quarter', icon: Coffee },
      { id: 'botanic_gardens', name: 'Botanic Gardens', icon: MapPin },
      { id: 'queens_university', name: "Queen's University", icon: Building2 },
      { id: 'waterfront_hall', name: 'Waterfront Hall', icon: Building2 },
      { id: 'city_airport', name: 'City Airport', icon: Navigation },
      { id: 'black_mountain', name: 'Black Mountain', icon: Navigation },
      { id: 'cave_hill', name: 'Cave Hill', icon: Navigation },
      { id: 'lagan_towpath', name: 'Lagan Towpath', icon: MapPin },
    ],
    Dresden: [
      { id: 'altmarkt', name: 'Altmarkt', icon: ShoppingBag },
      { id: 'zwinger', name: 'Zwinger Palace', icon: Landmark },
      { id: 'semperoper', name: 'Semperoper', icon: Building2 },
      { id: 'frauenkirche', name: 'Frauenkirche', icon: Landmark },
    ],
    Hamburg: [
      { id: 'rathaus', name: 'City Hall', icon: Landmark },
      { id: 'hafen', name: 'Harbor', icon: ShoppingBag },
      { id: 'reeperbahn', name: 'Reeperbahn', icon: Coffee },
      { id: 'speicherstadt', name: 'Speicherstadt', icon: Building2 },
    ],
    Basel: [
      { id: 'marktplatz', name: 'Marktplatz', icon: ShoppingBag },
      { id: 'muenster', name: 'Basel Münster', icon: Landmark },
      { id: 'kunstmuseum', name: 'Art Museum', icon: Building2 },
      { id: 'rhein', name: 'Rhine River', icon: MapPin },
    ],
  };

  return destinations[cityId] || [
    { id: 'city_center', name: 'City Center', icon: MapPin },
    { id: 'shopping', name: 'Shopping District', icon: ShoppingBag },
    { id: 'historic', name: 'Historic Quarter', icon: Landmark },
  ];
};

// ---------- Firebase Auth Helper ----------

// Maps a Firebase User object to the app's internal user shape.
const mapFirebaseUser = (firebaseUser) => ({
  id: firebaseUser.uid,
  name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
  email: firebaseUser.email,
});

// ---------- Firestore Helpers ----------

// Reference to a user's document: users/{uid}
const userDocRef = (uid) => doc(db, 'users', uid);

// Create user document on first sign-up with default values
const createUserDoc = async (uid, name, email) => {
  await setDoc(userDocRef(uid), {
    name,
    email,
    isPremium: false,
    monthlySearches: 0,
    savedSpots: [],
    bookingHistory: [],
    userSubmissions: [],
    createdAt: new Date().toISOString(),
  });
};

// Load a user's data from Firestore once
const loadUserDoc = async (uid) => {
  const snap = await getDoc(userDocRef(uid));
  return snap.exists() ? snap.data() : null;
};

// Persist a single field to Firestore
const saveField = async (uid, field, value) => {
  try {
    await updateDoc(userDocRef(uid), { [field]: value });
  } catch {
    // Document may not exist yet (e.g. guest converting) — create it
    await setDoc(userDocRef(uid), { [field]: value }, { merge: true });
  }
};

// ---------- Auth Screen Components (defined outside App to avoid hooks-order errors) ----------

const LoginPageComponent = ({ onLogin, onGuest, onSwitchToSignup }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <View style={styles.authScreen}>
      <Text style={styles.authTitle}>Welcome back</Text>
      <View style={styles.authCard}>
        <TextInput
          style={styles.authInput}
          placeholder="Email address"
          placeholderTextColor="#6b7280"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.authInput}
          placeholder="Password"
          placeholderTextColor="#6b7280"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <PrimaryButton label="Sign in" onPress={() => onLogin(email, password)} />
        <TouchableOpacity style={{ marginTop: 12, alignSelf: 'center' }} onPress={onGuest}>
          <Text style={{ color: '#6b7280', fontSize: 14 }}>Continue as guest</Text>
        </TouchableOpacity>
        <Text style={styles.authSwitchText}>
          Don't have an account?{' '}
          <Text style={styles.authSwitchLink} onPress={onSwitchToSignup}>
            Sign up
          </Text>
        </Text>
      </View>
    </View>
  );
};

const SignupPageComponent = ({ onSignup, onGuest, onSwitchToLogin }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <View style={styles.authScreen}>
      <Text style={styles.authTitle}>Join ParkEasy</Text>
      <View style={styles.authCard}>
        <TextInput
          style={styles.authInput}
          placeholder="Full name"
          placeholderTextColor="#6b7280"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.authInput}
          placeholder="Email address"
          placeholderTextColor="#6b7280"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.authInput}
          placeholder="Create password"
          placeholderTextColor="#6b7280"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <PrimaryButton label="Create account" onPress={() => onSignup(name, email, password)} />
        <TouchableOpacity style={{ marginTop: 12, alignSelf: 'center' }} onPress={onGuest}>
          <Text style={{ color: '#6b7280', fontSize: 14 }}>Continue as guest</Text>
        </TouchableOpacity>
        <Text style={styles.authSwitchText}>
          Already have an account?{' '}
          <Text style={styles.authSwitchLink} onPress={onSwitchToLogin}>
            Sign in
          </Text>
        </Text>
      </View>
    </View>
  );
};

// ---------- Main App ----------

export default function App() {
  const [currentView, setCurrentView] = useState('landing');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true); // true until Firebase resolves auth on startup
  const [isPremium, setIsPremium] = useState(false); // Premium subscription status
  const [monthlySearches, setMonthlySearches] = useState(0); // Free tier: 10 searches/month
  const FREE_SEARCH_LIMIT = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showCitySelector, setShowCitySelector] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userSubmissions, setUserSubmissions] = useState([]);
  const [parkingSpots, setParkingSpots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [savedSpots, setSavedSpots] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [bookingHistory, setBookingHistory] = useState([]);
  const [reportedSpaces, setReportedSpaces] = useState([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [trialActive, setTrialActive] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState(7);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [parkingTimer, setParkingTimer] = useState(null); // { spotName, startTime, duration }
  const [timerRemaining, setTimerRemaining] = useState(null);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [numberPlate, setNumberPlate] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState({
    type: 'all',
    maxPrice: 5,
    evCharging: false,
    accessible: false,
    covered: false,
    free: false,
    sortBy: 'distance',
  });

  // ---------- Firebase Auth State Listener + Firestore Load ----------

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(mapFirebaseUser(firebaseUser));
        setCurrentView((prev) =>
          ['landing', 'login', 'signup'].includes(prev) ? 'search' : prev
        );
        // Load persisted user data from Firestore (inner async function avoids async callback)
        const loadData = async () => {
          const data = await loadUserDoc(firebaseUser.uid);
          if (data) {
            if (data.savedSpots) setSavedSpots(data.savedSpots);
            if (data.bookingHistory) setBookingHistory(data.bookingHistory);
            if (data.userSubmissions) setUserSubmissions(data.userSubmissions);
            if (typeof data.isPremium === 'boolean') setIsPremium(data.isPremium);
            if (typeof data.monthlySearches === 'number') setMonthlySearches(data.monthlySearches);
          }
          setAuthLoading(false);
        };
        loadData();
      } else {
        // If in guest mode (id === 0), preserve it; otherwise clear user and data
        setUser((prev) => (prev?.id === 0 ? prev : null));
        // Clear all persisted state on logout
        setSavedSpots([]);
        setBookingHistory([]);
        setUserSubmissions([]);
        setIsPremium(false);
        setMonthlySearches(0);
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // ---------- Location & Initial Setup ----------

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        // Auto-select nearest city
        findNearestCity(location.coords.latitude, location.coords.longitude);
      }
    } catch (error) {
      console.log('Location permission denied');
    }
  };

  const findNearestCity = (lat, lng) => {
    let nearest = AVAILABLE_CITIES[0];
    let minDistance = Infinity;
    
    AVAILABLE_CITIES.forEach(city => {
      const distance = calculateDistance(lat, lng, city.coords.lat, city.coords.lng);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = city;
      }
    });
    
    setSelectedCity(nearest);
    loadParkingForCity(nearest.id);
  };

  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const loadParkingForCity = async (cityId) => {
    setLoading(true);
    const data = await fetchParkingData(cityId);
    setParkingSpots(data);
    setLoading(false);
  };

  const handleCityChange = (city) => {
    setSelectedCity(city);
    setSelectedDestination(null);
    loadParkingForCity(city.id);
    setShowCitySelector(false);
  };

  // ---------- Search Limit (Free Tier) ----------

  const trackSearch = useCallback(() => {
    if (isPremium) return true;
    if (monthlySearches >= FREE_SEARCH_LIMIT) {
      Alert.alert(
        'Search Limit Reached',
        `You've used all ${FREE_SEARCH_LIMIT} free searches this month. Upgrade to Premium for unlimited searches!`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Upgrade Now', onPress: () => setShowPremiumModal(true) },
        ]
      );
      return false;
    }
    const newCount = monthlySearches + 1;
    setMonthlySearches(newCount);
    if (user?.id && user.id !== 0) saveField(user.id, 'monthlySearches', newCount);
    return true;
  }, [isPremium, monthlySearches, user]);

  // ---------- Premium Feature Check ----------

  const checkPremiumFeature = (featureName) => {
    if (!isPremium) {
      Alert.alert(
        'Premium Feature',
        `${featureName} is a premium feature. Upgrade to access unlimited searches, real-time availability, and more!`,
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Upgrade Now', onPress: () => setShowPremiumModal(true) },
        ]
      );
      return false;
    }
    return true;
  };

  // ---------- Firebase Auth Error Messages ----------

  const getAuthErrorMessage = (errorCode) => {
    switch (errorCode) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect email or password. Please try again.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Please sign in instead.';
      case 'auth/weak-password':
        return 'Password is too weak. Use at least 6 characters.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Please contact support.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a few minutes and try again.';
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection and try again.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled. Please contact support.';
      default:
        return 'Something went wrong. Please try again.';
    }
  };

  // ---------- Handlers ----------

  const handleLogin = async (email, password) => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged handles setUser and navigation automatically
    } catch (error) {
      Alert.alert('Sign In Failed', getAuthErrorMessage(error.code));
    }
  };

  const handleSignup = async (name, email, password) => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    if (!password || password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(credential.user, { displayName: name });
      }
      // Create Firestore document for this new user
      const displayName = name || email.split('@')[0];
      await createUserDoc(credential.user.uid, displayName, credential.user.email);
      // Set user immediately with the correct name so it shows right away
      setUser({
        id: credential.user.uid,
        name: displayName,
        email: credential.user.email,
      });
      setCurrentView('search');
    } catch (error) {
      Alert.alert('Sign Up Failed', getAuthErrorMessage(error.code));
    }
  };

  const handleGuestMode = () => {
    setUser({ id: 0, name: 'Guest', email: 'guest@parkeasy.app' });
    setCurrentView('search');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentView('landing');
      setMenuOpen(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to sign out. Please try again.');
    }
  };

  const handleDestinationSelect = (dest) => {
    setSelectedDestination(dest);
  };

  const handleSubmitReview = (spotId, rating, comment) => {
    console.log('Review submitted:', { spotId, rating, comment });
    setShowReviewForm(false);
    setSelectedSpot(null);
  };

  const handleSubmitSpot = (spotData) => {
    const newSubmission = {
      id: Date.now(),
      ...spotData,
      status: 'pending',
      submittedDate: new Date().toISOString(),
      pointsEarned: 10,
    };
    const updated = [...userSubmissions, newSubmission];
    setUserSubmissions(updated);
    if (user?.id && user.id !== 0) saveField(user.id, 'userSubmissions', updated);
    setShowSubmitForm(false);
  };

  const handleUpgradeToPremium = async (plan = 'annual') => {
    const success = await initiatePremiumUpgrade(plan, user?.email);
    
    if (success) {
      // Payment page opened successfully
      // Premium will be activated via Stripe webhook after payment
      setShowPremiumModal(false);
      
      // For demo/testing, you can manually activate premium:
      // Uncomment the line below to test premium features immediately
      // setIsPremium(true);
    }
  };

  // ---------- Save / Favourite ----------

  const toggleSaveSpot = (spot) => {
    setSavedSpots((prev) => {
      const exists = prev.find((s) => s.id === spot.id);
      if (exists) {
        const updated = prev.filter((s) => s.id !== spot.id);
        if (user?.id && user.id !== 0) saveField(user.id, 'savedSpots', updated);
        return updated;
      }
      if (!isPremium && prev.length >= 5) {
        Alert.alert(
          'Save Limit Reached',
          'Free users can save up to 5 spots. Upgrade to Premium for unlimited saves!',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Upgrade', onPress: () => setShowPremiumModal(true) },
          ]
        );
        return prev;
      }
      const updated = [...prev, spot];
      if (user?.id && user.id !== 0) saveField(user.id, 'savedSpots', updated);
      return updated;
    });
  };

  const isSpotSaved = (spotId) => savedSpots.some((s) => s.id === spotId);

  // ---------- Share Spot ----------

  const handleShareSpot = async (spot) => {
    try {
      await Share.share({
        title: `Check out ${spot.name} on ParkEasy!`,
        message: `I found parking at ${spot.name}, ${spot.address}. ${spot.pricing.free ? 'It\'s FREE!' : `Only \u00a3${spot.pricing.hourlyRate}/hr.`} ${spot.available} spaces available. Find it on ParkEasy!`,
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  };

  // ---------- Report a Space ----------

  const handleReportSpace = (type) => {
    const report = {
      id: Date.now(),
      type,
      timestamp: new Date(),
      location: userLocation,
      city: selectedCity?.name || 'Belfast',
    };
    setReportedSpaces([...reportedSpaces, report]);
    setShowReportModal(false);

    if (type === 'hidden_gem') {
      Alert.alert(
        'Hidden Gem Reported!',
        'Thanks for sharing! Your spot will be reviewed and added to the map. You\'ll earn 25 points and a free month of Premium when verified!',
        [{ text: 'Awesome!' }]
      );
    } else {
      Alert.alert(
        'Thanks!',
        type === 'leaving'
          ? 'Other drivers will be notified a space is available nearby.'
          : 'Thanks for letting the community know!',
        [{ text: 'OK' }]
      );
    }
  };

  // ---------- Book a Spot ----------

  const handleBookSpot = (spot) => {
    // Ask for number plate first
    Alert.prompt ? Alert.prompt(
      'Enter your reg plate',
      'We\'ll use this to register your parking',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Book', onPress: (plate) => confirmBooking(spot, plate || numberPlate) },
      ],
      'plain-text',
      numberPlate
    ) : confirmBooking(spot, numberPlate);
  };

  const confirmBooking = (spot, plate) => {
    if (plate) setNumberPlate(plate);
    hapticSuccess();
    const booking = {
      id: Date.now(),
      spotName: spot.name,
      address: spot.address,
      price: spot.pricing.free ? 'FREE' : `\u00a3${spot.pricing.hourlyRate}/hr`,
      date: new Date().toISOString(),
      duration: '2 hours',
      total: spot.pricing.free ? '\u00a30.00' : `\u00a3${(spot.pricing.hourlyRate * 2).toFixed(2)}`,
      status: 'confirmed',
      ref: `PE-${Date.now().toString().slice(-6)}`,
      numberPlate: plate || 'Not provided',
    };
    const updatedHistory = [booking, ...bookingHistory];
    setBookingHistory(updatedHistory);
    if (user?.id && user.id !== 0) saveField(user.id, 'bookingHistory', updatedHistory);
    setSelectedSpot(null);
    Alert.alert(
      'Booking Confirmed!',
      `${spot.name}\nRef: ${booking.ref}\n${plate ? `Reg: ${plate}\n` : ''}Total: ${booking.total}`,
      [
        { text: 'Start timer', onPress: () => startParkingTimer(spot.name, 2) },
        { text: 'View receipt', onPress: () => setCurrentView('history') },
        { text: 'OK' },
      ]
    );
  };

  // ---------- Free Trial ----------

  const startFreeTrial = () => {
    setTrialActive(true);
    setTrialDaysLeft(7);
    setIsPremium(true);
    if (user?.id && user.id !== 0) saveField(user.id, 'isPremium', true);
    setShowPremiumModal(false);
    Alert.alert(
      'Trial Started!',
      'You have 7 days of free Premium access. Enjoy unlimited searches!',
      [{ text: 'Let\'s go!' }]
    );
  };

  // ---------- Referral Code ----------

  const generateReferralCode = () => {
    const code = `PARK${user?.name?.toUpperCase().slice(0, 4) || 'USER'}${Math.floor(Math.random() * 999)}`;
    setReferralCode(code);
    return code;
  };

  const handleShareReferral = async () => {
    const code = referralCode || generateReferralCode();
    try {
      await Share.share({
        message: `Join ParkEasy and get a free month of Premium! Use my referral code: ${code} - Download at parkeasy.app`,
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  };

  // ---------- Get Directions ----------

  const handleGetDirections = (spot) => {
    const scheme = Platform.OS === 'ios' ? 'maps:' : 'geo:';
    const url = Platform.OS === 'ios'
      ? `maps:?daddr=${spot.coords.lat},${spot.coords.lng}`
      : `google.navigation:q=${spot.coords.lat},${spot.coords.lng}`;
    Linking.openURL(url).catch(() => {
      // Fallback to Google Maps web
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${spot.coords.lat},${spot.coords.lng}`);
    });
  };

  // ---------- Haptic Feedback ----------

  const hapticLight = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  };
  const hapticSuccess = () => {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
  };

  // ---------- Recently Viewed ----------

  const trackRecentlyViewed = (spot) => {
    setRecentlyViewed((prev) => {
      const filtered = prev.filter((s) => s.id !== spot.id);
      return [spot, ...filtered].slice(0, 5);
    });
  };

  // ---------- Availability Indicator ----------

  const getAvailabilityStatus = (spot) => {
    if (!spot.total || spot.total === 0) return { color: '#6b7280', label: 'Unknown', bg: 'rgba(107,114,128,0.15)' };
    const pct = spot.available / spot.total;
    if (pct > 0.3) return { color: '#22c55e', label: 'Available', bg: 'rgba(34,197,94,0.15)' };
    if (pct > 0.1) return { color: '#f59e0b', label: 'Filling up', bg: 'rgba(245,158,11,0.15)' };
    if (pct > 0) return { color: '#ef4444', label: 'Almost full', bg: 'rgba(239,68,68,0.15)' };
    return { color: '#ef4444', label: 'FULL', bg: 'rgba(239,68,68,0.25)' };
  };

  // ---------- Walk Time Estimate ----------

  const getWalkTime = (distanceKm) => {
    const minutes = Math.round(distanceKm * 12); // ~5km/h walking speed
    if (minutes < 1) return '< 1 min walk';
    return `${minutes} min walk`;
  };

  // ---------- Parking Timer ----------

  const startParkingTimer = (spotName, hours = 2) => {
    const start = new Date();
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setParkingTimer({ spotName, startTime: start, endTime: end, duration: hours });
    setTimerRemaining(hours * 60 * 60);
    hapticSuccess();
    Alert.alert('Timer Started', `${hours}hr timer set for ${spotName}. We'll remind you 15 min before!`);
  };

  // Timer countdown
  useEffect(() => {
    if (!parkingTimer) return;
    const interval = setInterval(() => {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((parkingTimer.endTime - now) / 1000));
      setTimerRemaining(remaining);
      // 15 minute warning
      if (remaining === 900) {
        Alert.alert('15 Minutes Left!', `Your parking at ${parkingTimer.spotName} expires in 15 minutes!`);
        hapticSuccess();
      }
      if (remaining <= 0) {
        Alert.alert('Time\'s Up!', `Your parking at ${parkingTimer.spotName} has expired. Move your car to avoid a fine!`);
        hapticSuccess();
        setParkingTimer(null);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [parkingTimer]);

  const formatTimer = (seconds) => {
    if (!seconds) return '0:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ---------- Pull to Refresh ----------

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    hapticLight();
    if (selectedCity) {
      await loadParkingForCity(selectedCity.id);
    }
    setRefreshing(false);
  }, [selectedCity]);

  // ---------- Price Comparison ----------

  const getCheapestNearby = useMemo(() => {
    const paid = parkingSpots.filter((s) => !s.pricing.free && s.pricing.hourlyRate > 0);
    if (paid.length === 0) return null;
    return paid.reduce((min, s) => s.pricing.hourlyRate < min.pricing.hourlyRate ? s : min, paid[0]);
  }, [parkingSpots]);

  // ---------- Search Suggestions ----------

  const SEARCH_KEYWORDS = [
    { label: 'Free parking', query: 'free', icon: CheckCircle },
    { label: 'EV charging', query: 'ev', icon: Zap },
    { label: 'City centre', query: 'city hall', icon: Landmark },
    { label: 'Multi-storey', query: 'multi', icon: Building2 },
    { label: 'Titanic Quarter', query: 'titanic', icon: Navigation },
    { label: 'Park & Ride', query: 'park & ride', icon: Car },
    { label: 'Cathedral Quarter', query: 'cathedral', icon: Coffee },
    { label: 'Victoria Square', query: 'victoria', icon: ShoppingBag },
    { label: 'Cheap parking', query: 'cheap', icon: PoundSterling },
    { label: 'Covered parking', query: 'covered', icon: Building2 },
    { label: 'Hidden gems', query: 'hidden gem', icon: Star },
    { label: 'Lay-bys', query: 'lay-by', icon: Car },
    { label: 'Street parking', query: 'street', icon: MapPin },
    { label: 'Black Mountain', query: 'black mountain', icon: Navigation },
    { label: 'Cave Hill', query: 'cave hill', icon: Navigation },
    { label: 'Lagan Towpath', query: 'lagan', icon: MapPin },
  ];

  // ---------- Belfast Points of Interest (for proximity search) ----------

  const BELFAST_PLACES = [
    // Shopping & Services
    { name: 'Victoria Square', type: 'shopping', coords: { lat: 54.5977, lng: -5.9283 } },
    { name: 'Castle Court', type: 'shopping', coords: { lat: 54.6005, lng: -5.9319 } },
    { name: 'City Hall', type: 'landmark', coords: { lat: 54.5966, lng: -5.9300 } },
    { name: 'Cathedral Quarter', type: 'entertainment', coords: { lat: 54.6017, lng: -5.9271 } },
    // Health & Beauty
    { name: 'Barbers (City Centre)', type: 'barbers', coords: { lat: 54.5990, lng: -5.9300 }, keywords: ['barber', 'barbers', 'haircut', 'hair'] },
    { name: 'Barbers (Lisburn Road)', type: 'barbers', coords: { lat: 54.5820, lng: -5.9470 }, keywords: ['barber', 'barbers', 'haircut', 'hair'] },
    { name: 'Barbers (Botanic)', type: 'barbers', coords: { lat: 54.5850, lng: -5.9340 }, keywords: ['barber', 'barbers', 'haircut', 'hair'] },
    { name: 'Barbers (Ormeau Road)', type: 'barbers', coords: { lat: 54.5880, lng: -5.9210 }, keywords: ['barber', 'barbers', 'haircut', 'hair'] },
    // Outdoors
    { name: 'Black Mountain', type: 'outdoor', coords: { lat: 54.6050, lng: -5.9900 }, keywords: ['black mountain', 'divis', 'hike', 'walking', 'hill'] },
    { name: 'Cave Hill', type: 'outdoor', coords: { lat: 54.6350, lng: -5.9430 }, keywords: ['cave hill', 'napoleons nose', 'belfast castle', 'hike'] },
    { name: 'Colin Glen', type: 'outdoor', coords: { lat: 54.5650, lng: -6.0100 }, keywords: ['colin glen', 'forest', 'gruffalo', 'zipline'] },
    { name: 'Botanic Gardens', type: 'park', coords: { lat: 54.5834, lng: -5.9310 }, keywords: ['botanic', 'gardens', 'park', 'ulster museum'] },
    { name: 'Ormeau Park', type: 'park', coords: { lat: 54.5860, lng: -5.9180 }, keywords: ['ormeau', 'park'] },
    { name: 'Lagan Towpath', type: 'outdoor', coords: { lat: 54.5690, lng: -5.9320 }, keywords: ['lagan', 'towpath', 'river', 'walk', 'cycle'] },
    { name: 'Shaw\'s Bridge', type: 'outdoor', coords: { lat: 54.5560, lng: -5.9440 }, keywords: ['shaws bridge', 'lagan', 'walk'] },
    // Restaurants & Entertainment
    { name: 'Botanic Avenue', type: 'restaurant', coords: { lat: 54.5850, lng: -5.9330 }, keywords: ['restaurant', 'food', 'eating', 'botanic'] },
    { name: 'Lisburn Road Restaurants', type: 'restaurant', coords: { lat: 54.5820, lng: -5.9470 }, keywords: ['restaurant', 'food', 'lisburn road'] },
    { name: 'SSE Arena', type: 'entertainment', coords: { lat: 54.6048, lng: -5.9186 }, keywords: ['sse', 'arena', 'concert', 'gig', 'odyssey'] },
    { name: 'Waterfront Hall', type: 'entertainment', coords: { lat: 54.5940, lng: -5.9205 }, keywords: ['waterfront', 'concert', 'show'] },
    // Hospitals
    { name: 'Royal Victoria Hospital', type: 'hospital', coords: { lat: 54.5945, lng: -5.9515 }, keywords: ['royal', 'hospital', 'rvh', 'doctor'] },
    { name: 'Belfast City Hospital', type: 'hospital', coords: { lat: 54.5850, lng: -5.9370 }, keywords: ['city hospital', 'bch', 'hospital', 'doctor'] },
    // Transport
    { name: 'Belfast City Airport', type: 'transport', coords: { lat: 54.6181, lng: -5.8719 }, keywords: ['airport', 'city airport', 'george best', 'flight'] },
    { name: 'Lanyon Place Station', type: 'transport', coords: { lat: 54.5953, lng: -5.9210 }, keywords: ['train', 'station', 'lanyon', 'central'] },
    // Universities
    { name: 'Queens University', type: 'education', coords: { lat: 54.5844, lng: -5.9342 }, keywords: ['queens', 'university', 'qub', 'college'] },
    { name: 'Ulster University Belfast', type: 'education', coords: { lat: 54.6010, lng: -5.9290 }, keywords: ['ulster', 'university', 'uu', 'college'] },
  ];

  const findNearbyParking = useCallback((searchTerm) => {
    const q = searchTerm.toLowerCase().trim();
    const matchedPlace = BELFAST_PLACES.find(place =>
      place.name.toLowerCase().includes(q) ||
      (place.keywords && place.keywords.some(kw => q.includes(kw) || kw.includes(q)))
    );
    return matchedPlace || null;
  }, []);

  const searchSuggestions = useMemo(() => {
    if (!searchQuery || searchQuery.length < 1) return SEARCH_KEYWORDS.slice(0, 6);
    const q = searchQuery.toLowerCase();
    return SEARCH_KEYWORDS.filter(
      (kw) =>
        kw.label.toLowerCase().includes(q) ||
        kw.query.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const typeColor = (type) => {
    if (type === 'multi_story_garage') return { backgroundColor: '#dbeafe' };
    if (type === 'surface_lot') return { backgroundColor: '#fef3c7' };
    if (type === 'street_parking') return { backgroundColor: '#d1fae5' };
    if (type === 'lay_by') return { backgroundColor: '#ede9fe' };
    if (type === 'underground') return { backgroundColor: '#e0e7ff' };
    return { backgroundColor: '#e5e7eb' };
  };

  // ---------- Filtering logic ----------

  const proximityMatch = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    return findNearbyParking(searchQuery);
  }, [searchQuery, findNearbyParking]);

  const getDistanceFromPlace = useCallback((spot, place) => {
    if (!spot.coords || !place.coords) return Infinity;
    return calculateDistance(spot.coords.lat, spot.coords.lng, place.coords.lat, place.coords.lng);
  }, []);

  const filteredSpots = useMemo(() => {
    // Free users get limited results
    const spots = isPremium ? parkingSpots : parkingSpots.slice(0, 3);
    const q = searchQuery.toLowerCase().trim();

    let results = spots
      .filter((spot) => {
        if (selectedDestination) {
          const destId = selectedDestination.id.toLowerCase();
          const destName = selectedDestination.name.toLowerCase();
          const matchesDest = spot.nearDestinations?.some(d => {
            const dl = d.toLowerCase();
            return dl === destId || dl === destName || destId.includes(dl.replace(/\s+/g, '_')) || dl.includes(destId.replace(/_/g, ' '));
          });
          if (!matchesDest) return false;
        }
        if (q) {
          // Proximity match — if user searched for a place (e.g. "barbers"), show parking near it
          if (proximityMatch) {
            const distToPlace = getDistanceFromPlace(spot, proximityMatch);
            if (distToPlace <= 2.0) return true; // within 2km
          }

          // Keyword-based smart matching
          const matchesName = spot.name.toLowerCase().includes(q);
          const matchesAddress = spot.address.toLowerCase().includes(q);
          const matchesDesc = spot.description?.toLowerCase().includes(q);
          const matchesFree = (q === 'free' || q === 'free parking') && spot.pricing.free;
          const matchesCheap = (q === 'cheap' || q === 'cheap parking' || q === 'budget') && spot.pricing.hourlyRate <= 1.5;
          const matchesEv = (q === 'ev' || q === 'ev charging' || q === 'electric') && spot.evCharging.available;
          const matchesCovered = (q === 'covered' || q === 'indoor') && spot.features.covered;
          const matchesMulti = (q === 'multi' || q === 'multi-storey' || q === 'garage') && spot.type === 'multi_story_garage';
          const matchesNear = spot.nearDestinations?.some(d => d.toLowerCase().includes(q));
          const matchesHiddenGem = (q === 'hidden gem' || q === 'hidden gems' || q === 'gem') && spot.hiddenGem;
          const matchesLayBy = (q === 'lay-by' || q === 'lay by' || q === 'layby') && spot.type === 'lay_by';
          const matchesStreet = (q === 'street' || q === 'street parking' || q === 'on-street') && spot.type === 'street_parking';

          if (!matchesName && !matchesAddress && !matchesDesc && !matchesFree &&
              !matchesCheap && !matchesEv && !matchesCovered && !matchesMulti && !matchesNear &&
              !matchesHiddenGem && !matchesLayBy && !matchesStreet) {
            return false;
          }
        }
        if (filters.type !== 'all' && spot.type !== filters.type) return false;
        if (filters.free && !spot.pricing.free) return false;
        if (filters.evCharging && !spot.evCharging.available) return false;
        if (filters.accessible && !spot.features.accessible) return false;
        if (filters.covered && !spot.features.covered) return false;
        if (spot.pricing.hourlyRate > filters.maxPrice) return false;
        return true;
      })
      .sort((a, b) => {
        // If proximity search, sort by distance to the searched place
        if (proximityMatch) {
          const distA = getDistanceFromPlace(a, proximityMatch);
          const distB = getDistanceFromPlace(b, proximityMatch);
          return distA - distB;
        }
        if (filters.sortBy === 'rating') return b.rating - a.rating;
        if (filters.sortBy === 'price') return a.pricing.hourlyRate - b.pricing.hourlyRate;
        return a.distance - b.distance;
      });

    return results;
  }, [filters, searchQuery, selectedDestination, parkingSpots, isPremium, proximityMatch, getDistanceFromPlace]);

  const destinations = selectedCity ? getDestinationsForCity(selectedCity.id) : [];

  // ---------- Screens ----------

  const LandingPage = () => (
    <View style={styles.fullScreenCenter}>
      <Text style={styles.landingTitle}>
        Park<Text style={styles.logoAccent}>Easy</Text>
      </Text>
      <Text style={styles.landingSubtitle}>Find Parking in Seconds</Text>
      <Text style={styles.landingDescription}>
        Search for any destination and instantly find nearby parking —
        car parks, free street spots, hidden gems, and lay-bys.
        Book, pay, and go.
      </Text>
      <View style={styles.landingButtonsRow}>
        <PrimaryButton label="Get Started" onPress={() => setCurrentView('login')} />
        <SecondaryButton label="Sign Up Free" onPress={() => setCurrentView('signup')} />
      </View>
      <TouchableOpacity style={{ marginTop: 12 }} onPress={handleGuestMode}>
        <Text style={{ color: '#6b7280', fontSize: 14 }}>Continue as guest</Text>
      </TouchableOpacity>
      <View style={styles.landingFeatureRow}>
        <FeaturePill icon={MapPin} label="Free spots" />
        <FeaturePill icon={Navigation} label="Proximity search" />
        <FeaturePill icon={Star} label="Hidden gems" />
        <FeaturePill icon={Car} label="Book & pay" />
      </View>
    </View>
  );

  const LoginPage = () => (
    <LoginPageComponent
      onLogin={handleLogin}
      onGuest={handleGuestMode}
      onSwitchToSignup={() => setCurrentView('signup')}
    />
  );

  const SignupPage = () => (
    <SignupPageComponent
      onSignup={handleSignup}
      onGuest={handleGuestMode}
      onSwitchToLogin={() => setCurrentView('login')}
    />
  );

  const SearchPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.logoText}>
          Park<Text style={styles.logoAccent}>Easy</Text>
        </Text>
        <View style={styles.headerRight}>
          {!isPremium && (
            <TouchableOpacity 
              style={styles.premiumButton} 
              onPress={() => setShowPremiumModal(true)}
            >
              <Crown size={14} color="#eab308" />
              <Text style={styles.premiumButtonText}>Upgrade</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitSpotButton} onPress={() => setShowSubmitForm(true)}>
            <Plus size={16} color="#eab308" />
            <Text style={styles.submitSpotText}>Submit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.savedButton}
            onPress={() => {
              setCurrentView('saved');
              setMenuOpen(false);
            }}
          >
            <Heart size={16} color="#f472b6" fill={savedSpots.length > 0 ? '#f472b6' : 'transparent'} />
            {savedSpots.length > 0 && (
              <View style={styles.savedBadge}>
                <Text style={styles.savedBadgeText}>{savedSpots.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(!menuOpen)}>
            <Menu size={20} color="#e5e7eb" />
          </TouchableOpacity>
        </View>
      </View>

      {menuOpen && (
        <View style={styles.menuSheet}>
          <View style={styles.menuUserRow}>
            <User size={20} color="#e5e7eb" />
            <View>
              <Text style={styles.menuUserName}>{user?.name}</Text>
              <Text style={styles.menuPoints}>
                {isPremium ? 'Premium Member' : 'Free Account'} • {userSubmissions.length * 10} points
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setCurrentView('submissions');
              setMenuOpen(false);
            }}
          >
            <Award size={18} color="#eab308" />
            <Text style={styles.menuItemText}>My submissions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setCurrentView('history');
              setMenuOpen(false);
            }}
          >
            <Clock size={18} color="#a5b4fc" />
            <Text style={styles.menuItemText}>Booking history</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowReportModal(true);
              setMenuOpen(false);
            }}
          >
            <Navigation size={18} color="#22c55e" />
            <Text style={styles.menuItemText}>Report a space</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              handleShareReferral();
              setMenuOpen(false);
            }}
          >
            <Star size={18} color="#f472b6" />
            <Text style={styles.menuItemText}>Invite friends</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <LogOut size={18} color="#fca5a5" />
            <Text style={[styles.menuItemText, { color: '#fecaca' }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.searchScroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" colors={['#6366f1']} />}
      >
        {/* Active Timer Banner */}
        {parkingTimer && (
          <TouchableOpacity style={styles.timerBanner} onPress={() => setShowTimerModal(true)}>
            <Timer size={18} color="#f9fafb" />
            <View style={{ flex: 1 }}>
              <Text style={styles.timerBannerTitle}>{parkingTimer.spotName}</Text>
              <Text style={styles.timerBannerTime}>{formatTimer(timerRemaining)}</Text>
            </View>
            <Text style={styles.timerBannerLabel}>TAP</Text>
          </TouchableOpacity>
        )}

        {/* City Selector */}
        <View style={styles.cityRow}>
          <MapPin size={18} color="#9ca3af" />
          <TouchableOpacity onPress={() => setShowCitySelector(true)}>
            <Text style={styles.cityText}>
              {selectedCity ? `${selectedCity.name}, ${selectedCity.country}` : 'Select city'}
            </Text>
          </TouchableOpacity>
          <Globe size={16} color="#6b7280" />
        </View>

        <Text style={styles.sectionTitle}>Find parking near…</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 12 }}
        >
          {destinations.map((dest) => {
            const Icon = dest.icon;
            const active = selectedDestination?.id === dest.id;
            return (
              <TouchableOpacity
                key={dest.id}
                style={[
                  styles.destChip,
                  active && styles.destChipActive,
                ]}
                onPress={() =>
                  handleDestinationSelect(
                    active ? null : { id: dest.id, name: dest.name }
                  )
                }
              >
                <Icon size={18} color={active ? '#4f46e5' : '#e5e7eb'} />
                <Text
                  style={[
                    styles.destChipText,
                    active && styles.destChipTextActive,
                  ]}
                >
                  {dest.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.searchBar}>
          <Search size={18} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search parking locations..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(''); setShowSuggestions(false); }} style={{ paddingHorizontal: 4 }}>
              <X size={16} color="#9ca3af" />
            </Pressable>
          )}
          <Pressable onPress={() => setShowFilters(!showFilters)} style={styles.filterIcon}>
            <Filter size={18} color="#e5e7eb" />
          </Pressable>
        </View>

        {showSuggestions && searchSuggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <Text style={styles.suggestionsTitle}>
              {searchQuery.length > 0 ? 'Suggestions' : 'Quick search'}
            </Text>
            <View style={styles.suggestionsRow}>
              {searchSuggestions.map((item) => {
                const Icon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.label}
                    style={styles.suggestionChip}
                    onPress={() => {
                      if (!trackSearch()) return;
                      setSearchQuery(item.query);
                      setShowSuggestions(false);
                    }}
                  >
                    <Icon size={14} color="#a5b4fc" />
                    <Text style={styles.suggestionText}>{item.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {showFilters && (
          <View style={styles.filtersCard}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Type</Text>
              <FilterChip
                label="All"
                active={filters.type === 'all'}
                onPress={() => setFilters({ ...filters, type: 'all' })}
              />
              <FilterChip
                label="Multi-story"
                active={filters.type === 'multi_story_garage'}
                onPress={() => setFilters({ ...filters, type: 'multi_story_garage' })}
              />
              <FilterChip
                label="Surface"
                active={filters.type === 'surface_lot'}
                onPress={() => setFilters({ ...filters, type: 'surface_lot' })}
              />
              <FilterChip
                label="Street"
                active={filters.type === 'street_parking'}
                onPress={() => setFilters({ ...filters, type: 'street_parking' })}
              />
              <FilterChip
                label="Lay-by"
                active={filters.type === 'lay_by'}
                onPress={() => setFilters({ ...filters, type: 'lay_by' })}
              />
            </View>

            <View style={styles.toggleRow}>
              <TogglePill
                label="EV charging"
                icon={Zap}
                active={filters.evCharging}
                onPress={() => setFilters({ ...filters, evCharging: !filters.evCharging })}
              />
              <TogglePill
                label="Accessible"
                icon={Accessibility}
                active={filters.accessible}
                onPress={() => setFilters({ ...filters, accessible: !filters.accessible })}
              />
              <TogglePill
                label="Covered"
                icon={Building2}
                active={filters.covered}
                onPress={() => setFilters({ ...filters, covered: !filters.covered })}
              />
              <TogglePill
                label="Free only"
                icon={CheckCircle}
                active={filters.free}
                onPress={() => setFilters({ ...filters, free: !filters.free })}
              />
            </View>

            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Sort by</Text>
              <FilterChip label="Nearest" active={filters.sortBy === 'distance'} onPress={() => setFilters({ ...filters, sortBy: 'distance' })} />
              <FilterChip label="Cheapest" active={filters.sortBy === 'price'} onPress={() => setFilters({ ...filters, sortBy: 'price' })} />
              <FilterChip label="Top rated" active={filters.sortBy === 'rating'} onPress={() => setFilters({ ...filters, sortBy: 'rating' })} />
            </View>
          </View>
        )}

        {loading ? (
          <Text style={styles.loadingText}>Loading parking data...</Text>
        ) : (
          <>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>
                {filteredSpots.length} spot{filteredSpots.length !== 1 ? 's' : ''}{' '}
                {selectedCity ? `in ${selectedCity.name}` : ''}
              </Text>
              {!isPremium && parkingSpots.length > 3 && (
                <Text style={styles.limitText}>
                  Showing 3 of {parkingSpots.length} • Upgrade for all
                </Text>
              )}
              {!isPremium && (
                <Text style={styles.limitText}>
                  {FREE_SEARCH_LIMIT - monthlySearches} searches left this month
                </Text>
              )}
            </View>

            <View style={{ gap: 10, marginBottom: 40 }}>
              {/* Proximity search indicator */}
              {proximityMatch && searchQuery.length > 0 && (
                <View style={styles.proximityTip}>
                  <Navigation size={14} color="#a5b4fc" />
                  <Text style={styles.proximityTipText}>
                    Showing parking near <Text style={{ fontWeight: '700', color: '#e5e7eb' }}>{proximityMatch.name}</Text>
                  </Text>
                </View>
              )}

              {/* Cheapest nearby tip */}
              {getCheapestNearby && !filters.free && (
                <View style={styles.cheapestTip}>
                  <PoundSterling size={14} color="#22c55e" />
                  <Text style={styles.cheapestTipText}>
                    Cheapest nearby: {getCheapestNearby.name} ({'\u00a3'}{getCheapestNearby.pricing.hourlyRate}/hr)
                  </Text>
                </View>
              )}

              {/* Recently Viewed */}
              {recentlyViewed.length > 0 && !searchQuery && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[styles.filterLabel, { marginBottom: 6 }]}>Recently viewed</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {recentlyViewed.map((rv) => (
                      <TouchableOpacity key={rv.id} style={styles.recentChip} onPress={() => { setSelectedSpot(rv); trackRecentlyViewed(rv); }}>
                        <History size={12} color="#9ca3af" />
                        <Text style={styles.recentChipText}>{rv.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {filteredSpots.map((spot) => {
                const avail = getAvailabilityStatus(spot);
                return (
                <TouchableOpacity
                  key={spot.id}
                  style={styles.card}
                  onPress={() => {
                    hapticLight();
                    if (isPremium || filteredSpots.indexOf(spot) < 3) {
                      setSelectedSpot(spot);
                      trackRecentlyViewed(spot);
                    } else {
                      checkPremiumFeature('Full spot details');
                    }
                  }}
                >
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardTitle}>{spot.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation && e.stopPropagation();
                          hapticLight();
                          toggleSaveSpot(spot);
                        }}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Heart
                          size={18}
                          color="#f472b6"
                          fill={isSpotSaved(spot.id) ? '#f472b6' : 'transparent'}
                        />
                      </TouchableOpacity>
                      <View style={[styles.typeBadge, typeColor(spot.type)]}>
                        <Building2 size={12} color="#111827" />
                        <Text style={styles.typeBadgeText}>
                          {spot.type.replace(/_/g, ' ')}
                        </Text>
                      </View>
                      {spot.hiddenGem && (
                        <View style={styles.hiddenGemBadge}>
                          <Star size={10} color="#eab308" fill="#eab308" />
                          <Text style={styles.hiddenGemText}>Gem</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  <View style={styles.addressRow}>
                    <MapPin size={14} color="#9ca3af" />
                    <Text style={styles.addressText} numberOfLines={1}>{spot.address}</Text>
                  </View>

                  {/* Availability indicator + walk time */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <View style={[styles.availBadge, { backgroundColor: avail.bg }]}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: avail.color }} />
                      <Text style={[styles.availText, { color: avail.color }]}>{avail.label}</Text>
                    </View>
                    {spot.distance > 0 && (
                      <View style={styles.walkBadge}>
                        <Navigation size={10} color="#9ca3af" />
                        <Text style={styles.walkText}>{getWalkTime(spot.distance)}</Text>
                      </View>
                    )}
                    {spot.hours && (
                      <View style={styles.walkBadge}>
                        <Clock size={10} color="#9ca3af" />
                        <Text style={styles.walkText}>{spot.hours.open === '24hrs' ? '24hrs' : `${spot.hours.open}-${spot.hours.close}`}</Text>
                      </View>
                    )}
                    {proximityMatch && (
                      <View style={styles.walkBadge}>
                        <MapPin size={10} color="#a5b4fc" />
                        <Text style={[styles.walkText, { color: '#a5b4fc' }]}>
                          {(getDistanceFromPlace(spot, proximityMatch) * 1000).toFixed(0)}m away
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                      <Star size={14} color="#facc15" />
                      <Text style={styles.statText}>{spot.rating}</Text>
                    </View>
                    <View style={styles.statItem}>
                      <Car size={14} color={avail.color} />
                      <Text style={[styles.statText, { color: avail.color }]}>
                        {spot.available}/{spot.total}
                      </Text>
                    </View>
                    {spot.pricing.free ? (
                      <View style={[styles.badge, styles.badgeFree]}>
                        <Text style={styles.badgeText}>FREE</Text>
                      </View>
                    ) : (
                      <View style={styles.statItem}>
                        <PoundSterling size={14} color="#22c55e" />
                        <Text style={styles.priceText}>£{spot.pricing.hourlyRate}/hr</Text>
                      </View>
                    )}
                  </View>
                  {/* EV badge on card */}
                  {spot.evCharging.available && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                      <Zap size={12} color="#eab308" />
                      <Text style={{ color: '#eab308', fontSize: 11 }}>{spot.evCharging.ports} EV ports ({spot.evCharging.speed})</Text>
                    </View>
                  )}
                </TouchableOpacity>
                );
              })}

              {!isPremium && parkingSpots.length > 3 && (
                <TouchableOpacity 
                  style={styles.upgradeCard}
                  onPress={() => setShowPremiumModal(true)}
                >
                  <Crown size={32} color="#eab308" />
                  <Text style={styles.upgradeCardTitle}>Unlock {parkingSpots.length - 3} more spots</Text>
                  <Text style={styles.upgradeCardText}>
                    Upgrade to Premium for unlimited access
                  </Text>
                  <View style={styles.upgradeButton}>
                    <Text style={styles.upgradeButtonText}>View Plans</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* City Selector Modal */}
      <Modal visible={showCitySelector} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowCitySelector(false)}>
              <X size={20} color="#e5e7eb" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select City</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {AVAILABLE_CITIES.map((city) => (
                <TouchableOpacity
                  key={city.id}
                  style={styles.cityOption}
                  onPress={() => handleCityChange(city)}
                >
                  <Globe size={18} color="#9ca3af" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cityOptionName}>{city.name}</Text>
                    <Text style={styles.cityOptionCountry}>{city.country}</Text>
                  </View>
                  {selectedCity?.id === city.id && (
                    <CheckCircle size={18} color="#22c55e" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Premium Upgrade Modal */}
      <PremiumModal
        visible={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        onUpgrade={handleUpgradeToPremium}
        onStartTrial={startFreeTrial}
        trialActive={trialActive}
      />

      <SpotDetailsModal
        spot={selectedSpot}
        visible={!!selectedSpot}
        onClose={() => setSelectedSpot(null)}
        onReview={() => setShowReviewForm(true)}
        onSave={toggleSaveSpot}
        isSaved={selectedSpot ? isSpotSaved(selectedSpot.id) : false}
        onShare={handleShareSpot}
        onBook={handleBookSpot}
        onDirections={handleGetDirections}
      />

      {selectedSpot && (
        <ReviewForm
          visible={showReviewForm}
          spot={selectedSpot}
          onClose={() => setShowReviewForm(false)}
          onSubmit={handleSubmitReview}
        />
      )}

      <SubmitSpotForm
        visible={showSubmitForm}
        onClose={() => setShowSubmitForm(false)}
        onSubmit={handleSubmitSpot}
        destinations={destinations}
        cityName={selectedCity?.name}
      />

      {/* Floating Action Button - Report a Space */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => { hapticLight(); setShowReportModal(true); }}
      >
        <Navigation size={22} color="#f9fafb" />
      </TouchableOpacity>
    </View>
  );

  const SubmissionsPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setCurrentView('search')}
        >
          <Text style={{ color: '#e5e7eb' }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.logoText}>My submissions</Text>
      </View>

      <ScrollView contentContainerStyle={styles.searchScroll}>
        <View style={styles.pointsCard}>
          <Award size={28} color="#eab308" />
          <View>
            <Text style={styles.pointsLabel}>Total points</Text>
            <Text style={styles.pointsValue}>{userSubmissions.length * 10}</Text>
          </View>
        </View>

        {userSubmissions.length === 0 ? (
          <View style={styles.emptyState}>
            <MapPin size={48} color="#4b5563" />
            <Text style={styles.emptyTitle}>No submissions yet</Text>
            <Text style={styles.emptyText}>
              Submit parking spots around your city and earn points for helping the community.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {userSubmissions.map((sub) => (
              <View key={sub.id} style={styles.submissionCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{sub.name}</Text>
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>{sub.status}</Text>
                  </View>
                </View>
                <Text style={styles.addressText}>{sub.address}</Text>
                <View style={styles.statsRow}>
                  <Text style={styles.subMeta}>
                    {sub.submittedDate.toLocaleDateString()}
                  </Text>
                  <Text style={styles.subMeta}>{sub.pointsEarned} pts</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  const SavedSpotsPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setCurrentView('search')}
        >
          <Text style={{ color: '#e5e7eb' }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.logoText}>Saved Spots</Text>
        <Heart size={20} color="#f472b6" fill="#f472b6" />
      </View>

      <ScrollView contentContainerStyle={styles.searchScroll}>
        {savedSpots.length === 0 ? (
          <View style={styles.emptyState}>
            <Heart size={48} color="#4b5563" />
            <Text style={styles.emptyTitle}>No saved spots yet</Text>
            <Text style={styles.emptyText}>
              Tap the heart icon on any parking spot to save it here for quick access.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 20 }]}
              onPress={() => setCurrentView('search')}
            >
              <Text style={styles.primaryButtonText}>Find parking</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={styles.resultsTitle}>
              {savedSpots.length} saved spot{savedSpots.length !== 1 ? 's' : ''}
            </Text>
            {savedSpots.map((spot) => (
              <TouchableOpacity
                key={spot.id}
                style={styles.card}
                onPress={() => {
                  setSelectedSpot(spot);
                  setCurrentView('search');
                }}
              >
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{spot.name}</Text>
                  <TouchableOpacity onPress={() => toggleSaveSpot(spot)}>
                    <Heart size={18} color="#f472b6" fill="#f472b6" />
                  </TouchableOpacity>
                </View>
                <View style={styles.addressRow}>
                  <MapPin size={14} color="#9ca3af" />
                  <Text style={styles.addressText}>{spot.address}</Text>
                </View>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Star size={14} color="#facc15" />
                    <Text style={styles.statText}>{spot.rating}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Clock size={14} color="#9ca3af" />
                    <Text style={styles.statText}>
                      {spot.available}/{spot.total} available
                    </Text>
                  </View>
                  {spot.pricing.free ? (
                    <View style={[styles.badge, styles.badgeFree]}>
                      <Text style={styles.badgeText}>FREE</Text>
                    </View>
                  ) : (
                    <View style={styles.statItem}>
                      <PoundSterling size={14} color="#22c55e" />
                      <Text style={styles.priceText}>£{spot.pricing.hourlyRate}/hr</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  // ---------- Booking History Page ----------

  const HistoryPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => setCurrentView('search')}>
          <Text style={{ color: '#e5e7eb' }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.logoText}>Booking History</Text>
        <Clock size={20} color="#a5b4fc" />
      </View>
      <ScrollView contentContainerStyle={styles.searchScroll}>
        {bookingHistory.length === 0 ? (
          <View style={styles.emptyState}>
            <Clock size={48} color="#4b5563" />
            <Text style={styles.emptyTitle}>No bookings yet</Text>
            <Text style={styles.emptyText}>
              Book a parking spot and your receipt will appear here.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {bookingHistory.map((b) => (
              <View key={b.id} style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{b.spotName}</Text>
                  <View style={[styles.badge, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                    <Text style={[styles.badgeText, { color: '#22c55e' }]}>{b.status}</Text>
                  </View>
                </View>
                <View style={styles.addressRow}>
                  <MapPin size={14} color="#9ca3af" />
                  <Text style={styles.addressText}>{b.address}</Text>
                </View>
                <View style={styles.receiptBox}>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Ref</Text>
                    <Text style={styles.receiptValue}>{b.ref}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Date</Text>
                    <Text style={styles.receiptValue}>{b.date.toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Duration</Text>
                    <Text style={styles.receiptValue}>{b.duration}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>Rate</Text>
                    <Text style={styles.receiptValue}>{b.price}</Text>
                  </View>
                  <View style={[styles.receiptRow, { borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 8, marginTop: 4 }]}>
                    <Text style={[styles.receiptLabel, { fontWeight: '700', color: '#e5e7eb' }]}>Total</Text>
                    <Text style={[styles.receiptValue, { fontWeight: '700', color: '#22c55e', fontSize: 16 }]}>{b.total}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  // ---------- Onboarding ----------

  const OnboardingScreen = () => {
    const steps = [
      { title: 'Welcome to ParkEasy', desc: 'Find parking anywhere in seconds. Search for a destination — a barbers, restaurant, or Black Mountain — and we\'ll show you the closest parking spots, including free ones.', icon: Car },
      { title: 'Search Any Destination', desc: 'Type where you\'re going and find nearby car parks, free street parking, lay-bys, and hidden gems. Filter by price, distance, type, and more.', icon: Search },
      { title: 'Hidden Gems & Free Spots', desc: 'Discover free parking that locals know about — lay-bys, quiet streets, and community-reported hidden gems. Report your own and earn free Premium!', icon: Star },
      { title: 'Book, Pay & Go', desc: 'Book spots, get directions via Google Maps, set parking timers, and keep receipts. Upgrade to Premium for unlimited access across 30+ cities.', icon: Navigation },
    ];
    const step = steps[onboardingStep];
    const StepIcon = step.icon;
    return (
      <View style={styles.fullScreenCenter}>
        <StepIcon size={64} color="#6366f1" />
        <Text style={[styles.landingTitle, { fontSize: 28, marginTop: 20, textAlign: 'center' }]}>{step.title}</Text>
        <Text style={[styles.landingDescription, { marginTop: 12, fontSize: 15 }]}>{step.desc}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
          {steps.map((_, i) => (
            <View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === onboardingStep ? '#6366f1' : '#374151' }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
          {onboardingStep > 0 && (
            <SecondaryButton label="Back" onPress={() => setOnboardingStep(onboardingStep - 1)} />
          )}
          {onboardingStep < steps.length - 1 ? (
            <PrimaryButton label="Next" onPress={() => setOnboardingStep(onboardingStep + 1)} />
          ) : (
            <PrimaryButton label="Get Started" onPress={() => { setShowOnboarding(false); setCurrentView('landing'); }} />
          )}
        </View>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => { setShowOnboarding(false); setCurrentView('landing'); }}>
          <Text style={{ color: '#6b7280', fontSize: 13 }}>Skip</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ---------- Root switch ----------

  const renderScreen = () => {
    // Show a brief splash while Firebase restores auth state on startup.
    // Prevents logged-in users from briefly seeing the landing page.
    if (authLoading) {
      return (
        <View style={styles.fullScreenCenter}>
          <Text style={styles.landingTitle}>
            Park<Text style={styles.logoAccent}>Easy</Text>
          </Text>
          <Text style={{ color: '#6b7280', marginTop: 16, fontSize: 15 }}>Loading...</Text>
        </View>
      );
    }
    if (showOnboarding && currentView === 'landing') return OnboardingScreen();
    if (currentView === 'login') return LoginPage();
    if (currentView === 'signup') return SignupPage();
    if (currentView === 'search') return SearchPage();
    if (currentView === 'submissions') return SubmissionsPage();
    if (currentView === 'saved') return SavedSpotsPage();
    if (currentView === 'history') return HistoryPage();
    return LandingPage();
  };

  return (
    <SafeAreaView style={styles.appRoot}>
      {renderScreen()}

      {/* Report a Space Modal */}
      <Modal visible={showReportModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowReportModal(false)}>
              <X size={20} color="#e5e7eb" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Report a Space</Text>
            <Text style={styles.modalSubTitle}>Help other drivers find parking!</Text>
            <View style={{ gap: 10, marginTop: 8 }}>
              <TouchableOpacity style={styles.reportOption} onPress={() => handleReportSpace('leaving')}>
                <Car size={24} color="#22c55e" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>I'm leaving a spot</Text>
                  <Text style={styles.reportOptionDesc}>Let others know a space is about to free up</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reportOption} onPress={() => handleReportSpace('found')}>
                <MapPin size={24} color="#a5b4fc" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>I found free spaces</Text>
                  <Text style={styles.reportOptionDesc}>Report available parking in your area</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reportOption} onPress={() => handleReportSpace('full')}>
                <X size={24} color="#f87171" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>Car park is full</Text>
                  <Text style={styles.reportOptionDesc}>Warn drivers that this location is full</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.reportOption, { borderColor: '#eab308' }]} onPress={() => { setShowReportModal(false); setShowSubmitForm(true); }}>
                <Star size={24} color="#eab308" fill="#eab308" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reportOptionTitle}>Report a hidden gem</Text>
                  <Text style={styles.reportOptionDesc}>Know a secret free spot or lay-by? Share it and earn a free month of Premium!</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---------- Reusable components ----------

const PrimaryButton = ({ label, onPress }) => (
  <TouchableOpacity style={styles.primaryButton} onPress={onPress}>
    <Text style={styles.primaryButtonText}>{label}</Text>
  </TouchableOpacity>
);

const SecondaryButton = ({ label, onPress }) => (
  <TouchableOpacity style={styles.secondaryButton} onPress={onPress}>
    <Text style={styles.secondaryButtonText}>{label}</Text>
  </TouchableOpacity>
);

const FeaturePill = ({ icon: Icon, label }) => (
  <View style={styles.featurePill}>
    <Icon size={16} color="#e5e7eb" />
    <Text style={styles.featurePillText}>{label}</Text>
  </View>
);

const FilterChip = ({ label, active, onPress }) => (
  <TouchableOpacity
    style={[styles.filterChip, active && styles.filterChipActive]}
    onPress={onPress}
  >
    <Text
      style={[styles.filterChipText, active && styles.filterChipTextActive]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const TogglePill = ({ label, icon: Icon, active, onPress }) => (
  <TouchableOpacity
    style={[styles.togglePill, active && styles.togglePillActive]}
    onPress={onPress}
  >
    <Icon size={14} color={active ? '#a855f7' : '#e5e7eb'} />
    <Text
      style={[styles.togglePillText, active && styles.togglePillTextActive]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const PremiumModal = ({ visible, onClose, onUpgrade, onStartTrial, trialActive }) => {
  const [selectedPlan, setSelectedPlan] = React.useState('annual');

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={[styles.modalCard, { paddingBottom: 24 }]} style={{ backgroundColor: '#020617', borderRadius: 20, maxHeight: '90%' }}>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>

          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Crown size={48} color="#eab308" />
            <Text style={styles.premiumTitle}>Upgrade to Premium</Text>
            <Text style={styles.premiumSubtitle}>
              Unlock unlimited parking searches worldwide
            </Text>
          </View>

          {/* Free trial banner */}
          {!trialActive && (
            <TouchableOpacity style={styles.trialBanner} onPress={onStartTrial}>
              <Text style={styles.trialBannerTitle}>Try Premium FREE for 7 days</Text>
              <Text style={styles.trialBannerText}>No payment required. Cancel anytime.</Text>
            </TouchableOpacity>
          )}

          <View style={styles.premiumFeatures}>
            <PremiumFeature icon={CheckCircle} text="Unlimited parking searches (50+ spots!)" />
            <PremiumFeature icon={MapPin} text="All free spots, lay-bys & hidden gems" />
            <PremiumFeature icon={Navigation} text="Proximity search — find parking near any destination" />
            <PremiumFeature icon={Car} text="Book & pay for parking in-app" />
            <PremiumFeature icon={Heart} text="Save favourite spots for quick access" />
            <PremiumFeature icon={Star} text="Community hidden gems & reports" />
            <PremiumFeature icon={Globe} text="Access to all 30+ cities worldwide" />
          </View>

          <View style={styles.pricingCards}>
            <TouchableOpacity
              style={[styles.pricingCard, selectedPlan === 'monthly' && styles.pricingCardSelected]}
              onPress={() => setSelectedPlan('monthly')}
            >
              <Text style={styles.pricingLabel}>Monthly</Text>
              <Text style={styles.pricingAmount}>{'\u00a3'}1.99</Text>
              <Text style={styles.pricingPer}>per month</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pricingCard, styles.pricingCardBest, selectedPlan === 'annual' && styles.pricingCardSelected]}
              onPress={() => setSelectedPlan('annual')}
            >
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>BEST VALUE</Text>
              </View>
              <Text style={styles.pricingLabel}>Annual</Text>
              <Text style={styles.pricingAmount}>{'\u00a3'}14.99</Text>
              <Text style={styles.pricingPer}>per year</Text>
              <Text style={styles.savingsText}>Save {'\u00a3'}8.89</Text>
            </TouchableOpacity>
          </View>

          <PrimaryButton label="Upgrade Now" onPress={() => onUpgrade(selectedPlan)} />
          <TouchableOpacity style={{ marginTop: 12 }} onPress={onClose}>
            <Text style={styles.maybeText}>Maybe later</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
};

const PremiumFeature = ({ icon: Icon, text }) => (
  <View style={styles.premiumFeature}>
    <Icon size={18} color="#22c55e" />
    <Text style={styles.premiumFeatureText}>{text}</Text>
  </View>
);

const SpotDetailsModal = ({ spot, visible, onClose, onReview, onSave, isSaved, onShare, onBook, onDirections }) => {
  if (!spot) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={[styles.modalCard, { paddingBottom: 24 }]} style={{ backgroundColor: '#020617', borderRadius: 20, maxHeight: '85%' }}>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Text style={[styles.modalTitle, { marginBottom: 0, flex: 1 }]}>{spot.name}</Text>
            <TouchableOpacity onPress={() => onSave(spot)}>
              <Heart size={22} color="#f472b6" fill={isSaved ? '#f472b6' : 'transparent'} />
            </TouchableOpacity>
          </View>
          <View style={styles.addressRow}>
            <MapPin size={16} color="#9ca3af" />
            <Text style={styles.addressText}>{spot.address}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Star size={16} color="#facc15" />
              <Text style={styles.statText}>{spot.rating}</Text>
            </View>
            <View style={styles.statItem}>
              <Clock size={16} color="#9ca3af" />
              <Text style={styles.statText}>{spot.available}/{spot.total}</Text>
            </View>
            <View style={styles.statItem}>
              <PoundSterling size={16} color="#22c55e" />
              <Text style={styles.priceText}>
                {spot.pricing.free ? 'FREE' : `\u00a3${spot.pricing.hourlyRate}/hr`}
              </Text>
            </View>
          </View>

          {/* Operating Hours */}
          {spot.hours && (
            <View style={styles.hoursCard}>
              <Clock size={14} color="#a5b4fc" />
              <Text style={styles.hoursText}>
                {spot.hours.open === '24hrs' ? 'Open 24 hours' : `${spot.hours.open} - ${spot.hours.close}`}
              </Text>
              {spot.hours.note && <Text style={styles.hoursNote}>{spot.hours.note}</Text>}
            </View>
          )}

          {/* Pricing Details */}
          {!spot.pricing.free && (
            <View style={styles.pricingDetailCard}>
              <Text style={styles.pricingDetailTitle}>Pricing</Text>
              <View style={styles.pricingDetailRow}>
                <Text style={styles.pricingDetailLabel}>Per hour</Text>
                <Text style={styles.pricingDetailValue}>{`\u00a3${spot.pricing.hourlyRate.toFixed(2)}`}</Text>
              </View>
              <View style={styles.pricingDetailRow}>
                <Text style={styles.pricingDetailLabel}>Daily max</Text>
                <Text style={styles.pricingDetailValue}>{`\u00a3${spot.pricing.dailyMax.toFixed(2)}`}</Text>
              </View>
              <View style={styles.pricingDetailRow}>
                <Text style={styles.pricingDetailLabel}>2 hours</Text>
                <Text style={[styles.pricingDetailValue, { color: '#22c55e' }]}>{`\u00a3${(spot.pricing.hourlyRate * 2).toFixed(2)}`}</Text>
              </View>
            </View>
          )}

          {/* Features */}
          <View style={styles.featuresRow}>
            {spot.features.accessible && <View style={styles.featureTag}><Accessibility size={12} color="#a5b4fc" /><Text style={styles.featureTagText}>Accessible</Text></View>}
            {spot.features.covered && <View style={styles.featureTag}><Building2 size={12} color="#a5b4fc" /><Text style={styles.featureTagText}>Covered</Text></View>}
            {spot.features.security && <View style={styles.featureTag}><CheckCircle size={12} color="#a5b4fc" /><Text style={styles.featureTagText}>Security</Text></View>}
            {spot.evCharging.available && <View style={styles.featureTag}><Zap size={12} color="#eab308" /><Text style={styles.featureTagText}>{spot.evCharging.ports} EV ports ({spot.evCharging.speed})</Text></View>}
          </View>

          {spot.description && (
            <Text style={styles.modalDescription}>{spot.description}</Text>
          )}

          {/* Action Buttons */}
          <View style={styles.spotActionsRow}>
            <TouchableOpacity style={styles.directionsButton} onPress={() => onDirections(spot)}>
              <Navigation size={16} color="#22c55e" />
              <Text style={styles.directionsText}>Directions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reviewButton} onPress={onReview}>
              <Star size={16} color="#f9fafb" />
              <Text style={styles.reviewButtonText}>Review</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.spotActionsRow, { marginTop: 8 }]}>
            <TouchableOpacity style={[styles.directionsButton, { borderColor: '#f472b6' }]} onPress={() => onShare(spot)}>
              <Plus size={16} color="#f472b6" />
              <Text style={[styles.directionsText, { color: '#f472b6' }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.reviewButton, { backgroundColor: '#22c55e' }]} onPress={() => onBook(spot)}>
              <Car size={16} color="#f9fafb" />
              <Text style={styles.reviewButtonText}>Book spot</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const ReviewForm = ({ visible, spot, onClose, onSubmit }) => {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Review {spot.name}</Text>
          <Text style={styles.modalSubTitle}>
            Share your experience to help other drivers.
          </Text>

          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity key={v} onPress={() => setRating(v)}>
                <Star
                  size={28}
                  color="#eab308"
                  fill={v <= rating ? '#eab308' : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={4}
            placeholder="Tell us about parking, safety, lighting, etc."
            placeholderTextColor="#6b7280"
            value={comment}
            onChangeText={setComment}
          />

          <PrimaryButton
            label="Submit review"
            onPress={() => {
              onSubmit(spot.id, rating, comment);
              setComment('');
              setRating(5);
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const SubmitSpotForm = ({ visible, onClose, onSubmit, destinations, cityName }) => {
  const [form, setForm] = useState({
    name: '',
    address: '',
    nearDestination: '',
    type: 'surface_lot',
    free: false,
    hourlyRate: '',
    evCharging: false,
    accessible: false,
    covered: false,
    description: '',
  });

  const update = (patch) => setForm({ ...form, ...patch });

  const handleSubmit = () => {
    onSubmit(form);
    setForm({
      name: '',
      address: '',
      nearDestination: '',
      type: 'surface_lot',
      free: false,
      hourlyRate: '',
      evCharging: false,
      accessible: false,
      covered: false,
      description: '',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView
          contentContainerStyle={[styles.modalCard, { paddingBottom: 24 }]}
          style={{ backgroundColor: '#020617', borderRadius: 20 }}
        >
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Submit new parking spot</Text>
          <Text style={styles.modalSubTitle}>
            Help grow the {cityName} parking map and earn points.
          </Text>

          <TextInput
            style={styles.authInput}
            placeholder="Parking spot name"
            placeholderTextColor="#6b7280"
            value={form.name}
            onChangeText={(v) => update({ name: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Address"
            placeholderTextColor="#6b7280"
            value={form.address}
            onChangeText={(v) => update({ address: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Near which destination?"
            placeholderTextColor="#6b7280"
            value={form.nearDestination}
            onChangeText={(v) => update({ nearDestination: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Hourly rate (leave blank if free)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
            value={form.hourlyRate}
            onChangeText={(v) => update({ hourlyRate: v })}
          />

          <View style={styles.toggleRow}>
            <TogglePill
              label="Free"
              icon={CheckCircle}
              active={form.free}
              onPress={() => update({ free: !form.free })}
            />
            <TogglePill
              label="EV charging"
              icon={Zap}
              active={form.evCharging}
              onPress={() => update({ evCharging: !form.evCharging })}
            />
            <TogglePill
              label="Accessible"
              icon={Accessibility}
              active={form.accessible}
              onPress={() => update({ accessible: !form.accessible })}
            />
            <TogglePill
              label="Covered"
              icon={Building2}
              active={form.covered}
              onPress={() => update({ covered: !form.covered })}
            />
          </View>

          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={4}
            placeholder="Any useful details (restrictions, lighting, safety, etc.)"
            placeholderTextColor="#6b7280"
            value={form.description}
            onChangeText={(v) => update({ description: v })}
          />

          <PrimaryButton label="Submit spot" onPress={handleSubmit} />
        </ScrollView>
      </View>
    </Modal>
  );
};

// ---------- Styles (continued in next message due to length) ----------

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#020617',
  },
  fullScreenCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  landingTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: '#e5e7eb',
  },
  logoAccent: {
    color: '#6366f1',
  },
  landingSubtitle: {
    marginTop: 8,
    fontSize: 18,
    color: '#a5b4fc',
  },
  landingDescription: {
    marginTop: 12,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  landingButtonsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  landingFeatureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 20,
    justifyContent: 'center',
    gap: 8,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#020617',
  },
  featurePillText: {
    marginLeft: 6,
    color: '#e5e7eb',
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#4f46e5',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  authScreen: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  authTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#e5e7eb',
    marginBottom: 16,
    textAlign: 'center',
  },
  authCard: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  authInput: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    fontSize: 14,
    marginBottom: 8,
  },
  authSwitchText: {
    marginTop: 8,
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
  },
  authSwitchLink: {
    color: '#a5b4fc',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    justifyContent: 'space-between',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#e5e7eb',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eab308',
    backgroundColor: 'rgba(234,179,8,0.15)',
    gap: 4,
  },
  premiumButtonText: {
    color: '#eab308',
    fontSize: 12,
    fontWeight: '600',
  },
  submitSpotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eab308',
    backgroundColor: 'rgba(234,179,8,0.15)',
    gap: 4,
  },
  submitSpotText: {
    color: '#eab308',
    fontSize: 12,
    fontWeight: '600',
  },
  menuButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  menuSheet: {
    marginHorizontal: 16,
    marginTop: 6,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
  },
  menuUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    marginBottom: 8,
  },
  menuUserName: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  menuPoints: {
    color: '#eab308',
    fontSize: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  menuItemText: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  searchScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#020617',
    marginBottom: 16,
  },
  cityText: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  destChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 8,
    backgroundColor: '#020617',
  },
  destChipActive: {
    backgroundColor: '#e0e7ff',
    borderColor: '#4f46e5',
  },
  destChipText: {
    marginLeft: 6,
    color: '#e5e7eb',
    fontSize: 13,
  },
  destChipTextActive: {
    color: '#111827',
    fontWeight: '600',
  },
  searchBar: {
    marginTop: 4,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#020617',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: '#e5e7eb',
    fontSize: 14,
  },
  filterIcon: {
    paddingLeft: 8,
  },
  filtersCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  filterLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginRight: 4,
  },
  filterChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
  },
  filterChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  filterChipText: {
    color: '#e5e7eb',
    fontSize: 12,
  },
  filterChipTextActive: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    gap: 4,
  },
  togglePillActive: {
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderColor: '#a855f7',
  },
  togglePillText: {
    color: '#e5e7eb',
    fontSize: 12,
  },
  togglePillTextActive: {
    color: '#e0d5ff',
    fontWeight: '600',
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  resultsHeader: {
    marginTop: 8,
    marginBottom: 12,
  },
  resultsTitle: {
    color: '#e5e7eb',
    fontSize: 14,
    fontWeight: '600',
  },
  limitText: {
    color: '#eab308',
    fontSize: 12,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  typeBadgeText: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  addressText: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  badgeFree: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  badgeText: {
    color: '#e5e7eb',
    fontSize: 10,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  priceText: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
  },
  upgradeCard: {
    backgroundColor: 'rgba(234,179,8,0.1)',
    borderWidth: 2,
    borderColor: '#eab308',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 12,
  },
  upgradeCardTitle: {
    color: '#eab308',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  upgradeCardText: {
    color: '#d1d5db',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  upgradeButton: {
    backgroundColor: '#eab308',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 16,
  },
  upgradeButtonText: {
    color: '#020617',
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#020617',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#1f2937',
    zIndex: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#e5e7eb',
    marginBottom: 8,
  },
  modalSubTitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  modalDescription: {
    color: '#d1d5db',
    fontSize: 14,
    marginTop: 12,
    lineHeight: 20,
  },
  cityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  cityOptionName: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
  },
  cityOptionCountry: {
    color: '#9ca3af',
    fontSize: 13,
  },
  premiumTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#eab308',
    marginTop: 12,
  },
  premiumSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  premiumFeatures: {
    gap: 12,
    marginBottom: 20,
  },
  premiumFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  premiumFeatureText: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  pricingCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  pricingCard: {
    flex: 1,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  pricingCardSelected: {
    borderColor: '#4f46e5',
    borderWidth: 2,
    backgroundColor: 'rgba(79,70,229,0.1)',
  },
  pricingCardBest: {
    borderColor: '#eab308',
    borderWidth: 2,
    position: 'relative',
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: '#eab308',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  bestValueText: {
    color: '#020617',
    fontSize: 10,
    fontWeight: '700',
  },
  pricingLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 8,
  },
  pricingAmount: {
    color: '#e5e7eb',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  pricingPer: {
    color: '#9ca3af',
    fontSize: 12,
  },
  savingsText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  maybeText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
  },
  spotActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  directionsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22c55e',
    gap: 6,
  },
  directionsText: {
    color: '#22c55e',
    fontWeight: '600',
  },
  reviewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
    gap: 6,
  },
  reviewButtonText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
  },
  textArea: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    fontSize: 14,
    marginBottom: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  backButton: {
    padding: 8,
  },
  pointsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234,179,8,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.3)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  pointsLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  pointsValue: {
    color: '#eab308',
    fontSize: 24,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  submissionCard: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 12,
  },
  pendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(234,179,8,0.15)',
  },
  pendingBadgeText: {
    color: '#eab308',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  subMeta: {
    color: '#6b7280',
    fontSize: 12,
  },
  savedButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    position: 'relative',
  },
  savedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#f472b6',
    borderRadius: 999,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  suggestionsContainer: {
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  suggestionsTitle: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '600',
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(99,102,241,0.08)',
    gap: 5,
  },
  suggestionText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '500',
  },
  // --- Hours ---
  hoursCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  hoursText: {
    color: '#a5b4fc',
    fontSize: 13,
    fontWeight: '600',
  },
  hoursNote: {
    color: '#6b7280',
    fontSize: 11,
    width: '100%',
    marginTop: 2,
  },
  // --- Pricing Detail ---
  pricingDetailCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    gap: 6,
  },
  pricingDetailTitle: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  pricingDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pricingDetailLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  pricingDetailValue: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  // --- Features Row ---
  featuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  featureTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(99,102,241,0.05)',
  },
  featureTagText: {
    color: '#d1d5db',
    fontSize: 11,
  },
  // --- Receipt ---
  receiptBox: {
    backgroundColor: 'rgba(99,102,241,0.06)',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    gap: 6,
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  receiptLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  receiptValue: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  // --- Report a Space ---
  reportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(99,102,241,0.06)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  reportOptionTitle: {
    color: '#e5e7eb',
    fontSize: 15,
    fontWeight: '600',
  },
  reportOptionDesc: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  // --- Trial Banner ---
  trialBanner: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: '#22c55e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  trialBannerTitle: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '700',
  },
  trialBannerText: {
    color: '#d1d5db',
    fontSize: 12,
    marginTop: 4,
  },
  // --- Availability Badge ---
  availBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  availText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // --- Walk time ---
  walkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(107,114,128,0.12)',
  },
  walkText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '500',
  },
  // --- Recently Viewed ---
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: 'rgba(99,102,241,0.05)',
    marginRight: 6,
  },
  recentChipText: {
    color: '#d1d5db',
    fontSize: 11,
  },
  // --- Cheapest Tip ---
  cheapestTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
  },
  cheapestTipText: {
    color: '#86efac',
    fontSize: 12,
    flex: 1,
  },
  proximityTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(165,180,252,0.08)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(165,180,252,0.2)',
  },
  proximityTipText: {
    color: '#c7d2fe',
    fontSize: 12,
    flex: 1,
  },
  hiddenGemBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(234,179,8,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.3)',
  },
  hiddenGemText: {
    color: '#eab308',
    fontSize: 10,
    fontWeight: '600',
  },
  // --- Timer Banner ---
  timerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#4f46e5',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  timerBannerTitle: {
    color: '#e0e7ff',
    fontSize: 12,
    fontWeight: '500',
  },
  timerBannerTime: {
    color: '#f9fafb',
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timerBannerLabel: {
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: '700',
  },
  // --- FAB ---
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#4f46e5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});
