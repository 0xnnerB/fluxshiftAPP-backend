import dotenv from 'dotenv';
dotenv.config();

export const CIRCLE_CONFIG = {
  apiKey: process.env.CIRCLE_API_KEY || '',
  entitySecret: process.env.CIRCLE_ENTITY_SECRET || '',
  environment: process.env.CIRCLE_ENV || 'testnet',
};

export const CIRCLE_API_URLS = {
  testnet: 'https://api.circle.com/v1/w3s',
  mainnet: 'https://api.circle.com/v1/w3s',
};

export const ATTESTATION_API_URLS = {
  testnet: 'https://iris-api-sandbox.circle.com/v2/messages',
  mainnet: 'https://iris-api.circle.com/v2/messages',
};

export function getCircleApiUrl(): string {
  return CIRCLE_API_URLS[CIRCLE_CONFIG.environment as keyof typeof CIRCLE_API_URLS] || CIRCLE_API_URLS.testnet;
}

export function getAttestationApiUrl(): string {
  return ATTESTATION_API_URLS[CIRCLE_CONFIG.environment as keyof typeof ATTESTATION_API_URLS] || ATTESTATION_API_URLS.testnet;
}
