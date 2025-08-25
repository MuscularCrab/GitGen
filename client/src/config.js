// Configuration for different environments
const config = {
  development: {
    apiBaseUrl: '', // Use relative URLs in development to avoid CORS issues
  },
  production: {
    apiBaseUrl: '', // Empty for same-origin requests
  }
};

const environment = process.env.NODE_ENV || 'development';
export const apiBaseUrl = config[environment].apiBaseUrl;

// Helper function to get the full API URL
export const getApiUrl = (endpoint) => {
  const base = apiBaseUrl || window.location.origin;
  return `${base}${endpoint}`;
};

export default config[environment];
