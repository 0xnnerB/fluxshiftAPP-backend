import dotenv from 'dotenv';
dotenv.config();

export interface ChainConfig {
  name: string;
  chainId: number;
  cctpDomain: number;
  cctpVersion: 1 | 2;  // CCTP V1 ou V2
  circleBlockchain: string;
  rpcUrl: string;
  usdc: string;
  tokenMessenger: string;
  messageTransmitter: string;
  explorer: string;
}

export const CHAINS: Record<string, ChainConfig> = {
  ETH_SEPOLIA: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    cctpDomain: 0,
    cctpVersion: 2,
    circleBlockchain: 'ETH-SEPOLIA',
    rpcUrl: process.env.ETH_SEPOLIA_RPC || 'https://eth-sepolia.g.alchemy.com/v2/demo',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.etherscan.io',
  },
  ARB_SEPOLIA: {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    cctpDomain: 3,
    cctpVersion: 2,
    circleBlockchain: 'ARB-SEPOLIA',
    rpcUrl: process.env.ARB_SEPOLIA_RPC || 'https://arb-sepolia.g.alchemy.com/v2/demo',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.arbiscan.io',
  },
  BASE_SEPOLIA: {
    name: 'Base Sepolia',
    chainId: 84532,
    cctpDomain: 6,
    cctpVersion: 2,
    circleBlockchain: 'BASE-SEPOLIA',
    rpcUrl: process.env.BASE_SEPOLIA_RPC || 'https://base-sepolia.g.alchemy.com/v2/demo',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia.basescan.org',
  },
  OP_SEPOLIA: {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    cctpDomain: 2,
    cctpVersion: 2,
    circleBlockchain: 'OP-SEPOLIA',
    rpcUrl: process.env.OPT_SEPOLIA_RPC || 'https://opt-sepolia.g.alchemy.com/v2/demo',
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://sepolia-optimism.etherscan.io',
  },
  ARC_TESTNET: {
    name: 'Arc Testnet',
    chainId: 5042002,
    cctpDomain: 26,
    cctpVersion: 2,
    circleBlockchain: 'ARC-TESTNET',
    rpcUrl: process.env.ARC_TESTNET_RPC || 'https://rpc.testnet.arc.network/',
    usdc: '0x3600000000000000000000000000000000000000',
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    explorer: 'https://testnet.arcscan.app',
  },
};

export const SUPPORTED_CIRCLE_BLOCKCHAINS = Object.values(CHAINS).map(c => c.circleBlockchain);

export function getChainByCircleBlockchain(circleBlockchain: string): ChainConfig | undefined {
  return Object.values(CHAINS).find(c => c.circleBlockchain === circleBlockchain);
}

export function getChainByDomain(domain: number): ChainConfig | undefined {
  return Object.values(CHAINS).find(c => c.cctpDomain === domain);
}

export function getChainKeyByCircleBlockchain(circleBlockchain: string): string | undefined {
  const entry = Object.entries(CHAINS).find(([_, chain]) => chain.circleBlockchain === circleBlockchain);
  return entry ? entry[0] : undefined;
}

export const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)',
];

export const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
];
