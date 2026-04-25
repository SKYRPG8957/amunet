import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.luma.arcade',
  appName: 'Luma Arcade',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
