import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { SUPPORTED_CIRCLE_BLOCKCHAINS } from '../config/chains.js';

const CIRCLE_API_BASE = 'https://api.circle.com/v1/w3s';

class CircleWalletService {
  private client: AxiosInstance;
  private entitySecret: string;
  private publicKey: string | null = null;

  constructor() {
    const apiKey = process.env.CIRCLE_API_KEY;
    this.entitySecret = process.env.CIRCLE_ENTITY_SECRET || '';

    if (!apiKey) {
      throw new Error('CIRCLE_API_KEY is required');
    }

    if (!this.entitySecret) {
      throw new Error('CIRCLE_ENTITY_SECRET is required');
    }

    this.client = axios.create({
      baseURL: CIRCLE_API_BASE,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private async fetchPublicKey(): Promise<string> {
    if (this.publicKey) return this.publicKey;

    const response = await this.client.get('/config/entity/publicKey');
    this.publicKey = response.data.data.publicKey;
    logger.debug('Fetched Circle public key');
    return this.publicKey!;
  }

  private async generateEntitySecretCiphertext(): Promise<string> {
    const publicKeyPem = await this.fetchPublicKey();
    const entitySecretBuffer = Buffer.from(this.entitySecret, 'hex');
    
    const encryptedData = crypto.publicEncrypt(
      {
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      entitySecretBuffer
    );
    
    return encryptedData.toString('base64');
  }

  /**
   * Extrai transaction de qualquer formato de resposta da Circle API
   */
  private extractTransaction(responseData: any): any {
    // Log completo para debug
    logger.info(`[CIRCLE RESPONSE] ${JSON.stringify(responseData)}`);

    // Formato: { data: { transaction: {...} } }
    if (responseData?.data?.transaction?.id) {
      return responseData.data.transaction;
    }
    // Formato: { data: { id: ..., state: ... } }
    if (responseData?.data?.id) {
      return responseData.data;
    }
    // Formato: { transaction: {...} }
    if (responseData?.transaction?.id) {
      return responseData.transaction;
    }
    // Formato direto: { id: ..., state: ... }
    if (responseData?.id) {
      return responseData;
    }

    logger.error(`[CIRCLE] Unexpected format: ${JSON.stringify(responseData)}`);
    throw new Error('Could not extract transaction from Circle response');
  }

  async getWalletsBySetId(walletSetId: string): Promise<any[]> {
    try {
      const response = await this.client.get(`/wallets?walletSetId=${walletSetId}`);
      return response.data?.data?.wallets || [];
    } catch (error: any) {
      logger.error('Failed to get wallets:', error.message);
      return [];
    }
  }

  async createWalletSet(name?: string): Promise<any> {
    const entitySecretCiphertext = await this.generateEntitySecretCiphertext();
    
    const response = await this.client.post('/developer/walletSets', {
      idempotencyKey: uuidv4(),
      name: name || `FluxShift-${Date.now()}`,
      entitySecretCiphertext,
    });
    
    logger.info(`Created wallet set: ${response.data.data.walletSet.id}`);
    return response.data.data;
  }

  async createWallet(walletSetId: string, blockchains: string[]): Promise<any[]> {
    const entitySecretCiphertext = await this.generateEntitySecretCiphertext();
    
    // Criar wallets SCA (Smart Contract Account) para ter Gas Station automático
    // Com SCA, a Circle cobre o gas para todas as transações
    const response = await this.client.post('/developer/wallets', {
      idempotencyKey: uuidv4(),
      walletSetId,
      blockchains,
      accountType: 'SCA',  // Smart Contract Account - Gas Station enabled
      count: 1,
      entitySecretCiphertext,
    });

    const wallets = response.data?.data?.wallets || [];
    logger.info(`Created ${wallets.length} SCA wallet(s) with Gas Station enabled`);
    return wallets.map((w: any) => ({ wallet: w }));
  }

  async getTokenBalances(walletId: string): Promise<any> {
    const response = await this.client.get(`/wallets/${walletId}/balances`);
    return response.data?.data || { tokenBalances: [] };
  }

  async getUsdcBalance(walletId: string, blockchain: string): Promise<string> {
    try {
      const balances = await this.getTokenBalances(walletId);
      const usdcBalance = balances.tokenBalances?.find(
        (tb: any) => tb.token?.symbol === 'USDC' && tb.token?.blockchain === blockchain
      );
      return usdcBalance?.amount || '0';
    } catch {
      return '0';
    }
  }

  /**
   * Get native token (ETH) tokenId from wallet balances
   */
  async getNativeTokenId(walletId: string, blockchain: string): Promise<string | null> {
    try {
      const balances = await this.getTokenBalances(walletId);
      // Native tokens have isNative: true or symbol like ETH/MATIC
      const nativeToken = balances.tokenBalances?.find(
        (tb: any) => tb.token?.blockchain === blockchain && 
          (tb.token?.isNative === true || 
           tb.token?.symbol === 'ETH' || 
           tb.token?.symbol === 'MATIC' ||
           tb.token?.symbol === 'AVAX')
      );
      logger.info(`[CIRCLE] Native token for ${blockchain}: ${JSON.stringify(nativeToken)}`);
      return nativeToken?.token?.id || null;
    } catch (error) {
      logger.error(`[CIRCLE] Failed to get native tokenId:`, error);
      return null;
    }
  }

  /**
   * Execute contract - VERSÃO CORRIGIDA com extração robusta
   */
  async executeContract(
    walletId: string,
    _blockchain: string,
    contractAddress: string,
    abiFunctionSignature: string,
    abiParameters: any[]
  ): Promise<{ transaction: any }> {
    const entitySecretCiphertext = await this.generateEntitySecretCiphertext();
    
    const requestBody = {
      idempotencyKey: uuidv4(),
      walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      feeLevel: 'HIGH',
      entitySecretCiphertext,
    };

    logger.info(`[CIRCLE] Executing: ${abiFunctionSignature}`);
    logger.debug(`[CIRCLE] Contract: ${contractAddress}`);
    
    try {
      const response = await this.client.post(
        '/developer/transactions/contractExecution',
        requestBody
      );

      const transaction = this.extractTransaction(response.data);
      
      logger.info(`[CIRCLE] Transaction created: ${transaction.id} - State: ${transaction.state}`);
      return { transaction };
    } catch (error: any) {
      const errorData = error.response?.data;
      logger.error(`[CIRCLE] Contract execution error:`, JSON.stringify(errorData));
      logger.error(`[CIRCLE] Request was:`, JSON.stringify({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParametersLength: abiParameters.length,
      }));
      
      const errorMsg = errorData?.message || errorData?.error?.message || error.message;
      throw new Error(`Contract execution failed: ${errorMsg}`);
    }
  }

  async getTransaction(transactionId: string): Promise<{ transaction: any }> {
    const response = await this.client.get(`/transactions/${transactionId}`);
    const transaction = this.extractTransaction(response.data);
    return { transaction };
  }

  async waitForTransaction(
    transactionId: string,
    maxAttempts: number = 60,
    intervalMs: number = 3000
  ): Promise<{ transaction: any }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { transaction } = await this.getTransaction(transactionId);
      const state = transaction?.state;
      
      logger.debug(`[CIRCLE] Tx ${transactionId}: ${state} (${attempt + 1}/${maxAttempts})`);
      
      if (state === 'CONFIRMED' || state === 'COMPLETE') {
        return { transaction };
      }
      
      if (state === 'FAILED' || state === 'DENIED') {
        throw new Error(`Transaction ${state}`);
      }

      await new Promise(r => setTimeout(r, intervalMs));
    }

    throw new Error('Transaction timed out');
  }

  async createUserWallets(existingWalletSetId?: string): Promise<{
    walletSetId: string;
    wallets: Array<{ blockchain: string; walletId: string; address: string }>;
  }> {
    let walletSetId = existingWalletSetId;

    if (walletSetId) {
      const existingWallets = await this.getWalletsBySetId(walletSetId);
      if (existingWallets.length > 0) {
        logger.info(`Found ${existingWallets.length} existing wallets`);
        return {
          walletSetId,
          wallets: existingWallets.map((w: any) => ({
            blockchain: w.blockchain || '',
            walletId: w.id,
            address: w.address || '',
          })),
        };
      }
    }

    if (!walletSetId) {
      const result = await this.createWalletSet();
      walletSetId = result.walletSet.id;
    }

    const walletsResponse = await this.createWallet(walletSetId!, SUPPORTED_CIRCLE_BLOCKCHAINS);

    return {
      walletSetId: walletSetId!,
      wallets: walletsResponse.map((wr: any) => ({
        blockchain: wr.wallet?.blockchain || '',
        walletId: wr.wallet?.id || '',
        address: wr.wallet?.address || '',
      })),
    };
  }

  /**
   * Transfer native token (ETH) to an address
   * According to Circle docs: "Blockchain address of the transferred token. Empty for native tokens."
   * Use tokenAddress="" and tokenBlockchain to transfer native tokens
   */
  async transferNative(
    walletId: string,
    blockchain: string,
    toAddress: string,
    amountInEther: string
  ): Promise<{ transaction: any }> {
    const entitySecretCiphertext = await this.generateEntitySecretCiphertext();
    
    // Para tokens nativos: tokenAddress vazio + tokenBlockchain
    const requestBody = {
      idempotencyKey: uuidv4(),
      walletId,
      tokenAddress: '',  // Empty for native tokens (ETH)
      tokenBlockchain: blockchain,
      destinationAddress: toAddress,
      amounts: [amountInEther],
      feeLevel: 'HIGH',
      entitySecretCiphertext,
    };

    logger.info(`[CIRCLE] Transferring native token (ETH) on ${blockchain}`);
    logger.info(`[CIRCLE] WalletId: ${walletId}`);
    logger.info(`[CIRCLE] To: ${toAddress}`);
    logger.info(`[CIRCLE] Amount: ${amountInEther} ETH`);
    
    try {
      const response = await this.client.post(
        '/developer/transactions/transfer',
        requestBody
      );

      const transaction = this.extractTransaction(response.data);
      
      logger.info(`[CIRCLE] Native transfer created: ${transaction.id} - State: ${transaction.state}`);
      return { transaction };
    } catch (error: any) {
      const errorData = error.response?.data;
      logger.error(`[CIRCLE] Native transfer error:`, JSON.stringify(errorData));
      
      const errorMsg = errorData?.message || errorData?.error?.message || error.message || 'Native transfer failed';
      throw new Error(errorMsg);
    }
  }
}

export const circleWalletService = new CircleWalletService();
export default circleWalletService;
