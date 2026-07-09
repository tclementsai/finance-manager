/** @type {import('next').NextConfig} */
const API = process.env.API_URL || "http://54.153.151.232:8078";
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API.replace(/\/$/, "")}/api/:path*` }];
  },
};
