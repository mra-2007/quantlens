import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api is proxied to the Express server (server/, port 4000).
// In production set VITE_API_URL to the deployed API origin, e.g. https://quantlens-api.onrender.com/api
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:4000" } },
});
