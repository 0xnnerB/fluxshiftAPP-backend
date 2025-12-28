import { logger } from '../utils/logger.js';
import { userStore, User, Transfer } from '../models/user.model.js';
import circleWalletService from './circleWallet.service.js';
import { SUPPORTED_CIRCLE_BLOCKCHAINS, CHAINS } from '../config/chains.js';

export interface CreateUserResponse {
  user: User;
  wallets: Array<{ blockchain: string; address: string }>;
  isExisting: boolean;
}

class UserService {
  async createUser(email: string, passwordHash: string | null = null): Promise<CreateUserResponse> {
    const existingUser = await userStore.getUserByEmail(email);
    
    if (existingUser) {
      logger.info(`User already exists: ${email}`);
      
      if (existingUser.circleWalletSetId && existingUser.walletAddresses.length > 0) {
        logger.info(`Returning existing wallets for: ${email}`);
        return {
          user: existingUser,
          wallets: existingUser.walletAddresses.map(wa => ({
            blockchain: wa.blockchain,
            address: wa.address,
          })),
          isExisting: true,
        };
      }
      
      if (existingUser.circleWalletSetId) {
        logger.info(`Fetching existing wallets from Circle for: ${email}`);
        try {
          const walletsResult = await circleWalletService.createUserWallets(existingUser.circleWalletSetId);
          
          for (const wallet of walletsResult.wallets) {
            if (wallet.address && wallet.walletId) {
              await userStore.addWalletAddress(existingUser.id, wallet.blockchain, wallet.address, wallet.walletId);
            }
          }
          
          const updatedUser = await userStore.getUserById(existingUser.id);
          return {
            user: updatedUser!,
            wallets: updatedUser!.walletAddresses.map(wa => ({
              blockchain: wa.blockchain,
              address: wa.address,
            })),
            isExisting: true,
          };
        } catch (error) {
          logger.error('Failed to fetch existing wallets:', error);
          return {
            user: existingUser,
            wallets: existingUser.walletAddresses.map(wa => ({
              blockchain: wa.blockchain,
              address: wa.address,
            })),
            isExisting: true,
          };
        }
      }
    }

    const user = existingUser || await userStore.createUser(email, passwordHash);

    try {
      logger.info(`Creating new wallets for: ${email}`);
      const walletsResult = await circleWalletService.createUserWallets();

      await userStore.updateUser(user.id, {
        circleWalletSetId: walletsResult.walletSetId,
      });

      // Salva cada wallet com seu respectivo walletId
      for (const wallet of walletsResult.wallets) {
        if (wallet.address && wallet.walletId) {
          await userStore.addWalletAddress(user.id, wallet.blockchain, wallet.address, wallet.walletId);
        }
      }

      const updatedUser = await userStore.getUserById(user.id);

      logger.info(`Created user ${email} with ${walletsResult.wallets.length} wallets`);

      return {
        user: updatedUser!,
        wallets: updatedUser!.walletAddresses.map(wa => ({
          blockchain: wa.blockchain,
          address: wa.address,
        })),
        isExisting: false,
      };
    } catch (error: any) {
      logger.error('Failed to create user wallets:', error);
      throw new Error(`Failed to create wallets: ${error.message}`);
    }
  }

  async getUser(userId: string): Promise<User | undefined> {
    return await userStore.getUserById(userId);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return await userStore.getUserByEmail(email);
  }

  async getWalletAddress(userId: string, blockchain: string): Promise<string | undefined> {
    const user = await userStore.getUserById(userId);
    if (!user) return undefined;

    const walletAddress = user.walletAddresses.find(wa => wa.blockchain === blockchain);
    return walletAddress?.address;
  }

  // NOVO: Retorna o walletId para uma blockchain específica
  async getWalletIdForBlockchain(userId: string, blockchain: string): Promise<string | undefined> {
    return await userStore.getWalletIdForBlockchain(userId, blockchain);
  }

  // NOVO: Retorna o walletId para um chainKey (ex: ETH_SEPOLIA)
  async getWalletIdForChainKey(userId: string, chainKey: string): Promise<string | undefined> {
    const chain = CHAINS[chainKey];
    if (!chain) return undefined;
    return await userStore.getWalletIdForBlockchain(userId, chain.circleBlockchain);
  }

  async getAllWalletAddresses(userId: string): Promise<Array<{ blockchain: string; address: string }>> {
    const user = await userStore.getUserById(userId);
    if (!user) return [];

    return user.walletAddresses.map(wa => ({
      blockchain: wa.blockchain,
      address: wa.address,
    }));
  }

  async getTransferHistory(userId: string): Promise<{ pending: Transfer[]; completed: Transfer[] }> {
    return {
      pending: await userStore.getPendingTransfers(userId),
      completed: await userStore.getCompletedTransfers(userId),
    };
  }

  async getTransfer(transferId: string): Promise<Transfer | undefined> {
    return await userStore.getTransferById(transferId);
  }

  async listAllUsers(): Promise<User[]> {
    return await userStore.getAllUsers();
  }
}

export const userService = new UserService();
export default userService;
