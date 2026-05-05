import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.parkeasy.belfast',
  appName: 'ParkEasy Belfast',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
