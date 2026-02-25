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
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
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
