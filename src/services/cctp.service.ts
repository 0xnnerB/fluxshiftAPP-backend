import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';
import { getAttestationApiUrl } from '../config/circle.js';
import { CHAINS, USDC_ABI } from '../config/chains.js';
import circleWalletService from './circleWallet.service.js';
import { userStore, TransferStatus } from '../models/user.model.js';
import userService from './user.service.js';

function addressToBytes32(address: string): string {
  return ethers.zeroPadValue(address, 32);
}

function parseUsdcAmount(amount: string): bigint {
  return ethers.parseUnits(amount, 6);
}

function formatUsdcAmount(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}

export interface AttestationResponse {
  messages: Array<{
    attestation: string;
    message: string;
    eventNonce: string;
    status: 'pending' | 'complete';
    cctpVersion: number;
  }>;
}

export interface BridgeInitResult {
  transferId: string;
  transactionId: string;
  status: TransferStatus;
}

export interface BridgeStatusResult {
  transferId: string;
  status: TransferStatus;
  burnTxHash: string | null;
  mintTxHash: string | null;
  message: string | null;
  attestation: string | null;
  sourceChain: string;
  destinationChain: string;
  amount: string;
}

class CCTPService {
  private attestationApiUrl: string;
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();

  constructor() {
    this.attestationApiUrl = getAttestationApiUrl();
    this.initProviders();
  }

  private initProviders(): void {
    for (const [key, chain] of Object.entries(CHAINS)) {
      try {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        this.providers.set(key, provider);
        logger.debug(`Initialized provider for ${chain.name}`);
      } catch (error) {
        logger.error(`Failed to initialize provider for ${chain.name}:`, error);
      }
    }
  }

  private getProvider(chainKey: string): ethers.JsonRpcProvider {
    const provider = this.providers.get(chainKey);
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chainKey}`);
    }
    return provider;
  }

  async getUsdcBalance(address: string, chainKey: string): Promise<string> {
    const chain = CHAINS[chainKey];
    if (!chain) throw new Error(`Unknown chain: ${chainKey}`);

    try {
      const provider = this.getProvider(chainKey);
      const usdcContract = new ethers.Contract(chain.usdc, USDC_ABI, provider);
      const balance = await usdcContract.balanceOf(address);
      return formatUsdcAmount(balance);
    } catch (error) {
      logger.error(`Failed to get balance for ${chainKey}:`, error);
      return '0';
    }
  }

  async getEthBalance(address: string, chainKey: string): Promise<string> {
    const chain = CHAINS[chainKey];
    if (!chain) throw new Error(`Unknown chain: ${chainKey}`);

    // Arc Testnet usa USDC como gas, não tem ETH nativo
    if (chainKey === 'ARC_TESTNET') {
      return '0';
    }

    try {
      const provider = this.getProvider(chainKey);
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (error) {
      logger.error(`Failed to get ETH balance for ${chainKey}:`, error);
      return '0';
    }
  }

  async initiateBridge(
    userId: string,
    sourceChainKey: string,
    destChainKey: string,
    amount: string,
    recipientAddress?: string
  ): Promise<BridgeInitResult> {
    const sourceChain = CHAINS[sourceChainKey];
    const destChain = CHAINS[destChainKey];

    if (!sourceChain || !destChain) {
      throw new Error('Invalid source or destination chain');
    }

    // CORREÇÃO: Pega o walletId da SOURCE chain para fazer burn
    const sourceWalletId = await userService.getWalletIdForChainKey(userId, sourceChainKey);
    if (!sourceWalletId) {
      throw new Error(`No wallet found for source chain: ${sourceChainKey}`);
    }

    const transfer = await userStore.createTransfer(userId, sourceChainKey, destChainKey, amount);

    try {
      await userStore.updateTransfer(transfer.id, { status: 'burning' });

      const user = await userStore.getUserById(userId);
      const destAddress = recipientAddress || 
        user?.walletAddresses.find(wa => wa.blockchain === destChain.circleBlockchain)?.address;

      if (!destAddress) {
        throw new Error('No destination address available');
      }

      const amountInUnits = parseUsdcAmount(amount);

      logger.info(`Initiating bridge: ${amount} USDC from ${sourceChainKey} to ${destChainKey}`);
      logger.info(`Source walletId: ${sourceWalletId}`);

      logger.info('Step 1: Approving USDC...');
      const approvalResult = await circleWalletService.executeContract(
        sourceWalletId,
        sourceChain.circleBlockchain,
        sourceChain.usdc,
        'approve(address,uint256)',
        [sourceChain.tokenMessenger, amountInUnits.toString()]
      );

      await circleWalletService.waitForTransaction(approvalResult.transaction.id);
      logger.info(`USDC approval confirmed for transfer ${transfer.id}`);

      logger.info('Step 2: Burning USDC...');
      const mintRecipient = addressToBytes32(destAddress);
      
      // CCTP V2 - Todas as testnets agora usam V2
      logger.info('Using CCTP V2 depositForBurn signature');
      // depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)
      const destinationCaller = '0x0000000000000000000000000000000000000000000000000000000000000000'; // Permite qualquer caller
      
      // maxFee deve ser MENOR que o amount - usar 1% do amount ou mínimo de 1000 (0.001 USDC)
      const amountBigInt = BigInt(amountInUnits.toString());
      const feePercent = amountBigInt / BigInt(100); // 1% do amount
      const minFee = BigInt(1000); // 0.001 USDC mínimo
      const maxFee = feePercent > minFee ? feePercent.toString() : minFee.toString();
      
      const minFinalityThreshold = '2000'; // Standard transfer (finalized)
      
      logger.info(`Amount: ${amountInUnits.toString()}, MaxFee: ${maxFee}, Destination Domain: ${destChain.cctpDomain}`);
      logger.info(`TokenMessenger: ${sourceChain.tokenMessenger}`);
      
      const burnResult = await circleWalletService.executeContract(
        sourceWalletId,
        sourceChain.circleBlockchain,
        sourceChain.tokenMessenger,
        'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
        [amountInUnits.toString(), destChain.cctpDomain, mintRecipient, sourceChain.usdc, destinationCaller, maxFee, minFinalityThreshold]
      );

      const burnTx = await circleWalletService.waitForTransaction(burnResult.transaction.id);
      const burnTxHash = burnTx.transaction.txHash || null;
      
      await userStore.updateTransfer(transfer.id, { status: 'waiting_attestation', burnTxHash });

      logger.info(`Bridge burn completed: ${burnTxHash}`);

      return {
        transferId: transfer.id,
        transactionId: burnResult.transaction.id,
        status: 'waiting_attestation',
      };
    } catch (error: any) {
      logger.error('Bridge initiation failed:', error);
      await userStore.updateTransfer(transfer.id, { status: 'failed' });
      throw error;
    }
  }

  async checkAttestation(burnTxHash: string, sourceDomain: number): Promise<AttestationResponse | null> {
    try {
      const url = `${this.attestationApiUrl}/${sourceDomain}?transactionHash=${burnTxHash}`;
      logger.debug(`Checking attestation at: ${url}`);
      const response = await axios.get<AttestationResponse>(url);
      
      if (response.data.messages && response.data.messages.length > 0) {
        return response.data;
      }
      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      logger.error('Failed to check attestation:', error.message);
      throw error;
    }
  }

  async waitForAttestation(
    burnTxHash: string,
    sourceDomain: number,
    maxAttempts: number = 60,
    intervalMs: number = 30000
  ): Promise<AttestationResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attestation = await this.checkAttestation(burnTxHash, sourceDomain);
      
      if (attestation && attestation.messages[0]?.status === 'complete') {
        return attestation;
      }

      logger.debug(`Waiting for attestation (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Attestation timed out');
  }

  async completeBridge(
    transferId: string,
    userId: string,
    message: string,
    attestation: string
  ): Promise<{ mintTxHash: string }> {
    const transfer = await userStore.getTransferById(transferId);
    if (!transfer) {
      throw new Error('Transfer not found');
    }

    // Verificar se já foi completado
    if (transfer.status === 'completed' && transfer.mintTxHash) {
      logger.info(`Transfer ${transferId} already completed with txHash: ${transfer.mintTxHash}`);
      return { mintTxHash: transfer.mintTxHash };
    }

    const destChain = CHAINS[transfer.destinationChain];
    if (!destChain) {
      throw new Error('Invalid destination chain');
    }

    // CORREÇÃO: Pega o walletId da DESTINATION chain para fazer mint
    const destWalletId = await userService.getWalletIdForChainKey(userId, transfer.destinationChain);
    if (!destWalletId) {
      throw new Error(`No wallet found for destination chain: ${transfer.destinationChain}`);
    }

    try {
      await userStore.updateTransfer(transferId, { status: 'minting' });

      logger.info(`Step 4: Minting USDC on ${destChain.name}...`);
      logger.info(`Destination chain key: ${transfer.destinationChain}`);
      logger.info(`Destination walletId: ${destWalletId}`);
      logger.info(`Destination MessageTransmitter: ${destChain.messageTransmitter}`);
      logger.info(`Destination CCTP Version: ${destChain.cctpVersion}`);
      logger.info(`Message length: ${message.length}`);
      logger.info(`Attestation length: ${attestation.length}`);
      
      const mintResult = await circleWalletService.executeContract(
        destWalletId,
        destChain.circleBlockchain,
        destChain.messageTransmitter,
        'receiveMessage(bytes,bytes)',
        [message, attestation]
      );

      const mintTx = await circleWalletService.waitForTransaction(mintResult.transaction.id);
      const mintTxHash = mintTx.transaction.txHash || '';

      await userStore.updateTransfer(transferId, { status: 'completed', mintTxHash, message, attestation });

      logger.info(`Bridge completed: ${mintTxHash}`);

      return { mintTxHash };
    } catch (error: any) {
      logger.error('Bridge completion failed:', error.message);
      
      // Se o erro indica que a mensagem já foi processada, marcar como completo
      if (error.message?.includes('already') || error.message?.includes('nonce')) {
        logger.warn('Message may have been already processed');
      }
      
      await userStore.updateTransfer(transferId, { status: 'failed' });
      throw error;
    }
  }

  async getBridgeStatus(transferId: string): Promise<BridgeStatusResult> {
    const transfer = await userStore.getTransferById(transferId);
    if (!transfer) {
      throw new Error('Transfer not found');
    }

    if (transfer.status === 'waiting_attestation' && transfer.burnTxHash) {
      const sourceChain = CHAINS[transfer.sourceChain];
      if (sourceChain) {
        try {
          const attestation = await this.checkAttestation(transfer.burnTxHash, sourceChain.cctpDomain);

          if (attestation && attestation.messages[0]?.status === 'complete') {
            await userStore.updateTransfer(transferId, {
              status: 'ready_to_mint',
              message: attestation.messages[0].message,
              attestation: attestation.messages[0].attestation,
            });
            
            const updatedTransfer = await userStore.getTransferById(transferId);
            return {
              transferId: updatedTransfer!.id,
              status: updatedTransfer!.status,
              burnTxHash: updatedTransfer!.burnTxHash,
              mintTxHash: updatedTransfer!.mintTxHash,
              message: updatedTransfer!.message,
              attestation: updatedTransfer!.attestation,
              sourceChain: updatedTransfer!.sourceChain,
              destinationChain: updatedTransfer!.destinationChain,
              amount: updatedTransfer!.amount,
            };
          }
        } catch (error) {
          logger.error('Failed to check attestation status:', error);
        }
      }
    }

    return {
      transferId: transfer.id,
      status: transfer.status,
      burnTxHash: transfer.burnTxHash,
      mintTxHash: transfer.mintTxHash,
      message: transfer.message,
      attestation: transfer.attestation,
      sourceChain: transfer.sourceChain,
      destinationChain: transfer.destinationChain,
      amount: transfer.amount,
    };
  }

  async executeBridgeFlow(
    userId: string,
    sourceChainKey: string,
    destChainKey: string,
    amount: string,
    onStatusUpdate?: (status: TransferStatus, message: string) => void
  ): Promise<BridgeStatusResult> {
    const notify = (status: TransferStatus, message: string) => {
      logger.info(`Bridge ${status}: ${message}`);
      onStatusUpdate?.(status, message);
    };

    notify('burning', 'Initiating burn on source chain...');
    const initResult = await this.initiateBridge(userId, sourceChainKey, destChainKey, amount);

    const transfer = await userStore.getTransferById(initResult.transferId);
    
    if (!transfer || !transfer.burnTxHash) {
      throw new Error('Burn transaction hash not available');
    }

    notify('waiting_attestation', 'Waiting for Circle attestation (this may take ~15-25 minutes)...');
    const sourceChain = CHAINS[sourceChainKey];
    const attestation = await this.waitForAttestation(transfer.burnTxHash, sourceChain.cctpDomain);

    const attestationData = attestation.messages[0];
    await userStore.updateTransfer(transfer.id, {
      status: 'ready_to_mint',
      message: attestationData.message,
      attestation: attestationData.attestation,
    });

    notify('minting', 'Minting on destination chain...');
    // CORREÇÃO: Passa userId ao invés de walletId
    await this.completeBridge(transfer.id, userId, attestationData.message, attestationData.attestation);

    notify('completed', 'Bridge completed successfully!');
    
    return this.getBridgeStatus(transfer.id);
  }
}

export const cctpService = new CCTPService();
export default cctpService;
