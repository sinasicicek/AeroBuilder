import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sinasi.aeroplan',
  appName: 'AeroBuilder',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0284c7',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
