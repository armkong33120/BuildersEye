import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        admin: resolve(__dirname, 'admin.html'),
        debug_neural_network_diagram: resolve(__dirname, 'debug_neural_network_diagram.html'),
      },
    },
  },
});
