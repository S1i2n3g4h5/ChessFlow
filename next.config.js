/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
    '*.loca.lt',
    '100.128.167.180',
    'localhost:3000',
    '127.0.0.1:3000'
  ],
};

module.exports = nextConfig;
