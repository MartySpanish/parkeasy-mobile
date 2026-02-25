// app/firebaseConfig.js
// Firebase initialisation for ParkEasy
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a project (or open an existing one)
// 3. Go to Authentication → Sign-in method → Email/Password → Enable it
// 4. Go to Project Settings → Your apps → Add a Web app
// 5. Copy the firebaseConfig object and paste your values below
// 6. Replace every 'YOUR_...' placeholder with your real values

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBdSdpL0-uMYBGfXpDRRd3h5qjTmCkLbck',
  authDomain: 'park-easy-659ad.firebaseapp.com',
  projectId: 'park-easy-659ad',
  storageBucket: 'park-easy-659ad.firebasestorage.app',
  messagingSenderId: '516582303587',
  appId: '1:516582303587:web:7b36b656b51dc37c2fd556',
};

// Guard against hot-reload double-initialisation in Expo Go
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Use AsyncStorage for auth persistence so users stay logged in between app restarts.
// getReactNativePersistence is the correct approach for Expo managed workflow.
export const auth =
  getApps().length <= 1
    ? initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      })
    : getAuth(app);
