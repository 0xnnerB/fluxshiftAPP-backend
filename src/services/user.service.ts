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
    const existingUser = userStore.getUserByEmail(email);
    
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
              userStore.addWalletAddress(existingUser.id, wallet.blockchain, wallet.address, wallet.walletId);
            }
          }
          
          const updatedUser = userStore.getUserById(existingUser.id)!;
          return {
            user: updatedUser,
            wallets: updatedUser.walletAddresses.map(wa => ({
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

    const user = existingUser || userStore.createUser(email, passwordHash);

    try {
      logger.info(`Creating new wallets for: ${email}`);
      const walletsResult = await circleWalletService.createUserWallets();

      userStore.updateUser(user.id, {
        circleWalletSetId: walletsResult.walletSetId,
      });

      // Salva cada wallet com seu respectivo walletId
      for (const wallet of walletsResult.wallets) {
        if (wallet.address && wallet.walletId) {
          userStore.addWalletAddress(user.id, wallet.blockchain, wallet.address, wallet.walletId);
        }
      }

      const updatedUser = userStore.getUserById(user.id)!;

      logger.info(`Created user ${email} with ${walletsResult.wallets.length} wallets`);

      return {
        user: updatedUser,
        wallets: updatedUser.walletAddresses.map(wa => ({
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

  getUser(userId: string): User | undefined {
    return userStore.getUserById(userId);
  }

  getUserByEmail(email: string): User | undefined {
    return userStore.getUserByEmail(email);
  }

  getWalletAddress(userId: string, blockchain: string): string | undefined {
    const user = userStore.getUserById(userId);
    if (!user) return undefined;

    const walletAddress = user.walletAddresses.find(wa => wa.blockchain === blockchain);
    return walletAddress?.address;
  }

  // NOVO: Retorna o walletId para uma blockchain específica
  getWalletIdForBlockchain(userId: string, blockchain: string): string | undefined {
    return userStore.getWalletIdForBlockchain(userId, blockchain);
  }

  // NOVO: Retorna o walletId para um chainKey (ex: ETH_SEPOLIA)
  getWalletIdForChainKey(userId: string, chainKey: string): string | undefined {
    const chain = CHAINS[chainKey];
    if (!chain) return undefined;
    return userStore.getWalletIdForBlockchain(userId, chain.circleBlockchain);
  }

  getAllWalletAddresses(userId: string): Array<{ blockchain: string; address: string }> {
    const user = userStore.getUserById(userId);
    if (!user) return [];

    return user.walletAddresses.map(wa => ({
      blockchain: wa.blockchain,
      address: wa.address,
    }));
  }

  getTransferHistory(userId: string): { pending: Transfer[]; completed: Transfer[] } {
    return {
      pending: userStore.getPendingTransfers(userId),
      completed: userStore.getCompletedTransfers(userId),
    };
  }

  getTransfer(transferId: string): Transfer | undefined {
    return userStore.getTransferById(transferId);
  }

  listAllUsers(): User[] {
    return userStore.getAllUsers();
  }
}

export const userService = new UserService();
export default userService;
